import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeIntelligence, stableJson, predictionHash, evaluateInvalidations, PROVIDERS } from '../supabase/functions/_shared/analysis-intelligence-v1.mjs';
import { runAnalysisJob } from '../supabase/functions/_shared/analysis-intelligence-job.mjs';
import { realInput, retained } from './helpers/phase2AnalysisFixtures.mjs';
const analysis=day=>{const x=realInput(day);return analyzeIntelligence(x,x.previous_valid_business_date?realInput(x.previous_valid_business_date):null);};
for(const day of retained.days.map(d=>d.business_date)) test('retained real Production '+day,async()=>{
  const x=realInput(day);
  if(!x.core.rows.length){assert.throws(()=>analyzeIntelligence(x),/RESEARCH_CORE_UNAVAILABLE/);return;}
  const a=analysis(day), b=analysis(day);
  assert.equal(a.observation_kind,'HISTORICAL_REPLAY');
  assert.equal(stableJson(a),stableJson(b));assert.equal(await predictionHash(a),await predictionHash(b));
  assert.equal(a.signals.length,11);assert.equal(a.features.length,33);
  assert.equal(a.cost.ai_call_count,0);assert.equal(a.quality.analysis_value,'INSUFFICIENT_SAMPLE');
  assert.equal(a.production_eligible,false);
});
test('10/2 independent decision ignores official answer and preserves conflict',()=>{
  const x=realInput('2026-10-02'),p=realInput('2026-10-01');
  const a=analyzeIntelligence(x,p);x.production={...x.production,market_regime:'risk_off',direction:'BEARISH',action:'AVOID',confidence:99};
  const b=analyzeIntelligence(x,p);assert.deepEqual(a.decision,b.decision);
  assert(a.contradicting_signals.length>0);assert(a.supporting_signals.length>0);assert(a.signal_conflict_score>0);
  assert(a.decision.shadow_confidence<70);
  assert.equal(a.production_comparison.market_regime,'range');assert.equal(a.production_comparison.action,'WAIT');
});
test('10/1 missing news reduces confidence without inventing news',()=>{
  const x=realInput('2026-10-01'),p=realInput('2026-09-30'),a=analyzeIntelligence(x,p);
  assert(a.missing_signals.includes('NEWS_CONTEXT'));assert.equal(a.report_level,'DEGRADED');
  // Explicit COUNTERFACTUAL TEST ONLY, not a Production fixture.
  x.enhancements.missing_evidence=[];x.enhancements.report_level='FULL';
  const b=analyzeIntelligence(x,p);assert(b.decision.shadow_confidence>a.decision.shadow_confidence);
});
test('reference prices are unavailable returns; proxies disclose correct instrument and inverse yield sign',()=>{
  const a=analysis('2026-10-02');
  for(const k of ['TAIEX','2330']){
    assert.equal(a.features.find(f=>f.feature_id===k+':return:v1').value,null);
    assert.equal(a.features.find(f=>f.feature_id===k+':session_confirmation:v1').value,1);
    assert.equal(a.signals.find(s=>s.provider===k).status,'UNAVAILABLE');
  }
  const f=a.features.find(f=>f.feature_id==='US10Y:risk_impulse:v1');
  assert.equal(f.source_instrument,'IEF');
  assert.equal(Math.sign(f.value),Math.sign(Number(realInput('2026-10-02').core.rows.find(r=>r.provider_key==='US10Y').change_percent)));
});
test('future, late, wrong batch, stale and unknown instrument inputs fail closed',()=>{
  for(const mutate of [x=>x.core.rows[0].created_at='2026-10-02T14:00:00+08:00',
    x=>x.core.rows[0].captured_at='2026-10-02T14:00:00+08:00',x=>x.core.rows[0].source_timestamp='2026-10-02T14:00:00+08:00',
    x=>x.core.rows[0].batch_id='wrong',x=>x.core.integrity.status='FAIL',x=>x.core.rows.pop(),
    x=>x.enhancements.observed_at='2026-10-02T14:00:00+08:00',x=>x.production.created_at='2026-10-02T14:00:00+08:00',
    x=>x.analysis_cutoff_at='2026-10-02T09:00:00+08:00',x=>x.registry=[],
    x=>x.core.rows.find(r=>r.provider_key==='US10Y').raw.source_symbol='UNKNOWN']){
    const x=realInput('2026-10-02');mutate(x);assert.throws(()=>analyzeIntelligence(x,realInput('2026-10-01')));
  }
});
test('typed graph has no dangling edges and cross-signals preserve constituent lineage',()=>{
  const a=analysis('2026-10-02'),ids=new Set(a.graph.nodes.map(n=>n.id));
  assert.equal(ids.size,a.graph.nodes.length);
  for(const e of a.graph.edges){assert(ids.has(e.from));assert(ids.has(e.to));assert.equal(e.version,1);}
  for(const s of a.cross_signals){assert(s.constituent_signal_ids.length>=2);for(const id of s.constituent_signal_ids)assert(ids.has(id));}
});
test('change detection references previous VALID day and every required dimension',()=>{
  const a=analysis('2026-10-02');assert.equal(a.previous_valid_business_date,'2026-10-01');
  for(const key of [...PROVIDERS,'REGIME','DIRECTION','RISK','EVIDENCE_COMPLETENESS','GLOBAL_RISK_CONFIRMATION','SEMICONDUCTOR_RISK_ON_CONFIRMATION']){
    const change=a.what_changed.find(c=>c.key===key);assert(change);assert(change.evidence_ids.length);assert(change.previous_evidence_ids.length);
  }
  const x=realInput('2026-10-02');x.previous_valid_business_date='2026-09-30';
  // The untrusted legacy nearest-row hint cannot override the trading calendar.
  assert.equal(analyzeIntelligence(x,realInput('2026-10-01')).previous_comparable_evidence_day,'2026-10-01');
});
test('observable invalidation records cannot overwrite prediction',()=>{
  const a=analysis('2026-10-02'),original=stableJson(a),later=structuredClone(a);
  later.analysis_cutoff_at='2026-10-02T09:30:00+08:00';
  for(const s of later.signals){s.status='AVAILABLE';s.direction=a.decision.shadow_direction==='BEARISH'?'BULLISH':'BEARISH';}
  const records=evaluateInvalidations(a,later);assert(records.every(r=>r.status==='TRIGGERED'));
  assert.equal(stableJson(a),original);assert.throws(()=>evaluateInvalidations(a,a));
});
test('independent worker writes ONLY one analysis and retry returns existing receipt',async()=>{
  let canonical=null,writes=0;
  const options={date:'2026-10-02',cutoff:'2026-10-02T07:30:00+08:00',kind:'HISTORICAL_REPLAY',clock:()=>1,
    readInput:async d=>realInput(d),storeAnalysis:async(_i,_p,a)=>{if(canonical){assert.equal(a,canonical);return {status:'ALREADY_RECORDED',id:'test',prediction_hash:'test'};}canonical=a;writes++;return {status:'RECORDED',id:'test',prediction_hash:'test'};}};
  assert.equal((await runAnalysisJob(options)).status,'RECORDED');assert.equal((await runAnalysisJob(options)).status,'ALREADY_RECORDED');assert.equal(writes,1);
  await assert.rejects(runAnalysisJob({...options,storeAnalysis:async()=>{throw Error('isolated failure');}}),/isolated failure/);
});
test('research has no business writes, networking, AI or production imports',()=>{
  const engine=readFileSync(new URL('../supabase/functions/_shared/analysis-intelligence-v1.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(engine,/fetch\(|\.from\(|\.rpc\(|OPENAI|generate-daily-report|line-daily-push|market-decision-engine/);
});
test('a matching locked historical authority is reused without recomputation',async()=>{
  const result=await runAnalysisJob({date:'2026-10-02',cutoff:'2026-10-02T08:00:00+08:00',kind:'HISTORICAL_REPLAY',
    findExisting:async()=>({id:'locked',prediction_hash:'original-hash',observation_kind:'HISTORICAL_REPLAY',analysis_cutoff_at:'2026-10-02T08:00:00+08:00'}),
    readInput:async()=>assert.fail('must not read again'),storeAnalysis:async()=>assert.fail('must not overwrite')});
  assert.equal(result.status,'ALREADY_RECORDED');assert.equal(result.prediction_hash,'original-hash');
  assert.equal(result.observation_kind,'HISTORICAL_REPLAY');assert.equal(result.production_writes,0);
});
test('replay authority cannot be returned as Forward or at a different cutoff',async()=>{
  for(const [kind,cutoff] of [['FORWARD','2026-10-02T07:30:00+08:00'],['HISTORICAL_REPLAY','2026-10-02T08:00:00+08:00']]){
    await assert.rejects(runAnalysisJob({date:'2026-10-02',cutoff,kind,
      findExisting:async()=>({id:'historical',prediction_hash:'original',observation_kind:'HISTORICAL_REPLAY',analysis_cutoff_at:'2026-10-02T07:30:00+08:00'}),
      readInput:async()=>assert.fail('must reject'),storeAnalysis:async()=>assert.fail('must not promote')}),/AUTHORITY_MISMATCH/);
  }
});
test('performance sanity: deterministic bounded daily graph, no per-member analysis',()=>{
  const start=performance.now();for(let i=0;i<100;i++)analysis('2026-10-02');
  assert(performance.now()-start<5000);assert(stableJson(analysis('2026-10-02')).length<100000);
});
