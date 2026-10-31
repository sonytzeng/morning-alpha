import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOrIntakeDailyStockAiBatch} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';

test('already retained Yahoo market packets are denied for hash and cutoff selectors before analysis resumes',async()=>{
 const batch={id:'a'.repeat(64),cutoff:'2026-10-31T03:00:00Z',packets:[{symbol:'2330',evidence:[{kind:'MARKET',source:'https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1mo'}]}]};
 for(const selector of [{batch_id:batch.id},{cutoff:batch.cutoff}]){
  let calls=0;
  await assert.rejects(()=>loadOrIntakeDailyStockAiBatch(selector,async(name)=>{calls++;assert.equal(name,'load_daily_stock_ai_batch_v1');return batch;},new AbortController().signal),/AI_INTAKE_RESTRICTED_MARKET_SOURCE/);
  assert.equal(calls,1);
 }
});
test('official retained source packets continue through the existing batch validation path',async()=>{
 const batch={id:'a'.repeat(64),cutoff:'2026-10-31T03:00:00Z',packets:[{symbol:'2330',evidence:[{kind:'MARKET',source:'https://openapi.taifex.com.tw/v1/DailyMarketReportFut'}]}]};
 assert.equal(await loadOrIntakeDailyStockAiBatch({batch_id:batch.id},async()=>batch,new AbortController().signal),batch);
});
test('restricted company financial facts cannot re-enter through an already retained batch',async()=>{
 for(const source of ['https://investor.tsmc.com/report.pdf','https://corp.mediatek.com/investor','https://www.honhai.com/financial','https://honhai.com/financial']){
  const batch={id:'a'.repeat(64),cutoff:'2026-10-31T03:00:00Z',packets:[{symbol:'2330',evidence:[{kind:'FINANCIAL',source}]}]};
  await assert.rejects(()=>loadOrIntakeDailyStockAiBatch({batch_id:batch.id},async()=>batch,new AbortController().signal),/AI_INTAKE_RESTRICTED_FINANCIAL_SOURCE/);
 }
});
