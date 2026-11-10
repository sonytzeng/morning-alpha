/** A separately reviewed conditional price plan. This module never produces a
 * price, upgrades WATCH to BUY, authenticates a reviewer or grants publication.
 * The server must expose only independently reviewed, Owner-approved records.
 * Hashes bind the complete body; member/source/expiry checks still run per read.
 */
import {HORIZONS,compareTime,hashValid,snapshotHash,sourceSafe,validObservationTime,type Horizon} from './contracts.ts';
import type {DailyAiMemberCard,DailyAiMemberEdition,DailyAiMemberResearch,DailyAiMemberSource} from './dailyAiMember.ts';

export type DailyAiPricePlanBody=Readonly<{
 schema:'DAILY_AI_PRICE_PLAN_V1';edition_id:string;symbol:string;horizon:Horizon;
 status:'VERIFIED';currency:'TWD';method:string;basis:string;
 entry_range:readonly [number,number];wait_above:number;
 stop_kind:'PRICE'|'EVENT';stop:number|null;stop_evidence_ids:readonly string[];
 invalidation:string;evidence_ids:readonly string[];as_of:string;expires_at:string;
 buy_ready:false;
}>;
export type DailyAiPricePlan=DailyAiPricePlanBody&Readonly<{
 plan_hash:string;review:Readonly<{status:'PASS';plan_hash:string;reviewed_at:string;document_hash:string}>;
}>;
export type DailyAiPricePlanContext={
 edition:Pick<DailyAiMemberEdition,'id'|'evidence_cutoff'|'prepared_at'|'expires_at'>;
 card:Pick<DailyAiMemberCard,'symbol'|'horizon'|'status'>;
 evidence:readonly Pick<DailyAiMemberSource,'id'|'kind'|'available_at'>[];
};
export type DailyAiPricePlanSourceSet=Readonly<{symbol:string;sources:readonly Readonly<DailyAiMemberSource>[]}>
export type DailyAiMemberPricePlans=Readonly<{
 schema:'VNEXT_AI_MEMBER_PRICE_PLANS_V1';edition_id:string|null;
 tier:'free'|'premium'|'owner';subject_user_id:string;research_only:true;
 plans:readonly DailyAiPricePlan[];source_sets:readonly DailyAiPricePlanSourceSet[];
}>;

const bodyKeys=['schema','edition_id','symbol','horizon','status','currency','method','basis',
 'entry_range','wait_above','stop_kind','stop','stop_evidence_ids','invalidation','evidence_ids','as_of','expires_at','buy_ready'];
const record=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_PRICE_PLAN_OBJECT');
 return value as Record<string,unknown>;
};
const exact=(value:Record<string,unknown>,keys:readonly string[])=>{
 const actual=Object.keys(value);if(actual.length!==keys.length||actual.some(key=>!keys.includes(key)))throw Error('AI_PRICE_PLAN_FIELDS');
};
const text=(value:unknown,max=1500)=>{
 if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('AI_PRICE_PLAN_TEXT');return value;
};
const hash=(value:unknown)=>{const s=text(value,64);if(!hashValid(s))throw Error('AI_PRICE_PLAN_HASH');return s;};
const time=(value:unknown)=>{const s=text(value,40);if(!validObservationTime(s))throw Error('AI_PRICE_PLAN_TIME');return s;};
const positive=(value:unknown):number=>{if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw Error('AI_PRICE_PLAN_PRICE');return value;};
const ids=(value:unknown):string[]=>{
 if(!Array.isArray(value)||!value.length||value.length>100)throw Error('AI_PRICE_PLAN_CITATION');
 const result=value.map(id=>text(id,200));if(new Set(result).size!==result.length)throw Error('AI_PRICE_PLAN_CITATION');return result;
};
const allowedStatus=(value:unknown)=>value==='WATCH'||value==='WAIT';
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const atMost=(left:string,right:string)=>compareTime(left,right)<=0;
const before=(left:string,right:string)=>compareTime(left,right)<0;
const nowText=(now:number)=>{if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw Error('AI_PRICE_PLAN_NOW');return new Date(now).toISOString();};
const sourceKeys=['id','source','kind','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash'];
const nullableTime=(value:unknown)=>value===null?null:time(value);
function parseSource(value:unknown,cutoff:string):DailyAiMemberSource{
 const s=record(value);exact(s,sourceKeys);
 const published=nullableTime(s.published_at),available=time(s.available_at),firstSeen=nullableTime(s.first_seen_at),asOf=nullableTime(s.as_of);
 const evidenceHash=s.evidence_hash===null?null:hash(s.evidence_hash),url=text(s.source,3000);
 if(!sourceSafe(url)||!['NEWS','MARKET','FINANCIAL','PRICE'].includes(String(s.kind))||!atMost(available,cutoff)
  ||published!==null&&(s.time_basis!=='PUBLISHED'||!atMost(published,available))
  ||published===null&&(s.time_basis!=='OBSERVED_AFTER_RECEIPT'||firstSeen===null||asOf===null||evidenceHash===null)
  ||firstSeen!==null&&!atMost(firstSeen,available)||asOf!==null&&!atMost(asOf,available))throw Error('AI_PRICE_PLAN_MEMBER_SOURCE');
 return {id:text(s.id,200),source:url,kind:s.kind as DailyAiMemberSource['kind'],published_at:published,available_at:available,
  time_basis:s.time_basis as DailyAiMemberSource['time_basis'],first_seen_at:firstSeen,as_of:asOf,evidence_hash:evidenceHash};
}
function sameSource(left:DailyAiMemberSource,right:DailyAiMemberSource):boolean{
 return (['id','source','kind','time_basis','evidence_hash'] as const).every(key=>left[key]===right[key])
  &&(['published_at','available_at','first_seen_at','as_of'] as const).every(key=>left[key]===null&&right[key]===null
   ||typeof left[key]==='string'&&typeof right[key]==='string'&&compareTime(left[key],right[key])===0);
}

