import { resolveMarketStatus } from './market-status.ts';

const MAX_NON_TRADING_LOOKBACK_DAYS = 4;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const PERSISTED_REPORT_MODES = new Set([
  'normal_overnight',
  'weekend_digest',
  'non_trading_day',
]);

export interface VerifiedReportFreshness {
  verified: true;
  expectedReportDate: string;
  dataAsOf: string;
}

export interface RejectedReportFreshness {
  verified: false;
  error:
    | 'REPORT_MODE_NOT_AVAILABLE'
    | 'REPORT_MODE_INVALID'
    | 'REPORT_DATE_STALE'
    | 'DATA_AS_OF_NOT_AVAILABLE'
    | 'DATA_AS_OF_IN_FUTURE'
    | 'DATA_AS_OF_DATE_MISMATCH';
}

function dateFromIso(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function shiftDate(date: string, days: number): string {
  const shifted = dateFromIso(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function taipeiDateForInstant(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function acceptableFreshReportDates(todayDate: string): string[] {
  if (resolveMarketStatus(todayDate).is_trading_day) return [todayDate];

  // A persisted same-day closed-market digest is fresh. A provider may instead
  // publish the most recent trading-day report, but only within this bounded
  // window. Longer closures require explicit server-owned calendar evidence.
  const acceptable = [todayDate];
  for (let daysAgo = 1; daysAgo <= MAX_NON_TRADING_LOOKBACK_DAYS; daysAgo += 1) {
    const candidate = shiftDate(todayDate, -daysAgo);
    if (resolveMarketStatus(candidate).is_trading_day) {
      acceptable.push(candidate);
      break;
    }
  }
  return acceptable;
}

export function verifyReportFreshness(input: {
  todayDate: string;
  reportDate: string;
  requestedReportDate: string | null;
  reportMode: string;
  dataAsOf: string;
  now?: Date;
}): VerifiedReportFreshness | RejectedReportFreshness {
  if (!input.reportMode) return { verified: false, error: 'REPORT_MODE_NOT_AVAILABLE' };
  if (!PERSISTED_REPORT_MODES.has(input.reportMode)) {
    return { verified: false, error: 'REPORT_MODE_INVALID' };
  }
  const reportIsTradingDay = resolveMarketStatus(input.reportDate).is_trading_day;
  const modeMatchesCalendar = reportIsTradingDay
    ? input.reportMode === 'normal_overnight'
    : input.reportMode === 'weekend_digest' || input.reportMode === 'non_trading_day';
  if (!modeMatchesCalendar) return { verified: false, error: 'REPORT_MODE_INVALID' };

  const acceptableDates = acceptableFreshReportDates(input.todayDate);
  if (!acceptableDates.includes(input.reportDate)
    || (input.requestedReportDate !== null && input.requestedReportDate !== input.reportDate)) {
    return { verified: false, error: 'REPORT_DATE_STALE' };
  }

  const parsedDataAsOf = Date.parse(input.dataAsOf);
  if (!Number.isFinite(parsedDataAsOf)) {
    return { verified: false, error: 'DATA_AS_OF_NOT_AVAILABLE' };
  }
  const now = input.now ?? new Date();
  if (parsedDataAsOf > now.getTime() + MAX_FUTURE_SKEW_MS) {
    return { verified: false, error: 'DATA_AS_OF_IN_FUTURE' };
  }

  const dataAsOfDate = taipeiDateForInstant(new Date(parsedDataAsOf));
  const isExplicitOvernightWindow = input.reportMode === 'normal_overnight'
    && dataAsOfDate === shiftDate(input.reportDate, 1);
  if (dataAsOfDate !== input.reportDate && !isExplicitOvernightWindow) {
    return { verified: false, error: 'DATA_AS_OF_DATE_MISMATCH' };
  }

  return {
    verified: true,
    expectedReportDate: input.reportDate,
    dataAsOf: new Date(parsedDataAsOf).toISOString(),
  };
}
