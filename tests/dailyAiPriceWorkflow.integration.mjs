// All issuers, inputs, rights and identities here are SYNTHETIC in a fresh
// in-memory PostgreSQL. No remote connection or production review is created.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createCalculatedPriceFixture} from './helpers/dailyAiCalculatedPriceFixture.mjs';
import {produceDailyAiPricePlan} from '../research/daily-ai-price-producer.mjs';
import {runDailyAiPriceWork} from '../research/daily-ai-price-work.mjs';
import {bindDailyAiPriceProfile} from '../research/daily-ai-price-profile.ts';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {parseDailyAiOwnerPricePlans} from '../src/features/vnext/dailyAiOwnerPricePlans.ts';
import {parseDailyAiOwnerPriceCalculation} from '../src/features/vnext/dailyAiOwnerPriceCalculation.ts';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_PRICE_WORKFLOW_TEST');};
const output=process.env.MA_PRICE_WORKFLOW_RECEIPT;
if(output&&!isAbsolute(output))throw Error('ABSOLUTE_RECEIPT_PATH_REQUIRED');
const phases=[],receipt={schema:'SYNTHETIC_PRICE_WORKFLOW_RECEIPT_V1',scope:'SYNTHETIC_ONLY',
 started_at:new Date().toISOString(),runtime:process.version,production_rpc_calls:0,real_reviews:0,production_validation:false,phases};
