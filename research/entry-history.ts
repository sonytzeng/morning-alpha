/** Offline research integration only. Does not call Providers or change V1/V2. */
import { previousMarketTradingDate, isMarketTradingDate } from '../supabase/functions/_shared/market-session-contract.mjs';
import { v2Bars, v2Hash, type V2Input } from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import type { Bar, Strategy } from './entry-opportunity.ts';

// Inventory of the frozen formulas, NOT a new common strategy threshold.
export const ENTRY_LOOKBACKS: Record<Strategy, Record<string, number>> = {
  OVERSOLD_REVERSAL: { atr_and_drawdown: 20, support: 5, selling_pressure: 6, confirmation: 2 },
  PULLBACK_ENTRY: { slow_average: 20, fast_average: 10, support: 5, volume_comparison: 6, confirmation: 2 },
  BREAKOUT_CONTINUATION: { resistance_and_volume: 20, extension_average: 5, confirmation: 2 },
};
export function historySessions(businessDate: string, count: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || !isMarketTradingDate('TW', businessDate) ||
    ![20,60,120].includes(count)) throw Error('HISTORY_REQUEST_INVALID');
  const dates: string[] = []; let d: string | null = businessDate;
  for (let n=0;n<count;n++) { d=previousMarketTradingDate('TW',d); if(!d) throw Error('HISTORY_CALENDAR_UNAVAILABLE'); dates.unshift(d); }
  return dates;
}
export function auditHistory(bars: Bar[], businessDate: string, cutoff: string, count: number) {
  const expected=historySessions(businessDate,count), at=Date.parse(cutoff);
  if(!Number.isFinite(at))throw Error('HISTORY_CUTOFF_INVALID');
  const gaps=expected.flatMap(date=>{
    const rows=bars.filter(b=>b.date===date);
    if(rows.length!==1)return [{date,reason:rows.length?'DUPLICATE_SESSION':'SESSION_MISSING'}];
    const b=rows[0];
    if(!b.source_ref||![b.open,b.high,b.low,b.close,b.volume,b.amount].every(v=>Number.isFinite(v)&&v>0)||
      b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))return [{date,reason:'OHLCV_AMOUNT_INVALID'}];
    const available=Date.parse(b.available_at);
    if(!Number.isFinite(available)||available<Date.parse(date+'T13:30:00+08:00')||available>at)
      return [{date,reason:'NOT_AVAILABLE_AT_CUTOFF'}];
    return [];
  });
  return {requested:count,valid:count-gaps.length,complete:gaps.length===0,from:expected[0],to:expected.at(-1)!,gaps};
}
/** A request manifest, never a live credential-bearing acquisition. Any response
 * fetched now keeps its actual received_at; it cannot repair a past cutoff. */
export function fugleHistoryRequest(symbol:string,businessDate:string,count:20|60|120) {
  if(!/^\d{4,6}$/.test(symbol))throw Error('HISTORY_SYMBOL_INVALID');
  const dates=historySessions(businessDate,count);
  const url=new URL('https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/'+symbol);
  for(const [k,v]of Object.entries({from:dates[0],to:dates.at(-1)!,timeframe:'D',fields:'open,high,low,close,volume,turnover',sort:'asc',adjusted:'false'}))url.searchParams.set(k,v);
  return {url:url.href,expected_sessions:dates,price_basis:'RAW',max_attempts:3,concurrency:1,
    request_spacing_ms:1200,per_request_timeout_ms:4000,credential:'EXISTING_PROVIDER_SERVER_IDENTITY_ONLY',
    historic_availability:'DO_NOT_BACKDATE_RECEIVED_AT',executed:false};
}
export async function auditRetainedHistory(input:V2Input,expectedHash:string) {
  if(await v2Hash(input)!==expectedHash)throw Error('HISTORY_SOURCE_HASH_MISMATCH');
  const active=input.data.universe.filter(r=>r.is_active===true);
  if(new Set(active.map(r=>r.symbol)).size!==active.length)throw Error('HISTORY_UNIVERSE_DUPLICATE');
  const stocks=active.map(r=>{
    const symbol=String(r.symbol),bars=v2Bars(input,symbol);
    const mapped=active.filter(p=>p.symbol!==symbol&&typeof r.sector==='string'&&r.sector&&p.sector===r.sector);
    const validPeers=mapped.filter(p=>auditHistory(v2Bars(input,String(p.symbol)),input.identity.report_date,input.identity.generated_at,20).complete);
    return {symbol,retained_bars:bars.length,coverage:Object.fromEntries([20,60,120].map(n=>[n,auditHistory(bars,input.identity.report_date,input.identity.generated_at,n)])),
      sector_peers:{mapped:mapped.length,valid:validPeers.length,required:3,
        reason:mapped.length<3?'UNIVERSE_COVERAGE_GAP':validPeers.length<3?'PEER_EVIDENCE_GAP':'COMPLETE'}};
  });
  return {business_date:input.identity.report_date,cutoff:input.identity.generated_at,source_hash:expectedHash,
    stocks,coverage:Object.fromEntries([20,60,120].map(n=>[n,stocks.filter(s=>s.coverage[n].complete).length])),
    valid_sector_comparison:stocks.filter(s=>s.sector_peers.reason==='COMPLETE').length,
    historical_only:true,forward_sample:0,corporate_action_proof:'NOT_PRESENT_IN_RETAINED_V2_CONTRACT'};
}
