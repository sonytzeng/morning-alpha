-- Synthetic, empty dependency scaffold for the additive Phase 1 migration.
-- Exact names/types consumed by the candidate; NOT a full historical schema replay.
do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
    nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.profiles(id uuid primary key,role text not null);
create table public.decision_snapshots(id uuid primary key,report_date date not null,version integer not null,
  snapshot_fingerprint text,generated_text jsonb not null,created_at timestamptz not null);
create table public.learning_rules(id uuid primary key);
create table public.learning_predictions(id uuid primary key,decision_snapshot_id uuid references public.decision_snapshots,
  report_date date not null,prediction_at timestamptz not null,record_status text not null);
create table public.prediction_outcomes(id uuid primary key,prediction_id uuid references public.learning_predictions,
  horizon text,target_date date,evaluated_at timestamptz,status text,data_quality_status text,direction_correct boolean,
  return_percent numeric,max_favorable_excursion numeric,max_adverse_excursion numeric,source_refs jsonb);
grant select on public.profiles,public.decision_snapshots,public.learning_rules,public.learning_predictions,public.prediction_outcomes to service_role;
create publication supabase_realtime;
