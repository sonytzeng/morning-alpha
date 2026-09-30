import calendar from './market-calendar-data.json' with { type: 'json' };
export const MARKET_CALENDAR_VERSION = calendar.version;
export const GLOBAL8_SOURCE_SYMBOLS = Object.freeze(calendar.global8_source_symbols);
export const coveredCalendarDate = (market, date) => !!calendar[market] && date >= calendar[market].from && date <= calendar[market].through;
export function isMarketTradingDate(market, date) {
  if (!coveredCalendarDate(market, date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  return ![0, 6].includes(parsed.getUTCDay()) && !calendar[market].closed.includes(date) &&
    !(calendar[market].preserved_exceptional_closures || []).includes(date);
}
export function previousMarketTradingDate(market, date) {
  let ms = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  for (let i = 0; i < 30; i++) {
    ms -= 86400000;
    const prior = new Date(ms).toISOString().slice(0, 10);
    if (!coveredCalendarDate(market, prior)) return null;
    if (isMarketTradingDate(market, prior)) return prior;
  }
  return null;
}
const ny = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
function usClock(ms) {
  const parts = ny.formatToParts(ms);
  const p = key => parts.find(item => item.type === key)?.value || '';
  return {date:`${p('year')}-${p('month')}-${p('day')}`, minutes:Number(p('hour')) * 60 + Number(p('minute'))};
}
export const usSessionCloseMinute = date => calendar.US.early_close.includes(date) ? 780 : 960;
export function latestCompletedUsSession(nowMs) {
  if (!Number.isFinite(nowMs)) return null;
  const now = usClock(nowMs);
  if (!coveredCalendarDate('US', now.date)) return null;
  return isMarketTradingDate('US', now.date) && now.minutes >= usSessionCloseMinute(now.date)
    ? now.date : previousMarketTradingDate('US', now.date);
}
export function validateGlobal8Session(symbol, sourceSymbol, timestamp, observedAt) {
  const ms = Date.parse(String(timestamp)), observedMs = Date.parse(String(observedAt));
  if (!Number.isFinite(ms) || !Number.isFinite(observedMs)) return {valid:false, error:'INVALID_CHECKPOINT_PROVENANCE'};
  if (ms > observedMs) return {valid:false, error:'PROVIDER_FUTURE_EVIDENCE'};
  if (GLOBAL8_SOURCE_SYMBOLS[symbol] !== sourceSymbol) return {valid:false, error:'PROVIDER_SYMBOL_MAPPING_INVALID'};
  const expected = latestCompletedUsSession(observedMs), source = usClock(ms);
  if (!expected) return {valid:false, error:'MARKET_CALENDAR_COVERAGE_MISSING'};
  if (source.date !== expected || source.minutes < usSessionCloseMinute(source.date) || observedMs - ms > 7 * 86400000) {
    return {valid:false, error:'PROVIDER_STALE_SESSION', expected_session_date:expected};
  }
  return {valid:true, expected_session_date:expected, contract:MARKET_CALENDAR_VERSION};
}
