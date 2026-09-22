// Retry remains bounded for real provider failures. A valid latest completed
// Taiwan cash session is READY in PREMARKET; it is not delayed current-day data.
export const PREMARKET_READINESS_START_MINUTES = 6 * 60 + 50;
export const PREMARKET_REPORT_DEADLINE_MINUTES = 8 * 60 + 45;
export const PREMARKET_LAST_COLLECTION_MINUTES = PREMARKET_REPORT_DEADLINE_MINUTES - 1;

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function evaluatePremarketCoreReadiness({
  key, result,
}) {
  const sourceDate = String(record(record(result).payload).date || '');
  const failureCode = String(record(result).failureCode || '');
  if ((key === 'TAIEX' || key === '2330') && record(result).ok === true) {
    const session = record(record(result).validation).session_contract;
    if (record(session).phase === 'premarket' && record(session).valid === true) {
      return { state: 'PREMARKET_BASELINE_VALID', failure_code: null, source_business_date: sourceDate };
    }
  }
  return { state: 'FAIL', failure_code: failureCode || 'PROVIDER_RESPONSE_CONTRACT_INVALID', source_business_date: sourceDate || null };
}
