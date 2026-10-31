import {handleDailyStockAnalysis,stockAnalysisRequestRejection,readStockAnalysisRequestText,type StoredStockAnalysisBatch} from './handler.ts';
import {stockAiCitationRepairOriginalRevision,stockAiCitationRepairRevision,stockAiAllFactsCitationRepairRevision,type StockAiCitationRepairModelRevision} from '../_shared/daily-stock-ai-runner.ts';
import {compareTime,hashValid,snapshotHash,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import type {AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import type {analyseDailyBatch} from '../../../research/daily-ai-batch.ts';

type BatchResult=Awaited<ReturnType<typeof analyseDailyBatch>>;
type RepairSelector={batch_id:string;repair_symbol:string;review_document_hash:string};
type RepairBinding={job_key:string;original_job_key:string;dispatch_request_id:number;model_revision:StockAiCitationRepairModelRevision;
 prior_job_key?:string;prior_model_revision?:typeof stockAiCitationRepairRevision;prior_input_hash?:string;prior_cutoff?:string};
export type StockAiCitationRepairPorts={
 internalSecret:string;clock:()=>string;
 loadBatch:(batchId:string,signal:AbortSignal)=>Promise<StoredStockAnalysisBatch|null>;
 loadFence:(selector:RepairSelector,signal:AbortSignal)=>Promise<unknown>;
 runRepair:(packets:AnalysisPacket[],symbol:string,signal:AbortSignal,revision:StockAiCitationRepairModelRevision)=>Promise<BatchResult>;
};
const object=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_REPAIR_SCOPE');return value as Record<string,unknown>;
};
const reply=(status:number,body:Record<string,unknown>)=>Response.json({...body,member_published:false},{status,headers:{'Cache-Control':'no-store'}});

/** Same internal Edge entrypoint, one reviewed target, one fixed prompt. A
 * repair can never fall through into normal continuation, staging or publish. */
export async function handleDailyStockCitationRepair(req:Request,ports:StockAiCitationRepairPorts,limits={loadMs:8000,runMs:45000}){
 const rejected=stockAnalysisRequestRejection(req,ports.internalSecret);if(rejected)return rejected;
 let selector:RepairSelector;
 try{
  const input=object(JSON.parse(await readStockAnalysisRequestText(req)));
  if(Object.keys(input).sort().join('|')!==['batch_id','repair_symbol','review_document_hash'].sort().join('|')
   ||typeof input.batch_id!=='string'||!hashValid(input.batch_id)||typeof input.repair_symbol!=='string'||!/^\d{4,6}$/.test(input.repair_symbol)
   ||typeof input.review_document_hash!=='string'||!hashValid(input.review_document_hash))throw Error('AI_REPAIR_SCOPE');
  selector={batch_id:input.batch_id,repair_symbol:input.repair_symbol,review_document_hash:input.review_document_hash};
 }catch(error){const limited=error instanceof Error&&error.message==='INPUT_LIMIT';return reply(limited?413:422,{state:'REJECTED',error:limited?'INPUT_LIMIT':'SCOPE_INVALID',model_calls:0});}
 let binding:RepairBinding|null=null,result:BatchResult|null=null,analysisStarted=false;
 const response=await handleDailyStockAnalysis(new Request(req,{body:JSON.stringify({batch_id:selector.batch_id})}),{
  internalSecret:ports.internalSecret,clock:ports.clock,
  loadBatch:async(_selector,signal)=>{
   const source=await ports.loadBatch(selector.batch_id,signal);if(source===null)return null;
   const batch=structuredClone(source),packet=batch.packets?.find(p=>p.symbol===selector.repair_symbol);if(!packet)throw Error('AI_REPAIR_SYMBOL');
   const inputHash=await snapshotHash(packet),originalKey=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:stockAiCitationRepairOriginalRevision});
   const fence=object(await ports.loadFence(selector,signal));
   const revision=fence.model_revision;
   if(revision!==stockAiCitationRepairRevision&&revision!==stockAiAllFactsCitationRepairRevision)throw Error('AI_REPAIR_FENCE');
   const jobKey=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:revision});
   if(fence.state!=='READY'||fence.batch_id!==selector.batch_id||fence.symbol!==selector.repair_symbol||fence.input_hash!==inputHash
    ||fence.original_job_key!==originalKey||fence.job_key!==jobKey
    ||fence.review_document_hash!==selector.review_document_hash||fence.member_published!==false
    ||typeof fence.cutoff!=='string'||!validObservationTime(fence.cutoff)||compareTime(fence.cutoff,batch.cutoff)!==0
    ||!Number.isSafeInteger(fence.dispatch_request_id)||Number(fence.dispatch_request_id)<1)throw Error('AI_REPAIR_FENCE');
   binding={job_key:jobKey,original_job_key:originalKey,dispatch_request_id:Number(fence.dispatch_request_id),model_revision:revision};
   if(revision===stockAiAllFactsCitationRepairRevision){
    const priorKey=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:stockAiCitationRepairRevision});
    if(fence.prior_job_key!==priorKey||fence.prior_model_revision!==stockAiCitationRepairRevision||fence.prior_input_hash!==inputHash
     ||typeof fence.prior_cutoff!=='string'||!validObservationTime(fence.prior_cutoff)||compareTime(fence.prior_cutoff,batch.cutoff)!==0){binding=null;throw Error('AI_REPAIR_FENCE');}
    binding={...binding,prior_job_key:priorKey,prior_model_revision:stockAiCitationRepairRevision,prior_input_hash:inputHash,prior_cutoff:fence.prior_cutoff};
   }
   return batch;
  },
  runBatch:async(packets,maxStocks,signal)=>{
   if(maxStocks!==1||!binding)throw Error('AI_REPAIR_SCOPE');analysisStarted=true;
   const progress=await ports.runRepair(packets,selector.repair_symbol,signal,binding.model_revision);
   const target=Array.isArray(progress?.rows)?progress.rows.find(r=>r.symbol===selector.repair_symbol):undefined;
   if(!progress||!Array.isArray(progress.rows)||progress.rows.some(r=>r.symbol!==selector.repair_symbol&&r.state!=='DEFERRED')
    ||!target||target.state==='DEFERRED'
    ||target.state!=='FAILED'&&target.code!==undefined
    ||target.state==='FAILED'&&(typeof target.code!=='string'||!/^(AI_ANALYSIS|AI_BATCH|STOCK_AI)_[A-Z0-9_]{1,80}$/.test(target.code))
    ||(['CACHED','BUSY'].includes(target.state)||target.code==='AI_BATCH_ATTEMPTS_EXHAUSTED')&&progress.model_calls!==0
    ||(target.state==='COMPLETE'||target.state==='FAILED'&&target.code!=='AI_BATCH_ATTEMPTS_EXHAUSTED')&&progress.model_calls!==1)throw Error('AI_REPAIR_PROGRESS');
   result=progress;return progress;
  },
 },limits);
 const summary=await response.json();
 if(!response.ok&&response.status!==207)return reply(response.status,{...summary,state:'REJECTED',batch_id:selector.batch_id,symbol:selector.repair_symbol,
  ...(binding?{model_revision:(binding as RepairBinding).model_revision}:{}),review_document_hash:selector.review_document_hash,...(!analysisStarted?{model_calls:0}:{})});
 const progress=result as BatchResult|null,fence=binding as RepairBinding|null;
 const target=progress?.rows.find(r=>r.symbol===selector.repair_symbol);
 if(!target||!fence)return reply(409,{state:'REJECTED',error:'STOCK_REPAIR_REJECTED'});
 const state=target.state==='FAILED'&&target.code==='AI_BATCH_ATTEMPTS_EXHAUSTED'?'EXHAUSTED':target.state;
 return reply(state==='COMPLETE'||state==='CACHED'?200:state==='BUSY'?202:state==='EXHAUSTED'?409:207,{
  state,batch_id:selector.batch_id,symbol:selector.repair_symbol,...fence,
  review_document_hash:selector.review_document_hash,model_calls:progress!.model_calls,...(target.code?{code:target.code}:{}),
 });
}
