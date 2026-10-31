import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseStockWithProvider} from '../supabase/functions/_shared/daily-stock-ai.ts';
const packet={symbol:'2330',company:'測試公司',cutoff:'2026-10-30T12:00:00Z',evidence:[{id:'E1',symbol:'2330',kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試資料，不是真實股票分析'}]};
const output={symbol:'2330',horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'等待確認',evidence_ids:['E1']},counter_evidence:[],confirmation:'等待新公告',invalidation:'新證據否定判斷',gaps:[]}))};
const result=()=>({id:'test-provider-receipt',model:'test-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:100}});
test('server adapter sends evidence once and retains usage without leaking credentials',async()=>{
 const r=await analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'test-model',fetcher:async(url,request)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(request.headers.Authorization,'Bearer test-only-key');
  const body=JSON.parse(request.body);assert.equal(JSON.parse(body.messages[1].content).symbol,'2330');return Response.json(result());}});
 assert.equal(r.receipt.response_id,'test-provider-receipt');assert.equal(r.publication_ready,false);assert(!JSON.stringify(r).includes('test-only-key'));
});
test('provider outage, truncated output, missing usage and oversized output cannot become analysis',async()=>{
 for(const fetcher of [async()=>new Response('',{status:429}),async()=>{const r=result();r.choices[0].finish_reason='length';return Response.json(r);},async()=>{const r=result();delete r.usage;return Response.json(r);},async()=>new Response('x'.repeat(512001))]){
  await assert.rejects(()=>analyseStockWithProvider(packet,{apiKey:'test-only-key',model:'test-model',fetcher}),/STOCK_AI_/);
 }
});
