-- Morning Alpha Continuous Learning Engine v1
--
-- Additive only. The existing decision_snapshots table remains the canonical
-- report/session snapshot. learning_predictions normalizes each market or
-- beneficiary call into an append-only, outcome-addressable prediction item.

create table if not exists public.learning_predictions (
  id uuid primary key default gen_random_uuid(),
  decision_snapshot_id uuid references public.decision_snapshots(id) on delete restrict,
  report_id uuid references public.reports(id) on delete restrict,
  root_prediction_id uuid references public.learning_predictions(id) on delete restrict,
  supersedes_prediction_id uuid references public.learning_predictions(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  idempotency_key text not null unique,
  report_date date not null,
  prediction_at timestamptz not null,
  analysis_window text not null
    check (analysis_window in ('PREMARKET', 'OPEN', 'MID_MORNING', 'INTRADAY', 'CLOSE')),
  prediction_scope text not null
    check (prediction_scope in ('market', 'sector', 'symbol')),
  symbol text not null,
  asset_name text,
  market text not null default 'TW',
  sector text,
  event_id text,
  thesis text not null,
  direction text not null check (direction in ('bullish', 'bearish', 'neutral')),
  model_confidence numeric(5, 2) check (model_confidence between 0 and 100),
  calibrated_confidence numeric(5, 2) check (calibrated_confidence between 0 and 100),
  calibration_adjustment numeric(5, 2) not null default 0
    check (calibration_adjustment between -25 and 25),
  evidence_score numeric(5, 2) check (evidence_score between 0 and 100),
  catalyst_score numeric(5, 2) check (catalyst_score between 0 and 100),
  surprise_score numeric(5, 2) check (surprise_score between 0 and 100),
  taiwan_mapping_score numeric(5, 2) check (taiwan_mapping_score between 0 and 100),
  price_in_score numeric(5, 2) check (price_in_score between 0 and 100),
  risk_score numeric(5, 2) check (risk_score between 0 and 100),
  expected_horizon text not null,
  source_refs jsonb not null default '[]'::jsonb,
  price_at_prediction numeric,
  benchmark_symbol text not null default 'TAIEX',
  benchmark_price_at_prediction numeric,
  sector_benchmark_symbol text,
  sector_benchmark_price_at_prediction numeric,
  model_version text,
  prompt_version text,
  rule_version text,
  scoring_version text,
  data_version text,
  data_snapshot jsonb not null default '{}'::jsonb,
  data_quality_status text not null
    check (data_quality_status in (
      'complete', 'degraded', 'insufficient_data', 'provider_failure',
      'stale_data', 'incomplete_market_session', 'invalid_prediction'
    )),
  record_status text not null default 'valid'
    check (record_status in ('valid', 'invalid')),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(source_refs) = 'array'),
  check (jsonb_typeof(data_snapshot) = 'object'),
  check (
    (revision = 1 and root_prediction_id is null and supersedes_prediction_id is null)
    or (revision > 1 and root_prediction_id is not null and supersedes_prediction_id is not null)
  )
);

create index if not exists learning_predictions_report_window_idx
  on public.learning_predictions (report_date desc, analysis_window, created_at desc);
create index if not exists learning_predictions_symbol_date_idx
  on public.learning_predictions (symbol, report_date desc);
create index if not exists learning_predictions_decision_snapshot_idx
  on public.learning_predictions (decision_snapshot_id);
create index if not exists learning_predictions_report_id_idx
  on public.learning_predictions (report_id);
create index if not exists learning_predictions_root_revision_idx
  on public.learning_predictions (root_prediction_id, revision desc)
  where root_prediction_id is not null;
create index if not exists learning_predictions_supersedes_idx
  on public.learning_predictions (supersedes_prediction_id)
  where supersedes_prediction_id is not null;
create index if not exists learning_predictions_calibration_idx
  on public.learning_predictions (model_version, report_date desc, model_confidence);

create table if not exists public.prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.learning_predictions(id) on delete restrict,
  horizon text not null check (horizon in ('intraday', 'close', '1D', '3D', '5D', '10D', '20D')),
  target_session integer not null check (target_session >= 0),
  target_date date,
  evaluated_at timestamptz,
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
  outcome_direction text check (outcome_direction is null or outcome_direction in ('up', 'down', 'flat')),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'inconclusive', 'insufficient_data', 'provider_failure', 'stale_data')),
  data_quality_status text not null default 'insufficient_data'
    check (data_quality_status in (
      'complete', 'degraded', 'insufficient_data', 'provider_failure',
      'stale_data', 'incomplete_market_session', 'invalid_prediction'
    )),
  source_refs jsonb not null default '[]'::jsonb,
  failure_reason text,
  outcome_version text not null default 'CLE_OUTCOME_V1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(source_refs) = 'array'),
  unique (prediction_id, horizon)
);

