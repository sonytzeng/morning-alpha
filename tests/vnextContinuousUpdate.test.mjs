// SYNTHETIC, ISOLATED PROTOCOL CONTROLS ONLY: not Production observations,
// official-source acquisition, publication approval, investment returns or efficacy.
// No Provider, SQL, credentials, filesystem store, Runtime/CLE or TTL changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionPlan,assembleDaily,sessionsBefore} from '../src/features/vnext/dailyAdapter.ts';
import {runDailyIntelligence,verifyDailyLock,dailySummary,dailyPublication} from '../src/features/vnext/dailyIntelligence.ts';
import {snapshotHash,HORIZONS} from '../src/features/vnext/contracts.ts';
import {evaluateResearch,publicationEligibility,RESEARCH_FUNNEL_VERSION} from '../src/features/vnext/researchFunnel.ts';
import {parseMemberResearch} from '../src/features/vnext/member.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const DAYS=['2026-10-20','2026-10-21'];
const SOURCE='https://synthetic.invalid/not-acquired/revenue-control';
const companies=RECOMMENDATION_UNIVERSE.map((symbol,i)=>({symbol,company:'SYNTHETIC control '+symbol,exchange:i<3?'TPEX':'TWSE',industry:'24'}));
const cutoff=date=>date+'T07:00:00+08:00';
const seen=date=>date+'T06:30:00+08:00';

// Sequential in-memory implementation of the existing DailyStore interface;
// deliberately not a replacement runtime, concurrency or persistence test.
function memoryStore(){
 const states=new Map(),locks=new Map();
 return {states,locks,exclusive:async(_key,work)=>work(),
  load:async key=>structuredClone(states.get(key)??null),
  save:async state=>{states.set(state.key,structuredClone(state));},
  lock:async rows=>{for(const row of rows){
   if(locks.has(row.id))assert.deepEqual(locks.get(row.id),row,'a locked prediction cannot be overwritten');
   else locks.set(row.id,structuredClone(row));
  }},
 };
}
async function revenueReceipt(date,yoy,available=seen(date)){
 // These are authored fixture rows, not normalizeSource/fetchSource output.
 const body={kind:'REVENUE',url:SOURCE,format:'json',scope:'SYNTHETIC_CONTROL:'+date,
  symbols:companies.map(c=>c.symbol),period:'2026-09',max_age_days:1};
 const task={...body,key:await snapshotHash(body)};
 const rows=await Promise.all(companies.map(async c=>{
  const values={yoy_percent:yoy,mom_percent:2};
  return {id:'synthetic-revenue-'+c.symbol,symbol:c.symbol,kind:'REVENUE',period:'2026-09',basis:'MONTHLY',values,
   source:SOURCE,published_at:null,first_seen_at:available,available_at:available,as_of:'2026-09-30T13:30:00+08:00',
   evidence_hash:await snapshotHash({symbol:c.symbol,values})};
 }));
 const payload={rows};
 return {task,first_seen_at:available,available_at:available,published_at:null,as_of:available,
  version:'SYNTHETIC_CONTROL_NOT_OFFICIAL_ACQUISITION',raw_hash:await snapshotHash(rows),
  payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};
}
async function syntheticAcquired(date,receipts){
 const assembled=await assembleDaily(date,companies,receipts,cutoff(date));
 // The official adapter labels its normal entry REAL_RETAINED. Relabel only
 // this authored test input and rehash it; never pass it off as retained data.
 const {snapshot_hash,...body}=assembled;
 body.entry={...body.entry,provenance:'SYNTHETIC_TEST'};
 return {...body,snapshot_hash:await snapshotHash(body)};
}
function execution(date,acquired,store,now=cutoff(date)){
 const calls={acquire:0};
 const request={business_date:date,checkpoint:'MARKET_READY',mode:'FORWARD_SHADOW',provenance:'SYNTHETIC_CONTROL',
  core_ready:true,core_busy:false,source_revision:acquired.entry.source_revision,source_hash:acquired.snapshot_hash,
  actionable_at:date+'T09:00:00+08:00'};
 const ports={clock:()=>now,acquire:async()=>{calls.acquire++;return acquired;},
  outcomes:async()=>({state:'NOT_MATURED',performance_eligible:false}),
  publication:rows=>dailyPublication(rows,(_row,hash)=>({now,audience:'owner',server_entitlement_verified:true,
   input_hash:hash,approved_hash:null,approved_at:null,quality_reviewed:false,methodology_approved:false,use:'OWN_ANALYSIS',grants:[]}))};
 return {calls,request,ports,run:()=>runDailyIntelligence(request,store,ports)};
}

