-- Restores the production-applied canonical decision snapshot migration to source control.
-- The statements are idempotent so a new environment and an existing production database
-- converge on the same contract without rewriting historical rows.

create table if not exists public.decision_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  session_type text not null,
  version integer not null default 1 check (version > 0),
  idempotency_key text not null,
  status text not null check (status in ('DRAFT', 'READY', 'PARTIAL', 'INSUFFICIENT_DATA', 'FINAL', 'SUPERSEDED')),
  market_score numeric(5, 2),
  confidence_score numeric(5, 2),
  coverage_score numeric(5, 2),
  action text,
  market_regime text,
  preferred_sectors jsonb not null default '[]'::jsonb,
  watch_sectors jsonb not null default '[]'::jsonb,
  blocked_sectors jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  invalidation_rules jsonb not null default '[]'::jsonb,
  factor_scores jsonb not null default '{}'::jsonb,
  score_delta numeric(5, 2),
  changed_factors jsonb not null default '[]'::jsonb,
  source_freshness jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  generated_text jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null,
  valid_until timestamptz,
  supersedes_id uuid references public.decision_snapshots(id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists decision_snapshots_idempotency_uidx
  on public.decision_snapshots (idempotency_key);
create unique index if not exists decision_snapshots_current_session_uidx
  on public.decision_snapshots (report_date, session_type)
  where is_current;
create index if not exists decision_snapshots_report_created_idx
  on public.decision_snapshots (report_date desc, created_at desc);
create index if not exists decision_snapshots_status_report_idx
  on public.decision_snapshots (status, report_date desc);

alter table public.decision_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'decision_snapshots'
      and policyname = 'decision_snapshots_public_read_current'
  ) then
    create policy decision_snapshots_public_read_current
      on public.decision_snapshots
      for select
      to anon, authenticated
      using (
        is_current = true
        and status in ('READY', 'PARTIAL', 'INSUFFICIENT_DATA', 'FINAL')
      );
  end if;
end;
$$;

grant select on table public.decision_snapshots to anon, authenticated;
grant all on table public.decision_snapshots to service_role;

comment on table public.decision_snapshots is
  'Canonical immutable Morning Alpha decision history. Writes are service-role only.';
