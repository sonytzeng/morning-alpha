/** Date-driven, official-source-only adapter. No historical file or credential fallback. */
import {snapshotHash, HORIZONS, validObservationTime, compareTime} from './contracts.ts';
import {previousMarketTradingDate, coveredCalendarDate, isMarketTradingDate} from '../../../supabase/functions/_shared/market-session-contract.mjs';
import {RECOMMENDATION_UNIVERSE} from '../../../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {historyUrl, parseOfficialHistory, tpexDailyUrl, parseTpexDaily, companyDirectory, type Exchange} from '../../../research/entry-official-history.ts';
import {parseRevenue, parseInstitutional, parseFinancial, parseIndex, parseEventIndex, ACTION_SOURCES, parseActionInventory} from './dailyParsers.mjs';
import type {AcquiredResearch} from './dailyIntelligence.ts';
import type {DailyBar, ResearchFact, FunnelInput} from './researchFunnel.ts';
import {RESEARCH_RULES,traceIssues} from './researchFunnel.ts';
import type {EntryInput} from '../../../research/entry-opportunity.ts';
import {targetSessions} from './dailyOutcome.ts';
import type {DailyLock} from './dailyIntelligence.ts';

export const ADAPTER_VERSION='VNEXT_DAILY_OFFICIAL_1';
const INDEX_OPEN_API='https://openapi.twse.com.tw/v1/indicesReport/MI_5MINS_HIST';
export type Company={symbol:string;company:string;exchange:Exchange;industry:string};
export type SourceTask={key:string;kind:string;url:string;format:'json'|'text';scope:string;
 symbols:string[];exchange?:Exchange;month?:string;date?:string;period?:string;year?:number;quarter?:number;
 from?:string;through?:string;form?:Record<string,string>;action_index?:number;max_age_days:number;
 financial_response_contract?:'MOPS_RESPONSE_PERIOD_V1';benchmark_response_contract?:'TWSE_OPENAPI_INDEX_V1'};
export type SourceReceipt={task:SourceTask;first_seen_at:string;available_at:string;published_at:null;as_of:string;
 version:string;raw_hash:string;payload_hash:string;payload:Record<string,unknown>;status:'OK'|'UNAVAILABLE';reason:string|null};
const day=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
export function sessionsBefore(before:string,count=250){
 if(!coveredCalendarDate('TW',before)||!isMarketTradingDate('TW',before)||!Number.isInteger(count)||count<1||count>250)throw Error('CALENDAR_SCOPE');
 const dates:string[]=[];let d=before;
 for(let i=0;i<count;i++){const prior=previousMarketTradingDate('TW',d);if(!prior||!coveredCalendarDate('TW',prior))throw Error('CALENDAR_COVERAGE');d=prior;dates.unshift(d);}return dates;
}
export async function directoryPlan(date:string):Promise<SourceTask[]>{
 return Promise.all((['TWSE','TPEX'] as const).map(async exchange=>{const url=exchange==='TWSE'?'https://openapi.twse.com.tw/v1/opendata/t187ap03_L':'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
 const t={kind:'DIRECTORY',url,format:'json' as const,scope:date,symbols:[...RECOMMENDATION_UNIVERSE],exchange,max_age_days:1};return {...t,key:await snapshotHash(t)};}));
}
export function classifyCompanies(receipts:SourceReceipt[]):Company[]{
 const rows=receipts.flatMap(r=>r.status==='OK'&&r.task.kind==='DIRECTORY'?r.payload.rows as Company[]:[]);
 return RECOMMENDATION_UNIVERSE.map(symbol=>{const matches=rows.filter(r=>r.symbol===symbol);if(matches.length!==1)throw Error('UNIVERSE_CLASSIFICATION_MISSING');return matches[0];});
}
/** Cold bootstrap is durably chunked. Previous immutable source revisions are
 * reused with finite freshness; current-month/day responses are never frozen. */
