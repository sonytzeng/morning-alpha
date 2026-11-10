// Synthetic contract fixtures, actual calculator/producer/daily draft handler.
// Only the database transport is injected; no remote request is made.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {prepareDailyAiPriceWork,prepareDailyAiProfileInputs,prepareDailyAiLongReviewWork,runDailyAiPriceWork} from '../research/daily-ai-price-work.mjs';
import {handleZeroPaidStockDraft} from '../supabase/functions/daily-stock-analysis-v1/zero-paid-draft.ts';
import {AUTHOR_VERSION} from '../research/daily-ai-zero-paid-author.mjs';
import {calculateSavedDailyPrices} from '../scripts/operations/calculate-daily-prices.mjs';
import {deriveDailyAiFinancialActuals} from '../research/daily-ai-financial-inputs.ts';

const now=Date.parse('2026-11-10T00:10:00Z'),cutoff='2026-11-10T00:00:00Z',through='2026-11-09';
const batchId='b'.repeat(64),editionId='e'.repeat(64),internalSecret='synthetic-worker-test-secret-000000';
const sha=text=>createHash('sha256').update(text).digest('hex');
async function fixture(){
 const packets=Array.from({length:72},(_,n)=>{
  const symbol=String(1000+n),source={symbol,published_at:'2026-11-09T07:00:00Z',available_at:'2026-11-09T09:00:00Z',
   first_seen_at:'2026-11-09T09:00:00Z',as_of:through+'T13:30:00+08:00',time_basis:'PUBLISHED',evidence_hash:'d'.repeat(64)};
  return {symbol,company:'Synthetic company '+n,cutoff,data_through:through,evidence:[
   {...source,id:'P'+n,kind:'PRICE',source:'https://www.twse.com.tw/synthetic-work-price',
    content:JSON.stringify({date:through,open:100,high:102,low:99,close:101,volume:1000000,amount:101000000,session_scope:'SYNTHETIC_COMPLETE'})},
   {...source,id:'F'+n,kind:'FINANCIAL',source:'https://www.twse.com.tw/synthetic-work-financial',
    content:JSON.stringify({kind:'EPS_AS_REPORTED',period:'2026-Q3',basis:'AS_REPORTED',values:{value:10,unit:'TWD_PER_COMMON_SHARE'}})},
  ]};
 });
 const edition={id:editionId,evidence_cutoff:cutoff,prepared_at:'2026-11-10T00:02:00Z',expires_at:'2026-11-10T05:30:00Z',data_through:through};
 const cards=packets.flatMap(p=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:p.symbol,company:p.company,horizon,status:'WAIT'})));
 const inputs=[];
 for(let n=0;n<2;n++){
  const input={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol:packets[n].symbol,horizon:'MEDIUM',cutoff,data_through:through,
   as_of:'2026-11-10T00:05:00Z',expires_at:edition.expires_at,currency:'TWD',method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',
   quote_evidence_id:'P'+n,evidence:structuredClone(packets[n].evidence),
   assumption_basis:{available_at:'2026-11-09T10:00:00Z',description:'Explicit synthetic forecasts only; not company guidance.',evidence_ids:['F'+n]},
   invalidation:'Stop and reassess when the documented earnings or dilution basis changes.',
   parameters:{earnings_basis:'FORWARD_12_MONTH_DILUTED_EPS',forecast_period:{start:'2026-11-11',end:'2027-11-10'},
    dilution_basis:{description:'Synthetic diluted common-share basis.',evidence_ids:['F'+n]},
    scenarios:[{name:'conservative',eps:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:12,pe:14}],
    entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F'+n]}};
  const input_text=canonical(input);inputs.push({registration_id:n+1,input_hash:sha(input_text),input_text,symbol:input.symbol,horizon:input.horizon});
 }
 return {schema:'DAILY_AI_PRICE_WORK_V1',batch_id:batchId,edition,packets,cards,inputs,member_published:false,review_required:true};
}
const staged=args=>({schema:'DAILY_AI_PRICE_WORK_BATCH_STAGED_V1',edition_id:args.p_edition_id,review_required:true,member_published:false,
 items:args.p_items.map(item=>({plan_hash:item.plan_hash,input_hash:item.input_hash,calculation_hash:item.calculation_hash,
  method_note_hash:item.method_note_hash,review_request_hash:sha(item.review_request_text),replayed:false,review_required:true,member_published:false}))});

async function profileFixture(){
 const work=await fixture();
 work.profiles=work.inputs.map((row,n)=>{
  const template=JSON.parse(row.input_text),profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',
   symbol:row.symbol,horizon:row.horizon,method_id:template.method_id,created_at:'2026-11-10T00:06:00Z',valid_until:'2026-11-20T05:30:00Z',
   revision_note:'Synthetic reusable method profile; independent review is pending.',template_input:template};
  const profile_text=canonical(profile);
  return {registration_id:n+1,profile_text,profile_hash:sha(profile_text),symbol:row.symbol,horizon:row.horizon};
 });
 work.inputs=[];return work;
}
const registerInputs=(work,args)=>{
 const items=args.p_items.map((item,n)=>{
  const input=JSON.parse(item.input_text),row={...item,symbol:input.symbol,horizon:input.horizon,registration_id:n+101};
  work.inputs.push(row);
  return {schema:'DAILY_AI_PRICE_CALCULATION_INPUT_STAGED_V1',batch_id:args.p_batch_id,input_hash:item.input_hash,
   symbol:input.symbol,horizon:input.horizon,registration_id:row.registration_id,registered:true,review_required:true,member_published:false};
 });
 return {schema:'DAILY_AI_PRICE_INPUTS_BATCH_STAGED_V1',batch_id:args.p_batch_id,items,review_required:true,member_published:false};
};

