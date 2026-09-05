-- Signal Lab V1 is an isolated, internal research ledger.
-- This migration is intentionally not applied to Production by this change.

create extension if not exists pgcrypto;

create table if not exists public.signal_lab_daily_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  source_dataset text not null,
  market text not null check (market in ('TWSE', 'TPEX', 'INDEX')),
  symbol text not null check (symbol ~ '^(TAIEX|[0-9]{4,6})$'),
  trading_date date not null,
  open numeric(22, 6) not null,
  high numeric(22, 6) not null,
  low numeric(22, 6) not null,
  close numeric(22, 6) not null,
  volume numeric(24, 4) not null,
  turnover numeric(24, 4),
  adjusted_close numeric(22, 6),
  adjustment_status text not null default 'unavailable'
    check (adjustment_status in ('adjusted', 'not_required', 'unavailable', 'blocked')),
  available_at timestamptz not null,
  source_ref text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  ingested_at timestamptz not null default now(),
  check (open > 0 and high > 0 and low > 0 and close > 0),
  check (high >= greatest(open, close, low)),
  check (low <= least(open, close, high)),
  check (volume >= 0),
  unique (provider, source_dataset, symbol, trading_date, available_at)
);

create index if not exists signal_lab_daily_prices_symbol_date_idx
  on public.signal_lab_daily_prices (symbol, trading_date desc, available_at desc);
create index if not exists signal_lab_daily_prices_available_idx
  on public.signal_lab_daily_prices (available_at desc);

create table if not exists public.signal_lab_trading_calendar (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  market text not null check (market in ('TWSE', 'TPEX')),
  trading_date date not null,
  is_trading_day boolean not null,
  session_status text not null
    check (session_status in ('normal', 'holiday', 'weather_closure', 'special')),
  available_at timestamptz not null,
  source_ref text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (provider, market, trading_date, available_at)
);

create index if not exists signal_lab_trading_calendar_date_idx
  on public.signal_lab_trading_calendar (market, trading_date desc, available_at desc);

create table if not exists public.signal_lab_institutional_inputs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  source_dataset text not null,
  market text not null check (market in ('TWSE', 'TPEX')),
  symbol text not null check (symbol ~ '^[0-9]{4,6}$'),
  trading_date date not null,
  institution_type text not null
    check (institution_type in ('foreign', 'trust', 'dealer_proprietary', 'dealer_hedge')),
  buy_volume numeric(24, 4),
  sell_volume numeric(24, 4),
  net_volume numeric(24, 4) not null,
  buy_value numeric(24, 4),
  sell_value numeric(24, 4),
  net_value numeric(24, 4),
  market_volume numeric(24, 4),
  average_volume_20d numeric(24, 4),
  average_turnover_20d numeric(24, 4),
  available_at timestamptz not null,
  source_ref text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  ingested_at timestamptz not null default now(),
  check (buy_volume is null or buy_volume >= 0),
  check (sell_volume is null or sell_volume >= 0),
  check (market_volume is null or market_volume >= 0),
  check (average_volume_20d is null or average_volume_20d >= 0),
  check (average_turnover_20d is null or average_turnover_20d >= 0),
  unique (provider, source_dataset, symbol, trading_date, institution_type, available_at)
);

create index if not exists signal_lab_institutional_inputs_symbol_date_idx
  on public.signal_lab_institutional_inputs (symbol, trading_date desc, institution_type, available_at desc);
create index if not exists signal_lab_institutional_inputs_available_idx
  on public.signal_lab_institutional_inputs (available_at desc);

create table if not exists public.signal_lab_universe_memberships (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  market text not null check (market in ('TWSE', 'TPEX')),
  symbol text not null check (symbol ~ '^[0-9]{4,6}$'),
  listed_from date not null,
  listed_to date,
  status text not null check (status in ('listed', 'suspended', 'delisted')),
  available_at timestamptz not null,
  source_ref text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check (listed_to is null or listed_to >= listed_from),
  unique (provider, market, symbol, listed_from, available_at)
);

create index if not exists signal_lab_universe_date_idx
  on public.signal_lab_universe_memberships (listed_from, listed_to, market, symbol);

create table if not exists public.signal_lab_corporate_actions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  market text not null check (market in ('TWSE', 'TPEX')),
  symbol text not null check (symbol ~ '^[0-9]{4,6}$'),
  action_date date not null,
  action_type text not null
    check (action_type in ('cash_dividend', 'stock_dividend', 'split', 'capital_reduction', 'suspension', 'listing', 'delisting')),
  adjustment_factor numeric(20, 10),
  available_at timestamptz not null,
  source_ref text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (provider, symbol, action_date, action_type, available_at)
);

