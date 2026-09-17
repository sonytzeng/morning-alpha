-- Additive, future-only orchestration. No snapshot, report, recommendation,
-- acceptance, subscriber, or historical market row is created here.
-- The function is intentionally inert for the preserved 2026-09-17 failure.
create or replace function public.invoke_premarket_readiness_retry_v1()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := now() at time zone 'Asia/Taipei';
  v_date date := (now() at time zone 'Asia/Taipei')::date;
  v_minutes integer := extract(hour from (now() at time zone 'Asia/Taipei'))::integer * 60
    + extract(minute from (now() at time zone 'Asia/Taipei'))::integer;
  v_slot text := to_char(now() at time zone 'Asia/Taipei', 'HH24MI');
  v_dispatch public.runtime_http_dispatches;
begin
  -- 07:40–08:35 every five minutes; 08:45 is the final incident-only tick.
  -- This guard also prevents manual replay of the 9/17 natural failure.
  if v_date <= date '2026-09-17' or extract(isodow from v_local) not between 1 and 5
    or not ((v_minutes between 460 and 515 and v_minutes % 5 = 0) or v_minutes = 525) then
    return null;
  end if;

  -- The extra ticks exist only for a date that actually entered the delayed
  -- Taiwan-provider state. Once a complete delivery succeeds, they stop.
  if not exists (
    select 1 from public.pipeline_runs p
    where p.trading_date = v_date and p.checkpoint = 'PREMARKET'
      and p.provider_status->>'provider_not_ready' = 'true'
  ) and not exists (
    select 1 from public.data_provider_health h
    where h.service_date = v_date and h.provider = 'market_fetch_v10'
      and h.phase = 'premarket' and h.checkpoint = 'premarket'
      and h.last_error_code = 'PROVIDER_DATA_NOT_READY'
  ) then
    return null;
  end if;
  if exists (
    select 1 from public.pipeline_runs p
    where p.trading_date = v_date and p.checkpoint = 'PREMARKET'
      and p.status = 'SUCCEEDED'
      and p.provider_status->>'report_delivery_status' in ('DELIVERED', 'DELIVERED_NO_RECOMMENDATION')
  ) then
    return null;
  end if;

  -- A distinct durable dispatch key per bounded slot avoids relying on the
  -- original watchdog receipt, whose business failure has no HTTP retry.
  select * into v_dispatch from public.dispatch_morning_alpha_runtime_v1(
    v_date, 'daily_delivery', 'premarket_readiness_retry_' || v_slot,
    jsonb_build_object('phase','watchdog','readiness_retry',true), false,
    (v_date + time '08:45') at time zone 'Asia/Taipei'
  );
  return v_dispatch.id;
end;
$$;

revoke all on function public.invoke_premarket_readiness_retry_v1() from public, anon, authenticated;
grant execute on function public.invoke_premarket_readiness_retry_v1() to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'morning-alpha-premarket-readiness-retry-0740') then
    perform cron.schedule('morning-alpha-premarket-readiness-retry-0740',
      '40,45,50,55 23 * * 0-4', 'select public.invoke_premarket_readiness_retry_v1();');
  end if;
  if not exists (select 1 from cron.job where jobname = 'morning-alpha-premarket-readiness-retry-0800') then
    perform cron.schedule('morning-alpha-premarket-readiness-retry-0800',
      '0,5,10,15,20,25,30,35 0 * * 1-5', 'select public.invoke_premarket_readiness_retry_v1();');
  end if;
  if not exists (select 1 from cron.job where jobname = 'morning-alpha-premarket-readiness-final-0845') then
    perform cron.schedule('morning-alpha-premarket-readiness-final-0845',
      '45 0 * * 1-5', 'select public.invoke_premarket_readiness_retry_v1();');
  end if;
end;
$$;
