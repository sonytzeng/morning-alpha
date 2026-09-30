-- Candidate only. Separate Sony approval required for Production execution.
-- Forward-only Recorder correction; no business function/table/history change.
begin;

do $guard$
begin
  if md5(pg_get_functiondef('public.project_critical_sql_input_v1(jsonb,integer)'::regprocedure)) <> 'b0e13afe1fe3896a698f276c94927248'
    or md5(pg_get_functiondef('public.critical_sql_replay_inputs_v1(date)'::regprocedure)) <> 'b39c42768aedaf18d9e1fbab7094bb1a'
    or md5(pg_get_functiondef('public.record_critical_contract_evidence_v1(date,text,jsonb)'::regprocedure)) <> 'aec44434bcc58acfa496fabb6e7da433' then
    raise exception 'RECORDER_RETRY_PROJECTION_PREDECESSOR_MISMATCH';
  end if;
end;
$guard$;

do $projection$
declare v_before text; v_after text;
begin
  select pg_get_functiondef('public.project_critical_sql_input_v1(jsonb,integer)'::regprocedure) into v_before;
  -- Finite exact names from the unchanged bounded Retry contract, not a wildcard.
  v_after := replace(v_before, $old$'premarket','0900'$old$, $new$
    'premarket_readiness_retry_0740','premarket_readiness_retry_0745',
    'premarket_readiness_retry_0750','premarket_readiness_retry_0755',
    'premarket_readiness_retry_0800','premarket_readiness_retry_0805',
    'premarket_readiness_retry_0810','premarket_readiness_retry_0815',
    'premarket_readiness_retry_0820','premarket_readiness_retry_0825',
    'premarket_readiness_retry_0830','premarket_readiness_retry_0835',
    'premarket_readiness_retry_0845','retry_count','premarket','0900'$new$);
  if v_after = v_before then raise exception 'RECORDER_RETRY_DICTIONARY_REPLACEMENT_MISSING'; end if;
  execute v_after;

  select pg_get_functiondef('public.critical_sql_replay_inputs_v1(date)'::regprocedure) into v_before;
  v_after := replace(v_before,
    'id,endpoint,idempotency_key,trading_date,job_name,checkpoint,dispatch_status,response_success',
    'id,endpoint,idempotency_key,trading_date,job_name,checkpoint,correlation_id,retry_count,dispatch_status,response_success');
  if v_after = v_before then raise exception 'RECORDER_RETRY_DISPATCH_INPUT_MISSING'; end if;
  v_before := v_after;
  v_after := replace(v_before,
    $old$return jsonb_build_object('tables',v_tables,'observed_at',clock_timestamp(),$old$,
    $new$return jsonb_build_object('tables',v_tables,'observed_at',clock_timestamp(),
    'recorder_projection_version','CRITICAL_SQL_RETRY_PROJECTION_V2',
    'provider_failure', (select jsonb_build_object('primary_code',h.last_error_code,
      'retry_entry_state',h.details->>'retry_entry_state')
      from public.data_provider_health h where h.service_date=p_date
        and h.provider='market_fetch_v10' and h.phase='premarket' and h.checkpoint='premarket' limit 1),$new$);
  if v_after = v_before then raise exception 'RECORDER_RETRY_VERSION_REPLACEMENT_MISSING'; end if;
  execute v_after;
end;
$projection$;

-- Old capsules have no source_event_id: preserved unchanged, never backfilled.
create unique index critical_contract_source_event_once_v2
  on public.production_critical_contract_evidence ((capsule->>'source_event_id'))
  where capsule ? 'source_event_id';

create or replace function public.record_critical_contract_evidence_v1(p_business_date date,p_stage text,p_capsule jsonb)
returns uuid language plpgsql security definer set search_path='' as $record$
declare
  v_id uuid; v_capsule jsonb; v_event text; v_checkpoint text; v_dispatch jsonb;
  v_origin text := coalesce(nullif(current_setting('morning_alpha.recorder_execution_origin',true),''),'PRODUCTION_CAPTURE');
begin
  -- Offline Replay is separately labelled by its runner. It may never append
  -- another purported original source capsule, even inside a rolled-back test.
  if v_origin='REPLAY' then return null; end if;
  if v_origin not in ('PRODUCTION_CAPTURE','SHADOW_CAPTURE') then return null; end if;
  if p_business_date is null or p_stage not in ('RESEARCH','PUBLICATION','OPENING','CLOSING','LEARNING','LIFECYCLE','ACCEPTANCE')
    or p_capsule->>'contract_version' is distinct from 'CRITICAL_CONTRACT_REPLAY_V1'
    or not public.critical_contract_capsule_safe_v1(p_capsule) then return null; end if;
  v_event:=encode(sha256(convert_to(jsonb_build_array(p_business_date,p_stage,p_capsule)::text,'UTF8')),'hex');
  v_capsule:=p_capsule||jsonb_build_object('capture_origin',v_origin,'source_event_id',v_event,
    'recorder_projection_version','CRITICAL_SQL_RETRY_PROJECTION_V2',
    'source_correlation_id',p_capsule#>>'{args,p_correlation_id}');
  v_checkpoint:=p_capsule#>>'{args,p_checkpoint}';
  if v_checkpoint=any(array[
    'premarket_readiness_retry_0740','premarket_readiness_retry_0745',
    'premarket_readiness_retry_0750','premarket_readiness_retry_0755',
    'premarket_readiness_retry_0800','premarket_readiness_retry_0805',
    'premarket_readiness_retry_0810','premarket_readiness_retry_0815',
    'premarket_readiness_retry_0820','premarket_readiness_retry_0825',
    'premarket_readiness_retry_0830','premarket_readiness_retry_0835',
    'premarket_readiness_retry_0845']) then
    select value into v_dispatch from jsonb_array_elements(p_capsule#>'{database_inputs,tables,runtime_http_dispatches}')
      where value->>'id'=p_capsule#>>'{args,p_metadata,http_dispatch_id}';
    v_capsule:=v_capsule||jsonb_build_object('retry_attempt',jsonb_build_object(
      'checkpoint',v_checkpoint,'attempt',case when v_dispatch ? 'retry_count' then (v_dispatch->>'retry_count')::integer+1 else null end,
      'source_correlation_id',p_capsule#>>'{args,p_correlation_id}',
      'attempt_kind',case when v_checkpoint='premarket_readiness_retry_0845' then 'FINAL_DEADLINE_ATTEMPT' else 'READINESS_RETRY_ATTEMPT' end,
      'deadline_state',case when v_checkpoint='premarket_readiness_retry_0845' then 'AT_FINAL_DEADLINE' else 'BEFORE_FINAL_DEADLINE' end,
      'dispatch_status',v_dispatch->>'dispatch_status',
      'failure_classification',p_capsule#>'{database_inputs,provider_failure}'));
  end if;
  if not public.critical_contract_capsule_safe_v1(v_capsule) then return null; end if;
  insert into public.production_critical_contract_evidence(business_date,stage,capsule)
    values(p_business_date,p_stage,v_capsule)
    on conflict ((capsule->>'source_event_id')) where capsule ? 'source_event_id' do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.production_critical_contract_evidence where capsule->>'source_event_id'=v_event;
  end if;
  return v_id;
exception when others then
  -- Observability stays fail-open; business execution never depends on this ID.
  return null;
end;
$record$;
-- CREATE OR REPLACE retains the existing owner, ACL, signature and security.
-- No GRANT/REVOKE, Auth/RLS, Cron, provider or business-state mutation.
commit;
