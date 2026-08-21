-- Morning Alpha Content Intelligence v2 foundation.
-- This migration is additive, idempotent, and keeps every publish decision auditable.

create table if not exists public.research_sessions (
  id uuid primary key default gen_random_uuid(),
  trading_date date not null,
  session_type text not null
    check (session_type in ('PREMARKET', 'OPEN', 'MID_MORNING', 'INTRADAY', 'CLOSE')),
  version integer not null default 1 check (version > 0),
  status text not null default 'COLLECTING'
    check (status in ('COLLECTING', 'READY', 'DEGRADED', 'REJECTED', 'PUBLISHED', 'VERIFIED', 'FAILED')),
  report_mode text,
  market_status text,
  is_trading_day boolean,
  data_as_of timestamptz,
  generated_at timestamptz not null default now(),
  engine_version text,
  idempotency_key text not null,
  input_coverage jsonb not null default '{}'::jsonb,
  missing_sources text[] not null default '{}'::text[],
  reason_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (trading_date, session_type, version),
  unique (idempotency_key)
);

create index if not exists research_sessions_date_session_idx
  on public.research_sessions (trading_date desc, session_type, version desc);
create index if not exists research_sessions_status_idx
  on public.research_sessions (status, generated_at desc);

create table if not exists public.research_facts (
  id uuid primary key default gen_random_uuid(),
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  fact_type text not null,
  subject text not null,
  value_json jsonb not null,
  source_refs jsonb not null,
  observed_at timestamptz not null,
  freshness_status text not null
    check (freshness_status in ('FRESH', 'STALE', 'UNAVAILABLE', 'UNVERIFIED')),
  confidence_score numeric(5, 2) not null check (confidence_score between 0 and 100),
  fingerprint text not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(source_refs) = 'array' and jsonb_array_length(source_refs) > 0),
  unique (research_session_id, fingerprint)
);

create index if not exists research_facts_session_idx
  on public.research_facts (research_session_id, observed_at desc);
create index if not exists research_facts_type_subject_idx
  on public.research_facts (fact_type, subject);

create table if not exists public.research_catalysts (
  id uuid primary key default gen_random_uuid(),
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  title text not null,
  summary text not null,
  event_at timestamptz not null,
  source_refs jsonb not null,
  freshness_score numeric(5, 2) not null check (freshness_score between 0 and 25),
  surprise_score numeric(5, 2) not null check (surprise_score between 0 and 25),
  impact_score numeric(5, 2) not null check (impact_score between 0 and 20),
  taiwan_relevance_score numeric(5, 2) not null check (taiwan_relevance_score between 0 and 20),
  tradability_score numeric(5, 2) not null check (tradability_score between 0 and 10),
  weighted_score numeric(5, 2) generated always as (
    freshness_score + surprise_score + impact_score + taiwan_relevance_score + tradability_score
  ) stored,
  status text not null default 'CANDIDATE'
    check (status in ('CANDIDATE', 'QUALIFIED', 'REJECTED', 'EXPIRED')),
  reason_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  check (jsonb_typeof(source_refs) = 'array' and jsonb_array_length(source_refs) > 0)
);

create index if not exists research_catalysts_session_score_idx
  on public.research_catalysts (research_session_id, weighted_score desc);

create table if not exists public.catalyst_tw_mappings (
  id uuid primary key default gen_random_uuid(),
  catalyst_id uuid not null references public.research_catalysts(id) on delete cascade,
  stock_symbol text not null,
  company_name text not null,
  sector text not null,
  mapping_strength text not null
    check (mapping_strength in ('DIRECT', 'INDIRECT', 'THEMATIC', 'WEAK')),
  transmission_path text not null,
  taiwan_supply_chain_relation text not null,
  confirmation_condition text not null,
  invalidation_condition text not null,
  source_refs jsonb not null,
  confidence_score numeric(5, 2) not null check (confidence_score between 0 and 100),
  actionable boolean not null default false,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(source_refs) = 'array' and jsonb_array_length(source_refs) > 0),
  check (
    actionable = false
    or (mapping_strength in ('DIRECT', 'INDIRECT') and confidence_score >= 70)
  ),
  unique (catalyst_id, stock_symbol)
);

create index if not exists catalyst_tw_mappings_stock_idx
  on public.catalyst_tw_mappings (stock_symbol, actionable, confidence_score desc);