create index if not exists prediction_outcomes_status_target_idx
  on public.prediction_outcomes (status, target_date, horizon);
create index if not exists prediction_outcomes_prediction_idx
  on public.prediction_outcomes (prediction_id, horizon);

create table if not exists public.prediction_reviews (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.learning_predictions(id) on delete restrict,
  outcome_id uuid references public.prediction_outcomes(id) on delete restrict,
  review_date date not null,
  review_version text not null default 'CLE_REVIEW_V1',
  idempotency_key text not null unique,
  review_result text not null check (review_result in ('correct', 'incorrect', 'partial', 'inconclusive')),
  direction_accuracy text not null check (direction_accuracy in ('correct', 'incorrect', 'inconclusive')),
  timing_accuracy text not null check (timing_accuracy in ('correct', 'incorrect', 'inconclusive')),
  catalyst_accuracy text not null check (catalyst_accuracy in ('correct', 'incorrect', 'unverified')),
  surprise_accuracy text not null check (surprise_accuracy in ('correct', 'incorrect', 'unverified')),
  taiwan_mapping_accuracy text not null check (taiwan_mapping_accuracy in ('correct', 'incorrect', 'not_applicable', 'unverified')),
  price_in_accuracy text not null check (price_in_accuracy in ('correct', 'incorrect', 'unverified')),
  error_type text,
  root_cause text,
  missed_signal text,
  false_signal text,
  confidence_error numeric(6, 2),
  lesson text not null,
  rule_candidate jsonb not null default '{}'::jsonb,
  review_evidence jsonb not null default '{}'::jsonb,
  learning_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(rule_candidate) = 'object'),
  check (jsonb_typeof(review_evidence) = 'object')
);

create index if not exists prediction_reviews_date_result_idx
  on public.prediction_reviews (review_date desc, review_result);
create index if not exists prediction_reviews_prediction_idx
  on public.prediction_reviews (prediction_id, created_at desc);
create index if not exists prediction_reviews_outcome_idx
  on public.prediction_reviews (outcome_id)
  where outcome_id is not null;
create index if not exists prediction_reviews_error_idx
  on public.prediction_reviews (error_type, review_date desc)
  where learning_eligible = true and error_type is not null;

create table if not exists public.learning_cases (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.learning_predictions(id) on delete restrict,
  prediction_review_id uuid not null references public.prediction_reviews(id) on delete restrict,
  case_type text not null check (case_type in ('error', 'success')),
  case_signature text not null,
  title text not null,
  root_cause text,
  lesson text not null,
  effective_evidence jsonb not null default '[]'::jsonb,
  missed_signals jsonb not null default '[]'::jsonb,
  false_signals jsonb not null default '[]'::jsonb,
  pattern_dimensions jsonb not null default '{}'::jsonb,
  market_regime text,
  confidence_bucket text,
  status text not null default 'active' check (status in ('active', 'archived', 'invalid')),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(effective_evidence) = 'array'),
  check (jsonb_typeof(missed_signals) = 'array'),
  check (jsonb_typeof(false_signals) = 'array'),
  check (jsonb_typeof(pattern_dimensions) = 'object'),
  unique (prediction_review_id, case_type)
);

create index if not exists learning_cases_signature_idx
  on public.learning_cases (case_signature, case_type, created_at desc);
create index if not exists learning_cases_prediction_idx
  on public.learning_cases (prediction_id, created_at desc);
create index if not exists learning_cases_regime_idx
  on public.learning_cases (market_regime, case_type, created_at desc);

create table if not exists public.market_patterns (
  id uuid primary key default gen_random_uuid(),
  pattern_key text not null unique,
  pattern_version text not null default 'CLE_PATTERN_V1',
  dimensions jsonb not null,
  sample_size integer not null default 0 check (sample_size >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  inconclusive_count integer not null default 0 check (inconclusive_count >= 0),
  follow_through_rate numeric(7, 4),
  average_return numeric,
  average_abnormal_return numeric,
  average_confidence numeric(5, 2),
  calibration_gap numeric(6, 2),
  first_seen_date date,
  last_seen_date date,
  last_evaluated_at timestamptz,
  statistics jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'insufficient_sample', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(dimensions) = 'object'),
  check (jsonb_typeof(statistics) = 'object')
);

