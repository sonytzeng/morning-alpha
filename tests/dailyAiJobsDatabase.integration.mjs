import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {canonical} from '../research/entry-opportunity.ts';
import {runStoredStockAiBatch} from '../supabase/functions/_shared/daily-stock-ai-runner.ts';
import {analyseDailyBatch} from '../research/daily-ai-batch.ts';
import {stockAiJobStore} from '../supabase/functions/_shared/daily-stock-ai-jobs.ts';
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
try{
 await db.exec('create role anon;create role authenticated;create role service_role;create schema vnext_runtime;');
 await db.exec(readFileSync(new URL('../research/daily-ai-jobs.candidate.sql',import.meta.url),'utf8'));
 const context={input_hash:'a'.repeat(64),model_revision:'test-v1',symbol:'2330',cutoff:'2026-10-30T12:00:00Z'};
 const identity=canonical({version:'DAILY_AI_BATCH_1',input_hash:context.input_hash,model_revision:context.model_revision}),key=await snapshotHash(JSON.parse(identity));
 const call=async(op,extra={})=>(await db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4,$5,$6,$7) result',[op,key,identity,context,extra.result??null,extra.lease??null,extra.code??null])).rows[0].result;
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(()=>call('CLAIM'),/permission denied/);await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_jobs'),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_jobs'),/permission denied/);
 const a=await call('CLAIM');assert.equal(a.state,'ACQUIRED');assert.equal((await call('CLAIM')).state,'BUSY');
 await assert.rejects(()=>call('FAIL',{lease:'00000000-0000-0000-0000-000000000000',code:'AI_BATCH_FAILED'}),/AI_JOB_LEASE/);
 const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:'2330',cutoff:context.cutoff,input_hash:context.input_hash,member_published:false,publication_ready:false,model_generated:true,
  receipt:{response_id:'test-receipt',model:'test-model',input_tokens:10,output_tokens:10},
  sources:[{id:'E1',symbol:'2330',kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z'}],
  horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'測試分析',evidence_ids:['E1']},counter_evidence:[],confirmation:'等待新資料',invalidation:'新證據否定判斷',gaps:[]}))};
 await assert.rejects(()=>call('COMPLETE',{lease:a.lease,result:{...result,member_published:true}}),/AI_JOB_RESULT/);
 assert.equal((await call('COMPLETE',{lease:a.lease,result})).state,'STORED');assert.deepEqual((await call('CLAIM')).result,result);
 await assert.rejects(()=>call('COMPLETE',{lease:a.lease,result}),/AI_JOB_LEASE/);
 // A distinct exact model revision cannot reuse a prior model's result.
 const ctx2={...context,model_revision:'test-v2'},identity2=canonical({version:'DAILY_AI_BATCH_1',input_hash:context.input_hash,model_revision:ctx2.model_revision}),key2=await snapshotHash(JSON.parse(identity2));
 const call2=async(op,extra={})=>(await db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4,$5,$6,$7) result',[op,key2,identity2,ctx2,null,extra.lease??null,extra.code??null])).rows[0].result;
 for(let i=0;i<3;i++){const c=await call2('CLAIM');assert.equal(c.state,'ACQUIRED');await call2('FAIL',{lease:c.lease,code:'AI_BATCH_FAILED'});}
 assert.equal((await call2('CLAIM')).state,'EXHAUSTED');
 // An expired writer cannot finish, and reclaim replaces its lease rather
 // than extending the old writer's authority. Only this isolated DB is edited.
 const ctx3={...context,model_revision:'test-expired-lease'},identity3=canonical({version:'DAILY_AI_BATCH_1',input_hash:context.input_hash,model_revision:ctx3.model_revision}),key3=await snapshotHash(JSON.parse(identity3));
 const call3=async(op,extra={})=>(await db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4,$5,$6,$7) result',[op,key3,identity3,ctx3,extra.result??null,extra.lease??null,extra.code??null])).rows[0].result;
 const expired=await call3('CLAIM');
 await db.exec('reset role');await db.query("update vnext_runtime.ai_stock_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[key3]);await db.exec('set role service_role');
 await assert.rejects(()=>call3('COMPLETE',{lease:expired.lease,result}),/AI_JOB_LEASE/);
 const reclaimed=await call3('CLAIM');assert.equal(reclaimed.state,'ACQUIRED');assert.notEqual(reclaimed.lease,expired.lease);
 await assert.rejects(()=>call3('FAIL',{lease:expired.lease,code:'AI_BATCH_FAILED'}),/AI_JOB_LEASE/);
 assert.equal((await call3('FAIL',{lease:reclaimed.lease,code:'AI_BATCH_FAILED'})).state,'STORED');
 let modelCalls=0;
 const packets=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'測試公司',cutoff:'2026-10-30T12:00:00Z',evidence:[{id:'E1',symbol:String(1000+i),kind:'NEWS',source:'https://www.twse.com.tw/',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'測試來源'}]}));
 const ports={apiKey:'test-key',model:'test-model',rpc:async(name,a)=>{assert.equal(name,'daily_stock_ai_job_v1');return(await db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4,$5,$6,$7) result',[a.p_op,a.p_key,a.p_identity_text??null,a.p_context??null,a.p_result??null,a.p_lease??null,a.p_code??null])).rows[0].result;},fetcher:async(url,req)=>{
  modelCalls++;const p=JSON.parse(JSON.parse(req.body).messages[1].content);
  const output={symbol:p.symbol,horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'測試判斷',evidence_ids:['E1']},counter_evidence:[],confirmation:'等待新資料',invalidation:'新證據否定原判斷',gaps:[]}))};
  return Response.json({id:'test-response-'+p.symbol,model:'test-model',usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});}};
 let batch;for(let i=0;i<9;i++)batch=await runStoredStockAiBatch(packets,ports,8);
 assert.equal(batch.complete,true);assert.equal(modelCalls,72);assert.equal((await runStoredStockAiBatch(packets,ports,8)).model_calls,0);assert.equal(modelCalls,72);
 // A damaged cache response is an untrusted boundary, even if its identity
 // hash matches. Do not turn arbitrary distinct horizon strings into a PASS.
 const corrupted={...result,symbol:packets[0].symbol,input_hash:await snapshotHash(packets[0]),horizons:['BAD1','BAD2','BAD3'].map(horizon=>({horizon}))};
 await assert.rejects(()=>analyseDailyBatch({packets,modelRevision:'cache-boundary-test',maxStocks:1},{claim:async(key,context)=>context.symbol===packets[0].symbol?{state:'CACHED',result:corrupted}:{state:'BUSY'},complete:async()=>assert.fail('cache must not write'),fail:async()=>assert.fail('cache must not write')},async()=>assert.fail('cache must not call model')),/AI_(BATCH|ANALYSIS)_/);
 for(const mutate of [r=>delete r.receipt,r=>delete r.receipt.input_tokens,r=>r.receipt.output_tokens=-1,r=>r.publication_ready=true]){
  const bad=structuredClone(result);mutate(bad);let writes=0;
  const cached=stockAiJobStore(async()=>({state:'CACHED',result:bad}));await assert.rejects(()=>cached.claim(key,context),/AI_BATCH_JOB_RECEIPT/);
  const prefetched=stockAiJobStore(async()=>assert.fail('bad prefetched receipt must fail locally'),{[key]:bad});await assert.rejects(()=>prefetched.claim(key,context),/AI_BATCH_JOB_RECEIPT/);
  const writer=stockAiJobStore(async()=>{writes++;return {state:'STORED'};});await assert.rejects(()=>writer.complete(key,a.lease,bad),/AI_BATCH_JOB_RECEIPT/);assert.equal(writes,0);
 }
 let prefetchedCalls=0;
 const prefetched=stockAiJobStore(async()=>{prefetchedCalls++;return {state:'BUSY'};},{[key]:result});
 assert.deepEqual(await prefetched.claim(key,context),{state:'CACHED',result});assert.equal(prefetchedCalls,0);
 assert.deepEqual(await prefetched.claim('f'.repeat(64),context),{state:'BUSY'});assert.equal(prefetchedCalls,1);
 const inherited=stockAiJobStore(async()=>({state:'BUSY'}),Object.create({[key]:result}));
 assert.deepEqual(await inherited.claim(key,context),{state:'BUSY'});
 await db.exec('reset role');const r=await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='vnext_runtime.ai_stock_jobs'::regclass");assert(r.rows[0].relrowsecurity&&r.rows[0].relforcerowsecurity);
 assert.equal((await db.query("select count(*)::int n from vnext_runtime.ai_stock_jobs where state='COMPLETE'")).rows[0].n,73);
 console.log('PASS: role isolation, raw denial, exclusive lease, stale writer denial, atomic result validation, cached result, immutable completion, revision isolation, bounded retries and forced RLS.');
}finally{await db.close();}
