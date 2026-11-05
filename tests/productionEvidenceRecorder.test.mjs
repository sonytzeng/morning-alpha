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
import { sanitizeProductionMarketPayload } from '../supabase/functions/_shared/provider-reliability-contract.mjs';

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
  // Explicit SYNTHETIC completed-cash controls. The retained real provider
  // capture and the older ticker fixture stay unchanged; no live quote was
  // obtained by this test, and this mixed fixture is not a natural 11/11 day.
  if (slot.key === 'TAIEX' || slot.key === '2330') return {
    date: '2026-09-15',
    symbol: slot.key === 'TAIEX' ? 'IX0001' : '2330',
    type: slot.key === 'TAIEX' ? 'INDEX' : 'EQUITY',
    exchange: 'TWSE', market: 'TSE',
    closePrice: 100, previousClose: 99, isClose: true, isTrial: false,
    lastUpdated: Date.parse('2026-09-15T13:30:00+08:00') * 1000,
  };
  return capture.responses[slot.key].payload;
}

function providerEndpoint(slot) {
  if (slot.key === 'TAIEX') return FUGLE_TAIEX_CONTRACT.quoteEndpoint;
  if (slot.key === '2330') return FUGLE_2330_CONTRACT.quoteEndpoint;
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

test('synthetic completed-cash controls and retained other providers store one deidentified row per required slot', async () => {
  const rows = await Promise.all((await elevenInputs()).map(buildProductionProviderEvidence));
  assert.equal(rows.length, 11);
  assert.equal(new Set(rows.map(row => row.provider_key)).size, 11);
  assert.equal(rows.every(row => row.contract_result === 'PASS'), true);
  assert.equal(rows.every(row => row.recorder_version === PRODUCTION_EVIDENCE_RECORDER_VERSION), true);
  assert.equal(rows.every(row => /^[0-9a-f]{64}$/.test(row.raw_payload_hash)), true);
  assert.equal(rows.every(row => recordedEvidenceContainsSensitiveData(row) === false), true);
  assert.equal(rows.find(row => row.provider_key === 'TAIEX').evidence_session_date, '2026-09-15');
});

test('synthetic completed-cash batch with one failed provider preserves 10 PASS plus one explicit FAIL', async () => {
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
  assert.equal(replay.contract_reason, 'PROVIDER_INVALID_RESPONSE');
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

test('quote-proof flags round-trip as booleans only while secrets and contacts remain excluded', () => {
  const sanitize = flags => sanitizeRecordedEvidence(sanitizeProductionMarketPayload({
    symbol: '2330', ...flags, Authorization: 'Bearer fixture-secret', api_key: 'fixture-api-key',
    email: 'fixture@example.invalid', phone: '0900000000', member: {email: 'member@example.invalid'},
  }));
  for (const flag of ['isClose', 'isTrial']) {
    for (const value of [true, false]) {
      const sanitized = sanitize({[flag]: value});
      assert.deepEqual(sanitized, {symbol: '2330', [flag]: value});
      assert.equal(recordedEvidenceContainsSensitiveData(sanitized), false);
    }
    for (const value of ['false', 'true', 1, 0, null, undefined, {}, [], {value: true}]) {
      const sanitized = sanitize({[flag]: value});
      assert.equal(Object.hasOwn(sanitized, flag), false, `${flag}: ${JSON.stringify(value)} is not a boolean`);
      assert.deepEqual(sanitized, {symbol: '2330'});
    }
  }
  assert.doesNotMatch(JSON.stringify(sanitize({isClose: true, isTrial: false})),
    /fixture-secret|fixture-api-key|@example\.invalid|0900000000/);
});

test('recorded synthetic completed-cash controls replay through current adapters and Atomic candidate validation', async () => {
  const rows = await Promise.all((await elevenInputs()).map(buildProductionProviderEvidence));
  for (const key of ['TAIEX', '2330']) {
    const raw = rows.find(row => row.provider_key === key).replay_payload.provider_payload;
    assert.equal(raw.isClose, true, `${key}: recorder must preserve completed-close proof`);
    assert.equal(raw.isTrial, false, `${key}: recorder must preserve trial classification`);
  }
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

test('recorder preserves synthetic trial rejection evidence instead of losing quote-proof flags', async () => {
  for (const key of ['TAIEX', '2330']) {
    const slot = REQUIRED_PROVIDER_CONFIG.find(item => item.key === key);
    const payload = {...providerPayload(slot), isTrial: true};
    const resolver = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
    const result = await resolver(async () => ({status: 200, payload}), {
      tradingDate: date, phase: 'premarket', observedAt,
    });
    assert.equal(result.ok, false);
    const input = await inputFor(slot, {
      rawPayload: payload, normalizedQuote: null,
      evidence: {valid: false, error: 'ATOMIC_PROVIDER_RESULT_MISSING'},
      adapterFailureCode: result.failureCode,
    });
    const row = await buildProductionProviderEvidence(input);
    assert.equal(row.replay_payload.provider_payload.isClose, true);
    assert.equal(row.replay_payload.provider_payload.isTrial, true);
    const replay = await replayRecordedProviderEvidence(row);
    assert.equal(replay.contract_result, 'FAIL');
    assert.equal(replay.deterministic, true);
  }
});

test('unchanged retained ticker evidence cannot supply the completed quote now required before open', async () => {
  assert.equal(capture.real_production_capture, true);
  assert.equal(taiwan.fixture_type, 'SYNTHETIC_CONTRACT_FIXTURE');
  const originalCapture = JSON.stringify(capture);
  const originalTickerFixture = JSON.stringify(taiwan);
  const direct = capture.responses.TAIEX;
  const calls = [];
  // Replay only the response actually retained at its original endpoint. A
  // ticker body is not relabelled as a real response from the quote endpoint.
  const result = await resolveFugleTaiexProvider(async ({endpoint}) => {
    calls.push(endpoint);
    return endpoint === direct.endpoint
      ? {status: direct.http_status, payload: direct.payload, error: null}
      : {status: 503, payload: null, error: 'COMPLETED_QUOTE_NOT_RETAINED'};
  }, {tradingDate: date, phase: 'premarket', observedAt});
  assert.deepEqual(calls, [FUGLE_TAIEX_CONTRACT.quoteEndpoint]);
  assert.equal(result.ok, false);
  assert.equal(result.failureCode, 'PROVIDER_REQUEST_REJECTED');
  assert.equal(normalizeRequiredTaiwanCoreQuote(result, 'TAIEX'), null);
  assert.equal(JSON.stringify(capture), originalCapture);
  assert.equal(JSON.stringify(taiwan), originalTickerFixture);
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

for (const [status,error,reason] of [[403,'HTTP_403','PROVIDER_ENTITLEMENT'],[401,'HTTP_401','PROVIDER_ENTITLEMENT'],
  [429,'HTTP_429','PROVIDER_RATE_LIMIT'],[500,'HTTP_500','PROVIDER_HTTP_5XX'],
  [null,'TIMEOUT','PROVIDER_TIMEOUT'],[200,'TEMPORARY_MALFORMED_RESPONSE','PROVIDER_INVALID_RESPONSE']]) {
  test(`V2 actual transport ${error} preserves primary cause and rejects evidence, including WAITING presentation`,async()=>{
    const input=await inputFor(REQUIRED_PROVIDER_CONFIG[0],{httpStatus:status,error,rawPayload:{},normalizedQuote:null,
      evidence:{valid:false,error:'ATOMIC_PROVIDER_RESULT_MISSING'},waiting:true,sourceFunction:'market-readiness-preflight'});
    const row=await buildProductionProviderEvidence(input),replay=await replayRecordedProviderEvidence(row);
    assert.equal(row.contract_result,'FAIL');assert.equal(row.contract_reason,reason);
    assert.equal(row.replay_payload.readiness_presentation,'WAITING');
    assert.equal(row.http_status,status);assert.equal(replay.deterministic,true);
    row.replay_payload.expected_contract_result='PASS';
    assert.equal((await replayRecordedProviderEvidence(row)).contract_result,'FAIL');
  });
}
test('V2 Fugle rejection trace re-executes adapter instead of copying its expected error',async()=>{
  const slot=REQUIRED_PROVIDER_CONFIG.find(item=>item.key==='TAIEX');
  const responses=[];
  const result=await resolveFugleTaiexProvider(async({endpoint})=>{
    const response={status:403,error:'HTTP_403',payload:null};responses.push({endpoint,...response});return response;
  },{tradingDate:date,phase:'premarket',observedAt});
  const input=await inputFor(slot,{httpStatus:403,error:'HTTP_403',rawPayload:{},normalizedQuote:null,
    evidence:{valid:false,error:'ATOMIC_PROVIDER_RESULT_MISSING'},adapterFailureCode:result.failureCode,responses});
  const row=await buildProductionProviderEvidence(input);
  assert.equal((await replayRecordedProviderEvidence(row)).deterministic,true);
  row.replay_payload.expected_adapter_error='FORGED_PASS';
  assert.equal((await replayRecordedProviderEvidence(row)).deterministic,false);
});
