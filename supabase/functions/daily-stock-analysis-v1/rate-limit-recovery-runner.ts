import {analyseDailyBatch} from '../../../research/daily-ai-batch.ts';
import type {AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import {analyseStockWithProvider,type StockAiProviderReceipt} from '../_shared/daily-stock-ai.ts';
import {stockAiJobStore} from '../_shared/daily-stock-ai-jobs.ts';

export const stockAiRateLimitOriginalRevision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low';
export const stockAiRateLimitRecoveryRevision=stockAiRateLimitOriginalRevision+':recovery-1';
export type StockAiRateLimitRecoverySelector={batch_id:string;recovery_symbol:string;review_document_hash:string};
export type StockAiRateLimitRecoveryPorts={
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
 apiKey:string;fetcher:typeof fetch;signal?:AbortSignal;
 onCandidate?:(candidate:unknown,receipt:StockAiProviderReceipt,inputHash:string,packet:AnalysisPacket)=>Promise<void>;
};

/** Same model, provider instructions, validation and receipts as prompt7.
 * Only a separately reviewed, single-use SQL claim may spend on the target.
 * No progress cache is rekeyed and no completed original job is rewritten. */
export function runStoredStockAiRateLimitRecovery(packets:AnalysisPacket[],selector:StockAiRateLimitRecoverySelector,ports:StockAiRateLimitRecoveryPorts){
 const jobs=stockAiJobStore((name,args)=>{
  if(name!=='daily_stock_ai_job_v1')throw Error('AI_BATCH_RECOVERY_RPC');
  return ports.rpc('daily_stock_ai_rate_limit_recovery_job_v1',{
   p_batch_id:selector.batch_id,p_symbol:selector.recovery_symbol,p_review_document_hash:selector.review_document_hash,...args,
  });
 });
 return analyseDailyBatch({packets,modelRevision:stockAiRateLimitRecoveryRevision,maxStocks:1,onlySymbol:selector.recovery_symbol,signal:ports.signal},
  jobs,packet=>analyseStockWithProvider(packet,{apiKey:ports.apiKey,model:'gpt-6-astra',fetcher:ports.fetcher,signal:ports.signal,
   onCandidate:ports.onCandidate?(candidate,receipt,inputHash)=>ports.onCandidate!(candidate,receipt,inputHash,packet):undefined}));
}
