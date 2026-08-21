create table if not exists public.ma_ops_runs (
  id uuid primary key default gen_random_uuid(),
  environment text not null default 'production'
    check (environment in ('production', 'staging', 'development')),
  check_type text not null,
  scheduled_for timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null
    check (status in ('running', 'passed', 'warning', 'failed', 'skipped')),
  severity text not null
    check (severity in ('info', 'warning', 'critical')),
  summary text,
  details_json jsonb not null default '{}'::jsonb,
  recovery_attempted boolean not null default false,
  recovery_result text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ma_ops_runs_created_at_desc
  on public.ma_ops_runs (created_at desc);
create index if not exists idx_ma_ops_runs_scheduled_for_desc
  on public.ma_ops_runs (scheduled_for desc);
create index if not exists idx_ma_ops_runs_status
  on public.ma_ops_runs (status);
create index if not exists idx_ma_ops_runs_severity
  on public.ma_ops_runs (severity);
create index if not exists idx_ma_ops_runs_environment_created_at
  on public.ma_ops_runs (environment, created_at desc);

create table if not exists public.ma_ops_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ma_ops_runs(id) on delete cascade,
  component text not null,
  check_name text not null,
  expected_state jsonb not null default '{}'::jsonb,
  actual_state jsonb not null default '{}'::jsonb,
  status text not null
    check (status in ('passed', 'warning', 'failed', 'skipped')),
  severity text not null
    check (severity in ('info', 'warning', 'critical')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, component, check_name)
);

create index if not exists idx_ma_ops_checks_run_id
  on public.ma_ops_checks (run_id);
create index if not exists idx_ma_ops_checks_component
  on public.ma_ops_checks (component);
create index if not exists idx_ma_ops_checks_status
  on public.ma_ops_checks (status);
create index if not exists idx_ma_ops_checks_checked_at_desc
  on public.ma_ops_checks (checked_at desc);

create table if not exists public.ma_ops_recovery_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ma_ops_runs(id) on delete set null,
  check_id uuid references public.ma_ops_checks(id) on delete set null,
  environment text not null default 'production'
    check (environment in ('production', 'staging', 'development')),
  action_type text not null,
  target text not null,
  idempotency_key text not null,
  approval_required boolean not null default true,
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected', 'not_required')),
  approved_by uuid,
  approved_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, idempotency_key)
);

create table if not exists public.ma_ops_component_registry (
  id uuid primary key default gen_random_uuid(),
  environment text not null default 'production'
    check (environment in ('production', 'staging', 'development')),
  component_key text not null,
  component_name text not null,
  component_type text not null
    check (component_type in ('data', 'report', 'radar', 'war_room', 'line_push', 'verification', 'performance', 'synthetic')),
  enabled boolean not null default true,
  expected_phase text,
  expected_by_time time,
  timezone text not null default 'Asia/Taipei',
  grace_minutes integer not null default 10 check (grace_minutes >= 0),
  stale_after_minutes integer check (stale_after_minutes is null or stale_after_minutes >= 0),
  severity_on_failure text not null default 'warning'
    check (severity_on_failure in ('info', 'warning', 'critical')),
  auto_retry_allowed boolean not null default false,
  max_auto_retries integer not null default 0 check (max_auto_retries >= 0),
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (environment, component_key)
);

create or replace function public.ma_ops_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ma_ops_runs_set_updated_at on public.ma_ops_runs;
create trigger ma_ops_runs_set_updated_at
before update on public.ma_ops_runs
for each row execute function public.ma_ops_set_updated_at();

drop trigger if exists ma_ops_recovery_actions_set_updated_at on public.ma_ops_recovery_actions;
create trigger ma_ops_recovery_actions_set_updated_at
before update on public.ma_ops_recovery_actions
for each row execute function public.ma_ops_set_updated_at();

drop trigger if exists ma_ops_component_registry_set_updated_at on public.ma_ops_component_registry;
create trigger ma_ops_component_registry_set_updated_at
before update on public.ma_ops_component_registry
for each row execute function public.ma_ops_set_updated_at();

alter table public.ma_ops_runs enable row level security;
alter table public.ma_ops_runs force row level security;
alter table public.ma_ops_checks enable row level security;
alter table public.ma_ops_checks force row level security;
alter table public.ma_ops_recovery_actions enable row level security;
alter table public.ma_ops_recovery_actions force row level security;
alter table public.ma_ops_component_registry enable row level security;
alter table public.ma_ops_component_registry force row level security;

revoke all on table public.ma_ops_runs from anon, authenticated;
revoke all on table public.ma_ops_checks from anon, authenticated;
revoke all on table public.ma_ops_recovery_actions from anon, authenticated;
revoke all on table public.ma_ops_component_registry from anon, authenticated;
revoke all on function public.ma_ops_set_updated_at() from public, anon, authenticated;

comment on table public.ma_ops_recovery_actions is
  'P1 audit schema only. No recovery executor, trigger, retry, or scheduler is installed.';
