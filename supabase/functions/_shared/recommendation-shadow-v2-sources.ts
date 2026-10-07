/** Shadow-only adapters. No credential storage, persistence, strategy or V1 mutation.
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
type ShadowSource = V2SourceCapture<Shares|ActualGrowth>&{kind:string};
export type FugleSharesCapture = V2SourceCapture<Shares>&{
 kind:'shares'; symbol:string; requested_session:string|null; attempts:number;
 provenance:'FUGLE_INSTITUTIONAL_SHARES';
};
export const V2_FUGLE_SHARES_URL='https://api.fugle.tw/marketdata/v1.0/stock/ownership/institutional-trades/';
export type BenchmarkClose={date:string;close:number;source:string;available_at:string};
export const V2_INDEX_URL='https://www.twse.com.tw/indicesReport/MI_5MINS_HIST';
export function normalizeV2IndexHistory(payload:unknown,month:string,at:string):BenchmarkClose[]{
 const p=obj(payload),today=receipt(at).slice(0,10);
 if(p.stat!=='OK'||String(p.date).slice(0,6)!==month.replace('-','')||JSON.stringify(p.fields)!==JSON.stringify(['日期','開盤指數','最高指數','最低指數','收盤指數'])||!Array.isArray(p.data)||p.data.length>31)throw Error('V2_INDEX_SCHEMA_INVALID');
 const seen=new Set<string>();
 return p.data.map(raw=>{
  if(!Array.isArray(raw)||raw.length!==5)throw Error('V2_INDEX_ROW_INVALID');
  const day=date(raw[0]),values=raw.slice(1).map(number),[open,high,low,close]=values;
  if(!day||!day.startsWith(month)||day>today||!isMarketTradingDate('TW',day)||seen.has(day)||values.some(v=>v===null||v<=0)||high!<Math.max(open!,close!)||low!>Math.min(open!,close!))throw Error('V2_INDEX_ROW_INVALID');
  if(day===today&&receipt(at).slice(11,16)<'13:30')throw Error('V2_INDEX_FUTURE_CLOSE');
  seen.add(day);return {date:day,close:close!,source:V2_INDEX_URL+'?date='+month.replace('-','')+'01&response=json#'+day,available_at:at};
 });
}
/** Shadow-only history: acquisition now never claims historical availability,
 * never backfills market_quotes, and never changes formal V1 evidence. */
export async function acquireV2IndexHistory(options:{businessDate:string;fetcher:typeof fetch;now:()=>string;signal:AbortSignal}){
 const days:string[]=[];let day=previousMarketTradingDate('TW',options.businessDate);
 for(let i=0;i<20&&day;i++){days.push(day);day=previousMarketTradingDate('TW',day);}
 const months=[...new Set(days.map(d=>d.slice(0,7)))];if(days.length!==20||months.length>3)return [];
 const out:BenchmarkClose[]=[];let cursor=0;
 await Promise.all(Array.from({length:2},async()=>{while(cursor<months.length){const month=months[cursor++],url=V2_INDEX_URL+'?date='+month.replace('-','')+'01&response=json';
  for(let attempt=0;attempt<2;attempt++){try{
   const signal=AbortSignal.any([options.signal,AbortSignal.timeout(8000)]),response=await shadowFetch(options.fetcher,url,signal);
   if(!response.ok){discard(response);if(![429,500,502,503,504].includes(response.status))break;throw Error('TRANSIENT');}
   const payload=await boundedJson(response,signal),rows=normalizeV2IndexHistory(payload,month,options.now());options.signal.throwIfAborted();out.push(...rows.filter(r=>days.includes(r.date)));break;
  }catch(e){if(options.signal.aborted||attempt===1||e instanceof Error&&e.message.startsWith('V2_INDEX_'))break;try{await pause(1000,options.signal);}catch{break;}}}
 }}));
 return out.sort((a,b)=>a.date.localeCompare(b.date));
}
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
 const p=obj(payload),expected=V2_FUGLE_SHARES_URL+symbol;
 if(source!==expected||p.symbol!==symbol||p.unit!==undefined&&p.unit!=='SHARES'||!Array.isArray(p.data)||p.data.length>366)throw Error('V2_FUGLE_SHARES_SCHEMA_INVALID');
 const out:Shares[]=[];const seen=new Set<string>();
 for(const raw of p.data){const r=obj(raw),session=date(r.date);assertSession(session,at);
  if(r.unit!==undefined&&r.unit!=='SHARES')throw Error('V2_FUGLE_SHARES_SCHEMA_INVALID');
  if(seen.has(session!))throw Error('V2_DUPLICATE_SESSION');seen.add(session!);
  const read=(k:string)=>{const x=obj(r[k]);return group(x.buy,x.sell,x.net);};
  const foreign=read('foreign'),trust=read('trust'),dealer=read('dealer');
  if(number(r.total)!==foreign.net+trust.net+dealer.net)throw Error('V2_TOTAL_SHARES_INVALID');
  out.push({symbol,session:session!,source,available_at:at,unit:'SHARES',foreign,trust,dealer});
 }
 return out;
}
/** Abort must settle even if a transport/body ignores its AbortSignal. Late
 * resolution/rejection is observed, but can never mutate a returned capture. */
