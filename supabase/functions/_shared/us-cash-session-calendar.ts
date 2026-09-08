// Verified 2026-09-08 against Nasdaq's published U.S. equity calendar:
// https://www.nasdaqtrader.com/Trader.aspx?id=calendar
// Deliberately scoped to cash equities/index proxies, NOT FX, rates or futures.
// Unknown years never extend the ordinary age limit. Refresh this contract from
// an official calendar before using a new year; do not infer closures from data.
const CLOSED_2026 = new Set(['01-01', '01-19', '02-16', '04-03', '05-25', '06-19', '07-03', '09-07', '11-26', '12-25']);
const EARLY_2026 = new Set(['11-27', '12-24']);
const SYMBOLS = new Set(['SPX', 'SP500', 'GSPC', 'SPY', 'IXIC', 'NASDAQ', 'QQQ', 'SOX', 'PHLX', 'SOXX', 'TSM', 'TSMC', 'NVDA', 'DJIA', 'DJI', 'AAPL', 'MSFT', 'META', 'AMZN']);
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function clock(timestamp: number) {
  const parts = formatter.formatToParts(timestamp);
  const part = (name: string) => parts.find((item) => item.type === name)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, minutes: Number(part('hour')) * 60 + Number(part('minute')) };
}
const closeMinute = (date: string) => EARLY_2026.has(date.slice(5)) ? 13 * 60 : 16 * 60;
function session(date: string): boolean {
  // UTC arithmetic here is only civil-calendar arithmetic, never a market date.
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return date.startsWith('2026-') && day !== 0 && day !== 6 && !CLOSED_2026.has(date.slice(5));
}
export function latestCompletedUsCashSession(nowMs: number): string | null {
  if (!Number.isFinite(nowMs)) return null;
  const now = clock(nowMs);
  if (!now.date.startsWith('2026-')) return null;
  let date = now.date;
  for (let offset = 0; offset < 10; offset++) {
    if (session(date) && (offset > 0 || now.minutes >= closeMinute(date))) return date;
    date = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}
export function isLatestCompletedUsCashQuote(symbol: string, timestamp: number, nowMs: number): boolean {
  if (!SYMBOLS.has(symbol.toUpperCase().replace(/^\^/, '')) || !Number.isFinite(timestamp) || timestamp > nowMs) return false;
  const observed = clock(timestamp);
  return observed.date === latestCompletedUsCashSession(nowMs) && observed.minutes >= closeMinute(observed.date);
}
