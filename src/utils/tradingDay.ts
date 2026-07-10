import { resolveMarketStatus as resolveCanonicalMarketStatus } from '../../supabase/functions/_shared/market-status';
import type { MarketStatusCode, SessionType } from '../../supabase/functions/_shared/market-status';
/**
 * Morning Alpha — Shared Trading Day & Data Freshness Utilities
 *
 * Centralized helpers used across ALL pages for:
 * 1. Trading day detection (weekend check)
 * 2. 36-hour data freshness window
 * 3. Proxy data identification
 */

// ── Taipei timezone helpers ──

export function getTaipeiNow(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

export function isTaipeiWeekend(date?: Date): boolean {
  const tw = date ? new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })) : getTaipeiNow();
  return tw.getDay() === 0 || tw.getDay() === 6;
}

export function isTaipeiWeekendToday(): boolean {
  return isTaipeiWeekend();
}

export function formatTaipeiDate(date?: Date): string {
  const tw = date ? new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })) : getTaipeiNow();
  const y = tw.getFullYear();
  const m = String(tw.getMonth() + 1).padStart(2, '0');
  const d = String(tw.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── Date string & comparison helpers ──

export function getTaipeiDateString(date?: Date): string {
  const tw = date ? new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })) : getTaipeiNow();
  const y = tw.getFullYear();
  const m = String(tw.getMonth() + 1).padStart(2, '0');
  const d = String(tw.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isSameTaipeiDate(dateValue: string | null | undefined, targetDateString: string): boolean {
  if (!dateValue) return false;
  try {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return false;
    const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const y = tw.getFullYear();
    const m = String(tw.getMonth() + 1).padStart(2, '0');
    const dd = String(tw.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}` === targetDateString;
  } catch {
    return false;
  }
}

export function getLatestByDate<T extends Record<string, unknown>>(
  rows: T[],
  dateFieldList: string[],
): T | null {
  if (!rows || rows.length === 0) return null;
  let latest: T | null = null;
  let latestMs = 0;
  for (const row of rows) {
    for (const field of dateFieldList) {
      const val = row[field];
      if (typeof val === 'string') {
        const ms = new Date(val).getTime();
        if (!Number.isNaN(ms) && ms > latestMs) {
          latestMs = ms;
          latest = row;
        }
      }
    }
  }
  return latest;
}

// ── 36-hour freshness window ──

const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;

export function isWithin36Hours(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    const diffMs = Date.now() - d.getTime();
    return diffMs <= THIRTY_SIX_HOURS_MS && diffMs >= 0;
  } catch {
    return false;
  }
}

export function hoursSinceDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    return Math.round(diffMs / (1000 * 60 * 60));
  } catch {
    return null;
  }
}

// ── Proxy data detection ──

export function isProxySymbolName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower.includes('proxy') ||
    lower.includes('代估') ||
    lower.includes('代理') ||
    lower.includes('替代') ||
    lower.includes('模擬')
  );
}

export function isProxyDataSource(source: string | null | undefined): boolean {
  if (!source) return false;
  const lower = source.toLowerCase();
  return lower.includes('proxy');
}

export function isProxyData(
  name: string | null | undefined,
  source?: string | null | undefined,
): boolean {
  return isProxySymbolName(name) || isProxyDataSource(source);
}

// ── Market data filtering ──

export interface FilteredDataCount {
  total: number;
  valid: number;
  expired: number;
  proxy: number;
  validSymbols: string[];
  expiredSymbols: string[];
  proxySymbols: string[];
}

export function filterMarketDataByFreshness(
  items: Array<{ symbol?: string; name?: string; source?: string; updated_at?: string | null; captured_at?: string | null }> | null | undefined,
): FilteredDataCount {
  const result: FilteredDataCount = {
    total: 0,
    valid: 0,
    expired: 0,
    proxy: 0,
    validSymbols: [],
    expiredSymbols: [],
    proxySymbols: [],
  };

  if (!items || items.length === 0) return result;

  const seen = new Set<string>();

  for (const item of items) {
    const sym = (item.symbol || '').trim();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    result.total++;

    // Check proxy first
    if (isProxyData(item.name, (item as Record<string, unknown>).source as string | undefined)) {
      result.proxy++;
      result.proxySymbols.push(sym);
      // Proxy data is NOT counted as valid
      continue;
    }

    // Check freshness
    const dateToCheck = item.captured_at || item.updated_at || null;
    if (isWithin36Hours(dateToCheck)) {
      result.valid++;
      result.validSymbols.push(sym);
    } else {
      result.expired++;
      result.expiredSymbols.push(sym);
    }
  }

  return result;
}

// ── TXF-specific check ──

export interface TXFStatus {
  hasFreshTXF: boolean;
  txfUpdatedAt: string | null;
  hoursStale: number | null;
  isProxy: boolean;
  displayLabel: string;
  trustImpact: 'none' | 'moderate' | 'significant';
}

export function checkTXFStatus(
  txfItem: {
    symbol?: string;
    name?: string;
    source?: string;
    updated_at?: string | null;
    captured_at?: string | null;
  } | null | undefined,
): TXFStatus {
  if (!txfItem) {
    return {
      hasFreshTXF: false,
      txfUpdatedAt: null,
      hoursStale: null,
      isProxy: false,
      displayLabel: 'TXF 暫缺',
      trustImpact: 'significant',
    };
  }

  const dateToCheck = txfItem.captured_at || txfItem.updated_at || null;
  const isProxy = isProxyData(txfItem.name, (txfItem as Record<string, unknown>).source as string | undefined);

  if (isProxy) {
    return {
      hasFreshTXF: false,
      txfUpdatedAt: dateToCheck,
      hoursStale: hoursSinceDate(dateToCheck),
      isProxy: true,
      displayLabel: 'TXF 暫缺（代理指標）',
      trustImpact: 'significant',
    };
  }

  if (!isWithin36Hours(dateToCheck)) {
    const staleHours = hoursSinceDate(dateToCheck);
    return {
      hasFreshTXF: false,
      txfUpdatedAt: dateToCheck,
      hoursStale: staleHours,
      isProxy: false,
      displayLabel: staleHours !== null ? `TXF 暫缺（${staleHours}h 未更新）` : 'TXF 暫缺',
      trustImpact: 'moderate',
    };
  }

  return {
    hasFreshTXF: true,
    txfUpdatedAt: dateToCheck,
    hoursStale: null,
    isProxy: false,
    displayLabel: 'TXF 有效',
    trustImpact: 'none',
  };
}

// ── Previous Trading Day ──

/**
 * Get the previous trading day (YYYY-MM-DD) before the given date.
 * Skips weekends (Sat/Sun) and known Taiwan market holidays.
 *
 * @param dateStr - YYYY-MM-DD format
 * @returns YYYY-MM-DD of the previous trading day
 */
export function getPreviousTradingDay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));

  // Step back one day at a time, skipping weekends and Taiwan market holidays.
  let safety = 0;
  while (safety < 30) {
    safety++;
    d.setUTCDate(d.getUTCDate() - 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const check = `${y}-${m}-${dd}`;
    const dow = d.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = !!TAIWAN_HOLIDAYS[check];
    if (!isWeekend && !isHoliday) return check;
  }

  return dateStr;
}

// ── Market Close helpers ──

/**
 * 判斷現在是否已過台股收盤時間（13:30）
 */
export function isAfterMarketClose(): boolean {
  const tw = getTaipeiNow();
  const hour = tw.getHours();
  const minute = tw.getMinutes();
  return hour > 13 || (hour === 13 && minute >= 30);
}

/**
 * 取得台北今天的 YYYY-MM-DD 字串
 */
export function getTodayTaipeiStr(): string {
  return formatTaipeiDate();
}

// ── Taiwan Holidays (synced with Edge Function TAIWAN_HOLIDAYS_2026) ──

const TAIWAN_HOLIDAYS: Record<string, string> = {
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

export type { MarketStatusCode, SessionType };

export type MarketStatusType = 'trading' | 'weekend' | 'holiday' | 'special_closed';

export interface ResolvedMarketStatus {
  market_status: MarketStatusCode;
  market_date: string;
  next_trading_day: string;
  market_message: string;
  closed_reason: string | null;
  current_weekday: string;
  next_trading_weekday: string;
  next_update_time: string;
  is_open: boolean;
  is_trading_day: boolean;
  session_type: SessionType;
}

export interface MarketStatus {
  currentDate: string;
  currentWeekday: string;
  marketStatus: MarketStatusType;
  holidayName: string | null;
  nextTradingDate: string;
  nextTradingWeekday: string;
  nextUpdateTime: string;
  /** Human-readable status label */
  statusLabel: string;
  /** Emoji indicator */
  statusDot: string;
  /** CSS color class for the dot */
  statusDotColor: string;
}

function getChineseWeekday(date: Date): string {
  const dow = date.getUTCDay();
  const map: Record<number, string> = { 0: '星期日', 1: '星期一', 2: '星期二', 3: '星期三', 4: '星期四', 5: '星期五', 6: '星期六' };
  return map[dow] || '';
}

function getNextTradingDay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));

  // Step forward one day at a time, skipping weekends and holidays
  let safety = 0;
  while (safety < 30) {
    safety++;
    d.setUTCDate(d.getUTCDate() + 1);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const check = `${y}-${m}-${dd}`;
    const dow = d.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = !!TAIWAN_HOLIDAYS[check];
    if (!isWeekend && !isHoliday) return check;
  }
  return dateStr;
}

export function resolveMarketStatus(dateStr?: string): ResolvedMarketStatus {
  const todayStr = dateStr || formatTaipeiDate();
  const canonical = resolveCanonicalMarketStatus(todayStr);
  const currentDate = dateFromYmd(canonical.market_date);
  const nextDate = dateFromYmd(canonical.next_trading_day);
  const currentWeekday = currentDate ? getChineseWeekday(currentDate) : '';
  const nextWeekday = nextDate ? getChineseWeekday(nextDate) : '';

  return {
    market_status: canonical.market_status,
    market_date: canonical.market_date,
    next_trading_day: canonical.next_trading_day,
    market_message: canonical.market_message,
    closed_reason: canonical.closed_reason,
    current_weekday: currentWeekday,
    next_trading_weekday: nextWeekday,
    next_update_time: canonical.market_status !== 'OPEN' ? `${canonical.next_trading_day}（${nextWeekday}）07:30` : '',
    is_open: canonical.is_open,
    is_trading_day: canonical.is_trading_day,
    session_type: canonical.session_type,
  };
}

function dateFromYmd(value: string): Date | null {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}


export function getMarketStatus(dateStr?: string): MarketStatus {
  const resolved = resolveMarketStatus(dateStr);
  const todayStr = resolved.market_date;

  let marketStatus: MarketStatusType;
  let statusLabel: string;
  let statusDot: string;
  let statusDotColor: string;

  if (resolved.market_status === 'OPEN') {
    marketStatus = 'trading';
    statusLabel = '交易日';
    statusDot = '🟢';
    statusDotColor = 'bg-emerald-500';
  } else if (resolved.market_status === 'WEEKEND') {
    marketStatus = 'weekend';
    statusLabel = '非交易日';
    statusDot = '🔴';
    statusDotColor = 'bg-red-500';
  } else if (resolved.market_status === 'HOLIDAY') {
    marketStatus = 'holiday';
    statusLabel = '非交易日';
    statusDot = '🔴';
    statusDotColor = 'bg-red-500';
  } else {
    marketStatus = 'special_closed';
    statusLabel = '非交易日';
    statusDot = '🔴';
    statusDotColor = 'bg-red-500';
  }

  return {
    currentDate: todayStr,
    currentWeekday: resolved.current_weekday,
    marketStatus,
    holidayName: resolved.closed_reason,
    nextTradingDate: resolved.next_trading_day,
    nextTradingWeekday: resolved.next_trading_weekday,
    nextUpdateTime: resolved.next_update_time,
    statusLabel,
    statusDot,
    statusDotColor,
  };
}
