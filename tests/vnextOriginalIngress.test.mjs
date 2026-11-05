import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {validateOriginalIngressRequest,persistOriginalObservation,ORIGINAL_INGRESS_RPC} from '../src/features/vnext/originalIngress.ts';
import {snapshotHash,validTime,validObservationTime} from '../src/features/vnext/contracts.ts';
import {fixture} from './fixtures/vnext.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
function request(){return {schema:'ORIGINAL_OBSERVATION_INGRESS_1',c_prediction_id:'synthetic:2330:SHORT',c_lock_hash:'a'.repeat(64),symbol:'2330',company:'合成隔離公司',horizon:'SHORT',reason:'合成測試，非正式股票研究。',evidence_ids:['b'.repeat(64)],confirmation_conditions:[{text:'待確認',state:'UNKNOWN',evidence_ids:['b'.repeat(64)]}],invalidation_conditions:[{text:'待檢查風險',state:'UNKNOWN',evidence_ids:['b'.repeat(64)]}],next_review_at:'2026-10-20T00:00:00Z',expires_at:'2026-10-21T00:00:00Z'};}
test('closed original envelope cannot carry C status, invented evidence, tier, publication or client timestamps',()=>{
 const r=request();validateOriginalIngressRequest(r);
 for(const key of ['status','score','created_at','snapshot_hash','quality','tier','evidence','publication_status','license'])assert.throws(()=>validateOriginalIngressRequest({...r,[key]:'APPROVED'}),/REQUEST_INVALID/);
 for(const change of [r=>r.evidence_ids.push(r.evidence_ids[0]),r=>r.evidence_ids[0]='old-source-id',r=>r.confirmation_conditions[0].state='CONFIRMED',r=>r.invalidation_conditions[0].state='NOT_MET',r=>r.confirmation_conditions[0].evidence_ids=['c'.repeat(64)],r=>r.reason='',r=>r.expires_at='infinity',r=>r.company='😀'.repeat(201)]){const v=structuredClone(r);change(v);assert.throws(()=>validateOriginalIngressRequest(v),/REQUEST_INVALID/);}
});
test('ambiguous write reply is not automatically retried or given a new request key',async()=>{
 let called=0;const key=randomUUID();await assert.rejects(()=>persistOriginalObservation(key,request(),async(name,args)=>{called++;assert.equal(name,ORIGINAL_INGRESS_RPC);assert.equal(args.p_request_key,key);throw Error('REPLY_UNKNOWN');}),/REPLY_UNKNOWN/);assert.equal(called,1);
});
async function response(input){
 const f=fixture(),selected=f.evidence.filter(e=>['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE'].includes(e.kind));
 const evidence=selected.map(e=>({...e,id:sha(e.id),symbol:input.symbol}));input.evidence_ids=evidence.map(e=>e.id);
 for(const c of [...input.confirmation_conditions,...input.invalidation_conditions])c.evidence_ids=[evidence[0].id];
 const observation={...f.observation,id:'original-'+sha(input.c_prediction_id),symbol:input.symbol,company:input.company,horizon:'SHORT',reason:input.reason,
  evidence_ids:[...input.evidence_ids].sort(),created_at:'2026-10-08T00:00:00.123456Z',next_review_at:input.next_review_at,expires_at:input.expires_at,
  confirmation_conditions:input.confirmation_conditions,invalidation_conditions:input.invalidation_conditions,strategy_version:'VNEXT_RESEARCH_1.0.0',mode:'FORWARD_SHADOW',publication_status:'RESEARCH_ONLY'};
 const {snapshot_hash:_,...body}=observation;observation.snapshot_hash=await snapshotHash({observation:body,evidence:[...evidence].sort((a,b)=>a.id.localeCompare(b.id))});
 return {schema:'ORIGINAL_OBSERVATION_RECEIPT_1',replayed:false,snapshot:{observation,evidence,state:'WATCHING',lineage:{c_prediction_id:input.c_prediction_id,c_lock_hash:input.c_lock_hash,c_source_revision:'f'.repeat(64),c_generated_at:'2026-10-08T00:00:00.123455Z',c_cutoff:'2026-10-08T00:00:00.123454Z'}}};
}
test('actual original contract, not C status, validates the persisted receipt and exact snapshot',async()=>{
 const r=request(),saved=await response(r),out=await persistOriginalObservation(randomUUID(),r,async()=>saved);
 assert.equal(out.state,'WATCHING');assert.equal(out.observation.publication_status,'RESEARCH_ONLY');assert.equal(out.observation.created_at,saved.snapshot.observation.created_at);
 for(const change of [v=>v.snapshot.state='CONDITION_MET',v=>v.snapshot.observation.publication_status='APPROVED',v=>v.snapshot.observation.snapshot_hash='0'.repeat(64),v=>v.snapshot.lineage.c_lock_hash='0'.repeat(64),v=>v.snapshot.observation.expires_at='2027-01-01T00:00:00Z',v=>v.snapshot.observation.created_at='2026-10-08T00:00:00.123454Z']){
  const mutated=structuredClone(saved);change(mutated);await assert.rejects(()=>persistOriginalObservation(randomUUID(),r,async()=>mutated));
 }
});
test('shared C timestamp contract remains millisecond-only; original DB locks alone admit microseconds',()=>{
 const v='2026-10-08T00:00:00.123456Z';assert.equal(validTime(v),false);assert.equal(validObservationTime(v),true);
});
