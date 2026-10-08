-- SYNTHETIC EMPTY READ-SCHEMA ONLY. Not a Production snapshot, a full migration
-- replay, or proof of Production Owner enrollment. No business rows are seeded.
-- Applied after research-foundation-dependencies.sql and the actual Phase 1
-- Owner migration. Existing calendar and V2 readers are loaded from real files.
begin;
create schema cron;
create table cron.job(jobid bigint primary key,jobname text,schedule text,active boolean,command text);
create table public.production_acceptance_results(
 id uuid primary key default gen_random_uuid(),business_date date,verdict text,
 evidence jsonb,evaluator_version text,evaluated_at timestamptz,blocking_checks jsonb);
create table public.owner_backend_runtime_fixture(
 trading_date date,current_state text,report_status text,decision_snapshot_status text,
 line_status text,closing_status text,learning_status text,updated_at timestamptz,
 failed_dispatches bigint,dead_letters bigint);
create view public.morning_alpha_reliability_status_v1 with(security_invoker=true) as
 select * from public.owner_backend_runtime_fixture;
create table public.reports(
 id uuid primary key default gen_random_uuid(),report_date date,created_at timestamptz,
 ai_strategy_json jsonb,report_mode text,market_status text,is_trading_day boolean);
create table public.market_checkpoint_batches(
 id uuid primary key default gen_random_uuid(),business_date date,checkpoint text,status text,
 committed_provider_count integer,expected_provider_count integer,committed_at timestamptz,payload_hash text);
create table public.line_delivery_outbox(
 id uuid primary key default gen_random_uuid(),report_date date,push_type text,status text,
 sent_at timestamptz,recipient_id text,payload jsonb);
create table public.runtime_slo_definitions(slo_key text primary key,deadline_taipei time,active boolean);
create table public.learning_runs(id uuid primary key default gen_random_uuid(),run_date date,status text,completed_at timestamptz,created_at timestamptz);
create table public.close_market_reviews(
 id uuid primary key default gen_random_uuid(),report_date date,data_quality text,
 missing_data text[],verification_result text,updated_at timestamptz);
create table public.market_news(id uuid primary key default gen_random_uuid(),is_selected boolean,published_at timestamptz);
create table public.system_health_logs(id uuid primary key default gen_random_uuid(),check_date date,health_score integer,issues jsonb,created_at timestamptz,raw_snapshot jsonb);
alter table public.learning_predictions add column prediction_scope text,add column direction text;
alter table public.prediction_outcomes add column benchmark_return_percent numeric;

-- Minimal relation shapes consumed by the ACTUAL pre-existing V2 read RPCs.
-- Deliberately no store/worker RPCs, scheduler, HTTP extension, or backfill.
create table public.recommendation_shadow_v2_runs(
 id uuid primary key default gen_random_uuid(),business_date date,locked_at timestamptz,
 result jsonb,daily_snapshot jsonb,evaluation_phase text);
create table public.recommendation_shadow_v2_predictions(
 id uuid primary key default gen_random_uuid(),business_date date,symbol text,
 methodology_version text,observation_kind text,locked_at timestamptz,cutoff timestamptz,
 status text,entry jsonb,evaluation_phase text,invalidation jsonb,risk jsonb,confidence numeric,
 confidence_basis text,input_sha256 text,target_horizon jsonb,source_batch_id uuid);
create table public.recommendation_shadow_v2_outcomes(
 prediction_id uuid references public.recommendation_shadow_v2_predictions(id),horizon integer,
 result jsonb,observed_at timestamptz,primary key(prediction_id,horizon));

-- Local-only deny-by-default fixtures. Candidate must not alter this baseline.
do $$ declare r record; begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','cron') and c.relkind='r' loop
  execute format('alter table %I.%I enable row level security',r.nspname,r.relname);
  execute format('revoke all on %I.%I from public,anon,authenticated',r.nspname,r.relname);
 end loop;
end $$;
revoke all on public.morning_alpha_reliability_status_v1 from public,anon,authenticated;
revoke all on schema cron from public,anon,authenticated,service_role;
commit;
