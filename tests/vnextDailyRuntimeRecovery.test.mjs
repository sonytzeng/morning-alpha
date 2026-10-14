/** Synthetic contract controls, NOT natural Production evidence or performance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionPlan,directoryPlan,outcomePlan,assembleDaily} from '../src/features/vnext/dailyAdapter.ts';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {runDailyIntelligence,verifyDailyLock} from '../src/features/vnext/dailyIntelligence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const date='2026-10-12',before='2026-10-12T00:58:30Z';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成隔離控制 '+symbol,exchange:'TWSE',industry:'24'}));
const receipt=async(task,at,payload={rows:[]})=>({task,first_seen_at:at,available_at:at,published_at:null,as_of:at,
 version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:await snapshotHash(payload),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null});
async function checkpoint(){
 const acquired=await assembleDaily(date,companies,[],before);acquired.entry.provenance='SYNTHETIC_TEST';
 const {snapshot_hash,...body}=acquired;void snapshot_hash;acquired.snapshot_hash=await snapshotHash(body);
 let state;await runDailyIntelligence({business_date:date,checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'SYNTHETIC_CONTROL',
  core_ready:true,core_busy:false,source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:date+'T09:00:00+08:00'},
 {exclusive:async(_k,work)=>work(),load:async()=>null,save:async s=>{state=structuredClone(s);},lock:async()=>{}},
 {acquire:async()=>acquired,clock:()=>before,outcomes:async()=>({}),publication:async()=>[]});
 assert.equal(state.locks.length,216);assert(await verifyDailyLock(state.locks[0]));return state;
}
async function runner({at=before,plan=[],cursor=0,saved={},due=[],cold=false}={}){
 const dirs=await directoryPlan(date),cache=new Map(await Promise.all(dirs.map(async t=>[t.key,await receipt(t,at,{rows:t.exchange==='TWSE'?companies:[]})])));
 const calls=[],http=[],stored=[],locked=[],sources=[...cache.values()];let pending=due,checkpointState=saved,run={id:'isolated-run',business_date:date,
  actionable_at:date+'T09:00:00+08:00',lease:'isolated-lease',fence:2,plan,cursor,checkpoint:checkpointState};
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1')return {status:'ACQUIRED',run};
  const op=args.p_op,data=args.p_data;calls.push({op,data});
  if(op==='SOURCE_BEGIN')return cache.has(data.key)?{status:'CACHE',receipt:cache.get(data.key)}:cold?{status:'FETCH'}:{status:'CACHE',receipt:await receipt(data,at)};
  if(op==='PLAN'){run.plan=data;return {};}
  if(op==='SOURCE_SAVE'){const r=JSON.parse(data.text);sources.push(r);stored.push(r);return {};}
  if(op==='SOURCE_FAIL')return {};
  if(op==='CURSOR'){run.cursor=data.cursor;return {};}
  if(op==='DUE_OUTCOMES')return pending;
  if(op==='SOURCES')return sources;
  if(op==='ENTRY_SOURCE')return {};
  if(op==='CHECKPOINT'){checkpointState=structuredClone(data);return {};}
  if(op==='PREDICTIONS'){locked.push(...data);return {};}
  if(op==='OUTCOME')return {};
  if(op==='OUTCOME_CHECKED'){pending=pending.filter(p=>p.prediction.id!==data.id);return {};}
  if(op==='FINISH')return {};
  throw Error('UNEXPECTED_TEST_RPC');
 };
 const fetcher=async url=>{
  http.push(String(url));const u=new URL(url),month=u.searchParams.get('date').slice(0,6),symbol=u.searchParams.get('stockNo');
  return Response.json({stat:'OK',date:month+'01',title:' '+symbol+' 合成隔離控制',fields:symbol?
   ['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價']:['日期','開盤指數','最高指數','最低指數','收盤指數'],data:[]});
 };
 const result=await workDailyRun(run.id,{rpc,fetcher,clock:()=>at,sleep:async()=>{}});
 return {result,calls,http,stored,locked,run,checkpoint:checkpointState};
}
test('cold acquisition prioritizes latest prices across all 72 before older history, without discarding tasks',async()=>{
 const plan=await acquisitionPlan(date,companies),price=plan.filter(t=>t.kind==='PRICE');
 assert.equal(price.filter(t=>t.month==='2026-10').length,72);
 assert(price.slice(0,72).every(t=>t.month==='2026-10'));
 assert(plan.length>1000&&plan.length<=1600);assert.equal(new Set(plan.map(t=>t.key)).size,plan.length);
});
test('cold worker fetches at most eight, commits cursor and yields; no partial evidence invents buy points',async()=>{
 const plan=(await acquisitionPlan(date,companies)).filter(t=>t.kind==='PRICE').slice(0,20);
 const a=await runner({at:'2026-10-12T00:00:00Z',plan,cold:true});
 assert.equal(a.http.length,8);assert.equal(a.run.cursor,8);assert.equal(a.result.reason,'ACQUISITION_CONTINUATION');assert.equal(a.locked.length,0);
 const b=await runner({at:'2026-10-12T00:01:00Z',plan,cursor:a.run.cursor,cold:true});
 assert.equal(b.http.length,8);assert.equal(b.run.cursor,16);assert(!b.http.some(url=>a.http.includes(url)));
});
test('deadline produces immutable truthful insufficient judgments while cold bootstrap continues',async()=>{
 const a=await runner({at:'2026-10-12T00:59:15Z',plan:await acquisitionPlan(date,companies),cold:true});
 assert.equal(a.http.length,0);assert.equal(a.locked.length,216);
 assert(a.locked.every(p=>p.body.research.state==='INSUFFICIENT'&&p.body.locked_at==='2026-10-12T00:59:15Z'));
 assert.equal(a.result.reason,'COLD_BOOTSTRAP_WITH_IMMUTABLE_LOCK');
});
test('after the deadline, newly acquired data cannot be backdated into Forward',async()=>{
 const plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T02:00:00Z',plan,cursor:1});
 assert.equal(a.locked.length,0);assert.equal(a.result.status,'EXPIRED');assert.equal(a.result.reason,'LATE_ACQUISITION_NOT_FORWARD');
});
test('warm prices wait boundedly for the independently published Canonical, not lock a false early market gap',async()=>{
 const plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1});
 assert.equal(a.result.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(a.result.retry_after_seconds,30);assert.equal(a.locked.length,0);
});
test('prepared immutable locks survive recovery, corrupted checkpoint fails closed',async()=>{
 const saved=await checkpoint(),plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({saved,plan,cursor:1});
 assert.equal(a.result.status,'COMPLETE');assert.equal(a.locked.length,0);assert.deepEqual(a.checkpoint,saved);
 saved.locks[0].symbol='FAKE';const b=await runner({saved,plan,cursor:1});assert.equal(b.result.reason,'CHECKPOINT_LOCK_INVALID');assert.equal(b.http.length,0);
});
test('matured prior outcome sources have an independent close revision, never reuse frozen premarket prices',async()=>{
 const saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT'),at='2026-10-12T06:00:00Z';
 const due=[{prediction,horizons:[1]}],tasks=await outcomePlan(date,due,companies,at),daily=await acquisitionPlan(date,companies);
 assert(tasks.every(t=>t.scope.includes(':OUTCOME:2026-10-12:CLOSE')&&t.max_age_days===0));
 assert(tasks.every(t=>!daily.some(s=>s.key===t.key)));
 const a=await runner({at,saved,plan:daily,cursor:0,due,cold:true});
 assert(a.http.length>=2);assert(a.stored.every(r=>r.task.scope.includes(':OUTCOME:')));
 assert.equal(a.calls.filter(c=>c.op==='CURSOR').length,0,'cold history cannot starve matured outcome');
 const outcomes=a.calls.filter(c=>c.op==='OUTCOME');assert.equal(outcomes.length,1);
 assert.equal(outcomes[0].data.result.state,'UNKNOWN');assert.equal(outcomes[0].data.result.performance_eligible,false);
 assert.equal(outcomes[0].data.result.net_return,null);assert.equal(a.locked.length,0);assert.deepEqual(a.checkpoint,saved);
});
