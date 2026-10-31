import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDailyStockSource} from '../supabase/functions/daily-stock-analysis-v1/source-handler.ts';

const secret='test-source-worker-secret-0123456789',intakeId='11111111-1111-4111-8111-111111111111',batchId='a'.repeat(64);
const request=(body={intake_id:intakeId},headers={'x-vnext-internal':secret})=>new Request('https://source-worker.test',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
const ports=(overrides={})=>({internalSecret:secret,runSource:async()=>({state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:batchId,analysis_dispatched:true}),...overrides});
const noWork=()=>ports({runSource:async()=>assert.fail('must stop before source acquisition')});
async function assertResponse(response,status,expected){
 assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.equal(body.model_calls,0);assert.equal(body.member_published,false);
 for(const [key,value] of Object.entries(expected))assert.deepEqual(body[key],value);return body;
}
test('method, Origin and internal authentication are rejected before source work',async()=>{
 await assertResponse(await handleDailyStockSource(new Request('https://source-worker.test'),noWork()),405,{error:'METHOD_NOT_ALLOWED'});
 await assertResponse(await handleDailyStockSource(request(undefined,{'x-vnext-internal':secret,origin:'https://member.test'}),noWork()),403,{error:'SERVER_ONLY'});
 for(const headers of [{},{'x-vnext-internal':'wrong'},{'x-daily-delivery-token':secret}]){
  await assertResponse(await handleDailyStockSource(request(undefined,headers),noWork()),401,{error:'INTERNAL_AUTH_REQUIRED'});
 }
 await assertResponse(await handleDailyStockSource(request(),ports({internalSecret:'short',runSource:async()=>assert.fail()})),401,{error:'INTERNAL_AUTH_REQUIRED'});
});
test('only an exact UUID intake selector is accepted; raw inputs, prices, models and alternate selectors stop early',async()=>{
 for(const body of [null,[],{},'{',{intake_id:'bad'},{intake_id:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'},
  {intake_id:intakeId,inputs:[]},{intake_id:intakeId,model:'other'},{intake_id:intakeId,maxStocks:72},
  {intake_id:intakeId,price:100},{cutoff:'2026-10-30T12:00:00Z'},{batch_id:batchId},{intake_id:intakeId,batch_id:batchId}]){
  await assertResponse(await handleDailyStockSource(request(body),noWork()),422,{error:'SCOPE_INVALID'});
 }
});
test('request body size is limited by actual UTF-8 bytes and declared length',async()=>{
 for(const [body,headers] of [['x'.repeat(513),undefined],['界'.repeat(200),undefined],
  [JSON.stringify({intake_id:intakeId}),{'x-vnext-internal':secret,'content-length':'513'}],
  [JSON.stringify({intake_id:intakeId}),{'x-vnext-internal':secret,'content-length':'invalid'}]]){
  await assertResponse(await handleDailyStockSource(request(body,headers),noWork()),413,{error:'INPUT_LIMIT'});
 }
});
test('prepared source progress is honest, bounded to one intake, and whitelisted without model or member publication',async()=>{
 for(const dispatched of [true,false]){
  let received,signal;
  const response=await handleDailyStockSource(request(),ports({runSource:async(id,s)=>{
   received=id;signal=s;return {state:'SOURCE_PREPARED',intake_id:id,batch_id:batchId,analysis_dispatched:dispatched,
    raw_payload:{secret:'private source text'},provider_receipt:'private receipt',lease:'private lease'};
  }}));
  const body=await assertResponse(response,202,{state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:batchId,analysis_dispatched:dispatched});
  assert.equal(received,intakeId);assert.equal(signal.aborted,true);
  assert.deepEqual(Object.keys(body).sort(),['state','intake_id','batch_id','analysis_dispatched','model_calls','member_published'].sort());
  assert(!JSON.stringify(body).includes('private'));assert(!JSON.stringify(body).includes(secret));
 }
});
test('busy, exhausted, expired and unavailable remain distinct truthful checkpoints',async()=>{
 for(const state of ['BUSY','EXHAUSTED','EXPIRED','SOURCE_UNAVAILABLE']){
  const body=await assertResponse(await handleDailyStockSource(request(),ports({runSource:async()=>({state,intake_id:intakeId,
   raw_payload:'private bytes'})})),state==='BUSY'?202:409,{state,intake_id:intakeId});
  assert.deepEqual(Object.keys(body).sort(),['state','intake_id','model_calls','member_published'].sort());
 }
});
test('changed intake IDs, unconfirmed batch identities and inconsistent execution claims cannot report preparation success',async()=>{
 const valid={state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:batchId,analysis_dispatched:true};
 for(const result of [null,[],{}, {...valid,intake_id:'22222222-2222-4222-8222-222222222222'},
  {...valid,state:'COMPLETE'},{...valid,state:new String('BUSY')},{...valid,batch_id:undefined},{...valid,batch_id:'wrong'},{...valid,batch_id:batchId.toUpperCase()},
  {...valid,analysis_dispatched:undefined},{...valid,analysis_dispatched:'true'},{...valid,model_calls:1},{...valid,member_published:true},
  {state:'BUSY',intake_id:intakeId,analysis_dispatched:'yes'}]){
  const body=await assertResponse(await handleDailyStockSource(request(),ports({runSource:async()=>result})),409,{error:'STOCK_SOURCE_REJECTED'});
  assert(!Object.hasOwn(body,'batch_id'));assert(!Object.hasOwn(body,'analysis_dispatched'));
 }
});
test('configuration bounds reject invalid deadlines before source work',async()=>{
 for(const runMs of [0,-1,1.5,45001,NaN])await assertResponse(await handleDailyStockSource(request(),noWork(),{runMs}),500,{error:'WORKER_CONFIGURATION_INVALID'});
});
test('a stalled acquisition receives cancellation and returns a sanitized retryable timeout',async()=>{
 let signal;
 const body=await assertResponse(await handleDailyStockSource(request(),ports({runSource:async(_id,s)=>{signal=s;return new Promise(()=>{});}}),{runMs:5}),503,{error:'STOCK_SOURCE_TIMEOUT'});
 assert.equal(signal.aborted,true);assert(!Object.hasOwn(body,'state'));
});
test('source exceptions do not leak provider bodies, request identifiers or credentials',async()=>{
 const body=await assertResponse(await handleDailyStockSource(request(),ports({runSource:async()=>{throw Error('private provider details '+secret);}})),409,{error:'STOCK_SOURCE_REJECTED'});
 assert(!JSON.stringify(body).includes('private'));assert(!JSON.stringify(body).includes(secret));
});