export async function acquisitionPlan(date:string,companies:Company[]):Promise<SourceTask[]>{
 if(companies.length!==72||JSON.stringify(companies.map(c=>c.symbol).sort())!==JSON.stringify([...RECOMMENDATION_UNIVERSE].sort()))throw Error('UNIVERSE_DRIFT');
 const dates=sessionsBefore(date),through=dates.at(-1)!,months=[...new Set(dates.map(d=>d.slice(0,7)))],tasks:Omit<SourceTask,'key'>[]=[];
 const add=(t:Omit<SourceTask,'key'|'scope'|'max_age_days'>,age=1)=>tasks.push({...t,scope:ADAPTER_VERSION+(age===1?':'+date:''),max_age_days:age});
 for(const c of companies.filter(c=>c.exchange==='TWSE'))for(const month of months)add({kind:'PRICE',url:historyUrl(c.exchange,c.symbol,month),format:'json',symbols:[c.symbol],exchange:c.exchange,month},month===through.slice(0,7)?1:7);
 const otc=companies.filter(c=>c.exchange==='TPEX').map(c=>c.symbol);
 for(const d of dates)add({kind:'OTC_PRICE',url:tpexDailyUrl(d),format:'json',symbols:otc,date:d,exchange:'TPEX'},d===through?1:7);
 for(const month of months){const current=month===through.slice(0,7);add({kind:'BENCHMARK',url:current?INDEX_OPEN_API:`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date=${month.replace('-','')}01&response=json`,format:'json',symbols:[],month,...(current?{benchmark_response_contract:'TWSE_OPENAPI_INDEX_V1' as const}:{})},current?1:7);}
 const [y,m]=date.split('-').map(Number);
 for(const exchange of ['TWSE','TPEX'] as const){const market=exchange==='TWSE'?'sii':'otc',symbols=companies.filter(c=>c.exchange===exchange).map(c=>c.symbol);
  for(let i=1;i<=36;i++){const d=new Date(Date.UTC(y,m-1-i,1)),period=d.toISOString().slice(0,7),year=d.getUTCFullYear(),month=d.getUTCMonth()+1;
   add({kind:'REVENUE',url:`https://mopsov.twse.com.tw/nas/t21/${market}/t21sc03_${year-1911}_${month}.csv`,format:'text',symbols,exchange,period},i<=2?1:7);}
  for(const d of dates.slice(-20)){const roc=`${Number(d.slice(0,4))-1911}/${d.slice(5).replace('-','/')}`;
   add({kind:'INSTITUTIONAL',date:d,exchange,symbols,format:'json',url:exchange==='TWSE'?`https://www.twse.com.tw/rwd/zh/fund/T86?date=${d.replaceAll('-','')}&selectType=ALL&response=json`:`https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=EW&t=D&d=${roc}&o=json`},d===through?1:7);}
  const quarterIndex=y*4+Math.floor((m-1)/3)-1;
  for(let i=0;i<10;i++){const q=quarterIndex-i,year=Math.floor(q/4),quarter=q%4+1;
   for(const [kind,path] of [['FINANCIAL_YTD','04'],['CASHFLOW_YTD','20']])add({kind,year,quarter,exchange,symbols,format:'text',financial_response_contract:'MOPS_RESPONSE_PERIOD_V1',url:`https://mopsov.twse.com.tw/mops/web/ajax_t163sb${path}`,form:{encodeURIComponent:'1',firstin:'1',off:'1',step:'1',isQuery:'Y',TYPEK:market,year:String(year-1911),season:String(quarter).padStart(2,'0')}},i<2?1:7);}
 }
 for(const c of companies)for(let i=0;i<2;i++){const d=new Date(Date.UTC(y,m-1-i,1)),year=d.getUTCFullYear(),month=d.getUTCMonth()+1,from=d.toISOString().slice(0,10),end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),to=end<date?end:date;
  add({kind:'EVENT',url:'https://mops.twse.com.tw/mops/api/t05st01',format:'json',symbols:[c.symbol],year,month:String(month),from,through:to,form:{companyId:c.symbol,year:String(year-1911),month:String(month),firstDay:'1',lastDay:String(Number(to.slice(8)))}});}
 for(const [action_index,s] of ACTION_SOURCES.entries()){const u=new URL(s.base),fmt=(d:string)=>s.exchange==='TPEX'?d.replaceAll('-','/'):d.replaceAll('-','');u.searchParams.set('startDate',fmt(dates[0]));u.searchParams.set('endDate',fmt(through));u.searchParams.set('response','json');
  add({kind:'ACTION',action_index,url:u.href,format:'json',symbols:companies.filter(c=>c.exchange===s.exchange).map(c=>c.symbol),from:dates[0],through});}
 // Complete the current SHORT window for ALL stocks, then the MEDIUM source
 // window, before spending the cold-start budget on a full year of prices.
 // This only orders the existing tasks. Receipts, keys, freshness, attempts and
 // all evaluator requirements stay unchanged; old persisted plans are immutable.
 const warmDates=new Set(dates.slice(-20)),warmMonths=new Set([...warmDates].map(d=>d.slice(0,7)));
 const institutionalDates=new Set(dates.slice(-RESEARCH_RULES.medium_institutional_sessions));
 const revenuePeriods=new Set(tasks.filter(t=>t.kind==='REVENUE').map(t=>t.period!).sort().filter((p,i,a)=>a.indexOf(p)===i).slice(-RESEARCH_RULES.medium_months));
 const priority=(t:Omit<SourceTask,'key'>)=>{
  if(t.kind==='PRICE'||t.kind==='BENCHMARK')return warmMonths.has(t.month!)?0:3;
  if(t.kind==='OTC_PRICE')return warmDates.has(t.date!)?0:3;
  if(t.kind==='REVENUE'&&revenuePeriods.has(t.period!)||t.kind==='INSTITUTIONAL'&&institutionalDates.has(t.date!))return 1;
  return 2;
 };
 tasks.sort((a,b)=>{
  const order=priority(a)-priority(b);if(order)return order;
  return String(b.date??b.month??b.period??'').localeCompare(String(a.date??a.month??a.period??''))||a.url.localeCompare(b.url);
 });
 return Promise.all(tasks.map(async t=>({...t,key:await snapshotHash(t)})));
}
/** Outcome receipts have their own availability/phase and are NEVER substituted
 * into a locked prediction. In-progress month/day is refreshed after the close. */
