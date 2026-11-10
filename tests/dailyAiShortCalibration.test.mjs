import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDailyAiShortCalibration,shortCalibrationMethodReviewRequirement,SHORT_ACTION_KINDS} from '../research/daily-ai-short-calibration.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {nextEntrySession} from '../research/entry-opportunity.ts';

const method={method_id:'SHORT_ATR_CONDITIONAL_V1',parameters:{atr_period:14,breakout_lookback:5,trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK',entry_atr_width:.25,stop_atr_multiple:1.5,tick_size:.1}};
function source(id,kind,day,body){return {id,symbol:'2330',kind,source:'https://www.twse.com.tw/synthetic-calibration-fixture',
 published_at:day+'T17:05:00+08:00',available_at:day+'T17:05:00+08:00',time_basis:'PUBLISHED',content:JSON.stringify(body)};}
function fixture(count=20){
 const days=['2026-01-05'];while(days.length<count)days.push(nextEntrySession(days.at(-1)));
 const observations=days.map((d,i)=>source('p-'+d,'PRICE',d,{date:d,open:100+i,high:102+i,low:99+i,close:101+i,volume:1000+i,amount:100000+i,session_scope:'SYNTHETIC_COMPLETE_SESSION'}));
 const packets=[];for(let i=0;i<observations.length;i+=80){const evidence=observations.slice(i,i+80),through=JSON.parse(evidence.at(-1).content).date;
  packets.push({symbol:'2330',company:'合成資料容量測試',cutoff:through+'T23:00:00+08:00',data_through:through,evidence});}
 return {days,args:{symbol:'2330',packets,method:structuredClone(method),holding_sessions:[1,5,10],protocol:null,
  as_of:days.at(-1)+'T23:30:00+08:00',provenance:'SYNTHETIC_TEST'}};
}
async function completeFixture(){const f=fixture(100),{days,args}=f;
 args.packets.at(-1).evidence.push(source('action-coverage','FINANCIAL',days.at(-1),{kind:'CORPORATE_ACTION_COVERAGE',symbol:'2330',status:'NO_ACTIONS',price_basis:'RAW_UNADJUSTED',from:days[0],through:days.at(-1)}));
 args.packets[0].evidence.push(source('exchange-ticks','FINANCIAL',days[0],{kind:'EXCHANGE_TICK_SCHEDULE',scope:'SYNTHETIC_PRICE_BANDS_NOT_REAL_EXCHANGE_POLICY'}));
 args.protocol={schema:'SHORT_CALIBRATION_PROTOCOL_V1',version:'SYNTHETIC_EXPLICIT_CAPACITY_PROTOCOL_V1',method_hash:await snapshotHash(method),declared_at:days[69]+'T23:00:00+08:00',
  train:{from:days[0],through:days[29]},validation:{from:days[40],through:days[59]},oos:{from:days[70],through:days[99]},purge_sessions:10,
  minimums:{train_sessions:30,validation_sessions:20,oos_sessions:30,nonoverlapping_oos_windows:3},
  cost_model:{version:'SYNTHETIC_COST_ASSUMPTIONS_NOT_ACTUAL_ACCOUNT',quantity:1000,minimum_fee_twd:20,buy_fee:.001,sell_fee:.001,sell_tax:.003,slippage_each_side:.001},
  execution_policy:{version:'SYNTHETIC_EXECUTION_POLICY',entry:'NEXT_SESSION_OPEN_WITHIN_LOCKED_RANGE',ambiguous_intraday:'UNCONFIRMED',limit_lock:'UNCONFIRMED',tick_schedule_evidence_ids:['exchange-ticks']}};
 return f;
}

test('twenty bars can calculate ATR but cannot create a ten-session outcome, calibrated strategy or win rate',async()=>{
 const {args}=fixture(),before=structuredClone(args),r=await assessDailyAiShortCalibration(args);
 assert.equal(r.state,'INSUFFICIENT');assert.equal(r.history.unique_sessions,20);assert.equal(r.history.warmup_sessions,15);
 assert.deepEqual(r.history.capacity.map(c=>c.mathematically_complete_windows),[5,1,0]);
 assert.deepEqual(r.history.capacity.map(c=>c.nonoverlapping_outcome_windows),[5,1,0]);
 assert(r.issues.some(i=>i.code==='NO_MATURED_POINT_IN_TIME_WINDOW'&&i.field==='horizon.10'));
 assert(r.issues.some(i=>i.code==='COMPLETE_CORPORATE_ACTION_HISTORY_REQUIRED'));assert.equal(r.metrics,null);assert.equal(r.strategy_calibrated,false);
 assert.equal(r.method_review.arithmetic_correctness_is_strategy_validation,false);assert.equal(r.executed_strategy_samples,0);assert.deepEqual(args,before);
});

test('repeated snapshots do not multiply sample capacity, and conflicting same-date prices are not chosen opportunistically',async()=>{
 const {args}=fixture();args.packets.push(structuredClone(args.packets[0]));let r=await assessDailyAiShortCalibration(args);
 assert.equal(r.history.observations,40);assert.equal(r.history.unique_sessions,20);assert.equal(r.history.duplicate_observations,20);
 const e=args.packets[1].evidence[0],body=JSON.parse(e.content);body.close+=.1;e.content=JSON.stringify(body);
 r=await assessDailyAiShortCalibration(args);assert.equal(r.state,'INSUFFICIENT');assert.equal(r.history.conflicting_sessions,1);assert(r.issues.some(i=>i.code==='CONFLICTING_PRICE_OBSERVATIONS'));
});

test('a later historical download cannot be backdated into the old signal windows',async()=>{
 const {args}=fixture(30),late=args.packets[0].cutoff;
 for(const e of args.packets[0].evidence)e.available_at=late;
 const r=await assessDailyAiShortCalibration(args);assert(r.history.capacity.every(c=>c.mathematically_complete_windows>0));
 assert(r.history.capacity.every(c=>c.point_in_time_complete_windows===0));assert.equal(r.metrics,null);
});

test('explicit complete split capacity permits experiment execution only, while method validity stays unproven',async()=>{
 const {args}=await completeFixture(),r=await assessDailyAiShortCalibration(args);
 assert.equal(r.state,'READY_FOR_EXECUTION');assert.deepEqual(r.split.counts,{train:30,validation:20,oos:30});
 assert.equal(r.split.oos_capacity.find(c=>c.holding_sessions===10).nonoverlapping_outcome_windows,3);
 assert.equal(r.signal_edge,'UNPROVEN');assert.equal(r.metrics,null);assert.equal(r.method_review.state,'INSUFFICIENT');assert.equal(r.methodology_approved,false);
 const req=await shortCalibrationMethodReviewRequirement(r,method);assert.equal(req.strategy_validation,'INSUFFICIENT');assert.equal(req.approved,false);
 assert(req.blocking_codes.includes('ACTUAL_FROZEN_METHOD_WALK_FORWARD_EVALUATION'));assert.equal(req.qualification_hash,r.qualification_hash);
});

test('sample targets, purging, lock dates and execution evidence are real gates rather than success defaults',async()=>{
 for(const [edit,code]of [
  [a=>{a.protocol.minimums.nonoverlapping_oos_windows=4;},'OOS_SAMPLE_CAPACITY_INSUFFICIENT'],
  [a=>{a.protocol.declared_at=a.as_of;},'OOS_SPLIT_LEAKAGE'],
  [a=>{a.protocol.validation.from=a.protocol.train.through;},'OOS_SPLIT_LEAKAGE'],
  [a=>{a.protocol.cost_model=null;},'EXPLICIT_COST_MODEL_REQUIRED'],
  [a=>{a.protocol.execution_policy=null;},'EXPLICIT_EXECUTION_MODEL_REQUIRED'],
  [a=>{a.protocol.execution_policy.tick_schedule_evidence_ids=['missing'];},'EXCHANGE_TICK_EVIDENCE_REQUIRED'],
  [a=>{a.packets[0].evidence[0].available_at=a.packets[0].cutoff;},'FIT_SOURCE_NOT_AVAILABLE_AT_LOCK'],
 ]){const {args}=await completeFixture();edit(args);const r=await assessDailyAiShortCalibration(args);assert.equal(r.state,'INSUFFICIENT');assert(r.issues.some(i=>i.code===code));assert.equal(r.metrics,null);}
 const {args}=await completeFixture();args.protocol.purge_sessions=0;await assert.rejects(()=>assessDailyAiShortCalibration(args),/SHORT_CALIBRATION_INVALID/);
});

test('method or prerequisite receipt drift cannot be presented to method review as a matching successful calibration',async()=>{
 const {args}=fixture(),r=await assessDailyAiShortCalibration(args),changed=structuredClone(method);changed.parameters.stop_atr_multiple=2;
 await assert.rejects(()=>shortCalibrationMethodReviewRequirement(r,changed),/review_receipt/);
 const forged=structuredClone(r);forged.strategy_calibrated=true;forged.metrics={win_rate:1};await assert.rejects(()=>shortCalibrationMethodReviewRequirement(forged,method),/review_receipt/);
 const {qualification_hash,...body}=r;assert.equal(qualification_hash,await snapshotHash(body));assert(Object.isFrozen(r));
});

test('complete corporate-action inventories exclude event windows without permanently blocking dividend-paying stocks',async()=>{
 const {args,days}=await completeFixture(),e=args.packets.at(-1).evidence.find(e=>e.id==='action-coverage'),body=JSON.parse(e.content);
 args.corporate_action_policy='RAW_EXCLUDE_EVENT_WINDOWS';
 Object.assign(body,{status:'EVENTS',complete:true,coverage_kinds:[...SHORT_ACTION_KINDS],
  events:[{symbol:'2330',effective_date:days[20],kind:'CASH_DIVIDEND',source_ref:e.source}]});e.content=JSON.stringify(body);
 let r=await assessDailyAiShortCalibration(args);assert.equal(r.state,'READY_FOR_EXECUTION');assert.deepEqual(r.excluded_action_dates,[days[20]]);
 assert(r.history.capacity.every(c=>c.event_overlap_windows>0));assert.equal(r.split.oos_capacity.find(c=>c.holding_sessions===10).nonoverlapping_outcome_windows,3);
 assert.equal(r.strategy_calibrated,false);assert.equal(r.metrics,null);
 body.complete=false;e.content=JSON.stringify(body);r=await assessDailyAiShortCalibration(args);
 assert.equal(r.state,'INSUFFICIENT');assert(r.issues.some(i=>i.code==='COMPLETE_CORPORATE_ACTION_HISTORY_REQUIRED'));
});
