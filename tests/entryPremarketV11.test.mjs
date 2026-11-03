/** Scheduling regression controls only; no real trade, method promotion or samples. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateEntry,evaluatePremarketEntry,ENTRY_VERSION,ENTRY_PREMARKET_VERSION,ENTRY_POLICY,entryHash,nextEntrySession} from '../research/entry-opportunity.ts';
import {evaluateEntryOutcome,entryLockHash} from '../research/entry-outcomes.ts';
import {entryFixture,setup} from './helpers/entryFixtures.mjs';

async function ready(){const input=setup(await entryFixture(),'breakout');input.mode='FORWARD';return input;}
const reseal=async lock=>({...lock,lock_sha256:await entryLockHash(lock)});
test('1.1 fixes only the current premarket session; legacy 1.0 retains original next-session date and exact prices',async()=>{
 const input=await ready(),before=structuredClone(input),old=await evaluateEntry(input),current=await evaluatePremarketEntry(input);
 assert.deepEqual(input,before);assert.equal(old.version,ENTRY_VERSION);assert.equal(current.version,ENTRY_PREMARKET_VERSION);
 assert.deepEqual(current.counts,old.counts);assert.deepEqual(current.policy,old.policy);assert.equal(current.evidence_hash,old.evidence_hash);
 for(let n=0;n<3;n++){
  const a=old.candidates[n],b=current.candidates[n];assert.equal(b.strategy_version,b.strategy+'_1.1.0');
  assert.equal(a.strategy_version,a.strategy+'_1.0.0');
  assert.deepEqual(b.metrics,a.metrics);assert.deepEqual(b.reasons,a.reasons);assert.equal(b.status,a.status);
  if(a.plan){assert.equal(a.plan.not_before,nextEntrySession(input.business_date));assert.equal(b.plan.not_before,input.business_date);
   assert.equal(b.plan.expires_on,input.business_date);
   const {not_before:_,expires_on:__,...oldPrices}=a.plan;const {not_before:___,expires_on:____,...newPrices}=b.plan;
   assert.deepEqual(newPrices,oldPrices);assert(b.entry_trigger.includes(input.business_date));}
 }
 assert.equal(current.forward_sample,0);assert.equal(current.outcome_sample,0);assert.equal(current.production_eligible,false);
});
test('1.1 admits only the actual same-day premarket, excluding exactly 09:00 and all later or differently dated evaluations',async()=>{
 for(const time of ['09:00:00','09:00:00.001','12:00:00','23:59:59']){
  const input=await ready();input.evaluation_time=input.business_date+'T'+time+'+08:00';
  await assert.rejects(()=>evaluatePremarketEntry(input),/ENTRY_PREMARKET_WINDOW_INVALID/);
 }
 const input=await ready();input.evaluation_time=input.business_date+'T08:59:59.999+08:00';
 assert.equal((await evaluatePremarketEntry(input)).candidates[2].plan.not_before,input.business_date);
 input.evaluation_time='2026-10-11T23:59:59+08:00';await assert.rejects(()=>evaluatePremarketEntry(input),/ENTRY_PREMARKET_WINDOW_INVALID/);
});
test('1.1 still requires twenty consecutive completed sessions and same-cutoff event/market evidence',async()=>{
 for(const mutate of [i=>i.stocks[0].bars.pop(),i=>i.stocks[0].bars.at(-1).date=i.business_date,
  i=>i.market=null,i=>i.stocks[0].events_reviewed=null,i=>i.stocks[0].sector_return.available_at='2999-01-01']){
  const input=await ready();mutate(input);const result=await evaluatePremarketEntry(input);
  assert(result.candidates.every(c=>c.status==='INSUFFICIENT_EVIDENCE'&&c.plan===null));
 }
});
async function outcomeFixture(){
 const input=await ready(),result=await evaluatePremarketEntry(input),prediction=result.candidates[2],date=input.business_date;
 const lock=await reseal({id:'SYNTHETIC_PREMARKET_V11',symbol:prediction.symbol,strategy_version:prediction.strategy_version,mode:'FORWARD',
  provenance:'SYNTHETIC_TEST',locked_at:input.evaluation_time,evaluation_time:input.evaluation_time,evidence_cutoff:input.evaluation_time,
  evidence_hash:result.evidence_hash,prediction,costs:{version:'ILLUSTRATIVE_TW_CASH_LOCKED_V1',quantity:1000,minimum_fee_twd:20,
   buy_fee:ENTRY_POLICY.buyFee,sell_fee:ENTRY_POLICY.sellFee,sell_tax:ENTRY_POLICY.sellTax,slippage:ENTRY_POLICY.slippageEachSide,
   rounding:'CEIL_TWD',account_costs_verified:false}});
 const bar={date,open:prediction.plan.trigger+.1,high:prediction.plan.trigger+1,low:prediction.plan.trigger-.1,
  close:prediction.plan.trigger+.5,volume:1e6,amount:1e8,source_ref:'SYNTHETIC_SOURCE',available_at:date+'T14:00:00+08:00'};
 const observed_at=date+'T15:00:00+08:00';
 const corporate_actions=await Promise.all([prediction.symbol,'TAIEX'].map(async symbol=>{
  const body={symbol,from:date,through:date,available_at:observed_at,source_ref:'SYNTHETIC_ACTION_SOURCE',coverage:'COMPLETE_SOURCE_WINDOW',events:[]};
  return {...body,content_sha256:await entryHash(body)};
 }));
 return {lock,evidence:{bars:[bar],benchmark:[structuredClone(bar)],observed_at,price_basis:'UNADJUSTED',corporate_actions,benchmark_symbol:'TAIEX',source_ref:'SYNTHETIC_SOURCE'}};
}
test('1.1 Outcome accepts same-day strictly-before-open locks without inventing an actual execution or performance sample',async()=>{
 const {lock,evidence}=await outcomeFixture(),result=await evaluateEntryOutcome(lock,evidence,1);
 assert.equal(result.state,'MODELLED');assert.equal(result.entry_date,lock.prediction.plan.not_before);
 assert.equal(result.actual_fill_confirmed,false);assert.equal(result.performance_eligible,false);
 const atOpen=await reseal({...lock,locked_at:lock.prediction.plan.not_before+'T09:00:00+08:00'});
 assert.equal((await evaluateEntryOutcome(atOpen,evidence,1)).reason,'NOT_PROSPECTIVE');
 const earlier=new Date(Date.parse(lock.prediction.plan.not_before+'T00:00:00+08:00')-1000).toISOString();
 const otherDay=await reseal({...lock,evaluation_time:earlier,evidence_cutoff:earlier});
 assert.equal((await evaluateEntryOutcome(otherDay,evidence,1)).reason,'NOT_PROSPECTIVE');
});
test('candidate database upgrade is baseline/ACL guarded and accepts 1.1 only from a pinned current-session acquisition',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261103003744_vnext_premarket_entry_v11.sql',import.meta.url),'utf8');
 for(const marker of ['ENTRY_V11_RUNTIME_BASELINE_DRIFT','ENTRY_V11_RUNTIME_PRIVILEGE_DRIFT','9600c4606c026bef9cab27d7dbdba5320c1fc0d01bd0c9c7774a86b0cceb289f',
  "r.checkpoint#>>'{acquired,entry_version}'","e#>>'{plan,not_before}' is distinct from r.business_date::text",'PREDICTION_PREMARKET_ENTRY_SCOPE',
  "jsonb_build_object('entry_versions'","'{postgres=X/postgres,service_role=X/postgres}'"])assert(sql.includes(marker),marker);
 assert(!/grant\s+execute|alter\s+table|delete\s+from|truncate\s|cron\.schedule/i.test(sql));
});
