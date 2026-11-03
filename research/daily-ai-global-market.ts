import type {AnalysisEvidence} from './daily-ai-analysis.ts';
import {validObservationTime} from '../src/features/vnext/contracts.ts';
import {latestCompletedUsCashSession} from '../supabase/functions/_shared/us-cash-session-calendar.ts';
import {coveredCalendarDate,isMarketTradingDate,MARKET_CALENDAR_VERSION} from '../supabase/functions/_shared/market-session-contract.mjs';

// TAIFEX schema and attribution rules checked 2026-10-31 against primary sources:
// https://openapi.taifex.com.tw/swagger.json (DailyMarketReportFut)
// https://www.taifex.com.tw/cht/4/aHIntroduction
// https://www.taifex.com.tw/cht/3/futDailyMarketReport?commodityId=TX
// A Friday night has a Monday trading-volume attribution date. Neither date is
// a publication timestamp or the research business date.
export const DAILY_AI_GLOBAL_MARKET_URLS={
 TX:'https://openapi.taifex.com.tw/v1/DailyMarketReportFut',
} as const;
type Instrument='TREASURY'|'TX';
export type DailyAiGlobalMarketReceipt={source:string;instrument:Instrument;state:'CAPTURED'|'UNAVAILABLE';
 received_at:string|null;hash:string|null;bytes:number|null;error?:string};
type ObjectValue=Record<string,unknown>;
const object=(v:unknown):ObjectValue=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('AI_GLOBAL_MARKET_SCHEMA');return v as ObjectValue;};
const date=(v:string)=>/^\d{4}-\d\d-\d\d$/.test(v)&&validObservationTime(v+'T00:00:00Z');
const taipeiDay=(v:string)=>new Date(Date.parse(v)+8*3600000).toISOString().slice(0,10);
const addDay=(d:string,n:number)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const nyDay=(ms:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const numeric=(v:unknown)=>typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())?finite(Number(v)):finite(v);
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('');
const stopped=(s:AbortSignal)=>{if(s.aborted)throw Error('AI_GLOBAL_MARKET_ABORTED');};

async function readJson(url:string,fetcher:typeof fetch,signal:AbortSignal,format:'JSON'|'HTML'|'XML'='JSON',timeoutMs=6000){
 const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let timer:ReturnType<typeof setTimeout>|undefined;
 const work=(async()=>{
  const response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:format==='HTML'?'text/html':format==='XML'?'application/xml,text/xml':'application/json'},signal:combined});
  if(!response.ok||Number(response.headers.get('content-length'))>2000000)throw Error('AI_GLOBAL_MARKET_HTTP_OR_SIZE');
  const reader=response.body?.getReader();if(!reader)throw Error('AI_GLOBAL_MARKET_BODY');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){stopped(combined);const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>2000000)throw Error('AI_GLOBAL_MARKET_SIZE');chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  stopped(combined);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return {value:format==='JSON'?JSON.parse(text):text,bytes:size,hash:await digest(bytes)};
 })();
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(Error('AI_GLOBAL_MARKET_TIMEOUT'));},timeoutMs);
 })]);}finally{if(timer)clearTimeout(timer);controller.abort();}
}
/** Official monthly XML API; the series metadata identifies CC0 1.0:
 * https://home.treasury.gov/treasury-daily-interest-rate-xml-feed
 * https://catalog.data.gov/dataset/interest-rate-statistics-daily-treasury-yield-curve-rates
 * The cash calendar selects a request month around Taipei/US month boundaries;
 * actual Treasury observation dates always come from XML, not the NYSE calendar. */
