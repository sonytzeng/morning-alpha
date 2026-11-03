import {parseDailyAiMemberPricePlans,type DailyAiMemberPricePlans} from './dailyAiPricePlan.ts';
import type {DailyAiMemberResearch} from './dailyAiMember.ts';
import type {DailyAiMemberReadScope} from './dailyAiMemberDelta.ts';

export type DailyAiPricePlanCache={scope:DailyAiMemberReadScope;data:DailyAiMemberPricePlans};
export type DailyAiPricePlanTransport=(editionId:string,signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>;
export class DailyAiPricePlanReadError extends Error{
 readonly code:'SCOPE'|'UNAVAILABLE'|'ABORTED'|'DEADLINE';
 constructor(code:DailyAiPricePlanReadError['code']){super('AI_PRICE_PLAN_READ_'+code);this.code=code;}
}

/** A matching RAM result remains a display cache, never an entitlement. The
 * actual card lookup rechecks individual plan expiry at every render. */
export function eligibleDailyAiPricePlanCache(cache:DailyAiPricePlanCache|null,scope:DailyAiMemberReadScope,research:DailyAiMemberResearch,now=Date.now()):cache is DailyAiPricePlanCache{
 return !!cache&&Number.isFinite(now)&&!scope.signal.aborted&&!cache.scope.signal.aborted
  &&cache.scope.identity===scope.identity&&cache.scope.generation===scope.generation&&cache.scope.signal===scope.signal
  &&cache.scope.tier===scope.tier&&cache.scope.requestDate===scope.requestDate
  &&research.tier===scope.tier&&research.business_date===scope.requestDate&&scope.tier!=='free'
  &&!!research.edition&&Date.parse(research.edition.expires_at)>now
  &&cache.data.edition_id===research.edition.id&&cache.data.tier===scope.tier&&cache.data.subject_user_id===scope.identity;
}

/** Optional, independently bounded read. No browser tier or identity is sent to
 * the server; its existing member reader decides which plans may be returned.
 * An absent add-on or transport failure never changes the research projection. */
export async function readDailyAiMemberPricePlans(inputResearch:DailyAiMemberResearch,inputScope:DailyAiMemberReadScope,transport:DailyAiPricePlanTransport):Promise<DailyAiMemberPricePlans|null>{
 const scope={...inputScope};
 if(scope.signal.aborted)throw new DailyAiPricePlanReadError('ABORTED');
 // Own the visible version before yielding to a transport or hashing promise.
 const research=structuredClone(inputResearch);
 if(research.tier!==scope.tier||research.business_date!==scope.requestDate)throw new DailyAiPricePlanReadError('SCOPE');
 if(scope.tier==='free'||!research.edition)return null;
 if(!Number.isFinite(Date.parse(research.edition.expires_at))||Date.parse(research.edition.expires_at)<=Date.now())throw new DailyAiPricePlanReadError('SCOPE');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
 try{
  const canceled=new Promise<never>((_,reject)=>{
   abort=()=>{clearTimeout(timer);controller.abort();reject(new DailyAiPricePlanReadError('ABORTED'));};
   scope.signal.addEventListener('abort',abort,{once:true});if(scope.signal.aborted)abort();
  });
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new DailyAiPricePlanReadError('DEADLINE'));},8000);});
  const response=await Promise.race([Promise.resolve().then(()=>{
   if(scope.signal.aborted)throw new DailyAiPricePlanReadError('ABORTED');
   return transport(research.edition!.id,controller.signal);
  }),canceled,deadline]);
  if(scope.signal.aborted||controller.signal.aborted)throw new DailyAiPricePlanReadError('ABORTED');
  if(response.error){
   if(typeof response.error==='object'&&response.error!==null&&'code' in response.error&&response.error.code==='42501')throw new DailyAiPricePlanReadError('SCOPE');
   throw new DailyAiPricePlanReadError('UNAVAILABLE');
  }
  if(response.data&&typeof response.data==='object'&&'subject_user_id' in response.data
   &&(response.data.subject_user_id!==scope.identity||'tier' in response.data&&response.data.tier!==scope.tier))throw new DailyAiPricePlanReadError('SCOPE');
  const plans=await parseDailyAiMemberPricePlans(response.data,research,Date.now(),scope.identity);
  if(scope.signal.aborted||controller.signal.aborted)throw new DailyAiPricePlanReadError('ABORTED');
  return plans;
 }finally{
  clearTimeout(timer);if(abort)scope.signal.removeEventListener('abort',abort);controller.abort();
 }
}
