/** Shadow-only adapters. No credentials, persistence, strategy or V1 mutation.
 * Public response fields are allowlisted; raw company/contact data is discarded. */
import { isMarketTradingDate, previousMarketTradingDate } from './market-session-contract.mjs';
import type { Row } from './decision-v1-data.ts';

export type Shares = {
 symbol:string; session:string; source:string; available_at:string; unit:'SHARES';
 foreign:{buy:number;sell:number;net:number}; trust:{buy:number;sell:number;net:number}; dealer:{buy:number;sell:number;net:number};
};
export type ActualGrowth = {
 symbol:string; period:string; source:string; available_at:string; source_date:string;
 revenue_yoy:number|null; revenue_mom:number|null; actual_only:true; consensus:null;
};
export type V2SourceCapture<T> = {source:string; received_at:string; http:number|null; status:string; rows:T[]};
export const V2_SOURCE_URLS=Object.freeze({
 twseShares:'https://www.twse.com.tw/rwd/zh/fund/T86',
 tpexShares:'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading',
 twseGrowth:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',
 tpexGrowth:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O',
});
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
const number=(v:unknown):number|null=>{const s=text(v).replaceAll(',','');return /^-?\d+(\.\d+)?$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;};
function date(v:unknown){
 const m=text(v).match(/^(\d{3,4})[-/]?(\d{2})[-/]?(\d{2})$/);if(!m)return null;
 const d=`${Number(m[1])+(m[1].length===3?1911:0)}-${m[2]}-${m[3]}`;
 const stamp=Date.parse(d+'T00:00:00Z');return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===d?d:null;
}
function receipt(at:string){const n=Date.parse(at);if(!Number.isFinite(n))throw Error('V2_RECEIPT_INVALID');return new Date(n+8*3600000).toISOString();}
function group(b:unknown,s:unknown,n:unknown){
 const buy=number(b),sell=number(s),net=number(n);
 if(buy===null||sell===null||net===null||![buy,sell,net].every(Number.isSafeInteger)||buy<0||sell<0||buy-sell!==net)throw Error('V2_SHARES_ACCOUNTING_INVALID');
 return {buy,sell,net};
}
function sum(a:unknown,b:unknown){const x=number(a),y=number(b);return x!==null&&y!==null&&Number.isSafeInteger(x+y)?x+y:null;}
function assertSession(session:string|null,at:string){
 const now=receipt(at),today=now.slice(0,10),previous=previousMarketTradingDate('TW',today);
 // Before today's final close, only the most recent completed session. After
 // close, yesterday remains explicitly previous-session evidence until today's
 // exchange publication exists. This is not an arbitrary-age freshness rule.
 if(!session||!isMarketTradingDate('TW',session)||
  !(session===previous||session===today&&isMarketTradingDate('TW',today)&&now.slice(11,16)>='13:30'))throw Error('V2_SHARES_SESSION_INVALID');
}
export function normalizeTwseShares(payload:unknown,at:string,symbols:readonly string[]):Shares[]{
 const p=obj(payload),session=date(p.date);assertSession(session,at);
 if(p.stat!=='OK'||!Array.isArray(p.fields)||!Array.isArray(p.data)||p.data.length>30000)throw Error('V2_TWSE_SCHEMA_INVALID');
 const fields=p.fields.map(text);if(new Set(fields).size!==fields.length)throw Error('V2_DUPLICATE_FIELD');
 const allowed=new Set(symbols),seen=new Set<string>(),out:Shares[]=[];
 for(const raw of p.data){
  if(!Array.isArray(raw)||raw.length!==fields.length)throw Error('V2_TWSE_ROW_INVALID');
  const r=Object.fromEntries(fields.map((k,i)=>[k,raw[i]])),symbol=text(r['證券代號']);if(!allowed.has(symbol))continue;
  if(seen.has(symbol))throw Error('V2_DUPLICATE_SYMBOL');seen.add(symbol);
  const foreign=group(r['外陸資買進股數(不含外資自營商)'],r['外陸資賣出股數(不含外資自營商)'],r['外陸資買賣超股數(不含外資自營商)']);
  const trust=group(r['投信買進股數'],r['投信賣出股數'],r['投信買賣超股數']);
  const dealer=group(sum(r['自營商買進股數(自行買賣)'],r['自營商買進股數(避險)']),sum(r['自營商賣出股數(自行買賣)'],r['自營商賣出股數(避險)']),r['自營商買賣超股數']);
  if(foreign.net+trust.net+dealer.net!==number(r['三大法人買賣超股數']))throw Error('V2_TOTAL_SHARES_INVALID');
  out.push({symbol,session:session!,source:V2_SOURCE_URLS.twseShares,available_at:at,unit:'SHARES',foreign,trust,dealer});
 }
 return out;
}
export function normalizeTpexShares(payload:unknown,at:string,symbols:readonly string[]):Shares[]{
 receipt(at);if(!Array.isArray(payload)||payload.length>3000)throw Error('V2_TPEX_SCHEMA_INVALID');
 const allowed=new Set(symbols),seen=new Set<string>(),out:Shares[]=[];
 for(const raw of payload){
  // TPEx has a leading-space field. Normalize keys once, reject collisions.
  const entries=Object.entries(obj(raw)),keys=entries.map(([k])=>k.trim());
  if(new Set(keys).size!==keys.length)throw Error('V2_DUPLICATE_FIELD');
  const r=Object.fromEntries(entries.map(([k,v])=>[k.trim(),v])),symbol=text(r.SecuritiesCompanyCode);if(!allowed.has(symbol))continue;
  if(seen.has(symbol))throw Error('V2_DUPLICATE_SYMBOL');seen.add(symbol);
  const session=date(r.Date);assertSession(session,at);
  const prefix='Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-';
  const foreign=group(r[prefix+'Total Buy'],r[prefix+'Total Sell'],r[prefix+'Difference']);
  const trust=group(r['SecuritiesInvestmentTrustCompanies-TotalBuy'],r['SecuritiesInvestmentTrustCompanies-TotalSell'],r['SecuritiesInvestmentTrustCompanies-Difference']);
  const dealer=group(r['Dealers-TotalBuy'],r['Dealers-TotalSell'],r['Dealers-Difference']);
  if(foreign.net+trust.net+dealer.net!==number(r.TotalDifference))throw Error('V2_TOTAL_SHARES_INVALID');
  out.push({symbol,session:session!,source:V2_SOURCE_URLS.tpexShares,available_at:at,unit:'SHARES',foreign,trust,dealer});
 }
 return out;
}
export function normalizeActualGrowth(payload:unknown,source:string,at:string,symbols:readonly string[]):ActualGrowth[]{
 const today=receipt(at).slice(0,10);
 if(source!==V2_SOURCE_URLS.twseGrowth&&source!==V2_SOURCE_URLS.tpexGrowth||!Array.isArray(payload)||payload.length>3000)throw Error('V2_GROWTH_SCHEMA_INVALID');
 const allowed=new Set(symbols),seen=new Set<string>(),out:ActualGrowth[]=[];
 for(const raw of payload){
  const r=obj(raw),symbol=text(r['公司代號']);if(!allowed.has(symbol))continue;
  if(seen.has(symbol))throw Error('V2_DUPLICATE_SYMBOL');seen.add(symbol);
  const sourceDate=date(r['出表日期']),m=text(r['資料年月']).match(/^(\d{3,4})(\d{2})$/);
  if(!sourceDate||sourceDate>today||!m||Number(m[2])<1||Number(m[2])>12)throw Error('V2_GROWTH_PERIOD_INVALID');
  const period=`${Number(m[1])+(m[1].length===3?1911:0)}-${m[2]}`;
  // Monthly public series is a latest observation, not a backdated history.
  if(period>=sourceDate.slice(0,7)||Date.parse(at)-Date.parse(period+'-01T00:00:00+08:00')>75*86400000)throw Error('V2_GROWTH_STALE');
  const current=number(r['營業收入-當月營收']);if(current===null||current<0)throw Error('V2_REVENUE_INVALID');
  const ratio=(base:unknown,reported:unknown)=>{
   const b=number(base),stated=number(reported);if(b===null||b<=0)return null;
   const calculated=(current/b-1)*100;
   if(stated===null||Math.abs(stated-calculated)>.02)throw Error('V2_GROWTH_RATIO_MISMATCH');
   return calculated/100;
  };
  out.push({symbol,period,source,available_at:at,source_date:sourceDate,
   revenue_yoy:ratio(r['營業收入-去年當月營收'],r['營業收入-去年同月增減(%)']),
   revenue_mom:ratio(r['營業收入-上月營收'],r['營業收入-上月比較增減(%)']),actual_only:true,consensus:null});
 }
 return out;
}
export function normalizeFugleShares(payload:unknown,source:string,at:string,symbol:string):Shares[]{
 const p=obj(payload),expected=`https://api.fugle.tw/marketdata/v1.0/stock/ownership/institutional-trades/${symbol}`;
 if(source!==expected||p.symbol!==symbol||!Array.isArray(p.data)||p.data.length>366)throw Error('V2_FUGLE_SHARES_SCHEMA_INVALID');
 const out:Shares[]=[];const seen=new Set<string>();
 for(const raw of p.data){const r=obj(raw),session=date(r.date);assertSession(session,at);
  if(seen.has(session!))throw Error('V2_DUPLICATE_SESSION');seen.add(session!);
  const read=(k:string)=>{const x=obj(r[k]);return group(x.buy,x.sell,x.net);};
  const foreign=read('foreign'),trust=read('trust'),dealer=read('dealer');
  if(number(r.total)!==foreign.net+trust.net+dealer.net)throw Error('V2_TOTAL_SHARES_INVALID');
  out.push({symbol,session:session!,source,available_at:at,unit:'SHARES',foreign,trust,dealer});
 }
 return out;
}
async function boundedJson(response:Response){
 const reader=response.body?.getReader();if(!reader)throw Error('V2_BODY_MISSING');
 let body='',size=0;const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8_000_000){await reader.cancel();throw Error('V2_RESPONSE_LIMIT');}body+=decoder.decode(part.value,{stream:true});}
  return JSON.parse(body+decoder.decode()) as unknown;
 }finally{reader.releaseLock();}
}
export async function acquireV2PublicSources(options:{symbols:readonly string[];fetcher:typeof fetch;now:()=>string;signal:AbortSignal}){
 const at=options.now(),local=receipt(at),today=local.slice(0,10);
 // The technical baseline is the preceding completed session. Do not invent
 // an exchange publication cutoff; TPEx exposes its actual response date.
 const session=previousMarketTradingDate('TW',today);
 if(!session)throw Error('V2_CALENDAR_UNAVAILABLE');
 const twse=V2_SOURCE_URLS.twseShares+'?date='+session.replaceAll('-','')+'&selectType=ALL&response=json';
 const tasks=[{url:twse,kind:'shares',normalize:normalizeTwseShares},{url:V2_SOURCE_URLS.tpexShares,kind:'shares',normalize:normalizeTpexShares},
  ...[V2_SOURCE_URLS.twseGrowth,V2_SOURCE_URLS.tpexGrowth].map(url=>({url,kind:'growth',normalize:(p:unknown,t:string,s:readonly string[])=>normalizeActualGrowth(p,url,t,s)}))];
 const captures:(V2SourceCapture<Shares|ActualGrowth>&{kind:string})[]=[];let cursor=0;
 await Promise.all(Array.from({length:2},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];
  const capture:typeof captures[number]={source:task.url,kind:task.kind,received_at:options.now(),http:null,status:'UNAVAILABLE',rows:[]};
  for(let attempt=0;attempt<2;attempt++){
  try{const response=await options.fetcher(task.url,{redirect:'error',signal:AbortSignal.any([options.signal,AbortSignal.timeout(8000)])});capture.http=response.status;
   if(!response.ok){await response.body?.cancel();capture.status='HTTP_'+response.status;}
   else{const payload=await boundedJson(response);capture.received_at=options.now();capture.rows=task.normalize(payload,capture.received_at,options.symbols);capture.status='PASS';}
  }catch(e){const message=e instanceof Error?e.message:'';capture.status=/^V2_[A-Z_]+$/.test(message)?message:'SOURCE_UNAVAILABLE';}
  if(options.signal.aborted||!['SOURCE_UNAVAILABLE','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504'].includes(capture.status)||attempt===1)break;
  await new Promise(resolve=>setTimeout(resolve,1000));
  }
  captures.push(capture);
 }}));
 return captures.sort((a,b)=>a.source.localeCompare(b.source));
}
