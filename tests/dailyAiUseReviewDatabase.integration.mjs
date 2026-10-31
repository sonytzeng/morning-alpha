// Disposable PostgreSQL only. Every identity, review, permission and model body
// in this file is a synthetic test fixture, never a production authorization.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
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
 for(const source of ['daily-ai-jobs','daily-ai-batches','daily-ai-member','daily-ai-use-review'])
  await db.exec(readFileSync(new URL('../research/'+source+'.candidate.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select count(*)::int n from vnext_private.ai_research_use_reviews')).rows[0].n,0,'migration manufactures no actual reviews');
 const cutoff='2026-10-30T12:00:00Z',expiry=new Date(Date.now()+2*3600000).toISOString(),packetTexts={},packetHashes={},jobs=[];
 for(let i=0;i<72;i++){
  const symbol=String(1000+i),packet={symbol,company:'隔離測試公司'+i,cutoff,data_through:'2026-10-30',evidence:[{
   id:'N'+i,symbol,kind:'FINANCIAL',source:'https://www.twse.com.tw/test-financial-facts',published_at:'2026-10-30T10:00:00Z',
   available_at:'2026-10-30T11:00:00Z',content:'SYNTHETIC_PRIVATE_NUMERIC_FACTS'}]};
  packetTexts[symbol]=canonical(packet);packetHashes[symbol]=await snapshotHash(packet);
  const id=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:packetHashes[symbol],model_revision:'test-model-revision'});jobs.push(id);
  const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol,cutoff,input_hash:packetHashes[symbol],model_generated:true,member_published:false,publication_ready:false,
   receipt:{response_id:'synthetic-'+i,model:'test-model'},sources:packet.evidence.map(({content,...source})=>source),
   horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'隔離測試自有分析，沒有真實研究結論',evidence_ids:['N'+i]},
    counter_evidence:[],confirmation:'等待實際查核',invalidation:'新證據推翻時停止觀察',gaps:[]}))};
  await db.query("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,'test-model-revision',$3,$4,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$5)",[id,packetHashes[symbol],symbol,cutoff,result]);
 }
 const body={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through:'2026-10-30',packet_texts:packetTexts,packet_hashes:packetHashes,gaps:[]},bid=await snapshotHash(body);
 await db.exec('set role service_role');await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[canonical(body),bid]);
 const eid=(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) r',[bid,jobs,expiry])).rows[0].r.edition_id;
 const rights=async at=>(await db.query('select vnext_private.ai_edition_rights_v1($1,$2) r',[eid,at??new Date().toISOString()])).rows[0].r;
 const read=async()=>(await db.query('select public.get_daily_ai_member_research_v1() r')).rows[0].r;
 const identity=async tier=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.tier',$2,false)",[OWNER,tier]);await db.exec('set role authenticated');};
 const insertUse=async(overrides={})=>{
  const r={snapshot_hash:eid,use_scope:'OWN_ANALYSIS_ONLY',raw_redistribution:false,basis:'FACT_ONLY_OWN_ANALYSIS',quality:'PASS',reviewer_ref:'independent-use-test-reviewer',
   review_document_hash:'a'.repeat(64),source_mapping_document_hash:'b'.repeat(64),terms_document_hash:'c'.repeat(64),
   official_document_urls:['https://www.tipo.gov.tw/tw/copyright/692-16653.html'],documents_status:'VERIFIED',mapping_status:'ALL_INPUTS_REVIEWED',
   reason:'Synthetic isolated fixture: reviewed only numeric facts and original analysis, with no copying of article expression or original datasets.',
   reviewed_at:new Date(Date.now()-1000).toISOString(),expires_at:expiry,...overrides};
  return (await db.query(`insert into vnext_private.ai_research_use_reviews(edition_id,snapshot_hash,use_scope,raw_redistribution,basis,quality,reviewer_ref,
   review_document_hash,source_mapping_document_hash,terms_document_hash,official_document_urls,reason,reviewed_at,expires_at,documents_status,mapping_status,documents_ready)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true) returning id,recorded_at,documents_ready`,
   [eid,r.snapshot_hash,r.use_scope,r.raw_redistribution,r.basis,r.quality,r.reviewer_ref,r.review_document_hash,r.source_mapping_document_hash,r.terms_document_hash,
    r.official_document_urls,r.reason,r.reviewed_at,r.expires_at,r.documents_status,r.mapping_status])).rows[0];
 };
 await db.exec('reset role');assert.equal(await rights(),false);
 await db.query("insert into vnext_private.source_licenses values('original-route','https://www.twse.com.tw/test-financial-facts','https://data.gov.tw/license',now(),now()+interval '3 hours',true,true,true,false,'Synthetic original-route grant')");
 assert.equal(await rights(),true,'original all-source route remains valid when no use assessment exists');
 await db.query("delete from vnext_private.source_licenses where id='original-route'");assert.equal(await rights(),false);
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>insertUse(),/permission denied/);
  await assert.rejects(()=>db.query('select * from vnext_private.ai_research_use_reviews'),/permission denied/);
  await assert.rejects(()=>rights(),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');
 for(const overrides of [{snapshot_hash:'f'.repeat(64)},{use_scope:'RAW_REPUBLICATION'},{raw_redistribution:true},
  {reviewer_ref:'test-model'},{reviewer_ref:'test-model-revision'},{reviewed_at:'2099-01-01T00:00:00Z'},
  {expires_at:new Date(Date.now()+3*3600000).toISOString()}])await assert.rejects(()=>insertUse(overrides),/AI_USE_REVIEW_INVALID/);
 for(const overrides of [{basis:'UNKNOWN'},{documents_status:'UNVERIFIED'},{mapping_status:'INCOMPLETE'},{official_document_urls:['https://example.test/fake-law']},
  {official_document_urls:['https://www.tipo.gov.tw.evil.test/tw/copyright/692-16653.html']},
  {official_document_urls:['https://www.tipo.gov.tw/unknown']},
  {basis:'OPEN_LICENSE',official_document_urls:['https://data.gov.tw/license']},
  {basis:'EXPLICIT_PERMISSION',official_document_urls:['https://www.mediatek.com/terms-of-use']},
  {official_document_urls:['https://www.tipo.gov.tw/tw/copyright/692-16653.html?token=private']},
  {official_document_urls:['https://www.tipo.gov.tw/tw/copyright/692-16653.html','https://www.tipo.gov.tw/tw/copyright/692-16653.html']}])
  await assert.rejects(()=>insertUse(overrides),/AI_USE_REVIEW_DOCUMENTS/);
 await assert.rejects(()=>insertUse({review_document_hash:'not-a-hash'}),/check constraint/);
 const first=await insertUse();assert.equal(first.documents_ready,true);
 await db.exec('reset role');assert.equal(await rights(),true);
 await identity('premium');assert.equal((await read()).cards.length,0,'use review alone never publishes a member edition');
 await identity('owner');const ownerBefore=(await db.query('select public.get_daily_ai_owner_research_v1($1) r',[eid])).rows[0].r;
 assert.equal(ownerBefore.rights_ready,true);assert.equal(ownerBefore.review_ready,false);assert.equal(ownerBefore.publish_ready,false);
 await db.exec('reset role;set role service_role');
 const doc='d'.repeat(64);const independent=(await db.query(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,quality,time_status,licensing,
  quality_document_hash,time_document_hash,license_document_hash,reason,expires_at) values($1,$1,'separate-test-quality-reviewer','PASS','PASS','PASS',$2,$2,$2,'Synthetic independent quality/time/use review required',$3) returning id`,[eid,doc,expiry])).rows[0].id;
 const approve=async key=>db.query('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5)',[eid,independent,'APPROVE','premium',key]);
 await identity('premium');await assert.rejects(()=>approve('00000000-0000-0000-0000-000000000011'),/OWNER_REQUIRED/);
 await identity('owner');await approve('00000000-0000-0000-0000-000000000012');await identity('premium');assert.equal((await read()).cards.length,216);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from vnext_private.source_licenses')).rows[0].n,0,'use-specific review is not a fabricated source license');
 assert.equal(await rights(new Date(Date.now()+2.5*3600000).toISOString()),false,'expired review/edition cannot authorize use');
 await db.exec('set role service_role');await insertUse({quality:'FAIL'});await identity('premium');assert.equal((await read()).cards.length,0,'latest FAIL withdraws access immediately');
 await db.exec('reset role');await db.query("insert into vnext_private.source_licenses values('test-grant','https://www.twse.com.tw/test-financial-facts','https://data.gov.tw/license',now(),now()+interval '3 hours',true,true,true,false,'Synthetic test grant')");
 assert.equal(await rights(),false,'a source grant cannot silently revive an edition with latest failed actual-use review');
 await db.exec('set role service_role');await insertUse({quality:'PENDING',official_document_urls:['https://example.test/pending-review']});
 const pending=(await db.query('select documents_ready from vnext_private.ai_research_use_reviews order by recorded_at desc,id desc limit 1')).rows[0];assert.equal(pending.documents_ready,false,'caller cannot forge document readiness');
 await db.exec('reset role');assert.equal(await rights(),false);await identity('premium');assert.equal((await read()).cards.length,0);
 await db.exec('reset role;set role service_role');await insertUse({basis:'OPEN_LICENSE',official_document_urls:['https://data.gov.tw/license','https://data.gov.tw/dataset/11549']});
 await db.exec('reset role');assert.equal(await rights(),true,'documented open-license use review is another supported review basis');
 await identity('premium');assert.equal((await read()).cards.length,216,'existing independent review and Owner approval remain required');
 await db.exec('reset role;set role service_role');await insertUse({basis:'EXPLICIT_PERMISSION',official_document_urls:['https://www.twse.com.tw/zh/terms/use.html']});
 await db.exec('reset role');assert.equal(await rights(),true,'synthetic permission fixture must be tied to an actual source publisher family');
 await assert.rejects(()=>db.query('update vnext_private.ai_research_use_reviews set quality=$1 where id=$2',['PASS',first.id]),/IMMUTABLE/);
 await assert.rejects(()=>db.query('delete from vnext_private.ai_research_use_reviews where id=$1',[first.id]),/IMMUTABLE/);
 await identity('premium');const projection=await read();assert(!JSON.stringify(projection).includes('document_hash'));assert(!JSON.stringify(projection).includes('reviewer_ref'));
 assert(!JSON.stringify(projection).includes('SYNTHETIC_PRIVATE_NUMERIC_FACTS'));
 // The new assessment replaces only the AS_OF helper, not legacy forward APIs.
 await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from pg_proc where pronamespace='vnext_private'::regnamespace and proname='ai_edition_rights_v1'")).rows[0].n,1);
 for(const [source,document] of [['https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC','https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html'],['https://openapi.taifex.com.tw/v1/DailyMarketReportFut','https://www.taifex.com.tw/cht/11/copyright']]){
  assert.equal((await db.query('select vnext_private.ai_use_primary_documents_v1($1,$2,$3) ok',['EXPLICIT_PERMISSION',[document],[source]])).rows[0].ok,true,'current market publisher family can be documented; this is not an automatic permission grant');
 }
 console.log('PASS: immutable edition-bound actual-use reviews, no manufactured grants, source mapping/document hashes, primary-document scope, latest FAIL/PENDING/expiry denial, model self-review rejection, Owner and independent review gates, member projection isolation. Synthetic disposable database only.');
}catch(error){console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;}finally{await db.close();}
