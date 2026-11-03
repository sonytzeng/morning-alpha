/** In-memory RPC and normalized quote controls. No Production calls or Forward evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {acquisitionPlan,directoryPlan,normalizeSource,ADAPTER_VERSION} from '../src/features/vnext/dailyAdapter.ts';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {verifyDailyLock} from '../src/features/vnext/dailyIntelligence.ts';
import {retainedIssuerFinancialReleases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
import {retainedIssuerDocumentedReviews} from '../supabase/functions/_shared/retained-documented-reviews.ts';
import {ENTRY_VERSION,ENTRY_PREMARKET_VERSION} from '../research/entry-opportunity.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const business='2026-11-03',at='2026-11-03T00:59:30.000Z';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成隔離控制 '+symbol,exchange:'TWSE',industry:'24'}));
const receipt=async(task,payload)=>({task,payload,version:ADAPTER_VERSION,status:'OK',reason:null,
 first_seen_at:at,available_at:at,published_at:null,as_of:at,raw_hash:await snapshotHash(payload),payload_hash:await snapshotHash(payload)});

test('new runtime assembles financials and fresh reviews into1.1, while continuation preserves the exact acquired bytes',async()=>{
 let tick=Date.parse(at);const clock=()=>new Date(tick++).toISOString();
 const directories=await directoryPlan(business),sources=[];
 for(const task of directories)sources.push(await receipt(task,{rows:task.exchange==='TWSE'?companies:[]}));
 const price=(await acquisitionPlan(business,companies)).find(t=>t.kind==='PRICE'&&t.symbols[0]==='2330'&&t.month==='2026-11');
 const payload=await normalizeSource(price,{stat:'OK',date:'20261101',title:'115年11月 2330 台積電各日成交資訊',
  fields:['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],data:[['115/11/02','41,165,068','95,950,896,264','2,310.00','2,345.00','2,310.00','2,330.00']]},at);
 sources.push(await receipt(price,payload));
 const calls=[],locks=[],run={id:'isolated-policy-run',business_date:business,actionable_at:business+'T09:00:00+08:00',lease:'isolated',fence:1,plan:[price],cursor:1,checkpoint:{}};
 const financials=structuredClone(retainedIssuerFinancialReleases),review=structuredClone(retainedIssuerDocumentedReviews);
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1')return {status:'ACQUIRED',run};
  const op=args.p_op,data=args.p_data;calls.push(op);
  if(op==='DUE_OUTCOMES')return [];
  if(op==='SOURCE_BEGIN'){const r=sources.find(r=>r.task.key===data.key);assert(r);return {status:'CACHE',receipt:r};}
  if(op==='SOURCES')return sources;
  if(op==='ENTRY_SOURCE')return {entry_versions:[ENTRY_VERSION,ENTRY_PREMARKET_VERSION]};
  if(op==='CHECKPOINT'){run.checkpoint=structuredClone(data);return {};}
  if(op==='PREDICTIONS'){locks.push(...structuredClone(data));return {};}
  if(op==='FINISH')return {};
  throw Error('UNEXPECTED_TEST_RPC_'+op);
 };
 const ports={rpc,clock,issuerFinancials:financials,issuerDocumentedReviews:review,entryVersion:ENTRY_PREMARKET_VERSION,sleep:async()=>{},fetcher:async()=>{throw Error('NO_HTTP_EXPECTED');}};
 const first=await workDailyRun(run.id,ports);assert.equal(first.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');
 const pinned=structuredClone(run.checkpoint.acquired),stock=pinned.inputs.find(i=>i.symbol==='2330'),reviewFacts=stock.facts.filter(f=>['DEMAND','MOAT','VALUATION'].includes(f.kind));
 assert.equal(reviewFacts.length,3);assert.equal(pinned.entry_version,ENTRY_PREMARKET_VERSION);
 assert(pinned.evidence_cutoff>at);assert(pinned.inputs.every(i=>i.cutoff===pinned.evidence_cutoff));assert.equal(pinned.entry.evaluation_time,pinned.evidence_cutoff);
 const {snapshot_hash,...body}=pinned;assert.equal(snapshot_hash,await snapshotHash(body));
 assert(reviewFacts.every(f=>f.reviewed_at===review.packet.reviewed_at&&f.evaluated_at>f.reviewed_at&&f.available_at===f.evaluated_at&&f.available_at<=pinned.evidence_cutoff));
 financials.forEach(b=>b.expectedHash='0'.repeat(64));review.expectedHash='0'.repeat(64);
 const marker=calls.length;await workDailyRun(run.id,ports);
 assert.deepEqual(run.checkpoint.acquired,pinned);assert.equal(locks.length,216);
 assert(!calls.slice(marker).some(op=>op==='SOURCES'||op==='ENTRY_SOURCE'));
 for(const {body:lock} of locks){assert.equal(lock.entry_version,ENTRY_PREMARKET_VERSION);assert.equal(lock.evidence_cutoff,pinned.evidence_cutoff);assert(await verifyDailyLock(lock));}
 const long=locks.find(l=>l.body.symbol==='2330'&&l.body.horizon==='LONG').body;
 assert.equal(long.research.evaluated,true);assert.equal(long.research.state,'REJECTED');assert.deepEqual(long.research.reasons,['VALUATION:NOT_SUPPORTED']);
});
