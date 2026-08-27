create or replace function public.invoke_runtime_checkpoint_tick_v1(p_checkpoint text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  if p_checkpoint not in ('0900', '0930', '1030', '1300', '1410', '1430') then
    raise exception 'unsupported runtime checkpoint: %', p_checkpoint;
  end if;

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
      'mode', 'runtime_checkpoint',
      'checkpoint', p_checkpoint,
      'source', 'supabase_cron'
    ),
    timeout_milliseconds := 600000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.invoke_runtime_checkpoint_tick_v1(text) from public, anon, authenticated;
grant execute on function public.invoke_runtime_checkpoint_tick_v1(text) to service_role;

do $$
declare
  v_job record;
  v_name text;
  v_schedule text;
  v_checkpoint text;
begin
  for v_name, v_schedule, v_checkpoint in
    select * from (values
      ('morning-alpha-runtime-0900-backup', '0,5 1 * * 1-5', '0900'),
      ('morning-alpha-runtime-0930-backup', '30,35 1 * * 1-5', '0930'),
      ('morning-alpha-runtime-1030-backup', '30,35 2 * * 1-5', '1030'),
      ('morning-alpha-runtime-1300-backup', '0,5 5 * * 1-5', '1300'),
      ('morning-alpha-runtime-1410-backup', '10,15 6 * * 1-5', '1410'),
      ('morning-alpha-runtime-1430-backup', '30,35 6 * * 1-5', '1430')
    ) as jobs(job_name, cron_schedule, checkpoint_name)
  loop
    for v_job in select jobid from cron.job where jobname = v_name loop
      perform cron.unschedule(v_job.jobid);
    end loop;
    perform cron.schedule(
      v_name,
      v_schedule,
      format('select public.invoke_runtime_checkpoint_tick_v1(%L);', v_checkpoint)
    );
  end loop;
end;
$$;

comment on function public.invoke_runtime_checkpoint_tick_v1(text) is
  'Independent Supabase Cron backup for all Morning Alpha intraday and closing checkpoints.';
;
