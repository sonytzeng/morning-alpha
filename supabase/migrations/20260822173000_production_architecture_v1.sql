-- Morning Alpha Production Architecture v1.
-- Additive modular-monolith foundation for 10,000 paid subscribers.
-- Existing report, delivery, monitoring, and continuous-learning contracts remain intact.

create table if not exists public.runtime_quality_policies (
  policy_version text primary key,
  active boolean not null default false,
  premium_publish_min smallint not null check (premium_publish_min between 0 and 100),
  member_value_min smallint not null check (member_value_min between 0 and 100),
  high_quality_min smallint not null check (high_quality_min between 0 and 100),
  publish_min smallint not null check (publish_min between 0 and 100),
  auto_repair_min smallint not null check (auto_repair_min between 0 and 100),
  safe_mode_below smallint not null check (safe_mode_below between 0 and 100),
  abstention_min_confidence smallint not null check (abstention_min_confidence between 0 and 100),
  abstention_min_coverage smallint not null check (abstention_min_coverage between 0 and 100),
  abstention_min_evidence smallint not null check (abstention_min_evidence between 0 and 100),
  daily_ai_call_budget integer not null check (daily_ai_call_budget > 0),
  daily_ai_token_budget integer not null check (daily_ai_token_budget > 0),
  max_recovery_attempts smallint not null check (max_recovery_attempts between 1 and 20),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (premium_publish_min >= publish_min),
  check (publish_min >= auto_repair_min),
  check (high_quality_min >= publish_min),
  check (safe_mode_below <= auto_repair_min)
);

create unique index if not exists runtime_quality_policies_one_active_uidx
  on public.runtime_quality_policies ((active)) where active = true;

insert into public.runtime_quality_policies (
  policy_version,
  active,
  premium_publish_min,
  member_value_min,
  high_quality_min,
  publish_min,
  auto_repair_min,
  safe_mode_below,
  abstention_min_confidence,
  abstention_min_coverage,
  abstention_min_evidence,
  daily_ai_call_budget,
  daily_ai_token_budget,
  max_recovery_attempts,
  metadata
) values (
  'MA_RUNTIME_POLICY_V1',
  true,
  90,
  90,
  90,
  80,
  70,
  70,
  55,
  70,
  3,
  20,
  120000,
  4,
  '{"premium_threshold_intentionally_stricter_than_master_prompt":true}'::jsonb
)
on conflict (policy_version) do update
  set active = excluded.active,
      premium_publish_min = excluded.premium_publish_min,
      member_value_min = excluded.member_value_min,
      high_quality_min = excluded.high_quality_min,
      publish_min = excluded.publish_min,
      auto_repair_min = excluded.auto_repair_min,
      safe_mode_below = excluded.safe_mode_below,
      abstention_min_confidence = excluded.abstention_min_confidence,
      abstention_min_coverage = excluded.abstention_min_coverage,
      abstention_min_evidence = excluded.abstention_min_evidence,
      daily_ai_call_budget = excluded.daily_ai_call_budget,
      daily_ai_token_budget = excluded.daily_ai_token_budget,
      max_recovery_attempts = excluded.max_recovery_attempts,
      metadata = excluded.metadata,
      updated_at = now();

create table if not exists public.market_quotes (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  symbol text not null,
  source_symbol text not null,
  name text not null,
  asset_type text not null check (asset_type in ('equity', 'index', 'future', 'fx', 'rate', 'commodity', 'volatility')),
  market text not null,
  trading_date date not null,
  phase text not null check (phase in ('premarket', 'intraday', 'close', 'manual_backfill')),
  value numeric(22, 8) not null,
  change_value numeric(22, 8),
  change_percent numeric(12, 6),
  captured_at timestamptz not null,
  freshness_status text not null check (freshness_status in ('fresh', 'recent', 'stale', 'provider_returned', 'unavailable', 'unknown')),
  quality_status text not null default 'verified' check (quality_status in ('verified', 'degraded', 'rejected')),
  correlation_id uuid,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  ingested_at timestamptz not null default now(),
  unique (provider, symbol, captured_at, phase)
);

create index if not exists market_quotes_symbol_latest_idx
  on public.market_quotes (symbol, captured_at desc);
