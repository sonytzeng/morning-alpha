/** Bounded, versioned member projection for the full Taiwan equity universe.
 * This module does not call an RPC, load drafts, calculate a price or grant
 * membership/publication. A future reader must rerun its existing server gates.
 * Cursor hashes bind a position to its read scope; they are not auth signatures.
 */
import {HORIZONS,compareTime,hashValid,snapshotHash,sourceSafe,validObservationTime,type Horizon} from './contracts.ts';
import {DAILY_AI_MEMBER_STATES,type DailyAiAnalysisOrigin,type DailyAiMemberCard,type DailyAiMemberClaim,type DailyAiMemberSource,type DailyAiMemberState} from './dailyAiMember.ts';
import {verifyDailyAiPricePlan,type DailyAiPricePlan} from './dailyAiPricePlan.ts';

export const DAILY_AI_MARKETS=Object.freeze(['TWSE','TPEX','EMERGING'] as const);
export type DailyAiMarket=typeof DAILY_AI_MARKETS[number];
export type DailyAiMarketAnalysisOriginV2=DailyAiAnalysisOrigin|'DETERMINISTIC_SCREENING';
type Tier='free'|'premium'|'owner';
/** Structurally compatible with the V1 reader's live Auth scope. */
export type DailyAiMarketReadScopeV2={identity:string;generation:number;signal:AbortSignal;tier:Tier;requestDate:string};
type DailyAiMemberReadScope=DailyAiMarketReadScopeV2;
type Counts=Readonly<Record<DailyAiMemberState,number>>;
export type DailyAiMarketPageQuery=Readonly<{
 horizon:Horizon;market:DailyAiMarket|'ALL';status:DailyAiMemberState|'ALL';search:string;
 sort:'STATUS_MARKET_SYMBOL_ASC';page_size:number;
}>;
export type DailyAiMarketEditionV2=Readonly<{
 id:string;edition_date:string;evidence_cutoff:string;prepared_at:string;expires_at:string;
 analysis_origin:DailyAiMarketAnalysisOriginV2;mode:'AS_OF_RESEARCH';forecast:false;performance_available:false;
}>;
export type DailyAiMarketCoverage=Readonly<{
 market:DailyAiMarket;universe_count:number|null;published_count:number|null;
 coverage:'UNKNOWN'|'PARTIAL'|'COMPLETE';roster_as_of:string|null;
 data_as_of:Readonly<{price_date:string|null;financial_available_at:string|null;news_available_at:string|null}>;
}>;
type Position=Readonly<{seen:number;after:Readonly<{status:DailyAiMemberState;market:DailyAiMarket;symbol:string}>}>;
export type DailyAiMarketCursorV2=Readonly<{
 schema:'VNEXT_AI_MARKET_CURSOR_V2';edition_id:string;research_revision:string;price_revision:string;
 subject_user_id:string;tier:Tier;business_date:string;query_hash:string;position:Position;expires_at:string;binding_hash:string;
}>;
type Revision=Readonly<{edition_id:string;research_revision:string;price_revision:string}>;
export type DailyAiMarketPageRequestV2=Readonly<{
 schema:'VNEXT_AI_MARKET_PAGE_REQUEST_V2';query:DailyAiMarketPageQuery;query_hash:string;
 cursor:DailyAiMarketCursorV2|null;known:Revision|null;
}>;
export type DailyAiMarketPriceV2=Readonly<{plan:DailyAiPricePlan;sources:readonly Readonly<DailyAiMemberSource>[]}>
export type DailyAiMarketResearchReferenceV1=Readonly<{
 schema:'DAILY_AI_MARKET_RESEARCH_REFERENCE_V1';status:'CALCULATED_RESEARCH_ONLY';symbol:string;horizon:Horizon;
 method_id:'OBSERVED_UNADJUSTED_20_SESSION_RANGE'|'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE'
  |'CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'|'CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'
  |'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB'|'CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB';
 method_version:'TAIWAN_OBSERVED_RANGE_V1'|'TAIWAN_PEER_RERATING_V1'|'TAIWAN_LONG_QUALITY_PEER_PB_V1'|'TAIWAN_REPORTED_BVPS_PEER_V1';
 quote_date:string;current_price:number;lower:number;median:number|null;upper:number;peer_count:number|null;
 reference_hash:string;input_pool_hash:string;forecast:false;buy_ready:false;methodology_approved:false;
}>;
export type DailyAiMarketCardV2=Readonly<DailyAiMemberCard&{market:DailyAiMarket;price:DailyAiMarketPriceV2|null;research_reference:DailyAiMarketResearchReferenceV1|null}>;
export type DailyAiMarketPageV2=Readonly<{
 schema:'VNEXT_AI_MARKET_PAGE_V2';mode:'FULL';subject_user_id:string;tier:Tier;business_date:string;research_only:true;checked_at:string;
 query:DailyAiMarketPageQuery;query_hash:string;edition:DailyAiMarketEditionV2|null;research_revision:string|null;price_revision:string|null;
 universe:Readonly<{snapshot_id:string;snapshot_date:string;markets:readonly DailyAiMarketCoverage[]}>;
 counts:Readonly<{available_total:number;matching_total:number;by_status:Counts}>;
 page:Readonly<{start:number;returned:number;has_more:boolean;next_cursor:DailyAiMarketCursorV2|null}>;
 cards:readonly DailyAiMarketCardV2[];
}>;
export type DailyAiMarketPageCacheV2=Readonly<{scope:DailyAiMemberReadScope;request:DailyAiMarketPageRequestV2;data:DailyAiMarketPageV2}>;
export class DailyAiMarketPageError extends Error{
 readonly code:'CONTRACT'|'SCOPE'|'QUERY'|'CURSOR'|'CURSOR_STALE'|'CHRONOLOGY'|'COVERAGE'|'COUNTS'|'CARD'|'PRICE'|'REFERENCE'|'CACHE_MISS'|'NO_NEXT_PAGE';
 constructor(code:DailyAiMarketPageError['code']){super('AI_MARKET_PAGE_V2_'+code);this.code=code;}
}
function fail(code:DailyAiMarketPageError['code']):never{throw new DailyAiMarketPageError(code);}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail('CONTRACT');
const exact=(value:Record<string,unknown>,keys:readonly string[])=>{const actual=Object.keys(value);if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))fail('CONTRACT');};
const text=(value:unknown,max=1500):string=>typeof value==='string'&&!!value.trim()&&value.length<=max?value:fail('CONTRACT');
const one=<T extends string>(value:unknown,values:readonly T[]):T=>typeof value==='string'&&values.includes(value as T)?value as T:fail('CONTRACT');
const hash=(value:unknown)=>{const s=text(value,64);return hashValid(s)?s:fail('CONTRACT');};
const integer=(value:unknown):number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:fail('CONTRACT');
const time=(value:unknown)=>{const s=text(value,40);return validObservationTime(s)?s:fail('CHRONOLOGY');};
const day=(value:unknown)=>{const s=text(value,10);return /^\d{4}-\d\d-\d\d$/.test(s)&&validObservationTime(s+'T00:00:00Z')?s:fail('CHRONOLOGY');};
const nullableDay=(value:unknown)=>value===null?null:day(value);
const nullableTime=(value:unknown)=>value===null?null:time(value);
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const atMost=(a:string,b:string)=>compareTime(a,b)<=0;
const before=(a:string,b:string)=>compareTime(a,b)<0;
const taipeiDate=(at:number)=>new Date(at+8*3600000).toISOString().slice(0,10);
const clock=(now:number)=>Number.isFinite(now)&&Number.isFinite(new Date(now).getTime())?new Date(now).toISOString():fail('CHRONOLOGY');
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const states=Object.keys(DAILY_AI_MEMBER_STATES) as DailyAiMemberState[];
const statusOrder:Record<DailyAiMemberState,number>={WATCH:0,WAIT:1,AVOID:2,INSUFFICIENT:3};
const cardKeys=['market','symbol','company','horizon','status','reason','counter_evidence','confirmation','invalidation','gaps','sources','classification','price'];
const sourceKeys=['id','source','kind','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash'];
const envelopeKeys=['schema','mode','subject_user_id','tier','business_date','research_only','checked_at','query','query_hash','edition','research_revision','price_revision','universe','counts','page'];
const cursorKeys=['schema','edition_id','research_revision','price_revision','subject_user_id','tier','business_date','query_hash','position','expires_at','binding_hash'];
// Only successfully parsed, immutable pages can satisfy UNCHANGED. A caller
// cannot construct a cache with unreviewed card objects and relabel it validated.
const parsedPages=new WeakSet<object>();
export const dailyAiMarketAnalysisLabelV2=(origin:DailyAiMarketAnalysisOriginV2)=>({MODEL_GENERATED:'AI 證據分析',OFFLINE_REVIEWED:'離線審核分析',DETERMINISTIC_SCREENING:'規則式資料篩選'})[origin];

