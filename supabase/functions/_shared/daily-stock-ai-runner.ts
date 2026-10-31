import {analyseDailyBatch} from '../../../research/daily-ai-batch.ts';
import type {AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import {analyseStockWithProvider} from './daily-stock-ai.ts';
import {stockAiJobStore} from './daily-stock-ai-jobs.ts';

/** Called by a server worker with a retained, same-cutoff 72-stock batch.
 * Consumer reads never call a model. Publication remains a separate review. */
export function runStoredStockAiBatch(packets:AnalysisPacket[],ports:{
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
 apiKey:string;model:string;fetcher:typeof fetch;
},maxStocks=1){
 return analyseDailyBatch({packets,modelRevision:ports.model+':DAILY_AI_STOCK_ANALYSIS_V1:prompt-1',maxStocks},
  stockAiJobStore(ports.rpc),packet=>analyseStockWithProvider(packet,ports));
}
