import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEvidenceDecision, projectEvidenceDecision, finite, sealEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import { loadDecisionEvidence, DATA_QUERIES, emptyEvidenceData } from '../supabase/functions/_shared/decision-v1-data.ts';
import { decisionFromReport } from '../src/features/decision-v1/presentation.ts';
import { IDENTITY as id, evidenceRows } from './fixtures/decision-evidence-rows.mjs';
const run = d => buildEvidenceDecision(d,id);
test('real-shaped row pipeline preserves source, timestamp, calculation and identity; no probability without calibration',()=>{
  const d=run(evidenceRows());
  assert.equal(d.screening.status,'COMPLETE',JSON.stringify(d.screening));
  assert.equal(d.stock_opportunities.length,3);
  assert.equal(d.direction_probability,null); assert.equal(d.calibration_status,'INSUFFICIENT_HISTORY');
  assert.equal(d.direction_evidence_score.meaning,'quality_index');
  assert.equal(d.entry_environment_score.meaning,'quality_index'); assert.equal(d.factor_availability.valuation.value,null);assert.match(d.entry_environment_score.calculation,/valuation UNAVAILABLE/);
  for(const e of d.evidence){assert.ok(e.table&&e.row_id&&e.source&&e.observed_at&&e.available_at);assert.equal(e.revision_id,id.revision_id);}
  for(const o of d.stock_opportunities){assert.equal(o.action,'ACTIVE_WATCH');assert.equal(o.opportunity_score.meaning,'quality_index');assert.equal(Object.keys(o.priced_in_score.inputs).length,6);assert.ok(o.evidence.length&&o.invalidation_conditions.length);}
  assert.equal(decisionFromReport({decision_engine_v1:d},id,id.today_date).action,d.action);
});
test('stale news is excluded; empty mappings never invent affected companies or bullish catalyst',()=>{
  const d=evidenceRows();d.news[0].published_at='2026-09-04T00:00:00Z';
  const r=run(d);assert.equal(r.catalysts.length,0);assert.equal(r.stock_opportunities.length,0);assert.equal(r.action,'INSUFFICIENT_DATA');
  const fresh=run(evidenceRows());assert.deepEqual(fresh.catalysts[0].affected_company,[]);assert.equal(fresh.catalysts[0].fundamental_impact,'UNAVAILABLE');
});
test('missing institutional data lowers coverage and blocks every stock; not NO_QUALIFIED',()=>{
  const d=evidenceRows();d.flows=[];const r=run(d);
  assert.equal(r.action,'INSUFFICIENT_DATA');assert.equal(r.stock_opportunities.length,0);
  assert.ok(r.screening.rejected.every(r=>r.reasons.includes('THREE_INSTITUTIONS_MISSING')));
});
test('conflicting timestamp/provider signals never cherry-pick the bullish observation',()=>{
  const d=evidenceRows(),q=d.quotes.find(q=>q.symbol==='TAIEX'&&q.phase==='intraday');d.quotes.push({...q,id:'conflicting-provider',provider:'twse',value:q.value*.8,change_percent:-5});
  const r=run(d);assert.equal(r.direction_evidence_score,null);assert.equal(r.action,'INSUFFICIENT_DATA');assert.equal(r.stock_opportunities.length,0);
});
test('bullish but overextended measured prices -> DO_NOT_CHASE',()=>{
  const r=run(evidenceRows({extended:true}));assert.equal(r.market_direction,'BULLISH');assert.equal(r.action,'DO_NOT_CHASE');assert.ok(r.stock_opportunities.every(o=>o.action==='DO_NOT_CHASE'));
});
test('market crash plus four-quarter factual intact evidence -> mispricing WATCH, never buy',()=>{
  const r=run(evidenceRows({crash:true}));assert.equal(r.action,'DEFENSIVE');assert.equal(r.stock_opportunities.length,3);
  assert.ok(r.stock_opportunities.every(o=>o.classification==='MISPRICING_CANDIDATE'&&o.action==='WAIT_FOR_CONFIRMATION'));
});
test('market crash with reported revenue/EPS damage -> AVOID, not mispricing',()=>{
  const r=run(evidenceRows({crash:true,damaged:true}));assert.equal(r.action,'AVOID');assert.ok(r.stock_opportunities.every(o=>o.action==='AVOID'&&o.classification==='FUNDAMENTAL_DAMAGE'));
});
test('no data -> no fake confidence, score, stocks, completed screen or successful no-opportunity',()=>{
  const r=run(emptyEvidenceData());assert.equal(r.model_confidence,null);assert.equal(r.entry_environment_score,null);assert.equal(r.direction_probability,null);assert.equal(r.direction_evidence_score,null);assert.equal(r.action,'INSUFFICIENT_DATA');assert.deepEqual(r.stock_opportunities,[]);
});
test('null/undefined/blank/non-finite price and volume never turn into 0',()=>{
  for(const v of [null,undefined,'', ' ',NaN,Infinity,'bad',false,{}])assert.equal(finite(v),null);
  assert.equal(finite('123.45'),123.45);
  const d=evidenceRows();d.quotes.filter(q=>/^\d/.test(q.symbol)).forEach(q=>q.raw_payload={});assert.equal(run(d).stock_opportunities.length,0);
});
test('as-of guard rejects a backfilled old quote/news first ingested after decision time',()=>{
  const d=evidenceRows();d.quotes.forEach(q=>q.ingested_at='2026-09-07T06:00:00Z');d.news[0].created_at='2026-09-07T06:00:00Z';
  const r=run(d);assert.equal(r.direction_evidence_score,null);assert.equal(r.catalysts.length,0);assert.equal(r.action,'INSUFFICIENT_DATA');
});
test('post-event reaction cannot be fabricated from pre-event prices or sentiment',()=>{
  const d=evidenceRows();d.news[0].published_at='2026-09-07T01:59:30Z';d.news[0].created_at=d.news[0].published_at;
  assert.equal(run(d).stock_opportunities.length,0);
});
test('LLM classification confidence and old 75/80/90 ratings are ignored',()=>{
  const a=evidenceRows(),b=structuredClone(a);b.confidence_score=90;b.news[0].confidence_score=99;b.news[0].surprise_score=100;b.evaluations=[{sample_size:100000,accuracy:100,model_version:'LLM'}];
  assert.deepEqual(run(b),run(a));
});
test('syndicated headline dedup and row order are deterministic',()=>{
  const a=evidenceRows();a.news.push({...a.news[0],id:'syndicated',source_url:'https://example.test/other',published_at:'2026-09-07T00:00:10Z'});
  const b=structuredClone(a);for(const key of Object.keys(DATA_QUERIES))b[key].reverse();
  assert.equal(run(a).catalysts.length,1);assert.deepEqual(run(b),run(a));
});
test('private projection removes companies, company evidence and private score inputs before HTTP response',()=>{
  const d=run(evidenceRows());const free=projectEvidenceDecision(d,{companyContentAllowed:false,canonicalAction:'ACT',publishedSymbols:['2330','2317','2382']});
  assert.equal(free.stock_opportunities.length,0);assert.equal(free.screening.rejected.length,0);
  assert.doesNotMatch(JSON.stringify(free),/Synthetic company|earnings-2317|mapping-2317|"2317"|"2382"/);
  const paid=projectEvidenceDecision(d,{companyContentAllowed:true,canonicalAction:'ACT',publishedSymbols:['2330']});assert.deepEqual(paid.stock_opportunities.map(o=>o.symbol),['2330']);
  assert.equal(decisionFromReport({decision_engine_v1:paid},id,id.today_date).stock_opportunities.length,1);
  assert.doesNotMatch(JSON.stringify(paid),/earnings-2317|mapping-2317|Synthetic company 2317/);
  const stop=projectEvidenceDecision(d,{companyContentAllowed:true,canonicalAction:'STOP',publishedSymbols:['2330']});assert.equal(stop.action,'DEFENSIVE');assert.equal(stop.stock_opportunities.length,0);
});
test('no untrusted factor-input evaluation remains in product bundle',()=>{
  for(const f of ['src/features/decision-v1/engine.ts','src/features/decision-v1/presentation.ts'])assert.doesNotMatch(readFileSync(f,'utf8'),/evaluateDecisionV1|Math\.tanh|composite\(|mean\(/);
  assert.equal(decisionFromReport({decision_engine_v1:{...run(evidenceRows()),direction_probability:{value:90}}},id,id.today_date).action,'INSUFFICIENT_DATA');
});
test('bounded queries bind every data source to point-in-time availability and never call AI/write',async()=>{
  const requests=[];const r=await loadDecisionEvidence(async q=>{requests.push(q);return{data:[],error:null};},id);
  assert.equal(requests.length,8);assert.equal(r.failures.length,0);
  for(const q of requests){assert.ok(q.limit>0);assert.ok(q.filters.some(f=>f.operator==='lte'&&f.value===id.generated_at));assert.doesNotMatch(q.columns,/confidence_score|surprise_score|weighted_score/);}
  const overflow=await loadDecisionEvidence(async q=>({data:q.table==='market_quotes'?Array(q.limit).fill({}):[],error:null}),id);assert.deepEqual(overflow.failures,['quotes:TRUNCATED']);
  const fail=await loadDecisionEvidence(async()=>{throw Error('private db error');},id);assert.equal(fail.failures.length,8);assert.doesNotMatch(JSON.stringify(fail),/private db error/);
});
test('historical/nontrading identities do not create current recommendations',()=>{
  const closed=buildEvidenceDecision(evidenceRows(),{...id,is_trading_day:false});assert.equal(closed.action,'NOT_APPLICABLE');assert.equal(closed.stock_opportunities.length,0);
  const old=buildEvidenceDecision(evidenceRows(),{...id,today_date:'2026-09-08'});assert.equal(old.action,'INSUFFICIENT_DATA');
});
test('query truncation/partial failure never produces an apparently complete screen',()=>{
  const d=evidenceRows();d.failures=['quotes:TRUNCATED'];assert.equal(run(d).screening.status,'INCOMPLETE');assert.equal(run(d).stock_opportunities.length,0);
});
test('missing valuation remains explicit; missing required market flow disallows ACTIVE_WATCH',()=>{
  const d=evidenceRows();d.flows=d.flows.filter(r=>r.symbol!=='TAIEX');const r=run(d);
  assert.equal(r.entry_environment_score,null);assert.equal(r.action,'WAIT_FOR_CONFIRMATION');assert.ok(r.stock_opportunities.every(o=>o.action!=='ACTIVE_WATCH'));
});
test('only a COMPLETE low-score screen may say NO_QUALIFIED_OPPORTUNITY',()=>{
  const d=evidenceRows();d.flows.forEach(r=>{r.buy_amount=1;r.sell_amount=1000;r.net_amount=-999;});
  d.quotes.filter(q=>q.phase==='intraday'&&/^\d/.test(q.symbol)).forEach(q=>{q.value=100;q.raw_payload.source_raw.total.tradeVolume=1;});
  const r=run(d);assert.equal(r.screening.status,'COMPLETE');assert.equal(r.action,'NO_QUALIFIED_OPPORTUNITY');assert.equal(r.stock_opportunities.length,0);
});
test('nonconsecutive or undocumented fiscal quarters cannot claim fundamental intact',()=>{
  const d=evidenceRows();d.earnings[0].fiscal_period='unknown';assert.equal(run(d).stock_opportunities.length,0);
});
test('assessment hash is repeatable, changes with real evidence, and is identical across entitlement projections',async()=>{
  const data=evidenceRows(),a=await sealEvidenceDecision(run(data)),b=await sealEvidenceDecision(run(data));assert.equal(a.assessment_id,b.assessment_id);
  data.news[0].title='Changed filing';assert.notEqual((await sealEvidenceDecision(run(data))).assessment_id,a.assessment_id);
  assert.equal(projectEvidenceDecision(a,{companyContentAllowed:false,canonicalAction:'ACT',publishedSymbols:[]}).assessment_id,a.assessment_id);
});
test('existing SELECTIVE/TRADE publisher enums preserve paid observations but do not impersonate completed entry checkpoints',()=>{
  for(const canonicalAction of ['SELECTIVE','TRADE']) {
    const d=projectEvidenceDecision(run(evidenceRows()),{companyContentAllowed:true,canonicalAction,publishedSymbols:['2330']});
    assert.equal(d.action,'WAIT_FOR_CONFIRMATION');assert.equal(d.stock_opportunities.length,1);assert.equal(d.stock_opportunities[0].action,'WAIT_FOR_CONFIRMATION');
  }
});
