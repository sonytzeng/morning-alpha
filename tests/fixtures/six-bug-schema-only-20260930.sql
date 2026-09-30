-- ISOLATED_SCHEMA_ONLY_BASELINE: no business rows; never a Production migration.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg13+2)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: trading_day_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trading_day_state (
    trading_date date NOT NULL,
    current_state text NOT NULL,
    state_rank smallint NOT NULL,
    checkpoint_status jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_correlation_id uuid,
    last_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trading_day_state_checkpoint_status_check CHECK ((jsonb_typeof(checkpoint_status) = 'object'::text)),
    CONSTRAINT trading_day_state_last_metadata_check CHECK ((jsonb_typeof(last_metadata) = 'object'::text)),
    CONSTRAINT trading_day_state_state_rank_check CHECK (((state_rank >= 0) AND (state_rank <= 150)))
);

ALTER TABLE ONLY public.trading_day_state FORCE ROW LEVEL SECURITY;


--
-- Name: advance_trading_day_state_v1(date, text, text, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.advance_trading_day_state_v1(p_trading_date date, p_state text, p_checkpoint text, p_status text DEFAULT 'SUCCEEDED'::text, p_correlation_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS public.trading_day_state
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_state_rank smallint;
  v_status_rank smallint;
  v_existing_status_rank smallint;
  v_existing_rank smallint;
  v_existing_state text;
  v_effective_rank smallint;
  v_effective_state text;
  v_result public.trading_day_state;
  v_advances boolean:=false;
  v_core_market_open_jump boolean:=false;
  v_sparse_recovery boolean:=false;
  v_sparse_batch public.market_checkpoint_batches;
  v_sparse_integrity jsonb;
  v_sparse_rows jsonb;
  v_sparse_validation jsonb;
begin
  if p_trading_date is null then raise exception 'trading_date_required'; end if;
  if coalesce(trim(p_checkpoint),'')='' then raise exception 'checkpoint_required'; end if;
  v_state_rank:=case p_state
    when 'SCHEDULED' then 0 when 'PREMARKET_CAPTURED' then 10
    when 'REPORT_GENERATED' then 20 when 'EDITORIAL_APPROVED' then 30
    when 'PREMARKET_DELIVERED' then 40 when 'MARKET_OPEN_CAPTURED' then 50
    when 'CHECKPOINT_0930_CAPTURED' then 60 when 'CHECKPOINT_1030_CAPTURED' then 70
    when 'CHECKPOINT_1300_CAPTURED' then 80 when 'CLOSE_1410_CAPTURED' then 90
    when 'CLOSE_1430_CAPTURED' then 100 when 'CLOSING_VERIFIED' then 110
    when 'FEEDBACK_COMPLETED' then 120 when 'LEARNING_COMPLETED' then 130
    when 'HEALTH_AUDITED' then 140 when 'DAY_COMPLETED' then 150
    when 'MANUAL_CAPTURED' then 0 else null end;
  if v_state_rank is null then raise exception 'invalid_trading_day_state:%',p_state; end if;
  v_status_rank:=case upper(coalesce(p_status,''))
    when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2
    when 'DEGRADED' then 2 when 'SKIPPED' then 2 when 'SUCCEEDED' then 3 else null end;
  if v_status_rank is null then raise exception 'invalid_checkpoint_status:%',p_status; end if;

  v_advances:=upper(p_status)='SUCCEEDED' or (
    upper(p_status)='DEGRADED' and (
      (
        coalesce((p_metadata->>'required_core_complete')::boolean,false)
        and coalesce((p_metadata->>'canonical_complete')::boolean,false)
        and coalesce((p_metadata->>'core_batch_complete')::boolean,false)
      )
      or (
        p_state='CLOSING_VERIFIED'
        and p_metadata->>'closing_verification_status'='direction_completed_data_degraded'
        and coalesce(p_metadata->>'closing_decision_snapshot_id','')<>''
        and coalesce(p_metadata->>'report_id','')<>''
      )
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_trading_date::text||':'||p_checkpoint,0));
  select t.state_rank,t.current_state,case upper(coalesce(t.checkpoint_status->p_checkpoint->>'status',''))
    when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2
    when 'DEGRADED' then 2 when 'SKIPPED' then 2 when 'SUCCEEDED' then 3 else -1 end
  into v_existing_rank,v_existing_state,v_existing_status_rank
  from public.trading_day_state t where t.trading_date=p_trading_date for update;

  if v_existing_rank is not null and v_state_rank<v_existing_rank then
    insert into public.runtime_lifecycle_events(trading_date,state,state_rank,checkpoint,status,correlation_id,
      http_dispatch_id,input_fingerprint,output_fingerprint,provider_status,reason_codes,metadata,completed_at)
    values(p_trading_date,p_state,v_state_rank,p_checkpoint,'SKIPPED',p_correlation_id,
      nullif(p_metadata->>'http_dispatch_id','')::uuid,p_metadata->>'input_fingerprint',p_metadata->>'output_fingerprint',
      coalesce(p_metadata->'provider_status','{}'::jsonb),array['STATE_RANK_REGRESSION_BLOCKED'],p_metadata,now())
    on conflict do nothing;
    select * into v_result from public.trading_day_state where trading_date=p_trading_date;
    return v_result;
  end if;

  v_core_market_open_jump:=p_state='MARKET_OPEN_CAPTURED' and v_advances
    and coalesce((p_metadata->>'required_core_complete')::boolean,false)
    and coalesce((p_metadata->>'canonical_complete')::boolean,false);
  if v_advances and v_state_rank>coalesce(v_existing_rank,0)+10 and not v_core_market_open_jump then
    -- RUNTIME_CHECKPOINT_SPARSE_RECOVERY_V1: terminal earlier failures are
    -- retained verbatim. Never manufacture PREMARKET, Report, LINE or SLA PASS.
    if p_trading_date = (clock_timestamp() at time zone 'Asia/Taipei')::date
      and p_correlation_id is not null
      and p_state = (case p_checkpoint
        when '0930' then 'CHECKPOINT_0930_CAPTURED'
        when '1030' then 'CHECKPOINT_1030_CAPTURED'
        when '1300' then 'CHECKPOINT_1300_CAPTURED'
        when '1410' then 'CLOSE_1410_CAPTURED'
        when '1430' then 'CLOSE_1430_CAPTURED'
      end)
      and exists (
        select 1 from public.trading_day_state t,
          lateral jsonb_each(t.checkpoint_status) prior
        where t.trading_date = p_trading_date
          and upper(prior.value->>'status') in ('FAILED','DEGRADED')
          and case lower(prior.key)
            when 'premarket' then 10 when '0900' then 50 when '0930' then 60
            when '1030' then 70 when '1300' then 80 when '1410' then 90
            when '1430' then 100
          end < v_state_rank
      ) then
      -- Share the Atomic writer lock. The ledger must already exist; the
      -- idempotent validator below cannot enter its INSERT branch.
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'market-checkpoint-atomic:'||p_trading_date::text||':'||p_checkpoint,0));
      select * into v_sparse_batch from public.market_checkpoint_batches b
        where b.business_date=p_trading_date and b.checkpoint=p_checkpoint
          and b.status='COMMITTED' for share;
      if found and v_sparse_batch.correlation_id=p_correlation_id
        and p_metadata->'atomic_checkpoint_complete'='true'::jsonb
        and v_sparse_batch.batch_id::text=p_metadata->>'atomic_batch_id'
        and v_sparse_batch.idempotency_key=p_metadata->>'atomic_idempotency_key'
        and v_sparse_batch.expected_provider_count=11
        and v_sparse_batch.committed_provider_count=11
        and (v_sparse_batch.committed_at at time zone 'Asia/Taipei')::date=p_trading_date
        and v_sparse_batch.committed_at<=clock_timestamp() then
        v_sparse_integrity:=public.market_checkpoint_batch_integrity_v1(p_trading_date,p_checkpoint);
        if v_sparse_integrity->>'status'='PASS'
          and v_sparse_integrity->>'mixed_batch_revision_count'='0'
          and not exists (
            select 1 from public.market_checkpoint_snapshots s
            where s.batch_id=v_sparse_batch.batch_id and (
              s.correlation_id is distinct from p_correlation_id
              or s.trading_date is distinct from p_trading_date
              or s.checkpoint is distinct from p_checkpoint
              or s.market_session is distinct from v_sparse_batch.market_session
              or s.idempotency_key is distinct from v_sparse_batch.idempotency_key
              or s.captured_at>clock_timestamp()
              or s.source_timestamp>clock_timestamp()+interval '60 seconds'
            )
          ) then
          select jsonb_agg(jsonb_build_object(
            'provider_key',s.provider_key,'symbol',s.symbol,'value',s.value,
            'change_percent',s.change_percent,'source',s.source,
            'source_timestamp',s.source_timestamp,'captured_at',s.captured_at,'raw',s.raw
          ) order by s.provider_key) into v_sparse_rows
          from public.market_checkpoint_snapshots s where s.batch_id=v_sparse_batch.batch_id;
          -- Reuse the unchanged current DB row/session/freshness contract.
          -- This is strictly an existing-batch replay under the same lock,
          -- not a new commit or a second independently maintained validator.
          v_sparse_validation:=public.commit_market_checkpoint_batch_v1(
            p_trading_date,p_checkpoint,v_sparse_batch.market_session,
            p_correlation_id,v_sparse_batch.idempotency_key,v_sparse_rows);
          v_sparse_recovery:=v_sparse_validation->>'status'='COMMITTED'
            and v_sparse_validation->>'reused'='true'
            and v_sparse_validation->>'row_count'='11'
            and v_sparse_validation->>'batch_id'=v_sparse_batch.batch_id::text
            and v_sparse_validation->>'correlation_id'=p_correlation_id::text;
        end if;
      end if;
    end if;
    if not coalesce(v_sparse_recovery,false) then
      raise exception 'lifecycle_predecessor_not_satisfied: current=%, requested=%',coalesce(v_existing_rank,0),v_state_rank;
    end if;
    p_metadata:=coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'sparse_recovery_contract','RUNTIME_CHECKPOINT_SPARSE_RECOVERY_V1',
      'recovered_from_state_rank',v_existing_rank,
      'sparse_recovery_batch_id',v_sparse_batch.batch_id,
      'reason_codes',coalesce(p_metadata->'reason_codes','[]'::jsonb)
        ||jsonb_build_array('ACCEPTED_BY_SPARSE_RECOVERY'));
  end if;
  v_effective_rank:=case when v_advances then greatest(coalesce(v_existing_rank,0),v_state_rank) else coalesce(v_existing_rank,0) end;
  v_effective_state:=case when v_advances then p_state else coalesce(v_existing_state,'SCHEDULED') end;

  insert into public.trading_day_state as t(trading_date,current_state,state_rank,checkpoint_status,last_correlation_id,last_metadata,completed_at)
  values(p_trading_date,v_effective_state,v_effective_rank,jsonb_build_object(p_checkpoint,jsonb_build_object(
    'status',upper(p_status),'state',p_state,'updated_at',now(),'correlation_id',p_correlation_id,'metadata',coalesce(p_metadata,'{}'::jsonb))),
    p_correlation_id,coalesce(p_metadata,'{}'::jsonb),case when v_effective_rank>=150 then now() end)
  on conflict(trading_date) do update set
    current_state=case when excluded.state_rank>t.state_rank then excluded.current_state else t.current_state end,
    state_rank=greatest(t.state_rank,excluded.state_rank),
    checkpoint_status=case when v_status_rank>coalesce(v_existing_status_rank,-1) then t.checkpoint_status||excluded.checkpoint_status else t.checkpoint_status end,
    last_correlation_id=case when excluded.state_rank>t.state_rank or (excluded.state_rank=t.state_rank and v_status_rank>coalesce(v_existing_status_rank,-1)) then coalesce(excluded.last_correlation_id,t.last_correlation_id) else t.last_correlation_id end,
    last_metadata=case when excluded.state_rank>t.state_rank or (excluded.state_rank=t.state_rank and v_status_rank>coalesce(v_existing_status_rank,-1)) then excluded.last_metadata else t.last_metadata end,
    completed_at=case when greatest(t.state_rank,excluded.state_rank)>=150 then coalesce(t.completed_at,now()) else t.completed_at end,
    updated_at=case when excluded.state_rank>t.state_rank or (excluded.state_rank=t.state_rank and v_status_rank>coalesce(v_existing_status_rank,-1)) then now() else t.updated_at end
  returning * into v_result;

  insert into public.runtime_lifecycle_events(trading_date,state,state_rank,checkpoint,status,correlation_id,
    http_dispatch_id,input_fingerprint,output_fingerprint,provider_status,reason_codes,metadata,completed_at)
  values(p_trading_date,p_state,v_state_rank,p_checkpoint,upper(p_status),p_correlation_id,
    nullif(p_metadata->>'http_dispatch_id','')::uuid,p_metadata->>'input_fingerprint',p_metadata->>'output_fingerprint',
    coalesce(p_metadata->'provider_status','{}'::jsonb),coalesce(array(select jsonb_array_elements_text(coalesce(p_metadata->'reason_codes','[]'::jsonb))),'{}'::text[]),p_metadata,
    case when upper(p_status) in ('SUCCEEDED','DEGRADED','FAILED','SKIPPED') then now() end)
  on conflict do nothing;
  return v_result;
end;
$$;


--
-- Name: member_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_entitlements (
    user_id uuid NOT NULL,
    state text NOT NULL,
    tier text DEFAULT 'member'::text NOT NULL,
    source text NOT NULL,
    access_started_at timestamp with time zone DEFAULT now() NOT NULL,
    access_ends_at timestamp with time zone,
    trial_started_at timestamp with time zone,
    trial_ends_at timestamp with time zone,
    billing_provider text,
    provider_customer_id text,
    provider_subscription_id text,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_entitlements_access_window CHECK (((access_ends_at IS NULL) OR (state = ANY (ARRAY['past_due'::text, 'canceled'::text, 'expired'::text])) OR (access_ends_at > access_started_at))),
    CONSTRAINT member_entitlements_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT member_entitlements_owner_is_admin CHECK (((state <> 'owner'::text) OR (tier = 'admin'::text))),
    CONSTRAINT member_entitlements_source_check CHECK ((source = ANY (ARRAY['owner'::text, 'beta'::text, 'trial'::text, 'manual'::text, 'payment_provider'::text]))),
    CONSTRAINT member_entitlements_state_check CHECK ((state = ANY (ARRAY['owner'::text, 'beta_full'::text, 'trialing'::text, 'paid_active'::text, 'past_due'::text, 'canceled'::text, 'expired'::text]))),
    CONSTRAINT member_entitlements_tier_check CHECK ((tier = ANY (ARRAY['member'::text, 'vip'::text, 'admin'::text]))),
    CONSTRAINT member_entitlements_trial_window CHECK (((state <> 'trialing'::text) OR ((trial_started_at IS NOT NULL) AND (trial_ends_at IS NOT NULL) AND (trial_ends_at > trial_started_at)))),
    CONSTRAINT member_entitlements_version_check CHECK ((version > 0))
);


--
-- Name: apply_membership_billing_event_v1(text, text, text, uuid, text, text, timestamp with time zone, text, text, boolean, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_membership_billing_event_v1(p_provider text, p_provider_event_id text, p_event_type text, p_user_id uuid, p_subscription_status text, p_tier text, p_current_period_end timestamp with time zone, p_provider_customer_id text DEFAULT NULL::text, p_provider_subscription_id text DEFAULT NULL::text, p_cancel_at_period_end boolean DEFAULT false, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS public.member_entitlements
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: bind_decision_snapshot_premarket_evidence_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bind_decision_snapshot_premarket_evidence_v1(p_decision_snapshot_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_bound integer := 0;
begin
  if p_decision_snapshot_id is null then
    raise exception 'decision_snapshot_id_required';
  end if;

  insert into public.decision_snapshot_market_evidence (
    decision_snapshot_id,
    market_checkpoint_snapshot_id,
    evidence_role
  )
  select decision.id,
         evidence.id,
         'PREMARKET'
  from public.decision_snapshots as decision
  cross join lateral (
    select distinct on (snapshots.symbol)
           snapshots.id,
           snapshots.symbol
    from public.market_checkpoint_snapshots as snapshots
    where snapshots.trading_date = decision.report_date
      and snapshots.checkpoint = 'PREMARKET'
      and snapshots.market_session = 'premarket'
      and snapshots.captured_at <= coalesce(decision.valid_from, decision.created_at)
    order by snapshots.symbol,
             snapshots.captured_at desc,
             snapshots.snapshot_version desc
  ) as evidence
  where decision.id = p_decision_snapshot_id
    and decision.session_type = 'PREMARKET'
  on conflict do nothing;

  get diagnostics v_bound = row_count;
  return v_bound;
end;
$$;


--
-- Name: bind_inserted_decision_premarket_evidence_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bind_inserted_decision_premarket_evidence_v1() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if new.session_type = 'PREMARKET' then
    perform public.bind_decision_snapshot_premarket_evidence_v1(new.id);
  end if;
  return new;
end;
$$;


--
-- Name: capture_morning_alpha_acceptance_v1(date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_morning_alpha_acceptance_v1(p_business_date date, p_evaluator_version text DEFAULT 'PRODUCTION_ACCEPTANCE_V1'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  v_d public.decision_snapshots; v_current public.decision_snapshots; v_c public.decision_snapshots;
  v_r public.reports; v_m public.member_content_revisions; v_sem public.semantic_coherence_reviews;
  v_day public.trading_day_state; v_learning public.learning_runs; v_prediction public.learning_predictions;
  v_source_run public.pipeline_runs; v_current_run public.pipeline_runs;
  v_now timestamptz:=clock_timestamp(); v_today date:=(clock_timestamp() at time zone 'Asia/Taipei')::date;
  v_phase text; v_verdict text; v_block text[]:='{}'; v_auto_block text[]:='{}';
  v_revision text; v_pointer jsonb; v_validation jsonb; v_ai jsonb; v_close jsonb; v_closing_contract jsonb;
  v_learning_contract jsonb; v_field text; v_symbol text; v_quote jsonb; v_key text;
  v_evidence jsonb; v_id uuid; v_version text; v_line_count bigint; v_failed bigint; v_dead bigint;
  v_manual boolean; v_due_at timestamptz; v_incidents bigint; v_line_time timestamptz;
  v_close_ok boolean:=false; v_learning_ok boolean:=false; v_market_predictions bigint;
begin
  if p_business_date is null then raise exception 'BUSINESS_DATE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-publication:'||p_business_date::text,0));
  select * into v_r from public.reports where report_date=p_business_date;
  select * into v_day from public.trading_day_state where trading_date=p_business_date;
  v_pointer:=v_r.ai_strategy_json->'market_publication_contract';
  v_revision:=v_pointer->>'opening_publication_revision_id';
  v_phase:=case when v_now < (p_business_date::text||'T08:00:00+08:00')::timestamptz then 'NOT_DUE'
    when v_now < (p_business_date::text||'T15:25:00+08:00')::timestamptz then 'MORNING' else 'FULL_DAY' end;
  if extract(isodow from p_business_date) in (6,7) or v_r.ai_strategy_json->'is_trading_day'='false'::jsonb then
    v_phase:='NON_TRADING'; v_verdict:='NOT_DUE';
  elsif v_phase='NOT_DUE' then v_verdict:='NOT_DUE';
  else
    -- A report JSON pointer alone cannot publish: both the current commitment
    -- and the frozen opening must have actual exact atomic success receipts.
    select * into v_current from public.decision_snapshots where id::text=v_r.ai_strategy_json->>'revision_id'
      and report_id=v_r.id and report_date=p_business_date and status='READY';
    if v_pointer->>'schema_version' is distinct from 'CORE_MARKET_PUBLICATION_V1'
      or v_pointer->>'status' is distinct from 'PUBLISHED'
      or v_pointer->>'report_date' is distinct from p_business_date::text
      or v_pointer->>'revision_id' is distinct from v_r.ai_strategy_json->>'revision_id'
      or nullif(v_revision,'') is null or v_current.id is null then
      v_block:=array_append(v_block,'REPORT_REVISION_MISMATCH');
    end if;
    select * into v_current_run from public.pipeline_runs where trading_date=p_business_date
      and idempotency_key like 'research-input:%' and status='SUCCEEDED'
      and provider_status#>'{result,success}'='true'::jsonb
      and provider_status#>>'{result,report_id}'=v_r.id::text
      and provider_status#>>'{result,report_date}'=p_business_date::text
      and provider_status#>>'{result,decision_snapshot_id}'=v_current.id::text
      and provider_status#>>'{result,member_content_revision_id}'=v_r.ai_strategy_json->>'canonical_member_revision_id'
      and provider_status#>>'{result,semantic_status}'='PASSED'
      and (v_pointer->>'publication_run_id' is null or id::text=v_pointer->>'publication_run_id')
      and completed_at>=v_current.valid_from and completed_at<=v_now
      and (completed_at at time zone 'Asia/Taipei')::date=p_business_date
      order by completed_at limit 1;
    if v_current_run.id is null then v_block:=array_append(v_block,'CURRENT_PUBLICATION_RECEIPT_UNVERIFIED'); end if;
    select * into v_d from public.decision_snapshots where id::text=v_revision and report_id=v_r.id
      and report_date=p_business_date and session_type='PREMARKET' and status='READY'
      and (valid_from at time zone 'Asia/Taipei')::date=p_business_date
      and valid_from < (p_business_date::text||'T09:00:00+08:00')::timestamptz and valid_from<=v_now;
    if v_d.id is null then v_block:=array_append(v_block,'CANONICAL_NOT_READY'); end if;
    select * into v_source_run from public.pipeline_runs where trading_date=p_business_date
      and idempotency_key like 'research-input:%' and status='SUCCEEDED'
      and provider_status#>'{result,success}'='true'::jsonb
      and provider_status#>>'{result,report_id}'=v_r.id::text
      and provider_status#>>'{result,report_date}'=p_business_date::text
      and provider_status#>>'{result,decision_snapshot_id}'=v_revision
      and provider_status#>>'{result,semantic_status}'='PASSED'
      and completed_at>=v_d.valid_from and completed_at<=v_now
      and (completed_at at time zone 'Asia/Taipei')::date=p_business_date
      and completed_at < (p_business_date::text||'T09:00:00+08:00')::timestamptz
      order by completed_at limit 1;
    if v_source_run.id is null then v_block:=array_append(v_block,'INPUT_LINEAGE_UNVERIFIED'); end if;
    select * into v_m from public.member_content_revisions
      where id::text=v_source_run.provider_status#>>'{result,member_content_revision_id}'
      and decision_snapshot_id=v_d.id and decision_snapshot_version=v_d.version
      and report_id=v_r.id and report_date=p_business_date;
    select * into v_sem from public.semantic_coherence_reviews where member_content_revision_id=v_m.id
      and decision_snapshot_id=v_d.id and report_date=p_business_date
      and canonical_snapshot_id=v_d.id and canonical_snapshot_version=v_d.version
      and status='PASSED' and cardinality(reason_codes)=0 and checked_at<=v_source_run.completed_at
      and cardinality(conflicting_fields)=0 and result->>'status'='PASSED'
      and result->'eligible'='true'::jsonb and result->'reason_codes'='[]'::jsonb
      and result->'conflicting_fields'='[]'::jsonb
      order by checked_at limit 1;
    if v_m.id is null or v_sem.id is null
      or v_m.canonical_contract->>'snapshot_id' is distinct from v_d.id::text
      or v_m.canonical_contract->'snapshot_version' is distinct from to_jsonb(v_d.version)
    then v_block:=array_append(v_block,'PREMIUM_SEMANTIC_NOT_PASSED'); end if;
    -- Re-audit only the actual frozen market document. Current private stock QA
    -- and member scores are diagnostics, not alternative market authorities.
    v_ai:=jsonb_build_object('canonical_market_state',v_d.generated_text->'canonical_market_state',
      'research_master_v2',v_d.generated_text#>'{canonical_market_state,document}',
      'stock_research',v_d.generated_text->'stock_research',
      'market_report_gate',v_d.generated_text->'market_report_gate',
      'report_date',p_business_date,'today_date',p_business_date,'decision_mode',v_d.decision_mode,
      'canonical_action',v_d.action,'report_status',v_d.status,'data_quality',v_d.generated_text->'data_quality',
      'today_quote',v_d.generated_text->>'daily_sentence',
      'today_beneficiary_stocks',v_d.generated_text->'recommendations',
      'today_beneficiary_stocks_v10',v_d.generated_text->'recommendations');
    if v_m.id is not null and v_sem.id is not null then
      v_validation:=public.validate_core_market_publication_v1(p_business_date,v_ai,to_jsonb(v_d),
        v_m.canonical_contract,v_m.member_content,v_sem.result);
    else
      v_validation:=jsonb_build_object('schema_version','CORE_MARKET_VALIDATION_V1','eligible',false,
        'report_date',p_business_date,'reason_codes',jsonb_build_array('PERSISTED_MEMBER_SEMANTIC_RECEIPT_MISSING'));
    end if;
    if v_validation->'eligible' is distinct from 'true'::jsonb then v_block:=array_append(v_block,'CORE_MARKET_PUBLICATION_UNVERIFIED'); end if;
    if v_source_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
      or not coalesce((v_source_run.provider_status#>>'{manifest,market_count}')::numeric>0,false)
      or not coalesce((v_source_run.provider_status#>>'{manifest,news_count}')::numeric>0,false)
      or not coalesce((v_source_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)
      or not exists(select 1 from public.research_sessions where id=v_d.research_session_id
        and trading_date=p_business_date and data_as_of is not null)
      then v_block:=array_append(v_block,'SOURCE_COMPLETENESS_UNVERIFIED'); end if;
    if not exists(select 1 from public.editorial_reviews where decision_snapshot_id=v_d.id
      and review_status='APPROVED' and content_score>=90 and cardinality(reason_codes)=0)
      then v_block:=array_append(v_block,'EDITORIAL_NOT_APPROVED'); end if;
    select count(*),max(sent_at) into v_line_count,v_line_time from public.line_delivery_outbox
      where report_date=p_business_date and push_type='daily_report' and status='SENT' and decision_snapshot_id=v_d.id;
    if v_line_count=0 or exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='daily_report'
      and (status<>'SENT' or decision_snapshot_id is distinct from v_d.id or sent_at is null)) then
      v_block:=array_append(v_block,'NORMAL_REPORT_LINE_NOT_COMPLETE'); end if;
    if exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='daily_report'
      group by line_subscriber_id having count(*)>1) then v_block:=array_append(v_block,'DUPLICATE_REPORT_DELIVERY'); end if;
    if v_line_time is not null and v_line_time >= (p_business_date::text||'T08:45:00+08:00')::timestamptz
      then v_block:=array_append(v_block,'READINESS_WINDOW_DEADLINE_EXCEEDED'); end if;
    if v_line_time is null or v_line_time > (p_business_date::text||'T07:30:00+08:00')::timestamptz
      or (v_line_time at time zone 'Asia/Taipei')::date<>p_business_date then v_auto_block:=array_append(v_auto_block,'REPORT_DELIVERY_NOT_ON_TIME'); end if;
    if not exists(select 1 from public.ma_ops_runs where check_type='report' and status='passed'
      and details_json->>'target_date'=p_business_date::text and completed_at>=v_d.created_at)
      then v_block:=array_append(v_block,'PREMARKET_HEALTH_UNVERIFIED'); end if;
    if exists(select 1 from public.content_os_sync_incidents where business_date=p_business_date and status='OPEN')
      then v_block:=array_append(v_block,'CONTENT_HANDOFF_INCIDENT'); end if;
    foreach v_symbol in array array['TAIEX','2330','TXF','NVDA','TSM','SPX'] loop
      if not exists(select 1 from public.market_checkpoint_snapshots e
        where trading_date=p_business_date and checkpoint='PREMARKET' and market_session='premarket'
          and symbol=v_symbol and value is not null and change_percent is not null
          and value::text not in ('NaN','Infinity','-Infinity') and change_percent::text not in ('NaN','Infinity','-Infinity')
          and (captured_at at time zone 'Asia/Taipei')::date=p_business_date
          and captured_at < (p_business_date::text||'T08:45:00+08:00')::timestamptz
          and source_timestamp<=captured_at+interval '60 seconds' and source_timestamp<=created_at and captured_at<=created_at and coalesce(source,'')<>''
          and correlation_id::text=v_day.checkpoint_status#>>'{premarket,correlation_id}'
          and raw->>'contract'='FETCH_CHECKPOINT_EVIDENCE_V1' and exists(select 1 from public.market_data_snapshots m
           where m.trading_date=e.trading_date
            and m.checkpoint=case when e.checkpoint='PREMARKET' then 'premarket' else e.checkpoint end and m.symbol=e.symbol
            and m.phase=e.market_session and m.source=e.source and m.value=e.value
            and m.change_percent=e.change_percent and m.captured_at=e.source_timestamp
            and m.raw->>'correlation_id'=e.correlation_id::text
            and m.raw->>'immutable_snapshot_version'=e.snapshot_version::text
            and m.raw->>'immutable_checkpoint'=e.checkpoint))
        then v_block:=array_append(v_block,'PREMARKET_'||v_symbol||'_PRODUCER_EVIDENCE_MISSING'); end if;
    end loop;
    foreach v_field in array array['0900','0930','1030','1300','1410','1430'] loop
      v_due_at:=(p_business_date::text||'T'||substr(v_field,1,2)||':'||substr(v_field,3,2)||':00+08:00')::timestamptz+interval '5 minutes';
      if v_now<v_due_at then continue; end if;
      if v_day.checkpoint_status#>>array[v_field,'status'] is distinct from 'SUCCEEDED'
        or v_day.checkpoint_status#>>array[v_field,'updated_at'] is null
        or v_day.checkpoint_status#>array[v_field,'metadata','core_batch_complete'] is distinct from 'true'::jsonb
        then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_UNVERIFIED'); end if;
      foreach v_symbol in array array['TAIEX','2330','TXF'] loop
        if not exists(select 1 from public.market_checkpoint_snapshots e where trading_date=p_business_date and checkpoint=v_field
          and market_session=case when v_field in ('1410','1430') then 'close' else 'intraday' end
          and captured_at<=v_now and (captured_at at time zone 'Asia/Taipei')::date=p_business_date
          and symbol=v_symbol and value is not null and change_percent is not null
          and value::text not in ('NaN','Infinity','-Infinity') and change_percent::text not in ('NaN','Infinity','-Infinity')
          and source_timestamp is not null and source_timestamp<=captured_at+interval '60 seconds' and source_timestamp<=created_at and captured_at<=created_at and coalesce(source,'')<>''
          and correlation_id::text=v_day.checkpoint_status#>>array[v_field,'correlation_id'] and exists(select 1 from public.market_data_snapshots m
           where m.trading_date=e.trading_date
            and m.checkpoint=case when e.checkpoint='PREMARKET' then 'premarket' else e.checkpoint end and m.symbol=e.symbol
            and m.phase=e.market_session and m.source=e.source and m.value=e.value
            and m.change_percent=e.change_percent and m.captured_at=e.source_timestamp
            and m.raw->>'correlation_id'=e.correlation_id::text
            and m.raw->>'immutable_snapshot_version'=e.snapshot_version::text
            and m.raw->>'immutable_checkpoint'=e.checkpoint))
          then v_block:=array_append(v_block,'CHECKPOINT_'||v_field||'_'||v_symbol||'_EVIDENCE_MISSING'); end if;
      end loop;
    end loop;
    if v_phase='FULL_DAY' then
      if v_day.current_state is distinct from 'DAY_COMPLETED' then v_block:=array_append(v_block,'DAY_NOT_COMPLETED'); end if;
      v_closing_contract:=v_r.ai_strategy_json->'closing_contract';
      select * into v_c from public.decision_snapshots where id::text=v_closing_contract->>'closing_snapshot_id'
        and report_id=v_r.id and report_date=p_business_date and session_type='CLOSING' and status='FINAL';
      v_close:=v_c.generated_text->'closing_verification_v2';
      begin
        v_close_ok:=v_closing_contract->>'schema_version'='CORE_CLOSING_V1'
          and v_closing_contract->>'status'='COMPLETE' and v_closing_contract->>'market_evaluation'='COMPLETE'
          and v_closing_contract->>'report_date'=p_business_date::text
          and v_closing_contract->>'opening_publication_revision_id'=v_revision
          and v_closing_contract->'reason_codes'='[]'::jsonb and v_closing_contract->'market_reason_codes'='[]'::jsonb
          and v_c.id is not null and v_c.coverage_score=100 and v_c.source_freshness->>'status'='complete'
          and v_close->>'status'='completed' and v_close->>'data_status'='complete'
          and v_close->>'report_date'=p_business_date::text
          and v_close->>'opening_decision_snapshot_id'=v_revision
          and v_close->'opening_decision_snapshot_version'=to_jsonb(v_d.version)
          and v_c.generated_text->>'opening_decision_snapshot_id'=v_revision
          and v_c.generated_text->'opening_decision_snapshot_version'=to_jsonb(v_d.version)
          and nullif(v_close->>'evidence_fingerprint','') is not null
          and v_c.generated_text->>'evidence_fingerprint'=v_close->>'evidence_fingerprint'
          and v_closing_contract->>'evidence_fingerprint'=v_close->>'evidence_fingerprint'
          and v_close->>'actual_direction' in ('up','down','flat') and v_close->>'hit_or_miss' in ('hit','miss','partial')
          and (v_close->>'verified_at')::timestamptz >= (p_business_date::text||'T14:10:00+08:00')::timestamptz
          and ((v_close->>'verified_at')::timestamptz at time zone 'Asia/Taipei')::date=p_business_date
          and v_c.valid_from>=(v_close->>'verified_at')::timestamptz and v_c.valid_from<=v_now
          and (v_c.valid_from at time zone 'Asia/Taipei')::date=p_business_date;
        if v_d.decision_mode in ('market_only','no_trade') then
          v_close_ok:=v_close_ok and v_closing_contract->>'stock_evaluation'='NOT_APPLICABLE'
            and v_close->'predicted_beneficiary_stocks'='[]'::jsonb
            and v_close#>'{beneficiary_list_validation,items}'='[]'::jsonb;
        end if;
        foreach v_field in array array['actual_taiex_close','actual_2330_close','actual_txf_close'] loop
          v_quote:=v_close->v_field;
          v_symbol:=v_quote->>'symbol';
          if not coalesce(v_symbol=any(case v_field
            when 'actual_taiex_close' then array['TAIEX','^TWII','TWII']
            when 'actual_2330_close' then array['2330','2330.TW','TSMC_TW']
            else array['TXF','TX','TXF1','MTX'] end),false)
            or jsonb_typeof(v_quote->'value') is distinct from 'number'
            or jsonb_typeof(v_quote->'change_percent') is distinct from 'number'
            or not coalesce((v_quote->>'phase'='close' and v_quote->>'trading_date'=p_business_date::text)
              or (v_close->>'version'='S2_P2_CLOSE_VERIFICATION_V2'
                and v_close#>>'{data_source,table}'='market_data_snapshots'
                and v_close#>'{data_source,no_fake_data}'='true'::jsonb),false)
            or not exists(select 1 from public.market_data_snapshots s where s.trading_date=p_business_date and s.phase='close'
              and s.symbol=v_symbol and s.source=v_quote->>'source' and s.value=(v_quote->>'value')::numeric
              and s.change_percent=(v_quote->>'change_percent')::numeric and s.value>0
              and s.value::text not in ('NaN','Infinity','-Infinity') and s.change_percent::text not in ('NaN','Infinity','-Infinity')
              and s.captured_at=(v_quote->>'captured_at')::timestamptz
              and s.captured_at between (p_business_date::text||'T13:30:00+08:00')::timestamptz and (p_business_date::text||'T18:00:00+08:00')::timestamptz
              and (v_field<>'actual_txf_close' or s.captured_at>=(p_business_date::text||'T13:40:00+08:00')::timestamptz)
              and (not(v_quote?'phase') or v_quote->>'phase'='close')
              and (not(v_quote?'trading_date') or v_quote->>'trading_date'=p_business_date::text)
              and (not(v_quote?'source_at') or ((v_quote->>'source_at')::timestamptz<=s.captured_at
                and ((v_quote->>'source_at')::timestamptz at time zone 'Asia/Taipei')::date=p_business_date
                and (v_quote->>'source_at')::timestamptz>=(p_business_date::text||case when v_field='actual_txf_close' then 'T13:40:00+08:00' else 'T13:25:00+08:00' end)::timestamptz))
              and (s.raw->>'returned_date' is null or ((s.raw->>'returned_date')::timestamptz<=s.captured_at
                and ((s.raw->>'returned_date')::timestamptz at time zone 'Asia/Taipei')::date=p_business_date
                and (s.raw->>'returned_date')::timestamptz>=(p_business_date::text||case when v_field='actual_txf_close' then 'T13:40:00+08:00' else 'T13:25:00+08:00' end)::timestamptz))
              and s.captured_at<=(v_close->>'verified_at')::timestamptz and coalesce(s.source,'')<>'') then
            v_close_ok:=false; v_block:=array_append(v_block,'CLOSING_'||upper(v_field)||'_EVIDENCE_MISSING');
          end if;
        end loop;
      exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        v_close_ok:=false;
      end;
      if v_close_ok is distinct from true then v_block:=array_append(v_block,'CLOSING_REVISION_UNVERIFIED'); end if;
      -- Actual CLE producer stores its contract on the durable run and the
      -- lifecycle checkpoint, not in reports.ai_strategy_json.
      v_learning_contract:=v_day.checkpoint_status#>'{continuous_learning,metadata,learning_contract}';
      select * into v_learning from public.learning_runs where run_date=p_business_date and status='succeeded'
        and completed_at is not null and completed_at<=v_now
        and id::text=v_day.checkpoint_status#>>'{continuous_learning,metadata,run_id}'
        and v_day.checkpoint_status#>>'{continuous_learning,status}'='SUCCEEDED'
        and metadata#>>'{learning_contract,opening_publication_revision_id}'=v_revision
        and metadata->'learning_contract'=v_learning_contract order by completed_at limit 1;
      -- Same one-sample selection as selectLearningPredictionSamples: preserve
      -- historical rows, choose the highest valid revision, do not count both.
      select * into v_prediction from public.learning_predictions p where p.report_date=p_business_date
        and p.report_id=v_r.id and p.decision_snapshot_id=v_d.id and p.prediction_scope='market' and p.symbol='TAIEX'
        and p.analysis_window='PREMARKET' and p.record_status='valid' and p.data_quality_status in ('complete','degraded')
        order by p.revision desc,p.id desc limit 1;
      v_market_predictions:=case when v_prediction.id is null then 0 else 1 end;
      begin
      v_learning_ok:=v_close_ok and v_learning_contract->>'schema_version'='CORE_LEARNING_V1'
        and v_learning_contract->>'status'='COMPLETE' and v_learning_contract->>'report_date'=p_business_date::text
        and v_learning_contract->>'opening_publication_revision_id'=v_revision
        and v_learning_contract->'reason_codes'='[]'::jsonb and v_learning_contract->'market_reason_codes'='[]'::jsonb
        and v_market_predictions=1 and v_learning.id is not null
        and exists(select 1 from public.learning_predictions p join public.prediction_outcomes o on o.prediction_id=p.id
          join public.market_data_snapshots s on s.trading_date=p_business_date and s.phase='close' and s.symbol='TAIEX'
          where p.id=v_prediction.id and p.report_date=p_business_date and p.report_id=v_r.id and p.decision_snapshot_id=v_d.id
            and p.prediction_scope='market' and p.symbol='TAIEX' and p.analysis_window='PREMARKET'
            and p.record_status='valid' and p.data_quality_status='complete'
            and p.prediction_at=v_d.valid_from and o.horizon='close' and o.target_date=p_business_date
            and o.status='completed' and o.data_quality_status='complete' and o.direction_correct is not null
            and o.return_percent is not null and o.return_percent::text not in ('NaN','Infinity','-Infinity')
            and o.return_percent=s.change_percent and s.value>0 and s.value::text not in ('NaN','Infinity','-Infinity')
            and o.evaluated_at>=s.captured_at and o.evaluated_at>=p.prediction_at and o.evaluated_at<=v_learning.completed_at
            and s.captured_at between (p_business_date::text||'T13:30:00+08:00')::timestamptz and (p_business_date::text||'T18:00:00+08:00')::timestamptz
            and s.symbol=v_close#>>'{actual_taiex_close,symbol}' and s.source=v_close#>>'{actual_taiex_close,source}'
            and s.captured_at=(v_close#>>'{actual_taiex_close,captured_at}')::timestamptz
            and exists(select 1 from jsonb_array_elements(o.source_refs) ref where ref->>'table'='market_data_snapshots'
              and ref->>'symbol'=s.symbol and ref->>'phase'='close' and ref->>'trading_date'=p_business_date::text
              and ref->>'source'=s.source and (ref->>'captured_at')::timestamptz=s.captured_at
              and (not(ref?'value') or ref->'value'=to_jsonb(s.value))
              and (not(ref?'change_percent') or ref->'change_percent'=to_jsonb(s.change_percent))));
      if v_d.decision_mode in ('market_only','no_trade') then
        v_learning_ok:=v_learning_ok and v_learning_contract->>'stock_evaluation'='NOT_APPLICABLE'
          and not exists(select 1 from public.learning_predictions p where p.report_date=p_business_date
            and p.decision_snapshot_id=v_d.id and p.prediction_scope='symbol' and p.record_status='valid');
      end if;
      exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
        v_learning_ok:=false;
      end;
      if v_learning_ok is distinct from true then v_block:=array_append(v_block,'LEARNING_REVISION_UNVERIFIED'); end if;
      if not exists(select 1 from public.ma_ops_runs where check_type='closing' and status='passed'
        and details_json->>'target_date'=p_business_date::text and completed_at>=v_c.valid_from)
        then v_block:=array_append(v_block,'CLOSING_HEALTH_UNVERIFIED'); end if;
    end if;
    v_manual:=coalesce(v_source_run.provider_status->>'trigger','') !~ '^(scheduled|daily_generate|daily_retry|daily_watchdog)$'
      or coalesce(v_current_run.provider_status->>'trigger','') !~ '^(scheduled|daily_generate|daily_retry|daily_watchdog)$'
      or exists(select 1 from public.pipeline_runs p where p.trading_date=p_business_date
        and p.idempotency_key like 'research-input:%' and p.status='SUCCEEDED'
        and p.provider_status#>'{result,success}'='true'::jsonb
        and p.provider_status#>>'{result,report_id}'=v_r.id::text
        and p.provider_status#>>'{result,report_date}'=p_business_date::text
        and coalesce(p.provider_status->>'trigger','') !~ '^(scheduled|daily_generate|daily_retry|daily_watchdog)$')
      or exists(select 1 from public.ma_ops_recovery_actions a left join public.ma_ops_runs r on r.id=a.run_id
        where a.status in ('running','succeeded') and (r.details_json->>'target_date'=p_business_date::text
          or a.before_json->>'report_date'=p_business_date::text or a.after_json->>'report_date'=p_business_date::text
          or a.before_json#>>'{request_payload,report_date}'=p_business_date::text
          or a.before_json#>>'{request_payload,target_date}'=p_business_date::text
          or a.after_json#>>'{response,report_date}'=p_business_date::text));
    if v_manual then v_auto_block:=array_append(v_auto_block,'MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER'); end if;
    if not exists(select 1 from public.runtime_http_dispatches h join public.pipeline_runs p
      on h.response_body->>'pipeline_run_id'=p.id::text and p.trading_date=h.trading_date
      where h.trading_date=p_business_date and h.job_name='daily_delivery'
        and h.checkpoint in ('daily_generate','daily_deliver','daily_repair','daily_watchdog')
        and h.dispatch_status='SUCCEEDED' and h.response_success=true and h.http_status between 200 and 299
        and h.response_body->>'report_date'=p_business_date::text and h.response_body->>'decision_snapshot_id'=v_revision
        and p.status='SUCCEEDED' and p.provider_status->>'decision_snapshot_id'=v_revision
        and h.completed_at < (p_business_date::text||'T08:45:00+08:00')::timestamptz)
      then v_auto_block:=array_append(v_auto_block,'AUTOMATION_PROVENANCE_UNVERIFIED'); end if;
    if p_business_date<>v_today then v_auto_block:=array_append(v_auto_block,'HISTORICAL_REPLAY'); end if;
    select count(*) into v_failed from public.runtime_http_dispatches where trading_date=p_business_date and dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED');
    select count(*) into v_dead from public.runtime_dead_letters where status='open'
      and (context->>'trading_date'=p_business_date::text or context->>'dispatch_id' in (select id::text from public.runtime_http_dispatches where trading_date=p_business_date));
    if v_failed<>0 or v_dead<>0 then v_block:=array_append(v_block,'RUNTIME_FAILURE_PRESENT'); end if;
    select count(*) into v_incidents from public.runtime_http_dispatches
      where trading_date=p_business_date and (dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED')
        or (dispatch_status='SKIPPED' and (response_success=false or response_error_code is not null)));
    if v_incidents>0 or exists(select 1 from public.line_delivery_outbox where report_date=p_business_date and push_type='data_incident' and status='SENT')
      then v_auto_block:=array_append(v_auto_block,'PRODUCTION_INCIDENT_RECORDED'); end if;
    v_verdict:=case when cardinality(v_block)=0 then 'PASS' else 'FAIL' end;
  end if;
  v_evidence:=jsonb_build_object('phase',v_phase,'canonical_revision_id',v_revision,'current_revision_id',v_current.id,
    'input_run_id',v_source_run.id,'current_publication_run_id',v_current_run.id,
    'input_fingerprint',v_source_run.provider_status->>'input_fingerprint','engine_version',v_source_run.engine_version,
    'member_revision_id',v_m.id,'learning_run_id',v_learning.id,'closing_snapshot_id',v_c.id,
    'normal_report_line_count',v_line_count,'normal_report_last_sent_at',v_line_time,
    'readiness_deadline_at',(p_business_date::text||'T08:45:00+08:00')::timestamptz,
    'delivery_sla_deadline_at',(p_business_date::text||'T07:30:00+08:00')::timestamptz,
    'lifecycle_status',v_verdict,
    'readiness_status',case when v_line_time is not null
      and v_line_time < (p_business_date::text||'T08:45:00+08:00')::timestamptz then 'PASS' else 'FAIL' end,
    'delivery_sla_status',case when v_line_time is null then 'FAIL'
      when v_line_time <= (p_business_date::text||'T07:30:00+08:00')::timestamptz then 'PASS' else 'MISS' end,
    'recovered_within_readiness_window',v_line_time is not null
      and v_line_time > (p_business_date::text||'T07:30:00+08:00')::timestamptz
      and v_line_time < (p_business_date::text||'T08:45:00+08:00')::timestamptz,
    'failed_dispatches',v_failed,'open_dead_letters',v_dead,'automatic_blocking_checks',v_auto_block,
    'manual_intervention',v_manual,'automatic_stable_day',v_verdict='PASS' and v_phase='FULL_DAY' and cardinality(v_auto_block)=0,
    'content_handoff_evidence_scope','PROJECTION_CONTRACT_ONLY_NOT_DOWNSTREAM_DELIVERY',
    'trial_started',false,'trading_date',p_business_date,'premium_gate_independent',true,
    'market_validation',v_validation,'member_quality_diagnostic',jsonb_build_object('status',v_m.status,'content_score',v_m.content_score,'evidence_coverage',v_m.evidence_coverage),
    'market_data_pass',not exists(select 1 from unnest(v_block) b where b like 'SOURCE_%' or b like 'PREMARKET_%_PRODUCER_%'),
    'report_pass',not('CANONICAL_NOT_READY'=any(v_block) or 'REPORT_REVISION_MISMATCH'=any(v_block)),
    'research_pass',not('CORE_MARKET_PUBLICATION_UNVERIFIED'=any(v_block)),
    'editorial_pass',not('EDITORIAL_NOT_APPROVED'=any(v_block)),
    'semantic_pass',not('PREMIUM_SEMANTIC_NOT_PASSED'=any(v_block)),
    'publication_pass',not('REPORT_REVISION_MISMATCH'=any(v_block) or 'CURRENT_PUBLICATION_RECEIPT_UNVERIFIED'=any(v_block) or 'INPUT_LINEAGE_UNVERIFIED'=any(v_block) or 'CORE_MARKET_PUBLICATION_UNVERIFIED'=any(v_block)),
    'delivery_pass',not('NORMAL_REPORT_LINE_NOT_COMPLETE'=any(v_block) or 'DUPLICATE_REPORT_DELIVERY'=any(v_block)),
    'checkpoint_pass',not exists(select 1 from unnest(v_block) b where b like 'CHECKPOINT_%'),
    'closing_status',case when v_phase<>'FULL_DAY' then 'WAITING' when exists(select 1 from unnest(v_block) b where b like 'CLOSING_%') then 'FAIL' else 'PASS' end,
    'learning_status',case when v_phase<>'FULL_DAY' then 'WAITING' when 'LEARNING_REVISION_UNVERIFIED'=any(v_block) then 'FAIL' else 'PASS' end,
    'frontend_status','EXTERNAL_SMOKE_REQUIRED','incident_count',coalesce(v_incidents,0)+coalesce(v_dead,0));
  if v_verdict='NOT_DUE' then
    v_evidence:=v_evidence||'{"market_data_pass":null,"report_pass":null,"research_pass":null,"editorial_pass":null,"semantic_pass":null,"publication_pass":null,"delivery_pass":null,"checkpoint_pass":null}'::jsonb;
  end if;
  v_version:=p_evaluator_version||':CORE_CONSOLIDATION_V1:'||v_phase||':'||coalesce(v_revision,'none')||':'||md5((v_evidence||jsonb_build_object('blocking',v_block))::text);
  v_key:=p_business_date::text||':'||v_version;
  insert into public.production_acceptance_results(business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence)
    values(p_business_date,v_version,v_key,v_verdict,v_block,v_evidence)
    on conflict(idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.production_acceptance_results where idempotency_key=v_key; end if;
  return v_id;
end; $_$;


--
-- Name: check_runtime_cost_budget_v1(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_runtime_cost_budget_v1(p_usage_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  with policy as (
    select daily_ai_call_budget, daily_ai_token_budget, policy_version
    from public.runtime_quality_policies
    where active = true
    limit 1
  ), usage as (
    select count(*)::integer as calls, coalesce(sum(total_tokens), 0)::bigint as tokens
    from public.runtime_cost_usage
    where usage_date = p_usage_date
      and provider = 'openai'
      and status in ('succeeded', 'degraded')
  )
  select jsonb_build_object(
    'policy_version', policy.policy_version,
    'allowed', usage.calls < policy.daily_ai_call_budget and usage.tokens < policy.daily_ai_token_budget,
    'calls', usage.calls,
    'tokens', usage.tokens,
    'remaining_calls', greatest(0, policy.daily_ai_call_budget - usage.calls),
    'remaining_tokens', greatest(0, policy.daily_ai_token_budget - usage.tokens),
    'reason_codes', array_remove(array[
      case when usage.calls >= policy.daily_ai_call_budget then 'daily_ai_call_budget_exhausted' end,
      case when usage.tokens >= policy.daily_ai_token_budget then 'daily_ai_token_budget_exhausted' end
    ], null)
  )
  from policy cross join usage;
$$;


--
-- Name: line_delivery_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_delivery_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    decision_snapshot_id uuid,
    line_subscriber_id uuid NOT NULL,
    line_user_id text NOT NULL,
    push_type text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 8 NOT NULL,
    next_retry_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_expires_at timestamp with time zone,
    last_error text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT line_delivery_outbox_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT line_delivery_outbox_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT line_delivery_outbox_push_type_check CHECK ((push_type = ANY (ARRAY['daily_report'::text, 'data_incident'::text, 'market_closed_typhoon'::text]))),
    CONSTRAINT line_delivery_outbox_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'SENT'::text, 'FAILED'::text, 'DEAD_LETTERED'::text])))
);


--
-- Name: claim_line_delivery_outbox_v1(date, uuid, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_line_delivery_outbox_v1(p_report_date date, p_decision_snapshot_id uuid, p_push_type text, p_limit integer DEFAULT 1000, p_lease_seconds integer DEFAULT 180) RETURNS SETOF public.line_delivery_outbox
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if p_report_date is null then raise exception 'report_date is required'; end if;
  if p_push_type not in ('daily_report','data_incident','market_closed_typhoon') then raise exception 'invalid push_type: %',p_push_type; end if;
  return query
  with candidates as (
    select o.id from public.line_delivery_outbox o
    where o.report_date=p_report_date
      and o.decision_snapshot_id is not distinct from p_decision_snapshot_id
      and o.push_type=p_push_type and o.attempt_count<o.max_attempts
      and ((o.status='PENDING' and o.next_retry_at<=clock_timestamp())
        or (o.status='PROCESSING' and o.lease_expires_at<=clock_timestamp()))
      and exists(select 1 from public.line_subscribers s where s.id=o.line_subscriber_id and s.is_active=true)
    order by o.created_at,o.id for update skip locked
    limit greatest(1,least(coalesce(p_limit,1000),1000))
  )
  update public.line_delivery_outbox o set status='PROCESSING',attempt_count=o.attempt_count+1,
    lease_expires_at=clock_timestamp()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,180),600))),updated_at=clock_timestamp()
  from candidates where o.id=candidates.id returning o.*;
end;
$$;


--
-- Name: claim_research_input_v1(date, text, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_research_input_v1(p_report_date date, p_fingerprint text, p_correlation_id uuid, p_engine_version text, p_trigger text, p_manifest jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_run public.pipeline_runs;
  v_key text := 'research-input:' || p_report_date::text || ':' || p_fingerprint;
  v_now timestamptz := clock_timestamp();
begin
  if p_report_date is null or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
    or p_correlation_id is null or coalesce(p_engine_version,'') = '' or coalesce(p_trigger,'') = ''
    or jsonb_typeof(p_manifest) is distinct from 'object' then raise exception 'INPUT_MANIFEST_INCOMPLETE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('research-publication:' || p_report_date::text, 0));
  -- A killed worker must not leave a perpetual RUNNING row. The expired fence
  -- cannot publish; preserve its cause and make bounded retry explicit.
  update public.pipeline_runs set status='FAILED',completed_at=v_now,updated_at=v_now,
    error_code='RESEARCH_LEASE_EXPIRED',reason_codes=array['RESEARCH_LEASE_EXPIRED'],
    next_retry_at=case when attempt<3 then v_now else null end,
    provider_status=provider_status||jsonb_build_object('result',jsonb_build_object('success',false,'error_code','RESEARCH_LEASE_EXPIRED'))
  where trading_date=p_report_date and idempotency_key like 'research-input:%' and status='RUNNING'
    and (provider_status->>'lease_expires_at')::timestamptz<=v_now;
  select * into v_run from public.pipeline_runs where idempotency_key = v_key for update;
  if found then
    if v_run.status in ('SUCCEEDED','DEGRADED','SKIPPED') then
      return jsonb_build_object('status','REUSED','run_id',v_run.id,'outcome',v_run.status,'result',v_run.provider_status->'result');
    end if;
    if v_run.attempt >= 3 and (v_run.status <> 'RUNNING' or (v_run.provider_status->>'lease_expires_at')::timestamptz <= v_now) then
      return jsonb_build_object('status','EXHAUSTED','run_id',v_run.id);
    end if;
    if v_run.status = 'FAILED' and (v_run.next_retry_at is null or v_run.next_retry_at > v_now) then
      return jsonb_build_object('status','BACKOFF','run_id',v_run.id);
    end if;
  end if;
  if exists(select 1 from public.pipeline_runs where trading_date = p_report_date
    and idempotency_key like 'research-input:%' and status = 'RUNNING'
    and (provider_status->>'lease_expires_at')::timestamptz > v_now) then
    return jsonb_build_object('status','IN_PROGRESS');
  end if;
  insert into public.pipeline_runs(trading_date,checkpoint,idempotency_key,status,attempt,started_at,
    correlation_id,engine_version,provider_status)
  values(p_report_date,'PREMARKET',v_key,'RUNNING',1,v_now,p_correlation_id,p_engine_version,
    jsonb_build_object('input_fingerprint',p_fingerprint,'manifest',p_manifest,'trigger',p_trigger,
      'lease_expires_at',v_now + interval '5 minutes','attempt_history','[]'::jsonb))
  on conflict(idempotency_key) do update set
    status='RUNNING',attempt=public.pipeline_runs.attempt+1,started_at=v_now,completed_at=null,
    correlation_id=p_correlation_id,next_retry_at=null,updated_at=v_now,
    provider_status=public.pipeline_runs.provider_status || jsonb_build_object('trigger',p_trigger,
      'lease_expires_at',v_now + interval '5 minutes',
      'attempt_history',coalesce(public.pipeline_runs.provider_status->'attempt_history','[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('attempt',public.pipeline_runs.attempt,'status',public.pipeline_runs.status,
          'started_at',public.pipeline_runs.started_at,'completed_at',public.pipeline_runs.completed_at,
          'correlation_id',public.pipeline_runs.correlation_id,'trigger',public.pipeline_runs.provider_status->'trigger',
          'result',public.pipeline_runs.provider_status->'result')))
  returning * into v_run;
  return jsonb_build_object('status','ACQUIRED','run_id',v_run.id,'attempt',v_run.attempt);
end; $_$;


--
-- Name: classify_runtime_quality_block_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.classify_runtime_quality_block_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user = 'postgres'
     and old.dispatch_status = 'FAILED'
     and new.dispatch_status = 'SKIPPED'
     and new.response_error_code = 'SUPERSEDED_BY_DURABLE_STATE'
     and new.response_body #>> '{terminal_reconciliation,reason_code}' = 'SUPERSEDED_BY_DURABLE_STATE'
     and nullif(new.response_body #>> '{terminal_reconciliation,correlation_id}', '') is not null
  then
    return new;
  end if;

  if new.http_status = 409 and coalesce(new.response_success, false) = false then
    new.dispatch_status := 'FAILED';
    new.response_error_code := 'QUALITY_BLOCK';
    new.next_retry_at := null;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;


--
-- Name: cle_audit_rule_change_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cle_audit_rule_change_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.status is distinct from new.status
    or old.condition_json is distinct from new.condition_json
    or old.action_json is distinct from new.action_json
  then
    insert into public.learning_audit_logs (
      entity_type,
      entity_id,
      action,
      actor_type,
      actor_id,
      before_json,
      after_json,
      reason
    ) values (
      'learning_rule',
      new.id,
      case when new.status = 'production' then 'promoted' else 'updated' end,
      case when new.promoted_by is null then 'system' else 'admin' end,
      new.promoted_by,
      jsonb_build_object(
        'status', old.status,
        'version', old.version,
        'condition', old.condition_json,
        'action', old.action_json
      ),
      jsonb_build_object(
        'status', new.status,
        'version', new.version,
        'condition', new.condition_json,
        'action', new.action_json,
        'promotion_evidence', new.promotion_evidence
      ),
      new.promotion_reason
    );
  end if;
  return new;
end;
$$;


--
-- Name: cle_guard_rule_promotion_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cle_guard_rule_promotion_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if old.status is distinct from 'production' and new.status = 'production' then
    if new.promoted_by is null
      or nullif(btrim(new.promotion_reason), '') is null
      or not exists (
        select 1
        from public.profiles as profile
        where profile.id = new.promoted_by
          and lower(coalesce(profile.role, '')) = 'admin'
      )
      or new.shadow_sample_size < 10
      or new.shadow_completed_at is null
      or not exists (
        select 1
        from public.rule_backtests as backtest
        where backtest.rule_id = new.id
          and backtest.status = 'passed'
          and backtest.out_of_sample_size >= 10
      )
    then
      raise exception 'production promotion requires admin identity, reason, completed shadow sample and passed out-of-sample backtest'
        using errcode = '23514';
    end if;
    new.promoted_at := coalesce(new.promoted_at, clock_timestamp());
  end if;
  return new;
end;
$$;


--
-- Name: cle_prevent_audit_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cle_prevent_audit_mutation_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'learning_audit_logs are append-only'
    using errcode = '55000';
end;
$$;


--
-- Name: cle_prevent_prediction_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cle_prevent_prediction_mutation_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'learning_predictions are append-only; create a revision instead'
    using errcode = '55000';
end;
$$;


--
-- Name: cle_set_updated_at_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cle_set_updated_at_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


--
-- Name: commit_market_checkpoint_batch_v1(date, text, text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commit_market_checkpoint_batch_v1(p_business_date date, p_checkpoint text, p_market_session text, p_correlation_id uuid, p_idempotency_key text, p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_expected constant text[] := public.market_checkpoint_provider_contract_v1();
  v_contract constant text := 'MARKET_CHECKPOINT_PROVIDER_V1';
  v_expected_key text;
  v_expected_session text;
  v_compatibility_phase text;
  v_compatibility_checkpoint text;
  v_batch_id uuid;
  v_existing public.market_checkpoint_batches;
  v_payload_hash text;
  v_rows jsonb;
  v_integrity jsonb;
  v_count integer;
  v_distinct_count integer;
  v_txf_expected_session_date date;
  v_tw_cash_expected_session_date date;
  v_inserted integer;
begin
  if p_business_date is null or p_business_date <= date '2026-09-11' then
    raise exception 'ATOMIC_CHECKPOINT_CUTOVER_REJECTED:%', p_business_date;
  end if;
  if p_checkpoint not in ('PREMARKET','0900','0930','1030','1300','1410','1430','RECOVERY') then
    raise exception 'INVALID_ATOMIC_CHECKPOINT:%', p_checkpoint;
  end if;
  if p_correlation_id is null then
    raise exception 'ATOMIC_CHECKPOINT_CORRELATION_REQUIRED';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'ATOMIC_CHECKPOINT_ROWS_ARRAY_REQUIRED';
  end if;

  v_expected_session := case
    when p_checkpoint = 'PREMARKET' then 'premarket'
    when p_checkpoint in ('0900','0930','1030','1300') then 'intraday'
    when p_checkpoint in ('1410','1430') then 'close'
    when p_checkpoint = 'RECOVERY' then 'recovery'
  end;
  if p_market_session is distinct from v_expected_session then
    raise exception 'ATOMIC_CHECKPOINT_SESSION_MISMATCH:%:%', p_checkpoint, p_market_session;
  end if;

  v_expected_key := 'market-checkpoint:' || p_business_date::text || ':' || p_checkpoint || ':' || v_contract;
  if p_idempotency_key is distinct from v_expected_key then
    raise exception 'ATOMIC_CHECKPOINT_IDEMPOTENCY_MISMATCH';
  end if;

  select count(*), count(distinct row_value->>'provider_key')
    into v_count, v_distinct_count
  from jsonb_array_elements(p_rows) row_value;
  if v_count <> cardinality(v_expected) or v_distinct_count <> cardinality(v_expected) then
    raise exception 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY:%:%', v_count, v_distinct_count;
  end if;
  if exists (
    select expected.provider_key
    from unnest(v_expected) expected(provider_key)
    except
    select row_value->>'provider_key' from jsonb_array_elements(p_rows) row_value
  ) or exists (
    select row_value->>'provider_key' from jsonb_array_elements(p_rows) row_value
    except
    select expected.provider_key from unnest(v_expected) expected(provider_key)
  ) then
    raise exception 'ATOMIC_CHECKPOINT_PROVIDER_SET_MISMATCH';
  end if;

  if p_checkpoint = 'PREMARKET' then
    v_txf_expected_session_date := p_business_date - 1;
    while extract(isodow from v_txf_expected_session_date) in (6, 7)
      or v_txf_expected_session_date = any(array[
        date '2026-01-01', date '2026-02-16', date '2026-02-17', date '2026-02-18',
        date '2026-02-19', date '2026-02-20', date '2026-02-27', date '2026-04-03',
        date '2026-04-06', date '2026-06-19', date '2026-07-10', date '2026-09-25',
        date '2026-10-09'
      ])
    loop
      v_txf_expected_session_date := v_txf_expected_session_date - 1;
    end loop;
  end if;
  v_tw_cash_expected_session_date := case
    when p_market_session = 'premarket' then v_txf_expected_session_date
    else p_business_date
  end;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    where jsonb_typeof(row_value) is distinct from 'object'
      or row_value->>'provider_key' is distinct from row_value->>'symbol'
      or jsonb_typeof(row_value->'value') is distinct from 'number'
      or (row_value->>'value')::numeric <= 0
      or jsonb_typeof(row_value->'change_percent') is distinct from 'number'
      or jsonb_typeof(row_value->'raw') is distinct from 'object'
      or jsonb_typeof(row_value->'raw'->'change') is distinct from 'number'
      or row_value->'raw'->>'contract' is distinct from 'FETCH_CHECKPOINT_EVIDENCE_V1'
      or coalesce(row_value->'raw'->>'market', '') not in ('TW','US')
      or coalesce(row_value->'raw'->>'freshness_status', '') not in ('fresh','provider_returned')
      or jsonb_typeof(row_value->'raw'->'freshness_age_minutes') is distinct from 'number'
      or coalesce(row_value->'raw'->>'captured_session_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or nullif(btrim(row_value->>'source'), '') is null
      or length(btrim(row_value->>'source')) > 120
      or nullif(row_value->>'captured_at', '') is null
      or nullif(row_value->>'source_timestamp', '') is null
      or ((row_value->>'captured_at')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date
      or (row_value->>'source_timestamp')::timestamptz > (row_value->>'captured_at')::timestamptz + interval '60 seconds'
      or (row_value->>'source_timestamp')::timestamptz < (row_value->>'captured_at')::timestamptz - interval '7 days'
      or (row_value->'raw'->>'market' = 'TW' and (
        (row_value->>'provider_key' in ('TAIEX', '2330') and (
          v_tw_cash_expected_session_date is null
          or (p_market_session = 'premarket' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_PREMARKET_LATEST_COMPLETED_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'premarket'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from v_tw_cash_expected_session_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from v_tw_cash_expected_session_date::text
            or row_value->'raw'->'source_raw'->>'evidence_session_date' is distinct from v_tw_cash_expected_session_date::text
            or coalesce(
              row_value->'raw'->'source_raw'->>'provider_envelope_date',
              row_value->'raw'->'source_raw'->>'response_date',
              row_value->'raw'->'source_raw'->>'date'
            ) not in (v_tw_cash_expected_session_date::text, p_business_date::text)
            or row_value->'raw'->'source_raw'->>'response_date' is distinct from coalesce(
              row_value->'raw'->'source_raw'->>'provider_envelope_date',
              row_value->'raw'->'source_raw'->>'response_date',
              row_value->'raw'->'source_raw'->>'date'
            )
            or row_value->'raw'->'source_raw'->>'date' is distinct from coalesce(
              row_value->'raw'->'source_raw'->>'provider_envelope_date',
              row_value->'raw'->'source_raw'->>'response_date',
              row_value->'raw'->'source_raw'->>'date'
            )
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> v_tw_cash_expected_session_date
          ))
          or (p_market_session = 'intraday' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_INTRADAY_CURRENT_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'intraday'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from p_business_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from p_business_date::text
            or coalesce(row_value->'raw'->'source_raw'->>'response_date', row_value->'raw'->'source_raw'->>'date') is distinct from p_business_date::text
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '09:00'
          ))
          or (p_market_session = 'close' and (
            row_value->'raw'->>'tw_cash_session_contract' is distinct from 'TW_CASH_CLOSE_CURRENT_COMPLETED_SESSION_V1'
            or row_value->'raw'->>'tw_cash_phase' is distinct from 'close'
            or row_value->'raw'->>'tw_cash_expected_session_date' is distinct from p_business_date::text
            or row_value->'raw'->>'tw_cash_provider_session_date' is distinct from p_business_date::text
            or coalesce(row_value->'raw'->'source_raw'->>'response_date', row_value->'raw'->'source_raw'->>'date') is distinct from p_business_date::text
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date
            or ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '13:25'
          ))
          or (p_market_session not in ('premarket', 'intraday', 'close')
            and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date)
        ))
        or (row_value->>'provider_key' = 'TXF' and p_checkpoint <> 'PREMARKET'
          and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date <> p_business_date)
        or (row_value->>'provider_key' = 'TXF' and p_checkpoint = 'PREMARKET' and (
          v_txf_expected_session_date is null
          or row_value->'raw'->>'txf_session_contract' is distinct from 'TXF_PREMARKET_SESSION_V1'
          or row_value->'raw'->>'txf_expected_previous_trading_date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->>'txf_provider_session_date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->'source_raw'->>'date' is distinct from v_txf_expected_session_date::text
          or row_value->'raw'->>'txf_session_type' is distinct from row_value->'raw'->'source_raw'->>'session'
          or coalesce(row_value->'raw'->'source_raw'->>'session', '') not in ('afterhours', 'regular')
          or not case row_value->'raw'->'source_raw'->>'session'
            when 'afterhours' then
              (((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date
                and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time >= time '15:00')
              or (((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date + 1
                and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '05:01')
            when 'regular' then
              ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::date = v_txf_expected_session_date
              and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time >= time '08:45'
              and ((row_value->>'source_timestamp')::timestamptz at time zone 'Asia/Taipei')::time < time '13:46'
            else false
          end
        ))
      ))
  ) then
    raise exception 'ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) row_value
    where case p_checkpoint
      when 'PREMARKET' then (row_value->>'captured_at')::timestamptz > (p_business_date::text || case when p_business_date <= date '2026-09-17' then 'T07:35:00+08:00' else 'T08:44:59.999999+08:00' end)::timestamptz
      when '0900' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T09:00:00+08:00')::timestamptz and (p_business_date::text || 'T09:14:59.999999+08:00')::timestamptz
      when '0930' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T09:25:00+08:00')::timestamptz and (p_business_date::text || 'T09:44:59.999999+08:00')::timestamptz
      when '1030' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T10:25:00+08:00')::timestamptz and (p_business_date::text || 'T10:44:59.999999+08:00')::timestamptz
      when '1300' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T12:55:00+08:00')::timestamptz and (p_business_date::text || 'T13:14:59.999999+08:00')::timestamptz
      when '1410' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T14:10:00+08:00')::timestamptz and (p_business_date::text || 'T14:24:59.999999+08:00')::timestamptz
      when '1430' then (row_value->>'captured_at')::timestamptz not between
        (p_business_date::text || 'T14:30:00+08:00')::timestamptz and (p_business_date::text || 'T14:44:59.999999+08:00')::timestamptz
      else false
    end
  ) then
    raise exception 'ATOMIC_CHECKPOINT_COLLECTION_TIME_INVALID';
  end if;

  select md5(jsonb_agg(
    jsonb_build_object(
      'provider_key', row_value->>'provider_key',
      'symbol', row_value->>'symbol',
      'value', row_value->'value',
      'change_percent', row_value->'change_percent',
      'source', row_value->>'source',
      'source_timestamp', row_value->>'source_timestamp',
      'captured_at', row_value->>'captured_at',
      'raw', row_value->'raw'
    ) order by row_value->>'provider_key'
  )::text) into v_payload_hash
  from jsonb_array_elements(p_rows) row_value;

  perform pg_advisory_xact_lock(hashtextextended(
    'market-checkpoint-atomic:' || p_business_date::text || ':' || p_checkpoint, 0
  ));

  if exists (
    select 1 from public.market_checkpoint_snapshots
    where trading_date = p_business_date and checkpoint = p_checkpoint and batch_id is null
  ) then
    raise exception 'LEGACY_CHECKPOINT_EVIDENCE_EXISTS:%:%', p_business_date, p_checkpoint;
  end if;

  select * into v_existing
  from public.market_checkpoint_batches
  where business_date = p_business_date and checkpoint = p_checkpoint;
  if found then
    v_integrity := public.market_checkpoint_batch_integrity_v1(p_business_date, p_checkpoint);
    if v_integrity->>'status' is distinct from 'PASS' then
      raise exception 'EXISTING_ATOMIC_CHECKPOINT_INTEGRITY_VIOLATION';
    end if;
    select jsonb_agg(to_jsonb(snapshot_row) order by array_position(v_expected, snapshot_row.provider_key))
      into v_rows
    from public.market_checkpoint_snapshots snapshot_row
    where snapshot_row.batch_id = v_existing.batch_id;
    return jsonb_build_object(
      'contract', 'MARKET_CHECKPOINT_ATOMIC_COMMIT_V1',
      'status', 'COMMITTED',
      'reused', true,
      'payload_matches', v_existing.payload_hash = v_payload_hash,
      'batch_id', v_existing.batch_id,
      'correlation_id', v_existing.correlation_id,
      'idempotency_key', v_existing.idempotency_key,
      'provider_contract_version', v_existing.provider_contract_version,
      'row_count', jsonb_array_length(v_rows),
      'rows', v_rows
    );
  end if;

  if p_checkpoint = 'PREMARKET' and p_business_date > date '2026-09-17'
    and clock_timestamp() >= (p_business_date + time '08:45') at time zone 'Asia/Taipei' then
    raise exception 'PREMARKET_READINESS_DEADLINE_EXCEEDED';
  end if;
  v_batch_id := gen_random_uuid();
  insert into public.market_checkpoint_batches(
    batch_id, business_date, checkpoint, market_session, correlation_id,
    idempotency_key, provider_contract_version, status,
    expected_provider_count, committed_provider_count, payload_hash
  ) values (
    v_batch_id, p_business_date, p_checkpoint, p_market_session, p_correlation_id,
    p_idempotency_key, v_contract, 'COMMITTED', 11, 11, v_payload_hash
  );

  insert into public.market_checkpoint_snapshots(
    checkpoint, trading_date, captured_at, market_session, symbol, value,
    change_percent, source, source_timestamp, correlation_id, raw,
    batch_id, provider_key, idempotency_key
  )
  select
    p_checkpoint,
    p_business_date,
    (row_value->>'captured_at')::timestamptz,
    p_market_session,
    row_value->>'symbol',
    (row_value->>'value')::numeric,
    (row_value->>'change_percent')::numeric,
    row_value->>'source',
    (row_value->>'source_timestamp')::timestamptz,
    p_correlation_id,
    row_value->'raw',
    v_batch_id,
    row_value->>'provider_key',
    p_idempotency_key
  from jsonb_array_elements(p_rows) row_value
  order by array_position(v_expected, row_value->>'provider_key');
  get diagnostics v_inserted = row_count;
  if v_inserted <> 11 then
    raise exception 'ATOMIC_CHECKPOINT_INSERT_COUNT:%', v_inserted;
  end if;

  v_compatibility_phase := case p_market_session when 'recovery' then 'manual_backfill' else p_market_session end;
  v_compatibility_checkpoint := case p_checkpoint
    when 'PREMARKET' then 'premarket'
    when 'RECOVERY' then 'manual'
    else p_checkpoint
  end;

  insert into public.market_data_snapshots(
    symbol, name, market, value, change_percent, captured_at, source,
    phase, trading_date, raw, checkpoint
  )
  select
    snapshot_row.symbol,
    snapshot_row.raw->>'name',
    snapshot_row.raw->>'market',
    snapshot_row.value,
    snapshot_row.change_percent,
    snapshot_row.source_timestamp,
    snapshot_row.source,
    v_compatibility_phase,
    p_business_date,
    jsonb_build_object(
      'provider', snapshot_row.source,
      'source_symbol', snapshot_row.raw->>'source_symbol',
      'display_symbol', snapshot_row.symbol,
      'requested_at', snapshot_row.captured_at,
      'returned_date', snapshot_row.source_timestamp,
      'freshness_status', coalesce(snapshot_row.raw->>'freshness_status', 'provider_returned'),
      'freshness_age_minutes', snapshot_row.raw->'freshness_age_minutes',
      'captured_session_date', snapshot_row.raw->>'captured_session_date',
      'fallback_used', coalesce((snapshot_row.raw->>'fallback_used')::boolean, false),
      'source_raw', coalesce(snapshot_row.raw->'source_raw', '{}'::jsonb),
      'quote', jsonb_build_object(
        'current', snapshot_row.value,
        'change', snapshot_row.raw->'change',
        'change_percent', snapshot_row.change_percent
      ),
      'request_id', left(p_correlation_id::text, 8),
      'correlation_id', p_correlation_id,
      'immutable_snapshot_version', snapshot_row.snapshot_version,
      'immutable_checkpoint', p_checkpoint,
      'checkpoint_batch_id', v_batch_id,
      'checkpoint_idempotency_key', p_idempotency_key,
      'checkpoint_contract_version', v_contract,
      'checkpoint', v_compatibility_checkpoint
    ),
    v_compatibility_checkpoint
  from public.market_checkpoint_snapshots snapshot_row
  where snapshot_row.batch_id = v_batch_id
  order by array_position(v_expected, snapshot_row.provider_key)
  on conflict (symbol, trading_date, phase, checkpoint)
    where raw->>'checkpoint_batch_id' is not null
    do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 11 then
    raise exception 'ATOMIC_CHECKPOINT_COMPATIBILITY_CONFLICT:%', v_inserted;
  end if;

  v_integrity := public.market_checkpoint_batch_integrity_v1(p_business_date, p_checkpoint);
  if v_integrity->>'status' is distinct from 'PASS' then
    raise exception 'ATOMIC_CHECKPOINT_POST_INSERT_INTEGRITY_VIOLATION:%', v_integrity;
  end if;

  select jsonb_agg(to_jsonb(snapshot_row) order by array_position(v_expected, snapshot_row.provider_key))
    into v_rows
  from public.market_checkpoint_snapshots snapshot_row
  where snapshot_row.batch_id = v_batch_id;

  if p_checkpoint = 'PREMARKET' and p_business_date > date '2026-09-17'
    and clock_timestamp() >= (p_business_date + time '08:45') at time zone 'Asia/Taipei' then
    raise exception 'PREMARKET_READINESS_DEADLINE_EXCEEDED';
  end if;
  return jsonb_build_object(
    'contract', 'MARKET_CHECKPOINT_ATOMIC_COMMIT_V1',
    'status', 'COMMITTED',
    'reused', false,
    'payload_matches', true,
    'batch_id', v_batch_id,
    'correlation_id', p_correlation_id,
    'idempotency_key', p_idempotency_key,
    'provider_contract_version', v_contract,
    'row_count', jsonb_array_length(v_rows),
    'rows', v_rows
  );
end;
$_$;


--
-- Name: runtime_http_dispatches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_http_dispatches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trading_date date NOT NULL,
    job_name text NOT NULL,
    checkpoint text NOT NULL,
    endpoint text NOT NULL,
    request_id bigint,
    correlation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    idempotency_key text NOT NULL,
    dispatch_status text DEFAULT 'SCHEDULED'::text NOT NULL,
    http_status integer,
    response_success boolean,
    response_error_code text,
    response_body jsonb,
    request_body jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_backup boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    acknowledged_at timestamp with time zone,
    completed_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    max_retries integer DEFAULT 3 NOT NULL,
    next_retry_at timestamp with time zone,
    deadline_at timestamp with time zone,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_http_dispatches_dispatch_status_check CHECK ((dispatch_status = ANY (ARRAY['SCHEDULED'::text, 'DISPATCHED'::text, 'ACKNOWLEDGED'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'TIMED_OUT'::text, 'DEAD_LETTERED'::text, 'SKIPPED'::text]))),
    CONSTRAINT runtime_http_dispatches_max_retries_check CHECK (((max_retries >= 0) AND (max_retries <= 8))),
    CONSTRAINT runtime_http_dispatches_retry_count_check CHECK ((retry_count >= 0))
);

ALTER TABLE ONLY public.runtime_http_dispatches FORCE ROW LEVEL SECURITY;


--
-- Name: dispatch_morning_alpha_runtime_v1(date, text, text, jsonb, boolean, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dispatch_morning_alpha_runtime_v1(p_trading_date date, p_job_name text, p_checkpoint text, p_body jsonb, p_is_backup boolean DEFAULT false, p_deadline_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS public.runtime_http_dispatches
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'vault'
    AS $$
declare
  v_token text; v_dispatch public.runtime_http_dispatches; v_request_id bigint;
  v_idempotency text; v_corr uuid := gen_random_uuid(); v_completed boolean := false;
begin
  if p_trading_date is null then raise exception 'trading_date_required'; end if;
  if p_job_name not in ('daily_delivery','runtime_checkpoint','continuous_learning','report_health','closing_health') then raise exception 'unsupported_job:%',p_job_name; end if;
  v_idempotency := p_trading_date::text||':'||p_job_name||':'||p_checkpoint;
  perform pg_advisory_xact_lock(hashtextextended(v_idempotency,0));
  select * into v_dispatch from public.runtime_http_dispatches where idempotency_key=v_idempotency for update;
  if v_dispatch.id is not null and v_dispatch.dispatch_status in ('SUCCEEDED','SKIPPED') then return v_dispatch; end if;
  if v_dispatch.id is not null and v_dispatch.dispatch_status in ('DISPATCHED','ACKNOWLEDGED') and v_dispatch.lease_expires_at>now() then return v_dispatch; end if;
  if p_is_backup then
    select upper(coalesce(t.checkpoint_status->p_checkpoint->>'status',''))='SUCCEEDED' into v_completed
    from public.trading_day_state t where t.trading_date=p_trading_date;
    if coalesce(v_completed,false) then
      insert into public.runtime_http_dispatches(trading_date,job_name,checkpoint,endpoint,correlation_id,idempotency_key,dispatch_status,completed_at)
      values(p_trading_date,p_job_name,p_checkpoint,'daily-delivery-orchestrator',v_corr,v_idempotency,'SKIPPED',now())
      on conflict(idempotency_key) do update set dispatch_status='SKIPPED',completed_at=coalesce(runtime_http_dispatches.completed_at,now()),updated_at=now()
      returning * into v_dispatch;
      return v_dispatch;
    end if;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='morning_alpha_daily_delivery_token' order by created_at desc limit 1;
  if v_token is null then raise exception 'morning_alpha_daily_delivery_token_missing'; end if;
  insert into public.runtime_http_dispatches(trading_date,job_name,checkpoint,endpoint,correlation_id,idempotency_key,
    dispatch_status,retry_count,next_retry_at,deadline_at,lease_expires_at,request_body,is_backup)
  values(p_trading_date,p_job_name,p_checkpoint,'daily-delivery-orchestrator',v_corr,v_idempotency,'SCHEDULED',0,null,p_deadline_at,now()+interval '11 minutes',coalesce(p_body,'{}'::jsonb),p_is_backup)
  on conflict(idempotency_key) do update set correlation_id=gen_random_uuid(),dispatch_status='SCHEDULED',retry_count=runtime_http_dispatches.retry_count+1,next_retry_at=null,lease_expires_at=now()+interval '11 minutes',request_body=coalesce(p_body,'{}'::jsonb),is_backup=p_is_backup,http_status=null,response_success=null,response_error_code=null,response_body=null,completed_at=null,updated_at=now()
  returning * into v_dispatch;
  select net.http_post(
    url:='https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-delivery-orchestrator',
    headers:=jsonb_build_object('Content-Type','application/json','x-daily-delivery-token',v_token),
    body:=coalesce(p_body,'{}'::jsonb)||jsonb_build_object('dispatch_id',v_dispatch.id,'correlation_id',v_dispatch.correlation_id,'source',case when p_is_backup then 'supabase_cron_watchdog' else 'supabase_cron_primary' end),
    timeout_milliseconds:=600000) into v_request_id;
  update public.runtime_http_dispatches set request_id=v_request_id,dispatch_status='DISPATCHED',started_at=now(),updated_at=now() where id=v_dispatch.id returning * into v_dispatch;
  insert into public.runtime_http_dispatch_attempts(dispatch_id,attempt,request_id) values(v_dispatch.id,v_dispatch.retry_count+1,v_request_id) on conflict do nothing;
  perform public.advance_trading_day_state_v1(p_trading_date,'SCHEDULED',p_checkpoint,'SCHEDULED',v_dispatch.correlation_id,jsonb_build_object('http_dispatch_id',v_dispatch.id));
  return v_dispatch;
end;
$$;


--
-- Name: enforce_atomic_checkpoint_acceptance_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_atomic_checkpoint_acceptance_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_checkpoint text;
  v_due_at timestamptz;
  v_integrity jsonb;
  v_integrity_map jsonb := '{}'::jsonb;
  v_authoritative_rows bigint;
  v_blocker text;
begin
  if new.business_date < date '2026-09-11' then
    return new;
  end if;

  foreach v_checkpoint in array array['0900','0930','1030','1300','1410','1430'] loop
    v_due_at := (new.business_date::text || 'T' || substr(v_checkpoint,1,2) || ':' || substr(v_checkpoint,3,2) || ':00+08:00')::timestamptz
      + interval '5 minutes';
    if clock_timestamp() < v_due_at then
      continue;
    end if;

    v_integrity := public.market_checkpoint_batch_integrity_v1(new.business_date, v_checkpoint);
    select count(*) into v_authoritative_rows
    from public.authoritative_market_data_snapshots_v1 authoritative
    where authoritative.trading_date = new.business_date
      and authoritative.checkpoint = v_checkpoint;
    v_integrity := v_integrity || jsonb_build_object(
      'authoritative_row_count', v_authoritative_rows,
      'authoritative', v_authoritative_rows = 11
    );
    v_integrity_map := v_integrity_map || jsonb_build_object(v_checkpoint, v_integrity);
    if v_integrity->>'status' is distinct from 'PASS' or v_authoritative_rows <> 11 then
      v_blocker := case
        when v_integrity->>'status' is distinct from 'PASS'
          and coalesce((v_integrity->>'canonical_row_count')::bigint, 0) > 0
          then 'CHECKPOINT_' || v_checkpoint || '_INTEGRITY_VIOLATION'
        when v_integrity->>'status' is distinct from 'PASS'
          then 'CHECKPOINT_' || v_checkpoint || '_ATOMIC_BATCH_MISSING'
        else 'CHECKPOINT_' || v_checkpoint || '_NOT_AUTHORITATIVE'
      end;
      if not (v_blocker = any(coalesce(new.blocking_checks, '{}'::text[]))) then
        new.blocking_checks := array_append(coalesce(new.blocking_checks, '{}'::text[]), v_blocker);
      end if;
      new.verdict := 'FAIL';
    end if;
  end loop;

  if v_integrity_map <> '{}'::jsonb then
    new.evidence := coalesce(new.evidence, '{}'::jsonb) || jsonb_build_object(
      'checkpoint_atomicity', v_integrity_map,
      'checkpoint_pass', not exists (
        select 1 from jsonb_each(v_integrity_map) item
        where item.value->>'status' <> 'PASS' or item.value->>'authoritative' <> 'true'
      ),
      'production_2026_09_11_failure_preserved', new.business_date <> date '2026-09-11'
        or exists (select 1 from jsonb_each(v_integrity_map) item where item.value->>'status' = 'FAIL')
    );
  end if;
  return new;
end;
$$;


--
-- Name: enforce_decision_snapshot_premium_90_gate_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_decision_snapshot_premium_90_gate_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare v_ai jsonb; v_date date; v_result jsonb;
begin
 -- Preserve this trigger's timing/events/attachment. Non-published QA and other
 -- sessions are not market publication. No text keyword promotes state.
 if new.session_type='PREMARKET' and new.status='READY' then
  select report_date,ai_strategy_json into v_date,v_ai from public.reports where id=new.report_id;
  if v_date is distinct from new.report_date then raise exception 'MARKET_REPORT_IDENTITY_REQUIRED'; end if;
  -- A closed-day digest is not a trading-day publication or stability day.
  if v_ai->'is_trading_day'='false'::jsonb then return new; end if;
  v_result:=public.validate_core_market_publication_v1(new.report_date,v_ai,to_jsonb(new),null,null,null);
  if v_result->'eligible' is distinct from 'true'::jsonb then
   raise exception 'CORE_MARKET_PUBLICATION_GATE_BLOCKED: %',v_result->'reason_codes';
  end if;
 end if;
 return new;
end;
$$;


--
-- Name: enforce_editorial_review_premium_90_gate_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_editorial_review_premium_90_gate_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_premium_min numeric := 90;
  v_auto_repair_min numeric := 70;
begin
  select policy.premium_publish_min, policy.auto_repair_min
    into v_premium_min, v_auto_repair_min
  from public.runtime_quality_policies as policy
  where policy.active = true
  limit 1;

  if new.review_status = 'APPROVED'
    and (new.content_score is null or new.content_score < coalesce(v_premium_min, 90))
  then
    new.review_status := case
      when coalesce(new.content_score, 0) >= coalesce(v_auto_repair_min, 70) then 'DEGRADED'
      else 'REJECTED'
    end;
  end if;
  return new;
end;
$$;


--
-- Name: enforce_market_checkpoint_batch_complete_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_market_checkpoint_batch_complete_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_integrity jsonb;
begin
  v_integrity := public.market_checkpoint_batch_integrity_v1(new.business_date, new.checkpoint);
  if v_integrity->>'status' is distinct from 'PASS' then
    raise exception 'ATOMIC_CHECKPOINT_DEFERRED_INTEGRITY_VIOLATION:%', v_integrity;
  end if;
  return null;
end;
$$;


--
-- Name: enforce_market_checkpoint_snapshot_batch_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_market_checkpoint_snapshot_batch_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_batch public.market_checkpoint_batches;
begin
  -- The pre-cutover corpus remains byte-for-byte legacy evidence. Once this
  -- guard exists, 2026-09-11 can no longer accumulate another retry fragment.
  if new.trading_date < date '2026-09-11' then
    return new;
  end if;
  if new.batch_id is null or new.provider_key is null or new.idempotency_key is null then
    raise exception 'ATOMIC_CHECKPOINT_DIRECT_INSERT_REJECTED:%:%', new.trading_date, new.checkpoint;
  end if;

  select * into v_batch
  from public.market_checkpoint_batches
  where batch_id = new.batch_id;
  if not found
    or v_batch.business_date is distinct from new.trading_date
    or v_batch.checkpoint is distinct from new.checkpoint
    or v_batch.market_session is distinct from new.market_session
    or v_batch.correlation_id is distinct from new.correlation_id
    or v_batch.idempotency_key is distinct from new.idempotency_key
    or new.provider_key is distinct from new.symbol
    or not (new.provider_key = any(public.market_checkpoint_provider_contract_v1())) then
    raise exception 'ATOMIC_CHECKPOINT_BATCH_IDENTITY_MISMATCH';
  end if;
  return new;
end;
$$;


--
-- Name: enqueue_runtime_dead_letter_v1(text, text, text, uuid, integer, integer, text, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_runtime_dead_letter_v1(p_component text, p_operation text, p_idempotency_key text, p_correlation_id uuid, p_attempt integer, p_max_attempts integer, p_error_code text, p_error_message text, p_request_payload jsonb DEFAULT '{}'::jsonb, p_context jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
begin
  insert into public.runtime_dead_letters (
    component, operation, idempotency_key, correlation_id, attempt, max_attempts,
    error_code, error_message, request_payload, context
  ) values (
    p_component, p_operation, p_idempotency_key, p_correlation_id,
    greatest(1, p_attempt), greatest(1, p_max_attempts),
    p_error_code, p_error_message, coalesce(p_request_payload, '{}'::jsonb), coalesce(p_context, '{}'::jsonb)
  )
  on conflict (component, idempotency_key, attempt) do update
    set error_code = excluded.error_code,
        error_message = excluded.error_message,
        context = public.runtime_dead_letters.context || excluded.context
  returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: ensure_member_entitlement_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_member_entitlement_v1(p_user_id uuid) RETURNS public.member_entitlements
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: finish_research_input_v1(uuid, uuid, text, jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_research_input_v1(p_run_id uuid, p_correlation_id uuid, p_outcome text, p_result jsonb, p_retry_after_seconds integer) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if not coalesce(p_outcome in ('SUCCEEDED','DEGRADED','FAILED'),false) or jsonb_typeof(p_result) is distinct from 'object'
    or (p_outcome <> 'SUCCEEDED' and coalesce(p_result->>'error_code','') = '') then
    raise exception 'RESEARCH_OUTCOME_REASON_REQUIRED';
  end if;
  update public.pipeline_runs set status=p_outcome,completed_at=public.ma_chaos_clock(),updated_at=clock_timestamp(),
    error_code=p_result->>'error_code',reason_codes=case when p_outcome='SUCCEEDED' then '{}'::text[] else array[p_result->>'error_code'] end,
    next_retry_at=case when p_outcome='FAILED' and attempt<3 and p_retry_after_seconds between 1 and 300
      then clock_timestamp()+make_interval(secs=>p_retry_after_seconds) else null end,
    provider_status=provider_status || jsonb_build_object('result',p_result)
  where id=p_run_id and correlation_id=p_correlation_id and status='RUNNING';
  return found;
end; $$;


--
-- Name: get_active_runtime_quality_policy_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_runtime_quality_policy_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select to_jsonb(policy) - 'created_at' - 'updated_at'
  from public.runtime_quality_policies as policy
  where policy.active = true
  limit 1;
$$;


--
-- Name: get_emma_health_shared_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_emma_health_shared_secret() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ select decrypted_secret from vault.decrypted_secrets where name = 'emma_system_health_webhook_v1' limit 1 $$;


--
-- Name: get_ma_ops_health_cron_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ma_ops_health_cron_secret() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'ma_ops_health_cron_v1'
  order by created_at desc
  limit 1
$$;


--
-- Name: get_public_performance_journal(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_performance_journal(p_limit integer DEFAULT 90) RETURNS TABLE(report_date date, market_bias text, confidence_score numeric, is_trading_day boolean, report_mode text, verification_status text, verification_data_status text, hit_or_miss text, prediction_result text, opening_bias text, actual_direction text, actual_taiex_close numeric, what_was_right text, what_was_wrong text, tomorrow_adjustment text, updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
with params as (
  select greatest(1, least(coalesce(p_limit, 90), 90)) as safe_limit
), ranked_reports as (
  select
    r.*,
    row_number() over (
      partition by r.report_date
      order by
        case when lower(coalesce(r.ai_strategy_json #>> '{closing_verification_v2,status}', '')) = 'completed' then 1 else 0 end desc,
        case when lower(coalesce(r.ai_strategy_json #>> '{closing_verification_v2,data_status}', '')) = 'complete' then 1 else 0 end desc,
        r.updated_at desc nulls last,
        r.created_at desc nulls last
    ) as rn
  from public.reports r
  where r.report_date is not null
), latest_close_reviews as (
  select distinct on (cmr.report_date)
    cmr.*
  from public.close_market_reviews cmr
  order by cmr.report_date, cmr.updated_at desc, cmr.created_at desc
), reconciled as (
  select
    rr.report_date,
    rr.market_bias,
    rr.confidence_score,
    greatest(rr.updated_at, cmr.updated_at) as updated_at,
    rr.ai_strategy_json,
    coalesce(rr.ai_strategy_json -> 'closing_verification_v2', '{}'::jsonb)
      || case when cmr.id is null then '{}'::jsonb else jsonb_build_object(
        'status', case
          when cmr.taiex_change is not null
            and cardinality(cmr.missing_data) = 0
            and lower(cmr.data_quality) in ('高可信', 'verified', 'complete', 'high_confidence')
          then 'completed'
          when cmr.taiex_change is not null then 'direction_completed_data_degraded'
          else 'pending_real_market_data'
        end,
        'data_status', case
          when cmr.taiex_change is not null
            and cardinality(cmr.missing_data) = 0
            and lower(cmr.data_quality) in ('高可信', 'verified', 'complete', 'high_confidence')
          then 'complete'
          when cmr.taiex_change is not null then 'degraded'
          else 'pending'
        end,
        'hit_or_miss', case
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('hit', 'correct', 'confirmed', 'success', 'accurate', '方向一致', '大致一致', '命中') then 'hit'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('partial', 'mixed', 'partially_confirmed')
            or coalesce(cmr.verification_result, cmr.verification_label, '') like '%部分%' then 'partial'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('miss', 'wrong', 'failed', 'rejected', 'incorrect', 'inaccurate', '未命中') then 'miss'
          else 'pending'
        end,
        'prediction_result', case
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('hit', 'correct', 'confirmed', 'success', 'accurate', '方向一致', '大致一致', '命中') then 'hit'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('partial', 'mixed', 'partially_confirmed')
            or coalesce(cmr.verification_result, cmr.verification_label, '') like '%部分%' then 'partial'
          when lower(coalesce(cmr.verification_result, cmr.verification_label, '')) in ('miss', 'wrong', 'failed', 'rejected', 'incorrect', 'inaccurate', '未命中') then 'miss'
          else 'pending'
        end,
        'actual_direction', cmr.actual_market_result,
        'actual_taiex_change', cmr.taiex_change,
        'actual_taiex_close', jsonb_build_object('change_percent', cmr.taiex_change),
        'verdict_label', cmr.verification_label,
        'verification_note', cmr.verification_note,
        'data_quality', cmr.data_quality,
        'missing_data', to_jsonb(cmr.missing_data),
        'verified_at', cmr.updated_at,
        'close_market_review_id', cmr.id,
        'source_priority', 'close_market_review',
        'no_fake_data', true
      ) end as cv
  from ranked_reports rr
  left join latest_close_reviews cmr on cmr.report_date = rr.report_date
  where rr.rn = 1
  order by rr.report_date desc
  limit (select safe_limit from params)
), normalized as (
  select
    r.*,
    coalesce(
      r.cv #>> '{actual_taiex_close,close}',
      r.cv #>> '{actual_taiex_close,price}',
      r.cv #>> '{actual_taiex_close,value}',
      r.cv #>> '{actual_taiex_close,change_percent}',
      r.cv ->> 'actual_taiex_change',
      case when jsonb_typeof(r.cv -> 'actual_taiex_close') = 'number' then r.cv ->> 'actual_taiex_close' end
    ) as actual_taiex_close_text
  from reconciled r
)
select
  n.report_date::date,
  n.market_bias::text,
  n.confidence_score::numeric,
  case lower(coalesce(n.ai_strategy_json ->> 'is_trading_day', ''))
    when 'true' then true
    when 'false' then false
    else null
  end as is_trading_day,
  nullif(n.ai_strategy_json ->> 'report_mode', '')::text as report_mode,
  nullif(n.cv ->> 'status', '')::text as verification_status,
  nullif(n.cv ->> 'data_status', '')::text as verification_data_status,
  nullif(n.cv ->> 'hit_or_miss', '')::text as hit_or_miss,
  nullif(n.cv ->> 'prediction_result', '')::text as prediction_result,
  nullif(n.cv ->> 'opening_bias', '')::text as opening_bias,
  nullif(n.cv ->> 'actual_direction', '')::text as actual_direction,
  case when n.actual_taiex_close_text ~ '^-?[0-9]+(\.[0-9]+)?$' then n.actual_taiex_close_text::numeric else null end as actual_taiex_close,
  case jsonb_typeof(n.cv -> 'what_was_right')
    when 'string' then nullif(n.cv ->> 'what_was_right', '')
    when 'object' then nullif(coalesce(n.cv #>> '{what_was_right,summary}', n.cv #>> '{what_was_right,note}', n.cv #>> '{what_was_right,action}', n.cv #>> '{what_was_right,text}'), '')
    when 'array' then nullif(n.cv #>> '{what_was_right,0}', '')
    else null
  end as what_was_right,
  case jsonb_typeof(n.cv -> 'what_was_wrong')
    when 'string' then nullif(n.cv ->> 'what_was_wrong', '')
    when 'object' then nullif(coalesce(n.cv #>> '{what_was_wrong,summary}', n.cv #>> '{what_was_wrong,note}', n.cv #>> '{what_was_wrong,action}', n.cv #>> '{what_was_wrong,text}'), '')
    when 'array' then nullif(n.cv #>> '{what_was_wrong,0}', '')
    else null
  end as what_was_wrong,
  case jsonb_typeof(n.cv -> 'tomorrow_adjustment')
    when 'string' then nullif(n.cv ->> 'tomorrow_adjustment', '')
    when 'object' then nullif(coalesce(
      n.cv #>> '{tomorrow_adjustment,summary}',
      n.cv #>> '{tomorrow_adjustment,note}',
      n.cv #>> '{tomorrow_adjustment,adjustment}',
      n.cv #>> '{tomorrow_adjustment,watch_tomorrow,0}',
      n.cv #>> '{tomorrow_adjustment,downgrade,0}',
      n.cv #>> '{tomorrow_adjustment,keep,0}'
    ), '')
    when 'array' then nullif(n.cv #>> '{tomorrow_adjustment,0}', '')
    else null
  end as tomorrow_adjustment,
  n.updated_at
from normalized n
order by n.report_date desc;
$_$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, subscription_status)
  VALUES (NEW.id, NEW.email, 'free', 'inactive');
  RETURN NEW;
END;
$$;


--
-- Name: handle_user_email_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_user_email_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email, updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


--
-- Name: invoke_continuous_learning_tick_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_continuous_learning_tick_v1() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'vault'
    AS $$
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


--
-- Name: invoke_continuous_learning_tick_v2(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_continuous_learning_tick_v2(p_is_backup boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(v_date,'continuous_learning','continuous_learning',jsonb_build_object('mode','continuous_learning'),p_is_backup,null); return v_row.id;
end;
$$;


--
-- Name: invoke_daily_delivery_tick_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_daily_delivery_tick_v1() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  ) into v_request_id;

  return v_request_id;
end;
$$;


--
-- Name: invoke_daily_delivery_tick_v2(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_daily_delivery_tick_v2(p_phase text, p_is_backup boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  if p_phase not in ('refresh','generate','repair','deliver','watchdog') then raise exception 'unsupported_daily_phase:%',p_phase; end if;
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(
    v_date,'daily_delivery','daily_'||p_phase,jsonb_build_object('phase',p_phase),p_is_backup,
    (v_date + time '08:45') at time zone 'Asia/Taipei'
  );
  return v_row.id;
end;
$$;


--
-- Name: invoke_ma_ops_health_check_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_ma_ops_health_check_v1(p_check_type text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: invoke_ma_ops_health_check_v2(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_ma_ops_health_check_v2(p_check_type text, p_is_backup boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  if p_check_type not in ('report','closing') then raise exception 'unsupported_health_check:%',p_check_type; end if;
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(v_date,p_check_type||'_health',p_check_type||'_health',jsonb_build_object('mode','health_check','check_type',p_check_type),p_is_backup,null); return v_row.id;
end;
$$;


--
-- Name: invoke_market_readiness_preflight_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_market_readiness_preflight_v1() RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: invoke_premarket_readiness_retry_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_premarket_readiness_retry_v1() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: invoke_runtime_checkpoint_tick_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_runtime_checkpoint_tick_v1(p_checkpoint text) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'vault'
    AS $$
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


--
-- Name: invoke_runtime_checkpoint_tick_v2(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_runtime_checkpoint_tick_v2(p_checkpoint text, p_is_backup boolean DEFAULT false) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_row public.runtime_http_dispatches; v_date date:=(now() at time zone 'Asia/Taipei')::date;
begin
  if p_checkpoint not in ('0900','0930','1030','1300','1410','1430') then raise exception 'unsupported_checkpoint:%',p_checkpoint; end if;
  select * into v_row from public.dispatch_morning_alpha_runtime_v1(v_date,'runtime_checkpoint',p_checkpoint,jsonb_build_object('mode','runtime_checkpoint','checkpoint',p_checkpoint),p_is_backup,null);
  return v_row.id;
end;
$$;


--
-- Name: ma_chaos_clock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ma_chaos_clock() RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$ select clock_timestamp(); $$;


--
-- Name: ma_ops_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ma_ops_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: mark_line_delivery_outbox_v1(uuid[], text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_line_delivery_outbox_v1(p_ids uuid[], p_status text, p_error text DEFAULT NULL::text, p_retry_delay_seconds integer DEFAULT 60) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_count integer;
begin
  if coalesce(array_length(p_ids,1),0)=0 then return 0; end if;
  if p_status not in ('SENT','RETRY','FAILED') then raise exception 'invalid delivery completion status:%',p_status; end if;
  update public.line_delivery_outbox as o set
    status=case when p_status='SENT' then 'SENT' when p_status='FAILED' or o.attempt_count>=o.max_attempts then 'DEAD_LETTERED' else 'PENDING' end,
    next_retry_at=case when p_status='RETRY' and o.attempt_count<o.max_attempts then now()+make_interval(secs=>greatest(15,least(coalesce(p_retry_delay_seconds,60),3600))) else o.next_retry_at end,
    lease_expires_at=null,last_error=case when p_status='SENT' then null else left(coalesce(p_error,'LINE_DELIVERY_FAILED'),500) end,
    sent_at=case when p_status='SENT' then now() else o.sent_at end,updated_at=now()
  where o.id=any(p_ids) and o.status='PROCESSING';
  get diagnostics v_count=row_count; return v_count;
end;
$$;


--
-- Name: market_checkpoint_batch_integrity_v1(date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_checkpoint_batch_integrity_v1(p_business_date date, p_checkpoint text) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  v_total_rows bigint;
  v_unbatched_rows bigint;
  v_batch_count bigint;
  v_distinct_batch_ids bigint;
  v_provider_count bigint;
  v_duplicate_providers bigint;
  v_payload_revisions bigint;
  v_compatibility_rows bigint;
  v_compatibility_provider_count bigint;
  v_compatibility_mismatches bigint;
  v_batch public.market_checkpoint_batches;
  v_status text;
begin
  if p_business_date is null or nullif(btrim(p_checkpoint), '') is null then
    raise exception 'CHECKPOINT_INTEGRITY_IDENTITY_REQUIRED';
  end if;

  select count(*),
         count(*) filter (where batch_id is null),
         count(distinct batch_id),
         count(distinct provider_key) filter (where batch_id is not null),
         count(distinct coalesce(batch_id::text, correlation_id::text))
    into v_total_rows, v_unbatched_rows, v_distinct_batch_ids, v_provider_count, v_payload_revisions
  from public.market_checkpoint_snapshots
  where trading_date = p_business_date and checkpoint = p_checkpoint;

  select count(*) into v_duplicate_providers
  from (
    select provider_key
    from public.market_checkpoint_snapshots
    where trading_date = p_business_date and checkpoint = p_checkpoint and batch_id is not null
    group by provider_key
    having count(*) > 1
  ) duplicates;

  select count(*) into v_batch_count
  from public.market_checkpoint_batches
  where business_date = p_business_date and checkpoint = p_checkpoint and status = 'COMMITTED';

  select * into v_batch
  from public.market_checkpoint_batches
  where business_date = p_business_date and checkpoint = p_checkpoint and status = 'COMMITTED'
  order by committed_at, batch_id
  limit 1;

  select count(*), count(distinct compatibility.symbol)
    into v_compatibility_rows, v_compatibility_provider_count
  from public.market_data_snapshots compatibility
  where compatibility.raw->>'checkpoint_batch_id' = v_batch.batch_id::text;

  select count(*) into v_compatibility_mismatches
  from public.market_checkpoint_snapshots snapshot_row
  left join public.market_data_snapshots compatibility
    on compatibility.raw->>'checkpoint_batch_id' = snapshot_row.batch_id::text
   and compatibility.symbol = snapshot_row.provider_key
  where snapshot_row.batch_id = v_batch.batch_id
    and (
      compatibility.id is null
      or compatibility.trading_date is distinct from snapshot_row.trading_date
      or compatibility.checkpoint is distinct from case
        when snapshot_row.checkpoint = 'PREMARKET' then 'premarket'
        when snapshot_row.checkpoint = 'RECOVERY' then 'manual'
        else snapshot_row.checkpoint
      end
      or compatibility.phase is distinct from case
        when snapshot_row.market_session = 'recovery' then 'manual_backfill'
        else snapshot_row.market_session
      end
      or compatibility.value is distinct from snapshot_row.value
      or compatibility.change_percent is distinct from snapshot_row.change_percent
      or compatibility.source is distinct from snapshot_row.source
      or compatibility.captured_at is distinct from snapshot_row.source_timestamp
      or compatibility.raw->>'correlation_id' is distinct from snapshot_row.correlation_id::text
      or compatibility.raw->>'immutable_snapshot_version' is distinct from snapshot_row.snapshot_version::text
      or compatibility.raw->>'immutable_checkpoint' is distinct from snapshot_row.checkpoint
      or compatibility.raw->>'checkpoint_idempotency_key' is distinct from snapshot_row.idempotency_key
    );

  v_status := case
    when v_total_rows = 0 and v_batch_count = 0 then 'MISSING'
    when v_batch_count = 1
      and v_total_rows = 11
      and v_unbatched_rows = 0
      and v_distinct_batch_ids = 1
      and v_provider_count = 11
      and v_duplicate_providers = 0
      and v_compatibility_rows = 11
      and v_compatibility_provider_count = 11
      and v_compatibility_mismatches = 0
      and v_batch.expected_provider_count = 11
      and v_batch.committed_provider_count = 11
      and v_batch.provider_contract_version = 'MARKET_CHECKPOINT_PROVIDER_V1'
      and not exists (
        select expected.provider_key
        from unnest(public.market_checkpoint_provider_contract_v1()) expected(provider_key)
        except
        select provider_key
        from public.market_checkpoint_snapshots
        where batch_id = v_batch.batch_id
      )
      and not exists (
        select provider_key
        from public.market_checkpoint_snapshots
        where batch_id = v_batch.batch_id
        except
        select expected.provider_key
        from unnest(public.market_checkpoint_provider_contract_v1()) expected(provider_key)
      )
      then 'PASS'
    else 'FAIL'
  end;

  return jsonb_build_object(
    'contract', 'MARKET_CHECKPOINT_ATOMICITY_V1',
    'status', v_status,
    'business_date', p_business_date,
    'checkpoint', p_checkpoint,
    'canonical_row_count', v_total_rows,
    'unbatched_row_count', v_unbatched_rows,
    'committed_batch_count', v_batch_count,
    'distinct_batch_id_count', v_distinct_batch_ids,
    'distinct_provider_count', v_provider_count,
    'duplicate_authoritative_provider_count', v_duplicate_providers,
    'compatibility_row_count', v_compatibility_rows,
    'compatibility_provider_count', v_compatibility_provider_count,
    'compatibility_mismatch_count', v_compatibility_mismatches,
    'mixed_batch_revision_count', greatest(v_payload_revisions - 1, 0),
    'batch_id', v_batch.batch_id,
    'correlation_id', v_batch.correlation_id,
    'idempotency_key', v_batch.idempotency_key,
    'payload_hash', v_batch.payload_hash,
    'production_2026_09_11_evidence_preserved', p_business_date <> date '2026-09-11' or v_unbatched_rows = v_total_rows
  );
end;
$$;


--
-- Name: market_checkpoint_provider_contract_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_checkpoint_provider_contract_v1() RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
  select array['SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y','TAIEX','2330','TXF']::text[];
$$;


--
-- Name: learning_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_key text NOT NULL,
    name text NOT NULL,
    hypothesis text NOT NULL,
    condition_json jsonb NOT NULL,
    action_json jsonb NOT NULL,
    source_pattern_id uuid,
    minimum_sample_size integer DEFAULT 20 NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    shadow_started_at timestamp with time zone,
    shadow_completed_at timestamp with time zone,
    shadow_sample_size integer DEFAULT 0 NOT NULL,
    shadow_accuracy numeric(7,4),
    promoted_by uuid,
    promoted_at timestamp with time zone,
    promotion_reason text,
    promotion_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_rules_action_json_check CHECK ((jsonb_typeof(action_json) = 'object'::text)),
    CONSTRAINT learning_rules_condition_json_check CHECK ((jsonb_typeof(condition_json) = 'object'::text)),
    CONSTRAINT learning_rules_minimum_sample_size_check CHECK ((minimum_sample_size >= 10)),
    CONSTRAINT learning_rules_promotion_evidence_check CHECK ((jsonb_typeof(promotion_evidence) = 'object'::text)),
    CONSTRAINT learning_rules_shadow_sample_size_check CHECK ((shadow_sample_size >= 0)),
    CONSTRAINT learning_rules_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'backtesting'::text, 'eligible_shadow'::text, 'shadow'::text, 'rejected'::text, 'production'::text, 'archived'::text]))),
    CONSTRAINT learning_rules_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.learning_rules FORCE ROW LEVEL SECURITY;


--
-- Name: promote_learning_rule_v1(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_learning_rule_v1(p_rule_id uuid, p_admin_id uuid, p_reason text) RETURNS public.learning_rules
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  promoted_rule public.learning_rules;
begin
  if p_admin_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_admin_id
      and lower(coalesce(profile.role, '')) = 'admin'
  ) then
    raise exception 'admin role required to promote a learning rule'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 20 then
    raise exception 'promotion reason must contain at least 20 characters'
      using errcode = '22023';
  end if;

  update public.learning_rules
  set
    status = 'production',
    promoted_by = p_admin_id,
    promotion_reason = btrim(p_reason),
    promotion_evidence = promotion_evidence || jsonb_build_object(
      'promoted_via', 'promote_learning_rule_v1',
      'promoted_at', clock_timestamp(),
      'shadow_sample_size', shadow_sample_size,
      'shadow_accuracy', shadow_accuracy
    ),
    version = version + 1
  where id = p_rule_id
    and status = 'shadow'
    and shadow_completed_at is not null
  returning * into promoted_rule;

  if promoted_rule.id is null then
    raise exception 'rule must have a completed shadow evaluation before promotion'
      using errcode = '23514';
  end if;
  return promoted_rule;
end;
$$;


--
-- Name: strategy_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strategy_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    strategy_key text NOT NULL,
    version integer NOT NULL,
    lifecycle text NOT NULL,
    engine_version text NOT NULL,
    prompt_version text,
    rule_version text,
    scoring_version text,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    parent_strategy_id uuid,
    rollback_target_id uuid,
    shadow_sample_size integer DEFAULT 0 NOT NULL,
    shadow_accuracy numeric(7,4),
    backtest_score numeric(7,4),
    calibration_error numeric(7,4),
    promoted_by uuid,
    promotion_reason text,
    promoted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT strategy_registry_config_check CHECK ((jsonb_typeof(config) = 'object'::text)),
    CONSTRAINT strategy_registry_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['candidate'::text, 'shadow'::text, 'production'::text, 'retired'::text, 'rejected'::text, 'rollback'::text]))),
    CONSTRAINT strategy_registry_shadow_sample_size_check CHECK ((shadow_sample_size >= 0)),
    CONSTRAINT strategy_registry_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.strategy_registry FORCE ROW LEVEL SECURITY;


--
-- Name: promote_strategy_v1(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_strategy_v1(p_strategy_id uuid, p_admin_id uuid, p_reason text) RETURNS public.strategy_registry
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_strategy public.strategy_registry%rowtype;
begin
  if p_admin_id is null or not exists (
    select 1 from public.profiles
    where id = p_admin_id and lower(coalesce(role, '')) = 'admin'
  ) then
    raise exception 'admin role required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 20 then
    raise exception 'promotion reason must contain at least 20 characters';
  end if;

  select * into v_strategy
  from public.strategy_registry
  where id = p_strategy_id
  for update;
  if not found or v_strategy.lifecycle <> 'shadow'
    or v_strategy.shadow_sample_size < 20
    or coalesce(v_strategy.backtest_score, 0) < 55 then
    raise exception 'strategy requires shadow sample >= 20 and backtest score >= 55';
  end if;

  update public.strategy_registry
  set lifecycle = 'retired', updated_at = now()
  where strategy_key = v_strategy.strategy_key and lifecycle = 'production';

  update public.strategy_registry
  set lifecycle = 'production',
      promoted_by = p_admin_id,
      promotion_reason = btrim(p_reason),
      promoted_at = now(),
      updated_at = now()
  where id = p_strategy_id
  returning * into v_strategy;

  insert into public.strategy_registry_audit (
    strategy_id, action, from_lifecycle, to_lifecycle, actor_id, reason, evidence
  ) values (
    v_strategy.id, 'promote', 'shadow', 'production', p_admin_id, p_reason,
    jsonb_build_object('shadow_sample_size', v_strategy.shadow_sample_size, 'backtest_score', v_strategy.backtest_score)
  );
  return v_strategy;
end;
$$;


--
-- Name: publish_decision_snapshot_v2(date, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_decision_snapshot_v2(p_report_date date, p_session_type text, p_report_id uuid, p_payload jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session_id uuid;
  v_previous public.decision_snapshots%rowtype;
  v_snapshot_id uuid;
  v_fingerprint text;
  v_version integer;
  v_now timestamptz := clock_timestamp();
  v_content_score numeric(5, 2);
  v_content_grade text;
  v_status text;
  v_snapshot_session_type text;
begin
  if p_report_date is null then
    raise exception 'report_date is required';
  end if;
  v_snapshot_session_type := case
    when p_session_type = 'OPEN' then 'OPENING'
    when p_session_type = 'MID_MORNING' then 'INTRADAY'
    when p_session_type = 'CLOSE' then 'CLOSING'
    else p_session_type
  end;
  if v_snapshot_session_type not in ('PREMARKET', 'OPENING', 'INTRADAY', 'PRE_CLOSE', 'CLOSING', 'POST_CLOSE') then
    raise exception 'invalid session_type: %', p_session_type;
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  perform pg_advisory_xact_lock(hashtext(concat(p_report_date::text, ':', v_snapshot_session_type)));

  v_fingerprint := md5(p_payload::text);
  v_content_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_content_grade := coalesce(nullif(p_payload ->> 'content_grade', ''), 'reject');
  v_status := case
    when v_snapshot_session_type = 'CLOSING' then 'FINAL'
    when p_payload ->> 'decision_mode' = 'blocked' then 'INSUFFICIENT_DATA'
    when v_content_score >= 80 then 'READY'
    when v_content_score >= 70 then 'PARTIAL'
    else 'INSUFFICIENT_DATA'
  end;

  select *
    into v_previous
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = v_snapshot_session_type
    and is_current = true
  for update;

  if found and v_previous.snapshot_fingerprint = v_fingerprint then
    return v_previous.id;
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = v_snapshot_session_type;

  insert into public.research_sessions (
    trading_date,
    session_type,
    version,
    status,
    report_mode,
    market_status,
    is_trading_day,
    data_as_of,
    generated_at,
    engine_version,
    idempotency_key,
    input_coverage,
    missing_sources,
    reason_codes
  ) values (
    p_report_date,
    v_snapshot_session_type,
    v_version,
    case
      when v_snapshot_session_type = 'CLOSING' then 'VERIFIED'
      when p_payload ->> 'decision_mode' = 'blocked' then 'REJECTED'
      when v_content_score >= 80 then 'PUBLISHED'
      when v_content_score >= 70 then 'DEGRADED'
      else 'REJECTED'
    end,
    nullif(p_payload ->> 'report_mode', ''),
    nullif(p_payload ->> 'market_status', ''),
    case
      when p_payload ? 'is_trading_day' then (p_payload ->> 'is_trading_day')::boolean
      else null
    end,
    nullif(p_payload ->> 'data_as_of', '')::timestamptz,
    coalesce(nullif(p_payload ->> 'generated_at', '')::timestamptz, v_now),
    nullif(p_payload ->> 'engine_version', ''),
    concat(p_report_date::text, ':', v_snapshot_session_type, ':', v_fingerprint),
    coalesce(p_payload -> 'input_coverage', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'missing_sources', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[])
  )
  on conflict (idempotency_key) do update
    set status = excluded.status,
        data_as_of = excluded.data_as_of,
        reason_codes = excluded.reason_codes
  returning id into v_session_id;

  if v_previous.id is not null then
    update public.decision_snapshots
      set is_current = false,
          valid_until = v_now
    where id = v_previous.id;
  end if;

  insert into public.decision_snapshots (
    report_date,
    session_type,
    version,
    idempotency_key,
    status,
    market_score,
    confidence_score,
    coverage_score,
    action,
    market_regime,
    preferred_sectors,
    watch_sectors,
    blocked_sectors,
    reasons,
    risk_flags,
    invalidation_rules,
    factor_scores,
    source_freshness,
    source_refs,
    generated_text,
    valid_from,
    supersedes_id,
    is_current,
    research_session_id,
    report_id,
    snapshot_fingerprint,
    decision_mode,
    content_score,
    content_grade,
    content_score_breakdown,
    reason_codes,
    generic_content_flags
  ) values (
    p_report_date,
    v_snapshot_session_type,
    v_version,
    concat(p_report_date::text, ':', v_snapshot_session_type, ':', v_fingerprint),
    v_status,
    nullif(p_payload ->> 'market_score', '')::numeric,
    nullif(p_payload ->> 'confidence_score', '')::numeric,
    nullif(p_payload ->> 'coverage_score', '')::numeric,
    nullif(p_payload ->> 'action', ''),
    nullif(p_payload ->> 'market_regime', ''),
    coalesce(p_payload -> 'preferred_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'watch_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'blocked_sectors', '[]'::jsonb),
    coalesce(p_payload -> 'reasons', '[]'::jsonb),
    coalesce(p_payload -> 'risk_flags', '[]'::jsonb),
    coalesce(p_payload -> 'invalidation_rules', '[]'::jsonb),
    coalesce(p_payload -> 'factor_scores', '{}'::jsonb),
    coalesce(p_payload -> 'source_freshness', '{}'::jsonb),
    coalesce(p_payload -> 'source_refs', '[]'::jsonb),
    coalesce(p_payload -> 'generated_text', '{}'::jsonb),
    v_now,
    v_previous.id,
    true,
    v_session_id,
    p_report_id,
    v_fingerprint,
    nullif(p_payload ->> 'decision_mode', ''),
    v_content_score,
    v_content_grade,
    coalesce(p_payload -> 'content_score_breakdown', '{}'::jsonb),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'generic_content_flags', '[]'::jsonb))), '{}'::text[])
  )
  returning id into v_snapshot_id;

  if v_snapshot_session_type = 'PREMARKET' then
    insert into public.editorial_reviews (
      research_session_id,
      decision_snapshot_id,
      review_status,
      content_score,
      content_score_breakdown,
      reason_codes,
      generic_content_flags
    ) values (
      v_session_id,
      v_snapshot_id,
      case
        when p_payload ->> 'decision_mode' = 'blocked' then 'REJECTED'
        when v_content_score >= 80 then 'APPROVED'
        when v_content_score >= 70 then 'DEGRADED'
        else 'REJECTED'
      end,
      coalesce(v_content_score, 0),
      coalesce(p_payload -> 'content_score_breakdown', '{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'generic_content_flags', '[]'::jsonb))), '{}'::text[])
    );
  end if;

  return v_snapshot_id;
end;
$$;


--
-- Name: publish_decision_snapshot_v3(date, text, uuid, jsonb, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_decision_snapshot_v3(p_report_date date, p_session_type text, p_report_id uuid, p_payload jsonb, p_correlation_id uuid, p_idempotency_key text, p_attempt integer DEFAULT 1) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_snapshot_id uuid;
  v_research_session_id uuid;
  v_policy public.runtime_quality_policies%rowtype;
  v_score numeric;
  v_pipeline_status text;
  v_snapshot public.decision_snapshots;
begin
  if p_correlation_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'correlation_id and idempotency_key are required';
  end if;

  select * into v_policy
  from public.runtime_quality_policies
  where active = true
  limit 1;
  if not found then
    raise exception 'active runtime quality policy missing';
  end if;

  v_snapshot_id := public.publish_decision_snapshot_v2(
    p_report_date,
    p_session_type,
    p_report_id,
    p_payload
  );

  select * into strict v_snapshot from public.decision_snapshots where id=v_snapshot_id;
  v_research_session_id:=v_snapshot.research_session_id;

  v_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_pipeline_status := case
    when coalesce((p_payload ->> 'safe_mode')::boolean, false) then 'DEGRADED'
    when p_payload ->> 'decision_mode' = 'blocked' then 'DEGRADED'
    -- Pipeline success follows the actual trigger-validated stored snapshot.
    when v_snapshot.status in ('READY','FINAL') and v_score >= v_policy.premium_publish_min then 'SUCCEEDED'
    when v_score >= v_policy.auto_repair_min then 'DEGRADED'
    else 'FAILED'
  end;

  insert into public.pipeline_runs (
    research_session_id,
    decision_snapshot_id,
    trading_date,
    checkpoint,
    idempotency_key,
    status,
    attempt,
    started_at,
    completed_at,
    reason_codes,
    correlation_id,
    engine_version,
    safe_mode,
    duration_ms,
    delivery_status,
    recovery_plan,
    updated_at
  ) values (
    v_research_session_id,
    v_snapshot_id,
    p_report_date,
    p_session_type,
    p_idempotency_key,
    v_pipeline_status,
    greatest(1, coalesce(p_attempt, 1)),
    coalesce(nullif(p_payload ->> 'started_at', '')::timestamptz, now()),
    now(),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload -> 'reason_codes', '[]'::jsonb))), '{}'::text[]),
    p_correlation_id,
    nullif(p_payload ->> 'engine_version', ''),
    coalesce((p_payload ->> 'safe_mode')::boolean, false),
    nullif(p_payload ->> 'duration_ms', '')::integer,
    case when v_pipeline_status = 'SUCCEEDED' then 'PENDING' else 'FAILED' end,
    coalesce(p_payload -> 'recovery_plan', '{}'::jsonb),
    now()
  )
  on conflict (idempotency_key) do update
    set research_session_id = excluded.research_session_id,
        decision_snapshot_id = excluded.decision_snapshot_id,
        status = excluded.status,
        completed_at = excluded.completed_at,
        reason_codes = excluded.reason_codes,
        correlation_id = excluded.correlation_id,
        engine_version = excluded.engine_version,
        safe_mode = excluded.safe_mode,
        duration_ms = excluded.duration_ms,
        delivery_status = excluded.delivery_status,
        recovery_plan = excluded.recovery_plan,
        updated_at = now();

  return v_snapshot_id;
end;
$$;


--
-- Name: publish_member_content_revision_v1(date, uuid, uuid, text, text, jsonb, jsonb, jsonb, numeric, numeric, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_member_content_revision_v1(p_report_date date, p_report_id uuid, p_decision_snapshot_id uuid, p_idempotency_key text, p_source_revision text, p_canonical_contract jsonb, p_member_content jsonb, p_semantic_result jsonb, p_content_score numeric, p_evidence_coverage numeric, p_generated_at timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_existing uuid;
  v_snapshot public.decision_snapshots;
  v_revision integer;
  v_revision_id uuid;
  v_status text := upper(coalesce(p_semantic_result->>'status','BLOCKED'));
  v_ai jsonb; v_validation jsonb; v_existing_row public.member_content_revisions;
  v_gate_version text := coalesce(p_semantic_result->>'gate_version','SEMANTIC_COHERENCE_V2');
begin
  if p_report_date is null or p_report_id is null or p_decision_snapshot_id is null then
    raise exception 'member revision identity is required';
  end if;
  if coalesce(trim(p_idempotency_key),'') = '' or coalesce(trim(p_source_revision),'') = '' then
    raise exception 'member revision idempotency and source revision are required';
  end if;
  if v_status not in ('PASSED','BLOCKED','DEGRADED') then
    raise exception 'invalid semantic status: %', v_status;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('member_content:' || p_report_date::text, 0));
  select * into v_existing_row from public.member_content_revisions where idempotency_key=p_idempotency_key;
  if found then
   if v_existing_row.report_date is distinct from p_report_date or v_existing_row.report_id is distinct from p_report_id
    or v_existing_row.decision_snapshot_id is distinct from p_decision_snapshot_id
    or v_existing_row.source_revision is distinct from p_source_revision
    or v_existing_row.canonical_contract is distinct from p_canonical_contract
    or v_existing_row.member_content is distinct from p_member_content
    or v_existing_row.content_score is distinct from p_content_score
    or v_existing_row.evidence_coverage is distinct from p_evidence_coverage
    or v_existing_row.status is distinct from v_status then raise exception 'MEMBER_IDEMPOTENCY_CONFLICT'; end if;
   return v_existing_row.id;
  end if;
  select * into v_snapshot from public.decision_snapshots where id = p_decision_snapshot_id for share;
  if not found or v_snapshot.report_date <> p_report_date or v_snapshot.report_id <> p_report_id then
    raise exception 'snapshot/report/date contract mismatch';
  end if;
  if p_canonical_contract->>'snapshot_id' is distinct from p_decision_snapshot_id::text
    or nullif(p_canonical_contract->>'snapshot_version','')::integer is distinct from v_snapshot.version then
    raise exception 'canonical snapshot identity mismatch';
  end if;
  select ai_strategy_json into v_ai from public.reports where id=p_report_id and report_date=p_report_date;
  if v_snapshot.session_type='PREMARKET' and v_status='PASSED' and v_ai->'is_trading_day' is distinct from 'false'::jsonb then
   v_validation:=public.validate_core_market_publication_v1(p_report_date,v_ai,to_jsonb(v_snapshot),p_canonical_contract,p_member_content,p_semantic_result);
   if v_validation->'eligible' is distinct from 'true'::jsonb
    or v_snapshot.status is distinct from 'READY'
    or p_content_score is distinct from v_snapshot.content_score
    or p_evidence_coverage is distinct from 100
    or p_generated_at is null or p_generated_at>clock_timestamp()
   then raise exception 'CORE_MARKET_MEMBER_CONTRACT_BLOCKED: %',v_validation->'reason_codes'; end if;
  end if;
  select coalesce(max(revision),0)+1 into v_revision
  from public.member_content_revisions where report_date = p_report_date;
  insert into public.member_content_revisions(
    report_date,report_id,decision_snapshot_id,decision_snapshot_version,revision,
    idempotency_key,status,canonical_contract,member_content,data_quality_status,
    content_score,evidence_coverage,source_revision,generated_at,metadata
  ) values (
    p_report_date,p_report_id,p_decision_snapshot_id,v_snapshot.version,v_revision,
    p_idempotency_key,v_status,p_canonical_contract,p_member_content,
    coalesce(p_canonical_contract->>'data_quality_status','insufficient'),
    p_content_score,p_evidence_coverage,p_source_revision,p_generated_at,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_revision_id;
  insert into public.semantic_coherence_reviews(
    report_date,decision_snapshot_id,member_content_revision_id,gate_version,status,
    reason_codes,conflicting_fields,canonical_snapshot_id,canonical_snapshot_version,
    checked_at,idempotency_key,result
  ) values (
    p_report_date,p_decision_snapshot_id,v_revision_id,v_gate_version,v_status,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'reason_codes','[]'::jsonb))),'{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_semantic_result->'conflicting_fields','[]'::jsonb))),'{}'::text[]),
    p_decision_snapshot_id,v_snapshot.version,
    coalesce(nullif(p_semantic_result->>'checked_at','')::timestamptz,now()),
    p_idempotency_key || ':semantic:' || v_gate_version,p_semantic_result
  );
  return v_revision_id;
end;
$$;


--
-- Name: publish_research_bundle_v1(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_research_bundle_v1(p_run_id uuid, p_correlation_id uuid, p_report jsonb, p_decision jsonb, p_contract jsonb, p_member jsonb, p_semantic jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
  v_date date := (p_report->>'report_date')::date;
  v_run public.pipeline_runs;
  v_snapshot public.decision_snapshots;
  v_report_id uuid; v_snapshot_id uuid; v_member_id uuid;
  v_columns text; v_updates text; v_field text; v_quality jsonb;
  v_quote text := p_decision#>>'{generated_text,daily_sentence}';
  v_previous_ai jsonb;
  v_result jsonb;
  v_validation jsonb; v_publication jsonb; v_opening_revision uuid; v_existing_result jsonb;
begin
  if v_date is null then raise exception 'REPORT_DATE_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('research-publication:' || v_date::text, 0));
  select * into v_run from public.pipeline_runs where id=p_run_id for update;
  if found and v_run.status='SUCCEEDED' and v_run.correlation_id=p_correlation_id
    and v_run.trading_date=v_date and p_decision->>'input_fingerprint'=v_run.provider_status->>'input_fingerprint' then
   v_existing_result:=v_run.provider_status->'result';
   if v_existing_result->'success'='true'::jsonb
    and exists(select 1 from public.decision_snapshots d where d.id::text=v_existing_result->>'decision_snapshot_id'
      and d.report_date=v_date and d.report_id::text=v_existing_result->>'report_id')
   then return v_existing_result; end if;
   raise exception 'PUBLICATION_REUSE_RECEIPT_INVALID';
  end if;
  if not found or p_correlation_id is null or v_run.trading_date is distinct from v_date
    or v_run.correlation_id is distinct from p_correlation_id or v_run.status is distinct from 'RUNNING'
    or not coalesce((v_run.provider_status->>'lease_expires_at')::timestamptz > clock_timestamp(),false) then
    raise exception 'RESEARCH_LEASE_LOST'; end if;
  if p_decision->>'input_fingerprint' is distinct from v_run.provider_status->>'input_fingerprint'
    or p_contract->>'report_date' is distinct from v_date::text then raise exception 'INPUT_REVISION_MISMATCH'; end if;
  if v_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
    or not coalesce((v_run.provider_status#>>'{manifest,market_count}')::numeric>0,false)
    or not coalesce((v_run.provider_status#>>'{manifest,news_count}')::numeric>0,false)
    or not coalesce((v_run.provider_status#>>'{manifest,sector_count}')::numeric>0,false)
    or p_report#>>'{ai_strategy_json,data_quality}' is distinct from 'complete'
    or nullif(p_decision->>'data_as_of','') is null then raise exception 'SOURCE_COMPLETENESS_UNVERIFIED'; end if;
  if p_contract is null or p_member is null or p_semantic is null then raise exception 'PUBLICATION_DOCUMENTS_REQUIRED'; end if;
  v_validation:=public.validate_core_market_publication_v1(v_date,p_report->'ai_strategy_json',p_decision,p_contract,p_member,p_semantic);
  if v_validation->'eligible' is distinct from 'true'::jsonb then
   raise exception 'CORE_MARKET_PUBLICATION_GATE_BLOCKED: %',v_validation->'reason_codes';
  end if;
  if p_report->>'summary' is distinct from v_quote or p_report->>'today_quote' is distinct from v_quote
    or p_report->>'today_summary' is distinct from v_quote
    or p_member->>'today_core_thesis' is distinct from v_quote or p_member->>'line_summary' is distinct from v_quote
    or p_report#>>'{ai_strategy_json,line_push_copy,one_sentence}' is distinct from v_quote then
    raise exception 'CANONICAL_OUTPUT_DIVERGENCE'; end if;

  -- Lock the report and retain runtime evidence captured after the app's read.
  select id,ai_strategy_json into v_report_id,v_previous_ai from public.reports where report_date=v_date for update;
  foreach v_field in array array['opening_radar','opening_radar_status','intraday_tracking','intraday_sync_status','war_room','closing_contract','closing_verification','closing_verification_v2','todayCloseVerification'] loop
    if v_previous_ai ? v_field then p_report := jsonb_set(p_report,array['ai_strategy_json',v_field],v_previous_ai->v_field); end if;
  end loop;
  p_report := p_report || jsonb_build_object('updated_at',clock_timestamp());
  if exists(select 1 from jsonb_object_keys(p_report) k where k in ('id','created_at') or not exists(
    select 1 from pg_catalog.pg_attribute a where a.attrelid='public.reports'::regclass and a.attname=k and a.attnum>0 and not a.attisdropped)) then
    raise exception 'REPORT_COLUMNS_INVALID'; end if;
  select string_agg(format('%I',k),',' order by k),
    string_agg(format('%I=excluded.%I',k,k),',' order by k) filter(where k<>'report_date')
  into v_columns,v_updates from jsonb_object_keys(p_report) k;
  execute format('insert into public.reports(%s) select %s from jsonb_populate_record(null::public.reports,$1) on conflict(report_date) do update set %s returning id',v_columns,v_columns,v_updates)
    into v_report_id using p_report;

  -- Execution time is not decision identity. data_as_of and the effective input
  -- fingerprint remain in the hashed payload, as do source and policy versions.
  -- Freeze the independent recommendation proof at this exact publication,
  -- without allowing its rejection counters to block the market document.
  p_decision:=jsonb_set(p_decision,'{source_freshness}',
   coalesce(p_decision->'source_freshness','{}')||jsonb_build_object('status',p_report#>>'{ai_strategy_json,data_quality}'));
  p_decision:=jsonb_set(p_decision,'{generated_text}',
   coalesce(p_decision->'generated_text','{}')||jsonb_build_object('stock_research',p_report#>'{ai_strategy_json,stock_research}'));
  p_decision := p_decision - array['generated_at','started_at','duration_ms','correlation_id','recovery_plan'];
  v_snapshot_id := public.publish_decision_snapshot_v3(v_date,'PREMARKET',v_report_id,p_decision,p_correlation_id,
    'production-report:'||v_date::text||':PREMARKET',v_run.attempt);
  select * into strict v_snapshot from public.decision_snapshots where id=v_snapshot_id;
  if v_snapshot.status is distinct from 'READY' then raise exception 'STORED_MARKET_SNAPSHOT_NOT_READY'; end if;
  p_contract := p_contract || jsonb_build_object('snapshot_id',v_snapshot_id,'snapshot_version',v_snapshot.version);
  p_member := p_member || jsonb_build_object('canonical_contract',p_contract);
  p_semantic := p_semantic || jsonb_build_object('canonical_snapshot_id',v_snapshot_id,'canonical_snapshot_version',v_snapshot.version);
  v_member_id := public.publish_member_content_revision_v1(v_date,v_report_id,v_snapshot_id,
    'member-content:'||v_snapshot_id::text, v_run.provider_status->>'input_fingerprint',p_contract,p_member,p_semantic,
    (p_decision->>'content_score')::numeric,100,clock_timestamp(),
    jsonb_build_object('actor','generate-daily-report-v7','suppress_notifications',true,'pipeline_run_id',p_run_id));
  if not exists(select 1 from public.member_content_revisions where id=v_member_id and status='PASSED') then
    raise exception 'MEMBER_PUBLICATION_NOT_PASSED'; end if;
  -- The first published opening never follows later current QA/revisions.
  if v_previous_ai ? 'market_publication_contract' then
   if v_previous_ai#>>'{market_publication_contract,schema_version}' is distinct from 'CORE_MARKET_PUBLICATION_V1'
    or v_previous_ai#>>'{market_publication_contract,status}' is distinct from 'PUBLISHED'
    or v_previous_ai#>>'{market_publication_contract,report_date}' is distinct from v_date::text
    or v_previous_ai#>>'{market_publication_contract,revision_id}' is distinct from v_previous_ai->>'revision_id'
   then raise exception 'EXISTING_PUBLICATION_POINTER_INVALID'; end if;
   v_opening_revision:=(v_previous_ai#>>'{market_publication_contract,opening_publication_revision_id}')::uuid;
  elsif nullif(v_previous_ai->>'revision_id','') is not null then
   -- Compatibility accepts only an exact existing atomic receipt, never an
   -- is_current QA selector or a same-date guess.
   select d.id into v_opening_revision from public.decision_snapshots d
    where d.id::text=v_previous_ai->>'revision_id' and d.report_id=v_report_id
     and d.report_date=v_date and d.session_type='PREMARKET' and d.status='READY'
     and exists(select 1 from public.pipeline_runs r where r.trading_date=v_date and r.status='SUCCEEDED'
      and r.idempotency_key like 'research-input:%' and r.provider_status#>>'{result,decision_snapshot_id}'=d.id::text
      and r.provider_status#>>'{result,report_id}'=v_report_id::text
      and r.provider_status#>'{result,success}'='true'::jsonb);
   if v_opening_revision is null then raise exception 'EXISTING_PUBLICATION_RECEIPT_INVALID'; end if;
  else v_opening_revision:=v_snapshot_id;
  end if;
  if v_opening_revision is null or not exists(select 1 from public.decision_snapshots
   where id=v_opening_revision and report_id=v_report_id and report_date=v_date and session_type='PREMARKET' and status='READY')
  then raise exception 'OPENING_PUBLICATION_IDENTITY_INVALID'; end if;
  v_publication:=jsonb_build_object('schema_version','CORE_MARKET_PUBLICATION_V1','status','PUBLISHED',
   'report_date',v_date,'revision_id',v_snapshot_id,'opening_publication_revision_id',v_opening_revision,
   'publication_run_id',p_run_id,'published_at',clock_timestamp());
  update public.reports set ai_strategy_json=ai_strategy_json || jsonb_build_object('revision_id',v_snapshot_id,
    'canonical_contract',p_contract,'canonical_member_revision_id',v_member_id,'market_publication_contract',v_publication)
  where id=v_report_id;
  v_result := jsonb_build_object('success',true,'report_id',v_report_id,'decision_snapshot_id',v_snapshot_id,
    'member_content_revision_id',v_member_id,'report_date',v_date,'semantic_status','PASSED');
  perform public.finish_research_input_v1(p_run_id,p_correlation_id,'SUCCEEDED',v_result,null);
  return v_result;
end; $_$;


--
-- Name: market_checkpoint_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_checkpoint_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    checkpoint text NOT NULL,
    trading_date date NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    market_session text NOT NULL,
    symbol text NOT NULL,
    value numeric NOT NULL,
    change_percent numeric,
    source text NOT NULL,
    source_timestamp timestamp with time zone NOT NULL,
    correlation_id uuid NOT NULL,
    snapshot_version bigint NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    batch_id uuid,
    provider_key text,
    idempotency_key text,
    CONSTRAINT market_checkpoint_snapshots_checkpoint_check CHECK ((checkpoint ~ '^[A-Z0-9_]{2,40}$'::text)),
    CONSTRAINT market_checkpoint_snapshots_market_session_check CHECK ((market_session = ANY (ARRAY['premarket'::text, 'intraday'::text, 'close'::text, 'recovery'::text]))),
    CONSTRAINT market_checkpoint_snapshots_raw_check CHECK ((jsonb_typeof(raw) = 'object'::text)),
    CONSTRAINT market_checkpoint_snapshots_source_check CHECK (((length(TRIM(BOTH FROM source)) >= 1) AND (length(TRIM(BOTH FROM source)) <= 120))),
    CONSTRAINT market_checkpoint_snapshots_symbol_check CHECK (((length(TRIM(BOTH FROM symbol)) >= 1) AND (length(TRIM(BOTH FROM symbol)) <= 40)))
);

ALTER TABLE ONLY public.market_checkpoint_snapshots FORCE ROW LEVEL SECURITY;


--
-- Name: read_committed_market_checkpoint_batch_v1(date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_committed_market_checkpoint_batch_v1(p_business_date date, p_checkpoint text) RETURNS SETOF public.market_checkpoint_snapshots
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select snapshot_row.*
  from public.market_checkpoint_snapshots snapshot_row
  join public.market_checkpoint_batches batch on batch.batch_id = snapshot_row.batch_id
  where batch.business_date = p_business_date
    and batch.checkpoint = p_checkpoint
    and batch.status = 'COMMITTED'
    and public.market_checkpoint_batch_integrity_v1(p_business_date, p_checkpoint)->>'status' = 'PASS'
  order by array_position(public.market_checkpoint_provider_contract_v1(), snapshot_row.provider_key);
$$;


--
-- Name: reconcile_runtime_http_dispatches_v1(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_runtime_http_dispatches_v1(p_limit integer DEFAULT 100) RETURNS TABLE(dispatch_id uuid, dispatch_status text, http_status integer, error_code text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'net'
    AS $$
declare
  v_row record;
  v_retry public.runtime_http_dispatches;
  v_response record;
  v_payload jsonb;
  v_success boolean;
  v_status text;
  v_error text;
  v_state_rank smallint;
begin
  for v_retry in
    select dispatches.*
    from public.runtime_http_dispatches as dispatches
    where dispatches.dispatch_status in ('FAILED', 'TIMED_OUT')
      and dispatches.next_retry_at <= now()
    order by dispatches.next_retry_at
    for update of dispatches skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    if v_retry.retry_count >= v_retry.max_retries
      or (v_retry.deadline_at is not null and v_retry.deadline_at < now())
    then
      update public.runtime_http_dispatches as dispatches
      set dispatch_status = 'DEAD_LETTERED',
          completed_at = now(),
          updated_at = now()
      where dispatches.id = v_retry.id;

      insert into public.runtime_dead_letters (
        component,
        operation,
        idempotency_key,
        correlation_id,
        attempt,
        max_attempts,
        error_code,
        error_message,
        context
      )
      values (
        'runtime_http_dispatch',
        v_retry.job_name,
        v_retry.idempotency_key,
        v_retry.correlation_id,
        v_retry.retry_count + 1,
        v_retry.max_retries + 1,
        coalesce(v_retry.response_error_code, 'HTTP_RETRY_EXHAUSTED'),
        'HTTP retry exhausted or deadline elapsed.',
        jsonb_build_object(
          'dispatch_id', v_retry.id,
          'http_status', v_retry.http_status
        )
      )
      on conflict do nothing;
    else
      perform public.dispatch_morning_alpha_runtime_v1(
        v_retry.trading_date,
        v_retry.job_name,
        v_retry.checkpoint,
        v_retry.request_body,
        true,
        v_retry.deadline_at
      );
    end if;
  end loop;

  for v_row in
    select dispatches.*
    from public.runtime_http_dispatches as dispatches
    where dispatches.dispatch_status in ('DISPATCHED', 'ACKNOWLEDGED')
    order by dispatches.created_at
    for update of dispatches skip locked
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  loop
    select responses.status_code,
           responses.content,
           responses.timed_out,
           responses.error_msg
    into v_response
    from net._http_response as responses
    where responses.id = v_row.request_id;

    if not found then
      if v_row.lease_expires_at <= now() then
        update public.runtime_http_dispatches as dispatches
        set dispatch_status = 'TIMED_OUT',
            response_error_code = 'HTTP_RECEIPT_TIMEOUT',
            next_retry_at = now() + interval '1 minute',
            updated_at = now()
        where dispatches.id = v_row.id;
      else
        update public.runtime_http_dispatches as dispatches
        set dispatch_status = 'ACKNOWLEDGED',
            acknowledged_at = coalesce(dispatches.acknowledged_at, now()),
            updated_at = now()
        where dispatches.id = v_row.id;
      end if;
      continue;
    end if;

    begin
      v_payload := coalesce(v_response.content, '{}')::jsonb;
    exception
      when others then
        v_payload := jsonb_build_object(
          'raw_response',
          left(coalesce(v_response.content, ''), 2000)
        );
    end;

    v_success := v_response.status_code between 200 and 299
      and lower(coalesce(v_payload ->> 'success', v_payload ->> 'ok', 'false')) in ('true', '1');
    v_status := case
      when v_success then 'SUCCEEDED'
      when coalesce(v_response.timed_out, false) then 'TIMED_OUT'
      else 'FAILED'
    end;
    v_error := coalesce(
      v_payload ->> 'error_code',
      v_payload ->> 'error',
      v_response.error_msg,
      case when v_success then null else 'HTTP_BUSINESS_FAILURE' end
    );

    update public.runtime_http_dispatches as dispatches
    set dispatch_status = v_status,
        http_status = v_response.status_code,
        response_success = v_success,
        response_error_code = v_error,
        response_body = v_payload,
        acknowledged_at = coalesce(dispatches.acknowledged_at, now()),
        completed_at = now(),
        next_retry_at = case
          when not v_success
            and (
              coalesce(v_response.timed_out, false)
              or v_response.status_code in (409, 429, 500, 502, 503, 504)
            )
            and dispatches.retry_count < dispatches.max_retries
          then now() + make_interval(
            secs => least(900, 30 * power(2, dispatches.retry_count)::integer)
          )
        end,
        updated_at = now()
    where dispatches.id = v_row.id;

    update public.runtime_http_dispatch_attempts as attempts
    set http_status = v_response.status_code,
        response_error_code = v_error,
        response_body = v_payload,
        completed_at = now()
    where attempts.dispatch_id = v_row.id
      and attempts.request_id = v_row.request_id;

    if v_success and v_row.job_name = 'closing_health' then
      select states.state_rank
      into v_state_rank
      from public.trading_day_state as states
      where states.trading_date = v_row.trading_date;

      if coalesce(v_state_rank, 0) >= 130 then
        perform public.advance_trading_day_state_v1(
          v_row.trading_date,
          'HEALTH_AUDITED',
          'closing_health',
          'SUCCEEDED',
          v_row.correlation_id,
          jsonb_build_object(
            'http_dispatch_id', v_row.id,
            'http_status', v_response.status_code
          )
        );
        perform public.advance_trading_day_state_v1(
          v_row.trading_date,
          'DAY_COMPLETED',
          'day_completed',
          'SUCCEEDED',
          v_row.correlation_id,
          jsonb_build_object(
            'http_dispatch_id', v_row.id,
            'http_status', v_response.status_code
          )
        );
      end if;
    end if;

    if not v_success
      and (
        v_response.status_code in (401, 403)
        or (
          v_response.status_code between 400 and 499
          and v_response.status_code not in (409, 429)
        )
        or v_row.retry_count >= v_row.max_retries
      )
    then
      update public.runtime_http_dispatches as dispatches
      set dispatch_status = 'DEAD_LETTERED',
          completed_at = now(),
          updated_at = now()
      where dispatches.id = v_row.id;

      insert into public.runtime_dead_letters (
        component,
        operation,
        idempotency_key,
        correlation_id,
        attempt,
        max_attempts,
        error_code,
        error_message,
        context
      )
      values (
        'runtime_http_dispatch',
        v_row.job_name,
        v_row.idempotency_key,
        v_row.correlation_id,
        v_row.retry_count + 1,
        v_row.max_retries + 1,
        coalesce(v_error, 'HTTP_BUSINESS_FAILURE'),
        'Final HTTP receipt failed.',
        jsonb_build_object(
          'dispatch_id', v_row.id,
          'http_status', v_response.status_code
        )
      )
      on conflict do nothing;
      v_status := 'DEAD_LETTERED';
    end if;

    dispatch_id := v_row.id;
    dispatch_status := v_status;
    http_status := v_response.status_code;
    error_code := v_error;
    return next;
  end loop;
end;
$$;


--
-- Name: reconcile_runtime_incidents_v1(date, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_runtime_incidents_v1(p_trading_date date, p_actor text, p_reason text, p_request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_idempotency_key text;
  v_existing public.ma_ops_recovery_actions;
  v_before jsonb;
  v_after jsonb;
  v_checkpoint record;
  v_market jsonb;
  v_captured_at timestamptz;
  v_expected_at timestamptz;
  v_correlation_id uuid;
  v_core_reconciled integer:=0;
  v_quality_resolved integer:=0;
  v_refresh_resolved integer:=0;
  v_terminal_failed integer:=0;
  v_open integer:=0;
begin
  if p_trading_date is null then raise exception 'trading_date_required'; end if;
  if coalesce(trim(p_actor),'')='' then raise exception 'recovery_actor_required'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'recovery_reason_required'; end if;
  if p_request_id is null then raise exception 'recovery_request_id_required'; end if;

  v_idempotency_key:='runtime-incident-reconciliation:'||p_trading_date::text||':v1';
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_idempotency_key,0));
  select * into v_existing from public.ma_ops_recovery_actions
  where environment='production' and idempotency_key=v_idempotency_key;
  if found and v_existing.status='succeeded' then return v_existing.after_json; end if;

  v_before:=jsonb_build_object(
    'open_dead_letters',(select count(*) from public.runtime_dead_letters where status='open'),
    'failed_dispatches',(select count(*) from public.runtime_http_dispatches where trading_date=p_trading_date and dispatch_status='FAILED'),
    'dead_lettered_dispatches',(select count(*) from public.runtime_http_dispatches where trading_date=p_trading_date and dispatch_status='DEAD_LETTERED')
  );
  insert into public.ma_ops_recovery_actions(environment,action_type,target,idempotency_key,
    approval_required,approval_status,approved_at,status,before_json)
  values('production','reconcile_runtime_incidents','runtime_http_dispatches',v_idempotency_key,
    true,'approved',now(),'running',v_before)
  on conflict(environment,idempotency_key) do update set
    approval_status='approved',approved_at=now(),status='running',before_json=excluded.before_json,
    after_json='{}'::jsonb,error_message=null,updated_at=now();

  for v_checkpoint in
    select * from (values
      ('0900','MARKET_OPEN_CAPTURED',time '09:00'),
      ('0930','CHECKPOINT_0930_CAPTURED',time '09:30'),
      ('1030','CHECKPOINT_1030_CAPTURED',time '10:30'),
      ('1300','CHECKPOINT_1300_CAPTURED',time '13:00'),
      ('1410','CLOSE_1410_CAPTURED',time '14:10'),
      ('1430','CLOSE_1430_CAPTURED',time '14:30')
    ) as checkpoints(checkpoint,state_name,expected_time)
  loop
    select attempts.response_body #> '{results,market,payload}', dispatches.correlation_id
      into v_market,v_correlation_id
    from public.runtime_http_dispatches dispatches
    join public.runtime_http_dispatch_attempts attempts on attempts.dispatch_id=dispatches.id
    where dispatches.trading_date=p_trading_date
      and dispatches.job_name='runtime_checkpoint'
      and dispatches.checkpoint=v_checkpoint.checkpoint
      and attempts.attempt=1
    order by attempts.started_at
    limit 1;

    if v_market is null
      or v_market->>'trading_day_state_status'<>'SUCCEEDED'
      or coalesce((v_market->>'required_core_complete')::boolean,false)=false
      or coalesce((v_market->>'canonical_complete')::boolean,false)=false
      or coalesce((v_market->>'core_batch_complete')::boolean,false)=false
    then
      raise exception 'core_checkpoint_evidence_incomplete:%',v_checkpoint.checkpoint;
    end if;
    v_captured_at:=nullif(v_market->>'started_at','')::timestamptz;
    v_expected_at:=(p_trading_date::timestamp+v_checkpoint.expected_time) at time zone 'Asia/Taipei';
    if v_captured_at<v_expected_at or v_captured_at>=v_expected_at+interval '10 minutes' then
      raise exception 'core_checkpoint_outside_window:%:%',v_checkpoint.checkpoint,v_captured_at;
    end if;

    perform public.advance_trading_day_state_v1(
      p_trading_date,v_checkpoint.state_name,v_checkpoint.checkpoint,'SUCCEEDED',v_correlation_id,
      v_market||jsonb_build_object(
        'reconciliation_source','runtime_http_dispatch_attempts:first_attempt',
        'recovery_request_id',p_request_id,
        'recovery_actor',p_actor,
        'recovery_reason',p_reason,
        'captured_at',v_captured_at
      )
    );
    v_core_reconciled:=v_core_reconciled+1;
  end loop;

  update public.runtime_http_dispatches
  set dispatch_status='FAILED',response_error_code='QUALITY_BLOCK',next_retry_at=null,
      completed_at=coalesce(completed_at,now()),updated_at=now()
  where trading_date=p_trading_date and http_status=409 and coalesce(response_success,false)=false;

  update public.runtime_dead_letters letters
  set status='resolved',resolved_at=now(),context=letters.context||jsonb_build_object(
    'resolution','QUALITY_BLOCK_TERMINAL','recovery_request_id',p_request_id,
    'recovery_actor',p_actor,'reconciled_at',now())
  from public.runtime_http_dispatches dispatches
  where letters.status='open'
    and letters.component='runtime_http_dispatch'
    and letters.context->>'dispatch_id'=dispatches.id::text
    and dispatches.trading_date=p_trading_date
    and dispatches.http_status=409;
  get diagnostics v_quality_resolved=row_count;

  if coalesce((select checkpoint_status->'premarket'->>'status'='SUCCEEDED'
    and checkpoint_status->'report_generation'->>'status'='SUCCEEDED'
    from public.trading_day_state where trading_date=p_trading_date),false)
  then
    update public.runtime_http_dispatches
    set dispatch_status='SKIPPED',response_error_code='SUPERSEDED_BY_DURABLE_STATE',
        next_retry_at=null,completed_at=coalesce(completed_at,now()),updated_at=now()
    where trading_date=p_trading_date and checkpoint='daily_refresh'
      and dispatch_status='DEAD_LETTERED' and response_error_code='HTTP_RECEIPT_TIMEOUT';
    get diagnostics v_refresh_resolved=row_count;

    update public.runtime_dead_letters letters
    set status='resolved',resolved_at=now(),context=letters.context||jsonb_build_object(
      'resolution','SUPERSEDED_BY_DURABLE_STATE','recovery_request_id',p_request_id,
      'recovery_actor',p_actor,'reconciled_at',now())
    from public.runtime_http_dispatches dispatches
    where letters.status='open'
      and letters.component='runtime_http_dispatch'
      and letters.context->>'dispatch_id'=dispatches.id::text
      and dispatches.trading_date=p_trading_date
      and dispatches.checkpoint='daily_refresh';
  end if;

  update public.runtime_http_dispatches
  set response_error_code='QUALITY_GATE_TERMINAL',next_retry_at=null,updated_at=now()
  where trading_date=p_trading_date and job_name='daily_delivery'
    and dispatch_status='FAILED' and http_status between 200 and 299
    and coalesce(response_success,false)=false
    and response_body->>'status'='DEGRADED';
  get diagnostics v_terminal_failed=row_count;

  select count(*) into v_open from public.runtime_dead_letters where status='open';
  if v_open<>0 then raise exception 'open_dead_letters_remain:%',v_open; end if;

  v_after:=jsonb_build_object(
    'trading_date',p_trading_date,'core_checkpoints_reconciled',v_core_reconciled,
    'quality_dead_letters_resolved',v_quality_resolved,
    'refresh_dead_letters_resolved',v_refresh_resolved,
    'failed_dispatches_terminalized',v_terminal_failed,
    'open_dead_letters',v_open,'duplicate_dispatches',(
      select count(*) from (
        select idempotency_key from public.runtime_http_dispatches
        group by idempotency_key having count(*)>1
      ) duplicates
    )
  );
  update public.ma_ops_recovery_actions
  set status='succeeded',after_json=v_after,updated_at=now()
  where environment='production' and idempotency_key=v_idempotency_key;
  return v_after;
end;
$$;


--
-- Name: reconcile_runtime_terminal_failures_v1(date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_runtime_terminal_failures_v1(p_business_date date, p_correlation_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_count integer; v_r public.reports; v_d public.decision_snapshots;
  v_m public.member_content_revisions; v_sem public.semantic_coherence_reviews;
  v_run public.pipeline_runs; v_pointer jsonb; v_ai jsonb; v_validation jsonb;
begin
  if p_business_date is null or p_correlation_id is null then raise exception 'RECONCILIATION_IDENTITY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('research-publication:'||p_business_date::text,0));
  select * into v_r from public.reports where report_date=p_business_date;
  v_pointer:=v_r.ai_strategy_json->'market_publication_contract';
  select * into v_d from public.decision_snapshots
    where id::text=v_r.ai_strategy_json->>'revision_id' and report_id=v_r.id
      and report_date=p_business_date and session_type='PREMARKET' and status='READY';
  select * into v_m from public.member_content_revisions
    where id::text=v_r.ai_strategy_json->>'canonical_member_revision_id'
      and decision_snapshot_id=v_d.id and decision_snapshot_version=v_d.version
      and report_id=v_r.id and report_date=p_business_date;
  select * into v_run from public.pipeline_runs
    where id::text=v_pointer->>'publication_run_id' and trading_date=p_business_date
      and idempotency_key like 'research-input:%' and status='SUCCEEDED'
      and provider_status#>'{result,success}'='true'::jsonb
      and provider_status#>>'{result,report_id}'=v_r.id::text
      and provider_status#>>'{result,report_date}'=p_business_date::text
      and provider_status#>>'{result,decision_snapshot_id}'=v_d.id::text
      and provider_status#>>'{result,member_content_revision_id}'=v_m.id::text
      and provider_status#>>'{result,semantic_status}'='PASSED'
      and completed_at>=v_d.valid_from and completed_at<=clock_timestamp()
      and (completed_at at time zone 'Asia/Taipei')::date=p_business_date;
  select * into v_sem from public.semantic_coherence_reviews
    where member_content_revision_id=v_m.id and decision_snapshot_id=v_d.id
      and report_date=p_business_date and canonical_snapshot_id=v_d.id
      and canonical_snapshot_version=v_d.version and status='PASSED'
      and cardinality(reason_codes)=0 and cardinality(conflicting_fields)=0
      and checked_at<=v_run.completed_at and result->>'status'='PASSED'
      and result->'eligible'='true'::jsonb and result->'reason_codes'='[]'::jsonb
      and result->'conflicting_fields'='[]'::jsonb
    order by checked_at limit 1;
  if v_r.id is null or v_d.id is null or v_m.id is null or v_run.id is null or v_sem.id is null
    or v_pointer->>'schema_version' is distinct from 'CORE_MARKET_PUBLICATION_V1'
    or v_pointer->>'status' is distinct from 'PUBLISHED'
    or v_pointer->>'report_date' is distinct from p_business_date::text
    or v_pointer->>'revision_id' is distinct from v_d.id::text
    or v_r.ai_strategy_json->'canonical_contract' is distinct from v_m.canonical_contract
    or v_m.canonical_contract->>'snapshot_id' is distinct from v_d.id::text
    or v_m.canonical_contract->'snapshot_version' is distinct from to_jsonb(v_d.version)
    or (v_d.valid_from at time zone 'Asia/Taipei')::date is distinct from p_business_date
    or v_run.provider_status#>'{manifest,missing_sources}' is distinct from '[]'::jsonb
    or not exists(select 1 from public.research_sessions where id=v_d.research_session_id
      and trading_date=p_business_date and data_as_of is not null)
    or not exists(select 1 from public.editorial_reviews where decision_snapshot_id=v_d.id
      and review_status='APPROVED' and content_score>=90 and cardinality(reason_codes)=0)
  then raise exception 'TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED'; end if;
  -- Reconstruct from the frozen publication, never from mutable research QA.
  -- No second quality threshold or mode translator is introduced here.
  v_ai:=jsonb_build_object('canonical_market_state',v_d.generated_text->'canonical_market_state',
    'research_master_v2',v_d.generated_text#>'{canonical_market_state,document}',
    'stock_research',v_d.generated_text->'stock_research',
    'market_report_gate',v_d.generated_text->'market_report_gate',
    'report_date',p_business_date,'today_date',p_business_date,'decision_mode',v_d.decision_mode,
    'canonical_action',v_d.action,'report_status',v_d.status,'data_quality',v_d.generated_text->'data_quality',
    'today_quote',v_d.generated_text->>'daily_sentence',
    'today_beneficiary_stocks',v_d.generated_text->'recommendations',
    'today_beneficiary_stocks_v10',v_d.generated_text->'recommendations');
  v_validation:=public.validate_core_market_publication_v1(p_business_date,v_ai,to_jsonb(v_d),
    v_m.canonical_contract,v_m.member_content,v_sem.result);
  if v_validation->'eligible' is distinct from 'true'::jsonb then
    raise exception 'TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED';
  end if;
  with replacements as (
    select f.id, s.id success_id, v_d.id revision_id
    from public.runtime_http_dispatches f
    join lateral (
      select x.id from public.runtime_http_dispatches x
      where x.trading_date=f.trading_date and x.job_name=f.job_name
        and x.checkpoint is not distinct from f.checkpoint and x.endpoint=f.endpoint
        and x.id<>f.id and x.dispatch_status='SUCCEEDED' and x.response_success=true
        and x.http_status between 200 and 299 and x.completed_at>f.completed_at
        and x.response_body->>'report_date'=f.trading_date::text
        and x.response_body->>'decision_snapshot_id'=v_d.id::text
      order by x.completed_at desc limit 1
    ) s on true
    where f.trading_date=p_business_date and f.dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED')
  )
  update public.runtime_http_dispatches f set dispatch_status='SKIPPED',next_retry_at=null,updated_at=clock_timestamp(),
    response_body=coalesce(f.response_body,'{}')||jsonb_build_object('terminal_reconciliation',
      jsonb_build_object('reason','SAME_JOB_DURABLE_SUCCESS','success_dispatch_id',r.success_id,
        'decision_snapshot_id',r.revision_id,'correlation_id',p_correlation_id,'reconciled_at',clock_timestamp(),
        'original_http_status',f.http_status,'original_error_code',f.response_error_code,'original_completed_at',f.completed_at))
  from replacements r where f.id=r.id;
  get diagnostics v_count=row_count;
  update public.runtime_dead_letters dl set status='resolved',resolved_at=clock_timestamp(),
    context=dl.context||jsonb_build_object('terminal_reconciliation',f.response_body->'terminal_reconciliation')
  from public.runtime_http_dispatches f
  where dl.status='open' and dl.context->>'dispatch_id'=f.id::text and f.trading_date=p_business_date
    and f.dispatch_status='SKIPPED' and f.response_body#>>'{terminal_reconciliation,reason}'='SAME_JOB_DURABLE_SUCCESS';
  return v_count;
end; $$;


--
-- Name: record_content_os_incident_v1(text, date, uuid, integer, text[], integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_content_os_incident_v1(p_incident_key text, p_business_date date, p_snapshot_id uuid, p_snapshot_version integer, p_reason_codes text[], p_http_status integer, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_id uuid;
begin
  if coalesce(trim(p_incident_key),'') = '' or p_business_date is null then
    raise exception 'content os incident identity is required';
  end if;
  insert into public.content_os_sync_incidents(
    incident_key,business_date,snapshot_id,snapshot_version,status,reason_codes,
    first_seen_at,last_seen_at,attempt_count,last_http_status,metadata
  ) values (
    p_incident_key,p_business_date,p_snapshot_id,p_snapshot_version,'OPEN',
    coalesce(p_reason_codes,'{}'::text[]),now(),now(),1,p_http_status,coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (incident_key) do update set
    status='OPEN', reason_codes=excluded.reason_codes, last_seen_at=now(),
    resolved_at=null, attempt_count=public.content_os_sync_incidents.attempt_count+1,
    last_http_status=excluded.last_http_status, metadata=excluded.metadata, updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: record_learning_metric_correction_v1(uuid, date, text, text, jsonb, jsonb, jsonb, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_learning_metric_correction_v1(p_learning_run_id uuid, p_business_date date, p_idempotency_key text, p_engine_version text, p_original_metrics jsonb, p_corrected_metrics jsonb, p_authoritative_counts jsonb, p_reason_code text, p_actor text, p_request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_id uuid;
begin
  insert into public.learning_metric_corrections(
    learning_run_id,business_date,idempotency_key,engine_version,original_metrics,
    corrected_metrics,authoritative_counts,reason_code,actor,request_id
  ) values (
    p_learning_run_id,p_business_date,p_idempotency_key,p_engine_version,p_original_metrics,
    p_corrected_metrics,p_authoritative_counts,p_reason_code,p_actor,p_request_id
  ) on conflict (idempotency_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.learning_metric_corrections where idempotency_key=p_idempotency_key; end if;
  return v_id;
end;
$$;


--
-- Name: record_runtime_cost_usage_v1(date, text, text, text, text, text, uuid, integer, integer, integer, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_runtime_cost_usage_v1(p_usage_date date, p_component text, p_provider text, p_model text, p_operation text, p_idempotency_key text, p_correlation_id uuid, p_input_tokens integer, p_output_tokens integer, p_latency_ms integer, p_status text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_id uuid;
begin
  if p_usage_date is null or nullif(btrim(p_idempotency_key), '') is null or p_correlation_id is null then
    raise exception 'usage_date, idempotency_key and correlation_id are required';
  end if;
  if p_status not in ('succeeded', 'degraded', 'failed', 'skipped_budget') then
    raise exception 'invalid cost usage status';
  end if;
  insert into public.runtime_cost_usage (
    usage_date, component, provider, model, operation, idempotency_key, correlation_id,
    input_tokens, output_tokens, latency_ms, status, metadata
  ) values (
    p_usage_date, p_component, p_provider, p_model, p_operation, p_idempotency_key, p_correlation_id,
    greatest(0, coalesce(p_input_tokens, 0)), greatest(0, coalesce(p_output_tokens, 0)),
    greatest(0, coalesce(p_latency_ms, 0)), p_status, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do update
    set latency_ms = excluded.latency_ms,
        status = excluded.status,
        metadata = public.runtime_cost_usage.metadata || excluded.metadata
  returning id into v_id;
  return v_id;
end;
$$;


--
-- Name: reject_immutable_market_checkpoint_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_immutable_market_checkpoint_mutation_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'market_checkpoint_evidence_is_immutable';
end;
$$;


--
-- Name: reject_market_checkpoint_batch_mutation_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_market_checkpoint_batch_mutation_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  raise exception 'market_checkpoint_batch_is_immutable';
end;
$$;


--
-- Name: resolve_content_os_incident_v1(text, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_content_os_incident_v1(p_incident_key text, p_snapshot_version integer, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_count integer;
begin
  update public.content_os_sync_incidents
  set status='RESOLVED',resolved_at=coalesce(resolved_at,now()),last_seen_at=now(),
      snapshot_version=coalesce(p_snapshot_version,snapshot_version),last_http_status=200,
      metadata=metadata || coalesce(p_metadata,'{}'::jsonb),updated_at=now()
  where incident_key=p_incident_key and status='OPEN';
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;


--
-- Name: set_membership_updated_at_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_membership_updated_at_v1() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: validate_core_market_publication_v1(date, jsonb, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_core_market_publication_v1(p_report_date date, p_ai jsonb, p_decision jsonb, p_contract jsonb, p_member jsonb, p_semantic jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
declare
 v_state jsonb:=p_decision#>'{generated_text,canonical_market_state}';
 v_document jsonb; v_quality jsonb; v_audit jsonb; v_claim jsonb; v_source jsonb;
 v_gate jsonb:=p_decision#>'{generated_text,market_report_gate}';
 v_recommendation jsonb; v_refs jsonb; v_expected jsonb; v_ids jsonb; v_state_ids jsonb;
 v_errors text[]:='{}'; v_field text; v_count integer; v_generated timestamptz;
 v_min numeric; v_sentence text:=p_decision#>>'{generated_text,daily_sentence}';
begin
 v_document:=v_state->'document'; v_quality:=v_document->'quality'; v_audit:=v_quality->'coverage_audit';
 select premium_publish_min into v_min from public.runtime_quality_policies where active=true limit 1;
 if v_min is null or v_min<90 or v_min>100 then v_errors:=array_append(v_errors,'PUBLICATION_POLICY_INVALID'); end if;
 if p_report_date is null or v_state->>'schema_version' is distinct from 'CANONICAL_MARKET_STATE_V1'
  or v_state->>'status' is distinct from 'READY' or v_state->'reason_codes' is distinct from '[]'::jsonb
  or v_state is distinct from p_ai->'canonical_market_state'
  or v_state->>'report_date' is distinct from p_report_date::text
  or v_state->>'today_date' is distinct from p_report_date::text
  or v_document->>'report_date' is distinct from p_report_date::text
  or v_document->>'today_date' is distinct from p_report_date::text
  or v_document->>'timezone' is distinct from 'Asia/Taipei'
  or v_state->>'generated_at' is distinct from v_document#>>'{provenance,generated_at}'
  or v_state->'data_as_of' is distinct from v_document->'data_as_of'
  or v_document#>'{sections,representative_stocks}' is distinct from '[]'::jsonb
 then v_errors:=array_append(v_errors,'CANONICAL_MARKET_IDENTITY_INVALID'); end if;
 begin
  v_generated:=(v_state->>'generated_at')::timestamptz;
  if v_generated is null or not isfinite(v_generated) or v_generated>clock_timestamp()
   or (v_generated at time zone 'Asia/Taipei')::date is distinct from p_report_date
   or nullif(v_state->>'data_as_of','')::timestamptz is null
   or not isfinite((v_state->>'data_as_of')::timestamptz)
   or (v_state->>'data_as_of')::timestamptz>v_generated
  then v_errors:=array_append(v_errors,'MARKET_GENERATION_TIME_INVALID'); end if;
 exception when invalid_datetime_format or datetime_field_overflow then
  v_errors:=array_append(v_errors,'MARKET_GENERATION_TIME_INVALID');
 end;
 if not coalesce(lower(v_quality->>'publish_status') in ('ready','approved','published','publishable'),false)
  or v_quality->'evidence_coverage' is distinct from '100'::jsonb
 then v_errors:=array_append(v_errors,'MARKET_QUALITY_NOT_READY'); end if;
 foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
  if v_quality->v_field is distinct from '[]'::jsonb then
   v_errors:=array_append(v_errors,'MARKET_QUALITY_'||upper(v_field));
  end if;
 end loop;
 if v_audit->>'contract_version' is distinct from 'CLAIM_EVIDENCE_LEDGER_V1'
  or jsonb_typeof(v_audit->'claims') is distinct from 'array'
 then v_errors:=array_append(v_errors,'MARKET_CLAIM_LEDGER_MISSING');
 else
  v_count:=jsonb_array_length(v_audit->'claims');
  if v_count=0 or v_audit->'numerator' is distinct from to_jsonb(v_count)
   or v_audit->'denominator' is distinct from to_jsonb(v_count)
  then v_errors:=array_append(v_errors,'MARKET_CLAIM_COVERAGE_INCOMPLETE'); end if;
  for v_claim in select value from jsonb_array_elements(v_audit->'claims') loop
   if v_claim->>'scope' is distinct from 'market' or v_claim->'supported' is distinct from 'true'::jsonb
    or v_claim->'reason_codes' is distinct from '[]'::jsonb
    or nullif(btrim(v_claim->>'statement'),'') is null
    or nullif(btrim(v_claim->>'claim_id'),'') is null
    or jsonb_typeof(v_claim->'evidence_ids') is distinct from 'array'
    or jsonb_typeof(v_claim->'sources') is distinct from 'array'
   then v_errors:=array_append(v_errors,'MARKET_CLAIM_UNSUPPORTED'); continue; end if;
   if jsonb_array_length(v_claim->'evidence_ids')=0 or jsonb_array_length(v_claim->'sources')=0
    or exists(select 1 from jsonb_array_elements(v_claim->'evidence_ids') x
     where jsonb_typeof(x) is distinct from 'string' or nullif(btrim(x#>>'{}'),'') is null)
   then v_errors:=array_append(v_errors,'MARKET_CLAIM_EVIDENCE_MISSING'); end if;
   select coalesce(jsonb_agg(x order by x),'[]') into v_ids from (select distinct value x from jsonb_array_elements(v_claim->'evidence_ids')) t;
   select coalesce(jsonb_agg(x order by x),'[]') into v_refs from (select distinct value->'evidence_id' x from jsonb_array_elements(v_claim->'sources')) t;
   if v_ids is distinct from v_refs then v_errors:=array_append(v_errors,'MARKET_CLAIM_SOURCE_ID_MISMATCH'); end if;
   for v_source in select value from jsonb_array_elements(v_claim->'sources') loop
    if nullif(btrim(v_source->>'source'),'') is null
     or nullif(btrim(v_source->>'evidence_id'),'') is null
     or not coalesce(case v_source->>'source'
       when 'authoritative_market_data_snapshots_v1' then lower(btrim(v_source->>'freshness'))='previous_trading_day'
         and v_source->>'source_date' ~ '^\d{4}-\d{2}-\d{2}$' and v_source->>'source_date'<p_report_date::text
       when 'sector_rotation_scores' then lower(btrim(v_source->>'freshness'))='previous_trading_day'
         and v_source->>'source_date' ~ '^\d{4}-\d{2}-\d{2}$' and v_source->>'source_date'<p_report_date::text
       when 'reports' then lower(btrim(v_source->>'freshness'))='previous_report'
         and v_source->>'source_date' ~ '^\d{4}-\d{2}-\d{2}$' and v_source->>'source_date'<p_report_date::text
       else lower(btrim(v_source->>'freshness')) in ('fresh','recent') end,false)
    then v_errors:=array_append(v_errors,'MARKET_SOURCE_PROVENANCE_INVALID'); end if;
    begin
     if nullif(v_source->>'source_date','')::timestamptz is null
      or not isfinite((v_source->>'source_date')::timestamptz)
      or (v_source->>'source_date')::timestamptz>v_generated
     then v_errors:=array_append(v_errors,'MARKET_SOURCE_TIME_INVALID'); end if;
    exception when invalid_datetime_format or datetime_field_overflow then
     v_errors:=array_append(v_errors,'MARKET_SOURCE_TIME_INVALID');
    end;
   end loop;
  end loop;
  select coalesce(jsonb_agg(x order by x),'[]') into v_ids from (
   select distinct e.value x from jsonb_array_elements(v_audit->'claims') c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value->'evidence_ids')='array'
     then c.value->'evidence_ids' else '[]' end) e
  ) t;
  if jsonb_typeof(v_state->'evidence_ids') is distinct from 'array' then
   v_errors:=array_append(v_errors,'MARKET_STATE_EVIDENCE_IDS_MISMATCH');
  else
   select coalesce(jsonb_agg(value order by value),'[]') into v_state_ids from jsonb_array_elements(v_state->'evidence_ids');
   if v_ids='[]'::jsonb or v_state_ids is distinct from v_ids
    then v_errors:=array_append(v_errors,'MARKET_STATE_EVIDENCE_IDS_MISMATCH'); end if;
  end if;
  select coalesce(jsonb_agg(x order by x),'[]') into v_expected from (
   select distinct jsonb_build_object('evidence_id',s.value->'evidence_id','source',s.value->'source',
    'source_date',s.value->'source_date','freshness',s.value->'freshness') x
   from jsonb_array_elements(v_audit->'claims') c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value->'sources')='array' then c.value->'sources' else '[]' end) s
  ) t;
  if jsonb_typeof(p_decision->'source_refs') is distinct from 'array' then
   v_errors:=array_append(v_errors,'MARKET_SOURCE_REFS_MISSING');
  else
   select coalesce(jsonb_agg(x order by x),'[]') into v_refs from (
    select distinct jsonb_build_object('evidence_id',value->'evidence_id','source',value->'source',
     'source_date',value->'source_date','freshness',value->'freshness') x from jsonb_array_elements(p_decision->'source_refs')) t;
   if v_refs is distinct from v_expected or v_refs='[]'
    or jsonb_array_length(p_decision->'source_refs')<>jsonb_array_length(v_refs)
   then v_errors:=array_append(v_errors,'MARKET_SOURCE_REFS_MISMATCH'); end if;
  end if;
 end if;
 if p_ai->>'data_quality' is distinct from 'complete' or p_decision->'coverage_score' is distinct from '100'::jsonb
  or p_decision#>>'{generated_text,data_quality}' is distinct from 'complete'
  or p_decision#>'{generated_text,missing_sources}' is distinct from '[]'::jsonb
  or jsonb_typeof(p_decision->'content_score') is distinct from 'number'
  or not coalesce((p_decision->>'content_score')::numeric between v_min and 100,false)
  or v_gate->'content_score' is distinct from p_decision->'content_score'
  or v_gate->>'contract_version' is distinct from 'MARKET_REPORT_GATE_V2'
  or v_gate->'eligible' is distinct from 'true'::jsonb
  or v_gate->>'report_status' is distinct from 'READY' or v_gate->'reason_codes' is distinct from '[]'::jsonb
  or v_gate->>'report_date' is distinct from p_report_date::text
  or v_gate is distinct from p_ai->'market_report_gate'
  or v_gate->>'decision_mode' is distinct from p_decision->>'decision_mode'
  or not coalesce(p_decision->>'decision_mode' in ('market_only','recommendations','no_trade'),false)
  or coalesce(nullif(btrim(p_decision#>>'{generated_text,market_bias}'),''),nullif(btrim(p_decision->>'market_regime'),'')) is null
  or nullif(btrim(v_sentence),'') is null or v_sentence is distinct from v_document#>>'{sections,executive_summary,text}'
 then v_errors:=array_append(v_errors,'MARKET_PUBLICATION_CONTRACT_INVALID'); end if;
 v_recommendation:=v_gate->'recommendation_gate';
 if p_decision->>'decision_mode'='recommendations' then
  -- A qualified stock branch still needs its independent 100% / zero-unsupported
  -- ledger. None of these counters is consulted by market_only publication.
  if p_ai#>>'{stock_research,document,report_date}' is distinct from p_report_date::text
   or p_ai#>'{stock_research,document,quality,evidence_coverage}' is distinct from '100'::jsonb
   or not coalesce(p_ai#>>'{stock_research,document,quality,publish_status}' in ('ready','approved','published','publishable'),false)
  then v_errors:=array_append(v_errors,'STOCK_RESEARCH_EVIDENCE_BLOCKED'); end if;
  foreach v_field in array array['unsupported_claims','duplicate_claims','contradictions','missing_sections'] loop
   if p_ai#>array['stock_research','document','quality',v_field] is distinct from '[]'::jsonb then
    v_errors:=array_append(v_errors,'STOCK_RESEARCH_'||upper(v_field));
   end if;
  end loop;
  if v_recommendation->'eligible' is distinct from 'true'::jsonb or v_recommendation->>'status' is distinct from 'QUALIFIED'
   or jsonb_typeof(p_decision#>'{generated_text,recommendations}') is distinct from 'array'
   or p_decision#>'{generated_text,recommendations}'='[]'::jsonb
  then v_errors:=array_append(v_errors,'RECOMMENDATION_EVIDENCE_BLOCKED'); end if;
 else
  if p_decision#>'{generated_text,recommendations}' is distinct from '[]'::jsonb
   or p_ai->'today_beneficiary_stocks' is distinct from '[]'::jsonb
   or p_ai->'today_beneficiary_stocks_v10' is distinct from '[]'::jsonb
   or coalesce(p_decision->'opportunity_score','null') is distinct from 'null'::jsonb
   or coalesce(p_decision#>'{generated_text,opportunity_score}','null') is distinct from 'null'::jsonb
   or coalesce(p_decision->'stock_opportunities','[]') is distinct from '[]'::jsonb
  then v_errors:=array_append(v_errors,'UNQUALIFIED_STOCK_PROJECTION_FORBIDDEN'); end if;
  if p_decision->>'decision_mode'='market_only' and (
   p_decision->>'action' is distinct from 'WAIT' or v_gate->>'status' is distinct from 'READY_MARKET_ONLY'
   or v_recommendation->'eligible' is distinct from 'false'::jsonb
   or not coalesce(v_recommendation->>'status' in ('BLOCKED','NO_QUALIFIED_OPPORTUNITY'),false))
  then v_errors:=array_append(v_errors,'MARKET_ONLY_CONTRACT_INVALID'); end if;
 end if;
 if v_recommendation->>'status'='NO_QUALIFIED_OPPORTUNITY' and (
  v_recommendation->'universe_evaluation_complete' is distinct from 'true'::jsonb
  or v_recommendation#>>'{screening,status}' is distinct from 'COMPLETE'
  or v_recommendation#>'{screening,rejected}' is distinct from '[]'::jsonb
  or jsonb_typeof(v_recommendation#>'{screening,universe_count}') is distinct from 'number'
  or not coalesce((v_recommendation#>>'{screening,universe_count}')::numeric>0,false)
  or trunc((v_recommendation#>>'{screening,universe_count}')::numeric) is distinct from (v_recommendation#>>'{screening,universe_count}')::numeric
  or v_recommendation#>'{screening,universe_count}' is distinct from v_recommendation#>'{screening,evaluated_count}')
 then v_errors:=array_append(v_errors,'UNIVERSE_EVALUATION_UNVERIFIED'); end if;
 if p_contract is not null then
  if p_contract->>'report_date' is distinct from p_report_date::text
   or p_contract->>'decision_mode' is distinct from p_decision->>'decision_mode'
   or p_contract->>'action' is distinct from p_decision->>'action'
   or p_contract->>'data_quality_status' is distinct from 'complete'
   or p_contract->'market_report_gate' is distinct from v_gate
   or (p_decision->>'decision_mode'<>'recommendations' and p_contract->'primary_symbols' is distinct from '[]'::jsonb)
  then v_errors:=array_append(v_errors,'MEMBER_CANONICAL_CONTRACT_MISMATCH'); end if;
 end if;
 if p_member is not null then
  if p_contract is null or p_member->'canonical_contract' is distinct from p_contract
   or p_member->>'today_core_thesis' is distinct from v_sentence or p_member->>'line_summary' is distinct from v_sentence
  then v_errors:=array_append(v_errors,'MEMBER_MARKET_TEXT_DIVERGENCE'); end if;
  if p_decision->>'decision_mode'<>'recommendations' and (
   p_member->'beneficiary_candidates' is distinct from '[]'::jsonb or p_member->'representative_stocks' is distinct from '[]'::jsonb
   or coalesce(p_member->'recommendations','[]') is distinct from '[]'::jsonb
   or coalesce(p_member->'stock_opportunities','[]') is distinct from '[]'::jsonb
   or coalesce(p_member->'opportunity_score','null') is distinct from 'null'::jsonb)
  then v_errors:=array_append(v_errors,'MEMBER_UNQUALIFIED_STOCKS_FORBIDDEN'); end if;
 end if;
 if p_semantic is not null and (p_semantic->>'status' is distinct from 'PASSED'
  or p_semantic->'eligible' is distinct from 'true'::jsonb
  or p_semantic->'reason_codes' is distinct from '[]'::jsonb
  or p_semantic->'conflicting_fields' is distinct from '[]'::jsonb)
 then v_errors:=array_append(v_errors,'SEMANTIC_MARKET_CONTRACT_BLOCKED'); end if;
 return jsonb_build_object('schema_version','CORE_MARKET_VALIDATION_V1','report_date',p_report_date,
  'eligible',cardinality(v_errors)=0,'reason_codes',(select coalesce(jsonb_agg(x order by x),'[]') from (select distinct unnest(v_errors) x)t));
end;
$_$;


--
-- Name: decision_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    session_type text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    market_score numeric(5,2),
    confidence_score numeric(5,2),
    coverage_score numeric(5,2),
    action text,
    market_regime text,
    preferred_sectors jsonb DEFAULT '[]'::jsonb NOT NULL,
    watch_sectors jsonb DEFAULT '[]'::jsonb NOT NULL,
    blocked_sectors jsonb DEFAULT '[]'::jsonb NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    risk_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    invalidation_rules jsonb DEFAULT '[]'::jsonb NOT NULL,
    factor_scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    score_delta numeric(5,2),
    changed_factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_freshness jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    generated_text jsonb DEFAULT '{}'::jsonb NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_until timestamp with time zone,
    supersedes_id uuid,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    research_session_id uuid,
    report_id uuid,
    snapshot_fingerprint text,
    decision_mode text,
    content_score numeric(5,2),
    content_grade text,
    content_score_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    generic_content_flags text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT decision_snapshots_action_check CHECK (((action IS NULL) OR (action = ANY (ARRAY['TRADE'::text, 'SELECTIVE'::text, 'WAIT'::text, 'REDUCE'::text, 'STOP'::text, 'CLOSED'::text])))),
    CONSTRAINT decision_snapshots_blocked_array CHECK ((jsonb_typeof(blocked_sectors) = 'array'::text)),
    CONSTRAINT decision_snapshots_changed_factors_array CHECK ((jsonb_typeof(changed_factors) = 'array'::text)),
    CONSTRAINT decision_snapshots_confidence_score_check CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (100)::numeric)))),
    CONSTRAINT decision_snapshots_coverage_score_check CHECK (((coverage_score IS NULL) OR ((coverage_score >= (0)::numeric) AND (coverage_score <= (100)::numeric)))),
    CONSTRAINT decision_snapshots_factor_scores_object CHECK ((jsonb_typeof(factor_scores) = 'object'::text)),
    CONSTRAINT decision_snapshots_generated_text_object CHECK ((jsonb_typeof(generated_text) = 'object'::text)),
    CONSTRAINT decision_snapshots_invalidation_array CHECK ((jsonb_typeof(invalidation_rules) = 'array'::text)),
    CONSTRAINT decision_snapshots_market_score_check CHECK (((market_score IS NULL) OR ((market_score >= (0)::numeric) AND (market_score <= (100)::numeric)))),
    CONSTRAINT decision_snapshots_preferred_array CHECK ((jsonb_typeof(preferred_sectors) = 'array'::text)),
    CONSTRAINT decision_snapshots_reasons_array CHECK ((jsonb_typeof(reasons) = 'array'::text)),
    CONSTRAINT decision_snapshots_risk_flags_array CHECK ((jsonb_typeof(risk_flags) = 'array'::text)),
    CONSTRAINT decision_snapshots_session_type_check CHECK ((session_type = ANY (ARRAY['PREMARKET'::text, 'OPENING'::text, 'INTRADAY'::text, 'PRE_CLOSE'::text, 'CLOSING'::text, 'POST_CLOSE'::text]))),
    CONSTRAINT decision_snapshots_source_freshness_object CHECK ((jsonb_typeof(source_freshness) = 'object'::text)),
    CONSTRAINT decision_snapshots_source_refs_array CHECK ((jsonb_typeof(source_refs) = 'array'::text)),
    CONSTRAINT decision_snapshots_status_check CHECK ((status = ANY (ARRAY['READY'::text, 'PARTIAL'::text, 'INSUFFICIENT_DATA'::text, 'INVALIDATED'::text, 'FINAL'::text]))),
    CONSTRAINT decision_snapshots_valid_window CHECK (((valid_until IS NULL) OR (valid_until > valid_from))),
    CONSTRAINT decision_snapshots_version_check CHECK ((version > 0)),
    CONSTRAINT decision_snapshots_watch_array CHECK ((jsonb_typeof(watch_sectors) = 'array'::text))
);


--
-- Name: write_decision_snapshot_v1(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.write_decision_snapshot_v1(p_snapshot jsonb) RETURNS public.decision_snapshots
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_existing public.decision_snapshots;
  v_previous public.decision_snapshots;
  v_result public.decision_snapshots;
  v_report_date date;
  v_session_type text;
  v_idempotency_key text;
  v_market_score numeric;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'FORBIDDEN';
  end if;

  v_report_date := nullif(p_snapshot->>'report_date','')::date;
  v_session_type := upper(nullif(p_snapshot->>'session_type',''));
  v_idempotency_key := nullif(p_snapshot->>'idempotency_key','');
  v_market_score := nullif(p_snapshot->>'market_score','')::numeric;

  if v_report_date is null or v_session_type is null or v_idempotency_key is null then
    raise exception 'MISSING_REQUIRED_SNAPSHOT_FIELDS';
  end if;

  select * into v_existing
  from public.decision_snapshots
  where idempotency_key = v_idempotency_key;

  if found then
    return v_existing;
  end if;

  select * into v_previous
  from public.decision_snapshots
  where report_date = v_report_date
    and session_type = v_session_type
    and is_current = true
  for update;

  if found then
    update public.decision_snapshots
    set is_current = false
    where id = v_previous.id;
  end if;

  insert into public.decision_snapshots (
    report_date, session_type, version, idempotency_key, status,
    market_score, confidence_score, coverage_score, action, market_regime,
    preferred_sectors, watch_sectors, blocked_sectors, reasons, risk_flags,
    invalidation_rules, factor_scores, score_delta, changed_factors,
    source_freshness, source_refs, generated_text, valid_from, valid_until,
    supersedes_id, is_current
  ) values (
    v_report_date,
    v_session_type,
    coalesce(nullif(p_snapshot->>'version','')::integer, coalesce(v_previous.version,0) + 1),
    v_idempotency_key,
    coalesce(upper(nullif(p_snapshot->>'status','')), 'INSUFFICIENT_DATA'),
    v_market_score,
    nullif(p_snapshot->>'confidence_score','')::numeric,
    nullif(p_snapshot->>'coverage_score','')::numeric,
    upper(nullif(p_snapshot->>'action','')),
    nullif(p_snapshot->>'market_regime',''),
    coalesce(p_snapshot->'preferred_sectors','[]'::jsonb),
    coalesce(p_snapshot->'watch_sectors','[]'::jsonb),
    coalesce(p_snapshot->'blocked_sectors','[]'::jsonb),
    coalesce(p_snapshot->'reasons','[]'::jsonb),
    coalesce(p_snapshot->'risk_flags','[]'::jsonb),
    coalesce(p_snapshot->'invalidation_rules','[]'::jsonb),
    coalesce(p_snapshot->'factor_scores','{}'::jsonb),
    case when v_previous.id is null or v_market_score is null or v_previous.market_score is null then null else round(v_market_score - v_previous.market_score, 2) end,
    coalesce(p_snapshot->'changed_factors','[]'::jsonb),
    coalesce(p_snapshot->'source_freshness','{}'::jsonb),
    coalesce(p_snapshot->'source_refs','[]'::jsonb),
    coalesce(p_snapshot->'generated_text','{}'::jsonb),
    coalesce(nullif(p_snapshot->>'valid_from','')::timestamptz, now()),
    nullif(p_snapshot->>'valid_until','')::timestamptz,
    v_previous.id,
    true
  )
  returning * into v_result;

  return v_result;
end;
$$;


--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: market_checkpoint_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_checkpoint_batches (
    batch_id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_date date NOT NULL,
    checkpoint text NOT NULL,
    market_session text NOT NULL,
    correlation_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    provider_contract_version text NOT NULL,
    status text NOT NULL,
    expected_provider_count smallint NOT NULL,
    committed_provider_count smallint NOT NULL,
    payload_hash text NOT NULL,
    committed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT market_checkpoint_batches_checkpoint_check CHECK ((checkpoint = ANY (ARRAY['PREMARKET'::text, '0900'::text, '0930'::text, '1030'::text, '1300'::text, '1410'::text, '1430'::text, 'RECOVERY'::text]))),
    CONSTRAINT market_checkpoint_batches_contract_check CHECK ((provider_contract_version = 'MARKET_CHECKPOINT_PROVIDER_V1'::text)),
    CONSTRAINT market_checkpoint_batches_counts_check CHECK (((expected_provider_count = 11) AND (committed_provider_count = 11))),
    CONSTRAINT market_checkpoint_batches_cutover_check CHECK ((business_date > '2026-09-11'::date)),
    CONSTRAINT market_checkpoint_batches_session_check CHECK ((market_session = ANY (ARRAY['premarket'::text, 'intraday'::text, 'close'::text, 'recovery'::text]))),
    CONSTRAINT market_checkpoint_batches_status_check CHECK ((status = 'COMMITTED'::text))
);

ALTER TABLE ONLY public.market_checkpoint_batches FORCE ROW LEVEL SECURITY;


--
-- Name: market_data_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_data_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    symbol text NOT NULL,
    name text,
    market text,
    value numeric,
    change_percent numeric,
    captured_at timestamp with time zone NOT NULL,
    source text,
    phase text NOT NULL,
    trading_date date NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checkpoint text NOT NULL,
    CONSTRAINT market_data_snapshots_checkpoint_check CHECK ((checkpoint = ANY (ARRAY['premarket'::text, '0900'::text, '0930'::text, '1030'::text, '1300'::text, '1410'::text, '1430'::text, 'manual'::text]))),
    CONSTRAINT market_data_snapshots_phase_check CHECK ((phase = ANY (ARRAY['premarket'::text, 'intraday'::text, 'close'::text, 'manual_backfill'::text])))
);


--
-- Name: authoritative_market_data_snapshots_v1; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.authoritative_market_data_snapshots_v1 WITH (security_invoker='true') AS
 SELECT compatibility.id,
    compatibility.symbol,
    compatibility.name,
    compatibility.market,
    compatibility.value,
    compatibility.change_percent,
    compatibility.captured_at,
    compatibility.source,
    compatibility.phase,
    compatibility.trading_date,
    compatibility.raw,
    compatibility.created_at,
    compatibility.checkpoint,
    batch.batch_id,
    batch.correlation_id AS batch_correlation_id,
    batch.idempotency_key AS batch_idempotency_key,
    batch.provider_contract_version,
    batch.committed_at
   FROM (((public.market_data_snapshots compatibility
     JOIN public.market_checkpoint_batches batch ON (((compatibility.raw ->> 'checkpoint_batch_id'::text) = (batch.batch_id)::text)))
     JOIN public.trading_day_state day_state ON ((day_state.trading_date = batch.business_date)))
     CROSS JOIN LATERAL public.market_checkpoint_batch_integrity_v1(batch.business_date, batch.checkpoint) integrity(integrity))
  WHERE ((batch.status = 'COMMITTED'::text) AND ((integrity.integrity ->> 'status'::text) = 'PASS'::text) AND ((day_state.checkpoint_status #>> ARRAY[
        CASE batch.checkpoint
            WHEN 'PREMARKET'::text THEN 'premarket'::text
            WHEN 'RECOVERY'::text THEN 'manual'::text
            ELSE batch.checkpoint
        END, 'status'::text]) = 'SUCCEEDED'::text) AND ((day_state.checkpoint_status #>> ARRAY[
        CASE batch.checkpoint
            WHEN 'PREMARKET'::text THEN 'premarket'::text
            WHEN 'RECOVERY'::text THEN 'manual'::text
            ELSE batch.checkpoint
        END, 'correlation_id'::text]) = (batch.correlation_id)::text) AND ((day_state.checkpoint_status #>> ARRAY[
        CASE batch.checkpoint
            WHEN 'PREMARKET'::text THEN 'premarket'::text
            WHEN 'RECOVERY'::text THEN 'manual'::text
            ELSE batch.checkpoint
        END, 'metadata'::text, 'atomic_batch_id'::text]) = (batch.batch_id)::text) AND ((day_state.checkpoint_status #> ARRAY[
        CASE batch.checkpoint
            WHEN 'PREMARKET'::text THEN 'premarket'::text
            WHEN 'RECOVERY'::text THEN 'manual'::text
            ELSE batch.checkpoint
        END, 'metadata'::text, 'atomic_checkpoint_complete'::text]) = 'true'::jsonb))
UNION ALL
 SELECT compatibility.id,
    compatibility.symbol,
    compatibility.name,
    compatibility.market,
    compatibility.value,
    compatibility.change_percent,
    compatibility.captured_at,
    compatibility.source,
    compatibility.phase,
    compatibility.trading_date,
    compatibility.raw,
    compatibility.created_at,
    compatibility.checkpoint,
    NULL::uuid AS batch_id,
    NULL::uuid AS batch_correlation_id,
    NULL::text AS batch_idempotency_key,
    'LEGACY_PRE_ATOMIC_CUTOVER'::text AS provider_contract_version,
    compatibility.created_at AS committed_at
   FROM public.market_data_snapshots compatibility
  WHERE (compatibility.trading_date < '2026-09-11'::date);


--
-- Name: billing_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    provider_event_id text NOT NULL,
    event_type text NOT NULL,
    user_id uuid,
    processing_status text DEFAULT 'received'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT billing_webhook_events_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT billing_webhook_events_processing_status_check CHECK ((processing_status = ANY (ARRAY['received'::text, 'processed'::text, 'ignored'::text, 'failed'::text])))
);


--
-- Name: catalyst_tw_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalyst_tw_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    catalyst_id uuid NOT NULL,
    stock_symbol text NOT NULL,
    company_name text NOT NULL,
    sector text NOT NULL,
    mapping_strength text NOT NULL,
    transmission_path text NOT NULL,
    taiwan_supply_chain_relation text NOT NULL,
    confirmation_condition text NOT NULL,
    invalidation_condition text NOT NULL,
    source_refs jsonb NOT NULL,
    confidence_score numeric(5,2) NOT NULL,
    actionable boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalyst_tw_mappings_check CHECK (((actionable = false) OR ((mapping_strength = ANY (ARRAY['DIRECT'::text, 'INDIRECT'::text])) AND (confidence_score >= (70)::numeric)))),
    CONSTRAINT catalyst_tw_mappings_confidence_score_check CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (100)::numeric))),
    CONSTRAINT catalyst_tw_mappings_mapping_strength_check CHECK ((mapping_strength = ANY (ARRAY['DIRECT'::text, 'INDIRECT'::text, 'THEMATIC'::text, 'WEAK'::text]))),
    CONSTRAINT catalyst_tw_mappings_source_refs_check CHECK (((jsonb_typeof(source_refs) = 'array'::text) AND (jsonb_array_length(source_refs) > 0)))
);


--
-- Name: close_market_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.close_market_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    premarket_bias text,
    premarket_confidence integer,
    premarket_summary text,
    opening_radar_status text,
    opening_radar_bias text,
    opening_radar_confidence integer,
    opening_radar_summary text,
    taiex_change numeric,
    tsmc_change numeric,
    txf_change numeric,
    actual_market_result text DEFAULT '待判定'::text NOT NULL,
    verification_result text DEFAULT '樣本累積中'::text NOT NULL,
    verification_label text DEFAULT '樣本累積中'::text NOT NULL,
    verification_note text,
    ai_too_bullish boolean DEFAULT false NOT NULL,
    ai_too_bearish boolean DEFAULT false NOT NULL,
    intraday_correction_success boolean DEFAULT false NOT NULL,
    defensive_call_success boolean DEFAULT false NOT NULL,
    data_quality text DEFAULT '中可信'::text NOT NULL,
    missing_data text[] DEFAULT '{}'::text[] NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    symbol text NOT NULL,
    company_name text,
    event_type text NOT NULL,
    title text NOT NULL,
    event_at timestamp with time zone NOT NULL,
    source_ref text NOT NULL,
    significance_score numeric(7,4),
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_events_raw_payload_check CHECK ((jsonb_typeof(raw_payload) = 'object'::text))
);

ALTER TABLE ONLY public.company_events FORCE ROW LEVEL SECURITY;


--
-- Name: content_engagement_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_engagement_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_name text NOT NULL,
    page_path text,
    report_date date,
    content_type text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: content_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    report_date date NOT NULL,
    decision_snapshot_id uuid,
    feedback_type text NOT NULL,
    rating smallint,
    comment text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_feedback_comment_check CHECK (((comment IS NULL) OR (char_length(comment) <= 1000))),
    CONSTRAINT content_feedback_feedback_type_check CHECK ((feedback_type = ANY (ARRAY['HELPFUL'::text, 'NOT_HELPFUL'::text, 'TOO_GENERIC'::text, 'TOO_LATE'::text, 'ACTED_ON'::text, 'OTHER'::text]))),
    CONSTRAINT content_feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: content_os_sync_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_os_sync_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_key text NOT NULL,
    business_date date NOT NULL,
    snapshot_id uuid,
    snapshot_version integer,
    destination text DEFAULT 'morning_alpha_content_os'::text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    attempt_count integer DEFAULT 1 NOT NULL,
    last_http_status integer,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_os_sync_incidents_attempt_count_check CHECK ((attempt_count > 0)),
    CONSTRAINT content_os_sync_incidents_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text])))
);

ALTER TABLE ONLY public.content_os_sync_incidents FORCE ROW LEVEL SECURITY;


--
-- Name: member_content_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_content_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    report_id uuid NOT NULL,
    decision_snapshot_id uuid NOT NULL,
    decision_snapshot_version integer NOT NULL,
    revision integer NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    canonical_contract jsonb NOT NULL,
    member_content jsonb NOT NULL,
    data_quality_status text NOT NULL,
    content_score numeric(5,2) NOT NULL,
    evidence_coverage numeric(5,2) NOT NULL,
    source_revision text NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_content_revisions_content_score_check CHECK (((content_score >= (0)::numeric) AND (content_score <= (100)::numeric))),
    CONSTRAINT member_content_revisions_decision_snapshot_version_check CHECK ((decision_snapshot_version > 0)),
    CONSTRAINT member_content_revisions_evidence_coverage_check CHECK (((evidence_coverage >= (0)::numeric) AND (evidence_coverage <= (100)::numeric))),
    CONSTRAINT member_content_revisions_revision_check CHECK ((revision > 0)),
    CONSTRAINT member_content_revisions_status_check CHECK ((status = ANY (ARRAY['PASSED'::text, 'BLOCKED'::text, 'DEGRADED'::text])))
);

ALTER TABLE ONLY public.member_content_revisions FORCE ROW LEVEL SECURITY;


--
-- Name: semantic_coherence_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.semantic_coherence_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    decision_snapshot_id uuid NOT NULL,
    member_content_revision_id uuid NOT NULL,
    gate_version text NOT NULL,
    status text NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    conflicting_fields text[] DEFAULT '{}'::text[] NOT NULL,
    canonical_snapshot_id uuid NOT NULL,
    canonical_snapshot_version integer NOT NULL,
    checked_at timestamp with time zone NOT NULL,
    idempotency_key text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT semantic_coherence_reviews_canonical_snapshot_version_check CHECK ((canonical_snapshot_version > 0)),
    CONSTRAINT semantic_coherence_reviews_status_check CHECK ((status = ANY (ARRAY['PASSED'::text, 'BLOCKED'::text, 'DEGRADED'::text])))
);

ALTER TABLE ONLY public.semantic_coherence_reviews FORCE ROW LEVEL SECURITY;


--
-- Name: current_member_content_revisions_v1; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.current_member_content_revisions_v1 WITH (security_invoker='true') AS
 SELECT DISTINCT ON (r.report_date) r.id,
    r.report_date,
    r.report_id,
    r.decision_snapshot_id,
    r.decision_snapshot_version,
    r.revision,
    r.idempotency_key,
    r.status,
    r.canonical_contract,
    r.member_content,
    r.data_quality_status,
    r.content_score,
    r.evidence_coverage,
    r.source_revision,
    r.generated_at,
    r.metadata,
    r.created_at,
    s.status AS semantic_status,
    s.reason_codes AS semantic_reason_codes,
    s.conflicting_fields AS semantic_conflicting_fields,
    s.gate_version AS semantic_gate_version,
    s.checked_at AS semantic_checked_at
   FROM (public.member_content_revisions r
     JOIN public.semantic_coherence_reviews s ON ((s.member_content_revision_id = r.id)))
  WHERE ((r.status = 'PASSED'::text) AND (s.status = 'PASSED'::text))
  ORDER BY r.report_date, r.revision DESC, s.checked_at DESC;


--
-- Name: daily_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    market_sentiment text,
    confidence_score integer,
    one_sentence_summary text,
    full_report jsonb,
    public_summary text,
    pro_content text,
    status text DEFAULT 'draft'::text,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: data_provider_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_provider_health (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    service_date date NOT NULL,
    phase text NOT NULL,
    status text NOT NULL,
    success_rate numeric(7,4) NOT NULL,
    requested_count integer DEFAULT 0 NOT NULL,
    succeeded_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    latency_ms integer,
    timed_out boolean DEFAULT false NOT NULL,
    last_error_code text,
    correlation_id uuid,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    checkpoint text NOT NULL,
    CONSTRAINT data_provider_health_details_check CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT data_provider_health_failed_count_check CHECK ((failed_count >= 0)),
    CONSTRAINT data_provider_health_latency_ms_check CHECK ((latency_ms >= 0)),
    CONSTRAINT data_provider_health_requested_count_check CHECK ((requested_count >= 0)),
    CONSTRAINT data_provider_health_status_check CHECK ((status = ANY (ARRAY['healthy'::text, 'degraded'::text, 'down'::text, 'unknown'::text]))),
    CONSTRAINT data_provider_health_succeeded_count_check CHECK ((succeeded_count >= 0)),
    CONSTRAINT data_provider_health_success_rate_check CHECK (((success_rate >= (0)::numeric) AND (success_rate <= (100)::numeric)))
);

ALTER TABLE ONLY public.data_provider_health FORCE ROW LEVEL SECURITY;


--
-- Name: decision_snapshot_market_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_snapshot_market_evidence (
    decision_snapshot_id uuid NOT NULL,
    market_checkpoint_snapshot_id uuid NOT NULL,
    evidence_role text DEFAULT 'PREMARKET'::text NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT decision_snapshot_market_evidence_evidence_role_check CHECK ((evidence_role = 'PREMARKET'::text))
);

ALTER TABLE ONLY public.decision_snapshot_market_evidence FORCE ROW LEVEL SECURITY;


--
-- Name: early_access_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.early_access_signups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    line_name text,
    user_type text,
    interests jsonb DEFAULT '[]'::jsonb,
    source_page text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: earnings_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.earnings_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    symbol text NOT NULL,
    fiscal_period text NOT NULL,
    announced_at timestamp with time zone NOT NULL,
    revenue_actual numeric(24,4),
    revenue_consensus numeric(24,4),
    eps_actual numeric(18,6),
    eps_consensus numeric(18,6),
    guidance_direction text,
    surprise_score numeric(7,4),
    source_ref text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT earnings_events_raw_payload_check CHECK ((jsonb_typeof(raw_payload) = 'object'::text))
);

ALTER TABLE ONLY public.earnings_events FORCE ROW LEVEL SECURITY;


--
-- Name: editorial_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.editorial_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    research_session_id uuid NOT NULL,
    decision_snapshot_id uuid,
    review_status text NOT NULL,
    content_score numeric(5,2) NOT NULL,
    content_score_breakdown jsonb NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    generic_content_flags text[] DEFAULT '{}'::text[] NOT NULL,
    reviewed_by text DEFAULT 'content_intelligence_v2'::text NOT NULL,
    reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT editorial_reviews_content_score_check CHECK (((content_score >= (0)::numeric) AND (content_score <= (100)::numeric))),
    CONSTRAINT editorial_reviews_review_status_check CHECK ((review_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'DEGRADED'::text, 'REJECTED'::text])))
);


--
-- Name: futures_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.futures_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_quote_id uuid,
    provider text NOT NULL,
    symbol text NOT NULL,
    contract_code text,
    expiry_date date,
    market text NOT NULL,
    trading_date date NOT NULL,
    phase text NOT NULL,
    value numeric(22,8) NOT NULL,
    change_percent numeric(12,6),
    open_interest numeric(22,4),
    captured_at timestamp with time zone NOT NULL,
    correlation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.futures_snapshots FORCE ROW LEVEL SECURITY;


--
-- Name: growth_events_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_events_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    anonymous_id text,
    session_id text,
    event_name text NOT NULL,
    funnel_stage text,
    report_date date,
    page_path text,
    idempotency_key text NOT NULL,
    event_taxonomy_version text DEFAULT 'MA_GROWTH_V1'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT growth_events_v2_check CHECK (((actor_id IS NOT NULL) OR (anonymous_id IS NOT NULL))),
    CONSTRAINT growth_events_v2_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);

ALTER TABLE ONLY public.growth_events_v2 FORCE ROW LEVEL SECURITY;


--
-- Name: historical_replay_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historical_replay_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    replay_run_id uuid NOT NULL,
    decision_snapshot_id uuid,
    prediction_id uuid,
    report_date date NOT NULL,
    predicted_direction text,
    actual_direction text,
    confidence_score numeric(7,4),
    outcome_score numeric(7,4),
    correct boolean,
    brier_component numeric(7,4),
    market_regime text,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.historical_replay_results FORCE ROW LEVEL SECURITY;


--
-- Name: historical_replay_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historical_replay_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    strategy_id uuid NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    status text NOT NULL,
    dry_run boolean DEFAULT true NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id uuid NOT NULL,
    total_cases integer DEFAULT 0 NOT NULL,
    evaluated_cases integer DEFAULT 0 NOT NULL,
    accuracy numeric(7,4),
    brier_score numeric(7,4),
    error_code text,
    error_message text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT historical_replay_runs_check CHECK ((to_date >= from_date)),
    CONSTRAINT historical_replay_runs_evaluated_cases_check CHECK ((evaluated_cases >= 0)),
    CONSTRAINT historical_replay_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'degraded'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT historical_replay_runs_total_cases_check CHECK ((total_cases >= 0))
);

ALTER TABLE ONLY public.historical_replay_runs FORCE ROW LEVEL SECURITY;


--
-- Name: historical_similarity_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historical_similarity_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_snapshot_id uuid NOT NULL,
    similar_snapshot_id uuid NOT NULL,
    algorithm_version text DEFAULT 'MA_SIMILARITY_V1'::text NOT NULL,
    similarity_score numeric(7,4) NOT NULL,
    feature_breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    outcome_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT historical_similarity_results_check CHECK ((target_snapshot_id <> similar_snapshot_id)),
    CONSTRAINT historical_similarity_results_feature_breakdown_check CHECK ((jsonb_typeof(feature_breakdown) = 'object'::text)),
    CONSTRAINT historical_similarity_results_outcome_summary_check CHECK ((jsonb_typeof(outcome_summary) = 'object'::text)),
    CONSTRAINT historical_similarity_results_similarity_score_check CHECK (((similarity_score >= (0)::numeric) AND (similarity_score <= (100)::numeric)))
);

ALTER TABLE ONLY public.historical_similarity_results FORCE ROW LEVEL SECURITY;


--
-- Name: institutional_flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.institutional_flows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    market text DEFAULT 'TW'::text NOT NULL,
    trading_date date NOT NULL,
    institution_type text NOT NULL,
    symbol text,
    buy_amount numeric(22,4),
    sell_amount numeric(22,4),
    net_amount numeric(22,4) NOT NULL,
    currency text DEFAULT 'TWD'::text NOT NULL,
    captured_at timestamp with time zone NOT NULL,
    source_ref text NOT NULL,
    correlation_id uuid,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT institutional_flows_raw_payload_check CHECK ((jsonb_typeof(raw_payload) = 'object'::text))
);

ALTER TABLE ONLY public.institutional_flows FORCE ROW LEVEL SECURITY;


--
-- Name: intraday_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intraday_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    check_date date NOT NULL,
    check_time text NOT NULL,
    opening_status text NOT NULL,
    taiex_change numeric,
    futures_change numeric,
    tsmc_change numeric,
    volume_status text,
    scenario_result text,
    ai_summary text,
    should_push_line boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: learning_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learning_run_id uuid,
    idempotency_key text,
    entity_type text NOT NULL,
    entity_id uuid,
    action text NOT NULL,
    actor_type text NOT NULL,
    actor_id uuid,
    before_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    after_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_audit_logs_actor_type_check CHECK ((actor_type = ANY (ARRAY['system'::text, 'admin'::text, 'migration'::text]))),
    CONSTRAINT learning_audit_logs_after_json_check CHECK ((jsonb_typeof(after_json) = 'object'::text)),
    CONSTRAINT learning_audit_logs_before_json_check CHECK ((jsonb_typeof(before_json) = 'object'::text))
);

ALTER TABLE ONLY public.learning_audit_logs FORCE ROW LEVEL SECURITY;


--
-- Name: learning_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prediction_id uuid NOT NULL,
    prediction_review_id uuid NOT NULL,
    case_type text NOT NULL,
    case_signature text NOT NULL,
    title text NOT NULL,
    root_cause text,
    lesson text NOT NULL,
    effective_evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    missed_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    false_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    pattern_dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    market_regime text,
    confidence_bucket text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_cases_case_type_check CHECK ((case_type = ANY (ARRAY['error'::text, 'success'::text]))),
    CONSTRAINT learning_cases_effective_evidence_check CHECK ((jsonb_typeof(effective_evidence) = 'array'::text)),
    CONSTRAINT learning_cases_false_signals_check CHECK ((jsonb_typeof(false_signals) = 'array'::text)),
    CONSTRAINT learning_cases_missed_signals_check CHECK ((jsonb_typeof(missed_signals) = 'array'::text)),
    CONSTRAINT learning_cases_pattern_dimensions_check CHECK ((jsonb_typeof(pattern_dimensions) = 'object'::text)),
    CONSTRAINT learning_cases_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'invalid'::text])))
);

ALTER TABLE ONLY public.learning_cases FORCE ROW LEVEL SECURITY;


--
-- Name: learning_metric_corrections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_metric_corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learning_run_id uuid NOT NULL,
    business_date date NOT NULL,
    idempotency_key text NOT NULL,
    engine_version text NOT NULL,
    original_metrics jsonb NOT NULL,
    corrected_metrics jsonb NOT NULL,
    authoritative_counts jsonb NOT NULL,
    reason_code text NOT NULL,
    actor text NOT NULL,
    request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.learning_metric_corrections FORCE ROW LEVEL SECURITY;


--
-- Name: learning_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_snapshot_id uuid,
    report_id uuid,
    root_prediction_id uuid,
    supersedes_prediction_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    report_date date NOT NULL,
    prediction_at timestamp with time zone NOT NULL,
    analysis_window text NOT NULL,
    prediction_scope text NOT NULL,
    symbol text NOT NULL,
    asset_name text,
    market text DEFAULT 'TW'::text NOT NULL,
    sector text,
    event_id text,
    thesis text NOT NULL,
    direction text NOT NULL,
    model_confidence numeric(5,2),
    calibrated_confidence numeric(5,2),
    calibration_adjustment numeric(5,2) DEFAULT 0 NOT NULL,
    evidence_score numeric(5,2),
    catalyst_score numeric(5,2),
    surprise_score numeric(5,2),
    taiwan_mapping_score numeric(5,2),
    price_in_score numeric(5,2),
    risk_score numeric(5,2),
    expected_horizon text NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    price_at_prediction numeric,
    benchmark_symbol text DEFAULT 'TAIEX'::text NOT NULL,
    benchmark_price_at_prediction numeric,
    sector_benchmark_symbol text,
    sector_benchmark_price_at_prediction numeric,
    model_version text,
    prompt_version text,
    rule_version text,
    scoring_version text,
    data_version text,
    data_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    data_quality_status text NOT NULL,
    record_status text DEFAULT 'valid'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT learning_predictions_analysis_window_check CHECK ((analysis_window = ANY (ARRAY['PREMARKET'::text, 'OPEN'::text, 'MID_MORNING'::text, 'INTRADAY'::text, 'CLOSE'::text]))),
    CONSTRAINT learning_predictions_calibrated_confidence_check CHECK (((calibrated_confidence >= (0)::numeric) AND (calibrated_confidence <= (100)::numeric))),
    CONSTRAINT learning_predictions_calibration_adjustment_check CHECK (((calibration_adjustment >= ('-25'::integer)::numeric) AND (calibration_adjustment <= (25)::numeric))),
    CONSTRAINT learning_predictions_catalyst_score_check CHECK (((catalyst_score >= (0)::numeric) AND (catalyst_score <= (100)::numeric))),
    CONSTRAINT learning_predictions_check CHECK ((((revision = 1) AND (root_prediction_id IS NULL) AND (supersedes_prediction_id IS NULL)) OR ((revision > 1) AND (root_prediction_id IS NOT NULL) AND (supersedes_prediction_id IS NOT NULL)))),
    CONSTRAINT learning_predictions_data_quality_status_check CHECK ((data_quality_status = ANY (ARRAY['complete'::text, 'degraded'::text, 'insufficient_data'::text, 'provider_failure'::text, 'stale_data'::text, 'incomplete_market_session'::text, 'invalid_prediction'::text]))),
    CONSTRAINT learning_predictions_data_snapshot_check CHECK ((jsonb_typeof(data_snapshot) = 'object'::text)),
    CONSTRAINT learning_predictions_direction_check CHECK ((direction = ANY (ARRAY['bullish'::text, 'bearish'::text, 'neutral'::text]))),
    CONSTRAINT learning_predictions_evidence_score_check CHECK (((evidence_score >= (0)::numeric) AND (evidence_score <= (100)::numeric))),
    CONSTRAINT learning_predictions_model_confidence_check CHECK (((model_confidence >= (0)::numeric) AND (model_confidence <= (100)::numeric))),
    CONSTRAINT learning_predictions_prediction_scope_check CHECK ((prediction_scope = ANY (ARRAY['market'::text, 'sector'::text, 'symbol'::text]))),
    CONSTRAINT learning_predictions_price_in_score_check CHECK (((price_in_score >= (0)::numeric) AND (price_in_score <= (100)::numeric))),
    CONSTRAINT learning_predictions_record_status_check CHECK ((record_status = ANY (ARRAY['valid'::text, 'invalid'::text]))),
    CONSTRAINT learning_predictions_revision_check CHECK ((revision > 0)),
    CONSTRAINT learning_predictions_risk_score_check CHECK (((risk_score >= (0)::numeric) AND (risk_score <= (100)::numeric))),
    CONSTRAINT learning_predictions_source_refs_check CHECK ((jsonb_typeof(source_refs) = 'array'::text)),
    CONSTRAINT learning_predictions_surprise_score_check CHECK (((surprise_score >= (0)::numeric) AND (surprise_score <= (100)::numeric))),
    CONSTRAINT learning_predictions_taiwan_mapping_score_check CHECK (((taiwan_mapping_score >= (0)::numeric) AND (taiwan_mapping_score <= (100)::numeric)))
);

ALTER TABLE ONLY public.learning_predictions FORCE ROW LEVEL SECURITY;


--
-- Name: learning_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_date date NOT NULL,
    run_type text NOT NULL,
    idempotency_key text NOT NULL,
    engine_version text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status text NOT NULL,
    predictions_processed integer DEFAULT 0 NOT NULL,
    outcomes_updated integer DEFAULT 0 NOT NULL,
    reviews_created integer DEFAULT 0 NOT NULL,
    cases_created integer DEFAULT 0 NOT NULL,
    patterns_updated integer DEFAULT 0 NOT NULL,
    rules_evaluated integer DEFAULT 0 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    outcomes_created integer DEFAULT 0 NOT NULL,
    outcomes_unchanged integer DEFAULT 0 NOT NULL,
    reviews_updated integer DEFAULT 0 NOT NULL,
    reviews_unchanged integer DEFAULT 0 NOT NULL,
    cases_unchanged integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT learning_runs_cases_created_check CHECK ((cases_created >= 0)),
    CONSTRAINT learning_runs_cases_unchanged_check CHECK ((cases_unchanged >= 0)),
    CONSTRAINT learning_runs_errors_check CHECK ((jsonb_typeof(errors) = 'array'::text)),
    CONSTRAINT learning_runs_failed_count_check CHECK ((failed_count >= 0)),
    CONSTRAINT learning_runs_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT learning_runs_outcomes_created_check CHECK ((outcomes_created >= 0)),
    CONSTRAINT learning_runs_outcomes_unchanged_check CHECK ((outcomes_unchanged >= 0)),
    CONSTRAINT learning_runs_outcomes_updated_check CHECK ((outcomes_updated >= 0)),
    CONSTRAINT learning_runs_patterns_updated_check CHECK ((patterns_updated >= 0)),
    CONSTRAINT learning_runs_predictions_processed_check CHECK ((predictions_processed >= 0)),
    CONSTRAINT learning_runs_retry_count_check CHECK ((retry_count >= 0)),
    CONSTRAINT learning_runs_reviews_created_check CHECK ((reviews_created >= 0)),
    CONSTRAINT learning_runs_reviews_unchanged_check CHECK ((reviews_unchanged >= 0)),
    CONSTRAINT learning_runs_reviews_updated_check CHECK ((reviews_updated >= 0)),
    CONSTRAINT learning_runs_rules_evaluated_check CHECK ((rules_evaluated >= 0)),
    CONSTRAINT learning_runs_run_type_check CHECK ((run_type = ANY (ARRAY['daily'::text, 'backfill'::text, 'recompute'::text, 'shadow'::text]))),
    CONSTRAINT learning_runs_skipped_count_check CHECK ((skipped_count >= 0)),
    CONSTRAINT learning_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'succeeded'::text, 'degraded'::text, 'failed'::text, 'skipped'::text])))
);

ALTER TABLE ONLY public.learning_runs FORCE ROW LEVEL SECURITY;


--
-- Name: line_push_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_push_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    line_user_id text,
    push_type text DEFAULT 'daily_report'::text NOT NULL,
    report_date date,
    status text DEFAULT 'pending'::text NOT NULL,
    message_preview text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: line_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    line_user_id text NOT NULL,
    display_name text,
    picture_url text,
    status_message text,
    source text DEFAULT 'line_follow'::text,
    is_active boolean DEFAULT true NOT NULL,
    last_followed_at timestamp with time zone,
    last_unfollowed_at timestamp with time zone,
    last_pushed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ma_chaos_clock_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ma_chaos_clock_control (
    singleton boolean DEFAULT true NOT NULL,
    simulated_at timestamp with time zone NOT NULL,
    CONSTRAINT ma_chaos_clock_control_singleton_check CHECK (singleton)
);


--
-- Name: ma_chaos_line_sink_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ma_chaos_line_sink_events (
    id bigint NOT NULL,
    scenario_day date NOT NULL,
    simulated_at timestamp with time zone NOT NULL,
    recipient_count integer NOT NULL,
    message_type text NOT NULL,
    response_status integer NOT NULL,
    payload_sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT ma_chaos_line_sink_events_payload_sha256_check CHECK ((payload_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT ma_chaos_line_sink_events_recipient_count_check CHECK ((recipient_count > 0)),
    CONSTRAINT ma_chaos_line_sink_events_response_status_check CHECK ((response_status = ANY (ARRAY[200, 503])))
);


--
-- Name: ma_chaos_line_sink_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ma_chaos_line_sink_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ma_chaos_line_sink_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ma_ops_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ma_ops_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    component text NOT NULL,
    check_name text NOT NULL,
    expected_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    actual_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    severity text NOT NULL,
    latency_ms integer,
    error_code text,
    error_message text,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ma_ops_checks_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT ma_ops_checks_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT ma_ops_checks_status_check CHECK ((status = ANY (ARRAY['passed'::text, 'warning'::text, 'failed'::text, 'skipped'::text])))
);

ALTER TABLE ONLY public.ma_ops_checks FORCE ROW LEVEL SECURITY;


--
-- Name: ma_ops_component_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ma_ops_component_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment text DEFAULT 'production'::text NOT NULL,
    component_key text NOT NULL,
    component_name text NOT NULL,
    component_type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    expected_phase text,
    expected_by_time time without time zone,
    timezone text DEFAULT 'Asia/Taipei'::text NOT NULL,
    grace_minutes integer DEFAULT 10 NOT NULL,
    stale_after_minutes integer,
    severity_on_failure text DEFAULT 'warning'::text NOT NULL,
    auto_retry_allowed boolean DEFAULT false NOT NULL,
    max_auto_retries integer DEFAULT 0 NOT NULL,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ma_ops_component_registry_component_type_check CHECK ((component_type = ANY (ARRAY['data'::text, 'report'::text, 'radar'::text, 'war_room'::text, 'line_push'::text, 'verification'::text, 'performance'::text, 'synthetic'::text]))),
    CONSTRAINT ma_ops_component_registry_environment_check CHECK ((environment = ANY (ARRAY['production'::text, 'staging'::text, 'development'::text]))),
    CONSTRAINT ma_ops_component_registry_grace_minutes_check CHECK ((grace_minutes >= 0)),
    CONSTRAINT ma_ops_component_registry_max_auto_retries_check CHECK ((max_auto_retries >= 0)),
    CONSTRAINT ma_ops_component_registry_severity_on_failure_check CHECK ((severity_on_failure = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT ma_ops_component_registry_stale_after_minutes_check CHECK (((stale_after_minutes IS NULL) OR (stale_after_minutes >= 0)))
);

ALTER TABLE ONLY public.ma_ops_component_registry FORCE ROW LEVEL SECURITY;


--
-- Name: ma_ops_recovery_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ma_ops_recovery_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid,
    check_id uuid,
    environment text DEFAULT 'production'::text NOT NULL,
    action_type text NOT NULL,
    target text NOT NULL,
    idempotency_key text NOT NULL,
    approval_required boolean DEFAULT true NOT NULL,
    approval_status text DEFAULT 'pending'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    before_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    after_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ma_ops_recovery_actions_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'not_required'::text]))),
    CONSTRAINT ma_ops_recovery_actions_environment_check CHECK ((environment = ANY (ARRAY['production'::text, 'staging'::text, 'development'::text]))),
    CONSTRAINT ma_ops_recovery_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.ma_ops_recovery_actions FORCE ROW LEVEL SECURITY;


--
-- Name: ma_ops_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ma_ops_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    environment text DEFAULT 'production'::text NOT NULL,
    check_type text NOT NULL,
    scheduled_for timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status text NOT NULL,
    severity text NOT NULL,
    summary text,
    details_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    recovery_attempted boolean DEFAULT false NOT NULL,
    recovery_result text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ma_ops_runs_environment_check CHECK ((environment = ANY (ARRAY['production'::text, 'staging'::text, 'development'::text]))),
    CONSTRAINT ma_ops_runs_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text]))),
    CONSTRAINT ma_ops_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'passed'::text, 'warning'::text, 'failed'::text, 'skipped'::text])))
);

ALTER TABLE ONLY public.ma_ops_runs FORCE ROW LEVEL SECURITY;


--
-- Name: macro_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.macro_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_key text NOT NULL,
    title text NOT NULL,
    country text,
    event_at timestamp with time zone NOT NULL,
    importance smallint DEFAULT 0 NOT NULL,
    actual_value text,
    consensus_value text,
    previous_value text,
    surprise_score numeric(7,4),
    source_ref text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT macro_events_importance_check CHECK (((importance >= 0) AND (importance <= 100))),
    CONSTRAINT macro_events_raw_payload_check CHECK ((jsonb_typeof(raw_payload) = 'object'::text))
);

ALTER TABLE ONLY public.macro_events FORCE ROW LEVEL SECURITY;


--
-- Name: market_checkpoint_snapshots_snapshot_version_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.market_checkpoint_snapshots ALTER COLUMN snapshot_version ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.market_checkpoint_snapshots_snapshot_version_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: market_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    market text,
    value numeric,
    change_percent numeric,
    status text,
    taiwan_impact text,
    captured_at timestamp with time zone DEFAULT now(),
    change numeric,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: market_data_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_data_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL,
    taipei_date date DEFAULT ((now() AT TIME ZONE 'Asia/Taipei'::text))::date NOT NULL,
    source_row_id uuid,
    symbol text NOT NULL,
    name text,
    market text,
    value numeric,
    change_percent numeric,
    original_status text,
    derived_status text GENERATED ALWAYS AS (
CASE
    WHEN (change_percent IS NULL) THEN 'unknown'::text
    WHEN (change_percent > (0)::numeric) THEN 'up'::text
    WHEN (change_percent < (0)::numeric) THEN 'down'::text
    ELSE 'flat'::text
END) STORED,
    is_proxy boolean DEFAULT false NOT NULL,
    source_updated_at timestamp with time zone,
    raw_payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_indices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_indices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_quote_id uuid,
    provider text NOT NULL,
    symbol text NOT NULL,
    market text NOT NULL,
    trading_date date NOT NULL,
    phase text NOT NULL,
    value numeric(22,8) NOT NULL,
    change_percent numeric(12,6),
    captured_at timestamp with time zone NOT NULL,
    correlation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.market_indices FORCE ROW LEVEL SECURITY;


--
-- Name: market_news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_news (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    title text NOT NULL,
    summary text,
    url text,
    published_at timestamp with time zone,
    language text DEFAULT 'zh-TW'::text,
    region text,
    category text,
    importance_score integer DEFAULT 0,
    related_markets text[],
    related_sectors text[],
    taiwan_impact_summary text,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now(),
    taiwan_impact_score integer,
    taiwan_impact_reason text,
    ai_summary text,
    is_selected boolean DEFAULT false,
    relevance_score integer DEFAULT 0,
    taiwan_relevance_score integer DEFAULT 0,
    impact_score integer DEFAULT 0,
    final_score integer DEFAULT 0,
    news_category text DEFAULT 'Other'::text,
    related_tw_symbols text[],
    related_tw_names text[],
    rejection_reason text,
    normalized_title text,
    duplicate_group_key text
);


--
-- Name: market_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pattern_key text NOT NULL,
    pattern_version text DEFAULT 'CLE_PATTERN_V1'::text NOT NULL,
    dimensions jsonb NOT NULL,
    sample_size integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    inconclusive_count integer DEFAULT 0 NOT NULL,
    follow_through_rate numeric(7,4),
    average_return numeric,
    average_abnormal_return numeric,
    average_confidence numeric(5,2),
    calibration_gap numeric(6,2),
    first_seen_date date,
    last_seen_date date,
    last_evaluated_at timestamp with time zone,
    statistics jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_patterns_dimensions_check CHECK ((jsonb_typeof(dimensions) = 'object'::text)),
    CONSTRAINT market_patterns_failure_count_check CHECK ((failure_count >= 0)),
    CONSTRAINT market_patterns_inconclusive_count_check CHECK ((inconclusive_count >= 0)),
    CONSTRAINT market_patterns_sample_size_check CHECK ((sample_size >= 0)),
    CONSTRAINT market_patterns_statistics_check CHECK ((jsonb_typeof(statistics) = 'object'::text)),
    CONSTRAINT market_patterns_status_check CHECK ((status = ANY (ARRAY['active'::text, 'insufficient_sample'::text, 'archived'::text]))),
    CONSTRAINT market_patterns_success_count_check CHECK ((success_count >= 0))
);

ALTER TABLE ONLY public.market_patterns FORCE ROW LEVEL SECURITY;


--
-- Name: market_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    symbol text NOT NULL,
    source_symbol text NOT NULL,
    name text NOT NULL,
    asset_type text NOT NULL,
    market text NOT NULL,
    trading_date date NOT NULL,
    phase text NOT NULL,
    value numeric(22,8) NOT NULL,
    change_value numeric(22,8),
    change_percent numeric(12,6),
    captured_at timestamp with time zone NOT NULL,
    freshness_status text NOT NULL,
    quality_status text DEFAULT 'verified'::text NOT NULL,
    correlation_id uuid,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_quotes_asset_type_check CHECK ((asset_type = ANY (ARRAY['equity'::text, 'index'::text, 'future'::text, 'fx'::text, 'rate'::text, 'commodity'::text, 'volatility'::text]))),
    CONSTRAINT market_quotes_freshness_status_check CHECK ((freshness_status = ANY (ARRAY['fresh'::text, 'recent'::text, 'stale'::text, 'provider_returned'::text, 'unavailable'::text, 'unknown'::text]))),
    CONSTRAINT market_quotes_phase_check CHECK ((phase = ANY (ARRAY['premarket'::text, 'intraday'::text, 'close'::text, 'manual_backfill'::text]))),
    CONSTRAINT market_quotes_quality_status_check CHECK ((quality_status = ANY (ARRAY['verified'::text, 'degraded'::text, 'rejected'::text]))),
    CONSTRAINT market_quotes_raw_payload_check CHECK ((jsonb_typeof(raw_payload) = 'object'::text))
);

ALTER TABLE ONLY public.market_quotes FORCE ROW LEVEL SECURITY;


--
-- Name: market_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_snapshot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
    fear_greed_index integer,
    vix numeric,
    nasdaq_change numeric,
    sp500_change numeric,
    dowjones_change numeric,
    sox_change numeric,
    taiwan_futures_change numeric,
    gold_price numeric,
    oil_price numeric,
    btc_price numeric,
    dxy_index numeric,
    us10y_yield numeric,
    market_status text,
    risk_level text,
    beginner_summary text,
    action_suggestion text,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: market_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trading_date date NOT NULL,
    session_type text NOT NULL,
    version integer NOT NULL,
    correlation_id uuid,
    market_regime text,
    feature_vector jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    data_as_of timestamp with time zone,
    coverage_score numeric(7,4),
    quality_status text NOT NULL,
    fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT market_snapshots_coverage_score_check CHECK (((coverage_score >= (0)::numeric) AND (coverage_score <= (100)::numeric))),
    CONSTRAINT market_snapshots_feature_vector_check CHECK ((jsonb_typeof(feature_vector) = 'object'::text)),
    CONSTRAINT market_snapshots_quality_status_check CHECK ((quality_status = ANY (ARRAY['complete'::text, 'degraded'::text, 'insufficient'::text, 'provider_failure'::text]))),
    CONSTRAINT market_snapshots_session_type_check CHECK ((session_type = ANY (ARRAY['PREMARKET'::text, 'OPEN'::text, 'MID_MORNING'::text, 'INTRADAY'::text, 'CLOSE'::text]))),
    CONSTRAINT market_snapshots_source_refs_check CHECK ((jsonb_typeof(source_refs) = 'array'::text)),
    CONSTRAINT market_snapshots_version_check CHECK ((version > 0))
);

ALTER TABLE ONLY public.market_snapshots FORCE ROW LEVEL SECURITY;


--
-- Name: market_source_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_source_health (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_name text NOT NULL,
    source_type text NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    last_success_at timestamp with time zone,
    last_error_at timestamp with time zone,
    latest_data_at timestamp with time zone,
    records_count integer DEFAULT 0,
    success_rate numeric DEFAULT 0,
    error_message text,
    symbols jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: membership_access_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_access_config (
    config_key text DEFAULT 'primary'::text NOT NULL,
    signup_mode text DEFAULT 'beta_full'::text NOT NULL,
    trial_days smallint DEFAULT 14 NOT NULL,
    beta_access_ends_at timestamp with time zone,
    billing_mode text DEFAULT 'disabled'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT membership_access_config_billing_mode_check CHECK ((billing_mode = ANY (ARRAY['disabled'::text, 'manual'::text, 'provider'::text]))),
    CONSTRAINT membership_access_config_config_key_check CHECK ((config_key = 'primary'::text)),
    CONSTRAINT membership_access_config_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT membership_access_config_signup_mode_check CHECK ((signup_mode = ANY (ARRAY['closed'::text, 'beta_full'::text, 'trialing'::text]))),
    CONSTRAINT membership_access_config_trial_days_check CHECK (((trial_days >= 1) AND (trial_days <= 90)))
);


--
-- Name: membership_access_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_access_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    from_state text,
    to_state text NOT NULL,
    event_type text NOT NULL,
    source text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT membership_access_events_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);


--
-- Name: model_evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    evaluation_key text NOT NULL,
    evaluation_version text DEFAULT 'CLE_EVALUATION_V1'::text NOT NULL,
    model_version text,
    prompt_version text,
    rule_version text,
    period_start date NOT NULL,
    period_end date NOT NULL,
    window_days integer NOT NULL,
    confidence_bucket text NOT NULL,
    sample_size integer DEFAULT 0 NOT NULL,
    accuracy numeric(7,4),
    precision_score numeric(7,4),
    brier_score numeric(7,4),
    calibration_gap numeric(7,4),
    taiwan_mapping_accuracy numeric(7,4),
    price_in_error_rate numeric(7,4),
    false_positive_rate numeric(7,4),
    data_completeness_rate numeric(7,4),
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_evaluations_metrics_check CHECK ((jsonb_typeof(metrics) = 'object'::text)),
    CONSTRAINT model_evaluations_sample_size_check CHECK ((sample_size >= 0)),
    CONSTRAINT model_evaluations_window_days_check CHECK ((window_days = ANY (ARRAY[30, 90])))
);

ALTER TABLE ONLY public.model_evaluations FORCE ROW LEVEL SECURITY;


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    summary text,
    market_bias text,
    confidence_score integer,
    confidence_label text,
    can_watch text[],
    avoid_today text[],
    fear_greed integer,
    fear_greed_summary text,
    vix numeric,
    vix_summary text,
    nasdaq_change numeric,
    sp500_change numeric,
    sox_change numeric,
    taiex_futures_change numeric,
    dxy numeric,
    us_bond_yield numeric,
    gold_price numeric,
    oil_price numeric,
    btc_price numeric,
    risk_factors_json jsonb DEFAULT '[]'::jsonb,
    watch_sectors_json jsonb DEFAULT '[]'::jsonb,
    focus_stock_json jsonb DEFAULT '[]'::jsonb,
    tomorrow_watch_json jsonb DEFAULT '[]'::jsonb,
    global_events_json jsonb DEFAULT '[]'::jsonb,
    ai_strategy_json jsonb DEFAULT '{}'::jsonb,
    important_news_json jsonb DEFAULT '[]'::jsonb,
    yesterday_summary text,
    today_summary text,
    created_at timestamp with time zone DEFAULT now(),
    today_quote text,
    today_strategy jsonb,
    watch_sectors_detailed jsonb,
    ai_psychology text,
    ai_retail_reminder text,
    ai_confidence_reason text,
    sentiment_score integer,
    sentiment_label text,
    sentiment_reason text,
    risk_reason text,
    updated_at timestamp with time zone DEFAULT now(),
    title text,
    dow_change numeric,
    dollar_index numeric,
    us10y_yield numeric,
    taiwan_futures_change numeric,
    tsm_adr_change numeric,
    market_regime text,
    key_drivers jsonb,
    raw_ai_json jsonb,
    report_mode text,
    data_time_basis text
);


--
-- Name: runtime_dead_letters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_dead_letters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    component text NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id uuid NOT NULL,
    attempt integer NOT NULL,
    max_attempts integer NOT NULL,
    error_code text NOT NULL,
    error_message text,
    request_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_dead_letters_attempt_check CHECK ((attempt > 0)),
    CONSTRAINT runtime_dead_letters_context_check CHECK ((jsonb_typeof(context) = 'object'::text)),
    CONSTRAINT runtime_dead_letters_max_attempts_check CHECK ((max_attempts > 0)),
    CONSTRAINT runtime_dead_letters_request_payload_check CHECK ((jsonb_typeof(request_payload) = 'object'::text)),
    CONSTRAINT runtime_dead_letters_status_check CHECK ((status = ANY (ARRAY['open'::text, 'replayed'::text, 'resolved'::text, 'ignored'::text])))
);

ALTER TABLE ONLY public.runtime_dead_letters FORCE ROW LEVEL SECURITY;


--
-- Name: morning_alpha_reliability_status_v1; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.morning_alpha_reliability_status_v1 WITH (security_invoker='true') AS
 SELECT trading_date,
    current_state,
    state_rank,
    checkpoint_status,
    updated_at,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM public.reports r
              WHERE (r.report_date = t.trading_date))) THEN 'GENERATED'::text
            ELSE 'MISSING'::text
        END AS report_status,
    COALESCE(( SELECT ds.status
           FROM public.decision_snapshots ds
          WHERE ((ds.report_date = t.trading_date) AND (ds.session_type = 'PREMARKET'::text) AND (ds.is_current = true))
         LIMIT 1), 'MISSING'::text) AS decision_snapshot_status,
    COALESCE(( SELECT er.review_status
           FROM (public.editorial_reviews er
             JOIN public.decision_snapshots ds ON ((ds.id = er.decision_snapshot_id)))
          WHERE ((ds.report_date = t.trading_date) AND (ds.session_type = 'PREMARKET'::text) AND (ds.is_current = true))
         LIMIT 1), 'MISSING'::text) AS editorial_status,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM (public.decision_snapshots ds
                 JOIN public.editorial_reviews er ON ((er.decision_snapshot_id = ds.id)))
              WHERE ((ds.report_date = t.trading_date) AND (ds.session_type = 'PREMARKET'::text) AND (ds.is_current = true) AND (ds.status = 'READY'::text) AND (ds.content_score >= (90)::numeric) AND (ds.decision_mode = ANY (ARRAY['recommendations'::text, 'no_trade'::text])) AND (er.review_status = 'APPROVED'::text) AND (er.content_score >= (90)::numeric)))) THEN 'ELIGIBLE'::text
            ELSE 'BLOCKED'::text
        END AS premium_status,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM public.line_delivery_outbox o
              WHERE ((o.report_date = t.trading_date) AND (o.status = ANY (ARRAY['FAILED'::text, 'DEAD_LETTERED'::text]))))) THEN 'FAILED'::text
            WHEN (EXISTS ( SELECT 1
               FROM public.line_delivery_outbox o
              WHERE ((o.report_date = t.trading_date) AND (o.status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text]))))) THEN 'PENDING'::text
            WHEN (EXISTS ( SELECT 1
               FROM public.line_delivery_outbox o
              WHERE ((o.report_date = t.trading_date) AND (o.status = 'SENT'::text)))) THEN 'SENT'::text
            ELSE 'NOT_DUE'::text
        END AS line_status,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM (public.decision_snapshots ds
                 JOIN public.editorial_reviews er ON ((er.decision_snapshot_id = ds.id)))
              WHERE ((ds.report_date = t.trading_date) AND (ds.session_type = 'PREMARKET'::text) AND (ds.is_current = true) AND (ds.status = 'READY'::text) AND (ds.content_score >= (90)::numeric) AND (ds.decision_mode = ANY (ARRAY['recommendations'::text, 'no_trade'::text])) AND (er.review_status = 'APPROVED'::text) AND (er.content_score >= (90)::numeric)))) THEN 'PROJECTION_ELIGIBLE'::text
            ELSE 'BLOCKED'::text
        END AS content_os_status,
    COALESCE(((checkpoint_status -> '1430'::text) ->> 'status'::text), 'NOT_DUE'::text) AS closing_status,
    COALESCE(( SELECT cmr.verification_result
           FROM public.close_market_reviews cmr
          WHERE (cmr.report_date = t.trading_date)
          ORDER BY cmr.updated_at DESC
         LIMIT 1), 'MISSING'::text) AS closing_review_status,
    COALESCE(( SELECT lr.status
           FROM public.learning_runs lr
          WHERE (lr.run_date = t.trading_date)
          ORDER BY lr.created_at DESC
         LIMIT 1), 'NOT_DUE'::text) AS learning_status,
    (COALESCE(( SELECT count(*) AS count
           FROM public.runtime_http_dispatches d
          WHERE ((d.trading_date = t.trading_date) AND (d.dispatch_status = 'DEAD_LETTERED'::text))), (0)::bigint) + COALESCE(( SELECT count(*) AS count
           FROM public.runtime_dead_letters dl
          WHERE ((dl.status = 'open'::text) AND ((dl.context ->> 'trading_date'::text) = (t.trading_date)::text))), (0)::bigint)) AS dead_letters,
    COALESCE(( SELECT count(*) AS count
           FROM public.runtime_http_dispatches d
          WHERE ((d.trading_date = t.trading_date) AND (d.dispatch_status = 'FAILED'::text))), (0)::bigint) AS failed_dispatches,
    ( SELECT max(d.completed_at) AS max
           FROM public.runtime_http_dispatches d
          WHERE ((d.trading_date = t.trading_date) AND (d.dispatch_status = 'SUCCEEDED'::text))) AS last_successful_dispatch,
    ( SELECT min(COALESCE(d.next_retry_at, d.deadline_at, d.lease_expires_at)) AS min
           FROM public.runtime_http_dispatches d
          WHERE ((d.trading_date = t.trading_date) AND (d.dispatch_status = ANY (ARRAY['SCHEDULED'::text, 'DISPATCHED'::text, 'ACKNOWLEDGED'::text, 'FAILED'::text, 'TIMED_OUT'::text])))) AS next_scheduled_at,
    (EXISTS ( SELECT 1
           FROM public.ma_ops_recovery_actions a
          WHERE ((a.status = 'succeeded'::text) AND (((a.created_at AT TIME ZONE 'Asia/Taipei'::text))::date = t.trading_date)))) AS recovery_executed
   FROM public.trading_day_state t;


--
-- Name: news_event_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_event_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    news_key text NOT NULL,
    news_title text,
    news_source text,
    published_at timestamp with time zone,
    event_type text,
    related_sectors text[] DEFAULT '{}'::text[] NOT NULL,
    related_symbols text[] DEFAULT '{}'::text[] NOT NULL,
    related_global_symbols text[] DEFAULT '{}'::text[] NOT NULL,
    impact_direction text,
    impact_strength numeric DEFAULT 0 NOT NULL,
    confidence_score numeric DEFAULT 0 NOT NULL,
    reasoning text,
    tagged_by text DEFAULT 'system'::text NOT NULL,
    tagged_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: news_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.news_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    external_id text,
    title text NOT NULL,
    summary text,
    source_name text NOT NULL,
    source_url text NOT NULL,
    published_at timestamp with time zone NOT NULL,
    event_type text,
    symbols text[] DEFAULT '{}'::text[] NOT NULL,
    sectors text[] DEFAULT '{}'::text[] NOT NULL,
    freshness_status text DEFAULT 'fresh'::text NOT NULL,
    surprise_score numeric(7,4),
    taiwan_relevance_score numeric(7,4),
    fingerprint text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT news_events_raw_payload_check CHECK ((jsonb_typeof(raw_payload) = 'object'::text))
);

ALTER TABLE ONLY public.news_events FORCE ROW LEVEL SECURITY;


--
-- Name: opening_market_radar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opening_market_radar (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    radar_status text DEFAULT 'unknown'::text NOT NULL,
    market_bias text,
    confidence_score integer,
    taiex_change numeric,
    txf_change numeric,
    tsmc_change numeric,
    summary text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    spx_change numeric,
    sox_change numeric,
    vix_change numeric,
    dxy_change numeric,
    us10y_change numeric,
    premarket_report_id uuid,
    premarket_bias text,
    premarket_confidence integer,
    is_premarket_overridden boolean DEFAULT false,
    override_reason text,
    captured_at timestamp with time zone,
    source_kind text,
    data_source text,
    market_data_date date,
    data_status text,
    missing_sources jsonb DEFAULT '[]'::jsonb,
    radar_mode text,
    txf_status text,
    input_source text
);


--
-- Name: pipeline_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    research_session_id uuid,
    trading_date date NOT NULL,
    checkpoint text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    next_retry_at timestamp with time zone,
    provider_status jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    error_code text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decision_snapshot_id uuid,
    deadline_at timestamp with time zone,
    delivery_status text,
    recovery_plan jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    correlation_id uuid,
    engine_version text,
    safe_mode boolean DEFAULT false NOT NULL,
    duration_ms integer,
    cost_usage_id uuid,
    CONSTRAINT pipeline_runs_attempt_check CHECK ((attempt > 0)),
    CONSTRAINT pipeline_runs_checkpoint_check CHECK ((checkpoint = ANY (ARRAY['PREMARKET'::text, 'OPEN'::text, 'MID_MORNING'::text, 'INTRADAY'::text, 'CLOSE'::text]))),
    CONSTRAINT pipeline_runs_delivery_status_check CHECK (((delivery_status IS NULL) OR (delivery_status = ANY (ARRAY['NOT_DUE'::text, 'PENDING'::text, 'SENT'::text, 'INCIDENT_SENT'::text, 'FAILED'::text])))),
    CONSTRAINT pipeline_runs_status_check CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'SUCCEEDED'::text, 'DEGRADED'::text, 'FAILED'::text, 'SKIPPED'::text])))
);


--
-- Name: prediction_accuracy_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_accuracy_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    predicted_bias text,
    confidence integer,
    actual_taiex_change numeric,
    actual_direction text,
    prediction_result text,
    accuracy_score integer,
    reason jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: prediction_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prediction_id uuid NOT NULL,
    horizon text NOT NULL,
    target_session integer NOT NULL,
    target_date date,
    evaluated_at timestamp with time zone,
    price_at_prediction numeric,
    outcome_price numeric,
    close_price numeric,
    max_favorable_excursion numeric,
    max_adverse_excursion numeric,
    return_percent numeric,
    benchmark_return_percent numeric,
    sector_return_percent numeric,
    abnormal_return_percent numeric,
    volume_change_percent numeric,
    thesis_confirmed boolean,
    direction_correct boolean,
    timing_correct boolean,
    outcome_direction text,
    status text DEFAULT 'pending'::text NOT NULL,
    data_quality_status text DEFAULT 'insufficient_data'::text NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    failure_reason text,
    outcome_version text DEFAULT 'CLE_OUTCOME_V1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prediction_outcomes_data_quality_status_check CHECK ((data_quality_status = ANY (ARRAY['complete'::text, 'degraded'::text, 'insufficient_data'::text, 'provider_failure'::text, 'stale_data'::text, 'incomplete_market_session'::text, 'invalid_prediction'::text]))),
    CONSTRAINT prediction_outcomes_horizon_check CHECK ((horizon = ANY (ARRAY['intraday'::text, 'close'::text, '1D'::text, '3D'::text, '5D'::text, '10D'::text, '20D'::text]))),
    CONSTRAINT prediction_outcomes_outcome_direction_check CHECK (((outcome_direction IS NULL) OR (outcome_direction = ANY (ARRAY['up'::text, 'down'::text, 'flat'::text])))),
    CONSTRAINT prediction_outcomes_source_refs_check CHECK ((jsonb_typeof(source_refs) = 'array'::text)),
    CONSTRAINT prediction_outcomes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'inconclusive'::text, 'insufficient_data'::text, 'provider_failure'::text, 'stale_data'::text]))),
    CONSTRAINT prediction_outcomes_target_session_check CHECK ((target_session >= 0))
);

ALTER TABLE ONLY public.prediction_outcomes FORCE ROW LEVEL SECURITY;


--
-- Name: prediction_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prediction_id uuid NOT NULL,
    outcome_id uuid,
    review_date date NOT NULL,
    review_version text DEFAULT 'CLE_REVIEW_V1'::text NOT NULL,
    idempotency_key text NOT NULL,
    review_result text NOT NULL,
    direction_accuracy text NOT NULL,
    timing_accuracy text NOT NULL,
    catalyst_accuracy text NOT NULL,
    surprise_accuracy text NOT NULL,
    taiwan_mapping_accuracy text NOT NULL,
    price_in_accuracy text NOT NULL,
    error_type text,
    root_cause text,
    missed_signal text,
    false_signal text,
    confidence_error numeric(6,2),
    lesson text NOT NULL,
    rule_candidate jsonb DEFAULT '{}'::jsonb NOT NULL,
    review_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    learning_eligible boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prediction_reviews_catalyst_accuracy_check CHECK ((catalyst_accuracy = ANY (ARRAY['correct'::text, 'incorrect'::text, 'unverified'::text]))),
    CONSTRAINT prediction_reviews_direction_accuracy_check CHECK ((direction_accuracy = ANY (ARRAY['correct'::text, 'incorrect'::text, 'inconclusive'::text]))),
    CONSTRAINT prediction_reviews_price_in_accuracy_check CHECK ((price_in_accuracy = ANY (ARRAY['correct'::text, 'incorrect'::text, 'unverified'::text]))),
    CONSTRAINT prediction_reviews_review_evidence_check CHECK ((jsonb_typeof(review_evidence) = 'object'::text)),
    CONSTRAINT prediction_reviews_review_result_check CHECK ((review_result = ANY (ARRAY['correct'::text, 'incorrect'::text, 'partial'::text, 'inconclusive'::text]))),
    CONSTRAINT prediction_reviews_rule_candidate_check CHECK ((jsonb_typeof(rule_candidate) = 'object'::text)),
    CONSTRAINT prediction_reviews_surprise_accuracy_check CHECK ((surprise_accuracy = ANY (ARRAY['correct'::text, 'incorrect'::text, 'unverified'::text]))),
    CONSTRAINT prediction_reviews_taiwan_mapping_accuracy_check CHECK ((taiwan_mapping_accuracy = ANY (ARRAY['correct'::text, 'incorrect'::text, 'not_applicable'::text, 'unverified'::text]))),
    CONSTRAINT prediction_reviews_timing_accuracy_check CHECK ((timing_accuracy = ANY (ARRAY['correct'::text, 'incorrect'::text, 'inconclusive'::text])))
);

ALTER TABLE ONLY public.prediction_reviews FORCE ROW LEVEL SECURITY;


--
-- Name: production_acceptance_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_acceptance_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_date date NOT NULL,
    evaluator_version text NOT NULL,
    idempotency_key text NOT NULL,
    verdict text NOT NULL,
    blocking_checks text[] DEFAULT '{}'::text[] NOT NULL,
    evidence jsonb NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT production_acceptance_results_verdict_check CHECK ((verdict = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'NOT_DUE'::text])))
);

ALTER TABLE ONLY public.production_acceptance_results FORCE ROW LEVEL SECURITY;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'free'::text NOT NULL,
    subscription_status text DEFAULT 'inactive'::text NOT NULL,
    membership_tier text,
    paid_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_membership_tier_check CHECK (((membership_tier IS NULL) OR (membership_tier = ANY (ARRAY['member'::text, 'vip'::text, 'admin'::text])))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['free'::text, 'member'::text, 'vip'::text, 'admin'::text]))),
    CONSTRAINT profiles_subscription_status_check CHECK ((subscription_status = ANY (ARRAY['inactive'::text, 'active'::text, 'expired'::text])))
);


--
-- Name: public_decision_snapshots_v2; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.public_decision_snapshots_v2 WITH (security_invoker='true') AS
 SELECT id,
    report_date,
    session_type,
    version,
    status,
    action,
    market_regime,
    confidence_score,
    coverage_score,
    content_score,
    content_grade,
    preferred_sectors,
    watch_sectors,
    blocked_sectors,
    reasons,
    risk_flags,
    invalidation_rules,
    generated_text,
    valid_from,
    valid_until,
    is_current,
    created_at
   FROM public.decision_snapshots;


--
-- Name: push_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscriber_id uuid,
    channel text NOT NULL,
    report_id uuid,
    status text DEFAULT 'pending'::text,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: research_catalysts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_catalysts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    research_session_id uuid NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    event_at timestamp with time zone NOT NULL,
    source_refs jsonb NOT NULL,
    freshness_score numeric(5,2) NOT NULL,
    surprise_score numeric(5,2) NOT NULL,
    impact_score numeric(5,2) NOT NULL,
    taiwan_relevance_score numeric(5,2) NOT NULL,
    tradability_score numeric(5,2) NOT NULL,
    weighted_score numeric(5,2) GENERATED ALWAYS AS (((((freshness_score + surprise_score) + impact_score) + taiwan_relevance_score) + tradability_score)) STORED,
    status text DEFAULT 'CANDIDATE'::text NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_catalysts_freshness_score_check CHECK (((freshness_score >= (0)::numeric) AND (freshness_score <= (25)::numeric))),
    CONSTRAINT research_catalysts_impact_score_check CHECK (((impact_score >= (0)::numeric) AND (impact_score <= (20)::numeric))),
    CONSTRAINT research_catalysts_source_refs_check CHECK (((jsonb_typeof(source_refs) = 'array'::text) AND (jsonb_array_length(source_refs) > 0))),
    CONSTRAINT research_catalysts_status_check CHECK ((status = ANY (ARRAY['CANDIDATE'::text, 'QUALIFIED'::text, 'REJECTED'::text, 'EXPIRED'::text]))),
    CONSTRAINT research_catalysts_surprise_score_check CHECK (((surprise_score >= (0)::numeric) AND (surprise_score <= (25)::numeric))),
    CONSTRAINT research_catalysts_taiwan_relevance_score_check CHECK (((taiwan_relevance_score >= (0)::numeric) AND (taiwan_relevance_score <= (20)::numeric))),
    CONSTRAINT research_catalysts_tradability_score_check CHECK (((tradability_score >= (0)::numeric) AND (tradability_score <= (10)::numeric)))
);


--
-- Name: research_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_facts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    research_session_id uuid NOT NULL,
    fact_type text NOT NULL,
    subject text NOT NULL,
    value_json jsonb NOT NULL,
    source_refs jsonb NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    freshness_status text NOT NULL,
    confidence_score numeric(5,2) NOT NULL,
    fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_facts_confidence_score_check CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (100)::numeric))),
    CONSTRAINT research_facts_freshness_status_check CHECK ((freshness_status = ANY (ARRAY['FRESH'::text, 'STALE'::text, 'UNAVAILABLE'::text, 'UNVERIFIED'::text]))),
    CONSTRAINT research_facts_source_refs_check CHECK (((jsonb_typeof(source_refs) = 'array'::text) AND (jsonb_array_length(source_refs) > 0)))
);


--
-- Name: research_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trading_date date NOT NULL,
    session_type text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'COLLECTING'::text NOT NULL,
    report_mode text,
    market_status text,
    is_trading_day boolean,
    data_as_of timestamp with time zone,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    engine_version text,
    idempotency_key text NOT NULL,
    input_coverage jsonb DEFAULT '{}'::jsonb NOT NULL,
    missing_sources text[] DEFAULT '{}'::text[] NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_sessions_session_type_check CHECK ((session_type = ANY (ARRAY['PREMARKET'::text, 'OPEN'::text, 'OPENING'::text, 'MID_MORNING'::text, 'INTRADAY'::text, 'CLOSE'::text, 'PRE_CLOSE'::text, 'CLOSING'::text, 'POST_CLOSE'::text]))),
    CONSTRAINT research_sessions_status_check CHECK ((status = ANY (ARRAY['COLLECTING'::text, 'READY'::text, 'DEGRADED'::text, 'REJECTED'::text, 'PUBLISHED'::text, 'VERIFIED'::text, 'FAILED'::text]))),
    CONSTRAINT research_sessions_version_check CHECK ((version > 0))
);


--
-- Name: rule_backtests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rule_backtests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid NOT NULL,
    backtest_version text DEFAULT 'CLE_BACKTEST_V1'::text NOT NULL,
    idempotency_key text NOT NULL,
    training_start date,
    training_end date,
    out_of_sample_start date,
    out_of_sample_end date,
    in_sample_size integer DEFAULT 0 NOT NULL,
    out_of_sample_size integer DEFAULT 0 NOT NULL,
    baseline_accuracy numeric(7,4),
    candidate_accuracy numeric(7,4),
    baseline_calibration_error numeric(7,4),
    candidate_calibration_error numeric(7,4),
    regression_failures jsonb DEFAULT '[]'::jsonb NOT NULL,
    market_regime_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    result_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rule_backtests_in_sample_size_check CHECK ((in_sample_size >= 0)),
    CONSTRAINT rule_backtests_market_regime_results_check CHECK ((jsonb_typeof(market_regime_results) = 'object'::text)),
    CONSTRAINT rule_backtests_out_of_sample_size_check CHECK ((out_of_sample_size >= 0)),
    CONSTRAINT rule_backtests_regression_failures_check CHECK ((jsonb_typeof(regression_failures) = 'array'::text)),
    CONSTRAINT rule_backtests_result_json_check CHECK ((jsonb_typeof(result_json) = 'object'::text)),
    CONSTRAINT rule_backtests_status_check CHECK ((status = ANY (ARRAY['running'::text, 'passed'::text, 'failed'::text, 'insufficient_sample'::text])))
);

ALTER TABLE ONLY public.rule_backtests FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_control_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_control_state (
    environment text NOT NULL,
    safe_mode boolean DEFAULT false NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    activated_at timestamp with time zone,
    expires_at timestamp with time zone,
    activated_by text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_control_state_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);

ALTER TABLE ONLY public.runtime_control_state FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_cost_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_cost_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usage_date date NOT NULL,
    component text NOT NULL,
    provider text NOT NULL,
    model text,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id uuid NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer GENERATED ALWAYS AS ((input_tokens + output_tokens)) STORED,
    estimated_cost_usd numeric(14,8),
    latency_ms integer,
    status text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_cost_usage_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT runtime_cost_usage_latency_ms_check CHECK ((latency_ms >= 0)),
    CONSTRAINT runtime_cost_usage_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT runtime_cost_usage_output_tokens_check CHECK ((output_tokens >= 0)),
    CONSTRAINT runtime_cost_usage_status_check CHECK ((status = ANY (ARRAY['succeeded'::text, 'degraded'::text, 'failed'::text, 'skipped_budget'::text])))
);

ALTER TABLE ONLY public.runtime_cost_usage FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_http_dispatch_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_http_dispatch_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dispatch_id uuid NOT NULL,
    attempt integer NOT NULL,
    request_id bigint,
    http_status integer,
    response_error_code text,
    response_body jsonb,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT runtime_http_dispatch_attempts_attempt_check CHECK ((attempt > 0))
);

ALTER TABLE ONLY public.runtime_http_dispatch_attempts FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_job_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_job_tokens (
    name text NOT NULL,
    token_hash text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_job_tokens_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: runtime_lifecycle_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_lifecycle_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trading_date date NOT NULL,
    state text NOT NULL,
    state_rank smallint NOT NULL,
    checkpoint text NOT NULL,
    status text NOT NULL,
    correlation_id uuid,
    http_dispatch_id uuid,
    input_fingerprint text,
    output_fingerprint text,
    provider_status jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_lifecycle_events_status_check CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'RUNNING'::text, 'SUCCEEDED'::text, 'DEGRADED'::text, 'FAILED'::text, 'SKIPPED'::text])))
);

ALTER TABLE ONLY public.runtime_lifecycle_events FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_quality_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_quality_policies (
    policy_version text NOT NULL,
    active boolean DEFAULT false NOT NULL,
    premium_publish_min smallint NOT NULL,
    member_value_min smallint NOT NULL,
    high_quality_min smallint NOT NULL,
    publish_min smallint NOT NULL,
    auto_repair_min smallint NOT NULL,
    safe_mode_below smallint NOT NULL,
    abstention_min_confidence smallint NOT NULL,
    abstention_min_coverage smallint NOT NULL,
    abstention_min_evidence smallint NOT NULL,
    daily_ai_call_budget integer NOT NULL,
    daily_ai_token_budget integer NOT NULL,
    max_recovery_attempts smallint NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_quality_policies_abstention_min_confidence_check CHECK (((abstention_min_confidence >= 0) AND (abstention_min_confidence <= 100))),
    CONSTRAINT runtime_quality_policies_abstention_min_coverage_check CHECK (((abstention_min_coverage >= 0) AND (abstention_min_coverage <= 100))),
    CONSTRAINT runtime_quality_policies_abstention_min_evidence_check CHECK (((abstention_min_evidence >= 0) AND (abstention_min_evidence <= 100))),
    CONSTRAINT runtime_quality_policies_auto_repair_min_check CHECK (((auto_repair_min >= 0) AND (auto_repair_min <= 100))),
    CONSTRAINT runtime_quality_policies_check CHECK ((premium_publish_min >= publish_min)),
    CONSTRAINT runtime_quality_policies_check1 CHECK ((publish_min >= auto_repair_min)),
    CONSTRAINT runtime_quality_policies_check2 CHECK ((high_quality_min >= publish_min)),
    CONSTRAINT runtime_quality_policies_check3 CHECK ((safe_mode_below <= auto_repair_min)),
    CONSTRAINT runtime_quality_policies_daily_ai_call_budget_check CHECK ((daily_ai_call_budget > 0)),
    CONSTRAINT runtime_quality_policies_daily_ai_token_budget_check CHECK ((daily_ai_token_budget > 0)),
    CONSTRAINT runtime_quality_policies_high_quality_min_check CHECK (((high_quality_min >= 0) AND (high_quality_min <= 100))),
    CONSTRAINT runtime_quality_policies_max_recovery_attempts_check CHECK (((max_recovery_attempts >= 1) AND (max_recovery_attempts <= 20))),
    CONSTRAINT runtime_quality_policies_member_value_min_check CHECK (((member_value_min >= 0) AND (member_value_min <= 100))),
    CONSTRAINT runtime_quality_policies_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT runtime_quality_policies_premium_publish_min_check CHECK (((premium_publish_min >= 0) AND (premium_publish_min <= 100))),
    CONSTRAINT runtime_quality_policies_publish_min_check CHECK (((publish_min >= 0) AND (publish_min <= 100))),
    CONSTRAINT runtime_quality_policies_safe_mode_below_check CHECK (((safe_mode_below >= 0) AND (safe_mode_below <= 100)))
);

ALTER TABLE ONLY public.runtime_quality_policies FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_replay_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_replay_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    replay_run_id uuid NOT NULL,
    trading_date date NOT NULL,
    scenario text NOT NULL,
    result text NOT NULL,
    production_writes integer DEFAULT 0 NOT NULL,
    notifications_sent integer DEFAULT 0 NOT NULL,
    artifact jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_replay_artifacts_notifications_sent_check CHECK ((notifications_sent = 0)),
    CONSTRAINT runtime_replay_artifacts_production_writes_check CHECK ((production_writes = 0)),
    CONSTRAINT runtime_replay_artifacts_result_check CHECK ((result = ANY (ARRAY['PASS'::text, 'FAIL'::text, 'BLOCKED'::text])))
);

ALTER TABLE ONLY public.runtime_replay_artifacts FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_slo_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_slo_definitions (
    slo_key text NOT NULL,
    description text NOT NULL,
    target_percent numeric(7,4) NOT NULL,
    window_days integer NOT NULL,
    threshold_ms integer,
    deadline_taipei time without time zone,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_slo_definitions_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT runtime_slo_definitions_target_percent_check CHECK (((target_percent >= (0)::numeric) AND (target_percent <= (100)::numeric))),
    CONSTRAINT runtime_slo_definitions_window_days_check CHECK ((window_days > 0))
);

ALTER TABLE ONLY public.runtime_slo_definitions FORCE ROW LEVEL SECURITY;


--
-- Name: runtime_slo_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.runtime_slo_measurements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slo_key text NOT NULL,
    measured_at timestamp with time zone NOT NULL,
    report_date date,
    correlation_id uuid,
    success boolean NOT NULL,
    value numeric(22,8),
    latency_ms integer,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT runtime_slo_measurements_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text))
);

ALTER TABLE ONLY public.runtime_slo_measurements FORCE ROW LEVEL SECURITY;


--
-- Name: sector_rotation_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sector_rotation_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    score_date date NOT NULL,
    sector text NOT NULL,
    sub_sector text DEFAULT ''::text NOT NULL,
    rotation_score numeric DEFAULT 0 NOT NULL,
    direction text DEFAULT 'neutral'::text NOT NULL,
    signal_label text DEFAULT '觀察中'::text NOT NULL,
    news_score numeric DEFAULT 0 NOT NULL,
    market_score numeric DEFAULT 0 NOT NULL,
    global_score numeric DEFAULT 0 NOT NULL,
    risk_score numeric DEFAULT 0 NOT NULL,
    confidence_score numeric DEFAULT 0 NOT NULL,
    leading_symbols text[] DEFAULT '{}'::text[] NOT NULL,
    lagging_symbols text[] DEFAULT '{}'::text[] NOT NULL,
    related_news_keys text[] DEFAULT '{}'::text[] NOT NULL,
    summary text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sector_stock_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sector_stock_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    symbol text NOT NULL,
    stock_name text NOT NULL,
    sector text NOT NULL,
    sub_sector text DEFAULT ''::text NOT NULL,
    theme_tags text[] DEFAULT '{}'::text[] NOT NULL,
    importance numeric DEFAULT 3 NOT NULL,
    is_core boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: strategy_registry_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strategy_registry_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    strategy_id uuid NOT NULL,
    action text NOT NULL,
    from_lifecycle text,
    to_lifecycle text,
    actor_id uuid,
    reason text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT strategy_registry_audit_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text))
);

ALTER TABLE ONLY public.strategy_registry_audit FORCE ROW LEVEL SECURITY;


--
-- Name: subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    line_user_id text,
    plan text DEFAULT 'free'::text,
    status text DEFAULT 'active'::text,
    line_push_enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_health_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_health_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    check_date date NOT NULL,
    report_exists boolean DEFAULT false,
    report_date_correct boolean DEFAULT false,
    has_market_bias boolean DEFAULT false,
    has_confidence boolean DEFAULT false,
    has_member_note_v2 boolean DEFAULT false,
    has_opening_radar boolean DEFAULT false,
    has_sector_rotation boolean DEFAULT false,
    has_closing_verification boolean DEFAULT false,
    health_score integer DEFAULT 0,
    issues jsonb DEFAULT '[]'::jsonb,
    raw_snapshot jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_market_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_market_preferences (
    user_id uuid NOT NULL,
    risk_tolerance text DEFAULT 'balanced'::text NOT NULL,
    preferred_sectors text[] DEFAULT '{}'::text[] NOT NULL,
    blocked_sectors text[] DEFAULT '{}'::text[] NOT NULL,
    preferred_horizons text[] DEFAULT '{intraday}'::text[] NOT NULL,
    notification_channels text[] DEFAULT '{line}'::text[] NOT NULL,
    quiet_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
    personalization_enabled boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_market_preferences_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT user_market_preferences_quiet_hours_check CHECK ((jsonb_typeof(quiet_hours) = 'object'::text)),
    CONSTRAINT user_market_preferences_risk_tolerance_check CHECK ((risk_tolerance = ANY (ARRAY['conservative'::text, 'balanced'::text, 'aggressive'::text])))
);

ALTER TABLE ONLY public.user_market_preferences FORCE ROW LEVEL SECURITY;


--
-- Name: v_sector_stock_map_active; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sector_stock_map_active WITH (security_invoker='true') AS
 SELECT symbol,
    stock_name,
    sector,
    sub_sector,
    theme_tags,
    importance,
    is_core,
    notes,
    updated_at
   FROM public.sector_stock_map
  WHERE (is_active = true)
  ORDER BY sector, importance DESC, symbol;


--
-- Name: v_today_sector_rotation; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_today_sector_rotation WITH (security_invoker='true') AS
 SELECT score_date,
    sector,
    sub_sector,
    rotation_score,
    direction,
    signal_label,
    news_score,
    market_score,
    global_score,
    risk_score,
    confidence_score,
    leading_symbols,
    lagging_symbols,
    summary,
    generated_at
   FROM public.sector_rotation_scores
  WHERE (score_date = ((now() AT TIME ZONE 'Asia/Taipei'::text))::date)
  ORDER BY rotation_score DESC, confidence_score DESC;


--
-- Name: voice_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_date date NOT NULL,
    report_id uuid,
    script_1min text,
    script_3min text,
    status text DEFAULT 'script_ready'::text,
    generated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: billing_webhook_events billing_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: billing_webhook_events billing_webhook_events_provider_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_provider_provider_event_id_key UNIQUE (provider, provider_event_id);


--
-- Name: catalyst_tw_mappings catalyst_tw_mappings_catalyst_id_stock_symbol_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalyst_tw_mappings
    ADD CONSTRAINT catalyst_tw_mappings_catalyst_id_stock_symbol_key UNIQUE (catalyst_id, stock_symbol);


--
-- Name: catalyst_tw_mappings catalyst_tw_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalyst_tw_mappings
    ADD CONSTRAINT catalyst_tw_mappings_pkey PRIMARY KEY (id);


--
-- Name: close_market_reviews close_market_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_market_reviews
    ADD CONSTRAINT close_market_reviews_pkey PRIMARY KEY (id);


--
-- Name: close_market_reviews close_market_reviews_report_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.close_market_reviews
    ADD CONSTRAINT close_market_reviews_report_date_key UNIQUE (report_date);


--
-- Name: company_events company_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_events
    ADD CONSTRAINT company_events_pkey PRIMARY KEY (id);


--
-- Name: company_events company_events_provider_symbol_event_type_event_at_title_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_events
    ADD CONSTRAINT company_events_provider_symbol_event_type_event_at_title_key UNIQUE (provider, symbol, event_type, event_at, title);


--
-- Name: content_engagement_events content_engagement_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_engagement_events
    ADD CONSTRAINT content_engagement_events_pkey PRIMARY KEY (id);


--
-- Name: content_feedback content_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_feedback
    ADD CONSTRAINT content_feedback_pkey PRIMARY KEY (id);


--
-- Name: content_os_sync_incidents content_os_sync_incidents_incident_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_os_sync_incidents
    ADD CONSTRAINT content_os_sync_incidents_incident_key_key UNIQUE (incident_key);


--
-- Name: content_os_sync_incidents content_os_sync_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_os_sync_incidents
    ADD CONSTRAINT content_os_sync_incidents_pkey PRIMARY KEY (id);


--
-- Name: daily_reports daily_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_pkey PRIMARY KEY (id);


--
-- Name: daily_reports daily_reports_report_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_report_date_key UNIQUE (report_date);


--
-- Name: data_provider_health data_provider_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_provider_health
    ADD CONSTRAINT data_provider_health_pkey PRIMARY KEY (id);


--
-- Name: decision_snapshot_market_evidence decision_snapshot_market_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_snapshot_market_evidence
    ADD CONSTRAINT decision_snapshot_market_evidence_pkey PRIMARY KEY (decision_snapshot_id, market_checkpoint_snapshot_id);


--
-- Name: decision_snapshots decision_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_snapshots
    ADD CONSTRAINT decision_snapshots_pkey PRIMARY KEY (id);


--
-- Name: early_access_signups early_access_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.early_access_signups
    ADD CONSTRAINT early_access_signups_pkey PRIMARY KEY (id);


--
-- Name: earnings_events earnings_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_events
    ADD CONSTRAINT earnings_events_pkey PRIMARY KEY (id);


--
-- Name: earnings_events earnings_events_provider_symbol_fiscal_period_announced_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.earnings_events
    ADD CONSTRAINT earnings_events_provider_symbol_fiscal_period_announced_at_key UNIQUE (provider, symbol, fiscal_period, announced_at);


--
-- Name: editorial_reviews editorial_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editorial_reviews
    ADD CONSTRAINT editorial_reviews_pkey PRIMARY KEY (id);


--
-- Name: futures_snapshots futures_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.futures_snapshots
    ADD CONSTRAINT futures_snapshots_pkey PRIMARY KEY (id);


--
-- Name: futures_snapshots futures_snapshots_provider_symbol_captured_at_phase_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.futures_snapshots
    ADD CONSTRAINT futures_snapshots_provider_symbol_captured_at_phase_key UNIQUE (provider, symbol, captured_at, phase);


--
-- Name: growth_events_v2 growth_events_v2_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_events_v2
    ADD CONSTRAINT growth_events_v2_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: growth_events_v2 growth_events_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_events_v2
    ADD CONSTRAINT growth_events_v2_pkey PRIMARY KEY (id);


--
-- Name: historical_replay_results historical_replay_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_results
    ADD CONSTRAINT historical_replay_results_pkey PRIMARY KEY (id);


--
-- Name: historical_replay_results historical_replay_results_replay_run_id_prediction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_results
    ADD CONSTRAINT historical_replay_results_replay_run_id_prediction_id_key UNIQUE (replay_run_id, prediction_id);


--
-- Name: historical_replay_runs historical_replay_runs_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_runs
    ADD CONSTRAINT historical_replay_runs_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: historical_replay_runs historical_replay_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_runs
    ADD CONSTRAINT historical_replay_runs_pkey PRIMARY KEY (id);


--
-- Name: historical_similarity_results historical_similarity_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_similarity_results
    ADD CONSTRAINT historical_similarity_results_pkey PRIMARY KEY (id);


--
-- Name: historical_similarity_results historical_similarity_results_target_snapshot_id_similar_sn_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_similarity_results
    ADD CONSTRAINT historical_similarity_results_target_snapshot_id_similar_sn_key UNIQUE (target_snapshot_id, similar_snapshot_id, algorithm_version);


--
-- Name: institutional_flows institutional_flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutional_flows
    ADD CONSTRAINT institutional_flows_pkey PRIMARY KEY (id);


--
-- Name: institutional_flows institutional_flows_provider_trading_date_institution_type__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutional_flows
    ADD CONSTRAINT institutional_flows_provider_trading_date_institution_type__key UNIQUE (provider, trading_date, institution_type, symbol, captured_at);


--
-- Name: intraday_checks intraday_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intraday_checks
    ADD CONSTRAINT intraday_checks_pkey PRIMARY KEY (id);


--
-- Name: learning_audit_logs learning_audit_logs_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_audit_logs
    ADD CONSTRAINT learning_audit_logs_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: learning_audit_logs learning_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_audit_logs
    ADD CONSTRAINT learning_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: learning_cases learning_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_cases
    ADD CONSTRAINT learning_cases_pkey PRIMARY KEY (id);


--
-- Name: learning_cases learning_cases_prediction_review_id_case_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_cases
    ADD CONSTRAINT learning_cases_prediction_review_id_case_type_key UNIQUE (prediction_review_id, case_type);


--
-- Name: learning_metric_corrections learning_metric_corrections_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_metric_corrections
    ADD CONSTRAINT learning_metric_corrections_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: learning_metric_corrections learning_metric_corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_metric_corrections
    ADD CONSTRAINT learning_metric_corrections_pkey PRIMARY KEY (id);


--
-- Name: learning_predictions learning_predictions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_predictions
    ADD CONSTRAINT learning_predictions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: learning_predictions learning_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_predictions
    ADD CONSTRAINT learning_predictions_pkey PRIMARY KEY (id);


--
-- Name: learning_rules learning_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_pkey PRIMARY KEY (id);


--
-- Name: learning_rules learning_rules_rule_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_rule_key_key UNIQUE (rule_key);


--
-- Name: learning_runs learning_runs_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_runs
    ADD CONSTRAINT learning_runs_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: learning_runs learning_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_runs
    ADD CONSTRAINT learning_runs_pkey PRIMARY KEY (id);


--
-- Name: line_delivery_outbox line_delivery_outbox_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_delivery_outbox
    ADD CONSTRAINT line_delivery_outbox_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: line_delivery_outbox line_delivery_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_delivery_outbox
    ADD CONSTRAINT line_delivery_outbox_pkey PRIMARY KEY (id);


--
-- Name: line_delivery_outbox line_delivery_outbox_report_date_push_type_line_subscriber__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_delivery_outbox
    ADD CONSTRAINT line_delivery_outbox_report_date_push_type_line_subscriber__key UNIQUE (report_date, push_type, line_subscriber_id);


--
-- Name: line_push_logs line_push_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_push_logs
    ADD CONSTRAINT line_push_logs_pkey PRIMARY KEY (id);


--
-- Name: line_subscribers line_subscribers_line_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_subscribers
    ADD CONSTRAINT line_subscribers_line_user_id_key UNIQUE (line_user_id);


--
-- Name: line_subscribers line_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_subscribers
    ADD CONSTRAINT line_subscribers_pkey PRIMARY KEY (id);


--
-- Name: ma_chaos_clock_control ma_chaos_clock_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_chaos_clock_control
    ADD CONSTRAINT ma_chaos_clock_control_pkey PRIMARY KEY (singleton);


--
-- Name: ma_chaos_line_sink_events ma_chaos_line_sink_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_chaos_line_sink_events
    ADD CONSTRAINT ma_chaos_line_sink_events_pkey PRIMARY KEY (id);


--
-- Name: ma_ops_checks ma_ops_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_checks
    ADD CONSTRAINT ma_ops_checks_pkey PRIMARY KEY (id);


--
-- Name: ma_ops_checks ma_ops_checks_run_id_component_check_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_checks
    ADD CONSTRAINT ma_ops_checks_run_id_component_check_name_key UNIQUE (run_id, component, check_name);


--
-- Name: ma_ops_component_registry ma_ops_component_registry_environment_component_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_component_registry
    ADD CONSTRAINT ma_ops_component_registry_environment_component_key_key UNIQUE (environment, component_key);


--
-- Name: ma_ops_component_registry ma_ops_component_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_component_registry
    ADD CONSTRAINT ma_ops_component_registry_pkey PRIMARY KEY (id);


--
-- Name: ma_ops_recovery_actions ma_ops_recovery_actions_environment_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_recovery_actions
    ADD CONSTRAINT ma_ops_recovery_actions_environment_idempotency_key_key UNIQUE (environment, idempotency_key);


--
-- Name: ma_ops_recovery_actions ma_ops_recovery_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_recovery_actions
    ADD CONSTRAINT ma_ops_recovery_actions_pkey PRIMARY KEY (id);


--
-- Name: ma_ops_runs ma_ops_runs_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_runs
    ADD CONSTRAINT ma_ops_runs_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: ma_ops_runs ma_ops_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_runs
    ADD CONSTRAINT ma_ops_runs_pkey PRIMARY KEY (id);


--
-- Name: macro_events macro_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.macro_events
    ADD CONSTRAINT macro_events_pkey PRIMARY KEY (id);


--
-- Name: macro_events macro_events_provider_event_key_event_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.macro_events
    ADD CONSTRAINT macro_events_provider_event_key_event_at_key UNIQUE (provider, event_key, event_at);


--
-- Name: market_checkpoint_batches market_checkpoint_batches_business_checkpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_checkpoint_batches
    ADD CONSTRAINT market_checkpoint_batches_business_checkpoint_key UNIQUE (business_date, checkpoint);


--
-- Name: market_checkpoint_batches market_checkpoint_batches_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_checkpoint_batches
    ADD CONSTRAINT market_checkpoint_batches_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: market_checkpoint_batches market_checkpoint_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_checkpoint_batches
    ADD CONSTRAINT market_checkpoint_batches_pkey PRIMARY KEY (batch_id);


--
-- Name: market_checkpoint_snapshots market_checkpoint_snapshots_atomic_identity_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.market_checkpoint_snapshots
    ADD CONSTRAINT market_checkpoint_snapshots_atomic_identity_check CHECK ((((batch_id IS NULL) AND (provider_key IS NULL) AND (idempotency_key IS NULL)) OR ((batch_id IS NOT NULL) AND (provider_key IS NOT NULL) AND (idempotency_key IS NOT NULL) AND (provider_key = ANY (ARRAY['SPX'::text, 'IXIC'::text, 'SOX'::text, 'NVDA'::text, 'TSM'::text, 'VIX'::text, 'DXY'::text, 'US10Y'::text, 'TAIEX'::text, '2330'::text, 'TXF'::text]))))) NOT VALID;


--
-- Name: market_checkpoint_snapshots market_checkpoint_snapshots_correlation_id_checkpoint_symbo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_checkpoint_snapshots
    ADD CONSTRAINT market_checkpoint_snapshots_correlation_id_checkpoint_symbo_key UNIQUE (correlation_id, checkpoint, symbol);


--
-- Name: market_checkpoint_snapshots market_checkpoint_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_checkpoint_snapshots
    ADD CONSTRAINT market_checkpoint_snapshots_pkey PRIMARY KEY (id);


--
-- Name: market_checkpoint_snapshots market_checkpoint_snapshots_snapshot_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_checkpoint_snapshots
    ADD CONSTRAINT market_checkpoint_snapshots_snapshot_version_key UNIQUE (snapshot_version);


--
-- Name: market_data_history market_data_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data_history
    ADD CONSTRAINT market_data_history_pkey PRIMARY KEY (id);


--
-- Name: market_data market_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data
    ADD CONSTRAINT market_data_pkey PRIMARY KEY (id);


--
-- Name: market_data_snapshots market_data_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data_snapshots
    ADD CONSTRAINT market_data_snapshots_pkey PRIMARY KEY (id);


--
-- Name: market_data market_data_symbol_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_data
    ADD CONSTRAINT market_data_symbol_unique UNIQUE (symbol);


--
-- Name: market_indices market_indices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_indices
    ADD CONSTRAINT market_indices_pkey PRIMARY KEY (id);


--
-- Name: market_indices market_indices_provider_symbol_captured_at_phase_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_indices
    ADD CONSTRAINT market_indices_provider_symbol_captured_at_phase_key UNIQUE (provider, symbol, captured_at, phase);


--
-- Name: market_news market_news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_news
    ADD CONSTRAINT market_news_pkey PRIMARY KEY (id);


--
-- Name: market_news market_news_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_news
    ADD CONSTRAINT market_news_url_key UNIQUE (url);


--
-- Name: market_patterns market_patterns_pattern_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_patterns
    ADD CONSTRAINT market_patterns_pattern_key_key UNIQUE (pattern_key);


--
-- Name: market_patterns market_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_patterns
    ADD CONSTRAINT market_patterns_pkey PRIMARY KEY (id);


--
-- Name: market_quotes market_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_quotes
    ADD CONSTRAINT market_quotes_pkey PRIMARY KEY (id);


--
-- Name: market_quotes market_quotes_provider_symbol_captured_at_phase_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_quotes
    ADD CONSTRAINT market_quotes_provider_symbol_captured_at_phase_key UNIQUE (provider, symbol, captured_at, phase);


--
-- Name: market_snapshot market_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_snapshot
    ADD CONSTRAINT market_snapshot_pkey PRIMARY KEY (id);


--
-- Name: market_snapshots market_snapshots_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_snapshots
    ADD CONSTRAINT market_snapshots_fingerprint_key UNIQUE (fingerprint);


--
-- Name: market_snapshots market_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_snapshots
    ADD CONSTRAINT market_snapshots_pkey PRIMARY KEY (id);


--
-- Name: market_snapshots market_snapshots_trading_date_session_type_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_snapshots
    ADD CONSTRAINT market_snapshots_trading_date_session_type_version_key UNIQUE (trading_date, session_type, version);


--
-- Name: market_source_health market_source_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_source_health
    ADD CONSTRAINT market_source_health_pkey PRIMARY KEY (id);


--
-- Name: market_source_health market_source_health_source_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_source_health
    ADD CONSTRAINT market_source_health_source_name_unique UNIQUE (source_name);


--
-- Name: member_content_revisions member_content_revisions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_content_revisions
    ADD CONSTRAINT member_content_revisions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: member_content_revisions member_content_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_content_revisions
    ADD CONSTRAINT member_content_revisions_pkey PRIMARY KEY (id);


--
-- Name: member_content_revisions member_content_revisions_report_date_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_content_revisions
    ADD CONSTRAINT member_content_revisions_report_date_revision_key UNIQUE (report_date, revision);


--
-- Name: member_entitlements member_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_entitlements
    ADD CONSTRAINT member_entitlements_pkey PRIMARY KEY (user_id);


--
-- Name: membership_access_config membership_access_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_access_config
    ADD CONSTRAINT membership_access_config_pkey PRIMARY KEY (config_key);


--
-- Name: membership_access_events membership_access_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_access_events
    ADD CONSTRAINT membership_access_events_pkey PRIMARY KEY (id);


--
-- Name: model_evaluations model_evaluations_evaluation_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_evaluations
    ADD CONSTRAINT model_evaluations_evaluation_key_key UNIQUE (evaluation_key);


--
-- Name: model_evaluations model_evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_evaluations
    ADD CONSTRAINT model_evaluations_pkey PRIMARY KEY (id);


--
-- Name: news_event_tags news_event_tags_news_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_event_tags
    ADD CONSTRAINT news_event_tags_news_key_unique UNIQUE (news_key);


--
-- Name: news_event_tags news_event_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_event_tags
    ADD CONSTRAINT news_event_tags_pkey PRIMARY KEY (id);


--
-- Name: news_events news_events_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_events
    ADD CONSTRAINT news_events_fingerprint_key UNIQUE (fingerprint);


--
-- Name: news_events news_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.news_events
    ADD CONSTRAINT news_events_pkey PRIMARY KEY (id);


--
-- Name: opening_market_radar opening_market_radar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_market_radar
    ADD CONSTRAINT opening_market_radar_pkey PRIMARY KEY (id);


--
-- Name: opening_market_radar opening_market_radar_report_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opening_market_radar
    ADD CONSTRAINT opening_market_radar_report_date_key UNIQUE (report_date);


--
-- Name: pipeline_runs pipeline_runs_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: pipeline_runs pipeline_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);


--
-- Name: prediction_accuracy_logs prediction_accuracy_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_accuracy_logs
    ADD CONSTRAINT prediction_accuracy_logs_pkey PRIMARY KEY (id);


--
-- Name: prediction_outcomes prediction_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_outcomes
    ADD CONSTRAINT prediction_outcomes_pkey PRIMARY KEY (id);


--
-- Name: prediction_outcomes prediction_outcomes_prediction_id_horizon_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_outcomes
    ADD CONSTRAINT prediction_outcomes_prediction_id_horizon_key UNIQUE (prediction_id, horizon);


--
-- Name: prediction_reviews prediction_reviews_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_reviews
    ADD CONSTRAINT prediction_reviews_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: prediction_reviews prediction_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_reviews
    ADD CONSTRAINT prediction_reviews_pkey PRIMARY KEY (id);


--
-- Name: production_acceptance_results production_acceptance_results_business_date_evaluator_versi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_acceptance_results
    ADD CONSTRAINT production_acceptance_results_business_date_evaluator_versi_key UNIQUE (business_date, evaluator_version);


--
-- Name: production_acceptance_results production_acceptance_results_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_acceptance_results
    ADD CONSTRAINT production_acceptance_results_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: production_acceptance_results production_acceptance_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_acceptance_results
    ADD CONSTRAINT production_acceptance_results_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_logs push_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_logs
    ADD CONSTRAINT push_logs_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: research_catalysts research_catalysts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_catalysts
    ADD CONSTRAINT research_catalysts_pkey PRIMARY KEY (id);


--
-- Name: research_facts research_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_facts
    ADD CONSTRAINT research_facts_pkey PRIMARY KEY (id);


--
-- Name: research_facts research_facts_research_session_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_facts
    ADD CONSTRAINT research_facts_research_session_id_fingerprint_key UNIQUE (research_session_id, fingerprint);


--
-- Name: research_sessions research_sessions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_sessions
    ADD CONSTRAINT research_sessions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: research_sessions research_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_sessions
    ADD CONSTRAINT research_sessions_pkey PRIMARY KEY (id);


--
-- Name: research_sessions research_sessions_trading_date_session_type_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_sessions
    ADD CONSTRAINT research_sessions_trading_date_session_type_version_key UNIQUE (trading_date, session_type, version);


--
-- Name: rule_backtests rule_backtests_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_backtests
    ADD CONSTRAINT rule_backtests_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: rule_backtests rule_backtests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_backtests
    ADD CONSTRAINT rule_backtests_pkey PRIMARY KEY (id);


--
-- Name: runtime_control_state runtime_control_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_control_state
    ADD CONSTRAINT runtime_control_state_pkey PRIMARY KEY (environment);


--
-- Name: runtime_cost_usage runtime_cost_usage_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_cost_usage
    ADD CONSTRAINT runtime_cost_usage_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: runtime_cost_usage runtime_cost_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_cost_usage
    ADD CONSTRAINT runtime_cost_usage_pkey PRIMARY KEY (id);


--
-- Name: runtime_dead_letters runtime_dead_letters_component_idempotency_key_attempt_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_dead_letters
    ADD CONSTRAINT runtime_dead_letters_component_idempotency_key_attempt_key UNIQUE (component, idempotency_key, attempt);


--
-- Name: runtime_dead_letters runtime_dead_letters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_dead_letters
    ADD CONSTRAINT runtime_dead_letters_pkey PRIMARY KEY (id);


--
-- Name: runtime_http_dispatch_attempts runtime_http_dispatch_attempts_dispatch_id_attempt_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_http_dispatch_attempts
    ADD CONSTRAINT runtime_http_dispatch_attempts_dispatch_id_attempt_key UNIQUE (dispatch_id, attempt);


--
-- Name: runtime_http_dispatch_attempts runtime_http_dispatch_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_http_dispatch_attempts
    ADD CONSTRAINT runtime_http_dispatch_attempts_pkey PRIMARY KEY (id);


--
-- Name: runtime_http_dispatches runtime_http_dispatches_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_http_dispatches
    ADD CONSTRAINT runtime_http_dispatches_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: runtime_http_dispatches runtime_http_dispatches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_http_dispatches
    ADD CONSTRAINT runtime_http_dispatches_pkey PRIMARY KEY (id);


--
-- Name: runtime_job_tokens runtime_job_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_job_tokens
    ADD CONSTRAINT runtime_job_tokens_pkey PRIMARY KEY (name);


--
-- Name: runtime_lifecycle_events runtime_lifecycle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_lifecycle_events
    ADD CONSTRAINT runtime_lifecycle_events_pkey PRIMARY KEY (id);


--
-- Name: runtime_lifecycle_events runtime_lifecycle_events_trading_date_checkpoint_correlatio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_lifecycle_events
    ADD CONSTRAINT runtime_lifecycle_events_trading_date_checkpoint_correlatio_key UNIQUE (trading_date, checkpoint, correlation_id, status);


--
-- Name: runtime_quality_policies runtime_quality_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_quality_policies
    ADD CONSTRAINT runtime_quality_policies_pkey PRIMARY KEY (policy_version);


--
-- Name: runtime_replay_artifacts runtime_replay_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_replay_artifacts
    ADD CONSTRAINT runtime_replay_artifacts_pkey PRIMARY KEY (id);


--
-- Name: runtime_replay_artifacts runtime_replay_artifacts_replay_run_id_trading_date_scenari_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_replay_artifacts
    ADD CONSTRAINT runtime_replay_artifacts_replay_run_id_trading_date_scenari_key UNIQUE (replay_run_id, trading_date, scenario);


--
-- Name: runtime_slo_definitions runtime_slo_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_slo_definitions
    ADD CONSTRAINT runtime_slo_definitions_pkey PRIMARY KEY (slo_key);


--
-- Name: runtime_slo_measurements runtime_slo_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_slo_measurements
    ADD CONSTRAINT runtime_slo_measurements_pkey PRIMARY KEY (id);


--
-- Name: sector_rotation_scores sector_rotation_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sector_rotation_scores
    ADD CONSTRAINT sector_rotation_scores_pkey PRIMARY KEY (id);


--
-- Name: sector_rotation_scores sector_rotation_scores_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sector_rotation_scores
    ADD CONSTRAINT sector_rotation_scores_unique UNIQUE (score_date, sector, sub_sector);


--
-- Name: sector_stock_map sector_stock_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sector_stock_map
    ADD CONSTRAINT sector_stock_map_pkey PRIMARY KEY (id);


--
-- Name: sector_stock_map sector_stock_map_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sector_stock_map
    ADD CONSTRAINT sector_stock_map_unique UNIQUE (symbol, sector, sub_sector);


--
-- Name: semantic_coherence_reviews semantic_coherence_reviews_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_coherence_reviews
    ADD CONSTRAINT semantic_coherence_reviews_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: semantic_coherence_reviews semantic_coherence_reviews_member_content_revision_id_gate__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_coherence_reviews
    ADD CONSTRAINT semantic_coherence_reviews_member_content_revision_id_gate__key UNIQUE (member_content_revision_id, gate_version);


--
-- Name: semantic_coherence_reviews semantic_coherence_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_coherence_reviews
    ADD CONSTRAINT semantic_coherence_reviews_pkey PRIMARY KEY (id);


--
-- Name: strategy_registry_audit strategy_registry_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry_audit
    ADD CONSTRAINT strategy_registry_audit_pkey PRIMARY KEY (id);


--
-- Name: strategy_registry strategy_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry
    ADD CONSTRAINT strategy_registry_pkey PRIMARY KEY (id);


--
-- Name: strategy_registry strategy_registry_strategy_key_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry
    ADD CONSTRAINT strategy_registry_strategy_key_version_key UNIQUE (strategy_key, version);


--
-- Name: subscribers subscribers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_email_key UNIQUE (email);


--
-- Name: subscribers subscribers_line_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_line_user_id_key UNIQUE (line_user_id);


--
-- Name: subscribers subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscribers
    ADD CONSTRAINT subscribers_pkey PRIMARY KEY (id);


--
-- Name: system_health_logs system_health_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_health_logs
    ADD CONSTRAINT system_health_logs_pkey PRIMARY KEY (id);


--
-- Name: trading_day_state trading_day_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trading_day_state
    ADD CONSTRAINT trading_day_state_pkey PRIMARY KEY (trading_date);


--
-- Name: user_market_preferences user_market_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_market_preferences
    ADD CONSTRAINT user_market_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: voice_reports voice_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_reports
    ADD CONSTRAINT voice_reports_pkey PRIMARY KEY (id);


--
-- Name: voice_reports voice_reports_report_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_reports
    ADD CONSTRAINT voice_reports_report_date_key UNIQUE (report_date);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: billing_webhook_events_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_webhook_events_user_time_idx ON public.billing_webhook_events USING btree (user_id, received_at DESC);


--
-- Name: catalyst_tw_mappings_stock_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catalyst_tw_mappings_stock_idx ON public.catalyst_tw_mappings USING btree (stock_symbol, actionable, confidence_score DESC);


--
-- Name: company_events_symbol_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_events_symbol_event_idx ON public.company_events USING btree (symbol, event_at DESC);


--
-- Name: content_feedback_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_feedback_report_idx ON public.content_feedback USING btree (report_date DESC, created_at DESC);


--
-- Name: content_feedback_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_feedback_snapshot_idx ON public.content_feedback USING btree (decision_snapshot_id);


--
-- Name: content_feedback_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_feedback_user_idx ON public.content_feedback USING btree (user_id, created_at DESC);


--
-- Name: content_os_sync_incidents_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_os_sync_incidents_open_idx ON public.content_os_sync_incidents USING btree (business_date, status, last_seen_at DESC);


--
-- Name: data_provider_health_service_checkpoint_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX data_provider_health_service_checkpoint_uidx ON public.data_provider_health USING btree (provider, service_date, phase, checkpoint);


--
-- Name: data_provider_health_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_provider_health_status_idx ON public.data_provider_health USING btree (status, checked_at DESC);


--
-- Name: decision_snapshot_market_evidence_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_snapshot_market_evidence_snapshot_idx ON public.decision_snapshot_market_evidence USING btree (market_checkpoint_snapshot_id);


--
-- Name: decision_snapshots_content_fingerprint_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX decision_snapshots_content_fingerprint_uidx ON public.decision_snapshots USING btree (report_date, session_type, snapshot_fingerprint) WHERE (snapshot_fingerprint IS NOT NULL);


--
-- Name: decision_snapshots_current_session_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX decision_snapshots_current_session_uidx ON public.decision_snapshots USING btree (report_date, session_type) WHERE is_current;


--
-- Name: decision_snapshots_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX decision_snapshots_idempotency_uidx ON public.decision_snapshots USING btree (idempotency_key);


--
-- Name: decision_snapshots_report_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_snapshots_report_created_idx ON public.decision_snapshots USING btree (report_date DESC, created_at DESC);


--
-- Name: decision_snapshots_report_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_snapshots_report_id_idx ON public.decision_snapshots USING btree (report_id);


--
-- Name: decision_snapshots_research_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_snapshots_research_session_idx ON public.decision_snapshots USING btree (research_session_id);


--
-- Name: decision_snapshots_status_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_snapshots_status_report_idx ON public.decision_snapshots USING btree (status, report_date DESC);


--
-- Name: decision_snapshots_supersedes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX decision_snapshots_supersedes_idx ON public.decision_snapshots USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);


--
-- Name: earnings_events_symbol_announced_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX earnings_events_symbol_announced_idx ON public.earnings_events USING btree (symbol, announced_at DESC);


--
-- Name: editorial_reviews_decision_snapshot_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX editorial_reviews_decision_snapshot_id_idx ON public.editorial_reviews USING btree (decision_snapshot_id);


--
-- Name: editorial_reviews_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX editorial_reviews_session_idx ON public.editorial_reviews USING btree (research_session_id, reviewed_at DESC);


--
-- Name: editorial_reviews_snapshot_gate_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX editorial_reviews_snapshot_gate_uidx ON public.editorial_reviews USING btree (decision_snapshot_id) WHERE (decision_snapshot_id IS NOT NULL);


--
-- Name: editorial_reviews_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX editorial_reviews_status_idx ON public.editorial_reviews USING btree (review_status, reviewed_at DESC);


--
-- Name: futures_snapshots_market_quote_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX futures_snapshots_market_quote_id_idx ON public.futures_snapshots USING btree (market_quote_id);


--
-- Name: futures_snapshots_symbol_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX futures_snapshots_symbol_latest_idx ON public.futures_snapshots USING btree (symbol, captured_at DESC);


--
-- Name: growth_events_v2_actor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_events_v2_actor_id_idx ON public.growth_events_v2 USING btree (actor_id);


--
-- Name: growth_events_v2_event_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_events_v2_event_time_idx ON public.growth_events_v2 USING btree (event_name, occurred_at DESC);


--
-- Name: growth_events_v2_funnel_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX growth_events_v2_funnel_time_idx ON public.growth_events_v2 USING btree (funnel_stage, occurred_at DESC) WHERE (funnel_stage IS NOT NULL);


--
-- Name: historical_replay_results_decision_snapshot_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX historical_replay_results_decision_snapshot_id_idx ON public.historical_replay_results USING btree (decision_snapshot_id);


--
-- Name: historical_replay_results_prediction_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX historical_replay_results_prediction_id_idx ON public.historical_replay_results USING btree (prediction_id);


--
-- Name: historical_replay_results_run_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX historical_replay_results_run_date_idx ON public.historical_replay_results USING btree (replay_run_id, report_date);


--
-- Name: historical_replay_runs_strategy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX historical_replay_runs_strategy_idx ON public.historical_replay_runs USING btree (strategy_id, created_at DESC);


--
-- Name: historical_similarity_results_similar_snapshot_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX historical_similarity_results_similar_snapshot_id_idx ON public.historical_similarity_results USING btree (similar_snapshot_id);


--
-- Name: historical_similarity_target_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX historical_similarity_target_score_idx ON public.historical_similarity_results USING btree (target_snapshot_id, similarity_score DESC);


--
-- Name: idx_close_market_reviews_report_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_close_market_reviews_report_date ON public.close_market_reviews USING btree (report_date DESC);


--
-- Name: idx_intraday_checks_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intraday_checks_created ON public.intraday_checks USING btree (created_at DESC);


--
-- Name: idx_intraday_checks_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_intraday_checks_date ON public.intraday_checks USING btree (check_date);


--
-- Name: idx_line_push_logs_report_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_push_logs_report_date ON public.line_push_logs USING btree (report_date);


--
-- Name: idx_line_subscribers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_subscribers_active ON public.line_subscribers USING btree (is_active);


--
-- Name: idx_line_subscribers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_subscribers_user_id ON public.line_subscribers USING btree (line_user_id);


--
-- Name: idx_ma_ops_checks_checked_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_checks_checked_at_desc ON public.ma_ops_checks USING btree (checked_at DESC);


--
-- Name: idx_ma_ops_checks_component; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_checks_component ON public.ma_ops_checks USING btree (component);


--
-- Name: idx_ma_ops_checks_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_checks_run_id ON public.ma_ops_checks USING btree (run_id);


--
-- Name: idx_ma_ops_checks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_checks_status ON public.ma_ops_checks USING btree (status);


--
-- Name: idx_ma_ops_runs_created_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_runs_created_at_desc ON public.ma_ops_runs USING btree (created_at DESC);


--
-- Name: idx_ma_ops_runs_environment_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_runs_environment_created_at ON public.ma_ops_runs USING btree (environment, created_at DESC);


--
-- Name: idx_ma_ops_runs_scheduled_for_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_runs_scheduled_for_desc ON public.ma_ops_runs USING btree (scheduled_for DESC);


--
-- Name: idx_ma_ops_runs_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_runs_severity ON public.ma_ops_runs USING btree (severity);


--
-- Name: idx_ma_ops_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ma_ops_runs_status ON public.ma_ops_runs USING btree (status);


--
-- Name: idx_market_data_history_snapshot_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_data_history_snapshot_at ON public.market_data_history USING btree (snapshot_at DESC);


--
-- Name: idx_market_data_history_symbol_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_data_history_symbol_date ON public.market_data_history USING btree (symbol, taipei_date DESC);


--
-- Name: idx_market_data_history_taipei_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_data_history_taipei_date ON public.market_data_history USING btree (taipei_date DESC);


--
-- Name: idx_market_data_snapshots_captured_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_data_snapshots_captured_at ON public.market_data_snapshots USING btree (captured_at);


--
-- Name: idx_market_data_snapshots_trading_date_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_data_snapshots_trading_date_phase ON public.market_data_snapshots USING btree (trading_date, phase);


--
-- Name: idx_market_news_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_news_created_at ON public.market_news USING btree (created_at DESC);


--
-- Name: idx_market_news_is_selected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_news_is_selected ON public.market_news USING btree (is_selected, created_at DESC);


--
-- Name: idx_market_news_published_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_news_published_at ON public.market_news USING btree (published_at DESC);


--
-- Name: idx_market_source_health_source_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_market_source_health_source_name ON public.market_source_health USING btree (source_name);


--
-- Name: idx_market_source_health_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_market_source_health_updated_at ON public.market_source_health USING btree (updated_at DESC);


--
-- Name: idx_news_event_tags_event_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_event_tags_event_type ON public.news_event_tags USING btree (event_type);


--
-- Name: idx_news_event_tags_published_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_event_tags_published_at ON public.news_event_tags USING btree (published_at);


--
-- Name: idx_opening_market_radar_captured_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opening_market_radar_captured_at ON public.opening_market_radar USING btree (captured_at DESC);


--
-- Name: idx_opening_market_radar_captured_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opening_market_radar_captured_at_desc ON public.opening_market_radar USING btree (captured_at DESC);


--
-- Name: idx_opening_market_radar_data_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opening_market_radar_data_status ON public.opening_market_radar USING btree (data_status);


--
-- Name: idx_opening_market_radar_market_data_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opening_market_radar_market_data_date ON public.opening_market_radar USING btree (market_data_date DESC);


--
-- Name: idx_opening_market_radar_market_data_date_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opening_market_radar_market_data_date_desc ON public.opening_market_radar USING btree (market_data_date DESC);


--
-- Name: idx_prediction_accuracy_logs_created_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_accuracy_logs_created_at_desc ON public.prediction_accuracy_logs USING btree (created_at DESC);


--
-- Name: idx_prediction_accuracy_logs_report_date_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_accuracy_logs_report_date_desc ON public.prediction_accuracy_logs USING btree (report_date DESC);


--
-- Name: idx_reports_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_created_at ON public.reports USING btree (created_at DESC);


--
-- Name: idx_reports_report_date; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_reports_report_date ON public.reports USING btree (report_date);


--
-- Name: idx_sector_rotation_scores_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sector_rotation_scores_date ON public.sector_rotation_scores USING btree (score_date);


--
-- Name: idx_sector_rotation_scores_sector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sector_rotation_scores_sector ON public.sector_rotation_scores USING btree (sector);


--
-- Name: idx_sector_stock_map_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sector_stock_map_active ON public.sector_stock_map USING btree (is_active);


--
-- Name: idx_sector_stock_map_sector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sector_stock_map_sector ON public.sector_stock_map USING btree (sector);


--
-- Name: idx_sector_stock_map_symbol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sector_stock_map_symbol ON public.sector_stock_map USING btree (symbol);


--
-- Name: idx_system_health_logs_check_date_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_health_logs_check_date_desc ON public.system_health_logs USING btree (check_date DESC);


--
-- Name: idx_system_health_logs_created_at_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_health_logs_created_at_desc ON public.system_health_logs USING btree (created_at DESC);


--
-- Name: institutional_flows_date_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX institutional_flows_date_type_idx ON public.institutional_flows USING btree (trading_date DESC, institution_type, symbol);


--
-- Name: learning_audit_logs_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_audit_logs_actor_idx ON public.learning_audit_logs USING btree (actor_id, created_at DESC) WHERE (actor_id IS NOT NULL);


--
-- Name: learning_audit_logs_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_audit_logs_entity_idx ON public.learning_audit_logs USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: learning_audit_logs_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_audit_logs_run_idx ON public.learning_audit_logs USING btree (learning_run_id, created_at DESC);


--
-- Name: learning_cases_prediction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_cases_prediction_idx ON public.learning_cases USING btree (prediction_id, created_at DESC);


--
-- Name: learning_cases_regime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_cases_regime_idx ON public.learning_cases USING btree (market_regime, case_type, created_at DESC);


--
-- Name: learning_cases_signature_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_cases_signature_idx ON public.learning_cases USING btree (case_signature, case_type, created_at DESC);


--
-- Name: learning_predictions_calibration_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_predictions_calibration_idx ON public.learning_predictions USING btree (model_version, report_date DESC, model_confidence);


--
-- Name: learning_predictions_decision_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_predictions_decision_snapshot_idx ON public.learning_predictions USING btree (decision_snapshot_id);


--
-- Name: learning_predictions_report_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_predictions_report_id_idx ON public.learning_predictions USING btree (report_id);


--
-- Name: learning_predictions_report_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_predictions_report_window_idx ON public.learning_predictions USING btree (report_date DESC, analysis_window, created_at DESC);


--
-- Name: learning_predictions_root_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_predictions_root_revision_idx ON public.learning_predictions USING btree (root_prediction_id, revision DESC) WHERE (root_prediction_id IS NOT NULL);


--
-- Name: learning_predictions_supersedes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_predictions_supersedes_idx ON public.learning_predictions USING btree (supersedes_prediction_id) WHERE (supersedes_prediction_id IS NOT NULL);


--
-- Name: learning_predictions_symbol_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_predictions_symbol_date_idx ON public.learning_predictions USING btree (symbol, report_date DESC);


--
-- Name: learning_rules_promoted_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_rules_promoted_by_idx ON public.learning_rules USING btree (promoted_by) WHERE (promoted_by IS NOT NULL);


--
-- Name: learning_rules_source_pattern_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_rules_source_pattern_idx ON public.learning_rules USING btree (source_pattern_id) WHERE (source_pattern_id IS NOT NULL);


--
-- Name: learning_rules_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_rules_status_idx ON public.learning_rules USING btree (status, updated_at DESC);


--
-- Name: learning_runs_date_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX learning_runs_date_status_idx ON public.learning_runs USING btree (run_date DESC, status, started_at DESC);


--
-- Name: line_delivery_outbox_ready_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX line_delivery_outbox_ready_idx ON public.line_delivery_outbox USING btree (report_date, push_type, next_retry_at, created_at) WHERE (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text]));


--
-- Name: line_delivery_outbox_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX line_delivery_outbox_snapshot_idx ON public.line_delivery_outbox USING btree (decision_snapshot_id);


--
-- Name: line_delivery_outbox_subscriber_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX line_delivery_outbox_subscriber_idx ON public.line_delivery_outbox USING btree (line_subscriber_id);


--
-- Name: ma_ops_recovery_actions_check_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ma_ops_recovery_actions_check_id_idx ON public.ma_ops_recovery_actions USING btree (check_id);


--
-- Name: ma_ops_recovery_actions_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ma_ops_recovery_actions_run_id_idx ON public.ma_ops_recovery_actions USING btree (run_id);


--
-- Name: macro_events_event_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX macro_events_event_at_idx ON public.macro_events USING btree (event_at DESC, importance DESC);


--
-- Name: market_checkpoint_snapshots_authoritative_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_checkpoint_snapshots_authoritative_provider_uidx ON public.market_checkpoint_snapshots USING btree (trading_date, checkpoint, provider_key) WHERE (batch_id IS NOT NULL);


--
-- Name: market_checkpoint_snapshots_batch_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_checkpoint_snapshots_batch_lookup_idx ON public.market_checkpoint_snapshots USING btree (batch_id, snapshot_version);


--
-- Name: market_checkpoint_snapshots_batch_provider_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_checkpoint_snapshots_batch_provider_uidx ON public.market_checkpoint_snapshots USING btree (batch_id, provider_key) WHERE (batch_id IS NOT NULL);


--
-- Name: market_checkpoint_snapshots_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_checkpoint_snapshots_lookup_idx ON public.market_checkpoint_snapshots USING btree (trading_date DESC, checkpoint, symbol, captured_at DESC, snapshot_version DESC);


--
-- Name: market_data_snapshots_atomic_batch_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_data_snapshots_atomic_batch_lookup_idx ON public.market_data_snapshots USING btree (((raw ->> 'checkpoint_batch_id'::text)), symbol) WHERE ((raw ->> 'checkpoint_batch_id'::text) IS NOT NULL);


--
-- Name: market_data_snapshots_atomic_identity_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_data_snapshots_atomic_identity_uidx ON public.market_data_snapshots USING btree (symbol, trading_date, phase, checkpoint) WHERE ((raw ->> 'checkpoint_batch_id'::text) IS NOT NULL);


--
-- Name: market_data_snapshots_checkpoint_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_data_snapshots_checkpoint_lookup_idx ON public.market_data_snapshots USING btree (trading_date DESC, phase, checkpoint, captured_at DESC);


--
-- Name: market_data_snapshots_symbol_date_checkpoint_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_data_snapshots_symbol_date_checkpoint_uidx ON public.market_data_snapshots USING btree (symbol, trading_date, phase, checkpoint);


--
-- Name: market_indices_market_quote_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_indices_market_quote_id_idx ON public.market_indices USING btree (market_quote_id);


--
-- Name: market_indices_symbol_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_indices_symbol_latest_idx ON public.market_indices USING btree (symbol, captured_at DESC);


--
-- Name: market_patterns_status_sample_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_patterns_status_sample_idx ON public.market_patterns USING btree (status, sample_size DESC, last_seen_date DESC);


--
-- Name: market_quotes_provider_health_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_quotes_provider_health_idx ON public.market_quotes USING btree (provider, quality_status, captured_at DESC);


--
-- Name: market_quotes_symbol_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_quotes_symbol_latest_idx ON public.market_quotes USING btree (symbol, captured_at DESC);


--
-- Name: market_quotes_trading_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_quotes_trading_phase_idx ON public.market_quotes USING btree (trading_date DESC, phase, symbol);


--
-- Name: market_snapshots_date_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_snapshots_date_session_idx ON public.market_snapshots USING btree (trading_date DESC, session_type, version DESC);


--
-- Name: market_snapshots_regime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX market_snapshots_regime_idx ON public.market_snapshots USING btree (market_regime, trading_date DESC);


--
-- Name: member_content_revisions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_content_revisions_lookup_idx ON public.member_content_revisions USING btree (report_date, revision DESC);


--
-- Name: member_entitlements_provider_customer_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_entitlements_provider_customer_uidx ON public.member_entitlements USING btree (billing_provider, provider_customer_id) WHERE ((billing_provider IS NOT NULL) AND (provider_customer_id IS NOT NULL));


--
-- Name: member_entitlements_provider_subscription_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_entitlements_provider_subscription_uidx ON public.member_entitlements USING btree (billing_provider, provider_subscription_id) WHERE ((billing_provider IS NOT NULL) AND (provider_subscription_id IS NOT NULL));


--
-- Name: member_entitlements_state_access_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_entitlements_state_access_idx ON public.member_entitlements USING btree (state, access_ends_at);


--
-- Name: membership_access_events_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_access_events_user_time_idx ON public.membership_access_events USING btree (user_id, occurred_at DESC);


--
-- Name: model_evaluations_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_evaluations_lookup_idx ON public.model_evaluations USING btree (model_version, window_days, confidence_bucket, period_end DESC);


--
-- Name: news_events_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX news_events_published_idx ON public.news_events USING btree (published_at DESC);


--
-- Name: news_events_symbols_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX news_events_symbols_gin_idx ON public.news_events USING gin (symbols);


--
-- Name: pipeline_runs_correlation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_runs_correlation_idx ON public.pipeline_runs USING btree (correlation_id) WHERE (correlation_id IS NOT NULL);


--
-- Name: pipeline_runs_cost_usage_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_runs_cost_usage_id_idx ON public.pipeline_runs USING btree (cost_usage_id);


--
-- Name: pipeline_runs_date_checkpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_runs_date_checkpoint_idx ON public.pipeline_runs USING btree (trading_date DESC, checkpoint, created_at DESC);


--
-- Name: pipeline_runs_research_session_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_runs_research_session_id_idx ON public.pipeline_runs USING btree (research_session_id);


--
-- Name: pipeline_runs_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_runs_snapshot_idx ON public.pipeline_runs USING btree (decision_snapshot_id);


--
-- Name: pipeline_runs_status_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_runs_status_retry_idx ON public.pipeline_runs USING btree (status, next_retry_at) WHERE (status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'DEGRADED'::text, 'FAILED'::text]));


--
-- Name: prediction_outcomes_prediction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_outcomes_prediction_idx ON public.prediction_outcomes USING btree (prediction_id, horizon);


--
-- Name: prediction_outcomes_status_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_outcomes_status_target_idx ON public.prediction_outcomes USING btree (status, target_date, horizon);


--
-- Name: prediction_reviews_date_result_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_reviews_date_result_idx ON public.prediction_reviews USING btree (review_date DESC, review_result);


--
-- Name: prediction_reviews_error_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_reviews_error_idx ON public.prediction_reviews USING btree (error_type, review_date DESC) WHERE ((learning_eligible = true) AND (error_type IS NOT NULL));


--
-- Name: prediction_reviews_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_reviews_outcome_idx ON public.prediction_reviews USING btree (outcome_id) WHERE (outcome_id IS NOT NULL);


--
-- Name: prediction_reviews_prediction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_reviews_prediction_idx ON public.prediction_reviews USING btree (prediction_id, created_at DESC);


--
-- Name: production_acceptance_results_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX production_acceptance_results_lookup_idx ON public.production_acceptance_results USING btree (business_date DESC, evaluated_at DESC);


--
-- Name: push_logs_report_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_logs_report_id_idx ON public.push_logs USING btree (report_id);


--
-- Name: push_logs_subscriber_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_logs_subscriber_id_idx ON public.push_logs USING btree (subscriber_id);


--
-- Name: reports_report_date_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reports_report_date_unique ON public.reports USING btree (report_date);


--
-- Name: research_catalysts_session_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_catalysts_session_score_idx ON public.research_catalysts USING btree (research_session_id, weighted_score DESC);


--
-- Name: research_facts_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_facts_session_idx ON public.research_facts USING btree (research_session_id, observed_at DESC);


--
-- Name: research_facts_type_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_facts_type_subject_idx ON public.research_facts USING btree (fact_type, subject);


--
-- Name: research_sessions_date_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_sessions_date_session_idx ON public.research_sessions USING btree (trading_date DESC, session_type, version DESC);


--
-- Name: research_sessions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_sessions_status_idx ON public.research_sessions USING btree (status, generated_at DESC);


--
-- Name: rule_backtests_rule_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rule_backtests_rule_status_idx ON public.rule_backtests USING btree (rule_id, status, created_at DESC);


--
-- Name: runtime_cost_usage_date_component_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_cost_usage_date_component_idx ON public.runtime_cost_usage USING btree (usage_date DESC, component, provider);


--
-- Name: runtime_dead_letters_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_dead_letters_open_idx ON public.runtime_dead_letters USING btree (status, created_at DESC) WHERE (status = 'open'::text);


--
-- Name: runtime_http_dispatches_reconcile_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_http_dispatches_reconcile_idx ON public.runtime_http_dispatches USING btree (dispatch_status, created_at) WHERE (dispatch_status = ANY (ARRAY['DISPATCHED'::text, 'ACKNOWLEDGED'::text]));


--
-- Name: runtime_http_dispatches_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_http_dispatches_retry_idx ON public.runtime_http_dispatches USING btree (dispatch_status, next_retry_at) WHERE (dispatch_status = ANY (ARRAY['FAILED'::text, 'TIMED_OUT'::text]));


--
-- Name: runtime_lifecycle_events_date_rank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_lifecycle_events_date_rank_idx ON public.runtime_lifecycle_events USING btree (trading_date DESC, state_rank, created_at);


--
-- Name: runtime_quality_policies_one_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX runtime_quality_policies_one_active_uidx ON public.runtime_quality_policies USING btree (active) WHERE (active = true);


--
-- Name: runtime_slo_measurements_key_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX runtime_slo_measurements_key_time_idx ON public.runtime_slo_measurements USING btree (slo_key, measured_at DESC);


--
-- Name: semantic_coherence_reviews_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX semantic_coherence_reviews_lookup_idx ON public.semantic_coherence_reviews USING btree (report_date, checked_at DESC);


--
-- Name: strategy_registry_audit_actor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX strategy_registry_audit_actor_id_idx ON public.strategy_registry_audit USING btree (actor_id);


--
-- Name: strategy_registry_audit_strategy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX strategy_registry_audit_strategy_idx ON public.strategy_registry_audit USING btree (strategy_id, created_at DESC);


--
-- Name: strategy_registry_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX strategy_registry_lifecycle_idx ON public.strategy_registry USING btree (lifecycle, strategy_key, version DESC);


--
-- Name: strategy_registry_one_production_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX strategy_registry_one_production_uidx ON public.strategy_registry USING btree (strategy_key) WHERE (lifecycle = 'production'::text);


--
-- Name: strategy_registry_parent_strategy_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX strategy_registry_parent_strategy_id_idx ON public.strategy_registry USING btree (parent_strategy_id);


--
-- Name: strategy_registry_promoted_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX strategy_registry_promoted_by_idx ON public.strategy_registry USING btree (promoted_by);


--
-- Name: strategy_registry_rollback_target_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX strategy_registry_rollback_target_id_idx ON public.strategy_registry USING btree (rollback_target_id);


--
-- Name: user_market_preferences_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_market_preferences_enabled_idx ON public.user_market_preferences USING btree (personalization_enabled) WHERE (personalization_enabled = true);


--
-- Name: decision_snapshots bind_inserted_decision_premarket_evidence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bind_inserted_decision_premarket_evidence AFTER INSERT ON public.decision_snapshots FOR EACH ROW EXECUTE FUNCTION public.bind_inserted_decision_premarket_evidence_v1();


--
-- Name: runtime_http_dispatches classify_runtime_quality_block_before_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER classify_runtime_quality_block_before_update BEFORE UPDATE ON public.runtime_http_dispatches FOR EACH ROW EXECUTE FUNCTION public.classify_runtime_quality_block_v1();


--
-- Name: decision_snapshots decision_snapshots_premium_90_gate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER decision_snapshots_premium_90_gate BEFORE INSERT OR UPDATE OF status, content_score, decision_mode ON public.decision_snapshots FOR EACH ROW EXECUTE FUNCTION public.enforce_decision_snapshot_premium_90_gate_v1();


--
-- Name: editorial_reviews editorial_reviews_premium_90_gate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER editorial_reviews_premium_90_gate BEFORE INSERT OR UPDATE OF review_status, content_score ON public.editorial_reviews FOR EACH ROW EXECUTE FUNCTION public.enforce_editorial_review_premium_90_gate_v1();


--
-- Name: production_acceptance_results enforce_atomic_checkpoint_acceptance; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_atomic_checkpoint_acceptance BEFORE INSERT ON public.production_acceptance_results FOR EACH ROW EXECUTE FUNCTION public.enforce_atomic_checkpoint_acceptance_v1();


--
-- Name: market_checkpoint_batches enforce_market_checkpoint_batch_complete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE CONSTRAINT TRIGGER enforce_market_checkpoint_batch_complete AFTER INSERT ON public.market_checkpoint_batches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_market_checkpoint_batch_complete_v1();


--
-- Name: market_checkpoint_snapshots enforce_market_checkpoint_snapshot_batch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER enforce_market_checkpoint_snapshot_batch BEFORE INSERT ON public.market_checkpoint_snapshots FOR EACH ROW EXECUTE FUNCTION public.enforce_market_checkpoint_snapshot_batch_v1();


--
-- Name: learning_audit_logs learning_audit_logs_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_audit_logs_append_only BEFORE DELETE OR UPDATE ON public.learning_audit_logs FOR EACH ROW EXECUTE FUNCTION public.cle_prevent_audit_mutation_v1();


--
-- Name: learning_predictions learning_predictions_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_predictions_append_only BEFORE DELETE OR UPDATE ON public.learning_predictions FOR EACH ROW EXECUTE FUNCTION public.cle_prevent_prediction_mutation_v1();


--
-- Name: learning_rules learning_rules_audit_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_rules_audit_change AFTER UPDATE ON public.learning_rules FOR EACH ROW EXECUTE FUNCTION public.cle_audit_rule_change_v1();


--
-- Name: learning_rules learning_rules_guard_promotion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_rules_guard_promotion BEFORE UPDATE ON public.learning_rules FOR EACH ROW EXECUTE FUNCTION public.cle_guard_rule_promotion_v1();


--
-- Name: learning_rules learning_rules_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_rules_set_updated_at BEFORE UPDATE ON public.learning_rules FOR EACH ROW EXECUTE FUNCTION public.cle_set_updated_at_v1();


--
-- Name: learning_runs learning_runs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER learning_runs_set_updated_at BEFORE UPDATE ON public.learning_runs FOR EACH ROW EXECUTE FUNCTION public.cle_set_updated_at_v1();


--
-- Name: ma_ops_component_registry ma_ops_component_registry_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ma_ops_component_registry_set_updated_at BEFORE UPDATE ON public.ma_ops_component_registry FOR EACH ROW EXECUTE FUNCTION public.ma_ops_set_updated_at();


--
-- Name: ma_ops_recovery_actions ma_ops_recovery_actions_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ma_ops_recovery_actions_set_updated_at BEFORE UPDATE ON public.ma_ops_recovery_actions FOR EACH ROW EXECUTE FUNCTION public.ma_ops_set_updated_at();


--
-- Name: ma_ops_runs ma_ops_runs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ma_ops_runs_set_updated_at BEFORE UPDATE ON public.ma_ops_runs FOR EACH ROW EXECUTE FUNCTION public.ma_ops_set_updated_at();


--
-- Name: market_patterns market_patterns_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER market_patterns_set_updated_at BEFORE UPDATE ON public.market_patterns FOR EACH ROW EXECUTE FUNCTION public.cle_set_updated_at_v1();


--
-- Name: prediction_outcomes prediction_outcomes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prediction_outcomes_set_updated_at BEFORE UPDATE ON public.prediction_outcomes FOR EACH ROW EXECUTE FUNCTION public.cle_set_updated_at_v1();


--
-- Name: decision_snapshot_market_evidence reject_decision_snapshot_market_evidence_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reject_decision_snapshot_market_evidence_mutation BEFORE DELETE OR UPDATE ON public.decision_snapshot_market_evidence FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_market_checkpoint_mutation_v1();


--
-- Name: market_checkpoint_batches reject_market_checkpoint_batch_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reject_market_checkpoint_batch_mutation BEFORE DELETE OR UPDATE ON public.market_checkpoint_batches FOR EACH ROW EXECUTE FUNCTION public.reject_market_checkpoint_batch_mutation_v1();


--
-- Name: market_checkpoint_snapshots reject_market_checkpoint_snapshot_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reject_market_checkpoint_snapshot_mutation BEFORE DELETE OR UPDATE ON public.market_checkpoint_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_market_checkpoint_mutation_v1();


--
-- Name: member_entitlements set_member_entitlements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_member_entitlements_updated_at BEFORE UPDATE ON public.member_entitlements FOR EACH ROW EXECUTE FUNCTION public.set_membership_updated_at_v1();


--
-- Name: membership_access_config set_membership_access_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_membership_access_config_updated_at BEFORE UPDATE ON public.membership_access_config FOR EACH ROW EXECUTE FUNCTION public.set_membership_updated_at_v1();


--
-- Name: sector_stock_map trg_sector_stock_map_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sector_stock_map_updated_at BEFORE UPDATE ON public.sector_stock_map FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: billing_webhook_events billing_webhook_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: catalyst_tw_mappings catalyst_tw_mappings_catalyst_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalyst_tw_mappings
    ADD CONSTRAINT catalyst_tw_mappings_catalyst_id_fkey FOREIGN KEY (catalyst_id) REFERENCES public.research_catalysts(id) ON DELETE CASCADE;


--
-- Name: content_feedback content_feedback_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_feedback
    ADD CONSTRAINT content_feedback_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE SET NULL;


--
-- Name: content_feedback content_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_feedback
    ADD CONSTRAINT content_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: content_os_sync_incidents content_os_sync_incidents_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_os_sync_incidents
    ADD CONSTRAINT content_os_sync_incidents_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE RESTRICT;


--
-- Name: decision_snapshot_market_evidence decision_snapshot_market_evid_market_checkpoint_snapshot_i_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_snapshot_market_evidence
    ADD CONSTRAINT decision_snapshot_market_evid_market_checkpoint_snapshot_i_fkey FOREIGN KEY (market_checkpoint_snapshot_id) REFERENCES public.market_checkpoint_snapshots(id) ON DELETE RESTRICT;


--
-- Name: decision_snapshot_market_evidence decision_snapshot_market_evidence_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_snapshot_market_evidence
    ADD CONSTRAINT decision_snapshot_market_evidence_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE RESTRICT;


--
-- Name: decision_snapshots decision_snapshots_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_snapshots
    ADD CONSTRAINT decision_snapshots_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE SET NULL;


--
-- Name: decision_snapshots decision_snapshots_research_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_snapshots
    ADD CONSTRAINT decision_snapshots_research_session_id_fkey FOREIGN KEY (research_session_id) REFERENCES public.research_sessions(id) ON DELETE SET NULL;


--
-- Name: decision_snapshots decision_snapshots_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_snapshots
    ADD CONSTRAINT decision_snapshots_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.decision_snapshots(id) ON DELETE SET NULL;


--
-- Name: editorial_reviews editorial_reviews_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editorial_reviews
    ADD CONSTRAINT editorial_reviews_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE SET NULL;


--
-- Name: editorial_reviews editorial_reviews_research_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editorial_reviews
    ADD CONSTRAINT editorial_reviews_research_session_id_fkey FOREIGN KEY (research_session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: futures_snapshots futures_snapshots_market_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.futures_snapshots
    ADD CONSTRAINT futures_snapshots_market_quote_id_fkey FOREIGN KEY (market_quote_id) REFERENCES public.market_quotes(id) ON DELETE SET NULL;


--
-- Name: growth_events_v2 growth_events_v2_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_events_v2
    ADD CONSTRAINT growth_events_v2_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: historical_replay_results historical_replay_results_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_results
    ADD CONSTRAINT historical_replay_results_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE SET NULL;


--
-- Name: historical_replay_results historical_replay_results_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_results
    ADD CONSTRAINT historical_replay_results_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.learning_predictions(id) ON DELETE SET NULL;


--
-- Name: historical_replay_results historical_replay_results_replay_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_results
    ADD CONSTRAINT historical_replay_results_replay_run_id_fkey FOREIGN KEY (replay_run_id) REFERENCES public.historical_replay_runs(id) ON DELETE CASCADE;


--
-- Name: historical_replay_runs historical_replay_runs_strategy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_replay_runs
    ADD CONSTRAINT historical_replay_runs_strategy_id_fkey FOREIGN KEY (strategy_id) REFERENCES public.strategy_registry(id) ON DELETE RESTRICT;


--
-- Name: historical_similarity_results historical_similarity_results_similar_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_similarity_results
    ADD CONSTRAINT historical_similarity_results_similar_snapshot_id_fkey FOREIGN KEY (similar_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE CASCADE;


--
-- Name: historical_similarity_results historical_similarity_results_target_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_similarity_results
    ADD CONSTRAINT historical_similarity_results_target_snapshot_id_fkey FOREIGN KEY (target_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE CASCADE;


--
-- Name: learning_audit_logs learning_audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_audit_logs
    ADD CONSTRAINT learning_audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: learning_audit_logs learning_audit_logs_learning_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_audit_logs
    ADD CONSTRAINT learning_audit_logs_learning_run_id_fkey FOREIGN KEY (learning_run_id) REFERENCES public.learning_runs(id) ON DELETE SET NULL;


--
-- Name: learning_cases learning_cases_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_cases
    ADD CONSTRAINT learning_cases_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.learning_predictions(id) ON DELETE RESTRICT;


--
-- Name: learning_cases learning_cases_prediction_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_cases
    ADD CONSTRAINT learning_cases_prediction_review_id_fkey FOREIGN KEY (prediction_review_id) REFERENCES public.prediction_reviews(id) ON DELETE RESTRICT;


--
-- Name: learning_metric_corrections learning_metric_corrections_learning_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_metric_corrections
    ADD CONSTRAINT learning_metric_corrections_learning_run_id_fkey FOREIGN KEY (learning_run_id) REFERENCES public.learning_runs(id) ON DELETE RESTRICT;


--
-- Name: learning_predictions learning_predictions_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_predictions
    ADD CONSTRAINT learning_predictions_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE RESTRICT;


--
-- Name: learning_predictions learning_predictions_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_predictions
    ADD CONSTRAINT learning_predictions_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE RESTRICT;


--
-- Name: learning_predictions learning_predictions_root_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_predictions
    ADD CONSTRAINT learning_predictions_root_prediction_id_fkey FOREIGN KEY (root_prediction_id) REFERENCES public.learning_predictions(id) ON DELETE RESTRICT;


--
-- Name: learning_predictions learning_predictions_supersedes_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_predictions
    ADD CONSTRAINT learning_predictions_supersedes_prediction_id_fkey FOREIGN KEY (supersedes_prediction_id) REFERENCES public.learning_predictions(id) ON DELETE RESTRICT;


--
-- Name: learning_rules learning_rules_promoted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: learning_rules learning_rules_source_pattern_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_rules
    ADD CONSTRAINT learning_rules_source_pattern_id_fkey FOREIGN KEY (source_pattern_id) REFERENCES public.market_patterns(id) ON DELETE SET NULL;


--
-- Name: line_delivery_outbox line_delivery_outbox_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_delivery_outbox
    ADD CONSTRAINT line_delivery_outbox_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE SET NULL;


--
-- Name: line_delivery_outbox line_delivery_outbox_line_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_delivery_outbox
    ADD CONSTRAINT line_delivery_outbox_line_subscriber_id_fkey FOREIGN KEY (line_subscriber_id) REFERENCES public.line_subscribers(id) ON DELETE CASCADE;


--
-- Name: ma_ops_checks ma_ops_checks_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_checks
    ADD CONSTRAINT ma_ops_checks_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.ma_ops_runs(id) ON DELETE CASCADE;


--
-- Name: ma_ops_recovery_actions ma_ops_recovery_actions_check_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_recovery_actions
    ADD CONSTRAINT ma_ops_recovery_actions_check_id_fkey FOREIGN KEY (check_id) REFERENCES public.ma_ops_checks(id) ON DELETE SET NULL;


--
-- Name: ma_ops_recovery_actions ma_ops_recovery_actions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ma_ops_recovery_actions
    ADD CONSTRAINT ma_ops_recovery_actions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.ma_ops_runs(id) ON DELETE SET NULL;


--
-- Name: market_checkpoint_snapshots market_checkpoint_snapshots_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_checkpoint_snapshots
    ADD CONSTRAINT market_checkpoint_snapshots_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.market_checkpoint_batches(batch_id) ON DELETE RESTRICT NOT VALID;


--
-- Name: market_indices market_indices_market_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_indices
    ADD CONSTRAINT market_indices_market_quote_id_fkey FOREIGN KEY (market_quote_id) REFERENCES public.market_quotes(id) ON DELETE SET NULL;


--
-- Name: member_content_revisions member_content_revisions_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_content_revisions
    ADD CONSTRAINT member_content_revisions_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE RESTRICT;


--
-- Name: member_content_revisions member_content_revisions_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_content_revisions
    ADD CONSTRAINT member_content_revisions_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE RESTRICT;


--
-- Name: member_entitlements member_entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_entitlements
    ADD CONSTRAINT member_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: membership_access_events membership_access_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_access_events
    ADD CONSTRAINT membership_access_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pipeline_runs pipeline_runs_cost_usage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_cost_usage_id_fkey FOREIGN KEY (cost_usage_id) REFERENCES public.runtime_cost_usage(id) ON DELETE SET NULL;


--
-- Name: pipeline_runs pipeline_runs_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE SET NULL;


--
-- Name: pipeline_runs pipeline_runs_research_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_research_session_id_fkey FOREIGN KEY (research_session_id) REFERENCES public.research_sessions(id) ON DELETE SET NULL;


--
-- Name: prediction_outcomes prediction_outcomes_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_outcomes
    ADD CONSTRAINT prediction_outcomes_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.learning_predictions(id) ON DELETE RESTRICT;


--
-- Name: prediction_reviews prediction_reviews_outcome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_reviews
    ADD CONSTRAINT prediction_reviews_outcome_id_fkey FOREIGN KEY (outcome_id) REFERENCES public.prediction_outcomes(id) ON DELETE RESTRICT;


--
-- Name: prediction_reviews prediction_reviews_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_reviews
    ADD CONSTRAINT prediction_reviews_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.learning_predictions(id) ON DELETE RESTRICT;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: push_logs push_logs_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_logs
    ADD CONSTRAINT push_logs_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.daily_reports(id) ON DELETE SET NULL;


--
-- Name: push_logs push_logs_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_logs
    ADD CONSTRAINT push_logs_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.subscribers(id) ON DELETE SET NULL;


--
-- Name: research_catalysts research_catalysts_research_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_catalysts
    ADD CONSTRAINT research_catalysts_research_session_id_fkey FOREIGN KEY (research_session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: research_facts research_facts_research_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_facts
    ADD CONSTRAINT research_facts_research_session_id_fkey FOREIGN KEY (research_session_id) REFERENCES public.research_sessions(id) ON DELETE CASCADE;


--
-- Name: rule_backtests rule_backtests_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rule_backtests
    ADD CONSTRAINT rule_backtests_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.learning_rules(id) ON DELETE RESTRICT;


--
-- Name: runtime_http_dispatch_attempts runtime_http_dispatch_attempts_dispatch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_http_dispatch_attempts
    ADD CONSTRAINT runtime_http_dispatch_attempts_dispatch_id_fkey FOREIGN KEY (dispatch_id) REFERENCES public.runtime_http_dispatches(id) ON DELETE CASCADE;


--
-- Name: runtime_lifecycle_events runtime_lifecycle_events_http_dispatch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_lifecycle_events
    ADD CONSTRAINT runtime_lifecycle_events_http_dispatch_id_fkey FOREIGN KEY (http_dispatch_id) REFERENCES public.runtime_http_dispatches(id) ON DELETE SET NULL;


--
-- Name: runtime_slo_measurements runtime_slo_measurements_slo_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.runtime_slo_measurements
    ADD CONSTRAINT runtime_slo_measurements_slo_key_fkey FOREIGN KEY (slo_key) REFERENCES public.runtime_slo_definitions(slo_key) ON DELETE RESTRICT;


--
-- Name: semantic_coherence_reviews semantic_coherence_reviews_decision_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_coherence_reviews
    ADD CONSTRAINT semantic_coherence_reviews_decision_snapshot_id_fkey FOREIGN KEY (decision_snapshot_id) REFERENCES public.decision_snapshots(id) ON DELETE RESTRICT;


--
-- Name: semantic_coherence_reviews semantic_coherence_reviews_member_content_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.semantic_coherence_reviews
    ADD CONSTRAINT semantic_coherence_reviews_member_content_revision_id_fkey FOREIGN KEY (member_content_revision_id) REFERENCES public.member_content_revisions(id) ON DELETE RESTRICT;


--
-- Name: strategy_registry_audit strategy_registry_audit_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry_audit
    ADD CONSTRAINT strategy_registry_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: strategy_registry_audit strategy_registry_audit_strategy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry_audit
    ADD CONSTRAINT strategy_registry_audit_strategy_id_fkey FOREIGN KEY (strategy_id) REFERENCES public.strategy_registry(id) ON DELETE CASCADE;


--
-- Name: strategy_registry strategy_registry_parent_strategy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry
    ADD CONSTRAINT strategy_registry_parent_strategy_id_fkey FOREIGN KEY (parent_strategy_id) REFERENCES public.strategy_registry(id) ON DELETE SET NULL;


--
-- Name: strategy_registry strategy_registry_promoted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry
    ADD CONSTRAINT strategy_registry_promoted_by_fkey FOREIGN KEY (promoted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: strategy_registry strategy_registry_rollback_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategy_registry
    ADD CONSTRAINT strategy_registry_rollback_target_id_fkey FOREIGN KEY (rollback_target_id) REFERENCES public.strategy_registry(id) ON DELETE SET NULL;


--
-- Name: user_market_preferences user_market_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_market_preferences
    ADD CONSTRAINT user_market_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: close_market_reviews Allow public read close market reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read close market reviews" ON public.close_market_reviews FOR SELECT TO anon, authenticated USING (true);


--
-- Name: voice_reports Allow public read on voice_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read on voice_reports" ON public.voice_reports FOR SELECT USING (true);


--
-- Name: voice_reports Allow service insert on voice_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow service insert on voice_reports" ON public.voice_reports FOR INSERT WITH CHECK (true);


--
-- Name: voice_reports Allow service update on voice_reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow service update on voice_reports" ON public.voice_reports FOR UPDATE USING (true);


--
-- Name: market_data Public can read market data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read market data" ON public.market_data FOR SELECT USING (true);


--
-- Name: market_news Public can read market news; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read market news" ON public.market_news FOR SELECT USING (true);


--
-- Name: market_snapshot Public can read market snapshot; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read market snapshot" ON public.market_snapshot FOR SELECT USING (true);


--
-- Name: daily_reports Public can read published daily reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read published daily reports" ON public.daily_reports FOR SELECT USING ((status = 'published'::text));


--
-- Name: opening_market_radar Public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read access" ON public.opening_market_radar FOR SELECT USING (true);


--
-- Name: opening_market_radar Service role write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role write" ON public.opening_market_radar TO service_role USING (true) WITH CHECK (true);


--
-- Name: profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING ((( SELECT auth.uid() AS uid) = id));


--
-- Name: early_access_signups anon_can_insert_early_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_can_insert_early_access ON public.early_access_signups FOR INSERT TO anon WITH CHECK (true);


--
-- Name: content_engagement_events anon_can_insert_engagement; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_can_insert_engagement ON public.content_engagement_events FOR INSERT TO anon WITH CHECK (true);


--
-- Name: early_access_signups authenticated_can_select_early_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_can_select_early_access ON public.early_access_signups FOR SELECT TO authenticated USING (true);


--
-- Name: content_engagement_events authenticated_can_select_engagement; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_can_select_engagement ON public.content_engagement_events FOR SELECT TO authenticated USING (true);


--
-- Name: billing_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: catalyst_tw_mappings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.catalyst_tw_mappings ENABLE ROW LEVEL SECURITY;

--
-- Name: close_market_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.close_market_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: company_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_events ENABLE ROW LEVEL SECURITY;

--
-- Name: content_engagement_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_engagement_events ENABLE ROW LEVEL SECURITY;

--
-- Name: content_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: content_feedback content_feedback_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_feedback_insert_own ON public.content_feedback FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: content_feedback content_feedback_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY content_feedback_read_own ON public.content_feedback FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: content_os_sync_incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_os_sync_incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: data_provider_health; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.data_provider_health ENABLE ROW LEVEL SECURITY;

--
-- Name: decision_snapshot_market_evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.decision_snapshot_market_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: decision_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.decision_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: early_access_signups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.early_access_signups ENABLE ROW LEVEL SECURITY;

--
-- Name: earnings_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.earnings_events ENABLE ROW LEVEL SECURITY;

--
-- Name: editorial_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.editorial_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: futures_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.futures_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: growth_events_v2; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.growth_events_v2 ENABLE ROW LEVEL SECURITY;

--
-- Name: historical_replay_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.historical_replay_results ENABLE ROW LEVEL SECURITY;

--
-- Name: historical_replay_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.historical_replay_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: historical_similarity_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.historical_similarity_results ENABLE ROW LEVEL SECURITY;

--
-- Name: institutional_flows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.institutional_flows ENABLE ROW LEVEL SECURITY;

--
-- Name: intraday_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intraday_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: intraday_checks intraday_checks_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intraday_checks_public_read ON public.intraday_checks FOR SELECT TO anon, authenticated USING (true);


--
-- Name: learning_audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_metric_corrections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_metric_corrections ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_predictions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: learning_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.learning_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: line_delivery_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_delivery_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: line_push_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_push_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: line_subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.line_subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: ma_chaos_line_sink_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ma_chaos_line_sink_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ma_ops_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ma_ops_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: ma_ops_component_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ma_ops_component_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: ma_ops_recovery_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ma_ops_recovery_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: ma_ops_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ma_ops_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: macro_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.macro_events ENABLE ROW LEVEL SECURITY;

--
-- Name: market_checkpoint_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_checkpoint_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: market_checkpoint_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_checkpoint_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: market_data; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_data ENABLE ROW LEVEL SECURITY;

--
-- Name: market_data_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_data_history ENABLE ROW LEVEL SECURITY;

--
-- Name: market_data_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_data_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: market_indices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_indices ENABLE ROW LEVEL SECURITY;

--
-- Name: market_news; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_news ENABLE ROW LEVEL SECURITY;

--
-- Name: market_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: market_quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: market_snapshot; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_snapshot ENABLE ROW LEVEL SECURITY;

--
-- Name: market_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: market_source_health; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_source_health ENABLE ROW LEVEL SECURITY;

--
-- Name: member_content_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_content_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: member_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_access_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_access_config ENABLE ROW LEVEL SECURITY;

--
-- Name: membership_access_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_access_events ENABLE ROW LEVEL SECURITY;

--
-- Name: model_evaluations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_evaluations ENABLE ROW LEVEL SECURITY;

--
-- Name: news_event_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.news_event_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: news_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.news_events ENABLE ROW LEVEL SECURITY;

--
-- Name: opening_market_radar; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opening_market_radar ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_accuracy_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_accuracy_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_accuracy_logs prediction_accuracy_logs_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_accuracy_logs_authenticated_read ON public.prediction_accuracy_logs FOR SELECT TO authenticated USING (true);


--
-- Name: prediction_outcomes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: production_acceptance_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.production_acceptance_results ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: market_source_health public read market_source_health; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read market_source_health" ON public.market_source_health FOR SELECT USING (true);


--
-- Name: news_event_tags public_read_news_event_tags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_news_event_tags ON public.news_event_tags FOR SELECT TO anon, authenticated USING (true);


--
-- Name: sector_rotation_scores public_read_sector_rotation_scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_sector_rotation_scores ON public.sector_rotation_scores FOR SELECT TO anon, authenticated USING (true);


--
-- Name: sector_stock_map public_read_sector_stock_map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read_sector_stock_map ON public.sector_stock_map FOR SELECT TO anon, authenticated USING (true);


--
-- Name: push_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: reports reports_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reports_admin_read ON public.reports FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (lower(COALESCE(profiles.role, ''::text)) = 'admin'::text)))));


--
-- Name: research_catalysts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_catalysts ENABLE ROW LEVEL SECURITY;

--
-- Name: research_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: research_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: rule_backtests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rule_backtests ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_control_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_control_state ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_cost_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_cost_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_dead_letters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_dead_letters ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_http_dispatch_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_http_dispatch_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_http_dispatches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_http_dispatches ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_job_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_job_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_lifecycle_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_lifecycle_events ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_quality_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_quality_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_replay_artifacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_replay_artifacts ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_slo_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_slo_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: runtime_slo_measurements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.runtime_slo_measurements ENABLE ROW LEVEL SECURITY;

--
-- Name: sector_rotation_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sector_rotation_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: sector_stock_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sector_stock_map ENABLE ROW LEVEL SECURITY;

--
-- Name: semantic_coherence_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.semantic_coherence_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: strategy_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.strategy_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: strategy_registry_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.strategy_registry_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: subscribers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

--
-- Name: system_health_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_health_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: system_health_logs system_health_logs_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_health_logs_authenticated_read ON public.system_health_logs FOR SELECT TO authenticated USING (true);


--
-- Name: trading_day_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trading_day_state ENABLE ROW LEVEL SECURITY;

--
-- Name: user_market_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_market_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_market_preferences user_market_preferences_owner_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_market_preferences_owner_delete ON public.user_market_preferences FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: user_market_preferences user_market_preferences_owner_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_market_preferences_owner_insert ON public.user_market_preferences FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: user_market_preferences user_market_preferences_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_market_preferences_owner_select ON public.user_market_preferences FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: user_market_preferences user_market_preferences_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_market_preferences_owner_update ON public.user_market_preferences FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: voice_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voice_reports ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--