alter table public.decision_snapshots
  add column if not exists research_session_id uuid references public.research_sessions(id) on delete set null,
  add column if not exists report_id uuid references public.reports(id) on delete set null,
  add column if not exists snapshot_fingerprint text,
  add column if not exists decision_mode text,
  add column if not exists content_score numeric(5, 2),
  add column if not exists content_grade text,
  add column if not exists content_score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists reason_codes text[] not null default '{}'::text[],
  add column if not exists generic_content_flags text[] not null default '{}'::text[];

create unique index if not exists decision_snapshots_content_fingerprint_uidx
  on public.decision_snapshots (report_date, session_type, snapshot_fingerprint)
  where snapshot_fingerprint is not null;
create index if not exists decision_snapshots_research_session_idx
  on public.decision_snapshots (research_session_id);
create index if not exists decision_snapshots_report_id_idx
  on public.decision_snapshots (report_id);

create table if not exists public.editorial_reviews (
  id uuid primary key default gen_random_uuid(),
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  decision_snapshot_id uuid references public.decision_snapshots(id) on delete set null,
  review_status text not null
    check (review_status in ('PENDING', 'APPROVED', 'DEGRADED', 'REJECTED')),
  content_score numeric(5, 2) not null check (content_score between 0 and 100),
  content_score_breakdown jsonb not null,
  reason_codes text[] not null default '{}'::text[],
  generic_content_flags text[] not null default '{}'::text[],
  reviewed_by text not null default 'content_intelligence_v2',
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists editorial_reviews_session_idx
  on public.editorial_reviews (research_session_id, reviewed_at desc);
create index if not exists editorial_reviews_status_idx
  on public.editorial_reviews (review_status, reviewed_at desc);

create table if not exists public.content_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  report_date date not null,
  decision_snapshot_id uuid references public.decision_snapshots(id) on delete set null,
  feedback_type text not null
    check (feedback_type in ('HELPFUL', 'NOT_HELPFUL', 'TOO_GENERIC', 'TOO_LATE', 'ACTED_ON', 'OTHER')),
  rating smallint check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_feedback_report_idx
  on public.content_feedback (report_date desc, created_at desc);
create index if not exists content_feedback_snapshot_idx
  on public.content_feedback (decision_snapshot_id);
create index if not exists content_feedback_user_idx
  on public.content_feedback (user_id, created_at desc);

create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  research_session_id uuid references public.research_sessions(id) on delete set null,
  trading_date date not null,
  checkpoint text not null
    check (checkpoint in ('PREMARKET', 'OPEN', 'MID_MORNING', 'INTRADAY', 'CLOSE')),
  idempotency_key text not null unique,
  status text not null
    check (status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEGRADED', 'FAILED', 'SKIPPED')),
  attempt integer not null default 1 check (attempt > 0),
  started_at timestamptz,
  completed_at timestamptz,
  next_retry_at timestamptz,
  provider_status jsonb not null default '{}'::jsonb,
  reason_codes text[] not null default '{}'::text[],
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_runs_date_checkpoint_idx
  on public.pipeline_runs (trading_date desc, checkpoint, created_at desc);
create index if not exists pipeline_runs_status_retry_idx
  on public.pipeline_runs (status, next_retry_at)
  where status in ('QUEUED', 'RUNNING', 'DEGRADED', 'FAILED');

alter table public.research_sessions enable row level security;
alter table public.research_facts enable row level security;
alter table public.research_catalysts enable row level security;
alter table public.catalyst_tw_mappings enable row level security;
alter table public.decision_snapshots enable row level security;
alter table public.editorial_reviews enable row level security;
alter table public.content_feedback enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.intraday_checks enable row level security;
alter table public.market_data_snapshots enable row level security;

revoke all on table public.research_sessions from anon, authenticated;
revoke all on table public.research_facts from anon, authenticated;
revoke all on table public.research_catalysts from anon, authenticated;
revoke all on table public.catalyst_tw_mappings from anon, authenticated;
revoke all on table public.decision_snapshots from anon, authenticated;
revoke all on table public.editorial_reviews from anon, authenticated;
revoke all on table public.pipeline_runs from anon, authenticated;
revoke all on table public.market_data_snapshots from anon, authenticated;
revoke all on table public.intraday_checks from anon, authenticated;
revoke all on table public.content_feedback from anon, authenticated;

grant all on table public.research_sessions to service_role;
grant all on table public.research_facts to service_role;
grant all on table public.research_catalysts to service_role;
grant all on table public.catalyst_tw_mappings to service_role;
grant all on table public.decision_snapshots to service_role;
grant all on table public.editorial_reviews to service_role;
grant all on table public.content_feedback to service_role;
grant all on table public.pipeline_runs to service_role;
grant all on table public.intraday_checks to service_role;
grant all on table public.market_data_snapshots to service_role;

drop policy if exists decision_snapshots_public_read_current on public.decision_snapshots;

drop policy if exists intraday_checks_public_read on public.intraday_checks;
create policy intraday_checks_public_read
  on public.intraday_checks
  for select
  to anon, authenticated
  using (true);
grant select on table public.intraday_checks to anon, authenticated;

drop policy if exists content_feedback_read_own on public.content_feedback;
create policy content_feedback_read_own
  on public.content_feedback
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists content_feedback_insert_own on public.content_feedback;
create policy content_feedback_insert_own
  on public.content_feedback
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));
grant select, insert on table public.content_feedback to authenticated;

