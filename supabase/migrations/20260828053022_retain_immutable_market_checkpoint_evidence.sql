-- Retain checkpoint evidence independently from the mutable operational
-- market_data_snapshots table. Recovery captures are append-only evidence and
-- can never replace the PREMARKET rows bound to a decision snapshot.

create table if not exists public.market_checkpoint_snapshots (
  id uuid primary key default gen_random_uuid(),
  checkpoint text not null
    check (checkpoint ~ '^[A-Z0-9_]{2,40}$'),
  trading_date date not null,
  captured_at timestamptz not null,
  market_session text not null
    check (market_session in ('premarket', 'intraday', 'close', 'recovery')),
  symbol text not null
    check (length(trim(symbol)) between 1 and 40),
  value numeric not null,
  change_percent numeric,
  source text not null
    check (length(trim(source)) between 1 and 120),
  source_timestamp timestamptz not null,
  correlation_id uuid not null,
  snapshot_version bigint generated always as identity,
  raw jsonb not null default '{}'::jsonb
    check (jsonb_typeof(raw) = 'object'),
  created_at timestamptz not null default now(),
  unique (correlation_id, checkpoint, symbol),
  unique (snapshot_version)
);

create index if not exists market_checkpoint_snapshots_lookup_idx
  on public.market_checkpoint_snapshots (
    trading_date desc,
    checkpoint,
    symbol,
    captured_at desc,
    snapshot_version desc
  );

create table if not exists public.decision_snapshot_market_evidence (
  decision_snapshot_id uuid not null
    references public.decision_snapshots(id) on delete restrict,
  market_checkpoint_snapshot_id uuid not null
    references public.market_checkpoint_snapshots(id) on delete restrict,
  evidence_role text not null default 'PREMARKET'
    check (evidence_role = 'PREMARKET'),
  linked_at timestamptz not null default now(),
  primary key (decision_snapshot_id, market_checkpoint_snapshot_id)
);

create index if not exists decision_snapshot_market_evidence_snapshot_idx
  on public.decision_snapshot_market_evidence (market_checkpoint_snapshot_id);

create or replace function public.reject_immutable_market_checkpoint_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'market_checkpoint_evidence_is_immutable';
end;
$$;

drop trigger if exists reject_market_checkpoint_snapshot_mutation
  on public.market_checkpoint_snapshots;
create trigger reject_market_checkpoint_snapshot_mutation
before update or delete on public.market_checkpoint_snapshots
for each row execute function public.reject_immutable_market_checkpoint_mutation_v1();

drop trigger if exists reject_decision_snapshot_market_evidence_mutation
  on public.decision_snapshot_market_evidence;
create trigger reject_decision_snapshot_market_evidence_mutation
before update or delete on public.decision_snapshot_market_evidence
for each row execute function public.reject_immutable_market_checkpoint_mutation_v1();

create or replace function public.bind_decision_snapshot_premarket_evidence_v1(
  p_decision_snapshot_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bound integer := 0;
begin
  if p_decision_snapshot_id is null then
    raise exception 'decision_snapshot_id_required';
  end if;

  insert into public.decision_snapshot_market_evidence (
    decision_snapshot_id,
    market_checkpoint_snapshot_id,
    evidence_role
  )
  select decision.id,
         evidence.id,
         'PREMARKET'
  from public.decision_snapshots as decision
  cross join lateral (
    select distinct on (snapshots.symbol)
           snapshots.id,
           snapshots.symbol
    from public.market_checkpoint_snapshots as snapshots
    where snapshots.trading_date = decision.report_date
      and snapshots.checkpoint = 'PREMARKET'
      and snapshots.market_session = 'premarket'
      and snapshots.captured_at <= coalesce(decision.valid_from, decision.created_at)
    order by snapshots.symbol,
             snapshots.captured_at desc,
             snapshots.snapshot_version desc
  ) as evidence
  where decision.id = p_decision_snapshot_id
    and decision.session_type = 'PREMARKET'
  on conflict do nothing;

  get diagnostics v_bound = row_count;
  return v_bound;
end;
$$;

create or replace function public.bind_inserted_decision_premarket_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.session_type = 'PREMARKET' then
    perform public.bind_decision_snapshot_premarket_evidence_v1(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists bind_inserted_decision_premarket_evidence
  on public.decision_snapshots;
create trigger bind_inserted_decision_premarket_evidence
after insert on public.decision_snapshots
for each row execute function public.bind_inserted_decision_premarket_evidence_v1();

alter table public.market_checkpoint_snapshots enable row level security;
alter table public.market_checkpoint_snapshots force row level security;
alter table public.decision_snapshot_market_evidence enable row level security;
alter table public.decision_snapshot_market_evidence force row level security;

revoke all on table public.market_checkpoint_snapshots,
  public.decision_snapshot_market_evidence
  from public, anon, authenticated;
grant select, insert on table public.market_checkpoint_snapshots,
  public.decision_snapshot_market_evidence
  to service_role;
grant usage, select on sequence public.market_checkpoint_snapshots_snapshot_version_seq
  to service_role;

revoke all on function public.reject_immutable_market_checkpoint_mutation_v1(),
  public.bind_decision_snapshot_premarket_evidence_v1(uuid),
  public.bind_inserted_decision_premarket_evidence_v1()
  from public, anon, authenticated;
grant execute on function public.bind_decision_snapshot_premarket_evidence_v1(uuid)
  to service_role;

comment on table public.market_checkpoint_snapshots is
  'Append-only market checkpoint evidence. PREMARKET and RECOVERY are distinct captures.';
comment on table public.decision_snapshot_market_evidence is
  'Immutable binding from a PREMARKET decision to evidence captured before the decision valid_from.';
