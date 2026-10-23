// Isolated synthetic controls, not natural Forward or Edge CPU certification.
import test from 'node:test';import assert from 'node:assert/strict';
import {runDailyIntelligence} from '../src/features/vnext/dailyIntelligence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {fullCapacityAcquired} from './helpers/vnextFullSnapshotCapacity.mjs';
const date='2026-10-22',at=date+'T00:58:00.000Z',actionable=date+'T01:00:00.000Z';
const acquired=await fullCapacityAcquired(date,at);
const request={business_date:date,checkpoint:'SYNTHETIC_STAGE_BUDGET',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',
 core_ready:true,core_busy:false,source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:actionable};
function harness(){let state=null;const locks=[],saves=[];return {get state(){return state;},locks,saves,
 store:{exclusive:async(_key,f)=>f(),load:async()=>structuredClone(state),save:async s=>{state=structuredClone(s);saves.push([...s.completed]);},lock:async rows=>locks.push(structuredClone(rows))},
 ports:{acquire:async()=>structuredClone(acquired),clock:()=>at,outcomes:async()=>({state:'SYNTHETIC_NOT_MATURED'}),publication:async()=>({eligible:0,publishes:false})}};}
test('each durable prelock handoff preserves all72x250 inputs and the exact unbounded216-lock result',async()=>{
 assert.equal(acquired.inputs.reduce((n,i)=>n+i.bars.length,0),18000);assert(Buffer.byteLength(JSON.stringify(acquired))>16_000_000);
 const normal=harness();assert.equal((await runDailyIntelligence(request,normal.store,normal.ports)).state,'COMPLETE');
 const bounded=harness();
 for(const [index,stage] of ['ACQUISITION','RESEARCH','ENTRY'].entries()){
  const result=await runDailyIntelligence(request,bounded.store,bounded.ports,20000,1);
  assert.equal(result.state,'BUDGET_YIELDED');assert.deepEqual(bounded.state.completed,['ACQUISITION','RESEARCH','ENTRY'].slice(0,index+1));
  assert.equal(bounded.state.attempts[stage],1);assert.equal(bounded.locks.length,0);assert(!bounded.state.locks);
  assert.equal(bounded.state.finished,false);assert.deepEqual(bounded.state.acquired,acquired);
  assert.deepEqual(bounded.saves.at(-1),bounded.state.completed,'yield follows durable completion, not an uncommitted local push');
 }
 const final=await runDailyIntelligence(request,bounded.store,bounded.ports,20000,1);assert.equal(final.state,'COMPLETE');
 assert.equal(bounded.locks.length,1);assert.equal(bounded.locks[0].length,216);assert.deepEqual(bounded.locks,normal.locks);
 assert.deepEqual(bounded.state.attempts,normal.state.attempts);assert.deepEqual(bounded.state.completed,normal.state.completed);
 assert.equal(await snapshotHash(bounded.state.acquired),await snapshotHash(acquired));
});
test('a prelock handoff never bypasses hash revalidation, deadline or failed durable completion',async()=>{
 const h=harness();assert.equal((await runDailyIntelligence(request,h.store,h.ports,20000,1)).state,'BUDGET_YIELDED');
 const before=structuredClone(h.state);h.ports.clock=()=>actionable;
 await assert.rejects(()=>runDailyIntelligence(request,h.store,h.ports,20000,1),/FORWARD_WINDOW_EXPIRED/);
 assert.deepEqual(h.state,before);assert.equal(h.locks.length,0);
 h.ports.clock=()=>at;h.state.acquired.inputs[0].company+=' changed';
 await assert.rejects(()=>runDailyIntelligence(request,h.store,h.ports,20000,1),/ACQUISITION_HASH_MISMATCH/);assert.equal(h.locks.length,0);
 const failed=harness(),save=failed.store.save;failed.store.save=async s=>{if(s.completed.includes('ACQUISITION')&&!s.failure)throw Error('SYNTHETIC_COMMIT_DENIED');return save(s);};
 const result=await runDailyIntelligence(request,failed.store,failed.ports,20000,1);assert.equal(result.state,'BLOCKED');assert.equal(failed.locks.length,0);
});
test('invalid execution budgets refuse before any store or provider access',async()=>{
 for(const value of [-1,4,1.5,NaN,Infinity,null,'1']){
  const h=harness();await assert.rejects(()=>runDailyIntelligence(request,h.store,h.ports,20000,value),/REQUEST_INVALID/);
  assert.equal(h.state,null);assert.equal(h.locks.length,0);
 }
});
test('post-cutoff bookkeeping requires committed byte replay; a prepared batch alone never admits late Forward',async()=>{
 const h=harness();await runDailyIntelligence(request,h.store,h.ports);
 // Reproduce interruption immediately after prepare/commit, before recording
 // PREDICTION_LOCK completion. The prior lock timestamp and full bytes are kept.
 h.state.finished=false;h.state.completed=['ACQUISITION','RESEARCH','ENTRY'];
 h.state.attempts={ACQUISITION:1,RESEARCH:1,ENTRY:1,PREDICTION_LOCK:1};
 const original=structuredClone(h.state.locks);h.ports.clock=()=>date+'T01:00:03.000Z';
 const actualStore=h.store;let replayed=0;
 const unconfirmed={...actualStore,lock:async()=>{throw Error('MUST_NOT_INSERT_LATE');}};
 await assert.rejects(()=>runDailyIntelligence(request,unconfirmed,h.ports,20000,1),/FORWARD_WINDOW_EXPIRED/);
 const denied={...unconfirmed,confirmCommitted:async()=>{throw Error('FORWARD_TIME_INVALID');}};
 await assert.rejects(()=>runDailyIntelligence(request,denied,h.ports,20000,1),/FORWARD_TIME_INVALID/);
 assert.equal(h.state.finished,false);assert.deepEqual(h.state.locks,original);
 h.state.attempts.PREDICTION_LOCK=3;
 const committed={...unconfirmed,confirmCommitted:async rows=>{assert.deepEqual(rows,original);replayed++;}};
 const resumed=await runDailyIntelligence(request,committed,h.ports,20000,1);
 assert.equal(resumed.state,'COMPLETE');assert.equal(h.state.finished,true);assert(replayed>=1);
 assert.equal(h.state.attempts.PREDICTION_LOCK,3,'confirmed commit only closes bookkeeping; no reset or fourth write');
 assert.deepEqual(h.state.locks,original);assert(h.state.completed.includes('PUBLICATION'));
});
test('a prepared uncommitted attempt save crossing cutoff cannot call a default adapter writer',async()=>{
 const h=harness();await runDailyIntelligence(request,h.store,h.ports);
 h.state.finished=false;h.state.completed=['ACQUISITION','RESEARCH','ENTRY'];
 h.state.attempts={ACQUISITION:1,RESEARCH:1,ENTRY:1,PREDICTION_LOCK:1};h.locks.length=0;
 const save=h.store.save;h.store.save=async s=>{
  await save(s);if(s.attempts.PREDICTION_LOCK===2)h.ports.clock=()=>date+'T01:00:00.900Z';
 };
 const result=await runDailyIntelligence(request,h.store,h.ports,20000,1);
 assert.equal(result.state,'BLOCKED');assert.equal(h.state.failure.reason,'LATE_LOCK_NOT_FORWARD');
 assert.equal(h.locks.length,0);assert.equal(h.state.finished,false);
});
test('explicit committed-only handoff needs read-only capability and never repeats the prediction writer',async()=>{
 const h=harness();await assert.rejects(()=>runDailyIntelligence(request,h.store,h.ports,20000,0,true),/REQUEST_INVALID/);
 assert.equal(h.state,null);let confirms=0;
 h.store.confirmCommitted=async rows=>{assert.equal(h.locks.length,1);assert.deepEqual(rows,h.locks[0]);confirms++;};
 const first=await runDailyIntelligence(request,h.store,h.ports,20000,0,true);
 assert.equal(first.state,'BUDGET_YIELDED');assert(h.state.completed.includes('PREDICTION_LOCK'));assert.equal(h.state.finished,false);
 const exact=structuredClone(h.locks[0]);h.ports.clock=()=>date+'T01:00:03.000Z';
 const final=await runDailyIntelligence(request,h.store,h.ports,20000,0,true);
 assert.equal(final.state,'COMPLETE');assert.equal(h.locks.length,1);assert.deepEqual(h.locks[0],exact);assert.equal(confirms,1);
});
