create or replace function public.content_os_lock_verified_public_selection(
  target_content_job_id uuid,
  target_engine_version text,
  target_public_story_id text,
  target_public_payload jsonb,
  target_selection_reason text,
  target_exposure_policy jsonb
)
returns public.content_selection_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.content_jobs%rowtype;
  snapshot public.source_snapshots%rowtype;
  selected public.content_selection_runs%rowtype;
  budget public.daily_public_exposure_budgets%rowtype;
  expected_references jsonb;
  expected_public_payload jsonb;
  empty_premium_payload constant jsonb := '{"premiumStories":[]}'::jsonb;
  computed_public_payload_hash text;
  computed_premium_payload_hash text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'CONTENT_SELECTION_SERVICE_ROLE_REQUIRED';
  end if;

  select * into job
  from public.content_jobs row
  where row.id = target_content_job_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'CONTENT_SELECTION_JOB_NOT_FOUND';
  end if;
  if job.status not in ('planning', 'topic_selected', 'script_generation', 'manual_review')
     or not exists (
       select 1 from public.brands brand
       where brand.id = job.brand_id
         and brand.slug = 'morning-alpha'
         and brand.pipeline_adapter_key = 'morning_alpha_event_v1'
         and brand.status = 'active'
     ) then
    raise exception using errcode = '23514', message = 'CONTENT_SELECTION_JOB_STATE_INVALID';
  end if;

  select * into snapshot
  from public.source_snapshots row
  where row.id = job.source_snapshot_id;
  if not found
     or snapshot.verification_status <> 'verified'
     or snapshot.data_quality <> 'complete'
     or snapshot.expires_at is null
     or snapshot.expires_at <= now()
     or snapshot.payload ->> 'contract_version' <> 'morning_alpha_public_contract_v1'
     or snapshot.payload ->> 'core_data_status' <> 'PASS'
     or snapshot.payload ->> 'public_delivery_status' <> 'PASS'
     or snapshot.payload ->> 'evidence_status' <> 'verified'
     or snapshot.payload #>> '{verification,status}' <> 'verified'
     or snapshot.payload -> 'premium_locked' is distinct from 'true'::jsonb
     or snapshot.payload #> '{premium,locked}' is distinct from 'true'::jsonb then
    raise exception using errcode = '23514', message = 'VERIFIED_PUBLIC_SOURCE_REQUIRED';
  end if;

  if target_engine_version is distinct from 'morning_alpha_public_social_v1'
     or target_public_story_id is distinct from snapshot.payload ->> 'topic_fingerprint'
     or target_exposure_policy is distinct from jsonb_build_object(
       'maxPublicCoreStories', 1,
       'publicStoryId', target_public_story_id,
       'expectedPlatforms', jsonb_build_array('threads', 'instagram', 'facebook')
     ) then
    raise exception using errcode = '23514', message = 'PUBLIC_SELECTION_IDENTITY_INVALID';
  end if;

  select coalesce(jsonb_agg(reference.url order by reference.first_ordinal), '[]'::jsonb)
  into expected_references
  from (
    select source_reference ->> 'url' as url, min(ordinality) as first_ordinal
    from jsonb_array_elements(
      case when jsonb_typeof(snapshot.payload -> 'source_references') = 'array'
        then snapshot.payload -> 'source_references' else '[]'::jsonb end
    ) with ordinality as refs(source_reference, ordinality)
    where nullif(btrim(source_reference ->> 'url'), '') is not null
    group by source_reference ->> 'url'
  ) reference;
  if jsonb_array_length(expected_references) not between 1 and 40 then
    raise exception using errcode = '23514', message = 'PUBLIC_SOURCE_REFERENCES_REQUIRED';
  end if;

  expected_public_payload := jsonb_build_object(
    'reportId', coalesce(snapshot.payload ->> 'report_id', snapshot.external_object_id),
    'date', snapshot.payload ->> 'report_date',
    'heroStory', jsonb_build_object(
      'id', snapshot.payload ->> 'topic_fingerprint',
      'title', left(btrim(snapshot.payload #>> '{public_topic,title}'), 240),
      'whatHappened', left(btrim(snapshot.payload #>> '{public_topic,reason}'), 2500),
      'whyImportant', left(btrim(snapshot.payload ->> 'public_summary'), 2500),
      'marketReaction', left(btrim(snapshot.payload #>> '{morning_brief,current_market_summary}'), 2500),
      'taiwanImpact', left(btrim(snapshot.payload ->> 'daily_sentence'), 2500),
      'category', left(btrim(snapshot.payload #>> '{public_topic,kind}'), 120),
      'sourceReferences', expected_references
    ),
    'publicContext', left(btrim(snapshot.payload ->> 'public_summary'), 2500),
    'publicExplanation', left(btrim(snapshot.payload #>> '{public_topic,reason}'), 2500),
    'socialHook', left(btrim(snapshot.payload ->> 'daily_sentence'), 400),
    'ctaContext', left(btrim(snapshot.payload #>> '{public_topic,summary}'), 600),
    'premiumTeaserCount', 0,
    'sourceReferences', expected_references
  );
  if target_public_payload is distinct from expected_public_payload
     or target_public_payload::text ilike '%premiumStories%'
     or target_public_payload::text ilike '%reason_codes%' then
    raise exception using errcode = '23514', message = 'PUBLIC_SELECTION_PROJECTION_INVALID';
  end if;

  computed_public_payload_hash := encode(
    extensions.digest(
      convert_to(content_os_private.canonical_jsonb_text(target_public_payload), 'utf8'),
      'sha256'
    ),
    'hex'
  );
  computed_premium_payload_hash := encode(
    extensions.digest(
      convert_to(content_os_private.canonical_jsonb_text(empty_premium_payload), 'utf8'),
      'sha256'
    ),
    'hex'
  );

  select * into selected
  from public.content_selection_runs selection
  where selection.source_snapshot_id = snapshot.id
    and selection.engine_version = target_engine_version
  limit 1;
  if found then
    if selected.public_payload_hash <> computed_public_payload_hash
       or selected.premium_payload_hash <> computed_premium_payload_hash
       or selected.public_story_id <> target_public_story_id
       or selected.exposure_policy <> target_exposure_policy then
      raise exception using errcode = '23514', message = 'CONTENT_SELECTION_IDEMPOTENCY_CONFLICT';
    end if;
  else
    insert into public.content_selection_runs (
      organization_id, workspace_id, brand_id, source_snapshot_id,
      report_id, report_date, engine_version, story_count,
      public_story_id, premium_story_ids, public_payload,
      public_payload_hash, premium_payload_hash, selection_reason, exposure_policy
    ) values (
      job.organization_id, job.workspace_id, job.brand_id, snapshot.id,
      coalesce(snapshot.payload ->> 'report_id', snapshot.external_object_id),
      (snapshot.payload ->> 'report_date')::date,
      target_engine_version, 1,
      target_public_story_id, '{}'::text[], target_public_payload,
      computed_public_payload_hash, computed_premium_payload_hash,
      btrim(target_selection_reason), target_exposure_policy
    ) returning * into selected;

    insert into content_os_private.content_selection_premium (
      selection_run_id, organization_id, workspace_id, brand_id,
      story_scores, premium_payload, premium_fingerprints
    ) values (
      selected.id, job.organization_id, job.workspace_id, job.brand_id,
      '[]'::jsonb, empty_premium_payload, '[]'::jsonb
    );
  end if;

  insert into public.daily_public_exposure_budgets (
    organization_id, workspace_id, brand_id, report_id, report_date,
    selection_run_id, public_story_id, max_public_core_stories, exposed_story_ids
  ) values (
    job.organization_id, job.workspace_id, job.brand_id,
    selected.report_id, selected.report_date,
    selected.id, selected.public_story_id, 1, array[selected.public_story_id]
  ) on conflict (brand_id, report_date) do nothing;

  select * into budget
  from public.daily_public_exposure_budgets exposure
  where exposure.brand_id = job.brand_id
    and exposure.report_date = selected.report_date
  for update;
  if budget.selection_run_id <> selected.id
     or budget.public_story_id <> selected.public_story_id
     or budget.max_public_core_stories <> 1
     or budget.exposed_story_ids <> array[selected.public_story_id]
     or budget.status = 'blocked' then
    raise exception using errcode = '23514', message = 'DAILY_PUBLIC_HERO_CONFLICT';
  end if;

  if job.selection_run_id is not null and job.selection_run_id <> selected.id then
    raise exception using errcode = '23514', message = 'CONTENT_SELECTION_JOB_CONFLICT';
  end if;
  update public.content_jobs
  set selection_run_id = selected.id, updated_at = now()
  where id = job.id and selection_run_id is null;
  return selected;
end;
$$;

revoke all on function public.content_os_lock_verified_public_selection(
  uuid, text, text, jsonb, text, jsonb
) from public, anon, authenticated;
grant execute on function public.content_os_lock_verified_public_selection(
  uuid, text, text, jsonb, text, jsonb
) to service_role;
