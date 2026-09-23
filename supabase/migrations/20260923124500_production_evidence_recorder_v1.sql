-- Additive, service-role-only, append-only Production provider evidence.
-- This table is an observability sidecar. It is not consulted by any business
-- pipeline gate and contains only sanitized replay inputs.

create table if not exists public.production_provider_evidence (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  checkpoint text not null check (length(checkpoint) between 1 and 64),
  attempt integer not null check (attempt between 1 and 10000),
  transport_attempt integer not null default 1 check (transport_attempt between 1 and 100),
  attempt_key text not null check (length(attempt_key) between 1 and 240),
  provider_key text not null check (length(provider_key) between 1 and 32),
  provider text not null check (length(provider) between 1 and 64),
  symbol text not null check (length(symbol) between 1 and 64),
  endpoint_class text not null check (length(endpoint_class) between 1 and 240),
  provider_envelope_date date,
  evidence_session_date date,
  source_timestamp timestamptz,
  normalized_session text check (normalized_session is null or length(normalized_session) <= 64),
  market_phase text not null check (market_phase in ('premarket', 'intraday', 'close', 'manual_backfill')),
  freshness_result text not null check (length(freshness_result) between 1 and 96),
  contract_result text not null check (contract_result in ('PASS', 'FAIL', 'EXPECTED', 'WAITING')),
  contract_reason text check (contract_reason is null or length(contract_reason) <= 300),
  adapter_version text not null check (length(adapter_version) between 1 and 160),
  contract_version text not null check (length(contract_version) between 1 and 160),
  normalized_evidence jsonb not null default '{}'::jsonb,
  payload_shape jsonb not null default '{}'::jsonb,
  raw_payload_hash text not null check (raw_payload_hash ~ '^[0-9a-f]{64}$'),
  replay_payload jsonb not null default '{}'::jsonb,
  http_status smallint check (http_status is null or http_status between 100 and 599),
  correlation_id uuid not null,
  source_function text not null check (length(source_function) between 1 and 96),
  recorder_version text not null check (length(recorder_version) between 1 and 96),
  retention_until timestamptz not null default (now() + interval '90 days'),
  recorded_at timestamptz not null default now(),
  constraint production_provider_evidence_normalized_object
    check (jsonb_typeof(normalized_evidence) = 'object'),
  constraint production_provider_evidence_shape_object
    check (jsonb_typeof(payload_shape) = 'object'),
  constraint production_provider_evidence_replay_object
    check (jsonb_typeof(replay_payload) = 'object'),
  constraint production_provider_evidence_payload_bound
    check (pg_column_size(normalized_evidence) + pg_column_size(payload_shape) + pg_column_size(replay_payload) <= 131072)
);

comment on table public.production_provider_evidence is
  'Append-only sanitized provider evidence for deterministic incident replay; never a business pipeline dependency.';
comment on column public.production_provider_evidence.raw_payload_hash is
  'SHA-256 of the sanitized provider payload retained in replay_payload; secrets and PII are excluded before hashing.';

create index if not exists production_provider_evidence_business_checkpoint_idx
  on public.production_provider_evidence (business_date, checkpoint, attempt, provider_key, recorded_at);
create index if not exists production_provider_evidence_retention_idx
  on public.production_provider_evidence (retention_until, id);

alter table public.production_provider_evidence enable row level security;
alter table public.production_provider_evidence force row level security;

revoke all on table public.production_provider_evidence from public, anon, authenticated, service_role;
grant select, insert on table public.production_provider_evidence to service_role;

create or replace function public.reject_production_provider_evidence_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
     and current_setting('morning_alpha.evidence_retention_cleanup', true) = 'v1' then
    return old;
  end if;
  raise exception 'PRODUCTION_PROVIDER_EVIDENCE_APPEND_ONLY';
end;
$function$;

revoke all on function public.reject_production_provider_evidence_mutation_v1() from public, anon, authenticated, service_role;

drop trigger if exists production_provider_evidence_append_only_v1
  on public.production_provider_evidence;
create trigger production_provider_evidence_append_only_v1
before update or delete on public.production_provider_evidence
for each row execute function public.reject_production_provider_evidence_mutation_v1();

create or replace function public.cleanup_expired_production_provider_evidence_v1(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1000), 5000));
  v_deleted integer := 0;
begin
  perform set_config('morning_alpha.evidence_retention_cleanup', 'v1', true);
  with expired as (
    select id
    from public.production_provider_evidence
    where retention_until <= now()
      and recorded_at <= now() - interval '90 days'
    order by retention_until, id
    limit v_limit
    for update skip locked
  )
  delete from public.production_provider_evidence evidence
  using expired
  where evidence.id = expired.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

comment on function public.cleanup_expired_production_provider_evidence_v1(integer) is
  'Bounded retention cleanup. It can delete only recorder rows at least 90 days old and never touches business tables.';

revoke all on function public.cleanup_expired_production_provider_evidence_v1(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_production_provider_evidence_v1(integer)
  to service_role;
