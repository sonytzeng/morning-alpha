// Real worker Handler + internal validator; dependency-boundary fixtures only.
// SQL lineage/leases are exercised separately against the Fresh DB candidate.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import * as auth from '../supabase/functions/_shared/internal-function-auth.mjs';
import * as runtime from '../supabase/functions/_shared/recommendation-shadow-v2-runtime.ts';
import * as forward from '../src/features/research/recommendation-v2-forward.ts';
import * as engine from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import * as outcomes from '../supabase/functions/_shared/recommendation-v2-forward-outcomes.ts';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
const code=ts.transpileModule(readFileSync(new URL('../supabase/functions/recommendation-v2-forward-worker-v1/index.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function harness({state='ACQUIRED',prior=null,fail=false}={}){
 const calls=[],background=[],dispatch=[],env={CRON_SECRET:'SYNTHETIC_INTERNAL_ONLY',SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:'SYNTHETIC_SERVICE_ONLY',RECOMMENDATION_GATEWAY_ANON_JWT:'SYNTHETIC_GATEWAY_ONLY'};
 const fixture=v2Fixture(new Date().toISOString());const capsule=await runtime.buildV2Capsule(fixture);
 const db={rpc:async(name,args)=>{calls.push({name,args});if(name==='claim_recommendation_v2_forward')return {data:{status:state,job_id:'fixture-job',lease_id:'fixture-lease',source_revision:fixture.identity.revision_id},error:null};
  if(name==='claim_recommendation_v2_outcome_work')return {data:{status:'ACQUIRED'},error:null};
  if(name==='pending_recommendation_shadow_v2'||name==='pending_owner_v2_experiments')return {data:[],error:null};
  return {data:{status:'COMPLETE'},error:fail&&name==='store_recommendation_shadow_v2'?true:null};},from(){const q={select(){return q;},eq(){return q;},order(){return q;},async limit(){return {data:prior?[{result:prior}]:[],error:null};}};return q;}};
 let handler;const exports={};
 const denyFetch=async(url,init)=>{assert.equal(url,env.SUPABASE_URL+'/functions/v1/recommendation-v2-forward-worker-v1');const b=JSON.parse(init.body);assert.equal(b.operation,'OUTCOMES');dispatch.push(b);return new Response('{}',{status:202});};
 vm.runInNewContext(code,{exports,Request,Response,AbortSignal,Date,JSON,fetch:denyFetch,console:{log(){throw Error('NO_LOGGING');}},
  Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}},EdgeRuntime:{waitUntil:p=>background.push(p)},require:n=>{
   if(n.startsWith('https://esm.sh'))return {createClient:()=>db};
   if(n.endsWith('internal-function-auth.mjs'))return {...auth,internalCredentialsFromEnv:()=>auth.internalCredentialsFromEnv({get:k=>env[k]}),buildInternalFunctionHeaders:opts=>auth.buildInternalFunctionHeaders({...opts,version:'v1'})};
   if(n.endsWith('recommendation-producer.ts'))return {requestRecommendationProof:async o=>{calls.push({name:'SOURCE_ACQUISITION',caller:o.caller});await o.onVerifiedProof({shadow_v2:capsule});}};
   if(n.endsWith('recommendation-shadow-v2-runtime.ts'))return runtime;
   if(n.endsWith('recommendation-v2-forward.ts'))return forward;
   if(n.endsWith('recommendation-v2-forward-outcomes.ts'))return outcomes;
   if(n.endsWith('recommendation-shadow-v2-engine.ts'))return engine;
   throw Error('UNEXPECTED_IMPORT:'+n);
  }});
 const invoke=async(body,headers={'x-cron-secret':env.CRON_SECRET})=>{const response=await handler(new Request('http://127.0.0.1:1',{method:'POST',headers,body:JSON.stringify(body)}));await Promise.all(background);return {status:response.status,data:await response.json()};};
 return {invoke,calls,dispatch,fixture};
}
test('real internal auth rejects anonymous, wrong, browser and member identity before DB',async()=>{
 const h=await harness();for(const headers of [{},{authorization:'Bearer fixture-member'},{'x-cron-secret':'wrong'}])assert.equal((await h.invoke({},headers)).status,401);
 assert.equal((await h.invoke({},{origin:'https://morningalphatw.com','x-cron-secret':'SYNTHETIC_INTERNAL_ONLY'})).status,403);
 assert.equal(h.calls.length,0);assert.equal(h.dispatch.length,0);
});
test('complete natural core dependency routes one shared acquisition, immutable store and separate outcome dispatch',async()=>{
 const h=await harness();const r=await h.invoke({business_date:h.fixture.identity.report_date,evaluation_phase:'PREMARKET',source_batch_id:'fixture'});
 assert.equal(r.status,202);assert.deepEqual(r.data.business_writes,[]);
 assert.equal(h.calls.filter(c=>c.name==='SOURCE_ACQUISITION').length,1);assert.equal(h.calls.find(c=>c.name==='SOURCE_ACQUISITION').caller,'recommendation-v2-forward-worker-v1');
 const store=h.calls.find(c=>c.name==='store_recommendation_shadow_v2');assert.equal(store.args.p_phase,'PREMARKET');assert.equal(store.args.p_snapshot.scanned,72);
 assert.equal(h.calls.find(c=>c.name==='finish_recommendation_v2_forward').args.p_status,'COMPLETE');assert.equal(h.dispatch.length,1);
});
test('research DB failure never calls Core, Report or LINE and leaves retryable job failure',async()=>{
 const h=await harness({fail:true});await h.invoke({business_date:h.fixture.identity.report_date,evaluation_phase:'PREMARKET',source_batch_id:'fixture'});
 assert.equal(h.calls.find(c=>c.name==='finish_recommendation_v2_forward').args.p_status,'FAILED');assert.equal(h.dispatch.length,0);
});
test('premarket NONE means no duplicate 72 acquisition at each intraday checkpoint; outcomes still run',async()=>{
 const h=await harness({prior:{counts:{WATCH:0,BLOCKED:0,NONE:72,READY:0}}});await h.invoke({business_date:h.fixture.identity.report_date,evaluation_phase:'09:30',source_batch_id:'fixture'});
 assert(!h.calls.some(c=>c.name==='SOURCE_ACQUISITION'));assert.equal(h.calls.find(c=>c.name==='finish_recommendation_v2_forward').args.p_status,'SKIPPED_NO_WATCH');assert.equal(h.dispatch.length,1);
});
test('outcome-only empty queue makes no provider requests or fake result; duplicate completed phase never reacquires',async()=>{
 const h=await harness();assert.equal((await h.invoke({operation:'OUTCOMES',job_id:'fixture',lease_id:'fixture'})).status,202);
 assert.equal(h.calls.find(c=>c.name==='finish_recommendation_v2_outcome_work').args.p_complete,true);assert.equal(h.dispatch.length,0);
 const duplicate=await harness({state:'COMPLETE'});assert.equal((await duplicate.invoke({business_date:'2026-10-07',evaluation_phase:'14:30',source_batch_id:'fixture'})).status,200);assert(!duplicate.calls.some(c=>c.name==='SOURCE_ACQUISITION'));
});
