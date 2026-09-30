// Verified 2026-09-08 against Nasdaq's published U.S. equity calendar:
// https://www.nasdaqtrader.com/Trader.aspx?id=calendar
// Deliberately scoped to cash equities/index proxies, NOT FX, rates or futures.
// Unknown years never extend the ordinary age limit. Refresh this contract from
// an official calendar before using a new year; do not infer closures from data.
import { latestCompletedUsSession, usSessionCloseMinute } from './market-session-contract.mjs';
const SYMBOLS = new Set(['SPX', 'SP500', 'GSPC', 'SPY', 'IXIC', 'NASDAQ', 'QQQ', 'SOX', 'PHLX', 'SOXX', 'TSM', 'TSMC', 'NVDA', 'DJIA', 'DJI', 'AAPL', 'MSFT', 'META', 'AMZN']);
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function clock(timestamp: number) {
  const parts = formatter.formatToParts(timestamp);
  const part = (name: string) => parts.find((item) => item.type === name)?.value || '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, minutes: Number(part('hour')) * 60 + Number(part('minute')) };
}
export const latestCompletedUsCashSession = latestCompletedUsSession;
export function isLatestCompletedUsCashQuote(symbol: string, timestamp: number, nowMs: number): boolean {
  if (!SYMBOLS.has(symbol.toUpperCase().replace(/^\^/, '')) || !Number.isFinite(timestamp) || timestamp > nowMs) return false;
  const observed = clock(timestamp);
  return observed.date === latestCompletedUsCashSession(nowMs) && observed.minutes >= usSessionCloseMinute(observed.date);
}
