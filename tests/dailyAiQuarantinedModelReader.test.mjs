import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOrIntakeDailyStockAiBatch} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';
import {ISSUER_QUARANTINE_GAP} from '../research/quarantined-issuer-source.ts';

// Exercise the actual retained-batch admission gate. The handler performs its
// separate full packet validation after this read; no provider is used here.
const read=async packet=>{
 const retained={packets:[packet]};let calls=0;
 const result=await loadOrIntakeDailyStockAiBatch({batch_id:'a'.repeat(64)},async(name,args)=>{
  assert.equal(name,'load_daily_stock_ai_batch_v1');assert.equal(args.p_batch_id,'a'.repeat(64));calls++;return retained;
 },new AbortController().signal);
 assert.equal(calls,1);assert.equal(result,retained);return result;
};
const evidence=(id,original_id)=>({id,kind:'FINANCIAL',source:'https://www.umc.com/public-quarter.pdf',content:JSON.stringify({original_id})});
test('ordinary non-quarantined retained evidence preserves its admission path',async()=>{
 await read({data_gaps:[],evidence:[{id:'2303:PRICE:one',kind:'PRICE',source:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',content:'{}'}]});
});
test('quarantine marker blocks normal model admission independently of issuer host',async()=>{
 await assert.rejects(()=>read({data_gaps:[ISSUER_QUARANTINE_GAP],evidence:[]}),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
});
for(const namespace of ['issuer-ir-direct:','umc-ir-direct:']){
 test(`${namespace} evidence identity remains blocked after removing the marker`,async()=>{
  await assert.rejects(()=>read({data_gaps:[],evidence:[evidence('2303:FINANCIAL:'+namespace+'quarter','unrelated')]}),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
 });
 test(`${namespace} original identity remains blocked after renaming the evidence`,async()=>{
  await assert.rejects(()=>read({data_gaps:[],evidence:[evidence('renamed',namespace+'2303:quarter')]}),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
 });
}
