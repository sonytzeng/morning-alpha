begin;

create table if not exists public.alpha_coach_rate_limit_policies (
  policy_key text primary key,
  requests_per_minute integer not null,
  requests_per_hour integer not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint alpha_coach_rate_limit_policies_key_check
    check (policy_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint alpha_coach_rate_limit_policies_limits_check
    check (
      (enabled and requests_per_minute > 0 and requests_per_hour >= requests_per_minute)
      or
      (not enabled and requests_per_minute = 0 and requests_per_hour = 0)
    )
);

create table if not exists public.alpha_coach_rate_limit_counters (
  actor_id uuid not null,
  policy_key text not null references public.alpha_coach_rate_limit_policies(policy_key) on delete restrict,
  window_kind text not null check (window_kind in ('minute', 'hour')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (actor_id, policy_key, window_kind, window_start),
  constraint alpha_coach_rate_limit_counters_expiry_check
    check (expires_at > window_start)
);

create index if not exists alpha_coach_rate_limit_counters_expiry_idx
  on public.alpha_coach_rate_limit_counters (expires_at);

insert into public.alpha_coach_rate_limit_policies (
  policy_key,
  requests_per_minute,
  requests_per_hour,
  enabled
) values
  ('anonymous', 0, 0, false),
  ('standard', 5, 30, true),
  ('admin', 20, 200, true)
on conflict (policy_key) do nothing;

alter table public.alpha_coach_rate_limit_policies enable row level security;
alter table public.alpha_coach_rate_limit_policies force row level security;
alter table public.alpha_coach_rate_limit_counters enable row level security;
alter table public.alpha_coach_rate_limit_counters force row level security;

revoke all on table public.alpha_coach_rate_limit_policies from public, anon, authenticated;
revoke all on table public.alpha_coach_rate_limit_counters from public, anon, authenticated;
grant select on table public.alpha_coach_rate_limit_policies to service_role;
grant select, insert, update, delete on table public.alpha_coach_rate_limit_counters to service_role;

create or replace function public.consume_alpha_coach_rate_limit_v1(
  p_actor_id uuid,
  p_policy_key text,
  p_observed_at timestamptz default null
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  minute_count integer,
  minute_limit integer,
  hour_count integer,
  hour_limit integer,
  applied_policy_key text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_observed_at, pg_catalog.clock_timestamp());
  v_minute_start timestamptz := pg_catalog.date_trunc('minute', v_now);
  v_hour_start timestamptz := pg_catalog.date_trunc('hour', v_now);
  v_policy public.alpha_coach_rate_limit_policies%rowtype;
  v_minute_count integer := 0;
  v_hour_count integer := 0;
  v_retry_after integer := 0;
begin
  if p_actor_id is null then
    raise exception using errcode = '22023', message = 'ALPHA_COACH_RATE_LIMIT_ACTOR_REQUIRED';
  end if;

  if coalesce(pg_catalog.btrim(p_policy_key), '') = '' then
    raise exception using errcode = '22023', message = 'ALPHA_COACH_RATE_LIMIT_POLICY_REQUIRED';
  end if;

  select *
    into v_policy
    from public.alpha_coach_rate_limit_policies as policy
   where policy.policy_key = p_policy_key
     and policy.enabled = true;

  if not found then
    raise exception using errcode = '22023', message = 'ALPHA_COACH_RATE_LIMIT_POLICY_UNAVAILABLE';
  end if;

  -- One transaction-scoped lock serializes check + increment for the same
  -- authenticated actor and policy across every Edge Function instance.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('alpha-coach:' || p_actor_id::text || ':' || p_policy_key, 0)
  );

  delete from public.alpha_coach_rate_limit_counters as counter
   where counter.actor_id = p_actor_id
     and counter.policy_key = p_policy_key
     and counter.expires_at <= v_now;

  select coalesce(counter.request_count, 0)
    into v_minute_count
    from public.alpha_coach_rate_limit_counters as counter
   where counter.actor_id = p_actor_id
     and counter.policy_key = p_policy_key
     and counter.window_kind = 'minute'
     and counter.window_start = v_minute_start;

  select coalesce(counter.request_count, 0)
    into v_hour_count
    from public.alpha_coach_rate_limit_counters as counter
   where counter.actor_id = p_actor_id
     and counter.policy_key = p_policy_key
     and counter.window_kind = 'hour'
     and counter.window_start = v_hour_start;

  v_minute_count := coalesce(v_minute_count, 0);
  v_hour_count := coalesce(v_hour_count, 0);

  if v_minute_count >= v_policy.requests_per_minute then
    v_retry_after := 60;
    return query select
      false,
      v_retry_after,
      v_minute_count,
      v_policy.requests_per_minute,
      v_hour_count,
      v_policy.requests_per_hour,
      v_policy.policy_key;
    return;
  end if;

  if v_hour_count >= v_policy.requests_per_hour then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_hour_start + interval '1 hour' - v_now)))::integer
    );
    return query select
      false,
      v_retry_after,
      v_minute_count,
      v_policy.requests_per_minute,
      v_hour_count,
      v_policy.requests_per_hour,
      v_policy.policy_key;
    return;
  end if;

  insert into public.alpha_coach_rate_limit_counters (
    actor_id,
    policy_key,
    window_kind,
    window_start,
    request_count,
    expires_at,
    updated_at
  ) values (
    p_actor_id,
    p_policy_key,
    'minute',
    v_minute_start,
    1,
    v_minute_start + interval '2 hours',
    v_now
  )
  on conflict (actor_id, policy_key, window_kind, window_start) do update
    set request_count = public.alpha_coach_rate_limit_counters.request_count + 1,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
  returning request_count into v_minute_count;

  insert into public.alpha_coach_rate_limit_counters (
    actor_id,
    policy_key,
    window_kind,
    window_start,
    request_count,
    expires_at,
    updated_at
  ) values (
    p_actor_id,
    p_policy_key,
    'hour',
    v_hour_start,
    1,
    v_hour_start + interval '2 hours',
    v_now
  )
  on conflict (actor_id, policy_key, window_kind, window_start) do update
    set request_count = public.alpha_coach_rate_limit_counters.request_count + 1,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
  returning request_count into v_hour_count;

  return query select
    true,
    0,
    v_minute_count,
    v_policy.requests_per_minute,
    v_hour_count,
    v_policy.requests_per_hour,
    v_policy.policy_key;
end;
$$;

revoke all on function public.consume_alpha_coach_rate_limit_v1(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_alpha_coach_rate_limit_v1(uuid, text, timestamptz)
  to service_role;

comment on table public.alpha_coach_rate_limit_policies is
  'Central server-side request policies for Alpha Coach. Anonymous access remains disabled.';
comment on table public.alpha_coach_rate_limit_counters is
  'Durable per-user Alpha Coach minute and hour counters shared by all Edge Function instances.';
comment on function public.consume_alpha_coach_rate_limit_v1(uuid, text, timestamptz) is
  'Atomically checks and increments an authenticated Alpha Coach actor quota. Service-role only.';

commit;
