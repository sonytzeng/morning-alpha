import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDailyStockAnalysis} from '../supabase/functions/daily-stock-analysis-v1/handler.ts';
const secret='test-internal-secret-'.repeat(2),cutoff='2026-10-30T12:00:00Z',id='a'.repeat(64);
const packets=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司',cutoff,evidence:[{id:'E1',symbol:String(1000+i),kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試資料'}]}));
const progress=(state='DEFERRED')=>({rows:packets().map(p=>({symbol:p.symbol,state})),model_calls:0,member_published:false,complete:state==='CACHED'});
const ports=(override={})=>({internalSecret:secret,clock:()=> '2026-10-31T01:00:00Z',loadBatch:async()=>({id,cutoff,packets:packets()}),runBatch:async()=>progress(),...override});
const request=(body={cutoff},options={})=>new Request('https://worker.test',{method:'POST',headers:{'x-vnext-internal':secret,...options.headers},body:typeof body==='string'?body:JSON.stringify(body),...options});
test('rejects browser, missing credentials and unsupported methods before loading or running',async()=>{
 const p=ports({loadBatch:async()=>assert.fail('must not load'),runBatch:async()=>assert.fail('must not run')});
 assert.equal((await handleDailyStockAnalysis(request({cutoff},{headers:{origin:'https://member.test','x-vnext-internal':secret}}),p)).status,403);
 assert.equal((await handleDailyStockAnalysis(request({cutoff},{headers:{}}),p)).status,401);
 assert.equal((await handleDailyStockAnalysis(new Request('https://worker.test'),p)).status,405);
 assert.equal((await handleDailyStockAnalysis(request(),ports({internalSecret:'short'}))).status,401);
});
test('accepts only a cutoff or hash selector; no raw packets, model options or caller execution budget',async()=>{
 const p=ports({loadBatch:async()=>assert.fail('must not load')});
 for(const body of [{cutoff,packets:[]},{cutoff,model:'other'},{batch_id:id,maxStocks:72},[],null,{},'{'])assert.equal((await handleDailyStockAnalysis(request(body),p)).status,422);
 assert.equal((await handleDailyStockAnalysis(request({cutoff:'2027-01-01T00:00:00Z'}),p)).status,422);
 assert.equal((await handleDailyStockAnalysis(request('x'.repeat(513)),p)).status,413);
 // Byte limits apply independently of JS string length or an absent Content-Length.
 assert.equal((await handleDailyStockAnalysis(request('界'.repeat(200)),p)).status,413);
});
test('one stock is run from a server-owned 72-stock batch with honest partial progress',async()=>{
 let loaded,run;
 const p=ports({loadBatch:async selector=>{loaded=selector;return {id,cutoff,packets:packets()};},runBatch:async(ps,max,signal)=>{
  run={count:ps.length,max,signal};const r=progress();r.rows[0].state='COMPLETE';r.model_calls=1;return r;
 }});
 const r=await handleDailyStockAnalysis(request({batch_id:id}),p),body=await r.json();
 assert.equal(r.status,202);assert.deepEqual(loaded,{batch_id:id});assert.equal(run.count,72);assert.equal(run.max,1);
 assert.equal(body.counts.COMPLETE,1);assert.equal(body.counts.DEFERRED,71);assert.equal(body.member_published,false);assert.equal(body.requires_next_checkpoint,true);
 assert.equal('rows' in body,false);assert.equal('packets' in body,false);
});
test('all-cached work is complete with zero model calls; failed work is explicitly partial',async()=>{
 let r=await handleDailyStockAnalysis(request(),ports({runBatch:async()=>progress('CACHED')}));
 assert.equal(r.status,200);assert.equal((await r.json()).requires_next_checkpoint,false);
 const result=progress();result.rows[0].state='FAILED';result.model_calls=1;
 r=await handleDailyStockAnalysis(request(),ports({runBatch:async()=>result}));assert.equal(r.status,207);assert.equal((await r.json()).status,'PARTIAL_FAILURE');
});
test('missing, changed, mixed-cutoff or malformed retained batches cannot call a model',async()=>{
 for(const batch of [null,{id:'b'.repeat(64),cutoff,packets:packets()},{id,cutoff,packets:packets().slice(1)},
  {id,cutoff,packets:packets().map((p,i)=>i?{...p,cutoff:'2026-10-29T12:00:00Z'}:p)}]){
  const r=await handleDailyStockAnalysis(request({batch_id:id}),ports({loadBatch:async()=>batch,runBatch:async()=>assert.fail('must not run')}));assert.equal(r.status,409);
 }
});
test('unconfirmed or excessive progress cannot report success or expose provider error text',async()=>{
 for(const result of [{...progress(),member_published:true},{...progress(),model_calls:2},{...progress(),complete:true}]){
  const r=await handleDailyStockAnalysis(request(),ports({runBatch:async()=>result}));assert.equal(r.status,409);
 }
 const r=await handleDailyStockAnalysis(request(),ports({runBatch:async()=>{throw Error('sensitive provider body');}}));assert.equal(r.status,409);assert(!JSON.stringify(await r.json()).includes('sensitive'));
});
test('stalled batch loading is bounded and signals cancellation',async()=>{
 let signal;const r=await handleDailyStockAnalysis(request(),ports({loadBatch:async(_selector,s)=>{signal=s;return new Promise(()=>{});}}),{loadMs:5,runMs:5});
 assert.equal(r.status,503);assert.equal(signal.aborted,true);
});
