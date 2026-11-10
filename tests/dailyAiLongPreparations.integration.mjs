// Synthetic source/policy/review-preparation integration in fresh PostgreSQL.
// No remote request, real reviewer verdict or publication occurs.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createLongPreparationFixture} from './helpers/dailyAiLongPreparationFixture.mjs';
import {runDailyAiPriceWork,prepareDailyAiLongReviewWork} from '../research/daily-ai-price-work.mjs';
import {canonical} from '../research/entry-opportunity.ts';
import {parseDailyAiOwnerLongPreparation} from '../src/features/vnext/dailyAiOwnerLongPreparation.ts';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_LONG_PREPARATION_TEST');};
const output=process.env.MA_LONG_PREPARATIONS_RECEIPT;
if(output&&!isAbsolute(output))throw Error('ABSOLUTE_RECEIPT_PATH_REQUIRED');
const sha=text=>createHash('sha256').update(text).digest('hex'),phases=[];
const receipt={schema:'SYNTHETIC_LONG_PREPARATIONS_RECEIPT_V1',scope:'SYNTHETIC_ONLY',runtime:process.version,
 production_rpc_calls:0,real_reviews:0,production_validation:false,phases};
const phase=async(name,work)=>{try{const facts=await work();phases.push({name,status:'PASS',facts});console.log('PASS '+name);}
 catch(error){phases.push({name,status:'FAIL',error:String(error)});throw error;}};
