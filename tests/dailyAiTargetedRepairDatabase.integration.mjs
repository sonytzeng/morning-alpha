// Isolated PostgreSQL only. Synthetic analyses, Vault and pg_net fixtures;
// no model, network, deployment, schedule or production state is accessed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';

const modulePath=process.env.MA_PGLITE_MODULE;assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const sha=text=>createHash('sha256').update(text).digest('hex');
const ORIGINAL='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low';
const REPAIR='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-8:reasoning-low';
const token='isolated-repair-test-delivery-token-000000',review='a'.repeat(64),otherReview='b'.repeat(64);
const cutoff=new Date(Date.now()-600000).toISOString(),available=new Date(Date.parse(cutoff)-60000).toISOString();
const through=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
const body={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through,packet_texts:{},packet_hashes:{},gaps:{}};
for(let i=0;i<72;i++){
 const symbol=String(1000+i),packet={symbol,company:'隔離股票'+symbol,cutoff,data_through:through,
  evidence:[{id:'E1',symbol,kind:'NEWS',source:'https://www.twse.com.tw/',published_at:available,available_at:available,content:'隔離測試來源事實'}]};
 body.packet_texts[symbol]=canonical(packet);body.packet_hashes[symbol]=sha(body.packet_texts[symbol]);
}
const identity=(hash,revision)=>canonical({version:'DAILY_AI_BATCH_1',input_hash:hash,model_revision:revision});
const key=(symbol,revision)=>sha(identity(body.packet_hashes[symbol],revision));
const store=async(caseName)=>{const b={...body,gaps:{isolated_test_case:caseName}},text=canonical(b),hash=sha(text);
 return(await db.query('select public.store_daily_stock_ai_batch_v1($1,$2) result',[text,hash])).rows[0].result.batch_id;};
