import {phaseFunnel,summarizePhase,type PhaseCandidate} from './recommendation-phase.ts';
import {RECOMMENDATION_UNIVERSE} from './recommendation-stock-evidence.ts';
import {COMPANY_EVENT_SOURCES} from './recommendation-company-events.ts';
import type {Row} from './decision-v1-data.ts';
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
/** Sanitized measurements from the actual V1 evaluation, not another evaluator.
 * Early-stopped stages stay NOT_REACHED; missing input is not a market rejection. */
export function runtimeEvaluationSummary(body:unknown){
 const root=obj(body),decision=obj(root.decision),p=obj(decision.phase_evaluation);
 if(!['PREMARKET','INTRADAY'].includes(String(p.evaluation_phase))||!Array.isArray(p.candidates))throw Error('EVALUATION_CONTRACT');
 const cs=p.candidates.map(obj);
 if(cs.length!==72||new Set(cs.map(c=>c.symbol)).size!==72||cs.some(c=>!RECOMMENDATION_UNIVERSE.includes(String(c.symbol))||!['WATCH','READY','NONE','DROP','BLOCKED'].includes(String(c.status))||!Array.isArray(c.reasons)||c.reasons.length>64||c.reasons.some(r=>typeof r!=='string'||!/^[-A-Z0-9_:]{1,100}$/.test(r))))throw Error('EVALUATION_CONTRACT');
 const phase=summarizePhase(p.evaluation_phase as 'PREMARKET'|'INTRADAY',cs as PhaseCandidate[],p.status==='BLOCKED');
 const reached=cs.filter(c=>typeof c.relative_strength==='boolean');
 const company=(Array.isArray(root.company_events)?root.company_events:[]).map(obj);
 const events=company.flatMap(c=>Array.isArray(c.events)?c.events.map(obj):[]).filter(e=>
  RECOMMENDATION_UNIVERSE.includes(String(e.symbol))&&COMPANY_EVENT_SOURCES.some(s=>s.url===e.source_ref&&s.exchange===e.exchange)&&e.event_fact===true&&e.bullishness===null&&e.impact_review==='REQUIRED'&&e.event_type==='OFFICIAL_MATERIAL_ANNOUNCEMENT'&&
  /^[a-f0-9]{64}$/.test(String(e.source_hash))&&Number.isFinite(Date.parse(String(e.published_at)))&&Date.parse(String(e.published_at))<=Date.parse(String(e.available_at))&&Date.parse(String(e.available_at))<=Date.parse(String(decision.generated_at)));
 return {
  phase:phase.evaluation_phase,status:phase.status,funnel:phaseFunnel(phase),reason_distribution:phase.reason_distribution,
  scored_stages:{evaluated:reached.length,not_reached:72-reached.length,relative_strength_pass:reached.filter(c=>c.relative_strength===true).length,risk_pass:reached.filter(c=>c.risk_pass===true).length,
   momentum:'V1_EVENT_ALIGNED_REACTION_NOT_AN_INDEPENDENT_GATE',entry_ready:phase.ready_count},
  catalyst:{sources:COMPANY_EVENT_SOURCES.map(s=>{const c=company.find(x=>x.source===s.url);return {exchange:s.exchange,http:typeof c?.http==='number'?c.http:null,status:['PASS','SOURCE_HTTP_FAILURE','SOURCE_UNAVAILABLE_OR_INVALID'].includes(String(c?.status))?c?.status:'NOT_CAPTURED'}}),
   symbols:new Set(events.map(e=>e.symbol)).size,events:events.length,available_symbols:[...new Set(events.map(e=>String(e.symbol)))].sort(),impact:'UNASSESSED',bullishness_inferred:false,v1_mapping_fabricated:false},
  institutional_twd_missing:phase.reason_distribution.THREE_INSTITUTIONS_MISSING??0,consensus_missing:phase.reason_distribution.FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING??0,
  formal_recommendation_unchanged:true,threshold_diff:0,business_writes:[],
 };
}