test('daily profiles create explicit inputs, confirm their registration, reload and calculate; cached work retains the same hashes',async()=>{
 const work=await profileFixture(),calls=[],stageHashes=[];
 const rpc=async(name,args)=>{
  calls.push(name);
  if(name==='get_daily_ai_price_work_v1')return work;
  if(name==='stage_daily_ai_price_inputs_batch_v1')return registerInputs(work,args);
  assert.equal(name,'stage_daily_ai_price_work_batch_v1');stageHashes.push(args.p_items.map(item=>item.plan_hash));return staged(args);
 };
 const first=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1','get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1']);
 assert.equal(first.input_work.registered,2);assert.equal(first.input_work.state,'INPUTS_REGISTERED_REVIEW_REQUIRED');
 assert.equal(first.counts.staged,2);assert.equal(first.member_published,false);assert.equal(work.inputs.length,2);
 assert.equal(JSON.parse(work.inputs[0].input_text).as_of,new Date(now).toISOString());
 calls.length=0;
 const cached=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now+1000).toISOString(),rpc});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1']);
 assert.equal(cached.input_work.registration_attempted,false);assert.equal(cached.input_work.counts.already_registered,2);
 assert.deepEqual(stageHashes[0],stageHashes[1]);assert.equal(work.inputs.length,2);
});

test('existing inputs win and an expired profile reports its exact repair requirement without stopping another stock',async()=>{
 const work=await profileFixture(),existing=await fixture();work.inputs=[existing.inputs[0]];
 const expired=JSON.parse(work.profiles[1].profile_text);expired.valid_until=new Date(now).toISOString();
 work.profiles[1].profile_text=canonical(expired);work.profiles[1].profile_hash=sha(work.profiles[1].profile_text);
 const before=structuredClone(work),pure=await prepareDailyAiProfileInputs(work,{now});
 assert.deepEqual(work,before);assert.equal(pure.registration_request.args.p_items.length,0);
 assert.equal(pure.counts.already_registered,1);assert.equal(pure.counts.method_updates,1);
 const calls=[];
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);if(name==='get_daily_ai_price_work_v1')return work;assert.equal(name,'stage_daily_ai_price_work_batch_v1');return staged(args);
 }});
 assert.equal(result.counts.staged,1);assert.equal(result.rows.find(row=>row.symbol==='1001'&&row.horizon==='MEDIUM').reason,'PROFILE_EXPIRED');
 assert(!calls.includes('stage_daily_ai_price_inputs_batch_v1'));
});

test('unconfirmed input registration never reaches a price write or retries even if the database may have accepted it',async()=>{
 const work=await profileFixture(),calls=[];
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);if(name==='get_daily_ai_price_work_v1')return work;
  assert.equal(name,'stage_daily_ai_price_inputs_batch_v1');const receipt=registerInputs(work,args);receipt.items[0].input_hash='a'.repeat(64);return receipt;
 }});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1']);
 assert.equal(result.state,'INPUT_REGISTRATION_OUTCOME_UNKNOWN');assert.equal(result.stage_attempted,false);
 assert.equal(result.input_work.registration_attempted,true);assert.equal(result.input_work.registered,0);
});