function validScope(scope:DailyAiMemberReadScope,now:number){
 clock(now);
 if(!uuid(scope.identity)||!Number.isSafeInteger(scope.generation)||scope.generation<0||scope.signal.aborted
  ||!['free','premium','owner'].includes(scope.tier)||scope.requestDate!==taipeiDate(now))fail('SCOPE');
}
export function parseDailyAiMarketPageQuery(value:unknown):DailyAiMarketPageQuery{
 const q=record(value);exact(q,['horizon','market','status','search','sort','page_size']);
 if(typeof q.search!=='string'||q.search.length>80||q.search!==q.search.trim()||Array.from(q.search).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)
  ||q.sort!=='STATUS_MARKET_SYMBOL_ASC')fail('QUERY');
 const page_size=integer(q.page_size);if(page_size<1||page_size>60)fail('QUERY');
 return freeze({horizon:one(q.horizon,Object.keys(HORIZONS) as Horizon[]),market:one(q.market,['ALL',...DAILY_AI_MARKETS]),
  status:one(q.status,['ALL',...states]),search:q.search,sort:'STATUS_MARKET_SYMBOL_ASC' as const,page_size});
}
const symbol=(value:unknown)=>{const s=text(value,6);return /^\d{4,6}$/.test(s)?s:fail('CARD');};
const comparePosition=(a:Position['after'],b:Position['after'])=>statusOrder[a.status]-statusOrder[b.status]
 ||DAILY_AI_MARKETS.indexOf(a.market)-DAILY_AI_MARKETS.indexOf(b.market)||(a.symbol<b.symbol?-1:a.symbol>b.symbol?1:0);
