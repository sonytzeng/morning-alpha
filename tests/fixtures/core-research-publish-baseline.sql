-- Production function baseline read-only export, schema contract only, 2026-09-07.
CREATE OR REPLACE FUNCTION public.publish_decision_snapshot_v2(p_report_date date, p_session_type text, p_report_id uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session_id uuid;
  v_previous public.decision_snapshots%rowtype;
  v_snapshot_id uuid;
  v_fingerprint text;
  v_version integer;
  v_now timestamptz := clock_timestamp();
  v_content_score numeric(5, 2);
  v_content_grade text;
  v_status text;
  v_snapshot_session_type text;
begin
  if p_report_date is null then
    raise exception 'report_date is required';
  end if;
  v_snapshot_session_type := case
    when p_session_type = 'OPEN' then 'OPENING'
    when p_session_type = 'MID_MORNING' then 'INTRADAY'
    when p_session_type = 'CLOSE' then 'CLOSING'
    else p_session_type
  end;
  if v_snapshot_session_type not in ('PREMARKET', 'OPENING', 'INTRADAY', 'PRE_CLOSE', 'CLOSING', 'POST_CLOSE') then
    raise exception 'invalid session_type: %', p_session_type;
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  perform pg_advisory_xact_lock(hashtext(concat(p_report_date::text, ':', v_snapshot_session_type)));

  v_fingerprint := md5(p_payload::text);
  v_content_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_content_grade := coalesce(nullif(p_payload ->> 'content_grade', ''), 'reject');
  v_status := case
    when v_snapshot_session_type = 'CLOSING' then 'FINAL'
    when p_payload ->> 'decision_mode' = 'blocked' then 'INSUFFICIENT_DATA'
    when v_content_score >= 80 then 'READY'
    when v_content_score >= 70 then 'PARTIAL'
    else 'INSUFFICIENT_DATA'
  end;

  select *
    into v_previous
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = v_snapshot_session_type
    and is_current = true
  for update;

  if found and v_previous.snapshot_fingerprint = v_fingerprint then
    return v_previous.id;
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = v_snapshot_session_type;

  insert into public.research_sessions (
    trading_date,
    session_type,
    version,
    status,
    report_mode,
    market_status,
    is_trading_day,
    data_as_of,
    generated_at,
    engine_version,
    idempotency_key,
    input_coverage,
    missing_sources,
    reason_codes
  ) values (
    p_report_date,
    v_snapshot_session_type,
    v_version,
    case
      when v_snapshot_session_type = 'CLOSING' then 'VERIFIED'
      when p_payload ->> 'decision_mode' = 'blocked' then 'REJECTED'
      when v_content_score >= 80 then 'PUBLISHED'
      when v_content_score >= 70 then 'DEGRADED'
      else 'REJECTED'
    end,
    nullif(p_payload ->> 'report_mode', ''),
    nullif(p_payload ->> 'market_status', ''),
    case
      when p_payload ? 'is_trading_day' then (p_payload ->> 'is_trading_day')::boolean
      else null
    end,
    nullif(p_payload ->> 'data_as_of', '')::timestamptz,
    coalesce(nullif(p_payload ->> 'generated_at', '')::timestamptz, v_now),
    nullif(p_payload ->> 'engine_version', ''),
    concat(p_report_date::text, ':', v_snapshot_session_type, ':', v_fingerprint),
    coalesce(p_payload -> 'input_coverage', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'missing_sources', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[])
  )
  on conflict (idempotency_key) do update
    set status = excluded.status,
        data_as_of = excluded.data_as_of,
        reason_codes = excluded.reason_codes
  returning id into v_session_id;

  if v_previous.id is not null then
    update public.decision_snapshots
      set is_current = false,
          valid_until = v_now
    where id = v_previous.id;
  end if;

  insert into public.decision_snapshots (
    report_date,
    session_type,
    version,
    idempotency_key,
    status,
    market_score,
    confidence_score,
    coverage_score,
    action,
    market_regime,
    preferred_sectors,
    watch_sectors,
    blocked_sectors,
    reasons,
    risk_flags,
    invalidation_rules,
    factor_scores,
    source_freshness,
    source_refs,
    generated_text,
    valid_from,
    supersedes_id,
    is_current,
    research_session_id,
    report_id,
    snapshot_fingerprint,
    decision_mode,
    content_score,
    content_grade,
    content_score_breakdown,
    reason_codes,
    generic_content_flags
  ) values (
    p_report_date,
    v_snapshot_session_type,
    v_version,
    concat(p_report_date::text, ':', v_snapshot_session_type, ':', v_fingerprint),
    v_status,
    nullif(p_payload ->> 'market_score', '')::numeric,
    nullif(p_payload ->> 'confidence_score', '')::numeric,
    nullif(p_payload ->> 'coverage_score', '')::numeric,
    nullif(p_payload ->> 'action', ''),
    nullif(p_payload ->> 'market_regime', ''),
    coalesce(p_payload -> 'preferred_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'watch_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'blocked_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'reasons', '[]'::jsonb),
    coalesce(p_payload -> 'risk_flags', '[]'::jsonb),
    coalesce(p_payload -> 'invalidation_rules', '[]'::jsonb),
    coalesce(p_payload -> 'factor_scores', '{}'::jsonb),
    coalesce(p_payload -> 'source_freshness', '{}'::jsonb),
    coalesce(p_payload -> 'source_refs', '[]'::jsonb),
    coalesce(p_payload -> 'generated_text', '{}'::jsonb),
    v_now,
    v_previous.id,
    true,
    v_session_id,
    p_report_id,
    v_fingerprint,
    nullif(p_payload ->> 'decision_mode', ''),
    v_content_score,
    v_content_grade,
    coalesce(p_payload -> 'content_score_breakdown', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'generic_content_flags', '[]'::jsonb))), '{}'::text[])
  )
  returning id into v_snapshot_id;

  if v_snapshot_session_type = 'PREMARKET' then
    insert into public.editorial_reviews (
      research_session_id,
      decision_snapshot_id,
      review_status,
      content_score,
      content_score_breakdown,
      reason_codes,
      generic_content_flags
    ) values (
      v_session_id,
      v_snapshot_id,
      case
        when p_payload ->> 'decision_mode' = 'blocked' then 'REJECTED'
        when v_content_score >= 80 then 'APPROVED'
        when v_content_score >= 70 then 'DEGRADED'
        else 'REJECTED'
      end,
      coalesce(v_content_score, 0),
      coalesce(p_payload -> 'content_score_breakdown', '{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'generic_content_flags', '[]'::jsonb))), '{}'::text[])
    );
  end if;

  return v_snapshot_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_decision_snapshot_v3(p_report_date date, p_session_type text, p_report_id uuid, p_payload jsonb, p_correlation_id uuid, p_idempotency_key text, p_attempt integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_snapshot_id uuid;
  v_research_session_id uuid;
  v_policy public.runtime_quality_policies%rowtype;
  v_score numeric;
  v_pipeline_status text;
begin
  if p_correlation_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'correlation_id and idempotency_key are required';
  end if;

  select * into v_policy
  from public.runtime_quality_policies
  where active = true
  limit 1;
  if not found then
    raise exception 'active runtime quality policy missing';
  end if;

  v_snapshot_id := public.publish_decision_snapshot_v2(
    p_report_date,
    p_session_type,
    p_report_id,
    p_payload
  );

  select research_session_id into v_research_session_id
  from public.decision_snapshots
  where id = v_snapshot_id;

  v_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_pipeline_status := case
    when coalesce((p_payload ->> 'safe_mode')::boolean, false) then 'DEGRADED'
    when p_payload ->> 'decision_mode' = 'blocked' then 'DEGRADED'
    when v_score >= v_policy.premium_publish_min then 'SUCCEEDED'
    when v_score >= v_policy.auto_repair_min then 'DEGRADED'
    else 'FAILED'
  end;

  insert into public.pipeline_runs (
    research_session_id,
    decision_snapshot_id,
    trading_date,
    checkpoint,
    idempotency_key,
    status,
    attempt,
    started_at,
    completed_at,
    reason_codes,
    correlation_id,
    engine_version,
    safe_mode,
    duration_ms,
    delivery_status,
    recovery_plan,
    updated_at
  ) values (
    v_research_session_id,
    v_snapshot_id,
    p_report_date,
    p_session_type,
    p_idempotency_key,
    v_pipeline_status,
    greatest(1, coalesce(p_attempt, 1)),
    coalesce(nullif(p_payload ->> 'started_at', '')::timestamptz, now()),
    now(),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
    p_correlation_id,
    nullif(p_payload ->> 'engine_version', ''),
    coalesce((p_payload ->> 'safe_mode')::boolean, false),
    nullif(p_payload ->> 'duration_ms', '')::integer,
    case when v_pipeline_status = 'SUCCEEDED' then 'PENDING' else 'FAILED' end,
    coalesce(p_payload -> 'recovery_plan', '{}'::jsonb),
    now()
  )
  on conflict (idempotency_key) do update
    set research_session_id = excluded.research_session_id,
        decision_snapshot_id = excluded.decision_snapshot_id,
        status = excluded.status,
        completed_at = excluded.completed_at,
        reason_codes = excluded.reason_codes,
        correlation_id = excluded.correlation_id,
        engine_version = excluded.engine_version,
        safe_mode = excluded.safe_mode,
        duration_ms = excluded.duration_ms,
        delivery_status = excluded.delivery_status,
        recovery_plan = excluded.recovery_plan,
        updated_at = now();

  return v_snapshot_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_member_content_revision_v1(p_report_date date, p_report_id uuid, p_decision_snapshot_id uuid, p_idempotency_key text, p_source_revision text, p_canonical_contract jsonb, p_member_content jsonb, p_semantic_result jsonb, p_content_score numeric, p_evidence_coverage numeric, p_generated_at timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing uuid;
  v_snapshot public.decision_snapshots;
  v_revision integer;
  v_revision_id uuid;
  v_status text := upper(coalesce(p_semantic_result->>'status','BLOCKED'));
  v_gate_version text := coalesce(p_semantic_result->>'gate_version','SEMANTIC_COHERENCE_V2');
begin
  if p_report_date is null or p_report_id is null or p_decision_snapshot_id is null then
    raise exception 'member revision identity is required';
  end if;
  if coalesce(trim(p_idempotency_key),'') = '' or coalesce(trim(p_source_revision),'') = '' then
    raise exception 'member revision idempotency and source revision are required';
  end if;
  if v_status not in ('PASSED','BLOCKED','DEGRADED') then
    raise exception 'invalid semantic status: %', v_status;
  end if;
  select id into v_existing from public.member_content_revisions where idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;
  select * into v_snapshot from public.decision_snapshots where id = p_decision_snapshot_id for share;
  if not found or v_snapshot.report_date <> p_report_date or v_snapshot.report_id <> p_report_id then
    raise exception 'snapshot/report/date contract mismatch';
  end if;
  if p_canonical_contract->>'snapshot_id' <> p_decision_snapshot_id::text
    or nullif(p_canonical_contract->>'snapshot_version','')::integer <> v_snapshot.version then
    raise exception 'canonical snapshot identity mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member_content:' || p_report_date::text, 0));
  select coalesce(max(revision),0)+1 into v_revision
  from public.member_content_revisions where report_date = p_report_date;
  insert into public.member_content_revisions(
    report_date,report_id,decision_snapshot_id,decision_snapshot_version,revision,
    idempotency_key,status,canonical_contract,member_content,data_quality_status,
    content_score,evidence_coverage,source_revision,generated_at,metadata
  ) values (
    p_report_date,p_report_id,p_decision_snapshot_id,v_snapshot.version,v_revision,
    p_idempotency_key,v_status,p_canonical_contract,p_member_content,
    coalesce(p_canonical_contract->>'data_quality_status','insufficient'),
    p_content_score,p_evidence_coverage,p_source_revision,p_generated_at,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_revision_id;
  insert into public.semantic_coherence_reviews(
    report_date,decision_snapshot_id,member_content_revision_id,gate_version,status,
    reason_codes,conflicting_fields,canonical_snapshot_id,canonical_snapshot_version,
    checked_at,idempotency_key,result
  ) values (
    p_report_date,p_decision_snapshot_id,v_revision_id,v_gate_version,v_status,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'reason_codes','[]'::jsonb))),'{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'conflicting_fields','[]'::jsonb))),'{}'::text[]),
    p_decision_snapshot_id,v_snapshot.version,
    coalesce(nullif(p_semantic_result->>'checked_at','')::timestamptz,now()),
    p_idempotency_key || ':semantic:' || v_gate_version,p_semantic_result
  );
  return v_revision_id;
end;
$function$;
