import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  FUGLE_TAIEX_CONTRACT,
  classifyFugleTaiexHttpFailure,
  resolveFugleTaiexProvider,
  validateFugleTaiexAdapterMapping,
  validateFugleTaiexDiscovery,
  validateFugleTaiexTicker,
} from '../supabase/functions/_shared/fugle-taiex-provider.mjs';
import {
  CHECKPOINT_PROVIDER_KEYS,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import {
  classifyProviderFailure,
} from '../supabase/functions/_shared/market-runtime-stability.mjs';
import { summarizeProviderHealth } from '../supabase/functions/_shared/market-provider-adapter.mjs';

const fetchSource = readFileSync(new URL('../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url), 'utf8');

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

test('official symbol discovery then current-session ticker succeeds for premarket', async () => {
  const calls = [];
  const result = await resolveFugleTaiexProvider(async request => {
    calls.push(request);
    return calls.length === 1
      ? { status: 200, payload: officialDiscovery }
      : { status: 200, payload: officialTicker };
  }, { tradingDate: '2026-09-14', phase: 'premarket' });
  assert.equal(result.ok, true);
  assert.equal(result.symbol, 'IX0001');
  assert.equal(result.priceBasis, 'CURRENT_SESSION_REFERENCE_PRICE');
  assert.equal(result.referencePrice, 46184.85);
  assert.deepEqual(calls.map(call => call.endpoint), [
    'stock/intraday/tickers?type=INDEX&exchange=TWSE',
    'stock/intraday/ticker/IX0001',
  ]);
  assert.ok(calls.every(call => call.requestType === 'GET'));
  assert.doesNotMatch(calls.map(call => call.endpoint).join(' '), /quote\/TAIEX|tse_t00|api\.twse|previous/i);
});

test('official symbol discovery then current-session quote succeeds intraday', async () => {
  const calls = [];
  const result = await resolveFugleTaiexProvider(async request => {
    calls.push(request);
    return calls.length === 1
      ? { status: 200, payload: officialDiscovery }
      : { status: 200, payload: officialQuote };
  }, { tradingDate: '2026-09-14', phase: 'intraday' });
  assert.equal(result.ok, true);
  assert.equal(result.priceBasis, 'CURRENT_SESSION_QUOTE');
  assert.deepEqual(calls.map(call => call.endpoint), [
    'stock/intraday/tickers?type=INDEX&exchange=TWSE',
    'stock/intraday/quote/IX0001',
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

test('previous-day TAIEX ticker is rejected instead of masquerading as the current trading date', async () => {
  const previousDay = { ...officialTicker, date: '2026-09-11' };
  const result = await resolveFugleTaiexProvider(async request => request.endpoint.includes('tickers?')
    ? { status: 200, payload: officialDiscovery }
    : { status: 200, payload: previousDay }, { tradingDate: '2026-09-14', phase: 'premarket' });
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