test('synthetic next-day receipt and revenue correction append 72x3 locks, never replace an old checkpoint',async()=>{
 const [firstPlan,nextPlan]=await Promise.all(DAYS.map(date=>acquisitionPlan(date,companies)));
 const find=(plan,period)=>plan.find(t=>t.kind==='REVENUE'&&t.exchange==='TWSE'&&t.period===period);
 // Planning only: no URL below is requested and no official receipt is claimed.
 assert.notEqual(find(firstPlan,'2026-09').key,find(nextPlan,'2026-09').key);
 assert.equal(find(firstPlan,'2026-07').key,find(nextPlan,'2026-07').key);
 assert.equal(find(firstPlan,'2026-09').max_age_days,1);
 assert.equal(find(nextPlan,'2026-07').max_age_days,7); // preserve the existing strategy
 const receipt=await revenueReceipt(DAYS[0],10),corrected=await revenueReceipt(DAYS[0],25),nextReceipt=await revenueReceipt(DAYS[1],25);
 assert.notEqual(receipt.task.key,nextReceipt.task.key);
 assert.notEqual(receipt.payload_hash,corrected.payload_hash);
 const first=await syntheticAcquired(DAYS[0],[receipt]),revision=await syntheticAcquired(DAYS[0],[corrected]);
 assert.equal(first.entry.stocks[0].fundamental.value.revenue_yoy,10);
 assert.equal(revision.entry.stocks[0].fundamental.value.revenue_yoy,25);
 assert.notEqual(first.entry.source_revision,revision.entry.source_revision);
 assert.notEqual(first.snapshot_hash,revision.snapshot_hash);
 const store=memoryStore(),original=execution(DAYS[0],first,store),a=await original.run();
 assert.equal(a.state,'COMPLETE');assert.equal(a.checkpoint.locks.length,72*3);
 const oldLocks=structuredClone([...store.locks]),oldCheckpoint=structuredClone(store.states.get(a.key));
 const changed=execution(DAYS[0],revision,store);
 await assert.rejects(changed.run,/IDEMPOTENCY_SCOPE_CONFLICT/);
 assert.equal(changed.calls.acquire,0);
 assert.equal((await original.run()).state,'ALREADY_COMPLETE');assert.equal(original.calls.acquire,1);
 assert.deepEqual(store.states.get(a.key),oldCheckpoint);
 const next=await syntheticAcquired(DAYS[1],[nextReceipt]),b=await execution(DAYS[1],next,store).run();
 assert.equal(b.state,'COMPLETE');assert.equal(b.checkpoint.locks.length,72*3);
 assert.notEqual(a.key,b.key);assert.notEqual(first.entry.source_revision,next.entry.source_revision);
 assert.equal(store.states.size,2);assert.equal(store.locks.size,72*3*2);
 const nextLocks=new Map(b.checkpoint.locks.map(row=>[row.symbol+':'+row.horizon,row]));
 for(const old of a.checkpoint.locks){
  const fresh=nextLocks.get(old.symbol+':'+old.horizon);
  assert.notEqual(old.id,fresh.id);assert.notEqual(old.lock_hash,fresh.lock_hash);assert.notEqual(old.evidence_hash,fresh.evidence_hash);
  assert.equal(old.provenance,'SYNTHETIC_CONTROL');assert.equal(fresh.business_date,DAYS[1]);
  assert(await verifyDailyLock(old));assert(await verifyDailyLock(fresh));
 }
 assert.deepEqual([...store.locks].slice(0,72*3),oldLocks);
 assert.deepEqual(store.states.get(a.key),oldCheckpoint);
});

test('synthetic late correction is refused at the old cutoff and cannot backfill a locked day',async()=>{
 const store=memoryStore(),first=await syntheticAcquired(DAYS[0],[await revenueReceipt(DAYS[0],10)]);
 const completed=await execution(DAYS[0],first,store).run(),before=structuredClone([...store.locks]);
 const late=await revenueReceipt(DAYS[0],25,seen(DAYS[1]));
 await assert.rejects(()=>assembleDaily(DAYS[0],companies,[late],cutoff(DAYS[0])),/SOURCE_REVISION_INVALID/);
 const later=await syntheticAcquired(DAYS[1],[late]);
 assert.equal(later.entry.stocks[0].fundamental.value.revenue_yoy,25);
 assert.equal(later.inputs[0].facts[0].available_at,seen(DAYS[1]));
 await assert.rejects(execution(DAYS[0],first,store,DAYS[0]+'T09:01:00+08:00').run,/FORWARD_WINDOW_EXPIRED/);
 assert.equal(completed.state,'COMPLETE');assert.deepEqual([...store.locks],before);
});

