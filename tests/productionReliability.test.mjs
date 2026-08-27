import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DAILY_LIFECYCLE_RANKS,
  buildRuntimeIdempotencyKey,
  classifyMutationCounters,
  evaluatePublicPremiumLeakageGate,
  evaluateSemanticCoherenceGate,
  reconcileHttpReceipt,
  resolveLifecycleTransition,
  resolvePendingHorizon,
  resolvePrimaryBackupDecision,
  simulateHistoricalFailureMatrix,
  validateClosingWindowData,
} from '../supabase/functions/_shared/production-architecture-core.mjs';
import {
  INTERNAL_AUTH_ERROR_CODES,
  authorizeInternalRequest,
  buildInternalFunctionHeaders,
} from '../supabase/functions/_shared/internal-function-auth.mjs';

const headers = (values = {}) => ({ get: (name) => values[name.toLowerCase()] || null });
const credentials = {
  currentToken: 'current-secret',
  previousToken: 'previous-secret',
  previousExpiresAt: '2026-08-28T00:00:00.000Z',
  version: 'v1',
};

test('internal auth returns stable missing/invalid/version/expired codes and supports rotation window', async () => {
  assert.equal((await authorizeInternalRequest(headers(), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.MISSING);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'wrong' }), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.INVALID);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'current-secret', 'x-internal-auth-version': 'v2' }), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.VERSION_MISMATCH);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'current-secret' }), credentials)).ok, true);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'previous-secret' }), credentials, new Date('2026-08-27T00:00:00Z'))).ok, true);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'previous-secret' }), credentials, new Date('2026-08-29T00:00:00Z'))).error_code, INTERNAL_AUTH_ERROR_CODES.EXPIRED);
});

test('internal outbound headers follow the active auth version without using bearer service credentials', () => {
  const outbound = buildInternalFunctionHeaders({ cronSecret: 'current-secret', serviceRoleKey: 'service-key', version: 'v2', source: 'test' });
  assert.equal(outbound['x-internal-auth-version'], 'v2');
  assert.equal(outbound.apikey, 'service-key');
  assert.equal(outbound.Authorization, undefined);
});

test('daily lifecycle is monotonic and contains all sixteen production states', () => {
  assert.equal(Object.keys(DAILY_LIFECYCLE_RANKS).length, 16);
  assert.deepEqual(resolveLifecycleTransition('CLOSING_VERIFIED', 'LEARNING_COMPLETED'), { allowed: true, reason_code: 'STATE_ADVANCE' });
  assert.deepEqual(resolveLifecycleTransition('LEARNING_COMPLETED', 'CLOSING_VERIFIED'), { allowed: false, reason_code: 'STATE_RANK_REGRESSION_BLOCKED' });
  assert.equal(resolveLifecycleTransition('LEARNING_COMPLETED', 'LEARNING_COMPLETED').reason_code, 'IDEMPOTENT_REPLAY');
});

test('runtime idempotency keys are stable and reject incomplete input', () => {
  const input = { trading_date: '2026-08-27', job_name: 'runtime_checkpoint', checkpoint: '0930' };
  assert.equal(buildRuntimeIdempotencyKey(input), buildRuntimeIdempotencyKey(input));
  assert.throws(() => buildRuntimeIdempotencyKey({ trading_date: '2026-08-27' }), /INCOMPLETE/);
});

test('backup is watchdog-only and respects success plus active leases', () => {
  assert.equal(resolvePrimaryBackupDecision({ role: 'backup', completed: true }).status, 'SKIPPED_ALREADY_SUCCEEDED');
  assert.equal(resolvePrimaryBackupDecision({ role: 'backup', in_flight: true, lease_expires_at: '2026-08-27T10:10:00Z', now: '2026-08-27T10:00:00Z' }).status, 'SKIPPED_ACTIVE_LEASE');
  assert.equal(resolvePrimaryBackupDecision({ role: 'backup', primary_timed_out: true }).status, 'WATCHDOG_TAKEOVER');
});

