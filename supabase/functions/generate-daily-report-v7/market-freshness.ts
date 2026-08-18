export type MarketFreshnessDates = {
  twCoreDate: string;
  usGlobalDate: string;
};

const TAIWAN_SYMBOLS = new Set(['TAIEX', 'TWII', '^TWII', '2330', '2330.TW', 'TXF', 'TX', 'MTX', 'TXF1']);
const US_SYMBOLS = new Set(['NVDA', 'TSM', 'TSMC', 'SPX', 'SP500', 'GSPC', 'SOX', 'PHLX', 'IXIC', 'NASDAQ', 'VIX', 'VIXINDEX', 'DXY', 'USDINDEX', 'US10Y', 'TNX', 'T10Y']);

export function dateInTimeZone(iso: string, timeZone: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function computeMarketFreshnessDates(
  rows: Record<string, unknown>[],
  fallbackTaipeiDate: string,
): MarketFreshnessDates {
  let latestTaiwan = '';
  let latestUnitedStates = '';
  for (const row of rows) {
    const symbol = String(row.symbol || '').toUpperCase();
    const capturedAt = String(row.captured_at || '');
    if (!capturedAt) continue;
    if (TAIWAN_SYMBOLS.has(symbol) && (!latestTaiwan || capturedAt > latestTaiwan)) latestTaiwan = capturedAt;
    if (US_SYMBOLS.has(symbol) && (!latestUnitedStates || capturedAt > latestUnitedStates)) latestUnitedStates = capturedAt;
  }
  return {
    twCoreDate: latestTaiwan ? dateInTimeZone(latestTaiwan, 'Asia/Taipei') : fallbackTaipeiDate,
    // A 16:00 New York close is 04:00 in Taipei during daylight saving time.
    // Its session date must remain the New York trading date, not the next Taipei calendar date.
    usGlobalDate: latestUnitedStates ? dateInTimeZone(latestUnitedStates, 'America/New_York') : fallbackTaipeiDate,
  };
}

export function isTaiwanMarketSymbol(symbol: string): boolean {
  return TAIWAN_SYMBOLS.has(symbol.toUpperCase());
}

export function isMarketIndicatorStale(
  updatedAt: string,
  symbol: string,
  dates?: MarketFreshnessDates,
  nowMs = Date.now(),
): boolean {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) return true;
  if (dates) {
    const taiwan = isTaiwanMarketSymbol(symbol);
    const expected = taiwan ? dates.twCoreDate : dates.usGlobalDate;
    const observed = dateInTimeZone(updatedAt, taiwan ? 'Asia/Taipei' : 'America/New_York');
    if (expected && observed) return observed < expected;
  }
  return nowMs - timestamp > 36 * 60 * 60 * 1000;
}

export function filterRecentNewsRows<T extends Record<string, unknown>>(
  rows: T[],
  nowMs = Date.now(),
  maxAgeHours = 48,
): T[] {
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return rows
    .map((row) => ({ row, timestamp: Date.parse(String(row.published_at || row.created_at || '')) }))
    .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp <= nowMs && nowMs - timestamp <= maxAgeMs)
    .sort((left, right) => right.timestamp - left.timestamp)
    .map(({ row }) => row);
}
