import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDailyAiPricePlan,PriceCalculationError,PRICE_CALCULATION_METHODS} from '../research/daily-ai-price-calculation.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {dailyAiPriceDisplay} from '../src/features/vnext/dailyAiPriceDisplay.ts';

const now=Date.parse('2026-11-10T00:00:00Z');
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const source=(id,kind,content,day='2026-11-09')=>({id,symbol:'2330',kind,source:'https://www.twse.com.tw/',
 published_at:day+'T09:00:00Z',available_at:day+'T09:00:00Z',time_basis:'PUBLISHED',content:JSON.stringify(content)});
const common=()=>({schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol:'2330',horizon:'MEDIUM',
 cutoff:'2026-11-09T22:00:00Z',data_through:'2026-11-09',as_of:'2026-11-10T00:00:00Z',expires_at:'2026-11-10T05:30:00Z',currency:'TWD',
 method_id:PRICE_CALCULATION_METHODS.MEDIUM,quote_evidence_id:'P3',evidence:[source('P3','PRICE',{date:'2026-11-09',close:105,currency:'TWD',price_basis:'RAW_UNADJUSTED'}),
  source('F1','FINANCIAL',{kind:'SYNTHETIC_FINANCIAL_CONTEXT',note:'Synthetic numbers test arithmetic only; no issuer forecast is claimed.'})],
 assumption_basis:{available_at:'2026-11-09T21:00:00Z',description:'SYNTHETIC TEST ONLY: every EPS, PE, discount and FCFE value is an explicit unapproved arithmetic assumption.',evidence_ids:['F1']},
 invalidation:'測試假設或稀釋基準改變時停止沿用；不是正式股票建議。'});
