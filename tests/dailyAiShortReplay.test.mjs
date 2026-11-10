import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateShortReplayGeometry,replayDailyAiShortMethod} from '../research/daily-ai-short-replay.ts';
import {SHORT_ACTION_KINDS} from '../research/daily-ai-short-calibration.ts';
import {nextEntrySession} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

const method={method_id:'SHORT_ATR_CONDITIONAL_V1',parameters:{atr_period:2,breakout_lookback:2,
 trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK',entry_atr_width:.5,stop_atr_multiple:2,tick_size:.5}};
const costs={version:'EXPLICIT_SYNTHETIC_COSTS',quantity:1000,minimum_fee_twd:20,buy_fee:.001425,sell_fee:.001425,sell_tax:.003,slippage_each_side:.001,rounding:'CEIL_TWD'};
function fixture(){
 const days=['2026-10-27'];while(days.length<5)days.push(nextEntrySession(days.at(-1)));
 const values=[{open:100,high:102,low:98,close:100},{open:101,high:104,low:100,close:103},{open:103,high:105,low:100,close:104},
  {open:105,high:107,low:102,close:106},{open:90,high:92,low:88,close:90}];
 const evidence=days.map((date,i)=>({id:'p'+i,symbol:'2330',kind:'PRICE',source:'https://www.twse.com.tw/synthetic-short-replay',
  published_at:date+'T17:05:00+08:00',available_at:date+'T17:05:00+08:00',time_basis:'PUBLISHED',
  content:JSON.stringify({date,...values[i],volume:1000000,amount:100000000,session_scope:'SYNTHETIC_COMPLETE'})}));
 evidence.push({id:'ca',symbol:'2330',kind:'FINANCIAL',source:'https://www.twse.com.tw/synthetic-complete-actions',
  published_at:days.at(-1)+'T17:05:00+08:00',available_at:days.at(-1)+'T17:05:00+08:00',time_basis:'PUBLISHED',
  content:JSON.stringify({kind:'CORPORATE_ACTION_COVERAGE',symbol:'2330',status:'NO_ACTIONS',price_basis:'RAW_UNADJUSTED',from:days[0],through:days.at(-1)})});
 return {days,values,args:{symbol:'2330',method:structuredClone(method),packets:[{symbol:'2330',company:'Synthetic replay',
  cutoff:days.at(-1)+'T23:00:00+08:00',data_through:days.at(-1),evidence}],holding_sessions:[2],as_of:days.at(-1)+'T23:30:00+08:00',
  provenance:'SYNTHETIC_TEST',corporate_action_policy:'RAW_EXCLUDE_EVENT_WINDOWS',cost_model:structuredClone(costs)}};
}
function editBar(args,index,change){const e=args.packets[0].evidence[index],b=JSON.parse(e.content);Object.assign(b,change);e.content=JSON.stringify(b);}

test('actual ATR geometry and next-session gap exit retain fees, tax and slippage without optimistic stop fills',async()=>{
 const {args,values}=fixture();assert.deepEqual(calculateShortReplayGeometry(values.slice(0,3),method),{atr:4.5,prior_window_high:104,entry_range:[104.5,106.5],stop:95.5});
 const r=await replayDailyAiShortMethod(args),row=r.rows[0];assert.equal(row.state,'MODELLED');assert.equal(row.entry_price,105.105);
 assert.equal(row.raw_exit_price,90);assert.equal(row.exit_price,89.91);assert.equal(row.buy_fee_twd,150);assert.equal(row.sell_fee_twd,129);assert.equal(row.sell_tax_twd,270);
 assert(Math.abs(row.net_return-(-5248/35085))<1e-15);assert.equal(row.stop_hit,true);
 assert.equal(r.portfolio_total_return,null);assert.equal(r.forward_performance_samples,0);assert.equal(r.strategy_calibrated,false);
 const {replay_hash,...body}=r;assert.equal(replay_hash,await snapshotHash(body));
});

test('future prices never alter signal geometry, and late sources remain posthoc instead of gaining a forward lock',async()=>{
 const {args}=fixture(),first=await replayDailyAiShortMethod(args);editBar(args,3,{high:1000});editBar(args,4,{high:1200});
 for(const e of args.packets[0].evidence.filter(e=>e.kind==='PRICE'))e.available_at=args.packets[0].cutoff;
 const later=await replayDailyAiShortMethod(args);assert.deepEqual(later.rows[0].geometry,first.rows[0].geometry);
 assert.equal(later.rows[0].source_known_before_entry,false);assert.equal(later.mode,'POSTHOC_FIXED_METHOD_REPLAY');assert.equal(later.protocol_backdated,false);
});

test('opening gaps, invalidation and intraday trigger ambiguity cannot manufacture entry',async()=>{
 for(const [change,state,reason]of [
  [{open:108,high:110,low:105,close:109},'NOT_ENTERED','OPENING_GAP_OUTSIDE_LOCKED_RANGE_NO_CHASE'],
  [{open:94,high:105,low:90,close:102},'NOT_ENTERED','INVALIDATED_BEFORE_ENTRY'],
  [{open:103,high:107,low:94,close:106},'UNCONFIRMED','INTRADAY_TRIGGER_AND_STOP_ORDER_UNCONFIRMED'],
  [{open:103,high:104,low:100,close:102},'NOT_ENTERED','TRIGGER_NOT_REACHED'],
 ]){const {args}=fixture();editBar(args,3,change);const r=await replayDailyAiShortMethod(args);assert.equal(r.rows[0].state,state);assert.equal(r.rows[0].reason,reason);assert.equal(r.rows[0].net_return,null);}
});

test('complete sourced event lists permit clear windows and exclude every crossing without inferring cash entitlements',async()=>{
 const {args,days}=fixture(),ca=args.packets[0].evidence.at(-1),body=JSON.parse(ca.content);
 Object.assign(body,{status:'EVENTS',complete:true,coverage_kinds:[...SHORT_ACTION_KINDS],events:[]});ca.content=JSON.stringify(body);
 assert.equal((await replayDailyAiShortMethod(args)).rows[0].state,'MODELLED');
 body.events=[{symbol:'2330',effective_date:days[1],kind:'CASH_DIVIDEND',source_ref:ca.source}];ca.content=JSON.stringify(body);
 let r=await replayDailyAiShortMethod(args);assert.equal(r.rows[0].state,'EXCLUDED');assert.equal(r.rows[0].net_return,null);
 body.complete=false;ca.content=JSON.stringify(body);r=await replayDailyAiShortMethod(args);
 assert.equal(r.rows[0].reason,'CORPORATE_ACTION_IN_SIGNAL_OR_HOLDING_WINDOW');assert.equal(r.counts.modelled,0);
 body.events=[];
 body.complete=true;body.coverage_kinds=['CASH_DIVIDEND'];ca.content=JSON.stringify(body);
 assert.equal((await replayDailyAiShortMethod(args)).rows[0].reason,'COMPLETE_CORPORATE_ACTION_HISTORY_REQUIRED');
});

test('missing execution costs, trading sessions and same-price queues remain explicit unavailable results',async()=>{
 const f=fixture();f.args.cost_model=null;assert.equal((await replayDailyAiShortMethod(f.args)).rows[0].reason,'EXPLICIT_COST_MODEL_REQUIRED');
 const g=fixture();g.args.packets[0].evidence.splice(3,1);assert.equal((await replayDailyAiShortMethod(g.args)).rows[0].reason,'HOLDING_WINDOW_NOT_AVAILABLE');
 const h=fixture();editBar(h.args,4,{open:90,high:90,low:90,close:90});assert.equal((await replayDailyAiShortMethod(h.args)).rows[0].state,'UNCONFIRMED');
 const j=fixture();j.args.cost_model.rounding='NONE';await assert.rejects(()=>replayDailyAiShortMethod(j.args),/SHORT_REPLAY_COST_MODEL/);
});

test('explicitly incomplete no-action assertions and narrower positive event evidence cannot become clear coverage',async()=>{
 for(const flag of [false,null,'false']){
  const incomplete=fixture(),ca=incomplete.args.packets[0].evidence.at(-1),body=JSON.parse(ca.content);body.complete=flag;ca.content=JSON.stringify(body);
  assert.equal((await replayDailyAiShortMethod(incomplete.args)).rows[0].reason,'COMPLETE_CORPORATE_ACTION_HISTORY_REQUIRED');
 }
 for(const policy of ['REQUIRE_NO_ACTIONS_FULL_HISTORY','RAW_EXCLUDE_EVENT_WINDOWS']){
  const {args,days}=fixture();args.corporate_action_policy=policy;const original=args.packets[0].evidence.at(-1);
  const positive={kind:'CORPORATE_ACTION_INVENTORY',symbol:'2330',from:days[3],through:days[3],complete:false,
   events:[{symbol:'2330',effective_date:days[3],kind:'EX_RIGHT',source_ref:original.source}]};
  args.packets[0].evidence.push({...original,id:'narrow-incomplete-positive',content:JSON.stringify(positive)});
  const r=await replayDailyAiShortMethod(args);assert.equal(r.rows[0].state,'EXCLUDED');assert.equal(r.rows[0].net_return,null);
  assert.equal(r.rows[0].action_coverage.overlapping_events[0].effective_date,days[3]);
 }
});
