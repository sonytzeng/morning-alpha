import {HORIZONS,compareTime,hashValid,validObservationTime} from './contracts.ts';
import {hashDailyAiPricePlanBody,type DailyAiPricePlanBody} from './dailyAiPricePlan.ts';

type ReviewState='PASS'|'FAIL'|'PENDING';
export type DailyAiOwnerPriceAction='APPROVE'|'REVOKE';
export type DailyAiOwnerPriceReview=Readonly<{id:string;quality:ReviewState;time_status:ReviewState;source_use:ReviewState;methodology:ReviewState;
 document_hash:string;reviewed_at:string;expires_at:string}>;
export type DailyAiOwnerPricePublication=Readonly<{id:number;review_id:string;action:DailyAiOwnerPriceAction;occurred_at:string}>;
export type DailyAiOwnerPriceRow=Readonly<{plan_hash:string;body:DailyAiPricePlanBody;review:DailyAiOwnerPriceReview|null;
 publication:DailyAiOwnerPricePublication|null;can_approve:boolean}>;
export type DailyAiOwnerPricePlans=Readonly<{schema:'VNEXT_AI_OWNER_PRICE_PLANS_V1';edition_id:string;subject_user_id:string;
 research_only:true;preview_only:true;plans:readonly DailyAiOwnerPriceRow[]}>;
const bodyKeys=['schema','edition_id','symbol','horizon','status','currency','method','basis','entry_range','wait_above',
 'stop_kind','stop','stop_evidence_ids','invalidation','evidence_ids','as_of','expires_at','buy_ready'];
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('OWNER_PRICE_OBJECT');return v as Record<string,unknown>;};
const exact=(v:Record<string,unknown>,keys:readonly string[])=>{if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))throw Error('OWNER_PRICE_FIELDS');};
const text=(v:unknown,max=1500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('OWNER_PRICE_TEXT');return v;};
const hash=(v:unknown)=>{const value=text(v,64);if(!hashValid(value))throw Error('OWNER_PRICE_HASH');return value;};
const uuid=(v:unknown)=>{const value=text(v,36);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))throw Error('OWNER_PRICE_UUID');return value;};
const time=(v:unknown)=>{const value=text(v,40);if(!validObservationTime(value))throw Error('OWNER_PRICE_TIME');return value;};
const nowText=(now:number)=>{if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw Error('OWNER_PRICE_NOW');return new Date(now).toISOString();};
const positive=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0)throw Error('OWNER_PRICE_RANGE');return v;};
const ids=(v:unknown)=>{if(!Array.isArray(v)||!v.length||v.length>100)throw Error('OWNER_PRICE_REFERENCES');const result=v.map(id=>text(id,200));if(new Set(result).size!==result.length)throw Error('OWNER_PRICE_REFERENCES');return Object.freeze(result);};
const state=(v:unknown):ReviewState=>{if(v!=='PASS'&&v!=='FAIL'&&v!=='PENDING')throw Error('OWNER_PRICE_REVIEW_STATE');return v;};
const action=(v:unknown):DailyAiOwnerPriceAction=>{if(v!=='APPROVE'&&v!=='REVOKE')throw Error('OWNER_PRICE_ACTION');return v;};
const atMost=(a:string,b:string)=>compareTime(a,b)<=0;
const before=(a:string,b:string)=>compareTime(a,b)<0;

/** Private preview may retain an expired or failed-review candidate. These
 * checks bind its exact body; they do not invent a missing independent review. */
