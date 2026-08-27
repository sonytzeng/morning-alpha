begin;

create table if not exists public.membership_access_config (
  config_key text primary key default 'primary' check (config_key = 'primary'),
  signup_mode text not null default 'beta_full'
    check (signup_mode in ('closed', 'beta_full', 'trialing')),
  trial_days smallint not null default 14
    check (trial_days between 1 and 90),
  beta_access_ends_at timestamptz,
  billing_mode text not null default 'disabled'
    check (billing_mode in ('disabled', 'manual', 'provider')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.membership_access_config (
  config_key,
  signup_mode,
  trial_days,
  billing_mode,
  metadata
)
values (
  'primary',
  'beta_full',
  14,
  'disabled',
  jsonb_build_object(
    'reason', 'Payment provider is not live; beta users keep full published-member access without consuming the official trial.',
    'configured_at', now()
  )
)
on conflict (config_key) do nothing;

create table if not exists public.member_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state text not null
    check (state in ('owner', 'beta_full', 'trialing', 'paid_active', 'past_due', 'canceled', 'expired')),
  tier text not null default 'member'
    check (tier in ('member', 'vip', 'admin')),
  source text not null
    check (source in ('owner', 'beta', 'trial', 'manual', 'payment_provider')),
  access_started_at timestamptz not null default now(),
  access_ends_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  billing_provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  version integer not null default 1 check (version > 0),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_entitlements_owner_is_admin
    check (state <> 'owner' or tier = 'admin'),
  constraint member_entitlements_trial_window
    check (
      state <> 'trialing'
      or (
        trial_started_at is not null
        and trial_ends_at is not null
        and trial_ends_at > trial_started_at
      )
    ),
  constraint member_entitlements_access_window
    check (
      access_ends_at is null
      or state in ('past_due', 'canceled', 'expired')
      or access_ends_at > access_started_at
    )
);

create index if not exists member_entitlements_state_access_idx
  on public.member_entitlements (state, access_ends_at);

create unique index if not exists member_entitlements_provider_customer_uidx
  on public.member_entitlements (billing_provider, provider_customer_id)
  where billing_provider is not null and provider_customer_id is not null;

create unique index if not exists member_entitlements_provider_subscription_uidx
  on public.member_entitlements (billing_provider, provider_subscription_id)
  where billing_provider is not null and provider_subscription_id is not null;

create table if not exists public.membership_access_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  from_state text,
  to_state text not null,
  event_type text not null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index if not exists membership_access_events_user_time_idx
  on public.membership_access_events (user_id, occurred_at desc);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index if not exists billing_webhook_events_user_time_idx
  on public.billing_webhook_events (user_id, received_at desc);

create or replace function public.set_membership_updated_at_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_membership_access_config_updated_at on public.membership_access_config;
create trigger set_membership_access_config_updated_at
before update on public.membership_access_config
for each row execute function public.set_membership_updated_at_v1();

drop trigger if exists set_member_entitlements_updated_at on public.member_entitlements;
create trigger set_member_entitlements_updated_at
before update on public.member_entitlements
for each row execute function public.set_membership_updated_at_v1();

create or replace function public.ensure_member_entitlement_v1(p_user_id uuid)
returns public.member_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_role text;
  v_config public.membership_access_config%rowtype;
  v_entitlement public.member_entitlements%rowtype;
  v_previous_state text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  -- Serialize first-time activation for the same account so concurrent tabs or
  -- callback retries cannot race on the member_entitlements primary key.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select lower(coalesce(profile.role, 'free'))
    into v_role
  from public.profiles as profile
  where profile.id = p_user_id;

  if not found then
    raise exception 'profile not found';
  end if;

  select *
    into v_config
  from public.membership_access_config
  where config_key = 'primary';

  if not found then
    raise exception 'membership access config missing';
  end if;

  select *
    into v_entitlement
  from public.member_entitlements
  where user_id = p_user_id
  for update;

  if v_role = 'admin' then
    v_previous_state := v_entitlement.state;

    insert into public.member_entitlements (
      user_id,
      state,
      tier,
      source,
      access_started_at,
      access_ends_at,
      version,
      metadata
    )
    values (
      p_user_id,
      'owner',
      'admin',
      'owner',
      coalesce(v_entitlement.access_started_at, v_now),
      null,
      coalesce(v_entitlement.version, 0) + 1,
      coalesce(v_entitlement.metadata, '{}'::jsonb) || jsonb_build_object('permanent', true)
    )
    on conflict (user_id) do update
      set state = 'owner',
          tier = 'admin',
          source = 'owner',
          access_ends_at = null,
          version = public.member_entitlements.version + 1,
          metadata = public.member_entitlements.metadata || jsonb_build_object('permanent', true)
    returning * into v_entitlement;

    if v_previous_state is distinct from 'owner' then
      insert into public.membership_access_events (
        user_id, from_state, to_state, event_type, source, metadata
      ) values (
        p_user_id, v_previous_state, 'owner', 'owner_access_confirmed', 'system',
        jsonb_build_object('permanent', true)
      );
    end if;

    return v_entitlement;
  end if;

  if v_entitlement.user_id is not null then
    v_previous_state := v_entitlement.state;

    if v_entitlement.state = 'beta_full'
       and v_config.signup_mode = 'trialing' then
      update public.member_entitlements
      set state = 'trialing',
          tier = case when tier = 'admin' then 'member' else tier end,
          source = 'trial',
          access_started_at = v_now,
          access_ends_at = v_now + make_interval(days => v_config.trial_days),
          trial_started_at = v_now,
          trial_ends_at = v_now + make_interval(days => v_config.trial_days),
          version = version + 1,
          metadata = metadata || jsonb_build_object('converted_from_beta_at', v_now)
      where user_id = p_user_id
      returning * into v_entitlement;

      insert into public.membership_access_events (
        user_id, from_state, to_state, event_type, source, metadata
      ) values (
        p_user_id, v_previous_state, 'trialing', 'official_trial_started', 'system',
        jsonb_build_object('trial_days', v_config.trial_days)
      );
    elsif (
      v_entitlement.state = 'trialing'
      and v_entitlement.trial_ends_at is not null
      and v_entitlement.trial_ends_at <= v_now
    ) or (
      v_entitlement.state = 'beta_full'
      and v_entitlement.access_ends_at is not null
      and v_entitlement.access_ends_at <= v_now
    ) then
      update public.member_entitlements
      set state = 'expired',
          version = version + 1,
          metadata = metadata || jsonb_build_object('expired_at', v_now)
      where user_id = p_user_id
      returning * into v_entitlement;

      insert into public.membership_access_events (
        user_id, from_state, to_state, event_type, source, metadata
      ) values (
        p_user_id, v_previous_state, 'expired', 'access_expired', 'system', '{}'::jsonb
      );
    end if;

    return v_entitlement;
  end if;

  if v_config.signup_mode = 'closed' then
    return null;
  end if;

  if v_config.signup_mode = 'trialing' then
    insert into public.member_entitlements (
      user_id,
      state,
      tier,
      source,
      access_started_at,
      access_ends_at,
      trial_started_at,
      trial_ends_at,
      metadata
    ) values (
      p_user_id,
      'trialing',
      'member',
      'trial',
      v_now,
      v_now + make_interval(days => v_config.trial_days),
      v_now,
      v_now + make_interval(days => v_config.trial_days),
      jsonb_build_object('trial_days', v_config.trial_days)
    ) returning * into v_entitlement;
  else
    insert into public.member_entitlements (
      user_id,
      state,
      tier,
      source,
      access_started_at,
      access_ends_at,
      metadata
    ) values (
      p_user_id,
      'beta_full',
      'member',
      'beta',
      v_now,
      v_config.beta_access_ends_at,
      jsonb_build_object('official_trial_consumed', false)
    ) returning * into v_entitlement;
  end if;

  insert into public.membership_access_events (
    user_id, from_state, to_state, event_type, source, metadata
  ) values (
    p_user_id, null, v_entitlement.state, 'initial_access_activated', 'system',
    jsonb_build_object('signup_mode', v_config.signup_mode)
  );

  return v_entitlement;
end;
$$;

create or replace function public.apply_membership_billing_event_v1(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_user_id uuid,
  p_subscription_status text,
  p_tier text,
  p_current_period_end timestamptz,
  p_provider_customer_id text default null,
  p_provider_subscription_id text default null,
  p_cancel_at_period_end boolean default false,
  p_payload jsonb default '{}'::jsonb
)
returns public.member_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_inserted_event_id uuid;
  v_previous_state text;
  v_target_state text;
  v_entitlement public.member_entitlements%rowtype;
begin
  if nullif(btrim(p_provider), '') is null
     or nullif(btrim(p_provider_event_id), '') is null
     or nullif(btrim(p_event_type), '') is null then
    raise exception 'provider, provider_event_id and event_type are required';
  end if;

  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception 'valid user_id is required';
  end if;

  if p_tier not in ('member', 'vip') then
    raise exception 'invalid paid tier';
  end if;

  if p_subscription_status not in ('active', 'past_due', 'canceled', 'expired') then
    raise exception 'invalid subscription status';
  end if;

  insert into public.billing_webhook_events (
    provider,
    provider_event_id,
    event_type,
    user_id,
    payload
  ) values (
    lower(btrim(p_provider)),
    btrim(p_provider_event_id),
    btrim(p_event_type),
    p_user_id,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_inserted_event_id;

  if v_inserted_event_id is null then
    select * into v_entitlement
    from public.member_entitlements
    where user_id = p_user_id;
    return v_entitlement;
  end if;

  select state into v_previous_state
  from public.member_entitlements
  where user_id = p_user_id
  for update;

  v_target_state := case p_subscription_status
    when 'active' then 'paid_active'
    when 'past_due' then 'past_due'
    when 'canceled' then 'canceled'
    else 'expired'
  end;

  insert into public.member_entitlements (
    user_id,
    state,
    tier,
    source,
    access_started_at,
    access_ends_at,
    billing_provider,
    provider_customer_id,
    provider_subscription_id,
    current_period_end,
    cancel_at_period_end,
    metadata
  ) values (
    p_user_id,
    v_target_state,
    p_tier,
    'payment_provider',
    v_now,
    p_current_period_end,
    lower(btrim(p_provider)),
    nullif(btrim(p_provider_customer_id), ''),
    nullif(btrim(p_provider_subscription_id), ''),
    p_current_period_end,
    coalesce(p_cancel_at_period_end, false),
    jsonb_build_object('last_billing_event_type', p_event_type)
  )
  on conflict (user_id) do update
    set state = excluded.state,
        tier = excluded.tier,
        source = excluded.source,
        access_ends_at = excluded.access_ends_at,
        billing_provider = excluded.billing_provider,
        provider_customer_id = excluded.provider_customer_id,
        provider_subscription_id = excluded.provider_subscription_id,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        version = public.member_entitlements.version + 1,
        metadata = public.member_entitlements.metadata || excluded.metadata
  returning * into v_entitlement;

  insert into public.membership_access_events (
    user_id, from_state, to_state, event_type, source, metadata
  ) values (
    p_user_id,
    v_previous_state,
    v_target_state,
    'billing_state_changed',
    lower(btrim(p_provider)),
    jsonb_build_object(
      'provider_event_id', p_provider_event_id,
      'provider_event_type', p_event_type,
      'current_period_end', p_current_period_end
    )
  );

  update public.billing_webhook_events
  set processing_status = 'processed',
      processed_at = v_now
  where id = v_inserted_event_id;

  return v_entitlement;
end;
$$;

alter table public.membership_access_config enable row level security;
alter table public.member_entitlements enable row level security;
alter table public.membership_access_events enable row level security;
alter table public.billing_webhook_events enable row level security;

revoke all on table public.membership_access_config from public, anon, authenticated;
revoke all on table public.member_entitlements from public, anon, authenticated;
revoke all on table public.membership_access_events from public, anon, authenticated;
revoke all on table public.billing_webhook_events from public, anon, authenticated;

grant all on table public.membership_access_config to service_role;
grant all on table public.member_entitlements to service_role;
grant all on table public.membership_access_events to service_role;
grant all on table public.billing_webhook_events to service_role;

revoke all on function public.set_membership_updated_at_v1() from public, anon, authenticated;
revoke all on function public.ensure_member_entitlement_v1(uuid) from public, anon, authenticated;
revoke all on function public.apply_membership_billing_event_v1(
  text, text, text, uuid, text, text, timestamptz, text, text, boolean, jsonb
) from public, anon, authenticated;

grant execute on function public.ensure_member_entitlement_v1(uuid) to service_role;
grant execute on function public.apply_membership_billing_event_v1(
  text, text, text, uuid, text, text, timestamptz, text, text, boolean, jsonb
) to service_role;

update public.profiles
set role = 'admin',
    updated_at = now()
where lower(email) = lower('sonytzeng@gmail.com')
  and role is distinct from 'admin';

insert into public.member_entitlements (
  user_id,
  state,
  tier,
  source,
  access_started_at,
  access_ends_at,
  metadata
)
select
  users.id,
  'owner',
  'admin',
  'owner',
  now(),
  null,
  jsonb_build_object('permanent', true, 'owner_email', lower(users.email))
from auth.users as users
where lower(users.email) = lower('sonytzeng@gmail.com')
on conflict (user_id) do update
  set state = 'owner',
      tier = 'admin',
      source = 'owner',
      access_ends_at = null,
      version = public.member_entitlements.version + 1,
      metadata = public.member_entitlements.metadata || jsonb_build_object('permanent', true);

comment on table public.member_entitlements is
  'Canonical server-side Morning Alpha membership entitlement. Browser clients cannot mutate or directly read this table.';
comment on table public.billing_webhook_events is
  'Idempotent provider-neutral billing event ledger. Only service_role can write or read.';
comment on function public.ensure_member_entitlement_v1(uuid) is
  'Service-role-only idempotent activation and expiry transition for owner, beta and 14-day trial access.';
comment on function public.apply_membership_billing_event_v1(
  text, text, text, uuid, text, text, timestamptz, text, text, boolean, jsonb
) is
  'Service-role-only payment-provider adapter contract with event idempotency.';

commit;
;
