// Local PostgreSQL regression only. All users, sources, reviews and approvals
// are synthetic. This does not certify throughput or touch a remote database.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createCalculatedPriceFixture} from './helpers/dailyAiCalculatedPriceFixture.mjs';
import {produceDailyAiPricePlan} from '../research/daily-ai-price-producer.mjs';
import {canonical} from '../research/entry-opportunity.ts';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_MEMBER_PRICE_SET_READ_TEST');};
const output=process.env.MA_MEMBER_PRICE_SET_RECEIPT;
if(output&&!isAbsolute(output))throw Error('ABSOLUTE_RECEIPT_PATH_REQUIRED');
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const baseline=read('./fixtures/member-price-reader.saved.sql'),candidate=read('../research/member-price-set-read.candidate.sql');
const rollback=read('../research/member-price-set-read.rollback.sql');
const optimized=candidate.match(/CREATE OR REPLACE FUNCTION[\s\S]+?end \$function\$\n/)[0]+';';
const baselineHash='a7027fc316e31f154fbdfea46cab72cc',optimizedHash='b65377e7bd97915d7903f556e6d0df1e';
const sha=text=>createHash('sha256').update(text).digest('hex'),phases=[];
const receipt={schema:'SYNTHETIC_MEMBER_PRICE_SET_READ_RECEIPT_V1',scope:'SYNTHETIC_ONLY',runtime:process.version,
 production_rpc_calls:0,production_load_test:false,production_validation:false,real_reviews:0,phases};
const phase=async(name,work)=>{try{const facts=await work();phases.push({name,status:'PASS',facts});console.log('PASS '+name);}
 catch(error){phases.push({name,status:'FAIL',error:String(error)});throw error;}};
