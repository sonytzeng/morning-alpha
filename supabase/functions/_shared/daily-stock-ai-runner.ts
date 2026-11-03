import {analyseDailyBatch} from '../../../research/daily-ai-batch.ts';
import type {AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import {analyseStockWithProvider,type StockAiProviderReceipt} from './daily-stock-ai.ts';
import {stockAiJobStore} from './daily-stock-ai-jobs.ts';
import {hashValid} from '../../../src/features/vnext/contracts.ts';

export const stockAiModelRevision=(model:string)=>model+':DAILY_AI_STOCK_ANALYSIS_V1:prompt-7'+(model==='gpt-6-astra'?':reasoning-low':'');
export const stockAiCitationRepairOriginalRevision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low';
export const stockAiCitationRepairRevision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low';
export const stockAiAllFactsCitationRepairRevision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low';
export type StockAiCitationRepairModelRevision=typeof stockAiCitationRepairRevision|typeof stockAiAllFactsCitationRepairRevision;
/** Bind an internal progress response to the exact retained batch and prompt.
 * Each cached result is still revalidated against its packet by the batch. */
export function parseStockAiProgress(value:unknown,batchId:string,modelRevision:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_BATCH_PROGRESS_INVALID');
 const r=value as Record<string,unknown>,completed=r.completed;
 if(r.schema!=='DAILY_AI_PROGRESS_V1'||r.batch_id!==batchId||r.model_revision!==modelRevision
  ||!completed||typeof completed!=='object'||Array.isArray(completed)
  ||Object.keys(completed).length>72||Object.keys(completed).some(key=>!hashValid(key)))throw Error('AI_BATCH_PROGRESS_INVALID');
 return completed as Record<string,unknown>;
}

/** Called by a server worker with a retained, same-cutoff 72-stock batch.
 * Consumer reads never call a model. Publication remains a separate review. */
export type StoredStockAiPorts={
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
 apiKey:string;model:string;fetcher:typeof fetch;signal?:AbortSignal;completed?:Record<string,unknown>;
 onCandidate?:(candidate:unknown,receipt:StockAiProviderReceipt,inputHash:string,packet:AnalysisPacket)=>Promise<void>;
};
export function runStoredStockAiBatch(packets:AnalysisPacket[],ports:StoredStockAiPorts,maxStocks=1){
 return analyseDailyBatch({packets,modelRevision:stockAiModelRevision(ports.model),maxStocks,signal:ports.signal},
  stockAiJobStore(ports.rpc,ports.completed),packet=>analyseStockWithProvider(packet,{...ports,
   onCandidate:ports.onCandidate?(candidate,receipt,inputHash)=>ports.onCandidate!(candidate,receipt,inputHash,packet):undefined}));
}

/** A reviewed repair has a fixed model, prompt and target. Cache or contention
 * for that target can never authorize spending on another stock. */
export function runStoredStockAiCitationRepair(packets:AnalysisPacket[],symbol:string,ports:Omit<StoredStockAiPorts,'model'>,revision:StockAiCitationRepairModelRevision=stockAiCitationRepairRevision){
 if(revision!==stockAiCitationRepairRevision&&revision!==stockAiAllFactsCitationRepairRevision)throw Error('AI_BATCH_REPAIR_REVISION');
 return analyseDailyBatch({packets,modelRevision:revision,maxStocks:1,onlySymbol:symbol,signal:ports.signal},
  stockAiJobStore(ports.rpc,ports.completed),packet=>analyseStockWithProvider(packet,{...ports,model:'gpt-6-astra',citationRepair:true,
   ...(revision===stockAiAllFactsCitationRepairRevision?{allFactsCitationRepair:true as const}:{}),
   onCandidate:ports.onCandidate?(candidate,receipt,inputHash)=>ports.onCandidate!(candidate,receipt,inputHash,packet):undefined}));
}
