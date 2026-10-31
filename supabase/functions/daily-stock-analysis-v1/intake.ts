import {buildDailyAiSeed} from '../../../research/daily-ai-seed.ts';
import {compareTime,hashValid,sourceSafe,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import type {AnalysisEvidence} from '../../../research/daily-ai-analysis.ts';
import type {FunnelInput} from '../../../src/features/vnext/researchFunnel.ts';
import type {StockAnalysisSelector,StoredStockAnalysisBatch} from './handler.ts';
import {MARKET_CALENDAR_VERSION,latestCompletedUsSession,previousMarketTradingDate} from '../_shared/market-session-contract.mjs';
import {dailyAiExpectedTaiwanNight} from '../../../research/daily-ai-global-market.ts';

type Rpc=(name:string,args:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>;
const object=(v:unknown):Record<string,unknown>=>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('AI_INTAKE_HANDOFF_INVALID');return v as Record<string,unknown>;
};
const day=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)
 &&validObservationTime(value+'T00:00:00Z');
const code=(value:unknown):value is string=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value);
export const intakeUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('AI_INTAKE_ABORTED');};
const inTaipei=(time:string)=>new Date(Date.parse(time)+8*3600000).toISOString().slice(0,10);
const nyCalendar=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const inNewYork=(time:string)=>{
 const parts=nyCalendar.formatToParts(new Date(time)),part=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 return part('year')+'-'+part('month')+'-'+part('day');
};
export async function parseDailyAiSourceSnapshot(value:unknown,cutoff:string,signal:AbortSignal,kind:'HANDOFF'|'INTAKE'='HANDOFF'){
 const h=object(value);
 if(kind==='HANDOFF'?(h.schema!=='DAILY_AI_SOURCE_HANDOFF_V1'||typeof h.handoff_id!=='string'||!hashValid(h.handoff_id)||!intakeUuid(h.source_run_id)):
  (h.schema!=='DAILY_AI_INTAKE_SOURCE_V1'||h.state!=='SOURCED'||!intakeUuid(h.intake_id)||!intakeUuid(h.lease)
   ||typeof h.snapshot_hash!=='string'||!hashValid(h.snapshot_hash)
   ||!intakeUuid(h.source_id)||!['VNEXT_ACQUIRED','ASOF_INTAKE'].includes(String(h.source_kind))))throw Error('AI_INTAKE_HANDOFF_INVALID');
 if(typeof h.source_revision!=='string'||!hashValid(h.source_revision)||!day(h.business_date)
  ||h.projection!=='DAILY_AI_RETAINED_INPUT_PROJECTION_V1'
  ||typeof h.source_cutoff!=='string'||!validObservationTime(h.source_cutoff)||!day(h.source_business_date)
  ||h.source_business_date!==inTaipei(h.source_cutoff)||compareTime(h.source_cutoff,cutoff)>0||h.business_date!==inTaipei(cutoff)
  ||h.cutoff!==cutoff||!validObservationTime(cutoff)||h.member_published!==false
  ||!Array.isArray(h.inputs)||h.inputs.length!==72||!Array.isArray(h.news)||h.news.length>868||!Array.isArray(h.market)||h.market.length>4
  ||kind==='HANDOFF'&&h.market.length!==0
  ||!Array.isArray(h.source_issues)||h.source_issues.length>1600||!Array.isArray(h.intake_gaps)
  ||h.intake_gaps.length>64||h.intake_gaps.some(g=>!code(g))||new Set(h.intake_gaps).size!==h.intake_gaps.length
  ||!h.intake_gaps.includes('RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED')||!h.intake_gaps.includes('NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES')
  ||!h.intake_gaps.includes('NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE')||!h.intake_gaps.includes('NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS')
  ||!h.market.length&&!h.intake_gaps.includes('MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE')
  ||!h.news.length&&!h.intake_gaps.includes('NEWS_NONE_AVAILABLE_WITHIN_48H'))throw Error('AI_INTAKE_HANDOFF_INVALID');
 if(kind==='INTAKE'&&['FINANCIAL_DATA_RETAINED_NOT_REFRESHED','INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY']
  .some(g=>!(h.intake_gaps as unknown[]).includes(g)))throw Error('AI_INTAKE_LIMITATIONS_MISSING');
 let inputBytes=2;
 const inputs=h.inputs.map(value=>{
  const i=object(value);
  inputBytes+=new TextEncoder().encode(JSON.stringify(i)).byteLength+1;if(inputBytes>8000000)throw Error('AI_INTAKE_INPUT_LIMIT');
  if(typeof i.symbol!=='string'||!/^\d{4,6}$/.test(i.symbol)||typeof i.company!=='string'||!i.company.trim()||i.company.length>100
   ||i.cutoff!==(kind==='HANDOFF'?h.source_cutoff:cutoff)
   ||!Array.isArray(i.bars)||i.bars.length>400||!Array.isArray(i.facts)||i.facts.length>1000
   ||!Array.isArray(i.expected_sessions)||i.expected_sessions.length>400)throw Error('AI_INTAKE_INPUT_INVALID');
  return i as unknown as FunnelInput;
 });
 if(new Set(inputs.map(i=>i.symbol)).size!==72)throw Error('AI_INTAKE_INPUT_INVALID');
 const universe=new Set(inputs.map(i=>i.symbol)),perSymbol=new Map<string|null,number>(),seen=new Set<string>(),news:AnalysisEvidence[]=[];
 if(new TextEncoder().encode(JSON.stringify(h.news)).byteLength>1500000)throw Error('AI_INTAKE_NEWS_LIMIT');
 const fraction=/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/.exec(cutoff)?.[1]??'';
 const oldest=new Date(Date.parse(cutoff)-48*3600000).toISOString().replace(/\.\d{3}Z$/,'.'+fraction.padEnd(6,'0')+'Z');
 for(const value of h.news){
  stopped(signal);const n=object(value);
  if(typeof n.id!=='string'||!n.id||n.id.length>200||n.kind!=='NEWS'
   ||n.symbol!==null&&(typeof n.symbol!=='string'||!universe.has(n.symbol))||typeof n.source!=='string'||!sourceSafe(n.source)
   ||typeof n.published_at!=='string'||!validObservationTime(n.published_at)||compareTime(n.published_at,cutoff)>0||compareTime(n.published_at,oldest)<0
   ||n.available_at!==cutoff||n.first_seen_at!==cutoff||n.as_of!==cutoff||n.time_basis!=='PUBLISHED'
   ||typeof n.evidence_hash!=='string'||!hashValid(n.evidence_hash)||typeof n.content!=='string'||n.content.length>12000)throw Error('AI_INTAKE_NEWS_INVALID');
  const symbol=n.symbol as string|null,key=(symbol??'GLOBAL')+':'+n.id,count=(perSymbol.get(symbol)??0)+1;
  if(seen.has(key)||count>(symbol===null?4:12))throw Error('AI_INTAKE_NEWS_SCOPE');seen.add(key);perSymbol.set(symbol,count);
  const c=object(JSON.parse(n.content));
  if(Object.keys(c).sort().join('|')!==['coverage','title','provider_excerpt','source_name','provider','first_ingested_at','original_fingerprint'].sort().join('|')
   ||c.coverage!=='HEADLINE_AND_PROVIDER_EXCERPT'||typeof c.title!=='string'||!c.title.trim()||c.title.length>1000
   ||typeof c.provider_excerpt!=='string'||c.provider_excerpt.length>6000||typeof c.source_name!=='string'||!c.source_name.trim()||c.source_name.length>300
   ||typeof c.provider!=='string'||!c.provider.trim()||c.provider.length>100||typeof c.original_fingerprint!=='string'||!hashValid(c.original_fingerprint)
   ||typeof c.first_ingested_at!=='string'||!validObservationTime(c.first_ingested_at)||compareTime(c.first_ingested_at,cutoff)>0)throw Error('AI_INTAKE_NEWS_CONTENT');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(n.content))),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==n.evidence_hash)throw Error('AI_INTAKE_NEWS_HASH');
  news.push({id:n.id,symbol,kind:'NEWS',source:n.source,published_at:n.published_at,available_at:cutoff,
   first_seen_at:cutoff,as_of:cutoff,time_basis:'PUBLISHED',evidence_hash:n.evidence_hash,content:n.content});
 }
 const issueGaps=h.source_issues.map(value=>{
  const i=object(value);
  if(!code(i.kind)||!code(i.reason)||typeof i.key!=='string'||!/^[A-Za-z0-9_:.-]{1,200}$/.test(i.key))throw Error('AI_INTAKE_ISSUE_INVALID');
  // Keys identify private requests. Only normalized issue codes reach the AI.
  return 'SOURCE_INGEST_'+i.kind+'_'+i.reason;
 });
 const projection='DAILY_AI_RETAINED_INPUT_PROJECTION_V1' as const;
 const original={source_revision:h.source_revision,source_cutoff:h.source_cutoff,source_business_date:h.source_business_date,projection};
 const gapsBySymbol:Record<string,string[]>={};
 if(kind==='INTAKE'&&h.gaps_by_symbol!==undefined){
  const gaps=object(h.gaps_by_symbol);
  if(Object.keys(gaps).length!==0&&Object.keys(gaps).length!==72)throw Error('AI_INTAKE_SYMBOL_GAPS');
  for(const [symbol,values] of Object.entries(gaps)){
   if(!universe.has(symbol)||!Array.isArray(values)||values.length>20||values.some(g=>!code(g)))throw Error('AI_INTAKE_SYMBOL_GAPS');
   gapsBySymbol[symbol]=values as string[];
  }
 }
 const market=await parseDailyAiMarketEvidence(h.market,cutoff,signal);
 return {inputs,news,market,additionalGaps:[...h.intake_gaps as string[],...new Set(issueGaps)],gapsBySymbol,
  ...(kind==='HANDOFF'?{sourceHandoff:{...original,handoff_id:h.handoff_id as string,source_run_id:h.source_run_id as string}}:
   {sourceIntake:{...original,intake_id:h.intake_id as string,source_kind:h.source_kind as 'VNEXT_ACQUIRED'|'ASOF_INTAKE',source_id:h.source_id as string,snapshot_hash:h.snapshot_hash as string}})};
}
/** Retained market observations remain global context; no stock-specific
 * beneficiary or a missing night session can be manufactured from them. */
