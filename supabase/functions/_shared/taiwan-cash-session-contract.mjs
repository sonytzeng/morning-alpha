import { previousTradingDay } from './market-status.ts';

export const TAIWAN_CASH_SESSION_CONTRACTS = Object.freeze({
  premarket: 'TW_CASH_PREMARKET_LATEST_COMPLETED_SESSION_V1',
  intraday: 'TW_CASH_INTRADAY_CURRENT_SESSION_V1',
  close: 'TW_CASH_CLOSE_CURRENT_COMPLETED_SESSION_V1',
});

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const normalizedPhase = value => String(value || '').trim().toLowerCase();

function taipei(value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return null;
  const local = new Date(ms + 8 * 60 * 60 * 1000).toISOString();
  return {
    ms,
    date: local.slice(0, 10),
    minutes: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)),
  };
}

export function taiwanCashExpectedSession({ phase, tradingDate } = {}) {
  const normalized = normalizedPhase(phase);
  const date = String(tradingDate || '');
  if (!validDate(date)) return { valid: false, error: 'TW_CASH_TRADING_DATE_INVALID' };
  if (normalized === 'premarket') {
    const expected = previousTradingDay(date);
    return expected
      ? { valid: true, phase: normalized, expected_session_date: expected, contract: TAIWAN_CASH_SESSION_CONTRACTS.premarket }
      : { valid: false, error: 'TW_CASH_PREVIOUS_SESSION_UNRESOLVED' };
  }
  if (normalized === 'intraday' || normalized === 'close') {
    return {
      valid: true,
      phase: normalized,
      expected_session_date: date,
      contract: TAIWAN_CASH_SESSION_CONTRACTS[normalized],
    };
  }
  return { valid: false, error: 'TW_CASH_PHASE_UNSUPPORTED' };
}

export function evaluateTaiwanCashSession({
  phase, tradingDate, providerSessionDate, sourceTimestamp, observedAt,
} = {}) {
  const expectation = taiwanCashExpectedSession({ phase, tradingDate });
  if (!expectation.valid) return expectation;
  const providerDate = String(providerSessionDate || '');
  if (!validDate(providerDate)) {
    return { ...expectation, valid: false, error: 'TW_CASH_PROVIDER_SESSION_DATE_INVALID', failure_code: 'PROVIDER_RESPONSE_CONTRACT_INVALID' };
  }
  if (providerDate !== expectation.expected_session_date) {
    return {
      ...expectation,
      valid: false,
      provider_session_date: providerDate,
      error: providerDate > expectation.expected_session_date ? 'TW_CASH_FUTURE_SESSION' : 'TW_CASH_SESSION_STALE',
      failure_code: 'STALE_PROVIDER_DATA',
    };
  }
  const source = taipei(sourceTimestamp);
  if (!source || source.date !== providerDate) {
    return {
      ...expectation,
      valid: false,
      provider_session_date: providerDate,
      source_session_date: source?.date || null,
      error: 'TW_CASH_SOURCE_SESSION_MISMATCH',
      failure_code: 'STALE_PROVIDER_DATA',
    };
  }
  const observed = observedAt ? taipei(observedAt) : null;
  if (observedAt && !observed) {
    return { ...expectation, valid: false, error: 'TW_CASH_OBSERVED_AT_INVALID', failure_code: 'PROVIDER_RESPONSE_CONTRACT_INVALID' };
  }
  if (observed && source.ms > observed.ms + 60_000) {
    return {
      ...expectation,
      valid: false,
      provider_session_date: providerDate,
      source_session_date: source.date,
      error: 'TW_CASH_FUTURE_TIMESTAMP',
      failure_code: 'STALE_PROVIDER_DATA',
    };
  }
  if (expectation.phase === 'intraday' && source.minutes < 9 * 60) {
    return { ...expectation, valid: false, error: 'TW_CASH_INTRADAY_NOT_OPEN', failure_code: 'STALE_PROVIDER_DATA' };
  }
  if (expectation.phase === 'close' && source.minutes < 13 * 60 + 25) {
    return { ...expectation, valid: false, error: 'TW_CASH_CLOSE_NOT_COMPLETED', failure_code: 'STALE_PROVIDER_DATA' };
  }
  return {
    ...expectation,
    valid: true,
    provider_session_date: providerDate,
    source_session_date: source.date,
    failure_code: null,
    error: null,
  };
}
