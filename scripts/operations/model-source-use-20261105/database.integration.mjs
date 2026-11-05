// Disposable PGlite only. Synthetic reviews are not source rights or product QA.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical} from '../../../research/entry-opportunity.ts';
import {modelSourcePacketsCommitment,readFinancialModelUseReviewedBatch} from '../../../supabase/functions/daily-stock-analysis-v1/model-source-review.ts';
const modulePath=process.env.MA_PGLITE_MODULE;
assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const root=new URL('../../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const candidate=read('research/daily-ai-model-source-use.candidate.sql'),rollback=read('research/daily-ai-model-source-use.rollback.sql');
const prerequisites=read('scripts/operations/model-source-use-20261105/prerequisites.sql');
let checks=0,phase='bootstrap';
const check=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const reject=async(work,pattern)=>{await assert.rejects(work,pattern);checks++;};
const count=async()=>Number((await db.query('select count(*) n from vnext_private.ai_model_source_use_reviews_v1')).rows[0].n);
const load=async id=>(await db.query('select public.load_daily_stock_ai_model_source_use_v1($1) receipt',[id])).rows[0].receipt;
const record=async(d,hash)=>{const text=canonical(d);return (await db.query('select public.record_daily_stock_ai_model_source_use_v1($1,$2) result',[text,hash??sha(text)])).rows[0].result;};
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema vnext_runtime;create schema vnext_private;
 grant usage on schema vnext_private,vnext_runtime to service_role,authenticated,anon;
 create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end $$;`);
 await db.exec(read('research/daily-ai-batches.candidate.sql'));await db.exec(prerequisites);
 const now=Date.now(),cutoff=new Date(now-3600000).toISOString(),through=cutoff.slice(0,10);
 const packet_texts={},packet_hashes={};
 for(let i=0;i<72;i++){
  const symbol=String(1000+i),content=JSON.stringify({kind:'EPS',basis:'SINGLE_QUARTER',period:'2026-Q2',values:{value:1},original_id:'issuer-ir-direct:'+symbol+':q'});
  const packet={symbol,company:'SYNTHETIC_PROTOCOL_ONLY',cutoff,data_through:through,
   data_gaps:['QUARANTINED_ISSUER_RESEARCH_NOT_LICENSED_FOR_MODEL_OR_MEMBER_USE'],evidence:[{
    id:symbol+':FINANCIAL:issuer-ir-direct:q',symbol,kind:'FINANCIAL',source:'https://www.umc.com/synthetic-quarter.pdf',
    content,evidence_hash:sha(content),published_at:cutoff,first_seen_at:cutoff,available_at:cutoff,as_of:cutoff,time_basis:'PUBLISHED'}]};
  packet_texts[symbol]=canonical(packet);packet_hashes[symbol]=sha(packet_texts[symbol]);
 }
 const text=canonical({schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through,packet_texts,packet_hashes,gaps:{}}),batchId=sha(text);
 await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[text,batchId]);
 const batch=(await db.query('select public.load_daily_stock_ai_batch_v1($1,null) batch',[batchId])).rows[0].batch;
 const originalBatch=structuredClone(batch);

 phase='dependency drift refusal';
 await db.exec("create or replace function vnext_private.ai_use_primary_documents_v1(p_basis text,p_urls text[],p_sources text[]) returns boolean language sql immutable set search_path='' as $$select false$$;");
 await reject(()=>db.exec(candidate),/AI_MODEL_USE_PREREQUISITE_DRIFT/);await db.exec('rollback');await db.exec(prerequisites);
 await db.exec('grant execute on function vnext_private.ai_batch_commitment_v1(text) to service_role');
 await reject(()=>db.exec(candidate),/AI_MODEL_USE_PREREQUISITE_DRIFT/);await db.exec('rollback');await db.exec(prerequisites);

 phase='apply empty candidate';await db.exec(candidate);check(await count(),0);check(await load(batchId),null);
 const commitment=(await db.query('select vnext_private.model_source_packets_commitment_v1($1) hash',[batchId])).rows[0].hash;
 check(commitment,await modelSourcePacketsCommitment(batch,new AbortController().signal),'SQL and JS packet commitments must match');
 const base={schema:'DAILY_AI_MODEL_SOURCE_USE_REVIEW_V1',batch_id:batchId,batch_cutoff:cutoff,packets_commitment:commitment,
  quality:'PASS',basis:'FACT_ONLY_OWN_ANALYSIS',use_scope:'FINANCIAL_FACT_MODEL_INPUT_ONLY',reviewer_ref:'SYNTHETIC_PROTOCOL_ONLY',
  reviewed_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3600000).toISOString(),
  review_document_hash:'1'.repeat(64),source_mapping_document_hash:'2'.repeat(64),terms_document_hash:'3'.repeat(64),
  source_urls:['https://www.umc.com/synthetic-quarter.pdf'],official_document_urls:['https://www.tipo.gov.tw/tw/copyright/692-16653.html'],
  documents_status:'VERIFIED',mapping_status:'ALL_INPUTS_REVIEWED',contractual_scope_status:'VERIFIED_FOR_THIS_MODEL_USE',raw_redistribution:false,member_publication_approved:false};

 phase='adversarial review inputs';
 const wrong=[{packets_commitment:'f'.repeat(64)},{batch_cutoff:new Date(Date.parse(cutoff)+1).toISOString()},
  {reviewed_at:new Date(now+60000).toISOString()},{reviewed_at:new Date(Date.parse(cutoff)-1).toISOString()},
  {expires_at:new Date(now-1).toISOString()},{expires_at:new Date(now+73*3600000).toISOString()},
  {quality:'UNKNOWN'},{quality:null},{raw_redistribution:true},{member_publication_approved:true},
  {use_scope:'MEMBER_PUBLICATION'},{basis:'OPEN_LICENSE'},{documents_status:'UNVERIFIED'},{mapping_status:'INCOMPLETE'},
  {contractual_scope_status:'UNKNOWN'},{contractual_scope_status:'RESTRICTED'},{contractual_scope_status:null},
  {official_document_urls:['https://www.umc.com/unknown-policy']},{official_document_urls:[]},
  {source_urls:[]},{source_urls:[...base.source_urls,...base.source_urls]},
  {source_urls:['https://www.umc.com/synthetic-quarter.pdf?date=20200101']},
  {source_urls:['https://www.umc.com/synthetic-quarter.pdf?token=private']},
  {source_urls:['https://www.umc.com.evil.test/synthetic-quarter.pdf']},
  {review_document_hash:null},{source_mapping_document_hash:'x'.repeat(64)},
  {terms_document_hash:123},{reviewer_ref:''},{untrusted_approved:true}];
 for(const changed of wrong){await reject(()=>record({...base,...changed}),/AI_MODEL_USE_/);check(await count(),0,'Rejected reviews write zero rows');}
 await reject(()=>record(base,'f'.repeat(64)),/AI_MODEL_USE_DOCUMENT_HASH/);check(await count(),0);

 phase='pending, valid admission and immutable state';
 const pending={...base,quality:'PENDING',documents_status:'UNVERIFIED',mapping_status:'INCOMPLETE',contractual_scope_status:'UNKNOWN'};
 check((await record(pending)).state,'RECORDED');check(await load(batchId),null);
 const saved=await record(base);check(saved.state,'RECORDED');check(await count(),2);
 const receipt=await load(batchId);check(receipt.review_id,sha(canonical(base)));check(receipt.member_publication_approved,false);
 check(await readFinancialModelUseReviewedBatch(batch,async()=>receipt,new AbortController().signal),originalBatch,'Real SQL receipt passes the actual JS gate');
 check((await record(base)).state,'ALREADY_RECORDED');check(await count(),2);
 check((await db.query('select public.load_daily_stock_ai_batch_v1($1,null) b',[batchId])).rows[0].b,originalBatch);
 check((await db.query('select vnext_private.model_source_use_receipt_at_v1($1,$2) r',[batchId,new Date(now+3600001).toISOString()])).rows[0].r,null,'Private expiry clock cannot revive an expired record');
 check((await db.query('select vnext_private.model_source_use_receipt_at_v1($1,$2) r',[batchId,new Date(now+3570000).toISOString()])).rows[0].r,null,'Near expiry cannot authorize a model run that could outlast the review');

 phase='current primary-document policy is rechecked';
 await db.exec("create or replace function vnext_private.ai_use_primary_documents_v1(p_basis text,p_urls text[],p_sources text[]) returns boolean language sql immutable set search_path='' as $$select false$$;");
 check(await load(batchId),null);await db.exec(prerequisites);assert(await load(batchId));checks++;

 phase='current batch bytes are rechecked';
 await db.exec('alter table vnext_runtime.ai_stock_batches disable trigger ai_stock_batches_immutable');
 await db.query("update vnext_runtime.ai_stock_batches set payload=jsonb_set(payload,'{packets,0,company}','\"LOCAL_CORRUPTION_CONTROL\"') where id=$1",[batchId]);
 check(await load(batchId),null);
 await db.query("update vnext_runtime.ai_stock_batches set payload=(payload_text::jsonb)||jsonb_build_object('packets',(select jsonb_agg(pt.value::jsonb order by pt.key) from jsonb_each_text(payload_text::jsonb->'packet_texts')pt)) where id=$1",[batchId]);
 await db.exec('alter table vnext_runtime.ai_stock_batches enable trigger ai_stock_batches_immutable');assert(await load(batchId));checks++;

 phase='later revocation wins, old pass replay cannot restore it';
 const revoked={...base,quality:'REVOKED',reviewer_ref:'SYNTHETIC_REVOCATION'};await record(revoked);
 check(await load(batchId),null);check((await record(base)).state,'ALREADY_RECORDED');check(await load(batchId),null);
 await record({...base,quality:'PENDING',reviewer_ref:'SYNTHETIC_PENDING_AFTER_REVOKE'});check(await load(batchId),null);

 phase='least privilege, no raw updates and no browser clock';
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await reject(()=>load(batchId),/permission denied/);
  await reject(()=>record(base),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');check(await load(batchId),null);
 await reject(()=>db.query("insert into vnext_private.ai_model_source_use_reviews_v1(document_hash) values($1)",['f'.repeat(64)]),/permission denied/);
 await reject(()=>db.query('select vnext_private.model_source_use_receipt_at_v1($1,$2)',[batchId,cutoff]),/permission denied/);await db.exec('reset role');
 for(const statement of ['update vnext_private.ai_model_source_use_reviews_v1 set quality=\'PASS\'',
  'delete from vnext_private.ai_model_source_use_reviews_v1','truncate vnext_private.ai_model_source_use_reviews_v1'])
  await reject(()=>db.exec(statement),/VNEXT_APPEND_ONLY/);
 const acl=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='vnext_private.ai_model_source_use_reviews_v1'::regclass")).rows[0];
 check(acl,{relrowsecurity:true,relforcerowsecurity:true});
 await reject(()=>db.exec(candidate),/AI_MODEL_USE_ALREADY_PRESENT/);await db.exec('rollback');
 const beforeRollback=await count();await db.exec(rollback);check(await count(),beforeRollback);
 await db.exec('set role service_role');await reject(()=>load(batchId),/permission denied/);await reject(()=>record(base),/permission denied/);await db.exec('reset role');
 check((await db.query('select public.load_daily_stock_ai_batch_v1($1,null) b',[batchId])).rows[0].b,originalBatch,'Rollback preserves the complete original batch');
 const result={status:'PASS',checks,phase,candidate_sha256:sha(candidate),rollback_sha256:sha(rollback),synthetic_reviews_only:true,
  real_source_approval:false,native_network_race_test:false,production_writes:0,model_calls:0,member_published:false};
 writeFileSync(new URL('local-sql-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({status:'FAIL',phase,error:error.message}));process.exitCode=1;}
finally{await db.close();}
