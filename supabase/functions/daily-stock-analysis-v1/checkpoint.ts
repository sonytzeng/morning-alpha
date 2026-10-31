import {hashValid,snapshotHash} from '../../../src/features/vnext/contracts.ts';
import type {StoredStockAnalysisBatch} from './handler.ts';

/** Stage only a complete private research edition. This checkpoint never
 * reviews, approves or publishes content to members. A retry is idempotent. */
export async function stageCompletedStockAiBatch(summary:unknown,batch:StoredStockAnalysisBatch,modelRevision:string,
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>){
 const pending={edition_id:null,edition_status:'STAGING_PENDING',requires_stage_checkpoint:true,member_published:false} as const;
 try{
  if(!summary||typeof summary!=='object'||Array.isArray(summary))return pending;
  const s=summary as Record<string,unknown>,counts=s.counts as Record<string,unknown>|undefined;
  if(s.status!=='ANALYSIS_COMPLETE'||s.batch_id!==batch.id||s.cutoff!==batch.cutoff||s.requires_next_checkpoint!==false
   ||s.member_published!==false||!counts||!Number.isInteger(counts.CACHED)||!Number.isInteger(counts.COMPLETE)
   ||Number(counts.CACHED)<0||Number(counts.COMPLETE)<0||Number(counts.CACHED)+Number(counts.COMPLETE)!==72
   ||counts.BUSY!==0||counts.FAILED!==0||counts.DEFERRED!==0||batch.packets.length!==72)return pending;
  const keys=await Promise.all(batch.packets.map(async packet=>snapshotHash({version:'DAILY_AI_BATCH_1',
   input_hash:await snapshotHash(packet),model_revision:modelRevision})));
  const value=await rpc('stage_daily_ai_research_edition_v1',{p_batch_id:batch.id,p_job_keys:keys,
   p_expires_at:new Date(Date.parse(batch.cutoff)+72*3600000).toISOString()});
  if(!value||typeof value!=='object'||Array.isArray(value))return pending;
  const staged=value as Record<string,unknown>;
  if(staged.status!=='STAGED_REVIEW_REQUIRED'||typeof staged.edition_id!=='string'||!hashValid(staged.edition_id)
   ||staged.member_published!==false)return pending;
  return {edition_id:staged.edition_id,edition_status:'STAGED_REVIEW_REQUIRED',requires_stage_checkpoint:false,member_published:false} as const;
 }catch{return pending;}
}
