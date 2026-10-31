import type {AnalysisEvidence} from './daily-ai-analysis.ts';
import {validObservationTime} from '../src/features/vnext/contracts.ts';
import {latestCompletedUsCashSession} from '../supabase/functions/_shared/us-cash-session-calendar.ts';
import {coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate,MARKET_CALENDAR_VERSION} from '../supabase/functions/_shared/market-session-contract.mjs';

// TAIFEX schema and attribution rules checked 2026-10-31 against primary sources:
// https://openapi.taifex.com.tw/swagger.json (DailyMarketReportFut)
// https://www.taifex.com.tw/cht/4/aHIntroduction
// https://www.taifex.com.tw/cht/3/futDailyMarketReport?commodityId=TX
// A Friday night has a Monday trading-volume attribution date. Neither date is
// a publication timestamp or the research business date.
export const DAILY_AI_GLOBAL_MARKET_URLS={
 IXIC:'https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1mo',
 SOX:'https://query1.finance.yahoo.com/v8/finance/chart/%5ESOX?interval=1d&range=1mo',
 GSPC:'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1mo',
 TX:'https://openapi.taifex.com.tw/v1/DailyMarketReportFut',
} as const;
type Instrument=keyof typeof DAILY_AI_GLOBAL_MARKET_URLS;
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
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const stopped=(s:AbortSignal)=>{if(s.aborted)throw Error('AI_GLOBAL_MARKET_ABORTED');};

