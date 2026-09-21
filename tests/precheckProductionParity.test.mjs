import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  REQUIRED_PROVIDER_CONFIG,
  normalizeRequiredFinnhubQuote,
  normalizeRequiredTaiwanCoreQuote,
  resolveRequiredTxfQuote,
  classifyRequiredProviderFailure,
  validateRequiredProviderEvidence,
} from '../supabase/functions/_shared/required-provider-validation.mjs';
import { CHECKPOINT_PROVIDER_KEYS, validateAtomicCheckpointEvidenceRows } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import { resolveFugle2330Provider, resolveFugleTaiexProvider } from '../supabase/functions/_shared/fugle-taiex-provider.mjs';
import { CHECKPOINT_MAX_SOURCE_AGE_MS } from '../supabase/functions/_shared/market-runtime-stability.mjs';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const capture = JSON.parse(source('tests/fixtures/production-parity-v2/provider-capture-20260916.json'));
const taiwan = JSON.parse(source('tests/fixtures/production-parity-v2/taiwan-premarket-capture-20260916.json'));
const discovery = JSON.parse(source('tests/fixtures/production-parity-v2/premarket-failure-20260916.json'));
const date = '2026-09-16';
const collection = observedAt => ({ phase: 'premarket', checkpoint: 'premarket', tradingDate: date,
  observedAt, correlationId: '16070000-0000-4000-8000-000000000001' });
const preflightInput = collection('2026-09-16T06:50:00+08:00');
const productionInput = collection('2026-09-16T07:00:00+08:00');

async function quoteFor(slot, payload) {
  if (slot.provider === 'finnhub') return normalizeRequiredFinnhubQuote(payload, slot.sourceSymbol);
  if (slot.key === 'TAIEX' || slot.key === '2330') {
    const resolver = slot.key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
    const resolved = await resolver(async request => request.endpoint.includes('/tickers?')
      ? { status: 200, payload: discovery.responses.TAIEX_DISCOVERY.payload }
      : { status: 200, payload }, { tradingDate: date, phase: 'premarket' });
    return normalizeRequiredTaiwanCoreQuote(resolved, slot.key);
  }
  const resolved = await resolveRequiredTxfQuote(async endpoint => endpoint === capture.responses.TXF.endpoint
    ? { status: 200, payload, error: null }
    : { status: 404, payload: null, error: 'HTTP_404' }, {
    phase: 'premarket', tradingDate: date, observedAt: preflightInput.observedAt,
    nowMs: Date.parse(preflightInput.observedAt),
  });
  return resolved.quote;
}

function responseFor(slot) {
  return slot.key === 'TAIEX' || slot.key === '2330'
    ? taiwan.responses[slot.key].payload : capture.responses[slot.key].payload;
}

async function both(slot, payload) {
  const quote = await quoteFor(slot, payload);
  return [preflightInput, productionInput].map(input => validateRequiredProviderEvidence(slot, quote, input));
}

