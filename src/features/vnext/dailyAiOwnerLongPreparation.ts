import {compareTime,hashValid,snapshotHash,validObservationTime} from './contracts.ts';
import type {DailyAiMemberCard,DailyAiMemberEdition} from './dailyAiMember.ts';
import {parseDailyAiOwnerCalculationDocuments,type OwnerCalculationDetails} from './dailyAiOwnerPriceCalculation.ts';

type JsonObject=Record<string,unknown>;
export type OwnerLongPreparationScope=Readonly<{edition:DailyAiMemberEdition;card:DailyAiMemberCard}>;
export type OwnerLongReviewItem=Readonly<{kind:'DEMAND'|'MOAT'|'VALUATION';observation_status:string;evidence_ids:readonly string[];
 rationale:string;judgment_required:string;observations:JsonObject|null}>;
export type OwnerLongPreparation=Readonly<{status:'DATA_REQUIRED_REVIEW_PREPARATION'|'READY_FOR_REVIEW';as_of:string;expires_at:string;
 input_hash:string;calculation_hash:string;preparation_hash:string;packet_hash:string;recorded_at:string;
 calculation:OwnerCalculationDetails;review_items:readonly OwnerLongReviewItem[];
 missing:readonly Readonly<{code:string;field:string;detail:string}>[];pending_source_intake:readonly string[];
 raw_preparation_text:string}>;
export type DailyAiOwnerLongPreparation=Readonly<{schema:'DAILY_AI_OWNER_LONG_PREPARATION_V1';edition_id:string;symbol:string;horizon:'LONG';
 subject_user_id:string;research_only:true;preview_only:true;preparation:OwnerLongPreparation|null}>;

function fail(code:string):never{throw Error('OWNER_LONG_PREPARATION_'+code);}
const object=(v:unknown):JsonObject=>{if(v===null||typeof v!=='object'||Array.isArray(v))return fail('OBJECT');return v as JsonObject;};
const exact=(v:JsonObject,keys:readonly string[])=>{if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail('FIELDS');};
const text=(v:unknown,max=1500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)return fail('TEXT');return v;};
const hash=(v:unknown)=>{const h=text(v,64);if(!hashValid(h))fail('HASH');return h;};
const time=(v:unknown)=>{const t=text(v,40);if(!validObservationTime(t))fail('TIME');return t;};
const list=(v:unknown,max=2000)=>{if(!Array.isArray(v)||v.length>max)return fail('ARRAY');return v;};
const ids=(v:unknown)=>{const out=list(v).map(x=>text(x,200));if(new Set(out).size!==out.length)fail('DUPLICATE');return out;};
const same=async(a:unknown,b:unknown)=>{if(await snapshotHash(a)!==await snapshotHash(b))fail('BINDING');};
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};

/** An Owner-only, edition-bound research preparation. It deliberately has no
 * price-plan identity, review receipt or publication permission. The server
 * verifies its packet commitment; the reader additionally verifies retained
 * input, calculation and rationale bytes plus every link between them. */