export function dailyAiTreasuryYieldUrl(businessDate:string,observedAt=businessDate+'T23:59:59+08:00'){
 if(!date(businessDate)||!validObservationTime(observedAt))throw Error('AI_GLOBAL_MARKET_SCOPE');
 const requestDate=latestCompletedUsCashSession(Date.parse(observedAt))??nyDay(Date.parse(observedAt));
 return 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month='
  +requestDate.slice(0,7).replace('-','');
}
function treasuryFacts(value:unknown,source:string,received_at:string){
 if(typeof value!=='string'||/<!DOCTYPE|<!ENTITY/i.test(value))throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
 const root=value.match(/<feed\b([^>]*)>/)?.[1]??'';
 for(const [prefix,uri] of [['','http://www.w3.org/2005/Atom'],[':d','http://schemas.microsoft.com/ado/2007/08/dataservices'],[':m','http://schemas.microsoft.com/ado/2007/08/dataservices/metadata']]){
  if(!new RegExp('xmlns'+prefix+'=["\']'+uri.replaceAll('.','[.]')+'["\']').test(root))throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
 }
 if(!/<title\b[^>]*>DailyTreasuryYieldCurveRateData<\/title>/.test(value))throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
 const requestMonth=new URL(source).searchParams.get('field_tdr_date_value_month'),today=nyDay(Date.parse(received_at));
 const entries=Array.from(value.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g));
 if(!entries.length||entries.length>64||entries.length!==(value.match(/<entry\b/g)??[]).length)throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
 const rows:{date:string;coordinate:string;rates:(number|null)[]}[]=[];
 for(const entry of entries){
  const properties=Array.from(entry[1].matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g));if(properties.length!==1)throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
  const p=properties[0][1],dates=Array.from(p.matchAll(/<d:NEW_DATE\b([^>]*)>([^<]*)<\/d:NEW_DATE>/g));
  if(dates.length!==1||!/(?:^|\s)m:type=["']Edm[.]DateTime["']/.test(dates[0][1]))throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
  const coordinate=dates[0][2].trim(),d=coordinate.slice(0,10);
  if(!/^\d{4}-\d\d-\d\dT00:00:00$/.test(coordinate)||!date(d)||d.slice(0,7).replace('-','')!==requestMonth||d>today
   ||[0,6].includes(new Date(d+'T12:00:00Z').getUTCDay())||rows.some(r=>r.date===d))throw Error('AI_GLOBAL_MARKET_TREASURY_DATE');
  const rates=['BC_2YEAR','BC_10YEAR','BC_30YEAR'].map(field=>{
   const matches=Array.from(p.matchAll(new RegExp('<d:'+field+'\\b([^>]*)>([^<]*)</d:'+field+'>','g')));
   if(matches.length>1)throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
   if(!matches.length||/(?:^|\s)m:null=["']true["']/.test(matches[0][1]))return null;
   if(!/(?:^|\s)m:type=["']Edm[.]Double["']/.test(matches[0][1]))throw Error('AI_GLOBAL_MARKET_TREASURY_XML');
   const n=numeric(matches[0][2].trim());if(n===null||Math.abs(n)>100)throw Error('AI_GLOBAL_MARKET_TREASURY_RATE');return n;
  });
  rows.push({date:d,coordinate,rates});
 }
 rows.sort((a,b)=>b.date.localeCompare(a.date));const current=rows[0],candidate=rows[1],prior=candidate&&candidate.rates.every(n=>n!==null)?candidate:null;
 const age=(Date.parse(today+'T00:00:00Z')-Date.parse(current.date+'T00:00:00Z'))/86400000;
 if(current.rates.some(n=>n===null)||!Number.isInteger(age)||age<0||age>7)throw Error('AI_GLOBAL_MARKET_TREASURY_MISSING_OR_STALE');
 const change=(i:number)=>prior?Math.round((current.rates[i]!-prior.rates[i]!)*100*1000000)/1000000:null;
 return {kind:'US_TREASURY_PAR_YIELD_CURVE',native_symbol:'UST_PAR_YIELD_CURVE',market:'US',session:'DAILY_OBSERVATION',
  session_date:current.date,trading_date:current.date,currency:'USD',unit:'PERCENT',
  yield_2y:current.rates[0],yield_10y:current.rates[1],yield_30y:current.rates[2],
  prior_yield_2y:prior?.rates[0]??null,prior_yield_10y:prior?.rates[1]??null,prior_yield_30y:prior?.rates[2]??null,
  change_2y_bp:change(0),change_10y_bp:change(1),change_30y_bp:change(2),prior_session_date:prior?.date??null,
  comparison_basis:'PREVIOUS_AVAILABLE_TREASURY_OBSERVATION',rate_model:'NOMINAL_CONSTANT_MATURITY_PAR_YIELD',
  source_row_date_basis:'NEW_DATE_DATE_COORDINATE_NOT_PUBLICATION',observation_date_coordinate:current.coordinate,
  observation_age_calendar_days:age};
}
/** Expected latest fully ended physical night and its distinct volume date. */
export function dailyAiExpectedTaiwanNight(received_at:string){
 const day=taipeiDay(received_at);if(!coveredCalendarDate('TW',day))return null;
 let start=day;
 for(let i=0;i<30;i++,start=addDay(start,-1)){
  if(!coveredCalendarDate('TW',start))return null;
  const end=addDay(start,1);
  if(!isMarketTradingDate('TW',start)||Date.parse(end+'T05:00:00+08:00')>Date.parse(received_at))continue;
  let attribution=start;
  for(let j=0;j<30;j++){
   attribution=addDay(attribution,1);if(!coveredCalendarDate('TW',attribution))return null;
   if(isMarketTradingDate('TW',attribution))return {session_date:start,session_ended_on:end,trading_date:attribution,
    scheduled_session_start:start+'T15:00:00+08:00',scheduled_session_end:end+'T05:00:00+08:00'};
  }
  return null;
 }
 return null;
}
function taiwanFacts(value:unknown,received_at:string){
 if(!Array.isArray(value)||value.length>5000)throw Error('AI_GLOBAL_MARKET_TAIFEX_SCHEMA');
 const expected=dailyAiExpectedTaiwanNight(received_at);if(!expected)throw Error('AI_GLOBAL_MARKET_CALENDAR_UNCOVERED');
 const rows=value.map(object).filter(r=>r.Contract==='TX'&&r.TradingSession==='盤後'&&r.Date===expected.trading_date.replaceAll('-','')
  &&typeof r['ContractMonth(Week)']==='string'&&/^\d{4}(?:0[1-9]|1[0-2])$/.test(r['ContractMonth(Week)'])
  &&r['ContractMonth(Week)']>=expected.session_date.slice(0,7).replace('-',''));
 rows.sort((a,b)=>String(a['ContractMonth(Week)']).localeCompare(String(b['ContractMonth(Week)'])));
 if(!rows.length||rows.length>1&&rows[0]['ContractMonth(Week)']===rows[1]['ContractMonth(Week)'])throw Error('AI_GLOBAL_MARKET_TAIFEX_IDENTITY');
 const row=rows[0],close=numeric(row.Last),change=numeric(row.Change),reported=typeof row['%']==='string'&&row['%'].endsWith('%')?numeric(row['%'].slice(0,-1)):null;
 if(close===null||close<=0||change===null||close-change<=0||reported===null||Math.abs(change/(close-change)*100-reported)>.011)
  throw Error('AI_GLOBAL_MARKET_TAIFEX_VALUE');
 const month=String(row['ContractMonth(Week)']);
 return {kind:'TAIWAN_NIGHT_FUTURE',native_symbol:'TX',native_contract:'TX'+month,contract_month:month,market:'TW',session:'AFTERHOURS',
  ...expected,trading_date_basis:'TAIFEX_NEXT_REGULAR_SESSION_ATTRIBUTION',currency:'TWD',unit:'INDEX_POINTS',close,
  change_points:change,change_percent:reported,change_reference_value:close-change,
  comparison_basis:'TAIFEX_REPORTED_OPENING_REFERENCE',contract_selection:'NEAREST_MONTH_PRESENT_IN_OFFICIAL_COMPLETED_SESSION'};
}

export function dailyAiTaiwanNightReportUrl(tradingDate:string){
 if(!date(tradingDate)||!isMarketTradingDate('TW',tradingDate))throw Error('AI_GLOBAL_MARKET_TAIFEX_IDENTITY');
 return 'https://www.taifex.com.tw/cht/3/futDailyMarketReport?queryType=2&marketCode=1&queryDate='
  +encodeURIComponent(tradingDate.replaceAll('-','/'))+'&commodity_id=TX';
}
function taiwanNightHtmlFacts(value:unknown,received_at:string){
 if(typeof value!=='string')throw Error('AI_GLOBAL_MARKET_TAIFEX_SCHEMA');
 const expected=dailyAiExpectedTaiwanNight(received_at);if(!expected)throw Error('AI_GLOBAL_MARKET_CALENDAR_UNCOVERED');
 const start=value.indexOf('<!-- ---------dataStart--------- -->');
 if(start<0)throw Error('AI_GLOBAL_MARKET_TAIFEX_HTML');
 const body=value.slice(start).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<!--[\s\S]*?-->/g,''),at=body.search(/<table\b/i);
 if(at<0)throw Error('AI_GLOBAL_MARKET_TAIFEX_HTML');
 const clean=(s:string)=>s.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;|&#x0*a0;/gi,' ').replace(/\s+/g,'');
 const heading=clean(body.slice(0,at));
 // These are the actual printed report headings, not query/form echoes.
 if(!heading.includes('日期：'+expected.trading_date.replaceAll('-','/'))||!heading.includes('臺股期貨(TX)行情表')
  ||!heading.includes(expected.session_date.replaceAll('-','/')+'15:00~次日05:00盤後交易時段行情表'))throw Error('AI_GLOBAL_MARKET_TAIFEX_IDENTITY');
 const table=body.slice(at).match(/^<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
 if(!table)throw Error('AI_GLOBAL_MARKET_TAIFEX_HTML');
 const head=table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1]??'';
 const headers=Array.from(head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),m=>clean(m[1]));
 if(headers.join('|')!=='契約|到期月份(週別)|開盤價|最高價|最低價|最後成交價|漲跌價|漲跌%|*成交量|結算價|*未沖銷契約量|最後最佳買價|最後最佳賣價|歷史最高價|歷史最低價')throw Error('AI_GLOBAL_MARKET_TAIFEX_HTML');
 const rows=[];
 for(const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=Array.from(tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),m=>clean(m[1]));
  if(cells[0]!=='TX')continue;
  if(cells.length!==15||!/^\d{4}(?:0[1-9]|1[0-2])$/.test(cells[1]))throw Error('AI_GLOBAL_MARKET_TAIFEX_HTML');
  const open=numeric(cells[2]),high=numeric(cells[3]),low=numeric(cells[4]),last=numeric(cells[5]);
  if(open===null||high===null||low===null||last===null||low<=0||high<low||open<low||open>high||last<low||last>high)throw Error('AI_GLOBAL_MARKET_TAIFEX_VALUE');
  rows.push({Date:expected.trading_date.replaceAll('-',''),Contract:'TX','ContractMonth(Week)':cells[1],Last:cells[5],
   Change:cells[6].replace(/^[▲▼]/,''),'%':cells[7].replace(/^[▲▼]/,''),TradingSession:'盤後'});
 }
 return taiwanFacts(rows,received_at);
}

/** Two public requests, concurrency two, each bounded to 6 seconds/2 MB.
 * One verified TAIFEX report fallback may take 12 seconds if the daily API is stale.
 * Treasury rates are macro context, never a substitute for US equity closes.
 * A failed/stale night API yields a gap instead of changing its trading date. */
export async function collectDailyAiGlobalMarket(input:{fetcher:typeof fetch;clock:()=>string;signal:AbortSignal;businessDate:string}){
 stopped(input.signal);const began=input.clock();
 if(!date(input.businessDate)||!validObservationTime(began)||taipeiDay(began)!==input.businessDate)throw Error('AI_GLOBAL_MARKET_SCOPE');
 const instruments:Instrument[]=['TREASURY','TX'],receipts:DailyAiGlobalMarketReceipt[]=new Array(2),evidence:(AnalysisEvidence|null)[]=new Array(2).fill(null);
 let cursor=0;
 const worker=async()=>{for(;;){const i=cursor++;if(i>=instruments.length)return;stopped(input.signal);
  const instrument=instruments[i],source=instrument==='TREASURY'?dailyAiTreasuryYieldUrl(input.businessDate,began):DAILY_AI_GLOBAL_MARKET_URLS.TX;let capture:{received_at:string;hash:string;bytes:number}|null=null;
  try{
   const raw=await readJson(source,input.fetcher,input.signal,instrument==='TREASURY'?'XML':'JSON');stopped(input.signal);const received_at=input.clock();
   if(!validObservationTime(received_at)||Date.parse(received_at)<Date.parse(began)||taipeiDay(received_at)!==input.businessDate)throw Error('AI_GLOBAL_MARKET_CLOCK');
   capture={received_at,hash:raw.hash,bytes:raw.bytes};
   const facts=instrument==='TX'?taiwanFacts(raw.value,received_at):treasuryFacts(raw.value,source,received_at);
   const content=JSON.stringify({schema:'DAILY_AI_GLOBAL_MARKET_FACT_V1',...facts,research_business_date:input.businessDate,
    freshness:instrument==='TREASURY'?'LATEST_AVAILABLE_TREASURY_OBSERVATION':'LATEST_COMPLETED_SESSION',timestamp_basis:'RECEIPT_ONLY_PUBLICATION_UNKNOWN',
    calendar_version:instrument==='TREASURY'?'TREASURY_XML_ACTUAL_DATES_V1':MARKET_CALENDAR_VERSION,
    received_at,source_response_sha256:raw.hash,source_response_bytes:raw.bytes});
   evidence[i]={id:`global:${instrument}:${facts.session_date}`,symbol:null,kind:'MARKET',source,published_at:null,
    available_at:received_at,first_seen_at:received_at,as_of:received_at,time_basis:'OBSERVED_AFTER_RECEIPT',content,
    evidence_hash:await digest(new TextEncoder().encode(content))};
   receipts[i]={source,instrument,state:'CAPTURED',...capture};
  }catch(error){
   if(input.signal.aborted)throw Error('AI_GLOBAL_MARKET_ABORTED');
   if(error instanceof Error&&error.message==='AI_GLOBAL_MARKET_CLOCK')throw error;
   const code=error instanceof Error&&/^AI_GLOBAL_MARKET_[A-Z_]+$/.test(error.message)?error.message:'AI_GLOBAL_MARKET_UNAVAILABLE';
   receipts[i]={source,instrument,state:'UNAVAILABLE',received_at:capture?.received_at??null,hash:capture?.hash??null,bytes:capture?.bytes??null,error:code};
  }
 }};
 await Promise.all([worker(),worker()]);stopped(input.signal);
 if(evidence[1]===null){
  const expected=dailyAiExpectedTaiwanNight(began);
  if(expected){
   const source=dailyAiTaiwanNightReportUrl(expected.trading_date);let capture:{received_at:string;hash:string;bytes:number}|null=null;
   try{
    const raw=await readJson(source,input.fetcher,input.signal,'HTML',12000);stopped(input.signal);const received_at=input.clock();
    if(!validObservationTime(received_at)||Date.parse(received_at)<Date.parse(began)||taipeiDay(received_at)!==input.businessDate)throw Error('AI_GLOBAL_MARKET_CLOCK');
    capture={received_at,hash:raw.hash,bytes:raw.bytes};const facts=taiwanNightHtmlFacts(raw.value,received_at);
    if(facts.trading_date!==expected.trading_date)throw Error('AI_GLOBAL_MARKET_TAIFEX_IDENTITY');
    const content=JSON.stringify({schema:'DAILY_AI_GLOBAL_MARKET_FACT_V1',...facts,research_business_date:input.businessDate,
     freshness:'LATEST_COMPLETED_SESSION',timestamp_basis:'RECEIPT_ONLY_PUBLICATION_UNKNOWN',calendar_version:MARKET_CALENDAR_VERSION,
     received_at,source_response_sha256:raw.hash,source_response_bytes:raw.bytes});
    evidence[1]={id:`global:TX:${facts.session_date}`,symbol:null,kind:'MARKET',source,published_at:null,
     available_at:received_at,first_seen_at:received_at,as_of:received_at,time_basis:'OBSERVED_AFTER_RECEIPT',content,evidence_hash:await digest(new TextEncoder().encode(content))};
    receipts.push({source,instrument:'TX',state:'CAPTURED',...capture});
   }catch(error){
    if(input.signal.aborted)throw Error('AI_GLOBAL_MARKET_ABORTED');
    if(error instanceof Error&&error.message==='AI_GLOBAL_MARKET_CLOCK')throw error;
    const code=error instanceof Error&&/^AI_GLOBAL_MARKET_[A-Z_]+$/.test(error.message)?error.message:'AI_GLOBAL_MARKET_UNAVAILABLE';
    receipts.push({source,instrument:'TX',state:'UNAVAILABLE',received_at:capture?.received_at??null,hash:capture?.hash??null,bytes:capture?.bytes??null,error:code});
   }
  }
 }
 const market=evidence.filter((e):e is AnalysisEvidence=>e!==null),additionalGaps:string[]=['US_EQUITY_CLOSE_NOT_COLLECTED_US_NEWS_CONTEXT_ONLY'];
 if(evidence[0]===null)additionalGaps.push('US_TREASURY_YIELD_CURVE_UNAVAILABLE');
 else if(JSON.parse(evidence[0].content).prior_session_date===null)additionalGaps.push('US_TREASURY_PRIOR_OBSERVATION_UNAVAILABLE');
 if(!receipts.find(r=>r.instrument==='TX'&&r.state==='CAPTURED'))additionalGaps.push('TAIWAN_NIGHT_SESSION_UNVERIFIED');
 // Keep the content digest convention explicit and consistent with packet SQL.
 for(const e of market)if(e.evidence_hash!==await digest(new TextEncoder().encode(e.content)))throw Error('AI_GLOBAL_MARKET_HASH');
 return {market,additionalGaps,receipts};
}
