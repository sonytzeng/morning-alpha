import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recommendationJsonStream} from '../supabase/functions/_shared/recommendation-stream.ts';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('paced acquisition sends immediate whitespace and one complete unchanged JSON proof',async()=>{
 let release;const ready=new Promise(r=>{release=r});const expected={decision:{id:'synthetic'},business_writes:[]};
 const response=recommendationJsonStream(async()=>{await ready;return Response.json(expected)},new AbortController().signal,{heartbeatMs:5,deadlineMs:1000});
 const reader=response.body.getReader();assert.equal(new TextDecoder().decode((await reader.read()).value),'\n');
 assert.equal(new TextDecoder().decode((await reader.read()).value),'\n');release();
 let text='';while(true){const r=await reader.read();if(r.done)break;text+=new TextDecoder().decode(r.value);}
 assert.deepEqual(JSON.parse(text),{...expected,transport_result_status:200});
});
test('transport HTTP200 never hides inner failure or leaks thrown content',async()=>{
 for(const status of [401,403,422,500]){
  const response=recommendationJsonStream(async()=>Response.json({error:'EXPECTED'}, {status}),new AbortController().signal);
  assert.equal((await response.json()).transport_result_status,status);
 }
 const r=recommendationJsonStream(async()=>{throw Error('FAKE_SECRET_MUST_NOT_ESCAPE')},new AbortController().signal);
 assert.deepEqual(await r.json(),{error:'RECOMMENDATION_TRANSPORT_FAILED',business_writes:[],transport_result_status:502});
});
test('deadline closes once, no late successful result; client cancel clears heartbeat',async()=>{
 const r=recommendationJsonStream(async()=>{await pause(30);return Response.json({late:true})},new AbortController().signal,{heartbeatMs:2,deadlineMs:10});
 assert.equal((await r.json()).transport_result_status,504);await pause(35);
 const cancelled=recommendationJsonStream(async()=>{await pause(10);return Response.json({late:true})},new AbortController().signal,{heartbeatMs:2,deadlineMs:100});
 await cancelled.body.cancel();await pause(15);
});
test('aborted request cannot start provider work',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 const r=recommendationJsonStream(async()=>{calls++;return Response.json({})},controller.signal);
 await assert.rejects(r.json(),/ABORTED/);assert.equal(calls,0);
});
test('stream is after unchanged auth and input gate, no credentials or business writes',()=>{
 const source=readFileSync(new URL('../supabase/functions/recommendation-stock-evidence-v1/index.ts',import.meta.url),'utf8');
 assert.ok(source.indexOf('if(!auth.ok)')<source.indexOf('const execute=async'));
 assert.ok(source.indexOf('LIVE_ACQUISITION_IDENTITY_INVALID')<source.indexOf('const execute=async'));
 assert.match(source,/scope==='SMOKE_2330'\?await execute\(\):recommendationJsonStream/);
 const caller=readFileSync(new URL('../supabase/functions/_shared/recommendation-producer.ts',import.meta.url),'utf8');
 assert.match(caller,/transport_result_status!==200\)return unavailable/);
});
