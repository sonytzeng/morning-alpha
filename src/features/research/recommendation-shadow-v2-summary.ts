/* Pure Owner research metrics; no network, credentials or production action. */
import { v2SampleStatus } from './recommendation-v2-forward.ts';
export const V2_HORIZONS=[1,3,5,10,20] as const;
const SUMMARY_METHODOLOGY='RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0';
export type V2PredictionStatus='READY'|'WATCH';
export type SummaryOutcome={prediction_id:string;prediction_status?:string;horizon:number;state:string;methodology_version:string;return:number|null;mfe:number|null;mae:number|null;exit_at:string|null};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const observed=(o:SummaryOutcome)=>o.state==='OBSERVED'&&finite(o.return)&&finite(o.mfe)&&finite(o.mae)&&typeof o.exit_at==='string';
function statusSummary(outcomes:SummaryOutcome[],status:V2PredictionStatus,forwardDates?:string[]){
 const dates=forwardDates?[...new Set(forwardDates)].sort():null;
 const horizons=V2_HORIZONS.map(h=>{
  const rows=outcomes.filter(o=>o.horizon===h&&observed(o)).sort((a,b)=>String(a.exit_at).localeCompare(String(b.exit_at))||a.prediction_id.localeCompare(b.prediction_id));
  const returns=rows.map(r=>r.return!),positive=returns.filter(r=>r>0).reduce((s,r)=>s+r,0),negative=-returns.filter(r=>r<0).reduce((s,r)=>s+r,0);
  // These are overlapping, correlated observations, not a investable portfolio.
  // A drawdown of compounded trade ordering would be false precision. Publish
  // only equal-weight completed-exit-day cohort equity, clearly labelled.
  const cohorts=new Map<string,number[]>();for(const r of rows){const d=String(r.exit_at);cohorts.set(d,[...(cohorts.get(d)||[]),r.return!]);}
  let equity=1,peak=1,drawdown=0;for(const rs of cohorts.values()){equity*=1+rs.reduce((s,r)=>s+r,0)/rs.length;peak=Math.max(peak,equity);drawdown=Math.min(drawdown,equity/peak-1);}
  return {horizon:h,entered_samples:rows.length,not_entered:outcomes.filter(o=>o.horizon===h&&o.state==='NOT_ENTERED').length,
   wins:returns.filter(r=>r>0).length,losses:returns.filter(r=>r<0).length,expectancy:rows.length?returns.reduce((a,b)=>a+b,0)/rows.length:null,
   profit_factor:negative>0?positive/negative:null,profit_factor_reason:negative===0?'NO_OBSERVED_LOSSES_NOT_INFINITY':null,
   mean_mfe:rows.length?rows.reduce((s,r)=>s+r.mfe!,0)/rows.length:null,mean_mae:rows.length?rows.reduce((s,r)=>s+r.mae!,0)/rows.length:null,
   cohort_drawdown:rows.length?drawdown:null,drawdown_basis:'EQUAL_WEIGHT_EXIT_DAY_COHORTS_NOT_PORTFOLIO'};
 });
 return {prediction_status:status,qualified_ready:status==='READY',forward_sample:dates?.length??null,
  outcome_sample:new Set(outcomes.filter(observed).map(o=>o.prediction_id)).size,horizons};
}
export function summarizeV2Outcomes(outcomes:SummaryOutcome[],forwardDates:string[],forwardDatesByStatus?:Partial<Record<V2PredictionStatus,string[]>>,audit?:{prediction_ids:string[];no_lookahead:boolean;no_methodology_drift:boolean;no_contamination:boolean;complete_inventory:boolean}){
 const dates=[...new Set(forwardDates)].sort(),seen=new Set<string>(),statuses=new Map<string,string>();
 const eligible=outcomes.filter(o=>o.methodology_version===SUMMARY_METHODOLOGY&&V2_HORIZONS.some(h=>h===o.horizon));
 for(const o of eligible){
  const key=o.prediction_id+':'+o.horizon;
  if(seen.has(key))throw Error('DUPLICATE_OUTCOME');seen.add(key);
  const status=o.prediction_status??'UNKNOWN',prior=statuses.get(o.prediction_id);
  if(prior!==undefined&&prior!==status)throw Error('CONFLICTING_PREDICTION_STATUS');statuses.set(o.prediction_id,status);
 }
 // Legacy rows receive their immutable status from the owner RPC join. Never
 // infer READY from missing status in a stale/malformed client payload.
 const by_status={
  READY:statusSummary(eligible.filter(o=>o.prediction_status==='READY'),'READY',forwardDatesByStatus?.READY),
  WATCH:statusSummary(eligible.filter(o=>o.prediction_status==='WATCH'),'WATCH',forwardDatesByStatus?.WATCH),
 };
 const fullOutcomes=Boolean(audit?.complete_inventory&&audit.prediction_ids.length&&audit.prediction_ids.every(id=>V2_HORIZONS.every(h=>eligible.some(o=>o.prediction_id===id&&o.horizon===h&&['OBSERVED','NOT_ENTERED'].includes(o.state)))));
 return {forward_sample:dates.length,outcome_sample:by_status.READY.outcome_sample,horizons:by_status.READY.horizons,
  performance_basis:'READY_ONLY',by_status,unclassified_outcomes:eligible.filter(o=>o.prediction_status!=='READY'&&o.prediction_status!=='WATCH').length,
  analysis_value:v2SampleStatus(dates.length),promotion_review_eligible:dates.length>=20&&fullOutcomes&&audit?.no_lookahead===true&&audit.no_methodology_drift===true&&audit.no_contamination===true,
  promotion_allowed:false,owner_approval_required:true};
}
