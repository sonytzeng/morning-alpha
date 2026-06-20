/**
 * marketDataTimeHelpers — Unified market_data time handling
 *
 * All market_data timestamp access MUST go through these helpers.
 * Never slice UTC date strings directly or use arbitrary column priority.
 *
 * Rules:
 * 1. Primary time: captured_at
 * 2. Fallback: created_at
 * 3. Fallback: trading_date
 * 4. Fallback: updated_at
 *
 * All date judgments MUST use getMarketDataTaipeiDate(), NOT UTC date substring.
 */

export interface MarketDataTimeRow {
  captured_at?: string | null;
  created_at?: string | null;
  trading_date?: string | null;
  updated_at?: string | null;
}

/**
 * Get the best available timestamp from a market_data row.
 * Priority: captured_at → created_at → trading_date → updated_at
 */
export function getMarketDataTimestamp(row: MarketDataTimeRow | null | undefined): string | null {
  if (!row) return null;
  return row.captured_at || row.created_at || row.trading_date || row.updated_at || null;
}

/**
 * Get the Taipei date (YYYY-MM-DD) from a market_data row's best timestamp.
 * Returns null if no valid timestamp is available.
 */
export function getMarketDataTaipeiDate(row: MarketDataTimeRow | null | undefined): string | null {
  const timestamp = getMarketDataTimestamp(row);
  if (!timestamp) return null;
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return null;
    const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const y = tw.getFullYear();
    const m = String(tw.getMonth() + 1).padStart(2, '0');
    const day = String(tw.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return null;
  }
}

/**
 * Get the full Taipei time string from a market_data row's best timestamp.
 */
export function formatMarketDataTaipeiTime(row: MarketDataTimeRow | null | undefined): string {
  const timestamp = getMarketDataTimestamp(row);
  if (!timestamp) return '—';
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/**
 * Get the Taipei hour from a market_data row's best timestamp.
 * Returns null if no valid timestamp.
 */
export function getMarketDataTaipeiHour(row: MarketDataTimeRow | null | undefined): number | null {
  const timestamp = getMarketDataTimestamp(row);
  if (!timestamp) return null;
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getHours();
  } catch {
    return null;
  }
}

/**
 * Check if a Taiwan market data row (TAIEX, 2330, TXF) can serve as today's premarket basis.
 *
 * Taiwan market closes around 13:30. If captured_at Taipei time is from the previous
 * complete trading day, this is normal premarket logic — NOT an error.
 *
 * Example:
 *   captured_at UTC 2026-06-15T05:30:00+00:00 → Taipei 2026-06-15 13:30
 *   Today is 2026-06-16 → previous trading day → NORMAL premarket basis
 */
export function canServeAsTWPremarketBasis(
  row: MarketDataTimeRow | null | undefined,
  todayTaipeiDate: string,
): { usable: boolean; label: string; date: string | null } {
  const taipeiDate = getMarketDataTaipeiDate(row);
  if (!taipeiDate) return { usable: false, label: '無可用時間', date: null };

  // Today → can serve
  if (taipeiDate === todayTaipeiDate) {
    return { usable: true, label: '今日盤前資料', date: taipeiDate };
  }

  // Check if it's the previous calendar day
  const prevDay = new Date(todayTaipeiDate);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevStr = prevDay.toISOString().slice(0, 10);

  if (taipeiDate === prevStr) {
    return { usable: true, label: '前一交易日收盤基準', date: taipeiDate };
  }

  // More than 2 days old — stale
  return { usable: false, label: `資料日期 ${taipeiDate}，非最近交易日`, date: taipeiDate };
}

/**
 * Check if a US/overseas market data row (NVDA, SPX, SOX, TSM, DXY, VIX, US10Y)
 * can serve as today's overseas premarket basis.
 *
 * US market data captured at UTC 2026-06-15T20:00:00+00:00 → Taipei 2026-06-16 04:00
 * This is today's premarket overseas data — NOT expired just because UTC date is 06-15.
 */
export function canServeAsUSPremarketBasis(
  row: MarketDataTimeRow | null | undefined,
  todayTaipeiDate: string,
): { usable: boolean; label: string; date: string | null } {
  const taipeiDate = getMarketDataTaipeiDate(row);
  if (!taipeiDate) return { usable: false, label: '無可用時間', date: null };

  // Today's Taipei date → definitely usable
  if (taipeiDate === todayTaipeiDate) {
    return { usable: true, label: '今日盤前海外資料', date: taipeiDate };
  }

  // Previous calendar day → check if Taipei hour is early morning (overnight US data)
  const prevDay = new Date(todayTaipeiDate);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevStr = prevDay.toISOString().slice(0, 10);

  if (taipeiDate === prevStr) {
    const taipeiHour = getMarketDataTaipeiHour(row);
    // US market closes ~04:00-05:00 Taipei time next day
    // If data was captured at Taipei hour >= 4, it's effectively today's overnight data
    if (taipeiHour !== null && taipeiHour >= 4) {
      return { usable: true, label: '今日盤前海外資料（凌晨更新）', date: taipeiDate };
    }
    return { usable: true, label: '前一交易日海外收盤基準', date: taipeiDate };
  }

  return { usable: false, label: `資料日期 ${taipeiDate}，非最近海外交易日`, date: taipeiDate };
}