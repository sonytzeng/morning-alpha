import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateRealProductionCapture, replayProductionRealityProviderBatch } from './helpers/productionRealityProviderReplay.mjs';
import { previousTradingDay } from '../supabase/functions/_shared/market-status.ts';
import { evaluatePremarketCoreReadiness, PREMARKET_LAST_COLLECTION_MINUTES, PREMARKET_REPORT_DEADLINE_MINUTES } from '../supabase/functions/_shared/premarket-provider-readiness.mjs';
import { resolveFugle2330Provider, resolveFugleTaiexProvider } from '../supabase/functions/_shared/fugle-taiex-provider.mjs';
import { REQUIRED_PROVIDER_CONFIG, normalizeRequiredFinnhubQuote, normalizeRequiredTaiwanCoreQuote, resolveRequiredTxfQuote, validateRequiredProviderEvidence } from '../supabase/functions/_shared/required-provider-validation.mjs';
import { CHECKPOINT_PROVIDER_KEYS, checkpointBatchIdempotencyKey, validateAtomicCheckpointEvidenceRows, checkpointCollectionContract } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import { classifyProviderFailure } from '../supabase/functions/_shared/market-runtime-stability.mjs';
import { buildPremarketProviderReadinessPlan, resolvePremarketReadinessTiming } from '../supabase/functions/_shared/daily-delivery-recovery.ts';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const current = JSON.parse(read('tests/fixtures/premarket-readiness-v1/production-current-20260917.json'));
const previous = JSON.parse(read('tests/fixtures/production-parity-v2/taiwan-premarket-capture-20260916.json'));
const timeline = JSON.parse(read('docs/operations/evidence/premarket-provider-readiness-timeline-20260917.json'));
const preflightSource = read('supabase/functions/market-readiness-preflight/index.ts');
const fetchSource = read('supabase/functions/fetch-market-data-v10/index.ts');
const orchestratorSource = read('supabase/functions/daily-delivery-orchestrator/index.ts');
const migrationSource = read('supabase/migrations/20260917090000_premarket_readiness_retry_window.sql');
const date = current.business_date;
const previousDate = previousTradingDay(date);
const correlationId = '17083116-0000-4000-8000-000000000001';
const input = observedAt => ({ phase: 'premarket', checkpoint: 'premarket', tradingDate: date, observedAt, correlationId });

async function taiwanResult(key, payload, status = 200, observedAt = `${date}T07:00:00+08:00`) {
  const resolve = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
  return resolve(async request => request.endpoint.includes('/tickers?')
    ? { status: 200, payload: { type: 'INDEX', exchange: 'TWSE', data: [] } }
    : { status, payload }, { tradingDate: date, phase: 'premarket', observedAt });
}

async function currentBatch(observedAt = current.capture_time) {
  const evidence = [];
  for (const slot of REQUIRED_PROVIDER_CONFIG) {
    const captured = current.responses[slot.key];
    let quote;
    if (slot.provider === 'finnhub') quote = normalizeRequiredFinnhubQuote(captured.payload, slot.sourceSymbol);
    else if (slot.key === 'TAIEX' || slot.key === '2330') {
      const result = await taiwanResult(slot.key, previous.responses[slot.key].payload, 200, observedAt);
      assert.equal(result.ok, true, `${slot.key} latest-completed-session adapter`);
      quote = normalizeRequiredTaiwanCoreQuote(result, slot.key);
    } else {
      const result = await resolveRequiredTxfQuote(async endpoint => endpoint === captured.endpoint
        ? { status: 200, payload: captured.payload, error: null }
        : { status: 404, payload: null, error: 'HTTP_404' }, {
        phase: 'premarket', tradingDate: date, observedAt, nowMs: Date.parse(observedAt),
      });
      quote = result.quote;
    }
    const checked = validateRequiredProviderEvidence(slot, quote, input(observedAt));
    assert.equal(checked.valid, true, `${slot.key}: ${checked.error || 'invalid'}`);
    evidence.push({ provider_key: slot.key, ...checked.row });
  }
  return evidence;
}

