// Synthetic contract/algorithm fixtures. No live source, database, identity,
// rights approval or publication is used. The actual calculator and preparer
// run; only the external RPC boundary is replaced with an explicit test port.
import test from 'node:test';
import assert from 'node:assert/strict';
import {produceDailyAiPricePlan} from '../research/daily-ai-price-producer.mjs';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

const NOW=Date.parse('2026-11-10T00:10:00Z');
const cutoff='2026-11-10T00:00:00Z',through='2026-11-09';
function fixture(){
 const evidence=[
  {id:'P1',symbol:'2330',kind:'PRICE',source:'https://www.twse.com.tw/synthetic-price-producer-fixture',
   published_at:'2026-11-09T07:00:00Z',available_at:'2026-11-09T09:00:00Z',time_basis:'PUBLISHED',
   content:JSON.stringify({date:through,close:100,currency:'TWD',price_basis:'RAW_UNADJUSTED'})},
  {id:'F1',symbol:'2330',kind:'FINANCIAL',source:'https://www.twse.com.tw/synthetic-financial-producer-fixture',
   published_at:'2026-11-09T07:00:00Z',available_at:'2026-11-09T09:00:00Z',time_basis:'PUBLISHED',
   content:'SYNTHETIC_ONLY: diluted common-share earnings evidence; scenario forecasts remain explicit test assumptions.'},
 ];
 const edition={id:'a'.repeat(64),evidence_cutoff:cutoff,prepared_at:'2026-11-10T00:02:00Z',
  expires_at:'2026-11-10T05:30:00Z',data_through:through};
 const card={symbol:'2330',company:'合成測試公司',horizon:'MEDIUM',status:'WAIT'};
 const packet={symbol:card.symbol,company:card.company,cutoff,data_through:through,evidence};
 const calculation_input={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol:card.symbol,horizon:card.horizon,
  cutoff,data_through:through,as_of:'2026-11-10T00:05:00Z',expires_at:edition.expires_at,currency:'TWD',
  method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',quote_evidence_id:'P1',evidence:structuredClone(evidence),
  assumption_basis:{available_at:'2026-11-09T10:00:00Z',description:'合成EPS與本益比情境假設；不是券商預測或官方合理股價。',evidence_ids:['F1']},
  invalidation:'合成盈利或稀釋股數條件改變時停止使用，重新審查。',
  parameters:{earnings_basis:'FORWARD_12_MONTH_DILUTED_EPS',forecast_period:{start:'2026-11-11',end:'2027-11-10'},
   dilution_basis:{description:'合成測試使用每稀釋普通股金額，並未聲稱真實公司股數。',evidence_ids:['F1']},
   scenarios:[{name:'conservative',eps:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:12,pe:14}],
   entry_scenarios:['conservative','base'],margin_of_safety:0.2,stop_evidence_ids:['F1']}};
 return {edition,card,packet,calculation_input};
}
const receipt=args=>({schema:'DAILY_AI_PRICE_PLAN_STAGED_V1',plan_hash:args.p_plan_hash,review_required:true,member_published:false});
const options={now:NOW};

test('producer computes EPS/PE prices through the real preparer without dispatching DRY_RUN',async()=>{
 const input=fixture(),before=structuredClone(input);let calls=0;
 const result=await produceDailyAiPricePlan(input,{...options,mode:'DRY_RUN',rpc:()=>{calls++;throw Error('MUST_NOT_CALL');}});
 assert.equal(calls,0);assert.deepEqual(input,before);
 assert.equal(result.status,'CALCULATED_REVIEW_REQUIRED');assert.equal(result.stage_attempted,false);assert.equal(result.staged,false);
 const body=JSON.parse(result.candidate.body_text);
 assert.deepEqual(body.entry_range,[64,96]);assert.equal(body.wait_above,96);assert.equal(body.stop_kind,'EVENT');assert.equal(body.stop,null);
 assert.equal(await snapshotHash(body),result.candidate.plan_hash);
 assert(body.basis.includes(result.calculation.calculation_hash));
 assert.equal(result.candidate.packet_hash,await snapshotHash(input.packet));
 assert.equal(result.review_request.plan_hash,result.candidate.plan_hash);
 assert.equal(result.review_request.calculation_hash,result.calculation.calculation_hash);
 assert.deepEqual(result.review_request.required_reviews,['QUALITY','TIME','SOURCE_USE','METHODOLOGY']);
 assert.equal(result.review,null);assert.equal(result.candidate.review,null);assert.equal(result.review_request.review,null);
 assert.equal(result.member_published,false);assert.equal(result.authorizes_publication,false);
 assert.equal(result.source_use_approved,false);assert.equal(result.methodology_approved,false);assert.equal(result.model_calls,0);
 assert(Object.isFrozen(result));assert(Object.isFrozen(result.stage_request.args));assert(Object.isFrozen(result.calculation.entry_range));
});

