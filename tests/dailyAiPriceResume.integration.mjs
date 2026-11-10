// Synthetic local recovery test. The real saved resumer and the new SQL run
// in fresh PGlite. net.http_post is a transaction-local capture, never HTTP.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createCalculatedPriceFixture} from './helpers/dailyAiCalculatedPriceFixture.mjs';
import {runDailyAiPriceWork} from '../research/daily-ai-price-work.mjs';
import {canonical} from '../research/entry-opportunity.ts';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_PRICE_RESUME_TEST');};
const out=process.env.MA_PRICE_RESUME_RECEIPT;if(out&&!isAbsolute(out))throw Error('ABSOLUTE_RECEIPT_PATH_REQUIRED');
const phases=[],receipt={schema:'SYNTHETIC_PRICE_RESUME_RECEIPT_V1',scope:'SYNTHETIC_ONLY',runtime:process.version,
 started_at:new Date().toISOString(),production_validation:false,network_calls:0,phases};
const sha=text=>createHash('sha256').update(text).digest('hex');
const phase=async(name,work)=>{try{const facts=await work();phases.push({name,status:'PASS',facts});console.log('PASS '+name);}
 catch(error){phases.push({name,status:'FAIL',error:String(error)});throw error;}};
let f;
try{
 f=await createCalculatedPriceFixture();const db=f.db,snapshot='d'.repeat(64),savedInputs=[];
 await db.exec('reset role');
 await db.exec(readFileSync(new URL('../research/daily-ai-price-workflow.candidate.sql',import.meta.url),'utf8'));
 // The old resumer's dependency schema is represented only as needed here.
 // These synthetic rows do not claim a real zero-model author or review.
 await db.exec(`alter table vnext_private.ai_research_editions add column reviewed_snapshot_hash text default '${snapshot}';
  create table vnext_runtime.ai_stock_intakes(id uuid primary key,batch_id text,state text,business_date date,requested_at timestamptz);
  create table vnext_private.zero_paid_draft_runs_v1(batch_id text primary key,author_version text,prepared_at timestamptz,
   expires_at timestamptz,last_attempt_at timestamptz,attempts integer);
  create table vnext_private.zero_paid_draft_delivery_v1(batch_id text primary key,attempts integer not null default 0,
   updated_at timestamptz,last_code text,request_id bigint);
  create table vnext_private.reviewed_analysis_snapshots_v1(snapshot_hash text primary key,batch_id text,author_ref text,body jsonb);
  create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz);
  insert into vault.decrypted_secrets values('morning_alpha_daily_delivery_token','synthetic-only-resume-token-no-production-secret',clock_timestamp());
  create schema net;create table net.requests(id bigint generated always as identity,url text,headers jsonb,body jsonb,timeout_ms integer);
  create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$
   declare rid bigint;begin insert into net.requests(url,headers,body,timeout_ms) values(url,headers,body,timeout_milliseconds) returning id into rid;return rid;end$$;`);
 const author='ZERO_PAID_DAILY_AUTHOR_1.0.0; deterministic author only; independent review pending';
 await db.query(`insert into vnext_runtime.ai_stock_intakes values(gen_random_uuid(),$1,'COMPLETE',
  (clock_timestamp() at time zone 'Asia/Taipei')::date,clock_timestamp())`,[f.batchId]);
 await db.query(`insert into vnext_private.zero_paid_draft_runs_v1 values($1,'ZERO_PAID_DAILY_AUTHOR_1.0.0',$2,$3,clock_timestamp()-interval '1 minute',1)`,
  [f.batchId,f.edition.prepared_at,f.edition.expires_at]);
 await db.query('insert into vnext_private.reviewed_analysis_snapshots_v1 values($1,$2,$3,$4)',
  [snapshot,f.batchId,author,{prepared_at:f.edition.prepared_at,expires_at:f.edition.expires_at}]);
 await db.exec(readFileSync(new URL('./fixtures/price-work-resumer.saved.sql',import.meta.url),'utf8'));
 await db.exec('revoke all on function vnext_private.resume_zero_paid_stock_draft_v1() from public,anon,authenticated,service_role');
 const resume=async()=>{await db.exec('reset role');return (await db.query('select vnext_private.resume_zero_paid_stock_draft_v1() r')).rows[0].r;};
 const work=async()=>{await f.role('service_role');return (await db.query('select public.get_daily_ai_price_work_v1($1) r',[f.editionId])).rows[0].r;};
 const register=async input=>{
  await f.role('service_role');const text=canonical(input);
  return (await db.query('select public.stage_daily_ai_price_calculation_input_v1($1,$2,$3) r',[f.batchId,text,sha(text)])).rows[0].r;
 };
 const counts=async()=>{await db.exec('reset role');return (await db.query(`select
  (select count(*)::int from vnext_private.ai_price_calculation_inputs_v1) inputs,
  (select count(*)::int from vnext_private.ai_price_calculation_audits_v1) audits,
  (select count(*)::int from vnext_private.ai_price_plans_v1) plans,
  (select count(*)::int from vnext_private.ai_price_work_results_v1) completions,
  (select count(*)::int from vnext_private.ai_price_plan_reviews_v1) reviews,
  (select count(*)::int from vnext_private.ai_price_plan_publication_events_v1) publications,
  (select count(*)::int from net.requests) requests,
  (select count(*)::int from vnext_private.zero_paid_draft_delivery_v1) draft_delivery_rows`)).rows[0];};
 for(const [symbol,horizon] of [['1000','MEDIUM'],['1001','LONG']]){
  const input=(await f.producerInput(symbol,horizon)).calculation_input;input.as_of=new Date(Date.now()-10).toISOString();
  await register(input);savedInputs.push(input);
 }
 let losePriceAck=true;const calls=[],priceReceipts=[];
 const rpc=async(name,args,signal)=>{
  assert.equal(signal.aborted,false);calls.push(name);await f.role('service_role');let result;
  if(name==='get_daily_ai_price_work_v1')result=(await db.query('select public.get_daily_ai_price_work_v1($1) r',[args.p_edition_id])).rows[0].r;
  else if(name==='stage_daily_ai_price_work_batch_v1'){
   result=(await db.query('select public.stage_daily_ai_price_work_batch_v1($1,$2) r',[args.p_edition_id,args.p_items])).rows[0].r;
   priceReceipts.push(result);if(losePriceAck)throw Error('SYNTHETIC_PRICE_ACK_LOST_AFTER_COMMIT');
  }else if(name==='finish_daily_ai_price_work_v1')result=(await db.query('select public.finish_daily_ai_price_work_v1($1,$2,$3,$4) r',
   [args.p_edition_id,args.p_work_key,args.p_result_text,args.p_result_hash])).rows[0].r;
  else throw Error('UNEXPECTED_PRICE_RESUME_RPC');
  return {data:result,error:null};
 };
 const run=()=>runDailyAiPriceWork({editionId:f.editionId,batchId:f.batchId,rpc,clock:()=>new Date().toISOString()});

 await phase('saved production resumer skips an existing edition even when its price work is unfinished',async()=>{
  await db.exec('reset role');
  assert.equal((await db.query("select md5(pg_get_functiondef('vnext_private.resume_zero_paid_stock_draft_v1()'::regprocedure)) h")).rows[0].h,
   '7ebe6088ff2e24dbfb316d55306672b9');
  assert.equal((await resume()).state,'NO_PENDING_DRAFT');assert.equal((await counts()).requests,0);
  const unknown=await run();assert.equal(unknown.state,'STAGE_OUTCOME_UNKNOWN');assert.equal(unknown.stage_attempted,true);
  assert(!calls.includes('finish_daily_ai_price_work_v1'));
  assert.deepEqual(await counts(),{inputs:2,audits:2,plans:2,completions:0,reviews:0,publications:0,requests:0,draft_delivery_rows:0});
  assert.equal((await resume()).state,'NO_PENDING_DRAFT');
  return {original_gap_reproduced:true,price_commit_ack_lost:true,stored_audits:2,false_completion_receipts:0};
 });

 let dispatched;
 await phase('one guarded branch resumes committed edition price work through the original fixed bridge',async()=>{
  await db.exec(readFileSync(new URL('../research/daily-ai-price-resume.candidate.sql',import.meta.url),'utf8'));
  assert.equal((await db.query("select md5(pg_get_functiondef('vnext_private.resume_zero_paid_stock_draft_v1()'::regprocedure)) h")).rows[0].h,
   '8c0adecb6bf037d61e6d57ce00f88de4');
  dispatched=await resume();assert.equal(dispatched.state,'PRICE_WORK_DISPATCHED');assert.equal(dispatched.attempt,1);
  assert.equal(dispatched.edition_id,f.editionId);assert.equal(dispatched.batch_id,f.batchId);
  assert.equal(dispatched.work_key,(await work()).work_key);await db.exec('reset role');
  const request=(await db.query('select url,body,timeout_ms from net.requests')).rows[0];
  assert.equal(request.url,'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1');
  assert.deepEqual(request.body,{draft_batch_id:f.batchId});assert.equal(request.timeout_ms,35000);
  assert.equal((await counts()).draft_delivery_rows,0);
  return {exact_baseline_guard:true,changed_original_branches:1,fixed_bridge_only:true,price_attempt:1,draft_budget_unchanged:true};
 });

 await phase('the continuation is private, immutable and rate limited to the existing five minute cadence',async()=>{
  assert.equal((await resume()).state,'PRICE_WORK_ALREADY_DISPATCHED');assert.equal((await counts()).requests,1);
  for(const role of ['anon','authenticated','service_role']){
   await f.role(role);
   await assert.rejects(()=>db.query('select vnext_private.resume_daily_ai_price_work_v1()'),/permission denied/);
   await assert.rejects(()=>db.query('select * from vnext_private.ai_price_work_dispatches_v1'),/permission denied/);
  }
  await db.exec('reset role');
  await assert.rejects(()=>db.query('update vnext_private.ai_price_work_dispatches_v1 set attempt=attempt'),/IMMUTABLE/);
  await assert.rejects(()=>db.query('delete from vnext_private.ai_price_work_dispatches_v1'),/IMMUTABLE/);
  return {anonymous_and_browser_and_service_direct_access_denied:true,immediate_redispatch_blocked:true,immutable_attempt_log:true};
 });

 await phase('a later cached worker confirms the lost write by exact replay and stops further dispatch',async()=>{
  losePriceAck=false;calls.length=0;priceReceipts.length=0;const recovered=await run();
  assert.equal(recovered.state,'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED');assert.equal(recovered.counts.staged,2);
  assert.equal(recovered.completion.state,'CONFIRMED');assert.equal(recovered.completion.work_key,dispatched.work_key);
  assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
  assert(priceReceipts[0].items.every(r=>r.replayed));
  assert.deepEqual(await counts(),{inputs:2,audits:2,plans:2,completions:1,reviews:0,publications:0,requests:1,draft_delivery_rows:0});
  assert.equal((await resume()).state,'NO_PENDING_PRICE_WORK');assert.equal((await counts()).requests,1);
  return {lost_ack_recovered_from_database:true,exact_hash_replays:2,confirmed_completion:true,new_inputs:0,new_audits:0,redispatch_after_completion:0};
 });

 await phase('an explicit new input creates new work without reopening the old immutable completion',async()=>{
  const revised=structuredClone(savedInputs[0]);revised.assumption_basis.description+=' Explicit method revision for this synthetic recovery test.';
  await register(revised);const next=await work();assert.notEqual(next.work_key,dispatched.work_key);
  const dispatch=await resume();assert.equal(dispatch.state,'PRICE_WORK_DISPATCHED');assert.equal(dispatch.attempt,1);
  assert.equal(dispatch.work_key,next.work_key);assert.equal((await counts()).completions,1);assert.equal((await counts()).requests,2);
  return {new_input_new_key:true,new_key_independent_budget:true,prior_completion_retained:true};
 });

 await phase('three historical attempts exhaust only that work key and a new missing-card profile creates new work',async()=>{
  const revised=structuredClone(savedInputs[0]);revised.assumption_basis.description+=' Another explicit revision with three synthetic past deliveries.';
  await register(revised);const exhausted=await work();await db.exec('reset role');
  // These are explicitly synthetic past dispatch records, not time overrides
  // or production mutations. They exercise the real bounded retry decision.
  for(let attempt=1;attempt<=3;attempt++)await db.query(`insert into vnext_private.ai_price_work_dispatches_v1
   (edition_id,work_key,attempt,attempted_at,state,request_id) values($1,$2,$3::integer,clock_timestamp()-interval '20 minutes'+($3::integer)*interval '5 minutes','DISPATCHED',$4)`,
   [f.editionId,exhausted.work_key,attempt,900+attempt]);
  assert.equal((await resume()).state,'PRICE_WORK_EXHAUSTED');assert.equal((await counts()).requests,2);
  const template=(await f.producerInput('1004','MEDIUM')).calculation_input;template.as_of=new Date(Date.now()-10).toISOString();
  const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:'1004',horizon:'MEDIUM',method_id:template.method_id,
   created_at:new Date().toISOString(),valid_until:f.edition.expires_at,revision_note:'SYNTHETIC_ONLY: new explicit missing-card method.',template_input:template};
  const text=canonical(profile);await f.role('service_role');await db.query('select public.stage_daily_ai_price_profile_v1($1,$2)',[text,sha(text)]);
  const newWork=await work();assert.notEqual(newWork.work_key,exhausted.work_key);
  const resumed=await resume();assert.equal(resumed.state,'PRICE_WORK_DISPATCHED');assert.equal(resumed.attempt,1);
  assert.equal((await counts()).requests,3);
  return {three_attempt_cap:true,new_profile_new_key:true,old_budget_not_reset:true,new_key_attempt:1};
 });

 await phase('a newer intake suppresses the old edition and exact rollback preserves every work record',async()=>{
  await db.exec('reset role');await db.query(`insert into vnext_runtime.ai_stock_intakes values(gen_random_uuid(),null,'QUEUED',
   (clock_timestamp() at time zone 'Asia/Taipei')::date,clock_timestamp())`);
  assert.equal((await resume()).state,'NO_PENDING_PRICE_WORK');const before=await counts();
  await db.exec(readFileSync(new URL('../research/daily-ai-price-resume.rollback.sql',import.meta.url),'utf8'));
  assert.equal((await db.query("select md5(pg_get_functiondef('vnext_private.resume_zero_paid_stock_draft_v1()'::regprocedure)) h")).rows[0].h,
   '7ebe6088ff2e24dbfb316d55306672b9');
  assert.equal((await resume()).state,'NO_PENDING_DRAFT');assert.deepEqual(await counts(),before);
  assert.equal(before.reviews,0);assert.equal(before.publications,0);
  return {superseded_intake_not_resumed:true,original_definition_restored_exactly:true,immutable_work_and_audits_retained:true,
   source_acquisition_calls:0,review_or_publication_writes:0,cron_changes:0};
 });
 receipt.status='PASS';receipt.passed_phases=phases.length;
}catch(error){receipt.status='FAIL';receipt.error=String(error);process.exitCode=1;console.error(error);}
finally{if(f)await f.close();receipt.finished_at=new Date().toISOString();if(out)writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,phases:phases.length,scope:receipt.scope,production_validation:false}));}
