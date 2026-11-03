import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDailyStockCitationRepair} from '../supabase/functions/daily-stock-analysis-v1/repair-handler.ts';
import {stockAiCitationRepairOriginalRevision,stockAiCitationRepairRevision,stockAiAllFactsCitationRepairRevision} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

const secret='test-repair-internal-secret-0123456789',batchId='a'.repeat(64),reviewHash='b'.repeat(64),cutoff='2026-10-30T12:00:00Z';
const selector=(symbol='1035')=>({batch_id:batchId,repair_symbol:symbol,review_document_hash:reviewHash});
const packets=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司',cutoff,evidence:[{id:'E1',symbol:String(1000+i),kind:'NEWS',
 source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試證據，非真實分析'}]}));
const batch=()=>({id:batchId,cutoff,packets:packets()});
const request=(body=selector(),headers={'x-vnext-internal':secret})=>new Request('https://repair-worker.test',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
async function fenceFor(s=selector()){
 const packet=packets().find(p=>p.symbol===s.repair_symbol),inputHash=await snapshotHash(packet);
 return {state:'READY',batch_id:batchId,symbol:s.repair_symbol,input_hash:inputHash,cutoff,
  original_job_key:await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'}),
  job_key:await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low'}),
  model_revision:'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low',review_document_hash:reviewHash,dispatch_request_id:23,member_published:false};
}
async function allFactsFenceFor(s=selector()){
 const prior=await fenceFor(s);
 return {...prior,model_revision:stockAiAllFactsCitationRepairRevision,
  job_key:await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:prior.input_hash,model_revision:stockAiAllFactsCitationRepairRevision}),
  prior_job_key:prior.job_key,prior_model_revision:stockAiCitationRepairRevision,prior_input_hash:prior.input_hash,prior_cutoff:cutoff};
}
function progress(symbol='1035',state='COMPLETE',code){
 return {rows:packets().map(p=>p.symbol===symbol?{symbol,state,...(code?{code}:{})}:{symbol:p.symbol,state:'DEFERRED'}),
  model_calls:state==='COMPLETE'||state==='FAILED'&&code!=='AI_BATCH_ATTEMPTS_EXHAUSTED'?1:0,member_published:false,complete:false};
}
const ports=(overrides={})=>({internalSecret:secret,clock:()=> '2026-10-31T01:00:00Z',loadBatch:async()=>batch(),loadFence:async s=>fenceFor(s),
 runRepair:async(_packets,symbol)=>progress(symbol),...overrides});
const noWork=()=>ports({loadBatch:async()=>assert.fail('must not load'),loadFence:async()=>assert.fail('must not read fence'),runRepair:async()=>assert.fail('must not run')});
async function body(response,status){
 assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();
}

