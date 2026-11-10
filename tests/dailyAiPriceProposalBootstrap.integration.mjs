// Isolated first-run check with synthetic 2330 financials. The actual versioned
// internal policy proposes assumptions; no review, stock qualification or
// source permission is manufactured. No network or production write occurs.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createLongPreparationFixture} from './helpers/dailyAiLongPreparationFixture.mjs';
import {runDailyAiPriceWork} from '../research/daily-ai-price-work.mjs';
import {VALUATION_PROPOSAL_VERSION} from '../research/daily-ai-valuation-policy-proposal.ts';
import {parseDailyAiOwnerLongPreparation} from '../src/features/vnext/dailyAiOwnerLongPreparation.ts';
import {parseDailyAiOwnerPricePlans} from '../src/features/vnext/dailyAiOwnerPricePlans.ts';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_PRICE_PROPOSAL_BOOTSTRAP_TEST');};
const output=process.env.MA_PRICE_PROPOSAL_BOOTSTRAP_RECEIPT;
if(output&&!isAbsolute(output))throw Error('ABSOLUTE_RECEIPT_PATH_REQUIRED');
const receipt={schema:'SYNTHETIC_PRICE_PROPOSAL_BOOTSTRAP_RECEIPT_V1',scope:'SYNTHETIC_ONLY',runtime:process.version,
 production_rpc_calls:0,real_reviews:0,production_validation:false,phases:[]};