test('PRECHECK_PRODUCTION_PARITY: 11 slots use one mapping, adapter, normalization, evidence and freshness core', async () => {
  assert.deepEqual(REQUIRED_PROVIDER_CONFIG.map(slot => slot.key), CHECKPOINT_PROVIDER_KEYS);
  assert.equal(capture.real_production_capture, true);
  assert.equal(taiwan.real_production_capture, true);
  const fetch = source('supabase/functions/fetch-market-data-v10/index.ts');
  const preflight = source('supabase/functions/market-readiness-preflight/index.ts');
  for (const shared of ['fetchRequiredFinnhubResponse', 'normalizeRequiredFinnhubQuote',
    'normalizeRequiredTaiwanCoreQuote', 'resolveRequiredTxfQuote', 'fetchRequiredFugleResponse',
    'validateRequiredProviderEvidence']) {
    assert.match(fetch, new RegExp(`\\b${shared}\\b`), `07:00 missing ${shared}`);
    assert.match(preflight, new RegExp(`\\b${shared}\\b`), `06:50 missing ${shared}`);
  }
  assert.match(fetch, /const SYMBOLS: SymbolConfig\[\] = REQUIRED_PROVIDER_CONFIG\.map/);
  assert.match(preflight, /REQUIRED_PROVIDER_CONFIG\.filter/);
  assert.match(preflight, /validateRequiredProviderRegistry\(REQUIRED_PROVIDER_CONFIG\)/);
  assert.match(fetch, /const quote = fetchedQuotes\.get\(config\) \?\? null;/);
  assert.match(fetch, /failure_code: classifyRequiredProviderFailure\(response\)/);
  assert.match(fetch, /failure_code: classifyRequiredProviderFailure\(observation\)/);
  assert.match(preflight, /classifyRequiredProviderFailure\(response, error\)/);
  assert.doesNotMatch(fetch, /normalizeConfiguredProxyQuote\(fetchedQuotes\.get\(config\) \?\? null, config\)[\s\S]*?validateRequiredProviderEvidence/);
  assert.match(preflight, /if \(mode === 'scheduled'\)/);
  assert.doesNotMatch(preflight, /\.rpc\(['"]commit_market_checkpoint_batch_v1/);
  const rows = [];
  for (const slot of REQUIRED_PROVIDER_CONFIG) {
    const [preflight, production] = await both(slot, responseFor(slot));
    assert.equal(preflight.valid, true, `${slot.key} 06:50`);
    assert.equal(production.valid, true, `${slot.key} 07:00`);
    assert.equal(preflight.row.source_timestamp, production.row.source_timestamp, slot.key);
    assert.equal(preflight.row.value, production.row.value, slot.key);
    assert.equal(preflight.row.change_percent, production.row.change_percent, slot.key);
    rows.push({ provider_key: slot.key, ...production.row });
  }
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).valid, true);
});

test('PRECHECK_PRODUCTION_PARITY: HTTP, stale and invalid-contract failures share one classification', () => {
  for (const [response, evidenceError, expected] of [
    [{ status: 404 }, null, 'RESOURCE_NOT_FOUND'],
    [{ status: 429 }, null, 'RATE_LIMITED'],
    [{ status: 200 }, 'INVALID_CHECKPOINT_SOURCE_TIME', 'STALE_PROVIDER_DATA'],
    [{ status: 200 }, 'INCOMPLETE_CHECKPOINT_QUOTE', 'PROVIDER_RESPONSE_CONTRACT_INVALID'],
  ]) {
    assert.equal(classifyRequiredProviderFailure(response, evidenceError), expected);
  }
});

test('PRECHECK_PRODUCTION_PARITY: invalid and nullable-field responses fail on both paths', async () => {
  for (const slot of REQUIRED_PROVIDER_CONFIG) {
    const bad = structuredClone(responseFor(slot));
    if (slot.provider === 'finnhub') bad.dp = null;
    else if (slot.key === 'TXF') { delete bad.closePrice; delete bad.lastUpdated; delete bad.closeTime; delete bad.lastTrade; delete bad.total; }
    else { bad.referencePrice = null; bad.previousClose = null; }
    const [preflight, production] = await both(slot, bad);
    assert.equal(preflight.valid, false, `${slot.key} 06:50 must fail`);
    assert.equal(production.valid, false, `${slot.key} 07:00 must fail`);
  }
});

test('PRECHECK_PRODUCTION_PARITY: stale, future and not-yet-formed phases never become a full batch', async () => {
  const taiex = structuredClone(responseFor(REQUIRED_PROVIDER_CONFIG.find(slot => slot.key === 'TAIEX')));
  taiex.date = '2026-09-15';
  const taiwanSlot = REQUIRED_PROVIDER_CONFIG.find(slot => slot.key === 'TAIEX');
  const [stalePreflight, staleProduction] = await both(taiwanSlot, taiex);
  assert.equal(stalePreflight.valid, false);
  assert.equal(staleProduction.valid, false);
  for (const slot of REQUIRED_PROVIDER_CONFIG) {
    const quote = await quoteFor(slot, responseFor(slot));
    const tomorrow = { ...preflightInput, tradingDate: '2026-09-17' };
    assert.equal(validateRequiredProviderEvidence(slot, quote, tomorrow).valid, false,
      `${slot.key} must not manufacture tomorrow's evidence`);
    const malformed = { ...quote, changePercent: null };
    assert.equal(validateRequiredProviderEvidence(slot, malformed, tomorrow).error, 'INCOMPLETE_CHECKPOINT_QUOTE',
      `${slot.key} invalid HTTP 200 cannot be hidden by tomorrow's expected market phase`);
  }
});

test('PRECHECK_PRODUCTION_PARITY: all eight US slots reject a 30-day-old quote before the Atomic commit', async () => {
  const rows = [];
  for (const slot of REQUIRED_PROVIDER_CONFIG) {
    const response = structuredClone(responseFor(slot));
    if (slot.provider === 'finnhub') response.t -= 30 * 86_400;
    const [preflight, production] = await both(slot, response);
    if (slot.provider === 'finnhub') {
      assert.equal(preflight.error, 'INVALID_CHECKPOINT_SOURCE_TIME', `${slot.key} 06:50`);
      assert.equal(production.error, 'INVALID_CHECKPOINT_SOURCE_TIME', `${slot.key} 07:00`);
      assert.equal(classifyRequiredProviderFailure({ status: 200 }, preflight.error), 'STALE_PROVIDER_DATA');
    } else {
      assert.equal(preflight.valid, true, `${slot.key} Taiwan preflight unaffected`);
      assert.equal(production.valid, true, `${slot.key} Taiwan production unaffected`);
      rows.push({ provider_key: slot.key, ...production.row });
    }
  }
  assert.equal(rows.length, 3);
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).error, 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY');
});

test('PRECHECK_PRODUCTION_PARITY: shared source-age ceiling equals the pinned Atomic database rule', () => {
  const atomic = source('supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql');
  const guard = atomic.match(/source_timestamp'\)::timestamptz < \(row_value->>'captured_at'\)::timestamptz - interval '(\d+) days'/);
  assert.ok(guard, 'the original Atomic seven-day source guard must remain pinned');
  assert.equal(CHECKPOINT_MAX_SOURCE_AGE_MS, Number(guard[1]) * 86_400_000);
  const later = source('supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql');
  assert.match(later, /v_baseline constant text := '[0-9a-f]{32}'/);
  assert.match(later, /v_candidate := replace\(replace\(replace\(v_original/);
});
