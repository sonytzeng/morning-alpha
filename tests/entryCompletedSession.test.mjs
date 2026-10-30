import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEntry,evaluateCompletedSessionEntry,entryHash} from '../research/entry-opportunity.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {entryFixture,setup} from './helpers/entryFixtures.mjs';

async function completed(at='2026-10-30T21:10:00+08:00') {
 const old=setup(await entryFixture(),'breakout');
 const {business_date,mode,...input}=old;
 input.evaluation_time=at; input.data_through='2026-10-30';
 let d=input.data_through;
 for(const b of [...input.stocks[0].bars].reverse()) {
  b.date=d;b.available_at=d+'T20:00:00+08:00';d=previousMarketTradingDate('TW',d);
 }
 for(const observation of [input.market,input.stocks[0].fundamental,input.stocks[0].relative_strength,
  input.stocks[0].sector_return,input.stocks[0].events_reviewed]){
  observation.observed_at='2026-10-30T20:00:00+08:00';observation.available_at=observation.observed_at;
 }
 return input;
}
test('Friday completed real-time analysis uses Friday bars without waiting for Monday or changing evidence times',async()=>{
 const i=await completed(),before=structuredClone(i),r=await evaluateCompletedSessionEntry(i);
 assert.equal(r.mode,'AS_OF_RESEARCH');assert.equal(r.analysis_date,'2026-10-30');assert.equal(r.data_through,'2026-10-30');
 assert.equal(r.evaluation_time,i.evaluation_time);assert.equal(r.evidence_hash,await entryHash(i));
 assert.equal(r.candidates[2].status,'ENTRY_READY');assert.equal(r.candidates[2].plan.not_before,'2026-11-02');
 assert.equal(r.forward_sample,0);assert.equal(r.production_eligible,false);assert.deepEqual(i,before);
 assert.equal(r.plan_validity,'NEXT_SESSION_CONDITIONAL');
});
test('weekend analysis preserves Friday data date and actual Sunday evaluation time',async()=>{
 const r=await evaluateCompletedSessionEntry(await completed('2026-11-01T15:00:00+08:00'));
 assert.equal(r.analysis_date,'2026-11-01');assert.equal(r.data_through,'2026-10-30');
 assert.equal(r.candidates[2].plan.not_before,'2026-11-02');
});
test('reviewing older real data cannot move an expired plan to a later trading day',async()=>{
 const r=await evaluateCompletedSessionEntry(await completed('2026-11-04T15:00:00+08:00'));
 assert.equal(r.analysis_date,'2026-11-04');assert.equal(r.data_through,'2026-10-30');
 assert.equal(r.plan_validity,'HISTORICAL_REFERENCE_ONLY');assert.equal(r.candidates[2].plan.expires_on,'2026-11-02');
 assert.equal(r.forward_sample,0);
});
test('future, incomplete and non-trading data dates cannot become a completed-session analysis',async()=>{
 for(const patch of [{data_through:'2026-11-02'},{data_through:'2026-10-31'},
  {evaluation_time:'2026-10-30T12:00:00+08:00'},{evaluation_time:'not-time'}]){
  const i=await completed();
  await assert.rejects(()=>evaluateCompletedSessionEntry({...i,...patch}),/COMPLETED_ENTRY_(TIME|INPUT)_INVALID/);
 }
 const i=await completed();i.stocks[0].bars[19].available_at='2026-10-30T22:00:00+08:00';
 const r=await evaluateCompletedSessionEntry(i);assert(r.candidates.every(c=>c.status==='INSUFFICIENT_EVIDENCE'&&c.plan===null));
});
test('missing sessions and event evidence remain closed; bad fundamentals remain rejected',async()=>{
 for(const mutate of [i=>i.stocks[0].bars.pop(),i=>i.stocks[0].events_reviewed=null]){
  const i=await completed();mutate(i);const r=await evaluateCompletedSessionEntry(i);
  assert(r.candidates.every(c=>c.status==='INSUFFICIENT_EVIDENCE'&&c.plan===null));
 }
 const i=await completed();i.stocks[0].fundamental.value.revenue_yoy=-1;
 assert.equal((await evaluateCompletedSessionEntry(i)).candidates[2].status,'AVOID_ENTRY');
});
test('existing premarket contract still rejects same-day bars and preserves its original results',async()=>{
 const old=await entryFixture();assert.deepEqual(await evaluateEntry(old),await evaluateEntry(structuredClone(old)));
 const {data_through,...current}=await completed();
 const r=await evaluateEntry({...current,business_date:'2026-10-30',mode:'HISTORICAL_REPLAY'});
 assert(r.candidates.every(c=>c.status==='INSUFFICIENT_EVIDENCE'&&c.plan===null));
});
