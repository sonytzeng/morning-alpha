import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {authorizeShadowWorker,shadowWorkerHeaders,permittedShadowReplay} from '../supabase/functions/_shared/shadow-worker-auth.mjs';
import {callHistoricalShadow,runHistoricalShadowBatch,SHADOW_ENDPOINT} from '../scripts/research-shadow-caller.mjs';

const identity=()=>randomBytes(32).toString('base64url');
test('dedicated identity only; gateway Authorization/apikey cannot select another auth branch',async()=>{
 const token=identity(),now=Date.now(),h=()=>new Headers(shadowWorkerHeaders(token,now));
 assert.equal((await authorizeShadowWorker(h(),token,now)).ok,true);
 const gateway=h();gateway.set('authorization','Bearer ISOLATED_GATEWAY');gateway.set('apikey','ISOLATED_GATEWAY');
 assert.equal((await authorizeShadowWorker(gateway,token,now)).ok,true);
 for(const headers of [{},{'x-cron-secret':token},{authorization:'Bearer '+token},{apikey:token}])
  assert.equal((await authorizeShadowWorker(new Headers(headers),token,now)).reason,'AUTH_MISSING');
 assert.equal((await authorizeShadowWorker(new Headers(shadowWorkerHeaders(identity(),now)),token,now)).reason,'AUTH_INVALID');
 const serverFetch=h();serverFetch.set('sec-fetch-mode','cors');assert.equal((await authorizeShadowWorker(serverFetch,token,now)).ok,true);
 for(const field of ['origin','referer','sec-fetch-site']){const x=h();x.set(field,'browser');assert.equal((await authorizeShadowWorker(x,token,now)).reason,'AUTH_INVALID');}
 const wrongVersion=h();wrongVersion.set('x-shadow-worker-version','2');
 assert.equal((await authorizeShadowWorker(wrongVersion,token,now)).reason,'AUTH_VERSION_MISMATCH');
 for(const offset of [-300001,30001])assert.equal((await authorizeShadowWorker(new Headers(shadowWorkerHeaders(token,now+offset)),token,now)).reason,'AUTH_EXPIRED');
 for(const offset of [-300000,30000])assert.equal((await authorizeShadowWorker(new Headers(shadowWorkerHeaders(token,now+offset)),token,now)).ok,true);
 assert.equal((await authorizeShadowWorker(h(),undefined,now)).stage,'WORKER_CONFIGURATION');
 assert.equal((await authorizeShadowWorker(h(),'short',now)).ok,false);
});
test('worker operation/date/cutoff allowlist prevents privileged arbitrary RPC and Forward',()=>{
 const allowed={operation:'ANALYZE',business_date:'2026-09-30',analysis_cutoff_at:'2026-09-30T07:30:00+08:00',observation_kind:'HISTORICAL_REPLAY'};
 assert(permittedShadowReplay(allowed));
 for(const input of [null,[],{...allowed,operation:'LINK_OUTCOME'},{...allowed,observation_kind:'FORWARD'},
  {...allowed,analysis_cutoff_at:'2026-09-30T14:30:00+08:00'},{...allowed,rpc:'reports'},{...allowed,business_date:'2026-10-06'}])assert.equal(permittedShadowReplay(input),false);
});
test('controlled caller fixes destination, request, dedicated headers, no redirect/retry and redacts output',async()=>{
 let calls=0,reads=0;const token=identity();
 const receipt={status:'RECORDED',mode:'SHADOW_ONLY',production_writes:0,analysis_id:'10000000-0000-4000-8000-000000000001',prediction_hash:'a'.repeat(64)};
 const options={date:'2026-09-30',readWorkerToken:async()=>{reads++;return token;},transport:async(url,init)=>{
  calls++;assert.equal(url,SHADOW_ENDPOINT);assert.equal(init.redirect,'error');assert.equal(init.headers['x-shadow-worker-token'],token);
  assert.equal(init.headers.apikey,undefined);assert.equal(init.headers.Authorization,undefined);
  assert(permittedShadowReplay(JSON.parse(init.body)));return Response.json({...receipt,secret_echo:token});}};
 const result=await callHistoricalShadow(options);assert.equal(result.ok,true);assert(!JSON.stringify(result).includes(token));assert.equal(calls,1);
 for(const endpoint of ['https://attacker.invalid/','https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/reports','http://127.0.0.1:9000/other'])
  await assert.rejects(()=>callHistoricalShadow({...options,endpoint}),/DESTINATION_DENIED/);
 await assert.rejects(()=>callHistoricalShadow({...options,date:'2026-10-06'}),/OPERATION_DENIED/);
 assert.equal(reads,1,'invalid requests cannot even acquire a credential');
 const failed=await runHistoricalShadowBatch({...options,transport:async()=>{calls++;return Response.json({error:'AUTH_INVALID',echo:token},{status:401});}});
 assert.equal(failed.ok,false);assert.equal(failed.receipts.length,1);assert.equal(calls,2);assert(!JSON.stringify(failed).includes(token));
 await assert.rejects(()=>callHistoricalShadow({...options,transport:async()=>{throw Error(token);}}),/^Error: SHADOW_CALL_FAILED$/);
});
test('batch has three first calls then exactly three idempotent repeats',async()=>{
 const requests=[];
 const result=await runHistoricalShadowBatch({readWorkerToken:async()=>identity(),transport:async(url,init)=>{
  requests.push(JSON.parse(init.body).business_date);
  return Response.json({status:requests.length<=3?'RECORDED':'ALREADY_RECORDED',mode:'SHADOW_ONLY',production_writes:0,
   analysis_id:'10000000-0000-4000-8000-000000000001',prediction_hash:'b'.repeat(64)});
 }});
 assert.equal(result.ok,true);assert.deepEqual(requests,['2026-09-30','2026-10-01','2026-10-02','2026-09-30','2026-10-01','2026-10-02']);
});
