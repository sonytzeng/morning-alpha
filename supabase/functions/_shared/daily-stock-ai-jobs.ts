import type {AnalysisJobs} from '../../../research/daily-ai-batch.ts';
import {canonical} from '../../../research/entry-opportunity.ts';

export function stockAiJobStore(rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>):AnalysisJobs{
 const call=(args:Record<string,unknown>)=>rpc('daily_stock_ai_job_v1',args);
 return {
  claim:async(key,context)=>{
   const result=await call({p_op:'CLAIM',p_key:key,p_identity_text:canonical({version:'DAILY_AI_BATCH_1',input_hash:context.input_hash,model_revision:context.model_revision}),p_context:context});
   if(!result||typeof result!=='object'||!('state' in result)||!['BUSY','EXHAUSTED','CACHED','ACQUIRED'].includes(String(result.state)))throw Error('AI_BATCH_JOB_RESPONSE');
   if(result.state==='ACQUIRED'&&(!('lease' in result)||typeof result.lease!=='string'))throw Error('AI_BATCH_JOB_LEASE');
   if(result.state==='CACHED'&&!('result' in result))throw Error('AI_BATCH_JOB_CACHE');
   return result as Awaited<ReturnType<AnalysisJobs['claim']>>;
  },
  complete:async(key,lease,result)=>{const r=await call({p_op:'COMPLETE',p_key:key,p_lease:lease,p_result:result});if(!r||typeof r!=='object'||!('state' in r)||r.state!=='STORED')throw Error('AI_BATCH_SAVE_UNCONFIRMED');},
  fail:async(key,lease,code)=>{const r=await call({p_op:'FAIL',p_key:key,p_lease:lease,p_code:code});if(!r||typeof r!=='object'||!('state' in r)||r.state!=='STORED')throw Error('AI_BATCH_FAILURE_SAVE_UNCONFIRMED');},
 };
}
