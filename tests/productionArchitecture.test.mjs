import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  RUNTIME_QUALITY_POLICY,
  buildBullBearDebate,
  buildRetryDecision,
  classifyMarketRegime,
  computeHistoricalSimilarity,
  gradeContentScore,
  resolveAbstentionDecision,
  resolveCostGuardrail,
  simulateFullTradingDay,
  simulateHistoricalFailureMatrix,
} from '../supabase/functions/_shared/production-architecture-core.mjs';
import {
  classifyCanonicalAsset,
  normalizeProviderQuote,
  summarizeProviderHealth,
} from '../supabase/functions/_shared/market-provider-adapter.mjs';

const migrationPath = new URL('../supabase/migrations/20260822090305_production_architecture_v1.sql', import.meta.url);
const generatorPath = new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url);
const collectorPath = new URL('../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url);
const recoveryPath = new URL('../supabase/functions/ma-ops-safe-recovery/index.ts', import.meta.url);
const replayPath = new URL('../supabase/functions/strategy-replay-engine/index.ts', import.meta.url);
const entitlementPath = new URL('../src/services/entitlementService.ts', import.meta.url);
const dashboardPath = new URL('../src/hooks/useHomeDashboard.ts', import.meta.url);
const deployPath = new URL('../.github/workflows/deploy-morning-alpha-runtime.yml', import.meta.url);
const replayWorkflowPath = new URL('../.github/workflows/weekly-strategy-replay.yml', import.meta.url);
const checkpointMigrationPath = new URL('../supabase/migrations/20260822230000_preserve_checkpoint_snapshots.sql', import.meta.url);
const runtimeCheckpointWorkflowPath = new URL('../.github/workflows/morning-alpha-runtime-checkpoints.yml', import.meta.url);
const openingRadarPath = new URL('../supabase/functions/opening-market-radar/index.ts', import.meta.url);
const closingVerificationPath = new URL('../supabase/functions/closing-verification-engine/index.ts', import.meta.url);
const securityHardeningMigrationPath = new URL('../supabase/migrations/20260822233000_harden_runtime_permissions.sql', import.meta.url);
const productionVerificationWorkflowPath = new URL('../.github/workflows/production-readiness-verification.yml', import.meta.url);

const [migration, generator, collector, recovery, replay, entitlement, dashboard, deploy, replayWorkflow, checkpointMigration, runtimeCheckpointWorkflow, openingRadar, closingVerification, securityHardeningMigration, productionVerificationWorkflow] = await Promise.all([
  migrationPath,
  generatorPath,
  collectorPath,
  recoveryPath,
  replayPath,
  entitlementPath,
  dashboardPath,
  deployPath,
  replayWorkflowPath,
  checkpointMigrationPath,
  runtimeCheckpointWorkflowPath,
  openingRadarPath,
  closingVerificationPath,
  securityHardeningMigrationPath,
  productionVerificationWorkflowPath,
].map((path) => readFile(path, 'utf8')));

test('central production policy preserves the strict premium threshold', () => {
  assert.equal(RUNTIME_QUALITY_POLICY.premium_publish_min, 90);
  assert.equal(gradeContentScore(90), 'high_quality');
  assert.equal(gradeContentScore(89), 'publish');
  assert.equal(gradeContentScore(70), 'degraded');
  assert.equal(gradeContentScore(69), 'reject');
});

test('abstention distinguishes evidence-backed no-trade from unsafe output', () => {
  const noTrade = resolveAbstentionDecision({
    is_trading_day: true,
    coverage_score: 80,
    confidence_score: 50,
    evidence_count: 4,
    missing_critical_sources: [],
  });
  assert.equal(noTrade.decision_mode, 'no_trade');
  assert.equal(noTrade.safe_mode, false);

  const blocked = resolveAbstentionDecision({
    is_trading_day: true,
    coverage_score: 40,
    confidence_score: 80,
    evidence_count: 1,
    missing_critical_sources: ['market_news'],
  });
  assert.equal(blocked.decision_mode, 'blocked');
  assert.equal(blocked.safe_mode, true);
  assert.ok(blocked.reason_codes.includes('critical_source_missing'));
});

test('market regime, debate, similarity, cost, and retry contracts are deterministic', () => {
  assert.equal(classifyMarketRegime({ trend_score: 55, volatility_score: 20, liquidity_score: 90, breadth_score: 40 }), 'risk_on_trend');
  assert.equal(classifyMarketRegime({ trend_score: 0, volatility_score: 90, liquidity_score: 80, breadth_score: 0 }), 'stress');
  const debate = buildBullBearDebate({
    supporting_evidence: ['SPX positive', 'SOX positive', 'TSM positive'],
    counter_evidence: ['VIX elevated'],
    confidence_score: 70,
    market_regime: 'risk_on_trend',
    abstention: { should_abstain: false },
  });
  assert.equal(debate.verdict, 'bull');
  assert.equal(computeHistoricalSimilarity(
    { market_regime: 'range', confidence_score: 60, market_score: 55, sectors: ['AI'], risk_flags: ['FX'] },
    { market_regime: 'range', confidence_score: 60, market_score: 55, sectors: ['AI'], risk_flags: ['FX'] },
  ), 100);
  assert.equal(resolveCostGuardrail({ calls: 20, tokens: 1 }).allowed, false);
  assert.equal(buildRetryDecision({ attempt: 1, retryable: true }).retry_after_seconds, 30);
  assert.equal(buildRetryDecision({ attempt: 4, retryable: true }).dead_letter, true);
});

test('synthetic Monday dry-run exercises the full lifecycle without writes or notifications', () => {
  const simulation = simulateFullTradingDay({
    trading_date: '2026-08-24',
    source_status: { TXF: 'unavailable_entitlement' },
    content_scores: [77, 92],
  });
  assert.equal(simulation.result, 'GO');
  assert.equal(simulation.timezone, 'Asia/Taipei');
  assert.equal(simulation.checkpoints.length, 6);
  assert.deepEqual(simulation.checkpoints.map((item) => item.checkpoint), ['0900', '0930', '1030', '1300', '1410', '1430']);
  assert.equal(simulation.premarket.repair_attempts[1].action, 'repair_failed_sections_only');
  assert.equal(simulation.source_gate.txf_blocks_publication, false);
  assert.equal(simulation.writes_performed, 0);
  assert.equal(simulation.notifications_sent, 0);
});

test('historical failure matrix covers normal, incomplete-data, and API-failure days', () => {
  const matrix = simulateHistoricalFailureMatrix();
  assert.equal(matrix.result, 'PASS');
  assert.equal(matrix.normal_day_count, 3);
  assert.equal(matrix.incomplete_day_count, 1);
  assert.equal(matrix.api_failure_count, 1);
  assert.equal(matrix.scenarios.every((scenario) => scenario.no_duplicate_snapshot), true);
  assert.equal(matrix.scenarios.every((scenario) => scenario.no_duplicate_notification), true);
  assert.equal(matrix.scenarios.every((scenario) => scenario.no_production_write), true);
});

test('provider adapter normalizes canonical quotes and reports degraded health', () => {
  assert.equal(classifyCanonicalAsset('TAIEX'), 'index');
  assert.equal(classifyCanonicalAsset('TXF'), 'future');
  assert.equal(classifyCanonicalAsset('2330'), 'equity');
  const normalized = normalizeProviderQuote({
    provider: 'Finnhub',
    symbol: 'SPX',
    source_symbol: 'SPY',
    trading_date: '2026-08-22',
    phase: 'premarket',
    value: 6500,
    change: 20,
    change_percent: 0.31,
    captured_at: '2026-08-22T01:00:00.000Z',
  });
  assert.equal(normalized.valid, true);
  assert.equal(normalized.record.provider, 'finnhub');
  assert.equal(normalized.asset_type, 'index');
  assert.equal(summarizeProviderHealth({ requested_count: 10, succeeded_count: 8, failed_count: 2 }).status, 'degraded');
});

test('migration is additive, private by default, and service-role functions are explicit', () => {
  for (const table of [
    'runtime_quality_policies', 'market_quotes', 'market_indices', 'futures_snapshots',
    'institutional_flows', 'macro_events', 'news_events', 'company_events',
    'earnings_events', 'market_snapshots', 'data_provider_health', 'strategy_registry',
    'historical_replay_runs', 'historical_replay_results', 'historical_similarity_results',
    'runtime_control_state', 'runtime_dead_letters', 'runtime_cost_usage',
    'runtime_slo_definitions', 'runtime_slo_measurements', 'user_market_preferences', 'growth_events_v2',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.%I from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.%I to service_role/);
  assert.match(migration, /user_market_preferences_owner_select/);
  assert.match(migration, /publish_decision_snapshot_v3/);
  assert.match(migration, /get_active_runtime_quality_policy_v1/);
  assert.match(migration, /enforce_decision_snapshot_premium_90_gate_v1/);
});

test('runtime dual-writes canonical data and emits traceable decisions', () => {
  assert.match(collector, /normalizeProviderQuote/);
  assert.match(collector, /from\("market_quotes"\)/);
  assert.match(collector, /from\("data_provider_health"\)/);
  assert.match(collector, /correlation_id: correlationId/);
  assert.match(generator, /resolveAbstentionDecision/);
  assert.match(generator, /buildBullBearDebate/);
  assert.match(generator, /check_runtime_cost_budget_v1/);
  assert.match(generator, /record_runtime_cost_usage_v1/);
  assert.match(generator, /publish_decision_snapshot_v3/);
});

test('checkpoint snapshots are immutable across the six Taipei market checkpoints', () => {
  assert.match(checkpointMigration, /add column if not exists checkpoint text/);
  assert.match(checkpointMigration, /symbol, trading_date, phase, checkpoint/);
  assert.match(checkpointMigration, /create table if not exists public\.trading_day_state/);
  assert.match(checkpointMigration, /advance_trading_day_state_v1/);
  assert.match(checkpointMigration, /greatest\(trading_day_state\.state_rank, excluded\.state_rank\)/);
  assert.match(collector, /onConflict: "symbol,trading_date,phase,checkpoint"/);
  assert.match(collector, /advance_trading_day_state_v1/);
  assert.match(openingRadar, /\.eq\('checkpoint', checkpoint\)/);
  assert.match(closingVerification, /phase,checkpoint/);
  for (const checkpoint of ['0900', '0930', '1030', '1300', '1410', '1430']) {
    assert.match(runtimeCheckpointWorkflow, new RegExp(`'${checkpoint}'|"${checkpoint}"`));
  }
});

test('legacy radar writes and trigger-only functions are least privilege', () => {
  assert.match(securityHardeningMigration, /alter policy "Service role write"[\s\S]*to service_role/);
  assert.match(securityHardeningMigration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*from anon, authenticated/);
  assert.match(securityHardeningMigration, /using \(\(select auth\.uid\(\)\) = id\)/);
  assert.match(securityHardeningMigration, /revoke execute on function public\.handle_new_user\(\) from public, anon, authenticated/);
  assert.match(securityHardeningMigration, /revoke execute on function public\.handle_user_email_update\(\) from public, anon, authenticated/);
  assert.doesNotMatch(securityHardeningMigration, /revoke select[\s\S]*opening_market_radar/i);
});

test('production verification stays dry-run and proves idempotent scenarios', () => {
  assert.match(productionVerificationWorkflow, /workflow_dispatch/);
  assert.match(productionVerificationWorkflow, /"simulation_mode":"full_day"/);
  assert.match(productionVerificationWorkflow, /"simulation_mode":"historical_scenarios"/);
  assert.match(productionVerificationWorkflow, /simulation_mode\\":\\"content_quality/);
  assert.match(productionVerificationWorkflow, /"dry_run":true/g);
  assert.match(productionVerificationWorkflow, /no_duplicate_snapshot == true/);
  assert.match(productionVerificationWorkflow, /no_duplicate_notification == true/);
  assert.match(productionVerificationWorkflow, /no_production_write == true/);
  assert.match(productionVerificationWorkflow, /writes_performed == 0/);
  assert.match(productionVerificationWorkflow, /notifications_sent == 0/);
  assert.match(productionVerificationWorkflow, /MA_STRATEGY_REPLAY_V2/);
  assert.match(productionVerificationWorkflow, /runtime_schema\.ready == true/);
  assert.match(productionVerificationWorkflow, /target_date/);
  assert.match(productionVerificationWorkflow, /quality_gate_passed == true/);
  assert.match(productionVerificationWorkflow, /minimum_score >= 90/);
  assert.match(replay, /inspectRuntimeSchema/);
  assert.match(replay, /blocked_report_count/);
});

test('safe recovery is allowlisted and replay is shadow-only by default', () => {
  assert.match(recovery, /ACTION_NOT_ALLOWLISTED/);
  assert.match(recovery, /const dryRun = body\.dry_run !== false/);
  assert.match(recovery, /body\.approved === true/);
  assert.doesNotMatch(recovery, /body\.target|body\.function_name/);
  assert.match(replay, /const dryRun = body\.dry_run !== false/);
  assert.match(replay, /computeHistoricalSimilarity/);
  assert.match(replay, /historical_replay_results/);
  assert.match(deploy, /supabase functions deploy ma-ops-safe-recovery/);
  assert.match(deploy, /supabase functions deploy strategy-replay-engine/);
  assert.match(replayWorkflow, /cron: '15 2 \* \* 6'/);
  assert.match(replayWorkflow, /"dry_run":false/);
});

test('frontend traffic is deduplicated and uses adaptive polling with Realtime', () => {
  assert.match(entitlement, /inflightRequests/);
  assert.match(entitlement, /PUBLIC_CACHE_TTL_MS = 30_000/);
  assert.match(entitlement, /AUTHENTICATED_CACHE_TTL_MS = 10_000/);
  assert.match(dashboard, /ACTIVE_MARKET_POLL_MS = 300_000/);
  assert.match(dashboard, /OFF_HOURS_POLL_MS = 900_000/);
  assert.match(dashboard, /visibilitychange/);
  assert.doesNotMatch(dashboard, /setInterval\(refresh,\s*30000\)/);
});