create index if not exists market_patterns_status_sample_idx
  on public.market_patterns (status, sample_size desc, last_seen_date desc);

create table if not exists public.learning_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  name text not null,
  hypothesis text not null,
  condition_json jsonb not null,
  action_json jsonb not null,
  source_pattern_id uuid references public.market_patterns(id) on delete set null,
  minimum_sample_size integer not null default 20 check (minimum_sample_size >= 10),
  status text not null default 'candidate'
    check (status in ('candidate', 'backtesting', 'eligible_shadow', 'shadow', 'rejected', 'production', 'archived')),
  version integer not null default 1 check (version > 0),
  shadow_started_at timestamptz,
  shadow_completed_at timestamptz,
  shadow_sample_size integer not null default 0 check (shadow_sample_size >= 0),
  shadow_accuracy numeric(7, 4),
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamptz,
  promotion_reason text,
  promotion_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(condition_json) = 'object'),
  check (jsonb_typeof(action_json) = 'object'),
  check (jsonb_typeof(promotion_evidence) = 'object')
);

create index if not exists learning_rules_status_idx
  on public.learning_rules (status, updated_at desc);
create index if not exists learning_rules_source_pattern_idx
  on public.learning_rules (source_pattern_id)
  where source_pattern_id is not null;
create index if not exists learning_rules_promoted_by_idx
  on public.learning_rules (promoted_by)
  where promoted_by is not null;

create table if not exists public.rule_backtests (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.learning_rules(id) on delete restrict,
  backtest_version text not null default 'CLE_BACKTEST_V1',
  idempotency_key text not null unique,
  training_start date,
  training_end date,
  out_of_sample_start date,
  out_of_sample_end date,
  in_sample_size integer not null default 0 check (in_sample_size >= 0),
  out_of_sample_size integer not null default 0 check (out_of_sample_size >= 0),
  baseline_accuracy numeric(7, 4),
  candidate_accuracy numeric(7, 4),
  baseline_calibration_error numeric(7, 4),
  candidate_calibration_error numeric(7, 4),
  regression_failures jsonb not null default '[]'::jsonb,
  market_regime_results jsonb not null default '{}'::jsonb,
  status text not null
    check (status in ('running', 'passed', 'failed', 'insufficient_sample')),
  result_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(regression_failures) = 'array'),
  check (jsonb_typeof(market_regime_results) = 'object'),
  check (jsonb_typeof(result_json) = 'object')
);

create index if not exists rule_backtests_rule_status_idx
  on public.rule_backtests (rule_id, status, created_at desc);

create table if not exists public.model_evaluations (
  id uuid primary key default gen_random_uuid(),
  evaluation_key text not null unique,
  evaluation_version text not null default 'CLE_EVALUATION_V1',
  model_version text,
  prompt_version text,
  rule_version text,
  period_start date not null,
  period_end date not null,
  window_days integer not null check (window_days in (30, 90)),
  confidence_bucket text not null,
  sample_size integer not null default 0 check (sample_size >= 0),
  accuracy numeric(7, 4),
  precision_score numeric(7, 4),
  brier_score numeric(7, 4),
  calibration_gap numeric(7, 4),
  taiwan_mapping_accuracy numeric(7, 4),
  price_in_error_rate numeric(7, 4),
  false_positive_rate numeric(7, 4),
  data_completeness_rate numeric(7, 4),
  metrics jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metrics) = 'object')
);

create index if not exists model_evaluations_lookup_idx
  on public.model_evaluations (model_version, window_days, confidence_bucket, period_end desc);

create table if not exists public.learning_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  run_type text not null check (run_type in ('daily', 'backfill', 'recompute', 'shadow')),
  idempotency_key text not null unique,
  engine_version text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'degraded', 'failed', 'skipped')),
  predictions_processed integer not null default 0 check (predictions_processed >= 0),
  outcomes_updated integer not null default 0 check (outcomes_updated >= 0),
  reviews_created integer not null default 0 check (reviews_created >= 0),
  cases_created integer not null default 0 check (cases_created >= 0),
  patterns_updated integer not null default 0 check (patterns_updated >= 0),
  rules_evaluated integer not null default 0 check (rules_evaluated >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(errors) = 'array'),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists learning_runs_date_status_idx
  on public.learning_runs (run_date desc, status, started_at desc);