let f;
try{
 f=await createCalculatedPriceFixture();const {db}=f,produced=[],reviews=new Map();
 const info=async()=>{await db.exec('reset role');return (await db.query(`select md5(pg_get_functiondef(p.oid)) hash,
  p.proacl::text acl,md5(pg_get_functiondef('public.get_daily_ai_member_research_v1()'::regprocedure)) authority_hash
  from pg_proc p where p.oid='public.get_daily_ai_member_price_plans_v1(text)'::regprocedure`)).rows[0];};
 const capture=async(tier,editionId=f.editionId)=>{
  if(['anon','service_role'].includes(tier))await f.role(tier);
  else if(tier==='expired'){
   await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.tier','',false)",[f.MEMBER]);
   await db.exec('set role authenticated');
  }else await f.identity(tier);
  try{return {value:(await db.query('select public.get_daily_ai_member_price_plans_v1($1) r',[editionId])).rows[0].r};}
  catch(error){return {error:error.message,code:error.code};}
 };
 const compare=async(tier='premium',editionId=f.editionId)=>{
  await db.exec('reset role');await db.exec(baseline);const before=await capture(tier,editionId);
  await db.exec('reset role');await db.exec(optimized);const after=await capture(tier,editionId);
  assert.deepEqual(after,before);return after;
 };
 const approve=async p=>{
  const id=await f.insertPriceReview(p);reviews.set(p.candidate.plan_hash,id);await f.identity('owner');await f.priceAction(p,id);
 };
 const stage=async(symbol,horizon,change)=>{
  const input=await f.producerInput(symbol,horizon);if(change)change(input.calculation_input);
  const p=await produceDailyAiPricePlan(input,{mode:'STAGE',rpc:f.stageRpc,now:Date.now()+2});
  assert.equal(p.status,'STAGED_REVIEW_REQUIRED');return p;
 };
 await phase('guarded replacement keeps exact authority and ACL and removes only per-card lookups',async()=>{
  await db.exec('reset role');await db.exec(baseline);const before=await info();assert.equal(before.hash,baselineHash);
  assert.equal(before.authority_hash,'e71c9691c466ce6a708e00a9713fbdd4');
  await db.exec(candidate);const after=await info();assert.equal(after.hash,optimizedHash);assert.equal(after.acl,before.acl);
  assert.equal(after.authority_hash,before.authority_hash);
  assert.doesNotMatch(optimized,/for card\b|into [pra]\s+from/i);
  for(const tier of ['anon','service_role'])assert.match((await compare(tier)).error,/permission denied/);
  assert.equal((await compare('expired')).error,'MEMBER_REQUIRED');
  assert.equal((await compare('premium')).value.edition_id,null);
  await db.exec('reset role');await assert.rejects(()=>db.exec(candidate),/MEMBER_PRICE_SET_READ_BASELINE_CHANGED/);await db.exec('rollback');
  return {baseline_md5:before.hash,candidate_md5:after.hash,member_authority_unchanged:true,acl_unchanged:true,
   unauthorized_roles_denied:true,absent_entitlement_denied:true,price_lookup_statements_per_read:1};
 });
 await phase('pending plans and exact approved bodies retain original order and metadata',async()=>{
  for(const symbol of ['1000','1001','1002'])for(const horizon of ['MEDIUM','LONG'])produced.push(await stage(symbol,horizon));
  await f.identity('owner');await f.approveEdition();
  assert.equal((await compare()).value.plans.length,0);
  for(const p of produced)await approve(p);
  const member=(await compare()).value;assert.equal(member.plans.length,6);assert.equal(member.source_sets.length,3);
  assert.deepEqual(member.plans.map(p=>p.symbol+':'+p.horizon),['1000:LONG','1000:MEDIUM','1001:LONG','1001:MEDIUM','1002:LONG','1002:MEDIUM']);
  assert(member.source_sets.every(s=>s.sources.every(e=>!Object.hasOwn(e,'content'))));
  assert.equal((await compare('owner')).value.plans.length,6);
  assert.equal((await compare('premium','f'.repeat(64))).value.edition_id,null);
  assert.equal((await compare('premium','invalid')).error,'AI_PRICE_PLAN_SCOPE');
  return {approved_plans:6,exact_original_json:true,ordered_by_existing_cards:true,source_metadata_only:true,wrong_edition_hidden:true};
 });
 await phase('latest plan and review are selected before PASS and approval filters',async()=>{
  const replacement=await stage('1000','MEDIUM',input=>{input.invalidation+=' 新固定版本尚待審查。';});
  let value=(await compare()).value;assert.equal(value.plans.length,5);
  assert(!value.plans.some(p=>p.symbol==='1000'&&p.horizon==='MEDIUM'));
  await approve(replacement);assert.equal((await compare()).value.plans.length,6);
  const target=produced.find(p=>p.symbol==='1001'&&p.horizon==='MEDIUM');
  for(const field of ['quality','time_status','source_use','methodology']){
   const states={quality:'PASS',time_status:'PASS',source_use:'PASS',methodology:'PASS',[field]:'FAIL'};
   await f.insertPriceReview(target,states);value=(await compare()).value;
   assert.equal(value.plans.length,5);assert(!value.plans.some(p=>p.plan_hash===target.candidate.plan_hash));
   await approve(target);assert.equal((await compare()).value.plans.length,6);
  }
  const pending=produced.find(p=>p.symbol==='1002'&&p.horizon==='MEDIUM');
  await f.insertPriceReview(pending,{quality:'PASS',time_status:'PASS',source_use:'PASS',methodology:'PENDING'});
  assert.equal((await compare()).value.plans.length,5);
  await f.insertPriceReview(pending);assert.equal((await compare()).value.plans.length,5);
  return {unreviewed_newest_hides_old:true,four_independent_fail_gates:true,pending_hides_old:true,new_pass_needs_matching_owner_approval:true};
 });
 await phase('latest revocation and free three-stock scope remain unchanged',async()=>{
  const target=produced.find(p=>p.symbol==='1000'&&p.horizon==='LONG');
  await f.identity('owner');await f.priceAction(target,reviews.get(target.candidate.plan_hash),'REVOKE');
  assert.equal((await compare()).value.plans.length,4);
  await db.exec('reset role');const reviewId=(await db.query('select id from vnext_private.ai_research_reviews where edition_id=$1 order by recorded_at desc,id desc limit 1',[f.editionId])).rows[0].id;
  await f.identity('owner');await db.query('select public.review_daily_ai_research_edition_v1($1,$2,$3,$4,$5)',[f.editionId,reviewId,'APPROVE','free',randomUUID()]);
  const free=(await compare('free')).value;assert.equal(free.edition_id,f.editionId);assert.deepEqual(free.plans,[]);assert.deepEqual(free.source_sets,[]);
  await f.identity('free');const research=await f.readMember();assert.equal(research.cards.length,9);
  assert.equal(new Set(research.cards.map(c=>c.symbol)).size,3);assert(research.cards.every(c=>!Object.hasOwn(c,'sources')&&!Object.hasOwn(c,'counter_evidence')));
  return {revoke_hides_latest:true,free_stock_limit:3,free_prices:0,free_private_source_fields:0};
 });
 await phase('real expiry suppresses newest plan without reviving a previous approval',async()=>{
  const original=produced.find(p=>p.symbol==='1002'&&p.horizon==='LONG');
  const body=JSON.parse(original.candidate.body_text);body.expires_at=new Date(Date.now()+3500).toISOString();
  body.invalidation+=' Synthetic short lifetime for real-clock expiry regression.';
  const text=canonical(body),hash=sha(text);await f.role('service_role');
  await db.query('select public.stage_daily_ai_price_plan_v1($1,$2)',[text,hash]);
  const at=await f.clock();const reviewId=(await db.query(`insert into vnext_private.ai_price_plan_reviews_v1(plan_hash,reviewer_ref,
   quality,time_status,source_use,methodology,document_hash,source_document_hash,method_document_hash,time_document_hash,reason,reviewed_at,expires_at)
   values($1,'synthetic-expiry-reviewer','PASS','PASS','PASS','PASS',$2,$3,$4,$5,
   'Synthetic expiry fixture only, not a real financial review or approval.',$6,$7) returning id`,
   [hash,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),'d'.repeat(64),at,body.expires_at])).rows[0].id;
  await f.identity('owner');await db.query('select public.review_daily_ai_price_plan_v1($1,$2,$3,$4)',[hash,reviewId,'APPROVE',randomUUID()]);
  assert((await compare()).value.plans.some(p=>p.plan_hash===hash));
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(body.expires_at)-Date.now()+30)));
  const expired=(await compare()).value;assert(!expired.plans.some(p=>p.symbol==='1002'&&p.horizon==='LONG'));
  return {actual_clock_crossed_expiry:true,expired_newest_hidden:true,previous_approved_price_not_revived:true};
 });
 await phase('current source-use authority still removes the entire unreadable edition',async()=>{
  await f.role('service_role');const at=await f.clock();
  await db.query(`insert into vnext_private.ai_research_use_reviews(edition_id,snapshot_hash,use_scope,raw_redistribution,basis,quality,
   reviewer_ref,review_document_hash,source_mapping_document_hash,terms_document_hash,official_document_urls,documents_status,mapping_status,
   reason,reviewed_at,expires_at) values($1,$1,'OWN_ANALYSIS_ONLY',false,'OPEN_LICENSE','PENDING','synthetic-pending-use-review',
   $2,$3,$4,array['https://data.gov.tw/license'],'UNVERIFIED','INCOMPLETE',
   'Synthetic pending source assessment requires independent documents; no real right is granted.',$5,$6)`,
   [f.editionId,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),at,f.expiry]);
  for(const tier of ['premium','owner','free']){
   const value=(await compare(tier)).value;assert.equal(value.edition_id,null);assert.deepEqual(value.plans,[]);assert.deepEqual(value.source_sets,[]);
  }
  return {latest_source_review_still_authoritative:true,unreadable_edition_prices:0,old_approval_cannot_bypass_rights:true};
 });
 await phase('exact rollback restores the captured function without deleting any records',async()=>{
  await db.exec('reset role');const before=(await db.query(`select (select count(*) from vnext_private.ai_price_plans_v1) plans,
   (select count(*) from vnext_private.ai_price_plan_reviews_v1) reviews,(select count(*) from vnext_private.ai_price_plan_publication_events_v1) events`)).rows[0];
  await db.exec(rollback);assert.equal((await info()).hash,baselineHash);
  const after=(await db.query(`select (select count(*) from vnext_private.ai_price_plans_v1) plans,
   (select count(*) from vnext_private.ai_price_plan_reviews_v1) reviews,(select count(*) from vnext_private.ai_price_plan_publication_events_v1) events`)).rows[0];
  assert.deepEqual(after,before);await assert.rejects(()=>db.exec(rollback),/MEMBER_PRICE_SET_READ_ROLLBACK_CHANGED/);await db.exec('rollback');
  return {restored_md5:baselineHash,rows_unchanged:true,changed_function_cannot_be_overwritten_by_rollback:true};
 });
 receipt.ok=true;
}catch(error){receipt.ok=false;receipt.error=String(error);console.error(error);process.exitCode=1;}
finally{if(f)await f.close();receipt.finished_at=new Date().toISOString();if(output)writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');}