export async function parseDailyAiOwnerLongPreparation(value:unknown,expected:OwnerLongPreparationScope,subjectUserId:string,now=Date.now()):Promise<DailyAiOwnerLongPreparation>{
 const v=object(structuredClone(value)),scope=structuredClone(expected),{edition,card}=scope;
 exact(v,['schema','edition_id','symbol','horizon','subject_user_id','research_only','preview_only','preparation']);
 if(!hashValid(edition.id)||!/^\d{4,6}$/.test(card.symbol)||card.horizon!=='LONG'
  ||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subjectUserId)
  ||v.schema!=='DAILY_AI_OWNER_LONG_PREPARATION_V1'||v.edition_id!==edition.id||v.symbol!==card.symbol||v.horizon!=='LONG'
  ||v.subject_user_id!==subjectUserId||v.research_only!==true||v.preview_only!==true)fail('SCOPE');
 const envelope={schema:'DAILY_AI_OWNER_LONG_PREPARATION_V1' as const,edition_id:edition.id,symbol:card.symbol,horizon:'LONG' as const,
  subject_user_id:subjectUserId,research_only:true as const,preview_only:true as const};
 if(v.preparation===null)return freeze({...envelope,preparation:null});
 const a=object(v.preparation);exact(a,['input_hash','input_text','calculation_hash','calculation_text','preparation_hash','preparation_text','recorded_at']);
 const core=await parseDailyAiOwnerCalculationDocuments({input_hash:a.input_hash,input_text:a.input_text,calculation_hash:a.calculation_hash,
  calculation_text:a.calculation_text,recorded_at:a.recorded_at},{symbol:card.symbol,horizon:'LONG'},now);
 const raw=text(a.preparation_text,400000),preparationHash=hash(a.preparation_hash),bytes=new TextEncoder().encode(raw);
 if(bytes.length>400000)fail('SIZE');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==preparationHash)fail('HASH_MISMATCH');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return fail('JSON');}
 const p=object(parsed),c=core.calculation,d=core.details;
 if(await snapshotHash(p)!==preparationHash)fail('CANONICAL_HASH');
 if(p.schema!=='DAILY_AI_LONG_REVIEW_PREPARATION_V1'||p.symbol!==card.symbol||p.horizon!=='LONG'
  ||typeof p.status!=='string'||!['DATA_REQUIRED_REVIEW_PREPARATION','READY_FOR_REVIEW'].includes(p.status)||p.review!==null||p.selection_qualified!==false
  ||p.methodology_approved!==false||p.source_admitted!==false||p.member_published!==false||p.forecast!==false||p.performance_available!==false
  ||'preparation_hash' in p||'calculation_hash' in c)fail('STATE');
 const asOf=time(p.as_of),expiry=time(p.expires_at),recorded=time(a.recorded_at),cutoff=time(p.cutoff),editionExpiry=time(edition.expires_at);
 const expectedExpiry=compareTime(d.expires_at,editionExpiry)<0?d.expires_at:editionExpiry;
 if(cutoff!==d.cutoff||compareTime(cutoff,time(edition.evidence_cutoff))!==0||p.data_through!==d.data_through||p.data_through!==edition.data_through
  ||asOf!==d.as_of||compareTime(expiry,expectedExpiry)!==0||compareTime(asOf,expiry)>=0||compareTime(asOf,recorded)>0)fail('CHRONOLOGY');
 const valuation=object(p.valuation_calculation);exact(valuation,['calculation_hash','input_hash','assumption_hash','method_id','trace','method_note']);
 if(valuation.calculation_hash!==d.calculation_hash||valuation.input_hash!==d.input_hash||valuation.assumption_hash!==c.assumption_hash
  ||valuation.method_id!==d.method_id)fail('CALCULATION_BINDING');
 await same(valuation.trace,c.trace);await same(valuation.method_note,c.method_note);
 const evidenceIds=new Set(list(core.input.evidence).map(raw=>text(object(raw).id,200)));
 const checkIds=(v:unknown)=>{const out=ids(v);if(out.some(id=>!evidenceIds.has(id)))fail('EVIDENCE_BINDING');return out;};
 const items=list(p.review_items,3);if(items.length!==3)fail('REVIEW_ITEMS');
 const reviewItems:OwnerLongReviewItem[]=[];
 for(let index=0;index<items.length;index++){
  const item=object(items[index]),kind=(['DEMAND','MOAT','VALUATION'] as const)[index];
  if(item.kind!==kind||item.review_status!=='REVIEW_REQUIRED'||item.verdict!==null)fail('REVIEW_STATE');
  const observationStatus=text(item.observation_status,80),itemEvidence=checkIds(item.evidence_ids),observations=item.observations===null?null:object(item.observations);
  if(kind==='VALUATION'){
   if(observationStatus!=='CALCULATED_FROM_CURRENT_PACKET'||item.calculation_hash!==d.calculation_hash||item.method_id!==d.method_id||observations===null)fail('VALUATION_BINDING');
   await same(itemEvidence,c.evidence_ids);
   await same(observations,{quote:d.quote,entry_range:d.entry_range,wait_above:d.wait_above,
    relation:d.quote<d.entry_range[0]?'BELOW_SELECTED_RANGE':d.quote>d.entry_range[1]?'ABOVE_SELECTED_RANGE':'WITHIN_SELECTED_RANGE',is_execution_instruction:false});
  }else if(!['AVAILABLE_IN_PACKET','SOURCE_REQUIRED'].includes(observationStatus))fail('OBSERVATION_STATE');
  reviewItems.push({kind,observation_status:observationStatus,evidence_ids:itemEvidence,observations,
   rationale:text(item.rationale_zh,10000),judgment_required:text(item.judgment_required_zh,10000)});
 }
 const context=object(p.existing_review_context);if(context.state!=='NOT_REUSED_FOR_NEW_JUDGMENT')fail('REVIEW_REUSE');checkIds(context.evidence_ids);
 const missing=list(p.missing,100).map(raw=>{const m=object(raw);exact(m,['code','field','detail']);return {code:text(m.code,200),field:text(m.field,200),detail:text(m.detail,10000)};});
 if((missing.length>0)!==(p.status==='DATA_REQUIRED_REVIEW_PREPARATION'))fail('MISSING_STATE');
 hash(p.actuals_hash);const packetHash=hash(p.packet_hash),pending=ids(p.pending_source_intake);if(p.source_supplement_hash!==null)hash(p.source_supplement_hash);
 {const observation=object(p.price_observation),source=list(core.input.evidence).map(object).find(e=>e.id===observation.evidence_id);
  if(!source||source.kind!=='PRICE'||observation.close!==d.quote||observation.date!==d.data_through||observation.source!==source.source
   ||observation.evidence_id!==core.input.quote_evidence_id||observation.available_at!==source.available_at||observation.scope!=='RETAINED_PACKET_AS_OF_CUTOFF_NOT_REALTIME')fail('QUOTE_BINDING');
 }
 return freeze({...envelope,preparation:{status:p.status as OwnerLongPreparation['status'],as_of:asOf,expires_at:expiry,
  input_hash:d.input_hash,calculation_hash:d.calculation_hash,preparation_hash:preparationHash,packet_hash:packetHash,recorded_at:recorded,
  calculation:d,review_items:reviewItems,missing,pending_source_intake:pending,raw_preparation_text:raw}});
}