create table if not exists public.learning_audit_logs (
  id uuid primary key default gen_random_uuid(),
  learning_run_id uuid references public.learning_runs(id) on delete set null,
  idempotency_key text unique,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_type text not null check (actor_type in ('system', 'admin', 'migration')),
  actor_id uuid references auth.users(id) on delete set null,
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(before_json) = 'object'),
  check (jsonb_typeof(after_json) = 'object')
);

create index if not exists learning_audit_logs_entity_idx
  on public.learning_audit_logs (entity_type, entity_id, created_at desc);
create index if not exists learning_audit_logs_run_idx
  on public.learning_audit_logs (learning_run_id, created_at desc);
create index if not exists learning_audit_logs_actor_idx
  on public.learning_audit_logs (actor_id, created_at desc)
  where actor_id is not null;

create or replace function public.cle_set_updated_at_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function public.cle_prevent_prediction_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'learning_predictions are append-only; create a revision instead'
    using errcode = '55000';
end;
$$;

create or replace function public.cle_prevent_audit_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'learning_audit_logs are append-only'
    using errcode = '55000';
end;
$$;

create or replace function public.cle_guard_rule_promotion_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
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

create or replace function public.promote_learning_rule_v1(
  p_rule_id uuid,
  p_admin_id uuid,
  p_reason text
)
returns public.learning_rules
language plpgsql
security invoker
set search_path = ''
as $$
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

create or replace function public.cle_audit_rule_change_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
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

drop trigger if exists learning_predictions_append_only on public.learning_predictions;
create trigger learning_predictions_append_only
before update or delete on public.learning_predictions
for each row execute function public.cle_prevent_prediction_mutation_v1();

drop trigger if exists learning_audit_logs_append_only on public.learning_audit_logs;
create trigger learning_audit_logs_append_only
before update or delete on public.learning_audit_logs
for each row execute function public.cle_prevent_audit_mutation_v1();

drop trigger if exists prediction_outcomes_set_updated_at on public.prediction_outcomes;
create trigger prediction_outcomes_set_updated_at
before update on public.prediction_outcomes
for each row execute function public.cle_set_updated_at_v1();

drop trigger if exists market_patterns_set_updated_at on public.market_patterns;
create trigger market_patterns_set_updated_at
before update on public.market_patterns
for each row execute function public.cle_set_updated_at_v1();

drop trigger if exists learning_rules_guard_promotion on public.learning_rules;
create trigger learning_rules_guard_promotion
before update on public.learning_rules
for each row execute function public.cle_guard_rule_promotion_v1();

drop trigger if exists learning_rules_set_updated_at on public.learning_rules;
create trigger learning_rules_set_updated_at
before update on public.learning_rules
for each row execute function public.cle_set_updated_at_v1();

drop trigger if exists learning_rules_audit_change on public.learning_rules;
create trigger learning_rules_audit_change
after update on public.learning_rules
for each row execute function public.cle_audit_rule_change_v1();

drop trigger if exists learning_runs_set_updated_at on public.learning_runs;
create trigger learning_runs_set_updated_at
before update on public.learning_runs
for each row execute function public.cle_set_updated_at_v1();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'learning_predictions',
    'prediction_outcomes',
    'prediction_reviews',
    'learning_cases',
    'market_patterns',
    'learning_rules',
    'rule_backtests',
    'model_evaluations',
    'learning_runs',
    'learning_audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all on function public.cle_set_updated_at_v1() from public, anon, authenticated;
revoke all on function public.cle_prevent_prediction_mutation_v1() from public, anon, authenticated;
revoke all on function public.cle_prevent_audit_mutation_v1() from public, anon, authenticated;
revoke all on function public.cle_guard_rule_promotion_v1() from public, anon, authenticated;
revoke all on function public.cle_audit_rule_change_v1() from public, anon, authenticated;
revoke all on function public.promote_learning_rule_v1(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.promote_learning_rule_v1(uuid, uuid, text) to service_role;

comment on table public.learning_predictions is
  'Append-only internal prediction items linked to canonical decision_snapshots. New analysis creates a revision row; historical predictions are never overwritten.';
comment on table public.prediction_outcomes is
  'Deterministic intraday, close, 1D, 3D, 5D and future extensible outcomes. Data failures remain non-learning outcomes.';
comment on table public.learning_rules is
  'Internal learning rule lifecycle. AI may create candidates but database guards prevent evidence-free production promotion.';
comment on table public.learning_audit_logs is
  'Append-only audit trail for CLE rule lifecycle and system learning operations.';
