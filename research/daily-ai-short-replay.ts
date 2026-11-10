/** Retrospective execution experiment for the explicit SHORT ATR method.
 * Data receipt times are preserved. Nothing here is a prospective lock,
 * an actual fill, a source-use approval or a publishable recommendation. */
import {compareTime,snapshotHash} from '../src/features/vnext/contracts.ts';
import type {AnalysisPacket,AnalysisEvidence} from './daily-ai-analysis.ts';
import {assessDailyAiShortCalibration,shortActionCoverageForWindow,type ShortCalibrationMethod,type ShortCorporateActionPolicy} from './daily-ai-short-calibration.ts';
import {nextEntrySession} from './entry-opportunity.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

type Bar={date:string;open:number;high:number;low:number;close:number;volume:number;amount:number;available_at:string;evidence_ids:string[]};
export type ShortReplayCosts={version:string;quantity:number;minimum_fee_twd:number;buy_fee:number;sell_fee:number;
 sell_tax:number;slippage_each_side:number;rounding:'CEIL_TWD'};
type Fraction={n:bigint;d:bigint};
const gcd=(a:bigint,b:bigint):bigint=>b?gcd(b,a%b):a;
const rational=(n:bigint,d=1n):Fraction=>{const g=gcd(n<0n?-n:n,d);return {n:n/g,d:d/g};};
function fraction(v:number):Fraction{
 if(!Number.isFinite(v))throw Error('SHORT_REPLAY_NUMBER');
 const [base,exponent='0']=String(v).toLowerCase().split('e'),parts=base.split('.'),scale=(parts[1]?.length??0)-Number(exponent);
 const n=BigInt(parts.join(''));return scale>=0?rational(n,10n**BigInt(scale)):rational(n*10n**BigInt(-scale));
}
const add=(a:Fraction,b:Fraction)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a:Fraction,b:Fraction)=>rational(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a:Fraction,b:Fraction)=>rational(a.n*b.n,a.d*b.d);
const div=(a:Fraction,b:Fraction)=>rational(a.n*b.d,a.d*b.n);
const floor=(a:Fraction)=>a.n>=0n?a.n/a.d:-((-a.n+a.d-1n)/a.d);
const ceil=(a:Fraction)=>-floor({n:-a.n,d:a.d});
const value=(a:Fraction)=>Number(a.n)/Number(a.d);
const abs=(a:Fraction)=>({n:a.n<0n?-a.n:a.n,d:a.d});
const max=(a:Fraction,b:Fraction)=>a.n*b.d>=b.n*a.d?a:b;

/** Same explicit geometry as the calculator; all quantization is rational.
 * The caller supplies exactly period+1 bars ending on the signal date. */
