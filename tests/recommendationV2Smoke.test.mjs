// Synthetic isolation verifies wiring, never claimed as real Production Smoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {buildV2Capsule} from '../supabase/functions/_shared/recommendation-shadow-v2-runtime.ts';
import {verifyV2Runtime} from '../supabase/functions/_shared/recommendation-shadow-v2-smoke.ts';
async function proof(){
 const input=v2Fixture();input.v1.revision_id=input.identity.revision_id;
 return {decision:input.v1,acquisition:{cutoff:input.identity.generated_at,captures:input.captures},shadow_v2:await buildV2Capsule(input)};
}
test('live capsule lineage and recomputation produce bounded metadata, no evidence payload',async()=>{
 const p=await proof(),r=await verifyV2Runtime(p);
 assert.equal(r.status,'PASS');assert.equal(r.scanned,72);assert.equal(r.same_universe_cutoff,true);
 assert.equal(r.persistence.status,'READ_ONLY_NOT_PERSISTED');assert.equal(r.candidates.length,72);
 assert.doesNotMatch(JSON.stringify(r),/evidence_text|raw_payload|captures|Authorization|service_role/);
 assert.equal(Object.values(r.counts).reduce((a,b)=>a+b),72);
});
test('explicit transport locks only verified research, no report/LINE handlers',async()=>{
 const p=await proof();let writes=0;
 const t={storeRun:async(text,result)=>{writes++;assert.equal(text,p.shadow_v2.evidence_text);assert.deepEqual(result,p.shadow_v2.result);return {error:null};},pending:async()=>({data:[],error:null}),storeOutcome:async()=>{throw Error('no future outcomes');}};
 const r=await verifyV2Runtime(p,t);assert.equal(r.status,'PASS');assert.equal(r.persistence.status,'SHADOW_STORED');assert.equal(writes,1);
 const failed=await verifyV2Runtime(p,{...t,storeRun:async()=>({error:'synthetic private details'})});
 assert.equal(failed.status,'PERSISTENCE_FAILED');assert.doesNotMatch(JSON.stringify(failed),/private details/);
});
test('missing/tampered capsule, different cutoff/revision/V1/captures cannot lock',async()=>{
 for(const mutate of [p=>delete p.shadow_v2,p=>p.decision.revision_id='different',p=>p.decision.generated_at='2026-10-01T00:00:00Z',p=>p.acquisition.captures[0].rows.pop(),p=>p.shadow_v2.result.counts.READY=999]){
  const p=await proof();mutate(p);let writes=0;
  const r=await verifyV2Runtime(p,{storeRun:async()=>{writes++;return {error:null};},pending:async()=>({data:[],error:null}),storeOutcome:async()=>({error:null})});
  assert.equal(r.status,'SHADOW_RUNTIME_PROOF_REJECTED');assert.equal(writes,0);
 }
});