create index if not exists market_quotes_trading_phase_idx
  on public.market_quotes (trading_date desc, phase, symbol);
create index if not exists market_quotes_provider_health_idx
  on public.market_quotes (provider, quality_status, captured_at desc);

create table if not exists public.market_indices (
  id uuid primary key default gen_random_uuid(),
  market_quote_id uuid references public.market_quotes(id) on delete set null,
  provider text not null,
  symbol text not null,
  market text not null,
  trading_date date not null,
  phase text not null,
  value numeric(22, 8) not null,
  change_percent numeric(12, 6),
  captured_at timestamptz not null,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  unique (provider, symbol, captured_at, phase)
);

create index if not exists market_indices_symbol_latest_idx
  on public.market_indices (symbol, captured_at desc);

create table if not exists public.futures_snapshots (
  id uuid primary key default gen_random_uuid(),
  market_quote_id uuid references public.market_quotes(id) on delete set null,
  provider text not null,
  symbol text not null,
  contract_code text,
  expiry_date date,
  market text not null,
  trading_date date not null,
  phase text not null,
  value numeric(22, 8) not null,
  change_percent numeric(12, 6),
  open_interest numeric(22, 4),
  captured_at timestamptz not null,
  correlation_id uuid,
  created_at timestamptz not null default now(),
  unique (provider, symbol, captured_at, phase)
);

create index if not exists futures_snapshots_symbol_latest_idx
  on public.futures_snapshots (symbol, captured_at desc);

create table if not exists public.institutional_flows (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  market text not null default 'TW',
  trading_date date not null,
  institution_type text not null,
  symbol text,
  buy_amount numeric(22, 4),
  sell_amount numeric(22, 4),
  net_amount numeric(22, 4) not null,
  currency text not null default 'TWD',
  captured_at timestamptz not null,
  source_ref text not null,
  correlation_id uuid,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (provider, trading_date, institution_type, symbol, captured_at)
);

create index if not exists institutional_flows_date_type_idx
  on public.institutional_flows (trading_date desc, institution_type, symbol);

create table if not exists public.macro_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  title text not null,
  country text,
  event_at timestamptz not null,
  importance smallint not null default 0 check (importance between 0 and 100),
  actual_value text,
  consensus_value text,
  previous_value text,
  surprise_score numeric(7, 4),
  source_ref text not null,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (provider, event_key, event_at)
);

create index if not exists macro_events_event_at_idx
  on public.macro_events (event_at desc, importance desc);

create table if not exists public.news_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text,
  title text not null,
  summary text,
  source_name text not null,
  source_url text not null,
  published_at timestamptz not null,
  event_type text,
  symbols text[] not null default '{}'::text[],
  sectors text[] not null default '{}'::text[],
  freshness_status text not null default 'fresh',
  surprise_score numeric(7, 4),
  taiwan_relevance_score numeric(7, 4),
  fingerprint text not null,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (fingerprint)
);

create index if not exists news_events_published_idx
  on public.news_events (published_at desc);
create index if not exists news_events_symbols_gin_idx
  on public.news_events using gin (symbols);

create table if not exists public.company_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  symbol text not null,
  company_name text,
  event_type text not null,
  title text not null,
  event_at timestamptz not null,
  source_ref text not null,
  significance_score numeric(7, 4),
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (provider, symbol, event_type, event_at, title)
);

create index if not exists company_events_symbol_event_idx
  on public.company_events (symbol, event_at desc);

create table if not exists public.earnings_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  symbol text not null,
  fiscal_period text not null,
  announced_at timestamptz not null,
  revenue_actual numeric(24, 4),
  revenue_consensus numeric(24, 4),
  eps_actual numeric(18, 6),
  eps_consensus numeric(18, 6),
  guidance_direction text,
  surprise_score numeric(7, 4),
  source_ref text not null,
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (provider, symbol, fiscal_period, announced_at)
);

create index if not exists earnings_events_symbol_announced_idx
  on public.earnings_events (symbol, announced_at desc);

