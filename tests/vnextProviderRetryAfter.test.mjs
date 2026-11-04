/** Synthetic controls only. No provider request, credential or production write. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {providerRetryAfter,acquisitionPlan,directoryPlan,sessionsBefore} from '../src/features/vnext/dailyAdapter.ts';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';

const date='2026-10-12',start='2026-10-12T00:00:00.000Z';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成重試控制 '+symbol,exchange:'TWSE',industry:'24'}));
const receipt=async(task,at,payload={rows:[]})=>({task,first_seen_at:at,available_at:at,published_at:null,as_of:at,
 version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:await snapshotHash(payload),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null});
test('HTTP seconds, all three HTTP dates and fractional delay never shorten the provider deadline',()=>{
 for(const value of ['360','Mon, 12 Oct 2026 00:06:00 GMT','Monday, 12-Oct-26 00:06:00 GMT','Mon Oct 12 00:06:00 2026'])
  assert.deepEqual(providerRetryAfter(value,start),{retryAfter:360,retryNotBefore:'2026-10-12T00:06:00.000Z',retryBlocked:false});
 assert.equal(providerRetryAfter('300.01',start).retryAfter,301);
 assert.equal(providerRetryAfter('0',start).retryAfter,3);
 assert.equal(providerRetryAfter(null,start).retryAfter,3);
 assert.equal(providerRetryAfter('Sun, 11 Oct 2026 00:06:00 GMT',start).retryAfter,3);
});
test('unusable or unbounded supplied delays refuse another request instead of falling back to three seconds',()=>{
 for(const value of ['','garbage','Infinity','1e4','0xff','-5','90000','9'.repeat(1000),
  'Tue, 12 Oct 2026 00:06:00 GMT','Mon, 31 Feb 2026 00:06:00 GMT','2026-10-12T00:06:00Z'])
  assert.equal(providerRetryAfter(value,start).retryBlocked,true,value);
 assert.equal(providerRetryAfter('86400',start).retryBlocked,false);
 assert.throws(()=>providerRetryAfter('360','not-a-clock'),/SOURCE_RETRY_CLOCK_INVALID/);
});
async function harness({header='900',status=429,large=false,failCheckpoint=false,failSourceSave=false,saved={}}={}){
 let now=start,failed=false;
 const daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const {key:ignored,...body}=warm;void ignored;const aliasBody={...body,scope:body.scope+':SAME_URL_ALIAS'},alias={...aliasBody,key:await snapshotHash(aliasBody)};
 const cache=new Map(await Promise.all((await directoryPlan(date)).map(async t=>[t.key,await receipt(t,start,{rows:t.exchange==='TWSE'?companies:[]})])));
 const sources=[...cache.values()];
 if(large){const rows=sessionsBefore(date,20).flatMap(d=>companies.map(c=>({symbol:c.symbol,id:'bar-'+c.symbol+'-'+d,date:d,
  open:10,high:11,low:9,close:10,volume:100,amount:1000,source:'https://www.twse.com.tw/'+('s'.repeat(1800)),
  first_seen_at:start,available_at:start,as_of:d+'T13:30:00+08:00',evidence_hash:'a'.repeat(64),session_scope:'REGULAR'})));
  sources.push(await receipt(warm,start,{rows}));}
 const reservations=new Map(),calls=[],http=[],locks=[];
 let run={id:'synthetic-retry-run',business_date:date,actionable_at:date+'T09:00:00+08:00',lease:'test-only',fence:1,
  plan:[cold,warm,alias],cursor:0,checkpoint:structuredClone(saved)};
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1')return {status:'ACQUIRED',run:structuredClone(run)};
  const op=args.p_op,data=structuredClone(args.p_data);calls.push({op,data});
  if(op==='SOURCE_BEGIN'){
   if(cache.has(data.key))return {status:'CACHE',receipt:cache.get(data.key)};
   const state=reservations.get(data.key)??{attempts:0,retryAt:0};reservations.set(data.key,state);
   if(state.attempts>=3)return {status:'EXHAUSTED'};
   if(state.retryAt>Date.parse(now))return {status:'WAIT_RETRY',retry_at:new Date(state.retryAt).toISOString()};
   state.attempts++;return {status:'FETCH'};
  }
  if(op==='SOURCE_FAIL'){reservations.get(data.key).retryAt=Date.parse(now)+Math.min(300,data.retry_seconds)*1000;return {};}
  if(op==='SOURCE_SAVE'){
   if(failSourceSave&&!failed){failed=true;throw Error('SYNTHETIC_SOURCE_SAVE_FAILED');}
   const value=JSON.parse(data.text);cache.set(value.task.key,value);sources.push(value);return {};
  }
  if(op==='CHECKPOINT'||op==='CHECKPOINT_STATE'){
   if(failCheckpoint&&!failed){failed=true;throw Error('SYNTHETIC_CHECKPOINT_FAILED');}
   const next=op==='CHECKPOINT'?data:{...data.checkpoint,acquired:run.checkpoint.acquired,...(run.checkpoint.locks?{locks:run.checkpoint.locks}:{})};
   if(run.checkpoint.acquired)assert.deepEqual(next.acquired,run.checkpoint.acquired,'pinned acquired snapshot is immutable');
   if(run.checkpoint.locks)assert.deepEqual(next.locks,run.checkpoint.locks,'prepared locks are immutable');
   run.checkpoint=structuredClone(next);return {};
  }
  if(op==='CURSOR'){run.cursor=data.cursor;return {};}
  if(op==='DUE_OUTCOMES')return [];
  if(op==='SOURCES')return structuredClone(sources);
  if(op==='ENTRY_SOURCE')return {market:{value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic-market',observed_at:now,available_at:now}};
  if(op==='PREDICTIONS'){locks.push(...data);return {};}
  if(op==='FINISH')return {};
  throw Error('UNEXPECTED_SYNTHETIC_RPC_'+op);
 };
 const fetcher=async url=>{
  http.push({url:String(url),at:now});
  if(String(url)===warm.url&&http.filter(x=>x.url===warm.url).length===1)return new Response('',{status,headers:{'Retry-After':header}});
  const parsed=new URL(url),month=parsed.searchParams.get('date').slice(0,6),symbol=parsed.searchParams.get('stockNo');
  return Response.json({stat:'OK',date:month+'01',title:' '+symbol+' 合成隔離控制',fields:['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],data:[]});
 };
 const ports={rpc,fetcher,clock:()=>now,sleep:async()=>{}};
 return {warm,cold,alias,http,calls,locks,reservations,get checkpoint(){return structuredClone(run.checkpoint);},
  get cursor(){return run.cursor;},at:value=>{now=value;},invoke:()=>workDailyRun(run.id,ports)};
}
test('numeric wait over SQL 300s survives detached claims and blocks the same URL under a second task key',async()=>{
 const a=await harness({header:'360'});
 assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');
 assert.equal(a.http.length,1);assert.equal(a.reservations.get(a.warm.key).attempts,1);assert.equal(a.reservations.has(a.alias.key),false);
 a.at('2026-10-12T00:05:00.000Z');assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,1);
 a.at('2026-10-12T00:05:59.999Z');assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,1);
 assert(a.checkpoint.prewarm_v1,'latest prewarm progress is retained alongside cooldown before snapshot pin');
 a.at('2026-10-12T00:06:00.000Z');assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.http.filter(x=>x.url===a.warm.url).length,3);assert.equal(a.reservations.get(a.warm.key).attempts,2);
 assert.equal(a.reservations.get(a.alias.key).attempts,1);assert.equal(a.cursor,0);
});
test('HTTP date is durable across worker invocations and leaves SQL retry/attempt limits unchanged',async()=>{
 const a=await harness({header:'Mon, 12 Oct 2026 00:06:00 GMT'});await a.invoke();
 const barrier=Object.values(a.checkpoint.provider_retry_v1.by_url)[0];assert.equal(barrier.not_before,'2026-10-12T00:06:00.000Z');
 a.at('2026-10-12T00:05:00Z');await a.invoke();assert.equal(a.http.length,1);assert.equal(a.reservations.get(a.warm.key).attempts,1);
 a.at('2026-10-12T00:06:00Z');await a.invoke();assert.equal(a.http.length,3);
 assert(a.calls.filter(c=>c.op==='SOURCE_FAIL').every(c=>Number.isInteger(c.data.retry_seconds)&&c.data.retry_seconds<=300));
});
test('long wait survives partial snapshot, all forward stage saves and a later cold continuation',async()=>{
 const a=await harness({header:'900'});await a.invoke();const barrier=a.checkpoint.provider_retry_v1;
 a.at('2026-10-12T00:11:00Z');assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.deepEqual(a.checkpoint.provider_retry_v1,barrier);const pinned=a.checkpoint.acquired;
 a.at('2026-10-12T00:11:01Z');await a.invoke();assert.equal(a.locks.length,216);assert.deepEqual(a.checkpoint.provider_retry_v1,barrier);
 a.at('2026-10-12T00:11:02Z');await a.invoke();assert.equal(a.http.filter(x=>x.url===a.warm.url).length,1);
 assert.deepEqual(a.checkpoint.acquired,pinned);assert.deepEqual(a.checkpoint.provider_retry_v1,barrier);
 a.at('2026-10-12T00:15:00Z');await a.invoke();assert(a.http.filter(x=>x.url===a.warm.url).length>1);
 assert.deepEqual(a.checkpoint.acquired,pinned,'late source does not rewrite the locked snapshot');
});
test('compact CHECKPOINT_STATE retains cooldown without replacing the multi-MB acquired snapshot',async()=>{
 const a=await harness({header:'900',large:true});await a.invoke();const barrier=a.checkpoint.provider_retry_v1;
 a.at('2026-10-12T00:11:00Z');assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert(JSON.stringify(a.checkpoint.acquired).length>2*1024*1024);
 for(let i=0;i<9&&!a.locks.length;i++)await a.invoke();
 assert(a.calls.some(c=>c.op==='CHECKPOINT_STATE'));assert.equal(a.locks.length,216);
 assert.deepEqual(a.checkpoint.provider_retry_v1,barrier);
 assert(a.calls.filter(c=>c.op==='CHECKPOINT_STATE').every(c=>c.data.checkpoint.provider_retry_v1));
});
test('malformed or excessive supplied retry delay is unavailable for this run and never retried under an alias',async()=>{
 for(const header of ['garbage','90000']){
  const a=await harness({header});await a.invoke();assert.equal(a.http.filter(x=>x.url===a.warm.url).length,1);
  assert.equal(Object.values(a.checkpoint.provider_retry_v1.by_url)[0].blocked,true);
  a.at('2026-10-12T00:15:00Z');for(let i=0;i<4;i++)await a.invoke();
  assert.equal(a.http.filter(x=>x.url===a.warm.url).length,1);assert.equal(a.reservations.has(a.alias.key),false);
 }
});
test('failed cooldown checkpoint blocks the run without a queued continuation or a second provider attempt',async()=>{
 const a=await harness({failCheckpoint:true});const result=await a.invoke();
 assert.equal(result.status,'BLOCKED');assert.equal(result.continue,false);assert.equal(result.reason,'SYNTHETIC_CHECKPOINT_FAILED');
 assert.equal(a.http.length,1);assert.equal(a.checkpoint.provider_retry_v1,undefined);
});
test('source save failure retains existing durable cooldown and prewarm metadata instead of replacing them',async()=>{
 const a=await harness({header:'360',failSourceSave:true});await a.invoke();const saved=a.checkpoint.provider_retry_v1;
 a.at('2026-10-12T00:06:00Z');await a.invoke();assert.deepEqual(a.checkpoint.provider_retry_v1,saved);
 assert(a.checkpoint.prewarm_v1);assert.equal(a.checkpoint.acquired,undefined);
});
test('corrupt saved cooldown fails closed before any source reservation or fetch',async()=>{
 const a=await harness({saved:{provider_retry_v1:{version:1,by_url:{['f'.repeat(64)]:{url:'https://www.twse.com.tw/',observed_at:start,not_before:'not-a-time',blocked:false}}}}});
 assert.equal((await a.invoke()).reason,'PROVIDER_RETRY_CHECKPOINT_INVALID');assert.equal(a.http.length,0);
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'));
});