const cursorBody=(cursor:DailyAiMarketCursorV2)=>Object.fromEntries(cursorKeys.filter(key=>key!=='binding_hash').map(key=>[key,cursor[key as keyof DailyAiMarketCursorV2]]));
async function parseCursor(value:unknown,scope:DailyAiMemberReadScope,queryHash:string,now:number):Promise<DailyAiMarketCursorV2>{
 const r=record(value);exact(r,cursorKeys);const position=record(r.position);exact(position,['seen','after']);
 const after=record(position.after);exact(after,['status','market','symbol']);
 const seen=integer(position.seen);if(!seen)fail('CURSOR');
 const result:DailyAiMarketCursorV2={schema:'VNEXT_AI_MARKET_CURSOR_V2',edition_id:hash(r.edition_id),research_revision:hash(r.research_revision),price_revision:hash(r.price_revision),
  subject_user_id:text(r.subject_user_id,36),tier:one(r.tier,['free','premium','owner']),business_date:day(r.business_date),query_hash:hash(r.query_hash),
  position:{seen,after:{status:one(after.status,states),market:one(after.market,DAILY_AI_MARKETS),symbol:symbol(after.symbol)}},expires_at:time(r.expires_at),binding_hash:hash(r.binding_hash)};
 if(r.schema!==result.schema||result.subject_user_id!==scope.identity||result.tier!==scope.tier||result.business_date!==scope.requestDate||result.query_hash!==queryHash)fail('CURSOR');
 if(!before(clock(now),result.expires_at))fail('CURSOR_STALE');
 if(await snapshotHash(cursorBody(result))!==result.binding_hash)fail('CURSOR');
 if(scope.signal.aborted)fail('SCOPE');
 return freeze(result);
}
function parseEdition(value:unknown,checkedAt:string,now:number):DailyAiMarketEditionV2|null{
 if(value===null)return null;
 const e=record(value);exact(e,['id','edition_date','evidence_cutoff','prepared_at','expires_at','analysis_origin','mode','forecast','performance_available']);
 const result:DailyAiMarketEditionV2={id:hash(e.id),edition_date:day(e.edition_date),evidence_cutoff:time(e.evidence_cutoff),prepared_at:time(e.prepared_at),expires_at:time(e.expires_at),
  analysis_origin:one(e.analysis_origin,['MODEL_GENERATED','OFFLINE_REVIEWED','DETERMINISTIC_SCREENING']),mode:'AS_OF_RESEARCH',forecast:false,performance_available:false};
 if(e.mode!==result.mode||e.forecast!==false||e.performance_available!==false)fail('CONTRACT');
 if(!atMost(result.evidence_cutoff,result.prepared_at)||!atMost(result.prepared_at,checkedAt)||!before(clock(now),result.expires_at)
  ||taipeiDate(Date.parse(result.evidence_cutoff))!==result.edition_date)fail('CHRONOLOGY');
 return result;
}
function parseUniverse(value:unknown,cutoff:string,businessDate:string):DailyAiMarketPageV2['universe']{
 const r=record(value);exact(r,['snapshot_id','snapshot_date','markets']);const snapshot_date=day(r.snapshot_date);
 if(snapshot_date>businessDate||!Array.isArray(r.markets)||r.markets.length!==DAILY_AI_MARKETS.length)fail('COVERAGE');
 const markets=r.markets.map(value=>{
  const m=record(value);exact(m,['market','universe_count','published_count','coverage','roster_as_of','data_as_of']);
  const market=one(m.market,DAILY_AI_MARKETS),universe_count=m.universe_count===null?null:integer(m.universe_count),published_count=m.published_count===null?null:integer(m.published_count);
  const coverage=one(m.coverage,['UNKNOWN','PARTIAL','COMPLETE']),roster_as_of=nullableDay(m.roster_as_of),asOf=record(m.data_as_of);
  exact(asOf,['price_date','financial_available_at','news_available_at']);
  const data_as_of={price_date:nullableDay(asOf.price_date),financial_available_at:nullableTime(asOf.financial_available_at),news_available_at:nullableTime(asOf.news_available_at)};
  if(roster_as_of!==null&&roster_as_of>snapshot_date||universe_count!==null&&published_count!==null&&published_count>universe_count
   ||coverage==='UNKNOWN'&&universe_count!==null&&published_count!==null
   ||coverage!=='UNKNOWN'&&(universe_count===null||published_count===null)
   ||coverage==='COMPLETE'&&published_count!==universe_count
   ||coverage==='PARTIAL'&&published_count===universe_count)fail('COVERAGE');
  if(data_as_of.price_date!==null&&data_as_of.price_date>taipeiDate(Date.parse(cutoff))
   ||data_as_of.financial_available_at!==null&&!atMost(data_as_of.financial_available_at,cutoff)
   ||data_as_of.news_available_at!==null&&!atMost(data_as_of.news_available_at,cutoff))fail('CHRONOLOGY');
  return {market,universe_count,published_count,coverage,roster_as_of,data_as_of};
 });
 if(new Set(markets.map(m=>m.market)).size!==DAILY_AI_MARKETS.length)fail('COVERAGE');
 return {snapshot_id:hash(r.snapshot_id),snapshot_date,markets:DAILY_AI_MARKETS.map(m=>markets.find(value=>value.market===m)!)};
}
function parseCounts(value:unknown,query:DailyAiMarketPageQuery,universe:DailyAiMarketPageV2['universe']):DailyAiMarketPageV2['counts']{
 const r=record(value);exact(r,['available_total','matching_total','by_status']);const by=record(r.by_status);exact(by,states);
 const by_status={WATCH:integer(by.WATCH),WAIT:integer(by.WAIT),AVOID:integer(by.AVOID),INSUFFICIENT:integer(by.INSUFFICIENT)};
 const available_total=integer(r.available_total),matching_total=integer(r.matching_total),sum=Object.values(by_status).reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(sum)||sum>available_total||matching_total!==(query.status==='ALL'?sum:by_status[query.status])
  ||!query.search&&sum!==available_total)fail('COUNTS');
 const markets=universe.markets.filter(m=>query.market==='ALL'||m.market===query.market);
 if(markets.every(m=>m.published_count!==null)&&available_total!==markets.reduce((sum,m)=>sum+m.published_count!,0)
  ||available_total<markets.reduce((sum,m)=>sum+(m.published_count??0),0)
  ||markets.every(m=>m.universe_count!==null)&&available_total>markets.reduce((sum,m)=>sum+m.universe_count!,0))fail('COUNTS');
 return {available_total,matching_total,by_status};
}
function claim(value:unknown):DailyAiMemberClaim{
 const r=record(value);exact(r,['text','evidence_ids']);
 if(!Array.isArray(r.evidence_ids)||!r.evidence_ids.length||r.evidence_ids.length>100)fail('CARD');
 const evidence_ids=r.evidence_ids.map(id=>text(id,200));if(new Set(evidence_ids).size!==evidence_ids.length)fail('CARD');
 return {text:text(r.text),evidence_ids};
}
function source(value:unknown,cutoff:string):DailyAiMemberSource{
 const r=record(value);exact(r,sourceKeys);
 const result:DailyAiMemberSource={id:text(r.id,200),source:text(r.source,3000),kind:one(r.kind,['NEWS','MARKET','FINANCIAL','PRICE']),
  published_at:nullableTime(r.published_at),available_at:time(r.available_at),time_basis:one(r.time_basis,['PUBLISHED','OBSERVED_AFTER_RECEIPT']),
  first_seen_at:nullableTime(r.first_seen_at),as_of:nullableTime(r.as_of),evidence_hash:r.evidence_hash===null?null:hash(r.evidence_hash)};
 if(!sourceSafe(result.source)||!atMost(result.available_at,cutoff)
  ||result.published_at!==null&&(result.time_basis!=='PUBLISHED'||!atMost(result.published_at,result.available_at))
  ||result.published_at===null&&(result.time_basis!=='OBSERVED_AFTER_RECEIPT'||result.first_seen_at===null||result.as_of===null||result.evidence_hash===null)
  ||result.first_seen_at!==null&&!atMost(result.first_seen_at,result.available_at)||result.as_of!==null&&!atMost(result.as_of,result.available_at))fail('CARD');
 return result;
}
const sources=(value:unknown,cutoff:string)=>{
 if(!Array.isArray(value)||!value.length||value.length>100)fail('CARD');
 const result=(value as unknown[]).map(item=>source(item,cutoff));if(new Set(result.map(s=>s.id)).size!==result.length)fail('CARD');return result;
};
const sameSource=(a:DailyAiMemberSource,b:DailyAiMemberSource)=>sourceKeys.every(key=>{
 const field=key as keyof DailyAiMemberSource;
 if(['published_at','available_at','first_seen_at','as_of'].includes(key))return a[field]===null&&b[field]===null
  ||typeof a[field]==='string'&&typeof b[field]==='string'&&compareTime(a[field]!,b[field]!)===0;
 return a[field]===b[field];
});
/** This bounded summary is part of the server-approved edition's immutable
 * result hash. Its hashes identify the retained calculation/input pool; a
 * browser cannot recompute those hashes without the private full documents.
 * It never enters the separate, reviewed executable-price-plan contract. */
