import {handleDailyStockAnalysis,stockAnalysisRequestRejection,readStockAnalysisRequestText,type StoredStockAnalysisBatch} from './handler.ts';
import {stockAiRateLimitOriginalRevision,stockAiRateLimitRecoveryRevision,type StockAiRateLimitRecoverySelector} from './rate-limit-recovery-runner.ts';
import {compareTime,hashValid,snapshotHash,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import type {AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import type {analyseDailyBatch} from '../../../research/daily-ai-batch.ts';

type BatchResult=Awaited<ReturnType<typeof analyseDailyBatch>>;
export type StockAiRateLimitRecoveryPorts={
 internalSecret:string;clock:()=>string;
 loadBatch:(batchId:string,signal:AbortSignal)=>Promise<StoredStockAnalysisBatch|null>;
 loadFence:(selector:StockAiRateLimitRecoverySelector,signal:AbortSignal)=>Promise<unknown>;
 runRecovery:(packets:AnalysisPacket[],selector:StockAiRateLimitRecoverySelector,signal:AbortSignal)=>Promise<BatchResult>;
};
const object=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_BATCH_RECOVERY_SCOPE');return value as Record<string,unknown>;
};
const reply=(status:number,body:Record<string,unknown>)=>Response.json({...body,automatic_continuation:false,requires_next_checkpoint:false,member_published:false},
 {status,headers:{'Cache-Control':'no-store'}});

/** Exact internal selector, one reviewed receipt, one stock and no continuation.
 * SQL independently fences duplicate, failed and unknown recovery work. */
export async function handleDailyStockRateLimitRecovery(req:Request,ports:StockAiRateLimitRecoveryPorts,limits={loadMs:8000,runMs:45000}){
 const rejected=stockAnalysisRequestRejection(req,ports.internalSecret);if(rejected)return rejected;
 let selector:StockAiRateLimitRecoverySelector;
 try{
  const input=object(JSON.parse(await readStockAnalysisRequestText(req)));
  if(Object.keys(input).sort().join('|')!==['batch_id','recovery_symbol','review_document_hash'].sort().join('|')
   ||typeof input.batch_id!=='string'||!hashValid(input.batch_id)||typeof input.recovery_symbol!=='string'||!/^\d{4,6}$/.test(input.recovery_symbol)
   ||typeof input.review_document_hash!=='string'||!hashValid(input.review_document_hash))throw Error('AI_BATCH_RECOVERY_SCOPE');
  selector={batch_id:input.batch_id,recovery_symbol:input.recovery_symbol,review_document_hash:input.review_document_hash};
 }catch(error){const limited=error instanceof Error&&error.message==='INPUT_LIMIT';return reply(limited?413:422,{state:'REJECTED',error:limited?'INPUT_LIMIT':'SCOPE_INVALID',model_calls:0});}
 let bound=false,analysisStarted=false,result:BatchResult|null=null;
 const response=await handleDailyStockAnalysis(new Request(req,{body:JSON.stringify({batch_id:selector.batch_id})}),{
  internalSecret:ports.internalSecret,clock:ports.clock,
  loadBatch:async(_selector,signal)=>{
   const source=await ports.loadBatch(selector.batch_id,signal);if(source===null)return null;
   const batch=structuredClone(source),packet=batch.packets?.find(p=>p.symbol===selector.recovery_symbol);if(!packet)throw Error('AI_BATCH_RECOVERY_SYMBOL');
   const inputHash=await snapshotHash(packet),originalKey=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:stockAiRateLimitOriginalRevision});
   const jobKey=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:stockAiRateLimitRecoveryRevision});
   const fence=object(await ports.loadFence(selector,signal));
   if(fence.state!=='READY'||fence.batch_id!==selector.batch_id||fence.symbol!==selector.recovery_symbol||fence.input_hash!==inputHash
    ||fence.original_job_key!==originalKey||fence.job_key!==jobKey||fence.model_revision!==stockAiRateLimitRecoveryRevision
    ||fence.review_document_hash!==selector.review_document_hash||fence.member_published!==false
    ||typeof fence.cutoff!=='string'||!validObservationTime(fence.cutoff)||compareTime(fence.cutoff,batch.cutoff)!==0
    ||!Number.isSafeInteger(fence.dispatch_request_id)||Number(fence.dispatch_request_id)<1)throw Error('AI_BATCH_RECOVERY_FENCE');
   bound=true;return batch;
  },
  runBatch:async(packets,maxStocks,signal)=>{
   if(maxStocks!==1||!bound)throw Error('AI_BATCH_RECOVERY_SCOPE');analysisStarted=true;
   const progress=await ports.runRecovery(packets,selector,signal),target=Array.isArray(progress?.rows)?progress.rows.find(r=>r.symbol===selector.recovery_symbol):undefined;
   if(!progress||!Array.isArray(progress.rows)||progress.rows.some(r=>r.symbol!==selector.recovery_symbol&&r.state!=='DEFERRED')
    ||!target||target.state==='DEFERRED'||target.state!=='FAILED'&&target.code!==undefined
    ||target.state==='FAILED'&&(typeof target.code!=='string'||!/^(AI_ANALYSIS|AI_BATCH|STOCK_AI)_[A-Z0-9_]{1,80}$/.test(target.code))
    ||(['CACHED','BUSY'].includes(target.state)||target.code==='AI_BATCH_ATTEMPTS_EXHAUSTED')&&progress.model_calls!==0
    ||(target.state==='COMPLETE'||target.state==='FAILED'&&target.code!=='AI_BATCH_ATTEMPTS_EXHAUSTED')&&progress.model_calls!==1)throw Error('AI_BATCH_RECOVERY_PROGRESS');
   result=progress;return progress;
  },
 },limits);
 const summary=await response.json();
 if(!response.ok&&response.status!==207)return reply(response.status,{...summary,state:'REJECTED',batch_id:selector.batch_id,symbol:selector.recovery_symbol,
  model_revision:stockAiRateLimitRecoveryRevision,review_document_hash:selector.review_document_hash,...(!analysisStarted?{model_calls:0}:{})});
 const progress=result as BatchResult|null,target=progress?.rows.find(r=>r.symbol===selector.recovery_symbol);
 if(!target||!bound)return reply(409,{state:'REJECTED',error:'STOCK_RATE_LIMIT_RECOVERY_REJECTED'});
 const state=target.state==='FAILED'&&target.code==='AI_BATCH_ATTEMPTS_EXHAUSTED'?'EXHAUSTED':target.state;
 return reply(state==='COMPLETE'||state==='CACHED'?200:state==='BUSY'?202:state==='EXHAUSTED'?409:207,{
  state,batch_id:selector.batch_id,symbol:selector.recovery_symbol,model_revision:stockAiRateLimitRecoveryRevision,
  review_document_hash:selector.review_document_hash,model_calls:progress!.model_calls,...(target.code?{code:target.code}:{}),
 });
}
