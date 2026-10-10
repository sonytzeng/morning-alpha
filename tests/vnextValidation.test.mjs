import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCohorts,signalDependency,RESEARCH_ARMS} from '../src/features/vnext/validation.ts';
import {FROZEN_V1_REF} from '../src/features/vnext/contracts.ts';

// Contract arithmetic fixture only. Never used as actual performance or a member projection.
const now='2026-10-10T00:00:00Z';
const rows=()=>RESEARCH_ARMS.map(arm=>({prediction_id:arm,symbol:'TEST',strategy_version:arm+'-test',arm,
 horizon:'SHORT',target_sessions:1,evaluation_time:'2026-10-07T01:00:00Z',evidence_cutoff:'2026-10-07T00:59:00Z',
 locked_at:'2026-10-07T01:00:00Z',outcome_available_at:'2026-10-08T06:00:00Z',mode:'HISTORICAL_REPLAY',
 provenance:'RETAINED_REAL_EVIDENCE',evidence_hash:'a'.repeat(64),outcome_hash:'b'.repeat(64),cost_model_version:'TEST_COST',
 executed:true,adjustment_verified:true,historical_universe_verified:true,regime:'RANGE',gross_return:0.02,
 total_cost_return:0.005,benchmark_taiex:0.01,benchmark_random:0.008,benchmark_momentum:0.012,mae:-0.02,mfe:0.03,max_trade_drawdown:0.025}));
test('empty and synthetic outcomes cannot manufacture performance',()=>{
 assert.deepEqual(compareCohorts([],now).cohorts,[]);
 const result=compareCohorts(rows().map(r=>({...r,provenance:'SYNTHETIC'})),now);
 assert.equal(result.cohorts.length,0);assert.equal(result.rejected.length,3);assert.equal(result.SIGNAL_EDGE,'UNPROVEN');
});
test('historical comparison keeps forward count zero, costs and baselines explicit',()=>{
 const result=compareCohorts(rows(),now);
 assert.equal(result.historical_prediction_count,3);assert.equal(result.forward_prediction_count,0);
 assert.equal(result.cohorts.length,3);assert.equal(result.cohorts[0].sample_size,1);
 assert.ok(Math.abs(result.cohorts[0].expectancy-0.015)<1e-12);
 assert.equal(result.cohorts[0].profit_factor,null);assert.equal(result.cohorts[0].portfolio_drawdown,null);
 assert.equal(result.promotion_allowed,false);
});
test('unpaired horizons, different baselines and unexecuted signals are not comparable',()=>{
 assert.equal(compareCohorts(rows().slice(0,2),now).cohorts.length,0);
 for(const patch of [{target_sessions:5},{benchmark_random:0.02},{executed:false},{adjustment_verified:false},{outcome_available_at:'2026-10-11T00:00:00Z'}]){
  const sample=rows();Object.assign(sample[0],patch);assert.equal(compareCohorts(sample,now).cohorts.length,0);
 }
});
test('late forward locking is rejected; history cannot become a forward prediction',()=>{
 const sample=rows().map(r=>({...r,mode:'FORWARD_SHADOW',locked_at:'2026-10-08T07:00:00Z'}));
 const result=compareCohorts(sample,now);assert.equal(result.forward_prediction_count,0);
 assert.ok(result.rejected.every(r=>r.reason==='FORWARD_NOT_PRELOCKED'));
});
test('Frozen V1 dependency is pinned and teacher ambiguity remains unresolved',()=>{
 assert.equal(signalDependency(FROZEN_V1_REF).frozen_v1_match,true);
 assert.equal(signalDependency('new-head').frozen_v1_match,false);
 assert.equal(signalDependency(FROZEN_V1_REF).teacher_thresholds,'UNRESOLVED');
 assert.equal(signalDependency(FROZEN_V1_REF).production_promotion,false);
});
