import { readFileSync } from 'node:fs';
import { isolatedFunction } from './isolatedEdgeLoader.mjs';
import { normalizeConfiguredProxyQuote, normalizeProviderTimestamp } from '../../supabase/functions/_shared/provider-normalization.mjs';
import { sanitizeProviderError } from '../../supabase/functions/_shared/market-runtime-stability.mjs';
import {
  FUGLE_TAIEX_CONTRACT,
  resolveFugleTaiexProvider,
} from '../../supabase/functions/_shared/fugle-taiex-provider.mjs';
import {
  buildCheckpointEvidence,
  validateAtomicCheckpointEvidenceRows,
} from '../../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import { REQUIRED_PROVIDER_SLOTS } from '../../supabase/functions/_shared/provider-reliability-contract.mjs';

const fetchSource = readFileSync(new URL('../../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url), 'utf8');
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/production-reliability-v1/${name}`, import.meta.url), 'utf8'));
const finnhubFixture = fixture('finnhub-required-20260915.json');
const extractNumber = isolatedFunction(fetchSource, 'extractNumber');
const normalizeTimestamp = isolatedFunction(fetchSource, 'normalizeTimestamp', { normalizeProviderTimestamp });
const normalizeFugleQuote = isolatedFunction(fetchSource, 'normalizeFugleQuote', { extractNumber, normalizeTimestamp });
const taiexDiscovery = { type: 'INDEX', exchange: 'TWSE', data: [{ symbol: 'IX0001', name: '發行量加權股價指數' }] };
const taiexPremarketFixture = fixture('taiex-premarket-20260915.json').captured_payload;
const fetchFugleTaiexQuote = isolatedFunction(fetchSource, 'fetchFugleTaiexQuote', {
  FUGLE_TAIEX_CONTRACT,
  resolveFugleTaiexProvider,
  sanitizeProviderError,
  normalizeFugleQuote,
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: async input => {
    const url = String(input);
    const payload = url.includes('/tickers?') ? taiexDiscovery : taiexPremarketFixture;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
  console: { log() {}, warn() {}, error() {} },
});
const fetchFinnhubQuote = isolatedFunction(fetchSource, 'fetchFinnhubQuote', {
  MAX_RETRIES: 1,
  FETCH_TIMEOUT_MS: 6000,
  sleep: async () => {},
  sanitizeProviderError,
  normalizeTimestamp,
  setTimeout,
  clearTimeout,
  AbortController,
  DOMException,
  fetch: async input => {
    const symbol = new URL(String(input)).searchParams.get('symbol');
    const captured = finnhubFixture.responses[symbol]?.payload;
    return captured
      ? new Response(JSON.stringify(captured), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('{}', { status: 404 });
  },
  console: { log() {}, warn() {}, error() {} },
});

const providerNames = Object.freeze({
  SPX: 'S&P 500 proxy', IXIC: 'Nasdaq proxy', SOX: 'Semiconductor proxy', NVDA: 'NVIDIA',
  TSM: 'TSMC ADR', VIX: 'Volatility proxy', DXY: 'Dollar proxy', US10Y: 'Treasury proxy',
  TAIEX: 'TAIEX', '2330': 'TSMC', TXF: 'TAIEX Futures',
});

function timeRebased2330(payload) {
  const next = structuredClone(payload);
  const timestamp = Date.parse('2026-09-15T06:55:00+08:00') * 1000;
  next.lastUpdated = timestamp;
  next.closeTime = timestamp;
  if (next.lastTrade) next.lastTrade.time = timestamp;
  if (next.total) next.total.time = timestamp;
  return next;
}

export async function replayProductionRealityProviderBatch() {
  const finn = finnhubFixture;
  const stock = fixture('stock-2330-20260915.json').captured_payload;
  const txf = fixture('txf-afterhours-20260915.json').captured_payload;
  const quotes = new Map();

  for (const slot of REQUIRED_PROVIDER_SLOTS.filter(item => item.provider === 'finnhub')) {
    const captured = finn.responses[slot.sourceSymbol].payload;
    const quote = await fetchFinnhubQuote(slot.sourceSymbol, 'fixture-only-key', 'replay', []);
    if (!quote) throw new Error(`${slot.key}_REALITY_ADAPTER_FAILED`);
    quotes.set(slot.key, normalizeConfiguredProxyQuote(quote, {
      directionMultiplier: slot.key === 'US10Y' ? -1 : 1,
      proxySemantics: slot.key === 'DXY' ? 'same_direction_us_dollar_proxy'
        : slot.key === 'US10Y' ? 'inverse_7_10y_treasury_price_proxy' : undefined,
    }));
  }

  const taiexFailures = [];
  const taiexQuote = await fetchFugleTaiexQuote(
    'fixture-only-key', 'production-reality-replay', '2026-09-15', 'premarket', taiexFailures,
  );
  if (!taiexQuote) throw new Error(`TAIEX_REALITY_ADAPTER_FAILED:${taiexFailures[0]?.failure_code || 'UNKNOWN'}`);
  quotes.set('TAIEX', taiexQuote);
  quotes.set('2330', {
    ...normalizeFugleQuote(timeRebased2330(stock), '2330'), provider: 'fugle', sourceSymbol: '2330',
  });
  quotes.set('TXF', {
    ...normalizeFugleQuote(txf, 'TXF1!'), provider: 'fugle_futopt', sourceSymbol: 'TXF1!',
  });

  const correlationId = '15065000-0000-4000-8000-000000000001';
  const input = {
    phase: 'premarket', checkpoint: 'premarket', tradingDate: '2026-09-15',
    observedAt: '2026-09-15T07:00:00+08:00', correlationId,
  };
  const evidence = REQUIRED_PROVIDER_SLOTS.map(slot => {
    const quote = quotes.get(slot.key);
    const result = buildCheckpointEvidence(input, quote, {
      displaySymbol: slot.key, finnhubSymbol: slot.sourceSymbol, market: slot.market,
      name: providerNames[slot.key],
    });
    if (!result.valid) throw new Error(`${slot.key}_REALITY_EVIDENCE_FAILED:${result.error}`);
    return { provider_key: slot.key, ...result.row };
  });
  const atomic = validateAtomicCheckpointEvidenceRows(evidence);
  if (!atomic.valid) throw new Error(`REALITY_ATOMIC_ASSEMBLY_FAILED:${atomic.error}`);
  return {
    schema_version: 'PRODUCTION_REALITY_PROVIDER_REPLAY_V1',
    source: 'DEIDENTIFIED_PRODUCTION_SHAPES',
    synthetic_adjustments: [{ symbol: '2330', field: 'provider timestamps', reason: 'isolate 07:00 replay from a later same-day capture' }],
    historical_success_claim: false,
    natural_day_pass_claimed: false,
    provider_count: quotes.size,
    evidence,
    atomic,
  };
}
