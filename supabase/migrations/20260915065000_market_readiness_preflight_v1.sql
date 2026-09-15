-- Morning Alpha 06:50 Asia/Taipei read-only provider readiness preflight.
-- The Edge Function performs fresh provider reads and may write only one
-- data_provider_health evidence row. It cannot create snapshots, reports,
-- recommendations, delivery, lifecycle, learning, or acceptance records.

create or replace function public.invoke_market_readiness_preflight_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select decrypted_secret
  into v_token
  from vault.decrypted_secrets
  where name = 'morning_alpha_daily_delivery_token'
  order by created_at desc
  limit 1;

  if v_token is null then
    raise exception 'morning_alpha_daily_delivery_token_missing';
  end if;

  select net.http_post(
    url := 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/market-readiness-preflight',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-daily-delivery-token', v_token
    ),
    body := jsonb_build_object(
      'mode', 'scheduled',
      'source', 'supabase_cron_0650'
    ),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_market_readiness_preflight_v1() from public, anon, authenticated;
grant execute on function public.invoke_market_readiness_preflight_v1() to service_role;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'morning-alpha-provider-readiness-0650'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'morning-alpha-provider-readiness-0650',
    '50 22 * * 0-4',
    'select public.invoke_market_readiness_preflight_v1();'
  );
end;
$$;
