-- Owner-only read projection. No evaluation, backfill, policy or business change.
begin;
create function public.get_owner_backend_status_v1() returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '8s' as $$
declare
 v_now timestamptz := statement_timestamp();
 v_day date := (statement_timestamp() at time zone 'Asia/Taipei')::date;
 v_acceptance jsonb; v_history jsonb; v_runtime jsonb; v_report jsonb;
 v_batches jsonb; v_schedule jsonb; v_calendar jsonb; v_sla jsonb;
 v_learning jsonb; v_quality jsonb; v_line jsonb; v_news jsonb;
 v_v2 jsonb; v_metrics jsonb; v_health jsonb; v_stock jsonb; v_forward bigint; v_closing jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_research_owner_v1(),false) then
  raise exception 'RESEARCH_OWNER_REQUIRED' using errcode='42501';
 end if;
 -- Allowlisted metadata only: never return acceptance evidence wholesale.
 select jsonb_build_object('business_date',a.business_date,'verdict',a.verdict,
  'overall_status',a.evidence->>'overall_status','evaluator_version',a.evaluator_version,
  'evaluated_at',a.evaluated_at,'dimensions',a.evidence->'acceptance_dimensions',
  'service_available',a.evidence->'service_available','blocking_checks',a.blocking_checks)
 into v_acceptance from public.production_acceptance_results a
 where a.business_date<=v_day order by a.business_date desc,a.evaluated_at desc limit 1;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.business_date desc),'[]') into v_history from (
  select distinct on (a.business_date) a.business_date,a.verdict,a.evidence->>'overall_status' overall_status,
   a.evidence->'acceptance_dimensions' dimensions,a.blocking_checks,a.evaluated_at
  from public.production_acceptance_results a where a.business_date between v_day-30 and v_day
  order by a.business_date desc,a.evaluated_at desc limit 30
 ) h;
 select jsonb_build_object('business_date',trading_date,'current_state',current_state,
  'report_status',report_status,'decision_status',decision_snapshot_status,'line_status',line_status,
  'closing_status',closing_status,'learning_status',learning_status,'updated_at',updated_at,
  'failed_dispatches',failed_dispatches,'dead_letters',dead_letters)
 into v_runtime from public.morning_alpha_reliability_status_v1 where trading_date=v_day;
 select jsonb_build_object('business_date',r.report_date,'created_at',r.created_at,'id',r.id,
  'publication_status',r.ai_strategy_json#>>'{market_publication_contract,status}',
  'publication_date',r.ai_strategy_json#>>'{market_publication_contract,report_date}',
  'recommendation_status',r.ai_strategy_json#>>'{market_report_gate,recommendation_status}')
 into v_report from public.reports r where r.report_date<=v_day
 order by r.report_date desc,r.created_at desc limit 1;
 -- Only previously saved producer verdicts. Never acquire or recompute evidence.
 with saved as (
  select report_date,ai_strategy_json->'recommendation_stock_evidence' a from public.reports
  where id=(v_report->>'id')::uuid
 ), captures as (
  select report_date,a->'universe_count' universe_count,c.value c from saved,
   lateral jsonb_array_elements(case when jsonb_typeof(a->'captures')='array' then a->'captures' else '[]'::jsonb end) c
  where a->>'contract'='RECOMMENDATION_STOCK_EVIDENCE_V1' and a->>'business_date'=report_date::text
 ) select jsonb_build_object('business_date',min(report_date),'universe',min(universe_count::text)::jsonb,
  'captured_symbols',count(distinct c->>'symbol'),
  'passed_symbols',count(distinct c->>'symbol') filter(where c->>'status'='PASS'),
  'failed_captures',count(*) filter(where c->>'status' is distinct from 'PASS'),
  'historical_20d',count(distinct c->>'symbol') filter(where c->>'status'='PASS' and c->>'endpoint'='historical/candles'
   and jsonb_typeof(c->'rows')='array' and jsonb_array_length(c->'rows')>=20))
 into v_stock from captures having count(*)>0;
 select coalesce(jsonb_agg(to_jsonb(b) order by b.checkpoint),'[]') into v_batches from (
  select checkpoint,status,committed_provider_count,expected_provider_count,committed_at,payload_hash
  from public.market_checkpoint_batches where business_date=v_day order by checkpoint limit 20
 ) b;
 select jsonb_build_object('total',count(*),'sent',count(*) filter(where status='SENT'),
  'failed',count(*) filter(where status in ('FAILED','DEAD_LETTERED')),
  'pending',count(*) filter(where status in ('PENDING','PROCESSING')),'last_sent_at',max(sent_at))
 into v_line from public.line_delivery_outbox where report_date=v_day and push_type='daily_report';
 -- Cron command is intentionally NOT selected (it can contain credentials).
 select coalesce(jsonb_agg(jsonb_build_object('name',jobname,'expression',schedule,'active',active) order by jobname),'[]')
 into v_schedule from cron.job where jobname in (
 'morning-alpha-provider-readiness-0650','morning-alpha-daily-refresh-primary',
 'morning-alpha-daily-generate-primary','morning-alpha-daily-deliver-primary',
 'morning-alpha-daily-deadline-primary','morning-alpha-premarket-readiness-final-0845',
 'morning-alpha-runtime-0900-primary','morning-alpha-runtime-0930-primary','morning-alpha-runtime-1030-primary',
 'morning-alpha-runtime-1300-primary','morning-alpha-runtime-1410-primary','morning-alpha-runtime-1430-primary',
 'morning-alpha-cle-primary','morning-alpha-acceptance-primary');
 select jsonb_agg(jsonb_build_object('date',d::date,'is_trading_day',case when d::date between
  (public.authoritative_market_calendar_v1()#>>'{TW,from}')::date and (public.authoritative_market_calendar_v1()#>>'{TW,through}')::date
  then public.market_calendar_session_v1('TW',d::date) end) order by d)
 into v_calendar from generate_series(v_day::timestamp,(v_day+32)::timestamp,interval '1 day') d;
 select coalesce(jsonb_agg(jsonb_build_object('key',slo_key,'deadline',deadline_taipei,'active',active) order by slo_key),'[]')
 into v_sla from public.runtime_slo_definitions where slo_key in ('premarket_delivery_0730','closing_verification_completion');
 select jsonb_build_object('business_date',run_date,'status',status,'completed_at',completed_at)
 into v_learning from public.learning_runs where run_date=v_day order by created_at desc limit 1;
 -- A 14:30 checkpoint is not a completed close review. Read the saved review.
 select jsonb_build_object('business_date',report_date,'data_quality',data_quality,
  'missing_count',cardinality(missing_data),'has_result',nullif(btrim(verification_result),'') is not null,
  'updated_at',updated_at)
 into v_closing from public.close_market_reviews where report_date=v_day and updated_at<=v_now
 order by updated_at desc limit 1;
 select jsonb_build_object('selected_48h',count(*) filter(where is_selected), 'latest_at',max(published_at))
 into v_news from public.market_news where published_at between v_now-interval '48 hours' and v_now;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.check_date desc),'[]') into v_health from (
  select check_date,health_score from public.system_health_logs
  where check_date between v_day-30 and v_day order by check_date desc,created_at desc limit 10
 ) h;
 -- Market direction only, one valid close outcome per prediction. Never stock win rate.
 with eligible as (
  select distinct on(p.id) p.id,p.report_date,p.direction,o.direction_correct,o.benchmark_return_percent
  from public.learning_predictions p join public.prediction_outcomes o on o.prediction_id=p.id
  where p.report_date between v_day-89 and v_day and p.prediction_scope='market' and p.record_status='valid'
   and o.horizon='close' and o.status='completed' and o.data_quality_status='complete'
   and o.direction_correct is not null and p.prediction_at<o.evaluated_at and o.evaluated_at<=v_now
  order by p.id,o.evaluated_at desc limit 5001
 ), metrics as (
  select w.days,count(e.id) samples,count(distinct e.report_date) independent_days,
   count(e.id) filter(where e.direction_correct) correct,
   (select count(*)>5000 from eligible) truncated
  from (values(30),(90)) w(days) left join eligible e on e.report_date>=v_day-(w.days-1)
  group by w.days
 ) select jsonb_agg(jsonb_build_object('days',days,'samples',samples,'independent_days',independent_days,
  'accuracy',case when samples>0 and not truncated then round(100.0*correct/samples,2) end,
  'truncated',truncated,'benchmark',null) order by days) into v_metrics from metrics;
 -- Projection only. Existing V2 RPC stays authoritative for its own research measures.
 begin
  v_v2:=public.get_owner_recommendation_v2_forward();
  select count(distinct business_date) into v_forward from public.recommendation_shadow_v2_predictions
   where observation_kind='FORWARD' and methodology_version='RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0'
    and business_date<=v_day and locked_at<=v_now;
 exception when others then
  -- An optional research read cannot manufacture success or hide core status.
  v_v2:=jsonb_build_object('read_status','UNAVAILABLE'); v_forward:=null;
 end;
 v_quality:=jsonb_build_object('market_direction',v_metrics,'stock_shadow',jsonb_build_object(
  'read_status',coalesce(v_v2->>'read_status','AVAILABLE'),
  'completed_forward_dates',v_v2->'completed_forward_dates','forward_sample',v_forward,
  'latest_snapshot',jsonb_build_object('business_date',v_v2#>'{history,0,business_date}',
   'counts',v_v2#>'{history,0,counts}','cutoff',v_v2#>'{history,0,cutoff}'),
  'performance',v_v2->'performance_all'));
 return jsonb_build_object('schema_version','OWNER_BACKEND_STATUS_V1','as_of',v_now,'today_date',v_day,
  'timezone','Asia/Taipei','cron_timezone',coalesce(current_setting('cron.timezone',true),'GMT'),
  'calendar',v_calendar,'schedule',v_schedule,'sla',v_sla,'acceptance',v_acceptance,'history',v_history,
  'runtime',v_runtime,'report',v_report,'stock_data',v_stock,'batches',v_batches,'line',v_line,'news',v_news,
  'learning',v_learning,'closing',v_closing,'legacy_health',v_health,'quality',v_quality,'business_writes',0);
end $$;
revoke all on function public.get_owner_backend_status_v1() from public,anon,authenticated,service_role;
grant execute on function public.get_owner_backend_status_v1() to authenticated;
comment on function public.get_owner_backend_status_v1() is
 'Owner-only bounded read model; existing owner truth; no business evaluation or writes; no raw payloads/cron commands/recipients.';
commit;