create index if not exists signal_lab_corporate_actions_symbol_date_idx
  on public.signal_lab_corporate_actions (symbol, action_date desc, available_at desc);

create table if not exists public.signal_lab_market_features (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[0-9]{4,6}$'),
  signal_date date not null,
  signal_timestamp timestamptz not null,
  feature_version text not null,
  status text not null check (status in ('ready', 'degraded', 'unavailable', 'blocked')),
  close numeric(22, 6),
  volume numeric(24, 4),
  relative_volume numeric(12, 6),
  return_1d numeric(12, 8),
  return_5d numeric(12, 8),
  return_20d numeric(12, 8),
  data_completeness numeric(7, 6) not null check (data_completeness between 0 and 1),
  reason_codes text[] not null default '{}',
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  created_at timestamptz not null default now(),
  unique (symbol, signal_timestamp, feature_version, source_snapshot_hash)
);

create index if not exists signal_lab_market_features_symbol_date_idx
  on public.signal_lab_market_features (symbol, signal_date desc, signal_timestamp desc);

create table if not exists public.signal_lab_institutional_features (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[0-9]{4,6}$'),
  signal_date date not null,
  signal_timestamp timestamptz not null,
  feature_version text not null,
  status text not null check (status in ('ready', 'degraded', 'unavailable', 'blocked')),
  institutional_score numeric(7, 4) check (institutional_score between 0 and 100),
  confidence numeric(7, 6) not null check (confidence between 0 and 1),
  data_completeness numeric(7, 6) not null check (data_completeness between 0 and 1),
  foreign_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(foreign_metrics) = 'object'),
  trust_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(trust_metrics) = 'object'),
  dealer_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(dealer_metrics) = 'object'),
  reason_codes text[] not null default '{}',
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check ((status in ('ready', 'degraded') and institutional_score is not null) or
         (status in ('unavailable', 'blocked') and institutional_score is null)),
  unique (symbol, signal_timestamp, feature_version, source_snapshot_hash)
);

create index if not exists signal_lab_institutional_features_symbol_date_idx
  on public.signal_lab_institutional_features (symbol, signal_date desc, signal_timestamp desc);

create table if not exists public.signal_lab_technical_features (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[0-9]{4,6}$'),
  signal_date date not null,
  signal_timestamp timestamptz not null,
  feature_version text not null,
  status text not null check (status in ('ready', 'degraded', 'unavailable', 'blocked')),
  technical_score numeric(7, 4) check (technical_score between 0 and 100),
  trend_score numeric(7, 4) check (trend_score between 0 and 100),
  momentum_score numeric(7, 4) check (momentum_score between 0 and 100),
  volume_score numeric(7, 4) check (volume_score between 0 and 100),
  volatility_score numeric(7, 4) check (volatility_score between 0 and 100),
  structure_score numeric(7, 4) check (structure_score between 0 and 100),
  confidence numeric(7, 6) not null check (confidence between 0 and 1),
  data_completeness numeric(7, 6) not null check (data_completeness between 0 and 1),
  indicators jsonb not null default '{}'::jsonb check (jsonb_typeof(indicators) = 'object'),
  reason_codes text[] not null default '{}',
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check ((status in ('ready', 'degraded') and technical_score is not null) or
         (status in ('unavailable', 'blocked') and technical_score is null)),
  unique (symbol, signal_timestamp, feature_version, source_snapshot_hash)
);

create index if not exists signal_lab_technical_features_symbol_date_idx
  on public.signal_lab_technical_features (symbol, signal_date desc, signal_timestamp desc);

create table if not exists public.signal_lab_market_regimes (
  id uuid primary key default gen_random_uuid(),
  signal_date date not null,
  signal_timestamp timestamptz not null,
  feature_version text not null,
  status text not null check (status in ('ready', 'degraded', 'unavailable', 'blocked')),
  regime text check (regime in ('BULLISH', 'BEARISH', 'SIDEWAYS', 'HIGH_VOLATILITY')),
  regime_score numeric(7, 4) check (regime_score between 0 and 100),
  confidence numeric(7, 6) not null check (confidence between 0 and 1),
  data_completeness numeric(7, 6) not null check (data_completeness between 0 and 1),
  reason_codes text[] not null default '{}',
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  created_at timestamptz not null default now(),
  check ((status in ('ready', 'degraded') and regime is not null and regime_score is not null) or
         (status in ('unavailable', 'blocked') and regime is null and regime_score is null)),
  unique (signal_timestamp, feature_version, source_snapshot_hash)
);