function researchReference(value:unknown,stock:string,horizon:Horizon,cutoff:string):DailyAiMarketResearchReferenceV1|null{
 if(value===null)return null;
 const r=record(value);exact(r,['schema','status','symbol','horizon','method_id','method_version','quote_date','current_price',
  'lower','median','upper','peer_count','reference_hash','input_pool_hash','forecast','buy_ready','methodology_approved']);
 if(r.schema!=='DAILY_AI_MARKET_RESEARCH_REFERENCE_V1'||r.status!=='CALCULATED_RESEARCH_ONLY'||r.symbol!==stock||r.horizon!==horizon
  ||r.forecast!==false||r.buy_ready!==false||r.methodology_approved!==false)fail('REFERENCE');
 const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
 if(!positive(r.current_price)||!positive(r.lower)||!positive(r.upper)||r.lower>r.upper)fail('REFERENCE');
 const quote_date=day(r.quote_date);
 if(quote_date>taipeiDate(Date.parse(cutoff))||!atMost(quote_date+'T13:30:00+08:00',cutoff))fail('CHRONOLOGY');
 if(horizon==='SHORT'){
  if(r.method_id!=='OBSERVED_UNADJUSTED_20_SESSION_RANGE'||r.method_version!=='TAIWAN_OBSERVED_RANGE_V1'
   ||r.median!==null||r.peer_count!==null)fail('REFERENCE');
 }else{
  const methods=horizon==='MEDIUM'?['CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE','CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB']
   :['CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB'];
  const version=horizon==='MEDIUM'?'TAIWAN_PEER_RERATING_V1':'TAIWAN_LONG_QUALITY_PEER_PB_V1';
  const bvpsMethod=horizon==='MEDIUM'?'CURRENT_REPORTED_BVPS_TIMES_PEER_DERIVED_PB':'CURRENT_REPORTED_BVPS_TIMES_QUALITY_MATCHED_PEER_DERIVED_PB';
  const validMethod=typeof r.method_id==='string'&&((methods.includes(r.method_id)&&r.method_version===version)
   ||(r.method_id===bvpsMethod&&r.method_version==='TAIWAN_REPORTED_BVPS_PEER_V1'));
  if(!validMethod
   ||!positive(r.median)||r.median<r.lower||r.median>r.upper
   ||typeof r.peer_count!=='number'||!Number.isSafeInteger(r.peer_count)||r.peer_count<5)fail('REFERENCE');
 }
 return {schema:'DAILY_AI_MARKET_RESEARCH_REFERENCE_V1',status:'CALCULATED_RESEARCH_ONLY',symbol:stock,horizon,
  method_id:r.method_id as DailyAiMarketResearchReferenceV1['method_id'],method_version:r.method_version as DailyAiMarketResearchReferenceV1['method_version'],
  quote_date,current_price:r.current_price,lower:r.lower,median:r.median as number|null,upper:r.upper,peer_count:r.peer_count as number|null,
  reference_hash:hash(r.reference_hash),input_pool_hash:hash(r.input_pool_hash),forecast:false,buy_ready:false,methodology_approved:false};
}
async function parseCard(value:unknown,edition:DailyAiMarketEditionV2,query:DailyAiMarketPageQuery,tier:Tier,now:number):Promise<DailyAiMarketCardV2>{
 const r=record(value),hasReference=Object.hasOwn(r,'research_reference');exact(r,[...cardKeys,...(hasReference?['research_reference']:[])]);
 const market=one(r.market,DAILY_AI_MARKETS),status=one(r.status,states),horizon=one(r.horizon,Object.keys(HORIZONS) as Horizon[]),company=text(r.company,100),stock=symbol(r.symbol);
 const search=query.search.toLowerCase();
 if(r.classification!=='INFERENCE'||horizon!==query.horizon||query.market!=='ALL'&&market!==query.market
  ||query.status!=='ALL'&&status!==query.status||search&&!`${stock} ${company}`.toLowerCase().includes(search))fail('CARD');
 if(!Array.isArray(r.gaps)||r.gaps.length>130||status==='INSUFFICIENT'&&!r.gaps.length)fail('CARD');
 const result:DailyAiMemberCard={symbol:stock,company,horizon,status,reason:claim(r.reason),confirmation:text(r.confirmation),invalidation:text(r.invalidation),
  gaps:r.gaps.map(g=>text(g)),classification:'INFERENCE',counter_evidence:null,sources:null};
 if(tier==='free'){
  if(r.sources!==null||r.counter_evidence!==null||r.price!==null||hasReference&&r.research_reference!==null)fail('SCOPE');
 }else{
  result.sources=sources(r.sources,edition.evidence_cutoff);
  if(!Array.isArray(r.counter_evidence)||r.counter_evidence.length>20)fail('CARD');
  result.counter_evidence=r.counter_evidence.map(claim);const ids=new Set(result.sources.map(s=>s.id));
  if([result.reason,...result.counter_evidence].some(c=>c.evidence_ids.some(id=>!ids.has(id))))fail('CARD');
 }
 let price:DailyAiMarketPriceV2|null=null;
 if(r.price!==null){
  if(tier==='free'||!result.sources)fail('SCOPE');
  const p=record(r.price);exact(p,['plan','sources']);const evidence=sources(p.sources,edition.evidence_cutoff);
  for(const s of evidence){const original=result.sources.find(item=>item.id===s.id);if(original&&!sameSource(original,s))fail('PRICE');}
  let plan:DailyAiPricePlan|null;
  try{plan=await verifyDailyAiPricePlan(p.plan,{edition,card:result,evidence},now);}catch{fail('PRICE');}
  if(!plan||evidence.length!==plan.evidence_ids.length||evidence.some(s=>!plan!.evidence_ids.includes(s.id)))fail('PRICE');
  price={plan,sources:evidence};
 }
 const research_reference=hasReference?researchReference(r.research_reference,stock,horizon,edition.evidence_cutoff):null;
 return {...result,market,price,research_reference};
}
function sameScope(a:DailyAiMemberReadScope,b:DailyAiMemberReadScope){return a.identity===b.identity&&a.generation===b.generation&&a.signal===b.signal&&a.tier===b.tier&&a.requestDate===b.requestDate;}
/** Structural reuse for the separate, Owner-only draft reader. This does not
 * create a parsed member page/cache or assert review, publication or rights.
 * Formal executable price plans are not admitted through this draft helper. */
