/** Production-like runner. Persistence is exclusively transactional RPC, never files. */
import {snapshotHash} from './contracts.ts';
import {directoryPlan,classifyCompanies,acquisitionPlan,fetchSource,assembleDaily,type SourceReceipt,type SourceTask} from './dailyAdapter.ts';
import {runDailyIntelligence,dailyPublication,type DailyLock,type RunState,type DailyStore} from './dailyIntelligence.ts';
import {researchOutcome,type OutcomeSource} from './dailyOutcome.ts';
import {canonical} from '../../../research/entry-opportunity.ts';
import type {DailyBar} from './researchFunnel.ts';
import {entryInputFromV2} from '../../../research/entry-v2-adapter.ts';
import type {V2Input} from '../../../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
export type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type RuntimePorts={rpc:Rpc;fetcher:typeof fetch;clock:()=>string;sleep:(ms:number)=>Promise<void>};
type ClaimedRun={id:string;business_date:string;actionable_at:string;lease:string;fence:number;plan:SourceTask[];checkpoint:RunState|Record<string,never>;cursor:number};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const failure=(e:unknown)=>{const msg=e instanceof Error?e.message:'';return /^[A-Z0-9_]{1,100}$/.test(msg)?msg:'INTEGRATION_FAILED';};
export async function workDailyRun(id:string,p:RuntimePorts,budgetMs=70000){
 const claim=object(await p.rpc('claim_vnext_daily_research_v1',{p_run:id}));if(claim.status!=='ACQUIRED')return {status:String(claim.status),continue:false};
 const r=claim.run as ClaimedRun,deadline=Date.now()+Math.min(70000,budgetMs);let fetched=0,lastFetch=0,hasLock='locks' in r.checkpoint,retryAfter=3;
 const rpc=(op:string,data:unknown={})=>p.rpc('vnext_daily_runtime_v1',{p_run:r.id,p_lease:r.lease,p_fence:r.fence,p_op:op,p_data:data});
 const finish=async(status:string,reason:string|null=null)=>{await rpc('FINISH',{status,reason});return {status,continue:status==='QUEUED',reason,retry_after_seconds:retryAfter};};
 const collect=async(task:SourceTask):Promise<SourceReceipt|null|false>=>{
  if(Date.now()+14000>=deadline)return false;
  const reserved=object(await rpc('SOURCE_BEGIN',task));
  if(reserved.status==='CACHE')return reserved.receipt as SourceReceipt;
  if(reserved.status==='EXHAUSTED')return null;
  if(reserved.status==='WAIT_RETRY'){retryAfter=Math.min(300,Math.max(3,Math.ceil((Date.parse(String(reserved.retry_at))-Date.parse(p.clock()))/1000)));return false;}
  if(reserved.status!=='FETCH')throw Error('SOURCE_RESERVATION');
  try{
   await p.sleep(Math.max(0,2500-(Date.now()-lastFetch)));lastFetch=Date.now();fetched++;
   const receipt=await fetchSource(task,p.fetcher,p.clock,AbortSignal.timeout(Math.max(1,deadline-Date.now())));
   await rpc('SOURCE_SAVE',{text:canonical(receipt)});return receipt;
  }catch(e){retryAfter=Math.min(300,Math.max(3,Number(object(e).retryAfter)||3));await rpc('SOURCE_FAIL',{key:task.key,reason:failure(e),retry_seconds:retryAfter});return false;}
 };
 try{
  const dirs:SourceReceipt[]=[];for(const t of await directoryPlan(r.business_date)){const receipt=await collect(t);if(!receipt)return finish(receipt===null?'BLOCKED':'QUEUED','UNIVERSE_DIRECTORY_UNAVAILABLE');dirs.push(receipt);}
  const companies=classifyCompanies(dirs),plan=r.plan.length?r.plan:await acquisitionPlan(r.business_date,companies);
  if(!r.plan.length)await rpc('PLAN',plan);
  for(let i=r.cursor;i<plan.length;i++){
   if(Date.now()+14000>=deadline||fetched>=8)return finish('QUEUED','ACQUISITION_CONTINUATION');
   const receipt=await collect(plan[i]);if(receipt===false)return finish('QUEUED','SOURCE_RETRY_PENDING');
   await rpc('CURSOR',{cursor:i+1});
  }
  const sources=await rpc('SOURCES') as SourceReceipt[];
  if(Date.now()+30000>=deadline)return finish('QUEUED','EVALUATION_CONTINUATION');
  // Only actual same-cutoff retained market/Entry capsules may enrich this run.
  const lineage=object(await rpc('ENTRY_SOURCE'));const market=lineage.market??null;
  const acquired='acquired' in r.checkpoint&&r.checkpoint.acquired?r.checkpoint.acquired:await assembleDaily(r.business_date,companies,sources,p.clock(),market as Parameters<typeof assembleDaily>[4]);
  if(!('acquired' in r.checkpoint)&&lineage.evidence&&typeof lineage.hash==='string'&&acquired.entry){
   const capsule=lineage.evidence as V2Input;
   if(capsule.identity.report_date!==r.business_date||Date.parse(capsule.identity.generated_at)>Date.parse(acquired.evidence_cutoff))throw Error('ENTRY_CUTOFF_MISMATCH');
   const entry=await entryInputFromV2(capsule,lineage.hash,market as Parameters<typeof entryInputFromV2>[2],'FORWARD','REAL_RETAINED');
   acquired.entry.market=entry.market;
   for(const stock of acquired.entry.stocks){const prior=entry.stocks.find(s=>s.symbol===stock.symbol);if(prior){stock.relative_strength=prior.relative_strength;stock.sector_return=prior.sector_return;stock.events_reviewed=prior.events_reviewed;stock.v2_status=prior.v2_status;}}
   const {snapshot_hash,...body}=acquired;void snapshot_hash;acquired.snapshot_hash=await snapshotHash(body);
  }
  if(Date.parse(p.clock())<Date.parse(r.actionable_at)){
   let state='key' in r.checkpoint?r.checkpoint as RunState:null;
   const store:DailyStore={exclusive:async(_key,work)=>work(),load:async()=>state,save:async s=>{await rpc('CHECKPOINT',s);state=s;},
    lock:async rows=>{await rpc('PREDICTIONS',rows.map(body=>{const {lock_hash,...rest}=body;return {body,canonical:canonical(rest),hash:lock_hash};}));}};
   const result=await runDailyIntelligence({business_date:r.business_date,checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',
    core_ready:true,core_busy:false,source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:r.actionable_at},store,{
    acquire:async()=>acquired,clock:p.clock,outcomes:async()=>({state:'DURABLE_OUTCOME_QUEUE'}),
    publication:locks=>dailyPublication(locks,(_,hash)=>({now:p.clock(),audience:'owner',server_entitlement_verified:true,input_hash:hash,approved_hash:null,approved_at:null,quality_reviewed:false,methodology_approved:false,use:'OWN_ANALYSIS',grants:[]}))});
   if(!['COMPLETE','ALREADY_COMPLETE'].includes(result.state))return finish('BLOCKED',('checkpoint' in result?result.checkpoint.failure?.reason:null)??result.state);
   hasLock=true;
  }
  // Sweep PRIOR locked predictions, not just the freshly created run. This is
  // independently repeatable across subsequent natural checkpoints/dates.
  const due=await rpc('DUE_OUTCOMES') as {prediction:DailyLock;horizons:number[]}[];
  const rows=(kind:string)=>sources.filter(s=>s.task.kind===kind&&s.status==='OK').flatMap(s=>s.payload.rows as Record<string,unknown>[]??[]);
  for(const pending of due){
   const lock=pending.prediction;
   if(Date.now()+5000>=deadline)return finish('QUEUED','OUTCOME_CONTINUATION');
   const source:OutcomeSource={symbol:lock.symbol,observed_at:p.clock(),bars:[...rows('PRICE'),...rows('OTC_PRICE')].filter(b=>b.symbol===lock.symbol) as DailyBar[],benchmark:rows('BENCHMARK') as DailyBar[],
    actions:null,invalidation:null}; // Inventory alone does not prove adjustment completeness or trigger execution.
   for(const horizon of pending.horizons){const result=await researchOutcome(lock,horizon,source);await rpc('OUTCOME',{result,id:await snapshotHash({prediction:lock.lock_hash,horizon,source:result.outcome_source_hash})});}
   await rpc('OUTCOME_CHECKED',{id:lock.id});
  }
  if((await rpc('DUE_OUTCOMES') as unknown[]).length)return finish('QUEUED','OUTCOME_CONTINUATION');
  return finish(hasLock?'COMPLETE':'EXPIRED',hasLock?null:'LATE_ACQUISITION_NOT_FORWARD');
 }catch(e){return finish('BLOCKED',failure(e));}
}