test('repair keeps the fixed original prompt7, replacement prompt8 and all-facts prompt9 identities',()=>{
 assert.equal(stockAiCitationRepairOriginalRevision,'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low');
 assert.equal(stockAiCitationRepairRevision,'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low');
 assert.equal(stockAiAllFactsCitationRepairRevision,'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low');
});
test('POST, no Origin and internal authentication stop unauthorized requests before any port',async()=>{
 assert.equal((await handleDailyStockCitationRepair(new Request('https://repair-worker.test'),noWork())).status,405);
 for(const origin of ['https://member.test',''])assert.equal((await handleDailyStockCitationRepair(request(undefined,{'x-vnext-internal':secret,Origin:origin}),noWork())).status,403);
 for(const headers of [{},{'x-vnext-internal':'wrong'},{'x-daily-delivery-token':secret}])assert.equal((await handleDailyStockCitationRepair(request(undefined,headers),noWork())).status,401);
 assert.equal((await handleDailyStockCitationRepair(request(),ports({internalSecret:'short',loadBatch:async()=>assert.fail()}))).status,401);
});
test('only the exact three-key reviewed selector is accepted; callers cannot set evidence, revision or budget',async()=>{
 for(const value of [null,[],{},'{',{batch_id:batchId},{...selector(),repair_symbol:'bad'},{...selector(),repair_symbol:1035},
  {...selector(),batch_id:'bad'},{...selector(),review_document_hash:'bad'},{...selector(),review_document_hash:reviewHash.toUpperCase()},
  {...selector(),model_revision:stockAiCitationRepairRevision},{...selector(),model_revision:stockAiAllFactsCitationRepairRevision},
  {...selector(),revision:stockAiAllFactsCitationRepairRevision},{...selector(),prior_model_revision:stockAiCitationRepairRevision},
  {...selector(),evidence:[]},{...selector(),maxStocks:72},{...selector(),original_job_key:'c'.repeat(64)}]){
  const r=await body(await handleDailyStockCitationRepair(request(value),noWork()),422);
  assert.equal(r.error,'SCOPE_INVALID');assert.equal(r.model_calls,0);assert.equal(r.member_published,false);
 }
});
test('512-byte limit uses actual UTF8 bytes and declared length, with an exact512 valid selector allowed',async()=>{
 for(const [value,headers] of [['x'.repeat(513),undefined],['界'.repeat(200),undefined],
  [JSON.stringify(selector()),{'x-vnext-internal':secret,'content-length':'513'}],
  [JSON.stringify(selector()),{'x-vnext-internal':secret,'content-length':'invalid'}]]){
  const r=await body(await handleDailyStockCitationRepair(request(value,headers),noWork()),413);assert.equal(r.error,'INPUT_LIMIT');assert.equal(r.model_calls,0);
 }
 const text=JSON.stringify(selector()),exact=' '.repeat(512-new TextEncoder().encode(text).byteLength)+text;
 assert.equal((await handleDailyStockCitationRepair(request(exact),ports())).status,200);
});
test('valid READY fence binds exact target input hash, both fixed job keys, review hash and dispatch receipt',async()=>{
 let loaded=0,checked=0,executed=0,signal;
 const expected=await fenceFor();
 const r=await body(await handleDailyStockCitationRepair(request(),ports({loadBatch:async(id,s)=>{loaded++;assert.equal(id,batchId);assert(s instanceof AbortSignal);return batch();},
  loadFence:async(s,abort)=>{checked++;assert.deepEqual(s,selector());assert(abort instanceof AbortSignal);return {...expected,private_payload:'not returned'};},
  runRepair:async(ps,symbol,abort,revision)=>{executed++;signal=abort;assert.equal(ps.length,72);assert.equal(symbol,'1035');assert.equal(revision,stockAiCitationRepairRevision);return {...progress(symbol),raw_candidate:'not returned',requires_next_checkpoint:true};}
 })),200);
 assert.equal(loaded,1);assert.equal(checked,1);assert.equal(executed,1);assert.equal(signal.aborted,true);
 assert.deepEqual(r,{state:'COMPLETE',batch_id:batchId,symbol:'1035',job_key:expected.job_key,original_job_key:expected.original_job_key,
  dispatch_request_id:23,model_revision:stockAiCitationRepairRevision,review_document_hash:reviewHash,model_calls:1,member_published:false});
 assert(!JSON.stringify(r).includes('not returned'));assert(!Object.hasOwn(r,'requires_next_checkpoint'));assert(!Object.hasOwn(r,'packets'));
});
test('missing, changed or nonREADY repair fences cannot start a model',async()=>{
 const valid=await fenceFor();
 for(const fence of [null,undefined,[],{...valid,state:'CACHED'},{...valid,state:'BUSY'},{...valid,batch_id:'c'.repeat(64)},
  {...valid,symbol:'1036'},{...valid,input_hash:'c'.repeat(64)},{...valid,original_job_key:'c'.repeat(64)},{...valid,job_key:'c'.repeat(64)},
  {...valid,model_revision:stockAiCitationRepairOriginalRevision},{...valid,review_document_hash:'c'.repeat(64)},{...valid,member_published:true},
  {...valid,cutoff:'2026-10-29T12:00:00Z'},{...valid,cutoff:'bad'},{...valid,dispatch_request_id:undefined},{...valid,dispatch_request_id:0},
  {...valid,dispatch_request_id:1.5},{...valid,dispatch_request_id:Number.MAX_SAFE_INTEGER+1},{...valid,dispatch_request_id:'23'}]){
  const r=await body(await handleDailyStockCitationRepair(request(),ports({loadFence:async()=>fence,runRepair:async()=>assert.fail('invalid fence cannot run')})),409);
  assert.equal(r.state,'REJECTED');assert.equal(r.model_calls,0);assert.equal(r.member_published,false);
 }
});
test('a target absent from retained72 or an invalid full batch cannot run',async()=>{
 const missing=await body(await handleDailyStockCitationRepair(request(selector('9999')),ports({loadFence:async()=>assert.fail('unknown target has no fence'),runRepair:async()=>assert.fail()})),409);
 assert.equal(missing.model_calls,0);
 const unavailable=await body(await handleDailyStockCitationRepair(request(),ports({loadBatch:async()=>null,loadFence:async()=>assert.fail(),runRepair:async()=>assert.fail()})),409);
 assert.equal(unavailable.error,'SOURCE_BATCH_UNAVAILABLE');assert.equal(unavailable.model_calls,0);
 for(const mutate of [b=>b.packets.pop(),b=>b.packets[71]={...b.packets[0]},b=>b.packets[71].evidence[0].available_at='2027-01-01T00:00:00Z']){
  const b=batch();mutate(b);const r=await body(await handleDailyStockCitationRepair(request(),ports({loadBatch:async()=>b,runRepair:async()=>assert.fail('all72 packets must validate')})),409);
  assert.equal(r.state,'REJECTED');assert.equal(r.model_calls,0);
 }
});
test('first and last targets complete, cache, remain busy or exhaust without falling through to another symbol',async()=>{
 for(const symbol of ['1000','1071'])for(const [state,code,status,expected] of [['COMPLETE',undefined,200,'COMPLETE'],['CACHED',undefined,200,'CACHED'],
  ['BUSY',undefined,202,'BUSY'],['FAILED','AI_BATCH_ATTEMPTS_EXHAUSTED',409,'EXHAUSTED'],['FAILED','AI_ANALYSIS_CITATION',207,'FAILED']]){
  let runs=0;const r=await body(await handleDailyStockCitationRepair(request(selector(symbol)),ports({runRepair:async(ps,target,_signal,revision)=>{
   runs++;assert.equal(target,symbol);assert.equal(ps.length,72);assert.equal(revision,stockAiCitationRepairRevision);return progress(target,state,code);
  }})),status);
  assert.equal(r.state,expected);assert.equal(r.symbol,symbol);assert.equal(r.model_calls,state==='COMPLETE'||code==='AI_ANALYSIS_CITATION'?1:0);assert.equal(r.member_published,false);assert.equal(runs,1);
 }
});
test('server READY prompt9 fence binds the prompt7 base and exact prompt8 predecessor, and passes only its chosen revision',async()=>{
 for(const symbol of ['1000','1071'])for(const [state,code,status,expected]of [['COMPLETE',undefined,200,'COMPLETE'],['CACHED',undefined,200,'CACHED'],
  ['BUSY',undefined,202,'BUSY'],['FAILED','AI_BATCH_ATTEMPTS_EXHAUSTED',409,'EXHAUSTED']]){
  const s=selector(symbol),valid=await allFactsFenceFor(s),equivalentCutoff='2026-10-30T20:00:00+08:00';let fences=0,runs=0,runSignal;
  const r=await body(await handleDailyStockCitationRepair(request(s),ports({
   loadFence:async(actual,signal)=>{fences++;assert.deepEqual(actual,s);assert(signal instanceof AbortSignal);return {...valid,cutoff:equivalentCutoff,prior_cutoff:equivalentCutoff,private_payload:'do not echo'};},
   runRepair:async(ps,target,signal,revision)=>{
    runs++;runSignal=signal;assert.equal(ps.length,72);assert.equal(target,symbol);assert.equal(revision,stockAiAllFactsCitationRepairRevision);
    const p=progress(target,state,code);assert.equal(p.rows.filter(row=>row.symbol!==symbol&&row.state!=='DEFERRED').length,0);
    return {...p,raw_candidate:'do not echo',requires_next_checkpoint:true};
   },
  })),status);
  assert.equal(fences,1);assert.equal(runs,1);assert.equal(runSignal.aborted,true);
  assert.deepEqual(r,{state:expected,batch_id:batchId,symbol,job_key:valid.job_key,original_job_key:valid.original_job_key,
   dispatch_request_id:23,model_revision:stockAiAllFactsCitationRepairRevision,prior_job_key:valid.prior_job_key,
   prior_model_revision:stockAiCitationRepairRevision,prior_input_hash:valid.input_hash,prior_cutoff:equivalentCutoff,
   review_document_hash:reviewHash,model_calls:state==='COMPLETE'?1:0,...(code?{code}:{}),member_published:false});
  assert(!JSON.stringify(r).includes('do not echo'));assert(!Object.hasOwn(r,'requires_next_checkpoint'));
 }
});
test('prompt9 requires every exact predecessor binding and cannot reinterpret a prompt9 job key as prompt8',async()=>{
 const valid=await allFactsFenceFor(),prior=await fenceFor();
 const bad=[];
 for(const key of ['prior_job_key','prior_model_revision','prior_input_hash','prior_cutoff']){
  const missing={...valid};delete missing[key];bad.push(missing,{...valid,[key]:null});
 }
 bad.push({...valid,prior_job_key:'c'.repeat(64)},{...valid,prior_job_key:valid.original_job_key},
  {...valid,prior_model_revision:stockAiCitationRepairOriginalRevision},{...valid,prior_model_revision:stockAiAllFactsCitationRepairRevision},
  {...valid,prior_input_hash:'c'.repeat(64)},{...valid,prior_cutoff:'bad'},{...valid,prior_cutoff:'2026-10-30T12:00:00.000001Z'},
  {...valid,prior_cutoff:'2026-10-29T12:00:00Z'},{...valid,model_revision:stockAiCitationRepairRevision},
  {...valid,job_key:prior.job_key},{...valid,model_revision:'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-10:reasoning-low'});
 for(const fence of bad){
  const r=await body(await handleDailyStockCitationRepair(request(),ports({loadFence:async()=>fence,runRepair:async()=>assert.fail('unbound predecessor cannot run')})),409);
  assert.equal(r.state,'REJECTED');assert.equal(r.model_calls,0);assert.equal(r.member_published,false);assert(!Object.hasOwn(r,'job_key'));
 }
});
test('prompt9 rejects non-target work and private failure prose without another symbol or revision attempt',async()=>{
 const valid=await allFactsFenceFor();
 for(const mode of ['other-symbol','private-code','throw']){
  let runs=0;const r=await body(await handleDailyStockCitationRepair(request(),ports({loadFence:async()=>valid,
   runRepair:async(_ps,target,_signal,revision)=>{
    runs++;assert.equal(target,'1035');assert.equal(revision,stockAiAllFactsCitationRepairRevision);
    if(mode==='throw')throw Error('private provider detail '+secret);
    if(mode==='private-code')return progress(target,'FAILED','private provider detail '+secret);
    const p=progress(target);p.rows[0].state='CACHED';return p;
   },
  })),409);
  assert.equal(runs,1);assert.equal(r.state,'REJECTED');assert.equal(r.member_published,false);assert(!Object.hasOwn(r,'code'));
  assert(!JSON.stringify(r).includes('private'));assert(!JSON.stringify(r).includes(secret));
 }
});
test('non-target progress, deferred targets, inconsistent counts and malformed universe cannot report repair success',async()=>{
 for(const mutate of [p=>p.rows[0].state='COMPLETE',p=>p.rows[0].state='CACHED',p=>p.rows[0].state='BUSY',p=>p.rows[0].state='FAILED',
  p=>p.rows.find(r=>r.symbol==='1035').state='DEFERRED',p=>p.model_calls=2,p=>p.model_calls=0,p=>p.complete=true,p=>p.member_published=true,
  p=>p.rows.pop(),p=>p.rows[71]={...p.rows[0]}]){
  const p=progress();mutate(p);const r=await body(await handleDailyStockCitationRepair(request(),ports({runRepair:async()=>p})),409);
  assert.equal(r.state,'REJECTED');assert.equal(r.member_published,false);
 }
});
test('cache, contention and exhaustion cannot conceal model work and failure codes never echo raw prose',async()=>{
 const cases=[];
 for(const state of ['CACHED','BUSY'])cases.push({...progress('1035',state),model_calls:1});
 cases.push({...progress('1035','FAILED','AI_BATCH_ATTEMPTS_EXHAUSTED'),model_calls:1});
 cases.push({...progress('1035','FAILED','AI_ANALYSIS_CITATION'),model_calls:0});
 cases.push(progress('1035','FAILED','private provider details '+secret));
 for(const state of ['COMPLETE','CACHED','BUSY']){
  const p=progress('1035',state);p.rows.find(r=>r.symbol==='1035').code='AI_ANALYSIS_CITATION';cases.push(p);
 }
 for(const p of cases){
  const r=await body(await handleDailyStockCitationRepair(request(),ports({runRepair:async()=>p})),409);
  assert.equal(r.state,'REJECTED');assert.equal(r.member_published,false);assert(!Object.hasOwn(r,'code'));
  assert(!JSON.stringify(r).includes('private'));assert(!JSON.stringify(r).includes(secret));
 }
});
test('batch and fence loading share the bounded load deadline and signal cancellation',async()=>{
 let loadSignal;
 const load=await body(await handleDailyStockCitationRepair(request(),ports({loadBatch:async(_id,s)=>{loadSignal=s;return new Promise(()=>{});},runRepair:async()=>assert.fail()}),{loadMs:5,runMs:100}),503);
 assert.equal(load.error,'STOCK_ANALYSIS_TIMEOUT');assert.equal(loadSignal.aborted,true);assert.equal(load.model_calls,0);
 let fenceSignal;
 const fence=await body(await handleDailyStockCitationRepair(request(),ports({loadFence:async(_selector,s)=>{fenceSignal=s;return new Promise(()=>{});},runRepair:async()=>assert.fail()}),{loadMs:50,runMs:100}),503);
 assert.equal(fence.error,'STOCK_ANALYSIS_TIMEOUT');assert.equal(fenceSignal.aborted,true);assert.equal(fence.model_calls,0);
});
test('run deadline aborts repair and exceptions expose no provider prose or credentials',async()=>{
 let signal;const timeout=await body(await handleDailyStockCitationRepair(request(),ports({runRepair:async(_ps,_symbol,s)=>{signal=s;return new Promise(()=>{});}}),{loadMs:100,runMs:5}),503);
 assert.equal(timeout.error,'STOCK_ANALYSIS_TIMEOUT');assert.equal(signal.aborted,true);assert.equal(timeout.member_published,false);
 for(const port of ['loadBatch','loadFence','runRepair']){
  const r=await body(await handleDailyStockCitationRepair(request(),ports({[port]:async()=>{throw Error('private provider body '+secret);}})),409);
  assert.equal(r.state,'REJECTED');assert(!JSON.stringify(r).includes('private'));assert(!JSON.stringify(r).includes(secret));
 }
});