export function calculateShortReplayGeometry(bars:Pick<Bar,'open'|'high'|'low'|'close'>[],method:ShortCalibrationMethod){
 const p=method.parameters;
 if(method.method_id!=='SHORT_ATR_CONDITIONAL_V1'||p.trigger_rule!=='PRIOR_WINDOW_HIGH_PLUS_TICK'
  ||!Number.isSafeInteger(p.atr_period)||p.atr_period<2||p.atr_period>60||bars.length!==p.atr_period+1
  ||!Number.isSafeInteger(p.breakout_lookback)||p.breakout_lookback<2||p.breakout_lookback>p.atr_period
  ||![p.entry_atr_width,p.stop_atr_multiple,p.tick_size].every(Number.isFinite)||p.entry_atr_width<0||p.stop_atr_multiple<=0||p.tick_size<=0
  ||bars.some(b=>![b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))throw Error('SHORT_REPLAY_GEOMETRY_INPUT');
 const trueRanges=bars.slice(1).map((b,i)=>[sub(fraction(b.high),fraction(b.low)),abs(sub(fraction(b.high),fraction(bars[i].close))),
  abs(sub(fraction(b.low),fraction(bars[i].close)))].reduce(max));
 const atr=div(trueRanges.reduce(add,rational(0n)),fraction(p.atr_period));
 const resistance=Math.max(...bars.slice(-p.breakout_lookback-1,-1).map(b=>b.high)),tick=fraction(p.tick_size),tickCents=mul(tick,rational(100n));
 if(tickCents.d!==1n)throw Error('SHORT_REPLAY_TICK');
 const trigger=mul(rational(ceil(div(add(fraction(resistance),tick),tick))),tick);
 const upper=mul(rational(floor(div(add(trigger,mul(atr,fraction(p.entry_atr_width))),tick))),tick);
 const stop=mul(rational(floor(div(sub(trigger,mul(atr,fraction(p.stop_atr_multiple))),tick))),tick);
 const result={atr:value(atr),prior_window_high:resistance,entry_range:[value(trigger),value(upper)] as [number,number],stop:value(stop)};
 if(![result.atr,...result.entry_range,result.stop].every(Number.isFinite)||result.atr<=0||result.stop<=0||result.stop>=result.entry_range[0])throw Error('SHORT_REPLAY_GEOMETRY_INVALID');
 return result;
}
function validateCosts(c:ShortReplayCosts|null){
 if(c===null)return;
 if(!c||Object.keys(c).sort().join('|')!==['version','quantity','minimum_fee_twd','buy_fee','sell_fee','sell_tax','slippage_each_side','rounding'].sort().join('|')
  ||typeof c.version!=='string'||!c.version.trim()||c.rounding!=='CEIL_TWD'||!Number.isSafeInteger(c.quantity)||c.quantity<1
  ||!Number.isFinite(c.minimum_fee_twd)||c.minimum_fee_twd<0
  ||![c.buy_fee,c.sell_fee,c.sell_tax,c.slippage_each_side].every(v=>Number.isFinite(v)&&v>=0&&v<1))throw Error('SHORT_REPLAY_COST_MODEL');
}

export async function replayDailyAiShortMethod(args:{symbol:string;packets:AnalysisPacket[];method:ShortCalibrationMethod;
 holding_sessions:number[];as_of:string;provenance:'REAL_RETAINED'|'SYNTHETIC_TEST';corporate_action_policy:ShortCorporateActionPolicy;cost_model:ShortReplayCosts|null}){
 const a=structuredClone(args);validateCosts(a.cost_model);
 const qualification=await assessDailyAiShortCalibration({...a,protocol:null});
 if(qualification.issues.some(i=>['CONFLICTING_PRICE_OBSERVATIONS','MIXED_HISTORY_SESSION_SCOPE'].includes(i.code)))throw Error('SHORT_REPLAY_AMBIGUOUS_HISTORY');
 const evidence=a.packets.flatMap(p=>p.evidence),other=evidence.filter(e=>e.kind!=='PRICE'),byDate=new Map<string,Bar>();
 for(const e of evidence.filter(e=>e.kind==='PRICE')){
  const b=JSON.parse(e.content),old=byDate.get(b.date),row={...b,available_at:e.available_at,evidence_ids:[e.id]};
  if(!old)byDate.set(b.date,row);
  else{old.evidence_ids.push(e.id);if(compareTime(e.available_at,old.available_at)<0)old.available_at=e.available_at;}
 }
 const bars=[...byDate.values()].sort((x,y)=>x.date.localeCompare(y.date)),warmup=a.method.parameters.atr_period+1,rows:Record<string,any>[]=[];
 for(let i=warmup-1;i<bars.length;i++)for(const horizon of [...a.holding_sessions].sort((x,y)=>x-y)){
  const signal=bars[i],history=bars.slice(i-warmup+1,i+1),entryDate=nextEntrySession(signal.date),outcomeDates=[entryDate];
  while(outcomeDates.length<horizon)outcomeDates.push(nextEntrySession(outcomeDates.at(-1)!));
  const base:Record<string,any>={signal_date:signal.date,entry_date:entryDate,horizon,through:outcomeDates.at(-1),
   historical_window:history.map(b=>b.date),source_known_before_entry:history.every(b=>compareTime(b.available_at,entryDate+'T09:00:00+08:00')<0),
   source_time_scope:'PRICE_WINDOW_ONLY_NOT_PROSPECTIVE_EVENT_KNOWLEDGE',
   source_evidence_ids:history.flatMap(b=>b.evidence_ids),geometry:null,state:'UNAVAILABLE',reason:null,
   entry_price:null,exit_price:null,net_return:null,actual_fill_confirmed:false,performance_eligible:false};
  const finish=(state:string,reason:string,extra:Record<string,unknown>={})=>rows.push({...base,state,reason,...extra});
  if(history.some((b,j)=>j>0&&previousMarketTradingDate('TW',b.date)!==history[j-1].date)){finish('UNAVAILABLE','SIGNAL_HISTORY_SESSION_GAP');continue;}
  try{base.geometry=calculateShortReplayGeometry(history,a.method);}catch(e){if(!(e instanceof Error)||e.message!=='SHORT_REPLAY_GEOMETRY_INVALID')throw e;finish('UNAVAILABLE',e.message);continue;}
  const future=outcomeDates.map(d=>byDate.get(d));
  if(future.some(b=>!b)||compareTime(a.as_of,outcomeDates.at(-1)!+'T13:30:00+08:00')<0){finish('UNAVAILABLE','HOLDING_WINDOW_NOT_AVAILABLE');continue;}
  const outcome=future as Bar[],first=outcome[0],g=base.geometry as ReturnType<typeof calculateShortReplayGeometry>,[trigger,upper]=g.entry_range;
  base.hypothetical_open_condition=first.open<=g.stop?'BELOW_STOP':first.open>upper?'ABOVE_RANGE':first.open<trigger?'BELOW_TRIGGER':'WITHIN_RANGE';
  const action=await shortActionCoverageForWindow(other,a.symbol,history[0].date,outcomeDates.at(-1)!,a.corporate_action_policy);
  base.action_coverage=action;
  if(action.overlapping_events.length){finish('EXCLUDED','CORPORATE_ACTION_IN_SIGNAL_OR_HOLDING_WINDOW');continue;}
  if(!action.complete){finish('UNAVAILABLE','COMPLETE_CORPORATE_ACTION_HISTORY_REQUIRED');continue;}
  if(first.open<=g.stop){finish('NOT_ENTERED','INVALIDATED_BEFORE_ENTRY');continue;}
  if(first.open>upper){finish('NOT_ENTERED','OPENING_GAP_OUTSIDE_LOCKED_RANGE_NO_CHASE');continue;}
  if(first.open<trigger){finish(first.high>=trigger?'UNCONFIRMED':'NOT_ENTERED',first.high>=trigger?'INTRADAY_TRIGGER_AND_STOP_ORDER_UNCONFIRMED':'TRIGGER_NOT_REACHED');continue;}
  if(first.open===first.high&&first.high===first.low&&first.low===first.close){finish('UNCONFIRMED','SINGLE_PRICE_SESSION_QUEUE_UNCONFIRMED');continue;}
  const costs=a.cost_model;if(!costs){finish('UNAVAILABLE','EXPLICIT_COST_MODEL_REQUIRED');continue;}
  const fill=mul(fraction(first.open),add(rational(1n),fraction(costs.slippage_each_side)));
  if(value(fill)>upper){finish('NOT_ENTERED','SLIPPAGE_EXCEEDS_ENTRY_RANGE');continue;}
  let exit=outcome.at(-1)!.close,exitIndex=horizon-1,stopHit=false,ambiguous=false;
  for(let j=0;j<outcome.length;j++){
   const b=outcome[j];
   if(b.open===b.high&&b.high===b.low&&b.low===b.close&&(b.low<=g.stop||j===outcome.length-1)){ambiguous=true;break;}
   if(j>0&&b.open<=g.stop){exit=b.open;exitIndex=j;stopHit=true;break;}
   if(b.low<=g.stop){exit=g.stop;exitIndex=j;stopHit=true;break;}
  }
  if(ambiguous){finish('UNCONFIRMED','EXIT_SINGLE_PRICE_SESSION_QUEUE_UNCONFIRMED');continue;}
  const exitFill=mul(fraction(exit),sub(rational(1n),fraction(costs.slippage_each_side))),q=fraction(costs.quantity);
  const buy=mul(fill,q),sell=mul(exitFill,q),buyFee=ceil(max(fraction(costs.minimum_fee_twd),mul(buy,fraction(costs.buy_fee)))),
   sellFee=ceil(max(fraction(costs.minimum_fee_twd),mul(sell,fraction(costs.sell_fee)))),tax=ceil(mul(sell,fraction(costs.sell_tax)));
  const invested=add(buy,rational(buyFee)),proceeds=sub(sub(sell,rational(sellFee)),rational(tax)),net=sub(div(proceeds,invested),rational(1n));
  if(![value(fill),value(exitFill),value(net),Number(buyFee),Number(sellFee),Number(tax)].every(Number.isFinite))throw Error('SHORT_REPLAY_NONFINITE_RESULT');
  finish('MODELLED','RETROSPECTIVE_DAILY_OPEN_HYPOTHESIS',{entry_price:value(fill),exit_price:value(exitFill),raw_exit_price:exit,
   exit_date:outcome[exitIndex].date,stop_hit:stopHit,buy_fee_twd:Number(buyFee),sell_fee_twd:Number(sellFee),sell_tax_twd:Number(tax),
   gross_price_return:value(sub(div(fraction(exit),fraction(first.open)),rational(1n))),net_return:value(net),
   invested_twd:value(invested),net_proceeds_twd:value(proceeds),execution_scope:'ASSUMED_FILLS_NOT_CONFIRMED_TRADES'});
 }
 const body={schema:'DAILY_AI_SHORT_REPLAY_RESULT_V1',symbol:a.symbol,as_of:a.as_of,provenance:a.provenance,
  mode:'POSTHOC_FIXED_METHOD_REPLAY',method:a.method,method_hash:await snapshotHash(a.method),input_hash:await snapshotHash(a),qualification_hash:qualification.qualification_hash,
  corporate_action_policy:a.corporate_action_policy,cost_model:a.cost_model,cost_classification:'EXPLICIT_MODEL_ASSUMPTIONS_NOT_VERIFIED_ACCOUNT_CHARGES',
  hypothesis_formed_at:a.as_of,protocol_backdated:false,rows,
  counts:{windows:rows.length,modelled:rows.filter(r=>r.state==='MODELLED').length,excluded:rows.filter(r=>r.state==='EXCLUDED').length,
   unconfirmed:rows.filter(r=>r.state==='UNCONFIRMED').length,unavailable:rows.filter(r=>r.state==='UNAVAILABLE').length,not_entered:rows.filter(r=>r.state==='NOT_ENTERED').length},
  sampling:'ALL_SLIDING_SIGNAL_WINDOWS_OVERLAPPING_NOT_INDEPENDENT_SAMPLES',forward_performance_samples:0,
  actual_trade_win_rate:null,portfolio_total_return:null,portfolio_maximum_drawdown:null,baseline_comparison:null,
  strategy_calibrated:false,methodology_approved:false,source_use_approval:null,review:null,member_published:false,
  limitations:['No holdout or frozen pre-observation protocol is claimed.','One fixed research tick does not certify the exchange price-band schedule.',
   'Stop and horizon exits are model assumptions; no target is added. Daily bars cannot prove fills, queue priority or executable volume.',
   'No dividend or corporate-action adjustment is inferred. Complete event inventories permit only windows that exclude every event.',
   'Overlapping window returns are not multiplied into a portfolio return or counted as independent observations.']};
 return {...body,replay_hash:await snapshotHash(body)};
}
