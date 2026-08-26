-- Preserve the first successful evidence for every checkpoint.
-- A later replay may upgrade FAILED/DEGRADED/RUNNING to SUCCEEDED, but an
-- equal-rank replay must not replace the original timestamp or metadata.

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
set search_path = ''
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

  -- Serialize same-day/same-checkpoint writes even when the row does not exist
  -- yet. This closes the insert race that a row-level lock cannot cover.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_trading_date::text || ':' || p_checkpoint, 0)
  );

  select case upper(coalesce(t.checkpoint_status -> p_checkpoint ->> 'status', ''))
    when 'FAILED' then 0
    when 'DEGRADED' then 1
    when 'RUNNING' then 2
    when 'SUCCEEDED' then 3
    else -1
  end
  into v_existing_status_rank
  from public.trading_day_state t
  where t.trading_date = p_trading_date
  for update;

  insert into public.trading_day_state as trading_day_state (
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
      when excluded.state_rank > trading_day_state.state_rank
        then excluded.current_state
      else trading_day_state.current_state
    end,
    state_rank = greatest(trading_day_state.state_rank, excluded.state_rank),
    checkpoint_status = case
      when v_status_rank > coalesce(v_existing_status_rank, -1)
        then trading_day_state.checkpoint_status || excluded.checkpoint_status
      else trading_day_state.checkpoint_status
    end,
    last_correlation_id = case
      when excluded.state_rank > trading_day_state.state_rank
        or (excluded.state_rank = trading_day_state.state_rank
          and v_status_rank > coalesce(v_existing_status_rank, -1))
        then coalesce(excluded.last_correlation_id, trading_day_state.last_correlation_id)
      else trading_day_state.last_correlation_id
    end,
    last_metadata = case
      when excluded.state_rank > trading_day_state.state_rank
        or (excluded.state_rank = trading_day_state.state_rank
          and v_status_rank > coalesce(v_existing_status_rank, -1))
        then excluded.last_metadata
      else trading_day_state.last_metadata
    end,
    completed_at = case
      when greatest(trading_day_state.state_rank, excluded.state_rank) >= 80
        then coalesce(trading_day_state.completed_at, now())
      else null
    end,
    updated_at = case
      when excluded.state_rank > trading_day_state.state_rank
        or (excluded.state_rank = trading_day_state.state_rank
          and v_status_rank > coalesce(v_existing_status_rank, -1))
        then now()
      else trading_day_state.updated_at
    end
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.advance_trading_day_state_v1(date, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.advance_trading_day_state_v1(date, text, text, text, uuid, jsonb)
  to service_role;
