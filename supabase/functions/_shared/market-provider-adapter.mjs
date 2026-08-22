const INDEX_SYMBOLS = new Set(['SPX', 'IXIC', 'SOX', 'TAIEX', 'VIX', 'DXY', 'US10Y']);
const FUTURES_SYMBOLS = new Set(['TXF', 'MTX', 'TX']);

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyCanonicalAsset(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (FUTURES_SYMBOLS.has(normalized)) return 'future';
  if (INDEX_SYMBOLS.has(normalized)) return 'index';
  return 'equity';
}

export function normalizeProviderQuote(input) {
  const symbol = String(input?.symbol || '').trim().toUpperCase();
  const provider = String(input?.provider || '').trim().toLowerCase();
  const capturedAt = String(input?.captured_at || '').trim();
  const value = finite(input?.value);
  const change = finite(input?.change);
  const changePercent = finite(input?.change_percent);
  const errors = [];
  if (!symbol) errors.push('symbol_missing');
  if (!provider) errors.push('provider_missing');
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) errors.push('captured_at_invalid');
  if (value === null) errors.push('value_invalid');
  if (changePercent === null) errors.push('change_percent_invalid');

  return {
    valid: errors.length === 0,
    errors,
    asset_type: classifyCanonicalAsset(symbol),
    record: {
      provider,
      symbol,
      source_symbol: String(input?.source_symbol || symbol),
      name: String(input?.name || symbol),
      market: String(input?.market || 'UNKNOWN').toUpperCase(),
      trading_date: String(input?.trading_date || ''),
      phase: String(input?.phase || 'manual_backfill'),
      value,
      change_value: change,
      change_percent: changePercent,
      captured_at: capturedAt,
      freshness_status: String(input?.freshness_status || 'provider_returned'),
      correlation_id: input?.correlation_id || null,
      raw_payload: input?.raw_payload && typeof input.raw_payload === 'object' ? input.raw_payload : {},
    },
  };
}

export function summarizeProviderHealth(input) {
  const requested = Math.max(0, Number(input?.requested_count) || 0);
  const succeeded = Math.max(0, Number(input?.succeeded_count) || 0);
  const failed = Math.max(0, Number(input?.failed_count) || 0);
  const timedOut = input?.timed_out === true;
  const successRate = requested === 0 ? 0 : Math.round((succeeded / requested) * 10_000) / 100;
  return {
    status: timedOut || successRate < 50 ? 'down' : successRate < 90 ? 'degraded' : 'healthy',
    success_rate: successRate,
    requested_count: requested,
    succeeded_count: succeeded,
    failed_count: failed,
    timed_out: timedOut,
  };
}
