// New calculation-to-member integration; all market inputs, identities,
// rights and reviews are SYNTHETIC in fresh in-memory PostgreSQL.
// This does not invoke the legacy pinned runner or certify production/Node22.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createCalculatedPriceFixture} from './helpers/dailyAiCalculatedPriceFixture.mjs';
import {produceDailyAiPricePlan} from '../research/daily-ai-price-producer.mjs';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {parseDailyAiMemberPricePlans,hashDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';
import {parseDailyAiOwnerPricePlans} from '../src/features/vnext/dailyAiOwnerPricePlans.ts';
import {dailyAiPriceDisplay} from '../src/features/vnext/dailyAiPriceDisplay.ts';
import {renderPriceDelivery} from './priceDeliveryUiHarness.mjs';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_SYNTHETIC_CALCULATED_PRICE_TEST');};
const output=process.env.MA_CALCULATED_PRICE_RECEIPT;
if(output&&!isAbsolute(output))throw Error('ABSOLUTE_RECEIPT_PATH_REQUIRED');
const phases=[],receipt={schema:'SYNTHETIC_CALCULATED_PRICE_DELIVERY_RECEIPT_V1',scope:'SYNTHETIC_ONLY',
 started_at:new Date().toISOString(),runtime:process.version,engine:'existing PGlite 0.3.14, fresh in-memory PostgreSQL',
 production_validation:false,production_rpc_calls:0,real_reviews:0,real_source_grants:0,phases};
const phase=async(name,work)=>{
 const started_at=new Date().toISOString();
 try{const facts=await work();phases.push({name,status:'PASS',started_at,finished_at:new Date().toISOString(),facts});console.log('PASS '+name);}
 catch(error){phases.push({name,status:'FAIL',started_at,error:String(error)});throw error;}
};
let fixture;
try{
 fixture=await createCalculatedPriceFixture();const f=fixture,produced=[],reviews=new Map();
 const project=async()=>{
  await f.identity('premium');const data=parseDailyAiMember(await f.readMember());
  const plans=await parseDailyAiMemberPricePlans(await f.readMemberPrices(),data,Date.now()+2,f.MEMBER);
  return {data,plans,subject:f.MEMBER};
 };
 await phase('real MEDIUM and LONG formulas stage exact calculated bodies in PostgreSQL',async()=>{
  for(const symbol of ['1000','1001'])for(const horizon of ['MEDIUM','LONG']){
   const input=await f.producerInput(symbol,horizon);
   const result=await produceDailyAiPricePlan(input,{mode:'STAGE',rpc:f.stageRpc,now:Date.now()+2});
   assert.equal(result.status,'STAGED_REVIEW_REQUIRED');assert.equal(result.review,null);assert.equal(result.member_published,false);
   const expected=horizon==='MEDIUM'?[64,96]:[80,96];
   assert.deepEqual(JSON.parse(result.candidate.body_text).entry_range,expected);
   await f.db.exec('reset role');
   const stored=(await f.db.query('select body_text,body from vnext_private.ai_price_plans_v1 where plan_hash=$1',[result.candidate.plan_hash])).rows[0];
   assert.equal(stored.body_text,result.candidate.body_text);assert.deepEqual(stored.body.entry_range,expected);
   assert(stored.body.basis.includes(result.calculation.calculation_hash));
   produced.push(result);
  }
  return {calculated_plans:produced.length,formulas:['MEDIUM_EPS_PE_SCENARIOS_V1','LONG_FCFE_DISCOUNT_SCENARIOS_V1'],
   medium_range:[64,96],long_range:[80,96],same_body_bytes_in_sql:true,synthetic_rpc_boundary:'actual PostgreSQL query'};
 });
 await phase('unreviewed calculated plans are visible to Owner and hidden from members',async()=>{
  await f.identity('owner');const owner=await parseDailyAiOwnerPricePlans(await f.readOwnerPrices(),f.editionId,f.OWNER,Date.now()+2);
  assert.equal(owner.plans.length,4);assert(owner.plans.every(row=>row.review===null&&!row.can_approve));
  await f.approveEdition();
  const projection=await project();assert(projection.data.edition);assert.equal(projection.plans.plans.length,0);
  for(const horizon of ['MEDIUM','LONG']){
   const ui=renderPriceDelivery({...projection,horizon});assert.equal(ui.firstTwoPriceFields.length,0);ui.close();
  }
  return {owner_calculated_candidates:4,member_price_plans:0,edition_approval_cannot_approve_prices:true};
 });
 await phase('method/source PENDING and Premium identity cannot authorize a calculated plan',async()=>{
  const pending=await f.insertPriceReview(produced[0],{quality:'PASS',time_status:'PASS',source_use:'PENDING',methodology:'PENDING'});
  await f.identity('owner');await assert.rejects(()=>f.priceAction(produced[0],pending),/AI_PRICE_PLAN_PREREQUISITES/);
  for(const result of produced)reviews.set(result.candidate.plan_hash,await f.insertPriceReview(result));
  assert.equal((await project()).plans.plans.length,0);
  await assert.rejects(()=>f.priceAction(produced[0],reviews.get(produced[0].candidate.plan_hash)),/OWNER_REQUIRED/);
  return {pending_review_blocked:true,review_without_owner_hidden:true,premium_cannot_approve:true};
 });
 await phase('explicit synthetic reviews and Owner approval display the same calculated values and hashes',async()=>{
  await f.identity('owner');for(const result of produced)await f.priceAction(result,reviews.get(result.candidate.plan_hash));
  const projection=await project();assert.equal(projection.plans.plans.length,4);
  for(const plan of projection.plans.plans){
   const original=produced.find(value=>value.candidate.plan_hash===plan.plan_hash);assert(original);
   assert.equal(await hashDailyAiPricePlanBody(plan),plan.plan_hash);assert.deepEqual(plan.entry_range,original.calculation.entry_range);
   assert.equal(plan.buy_ready,false);assert(dailyAiPriceDisplay(plan));
  }
  for(const [horizon,expected] of [['MEDIUM','NT$64～96'],['LONG','NT$80～96']]){
   const ui=renderPriceDelivery({...projection,horizon});ui.selectTwo();
   for(const rendered of [...ui.firstTwoCards,ui.comparison])assert(rendered.includes(expected));
   assert.equal(ui.firstTwoPriceFields.length,4);ui.close();
  }
  receipt.calculations=produced.map(result=>({symbol:result.symbol,horizon:result.horizon,plan_hash:result.candidate.plan_hash,
   calculation_hash:result.calculation.calculation_hash,entry_range:result.calculation.entry_range,wait_above:result.calculation.wait_above}));
  return {member_plans:4,component_periods:['MEDIUM','LONG'],member_and_sql_plan_hashes_match:true,
   calculation_hash_in_price_basis:true,numeric_prices_rendered:true,real_signoffs:0};
 });
 await phase('ineligible short horizon never creates a plan or a BUY status',async()=>{
  const result=await produceDailyAiPricePlan(await f.producerInput('1000','SHORT'),{mode:'STAGE',rpc:f.stageRpc,now:Date.now()+2});
  assert.equal(result.status,'INELIGIBLE');assert.equal(result.reason,'CARD_INSUFFICIENT');assert.equal(result.staged,false);
  const projection=await project();assert.equal(projection.plans.plans.filter(plan=>plan.horizon==='SHORT').length,0);
  assert(projection.data.cards.filter(card=>card.horizon==='SHORT').every(card=>card.status==='INSUFFICIENT'));
  const ui=renderPriceDelivery({...projection,horizon:'SHORT'});assert.equal(ui.firstTwoPriceFields.length,0);ui.close();
  return {short_plans:0,card_status:'INSUFFICIENT',no_buy_upgrade:true};
 });
 await phase('revocation hides the computed price and expiry hides cached numeric content',async()=>{
  const revoked=produced.find(result=>result.symbol==='1000'&&result.horizon==='MEDIUM');
  await f.identity('owner');await f.priceAction(revoked,reviews.get(revoked.candidate.plan_hash),'REVOKE');
  const projection=await project();assert.equal(projection.plans.plans.length,3);
  assert(!projection.plans.plans.some(plan=>plan.plan_hash===revoked.candidate.plan_hash));
  const ui=renderPriceDelivery({...projection,horizon:'MEDIUM'});
  assert(!ui.firstTwoCards[0].includes('NT$64～96'));assert(ui.firstTwoCards[1].includes('NT$64～96'));ui.close();
  const expired=renderPriceDelivery({...projection,horizon:'LONG',now:Date.parse(projection.data.edition.expires_at)+1});
  assert.equal(expired.firstTwoPriceFields.length,0);assert(expired.text.includes('研究版本已到期'));expired.close();
  return {revoked_plan_hidden:true,other_plan_preserved:true,cached_ui_expiry_hides_prices:true};
 });
 receipt.status='PASS';receipt.passed_phases=phases.length;
}catch(error){receipt.status='FAIL';receipt.error=String(error);process.exitCode=1;console.error(error);}
finally{
 if(fixture)await fixture.close();receipt.finished_at=new Date().toISOString();
 if(output)writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,phases:phases.length,runtime:receipt.runtime,scope:receipt.scope,production_validation:false}));
}
