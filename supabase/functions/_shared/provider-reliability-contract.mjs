const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const normalized = value => String(value || '').trim().toUpperCase();

export const REQUIRED_PROVIDER_CONTRACT_VERSION = 'MORNING_ALPHA_REQUIRED_PROVIDERS_V1';

export const REQUIRED_PROVIDER_SLOTS = Object.freeze([
  Object.freeze({ key: 'SPX', provider: 'finnhub', sourceSymbol: 'SPY', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({ key: 'IXIC', provider: 'finnhub', sourceSymbol: 'QQQ', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({ key: 'SOX', provider: 'finnhub', sourceSymbol: 'SOXX', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({ key: 'NVDA', provider: 'finnhub', sourceSymbol: 'NVDA', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({ key: 'TSM', provider: 'finnhub', sourceSymbol: 'TSM', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({ key: 'VIX', provider: 'finnhub', sourceSymbol: 'VXX', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({ key: 'DXY', provider: 'finnhub', sourceSymbol: 'UUP', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({ key: 'US10Y', provider: 'finnhub', sourceSymbol: 'IEF', market: 'US', endpoint: 'quote', backup: 'NO_TRUSTED_BACKUP' }),
  Object.freeze({
    key: 'TAIEX', provider: 'fugle', sourceSymbol: 'IX0001', market: 'TW',
    endpoint: 'stock/intraday/ticker/IX0001',
    discoveryEndpoint: 'stock/intraday/tickers?type=INDEX&exchange=TWSE',
    intradayEndpoint: 'stock/intraday/quote/IX0001', backup: 'NO_TRUSTED_BACKUP',
  }),
  Object.freeze({
    key: '2330', provider: 'fugle', sourceSymbol: '2330', market: 'TW',
    endpoint: 'stock/intraday/quote/2330', backup: 'twse_mis:tse_2330.tw',
  }),
  Object.freeze({
    key: 'TXF', provider: 'fugle_futopt', sourceSymbol: 'TXF1!', market: 'TW',
    endpoint: 'futopt/intraday/quote/TXF1!',
    discoveryEndpoint: 'futopt/intraday/tickers?type=FUTURE&exchange=TAIFEX&session={session}&product=TXF',
    backup: 'same_provider_session_or_discovered_contract',
  }),
]);

export const REQUIRED_PROVIDER_COUNT = REQUIRED_PROVIDER_SLOTS.length;

export function validateRequiredProviderRegistry(slots = REQUIRED_PROVIDER_SLOTS) {
  if (!Array.isArray(slots) || slots.length !== 11) {
    return { valid: false, failure_code: 'PROVIDER_REGISTRY_CARDINALITY_INVALID' };
  }
  const keys = slots.map(item => normalized(record(item).key));
  if (new Set(keys).size !== 11 || keys.some(key => !key)) {
    return { valid: false, failure_code: 'PROVIDER_REGISTRY_KEY_SET_INVALID' };
  }
  const taiex = record(slots.find(item => normalized(record(item).key) === 'TAIEX'));
  if (taiex.provider !== 'fugle' || taiex.sourceSymbol !== 'IX0001' ||
      taiex.endpoint !== 'stock/intraday/ticker/IX0001' ||
      taiex.discoveryEndpoint !== 'stock/intraday/tickers?type=INDEX&exchange=TWSE' ||
      taiex.intradayEndpoint !== 'stock/intraday/quote/IX0001' ||
      taiex.backup !== 'NO_TRUSTED_BACKUP') {
    return { valid: false, failure_code: 'PROVIDER_SYMBOL_INVALID' };
  }
  return { valid: true, failure_code: null, keys };
}

const SECRET_KEY = /authorization|cookie|secret|token|api[-_]?key|password|service[-_]?role/i;
const ALLOWED_MARKET_FIELDS = new Set([
  'date', 'type', 'exchange', 'market', 'symbol', 'name', 'nameEn', 'industry', 'securityType',
  'previousClose', 'referencePrice', 'openPrice', 'openTime', 'highPrice', 'highTime', 'lowPrice',
  'lowTime', 'closePrice', 'closeTime', 'avgPrice', 'change', 'changePercent', 'lastUpdated',
  'lastTrade', 'total', 'trade', 'price', 'time', 'session', 'product', 'contractType', 'startDate',
  'endDate', 'settlementDate', 'data', 'c', 'd', 'dp', 'h', 'l', 'o', 'pc', 't',
]);

function sanitizeValue(value, depth) {
  if (depth > 3) return '[TRUNCATED]';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 3).map(item => sanitizeValue(item, depth + 1));
  const source = record(value);
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => ALLOWED_MARKET_FIELDS.has(key) && !SECRET_KEY.test(key))
    .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]));
}

export function sanitizeProductionMarketPayload(payload) {
  return sanitizeValue(record(payload), 0);
}

function valueShape(value, depth) {
  if (value === null) return { type: 'null', nullable: true };
  if (Array.isArray(value)) {
    const samples = value.slice(0, 3).map(item => valueShape(item, depth + 1));
    return { type: 'array', nullable: false, length: value.length, samples };
  }
  if (typeof value !== 'object') return { type: typeof value, nullable: false };
  if (depth > 4) return { type: 'object', nullable: false, truncated: true };
  const source = record(value);
  return {
    type: 'object', nullable: false,
    fields: Object.fromEntries(Object.keys(source).sort().map(key => [key, valueShape(source[key], depth + 1)])),
  };
}

export function describeProductionResponseShape(payload) {
  return valueShape(sanitizeProductionMarketPayload(payload), 0);
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
