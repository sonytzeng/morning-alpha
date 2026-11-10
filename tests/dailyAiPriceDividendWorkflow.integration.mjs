// Synthetic sources and policy only. A new immutable batch is created before
// any calculation input; no evidence is appended to an existing edition.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createCalculatedPriceFixture} from './helpers/dailyAiCalculatedPriceFixture.mjs';
import {buildDailyAiActualPriceInput} from '../research/daily-ai-financial-inputs.ts';
import {LONG_EPS_DIVIDEND_METHOD} from '../research/daily-ai-price-calculation.ts';
import {runDailyAiPriceWork} from '../research/daily-ai-price-work.mjs';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_DIVIDEND_WORKFLOW_TEST');};
const output=process.env.MA_PRICE_DIVIDEND_RECEIPT;
if(output&&!isAbsolute(output))throw Error('ABSOLUTE_RECEIPT_PATH_REQUIRED');
const sha=text=>createHash('sha256').update(text).digest('hex'),phases=[];
const receipt={schema:'SYNTHETIC_PRICE_DIVIDEND_WORKFLOW_RECEIPT_V1',scope:'SYNTHETIC_ONLY',runtime:process.version,
 production_rpc_calls:0,real_reviews:0,production_validation:false,phases};
const phase=async(name,work)=>{try{const facts=await work();phases.push({name,status:'PASS',facts});console.log('PASS '+name);}
 catch(error){phases.push({name,status:'FAIL',error:String(error)});throw error;}};
