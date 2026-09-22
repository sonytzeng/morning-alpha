import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  FUGLE_2330_CONTRACT,
  FUGLE_TAIEX_CONTRACT,
  classifyFugleTaiexHttpFailure,
  normalizeFugleTaiwanCoreResult,
  resolveFugle2330Provider,
  resolveFugleTaiexProvider,
  validateFugle2330AdapterMapping,
  validateFugle2330Quote,
  validateFugle2330Ticker,
  validateFugleTaiexAdapterMapping,
  validateFugleTaiexDiscovery,
  validateFugleTaiexTicker,
} from '../supabase/functions/_shared/fugle-taiex-provider.mjs';
import {
  sanitizeProductionMarketPayload,
  stableJson,
} from '../supabase/functions/_shared/provider-reliability-contract.mjs';
import {
  CHECKPOINT_PROVIDER_KEYS,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import {
  classifyProviderFailure,
} from '../supabase/functions/_shared/market-runtime-stability.mjs';
import { summarizeProviderHealth } from '../supabase/functions/_shared/market-provider-adapter.mjs';

const fetchSource = readFileSync(new URL('../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url), 'utf8');
const capture = JSON.parse(readFileSync(new URL('./fixtures/production-parity-v2/provider-capture-20260916.json', import.meta.url), 'utf8'));
const failureCapture = JSON.parse(readFileSync(new URL('./fixtures/production-parity-v2/premarket-failure-20260916.json', import.meta.url), 'utf8'));
const phaseFixture = JSON.parse(readFileSync(new URL('./fixtures/premarket-phase-v1/taiwan-session-20260916.json', import.meta.url), 'utf8'));
const responseHash = payload => createHash('sha256')
  .update(stableJson(sanitizeProductionMarketPayload(payload))).digest('hex');

const officialDiscovery = {
  type: 'INDEX',
  exchange: 'TWSE',
  data: [{ symbol: 'IX0001', name: '發行量加權股價指數' }],
};
const officialQuote = {
  date: '2026-09-14',
  type: 'INDEX',
  exchange: 'TWSE',
  market: 'TSE',
  symbol: 'IX0001',
  name: '發行量加權股價指數',
  previousClose: 46940.49,
  closePrice: 47000,
  change: 59.51,
  changePercent: 0.13,
  lastUpdated: 1789347600000000,
};
const officialTicker = {
  date: '2026-09-14',
  type: 'INDEX',
  exchange: 'TWSE',
  market: 'TSE',
  symbol: 'IX0001',
  name: '發行量加權股價指數',
  previousClose: 46184.85,
  referencePrice: 46184.85,
  openTime: '09:00:00',
  closeTime: '13:30:00',
};

function evidenceRows(includeTaiex) {
  return CHECKPOINT_PROVIDER_KEYS.filter(key => includeTaiex || key !== 'TAIEX').map((key, index) => ({
    provider_key: key,
    symbol: key,
    value: 100 + index,
    change_percent: 0,
    source: key === 'TAIEX' ? 'fugle' : 'UNCHANGED_PROVIDER',
    source_timestamp: '2026-09-14T09:30:00+08:00',
    captured_at: '2026-09-14T09:30:00+08:00',
    raw: {
      contract: 'FETCH_CHECKPOINT_EVIDENCE_V1',
      market: ['TAIEX', '2330', 'TXF'].includes(key) ? 'TW' : 'US',
      change: 0,
      freshness_status: ['TAIEX', '2330', 'TXF'].includes(key) ? 'fresh' : 'provider_returned',
      freshness_age_minutes: 0,
      captured_session_date: '2026-09-14',
    },
  }));
}

test('official INDEX mapping is GET IX0001 and is startup-testable', () => {
  assert.deepEqual(FUGLE_TAIEX_CONTRACT, {
    provider: 'fugle',
    displaySymbol: 'TAIEX',
    symbol: 'IX0001',
    type: 'INDEX',
    exchange: 'TWSE',
    market: 'TSE',
    requestType: 'GET',
    discoveryEndpoint: 'stock/intraday/tickers?type=INDEX&exchange=TWSE',
    tickerEndpoint: 'stock/intraday/ticker/IX0001',
    quoteEndpoint: 'stock/intraday/quote/IX0001',
  });
  assert.equal(validateFugleTaiexAdapterMapping().valid, true);
  assert.equal(validateFugleTaiexAdapterMapping({ ...FUGLE_TAIEX_CONTRACT, symbol: 'TAIEX' }).failure_code, 'PROVIDER_SYMBOL_INVALID');
  assert.equal(validateFugleTaiexDiscovery(officialDiscovery).valid, true);
  assert.equal(validateFugleTaiexDiscovery({ ...officialDiscovery, data: [] }).failure_code, 'PROVIDER_SYMBOL_INVALID');
  assert.equal(validateFugleTaiexTicker(officialTicker, '2026-09-14').valid, true);
});

test('official symbol discovery then latest-completed-session ticker succeeds for premarket', async () => {
  const calls = [];
  const completedSessionTicker = { ...officialTicker, date: '2026-09-11' };
  const result = await resolveFugleTaiexProvider(async request => {
    calls.push(request);
    return request.endpoint.includes('tickers?')
      ? { status: 200, payload: officialDiscovery }
      : { status: 200, payload: completedSessionTicker };
  }, { tradingDate: '2026-09-14', phase: 'premarket', observedAt: '2026-09-14T07:00:00+08:00' });
  assert.equal(result.ok, true);
  assert.equal(result.symbol, 'IX0001');
  assert.equal(result.priceBasis, 'CURRENT_SESSION_REFERENCE_PRICE');
  assert.equal(result.referencePrice, 46184.85);
  assert.deepEqual(calls.map(call => call.endpoint), [
    'stock/intraday/ticker/IX0001',
    'stock/intraday/tickers?type=INDEX&exchange=TWSE',
  ]);
  assert.ok(calls.every(call => call.requestType === 'GET'));
  assert.doesNotMatch(calls.map(call => call.endpoint).join(' '), /quote\/TAIEX|tse_t00|api\.twse|previous/i);
});

test('premarket ticker accepts the prior completed session as the opening reference', async () => {
  const captured = {
    date: '2026-09-14', name: '發行量加權股價指數', type: 'INDEX', market: 'TSE',
    symbol: 'IX0001', exchange: 'TWSE', openTime: '0900', closeTime: '1330', previousClose: 45862.52,
  };
  const validated = validateFugleTaiexTicker(captured, '2026-09-14');
  assert.deepEqual(validated, {
    valid: true,
    reference_price: 45862.52,
    price_basis: 'CURRENT_SESSION_PREVIOUS_CLOSE_REFERENCE',
    source_timestamp: '2026-09-13T16:00:00.000Z',
    failure_code: null,
  });
  const result = await resolveFugleTaiexProvider(async request => request.endpoint.includes('tickers?')
    ? { status: 200, payload: officialDiscovery }
    : { status: 200, payload: captured }, {
    tradingDate: '2026-09-15', phase: 'premarket', observedAt: '2026-09-15T07:00:00+08:00',
  });
  assert.equal(result.ok, true);
  assert.equal(result.referencePrice, 45862.52);
  assert.equal(result.priceBasis, 'CURRENT_SESSION_PREVIOUS_CLOSE_REFERENCE');
});

test('9/16 current-date capture is rejected while empty discovery remains advisory for a valid completed-session fixture', async () => {
  const direct = capture.responses.TAIEX;
  const discovery = failureCapture.responses.TAIEX_DISCOVERY;
  assert.equal(capture.real_production_capture, true);
  assert.equal(failureCapture.real_production_capture, true);
  assert.equal(responseHash(direct.payload), direct.source_hash);
  assert.equal(responseHash(discovery.payload), discovery.source_hash);
  const rejected = await resolveFugleTaiexProvider(async request => request.endpoint.includes('tickers?')
    ? { status: discovery.http_status, payload: discovery.payload }
    : { status: direct.http_status, payload: direct.payload }, {
    tradingDate: '2026-09-16', phase: 'premarket', observedAt: '2026-09-16T07:00:00+08:00',
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failureCode, 'STALE_PROVIDER_DATA');

  assert.equal(phaseFixture.fixture_type, 'SYNTHETIC_CONTRACT_FIXTURE');
  const calls = [];
  const result = await resolveFugleTaiexProvider(async request => {
    calls.push(request.endpoint);
    return request.endpoint.includes('tickers?')
      ? { status: discovery.http_status, payload: discovery.payload }
      : { status: 200, payload: phaseFixture.responses.TAIEX };
  }, { tradingDate: '2026-09-16', phase: 'premarket', observedAt: '2026-09-16T07:00:00+08:00' });
  assert.equal(result.ok, true);
  assert.equal(result.discoveryStatus, 'EMPTY_PHASE_VARIANT_DIRECT_RESOURCE_VALID');
  assert.deepEqual(calls, [FUGLE_TAIEX_CONTRACT.tickerEndpoint, FUGLE_TAIEX_CONTRACT.discoveryEndpoint]);
  const normalized = normalizeFugleTaiwanCoreResult(result, 'TAIEX');
  assert.equal(normalized.sourceSymbol, 'IX0001');
  assert.equal(normalized.value, 45000);
  assert.equal(normalized.raw.date, '2026-09-15');
});

test('2330 uses ticker before open, quote intraday, and rejects stale or malformed contracts', async () => {
  assert.equal(validateFugle2330AdapterMapping().valid, true);
  assert.deepEqual(FUGLE_2330_CONTRACT, {
    provider: 'fugle', displaySymbol: '2330', symbol: '2330', type: 'EQUITY',
    exchange: 'TWSE', market: 'TSE', requestType: 'GET',
    tickerEndpoint: 'stock/intraday/ticker/2330', quoteEndpoint: 'stock/intraday/quote/2330',
  });
  const ticker = {
    date: '2026-09-15', type: 'EQUITY', exchange: 'TWSE', market: 'TSE',
    symbol: '2330', name: '台積電', previousClose: 2385, referencePrice: 2385,
  };
  const premarketCalls = [];
  const premarket = await resolveFugle2330Provider(async request => {
    premarketCalls.push(request.endpoint);
    return { status: 200, payload: ticker };
  }, { tradingDate: '2026-09-16', phase: 'premarket', observedAt: '2026-09-16T07:00:00+08:00' });
  assert.equal(premarket.ok, true);
  assert.deepEqual(premarketCalls, [FUGLE_2330_CONTRACT.tickerEndpoint]);
  assert.equal(normalizeFugleTaiwanCoreResult(premarket, '2330').value, 2385);

  const quote = capture.responses['2330'];
  assert.equal(responseHash(quote.payload), quote.source_hash);
  assert.equal(validateFugle2330Quote(quote.payload, '2026-09-16').valid, true);
  const intraday = await resolveFugle2330Provider(async request => ({
    status: quote.http_status, payload: quote.payload, endpoint: request.endpoint,
  }), { tradingDate: '2026-09-16', phase: 'intraday' });
  assert.equal(intraday.ok, true);
  assert.equal(intraday.endpoint, FUGLE_2330_CONTRACT.quoteEndpoint);
  assert.equal(validateFugle2330Ticker({ ...ticker, date: '2026-09-15' }, '2026-09-16').failure_code, 'STALE_PROVIDER_DATA');
  assert.equal(validateFugle2330Ticker({ ...ticker, referencePrice: 0, previousClose: null }, '2026-09-15').failure_code, 'PROVIDER_RESPONSE_CONTRACT_INVALID');
});

test('missing/zero current-session reference fields fail closed without stale fallback', () => {
  for (const ticker of [
    { ...officialTicker, referencePrice: undefined, previousClose: undefined },
    { ...officialTicker, referencePrice: null, previousClose: 0 },
    { ...officialTicker, referencePrice: 0, previousClose: -1 },
  ]) {
    assert.equal(validateFugleTaiexTicker(ticker, '2026-09-14').failure_code, 'PROVIDER_RESPONSE_CONTRACT_INVALID');
  }
  assert.equal(validateFugleTaiexTicker({ ...officialTicker, date: '2026-09-11', referencePrice: undefined }, '2026-09-14').failure_code, 'STALE_PROVIDER_DATA');
});

test('official symbol discovery then current-session quote succeeds intraday', async () => {
  const calls = [];
  const result = await resolveFugleTaiexProvider(async request => {
    calls.push(request);
    return request.endpoint.includes('tickers?')
      ? { status: 200, payload: officialDiscovery }
      : { status: 200, payload: officialQuote };
  }, { tradingDate: '2026-09-14', phase: 'intraday' });
  assert.equal(result.ok, true);
  assert.equal(result.priceBasis, 'CURRENT_SESSION_QUOTE');
  assert.deepEqual(calls.map(call => call.endpoint), [
    'stock/intraday/quote/IX0001',
    'stock/intraday/tickers?type=INDEX&exchange=TWSE',
  ]);
});

test('legacy or unknown symbol 404 is explicit and official-resource 404 remains fail-closed', async () => {
  assert.equal(classifyFugleTaiexHttpFailure(404, 'TAIEX'), 'PROVIDER_SYMBOL_INVALID');
  assert.equal(classifyFugleTaiexHttpFailure(404, 'OLD_TAIEX'), 'PROVIDER_SYMBOL_INVALID');
  assert.equal(classifyFugleTaiexHttpFailure(404, 'IX0001'), 'RESOURCE_NOT_FOUND');
  assert.equal(classifyFugleTaiexHttpFailure(404, null), 'RESOURCE_NOT_FOUND');
  const result = await resolveFugleTaiexProvider(async request => request.endpoint.includes('tickers?')
    ? { status: 200, payload: officialDiscovery }
    : { status: 404, error: 'Resource Not Found' }, { tradingDate: '2026-09-14', phase: 'intraday' });
  assert.deepEqual({ ok: result.ok, code: result.failureCode, status: result.status }, {
    ok: false,
    code: 'RESOURCE_NOT_FOUND',
    status: 404,
  });
  assert.equal(classifyProviderFailure({
    provider: 'fugle', symbol: 'TAIEX', endpoint: result.endpoint, status: result.status,
    error: result.error, failure_code: result.failureCode,
  }).failure_code, 'RESOURCE_NOT_FOUND');
});

test('an older-than-latest completed TAIEX session is rejected instead of masquerading as valid premarket evidence', async () => {
  const previousDay = { ...officialTicker, date: '2026-09-10' };
  const result = await resolveFugleTaiexProvider(async request => request.endpoint.includes('tickers?')
    ? { status: 200, payload: officialDiscovery }
    : { status: 200, payload: previousDay }, {
    tradingDate: '2026-09-14', phase: 'premarket', observedAt: '2026-09-14T07:00:00+08:00',
  });
  assert.deepEqual({ ok: result.ok, code: result.failureCode, error: result.error }, {
    ok: false,
    code: 'STALE_PROVIDER_DATA',
    error: 'previous_day_taiex_rejected',
  });
});

test('TAIEX provider failure yields atomic 0-or-11 rejection; recovery yields 11-of-11 health', () => {
  const missingTaiex = validateAtomicCheckpointEvidenceRows(evidenceRows(false));
  assert.deepEqual(missingTaiex, {
    valid: false,
    error: 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY',
    rowCount: 10,
  });
  assert.equal(validateAtomicCheckpointEvidenceRows(evidenceRows(true)).valid, true);
  assert.deepEqual(summarizeProviderHealth({ requested_count: 11, succeeded_count: 11, failed_count: 0 }), {
    status: 'healthy',
    success_rate: 100,
    requested_count: 11,
    succeeded_count: 11,
    failed_count: 0,
    timed_out: false,
  });
});

test('adapter has no stale, legacy-symbol or cross-provider fallback and leaves the other ten slots unchanged', () => {
  assert.match(fetchSource, /resolveFugleTaiexProvider/);
  assert.doesNotMatch(fetchSource, /fugleIndexCandidates/);
  assert.doesNotMatch(fetchSource, /fetchTwseQuote\("tse_t00\.tw", "TAIEX"/);
  assert.deepEqual(CHECKPOINT_PROVIDER_KEYS.filter(key => key !== 'TAIEX'), [
    'SPX', 'IXIC', 'SOX', 'NVDA', 'TSM', 'VIX', 'DXY', 'US10Y', '2330', 'TXF',
  ]);
  assert.match(fetchSource, /commit_market_checkpoint_batch_v1/);
  assert.match(fetchSource, /CHECKPOINT_PROVIDER_KEYS\.length/);
  assert.equal(classifyProviderFailure({
    provider: 'finnhub', symbol: 'SPX', endpoint: 'quote', status: 404, error: 'Resource Not Found',
  }).failure_code, 'PROVIDER_REQUEST_REJECTED');
  assert.equal(classifyProviderFailure({
    provider: 'finnhub', symbol: 'NVDA', endpoint: 'quote', status: 429, error: 'rate limit',
  }).failure_code, 'RATE_LIMITED');
  assert.equal(classifyProviderFailure({
    provider: 'fugle', symbol: '2330', endpoint: 'quote', status: 500, error: 'upstream unavailable',
  }).failure_code, 'PROVIDER_UNAVAILABLE');
});
