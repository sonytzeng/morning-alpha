-- Fresh isolated compatibility scaffold: exact consumed column names/types.
-- Not historical Production migrations, not a mock Production acceptance result.
alter table decision_snapshots add column market_regime text,add column action text,add column confidence_score numeric;
alter table learning_predictions add column created_at timestamptz;
create table market_checkpoint_batches(batch_id uuid primary key,business_date date,checkpoint text,market_session text,
  correlation_id uuid,idempotency_key text,provider_contract_version text,status text,expected_provider_count smallint,
  committed_provider_count smallint,payload_hash text,committed_at timestamptz,created_at timestamptz);
create table market_checkpoint_snapshots(id uuid primary key,provider_key text,symbol text,value numeric,change_percent numeric,
  source text,source_timestamp timestamptz,captured_at timestamptz,created_at timestamptz,snapshot_version bigint,
  trading_date date,checkpoint text,market_session text,batch_id uuid,correlation_id uuid,idempotency_key text,raw jsonb);
create table research_sessions(id uuid primary key,trading_date date,created_at timestamptz,generated_at timestamptz,
  missing_sources text[]);
create table isolated_retained_integrity(business_date date,checkpoint text,proof jsonb,primary key(business_date,checkpoint));
-- Retained read-only Production proof, never synthesized from row count. The real
-- row/session validation also runs unchanged through evaluateOperationalCore in JS.
create function market_checkpoint_batch_integrity_v1(p_date date,p_checkpoint text) returns jsonb
language sql stable security invoker set search_path='' as $$ select proof from public.isolated_retained_integrity where business_date=p_date and checkpoint=p_checkpoint $$;
grant select on market_checkpoint_batches,market_checkpoint_snapshots,research_sessions,isolated_retained_integrity to service_role;
