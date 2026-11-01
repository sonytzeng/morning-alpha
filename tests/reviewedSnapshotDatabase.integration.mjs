/** Isolated PostgreSQL only; every stock, fact, review and approval is synthetic. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {validateReviewedAnalysisSnapshot} from '../research/reviewed-snapshot-validator.mjs';
const modulePath=process.env.MA_PGLITE_MODULE;assert(modulePath&&isAbsolute(modulePath),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath);
const db=new PGlite();await db.waitReady;
const sha=s=>createHash('sha256').update(s).digest('hex'),OWNER='00000000-0000-0000-0000-000000000001';
let assertions=0;const equal=(a,b,m)=>{assert.deepEqual(a,b,m);assertions++;},rejects=async(f,re,m)=>{await assert.rejects(f,re,m);assertions++;};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const role=async r=>{await db.exec('reset role');if(r)await db.exec('set role '+r);};
const identity=async tier=>{await role(null);await q("select set_config('test.uid',$1,false),set_config('test.tier',$2,false)",[OWNER,tier]);await role('authenticated');};
const originalSql=async f=>readFile(new URL('../research/'+f,import.meta.url),'utf8');
const projection=e=>({id:e.id,source:e.source,kind:e.kind,published_at:e.published_at,available_at:e.available_at,
 time_basis:e.time_basis??'PUBLISHED',first_seen_at:e.first_seen_at??null,as_of:e.as_of??null,evidence_hash:e.evidence_hash??null});
const now=Date.now(),oldCutoff=new Date(now-7200000).toISOString(),newCutoff=new Date(now-600000).toISOString();
const expires=new Date(now+3600000).toISOString(),through=new Date(now-24*3600000).toISOString().slice(0,10);
async function fixture(cutoff,eps){
 const packet_texts={},packet_hashes={},packets=[],cards=[];
 for(let i=0;i<72;i++){
  const symbol=String(1000+i),observed=new Date(Date.parse(cutoff)-60000).toISOString();
  const financial={id:symbol+':FINANCIAL:one',symbol,kind:'FINANCIAL',source:'https://www.twse.com.tw/synthetic-financial',published_at:observed,available_at:observed,
   content:canonical({kind:'EPS',period:'2026-Q3',unit:'TWD_PER_SHARE',alternate_unit:'USD_PER_SHARE',basis:'BASIC_SINGLE_QUARTER',values:{eps}})};
  const price={...financial,id:symbol+':PRICE:one',kind:'PRICE',source:'https://www.twse.com.tw/synthetic-price',content:canonical({date:through,close:123,volume:5000})};
  const packet={symbol,company:'隔離公司'+symbol,cutoff,data_through:through,data_gaps:['SYNTHETIC_LIMITATION'],evidence:[financial,price]};
  packets.push(packet);packet_texts[symbol]=canonical(packet);packet_hashes[symbol]=sha(packet_texts[symbol]);
  for(const horizon of ['SHORT','MEDIUM','LONG'])cards.push({symbol,company:packet.company,horizon,status:horizon==='LONG'?'INSUFFICIENT':'WAIT',
   reason:{text:'僅供隔離測試的研究推論',evidence_ids:[financial.id]},counter_evidence:[],confirmation:'等待來源確認',invalidation:'新資料否定時停止',
   gaps:['SYNTHETIC_LIMITATION'],sources:[projection(financial)],classification:'INFERENCE'});
 }
 const batch={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through,packet_texts,packet_hashes,gaps:[]},batchText=canonical(batch),batchId=sha(batchText);
 const body={schema:'DAILY_OFFLINE_REVIEWED_ANALYSIS_V1',provenance:'OFFLINE_REVIEWED',author_ref:'offline-synthetic-author',batch_id:batchId,cutoff,through,
  prepared_at:new Date().toISOString(),expires_at:expires,packet_hashes,cards,numeric_assertions:[],reference_jobs:[],model_generated:false,model_calls:0,member_published:false,publication_ready:false};
 return {batch,batchText,batchId,packets,body};
}
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
 for(const f of ['daily-ai-jobs.candidate.sql','daily-ai-batches.candidate.sql','daily-ai-member.candidate.sql','daily-ai-model-candidates.candidate.sql','daily-ai-use-review.candidate.sql'])await db.exec(await originalSql(f));
 const functionNames=['stage_daily_ai_research_edition_v1','review_daily_ai_research_edition_v1','validate_ai_research_review_v1','validate_ai_research_use_review_v1','ai_edition_rights_v1'];
 const definitions=async()=>q("select p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','vnext_private') and p.proname=any($1::text[]) order by p.proname",[functionNames]);
 const gatesBefore=await definitions(),legacySource=(await q("select prosrc from pg_proc where oid='vnext_private.ai_edition_integrity_v1(text)'::regprocedure"))[0].prosrc;
 const old=await fixture(oldCutoff,0.8),fresh=await fixture(newCutoff,1.32),oldJobs=[];
 await role('service_role');for(const f of [old,fresh])await q('select public.store_daily_stock_ai_batch_v1($1,$2)',[f.batchText,f.batchId]);
 await role(null);
 for(const packet of old.packets){
  const hash=old.batch.packet_hashes[packet.symbol],revision='legacy-synthetic-model',id=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:hash,model_revision:revision});oldJobs.push(id);
  const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:packet.symbol,cutoff:oldCutoff,input_hash:hash,model_generated:true,member_published:false,publication_ready:false,
   receipt:{model:'legacy-synthetic-model',response_id:'synthetic-'+packet.symbol},sources:packet.evidence.map(({content,...s})=>s),
   horizons:old.body.cards.filter(c=>c.symbol===packet.symbol).map(({horizon,status,reason,counter_evidence,confirmation,invalidation,gaps})=>({horizon,status,reason,counter_evidence,confirmation,invalidation,gaps}))};
  await q("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$6)",[id,hash,revision,packet.symbol,oldCutoff,result]);
 }
 await role('service_role');const oldEdition=(await q('select public.stage_daily_ai_research_edition_v1($1,$2,$3) result',[old.batchId,oldJobs,expires]))[0].result.edition_id;
 await role(null);const oldJobHash=(await q("select encode(sha256(convert_to(string_agg(id||':'||result::text,',' order by id),'UTF8')),'hex') hash from vnext_runtime.ai_stock_jobs"))[0].hash;
 await db.exec(await readFile(new URL('../research/reviewed-analysis-snapshot.candidate.sql',import.meta.url),'utf8'));
 equal(await definitions(),gatesBefore,'Existing quality/time/source-use/Owner stage and approval function sources remain unchanged');
 equal((await q("select prosrc from pg_proc where oid='vnext_private.ai_model_edition_integrity_legacy_v1(text)'::regprocedure"))[0].prosrc,legacySource,'Legacy model integrity branch remains byte-for-byte identical');
 equal((await q('select vnext_private.ai_edition_integrity_v1($1) valid',[oldEdition]))[0].valid,true);
 await db.exec(await readFile(new URL('../research/offline-review-projection-compat.candidate.sql',import.meta.url),'utf8'));
 const body=fresh.body;body.reference_jobs=oldJobs;
 body.cards[0].reason.text='2026-Q3原報EPS為1.32元，僅供本次收到後研究。';
 body.numeric_assertions=[{symbol:'1000',horizon:'SHORT',claim_path:'reason',claim_hash:await snapshotHash(body.cards[0].reason),text_fragment:'1.32',operator:'EQ',
  left:{evidence_id:'1000:FINANCIAL:one',value_path:['values','eps'],period_path:['period'],period:'2026-Q3',unit_path:['unit'],unit:'TWD_PER_SHARE'},right:{literal:1.32},expected:true}];
 const validation=await validateReviewedAnalysisSnapshot(fresh.batchText,body);equal(validation.authorizes_publication,false);equal(validation.counts.numeric_assertions_verified,1);
 const doc='a'.repeat(64),stageBody=async(value,document=doc)=>{const text=canonical(value),hash=sha(text);return (await q('select public.stage_offline_reviewed_analysis_snapshot_v1($1,$2,$3) result',[text,hash,document]))[0].result;};
 const stageEdition=async(hash,expiry=expires)=>(await q('select public.stage_offline_reviewed_analysis_edition_v1($1,$2) result',[hash,expiry]))[0].result;
 for(const r of ['anon','authenticated']){
  await role(r);await rejects(()=>stageBody(body),/permission denied/);await rejects(()=>stageEdition('a'.repeat(64)),/permission denied/);
  await rejects(()=>q('select * from vnext_private.reviewed_analysis_snapshots_v1'),/permission denied/);
 }
 await role('service_role');await rejects(()=>q('select * from vnext_private.reviewed_analysis_snapshots_v1'),/permission denied/);
 await rejects(()=>q('insert into vnext_private.reviewed_analysis_snapshots_v1(snapshot_hash,batch_id,author_ref,body_text,body,validator_document_hash) values($1,$2,$3,$4,$5,$6)',[sha(canonical(body)),fresh.batchId,body.author_ref,canonical(body),body,doc]),/permission denied/,'Trusted importer still cannot bypass the validated RPC with direct table writes');
 await rejects(()=>q('select public.stage_daily_ai_research_edition_v1($1,$2,$3)',[fresh.batchId,[],expires]),/AI_EDITION_SCOPE/,'Legacy model route still requires 72 actual jobs');
 for(const [field,value,re]of[['model_generated',true,/OFFLINE_SNAPSHOT_SCOPE/],['model_calls',1,/OFFLINE_SNAPSHOT_SCOPE/],['member_published',true,/OFFLINE_SNAPSHOT_SCOPE/],['publication_ready',true,/OFFLINE_SNAPSHOT_SCOPE/],['author_ref',' ',/OFFLINE_SNAPSHOT_SCOPE/],['cutoff',null,/OFFLINE_SNAPSHOT_TIME/],['prepared_at','now',/OFFLINE_SNAPSHOT_TIME/],['expires_at',new Date(now+80*3600000).toISOString(),/OFFLINE_SNAPSHOT_BATCH_TIME/]]){
  const bad=structuredClone(body);bad[field]=value;await rejects(()=>stageBody(bad),re,field);
 }
 let bad=structuredClone(body);bad.cards.pop();await rejects(()=>stageBody(bad),/OFFLINE_SNAPSHOT_SCOPE/);
 for(const [field,value,re]of[['cards',null,/OFFLINE_SNAPSHOT_SCOPE/],['packet_hashes',null,/OFFLINE_SNAPSHOT_SCOPE/],['numeric_assertions',null,/OFFLINE_SNAPSHOT_SCOPE/],['reference_jobs',null,/OFFLINE_SNAPSHOT_SCOPE/],['author_ref',null,/OFFLINE_SNAPSHOT_SCOPE/],['prepared_at',null,/OFFLINE_SNAPSHOT_TIME/]]){
  const malformed=structuredClone(body);malformed[field]=value;await rejects(()=>stageBody(malformed),re,'Required null field '+field);
 }
 bad=structuredClone(body);bad.receipt={response_id:'fabricated'};await rejects(()=>stageBody(bad),/OFFLINE_SNAPSHOT_SCOPE/);
 bad=structuredClone(body);bad.cards[1]=structuredClone(bad.cards[0]);await rejects(()=>stageBody(bad),/OFFLINE_CARD_SCOPE/);
 bad=structuredClone(body);bad.packet_hashes['1000']='f'.repeat(64);await rejects(()=>stageBody(bad),/OFFLINE_SNAPSHOT_BATCH_TIME/);
 bad=structuredClone(body);bad.cards[0].sources[0].available_at=new Date(now+3600000).toISOString();await rejects(()=>stageBody(bad),/OFFLINE_SOURCE/);
 bad=structuredClone(body);bad.cards[0].sources[0].content='RAW_SECRET';await rejects(()=>stageBody(bad),/OFFLINE_SOURCE/);
 bad=structuredClone(body);bad.cards[0].sources.push(structuredClone(bad.cards[0].sources[0]));await rejects(()=>stageBody(bad),/OFFLINE_CARD_BINDING/);
 bad=structuredClone(body);bad.cards[0].gaps=[];await rejects(()=>stageBody(bad),/OFFLINE_CARD_BINDING/);
 bad=structuredClone(body);bad.cards[0].confirmation='站上123元';await rejects(()=>stageBody(bad),/OFFLINE_CONDITION/);
 bad=structuredClone(body);bad.cards[0].confirmation='守住三十';await rejects(()=>stageBody(bad),/OFFLINE_CONDITION/);
 bad=structuredClone(body);bad.cards[0].symbol=1000;await rejects(()=>stageBody(bad),/OFFLINE_CARD_SCOPE/);
 bad=structuredClone(body);bad.cards[0].reason.evidence_ids=['1001:FINANCIAL:one'];await rejects(()=>stageBody(bad),/OFFLINE_CLAIM/);
 bad=structuredClone(body);bad.reference_jobs=['f'.repeat(64)];await rejects(()=>stageBody(bad),/OFFLINE_REFERENCE_JOBS/);
 bad=structuredClone(body);bad.numeric_assertions[0].right.literal=1.9;await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_ASSERTION_FALSE/);
 bad=structuredClone(body);bad.numeric_assertions[0].claim_hash='f'.repeat(64);await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_CLAIM/);
 bad=structuredClone(body);bad.numeric_assertions[0].left.value_path=['__proto__','eps'];await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_PATH/);
 bad=structuredClone(body);bad.numeric_assertions[0].left.period='2026-Q2';await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_PERIOD/);
 bad=structuredClone(body);bad.numeric_assertions[0].left.unit='USD_PER_SHARE';await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_UNIT/);
 bad=structuredClone(body);bad.numeric_assertions[0].left.evidence_id='1001:FINANCIAL:one';await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_SOURCE/);
 bad=structuredClone(body);bad.numeric_assertions[0].symbol=1000;await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_SCOPE/);
 bad=structuredClone(body);bad.numeric_assertions.push(structuredClone(bad.numeric_assertions[0]));await rejects(()=>stageBody(bad),/OFFLINE_SNAPSHOT_SCOPE/);
 bad=structuredClone(body);bad.cards[0].reason.text+=' 同文再列1.32。';bad.numeric_assertions[0].claim_hash=await snapshotHash(bad.cards[0].reason);await rejects(()=>stageBody(bad),/OFFLINE_NUMERIC_CLAIM/);
 const permuted=structuredClone(body);permuted.cards.reverse();equal((await stageBody(permuted)).cards,216,'A permutation retains exactly the same complete universe and citation bindings');
 const nativePrice=structuredClone(body);nativePrice.cards[0].reason={text:through+'收盤為123元，僅供收到後研究。',evidence_ids:['1000:PRICE:one']};
 nativePrice.cards[0].sources=[projection(fresh.packets[0].evidence[1])];nativePrice.numeric_assertions=[{symbol:'1000',horizon:'SHORT',claim_path:'reason',claim_hash:await snapshotHash(nativePrice.cards[0].reason),text_fragment:'123',operator:'EQ',left:{evidence_id:'1000:PRICE:one',value_path:['close'],period_path:['date'],period:through,unit_path:null,unit:null},right:{literal:123},expected:true}];
 const nativeValidation=await validateReviewedAnalysisSnapshot(fresh.batchText,nativePrice);equal(nativeValidation.numeric_review_required,true,'Unstated source price units stay subject to independent review');
 equal((await stageBody(nativePrice)).independent_review_required,true);
 const escaped=structuredClone(body);escaped.cards[0].reason.text='2026-Q3原報EPS為1.32元。\n"引號"及反斜線\\與斜線/保留。';escaped.numeric_assertions[0].claim_hash=await snapshotHash(escaped.cards[0].reason);
 equal((await stageBody(escaped)).cards,216,'JS and PostgreSQL claim commitment agrees for exact escaped Unicode text');
 const badTimeBatch=structuredClone(fresh.batch),badPacket=JSON.parse(badTimeBatch.packet_texts['1000']);badPacket.evidence[0].available_at=newCutoff.replace(/\.\d{3}Z$/,'.999999Z');
 if(Date.parse(badPacket.evidence[0].available_at)<=Date.parse(newCutoff))badPacket.evidence[0].available_at=new Date(Date.parse(newCutoff)+1).toISOString();
 badTimeBatch.packet_texts['1000']=canonical(badPacket);badTimeBatch.packet_hashes['1000']=sha(badTimeBatch.packet_texts['1000']);
 await rejects(()=>q('select public.store_daily_stock_ai_batch_v1($1,$2)',[canonical(badTimeBatch),sha(canonical(badTimeBatch))]),/AI_INPUT_EVIDENCE/,'The original batch store rejects after-cutoff source times before snapshot import');
 await db.exec('begin');const stagedSnapshot=await stageBody(body);const atomicEdition=await stageEdition(stagedSnapshot.snapshot_hash);await db.exec('commit');
 equal(atomicEdition.model_jobs,0,'Snapshot and edition can be staged atomically without reversing receipt/edition chronology');
 equal(stagedSnapshot.model_generated,false);equal(stagedSnapshot.model_calls,0);equal(stagedSnapshot.member_published,false);equal(stagedSnapshot.independent_review_required,true);
 equal((await stageBody(body)).snapshot_hash,stagedSnapshot.snapshot_hash);await rejects(()=>stageBody(body,'b'.repeat(64)),/OFFLINE_SNAPSHOT_REPLAY_CONFLICT/);
 await rejects(()=>stageEdition(stagedSnapshot.snapshot_hash,new Date(now+80*3600000).toISOString()),/OFFLINE_EDITION_EXPIRY/);
 const staged=await stageEdition(stagedSnapshot.snapshot_hash);equal(staged.model_jobs,0);equal(staged.cards,216);equal(staged.reviews_copied,false);equal(staged.member_published,false);
 await role(null);const offline=(await q('select * from vnext_private.ai_research_editions where id=$1',[staged.edition_id]))[0];
 equal(offline.job_keys,[]);equal(offline.job_set_hash,sha(''));equal(offline.reviewed_snapshot_hash,stagedSnapshot.snapshot_hash);equal(offline.payload.analysis_origin,'OFFLINE_REVIEWED');
 equal(offline.payload.model_generated,false);equal(offline.cutoff,new Date(newCutoff));
 equal((await q('select vnext_private.ai_edition_integrity_v1($1) valid',[staged.edition_id]))[0].valid,true);
 equal((await q("select encode(sha256(convert_to(string_agg(id||':'||result::text,',' order by id),'UTF8')),'hex') hash from vnext_runtime.ai_stock_jobs"))[0].hash,oldJobHash);
 equal((await q('select count(*)::integer n from vnext_runtime.ai_stock_jobs'))[0].n,72,'Offline analysis creates zero new model jobs');
 equal((await q('select count(*)::integer n from vnext_private.ai_research_reviews where edition_id=$1',[staged.edition_id]))[0].n,0);
 equal((await q('select count(*)::integer n from vnext_private.ai_research_publication_events where edition_id=$1',[staged.edition_id]))[0].n,0);
 await rejects(()=>q('update vnext_private.reviewed_analysis_snapshots_v1 set author_ref=$1',['forged']),/IMMUTABLE/);
 await rejects(()=>q('delete from vnext_private.reviewed_analysis_snapshots_v1'),/IMMUTABLE/);
 await rejects(()=>q('update vnext_private.ai_research_editions set expires_at=now() where id=$1',[staged.edition_id]),/IMMUTABLE/);
 await identity('owner');const preview=(await q('select public.get_daily_ai_owner_research_v1($1) result',[staged.edition_id]))[0].result;
 equal(preview.edition.jobs,0);equal(preview.edition.analysis_origin,'OFFLINE_REVIEWED');equal(preview.cards.length,216);equal(preview.integrity_ready,true);equal(preview.publish_ready,false);
 await identity('premium');equal((await q('select public.get_daily_ai_member_research_v1() result'))[0].result.cards.length,0);
 const review=async(ref,quality='PASS',time='PASS')=>(await q(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,quality,time_status,licensing,
  quality_document_hash,time_document_hash,license_document_hash,reason,expires_at) values($1,$1,$2,$3,$4,'PASS',$5,$5,$5,'Synthetic offline full analysis review; not real member content',$6) returning id`,[staged.edition_id,ref,quality,time,doc,expires]))[0].id;
 await role('service_role');await rejects(()=>review(body.author_ref),/OFFLINE_AUTHOR_CANNOT_SELF_REVIEW/);
 const failed=await review('independent-synthetic-reviewer','FAIL');
 const approve=async(id,key)=>(await q('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5) result',[staged.edition_id,id,'APPROVE','premium',key]))[0].result;
 await identity('owner');await rejects(()=>approve(failed,'00000000-0000-0000-0000-000000000010'),/AI_EDITION_PREREQUISITES/);
 await role('service_role');const wrongTime=await review('independent-synthetic-reviewer','PASS','FAIL');await identity('owner');await rejects(()=>approve(wrongTime,'00000000-0000-0000-0000-000000000011'),/AI_EDITION_PREREQUISITES/);
 await role('service_role');const passed=await review('independent-synthetic-reviewer');await identity('owner');await rejects(()=>approve(passed,'00000000-0000-0000-0000-000000000012'),/AI_EDITION_PREREQUISITES/,'Source-use/rights gate still required');
 await role(null);for(const [i,url]of['https://www.twse.com.tw/synthetic-financial','https://www.twse.com.tw/synthetic-price'].entries())await q("insert into vnext_private.source_licenses values($1,$2,'https://data.gov.tw/license',now(),now()+interval '2 hours',true,true,true,false,'Synthetic attribution')",['license'+i,url]);
 await identity('premium');await rejects(()=>approve(passed,'00000000-0000-0000-0000-000000000012'),/OWNER_REQUIRED/);
 await identity('owner');equal((await approve(passed,'00000000-0000-0000-0000-000000000012')).action,'APPROVE');
 await identity('premium');const member=(await q('select public.get_daily_ai_member_research_v1() result'))[0].result;
 equal(member.cards.length,216);equal(member.edition.analysis_origin,'OFFLINE_REVIEWED');equal(member.edition.id,staged.edition_id);equal(parseDailyAiMember(member).cards.length,216);
 equal(JSON.stringify(member).includes('original_response_id'),false);equal(JSON.stringify(member).includes('packet_texts'),false);
 await identity('free');equal((await q('select public.get_daily_ai_member_research_v1() result'))[0].result.cards.length,0,'Premium-only approval never opens Free access');
 const useReview=async(author,quality,documents='UNVERIFIED',mapping='INCOMPLETE')=>q(`insert into vnext_private.ai_research_use_reviews(edition_id,snapshot_hash,use_scope,raw_redistribution,basis,quality,reviewer_ref,
  review_document_hash,source_mapping_document_hash,terms_document_hash,official_document_urls,documents_status,mapping_status,reason,reviewed_at,expires_at)
  values($1,$1,'OWN_ANALYSIS_ONLY',false,'OPEN_LICENSE',$2,$3,$4,$4,$4,array['https://data.gov.tw/license','https://data.gov.tw/dataset/11549'],$5,$6,
  'Synthetic isolated source-use assessment; no real source permissions are created here.',clock_timestamp(),$7)`,[staged.edition_id,quality,author,doc,documents,mapping,expires]);
 await role('service_role');await rejects(()=>useReview(body.author_ref,'PENDING'),/OFFLINE_AUTHOR_CANNOT_SELF_REVIEW/);
 await useReview('independent-source-reviewer','PENDING');await identity('premium');equal((await q('select public.get_daily_ai_member_research_v1() result'))[0].result.cards.length,0,'Later PENDING source-use denies access despite old license grants');
 await role('service_role');await useReview('independent-source-reviewer','PASS','VERIFIED','ALL_INPUTS_REVIEWED');await identity('premium');equal((await q('select public.get_daily_ai_member_research_v1() result'))[0].result.cards.length,216);
 await role('service_role');await review('independent-synthetic-reviewer','FAIL');await identity('premium');equal((await q('select public.get_daily_ai_member_research_v1() result'))[0].result.cards.length,0,'Later FAIL full quality review withdraws access');
 await role(null);equal((await q('select vnext_private.ai_edition_integrity_v1($1) valid',[oldEdition]))[0].valid,true,'Legacy edition still verifies after offline publication tests');
 const summary={schema:'OFFLINE_REVIEWED_SNAPSHOT_SQL_TEST_V1',status:'PASS',assertions,model_calls:0,production_writes:0,
  synthetic_only:true,offline_model_jobs_created:0,legacy_integrity_source_identical:true,frontend_compatibility_required:false,
  source_use_time_quality_owner_premium_gates_preserved:true,authorizes_real_publication:false};
 console.log(JSON.stringify(summary));
}catch(error){console.error({message:error.message,code:error.code,where:error.where,actual:error.actual?.message??error.actual,expected:String(error.expected??'')});process.exitCode=1;}finally{await db.close();}
