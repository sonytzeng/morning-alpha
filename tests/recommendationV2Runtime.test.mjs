import test from 'node:test';
import assert from 'node:assert/strict';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {buildV2Capsule,persistV2Sidecar,scheduleV2Sidecar} from '../supabase/functions/_shared/recommendation-shadow-v2-runtime.ts';
import {requestRecommendationProof} from '../supabase/functions/_shared/recommendation-producer.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

test('capsule minimizes source data and sidecar recomputes before storing',async()=>{
 const input=v2Fixture();input.data.quotes[0].unrelated_contact='DO_NOT_RETAIN';
 const c=await buildV2Capsule(input);assert(!c.evidence_text.includes('DO_NOT_RETAIN'));
 let stores=0;const transport={async storeRun(text,r){stores++;assert.equal(text,c.evidence_text);assert.deepEqual(r,c.result);return {error:null};},async pending(){return {data:[],error:null};},async storeOutcome(){throw Error('no pending predictions');}};
 assert.equal((await persistV2Sidecar(c,transport)).status,'SHADOW_STORED');assert.equal(stores,1);
 assert.equal((await persistV2Sidecar({...c,result:{...c.result,counts:{READY:999}}},transport)).status,'SHADOW_RESULT_MISMATCH');assert.equal(stores,1);
 assert.equal((await persistV2Sidecar({evidence_text:'bad'},transport)).status,'SHADOW_UNAVAILABLE');
});
test('store, outcome and transport faults fail open only for Shadow',async()=>{
 const c=await buildV2Capsule(v2Fixture());
 const t={storeRun:async()=>({error:null}),pending:async()=>({data:[],error:null}),storeOutcome:async()=>({error:null})};
 for(const [patch,status] of [[{storeRun:async()=>({error:'isolated'})},'SHADOW_STORE_UNAVAILABLE'],[{pending:async()=>({data:null,error:'isolated'})},'SHADOW_OUTCOMES_UNAVAILABLE'],[{pending:async()=>({data:Array(1801).fill({}),error:null})},'SHADOW_OUTCOME_BACKLOG_LIMIT'],[{storeRun:async()=>{throw Error('no network');}},'SHADOW_UNAVAILABLE']])assert.equal((await persistV2Sidecar(c,{...t,...patch})).status,status);
 assert.doesNotThrow(()=>scheduleV2Sidecar(c,t,()=>{throw Error('runtime missing');}));
 let calls=0;scheduleV2Sidecar(c,{...t,storeRun:async()=>{calls++;return {error:null};}},undefined);assert.equal(calls,0);
});
test('same authenticated natural caller proof and broken Shadow leave V1 decision unchanged',async()=>{
 const identity=v2Fixture().identity,decision={schema_version:'decision-evidence-v1',report_date:identity.report_date,revision_id:identity.revision_id,generated_at:identity.generated_at};
 const body={decision,acquisition:{synthetic:true},business_writes:[],shadow_v2:{evidence_text:'not json'}};
 const calls=[];let work;
 const result=await requestRecommendationProof({identity,url:'https://synthetic.invalid',cronSecret:'SYNTHETIC_NOT_REAL',serviceRoleKey:'SYNTHETIC_NOT_REAL',gatewayAnonJwt:'synthetic.test.only',fetcher:async(_url,init)=>{calls.push(JSON.parse(init.body));return Response.json(body);},onVerifiedProof:b=>scheduleV2Sidecar(b.shadow_v2,{storeRun:async()=>{throw Error('never');},pending:async()=>({data:[],error:null}),storeOutcome:async()=>({error:null})},p=>work=p)});
 assert.deepEqual(result.decision,decision);assert.equal((await work).status,'SHADOW_UNAVAILABLE');assert.equal(calls.length,1);assert.equal(calls[0].correlation_id,identity.revision_id);
});
test('all 72 locked stocks and five matured horizons use at most four outcome writers',async()=>{
 const input=v2Fixture(),c=await buildV2Capsule(input),first=input.captures[0].rows[0].trading_date;
 const lock=previousMarketTradingDate('TW',first)+'T08:00:00+08:00';
 const pending=input.captures.map((r,i)=>({id:'SYNTHETIC_'+i,symbol:r.symbol,methodology_version:c.result.methodology_version,observation_kind:'FORWARD',locked_at:lock,cutoff:lock,input_sha256:'a'.repeat(64),status:'READY',entry:{not_before:first,trigger_price:100,invalidation_price:95}}));
 let concurrent=0,max=0,calls=0;
 const result=await persistV2Sidecar(c,{storeRun:async()=>({error:null}),pending:async()=>({data:pending,error:null}),storeOutcome:async()=>{concurrent++;max=Math.max(max,concurrent);await new Promise(r=>setTimeout(r,1));concurrent--;calls++;return {error:null};}},()=>input.identity.generated_at);
 assert.equal(result.status,'SHADOW_STORED');assert.equal(calls,360);assert.equal(result.outcomes_observed,360);assert.equal(max,4);
});