create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  trading_date date not null,
  session_type text not null check (session_type in ('PREMARKET', 'OPEN', 'MID_MORNING', 'INTRADAY', 'CLOSE')),
  version integer not null check (version > 0),
  correlation_id uuid,
  market_regime text,
  feature_vector jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_vector) = 'object'),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  data_as_of timestamptz,
  coverage_score numeric(7, 4) check (coverage_score between 0 and 100),
  quality_status text not null check (quality_status in ('complete', 'degraded', 'insufficient', 'provider_failure')),
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (trading_date, session_type, version),
  unique (fingerprint)
);

create index if not exists market_snapshots_date_session_idx
  on public.market_snapshots (trading_date desc, session_type, version desc);
create index if not exists market_snapshots_regime_idx
  on public.market_snapshots (market_regime, trading_date desc);

create table if not exists public.data_provider_health (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  service_date date not null,
  phase text not null,
  status text not null check (status in ('healthy', 'degraded', 'down', 'unknown')),
  success_rate numeric(7, 4) not null check (success_rate between 0 and 100),
  requested_count integer not null default 0 check (requested_count >= 0),
  succeeded_count integer not null default 0 check (succeeded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  latency_ms integer check (latency_ms >= 0),
  timed_out boolean not null default false,
  last_error_code text,
  correlation_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  checked_at timestamptz not null default now(),
  unique (provider, service_date, phase)
);

create index if not exists data_provider_health_status_idx
  on public.data_provider_health (status, checked_at desc);

create table if not exists public.strategy_registry (
  id uuid primary key default gen_random_uuid(),
  strategy_key text not null,
  version integer not null check (version > 0),
  lifecycle text not null
    check (lifecycle in ('candidate', 'shadow', 'production', 'retired', 'rejected', 'rollback')),
  engine_version text not null,
  prompt_version text,
  rule_version text,
  scoring_version text,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  parent_strategy_id uuid references public.strategy_registry(id) on delete set null,
  rollback_target_id uuid references public.strategy_registry(id) on delete set null,
  shadow_sample_size integer not null default 0 check (shadow_sample_size >= 0),
  shadow_accuracy numeric(7, 4),
  backtest_score numeric(7, 4),
  calibration_error numeric(7, 4),
  promoted_by uuid references auth.users(id) on delete set null,
  promotion_reason text,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (strategy_key, version)
);

create unique index if not exists strategy_registry_one_production_uidx
  on public.strategy_registry (strategy_key) where lifecycle = 'production';
create index if not exists strategy_registry_lifecycle_idx
  on public.strategy_registry (lifecycle, strategy_key, version desc);

create table if not exists public.strategy_registry_audit (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategy_registry(id) on delete cascade,
  action text not null,
  from_lifecycle text,
  to_lifecycle text,
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists strategy_registry_audit_strategy_idx
  on public.strategy_registry_audit (strategy_id, created_at desc);

insert into public.strategy_registry (
  strategy_key,
  version,
  lifecycle,
  engine_version,
  prompt_version,
  rule_version,
  scoring_version,
  config,
  promotion_reason,
  promoted_at
) values (
  'morning-alpha-premarket',
  1,
  'production',
  'V9.3_PREMIUM_EVIDENCE_SELF_REPAIR',
  'V9.3_OPENAI_EVIDENCE_GUARDRAILS',
  'CLE_V1.0.0',
  'CONTENT_INTELLIGENCE_V2',
  '{"production_candidate_isolation":true,"premium_publish_min":90}'::jsonb,
  'Initial registry baseline for the already deployed production strategy.',
  now()
)
on conflict (strategy_key, version) do nothing;

create table if not exists public.historical_replay_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategy_registry(id) on delete restrict,
  from_date date not null,
  to_date date not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'degraded', 'failed', 'cancelled')),
  dry_run boolean not null default true,
  idempotency_key text not null unique,
  correlation_id uuid not null,
  total_cases integer not null default 0 check (total_cases >= 0),
  evaluated_cases integer not null default 0 check (evaluated_cases >= 0),
  accuracy numeric(7, 4),
  brier_score numeric(7, 4),
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);

create index if not exists historical_replay_runs_strategy_idx
  on public.historical_replay_runs (strategy_id, created_at desc);

