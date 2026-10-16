-- CANDIDATE ONLY. Applying this file does NOT activate the new policy.
-- A separately approved, service-only activation records the actual DB time.
begin;
create schema membership_private;
revoke all on schema membership_private from public, anon, authenticated, service_role;

create table membership_private.policy_versions (
  version text primary key check (version = 'LEGACY_GRANDFATHER_V1'),
  effective_at timestamptz not null,
  approval_reference text not null check (length(approval_reference) between 8 and 200),
  previous_offer jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table membership_private.legacy_snapshots (
  -- No FK cascade/restrict: do not change existing Auth account deletion rules.
  user_id uuid primary key,
  policy_version text not null references membership_private.policy_versions(version),
  account_created_at timestamptz not null,
  captured_at timestamptz not null,
  basis text not null check (basis in ('CANONICAL_ENTITLEMENT','LEGACY_PROFILE','OWNER_ROLE','NO_ACQUIRED_ENTITLEMENT')),
  review_status text not null check (review_status in ('EXPLICIT_TERM','EXPLICIT_PERMANENT','LEGACY_POLICY_REVIEW_REQUIRED','NO_ACTIVE_GRANT')),
  evidence jsonb not null,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$')
);
alter table membership_private.policy_versions enable row level security;
alter table membership_private.legacy_snapshots enable row level security;
revoke all on all tables in schema membership_private from public, anon, authenticated, service_role;

create function membership_private.reject_rewrite_v1() returns trigger
language plpgsql set search_path = '' as $$begin raise exception 'IMMUTABLE_MEMBERSHIP_POLICY';end$$;
revoke all on function membership_private.reject_rewrite_v1() from public, anon, authenticated, service_role;
create trigger policy_immutable before update or delete on membership_private.policy_versions
for each row execute function membership_private.reject_rewrite_v1();
create trigger legacy_immutable before update or delete on membership_private.legacy_snapshots
for each row execute function membership_private.reject_rewrite_v1();

-- Extend configuration vocabulary only; keep its current row and billing mode.
alter table public.membership_access_config drop constraint membership_access_config_signup_mode_check;
alter table public.membership_access_config add constraint membership_access_config_signup_mode_check
check (signup_mode in ('closed','beta_full','trialing','free'));

-- Keep the exact legacy implementation private. Existing callers such as
-- get-report-payload keep the same public RPC contract, but cannot accidentally
-- grant Beta to new Free accounts after policy activation. No Report code edit.
alter function public.ensure_member_entitlement_v1(uuid) set schema membership_private;
alter function membership_private.ensure_member_entitlement_v1(uuid) rename to ensure_member_entitlement_pre_policy_v1;
revoke all on function membership_private.ensure_member_entitlement_pre_policy_v1(uuid) from public,anon,authenticated,service_role;

create function public.activate_membership_policy_candidate_v1(p_approval_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_policy membership_private.policy_versions%rowtype;
  v_config public.membership_access_config%rowtype;
  v_now timestamptz;
  r record;
  v_evidence jsonb;
  v_basis text;
  v_review text;
  v_state text;
  v_tier text;
begin
  if p_approval_reference is null or length(btrim(p_approval_reference)) not between 8 and 200 then
    raise exception 'EXPLICIT_RELEASE_APPROVAL_REQUIRED';
  end if;
  -- Global exclusive/shared lock orders policy activation before per-user work.
  perform pg_catalog.pg_advisory_xact_lock(67230130);
  select * into v_policy from membership_private.policy_versions;
  if found then
    if v_policy.approval_reference <> p_approval_reference then raise exception 'POLICY_ALREADY_ACTIVATED';end if;
    return jsonb_build_object('version',v_policy.version,'effective_at',v_policy.effective_at,'replayed',true);
  end if;
  -- Brief maintenance transaction: no account/profile/entitlement can slip
  -- between the cutoff and its snapshot. No email or provider payload is copied.
  lock table auth.users, public.profiles in share mode;
  lock table public.member_entitlements in share row exclusive mode;
  select * into strict v_config from public.membership_access_config where config_key='primary' for update;
  if v_config.billing_mode <> 'disabled' then raise exception 'PAYMENT_PROVIDER_REVIEW_REQUIRED';end if;
  if exists(select 1 from auth.users u left join public.profiles p on p.id=u.id
    where not coalesce(u.is_anonymous,false) and p.id is null) then
    raise exception 'LEGACY_PROFILE_MISSING';
  end if;
  v_now := clock_timestamp();
  insert into membership_private.policy_versions(version,effective_at,approval_reference,previous_offer)
  values('LEGACY_GRANDFATHER_V1',v_now,p_approval_reference,
    jsonb_build_object('signup_mode',v_config.signup_mode,'trial_days',v_config.trial_days,
      'beta_access_ends_at',v_config.beta_access_ends_at,'billing_mode',v_config.billing_mode));
  for r in select u.id,u.created_at,p.role,p.subscription_status,p.membership_tier,p.paid_until,
      e.user_id as entitlement_id,e.state,e.tier,e.source,e.version,e.access_started_at,e.access_ends_at,
      e.trial_started_at,e.trial_ends_at,e.current_period_end,e.cancel_at_period_end,
      e.metadata->>'permanent' as explicit_permanent
    from auth.users u join public.profiles p on p.id=u.id
    left join public.member_entitlements e on e.user_id=u.id
    where not coalesce(u.is_anonymous,false) and u.created_at<=v_now order by u.id
  loop
    v_basis := case when r.entitlement_id is not null then 'CANONICAL_ENTITLEMENT'
      when lower(coalesce(r.role,''))='admin' then 'OWNER_ROLE'
      when lower(coalesce(r.subscription_status,''))='active' then 'LEGACY_PROFILE'
      else 'NO_ACQUIRED_ENTITLEMENT' end;
    v_review := case
      when v_basis='OWNER_ROLE' or (r.state='owner' and r.explicit_permanent='true') then 'EXPLICIT_PERMANENT'
      when r.entitlement_id is not null and r.explicit_permanent='true' then 'EXPLICIT_PERMANENT'
      when r.entitlement_id is not null and coalesce(r.trial_ends_at,r.access_ends_at,r.current_period_end) is not null then 'EXPLICIT_TERM'
      when v_basis='LEGACY_PROFILE' and r.paid_until is not null then 'EXPLICIT_TERM'
      when v_basis in ('LEGACY_PROFILE','CANONICAL_ENTITLEMENT') then 'LEGACY_POLICY_REVIEW_REQUIRED'
      else 'NO_ACTIVE_GRANT' end;
    v_evidence := jsonb_build_object('profile_role',r.role,'profile_subscription_status',r.subscription_status,
      'profile_membership_tier',r.membership_tier,'profile_paid_until',r.paid_until,
      'state',r.state,'tier',r.tier,'source',r.source,'source_version',r.version,
      'access_started_at',r.access_started_at,'access_ends_at',r.access_ends_at,
      'trial_started_at',r.trial_started_at,'trial_ends_at',r.trial_ends_at,
      'current_period_end',r.current_period_end,'cancel_at_period_end',r.cancel_at_period_end,
      'explicit_permanent',r.explicit_permanent,'payment_verified',false);
    insert into membership_private.legacy_snapshots
      values(r.id,'LEGACY_GRANDFATHER_V1',r.created_at,v_now,v_basis,v_review,v_evidence,
        encode(sha256(convert_to(v_evidence::text,'UTF8')),'hex'));
    -- Existing canonical rows are NEVER rewritten. Materialize only previously
    -- effective profile grants, so later logins cannot reinterpret them as trial.
    if r.entitlement_id is null and (v_basis='OWNER_ROLE' or
      (v_basis='LEGACY_PROFILE' and (r.paid_until is null or r.paid_until>v_now))) then
      v_state := case when v_basis='OWNER_ROLE' then 'owner' when r.paid_until is null then 'beta_full' else 'paid_active' end;
      v_tier := case when v_basis='OWNER_ROLE' then 'admin' when lower(coalesce(r.role,''))='vip' then 'vip'
        when lower(coalesce(r.role,''))='member' then 'member' when lower(coalesce(r.membership_tier,''))='vip' then 'vip' else 'member' end;
      insert into public.member_entitlements(user_id,state,tier,source,access_started_at,access_ends_at,metadata)
      values(r.id,v_state,v_tier,case when v_basis='OWNER_ROLE' then 'owner' else 'manual' end,v_now,
        case when v_basis='OWNER_ROLE' then null else r.paid_until end,
        jsonb_build_object('policy_version','LEGACY_GRANDFATHER_V1','legacy_basis',v_basis,
          'legacy_review_status',v_review,'original_start_unknown',true,'payment_verified',false));
      insert into public.membership_access_events(user_id,from_state,to_state,event_type,source,metadata)
      values(r.id,null,v_state,'legacy_grant_preserved','policy',jsonb_build_object('policy_version','LEGACY_GRANDFATHER_V1','review_status',v_review));
    end if;
  end loop;
  update public.membership_access_config set signup_mode='free',metadata=metadata||
    jsonb_build_object('policy_version','LEGACY_GRANDFATHER_V1','membership_policy_effective_at',v_now)
    where config_key='primary';
  return jsonb_build_object('version','LEGACY_GRANDFATHER_V1','effective_at',v_now,'replayed',false,
    'legacy_count',(select count(*) from membership_private.legacy_snapshots),
    'review_required',(select count(*) from membership_private.legacy_snapshots where review_status='LEGACY_POLICY_REVIEW_REQUIRED'));
end$$;
revoke all on function public.activate_membership_policy_candidate_v1(text) from public,anon,authenticated;
grant execute on function public.activate_membership_policy_candidate_v1(text) to service_role;

-- Same response contract. Before approved activation, exactly the existing
-- activation path. Afterwards: no auto trial, no login-time grant rewriting.
create function public.ensure_member_entitlement_v2(p_user_id uuid)
returns public.member_entitlements language plpgsql security definer set search_path = '' as $$
declare v_row public.member_entitlements%rowtype;v_role text;
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(67230130);
  if not exists(select 1 from membership_private.policy_versions) then
    return membership_private.ensure_member_entitlement_pre_policy_v1(p_user_id);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select role into v_role from public.profiles where id=p_user_id;
  if not found then raise exception 'profile not found';end if;
  select * into v_row from public.member_entitlements where user_id=p_user_id;
  if found then return v_row;end if;
  if lower(coalesce(v_role,''))='admin' then return membership_private.ensure_member_entitlement_pre_policy_v1(p_user_id);end if;
  return null;
end$$;
revoke all on function public.ensure_member_entitlement_v2(uuid) from public,anon,authenticated;
grant execute on function public.ensure_member_entitlement_v2(uuid) to service_role;
create function public.ensure_member_entitlement_v1(p_user_id uuid)
returns public.member_entitlements language sql security definer set search_path = '' as $$
  select public.ensure_member_entitlement_v2(p_user_id)
$$;
revoke all on function public.ensure_member_entitlement_v1(uuid) from public,anon,authenticated;
grant execute on function public.ensure_member_entitlement_v1(uuid) to service_role;
create function public.get_member_policy_receipt_v1(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('legacy_review_required',exists(select 1 from membership_private.legacy_snapshots
    where user_id=p_user_id and review_status='LEGACY_POLICY_REVIEW_REQUIRED'),
    'policy_active',exists(select 1 from membership_private.policy_versions))
$$;
revoke all on function public.get_member_policy_receipt_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_member_policy_receipt_v1(uuid) to service_role;
-- A future billing callback must not silently replace an independently held
-- legacy grant. Preserve its minimum tier/window; unknown terms require review.
-- This is not a refund policy or a provider signature validator.
create function membership_private.protect_legacy_grant_v1() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s membership_private.legacy_snapshots%rowtype;floor_end timestamptz;floor_tier text;floor_active boolean;new_end timestamptz;new_active boolean;
begin
  select * into s from membership_private.legacy_snapshots where user_id=old.user_id;
  if not found then return new;end if;
  floor_tier := coalesce(s.evidence->>'tier',nullif(s.evidence->>'profile_role','free'),s.evidence->>'profile_membership_tier','member');
  floor_end := case when s.basis='LEGACY_PROFILE' then (s.evidence->>'profile_paid_until')::timestamptz
    when s.evidence->>'state'='trialing' then (s.evidence->>'trial_ends_at')::timestamptz
    else coalesce((s.evidence->>'access_ends_at')::timestamptz,(s.evidence->>'current_period_end')::timestamptz) end;
  floor_active := s.basis='OWNER_ROLE' or s.evidence->>'state'='owner' or
    (s.basis='LEGACY_PROFILE' and (floor_end is null or floor_end>clock_timestamp())) or
    (s.evidence->>'state' in ('paid_active','beta_full') and (floor_end is null or floor_end>clock_timestamp())) or
    (s.evidence->>'state' in ('trialing','canceled') and floor_end>clock_timestamp());
  if not coalesce(floor_active,false) then return new;end if;
  new_end := case when new.state='trialing' then new.trial_ends_at else coalesce(new.access_ends_at,new.current_period_end) end;
  new_active := new.state='owner' or (new.state in ('paid_active','beta_full') and (new_end is null or new_end>clock_timestamp()))
    or (new.state in ('trialing','canceled') and new_end>clock_timestamp());
  if not coalesce(new_active,false) or
    (floor_end is null and new_end is not null) or
    (floor_end is not null and new_end is not null and new_end<floor_end) or
    (floor_tier='admin' and new.state<>'owner') or
    (floor_tier='vip' and new.tier not in ('vip','admin')) then
    raise exception 'LEGACY_GRANT_REVIEW_REQUIRED';
  end if;
  return new;
end$$;
revoke all on function membership_private.protect_legacy_grant_v1() from public,anon,authenticated,service_role;
create trigger preserve_legacy_grant_v1 before update on public.member_entitlements
for each row execute function membership_private.protect_legacy_grant_v1();
comment on function public.activate_membership_policy_candidate_v1(text) is
  'CANDIDATE: separately approved activation only. Database clock cutoff; immutable snapshots; no payment activation.';
commit;
