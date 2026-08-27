create or replace function public.invoke_continuous_learning_tick_v1()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
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
    raise exception 'morning_alpha_daily_delivery_token is missing';
  end if;

  select net.http_post(
    url := 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-delivery-orchestrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-daily-delivery-token', v_token
    ),
    body := jsonb_build_object(
      'mode', 'continuous_learning',
      'source', 'supabase_cron'
    ),
    timeout_milliseconds := 600000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_continuous_learning_tick_v1() from public, anon, authenticated;
grant execute on function public.invoke_continuous_learning_tick_v1() to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname = 'morning-alpha-continuous-learning-backup'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'morning-alpha-continuous-learning-backup',
    '40,50 6 * * 1-5',
    'select public.invoke_continuous_learning_tick_v1();'
  );
end;
$$;

comment on function public.invoke_continuous_learning_tick_v1() is
  'Independent Supabase Cron watchdog for same-day Continuous Learning after closing verification.';
;