export async function parseDailyAiMarketOwnerPreviewCardV2(value:unknown,edition:DailyAiMarketEditionV2):Promise<DailyAiMarketCardV2>{
 const owned=structuredClone(value),r=record(owned);
 if(r.price!==null||!validObservationTime(edition.evidence_cutoff))fail('CARD');
 const horizon=one(r.horizon,Object.keys(HORIZONS)as Horizon[]);
 return freeze(await parseCard(owned,edition,{horizon,market:'ALL',status:'ALL',search:'',sort:'STATUS_MARKET_SYMBOL_ASC',page_size:60},'owner',Date.now()));
}
export function parseDailyAiMarketResearchReferenceV1(value:unknown,stock:string,horizon:Horizon,cutoff:string):DailyAiMarketResearchReferenceV1|null{
 return freeze(researchReference(structuredClone(value),stock,horizon,cutoff));
}
export function eligibleDailyAiMarketPageCacheV2(cache:DailyAiMarketPageCacheV2|null,scope:DailyAiMemberReadScope,now=Date.now()):cache is DailyAiMarketPageCacheV2{
 if(!cache||!parsedPages.has(cache.data)||scope.signal.aborted||cache.scope.signal.aborted||!sameScope(cache.scope,scope)||!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))return false;
 const data=cache.data;
 return scope.requestDate===taipeiDate(now)&&data.subject_user_id===scope.identity&&data.tier===scope.tier&&data.business_date===scope.requestDate
  &&atMost(data.checked_at,clock(now))&&(data.edition===null||before(clock(now),data.edition.expires_at));
}
/** Pure request preparation. Query strings are literal search text, not LIKE
 * patterns. Backend SQL must bind parameters and escape wildcard operators. */
