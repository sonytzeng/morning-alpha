// Isolated protocol controls, not Production CPU, Auth, natural Forward or performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {directoryPlan,acquisitionPlan,assembleDaily} from '../src/features/vnext/dailyAdapter.ts';
import {handleVnextDaily} from '../supabase/functions/vnext-daily-research-v1/handler.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {DAILY_INTELLIGENCE_VERSION} from '../src/features/vnext/dailyIntelligence.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const date='2026-10-22',cutoff=date+'T00:58:00.000Z',actionable=date+'T01:00:00.000Z';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'SYNTHETIC handoff control '+symbol,exchange:'TWSE',industry:'24'}));
const market={value:{direction:'NEUTRAL',regime:'SYNTHETIC'},source_ref:'isolated-canonical',observed_at:cutoff,available_at:cutoff};
const directories=await directoryPlan(date);
const receipts=await Promise.all(directories.map(async task=>{
 const payload={rows:task.exchange==='TWSE'?companies:[]};
 return {task,payload,payload_hash:await snapshotHash(payload),raw_hash:await snapshotHash(payload),version:'VNEXT_DAILY_OFFICIAL_1',status:'OK',
  first_seen_at:cutoff,available_at:cutoff,published_at:null,as_of:cutoff,reason:null};
}));
const blockedTask=(await acquisitionPlan(date,companies))[0];
function harness({saved={},at=cutoff,checkpointLoss=false,providerStatus=null}={}){
 let clock=at,lost=false;const calls=[],committed=[],writes=[];
 const localReceipts=providerStatus?receipts.map(r=>({...r,first_seen_at:at,available_at:at,as_of:at})):receipts;
 const run={id:'isolated-handoff-run',business_date:date,actionable_at:actionable,lease:'isolated',fence:0,plan:providerStatus?[blockedTask]:[{key:'completed-control'}],cursor:providerStatus?0:1,checkpoint:structuredClone(saved)};
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1'){run.fence++;return {status:'ACQUIRED',run:structuredClone(run)};}
  const op=args.p_op,data=args.p_data;calls.push(op);
  if(op==='DUE_OUTCOMES')return [];
  if(op==='SOURCE_BEGIN')return providerStatus&&data.key===blockedTask.key?{status:'FETCH'}:{status:'CACHE',receipt:localReceipts.find(r=>r.task.key===data.key)};
  if(op==='SOURCE_FAIL')return {status:'RECORDED'};
  if(op==='CURSOR'){run.cursor=data.cursor;return {status:'STORED'};}
  if(op==='SOURCES')return localReceipts;
  if(op==='ENTRY_SOURCE')return {market:providerStatus?{...market,observed_at:clock,available_at:clock}:market};
  if(op==='CHECKPOINT'){
   if(run.source_revision)assert.equal(data.acquired?.snapshot_hash,run.source_revision,'SQL immutable revision control');
   run.checkpoint=structuredClone(data);run.source_revision=data.acquired?.snapshot_hash??null;writes.push(structuredClone(data));
   if(checkpointLoss&&!lost){lost=true;throw Error('DATABASE_REPLY_LOST');}return {status:'STORED'};
  }
  if(op==='PREDICTIONS'){
   assert(Date.parse(clock)<Date.parse(actionable));assert.equal(data.length,216);
   assert.deepEqual(data.map(x=>x.body),run.checkpoint.locks);committed.push(...structuredClone(data));return {};
  }
  if(op==='FINISH'){run.state=data.status;run.reason=data.reason;return {};}
  throw Error('UNEXPECTED_ISOLATED_OPERATION_'+op);
 };
 const ports={rpc,clock:()=>clock,sleep:async()=>{},fetcher:async()=>{if(providerStatus)return new Response('SYNTHETIC fixed rejection',{status:providerStatus,headers:{'Retry-After':'60'}});throw Error('UNEXPECTED_PROVIDER');}};
 return {run,calls,committed,writes,ports,advance:at=>{clock=at;},invoke:(fn=workDailyRun)=>fn(run.id,ports)};
}