/** Shared preimage for imports and audits. Retain the exact canonical body text
 * in SQL; PostgreSQL jsonb::text has different whitespace/key ordering. */
export function dailyAiPricePlanBody(value:DailyAiPricePlan|DailyAiPricePlanBody):DailyAiPricePlanBody{
 const body=Object.fromEntries(bodyKeys.map(key=>[key,(value as unknown as Record<string,unknown>)[key]]));
 return structuredClone(body) as unknown as DailyAiPricePlanBody;
}
export async function hashDailyAiPricePlanBody(value:DailyAiPricePlan|DailyAiPricePlanBody):Promise<string>{
 return snapshotHash(dailyAiPricePlanBody(value));
}

/** Private preparation only: validates the exact existing body contract without
 * inventing a PASS review. VERIFIED is the legacy storage schema label, not a
 * reviewer decision. This function neither calculates prices nor grants rights. */
export function validateDailyAiPricePlanBody(value:unknown,context:DailyAiPricePlanContext,now=Date.now()):DailyAiPricePlanBody{
 const current=nowText(now),r=record(structuredClone(value)),owned=structuredClone(context);
 exact(r,bodyKeys);
 const edition=owned.edition,card=owned.card;
 if(!edition||!card||!hashValid(edition.id)||!/^\d{4,6}$/.test(card.symbol)
  ||!Object.hasOwn(HORIZONS,card.horizon)||!allowedStatus(card.status))throw Error('AI_PRICE_PLAN_CONTEXT');
 const cutoff=time(edition.evidence_cutoff),prepared=time(edition.prepared_at),editionExpiry=time(edition.expires_at);
 if(!atMost(cutoff,prepared)||!atMost(prepared,current)||!before(current,editionExpiry))throw Error('AI_PRICE_PLAN_EDITION_EXPIRED');
 if(r.schema!=='DAILY_AI_PRICE_PLAN_V1'||r.status!=='VERIFIED'||r.currency!=='TWD'||r.buy_ready!==false)throw Error('AI_PRICE_PLAN_SCOPE');
 if(r.edition_id!==edition.id||r.symbol!==card.symbol||r.horizon!==card.horizon)throw Error('AI_PRICE_PLAN_IDENTITY');
 const range=r.entry_range;
 if(!Array.isArray(range)||range.length!==2)throw Error('AI_PRICE_PLAN_PRICE');
 const low=positive(range[0]),high=positive(range[1]),wait=positive(r.wait_above);
 if(low>high||wait<high)throw Error('AI_PRICE_PLAN_PRICE');
 const evidenceIds=ids(r.evidence_ids),stopIds=ids(r.stop_evidence_ids);
 if(!Array.isArray(owned.evidence)||owned.evidence.length>100)throw Error('AI_PRICE_PLAN_EVIDENCE');
 const evidence=new Map<string,Pick<DailyAiMemberSource,'id'|'kind'|'available_at'>>();
 for(const source of owned.evidence){
  if(!source||typeof source.id!=='string'||!source.id||evidence.has(source.id)
   ||!['PRICE','NEWS','MARKET','FINANCIAL'].includes(source.kind)||!validObservationTime(source.available_at)
   ||!atMost(source.available_at,cutoff))throw Error('AI_PRICE_PLAN_EVIDENCE');
  evidence.set(source.id,source);
 }
 if(evidenceIds.some(id=>!evidence.has(id))||stopIds.some(id=>!evidenceIds.includes(id))
  ||!evidenceIds.some(id=>evidence.get(id)!.kind==='PRICE'))throw Error('AI_PRICE_PLAN_CITATION');
 let stop:number|null;
 if(r.stop_kind==='PRICE'){
  stop=positive(r.stop);if(stop>=low||!stopIds.some(id=>evidence.get(id)!.kind==='PRICE'))throw Error('AI_PRICE_PLAN_STOP');
 }else if(r.stop_kind==='EVENT'){
  stop=null;if(r.stop!==null||!stopIds.some(id=>evidence.get(id)!.kind!=='PRICE'))throw Error('AI_PRICE_PLAN_STOP');
 }else throw Error('AI_PRICE_PLAN_STOP');
 const asOf=time(r.as_of),expires=time(r.expires_at);
 if(!atMost(cutoff,asOf)||!atMost(asOf,current)||!before(current,expires)||!before(asOf,expires)
  ||!atMost(expires,editionExpiry))throw Error('AI_PRICE_PLAN_CHRONOLOGY');
 const body:DailyAiPricePlanBody={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:edition.id,symbol:card.symbol,horizon:card.horizon,
  status:'VERIFIED',currency:'TWD',method:text(r.method,200),basis:text(r.basis),entry_range:[low,high],wait_above:wait,
  stop_kind:r.stop_kind,stop,stop_evidence_ids:stopIds,invalidation:text(r.invalidation),evidence_ids:evidenceIds,
  as_of:asOf,expires_at:expires,buy_ready:false};
 Object.freeze(body.entry_range);Object.freeze(body.evidence_ids);Object.freeze(body.stop_evidence_ids);
 return Object.freeze(body);
}