export async function createDailyAiMarketPageRequestV2(scope:DailyAiMemberReadScope,inputQuery:unknown,
 options:{cursor?:DailyAiMarketCursorV2|null;cache?:DailyAiMarketPageCacheV2|null;now?:number}={}):Promise<DailyAiMarketPageRequestV2>{
 const ownedScope={...scope},now=options.now??Date.now(),ownedCursor=structuredClone(options.cursor??null),cache=options.cache??null;validScope(ownedScope,now);
 const query=parseDailyAiMarketPageQuery(structuredClone(inputQuery)),query_hash=await snapshotHash(query);
 const cursor=ownedCursor?await parseCursor(ownedCursor,ownedScope,query_hash,now):null;
 let known:Revision|null=null;
 if(eligibleDailyAiMarketPageCacheV2(cache,ownedScope,now)&&cache.data.edition&&cache.data.query_hash===query_hash
  &&await snapshotHash(cache.request.cursor)===await snapshotHash(cursor))known={edition_id:cache.data.edition!.id,research_revision:cache.data.research_revision!,price_revision:cache.data.price_revision!};
 if(ownedScope.signal.aborted)fail('SCOPE');
 return freeze({schema:'VNEXT_AI_MARKET_PAGE_REQUEST_V2',query,query_hash,cursor,known});
}
const metadata=(page:DailyAiMarketPageV2)=>Object.fromEntries(envelopeKeys.filter(key=>!['mode','checked_at'].includes(key)).map(key=>[key,page[key as keyof DailyAiMarketPageV2]]));