test('STAGE sends only the calculated canonical body/hash to the existing fixed RPC',async()=>{
 const calls=[];
 const result=await produceDailyAiPricePlan(fixture(),{...options,mode:'STAGE',rpc:async(name,args,{signal})=>{
  calls.push({name,args:structuredClone(args)});assert.equal(signal.aborted,false);
  assert.deepEqual(Object.keys(args).sort(),['p_body_text','p_plan_hash']);
  assert.equal(await snapshotHash(JSON.parse(args.p_body_text)),args.p_plan_hash);
  return {data:receipt(args),error:null};
 }});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'stage_daily_ai_price_plan_v1');
 assert.deepEqual(calls[0],{name:result.stage_request.name,args:result.stage_request.args});
 assert.equal(result.status,'STAGED_REVIEW_REQUIRED');assert.equal(result.staged,true);
 assert.equal(result.stage_receipt.review_required,true);assert.equal(result.member_published,false);
});

test('same-ID modified source bytes and missing packet evidence cannot reach RPC',async()=>{
 for(const alter of [
  input=>{input.calculation_input.evidence[0].content=JSON.stringify({date:through,close:1000,currency:'TWD',price_basis:'RAW_UNADJUSTED'});},
  input=>{input.calculation_input.evidence[0].source='https://www.tpex.org.tw/another-source';},
  input=>{input.packet.evidence=input.packet.evidence.filter(item=>item.id!=='F1');},
  input=>{input.calculation_input.evidence[1].symbol=null;},
 ]){
  const input=fixture();alter(input);let calls=0;
  await assert.rejects(()=>produceDailyAiPricePlan(input,{...options,mode:'STAGE',rpc:()=>{calls++;}}),/PRICE_PRODUCER_EVIDENCE/);
  assert.equal(calls,0);
 }
});

test('wrong edition/security/period/time and externally supplied plan/review are rejected',async()=>{
 for(const alter of [
  input=>{input.calculation_input.symbol='2454';},input=>{input.card.horizon='LONG';},input=>{input.card.symbol=2330;input.card.status='AVOID';},
  input=>{input.edition.data_through='2026-11-06';},input=>{input.packet.cutoff='2026-11-09T23:59:59Z';},
  input=>{input.calculation_input.expires_at='2026-11-11T05:30:00Z';},
  input=>{input.calculation_input.as_of='2026-11-10T00:10:00.000001Z';},
  input=>{input.body={entry_range:[1,2]};},input=>{input.review={status:'PASS'};},
 ]){
  const input=fixture();alter(input);let calls=0;
  await assert.rejects(()=>produceDailyAiPricePlan(input,{...options,mode:'STAGE',rpc:()=>{calls++;}}),/PRICE_PRODUCER_/);
  assert.equal(calls,0);
 }
});

test('AVOID and INSUFFICIENT cards remain ineligible and do not block other valid cards',async()=>{
 for(const status of ['AVOID','INSUFFICIENT']){
  const input=fixture();input.card.status=status;let calls=0;
  const result=await produceDailyAiPricePlan(input,{...options,mode:'STAGE',rpc:()=>{calls++;}});
  assert.equal(result.status,'INELIGIBLE');assert.equal(result.reason,'CARD_'+status);assert.equal(result.candidate,null);
  assert.equal(result.stage_attempted,false);assert.equal(calls,0);
 }
 assert.equal((await produceDailyAiPricePlan(fixture(),options)).status,'CALCULATED_REVIEW_REQUIRED');
});