-- Direct report writes must never be available to a browser role.
revoke insert, update, delete, truncate, references, trigger
  on table public.reports from anon, authenticated;

-- Paid and public report delivery goes through get-report-payload. Keep the
-- underlying reports table available only to signed-in administrators and the
-- service role so provider payloads and internal research fields cannot leak.
drop policy if exists reports_authenticated_read_temporary on public.reports;
drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read
  on public.reports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and lower(coalesce(profiles.role, '')) = 'admin'
    )
  );
revoke select on table public.reports from anon, authenticated;
grant select on table public.reports to authenticated;

-- Remove provider payloads and internal reasoning from direct public access.
create or replace view public.public_decision_snapshots_v2
with (security_invoker = true)
as
select
  id,
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
from public.decision_snapshots;

revoke all on table public.public_decision_snapshots_v2 from anon, authenticated;
grant select on table public.public_decision_snapshots_v2 to service_role;

do $$
begin
  if to_regclass('public.v_sector_stock_map_active') is not null then
    execute 'alter view public.v_sector_stock_map_active set (security_invoker = true)';
  end if;
  if to_regclass('public.v_today_sector_rotation') is not null then
    execute 'alter view public.v_today_sector_rotation set (security_invoker = true)';
  end if;
  if to_regprocedure('public.set_updated_at()') is not null then
    execute 'alter function public.set_updated_at() set search_path = public';
  end if;
end;
$$;

create or replace function public.publish_decision_snapshot_v2(
  p_report_date date,
  p_session_type text,
  p_report_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if p_report_date is null then
    raise exception 'report_date is required';
  end if;
  if p_session_type not in ('PREMARKET', 'OPEN', 'MID_MORNING', 'INTRADAY', 'CLOSE') then
    raise exception 'invalid session_type: %', p_session_type;
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;

  perform pg_advisory_xact_lock(hashtext(concat(p_report_date::text, ':', p_session_type)));

  v_fingerprint := md5(p_payload::text);
  v_content_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_content_grade := coalesce(nullif(p_payload ->> 'content_grade', ''), 'reject');
  v_status := case
    when p_session_type = 'CLOSE' then 'FINAL'
    when p_payload ->> 'decision_mode' = 'blocked' then 'INSUFFICIENT_DATA'
    when v_content_score >= 80 then 'READY'
    when v_content_score >= 70 then 'PARTIAL'
    else 'INSUFFICIENT_DATA'
  end;

  select *
    into v_previous
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = p_session_type
    and is_current = true
  for update;

  if found and v_previous.snapshot_fingerprint = v_fingerprint then
    return v_previous.id;
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
  from public.decision_snapshots
  where report_date = p_report_date
    and session_type = p_session_type;

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
    p_session_type,
    v_version,
    case
      when p_session_type = 'CLOSE' then 'VERIFIED'
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
    concat(p_report_date::text, ':', p_session_type, ':', v_fingerprint),
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
    p_session_type,
    v_version,
    concat(p_report_date::text, ':', p_session_type, ':', v_fingerprint),
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

  if p_session_type = 'PREMARKET' then
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

revoke all on function public.publish_decision_snapshot_v2(date, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_decision_snapshot_v2(date, text, uuid, jsonb)
  to service_role;

comment on function public.publish_decision_snapshot_v2(date, text, uuid, jsonb) is
  'Idempotently publishes one immutable canonical decision revision and its editorial audit record.';