let f;
try{
 f=await createLongPreparationFixture();const {db}=f;let items,firstResult,originalEdition;
 const counts=async()=>{await db.exec('reset role');return (await db.query(`select
  (select count(*)::int from vnext_private.ai_price_calculation_inputs_v1) inputs,
  (select count(*)::int from vnext_private.ai_long_preparations_v1) preparations,
  (select count(*)::int from vnext_private.ai_price_plans_v1) plans,
  (select count(*)::int from vnext_private.ai_price_calculation_audits_v1) audits,
  (select count(*)::int from vnext_private.ai_price_plan_reviews_v1) reviews,
  (select count(*)::int from vnext_private.ai_price_plan_publication_events_v1) publications,
  (select count(*)::int from vnext_private.ai_price_work_results_v1) completions`)).rows[0];};
 const stage=items=>f.rpc('stage_daily_ai_long_preparations_batch_v1',{p_edition_id:f.editionId,p_items:items});
 const mutate=(item,edit)=>{
  const calculation=JSON.parse(item.calculation_text),preparation=JSON.parse(item.preparation_text);edit(calculation,preparation);
  const calculation_text=canonical(calculation),calculation_hash=sha(calculation_text);
  preparation.valuation_calculation.calculation_hash=calculation_hash;
  preparation.review_items.find(x=>x.kind==='VALUATION').calculation_hash=calculation_hash;
  const preparation_text=canonical(preparation);
  return {...item,calculation_text,calculation_hash,preparation_text,preparation_hash:sha(preparation_text)};
 };
 await phase('only service registers preparation and only Owner reads its exact stock',async()=>{
  const w=await f.load();assert.equal(w.inputs.length,0);assert.equal(w.profiles.length,2);
  assert(w.cards.filter(c=>c.horizon==='LONG').every(c=>c.status==='INSUFFICIENT'));
  await db.exec('reset role');originalEdition=(await db.query('select payload,created_at,cutoff,expires_at from vnext_private.ai_research_editions where id=$1',[f.editionId])).rows[0];
  for(const role of ['anon','authenticated']){
   await f.role(role);await assert.rejects(()=>db.query('select public.stage_daily_ai_long_preparations_batch_v1($1,$2)',[f.editionId,[]]),/permission denied/);
  }
  for(const role of ['anon','service_role']){await f.role(role);await assert.rejects(()=>f.readLongPreparation('1000'),/permission denied/);}
  for(const tier of ['free','premium']){await f.identity(tier);await assert.rejects(()=>f.readLongPreparation('1000'),/OWNER_REQUIRED/);}
  await f.identity('owner');assert.equal((await f.readLongPreparation('1000')).preparation,null);
  await assert.rejects(()=>f.readLongPreparation('9999'),/LONG_PREPARATION_SYMBOL/);
  for(const role of ['anon','authenticated','service_role']){
   await f.role(role);await assert.rejects(()=>db.query('select * from vnext_private.ai_long_preparations_v1'),/permission denied/);
   await assert.rejects(()=>db.query("select vnext_private.long_preparation_source_hash_v1('{}')"),/permission denied/);
  }
  await db.exec('reset role');const rls=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='vnext_private.ai_long_preparations_v1'::regclass")).rows[0];
  assert(rls.relrowsecurity&&rls.relforcerowsecurity);
  return {insufficient_long_cards:72,private_profiles:2,forced_rls:true,service_rpc_only:true,owner_only:true};
 });
 await phase('actual runner registers profiles then durable preparation survives a lost ACK without finish',async()=>{
  const calls=[];let atomicRollback=false;
  const rpc=async(name,args)=>{
   calls.push(name);
   if(name==='stage_daily_ai_long_preparations_batch_v1'){
    items=structuredClone(args.p_items);assert.equal(items.length,2);
    const broken=structuredClone(items);broken[1].preparation_hash='f'.repeat(64);
    await assert.rejects(()=>stage(broken),/LONG_PREPARATION_HASH/);assert.equal((await counts()).preparations,0);atomicRollback=true;
    const committed=await f.rpc(name,args);assert(committed.items.every(x=>x.replayed===false));
    throw Error('SYNTHETIC_RESPONSE_LOST_AFTER_COMMIT');
   }
   return f.rpc(name,args);
  };
  firstResult=await runDailyAiPriceWork({editionId:f.editionId,batchId:f.batchId,rpc,clock:()=>new Date().toISOString()});
  assert.equal(firstResult.long_review_preparations.state,'STAGE_OUTCOME_UNKNOWN');
  assert.equal(firstResult.completion.state,'DEFERRED');assert.equal(firstResult.completion.attempted,false);
  assert.equal(firstResult.counts.staged,0);assert.equal(firstResult.stage_attempted,false);
  assert.equal(firstResult.rows.find(r=>r.symbol==='1000'&&r.horizon==='LONG').state,'INELIGIBLE');
  assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1','get_daily_ai_price_work_v1','stage_daily_ai_long_preparations_batch_v1']);
  assert.deepEqual(await counts(),{inputs:2,preparations:2,plans:0,audits:0,reviews:0,publications:0,completions:0});
  return {actual_profile_writer:true,atomic_bad_second_item_rolled_back:atomicRollback,preparations_committed:2,
   lost_ack_did_not_finish:true,formal_price_plans:0,insufficient_card_preserved:true};
 });
 await phase('Owner reads the real current input, calculation and preparation with all hashes and pending verdicts',async()=>{
  await f.identity('owner');
  for(const symbol of ['1000','1001']){
   const result=await f.readLongPreparation(symbol),a=result.preparation;
   assert.equal(result.schema,'DAILY_AI_OWNER_LONG_PREPARATION_V1');assert.equal(result.subject_user_id,f.OWNER);
   assert.equal(result.edition_id,f.editionId);assert.equal(result.symbol,symbol);assert.equal(result.horizon,'LONG');
   assert.equal(result.research_only,true);assert.equal(result.preview_only,true);
   assert.deepEqual(Object.keys(a).sort(),['input_hash','input_text','calculation_hash','calculation_text','preparation_hash','preparation_text','recorded_at'].sort());
   for(const kind of ['input','calculation','preparation'])assert.equal(sha(a[kind+'_text']),a[kind+'_hash']);
   const input=JSON.parse(a.input_text),calculation=JSON.parse(a.calculation_text),prep=JSON.parse(a.preparation_text);
   assert.equal(input.as_of,calculation.as_of);assert.equal(prep.as_of,input.as_of);
   assert.equal(prep.valuation_calculation.calculation_hash,a.calculation_hash);assert.equal(prep.valuation_calculation.input_hash,a.input_hash);
   assert(prep.review_items.every(r=>r.review_status==='REVIEW_REQUIRED'&&r.verdict===null));
   assert.equal(prep.selection_qualified,false);assert.equal(prep.review,null);assert.equal(prep.member_published,false);
   assert(prep.missing.some(r=>r.code==='LONG_DEMAND_OBSERVATIONS_REQUIRED'));
   assert(Date.parse(a.recorded_at)>=Date.parse(calculation.as_of));
   if(symbol==='1000')assert.deepEqual(calculation.entry_range,[73.05,86.28]);
   const parsed=await parseDailyAiOwnerLongPreparation(result,{edition:f.edition,card:f.cards.find(c=>c.symbol===symbol&&c.horizon==='LONG')},f.OWNER,Date.now()+2);
   assert.equal(parsed.preparation.input_hash,a.input_hash);assert.equal(parsed.preparation.calculation_hash,a.calculation_hash);
   assert.equal(parsed.preparation.preparation_hash,a.preparation_hash);
  }
  assert.equal((await f.readOwnerPrices()).plans.length,0);
  await f.identity('premium');assert.deepEqual((await f.readMemberPrices()).plans,[]);
  return {exact_three_documents:true,pending_demand_moat_valuation:true,owner_can_inspect_initial_valuation:true,actual_browser_parser_verified:true,member_prices:0};
 });
 await phase('later cached invocation replays exact preparation hashes then confirms work completion',async()=>{
  const calls=[],rpc=async(name,args)=>{
   calls.push(name);if(name==='stage_daily_ai_long_preparations_batch_v1')assert.deepEqual(args.p_items,items);
   const r=await f.rpc(name,args);if(name==='stage_daily_ai_long_preparations_batch_v1')assert(r.items.every(x=>x.replayed));return r;
  };
  const result=await runDailyAiPriceWork({editionId:f.editionId,batchId:f.batchId,rpc,clock:()=>new Date().toISOString()});
  assert.equal(result.long_review_preparations.state,'STAGED_REVIEW_REQUIRED');assert.equal(result.completion.state,'CONFIRMED');
  assert.equal(result.counts.staged,0);assert.equal(result.rows.find(r=>r.symbol==='1000'&&r.horizon==='LONG').state,'INELIGIBLE');
  assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_long_preparations_batch_v1','finish_daily_ai_price_work_v1']);
  assert.deepEqual(await counts(),{inputs:2,preparations:2,plans:0,audits:0,reviews:0,publications:0,completions:1});
  await db.exec('reset role');assert.deepEqual((await db.query('select payload,created_at,cutoff,expires_at from vnext_private.ai_research_editions where id=$1',[f.editionId])).rows[0],originalEdition);
  return {cached_same_raw_bytes:true,no_duplicate_preparation:true,finish_after_confirmed_receipt:true,original_edition_unchanged:true};
 });
 await phase('hash, source, method, time and review injection cannot enter the preparation store',async()=>{
  const item=items.find(x=>JSON.parse(x.calculation_text).symbol==='1000');
  const mutations=[
   (c,p)=>{p.review={status:'PASS'};},(c,p)=>{p.selection_qualified=true;},(c,p)=>{p.member_published=true;},
   (c,p)=>{p.methodology_approved=true;},(c,p)=>{p.review_items[0].review_status='PASS';},(c,p)=>{p.review_items[1].verdict='SUPPORTED';},
   (c,p)=>{p.packet_hash='f'.repeat(64);},(c,p)=>{p.financial_observations.reported_eps.value=999;},
   (c,p)=>{p.price_observation.close=999;},(c,p)=>{p.review_items[0].evidence_ids=['not-in-original-packet'];},
   c=>{c.method_id='LONG_FCFE_DISCOUNT_SCENARIOS_V1';},c=>{c.evidence_bindings[0].evidence_hash='f'.repeat(64);},
   c=>{c.production_eligible=true;},c=>{c.review={status:'PASS'};},c=>{c.calculation_hash='f'.repeat(64);},
   (c,p)=>{p.preparation_hash='f'.repeat(64);},(c,p)=>{p.as_of=new Date(Date.parse(p.as_of)+1000).toISOString();},
   (c,p)=>{p.expires_at=new Date(Date.parse(p.expires_at)+1000).toISOString();},
  ];
  for(const edit of mutations)await assert.rejects(()=>stage([mutate(item,edit)]),/LONG_PREPARATION_/);
  await assert.rejects(()=>stage([{...item,calculation_hash:'f'.repeat(64)}]),/LONG_PREPARATION_HASH/);
  await assert.rejects(()=>stage([{...item,input_hash:'f'.repeat(64)}]),/LONG_PREPARATION_INPUT_SUPERSEDED/);
  await assert.rejects(()=>stage([item,item]),/LONG_PREPARATION_DUPLICATE/);
  await assert.rejects(()=>stage(Array.from({length:73},()=>item)),/LONG_PREPARATION_BOUNDS/);
  await assert.rejects(()=>f.rpc('stage_daily_ai_long_preparations_batch_v1',{p_edition_id:f.baseEditionId,p_items:[item]}),/LONG_PREPARATION_INPUT_SUPERSEDED/);
  const changed=mutate(item,(c,p)=>{p.limitations.push('A changed preparation must have a new explicitly registered input.');});
  await assert.rejects(()=>stage([changed]),/LONG_PREPARATION_REPLAY_CONFLICT/);
  assert.equal((await counts()).preparations,2);
  return {invalid_variants_rejected:mutations.length+6,raw_hashes_checked:true,full_source_hash_checked:true,no_pass_inserted:true,exact_replay_only:true};
 });
 await phase('new registered input hides old preparation and preserves calculation expiry while capping its review lifetime',async()=>{
  const w=await f.load(),old=w.inputs.find(i=>i.symbol==='1000'),input=JSON.parse(old.input_text);
  input.assumption_basis.description+=' New explicit private input revision.';
  input.expires_at=new Date(Date.parse(f.edition.expires_at)+3600000).toISOString();
  const text=canonical(input);await f.role('service_role');
  await db.query('select public.stage_daily_ai_price_calculation_input_v1($1,$2,$3)',[f.batchId,text,sha(text)]);
  await f.identity('owner');assert.equal((await f.readLongPreparation('1000')).preparation,null);
  const previous=items.find(x=>x.input_hash===old.input_hash);await assert.rejects(()=>stage([previous]),/LONG_PREPARATION_INPUT_SUPERSEDED/);
  const prepared=await prepareDailyAiLongReviewWork(await f.load(),{now:Date.now()+2});
  const next=prepared.stage_request.args.p_items.find(i=>JSON.parse(i.calculation_text).symbol==='1000');assert(next);
  const calc=JSON.parse(next.calculation_text),prep=JSON.parse(next.preparation_text);
  assert.equal(calc.expires_at,input.expires_at);assert.equal(Date.parse(prep.expires_at),Date.parse(f.edition.expires_at));
  await stage([next]);await f.identity('owner');const owner=await f.readLongPreparation('1000');assert.equal(owner.preparation.input_hash,sha(text));
  assert.notEqual(owner.preparation.preparation_hash,previous.preparation_hash);
  await db.exec('reset role');
  await assert.rejects(()=>db.query("update vnext_private.ai_long_preparations_v1 set symbol=symbol"),/IMMUTABLE/);
  await assert.rejects(()=>db.query('delete from vnext_private.ai_long_preparations_v1'),/IMMUTABLE/);
  assert.deepEqual(await counts(),{inputs:3,preparations:3,plans:0,audits:0,reviews:0,publications:0,completions:1});
  return {latest_input_only:true,no_old_preparation_fallback:true,input_time_unchanged:true,review_expiry_capped_to_edition:true,immutable_even_to_table_owner:true};
 });
 receipt.ok=true;
}catch(error){receipt.ok=false;receipt.error=String(error);console.error(error);process.exitCode=1;}
finally{if(f)await f.close();receipt.finished_at=new Date().toISOString();if(output)writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');}
