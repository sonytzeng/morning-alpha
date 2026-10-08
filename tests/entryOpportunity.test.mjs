import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEntry,entryHash,ENTRY_POLICY,STRATEGIES,nextEntrySession} from '../research/entry-opportunity.ts';
import {evaluateEntryOutcome,summarizeEntryOutcomes} from '../research/entry-outcomes.ts';
import {entryFixture,setup} from './helpers/entryFixtures.mjs';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
test('all three models are independent, deterministic, versioned and leave inputs untouched',async()=>{
 const i=await entryFixture(),before=structuredClone(i),a=await evaluateEntry(i);
 assert.deepEqual(a,await evaluateEntry(i));assert.deepEqual(i,before);assert.equal(a.candidates.length,3);
 assert.deepEqual(a.candidates.map(c=>c.strategy),STRATEGIES);assert.equal(a.evidence_hash,await entryHash(i));
 assert(a.candidates.every(c=>c.evidence_confidence.probability===null));assert.equal(a.forward_sample,0);
});
test('bearish market does not automatically reject reversal; bullish does not authorize chasing',async()=>{
 const i=setup(await entryFixture(),'reversal');const bear=await evaluateEntry(i);
 i.market.value.direction='偏多';i.market.value.change_percent=4;const bull=await evaluateEntry(i);
 assert.deepEqual(bear.candidates.map(c=>c.status),bull.candidates.map(c=>c.status));
 assert.equal(bear.candidates[0].status,'ENTRY_READY');
 const chase=setup(await entryFixture(),'breakout');Object.assign(chase.stocks[0].bars[19],{open:150,close:180,high:182,low:149});
 const c=(await evaluateEntry(chase)).candidates[2];assert.equal(c.status,'AVOID_ENTRY');
});
test('valid breakout and false breakout have different entry judgments',async()=>{
 const ready=(await evaluateEntry(setup(await entryFixture(),'breakout'))).candidates[2];
 assert.equal(ready.status,'ENTRY_READY');assert(ready.plan.reward_risk>=2);
 const falseBreak=(await evaluateEntry(setup(await entryFixture(),'false-breakout'))).candidates[2];
 assert.equal(falseBreak.status,'AVOID_ENTRY');assert(falseBreak.reasons.some(s=>s.includes('假突破')));
});
test('uptrend pullback may confirm while a range requires confirmation; not a market-direction shortcut',async()=>{
 const i=setup(await entryFixture(),'pullback');const c=(await evaluateEntry(i)).candidates[1];assert.equal(c.status,'ENTRY_READY');
 const flat=(await evaluateEntry(await entryFixture())).candidates;assert(flat.every(c=>c.status!=='ENTRY_READY'));
});
test('missing, stale, future, duplicate and wrong-session evidence fail closed without prices',async()=>{
 for(const mutate of [i=>i.stocks[0].bars.pop(),i=>i.market=null,i=>i.stocks[0].fundamental=null,
  i=>i.stocks[0].bars[0].available_at='2999-01-01',i=>i.stocks[0].bars[0].date=i.stocks[0].bars[1].date,
  i=>i.stocks[0].bars[0].low=-1,i=>i.stocks[0].relative_strength.value=NaN,i=>i.stocks[0].events_reviewed=null]){
  const i=await entryFixture();mutate(i);const r=await evaluateEntry(i);
  assert(r.candidates.every(c=>c.status==='INSUFFICIENT_EVIDENCE'&&c.plan===null));
 }
});
test('actual deterioration and official event uncertainty are not silently bullish',async()=>{
 const i=setup(await entryFixture(),'reversal');i.stocks[0].fundamental.value.revenue_yoy=-.1;
 assert.equal((await evaluateEntry(i)).candidates[0].status,'AVOID_ENTRY');
 i.stocks[0].fundamental.value.revenue_yoy=.1;i.stocks[0].events_reviewed.value=false;
 assert.equal((await evaluateEntry(i)).candidates[0].status,'WAIT_CONFIRMATION');
});
async function outcomeFixture(){
 const i=setup(await entryFixture(),'breakout'),r=await evaluateEntry(i),p=r.candidates[2];
 const dates=[p.plan.not_before];while(dates.length<20)dates.push(nextEntrySession(dates.at(-1)));
 const bars=dates.map(date=>({date,open:p.plan.trigger+.1,high:p.plan.trigger+1,low:p.plan.trigger-.1,close:p.plan.trigger+.5,volume:1000000,amount:100000000,source_ref:'SYNTHETIC_OUTCOME:'+date,available_at:date+'T14:00:00+08:00'}));
 return {lock:{id:'SYNTHETIC_LOCK',symbol:p.symbol,strategy_version:p.strategy_version,mode:'FORWARD',provenance:'SYNTHETIC_TEST',locked_at:i.evaluation_time,evaluation_time:i.evaluation_time,evidence_hash:r.evidence_hash,prediction:p},e:{bars,benchmark:structuredClone(bars),observed_at:dates.at(-1)+'T15:00:00+08:00',adjustment_verified:true,executable:true,source_ref:'SYNTHETIC_EXECUTABILITY'}};
}
test('five trading-session horizons include costs and never credit unmatured outcomes',async()=>{
 const {lock,e}=await outcomeFixture();
 for(const h of [1,3,5,10,20]){const r=await evaluateEntryOutcome(lock,e,h);assert.equal(r.state,'OBSERVED');assert(r.net_return<r.gross_return);assert.equal(r.horizon,h);}
 const no=await evaluateEntryOutcome(lock,{...e,observed_at:lock.locked_at},20);assert.equal(no.reason,'NOT_MATURED');
 assert.equal((await evaluateEntryOutcome(lock,{...e,adjustment_verified:false},1)).reason,'EXECUTABILITY_OR_ADJUSTMENT_UNVERIFIED');
});
test('gaps, jumps outside entry, same-bar stop/target, duplicate outcomes and historical exclusion',async()=>{
 const {lock,e}=await outcomeFixture();
 const gap=structuredClone(e);gap.bars.pop();assert.equal((await evaluateEntryOutcome(lock,gap,20)).state,'UNAVAILABLE');
 const jump=structuredClone(e);jump.bars[0].open=lock.prediction.plan.reference_range[1]+1;jump.bars[0].high=jump.bars[0].open+1;
 assert.equal((await evaluateEntryOutcome(lock,jump,1)).state,'NOT_ENTERED');
 const both=structuredClone(e);both.bars[0].high=lock.prediction.plan.target+1;both.bars[0].low=lock.prediction.plan.stop-1;
 const stopped=await evaluateEntryOutcome(lock,both,1);assert(stopped.stop_hit);assert.equal(stopped.target_hit,false);assert.equal(stopped.mfe,0);
 const historical=await evaluateEntryOutcome({...lock,mode:'HISTORICAL_REPLAY'},e,1);
 assert(summarizeEntryOutcomes([historical]).every(s=>s.entered_samples===0&&s.win_rate===null));
 const r=await evaluateEntryOutcome(lock,e,1);assert.equal(summarizeEntryOutcomes([r,r])[0].entered_samples,0,'synthetic FORWARD is never a real sample');
 assert.equal(summarizeEntryOutcomes([{...r,provenance:undefined}])[0].entered_samples,0,'missing provenance is never a real sample');
 assert.throws(()=>summarizeEntryOutcomes([r,{...r,net_return:1}]),/CONFLICT/);
});
test('existing true retained October evidence is replayed honestly, not padded into twenty OHLC bars',async()=>{
 const capsule=JSON.parse(readFileSync(new URL('./fixtures/recommendation-retained-20261006.json',import.meta.url)));
 const raw=gunzipSync(Buffer.from(capsule.data,'base64')),data=JSON.parse(raw);
 assert.equal(createHash('sha256').update(raw).digest('hex'),capsule.sha256);
 for(const [date,cutoff] of Object.entries({'2026-10-02':'2026-10-01T23:05:19.521Z','2026-10-05':'2026-10-04T23:05:25.164Z','2026-10-06':'2026-10-05T23:05:13.729Z'})){
  // The saved source has no complete stock candle acquisition. Do not borrow
  // synthetic bars or present a later capture as historically available.
  const i={business_date:date,evaluation_time:cutoff,provenance:'REAL_RETAINED',mode:'HISTORICAL_REPLAY',
   source_evidence_hash:capsule.sha256,source_revision:'existing-retained-read-model:'+date,market:null,
   stocks:data.universe.filter(s=>s.is_active&&Date.parse(s.created_at)<=Date.parse(cutoff)).map(s=>({symbol:s.symbol,name:s.stock_name,
    bars:[],fundamental:null,relative_strength:null,sector_return:null,events_reviewed:null,v2_status:null}))};
  assert.equal(i.stocks.length,72);
  const r=await evaluateEntry(i);assert(r.candidates.every(c=>c.status==='INSUFFICIENT_EVIDENCE'));assert.equal(r.forward_sample,0);
 }
});
test('frozen cost hypotheses are explicit, positive and not claimed to be actual account costs',()=>{
 assert(ENTRY_POLICY.buyFee>0&&ENTRY_POLICY.sellTax>0&&ENTRY_POLICY.slippageEachSide>0);assert(ENTRY_POLICY.minimumFeeUnmodelled);
});