export async function parseDailyAiMarketEvidence(value:unknown,cutoff:string,signal:AbortSignal):Promise<AnalysisEvidence[]>{
 if(!Array.isArray(value)||value.length>4||new TextEncoder().encode(JSON.stringify(value)).byteLength>80000)throw Error('AI_INTAKE_MARKET_LIMIT');
 const ids=new Set<string>(),result:AnalysisEvidence[]=[];
 for(const item of value){
  stopped(signal);const e=object(item);
  if(typeof e.id!=='string'||!e.id.trim()||e.id.length>200||ids.has(e.id)||e.kind!=='MARKET'||e.symbol!==null
   ||typeof e.source!=='string'||!sourceSafe(e.source)||typeof e.content!=='string'||!e.content.trim()||e.content.length>12000
   ||typeof e.available_at!=='string'||!validObservationTime(e.available_at)||compareTime(e.available_at,cutoff)>0
   ||typeof e.first_seen_at!=='string'||!validObservationTime(e.first_seen_at)||compareTime(e.first_seen_at,e.available_at)>0
   ||typeof e.as_of!=='string'||!validObservationTime(e.as_of)||compareTime(e.as_of,e.available_at)>0
   ||typeof e.evidence_hash!=='string'||!hashValid(e.evidence_hash))throw Error('AI_INTAKE_MARKET_INVALID');
  if(e.published_at!==null||e.time_basis!=='OBSERVED_AFTER_RECEIPT'||e.first_seen_at!==e.available_at||e.as_of!==e.available_at)throw Error('AI_INTAKE_MARKET_TIME');
  const usSources=new Map(['^IXIC','^SOX','^GSPC'].map(symbol=>['https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=1mo',symbol]));
  const c=object(JSON.parse(e.content)),url=new URL(e.source),parameters=[...url.searchParams.keys()];
  const nightHtml=url.origin==='https://www.taifex.com.tw'&&url.pathname==='/cht/3/futDailyMarketReport'
   &&parameters.length===4&&new Set(parameters).size===4
   &&url.searchParams.get('queryType')==='2'&&url.searchParams.get('marketCode')==='1'&&url.searchParams.get('commodity_id')==='TX'
   &&typeof c.trading_date==='string'&&url.searchParams.get('queryDate')===c.trading_date.replaceAll('-','/');
  const instrument=usSources.get(e.source),night=e.source==='https://openapi.taifex.com.tw/v1/DailyMarketReportFut'||nightHtml;
  if(!instrument&&!night)throw Error('AI_INTAKE_MARKET_SOURCE');
  if(c.schema!=='DAILY_AI_GLOBAL_MARKET_FACT_V1'||c.native_symbol!==(night?'TX':instrument)||c.kind!==(night?'TAIWAN_NIGHT_FUTURE':'US_CASH_INDEX')
   ||c.market!==(night?'TW':'US')||c.session!==(night?'AFTERHOURS':'REGULAR')||c.currency!==(night?'TWD':'USD')||c.unit!=='INDEX_POINTS'
   ||c.freshness!=='LATEST_COMPLETED_SESSION'||c.timestamp_basis!=='RECEIPT_ONLY_PUBLICATION_UNKNOWN'||c.received_at!==e.available_at
   ||!day(c.research_business_date)||c.research_business_date!==inTaipei(cutoff)||!day(c.session_date)||!day(c.trading_date)
   ||c.session_date>inTaipei(e.available_at)||typeof c.close!=='number'||!Number.isFinite(c.close)||c.close<=0
   ||typeof c.change_points!=='number'||!Number.isFinite(c.change_points)||typeof c.change_percent!=='number'||!Number.isFinite(c.change_percent)
   ||typeof c.comparison_basis!=='string'||!c.comparison_basis.trim()||c.comparison_basis.length>150
   ||typeof c.source_response_sha256!=='string'||!hashValid(c.source_response_sha256)||!Number.isSafeInteger(c.source_response_bytes)
   ||Number(c.source_response_bytes)<1||Number(c.source_response_bytes)>2000000||c.calendar_version!==MARKET_CALENDAR_VERSION)throw Error('AI_INTAKE_MARKET_CONTENT');
  const common=['schema','kind','native_symbol','market','session','session_date','trading_date','currency','unit','close','change_points','change_percent',
   'comparison_basis','research_business_date','freshness','timestamp_basis','calendar_version','received_at','source_response_sha256','source_response_bytes'];
  const extras=night?['native_contract','contract_month','session_ended_on','scheduled_session_start','scheduled_session_end','trading_date_basis','change_reference_value','contract_selection']:
   ['prior_close','prior_session_date','source_bar_at','prior_bar_at','bar_timestamp_basis'];
  if(Object.keys(c).sort().join('|')!==[...common,...extras].sort().join('|')||e.id!=='global:'+(night?'TX':instrument?.slice(1))+':'+c.session_date)throw Error('AI_INTAKE_MARKET_CONTENT');
  if(!night&&(c.trading_date!==c.session_date||!day(c.prior_session_date)||c.prior_session_date>=c.session_date
   ||c.calendar_version!==MARKET_CALENDAR_VERSION||c.session_date!==latestCompletedUsSession(Date.parse(e.available_at))
   ||c.prior_session_date!==previousMarketTradingDate('US',c.session_date)
   ||typeof c.prior_close!=='number'||!Number.isFinite(c.prior_close)||c.prior_close<=0
   ||typeof c.source_bar_at!=='string'||!validObservationTime(c.source_bar_at)||compareTime(c.source_bar_at,e.available_at)>0
   ||typeof c.prior_bar_at!=='string'||!validObservationTime(c.prior_bar_at)||compareTime(c.prior_bar_at,c.source_bar_at)>=0
   ||inNewYork(c.source_bar_at)!==c.session_date||inNewYork(c.prior_bar_at)!==c.prior_session_date))throw Error('AI_INTAKE_MARKET_CONTENT');
  if(!night&&(c.comparison_basis!=='PREVIOUS_COMPLETED_US_CASH_SESSION_CLOSE'||c.bar_timestamp_basis!=='PROVIDER_DAILY_BAR_TIME_NOT_PUBLICATION'
   ||Math.abs(Number(c.change_points)-(c.close-Number(c.prior_close)))>1e-8
   ||Math.abs(c.change_percent-Math.round(Number(c.change_points)/Number(c.prior_close)*100*1000000)/1000000)>1e-8))throw Error('AI_INTAKE_MARKET_VALUES');
  if(night){
   const expected=dailyAiExpectedTaiwanNight(e.available_at);
   if(!expected||Object.entries(expected).some(([key,value])=>c[key]!==value)||c.comparison_basis!=='TAIFEX_REPORTED_OPENING_REFERENCE'
    ||c.trading_date_basis!=='TAIFEX_NEXT_REGULAR_SESSION_ATTRIBUTION'||c.contract_selection!=='NEAREST_MONTH_PRESENT_IN_OFFICIAL_COMPLETED_SESSION'
    ||typeof c.contract_month!=='string'||!/^\d{6}$/.test(c.contract_month)||c.contract_month<c.session_date.slice(0,7).replace('-','')
    ||c.native_contract!=='TX'+c.contract_month||typeof c.change_reference_value!=='number'||!Number.isFinite(c.change_reference_value)||c.change_reference_value<=0
    ||Math.abs(c.change_reference_value-(c.close-c.change_points))>1e-8
    ||Math.abs(c.change_points/c.change_reference_value*100-c.change_percent)>.011)throw Error('AI_INTAKE_MARKET_NIGHT');
  }
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(e.content))),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==e.evidence_hash)throw Error('AI_INTAKE_MARKET_HASH');ids.add(e.id);
  result.push({id:e.id,symbol:null,kind:'MARKET',source:e.source,published_at:e.published_at as string|null,available_at:e.available_at,
   first_seen_at:e.first_seen_at,as_of:e.as_of,evidence_hash:e.evidence_hash,time_basis:e.time_basis as 'PUBLISHED'|'OBSERVED_AFTER_RECEIPT',content:e.content});
 }
 return result;
}
/** Only an exact immutable server handoff may create a missing daily batch.
 * Every query, canonical hash and write remains in the handler's load budget. */