let f;
try{
 f=await createLongPreparationFixture({proposalSymbol:'2330',registerProfiles:false});const {db}=f;
 const counts=async()=>{await db.exec('reset role');return (await db.query(`select
  (select count(*)::int from vnext_private.ai_price_calculation_inputs_v1) inputs,
  (select count(*)::int from vnext_private.ai_price_profiles_v1) profiles,
  (select count(*)::int from vnext_private.ai_price_plans_v1) plans,
  (select count(*)::int from vnext_private.ai_price_calculation_audits_v1) audits,
  (select count(*)::int from vnext_private.ai_long_preparations_v1) preparations,
  (select count(*)::int from vnext_private.ai_price_plan_reviews_v1) reviews,
  (select count(*)::int from vnext_private.ai_price_plan_publication_events_v1) publications,
  (select count(*)::int from vnext_private.ai_price_work_results_v1) completions`)).rows[0];};
 const initial=await f.load();assert.deepEqual(initial.inputs,[]);assert.deepEqual(initial.profiles,[]);
 assert.equal(initial.cards.find(c=>c.symbol==='2330'&&c.horizon==='MEDIUM').status,'WAIT');
 assert.equal(initial.cards.find(c=>c.symbol==='2330'&&c.horizon==='LONG').status,'INSUFFICIENT');
 assert.deepEqual(await counts(),{inputs:0,profiles:0,plans:0,audits:0,preparations:0,reviews:0,publications:0,completions:0});
 await db.exec('reset role');const originalEdition=(await db.query('select payload,created_at,cutoff,expires_at from vnext_private.ai_research_editions where id=$1',[f.editionId])).rows[0];
 const calls=[],responses=[];
 const rpc=async(name,args)=>{calls.push(name);const response=await f.rpc(name,args);responses.push({name,response});return response;};
 const first=await runDailyAiPriceWork({editionId:f.editionId,batchId:f.batchId,rpc,clock:()=>new Date().toISOString()});
 assert.equal(first.input_work.counts.proposal_inputs,2);assert.equal(first.counts.staged,1);
 assert.equal(first.long_review_preparations.state,'STAGED_REVIEW_REQUIRED');assert.equal(first.completion.state,'CONFIRMED');
 assert.equal(first.rows.find(r=>r.symbol==='2330'&&r.horizon==='LONG').state,'INELIGIBLE');
 const proposals=first.input_work.rows.filter(r=>r.parameter_source==='EXPLICIT_INTERNAL_RESEARCH_PROPOSAL');
 assert.equal(proposals.length,2);assert(proposals.every(r=>r.symbol==='2330'&&r.methodology_approved===false&&r.proposal_version===VALUATION_PROPOSAL_VERSION));
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1','get_daily_ai_price_work_v1',
  'stage_daily_ai_long_preparations_batch_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
 const current=await f.load();assert.equal(current.inputs.length,2);assert.deepEqual(current.profiles,[]);
 assert(current.inputs.every(i=>i.symbol==='2330'));assert(current.inputs.every(i=>i.horizon==='MEDIUM'||i.horizon==='LONG'));
 assert.notEqual(current.work_key,initial.work_key);
 for(const row of current.inputs){const input=JSON.parse(row.input_text);
  assert.equal(input.parameters.earnings_basis,'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM');assert.equal(input.parameters.margin_of_safety,.25);
  assert(input.assumption_basis.description.includes('Review proposal'));
 }
 assert.equal(first.rows.find(r=>r.symbol==='1001'&&r.horizon==='MEDIUM').state,'METHOD_INPUT_REQUIRED');
 await f.identity('owner');
 const ownerPlans=await parseDailyAiOwnerPricePlans(await f.readOwnerPrices(),f.editionId,f.OWNER,Date.now()+2);
 assert.equal(ownerPlans.plans.length,1);const plan=ownerPlans.plans[0];
 assert.equal(plan.body.symbol,'2330');assert.equal(plan.body.horizon,'MEDIUM');assert.deepEqual(plan.body.entry_range,[120,150]);
 assert.equal(plan.review,null);assert.equal(plan.publication,null);assert.equal(plan.can_approve,false);assert.equal(plan.body.buy_ready,false);
 const longResponse=await f.readLongPreparation('2330');
 const long=await parseDailyAiOwnerLongPreparation(longResponse,{edition:f.edition,card:f.cards.find(c=>c.symbol==='2330'&&c.horizon==='LONG')},f.OWNER,Date.now()+2);
 assert.equal(long.preparation.calculation.method_id,'LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1');
 assert(long.preparation.review_items.every(r=>['DEMAND','MOAT','VALUATION'].includes(r.kind)));
 const longRaw=JSON.parse(longResponse.preparation.preparation_text);assert.equal(longRaw.selection_qualified,false);assert.equal(longRaw.review,null);
 assert.equal(longRaw.methodology_approved,false);assert.equal(longRaw.member_published,false);
 const longInput=JSON.parse(current.inputs.find(i=>i.horizon==='LONG').input_text);
 const independentlyDiscounted=longInput.parameters.scenarios.slice(0,2).map(s=>{
  let eps=10,value=0;
  for(let year=0;year<s.eps_growth_rates.length;year++){
   eps*=1+s.eps_growth_rates[year];value+=eps*s.payout_ratios[year]/(1+s.required_return)**(year+1);
  }
  value+=eps*s.terminal_pe/(1+s.required_return)**s.eps_growth_rates.length;
  return Math.floor(value*(1-longInput.parameters.margin_of_safety)*100)/100;
 });
 assert.deepEqual(long.preparation.calculation.entry_range,independentlyDiscounted);
 const beforeReplay={inputs:current.inputs.map(i=>({input_hash:i.input_hash,input_text:i.input_text})),
  plan_hash:plan.plan_hash,long_hash:long.preparation.preparation_hash,calculation_hash:long.preparation.calculation_hash};
 const beforeCounts=await counts();assert.deepEqual(beforeCounts,{inputs:2,profiles:0,plans:1,audits:1,preparations:1,reviews:0,publications:0,completions:1});
 calls.length=0;responses.length=0;
 const cached=await runDailyAiPriceWork({editionId:f.editionId,batchId:f.batchId,rpc,clock:()=>new Date().toISOString()});
 assert.equal(cached.counts.staged,1);assert.equal(cached.input_work.counts.proposal_inputs,0);assert.equal(cached.input_work.counts.already_registered,2);
 assert.equal(cached.completion.state,'CONFIRMED');assert.equal(cached.completion.replayed,true);
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_long_preparations_batch_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
 for(const r of responses.filter(r=>r.name.startsWith('stage_')))assert(r.response.items.every(i=>i.replayed));
 const after=await f.load();assert.deepEqual(after.inputs.map(i=>({input_hash:i.input_hash,input_text:i.input_text})),beforeReplay.inputs);
 await f.identity('owner');assert.equal((await f.readOwnerPrices()).plans[0].plan_hash,beforeReplay.plan_hash);
 const afterLong=await f.readLongPreparation('2330');assert.equal(afterLong.preparation.preparation_hash,beforeReplay.long_hash);
 assert.equal(afterLong.preparation.calculation_hash,beforeReplay.calculation_hash);
 await f.identity('premium');assert.deepEqual((await f.readMemberPrices()).plans,[]);
 assert.deepEqual(await counts(),beforeCounts);
 await db.exec('reset role');assert.deepEqual((await db.query('select payload,created_at,cutoff,expires_at from vnext_private.ai_research_editions where id=$1',[f.editionId])).rows[0],originalEdition);
 const facts={zero_initial_inputs_and_profiles:true,policy_version:VALUATION_PROPOSAL_VERSION,proposal_symbol_only:'2330',
  observed_four_quarter_eps_sum:10,medium_entry_range:plan.body.entry_range,long_entry_range:independentlyDiscounted,
  registered_inputs:2,pending_medium_plans:1,private_long_preparations:1,long_card_still_insufficient:true,
  owner_parser_verified:true,finish_confirmed:true,cached_same_hashes:true,profile_count:0,price_reviews:0,price_publications:0,
  member_prices:0,original_edition_unchanged:true};
 receipt.phases.push({name:'zero registries produce first private 2330 valuation material through the actual runner and replay unchanged',status:'PASS',facts});
 receipt.ok=true;console.log('PASS first-run 2330 proposal → registered inputs → pending MEDIUM plan and LONG preparation → finish → exact CACHED replay');
}catch(error){receipt.ok=false;receipt.error=String(error);receipt.phases.push({name:'first-run proposal SQL integration',status:'FAIL',error:String(error)});console.error(error);process.exitCode=1;}
finally{if(f)await f.close();receipt.finished_at=new Date().toISOString();if(output)writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');}