create table if not exists public.historical_replay_results (
  id uuid primary key default gen_random_uuid(),
  replay_run_id uuid not null references public.historical_replay_runs(id) on delete cascade,
  decision_snapshot_id uuid references public.decision_snapshots(id) on delete set null,
  prediction_id uuid references public.learning_predictions(id) on delete set null,
  report_date date not null,
  predicted_direction text,
  actual_direction text,
  confidence_score numeric(7, 4),
  outcome_score numeric(7, 4),
  correct boolean,
  brier_component numeric(7, 4),
  market_regime text,
  reason_codes text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (replay_run_id, report_date, decision_snapshot_id),
  unique (replay_run_id, prediction_id)
);

create index if not exists historical_replay_results_run_date_idx
  on public.historical_replay_results (replay_run_id, report_date);

create table if not exists public.historical_similarity_results (
  id uuid primary key default gen_random_uuid(),
  target_snapshot_id uuid not null references public.decision_snapshots(id) on delete cascade,
  similar_snapshot_id uuid not null references public.decision_snapshots(id) on delete cascade,
  algorithm_version text not null default 'MA_SIMILARITY_V1',
  similarity_score numeric(7, 4) not null check (similarity_score between 0 and 100),
  feature_breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_breakdown) = 'object'),
  outcome_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(outcome_summary) = 'object'),
  created_at timestamptz not null default now(),
  unique (target_snapshot_id, similar_snapshot_id, algorithm_version),
  check (target_snapshot_id <> similar_snapshot_id)
);

create index if not exists historical_similarity_target_score_idx
  on public.historical_similarity_results (target_snapshot_id, similarity_score desc);

create table if not exists public.runtime_control_state (
  environment text primary key,
  safe_mode boolean not null default false,
  reason_codes text[] not null default '{}'::text[],
  activated_at timestamptz,
  expires_at timestamptz,
  activated_by text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  updated_at timestamptz not null default now()
);

insert into public.runtime_control_state (environment, safe_mode, activated_by)
values ('production', false, 'production_architecture_v1')
on conflict (environment) do nothing;

create table if not exists public.runtime_dead_letters (
  id uuid primary key default gen_random_uuid(),
  component text not null,
  operation text not null,
  idempotency_key text not null,
  correlation_id uuid not null,
  attempt integer not null check (attempt > 0),
  max_attempts integer not null check (max_attempts > 0),
  error_code text not null,
  error_message text,
  request_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(request_payload) = 'object'),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  status text not null default 'open' check (status in ('open', 'replayed', 'resolved', 'ignored')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (component, idempotency_key, attempt)
);

create index if not exists runtime_dead_letters_open_idx
  on public.runtime_dead_letters (status, created_at desc) where status = 'open';

