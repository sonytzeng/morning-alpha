-- Candidate only: Sony approval is still required before Production execution.
-- Six-Bug Preventive Closure. One additive migration; no business backfill,
-- no Cron change, no function rename, no historical migration/hash replacement.
begin;

create or replace function public.authoritative_market_calendar_v1()
returns jsonb language sql immutable set search_path = '' as $calendar$
  select $json${"version":"OFFICIAL_MARKET_CALENDAR_20260930_V1","sources":{"TW2025":"https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json&date=20250101","TW2026":"https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html","US2026":"https://www.nasdaq.com/market-activity/stock-market-holiday-schedule","US2025December":"https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2025-99"},"TW":{"from":"2025-01-01","through":"2026-12-31","closed":["2025-01-01","2025-01-23","2025-01-24","2025-01-27","2025-01-28","2025-01-29","2025-01-30","2025-01-31","2025-02-28","2025-04-03","2025-04-04","2025-05-01","2025-05-30","2025-05-31","2025-09-28","2025-09-29","2025-10-06","2025-10-10","2025-10-24","2025-10-25","2025-12-25","2026-01-01","2026-02-12","2026-02-13","2026-02-15","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-02-27","2026-02-28","2026-04-03","2026-04-04","2026-04-05","2026-04-06","2026-05-01","2026-06-19","2026-09-25","2026-09-28","2026-10-09","2026-10-10","2026-10-25","2026-10-26","2026-12-25"],"preserved_exceptional_closures":["2026-07-10"]},"US":{"from":"2025-12-01","through":"2026-12-31","closed":["2025-12-25","2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25"],"early_close":["2025-12-24","2026-11-27","2026-12-24"]},"global8_source_symbols":{"SPX":"SPY","IXIC":"QQQ","SOX":"SOXX","NVDA":"NVDA","TSM":"TSM","VIX":"VXX","DXY":"UUP","US10Y":"IEF"}}$json$::jsonb;
$calendar$;
revoke all on function public.authoritative_market_calendar_v1() from public, anon, authenticated;
grant execute on function public.authoritative_market_calendar_v1() to service_role;

create or replace function public.market_calendar_session_v1(p_market text, p_date date)
returns boolean language sql immutable set search_path = '' as $calendar$
  select coalesce(p_date between (c->>'from')::date and (c->>'through')::date
    and extract(isodow from p_date) between 1 and 5
    and not (c->'closed' ? p_date::text)
    and not (coalesce(c->'preserved_exceptional_closures','[]'::jsonb) ? p_date::text), false)
  from (select public.authoritative_market_calendar_v1()->p_market as c) calendar;
$calendar$;
revoke all on function public.market_calendar_session_v1(text,date) from public, anon, authenticated;
grant execute on function public.market_calendar_session_v1(text,date) to service_role;

create or replace function public.previous_market_session_v1(p_market text, p_date date)
returns date language plpgsql immutable set search_path = '' as $calendar$
declare v_date date; v_calendar jsonb := public.authoritative_market_calendar_v1()->p_market;
begin
  for i in 1..30 loop
    v_date := p_date - i;
    if v_date < (v_calendar->>'from')::date or v_date > (v_calendar->>'through')::date then return null; end if;
    if public.market_calendar_session_v1(p_market,v_date) then return v_date; end if;
  end loop;
  return null;
end;
$calendar$;
revoke all on function public.previous_market_session_v1(text,date) from public, anon, authenticated;
grant execute on function public.previous_market_session_v1(text,date) to service_role;

create or replace function public.latest_completed_us_session_v1(p_at timestamptz)
returns date language plpgsql immutable set search_path = '' as $calendar$
declare v_local timestamp := p_at at time zone 'America/New_York';
  v_date date := v_local::date; v_calendar jsonb := public.authoritative_market_calendar_v1()->'US';
  v_close time := case when v_calendar->'early_close' ? v_date::text then time '13:00' else time '16:00' end;
begin
  if v_date < (v_calendar->>'from')::date or v_date > (v_calendar->>'through')::date then return null; end if;
  if public.market_calendar_session_v1('US',v_date) and v_local::time >= v_close then return v_date; end if;
  return public.previous_market_session_v1('US',v_date);
