import { previousTradingDay } from './market-status.ts';

export const TXF_PREMARKET_SESSION_CONTRACT = 'TXF_PREMARKET_SESSION_V1';
export const TXF_MAX_PREMARKET_SOURCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function taipeiTimestamp(value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return null;
  const local = new Date(ms + 8 * 60 * 60 * 1000).toISOString();
  return {
    ms,
    date: local.slice(0, 10),
    minutes: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)),
  };
}

function addCalendarDays(dateString, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || '')) || !Number.isInteger(days)) return null;
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function evaluatePremarketTxfSession(input = {}) {
  const tradingDate = String(input.tradingDate || '');
  const providerSessionDate = String(input.providerSessionDate || '');
  const session = String(input.session || '').toLowerCase();
  const expectedSessionDate = previousTradingDay(tradingDate);
  const source = taipeiTimestamp(input.sourceTimestamp);
  const observed = taipeiTimestamp(input.observedAt);

  if (!expectedSessionDate || !source || !observed || !/^\d{4}-\d{2}-\d{2}$/.test(providerSessionDate)) {
    return { valid: false, error: 'TXF_SESSION_IDENTITY_INVALID', expected_session_date: expectedSessionDate };
  }
  if (source.ms > observed.ms + 60_000) {
    return { valid: false, error: 'TXF_FUTURE_TIMESTAMP', expected_session_date: expectedSessionDate };
  }
  if (source.ms < observed.ms - TXF_MAX_PREMARKET_SOURCE_AGE_MS) {
    return { valid: false, error: 'TXF_SESSION_STALE', expected_session_date: expectedSessionDate };
  }
  if (providerSessionDate !== expectedSessionDate) {
    return { valid: false, error: 'TXF_SESSION_DATE_MISMATCH', expected_session_date: expectedSessionDate };
  }

  const nextCalendarDate = addCalendarDays(providerSessionDate, 1);
  const validSourceWindow = session === 'afterhours'
    ? (source.date === providerSessionDate && source.minutes >= 15 * 60)
      || (source.date === nextCalendarDate && source.minutes <= 5 * 60)
    : session === 'regular'
      ? source.date === providerSessionDate && source.minutes >= 8 * 60 + 45 && source.minutes <= 13 * 60 + 45
      : false;
  if (!validSourceWindow) {
    return { valid: false, error: 'TXF_SESSION_TYPE_MISMATCH', expected_session_date: expectedSessionDate };
  }

  return {
    valid: true,
    contract: TXF_PREMARKET_SESSION_CONTRACT,
    expected_session_date: expectedSessionDate,
    provider_session_date: providerSessionDate,
    session,
  };
}