test('HTTP receipts distinguish queueing from business success and bound retries', () => {
  assert.equal(reconcileHttpReceipt({ http_status: 200, payload: { success: true } }).status, 'SUCCEEDED');
  assert.equal(reconcileHttpReceipt({ http_status: 200, payload: { success: false } }).status, 'FAILED');
  for (const status of [401, 403]) assert.equal(reconcileHttpReceipt({ http_status: status }).dead_letter, true);
  assert.equal(reconcileHttpReceipt({ http_status: 409, gate_can_recover: true }).retryable, true);
  assert.equal(reconcileHttpReceipt({ http_status: 429 }).retryable, true);
  assert.equal(reconcileHttpReceipt({ http_status: 500 }).retryable, true);
  assert.equal(reconcileHttpReceipt({ timed_out: true }).status, 'TIMED_OUT');
});

test('runtime orchestration fails closed for pending close evidence and incomplete learning', () => {
  const orchestrator = readFileSync(new URL('../supabase/functions/daily-delivery-orchestrator/index.ts', import.meta.url), 'utf8');
  const learning = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const recovery = readFileSync(new URL('../supabase/functions/ma-ops-safe-recovery/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(orchestrator, /payload\.pending === true|payload\.skipped === true\s*\|\|/);
  assert.match(orchestrator, /String\(payload\.data_status \|\| ''\) === 'ready'/);
  assert.match(orchestrator, /result\.payload\.skipped !== true && result\.payload\.degraded !== true/);
  assert.match(orchestrator, /body\.source === 'supabase_cron_watchdog'/);
  assert.doesNotMatch(orchestrator, /source: 'supabase_cron_backup'/);
  assert.match(learning, /existingRun && String\(existingRun\.status\) === 'succeeded'/);
  assert.match(recovery, /retry_closing_health/);
  assert.match(recovery, /source: 'ma-ops-safe-recovery'/);
  assert.match(orchestrator, /body\.source === 'ma-ops-safe-recovery'/);
  assert.match(orchestrator, /p_state: 'HEALTH_AUDITED'/);
  assert.match(orchestrator, /p_state: 'DAY_COMPLETED'/);
});

test('semantic coherence rejects divergent primary theses and contradictions', () => {
  assert.equal(evaluateSemanticCoherenceGate({ primary_thesis: '油價 航運 陽明', sections: ['油價傳導航運與陽明'], contradictions: [] }).eligible, true);
  assert.equal(evaluateSemanticCoherenceGate({ primary_thesis: '油價 航運 陽明', sections: ['Nvidia 半導體 台積電'], contradictions: [] }).eligible, false);
  assert.equal(evaluateSemanticCoherenceGate({ primary_thesis: '油價 航運', sections: ['油價 航運'], contradictions: ['data_quality'] }).eligible, false);
});

test('public projection blocks premium symbols, reasoning fields, and excessive entity overlap', () => {
  assert.equal(evaluatePublicPremiumLeakageGate({ public_symbols: ['2609'], premium_only_symbols: ['2330'] }).eligible, true);
  assert.equal(evaluatePublicPremiumLeakageGate({ public_symbols: ['2330'], premium_only_symbols: ['2330'] }).eligible, false);
  assert.equal(evaluatePublicPremiumLeakageGate({ public_fields: ['confirmation'] }).eligible, false);
  assert.equal(evaluatePublicPremiumLeakageGate({ public_entities: ['油價','航運'], premium_entities: ['油價','航運'], max_entity_overlap: 0.5 }).eligible, false);
});

test('CLE counters count real inserts, updates, and unchanged entities', () => {
  const before = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
  const after = [{ id: 'a', value: 1 }, { id: 'b', value: 3 }, { id: 'c', value: 4 }];
  assert.deepEqual(classifyMutationCounters(before, after), { created_count: 1, updated_count: 1, unchanged_count: 1 });
  assert.deepEqual(classifyMutationCounters(after, after), { created_count: 0, updated_count: 0, unchanged_count: 3 });
});

test('pending horizons use trading-day calendar rather than natural days', () => {
  const days = ['2026-08-27','2026-08-28','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];
  assert.equal(resolvePendingHorizon({ report_date: days[0], target_date: days[1], horizon_trading_days: 3, trading_days: days }).status, 'pending');
  assert.equal(resolvePendingHorizon({ report_date: days[0], target_date: days[3], horizon_trading_days: 3, trading_days: days }).status, 'matured');
});

test('closing validation rejects missing, stale, wrong-date, and intraday data', () => {
  const rows = ['TAIEX','2330','TXF'].map((symbol) => ({ symbol, trading_date: '2026-08-27', phase: 'close', captured_at: '2026-08-27T14:20:00+08:00' }));
  assert.equal(validateClosingWindowData(rows, { trading_date: '2026-08-27' }).valid, true);
  assert.equal(validateClosingWindowData(rows.slice(0, 2), { trading_date: '2026-08-27' }).valid, false);
  assert.equal(validateClosingWindowData(rows.map((row) => ({ ...row, phase: 'intraday' })), { trading_date: '2026-08-27' }).valid, false);
  assert.equal(validateClosingWindowData(rows.map((row) => ({ ...row, captured_at: '2026-08-27T13:00:00+08:00' })), { trading_date: '2026-08-27' }).valid, false);
});

test('daily delivery phases use separate durable receipts through the public 07:30 deadline', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260827084613_production_reliability_daily_lifecycle.sql', import.meta.url), 'utf8');
  for (const phase of ['refresh', 'generate', 'repair', 'deliver', 'watchdog']) {
    assert.match(sql, new RegExp(`daily-\\w+-.*invoke_daily_delivery_tick_v2\\('${phase}'`));
    assert.match(sql, new RegExp(`'daily_'\\|\\|p_phase`));
  }
  assert.match(sql, /morning-alpha-daily-deliver-primary','23 23/);
  assert.match(sql, /morning-alpha-daily-deliver-watchdog','27 23/);
  assert.match(sql, /morning-alpha-daily-deadline-primary','30 23/);
  assert.match(sql, /morning-alpha-daily-deadline-watchdog','35 23/);
  assert.match(sql, /update public\.trading_day_state/);
  assert.match(sql, /when 'LEARNING_COMPLETED' then 130/);
});

test('historical replay stays isolated from production writes and notifications', () => {
  const result = simulateHistoricalFailureMatrix();
  assert.equal(result.result, 'PASS');
  assert.equal(result.scenarios.length, 5);
  assert.ok(result.scenarios.every((scenario) => scenario.no_production_write && scenario.no_duplicate_notification));
});

test('migration enforces receipts, RLS, idempotency, state monotonicity and isolated replay', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260827084613_production_reliability_daily_lifecycle.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'runtime_http_dispatches', 'runtime_http_dispatch_attempts', 'runtime_lifecycle_events', 'runtime_replay_artifacts',
    'force row level security', 'security_invoker=true', 'STATE_RANK_REGRESSION_BLOCKED', 'net._http_response',
    "status in ('PENDING','PROCESSING','SENT','FAILED','DEAD_LETTERED')", 'production_writes = 0', 'notifications_sent = 0',
    "when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2",
    'coalesce(v_response.timed_out,false)',
    'report_status', 'editorial_status', 'premium_status', 'line_status', 'content_os_status',
    'closing_status', 'learning_status', 'next_scheduled_at', 'recovery_executed',
    "v_success and v_row.job_name='closing_health'", "'HEALTH_AUDITED'", "'DAY_COMPLETED'",
  ]) assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(sql, /service_role_key|cron_secret\s*[:=]\s*['"][^'"]+/i);
});
