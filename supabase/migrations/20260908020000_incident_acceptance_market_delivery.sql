-- Incident 2026-09-08: append-only observation only; no Recovery/dispatch.
-- Reuses the previously integration-tested CORE_V2 acceptance contract, adds
-- genuine PREMARKET producer provenance and due-only intraday verification.
-- Production original pg_get_functiondef MD5: 1a7ece36a370bf5b6e785e430f2f7c83.
-- Do NOT replay 20260907030607 in Production: its reconciler changes are outside
-- this deployment. Apply this one migration only after live baseline/ACL check.
-- CREATE OR REPLACE retains signature/owner/private grants; no business row edits.
create or replace function public.capture_morning_alpha_acceptance_v1(
  p_business_date date, p_evaluator_version text default 'PRODUCTION_ACCEPTANCE_V3'
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_d public.decision_snapshots; v_r public.reports; v_m public.member_content_revisions;
  v_day public.trading_day_state; v_learning public.learning_runs;
  v_now timestamptz:=clock_timestamp(); v_today date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_phase text; v_verdict text; v_block text[]:='{}'; v_auto_block text[]:='{}';
  v_revision text; v_quality jsonb; v_close jsonb; v_key text; v_field text; v_symbol text; v_quote jsonb;
  v_evidence jsonb; v_id uuid; v_version text; v_line_count bigint; v_failed bigint; v_dead bigint;
  v_manual boolean; v_due_at timestamptz; v_incidents bigint; v_line_time timestamptz; v_source_run public.pipeline_runs;
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
    -- Only natural PREMARKET producer evidence can satisfy this gate; a noon
    -- RECOVERY identity is not an interchangeable substitute.
    foreach v_symbol in array array['TAIEX','2330','TXF','NVDA','TSM','SPX'] loop
      if not exists(select 1 from public.market_checkpoint_snapshots
        where trading_date=p_business_date and checkpoint='PREMARKET' and market_session='premarket'
          and symbol=v_symbol and value is not null and change_percent is not null
          and value::text not in ('NaN','Infinity','-Infinity')
          and change_percent::text not in ('NaN','Infinity','-Infinity')
          and captured_at < (p_business_date::text||'T08:00:00+08:00')::timestamptz
          and source_timestamp<=captured_at and coalesce(source,'')<>''
          and correlation_id::text=v_day.checkpoint_status#>>'{premarket,correlation_id}'
          and raw->>'contract'='FETCH_CHECKPOINT_EVIDENCE_V1')
        then v_block:=array_append(v_block,'PREMARKET_'||v_symbol||'_PRODUCER_EVIDENCE_MISSING'); end if;
    end loop;
    -- Existing deployed checkpoint schedule is preserved. A 5-minute completion
    -- window allows the fetch and dependent radar to finish; time alone is never
    -- successful execution. Not-yet-due nodes remain WAITING.
    foreach v_field in array array['0900','0930','1030','1300','1410','1430'] loop
        v_due_at:=(p_business_date::text||'T'||substr(v_field,1,2)||':'||substr(v_field,3,2)||':00+08:00')::timestamptz+interval '5 minutes';
        if v_now < v_due_at then continue; end if;
        if v_day.checkpoint_status#>>array[v_field,'status'] is distinct from 'SUCCEEDED'
          or v_day.checkpoint_status#>>array[v_field,'updated_at'] is null
          or v_day.checkpoint_status#>array[v_field,'metadata','core_batch_complete'] is distinct from 'true'::jsonb
          then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_UNVERIFIED'); end if;
        foreach v_symbol in array array['TAIEX','2330','TXF'] loop
          if not exists(select 1 from public.market_checkpoint_snapshots where trading_date=p_business_date and checkpoint=v_field
            and market_session=case when v_field in ('1410','1430') then 'close' else 'intraday' end
            and captured_at<=v_now and (captured_at at time zone 'Asia/Taipei')::date=p_business_date
            and symbol=v_symbol and value is not null and change_percent is not null
            and value::text not in ('NaN','Infinity','-Infinity') and change_percent::text not in ('NaN','Infinity','-Infinity')
            and source_timestamp is not null and coalesce(source,'')<>''
            and correlation_id::text=v_day.checkpoint_status#>>array[v_field,'correlation_id'])
            then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_'||v_symbol||'_EVIDENCE_MISSING'); end if;
        end loop;
      end loop;
    if v_phase='FULL_DAY' then
      if v_day.current_state is distinct from 'DAY_COMPLETED' then v_block:=array_append(v_block,'DAY_NOT_COMPLETED'); end if;
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
    -- Reconciliation may terminate a failed dispatch but cannot erase the
    -- incident when counting automatic stable days.
    select count(*) into v_incidents from public.runtime_http_dispatches
      where trading_date=p_business_date and (dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED')
        or (dispatch_status='SKIPPED' and (response_success=false or response_error_code is not null)));
    if v_incidents>0 or exists(select 1 from public.line_delivery_outbox
      where report_date=p_business_date and push_type='data_incident' and status='SENT')
      then v_auto_block:=array_append(v_auto_block,'PRODUCTION_INCIDENT_RECORDED'); end if;
    v_verdict:=case when cardinality(v_block)=0 then 'PASS' else 'FAIL' end;
  end if;
  v_evidence:=jsonb_build_object('phase',v_phase,'canonical_revision_id',v_revision,'input_run_id',v_source_run.id,
    'input_fingerprint',v_source_run.provider_status->>'input_fingerprint','engine_version',v_source_run.engine_version,
    'member_revision_id',v_m.id,'learning_run_id',v_learning.id,'normal_report_line_count',v_line_count,
    'normal_report_last_sent_at',v_line_time,'failed_dispatches',v_failed,'open_dead_letters',v_dead,
    'automatic_blocking_checks',v_auto_block,'manual_intervention',v_manual,
    'automatic_stable_day',v_verdict='PASS' and v_phase='FULL_DAY' and cardinality(v_auto_block)=0,
    'content_handoff_evidence_scope','PROJECTION_CONTRACT_ONLY_NOT_DOWNSTREAM_DELIVERY',
    'trial_started',false,'trading_date',p_business_date,
    'premium_gate_independent',true,
    'market_data_pass',not exists(select 1 from unnest(v_block) b where b like 'SOURCE_%' or b like 'PREMARKET_%_PRODUCER_%'),
    'report_pass',not('CANONICAL_NOT_READY'=any(v_block) or 'REPORT_REVISION_MISMATCH'=any(v_block)),
    'research_pass',not exists(select 1 from unnest(v_block) b where b like 'RESEARCH_%' or b like 'QUALITY_%'),
    'editorial_pass',not('EDITORIAL_NOT_APPROVED'=any(v_block)),
    'semantic_pass',not('PREMIUM_SEMANTIC_NOT_PASSED'=any(v_block)),
    'publication_pass',not('REPORT_REVISION_MISMATCH'=any(v_block) or 'CANONICAL_OUTPUT_DIVERGENCE'=any(v_block)),
    'delivery_pass',not('NORMAL_REPORT_LINE_NOT_COMPLETE'=any(v_block) or 'DUPLICATE_REPORT_DELIVERY'=any(v_block)),
    'checkpoint_pass',not exists(select 1 from unnest(v_block) b where b like 'CHECKPOINT_%'),
    'closing_status',case when v_phase<>'FULL_DAY' then 'WAITING' when exists(select 1 from unnest(v_block) b where b like 'CLOSING_%') then 'FAIL' else 'PASS' end,
    'learning_status',case when v_phase<>'FULL_DAY' then 'WAITING' when 'LEARNING_REVISION_UNVERIFIED'=any(v_block) then 'FAIL' else 'PASS' end,
    'frontend_status','EXTERNAL_SMOKE_REQUIRED',
    'incident_count',coalesce(v_incidents,0)+coalesce(v_dead,0));
  if v_verdict='NOT_DUE' then
    v_evidence:=v_evidence||'{"market_data_pass":null,"report_pass":null,"research_pass":null,"editorial_pass":null,"semantic_pass":null,"publication_pass":null,"delivery_pass":null,"checkpoint_pass":null}'::jsonb;
  end if;
  v_version:=p_evaluator_version||':CORE_V3:'||v_phase||':'||coalesce(v_revision,'none')||':'||md5((v_evidence||jsonb_build_object('blocking',v_block))::text);
  v_key:=p_business_date::text||':'||v_version;
  insert into public.production_acceptance_results(business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence)
    values(p_business_date,v_version,v_key,v_verdict,v_block,v_evidence)
    on conflict(idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.production_acceptance_results where idempotency_key=v_key; end if;
  return v_id;
end; $$;
revoke all on function public.capture_morning_alpha_acceptance_v1(date,text) from public,anon,authenticated;
grant execute on function public.capture_morning_alpha_acceptance_v1(date,text) to service_role;
