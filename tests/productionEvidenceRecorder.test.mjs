import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildProductionProviderEvidence,
  PRODUCTION_EVIDENCE_MAX_ROWS,
  PRODUCTION_EVIDENCE_RECORDER_VERSION,
  recordedEvidenceContainsSensitiveData,
  replayRecordedProviderEvidence,
  replayRecordedProviderEvidenceBatch,
  sanitizeRecordedEvidence,
  scheduleProductionEvidenceRecording,
} from '../supabase/functions/_shared/production-evidence-recorder.mjs';
import {
  REQUIRED_PROVIDER_CONFIG,
  normalizeRequiredFinnhubQuote,
  normalizeRequiredTaiwanCoreQuote,
  resolveRequiredTxfQuote,
  validateRequiredProviderEvidence,
} from '../supabase/functions/_shared/required-provider-validation.mjs';
import {
  FUGLE_2330_CONTRACT,
  FUGLE_TAIEX_CONTRACT,
  resolveFugle2330Provider,
  resolveFugleTaiexProvider,
} from '../supabase/functions/_shared/fugle-taiex-provider.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const capture = JSON.parse(read('tests/fixtures/production-parity-v2/provider-capture-20260916.json'));
const taiwan = JSON.parse(read('tests/fixtures/premarket-phase-v1/taiwan-session-20260916.json'));
const date = '2026-09-16';
const observedAt = '2026-09-16T06:50:00+08:00';
const correlationId = '16065000-0000-4000-8000-000000000001';
const evidenceInput = {
  phase: 'premarket', checkpoint: 'premarket', tradingDate: date, observedAt, correlationId,
};

async function resolved(slot, payload) {
  if (slot.provider === 'finnhub') return normalizeRequiredFinnhubQuote(payload, slot.sourceSymbol);
  if (slot.key === 'TAIEX' || slot.key === '2330') {
    const resolver = slot.key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
    const result = await resolver(async request => request.endpoint.includes('/tickers?')
      ? { status: 503, payload: null, error: 'DISCOVERY_UNAVAILABLE' }
      : { status: 200, payload, error: null }, { tradingDate: date, phase: 'premarket', observedAt });
    return normalizeRequiredTaiwanCoreQuote(result, slot.key);
  }
  const result = await resolveRequiredTxfQuote(async endpoint => endpoint === capture.responses.TXF.endpoint
    ? { status: 200, payload, error: null }
    : { status: 404, payload: null, error: 'HTTP_404' }, {
    phase: 'premarket', tradingDate: date, observedAt, nowMs: Date.parse(observedAt),
  });
  return result.quote;
}

function providerPayload(slot) {
  if (slot.key === 'TAIEX' || slot.key === '2330') return taiwan.responses[slot.key];
  return capture.responses[slot.key].payload;
}

function providerEndpoint(slot) {
  if (slot.key === 'TAIEX') return FUGLE_TAIEX_CONTRACT.tickerEndpoint;
  if (slot.key === '2330') return FUGLE_2330_CONTRACT.tickerEndpoint;
  return capture.responses[slot.key].endpoint;
}

async function inputFor(slot, overrides = {}) {
  const payload = structuredClone(providerPayload(slot));
  const quote = await resolved(slot, payload);
  const evidence = validateRequiredProviderEvidence(slot, quote, evidenceInput);
  assert.equal(evidence.valid, true, `${slot.key}: ${evidence.error || 'invalid'}`);
  return {
    businessDate: date,
    checkpoint: 'PREMARKET',
    validationCheckpoint: 'premarket',
    attempt: 1,
    transportAttempt: 1,
    attemptKey: `PREMARKET:1:1:${correlationId}`,
    providerKey: slot.key,
    provider: quote.provider,
    symbol: quote.sourceSymbol,
    endpoint: providerEndpoint(slot),
    httpStatus: 200,
    rawPayload: payload,
    normalizedQuote: quote,
    evidence,
    error: null,
    contractReason: null,
    marketPhase: 'premarket',
    observedAt,
    correlationId,
    adapterVersion: 'TEST_ADAPTER_V1',
    contractVersion: 'MARKET_CHECKPOINT_PROVIDER_V1',
    sourceFunction: 'fetch-market-data-v10',
    recordedAt: observedAt,
    ...overrides,
  };
}

async function elevenInputs() {
  return Promise.all(REQUIRED_PROVIDER_CONFIG.map(slot => inputFor(slot)));
}

test('normal 11/11 capture stores one deidentified replay row for every required provider', async () => {
  const rows = await Promise.all((await elevenInputs()).map(buildProductionProviderEvidence));
  assert.equal(rows.length, 11);
  assert.equal(new Set(rows.map(row => row.provider_key)).size, 11);
  assert.equal(rows.every(row => row.contract_result === 'PASS'), true);
  assert.equal(rows.every(row => row.recorder_version === PRODUCTION_EVIDENCE_RECORDER_VERSION), true);
  assert.equal(rows.every(row => /^[0-9a-f]{64}$/.test(row.raw_payload_hash)), true);
  assert.equal(rows.every(row => recordedEvidenceContainsSensitiveData(row) === false), true);
  assert.equal(rows.find(row => row.provider_key === 'TAIEX').evidence_session_date, '2026-09-15');
});

