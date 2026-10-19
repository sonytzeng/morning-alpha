// Real retained issuer numbers; surrounding Report/market ports are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import retained from '../supabase/functions/_shared/retained-2330-quarter-actuals-20261019.json' with {type:'json'};
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {RECOMMENDATION_UNIVERSE,buildRecommendationProof,persistedRecommendationReaderInput} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {normalizeMarketInstitutionalTwd} from '../supabase/functions/_shared/recommendation-market-institutional-candidate.ts';
import {buildRecommendationFoundationCandidate,persistedFoundationCandidateInput} from '../supabase/functions/_shared/recommendation-foundation-candidate.ts';
import {createRetainedQuarterActuals,withRetainedQuarterActuals,RETAINED_QUARTER_SOURCE_HASH} from '../supabase/functions/_shared/recommendation-quarter-actuals-candidate.ts';
import {withoutResearchOwnerReceipt} from '../supabase/functions/_shared/research-owner-field-access.ts';

const identity={report_date:'2026-10-20',today_date:'2026-10-20',revision_id:'retained-producer-control',
 generated_at:'2026-10-20T00:01:00Z',data_as_of:'2026-10-20T00:00:00Z',is_trading_day:true};
const cutoff='2026-10-20T00:00:00Z';
const binding={report_date:identity.report_date,producer_revision_id:identity.revision_id,producer_cutoff:identity.generated_at,evidence_cutoff:cutoff};
async function fixture(){
 const data=emptyEvidenceData();data.universe=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,is_active:true,
  created_at:'2026-10-19T23:59:00Z',updated_at:'2026-10-19T23:59:00Z'}));
 const marketFlow=await normalizeMarketInstitutionalTwd({stat:'OK',date:'20261019',hints:'單位：元',fields:['單位名稱','買進金額','賣出金額','買賣差額'],data:[
  ['自營商(自行買賣)','20','10','10'],['自營商(避險)','30','20','10'],['投信','50','20','30'],
  ['外資及陸資(不含外資自營商)','100','50','50'],['外資自營商','8','3','5'],['合計','200','100','100']]},'2026-10-19','2026-10-19T23:59:00Z');
 const proof=await buildRecommendationFoundationCandidate({data,identity,captures:[],officialActuals:[],marketFlow,evidenceCutoff:cutoff});
 const published={...identity,revision_id:'canonical-report-control',generated_at:'2026-10-20T00:01:02Z'};
 const ai={revision_id:published.revision_id,correlation_id:identity.revision_id,generated_at:identity.generated_at,
  decision_v1:proof.decision,recommendation_stock_evidence:proof.acquisition};
 return {data,proof,published,ai};
}

