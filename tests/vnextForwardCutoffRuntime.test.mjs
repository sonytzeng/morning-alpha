/** Dynamic-clock isolated controls, NOT the 152-invocation natural history,
 * Provider timings, SQL execution, Production Forward samples or performance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {acquisitionPlan,directoryPlan,assembleDaily} from '../src/features/vnext/dailyAdapter.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {verifyDailyLock,runDailyIntelligence,DAILY_INTELLIGENCE_VERSION} from '../src/features/vnext/dailyIntelligence.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const date='2026-10-20',actionable=date+'T01:00:00.000Z';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'SYNTHETIC clock control',exchange:'TWSE',industry:'24'}));
const fullPlan=await acquisitionPlan(date,companies),directories=await directoryPlan(date);
async function receipt(task,payload={rows:[]}){
 const at=date+'T00:00:00.000Z',hash=await snapshotHash(payload);
 return {task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:hash,payload_hash:hash,payload,status:'OK',reason:null};
}
const directoryReceipts=await Promise.all(directories.map(t=>receipt(t,{rows:t.exchange==='TWSE'?companies:[]})));
const retainedReceipts=await Promise.all(fullPlan.map(t=>receipt(t)));
const market={value:{direction:'NEUTRAL',regime:'SYNTHETIC_CONTROL'},source_ref:'isolated-canonical',
 observed_at:date+'T00:00:00.000Z',available_at:date+'T00:00:00.000Z'};
// A prior-date prediction from the actual engine, not a hand-authored outcome.
const priorAt='2026-10-19T00:58:00.000Z',priorAcquired=await assembleDaily('2026-10-19',companies,[],priorAt);
let priorState;
await runDailyIntelligence({business_date:'2026-10-19',checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',
 core_ready:true,core_busy:false,source_revision:priorAcquired.snapshot_hash,source_hash:priorAcquired.snapshot_hash,actionable_at:'2026-10-19T01:00:00.000Z'},
 {exclusive:async(_key,work)=>work(),load:async()=>null,save:async s=>{priorState=structuredClone(s);},lock:async()=>{}},
 {acquire:async()=>priorAcquired,clock:()=>priorAt,outcomes:async()=>({}),publication:async()=>[]});

function harness(t,{at=date+'T00:57:15.000Z',plan=fullPlan.filter(t=>t.kind==='PRICE').slice(0,20),cursor=0,
 allRetained=false,marketReady=true,sourcesMs=0,assemblyHashMs=0,engineHashMs=0,checkpointMs=25,firstCheckpointMs,fetchMs=0,predictionMs=0,predictionAckMs=0,loseCommitResponse=false}={}){
 let now=Date.parse(at),phase='OTHER',pendingTask=null,lost=false;
 const advance=ms=>{now+=ms;},clock=()=>new Date(now).toISOString();
 t.mock.method(Date,'now',()=>now);
 const digest=crypto.subtle.digest.bind(crypto.subtle);
 t.mock.method(crypto.subtle,'digest',async(...args)=>{
  // The digest itself is real; only its elapsed time is controlled.
  advance(phase==='ASSEMBLY'?assemblyHashMs:phase==='ENGINE'?engineHashMs:0);
  return digest(...args);
 });
 const cache=new Map([...directoryReceipts,...(allRetained?retainedReceipts:[])].map(r=>[r.task.key,r]));
 const calls=[],claims=[],http=[],committed=new Map(),committedAt=[],checkpoints=[];
 let due=[],canonicalReady=marketReady;
 const run={id:'isolated-forward-run',business_date:date,actionable_at:actionable,state:'QUEUED',lease:'isolated-lease',fence:1,plan,cursor,checkpoint:{}};
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1'){
   phase='OTHER';
   // Model this SQL state gate only, not real concurrency/global leases/date/
   // invocation-budget enforcement: SQL lines84-105 remain independently tested.
   const previous=run.state;
   if(['COMPLETE','EXPIRED'].includes(previous)&&due.length===0){claims.push({previous,status:previous});return {status:previous};}
   claims.push({previous,status:'ACQUIRED'});run.state='RUNNING';run.lease='isolated-lease';
   return {status:'ACQUIRED',run:structuredClone(run)};
  }
  const op=args.p_op,data=args.p_data;calls.push({op,at:clock(),data:structuredClone(data)});
  if(op==='SOURCE_BEGIN'){pendingTask=data;return cache.has(data.key)?{status:'CACHE',receipt:cache.get(data.key)}:{status:'FETCH'};}
  if(op==='SOURCE_SAVE'){const r=JSON.parse(data.text);cache.set(r.task.key,r);return {};}
  if(op==='SOURCE_FAIL')return {};
  if(op==='PLAN'){run.plan=structuredClone(data);return {};}
  if(op==='CURSOR'){assert(data.cursor>=run.cursor);run.cursor=data.cursor;return {};}
  if(op==='SOURCES'){advance(sourcesMs);phase='ASSEMBLY';return [...cache.values()];}
  if(op==='ENTRY_SOURCE')return canonicalReady?{market}:{};
  if(op==='CHECKPOINT'){
   phase='ENGINE';advance(checkpoints.length===0&&firstCheckpointMs!==undefined?firstCheckpointMs:checkpointMs);
   if(run.checkpoint.locks)assert.deepEqual(data.locks,run.checkpoint.locks,'prepared bytes immutable');
   if(run.source_revision)assert.equal(data.acquired?.snapshot_hash,run.source_revision,'acquired revision immutable');
   run.checkpoint=structuredClone(data);run.source_revision=data.acquired?.snapshot_hash??null;
   checkpoints.push({at:clock(),state:structuredClone(data)});return {};
  }
  if(op==='PREDICTIONS'){
   advance(predictionMs);assert.equal(data.length,216);
   // Isolated protocol double: exact retries precede the time veto, as in the
   // unchanged SQL. It is not a substitute for the parent's exact-SQL test.
   for(const row of data){
    assert.deepEqual(row.body,run.checkpoint.locks.find(x=>x.id===row.body.id));
    if(committed.has(row.body.id)){assert.deepEqual(committed.get(row.body.id),row);continue;}
    if(now>=Date.parse(actionable))throw Error('FORWARD_TIME_INVALID');
    assert(Date.parse(row.body.locked_at)<=now);assert(Date.parse(row.body.locked_at)<Date.parse(actionable));
   }
   for(const row of data)committed.set(row.body.id,structuredClone(row));
   committedAt.push(clock());advance(predictionAckMs);
   if(loseCommitResponse&&!lost){lost=true;throw Error('DATABASE_RPC_REJECTED');}
   return {};
  }
  if(op==='DUE_OUTCOMES')return structuredClone(due);
  if(op==='OUTCOME')return {};
  if(op==='OUTCOME_CHECKED'){due=due.filter(p=>p.prediction.id!==data.id);return {};}
  if(op==='FINISH'){run.state=data.status;run.reason=data.reason;run.lease=null;return {};}
  throw Error('UNEXPECTED_ISOLATED_RPC');
 };
 const ports={rpc,clock,sleep:async ms=>advance(ms),fetcher:async(_url,init)=>{
  assert(init.signal);http.push(pendingTask.key);advance(fetchMs);
  const symbol=pendingTask.symbols[0],month=pendingTask.month.replace('-','');
  return Response.json({stat:'OK',date:month+'01',title:' '+symbol+' SYNTHETIC',
   fields:pendingTask.kind==='BENCHMARK'?['日期','開盤指數','最高指數','最低指數','收盤指數']:['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],data:[]});
 }};
 const prepareAcquired=async()=>{
  assert.deepEqual(run.checkpoint,{});phase='ASSEMBLY';
  // Seed only the already durable assembly boundary. Use real retained cache
  // rows and the current clock; do not prevalidate, evaluate, lock or rewind.
  const acquired=await assembleDaily(date,companies,[...cache.values()],clock(),canonicalReady?market:null);
  run.checkpoint={acquired};run.source_revision=acquired.snapshot_hash;phase='OTHER';
  assert.deepEqual(Object.keys(run.checkpoint),['acquired']);assert.equal(committed.size,0);
  return structuredClone(acquired);
 };
 return {run,calls,claims,http,committed,committedAt,checkpoints,clock,advance,get dueRemaining(){return due.length;},setMarket:v=>{canonicalReady=v;},setDue:v=>{due=v;},
  prepareAcquired,
  invoke:async budget=>{const start=calls.length;const result=await workDailyRun(run.id,ports,budget);return {result,calls:calls.slice(start)};}};
}

function assertAcquiredPin(h,invocation){
 assert.equal(invocation.result.status,'QUEUED');assert.equal(invocation.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(invocation.result.continue,true);assert.equal(invocation.result.retry_after_seconds,3);
 assert.deepEqual(Object.keys(h.run.checkpoint),['acquired'],'pin has no request binding, attempts, quality approval or locks');
 assert.equal(h.run.checkpoint.acquired.inputs.length,72);assert.equal(h.run.source_revision,h.run.checkpoint.acquired.snapshot_hash);
 assert.equal(h.committed.size,0);assert(!invocation.calls.some(c=>c.op==='PREDICTIONS'));
 assert.equal(invocation.calls.filter(c=>c.op==='CHECKPOINT').length,1);assert.equal(h.checkpoints.length,1);
 return structuredClone(h.run.checkpoint.acquired);
}
function assertAcquiredReuse(h,acquired,invocation){
 assert.deepEqual(h.run.checkpoint.acquired,acquired);assert.equal(h.run.source_revision,acquired.snapshot_hash);
 assert(!invocation.calls.some(c=>['SOURCES','ENTRY_SOURCE'].includes(c.op)));
}

test('dynamic reproducer: all retained sources can finish assembly after cutoff without any Forward lock',async t=>{
 const h=harness(t,{at:date+'T00:59:15.000Z',cursor:fullPlan.length,plan:fullPlan,allRetained:true,sourcesMs:5000,assemblyHashMs:35});
 const a=await h.invoke();
 assert(Date.parse(h.clock())>=Date.parse(actionable),'real assembly hashing advances the business clock past 09:00');
 assert.equal(h.committed.size,0);assert.equal(h.run.source_revision??null,null);
 assert(!a.calls.some(c=>c.op==='PREDICTIONS'));assert(!a.calls.some(c=>c.op==='CHECKPOINT'));
 assert.equal(a.result.status,'EXPIRED');assert.equal(a.result.reason,'LATE_ACQUISITION_NOT_FORWARD');
});

test('reserve window stops cold acquisition and runs the real 72x3 engine with truthful insufficient evidence',async t=>{
 const h=harness(t,{fetchMs:10000});const a=await h.invoke();
 const acquired=assertAcquiredPin(h,a);h.advance(3000);const b=await h.invoke();assertAcquiredReuse(h,acquired,b);
 assert.equal(h.http.length,0,'do not consume the preparation window fetching deep history');
 assert.equal(h.committed.size,216);assert.equal(b.result.reason,'COLD_BOOTSTRAP_WITH_IMMUTABLE_LOCK');
 const locks=[...h.committed.values()].map(r=>r.body);
 assert(locks.every(l=>l.research.state==='INSUFFICIENT'&&l.entry.every(e=>e.status==='INSUFFICIENT_EVIDENCE')));
 assert(locks.every(l=>Date.parse(l.locked_at)<Date.parse(actionable)));assert(await verifyDailyLock(locks[0]));
 assert.deepEqual(h.run.checkpoint.acquired.entry.market,market,'do not replace an available canonical with null');
 assert.deepEqual(h.run.plan,fullPlan.filter(t=>t.kind==='PRICE').slice(0,20));assert.equal(h.run.cursor,0);
 assert.equal(h.run.checkpoint.publication.publishes,false);assert.equal(h.run.checkpoint.publication.eligible,0);
});

test('original canonical wait remains in force; later available market is included, not frozen null',async t=>{
 const h=harness(t,{marketReady:false});const a=await h.invoke();
 assert.equal(a.result.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(a.result.retry_after_seconds,30);
 assert.equal(h.committed.size,0);assert.equal(h.run.source_revision??null,null);
 h.advance(30000);h.setMarket(true);const b=await h.invoke();
 const acquired=assertAcquiredPin(h,b);h.advance(3000);const c=await h.invoke();assertAcquiredReuse(h,acquired,c);
 assert.equal(h.committed.size,216);assert.equal(c.result.reason,'COLD_BOOTSTRAP_WITH_IMMUTABLE_LOCK');
 assert.deepEqual(h.run.checkpoint.acquired.entry.market,market);
});

test('unchanged last-minute canonical-unavailable fallback remains truthful insufficient evidence',async t=>{
 const h=harness(t,{at:date+'T00:59:15.000Z',plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1,marketReady:false});
 const a=await h.invoke(),acquired=assertAcquiredPin(h,a);h.advance(3000);const b=await h.invoke();assertAcquiredReuse(h,acquired,b);
 assert.equal(b.result.status,'COMPLETE');assert.equal(h.committed.size,216);
 assert.equal(h.run.checkpoint.acquired.entry.market,null);
 assert([...h.committed.values()].every(r=>r.body.research.state==='INSUFFICIENT'));
 assert.equal(h.run.checkpoint.publication.eligible,0);
});

test('expensive assembly checkpoints acquired, then resumes engine without SOURCES or revision replacement',async t=>{
 const h=harness(t,{at:date+'T00:57:10.000Z',cursor:fullPlan.length,plan:fullPlan,allRetained:true,sourcesMs:5000,assemblyHashMs:35});
 const a=await h.invoke(),acquired=assertAcquiredPin(h,a),revision=h.run.source_revision;
 assert(h.run.source_revision);assert(h.run.checkpoint.acquired);
 h.advance(3000);const b=await h.invoke();
 assert.equal(b.result.status,'COMPLETE');assert.equal(h.committed.size,216);assert.equal(h.run.source_revision,revision);
 assertAcquiredReuse(h,acquired,b);assert(h.run.checkpoint.completed.includes('ACQUISITION'));
 assert([...h.committed.values()].every(r=>Date.parse(r.body.locked_at)<Date.parse(actionable)));
});

test('prevalidation pin survives delayed acknowledgement; next lifecycle starts acquisition attempt one without SOURCES',async t=>{
 // Real assembly digests consume 50s of controlled elapsed CPU time after
 // a 10s SOURCES read. The first CHECKPOINT ack takes 6s (below the adapter's
 // 8s transport timeout), crossing the invocation reserve, not business cutoff.
 const hashMs=50000/(retainedReceipts.length+directoryReceipts.length+5);
 const h=harness(t,{at:date+'T00:56:00.000Z',plan:fullPlan,cursor:fullPlan.length,allRetained:true,
  sourcesMs:10000,assemblyHashMs:hashMs,firstCheckpointMs:6000});
 const a=await h.invoke(),acquired=assertAcquiredPin(h,a),first=structuredClone(h.run.checkpoint);
 const expected=await boundCheckpoint(acquired);
 h.advance(3000);const b=await h.invoke();
 assert.equal(b.result.status,'COMPLETE','second claim must not fail '+b.result.reason);assert.equal(h.committed.size,216);
 assert(first.acquired,'prevalidation pin retains assembled bytes without claiming validation completed');
 assert.deepEqual(h.checkpoints[1].state,expected,'first validation attempt persists before any completed stage');
 assert.equal(h.run.checkpoint.key,expected.key);assert.equal(h.run.checkpoint.request_hash,expected.request_hash);
 assert.equal(h.run.checkpoint.attempts.ACQUISITION,1,'an assembly-only pin has not consumed a validation attempt');
 assertAcquiredReuse(h,acquired,b);
 assert(h.checkpoints.every(c=>c.state.acquired?.snapshot_hash===first.acquired.snapshot_hash));
});

async function boundCheckpoint(acquired){
 const request={business_date:date,checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',
  core_ready:true,core_busy:false,source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:actionable};
 return {key:await snapshotHash({version:DAILY_INTELLIGENCE_VERSION,date,checkpoint:request.checkpoint,mode:request.mode,provenance:request.provenance}),
  request_hash:await snapshotHash(request),attempts:{ACQUISITION:1},completed:[],finished:false,acquired};
}

test('legacy request-bound checkpoint without acquired fails closed without guessing a cutoff or rewriting attempts',async t=>{
 const h=harness(t,{plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1});
 const acquired=await assembleDaily(date,companies,[],h.clock(),market),legacy=await boundCheckpoint(acquired);
 delete legacy.acquired;h.run.checkpoint=structuredClone(legacy);h.run.source_revision=null;
 const a=await h.invoke();assert.equal(a.result.status,'BLOCKED');assert.equal(a.result.reason,'CHECKPOINT_ACQUIRED_MISSING');
 assert.deepEqual(h.run.checkpoint,legacy);assert.equal(h.run.source_revision,null);assert.equal(h.committed.size,0);
 assert(!a.calls.some(c=>['SOURCES','ENTRY_SOURCE','CHECKPOINT','PREDICTIONS'].includes(c.op)));
});

for(const [label,reason,mutate]of[
 ['future cutoff','FUTURE_CUTOFF',a=>{a.evidence_cutoff=date+'T00:58:15.000Z';}],
 ['future evidence','POINT_IN_TIME_INVALID',a=>{const future=date+'T00:58:15.000Z';a.inputs[0].facts.push({
  id:'synthetic-future-revenue',source:fullPlan[0].url,evidence_hash:'a'.repeat(64),published_at:null,first_seen_at:future,available_at:future,as_of:future,
  kind:'REVENUE',period:'2026-09',values:{yoy_percent:1,mom_percent:1},basis:'MONTHLY'});}],
 ['wrong acquired hash','ACQUISITION_HASH_MISMATCH',()=>{}],
])test('pinned acquired is not quality approval: resumed '+label+' still rejects before research or lock',async t=>{
 const h=harness(t,{plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1}),acquired=await assembleDaily(date,companies,[],h.clock(),market);
 mutate(acquired);const {snapshot_hash,...body}=acquired;void snapshot_hash;
 acquired.snapshot_hash=label==='wrong acquired hash'?'f'.repeat(64):await snapshotHash(body);
 // A malicious but request-bound stored snapshot tests the original validator;
 // it is not a source receipt or a claim of genuine retained market evidence.
 h.run.checkpoint=await boundCheckpoint(acquired);h.run.source_revision=acquired.snapshot_hash;
 const before=structuredClone(h.run.checkpoint),a=await h.invoke();
 assert.equal(a.result.status,'BLOCKED');assert.equal(a.result.reason,reason);assert.equal(h.committed.size,0);
 assert.deepEqual(h.run.checkpoint,before);assert(!a.calls.some(c=>['SOURCES','ENTRY_SOURCE','CHECKPOINT','PREDICTIONS'].includes(c.op)));
});

test('acquired but unprepared checkpoint cannot stall legal cold bootstrap after cutoff',async t=>{
 const h=harness(t,{at:date+'T00:59:58.000Z',plan:fullPlan,allRetained:true});
 const a=await h.invoke(),acquired=assertAcquiredPin(h,a);assert(acquired);assert.equal(h.run.cursor,0);
 h.advance(3000);const b=await h.invoke();assert(Date.parse(h.clock())>=Date.parse(actionable));
 assert.equal(b.result.status,'EXPIRED');assert.equal(h.run.cursor,fullPlan.length);
 assert.equal(h.committed.size,0);assertAcquiredReuse(h,acquired,b);
 assert(!b.calls.some(c=>['SOURCES','ENTRY_SOURCE','CHECKPOINT','PREDICTIONS'].includes(c.op)));
});

test('invocation resource exhaustion is queued, not mislabeled business expiry',async t=>{
 const h=harness(t);const a=await h.invoke(20000);
 assert.equal(a.result.status,'QUEUED');assert.equal(h.committed.size,0);assert(Date.parse(h.clock())<Date.parse(actionable));
});

test('real lock hashing across cutoff cannot persist a newly backdated prepared batch',async t=>{
 const h=harness(t,{at:date+'T00:59:59.500Z',plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1,engineHashMs:5,checkpointMs:0});
 await h.prepareAcquired();
 const a=await h.invoke();assert(Date.parse(h.clock())>=Date.parse(actionable));
 assert.equal(h.committed.size,0);assert(!a.calls.some(c=>c.op==='PREDICTIONS'));
 assert(!h.checkpoints.some(c=>c.state.locks),'no new prepared lock checkpoint after crossing business cutoff');
 assert.equal(a.result.status,'EXPIRED');
});

test('late cold bootstrap still advances across bounded invocations, but never evaluates or creates Forward',async t=>{
 const h=harness(t,{at:actionable});let last,invocations=0;
 while(h.run.cursor<h.run.plan.length){
  const before=h.run.cursor;last=await h.invoke();invocations++;
  assert(invocations<=3);assert(h.run.cursor>before);
  assert(!last.calls.some(c=>['SOURCES','ENTRY_SOURCE','CHECKPOINT','PREDICTIONS'].includes(c.op)));
  assert.equal(h.committed.size,0);h.advance(3000);
 }
 assert.equal(h.http.length,20);assert.equal(new Set(h.http).size,20);assert.equal(invocations,3);
 assert.equal(last.result.status,'EXPIRED');assert.equal(last.result.reason,'LATE_ACQUISITION_NOT_FORWARD');
 assert(h.calls.filter(c=>c.op==='SOURCE_SAVE').every(c=>Date.parse(JSON.parse(c.data.text).available_at)>=Date.parse(actionable)));
});

test('SQL time veto stays EXPIRED with immutable prepared bytes; no-due terminal claim cannot replay them',async t=>{
 const h=harness(t,{at:date+'T00:59:40.000Z',plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1,predictionMs:25000});
 await h.prepareAcquired();
 const a=await h.invoke();assert.equal(a.result.status,'EXPIRED');assert.equal(a.result.reason,'FORWARD_TIME_INVALID');
 assert.equal(h.committed.size,0);assert.equal(h.run.checkpoint.locks.length,216);
 const prepared=structuredClone(h.run.checkpoint.locks);const b=await h.invoke();
 assert.deepEqual(b.result,{status:'EXPIRED',continue:false});assert.equal(b.calls.length,0);
 assert.deepEqual(h.claims.at(-1),{previous:'EXPIRED',status:'EXPIRED'});
 assert.deepEqual(h.run.checkpoint.locks,prepared);assert.equal(h.committed.size,0);
});

test('lost successful commit response can reconcile on the NEXT authorized lifecycle claim, not automatic continuation',async t=>{
 const h=harness(t,{plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1,loseCommitResponse:true});
 await h.prepareAcquired();
 const a=await h.invoke();assert.equal(a.result.status,'BLOCKED');assert.equal(h.committed.size,216);
 assert.equal(a.result.continue,false);assert.equal(h.run.state,'BLOCKED');assert.equal(h.run.lease,null);assert.equal(h.claims.length,1);
 const prepared=structuredClone(h.run.checkpoint.locks),committed=structuredClone([...h.committed]);
 // Explicit second invocation models a subsequent authorized same-day natural
 // Lifecycle caller. BLOCKED did not schedule it. This isolated control does
 // not establish automatic liveness or replace normal-BLOCKED exact-SQL proof.
 h.advance(180000);const b=await h.invoke();
 assert.deepEqual(h.claims.at(-1),{previous:'BLOCKED',status:'ACQUIRED'});
 assert.equal(b.calls[0].op,'PREDICTIONS');assert.equal(b.result.status,'COMPLETE');
 assert.deepEqual([...h.committed],committed);assert.deepEqual(h.run.checkpoint.locks,prepared);
});

for(const terminal of ['COMPLETE','EXPIRED'])test(terminal+' without due work is not reclaimed; due work opens the existing claim gate',async t=>{
 const h=harness(t,{at:terminal==='COMPLETE'?date+'T00:57:15.000Z':date+'T01:10:00.000Z',plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1});
 if(terminal==='COMPLETE')await h.prepareAcquired();
 const a=await h.invoke();assert.equal(a.result.status,terminal);assert.equal(h.run.state,terminal);
 const b=await h.invoke();assert.deepEqual(b.result,{status:terminal,continue:false});assert.equal(b.calls.length,0);
 assert.deepEqual(h.claims.at(-1),{previous:terminal,status:terminal});
 h.setDue([{prediction:priorState.locks.find(l=>l.horizon==='SHORT'),horizons:[1]}]);
 const c=await h.invoke();assert.deepEqual(h.claims.at(-1),{previous:terminal,status:'ACQUIRED'});
 assert.equal(c.calls.filter(x=>x.op==='OUTCOME').length,1);assert.equal(h.dueRemaining,0);
});

test('confirmed pre-cutoff commit remains valid when read-only publication checks finish after cutoff',async t=>{
 const h=harness(t,{at:date+'T00:59:59.300Z',plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1,engineHashMs:1,checkpointMs:0});
 await h.prepareAcquired();
 const a=await h.invoke();assert.equal(a.result.status,'COMPLETE');assert.equal(h.committed.size,216);
 assert(Date.parse(h.clock())>=Date.parse(actionable));
 assert(Date.parse(a.calls.find(c=>c.op==='PREDICTIONS').at)<Date.parse(actionable));
 assert(h.run.checkpoint.finished);assert.equal(h.run.checkpoint.publication.publishes,false);
});

test('pre-cutoff DB commit with post-cutoff response preserves success and still sweeps prior outcomes',async t=>{
 const h=harness(t,{at:date+'T00:59:40.000Z',plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1,predictionAckMs:25000});
 await h.prepareAcquired();
 h.setDue([{prediction:priorState.locks.find(l=>l.horizon==='SHORT'),horizons:[1]}]);
 const a=await h.invoke();assert.equal(a.result.status,'COMPLETE');assert.equal(h.committed.size,216);
 assert(Date.parse(h.committedAt[0])<Date.parse(actionable));assert(Date.parse(h.clock())>=Date.parse(actionable));
 assert(h.checkpoints.some(c=>Date.parse(c.at)>=Date.parse(actionable)&&c.state.completed.includes('PREDICTION_LOCK')));
 assert.equal(a.calls.filter(c=>c.op==='OUTCOME').length,1);assert(a.calls.some(c=>c.op==='OUTCOME_CHECKED'));
 assert.equal(h.run.checkpoint.publication.publishes,false);
});

test('expired new Forward still sweeps matured prior predictions without assembling or inserting new predictions',async t=>{
 const h=harness(t,{at:date+'T01:10:00.000Z',plan:[fullPlan.find(t=>t.kind==='PRICE')],cursor:1});
 h.setDue([{prediction:priorState.locks.find(l=>l.horizon==='SHORT'),horizons:[1]}]);
 const a=await h.invoke();assert.equal(a.result.status,'EXPIRED');assert.equal(h.committed.size,0);
 assert(!a.calls.some(c=>['SOURCES','ENTRY_SOURCE','CHECKPOINT','PREDICTIONS','CURSOR'].includes(c.op)));
 const outcomes=a.calls.filter(c=>c.op==='OUTCOME');assert.equal(outcomes.length,1);
 assert.equal(outcomes[0].data.result.state,'UNKNOWN');assert.equal(outcomes[0].data.result.performance_eligible,false);
 assert.equal(outcomes[0].data.result.net_return,null);assert(a.calls.some(c=>c.op==='OUTCOME_CHECKED'));
 assert.equal(h.dueRemaining,0);
 assert.equal(h.http.length,2,'only independent prior-outcome PRICE/BENCHMARK requests');
});

test('completed prior sweep with unfinished cold history is QUEUED for bootstrap, not forced EXPIRED',async t=>{
 const h=harness(t,{at:date+'T01:10:00.000Z'});
 h.setDue([{prediction:priorState.locks.find(l=>l.horizon==='SHORT'),horizons:[1]}]);
 const a=await h.invoke();assert.equal(a.result.status,'QUEUED');
 assert.equal(a.result.reason,'COLD_BOOTSTRAP_NO_LATE_FORWARD');assert.equal(h.run.cursor,0);assert.equal(h.run.plan.length,20);
 assert.equal(h.dueRemaining,0);assert.equal(a.calls.filter(c=>c.op==='OUTCOME').length,1);
 assert(a.calls.some(c=>c.op==='OUTCOME_CHECKED'));assert.equal(h.http.length,2);
 assert.equal(h.committed.size,0);assert(!a.calls.some(c=>c.op==='PREDICTIONS'));
});
