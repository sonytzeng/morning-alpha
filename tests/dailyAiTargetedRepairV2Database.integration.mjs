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
const SECOND='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low';
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
 await db.exec('set role service_role');
 const legacy=await store('pre-v2-legacy-null-revision'),main=await store('document-revision-binding'),budgetNormal=await store('shared-budget-normal-last'),budgetRepair=await store('shared-budget-prompt9-last');
 for(const symbol of ['1000','1001','1002','1003','1004','1005'])await complete(job(symbol,ORIGINAL));
 const legacyReceipt=await dispatch(legacy);assert.equal(legacyReceipt.model_revision,REPAIR);
 const legacyRepair=job('1000',REPAIR),legacyClaim=await legacyRepair.call('CLAIM');assert.equal(legacyClaim.state,'ACQUIRED');await db.exec('reset role');
 // This receipt is created by the real historical v1 dispatcher before the
 // nullable revision column exists. The migration must preserve that binding.
 await db.exec(readFileSync(new URL('../research/daily-ai-targeted-repair-v2.candidate.sql',import.meta.url),'utf8'));
 const bindingTable='vnext_runtime.ai_stock_citation_repair_reviews_v2';
 assert.equal((await db.query('select repair_model_revision from vnext_runtime.ai_stock_dispatches where request_id=$1',[legacyReceipt.request_id])).rows[0].repair_model_revision,null);
 phase='scope, raw isolation and server-selected rounds';
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>dispatch(main),/permission denied/);await assert.rejects(()=>load(main),/permission denied/);
  await assert.rejects(()=>db.query('select * from '+bindingTable),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');await assert.rejects(()=>db.query('select * from '+bindingTable),/permission denied/);
 for(const invalid of [null,'','g'.repeat(64),'a'.repeat(63)])await assert.rejects(()=>dispatch(main,'1001',invalid),/AI_CITATION_REPAIR_REVIEW/);
 for(const invalid of [null,'bad','999'])await assert.rejects(()=>dispatch(main,invalid),/AI_CITATION_REPAIR_SCOPE/);
 await assert.rejects(()=>dispatch('f'.repeat(64)),/AI_CITATION_REPAIR_BATCH_MISSING/);
 await assert.rejects(()=>db.query('select public.dispatch_daily_stock_ai_citation_repair_v1($1::text,$2::text,$3::text,$4::text)',[main,'1001',review,SECOND]),/does not exist/,'callers cannot provide a model revision');
 await assert.rejects(()=>db.query('select public.load_daily_stock_ai_citation_repair_v1($1::text,$2::text,$3::text,$4::text)',[main,'1001',review,SECOND]),/does not exist/);
 await db.exec('reset role');
 await assert.rejects(()=>db.query('select vnext_runtime.daily_ai_citation_repair_context_v2($1,$2,$3)',[main,'1001',SECOND.replace('prompt-9','prompt-10')]),/AI_CITATION_REPAIR_/);
 phase='legacy null means8 and same document never advances';
 await db.exec('set role service_role');
 const legacyReady=await load(legacy);assert.equal(legacyReady.model_revision,REPAIR);assert.equal(legacyReady.dispatch_request_id,legacyReceipt.request_id);
 const boundBusy=await dispatch(legacy);assert.equal(boundBusy.state,'BUSY');assert.equal(boundBusy.model_revision,REPAIR);
 assert.equal((await legacyRepair.call('COMPLETE',{lease:legacyClaim.lease,value:legacyRepair.result})).state,'STORED');
 const cachedOldDocument=await dispatch(legacy);assert.equal(cachedOldDocument.state,'CACHED');assert.equal(cachedOldDocument.model_revision,REPAIR);assert.equal(cachedOldDocument.job_key,key('1000',REPAIR));
 const secondRound=await dispatch(legacy,'1000',otherReview);assert.equal(secondRound.state,'DISPATCHED');assert.equal(secondRound.model_revision,SECOND);assert.equal(secondRound.job_key,key('1000',SECOND));
 const ready9=await load(legacy,'1000',otherReview);assert.equal(ready9.model_revision,SECOND);assert.equal(ready9.prior_job_key,key('1000',REPAIR));assert.equal(ready9.prior_model_revision,REPAIR);assert.equal(ready9.prior_input_hash,body.packet_hashes['1000']);assert.equal(ready9.prior_cutoff,cutoff);
 const duplicate9=await dispatch(legacy,'1000',otherReview);assert.equal(duplicate9.state,'ALREADY_DISPATCHED');assert.equal(duplicate9.request_id,secondRound.request_id);assert.equal(duplicate9.model_revision,SECOND);
 const docWhile9='c'.repeat(64),sameRoundDifferentDocument=await dispatch(legacy,'1000',docWhile9);assert.equal(sameRoundDifferentDocument.state,'ALREADY_DISPATCHED');assert.equal(sameRoundDifferentDocument.model_revision,SECOND);assert.equal(sameRoundDifferentDocument.review_document_hash,otherReview);
 await assert.rejects(()=>load(legacy,'1000',docWhile9),/query returned no rows/,'a binding alone does not fabricate a dispatch receipt');
 noPrivateOutput(boundBusy);noPrivateOutput(cachedOldDocument);noPrivateOutput(ready9);await db.exec('reset role');
 assert.equal(await count('net.mock_requests'),2,'new9 round may dispatch immediately without duplicating same8 or9 round');
 const revisionRows=(await db.query('select repair_model_revision from vnext_runtime.ai_stock_dispatches where batch_id=$1 order by request_id',[legacy])).rows;
 assert.deepEqual(revisionRows.map(r=>r.repair_model_revision),[null,SECOND]);
 const newest=(await db.query('select body,headers from net.mock_requests where id=$1',[secondRound.request_id])).rows[0];
 assert.deepEqual(newest.body,{batch_id:legacy,repair_symbol:'1000',review_document_hash:otherReview});assert(!Object.hasOwn(newest.body,'model_revision'));assert(newest.headers['x-daily-delivery-token']===token,'SERVER_ONLY_DELIVERY_TOKEN_MISMATCH');
 const bindings=(await db.query('select * from '+bindingTable+' where batch_id=$1 order by review_document_hash',[legacy])).rows;
 assert.equal(bindings.find(b=>b.review_document_hash===review).model_revision,REPAIR);assert.equal(bindings.find(b=>b.review_document_hash===review).prior_job_key,null);
 assert.equal(bindings.find(b=>b.review_document_hash===otherReview).model_revision,SECOND);assert.equal(bindings.find(b=>b.review_document_hash===otherReview).prior_job_key,key('1000',REPAIR));
 await assert.rejects(()=>db.query('update '+bindingTable+' set model_revision=$1 where batch_id=$2 and symbol=$3 and review_document_hash=$4',[SECOND,legacy,'1000',review]),/IMMUTABLE/);
 await assert.rejects(()=>db.query('delete from '+bindingTable+' where batch_id=$1',[legacy]),/IMMUTABLE/);
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_dispatches set repair_model_revision=$1 where request_id=$2',[SECOND,legacyReceipt.request_id]),/AI_CITATION_REPAIR_RECEIPT_IMMUTABLE/);
 phase='first new document without completed8 stays8 across completion';
 await db.exec('set role service_role');const first8=await dispatch(main,'1001');assert.equal(first8.state,'DISPATCHED');assert.equal(first8.model_revision,REPAIR);
 const repair8=job('1001',REPAIR),claim8=await repair8.call('CLAIM');assert.equal(claim8.state,'ACQUIRED');
 const busyDocument='d'.repeat(64),busy8=await dispatch(main,'1001',busyDocument);assert.equal(busy8.state,'BUSY');assert.equal(busy8.model_revision,REPAIR);
 await repair8.call('COMPLETE',{lease:claim8.lease,value:repair8.result});
 assert.equal((await dispatch(main,'1001')).model_revision,REPAIR);assert.equal((await dispatch(main,'1001',busyDocument)).model_revision,REPAIR);
 assert.equal((await dispatch(main,'1001',busyDocument)).state,'CACHED');
 const main9=await dispatch(main,'1001',otherReview);assert.equal(main9.state,'DISPATCHED');assert.equal(main9.model_revision,SECOND);await db.exec('reset role');
 phase='wrong prior8 cannot support a bound9 request';
 const invalidPriors=[
  ['1002',{input_hash:'e'.repeat(64)},'COMPLETE'],
  ['1003',{cutoff:new Date(Date.parse(cutoff)-3600000).toISOString()},'COMPLETE'],
  ['1004',{},'RUNNING'],
 ];
 for(const [symbol,patch,state] of invalidPriors){
  await db.exec('set role service_role');const prior=job(symbol,REPAIR,patch);if(state==='COMPLETE')await complete(prior);else await prior.call('CLAIM');await db.exec('reset role');
  await db.query('insert into '+bindingTable+'(batch_id,symbol,review_document_hash,model_revision,original_job_key,prior_job_key) values($1,$2,$3,$4,$5,$6)',[main,symbol,otherReview,SECOND,key(symbol,ORIGINAL),key(symbol,REPAIR)]);
  await db.exec('set role service_role');await assert.rejects(()=>dispatch(main,symbol,otherReview),/AI_CITATION_REPAIR_|query returned no rows/);await assert.rejects(()=>load(main,symbol,otherReview),/AI_CITATION_REPAIR_|query returned no rows/);await db.exec('reset role');
 }
 // A legacy-shaped stored result with a wrong identity is rejected even if
 // its row key/context look right. It is inserted only into this isolated DB.
 const badResult=job('1005',REPAIR);badResult.result.input_hash='f'.repeat(64);
 await db.query("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),clock_timestamp(),$6)",[badResult.id,body.packet_hashes['1005'],REPAIR,'1005',cutoff,badResult.result]);
 await db.query('insert into '+bindingTable+'(batch_id,symbol,review_document_hash,model_revision,original_job_key,prior_job_key) values($1,$2,$3,$4,$5,$6)',[main,'1005',otherReview,SECOND,key('1005',ORIGINAL),key('1005',REPAIR)]);
 await db.exec('set role service_role');await assert.rejects(()=>dispatch(main,'1005',otherReview),/AI_CITATION_REPAIR_/);await db.exec('reset role');
 phase='prompt9 races, cache, retries and no prompt10';
 await db.exec('begin;set local role service_role');const run9=job('1001',SECOND),claims9=await Promise.all(Array.from({length:8},()=>run9.call('CLAIM')));
 assert.equal(claims9.filter(r=>r.state==='ACQUIRED').length,1);assert.equal(claims9.filter(r=>r.state==='BUSY').length,7);assert.equal((await dispatch(main,'1001',otherReview)).state,'BUSY');
 await run9.call('COMPLETE',{lease:claims9.find(r=>r.state==='ACQUIRED').lease,value:run9.result});
 assert.equal((await dispatch(main,'1001',otherReview)).state,'CACHED');
 const cachedDocument='e'.repeat(64),after9=await dispatch(main,'1001',cachedDocument);assert.equal(after9.state,'CACHED');assert.equal(after9.model_revision,SECOND);assert.equal(after9.job_key,key('1001',SECOND));assert.equal((await dispatch(main,'1001',review)).model_revision,REPAIR);
 await db.exec('reset role');assert.equal((await db.query('select model_revision from '+bindingTable+' where batch_id=$1 and symbol=$2 and review_document_hash=$3',[main,'1001',cachedDocument])).rows[0].model_revision,SECOND,'CACHED decisions persist the immutable document binding');await db.exec('rollback');
 await db.exec('begin;set local role service_role');const exhausted=job('1001',SECOND);
 for(let i=0;i<3;i++){const claim=await exhausted.call('CLAIM');await exhausted.call('FAIL',{lease:claim.lease,code:'AI_BATCH_ISOLATED_REPAIR_FAILURE'});}
 assert.equal((await dispatch(main,'1001',otherReview)).state,'EXHAUSTED');assert.equal((await exhausted.call('CLAIM')).state,'EXHAUSTED');await db.exec('rollback');
 phase='all repair rounds share the original normal216 cap';
 await db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) select n,$1 from generate_series(10000,10214)n',[budgetNormal]);
 await db.exec('set role service_role');assert.equal((await normal(budgetNormal)).state,'DISPATCHED');assert.equal((await dispatch(budgetNormal,'1001',otherReview)).state,'DISPATCH_BUDGET_EXHAUSTED');await db.exec('reset role');
 assert.equal((await db.query('select model_revision from '+bindingTable+' where batch_id=$1 and symbol=$2 and review_document_hash=$3',[budgetNormal,'1001',otherReview])).rows[0].model_revision,SECOND,'budget response also fixes the document round');
 await db.exec('set role service_role');await assert.rejects(()=>load(budgetNormal,'1001',otherReview),/query returned no rows/);await db.exec('reset role');
 await db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) select n,$1 from generate_series(20000,20214)n',[budgetRepair]);
 await db.exec('set role service_role');const last=await dispatch(budgetRepair,'1001',otherReview);assert.equal(last.state,'DISPATCHED');assert.equal(last.model_revision,SECOND);assert.equal((await normal(budgetRepair)).state,'DISPATCH_BUDGET_EXHAUSTED');await db.exec('reset role');
 for(const batch of [budgetNormal,budgetRepair])assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_dispatches where batch_id=$1',[batch])).rows[0].n,216);
 assert.equal((await db.query('select repair_model_revision from vnext_runtime.ai_stock_dispatches where request_id=$1',[last.request_id])).rows[0].repair_model_revision,SECOND);
 const rls=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass",[bindingTable])).rows[0];assert(rls.relrowsecurity&&rls.relforcerowsecurity);
 assert.equal(await count('vnext_private.ai_research_editions'),0);
 console.log('PASS: V2 legacyNULL=8 compatibility, immutable document→round binding acrossBUSY/COMPLETE, exact original7+prior8 fences for9, canonical identities, review-bound receipts, revision-local duplicate suppression, real9 claim race/cache/exhaustion/no10, auth/server-only selection and shared216 budget. No network/model/production writes.');
}catch(error){console.error(JSON.stringify({phase,error:String(error.message).slice(0,3000),code:error.code,where:error.where,site:error.stack?.split('\n').find(line=>line.includes('dailyAiTargetedRepairV2Database.integration.mjs'))}));process.exitCode=1;
}finally{await db.close();}
