-- Candidate only. No business backfill, historical Acceptance rewrite, Cron,
-- provider/Atomic/Retry/strategy change or existing privilege/policy change.
begin;

create function public.public_market_checkpoint_inputs_v1(p_business_date date)
returns jsonb language sql stable security definer set search_path='' as $read$
  select jsonb_build_object('batches',coalesce((
    select jsonb_agg(jsonb_build_object('batch_id',batch_id,'business_date',business_date,
      'checkpoint',checkpoint,'status',status,'correlation_id',correlation_id,'payload_hash',payload_hash,
      'expected_provider_count',expected_provider_count,'committed_provider_count',committed_provider_count,
      'committed_at',committed_at) order by checkpoint,batch_id)
    from public.market_checkpoint_batches where business_date=p_business_date and status='COMMITTED'
      and checkpoint=any(array['PREMARKET','0900','0930','1030','1300','1410','1430'])),'[]'::jsonb),
    'proofs',coalesce((select jsonb_agg(public.market_checkpoint_batch_integrity_v1(p_business_date,checkpoint) order by checkpoint)
      from (select distinct checkpoint from public.market_checkpoint_batches where business_date=p_business_date
        and status='COMMITTED' and checkpoint=any(array['PREMARKET','0900','0930','1030','1300','1410','1430'])) b),'[]'::jsonb));
$read$;
revoke all on function public.public_market_checkpoint_inputs_v1(date) from public,anon,authenticated;
grant execute on function public.public_market_checkpoint_inputs_v1(date) to service_role;

do $migration$
declare target regprocedure; definition text; before_catalog jsonb; after_catalog jsonb; old_fragment text; new_fragment text;
begin
  target:='public.record_content_os_incident_v1(text,date,uuid,integer,text[],integer,jsonb)'::regprocedure;
  definition:=pg_get_functiondef(target);
  if md5(definition)<>'22a9cb2f2f4f880d87a31c45af04fab3' then raise exception 'PUBLIC_PROJECTION_INCIDENT_PREDECESSOR_MISMATCH'; end if;
  select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid)) into before_catalog from pg_proc where oid=target;
  old_fragment:=$old$  returning id into v_id;
  return v_id;$old$;
  new_fragment:=$new$  where not (public.content_os_sync_incidents.status='OPEN'
    and public.content_os_sync_incidents.snapshot_id is not distinct from excluded.snapshot_id
    and public.content_os_sync_incidents.snapshot_version is not distinct from excluded.snapshot_version
    and public.content_os_sync_incidents.reason_codes is not distinct from excluded.reason_codes
    and public.content_os_sync_incidents.metadata is not distinct from excluded.metadata
    and excluded.metadata->>'retry_classification'='NON_RETRYABLE')
  returning id into v_id;
  if v_id is null then select id into v_id from public.content_os_sync_incidents where incident_key=p_incident_key; end if;
  return v_id;$new$;
  if position(old_fragment in definition)=0 then raise exception 'PUBLIC_PROJECTION_INCIDENT_ANCHOR_MISSING'; end if;
  execute replace(definition,old_fragment,new_fragment);
  select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid)) into after_catalog from pg_proc where oid=target;
  if after_catalog is distinct from before_catalog then raise exception 'PUBLIC_PROJECTION_INCIDENT_CATALOG_DRIFT'; end if;

  target:='public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure;
  definition:=pg_get_functiondef(target);
  if md5(definition)<>'5dfcfd22a6f430d4acae45d7a527f9e9' then raise exception 'PUBLIC_PROJECTION_ACCEPTANCE_PREDECESSOR_MISMATCH'; end if;
  select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid)) into before_catalog from pg_proc where oid=target;
  old_fragment:=$old$  if v_verdict='NOT_DUE' then$old$;
  new_fragment:=$new$  if v_operational and v_verdict<>'NOT_DUE' then
    v_evidence:=jsonb_set(v_evidence,'{acceptance_dimensions}',coalesce(v_evidence->'acceptance_dimensions','{}'::jsonb)||jsonb_build_object(
      'REPORT',case when v_evidence->'report_pass'='true'::jsonb and v_evidence->'publication_pass'='true'::jsonb then 'PASS' else 'FAIL' end,
      'PUBLIC_PROJECTION',case when 'CONTENT_HANDOFF_INCIDENT'=any(v_block) then 'FAIL' else 'PASS' end));
    -- A public/export incident does not erase a verified core lifecycle. Keep
    -- blocking reasons visible; do not convert service availability into SLA.
    if v_service and cardinality(v_block)>0 and not exists(select 1 from unnest(v_block) b
      where b not in ('CONTENT_HANDOFF_INCIDENT','LEARNING_REVISION_UNVERIFIED')) then
      v_verdict:='DEGRADED';
    end if;
    v_evidence:=v_evidence||jsonb_build_object('overall_status',v_verdict,
      'lifecycle_status',case when v_verdict='DEGRADED' then 'CORE_COMPLETE' else v_verdict end,
      'public_projection_contract','CANONICAL_PUBLIC_MARKET_V1');
  end if;
  if v_verdict='NOT_DUE' then$new$;
  if position(old_fragment in definition)=0 then raise exception 'PUBLIC_PROJECTION_ACCEPTANCE_ANCHOR_MISSING'; end if;
  execute replace(definition,old_fragment,new_fragment);
  select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid)) into after_catalog from pg_proc where oid=target;
  if after_catalog is distinct from before_catalog then raise exception 'PUBLIC_PROJECTION_ACCEPTANCE_CATALOG_DRIFT'; end if;
end;
$migration$;

-- Add one explicit multidimensional outcome. Existing rows remain byte-for-byte
-- unchanged; their stored FAIL is never reinterpreted or recomputed here.
alter table public.production_acceptance_results drop constraint production_acceptance_results_verdict_check;
alter table public.production_acceptance_results add constraint production_acceptance_results_verdict_check
  check (verdict in ('PASS','FAIL','NOT_DUE','DEGRADED'));
commit;
