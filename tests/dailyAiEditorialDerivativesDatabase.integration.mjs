/** Isolated PostgreSQL safety tests; no provider or production connection.
 * Default: synthetic 72-stock fixtures only.
 * Required: MA_PGLITE_MODULE=<absolute PGlite module path>.
 * Optional private replay: MA_EDITORIAL_ACTUAL_FIXTURE_DIR=<absolute directory>
 * containing batch.payload-text, inputs/<symbol>.json, and
 * outputs/<symbol>.reviewed-derivative.json. These files are never committed.
 * MA_EDITORIAL_ACTUAL_BATCH_FILE may override the absolute batch file path.
 * MA_EDITORIAL_ACTUAL_SYMBOLS may select exactly four fixture symbols.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
const modulePath=process.env.MA_PGLITE_MODULE;assert(modulePath&&isAbsolute(modulePath),'LOCAL_PGLITE_MODULE_REQUIRED');
const actualFixtureDir=process.env.MA_EDITORIAL_ACTUAL_FIXTURE_DIR;
if(actualFixtureDir)assert(isAbsolute(actualFixtureDir),'ABSOLUTE_PRIVATE_FIXTURE_DIRECTORY_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const sha=s=>createHash('sha256').update(s).digest('hex'),OWNER='00000000-0000-0000-0000-000000000001';
let assertions=0;const equal=(a,b,message)=>{assert.deepEqual(a,b,message);assertions++;};
const rejects=async(fn,re,message)=>{await assert.rejects(fn,re,message);assertions++;};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const asRole=async role=>{await db.exec('reset role');if(role)await db.exec('set role '+role);};
const identity=async tier=>{await asRole(null);await q("select set_config('test.uid',$1,false),set_config('test.tier',$2,false)",[OWNER,tier]);await asRole('authenticated');};
const sqlFile=async name=>readFile(new URL('../research/'+name,import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${OWNER}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,
 storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;`);
 for(const file of ['daily-ai-jobs.candidate.sql','daily-ai-batches.candidate.sql','daily-ai-member.candidate.sql','daily-ai-model-candidates.candidate.sql'])await db.exec(await sqlFile(file));
 const originalFunctions=await q("select proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in('stage_daily_ai_research_edition_v1','review_daily_ai_research_edition_v1','get_daily_ai_member_research_v1','get_daily_ai_owner_research_v1')) or (n.nspname='vnext_private' and p.proname in('ai_edition_rights_v1','ai_edition_integrity_v1','validate_ai_research_review_v1')) order by proname");
 await db.exec(await sqlFile('daily-ai-editorial-derivatives.candidate.sql'));
 equal(await q("select proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in('stage_daily_ai_research_edition_v1','review_daily_ai_research_edition_v1','get_daily_ai_member_research_v1','get_daily_ai_owner_research_v1')) or (n.nspname='vnext_private' and p.proname in('ai_edition_rights_v1','ai_edition_integrity_v1','validate_ai_research_review_v1')) order by proname"),originalFunctions,'All seven existing gates/readers remain byte-for-byte unchanged');
 const now=Date.now(),cutoff=new Date(now-3600000).toISOString(),available=new Date(now-7200000).toISOString(),through=new Date(now-8*3600000).toISOString().slice(0,10);
 const expires=new Date(now+3600000).toISOString(),packets=[],texts={},hashes={},jobKeys=[],fixtures=[];
 const symbols=['1605','2049','2303','2308',...Array.from({length:68},(_,i)=>String(1000+i))];
 for(const symbol of symbols){
  const packet={symbol,company:'隔離測試'+symbol,cutoff,data_through:through,data_gaps:['SYNTHETIC_ONLY_NOT_MEMBER_RESEARCH'],evidence:[
   {id:symbol+':PRICE:one',symbol,kind:'PRICE',source:'https://www.twse.com.tw/synthetic',published_at:available,available_at:available,content:'隔離測試價格來源，非真實行情。'},
   {id:symbol+':PRICE:two',symbol,kind:'PRICE',source:'https://www.twse.com.tw/synthetic',published_at:available,available_at:available,content:'隔離測試前日價格，非真實行情。'}]};
  packets.push(packet);texts[symbol]=canonical(packet);hashes[symbol]=await snapshotHash(packet);
  const revision='synthetic-original-model',key=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:hashes[symbol],model_revision:revision});jobKeys.push(key);
  const horizons=['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:horizon==='LONG'?'INSUFFICIENT':'WAIT',reason:{text:'隔離測試原始研究，不得發布',evidence_ids:[packet.evidence[0].id]},counter_evidence:[{text:'隔離測試原始反證',evidence_ids:[packet.evidence[0].id]}],confirmation:'等待確認來源',invalidation:'來源否定時停止',gaps:['隔離測試資料缺口']}));
  const candidate={symbol,horizons},receipt={response_id:'synthetic-'+symbol,model:'synthetic-model',input_tokens:0,output_tokens:0};
  const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol,cutoff,input_hash:hashes[symbol],model_generated:true,member_published:false,publication_ready:false,receipt,horizons,sources:packet.evidence.map(({content,...s})=>s)};
  await q("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$6)",[key,hashes[symbol],revision,symbol,cutoff,result]);
  const cp=(await q("insert into vnext_runtime.ai_stock_model_candidates(response_id,job_id,candidate,candidate_hash,receipt) values($1,$2,$3,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),$4) returning candidate_hash",[receipt.response_id,key,candidate,receipt]))[0].candidate_hash;
  const pgHash=(await q("select encode(sha256(convert_to(result::text,'UTF8')),'hex') as hash from vnext_runtime.ai_stock_jobs where id=$1",[key]))[0].hash;
  fixtures.push({symbol,packet,result,key,cp,pgHash,revision,receipt});
 }
 const batchBody={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through,packet_texts:texts,packet_hashes:hashes,gaps:[]},batchText=canonical(batchBody),batchId=await snapshotHash(batchBody);
 await asRole('service_role');await q('select public.store_daily_stock_ai_batch_v1($1,$2)',[batchText,batchId]);
 const base=(await q('select public.stage_daily_ai_research_edition_v1($1,$2,$3) as result',[batchId,jobKeys,expires]))[0].result.edition_id;
 await asRole(null);const originalJobCommitment=await q("select encode(sha256(convert_to(string_agg(id||':'||result::text,',' order by id),'UTF8')),'hex') as hash from vnext_runtime.ai_stock_jobs");
 const bodies=[];
 for(const f of fixtures.slice(0,4)){
  const counter=f.symbol==='2308',claimPath=counter?'counter_evidence.0':'reason';
  const before=structuredClone(counter?f.result.horizons[0].counter_evidence[0]:f.result.horizons[0].reason),after={text:'隔離測試修正引用，不得發布',evidence_ids:[...before.evidence_ids,f.symbol+':PRICE:two']};
  const horizons=structuredClone(f.result.horizons);if(counter)horizons[0].counter_evidence[0]=after;else horizons[0].reason=after;
  const body={schema:'DAILY_AI_REVIEWED_DERIVATIVE_V1',symbol:f.symbol,batch_id:batchId,cutoff,input_hash:hashes[f.symbol],original_job_key:f.key,original_model_revision:f.revision,
   original_response_id:f.receipt.response_id,original_candidate_pg_hash:f.cp,original_result_hash:await snapshotHash(f.result),original_result_pg_hash:f.pgHash,
   original_horizons_hash:await snapshotHash(f.result.horizons),proposal_document_hash:'a'.repeat(64),proposal_hash:'b'.repeat(64),reviewed_at:new Date().toISOString(),review_kind:'EDITORIAL_CORRECTION',horizons,
   change:{horizon:'SHORT',claim_path:claimPath,before,after,reason:'隔離測試；追加同一個已封存輸入中存在的引用來源。'},model_generated:false,paid_model_calls:0,production_writes:0,member_published:false,publication_ready:false,status:'MECHANICAL_PASS_INDEPENDENT_REVIEW_REQUIRED'};
  bodies.push(body);
 }
 const doc='c'.repeat(64),importBody=async(body,document=doc)=>{const text=canonical(body),hash=await snapshotHash(body);return (await q('select public.stage_daily_ai_editorial_derivative_v1($1,$2,$3) as result',[text,hash,document]))[0].result;};
 const stage=async(hashes,expiry=expires,baseId=base)=>(await q('select public.stage_daily_ai_editorial_edition_v1($1,$2,$3) as result',[baseId,hashes,expiry]))[0].result;
 for(const role of ['anon','authenticated']){
  await asRole(role);await rejects(()=>importBody(bodies[0]),/permission denied/);await rejects(()=>stage(['a'.repeat(64)]),/permission denied/);
  await rejects(()=>q('select * from vnext_private.ai_editorial_derivatives_v1'),/permission denied/);
 }
 await asRole('service_role');await rejects(()=>q('select * from vnext_private.ai_editorial_derivatives_v1'),/permission denied/);
 const derivativeHashes=[];
 for(const body of bodies){const imported=await importBody(body);derivativeHashes.push(imported.derivative_hash);equal(imported.model_calls,0);equal(imported.member_published,false);equal(imported.review_reference_only,true);}
 equal((await importBody(bodies[0])).derivative_hash,derivativeHashes[0],'exact replay is idempotent');
 await rejects(()=>importBody(bodies[0],'d'.repeat(64)),/AI_EDITORIAL_REPLAY_CONFLICT/);
 await rejects(()=>q('select public.stage_daily_ai_editorial_derivative_v1($1,$2,$3)',[canonical(bodies[0]),'f'.repeat(64),doc]),/AI_EDITORIAL_HASH/);
 for(const [field,value,error] of [['model_generated',true,/AI_EDITORIAL_SCOPE/],['paid_model_calls',1,/AI_EDITORIAL_SCOPE/],['member_published',true,/AI_EDITORIAL_SCOPE/],['original_result_pg_hash','f'.repeat(64),/AI_EDITORIAL_ORIGIN/],['original_candidate_pg_hash','f'.repeat(64),/AI_EDITORIAL_RECEIPT/],['cutoff',new Date(now+60000).toISOString(),/AI_EDITORIAL_ORIGIN/],['reviewed_at',available,/AI_EDITORIAL_CHANGE_SCOPE/]]){
  const wrong=structuredClone(bodies[0]);wrong[field]=value;await rejects(()=>importBody(wrong),error,field);
 }
 let wrong=structuredClone(bodies[0]);wrong.horizons[2].status='WATCH';await rejects(()=>importBody(wrong),/AI_EDITORIAL_UNRELATED_CHANGE/);
 for(const value of [null,123,'not-a-date','now','']){const invalidTime=structuredClone(bodies[0]);invalidTime.reviewed_at=value;await rejects(()=>importBody(invalidTime),/AI_EDITORIAL_SCOPE|invalid input syntax/,'reviewed_at must be a valid required timestamp string');}
 wrong=structuredClone(bodies[0]);delete wrong.reviewed_at;await rejects(()=>importBody(wrong),/AI_EDITORIAL_SCOPE/);
 wrong=structuredClone(bodies[0]);wrong.change.after.evidence_ids.push('not-in-packet');wrong.horizons[0].reason=wrong.change.after;await rejects(()=>importBody(wrong),/AI_EDITORIAL_CLAIM/);
 wrong=structuredClone(bodies[0]);wrong.change.before.text='forged original';await rejects(()=>importBody(wrong),/AI_EDITORIAL_CLAIM/);
 await rejects(()=>stage([...derivativeHashes,derivativeHashes[0]]),/AI_EDITORIAL_EDITION_DUPLICATE/);
 await rejects(()=>stage(['f'.repeat(64)]),/AI_EDITORIAL_EDITION_MISSING/);
 await rejects(()=>stage(derivativeHashes,new Date(now+7200000).toISOString()),/AI_EDITORIAL_EDITION_BASE/,'cannot extend old data expiry');
 const staged=await stage(derivativeHashes);equal(staged.periods,216);equal(staged.model_calls,0);equal(staged.reviews_copied,false);equal(staged.member_published,false);
 equal((await stage(derivativeHashes)).edition_id,staged.edition_id,'staging is idempotent');
 await rejects(()=>stage(derivativeHashes,expires,staged.edition_id),/AI_EDITORIAL_EDITION_BASE/,'no chained corrections can refresh provenance');
 await asRole(null);equal(await q("select encode(sha256(convert_to(string_agg(id||':'||result::text,',' order by id),'UTF8')),'hex') as hash from vnext_runtime.ai_stock_jobs"),originalJobCommitment,'all original jobs/receipts remain unchanged');
 const newEdition=(await q('select * from vnext_private.ai_research_editions where id=$1',[staged.edition_id]))[0];
 equal(newEdition.cutoff,(await q('select cutoff from vnext_private.ai_research_editions where id=$1',[base]))[0].cutoff);
 equal(newEdition.expires_at,(await q('select expires_at from vnext_private.ai_research_editions where id=$1',[base]))[0].expires_at);
 equal(newEdition.payload.editorial_provenance.derivatives.length,4);
 equal((await q('select vnext_private.ai_edition_integrity_v1($1) as valid',[staged.edition_id]))[0].valid,true);
 equal((await q('select count(*)::integer as n from vnext_private.ai_research_reviews where edition_id=$1',[staged.edition_id]))[0].n,0);
 equal((await q('select count(*)::integer as n from vnext_private.ai_research_publication_events where edition_id=$1',[staged.edition_id]))[0].n,0);
 for(const symbol of symbols.slice(0,4)){
  const c=newEdition.payload.cards.find(c=>c.symbol===symbol&&c.horizon==='SHORT'),change=bodies.find(b=>b.symbol===symbol).change;equal(change.claim_path==='reason'?c.reason:c.counter_evidence[0],change.after);equal(c.sources.length,2);
  equal(newEdition.payload.cards.find(c=>c.symbol===symbol&&c.horizon==='LONG').status,'INSUFFICIENT');
 }
 await rejects(()=>q('update vnext_private.ai_editorial_derivatives_v1 set review_document_hash=$1',['f'.repeat(64)]),/IMMUTABLE/);
 await rejects(()=>q('delete from vnext_private.ai_editorial_derivatives_v1'),/IMMUTABLE/);
 await rejects(()=>q('update vnext_runtime.ai_stock_jobs set result=$1 where id=$2',[{},jobKeys[0]]),/AI_JOB_COMPLETED_IMMUTABLE/);
 await identity('premium');equal((await q('select public.get_daily_ai_member_research_v1() as result'))[0].result.cards.length,0,'staging alone never exposes paid cards');
 await identity('owner');const preview=(await q('select public.get_daily_ai_owner_research_v1($1) as result',[staged.edition_id]))[0].result;
 equal(preview.integrity_ready,true);equal(preview.review_ready,false);equal(preview.publish_ready,false);equal(preview.cards.length,216);
 await asRole('service_role');const review=(await q(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,quality,time_status,licensing,
 quality_document_hash,time_document_hash,license_document_hash,reason,expires_at) values($1,$1,'independent-synthetic-reviewer','PASS','PASS','PASS',$2,$2,$2,'Isolated synthetic review only, not real member publication',$3) returning id`,[staged.edition_id,doc,expires]))[0].id;
 await identity('premium');await rejects(()=>q('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5)',[staged.edition_id,review,'APPROVE','premium','00000000-0000-0000-0000-000000000009']),/OWNER_REQUIRED/);
 await identity('owner');await rejects(()=>q('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5)',[staged.edition_id,review,'APPROVE','premium','00000000-0000-0000-0000-000000000009']),/AI_EDITION_PREREQUISITES/,'source-use/rights still required');
 await asRole(null);await q("insert into vnext_private.source_licenses values('synthetic','https://www.twse.com.tw/synthetic','https://data.gov.tw/license',now(),now()+interval '2 hours',true,true,true,false,'Synthetic isolated test attribution')");
 await identity('owner');equal((await q('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5) as result',[staged.edition_id,review,'APPROVE','premium','00000000-0000-0000-0000-000000000009']))[0].result.action,'APPROVE');
 await identity('premium');const member=(await q('select public.get_daily_ai_member_research_v1() as result'))[0].result;equal(member.cards.length,216);equal(member.edition.id,staged.edition_id);equal(JSON.stringify(member).includes('original_response_id'),false);
 await asRole(null);const rls=(await q("select relrowsecurity,relforcerowsecurity from pg_class where oid='vnext_private.ai_editorial_derivatives_v1'::regclass"))[0];equal(rls,{relrowsecurity:true,relforcerowsecurity:true});
 // Private replay is explicit opt-in and remains in this isolated DB.
 let actualDerivativesImported=0;
 if(actualFixtureDir){
 await asRole(null);
 const actualBatchFile=process.env.MA_EDITORIAL_ACTUAL_BATCH_FILE??join(actualFixtureDir,'batch.payload-text');
 assert(isAbsolute(actualBatchFile),'ABSOLUTE_PRIVATE_BATCH_FILE_REQUIRED');
 const actualText=await readFile(actualBatchFile,'utf8'),actualBody=JSON.parse(actualText),actualBatch=sha(actualText);
 equal(Object.keys(actualBody.packet_texts).length,72);
 const actualInputs=[],actualSymbols=(process.env.MA_EDITORIAL_ACTUAL_SYMBOLS??'1605,2049,2303,2308').split(',');
 assert(actualSymbols.length===4&&new Set(actualSymbols).size===4&&actualSymbols.every(s=>/^\d{4,6}$/.test(s)),'FOUR_DISTINCT_ACTUAL_SYMBOLS_REQUIRED');
 for(const symbol of actualSymbols){
  const input=JSON.parse(await readFile(join(actualFixtureDir,'inputs',symbol+'.json'),'utf8'));actualInputs.push(input);
  equal(input.batch_id,actualBatch,'actual input binds the exact retained batch commitment');
  equal(JSON.parse(actualBody.packet_texts[symbol]),input.packet,'actual packet matches exact retained batch');
  await q("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$6)",[input.job.id,input.job.input_hash,input.job.model_revision,symbol,input.packet.cutoff,input.job.result]);
  await q("insert into vnext_runtime.ai_stock_model_candidates(response_id,job_id,candidate,candidate_hash,receipt) values($1,$2,$3,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),$4)",[input.response_id,input.job.id,input.candidate,input.job.result.receipt]);
 }
 await asRole('service_role');await q('select public.store_daily_stock_ai_batch_v1($1,$2)',[actualText,actualBatch]);
 const actualHashes=[];
 for(const input of actualInputs){
  const derivative=JSON.parse(await readFile(join(actualFixtureDir,'outputs',input.packet.symbol+'.reviewed-derivative.json'),'utf8'));
  const {derivative_hash,...body}=derivative;equal(sha(canonical(body)),derivative_hash);
  const actualImported=(await q('select public.stage_daily_ai_editorial_derivative_v1($1,$2,$3) as result',[canonical(body),derivative_hash,doc]))[0].result;
  equal(actualImported.state,'EDITORIAL_STAGED_REVIEW_REQUIRED');equal(actualImported.model_calls,0);actualHashes.push(derivative_hash);
 }
 await rejects(()=>stage(actualHashes),/AI_EDITORIAL_EDITION_BINDING/,'actual new-cutoff corrections cannot be mixed into an older synthetic/base edition');
 const missingActualJobs=[...actualInputs.map(i=>i.job.id),...Array.from({length:68},(_,i)=>sha('missing-original-job-'+i))];
 await rejects(()=>q('select public.stage_daily_ai_research_edition_v1($1,$2,$3)',[actualBatch,missingActualJobs,expires]),/AI_EDITION_INCOMPLETE/,'four actual corrections cannot pretend to complete the missing 68 jobs');
 await asRole(null);equal((await q('select count(*)::integer as n from vnext_private.ai_editorial_derivatives_v1 where batch_id=$1',[actualBatch]))[0].n,4);
 equal((await q('select count(*)::integer as n from vnext_private.ai_research_editions where batch_id=$1',[actualBatch]))[0].n,0,'no actual research edition or member publication was created');
 actualDerivativesImported=actualInputs.length;
 }
 const summary={schema:'AI_EDITORIAL_ADMISSION_SQL_TEST_V1',status:'PASS',assertions,synthetic_publication_only:true,actual_input_imported_only_to_isolated_db:Boolean(actualFixtureDir),actual_derivatives_imported:actualDerivativesImported,real_database:'PGlite PostgreSQL',paid_model_calls:0,production_writes:0,original_functions_unchanged:originalFunctions.map(f=>f.proname),tests_actual_four_derivatives:Boolean(actualFixtureDir)};
 console.log(JSON.stringify(summary));
}catch(error){console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;}finally{await db.close();}
