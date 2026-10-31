import {canonical} from './entry-opportunity.ts';
import {validObservationTime} from '../src/features/vnext/contracts.ts';
import type {AnalysisEvidence} from './daily-ai-analysis.ts';

export const DAILY_AI_OFFICIAL_NEWS_URLS={
 TWSE:'https://openapi.twse.com.tw/v1/opendata/t187ap04_L',
 TPEX:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O',
 FED:'https://www.federalreserve.gov/feeds/press_all.xml',
} as const;
export const DAILY_AI_OFFICIAL_NEWS_DOCUMENTS={
 TWSE:{dataset:'https://data.gov.tw/dataset/18415',license:'https://data.gov.tw/license'},
 TPEX:{dataset:'https://data.gov.tw/dataset/18418',license:'https://data.gov.tw/license'},
 FED:{policy:'https://www.federalreserve.gov/disclaimer.htm'},
} as const;
type Source=typeof DAILY_AI_OFFICIAL_NEWS_URLS[keyof typeof DAILY_AI_OFFICIAL_NEWS_URLS];
type Row=Record<string,unknown>;
export type DailyAiOfficialNewsResponse={source:Source;state:'CAPTURED'|'UNAVAILABLE';received_at:string|null;
 source_sha256:string|null;source_bytes:number|null;response_text:string|null;error:string|null};
export type DailyAiOfficialNewsProof={schema:'DAILY_AI_OFFICIAL_NEWS_PROOF_V1';business_date:string;observed_at:string;window_start:string;
 responses:DailyAiOfficialNewsResponse[];additions:{evidence:AnalysisEvidence;row_text:string}[]};
