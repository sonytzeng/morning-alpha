-- Local candidate only. No schedules, secrets, business backfill or LINE writes.
-- Reuse pipeline_runs for leases and attempt history; service-role RPCs only.
begin;

create or replace function public.claim_research_input_v1(
  p_report_date date, p_fingerprint text, p_correlation_id uuid,
  p_engine_version text, p_trigger text, p_manifest jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_run public.pipeline_runs;
  v_key text := 'research-input:' || p_report_date::text || ':' || p_fingerprint;
  v_now timestamptz := clock_timestamp();
begin
  if p_report_date is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
    or p_correlation_id is null or coalesce(p_engine_version,'') = '' or coalesce(p_trigger,'') = ''
    or jsonb_typeof(p_manifest) is distinct from 'object' then raise exception 'INPUT_MANIFEST_INCOMPLETE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('research-publication:' || p_report_date::text, 0));
  -- A killed worker must not leave a perpetual RUNNING row. The expired fence
  -- cannot publish; preserve its cause and make bounded retry explicit.
  update public.pipeline_runs set status='FAILED',completed_at=v_now,updated_at=v_now,
    error_code='RESEARCH_LEASE_EXPIRED',reason_codes=array['RESEARCH_LEASE_EXPIRED'],
    next_retry_at=case when attempt<3 then v_now else null end,
    provider_status=provider_status||jsonb_build_object('result',jsonb_build_object('success',false,'error_code','RESEARCH_LEASE_EXPIRED'))
  where trading_date=p_report_date and idempotency_key like 'research-input:%' and status='RUNNING'
    and (provider_status->>'lease_expires_at')::timestamptz<=v_now;
  select * into v_run from public.pipeline_runs where idempotency_key = v_key for update;
  if found then
    if v_run.status in ('SUCCEEDED','DEGRADED','SKIPPED') then
      return jsonb_build_object('status','REUSED','run_id',v_run.id,'outcome',v_run.status,'result',v_run.provider_status->'result');
    end if;
    if v_run.attempt >= 3 and (v_run.status <> 'RUNNING' or (v_run.provider_status->>'lease_expires_at')::timestamptz <= v_now) then
      return jsonb_build_object('status','EXHAUSTED','run_id',v_run.id);
    end if;
    if v_run.status = 'FAILED' and (v_run.next_retry_at is null or v_run.next_retry_at > v_now) then
      return jsonb_build_object('status','BACKOFF','run_id',v_run.id);
    end if;
  end if;
  if exists(select 1 from public.pipeline_runs where trading_date = p_report_date
    and idempotency_key like 'research-input:%' and status = 'RUNNING'
    and (provider_status->>'lease_expires_at')::timestamptz > v_now) then
    return jsonb_build_object('status','IN_PROGRESS');
  end if;
  insert into public.pipeline_runs(trading_date,checkpoint,idempotency_key,status,attempt,started_at,
    correlation_id,engine_version,provider_status)
  values(p_report_date,'PREMARKET',v_key,'RUNNING',1,v_now,p_correlation_id,p_engine_version,
    jsonb_build_object('input_fingerprint',p_fingerprint,'manifest',p_manifest,'trigger',p_trigger,
      'lease_expires_at',v_now + interval '5 minutes','attempt_history','[]'::jsonb))
  on conflict(idempotency_key) do update set
    status='RUNNING',attempt=public.pipeline_runs.attempt+1,started_at=v_now,completed_at=null,
    correlation_id=p_correlation_id,next_retry_at=null,updated_at=v_now,
    provider_status=public.pipeline_runs.provider_status || jsonb_build_object('trigger',p_trigger,
      'lease_expires_at',v_now + interval '5 minutes',
      'attempt_history',coalesce(public.pipeline_runs.provider_status->'attempt_history','[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('attempt',public.pipeline_runs.attempt,'status',public.pipeline_runs.status,
          'started_at',public.pipeline_runs.started_at,'completed_at',public.pipeline_runs.completed_at,
          'correlation_id',public.pipeline_runs.correlation_id,'trigger',public.pipeline_runs.provider_status->'trigger',
          'result',public.pipeline_runs.provider_status->'result')))
  returning * into v_run;
  return jsonb_build_object('status','ACQUIRED','run_id',v_run.id,'attempt',v_run.attempt);
end; $$;

