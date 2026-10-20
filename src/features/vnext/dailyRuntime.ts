/** Production-like runner. Persistence is exclusively transactional RPC, never files. */
import {snapshotHash,hashValid,validTime} from './contracts.ts';
import {ADAPTER_VERSION,directoryPlan,classifyCompanies,acquisitionPlan,outcomePlan,fetchSource,assembleDaily,type SourceReceipt,type SourceTask} from './dailyAdapter.ts';
import {runDailyIntelligence,dailyPublication,verifyDailyLock,type DailyLock,type RunState,type DailyStore} from './dailyIntelligence.ts';
import {researchOutcome,type OutcomeSource} from './dailyOutcome.ts';
import {canonical} from '../../../research/entry-opportunity.ts';
import type {DailyBar} from './researchFunnel.ts';
import {entryInputFromV2} from '../../../research/entry-v2-adapter.ts';
import type {V2Input} from '../../../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
export type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type RuntimePorts={rpc:Rpc;fetcher:typeof fetch;clock:()=>string;sleep:(ms:number)=>Promise<void>};
type ClaimedRun={id:string;business_date:string;actionable_at:string;lease:string;lease_until?:string;fence:number;plan:SourceTask[];checkpoint:RunState|Record<string,never>;cursor:number};
export type LeaseRecoveryPending={status:'LEASE_RECOVERY_PENDING';continue:true;reason:'FINISH_COMMIT_UNCONFIRMED';lease_until:string;not_before:string};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const failure=(e:unknown)=>{const msg=e instanceof Error?e.message:'';return /^[A-Z0-9_]{1,100}$/.test(msg)?msg:'INTEGRATION_FAILED';};
// Scheduling reserves, not a changed actionable cutoff or evidence threshold.
// RPC/CPU latency is not guaranteed: recheck at each durable stage boundary and
// leave SQL's current-time veto authoritative for a delayed prediction insert.
const FORWARD_PREPARE_MS=180000,ASSEMBLY_ADMISSION_MS=45000,STAGE_RESERVE_MS=20000,WRITE_RESERVE_MS=5000;
export async function workDailyRun(id:string,p:RuntimePorts,budgetMs=70000){
 const claimStarted=Date.now();
 const claim=object(await p.rpc('claim_vnext_daily_research_v1',{p_run:id}));if(claim.status!=='ACQUIRED')return {status:String(claim.status),continue:false};
 const claimCompleted=Date.now(),r=claim.run as ClaimedRun,deadline=claimCompleted+Math.min(70000,budgetMs);let fetched=0,lastFetch=0,hasLock=false,retryAfter=3;
 // Only the SQL-issued 100s lease can authorize a delayed recovery attempt.
 // Keep lease/budget time on the wall clock; p.clock remains the evidence cutoff.
 const leaseUntil=typeof r.lease_until==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(r.lease_until)?Date.parse(r.lease_until):NaN;
 const recoverableLease=Number.isFinite(leaseUntil)&&leaseUntil>claimStarted&&leaseUntil<=claimCompleted+100000;
 const rpc=(op:string,data:unknown={})=>p.rpc('vnext_daily_runtime_v1',{p_run:r.id,p_lease:r.lease,p_fence:r.fence,p_op:op,p_data:data});
 const actionable=Date.parse(r.actionable_at);
 let cursor=r.cursor,planLength=r.plan.length,prepared='locks' in r.checkpoint,predictionFailure:string|null=null;
 const forwardBudget=(reserve=WRITE_RESERVE_MS)=>{
  if(!hasLock&&Date.parse(p.clock())>=actionable)throw Error('FORWARD_WINDOW_ELAPSED');
  if(Date.now()+reserve>=deadline)throw Error('FORWARD_PREPARATION_CONTINUATION');
 };
 const finish=async(status:string,reason:string|null=null)=>{
  try{await rpc('FINISH',{status,reason});}
  catch(error){
   if(!recoverableLease)throw error;
   // The commit may have succeeded before its response was lost. Do not retry
   // FINISH or claim that the requested terminal/queued state was committed.
   // Waiting a full lease after the claim response also covers a worker clock
   // ahead of the DB clock. A malformed/future lease still fails closed above.
   const recovery:LeaseRecoveryPending={status:'LEASE_RECOVERY_PENDING',continue:true,reason:'FINISH_COMMIT_UNCONFIRMED',
    lease_until:r.lease_until!,not_before:new Date(Math.max(leaseUntil+1000,claimCompleted+101000,Date.now()+Math.max(3,retryAfter)*1000)).toISOString()};
   return recovery;
  }
  return {status,continue:status==='QUEUED',reason,retry_after_seconds:retryAfter};
 };
 const commitLocks=async(rows:DailyLock[])=>{
  try{return await rpc('PREDICTIONS',rows.map(body=>{const {lock_hash,...rest}=body;return {body,canonical:canonical(rest),hash:lock_hash};}));}
  catch(e){predictionFailure=failure(e);throw e;}
 };
 const collect=async(task:SourceTask):Promise<SourceReceipt|null|false>=>{
  if(Date.now()+14000>=deadline||fetched>=8)return false;
  const reserved=object(await rpc('SOURCE_BEGIN',task));
  if(reserved.status==='CACHE')return reserved.receipt as SourceReceipt;
  if(reserved.status==='EXHAUSTED')return null;
  if(reserved.status==='WAIT_RETRY'){retryAfter=Math.min(300,Math.max(3,Math.ceil((Date.parse(String(reserved.retry_at))-Date.parse(p.clock()))/1000)));return false;}
  if(reserved.status!=='FETCH')throw Error('SOURCE_RESERVATION');
  try{
   await p.sleep(Math.max(0,2500-(Date.now()-lastFetch)));lastFetch=Date.now();fetched++;
   const receipt=await fetchSource(task,p.fetcher,p.clock,AbortSignal.timeout(Math.max(1,deadline-Date.now())));
   await rpc('SOURCE_SAVE',{text:canonical(receipt)});return receipt;
  }catch(e){
   const reason=failure(e);retryAfter=Math.min(300,Math.max(3,Number(object(e).retryAfter)||3));
   await rpc('SOURCE_FAIL',{key:task.key,reason,retry_seconds:retryAfter});
   // A denied official endpoint is not a transient rate limit. Preserve the
   // exact missing-source reason and advance; never retry/bypass its access
   // restriction or let hundreds of denied event tasks starve later evidence.
   // Transient failures keep the existing durable three-attempt backoff.
   return reason==='SOURCE_ACCESS_RESTRICTED'?null:false;
  }
 };
 try{
  // A legacy request binding without its original acquired bytes cannot be
  // repaired by choosing a new cutoff/revision or resetting durable attempts.
  if('key' in r.checkpoint&&!r.checkpoint.acquired)throw Error('CHECKPOINT_ACQUIRED_MISSING');
  if('locks' in r.checkpoint){
   if(r.checkpoint.locks?.length!==216||(await Promise.all(r.checkpoint.locks.map(verifyDailyLock))).some(ok=>!ok))throw Error('CHECKPOINT_LOCK_INVALID');
   // Checkpoint locks are PREPARED, not proof of a committed transaction.
   // Replay identical bytes before any acquisition/outcome/completion. SQL
   // fences the lease, permits exact committed retries even after the cutoff,
   // and rejects new late inserts without backdating a Forward prediction.
   await commitLocks(r.checkpoint.locks);hasLock=true;
  }
  const due=await rpc('DUE_OUTCOMES') as {prediction:DailyLock;horizons:number[]}[];
  const dirs:SourceReceipt[]=[];for(const t of await directoryPlan(r.business_date)){const receipt=await collect(t);if(!receipt)return finish(receipt===null?'BLOCKED':'QUEUED','UNIVERSE_DIRECTORY_UNAVAILABLE');dirs.push(receipt);}
  const companies=classifyCompanies(dirs),plan=r.plan.length?r.plan:await acquisitionPlan(r.business_date,companies);
  if(!r.plan.length)await rpc('PLAN',plan);
  planLength=plan.length;
  const retainedAcquired='acquired' in r.checkpoint?r.checkpoint.acquired:undefined;
  for(let i=r.cursor;i<plan.length&&due.length===0&&(!retainedAcquired||hasLock||Date.parse(p.clock())>=actionable);i++){
   // Lock a truthful partial-evidence evaluation before the existing 09:00
   // deadline. Long-history bootstrap may continue; never backdate its receipts.
   const current=Date.parse(p.clock());
   if(!hasLock&&current>=actionable-FORWARD_PREPARE_MS&&current<actionable)break;
   if(Date.now()+14000>=deadline||fetched>=8)return finish('QUEUED','ACQUISITION_CONTINUATION');
   const receipt=await collect(plan[i]);if(receipt===false)return finish('QUEUED','SOURCE_RETRY_PENDING');
   await rpc('CURSOR',{cursor:i+1});cursor=i+1;
  }
  if(!hasLock&&Date.parse(p.clock())<actionable){
  let acquired=retainedAcquired;
  if(!acquired){
  if(Date.now()+ASSEMBLY_ADMISSION_MS>=deadline)return finish('QUEUED','EVALUATION_CONTINUATION');
  const sources=await rpc('SOURCES') as SourceReceipt[];
  if(Date.now()+30000>=deadline)return finish('QUEUED','EVALUATION_CONTINUATION');
  forwardBudget();
  // Only actual same-cutoff retained market/Entry capsules may enrich this run.
  const evaluationCutoff=p.clock();
  const lineage=object(await rpc('ENTRY_SOURCE',{cutoff:evaluationCutoff}));const market=lineage.market??null;
  // Keep the original Canonical wait: early scheduling must not permanently
  // freeze a missing market that may become available before the last minute.
  if(!market&&Date.parse(p.clock())<actionable-60000){retryAfter=30;return finish('QUEUED','CANONICAL_PUBLICATION_PENDING');}
  acquired=await assembleDaily(r.business_date,companies,sources,evaluationCutoff,market as Parameters<typeof assembleDaily>[4]);
  if(!('acquired' in r.checkpoint)&&lineage.evidence&&typeof lineage.hash==='string'&&acquired.entry){
   const capsule=lineage.evidence as V2Input;
   if(capsule.identity.report_date!==r.business_date||Date.parse(capsule.identity.generated_at)>Date.parse(acquired.evidence_cutoff))throw Error('ENTRY_CUTOFF_MISMATCH');
   const entry=await entryInputFromV2(capsule,lineage.hash,market as Parameters<typeof entryInputFromV2>[2],'FORWARD','REAL_RETAINED');
   acquired.entry.market=entry.market;
   for(const stock of acquired.entry.stocks){const prior=entry.stocks.find(s=>s.symbol===stock.symbol);if(prior){stock.relative_strength=prior.relative_strength;stock.sector_return=prior.sector_return;stock.events_reviewed=prior.events_reviewed;stock.v2_status=prior.v2_status;}}
   const {snapshot_hash,...body}=acquired;void snapshot_hash;acquired.snapshot_hash=await snapshotHash(body);
  }
  }
  if(Date.parse(p.clock())<actionable){
   let state='key' in r.checkpoint?r.checkpoint as RunState:null;
   let savedAttempts={...state?.attempts};
   const store:DailyStore={exclusive:async(_key,work)=>work(),load:async()=>state,save:async s=>{
    const startingStage=Object.entries(s.attempts).some(([stage,n])=>stage!=='ACQUISITION'&&(n??0)>(savedAttempts[stage as keyof typeof savedAttempts]??0));
    forwardBudget(startingStage?STAGE_RESERVE_MS:WRITE_RESERVE_MS);
    // Pin the already assembled revision in the first attempt-before-work
    // checkpoint. This is a recoverable snapshot, NOT validation/quality PASS:
    // the unchanged engine still validates it before completing ACQUISITION.
    const checkpoint={...s,acquired:s.acquired??acquired};
    await rpc('CHECKPOINT',checkpoint);state=checkpoint;savedAttempts={...s.attempts};prepared||=!!s.locks;
   },lock:async rows=>{forwardBudget();await commitLocks(rows);hasLock=true;}};
   const result=await runDailyIntelligence({business_date:r.business_date,checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',
    core_ready:true,core_busy:false,source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:r.actionable_at},store,{
    acquire:async()=>acquired,clock:p.clock,outcomes:async()=>({state:'DURABLE_OUTCOME_QUEUE'}),
    publication:locks=>dailyPublication(locks,(_,hash)=>({now:p.clock(),audience:'owner',server_entitlement_verified:true,input_hash:hash,approved_hash:null,approved_at:null,quality_reviewed:false,methodology_approved:false,use:'OWN_ANALYSIS',grants:[]}))});
   if(!['COMPLETE','ALREADY_COMPLETE'].includes(result.state)){
    if(predictionFailure)throw Error(predictionFailure);
    if(result.state==='BUDGET_YIELDED')return finish('QUEUED','FORWARD_PREPARATION_CONTINUATION');
    return finish('BLOCKED',('checkpoint' in result?result.checkpoint.failure?.reason:null)??result.state);
   }
   hasLock=true;
  }
  }
  // Sweep PRIOR locked predictions, not just the freshly created run. This is
  // independently repeatable across subsequent natural checkpoints/dates.
  const outcomeReceipts:SourceReceipt[]=[];
  const outcomeTasks=await outcomePlan(r.business_date,due,companies,p.clock());
  // A long-horizon window can have hundreds of already durable receipts. One
  // SOURCE_BEGIN RPC per cached prefix exhausted every invocation at the same
  // position, so even a fully acquired window never reached its Outcome. Read
  // this run's immutable revisions once; only missing tasks spend a reservation
  // or provider call. Match the complete plan, including PREMARKET/CLOSE scope.
  const wanted=new Set(outcomeTasks.map(t=>t.key)),retained=new Map<string,SourceReceipt>();
  // Small windows already fit the existing eight-source bound; do not load the
  // full source inventory when at most eight targeted reservations suffice.
  if(outcomeTasks.length>8){
   for(const receipt of await rpc('SOURCES') as SourceReceipt[]){
    if(!wanted.has(receipt.task.key))continue;
    if(retained.has(receipt.task.key))throw Error('OUTCOME_RECEIPT_DUPLICATE');
    retained.set(receipt.task.key,receipt);
   }
  }
  for(const task of outcomeTasks){
   if(Date.now()+5000>=deadline)return finish('QUEUED','OUTCOME_SOURCE_CONTINUATION');
   const receipt=retained.get(task.key)??await collect(task);if(receipt===false)return finish('QUEUED','OUTCOME_SOURCE_CONTINUATION');
   if(receipt&&(receipt.version!==ADAPTER_VERSION||receipt.status!=='OK'||canonical(receipt.task)!==canonical(task)
    ||!validTime(receipt.available_at)||!validTime(receipt.first_seen_at)||Date.parse(receipt.first_seen_at)>Date.parse(receipt.available_at)
    ||Date.parse(receipt.available_at)>Date.parse(p.clock())||!hashValid(receipt.raw_hash)||!hashValid(receipt.payload_hash)
    ||receipt.payload_hash!==await snapshotHash(receipt.payload)))throw Error('OUTCOME_RECEIPT_INVALID');
   if(receipt)outcomeReceipts.push(receipt);
  }
  const rows=(kind:string)=>outcomeReceipts.filter(s=>s.task.kind===kind&&s.status==='OK').flatMap(s=>s.payload.rows as Record<string,unknown>[]??[]);
  for(const pending of due){
   const lock=pending.prediction;
   if(Date.now()+5000>=deadline)return finish('QUEUED','OUTCOME_CONTINUATION');
   const source:OutcomeSource={symbol:lock.symbol,observed_at:p.clock(),bars:[...rows('PRICE'),...rows('OTC_PRICE')].filter(b=>b.symbol===lock.symbol) as DailyBar[],benchmark:rows('BENCHMARK') as DailyBar[],
    actions:null,invalidation:null}; // Inventory alone does not prove adjustment completeness or trigger execution.
   for(const horizon of pending.horizons){const result=await researchOutcome(lock,horizon,source);await rpc('OUTCOME',{result,id:await snapshotHash({prediction:lock.lock_hash,horizon,source:result.outcome_source_hash})});}
   await rpc('OUTCOME_CHECKED',{id:lock.id});
  }
  if((await rpc('DUE_OUTCOMES') as unknown[]).length)return finish('QUEUED','OUTCOME_CONTINUATION');
  if(cursor<plan.length)return finish('QUEUED',hasLock?'COLD_BOOTSTRAP_WITH_IMMUTABLE_LOCK':'COLD_BOOTSTRAP_NO_LATE_FORWARD');
  return finish(hasLock?'COMPLETE':'EXPIRED',hasLock?null:'LATE_ACQUISITION_NOT_FORWARD');
 }catch(e){
  const reason=predictionFailure??failure(e);
  if(reason==='FORWARD_PREPARATION_CONTINUATION')return finish('QUEUED',reason);
  if(reason==='FORWARD_WINDOW_ELAPSED')return finish(cursor<planLength?'QUEUED':'EXPIRED',cursor<planLength?'COLD_BOOTSTRAP_NO_LATE_FORWARD':'LATE_ACQUISITION_NOT_FORWARD');
  // Only an explicit SQL time rejection of a missing prepared commit is expiry;
  // transport errors, corrupt checkpoints and other denials stay BLOCKED.
  return finish(reason==='FORWARD_TIME_INVALID'&&prepared&&Date.parse(p.clock())>=actionable?'EXPIRED':'BLOCKED',reason);
 }
}