test('9/17 timeline provenance is exact: old response date was rejected, first current-date observation is bounded, not guessed', () => {
  validateRealProductionCapture(current, CHECKPOINT_PROVIDER_KEYS);
  assert.equal(previousDate, '2026-09-16');
  assert.equal(current.capture_time, '2026-09-17T08:31:16.914245+08:00');
  assert.equal(current.lineage.request_id, 516);
  assert.deepEqual(current.lineage.business_writes, []);
  assert.equal(timeline.observations.length, 8);
  assert.match(timeline.transition_bound, /After 07:30.*08:31/);
  assert.match(timeline.usual_ready_time, /^UNKNOWN:/);
  assert.equal(timeline.historical_20260917_mutations, false);
  for (const key of ['TAIEX', '2330']) {
    assert.equal(previous.responses[key].payload.date, previousDate);
    assert.equal(current.responses[key].payload.date, date);
    assert.equal(current.responses[key].http_status, 200);
  }
});

test('06:50 and 07:00 accept prior/current ticker envelopes for the same latest completed Taiwan session', async () => {
  for (const key of ['TAIEX', '2330']) {
    const result = await taiwanResult(key, previous.responses[key].payload);
    assert.equal(result.ok, true);
    for (const minute of [410, 420, 450, 515]) {
      const state = evaluatePremarketCoreReadiness({ key, result, tradingDate: date, previousTradingDate: previousDate, taipeiMinutes: minute });
      assert.equal(state.state, 'PREMARKET_BASELINE_VALID');
      assert.equal(state.failure_code, null);
      assert.equal(state.source_business_date, previousDate);
    }
    const currentDay = await taiwanResult(key, current.responses[key].payload);
    assert.equal(currentDay.ok, true);
    assert.equal(currentDay.validation.provider_envelope_date, date);
    assert.equal(currentDay.validation.evidence_session_date, previousDate);
    assert.equal(currentDay.validation.session_contract.provider_session_date, previousDate);
  }
  assert.match(preflightSource, /resolveFugleTaiexProvider/);
  assert.match(fetchSource, /resolveFugleTaiexProvider/);
  assert.match(preflightSource, /observedAt: String\(evidenceInput\.observedAt \|\| ''\)/);
  assert.match(fetchSource, /\{ tradingDate, phase, observedAt \}/);
  const preflightReadiness = isolatedFunction(preflightSource, 'readiness');
  assert.equal(preflightReadiness([
    ...Array.from({ length: 9 }, (_, index) => ({ key: `other-${index}`, status: 'PASS' })),
    { key: 'TAIEX', status: 'WAITING', failure_code: 'PROVIDER_DATA_NOT_READY' },
    { key: '2330', status: 'WAITING', failure_code: 'PROVIDER_DATA_NOT_READY' },
  ]), 'WAITING_FOR_MARKET_DATA');
  assert.equal(preflightReadiness([{ key: 'TAIEX', status: 'FAIL', failure_code: 'PROVIDER_SYMBOL_INVALID' }]), 'BLOCKED');
});

test('Scenario 1: already-ready real Production capture still yields 11/11', async () => {
  const replay = await replayProductionRealityProviderBatch();
  assert.equal(replay.real_production_capture, true);
  assert.equal(replay.atomic.valid, true);
  assert.equal(replay.evidence.length, 11);
});

test('Scenario 2: latest completed session permits one fresh 11/11 batch inside bounded window', async () => {
  assert.equal(PREMARKET_LAST_COLLECTION_MINUTES, 524);
  const rows = await currentBatch();
  assert.deepEqual(rows.map(row => row.provider_key), CHECKPOINT_PROVIDER_KEYS);
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).valid, true);
  assert.equal(new Set(rows.map(row => row.correlation_id)).size, 1);
  assert.equal(checkpointCollectionContract(input('2026-09-17T08:45:00+08:00')).valid, false);
  assert.match(fetchSource, /premarketDeadlineReached/);
  assert.match(fetchSource, /PREMARKET_READINESS_DEADLINE_EXCEEDED/);
});

test('Scenarios 2/3: real provider failures still use bounded retry; a valid prior session never enters it', async () => {
  const validBaseline = await Promise.all(['TAIEX', '2330'].map(async key => taiwanResult(key, previous.responses[key].payload)));
  assert.equal(validBaseline.every((result, index) => evaluatePremarketCoreReadiness({ key: ['TAIEX', '2330'][index], result }).state === 'PREMARKET_BASELINE_VALID'), true);
  for (const minutes of [420, 423, 450, 460, 515]) {
    const plan = buildPremarketProviderReadinessPlan({ has_report: false, premium_eligible: false, reason_codes: [], attempt: 10, taipei_minutes: minutes, provider_not_ready: true });
    assert.equal(plan.deadline_reached, false);
    assert.equal(plan.retry_after_seconds, 300);
    assert.ok(plan.actions.includes('refresh_market'));
    assert.ok(!plan.actions.includes('deliver_incident'));
    assert.equal(validateAtomicCheckpointEvidenceRows([]).valid, false);
  }
  const final = buildPremarketProviderReadinessPlan({ has_report: false, premium_eligible: false, reason_codes: [], attempt: 11, taipei_minutes: 525, provider_not_ready: true });
  assert.equal(final.deadline_reached, true);
  assert.deepEqual(final.actions, ['deliver_incident']);
  assert.equal(final.retry_after_seconds, null);
  assert.match(migrationSource, /v_date <= date '2026-09-17'/);
  assert.match(migrationSource, /40,45,50,55 23/);
  assert.match(migrationSource, /0,5,10,15,20,25,30,35 0/);
  assert.match(migrationSource, /45 0 \* \* 1-5/);
});