export async function parseDailyAiOwnerPricePlans(value:unknown,editionId:string,subjectUserId:string,now=Date.now()):Promise<DailyAiOwnerPricePlans>{
 const current=nowText(now),v=object(structuredClone(value));hash(editionId);uuid(subjectUserId);
 exact(v,['schema','edition_id','subject_user_id','research_only','preview_only','plans']);
 if(v.schema!=='VNEXT_AI_OWNER_PRICE_PLANS_V1'||v.edition_id!==editionId||v.subject_user_id!==subjectUserId
  ||v.research_only!==true||v.preview_only!==true)throw Error('OWNER_PRICE_SCOPE');
 if(!Array.isArray(v.plans)||v.plans.length>216)throw Error('OWNER_PRICE_UNIVERSE');
 const plans:DailyAiOwnerPriceRow[]=[],keys=new Set<string>();
 for(const raw of v.plans){
  const row=object(raw);exact(row,['plan_hash','body','review','publication','can_approve']);
  const b=object(row.body);exact(b,bodyKeys);
  if(b.schema!=='DAILY_AI_PRICE_PLAN_V1'||b.edition_id!==editionId||b.status!=='VERIFIED'||b.currency!=='TWD'||b.buy_ready!==false
   ||typeof b.symbol!=='string'||!/^\d{4,6}$/.test(b.symbol)||typeof b.horizon!=='string'||!Object.hasOwn(HORIZONS,b.horizon))throw Error('OWNER_PRICE_BODY_SCOPE');
  const key=b.symbol+':'+b.horizon;if(keys.has(key))throw Error('OWNER_PRICE_DUPLICATE');keys.add(key);
  if(!Array.isArray(b.entry_range)||b.entry_range.length!==2)throw Error('OWNER_PRICE_RANGE');
  const low=positive(b.entry_range[0]),high=positive(b.entry_range[1]),wait=positive(b.wait_above);
  if(low>high||wait<high)throw Error('OWNER_PRICE_RANGE');
  const references=ids(b.evidence_ids),stopReferences=ids(b.stop_evidence_ids);
  if(stopReferences.some(id=>!references.includes(id)))throw Error('OWNER_PRICE_REFERENCES');
  if(b.stop_kind==='PRICE'){if(positive(b.stop)>=low)throw Error('OWNER_PRICE_STOP');}
  else if(b.stop_kind!=='EVENT'||b.stop!==null)throw Error('OWNER_PRICE_STOP');
  const asOf=time(b.as_of),expires=time(b.expires_at);
  if(!atMost(asOf,current)||!before(asOf,expires))throw Error('OWNER_PRICE_CHRONOLOGY');
  const body:DailyAiPricePlanBody=Object.freeze({schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:editionId,symbol:b.symbol,horizon:b.horizon as DailyAiPricePlanBody['horizon'],
   status:'VERIFIED',currency:'TWD',method:text(b.method,200),basis:text(b.basis),entry_range:Object.freeze([low,high]) as readonly [number,number],wait_above:wait,
   stop_kind:b.stop_kind as DailyAiPricePlanBody['stop_kind'],stop:b.stop as number|null,stop_evidence_ids:stopReferences,
   invalidation:text(b.invalidation),evidence_ids:references,as_of:asOf,expires_at:expires,buy_ready:false});
  const planHash=hash(row.plan_hash);if(await hashDailyAiPricePlanBody(body)!==planHash)throw Error('OWNER_PRICE_HASH_MISMATCH');
  let review:DailyAiOwnerPriceReview|null=null,publication:DailyAiOwnerPricePublication|null=null;
  if(row.review!==null){
   const r=object(row.review);exact(r,['id','quality','time_status','source_use','methodology','document_hash','reviewed_at','expires_at']);
   const reviewed=time(r.reviewed_at),reviewExpiry=time(r.expires_at);
   if(!atMost(asOf,reviewed)||!atMost(reviewed,current)||!before(reviewed,reviewExpiry)||compareTime(reviewExpiry,expires)!==0)throw Error('OWNER_PRICE_REVIEW_TIME');
   review=Object.freeze({id:uuid(r.id),quality:state(r.quality),time_status:state(r.time_status),source_use:state(r.source_use),methodology:state(r.methodology),
    document_hash:hash(r.document_hash),reviewed_at:reviewed,expires_at:reviewExpiry});
  }
  if(row.publication!==null){
   const p=object(row.publication);exact(p,['id','review_id','action','occurred_at']);
   if(!Number.isSafeInteger(p.id)||Number(p.id)<1)throw Error('OWNER_PRICE_PUBLICATION');
   const occurred=time(p.occurred_at);if(!atMost(asOf,occurred)||!atMost(occurred,current))throw Error('OWNER_PRICE_PUBLICATION_TIME');
   publication=Object.freeze({id:p.id as number,review_id:uuid(p.review_id),action:action(p.action),occurred_at:occurred});
   if(!review)throw Error('OWNER_PRICE_PUBLICATION');
  }
  if(typeof row.can_approve!=='boolean'||row.can_approve&&(!review||[review.quality,review.time_status,review.source_use,review.methodology].some(s=>s!=='PASS')))throw Error('OWNER_PRICE_GATES');
  plans.push(Object.freeze({plan_hash:planHash,body,review,publication,can_approve:row.can_approve}));
 }
 return Object.freeze({schema:'VNEXT_AI_OWNER_PRICE_PLANS_V1',edition_id:editionId,subject_user_id:subjectUserId,research_only:true,preview_only:true,plans:Object.freeze(plans)});
}

export function dailyAiOwnerPriceCanApprove(row:DailyAiOwnerPriceRow,now=Date.now()):boolean{
 try{const current=nowText(now),r=row.review;return row.can_approve&&!!r&&[r.quality,r.time_status,r.source_use,r.methodology].every(s=>s==='PASS')
  &&atMost(row.body.as_of,current)&&atMost(r.reviewed_at,current)&&before(current,row.body.expires_at)&&before(current,r.expires_at);
 }catch{return false;}
}
export function dailyAiOwnerPriceCanRevoke(row:DailyAiOwnerPriceRow){return !!row.review&&row.publication?.action==='APPROVE';}
export function dailyAiOwnerPriceReviewRequest(row:DailyAiOwnerPriceRow,editionId:string,requestedAction:DailyAiOwnerPriceAction,requestKey:string,now=Date.now()){
 if(row.body.edition_id!==hash(editionId)||!row.review)throw Error('OWNER_PRICE_ACTION_SCOPE');
 const choice=action(requestedAction);
 if(choice==='APPROVE'?!dailyAiOwnerPriceCanApprove(row,now):!dailyAiOwnerPriceCanRevoke(row))throw Error('OWNER_PRICE_NOT_READY');
 return Object.freeze({p_plan_hash:hash(row.plan_hash),p_review_id:uuid(row.review.id),p_action:choice,p_request_key:uuid(requestKey)});
}
export function parseDailyAiOwnerPriceReviewResult(value:unknown,expected:DailyAiOwnerPriceAction){
 const r=object(value);if(!Number.isSafeInteger(r.event_id)||Number(r.event_id)<1||r.action!==expected||typeof r.replayed!=='boolean')throw Error('OWNER_PRICE_ACTION_RESULT');
 return {event_id:r.event_id as number,action:action(r.action),replayed:r.replayed};
}

/** Browser timers cannot represent a fraction of a millisecond. */
export function dailyAiOwnerPriceDeadlineMs(value:string){const ms=Date.parse(value);return Number.isFinite(ms)&&compareTime(value,new Date(ms).toISOString())>0?ms+1:ms;}
