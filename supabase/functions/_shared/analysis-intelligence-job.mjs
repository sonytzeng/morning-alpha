import { analyzeIntelligence, stableJson } from './analysis-intelligence-v1.mjs';

/** @type {(date: string) => Promise<{id: string, prediction_hash: string, observation_kind: string} | null>} */
const noExisting = async (_date) => null;
// Separate internal worker, never imported by Fetch/Report/LINE/Closing.
// Each dependency returns data or throws. Failure terminates only this research job.
export async function runAnalysisJob({ readInput, storeAnalysis, findExisting = noExisting, date, cutoff, kind, clock = () => performance.now() }) {
  const started=clock();
  const existing=await findExisting(date);
  if(existing) return {status:'ALREADY_RECORDED',analysis_id:existing.id,prediction_hash:existing.prediction_hash,
    observation_kind:existing.observation_kind,mode:'SHADOW_ONLY',ai_call_count:0,token_usage:0,compute_ms:Math.max(0,clock()-started),production_writes:0};
  const input=await readInput(date,cutoff,kind);
  const priorDay=input.previous_valid_business_date;
  const previous=priorDay ? await readInput(priorDay,priorDay+'T08:44:59+08:00','HISTORICAL_REPLAY'):null;
  const analysis=analyzeIntelligence(input,previous);
  const computeMs=Math.max(0,clock()-started);
  const receipt=await storeAnalysis(input,previous,stableJson(analysis),computeMs);
  return {status:receipt.status,analysis_id:receipt.id,prediction_hash:receipt.prediction_hash,
    mode:'SHADOW_ONLY',ai_call_count:0,token_usage:0,compute_ms:computeMs,production_writes:0};
}
