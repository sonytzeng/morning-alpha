import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeIntelligence,resolvePreviousValidComparison,stableJson} from '../supabase/functions/_shared/analysis-intelligence-v1.mjs';
import {runAnalysisJob} from '../supabase/functions/_shared/analysis-intelligence-job.mjs';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
const retained=JSON.parse(readFileSync(new URL('./fixtures/phase2-analysis/previous-comparison-production.json',import.meta.url)));
const real=day=>structuredClone(retained.inputs.find(x=>x.business_date===day)?.input || retained.previous_inputs.find(x=>x.business_date===day)?.input);
const current=()=>real('2026-10-02');
const available=()=>real('2026-10-01');
function assertUnavailable(a){
  assert.equal(a.previous_comparison.status,'UNAVAILABLE');assert.equal(a.previous_comparison.reason,'PREVIOUS_COMPARISON_UNAVAILABLE');
  assert.equal(a.previous_comparable_evidence_day,null);assert.equal(a.previous_valid_business_date,null);
  assert.equal(a.quality.change_detection,'UNAVAILABLE');assert.deepEqual(a.what_changed,[]);
  assert(a.quality.missing_components.includes('PREVIOUS_DAY_COMPARISON'));assert(a.missing_signals.includes('PREVIOUS_DAY_COMPARISON'));
  assert.equal(a.features.length,33);assert.equal(a.signals.length,11);assert.equal(a.cross_signals.length,3);
  assert(a.supporting_signals.length);assert(a.contradicting_signals.length);assert(a.invalidation_conditions.length);
  assert.equal(a.quality.core_evidence_coverage,100);assert(a.quality.evidence_coverage<100);
  assert.equal(a.decision.confidence_components.previous_comparison_penalty,5);
}
for(const [name,previous] of [
  ['A null',()=>null],
  ['C incompatible session',()=>{const p=available();p.core.rows.find(r=>r.provider_key==='TAIEX').raw.source_raw.evidence_session_date='2026-10-01';return p;}],
  ['D distant stale day',()=>real('2026-09-18')],
  ['E incomplete evidence',()=>{const p=available();p.core.rows.pop();return p;}],
  ['late previous observation',()=>{const p=available();p.core.rows[0].created_at='2026-10-02T10:00:00+08:00';return p;}],
])test('previous comparison '+name+' cannot kill current valid analysis',()=>{
  const p=previous(),a=analyzeIntelligence(current(),p);assertUnavailable(a);
  const full=analyzeIntelligence(current(),available());assert(a.decision.shadow_confidence<full.decision.shadow_confidence);
  for(const k of ['features','signals','cross_signals','supporting_signals','contradicting_signals','signal_conflict_score','invalidation_conditions'])assert.deepEqual(a[k],full[k]);
  assert.equal(stableJson(a),stableJson(analyzeIntelligence(current(),p)));
});
test('B valid previous evidence produces real comparison and unchanged 10/2 confidence',()=>{
  const a=analyzeIntelligence(current(),available());assert.equal(a.previous_comparison.status,'AVAILABLE');
  assert.equal(a.previous_trading_day,'2026-10-01');assert.equal(a.previous_comparable_evidence_day,'2026-10-01');
  assert.equal(a.quality.change_detection,'AVAILABLE');assert.equal(a.what_changed.length,18);
  assert.equal(a.decision.shadow_confidence,17.3047);assert.equal(a.decision.shadow_action,'WAIT');
});
test('calendar handles Monday and holiday return without relabeling a distant day',()=>{
  for(const [date,expected] of [['2026-10-05','2026-10-02'],['2026-09-29','2026-09-24'],['2026-09-30','2026-09-29']]){
    assert.equal(resolvePreviousValidComparison({core:{business_date:date}}).metadata.previous_trading_day,expected);
  }
  assert.equal(resolvePreviousValidComparison({core:{business_date:'2028-01-03'}}).metadata.detail,'CALENDAR_COVERAGE_MISSING');
});
test('current core fail closed is unchanged for every enhancement state',()=>{
  for(const mutate of [x=>x.core.rows.pop(),x=>x.core.integrity.status='FAIL',x=>x.core.business_date='2026-10-01',
    x=>x.core.rows[0].source_timestamp='2026-10-03T00:00:00Z',x=>x.core.rows[0].source_timestamp='2026-09-01T00:00:00Z',
    x=>x.core.integrity.mixed_batch_revision_count=1,x=>x.core.rows[0].correlation_id='wrong',x=>x.core.rows[0].batch_id='wrong',
    x=>x.core.rows.find(r=>r.provider_key==='TAIEX').raw.source_raw.evidence_session_date='2026-10-02']){
    for(const p of [null,available(),real('2026-09-18')]){const x=current();mutate(x);assert.throws(()=>analyzeIntelligence(x,p),/RESEARCH_/);}
  }
});
test('exact retained Production inputs through worker: 3 current PASS, 5 safe rejects, 1 unavailable comparison',async()=>{
  let pass=0,reject=0,unavailable=0;
  assert.equal(real('2026-09-30').previous_valid_business_date,'2026-09-18','preserve actual legacy query evidence');
  for(const row of retained.inputs){
    const date=row.business_date,reads=[];let output,writes=0;
    const run=()=>runAnalysisJob({date,cutoff:date+'T07:30:00+08:00',kind:'HISTORICAL_REPLAY',
      readInput:async d=>{reads.push(d);return real(d);},storeAnalysis:async(i,p,a)=>{writes++;output=JSON.parse(a);return{status:'RECORDED',id:'ISOLATED_SINK',prediction_hash:'test-only'};}});
    if(!row.input.core.rows.length){await assert.rejects(run(),/RESEARCH_CORE_UNAVAILABLE/);assert.equal(writes,0);reject++;continue;}
    const result=await run();pass++;assert.equal(result.production_writes,0);assert.equal(result.ai_call_count,0);
    assert.deepEqual(reads,[date,previousMarketTradingDate('TW',date)]);
    assert.equal(output.observation_kind,'HISTORICAL_REPLAY');assert.equal(output.production_eligible,false);
    if(date==='2026-09-30'){assertUnavailable(output);unavailable++;assert(!reads.includes('2026-09-18'));}
    else assert.equal(output.quality.change_detection,'AVAILABLE');
    const first=stableJson(output);await run();assert.equal(stableJson(output),first);
  }
  assert.deepEqual({pass,reject,unavailable},{pass:3,reject:5,unavailable:1});
});
test('previous RPC read failure only degrades enhancement; current read failure still rejects',async()=>{
  let a;
  const options={date:'2026-10-02',cutoff:'2026-10-02T07:30:00+08:00',kind:'HISTORICAL_REPLAY',
    readInput:async d=>{if(d==='2026-10-01')throw Error('isolated transport outage');return current();},
    storeAnalysis:async(i,p,text)=>{assert.equal(p,null);a=JSON.parse(text);return{status:'RECORDED'};}};
  await runAnalysisJob(options);assertUnavailable(a);
  await assert.rejects(runAnalysisJob({...options,readInput:async()=>{throw Error('current read fails');}}),/current read fails/);
});