/** FULL replaces one bounded page; UNCHANGED requires both revisions and the
 * exact previously validated page. Old plans cannot survive a price revision. */
export async function parseDailyAiMarketPageV2(value:unknown,scope:DailyAiMemberReadScope,inputRequest:DailyAiMarketPageRequestV2,
 cache:DailyAiMarketPageCacheV2|null=null,now=Date.now()):Promise<DailyAiMarketPageV2>{
 const ownedScope={...scope},r=record(structuredClone(value)),request=structuredClone(inputRequest);validScope(ownedScope,now);
 const mode=one(r.mode,['FULL','UNCHANGED']);exact(r,[...envelopeKeys,...(mode==='FULL'?['cards']:[])]);
 const rq=record(request);exact(rq,['schema','query','query_hash','cursor','known']);
 const query=parseDailyAiMarketPageQuery(request.query),query_hash=await snapshotHash(query);
 if(request.schema!=='VNEXT_AI_MARKET_PAGE_REQUEST_V2'||request.query_hash!==query_hash||await snapshotHash(parseDailyAiMarketPageQuery(r.query))!==query_hash||r.query_hash!==query_hash)fail('QUERY');
 const cursor=request.cursor?await parseCursor(request.cursor,ownedScope,query_hash,now):null;
 if(request.known!==null){const known=record(request.known);exact(known,['edition_id','research_revision','price_revision']);Object.values(known).forEach(hash);}
 if(r.schema!=='VNEXT_AI_MARKET_PAGE_V2'||r.subject_user_id!==ownedScope.identity||r.tier!==ownedScope.tier||r.business_date!==ownedScope.requestDate||r.research_only!==true)fail('SCOPE');
 const checked_at=time(r.checked_at);if(!atMost(checked_at,clock(now))||taipeiDate(Date.parse(checked_at))!==ownedScope.requestDate)fail('CHRONOLOGY');
 const edition=parseEdition(r.edition,checked_at,now),research_revision=r.research_revision===null?null:hash(r.research_revision),price_revision=r.price_revision===null?null:hash(r.price_revision);
 if(!!edition!==(research_revision!==null)||!!edition!==(price_revision!==null))fail('CONTRACT');
 if(cursor&&(!edition||cursor.edition_id!==edition.id||cursor.research_revision!==research_revision||cursor.price_revision!==price_revision
  ||compareTime(cursor.expires_at,edition.expires_at)!==0))fail('CURSOR_STALE');
 const universe=parseUniverse(r.universe,edition?.evidence_cutoff??checked_at,ownedScope.requestDate),counts=parseCounts(r.counts,query,universe),p=record(r.page);
 if(ownedScope.tier==='free'&&(counts.available_total>3||universe.markets.reduce((sum,m)=>sum+(m.published_count??0),0)>3))fail('SCOPE');
 exact(p,['start','returned','has_more','next_cursor']);const start=integer(p.start),returned=integer(p.returned);
 if(typeof p.has_more!=='boolean'||start!==(cursor?.position.seen??0)||returned>query.page_size||start+returned>counts.matching_total
  ||p.has_more!==(start+returned<counts.matching_total)||p.has_more&&returned!==query.page_size
  ||p.has_more!==(p.next_cursor!==null))fail('COUNTS');
 const next_cursor=p.next_cursor===null?null:await parseCursor(p.next_cursor,ownedScope,query_hash,now);
 if(next_cursor&&(!edition||next_cursor.edition_id!==edition.id||next_cursor.research_revision!==research_revision||next_cursor.price_revision!==price_revision
  ||next_cursor.position.seen!==start+returned||compareTime(next_cursor.expires_at,edition.expires_at)!==0))fail('CURSOR');
 if(!edition&&(mode!=='FULL'||returned!==0||counts.available_total!==0||universe.markets.some(m=>(m.published_count??0)!==0)))fail('CONTRACT');
 const result:DailyAiMarketPageV2={schema:'VNEXT_AI_MARKET_PAGE_V2',mode:'FULL',subject_user_id:ownedScope.identity,tier:ownedScope.tier,business_date:ownedScope.requestDate,research_only:true,
  checked_at,query,query_hash,edition,research_revision,price_revision,universe,counts,page:{start,returned,has_more:p.has_more,next_cursor},cards:[]};
 if(mode==='UNCHANGED'){
  if(!eligibleDailyAiMarketPageCacheV2(cache,ownedScope,now)||!request.known||!edition
   ||request.known.edition_id!==edition.id||request.known.research_revision!==research_revision||request.known.price_revision!==price_revision
   ||await snapshotHash(cache.request.cursor)!==await snapshotHash(cursor)||await snapshotHash(metadata(cache.data))!==await snapshotHash(metadata(result)))fail('CACHE_MISS');
  const reused={...result,cards:cache.data.cards};if(ownedScope.signal.aborted)fail('SCOPE');freeze(reused);parsedPages.add(reused);return reused;
 }
 if(!Array.isArray(r.cards)||r.cards.length!==returned)fail('COUNTS');
 const cards:DailyAiMarketCardV2[]=[],keys=new Set<string>();let last=cursor?.position.after??null;
 for(const raw of r.cards){
  if(!edition)fail('CONTRACT');const card=await parseCard(raw,edition,query,ownedScope.tier,now),key=card.market+':'+card.symbol;
  if(keys.has(key)||last&&comparePosition(last,card)>=0)fail('CARD');keys.add(key);cards.push(card);last=card;
 }
 if(next_cursor&&(!last||comparePosition(next_cursor.position.after,last)!==0))fail('CURSOR');
 for(const status of states)if(cards.filter(card=>card.status===status).length>counts.by_status[status])fail('COUNTS');
 for(const market of universe.markets)if(market.published_count!==null&&cards.filter(card=>card.market===market.market).length>market.published_count)fail('COVERAGE');
 if(ownedScope.signal.aborted)fail('SCOPE');const parsed=freeze({...result,cards});parsedPages.add(parsed);return parsed;
}