test('confirmed inputs remain confirmed when readback fails, and no hypothetical registration is used for calculation',async()=>{
 const work=await profileFixture(),calls=[];let reads=0;
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);if(name==='get_daily_ai_price_work_v1'){if(++reads>1)throw Error('synthetic readback failure');return work;}
  assert.equal(name,'stage_daily_ai_price_inputs_batch_v1');return registerInputs(work,args);
 }});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1','get_daily_ai_price_work_v1']);
 assert.equal(result.state,'INPUTS_REGISTERED_PRICE_WORK_DEFERRED');assert.equal(result.input_work.registered,2);
 assert.equal(result.input_work.state,'INPUTS_REGISTERED_REVIEW_REQUIRED');assert.equal(result.stage_attempted,false);
});

test('daily work computes selected stocks and keeps missing methods separate; full audit hashes are reproducible',async()=>{
 const work=await fixture(),before=structuredClone(work),result=await prepareDailyAiPriceWork(work,{now});
 assert.deepEqual(work,before);assert.equal(result.summary.counts.calculated,2);assert.equal(result.summary.counts.missing_inputs,214);
 assert.equal(result.review_packets.length,2);assert.equal(result.stage_request.args.p_items.length,2);
 for(const item of result.stage_request.args.p_items){
  assert.deepEqual(JSON.parse(item.body_text).entry_range,[64,96]);
  assert.equal(item.calculation_hash,sha(item.calculation_text));assert.equal(item.method_note_hash,sha(item.method_note_text));
  assert.equal(JSON.parse(item.review_request_text).review,null);
  assert.equal(JSON.parse(item.calculation_text).production_eligible,false);
 }
});

test('one invalid explicit input does not stop another stock; an insufficient card is not upgraded',async()=>{
 const work=await fixture(),input=JSON.parse(work.inputs[0].input_text);input.parameters.scenarios[0].eps=null;
 work.inputs[0].input_text=canonical(input);work.inputs[0].input_hash=sha(work.inputs[0].input_text);
 work.cards.find(c=>c.symbol==='1001'&&c.horizon==='LONG').status='INSUFFICIENT';
 const result=await prepareDailyAiPriceWork(work,{now});
 assert.equal(result.summary.counts.calculated,1);assert.equal(result.summary.counts.invalid+result.summary.counts.ineligible,2);
 assert.equal(result.stage_request.args.p_items.length,1);assert.equal(JSON.parse(result.stage_request.args.p_items[0].body_text).symbol,'1001');
 assert.equal(result.summary.rows.find(r=>r.symbol==='1001'&&r.horizon==='LONG').state,'INELIGIBLE');
});

test('tampered registry bytes and wrong batch/edition stop before any database mutation',async()=>{
 const work=await fixture();work.inputs[0].input_text+=' ';
 await assert.rejects(()=>prepareDailyAiPriceWork(work,{now}),/PRICE_WORK_INPUT_HASH/);
 for(const mutate of [w=>{w.edition.id='f'.repeat(64);},w=>{w.batch_id='f'.repeat(64);}]){
  const other=await fixture();mutate(other);const calls=[];
  const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name)=>{calls.push(name);return other;}});
  assert.equal(result.state,'PRICE_WORKFLOW_UNAVAILABLE');assert.equal(result.stage_attempted,false);assert.equal(calls.length,1);
 }
});

test('all calculated plans and audits cross one atomic RPC, with no review or publication calls',async()=>{
 const work=await fixture(),calls=[];
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);if(name==='get_daily_ai_price_work_v1')return work;
  assert.equal(name,'stage_daily_ai_price_work_batch_v1');assert.equal(args.p_items.length,2);return staged(args);
 }});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1']);
 assert.equal(result.state,'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED');assert.equal(result.counts.staged,2);
 assert.equal(result.member_published,false);assert.equal(result.review_required,true);
});

test('write uncertainty is kept distinct and never retried; empty method registry never writes',async()=>{
 const work=await fixture();let writes=0;
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  if(name==='get_daily_ai_price_work_v1')return work;writes++;const receipt=staged(args);receipt.items[0].plan_hash='a'.repeat(64);return receipt;
 }});
 assert.equal(writes,1);assert.equal(result.state,'STAGE_OUTCOME_UNKNOWN');assert.equal(result.counts.staged,0);
 work.inputs=[];
 const empty=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async name=>{
  assert.equal(name,'get_daily_ai_price_work_v1');return work;
 }});
 assert.equal(empty.state,'METHOD_INPUTS_REQUIRED');assert.equal(empty.stage_attempted,false);
});

