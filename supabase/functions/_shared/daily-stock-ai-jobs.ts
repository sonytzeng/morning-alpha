import type {AnalysisJobs} from '../../../research/daily-ai-batch.ts';
import {canonical} from '../../../research/entry-opportunity.ts';

/** The durable RPC is privileged but its returned/cache bytes still need a
 * server receipt check before use. Receipt presence never grants publication. */
function validateServerReceipt(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_BATCH_JOB_RECEIPT');
 const result=value as Record<string,unknown>,receipt=result.receipt;
 if(result.publication_ready!==false||!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw Error('AI_BATCH_JOB_RECEIPT');
 const r=receipt as Record<string,unknown>;
 if(typeof r.response_id!=='string'||!r.response_id.trim()||r.response_id.length>200
  ||typeof r.model!=='string'||!r.model.trim()||r.model.length>200
  ||!Number.isSafeInteger(r.input_tokens)||Number(r.input_tokens)<0
  ||!Number.isSafeInteger(r.output_tokens)||Number(r.output_tokens)<0)throw Error('AI_BATCH_JOB_RECEIPT');
}
export function stockAiJobStore(rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>,completed?:Record<string,unknown>):AnalysisJobs{
 const call=(args:Record<string,unknown>)=>rpc('daily_stock_ai_job_v1',args);
 return {
  claim:async(key,context)=>{
   if(completed&&Object.hasOwn(completed,key)){
    const result=completed[key];validateServerReceipt(result);
    return {state:'CACHED',result} as Extract<Awaited<ReturnType<AnalysisJobs['claim']>>,{state:'CACHED'}>;
   }
   const result=await call({p_op:'CLAIM',p_key:key,p_identity_text:canonical({version:'DAILY_AI_BATCH_1',input_hash:context.input_hash,model_revision:context.model_revision}),p_context:context});
   if(!result||typeof result!=='object'||!('state' in result)||!['BUSY','EXHAUSTED','CACHED','ACQUIRED'].includes(String(result.state)))throw Error('AI_BATCH_JOB_RESPONSE');
   if(result.state==='ACQUIRED'&&(!('lease' in result)||typeof result.lease!=='string'))throw Error('AI_BATCH_JOB_LEASE');
   if(result.state==='CACHED'&&!('result' in result))throw Error('AI_BATCH_JOB_CACHE');
   if(result.state==='CACHED'&&'result' in result)validateServerReceipt(result.result);
   return result as Awaited<ReturnType<AnalysisJobs['claim']>>;
  },
  complete:async(key,lease,result)=>{validateServerReceipt(result);const r=await call({p_op:'COMPLETE',p_key:key,p_lease:lease,p_result:result});if(!r||typeof r!=='object'||!('state' in r)||r.state!=='STORED')throw Error('AI_BATCH_SAVE_UNCONFIRMED');},
  fail:async(key,lease,code)=>{const r=await call({p_op:'FAIL',p_key:key,p_lease:lease,p_code:code});if(!r||typeof r!=='object'||!('state' in r)||r.state!=='STORED')throw Error('AI_BATCH_FAILURE_SAVE_UNCONFIRMED');},
 };
}
