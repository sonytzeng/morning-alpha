import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeEvaluationSummary} from '../supabase/functions/_shared/recommendation-runtime-summary.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const fixture=()=>({decision:{generated_at:'2026-10-07T05:30:00Z',phase_evaluation:{evaluation_phase:'INTRADAY',status:'BLOCKED',candidates:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,status:'BLOCKED',reasons:['THREE_INSTITUTIONS_MISSING','FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING','SOURCED_COMPANY_CATALYST_MAPPING_MISSING'],post_event_price:'MISSING',post_event_volume:'MISSING',evidence_ids:[]}))}},company_events:[]});
test('runtime summary measures actual V1 reasons, never invents reached scores',()=>{
 const r=runtimeEvaluationSummary(fixture());
 assert.equal(r.funnel.premarket.scanned,72);assert.equal(r.funnel.premarket.blocked,72);
 assert.equal(r.institutional_twd_missing,72);assert.equal(r.consensus_missing,72);
 assert.equal(r.scored_stages.not_reached,72);assert.equal(r.scored_stages.evaluated,0);
 assert.equal(r.funnel.intraday.watch_input,null);assert.equal(r.threshold_diff,0);
});
test('official event presence is not a fabricated bullish V1 mapping',()=>{
 const b=fixture();b.company_events=[{source:'https://openapi.twse.com.tw/v1/opendata/t187ap04_L',http:200,status:'PASS',events:[{symbol:'2330',exchange:'TWSE',source_ref:'https://openapi.twse.com.tw/v1/opendata/t187ap04_L',source_hash:'a'.repeat(64),event_type:'OFFICIAL_MATERIAL_ANNOUNCEMENT',event_fact:true,bullishness:null,impact_review:'REQUIRED',published_at:'2026-10-07T00:00:00Z',available_at:'2026-10-07T05:29:00Z'}]}];
 const r=runtimeEvaluationSummary(b);assert.equal(r.catalyst.events,1);assert.equal(r.catalyst.symbols,1);
 assert.equal(r.catalyst.impact,'UNASSESSED');assert.equal(r.reason_distribution.SOURCED_COMPANY_CATALYST_MAPPING_MISSING,72);
 b.company_events[0].events[0].available_at='2026-10-08T00:00:00Z';assert.equal(runtimeEvaluationSummary(b).catalyst.events,0);
});
test('incomplete/duplicate/arbitrary reason payload is rejected, not surfaced',()=>{
 for(const change of [b=>b.decision.phase_evaluation.candidates.pop(),b=>b.decision.phase_evaluation.candidates[1]=b.decision.phase_evaluation.candidates[0],b=>b.decision.phase_evaluation.candidates[0].reasons=['private@example.com']]){
  const b=fixture();change(b);assert.throws(()=>runtimeEvaluationSummary(b),/EVALUATION_CONTRACT/);
 }
});
