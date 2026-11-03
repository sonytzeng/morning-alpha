// Historical synthetic protocol coverage; current policy is verified separately in dailyStockAiCurrentPolicyBoundary.test.mjs.
import {historicalStockAiProtocolTest as test,importStockAiHistoricalModule} from './helpers/stockAiHistoricalProtocol.mjs';
import assert from 'node:assert/strict';
const {analyseStockWithProvider,readStockAiProviderFailure}=await importStockAiHistoricalModule('supabase/functions/_shared/daily-stock-ai.ts');

const packet={symbol:'2330',company:'測試公司',cutoff:'2026-10-30T12:00:00Z',evidence:[{id:'E1',symbol:'2330',kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試資料，不是真實股票分析'}]};
const privateText='private-message sk-test-secret owner@example.test packet-and-prompt';
const failure=(code,type,headers={})=>Response.json({error:{code,type,message:privateText,param:privateText},private:privateText},{status:429,headers});

test('quota and transient rate limits retain only allowlisted diagnostics while preserving the breaker code and one fetch',async()=>{
 for(const [code,type,classification] of [['insufficient_quota','insufficient_quota','QUOTA'],['rate_limit_exceeded','invalid_request_error','RATE_LIMIT'],['slow_down','rate_limit_error','RATE_LIMIT'],
  ['credit_balance_exhausted','insufficient_quota','QUOTA'],['organization_spend_limit_exceeded','insufficient_quota','QUOTA'],['project_spend_limit_exceeded','insufficient_quota','QUOTA'],['organization_usage_limit_exceeded','insufficient_quota','QUOTA'],['unknown-private-code',privateText,'UNKNOWN_429']]){
  let calls=0,diagnostic;
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'sk-test-secret',model:'test-model',fetcher:async()=>{calls++;return failure(code,type,{'x-request-id':'req_test_request_1','retry-after':'13'});},
   onProviderFailure:d=>{diagnostic=d;}}),{message:'STOCK_AI_PROVIDER_HTTP_429'});
  assert.equal(calls,1);assert.equal(diagnostic.classification,classification);
  assert.equal(diagnostic.error_code,code==='unknown-private-code'?null:code);assert.equal(diagnostic.error_type,type===privateText?null:type);
  assert.equal(diagnostic.request_id,'req_test_request_1');assert.equal(diagnostic.retry_after_seconds,13);assert.equal(diagnostic.body_state,'PARSED');
  const encoded=JSON.stringify(diagnostic);for(const secret of [privateText,'sk-test-secret','owner@example.test','unknown-private-code','Bearer'])assert(!encoded.includes(secret),secret);
  assert(Object.isFrozen(diagnostic));
 }
});

test('malformed, oversized, absent and non-JSON error bodies keep the original HTTP error and cancel bounded reads',async()=>{
 for(const [make,state] of [
  [()=>new Response('{not-json',{status:429}),'INVALID'],
  [()=>new Response(null,{status:429}),'UNAVAILABLE'],
  [()=>new Response('<html>'+privateText+'</html>',{status:429}),'INVALID'],
  [()=>new Response('x'.repeat(16385),{status:429}),'OVERSIZED'],
 ]){
  let diagnostic,calls=0;
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test',model:'test-model',fetcher:async()=>{calls++;return make();},onProviderFailure:d=>{diagnostic=d;}}),{message:'STOCK_AI_PROVIDER_HTTP_429'});
  assert.equal(calls,1);assert.equal(diagnostic.body_state,state);assert.equal(diagnostic.classification,'UNKNOWN_429');
  assert.equal(diagnostic.error_code,null);assert(!JSON.stringify(diagnostic).includes(privateText));
 }
 let cancelled=false,reads=0;
 const response=new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;return new Promise(()=>{});}}),{status:429});
 const diagnostic=await readStockAiProviderFailure(response);
 assert.equal(diagnostic.body_state,'OVERSIZED');assert(cancelled);assert(reads<=2);assert.equal(response.body.locked,false);
 let touched=false,cancelledDeclared=false;
 const declared=new Response(new ReadableStream({pull(){touched=true;},cancel(){cancelledDeclared=true;}},{highWaterMark:0}),{status:429,headers:{'content-length':'16385'}});
 assert.equal((await readStockAiProviderFailure(declared)).body_state,'OVERSIZED');assert(cancelledDeclared);
 assert.equal(touched,false);assert.equal(declared.body.locked,false);
});

