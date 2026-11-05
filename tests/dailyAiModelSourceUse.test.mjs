import test from 'node:test';
import assert from 'node:assert/strict';
import {modelSourcePacketsCommitment} from '../supabase/functions/daily-stock-analysis-v1/model-source-review.ts';
import {loadOrIntakeDailyStockAiBatch} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';
import {ISSUER_QUARANTINE_GAP} from '../research/quarantined-issuer-source.ts';

// Synthetic protocol receipts ONLY: no real source-use or publication approval.
const signal=()=>new AbortController().signal;
async function fixture(){
 const now=Date.now(),cutoff=new Date(now-3600000).toISOString();
 const batch={id:'a'.repeat(64),cutoff,packets:Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'SYNTHETIC',cutoff,
  data_through:cutoff.slice(0,10),data_gaps:[ISSUER_QUARANTINE_GAP],evidence:[{id:String(1000+i)+':FINANCIAL:issuer-ir-direct:q',
   kind:'FINANCIAL',source:'https://www.mediatek.com/synthetic-quarter.pdf',content:JSON.stringify({original_id:'issuer-ir-direct:q',values:{value:1}})}]}))};
 const receipt={schema:'DAILY_AI_MODEL_SOURCE_USE_RECEIPT_V1',review_id:'b'.repeat(64),batch_id:batch.id,cutoff,
  packets_commitment:await modelSourcePacketsCommitment(batch,signal()),quality:'PASS',basis:'FACT_ONLY_OWN_ANALYSIS',
  use_scope:'FINANCIAL_FACT_MODEL_INPUT_ONLY',documents_ready:true,review_document_hash:'c'.repeat(64),
  source_mapping_document_hash:'d'.repeat(64),terms_document_hash:'e'.repeat(64),reviewed_at:new Date(now-2000).toISOString(),
  recorded_at:new Date(now-1000).toISOString(),checked_at:new Date(now).toISOString(),expires_at:new Date(now+3600000).toISOString(),
  member_publication_approved:false};
 return {batch,receipt};
}
async function read(batch,receipt,onReview=()=>{},s=signal()){
 const calls=[];
 const result=await loadOrIntakeDailyStockAiBatch({batch_id:batch.id},async(name,args)=>{
  calls.push(name);
  if(name==='load_daily_stock_ai_batch_v1')return batch;
  assert.equal(name,'load_daily_stock_ai_model_source_use_v1');assert.deepEqual(args,{p_batch_id:batch.id});
  onReview();return receipt;
 },s);
 return {result,calls};
}
test('exact reviewed batch can be read without changing original quarantine, IDs or source flags',async()=>{
 const {batch,receipt}=await fixture(),before=structuredClone(batch);
 const {result,calls}=await read(batch,receipt);
 assert.deepEqual(calls,['load_daily_stock_ai_batch_v1','load_daily_stock_ai_model_source_use_v1']);
 assert.deepEqual(result,before);assert.deepEqual(batch,before);assert.notEqual(result,batch);
});
test('missing and pending review receipts remain blocked',async()=>{
 const {batch,receipt}=await fixture();
 for(const p of [null,{}, {...receipt,quality:'PENDING'},{...receipt,quality:'FAIL'},{...receipt,quality:'REVOKED'}])
  await assert.rejects(()=>read(batch,p),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
});
test('wrong batch, cutoff, packet bytes, scope, basis, document or publication permission fails',async()=>{
 const {batch,receipt}=await fixture();
 for(const change of [{batch_id:'f'.repeat(64)},{cutoff:new Date(Date.parse(batch.cutoff)+1).toISOString()},
  {packets_commitment:'f'.repeat(64)},{documents_ready:false},{basis:'OPEN_LICENSE'},
  {use_scope:'MEMBER_PUBLICATION'},{member_publication_approved:true},{review_document_hash:'not-a-hash'},
  {source_mapping_document_hash:null},{terms_document_hash:'g'.repeat(64)},{untrusted_approved:true}])
  await assert.rejects(()=>read(batch,{...receipt,...change}),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
 const altered=structuredClone(batch);altered.packets[0].evidence[0].content='changed';
 await assert.rejects(()=>read(altered,receipt),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
});
test('expired, future, stale and out-of-order receipts cannot authorize a model read',async()=>{
 const {batch,receipt}=await fixture(),now=Date.now();
 for(const change of [{expires_at:new Date(now-1).toISOString()},{expires_at:new Date(now+59000).toISOString()},
  {checked_at:new Date(now+5000).toISOString()},
  {checked_at:new Date(now-20000).toISOString()},{reviewed_at:new Date(Date.parse(batch.cutoff)-1).toISOString()},
  {recorded_at:new Date(Date.parse(receipt.reviewed_at)-1).toISOString()},
  {expires_at:new Date(now+73*3600000).toISOString()}])
  await assert.rejects(()=>read(batch,{...receipt,...change}),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
});
test('financial review cannot override restricted GNews or Yahoo evidence',async()=>{
 for(const evidence of [{kind:'NEWS',source:'https://example.com/story',content:'{"provider":"GNEWS"}'},
  {kind:'MARKET',source:'https://query1.finance.yahoo.com/chart',content:'{}'}]){
  const {batch,receipt}=await fixture();batch.packets[0].evidence.push(evidence);
  let reviews=0;await assert.rejects(()=>read(batch,receipt,()=>reviews++),/AI_INTAKE_RESTRICTED_(NEWS|MARKET)_SOURCE/);
  assert.equal(reviews,0);
 }
});
test('an async caller cannot mutate the captured, already reviewed packet set',async()=>{
 const {batch,receipt}=await fixture(),before=structuredClone(batch);
 const {result}=await read(batch,receipt,()=>{batch.packets[0].company='MUTATED';batch.packets[0].evidence[0].content='MUTATED';});
 assert.deepEqual(result,before);assert.notDeepEqual(batch,before);
});
test('request-side approval fields do not supply a server-owned review',async()=>{
 const {batch}=await fixture();batch.source_use_approved=true;batch.review={quality:'PASS'};
 await assert.rejects(()=>read(batch,null),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
});
test('cancellation remains enforced before and after the receipt lookup',async()=>{
 const {batch,receipt}=await fixture();
 const a=new AbortController();a.abort();await assert.rejects(()=>read(batch,receipt,()=>{},a.signal),/AI_INTAKE_ABORTED/);
 const b=new AbortController();await assert.rejects(()=>read(batch,receipt,()=>b.abort(),b.signal),/AI_INTAKE_ABORTED/);
});
