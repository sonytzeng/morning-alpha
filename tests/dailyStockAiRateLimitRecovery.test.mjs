// Execute the actual recovery handler and runner with isolated durable/provider ports.
// Every fetch below is a local fixture; no paid model, database or dispatch is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleDailyStockRateLimitRecovery} from '../supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-handler.ts';
import {runStoredStockAiRateLimitRecovery,stockAiRateLimitOriginalRevision,stockAiRateLimitRecoveryRevision} from '../supabase/functions/daily-stock-analysis-v1/rate-limit-recovery-runner.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

const secret='test-only-rate-limit-recovery-secret-0123456789',batchId='a'.repeat(64),reviewHash='b'.repeat(64);
const cutoff='2026-10-31T07:17:02.217051Z';
const selector=(symbol='1035')=>({batch_id:batchId,recovery_symbol:symbol,review_document_hash:reviewHash});
const packets=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司',cutoff,evidence:[{id:'E1',symbol:String(1000+i),kind:'NEWS',
 source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試證據，非真實股票分析'}]}));
const batch=()=>({id:batchId,cutoff,packets:packets()});
const request=(value=selector(),headers={'x-vnext-internal':secret})=>new Request('https://recovery.test.invalid',{method:'POST',headers,body:typeof value==='string'?value:JSON.stringify(value)});
async function identity(symbol,revision){const packet=packets().find(p=>p.symbol===symbol),input_hash=await snapshotHash(packet);
 return {input_hash,key:await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash,model_revision:revision})};}
async function fenceFor(s=selector()){
 const original=await identity(s.recovery_symbol,stockAiRateLimitOriginalRevision),recovery=await identity(s.recovery_symbol,stockAiRateLimitRecoveryRevision);
 return {state:'READY',batch_id:batchId,symbol:s.recovery_symbol,input_hash:original.input_hash,cutoff,original_job_key:original.key,job_key:recovery.key,
  model_revision:stockAiRateLimitRecoveryRevision,review_document_hash:reviewHash,dispatch_request_id:23,member_published:false};
}
function progress(symbol='1035',state='COMPLETE',code){return {
 rows:packets().map(packet=>packet.symbol===symbol?{symbol,state,...(code?{code}:{})}:{symbol:packet.symbol,state:'DEFERRED'}),
 model_calls:state==='COMPLETE'||state==='FAILED'&&code!=='AI_BATCH_ATTEMPTS_EXHAUSTED'?1:0,member_published:false,complete:false};}
const ports=(overrides={})=>({internalSecret:secret,clock:()=> '2026-10-31T10:00:00Z',loadBatch:async()=>batch(),loadFence:async s=>fenceFor(s),
 runRecovery:async(_packets,s)=>progress(s.recovery_symbol),...overrides});
const noWork=()=>ports({loadBatch:async()=>assert.fail('must not load'),loadFence:async()=>assert.fail('must not read fence'),runRecovery:async()=>assert.fail('must not spend')});
async function body(response,status){assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();}
const noContinuation=value=>{assert.equal(value.automatic_continuation,false);assert.equal(value.requires_next_checkpoint,false);assert.equal(value.member_published,false);};