test('one failed provider preserves 10 PASS plus one explicit FAIL without fabricating payload', async () => {
  const inputs = await elevenInputs();
  const index = inputs.findIndex(input => input.providerKey === 'SPX');
  inputs[index] = {
    ...inputs[index], httpStatus: 404, rawPayload: {}, normalizedQuote: null,
    evidence: { valid: false, error: 'ATOMIC_PROVIDER_RESULT_MISSING' },
    error: 'HTTP_404', contractReason: 'RESOURCE_NOT_FOUND',
  };
  const rows = await Promise.all(inputs.map(buildProductionProviderEvidence));
  assert.equal(rows.filter(row => row.contract_result === 'PASS').length, 10);
  assert.equal(rows.filter(row => row.contract_result === 'FAIL').length, 1);
  const replay = await replayRecordedProviderEvidence(rows[index]);
  assert.equal(replay.contract_result, 'FAIL');
  assert.equal(replay.contract_reason, 'RESOURCE_NOT_FOUND');
  assert.equal(replay.deterministic, true);
});

test('three retries remain three append-only attempts and no upsert path exists', async () => {
  const base = await inputFor(REQUIRED_PROVIDER_CONFIG[0]);
  const inputs = [1, 2, 3].map(attempt => ({
    ...base, attempt, attemptKey: `PREMARKET:${attempt}:1:${correlationId}`,
  }));
  let scheduled;
  let inserted;
  let cleanupCalls = 0;
  const supabase = {
    from(table) {
      assert.equal(table, 'production_provider_evidence');
      return { insert: async rows => { inserted = rows; return { error: null }; } };
    },
    rpc(name, args) {
      assert.equal(name, 'cleanup_expired_production_provider_evidence_v1');
      assert.deepEqual(args, { p_limit: 1_000 });
      cleanupCalls++;
      return Promise.resolve({ data: 0, error: null });
    },
  };
  const result = scheduleProductionEvidenceRecording({
    supabase, inputs, scheduler: task => { scheduled = task; },
  });
  assert.deepEqual(result, { scheduled: true, row_count: 3 });
  await scheduled;
  assert.deepEqual(inserted.map(row => row.attempt), [1, 2, 3]);
  assert.equal(new Set(inserted.map(row => row.attempt_key)).size, 3);
  assert.equal(cleanupCalls, 1);
  assert.doesNotMatch(read('supabase/functions/_shared/production-evidence-recorder.mjs'), /\.upsert\(/);
});

test('recorder database failure is non-blocking and never changes business result', async () => {
  const inputs = [await inputFor(REQUIRED_PROVIDER_CONFIG[0])];
  let scheduled;
  const businessResult = { success: true, atomic: '11/11' };
  const start = performance.now();
  const scheduledResult = scheduleProductionEvidenceRecording({
    supabase: { from: () => ({ insert: async () => ({ error: { message: 'isolated recorder failure' } }) }) },
    inputs,
    scheduler: task => { scheduled = task; },
  });
  const schedulingLatencyMs = performance.now() - start;
  assert.deepEqual(scheduledResult, { scheduled: true, row_count: 1 });
  assert.ok(schedulingLatencyMs < 20, `non-blocking scheduling took ${schedulingLatencyMs}ms`);
  assert.deepEqual(businessResult, { success: true, atomic: '11/11' });
  assert.equal((await scheduled).ok, false);
});

test('sanitizer captures no secrets or PII and bounds nested payloads', () => {
  const sanitized = sanitizeRecordedEvidence({
    Authorization: 'Bearer real-secret', api_key: 'secret', cookie: 'session=secret',
    member: { email: 'person@example.com', phone: '0912345678' },
    market: { symbol: 'IX0001', value: 123 },
  });
  assert.equal(recordedEvidenceContainsSensitiveData(sanitized), false);
  assert.deepEqual(sanitized, { market: { symbol: 'IX0001', value: 123 } });
  assert.doesNotMatch(JSON.stringify(sanitized), /real-secret|person@example\.com|0912345678/);
});

test('recorded 11-provider evidence replays deterministically through current adapters and Atomic candidate validation', async () => {
  const rows = await Promise.all((await elevenInputs()).map(buildProductionProviderEvidence));
  const replay = await replayRecordedProviderEvidenceBatch(rows);
  assert.equal(replay.deterministic, true, JSON.stringify(replay.replayed.map(item => ({
    provider_key: item.provider_key,
    result: item.contract_result,
    reason: item.contract_reason,
    deterministic: item.deterministic,
    evidence_error: item.evidence.error || null,
  }))));
  assert.equal(replay.atomic_candidate_valid, true, replay.atomic_error || 'atomic replay failed');
  assert.equal(replay.replayed.length, PRODUCTION_EVIDENCE_MAX_ROWS);
});

test('migration enforces service-role-only append-only storage, 90-day bounded cleanup, and no Cron', () => {
  const sql = read('supabase/migrations/20260923124500_production_evidence_recorder_v1.sql');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table public\.production_provider_evidence from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select, insert on table public\.production_provider_evidence to service_role/i);
  assert.match(sql, /PRODUCTION_PROVIDER_EVIDENCE_APPEND_ONLY/);
  assert.match(sql, /recorded_at <= now\(\) - interval '90 days'/);
  assert.match(sql, /least\(coalesce\(p_limit, 1000\), 5000\)/);
  assert.doesNotMatch(sql, /cron\.|schedule\(/i);
});

test('06:50 and Fetch wire the same sidecar without making it a business gate', () => {
  const preflight = read('supabase/functions/market-readiness-preflight/index.ts');
  const fetch = read('supabase/functions/fetch-market-data-v10/index.ts');
  for (const source of [preflight, fetch]) {
    assert.match(source, /scheduleProductionEvidenceRecording/);
    assert.doesNotMatch(source, /await scheduleProductionEvidenceRecording/);
  }
  assert.match(preflight, /readiness_0650/);
  assert.match(fetch, /provider_retry_attempt/);
  assert.match(fetch, /recovery_attempt/);
});
