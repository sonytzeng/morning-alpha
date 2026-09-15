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
  let timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  while (timestamp > 100_000_000_000_000) timestamp /= 1000;
  if (timestamp < 100_000_000_000) timestamp *= 1000;
  const parsed = new Date(timestamp + 8 * 60 * 60 * 1000);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
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

export function validateFugleTaiexAdapterMapping(mapping = FUGLE_TAIEX_CONTRACT) {
  const candidate = record(mapping);
  const valid = candidate.provider === 'fugle' &&
    candidate.displaySymbol === 'TAIEX' &&
    candidate.symbol === 'IX0001' &&
    candidate.type === 'INDEX' &&
    candidate.exchange === 'TWSE' &&
    candidate.market === 'TSE' &&
    candidate.requestType === 'GET' &&
    candidate.discoveryEndpoint === 'stock/intraday/tickers?type=INDEX&exchange=TWSE' &&
    candidate.tickerEndpoint === 'stock/intraday/ticker/IX0001' &&
    candidate.quoteEndpoint === 'stock/intraday/quote/IX0001';
  return {
    valid,
    failure_code: valid ? null : 'PROVIDER_SYMBOL_INVALID',
  };
}

export function validateFugleTaiexTicker(payload, expectedTradingDate = '') {
  const response = record(payload);
  const identityValid = normalized(response.symbol) === FUGLE_TAIEX_CONTRACT.symbol &&
    normalized(response.type) === FUGLE_TAIEX_CONTRACT.type &&
    normalized(response.exchange) === FUGLE_TAIEX_CONTRACT.exchange &&
    normalized(response.market) === FUGLE_TAIEX_CONTRACT.market;
  if (!identityValid) {
    return { valid: false, failure_code: 'PROVIDER_SYMBOL_INVALID' };
  }
  if (expectedTradingDate && String(response.date || '') !== expectedTradingDate) {
    return { valid: false, failure_code: 'STALE_PROVIDER_DATA' };
  }
  const hasReferencePrice = positiveNumber(response.referencePrice);
  const hasPreviousClose = positiveNumber(response.previousClose);
  if (!hasReferencePrice && !hasPreviousClose) {
    return { valid: false, failure_code: 'PROVIDER_RESPONSE_CONTRACT_INVALID' };
  }
  return {
    valid: true,
    reference_price: Number(hasReferencePrice ? response.referencePrice : response.previousClose),
    price_basis: hasReferencePrice
      ? 'CURRENT_SESSION_REFERENCE_PRICE'
      : 'CURRENT_SESSION_PREVIOUS_CLOSE_REFERENCE',
    source_timestamp: taipeiStartOfDate(response.date),
    failure_code: null,
  };
}

export function validateFugleTaiexDiscovery(payload) {
  const response = record(payload);
  const rows = Array.isArray(response.data) ? response.data.map(record) : [];
  const ticker = rows.find(row => normalized(row.symbol) === FUGLE_TAIEX_CONTRACT.symbol);
  const valid = normalized(response.type) === FUGLE_TAIEX_CONTRACT.type &&
    normalized(response.exchange) === FUGLE_TAIEX_CONTRACT.exchange &&
    Boolean(ticker);
  return {
    valid,
    ticker: valid ? ticker : null,
    failure_code: valid ? null : 'PROVIDER_SYMBOL_INVALID',
  };
}

export function validateFugleTaiexQuote(payload, expectedTradingDate = '') {
  const response = record(payload);
  const lastTrade = record(response.lastTrade);
  const total = record(response.total);
  const sourceDate = providerTimestampDate(
    response.lastUpdated || response.closeTime || lastTrade.time || total.time,
  );
  const identityValid = normalized(response.symbol) === FUGLE_TAIEX_CONTRACT.symbol &&
    normalized(response.type) === FUGLE_TAIEX_CONTRACT.type &&
    normalized(response.exchange) === FUGLE_TAIEX_CONTRACT.exchange &&
    normalized(response.market) === FUGLE_TAIEX_CONTRACT.market;
  const freshnessValid = !expectedTradingDate ||
    (String(response.date || '') === expectedTradingDate && sourceDate === expectedTradingDate);
  const valid = identityValid && freshnessValid;
  return {
    valid,
    source_date: sourceDate,
    failure_code: valid ? null : identityValid ? 'STALE_PROVIDER_DATA' : 'PROVIDER_SYMBOL_INVALID',
  };
}

export function classifyFugleTaiexHttpFailure(status, requestedSymbol) {
  if (Number(status) !== 404) return null;
  if (!String(requestedSymbol || '').trim()) return 'RESOURCE_NOT_FOUND';
  return normalized(requestedSymbol) === FUGLE_TAIEX_CONTRACT.symbol
    ? 'RESOURCE_NOT_FOUND'
    : 'PROVIDER_SYMBOL_INVALID';
}

