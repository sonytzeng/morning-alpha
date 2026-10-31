import {buildDailyAiSeed,canonical} from '../../../research/daily-ai-seed.ts';
import {compareTime,hashValid,sourceSafe,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import type {AnalysisEvidence} from '../../../research/daily-ai-analysis.ts';
import type {FunnelInput} from '../../../src/features/vnext/researchFunnel.ts';
import type {StockAnalysisSelector,StoredStockAnalysisBatch} from './handler.ts';
import {MARKET_CALENDAR_VERSION} from '../_shared/market-session-contract.mjs';
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
function officialNewsContent(c:Record<string,unknown>,n:Record<string,unknown>,cutoff:string,oldest:string){
 const keys=['schema','provider','coverage','title','excerpt','excerpt_truncated','source_response_sha256','source_response_bytes','source_received_at','source_metadata'];
 if(Object.keys(c).sort().join('|')!==keys.sort().join('|')||typeof c.title!=='string'||!c.title.trim()||c.title.length>1500
  ||typeof c.excerpt!=='string'||!c.excerpt.trim()||Array.from(c.excerpt).length>2000||typeof c.excerpt_truncated!=='boolean'
  ||typeof c.source_response_sha256!=='string'||!hashValid(c.source_response_sha256)||!Number.isSafeInteger(c.source_response_bytes)
  ||Number(c.source_response_bytes)<1||Number(c.source_response_bytes)>2000000||c.source_received_at!==n.available_at
  ||n.first_seen_at!==n.available_at||n.as_of!==n.available_at)throw Error('AI_INTAKE_NEWS_CONTENT');
 const m=object(c.source_metadata),provider=c.provider;
 if(provider==='FEDERAL_RESERVE_RSS'){
  if(c.coverage!=='OFFICIAL_RSS_TITLE_AND_DESCRIPTION'||n.symbol!==null||typeof n.source!=='string'
   ||!/^https:\/\/www\.federalreserve\.gov\/newsevents\/pressreleases\/[a-z0-9]+\.htm$/.test(n.source)
   ||Object.keys(m).sort().join('|')!==['rss_pub_date_raw','window_basis'].sort().join('|')
   ||m.window_basis!=='EXPLICIT_RSS_GMT_PUBLICATION_TIME'||typeof m.rss_pub_date_raw!=='string'||!m.rss_pub_date_raw.endsWith(' GMT')
   ||typeof n.published_at!=='string'||Date.parse(m.rss_pub_date_raw)!==Date.parse(n.published_at))throw Error('AI_INTAKE_NEWS_CONTENT');
 }else{
  const twse=provider==='TWSE_MOPS_OPEN_DATA',tpex=provider==='TPEX_MOPS_OPEN_DATA';
  const expected=['company_code','company_name','source_export_date_raw','spoken_date_raw','spoken_time_raw','spoken_date_coordinate','spoken_time_coordinate','fact_event_date_raw','publication_timezone','window_basis'];
  if(!twse&&!tpex||n.source!==(twse?'https://openapi.twse.com.tw/v1/opendata/t187ap04_L':'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O')
   ||c.coverage!=='OFFICIAL_ANNOUNCEMENT_EXCERPT'||n.symbol===null||m.company_code!==n.symbol||n.published_at!==null
   ||Object.keys(m).sort().join('|')!==expected.sort().join('|')||typeof m.company_name!=='string'||!m.company_name.trim()||m.company_name.length>200
   ||typeof m.source_export_date_raw!=='string'||!/^\d{7}$/.test(m.source_export_date_raw)||typeof m.spoken_date_raw!=='string'||!/^\d{7}$/.test(m.spoken_date_raw)
   ||typeof m.spoken_time_raw!=='string'||!/^\d{5,6}$/.test(m.spoken_time_raw)||!day(m.spoken_date_coordinate)
   ||m.spoken_date_coordinate>inTaipei(cutoff)||m.spoken_date_coordinate<inTaipei(oldest)
   ||typeof m.spoken_time_coordinate!=='string'||!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(m.spoken_time_coordinate)
   ||m.spoken_time_coordinate!==m.spoken_time_raw.padStart(6,'0').replace(/^(\d\d)(\d\d)(\d\d)$/,'$1:$2:$3')
   ||typeof m.fact_event_date_raw!=='string'||m.fact_event_date_raw.length>100
   ||m.publication_timezone!=='NOT_DECLARED_BY_SOURCE'||m.window_basis!=='SOURCE_DECLARED_DAY_COORDINATE_NOT_EXACT_PUBLICATION_TIME')throw Error('AI_INTAKE_NEWS_CONTENT');
  const coordinate=String(Number(m.spoken_date_raw.slice(0,3))+1911)+'-'+m.spoken_date_raw.slice(3,5)+'-'+m.spoken_date_raw.slice(5,7);
  const exported=String(Number(m.source_export_date_raw.slice(0,3))+1911)+'-'+m.source_export_date_raw.slice(3,5)+'-'+m.source_export_date_raw.slice(5,7);
  if(coordinate!==m.spoken_date_coordinate||!day(exported)||exported<coordinate||exported>inTaipei(cutoff))throw Error('AI_INTAKE_NEWS_CONTENT');
 }
 if(typeof n.id!=='string'||typeof provider!=='string'||!n.id.startsWith('official-news:'+provider+':')
  ||!hashValid(n.id.slice(('official-news:'+provider+':').length)))throw Error('AI_INTAKE_NEWS_CONTENT');
}
async function retainedOwnNewsContent(c:Record<string,unknown>,n:Record<string,unknown>,cutoff:string){
 const sources=['https://ec.ltn.com.tw/article/breakingnews/5624480','https://www.cna.com.tw/news/afe/202610290197.aspx','https://www.esmt.com.tw/en/press-room/2026102703'];
 const keys=['schema','classification','scope','capture_method','original_evidence_id','original_evidence_hash','original_content_hash',
  'original_content_text','original_content','original_published_at','original_available_at','original_first_seen_at','verification_document_hash',
  'reviewer_ref','reviewed_at','source_document_sha256','provenance_document_sha256','verification_method','verification_limits','verification_urls'];
 const fraction=/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/.exec(cutoff)?.[1]??'';
 const oldest=new Date(Date.parse(cutoff)-7*86400000).toISOString().replace(/\.\d{3}Z$/,'.'+fraction.padEnd(6,'0')+'Z');
 if(Object.keys(c).sort().join('|')!==keys.sort().join('|')||typeof n.source!=='string'||!sources.includes(n.source)||c.classification!=='REPORTED_CLAIM'
  ||c.scope!=='RETAINED_BACKGROUND_NOT_FRESH_SOURCE_CAPTURE'||!['INDEPENDENT_WEB_TOOL_FACT_VERIFICATION','RAW_HTTP_VERIFIED_FACT_CAPTURE'].includes(String(c.capture_method))
  ||typeof c.original_evidence_id!=='string'||!c.original_evidence_id||c.original_evidence_id.length>200
  ||typeof c.original_evidence_hash!=='string'||!hashValid(c.original_evidence_hash)||typeof c.original_content_hash!=='string'||!hashValid(c.original_content_hash)
  ||!c.original_content||typeof c.original_content!=='object'||Array.isArray(c.original_content)
  ||typeof c.original_content_text!=='string'||!c.original_content_text||c.original_content_text.length>12000
  ||typeof c.verification_document_hash!=='string'||!hashValid(c.verification_document_hash)
  ||typeof c.reviewer_ref!=='string'||!c.reviewer_ref.trim()||c.reviewer_ref.length>300
  ||typeof c.verification_method!=='string'||!c.verification_method.trim()||c.verification_method.length>500
  ||!Array.isArray(c.verification_limits)||c.verification_limits.length>30||c.verification_limits.some(v=>typeof v!=='string'||!v.trim()||v.length>1500)
  ||!Array.isArray(c.verification_urls)||c.verification_urls.length>30||c.verification_urls.some(v=>typeof v!=='string'||!sourceSafe(v)||v.length>1000)
  ||typeof c.reviewed_at!=='string'||!validObservationTime(c.reviewed_at)||compareTime(c.reviewed_at,cutoff)>0
  ||typeof c.original_published_at!=='string'||typeof c.original_available_at!=='string'||typeof c.original_first_seen_at!=='string'
  ||c.original_published_at!==n.published_at||c.original_available_at!==n.available_at||c.original_first_seen_at!==n.first_seen_at||n.as_of!==n.available_at
  ||compareTime(n.available_at as string,oldest)<0)throw Error('AI_INTAKE_NEWS_CONTENT');
 const original=object(JSON.parse(c.original_content_text as string));
 const actualHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.original_content_text as string))),b=>b.toString(16).padStart(2,'0')).join('');
 if(actualHash!==c.original_content_hash||canonical(original)!==canonical(c.original_content))throw Error('AI_INTAKE_NEWS_CONTENT');
 for(const key of ['source_document_sha256','provenance_document_sha256']){
  if(c[key]!==null&&(typeof c[key]!=='string'||!hashValid(c[key] as string)))throw Error('AI_INTAKE_NEWS_CONTENT');
 }
 if(n.id!=='retained-own-news:'+n.evidence_hash)throw Error('AI_INTAKE_NEWS_CONTENT');
}
export async function parseDailyAiSourceSnapshot(value:unknown,cutoff:string,signal:AbortSignal,kind:'HANDOFF'|'INTAKE'='HANDOFF'){
 const h=object(value);
 const correctedNewsPolicy=kind==='INTAKE'&&Array.isArray(h.intake_gaps)&&h.intake_gaps.includes('NEWS_SOURCE_POLICY_GNEWS_EXCLUDED');
 const requiredNewsGaps=correctedNewsPolicy?['NEWS_SOURCE_POLICY_GNEWS_EXCLUDED','OFFICIAL_NEWS_FIXED_FEEDS_NOT_ALL_COMPANY_OR_MARKET_NEWS',
  'MOPS_PUBLICATION_TIMEZONE_UNDECLARED_RECEIPT_BASIS_ONLY','OFFICIAL_NEWS_EXCERPT_NOT_FULL_DISCLOSURE','FED_RSS_NOT_EQUITY_CLOSE_OR_COMPLETE_MACRO_COVERAGE',
  'OFFICIAL_NEWS_SNAPSHOT_COMPANY_LIMIT_12_GLOBAL_LIMIT_4']:['NEWS_PROVIDER_EXCERPTS_ONLY_NOT_FULL_ARTICLE','NEWS_CANONICAL_POOL_LIMIT_500_NOT_ALL_NEWS'];
 if(kind==='HANDOFF'?(h.schema!=='DAILY_AI_SOURCE_HANDOFF_V1'||typeof h.handoff_id!=='string'||!hashValid(h.handoff_id)||!intakeUuid(h.source_run_id)):
  (h.schema!=='DAILY_AI_INTAKE_SOURCE_V1'||h.state!=='SOURCED'||!intakeUuid(h.intake_id)||!intakeUuid(h.lease)
   ||typeof h.snapshot_hash!=='string'||!hashValid(h.snapshot_hash)
   ||!intakeUuid(h.source_id)||!['VNEXT_ACQUIRED','ASOF_INTAKE'].includes(String(h.source_kind))))throw Error('AI_INTAKE_HANDOFF_INVALID');
 if(typeof h.source_revision!=='string'||!hashValid(h.source_revision)||!day(h.business_date)
  ||h.projection!=='DAILY_AI_RETAINED_INPUT_PROJECTION_V1'
  ||typeof h.source_cutoff!=='string'||!validObservationTime(h.source_cutoff)||!day(h.source_business_date)
  ||h.source_business_date!==inTaipei(h.source_cutoff)||compareTime(h.source_cutoff,cutoff)>0||h.business_date!==inTaipei(cutoff)
  ||h.cutoff!==cutoff||!validObservationTime(cutoff)||h.member_published!==false
  ||!Array.isArray(h.inputs)||h.inputs.length!==72||!Array.isArray(h.news)||h.news.length>868||!Array.isArray(h.market)||h.market.length>2
  ||kind==='HANDOFF'&&h.market.length!==0
  ||!Array.isArray(h.source_issues)||h.source_issues.length>1600||!Array.isArray(h.intake_gaps)
  ||h.intake_gaps.length>64||h.intake_gaps.some(g=>!code(g))||new Set(h.intake_gaps).size!==h.intake_gaps.length
  ||!h.intake_gaps.includes('RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED')||!h.intake_gaps.includes('NEWS_SNAPSHOT_TOTAL_LIMIT_1500000_BYTES')
  ||requiredNewsGaps.some(g=>!(h.intake_gaps as unknown[]).includes(g))
  ||!h.market.length&&!h.intake_gaps.includes('MARKET_IMMUTABLE_AS_OF_SNAPSHOT_UNAVAILABLE')
  ||!h.news.length&&!h.intake_gaps.includes('NEWS_NONE_AVAILABLE_WITHIN_48H'))throw Error('AI_INTAKE_HANDOFF_INVALID');
 if(kind==='INTAKE'&&(['INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY']
  .some(g=>!(h.intake_gaps as unknown[]).includes(g))||!['FINANCIAL_DATA_RETAINED_NOT_REFRESHED','FINANCIAL_RETAINED_OBSERVATIONS_MAY_BE_STALE']
  .some(g=>(h.intake_gaps as unknown[]).includes(g))))throw Error('AI_INTAKE_LIMITATIONS_MISSING');
 let inputBytes=2;
 const inputs=h.inputs.map(value=>{
  const i=object(value);
  inputBytes+=new TextEncoder().encode(JSON.stringify(i)).byteLength+1;if(inputBytes>8000000)throw Error('AI_INTAKE_INPUT_LIMIT');
  if(typeof i.symbol!=='string'||!/^\d{4,6}$/.test(i.symbol)||typeof i.company!=='string'||!i.company.trim()||i.company.length>100
   ||i.cutoff!==(kind==='HANDOFF'?h.source_cutoff:cutoff)
   ||!Array.isArray(i.bars)||i.bars.length>400||!Array.isArray(i.facts)||i.facts.length>1000
   ||!Array.isArray(i.expected_sessions)||i.expected_sessions.length>400)throw Error('AI_INTAKE_INPUT_INVALID');
  if(i.facts.some(value=>{const fact=object(value);return typeof fact.source==='string'&&restrictedFinancialSource(fact.source);}))throw Error('AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE');
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
   ||typeof n.available_at!=='string'||!validObservationTime(n.available_at)||compareTime(n.available_at,cutoff)>0
   ||typeof n.first_seen_at!=='string'||!validObservationTime(n.first_seen_at)||compareTime(n.first_seen_at,n.available_at)>0
   ||typeof n.as_of!=='string'||!validObservationTime(n.as_of)||compareTime(n.as_of,n.available_at)>0
   ||n.published_at!==null&&(typeof n.published_at!=='string'||!validObservationTime(n.published_at)||compareTime(n.published_at,n.available_at)>0)
   ||n.time_basis!==(n.published_at===null?'OBSERVED_AFTER_RECEIPT':'PUBLISHED')
   ||kind==='HANDOFF'&&(n.published_at===null||n.available_at!==cutoff||n.first_seen_at!==cutoff||n.as_of!==cutoff)
   ||typeof n.evidence_hash!=='string'||!hashValid(n.evidence_hash)||typeof n.content!=='string'||n.content.length>12000)throw Error('AI_INTAKE_NEWS_INVALID');
  const symbol=n.symbol as string|null,key=(symbol??'GLOBAL')+':'+n.id,count=(perSymbol.get(symbol)??0)+1;
  if(seen.has(key)||count>(symbol===null?4:12))throw Error('AI_INTAKE_NEWS_SCOPE');seen.add(key);perSymbol.set(symbol,count);
  const c=object(JSON.parse(n.content));
  if(restrictedNewsSource(n.source,c))throw Error('AI_INTAKE_RESTRICTED_NEWS_SOURCE');
  if(c.schema==='DAILY_AI_RETAINED_OWN_NEWS_FACT_V1'){
   if(!correctedNewsPolicy||!h.intake_gaps.includes('OWN_FACTS_RETAINED_BACKGROUND_NOT_FRESH_NEWS'))throw Error('AI_INTAKE_NEWS_CONTENT');
   await retainedOwnNewsContent(c,n,cutoff);stopped(signal);
  }else if(compareTime((n.published_at??n.available_at) as string,oldest)<0)throw Error('AI_INTAKE_NEWS_INVALID');
  if(c.schema==='DAILY_AI_OFFICIAL_NEWS_FACT_V1')officialNewsContent(c,n,cutoff,oldest);
  else if(c.schema==='DAILY_AI_RETAINED_OWN_NEWS_FACT_V1'){/* Validated as explicitly retained background above. */}
  else if(Object.keys(c).sort().join('|')!==['coverage','title','provider_excerpt','source_name','provider','first_ingested_at','original_fingerprint'].sort().join('|')
   ||c.coverage!=='HEADLINE_AND_PROVIDER_EXCERPT'||typeof c.title!=='string'||!c.title.trim()||c.title.length>1000
   ||typeof c.provider_excerpt!=='string'||c.provider_excerpt.length>6000||typeof c.source_name!=='string'||!c.source_name.trim()||c.source_name.length>300
   ||typeof c.provider!=='string'||!c.provider.trim()||c.provider.length>100||typeof c.original_fingerprint!=='string'||!hashValid(c.original_fingerprint)
   ||typeof c.first_ingested_at!=='string'||!validObservationTime(c.first_ingested_at)||compareTime(c.first_ingested_at,cutoff)>0)throw Error('AI_INTAKE_NEWS_CONTENT');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(n.content))),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==n.evidence_hash)throw Error('AI_INTAKE_NEWS_HASH');
  news.push({id:n.id,symbol,kind:'NEWS',source:n.source,published_at:n.published_at as string|null,available_at:n.available_at,
   first_seen_at:n.first_seen_at,as_of:n.as_of,time_basis:n.time_basis as 'PUBLISHED'|'OBSERVED_AFTER_RECEIPT',evidence_hash:n.evidence_hash,content:n.content});
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
 if(!Array.isArray(value)||value.length>2||new TextEncoder().encode(JSON.stringify(value)).byteLength>80000)throw Error('AI_INTAKE_MARKET_LIMIT');
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
  const c=object(JSON.parse(e.content)),url=new URL(e.source),parameters=[...url.searchParams.keys()];
  const researchMonth=day(c.research_business_date)?c.research_business_date.slice(0,7).replace('-',''):'';
  const priorMonth=day(c.research_business_date)?new Date(Date.parse(c.research_business_date.slice(0,7)+'-01T00:00:00Z')-86400000).toISOString().slice(0,7).replace('-',''):'';
  const observationMonth=day(c.session_date)?c.session_date.slice(0,7).replace('-',''):'';
  const treasury=[researchMonth,priorMonth].includes(observationMonth)&&observationMonth!==''
   &&e.source==='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month='+observationMonth;
  const nightHtml=url.origin==='https://www.taifex.com.tw'&&url.pathname==='/cht/3/futDailyMarketReport'
   &&parameters.length===4&&new Set(parameters).size===4
   &&url.searchParams.get('queryType')==='2'&&url.searchParams.get('marketCode')==='1'&&url.searchParams.get('commodity_id')==='TX'
   &&typeof c.trading_date==='string'&&url.searchParams.get('queryDate')===c.trading_date.replaceAll('-','/');
  const night=e.source==='https://openapi.taifex.com.tw/v1/DailyMarketReportFut'||nightHtml;
  if(!treasury&&!night)throw Error('AI_INTAKE_MARKET_SOURCE');
  if(c.schema!=='DAILY_AI_GLOBAL_MARKET_FACT_V1'||c.native_symbol!==(night?'TX':'UST_PAR_YIELD_CURVE')
   ||c.kind!==(night?'TAIWAN_NIGHT_FUTURE':'US_TREASURY_PAR_YIELD_CURVE')||c.market!==(night?'TW':'US')
   ||c.session!==(night?'AFTERHOURS':'DAILY_OBSERVATION')||c.currency!==(night?'TWD':'USD')||c.unit!==(night?'INDEX_POINTS':'PERCENT')
   ||c.freshness!==(night?'LATEST_COMPLETED_SESSION':'LATEST_AVAILABLE_TREASURY_OBSERVATION')
   ||c.timestamp_basis!=='RECEIPT_ONLY_PUBLICATION_UNKNOWN'||c.received_at!==e.available_at
   ||!day(c.research_business_date)||c.research_business_date!==inTaipei(cutoff)||!day(c.session_date)||!day(c.trading_date)
   ||c.session_date>inTaipei(e.available_at)||typeof c.source_response_sha256!=='string'||!hashValid(c.source_response_sha256)
   ||!Number.isSafeInteger(c.source_response_bytes)||Number(c.source_response_bytes)<1||Number(c.source_response_bytes)>2000000
   ||c.calendar_version!==(night?MARKET_CALENDAR_VERSION:'TREASURY_XML_ACTUAL_DATES_V1'))throw Error('AI_INTAKE_MARKET_CONTENT');
  const common=['schema','kind','native_symbol','market','session','session_date','trading_date','currency','unit',
   'comparison_basis','research_business_date','freshness','timestamp_basis','calendar_version','received_at','source_response_sha256','source_response_bytes'];
  const extras=night?['close','change_points','change_percent','native_contract','contract_month','session_ended_on','scheduled_session_start','scheduled_session_end','trading_date_basis','change_reference_value','contract_selection']:
   ['rate_model','yield_2y','yield_10y','yield_30y','prior_yield_2y','prior_yield_10y','prior_yield_30y','change_2y_bp','change_10y_bp','change_30y_bp','prior_session_date','source_row_date_basis','observation_date_coordinate','observation_age_calendar_days'];
  if(Object.keys(c).sort().join('|')!==[...common,...extras].sort().join('|')||e.id!=='global:'+(night?'TX':'TREASURY')+':'+c.session_date)throw Error('AI_INTAKE_MARKET_CONTENT');
  if(treasury){
   const age=(Date.parse(inNewYork(e.available_at)+'T00:00:00Z')-Date.parse(c.session_date+'T00:00:00Z'))/86400000;
   if(c.trading_date!==c.session_date||c.comparison_basis!=='PREVIOUS_AVAILABLE_TREASURY_OBSERVATION'
    ||c.rate_model!=='NOMINAL_CONSTANT_MATURITY_PAR_YIELD'||c.source_row_date_basis!=='NEW_DATE_DATE_COORDINATE_NOT_PUBLICATION'
    ||c.observation_date_coordinate!==c.session_date+'T00:00:00'||!Number.isInteger(c.observation_age_calendar_days)
    ||c.observation_age_calendar_days!==age||age<0||age>7)throw Error('AI_INTAKE_MARKET_TREASURY');
   const tenors=['2y','10y','30y'];
   for(const tenor of tenors){const rate=c['yield_'+tenor];if(typeof rate!=='number'||!Number.isFinite(rate)||Math.abs(rate)>100)throw Error('AI_INTAKE_MARKET_TREASURY');}
   if(c.prior_session_date===null){
    if(tenors.some(tenor=>c['prior_yield_'+tenor]!==null||c['change_'+tenor+'_bp']!==null))throw Error('AI_INTAKE_MARKET_TREASURY');
   }else{
    if(!day(c.prior_session_date)||c.prior_session_date>=c.session_date)throw Error('AI_INTAKE_MARKET_TREASURY');
    for(const tenor of tenors){const prior=c['prior_yield_'+tenor],change=c['change_'+tenor+'_bp'];
     if(typeof prior!=='number'||!Number.isFinite(prior)||Math.abs(prior)>100||typeof change!=='number'||!Number.isFinite(change)
      ||Math.abs(change-(Number(c['yield_'+tenor])-prior)*100)>1e-7)throw Error('AI_INTAKE_MARKET_TREASURY');
    }
   }
  }
  if(night){
   const expected=dailyAiExpectedTaiwanNight(e.available_at);
   if(!expected||Object.entries(expected).some(([key,value])=>c[key]!==value)||c.comparison_basis!=='TAIFEX_REPORTED_OPENING_REFERENCE'
    ||c.trading_date_basis!=='TAIFEX_NEXT_REGULAR_SESSION_ATTRIBUTION'||c.contract_selection!=='NEAREST_MONTH_PRESENT_IN_OFFICIAL_COMPLETED_SESSION'
    ||typeof c.close!=='number'||!Number.isFinite(c.close)||c.close<=0||typeof c.change_points!=='number'||!Number.isFinite(c.change_points)
    ||typeof c.change_percent!=='number'||!Number.isFinite(c.change_percent)
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
 if(retained!==null){rejectRestrictedAnalysisSources(retained);return retained as StoredStockAnalysisBatch;}
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
 rejectRestrictedAnalysisSources(loaded);
 // The handler revalidates all 72 packets and source times before any model.
 return loaded as StoredStockAnalysisBatch;
}
/** Apply the commercial source restriction to already retained V1 batches too;
 * changing the collector alone must not allow an old queued packet to run. */
function restrictedFinancialSource(source:string){
 try{const host=new URL(source).hostname;return ['tsmc.com','mediatek.com','honhai.com'].some(domain=>host===domain||host.endsWith('.'+domain));}
 catch{return false;}
}
function restrictedNewsSource(source:string,content:Record<string,unknown>){
 let host='';try{host=new URL(source).hostname;}catch{/* Source validity is checked separately. */}
 return host==='udn.com'||host.endsWith('.udn.com')||typeof content.provider==='string'&&content.provider.toUpperCase()==='GNEWS';
}
function rejectRestrictedAnalysisSources(value:unknown){
 const batch=object(value);if(!Array.isArray(batch.packets))return;
 for(const value of batch.packets){const packet=object(value);if(!Array.isArray(packet.evidence))continue;
  for(const value of packet.evidence){const e=object(value);if(typeof e.source!=='string')continue;
   if(e.kind==='FINANCIAL'&&restrictedFinancialSource(e.source))throw Error('AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE');
   if(e.kind==='NEWS'){
    let content:Record<string,unknown>={};
    try{const parsed=JSON.parse(String(e.content));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))content=parsed as Record<string,unknown>;}catch{/* Older plain-text evidence has no provider field. */}
    if(restrictedNewsSource(e.source,content))throw Error('AI_INTAKE_RESTRICTED_NEWS_SOURCE');
   }
   if(e.kind!=='MARKET')continue;
   let hostname='';try{hostname=new URL(e.source).hostname;}catch{continue;}
   if(hostname==='yahoo.com'||hostname.endsWith('.yahoo.com'))throw Error('AI_INTAKE_RESTRICTED_MARKET_SOURCE');
  }
 }
}
