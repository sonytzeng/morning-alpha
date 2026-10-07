/** Owner-only projections. Never selects a stock, changes a gate, or creates a trade. */
export const V2_FORWARD_PHASES = ['PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30'] as const;
export type ForwardPhase = typeof V2_FORWARD_PHASES[number];
type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const rows = (v: unknown): RecordValue[] => Array.isArray(v) ? v.map(object) : [];
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
export const V2_GATE_REASONS: Record<string, readonly string[]> = {
 liquidity:['OBSERVED_LIQUIDITY_INSUFFICIENT','OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],
 market:['MARKET_SOURCE_INVALID','MARKET_DOWNSIDE_RISK'],
 sector:['SECTOR_COMPARISON_INSUFFICIENT','SECTOR_TREND_NEGATIVE'],
 relative_strength:['BENCHMARK_SESSION_HISTORY_MISSING','UNDERPERFORMING_MARKET'],
 momentum:['NEGATIVE_MOMENTUM','OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],
 volume_price:['VOLUME_CONFIRMATION_PENDING','OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],
 institutional:['INSTITUTIONAL_DIRECTION_UNAVAILABLE','INSTITUTIONAL_SOURCE_CONFLICT','INSTITUTIONAL_SELLING_PRESSURE'],
 fundamental:['ACTUAL_GROWTH_UNAVAILABLE','ACTUAL_REVENUE_DETERIORATION','ACTUAL_REPORTED_EPS_NEGATIVE','FUNDAMENTAL_SOURCE_CONFLICT'],
 catalyst:['EVENT_SOURCE_UNAVAILABLE','MATERIAL_EVENT_IMPACT_UNASSESSED'],
 risk:['STOP_DISTANCE_OUTSIDE_RESEARCH_RISK_BUDGET','OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],
 entry:['OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],
};
export function v2GateProjection(candidate: RecordValue) {
 const blockers = strings(candidate.blockers), rejected = strings(candidate.rejections), pending = strings(candidate.pending);
 return Object.fromEntries(Object.entries(V2_GATE_REASONS).map(([gate, reasons]) => {
  const evidence = object(object(candidate.evidence)[gate]);
  const state = blockers.some(r=>reasons.includes(r)) ? 'BLOCKED' : rejected.some(r=>reasons.includes(r)) ? 'REJECTED' : pending.some(r=>reasons.includes(r)) ? 'PENDING' : !['AVAILABLE','PARTIAL'].includes(String(evidence.status)) ? 'BLOCKED' : 'PASS';
  return [gate, state];
 }));
}
export function v2DailySnapshot(result: RecordValue, names: Record<string,string> = {}) {
 const candidates = rows(result.candidates);
 if(candidates.length!==72 || new Set(candidates.map(c=>c.symbol)).size!==72 || candidates.some(c=>!['WATCH','READY','NONE','BLOCKED'].includes(String(c.status)))) throw Error('V2_SNAPSHOT_INCOMPLETE');
 const counts = Object.fromEntries(['WATCH','READY','NONE','BLOCKED'].map(s=>[s,candidates.filter(c=>c.status===s).length]));
 const reason_distribution: Record<string,number> = {};
 for(const c of candidates) for(const r of new Set([...strings(c.blockers),...strings(c.rejections),...strings(c.pending)])) reason_distribution[r]=(reason_distribution[r]||0)+1;
 const projections = candidates.map(c=>({c,gates:v2GateProjection(c)}));
 let survivors = projections;
 const funnel = Object.keys(V2_GATE_REASONS).map(gate=>{
  const independent_pass = projections.filter(p=>p.gates[gate]==='PASS').length;
  survivors = survivors.filter(p=>p.gates[gate]==='PASS');
  return {gate,independent_pass,cumulative_pass:survivors.length};
 });
 // Completeness is not a probability. Rank only evaluated NONEs by unmet
 // conditions then symbol. Never turn a near-miss into WATCH/READY.
 const near_miss = projections.filter(p=>p.c.status==='NONE' && strings(p.c.blockers).length===0)
  .sort((a,b)=>Object.values(a.gates).filter(s=>s!=='PASS').length-Object.values(b.gates).filter(s=>s!=='PASS').length || String(a.c.symbol).localeCompare(String(b.c.symbol)))
  .slice(0,5).map(({c,gates})=>({symbol:c.symbol,name:names[String(c.symbol)]||null,status:'NONE',is_recommendation:false,
   passed:Object.keys(gates).filter(k=>gates[k]==='PASS'),missing:Object.keys(gates).filter(k=>gates[k]!=='PASS'),
   reasons:[...strings(c.rejections),...strings(c.pending)],evidence:c.evidence,entry:c.entry,confidence:c.confidence??null}));
 return {business_date:result.business_date,cutoff:result.cutoff,methodology_version:result.methodology_version,source_revision:result.source_revision,
  universe:72,universe_kind:'RESEARCH_UNIVERSE_72',scanned:72,counts,reason_distribution,funnel,near_miss,
  promotion_allowed:false,production_eligible:false};
}
export function v2WatchTransitions(premarket: RecordValue,current: RecordValue) {
 if(premarket.business_date!==current.business_date || premarket.methodology_version!==current.methodology_version ||
  !(Date.parse(String(current.cutoff))>=Date.parse(String(premarket.cutoff)))) throw Error('V2_TRANSITION_LINEAGE');
 const later = rows(current.candidates);
 return rows(premarket.candidates).filter(c=>c.status==='WATCH').map(c=>{
  const next = later.filter(n=>n.symbol===c.symbol);
  if(next.length!==1) throw Error('V2_TRANSITION_SYMBOL');
  const n=next[0];
  return {symbol:c.symbol,from:'WATCH',to:n.status==='BLOCKED'?'DROP':n.status,reason:n.status==='BLOCKED'?'CURRENT_EVIDENCE_INVALID':n.status==='NONE'?'OBSERVED_GATE_REJECTION':'SAME_FROZEN_METHODOLOGY',
   original_entry:c.entry,current_entry:n.entry,source_revision:current.source_revision,original_prediction_unchanged:true};
 });
}
export function v2SampleStatus(distinctDates: number) {
 if(!Number.isInteger(distinctDates)||distinctDates<0) throw Error('V2_SAMPLE_INVALID');
 return distinctDates<5?'INSUFFICIENT_SAMPLE':distinctDates<20?'EARLY':distinctDates<60?'PRELIMINARY':'LARGER_SAMPLE_NOT_PROOF';
}
export type DailyV2 = {business_date:string;methodology_version:string;cutoff:string;counts:Record<string,number>;reason_distribution:Record<string,number>};
/** expectedDates comes from the TW exchange calendar, not calendar-day subtraction.
 * A missing execution breaks a streak and is separately reported, never NONE. */
export function v2DailyHealth(history: DailyV2[], expectedDates: string[], methodology: string) {
 const days=[...new Set(expectedDates)].sort().reverse().slice(0,20);
 const latest=days.map(date=>history.filter(r=>r.business_date===date&&r.methodology_version===methodology).sort((a,b)=>Date.parse(b.cutoff)-Date.parse(a.cutoff))[0]||null);
 const streak=(predicate:(r:DailyV2)=>boolean)=>{let n=0;for(const r of latest){if(!r||!predicate(r))break;n++;}return n;};
 const blocked=streak(r=>r.counts.BLOCKED>0),zero=streak(r=>r.counts.BLOCKED===0&&r.counts.NONE===72&&r.counts.WATCH===0&&r.counts.READY===0);
 const reasons:Record<string,number>={};
 for(const day of latest.slice(0,zero))for(const [r,n] of Object.entries(day!.reason_distribution))reasons[r]=(reasons[r]||0)+n;
 return {blocked_trading_days:blocked,service_status:blocked>=5?'SERVICE_DEGRADED':blocked>=3?'WARNING':'NORMAL',
  zero_candidate_days:zero,zero_candidate_review:zero>=5?'ZERO_CANDIDATE_REVIEW':'NOT_DUE',
  most_frequent_reasons:Object.entries(reasons).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])),
  missing_execution_dates:days.filter((_d,i)=>!latest[i]),automatic_rule_change:false,universe_expansion_approved:false};
}