/** Strict member verifier retains its independent review/hash/time gates. */
export async function verifyDailyAiPricePlan(value:unknown,context:DailyAiPricePlanContext,now=Date.now()):Promise<DailyAiPricePlan|null>{
 const current=nowText(now);if(value===null||value===undefined)return null;
 const r=record(structuredClone(value)),owned=structuredClone(context);
 exact(r,[...bodyKeys,'plan_hash','review']);
 const body=validateDailyAiPricePlanBody(dailyAiPricePlanBody(r as unknown as DailyAiPricePlan),owned,now);
 const asOf=body.as_of,expires=body.expires_at,prepared=owned.edition.prepared_at;
 const review=record(r.review);exact(review,['status','plan_hash','reviewed_at','document_hash']);
 const planHash=hash(r.plan_hash),reviewHash=hash(review.plan_hash),reviewed=time(review.reviewed_at),documentHash=hash(review.document_hash);
 if(review.status!=='PASS'||reviewHash!==planHash||!atMost(asOf,reviewed)||!atMost(prepared,reviewed)
  ||!atMost(reviewed,current)||!before(reviewed,expires))throw Error('AI_PRICE_PLAN_REVIEW');
 if(await snapshotHash(body)!==planHash)throw Error('AI_PRICE_PLAN_HASH_MISMATCH');
 return Object.freeze({...body,plan_hash:planHash,review:Object.freeze({status:'PASS',plan_hash:reviewHash,reviewed_at:reviewed,document_hash:documentHash})});
}

/** Optional UI route: unavailable or rejected plans remain absent. Server
 * ingestion should use the strict verifier so rejection remains observable. */
export async function readDailyAiPricePlan(value:unknown,context:DailyAiPricePlanContext,now=Date.now()):Promise<DailyAiPricePlan|null>{
 try{return await verifyDailyAiPricePlan(value,context,now);}catch{return null;}
}

/** An independent RPC may add plans without breaking the existing research
 * edition parser. Never accept an old account/edition or a Free-tier payload. */
