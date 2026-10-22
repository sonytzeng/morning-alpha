/** Isolated synthetic workload. No Provider, Production writes or Forward sample. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {runDailyIntelligence,verifyDailyLock,DAILY_INTELLIGENCE_VERSION} from '../src/features/vnext/dailyIntelligence.ts';
import {snapshotHash,HORIZONS} from '../src/features/vnext/contracts.ts';
import {directoryPlan,sessionsBefore} from '../src/features/vnext/dailyAdapter.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';

const date='2026-10-22',initial=date+'T00:58:00.000Z',actionable=date+'T01:00:00.000Z';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:'SYNTHETIC workload '+symbol,exchange:'TWSE',industry:'24'}));
async function fixture(){
 const dates=sessionsBefore(date),source='https://example.test/synthetic-retained',hash='a'.repeat(64);
 const inputs=companies.map(c=>({symbol:c.symbol,company:c.company,cutoff:initial,through:dates.at(-1),next_session:date,expected_sessions:dates,
  bars:dates.map(d=>({id:c.symbol+':'+d,symbol:c.symbol,date:d,source,evidence_hash:hash,published_at:null,first_seen_at:initial,available_at:initial,
   as_of:d+'T13:30:00+08:00',open:100,high:101,low:99,close:100,volume:10000,amount:1000000,session_scope:'SYNTHETIC'})),
  facts:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
 const entry={business_date:date,evaluation_time:initial,source_revision:hash,source_evidence_hash:await snapshotHash(inputs),market:null,provenance:'REAL_RETAINED',mode:'FORWARD',
  stocks:inputs.map(i=>({symbol:i.symbol,name:i.company,bars:i.bars.slice(-20).map(b=>({...b,source_ref:b.source})),fundamental:null,relative_strength:null,sector_return:null,events_reviewed:null,v2_status:null}))};
 const body={inputs,entry,evidence_cutoff:initial},acquired={...body,snapshot_hash:await snapshotHash(body)};
 const request={business_date:date,checkpoint:'NATURAL_MARKET_READY',mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',core_ready:true,core_busy:false,
  source_revision:acquired.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:actionable};
 const key=await snapshotHash({version:DAILY_INTELLIGENCE_VERSION,date,checkpoint:request.checkpoint,mode:request.mode,provenance:request.provenance});
 const state={key,request_hash:await snapshotHash(request),attempts:{ACQUISITION:1},completed:['ACQUISITION'],finished:false,acquired};
 return {acquired,request,state};
}
function countEvidenceDigests(t,advance=()=>{}){
 const digest=crypto.subtle.digest.bind(crypto.subtle),decoder=new TextDecoder();let count=0,bytes=0;
 t.mock.method(crypto.subtle,'digest',async(algorithm,input)=>{
  const text=decoder.decode(input);
  if(text.startsWith('{"entry":')&&text.includes(',"input":')){count++;bytes+=input.byteLength;advance();}
  return digest(algorithm,input);
 });
 return ()=>({count,bytes});
}

test('72x250 workload binds the full existing entry and input once per stock, not once per horizon',async t=>{
 const f=await fixture(),expected=new Map();
 for(const input of f.acquired.inputs)expected.set(input.symbol,await snapshotHash({input,entry:f.acquired.entry}));
 const counts=countEvidenceDigests(t);let state=f.state,stored=[];
 const result=await runDailyIntelligence(f.request,{exclusive:async(_k,work)=>work(),load:async()=>state,
  save:async s=>{state=structuredClone(s);},lock:async rows=>{stored=structuredClone(rows);}},
 {acquire:async()=>{throw Error('UNEXPECTED_REACQUISITION');},clock:()=>initial,outcomes:async()=>({}),publication:async()=>[]});
 assert.equal(result.state,'COMPLETE');assert.equal(stored.length,216);
 assert.equal(counts().count,72,'horizon-independent evidence must not serialize and hash the same complete entry three times');
 assert(counts().bytes>1000000,'exercise the full multi-stock entry, not an empty fixture');
 for(const lock of stored){assert.equal(lock.evidence_hash,expected.get(lock.symbol));assert(await verifyDailyLock(lock));}
 assert.deepEqual([...new Set(stored.map(l=>l.horizon))].sort(),Object.keys(HORIZONS).sort());
 for(const lock of stored){
  const input=f.acquired.inputs.find(i=>i.symbol===lock.symbol);
  assert.deepEqual(lock.research,evaluateResearch(input,lock.horizon),'every research field still equals the unchanged evaluator');
 }
 assert(!stored.some(l=>l.research.state==='QUALIFIED'),'flat prices and absent facts do not become qualified');
});

test('bounded hash workload can reach the unchanged SQL lock boundary without late timestamp rewriting',async t=>{
 const f=await fixture(),directories=await directoryPlan(date);let now=Date.parse(initial);
 t.mock.method(Date,'now',()=>now);
 const counts=countEvidenceDigests(t,()=>{now+=400;});
 const run={id:'isolated-hash-budget',business_date:date,actionable_at:actionable,lease:'isolated',fence:1,plan:[{key:'completed-plan'}],cursor:1,checkpoint:f.state};
 const committed=new Map(),calls=[];
 const rpc=async(name,args)=>{
  if(name==='claim_vnext_daily_research_v1')return {status:'ACQUIRED',run:structuredClone(run)};
  const op=args.p_op,data=args.p_data;calls.push(op);
  if(op==='SOURCE_BEGIN'){const payload={rows:data.exchange==='TWSE'?companies:[]};return {status:'CACHE',receipt:{task:data,payload,version:'VNEXT_DAILY_OFFICIAL_1',status:'OK'}};}
  if(op==='DUE_OUTCOMES')return [];
  if(op==='CHECKPOINT'){run.checkpoint=structuredClone(data);return {};}
  if(op==='PREDICTIONS'){
   assert(now<Date.parse(actionable),'new inserts still obey actual wall-clock cutoff');
   assert.equal(data.length,216);
   for(const row of data){assert(Date.parse(row.body.locked_at)<=now);assert.deepEqual(row.body,run.checkpoint.locks.find(l=>l.id===row.body.id));committed.set(row.body.id,structuredClone(row));}
   return {};
  }
  if(op==='FINISH'){run.state=data.status;run.reason=data.reason;return {};}
  throw Error('UNEXPECTED_TEST_RPC_'+op);
 };
 const before=structuredClone(f.acquired);
 const result=await workDailyRun(run.id,{rpc,fetcher:async()=>{throw Error('UNEXPECTED_PROVIDER');},clock:()=>new Date(now).toISOString(),sleep:async ms=>{now+=ms;}});
 assert.equal(result.status,'COMPLETE','repeated full-entry hashing must not consume the complete invocation before prepared commit');
 assert.equal(committed.size,216);assert.equal(counts().count,72);
 assert(!calls.includes('SOURCES')&&!calls.includes('ENTRY_SOURCE'),'a pinned revision is not reassembled');
 assert.deepEqual(run.checkpoint.acquired,before,'cutoff and complete acquired revision remain immutable');
 assert(committed.values().next().value.body.locked_at<actionable);
 assert.equal(directories.length,2);
});

test('the entire entry capsule remains evidence-bound, not just the selected stock',async()=>{
 const f=await fixture(),first=f.acquired.inputs[0],original=await snapshotHash({input:first,entry:f.acquired.entry});
 const changed=structuredClone(f.acquired.entry);changed.stocks.at(-1).bars.at(-1).amount+=1;
 assert.notEqual(await snapshotHash({input:first,entry:changed}),original);
 const changedInput=structuredClone(first);changedInput.bars[0].amount+=1;
 assert.notEqual(await snapshotHash({input:changedInput,entry:f.acquired.entry}),original);
});

for(const alias of ['entry','checkpoint-root'])test('retained '+alias+' alias cannot change the validated snapshot between horizon digest awaits',async t=>{
 const f=await fixture(),before=structuredClone(f.acquired),externalEntry=f.acquired.entry;
 const retainedRoot=f.state;
 const expected=new Map();for(const input of before.inputs)expected.set(input.symbol,await snapshotHash({input,entry:before.entry}));
 const digest=crypto.subtle.digest.bind(crypto.subtle),decoder=new TextDecoder();let mutated=false,state=f.state,stored=[];
 t.mock.method(crypto.subtle,'digest',async(algorithm,bytes)=>{
  const text=decoder.decode(bytes);
  if(!mutated&&text.startsWith('{"entry":')&&text.includes(',"input":')){
   mutated=true;const target=alias==='entry'?externalEntry:retainedRoot.acquired.entry;target.stocks.at(-1).bars.at(-1).amount+=1;
  }
  return digest(algorithm,bytes);
 });
 const result=await runDailyIntelligence(f.request,{exclusive:async(_k,work)=>work(),load:async()=>state,
  save:async s=>{state=structuredClone(s);},lock:async rows=>{stored=structuredClone(rows);}},
 {acquire:async()=>{throw Error('UNEXPECTED_REACQUISITION');},clock:()=>initial,outcomes:async()=>({}),publication:async()=>[]});
 assert(mutated);assert.equal(result.state,'COMPLETE');assert.equal(stored.length,216);
 assert.equal(await snapshotHash(state.acquired),await snapshotHash(before),'prepared checkpoint must own the complete validated acquisition bytes');
 for(const lock of stored)assert.equal(lock.evidence_hash,expected.get(lock.symbol));
});