function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('V2_ACQUISITION_DEADLINE'));};
  signal.addEventListener('abort',abort,{once:true});
  work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  if(signal.aborted)abort();
 });
}
function pause(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Error('V2_ACQUISITION_DEADLINE'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
function discard(response:Response){void response.body?.cancel().catch(()=>{});}
async function shadowFetch(fetcher:typeof fetch,url:string,signal:AbortSignal,headers?:HeadersInit){
 signal.throwIfAborted();
 const work=fetcher(url,{headers,redirect:'error',signal}).then(response=>{
  if(signal.aborted){discard(response);throw Error('V2_ACQUISITION_DEADLINE');}return response;
 });
 return await abortable(work,signal);
}
async function boundedJson(response:Response,signal?:AbortSignal,limit=8_000_000){
 const reader=response.body?.getReader();if(!reader)throw Error('V2_BODY_MISSING');
 let body='',size=0;const decoder=new TextDecoder();
 try{while(true){const read=reader.read(),part=await(signal?abortable(read,signal):read);if(part.done)break;size+=part.value.length;if(size>limit)throw Error('V2_RESPONSE_LIMIT');body+=decoder.decode(part.value,{stream:true});}
  return JSON.parse(body+decoder.decode()) as unknown;
 }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Official ownership contract (60/min on entitled plans):
 * https://developer.fugle.tw/docs/data/http-api/ownership/institutional-trades/
 * https://developer.fugle.tw/docs/pricing/
 * Only the preceding completed session; empty is unavailable, never zero/TWD.
 * Single worker, <=8 starts/min, <=2 attempts/symbol, <=90s wall-clock.
 * Reserve room for V1's existing <=50/min even if provider quotas share a key.
 * Never consume/modify V1 permits; incomplete universe coverage stays explicit.
 * This is a per-invocation bound, not a distributed account-wide quota lock. */
export async function acquireV2FugleShares(options:{symbols:readonly string[];apiKey:string;fetcher:typeof fetch;now:()=>string;signal:AbortSignal;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>}){
 if(options.symbols.length>72||new Set(options.symbols).size!==options.symbols.length||options.symbols.some(s=>!/^\d{4,6}$/.test(s)))throw Error('V2_FUGLE_SCOPE_INVALID');
 const start=options.now(),session=previousMarketTradingDate('TW',receipt(start).slice(0,10));
 const symbols=options.symbols.includes('2330')?['2330',...options.symbols.filter(s=>s!=='2330')]:options.symbols;
 const captures:FugleSharesCapture[]=symbols.map(symbol=>({kind:'shares',source:V2_FUGLE_SHARES_URL+symbol,symbol,requested_session:session,
  provenance:'FUGLE_INSTITUTIONAL_SHARES',received_at:start,http:null,status:'NOT_ATTEMPTED',attempts:0,rows:[]}));
 const signal=AbortSignal.any([options.signal,AbortSignal.timeout(90000)]),sleep=options.sleep??pause,deadline=Date.parse(start)+90000;
 let nextStart=Date.parse(start),halt=!session?'V2_CALENDAR_UNAVAILABLE':!options.apiKey?'EXISTING_FUGLE_CREDENTIAL_UNAVAILABLE':'';
 for(const capture of captures){
  if(halt||signal.aborted){capture.status=halt||'BUDGET_NOT_ATTEMPTED';continue;}
  const url=capture.source+'?from='+session+'&to='+session+'&sort=asc';
  for(let attempt=0;attempt<2;attempt++){
   let retry=false;
   try{
    if(nextStart>=deadline||Date.parse(options.now())>=deadline){halt='BUDGET_NOT_ATTEMPTED';capture.status=capture.attempts?'RETRY_BUDGET_EXHAUSTED':halt;break;}
    // Cooldown is shared by all ownership requests, including the next symbol.
    let wait=nextStart-Date.parse(options.now());
    while(wait>0){await abortable(sleep(wait,signal),signal);wait=nextStart-Date.parse(options.now());}
    if(Date.parse(options.now())>=deadline){halt='BUDGET_NOT_ATTEMPTED';capture.status=capture.attempts?'RETRY_BUDGET_EXHAUSTED':halt;break;}
    signal.throwIfAborted();capture.attempts++;nextStart=Date.parse(options.now())+8000;
    // Start the per-request timeout AFTER waiting for the pace/cooldown permit.
    const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(4000)]);
    const response=await shadowFetch(options.fetcher,url,requestSignal,{'X-API-KEY':options.apiKey});
    capture.http=response.status;capture.received_at=options.now();
    if(!response.ok){
     discard(response);
     capture.status=response.status===401?'PROVIDER_AUTH_INVALID':response.status===403?'ENTITLEMENT_NON_RETRYABLE':`HTTP_${response.status}`;
     if(response.status===401||response.status===403)halt=response.status===401?'AUTH_NOT_ATTEMPTED':'ENTITLEMENT_NOT_ATTEMPTED';
     retry=[429,500,502,503,504].includes(response.status);
     if(response.status===429){
      const raw=response.headers.get('Retry-After'),seconds=raw!==null&&/^\d+(\.\d+)?$/.test(raw)?Number(raw):NaN,stamp=raw===null?NaN:Date.parse(raw);
      const delay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(stamp)?Math.max(0,stamp-Date.parse(options.now())):60000;
      nextStart=Math.max(nextStart,Date.parse(options.now())+delay);
     }
    }else{
     const payload=await boundedJson(response,requestSignal,250000),at=options.now();
     let rows:Shares[];
     try{rows=normalizeFugleShares(payload,capture.source,at,capture.symbol);}
     catch{capture.status='FUGLE_SHARES_CONTRACT_INVALID';break;}
     if(rows.some(r=>r.session!==session)){capture.status='FUGLE_SHARES_SESSION_MISMATCH';break;}
     signal.throwIfAborted();capture.received_at=at;capture.rows=rows;capture.status=rows.length?'PASS':'NO_DATA';
    }
   }catch(error){
    // Never expose thrown text, response bodies, URLs with credentials or headers.
    if(signal.aborted){capture.status=capture.attempts?'ACQUISITION_DEADLINE':'BUDGET_NOT_ATTEMPTED';break;}
    if(error instanceof SyntaxError){capture.status='PROVIDER_JSON_INVALID';break;}
    if(error instanceof Error&&['V2_RESPONSE_LIMIT','V2_BODY_MISSING'].includes(error.message)){capture.status=error.message;break;}
    capture.status='PROVIDER_TRANSPORT_OR_TIMEOUT';retry=true;
   }
   if(!retry||attempt===1)break;
   nextStart=Math.max(nextStart,Date.parse(options.now())+1200);
  }
 }
 return captures;
}
/** Fugle is canonical per symbol/session. Public data is only an explicit
 * fallback, never relabelled Fugle. Do not dedupe within a provider: conflicting
 * same-provider evidence still reaches the engine's existing fail-closed gate. */
export function selectV2InstitutionalSources(fugle:FugleSharesCapture[],publicSources:ShadowSource[],cutoff:string):ShadowSource[]{
 const available=(at:string)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(cutoff);
 const withinCutoff=(c:ShadowSource):ShadowSource=>c.status==='PASS'&&(!available(c.received_at)||c.rows.some(r=>!available(r.available_at)))?{...c,status:'NOT_AVAILABLE_AT_CUTOFF',rows:[]}:c;
 const canonical=fugle.map(withinCutoff),keys=new Set(canonical.filter(c=>c.status==='PASS').flatMap(c=>c.rows).filter((r):r is Shares=>'unit'in r).map(r=>r.symbol+':'+r.session));
 return [...canonical,...publicSources.map(withinCutoff).map(c=>{
  if(c.kind!=='shares')return c;
  const rows=c.rows.filter(r=>!('unit'in r)||!keys.has(r.symbol+':'+r.session));
  return {...c,rows,provenance:'OFFICIAL_PUBLIC_FALLBACK',superseded_by_fugle:c.rows.length-rows.length,
   status:c.status==='PASS'&&c.rows.length>0&&rows.length===0?'SUPERSEDED_BY_FUGLE':c.status};
 })];
}
/** Start beside V1, then stop and join when V1 finishes (including failure).
 * No fire-and-forget assignment: all three jobs settle to evidence or an honest
 * classification. Abort-aware fetch, body reads and sleeps make joining bounded. */
export function startV2SourceAcquisition(options:{businessDate:string;symbols:readonly string[];apiKey:string;fetcher:typeof fetch;now:()=>string;signal:AbortSignal}){
 const controller=new AbortController(),signal=AbortSignal.any([options.signal,controller.signal]);
 const publicSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]);
 const unavailable=(source:string,kind:string):ShadowSource=>({source,kind,received_at:options.now(),http:null,status:'SOURCE_UNAVAILABLE',rows:[]});
 const publicWork=acquireV2PublicSources({symbols:options.symbols,fetcher:options.fetcher,now:options.now,signal:publicSignal}).catch(()=>[
  unavailable(V2_SOURCE_URLS.twseShares,'shares'),unavailable(V2_SOURCE_URLS.tpexShares,'shares'),
  unavailable(V2_SOURCE_URLS.twseGrowth,'growth'),unavailable(V2_SOURCE_URLS.tpexGrowth,'growth')]);
 const indexWork=acquireV2IndexHistory({businessDate:options.businessDate,fetcher:options.fetcher,now:options.now,signal:publicSignal}).then(rows=>({rows,received_at:options.now(),status:rows.length?'PASS':publicSignal.aborted?'ACQUISITION_DEADLINE':'SOURCE_UNAVAILABLE'}),()=>({rows:[] as BenchmarkClose[],received_at:options.now(),status:'SOURCE_UNAVAILABLE'}));
 const fugleWork=acquireV2FugleShares({...options,signal}).catch(()=>options.symbols.map((symbol):FugleSharesCapture=>({
  ...unavailable(V2_FUGLE_SHARES_URL+symbol,'shares'),rows:[],kind:'shares',symbol,requested_session:null,attempts:0,provenance:'FUGLE_INSTITUTIONAL_SHARES'})));
 const complete=Promise.all([publicWork,indexWork,fugleWork]).then(([publicSources,index,fugle])=>({
  publicSources:[...publicSources,{source:V2_INDEX_URL,kind:'benchmark',received_at:index.received_at,http:null,status:index.status,rows:[]}],
  benchmark_history:index.rows,fugle,
 }));
 return {complete,stop:()=>controller.abort()};
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
  try{const signal=AbortSignal.any([options.signal,AbortSignal.timeout(8000)]),response=await shadowFetch(options.fetcher,task.url,signal);capture.http=response.status;
   if(!response.ok){discard(response);capture.status='HTTP_'+response.status;}
   else{const payload=await boundedJson(response,signal);options.signal.throwIfAborted();capture.received_at=options.now();capture.rows=task.normalize(payload,capture.received_at,options.symbols);capture.status=capture.rows.length?'PASS':'NO_DATA';}
  }catch(e){const message=e instanceof Error?e.message:'';capture.status=options.signal.aborted?'ACQUISITION_DEADLINE':/^V2_[A-Z_]+$/.test(message)?message:'SOURCE_UNAVAILABLE';}
  if(options.signal.aborted||!['SOURCE_UNAVAILABLE','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504'].includes(capture.status)||attempt===1)break;
  try{await pause(1000,options.signal);}catch{capture.status='ACQUISITION_DEADLINE';break;}
  }
  captures.push(capture);
 }}));
 return captures.sort((a,b)=>a.source.localeCompare(b.source));
}