test('recovery uses the original prompt7 model identity with only the fixed recovery-1 suffix',()=>{
 assert.equal(stockAiRateLimitOriginalRevision,'gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low');
 assert.equal(stockAiRateLimitRecoveryRevision,stockAiRateLimitOriginalRevision+':recovery-1');
});
test('POST, no Origin and an exact internal secret are required before any recovery port',async()=>{
 assert.equal((await handleDailyStockRateLimitRecovery(new Request('https://recovery.test.invalid'),noWork())).status,405);
 for(const origin of ['', 'https://member.test.invalid'])assert.equal((await handleDailyStockRateLimitRecovery(request(undefined,{'x-vnext-internal':secret,Origin:origin}),noWork())).status,403);
 for(const headers of [{},{'x-vnext-internal':'wrong'},{'x-daily-delivery-token':secret}])assert.equal((await handleDailyStockRateLimitRecovery(request(undefined,headers),noWork())).status,401);
 assert.equal((await handleDailyStockRateLimitRecovery(request(),{...noWork(),internalSecret:'short'})).status,401);
});
test('only the exact three-key selector is allowed; evidence, revision, multiple targets and budgets cannot be supplied',async()=>{
 for(const value of [null,[],{},'{',{batch_id:batchId},{...selector(),batch_id:'bad'},{...selector(),batch_id:batchId.toUpperCase()},
  {...selector(),recovery_symbol:1035},{...selector(),recovery_symbol:'bad'},{...selector(),recovery_symbol:['1035','1036']},
  {...selector(),review_document_hash:'bad'},{...selector(),review_document_hash:reviewHash.toUpperCase()},
  ...['model','model_revision','repair_symbol','citationRepair','allFactsCitationRepair','evidence','packets','maxStocks','continue','job_key'].map(key=>({...selector(),[key]:'forbidden'}))]){
  const r=await body(await handleDailyStockRateLimitRecovery(request(value),noWork()),422);
  assert.equal(r.error,'SCOPE_INVALID');assert.equal(r.model_calls,0);noContinuation(r);
 }
});
test('request limits bound actual UTF8 bytes and Content-Length, including an exact512-byte valid selector',async()=>{
 for(const [value,headers] of [['x'.repeat(513),undefined],['界'.repeat(200),undefined],
  [JSON.stringify(selector()),{'x-vnext-internal':secret,'content-length':'513'}],
  [JSON.stringify(selector()),{'x-vnext-internal':secret,'content-length':'invalid'}]]){
  const r=await body(await handleDailyStockRateLimitRecovery(request(value,headers),noWork()),413);assert.equal(r.error,'INPUT_LIMIT');assert.equal(r.model_calls,0);noContinuation(r);
 }
 const valid=JSON.stringify(selector()),exact=' '.repeat(512-new TextEncoder().encode(valid).byteLength)+valid;
 noContinuation(await body(await handleDailyStockRateLimitRecovery(request(exact),ports()),200));
});
test('READY fence binds both job keys, packet hash, review hash, model, positive receipt and exact microsecond cutoff',async()=>{
 let loads=0,fences=0,runs=0,runSignal;const original=batch(),before=await snapshotHash(original),fence=await fenceFor();
 const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({loadBatch:async(id,signal)=>{loads++;assert.equal(id,batchId);assert(signal instanceof AbortSignal);return original;},
  loadFence:async(s,signal)=>{fences++;assert.deepEqual(s,selector());assert(signal instanceof AbortSignal);return {...fence,cutoff:'2026-10-31T15:17:02.217051+08:00',private_payload:'never returned'};},
  runRecovery:async(ps,s,signal)=>{runs++;runSignal=signal;assert.equal(ps.length,72);assert.deepEqual(s,selector());ps[0].company='local clone';return {...progress(),private_payload:'never returned',automatic_continuation:true,requires_next_checkpoint:true};}
 })),200);
 assert.equal(loads,1);assert.equal(fences,1);assert.equal(runs,1);assert.equal(runSignal.aborted,true);assert.equal(await snapshotHash(original),before);
 assert.deepEqual(r,{state:'COMPLETE',batch_id:batchId,symbol:'1035',model_revision:stockAiRateLimitRecoveryRevision,review_document_hash:reviewHash,
  model_calls:1,automatic_continuation:false,requires_next_checkpoint:false,member_published:false});
 assert(!JSON.stringify(r).includes('never returned'));assert(!Object.hasOwn(r,'packets'));
});
test('missing, changed, nonREADY or one-microsecond-different fences reject before a model can start',async()=>{
 const valid=await fenceFor();
 for(const fence of [null,undefined,[],{...valid,state:'CACHED'},{...valid,state:'BUSY'},{...valid,batch_id:'c'.repeat(64)},
  {...valid,symbol:'1036'},{...valid,input_hash:'c'.repeat(64)},{...valid,original_job_key:'c'.repeat(64)},{...valid,job_key:'c'.repeat(64)},
  {...valid,job_key:valid.original_job_key},{...valid,model_revision:stockAiRateLimitOriginalRevision},{...valid,review_document_hash:'c'.repeat(64)},
  {...valid,member_published:true},{...valid,cutoff:'bad'},{...valid,cutoff:'2026-10-31T07:17:02.217052Z'},
  {...valid,cutoff:'2026-10-31T07:17:02.217050Z'},{...valid,dispatch_request_id:undefined},{...valid,dispatch_request_id:0},
  {...valid,dispatch_request_id:-1},{...valid,dispatch_request_id:1.5},{...valid,dispatch_request_id:Number.MAX_SAFE_INTEGER+1},{...valid,dispatch_request_id:'23'}]){
  const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({loadFence:async()=>fence,runRecovery:async()=>assert.fail('unbound fence cannot spend')})),409);
  assert.equal(r.state,'REJECTED');assert.equal(r.model_calls,0);noContinuation(r);
 }
});
test('the full72 packet batch validates before running and a missing target cannot load its fence',async()=>{
 for(const mutate of [b=>b.packets.pop(),b=>b.packets[71]={...b.packets[0]},b=>b.packets[71].evidence[0].available_at='2027-01-01T00:00:00Z',
  b=>b.id='c'.repeat(64),b=>b.packets[71].cutoff='2026-10-30T07:17:02Z']){
  const b=batch();mutate(b);const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({loadBatch:async()=>b,runRecovery:async()=>assert.fail('bad universe cannot spend')})),409);
  assert.equal(r.state,'REJECTED');assert.equal(r.model_calls,0);noContinuation(r);
 }
 const missing=await body(await handleDailyStockRateLimitRecovery(request(selector('9999')),ports({loadFence:async()=>assert.fail(),runRecovery:async()=>assert.fail()})),409);
 assert.equal(missing.model_calls,0);
 const unavailable=await body(await handleDailyStockRateLimitRecovery(request(),ports({loadBatch:async()=>null,loadFence:async()=>assert.fail(),runRecovery:async()=>assert.fail()})),409);
 assert.equal(unavailable.error,'SOURCE_BATCH_UNAVAILABLE');assert.equal(unavailable.model_calls,0);
});
test('only the first or last selected stock can complete, cache, remain busy, exhaust or fail; no continuation is advertised',async()=>{
 for(const symbol of ['1000','1071'])for(const [state,code,status,expected] of [['COMPLETE',undefined,200,'COMPLETE'],['CACHED',undefined,200,'CACHED'],
  ['BUSY',undefined,202,'BUSY'],['FAILED','AI_BATCH_ATTEMPTS_EXHAUSTED',409,'EXHAUSTED'],['FAILED','STOCK_AI_PROVIDER_HTTP_429',207,'FAILED']]){
  let calls=0;const r=await body(await handleDailyStockRateLimitRecovery(request(selector(symbol)),ports({runRecovery:async(ps,s)=>{
   calls++;assert.equal(ps.length,72);assert.deepEqual(s,selector(symbol));return progress(symbol,state,code);}})),status);
  assert.equal(calls,1);assert.equal(r.state,expected);assert.equal(r.symbol,symbol);assert.equal(r.model_calls,state==='COMPLETE'||code==='STOCK_AI_PROVIDER_HTTP_429'?1:0);noContinuation(r);
 }
});
test('non-target work, malformed progress, inconsistent call counts and private failure prose cannot become success',async()=>{
 const bad=[];
 for(const mutate of [p=>p.rows[0].state='COMPLETE',p=>p.rows[0].state='CACHED',p=>p.rows[0].state='BUSY',p=>p.rows[0].state='FAILED',
  p=>p.rows.find(r=>r.symbol==='1035').state='DEFERRED',p=>p.model_calls=2,p=>p.model_calls=0,p=>p.complete=true,p=>p.member_published=true,
  p=>p.rows.pop(),p=>p.rows[71]={...p.rows[0]}]){const p=progress();mutate(p);bad.push(p);}
 for(const state of ['CACHED','BUSY'])bad.push({...progress('1035',state),model_calls:1});
 bad.push({...progress('1035','FAILED','AI_BATCH_ATTEMPTS_EXHAUSTED'),model_calls:1},
  {...progress('1035','FAILED','STOCK_AI_PROVIDER_HTTP_429'),model_calls:0},progress('1035','FAILED','private provider detail '+secret));
 for(const state of ['COMPLETE','CACHED','BUSY']){const p=progress('1035',state);p.rows.find(r=>r.symbol==='1035').code='STOCK_AI_PROVIDER_HTTP_429';bad.push(p);}
 for(const p of bad){const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({runRecovery:async()=>p})),409);
  assert.equal(r.state,'REJECTED');assert(!Object.hasOwn(r,'code'));assert(!JSON.stringify(r).includes('private'));assert(!JSON.stringify(r).includes(secret));noContinuation(r);}
});
test('load and fence deadlines abort their transport; run deadlines abort without a continuation or private error',async()=>{
 for(const name of ['loadBatch','loadFence']){let signal;
  const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({[name]:async(_selector,s)=>{signal=s;return new Promise(()=>{});},runRecovery:async()=>assert.fail()}),{loadMs:30,runMs:100}),503);
  assert.equal(r.error,'STOCK_ANALYSIS_TIMEOUT');assert.equal(r.model_calls,0);assert.equal(signal.aborted,true);noContinuation(r);
 }
 let signal;const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({runRecovery:async(_packets,_s,s)=>{signal=s;return new Promise(()=>{});}}),{loadMs:100,runMs:5}),503);
 assert.equal(r.error,'STOCK_ANALYSIS_TIMEOUT');assert.equal(signal.aborted,true);noContinuation(r);
 for(const name of ['loadBatch','loadFence','runRecovery']){const rejected=await body(await handleDailyStockRateLimitRecovery(request(),ports({[name]:async()=>{throw Error('private '+secret);}})),409);
  assert.equal(rejected.state,'REJECTED');assert(!JSON.stringify(rejected).includes('private'));assert(!JSON.stringify(rejected).includes(secret));noContinuation(rejected);}
});

