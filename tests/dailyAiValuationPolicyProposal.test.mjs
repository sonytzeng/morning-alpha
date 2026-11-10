// Synthetic sources validate proposal isolation and actual-input binding only.
// They do not validate valuation parameters or investment performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeDailyAiValuationPolicies} from '../research/daily-ai-valuation-policy-proposal.ts';
import {buildDailyAiActualPriceInput} from '../research/daily-ai-financial-inputs.ts';
import {calculateDailyAiPricePlan} from '../research/daily-ai-price-calculation.ts';

const formed_at='2026-11-10T00:10:00Z',now=Date.parse(formed_at);
function packet(){
 const common={symbol:'2330',source:'https://www.sec.gov/synthetic-policy-evidence',published_at:'2026-11-08T00:00:00Z',
  available_at:'2026-11-08T00:01:00Z',first_seen_at:'2026-11-08T00:01:00Z',evidence_hash:'a'.repeat(64)};
 return {symbol:'2330',company:'Synthetic proposal test',cutoff:'2026-11-09T22:50:00Z',data_through:'2026-11-09',
  evidence:[...['2025-Q4','2026-Q1','2026-Q2','2026-Q3'].map((period,i)=>({...common,id:'E'+i,kind:'FINANCIAL',
   content:JSON.stringify({kind:'EPS',period,basis:'SINGLE_QUARTER',values:{value:2.5,reported_decimal:'2.50',
    unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED'}})})),
  {...common,id:'P',kind:'PRICE',published_at:'2026-11-09T06:00:00Z',available_at:'2026-11-09T07:00:00Z',
   first_seen_at:'2026-11-09T07:00:00Z',content:JSON.stringify({date:'2026-11-09',close:200})}]};
}
test('a changed stock quote cannot choose a more convenient valuation policy or turn a proposal into approval',async()=>{
 const one=packet(),two=structuredClone(one);two.evidence.at(-1).content=JSON.stringify({date:'2026-11-09',close:2000});
 const a=await proposeDailyAiValuationPolicies({packet:one,formed_at,now}),b=await proposeDailyAiValuationPolicies({packet:two,formed_at,now});
 assert.equal(a.state,'PROPOSED_REVIEW_REQUIRED');assert.deepEqual(a.policies,b.policies);assert.notEqual(a.proposal_hash,b.proposal_hash);
 assert.equal(a.methodology_approved,false);assert.equal(a.review,null);assert.equal(a.member_published,false);
 for(const policy of a.policies){
  const result=await buildDailyAiActualPriceInput({packet:one,policy,as_of:formed_at,expires_at:'2026-11-10T05:30:00Z'});
  assert.equal(result.status,'INPUT_READY_REVIEW_REQUIRED');
  const value=await calculateDailyAiPricePlan(result.calculation_input,now);
  assert.equal(value.trace.reported_eps_sum.value,10);assert.equal(value.production_eligible,false);assert.equal(value.review,null);
 }
});
test('an undefined company and missing quarterly actuals never inherit another company policy',async()=>{
 const other=packet();other.symbol='2454';other.evidence.forEach(e=>{e.symbol='2454';});
 const unknown=await proposeDailyAiValuationPolicies({packet:other,formed_at,now});
 assert.equal(unknown.state,'POLICY_NOT_DEFINED');assert.deepEqual(unknown.policies,[]);
 const incomplete=packet();incomplete.evidence.splice(0,1);
 const missing=await proposeDailyAiValuationPolicies({packet:incomplete,formed_at,now});
 assert.equal(missing.state,'FINANCIAL_INPUT_REQUIRED');assert.deepEqual(missing.policies,[]);
});
test('a new proposal cannot backdate its formation to a prior source cutoff or a future clock',async()=>{
 for(const at of ['2026-11-09T00:00:00Z','2026-11-10T00:10:00.001Z'])
  await assert.rejects(()=>proposeDailyAiValuationPolicies({packet:packet(),formed_at:at,now}),/VALUATION_PROPOSAL_TIME/);
});