const dispatch=async(batch,symbol='1000',document=review)=>(await db.query('select public.dispatch_daily_stock_ai_citation_repair_v1($1,$2,$3) result',[batch,symbol,document])).rows[0].result;
const load=async(batch,symbol='1000',document=review)=>(await db.query('select public.load_daily_stock_ai_citation_repair_v1($1,$2,$3) result',[batch,symbol,document])).rows[0].result;
const normal=async batch=>(await db.query('select public.dispatch_daily_stock_ai_batch_v1($1) result',[batch])).rows[0].result;
const count=async table=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
const job=(symbol,revision,patch={})=>{
 const context={symbol,input_hash:body.packet_hashes[symbol],cutoff,model_revision:revision,...patch},text=identity(context.input_hash,revision),id=sha(text);
 const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:context.symbol,input_hash:context.input_hash,cutoff:context.cutoff,
  member_published:false,publication_ready:false,model_generated:true,
  receipt:{response_id:'isolated-response-'+id,model:'gpt-6-astra',input_tokens:10,output_tokens:20},
  sources:JSON.parse(body.packet_texts[symbol]).evidence.map(({content,...source})=>source),
  horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'隔離已保存分析',evidence_ids:['E1']},counter_evidence:[],confirmation:'等待新增證據',invalidation:'新的反證推翻判斷',gaps:[]}))};
 const call=async(op,{lease=null,code=null,value=null}={})=>(await db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4,$5,$6,$7) result',[op,id,text,context,value,lease,code])).rows[0].result;
 return {context,text,id,result,call};
};
const complete=async stock=>{const claim=await stock.call('CLAIM');assert.equal(claim.state,'ACQUIRED');assert.equal((await stock.call('COMPLETE',{lease:claim.lease,value:stock.result})).state,'STORED');return claim;};
const noPrivateOutput=value=>{const text=JSON.stringify(value);assert(!text.includes(token),'DELIVERY_TOKEN_MUST_NOT_APPEAR_IN_RPC_OUTPUT');assert(!Object.hasOwn(value,'headers'));};
let phase='bootstrap';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default clock_timestamp());
 create schema net;create table net.mock_requests(id bigserial primary key,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare request_id bigint;forced text:=nullif(current_setting('test.repair_http_result',true),'');begin
  if forced='NULL' then return null;elsif forced is not null then return forced::bigint;end if;
  insert into net.mock_requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id into request_id;return request_id;end$$;
 revoke all on schema vault,net from public,anon,authenticated,service_role;
 revoke all on vault.decrypted_secrets,net.mock_requests from public,anon,authenticated,service_role;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);`);
 for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-member','daily-ai-targeted-repair-v1'])await db.exec(readFileSync(new URL('../research/'+name+'.candidate.sql',import.meta.url),'utf8'));
 await db.query("insert into vault.decrypted_secrets(name,decrypted_secret) values('morning_alpha_daily_delivery_token',$1)",[token]);
 await db.exec('set role service_role');const batch=await store('targeted'),budgetNormal=await store('normal-fills-last-slot'),budgetRepair=await store('repair-fills-last-slot'),credentialBatch=await store('credential-failure');
 const originalA=job('1000',ORIGINAL),originalB=job('1001',ORIGINAL);await complete(originalA);await complete(originalB);
 await db.exec('reset role');
 phase='authorization and exact retained original fences';
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>dispatch(batch),/permission denied/);await assert.rejects(()=>load(batch),/permission denied/);
  await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_dispatches'),/permission denied/);
  await assert.rejects(()=>db.query('select * from vault.decrypted_secrets'),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_dispatches'),/permission denied/);
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_jobs'),/permission denied/);
 for(const invalid of [null,'','A'.repeat(64),'g'.repeat(64),'a'.repeat(63),'a'.repeat(65)]){
  await assert.rejects(()=>dispatch(batch,'1000',invalid),/AI_CITATION_REPAIR_REVIEW/);
  await assert.rejects(()=>load(batch,'1000',invalid),/AI_CITATION_REPAIR_REVIEW/);
 }
 for(const invalid of [null,'','bad','999','1000000','1000 OR TRUE'])await assert.rejects(()=>dispatch(batch,invalid),/AI_CITATION_REPAIR_SCOPE/);
 for(const invalid of [null,'','bad','f'.repeat(64)])await assert.rejects(()=>dispatch(invalid),/AI_CITATION_REPAIR_(BATCH_MISSING|SCOPE)/);
 await assert.rejects(()=>dispatch(batch,'9999'),/query returned no rows/);
 await assert.rejects(()=>load(batch),/query returned no rows/,'a delivery token cannot invent an actual repair receipt');
 const wrongInput=job('1002',ORIGINAL,{input_hash:'e'.repeat(64)});await complete(wrongInput);await assert.rejects(()=>dispatch(batch,'1002'),/query returned no rows/);
 const wrongCutoff=job('1003',ORIGINAL,{cutoff:new Date(Date.parse(cutoff)-3600000).toISOString()});await complete(wrongCutoff);await assert.rejects(()=>dispatch(batch,'1003'),/AI_CITATION_REPAIR_ORIGINAL/);
 await assert.rejects(()=>dispatch(batch,'1004'),/query returned no rows/,'no completed original prompt7 means no repair');
 const wrongRevision=job('1005',ORIGINAL.replace('prompt-7','prompt-6'));await complete(wrongRevision);await assert.rejects(()=>dispatch(batch,'1005'),/query returned no rows/);
 const unfinished=job('1006',ORIGINAL);await unfinished.call('CLAIM');await assert.rejects(()=>dispatch(batch,'1006'),/AI_CITATION_REPAIR_ORIGINAL/);
 await db.exec('reset role');assert.equal(await count('net.mock_requests'),0);
 phase='single target dispatch, actual receipt and immutable audit';
 await db.exec('set role service_role');const first=await dispatch(batch);assert.equal(first.state,'DISPATCHED');assert.equal(first.batch_id,batch);assert.equal(first.symbol,'1000');assert.equal(first.review_document_hash,review);
 assert.equal(first.original_job_key,originalA.id);assert.equal(first.job_key,key('1000',REPAIR));assert.equal(first.model_revision,REPAIR);assert.equal(first.member_published,false);noPrivateOutput(first);
 const ready=await load(batch);assert.deepEqual(ready,{state:'READY',batch_id:batch,symbol:'1000',input_hash:body.packet_hashes['1000'],cutoff,original_job_key:originalA.id,job_key:key('1000',REPAIR),model_revision:REPAIR,review_document_hash:review,dispatch_request_id:first.request_id,member_published:false});noPrivateOutput(ready);
 await assert.rejects(()=>load(batch,'1001'),/query returned no rows/);await assert.rejects(()=>load(batch,'1000',otherReview),/query returned no rows/);await assert.rejects(()=>load(budgetNormal),/query returned no rows/);
 const duplicate=await dispatch(batch),changedReview=await dispatch(batch,'1000',otherReview);assert.equal(duplicate.state,'ALREADY_DISPATCHED');assert.equal(changedReview.state,'ALREADY_DISPATCHED');assert.equal(changedReview.review_document_hash,review);assert.equal(changedReview.request_id,first.request_id);
 await db.exec('reset role');assert.equal(await count('net.mock_requests'),1);
 const request=(await db.query('select * from net.mock_requests where id=$1',[first.request_id])).rows[0];
 assert.equal(request.url,'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1');assert.equal(request.timeout_milliseconds,60000);
 assert(request.headers['x-daily-delivery-token']===token,'SERVER_ONLY_DELIVERY_TOKEN_MISMATCH');assert.equal(request.headers['Content-Type'],'application/json');assert.deepEqual(request.body,{batch_id:batch,repair_symbol:'1000',review_document_hash:review});
 assert(!JSON.stringify(request.body).includes(token),'TOKEN_MUST_NOT_ENTER_DISPATCH_BODY');
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_dispatches set review_document_hash=$1 where request_id=$2',[otherReview,first.request_id]),/AI_CITATION_REPAIR_RECEIPT_IMMUTABLE/);
 await assert.rejects(()=>db.query('delete from vnext_runtime.ai_stock_dispatches where request_id=$1',[first.request_id]),/AI_CITATION_REPAIR_RECEIPT_IMMUTABLE/);
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_jobs set result=result where id=$1',[originalA.id]),/AI_JOB_COMPLETED_IMMUTABLE/);
 await assert.rejects(()=>db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id,repair_symbol) values(900001,$1,$2)',[batch,'1001']),/ai_citation_repair_receipt_v1/);
 await assert.rejects(()=>db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id,repair_symbol,review_document_hash,original_job_key) values(900001,$1,$2,$3,$4)',[batch,'bad',review,originalB.id]),/ai_citation_repair_receipt_v1/);
 phase='real prompt8 claim races and terminal progress';
 // Separate transactions preserve the receipt while restoring absent prompt8
 // jobs after each terminal-state scenario. No stored COMPLETE row is edited.
 await db.exec('begin;set local role service_role');const repair=job('1000',REPAIR),claims=await Promise.all(Array.from({length:8},()=>repair.call('CLAIM')));
 assert.equal(claims.filter(r=>r.state==='ACQUIRED').length,1);assert.equal(claims.filter(r=>r.state==='BUSY').length,7);
 assert.equal((await dispatch(batch)).state,'BUSY');assert.equal((await repair.call('COMPLETE',{lease:claims.find(r=>r.state==='ACQUIRED').lease,value:repair.result})).state,'STORED');assert.equal((await dispatch(batch)).state,'CACHED');
 await db.exec('rollback');
 await db.exec('begin;set local role service_role');const exhausted=job('1000',REPAIR);
 for(let i=0;i<3;i++){const acquired=await exhausted.call('CLAIM');assert.equal(acquired.state,'ACQUIRED');await exhausted.call('FAIL',{lease:acquired.lease,code:'AI_BATCH_ISOLATED_REPAIR_FAILURE'});}
 assert.equal((await dispatch(batch)).state,'EXHAUSTED');assert.equal((await exhausted.call('CLAIM')).state,'EXHAUSTED');await db.exec('rollback');
 assert.equal(await count('net.mock_requests'),1,'busy/cached/exhausted must not issue transport requests');
 phase='one shared216 normal and repair transport budget';
 await db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) select n,$1 from generate_series(10000,10214)n',[budgetNormal]);
 await db.exec('set role service_role');const contenders=await Promise.all([normal(budgetNormal),dispatch(budgetNormal)]);assert.equal(contenders[0].state,'DISPATCHED');assert.equal(contenders[1].state,'DISPATCH_BUDGET_EXHAUSTED');await db.exec('reset role');
 await db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) select n,$1 from generate_series(20000,20214)n',[budgetRepair]);
 await db.exec('set role service_role');assert.equal((await dispatch(budgetRepair,'1001')).state,'DISPATCHED');assert.equal((await normal(budgetRepair)).state,'DISPATCH_BUDGET_EXHAUSTED');await db.exec('reset role');
 for(const id of [budgetNormal,budgetRepair])assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_dispatches where batch_id=$1',[id])).rows[0].n,216);
 const normalReceipt=(await db.query('select * from vnext_runtime.ai_stock_dispatches where batch_id=$1 and repair_symbol is null and request_id<10000',[budgetNormal])).rows[0];assert(normalReceipt);assert.equal(normalReceipt.review_document_hash,null);assert.equal(normalReceipt.original_job_key,null);
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_dispatches set repair_symbol=$1,review_document_hash=$2,original_job_key=$3 where request_id=$4',['1000',review,originalA.id,normalReceipt.request_id]),/AI_CITATION_REPAIR_RECEIPT_IMMUTABLE/);
 // PGlite serializes one connection. These race-shaped calls verify SQL
 // admission/caps, not multi-connection lock timing or a production load test.
 phase='missing or unusable credentials cannot dispatch';
 const requestsBefore=await count('net.mock_requests');await db.exec('delete from vault.decrypted_secrets');
 for(const bad of [null,'short','x'.repeat(513)]){
  if(bad!==null)await db.query("insert into vault.decrypted_secrets(name,decrypted_secret) values('morning_alpha_daily_delivery_token',$1)",[bad]);
  await db.exec('set role service_role');await assert.rejects(()=>dispatch(credentialBatch),/AI_DISPATCH_CREDENTIAL_UNAVAILABLE/);await db.exec('reset role');await db.exec('delete from vault.decrypted_secrets');
 }
 assert.equal(await count('net.mock_requests'),requestsBefore);
 assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_dispatches where batch_id=$1',[credentialBatch])).rows[0].n,0);
 phase='unconfirmed nonpositive transport result cannot authorize repair';
 await db.query("insert into vault.decrypted_secrets(name,decrypted_secret) values('morning_alpha_daily_delivery_token',$1)",[token]);
 for(const forced of ['NULL','0','-1']){
  await db.query("select set_config('test.repair_http_result',$1,false)",[forced]);await db.exec('set role service_role');
  await assert.rejects(()=>dispatch(credentialBatch),/AI_CITATION_REPAIR_DISPATCH_UNCONFIRMED/);await assert.rejects(()=>load(credentialBatch),/query returned no rows/);await db.exec('reset role');
 }
 assert.equal(await count('net.mock_requests'),requestsBefore);assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_dispatches where batch_id=$1',[credentialBatch])).rows[0].n,0,'unconfirmed transport creates no repair receipt');
 await db.query("select set_config('test.repair_http_result','',false)");
 // Legacy-shaped synthetic nonpositive receipts cannot pass the read fence.
 for(const requestId of [0,-1])await db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id,repair_symbol,review_document_hash,original_job_key) values($1,$2,$3,$4,$5)',[requestId,credentialBatch,'1000',review,originalA.id]);
 await db.exec('set role service_role');await assert.rejects(()=>load(credentialBatch),/query returned no rows/);await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from vnext_private.ai_research_editions')).rows[0].n,0,'repair never stages or publishes member research');
 console.log('PASS: targeted repair service-only scope, exact completed prompt7 binding, canonical prompt8 identity, actual immutable review-bound receipt, exact private transport, duplicate suppression, real job claim race/cache/busy/exhausted, shared216 cap with normal dispatch, and credential failures. No model/network/production writes.');
}catch(error){console.error(JSON.stringify({phase,error:String(error.message).slice(0,3000),code:error.code,where:error.where,site:error.stack?.split('\n').find(line=>line.includes('dailyAiTargetedRepairDatabase.integration.mjs'))}));process.exitCode=1;
}finally{await db.close();}