export async function parseDailyAiMemberPricePlans(value:unknown,research:DailyAiMemberResearch,now=Date.now(),expectedSubjectUserId?:string):Promise<DailyAiMemberPricePlans>{
 nowText(now);
 const r=record(structuredClone(value));exact(r,['schema','edition_id','tier','subject_user_id','research_only','plans','source_sets']);
 if(r.schema!=='VNEXT_AI_MEMBER_PRICE_PLANS_V1'||r.research_only!==true||r.tier!==research.tier||!uuid(r.subject_user_id)
  ||expectedSubjectUserId!==undefined&&(!uuid(expectedSubjectUserId)||r.subject_user_id!==expectedSubjectUserId))throw Error('AI_PRICE_PLAN_MEMBER_SCOPE');
 if(!Array.isArray(r.plans)||r.plans.length>216||!Array.isArray(r.source_sets)||r.source_sets.length>72)throw Error('AI_PRICE_PLAN_MEMBER_ARRAY');
 const expectedEdition=research.edition?.id??null;
 if(r.edition_id!==expectedEdition)throw Error('AI_PRICE_PLAN_MEMBER_EDITION');
 if((research.tier==='free'||!research.edition)&&(r.plans.length||r.source_sets.length))throw Error('AI_PRICE_PLAN_MEMBER_SCOPE');
 const owned=structuredClone(research),plans:DailyAiPricePlan[]=[],keys=new Set<string>(),sets=new Map<string,DailyAiPricePlanSourceSet>();
 for(const value of r.source_sets){
  const raw=record(value);exact(raw,['symbol','sources']);const symbol=text(raw.symbol,6);
  if(!/^\d{4,6}$/.test(symbol)||sets.has(symbol)||!Array.isArray(raw.sources)||!raw.sources.length||raw.sources.length>100||!owned.edition)throw Error('AI_PRICE_PLAN_MEMBER_SOURCE');
  const sources=raw.sources.map(value=>parseSource(value,owned.edition!.evidence_cutoff));
  if(new Set(sources.map(source=>source.id)).size!==sources.length)throw Error('AI_PRICE_PLAN_MEMBER_SOURCE');
  sets.set(symbol,Object.freeze({symbol,sources:Object.freeze(sources.map(source=>Object.freeze(source)))}));
 }
 const usedSources=new Map<string,Set<string>>();
 for(const value of r.plans){
  const raw=record(value),key=String(raw.symbol)+':'+String(raw.horizon);
  if(keys.has(key))throw Error('AI_PRICE_PLAN_MEMBER_DUPLICATE');keys.add(key);
  const matches=owned.cards.filter(card=>card.symbol===raw.symbol&&card.horizon===raw.horizon);
  if(!owned.edition||matches.length!==1||matches[0].sources===null)throw Error('AI_PRICE_PLAN_MEMBER_CARD');
  const sources=sets.get(matches[0].symbol)?.sources;
  if(!sources)throw Error('AI_PRICE_PLAN_MEMBER_SOURCE');
  for(const source of sources){
   const overlaps=matches[0].sources.filter(original=>original.id===source.id);
   if(overlaps.length>1||overlaps.length===1&&!sameSource(overlaps[0],source))throw Error('AI_PRICE_PLAN_MEMBER_SOURCE_BINDING');
  }
  const plan=await verifyDailyAiPricePlan(raw,{edition:owned.edition,card:matches[0],evidence:sources},now);
  if(!plan)throw Error('AI_PRICE_PLAN_MEMBER_CARD');plans.push(plan);
  const used=usedSources.get(plan.symbol)??new Set<string>();for(const id of plan.evidence_ids)used.add(id);usedSources.set(plan.symbol,used);
 }
 for(const [symbol,set] of sets){
  const used=usedSources.get(symbol);
  if(!used||set.sources.some(source=>!used.has(source.id))||used.size!==set.sources.length)throw Error('AI_PRICE_PLAN_MEMBER_ORPHAN_SOURCE');
 }
 return Object.freeze({schema:'VNEXT_AI_MEMBER_PRICE_PLANS_V1',edition_id:expectedEdition,tier:owned.tier,
  subject_user_id:r.subject_user_id as string,research_only:true,plans:Object.freeze(plans),source_sets:Object.freeze([...sets.values()])});
}

/** Rendering must pass its current edition; expiry applies even while the
 * research cards remain usable. This never returns a buy-ready instruction. */
export function dailyAiPricePlanForCard(plans:DailyAiMemberPricePlans|null,card:Pick<DailyAiMemberCard,'symbol'|'horizon'|'status'>,editionId:string,now=Date.now(),expectedSubjectUserId?:string):DailyAiPricePlan|null{
 const current=nowText(now);
 if(!plans||plans.schema!=='VNEXT_AI_MEMBER_PRICE_PLANS_V1'||plans.research_only!==true||plans.tier==='free'
  ||plans.edition_id!==editionId||!allowedStatus(card.status)
  ||expectedSubjectUserId!==undefined&&plans.subject_user_id!==expectedSubjectUserId)return null;
 const matches=plans.plans.filter(plan=>plan.symbol===card.symbol&&plan.horizon===card.horizon&&plan.edition_id===editionId);
 if(matches.length!==1)return null;
 const plan=matches[0];
 return plan.status==='VERIFIED'&&plan.buy_ready===false&&atMost(plan.as_of,current)&&atMost(plan.review.reviewed_at,current)
  &&before(current,plan.expires_at)&&plan.plan_hash===plan.review.plan_hash?plan:null;
}
