import test from 'node:test';
import assert from 'node:assert/strict';
import {auditStockPaidReadiness} from '../scripts/operations/audit-stock-paid-readiness.mjs';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {hashDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';

const now=Date.parse('2026-11-01T09:00:00Z'),horizons=['SHORT','MEDIUM','LONG'];
async function fixture(){
 const edition={id:'a'.repeat(64),evidence_cutoff:'2026-10-31T09:00:00Z',prepared_at:'2026-10-31T10:00:00Z',expires_at:'2026-11-02T05:30:00Z'};
 const packets=Array.from({length:72},(_,i)=>{
  const symbol=String(1000+i),source={id:`${symbol}:PRICE:one`,symbol,kind:'PRICE',source:'https://www.twse.com.tw/',published_at:'2026-10-30T05:30:00Z',available_at:'2026-10-31T08:00:00Z',content:'測試價格資料，不是真實研究'};
  const event={...source,id:`${symbol}:NEWS:one`,kind:'NEWS',content:'合成公司事件證據，非真實事件。'};
  return {symbol,company:'測試'+symbol,cutoff:edition.evidence_cutoff,evidence:[source,event]};
 });
 const cards=packets.flatMap(p=>horizons.map(horizon=>({symbol:p.symbol,company:p.company,horizon,status:p.symbol==='1000'?'WATCH':'WAIT',reason:{text:'等待本公司證據確認',evidence_ids:[p.evidence[0].id]},counter_evidence:[],confirmation:'等待確認',invalidation:'新資料否定假設',gaps:[],sources:p.evidence.map(({content,symbol,...s})=>{void content;void symbol;return s;}),classification:'INFERENCE'})));
 const price_plans=[];
 for(const card of cards){
  const plan={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:edition.id,symbol:card.symbol,horizon:card.horizon,status:'VERIFIED',currency:'TWD',
   method:'SYNTHETIC_TEST_METHOD_V1',entry_range:[100,105],wait_above:105,stop_kind:'PRICE',stop:95,stop_evidence_ids:[`${card.symbol}:PRICE:one`],
   invalidation:'跌破依據或新資料否定假設',basis:'僅為測試，不是真實價格計畫',evidence_ids:[`${card.symbol}:PRICE:one`],
   as_of:'2026-10-31T10:00:00Z',expires_at:edition.expires_at,buy_ready:false};
  const plan_hash=await snapshotHash(plan);
  price_plans.push({...plan,plan_hash,review:{status:'PASS',plan_hash,reviewed_at:'2026-10-31T11:00:00Z',document_hash:'b'.repeat(64)}});
 }
 const binding={status:'PASS',edition_id:edition.id,cards_hash:await snapshotHash(cards),packets_hash:await snapshotHash(packets),reviewed_at:'2026-10-31T11:00:00Z',expires_at:edition.expires_at,document_hash:'c'.repeat(64)};
 return {edition,packets,cards,reviews:{quality:{...binding},time:{...binding},source_use:{...binding}},price_plans};
}
const codes=r=>r.issues.map(i=>i.code);

test('complete bound offline input passes only mechanical requirements and grants no publication or billing',async()=>{
 const input=await fixture(),before=JSON.stringify(input),r=await auditStockPaidReadiness(input,now);
 assert.equal(r.status,'MECHANICAL_REQUIREMENTS_MET_OWNER_AND_MEMBER_E2E_REQUIRED');
 assert.equal(r.counts.verified_price_plans,216);assert.equal(r.counts.cards_requiring_independent_price_plan,216);
 assert.equal(r.counts.horizons.LONG.WAIT,71);
 for(const field of ['authorizes_publication','authorizes_billing','member_published'])assert.equal(r[field],false);
 assert.equal(r.model_calls,0);assert.equal(r.production_writes,0);assert.equal(JSON.stringify(input),before);
});
test('215 WAIT cards cannot pass with only one AVOID card price plan even when all 72 stocks and reviews are complete',async()=>{
 const input=await fixture();
 for(const card of input.cards)card.status='WAIT';
 input.cards[0].status='AVOID';input.price_plans=input.price_plans.slice(0,1);
 const cardsHash=await snapshotHash(input.cards);
 for(const review of Object.values(input.reviews))review.cards_hash=cardsHash;
 const r=await auditStockPaidReadiness(input,now);
 assert.equal(r.status,'BLOCKED');assert.equal(r.counts.cards_requiring_independent_price_plan,215);
 assert.equal(r.issue_counts.VERIFIED_PRICE_PLAN_MISSING,215);
 assert.equal(r.counts.verified_price_plans,0,'AVOID is not a state in which the member consumer may display a conditional entry plan.');
 assert.equal(r.issue_counts.BOUND_REVIEW_MISSING_OR_INVALID,undefined,'the decisive failure is missing WAIT plans, not stale supplied reviews');
});
test('216 cards and supplied PASS reviews cannot conceal absent price plans or insufficient long research',async()=>{
 const input=await fixture();input.price_plans=[];
 for(const c of input.cards.filter(c=>c.horizon==='LONG')){c.status='INSUFFICIENT';c.gaps=['尚缺獨立估值'];}
 const r=await auditStockPaidReadiness(input,now);
 assert.equal(r.status,'BLOCKED');assert.equal(r.issue_counts.RESEARCH_INSUFFICIENT,72);
 assert(codes(r).includes('NO_VERIFIED_PRICE_PLANS'));assert(codes(r).includes('VERIFIED_PRICE_PLAN_MISSING'));
 assert(codes(r).includes('BOUND_REVIEW_MISSING_OR_INVALID'),'review must bind current cards, not stale hashes');
});
test('duplicate horizons cannot substitute for a missing horizon even at 216-card count',async()=>{
 const input=await fixture();input.cards[1]=structuredClone(input.cards[0]);
 const r=await auditStockPaidReadiness(input,now);
 assert.equal(r.status,'BLOCKED');assert(codes(r).includes('CARD_IDENTITY'));assert(codes(r).includes('HORIZON_MISSING'));
});
test('review PASS labels require exact edition, packet/card hashes, dates and document references',async()=>{
 for(const mutate of [
  i=>{i.reviews.quality.edition_id='d'.repeat(64);},
  i=>{i.reviews.time.reviewed_at='2026-11-01T10:00:00Z';},
  i=>{i.reviews.source_use.expires_at='2026-10-31T12:00:00Z';},
  i=>{i.reviews.quality.document_hash='PASS';},
  i=>{i.packets[0].evidence[0].content='已改過的來源';},
 ]){const input=await fixture();mutate(input);const r=await auditStockPaidReadiness(input,now);assert.equal(r.status,'BLOCKED');assert(codes(r).includes('BOUND_REVIEW_MISSING_OR_INVALID'));}
});
test('plan review is bound to exact prices and cannot authorize stale or unbacked thresholds',async()=>{
 for(const mutate of [
  i=>{i.price_plans[0].entry_range[1]=104;},
  i=>{i.price_plans[0].stop=101;},
  i=>{i.price_plans[0].wait_above=104;},
  i=>{i.price_plans[0].expires_at='2026-10-31T12:00:00Z';},
  i=>{i.price_plans[0].edition_id='d'.repeat(64);},
  i=>{i.price_plans[0].evidence_ids=['unknown'];},
  i=>{i.price_plans[0].as_of='2026-10-30T12:00:00Z';},
 ]){const input=await fixture();mutate(input);const r=await auditStockPaidReadiness(input,now);assert.equal(r.status,'BLOCKED');assert(codes(r).includes('PRICE_PLAN_INVALID'));}
});
test('WAIT cannot be promoted to buy-ready by attaching an otherwise verified plan',async()=>{
 const input=await fixture(),original=input.price_plans[0],{review,plan_hash,...body}=original;void review;void plan_hash;
 const plan={...body,symbol:'1001',evidence_ids:['1001:PRICE:one'],buy_ready:true};
 const bad_hash=await snapshotHash(plan);
 input.price_plans[input.price_plans.findIndex(p=>p.symbol===plan.symbol&&p.horizon===plan.horizon)]={...plan,plan_hash:bad_hash,review:{status:'PASS',plan_hash:bad_hash,reviewed_at:'2026-10-31T11:00:00Z',document_hash:'b'.repeat(64)}};
 const r=await auditStockPaidReadiness(input,now);assert.equal(r.status,'BLOCKED');assert(codes(r).includes('NON_ACTIONABLE_PROMOTED_TO_BUY'));
 const second=await fixture();second.cards.find(c=>c.symbol==='1001').buy_ready=true;
 const cardAttempt=await auditStockPaidReadiness(second,now);assert.equal(cardAttempt.status,'BLOCKED');assert(codes(cardAttempt).includes('NON_ACTIONABLE_PROMOTED_TO_BUY'));
});
test('WAIT plan without basis or expiry cannot be promoted by refreshing review labels',async()=>{
 for(const field of ['basis','expires_at']){
  const input=await fixture(),plan=input.price_plans.find(p=>p.symbol==='1001');delete plan[field];
  // Missing body fields cannot form a canonical plan; the strict verifier
  // rejects them before any matching hash could promote the plan.
  try{const rebound=await hashDailyAiPricePlanBody(plan);plan.plan_hash=rebound;plan.review.plan_hash=rebound;}catch{}
  const r=await auditStockPaidReadiness(input,now);
  assert.equal(r.status,'BLOCKED');assert(codes(r).includes('PRICE_PLAN_INVALID'));
 }
});
test('citations and projected sources must bind original packets before human review records can pass',async()=>{
 const input=await fixture();input.cards[0].reason.evidence_ids=['unknown'];input.cards[1].sources[0].available_at='2026-11-01T10:00:00Z';
 const r=await auditStockPaidReadiness(input,now);assert.equal(r.status,'BLOCKED');assert(codes(r).includes('CLAIM_CITATION'));assert(codes(r).includes('CARD_SOURCE_BINDING'));
});
test('expired edition blocks even when all retained content and reviews were once valid',async()=>{
 const r=await auditStockPaidReadiness(await fixture(),Date.parse('2026-11-02T05:30:00Z'));
 assert.equal(r.status,'BLOCKED');assert(codes(r).includes('EDITION_INVALID_OR_EXPIRED'));
});

test('EVENT stop=null uses the real consumer verifier and must cite a non-price stop premise',async()=>{
 const input=await fixture(),plan=input.price_plans.find(p=>p.horizon==='LONG');
 plan.stop_kind='EVENT';plan.stop=null;plan.stop_evidence_ids=[`${plan.symbol}:NEWS:one`];
 plan.evidence_ids.push(...plan.stop_evidence_ids);
 plan.plan_hash=await hashDailyAiPricePlanBody(plan);plan.review.plan_hash=plan.plan_hash;
 const accepted=await auditStockPaidReadiness(input,now);
 assert.equal(accepted.status,'MECHANICAL_REQUIREMENTS_MET_OWNER_AND_MEMBER_E2E_REQUIRED');
 assert.equal(accepted.counts.verified_price_plans,216);
 plan.stop_evidence_ids=[`${plan.symbol}:PRICE:one`];plan.plan_hash=await hashDailyAiPricePlanBody(plan);plan.review.plan_hash=plan.plan_hash;
 const invalid=await auditStockPaidReadiness(input,now);assert.equal(invalid.status,'BLOCKED');assert(codes(invalid).includes('PRICE_PLAN_INVALID'));
});
test('complete plan hash includes method and every price field independently of review labels',async()=>{
 for(const mutate of [
  p=>{p.method='ALTERED_AFTER_REVIEW';},p=>{p.plan_hash='d'.repeat(64);},p=>{p.review.plan_hash='e'.repeat(64);},
 ]){const input=await fixture();mutate(input.price_plans[0]);const r=await auditStockPaidReadiness(input,now);assert.equal(r.status,'BLOCKED');assert(codes(r).includes('PRICE_PLAN_INVALID'));}
});
test('WATCH with a verified conditional plan still cannot be promoted to buy-ready',async()=>{
 const input=await fixture();input.cards[0].buy_ready=true;
 for(const review of Object.values(input.reviews))review.cards_hash=await snapshotHash(input.cards);
 const r=await auditStockPaidReadiness(input,now);assert.equal(r.status,'BLOCKED');assert(codes(r).includes('NON_ACTIONABLE_PROMOTED_TO_BUY'));
 assert.equal(r.issue_counts.BOUND_REVIEW_MISSING_OR_INVALID,undefined);
});
test('price-plan references bind the exact raw packet even when the AI prose did not select that source',async()=>{
 const input=await fixture(),packet=input.packets[0],plan=input.price_plans[0],id=packet.symbol+':PRICE:unselected';
 packet.evidence.push({...packet.evidence[0],id,content:'Synthetic prior price reference not used by the prose claim.'});
 assert(!input.cards[0].sources.some(source=>source.id===id));
 plan.evidence_ids=[id];plan.stop_evidence_ids=[id];plan.plan_hash=await hashDailyAiPricePlanBody(plan);plan.review.plan_hash=plan.plan_hash;
 for(const review of Object.values(input.reviews))review.packets_hash=await snapshotHash(input.packets);
 const r=await auditStockPaidReadiness(input,now);
 assert.equal(r.status,'MECHANICAL_REQUIREMENTS_MET_OWNER_AND_MEMBER_E2E_REQUIRED');assert.equal(r.counts.verified_price_plans,216);
});
