/** A bounded, fail-open research notification after an authoritative Core batch.
 * Never calls Fetch/Report/LINE, never waits for stock acquisition in Core. */
import { buildInternalFunctionHeaders } from './internal-function-auth.mjs';
export type V2ForwardTrigger = {business_date:string;checkpoint:string;batch_id:string;core_complete:boolean;force_run?:boolean;beneficiary_close_only?:boolean};
export function forwardTriggerBody(input:V2ForwardTrigger){
 const phase=input.checkpoint==='PREMARKET'?'PREMARKET':({'0900':'09:00','0930':'09:30','1030':'10:30','1300':'13:00','1410':'14:10','1430':'14:30'} as Record<string,string>)[input.checkpoint];
 if(!input.core_complete||input.force_run||input.beneficiary_close_only||!phase||!/^\d{4}-\d{2}-\d{2}$/.test(input.business_date)||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.batch_id))return null;
 return {business_date:input.business_date,evaluation_phase:phase,source_batch_id:input.batch_id};
}
export function scheduleV2ForwardTrigger(input:V2ForwardTrigger,options:{url:string;cronSecret:string;serviceRoleKey:string;gatewayAnonJwt:string;fetcher:typeof fetch;waitUntil?:((p:Promise<unknown>)=>void)}){
 const body=forwardTriggerBody(input);
 if(!body||!options.waitUntil||!options.cronSecret||!options.serviceRoleKey||!/^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(options.gatewayAnonJwt))return;
 try{
  const work=options.fetcher(options.url+'/functions/v1/recommendation-v2-forward-worker-v1',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(6000),
   headers:{...buildInternalFunctionHeaders({cronSecret:options.cronSecret,serviceRoleKey:options.serviceRoleKey,source:'fetch-market-data-v10'}),Authorization:`Bearer ${options.gatewayAnonJwt}`},
   body:JSON.stringify(body),
  }).then(async r=>{await r.body?.cancel();return r.status===202?'SHADOW_ACCEPTED':'SHADOW_UNAVAILABLE';},()=> 'SHADOW_UNAVAILABLE');
  options.waitUntil(work);
 }catch{/* Research notification cannot throw into Core's response. */}
}
