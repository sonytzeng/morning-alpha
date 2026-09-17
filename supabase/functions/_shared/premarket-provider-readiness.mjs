// The market-data contract remains fail closed. This classifies only a valid
// previous trading session from the two Taiwan core ticker resources as
// temporarily unavailable; it never turns that data into a current quote.
export const PREMARKET_READINESS_START_MINUTES = 6 * 60 + 50;
export const PREMARKET_REPORT_DEADLINE_MINUTES = 8 * 60 + 45;
export const PREMARKET_LAST_COLLECTION_MINUTES = PREMARKET_REPORT_DEADLINE_MINUTES - 1;

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function evaluatePremarketCoreReadiness({
  key, result, tradingDate, previousTradingDate, taipeiMinutes,
}) {
  const sourceDate = String(record(record(result).payload).date || '');
  const failureCode = String(record(result).failureCode || '');
  const current = record(result).ok === true;
  if (current) return { state: 'CURRENT_VALID', failure_code: null, source_business_date: sourceDate };
  const previousSession = (key === 'TAIEX' || key === '2330') &&
    failureCode === 'STALE_PROVIDER_DATA' &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(tradingDate || '')) &&
    previousTradingDate && sourceDate === previousTradingDate &&
    Number(record(result).status) === 200;
  const inWindow = Number.isFinite(taipeiMinutes) &&
    taipeiMinutes >= PREMARKET_READINESS_START_MINUTES &&
    taipeiMinutes < PREMARKET_REPORT_DEADLINE_MINUTES;
  if (previousSession && inWindow) {
    return { state: 'WAITING_FOR_PROVIDER_DATA', failure_code: 'PROVIDER_DATA_NOT_READY', source_business_date: sourceDate };
  }
  return { state: 'FAIL', failure_code: failureCode || 'PROVIDER_RESPONSE_CONTRACT_INVALID', source_business_date: sourceDate || null };
}
