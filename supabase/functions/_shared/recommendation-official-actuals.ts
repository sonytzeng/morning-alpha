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
type Source = typeof OFFICIAL_ACTUAL_SOURCES[number];
export type OfficialCapture = {exchange:Source['exchange'];kind:Source['kind'];source:string;received_at:string;status:string;http_status:number|null;rows:Row[]};
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
const finite=(v:unknown):number|null=>{
 const s=text(v).replaceAll(',','');
 return /^-?\d+(\.\d+)?$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;
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
 if(!Number.isFinite(receipt)||!Array.isArray(payload)||payload.length>3000)throw Error('OFFICIAL_RESPONSE_CONTRACT_INVALID');
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
    amount_unit:'SOURCE_REPORTED_NOT_CONVERTED',contract_twd_amount:null});
  }else{
   const rawYear=text(r['年度']??r.Year),year=Number(rawYear)+(rawYear.length===3?1911:0),quarter=finite(r['季別']);
   if(!/^\d{3,4}$/.test(rawYear)||quarter===null||![1,2,3,4].includes(quarter)||
    Date.UTC(year,quarter*3,0,15,59,59)>=receipt)throw Error('OFFICIAL_PERIOD_INVALID');
   rows.push({...common,period:`${year}-Q${quarter}`,eps_actual_as_reported:finite(r['基本每股盈餘(元)']??r['基本每股盈餘']),
    revenue_actual_as_reported:finite(r['營業收入']),amount_unit:'SOURCE_REPORTED_NOT_CONVERTED',contract_twd_amount:null});
  }
 }
 return rows;
}
async function boundedJson(response:Response):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw Error('OFFICIAL_RESPONSE_CONTRACT_INVALID');
 const decoder=new TextDecoder();let bytes=0,body='';
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
  if(bytes>3_000_000){await reader.cancel();throw Error('OFFICIAL_RESPONSE_LIMIT');}body+=decoder.decode(part.value,{stream:true});}
  return JSON.parse(body+decoder.decode());
 }finally{reader.releaseLock();}
}
export async function acquireOfficialActuals(options:{symbols:readonly string[];fetcher:typeof fetch;now:()=>string;signal:AbortSignal}):Promise<OfficialCapture[]>{
 let cursor=0;const result:OfficialCapture[]=[];
 // Six credential-free public reads; at most two concurrent, no unbounded retry.
 await Promise.all(Array.from({length:2},async()=>{while(cursor<OFFICIAL_ACTUAL_SOURCES.length){
  const source=OFFICIAL_ACTUAL_SOURCES[cursor++],capture:OfficialCapture={exchange:source.exchange,kind:source.kind,source:source.url,received_at:options.now(),status:'NOT_ATTEMPTED',http_status:null,rows:[]};
  result.push(capture);
  if(options.signal.aborted){capture.status='OFFICIAL_DEADLINE';continue;}
  try{
   const response=await options.fetcher(source.url,{redirect:'error',signal:AbortSignal.any([options.signal,AbortSignal.timeout(4000)])});
   capture.http_status=response.status;if(!response.ok){capture.status=`OFFICIAL_HTTP_${response.status}`;continue;}
   const payload=await boundedJson(response);capture.received_at=options.now();
   capture.rows=normalizeOfficialActuals(source,payload,capture.received_at,options.symbols);capture.status='PASS';
  }catch(e){
   const message=e instanceof Error?e.message:'';
   capture.status=options.signal.aborted?'OFFICIAL_DEADLINE':['OFFICIAL_RESPONSE_CONTRACT_INVALID','OFFICIAL_DUPLICATE_SYMBOL','OFFICIAL_SOURCE_DATE_INVALID','OFFICIAL_COMPANY_IDENTITY_INVALID','OFFICIAL_PERIOD_INVALID','OFFICIAL_RESPONSE_LIMIT'].includes(message)?message:e instanceof SyntaxError?'OFFICIAL_JSON_INVALID':'OFFICIAL_TRANSPORT_FAILURE';
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
