import {hashValid,sourceSafe,validObservationTime} from './contracts.ts';
import {parseDailyAiMember,type DailyAiMemberCard,type DailyAiMemberEdition} from './dailyAiMember.ts';

type ReviewStatus='PASS'|'FAIL'|'PENDING';
export type DailyAiOwnerAudience='free'|'premium';
export type DailyAiOwnerAction='APPROVE'|'REVOKE';
export type DailyAiOwnerReview={id:string;snapshot_hash:string;reviewer_ref:string;quality:ReviewStatus;time_status:ReviewStatus;licensing:ReviewStatus;reason:string;recorded_at:string;expires_at:string;quality_document_hash:string;time_document_hash:string;license_document_hash:string};
export type DailyAiOwnerPublication={id:number;review_id:string;actor:string;action:DailyAiOwnerAction;audience:DailyAiOwnerAudience;occurred_at:string};
export type DailyAiOwnerResearch={schema:'VNEXT_AI_OWNER_EDITION_V1';preview_only:true;edition:(DailyAiMemberEdition&{batch_id:string;jobs:72;periods:216})|null;cards:DailyAiMemberCard[];source_urls:string[];rights_ready:boolean;integrity_ready:boolean;review_ready:boolean;publish_ready:boolean;review:DailyAiOwnerReview|null;publication:DailyAiOwnerPublication|null};
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_OWNER_OBJECT');return value as Record<string,unknown>;};
const text=(value:unknown,max=3000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('AI_OWNER_TEXT');return value;};
const one=<T extends string>(value:unknown,values:readonly T[]):T=>{if(typeof value!=='string'||!values.includes(value as T))throw Error('AI_OWNER_ENUM');return value as T;};
const hash=(value:unknown)=>{const s=text(value,64);if(!hashValid(s))throw Error('AI_OWNER_HASH');return s;};
const uuid=(value:unknown)=>{const s=text(value,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))throw Error('AI_OWNER_UUID');return s;};
const time=(value:unknown)=>{const s=text(value,40);if(!validObservationTime(s))throw Error('AI_OWNER_TIME');return s;};
const bool=(value:unknown)=>{if(typeof value!=='boolean')throw Error('AI_OWNER_BOOLEAN');return value;};
const positiveInteger=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw Error('AI_OWNER_EVENT');return value;};

/** Owner preview remains inspectable after expiry. Its original dates are
 * preserved, and only the separate current-time gates can permit approval. */
