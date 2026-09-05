begin;

do $$
begin
  if has_table_privilege('anon', 'public.alpha_coach_rate_limit_policies', 'select')
    or has_table_privilege('anon', 'public.alpha_coach_rate_limit_counters', 'select')
    or has_table_privilege('authenticated', 'public.alpha_coach_rate_limit_counters', 'select') then
    raise exception 'public client roles must not read limiter state';
  end if;
  if has_function_privilege(
    'anon',
    'public.consume_alpha_coach_rate_limit_v1(uuid,text,timestamptz)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.consume_alpha_coach_rate_limit_v1(uuid,text,timestamptz)',
    'execute'
  ) then
    raise exception 'public client roles must not execute the limiter RPC';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  v_actor_one uuid := '11111111-1111-4111-8111-111111111111';
  v_actor_two uuid := '22222222-2222-4222-8222-222222222222';
  v_actor_three uuid := '55555555-5555-4555-8555-555555555555';
  v_observed_at timestamptz := '2026-09-04 06:30:10+00';
  v_result record;
  v_iteration integer;
begin
  delete from public.alpha_coach_rate_limit_counters
   where actor_id in (v_actor_one, v_actor_two, v_actor_three);

  select * into strict v_result
    from public.consume_alpha_coach_rate_limit_v1(v_actor_one, 'standard', v_observed_at);
  if not v_result.allowed or v_result.minute_count <> 1 or v_result.hour_count <> 1 then
    raise exception 'first request must pass with count 1';
  end if;

  for v_iteration in 2..5 loop
    select * into strict v_result
      from public.consume_alpha_coach_rate_limit_v1(v_actor_one, 'standard', v_observed_at);
    if not v_result.allowed or v_result.minute_count <> v_iteration then
      raise exception 'under-limit request % must pass', v_iteration;
    end if;
  end loop;

  select * into strict v_result
    from public.consume_alpha_coach_rate_limit_v1(v_actor_one, 'standard', v_observed_at);
  if v_result.allowed or v_result.retry_after_seconds <> 60 or v_result.minute_count <> 5 then
    raise exception 'sixth same-minute request must be rate limited without increment';
  end if;

  select * into strict v_result
    from public.consume_alpha_coach_rate_limit_v1(v_actor_two, 'standard', v_observed_at);
  if not v_result.allowed or v_result.minute_count <> 1 or v_result.hour_count <> 1 then
    raise exception 'different actors must not share quota';
  end if;

  select * into strict v_result
    from public.consume_alpha_coach_rate_limit_v1(v_actor_one, 'standard', v_observed_at + interval '1 minute');
  if not v_result.allowed or v_result.minute_count <> 1 or v_result.hour_count <> 6 then
    raise exception 'new minute must reset minute quota while preserving hour quota';
  end if;

  for v_iteration in 1..6 loop
    select * into strict v_result
      from public.consume_alpha_coach_rate_limit_v1(v_actor_two, 'admin', v_observed_at);
    if not v_result.allowed then
      raise exception 'admin policy must have the configured higher allowance';
    end if;
  end loop;

  for v_iteration in 0..29 loop
    select * into strict v_result
      from public.consume_alpha_coach_rate_limit_v1(
        v_actor_three,
        'standard',
        pg_catalog.date_trunc('hour', v_observed_at) + v_iteration * interval '1 minute'
      );
    if not v_result.allowed or v_result.hour_count <> v_iteration + 1 then
      raise exception 'request % must remain under the configured hourly limit', v_iteration + 1;
    end if;
  end loop;

  select * into strict v_result
    from public.consume_alpha_coach_rate_limit_v1(
      v_actor_three,
      'standard',
      pg_catalog.date_trunc('hour', v_observed_at) + interval '30 minutes'
    );
  if v_result.allowed or v_result.hour_count <> 30 or v_result.retry_after_seconds <> 1800 then
    raise exception 'thirty-first same-hour request must be rate limited without increment';
  end if;

  begin
    perform public.consume_alpha_coach_rate_limit_v1(v_actor_one, 'anonymous', v_observed_at);
    raise exception 'disabled anonymous policy must fail closed';
  exception
    when sqlstate '22023' then
      null;
  end;
end;
$$;

rollback;