test('post-pin handler continuation does not inherit a skipped403 source backoff',async()=>{
 const h=harness({at:date+'T00:55:00.000Z',providerStatus:403});
 h.run.id='11111111-1111-4111-8111-111111111111';
 const background=[],waits=[],continued=[],secret='SYNTHETIC-isolated-credential-only';
 const response=await handleVnextDaily(new Request('https://isolated.invalid/worker',{method:'POST',headers:{'x-vnext-internal':secret},body:JSON.stringify({run_id:h.run.id})}),
  {...h.ports,cronSecret:secret,background:p=>background.push(p),sleep:async ms=>{waits.push(ms);},continueRun:async id=>{continued.push(id);}});
 assert.equal(response.status,202);await Promise.all(background);
 assert.equal(h.run.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(h.run.cursor,1);
 assert(h.calls.includes('SOURCE_FAIL'));assert.equal(h.writes.length,1);
 assert.deepEqual(Object.keys(h.run.checkpoint),['acquired']);
 assert.deepEqual(waits,[0,3000]);assert.deepEqual(continued,[h.run.id]);assert.equal(h.committed.length,0);
});

test('real pending429 provider retry remains60seconds and never reaches the acquired pin',async()=>{
 const h=harness({at:date+'T00:55:00.000Z',providerStatus:429}),result=await h.invoke();
 assert.equal(result.status,'QUEUED');assert.equal(result.reason,'SOURCE_RETRY_PENDING');assert.equal(result.retry_after_seconds,60);
 assert.equal(h.run.cursor,0);assert.equal(h.writes.length,0);assert.equal(h.committed.length,0);
});

test('assembly ends at an unvalidated immutable pin, not in the next CPU-heavy stage',async()=>{
 const h=harness(),first=await h.invoke();
 assert.equal(first.status,'QUEUED');assert.equal(first.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert(first.continue);
 assert.equal(h.writes.length,1);assert.deepEqual(Object.keys(h.run.checkpoint),['acquired']);
 assert.equal(h.run.checkpoint.acquired.inputs.length,72);assert.equal(h.committed.length,0);
 assert(!h.run.checkpoint.key&&!h.run.checkpoint.attempts&&!h.run.checkpoint.completed&&!h.run.checkpoint.locks);
 assert.equal(h.calls.filter(x=>x==='SOURCES').length,1);assert.equal(h.calls.at(-1),'FINISH');
});

test('next existing lifecycle validates the exact pinned bytes and completes without refetch/reassembly',async()=>{
 const h=harness();await h.invoke();const first=structuredClone(h.run.checkpoint.acquired),start=h.calls.length;
 h.advance(date+'T00:58:03.000Z');const second=await h.invoke();
 assert.equal(second.status,'COMPLETE');assert.equal(h.committed.length,216);
 assert(!h.calls.slice(start).includes('SOURCES')&&!h.calls.slice(start).includes('ENTRY_SOURCE'));
 assert.deepEqual(h.run.checkpoint.acquired,first);assert.equal(h.run.checkpoint.attempts.ACQUISITION,1);
 assert(h.committed.every(r=>r.body.evidence_cutoff===cutoff&&r.body.locked_at===date+'T00:58:03.000Z'));
});

test('new scope still rejects the pinned body if it changed; the pin is not quality approval',async()=>{
 const h=harness();await h.invoke();h.run.checkpoint.acquired.inputs[0].company+=' changed';
 const result=await h.invoke();assert.equal(result.status,'BLOCKED');assert.equal(result.reason,'ACQUISITION_HASH_MISMATCH');
 assert.equal(h.committed.length,0);assert.equal(h.run.checkpoint.completed.length,0);
});

test('crossing cutoff after assembly never backdates a new Forward or reacquires evidence',async()=>{
 const h=harness();await h.invoke();const revision=h.run.source_revision,start=h.calls.length;
 h.advance(actionable);const result=await h.invoke();
 assert.equal(result.status,'EXPIRED');assert.equal(result.reason,'LATE_ACQUISITION_NOT_FORWARD');
 assert.equal(h.committed.length,0);assert.equal(h.run.source_revision,revision);
 assert(!h.calls.slice(start).includes('SOURCES')&&!h.calls.slice(start).includes('CHECKPOINT'));
});

test('a lost initial CHECKPOINT reply does not retry the uncertain write or run evaluation inline',async()=>{
 const h=harness({checkpointLoss:true}),result=await h.invoke();
 assert.equal(result.status,'BLOCKED');assert.equal(result.reason,'DATABASE_REPLY_LOST');
 assert.equal(h.calls.filter(x=>x==='CHECKPOINT').length,1);assert.equal(h.committed.length,0);
 assert.deepEqual(Object.keys(h.run.checkpoint),['acquired']);
});

test('legacy request-bound attempt survives without a second assembly or attempt reset',async()=>{
 const acquired=await assembleDaily(date,companies,receipts,cutoff,market);
 const request={business_date:date,checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',
  core_ready:true,core_busy:false,source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:actionable};
 const key=await snapshotHash({version:DAILY_INTELLIGENCE_VERSION,date,checkpoint:request.checkpoint,mode:request.mode,provenance:request.provenance});
 const h=harness({saved:{key,request_hash:await snapshotHash(request),attempts:{ACQUISITION:1},completed:[],finished:false,acquired}});
 const result=await h.invoke();assert.equal(result.status,'COMPLETE');assert.equal(h.run.checkpoint.attempts.ACQUISITION,2);
 assert.equal(h.committed.length,216);assert(!h.calls.includes('SOURCES'));
});

test('real baseline counterfactual reaches evaluation inline; the patch introduces only the durable CPU boundary',async()=>{
 const source=execFileSync('git',['--no-replace-objects','show','c50b09ba7c122dc0d2e32082e85764cf3250b806:src/features/vnext/dailyRuntime.ts'],{cwd:root,encoding:'utf8'});
 const local=source.replace(/from '([^']+)'/g,(all,specifier)=>specifier.startsWith('.')?
  'from '+JSON.stringify(pathToFileURL(path.resolve(root,'src/features/vnext',specifier)).href):all);
 const {workDailyRun:before}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(local)).toString('base64'));
 const h=harness(),result=await h.invoke(before);
 assert.equal(result.status,'COMPLETE');assert.equal(h.committed.length,216);
 assert(h.writes[0].attempts.ACQUISITION===1,'baseline continues engine work after the first durable pin');
 assert.equal(h.writes[0].acquired.inputs.length,72);
 assert.equal(createHash('sha256').update(source).digest('hex').length,64);
});
