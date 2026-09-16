import { buildCheckpointEvidence, presentFiniteNumber } from './fetch-checkpoint-evidence.mjs';
import { normalizeConfiguredProxyQuote, normalizeProviderTimestamp } from './provider-normalization.mjs';
import { REQUIRED_PROVIDER_SLOTS } from './provider-reliability-contract.mjs';
import { normalizeFugleTaiwanCoreResult } from './fugle-taiex-provider.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const number = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && !['-', '--'].includes(value.trim())) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
const firstNumber = (source, keys) => {
  for (const key of keys) {
    const parsed = number(record(source)[key]);
    if (parsed !== null) return parsed;
  }
  return null;
};

export const REQUIRED_PROVIDER_CONFIG = Object.freeze(REQUIRED_PROVIDER_SLOTS.map(slot => Object.freeze({
  ...slot,
  directionMultiplier: slot.key === 'US10Y' ? -1 : 1,
  proxySemantics: slot.key === 'DXY' ? 'same_direction_us_dollar_proxy'
    : slot.key === 'US10Y' ? 'inverse_7_10y_treasury_price_proxy' : undefined,
})));

export function requiredProviderSlot(key) {
  return REQUIRED_PROVIDER_CONFIG.find(slot => slot.key === key) || null;
}

export function finnhubQuoteEndpoint(symbol) {
  return `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`;
}

export async function fetchRequiredFinnhubResponse(symbol, apiKey, fetcher = fetch, delay = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!apiKey) return { status: null, payload: null, error: 'CONFIGURATION_MISSING' };
  for (let attempt = 0; attempt <= 1; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetcher(`${finnhubQuoteEndpoint(symbol)}&token=${encodeURIComponent(apiKey)}`, {
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 429 && attempt < 1) { await delay(10_000); continue; }
      if (response.status === 503 && attempt < 1) { await delay(3_000); continue; }
      if (!response.ok) return { status: response.status, payload: null, error: `HTTP_${response.status}` };
      return { status: response.status, payload: await response.json(), error: null };
    } catch (error) {
      const failure = error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE';
      if (attempt === 1) return { status: null, payload: null, error: failure };
      await delay(3_000);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: null, payload: null, error: 'PROVIDER_UNAVAILABLE' };
}

export function normalizeRequiredFinnhubQuote(payload, symbol) {
  const data = record(payload);
  if ([data.c, data.h, data.l, data.o, data.pc].every(value => number(value) === 0)) return null;
  return {
    value: data.c,
    change: data.d,
    changePercent: data.dp,
    capturedAt: normalizeProviderTimestamp(data.t),
    provider: 'finnhub',
    sourceSymbol: symbol,
    raw: {
      provider: 'finnhub', finnhub_symbol: symbol,
      quote: {
        current: data.c, change: data.d, change_percent: data.dp,
        high: data.h, low: data.l, open: data.o, previous_close: data.pc,
        timestamp: data.t, captured_at: normalizeProviderTimestamp(data.t),
      },
    },
  };
}

export function normalizeRequiredFugleQuote(payload, symbol) {
  const data = record(payload), trade = record(data.trade);
  const price = firstNumber(data, ['price', 'closePrice', 'lastPrice', 'last', 'z']) ??
    firstNumber(trade, ['price', 'closePrice', 'lastPrice', 'last']);
  const previousClose = firstNumber(data, ['previousClose', 'previous_close', 'referencePrice', 'y']);
  const change = firstNumber(data, ['change', 'priceChange']);
  let changePercent = firstNumber(data, ['changePercent', 'change_percent', 'priceChangePercent']);
  if (price === null || price <= 0) return null;
  const computedChange = change ?? (previousClose && previousClose > 0 ? price - previousClose : null);
  if (computedChange === null) return null;
  if (changePercent === null) {
    changePercent = previousClose && previousClose > 0 ? (computedChange / previousClose) * 100 : null;
  }
  if (changePercent === null) return null;
  const capturedAt = normalizeProviderTimestamp(
    data.lastUpdated || data.last_updated || data.updatedAt || record(data.lastTrade).time ||
    record(data.total).time || data.closeTime || trade.at || data.time || data.date,
  );
  return {
    value: price, change: computedChange, changePercent, capturedAt,
    provider: 'fugle', sourceSymbol: symbol,
    raw: {
      provider: 'fugle', source_symbol: symbol, date: data.date || null,
      type: data.type || null, market: data.market || null,
      exchange: data.exchange || null, captured_at: capturedAt,
      price, change: computedChange, change_percent: changePercent,
    },
  };
}