let f;
try{
 f=await createCalculatedPriceFixture();const {db}=f;
 await db.exec('reset role');
 const packets=structuredClone(f.packets),packet=packets.find(p=>p.symbol==='1000');
 const source=packet.evidence.find(e=>e.kind==='FINANCIAL');
 const date=new Date(f.through+'T00:00:00Z'),end=new Date(Date.UTC(date.getUTCFullYear(),Math.floor(date.getUTCMonth()/3)*3,0));
 const latestStartMonth=Math.floor(end.getUTCMonth()/3)*3;
 const quarters=Array.from({length:4},(_,i)=>new Date(Date.UTC(end.getUTCFullYear(),latestStartMonth-9+i*3,1)));
 const earningsPeriod={start:quarters[0].toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
 const eps=quarters.map((q,i)=>({...source,id:'SYNTH-DIVIDEND-EPS-'+i,content:JSON.stringify({kind:'EPS',
  period:q.getUTCFullYear()+'-Q'+(Math.floor(q.getUTCMonth()/3)+1),basis:'SINGLE_QUARTER',
  values:{value:2.5,reported_decimal:'2.50',unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED',consolidation:'CONSOLIDATED'}})}));
 packet.evidence.push(...eps);
 const originalJobs=(await db.query('select symbol,result from vnext_runtime.ai_stock_jobs')).rows;
 const packet_texts={},packet_hashes={},jobs=[],revision='synthetic-dividend-terminal-pe-workflow-v1';
 for(const p of packets){
  packet_texts[p.symbol]=canonical(p);packet_hashes[p.symbol]=await snapshotHash(p);
  const id=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:packet_hashes[p.symbol],model_revision:revision});jobs.push(id);
  const result=structuredClone(originalJobs.find(j=>j.symbol===p.symbol).result);
  result.input_hash=packet_hashes[p.symbol];result.receipt.model=revision;
  result.sources=p.evidence.map(({content,...s})=>s);
  await db.query(`insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result)
   values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),now()+interval '1 minute',$6)`,
   [id,packet_hashes[p.symbol],revision,p.symbol,p.cutoff,result]);
 }
 const batchBody={schema:'DAILY_AI_BATCH_INPUT_V1',cutoff:f.cutoff,through:f.through,packet_texts,packet_hashes,gaps:[]};
 const batchId=await snapshotHash(batchBody);await f.role('service_role');
 await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[canonical(batchBody),batchId]);
 const editionId=(await db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) r',[batchId,jobs,f.expiry])).rows[0].r.edition_id;
 await db.exec('reset role');await db.exec(readFileSync(new URL('../research/daily-ai-price-workflow.candidate.sql',import.meta.url),'utf8'));
 const profileStage=async profile=>{const text=canonical(profile);await f.role('service_role');
  return (await db.query('select public.stage_daily_ai_price_profile_v1($1,$2) r',[text,sha(text)])).rows[0].r;};
 const inputStage=async input=>{const text=canonical(input);await f.role('service_role');
  return (await db.query('select public.stage_daily_ai_price_calculation_input_v1($1,$2,$3) r',[batchId,text,sha(text)])).rows[0].r;};
 const policy={schema:'DAILY_AI_ACTUAL_PRICE_POLICY_V1',version:'SYNTHETIC_ONLY_DIVIDEND_POLICY',symbol:'1000',horizon:'LONG',
  method_id:LONG_EPS_DIVIDEND_METHOD,formed_at:new Date(Date.now()-500).toISOString(),
  description:'Synthetic arithmetic policy; these growth, payout, return and multiples are not a stock recommendation or approved method.',
  evidence_ids:eps.map(e=>e.id),earnings_period:earningsPeriod,entry_scenarios:['conservative','base'],margin_of_safety:.2,
  invalidation:'合成財務觀察或固定假設改變時重新審查。',
  scenarios:['conservative','base','upside'].map((name,i)=>({name,eps_growth_rates:[0,0],payout_ratios:[.5,.5],required_return:.1,terminal_pe:10+2*i}))};
 const built=await buildDailyAiActualPriceInput({packet,as_of:new Date(Date.now()-10).toISOString(),expires_at:f.expiry,policy});
 assert.equal(built.status,'INPUT_READY_REVIEW_REQUIRED');
 const input=built.calculation_input,profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',
  symbol:input.symbol,horizon:input.horizon,method_id:input.method_id,created_at:new Date(Date.now()-1).toISOString(),
  valid_until:f.expiry,revision_note:'Synthetic fixed dividend/terminal PE assumptions for SQL integration only.',template_input:input};
 await phase('new long method registers exact historical EPS profile while FCFE remains accepted',async()=>{
  const stored=await profileStage(profile);assert.equal(stored.methodology_approved,undefined);assert.equal(stored.member_published,false);
  const oldInput=(await f.producerInput('1001','LONG')).calculation_input;
  oldInput.as_of=new Date(Date.now()-10).toISOString();
  const oldProfile={...profile,symbol:'1001',method_id:oldInput.method_id,created_at:new Date(Date.now()-1).toISOString(),template_input:oldInput};
  await profileStage(oldProfile);
  const invalid=[];
  for(const edit of [p=>{p.template_input.parameters.earnings_basis='FORWARD_12_MONTH_DILUTED_EPS';},
   p=>{p.template_input.parameters.earnings_period.approved=true;},
   p=>{p.template_input.parameters.scenarios[0].payout_ratios=['.5','.5'];},
   p=>{p.template_input.parameters.scenarios[0].terminal={next_fcfe:10,growth:0};},
   p=>{p.method_id='LONG_FCFE_DISCOUNT_SCENARIOS_V1';},
   p=>{p.horizon='MEDIUM';p.template_input.horizon='MEDIUM';}]){const p=structuredClone(profile);edit(p);invalid.push(p);}
  for(const p of invalid)await assert.rejects(()=>profileStage(p),/PRICE_PROFILE_/);
  const malformed=structuredClone(input);malformed.parameters.scenarios[0].payout_ratios=[.5];
  await assert.rejects(()=>inputStage(malformed),/PRICE_INPUT_PARAMETERS/);
  return {new_dividend_profile:true,existing_fcfe_profile:true,invalid_shapes_rejected:invalid.length+1,approval_created:false};
 });
 await phase('real runner binds profile, computes discounted dividends and stages immutable audit with replay',async()=>{
  const calls=[],rpc=async(name,a)=>{
   calls.push(name);await f.role('service_role');let query,args;
   if(name==='get_daily_ai_price_work_v1'){query='select public.get_daily_ai_price_work_v1($1) r';args=[a.p_edition_id];}
   else if(name==='stage_daily_ai_price_inputs_batch_v1'){query='select public.stage_daily_ai_price_inputs_batch_v1($1,$2) r';args=[a.p_batch_id,a.p_items];}
   else if(name==='stage_daily_ai_price_work_batch_v1'){query='select public.stage_daily_ai_price_work_batch_v1($1,$2) r';args=[a.p_edition_id,a.p_items];}
   else if(name==='finish_daily_ai_price_work_v1'){query='select public.finish_daily_ai_price_work_v1($1,$2,$3,$4) r';args=[a.p_edition_id,a.p_work_key,a.p_result_text,a.p_result_hash];}
   else throw Error('UNEXPECTED_DIVIDEND_WORK_RPC');
   return (await db.query(query,args)).rows[0].r;
  };
  const result=await runDailyAiPriceWork({editionId,batchId,rpc,clock:()=>new Date().toISOString()});
  assert.equal(result.counts.staged,2);assert.equal(result.completion.state,'CONFIRMED');
  assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1','get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
  await db.exec('reset role');
  const rows=(await db.query(`select a.calculation,a.input_hash,a.review_request,p.body from vnext_private.ai_price_calculation_audits_v1 a
   join vnext_private.ai_price_plans_v1 p using(plan_hash) where a.edition_id=$1`,[editionId])).rows;
  const actual=rows.find(r=>r.body.symbol==='1000');
  assert.equal(actual.calculation.method_id,LONG_EPS_DIVIDEND_METHOD);assert.deepEqual(actual.body.entry_range,[73.05,86.28]);
  assert.equal(actual.calculation.trace.reported_eps_sum.value,10);assert.equal(actual.review_request.status,'PENDING');
  assert.equal(actual.review_request.methodology_approved,false);assert.equal(actual.body.buy_ready,false);
  const replay=await runDailyAiPriceWork({editionId,batchId,rpc,clock:()=>new Date().toISOString()});
  assert.equal(replay.counts.staged,2);assert.equal(replay.completion.state,'CONFIRMED');assert.equal(replay.completion.replayed,true);
  await db.exec('reset role');
  const counts=(await db.query(`select (select count(*)::int from vnext_private.ai_price_calculation_audits_v1) audits,
   (select count(*)::int from vnext_private.ai_price_plan_reviews_v1) reviews,
   (select count(*)::int from vnext_private.ai_price_plan_publication_events_v1) publications`)).rows[0];
  assert.deepEqual(counts,{audits:2,reviews:0,publications:0});
  return {reported_eps_sum:10,dividend_entry_range:actual.body.entry_range,fcfe_still_staged:true,replay_without_duplicate_audit:true,...counts};
 });
 receipt.ok=true;
}catch(error){receipt.ok=false;receipt.error=String(error);console.error(error);process.exitCode=1;}
finally{if(f)await f.close();receipt.finished_at=new Date().toISOString();if(output)writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');}
