import {analyseDailyBatch} from '../../../research/daily-ai-batch.ts';
import type {AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import {analyseStockWithProvider} from './daily-stock-ai.ts';
import {stockAiJobStore} from './daily-stock-ai-jobs.ts';
import {hashValid} from '../../../src/features/vnext/contracts.ts';

export const stockAiModelRevision=(model:string)=>model+':DAILY_AI_STOCK_ANALYSIS_V1:prompt-4';
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
export function runStoredStockAiBatch(packets:AnalysisPacket[],ports:{
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
 apiKey:string;model:string;fetcher:typeof fetch;signal?:AbortSignal;completed?:Record<string,unknown>;
},maxStocks=1){
 return analyseDailyBatch({packets,modelRevision:stockAiModelRevision(ports.model),maxStocks,signal:ports.signal},
  stockAiJobStore(ports.rpc,ports.completed),packet=>analyseStockWithProvider(packet,ports));
}