create or replace function public.finish_research_input_v1(
  p_run_id uuid, p_correlation_id uuid, p_outcome text, p_result jsonb, p_retry_after_seconds integer
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not coalesce(p_outcome in ('SUCCEEDED','DEGRADED','FAILED'),false) or jsonb_typeof(p_result) is distinct from 'object'
    or (p_outcome <> 'SUCCEEDED' and coalesce(p_result->>'error_code','') = '') then
    raise exception 'RESEARCH_OUTCOME_REASON_REQUIRED';
  end if;
  update public.pipeline_runs set status=p_outcome,completed_at=clock_timestamp(),updated_at=clock_timestamp(),
    error_code=p_result->>'error_code',reason_codes=case when p_outcome='SUCCEEDED' then '{}'::text[] else array[p_result->>'error_code'] end,
    next_retry_at=case when p_outcome='FAILED' and attempt<3 and p_retry_after_seconds between 1 and 300
      then clock_timestamp()+make_interval(secs=>p_retry_after_seconds) else null end,
    provider_status=provider_status || jsonb_build_object('result',p_result)
  where id=p_run_id and correlation_id=p_correlation_id and status='RUNNING';
  return found;
end; $$;

-- The existing report, snapshot, editorial and member/semantic RPCs participate
-- in ONE transaction. A rejected member revision rolls everything back. No
-- external reader can observe the temporary current pointer inside this RPC.
create or replace function public.publish_research_bundle_v1(
  p_run_id uuid, p_correlation_id uuid, p_report jsonb, p_decision jsonb,
  p_contract jsonb, p_member jsonb, p_semantic jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_date date := (p_report->>'report_date')::date;
  v_run public.pipeline_runs;
  v_snapshot public.decision_snapshots;
  v_report_id uuid; v_snapshot_id uuid; v_member_id uuid;
  v_columns text; v_updates text; v_field text; v_quality jsonb;
  v_quote text := p_decision#>>'{generated_text,daily_sentence}';
  v_previous_ai jsonb;
  v_result jsonb;
begin
  if v_date is null then raise exception 'REPORT_DATE_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('research-publication:' || v_date::text, 0));
  select * into v_run from public.pipeline_runs where id=p_run_id for update;
  if not found or p_correlation_id is null or v_run.trading_date is distinct from v_date
    or v_run.correlation_id is distinct from p_correlation_id or v_run.status is distinct from 'RUNNING'
    or not coalesce((v_run.provider_status->>'lease_expires_at')::timestamptz > clock_timestamp(),false) then
    raise exception 'RESEARCH_LEASE_LOST'; end if;
  if p_decision->>'input_fingerprint' is distinct from v_run.provider_status->>'input_fingerprint'
    or p_contract->>'report_date' is distinct from v_date::text then raise exception 'INPUT_REVISION_MISMATCH'; end if;
  if v_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
    or not coalesce((v_run.provider_status#>>'{manifest,market_count}')::numeric>0,false)
    or not coalesce((v_run.provider_status#>>'{manifest,news_count}')::numeric>0,false)
    or not coalesce((v_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)
    or p_report#>>'{ai_strategy_json,data_quality}' is distinct from 'complete'
    or nullif(p_decision->>'data_as_of','') is null then raise exception 'SOURCE_COMPLETENESS_UNVERIFIED'; end if;
  v_quality := p_report#>'{ai_strategy_json,research_master_v2,quality}';
  if not coalesce(p_decision->>'decision_mode' in ('recommendations','no_trade'),false)
    or p_semantic->>'status' is distinct from 'PASSED' or p_semantic->'eligible' is distinct from 'true'::jsonb
    or p_semantic->'reason_codes' is distinct from '[]'::jsonb
    or v_quality->>'publish_status' is distinct from 'ready'
    or v_quality->'evidence_coverage' is distinct from '100'::jsonb
    or not coalesce((p_decision->>'content_score')::numeric between 90 and 100,false)
    or coalesce(v_quote,'') = '' then raise exception 'PUBLICATION_GATE_BLOCKED'; end if;
  foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
    if v_quality->v_field is distinct from '[]'::jsonb then raise exception 'QUALITY_COUNTER_NOT_EXPLICIT_ZERO: %',v_field; end if;
  end loop;
  if p_report->>'summary' is distinct from v_quote or p_report->>'today_quote' is distinct from v_quote
    or p_report->>'today_summary' is distinct from v_quote
    or p_member->>'today_core_thesis' is distinct from v_quote or p_member->>'line_summary' is distinct from v_quote
    or p_report#>>'{ai_strategy_json,line_push_copy,one_sentence}' is distinct from v_quote then
    raise exception 'CANONICAL_OUTPUT_DIVERGENCE'; end if;

  -- Lock the report and retain runtime evidence captured after the app's read.
  select id,ai_strategy_json into v_report_id,v_previous_ai from public.reports where report_date=v_date for update;
  foreach v_field in array array['opening_radar','opening_radar_status','intraday_tracking','intraday_sync_status','war_room','closing_verification','closing_verification_v2','todayCloseVerification'] loop
    if v_previous_ai ? v_field then p_report := jsonb_set(p_report,array['ai_strategy_json',v_field],v_previous_ai->v_field); end if;
  end loop;
  p_report := p_report || jsonb_build_object('updated_at',clock_timestamp());
  if exists(select 1 from jsonb_object_keys(p_report) k where k in ('id','created_at') or not exists(
    select 1 from pg_catalog.pg_attribute a where a.attrelid='public.reports'::regclass and a.attname=k and a.attnum>0 and not a.attisdropped)) then
    raise exception 'REPORT_COLUMNS_INVALID'; end if;
  select string_agg(format('%I',k),',' order by k),
    string_agg(format('%I=excluded.%I',k,k),',' order by k) filter(where k<>'report_date')
  into v_columns,v_updates from jsonb_object_keys(p_report) k;
  execute format('insert into public.reports(%s) select %s from jsonb_populate_record(null::public.reports,$1) on conflict(report_date) do update set %s returning id',v_columns,v_columns,v_updates)
    into v_report_id using p_report;

  -- Execution time is not decision identity. data_as_of and the effective input
  -- fingerprint remain in the hashed payload, as do source and policy versions.
  p_decision := p_decision - array['generated_at','started_at','duration_ms','correlation_id','recovery_plan'];
  v_snapshot_id := public.publish_decision_snapshot_v3(v_date,'PREMARKET',v_report_id,p_decision,p_correlation_id,
    'production-report:'||v_date::text||':PREMARKET',v_run.attempt);
  select * into strict v_snapshot from public.decision_snapshots where id=v_snapshot_id;
  p_contract := p_contract || jsonb_build_object('snapshot_id',v_snapshot_id,'snapshot_version',v_snapshot.version);
  p_member := p_member || jsonb_build_object('canonical_contract',p_contract);
  p_semantic := p_semantic || jsonb_build_object('canonical_snapshot_id',v_snapshot_id,'canonical_snapshot_version',v_snapshot.version);
  v_member_id := public.publish_member_content_revision_v1(v_date,v_report_id,v_snapshot_id,
    'member-content:'||v_snapshot_id::text, v_run.provider_status->>'input_fingerprint',p_contract,p_member,p_semantic,
    (p_decision->>'content_score')::numeric,100,clock_timestamp(),
    jsonb_build_object('actor','generate-daily-report-v7','suppress_notifications',true,'pipeline_run_id',p_run_id));
  if not exists(select 1 from public.member_content_revisions where id=v_member_id and status='PASSED') then
    raise exception 'MEMBER_PUBLICATION_NOT_PASSED'; end if;
  update public.reports set ai_strategy_json=ai_strategy_json || jsonb_build_object('revision_id',v_snapshot_id,
    'canonical_contract',p_contract,'canonical_member_revision_id',v_member_id)
  where id=v_report_id;
  v_result := jsonb_build_object('success',true,'report_id',v_report_id,'decision_snapshot_id',v_snapshot_id,
    'member_content_revision_id',v_member_id,'report_date',v_date,'semantic_status','PASSED');
  perform public.finish_research_input_v1(p_run_id,p_correlation_id,'SUCCEEDED',v_result,null);
  return v_result;
end; $$;

revoke all on function public.claim_research_input_v1(date,text,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_research_input_v1(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
revoke all on function public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claim_research_input_v1(date,text,uuid,text,text,jsonb) to service_role;
grant execute on function public.finish_research_input_v1(uuid,uuid,text,jsonb,integer) to service_role;
grant execute on function public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
-- Same-job reconciliation preserves the original receipt and attempt history.
-- Merely reaching DAY_COMPLETED cannot supersede an unrelated failed job.
-- Keep Production's integer return type, SECURITY DEFINER and private ACL.
-- Every replacement below explicitly revokes public/anon/authenticated access
-- in this same transaction before granting service_role only.
create or replace function public.reconcile_runtime_terminal_failures_v1(
  p_business_date date, p_correlation_id uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if p_business_date is null or p_correlation_id is null then raise exception 'RECONCILIATION_IDENTITY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-publication:'||p_business_date::text,0));
  if not exists (
    select 1 from public.decision_snapshots d
    join public.editorial_reviews e on e.decision_snapshot_id=d.id and e.review_status='APPROVED'
    join public.member_content_revisions m on m.decision_snapshot_id=d.id and m.status='PASSED'
    join public.semantic_coherence_reviews s on s.member_content_revision_id=m.id and s.status='PASSED'
    where d.report_date=p_business_date and d.session_type='PREMARKET' and d.is_current
      and d.status='READY' and d.decision_mode in ('recommendations','no_trade')
  ) then raise exception 'TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED'; end if;
  with replacements as (
    select f.id, s.id success_id, d.id revision_id
    from public.runtime_http_dispatches f
    join public.decision_snapshots d on d.report_date=f.trading_date and d.session_type='PREMARKET' and d.is_current
    join lateral (
      select x.id from public.runtime_http_dispatches x
      where x.trading_date=f.trading_date and x.job_name=f.job_name
        and x.checkpoint is not distinct from f.checkpoint and x.endpoint=f.endpoint
        and x.id<>f.id and x.dispatch_status='SUCCEEDED' and x.response_success=true
        and x.http_status between 200 and 299 and x.completed_at>f.completed_at
        and x.response_body->>'report_date'=f.trading_date::text
        and x.response_body->>'decision_snapshot_id'=d.id::text
      order by x.completed_at desc limit 1
    ) s on true
    where f.trading_date=p_business_date and f.dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED')
  )
  update public.runtime_http_dispatches f set dispatch_status='SKIPPED',next_retry_at=null,updated_at=clock_timestamp(),
    response_body=coalesce(f.response_body,'{}')||jsonb_build_object('terminal_reconciliation',
      jsonb_build_object('reason','SAME_JOB_DURABLE_SUCCESS','success_dispatch_id',r.success_id,
        'decision_snapshot_id',r.revision_id,'correlation_id',p_correlation_id,'reconciled_at',clock_timestamp(),
        'original_http_status',f.http_status,'original_error_code',f.response_error_code,'original_completed_at',f.completed_at))
  from replacements r where f.id=r.id;
  get diagnostics v_count=row_count;
  update public.runtime_dead_letters dl set status='resolved',resolved_at=clock_timestamp(),
    context=dl.context||jsonb_build_object('terminal_reconciliation',f.response_body->'terminal_reconciliation')
  from public.runtime_http_dispatches f
  where dl.status='open' and dl.context->>'dispatch_id'=f.id::text and f.trading_date=p_business_date
    and f.dispatch_status='SKIPPED' and f.response_body#>>'{terminal_reconciliation,reason}'='SAME_JOB_DURABLE_SUCCESS';
  return v_count;
end; $$;
revoke all on function public.reconcile_runtime_terminal_failures_v1(date,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_runtime_terminal_failures_v1(date,uuid) to service_role;

-- Existing scheduled acceptance entry point; append-only, never updates an old
-- FAIL. Its version includes phase/revision/evidence so a later result is a new
-- audit, not a rewritten history. No Cron change is made by this migration.
create or replace function public.capture_morning_alpha_acceptance_v1(
  p_business_date date, p_evaluator_version text default 'PRODUCTION_ACCEPTANCE_V1'
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_d public.decision_snapshots; v_r public.reports; v_m public.member_content_revisions;
  v_day public.trading_day_state; v_learning public.learning_runs;
  v_now timestamptz:=clock_timestamp(); v_today date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_phase text; v_verdict text; v_block text[]:='{}'; v_auto_block text[]:='{}';
  v_revision text; v_quality jsonb; v_close jsonb; v_key text; v_field text; v_symbol text; v_quote jsonb;
  v_evidence jsonb; v_id uuid; v_version text; v_line_count bigint; v_failed bigint; v_dead bigint;
  v_manual boolean; v_line_time timestamptz; v_source_run public.pipeline_runs;
begin
  if p_business_date is null then raise exception 'BUSINESS_DATE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-publication:'||p_business_date::text,0));
  select * into v_r from public.reports where report_date=p_business_date;
  select * into v_d from public.decision_snapshots where report_date=p_business_date and session_type='PREMARKET' and is_current;
  select * into v_day from public.trading_day_state where trading_date=p_business_date;
  v_revision:=v_d.id::text;
  v_phase:=case when v_now < (p_business_date::text||'T08:00:00+08:00')::timestamptz then 'NOT_DUE'
    when v_now < (p_business_date::text||'T15:25:00+08:00')::timestamptz then 'MORNING' else 'FULL_DAY' end;
  if extract(isodow from p_business_date) in (6,7) or v_r.ai_strategy_json->'is_trading_day'='false'::jsonb then
    v_phase:='NON_TRADING'; v_verdict:='NOT_DUE';
  elsif v_phase='NOT_DUE' then v_verdict:='NOT_DUE';
  else
    if v_d.id is null or v_d.status<>'READY' then v_block:=array_append(v_block,'CANONICAL_NOT_READY'); end if;
    if v_r.id is null or v_r.ai_strategy_json->>'revision_id' is distinct from v_revision then v_block:=array_append(v_block,'REPORT_REVISION_MISMATCH'); end if;
    select * into v_source_run from public.pipeline_runs where trading_date=p_business_date
      and idempotency_key like 'research-input:%' and status='SUCCEEDED'
      and provider_status#>>'{result,decision_snapshot_id}'=v_revision order by completed_at desc limit 1;
    if v_source_run.id is null or v_source_run.completed_at is null then v_block:=array_append(v_block,'INPUT_LINEAGE_UNVERIFIED'); end if;
    if v_source_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
      or not coalesce((v_source_run.provider_status#>>'{manifest,market_count}')::numeric>0,false)
      or not coalesce((v_source_run.provider_status#>>'{manifest,news_count}')::numeric>0,false)
      or not coalesce((v_source_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)
      or v_r.ai_strategy_json->>'data_quality' is distinct from 'complete'
      or not exists(select 1 from public.research_sessions where id=v_d.research_session_id and trading_date=p_business_date and data_as_of is not null)
      then v_block:=array_append(v_block,'SOURCE_COMPLETENESS_UNVERIFIED'); end if;
    v_quality:=v_r.ai_strategy_json#>'{research_master_v2,quality}';
    if v_quality->>'publish_status' is distinct from 'ready' or v_quality->'evidence_coverage' is distinct from '100'::jsonb then v_block:=array_append(v_block,'RESEARCH_NOT_READY'); end if;
    foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
      if v_quality->v_field is distinct from '[]'::jsonb then v_block:=array_append(v_block,'QUALITY_COUNTER_'||upper(v_field)); end if;
    end loop;
    if not exists(select 1 from public.editorial_reviews where decision_snapshot_id=v_d.id and review_status='APPROVED' and content_score>=90 and cardinality(reason_codes)=0) then v_block:=array_append(v_block,'EDITORIAL_NOT_APPROVED'); end if;
    select * into v_m from public.member_content_revisions where decision_snapshot_id=v_d.id and status='PASSED' order by revision desc limit 1;
    if v_m.id is null or v_m.report_date<>p_business_date or v_m.evidence_coverage<>100 or v_m.content_score<90
      or not exists(select 1 from public.semantic_coherence_reviews where member_content_revision_id=v_m.id and status='PASSED' and cardinality(reason_codes)=0)
      then v_block:=array_append(v_block,'PREMIUM_SEMANTIC_NOT_PASSED'); end if;
    if v_r.today_quote is distinct from v_d.generated_text->>'daily_sentence'
      or v_m.member_content->>'today_core_thesis' is distinct from v_d.generated_text->>'daily_sentence'
      then v_block:=array_append(v_block,'CANONICAL_OUTPUT_DIVERGENCE'); end if;
    select count(*),max(sent_at) into v_line_count,v_line_time from public.line_delivery_outbox
      where report_date=p_business_date and push_type='daily_report' and status='SENT' and decision_snapshot_id=v_d.id;
    if v_line_count=0 or exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='daily_report'
      and (status<>'SENT' or decision_snapshot_id is distinct from v_d.id or sent_at is null)) then
      v_block:=array_append(v_block,'NORMAL_REPORT_LINE_NOT_COMPLETE'); end if;
    if exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='daily_report'
      group by line_subscriber_id having count(*)>1) then v_block:=array_append(v_block,'DUPLICATE_REPORT_DELIVERY'); end if;
    if v_line_time is null or v_line_time >= (p_business_date::text||'T08:00:00+08:00')::timestamptz
      or (v_line_time at time zone 'Asia/Taipei')::date<>p_business_date then v_auto_block:=array_append(v_auto_block,'REPORT_DELIVERY_NOT_ON_TIME'); end if;
    if not exists(select 1 from public.ma_ops_runs where check_type='report' and status='passed'
      and details_json->>'target_date'=p_business_date::text and completed_at>=v_d.created_at) then v_block:=array_append(v_block,'PREMARKET_HEALTH_UNVERIFIED'); end if;
    if exists(select 1 from public.content_os_sync_incidents where business_date=p_business_date and status='OPEN') then v_block:=array_append(v_block,'CONTENT_HANDOFF_INCIDENT'); end if;
    if v_phase='FULL_DAY' then
      if v_day.current_state is distinct from 'DAY_COMPLETED' then v_block:=array_append(v_block,'DAY_NOT_COMPLETED'); end if;
      foreach v_field in array array['0900','0930','1030','1300','1410','1430'] loop
        if v_day.checkpoint_status#>>array[v_field,'status'] is distinct from 'SUCCEEDED'
          or v_day.checkpoint_status#>>array[v_field,'updated_at'] is null
          or v_day.checkpoint_status#>array[v_field,'metadata','core_batch_complete'] is distinct from 'true'::jsonb
          then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_UNVERIFIED'); end if;
        foreach v_symbol in array array['TAIEX','2330','TXF'] loop
          if not exists(select 1 from public.market_checkpoint_snapshots where trading_date=p_business_date and checkpoint=v_field
            and symbol=v_symbol and value is not null and change_percent is not null
            and value::text not in ('NaN','Infinity','-Infinity') and change_percent::text not in ('NaN','Infinity','-Infinity')
            and source_timestamp is not null and coalesce(source,'')<>''
            and correlation_id::text=v_day.checkpoint_status#>>array[v_field,'correlation_id'])
            then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_'||v_symbol||'_EVIDENCE_MISSING'); end if;
        end loop;
      end loop;
      v_close:=v_r.ai_strategy_json->'closing_verification_v2';
      if v_close->>'status' is distinct from 'completed' or v_close->>'data_status' is distinct from 'complete'
        or v_close->>'report_date' is distinct from p_business_date::text
        or v_close->>'opening_decision_snapshot_id' is distinct from v_revision
        or v_close->>'verified_at' is null then v_block:=array_append(v_block,'CLOSING_REVISION_UNVERIFIED'); end if;
      foreach v_field in array array['actual_taiex_close','actual_2330_close','actual_txf_close'] loop
        v_quote:=v_close->v_field;
        if jsonb_typeof(v_quote->'value') is distinct from 'number' or jsonb_typeof(v_quote->'change_percent') is distinct from 'number'
          or coalesce(v_quote->>'source','')='' or not coalesce((v_quote->>'captured_at')::timestamptz
            between (p_business_date::text||'T13:30:00+08:00')::timestamptz and (p_business_date::text||'T18:00:00+08:00')::timestamptz,false)
          then v_block:=array_append(v_block,'CLOSING_'||upper(v_field)||'_EVIDENCE_MISSING'); end if;
      end loop;
      select * into v_learning from public.learning_runs where run_date=p_business_date order by created_at desc limit 1;
      if v_learning.status is distinct from 'succeeded' or v_learning.completed_at is null or v_learning.failed_count is distinct from 0
        or v_learning.errors is distinct from '[]'::jsonb
        or not exists(select 1 from public.learning_predictions p join public.prediction_outcomes o on o.prediction_id=p.id
          where p.report_date=p_business_date and p.decision_snapshot_id=v_d.id and o.target_date=p_business_date
            and o.status='completed' and o.data_quality_status='complete' and o.evaluated_at<=v_learning.completed_at)
        or exists(select 1 from public.learning_predictions p where p.report_date=p_business_date and p.decision_snapshot_id=v_d.id
          and not exists(select 1 from public.prediction_outcomes o where o.prediction_id=p.id and o.target_date=p_business_date
            and o.status='completed' and o.data_quality_status='complete'))
        then v_block:=array_append(v_block,'LEARNING_REVISION_UNVERIFIED'); end if;
      if not exists(select 1 from public.ma_ops_runs where check_type='closing' and status='passed'
        and details_json->>'target_date'=p_business_date::text and completed_at>=nullif(v_close->>'verified_at','')::timestamptz)
        then v_block:=array_append(v_block,'CLOSING_HEALTH_UNVERIFIED'); end if;
    end if;
    v_manual:=coalesce(v_source_run.provider_status->>'trigger','') !~ '^(scheduled|daily_generate|daily_retry|daily_watchdog)$'
      or exists(select 1 from public.ma_ops_recovery_actions a left join public.ma_ops_runs r on r.id=a.run_id
        where a.status in ('running','succeeded') and (r.details_json->>'target_date'=p_business_date::text
          or a.before_json->>'report_date'=p_business_date::text or a.after_json->>'report_date'=p_business_date::text
          or a.before_json#>>'{request_payload,report_date}'=p_business_date::text
          or a.before_json#>>'{request_payload,target_date}'=p_business_date::text
          or a.after_json#>>'{response,report_date}'=p_business_date::text));
    if v_manual then v_auto_block:=array_append(v_auto_block,'MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER'); end if;
    -- A caller-provided "scheduled" label alone is not proof of automation.
    -- Require the actual successful scheduler receipt linked to its durable
    -- orchestrator run and this exact current revision before 08:00.
    if not exists(select 1 from public.runtime_http_dispatches h join public.pipeline_runs p
      on h.response_body->>'pipeline_run_id'=p.id::text and p.trading_date=h.trading_date
      where h.trading_date=p_business_date and h.job_name='daily_delivery'
        and h.checkpoint in ('daily_generate','daily_deliver','daily_repair','daily_watchdog')
        and h.dispatch_status='SUCCEEDED' and h.response_success=true and h.http_status between 200 and 299
        and h.response_body->>'report_date'=p_business_date::text
        and h.response_body->>'decision_snapshot_id'=v_revision
        and p.status='SUCCEEDED' and p.provider_status->>'decision_snapshot_id'=v_revision
        and h.completed_at < (p_business_date::text||'T08:00:00+08:00')::timestamptz)
      then v_auto_block:=array_append(v_auto_block,'AUTOMATION_PROVENANCE_UNVERIFIED'); end if;
    if p_business_date<>v_today then v_auto_block:=array_append(v_auto_block,'HISTORICAL_REPLAY'); end if;
    -- Acceptance is append-only observation, never an implicit Recovery.
    -- A separately authorized reconciler must close superseded receipts.
    select count(*) into v_failed from public.runtime_http_dispatches where trading_date=p_business_date and dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED');
    select count(*) into v_dead from public.runtime_dead_letters where status='open'
      and (context->>'trading_date'=p_business_date::text or context->>'dispatch_id' in (select id::text from public.runtime_http_dispatches where trading_date=p_business_date));
    if v_failed<>0 or v_dead<>0 then v_block:=array_append(v_block,'RUNTIME_FAILURE_PRESENT'); end if;
    v_verdict:=case when cardinality(v_block)=0 then 'PASS' else 'FAIL' end;
  end if;
  v_evidence:=jsonb_build_object('phase',v_phase,'canonical_revision_id',v_revision,'input_run_id',v_source_run.id,
    'input_fingerprint',v_source_run.provider_status->>'input_fingerprint','engine_version',v_source_run.engine_version,
    'member_revision_id',v_m.id,'learning_run_id',v_learning.id,'normal_report_line_count',v_line_count,
    'normal_report_last_sent_at',v_line_time,'failed_dispatches',v_failed,'open_dead_letters',v_dead,
    'automatic_blocking_checks',v_auto_block,'manual_intervention',v_manual,
    'automatic_stable_day',v_verdict='PASS' and v_phase='FULL_DAY' and cardinality(v_auto_block)=0,
    'content_handoff_evidence_scope','PROJECTION_CONTRACT_ONLY_NOT_DOWNSTREAM_DELIVERY',
    'trial_started',false);
  v_version:=p_evaluator_version||':CORE_V2:'||v_phase||':'||coalesce(v_revision,'none')||':'||md5((v_evidence||jsonb_build_object('blocking',v_block))::text);
  v_key:=p_business_date::text||':'||v_version;
  insert into public.production_acceptance_results(business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence)
    values(p_business_date,v_version,v_key,v_verdict,v_block,v_evidence)
    on conflict(idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.production_acceptance_results where idempotency_key=v_key; end if;
  return v_id;
end; $$;
revoke all on function public.capture_morning_alpha_acceptance_v1(date,text) from public,anon,authenticated;
grant execute on function public.capture_morning_alpha_acceptance_v1(date,text) to service_role;
CREATE OR REPLACE FUNCTION public.reconcile_runtime_http_dispatches_v1(p_limit integer DEFAULT 100)
 RETURNS TABLE(dispatch_id uuid, dispatch_status text, http_status integer, error_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
declare
  v_row record;
  v_retry public.runtime_http_dispatches;
  v_response record;
  v_payload jsonb;
  v_success boolean;
  v_status text;
  v_error text;
  v_state_rank smallint;
begin
  for v_retry in
    select dispatches.*
    from public.runtime_http_dispatches as dispatches
    where dispatches.dispatch_status in ('FAILED', 'TIMED_OUT')
      and dispatches.next_retry_at <= now()
    order by dispatches.next_retry_at
    for update of dispatches skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    if v_retry.retry_count >= v_retry.max_retries
      or (v_retry.deadline_at is not null and v_retry.deadline_at < now())
    then
      update public.runtime_http_dispatches as dispatches
      set dispatch_status = 'DEAD_LETTERED',
          completed_at = now(),
          updated_at = now()
      where dispatches.id = v_retry.id;

      insert into public.runtime_dead_letters (
        component,
        operation,
        idempotency_key,
        correlation_id,
        attempt,
        max_attempts,
        error_code,
        error_message,
        context
      )
      values (
        'runtime_http_dispatch',
        v_retry.job_name,
        v_retry.idempotency_key,
        v_retry.correlation_id,
        v_retry.retry_count + 1,
        v_retry.max_retries + 1,
        coalesce(v_retry.response_error_code, 'HTTP_RETRY_EXHAUSTED'),
        'HTTP retry exhausted or deadline elapsed.',
        jsonb_build_object(
          'dispatch_id', v_retry.id,
          'http_status', v_retry.http_status
        )
      )
      on conflict do nothing;
    else
      perform public.dispatch_morning_alpha_runtime_v1(
        v_retry.trading_date,
        v_retry.job_name,
        v_retry.checkpoint,
        v_retry.request_body,
        true,
        v_retry.deadline_at
      );
    end if;
  end loop;

  for v_row in
    select dispatches.*
    from public.runtime_http_dispatches as dispatches
    where dispatches.dispatch_status in ('DISPATCHED', 'ACKNOWLEDGED')
    order by dispatches.created_at
    for update of dispatches skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    select responses.status_code,
           responses.content,
           responses.timed_out,
           responses.error_msg
    into v_response
    from net._http_response as responses
    where responses.id = v_row.request_id;

    if not found then
      if v_row.lease_expires_at <= now() then
        update public.runtime_http_dispatches as dispatches
        set dispatch_status = 'TIMED_OUT',
            response_error_code = 'HTTP_RECEIPT_TIMEOUT',
            next_retry_at = now() + interval '1 minute',
            updated_at = now()
        where dispatches.id = v_row.id;
      else
        update public.runtime_http_dispatches as dispatches
        set dispatch_status = 'ACKNOWLEDGED',
            acknowledged_at = coalesce(dispatches.acknowledged_at, now()),
            updated_at = now()
        where dispatches.id = v_row.id;
      end if;
      continue;
    end if;

    begin
      v_payload := coalesce(v_response.content, '{}')::jsonb;
    exception
      when others then
        v_payload := jsonb_build_object(
          'raw_response',
          left(coalesce(v_response.content, ''), 2000)
        );
    end;

    v_success := v_response.status_code between 200 and 299
      and lower(coalesce(v_payload ->> 'success', v_payload ->> 'ok', 'false')) in ('true', '1');
    v_status := case
      when v_success then 'SUCCEEDED'
      when coalesce(v_response.timed_out, false) then 'TIMED_OUT'
      else 'FAILED'
    end;
    v_error := coalesce(
      v_payload ->> 'error_code',
      v_payload ->> 'error',
      v_response.error_msg,
      case when v_success then null else 'HTTP_BUSINESS_FAILURE' end
    );

    update public.runtime_http_dispatches as dispatches
    set dispatch_status = v_status,
        http_status = v_response.status_code,
        response_success = v_success,
        response_error_code = v_error,
        response_body = v_payload,
        acknowledged_at = coalesce(dispatches.acknowledged_at, now()),
        completed_at = now(),
        next_retry_at = case
          when not v_success
            and (
              coalesce(v_response.timed_out, false)
              or (v_response.status_code in (408, 429, 500, 502, 503, 504)
                or (v_response.status_code=409 and v_error in ('RESEARCH_IN_PROGRESS','RESEARCH_BACKOFF')))
            )
            and dispatches.retry_count < dispatches.max_retries
          then now() + make_interval(
            secs => least(900, 30 * power(2, dispatches.retry_count)::integer)
          )
        end,
        updated_at = now()
    where dispatches.id = v_row.id;

    update public.runtime_http_dispatch_attempts as attempts
    set http_status = v_response.status_code,
        response_error_code = v_error,
        response_body = v_payload,
        completed_at = now()
    where attempts.dispatch_id = v_row.id
      and attempts.request_id = v_row.request_id;

    if v_success and v_row.job_name = 'closing_health' then
      select states.state_rank
      into v_state_rank
      from public.trading_day_state as states
      where states.trading_date = v_row.trading_date;

      if coalesce(v_state_rank, 0) >= 130 then
        perform public.advance_trading_day_state_v1(
          v_row.trading_date,
          'HEALTH_AUDITED',
          'closing_health',
          'SUCCEEDED',
          v_row.correlation_id,
          jsonb_build_object(
            'http_dispatch_id', v_row.id,
            'http_status', v_response.status_code
          )
        );
        perform public.advance_trading_day_state_v1(
          v_row.trading_date,
          'DAY_COMPLETED',
          'day_completed',
          'SUCCEEDED',
          v_row.correlation_id,
          jsonb_build_object(
            'http_dispatch_id', v_row.id,
            'http_status', v_response.status_code
          )
        );
      end if;
    end if;

    if not v_success
      and (
        v_response.status_code in (401, 403)
        or (
          v_response.status_code between 400 and 499
          and v_response.status_code not in (409, 429)
        )
        or v_row.retry_count >= v_row.max_retries
      )
    then
      update public.runtime_http_dispatches as dispatches
      set dispatch_status = 'DEAD_LETTERED',
          completed_at = now(),
          updated_at = now()
      where dispatches.id = v_row.id;

      insert into public.runtime_dead_letters (
        component,
        operation,
        idempotency_key,
        correlation_id,
        attempt,
        max_attempts,
        error_code,
        error_message,
        context
      )
      values (
        'runtime_http_dispatch',
        v_row.job_name,
        v_row.idempotency_key,
        v_row.correlation_id,
        v_row.retry_count + 1,
        v_row.max_retries + 1,
        coalesce(v_error, 'HTTP_BUSINESS_FAILURE'),
        'Final HTTP receipt failed.',
        jsonb_build_object(
          'dispatch_id', v_row.id,
          'trading_date', v_row.trading_date,
          'http_status', v_response.status_code
        )
      )
      on conflict do nothing;
      v_status := 'DEAD_LETTERED';
    end if;

    dispatch_id := v_row.id;
    dispatch_status := v_status;
    http_status := v_response.status_code;
    error_code := v_error;
    return next;
  end loop;
end;
$function$;
revoke all on function public.reconcile_runtime_http_dispatches_v1(integer) from public,anon,authenticated;
grant execute on function public.reconcile_runtime_http_dispatches_v1(integer) to service_role;
commit;
