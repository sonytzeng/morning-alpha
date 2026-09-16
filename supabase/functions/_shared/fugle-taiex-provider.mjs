import { normalizeProviderTimestamp } from './provider-normalization.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const normalized = value => String(value || '').trim().toUpperCase();
const positiveNumber = value => Number.isFinite(Number(value)) && Number(value) > 0;

function taipeiStartOfDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function providerTimestampDate(value) {
  const normalizedTimestamp = normalizeProviderTimestamp(value);
  if (!normalizedTimestamp) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(normalizedTimestamp));
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function firstNumber(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export const FUGLE_TAIEX_CONTRACT = Object.freeze({
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

export const FUGLE_2330_CONTRACT = Object.freeze({
  provider: 'fugle',
  displaySymbol: '2330',
  symbol: '2330',
  type: 'EQUITY',
  exchange: 'TWSE',
  market: 'TSE',
  requestType: 'GET',
  tickerEndpoint: 'stock/intraday/ticker/2330',
  quoteEndpoint: 'stock/intraday/quote/2330',
});

function validateMapping(candidate, expected) {
  const mapping = record(candidate);
  const keys = Object.keys(expected);
  const valid = keys.every(key => mapping[key] === expected[key]);
  return { valid, failure_code: valid ? null : 'PROVIDER_SYMBOL_INVALID' };
}

export function validateFugleTaiexAdapterMapping(mapping = FUGLE_TAIEX_CONTRACT) {
  return validateMapping(mapping, FUGLE_TAIEX_CONTRACT);
}

export function validateFugle2330AdapterMapping(mapping = FUGLE_2330_CONTRACT) {
  return validateMapping(mapping, FUGLE_2330_CONTRACT);
}

function validateTicker(payload, expectedTradingDate, contract) {
  const response = record(payload);
  const identityValid = normalized(response.symbol) === contract.symbol &&
    normalized(response.type) === contract.type &&
    normalized(response.exchange) === contract.exchange &&
    normalized(response.market) === contract.market;
  if (!identityValid) return { valid: false, failure_code: 'PROVIDER_SYMBOL_INVALID', rejected_field: 'identity' };
  if (expectedTradingDate && String(response.date || '') !== expectedTradingDate) {
    return { valid: false, failure_code: 'STALE_PROVIDER_DATA', rejected_field: 'date' };
  }
  const hasReferencePrice = positiveNumber(response.referencePrice);
  const hasPreviousClose = positiveNumber(response.previousClose);
  if (!hasReferencePrice && !hasPreviousClose) {
    return { valid: false, failure_code: 'PROVIDER_RESPONSE_CONTRACT_INVALID', rejected_field: 'referencePrice|previousClose' };
  }
  return {
    valid: true,
    reference_price: Number(hasReferencePrice ? response.referencePrice : response.previousClose),
    price_basis: hasReferencePrice ? 'CURRENT_SESSION_REFERENCE_PRICE' : 'CURRENT_SESSION_PREVIOUS_CLOSE_REFERENCE',
    source_timestamp: taipeiStartOfDate(response.date),
    failure_code: null,
  };
}

export function validateFugleTaiexTicker(payload, expectedTradingDate = '') {
  return validateTicker(payload, expectedTradingDate, FUGLE_TAIEX_CONTRACT);
}

export function validateFugle2330Ticker(payload, expectedTradingDate = '') {
  return validateTicker(payload, expectedTradingDate, FUGLE_2330_CONTRACT);
}

export function validateFugleTaiexDiscovery(payload) {
  const response = record(payload);
  const rows = Array.isArray(response.data) ? response.data.map(record) : [];
  const ticker = rows.find(row => normalized(row.symbol) === FUGLE_TAIEX_CONTRACT.symbol);
  const envelopeValid = normalized(response.type) === FUGLE_TAIEX_CONTRACT.type &&
    normalized(response.exchange) === FUGLE_TAIEX_CONTRACT.exchange;
  const valid = envelopeValid && Boolean(ticker);
  return {
    valid,
    envelope_valid: envelopeValid,
    empty: envelopeValid && rows.length === 0,
    ticker: valid ? ticker : null,
    failure_code: valid ? null : 'PROVIDER_SYMBOL_INVALID',
  };
}

function validateQuote(payload, expectedTradingDate, contract) {
  const response = record(payload);
  const lastTrade = record(response.lastTrade);
  const total = record(response.total);
  const sourceTimestampValue = response.lastUpdated || response.closeTime || lastTrade.time || total.time;
  const sourceTimestamp = normalizeProviderTimestamp(sourceTimestampValue);
  const sourceDate = providerTimestampDate(sourceTimestampValue);
  const identityValid = normalized(response.symbol) === contract.symbol &&
    normalized(response.type) === contract.type &&
    normalized(response.exchange) === contract.exchange &&
    normalized(response.market) === contract.market;
  if (!identityValid) return { valid: false, source_date: sourceDate, failure_code: 'PROVIDER_SYMBOL_INVALID', rejected_field: 'identity' };
  if (expectedTradingDate && (String(response.date || '') !== expectedTradingDate || sourceDate !== expectedTradingDate)) {
    return { valid: false, source_date: sourceDate, failure_code: 'STALE_PROVIDER_DATA', rejected_field: 'date|timestamp' };
  }
  const price = firstNumber(response, ['price', 'closePrice', 'lastPrice', 'last']);
  const previousClose = firstNumber(response, ['previousClose', 'referencePrice']);
  if (!positiveNumber(price) || !positiveNumber(previousClose)) {
    return { valid: false, source_date: sourceDate, failure_code: 'PROVIDER_RESPONSE_CONTRACT_INVALID', rejected_field: 'price|previousClose' };
  }
  const change = firstNumber(response, ['change', 'priceChange']) ?? Number(price) - Number(previousClose);
  const changePercent = firstNumber(response, ['changePercent', 'change_percent', 'priceChangePercent']) ??
    (Number(change) / Number(previousClose)) * 100;
  return {
    valid: Number.isFinite(changePercent),
    source_date: sourceDate,
    source_timestamp: sourceTimestamp,
    price: Number(price),
    previous_close: Number(previousClose),
    change: Number(change),
    change_percent: Number(changePercent),
    price_basis: 'CURRENT_SESSION_QUOTE',
    failure_code: Number.isFinite(changePercent) ? null : 'PROVIDER_RESPONSE_CONTRACT_INVALID',
    rejected_field: Number.isFinite(changePercent) ? null : 'changePercent',
  };
}

export function validateFugleTaiexQuote(payload, expectedTradingDate = '') {
  return validateQuote(payload, expectedTradingDate, FUGLE_TAIEX_CONTRACT);
}

export function validateFugle2330Quote(payload, expectedTradingDate = '') {
  return validateQuote(payload, expectedTradingDate, FUGLE_2330_CONTRACT);
}

export function classifyFugleTaiexHttpFailure(status, requestedSymbol) {
  if (Number(status) !== 404) return null;
  if (!String(requestedSymbol || '').trim()) return 'RESOURCE_NOT_FOUND';
  return normalized(requestedSymbol) === FUGLE_TAIEX_CONTRACT.symbol
    ? 'RESOURCE_NOT_FOUND'
    : 'PROVIDER_SYMBOL_INVALID';
}

function providerFailure(response, contract, endpoint, fallbackError) {
  const result = record(response);
  const status = Number.isFinite(Number(result.status)) ? Number(result.status) : null;
  return {
    ok: false,
    failureCode: Number(status) === 404 ? 'RESOURCE_NOT_FOUND' : 'PROVIDER_REQUEST_REJECTED',
    endpoint,
    status,
    error: String(result.error || fallbackError),
    payload: record(result.payload),
    symbol: contract.symbol,
  };
}

function contractFailure(response, contract, endpoint, validation, fallbackError) {
  return {
    ok: false,
    failureCode: validation.failure_code,
    endpoint,
    status: 200,
    error: validation.failure_code === 'STALE_PROVIDER_DATA'
      ? contract.displaySymbol === 'TAIEX' ? 'previous_day_taiex_rejected' : 'previous_session_payload_rejected'
      : fallbackError,
    payload: record(response.payload),
    symbol: contract.symbol,
    rejectedField: validation.rejected_field || null,
  };
}

async function resolveDirectProvider(request, options, contract, validators) {
  const phase = String(record(options).phase || '').trim().toLowerCase();
  const premarket = phase === 'premarket' || phase === 'manual_backfill';
  const endpoint = premarket ? contract.tickerEndpoint : contract.quoteEndpoint;
  const response = record(await request({ requestType: contract.requestType, endpoint, symbol: contract.symbol }));
  if (Number(response.status) !== 200) return providerFailure(response, contract, endpoint, 'provider_resource_failed');
  const validation = premarket
    ? validators.ticker(response.payload, String(record(options).tradingDate || ''))
    : validators.quote(response.payload, String(record(options).tradingDate || ''));
  if (!validation.valid) return contractFailure(response, contract, endpoint, validation, 'provider_contract_invalid');
  return {
    ok: true,
    payload: record(response.payload),
    symbol: contract.symbol,
    endpoint,
    status: 200,
    priceBasis: validation.price_basis,
    referencePrice: validation.reference_price,
    sourceTimestamp: validation.source_timestamp,
    validation,
  };
}

export async function resolveFugleTaiexProvider(request, options = {}) {
  const mapping = validateFugleTaiexAdapterMapping();
  if (!mapping.valid) {
    return { ok: false, failureCode: mapping.failure_code, endpoint: FUGLE_TAIEX_CONTRACT.tickerEndpoint, status: null, error: 'taiex_adapter_mapping_invalid' };
  }
  const primary = await resolveDirectProvider(request, options, FUGLE_TAIEX_CONTRACT, {
    ticker: validateFugleTaiexTicker,
    quote: validateFugleTaiexQuote,
  });
  if (!primary.ok) return primary;

  // 2026-09-16 06:50 Production returned a valid INDEX/TWSE envelope with
  // data=[] while the direct IX0001 resource remained valid. Discovery is
  // therefore advisory; it can detect drift but cannot invalidate a direct,
  // current-date resource solely because a phase-specific list is empty.
  const discoveryResponse = record(await request({
    requestType: FUGLE_TAIEX_CONTRACT.requestType,
    endpoint: FUGLE_TAIEX_CONTRACT.discoveryEndpoint,
    symbol: FUGLE_TAIEX_CONTRACT.displaySymbol,
  }));
  const discoveryContract = Number(discoveryResponse.status) === 200
    ? validateFugleTaiexDiscovery(discoveryResponse.payload)
    : { valid: false, envelope_valid: false, empty: false, ticker: null, failure_code: 'PROVIDER_REQUEST_REJECTED' };
  return {
    ...primary,
    discovery: discoveryContract.ticker,
    discoveryStatus: discoveryContract.valid ? 'VALIDATED'
      : discoveryContract.empty ? 'EMPTY_PHASE_VARIANT_DIRECT_RESOURCE_VALID'
        : Number(discoveryResponse.status) === 200 ? 'NOT_LISTED_DIRECT_RESOURCE_VALID'
          : 'UNAVAILABLE_DIRECT_RESOURCE_VALID',
    discoveryResponse: {
      endpoint: FUGLE_TAIEX_CONTRACT.discoveryEndpoint,
      status: Number.isFinite(Number(discoveryResponse.status)) ? Number(discoveryResponse.status) : null,
      payload: record(discoveryResponse.payload),
      error: discoveryResponse.error ? String(discoveryResponse.error) : null,
    },
  };
}

export async function resolveFugle2330Provider(request, options = {}) {
  const mapping = validateFugle2330AdapterMapping();
  if (!mapping.valid) {
    return { ok: false, failureCode: mapping.failure_code, endpoint: FUGLE_2330_CONTRACT.tickerEndpoint, status: null, error: 'stock_2330_adapter_mapping_invalid' };
  }
  return resolveDirectProvider(request, options, FUGLE_2330_CONTRACT, {
    ticker: validateFugle2330Ticker,
    quote: validateFugle2330Quote,
  });
}

export function normalizeFugleTaiwanCoreResult(result, displaySymbol) {
  const resolved = record(result);
  if (resolved.ok !== true) return null;
  const payload = record(resolved.payload);
  const validation = record(resolved.validation);
  const tickerPhase = String(resolved.endpoint || '').includes('/ticker/');
  const value = tickerPhase ? Number(resolved.referencePrice) : Number(validation.price);
  const previousClose = tickerPhase ? value : Number(validation.previous_close);
  const change = tickerPhase ? 0 : Number(validation.change);
  const changePercent = tickerPhase ? 0 : Number(validation.change_percent);
  const capturedAt = String(resolved.sourceTimestamp || validation.source_timestamp || '');
  if (![value, previousClose, change, changePercent].every(Number.isFinite) || value <= 0 || !capturedAt) return null;
  return {
    value,
    change,
    changePercent,
    capturedAt,
    provider: 'fugle',
    sourceSymbol: String(resolved.symbol || payload.symbol || ''),
    raw: {
      provider: 'fugle',
      source_symbol: String(resolved.symbol || payload.symbol || ''),
      display_symbol: String(displaySymbol || ''),
      date: payload.date || null,
      response_date: payload.date || null,
      type: payload.type || null,
      market: payload.market || null,
      exchange: payload.exchange || null,
      captured_at: capturedAt,
      price: value,
      previous_close: previousClose,
      change,
      change_percent: changePercent,
      price_basis: String(resolved.priceBasis || validation.price_basis || ''),
      endpoint: String(resolved.endpoint || ''),
      discovery_status: resolved.discoveryStatus || null,
    },
  };
}
