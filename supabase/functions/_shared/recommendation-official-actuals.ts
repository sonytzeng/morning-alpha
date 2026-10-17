/** Public exchange actuals only. These are NOT consensus, management guidance,
 * a sector-strategy mapping, or complete four-quarter Recommendation evidence.
 * Raw company profiles contain contact/PII columns: never retain raw responses. */
import type { Row } from './decision-v1-data.ts';

export const OFFICIAL_ACTUAL_SOURCES = Object.freeze([
 {exchange:'TWSE',kind:'company',url:'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'},
 {exchange:'TWSE',kind:'monthly_revenue',url:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'},
 {exchange:'TWSE',kind:'quarterly_eps',url:'https://openapi.twse.com.tw/v1/opendata/t187ap14_L'},
 {exchange:'TPEX',kind:'company',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'},
 {exchange:'TPEX',kind:'monthly_revenue',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O'},
 {exchange:'TPEX',kind:'quarterly_eps',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O'},
] as const);
// Opt-in only. The default Producer acquisition remains the original six sources.
export const OFFICIAL_FINANCIAL_HOLDING_SOURCE = Object.freeze({exchange:'TWSE',kind:'quarterly_eps',
 url:'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh'} as const);
const FINANCIAL_SOURCES = Object.freeze([OFFICIAL_ACTUAL_SOURCES[1],OFFICIAL_ACTUAL_SOURCES[2],OFFICIAL_FINANCIAL_HOLDING_SOURCE]);
type Source = typeof OFFICIAL_ACTUAL_SOURCES[number] | typeof OFFICIAL_FINANCIAL_HOLDING_SOURCE;
export type OfficialCapture = {exchange:Source['exchange'];kind:Source['kind'];source:string;received_at:string;status:string;http_status:number|null;rows:Row[];
 // Optional for compatibility with prior saved receipts. Never synthesize them on historical captures.
 first_seen_at?:string;source_response_sha256?:string;response_bytes?:number;source_row_count?:number;
 target_row_count?:number;missing_symbols?:string[];null_actual_symbols?:string[]};
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
const finite=(v:unknown):number|null=>{
 const raw=text(v),s=raw.replaceAll(',',''),number=Number(s);
 return /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(\.\d+)?$/.test(raw)&&Number.isFinite(number)&&Math.abs(number)<=Number.MAX_SAFE_INTEGER?number:null;
};
function sourceDate(v:unknown):string|null{
 const s=text(v),match=s.match(/^(\d{3}|\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);
 if(!match)return null;
 const y=Number(match[1])+(match[1].length===3?1911:0);
 const date=`${y}-${match[2]}-${match[3]}`,stamp=Date.parse(date+'T00:00:00Z');
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===date?date:null;
}
export function normalizeOfficialActuals(source:Source,payload:unknown,receivedAt:string,symbols:readonly string[]):Row[]{
 const receipt=Date.parse(receivedAt);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(receivedAt)||
  !Number.isFinite(receipt)||!Array.isArray(payload)||payload.length>3000||
  payload.some(r=>r===null||typeof r!=='object'||Array.isArray(r)))throw Error('OFFICIAL_RESPONSE_CONTRACT_INVALID');
 const today=new Date(receipt+8*3600000).toISOString().slice(0,10),allowed=new Set(symbols),seen=new Set<string>(),rows:Row[]=[];
 for(const raw of payload){
  const r=obj(raw),symbol=text(r['公司代號']??r.SecuritiesCompanyCode);
  if(!allowed.has(symbol))continue;
  if(seen.has(symbol))throw Error('OFFICIAL_DUPLICATE_SYMBOL');seen.add(symbol);
  const date=sourceDate(r['出表日期']??r.Date);
  if(!date||date>today)throw Error('OFFICIAL_SOURCE_DATE_INVALID');
  const company=text(r['公司名稱']??r.CompanyName);
  if(!company||company.length>160)throw Error('OFFICIAL_COMPANY_IDENTITY_INVALID');
  const common:Row={symbol,exchange:source.exchange,company_name:company,source:source.url,source_date:date,
   source_timestamp:null,source_time_precision:'DATE_ONLY',observed_at:receivedAt,available_at:receivedAt,
   first_seen_at:receivedAt,original_publication_time:null,source_vintage:null,
   availability_basis:'FIRST_OBSERVED_THIS_CAPTURE_NOT_ORIGINAL_PUBLICATION',
   evidence_type:'OFFICIAL_ACTUAL_ONLY',consensus:null,guidance:null,recommendation_contract_complete:false};
  if(source.kind==='company'){
   // Exchange industry labels are not silently substituted for the product's
   // existing canonical strategy-sector taxonomy.
   rows.push({...common,industry_as_reported:text(r['產業別']??r.SecuritiesIndustryCode)||null});
  }else if(source.kind==='monthly_revenue'){
   const period=text(r['資料年月']),match=period.match(/^(\d{3}|\d{4})(\d{2})$/);
   const year=match?Number(match[1])+(match[1].length===3?1911:0):0,month=match?Number(match[2]):0;
   if(!match||month<1||month>12||`${year}-${match[2]}`>=date.slice(0,7))throw Error('OFFICIAL_PERIOD_INVALID');
   rows.push({...common,period:`${year}-${match[2]}`,revenue_actual_as_reported:finite(r['營業收入-當月營收']),
    period_basis:'SINGLE_MONTH_AS_REPORTED',reported_fields_as_reported:{
     '營業收入-當月營收':finite(r['營業收入-當月營收']),'累計營業收入-當月累計營收':finite(r['累計營業收入-當月累計營收'])},
    amount_unit:'SOURCE_REPORTED_NOT_CONVERTED',contract_twd_amount:null});
  }else{
   const rawYear=text(r['年度']??r.Year),year=Number(rawYear)+(rawYear.length===3?1911:0),quarter=finite(r['季別']);
   if(!/^\d{3,4}$/.test(rawYear)||quarter===null||![1,2,3,4].includes(quarter)||
    Date.UTC(year,quarter*3,0,15,59,59)>=receipt)throw Error('OFFICIAL_PERIOD_INVALID');
   const financial=source.url===OFFICIAL_FINANCIAL_HOLDING_SOURCE.url;
   // Exact field alias only, not arithmetic. Financial 淨收益/利息 fields are
   // deliberately NOT substituted for generic 營業收入 or standalone quarters.
   const epsKey=financial?'基本每股盈餘（元）':'基本每股盈餘(元)';
   const eps=finite(financial?r[epsKey]:r[epsKey]??r['基本每股盈餘']);
   const fields=financial?['基本每股盈餘（元）','利息淨收益','利息以外淨收益','淨收益','本期稅後淨利（淨損）']:
    ['基本每股盈餘(元)','營業收入','稅後淨利'];
   const reported:Row={};for(const field of fields)reported[field]=field===epsKey?eps:finite(r[field]);
   rows.push({...common,period:`${year}-Q${quarter}`,eps_actual_as_reported:eps,
    revenue_actual_as_reported:financial?null:finite(r['營業收入']),reported_fields_as_reported:reported,
    period_basis:'UNPROVEN_SINGLE_QUARTER_VS_YTD',standalone_quarter_eps:null,standalone_quarter_revenue:null,
    amount_unit:'SOURCE_REPORTED_NOT_CONVERTED',contract_twd_amount:null});
  }
 }
 return rows;
}
function within<T>(work:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('OFFICIAL_DEADLINE'));};
  // Take ownership even when a transport synchronously aborts the signal before
  // returning its Promise. Otherwise pending may reject after the early return.
  Promise.resolve(work).then(value=>{signal.removeEventListener('abort',abort);
   if(signal.aborted)reject(Error('OFFICIAL_DEADLINE'));else resolve(value);
  },()=>{signal.removeEventListener('abort',abort);reject(Error('OFFICIAL_TRANSPORT_FAILURE'));});
  if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});
 });
}
async function boundedJson(response:Response,signal:AbortSignal,limit:number):Promise<{payload:unknown;bytes:number;sha256:string}>{
 const reader=response.body?.getReader();if(!reader)throw Error('OFFICIAL_RESPONSE_CONTRACT_INVALID');
 let bytes=0,reads=0;const chunks:Uint8Array[]=[];
 try{while(true){const part=await within(reader.read(),signal);if(part.done)break;
   if(++reads>4096||bytes+part.value.byteLength>limit)throw Error('OFFICIAL_RESPONSE_LIMIT');
   bytes+=part.value.byteLength;chunks.push(part.value.slice());}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  let decoded:string;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{throw Error('OFFICIAL_RESPONSE_CONTRACT_INVALID');}
  const payload:unknown=JSON.parse(decoded);
  const hash=await within(crypto.subtle.digest('SHA-256',body),signal);
  return {payload,bytes,sha256:Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')};
 }finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* Never await a noncooperative stream past deadline. */}}
}
export async function acquireOfficialActuals(options:{symbols:readonly string[];fetcher:typeof fetch;now:()=>string;signal:AbortSignal;
 profile?:'default'|'financial_candidate'}):Promise<OfficialCapture[]>{
 if(options.profile!==undefined&&options.profile!=='default'&&options.profile!=='financial_candidate')throw Error('OFFICIAL_PROFILE_INVALID');
 const financial=options.profile==='financial_candidate',sources=financial?FINANCIAL_SOURCES:OFFICIAL_ACTUAL_SOURCES;
 const batch=financial?AbortSignal.any([options.signal,AbortSignal.timeout(15_000)]):options.signal;
 let cursor=0;const result:OfficialCapture[]=[];
 // Default: original six public reads, two concurrent. Financial candidate:
 // three fixed sequential GETs, 4s/source and 15s/batch, no retry or persistence.
 await Promise.all(Array.from({length:financial?1:2},async()=>{while(cursor<sources.length){
  const source=sources[cursor++],capture:OfficialCapture={exchange:source.exchange,kind:source.kind,source:source.url,received_at:options.now(),status:'NOT_ATTEMPTED',http_status:null,rows:[]};
  result.push(capture);
  if(batch.aborted){capture.status='OFFICIAL_DEADLINE';continue;}
  const signal=AbortSignal.any([batch,AbortSignal.timeout(4000)]);
  try{
   const init:RequestInit=financial?{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal}:{redirect:'error',signal};
   const pending=Promise.resolve(options.fetcher(source.url,init)).then(response=>{
    if(signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('OFFICIAL_DEADLINE');}return response;});
   const response=await within(pending,signal);capture.http_status=response.status;
   if(!response.ok||financial&&(response.status!==200||response.redirected||response.url&&response.url!==source.url)){
    void response.body?.cancel().catch(()=>{});capture.status=`OFFICIAL_HTTP_${response.status}`;continue;}
   if(financial&&!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')){
    void response.body?.cancel().catch(()=>{});throw Error('OFFICIAL_RESPONSE_CONTRACT_INVALID');}
   const {payload,bytes,sha256}=await boundedJson(response,signal,financial?1_500_000:3_000_000);capture.received_at=options.now();
   capture.rows=normalizeOfficialActuals(source,payload,capture.received_at,options.symbols);
   capture.first_seen_at=capture.received_at;capture.source_response_sha256=sha256;capture.response_bytes=bytes;
   capture.source_row_count=(payload as unknown[]).length;capture.target_row_count=capture.rows.length;
   capture.missing_symbols=[...new Set(options.symbols)].filter(s=>!capture.rows.some(r=>r.symbol===s));
   const field=source.kind==='monthly_revenue'?'revenue_actual_as_reported':source.kind==='quarterly_eps'?'eps_actual_as_reported':null;
   capture.null_actual_symbols=field?capture.rows.filter(r=>r[field]===null).map(r=>String(r.symbol)):[];
   capture.status='PASS';
  }catch(e){
   const message=e instanceof Error?e.message:'';
   capture.status=signal.aborted?'OFFICIAL_DEADLINE':['OFFICIAL_RESPONSE_CONTRACT_INVALID','OFFICIAL_DUPLICATE_SYMBOL','OFFICIAL_SOURCE_DATE_INVALID','OFFICIAL_COMPANY_IDENTITY_INVALID','OFFICIAL_PERIOD_INVALID','OFFICIAL_RESPONSE_LIMIT'].includes(message)?message:e instanceof SyntaxError?'OFFICIAL_JSON_INVALID':'OFFICIAL_TRANSPORT_FAILURE';
   capture.rows=[];
  }
 }}));
 return result.sort((a,b)=>a.source.localeCompare(b.source));
}
export function officialActualCoverage(captures:OfficialCapture[],symbols:readonly string[]){
 const allowed=new Set(symbols);
 const conflicts=symbols.filter(symbol=>new Set(captures.filter(c=>c.kind==='company'&&c.status==='PASS'&&c.rows.some(r=>r.symbol===symbol)).map(c=>c.exchange)).size>1);
 const usable=(kind:Source['kind'],field?:string)=>new Set(captures.filter(c=>c.kind===kind&&c.status==='PASS').flatMap(c=>c.rows).filter(r=>allowed.has(String(r.symbol))&&!conflicts.includes(String(r.symbol))&&(!field||typeof r[field]==='number'&&Number.isFinite(r[field]))).map(r=>String(r.symbol)));
 return {universe:symbols.length,company:usable('company').size,monthly_revenue_actual:usable('monthly_revenue','revenue_actual_as_reported').size,
  quarterly_eps_actual:usable('quarterly_eps','eps_actual_as_reported').size,conflicting_symbols:conflicts,
  consensus:0,guidance:0,complete_four_quarter_recommendation_evidence:0};
}