end;
$calendar$;
revoke all on function public.latest_completed_us_session_v1(timestamptz) from public, anon, authenticated;
grant execute on function public.latest_completed_us_session_v1(timestamptz) to service_role;

create or replace function public.global8_session_valid_v1(p_key text,p_symbol text,p_source timestamptz,p_observed timestamptz)
returns boolean language sql immutable set search_path = '' as $calendar$
  select coalesce(
    public.authoritative_market_calendar_v1()->'global8_source_symbols'->>p_key = p_symbol
    and p_source <= p_observed and p_source >= p_observed - interval '7 days'
    and (p_source at time zone 'America/New_York')::date = public.latest_completed_us_session_v1(p_observed)
    and (p_source at time zone 'America/New_York')::time >= case
      when public.authoritative_market_calendar_v1()->'US'->'early_close' ? (p_source at time zone 'America/New_York')::date::text
      then time '13:00' else time '16:00' end, false);
$calendar$;
revoke all on function public.global8_session_valid_v1(text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.global8_session_valid_v1(text,text,timestamptz,timestamptz) to service_role;

-- Exact predecessor guards retain all 0-or-11, time, correlation and session
-- predicates; only the independently proven calendar/global8/retry defects move.
do $transition$
declare v_before text; v_after text;
begin
  select pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure) into v_before;
  if md5(v_before) <> '8b73a0da9bdb1da57102f2d75da67f9c' then
    raise exception 'SIX_BUG_ATOMIC_PREDECESSOR_MISMATCH:%', md5(v_before);
  end if;
  v_after := replace(v_before, $old$    v_txf_expected_session_date := p_business_date - 1;
    while extract(isodow from v_txf_expected_session_date) in (6, 7)
      or v_txf_expected_session_date = any(array[
        date '2026-01-01', date '2026-02-16', date '2026-02-17', date '2026-02-18',
        date '2026-02-19', date '2026-02-20', date '2026-02-27', date '2026-04-03',
        date '2026-04-06', date '2026-06-19', date '2026-07-10', date '2026-09-25',
        date '2026-10-09'
      ])
    loop
      v_txf_expected_session_date := v_txf_expected_session_date - 1;
    end loop;$old$,
    $new$    v_txf_expected_session_date := public.previous_market_session_v1('TW',p_business_date);$new$);
  if v_after = v_before then raise exception 'SIX_BUG_CALENDAR_REPLACEMENT_MISSING'; end if;
  v_before := v_after;
  v_after := replace(v_before, $old$      or (row_value->'raw'->>'market' = 'TW' and ($old$, $new$      or (row_value->>'provider_key' in ('SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y') and not
        public.global8_session_valid_v1(row_value->>'provider_key', row_value->'raw'->>'source_symbol',
          (row_value->>'source_timestamp')::timestamptz, (row_value->>'captured_at')::timestamptz))
      or (row_value->'raw'->>'market' = 'TW' and ($new$);
  if v_after = v_before then raise exception 'SIX_BUG_GLOBAL8_REPLACEMENT_MISSING'; end if;
  execute v_after;

  select pg_get_functiondef('public.invoke_premarket_readiness_retry_v1()'::regprocedure) into v_before;
  if md5(v_before) <> 'df9266768b6463755e9d90013adc0f60' then
    raise exception 'SIX_BUG_RETRY_PREDECESSOR_MISMATCH:%', md5(v_before);
  end if;
  v_after := replace(v_before, $old$  if not exists (
    select 1 from public.pipeline_runs p
    where p.trading_date = v_date and p.checkpoint = 'PREMARKET'
      and p.provider_status->>'provider_not_ready' = 'true'
  ) and not exists (
    select 1 from public.data_provider_health h
    where h.service_date = v_date and h.provider = 'market_fetch_v10'
      and h.phase = 'premarket' and h.checkpoint = 'premarket'
      and h.last_error_code = 'PROVIDER_DATA_NOT_READY'
  ) then
    return null;
  end if;$old$, $new$  if not exists (
    select 1 from public.data_provider_health h
    where h.service_date = v_date and h.provider = 'market_fetch_v10'
      and h.phase = 'premarket' and h.checkpoint = 'premarket'
      and ((h.details->>'provider_readiness_state' = 'WAITING_FOR_PROVIDER_DATA'
        and (h.details->>'retry_entry_state' = 'WAITING_FOR_PROVIDER_DATA'
          or h.last_error_code = 'PROVIDER_DATA_NOT_READY'))
        or (h.details->>'atomic_checkpoint_complete' = 'true' and exists (
          select 1 from public.pipeline_runs p where p.trading_date=v_date
            and p.checkpoint='PREMARKET' and p.provider_status->>'provider_delay_context'='true'
            and p.status in ('DEGRADED','FAILED')
        )))
  ) then
    return null;
  end if;$new$);
  if v_after = v_before then raise exception 'SIX_BUG_RETRY_REPLACEMENT_MISSING'; end if;
  execute v_after;
end;
$transition$;

-- Append-only, private contract inputs. No historical business row is copied
-- by this migration. Only future natural invocations may append capsules.
create table if not exists public.production_critical_contract_evidence (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  stage text not null check (stage in ('RESEARCH','PUBLICATION','OPENING','CLOSING','LEARNING','LIFECYCLE','ACCEPTANCE')),
  capsule jsonb not null check (jsonb_typeof(capsule)='object' and pg_column_size(capsule)<=1048576),
  recorded_at timestamptz not null default now(),
  retention_until timestamptz not null default (now()+interval '90 days'),
  constraint critical_contract_retention_exact check(retention_until=recorded_at+interval '90 days')
);
create index if not exists critical_contract_business_stage_v1
  on public.production_critical_contract_evidence(business_date,stage,recorded_at);
create index if not exists critical_contract_retention_v1
  on public.production_critical_contract_evidence(retention_until,id);
alter table public.production_critical_contract_evidence enable row level security;
alter table public.production_critical_contract_evidence force row level security;
revoke all on table public.production_critical_contract_evidence from public,anon,authenticated,service_role;
grant select on table public.production_critical_contract_evidence to service_role;

create or replace function public.critical_contract_capsule_safe_v1(p_value jsonb,p_depth integer default 0)
returns boolean language plpgsql immutable set search_path='' as $safe$
declare v_key text; v_value jsonb; v_text text;
begin
  if p_depth>24 or pg_column_size(p_value)>1048576 then return false; end if;
  if jsonb_typeof(p_value)='object' then
    for v_key,v_value in select key,value from jsonb_each(p_value) loop
      if v_key ~* '(authorization|cookie|password|secret|api.?key|service.?role|recipient|subscriber|email|phone|profile|access.?token|refresh.?token)'
        or not public.critical_contract_capsule_safe_v1(v_value,p_depth+1) then return false; end if;
    end loop;
  elsif jsonb_typeof(p_value)='array' then
    if jsonb_array_length(p_value)>10000 then return false; end if;
    for v_value in select value from jsonb_array_elements(p_value) loop
      if not public.critical_contract_capsule_safe_v1(v_value,p_depth+1) then return false; end if;
    end loop;
  elsif jsonb_typeof(p_value)='string' then
    v_text:=p_value#>>'{}';
    if length(v_text)>512 or v_text ~* '(bearer[[:space:]]|https?://|@|eyJ[a-zA-Z0-9_-]+\.)' then return false; end if;
  end if;
  return true;
end;
$safe$;
revoke all on function public.critical_contract_capsule_safe_v1(jsonb,integer) from public,anon,authenticated;
grant execute on function public.critical_contract_capsule_safe_v1(jsonb,integer) to service_role;

create or replace function public.record_critical_contract_evidence_v1(p_business_date date,p_stage text,p_capsule jsonb)
returns uuid language plpgsql security definer set search_path='' as $record$
declare v_id uuid;
begin
  if p_business_date is null or p_stage not in ('RESEARCH','PUBLICATION','OPENING','CLOSING','LEARNING','LIFECYCLE','ACCEPTANCE')
    or p_capsule->>'contract_version' is distinct from 'CRITICAL_CONTRACT_REPLAY_V1'
    or not public.critical_contract_capsule_safe_v1(p_capsule) then return null; end if;
  insert into public.production_critical_contract_evidence(business_date,stage,capsule)
    values(p_business_date,p_stage,p_capsule) returning id into v_id;
  return v_id;
exception when others then
  -- No business contract consults this result. Deliberately no raw SQL error
  -- or payload in logs; storage failure cannot reject a business transition.
  return null;
end;
$record$;
revoke all on function public.record_critical_contract_evidence_v1(date,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_critical_contract_evidence_v1(date,text,jsonb) to service_role;

drop trigger if exists critical_contract_append_only_v1 on public.production_critical_contract_evidence;
create trigger critical_contract_append_only_v1 before update or delete on public.production_critical_contract_evidence
  for each row execute function public.reject_production_provider_evidence_mutation_v1();

create or replace function public.cleanup_expired_critical_contract_evidence_v1(p_limit integer default 1000)
returns integer language plpgsql security definer set search_path='' as $cleanup$
declare v_deleted integer;
begin
  perform set_config('morning_alpha.evidence_retention_cleanup','v1',true);
  with expired as (
    select id from public.production_critical_contract_evidence
    where retention_until<=now() and recorded_at<=now()-interval '90 days'
    order by retention_until,id limit greatest(1,least(coalesce(p_limit,1000),5000)) for update skip locked
  ) delete from public.production_critical_contract_evidence e using expired where e.id=expired.id;
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$cleanup$;
revoke all on function public.cleanup_expired_critical_contract_evidence_v1(integer) from public,anon,authenticated;
grant execute on function public.cleanup_expired_critical_contract_evidence_v1(integer) to service_role;

-- Fixed-field projection for SQL replay. Prose is reduced to a stable digest
-- (the validators only require nonempty/equal text). No member identity,
-- subscriber identifier, HTTP request, credential, or free-form log is read.
create or replace function public.project_critical_sql_input_v1(p_value jsonb,p_depth integer default 0)
returns jsonb language plpgsql immutable set search_path='' as $projection$
declare v_out jsonb; v_key text; v_value jsonb; v_text text;
 v_keys constant text[]:=string_to_array('id report_date business_date trading_date today_date timezone data_as_of provenance generated_at quality publish_status evidence_coverage unsupported_claims duplicate_claims contradictions missing_sections coverage_audit contract_version denominator numerator claims claim_id statement text executive_summary scope supported evidence_ids reason_codes sources evidence_id source source_date freshness sections representative_stocks ai_strategy_json revision_id canonical_member_revision_id market_publication_contract schema_version status opening_publication_revision_id publication_run_id snapshot_version report_id session_type version decision_mode source_refs generated_text canonical_market_state document market_bias market_regime recommendations symbol stock_symbol code valid_from completed_at idempotency_key provider_status result success decision_snapshot_id recommended_symbols predicted_at opening_decision_snapshot_id opening_decision_snapshot_version verified_at data_status actual_taiex_close actual_2330_close actual_txf_close value change_percent captured_at phase actual_direction hit_or_miss beneficiary_list_validation items close_change_percent predicted_beneficiary_stocks evidence_fingerprint source_freshness coverage_score data_source table no_fake_data closing_verification_v2 closing_snapshot_id market_close stock_evaluation predictions outcomes prediction_scope record_status data_quality_status prediction_id horizon target_date return_percent direction_correct evaluated_at source_timestamp source_at raw returned_date market_reason_codes stock_reason_codes evidence_ready market_evaluation direction research_master_v2 is_trading_day action canonical_action data_quality content_score market_report_gate report_status eligible recommendation_gate universe_evaluation_complete screening rejected universe_count evaluated_count opportunity_score stock_opportunities stock_research daily_sentence canonical_contract snapshot_id data_quality_status primary_symbols member_content today_core_thesis line_summary beneficiary_candidates conflicting_fields checked_at research_session_id created_at decision_snapshot_version member_content_revision_id canonical_snapshot_id canonical_snapshot_version manifest missing_sources market_count news_count sector_count trigger engine_version input_fingerprint review_status push_type sent_at group_index check_type details_json current_state state_rank checkpoint_status checkpoint metadata required_core_complete canonical_complete core_batch_complete run_id learning_contract closing_contract checkpoint_run_id batch_id market_session expected_provider_count committed_provider_count committed_at correlation_id correlation source_symbol provider_key contract proof batch_hash batch_revision freshness_status checkpoint source_rows atomic_batch_id atomic_idempotency_key atomic_checkpoint_complete closing_verification_status closing_decision_snapshot_id http_dispatch_id output_fingerprint completed source requested_at updated_at run_date analysis_window revision prediction_at job_name dispatch_status response_success response_error_code response_body pipeline_run_id http_status context dispatch_id before_json after_json request_payload response active premium_publish_min p_trading_date p_state p_checkpoint p_status p_correlation_id p_metadata p_business_date p_evaluator_version',' ');
begin
 if p_depth>24 then raise exception 'CRITICAL_SQL_PROJECTION_DEPTH'; end if;
 if jsonb_typeof(p_value)='object' then
   v_out:='{}';
   for v_key,v_value in select key,value from jsonb_each(p_value) loop
     -- checkpoint_status uses a finite checkpoint-name dictionary.
     if v_key='raw' then
       -- Atomic hashes cover this exact immutable, already-sanitized market
       -- object. Never drop fields/rewrite values and then claim hash parity.
       if not public.critical_contract_capsule_safe_v1(v_value) then raise exception 'CRITICAL_MARKET_RAW_UNSAFE'; end if;
       v_out:=v_out||jsonb_build_object(v_key,v_value);
     elsif v_key=any(v_keys) or v_key=any(array['semantic_status','p_report_date','p_ai','p_decision','p_contract','p_member','p_semantic','today_beneficiary_stocks','today_beneficiary_stocks_v10','source_revision','gate_version','content_score_breakdown','severity','run_type','thesis','expected_horizon','target_session','endpoint','incident_key','operation','error_code','max_attempts','attempt','component','target','action_type','policy_version','member_value_min','high_quality_min','publish_min','auto_repair_min','safe_mode_below','abstention_min_confidence','abstention_min_coverage','abstention_min_evidence','daily_ai_call_budget','daily_ai_token_budget','max_recovery_attempts','provider_contract_version','payload_hash','last_correlation_id','last_metadata','premarket','0900','0930','1030','1300','1410','1430','report_generation','editorial_gate','line_delivery','closing_verification','close_market_review','continuous_learning','feedback','closing_health','health_audit','day_completed']) then
       v_out:=v_out||jsonb_build_object(v_key,public.project_critical_sql_input_v1(v_value,p_depth+1));
     end if;
   end loop;
   return v_out;
 elsif jsonb_typeof(p_value)='array' then
   if jsonb_array_length(p_value)>1000 then raise exception 'CRITICAL_SQL_PROJECTION_BOUND'; end if;
   select coalesce(jsonb_agg(public.project_critical_sql_input_v1(value,p_depth+1)),'[]') into v_out from jsonb_array_elements(p_value);
   return v_out;
 elsif jsonb_typeof(p_value)='string' then
   v_text:=p_value#>>'{}';
   if v_text='' or v_text ~ '^[A-Za-z0-9_:./+-]{1,160}$' and v_text !~* '(bearer|cookie|password|secret|token|https?:|eyJ[a-zA-Z0-9_-]+\.)' and v_text !~ '^09[0-9]{8}$' then return p_value; end if;
   -- Hashes cannot be mistaken for timestamps or admitted as real evidence.
   -- Equal text remains equal; blank text remains blank.
   return to_jsonb(case when btrim(v_text)='' then '' else 'REDACTED_'||encode(sha256(convert_to(v_text,'UTF8')),'hex') end);
 end if;
 return p_value;
end;
$projection$;
revoke all on function public.project_critical_sql_input_v1(jsonb,integer) from public,anon,authenticated;
grant execute on function public.project_critical_sql_input_v1(jsonb,integer) to service_role;

create or replace function public.critical_sql_replay_inputs_v1(p_date date)
returns jsonb language plpgsql security definer set search_path='' as $inputs$
declare v_spec record; v_rows jsonb; v_tables jsonb:='{}';
begin
 -- Relation, field set and filters are compile-time constants, not caller SQL.
 for v_spec in select * from (values
 ('reports','id,report_date,ai_strategy_json','report_date=$1'),
 ('trading_day_state','trading_date,current_state,state_rank,checkpoint_status,last_correlation_id,last_metadata,completed_at,created_at,updated_at','trading_date=$1'),
 ('market_checkpoint_batches','batch_id,business_date,checkpoint,market_session,correlation_id,idempotency_key,status,expected_provider_count,committed_provider_count,committed_at,provider_contract_version,payload_hash','business_date=$1'),
 ('market_checkpoint_snapshots','id,trading_date,checkpoint,symbol,provider_key,value,change_percent,source,source_timestamp,captured_at,created_at,correlation_id,batch_id,market_session,idempotency_key,snapshot_version,raw','trading_date=$1'),
 ('market_data_snapshots','id,trading_date,phase,checkpoint,symbol,value,change_percent,source,captured_at,raw','trading_date=$1'),
 ('decision_snapshots','id,idempotency_key,report_id,report_date,session_type,status,version,valid_from,created_at,decision_mode,action,market_regime,coverage_score,content_score,source_refs,source_freshness,generated_text,research_session_id','report_date=$1'),
 ('pipeline_runs','id,trading_date,checkpoint,idempotency_key,status,provider_status,completed_at,engine_version','trading_date=$1'),
 ('member_content_revisions','id,source_revision,revision,idempotency_key,data_quality_status,generated_at,report_id,report_date,decision_snapshot_id,decision_snapshot_version,status,content_score,evidence_coverage,canonical_contract,member_content','report_date=$1'),
 ('semantic_coherence_reviews','id,idempotency_key,gate_version,member_content_revision_id,decision_snapshot_id,report_date,canonical_snapshot_id,canonical_snapshot_version,status,reason_codes,conflicting_fields,checked_at,result','report_date=$1'),
 ('research_sessions','id,idempotency_key,session_type,trading_date,data_as_of','trading_date=$1'),
 ('editorial_reviews','id,research_session_id,content_score_breakdown,decision_snapshot_id,review_status,content_score,reason_codes','decision_snapshot_id in (select id from public.decision_snapshots where report_date=$1)'),
 ('ma_ops_runs','id,severity,check_type,status,details_json,completed_at','details_json->>''target_date''=$1::text'),
 ('content_os_sync_incidents','id,incident_key,business_date,status','business_date=$1'),
 ('learning_runs','id,run_type,engine_version,idempotency_key,run_date,status,completed_at,metadata','run_date=$1'),
 ('learning_predictions','id,thesis,idempotency_key,expected_horizon,direction,report_date,report_id,decision_snapshot_id,prediction_scope,symbol,analysis_window,record_status,data_quality_status,revision,prediction_at','report_date=$1'),
 ('prediction_outcomes','id,target_session,prediction_id,horizon,target_date,status,data_quality_status,return_percent,direction_correct,evaluated_at,source_refs','target_date=$1'),
 ('runtime_http_dispatches','id,endpoint,idempotency_key,trading_date,job_name,checkpoint,dispatch_status,response_success,response_error_code,response_body,http_status,completed_at','trading_date=$1'),
 ('runtime_dead_letters','id,operation,error_code,max_attempts,attempt,correlation_id,component,idempotency_key,status,context','context->>''trading_date''=$1::text or context->>''dispatch_id'' in (select id::text from public.runtime_http_dispatches where trading_date=$1)'),
 ('ma_ops_recovery_actions','id,idempotency_key,target,action_type,run_id,status,before_json,after_json','run_id in (select id from public.ma_ops_runs where details_json->>''target_date''=$1::text) or before_json->>''report_date''=$1::text or after_json->>''report_date''=$1::text or before_json#>>''{request_payload,report_date}''=$1::text or before_json#>>''{request_payload,target_date}''=$1::text or after_json#>>''{response,report_date}''=$1::text'),
 ('runtime_quality_policies','policy_version,active,premium_publish_min,member_value_min,high_quality_min,publish_min,auto_repair_min,safe_mode_below,abstention_min_confidence,abstention_min_coverage,abstention_min_evidence,daily_ai_call_budget,daily_ai_token_budget,max_recovery_attempts','$1 is not null and active=true')
 ) s(relation_name,columns_sql,filter_sql) loop
   execute format('select coalesce(jsonb_agg(public.project_critical_sql_input_v1(to_jsonb(r))),''[]'') from (select %s from public.%I where %s limit 501) r',v_spec.columns_sql,v_spec.relation_name,v_spec.filter_sql)
     into v_rows using p_date;
   if jsonb_array_length(v_rows)>500 then raise exception 'CRITICAL_SQL_ROW_BOUND'; end if;
   v_tables:=v_tables||jsonb_build_object(v_spec.relation_name,v_rows);
 end loop;
 -- Only a per-capsule ordinal survives; neither recipient nor member identity
 -- leaves the database. Group equality alone is consumed by duplicate checks.
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_rows from (
   select report_date,push_type,status,decision_snapshot_id,sent_at,
     dense_rank() over(order by line_subscriber_id) as group_index
   from public.line_delivery_outbox where report_date=p_date limit 501
 ) r;
 if jsonb_array_length(v_rows)>500 then raise exception 'CRITICAL_SQL_ROW_BOUND'; end if;
 v_tables:=v_tables||jsonb_build_object('line_delivery_outbox',v_rows);
 if pg_column_size(v_tables)>900000 then raise exception 'CRITICAL_SQL_SIZE_BOUND'; end if;
 return jsonb_build_object('tables',v_tables,'observed_at',clock_timestamp(),
   'calendar_version',public.authoritative_market_calendar_v1()->>'version');
end;
$inputs$;
revoke all on function public.critical_sql_replay_inputs_v1(date) from public,anon,authenticated;
grant execute on function public.critical_sql_replay_inputs_v1(date) to service_role;

-- Capture the exact existing Publication validator, not an approximating Edge
-- predicate. Projection must produce the same result before it can be recorded.
-- Free prose is irreversibly hashed; source/date/identity contracts stay exact.
create or replace function public.record_publication_contract_evidence_v1(
 p_report_date date,p_ai jsonb,p_decision jsonb,p_contract jsonb,p_member jsonb,p_semantic jsonb
) returns uuid language plpgsql security definer set search_path='' as $publication$
declare v_args jsonb;v_expected jsonb;v_replay jsonb;v_policy jsonb;
begin
 v_args:=public.project_critical_sql_input_v1(jsonb_build_object('p_report_date',p_report_date,
  'p_ai',p_ai,'p_decision',p_decision,'p_contract',p_contract,'p_member',p_member,'p_semantic',p_semantic));
 v_expected:=public.validate_core_market_publication_v1(p_report_date,p_ai,p_decision,p_contract,p_member,p_semantic);
 v_replay:=public.validate_core_market_publication_v1(p_report_date,v_args->'p_ai',v_args->'p_decision',v_args->'p_contract',v_args->'p_member',v_args->'p_semantic');
 if v_expected is distinct from v_replay then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into v_policy from (
  select policy_version,active,premium_publish_min,member_value_min,high_quality_min,publish_min,
    auto_repair_min,safe_mode_below,abstention_min_confidence,abstention_min_coverage,abstention_min_evidence,
    daily_ai_call_budget,daily_ai_token_budget,max_recovery_attempts
  from public.runtime_quality_policies where active limit 21
 )p;
 if jsonb_array_length(v_policy)>20 then return null;end if;
 return public.record_critical_contract_evidence_v1(p_report_date,'PUBLICATION',jsonb_build_object(
  'contract_version','CRITICAL_CONTRACT_REPLAY_V1','sql_signature','public.validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)',
  'args',v_args,'database_inputs',jsonb_build_object('observed_at',clock_timestamp(),
   'tables',jsonb_build_object('runtime_quality_policies',v_policy)), 'expected',v_expected));
exception when others then return null;
end;
$publication$;
revoke all on function public.record_publication_contract_evidence_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_publication_contract_evidence_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

-- Instrument the exact reviewed SQL bodies, without duplicating their gates.
-- Successful natural calls append in the same transaction. A rejected
-- Lifecycle transaction rolls back, so its bounded capsule is returned only
-- in structured error DETAIL to the internal caller for detached recording.
-- The original error code/message and all business predicates are preserved.
do $observe$
declare v_before text; v_after text;
begin
 select pg_get_functiondef('public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb)'::regprocedure) into v_before;
 if md5(v_before)<>'c0f2f9a050448d6810cfdda614626529' then raise exception 'SIX_BUG_LIFECYCLE_PREDECESSOR_MISMATCH'; end if;
 v_after:=replace(v_before,'declare'||chr(10),$hook$declare
  v_observation jsonb;
  v_observation_state text;
  v_observation_message text;
$hook$);
 v_after:=replace(v_after,$old$  if v_existing_rank is not null and v_state_rank<v_existing_rank then$old$,$hook$
  begin
    v_observation:=jsonb_build_object('contract_version','CRITICAL_CONTRACT_REPLAY_V1',
      'sql_signature','public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb)',
      'predecessor_hash','c0f2f9a050448d6810cfdda614626529',
      'args',public.project_critical_sql_input_v1(jsonb_build_object(
        'p_trading_date',p_trading_date,'p_state',p_state,'p_checkpoint',p_checkpoint,
        'p_status',p_status,'p_correlation_id',p_correlation_id,'p_metadata',p_metadata)),
      'database_inputs',public.critical_sql_replay_inputs_v1(p_trading_date));
  exception when others then v_observation:=null;
  end;
  begin
  if v_existing_rank is not null and v_state_rank<v_existing_rank then$hook$);
 v_after:=replace(v_after,'return v_result;',$hook$if v_observation is not null then
      perform public.record_critical_contract_evidence_v1(p_trading_date,'LIFECYCLE',
        v_observation||jsonb_build_object('expected',public.project_critical_sql_input_v1(to_jsonb(v_result))));
    end if;
    return v_result;$hook$);
 v_after:=replace(v_after,$old$end;
$function$$old$,$hook$  exception when others then
    get stacked diagnostics v_observation_state=returned_sqlstate,v_observation_message=message_text;
    if v_observation is not null and public.critical_contract_capsule_safe_v1(v_observation) then
      raise exception using errcode=v_observation_state,message=v_observation_message,
        detail=jsonb_build_object('critical_contract_capsule',v_observation||jsonb_build_object(
          'expected',jsonb_build_object('sqlstate',v_observation_state,
            'failure_reason',public.project_critical_sql_input_v1(to_jsonb(v_observation_message)))),
          'stage','LIFECYCLE','business_date',p_trading_date)::text;
    end if;
    raise;
  end;
end;
$function$$hook$);
 if v_after=v_before or position('critical_contract_capsule' in v_after)=0 then raise exception 'SIX_BUG_LIFECYCLE_OBSERVER_NOT_INSTALLED'; end if;
 execute v_after;

 select pg_get_functiondef('public.capture_morning_alpha_acceptance_v1(date,text)'::regprocedure) into v_before;
 if md5(v_before)<>'c9c4742a389523fa900f62b20241631f' then raise exception 'SIX_BUG_ACCEPTANCE_PREDECESSOR_MISMATCH'; end if;
 v_after:=replace(v_before,'declare'||chr(10),'declare'||chr(10)||'  v_observation jsonb;'||chr(10));
 v_after:=replace(v_after,$old$  v_version:=p_evaluator_version||$old$,$hook$  begin
    v_observation:=jsonb_build_object(
      'contract_version','CRITICAL_CONTRACT_REPLAY_V1',
      'sql_signature','public.capture_morning_alpha_acceptance_v1(date,text)',
      'predecessor_hash','c9c4742a389523fa900f62b20241631f',
      'args',jsonb_build_object('p_business_date',p_business_date,'p_evaluator_version',p_evaluator_version),
      'database_inputs',public.critical_sql_replay_inputs_v1(p_business_date)||jsonb_build_object('observed_at',v_now));
  exception when others then v_observation:=null;
  end;
  v_version:=p_evaluator_version||$hook$);
 -- The Atomic acceptance trigger can append further rejection codes. Record
 -- the FINAL persisted decision, not the pre-trigger intermediate verdict.
 v_after:=replace(v_after,'  return v_id;',$hook$  if v_observation is not null then
    begin
      perform public.record_critical_contract_evidence_v1(p_business_date,'ACCEPTANCE',
        v_observation||jsonb_build_object('expected',(select jsonb_build_object(
          'verdict',verdict,'blocking_checks',blocking_checks)
          from public.production_acceptance_results where id=v_id)));
    exception when others then null;
    end;
  end if;
  return v_id;$hook$);
 if v_after=v_before then raise exception 'SIX_BUG_ACCEPTANCE_OBSERVER_NOT_INSTALLED'; end if;
 execute v_after;
end;
$observe$;

commit;