test('daily reanalysis without evidence stays insufficient for all 72x3, never invents zero-valued observations',async()=>{
 const store=memoryStore(),keys=[];
 for(const date of DAYS){
  const acquired=await syntheticAcquired(date,[]),run=execution(date,acquired,store),result=await run.run();keys.push(result.key);
  assert.equal(result.state,'COMPLETE');assert.equal(run.calls.acquire,1);
  assert.equal(result.checkpoint.locks.length,72*3);
  assert(acquired.inputs.every(i=>i.bars.length===0&&i.facts.length===0));
  assert.equal(acquired.entry.market,null);
  assert(acquired.entry.stocks.every(s=>s.fundamental===null&&s.relative_strength===null&&s.sector_return===null&&s.events_reviewed===null));
  for(const lock of result.checkpoint.locks){
   assert.equal(lock.research.state,'INSUFFICIENT');assert.equal(lock.research.evaluated,false);
   assert(lock.research.reasons.length>0);assert.deepEqual(lock.research.metrics,{});
   for(const entry of lock.entry){assert.equal(entry.status,'INSUFFICIENT_EVIDENCE');assert.equal(entry.evidence_confidence.probability,null);assert.equal(entry.evidence_confidence.calibration,'INSUFFICIENT_SAMPLE');assert.equal(entry.plan,null);assert.deepEqual(entry.metrics,{});}
  }
  assert.equal(result.checkpoint.entry.analysis_value,'INSUFFICIENT_SAMPLE');
  const summary=dailySummary(result.checkpoint.locks);
  for(const horizon of Object.keys(HORIZONS))assert.deepEqual(summary.horizons[horizon],{scanned:72,qualified:0,rejected:0,insufficient:72});
  assert.equal(summary.forward_sample,0);assert.equal(summary.outcome_sample,0);assert.equal(result.checkpoint.publication.eligible,0);
 }
 assert.notEqual(keys[0],keys[1]);assert.equal(store.locks.size,432);
});

test('synthetic previously eligible publication expires and yesterday member payload cannot become latest',async()=>{
 const dates=sessionsBefore(DAYS[0]).slice(-20),available=seen(DAYS[0]);
 const bars=await Promise.all(dates.map(async(date,i)=>({id:'synthetic-bar-'+date,date,source:SOURCE,
  evidence_hash:await snapshotHash({date,i}),published_at:date+'T13:30:00+08:00',first_seen_at:available,available_at:available,
  as_of:date+'T13:30:00+08:00',open:100,high:105,low:99,close:i===19?104:100,volume:10000,
  amount:i===19?2000000:1000000,session_scope:'SYNTHETIC_NOT_MARKET_OBSERVATION'})));
 const research=evaluateResearch({symbol:companies[0].symbol,company:companies[0].company,bars,facts:[],expected_sessions:dates,
  cutoff:cutoff(DAYS[0]),through:dates.at(-1),next_session:DAYS[0],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}},'SHORT');
 assert.equal(research.state,'QUALIFIED');
 const hash=await snapshotHash({version:RESEARCH_FUNNEL_VERSION,research});
 // Authored protocol permissions only, not real licenses/reviewer approvals.
 const policy={now:DAYS[0]+'T08:00:00+08:00',audience:'free',server_entitlement_verified:true,input_hash:hash,approved_hash:hash,
  approved_at:DAYS[0]+'T07:30:00+08:00',quality_reviewed:true,methodology_approved:true,use:'OWN_ANALYSIS',
  grants:[{source:SOURCE,document_url:'https://synthetic.invalid/not-a-real-license',reviewed_at:available,expires_at:null,
   storage:true,commercial:true,raw_redistribution:false,fact_publication:true,derived_publication:true,attribution:'SYNTHETIC TEST ONLY'}]};
 assert.equal(publicationEligibility(research,policy).eligible,true,'positive pre-expiry control');
 const expiredPublication=publicationEligibility(research,{...policy,now:cutoff(DAYS[1])});
 assert.equal(expiredPublication.eligible,false);assert(expiredPublication.reasons.includes('REVIEW_OVERDUE'));
 const oldEdition={schema:'VNEXT_MEMBER_V1',research_only:true,tier:'free',business_date:DAYS[0],history:[],watchlist:[],observations:[{
  id:'synthetic-old-publication',symbol:research.symbol,company:research.company,horizon:'SHORT',status:'WATCHING',
  reason:research.reason,risk:research.risk,created_at:policy.now,as_of:research.cutoff,next_review_at:research.next_review_at,
  confirmation:[research.confirmation],invalidation:[research.invalidation],details:null}]};
 assert.equal(parseMemberResearch(oldEdition,DAYS[0]).observations.length,1);
 assert.throws(()=>parseMemberResearch(oldEdition,DAYS[1]),/MEMBER_DATE/);
 assert.deepEqual(parseMemberResearch({...oldEdition,business_date:DAYS[1],observations:[]},DAYS[1]).observations,[]);
});
