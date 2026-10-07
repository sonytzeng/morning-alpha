import { buildInternalFunctionHeaders } from './internal-function-auth.mjs';
import { unavailableDecision } from './decision-v1-evidence.ts';
import type { DecisionIdentity, Row } from './decision-v1-data.ts';

/** Failure affects recommendation only, never the market report or Atomic.
 * The authenticated response remains a producer proof, not an LLM-authored one. */
export async function requestRecommendationProof(options:{identity:DecisionIdentity;url:string;cronSecret:string;serviceRoleKey:string;fetcher:typeof fetch}) {
 const unavailable=()=>({decision:unavailableDecision(options.identity,'STOCK_EVIDENCE_PRODUCER_UNAVAILABLE'),acquisition:null});
 try{
  // New endpoint keeps the default gateway JWT check ON. Do not silently turn
  // off authentication if this deployment no longer has the existing legacy
  // service-role JWT. Internal authorization remains a separate guard.
  if(!/^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(options.serviceRoleKey))return unavailable();
  const headers={...buildInternalFunctionHeaders({cronSecret:options.cronSecret,serviceRoleKey:options.serviceRoleKey,source:'generate-daily-report-v7'}),Authorization:`Bearer ${options.serviceRoleKey}`};
  const response=await options.fetcher(`${options.url}/functions/v1/recommendation-stock-evidence-v1`,{
   method:'POST',headers,
   body:JSON.stringify({business_date:options.identity.report_date,correlation_id:options.identity.revision_id}),signal:AbortSignal.timeout(26000),redirect:'error',
  });
  if(!response.ok)return unavailable();
  const body=await response.json() as Row,decision=body.decision as Row|undefined;
  if(!decision||decision.schema_version!=='decision-evidence-v1'||decision.report_date!==options.identity.report_date||decision.revision_id!==options.identity.revision_id||!Number.isFinite(Date.parse(String(decision.generated_at)))||Date.parse(String(decision.generated_at))<Date.parse(options.identity.generated_at)||Date.parse(String(decision.generated_at))>Date.now()||!Array.isArray(body.business_writes)||body.business_writes.length)return unavailable();
  return {decision,acquisition:body.acquisition};
 }catch{return unavailable();}
}