export type DailyAiOfficialNewsResult={complete:boolean;news:AnalysisEvidence[];additionalGaps:string[];
 receipts:Omit<DailyAiOfficialNewsResponse,'response_text'>[];proof:DailyAiOfficialNewsProof};
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('AI_OFFICIAL_NEWS_ABORTED');};
const taipeiDay=(s:string)=>new Date(Date.parse(s)+8*3600000).toISOString().slice(0,10);
const validDay=(s:string)=>/^\d{4}-\d\d-\d\d$/.test(s)&&validObservationTime(s+'T00:00:00Z');
function rocDate(raw:unknown){
 if(typeof raw!=='string'||!/^\d{7}$/.test(raw)||Number(raw.slice(0,3))<80||Number(raw.slice(0,3))>300)throw Error('AI_OFFICIAL_NEWS_ROW');
 const value=String(Number(raw.slice(0,3))+1911)+'-'+raw.slice(3,5)+'-'+raw.slice(5,7);
 if(!validDay(value))throw Error('AI_OFFICIAL_NEWS_ROW');return value;
}
function spokenTime(raw:unknown){
 if(typeof raw!=='string'||!/^\d{5,6}$/.test(raw))throw Error('AI_OFFICIAL_NEWS_ROW');
 const value=raw.padStart(6,'0'),hour=Number(value.slice(0,2)),minute=Number(value.slice(2,4)),second=Number(value.slice(4,6));
 if(hour>23||minute>59||second>59)throw Error('AI_OFFICIAL_NEWS_ROW');
 return value.slice(0,2)+':'+value.slice(2,4)+':'+value.slice(4,6);
}
const requiredText=(value:unknown,max:number)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('AI_OFFICIAL_NEWS_ROW');return value.trim();};
const failed=(source:Source,error:string):DailyAiOfficialNewsResponse=>({source,state:'UNAVAILABLE',received_at:null,source_sha256:null,source_bytes:null,response_text:null,error});
function xmlValue(inner:string){
 const cdata=inner.trim().match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);let value=cdata?cdata[1]:inner.trim();
 if(/<|>/.test(value))throw Error('AI_OFFICIAL_NEWS_XML');
 if(cdata)return requiredText(value,12000);
 if(/&(?!(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(value))throw Error('AI_OFFICIAL_NEWS_XML');
 value=value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_match,key:string)=>{
  if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
   if(!Number.isInteger(n)||n<32||n>0x10ffff||n>=0xd800&&n<=0xdfff)throw Error('AI_OFFICIAL_NEWS_XML');return String.fromCodePoint(n);}
  return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"} as Record<string,string>)[key.toLowerCase()];
 });
 return requiredText(value,12000);
}
/** Four source fields only. No external entity, HTML or XML document execution. */
function fedRows(text:string):Row[]{
 if(/<!DOCTYPE|<!ENTITY/i.test(text)||!/<rss\b[^>]*version=["']2\.0["']/.test(text)||!/<channel>/.test(text))throw Error('AI_OFFICIAL_NEWS_XML');
 const items=[...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];
 if(items.length>500||items.length!==(text.match(/<item>/g)??[]).length)throw Error('AI_OFFICIAL_NEWS_XML');
 return items.map(item=>{const row:Row={};for(const key of ['title','link','description','pubDate']){
  const values=[...item[1].matchAll(new RegExp('<'+key+'>([\\s\\S]*?)<\\/'+key+'>','g'))];
  if(values.length!==1)throw Error('AI_OFFICIAL_NEWS_XML');row[key]=xmlValue(values[0][1]);
 }return row;});
}
function fedPublication(raw:unknown){
 if(typeof raw!=='string'||! /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d\d (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d\d:\d\d:\d\d GMT$/.test(raw))throw Error('AI_OFFICIAL_NEWS_ROW');
 const milliseconds=Date.parse(raw);if(!Number.isFinite(milliseconds))throw Error('AI_OFFICIAL_NEWS_ROW');
 const value=new Date(milliseconds).toISOString();if(!validObservationTime(value))throw Error('AI_OFFICIAL_NEWS_ROW');
 // Date.parse silently normalizes invalid calendar dates; the weekday/date
 // round-trip keeps malformed source clocks out of immutable captures.
 if(new Date(milliseconds).toUTCString()!==raw)throw Error('AI_OFFICIAL_NEWS_ROW');return value;
}
async function capture(source:Source,input:{fetcher:typeof fetch;signal:AbortSignal;clock:()=>string;businessDate:string},began:string){
 const controller=new AbortController(),signal=AbortSignal.any([controller.signal,input.signal]);let timer:ReturnType<typeof setTimeout>|undefined;
 const work=(async()=>{
  const response=await input.fetcher(source,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:source===DAILY_AI_OFFICIAL_NEWS_URLS.FED?'application/rss+xml, application/xml, text/xml':'application/json'},signal});
  if(!response.ok||Number(response.headers.get('content-length'))>2000000)throw Error('AI_OFFICIAL_NEWS_HTTP_OR_SIZE');
  const reader=response.body?.getReader();if(!reader)throw Error('AI_OFFICIAL_NEWS_BODY');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){stopped(signal);const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2000000)throw Error('AI_OFFICIAL_NEWS_SIZE');chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);stopped(signal);const received_at=input.clock();
  if(!validObservationTime(received_at)||Date.parse(received_at)<Date.parse(began)||taipeiDay(received_at)!==input.businessDate)throw Error('AI_OFFICIAL_NEWS_CLOCK');
  let rows:Row[];
  if(source===DAILY_AI_OFFICIAL_NEWS_URLS.FED)rows=fedRows(text);
  else {const parsed:unknown=JSON.parse(text);if(!Array.isArray(parsed)||parsed.length>5000||parsed.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('AI_OFFICIAL_NEWS_SCHEMA');rows=parsed;}
  return {receipt:{source,state:'CAPTURED' as const,received_at,source_sha256:await digest(text),source_bytes:size,response_text:text,error:null},rows};
 })();
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('AI_OFFICIAL_NEWS_TIMEOUT'));},6000);})]);}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
/** Public official data captures only. Source documentation is exported for
 * actual use review; this collector does not create licenses, reviews or grants.
 * Returned private proof must be verified/imported before SOURCE can freeze it. */
