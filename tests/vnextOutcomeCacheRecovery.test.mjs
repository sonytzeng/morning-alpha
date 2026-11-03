/** Bounded, synthetic RPC/clock controls only. No Provider, SQL, Production,
 * real timing evidence, Forward performance samples or credential access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {ADAPTER_VERSION,acquisitionPlan,directoryPlan,outcomePlan} from '../src/features/vnext/dailyAdapter.ts';
import {runDailyIntelligence,verifyDailyLock} from '../src/features/vnext/dailyIntelligence.ts';
import {targetSessions} from '../src/features/vnext/dailyOutcome.ts';
import {HORIZONS,snapshotHash} from '../src/features/vnext/contracts.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const date='2026-10-20',priorDate='2025-10-01',close=date+'T06:00:00.000Z',premarket=date+'T00:58:00.000Z';
const budgetMs=70000,sourceBeginMs=200,fetchLimit=8;
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'SYNTHETIC outcome-cache control',exchange:'TWSE',industry:'24'}));

// Like vnextDailyRuntimeRecovery, use actual engine locks, not hand-authored
// Outcome results. Empty inputs deliberately prove no research qualification.
// A small prior-date fixture avoids inventing history outside calendar coverage.
async function checkpoint(businessDate){
 const at=businessDate+'T00:58:00.000Z',through=previousMarketTradingDate('TW',businessDate);
 const body={inputs:companies.map(c=>({symbol:c.symbol,company:c.company,bars:[],facts:[],expected_sessions:[],
  cutoff:at,through,next_session:businessDate,v1_missing:Object.fromEntries(Object.keys(HORIZONS).map(h=>[h,['SYNTHETIC_NO_EVIDENCE']]))})),
  entry:null,evidence_cutoff:at};
 const acquired={...body,snapshot_hash:await snapshotHash(body)};
 let saved;
 const result=await runDailyIntelligence({business_date:businessDate,checkpoint:'OUTCOME_CACHE_CONTROL',mode:'FORWARD_SHADOW',provenance:'SYNTHETIC_CONTROL',
  core_ready:true,core_busy:false,source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:businessDate+'T01:00:00.000Z'},
 {exclusive:async(_key,work)=>work(),load:async()=>null,save:async state=>{saved=structuredClone(state);},lock:async()=>{}},
 {acquire:async()=>acquired,clock:()=>at,outcomes:async()=>({synthetic:true}),publication:async()=>[]});
 assert.equal(result.state,'COMPLETE');assert.equal(saved.locks.length,216);
 assert(saved.locks.every(lock=>lock.provenance==='SYNTHETIC_CONTROL'&&lock.research.state==='INSUFFICIENT'));
 assert((await Promise.all(saved.locks.map(verifyDailyLock))).every(Boolean));
 return saved;
}
async function receipt(task,payload={rows:[]}){
 const at=date+'T00:00:00.000Z';
 return {task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:ADAPTER_VERSION,
  raw_hash:await snapshotHash({synthetic_raw:payload}),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};
}
const saved=await checkpoint(date),prior=await checkpoint(priorDate);
const due=prior.locks.filter(lock=>lock.horizon==='LONG').slice(0,24).map(prediction=>({prediction,horizons:[250]}));
const tasks=await outcomePlan(date,due,companies,close),earlyTasks=await outcomePlan(date,due,companies,premarket);
const plan=await acquisitionPlan(date,companies),directories=await directoryPlan(date);
const directoryReceipts=await Promise.all(directories.map(task=>receipt(task,{rows:task.exchange==='TWSE'?companies:[]})));
const cached=await Promise.all(tasks.map(task=>receipt(task)));
assert.equal(due.length,24);assert.equal(tasks.length,325);assert.equal(new Set(tasks.map(task=>task.key)).size,325);
assert(due.every(p=>targetSessions(p.prediction.actionable_at,250)?.at(-1)<date));

function harness(t,{at=close,retained=cached}={}){
 let now=Date.parse(at),pending=structuredClone(due),pendingTask=null,claimCount=0,claimed=null;
 const clock=()=>new Date(now).toISOString(),advance=ms=>{now+=ms;};
 t.mock.method(Date,'now',()=>now);
 // Any accidental uninjected network use fails; fetchSource gets only the
 // local response below, including in partial-cache/scope-miss controls.
 t.mock.method(globalThis,'fetch',async()=>{throw Error('NETWORK_FORBIDDEN_IN_SYNTHETIC_CONTROL');});
 const cache=new Map(structuredClone([...directoryReceipts,...retained]).map(r=>[r.task.key,r]));
 const calls=[],fetches=[],writes=[],outcomes=[],dueReads=[];
 const run={id:'synthetic-outcome-cache-run',business_date:date,actionable_at:date+'T01:00:00.000Z',
  lease:'synthetic-lease',fence:0,plan:structuredClone(plan),cursor:plan.length,checkpoint:structuredClone(saved)};
 const checkpointBefore=structuredClone(run.checkpoint),dueBefore=structuredClone(due),planBefore=structuredClone(run.plan);
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1'){
   assert.equal(args.p_run,run.id);claimCount++;run.fence++;
   claimed=structuredClone(run);return {status:'ACQUIRED',run:claimed};
  }
  assert.equal(name,'vnext_daily_runtime_v1');
  assert.equal(args.p_fence,run.fence);assert.equal(args.p_lease,run.lease);
  const op=args.p_op,data=args.p_data;calls.push({op,data:structuredClone(data),at:now});
  if(op==='PREDICTIONS'){
   assert.equal(data.length,216);
   assert.deepEqual(data.map(row=>row.body),checkpointBefore.locks,'only identical prepared lock replay is permitted');
   assert.deepEqual(data.map(row=>row.hash),checkpointBefore.locks.map(lock=>lock.lock_hash));return {};
  }
  if(op==='DUE_OUTCOMES'){const rows=structuredClone(pending);dueReads.push(rows);return rows;}
  if(op==='SOURCE_BEGIN'){
   advance(sourceBeginMs);pendingTask=structuredClone(data);
   return cache.has(data.key)?{status:'CACHE',receipt:structuredClone(cache.get(data.key))}:{status:'FETCH'};
  }
  if(op==='SOURCES'){advance(sourceBeginMs);return structuredClone([...cache.values()]);}
  if(op==='SOURCE_SAVE'){
   const r=JSON.parse(data.text);assert(!cache.has(r.task.key),'a cache hit must not be fetched or rewritten');
   cache.set(r.task.key,r);writes.push(r);return {};
  }
  if(op==='OUTCOME'){
   assert(pending.some(p=>p.prediction.id===data.result.prediction_id));outcomes.push(structuredClone(data));return {};
  }
  if(op==='OUTCOME_CHECKED'){pending=pending.filter(p=>p.prediction.id!==data.id);return {};}
  if(op==='FINISH')return {};
  throw Error('UNEXPECTED_SYNTHETIC_RPC_'+op);
 };
 const ports={rpc,clock,sleep:async ms=>advance(ms),fetcher:async(url,init)=>{
  assert(pendingTask);assert.equal(url,pendingTask.url);assert(init.signal);
  assert(['PRICE','BENCHMARK'].includes(pendingTask.kind));fetches.push(pendingTask.key);
  const symbol=pendingTask.symbols[0],month=pendingTask.month.replace('-','');
  return Response.json({stat:'OK',date:month+'01',title:' '+(symbol??'')+' SYNTHETIC control',
   fields:pendingTask.kind==='BENCHMARK'?['日期','開盤指數','最高指數','最低指數','收盤指數']:['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],data:[]});
 }};
 return {run,cache,calls,fetches,writes,outcomes,get remaining(){return pending.length;},get claims(){return claimCount;},
  invoke:async()=>{
   const start=calls.length,fetchStart=fetches.length,writeStart=writes.length,outcomeStart=outcomes.length,started=now;
   const result=await workDailyRun(run.id,ports,budgetMs),elapsed=now-started;
   assert(elapsed<budgetMs,'each claim must yield within its simulated 70-second budget');
   assert(fetches.length-fetchStart<=fetchLimit,'retain the eight-fetch invocation bound');
   assert.deepEqual(run.checkpoint,checkpointBefore,'Outcome must never replace or enrich the immutable checkpoint');
   assert.deepEqual(claimed.checkpoint,checkpointBefore,'the actual claimed checkpoint must not be mutated in memory either');
   for(const rows of dueReads)for(const row of rows)assert.deepEqual(row.prediction,dueBefore.find(p=>p.prediction.id===row.prediction.id)?.prediction);
   assert.deepEqual(due,dueBefore,'prior prediction bodies and lock hashes remain unchanged');
   assert.deepEqual(run.plan,planBefore);assert.equal(run.cursor,planBefore.length);
   assert.equal(calls[start].op,'PREDICTIONS','prepared identical replay precedes Outcome work');
   return {result,elapsed,calls:calls.slice(start),fetches:fetches.slice(fetchStart),writes:writes.slice(writeStart),outcomes:outcomes.slice(outcomeStart)};
  }};
}
const outcomeBegins=claim=>claim.calls.filter(c=>c.op==='SOURCE_BEGIN'&&c.data.kind!=='DIRECTORY');
function unknownNotPerformance(rows){
 assert.equal(rows.length,24);assert.equal(new Set(rows.map(row=>row.result.prediction_id)).size,24);
 for(const {result} of rows){
  const prediction=due.find(p=>p.prediction.id===result.prediction_id)?.prediction;
  assert(prediction);assert.equal(result.prediction_hash,prediction.lock_hash);assert.equal(result.horizon,250);
  assert.equal(result.state,'UNKNOWN');assert.deepEqual(result.reasons,['PRICE_OR_BENCHMARK_SESSION_GAP']);
  assert.equal(result.observations,null);assert.equal(result.performance_eligible,false);assert.equal(result.forward_performance_sample,0);
  assert.equal(result.actual_fill_confirmed,false);
  for(const field of ['net_return','transaction_cost','mfe','mae','maximum_drawdown'])assert.equal(result[field],null);
 }
}

test('325 cached tasks / 24 LONG-250 locks reach Outcome under 200ms reservations; zero raw bars stay UNKNOWN, never performance', {timeout:10000},async t=>{
 const h=harness(t),a=await h.invoke();
 t.diagnostic(JSON.stringify({synthetic:'all-cache',source_begin:a.calls.filter(c=>c.op==='SOURCE_BEGIN').length,
  sources:a.calls.filter(c=>c.op==='SOURCES').length,outcomes:a.outcomes.length,elapsed_ms:a.elapsed}));
 assert.equal(a.result.status,'COMPLETE','cached-prefix replay must not exhaust the claim: '+a.result.reason);
 assert.equal(a.calls.filter(c=>c.op==='SOURCES').length,1,'preload immutable receipts once per Outcome claim');
 assert.equal(a.calls.filter(c=>c.op==='SOURCE_BEGIN').length,directories.length);
 assert.equal(outcomeBegins(a).length,0,'no per-task reservation RPCs for already cached Outcome receipts');
 assert.equal(a.fetches.length,0);assert.equal(a.writes.length,0);assert.equal(h.remaining,0);
 assert(a.elapsed<1000,'the entire cached prefix consumes one inventory read, not 325 reservation round trips');
 assert(cached.every(r=>r.payload.rows.length===0));unknownNotPerformance(a.outcomes);
 assert.equal(a.calls.filter(c=>c.op==='OUTCOME_CHECKED').length,24);
 assert((await Promise.all([...h.run.checkpoint.locks,...due.map(p=>p.prediction)].map(verifyDailyLock))).every(Boolean));
});

test('a cached 309-task prefix cannot starve 16 missing tail tasks: two bounded claims durably advance and finish', {timeout:10000},async t=>{
 const retained=cached.slice(0,-16),missing=tasks.slice(-16).map(task=>task.key),h=harness(t,{retained});
 const a=await h.invoke(),firstCacheSize=h.cache.size,firstRemaining=h.remaining,b=await h.invoke();
 const prefixes=[a,b].map(claim=>claim.calls.filter(c=>c.op==='SOURCE_BEGIN').map(c=>c.data.key));
 t.diagnostic(JSON.stringify({synthetic:'two-claims',source_begin:prefixes.map(keys=>keys.length),
  same_prefix:JSON.stringify(prefixes[0])===JSON.stringify(prefixes[1]),fetches:[a.fetches.length,b.fetches.length],
  outcomes:[a.outcomes.length,b.outcomes.length],elapsed_ms:[a.elapsed,b.elapsed]}));
 assert.equal(a.result.status,'QUEUED');assert.equal(a.result.reason,'OUTCOME_SOURCE_CONTINUATION');
 assert.equal(a.calls.filter(c=>c.op==='SOURCES').length,1);assert.deepEqual(outcomeBegins(a).map(c=>c.data.key),missing.slice(0,8));
 assert.deepEqual(a.fetches,missing.slice(0,8));assert.deepEqual(a.writes.map(r=>r.task.key),missing.slice(0,8));
 assert.equal(a.outcomes.length,0);assert.equal(firstRemaining,24);
 assert.equal(firstCacheSize,directories.length+retained.length+8);
 assert.equal(b.result.status,'COMPLETE','the next claim must skip both the old prefix and newly persisted receipts');
 assert.equal(b.calls.filter(c=>c.op==='SOURCES').length,1);assert.deepEqual(outcomeBegins(b).map(c=>c.data.key),missing.slice(8));
 assert.deepEqual(b.fetches,missing.slice(8));assert.deepEqual(b.writes.map(r=>r.task.key),missing.slice(8));
 assert.equal(h.claims,2);assert.equal(h.remaining,0);assert.equal(new Set(h.fetches).size,16);
 assert.deepEqual(h.fetches,missing);assert(h.writes.every(r=>r.payload.rows.length===0));unknownNotPerformance(b.outcomes);
});

for(const [label,mutate] of [
 ['task with a matching key but wrong symbol',r=>{r.task.symbols=['9999'];}],
 ['task with a matching key but wrong phase',r=>{r.task.scope=r.task.scope.replace(':CLOSE',':PREMARKET');}],
 ['adapter version',r=>{r.version='VNEXT_DAILY_OFFICIAL_WRONG';}],
 ['payload hash mismatch',r=>{r.payload_hash='f'.repeat(64);}],
 ['invalid payload hash',r=>{r.payload_hash='not-a-sha256';}],
 ['invalid raw hash',r=>{r.raw_hash='not-a-sha256';}],
 ['payload changed after hashing',r=>{r.payload.rows=[{symbol:'9999'}];}],
 ['future receipt availability',r=>{r.available_at='2026-10-21T00:00:00.000Z';}],
 ['first-seen after availability',r=>{r.first_seen_at='2026-10-20T00:01:00.000Z';}],
])test('retained Outcome rejects '+label+' before any Outcome or cache rewrite', {timeout:10000},async t=>{
 const retained=structuredClone(cached),r=retained.find(r=>r.task.kind==='PRICE'&&r.task.scope.endsWith(':CLOSE'));
 assert(r);mutate(r);
 const h=harness(t,{retained}),a=await h.invoke();
 assert.equal(a.result.status,'BLOCKED');assert.equal(a.result.reason,'OUTCOME_RECEIPT_INVALID');
 assert.equal(a.calls.filter(c=>c.op==='SOURCES').length,1);assert.equal(outcomeBegins(a).length,0);
 assert.equal(a.outcomes.length,0);assert.equal(a.calls.filter(c=>c.op==='OUTCOME_CHECKED').length,0);
 assert.equal(a.fetches.length,0);assert.equal(a.writes.length,0);assert.equal(h.remaining,24);
});

for(const [phase,at,expected,foreign] of [
 ['CLOSE',close,tasks,earlyTasks],['PREMARKET',premarket,earlyTasks,tasks],
])test(phase+' only reuses exact task keys/scope; the opposite phase cannot satisfy a missing receipt', {timeout:10000},async t=>{
 const keys=new Set(expected.map(task=>task.key)),otherPhase=foreign.filter(task=>!keys.has(task.key));
 assert.equal(expected.length,325);assert.equal(otherPhase.length,25);
 const missing=expected.find(task=>task.kind==='PRICE'&&task.scope.endsWith(':'+phase));assert(missing);
 const opposite=otherPhase.find(task=>task.url===missing.url);assert(opposite);assert.notEqual(opposite.key,missing.key);
 const retained=await Promise.all([...expected.filter(task=>task.key!==missing.key),...otherPhase].map(task=>receipt(task)));
 const h=harness(t,{at,retained}),foreignBefore=structuredClone(h.cache.get(opposite.key)),a=await h.invoke();
 assert.equal(a.result.status,'COMPLETE');assert.equal(a.calls.filter(c=>c.op==='SOURCES').length,1);
 assert.deepEqual(outcomeBegins(a).map(c=>c.data.key),[missing.key]);assert.deepEqual(a.fetches,[missing.key]);
 assert.equal(a.writes.length,1);assert.deepEqual(a.writes[0].task,missing);
 assert.deepEqual(h.cache.get(opposite.key),foreignBefore,'unrelated phase revision is neither reused nor overwritten');
 assert.equal(h.remaining,0);unknownNotPerformance(a.outcomes);
});