export async function resolveFugleTaiexProvider(request, options = {}) {
  const mapping = validateFugleTaiexAdapterMapping();
  if (!mapping.valid) {
    return {
      ok: false,
      failureCode: mapping.failure_code,
      endpoint: FUGLE_TAIEX_CONTRACT.discoveryEndpoint,
      status: null,
      error: 'taiex_adapter_mapping_invalid',
    };
  }

  const discovery = record(await request({
    requestType: FUGLE_TAIEX_CONTRACT.requestType,
    endpoint: FUGLE_TAIEX_CONTRACT.discoveryEndpoint,
    symbol: FUGLE_TAIEX_CONTRACT.displaySymbol,
  }));
  if (Number(discovery.status) !== 200) {
    return {
      ok: false,
      failureCode: classifyFugleTaiexHttpFailure(discovery.status, null) || 'PROVIDER_REQUEST_REJECTED',
      endpoint: FUGLE_TAIEX_CONTRACT.discoveryEndpoint,
      status: Number.isFinite(Number(discovery.status)) ? Number(discovery.status) : null,
      error: String(discovery.error || 'index_discovery_failed'),
    };
  }
  const discoveryContract = validateFugleTaiexDiscovery(discovery.payload);
  if (!discoveryContract.valid) {
    return {
      ok: false,
      failureCode: discoveryContract.failure_code,
      endpoint: FUGLE_TAIEX_CONTRACT.discoveryEndpoint,
      status: 200,
      error: 'official_index_symbol_not_discovered',
    };
  }

  const phase = String(record(options).phase || '').trim().toLowerCase();
  if (phase === 'premarket') {
    const ticker = record(await request({
      requestType: FUGLE_TAIEX_CONTRACT.requestType,
      endpoint: FUGLE_TAIEX_CONTRACT.tickerEndpoint,
      symbol: FUGLE_TAIEX_CONTRACT.symbol,
    }));
    if (Number(ticker.status) !== 200) {
      return {
        ok: false,
        failureCode: classifyFugleTaiexHttpFailure(ticker.status, FUGLE_TAIEX_CONTRACT.symbol) || 'PROVIDER_REQUEST_REJECTED',
        endpoint: FUGLE_TAIEX_CONTRACT.tickerEndpoint,
        status: Number.isFinite(Number(ticker.status)) ? Number(ticker.status) : null,
        error: String(ticker.error || 'index_ticker_failed'),
      };
    }
    const tickerContract = validateFugleTaiexTicker(ticker.payload, String(record(options).tradingDate || ''));
    if (!tickerContract.valid) {
      return {
        ok: false,
        failureCode: tickerContract.failure_code,
        endpoint: FUGLE_TAIEX_CONTRACT.tickerEndpoint,
        status: 200,
        error: tickerContract.failure_code === 'STALE_PROVIDER_DATA'
          ? 'previous_day_taiex_rejected'
          : 'taiex_ticker_contract_invalid',
      };
    }
    return {
      ok: true,
      payload: record(ticker.payload),
      symbol: FUGLE_TAIEX_CONTRACT.symbol,
      endpoint: FUGLE_TAIEX_CONTRACT.tickerEndpoint,
      discovery: discoveryContract.ticker,
      priceBasis: tickerContract.price_basis,
      referencePrice: tickerContract.reference_price,
      sourceTimestamp: tickerContract.source_timestamp,
    };
  }

  const quote = record(await request({
    requestType: FUGLE_TAIEX_CONTRACT.requestType,
    endpoint: FUGLE_TAIEX_CONTRACT.quoteEndpoint,
    symbol: FUGLE_TAIEX_CONTRACT.symbol,
  }));
  if (Number(quote.status) !== 200) {
    return {
      ok: false,
      failureCode: classifyFugleTaiexHttpFailure(quote.status, FUGLE_TAIEX_CONTRACT.symbol) || 'PROVIDER_REQUEST_REJECTED',
      endpoint: FUGLE_TAIEX_CONTRACT.quoteEndpoint,
      status: Number.isFinite(Number(quote.status)) ? Number(quote.status) : null,
      error: String(quote.error || 'index_quote_failed'),
    };
  }
  const quoteContract = validateFugleTaiexQuote(quote.payload, String(record(options).tradingDate || ''));
  if (!quoteContract.valid) {
    return {
      ok: false,
      failureCode: quoteContract.failure_code,
      endpoint: FUGLE_TAIEX_CONTRACT.quoteEndpoint,
      status: 200,
      error: quoteContract.failure_code === 'STALE_PROVIDER_DATA'
        ? 'previous_day_taiex_rejected'
        : 'taiex_quote_contract_invalid',
    };
  }

  return {
    ok: true,
    payload: record(quote.payload),
    symbol: FUGLE_TAIEX_CONTRACT.symbol,
    endpoint: FUGLE_TAIEX_CONTRACT.quoteEndpoint,
    discovery: discoveryContract.ticker,
    priceBasis: 'CURRENT_SESSION_QUOTE',
  };
}