export async function outcomePlan(date:string,pending:{prediction:DailyLock;horizons:number[]}[],companies:Company[],observedAt:string):Promise<SourceTask[]>{
 if(day(observedAt)!==date||pending.length>24)throw Error('OUTCOME_SOURCE_SCOPE');
 const tasks=new Map<string,Omit<SourceTask,'key'>>(),postClose=Date.parse(observedAt)>=Date.parse(date+'T13:30:00+08:00');
 for(const {prediction:lock,horizons} of pending){
  const company=companies.find(c=>c.symbol===lock.symbol);if(!company)throw Error('OUTCOME_COMPANY_UNKNOWN');
  const dates=[...new Set(horizons.flatMap(h=>targetSessions(lock.actionable_at,h)??[]))].filter(d=>d<date||(d===date&&postClose));
  const months=[...new Set(dates.map(d=>d.slice(0,7)))];
  const add=(task:Omit<SourceTask,'key'|'scope'|'max_age_days'>,current:boolean)=>{
   const t={...task,scope:ADAPTER_VERSION+':OUTCOME:'+(current?date+':'+(postClose?'CLOSE':'PREMARKET'):'HISTORY'),max_age_days:current?0:7};
   tasks.set(JSON.stringify(t),t);
  };
  for(const month of months){
   if(company.exchange==='TWSE')add({kind:'PRICE',url:historyUrl('TWSE',lock.symbol,month),format:'json',symbols:[lock.symbol],exchange:'TWSE',month},month===date.slice(0,7));
   add({kind:'BENCHMARK',url:`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date=${month.replace('-','')}01&response=json`,format:'json',symbols:[],month},month===date.slice(0,7));
  }
  if(company.exchange==='TPEX')for(const d of dates)add({kind:'OTC_PRICE',url:tpexDailyUrl(d),format:'json',symbols:companies.filter(c=>c.exchange==='TPEX').map(c=>c.symbol),date:d,exchange:'TPEX'},d===date);
 }
 if(tasks.size>1600)throw Error('OUTCOME_SOURCE_BUDGET');
 return Promise.all([...tasks.values()].sort((a,b)=>a.url.localeCompare(b.url)).map(async t=>({...t,key:await snapshotHash(t)})));
}
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export async function normalizeSource(task:SourceTask,raw:unknown,at:string):Promise<Record<string,unknown>>{
 const t=task,p=object(raw);
 if(t.kind==='DIRECTORY'){
  const classified=companyDirectory(t.exchange!,raw,t.url,at);const originals=raw as Record<string,unknown>[];
  return {rows:classified.filter(c=>t.symbols.includes(c.symbol)).map(c=>{const r=originals.find(x=>String(x['公司代號']??x.SecuritiesCompanyCode)===c.symbol)!;return {symbol:c.symbol,exchange:c.exchange,industry:c.industry_code,company:String(r['公司簡稱']??r['公司名稱']??r.SecuritiesCompanyName??c.symbol)};})};
 }
 if(t.kind==='PRICE'||t.kind==='OTC_PRICE'){
  const history=t.kind==='PRICE'?parseOfficialHistory(t.exchange!,t.symbols[0],t.month!,p,at):null;
  const records=history?history.bars.map(bar=>({symbol:t.symbols[0],bar})):parseTpexDaily(p,t.date!,t.symbols,at).daily.filter(r=>r.bar).map(r=>({symbol:r.symbol,bar:r.bar!}));
  return {rows:await Promise.all(records.map(async({symbol,bar})=>({symbol,...bar,id:`bar-${symbol}-${bar.date}`,source:t.url,published_at:null,first_seen_at:at,as_of:bar.date+'T13:30:00+08:00',evidence_hash:await snapshotHash(bar),session_scope:history?.volume_amount_scope??'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES'}))),rejected:history?.rejected??[]};
 }
 if(t.kind==='REVENUE')return parseRevenue(String(raw),{...t,period:t.period!},at);
 if(t.kind==='INSTITUTIONAL')return parseInstitutional(raw,{...t,exchange:t.exchange!,date:t.date!},at);
 if(t.kind==='FINANCIAL_YTD'||t.kind==='CASHFLOW_YTD')return parseFinancial(String(raw),{...t,year:t.year!,quarter:t.quarter!,exchange:t.exchange!},at);
 if(t.kind==='EVENT')return parseEventIndex(raw,{...t,symbol:t.symbols[0],year:t.year!,month:Number(t.month),from:t.from!,through:t.through!,url:t.url+'?'+new URLSearchParams(t.form)},at);
 if(t.kind==='BENCHMARK'){
  if(t.benchmark_response_contract!==undefined||t.url===INDEX_OPEN_API){
   const fields=['Date','OpeningIndex','HighestIndex','LowestIndex','ClosingIndex'];
   if(t.benchmark_response_contract!=='TWSE_OPENAPI_INDEX_V1'||t.url!==INDEX_OPEN_API||!/^\d{4}-\d\d$/.test(t.month??'')
    ||!Array.isArray(raw)||!raw.length||raw.length>32||raw.some(r=>!r||typeof r!=='object'||Array.isArray(r)
     ||Object.keys(r).sort().join('|')!==[...fields].sort().join('|')||fields.some(k=>typeof r[k]!=='string')))throw Error('BENCHMARK_OPENAPI_SCHEMA');
   raw={stat:'OK',date:t.month!.replace('-','')+'01',fields:['日期','開盤指數','最高指數','最低指數','收盤指數'],data:raw.map(r=>fields.map(k=>r[k]))};
  }
  return {rows:parseIndex(raw,t.month,at,t.url).map((b:Record<string,unknown>)=>({...b,id:'benchmark-'+b.date,volume:null,amount:null,session_scope:'TAIEX_OFFICIAL'}))};
 }
 if(t.kind==='ACTION')return {rows:parseActionInventory(ACTION_SOURCES[t.action_index!],raw,t.symbols,t.url,at,t.from,t.through),complete:false};
 throw Error('SOURCE_KIND_INVALID');
}
/** The request comes ONLY from the server-generated plan, not a client URL. */
export async function fetchSource(task:SourceTask,fetcher:typeof fetch,clock:()=>string,signal:AbortSignal):Promise<SourceReceipt>{
 const url=new URL(task.url);
 if(url.protocol!=='https:'||url.username||url.password||!['www.twse.com.tw','openapi.twse.com.tw','www.tpex.org.tw','mopsov.twse.com.tw','mops.twse.com.tw'].includes(url.hostname))throw Error('SOURCE_NOT_ALLOWED');
 const json=task.kind==='EVENT',body=task.form?(json?JSON.stringify(task.form):new URLSearchParams(task.form)):undefined;
 const r=await fetcher(task.url,{method:body?'POST':'GET',body,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),headers:{Accept:task.format==='json'?'application/json':'text/html,text/csv',...(body?{'Content-Type':json?'application/json':'application/x-www-form-urlencoded'}:{})}});
 if(!r.ok){await r.body?.cancel();const error=Object.assign(Error(r.status===429?'RATE_LIMITED':r.status===403?'SOURCE_ACCESS_RESTRICTED':'SOURCE_HTTP_'+r.status),{retryAfter:Math.min(300,Math.max(3,Number(r.headers.get('retry-after'))||3))});throw error;}
 const reader=r.body!.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8_000_000)throw Error('SOURCE_SIZE_LIMIT');parts.push(value);}}finally{await reader.cancel();}
 const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}
 const text=new TextDecoder().decode(bytes),at=clock(),payload=await normalizeSource(task,task.format==='json'?JSON.parse(text):text,at);
 return {task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:ADAPTER_VERSION,raw_hash:await snapshotHash(text),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};
}
export async function assembleDaily(date:string,companies:Company[],receipts:SourceReceipt[],cutoff:string,market:EntryInput['market']=null):Promise<AcquiredResearch>{
 const dates=sessionsBefore(date),through=dates.at(-1)!;
 if(day(cutoff)!==date)throw Error('CUTOFF_DATE_MISMATCH');
 const valid=receipts.filter(r=>r.status==='OK');for(const r of valid)if(Date.parse(r.available_at)>Date.parse(cutoff)||r.payload_hash!==await snapshotHash(r.payload))throw Error('SOURCE_REVISION_INVALID');
 const sourceIssues:{kind:string;key:string;reason:string}[]=[];
 // Old immutable receipts remain preserved, but a request-derived quarter is
 // not upgraded by merely loading it through the newer adapter. Only future
 // versioned tasks with matching source proof may contribute financial facts.
 const admitted=valid.filter(r=>{
  if(!['FINANCIAL_YTD','CASHFLOW_YTD'].includes(r.task.kind))return true;
  const rows=Array.isArray(r.payload.rows)?r.payload.rows as Record<string,unknown>[]:[];
  const matched=r.task.financial_response_contract==='MOPS_RESPONSE_PERIOD_V1'&&rows.length>0&&rows.every(row=>{
   const period=object(row.source_period);
   return row.period_verification==='RESPONSE_REPORT_HEADING_MATCHED_REQUEST'
    &&period.year===r.task.year&&period.quarter===r.task.quarter
    &&row.period===`${r.task.year}-Q${r.task.quarter}`&&row.basis==='AS_REPORTED_YTD'
    &&row.standalone_quarter_actual===false&&row.kind===r.task.kind
    &&r.task.symbols.includes(String(row.symbol));
  });
  if(!matched)sourceIssues.push({kind:r.task.kind,key:r.task.key,reason:'FINANCIAL_RESPONSE_PERIOD_UNPROVEN'});
  return matched;
 });
 const records=(k:string)=>admitted.filter(r=>r.task.kind===k).flatMap(r=>Array.isArray(r.payload.rows)?r.payload.rows as Record<string,unknown>[]:[]);
 // Canonical direction/regime remains authoritative. Bind its missing index
 // change to two complete official sessions already known at this cutoff;
 // neither an unrelated latest quote nor an unpromoted V2 run is required.
 if(market&&market.value.change_percent===undefined&&market.source_ref
  &&[market.observed_at,market.available_at,cutoff].every(validObservationTime)
  &&compareTime(market.observed_at,market.available_at)<=0&&compareTime(market.available_at,cutoff)<=0){
  const expected=dates.slice(-2),selected=expected.map(d=>admitted.filter(r=>r.task.kind==='BENCHMARK').flatMap(r=>
   (Array.isArray(r.payload.rows)?r.payload.rows as Record<string,unknown>[]:[]).filter(b=>b.date===d).map(b=>({r,b}))));
  // Different official endpoints may retain the same session. Require equal
  // native OHLC and unique endpoint rows; conflicts never select a winner.
  if(expected.length===2&&selected.every(xs=>xs.length>0&&new Set(xs.map(x=>x.r.task.url)).size===xs.length
   &&xs.every(x=>['open','high','low','close'].every(k=>x.b[k]===xs[0].b[k])))){
   const pairs=selected.flat(),ok=pairs.every(({r,b})=>
    (r.task.url===INDEX_OPEN_API&&r.task.benchmark_response_contract==='TWSE_OPENAPI_INDEX_V1'
     ||r.task.url===`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date=${r.task.month?.replace('-','')}01&response=json`)
    &&b.source===r.task.url&&b.session_scope==='TAIEX_OFFICIAL'&&b.id==='benchmark-'+b.date
    &&[r.first_seen_at,r.available_at].every(validObservationTime)
    &&compareTime(r.first_seen_at,r.available_at)<=0&&compareTime(r.available_at,cutoff)<=0
    &&b.first_seen_at===r.first_seen_at&&b.available_at===r.available_at
    &&[b.open,b.high,b.low,b.close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)
    &&Number(b.high)>=Math.max(Number(b.open),Number(b.close))&&Number(b.low)<=Math.min(Number(b.open),Number(b.close))
    &&typeof b.as_of==='string'&&b.as_of===b.date+'T13:30:00+08:00'
    &&traceIssues(b as unknown as DailyBar,cutoff).length===0);
   if(ok){
    const change=(Number(selected[1][0].b.close)/Number(selected[0][0].b.close)-1)*100;
    const latest=(values:string[])=>values.reduce((a,b)=>compareTime(a,b)>=0?a:b);
    if(Number.isFinite(change))market={...market,value:{...market.value,change_percent:change},
     observed_at:latest([market.observed_at,...pairs.map(({r})=>r.first_seen_at)]),
     available_at:latest([market.available_at,...pairs.map(({r})=>r.available_at)]),
     source_ref:market.source_ref+pairs.map(({r,b})=>'|'+r.task.url+'#'+b.id+':'+b.evidence_hash).join('')};
   }
  }
 }
 const allBars=[...records('PRICE'),...records('OTC_PRICE')],facts=[...records('REVENUE'),...records('INSTITUTIONAL'),...records('FINANCIAL_YTD'),...records('CASHFLOW_YTD')];
 const inputs:FunnelInput[]=companies.map(c=>({symbol:c.symbol,company:c.company,cutoff,through,next_session:date,expected_sessions:dates,
  bars:allBars.filter(b=>b.symbol===c.symbol&&dates.includes(String(b.date))).sort((a,b)=>String(a.date).localeCompare(String(b.date))) as DailyBar[],
  facts:facts.filter(f=>f.symbol===c.symbol) as ResearchFact[],v1_missing:Object.fromEntries(Object.keys(HORIZONS).map(h=>[h,['INDEPENDENT_V1_NOT_EVALUATED']])) as FunnelInput['v1_missing']}));
 // Do not infer reviewed company events from an index, cumulative EPS from a
 // quarter, or adjusted relative/sector returns from raw prices.
 const entry:EntryInput={business_date:date,evaluation_time:cutoff,source_revision:await snapshotHash(valid.map(r=>r.payload_hash)),source_evidence_hash:await snapshotHash(inputs),market,provenance:'REAL_RETAINED',mode:'FORWARD',stocks:inputs.map(i=>{
  const revenue=i.facts.filter(f=>f.kind==='REVENUE').sort((a,b)=>(a.period??'').localeCompare(b.period??'')).at(-1);
  const fundamental=revenue&&typeof revenue.values.yoy_percent==='number'&&typeof revenue.values.mom_percent==='number'?{value:{revenue_yoy:revenue.values.yoy_percent,revenue_mom:revenue.values.mom_percent,eps_actual:null},source_ref:revenue.source,observed_at:revenue.as_of!,available_at:revenue.available_at!}:null;
  return {symbol:i.symbol,name:i.company,bars:i.bars.slice(-20).map(b=>({...b,source_ref:b.source,available_at:b.available_at!})),fundamental,relative_strength:null,sector_return:null,events_reviewed:null,v2_status:null};})};
 const body={inputs,entry,evidence_cutoff:cutoff,...(sourceIssues.length?{source_issues:sourceIssues}:{})};return {...body,snapshot_hash:await snapshotHash(body)};
}