test('four source-bound retained quarters reach Owner earnings and source detail; formal proof remains byte-identical',async()=>{
 const {data,proof,published,ai}=await fixture();
 assert.equal(await snapshotHash(retained),RETAINED_QUARTER_SOURCE_HASH);
 assert.deepEqual(proof.decision,(await buildRecommendationProof(data,identity)).decision);
 const owner=await persistedFoundationCandidateInput(data,published,ai,{ownerAuthorized:true});
 assert.equal(data.earnings.length,0);assert.equal(owner.data.earnings.length,4);
 assert.deepEqual(owner.data.earnings.map(r=>r.fiscal_period),['2025-Q4','2026-Q1','2026-Q2','2026-Q3']);
 assert.deepEqual(owner.data.earnings.map(r=>r.eps_actual),[19.5,22.08,27.25,29.43]);
 assert.deepEqual(owner.data.earnings.map(r=>r.revenue_actual),[1046090000000,1134100000000,1270380000000,1494240000000]);
 for(const r of owner.data.earnings){
  assert.equal(r.announced_at,null);assert.equal(r.eps_consensus,null);assert.equal(r.revenue_consensus,null);assert.equal(r.guidance_direction,null);
  assert.equal(r.created_at,retained.created_at);assert.equal(r.actual_source.eps_basis,'DILUTED');
  assert.equal(r.actual_source.share_class,'COMMON_SHARE');assert.equal(r.actual_source.revenue_resolution_twd,10000000);
  assert(r.actual_source.source_received_at<r.created_at);assert.match(r.actual_source.source_sha256,/^[a-f0-9]{64}$/);
 }
 assert.equal(owner.quarterActuals.status,'ACTUALS_4_OF_4_V1_BLOCKED');assert.equal(owner.quarterActuals.rows.length,4);
 const decision=buildEvidenceDecision(owner.data,published);
 assert.equal(decision.phase_evaluation.evaluated_count,0);assert.equal(decision.phase_evaluation.blocked_count,72);
 assert(decision.phase_evaluation.candidates.every(c=>c.reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING')));
});

test('Member, unauthorized admin and old Reports receive the exact existing Reader result without new detail',async()=>{
 const {data,published,ai}=await fixture(),base=await persistedRecommendationReaderInput(data,published,ai);
 for(const access of [undefined,{ownerAuthorized:false},{tier:'owner'},{}]){
  assert.deepEqual(await persistedFoundationCandidateInput(data,published,ai,access),base);
 }
 const stripped=withoutResearchOwnerReceipt({ai_strategy_json:ai});
 assert.equal(stripped.ai_strategy_json.recommendation_stock_evidence.foundation_candidate,undefined);
 assert.equal(ai.recommendation_stock_evidence.foundation_candidate.quarter_actuals.source_pack.rows.length,4);
 const legacy=structuredClone(ai);delete legacy.recommendation_stock_evidence.foundation_candidate.quarter_actuals;
 const oldOwner=await persistedFoundationCandidateInput(data,published,legacy,{ownerAuthorized:true});
 assert.equal(oldOwner.data.earnings.length,0);assert.equal(oldOwner.quarterActuals,undefined);
});

test('same retained evidence is idempotent, never joins or overwrites an existing expectation row',async()=>{
 const {data,published,ai}=await fixture();
 const expectation={id:'existing-consensus',symbol:'2330',fiscal_period:'2026-Q3',eps_actual:null,revenue_actual:null,
  eps_consensus:30,revenue_consensus:1,guidance_direction:'up',source_ref:'https://example.invalid/expectation'};
 data.earnings=[expectation];
 const first=await persistedFoundationCandidateInput(data,published,ai,{ownerAuthorized:true});
 const second=await persistedFoundationCandidateInput(first.data,published,ai,{ownerAuthorized:true});
 assert.equal(first.data.earnings.length,5);assert.deepEqual(second.data.earnings,first.data.earnings);
 assert.deepEqual(data.earnings,[expectation]);assert.deepEqual(second.data.earnings[0],expectation);
 const conflict=structuredClone(first.data);conflict.earnings[1].eps_actual=100;
 const denied=await persistedFoundationCandidateInput(conflict,published,ai,{ownerAuthorized:true});
 assert.equal(denied.quarterActuals,undefined);assert(denied.data.failures.includes('RETAINED_QUARTER_ACTUALS_EXISTING_ROW_CONFLICT'));
});

test('tampered numbers, basis, source bytes, invented announcements or a generic quarterly array cannot acquire legitimacy by rehashing',async()=>{
 const capsule=await createRetainedQuarterActuals(identity,cutoff),data=emptyEvidenceData();assert(capsule);
 for(const mutate of [c=>c.source_pack.rows[0].eps_actual=99,c=>c.source_pack.rows[0].eps_basis='BASIC',
  c=>c.source_pack.rows[0].share_class='ADR',c=>c.source_pack.rows[0].period_basis='YTD',
  c=>c.source_pack.rows[0].source_bytes++,c=>c.source_pack.rows[0].announced_at=c.source_pack.rows[0].source_received_at,
  c=>c.source_pack.rows[0].eps_consensus=1,c=>c.source_pack={rows:c.source_pack.rows}]){
  const bad=structuredClone(capsule);mutate(bad);const {payload_hash,...body}=bad;void payload_hash;bad.payload_hash=await snapshotHash(body);
  const denied=await withRetainedQuarterActuals(data,binding,bad);assert.equal(denied.quarterActuals,undefined);
  assert.equal(denied.data.earnings.length,0);assert(denied.data.failures.includes('RETAINED_QUARTER_ACTUALS_SOURCE_HASH_MISMATCH'));
 }
});

test('new pack cannot be attached to a past cutoff, another producer/report, or a later Reader clock',async()=>{
 assert.equal(await createRetainedQuarterActuals({...identity,report_date:'2026-10-16',generated_at:'2026-10-16T00:00:00Z'},'2026-10-16T00:00:00Z'),null);
 assert.equal(await createRetainedQuarterActuals({...identity,report_date:'2027-01-04',generated_at:'2027-01-04T00:00:00Z'},'2027-01-04T00:00:00Z'),null);
 const {data,ai,published}=await fixture();
 for(const mutate of [a=>a.correlation_id='other',a=>a.recommendation_stock_evidence.foundation_candidate.quarter_actuals.producer_revision_id='other',
  a=>a.recommendation_stock_evidence.foundation_candidate.quarter_actuals.report_date='2026-10-19',
  a=>a.recommendation_stock_evidence.foundation_candidate.quarter_actuals.evidence_cutoff='2026-10-20T00:00:01Z',
  a=>a.recommendation_stock_evidence.foundation_candidate.quarter_actuals.source_pack.created_at='2026-10-16T00:00:00Z']){
  const bad=structuredClone(ai);mutate(bad);const owner=await persistedFoundationCandidateInput(data,{...published,generated_at:'2026-10-20T00:20:00Z'},bad,{ownerAuthorized:true});
  assert.equal(owner.quarterActuals,undefined);assert.equal(owner.data.earnings.length,0);assert(owner.data.failures.length);
 }
 const oversized=structuredClone(ai);oversized.recommendation_stock_evidence.foundation_candidate.quarter_actuals.extra='x'.repeat(16001);
 const denied=await persistedFoundationCandidateInput(data,published,oversized,{ownerAuthorized:true});
 assert(denied.data.failures.includes('RETAINED_QUARTER_ACTUALS_CAPSULE_LIMIT'));
});

test('jsonb key reordering preserves the hash-bound capsule but not a changed payload digest',async()=>{
 const capsule=await createRetainedQuarterActuals(identity,cutoff),data=emptyEvidenceData();
 const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
 assert.equal((await withRetainedQuarterActuals(data,binding,reorder(capsule))).data.earnings.length,4);
 const bad={...capsule,payload_hash:'0'.repeat(64)};assert((await withRetainedQuarterActuals(data,binding,bad)).data.failures.includes('RETAINED_QUARTER_ACTUALS_PAYLOAD_HASH_MISMATCH'));
});
