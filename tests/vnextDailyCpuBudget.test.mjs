import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash,sharedEntryEvidenceHashes} from '../src/features/vnext/contracts.ts';
import {runDailyIntelligence,verifyDailyLock} from '../src/features/vnext/dailyIntelligence.ts';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {directoryPlan} from '../src/features/vnext/dailyAdapter.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

// Synthetic workload controls only. No provider, database or business request.
const date='2026-10-20',at='2026-10-20T00:00:00.000Z',source='https://example.test/synthetic-cpu-control';
function inputs(count=64){
 const dates=['2026-10-19'];while(dates.length<count)dates.unshift(previousMarketTradingDate('TW',dates[0]));
 return RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成CPU控制'+symbol,cutoff:at,through:'2026-10-19',next_session:date,expected_sessions:dates,
  bars:dates.map(d=>({id:'bar-'+symbol+'-'+d,symbol,date:d,source,evidence_hash:'a'.repeat(64),published_at:null,first_seen_at:at,available_at:at,as_of:d+'T13:30:00+08:00',open:100,high:105,low:99,close:103,volume:1000000,amount:100000000,session_scope:'SYNTHETIC'})),facts:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
}
async function acquired(){
 const i=inputs(20),entry={business_date:date,evaluation_time:at,source_revision:'b'.repeat(64),source_evidence_hash:'c'.repeat(64),market:null,provenance:'SYNTHETIC_TEST',mode:'FORWARD',
  stocks:i.map(s=>({symbol:s.symbol,name:s.company,bars:s.bars.map(b=>({...b,source_ref:b.source})),fundamental:null,relative_strength:null,sector_return:null,events_reviewed:null,v2_status:null}))};
 const body={inputs:i,entry,evidence_cutoff:at};return {...body,snapshot_hash:await snapshotHash(body)};
}
test('shared entry hashing preserves every original canonical hash, including numeric keys and Unicode',async()=>{
 const rows=[null,{symbol:'2330',values:{'10':'十','2':'二','1':'一'},text:'\ud800'},[true,false,0,-0,1.25,'台灣']],entry={stocks:rows};
 assert.deepEqual(await sharedEntryEvidenceHashes(rows,entry),await Promise.all(rows.map(input=>snapshotHash({input,entry}))));
 entry.stocks=[{changed:true}];assert.deepEqual(await sharedEntryEvidenceHashes(rows,entry),await Promise.all(rows.map(input=>snapshotHash({input,entry}))));
 for(const bad of [undefined,NaN,Infinity,()=>{}])await assert.rejects(()=>sharedEntryEvidenceHashes([bad],null),/NON_CANONICAL_VALUE/);
});
test('durable preparation yields resume identical216 locks without reacquisition or weaker hashes',async()=>{
 const a=await acquired(),request={business_date:date,checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'SYNTHETIC_CONTROL',core_ready:true,core_busy:false,source_revision:a.snapshot_hash,source_hash:a.snapshot_hash,actionable_at:date+'T09:00:00+08:00'};
 const run=async chunked=>{let saved=null,acquisitions=0,commits=0;const ports={acquire:async()=>{acquisitions++;return a;},clock:()=>at,outcomes:async()=>({}),publication:async()=>({})};
  const store={exclusive:async(_,work)=>work(),load:async()=>saved,save:async s=>{saved=structuredClone(s);},lock:async()=>{commits++;}};let result,invocations=0;
  do{result=await runDailyIntelligence(request,store,ports,20000,chunked);invocations++;assert(invocations<=4);if(result.state==='BUDGET_YIELDED')assert.equal(saved.locks,undefined);}while(result.state==='BUDGET_YIELDED');
  assert.equal(result.state,'COMPLETE');assert.equal(acquisitions,1);assert.equal(commits,1);return {saved,invocations};};
 const one=await run(false),chunked=await run(true);assert.equal(chunked.invocations,4);assert.deepEqual(chunked.saved.locks,one.saved.locks);
 for(const lock of chunked.saved.locks){assert(await verifyDailyLock(lock));const input=a.inputs.find(i=>i.symbol===lock.symbol);assert.equal(lock.evidence_hash,await snapshotHash({input,entry:a.entry}));}
});
test('large runtime saves original input once and resumes stages without source RPC or reset',async()=>{
 const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'合成CPU控制'+symbol,exchange:'TWSE',industry:'24'}));
 const receipt=async(task,payload)=>({task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:'a'.repeat(64),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null});
 const dirs=await directoryPlan(date),cache=new Map(await Promise.all(dirs.map(async t=>[t.key,await receipt(t,{rows:t.exchange==='TWSE'?companies:[]})])));
 const price=await receipt({kind:'PRICE'}, {rows:inputs().flatMap(i=>i.bars)});
 const run={id:'synthetic-run',business_date:date,actionable_at:date+'T09:00:00+08:00',lease:'synthetic-lease',fence:1,plan:[{kind:'PRICE'}],cursor:1,checkpoint:{}};
 let sourceRevision=null,sourceReads=0,entryReads=0,committed=0;const savedStages=[],committedHashes=[];
 const ports={clock:()=>at,sleep:async()=>{},fetcher:async()=>{throw Error('NO_NETWORK_ALLOWED');},rpc:async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1')return {status:'ACQUIRED',run:structuredClone(run)};
  const op=args.p_op,data=args.p_data;
  if(op==='SOURCE_BEGIN')return {status:'CACHE',receipt:cache.get(data.key)};
  if(op==='DUE_OUTCOMES')return [];
  if(op==='SOURCES'){sourceReads++;return [...cache.values(),price];}
  if(op==='ENTRY_SOURCE'){entryReads++;return {market:{value:{direction:'偏空',regime:'range'},source_ref:'SYNTHETIC_MARKET',observed_at:at,available_at:at}};}
  if(op==='CHECKPOINT'){if(sourceRevision!==null)assert.equal(data.acquired?.snapshot_hash,sourceRevision,'SOURCE_REVISION_IMMUTABLE');run.checkpoint=structuredClone(data);sourceRevision=data.acquired?.snapshot_hash??null;savedStages.push(data.completed??[]);return {};}
  if(op==='PREDICTIONS'){committed++;committedHashes.push(...data.map(r=>r.hash));return {};}
  if(op==='FINISH')return {};
  throw Error('UNEXPECTED_'+op);
 }};
 const reasons=[];for(let n=0;n<6;n++){const result=await workDailyRun(run.id,ports);reasons.push(result.reason);if(result.status==='COMPLETE')break;assert.equal(result.status,'QUEUED');assert.equal(committed,0);}
 assert.deepEqual(reasons,['ACQUISITION_PREPARED','EVALUATION_CONTINUATION','EVALUATION_CONTINUATION','EVALUATION_CONTINUATION',null]);
 assert.equal(sourceReads,1);assert.equal(entryReads,1);assert.equal(committed,1);assert.equal(new Set(committedHashes).size,216);assert.equal(run.checkpoint.finished,true);
 assert.deepEqual(run.checkpoint.completed,['ACQUISITION','RESEARCH','ENTRY','PREDICTION_LOCK','OUTCOME','PUBLICATION']);
 assert(savedStages.some(x=>x.length===0));assert.equal(run.checkpoint.acquired.evidence_cutoff,at);
 const completed=structuredClone(run.checkpoint),writes=savedStages.length;
 run.checkpoint={key:completed.key,request_hash:'0'.repeat(64),attempts:{ACQUISITION:1},completed:[],finished:false};sourceRevision=null;
 const legacy=structuredClone(run.checkpoint),refused=await workDailyRun(run.id,ports);
 assert.equal(refused.status,'BLOCKED');assert.equal(refused.reason,'IDEMPOTENCY_SCOPE_CONFLICT');assert.deepEqual(run.checkpoint,legacy);assert.equal(savedStages.length,writes);assert.equal(committed,1);
 run.checkpoint={acquired:completed.acquired};sourceRevision=completed.acquired.snapshot_hash;
 const late=await workDailyRun(run.id,{...ports,clock:()=>date+'T01:00:00.000Z'});
 assert.equal(late.status,'EXPIRED');assert.equal(committed,1,'prepared input cannot create a late Forward');
});