const finished=args=>({schema:'DAILY_AI_PRICE_WORK_FINISHED_V1',edition_id:args.p_edition_id,
 work_key:args.p_work_key,result_hash:args.p_result_hash,replayed:false,member_published:false,review_required:true});

test('confirmed prices checkpoint the latest registered-input work key and exact terminal result',async()=>{
 const work=await profileFixture(),calls=[];work.work_key='1'.repeat(64);
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);
  if(name==='get_daily_ai_price_work_v1')return work;
  if(name==='stage_daily_ai_price_inputs_batch_v1'){
   const receipt=registerInputs(work,args);work.work_key='2'.repeat(64);return receipt;
  }
  if(name==='stage_daily_ai_price_work_batch_v1')return staged(args);
  assert.equal(name,'finish_daily_ai_price_work_v1');assert.equal(args.p_work_key,work.work_key);
  assert.equal(sha(args.p_result_text),args.p_result_hash);
  const body=JSON.parse(args.p_result_text);
  assert.equal(body.state,'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED');assert.equal(body.counts.staged,2);
  assert.equal(body.rows.filter(r=>r.state==='STAGED_REVIEW_REQUIRED').length,2);
  assert.equal(body.input_work.registered,2);assert.equal(body.member_published,false);
  return finished(args);
 }});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1',
  'get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1','finish_daily_ai_price_work_v1']);
 assert.equal(result.completion.state,'CONFIRMED');assert.equal(result.completion.work_key,'2'.repeat(64));
 assert.equal(result.member_published,false);
});

test('missing methods record private completion without a price write, while cached receipt keeps its first hash',async()=>{
 const work=await fixture();work.inputs=[];work.work_key='3'.repeat(64);const calls=[];
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);if(name==='get_daily_ai_price_work_v1')return work;
  assert.equal(name,'finish_daily_ai_price_work_v1');assert.equal(JSON.parse(args.p_result_text).state,'METHOD_INPUTS_REQUIRED');
  return {...finished(args),replayed:true,result_hash:'4'.repeat(64)};
 }});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','finish_daily_ai_price_work_v1']);
 assert.equal(result.stage_attempted,false);assert.equal(result.completion.state,'CONFIRMED');
 assert.equal(result.completion.result_hash,'4'.repeat(64));assert.equal(result.completion.replayed,true);
});

test('uncertain input or price writes never create a terminal checkpoint',async()=>{
 for(const fromProfiles of [false,true]){
  const work=fromProfiles?await profileFixture():await fixture();work.work_key='5'.repeat(64);const calls=[];
  const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name)=>{
   calls.push(name);if(name==='get_daily_ai_price_work_v1')return work;
   throw Error('synthetic lost acknowledgement');
  }});
  assert.equal(result.state,fromProfiles?'INPUT_REGISTRATION_OUTCOME_UNKNOWN':'STAGE_OUTCOME_UNKNOWN');
  assert.equal(calls.length,2);assert(!calls.includes('finish_daily_ai_price_work_v1'));assert.equal(result.completion,undefined);
 }
});

test('checkpoint uncertainty preserves confirmed prices and never retries in the same invocation',async()=>{
 for(const defect of ['timeout','wrong-key','wrong-hash']){
  const work=await fixture();work.work_key='6'.repeat(64);let finishes=0;
  const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
   if(name==='get_daily_ai_price_work_v1')return work;
   if(name==='stage_daily_ai_price_work_batch_v1')return staged(args);
   assert.equal(name,'finish_daily_ai_price_work_v1');finishes++;
   if(defect==='timeout')throw Error('synthetic lost completion acknowledgement');
   return {...finished(args),...(defect==='wrong-key'?{work_key:'7'.repeat(64)}:{result_hash:'7'.repeat(64)})};
  }});
  assert.equal(result.state,'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED');assert.equal(result.counts.staged,2);
  assert.equal(result.completion.state,'OUTCOME_UNKNOWN');assert.equal(result.completion.attempted,true);
  assert.equal(finishes,1);assert.equal(result.member_published,false);
 }
});

