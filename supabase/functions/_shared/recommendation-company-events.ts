/** Official-source factual acquisition; no inference of event impact.
 * An announcement is an event fact, never automatically a positive catalyst.
 * Deliberately excludes raw free-text/contacts from retained metadata. */
import type { Row } from './decision-v1-data.ts';
import { validTime } from '../../../src/features/vnext/contracts.ts';
export const COMPANY_EVENT_SOURCES=Object.freeze([
 Object.freeze({exchange:'TWSE',url:'https://openapi.twse.com.tw/v1/opendata/t187ap04_L'} as const),
 Object.freeze({exchange:'TPEX',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O'} as const),
] as const);
export type CompanyEvent={symbol:string;exchange:'TWSE'|'TPEX';source_ref:string;source_hash:string;published_at:string;available_at:string;event_type:'OFFICIAL_MATERIAL_ANNOUNCEMENT';event_fact:true;bullishness:null;impact_review:'REQUIRED';raw_retained:false};
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const text=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'?String(v):'';
function alias(row:Row,primary:string,secondary:string):string{
 const a=row[primary],b=row[secondary];
 if(a!==null&&a!==undefined&&b!==null&&b!==undefined&&text(a)!==text(b))
  throw Error('COMPANY_EVENT_FIELD_CONFLICT');
 return text(a??b);
}
const sha=async(v:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
function published(date:unknown,time:unknown):string|null{
 const d=text(date).match(/^(\d{3,4})[-/]?(\d{2})[-/]?(\d{2})$/),t=text(time).match(/^(\d{2}):?(\d{2}):?(\d{2})$/);
 if(!d||!t)return null;
 const year=Number(d[1])+(d[1].length===3?1911:0),local=`${year}-${d[2]}-${d[3]}T${t[1]}:${t[2]}:${t[3]}`,at=Date.parse(local+'+08:00');
 return Number.isFinite(at)&&new Date(at+8*3600000).toISOString().slice(0,19)===local?new Date(at).toISOString():null;
}
export async function normalizeCompanyEvents(source:typeof COMPANY_EVENT_SOURCES[number],payload:unknown,receivedAt:string,symbols:readonly string[]):Promise<CompanyEvent[]>{
 const trusted=COMPANY_EVENT_SOURCES.find(s=>s.url===source?.url&&s.exchange===source?.exchange);
 if(!trusted||typeof receivedAt!=='string'||!validTime(receivedAt)||!Array.isArray(payload)||payload.length>5000)throw Error('COMPANY_EVENT_CONTRACT');
 const allowed=new Set(symbols),seen=new Set<string>(),events:CompanyEvent[]=[];
 // Capture only identifying fields before the first await. A changed caller
 // object must not retarget a verified company, source or later batch record.
 // Do not clone/retain explanations, contact details or the whole raw payload.
 const facts:{symbol:string;at:string;subject:string}[]=[];
 for(const raw of payload){
  const r=obj(raw),symbol=alias(r,'公司代號','SecuritiesCompanyCode');if(!allowed.has(symbol))continue;
  const at=published(r['發言日期'],r['發言時間']),subject=alias(r,'主旨 ','主旨');
  if(!at||Date.parse(at)>Date.parse(receivedAt)||!subject||subject.length>4000)throw Error('COMPANY_EVENT_TIME_OR_SUBJECT');
  facts.push({symbol,at,subject});
 }
 for(const {symbol,at,subject} of facts){
  // Hash only the identifying official fields. Never retain raw explanation,
  // named speaker, phone, email or member identity. Subject is not surfaced.
  const digest=await sha([trusted.url,symbol,at,subject]);if(seen.has(digest))continue;seen.add(digest);
  events.push({symbol,exchange:trusted.exchange,source_ref:trusted.url,source_hash:digest,published_at:at,available_at:receivedAt,event_type:'OFFICIAL_MATERIAL_ANNOUNCEMENT',event_fact:true,bullishness:null,impact_review:'REQUIRED',raw_retained:false});
 }
 return events.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.published_at.localeCompare(b.published_at)||a.source_hash.localeCompare(b.source_hash));
}
export async function acquireCompanyEvents(options:{symbols:readonly string[];fetcher:typeof fetch;now:()=>string;signal:AbortSignal}){
 const results=[];
 // Exactly two credential-free, fixed-source requests. No persistence/retry.
 for(const source of COMPANY_EVENT_SOURCES){
  try{
   options.signal.throwIfAborted();
   const response=await options.fetcher(source.url,{redirect:'error',signal:AbortSignal.any([options.signal,AbortSignal.timeout(12000)])});
   if(!response.ok){await response.body?.cancel();results.push({source:source.url,http:response.status,status:'SOURCE_HTTP_FAILURE',events:[]});continue;}
   const reader=response.body?.getReader();if(!reader)throw Error('BODY');let size=0,body='';const decoder=new TextDecoder();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3_000_000){await reader.cancel();throw Error('LIMIT');}body+=decoder.decode(value,{stream:true});}}
   finally{reader.releaseLock();}
   const events=await normalizeCompanyEvents(source,JSON.parse(body+decoder.decode()),options.now(),options.symbols);
   results.push({source:source.url,http:response.status,status:'PASS',events});
  }catch{results.push({source:source.url,http:null,status:'SOURCE_UNAVAILABLE_OR_INVALID',events:[]});}
 }
 return results;
}
