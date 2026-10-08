import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEntry,entryHash,ENTRY_POLICY,STRATEGIES} from '../research/entry-opportunity.ts';
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