async function initialLongReviewFixture(){
 const work=await fixture(),template=JSON.parse(work.inputs[0].input_text);work.inputs=[];
 template.horizon='LONG';template.method_id='LONG_FCFE_DISCOUNT_SCENARIOS_V1';
 template.parameters={cashflow_basis:'FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI',timing:'END_OF_YEAR',
  dilution_basis:{description:'Explicit synthetic FCFE common share basis, not actual company cashflow.',evidence_ids:['F0']},
  scenarios:['conservative','base','upside'].map((name,i)=>({name,cashflows:[10+i,12+i],discount_rate:.1,terminal:null})),
  entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F0']};
 const profile={schema:'DAILY_AI_PRICE_PROFILE_V1',policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY',symbol:'1000',horizon:'LONG',
  method_id:template.method_id,created_at:'2026-11-10T00:06:00Z',valid_until:work.edition.expires_at,
  revision_note:'Synthetic first valuation review. This does not supply a qualitative judgment.',template_input:template};
 const profile_text=canonical(profile);work.profiles=[{registration_id:1,symbol:'1000',horizon:'LONG',profile_text,profile_hash:sha(profile_text)}];
 work.cards.find(c=>c.symbol==='1000'&&c.horizon==='LONG').status='INSUFFICIENT';work.work_key='8'.repeat(64);
 return work;
}
const longStaged=args=>({schema:'DAILY_AI_LONG_PREPARATIONS_STAGED_V1',edition_id:args.p_edition_id,
 items:args.p_items.map(({input_hash,calculation_hash,preparation_hash})=>({input_hash,calculation_hash,preparation_hash,replayed:false})),
 member_published:false,review_required:true});

test('an insufficient LONG card can create its first valuation review without creating a price plan or qualification',async()=>{
 const work=await initialLongReviewFixture(),calls=[];
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);if(name==='get_daily_ai_price_work_v1')return work;
  if(name==='stage_daily_ai_price_inputs_batch_v1'){const receipt=registerInputs(work,args);work.work_key='9'.repeat(64);return receipt;}
  if(name==='stage_daily_ai_long_preparations_batch_v1'){
   assert.equal(args.p_items.length,1);const item=args.p_items[0],p=JSON.parse(item.preparation_text),c=JSON.parse(item.calculation_text);
   assert.equal(p.review,null);assert.equal(p.selection_qualified,false);assert.equal(p.member_published,false);
   assert.equal(p.valuation_calculation.calculation_hash,item.calculation_hash);assert.equal(c.production_eligible,false);
   assert.equal(c.input_hash,work.inputs[0].input_hash);assert.equal(p.as_of,JSON.parse(work.inputs[0].input_text).as_of);
   assert.equal(sha(item.preparation_text),item.preparation_hash);return longStaged(args);
  }
  assert.equal(name,'finish_daily_ai_price_work_v1');return finished(args);
 }});
 assert.deepEqual(calls,['get_daily_ai_price_work_v1','stage_daily_ai_price_inputs_batch_v1','get_daily_ai_price_work_v1',
  'stage_daily_ai_long_preparations_batch_v1','finish_daily_ai_price_work_v1']);
 assert.equal(result.state,'NO_ELIGIBLE_PRICE_PLANS');assert.equal(result.stage_attempted,false);assert.equal(result.counts.staged,0);
 assert.equal(result.long_review_preparations.state,'STAGED_REVIEW_REQUIRED');assert.equal(result.completion.state,'CONFIRMED');
 assert.equal(work.cards.find(c=>c.symbol==='1000'&&c.horizon==='LONG').status,'INSUFFICIENT');
});

test('an uncertain first-review write remains resumable and cannot finish the daily work',async()=>{
 const work=await initialLongReviewFixture(),calls=[];
 const result=await runDailyAiPriceWork({editionId,batchId,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);if(name==='get_daily_ai_price_work_v1')return work;
  if(name==='stage_daily_ai_price_inputs_batch_v1')return registerInputs(work,args);
  assert.equal(name,'stage_daily_ai_long_preparations_batch_v1');const receipt=longStaged(args);
  receipt.items[0].preparation_hash='a'.repeat(64);return receipt;
 }});
 assert.equal(result.long_review_preparations.state,'STAGE_OUTCOME_UNKNOWN');assert.equal(result.completion.state,'DEFERRED');
 assert(!calls.includes('finish_daily_ai_price_work_v1'));assert(!calls.includes('stage_daily_ai_price_work_batch_v1'));
});