test('missing numeric method inputs return explicit INELIGIBLE without fabricated prices',async()=>{
 const input=fixture();delete input.calculation_input.parameters.scenarios[0].eps;
 const result=await produceDailyAiPricePlan(input,options);
 assert.equal(result.status,'INELIGIBLE');assert.equal(result.reason,'PRICE_CALCULATION_MISSING_INPUT');
 assert.equal(result.calculation,null);assert.equal(result.candidate,null);assert.equal(result.review,null);
});

test('caller mutation during async hashing cannot change the produced security, values or packet binding',async()=>{
 const input=fixture(),before=structuredClone(input),operation=produceDailyAiPricePlan(input,options);
 input.card.symbol='2454';input.calculation_input.parameters.scenarios[0].eps=888;
 input.packet.evidence[0].content='altered while awaiting';
 const result=await operation;
 assert.equal(result.symbol,'2330');assert.deepEqual(JSON.parse(result.candidate.body_text).entry_range,[64,96]);
 assert.equal(result.candidate.packet_hash,await snapshotHash(before.packet));
});

test('a wrong receipt, unexpected approval or error never becomes staged success and never retries',async()=>{
 for(const response of [
  args=>({...receipt(args),plan_hash:'b'.repeat(64)}),args=>({...receipt(args),member_published:true}),
  args=>({...receipt(args),review_required:false}),args=>({...receipt(args),owner_approved:true}),
  ()=>({data:null,error:{message:'SECRET_DO_NOT_EXPOSE',code:'XX000'}}),
 ]){
  let calls=0;const result=await produceDailyAiPricePlan(fixture(),{...options,mode:'STAGE',rpc:async(_name,args)=>{calls++;return response(args);}});
  assert.equal(calls,1);assert.equal(result.status,'STAGE_OUTCOME_UNKNOWN');assert.equal(result.staged,false);
  assert.equal(result.stage_attempted,true);assert(result.candidate.plan_hash);assert(result.stage_request.args.p_body_text);
  assert(!JSON.stringify(result).includes('SECRET_DO_NOT_EXPOSE'));
 }
});

test('timeout marks stage outcome unknown, aborts the port and retains the request for reconciliation',async()=>{
 let calls=0,portSignal;
 const result=await produceDailyAiPricePlan(fixture(),{...options,mode:'STAGE',timeoutMs:15,rpc:async(_name,_args,{signal})=>{
  calls++;portSignal=signal;return new Promise(()=>{});
 }});
 assert.equal(calls,1);assert.equal(portSignal.aborted,true);assert.equal(result.status,'STAGE_OUTCOME_UNKNOWN');
 assert.equal(result.reason,'STAGE_TIMEOUT');assert.equal(result.staged,false);assert(result.stage_request.args.p_plan_hash);
});

test('cancellation before dispatch prevents RPC and cancellation after dispatch stays unconfirmed',async()=>{
 const early=new AbortController();early.abort();let earlyCalls=0;
 await assert.rejects(()=>produceDailyAiPricePlan(fixture(),{...options,mode:'STAGE',signal:early.signal,rpc:()=>{earlyCalls++;}}),/PRICE_PRODUCER_ABORTED/);
 assert.equal(earlyCalls,0);
 const during=new AbortController();let calls=0;
 const result=await produceDailyAiPricePlan(fixture(),{...options,mode:'STAGE',signal:during.signal,rpc:async()=>{
  calls++;during.abort();return new Promise(()=>{});
 }});
 assert.equal(calls,1);assert.equal(result.status,'STAGE_OUTCOME_UNKNOWN');assert.equal(result.reason,'STAGE_ABORTED');
 assert.equal(result.member_published,false);assert.equal(result.staged,false);
});
