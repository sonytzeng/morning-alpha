-- Preserve every production checkpoint and expose a monotonic trading-day state machine.

alter table public.market_data_snapshots
  add column if not exists checkpoint text;

update public.market_data_snapshots
set checkpoint = case
  when phase = 'premarket' then 'premarket'
  when phase = 'manual_backfill' then 'manual'
  when phase = 'close' and
    (extract(hour from captured_at at time zone 'Asia/Taipei') * 60
      + extract(minute from captured_at at time zone 'Asia/Taipei')) < 865 then '1410'
  when phase = 'close' then '1430'
  when phase = 'intraday' and
    (extract(hour from captured_at at time zone 'Asia/Taipei') * 60
      + extract(minute from captured_at at time zone 'Asia/Taipei')) < 555 then '0900'
  when phase = 'intraday' and
    (extract(hour from captured_at at time zone 'Asia/Taipei') * 60
      + extract(minute from captured_at at time zone 'Asia/Taipei')) < 600 then '0930'
  when phase = 'intraday' and
    (extract(hour from captured_at at time zone 'Asia/Taipei') * 60
      + extract(minute from captured_at at time zone 'Asia/Taipei')) < 705 then '1030'
  else '1300'
end
where checkpoint is null;

alter table public.market_data_snapshots
  alter column checkpoint set not null;

alter table public.market_data_snapshots
  drop constraint if exists market_data_snapshots_checkpoint_check;

alter table public.market_data_snapshots
  add constraint market_data_snapshots_checkpoint_check
  check (checkpoint in ('premarket', '0900', '0930', '1030', '1300', '1410', '1430', 'manual'));

drop index if exists public.idx_market_data_snapshots_symbol_date_phase;

create unique index if not exists market_data_snapshots_symbol_date_checkpoint_uidx
  on public.market_data_snapshots (symbol, trading_date, phase, checkpoint);

create index if not exists market_data_snapshots_checkpoint_lookup_idx
  on public.market_data_snapshots (trading_date desc, phase, checkpoint, captured_at desc);

alter table public.data_provider_health
  add column if not exists checkpoint text;

update public.data_provider_health
set checkpoint = case
  when phase = 'premarket' then 'premarket'
  when phase = 'manual_backfill' then 'manual'
  when phase = 'close' then '1430'
  else '1300'
end
where checkpoint is null;

alter table public.data_provider_health
  alter column checkpoint set not null;

alter table public.data_provider_health
  drop constraint if exists data_provider_health_provider_service_date_phase_key;

create unique index if not exists data_provider_health_service_checkpoint_uidx
  on public.data_provider_health (provider, service_date, phase, checkpoint);

create table if not exists public.trading_day_state (
  trading_date date primary key,
  current_state text not null,
  state_rank smallint not null check (state_rank between 0 and 90),
  checkpoint_status jsonb not null default '{}'::jsonb
    check (jsonb_typeof(checkpoint_status) = 'object'),
  last_correlation_id uuid,
  last_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(last_metadata) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trading_day_state enable row level security;
alter table public.trading_day_state force row level security;
revoke all on table public.trading_day_state from public, anon, authenticated;
grant all on table public.trading_day_state to service_role;

create or replace function public.advance_trading_day_state_v1(
  p_trading_date date,
  p_state text,
  p_checkpoint text,
  p_status text default 'SUCCEEDED',
  p_correlation_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.trading_day_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state_rank smallint;
  v_status_rank smallint;
  v_existing_status_rank smallint;
  v_result public.trading_day_state;
begin
  if p_trading_date is null then
    raise exception 'trading_date_required';
  end if;
  if coalesce(trim(p_checkpoint), '') = '' then
    raise exception 'checkpoint_required';
  end if;

  v_state_rank := case p_state
    when 'PREMARKET_CAPTURED' then 10
    when 'MARKET_OPEN_CAPTURED' then 20
    when 'CHECKPOINT_0930_CAPTURED' then 30
    when 'CHECKPOINT_1030_CAPTURED' then 40
    when 'CHECKPOINT_1300_CAPTURED' then 50
    when 'CLOSE_1410_CAPTURED' then 60
    when 'CLOSE_1430_CAPTURED' then 70
    when 'CLOSING_VERIFIED' then 80
    when 'LEARNING_COMPLETED' then 90
    when 'MANUAL_CAPTURED' then 0
    else null
  end;
  if v_state_rank is null then
    raise exception 'invalid_trading_day_state:%', p_state;
  end if;

  v_status_rank := case upper(coalesce(p_status, ''))
    when 'FAILED' then 0
    when 'DEGRADED' then 1
    when 'RUNNING' then 2
    when 'SUCCEEDED' then 3
    else null
  end;
  if v_status_rank is null then
    raise exception 'invalid_checkpoint_status:%', p_status;
  end if;

  select case upper(coalesce(checkpoint_status -> p_checkpoint ->> 'status', ''))
    when 'FAILED' then 0 when 'DEGRADED' then 1 when 'RUNNING' then 2 when 'SUCCEEDED' then 3 else -1 end
  into v_existing_status_rank
  from public.trading_day_state
  where trading_date = p_trading_date
  for update;

  insert into public.trading_day_state (
    trading_date, current_state, state_rank, checkpoint_status,
    last_correlation_id, last_metadata, completed_at
  ) values (
    p_trading_date,
    p_state,
    v_state_rank,
    jsonb_build_object(p_checkpoint, jsonb_build_object(
      'status', upper(p_status),
      'state', p_state,
      'updated_at', now(),
      'correlation_id', p_correlation_id,
      'metadata', coalesce(p_metadata, '{}'::jsonb)
    )),
    p_correlation_id,
    coalesce(p_metadata, '{}'::jsonb),
    case when v_state_rank >= 80 then now() else null end
  )
  on conflict (trading_date) do update set
    current_state = case
      when excluded.state_rank >= trading_day_state.state_rank
        then excluded.current_state else trading_day_state.current_state end,
    state_rank = greatest(trading_day_state.state_rank, excluded.state_rank),
    checkpoint_status = case
      when v_status_rank >= coalesce(v_existing_status_rank, -1)
        then trading_day_state.checkpoint_status || excluded.checkpoint_status
        else trading_day_state.checkpoint_status end,
    last_correlation_id = coalesce(excluded.last_correlation_id, trading_day_state.last_correlation_id),
    last_metadata = excluded.last_metadata,
    completed_at = case
      when greatest(trading_day_state.state_rank, excluded.state_rank) >= 80
        then coalesce(trading_day_state.completed_at, now())
      else null end,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.advance_trading_day_state_v1(date, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.advance_trading_day_state_v1(date, text, text, text, uuid, jsonb)
  to service_role;
;