export function parseDailyAiOwner(value:unknown,now=Date.now()):DailyAiOwnerResearch{
 if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw Error('AI_OWNER_NOW');
 const p=record(value);if(p.schema!=='VNEXT_AI_OWNER_EDITION_V1'||p.preview_only!==true)throw Error('AI_OWNER_CONTRACT');
 const rights_ready=bool(p.rights_ready),integrity_ready=bool(p.integrity_ready),review_ready=bool(p.review_ready),publish_ready=bool(p.publish_ready);
 if(!Array.isArray(p.cards)||!Array.isArray(p.source_urls)||p.source_urls.length>7200)throw Error('AI_OWNER_ARRAY');
 const source_urls=p.source_urls.map(v=>{const s=text(v,3000);if(!sourceSafe(s))throw Error('AI_OWNER_SOURCE');return s;});
 if(new Set(source_urls).size!==source_urls.length)throw Error('AI_OWNER_SOURCE');
 if(p.edition===null){
  if(p.cards.length||source_urls.length||p.review!==null||p.publication!==null||rights_ready||integrity_ready||review_ready||publish_ready)throw Error('AI_OWNER_EMPTY');
  return {schema:'VNEXT_AI_OWNER_EDITION_V1',preview_only:true,edition:null,cards:[],source_urls:[],review:null,publication:null,rights_ready,integrity_ready,review_ready,publish_ready};
 }
 const rawEdition=record(p.edition),preparedAt=time(rawEdition.prepared_at),expiresAt=time(rawEdition.expires_at);
 if(Date.parse(preparedAt)>now)throw Error('AI_OWNER_CHRONOLOGY');
 // Validate the exact premium card projection at an instant within its own
 // validity window; no expiry or evidence date is rewritten for preview.
 const preview=parseDailyAiMember({schema:'VNEXT_AI_MEMBER_EDITION_V1',tier:'owner',business_date:rawEdition.edition_date,research_only:true,edition:rawEdition,cards:p.cards},undefined,Math.min(now,Date.parse(expiresAt)-1));
 if(!preview.edition||rawEdition.jobs!==72||rawEdition.periods!==216)throw Error('AI_OWNER_UNIVERSE');
 const edition={...preview.edition,batch_id:hash(rawEdition.batch_id),jobs:72 as const,periods:216 as const};
 const urls=new Set(source_urls);if(preview.cards.some(c=>c.sources?.some(s=>!urls.has(s.source))))throw Error('AI_OWNER_SOURCE_SET');
 let review:DailyAiOwnerReview|null=null,publication:DailyAiOwnerPublication|null=null;
 if(p.review!==null){const r=record(p.review);review={id:uuid(r.id),snapshot_hash:hash(r.snapshot_hash),reviewer_ref:text(r.reviewer_ref,200),quality:one(r.quality,['PASS','FAIL','PENDING']),time_status:one(r.time_status,['PASS','FAIL','PENDING']),licensing:one(r.licensing,['PASS','FAIL','PENDING']),reason:text(r.reason),recorded_at:time(r.recorded_at),expires_at:time(r.expires_at),quality_document_hash:hash(r.quality_document_hash),time_document_hash:hash(r.time_document_hash),license_document_hash:hash(r.license_document_hash)};
  if(Date.parse(review.recorded_at)>now||Date.parse(review.expires_at)<=Date.parse(review.recorded_at))throw Error('AI_OWNER_REVIEW_TIME');
 }
 if(p.publication!==null){const a=record(p.publication);publication={id:positiveInteger(a.id),review_id:uuid(a.review_id),actor:uuid(a.actor),action:one(a.action,['APPROVE','REVOKE']),audience:one(a.audience,['free','premium']),occurred_at:time(a.occurred_at)};
  if(Date.parse(publication.occurred_at)>now||Date.parse(publication.occurred_at)<Date.parse(preparedAt))throw Error('AI_OWNER_PUBLICATION_TIME');
 }
 const reviewPass=review!==null&&review.snapshot_hash===edition.id&&review.quality==='PASS'&&review.time_status==='PASS'&&review.licensing==='PASS';
 // False flags can reflect a concurrent server-side change. True flags must
 // agree with the review actually returned; expiry is rechecked per action.
 if(review_ready&&!reviewPass||publish_ready&&(!rights_ready||!integrity_ready||!review_ready))throw Error('AI_OWNER_READINESS');
 return {schema:'VNEXT_AI_OWNER_EDITION_V1',preview_only:true,edition,cards:preview.cards,source_urls,review,publication,rights_ready,integrity_ready,review_ready,publish_ready};
}

export function dailyAiOwnerCanApprove(data:DailyAiOwnerResearch,now=Date.now()):boolean{
 const e=data.edition,r=data.review;
 return Number.isFinite(now)&&!!e&&!!r&&data.publish_ready&&data.rights_ready&&data.integrity_ready&&data.review_ready&&r.snapshot_hash===e.id
  &&r.quality==='PASS'&&r.time_status==='PASS'&&r.licensing==='PASS'&&Date.parse(e.prepared_at)<=now&&Date.parse(e.expires_at)>now&&Date.parse(r.recorded_at)<=now&&Date.parse(r.expires_at)>now;
}
export function dailyAiOwnerCanRevoke(data:DailyAiOwnerResearch):boolean{return !!data.edition&&!!data.review&&data.publication?.action==='APPROVE';}
export function dailyAiOwnerReviewRequest(data:DailyAiOwnerResearch,action:DailyAiOwnerAction,audience:DailyAiOwnerAudience,requestKey:string,now=Date.now()){
 one(action,['APPROVE','REVOKE']);one(audience,['free','premium']);uuid(requestKey);
 if(!data.edition||!data.review||(action==='APPROVE'?!dailyAiOwnerCanApprove(data,now):!dailyAiOwnerCanRevoke(data)))throw Error('AI_OWNER_NOT_READY');
 return {p_edition_id:data.edition.id,p_review_id:data.review.id,p_action:action,p_audience:audience,p_request_key:requestKey};
}
export function parseDailyAiOwnerReviewResult(value:unknown,action:DailyAiOwnerAction){
 const r=record(value);if(r.action!==action)throw Error('AI_OWNER_ACTION');return {event_id:positiveInteger(r.event_id),action,replayed:bool(r.replayed)};
}