export function normalizeRequiredTaiwanCoreQuote(result, displaySymbol) {
  const quote = normalizeFugleTaiwanCoreResult(result, displaySymbol);
  if (!quote) return null;
  return {
    ...quote,
    raw: {
      ...quote.raw,
      provider_contract_validated: true,
      discovery_symbol: displaySymbol === 'TAIEX' ? 'IX0001' : null,
      response_date: String(record(result?.payload).date || ''),
    },
  };
}

export function validateRequiredProviderEvidence(slot, quote, input, name = slot?.key) {
  if (!slot || !quote) return { valid: false, error: 'ATOMIC_PROVIDER_RESULT_MISSING', quote: null };
  const normalizedQuote = normalizeConfiguredProxyQuote(quote, slot);
  // Check immutable quote shape before market-phase identity. A future-date
  // diagnostic may be EXPECTED, but a malformed HTTP 200 must remain FAIL.
  if (!presentFiniteNumber(normalizedQuote.value) || Number(normalizedQuote.value) <= 0 ||
    !presentFiniteNumber(normalizedQuote.change) || !presentFiniteNumber(normalizedQuote.changePercent)) {
    return { valid: false, error: 'INCOMPLETE_CHECKPOINT_QUOTE', quote: normalizedQuote };
  }
  if (!String(normalizedQuote.provider || '').trim() || !normalizeProviderTimestamp(normalizedQuote.capturedAt)) {
    return { valid: false, error: 'INVALID_CHECKPOINT_PROVENANCE', quote: normalizedQuote };
  }
  const evidence = buildCheckpointEvidence(input, normalizedQuote, {
    displaySymbol: slot.key,
    finnhubSymbol: slot.sourceSymbol,
    market: slot.market,
    name,
  });
  return { ...evidence, quote: normalizedQuote };
}