function answer(symbol){return {symbol,horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'等待資料確認。',evidence_ids:['E1']},
 counter_evidence:[],confirmation:'等待後續公告確認',invalidation:'新證據否定判斷',gaps:[]}))};}
function providerResponse(symbol){return Response.json({id:'test-local-recovery-'+symbol,model:'gpt-6-astra',usage:{prompt_tokens:100,completion_tokens:100},
 choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer(symbol))}}]});}
function runnerFixture({claimMode='ACQUIRED',providerMode='COMPLETE',saved}={}){
 const calls=[],models=[],candidates=[];let stored=saved;
 return {calls,models,candidates,get saved(){return stored;},
  ports:{apiKey:'test-only-provider-key',
   rpc:async(name,args)=>{calls.push({name,args});assert.equal(name,'daily_stock_ai_rate_limit_recovery_job_v1');
    assert.equal(args.p_batch_id,batchId);assert.equal(args.p_symbol,'1035');assert.equal(args.p_review_document_hash,reviewHash);
    const expected=await identity('1035',stockAiRateLimitRecoveryRevision);assert.equal(args.p_key,expected.key);
    if(args.p_op==='CLAIM'){
     assert.deepEqual(args.p_context,{input_hash:expected.input_hash,model_revision:stockAiRateLimitRecoveryRevision,symbol:'1035',cutoff});
     assert.deepEqual(JSON.parse(args.p_identity_text),{version:'DAILY_AI_BATCH_1',input_hash:expected.input_hash,model_revision:stockAiRateLimitRecoveryRevision});
     return claimMode==='CACHED'?{state:'CACHED',result:stored}:claimMode==='ACQUIRED'?{state:'ACQUIRED',lease:'test-single-use-recovery-lease'}:{state:claimMode};
    }
    assert.equal(args.p_lease,'test-single-use-recovery-lease');
    if(args.p_op==='COMPLETE'){assert.equal(providerMode,'COMPLETE');assert.equal(candidates.length,1);assert.equal(args.p_result.publication_ready,false);
     assert.equal(args.p_result.input_hash,expected.input_hash);stored=args.p_result;return {state:'STORED'};}
    assert.equal(args.p_op,'FAIL');assert.equal(args.p_code,'STOCK_AI_PROVIDER_HTTP_429');return {state:'STORED'};
   },
   fetcher:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer test-only-provider-key');
    const request=JSON.parse(init.body),input=JSON.parse(request.messages[1].content);models.push({request,input,signal:init.signal});assert.equal(input.symbol,'1035');
    assert.equal(request.model,'gpt-6-astra');assert.equal(request.reasoning_effort,'low');assert.equal(request.max_completion_tokens,6000);
    for(const key of ['temperature','top_p','max_tokens'])assert(!Object.hasOwn(request,key));
    assert.equal(createHash('sha256').update(request.messages[0].content).digest('hex'),'e80a1a378ba20b2da963a431c1f85fedd3a87921a469e8e2f82c5626cc022b0b','exact original prompt7 instructions');
    assert(!request.messages[0].content.includes('本次為跨日引用修復'));assert(!request.messages[0].content.includes('本次另為每條主張完整引用的第二次修復'));
    assert.equal(request.response_format.json_schema.strict,true);assert.deepEqual(request.response_format.json_schema.schema.$defs.evidence_id.enum,['E1']);
    if(providerMode==='429')return new Response('private provider rate-limit detail',{status:429});
    if(providerMode==='HANG')return new Promise(()=>{});
    return providerResponse(input.symbol);
   },
   onCandidate:async(candidate,receipt,inputHash,packet)=>{candidates.push({candidate,receipt,inputHash,packet});assert.equal(candidate.symbol,'1035');assert.equal(packet.symbol,'1035');
    assert.equal(inputHash,(await identity('1035',stockAiRateLimitRecoveryRevision)).input_hash);assert.equal(receipt.response_id,'test-local-recovery-1035');},
  }};
}
test('actual runner routes all durable operations through the fenced wrapper and spends once on only its target',async()=>{
 const fixture=runnerFixture(),input=packets(),before=await snapshotHash(input);
 const result=await runStoredStockAiRateLimitRecovery(input,selector(),fixture.ports);
 assert.equal(result.model_calls,1);assert.equal(result.rows.filter(row=>row.state==='DEFERRED').length,71);assert.deepEqual(result.rows.find(row=>row.symbol==='1035'),{symbol:'1035',state:'COMPLETE'});
 assert.equal(fixture.models.length,1);assert.deepEqual(fixture.calls.map(call=>call.args.p_op),['CLAIM','COMPLETE']);assert.equal(fixture.candidates.length,1);
 assert.equal(await snapshotHash(input),before);assert.equal(result.member_published,false);assert.equal(result.complete,false);
 const cached=runnerFixture({claimMode:'CACHED',saved:fixture.saved}),cache=await runStoredStockAiRateLimitRecovery(input,selector(),cached.ports);
 assert.equal(cache.model_calls,0);assert.equal(cache.rows.find(row=>row.symbol==='1035').state,'CACHED');assert.equal(cached.models.length,0);assert.deepEqual(cached.calls.map(call=>call.args.p_op),['CLAIM']);
});
test('actual runner respects busy/exhausted claims without a provider request or a different stock',async()=>{
 for(const mode of ['BUSY','EXHAUSTED']){const fixture=runnerFixture({claimMode:mode}),result=await runStoredStockAiRateLimitRecovery(packets(),selector(),fixture.ports);
  assert.equal(result.model_calls,0);assert.equal(fixture.models.length,0);assert.equal(fixture.candidates.length,0);assert.deepEqual(fixture.calls.map(call=>call.args.p_op),['CLAIM']);
  const target=result.rows.find(row=>row.symbol==='1035');assert.equal(target.state,mode==='BUSY'?'BUSY':'FAILED');if(mode==='EXHAUSTED')assert.equal(target.code,'AI_BATCH_ATTEMPTS_EXHAUSTED');
  assert(result.rows.filter(row=>row.symbol!=='1035').every(row=>row.state==='DEFERRED'));
 }
});
test('exact429 causes one provider call and one confirmed FAIL, with no repair, retry, continuation or publication',async()=>{
 const fixture=runnerFixture({providerMode:'429'});
 const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({runRecovery:(ps,s,signal)=>runStoredStockAiRateLimitRecovery(ps,s,{...fixture.ports,signal})})),207);
 assert.equal(r.state,'FAILED');assert.equal(r.code,'STOCK_AI_PROVIDER_HTTP_429');assert.equal(r.model_calls,1);noContinuation(r);
 assert.equal(fixture.models.length,1);assert.equal(fixture.candidates.length,0);assert.deepEqual(fixture.calls.map(call=>call.args.p_op),['CLAIM','FAIL']);
 assert(!JSON.stringify(r).includes('private'));assert(!fixture.calls.some(call=>/dispatch|stage|publish/.test(call.name)));
});
test('actual handler deadline aborts the provider and leaves unknown paid work without an unsafe FAIL or second claim',async()=>{
 const fixture=runnerFixture({providerMode:'HANG'});
 const r=await body(await handleDailyStockRateLimitRecovery(request(),ports({runRecovery:(ps,s,signal)=>runStoredStockAiRateLimitRecovery(ps,s,{...fixture.ports,signal})}),{loadMs:100,runMs:30}),503);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(r.error,'STOCK_ANALYSIS_TIMEOUT');noContinuation(r);
 assert.equal(fixture.models.length,1);assert.equal(fixture.models[0].signal.aborted,true);assert.deepEqual(fixture.calls.map(call=>call.args.p_op),['CLAIM']);
 assert.equal(fixture.candidates.length,0);
});
test('an already-aborted recovery or invalid universe cannot claim or spend',async()=>{
 const controller=new AbortController();controller.abort();const fixture=runnerFixture();
 await assert.rejects(()=>runStoredStockAiRateLimitRecovery(packets(),selector(),{...fixture.ports,signal:controller.signal}),/AI_ANALYSIS_ABORTED/);
 await assert.rejects(()=>runStoredStockAiRateLimitRecovery(packets().slice(0,71),selector(),fixture.ports),/AI_BATCH_SCOPE/);
 assert.equal(fixture.calls.length,0);assert.equal(fixture.models.length,0);
});
