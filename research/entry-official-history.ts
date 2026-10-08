/** Public exchange research adapter. No credentials, Production writes or strategy changes. */
import type { Bar } from './entry-opportunity.ts';
export type Exchange='TWSE'|'TPEX';
type Row=unknown[];
type Payload={stat?:unknown;title?:unknown;date?:unknown;code?:unknown;fields?:unknown;data?:unknown;tables?:unknown};
export function officialDate(value:unknown):string|null {
 const m=String(value??'').trim().match(/^(\d{3,4})[/-]?(\d{2})[/-]?(\d{2})$/);if(!m)return null;
 const y=Number(m[1])+(m[1].length===3?1911:0),s=`${y}-${m[2]}-${m[3]}`;
 return Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:null;
}
export function officialNumber(value:unknown):number|null {
 const s=String(value??'').replace(/,/g,'').trim();if(!/^-?\d+(?:\.\d+)?$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
}
export function historyUrl(exchange:Exchange,symbol:string,month:string){
 if(!['TWSE','TPEX'].includes(exchange)||!/^\d{4,6}$/.test(symbol)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('REQUEST_INVALID');
 const u=new URL(exchange==='TWSE'?'https://www.twse.com.tw/exchangeReport/STOCK_DAY':'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock');
 u.searchParams.set('response','json');u.searchParams.set('date',exchange==='TWSE'?month.replace('-','')+'01':month.replace('-','/')+'/01');
 u.searchParams.set(exchange==='TWSE'?'stockNo':'code',symbol);return u.href;
}
export function parseOfficialHistory(exchange:Exchange,symbol:string,month:string,p:Payload,receivedAt:string){
 const source=historyUrl(exchange,symbol,month);
 if(!Number.isFinite(Date.parse(receivedAt)))throw Error('RECEIVED_AT_INVALID');
 if(String(p.stat).toLowerCase()!=='ok')throw Error('PROVIDER_NOT_OK');
 let fields:unknown,data:unknown;
 if(exchange==='TWSE'){
  if(!new RegExp(`(?:^|\\s)${symbol}(?:\\s|$)`).test(String(p.title))||String(p.date).slice(0,6)!==month.replace('-',''))throw Error('RESPONSE_IDENTITY_MISMATCH');
  fields=p.fields;data=p.data;
 }else{
  if(p.code!==symbol||!Array.isArray(p.tables))throw Error('RESPONSE_IDENTITY_MISMATCH');
  const tables=p.tables as {fields?:unknown;data?:unknown}[];
  const matching=tables.filter(t=>Array.isArray(t.fields)&&t.fields.some(f=>String(f).includes('成交張數')));
  if(matching.length!==1)throw Error('TABLE_AMBIGUOUS');fields=matching[0].fields;data=matching[0].data;
 }
 const expected=exchange==='TWSE'?['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價']:['日期','成交張數','成交仟元','開盤','最高','最低','收盤'];
 if(!Array.isArray(fields)||!Array.isArray(data)||expected.some((f,i)=>String(fields[i]).replace(/\s/g,'')!==f))throw Error('SCHEMA_OR_UNITS_CHANGED');
 const bars:Bar[]=[],rejected:{date:string|null;reason:string}[]=[];const dates=new Set<string>();
 for(const r of data as Row[]){
  if(!Array.isArray(r))throw Error('ROW_SHAPE_INVALID');
  const date=officialDate(r[0]),numbers=r.slice(1,7).map(officialNumber);
  if(!date||date.slice(0,7)!==month)throw Error('SESSION_OUTSIDE_REQUEST');
  if(dates.has(date))throw Error('DUPLICATE_SESSION');dates.add(date);
  if(numbers.some(n=>n===null||n<=0)){rejected.push({date,reason:'NO_VALID_TRADING_OHLCV_AMOUNT'});continue;}
  const [volume,amount,open,high,low,close]=numbers as number[];
  if(high<Math.max(open,close)||low>Math.min(open,close)){rejected.push({date,reason:'OHLC_INCONSISTENT'});continue;}
  if(Date.parse(date+'T13:30:00+08:00')>Date.parse(receivedAt)){rejected.push({date,reason:'INCOMPLETE_OR_FUTURE_SESSION'});continue;}
  bars.push({date,open,high,low,close,volume:volume*(exchange==='TPEX'?1000:1),amount:amount*(exchange==='TPEX'?1000:1),source_ref:source,available_at:receivedAt});
 }
 return {exchange,symbol,month,source_ref:source,received_at:receivedAt,price_basis:'RAW_EXCHANGE_AS_RETRIEVED',
  volume_amount_scope:exchange==='TPEX'?'ROUNDED_THOUSANDS_EXCLUDES_BLOCK_TRADES':'OFFICIAL_STOCK_DAY',
  exact_volume_amount:exchange==='TWSE',
  availability_basis:'ACTUAL_RECEIPT_NOT_BACKDATED',provenance:'RETROSPECTIVE_PUBLIC_ACQUISITION',volume_unit:'SHARES',amount_unit:'TWD',bars,rejected};
}
export function tpexDailyUrl(date:string){
 if(officialDate(date)!==date)throw Error('REQUEST_DATE_INVALID');
 const u=new URL('https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes');u.searchParams.set('date',date.replaceAll('-','/'));u.searchParams.set('response','json');return u.href;
}
export function parseTpexDaily(p:Payload,date:string,symbols:string[],receivedAt:string){
 const source=tpexDailyUrl(date);
 if(String(p.stat).toLowerCase()!=='ok'||officialDate(p.date)!==date||!Array.isArray(p.tables)||
  !Number.isFinite(Date.parse(receivedAt))||Date.parse(receivedAt)<Date.parse(date+'T13:30:00+08:00'))throw Error('DAILY_SESSION_INVALID');
 const expected=['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'];
 const tables=p.tables as {fields?:unknown;data?:unknown}[];
 if(tables.some(t=>{const f=t.fields;return !Array.isArray(f)||expected.some((name,i)=>f[i]!==name)||!Array.isArray(t.data);}))throw Error('DAILY_SCHEMA_CHANGED');
 const rows=tables.flatMap(t=>t.data as Row[]);
 const daily=symbols.map(symbol=>{
  const matches=rows.filter(r=>r[0]===symbol);if(matches.length!==1)return {symbol,bar:null,reason:matches.length?'DUPLICATE_SYMBOL':'SYMBOL_MISSING'};
  const row=matches[0],values=[row[4],row[5],row[6],row[2],row[8],row[9]].map(officialNumber);
  if(values.some(v=>v===null||v<=0))return {symbol,bar:null,reason:'NO_VALID_TRADING_OHLCV_AMOUNT'};
  const [open,high,low,close,volume,amount]=values as number[];
  if(high<Math.max(open,close)||low>Math.min(open,close)||!Number.isSafeInteger(volume)||!Number.isSafeInteger(amount))return {symbol,bar:null,reason:'OHLCV_AMOUNT_INVALID'};
  return {symbol,bar:{date,open,high,low,close,volume,amount,available_at:receivedAt,source_ref:source} satisfies Bar,reason:null};
 });
 return {date,exchange:'TPEX',source_ref:source,received_at:receivedAt,daily,exact_volume_amount:true,
  volume_unit:'SHARES',amount_unit:'TWD',volume_amount_scope:'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES',
  provenance:'RETROSPECTIVE_PUBLIC_ACQUISITION',availability_basis:'ACTUAL_RECEIPT_NOT_BACKDATED'};
}
/** Whitelist only public security classification; contacts and company officers never leave this function. */
export function companyDirectory(exchange:Exchange,rows:unknown,source:string,receivedAt:string){
 const expected=exchange==='TWSE'?'https://openapi.twse.com.tw/v1/opendata/t187ap03_L':'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
 if(source!==expected||!Array.isArray(rows)||!Number.isFinite(Date.parse(receivedAt)))throw Error('DIRECTORY_INVALID');
 return rows.flatMap(r=>{
  if(!r||typeof r!=='object')return [];const x=r as Record<string,unknown>;
  const symbol=String(x['公司代號']??x.SecuritiesCompanyCode??''),industry=String(x['產業別']??x.SecuritiesIndustryCode??'');
  const listingDate=officialDate(x['上市日期']??x['上櫃日期']??x.DateOfListing);
  if(!/^\d{4}$/.test(symbol)||!/^\d{1,2}$/.test(industry))return [];
  return [{symbol,industry_code:industry.padStart(2,'0'),exchange,listing_date:listingDate,source_ref:source,available_at:receivedAt,
   classification_scope:'CURRENT_OFFICIAL_INDUSTRY_NOT_HISTORIC_THEME_OR_TRADEABILITY_PROOF'}];
 });
}
/** Ex-post search index only: future bars identify the historical shape, NEVER
 * feed an entry signal. Diagnostic cutoffs below are not strategy thresholds. */
export function retrospectiveShapes(bars:Bar[],actionDates:string[],completeActionCoverage:boolean){
 const sorted=[...bars].sort((a,b)=>a.date.localeCompare(b.date));
 if(new Set(sorted.map(b=>b.date)).size!==sorted.length)throw Error('DUPLICATE_SESSION');
 const hits:{date:string;shape:string;confirmation_date:string;action_review:string}[]=[];
 for(let i=20;i+5<sorted.length;i++){
  const prior=sorted.slice(i-20,i),b=sorted[i],p=sorted[i-1],next=sorted.slice(i+1,i+6);
  const atr=prior.slice(1).reduce((n,x,j)=>n+Math.max(x.high-x.low,Math.abs(x.high-prior[j].close),Math.abs(x.low-prior[j].close)),0)/19;
  const high=Math.max(...prior.map(x=>x.high)),avg=prior.reduce((n,x)=>n+x.close,0)/20;
  const volume=prior.reduce((n,x)=>n+x.volume,0)/20;
  const overlap=actionDates.some(d=>d>=prior[0].date&&d<=next.at(-1)!.date);
  const add=(shape:string,confirmation:string)=>hits.push({date:b.date,shape,confirmation_date:confirmation,
   action_review:overlap?'KNOWN_ACTION_IN_WINDOW':completeActionCoverage?'NO_ACTION_IN_VERIFIED_WINDOW':'ACTION_COVERAGE_INCOMPLETE'});
  if(atr>0&&p.close-b.close>=2*atr&&next.at(-1)!.close>b.close)add('SHARP_DECLINE_THEN_BOUNCE',next.at(-1)!.date);
  if(b.close>=avg&&b.close<Math.max(...prior.slice(-5).map(x=>x.close))&&next.at(-1)!.close>b.close)add('TREND_PULLBACK_THEN_RISE',next.at(-1)!.date);
  if(b.close>high&&b.volume>=1.5*volume){
   if(next.at(-1)!.close>b.close)add('BREAKOUT_CONTINUATION',next.at(-1)!.date);
   const failed=next.find(x=>x.close<high);if(failed)add('FALSE_BREAKOUT',failed.date);
  }
  if(b.open>p.high&&b.close<p.close)add('GAP_FAILURE',b.date);
  if(atr>0&&b.high-b.low>=2*atr)add('HIGH_VOLATILITY',b.date);
 }
 return {scope:'EX_POST_PRICE_SHAPE_SEARCH_NOT_STRATEGY_VALIDATION',forward_sample:0,outcome_sample:0,
  strategy_validation:'UNVERIFIED_AS_OF_EVIDENCE_AND_EXECUTION_REQUIRED',hits};
}