/** RAM cache factory, scoped to the exact live Auth generation and request. */
export function cacheDailyAiMarketPageV2(data:DailyAiMarketPageV2,scope:DailyAiMemberReadScope,request:DailyAiMarketPageRequestV2):DailyAiMarketPageCacheV2{
 if(!parsedPages.has(data)||data.subject_user_id!==scope.identity||data.tier!==scope.tier||data.business_date!==scope.requestDate||data.query_hash!==request.query_hash||scope.signal.aborted)fail('SCOPE');
 return Object.freeze({scope:Object.freeze({...scope}),request:freeze(structuredClone(request)),data});
}
export async function nextDailyAiMarketPageRequestV2(cache:DailyAiMarketPageCacheV2,scope:DailyAiMemberReadScope,now=Date.now()):Promise<DailyAiMarketPageRequestV2>{
 if(!eligibleDailyAiMarketPageCacheV2(cache,scope,now))fail('SCOPE');
 if(!cache.data.page.next_cursor)fail('NO_NEXT_PAGE');
 return createDailyAiMarketPageRequestV2(scope,cache.data.query,{cursor:cache.data.page.next_cursor,now});
}
/** Replace a server page, then reveal it in small UI increments. Never append
 * every server page into RAM. Expired optional prices disappear independently. */
export function adaptDailyAiMarketPageV2(cache:DailyAiMarketPageCacheV2|null,scope:DailyAiMemberReadScope,visible=9,now=Date.now()){
 if(!eligibleDailyAiMarketPageCacheV2(cache,scope,now))return null;
 if(!Number.isSafeInteger(visible)||visible<1||visible>60)fail('QUERY');
 const data=cache.data,current=clock(now),cards=data.cards.slice(0,visible).map(card=>{
  const expired=!!card.price&&!before(current,card.price.plan.expires_at);
  return Object.freeze({...card,price:expired?null:card.price,price_state:card.price?(expired?'EXPIRED':'AVAILABLE'):data.tier==='free'?'NOT_INCLUDED':'NONE'});
 });
 return freeze({edition:data.edition,analysis_label:data.edition?dailyAiMarketAnalysisLabelV2(data.edition.analysis_origin):null,
  checked_at:data.checked_at,query:data.query,universe:data.universe,counts:data.counts,cards,
  visible_count:cards.length,page_count:data.cards.length,has_more_on_page:cards.length<data.cards.length,next_cursor:data.page.next_cursor,
  research_revision:data.research_revision,price_revision:data.price_revision});
}
