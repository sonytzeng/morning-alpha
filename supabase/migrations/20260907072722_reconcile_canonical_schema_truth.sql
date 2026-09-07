-- Schema-only reconciliation, source: core-schema-truth-20260907.json and
-- Sony-supplied Production function definitions. No business rows or secrets.
-- Existing objects must be reviewed against the manifest before Production use.
-- Compatible/additive; rollback must preserve retained evidence and Auth users.
begin;

-- Refuse to replace a function changed after the recorded Production baseline.
do $guard$
declare r record; actual text;
begin
  for r in select * from (values
    ('handle_new_user', '4af697fc01a4af733bfd687bb54d82f6'),
    ('handle_user_email_update', 'e5b1798c5ba06caa9b431ac8d52dec98'),
    ('reject_immutable_market_checkpoint_mutation_v1', '85a162edd9622ea1903e53952f950611')
  ) as expected(name, digest) loop
    select md5(regexp_replace(lower(p.prosrc),'[[:space:]]','','g')) into actual
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=r.name and p.pronargs=0;
    if actual is not null and actual <> r.digest then
      raise exception 'CANONICAL_FUNCTION_DRIFT: %', r.name;
    end if;
  end loop;
end;
$guard$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to ''
as $function$
BEGIN
  INSERT INTO public.profiles (id, email, role, subscription_status)
  VALUES (NEW.id, NEW.email, 'free', 'inactive');
  RETURN NEW;
END;
$function$;

create or replace function public.handle_user_email_update()
returns trigger language plpgsql security definer set search_path to ''
as $function$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email, updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$function$;

create or replace function public.reject_immutable_market_checkpoint_mutation_v1()
returns trigger language plpgsql set search_path to ''
as $function$
begin
  raise exception 'market_checkpoint_evidence_is_immutable';
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_email_update() from public, anon, authenticated;
revoke all on function public.reject_immutable_market_checkpoint_mutation_v1() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.handle_user_email_update() to service_role;
grant execute on function public.reject_immutable_market_checkpoint_mutation_v1() to service_role;

create or replace trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();
create or replace trigger on_auth_user_email_updated
after update of email on auth.users for each row
when (old.email::text is distinct from new.email::text)
execute function public.handle_user_email_update();

create table if not exists public.market_checkpoint_snapshots (
  id uuid not null default gen_random_uuid(),
  checkpoint text not null,
  trading_date date not null,
  captured_at timestamptz not null,
  market_session text not null,
  symbol text not null,
  value numeric not null,
  change_percent numeric,
  source text not null,
  source_timestamp timestamptz not null,
  correlation_id uuid not null,
  snapshot_version bigint generated always as identity not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint market_checkpoint_snapshots_pkey primary key (id),
  constraint market_checkpoint_snapshots_checkpoint_check check (checkpoint ~ '^[A-Z0-9_]{2,40}$'),
  constraint market_checkpoint_snapshots_correlation_id_checkpoint_symbo_key unique(correlation_id,checkpoint,symbol),
  constraint market_checkpoint_snapshots_market_session_check check(market_session in ('premarket','intraday','close','recovery')),
  constraint market_checkpoint_snapshots_raw_check check(jsonb_typeof(raw)='object'),
  constraint market_checkpoint_snapshots_snapshot_version_key unique(snapshot_version),
  constraint market_checkpoint_snapshots_source_check check(length(trim(source)) between 1 and 120),
  constraint market_checkpoint_snapshots_symbol_check check(length(trim(symbol)) between 1 and 40)
);
create index if not exists market_checkpoint_snapshots_lookup_idx
on public.market_checkpoint_snapshots(trading_date desc,checkpoint,symbol,captured_at desc,snapshot_version desc);
alter table public.market_checkpoint_snapshots enable row level security;
alter table public.market_checkpoint_snapshots force row level security;
revoke all on public.market_checkpoint_snapshots from public,anon,authenticated;
grant all on public.market_checkpoint_snapshots to service_role;
revoke all on sequence public.market_checkpoint_snapshots_snapshot_version_seq from public,anon,authenticated;
grant usage,select on sequence public.market_checkpoint_snapshots_snapshot_version_seq to service_role;
create or replace trigger reject_market_checkpoint_snapshot_mutation
before delete or update on public.market_checkpoint_snapshots for each row
execute function public.reject_immutable_market_checkpoint_mutation_v1();

create table if not exists public.news_event_tags (
  id uuid not null default gen_random_uuid(),
  news_key text not null,
  news_title text,
  news_source text,
  published_at timestamptz,
  event_type text,
  related_sectors text[] not null default '{}'::text[],
  related_symbols text[] not null default '{}'::text[],
  related_global_symbols text[] not null default '{}'::text[],
  impact_direction text,
  impact_strength numeric not null default 0,
  confidence_score numeric not null default 0,
  reasoning text,
  tagged_by text not null default 'system',
  tagged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint news_event_tags_pkey primary key(id),
  constraint news_event_tags_news_key_unique unique(news_key)
);
create index if not exists idx_news_event_tags_published_at on public.news_event_tags(published_at);
create index if not exists idx_news_event_tags_event_type on public.news_event_tags(event_type);
alter table public.news_event_tags enable row level security;
-- Public consumers only read. In particular TRUNCATE bypasses RLS and must not
-- be inherited from the historical broad table grant. Keep publisher access.
revoke all on public.news_event_tags from public,anon,authenticated;
grant select on public.news_event_tags to anon,authenticated;
grant all on public.news_event_tags to service_role;
do $policy$
begin
  if not exists(select 1 from pg_policies where schemaname='public'
    and tablename='news_event_tags' and policyname='public_read_news_event_tags') then
    create policy public_read_news_event_tags on public.news_event_tags
    for select to anon,authenticated using(true);
  end if;
end;
$policy$;

-- Existing Production lifecycle and timestamp objects, preserved verbatim.
-- The historical monitoring migration relied on Production default privileges.
-- Preserve its catalog-confirmed service-role grants on a clean local rebuild;
-- anon/authenticated remain revoked, and RLS/FORCE RLS remain unchanged.
grant all on public.ma_ops_runs, public.ma_ops_checks,
  public.ma_ops_recovery_actions, public.ma_ops_component_registry to service_role;
grant all on public.prediction_accuracy_logs, public.system_health_logs to service_role;

-- Existing Production lifecycle and timestamp objects, preserved verbatim.
-- Explicit local integration approval: Sony, 2026-09-07.
-- Production body hashes: lifecycle a1af0d71f9ef824c5876816a2040fcc9;
-- timestamp 9b1889f56258bf9d6554213c05019c76. No new lifecycle policy.
CREATE OR REPLACE FUNCTION public.advance_trading_day_state_v1(p_trading_date date, p_state text, p_checkpoint text, p_status text DEFAULT 'SUCCEEDED'::text, p_correlation_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS trading_day_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'lifecycle_predecessor_not_satisfied: current=%, requested=%',coalesce(v_existing_rank,0),v_state_rank;
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
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

revoke all on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb) to service_role;
-- Preserve the existing invoker trigger function ACL; no privilege elevation.
grant execute on function public.set_updated_at() to public,anon,authenticated,service_role;

create or replace trigger trg_sector_stock_map_updated_at
before update on public.sector_stock_map for each row
execute function public.set_updated_at();
create or replace trigger market_patterns_set_updated_at
before update on public.market_patterns for each row
execute function public.cle_set_updated_at_v1();

commit;