test('first-review preparation rejects evidence outside its original packet and never registers AVOID profiles',async()=>{
 const work=await initialLongReviewFixture();
 const prepared=await prepareDailyAiProfileInputs(work,{now});registerInputs(work,prepared.registration_request.args);
 const input=JSON.parse(work.inputs[0].input_text);input.evidence[1].content+=' ';
 work.inputs[0].input_text=canonical(input);work.inputs[0].input_hash=sha(work.inputs[0].input_text);
 const review=await prepareDailyAiLongReviewWork(work,{now});
 assert.equal(review.stage_request.args.p_items.length,0);assert.equal(review.summary.rows[0].state,'INVALID_INPUT');
 const avoided=await initialLongReviewFixture();avoided.cards.find(c=>c.symbol==='1000'&&c.horizon==='LONG').status='AVOID';
 assert.equal((await prepareDailyAiProfileInputs(avoided,{now})).registration_request.args.p_items.length,0);
});

test('a 2330 proposal preserves missing reported EPS and identifies nonpositive sums before requesting a method profile',async()=>{
 for(const {quarters,eps,reason} of [
  {quarters:3,eps:2.5,reason:'ACTUAL_FOUR_QUARTER_EPS_MISSING'},
  {quarters:4,eps:0,reason:'ACTUAL_EPS_SUM_NOT_POSITIVE'},
  {quarters:4,eps:-2.5,reason:'ACTUAL_EPS_SUM_NOT_POSITIVE'},
 ]){
  const work=await fixture();work.inputs=[];
  const packet=work.packets[0];packet.symbol='2330';packet.evidence.forEach(e=>{e.symbol='2330';});
  for(const card of work.cards.filter(c=>c.symbol==='1000')){card.symbol='2330';if(card.horizon==='LONG')card.status='INSUFFICIENT';}
  const source=packet.evidence[1];
  packet.evidence.push(...['2025-Q4','2026-Q1','2026-Q2','2026-Q3'].slice(0,quarters).map((period,i)=>({...source,id:'QUARTER-'+i,
   content:JSON.stringify({kind:'EPS',period,basis:'SINGLE_QUARTER',values:{value:eps,reported_decimal:eps.toFixed(2),
    unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED'}})})));
  const actuals=await deriveDailyAiFinancialActuals({packet}),before=structuredClone(work);
  const prepared=await prepareDailyAiProfileInputs(work,{now});
  assert.deepEqual(work,before);assert.equal(prepared.registration_request.args.p_items.length,0);
  assert.equal(prepared.counts.proposal_inputs,0);assert.equal(prepared.counts.method_updates,2);
  for(const horizon of ['MEDIUM','LONG']){
   const row=prepared.rows.find(r=>r.symbol==='2330'&&r.horizon===horizon);
   assert.equal(row.state,'METHOD_UPDATE_REQUIRED');assert.equal(row.reason,reason);assert.equal(row.profile_hash,null);
   if(quarters===3)assert.deepEqual(row.missing,actuals.missing.MEDIUM);
   else{
    assert.deepEqual(actuals.missing.MEDIUM,[]);assert.equal(actuals.reported_four_quarter_diluted_eps_sum.value,eps*4);
    assert.equal(row.missing.length,1);assert.equal(row.missing[0].code,reason);
    assert.equal(row.missing[0].field,horizon+'.reported_eps_sum');assert.match(row.missing[0].detail,/positive historical base/);
   }
  }
 }
});

test('the explicit 2330 research proposal initializes real calculation inputs once without an external price or approval',async()=>{
 const work=await fixture();work.inputs=[];
 const packet=work.packets[0];packet.symbol='2330';packet.evidence.forEach(e=>{e.symbol='2330';});
 for(const card of work.cards.filter(c=>c.symbol==='1000')){card.symbol='2330';if(card.horizon==='LONG')card.status='INSUFFICIENT';}
 const source=packet.evidence[1];
 packet.evidence.push(...['2025-Q4','2026-Q1','2026-Q2','2026-Q3'].map((period,i)=>({...source,id:'QUARTER-'+i,
  content:JSON.stringify({kind:'EPS',period,basis:'SINGLE_QUARTER',values:{value:2.5,reported_decimal:'2.50',
   unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED'}})})));
 const prepared=await prepareDailyAiProfileInputs(work,{now});
 assert.equal(prepared.counts.proposal_inputs,2);assert.equal(prepared.registration_request.args.p_items.length,2);
 for(const row of prepared.rows.filter(r=>r.parameter_source)){
  assert.equal(row.symbol,'2330');assert.equal(row.methodology_approved,false);assert.equal(row.profile_hash,null);
 }
 for(const item of prepared.registration_request.args.p_items){const input=JSON.parse(item.input_text);
  assert.deepEqual(input.evidence,packet.evidence);assert.equal(input.as_of,new Date(now).toISOString());
  assert.match(input.assumption_basis.description,/internal/i);assert.equal(input.review,undefined);
 }
 registerInputs(work,prepared.registration_request.args);
 const cached=await prepareDailyAiProfileInputs(work,{now:now+1000});
 assert.equal(cached.counts.proposal_inputs,0);assert.equal(cached.counts.already_registered,2);
 assert.equal(cached.registration_request.args.p_items.length,0);
 const long=await prepareDailyAiLongReviewWork(work,{now});assert.equal(long.stage_request.args.p_items.length,1);
 assert.equal(JSON.parse(long.stage_request.args.p_items[0].preparation_text).selection_qualified,false);
 const formal=await prepareDailyAiPriceWork(work,{now});assert.equal(formal.stage_request.args.p_items.length,1);
 assert.equal(JSON.parse(formal.stage_request.args.p_items[0].body_text).horizon,'MEDIUM');
});

function request(body,headers={'x-vnext-internal':internalSecret}){
 return new Request('https://synthetic.invalid/draft',{method:'POST',headers,body:JSON.stringify(body)});
}
test('cached daily draft uses the actual stored edition and enters the price workflow',async()=>{
 const work=await fixture(),calls=[],snapshot='c'.repeat(64);
 const response=await handleZeroPaidStockDraft(request({draft_batch_id:batchId}),{internalSecret,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);
  if(name==='prepare_zero_paid_stock_draft_v1')return {schema:'ZERO_PAID_DRAFT_CHECKPOINT_V1',state:'CACHED',batch_id:batchId,
   author_version:AUTHOR_VERSION,snapshot_hash:snapshot,cards:216,expires_at:work.edition.expires_at,model_calls:0,member_published:false,independent_review_required:true};
  if(name==='stage_offline_reviewed_analysis_edition_v1')return {state:'OFFLINE_EDITION_STAGED_FULL_REVIEW_REQUIRED',snapshot_hash:snapshot,
   edition_id:editionId,analysis_origin:'OFFLINE_REVIEWED',model_jobs:0,cards:216,model_calls:0,reviews_copied:false,member_published:false};
  if(name==='get_daily_ai_price_work_v1'){assert.equal(args.p_edition_id,editionId);assert.notEqual(args.p_edition_id,snapshot);return work;}
  assert.equal(name,'stage_daily_ai_price_work_batch_v1');return staged(args);
 }});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.state,'DRAFT_CACHED');assert.equal(body.price_work.counts.staged,2);
 assert.deepEqual(calls,['prepare_zero_paid_stock_draft_v1','stage_offline_reviewed_analysis_edition_v1','get_daily_ai_price_work_v1','stage_daily_ai_price_work_batch_v1']);
});

test('the bounded daily deadline preserves a confirmed edition when the subsequent price step has not settled',async()=>{
 const work=await fixture(),snapshot='c'.repeat(64),calls=[];
 const response=await handleZeroPaidStockDraft(request({draft_batch_id:batchId}),{internalSecret,clock:()=>new Date(now).toISOString(),rpc:async(name,args,signal)=>{
  calls.push(name);
  if(name==='prepare_zero_paid_stock_draft_v1')return {schema:'ZERO_PAID_DRAFT_CHECKPOINT_V1',state:'CACHED',batch_id:batchId,
   author_version:AUTHOR_VERSION,snapshot_hash:snapshot,cards:216,expires_at:work.edition.expires_at,model_calls:0,member_published:false,independent_review_required:true};
  if(name==='stage_offline_reviewed_analysis_edition_v1')return {state:'OFFLINE_EDITION_STAGED_FULL_REVIEW_REQUIRED',snapshot_hash:snapshot,
   edition_id:editionId,analysis_origin:'OFFLINE_REVIEWED',model_jobs:0,cards:216,model_calls:0,reviews_copied:false,member_published:false};
  assert.equal(name,'get_daily_ai_price_work_v1');
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('synthetic delayed price context')),{once:true}));
 }},{runMs:40});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.state,'DRAFT_CACHED');
 assert.equal(body.edition_id,editionId);assert.equal(body.owner_preview_ready,true);assert.equal(body.member_published,false);
 assert.equal(body.price_work.state,'PRICE_WORK_DEADLINE_REACHED');assert.equal(body.price_work.outcome_unknown,true);
 assert.deepEqual(calls,['prepare_zero_paid_stock_draft_v1','stage_offline_reviewed_analysis_edition_v1','get_daily_ai_price_work_v1']);
});

test('new daily authoring also reaches prices; missing workflow leaves the confirmed edition usable',async()=>{
 const work=await fixture(),packet_texts={},packet_hashes={};
 for(const p of work.packets){packet_texts[p.symbol]=canonical(p);packet_hashes[p.symbol]=await snapshotHash(p);}
 const batchText=canonical({schema:'DAILY_AI_BATCH_INPUT_V1',cutoff,through,packet_texts,packet_hashes,gaps:{}}),actualBatchId=sha(batchText);
 const calls=[];let savedSnapshot;
 const response=await handleZeroPaidStockDraft(request({draft_batch_id:actualBatchId}),{internalSecret,clock:()=>new Date(now).toISOString(),rpc:async(name,args)=>{
  calls.push(name);
  if(name==='prepare_zero_paid_stock_draft_v1')return {schema:'ZERO_PAID_DRAFT_CHECKPOINT_V1',state:'GENERATE',batch_id:actualBatchId,
   author_version:AUTHOR_VERSION,payload_text:batchText,prepared_at:work.edition.prepared_at,expires_at:work.edition.expires_at,attempt:1,
   model_calls:0,member_published:false,independent_review_required:true};
  if(name==='stage_offline_reviewed_analysis_snapshot_v1'){savedSnapshot=args.p_snapshot_hash;return {state:'OFFLINE_SNAPSHOT_STAGED_FULL_REVIEW_REQUIRED',
   snapshot_hash:savedSnapshot,cards:216,model_generated:false,model_calls:0,independent_review_required:true,member_published:false};}
  if(name==='stage_offline_reviewed_analysis_edition_v1')return {state:'OFFLINE_EDITION_STAGED_FULL_REVIEW_REQUIRED',snapshot_hash:savedSnapshot,
   edition_id:editionId,analysis_origin:'OFFLINE_REVIEWED',model_jobs:0,cards:216,model_calls:0,reviews_copied:false,member_published:false};
  assert.equal(name,'get_daily_ai_price_work_v1');throw Error('synthetic not-yet-installed price RPC');
 }});
 const body=await response.json();assert.equal(response.status,200);assert.equal(body.state,'DRAFT_STAGED');assert.equal(body.owner_preview_ready,true);
 assert.equal(body.price_work.state,'PRICE_WORKFLOW_UNAVAILABLE');assert.equal(calls.at(-1),'get_daily_ai_price_work_v1');
});

test('unauthorized callers cannot reach price context or pass price assumptions into the worker request',async()=>{
 let calls=0;const ports={internalSecret,clock:()=>new Date(now).toISOString(),rpc:async()=>{calls++;throw Error('unexpected');}};
 assert.equal((await handleZeroPaidStockDraft(request({draft_batch_id:batchId},{}),ports)).status,401);
 assert.equal((await handleZeroPaidStockDraft(request({draft_batch_id:batchId,calculation_input:{}}),ports)).status,422);
 assert.equal(calls,0);
});

test('offline CLI saves complete review packets, labels historical replay and refuses overwrite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ma-price-work-'));
 try{
  const input=join(dir,'input.json'),output=join(dir,'output.json');await writeFile(input,JSON.stringify(await fixture()));
  const result=await calculateSavedDailyPrices(['--input',input,'--output',output,'--replay-at',new Date(now).toISOString()]);
  assert.equal(result.historical_replay,true);assert.equal(result.production_writes,0);
  const saved=JSON.parse(await readFile(output,'utf8'));assert.equal(saved.review_packets.length,2);assert.equal(saved.member_published,false);
  await assert.rejects(()=>calculateSavedDailyPrices(['--input',input,'--output',output,'--replay-at',new Date(now).toISOString()]),/EEXIST/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