function textField(row, keys) {
  for (const key of keys) {
    const value = record(row)[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function tickerRows(input) {
  const rows = [];
  const visit = value => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const row = record(value);
    if (typeof (row.symbol ?? row.ticker ?? row.code ?? row.contractCode ?? row.contract_code) === 'string') rows.push(row);
    for (const key of ['data', 'items', 'tickers', 'products', 'contracts', 'results']) visit(row[key]);
  };
  visit(input);
  return rows;
}

function expiryMillis(row) {
  const expiry = textField(row, ['deliveryDate', 'expiryDate', 'expireDate', 'lastTradingDate', 'settlementDate']);
  if (expiry) {
    const normalized = /^\d{8}$/.test(expiry)
      ? `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}` : expiry;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  const ym = textField(row, ['deliveryMonth', 'contractMonth', 'yearMonth', 'month']);
  if (/^\d{6}$/.test(ym)) {
    const parsed = Date.parse(`${ym.slice(0, 4)}-${ym.slice(4, 6)}-01T00:00:00Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function selectRequiredTxfContract(input, nowMs = Date.now()) {
  const candidates = tickerRows(input).map(row => {
    const symbol = textField(row, ['symbol', 'ticker', 'code', 'contractCode', 'contract_code']);
    const product = textField(row, ['product', 'productId', 'product_id', 'rootSymbol', 'underlying', 'underlyingSymbol', 'commodity', 'type', 'name']);
    const status = textField(row, ['status', 'state', 'tradeStatus', 'tradingStatus', 'isActive', 'active']).toLowerCase();
    return { symbol, product, status, expiry: expiryMillis(row) };
  }).filter(item => /^TXF[A-Z0-9]+$/i.test(item.symbol))
    .filter(item => /TXF|臺指|台指|TAIEX/i.test(`${item.product} ${item.symbol}`))
    .filter(item => !['false', '0', 'inactive', 'expired', 'delisted', 'suspended', 'halted', 'closed'].includes(item.status))
    .sort((a, b) => {
      const aFuture = a.expiry >= nowMs ? 0 : 1;
      const bFuture = b.expiry >= nowMs ? 0 : 1;
      return aFuture - bFuture || a.expiry - b.expiry || a.symbol.localeCompare(b.symbol);
    });
  return candidates[0]?.symbol || null;
}

export function txfSessionsForPhase(phase) {
  return phase === 'premarket' || phase === 'manual_backfill'
    ? ['afterhours', 'regular'] : ['regular', 'afterhours'];
}

export function txfQuoteEndpoint(symbol, session) {
  const path = `futopt/intraday/quote/${encodeURIComponent(symbol)}`;
  return session === 'afterhours' ? `${path}?session=afterhours` : path;
}

/** @param {Record<string, unknown>} response @param {string | null | undefined} [evidenceError] */
export function classifyRequiredProviderFailure(response, evidenceError = null) {
  const status = Number(record(response).status);
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  if (status === 401 || status === 403) return 'AUTHENTICATION_FAILED';
  if (status === 402) return 'BLOCKED_BY_SUBSCRIPTION';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  if (String(record(response).error || '') === 'TIMEOUT') return 'TIMEOUT';
  if (evidenceError === 'INVALID_CHECKPOINT_SOURCE_TIME') return 'STALE_PROVIDER_DATA';
  if (evidenceError === 'OUTSIDE_REAL_CHECKPOINT_WINDOW') return 'MARKET_PHASE_EXPECTED';
  if (evidenceError) return 'PROVIDER_RESPONSE_CONTRACT_INVALID';
  return String(record(response).error || 'PROVIDER_REQUEST_REJECTED');
}

export async function fetchRequiredFugleResponse(endpoint, apiKey, fetcher = fetch) {
  if (!apiKey) return { status: null, payload: null, error: 'CONFIGURATION_MISSING' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetcher(`https://api.fugle.tw/marketdata/v1.0/${endpoint}`, {
      headers: { Accept: 'application/json', 'X-API-KEY': apiKey }, signal: controller.signal,
    });
    if (!response.ok) return { status: response.status, payload: null, error: `HTTP_${response.status}` };
    return { status: response.status, payload: await response.json(), error: null };
  } catch (error) {
    return { status: null, payload: null, error: error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveRequiredTxfQuote(request, options = {}) {
  const sessions = txfSessionsForPhase(options.phase);
  const observations = [];
  const tryQuote = async (symbol, session, resolution, fallbackUsed) => {
    const endpoint = txfQuoteEndpoint(symbol, session);
    const response = await request(endpoint);
    observations.push({ endpoint, ...record(response) });
    if (Number(response?.status) !== 200) return null;
    if (!/^TXF[A-Z0-9!]+$/i.test(String(record(response.payload).symbol || ''))) return null;
    const base = normalizeRequiredFugleQuote(response.payload, symbol);
    if (!base) return null;
    return {
      quote: {
        ...base, provider: 'fugle_futopt', sourceSymbol: symbol,
        raw: { ...base.raw, provider: 'fugle_futopt', product: 'TXF', session,
          contract_resolution: resolution, fallback_used: fallbackUsed,
          ...(fallbackUsed ? { fallback_from_session: sessions[0] } : {}) },
      },
      endpoint, response,
    };
  };
  const alias = 'TXF1!';
  const primary = await tryQuote(alias, sessions[0], 'continuous_alias', false);
  if (primary) return { ...primary, observations };
  if (observations.some(item => [401, 402, 403].includes(Number(item.status)))) {
    return { quote: null, endpoint: null, response: null, observations };
  }
  const alternate = await tryQuote(alias, sessions[1], 'continuous_alias', true);
  if (alternate) return { ...alternate, observations };
  const discoverySessions = sessions.map(session => session.toUpperCase());
  let contract = null;
  for (const session of discoverySessions) {
    const endpoint = `futopt/intraday/tickers?type=FUTURE&exchange=TAIFEX&session=${session}&product=TXF`;
    const response = await request(endpoint);
    observations.push({ endpoint, ...record(response) });
    contract = Number(response?.status) === 200 ? selectRequiredTxfContract(response.payload, options.nowMs) : null;
    if (contract) break;
  }
  if (!contract) return { quote: null, endpoint: null, response: null, observations };
  const discoveredPrimary = await tryQuote(contract, sessions[0], 'ticker_discovery', false);
  if (discoveredPrimary) return { ...discoveredPrimary, observations };
  const discoveredAlternate = await tryQuote(contract, sessions[1], 'ticker_discovery', true);
  return discoveredAlternate ? { ...discoveredAlternate, observations } : { quote: null, endpoint: null, response: null, observations };
}