test('stalled error streams have a diagnostic deadline without retrying or blocking cancellation',async()=>{
 let cancelled=false,diagnostic,calls=0;
 const started=performance.now();
 await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test',model:'test-model',fetcher:async()=>{calls++;return new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});}}),{status:429});},
  onProviderFailure:d=>{diagnostic=d;}}),{message:'STOCK_AI_PROVIDER_HTTP_429'});
 assert.equal(calls,1);assert.equal(diagnostic.body_state,'DEADLINE');assert(cancelled);assert(performance.now()-started<2000);
});

test('perpetual empty chunks are bounded independently of bytes and release the stream without retrying',async()=>{
 let cancelled=false,pulls=0,diagnostic,calls=0,response;
 const started=performance.now();
 await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test',model:'test-model',fetcher:async()=>{
  calls++;response=new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(0));},cancel(){cancelled=true;return new Promise(()=>{});}},{highWaterMark:0}),{status:429});return response;
 },onProviderFailure:d=>{diagnostic=d;}}),{message:'STOCK_AI_PROVIDER_HTTP_429'});
 assert.equal(calls,1);assert.equal(diagnostic.body_state,'OVERSIZED');assert.equal(diagnostic.classification,'UNKNOWN_429');
 assert.equal(pulls,128);assert(cancelled);assert.equal(response.body.locked,false);assert(performance.now()-started<1000);
});

test('unsafe headers and unrecognized error fields cannot enter diagnostic records',async()=>{
 for(const headers of [{'x-request-id':privateText,'retry-after':privateText},{'x-request-id':'req_'+ 'x'.repeat(100),'retry-after':'999999'},{'x-request-id':'req_valid','retry-after':'-1'}]){
  const d=await readStockAiProviderFailure(failure(privateText,privateText,headers));
  assert.equal(d.error_code,null);assert.equal(d.error_type,null);assert.equal(d.retry_after_seconds,null);
  if(headers['x-request-id']!=='req_valid')assert.equal(d.request_id,null);
  assert(!JSON.stringify(d).includes(privateText));
 }
 const httpDate=new Date(Date.now()+60000).toUTCString();
 const d=await readStockAiProviderFailure(failure('rate_limit_exceeded','invalid_request_error',{'retry-after':httpDate,'x-request-id':'01234567-89ab-cdef-0123-456789abcdef'}));
 assert(d.retry_after_seconds>=59&&d.retry_after_seconds<=60);assert.equal(d.request_id,'01234567-89ab-cdef-0123-456789abcdef');
 for(const value of ['2026-11-01','Infinity','0.5','Mon, 99 Jan 2026 99:99:99 GMT'])assert.equal((await readStockAiProviderFailure(failure(null,null,{'retry-after':value}))).retry_after_seconds,null);
});

test('diagnostic observer failures and malformed error streams cannot replace the job failure code',async()=>{
 for(const onProviderFailure of [()=>{throw Error(privateText);},async()=>{throw Error(privateText);},d=>{d.error_code=privateText;}]){
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test',model:'test-model',fetcher:async()=>failure('insufficient_quota','insufficient_quota'),onProviderFailure}),{message:'STOCK_AI_PROVIDER_HTTP_429'});
 }
 const response=new Response(new ReadableStream({start(controller){controller.error(Error(privateText));}}),{status:503});
 const d=await readStockAiProviderFailure(response);assert.equal(d.http_status,503);assert.equal(d.body_state,'INVALID');assert.equal(d.classification,'OTHER_HTTP');
 const locked=failure('insufficient_quota','insufficient_quota'),reader=locked.body.getReader();
 assert.equal((await readStockAiProviderFailure(locked)).body_state,'UNAVAILABLE');await reader.cancel();reader.releaseLock();
 const aborted=new AbortController();aborted.abort();
 const stalled=new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{status:429});
 assert.equal((await readStockAiProviderFailure(stalled,aborted.signal)).body_state,'DEADLINE');
});

test('default worker log is structured and contains no raw provider error or credentials',async()=>{
 const original=console.warn,logs=[];console.warn=(...args)=>logs.push(args);
 try{
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'sk-test-secret',model:'test-model',fetcher:async()=>failure('insufficient_quota','insufficient_quota',{'x-request-id':'req_test'})}),{message:'STOCK_AI_PROVIDER_HTTP_429'});
 }finally{console.warn=original;}
 assert.equal(logs.length,1);assert.equal(logs[0][0],'STOCK_AI_PROVIDER_FAILURE');
 const diagnostic=JSON.parse(logs[0][1]);assert.equal(diagnostic.classification,'QUOTA');assert.equal(diagnostic.http_status,429);
 assert(!JSON.stringify(logs).includes(privateText));assert(!JSON.stringify(logs).includes('sk-test-secret'));
});
