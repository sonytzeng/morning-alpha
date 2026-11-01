// Disposable PostgreSQL fixture only. Every identity, source, price, model
// response, review and permission in this helper is synthetic. No network,
// production credentials, provider calls or externally valid approval exists.
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {canonical} from '../../research/entry-opportunity.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';

export const PRICE_PLAN_FIXTURE_OWNER='00000000-0000-0000-0000-000000000001';
export const PRICE_PLAN_FIXTURE_MEMBER='00000000-0000-0000-0000-000000000002';
const PRICE_SOURCE='https://www.twse.com.tw/synthetic-price-plan-fixture';
const NEWS_SOURCE='https://www.twse.com.tw/synthetic-price-plan-event-fixture';

/** Uses the actual batch/job/member/use-review SQL. The returned edition has
 * an independent synthetic review and source grants but remains unapproved
 * until the caller explicitly selects Owner identity and approves it. */
export async function createPricePlanFixture(){
 if(!process.env.MA_PGLITE_MODULE)throw Error('MA_PGLITE_MODULE_REQUIRED_FOR_ISOLATED_TEST');
 const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();
 await db.waitReady;
 const OWNER=PRICE_PLAN_FIXTURE_OWNER,MEMBER=PRICE_PLAN_FIXTURE_MEMBER;
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   insert into auth.users values('${OWNER}'),('${MEMBER}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create schema academy_private;
   create function academy_private.access_v11() returns text language sql stable as $$select nullif(current_setting('test.tier',true),'')$$;
   create function public.is_research_owner_v1() returns boolean language sql stable as $$select auth.uid()='${OWNER}'::uuid and current_setting('test.tier',true)='owner'$$;
   create schema vnext_private;
   create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
   create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,
    storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);
   create schema vnext_runtime;
   create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;`);
  for(const source of ['daily-ai-jobs','daily-ai-batches','daily-ai-member','daily-ai-use-review'])
   await db.exec(readFileSync(new URL('../../research/'+source+'.candidate.sql',import.meta.url),'utf8'));

  const startedAt=Date.now(),cutoff=new Date(startedAt-30*60000).toISOString();
  const expiry=new Date(startedAt+2*3600000).toISOString();
  const localDay=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
  const through=Date.parse(localDay+'T13:30:00+08:00')<=Date.parse(cutoff)?localDay:
   new Date(Date.parse(localDay+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const availableAt=new Date(Date.parse(cutoff)-60000).toISOString();
  const publishedAt=new Date(Date.parse(cutoff)-120000).toISOString();
  const packetTexts={},packetHashes={},packets=[],jobs=[];
  const sourceIds=symbol=>{
   const index=Number(symbol)-1000;
   if(!Number.isInteger(index)||index<0||index>=72)throw Error('SYNTHETIC_FIXTURE_SYMBOL');
   return {price:'P'+index,event:'N'+index,uncitedPrice:'U'+index};
  };
  for(let i=0;i<72;i++){
   const symbol=String(1000+i),ids=sourceIds(symbol);
   const packet={symbol,company:'Synthetic isolated issuer '+i,cutoff,data_through:through,data_gaps:['SYNTHETIC_PRICE_PLAN_FIXTURE_ONLY'],evidence:[
    {id:ids.price,symbol,kind:'PRICE',source:PRICE_SOURCE,published_at:publishedAt,available_at:availableAt,
     first_seen_at:availableAt,as_of:through+'T13:30:00+08:00',evidence_hash:'b'.repeat(64),
     content:'SYNTHETIC_ONLY: open=100, high=105, low=95, close=101, volume=1000000; no real security or trading conclusion.'},
    {id:ids.event,symbol,kind:'NEWS',source:NEWS_SOURCE,published_at:publishedAt,available_at:availableAt,
     first_seen_at:availableAt,as_of:publishedAt,evidence_hash:'c'.repeat(64),
     content:'SYNTHETIC_ONLY: an issuer event remains subject to independent review; no actual event is asserted.'},
    // Retained input available to an independent plan review, intentionally
    // omitted from every model reason/counter so it is not a card source.
    {id:ids.uncitedPrice,symbol,kind:'PRICE',source:PRICE_SOURCE,published_at:publishedAt,available_at:availableAt,
     first_seen_at:availableAt,as_of:through+'T13:30:00+08:00',evidence_hash:'a'.repeat(64),
     content:'SYNTHETIC_ONLY: an uncited retained price observation with close=99; no real security or trading conclusion.'},
   ]};
   packets.push(packet);packetTexts[symbol]=canonical(packet);packetHashes[symbol]=await snapshotHash(packet);
   const revision='synthetic-price-plan-fixture-model-v1';
   const jobIdentity={version:'DAILY_AI_BATCH_1',input_hash:packetHashes[symbol],model_revision:revision};
   const id=await snapshotHash(jobIdentity);jobs.push(id);
   const result={schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol,cutoff,input_hash:packetHashes[symbol],model_generated:true,
    member_published:false,publication_ready:false,receipt:{response_id:'synthetic-plan-'+i,model:'synthetic-isolated-model'},
    sources:packet.evidence.map(({content,...source})=>source),
    horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',
     reason:{text:'Synthetic isolated research fixture; no real stock conclusion.',evidence_ids:[ids.price]},
     counter_evidence:[{text:'Synthetic event condition requires independent review.',evidence_ids:[ids.event]}],
     confirmation:'Wait for verified new evidence.',invalidation:'Cancel if independently verified evidence changes.',gaps:[]}))};
   // Fixture insertion creates synthetic COMPLETE rows before any immutable seal
   // is exercised. Actual batch commitment/staging still validate all hashes.
   await db.query(`insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result)
    values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$6)`,
    [id,packetHashes[symbol],revision,symbol,cutoff,result]);
  }
  const body={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through,packet_texts:packetTexts,packet_hashes:packetHashes,gaps:[]};
  const batchId=await snapshotHash(body);
  await db.exec('set role service_role');
  await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[canonical(body),batchId]);
  const staged=(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) result',[batchId,jobs,expiry])).rows[0].result;
  const editionId=staged.edition_id;
  await db.exec('reset role');
  for(const [i,source] of [PRICE_SOURCE,NEWS_SOURCE].entries())
   await db.query(`insert into vnext_private.source_licenses values($1,$2,'https://data.gov.tw/license',now(),$3,true,true,true,false,'Synthetic disposable-fixture attribution')`,
    ['synthetic-plan-grant-'+i,source,expiry]);

  const identity=async(tier,uid=tier==='owner'?OWNER:MEMBER)=>{
   await db.exec('reset role');
   await db.query("select set_config('test.uid',$1,false),set_config('test.tier',$2,false)",[uid??'',tier??'']);
   await db.exec('set role authenticated');
  };
  const readMember=async()=>(await db.query('select public.get_daily_ai_member_research_v1() result')).rows[0].result;
  const readOwner=async()=>(await db.query('select public.get_daily_ai_owner_research_v1($1) result',[editionId])).rows[0].result;
  let editionReviewId;
  const insertEditionReview=async(overrides={})=>{
   const r={edition_id:editionId,snapshot_hash:editionId,reviewer_ref:'independent-synthetic-plan-fixture-reviewer',
    quality:'PASS',time_status:'PASS',licensing:'PASS',quality_document_hash:'d'.repeat(64),time_document_hash:'e'.repeat(64),
    license_document_hash:'f'.repeat(64),reason:'Synthetic independent fixture review only; not production authorization.',expires_at:expiry,...overrides};
   await db.exec('reset role;set role service_role');
   editionReviewId=(await db.query(`insert into vnext_private.ai_research_reviews(edition_id,snapshot_hash,reviewer_ref,quality,time_status,licensing,
    quality_document_hash,time_document_hash,license_document_hash,reason,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [r.edition_id,r.snapshot_hash,r.reviewer_ref,r.quality,r.time_status,r.licensing,r.quality_document_hash,r.time_document_hash,r.license_document_hash,r.reason,r.expires_at])).rows[0].id;
   return editionReviewId;
  };
  await insertEditionReview();
  const approveEdition=async(audience='premium',action='APPROVE',requestKey=randomUUID())=>
   (await db.query('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5) result',
    [editionId,editionReviewId,action,audience,requestKey])).rows[0].result;
  await identity('premium');
  return {db,OWNER,MEMBER,editionId,batchId,cutoff,expiry,through,packets,jobs,sourceIds,identity,readMember,readOwner,
   approveEdition,insertEditionReview,get editionReviewId(){return editionReviewId;},
   close:()=>db.close()};
 }catch(error){await db.close();throw error;}
}
