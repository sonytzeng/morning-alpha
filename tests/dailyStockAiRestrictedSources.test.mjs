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
test('GNews provider and UDN news are denied before any retained batch can resume model analysis',async()=>{
 for(const evidence of [
  {kind:'NEWS',source:'https://www.cna.com.tw/news/afe/202610300001.aspx',content:JSON.stringify({provider:'GNEWS',title:'來源標題'})},
  {kind:'NEWS',source:'https://money.udn.com/money/story/5612/0000000',content:JSON.stringify({provider:'OWNER_RETAINED'})},
  {kind:'NEWS',source:'https://udn.com/news/story/0000/0000',content:'舊的純文字內容'},
 ]){
  const batch={id:'a'.repeat(64),cutoff:'2026-10-31T03:00:00Z',packets:[{symbol:'2330',evidence:[evidence]}]};
  for(const selector of [{batch_id:batch.id},{cutoff:batch.cutoff}]){
   const before=structuredClone(batch);let calls=0;
   await assert.rejects(()=>loadOrIntakeDailyStockAiBatch(selector,async name=>{calls++;assert.equal(name,'load_daily_stock_ai_batch_v1');return batch;},new AbortController().signal),/AI_INTAKE_RESTRICTED_NEWS_SOURCE/);
   assert.equal(calls,1);assert.deepEqual(batch,before,'retained rows and job inputs remain unchanged');
  }
 }
});
test('provider restriction uses the retained provider field rather than an article mentioning GNews',async()=>{
 const batch={id:'a'.repeat(64),cutoff:'2026-10-31T03:00:00Z',packets:[{symbol:'2330',evidence:[
  {kind:'NEWS',source:'https://www.federalreserve.gov/newsevents/pressreleases/other20261030a.htm',content:JSON.stringify({provider:'FED_RSS_OFFICIAL',title:'GNews 字樣不代表取得供應商'})},
 ]}]};
 assert.equal(await loadOrIntakeDailyStockAiBatch({batch_id:batch.id},async()=>batch,new AbortController().signal),batch);
});
