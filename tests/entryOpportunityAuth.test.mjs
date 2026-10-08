import test from 'node:test';
import assert from 'node:assert/strict';
import {entryWorkerHeaders,authorizeEntryWorker} from '../supabase/functions/entry-opportunity-shadow-v1/worker-auth.mjs';
import {callEntryHistorical,ENTRY_ENDPOINT,ENTRY_REPLAY_SOURCES} from '../scripts/entry-worker-caller.mjs';
const token='SYNTHETIC_ENTRY_WORKER_ONLY_NOT_A_REAL_SECRET_123456789';
const now=1791475000000,body=JSON.stringify({source_run_id:ENTRY_REPLAY_SOURCES['2026-10-07'],mode:'HISTORICAL_REPLAY'});
test('dedicated proof is body/audience bound, expires, and never transports the secret',async()=>{
 const h=await entryWorkerHeaders(token,body,now);
 assert(!JSON.stringify(h).includes(token));assert((await authorizeEntryWorker(new Headers(h),body,token,now)).ok);
 assert.equal((await authorizeEntryWorker(new Headers(h),body,token,now+300001)).reason,'ENTRY_AUTH_EXPIRED');
 assert.equal((await authorizeEntryWorker(new Headers(h),body,token,now-30001)).reason,'ENTRY_AUTH_EXPIRED');
 assert.equal((await authorizeEntryWorker(new Headers(h),body+' ',token,now)).reason,'ENTRY_AUTH_INVALID');
 assert.equal((await authorizeEntryWorker(new Headers(h),body,token+'x',now)).reason,'ENTRY_AUTH_INVALID');
 assert.equal((await authorizeEntryWorker(new Headers(h),body,'',now)).reason,'ENTRY_WORKER_UNCONFIGURED');
 for(const extra of [{origin:'https://morningalphatw.com'},{referer:'https://morningalphatw.com/account'},{'sec-fetch-site':'same-origin'}])
  assert.equal((await authorizeEntryWorker(new Headers({...h,...extra}),body,token,now)).reason,'ENTRY_SERVER_ONLY');
 for(const headers of [{},{authorization:'Bearer OWNER'},{authorization:'Bearer MEMBER'},{apikey:'SERVICE_ROLE'},{'x-cron-secret':'LEGACY'},
  {...h,'x-entry-worker-version':'2'},{...h,'x-entry-worker-signature':'bad'},{...h,'x-entry-worker-issued-at':'NaN'},
  {...h,'x-entry-worker-issued-at':String(now-1)}])assert.equal((await authorizeEntryWorker(new Headers(headers),body,token,now)).ok,false);
});
test('controlled caller only permits the two retained histories, one request, sanitized receipt',async()=>{
 let calls=0;
 const opts={readWorkerToken:async()=>token,readGatewayJwt:async()=>'eyJ0ZXN0.test.signature',transport:async(url,init)=>{
  calls++;assert.equal(url,ENTRY_ENDPOINT);assert.equal(init.redirect,'error');
  assert.equal(init.headers.Authorization,'Bearer eyJ0ZXN0.test.signature');assert(!JSON.stringify(init).includes(token));
  const p=JSON.parse(init.body);assert.equal(p.mode,'HISTORICAL_REPLAY');assert(Object.values(ENTRY_REPLAY_SOURCES).includes(p.source_run_id));
  assert((await authorizeEntryWorker(new Headers(init.headers),init.body,token)).ok);
  return Response.json({shadow_only:true,business_writes:[],universe:72,receipt:{status:'STORED',run_id:'30000000-0000-4000-8000-000000000001'},
   counts:{ENTRY_READY:0,WAIT_CONFIRMATION:26,AVOID_ENTRY:154,INSUFFICIENT_EVIDENCE:36}});
 }};
 assert((await callEntryHistorical({...opts,date:'2026-10-07'})).ok);assert.equal(calls,1);
 await assert.rejects(callEntryHistorical({...opts,date:'2026-10-09'}),/SCOPE/);assert.equal(calls,1);
 const result=await callEntryHistorical({...opts,date:'2026-10-08',transport:async()=>Response.json({error:'private data MUST NOT LEAK'},{status:401})});
 assert.deepEqual(result,{http:401,ok:false,reason:'ENTRY_REQUEST_REJECTED'});
});