async function readJson(url:string,fetcher:typeof fetch,signal:AbortSignal,format:'JSON'|'HTML'='JSON',timeoutMs=6000){
 const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let timer:ReturnType<typeof setTimeout>|undefined;
 const work=(async()=>{
  const response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:format==='HTML'?'text/html':'application/json'},signal:combined});
  if(!response.ok||Number(response.headers.get('content-length'))>2000000)throw Error('AI_GLOBAL_MARKET_HTTP_OR_SIZE');
  const reader=response.body?.getReader();if(!reader)throw Error('AI_GLOBAL_MARKET_BODY');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){stopped(combined);const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>2000000)throw Error('AI_GLOBAL_MARKET_SIZE');chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  stopped(combined);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return {value:format==='HTML'?text:JSON.parse(text),bytes:size,hash:await digest(bytes)};
 })();
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(Error('AI_GLOBAL_MARKET_TIMEOUT'));},timeoutMs);
 })]);}finally{if(timer)clearTimeout(timer);controller.abort();}
}
function usFacts(value:unknown,instrument:Exclude<Instrument,'TX'>,received_at:string){
 const chart=object(object(value).chart);if(chart.error!==null&&chart.error!==undefined)throw Error('AI_GLOBAL_MARKET_PROVIDER');
 if(!Array.isArray(chart.result)||chart.result.length!==1)throw Error('AI_GLOBAL_MARKET_SCHEMA');
 const result=object(chart.result[0]),meta=object(result.meta),indicators=object(result.indicators);
 if(meta.symbol!=='^'+instrument||meta.instrumentType!=='INDEX'||meta.currency!=='USD'||meta.exchangeTimezoneName!=='America/New_York'
  ||meta.dataGranularity!=='1d'||!Number.isSafeInteger(meta.regularMarketTime)||Number(meta.regularMarketTime)*1000>Date.parse(received_at))
  throw Error('AI_GLOBAL_MARKET_INDEX_IDENTITY');
 if(!Array.isArray(result.timestamp)||result.timestamp.length<2||result.timestamp.length>64
  ||!Array.isArray(indicators.quote)||indicators.quote.length!==1)throw Error('AI_GLOBAL_MARKET_SCHEMA');
 const closes=object(indicators.quote[0]).close;
 if(!Array.isArray(closes)||closes.length!==result.timestamp.length)throw Error('AI_GLOBAL_MARKET_SCHEMA');
 const session=latestCompletedUsCashSession(Date.parse(received_at)),prior=session&&previousMarketTradingDate('US',session);
 if(!session||!prior)throw Error('AI_GLOBAL_MARKET_CALENDAR_UNCOVERED');
 const selected=new Map<string,{close:number;at:string}>();
 for(let i=0;i<result.timestamp.length;i++){
  const timestamp=result.timestamp[i],close=finite(closes[i]);
  if(!Number.isSafeInteger(timestamp)||Number(timestamp)<=0||Number(timestamp)*1000>Date.parse(received_at))throw Error('AI_GLOBAL_MARKET_BAR_TIME');
  const day=nyDay(Number(timestamp)*1000);if(day!==session&&day!==prior)continue;
  if(close===null||close<=0||selected.has(day))throw Error('AI_GLOBAL_MARKET_DAILY_BAR');
  selected.set(day,{close,at:new Date(Number(timestamp)*1000).toISOString()});
 }
 const current=selected.get(session),previous=selected.get(prior);if(!current||!previous)throw Error('AI_GLOBAL_MARKET_STALE_OR_MISSING_SESSION');
 const change=current.close-previous.close,percent=Math.round(change/previous.close*100*1000000)/1000000;
 if(!Number.isFinite(change)||!Number.isFinite(percent))throw Error('AI_GLOBAL_MARKET_DAILY_BAR');
 return {kind:'US_CASH_INDEX',native_symbol:'^'+instrument,market:'US',session:'REGULAR',session_date:session,trading_date:session,
  currency:'USD',unit:'INDEX_POINTS',close:current.close,prior_close:previous.close,prior_session_date:prior,
  source_bar_at:current.at,prior_bar_at:previous.at,bar_timestamp_basis:'PROVIDER_DAILY_BAR_TIME_NOT_PUBLICATION',
  change_points:change,change_percent:percent,
  comparison_basis:'PREVIOUS_COMPLETED_US_CASH_SESSION_CLOSE'};
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

/** Four public requests, concurrency two, each bounded to 6 seconds/2 MB.
 * One verified TAIFEX report fallback may take 12 seconds if the daily API is stale.
 * Sources are independent of paid quotes. A failed/stale night API yields a gap
 * instead of substituting a day session or changing its trading date. */
export async function collectDailyAiGlobalMarket(input:{fetcher:typeof fetch;clock:()=>string;signal:AbortSignal;businessDate:string}){
 stopped(input.signal);const began=input.clock();
 if(!date(input.businessDate)||!validObservationTime(began)||taipeiDay(began)!==input.businessDate)throw Error('AI_GLOBAL_MARKET_SCOPE');
 const instruments=Object.keys(DAILY_AI_GLOBAL_MARKET_URLS) as Instrument[],receipts:DailyAiGlobalMarketReceipt[]=new Array(4),evidence:(AnalysisEvidence|null)[]=new Array(4).fill(null);
 let cursor=0;
 const worker=async()=>{for(;;){const i=cursor++;if(i>=instruments.length)return;stopped(input.signal);
  const instrument=instruments[i],source=DAILY_AI_GLOBAL_MARKET_URLS[instrument];let capture:{received_at:string;hash:string;bytes:number}|null=null;
  try{
   const raw=await readJson(source,input.fetcher,input.signal);stopped(input.signal);const received_at=input.clock();
   if(!validObservationTime(received_at)||Date.parse(received_at)<Date.parse(began)||taipeiDay(received_at)!==input.businessDate)throw Error('AI_GLOBAL_MARKET_CLOCK');
   capture={received_at,hash:raw.hash,bytes:raw.bytes};
   const facts=instrument==='TX'?taiwanFacts(raw.value,received_at):usFacts(raw.value,instrument,received_at);
   const content=JSON.stringify({schema:'DAILY_AI_GLOBAL_MARKET_FACT_V1',...facts,research_business_date:input.businessDate,
    freshness:'LATEST_COMPLETED_SESSION',timestamp_basis:'RECEIPT_ONLY_PUBLICATION_UNKNOWN',calendar_version:MARKET_CALENDAR_VERSION,
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
 if(evidence[3]===null){
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
    evidence[3]={id:`global:TX:${facts.session_date}`,symbol:null,kind:'MARKET',source,published_at:null,
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
 const market=evidence.filter((e):e is AnalysisEvidence=>e!==null),additionalGaps:string[]=[];
 for(const instrument of instruments.filter(i=>i!=='TX'))if(!receipts.find(r=>r.instrument===instrument&&r.state==='CAPTURED'))additionalGaps.push('US_CLOSE_'+instrument+'_UNAVAILABLE');
 if(market.filter(e=>JSON.parse(e.content).market==='US').length<2)additionalGaps.push('US_COMPLETED_CASH_SESSION_PARTIAL');
 if(!receipts.find(r=>r.instrument==='TX'&&r.state==='CAPTURED'))additionalGaps.push('TAIWAN_NIGHT_SESSION_UNVERIFIED');
 // Keep the content digest convention explicit and consistent with packet SQL.
 for(const e of market)if(e.evidence_hash!==await digest(new TextEncoder().encode(e.content)))throw Error('AI_GLOBAL_MARKET_HASH');
 return {market,additionalGaps,receipts};
}