create table if not exists public.runtime_cost_usage (
  id uuid primary key default gen_random_uuid(),
  usage_date date not null,
  component text not null,
  provider text not null,
  model text,
  operation text not null,
  idempotency_key text not null unique,
  correlation_id uuid not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer generated always as (input_tokens + output_tokens) stored,
  estimated_cost_usd numeric(14, 8),
  latency_ms integer check (latency_ms >= 0),
  status text not null check (status in ('succeeded', 'degraded', 'failed', 'skipped_budget')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists runtime_cost_usage_date_component_idx
  on public.runtime_cost_usage (usage_date desc, component, provider);

create table if not exists public.runtime_slo_definitions (
  slo_key text primary key,
  description text not null,
  target_percent numeric(7, 4) not null check (target_percent between 0 and 100),
  window_days integer not null check (window_days > 0),
  threshold_ms integer,
  deadline_taipei time,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.runtime_slo_definitions (slo_key, description, target_percent, window_days, threshold_ms, deadline_taipei)
values
  ('premarket_delivery_0730', 'Premium or incident-safe LINE delivery acknowledged by 07:30 Asia/Taipei.', 99.0, 30, null, '07:30'),
  ('report_generation_latency', 'Premarket report generation completes within two minutes.', 99.0, 30, 120000, null),
  ('report_payload_latency', 'Server-trimmed report payload completes within 1500 ms.', 99.5, 30, 1500, null),
  ('closing_verification_completion', 'Closing verification completes on each valid trading day.', 99.0, 30, null, '15:00')
on conflict (slo_key) do nothing;

create table if not exists public.runtime_slo_measurements (
  id uuid primary key default gen_random_uuid(),
  slo_key text not null references public.runtime_slo_definitions(slo_key) on delete restrict,
  measured_at timestamptz not null,
  report_date date,
  correlation_id uuid,
  success boolean not null,
  value numeric(22, 8),
  latency_ms integer,
  reason_codes text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists runtime_slo_measurements_key_time_idx
  on public.runtime_slo_measurements (slo_key, measured_at desc);

alter table public.pipeline_runs
  add column if not exists correlation_id uuid,
  add column if not exists engine_version text,
  add column if not exists safe_mode boolean not null default false,
  add column if not exists duration_ms integer,
  add column if not exists cost_usage_id uuid references public.runtime_cost_usage(id) on delete set null;

create index if not exists pipeline_runs_correlation_idx
  on public.pipeline_runs (correlation_id) where correlation_id is not null;

create table if not exists public.user_market_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  risk_tolerance text not null default 'balanced' check (risk_tolerance in ('conservative', 'balanced', 'aggressive')),
  preferred_sectors text[] not null default '{}'::text[],
  blocked_sectors text[] not null default '{}'::text[],
  preferred_horizons text[] not null default '{intraday}'::text[],
  notification_channels text[] not null default '{line}'::text[],
  quiet_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(quiet_hours) = 'object'),
  personalization_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_market_preferences_enabled_idx
  on public.user_market_preferences (personalization_enabled) where personalization_enabled = true;

create table if not exists public.growth_events_v2 (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  anonymous_id text,
  session_id text,
  event_name text not null,
  funnel_stage text,
  report_date date,
  page_path text,
  idempotency_key text not null unique,
  event_taxonomy_version text not null default 'MA_GROWTH_V1',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (actor_id is not null or anonymous_id is not null)
);

create index if not exists growth_events_v2_event_time_idx
  on public.growth_events_v2 (event_name, occurred_at desc);
create index if not exists growth_events_v2_funnel_time_idx
  on public.growth_events_v2 (funnel_stage, occurred_at desc) where funnel_stage is not null;

create or replace function public.get_active_runtime_quality_policy_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(policy) - 'created_at' - 'updated_at'
  from public.runtime_quality_policies as policy
  where policy.active = true
  limit 1;
$$;

create or replace function public.check_runtime_cost_budget_v1(p_usage_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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

create or replace function public.record_runtime_cost_usage_v1(
  p_usage_date date,
  p_component text,
  p_provider text,
  p_model text,
  p_operation text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer,
  p_status text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.publish_decision_snapshot_v3(
  p_report_date date,
  p_session_type text,
  p_report_id uuid,
  p_payload jsonb,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_attempt integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_research_session_id uuid;
  v_policy public.runtime_quality_policies%rowtype;
  v_score numeric;
  v_pipeline_status text;
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

  select research_session_id into v_research_session_id
  from public.decision_snapshots
  where id = v_snapshot_id;

  v_score := nullif(p_payload ->> 'content_score', '')::numeric;
  v_pipeline_status := case
    when coalesce((p_payload ->> 'safe_mode')::boolean, false) then 'DEGRADED'
    when p_payload ->> 'decision_mode' = 'blocked' then 'DEGRADED'
    when v_score >= v_policy.premium_publish_min then 'SUCCEEDED'
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

create or replace function public.promote_strategy_v1(
  p_strategy_id uuid,
  p_admin_id uuid,
  p_reason text
)
returns public.strategy_registry
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.enqueue_runtime_dead_letter_v1(
  p_component text,
  p_operation text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_attempt integer,
  p_max_attempts integer,
  p_error_code text,
  p_error_message text,
  p_request_payload jsonb default '{}'::jsonb,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- Keep the database fail-closed gates aligned with the single active policy.
-- Function names are retained so the triggers installed by the delivery
-- guarantee migration continue to work without a destructive replacement.
create or replace function public.enforce_decision_snapshot_premium_90_gate_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_premium_min numeric := 90;
  v_auto_repair_min numeric := 70;
begin
  select policy.premium_publish_min, policy.auto_repair_min
    into v_premium_min, v_auto_repair_min
  from public.runtime_quality_policies as policy
  where policy.active = true
  limit 1;

  if new.session_type = 'PREMARKET'
    and (
      new.content_score is null
      or new.content_score < coalesce(v_premium_min, 90)
      or coalesce(new.decision_mode, 'blocked') not in ('recommendations', 'no_trade')
    )
  then
    new.status := case
      when coalesce(new.content_score, 0) >= coalesce(v_auto_repair_min, 70) then 'PARTIAL'
      else 'INSUFFICIENT_DATA'
    end;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_editorial_review_premium_90_gate_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
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

-- All production architecture tables are private by default. Personalized
-- preferences are the sole direct client table and remain owner-scoped.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'runtime_quality_policies',
    'market_quotes',
    'market_indices',
    'futures_snapshots',
    'institutional_flows',
    'macro_events',
    'news_events',
    'company_events',
    'earnings_events',
    'market_snapshots',
    'data_provider_health',
    'strategy_registry',
    'strategy_registry_audit',
    'historical_replay_runs',
    'historical_replay_results',
    'historical_similarity_results',
    'runtime_control_state',
    'runtime_dead_letters',
    'runtime_cost_usage',
    'runtime_slo_definitions',
    'runtime_slo_measurements',
    'user_market_preferences',
    'growth_events_v2'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$$;

grant select, insert, update, delete on table public.user_market_preferences to authenticated;

drop policy if exists user_market_preferences_owner_select on public.user_market_preferences;
create policy user_market_preferences_owner_select
  on public.user_market_preferences
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_market_preferences_owner_insert on public.user_market_preferences;
create policy user_market_preferences_owner_insert
  on public.user_market_preferences
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_market_preferences_owner_update on public.user_market_preferences;
create policy user_market_preferences_owner_update
  on public.user_market_preferences
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_market_preferences_owner_delete on public.user_market_preferences;
create policy user_market_preferences_owner_delete
  on public.user_market_preferences
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on function public.get_active_runtime_quality_policy_v1() from public, anon, authenticated;
revoke all on function public.check_runtime_cost_budget_v1(date) from public, anon, authenticated;
revoke all on function public.record_runtime_cost_usage_v1(date, text, text, text, text, text, uuid, integer, integer, integer, text, jsonb) from public, anon, authenticated;
revoke all on function public.publish_decision_snapshot_v3(date, text, uuid, jsonb, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.promote_strategy_v1(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.enqueue_runtime_dead_letter_v1(text, text, text, uuid, integer, integer, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.enforce_decision_snapshot_premium_90_gate_v1() from public, anon, authenticated;
revoke all on function public.enforce_editorial_review_premium_90_gate_v1() from public, anon, authenticated;

grant execute on function public.get_active_runtime_quality_policy_v1() to service_role;
grant execute on function public.check_runtime_cost_budget_v1(date) to service_role;
grant execute on function public.record_runtime_cost_usage_v1(date, text, text, text, text, text, uuid, integer, integer, integer, text, jsonb) to service_role;
grant execute on function public.publish_decision_snapshot_v3(date, text, uuid, jsonb, uuid, text, integer) to service_role;
grant execute on function public.promote_strategy_v1(uuid, uuid, text) to service_role;
grant execute on function public.enqueue_runtime_dead_letter_v1(text, text, text, uuid, integer, integer, text, text, jsonb, jsonb) to service_role;

comment on table public.runtime_quality_policies is 'Single source of truth for production content, abstention, cost, and recovery thresholds.';
comment on table public.market_quotes is 'Canonical append-only provider quote contract. Legacy market_data writes remain during dual-write migration.';
comment on table public.strategy_registry is 'Candidate, shadow, production, and rollback lifecycle for versioned Morning Alpha strategies.';
comment on table public.runtime_dead_letters is 'Idempotent terminal failure queue for allowlisted safe recovery.';
comment on table public.runtime_cost_usage is 'Per-call AI usage ledger used by fail-closed daily cost guardrails.';
comment on table public.user_market_preferences is 'Opt-in, user-owned market personalization preferences protected by RLS.';
comment on table public.ma_ops_recovery_actions is 'Audited allowlisted recovery requests. Execution is limited to the ma-ops-safe-recovery service function.';