export async function collectDailyAiOfficialNews(input:{inputs:{symbol:string}[];businessDate:string;fetcher:typeof fetch;clock:()=>string;signal:AbortSignal}):Promise<DailyAiOfficialNewsResult>{
 stopped(input.signal);const began=input.clock();
 if(!validObservationTime(began)||!validDay(input.businessDate)||taipeiDay(began)!==input.businessDate||input.inputs.length!==72
  ||new Set(input.inputs.map(s=>s.symbol)).size!==72||input.inputs.some(s=>!/^\d{4,6}$/.test(s.symbol)))throw Error('AI_OFFICIAL_NEWS_SCOPE');
 const window_start=new Date(Date.parse(began)-48*3600000).toISOString(),universe=new Set(input.inputs.map(s=>s.symbol));
 const sources=Object.values(DAILY_AI_OFFICIAL_NEWS_URLS),responses:DailyAiOfficialNewsResponse[]=new Array(3),tables=new Map<Source,Row[]>();let cursor=0;
 const worker=async()=>{for(;;){const i=cursor++;if(i>=sources.length)return;stopped(input.signal);const source=sources[i];
  try{const result=await capture(source,input,began);responses[i]=result.receipt;tables.set(source,result.rows);}
  catch(error){if(input.signal.aborted)throw Error('AI_OFFICIAL_NEWS_ABORTED');if(error instanceof Error&&error.message==='AI_OFFICIAL_NEWS_CLOCK')throw error;
   responses[i]=failed(source,error instanceof Error&&/^AI_OFFICIAL_NEWS_[A-Z_]+$/.test(error.message)?error.message:'AI_OFFICIAL_NEWS_UNAVAILABLE');}
 }};await Promise.all([worker(),worker()]);stopped(input.signal);
 const additions:DailyAiOfficialNewsProof['additions']=[],gaps=['OFFICIAL_NEWS_FIXED_FEEDS_NOT_ALL_COMPANY_OR_MARKET_NEWS',
  'MOPS_PUBLICATION_TIMEZONE_UNDECLARED_RECEIPT_BASIS_ONLY','OFFICIAL_NEWS_EXCERPT_NOT_FULL_DISCLOSURE','FED_RSS_NOT_EQUITY_CLOSE_OR_COMPLETE_MACRO_COVERAGE'];
 let excludedOld=0,excludedInvalid=0,fedRecent=0,excerptTruncated=false;
 for(const response of responses){if(response.state!=='CAPTURED')continue;
  for(const row of tables.get(response.source)??[]){
   try{let symbol:string|null,source:string,published_at:string|null,provider:string,title:string,excerpt:string,metadata:Row;
    if(response.source===DAILY_AI_OFFICIAL_NEWS_URLS.FED){
     published_at=fedPublication(row.pubDate);if(Date.parse(published_at)<Date.parse(window_start)){excludedOld++;continue;}
     if(Date.parse(published_at)>Date.parse(response.received_at!)){excludedInvalid++;continue;}
     source=requiredText(row.link,500);if(!/^https:\/\/www\.federalreserve\.gov\/newsevents\/pressreleases\/[a-z0-9]+\.htm$/.test(source))throw Error('AI_OFFICIAL_NEWS_ROW');
     symbol=null;provider='FEDERAL_RESERVE_RSS';title=requiredText(row.title,1500);excerpt=requiredText(row.description,12000);
     metadata={rss_pub_date_raw:row.pubDate,window_basis:'EXPLICIT_RSS_GMT_PUBLICATION_TIME'};fedRecent++;
    }else{
     const twse=response.source===DAILY_AI_OFFICIAL_NEWS_URLS.TWSE;symbol=requiredText(row[twse?'公司代號':'SecuritiesCompanyCode'],6);
     if(!universe.has(symbol))continue;
     const date=rocDate(row['發言日期']),time=spokenTime(row['發言時間']),exportDate=rocDate(row[twse?'出表日期':'Date']);
     if(date<taipeiDay(window_start)){excludedOld++;continue;}
     if(date>input.businessDate||exportDate>input.businessDate||exportDate<date)throw Error('AI_OFFICIAL_NEWS_ROW');
     source=response.source;published_at=null;provider=twse?'TWSE_MOPS_OPEN_DATA':'TPEX_MOPS_OPEN_DATA';
     title=requiredText(row[twse?'主旨 ':'主旨'],1500);excerpt=requiredText(row['說明'],100000);
     metadata={company_code:symbol,company_name:requiredText(row[twse?'公司名稱':'CompanyName'],200),source_export_date_raw:row[twse?'出表日期':'Date'],
      spoken_date_raw:row['發言日期'],spoken_time_raw:row['發言時間'],spoken_date_coordinate:date,spoken_time_coordinate:time,
      fact_event_date_raw:typeof row['事實發生日']==='string'?row['事實發生日']:'',publication_timezone:'NOT_DECLARED_BY_SOURCE',
      window_basis:'SOURCE_DECLARED_DAY_COORDINATE_NOT_EXACT_PUBLICATION_TIME'};
    }
    const row_text=canonical(row),rowHash=await digest(row_text),characters=Array.from(excerpt),truncated=characters.length>2000;excerptTruncated ||=truncated;
    const content=canonical({schema:'DAILY_AI_OFFICIAL_NEWS_FACT_V1',provider,coverage:published_at===null?'OFFICIAL_ANNOUNCEMENT_EXCERPT':'OFFICIAL_RSS_TITLE_AND_DESCRIPTION',
     title,excerpt:characters.slice(0,2000).join(''),excerpt_truncated:truncated,source_response_sha256:response.source_sha256,source_response_bytes:response.source_bytes,
     source_received_at:response.received_at,source_metadata:metadata});
    if(content.length>12000)throw Error('AI_OFFICIAL_NEWS_ROW');
    const evidence:AnalysisEvidence={id:'official-news:'+provider+':'+rowHash,symbol,kind:'NEWS',source,published_at,
     available_at:response.received_at!,first_seen_at:response.received_at!,as_of:response.received_at!,
     time_basis:published_at===null?'OBSERVED_AFTER_RECEIPT':'PUBLISHED',content,evidence_hash:await digest(content)};
    if(!additions.some(a=>a.evidence.id===evidence.id))additions.push({evidence,row_text});
   }catch{excludedInvalid++;}
  }
 }
 additions.sort((a,b)=>Date.parse(b.evidence.published_at??b.evidence.available_at)-Date.parse(a.evidence.published_at??a.evidence.available_at)||a.evidence.id.localeCompare(b.evidence.id));
 if(additions.length>200){additions.length=200;gaps.push('OFFICIAL_NEWS_CAPTURE_LIMIT_200_OLDER_ITEMS_OMITTED');}
 if(excludedOld)gaps.push('OFFICIAL_NEWS_OLDER_SOURCE_ITEMS_OUTSIDE_DECLARED_WINDOW_OMITTED');
 if(excludedInvalid)gaps.push('OFFICIAL_NEWS_INVALID_OR_FUTURE_SOURCE_ITEMS_EXCLUDED');
 if(excerptTruncated)gaps.push('OFFICIAL_NEWS_LONG_DISCLOSURES_EXCERPT_TRUNCATED');
 if(!fedRecent)gaps.push('FED_RSS_NO_RELEASE_WITHIN_EXACT_48H_WINDOW');
 if(responses.some(r=>r.state==='UNAVAILABLE'))gaps.push('OFFICIAL_NEWS_PARTIAL_ACQUISITION');
 if(!additions.length)gaps.push('OFFICIAL_NEWS_NO_MATCHING_OBSERVATIONS_NOT_NO_RISK');
 const observed_at=input.clock();stopped(input.signal);
 if(!validObservationTime(observed_at)||Date.parse(observed_at)<Date.parse(began)||taipeiDay(observed_at)!==input.businessDate
  ||responses.some(r=>r.received_at&&Date.parse(r.received_at)>Date.parse(observed_at)))throw Error('AI_OFFICIAL_NEWS_CLOCK');
 return {complete:responses.every(r=>r.state==='CAPTURED'),news:additions.map(a=>a.evidence),additionalGaps:gaps,
  receipts:responses.map(({response_text,...r})=>{void response_text;return r;}),
  proof:{schema:'DAILY_AI_OFFICIAL_NEWS_PROOF_V1',business_date:input.businessDate,observed_at,window_start,responses,additions}};
}