create index if not exists signal_lab_market_regimes_date_idx
  on public.signal_lab_market_regimes (signal_date desc, signal_timestamp desc);

create table if not exists public.signal_lab_market_cost_configs (
  version text primary key,
  market text not null check (market in ('TWSE', 'TPEX')),
  commission_rate numeric(12, 10) not null check (commission_rate >= 0),
  sell_tax_rate numeric(12, 10) not null check (sell_tax_rate >= 0),
  day_trade_sell_tax_rate numeric(12, 10) check (day_trade_sell_tax_rate >= 0),
  slippage_rate numeric(12, 10) not null check (slippage_rate >= 0),
  effective_from date not null,
  effective_to date,
  source_ref text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.signal_lab_strategy_versions (
  version text primary key,
  status text not null check (status in ('draft', 'shadow', 'archived')),
  feature_version text not null,
  weights jsonb not null check (jsonb_typeof(weights) = 'object'),
  score_thresholds jsonb not null check (jsonb_typeof(score_thresholds) = 'object'),
  market_cost_version text references public.signal_lab_market_cost_configs(version),
  hypothesis text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  check (status <> 'shadow' or activated_at is not null)
);

create unique index if not exists signal_lab_strategy_one_shadow_uidx
  on public.signal_lab_strategy_versions ((status)) where status = 'shadow';

create table if not exists public.signal_lab_strategy_experiments (
  id uuid primary key default gen_random_uuid(),
  strategy_version text not null references public.signal_lab_strategy_versions(version),
  experiment_name text not null,
  dataset_start date,
  dataset_end date,
  split_contract jsonb not null default '{}'::jsonb check (jsonb_typeof(split_contract) = 'object'),
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  validity_status text not null check (validity_status in ('pending', 'valid', 'insufficient', 'blocked')),
  edge_status text not null check (edge_status in ('pending', 'proven', 'not_proven', 'unproven')),
  bias_flags text[] not null default '{}',
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  baselines jsonb not null default '{}'::jsonb check (jsonb_typeof(baselines) = 'object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (strategy_version, experiment_name)
);

create table if not exists public.signal_lab_signal_predictions (
  prediction_id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[0-9]{4,6}$'),
  signal_date date not null,
  signal_timestamp timestamptz not null,
  signal_score numeric(7, 4) not null check (signal_score between 0 and 100),
  signal_label text not null
    check (signal_label in ('STRONG_POSITIVE', 'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'STRONG_NEGATIVE')),
  institutional_score numeric(7, 4) not null check (institutional_score between 0 and 100),
  technical_score numeric(7, 4) not null check (technical_score between 0 and 100),
  volume_score numeric(7, 4) not null check (volume_score between 0 and 100),
  market_regime text not null check (market_regime in ('BULLISH', 'BEARISH', 'SIDEWAYS', 'HIGH_VOLATILITY')),
  market_regime_score numeric(7, 4) not null check (market_regime_score between 0 and 100),
  confidence numeric(7, 6) not null check (confidence between 0 and 1),
  data_completeness numeric(7, 6) not null check (data_completeness between 0 and 1),
  reason_codes text[] not null default '{}',
  strategy_version text not null references public.signal_lab_strategy_versions(version),
  feature_version text not null,
  source_snapshot_hash text not null check (source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  calculation_version integer not null default 1 check (calculation_version > 0),
  created_at timestamptz not null default now(),
  unique (symbol, signal_date, strategy_version, source_snapshot_hash, calculation_version)
);

create index if not exists signal_lab_predictions_date_score_idx
  on public.signal_lab_signal_predictions (signal_date desc, signal_score desc);
create index if not exists signal_lab_predictions_symbol_date_idx
  on public.signal_lab_signal_predictions (symbol, signal_date desc);

create table if not exists public.signal_lab_signal_outcomes (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.signal_lab_signal_predictions(prediction_id) on delete restrict,
  horizon text not null check (horizon in ('1D', '5D', '10D', '20D', '60D')),
  maturity_date date not null,
  status text not null check (status in ('pending', 'complete', 'insufficient', 'blocked')),
  forward_return numeric(16, 10),
  net_forward_return numeric(16, 10),
  excess_return_vs_taiex numeric(16, 10),
  mfe numeric(16, 10),
  mae numeric(16, 10),
  market_cost_version text references public.signal_lab_market_cost_configs(version),
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'complete' and evaluated_at is not null and forward_return is not null and evidence_hash is not null) or
         (status <> 'complete')),
  unique (prediction_id, horizon)
);

create index if not exists signal_lab_outcomes_maturity_idx
  on public.signal_lab_signal_outcomes (status, maturity_date, horizon);

create table if not exists public.signal_lab_data_quality_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  run_timestamp timestamptz not null,
  feature_version text not null,
  status text not null check (status in ('ready', 'degraded', 'blocked')),
  eligible_universe integer not null check (eligible_universe >= 0),
  analyzed_count integer not null check (analyzed_count >= 0),
  complete_count integer not null check (complete_count >= 0),
  coverage_ratio numeric(7, 6) not null check (coverage_ratio between 0 and 1),
  freshness_status text not null,
  missing_count integer not null default 0 check (missing_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  blocked_reason_codes text[] not null default '{}',
  source_snapshot_hash text check (source_snapshot_hash is null or source_snapshot_hash ~ '^[a-f0-9]{64}$'),
  compute_duration_ms integer check (compute_duration_ms is null or compute_duration_ms >= 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  unique (run_date, run_timestamp, feature_version)
);

create index if not exists signal_lab_quality_date_idx
  on public.signal_lab_data_quality_runs (run_date desc, run_timestamp desc);

create table if not exists public.signal_lab_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  strategy_version text not null references public.signal_lab_strategy_versions(version),
  feature_version text not null,
  status text not null check (status in ('running', 'completed', 'blocked', 'failed')),
  eligible_universe integer not null default 0 check (eligible_universe >= 0),
  analyzed_count integer not null default 0 check (analyzed_count >= 0),
  prediction_count integer not null default 0 check (prediction_count >= 0),
  input_snapshot_hash text check (input_snapshot_hash is null or input_snapshot_hash ~ '^[a-f0-9]{64}$'),
  blocked_reason_codes text[] not null default '{}',
  compute_duration_ms integer check (compute_duration_ms is null or compute_duration_ms >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  unique (run_date, strategy_version, input_snapshot_hash)
);

create index if not exists signal_lab_shadow_runs_date_idx
  on public.signal_lab_shadow_runs (run_date desc, started_at desc);

create or replace function public.signal_lab_reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SIGNAL_LAB_IMMUTABLE_RECORD';
end;
$$;

revoke all on function public.signal_lab_reject_immutable_mutation() from public, anon, authenticated;

drop trigger if exists signal_lab_daily_prices_immutable on public.signal_lab_daily_prices;
create trigger signal_lab_daily_prices_immutable
before update or delete on public.signal_lab_daily_prices
for each row execute function public.signal_lab_reject_immutable_mutation();

drop trigger if exists signal_lab_institutional_inputs_immutable on public.signal_lab_institutional_inputs;
create trigger signal_lab_institutional_inputs_immutable
before update or delete on public.signal_lab_institutional_inputs
for each row execute function public.signal_lab_reject_immutable_mutation();

drop trigger if exists signal_lab_trading_calendar_immutable on public.signal_lab_trading_calendar;
create trigger signal_lab_trading_calendar_immutable
before update or delete on public.signal_lab_trading_calendar
for each row execute function public.signal_lab_reject_immutable_mutation();

drop trigger if exists signal_lab_universe_memberships_immutable on public.signal_lab_universe_memberships;
create trigger signal_lab_universe_memberships_immutable
before update or delete on public.signal_lab_universe_memberships
for each row execute function public.signal_lab_reject_immutable_mutation();

drop trigger if exists signal_lab_corporate_actions_immutable on public.signal_lab_corporate_actions;
create trigger signal_lab_corporate_actions_immutable
before update or delete on public.signal_lab_corporate_actions
for each row execute function public.signal_lab_reject_immutable_mutation();

drop trigger if exists signal_lab_predictions_immutable on public.signal_lab_signal_predictions;
create trigger signal_lab_predictions_immutable
before update or delete on public.signal_lab_signal_predictions
for each row execute function public.signal_lab_reject_immutable_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'signal_lab_daily_prices',
    'signal_lab_trading_calendar',
    'signal_lab_institutional_inputs',
    'signal_lab_universe_memberships',
    'signal_lab_corporate_actions',
    'signal_lab_market_features',
    'signal_lab_institutional_features',
    'signal_lab_technical_features',
    'signal_lab_market_regimes',
    'signal_lab_market_cost_configs',
    'signal_lab_strategy_versions',
    'signal_lab_strategy_experiments',
    'signal_lab_signal_predictions',
    'signal_lab_signal_outcomes',
    'signal_lab_data_quality_runs',
    'signal_lab_shadow_runs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$$;

comment on table public.signal_lab_daily_prices is
  'Internal append-only daily OHLCV inputs. No client access; every row records available_at and a source hash.';
comment on table public.signal_lab_institutional_inputs is
  'Internal append-only institutional-flow inputs with directional dealer and hedge flows kept separate.';
comment on table public.signal_lab_trading_calendar is
  'Internal append-only Taiwan exchange-session calendar used to distinguish missing observations from holidays and closures.';
comment on table public.signal_lab_signal_predictions is
  'Immutable Shadow Mode predictions. These rows never alter Morning Alpha production recommendations.';
comment on table public.signal_lab_signal_outcomes is
  'Forward outcomes updated only as each horizon matures; the linked prediction remains immutable.';

-- Research-only default cost contract. Commission is the TWSE standard rate;
-- actual broker discounts are intentionally not assumed. Slippage is a versioned
-- research assumption and must be sensitivity-tested, not presented as a fee.
insert into public.signal_lab_market_cost_configs (
  version,
  market,
  commission_rate,
  sell_tax_rate,
  day_trade_sell_tax_rate,
  slippage_rate,
  effective_from,
  effective_to,
  source_ref,
  notes
) values
  (
    'TW_STOCK_COST_2026_V1',
    'TWSE',
    0.001425,
    0.003,
    0.0015,
    0.0005,
    date '2026-01-01',
    date '2027-12-31',
    'https://www.twse.com.tw/en/about/company/guide.html',
    'Commission charged on entry and exit at the published standard rate; sell tax on exit; 5 bps per side slippage is a conservative versioned research assumption.'
  ),
  (
    'TPEX_STOCK_COST_2026_V1',
    'TPEX',
    0.001425,
    0.003,
    0.0015,
    0.0005,
    date '2026-01-01',
    date '2027-12-31',
    'https://www.twse.com.tw/en/about/company/guide.html',
    'Same statutory stock-tax assumption; broker commission and modeled slippage remain versioned assumptions.'
  )
on conflict (version) do nothing;

insert into public.signal_lab_strategy_versions (
  version,
  status,
  feature_version,
  weights,
  score_thresholds,
  market_cost_version,
  hypothesis,
  activated_at
) values (
  'SIGNAL_LAB_V1_SHADOW',
  'shadow',
  'SIGNAL_FEATURES_V1',
  '{"technical":0.40,"institutional":0.35,"volume":0.15,"market_regime":0.10}'::jsonb,
  '{"strong_positive":85,"positive":70,"neutral":45,"negative":30}'::jsonb,
  'TW_STOCK_COST_2026_V1',
  'Transparent V1 research weights for technical, institutional, volume and deterministic market-regime evidence. Not a production recommendation.',
  now()
)
on conflict (version) do nothing;

insert into public.signal_lab_strategy_experiments (
  strategy_version,
  experiment_name,
  dataset_start,
  dataset_end,
  split_contract,
  parameters,
  validity_status,
  edge_status,
  bias_flags,
  metrics,
  baselines,
  completed_at
) values (
  'SIGNAL_LAB_V1_SHADOW',
  'INITIAL_DATA_VALIDITY_AUDIT_2026_09_05',
  date '2026-06-26',
  date '2026-09-04',
  '{"train":null,"validation":null,"out_of_sample":null,"reason":"point-in-time history unavailable"}'::jsonb,
  '{"engine_version":"SIGNAL_BACKTEST_V1","real_backtest_executed":false}'::jsonb,
  'insufficient',
  'unproven',
  array['AVAILABLE_AT_UNPROVEN','CORPORATE_ACTION_HANDLING_MISSING','SURVIVORSHIP_BIAS_RISK'],
  '{"sample_size":0}'::jsonb,
  '{"taiex":"not_run","random_eligible":"not_run","simple_momentum":"not_run"}'::jsonb,
  now()
)
on conflict (strategy_version, experiment_name) do nothing;
