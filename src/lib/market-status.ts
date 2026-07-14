/**
 * Browser-safe adapter for the canonical Morning Alpha market-status contract.
 *
 * Keep this resolver aligned with `supabase/functions/_shared/market-status.ts`.
 * Frontend code must not import from `supabase/functions/**` because that crosses
 * the browser / Edge Function runtime boundary.
 */
export type MarketStatusCode = 'OPEN' | 'WEEKEND' | 'HOLIDAY' | 'TYPHOON' | 'EMERGENCY_CLOSE';
export type SessionType = 'FULL_DAY' | 'HALF_DAY' | 'CLOSED';

export interface ResolvedMarketStatus {
  market_status: MarketStatusCode;
  market_date: string;
  next_trading_day: string;
  market_message: string;
  closed_reason: string | null;
  is_open: boolean;
  is_trading_day: boolean;
  session_type: SessionType;
}

const TAIWAN_HOLIDAYS_2026: Record<string, string> = {
  '2026-01-01': '元旦',
  '2026-02-16': '春節休市',
  '2026-02-17': '春節休市',
  '2026-02-18': '春節休市',
  '2026-02-19': '春節休市',
  '2026-02-20': '春節休市',
  '2026-02-27': '和平紀念日補假',
  '2026-04-03': '兒童節補假',
  '2026-04-06': '清明節補假',
  '2026-06-19': '端午節',
  '2026-09-25': '中秋節',
  '2026-10-09': '國慶日補假',
};

// Temporary canonical exceptional closure source until a DB market calendar exists.
// Source: TWSE announced a full-day typhoon closure for 2026-07-10.
const TAIWAN_EXCEPTIONAL_CLOSURES_2026: Record<string, { status: Exclude<MarketStatusCode, 'OPEN' | 'WEEKEND' | 'HOLIDAY'>; reason: string }> = {
  '2026-07-10': { status: 'TYPHOON', reason: '颱風停班停市' },
};

const TAIWAN_HALF_DAY_SESSIONS_2026: Record<string, string> = {
  // Future official half-day sessions go here. They remain OPEN with session_type HALF_DAY.
};

function dateFromString(dateString: string): Date | null {
  const parts = dateString.split('-').map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function nextTradingDay(dateString: string): string {
  const date = dateFromString(dateString);
  if (!date) return dateString;
  for (let i = 0; i < 30; i++) {
    date.setUTCDate(date.getUTCDate() + 1);
    const candidate = formatDate(date);
    if (resolveMarketStatus(candidate).is_trading_day) return candidate;
  }
  return dateString;
}

export function resolveMarketStatus(dateString: string): ResolvedMarketStatus {
  const date = dateFromString(dateString);
  if (!date) {
    return {
      market_status: 'EMERGENCY_CLOSE',
      market_date: dateString,
      next_trading_day: dateString,
      market_message: '交易日判斷異常，Morning Alpha 已切換保守模式。',
      closed_reason: '日期解析異常',
      is_open: false,
      is_trading_day: false,
      session_type: 'CLOSED',
    };
  }

  const exceptional = TAIWAN_EXCEPTIONAL_CLOSURES_2026[dateString] || null;
  if (exceptional) {
    const message = exceptional.status === 'TYPHOON'
      ? '今日因停班停市，Morning Alpha 已切換休市模式。'
      : '今日因特殊狀況休市，Morning Alpha 已切換休市模式。';
    return {
      market_status: exceptional.status,
      market_date: dateString,
      next_trading_day: nextTradingDay(dateString),
      market_message: message,
      closed_reason: exceptional.reason,
      is_open: false,
      is_trading_day: false,
      session_type: 'CLOSED',
    };
  }

  const holidayName = TAIWAN_HOLIDAYS_2026[dateString] || null;
  if (holidayName) {
    return {
      market_status: 'HOLIDAY',
      market_date: dateString,
      next_trading_day: nextTradingDay(dateString),
      market_message: '今日國定假日休市。',
      closed_reason: holidayName,
      is_open: false,
      is_trading_day: false,
      session_type: 'CLOSED',
    };
  }

  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) {
    return {
      market_status: 'WEEKEND',
      market_date: dateString,
      next_trading_day: nextTradingDay(dateString),
      market_message: '本日為週末。',
      closed_reason: '週末休市',
      is_open: false,
      is_trading_day: false,
      session_type: 'CLOSED',
    };
  }

  const halfDayReason = TAIWAN_HALF_DAY_SESSIONS_2026[dateString] || null;
  return {
    market_status: 'OPEN',
    market_date: dateString,
    next_trading_day: dateString,
    market_message: halfDayReason ? '今日為半日交易，請依半日交易節奏執行。' : '今天正常交易。',
    closed_reason: halfDayReason,
    is_open: true,
    is_trading_day: true,
    session_type: halfDayReason ? 'HALF_DAY' : 'FULL_DAY',
  };
}
