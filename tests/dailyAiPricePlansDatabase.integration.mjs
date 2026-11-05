// Disposable PostgreSQL only. All prices, identities, reviews and grants are
// synthetic. This exercises the real member Reader and the new sidecar SQL;
// it never calls a model, uses a production credential or publishes real data.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {parseDailyAiMember} from '../src/features/vnext/dailyAiMember.ts';
import {parseDailyAiMemberPricePlans} from '../src/features/vnext/dailyAiPricePlan.ts';
import {createPricePlanFixture} from './helpers/dailyAiPricePlansFixture.mjs';

const f=await createPricePlanFixture(),{db}=f;
let checks=0;
const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const clock=async()=>(await db.query(`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`)).rows[0].at;
const role=async name=>db.exec('reset role;set role '+name);
const canonicalBody=body=>JSON.stringify(Object.fromEntries(Object.keys(body).sort().map(k=>[k,body[k]])));
const body=async(symbol='1000',horizon='SHORT',overrides={})=>({
 schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:f.editionId,symbol,horizon,status:'VERIFIED',currency:'TWD',
 method:'SYNTHETIC_CONDITIONAL_METHOD_NOT_PRODUCTION',basis:'Synthetic isolated method basis, never a real trading instruction.',
 entry_range:[100,105],wait_above:105,stop_kind:'PRICE',stop:95,stop_evidence_ids:[f.sourceIds(symbol).price],
 invalidation:'Synthetic plan is cancelled if the independently reviewed supporting evidence changes.',
 evidence_ids:[f.sourceIds(symbol).price,f.sourceIds(symbol).event],as_of:await clock(),expires_at:f.expiry,buy_ready:false,...overrides,
});
const stage=async value=>{
 await role('service_role');const text=canonicalBody(value),hash=await snapshotHash(value);
 equal(createHash('sha256').update(text).digest('hex'),hash,'Importer uses the exact JavaScript canonical preimage.');
 const result=(await db.query('select public.stage_daily_ai_price_plan_v1($1,$2) r',[text,hash])).rows[0].r;
 equal(result.member_published,false);return {hash,value};
};
const review=async(plan,overrides={})=>{
 await role('service_role');
 const r={reviewer_ref:'separate-synthetic-price-plan-reviewer',quality:'PASS',time_status:'PASS',source_use:'PASS',methodology:'PASS',
  document_hash:'a'.repeat(64),source_document_hash:'b'.repeat(64),method_document_hash:'c'.repeat(64),time_document_hash:'d'.repeat(64),
  reason:'Independent synthetic quality, source-use, time and method review for an isolated test fixture.',
  reviewed_at:await clock(),expires_at:plan.value.expires_at,...overrides};
 const result=await db.query(`insert into vnext_private.ai_price_plan_reviews_v1(plan_hash,reviewer_ref,quality,time_status,source_use,methodology,
  document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
  values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
  [plan.hash,r.reviewer_ref,r.quality,r.time_status,r.source_use,r.methodology,r.document_hash,r.source_document_hash,r.method_document_hash,r.time_document_hash,r.reason,r.reviewed_at,r.expires_at]);
 return result.rows[0].id;
};
const approve=async(plan,rid,action='APPROVE',key=randomUUID())=>(await db.query('select public.review_daily_ai_price_plan_v1($1,$2,$3,$4) r',[plan.hash,rid,action,key])).rows[0].r;
const read=async(edition=f.editionId)=>(await db.query('select public.get_daily_ai_member_price_plans_v1($1) r',[edition])).rows[0].r;
const preview=async(edition=f.editionId)=>(await db.query('select public.get_daily_ai_owner_price_plans_v1($1) r',[edition])).rows[0].r;
try{
 await role('service_role');await db.exec('reset role');
 await db.exec(readFileSync(new URL('../research/daily-ai-price-plans.candidate.sql',import.meta.url),'utf8'));
 equal((await db.query('select count(*)::int n from vnext_private.ai_price_plans_v1')).rows[0].n,0,'Migration creates no prices or approvals.');
 await f.identity('owner');equal((await preview()).plans,[]);equal((await preview()).preview_only,true);equal((await preview()).subject_user_id,f.OWNER);
 await rejects(()=>preview('f'.repeat(64)),/AI_PRICE_PLAN_EDITION/);
 await f.identity('premium');await rejects(()=>preview(),/OWNER_REQUIRED/);
 await f.identity('free');await rejects(()=>preview(),/OWNER_REQUIRED/);
 await f.identity('owner',f.MEMBER);await rejects(()=>preview(),/OWNER_REQUIRED/);
 await role('anon');await rejects(()=>preview(),/permission denied/);
 await role('service_role');await rejects(()=>preview(),/permission denied/);
 await f.identity('premium');equal((await read()).plans,[],'Old editions remain usable without sidecar data.');
 await role('anon');await rejects(()=>read(),/permission denied/);
 await role('service_role');await rejects(()=>read(),/permission denied/);
 await f.identity('premium',null);await rejects(()=>read(),/MEMBER_REQUIRED/);
 const first=await stage(await body());
 await f.identity('owner');let ownerView=await preview();equal(ownerView.plans[0].plan_hash,first.hash);equal(ownerView.plans[0].review,null);equal(ownerView.plans[0].can_approve,false);
 await role('authenticated');await rejects(()=>db.query('select public.stage_daily_ai_price_plan_v1($1,$2)',[canonicalBody(first.value),first.hash]),/permission denied/);
 await role('anon');await rejects(()=>db.query('select * from vnext_private.ai_price_plans_v1'),/permission denied/);
 await role('authenticated');await rejects(()=>db.query('select * from vnext_private.ai_price_plan_reviews_v1'),/permission denied/);
 await role('service_role');await rejects(()=>db.query('select public.stage_daily_ai_price_plan_v1($1,$2)',[canonicalBody(first.value),'f'.repeat(64)]),/AI_PRICE_PLAN_HASH/);
 for(const change of [
  {edition_id:'f'.repeat(64)},{symbol:'9999'},{symbol:1000},{horizon:'DAY'},{status:'PENDING'},{currency:'USD'},{buy_ready:true},
  {entry_range:[106,105]},{entry_range:[0,105]},{wait_above:104},{stop:100},{stop_kind:'EVENT',stop:null,stop_evidence_ids:['P0']},
  {stop_kind:'EVENT',stop:95,stop_evidence_ids:['N0']},{evidence_ids:['P1']},{evidence_ids:['P0','P0']},
  {stop_evidence_ids:['N0'],evidence_ids:['P0']},{as_of:'2099-01-01T00:00:00Z'},
  {as_of:new Date(Date.parse(f.cutoff)-1).toISOString()},{as_of:'2026-02-31T12:00:00Z'},
  {expires_at:'2099-01-01T00:00:00Z'},{expires_at:f.cutoff},{method:''},{basis:''},{invalidation:''},{raw_packet:'MUST_NOT_BE_EXPOSED'},
 ]){
  const invalid={...first.value,...change};await rejects(()=>stage(invalid),/AI_PRICE_PLAN_|date.time field/);
 }
 await rejects(()=>review(first,{reviewer_ref:'synthetic-isolated-model'}),/AI_PRICE_PLAN_REVIEW_INVALID/);
 await rejects(()=>review(first,{reviewed_at:'2099-01-01T00:00:00Z'}),/AI_PRICE_PLAN_REVIEW_INVALID/);
 await rejects(()=>review(first,{expires_at:new Date(Date.parse(f.expiry)-1000).toISOString()}),/AI_PRICE_PLAN_REVIEW_INVALID/);
 const rid=await review(first);
 await role('service_role');
 await rejects(()=>db.query(`insert into vnext_private.ai_price_plan_reviews_v1(review_sequence,plan_hash,reviewer_ref,quality,time_status,source_use,methodology,
  document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at) overriding system value
  select -1,plan_hash,reviewer_ref,'FAIL',time_status,source_use,methodology,document_hash,source_document_hash,method_document_hash,time_document_hash,
   'Synthetic attempt to hide a late FAIL below the latest review sequence.',reviewed_at,expires_at from vnext_private.ai_price_plan_reviews_v1 where id=$1`,[rid]),/permission denied/);
 await rejects(()=>db.query(`insert into vnext_private.ai_price_plan_reviews_v1(recorded_at,plan_hash,reviewer_ref,quality,time_status,source_use,methodology,
  document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
  select now(),plan_hash,reviewer_ref,quality,time_status,source_use,methodology,document_hash,source_document_hash,method_document_hash,time_document_hash,
   reason,reviewed_at,expires_at from vnext_private.ai_price_plan_reviews_v1 where id=$1`,[rid]),/permission denied/);
 for(const sequence of ['ai_price_plans_v1_registration_id_seq','ai_price_plan_reviews_v1_review_sequence_seq','ai_price_plan_publication_events_v1_id_seq']){
  await rejects(()=>db.query('select setval($1::regclass,1,false)',['vnext_private.'+sequence]),/permission denied/);
  await db.exec('reset role');equal((await db.query("select has_sequence_privilege('service_role',$1,'UPDATE') permitted",['vnext_private.'+sequence])).rows[0].permitted,false);
  equal((await db.query("select has_sequence_privilege('service_role',$1,'USAGE') permitted",['vnext_private.'+sequence])).rows[0].permitted,false);
  await role('service_role');
 }
 await db.exec('reset role');equal((await db.query("select has_table_privilege('service_role','vnext_private.ai_price_plan_reviews_v1','INSERT') permitted")).rows[0].permitted,false);
 await f.identity('owner');ownerView=await preview();equal(ownerView.plans[0].review.id,rid);equal(ownerView.plans[0].can_approve,true);
 await role('service_role');await rejects(()=>approve(first,rid),/permission denied/);
 await f.identity('premium');await rejects(()=>approve(first,rid),/OWNER_REQUIRED/);
 await f.identity('owner',f.MEMBER);await rejects(()=>approve(first,rid),/OWNER_REQUIRED/);
 await f.identity('owner');const key=randomUUID(),approval=await approve(first,rid,'APPROVE',key);
 equal(approval.replayed,false);equal((await approve(first,rid,'APPROVE',key)).replayed,true);
 equal((await preview()).plans[0].publication.action,'APPROVE');
 await rejects(()=>approve(first,rid,'REVOKE',key),/AI_PRICE_PLAN_REPLAY_CONFLICT/);
 await f.identity('premium');equal((await read()).plans,[],'Plan approval cannot publish an unapproved research edition.');
 await f.identity('owner');await f.approveEdition('premium');
 await f.identity('premium');let envelope=await read();equal(envelope.plans.length,1);equal(envelope.subject_user_id,f.MEMBER);
 equal(envelope.source_sets.length,1);equal(envelope.source_sets[0].sources.map(s=>s.id),['N0','P0']);
 equal((await read('f'.repeat(64))).edition_id,null);equal((await read('f'.repeat(64))).plans,[]);
 const serialized=JSON.stringify(envelope);assert(!serialized.includes('SYNTHETIC_ONLY'));assert(!serialized.includes('reviewer_ref'));checks+=2;
 let member=parseDailyAiMember(await f.readMember());let parsed=await parseDailyAiMemberPricePlans(envelope,member,Date.now()+1,f.MEMBER);
 equal(parsed.plans[0].plan_hash,first.hash);equal(parsed.plans[0].buy_ready,false);
 if(process.env.MA_PRICE_PLAN_BRIDGE_OUTPUT)writeFileSync(process.env.MA_PRICE_PLAN_BRIDGE_OUTPUT,JSON.stringify({member,envelope},null,2)+'\n');
 await f.identity('free');equal((await read()).plans,[]);equal((await read()).source_sets,[]);equal((await read()).edition_id,null,'A free user cannot learn the current Premium edition from this API.');
 await f.identity('owner');await f.approveEdition('free');await f.identity('free');equal((await f.readMember()).cards.length,9);equal((await read()).plans,[]);equal((await read()).source_sets,[]);
 await f.identity('owner');await f.approveEdition('premium');
 const failed=await review(first,{quality:'FAIL'});await f.identity('premium');equal((await read()).plans,[],'A later failed review withdraws an approved plan.');
 await f.identity('owner');ownerView=await preview();equal(ownerView.plans[0].review.id,failed);equal(ownerView.plans[0].review.quality,'FAIL');equal(ownerView.plans[0].can_approve,false);
 await f.identity('owner');await rejects(()=>approve(first,rid),/AI_PRICE_PLAN_REVIEW_CHANGED/);await rejects(()=>approve(first,failed),/AI_PRICE_PLAN_PREREQUISITES/);
 const rereview=await review(first);await f.identity('premium');equal((await read()).plans,[],'A fresh review needs its own hash-bound Owner action.');
 await f.identity('owner');await approve(first,rereview);await f.identity('premium');equal((await read()).plans.length,1);
 // New plan references U0 from the exact original packet, absent from prose
 // card.sources. The sidecar must carry reviewed source metadata for its use.
 const second=await stage(await body('1000','SHORT',{entry_range:[101,106],wait_above:106,
  evidence_ids:['U0','N0'],stop_evidence_ids:['U0']}));
 await f.identity('premium');equal((await read()).plans,[],'A newly registered version never falls back to an older approved price.');
 const secondFailed=await review(second,{methodology:'FAIL'});await f.identity('owner');await rejects(()=>approve(second,secondFailed),/AI_PRICE_PLAN_PREREQUISITES/);
 await f.identity('premium');equal((await read()).plans,[],'An unapproved newer FAIL cannot be hidden by the old approved plan.');
 const secondReview=await review(second);await f.identity('owner');await approve(second,secondReview);
 await f.identity('premium');envelope=await read();member=parseDailyAiMember(await f.readMember());
 equal(member.cards.find(c=>c.symbol==='1000'&&c.horizon==='SHORT').sources.some(s=>s.id==='U0'),false);
 equal(envelope.source_sets[0].sources.map(s=>s.id),['N0','U0']);
 parsed=await parseDailyAiMemberPricePlans(envelope,member,Date.now()+1,f.MEMBER);equal(parsed.plans[0].plan_hash,second.hash,'Actual SQL output with a legitimate uncited packet source reaches the strict TS consumer.');
 if(process.env.MA_PRICE_PLAN_BRIDGE_OUTPUT)writeFileSync(process.env.MA_PRICE_PLAN_BRIDGE_OUTPUT,JSON.stringify({member,envelope},null,2)+'\n');
 const event=await stage(await body('1000','MEDIUM',{stop_kind:'EVENT',stop:null,stop_evidence_ids:['N0']}));
 const eventReview=await review(event);await f.identity('owner');await approve(event,eventReview);
 await f.identity('premium');envelope=await read();equal(envelope.plans.length,2);equal(envelope.source_sets.length,1);
 equal(envelope.source_sets[0].sources.map(s=>s.id),['N0','P0','U0'],'Sources are merged by symbol/id across horizons, without orphan data.');
 parsed=await parseDailyAiMemberPricePlans(envelope,parseDailyAiMember(await f.readMember()),Date.now()+1,f.MEMBER);
 equal(parsed.plans.find(p=>p.horizon==='MEDIUM').stop,null);
 await f.identity('owner');await approve(second,secondReview,'REVOKE');await f.identity('premium');equal((await read()).plans.map(p=>p.horizon),['MEDIUM'],'Revocation suppresses all older SHORT plans.');
 await f.identity('owner');ownerView=await preview();equal(ownerView.plans.find(p=>p.plan_hash===second.hash).publication.action,'REVOKE');
 const expiring=await stage(await body('1001','SHORT',{expires_at:new Date(Date.now()+1800).toISOString()}));
 const expiringReview=await review(expiring);await f.identity('owner');await approve(expiring,expiringReview);
 await f.identity('premium');equal((await read()).plans.some(p=>p.symbol==='1001'),true);
 await new Promise(resolve=>setTimeout(resolve,1850));equal((await read()).plans.some(p=>p.symbol==='1001'),false,'Expired price plans disappear while the underlying research edition remains readable.');
 // Emulate an equal-resolution server clock in this disposable fixture. No
 // production trigger is disabled and no immutable record is rewritten.
 await db.exec('reset role');const tiedAt=await clock();
 await db.query("select set_config('test.plan_clock',$1,false)",[tiedAt]);
 await db.exec(`create function public.synthetic_equal_plan_clock() returns trigger language plpgsql as $$begin
  new.created_at:=current_setting('test.plan_clock')::timestamptz;return new;end$$;
  create trigger synthetic_equal_plan_clock before insert on vnext_private.ai_price_plans_v1
  for each row execute function public.synthetic_equal_plan_clock();`);
 const candidateA=await body('1002','LONG',{as_of:f.cutoff,basis:'Synthetic tied-clock body A.'});
 const candidateB={...candidateA,basis:'Synthetic tied-clock body B.'};
 const [hashA,hashB]=await Promise.all([snapshotHash(candidateA),snapshotHash(candidateB)]);
 assert.notEqual(hashA,hashB);checks++;
 const tiedOld=await stage(hashA>hashB?candidateA:candidateB),tiedOldReview=await review(tiedOld);
 await f.identity('owner');await approve(tiedOld,tiedOldReview);await f.identity('premium');equal((await read()).plans.some(p=>p.plan_hash===tiedOld.hash),true);
 const tiedNew=await stage(hashA>hashB?candidateB:candidateA);
 assert(tiedNew.hash<tiedOld.hash);checks++;
 await db.exec('reset role');const registrations=(await db.query(`select plan_hash,registration_id,created_at::text stamp from vnext_private.ai_price_plans_v1 where plan_hash in($1,$2) order by registration_id`,[tiedOld.hash,tiedNew.hash])).rows;
 equal(registrations[0].stamp,registrations[1].stamp);equal(registrations.map(r=>r.plan_hash),[tiedOld.hash,tiedNew.hash]);
 await f.identity('premium');equal((await read()).plans.some(p=>p.symbol==='1002'),false,'The newer pending registration suppresses an old approval even with the exact same timestamp and a lower hash.');
 await db.exec('reset role');await db.exec('drop trigger synthetic_equal_plan_clock on vnext_private.ai_price_plans_v1;drop function public.synthetic_equal_plan_clock()');
 const tiedNewReview=await review(tiedNew);await f.identity('owner');await approve(tiedNew,tiedNewReview);
 await f.identity('premium');equal((await read()).plans.some(p=>p.plan_hash===tiedNew.hash),true);
 // A later FAIL also wins over a prior PASS when recorded_at is identical
 // and the later UUID sorts lower. Sequence order is registration order.
 await db.exec('reset role');const reviewStamp=(await db.query('select recorded_at::text stamp from vnext_private.ai_price_plan_reviews_v1 where id=$1',[tiedNewReview])).rows[0].stamp;
 await db.query("select set_config('test.review_clock',$1,false)",[reviewStamp]);
 await db.exec(`create function public.synthetic_equal_review_clock() returns trigger language plpgsql as $$begin
  new.recorded_at:=current_setting('test.review_clock')::timestamptz;return new;end$$;
  create trigger zz_synthetic_equal_review_clock before insert on vnext_private.ai_price_plan_reviews_v1
  for each row execute function public.synthetic_equal_review_clock();`);
 await role('service_role');const lowerUuid='00000000-0000-0000-0000-000000000000';
 await db.query(`insert into vnext_private.ai_price_plan_reviews_v1(id,plan_hash,reviewer_ref,quality,time_status,source_use,methodology,
  document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
  select $1,plan_hash,reviewer_ref,'FAIL',time_status,source_use,methodology,document_hash,source_document_hash,method_document_hash,time_document_hash,
   'Synthetic latest failed review with identical timestamp and lower UUID.',reviewed_at,expires_at
  from vnext_private.ai_price_plan_reviews_v1 where id=$2`,[lowerUuid,tiedNewReview]);
 await db.exec('reset role');const tiedReviews=(await db.query('select id,recorded_at::text stamp from vnext_private.ai_price_plan_reviews_v1 where plan_hash=$1 order by review_sequence',[tiedNew.hash])).rows;
 equal(tiedReviews.length,2);equal(tiedReviews[0].stamp,tiedReviews[1].stamp);equal(tiedReviews[1].id,lowerUuid);
 await f.identity('premium');equal((await read()).plans.some(p=>p.symbol==='1002'),false,'Latest FAIL is not hidden behind a timestamp/UUID tie.');
 await f.identity('owner');ownerView=await preview();equal(ownerView.plans.find(p=>p.plan_hash===tiedNew.hash).can_approve,false);equal(ownerView.plans.find(p=>p.plan_hash===tiedNew.hash).review.id,lowerUuid);
 await f.identity('owner');await rejects(()=>approve(tiedNew,tiedNewReview),/AI_PRICE_PLAN_REVIEW_CHANGED/);
 await db.exec('reset role');await db.exec('drop trigger zz_synthetic_equal_review_clock on vnext_private.ai_price_plan_reviews_v1;drop function public.synthetic_equal_review_clock()');
 await db.exec('reset role');
 await rejects(()=>db.query('update vnext_private.ai_price_plans_v1 set body=$1 where plan_hash=$2',[{},first.hash]),/IMMUTABLE/);
 await rejects(()=>db.query('delete from vnext_private.ai_price_plan_reviews_v1 where id=$1',[rid]),/IMMUTABLE/);
 await rejects(()=>db.query('delete from vnext_private.ai_price_plan_publication_events_v1'),/IMMUTABLE/);
 for(const table of ['ai_price_plans_v1','ai_price_plan_reviews_v1','ai_price_plan_publication_events_v1']){
  const security=(await db.query(`select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass`,['vnext_private.'+table])).rows[0];
  equal(security,{relrowsecurity:true,relforcerowsecurity:true});
 }
 await f.identity('owner');await f.approveEdition('premium','REVOKE');await f.identity('premium');equal((await read()).plans,[],'Research revocation removes its price sidecar through the unchanged authoritative Reader.');
 equal((await read()).source_sets,[]);
 console.log(JSON.stringify({scope:'SYNTHETIC_ISOLATED_REAL_SQL_AND_TYPESCRIPT_CONSUMER',checks,status:'PASS',model_calls:0,production_writes:0}));
}catch(error){console.error({message:error.message,code:error.code,where:error.where});process.exitCode=1;}finally{await f.close();}