const phase=async(name,work)=>{
 try{const facts=await work();phases.push({name,status:'PASS',facts});console.log('PASS '+name);}
 catch(error){phases.push({name,status:'FAIL',error:String(error)});throw error;}
};
const sha=text=>createHash('sha256').update(text).digest('hex');
let f;
try{
 f=await createCalculatedPriceFixture();const {db}=f,inputs=new Map();
 await db.exec('reset role');
 const originalEdition=(await db.query('select payload,id,created_at,cutoff,expires_at from vnext_private.ai_research_editions where id=$1',[f.editionId])).rows[0];
 await db.exec(readFileSync(new URL('../research/daily-ai-price-workflow.candidate.sql',import.meta.url),'utf8'));
 const role=name=>f.role(name);
 const work=async()=>{await role('service_role');return (await db.query('select public.get_daily_ai_price_work_v1($1) r',[f.editionId])).rows[0].r;};
 const rawStage=async(input,batch=f.batchId,hash)=>{
  await role('service_role');const text=canonical(input);
  return (await db.query('select public.stage_daily_ai_price_calculation_input_v1($1,$2,$3) r',[batch,text,hash??sha(text)])).rows[0].r;
 };
 const stageProfile=async(profile,hash)=>{
  await role('service_role');const text=canonical(profile);
  return (await db.query('select public.stage_daily_ai_price_profile_v1($1,$2) r',[text,hash??sha(text)])).rows[0].r;
 };
 const inputBatch=async items=>{
  await role('service_role');return (await db.query('select public.stage_daily_ai_price_inputs_batch_v1($1,$2) r',[f.batchId,items])).rows[0].r;
 };
 const makeInput=async(symbol,horizon)=>{
  const p=await f.producerInput(symbol,horizon);
  // Keep replay deterministic; this is the actual explicit synthetic input
  // time, not a clock override or an extension of source/publication time.
  p.calculation_input.as_of=new Date(Date.now()-10).toISOString();return p.calculation_input;
 };
 const counts=async()=>{
  await db.exec('reset role');return (await db.query(`select
   (select count(*)::int from vnext_private.ai_price_calculation_inputs_v1) inputs,
   (select count(*)::int from vnext_private.ai_price_calculation_audits_v1) audits,
   (select count(*)::int from vnext_private.ai_price_plans_v1) plans,
   (select count(*)::int from vnext_private.ai_price_plan_reviews_v1) reviews,
   (select count(*)::int from vnext_private.ai_price_plan_publication_events_v1) publications`)).rows[0];
 };
 const batchStage=async items=>{
  await role('service_role');return (await db.query('select public.stage_daily_ai_price_work_batch_v1($1,$2) r',[f.editionId,items])).rows[0].r;
 };
 const finish=async(key,result,edition=f.editionId)=>{
  await role('service_role');const text=canonical(result);
  return (await db.query('select public.finish_daily_ai_price_work_v1($1,$2,$3,$4) r',[edition,key,text,sha(text)])).rows[0].r;
 };
 const itemFor=async(input,currentWork)=>{
  const produced=await produceDailyAiPricePlan({edition:currentWork.edition,
   card:currentWork.cards.find(c=>c.symbol===input.symbol&&c.horizon===input.horizon),
   packet:currentWork.packets.find(p=>p.symbol===input.symbol),calculation_input:input},{mode:'DRY_RUN',now:Date.now()});
  assert.equal(produced.status,'CALCULATED_REVIEW_REQUIRED');
  const {calculation_hash,...payload}=produced.calculation;
  return {input_hash:produced.calculation.input_hash,body_text:produced.candidate.body_text,plan_hash:produced.candidate.plan_hash,
   calculation_text:canonical(payload),calculation_hash,method_note_text:canonical(produced.candidate.method_note),
   method_note_hash:produced.candidate.method_note_hash,review_request_text:canonical(produced.review_request)};
 };

 await phase('empty workflow reads the real database edition without creating prices or reviews',async()=>{
  const w=await work();assert.equal(w.schema,'DAILY_AI_PRICE_WORK_V1');assert.equal(w.batch_id,f.batchId);
  assert.deepEqual(w.edition,f.edition);assert.equal(w.cards.length,216);assert.deepEqual(w.packets,f.packets);
  assert.deepEqual(w.inputs,[]);assert.deepEqual(w.profiles,[]);assert.match(w.work_key,/^[a-f0-9]{64}$/);
  assert.equal(w.review_required,true);assert.equal(w.member_published,false);
  assert.deepEqual(await counts(),{inputs:0,audits:0,plans:0,reviews:0,publications:0});
  await db.exec('reset role');
  assert.deepEqual((await db.query('select payload,id,created_at,cutoff,expires_at from vnext_private.ai_research_editions where id=$1',[f.editionId])).rows[0],originalEdition);
  return {cards:216,packets:72,inputs:0,actual_created_at_and_expiry:true,original_edition_unchanged:true};
 });

 await phase('missing method inputs reach a durable private work checkpoint without creating prices',async()=>{
  const calls=[];
  const rpc=async(name,args)=>{
   calls.push(name);
   if(name==='get_daily_ai_price_work_v1')return work();
   if(name==='finish_daily_ai_price_work_v1'){
    await role('service_role');return (await db.query('select public.finish_daily_ai_price_work_v1($1,$2,$3,$4) r',
     [args.p_edition_id,args.p_work_key,args.p_result_text,args.p_result_hash])).rows[0].r;
   }
   throw Error('UNEXPECTED_EMPTY_WORK_RPC');
  };
  const result=await runDailyAiPriceWork({editionId:f.editionId,batchId:f.batchId,rpc,clock:()=>new Date().toISOString()});
  assert.equal(result.state,'METHOD_INPUTS_REQUIRED');assert.equal(result.completion.state,'CONFIRMED');
  assert.equal(result.stage_attempted,false);assert.equal(result.counts.staged,0);
  assert.deepEqual(calls,['get_daily_ai_price_work_v1','finish_daily_ai_price_work_v1']);
  assert.deepEqual(await counts(),{inputs:0,audits:0,plans:0,reviews:0,publications:0});
  return {missing_input_outcome_saved:true,staged_prices:0,review_or_publication_created:false};
 });

 const first=await makeInput('1000','MEDIUM');
 // Analyst assumptions may honestly be formed after the source snapshot;
 // their timestamp must not be backdated or be later than the calculation.
 first.assumption_basis.available_at=first.as_of;
 assert(Date.parse(first.assumption_basis.available_at)>Date.parse(first.cutoff));
 await phase('only service RPCs can register or load; no direct table or sequence grants exist',async()=>{
  for(const name of ['anon','authenticated']){
   await role(name);
   await assert.rejects(()=>db.query('select public.get_daily_ai_price_work_v1($1)',[f.editionId]),/permission denied/);
   await assert.rejects(()=>db.query('select public.stage_daily_ai_price_calculation_input_v1($1,$2,$3)',[f.batchId,canonical(first),sha(canonical(first))]),/permission denied/);
   await assert.rejects(()=>db.query('select public.stage_daily_ai_price_work_batch_v1($1,$2)',[f.editionId,[]]),/permission denied/);
   await assert.rejects(()=>db.query('select public.stage_daily_ai_price_profile_v1($1,$2)',['{}','f'.repeat(64)]),/permission denied/);
   await assert.rejects(()=>db.query('select public.stage_daily_ai_price_inputs_batch_v1($1,$2)',[f.batchId,[]]),/permission denied/);
   await assert.rejects(()=>db.query('select public.finish_daily_ai_price_work_v1($1,$2,$3,$4)',[f.editionId,'f'.repeat(64),'{}','f'.repeat(64)]),/permission denied/);
  }
  await f.identity('owner');await assert.rejects(()=>db.query('select public.get_daily_ai_price_work_v1($1)',[f.editionId]),/permission denied/);
  for(const name of ['anon','authenticated','service_role'])for(const table of ['ai_price_calculation_inputs_v1','ai_price_calculation_audits_v1','ai_price_profiles_v1','ai_price_work_results_v1']){
   await role(name);await assert.rejects(()=>db.query('select * from vnext_private.'+table),/permission denied/);
  }
  await role('service_role');
  await assert.rejects(()=>db.query("select nextval('vnext_private.ai_price_calculation_inputs_v1_registration_id_seq')"),/permission denied/);
  await assert.rejects(()=>db.query("select nextval('vnext_private.ai_price_profiles_v1_registration_id_seq')"),/permission denied/);
  await db.exec('reset role');
  const policies=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid in('vnext_private.ai_price_calculation_inputs_v1'::regclass,'vnext_private.ai_price_calculation_audits_v1'::regclass,'vnext_private.ai_price_profiles_v1'::regclass,'vnext_private.ai_price_work_results_v1'::regclass)")).rows;
  assert.equal(policies.length,4);assert(policies.every(p=>p.relrowsecurity&&p.relforcerowsecurity));
  return {anonymous_denied:true,browser_owner_denied:true,direct_service_table_access_denied:true,forced_rls:true};
 });

 await phase('input registration binds exact original evidence and rejects approval or identity injection',async()=>{
  const stored=await rawStage(first),again=await rawStage(first);
  assert.equal(stored.registered,true);assert.equal(stored.review_required,true);assert.equal(stored.member_published,false);
  assert.equal(stored.registration_id,again.registration_id);assert.equal(stored.input_hash,await snapshotHash(first));
  assert.equal((await counts()).inputs,1);
  const bad=[];
  bad.push({...first,review:{status:'PASS'}},{...first,method_id:'APPROVED_BY_CALLER'},
   {...first,symbol:'9999'},{...first,cutoff:new Date(Date.parse(first.cutoff)+1).toISOString()},
   {...first,data_through:'1999-01-01'},{...first,expires_at:first.cutoff},
   {...first,as_of:'2099-01-01T00:00:00Z'},
   {...first,assumption_basis:{...first.assumption_basis,available_at:'2099-01-01T00:00:00Z'}},
   {...first,parameters:{...first.parameters,approval:'PASS'}},
   {...first,quote_evidence_id:f.sourceIds('1001').price},
   {...first,parameters:{...first.parameters,dilution_basis:{...first.parameters.dilution_basis,evidence_ids:[f.sourceIds('1001').financial]}}});
  const changed=structuredClone(first);changed.evidence[0].content+=' forged';bad.push(changed);
  const added=structuredClone(first);added.evidence.push({...added.evidence[1],id:'UNSTORED-NEW-SOURCE'});bad.push(added);
  for(const input of bad)await assert.rejects(()=>rawStage(input),/PRICE_INPUT_/);
  await assert.rejects(()=>rawStage(first,f.batchId,'f'.repeat(64)),/PRICE_INPUT_HASH/);
  await assert.rejects(()=>rawStage(first,'f'.repeat(64)),/PRICE_INPUT_BATCH_BINDING/);
  assert.equal((await counts()).inputs,1);
  return {original_bytes_bound:true,replay_same_registration:true,rejected_variants:bad.length+2,new_source_cannot_be_added_to_old_edition:true,
   assumptions_after_source_cutoff_retained_at_actual_time:true};
 });

 await phase('latest method is ordered by server registration and old replays cannot hide it',async()=>{
  const second=structuredClone(first);second.assumption_basis.description+=' Second explicit private version.';
  const old=await rawStage(first),latest=await rawStage(second);assert(latest.registration_id>old.registration_id);
  await rawStage(first);const w=await work();assert.equal(w.inputs.length,1);assert.equal(w.inputs[0].input_hash,latest.input_hash);
  assert.equal(JSON.parse(w.inputs[0].input_text).as_of,first.as_of);
  inputs.set('1000:MEDIUM',second);
  const long=await makeInput('1001','LONG');await rawStage(long);inputs.set('1001:LONG',long);
  return {latest_chosen_by_identity_sequence:true,equal_client_times_supported:true,replaying_old_hash_does_not_reorder:true};
 });

 const items=[];
 await phase('actual formulas and pending review documents commit atomically through the existing price stage',async()=>{
  const w=await work();
  for(const input of inputs.values())items.push(await itemFor(input,w));
  // A legacy plan may exist without an audit. It remains explicitly absent
  // until the real batch supplies one; absence is never a review decision.
  await role('service_role');
  await db.query('select public.stage_daily_ai_price_plan_v1($1,$2)',[items[0].body_text,items[0].plan_hash]);
  await f.identity('owner');
  const absent=(await db.query('select public.get_daily_ai_owner_price_calculation_v1($1,$2) r',[f.editionId,items[0].plan_hash])).rows[0].r;
  assert.equal(absent.audit,null);assert.equal(absent.research_only,true);assert.equal(absent.preview_only,true);
  const result=await batchStage(items);assert.equal(result.schema,'DAILY_AI_PRICE_WORK_BATCH_STAGED_V1');assert.equal(result.edition_id,f.editionId);
  assert.equal(result.items.length,2);assert(result.items.every(r=>r.review_required&&!r.member_published&&!r.replayed));
  assert.deepEqual(result.items.map(r=>r.plan_hash),items.map(r=>r.plan_hash));
  assert.deepEqual((await counts()),{inputs:3,audits:2,plans:2,reviews:0,publications:0});
  for(const item of items){
   await db.exec('reset role');const a=(await db.query('select * from vnext_private.ai_price_calculation_audits_v1 where plan_hash=$1',[item.plan_hash])).rows[0];
   assert.equal(a.calculation_text,item.calculation_text);assert.equal(a.method_note_text,item.method_note_text);assert.equal(a.review_request_text,item.review_request_text);
   assert.equal(sha(a.calculation_text),a.calculation_hash);assert.equal(sha(a.method_note_text),a.method_note_hash);assert.equal(sha(a.review_request_text),a.review_request_hash);
   assert.equal(a.review_request.status,'PENDING');assert.equal(a.review_request.review,null);
   const plan=(await db.query('select body from vnext_private.ai_price_plans_v1 where plan_hash=$1',[item.plan_hash])).rows[0].body;
   assert.deepEqual(plan.entry_range,plan.horizon==='MEDIUM'?[64,96]:[80,96]);
  }
  await f.identity('owner');const owner=await f.readOwnerPrices();assert.equal(owner.plans.length,2);assert(owner.plans.every(p=>p.review===null&&!p.can_approve));
  await f.identity('premium');assert.equal((await f.readMemberPrices()).plans.length,0);
  return {calculated_plans:2,persisted_full_review_packets:2,medium:[64,96],long:[80,96],price_reviews:0,owner_approvals:0,member_prices:0};
 });

 await phase('only the real Owner reads one exact pending calculation and its matching input',async()=>{
  const read=async(edition=f.editionId,plan=items[0].plan_hash)=>(await db.query(
   'select public.get_daily_ai_owner_price_calculation_v1($1,$2) r',[edition,plan])).rows[0].r;
  for(const name of ['anon','service_role']){await role(name);await assert.rejects(()=>read(),/permission denied/);}
  for(const tier of ['free','premium']){await f.identity(tier);await assert.rejects(()=>read(),/OWNER_REQUIRED/);}
  await f.identity('owner');
  await assert.rejects(()=>read('f'.repeat(64)),/AI_PRICE_CALCULATION_EDITION/);
  await assert.rejects(()=>read(f.editionId,'f'.repeat(64)),/AI_PRICE_CALCULATION_PLAN/);
  const ownerRows=await parseDailyAiOwnerPricePlans(await f.readOwnerPrices(),f.editionId,f.OWNER,Date.now()+2);
  for(const item of items){
   const result=await read(f.editionId,item.plan_hash),audit=result.audit;
   assert.equal(result.schema,'DAILY_AI_OWNER_PRICE_CALCULATION_V1');assert.equal(result.subject_user_id,f.OWNER);
   assert.equal(result.edition_id,f.editionId);assert.equal(result.plan_hash,item.plan_hash);
   assert.equal(result.research_only,true);assert.equal(result.preview_only,true);
   assert.equal(audit.batch_id,f.batchId);assert.equal(audit.input_hash,item.input_hash);
   assert.equal(sha(audit.input_text),audit.input_hash);assert.equal(audit.calculation_text,item.calculation_text);
   assert.equal(sha(audit.calculation_text),audit.calculation_hash);assert.equal(audit.method_note_text,item.method_note_text);
   assert.equal(sha(audit.method_note_text),audit.method_note_hash);assert.equal(audit.review_request_text,item.review_request_text);
   assert.equal(sha(audit.review_request_text),audit.review_request_hash);
   const input=JSON.parse(audit.input_text),calculation=JSON.parse(audit.calculation_text);
   assert.equal(input.symbol,calculation.symbol);assert.equal(input.horizon,calculation.horizon);
   assert(input.evidence.every(e=>e.symbol===input.symbol||e.symbol===null));
   assert.deepEqual(Object.keys(audit).sort(),['batch_id','input_hash','input_text','calculation_hash','calculation_text',
    'method_note_hash','method_note_text','review_request_hash','review_request_text','recorded_at'].sort());
   assert.equal(JSON.parse(audit.review_request_text).status,'PENDING');
   const row=ownerRows.plans.find(p=>p.plan_hash===item.plan_hash);assert(row);
   const parsed=await parseDailyAiOwnerPriceCalculation(result,row,f.OWNER,Date.now()+2);
   assert.equal(parsed.audit.input_hash,audit.input_hash);assert.equal(parsed.audit.calculation_hash,audit.calculation_hash);
   assert.equal(parsed.audit.raw.input_text,audit.input_text);assert.equal(parsed.audit.raw.calculation_text,audit.calculation_text);
  }
  assert.deepEqual(await counts(),{inputs:3,audits:2,plans:2,reviews:0,publications:0});
  return {owner_only:true,one_plan_input_only:true,all_four_raw_hashes_bound:true,pending_audit_readable:true,
   legacy_missing_audit_null:true,real_browser_parser_accepts_database_microseconds_and_hashes:true,no_review_or_publication_written:true};
 });

 await phase('batch replay is stable and retains the first pending packet without changing its time',async()=>{
  const original=await batchStage(items);assert(original.items.every(r=>r.replayed));
  const repeated=structuredClone(items);
  for(const item of repeated){const request=JSON.parse(item.review_request_text);request.prepared_at=await f.clock();item.review_request_text=canonical(request);}
  const replay=await batchStage(repeated);assert(replay.items.every(r=>r.replayed));
  assert.deepEqual(replay.items.map(r=>r.review_request_hash),original.items.map(r=>r.review_request_hash));
  assert.equal((await counts()).audits,2);assert.equal((await counts()).plans,2);
  return {exact_replay_idempotent:true,new_preparation_time_keeps_original_audit:true};
 });

 let finishedKey,finishedSummary;
 await phase('daily runner loads real SQL work and replays its calculated atomic batch with confirmed receipts',async()=>{
  const calls=[],responses=[];
  const rpc=async(name,args,signal)=>{
   assert.equal(signal.aborted,false);calls.push(name);await role('service_role');
   let response;
   if(name==='get_daily_ai_price_work_v1'){
    assert.deepEqual(args,{p_edition_id:f.editionId});
    response=(await db.query('select public.get_daily_ai_price_work_v1($1) r',[args.p_edition_id])).rows[0].r;
    assert.equal(response.inputs.length,2);
   }else if(name==='stage_daily_ai_price_work_batch_v1'){
    assert.equal(args.p_edition_id,f.editionId);assert.equal(args.p_items.length,2);
    response=(await db.query('select public.stage_daily_ai_price_work_batch_v1($1,$2) r',[args.p_edition_id,args.p_items])).rows[0].r;
   }else if(name==='finish_daily_ai_price_work_v1'){
    response=(await db.query('select public.finish_daily_ai_price_work_v1($1,$2,$3,$4) r',
     [args.p_edition_id,args.p_work_key,args.p_result_text,args.p_result_hash])).rows[0].r;
   }else throw Error('UNEXPECTED_PRICE_WORKFLOW_RPC');
   responses.push(response);return {data:response,error:null};
  };
  const result=await runDailyAiPriceWork({editionId:f.editionId,batchId:f.batchId,rpc,clock:()=>new Date().toISOString()});
  assert.equal(result.state,'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED',JSON.stringify(result));
  assert.equal(result.stage_attempted,true);assert.equal(result.review_required,true);assert.equal(result.member_published,false);
  assert.equal(result.model_calls,0);
  assert.deepEqual(result.counts,{cards:216,calculated:2,staged:2,missing_inputs:142,ineligible:72,invalid:0});
  assert.equal(result.rows.filter(r=>r.state==='STAGED_REVIEW_REQUIRED').length,2);
  assert(result.rows.every(r=>r.state!=='STAGE_OUTCOME_UNKNOWN'));
  assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
  assert.equal(result.completion.state,'CONFIRMED');assert.equal(result.completion.replayed,false);
  assert(responses[1].items.every(r=>r.replayed));
  assert.deepEqual(new Set(responses[1].items.map(r=>r.plan_hash)),new Set(items.map(r=>r.plan_hash)));
  assert.deepEqual(await counts(),{inputs:3,audits:2,plans:2,reviews:0,publications:0});
  finishedKey=result.completion.work_key;
  finishedSummary=(await db.query('select result from vnext_private.ai_price_work_results_v1 where edition_id=$1 and work_key=$2',[f.editionId,finishedKey])).rows[0].result;
  for(const item of items){
   const audit=(await db.query('select calculation_text,method_note_text,review_request_text,review_request_hash from vnext_private.ai_price_calculation_audits_v1 where plan_hash=$1',[item.plan_hash])).rows[0];
   assert.equal(audit.calculation_text,item.calculation_text);assert.equal(audit.method_note_text,item.method_note_text);
   assert.equal(audit.review_request_text,item.review_request_text);
   assert.equal(responses[1].items.find(r=>r.plan_hash===item.plan_hash).review_request_hash,audit.review_request_hash);
  }
  return {real_runner:true,real_loader:true,real_atomic_stage:true,confirmed_replays:2,staged:2,unknown_outcomes:0,
   original_audit_retained:true,work_completion_confirmed:true,extra_reviews_or_publications:0};
 });

 await phase('finish rejects unknown results, fabricated audits and a foreign edition',async()=>{
  const same=await finish(finishedKey,finishedSummary);assert.equal(same.replayed,true);
  const unknown=structuredClone(finishedSummary);unknown.state='STAGE_OUTCOME_UNKNOWN';
  await assert.rejects(()=>finish(finishedKey,unknown),/PRICE_WORK_FINISH_RESULT/);
  const forged=structuredClone(finishedSummary);forged.rows.find(r=>r.plan_hash).plan_hash='f'.repeat(64);
  await assert.rejects(()=>finish(finishedKey,forged),/PRICE_WORK_FINISH_AUDIT/);
  const wrongInput=structuredClone(finishedSummary);wrongInput.rows.find(r=>r.plan_hash).input_hash='f'.repeat(64);
  await assert.rejects(()=>finish(finishedKey,wrongInput),/PRICE_WORK_FINISH_INPUT/);
  await assert.rejects(()=>finish(finishedKey,finishedSummary,'f'.repeat(64)),/PRICE_WORK_FINISH_EDITION/);
  const wrongEdition={...finishedSummary,edition_id:'f'.repeat(64)};
  await assert.rejects(()=>finish(finishedKey,wrongEdition),/PRICE_WORK_FINISH_RESULT/);
  return {known_outcomes_only:true,existing_audits_required:true,current_inputs_required:true,edition_bound:true};
 });

 await phase('one bad item rolls back the whole batch and cannot inject a PASS decision',async()=>{
  const more=[];
  for(const [symbol,horizon] of [['1002','MEDIUM'],['1003','LONG']]){const input=await makeInput(symbol,horizon);await rawStage(input);more.push(input);}
  await assert.rejects(()=>finish(finishedKey,finishedSummary),/PRICE_WORK_FINISH_KEY_CHANGED/);
  const w=await work(),pending=[];for(const input of more)pending.push(await itemFor(input,w));
  const forged=structuredClone(pending),request=JSON.parse(forged[1].review_request_text);request.source_use_approved=true;forged[1].review_request_text=canonical(request);
  const before=await counts();await assert.rejects(()=>batchStage(forged),/PRICE_WORK_REVIEW_REQUEST/);assert.deepEqual(await counts(),before);
  const mismatch=structuredClone(pending);mismatch[1].calculation_text+=' ';
  await assert.rejects(()=>batchStage(mismatch),/PRICE_WORK_ITEM_HASH/);assert.deepEqual(await counts(),before);
  const badMethod=structuredClone(pending),note=JSON.parse(badMethod[1].method_note_text);note.derivation+=' Invented divergence.';
  badMethod[1].method_note_text=canonical(note);badMethod[1].method_note_hash=sha(badMethod[1].method_note_text);
  await assert.rejects(()=>batchStage(badMethod),/PRICE_WORK_METHOD_BINDING/);assert.deepEqual(await counts(),before);
  await assert.rejects(()=>batchStage([items[0],items[0]]),/PRICE_WORK_BATCH_SCOPE/);
  const obsolete=await itemFor(first,w);await assert.rejects(()=>batchStage([obsolete]),/PRICE_WORK_INPUT_SUPERSEDED/);
  return {atomic_rollback:true,forged_pass_rejected:true,raw_hash_tamper_rejected:true,method_divergence_rejected:true,
   superseded_input_rejected:true,new_input_invalidates_old_completion_key:true};
 });

 const profiles=new Map();
 await phase('finite method profiles retain exact templates and select the latest immutable registration',async()=>{
  const makeProfile=async(symbol,horizon)=>{
   const template=await makeInput(symbol,horizon);
   if(horizon==='MEDIUM')template.parameters.forecast_period={start:'2027-01-01',end:'2027-12-31'};
   return {schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol,horizon,
    method_id:template.method_id,created_at:new Date().toISOString(),valid_until:f.edition.expires_at,
    revision_note:'SYNTHETIC_ONLY: explicit finite fixed-assumption profile, no independent approval.',template_input:template};
  };
  const original=await makeProfile('1004','MEDIUM'),stored=await stageProfile(original),same=await stageProfile(original);
  assert.equal(stored.schema,'DAILY_AI_PRICE_PROFILE_STAGED_V1');assert.equal(stored.registration_id,same.registration_id);
  assert.equal(stored.review_required,true);assert.equal(stored.member_published,false);
  const revised=structuredClone(original);revised.revision_note+=' Explicit second revision.';
  const latest=await stageProfile(revised);assert(latest.registration_id>stored.registration_id);await stageProfile(original);
  profiles.set('1004:MEDIUM',revised);
  const long=await makeProfile('1005','LONG');await stageProfile(long);profiles.set('1005:LONG',long);
  const expired=await makeProfile('1006','MEDIUM');
  expired.template_input.as_of=new Date(Date.parse(f.cutoff)+1000).toISOString();
  expired.created_at=new Date(Date.parse(f.cutoff)+2000).toISOString();expired.valid_until=new Date(Date.parse(f.cutoff)+3000).toISOString();
  // Register while the template is actually alive, then cross its real expiry
  // to distinguish exact replay from a new backdated registration.
  expired.template_input.expires_at=new Date(Date.now()+2000).toISOString();
  const expiredStored=await stageProfile(expired);
  const w=await work();assert.equal(w.profiles.length,3);
  const chosen=w.profiles.find(p=>p.symbol==='1004'&&p.horizon==='MEDIUM');
  assert.equal(chosen.profile_hash,latest.profile_hash);assert.equal(chosen.profile_text,canonical(revised));
  assert(w.profiles.every(p=>sha(p.profile_text)===p.profile_hash));
  const blocked=await bindDailyAiPriceProfile({profile:JSON.parse(w.profiles.find(p=>p.symbol==='1006').profile_text),
   packet:w.packets.find(p=>p.symbol==='1006'),edition:w.edition,now:Date.now()});
  assert.equal(blocked.status,'METHOD_UPDATE_REQUIRED');assert.equal(blocked.calculation_input,null);
  assert.equal(blocked.missing[0].code,'PROFILE_EXPIRED');
  const bad=[{...original,approved:true},{...original,policy:'AUTO_APPROVE'},
   {...original,method_id:'legacy-2330-policy'},
   {...original,template_input:{...original.template_input,symbol:'1005'}},
   {...original,created_at:original.template_input.cutoff},{...original,valid_until:original.created_at},
   {...original,template_input:{...original.template_input,review:{status:'PASS'}}},
   {...original,template_input:{...original.template_input,parameters:{...original.template_input.parameters,approved:true}}}];
  const rights=structuredClone(original);rights.template_input.evidence[0].commercial_allowed=true;bad.push(rights);
  for(const profile of bad)await assert.rejects(()=>stageProfile(profile),/PRICE_PROFILE_/);
  await assert.rejects(()=>stageProfile(original,'f'.repeat(64)),/PRICE_PROFILE_HASH/);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expired.template_input.expires_at)-Date.now()+20)));
  assert.equal((await stageProfile(expired)).registration_id,expiredStored.registration_id);
  const backdated=structuredClone(expired);backdated.revision_note+=' New registration attempted after actual template expiry.';
  await assert.rejects(()=>stageProfile(backdated),/PRICE_PROFILE_TEMPLATE_EXPIRED_AT_REGISTRATION/);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from vnext_private.ai_price_profiles_v1')).rows[0].n,4);
  assert.equal((await counts()).reviews,0);assert.equal((await counts()).publications,0);
  return {current_profiles:3,versions_retained:4,replay_keeps_sequence:true,expired_latest_visible_and_blocked:true,
   expired_template_new_registration_rejected:true,existing_hash_replay_after_template_expiry:true,
   caller_approvals_rejected:true,source_rights_unchanged:true};
 });

 await phase('daily input batch atomically stores real profile bindings and protects existing inputs from races',async()=>{
  const w=await work(),bound=[];
  for(const profile of profiles.values()){
   const result=await bindDailyAiPriceProfile({profile,packet:w.packets.find(p=>p.symbol===profile.symbol),edition:w.edition,now:Date.now()});
   assert.equal(result.status,'BOUND_REVIEW_REQUIRED',JSON.stringify(result));
   assert.deepEqual(result.calculation_input.parameters,profile.template_input.parameters);
   assert.deepEqual(result.calculation_input.evidence,w.packets.find(p=>p.symbol===profile.symbol).evidence);
   assert.equal(result.methodology_approved,false);const text=canonical(result.calculation_input);
   bound.push({input_text:text,input_hash:sha(text)});
  }
  const before=await counts(),invalid=structuredClone(bound);invalid[1].input_hash='f'.repeat(64);
  await assert.rejects(()=>inputBatch(invalid),/PRICE_INPUT_HASH/);assert.deepEqual(await counts(),before);
  const forged=structuredClone(bound),changed=JSON.parse(forged[1].input_text);changed.evidence[0].content+=' changed after storage';
  forged[1]={input_text:canonical(changed),input_hash:sha(canonical(changed))};
  await assert.rejects(()=>inputBatch(forged),/PRICE_INPUT_EVIDENCE_BINDING/);assert.deepEqual(await counts(),before);
  const result=await inputBatch(bound),replay=await inputBatch(bound);
  assert.equal(result.schema,'DAILY_AI_PRICE_INPUTS_BATCH_STAGED_V1');assert.equal(result.batch_id,f.batchId);
  assert.equal(result.review_required,true);assert.equal(result.member_published,false);
  assert.deepEqual(result.items.map(r=>r.input_hash),bound.map(r=>r.input_hash));
  assert(result.items.every(r=>r.registered&&r.review_required&&!r.member_published));
  assert.deepEqual(replay.items.map(r=>r.registration_id),result.items.map(r=>r.registration_id));
  assert.deepEqual(await counts(),{...before,inputs:before.inputs+2});
  const competing=JSON.parse(bound[0].input_text);competing.assumption_basis.description+=' Competing late registration.';
  await assert.rejects(()=>inputBatch([{input_text:canonical(competing),input_hash:sha(canonical(competing))}]),/PRICE_INPUT_BATCH_ALREADY_REGISTERED/);
  await assert.rejects(()=>inputBatch([bound[0],bound[0]]),/PRICE_INPUT_BATCH_SCOPE/);
  await assert.rejects(()=>inputBatch(Array.from({length:217},()=>bound[0])),/PRICE_INPUT_BATCH_SCOPE/);
  assert.deepEqual(await counts(),{...before,inputs:before.inputs+2});
  const loaded=await work();
  for(const item of bound)assert(loaded.inputs.some(i=>i.input_hash===item.input_hash&&i.input_text===item.input_text));
  assert.deepEqual(loaded.profiles.map(p=>p.symbol+':'+p.horizon),['1006:MEDIUM']);
  return {bound_profiles:2,registered_inputs:2,whole_batch_rollback:true,raw_evidence_bound:true,
   replay_idempotent:true,existing_input_race_rejected:true,registered_profile_templates_omitted:true,
   unregistered_expired_latest_retained:true,no_prices_or_reviews_created:true};
 });

 await phase('daily runner writes profile-only work, reloads confirmed inputs and replays the same hashes on cached work',async()=>{
  const daily=await createCalculatedPriceFixture(),dailyDb=daily.db;
  try{
   await dailyDb.exec('reset role');
   await dailyDb.exec(readFileSync(new URL('../research/daily-ai-price-workflow.candidate.sql',import.meta.url),'utf8'));
   const beforeEdition=(await dailyDb.query('select * from vnext_private.ai_research_editions where id=$1',[daily.editionId])).rows[0];
   const registeredProfiles=new Map();
   for(const [symbol,horizon] of [['1000','MEDIUM'],['1001','LONG'],['1002','MEDIUM']]){
    const template=(await daily.producerInput(symbol,horizon)).calculation_input;
    template.as_of=new Date(Date.now()-10).toISOString();
    if(horizon==='MEDIUM'){
     template.parameters.earnings_basis='FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION';
     template.parameters.forecast_period={start:'2027-01-01',end:'2027-12-31'};
    }
    const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol,horizon,
     method_id:template.method_id,created_at:new Date().toISOString(),valid_until:daily.edition.expires_at,
     revision_note:'SYNTHETIC_ONLY: daily fixed profile writer integration without a qualified review.',template_input:template};
    if(symbol==='1002'){
     template.as_of=new Date(Date.parse(daily.cutoff)+1000).toISOString();
     profile.created_at=new Date(Date.parse(daily.cutoff)+2000).toISOString();profile.valid_until=new Date(Date.parse(daily.cutoff)+3000).toISOString();
    }
    const text=canonical(profile);await daily.role('service_role');
    await dailyDb.query('select public.stage_daily_ai_price_profile_v1($1,$2)',[text,sha(text)]);
    registeredProfiles.set(symbol+':'+horizon,profile);
   }
   const calls=[],responses=[];
   const rpc=async(name,args,signal)=>{
    assert.equal(signal.aborted,false);calls.push(name);await daily.role('service_role');
    let response;
    if(name==='get_daily_ai_price_work_v1'){
     assert.deepEqual(args,{p_edition_id:daily.editionId});
     response=(await dailyDb.query('select public.get_daily_ai_price_work_v1($1) r',[args.p_edition_id])).rows[0].r;
     assert.deepEqual(response.edition,daily.edition);
    }else if(name==='stage_daily_ai_price_inputs_batch_v1'){
     assert.equal(args.p_batch_id,daily.batchId);assert.equal(args.p_items.length,2);
     response=(await dailyDb.query('select public.stage_daily_ai_price_inputs_batch_v1($1,$2) r',[args.p_batch_id,args.p_items])).rows[0].r;
    }else if(name==='stage_daily_ai_price_work_batch_v1'){
     assert.equal(args.p_edition_id,daily.editionId);assert.equal(args.p_items.length,2);
     response=(await dailyDb.query('select public.stage_daily_ai_price_work_batch_v1($1,$2) r',[args.p_edition_id,args.p_items])).rows[0].r;
    }else if(name==='finish_daily_ai_price_work_v1'){
     response=(await dailyDb.query('select public.finish_daily_ai_price_work_v1($1,$2,$3,$4) r',
      [args.p_edition_id,args.p_work_key,args.p_result_text,args.p_result_hash])).rows[0].r;
    }else throw Error('UNEXPECTED_DAILY_PROFILE_RPC');
    responses.push(response);return {data:response,error:null};
   };
   const run=()=>runDailyAiPriceWork({editionId:daily.editionId,batchId:daily.batchId,rpc,clock:()=>new Date().toISOString()});
   const result=await run();
   assert.equal(result.state,'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED',JSON.stringify(result));
   assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1','get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
   assert.equal(responses[0].inputs.length,0);assert.equal(responses[0].profiles.length,3);assert.equal(responses[2].inputs.length,2);
   assert.deepEqual(responses[2].profiles.map(p=>p.symbol+':'+p.horizon),['1002:MEDIUM']);
   assert.notEqual(responses[0].work_key,responses[2].work_key);
   assert.equal(result.completion.state,'CONFIRMED');assert.equal(result.completion.work_key,responses[2].work_key);
   assert.equal(result.input_work.state,'INPUTS_REGISTERED_REVIEW_REQUIRED');assert.equal(result.input_work.registered,2);
   assert.equal(result.input_work.registration_attempted,true);assert.equal(result.input_work.counts.method_updates,1);
   assert.equal(result.rows.find(r=>r.symbol==='1002'&&r.horizon==='MEDIUM').reason,'PROFILE_EXPIRED');
   assert.deepEqual(result.counts,{cards:216,calculated:2,staged:2,missing_inputs:142,ineligible:72,invalid:0});
   assert(responses[3].items.every(r=>!r.replayed&&r.review_required&&!r.member_published));
   await dailyDb.exec('reset role');
   const inputRows=(await dailyDb.query('select * from vnext_private.ai_price_calculation_inputs_v1 order by input_hash')).rows;
   const auditRows=(await dailyDb.query('select * from vnext_private.ai_price_calculation_audits_v1 order by plan_hash')).rows;
   assert.equal(inputRows.length,2);assert.equal(auditRows.length,2);
   for(const row of inputRows){
    const profile=registeredProfiles.get(row.symbol+':'+row.horizon),current=row.input;
    assert.deepEqual(current.parameters,profile.template_input.parameters);
    assert.equal(current.assumption_basis.available_at,profile.template_input.assumption_basis.available_at);
    assert(current.assumption_basis.description.includes(await snapshotHash(profile)));
    assert.deepEqual(current.evidence,daily.packets.find(p=>p.symbol===row.symbol).evidence);
   }
   calls.length=0;responses.length=0;const cached=await run();
   assert.equal(cached.state,'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED',JSON.stringify(cached));assert.equal(cached.counts.staged,2);
   assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
   assert.deepEqual(responses[0].profiles.map(p=>p.symbol+':'+p.horizon),['1002:MEDIUM']);
   assert.equal(cached.input_work.registration_attempted,false);assert.equal(cached.input_work.registered,0);
   assert.equal(cached.input_work.counts.already_registered,2);assert(responses[1].items.every(r=>r.replayed));
   assert.equal(cached.completion.state,'CONFIRMED');assert.equal(cached.completion.replayed,true);
   assert.equal(cached.completion.result_hash,result.completion.result_hash);
   assert.deepEqual(cached.rows.filter(r=>r.plan_hash).map(r=>r.plan_hash),result.rows.filter(r=>r.plan_hash).map(r=>r.plan_hash));
   await dailyDb.exec('reset role');
   assert.deepEqual((await dailyDb.query('select * from vnext_private.ai_price_calculation_inputs_v1 order by input_hash')).rows,inputRows);
   assert.deepEqual((await dailyDb.query('select * from vnext_private.ai_price_calculation_audits_v1 order by plan_hash')).rows,auditRows);
   assert.deepEqual((await dailyDb.query('select * from vnext_private.ai_research_editions where id=$1',[daily.editionId])).rows[0],beforeEdition);
   assert.deepEqual((await dailyDb.query(`select
    (select count(*)::int from vnext_private.ai_price_plans_v1) plans,
    (select count(*)::int from vnext_private.ai_price_plan_reviews_v1) reviews,
    (select count(*)::int from vnext_private.ai_price_plan_publication_events_v1) publications`)).rows[0],{plans:2,reviews:0,publications:0});
   return {profile_only_start:true,actual_input_batch_write:true,actual_readback:true,actual_price_audit_write:true,
    registered:2,staged:2,expired_profile_blocked:true,fixed_parameters_and_assumption_time_retained:true,
    cached_input_writes:0,cached_same_plan_hashes:true,cached_audit_unchanged:true,edition_unchanged:true,
    reload_and_cached_profiles_deduplicated:true,completion_uses_final_readback_key:true,cached_completion_retains_original_result_hash:true,unknown_outcomes:0};
  }finally{await daily.close();}
 });

 await phase('at most one current input per 72 stocks and three horizons is returned',async()=>{
  for(const packet of f.packets)for(const horizon of ['SHORT','MEDIUM','LONG']){
   let input=await makeInput(packet.symbol,horizon);
   if(horizon==='SHORT')input.parameters={bar_evidence_ids:[f.sourceIds(packet.symbol).price],expected_sessions:[f.through],
    atr_period:14,breakout_lookback:5,trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK',entry_atr_width:0.25,stop_atr_multiple:1.5,tick_size:0.1,
    corporate_actions_evidence_id:f.sourceIds(packet.symbol).financial};
   // Storage verifies scope only. These SHORT data intentionally lack the
   // calculation's full window/action coverage and do not become prices.
   await rawStage(input);
  }
  const w=await work();assert.equal(w.inputs.length,216);assert.equal(new Set(w.inputs.map(i=>i.symbol+':'+i.horizon)).size,216);
  assert.deepEqual(w.profiles,[]);
  assert(w.inputs.every(i=>sha(i.input_text)===i.input_hash));
  await assert.rejects(()=>batchStage(Array.from({length:217},(_,i)=>({...items[0],plan_hash:i.toString(16).padStart(64,'0')}))),/PRICE_WORK_BATCH_SCOPE/);
  assert.equal((await counts()).plans,2);assert.equal((await counts()).reviews,0);
  return {current_input_limit:216,versions_retained:true,short_fixture_not_calculation_eligible:true,no_extra_prices_or_reviews:true};
 });

 await phase('registered inputs and calculation audits are append-only even for their owner',async()=>{
  await db.exec('reset role');
  for(const table of ['ai_price_calculation_inputs_v1','ai_price_calculation_audits_v1','ai_price_profiles_v1','ai_price_work_results_v1']){
   await assert.rejects(()=>db.query('update vnext_private.'+table+' set recorded_at=clock_timestamp()'),/IMMUTABLE/);
   await assert.rejects(()=>db.query('delete from vnext_private.'+table),/IMMUTABLE/);
  }
  await role('service_role');await assert.rejects(()=>db.query('select public.get_daily_ai_price_work_v1($1)',['f'.repeat(64)]),/PRICE_WORK_EDITION/);
  assert.equal((await counts()).publications,0);assert.equal((await counts()).reviews,0);
  return {update_denied:true,delete_denied:true,unknown_edition_rejected:true,price_reviews_and_publications:0};
 });
 receipt.status='PASS';receipt.passed_phases=phases.length;
}catch(error){receipt.status='FAIL';receipt.error=String(error);process.exitCode=1;console.error(error);}
finally{
 if(f)await f.close();receipt.finished_at=new Date().toISOString();
 if(output)writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({status:receipt.status,phases:phases.length,scope:receipt.scope,runtime:receipt.runtime,production_validation:false}));
}
