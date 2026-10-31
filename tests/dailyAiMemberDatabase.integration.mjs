// Isolated PostgreSQL only. All identities, grants and model results are synthetic.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {parseDailyAiOwner} from '../src/features/vnext/dailyAiOwner.ts';
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
const OWNER='00000000-0000-0000-0000-000000000001';
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
 await db.exec(readFileSync(new URL('../research/daily-ai-jobs.candidate.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../research/daily-ai-batches.candidate.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../research/daily-ai-member.candidate.sql',import.meta.url),'utf8'));
 const cutoff='2026-10-30T12:00:00Z',expires=new Date(Date.now()+3600000).toISOString(),packets=[],texts={},hashes={},jobs=[],jobResults=[];
 for(let i=0;i<72;i++){
  const symbol=String(1000+i),packet={symbol,company:'測試公司'+i,cutoff,data_through:'2026-10-30',data_gaps:['RETAINED_INPUT_LIMITATION'],evidence:[{id:'N'+i,symbol,kind:'NEWS',source:'https://www.twse.com.tw/test-news',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'SECRET_ORIGINAL_NEWS_BODY'},
   {id:'MARKET',symbol:null,kind:'MARKET',source:'https://www.twse.com.tw/test-market',published_at:null,time_basis:'OBSERVED_AFTER_RECEIPT',first_seen_at:'2026-10-30T11:00:00Z',as_of:'2026-10-30T10:00:00Z',evidence_hash:'b'.repeat(64),available_at:'2026-10-30T11:00:00Z',content:'SECRET_PROVIDER_PAYLOAD'},
   {id:'UNUSED'+i,symbol,kind:'NEWS',source:'https://www.twse.com.tw/uncited-input',published_at:'2026-10-30T10:00:00Z',available_at:'2026-10-30T11:00:00Z',content:'SECRET_UNCITED_INPUT'}]};
  packets.push(packet);texts[symbol]=canonical(packet);hashes[symbol]=await snapshotHash(packet);
  const id=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:hashes[symbol],model_revision:'test-model-v1'});jobs.push(id);
  const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol,cutoff,input_hash:hashes[symbol],model_generated:true,member_published:false,publication_ready:false,
   receipt:{response_id:'synthetic-'+i,model:'test-model'},sources:packet.evidence.map(({content,...source})=>source),
   horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:i===0?'INSUFFICIENT':'WAIT',reason:{text:'測試推論，並非股票建議',evidence_ids:['N'+i]},
    counter_evidence:[{text:'仍有市場波動',evidence_ids:['MARKET']}],confirmation:'等待新的資料核對',invalidation:'若新證據否定原假設則撤回',gaps:i===0?['尚缺資料']:[]}))};
  jobResults.push(result);await db.query("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,'test-model-v1',$3,$4,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$5)",[id,hashes[symbol],symbol,cutoff,result]);
 }
 const body={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through:'2026-10-30',packet_texts:texts,packet_hashes:hashes,gaps:[]};
 const serialized=canonical(body),batchId=await snapshotHash(body);
 await db.exec('set role service_role');await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[serialized,batchId]);await db.exec('reset role');
 const stage=async ids=>(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) result',[batchId,ids??jobs,expires])).rows[0].result;
 const read=async()=>(await db.query('select public.get_daily_ai_member_research_v1() result')).rows[0].result;
 const inspect=async id=>(await db.query('select public.get_daily_ai_owner_research_v1($1) result',[id??null])).rows[0].result;
 const identity=async tier=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.tier',$2,false)",[OWNER,tier]);await db.exec('set role authenticated');};
 await identity('owner');const emptyPreview=await inspect();assert.equal(parseDailyAiOwner(emptyPreview).edition,null);assert.deepEqual(emptyPreview.source_urls,[]);assert.deepEqual(emptyPreview.cards,[]);await db.exec('reset role');
 await db.exec('set role anon');await assert.rejects(read,/permission denied/);await assert.rejects(()=>inspect(),/permission denied/);await assert.rejects(()=>stage(),/permission denied/);await db.exec('reset role');
 await db.exec('set role service_role');await assert.rejects(()=>db.query('select * from vnext_private.ai_research_editions'),/permission denied/);
 await assert.rejects(()=>stage(jobs.slice(0,71)),/AI_EDITION_SCOPE/);
 let badFixture=0;const stageBadResult=async value=>{await db.exec('reset role');const revision='bad-fixture-'+(++badFixture),id=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:hashes['1000'],model_revision:revision});
  await db.query("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,$3,'1000',$4,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$5)",[id,hashes['1000'],revision,cutoff,value]);await db.exec('set role service_role');return stage([id,...jobs.slice(1)]);};
 let corrupted=structuredClone(jobResults[0]);corrupted.input_hash='f'.repeat(64);await assert.rejects(()=>stageBadResult(corrupted),/AI_EDITION_PROVENANCE/);
 corrupted=structuredClone(jobResults[0]);corrupted.sources[1]=corrupted.sources[0];await assert.rejects(()=>stageBadResult(corrupted),/AI_EDITION_SOURCE_SET/);
 corrupted=structuredClone(jobResults[0]);corrupted.horizons[0].reason.evidence_ids=['unseen-evidence'];await assert.rejects(()=>stageBadResult(corrupted),/AI_EDITION_CITATION/);
 corrupted=structuredClone(jobResults[0]);corrupted.horizons[0].status='WATCH';corrupted.horizons[0].reason.evidence_ids=['MARKET'];await assert.rejects(()=>stageBadResult(corrupted),/AI_EDITION_ANALYSIS/);
 const staged=await stage();assert.equal(staged.rights_ready,false);const eid=staged.edition_id;assert.equal((await stage()).edition_id,eid);
 await identity('premium');assert.equal((await read()).cards.length,0);await assert.rejects(()=>inspect(),/OWNER_REQUIRED/);await assert.rejects(()=>db.query('select * from vnext_private.ai_research_editions'),/permission denied/);
 await identity('owner');const preview=await inspect(eid);assert.equal(preview.edition.id,eid);assert.equal(preview.edition.jobs,72);assert.equal(preview.cards.length,216);assert.equal(preview.preview_only,true);assert.equal(preview.rights_ready,false);assert.equal(preview.integrity_ready,true);assert.equal(preview.review_ready,false);assert.equal(preview.publish_ready,false);assert.equal(preview.publication,null);assert(!JSON.stringify(preview).includes('SECRET_'));
 assert.equal(parseDailyAiOwner(preview).cards.length,216);
 await db.exec('reset role;set role service_role');
 const doc='a'.repeat(64),review=await db.query(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,quality,time_status,licensing,
 quality_document_hash,time_document_hash,license_document_hash,reason,expires_at) values($1,$1,'independent-test-reviewer','PASS','PASS','PASS',$2,$2,$2,'Synthetic isolated test review',$3) returning id`,[eid,doc,expires]);
 let rid=review.rows[0].id;const request='00000000-0000-0000-0000-000000000010';
 const approve=async(action='APPROVE',audience='free',key=request)=>(await db.query('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5) result',[eid,rid,action,audience,key])).rows[0].result;
 await identity('free');await assert.rejects(()=>approve(),/OWNER_REQUIRED/);
 await identity('owner');await assert.rejects(()=>approve(),/AI_EDITION_PREREQUISITES/);
 await assert.rejects(()=>db.query('select public.review_daily_ai_research_edition_v1($1,null,$2,$3,$4)',[eid,'APPROVE','free','00000000-0000-0000-0000-000000000099']),/AI_EDITION_REVIEW_SCOPE/);
 await db.exec('reset role');
 for(const [i,url] of ['https://www.twse.com.tw/test-news','https://www.twse.com.tw/test-market'].entries())await db.query(`insert into vnext_private.source_licenses values($1,$2,'https://data.gov.tw/license',now(),now()+interval '2 hours',true,true,true,false,'Synthetic attribution')`,['grant-'+i,url]);
 await identity('owner');assert.equal((await inspect()).source_urls.length,3);assert.equal((await inspect()).publish_ready,false);await assert.rejects(()=>approve(),/AI_EDITION_PREREQUISITES/);
 await db.exec('reset role');await db.query("insert into vnext_private.source_licenses values('grant-2','https://www.twse.com.tw/uncited-input','https://data.gov.tw/license',now(),now()+interval '2 hours',true,true,true,false,'Synthetic attribution')");
 await identity('owner');assert.equal((await inspect()).publish_ready,true);assert.equal((await approve()).action,'APPROVE');assert.equal((await approve()).replayed,true);assert.equal((await inspect()).publication.action,'APPROVE');
 await identity('premium');const premium=await read();assert.equal(premium.cards.length,216);assert.equal(premium.edition.mode,'AS_OF_RESEARCH');assert.equal(premium.edition.forecast,false);assert.equal(premium.edition.performance_available,false);
 assert.equal(parseDailyAiMember(premium).cards.length,216);
 assert.equal(premium.cards.filter(c=>c.horizon==='SHORT').length,72);assert.equal(premium.cards[0].status,'INSUFFICIENT');assert(!JSON.stringify(premium).includes('SECRET_'));assert(!JSON.stringify(premium).includes('receipt'));
 assert(premium.cards.every(c=>c.gaps.includes('RETAINED_INPUT_LIMITATION')));const receiptOnly=premium.cards[0].sources.find(s=>s.id==='MARKET');assert.equal(receiptOnly.published_at,null);assert.equal(receiptOnly.time_basis,'OBSERVED_AFTER_RECEIPT');assert.equal(receiptOnly.evidence_hash,'b'.repeat(64));
 assert(premium.cards.every(c=>c.sources.length===2&&!c.sources.some(s=>s.id.startsWith('UNUSED'))));
 await identity('free');const free=await read();assert.equal(free.cards.length,9);assert.equal(new Set(free.cards.map(c=>c.symbol)).size,3);assert(free.cards.every(c=>!('sources' in c)&&!('counter_evidence' in c)));
 assert.equal(parseDailyAiMember(free).cards.length,9);
 await db.exec('reset role');await db.query("update vnext_private.source_licenses set expires_at=now()-interval '1 minute' where id='grant-0'");await identity('premium');assert.equal((await read()).cards.length,0);
 await db.exec('reset role');await db.query("update vnext_private.source_licenses set expires_at=now()+interval '2 hours' where id='grant-0'");await identity('premium');assert.equal((await read()).cards.length,216);
 await db.exec('reset role');await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_jobs set result=$1 where id=$2',[{},jobs[0]]),/AI_JOB_COMPLETED_IMMUTABLE/);await assert.rejects(()=>db.query('delete from vnext_runtime.ai_stock_jobs where id=$1',[jobs[0]]),/AI_JOB_COMPLETED_IMMUTABLE/);
 await assert.rejects(()=>db.query('update vnext_runtime.ai_stock_batches set payload=$1 where id=$2',[{},batchId]),/IMMUTABLE/);await identity('premium');assert.equal((await read()).cards.length,216);
 await db.exec('reset role;set role service_role');
 await assert.rejects(()=>db.query(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,quality,time_status,licensing,
 quality_document_hash,time_document_hash,license_document_hash,reason,expires_at) values($1,$1,'test-model-v1','PASS','PASS','PASS',$2,$2,$2,'Model cannot independently review itself',$3)`,[eid,doc,expires]),/AI_RESEARCH_REVIEW_INVALID/);
 const failedReview=await db.query(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,quality,time_status,licensing,
 quality_document_hash,time_document_hash,license_document_hash,reason,expires_at) values($1,$1,'independent-test-reviewer','FAIL','PASS','PASS',$2,$2,$2,'New review supersedes prior approval',$3) returning id`,[eid,doc,expires]);rid=failedReview.rows[0].id;
 await identity('premium');assert.equal((await read()).cards.length,0);
 await identity('owner');const failedPreview=parseDailyAiOwner(await inspect());assert.equal(failedPreview.review_ready,false);assert.equal(failedPreview.publish_ready,false);assert.equal(failedPreview.publication.action,'APPROVE');await assert.rejects(()=>approve('APPROVE','free','00000000-0000-0000-0000-000000000012'),/AI_EDITION_PREREQUISITES/);
 await identity('owner');await approve('REVOKE','free','00000000-0000-0000-0000-000000000011');await identity('premium');assert.equal((await read()).cards.length,0);
 // Optional reproducible check against a separately retained real-input seed.
 // Model results here remain synthetic and never receive reviews or grants.
 if(process.env.MA_DAILY_AI_SEED){
  const actualText=readFileSync(process.env.MA_DAILY_AI_SEED,'utf8'),actualBody=JSON.parse(actualText),actualId=await snapshotHash(actualBody),actualJobs=[];
  assert.equal(actualText,canonical(actualBody));await db.exec('reset role;set role service_role');await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[actualText,actualId]);
  const revision='ISOLATED_REAL_INPUT_SYNTHETIC_MODEL_NO_PUBLICATION';
  for(const [symbol,packetText] of Object.entries(actualBody.packet_texts)){
   const packet=JSON.parse(packetText),inputHash=await snapshotHash(packet),jobIdentity={version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:revision},key=await snapshotHash(jobIdentity);actualJobs.push(key);
   const acquired=(await db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4) result',['CLAIM',key,canonical(jobIdentity),{input_hash:inputHash,model_revision:revision,symbol,cutoff:packet.cutoff}])).rows[0].result;
   const own=packet.evidence.find(e=>e.symbol===symbol)??packet.evidence[0],counter=packet.evidence.find(e=>e.symbol===null)??packet.evidence[0];
   const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol,cutoff:packet.cutoff,input_hash:inputHash,model_generated:true,member_published:false,publication_ready:false,
    receipt:{response_id:'synthetic-isolation-'+symbol,model:'synthetic-isolated',input_tokens:0,output_tokens:0},sources:packet.evidence.map(({content,...source})=>source),
    horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'僅驗證真實輸入的隔離測試推論，不得發布',evidence_ids:[own.id]},counter_evidence:[{text:'隔離測試反面條件',evidence_ids:[counter.id]}],confirmation:'等待獨立核對',invalidation:'核對不符即停止',gaps:['SYNTHETIC_ISOLATED_MODEL_RESULT']}))};
   await db.query('select public.daily_stock_ai_job_v1($1,$2,null,null,$3,$4)',['COMPLETE',key,result,acquired.lease]);
  }
  const actualExpiry=new Date(Date.parse(actualBody.cutoff)+72*3600000).toISOString(),actualStaged=(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) result',[actualId,actualJobs,actualExpiry])).rows[0].result;
  await identity('owner');const actualPreview=await inspect(actualStaged.edition_id);assert.equal(actualPreview.integrity_ready,true);assert.equal(actualPreview.rights_ready,false);assert.equal(actualPreview.publish_ready,false);
  assert.equal(parseDailyAiOwner(actualPreview).cards.length,216);
  const projected=parseDailyAiMember({schema:'VNEXT_AI_MEMBER_EDITION_V1',tier:'owner',business_date:new Date(Date.now()+8*3600000).toISOString().slice(0,10),research_only:true,edition:actualPreview.edition,cards:actualPreview.cards});assert.equal(projected.cards.length,216);
  console.log('PASS: retained real seed -> actual batch/job RPCs -> private stage/Owner preview -> strict member parser; synthetic model results remain unpublished.');
 }
 await db.exec('reset role');await assert.rejects(()=>db.query('update vnext_private.ai_research_editions set expires_at=now()'),/IMMUTABLE/);
 console.log('PASS: AS_OF provenance, 72x3, actual batch-store commitment, original input hashes/citations, unknown/expired-rights denial, independent/latest review, actual Owner approval/preview, free 3-stock scope, Premium 216 cards, no raw/prompt/receipt leak, completed-job seal, revocation and immutable batch/edition. Isolated identities/data only.');
}catch(error){console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;}finally{await db.close();}
