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
} from '../supabase/functions/_shared/production-architecture-core.mjs';
import {
  classifyCanonicalAsset,
  normalizeProviderQuote,
  summarizeProviderHealth,
} from '../supabase/functions/_shared/market-provider-adapter.mjs';

const migrationPath = new URL('../supabase/migrations/20260822173000_production_architecture_v1.sql', import.meta.url);
const generatorPath = new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url);
const collectorPath = new URL('../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url);
const recoveryPath = new URL('../supabase/functions/ma-ops-safe-recovery/index.ts', import.meta.url);
const replayPath = new URL('../supabase/functions/strategy-replay-engine/index.ts', import.meta.url);
const entitlementPath = new URL('../src/services/entitlementService.ts', import.meta.url);
const dashboardPath = new URL('../src/hooks/useHomeDashboard.ts', import.meta.url);
const deployPath = new URL('../.github/workflows/deploy-morning-alpha-runtime.yml', import.meta.url);
const replayWorkflowPath = new URL('../.github/workflows/weekly-strategy-replay.yml', import.meta.url);

const [migration, generator, collector, recovery, replay, entitlement, dashboard, deploy, replayWorkflow] = await Promise.all([
  migrationPath,
  generatorPath,
  collectorPath,
  recoveryPath,
  replayPath,
  entitlementPath,
  dashboardPath,
  deployPath,
  replayWorkflowPath,
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
  assert.match(dashboard, /ACTIVE_MARKET_POLL_MS = 120_000/);
  assert.match(dashboard, /OFF_HOURS_POLL_MS = 900_000/);
  assert.match(dashboard, /visibilitychange/);
  assert.doesNotMatch(dashboard, /setInterval\(refresh,\s*30000\)/);
});