export async function loadOrIntakeDailyStockAiBatch(selector:StockAnalysisSelector,rpc:Rpc,signal:AbortSignal):Promise<StoredStockAnalysisBatch|null>{
 stopped(signal);
 const args='batch_id' in selector?{p_batch_id:selector.batch_id,p_cutoff:null}:{p_batch_id:null,p_cutoff:selector.cutoff};
 const retained=await rpc('load_daily_stock_ai_batch_v1',args,signal);stopped(signal);
 if(retained!==null)return retained as StoredStockAnalysisBatch;
 if(!('cutoff' in selector))return null;
 const raw=await rpc('load_daily_stock_ai_handoff_v1',{p_cutoff:selector.cutoff},signal);stopped(signal);
 if(raw===null)return null;
 const handoff=await parseDailyAiSourceSnapshot(raw,selector.cutoff,signal);stopped(signal);
 const seed=await buildDailyAiSeed({...handoff,cutoff:selector.cutoff,signal});stopped(signal);
 const saved=object(await rpc('store_daily_stock_ai_batch_v1',{p_text:seed.payload_text,p_hash:seed.metadata.payload_hash},signal));stopped(signal);
 if(saved.state!=='STORED'||saved.batch_id!==seed.metadata.payload_hash||saved.packets!==72||saved.member_published!==false)throw Error('AI_INTAKE_SAVE_UNCONFIRMED');
 const loaded=await rpc('load_daily_stock_ai_batch_v1',{p_batch_id:seed.metadata.payload_hash,p_cutoff:null},signal);stopped(signal);
 if(loaded===null)throw Error('AI_INTAKE_RELOAD_UNCONFIRMED');
 const batch=object(loaded);
 if(batch.id!==seed.metadata.payload_hash||batch.cutoff!==selector.cutoff)throw Error('AI_INTAKE_RELOAD_MISMATCH');
 // The handler revalidates all 72 packets and source times before any model.
 return loaded as StoredStockAnalysisBatch;
}
