/** Pure review-artifact builder. Never edits the live checkout's index,
 * calls a service, dispatches work or grants publication. Compose only with
 * an explicitly pinned fresh base (including a reviewed V2 source adapter). */
import {createHash} from 'node:crypto';

export const sha256=text=>createHash('sha256').update(text).digest('hex');
const importAnchor="import {handleDailyStockCitationRepair} from './repair-handler.ts';";
const routeAnchor=" if(input&&typeof input==='object'&&!Array.isArray(input)&&(Object.hasOwn(input,'repair_symbol')||Object.hasOwn(input,'review_document_hash'))){";
const continueAnchor="if(autoContinue&&summary.requires_next_checkpoint===true&&summary.model_calls===1&&typeof summary.batch_id==='string')";
const imports="\nimport {handleDailyStockRateLimitRecovery} from './rate-limit-recovery-handler.ts';\nimport {runStoredStockAiRateLimitRecovery,stockAiRateLimitRecoveryRevision} from './rate-limit-recovery-runner.ts';";
const recoveryRoute=` if(input&&typeof input==='object'&&!Array.isArray(input)&&Object.hasOwn(input,'recovery_symbol')){
  return handleDailyStockRateLimitRecovery(req,{
   internalSecret,clock:()=>new Date().toISOString(),
   loadBatch:(batchId,signal)=>loadOrIntakeDailyStockAiBatch({batch_id:batchId},rpc,signal),
   loadFence:(selector,signal)=>rpc('load_daily_stock_ai_rate_limit_recovery_v1',{p_batch_id:selector.batch_id,p_symbol:selector.recovery_symbol,p_review_document_hash:selector.review_document_hash},signal),
   runRecovery:(packets,selector,signal)=>runStoredStockAiRateLimitRecovery(packets,selector,{
    rpc:(name,args)=>rpc(name,args,args.p_op==='COMPLETE'?undefined:signal),
    apiKey:Deno.env.get('OPENAI_API_KEY')??'',fetcher:fetch,signal,
    onCandidate:async(candidate,receipt,inputHash,packet)=>{
     const retained=await rpc('retain_daily_ai_model_candidate_v1',{p_input_hash:inputHash,p_model_revision:stockAiRateLimitRecoveryRevision,
      p_symbol:packet.symbol,p_cutoff:packet.cutoff,p_candidate:candidate,p_receipt:receipt},signal);
     if(!retained||retained.state!=='RETAINED'||retained.member_published!==false)throw Error('STOCK_AI_CANDIDATE_RETAIN_UNCONFIRMED');
    },
   }),
  });
 }
`;
const continuation="if(autoContinue&&summary.requires_next_checkpoint===true&&summary.model_calls===1&&summary.counts?.COMPLETE===1&&typeof summary.batch_id==='string')";
const once=(text,from,to)=>{
 if(text.split(from).length!==2)throw Error('RATE_LIMIT_RECOVERY_PATCH_CALLSITE_DRIFT');return text.replace(from,to);
};

export function prepareRateLimitRecoveryIndex(baseIndex,{baseSha256}={}){
 if(typeof baseSha256!=='string'||!/^[a-f0-9]{64}$/.test(baseSha256)||sha256(baseIndex)!==baseSha256)throw Error('RATE_LIMIT_RECOVERY_PATCH_BASELINE_DRIFT');
 let candidate=once(baseIndex,importAnchor,importAnchor+imports);
 candidate=once(candidate,routeAnchor,recoveryRoute+routeAnchor);
 // A provider/semantic failure must stop the normal automatic chain too.
 // Recovery returns early above and can never enter this continuation block.
 candidate=once(candidate,continueAnchor,continuation);
 const restored=once(once(once(candidate,continuation,continueAnchor),recoveryRoute+routeAnchor,routeAnchor),importAnchor+imports,importAnchor);
 if(restored!==baseIndex)throw Error('RATE_LIMIT_RECOVERY_PATCH_NOT_REVERSIBLE');
 return candidate;
}

export function rateLimitRecoveryPatchReceipt(baseIndex,candidateIndex){
 return {schema:'DAILY_AI_RATE_LIMIT_RECOVERY_EDGE_PATCH_V1',base_index_sha256:sha256(baseIndex),candidate_index_sha256:sha256(candidateIndex),
  changes:['Two new recovery module imports','One early server-only recovery route before citation repair','Normal autoContinue requires one actual COMPLETE'],
  fixed_model:'gpt-6-astra',fixed_prompt:'prompt-7:reasoning-low',recovery_model_revision:'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low:recovery-1',
  recovery_auto_continue:false,original_complete_rewritten:false,job_attempts_reset:false,publication_granted:false,
  full_integration_admission:false,production_change_performed:false,
  additional_source_files:['supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-handler.ts','supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-runner.ts']};
}
