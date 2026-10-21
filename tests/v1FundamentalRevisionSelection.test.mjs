// Synthetic controls for the ORIGINAL evaluator; not real stock recommendations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {IDENTITY,evidenceRows} from './fixtures/decision-evidence-rows.mjs';
const evaluate=data=>buildEvidenceDecision(data,IDENTITY);
const latest=data=>data.earnings.find(r=>r.symbol==='2330'&&r.fiscal_period==='2026-Q2');
const candidate=result=>result.phase_evaluation.candidates.find(r=>r.symbol==='2330');
const blocked=result=>{
 assert.equal(candidate(result).status,'BLOCKED');
 assert(candidate(result).reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING'));
 assert.equal(result.screening.evaluated_count,2);
 assert.equal(result.screening.status,'INCOMPLETE');
 assert.deepEqual(result.stock_opportunities,[]);
};
test('known newer Actual-only revision cannot fall back to older complete expectations',()=>{
 const data=evidenceRows();
 data.earnings.push({...latest(data),id:'new-actual-only',created_at:'2026-09-07T01:00:00Z',
  revenue_actual:60,eps_actual:1,revenue_consensus:null,eps_consensus:null,guidance_direction:null});
 const result=evaluate(data);blocked(result);
 assert(candidate(result).reasons.includes('FUNDAMENTAL_REVISION_UNRESOLVED'));
});
test('a later announced release is not silently substituted or blended with old Consensus',()=>{
 const data=evidenceRows();data.earnings.push({...latest(data),id:'revised-release',
  announced_at:'2026-09-07T00:30:00Z',created_at:'2026-09-07T01:00:00Z',eps_actual:1});
 const result=evaluate(data);blocked(result);
 assert(candidate(result).reasons.includes('FUNDAMENTAL_SOURCE_EQUIVALENCE_UNPROVEN'));
});
test('future announcement and late first availability cannot change an earlier assessment',()=>{
 const base=evaluate(evidenceRows());
 for(const patch of [{announced_at:'2026-09-07T03:00:00Z'},{created_at:'2026-09-07T03:00:00Z'}]){
  const data=evidenceRows();data.earnings.push({...latest(data),id:'not-known-at-cutoff',eps_actual:1,
   revenue_consensus:null,eps_consensus:null,...patch});
  assert.deepEqual(evaluate(data),base);
 }
});
test('identical same-source quarter observations coalesce, preserving every source row ID',()=>{
 const data=evidenceRows(),base=evaluate(data);
 data.earnings.push({...latest(data),id:'same-release-second-capture',created_at:'2026-09-07T01:00:00Z'});
 const result=evaluate(data);
 assert.equal(result.screening.status,'COMPLETE');assert.equal(result.screening.evaluated_count,3);
 assert.equal(result.phase_evaluation.blocked_count,0);
 const before=base.stock_opportunities.find(o=>o.symbol==='2330'),after=result.stock_opportunities.find(o=>o.symbol==='2330');
 assert(before&&after);assert.deepEqual(after.opportunity_score.inputs,before.opportunity_score.inputs);
 assert.equal(after.action,before.action);
 assert(result.evidence.some(e=>e.id==='earnings_events:same-release-second-capture'));
 assert(result.evidence.some(e=>e.id==='earnings_events:'+latest(data).id));
});
test('different provider/URL or conflicting basis is not proven equivalent by equal numbers',()=>{
 for(const patch of [{provider:'another-source'},{source_ref:'https://other.example/quarter'},
  {raw_payload:{measurement:{eps_basis:'DILUTED'}}}]){
  const data=evidenceRows();data.earnings.push({...latest(data),id:'not-equivalent',...patch});blocked(evaluate(data));
 }
});
test('four quarters are ordered by fiscal period, not late revisions of old quarters',()=>{
 const data=evidenceRows();
 data.earnings.find(r=>r.symbol==='2330'&&r.fiscal_period==='2025-Q3').announced_at='2026-09-07T00:10:00Z';
 data.earnings.find(r=>r.symbol==='2330'&&r.fiscal_period==='2025-Q3').created_at='2026-09-07T00:11:00Z';
 const result=evaluate(data);assert.equal(result.screening.evaluated_count,3);
 assert.equal(candidate(result).reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING'),false);
});
test('incomplete newest fiscal quarter cannot fall back to four older complete quarters',()=>{
 const data=evidenceRows();data.earnings.push({...latest(data),id:'newest-quarter-partial',fiscal_period:'2026-Q3',
  announced_at:'2026-09-07T00:10:00Z',created_at:'2026-09-07T00:11:00Z',revenue_consensus:null,eps_consensus:null});
 blocked(evaluate(data));
});
test('same-source exact duplicates do not erase genuine negative and mixed decisions',()=>{
 for(const mode of ['damaged','mixed']){
  const data=evidenceRows(mode==='damaged'?{damaged:true}:{});
  if(mode==='mixed')data.earnings.filter(r=>r.fiscal_period==='2026-Q1').forEach(r=>{r.eps_actual=3;});
  const base=evaluate(data);data.earnings.push({...latest(data),id:'duplicate-negative'});
  const result=evaluate(data);assert.equal(result.screening.status,'COMPLETE');
  assert.equal(result.action,base.action);assert.equal(candidate(result).status,candidate(base).status);
  assert.deepEqual(candidate(result).reasons,candidate(base).reasons);
 }
});
test('input order never chooses a bullish revision and caller rows remain unchanged',()=>{
 const data=evidenceRows();data.earnings.push({...latest(data),id:'revised-missing-consensus',revenue_consensus:null});
 const copy=structuredClone(data),expected=evaluate(data);
 assert.deepEqual(data,copy);
 data.earnings.reverse();const reversed=evaluate(data);
 assert.deepEqual(reversed.phase_evaluation,expected.phase_evaluation);
 assert.deepEqual(reversed.screening,expected.screening);
});
test('one row ID cannot acquire a different first availability or measurement identity',()=>{
 for(const patch of [{created_at:'2026-09-07T01:00:00Z'},{eps_actual:1},{raw_payload:{basis:'DIFFERENT'}}]){
  const data=evidenceRows();data.earnings.push({...latest(data),...patch});
  const forward=evaluate(data);blocked(forward);
  assert(candidate(forward).reasons.includes('FUNDAMENTAL_ROW_ID_CONFLICT'));
  data.earnings.reverse();assert.deepEqual(evaluate(data).phase_evaluation,forward.phase_evaluation);
 }
});
test('four fiscal quarters cannot reuse one canonical row identity',()=>{
 const data=evidenceRows(),sameId=latest(data).id;
 data.earnings.filter(r=>r.symbol==='2330').forEach(r=>{r.id=sameId;});
 const result=evaluate(data);blocked(result);
 assert(candidate(result).reasons.includes('FUNDAMENTAL_ROW_ID_CONFLICT'));
 data.earnings.reverse();assert.deepEqual(evaluate(data).phase_evaluation,result.phase_evaluation);
});
// Canonical JSONB objects have no property order. These are synthetic source
// identities, not a grant of source/quality/publication approval.
const measurementPayload=()=>({
 contract:'SYNTHETIC_CANONICAL_SOURCE_IDENTITY',
 receipt:{source_sha256:'a'.repeat(64),references:['original','revision']},
 measurement:{symbol:'2330',fiscal_year:2026,fiscal_quarter:2,
  period_start:'2026-04-01',period_end:'2026-06-30',period_basis:'DIRECT_STANDALONE_QUARTER',
  accounting_basis:'IFRS_AS_REPORTED',consolidation:'CONSOLIDATED',currency:'TWD',
  revenue_unit:'TWD',revenue_scale:1,share_class:'COMMON_SHARE',eps_basis:'BASIC',eps_unit:'TWD_PER_COMMON_SHARE'},
});
const reorderObjects=v=>Array.isArray(v)?v.map(reorderObjects):v&&typeof v==='object'
 ?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorderObjects(x)])):v;
