begin;

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'ma_ops_health_cron_v1'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(48), 'hex'),
      'ma_ops_health_cron_v1',
      'Internal MA-Ops health scheduler credential'
    );
  end if;
end
$$;

create or replace function public.get_ma_ops_health_cron_secret()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'ma_ops_health_cron_v1'
  order by created_at desc
  limit 1
$$;

revoke all on function public.get_ma_ops_health_cron_secret()
  from public, anon, authenticated, service_role;
grant execute on function public.get_ma_ops_health_cron_secret()
  to service_role;

create or replace function public.invoke_ma_ops_health_check_v1(p_check_type text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_request_id bigint;
  v_target_date text;
begin
  if p_check_type not in ('report', 'closing') then
    raise exception 'unsupported MA-Ops health check type';
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'ma_ops_health_cron_v1'
  order by created_at desc
  limit 1;
  if v_secret is null then
    raise exception 'ma_ops_health_cron_v1 is missing';
  end if;

  v_target_date := to_char(clock_timestamp() at time zone 'Asia/Taipei', 'YYYY-MM-DD');
  select net.http_post(
    url := 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/ma-ops-health-check',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
    body := jsonb_build_object(
      'environment','production',
      'check_type',p_check_type,
      'target_date',v_target_date,
      'dry_run',false,
      'request_id','emma-health-' || p_check_type || '-' || v_target_date
    ),
    timeout_milliseconds := 120000
  ) into v_request_id;
  return v_request_id;
end
$$;

revoke all on function public.invoke_ma_ops_health_check_v1(text)
  from public, anon, authenticated, service_role;

select cron.unschedule(jobid)
from cron.job
where jobname in ('morning-alpha-emma-health-report','morning-alpha-emma-health-closing');

select cron.schedule(
  'morning-alpha-emma-health-report',
  '45 0 * * 1-5',
  $cron$select public.invoke_ma_ops_health_check_v1('report');$cron$
);
select cron.schedule(
  'morning-alpha-emma-health-closing',
  '10 7 * * 1-5',
  $cron$select public.invoke_ma_ops_health_check_v1('closing');$cron$
);

commit;
;
