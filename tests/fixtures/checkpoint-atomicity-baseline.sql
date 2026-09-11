-- Fresh PostgreSQL-only fixture for the checkpoint atomicity migration.
-- No Production data, credentials, network extension, or Supabase service.

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$roles$;

create table public.market_checkpoint_snapshots (
  id uuid primary key default gen_random_uuid(),
  checkpoint text not null check (checkpoint ~ '^[A-Z0-9_]{2,40}$'),
  trading_date date not null,
  captured_at timestamptz not null,
  market_session text not null check (market_session in ('premarket','intraday','close','recovery')),
  symbol text not null,
  value numeric not null,
  change_percent numeric,
  source text not null,
  source_timestamp timestamptz not null,
  correlation_id uuid not null,
  snapshot_version bigint generated always as identity unique,
  raw jsonb not null default '{}'::jsonb check (jsonb_typeof(raw) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(correlation_id, checkpoint, symbol)
);

create table public.market_data_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  name text,
  market text,
  value numeric,
  change_percent numeric,
  captured_at timestamptz not null,
  source text,
  phase text not null check (phase in ('premarket','intraday','close','manual_backfill')),
  trading_date date not null,
  raw jsonb,
  created_at timestamptz not null default clock_timestamp(),
  checkpoint text not null
);

create table public.trading_day_state (
  trading_date date primary key,
  current_state text not null,
  state_rank smallint not null,
  checkpoint_status jsonb not null default '{}'::jsonb check (jsonb_typeof(checkpoint_status) = 'object'),
  last_correlation_id uuid,
  last_metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.production_acceptance_results (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  evaluator_version text not null,
  idempotency_key text not null unique,
  verdict text not null check (verdict in ('PASS','FAIL','NOT_DUE')),
  blocking_checks text[] not null default '{}',
  evidence jsonb not null,
  evaluated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  unique(business_date, evaluator_version)
);

alter table public.market_checkpoint_snapshots enable row level security;
alter table public.market_checkpoint_snapshots force row level security;
alter table public.market_data_snapshots enable row level security;
alter table public.market_data_snapshots force row level security;
alter table public.trading_day_state enable row level security;
alter table public.trading_day_state force row level security;
alter table public.production_acceptance_results enable row level security;
alter table public.production_acceptance_results force row level security;

revoke all on table public.market_checkpoint_snapshots, public.market_data_snapshots,
  public.trading_day_state, public.production_acceptance_results from public, anon, authenticated;
grant all on table public.market_checkpoint_snapshots, public.market_data_snapshots,
  public.trading_day_state, public.production_acceptance_results to service_role;
grant usage, select on sequence public.market_checkpoint_snapshots_snapshot_version_seq to service_role;

create or replace function public.reject_immutable_market_checkpoint_mutation_v1()
returns trigger language plpgsql set search_path = '' as $function$
begin
  raise exception 'market_checkpoint_evidence_is_immutable';
end;
$function$;

create trigger reject_market_checkpoint_snapshot_mutation
before update or delete on public.market_checkpoint_snapshots
for each row execute function public.reject_immutable_market_checkpoint_mutation_v1();
