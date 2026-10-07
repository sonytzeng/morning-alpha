// Explicit read-only candidate audit. No provider key, DB, ticker subscription
// or Production universe update. Public source bodies stay in process memory.
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const sources=[
 ['TWSE','companies','https://openapi.twse.com.tw/v1/opendata/t187ap03_L'],
 ['TWSE','quotes','https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'],
 ['TPEX','companies','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'],
 ['TPEX','quotes','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'],
];
const data={},receipts=[];
for(const [market,kind,url]of sources){
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('OFFICIAL_UNIVERSE_SOURCE_UNAVAILABLE');
 const body=await response.text();if(body.length>16000000)throw Error('OFFICIAL_SOURCE_LIMIT');
 const parsed=JSON.parse(body);if(!Array.isArray(parsed))throw Error('OFFICIAL_SOURCE_SCHEMA');
 data[market+':'+kind]=parsed;receipts.push({market,kind,url,http:response.status,rows:parsed.length});
}
const number=v=>{const n=Number(String(v??'').replaceAll(',',''));return Number.isFinite(n)?n:null;};
const all=[],markets=[];
for(const market of ['TWSE','TPEX']){
 const companies=data[market+':companies'].map(r=>({symbol:String(market==='TWSE'?r['公司代號']:r.SecuritiesCompanyCode),industry:String((market==='TWSE'?r['產業別']:r.SecuritiesIndustryCode)||'')}));
 const quotes=new Map(data[market+':quotes'].map(r=>[String(market==='TWSE'?r.Code:r.SecuritiesCompanyCode),r]));
 const candidates=companies.filter(r=>/^\d{4}$/.test(r.symbol)).map(c=>{const q=quotes.get(c.symbol);return {...c,market,quote:Boolean(q),date:q?.Date??null,
  close:number(market==='TWSE'?q?.ClosingPrice:q?.Close),amount:number(market==='TWSE'?q?.TradeValue:q?.TransactionAmount)};});
 all.push(...candidates);markets.push({market,companies:companies.length,four_digit_common_candidates:candidates.length,
  quote_join:candidates.filter(r=>r.quote).length,positive_close:candidates.filter(r=>r.close>0).length,
  industry_present:candidates.filter(r=>r.industry).length,
  single_day_amount_at_least_50m:candidates.filter(r=>r.amount>=50000000).length,
  quote_dates:[...new Set(candidates.filter(r=>r.quote).map(r=>r.date))].sort()});
}
console.log(JSON.stringify({scope:'READ_ONLY_UNIVERSE_CANDIDATE_NOT_PRODUCTION',as_of:new Date().toISOString(),sources:receipts,markets,
 candidate_count:all.length,duplicate_symbols:all.length-new Set(all.map(r=>r.symbol)).size,
 current_72_in_official_list:RECOMMENDATION_UNIVERSE.filter(s=>all.some(r=>r.symbol===s)).length,
 current_72_with_quote:RECOMMENDATION_UNIVERSE.filter(s=>all.some(r=>r.symbol===s&&r.quote)).length,
 history_20d:'NOT_ACQUIRED_FOR_EXPANDED_UNIVERSE',liquidity_rule:'ONE_DAY_PROXY_IS_NOT_20D_QUALIFICATION',
 production_universe:72,production_changes:0},null,2));