test('Scenario 4: malformed data and wrong previous session never become WAITING', async () => {
  for (const key of ['TAIEX', '2330']) {
    const bad = structuredClone(previous.responses[key].payload);
    bad.symbol = 'INVALID';
    const malformed = await taiwanResult(key, bad);
    const state = evaluatePremarketCoreReadiness({ key, result: malformed, tradingDate: date, previousTradingDate: previousDate, taipeiMinutes: 420 });
    assert.equal(state.state, 'FAIL');
    const old = structuredClone(previous.responses[key].payload);
    old.date = '2026-09-15';
    const older = await taiwanResult(key, old);
    assert.equal(evaluatePremarketCoreReadiness({ key, result: older, tradingDate: date, previousTradingDate: previousDate, taipeiMinutes: 420 }).state, 'FAIL');
  }
});

test('Scenario 5: HTTP failure retains the existing provider failure policy', async () => {
  const result = await taiwanResult('TAIEX', null, 503);
  assert.equal(evaluatePremarketCoreReadiness({ key: 'TAIEX', result, tradingDate: date, previousTradingDate: previousDate, taipeiMinutes: 420 }).state, 'FAIL');
  const classified = classifyProviderFailure({ symbol: 'TAIEX', provider: 'fugle', status: 503, error: 'HTTP_503' });
  assert.notEqual(classified.failure_code, 'PROVIDER_DATA_NOT_READY');
});

test('Scenario 6: repeated triggers retain one batch identity; incomplete attempts never contribute rows to the final 11', async () => {
  const rows = await currentBatch();
  const key = checkpointBatchIdempotencyKey(date, 'PREMARKET');
  const committed = new Map();
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt < 10 ? rows.filter(row => !['TAIEX', '2330'].includes(row.provider_key)) : rows;
    const validated = validateAtomicCheckpointEvidenceRows(candidate);
    if (validated.valid && !committed.has(key)) committed.set(key, candidate);
  }
  assert.equal(committed.size, 1);
  assert.equal(committed.get(key).length, 11);
  assert.match(orchestratorSource, /claimPipelineSlot\(/);
  assert.match(orchestratorSource, /loadProviderNotReady\(/);
  assert.match(migrationSource, /premarket_readiness_retry_' \|\| v_slot/);
});

test('late reliable recovery is still a 07:30 delivery SLA miss, never a shifted deadline', () => {
  const base = { report_date: date, provider_delay_context: true, report_eligible: true, provider_not_ready: false, delivered: true };
  const onTime = resolvePremarketReadinessTiming({ ...base, completed_at: `${date}T07:29:59+08:00` });
  assert.equal(onTime.delivery_sla_status, 'MET');
  assert.equal(onTime.readiness_recovery_status, null);
  const late = resolvePremarketReadinessTiming({ ...base, completed_at: `${date}T08:31:00+08:00` });
  assert.equal(late.delivery_sla_status, 'MISS');
  assert.equal(late.readiness_recovery_status, 'RECOVERED_WITHIN_READINESS_WINDOW');
  assert.equal(late.readiness_window_deadline_at, `${date}T00:45:00.000Z`);
  const waiting = resolvePremarketReadinessTiming({ ...base, completed_at: `${date}T07:40:00+08:00`, provider_not_ready: true, report_eligible: false, delivered: false });
  assert.equal(waiting.delivery_sla_status, 'MISS');
  assert.equal(waiting.readiness_recovery_status, null);
  const expired = resolvePremarketReadinessTiming({ ...base, completed_at: `${date}T08:45:00+08:00` });
  assert.equal(expired.readiness_recovery_status, null);
  assert.match(orchestratorSource, /deadline_at: new Date\(`\$\{details\.report_date\}T07:30:00\+08:00`\)/);
});
