/** Synthetic contract controls, NOT natural Production evidence or performance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {acquisitionPlan,directoryPlan,outcomePlan,assembleDaily,normalizeSource,fetchSource} from '../src/features/vnext/dailyAdapter.ts';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {ENTRY_VERSION,ENTRY_PREMARKET_VERSION} from '../research/entry-opportunity.ts';
import {handleVnextDaily} from '../supabase/functions/vnext-daily-research-v1/handler.ts';
import {runDailyIntelligence,verifyDailyLock} from '../src/features/vnext/dailyIntelligence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {retainedIssuerFinancials,retainedIssuerFinancialReleases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {v2Hash} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {entryInputFromV2} from '../research/entry-v2-adapter.ts';

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
async function runner({at=before,plan=[],cursor=0,saved={},due=[],cold=false,lockError=null,throughHandler=false,providerWaitSeconds=0,providerStatus=200,
 leaseUntil,finishError=null,onFinish=()=>{},advanceSleep=()=>{},continuationError=null,claimStatus='ACQUIRED',claimError=null,onClaim=()=>{},rpcErrorOp=null,clock=()=>at,businessDate=date,issuerFinancials,additionalSources=[],unboundCache=[],waitKeys=new Set(),simulateSqlReservations=false,providerStatuses=[],providerRetrySeconds=3,providerSleep=async()=>{},entryLineage={},entryVersion}={}){
 const dirs=await directoryPlan(businessDate),cache=new Map(await Promise.all(dirs.map(async t=>[t.key,await receipt(t,at,{rows:t.exchange==='TWSE'?companies:[]})])));
 for(const item of unboundCache)cache.set(item.task.key,item);
 const sqlReservations=new Map();
 const calls=[],http=[],stored=[],locked=[],sources=[...cache.values()].filter(item=>!unboundCache.includes(item)).concat(additionalSources);let pending=due,checkpointState=saved,run={id:'isolated-run',business_date:businessDate,
  actionable_at:businessDate+'T09:00:00+08:00',lease:'isolated-lease',...(leaseUntil===undefined?{}:{lease_until:leaseUntil}),fence:2,plan,cursor,checkpoint:checkpointState};
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1'){if(claimError)throw Error(claimError);onClaim();return {status:claimStatus,run};}
  const op=args.p_op,data=args.p_data;calls.push({op,data});
  if(op===rpcErrorOp||typeof rpcErrorOp==='function'&&rpcErrorOp(op))throw Error('DATABASE_RPC_REJECTED');
  if(op==='SOURCE_BEGIN'){
   if(waitKeys.has(data.key))return {status:'WAIT_RETRY',retry_at:new Date(Date.parse(clock())+60000).toISOString()};
   if(cache.has(data.key)){const cached=cache.get(data.key);if(unboundCache.includes(cached)&&!sources.includes(cached))sources.push(cached);return {status:'CACHE',receipt:cached};}
   if(simulateSqlReservations){const state=sqlReservations.get(data.key)??{attempts:0,retryAt:0};
    if(state.receipt)return {status:'CACHE',receipt:state.receipt};if(state.attempts>=3)return {status:'EXHAUSTED'};
    if(state.retryAt>Date.parse(clock()))return {status:'WAIT_RETRY',retry_at:new Date(state.retryAt).toISOString()};
    state.attempts++;sqlReservations.set(data.key,state);return {status:'FETCH'};}
   return providerWaitSeconds?{status:'WAIT_RETRY',retry_at:new Date(Date.parse(at)+providerWaitSeconds*1000).toISOString()}:cold?{status:'FETCH'}:{status:'CACHE',receipt:await receipt(data,at)};
  }
  if(op==='PLAN'){run.plan=data;return {};}
  if(op==='SOURCE_SAVE'){const r=JSON.parse(data.text);sources.push(r);stored.push(r);if(simulateSqlReservations)sqlReservations.get(r.task.key).receipt=r;return {};}
  if(op==='SOURCE_FAIL'){if(simulateSqlReservations)sqlReservations.get(data.key).retryAt=Date.parse(clock())+data.retry_seconds*1000;return {};}
  if(op==='CURSOR'){run.cursor=data.cursor;return {};}
  if(op==='DUE_OUTCOMES')return pending;
  if(op==='SOURCES')return sources;
  if(op==='ENTRY_SOURCE')return entryLineage;
  if(op==='CHECKPOINT'){checkpointState=structuredClone(data);run.checkpoint=checkpointState;return {};}
  if(op==='PREDICTIONS'){if(lockError)throw Error(lockError);locked.push(...data);return {};}
  if(op==='OUTCOME')return {};
  if(op==='OUTCOME_CHECKED'){pending=pending.filter(p=>p.prediction.id!==data.id);return {};}
  if(op==='FINISH'){onFinish();if(finishError)throw Error(finishError);return {};}
  throw Error('UNEXPECTED_TEST_RPC');
 };
 const fetcher=async url=>{
  http.push(String(url));const status=providerStatuses[http.length-1]??providerStatus;if(status!==200)return new Response('',{status,headers:{'retry-after':String(providerRetrySeconds)}});
  const u=new URL(url),month=u.searchParams.get('date').slice(0,6),symbol=u.searchParams.get('stockNo');
  return Response.json({stat:'OK',date:month+'01',title:' '+symbol+' 合成隔離控制',fields:symbol?
   ['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價']:['日期','開盤指數','最高指數','最低指數','收盤指數'],data:[]});
 };
 const ports={rpc,fetcher,clock,sleep:providerSleep,...(issuerFinancials?{issuerFinancials}:{}),...(entryVersion?{entryVersion}:{})};
 const sleeps=[],continuations=[];let result;
 if(throughHandler){
  run.id='11111111-1111-4111-8111-111111111111';const tasks=[];
  const response=await handleVnextDaily(new Request('https://isolated.test',{method:'POST',headers:{'x-vnext-internal':'isolated-control-not-production-token'},body:JSON.stringify({run_id:run.id})}),
   {...ports,cronSecret:'isolated-control-not-production-token',background:p=>tasks.push(p),sleep:async ms=>{sleeps.push(ms);advanceSleep(ms);},continueRun:async id=>{continuations.push(id);if(continuationError)throw Error(continuationError);}});
  assert.equal(response.status,202);await Promise.all(tasks);
  result=calls.findLast(c=>c.op==='FINISH')?.data;
 }else result=await workDailyRun(run.id,ports);
 return {result,calls,http,stored,locked,run,sources,sqlReservations,sleeps,continuations,get checkpoint(){return checkpointState;},invoke:()=>workDailyRun(run.id,ports)};
}
test('SYNTHETIC future-clock worker pins eligible retained financial facts once and never revises a checkpoint on resume',async()=>{
 const binding=structuredClone(retainedIssuerFinancials);
 const a=await runner({at:'2026-11-02T00:59:30Z',businessDate:'2026-11-02',issuerFinancials:binding});
 assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 const pinned=structuredClone(a.checkpoint.acquired);assert.equal(pinned.inputs.flatMap(i=>i.facts).length,38);
 assert.equal(pinned.inputs.find(i=>i.symbol==='2330').facts.length,12);
 assert.equal(pinned.inputs.find(i=>i.symbol==='2454').facts.length,10);
 binding.expectedHash='0'.repeat(64); // A changed release cannot rewrite prior acquisition.
 await a.invoke();assert.deepEqual(a.checkpoint.acquired,pinned);assert.equal(a.locked.length,216);
 assert(a.locked.every(l=>l.body.research.state==='INSUFFICIENT'));
});
test('SYNTHETIC release array adds the supplement once and preserves acquired bytes on resume',async()=>{
 const binding=structuredClone(retainedIssuerFinancialReleases);
 const a=await runner({at:'2026-11-03T00:59:30Z',businessDate:'2026-11-03',issuerFinancials:binding});
 assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 const pinned=structuredClone(a.checkpoint.acquired);assert.equal(pinned.inputs.flatMap(i=>i.facts).length,329);
 for(const symbol of ['2382','3443'])assert.equal(pinned.inputs.find(i=>i.symbol===symbol).facts.filter(f=>f.kind==='EPS').length,4);
 // This fixed synthetic clock is after the six release reviews. The31 partial,
 // 12 basic,236 margin and4 source-native CAPEX facts join46; not a natural receipt.
 const partial=binding[2];assert.equal(partial.expectedHash,'c2edd821e88e331ce75ca3160f5e4fb9e46b757da050632b03c7720b3d631cc3');
 assert.equal(partial.packet.facts.length,31);assert(Date.parse(partial.packet.created_at)<Date.parse('2026-11-03T00:59:30Z'));
 const partialIds=new Set(partial.packet.facts.map(f=>f.id)),joined=pinned.inputs.flatMap(i=>i.facts).filter(f=>partialIds.has(f.id));
 assert.equal(joined.length,31);assert.equal(new Set(joined.map(f=>f.symbol)).size,12);
 for(const f of partial.packet.facts)assert.deepEqual(joined.find(x=>x.id===f.id),f);
 const basic=binding[3];assert.equal(basic.expectedHash,'7d0f5ca5ab48677d10381b4134c98c9f34695145cd0982a83c2c4f311aa6ea68');
 assert.equal(basic.packet.facts.length,12);assert(Date.parse(basic.packet.created_at)<Date.parse('2026-11-03T00:59:30Z'));
 for(const symbol of ['2303','3006','3711'])assert.equal(pinned.inputs.find(i=>i.symbol===symbol).facts.filter(f=>f.kind==='EPS').length,4);
 for(const f of basic.packet.facts)assert.deepEqual(pinned.inputs.find(i=>i.symbol===f.symbol).facts.find(x=>x.id===f.id),f);
 const margin=binding[4];assert.equal(margin.expectedHash,'6464fc192100e38265605b5dd5b98042a6c8300238ac3389716cca7b3a8c1745');
 assert.equal(margin.packet.facts.length,236);assert(Date.parse(margin.packet.created_at)<Date.parse('2026-11-03T00:59:30Z'));
 for(const f of margin.packet.facts)assert.deepEqual(pinned.inputs.find(i=>i.symbol===f.symbol).facts.find(x=>x.id===f.id),f);
 const capex=binding[5];assert.equal(capex.packet.facts.length,4);assert(Date.parse(capex.packet.created_at)<Date.parse('2026-11-03T00:59:30Z'));
 for(const f of capex.packet.facts)assert.deepEqual(pinned.inputs.find(i=>i.symbol===f.symbol).facts.find(x=>x.id===f.id),f);
 // Each new acquisition pays the existing clone/hash cost once per release.
 // A retained checkpoint must skip all releases, even if a later binding fails.
 for(const release of binding)release.expectedHash='0'.repeat(64);
 await a.invoke();assert.deepEqual(a.checkpoint.acquired,pinned);assert.equal(a.locked.length,216);
 assert(a.locked.every(l=>l.body.research.state==='INSUFFICIENT'));
});
test('SYNTHETIC historical acquisition cannot receive the later supplement',async()=>{
 const a=await runner({at:'2026-11-02T00:59:30Z',businessDate:'2026-11-02',issuerFinancials:retainedIssuerFinancialReleases});
 assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 const facts=a.checkpoint.acquired.inputs.flatMap(i=>i.facts);assert.equal(facts.length,38);
 assert(!facts.some(f=>['2382','3443'].includes(f.symbol)));
 assert(a.checkpoint.acquired.source_issues.some(i=>i.reason==='RETAINED_PACKET_NOT_YET_AVAILABLE'));
});
test('cold acquisition prioritizes latest prices across all 72 before older history, without discarding tasks',async()=>{
 const plan=await acquisitionPlan(date,companies),price=plan.filter(t=>t.kind==='PRICE');
 assert.equal(price.filter(t=>t.month==='2026-10').length,72);
 assert(price.slice(0,72).every(t=>t.month==='2026-10'));
 assert(plan.length>1000&&plan.length<=1600);assert.equal(new Set(plan.map(t=>t.key)).size,plan.length);
});
test('no due: completed warm prefix pins snapshot before cold history and later resumes the original cursor',async()=>{
 const at='2026-10-12T00:00:00Z',daily=await acquisitionPlan(date,companies);
 const warm=daily.filter(t=>t.kind==='PRICE'&&t.month==='2026-10').slice(0,2),cold=daily.filter(t=>t.kind==='PRICE'&&t.month==='2025-10').slice(0,40);
 assert.equal(warm.length,2);assert.equal(cold.length,40);
 const cached=await Promise.all(warm.map(t=>receipt(t,'2026-10-11T23:50:00Z')));
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[...warm,...cold],due:[],unboundCache:cached,entryLineage:{market}});
 assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.run.cursor,2);
 assert(a.checkpoint.acquired);assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&cold.some(t=>t.key===c.data.key)));
 const first=structuredClone(a.checkpoint.acquired);await a.invoke();assert.deepEqual(a.checkpoint.acquired,first);
 assert.equal(a.locked.length,216);assert.equal(a.run.cursor,2);
 const resumed=await a.invoke();assert(a.calls.some(c=>c.op==='SOURCE_BEGIN'&&cold.some(t=>t.key===c.data.key)));
 assert(a.run.cursor>2);assert.notEqual(resumed.reason,'COLD_BOOTSTRAP_NO_LATE_FORWARD');
});
test('no due: full new 72-stock plan completes warm prefix across leases before cold bootstrap',async()=>{
 const at='2026-10-12T00:00:00Z',plan=await acquisitionPlan(date,companies);
 const expectedFirstCold=plan.findIndex(t=>t.kind==='PRICE'&&t.month==='2025-10'||['EVENT','FINANCIAL_YTD','CASHFLOW_YTD','ACTION'].includes(t.kind));
 assert(expectedFirstCold>32&&plan.length>expectedFirstCold+500);
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan,due:[],entryLineage:{market}});let result=a.result,rounds=1;
 while(result.reason==='ACQUISITION_CONTINUATION'&&rounds<20){result=await a.invoke();rounds++;}
 assert.equal(result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.run.cursor,expectedFirstCold);
 assert(a.checkpoint.acquired);assert.equal(a.locked.length,0);
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&plan.slice(expectedFirstCold).some(t=>t.key===c.data.key)));
});
test('no due: transient failure of a warm source never advances cursor or fixes a partial snapshot early',async()=>{
 const at='2026-10-12T00:00:00Z',daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[warm,cold],due:[],cold:true,providerStatus:503,entryLineage:{market}});
 assert.equal(a.result.reason,'SOURCE_RETRY_PENDING');assert.equal(a.run.cursor,0);assert(!a.checkpoint.acquired);assert.equal(a.locked.length,0);
});
test('no due: old noncontiguous plan hands off before cold task and warms later source without skipping cursor',async()=>{
 const at='2026-10-12T00:00:00Z',daily=await acquisitionPlan(date,companies),warm=daily.filter(t=>t.kind==='PRICE'&&t.month==='2026-10').slice(0,2),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const cached=await Promise.all(warm.map(t=>receipt(t,'2026-10-11T23:50:00Z')));
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[warm[0],cold,warm[1]],due:[],unboundCache:cached,entryLineage:{market}});
 assert.equal(a.result.reason,'WARM_PRIORITY_CONTINUATION');assert.equal(a.run.cursor,1);assert(!a.checkpoint.acquired);
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
 const next=await a.invoke();assert.equal(next.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.run.cursor,1);
 assert(a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===warm[1].key));assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
});
test('no due: crash after cached binding but before cursor advances replays once without data loss',async()=>{
 const at='2026-10-12T00:00:00Z',daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const cached=await receipt(warm,'2026-10-11T23:50:00Z');let fail=true;
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[warm,cold],due:[],unboundCache:[cached],entryLineage:{market},rpcErrorOp:op=>{if(op==='CURSOR'&&fail){fail=false;return true;}return false;}});
 assert.equal(a.result.status,'BLOCKED');assert.equal(a.run.cursor,0);assert(!a.checkpoint.acquired);
 const next=await a.invoke();assert.equal(next.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.run.cursor,1);
 assert.equal(a.calls.filter(c=>c.op==='SOURCE_BEGIN'&&c.data.key===warm.key).length,2);assert.equal(a.sources.filter(s=>s.task?.key===warm.key).length,1);
});
test('no due: SQL WAIT_RETRY is respected before warm cursor or snapshot advances',async()=>{
 const at='2026-10-12T00:00:00Z',daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[warm,cold],due:[],waitKeys:new Set([warm.key]),entryLineage:{market}});
 assert.equal(a.result.reason,'SOURCE_RETRY_PENDING');assert.equal(a.run.cursor,0);assert.equal(a.locked.length,0);assert(!a.checkpoint.acquired);
});
test('no due: 08:57 reserve creates truthful partial snapshot, 09:00 never creates a new forward lock',async()=>{
 const daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const at='2026-10-12T00:57:00Z',market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const reserved=await runner({at,plan:[warm,cold],due:[],entryLineage:{market}});
 assert.equal(reserved.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(reserved.run.cursor,0);
 assert(!reserved.calls.some(c=>c.op==='SOURCE_BEGIN'&&(c.data.key===warm.key||c.data.key===cold.key)));assert.equal(reserved.locked.length,0);
 const late=await runner({at:'2026-10-12T01:00:00Z',plan:[warm,cold],due:[]});
 assert.equal(late.locked.length,0);assert(!late.checkpoint.acquired);assert.equal(late.run.cursor,2);assert.equal(late.result.status,'EXPIRED');
});
test('no due: finished warm prefix waits for Canonical without fetching cold history',async()=>{
 let now='2026-10-12T00:00:00Z';const daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const a=await runner({at:now,clock:()=>now,plan:[warm,cold],due:[]});
 assert.equal(a.result.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(a.run.cursor,1);assert(!a.checkpoint.acquired);
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
 const retry=await a.invoke();assert.equal(retry.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(a.run.cursor,1);
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
 now='2026-10-12T00:59:00Z';const reserved=await a.invoke();assert.equal(reserved.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.run.cursor,1);assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
});
test('cold worker fetches at most eight, commits cursor and yields; no partial evidence invents buy points',async()=>{
 const plan=(await acquisitionPlan(date,companies)).filter(t=>t.kind==='PRICE').slice(0,20);
 const a=await runner({at:'2026-10-12T00:00:00Z',plan,cold:true});
 assert.equal(a.http.length,8);assert.equal(a.run.cursor,8);assert.equal(a.result.reason,'ACQUISITION_CONTINUATION');assert.equal(a.locked.length,0);
 const b=await runner({at:'2026-10-12T00:01:00Z',plan,cursor:a.run.cursor,cold:true});
 assert.equal(b.http.length,8);assert.equal(b.run.cursor,16);assert(!b.http.some(url=>a.http.includes(url)));
});
test('permanent official403 cannot starve184 event/financial tasks or turn absent evidence into success',async()=>{
 const plan=(await acquisitionPlan(date,companies)).filter(t=>['EVENT','FINANCIAL_YTD','CASHFLOW_YTD'].includes(t.kind));
 assert.equal(plan.length,184);let cursor=0,invocations=0,requests=0;
 while(cursor<plan.length){
  assert(invocations<24,'permanent source denials must drain within the eight-request invocation bound');
  const a=await runner({at:'2026-10-12T00:00:00Z',plan,cursor,cold:true,providerStatus:403});
  assert(a.http.length<=8);assert(a.run.cursor>cursor);assert.equal(a.stored.length,0);assert.equal(a.locked.length,0);
  assert(a.calls.filter(c=>c.op==='SOURCE_FAIL').every(c=>c.data.reason==='SOURCE_ACCESS_RESTRICTED'));
  requests+=a.http.length;cursor=a.run.cursor;invocations++;
 }
 assert.equal(invocations,23);assert.equal(requests,184);
 for(const providerStatus of [429,503]){
  const a=await runner({at:'2026-10-12T00:00:00Z',plan,cold:true,providerStatus});
  assert.equal(a.http.length,1);assert.equal(a.run.cursor,0);assert.equal(a.result.reason,'SOURCE_RETRY_PENDING');
 }
});
test('deadline produces immutable truthful insufficient judgments while cold bootstrap continues',async t=>{
 const clock=wallClock(t,'2026-10-12T00:59:00Z'),plan=await acquisitionPlan(date,companies);
 for(const at of ['2026-10-12T00:59:00Z','2026-10-12T00:59:15Z','2026-10-12T00:59:59.999Z']){
  clock.advance(Date.parse(at)-clock.now);
  const expires=Date.parse(at)+3000>=Date.parse(date+'T01:00:00Z');
  // With no cold tasks outstanding, the last boundary isolates true expiry;
  // the earlier cases retain the original unfinished cold-bootstrap plan.
  const a=await runner({at,plan,cursor:expires?plan.length:0,cold:true,clock:()=>new Date(clock.now).toISOString()});
  assert.equal(a.http.length,0);assert.equal(a.locked.length,0);
  assert.equal(a.result.status,'QUEUED');assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
  assert.equal(a.result.continue,true);assert.equal(a.result.retry_after_seconds,3);
  assert.deepEqual(Object.keys(a.checkpoint),['acquired'],'pin has no request binding, attempts, quality approval or locks');
  assert.equal(a.calls.filter(c=>c.op==='CHECKPOINT').length,1);assert(!a.calls.some(c=>c.op==='PREDICTIONS'));
  assert.equal(a.run.checkpoint,a.checkpoint,'next claim sees the persisted pin');
  const acquired=structuredClone(a.checkpoint.acquired),start=a.calls.length;
  assert.equal(acquired.evidence_cutoff,new Date(Date.parse(at)).toISOString());
  // A second explicitly authorized lifecycle invocation, not an auto-retry.
  clock.advance(3000);const b=await a.invoke();
  assert.equal(clock.now,Date.parse(at)+3000);assert.equal(a.http.length,0);
  assert.deepEqual(a.checkpoint.acquired,acquired);
  assert(!a.calls.slice(start).some(c=>['SOURCES','ENTRY_SOURCE'].includes(c.op)));
  if(expires){
   assert.equal(b.status,'EXPIRED');assert.equal(b.reason,'LATE_ACQUISITION_NOT_FORWARD');assert.equal(b.continue,false);
   assert.equal(a.locked.length,0);assert.deepEqual(a.checkpoint,{acquired});
   assert(!a.calls.slice(start).some(c=>['CHECKPOINT','PREDICTIONS'].includes(c.op)));
  }else{
   assert.equal(a.locked.length,216);
   assert(a.locked.every(p=>p.body.research.state==='INSUFFICIENT'&&p.body.locked_at===new Date(Date.parse(at)+3000).toISOString()
    &&p.body.evidence_cutoff===acquired.evidence_cutoff));
   assert.equal(b.status,'QUEUED');assert.equal(b.reason,'COLD_BOOTSTRAP_WITH_IMMUTABLE_LOCK');
   assert.equal(a.checkpoint.attempts.ACQUISITION,1);
  }
 }
});
test('after the deadline, newly acquired data cannot be backdated into Forward',async()=>{
 const plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T02:00:00Z',plan,cursor:1});
 assert.equal(a.locked.length,0);assert.equal(a.result.status,'EXPIRED');assert.equal(a.result.reason,'LATE_ACQUISITION_NOT_FORWARD');
});
test('post-cutoff cold bootstrap advances across bounded invocations and expires without any late Forward',async()=>{
 const plan=(await acquisitionPlan(date,companies)).filter(t=>t.kind==='PRICE').slice(0,20);
 const requests=new Set();let cursor=0,invocations=0,terminal;
 while(cursor<plan.length){
  assert(invocations<3,'twenty tasks must drain under the existing eight-fetch invocation limit');
  // Include exactly09:00 and later claims, including a resumed nonzero cursor.
  const at=new Date(Date.parse(date+'T01:00:00Z')+invocations*60000).toISOString();
  const result=await runner({at,plan,cursor,cold:true});
  assert(result.http.length>0&&result.http.length<=8);assert(result.run.cursor>cursor);
  assert.equal(result.locked.length,0);assert(!result.calls.some(c=>c.op==='PREDICTIONS'));
  assert(!result.calls.some(c=>c.op==='CHECKPOINT'));
  assert(result.stored.every(r=>r.available_at===at&&r.first_seen_at===at));
  for(const url of result.http){assert(!requests.has(url));requests.add(url);}
  cursor=result.run.cursor;invocations++;terminal=result.result;
  if(cursor<plan.length){assert.equal(terminal.status,'QUEUED');assert.equal(terminal.reason,'ACQUISITION_CONTINUATION');}
 }
 assert.equal(invocations,3);assert.equal(requests.size,20);
 assert.equal(terminal.status,'EXPIRED');assert.equal(terminal.continue,false);
 assert.equal(terminal.reason,'LATE_ACQUISITION_NOT_FORWARD');
});
test('warm prices wait boundedly for the independently published Canonical, not lock a false early market gap',async()=>{
 const plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1});
 assert.equal(a.result.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(a.result.retry_after_seconds,30);assert.equal(a.locked.length,0);
});
test('HTTP handler actually continues the 30s Canonical wait once, outside the Core request',async()=>{
 const plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,throughHandler:true});
 assert.equal(a.result.reason,'CANONICAL_PUBLICATION_PENDING');assert.deepEqual(a.sleeps,[30000]);assert.deepEqual(a.continuations,[a.run.id]);assert.equal(a.locked.length,0);
});
test('allowing Canonical30 does not shorten a longer provider backoff or create immediate retry loops',async()=>{
 const plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T00:02:00Z',plan,throughHandler:true,providerWaitSeconds:60});
 assert.equal(a.result.reason,'SOURCE_RETRY_PENDING');assert.deepEqual(a.sleeps,[]);assert.deepEqual(a.continuations,[]);assert.equal(a.http.length,0);assert.equal(a.locked.length,0);
});
test('prepared immutable locks survive recovery, corrupted checkpoint fails closed',async()=>{
 const saved=await checkpoint(),plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({saved,plan,cursor:1});
 assert.equal(a.result.status,'COMPLETE');assert.equal(a.locked.length,216);assert.deepEqual(a.locked.map(r=>r.body),saved.locks);assert.deepEqual(a.checkpoint,saved);
 assert.equal(a.calls[0].op,'PREDICTIONS','commit replay must precede any acquisition or completion');
 saved.locks[0].symbol='FAKE';const b=await runner({saved,plan,cursor:1});assert.equal(b.result.reason,'CHECKPOINT_LOCK_INVALID');assert.equal(b.http.length,0);
});
test('failed prepared commit cannot complete or run outcomes; explicit SQL late rejection is EXPIRED, not a false system failure',async()=>{
 const saved=await checkpoint(),plan=(await acquisitionPlan(date,companies)).slice(0,1);
 for(const [at,lockError] of [[before,'DATABASE_RPC_REJECTED'],['2026-10-12T01:01:00Z','FORWARD_TIME_INVALID']]){
  const a=await runner({at,saved,plan,cursor:1,lockError});assert.equal(a.result.status,lockError==='FORWARD_TIME_INVALID'?'EXPIRED':'BLOCKED');assert.equal(a.result.reason,lockError);
  assert.equal(a.http.length,0);assert.equal(a.locked.length,0);assert(!a.calls.some(c=>c.op==='DUE_OUTCOMES'));assert.deepEqual(a.checkpoint,saved);
 }
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
 assert.equal(outcomes[0].data.result.net_return,null);assert.equal(a.locked.length,216);assert.deepEqual(a.checkpoint,saved);
});

test('SYNTHETIC due outcomes do not pin an empty snapshot before binding current-window cached prices',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 assert(warm&&cold);
 const observed='2026-10-11T23:50:00Z',bar={id:'synthetic-bar',symbol:warm.symbols[0],date:'2026-10-08',
  open:100,high:102,low:99,close:101,volume:1000,amount:101000,session_scope:'TWSE',source:warm.url,
  evidence_hash:'a'.repeat(64),published_at:null,first_seen_at:observed,available_at:observed,as_of:'2026-10-08T13:30:00+08:00'};
 const cached=await receipt(warm,observed,{rows:[bar]});
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[warm,cold],due:[{prediction,horizons:[1]}],unboundCache:[cached],entryLineage:{market}});
 assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.run.cursor,0);
 assert.equal(a.checkpoint.acquired.entry.stocks.find(s=>s.symbol===warm.symbols[0]).bars.length,1);
 assert(a.calls.findIndex(c=>c.op==='SOURCE_BEGIN'&&c.data.key===warm.key)<a.calls.findIndex(c=>c.op==='CHECKPOINT'&&c.data.acquired));
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
 assert.equal(a.locked.length,0);
 // An immutable older plan retains its cold-first cursor while warm tasks bind
 // via the independent durable prewarm checkpoint.
 const old=await runner({at,plan:[cold,warm],due:[{prediction,horizons:[1]}],unboundCache:[cached],entryLineage:{market}});
 assert.equal(old.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(old.run.cursor,0);
 assert.equal(old.checkpoint.acquired.entry.stocks.find(s=>s.symbol===warm.symbols[0]).bars.length,1);
 assert(old.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===warm.key));
 assert(!old.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
});

test('SYNTHETIC cold-first persisted plan resumes warm scan without skipping, duplication, or moving its original cursor',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const daily=await acquisitionPlan(date,companies),warm=daily.filter(t=>t.kind==='PRICE'&&t.month==='2026-10').slice(0,35);
 const cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10'),plan=[cold,...warm];
 const cached=await Promise.all(warm.map(t=>receipt(t,'2026-10-11T23:50:00Z')));
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan,due:[{prediction,horizons:[1]}],unboundCache:cached,entryLineage:{market}});
 assert.equal(a.result.reason,'PREWARM_CONTINUATION');assert.equal(a.run.cursor,0);assert.equal(a.checkpoint.prewarm_v1.next,32);
 assert.equal(a.calls.filter(c=>c.op==='SOURCE_BEGIN'&&warm.some(t=>t.key===c.data.key)).length,32);
 const next=await a.invoke();assert.equal(next.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.run.cursor,0);
 const keys=a.calls.filter(c=>c.op==='SOURCE_BEGIN'&&warm.some(t=>t.key===c.data.key)).map(c=>c.data.key);
 assert.equal(keys.length,35);assert.equal(new Set(keys).size,35);assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
 assert(a.checkpoint.acquired);
});

test('SYNTHETIC cold-first old plan resumes warm pass even when there are no due outcomes',async()=>{
 const at='2026-10-12T00:00:00Z',daily=await acquisitionPlan(date,companies);
 const warm=daily.filter(t=>t.kind==='PRICE'&&t.month==='2026-10').slice(0,35),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const cached=await Promise.all(warm.map(t=>receipt(t,'2026-10-11T23:50:00Z')));
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[cold,...warm],due:[],unboundCache:cached,entryLineage:{market}});
 assert.equal(a.result.reason,'PREWARM_CONTINUATION');assert.equal(a.checkpoint.prewarm_v1.next,32);assert.equal(a.run.cursor,0);
 const next=await a.invoke();assert.equal(next.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.run.cursor,0);
 const keys=a.calls.filter(c=>c.op==='SOURCE_BEGIN'&&warm.some(t=>t.key===c.data.key)).map(c=>c.data.key);
 assert.equal(keys.length,35);assert.equal(new Set(keys).size,35);assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===cold.key));
});

test('SYNTHETIC Nov 4 with 61 TWSE and 11 TPEX walks the complete current prefix under bounded continuations',async()=>{
 const businessDate='2026-11-04',at='2026-11-04T00:00:00Z';
 const universe=companies.map((c,i)=>({...c,exchange:i<61?'TWSE':'TPEX'}));
 const plan=await acquisitionPlan(businessDate,universe);
 const warm=plan.slice(0,173);assert.equal(plan.length,1421);
 assert.equal(warm.filter(t=>t.kind==='TWSE_PRICE_DAY').length,1);
 assert.equal(warm.filter(t=>t.kind==='PRICE').length,122);
 assert.equal(warm.filter(t=>t.kind==='OTC_PRICE').length,20);
 assert.equal(warm.filter(t=>t.kind==='BENCHMARK').length,2);
 assert.equal(warm.filter(t=>t.kind==='INSTITUTIONAL').length,20);
 assert.equal(warm.filter(t=>t.kind==='REVENUE').length,8);
 const cached=await Promise.all(warm.map(t=>receipt(t,'2026-11-03T23:50:00Z')));
 // The prediction's payload is a synthetic older lock, only used to create a
 // nonempty due queue. No market outcome or real issuer data are implied.
 const saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,businessDate,plan,due:[{prediction,horizons:[1]}],unboundCache:cached,entryLineage:{market}});
 let result=a.result,passes=1;
 while(result.reason==='PREWARM_CONTINUATION'){assert(passes<10);result=await a.invoke();passes++;}
 assert.equal(result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(passes,6);assert.equal(a.run.cursor,0);
 const calls=a.calls.filter(c=>c.op==='SOURCE_BEGIN'&&warm.some(t=>t.key===c.data.key));
 assert.equal(calls.length,173);assert.equal(new Set(calls.map(c=>c.data.key)).size,173);
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===plan[173].key));
});

test('SYNTHETIC prewarm does not reserve a later financial/event task; a previously bound proved YTD row is only retained as YTD',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const daily=await acquisitionPlan(date,companies),warm=daily.find(t=>t.kind==='PRICE'&&t.month==='2026-10'),financial=daily.find(t=>t.kind==='FINANCIAL_YTD'),event=daily.find(t=>t.kind==='EVENT');
 const cached=await receipt(warm,'2026-10-11T23:50:00Z');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const c=companies.find(x=>financial.symbols.includes(x.symbol)),period=`${financial.year}-Q${financial.quarter}`;
 const fact={symbol:c.symbol,kind:'FINANCIAL_YTD',period,as_of:'2026-06-30T23:59:59+08:00',values:{eps:3},basis:'AS_REPORTED_YTD',
  id:'synthetic-ytd',source:financial.url,published_at:null,first_seen_at:at,available_at:at,evidence_hash:'a'.repeat(64),
  source_period:{year:financial.year,quarter:financial.quarter},period_verification:'RESPONSE_REPORT_HEADING_MATCHED_REQUEST',standalone_quarter_actual:false};
 for(const bound of [false,true]){
  const a=await runner({at,plan:[warm,financial,event],due:[{prediction,horizons:[1]}],unboundCache:[cached],additionalSources:bound?[await receipt(financial,at,{rows:[fact]})]:[],entryLineage:{market}});
  assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert(!a.calls.some(x=>x.op==='SOURCE_BEGIN'&&[financial.key,event.key].includes(x.data.key)));
  const input=a.checkpoint.acquired.inputs.find(x=>x.symbol===c.symbol),rows=input.facts.filter(f=>f.id===fact.id);
  assert.equal(rows.length,bound?1:0);if(bound){assert.equal(rows[0].basis,'AS_REPORTED_YTD');assert.notEqual(rows[0].kind,'EPS');}
  assert.equal(a.checkpoint.acquired.entry.stocks.find(x=>x.symbol===c.symbol).events_reviewed,null);
 }
});

test('SYNTHETIC transient failure retries after SQL-style backoff and binds the successful second receipt before cutoff',async()=>{
 const at='2026-10-12T00:00:00Z';let now=at;
 const saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const warm=(await acquisitionPlan(date,companies)).filter(t=>t.kind==='PRICE'&&t.month==='2026-10').slice(0,2);
 const cached=await receipt(warm[1],'2026-10-11T23:50:00Z');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,clock:()=>now,plan:warm,due:[{prediction,horizons:[1]}],unboundCache:[cached],simulateSqlReservations:true,providerStatuses:[503,200],entryLineage:{market}});
 assert.equal(a.result.reason,'PREWARM_RETRY_PENDING');assert.equal(a.sqlReservations.get(warm[0].key).attempts,1);
 assert(a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===warm[1].key));assert(!a.checkpoint.acquired);
 now='2026-10-12T00:00:03Z';const result=await a.invoke();assert.equal(result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.sqlReservations.get(warm[0].key).attempts,2);assert.equal(a.stored.filter(s=>s.task.key===warm[0].key).length,1);
 assert(Date.parse(a.stored[0].available_at)<=Date.parse(a.checkpoint.acquired.evidence_cutoff));
 assert.equal(a.calls.filter(c=>c.op==='SOURCE_SAVE').length,1);assert.equal(a.run.cursor,0);
});

test('SYNTHETIC exhausted three-attempt source and elapsed retry window permit partial forward progress without invented evidence',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const warm=(await acquisitionPlan(date,companies)).find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 let now=at;const a=await runner({at,clock:()=>now,plan:[warm],due:[{prediction,horizons:[1]}],simulateSqlReservations:true,providerStatus:503,entryLineage:{market}});
 assert.equal(a.result.reason,'PREWARM_RETRY_PENDING');
 now='2026-10-12T00:00:03Z';assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');
 now='2026-10-12T00:00:06Z';assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');
 now='2026-10-12T00:00:09Z';assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.sqlReservations.get(warm.key).attempts,3);assert.equal(a.http.length,3);assert.equal(a.stored.length,0);
 assert.equal(a.checkpoint.acquired.entry.stocks.find(s=>s.symbol===warm.symbols[0]).bars.length,0);
 assert.equal(a.locked.length,0);await a.invoke();assert.equal(a.locked.length,216);
 // A separate run with a never-ready mocked source stops waiting at its fixed
 // 660-second limit (a stress control, not a claim about SQL retry policy).
 now=at;const b=await runner({at,clock:()=>now,plan:[warm],due:[{prediction,horizons:[1]}],waitKeys:new Set([warm.key]),entryLineage:{market}});
 assert.equal(b.result.reason,'PREWARM_RETRY_PENDING');now='2026-10-12T00:11:00Z';
 assert.equal((await b.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(b.http.length,0);
});

test('SYNTHETIC two 300s SQL backoffs can resolve before the forward cutoff without rewriting the plan',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');let now=at;
 const warm=(await acquisitionPlan(date,companies)).find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,clock:()=>now,plan:[warm],due:[{prediction,horizons:[1]}],simulateSqlReservations:true,providerStatuses:[429,429,200],providerRetrySeconds:300,entryLineage:{market}});
 assert.equal(a.result.reason,'PREWARM_RETRY_PENDING');assert.equal(a.sqlReservations.get(warm.key).attempts,1);
 assert.equal(a.sqlReservations.get(warm.key).retryAt,Date.parse(at)+300000);
 now='2026-10-12T00:02:00Z';assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,1);assert(!a.checkpoint.acquired);
 now='2026-10-12T00:05:00Z';assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,2);
 now='2026-10-12T00:10:00Z';assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.sqlReservations.get(warm.key).attempts,3);assert.equal(a.stored.length,1);assert.equal(a.run.cursor,0);
 assert(Date.parse(a.stored[0].available_at)<=Date.parse(a.checkpoint.acquired.evidence_cutoff));
});

test('SYNTHETIC concurrent 300s backoffs do not block independent warm sources, with and without due outcomes',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const daily=await acquisitionPlan(date,companies),warm=daily.filter(t=>t.kind==='PRICE'&&t.month==='2026-10').slice(0,2),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 for(const due of [[{prediction,horizons:[1]}],[]]){
  let now=at;const a=await runner({at,clock:()=>now,plan:[cold,...warm],due,simulateSqlReservations:true,providerStatuses:[429,429,200,200],providerRetrySeconds:300,entryLineage:{market}});
  assert.equal(a.result.reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,2);assert.equal(a.checkpoint.prewarm_v1.deferred.length,2);assert.equal(a.run.cursor,0);
  now='2026-10-12T00:04:59Z';assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,2);assert(!a.checkpoint.acquired);
  now='2026-10-12T00:05:00Z';assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
  assert.equal(a.http.length,4);assert.equal(a.stored.length,2);assert.equal(a.run.cursor,0);
  assert(a.stored.every(s=>Date.parse(s.available_at)<=Date.parse(a.checkpoint.acquired.evidence_cutoff)));
 }
});

test('SYNTHETIC staggered provider backoff can postpone prewarm across 07:30 before outcome work',async t=>{
 const at='2026-10-11T23:20:00Z',clock=wallClock(t,at),saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const daily=await acquisitionPlan(date,companies),warm=daily.filter(t=>t.kind==='PRICE'&&t.month==='2026-10').slice(0,2),cold=daily.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,clock:()=>new Date(clock.now).toISOString(),providerSleep:async ms=>clock.advance(ms),plan:[cold,...warm],due:[{prediction,horizons:[1]}],simulateSqlReservations:true,providerStatuses:[429,429,429,200,200],providerRetrySeconds:300,entryLineage:{market}});
 assert.equal(a.result.reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,2);assert.equal(clock.now,Date.parse(at)+2500);
 clock.advance(Date.parse('2026-10-11T23:25:00Z')-clock.now);assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,3);
 clock.advance(Date.parse('2026-10-11T23:25:02.500Z')-clock.now);assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,4);
 assert.equal(a.stored.length,1);assert(!a.checkpoint.acquired);assert(!a.calls.some(c=>c.op==='OUTCOME'));
 clock.advance(Date.parse('2026-10-11T23:30:00Z')-clock.now);assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.stored.length,2);assert.equal(a.checkpoint.acquired.evidence_cutoff,'2026-10-11T23:30:00.000Z');
 // This only proves the isolated worker did not produce its snapshot before
 // 07:30; the report service and full outcome lifecycle are not exercised.
 assert(!a.calls.some(c=>c.op==='OUTCOME'));assert.equal(a.run.cursor,0);
});

test('fetchSource retains long Retry-After and supports HTTP-date without truncating provider waits',async()=>{
 const at='2026-10-12T00:00:00Z',task=(await acquisitionPlan(date,companies)).find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 async function observed(header){
  try{await fetchSource(task,async()=>new Response('',{status:429,headers:{'retry-after':header}}),()=>at,AbortSignal.timeout(3000));}
  catch(e){assert.equal(e.message,'RATE_LIMITED');return e.retryAfter;}
  assert.fail('RATE_LIMITED expected');
 }
 assert.equal(await observed('300'),300);
 assert.equal(await observed('Mon, 12 Oct 2026 00:05:00 GMT'),300);
 assert.equal(await observed('301'),301);
 assert.equal(await observed('3.5'),4);
});

test('SYNTHETIC fractional Retry-After rounds upward to a SQL-safe integer without earlier retry',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');let now=at;
 const warm=(await acquisitionPlan(date,companies)).find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,clock:()=>now,plan:[warm],due:[{prediction,horizons:[1]}],simulateSqlReservations:true,providerStatuses:[429,200],providerRetrySeconds:3.5,entryLineage:{market}});
 assert.equal(a.calls.find(c=>c.op==='SOURCE_FAIL').data.retry_seconds,4);
 assert.equal(a.sqlReservations.get(warm.key).retryAt,Date.parse(at)+4000);
 now='2026-10-12T00:00:03.500Z';assert.equal((await a.invoke()).reason,'PREWARM_RETRY_PENDING');assert.equal(a.http.length,1);
 now='2026-10-12T00:00:04Z';assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.http.length,2);
});

test('SYNTHETIC 300s SQL backoff never extends the 08:57 preparation reserve',async()=>{
 const at='2026-10-12T00:55:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');let now=at;
 const warm=(await acquisitionPlan(date,companies)).find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,clock:()=>now,plan:[warm],due:[{prediction,horizons:[1]}],simulateSqlReservations:true,providerStatus:429,providerRetrySeconds:300,entryLineage:{market}});
 assert.equal(a.result.reason,'PREWARM_RETRY_PENDING');assert.equal(a.sqlReservations.get(warm.key).retryAt,Date.parse(at)+300000);
 now='2026-10-12T00:57:00Z';assert.equal((await a.invoke()).reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.http.length,1);assert.equal(a.sqlReservations.get(warm.key).attempts,1);
 assert.equal(a.checkpoint.acquired.entry.stocks.find(s=>s.symbol===warm.symbols[0]).bars.length,0);
 assert.equal(a.checkpoint.acquired.evidence_cutoff,now);assert.equal(a.locked.length,0);
});

test('SYNTHETIC failed progress write replays the already bound receipt without moving cursor or duplicating it',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const warm=(await acquisitionPlan(date,companies)).find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 const cached=await receipt(warm,'2026-10-11T23:50:00Z');let fail=true;
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const a=await runner({at,plan:[warm],due:[{prediction,horizons:[1]}],unboundCache:[cached],entryLineage:{market},
  rpcErrorOp:op=>op==='CHECKPOINT'&&fail});
 assert.equal(a.result.reason,'DATABASE_RPC_REJECTED');assert.deepEqual(a.checkpoint,{});assert.equal(a.run.cursor,0);
 fail=false;const result=await a.invoke();assert.equal(result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.equal(a.calls.filter(c=>c.op==='SOURCE_BEGIN'&&c.data.key===warm.key).length,2);
 assert.equal(a.sources.filter(s=>s.task?.key===warm.key).length,1);
});

test('SYNTHETIC duplicate warm plan keys fail closed before source acquisition',async()=>{
 const at='2026-10-12T00:00:00Z',saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const warm=(await acquisitionPlan(date,companies)).find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 const a=await runner({at,plan:[warm,warm],due:[{prediction,horizons:[1]}]});
 assert.equal(a.result.reason,'PREWARM_PLAN_DUPLICATE');assert.equal(a.run.cursor,0);
 assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===warm.key));
});

test('SYNTHETIC prewarm corrupt checkpoint fails closed without fetching or advancing',async()=>{
 const saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const plan=(await acquisitionPlan(date,companies)).filter(t=>t.kind==='PRICE').slice(0,1);
 for(const prewarm_v1 of [{fingerprint:'0'.repeat(64),next:1},{fingerprint:'bad',next:-1}]){
  const a=await runner({at:'2026-10-12T00:00:00Z',plan,saved:{prewarm_v1},due:[{prediction,horizons:[1]}]});
  assert.equal(a.result.reason,'PREWARM_CHECKPOINT_INVALID');assert.equal(a.run.cursor,0);
  assert(!a.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===plan[0].key));
 }
});

test('SYNTHETIC due outcomes preserve premarket reserve and provider retry without advancing or backdating',async()=>{
 const saved=await checkpoint(),prediction=saved.locks.find(p=>p.horizon==='SHORT');
 const due=[{prediction,horizons:[1]}],plan=(await acquisitionPlan(date,companies)).filter(t=>t.kind==='PRICE').slice(0,1);
 const waiting=await runner({at:'2026-10-12T00:00:00Z',plan,due,providerWaitSeconds:60});
 assert.equal(waiting.result.reason,'PREWARM_RETRY_PENDING');assert.equal(waiting.run.cursor,0);
 assert.deepEqual(waiting.checkpoint.prewarm_v1.deferred,[0]);
 assert(!waiting.calls.some(c=>c.op==='CHECKPOINT'&&c.data.acquired||c.op==='PREDICTIONS'));
 assert.equal(waiting.calls.filter(c=>c.op==='SOURCE_BEGIN'&&c.data.key===plan[0].key).length,2);
 const at='2026-10-12T00:57:00Z',market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic',observed_at:at,available_at:at};
 const reserved=await runner({at,plan,due,cold:true,entryLineage:{market}});
 assert.equal(reserved.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(reserved.run.cursor,0);
 assert(!reserved.calls.some(c=>c.op==='SOURCE_BEGIN'&&c.data.key===plan[0].key));
 assert.equal(reserved.locked.length,0);
});

function wallClock(t,at='2026-10-12T00:02:00Z'){
 let now=Date.parse(at);t.mock.method(Date,'now',()=>now);
 return {get now(){return now;},advance:ms=>{now+=ms;}};
}
test('one rejected FINISH from queued, completed or blocked work returns uncertainty, never a false committed state',async t=>{
 const clock=wallClock(t),plan=(await acquisitionPlan(date,companies)).slice(0,1),saved=await checkpoint();
 for(const options of [{at:'2026-10-12T00:02:00Z',plan,cursor:1},{plan,cursor:1,saved},{plan,cursor:1,saved,lockError:'DATABASE_RPC_REJECTED'}]){
  const leaseUntil=new Date(clock.now+100000).toISOString(),a=await runner({...options,leaseUntil,finishError:'DATABASE_RPC_REJECTED'});
  assert.equal(a.result.status,'LEASE_RECOVERY_PENDING');assert.equal(a.result.reason,'FINISH_COMMIT_UNCONFIRMED');assert.equal(a.result.continue,true);
  assert.equal(a.result.lease_until,leaseUntil);assert.equal(Date.parse(a.result.not_before),clock.now+101000);
  assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);assert.equal(a.continuations.length,0);assert.equal(a.http.length,0);
  assert.notEqual(a.result.status,a.calls.find(c=>c.op==='FINISH').data.status);
 }
});
test('a confirmed FINISH keeps its original result even when a recovery-capable lease is present',async t=>{
 const clock=wallClock(t),plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,leaseUntil:new Date(clock.now+100000).toISOString()});
 assert.equal(a.result.status,'QUEUED');assert.equal(a.result.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(a.result.retry_after_seconds,30);
 assert.equal('not_before' in a.result,false);assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);assert.equal(a.continuations.length,0);
});
test('caught SOURCE_FAIL and FINISH failures preserve cursor and never retry uncertain writes inline',async t=>{
 const clock=wallClock(t),plan=(await acquisitionPlan(date,companies)).filter(t=>t.kind==='PRICE').slice(0,1);
 const a=await runner({at:'2026-10-12T00:02:00Z',plan,cold:true,providerStatus:503,rpcErrorOp:'SOURCE_FAIL',finishError:'DATABASE_RPC_REJECTED',leaseUntil:new Date(clock.now+100000).toISOString()});
 assert.equal(a.result.status,'LEASE_RECOVERY_PENDING');assert.equal(a.run.cursor,0);assert.equal(a.http.length,1);assert.equal(a.stored.length,0);assert.equal(a.locked.length,0);
 assert.equal(a.calls.filter(c=>c.op==='SOURCE_FAIL').length,1);assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);
 assert(!a.calls.some(c=>['CURSOR','PREDICTIONS','OUTCOME'].includes(c.op)));
});
test('handler waits out the claimed lease and hands off once after a 37-second FINISH failure',async t=>{
 const clock=wallClock(t),started=clock.now,plan=(await acquisitionPlan(date,companies)).slice(0,1);
 const a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,throughHandler:true,leaseUntil:new Date(started+100000).toISOString(),finishError:'DATABASE_RPC_REJECTED',onFinish:()=>clock.advance(37000),advanceSleep:clock.advance});
 assert.deepEqual(a.sleeps,[64000]);assert.equal(clock.now,started+101000);assert.deepEqual(a.continuations,[a.run.id]);
 assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);assert.equal(a.http.length,0);assert.equal(a.locked.length,0);
});
test('a worker clock ahead of DB still waits a full SQL lease after receiving the claim',async t=>{
 const clock=wallClock(t),started=clock.now,plan=(await acquisitionPlan(date,companies)).slice(0,1);
 const a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,throughHandler:true,leaseUntil:new Date(started+90000).toISOString(),finishError:'DATABASE_RPC_REJECTED',advanceSleep:clock.advance});
 assert.deepEqual(a.sleeps,[101000]);assert.equal(a.continuations.length,1);
});
test('claim response latency cannot move the full-lease recovery floor earlier',async t=>{
 const clock=wallClock(t),started=clock.now,plan=(await acquisitionPlan(date,companies)).slice(0,1);
 const a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,throughHandler:true,leaseUntil:new Date(started+100000).toISOString(),finishError:'DATABASE_RPC_REJECTED',
  onClaim:()=>clock.advance(5000),onFinish:()=>clock.advance(37000),advanceSleep:clock.advance});
 assert.deepEqual(a.sleeps,[64000]);assert.equal(clock.now,started+106000);assert.equal(a.continuations.length,1);
});
test('missing, non-ISO, expired or excessive claimed lease never creates a recovery fallback',async t=>{
 const clock=wallClock(t),plan=(await acquisitionPlan(date,companies)).slice(0,1);
 for(const leaseUntil of [undefined,null,0,'0','invalid','2026-10-12',new Date(clock.now-1).toISOString(),new Date(clock.now+100001).toISOString()]){
  await assert.rejects(()=>runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,leaseUntil,finishError:'DATABASE_RPC_REJECTED'}),/DATABASE_RPC_REJECTED/);
  const a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,leaseUntil,finishError:'DATABASE_RPC_REJECTED',throughHandler:true});
  assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);assert.deepEqual(a.sleeps,[]);assert.deepEqual(a.continuations,[]);
 }
});
test('non-acquired claims and rejected claims cannot enter lease recovery',async t=>{
 const clock=wallClock(t);
 for(const claimStatus of ['BUSY','NOT_FOUND','DATE_EXPIRED','BUDGET_EXHAUSTED']){
  const a=await runner({claimStatus,leaseUntil:new Date(clock.now+100000).toISOString(),throughHandler:true,finishError:'DATABASE_RPC_REJECTED'});
  assert.equal(a.calls.length,0);assert.deepEqual(a.continuations,[]);assert.deepEqual(a.sleeps,[]);
 }
 const a=await runner({claimError:'DATABASE_RPC_REJECTED',throughHandler:true});assert.equal(a.calls.length,0);assert.deepEqual(a.continuations,[]);
});
test('insufficient budget, early wake or late wake never triggers an early or unbounded handoff',async t=>{
 const clock=wallClock(t),plan=(await acquisitionPlan(date,companies)).slice(0,1);
 for(const mode of ['late_failure','early_wake','late_wake']){
  const started=clock.now,a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,throughHandler:true,leaseUntil:new Date(started+100000).toISOString(),finishError:'DATABASE_RPC_REJECTED',
   onFinish:()=>{if(mode==='late_failure')clock.advance(116000);},advanceSleep:ms=>{if(mode==='late_wake')clock.advance(ms+20000);}});
  assert.equal(a.continuations.length,0);assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);
  assert.equal(a.sleeps.length,mode==='late_failure'?0:1);
 }
});
test('FINISH uncertainty never shortens provider backoff; 300 seconds remains outside this background budget',async t=>{
 const clock=wallClock(t),plan=(await acquisitionPlan(date,companies)).slice(0,1);
 for(const providerWaitSeconds of [60,300]){
  const started=clock.now,a=await runner({at:'2026-10-12T00:02:00Z',plan,throughHandler:true,providerWaitSeconds,leaseUntil:new Date(started+100000).toISOString(),finishError:'DATABASE_RPC_REJECTED',advanceSleep:clock.advance});
  assert.equal(a.http.length,0);assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);
  if(providerWaitSeconds===60){assert.deepEqual(a.sleeps,[101000]);assert.equal(a.continuations.length,1);assert(clock.now>=started+60000);}
  else{assert.deepEqual(a.sleeps,[]);assert.deepEqual(a.continuations,[]);}
 }
});
test('a failed handoff is attempted only once, with no inline FINISH or provider replay',async t=>{
 const clock=wallClock(t),plan=(await acquisitionPlan(date,companies)).slice(0,1),a=await runner({at:'2026-10-12T00:02:00Z',plan,cursor:1,throughHandler:true,
  leaseUntil:new Date(clock.now+100000).toISOString(),finishError:'DATABASE_RPC_REJECTED',advanceSleep:clock.advance,continuationError:'VNEXT_CONTINUATION_HTTP_503'});
 assert.equal(a.continuations.length,1);assert.equal(a.calls.filter(c=>c.op==='FINISH').length,1);assert.equal(a.http.length,0);assert.equal(a.locked.length,0);
});

// Cached/exhausted RPC work is bounded independently of provider fetches.
const id='00000000-0000-4000-8000-000000000001';
function cachedAcquisitionFixture({cursor=0,total=1358,mode='CACHE',clock='2026-10-28T00:00:00Z'}={}){
 const plan=Array.from({length:total},(_,i)=>({key:'task-'+i,kind:'PRICE',url:'https://www.twse.com.tw/test/'+i,format:'json',scope:'TEST',symbols:['2330'],max_age_days:7}));
 const run={id,business_date:'2026-10-28',actionable_at:'2026-10-28T01:00:00Z',lease:'test',fence:0,plan,checkpoint:{},cursor};
 const sourceCalls=[],cursorWrites=[],finishWrites=[],other=[];
 const companies=RECOMMENDATION_UNIVERSE.map((symbol,i)=>({symbol,company:'Synthetic '+symbol,industry:'TEST',exchange:i<61?'TWSE':'TPEX'}));
 const ports={clock:()=>clock,sleep:async()=>{},fetcher:()=>{throw Error('NETWORK_FORBIDDEN');},rpc:async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1'){run.fence++;return {status:'ACQUIRED',run:structuredClone({...run,lease_until:new Date(Date.now()+99000).toISOString()})};}
  assert.equal(name,'vnext_daily_runtime_v1');assert.equal(args.p_fence,run.fence);
  const op=args.p_op,d=args.p_data;
  if(op==='DUE_OUTCOMES')return [];
  if(op==='SOURCE_BEGIN'){
   if(d.kind==='DIRECTORY')return {status:'CACHE',receipt:{status:'OK',task:d,payload:{rows:companies.filter(c=>c.exchange===d.exchange)}}};
   sourceCalls.push(d.key);
   if(mode==='WAIT_RETRY')return {status:mode,retry_at:'2026-10-28T00:01:00Z'};
   return mode==='CACHE'?{status:mode,receipt:{status:'OK',task:d,payload:{rows:[]}}}:{status:mode};
  }
  if(op==='CURSOR'){assert.equal(d.cursor,run.cursor+1);run.cursor=d.cursor;cursorWrites.push(d.cursor);return {status:'STORED'};}
  if(op==='FINISH'){finishWrites.push(d);return {status:'STORED'};}
  if(op==='SOURCES'){other.push(op);return [];}
  if(op==='ENTRY_SOURCE'){other.push(op);return {};}
  throw Error('UNEXPECTED_'+op);
 }};
 return {run,ports,sourceCalls,cursorWrites,finishWrites,other};
}
test('bounded cached acquisition: cached acquisition yields after bounded work with a durable cursor and no evaluation writes',async()=>{
 const f=cachedAcquisitionFixture();const result=await workDailyRun(id,f.ports);
 assert.equal(result.reason,'ACQUISITION_CONTINUATION');assert.equal(result.continue,true);
 assert.equal(f.run.cursor,32);assert.equal(f.sourceCalls.length,32);assert.deepEqual(f.other,[]);
 assert.deepEqual(f.finishWrites,[{status:'QUEUED',reason:'ACQUISITION_CONTINUATION'}]);
});
test('bounded cached acquisition: successive leases resume at the saved cursor without refetching or skipping cached tasks',async()=>{
 const f=cachedAcquisitionFixture({cursor:1239});await workDailyRun(id,f.ports);await workDailyRun(id,f.ports);
 assert.equal(f.run.cursor,1303);assert.equal(new Set(f.sourceCalls).size,64);
 assert.deepEqual(f.sourceCalls,Array.from({length:64},(_,i)=>'task-'+(1239+i)));
 assert.deepEqual(f.cursorWrites,Array.from({length:64},(_,i)=>1240+i));
 assert.equal(f.run.actionable_at,'2026-10-28T01:00:00Z');assert.deepEqual(f.run.checkpoint,{});
});
test('bounded cached acquisition: exhausted source tasks also yield instead of permitting unbounded cache-free traversal',async()=>{
 const f=cachedAcquisitionFixture({mode:'EXHAUSTED'});const result=await workDailyRun(id,f.ports);
 assert.equal(result.reason,'ACQUISITION_CONTINUATION');assert.equal(f.run.cursor,32);assert.equal(f.sourceCalls.length,32);
});
test('bounded cached acquisition: provider retry deadline remains authoritative and does not advance the cursor',async()=>{
 const f=cachedAcquisitionFixture({cursor:1239,mode:'WAIT_RETRY'});const result=await workDailyRun(id,f.ports);
 assert.equal(result.reason,'SOURCE_RETRY_PENDING');assert.equal(result.retry_after_seconds,60);assert.equal(f.run.cursor,1239);
 assert.deepEqual(f.cursorWrites,[]);assert.equal(f.sourceCalls.length,1);
});
test('bounded cached acquisition: the 180-second Forward preparation window still takes priority over acquisition batching',async()=>{
 const f=cachedAcquisitionFixture({cursor:1239,clock:'2026-10-28T00:57:00Z'});const result=await workDailyRun(id,f.ports);
 assert.equal(result.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(result.retry_after_seconds,30);
 assert.equal(f.run.cursor,1239);assert.deepEqual(f.sourceCalls,[]);assert.deepEqual(f.other,['SOURCES','ENTRY_SOURCE']);
});
test('bounded cached acquisition: final task at the batch boundary proceeds to Canonical without a redundant lease',async()=>{
 const f=cachedAcquisitionFixture({cursor:1326});const result=await workDailyRun(id,f.ports);
 assert.equal(f.run.cursor,1358);assert.equal(f.sourceCalls.length,32);
 assert.equal(result.reason,'CANONICAL_PUBLICATION_PENDING');assert.equal(result.retry_after_seconds,30);
 assert.deepEqual(f.other,['SOURCES','ENTRY_SOURCE']);
});
test('bounded cached acquisition: a fully cached late plan drains without creating or backdating predictions',async()=>{
 const f=cachedAcquisitionFixture({cursor:1239,clock:'2026-10-28T01:01:00Z'});let result,leases=0;
 while(f.run.cursor<1358){assert(leases<4);result=await workDailyRun(id,f.ports);leases++;}
 assert.equal(leases,4);assert.equal(f.sourceCalls.length,119);assert.equal(new Set(f.sourceCalls).size,119);
 assert.equal(result.status,'EXPIRED');assert.equal(result.reason,'LATE_ACQUISITION_NOT_FORWARD');
 assert.equal(result.continue,false);assert.deepEqual(f.other,[]);assert.deepEqual(f.run.checkpoint,{});
});

const indexURL='https://openapi.twse.com.tw/v1/indicesReport/MI_5MINS_HIST';
async function indexFixture(){
 const business='2026-10-29',at='2026-10-29T00:58:00.000000Z',plan=await acquisitionPlan(business,companies);
 const task=plan.find(t=>t.url===indexURL),raw=[
  {Date:'1151027',OpeningIndex:'100',HighestIndex:'102',LowestIndex:'99',ClosingIndex:'100'},
  {Date:'1151028',OpeningIndex:'100',HighestIndex:'103',LowestIndex:'99',ClosingIndex:'102'}];
 const payload=await normalizeSource(task,raw,at),saved=await receipt(task,at,payload);
 const market={value:{direction:'偏多觀察',regime:'range'},source_ref:'synthetic-canonical',observed_at:at,available_at:at};
 return {business,at,task,raw,saved,market};
}
test('current benchmark uses documented TWSE OpenAPI while historical month requests remain explicit',async()=>{
 const f=await indexFixture(),plan=await acquisitionPlan(f.business,companies),benchmarks=plan.filter(t=>t.kind==='BENCHMARK');
 assert.equal(benchmarks.filter(t=>t.url===indexURL).length,1);assert.equal(f.task.month,'2026-10');
 assert.equal(f.task.benchmark_response_contract,'TWSE_OPENAPI_INDEX_V1');assert.equal(f.task.max_age_days,1);
 assert(benchmarks.filter(t=>t.month!=='2026-10').every(t=>t.url.includes('date='+t.month.replace('-','')+'01')&&!t.benchmark_response_contract));
 assert.equal(new Set(plan.map(t=>t.key)).size,plan.length);assert(plan.length<=1600);
});
test('OpenAPI index validates native fields, source binding, period and complete session before normalization',async()=>{
 const f=await indexFixture();assert.equal(f.saved.payload.rows[1].close,102);assert.equal(f.saved.payload.rows[1].source,indexURL);
 assert.equal(f.saved.payload.rows[1].published_at,null);assert.equal(f.saved.payload.rows[1].first_seen_at,f.at);
 for(const mutate of [x=>x.push({...x[0],extra:'unreviewed'}),x=>x[0].ClosingIndex=100,x=>delete x[0].OpeningIndex,
  x=>x[0].Date='1150928',x=>x[1].HighestIndex='1',x=>x[1].Date='1151030']){
  const raw=structuredClone(f.raw);mutate(raw);await assert.rejects(()=>normalizeSource(f.task,raw,f.at),/BENCHMARK_/);
 }
 for(const task of [{...f.task,url:'https://example.test/index'},{...f.task,benchmark_response_contract:undefined}])
  await assert.rejects(()=>normalizeSource(task,f.raw,f.at),/BENCHMARK_OPENAPI_SCHEMA/);
 await assert.rejects(()=>normalizeSource(f.task,[],f.at),/BENCHMARK_OPENAPI_SCHEMA/);
});
test('complete official sessions enrich missing market change without V2, preserving direction, cutoff and input ownership',async()=>{
 const f=await indexFixture(),before=structuredClone(f),a=await assembleDaily(f.business,companies,[f.saved],f.at,f.market);
 assert(Math.abs(a.entry.market.value.change_percent-2)<1e-10);assert.equal(a.entry.market.value.direction,f.market.value.direction);
 assert.equal(a.entry.market.value.regime,f.market.value.regime);assert.equal(a.entry.evaluation_time,f.at);
 assert(a.entry.market.source_ref.includes('benchmark-2026-10-27:'));assert(a.entry.market.source_ref.includes('benchmark-2026-10-28:'));
 assert.deepEqual(f,before);assert(a.entry.stocks.every(s=>s.relative_strength===null&&s.sector_return===null&&s.events_reviewed===null));
 const legacy=structuredClone(f.saved);delete legacy.task.benchmark_response_contract;
 legacy.task.url='https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date=20261001&response=json';
 for(const row of legacy.payload.rows)row.source=legacy.task.url;legacy.payload_hash=await snapshotHash(legacy.payload);
 const equal=await assembleDaily(f.business,companies,[f.saved,legacy],f.at,f.market);
 assert(Math.abs(equal.entry.market.value.change_percent-2)<1e-10);assert(equal.entry.market.source_ref.includes(legacy.task.url));
 legacy.payload.rows[0].close=101;legacy.payload_hash=await snapshotHash(legacy.payload);
 assert.deepEqual((await assembleDaily(f.business,companies,[f.saved,legacy],f.at,f.market)).entry.market,f.market,'conflicting official versions are not silently selected');

 const absent=await assembleDaily(f.business,companies,[f.saved],f.at);assert.equal(absent.entry.market,null);
 const explicit={...f.market,value:{...f.market.value,change_percent:4}};
 assert.deepEqual((await assembleDaily(f.business,companies,[f.saved],f.at,explicit)).entry.market,explicit);
});
test('partial, duplicate, wrong-scope and malformed official sessions cannot supply missing market change',async()=>{
 const f=await indexFixture();
 for(const mutate of [r=>r.payload.rows.pop(),r=>r.payload.rows.push({...r.payload.rows[0]}),
  r=>r.payload.rows[0].source='https://example.test/index',r=>r.payload.rows[0].session_scope='UNKNOWN',
  r=>r.payload.rows[0].evidence_hash='bad',r=>r.payload.rows[0].first_seen_at='2999-01-01T00:00:00Z']){
  const r=structuredClone(f.saved);mutate(r);r.payload_hash=await snapshotHash(r.payload);
  assert.deepEqual((await assembleDaily(f.business,companies,[r],f.at,f.market)).entry.market,f.market);
 }
 for(const value of [null,'2']){const m={...f.market,value:{...f.market.value,change_percent:value}};
  assert.deepEqual((await assembleDaily(f.business,companies,[f.saved],f.at,m)).entry.market,m,'never repair an explicit invalid market value');}
});
test('official index availability honors PostgreSQL microseconds and never uses a later receipt to enrich earlier Canonical',async()=>{
 const f=await indexFixture(),cutoff='2026-10-29T00:58:00.000000Z',later='2026-10-29T00:58:00.000001Z';
 const r=structuredClone(f.saved);r.first_seen_at=later;r.available_at=later;
 for(const b of r.payload.rows){b.first_seen_at=later;b.available_at=later;}r.payload_hash=await snapshotHash(r.payload);
 assert.deepEqual((await assembleDaily(f.business,companies,[r],cutoff,f.market)).entry.market,f.market);
 const m={...f.market,observed_at:later,available_at:later};
 assert.deepEqual((await assembleDaily(f.business,companies,[f.saved],cutoff,m)).entry.market,m);
});

test('worker preserves verified official market evidence when an optional V2 capsule lacks its quote',async()=>{
 const f=await indexFixture(),evidence=v2Fixture(f.at);evidence.data.quotes=[];
 const hash=await v2Hash(evidence);
 const before=structuredClone(evidence),lineage={market:f.market,evidence,hash};
 const prior=await entryInputFromV2(evidence,hash,f.market,'FORWARD','REAL_RETAINED');
 assert.equal(prior.market,null,'control must exercise the missing eligible V2 market quote');
 const a=await runner({at:f.at,businessDate:f.business,additionalSources:[f.saved],entryLineage:lineage});
 assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 const acquired=a.checkpoint.acquired;
 assert(Math.abs(acquired.entry.market?.value.change_percent-2)<1e-10);
 assert.equal(acquired.entry.market.value.direction,f.market.value.direction);
 assert.equal(acquired.entry.market.value.regime,f.market.value.regime);
 assert(acquired.entry.market.source_ref.includes('benchmark-2026-10-28:'));
 assert.deepEqual(acquired.entry.stocks.map(s=>s.events_reviewed),prior.stocks.map(s=>s.events_reviewed));
 const {snapshot_hash,...body}=acquired;assert.equal(snapshot_hash,await snapshotHash(body));
 assert.deepEqual(evidence,before);assert.equal(a.http.length,0);assert.equal(a.locked.length,0);
 const pinned=structuredClone(acquired);lineage.hash='0'.repeat(64);
 await a.invoke();assert.deepEqual(a.checkpoint.acquired,pinned,'resume must retain the exact original snapshot');
});

test('worker keeps a validated V2 market quote authoritative over the previous-session index fallback',async()=>{
 const f=await indexFixture(),evidence=v2Fixture(f.at);
 evidence.data.quotes.at(-1).change_percent=3;
 const hash=await v2Hash(evidence),expected=await entryInputFromV2(evidence,hash,f.market,'FORWARD','REAL_RETAINED');
 assert.equal(expected.market?.value.change_percent,3);
 const a=await runner({at:f.at,businessDate:f.business,additionalSources:[f.saved],entryLineage:{market:f.market,evidence,hash}});
 assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 assert.deepEqual(a.checkpoint.acquired.entry.market,expected.market);
});

test('worker does not let unrelated historical TAIEX rows or a report-date alias erase the exact official-session fallback',async()=>{
 const f=await indexFixture();
 for(const quotes of [
  i=>[{...i.data.quotes.at(-1),trading_date:'2026-10-27',captured_at:'2026-10-27T05:30:00Z',ingested_at:'2026-10-27T06:00:00Z',raw_payload:{}}],
  i=>[{...i.data.quotes.at(-1),phase:'premarket',trading_date:'2026-10-28',captured_at:'2026-10-27T16:00:00Z',ingested_at:'2026-10-28T23:00:00Z',raw_payload:{}}],
  i=>[{...i.data.quotes.at(-1),phase:'premarket',trading_date:f.business,raw_payload:{}},
   {...i.data.quotes.at(-1),id:'SYNTHETIC:OLDER',trading_date:'2026-10-27',captured_at:'2026-10-27T05:30:00Z',ingested_at:'2026-10-27T06:00:00Z',raw_payload:{}}],
 ]){
  const evidence=v2Fixture(f.at);evidence.data.quotes=quotes(evidence);const hash=await v2Hash(evidence),before=structuredClone(evidence);
  assert.equal((await entryInputFromV2(evidence,hash,f.market,'FORWARD','REAL_RETAINED')).market,null);
  const expected=(await assembleDaily(f.business,companies,[f.saved],f.at,f.market)).entry.market;
  const a=await runner({at:f.at,businessDate:f.business,additionalSources:[f.saved],entryLineage:{market:f.market,evidence,hash}});
  assert.deepEqual(a.checkpoint.acquired.entry.market,expected);
  assert(Math.abs(expected.value.change_percent-2)<1e-10);assert.deepEqual(evidence,before);
  assert.equal(a.locked.length,0,'fresh acquisition never rewrites an existing Forward lock');
 }
});

test('worker fallback cannot repair missing official sessions, skip V2 hash validation, or invent Canonical',async()=>{
 const f=await indexFixture(),evidence=v2Fixture(f.at);evidence.data.quotes=[];
 const hash=await v2Hash(evidence);
 const absent=await runner({at:f.at,businessDate:f.business,entryLineage:{market:f.market,evidence,hash}});
 assert.deepEqual(absent.checkpoint.acquired.entry.market,f.market);
 assert.equal(absent.checkpoint.acquired.entry.market.value.change_percent,undefined);
 const bad=await runner({at:f.at,businessDate:f.business,additionalSources:[f.saved],entryLineage:{market:f.market,evidence,hash:'0'.repeat(64)}});
 assert.equal(bad.result.reason,'ENTRY_SOURCE_HASH_MISMATCH');assert.deepEqual(bad.checkpoint,{});assert.equal(bad.locked.length,0);
 const noCanonical=await runner({at:f.at,businessDate:f.business,additionalSources:[f.saved],entryLineage:{evidence,hash}});
 assert.equal(noCanonical.result.reason,'CANONICAL_PUBLICATION_PENDING');assert.deepEqual(noCanonical.checkpoint,{});
});

test('worker never hides invalid, conflicting or future V2 quotes behind the official index fallback',async()=>{
 const f=await indexFixture();
 for(const mutate of [
  i=>i.data.quotes.at(-1).change_percent=null,
  i=>i.data.quotes.push({...i.data.quotes.at(-1),id:'SYNTHETIC:CONFLICT',value:21000}),
  i=>i.data.quotes=[{...i.data.quotes.at(-1),captured_at:'2999-01-01T00:00:00Z',ingested_at:'2999-01-01T00:00:00Z'}],
  i=>i.data.quotes=[{...i.data.quotes.at(-1),trading_date:f.business,raw_payload:{evidence_session_date:'2026-10-28'},change_percent:null}],
  i=>i.data.quotes=[{...i.data.quotes.at(-1),trading_date:f.business,raw_payload:{source_raw:{evidence_session_date:'2026-10-28'}},captured_at:'2999-01-01T00:00:00Z',ingested_at:'2999-01-01T00:00:00Z'}],
 ]){
  const evidence=v2Fixture(f.at);mutate(evidence);const hash=await v2Hash(evidence);
  const rejected=await entryInputFromV2(evidence,hash,f.market,'FORWARD','REAL_RETAINED');
  assert.equal(rejected.market,null);
  const a=await runner({at:f.at,businessDate:f.business,additionalSources:[f.saved],entryLineage:{market:f.market,evidence,hash}});
  assert.equal(a.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(a.checkpoint.acquired.entry.market,null);
  assert.equal(a.locked.length,0);
 }
});

// Additive 1.1 runtime admission controls; existing acquired bytes remain authoritative.
test('1.1 runtime refuses an unprepared database before pinning new acquisition or predictions',async()=>{
 const r=await runner({entryVersion:ENTRY_PREMARKET_VERSION});
 assert.equal(r.result.status,'BLOCKED');assert.equal(r.result.reason,'ENTRY_VERSION_DATABASE_NOT_READY');
 assert.equal(r.locked.length,0);assert(!r.calls.some(c=>c.op==='CHECKPOINT'||c.op==='PREDICTIONS'));
});
test('1.1 capability pins the version inside the acquired hash and resumes it into 216 current-version locks',async()=>{
 const r=await runner({at:'2026-10-12T00:59:30Z',entryVersion:ENTRY_PREMARKET_VERSION,entryLineage:{entry_versions:[ENTRY_VERSION,ENTRY_PREMARKET_VERSION]}});
 assert.equal(r.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 const pinned=structuredClone(r.checkpoint.acquired);assert.equal(pinned.entry_version,ENTRY_PREMARKET_VERSION);
 const {snapshot_hash,...body}=pinned;assert.equal(snapshot_hash,await snapshotHash(body));
 await r.invoke();assert.deepEqual(r.checkpoint.acquired,pinned);assert.equal(r.locked.length,216);
 for(const {body:lock} of r.locked){assert.equal(lock.entry_version,ENTRY_PREMARKET_VERSION);assert(await verifyDailyLock(lock));
  assert(lock.entry.every(e=>e.strategy_version===e.strategy+'_1.1.0'));}
});
test('deploying 1.1 cannot rewrite an already acquired legacy capsule or upgrade its eventual locks',async()=>{
 const old=await runner({at:'2026-10-12T00:59:30Z'});assert.equal(old.result.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 const pinned=structuredClone(old.checkpoint.acquired);assert.equal(pinned.entry_version,undefined);
 const next=await runner({at:'2026-10-12T00:59:30Z',saved:old.checkpoint,entryVersion:ENTRY_PREMARKET_VERSION});
 assert.equal(next.locked.length,216);assert.deepEqual(next.checkpoint.acquired,pinned);
 assert(next.locked.every(row=>row.body.entry_version===ENTRY_VERSION));assert(!next.calls.some(c=>c.op==='ENTRY_SOURCE'));
});