function medium(){return {...common(),parameters:{earnings_basis:'FORWARD_12_MONTH_DILUTED_EPS',forecast_period:{start:'2026-11-10',end:'2027-11-09'},
 dilution_basis:{description:'Synthetic per-diluted-common-share assumption; not actual share data.',evidence_ids:['F1']},
 scenarios:[{name:'conservative',eps:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:12,pe:14}],
 entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F1']}};}
function long(){const m=medium();return {...m,horizon:'LONG',method_id:PRICE_CALCULATION_METHODS.LONG,
 parameters:{cashflow_basis:'FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI',timing:'END_OF_YEAR',dilution_basis:m.parameters.dilution_basis,
 scenarios:['conservative','base','upside'].map((name,i)=>({name,cashflows:Array(5).fill(8+2*i),discount_rate:.1,terminal:{next_fcfe:8+2*i,growth:0}})),
 entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F1']}};}
function short(){const m=common(),dates=['2026-11-05','2026-11-06','2026-11-09'];return {...m,horizon:'SHORT',method_id:PRICE_CALCULATION_METHODS.SHORT,
 evidence:[...[[100,102,98,100],[100,104,99,103],[103,106,102,105]].map((v,i)=>source('P'+(i+1),'PRICE',{
  date:dates[i],open:v[0],high:v[1],low:v[2],close:v[3],session_scope:'SYNTHETIC_COMPLETE_DAY',currency:'TWD',price_basis:'RAW_UNADJUSTED'},dates[i])),
 m.evidence[1],source('A1','NEWS',{kind:'CORPORATE_ACTION_COVERAGE',symbol:'2330',from:dates[0],through:dates[2],status:'NO_ACTIONS',price_basis:'RAW_UNADJUSTED'})],
 parameters:{bar_evidence_ids:['P1','P2','P3'],expected_sessions:dates,atr_period:2,breakout_lookback:2,trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK',
 entry_atr_width:.5,stop_atr_multiple:2,tick_size:.5,corporate_actions_evidence_id:'A1'}};}

test('medium golden: explicit diluted EPS times PE and explicit discount determine the range',async()=>{
 const input=medium(),result=await calculateDailyAiPricePlan(input,now);
 assert.deepEqual(result.entry_range,[64,96]);assert.equal(result.wait_above,96);assert.equal(result.stop_kind,'EVENT');assert.equal(result.stop,null);
 assert.deepEqual(result.trace.scenarios.map(s=>s.value),[80,120,168]);assert.equal(result.production_eligible,false);assert.equal(result.review,null);
 assert.equal(result.status,'CALCULATED_REVIEW_REQUIRED');assert.equal(result.buy_ready,false);
 assert.match(result.trace.scenarios[0].classification,/ASSUMPTION/);assert.equal(result.method_note.source_use_scope,'PRIVATE_RESEARCH_ONLY');
});
test('long golden: a constant annual FCFE perpetuity is cash divided by required return',async()=>{
 const result=await calculateDailyAiPricePlan(long(),now);
 result.trace.scenarios.forEach((s,i)=>near(s.value,(8+2*i)/.1));near(result.entry_range[0],64);near(result.entry_range[1],80);
 const base=result.trace.scenarios[1];near(base.explicit_period_pv,10*(1-(1.1)**-5)/.1);near(base.terminal.present_value,100/(1.1)**5);
 near(base.terminal_fraction,base.terminal.present_value/100);
});
test('long golden: year-five cash and a separately supplied terminal cash are discounted at year five',async()=>{
 const input=long();input.parameters.scenarios.forEach((s,i)=>{s.cashflows=[0,0,0,0,100*(i+1)];s.terminal=null;});
 const result=await calculateDailyAiPricePlan(input,now);near(result.trace.scenarios[0].value,100/(1.1)**5);
 assert.equal(result.trace.scenarios[0].terminal,null);
 const withTerminal=long();withTerminal.parameters.scenarios.forEach((s,i)=>{s.cashflows=[0,0,0,0,100*(i+1)];s.terminal={next_fcfe:10*(i+1),growth:.02};});
 const terminalResult=await calculateDailyAiPricePlan(withTerminal,now);
 near(terminalResult.trace.scenarios[0].value,(100+10/(.1-.02))/(1.1)**5);
});
test('short golden: actual cited OHLC -> true ranges -> ATR -> rounded trigger, upper and stop',async()=>{
 const result=await calculateDailyAiPricePlan(short(),now);
 assert.deepEqual(result.trace.true_ranges,[5,4]);near(result.trace.atr,4.5);near(result.trace.prior_window_high,104);
 assert.deepEqual(result.entry_range,[104.5,106.5]);assert.equal(result.wait_above,106.5);assert.equal(result.stop_kind,'PRICE');assert.equal(result.stop,95.5);
 assert(result.evidence_ids.includes('A1'));assert.deepEqual(result.stop_evidence_ids,['P1','P2','P3']);
});
test('hashes bind the entire calculation, exact input and each complete packet source',async()=>{
 const input=medium(),before=structuredClone(input),result=await calculateDailyAiPricePlan(input,now),{calculation_hash,...payload}=result;
 assert.equal(result.input_hash,await snapshotHash(input));assert.equal(calculation_hash,await snapshotHash(payload));
 assert.equal(result.assumption_hash,await snapshotHash({method_id:input.method_id,assumption_basis:input.assumption_basis,parameters:input.parameters}));
 for(const binding of result.evidence_bindings)assert.equal(binding.evidence_hash,await snapshotHash(input.evidence.find(e=>e.id===binding.id)));
 assert.deepEqual(input,before);assert(Object.isFrozen(result));assert(Object.isFrozen(result.trace.scenarios));
 input.parameters.scenarios[0].eps=9;const changed=await calculateDailyAiPricePlan(input,now);
 assert.notEqual(changed.input_hash,result.input_hash);assert.notEqual(changed.calculation_hash,result.calculation_hash);
 assert.notEqual(changed.assumption_hash,result.assumption_hash);
});
test('input ownership is acquired before async hashes so concurrent mutation cannot change a receipt',async()=>{
 const input=medium(),expected=structuredClone(input),pending=calculateDailyAiPricePlan(input,now);
 input.parameters.scenarios[0].eps=999;input.evidence[0].content='changed';
 const result=await pending;assert.equal(result.input_hash,await snapshotHash(expected));assert.deepEqual(result.entry_range,[64,96]);
});
test('missing numerical assumptions return actionable fields and are never defaulted',async()=>{
 const input=medium();delete input.parameters.scenarios[0].eps;
 await assert.rejects(()=>calculateDailyAiPricePlan(input,now),e=>e instanceof PriceCalculationError&&e.code==='PRICE_CALCULATION_MISSING_INPUT'&&e.field==='parameters.scenarios[0].eps');
 for(const fixture of [medium,long,short]){const missing=fixture();delete missing.parameters;
  await assert.rejects(()=>calculateDailyAiPricePlan(missing,now),e=>e.code==='PRICE_CALCULATION_MISSING_INPUT');}
});
test('currency, symbol, stale quotes and fractional source times cannot be laundered by recomputing hashes',async()=>{
 for(const mutate of [x=>{x.currency='USD';},x=>{x.evidence[0].symbol='2454';},x=>{x.data_through='2026-11-06';},
  x=>{x.evidence[0].available_at='2026-11-09T22:00:00.000001Z';},x=>{x.evidence[0].content=JSON.stringify({date:'2026-11-09',close:105,currency:'USD'});},
  x=>{x.assumption_basis.available_at='2026-11-10T00:00:00.000001Z';},x=>{x.expires_at=x.as_of;},
 ]){const input=medium();mutate(input);await assert.rejects(()=>calculateDailyAiPricePlan(input,now),PriceCalculationError);}
});
test('short rejects a missing session, a duplicated bar, mixed price basis and unverified corporate actions',async()=>{
 for(const mutate of [x=>{x.parameters.expected_sessions[1]='2026-11-07';},x=>{x.parameters.bar_evidence_ids[1]='P1';},
  x=>{const b=JSON.parse(x.evidence[1].content);b.price_basis='ADJUSTED';x.evidence[1].content=JSON.stringify(b);},
  x=>{const c=JSON.parse(x.evidence.at(-1).content);c.status='UNKNOWN';x.evidence.at(-1).content=JSON.stringify(c);},
  x=>{const c=JSON.parse(x.evidence.at(-1).content);c.from='2026-11-06';x.evidence.at(-1).content=JSON.stringify(c);},
  x=>{const b=JSON.parse(x.evidence[0].content);b.low=103;x.evidence[0].content=JSON.stringify(b);},
 ]){const input=short();mutate(input);await assert.rejects(()=>calculateDailyAiPricePlan(input,now),PriceCalculationError);}
});
test('a no-action record cannot assert completed coverage of a future or not-yet-observed session',async()=>{
 for(const change of [
  evidence=>{const body=JSON.parse(evidence.content);body.through='2026-11-10';evidence.content=JSON.stringify(body);},
  evidence=>{evidence.as_of='2026-11-09T04:00:00Z';},
  evidence=>{evidence.published_at='2026-11-09T04:00:00Z';evidence.available_at='2026-11-09T04:00:00Z';},
 ]){
  const input=short();change(input.evidence.at(-1));
  await assert.rejects(()=>calculateDailyAiPricePlan(input,now),error=>error.code==='PRICE_CALCULATION_ACTION_COVERAGE_TIME');
 }
});
test('medium rejects basic/cumulative earnings, implicit dilution and incompatible forecast periods',async()=>{
 for(const mutate of [x=>{x.parameters.earnings_basis='BASIC_REPORTED_EPS';},x=>{x.parameters.forecast_period.end='2026-12-31';},
  x=>{delete x.parameters.dilution_basis;},x=>{x.parameters.dilution_basis.evidence_ids=['P3'];},
  x=>{x.parameters.scenarios[0].eps=-1;},x=>{x.parameters.scenarios[1].pe=Infinity;},
 ]){const input=medium();mutate(input);await assert.rejects(()=>calculateDailyAiPricePlan(input,now),PriceCalculationError);}
});
test('long rejects EPS/CFO proxies, r <= g, missing terminal cash and inconsistent annual horizons',async()=>{
 for(const mutate of [x=>{x.parameters.cashflow_basis='EPS';},x=>{x.parameters.scenarios[0].terminal.growth=.1;},
  x=>{x.parameters.scenarios[0].terminal.next_fcfe=0;},x=>{delete x.parameters.scenarios[0].terminal.next_fcfe;},
  x=>{x.parameters.scenarios[0].cashflows=[10];},x=>{x.parameters.scenarios[0].discount_rate=0;},
 ]){const input=long();mutate(input);await assert.rejects(()=>calculateDailyAiPricePlan(input,now),PriceCalculationError);}
});
test('negative explicit cash is kept and all years include reinvestment rather than being normalized away',async()=>{
 const input=long();input.parameters.scenarios.forEach((s,i)=>{s.cashflows=[-10*(i+1),20*(i+1)];s.terminal=null;});
 const result=await calculateDailyAiPricePlan(input,now);near(result.trace.scenarios[0].value,-10/1.1+20/1.1**2);
 assert.equal(result.trace.scenarios[0].discounted_cashflows[0].fcfe,-10);
});
test('explicit scenario endpoint selection and no hidden optimistic reordering',async()=>{
 const input=medium();input.parameters.entry_scenarios=['base','upside'];const result=await calculateDailyAiPricePlan(input,now);assert.deepEqual(result.entry_range,[96,134.4]);
 for(const mutate of [x=>{x.parameters.entry_scenarios=['upside','conservative'];},x=>{x.parameters.margin_of_safety=1;},
  x=>{x.parameters.scenarios[0].eps=100;},x=>{x.parameters.stop_evidence_ids=['P3'];},x=>{x.parameters.hidden_discount=.5;},
 ]){const broken=medium();mutate(broken);await assert.rejects(()=>calculateDailyAiPricePlan(broken,now),PriceCalculationError);}
});
test('an unsupported legacy policy cannot become a new supported calculator by relabeling its horizon',async()=>{
 const input=long();input.method_id='2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1';
 await assert.rejects(()=>calculateDailyAiPricePlan(input,now),e=>e.code==='PRICE_CALCULATION_METHOD_MISMATCH');
});
test('method quantization retains raw values and produces thresholds the existing member display can show exactly',async()=>{
 const input=medium();input.parameters.scenarios=[{name:'conservative',eps:8.12345,pe:10},{name:'base',eps:10.12345,pe:12},{name:'upside',eps:12.12345,pe:14}];
 const result=await calculateDailyAiPricePlan(input,now);assert.deepEqual(result.entry_range,[64.98,97.18]);near(result.trace.scenarios[0].value,81.2345);
 assert.equal(result.trace.selection.quantization.purpose,'RESEARCH_DISPLAY_PRECISION_NOT_EXCHANGE_TICK');
 assert.deepEqual(dailyAiPriceDisplay(result).entry_range,['64.98','97.18']);
 for(const fixture of [short,medium,long])assert(dailyAiPriceDisplay(await calculateDailyAiPricePlan(fixture(),now)));
});
test('short decimal tick arithmetic never turns 0.2 + 0.1 into an extra tick',async()=>{
 const input=short(),values=[[.1,.2,.05,.1],[.1,.2,.05,.15],[.15,.25,.1,.2]];
 input.evidence.slice(0,3).forEach((e,i)=>{const b=JSON.parse(e.content);[b.open,b.high,b.low,b.close]=values[i];e.content=JSON.stringify(b);});
 input.parameters.tick_size=.1;input.parameters.entry_atr_width=2;input.parameters.stop_atr_multiple=1;
 const result=await calculateDailyAiPricePlan(input,now);assert.deepEqual(result.entry_range,[.3,.6]);assert.equal(result.stop,.1);assert(dailyAiPriceDisplay(result));
 input.parameters.tick_size=.001;await assert.rejects(()=>calculateDailyAiPricePlan(input,now),e=>e.field==='parameters.tick_size');
});
test('the daily data selection uses the existing 17:05 completed-data boundary',async()=>{
 const early=medium();early.cutoff='2026-11-10T08:00:00Z';early.as_of='2026-11-10T08:01:00Z';early.expires_at='2026-11-11T05:30:00Z';
 assert(await calculateDailyAiPricePlan(early,Date.parse(early.as_of)));
 const after=structuredClone(early);after.cutoff='2026-11-10T09:05:00Z';after.as_of='2026-11-10T09:06:00Z';
 await assert.rejects(()=>calculateDailyAiPricePlan(after,Date.parse(after.as_of)),e=>e.code==='PRICE_CALCULATION_STALE_QUOTE');
});
test('a 366-day interval is rejected if it is not the specified exact twelve-month period',async()=>{
 const input=medium();input.parameters.forecast_period.end='2027-11-10';
 await assert.rejects(()=>calculateDailyAiPricePlan(input,now),e=>e.field==='parameters.forecast_period');
});
test('assumptions may form after frozen sources but never after calculation.as_of or backdate performance',async()=>{
 const before=medium(),beforeResult=await calculateDailyAiPricePlan(before,now);
 assert.equal(beforeResult.trace.temporal_scope.assumption_timing,'ASSUMPTIONS_AVAILABLE_BY_SOURCE_CUTOFF');
 const after=medium();after.assumption_basis.available_at='2026-11-09T23:00:00Z';
 const afterResult=await calculateDailyAiPricePlan(after,now);
 assert.equal(afterResult.trace.temporal_scope.assumption_timing,'ASSUMPTIONS_FORMED_AFTER_SOURCE_CUTOFF');
 assert.equal(afterResult.trace.temporal_scope.assumptions_available_at,after.assumption_basis.available_at);
 assert.equal(afterResult.cutoff,before.cutoff);assert.equal(afterResult.as_of,before.as_of);
 assert.equal(afterResult.forecast,false);assert.equal(afterResult.performance_available,false);
 assert(afterResult.method_note.limitations.some(s=>s.startsWith('ASSUMPTIONS_FORMED_AFTER_SOURCE_CUTOFF')));
 assert.notEqual(afterResult.assumption_hash,beforeResult.assumption_hash);
 const tooLate=medium();tooLate.assumption_basis.available_at='2026-11-10T00:00:00.000001Z';
 await assert.rejects(()=>calculateDailyAiPricePlan(tooLate,now),e=>e.code==='PRICE_CALCULATION_ASSUMPTION_TIME');
 // A later analysis time never permits later source observations into cutoff.
 const lateSource=structuredClone(after);lateSource.evidence[0].available_at='2026-11-09T22:00:00.000001Z';
 await assert.rejects(()=>calculateDailyAiPricePlan(lateSource,now),e=>e.code==='PRICE_CALCULATION_SOURCE_TIME');
});
test('a fixed-period diluted EPS assumption remains anchored and is rejected after its explicit period ends',async()=>{
 const input=medium();input.parameters.earnings_basis='FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION';
 input.parameters.forecast_period={start:'2026-01-01',end:'2026-12-31'};
 const result=await calculateDailyAiPricePlan(input,now);assert.deepEqual(result.entry_range,[64,96]);
 assert.equal(result.trace.earnings_basis,'FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION');assert.deepEqual(result.trace.forecast_period,input.parameters.forecast_period);
 const expired=medium();expired.parameters.earnings_basis='FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION';expired.parameters.forecast_period={start:'2025-11-09',end:'2026-11-08'};
 await assert.rejects(()=>calculateDailyAiPricePlan(expired,now),e=>e.field==='parameters.forecast_period');
 const forward=structuredClone(input);forward.parameters.earnings_basis='FORWARD_12_MONTH_DILUTED_EPS';
 await assert.rejects(()=>calculateDailyAiPricePlan(forward,now),e=>e.field==='parameters.forecast_period');
});