test('same-source fiscal observations survive JSONB key reordering without changing scores or source IDs',()=>{
 const data=evidenceRows(),row=latest(data);row.raw_payload=measurementPayload();
 const base=evaluate(data);
 data.earnings.push({...row,id:'same-release-jsonb-order',raw_payload:reorderObjects(row.raw_payload)});
 const result=evaluate(data);
 assert.equal(result.screening.evaluated_count,3);assert.equal(result.phase_evaluation.blocked_count,0);
 const before=base.stock_opportunities.find(o=>o.symbol==='2330'),after=result.stock_opportunities.find(o=>o.symbol==='2330');
 assert(before&&after);assert.equal(after.action,before.action);
 assert.deepEqual(after.opportunity_score.inputs,before.opportunity_score.inputs);
 assert(result.evidence.some(e=>e.id==='earnings_events:same-release-jsonb-order'));
 assert(result.evidence.some(e=>e.id==='earnings_events:'+row.id));
 data.earnings.reverse();assert.deepEqual(evaluate(data).phase_evaluation,result.phase_evaluation);
});
test('one canonical row ID is not a conflict solely because JSONB reorders nested object keys',()=>{
 const data=evidenceRows(),row=latest(data);row.raw_payload=measurementPayload();
 const base=evaluate(data);data.earnings.push({...row,raw_payload:reorderObjects(row.raw_payload)});
 const result=evaluate(data);assert.equal(result.screening.evaluated_count,3);
 assert.equal(candidate(result).reasons.includes('FUNDAMENTAL_ROW_ID_CONFLICT'),false);
 assert.deepEqual(result.phase_evaluation,base.phase_evaluation);
 data.earnings.reverse();assert.deepEqual(evaluate(data).phase_evaluation,base.phase_evaluation);
});
test('JSONB equivalence never ignores receipt values, array order, types, unknown fields or authority flags',()=>{
 const changes=[
  p=>{p.receipt.source_sha256='b'.repeat(64);},
  p=>{p.receipt.references.reverse();},
  p=>{p.measurement.revenue_scale='1';},
  p=>{p.unknown_metadata={retained:true};},
  p=>{p.source_approved=true;},
  p=>{p.receipt.references.push('another-source');},
 ];
 for(const sameId of [false,true])for(const change of changes){
  const data=evidenceRows(),row=latest(data);row.raw_payload=measurementPayload();
  const payload=reorderObjects(row.raw_payload);change(payload);
  data.earnings.push({...row,id:sameId?row.id:'changed-payload',raw_payload:payload});
  const result=evaluate(data);blocked(result);
  assert(candidate(result).reasons.includes(sameId?'FUNDAMENTAL_ROW_ID_CONFLICT':'FUNDAMENTAL_REVISION_UNRESOLVED'));
  data.earnings.reverse();assert.deepEqual(evaluate(data).phase_evaluation,result.phase_evaluation);
 }
});
test('malformed non-JSON duplicate payloads fail closed instead of disappearing during serialization',()=>{
 const changes=[p=>{p.unavailable=undefined;},p=>{p.value=NaN;},p=>{p.self=p;},
  p=>{p.value=new Date('2026-01-01T00:00:00Z');},p=>{p.value=Infinity;}];
 for(const change of changes){
  const data=evidenceRows(),row=latest(data);row.raw_payload=measurementPayload();
  const payload=structuredClone(row.raw_payload);change(payload);
  data.earnings.push({...row,raw_payload:payload});
  const result=evaluate(data);blocked(result);
  assert(candidate(result).reasons.includes('FUNDAMENTAL_ROW_ID_CONFLICT'));
 }
});
