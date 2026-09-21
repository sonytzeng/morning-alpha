import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './isolatedEdgeLoader.mjs';
import { normalizeConfiguredProxyQuote, normalizeProviderTimestamp } from '../../supabase/functions/_shared/provider-normalization.mjs';
import { sanitizeProviderError } from '../../supabase/functions/_shared/market-runtime-stability.mjs';
import {
  normalizeRequiredFinnhubQuote,
  resolveRequiredTxfQuote,
} from '../../supabase/functions/_shared/required-provider-validation.mjs';
import {
  normalizeFugleTaiwanCoreResult,
  resolveFugle2330Provider,
  resolveFugleTaiexProvider,
} from '../../supabase/functions/_shared/fugle-taiex-provider.mjs';
import {
  buildCheckpointEvidence,
  validateAtomicCheckpointEvidenceRows,
} from '../../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import {
  REQUIRED_PROVIDER_SLOTS,
  sanitizeProductionMarketPayload,
  stableJson,
} from '../../supabase/functions/_shared/provider-reliability-contract.mjs';

const fetchSource = readFileSync(new URL('../../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url), 'utf8');
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/production-parity-v2/${name}`, import.meta.url), 'utf8'));
const capture = fixture('provider-capture-20260916.json');
const taiwanPremarket = fixture('taiwan-premarket-capture-20260916.json');
const premarketFailure = fixture('premarket-failure-20260916.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function validateRealProductionCapture(input, requiredKeys = []) {
  assert.equal(input?.real_production_capture, true, 'REAL_PRODUCTION_CAPTURE_REQUIRED');
  assert.match(String(input?.business_date || ''), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(String(input?.market_phase || '').length > 0, 'MARKET_PHASE_REQUIRED');
  assert.ok(String(input?.capture_time || '').length > 0, 'CAPTURE_TIME_REQUIRED');
  assert.equal(input?.contains_secrets, false, 'CAPTURE_MUST_BE_DEIDENTIFIED');
  assert.equal(Array.isArray(input?.lineage?.business_writes), true, 'LINEAGE_BUSINESS_WRITES_REQUIRED');
  for (const key of requiredKeys) {
    const response = input?.responses?.[key];
    assert.ok(response, `CAPTURE_RESPONSE_REQUIRED:${key}`);
    assert.match(String(response.source_hash || ''), /^[a-f0-9]{64}$/);
    assert.ok(String(response.endpoint || '').length > 0);
    assert.equal(Number(response.http_status), 200);
    assert.ok(response.payload, `CAPTURE_PAYLOAD_REQUIRED:${key}`);
    const actualHash = sha256(stableJson(sanitizeProductionMarketPayload(response.payload)));
    assert.equal(actualHash, response.source_hash, `CAPTURE_HASH_MISMATCH:${key}`);
  }
  return true;
}

validateRealProductionCapture(capture, ['SPX', 'IXIC', 'SOX', 'NVDA', 'TSM', 'VIX', 'DXY', 'US10Y', 'TXF']);
validateRealProductionCapture(taiwanPremarket, ['TAIEX', '2330']);
validateRealProductionCapture(premarketFailure, ['TAIEX_DISCOVERY']);

const finnhubResponses = Object.fromEntries(
  Object.values(capture.responses)
    .filter(response => response.provider === 'finnhub')
    .map(response => [response.source_symbol, response]),
);
const fetchFinnhubQuote = isolatedFunction(fetchSource, 'fetchFinnhubQuote', {
  fetchRequiredFinnhubResponse: async symbol => {
    const captured = finnhubResponses[symbol];
    return captured ? { status: captured.http_status, payload: captured.payload, error: null }
      : { status: 404, payload: null, error: 'HTTP_404' };
  },
  normalizeRequiredFinnhubQuote,
  console: { log() {}, warn() {}, error() {} },
});

const providerNames = Object.freeze({
  SPX: 'S&P 500 proxy', IXIC: 'Nasdaq proxy', SOX: 'Semiconductor proxy', NVDA: 'NVIDIA',
  TSM: 'TSMC ADR', VIX: 'Volatility proxy', DXY: 'Dollar proxy', US10Y: 'Treasury proxy',
  TAIEX: 'TAIEX', '2330': 'TSMC', TXF: 'TAIEX Futures',
});

export async function replayProductionRealityProviderBatch() {
  const quotes = new Map();

  for (const slot of REQUIRED_PROVIDER_SLOTS.filter(item => item.provider === 'finnhub')) {
    const quote = await fetchFinnhubQuote(slot.sourceSymbol, 'fixture-only-key', 'replay', []);
    if (!quote) throw new Error(`${slot.key}_REALITY_ADAPTER_FAILED`);
    quotes.set(slot.key, normalizeConfiguredProxyQuote(quote, {
      directionMultiplier: slot.key === 'US10Y' ? -1 : 1,
      proxySemantics: slot.key === 'DXY' ? 'same_direction_us_dollar_proxy'
        : slot.key === 'US10Y' ? 'inverse_7_10y_treasury_price_proxy' : undefined,
    }));
  }

  const taiexResponse = taiwanPremarket.responses.TAIEX;
  const discoveryResponse = premarketFailure.responses.TAIEX_DISCOVERY;
  const taiex = await resolveFugleTaiexProvider(async request => request.endpoint.includes('tickers?')
    ? { status: discoveryResponse.http_status, payload: discoveryResponse.payload }
    : { status: taiexResponse.http_status, payload: taiexResponse.payload }, {
    tradingDate: '2026-09-16', phase: 'premarket',
  });
  const taiexQuote = normalizeFugleTaiwanCoreResult(taiex, 'TAIEX');
  if (!taiexQuote) throw new Error(`TAIEX_REALITY_ADAPTER_FAILED:${taiex.failureCode || 'UNKNOWN'}`);
  quotes.set('TAIEX', taiexQuote);

  const stockResponse = taiwanPremarket.responses['2330'];
  const stock = await resolveFugle2330Provider(async () => ({
    status: stockResponse.http_status, payload: stockResponse.payload,
  }), { tradingDate: '2026-09-16', phase: 'premarket' });
  const stockQuote = normalizeFugleTaiwanCoreResult(stock, '2330');
  if (!stockQuote) throw new Error(`2330_REALITY_ADAPTER_FAILED:${stock.failureCode || 'UNKNOWN'}`);
  quotes.set('2330', stockQuote);

  const txfResponse = capture.responses.TXF;
  const txf = await resolveRequiredTxfQuote(async endpoint => endpoint === txfResponse.endpoint
    ? { status: txfResponse.http_status, payload: txfResponse.payload, error: null }
    : { status: 404, payload: null, error: 'HTTP_404' }, {
    phase: 'premarket', tradingDate: '2026-09-16', observedAt: '2026-09-16T07:00:00+08:00',
  });
  if (!txf.quote) throw new Error('TXF_REALITY_ADAPTER_FAILED');
  quotes.set('TXF', txf.quote);

  const correlationId = '16070000-0000-4000-8000-000000000001';
  const input = {
    phase: 'premarket', checkpoint: 'premarket', tradingDate: '2026-09-16',
    observedAt: '2026-09-16T07:00:00+08:00', correlationId,
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
    schema_version: 'PRODUCTION_REALITY_PROVIDER_REPLAY_V2',
    source: 'REAL_PRODUCTION_CAPTURE',
    real_production_capture: true,
    replay_uses_same_adapter_as_production: true,
    replay_uses_same_contract_as_production: true,
    replay_uses_correct_market_phase: true,
    synthetic_adjustments: [],
    historical_success_claim: false,
    natural_day_pass_claimed: false,
    business_date: '2026-09-16',
    provider_count: quotes.size,
    evidence,
    atomic,
  };
}
