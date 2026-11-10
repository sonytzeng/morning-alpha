/** Qualification of retained data for a SHORT method experiment. This is a
 * method-review prerequisite, not a backtest, a calibrated signal or a source
 * of win rates. Identical snapshots do not create independent observations. */
import {compareTime,snapshotHash,sourceSafe,validObservationTime} from '../src/features/vnext/contracts.ts';
import {validateAnalysisPacket,type AnalysisPacket,type AnalysisEvidence} from './daily-ai-analysis.ts';
import type {ShortCalculationInput} from './daily-ai-price-calculation.ts';
import {coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {nextEntrySession} from './entry-opportunity.ts';

export type ShortCalibrationMethod={method_id:'SHORT_ATR_CONDITIONAL_V1';parameters:Omit<ShortCalculationInput['parameters'],
 'bar_evidence_ids'|'expected_sessions'|'corporate_actions_evidence_id'>};
export type ShortCorporateActionPolicy='REQUIRE_NO_ACTIONS_FULL_HISTORY'|'RAW_EXCLUDE_EVENT_WINDOWS';
export const SHORT_ACTION_KINDS=['CASH_DIVIDEND','STOCK_DIVIDEND','SPLIT','RIGHTS','CAPITAL_REDUCTION'] as const;
type Period={from:string;through:string};
export type ShortCalibrationProtocol={schema:'SHORT_CALIBRATION_PROTOCOL_V1';version:string;declared_at:string;method_hash:string;
 train:Period;validation:Period;oos:Period;purge_sessions:number;
 minimums:{train_sessions:number;validation_sessions:number;oos_sessions:number;nonoverlapping_oos_windows:number};
 cost_model:null|{version:string;quantity:number;minimum_fee_twd:number;buy_fee:number;sell_fee:number;sell_tax:number;slippage_each_side:number};
 execution_policy:null|{version:string;entry:'NEXT_SESSION_OPEN_WITHIN_LOCKED_RANGE';ambiguous_intraday:'UNCONFIRMED';limit_lock:'UNCONFIRMED';tick_schedule_evidence_ids:string[]}};
type Row={date:string;open:number;high:number;low:number;close:number;volume:number;amount:number;session_scope:string;
 available_at:string;evidence_ids:string[]};
type Issue={code:string;field:string;detail:string};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function invalid(field:string):never{throw Error('SHORT_CALIBRATION_INVALID: '+field);}
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.freeze(v);for(const child of Object.values(v))freeze(child);}return v;};
function date(v:unknown,field:string):string{if(typeof v!=='string'||!/^20\d\d-\d\d-\d\d$/.test(v)||!validObservationTime(v+'T00:00:00Z')||!coveredCalendarDate('TW',v))invalid(field);return v as string;}
function exact(v:unknown,keys:string[],field:string):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))invalid(field);}
function integer(v:unknown,min:number,max:number,field:string):number{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)invalid(field);return v as number;}
function json(e:AnalysisEvidence):Record<string,unknown>{let v:unknown;try{v=JSON.parse(e.content);}catch{invalid('evidence.content');}if(!object(v))invalid('evidence.content');return v;}
function expected(period:Period):string[]{const from=date(period.from,'period.from'),through=date(period.through,'period.through');
 if(from>through||!isMarketTradingDate('TW',from)||!isMarketTradingDate('TW',through))invalid('period');
 const dates=[from];while(dates.at(-1)!<through){if(dates.length>5000)invalid('period.length');dates.push(nextEntrySession(dates.at(-1)!));}
 if(dates.at(-1)!==through)invalid('period');return dates;}
function validateMethod(method:ShortCalibrationMethod){
 exact(method,['method_id','parameters'],'method');if(method.method_id!=='SHORT_ATR_CONDITIONAL_V1')invalid('method.method_id');
 const p=method.parameters;exact(p,['atr_period','breakout_lookback','trigger_rule','entry_atr_width','stop_atr_multiple','tick_size'],'method.parameters');
 integer(p.atr_period,2,60,'method.atr_period');integer(p.breakout_lookback,2,p.atr_period as number,'method.breakout_lookback');
 if(p.trigger_rule!=='PRIOR_WINDOW_HIGH_PLUS_TICK'||!finite(p.entry_atr_width)||p.entry_atr_width<0||!finite(p.stop_atr_multiple)||p.stop_atr_multiple<=0
  ||!finite(p.tick_size)||p.tick_size<=0||!Number.isSafeInteger(Math.round(p.tick_size*100))
  ||Math.abs(p.tick_size*100-Math.round(p.tick_size*100))>1e-8)invalid('method.parameters');
}
/** A complete event inventory supports raw-price windows that do not touch
 * an event. It never supplies invented dividend cash or an adjustment factor. */
export async function shortActionCoverageForWindow(evidence:AnalysisEvidence[],symbol:string,from:string,through:string,policy:ShortCorporateActionPolicy){
 if(!['REQUIRE_NO_ACTIONS_FULL_HISTORY','RAW_EXCLUDE_EVENT_WINDOWS'].includes(policy))invalid('corporate_action_policy');
 const proofs:{evidence_id:string;evidence_hash:string;from:string;through:string;status:string}[]=[],events:{effective_date:string;kind:string;source_ref:string}[]=[];
 for(const e of evidence){let b:Record<string,unknown>;try{b=json(e);}catch{continue;}
  if(e.kind==='PRICE'||e.symbol!==symbol||b.symbol!==symbol||!['CORPORATE_ACTION_COVERAGE','CORPORATE_ACTION_INVENTORY'].includes(String(b.kind)))continue;
  // A narrower or incomplete inventory cannot prove absence, but its known
  // positive events still contradict a broader no-action assertion. Read
  // adverse evidence before selecting eligible coverage proofs or policies.
  if(Array.isArray(b.events))for(const v of b.events){
   if(object(v)&&v.symbol===symbol&&typeof v.effective_date==='string'&&validObservationTime(v.effective_date+'T00:00:00Z')
    &&typeof v.kind==='string'&&v.kind.trim()&&typeof v.source_ref==='string'&&sourceSafe(v.source_ref)
    &&(v.available_at===undefined||typeof v.available_at==='string'&&validObservationTime(v.available_at)&&compareTime(v.available_at,e.available_at)<=0))
    events.push({effective_date:v.effective_date,kind:v.kind,source_ref:v.source_ref});
  }
  if(b.kind!=='CORPORATE_ACTION_COVERAGE'||b.price_basis!=='RAW_UNADJUSTED'
   ||typeof b.from!=='string'||typeof b.through!=='string'||b.from>from||b.through<through
   ||!validObservationTime(b.from+'T00:00:00Z')||!validObservationTime(b.through+'T00:00:00Z'))continue;
  const observed=e.as_of??e.published_at??e.first_seen_at??e.available_at;
  if(compareTime(e.available_at,b.through+'T13:30:00+08:00')<0||compareTime(observed,b.through+'T13:30:00+08:00')<0)continue;
  if(b.status==='NO_ACTIONS'){
   if(Object.hasOwn(b,'complete')&&b.complete!==true||b.events!==undefined&&(!Array.isArray(b.events)||b.events.length))continue;
  }else{
   const coverageKinds=b.coverage_kinds;
   if(policy!=='RAW_EXCLUDE_EVENT_WINDOWS'||b.status!=='EVENTS'||b.complete!==true||!Array.isArray(b.events)
    ||!Array.isArray(coverageKinds)||new Set(coverageKinds).size!==SHORT_ACTION_KINDS.length
    ||SHORT_ACTION_KINDS.some(k=>!coverageKinds.includes(k)))continue;
   const valid=b.events.every(v=>object(v)&&v.symbol===symbol&&typeof v.effective_date==='string'
    &&validObservationTime(v.effective_date+'T00:00:00Z')&&v.effective_date>=b.from!&&v.effective_date<=b.through!
    &&SHORT_ACTION_KINDS.includes(v.kind as typeof SHORT_ACTION_KINDS[number])&&typeof v.source_ref==='string'&&sourceSafe(v.source_ref));
   if(!valid)continue;
  }
  proofs.push({evidence_id:e.id,evidence_hash:await snapshotHash(e),from:b.from,through:b.through,status:String(b.status)});
 }
 const overlaps=events.filter(e=>e.effective_date>=from&&e.effective_date<=through);
 return {complete:proofs.length>0,clear:proofs.length>0&&overlaps.length===0,proofs,
  event_dates:[...new Set(events.map(e=>e.effective_date))].sort(),overlapping_events:overlaps,
  policy,adjustment_applied:false,cash_entitlement_inferred:false};
}
function windows(rows:Row[],warmup:number,horizon:number,period:Period|null,eventDates:string[]=[]){
 const candidates:{signal_date:string;entry_date:string;through:string;source_known_before_entry:boolean;event_overlap:boolean;end_index:number;entry_index:number}[]=[];
 for(let index=warmup-1;index+horizon<rows.length;index++){
  const window=rows.slice(index-warmup+1,index+horizon+1);
  if(window.some((row,i)=>i>0&&previousMarketTradingDate('TW',row.date)!==window[i-1].date))continue;
  const entry=rows[index+1].date,end=rows[index+horizon].date;
  if(period&&(entry<period.from||end>period.through))continue;
  const known=rows.slice(index-warmup+1,index+1).every(row=>compareTime(row.available_at,entry+'T09:00:00+08:00')<0);
  candidates.push({signal_date:rows[index].date,entry_date:entry,through:end,source_known_before_entry:known,
   event_overlap:eventDates.some(d=>d>=window[0].date&&d<=end),end_index:index+horizon,entry_index:index+1});
 }
 const known=candidates.filter(w=>w.source_known_before_entry&&!w.event_overlap);let end=-1,count=0;
 for(const candidate of known)if(candidate.entry_index>end){count++;end=candidate.end_index;}
 return {holding_sessions:horizon,mathematically_complete_windows:candidates.length,point_in_time_complete_windows:known.length,
  late_source_windows:candidates.filter(w=>!w.source_known_before_entry).length,event_overlap_windows:candidates.filter(w=>w.event_overlap).length,
  nonoverlapping_outcome_windows:count,
  source_time_scope:'PRICE_INPUTS_ONLY_NOT_A_PREDECLARED_METHOD_OR_PROSPECTIVE_ACTION_CLEARANCE',
  interpretation:'CAPACITY_ONLY_NOT_SIGNALS_TRADES_OR_INDEPENDENT_IID_SAMPLES',first:known[0]?.entry_date??null,last:known.at(-1)?.through??null};
}

/** Explicit split/sample requirements belong to a versioned protocol, never
 * to a success-oriented fallback. Even READY_FOR_EXECUTION leaves strategy
 * validity unproven and returns no performance metrics. */
export async function assessDailyAiShortCalibration(args:{symbol:string;packets:AnalysisPacket[];method:ShortCalibrationMethod;
 holding_sessions:number[];protocol:ShortCalibrationProtocol|null;as_of:string;provenance:'REAL_RETAINED'|'SYNTHETIC_TEST';corporate_action_policy?:ShortCorporateActionPolicy}){
 const a=structuredClone(args);validateMethod(a.method);
 if(!/^\d{4,6}$/.test(a.symbol)||!validObservationTime(a.as_of)||!Array.isArray(a.packets)||!a.packets.length||a.packets.length>1000
  ||!['REAL_RETAINED','SYNTHETIC_TEST'].includes(a.provenance)||!Array.isArray(a.holding_sessions)||!a.holding_sessions.length
  ||new Set(a.holding_sessions).size!==a.holding_sessions.length||a.holding_sessions.some(h=>!Number.isSafeInteger(h)||h<1||h>10))invalid('scope');
 const issues:Issue[]=[],add=(code:string,field:string,detail:string)=>issues.push({code,field,detail});
 const methodHash=await snapshotHash(a.method),warmup=a.method.parameters.atr_period+1,maxHorizon=Math.max(...a.holding_sessions);
 const packetBindings:{packet_hash:string;cutoff:string;data_through:string|null}[]=[],observations:{e:AnalysisEvidence;row:Row}[]=[],other:AnalysisEvidence[]=[];
 for(const packet of a.packets){validateAnalysisPacket(packet);
  if(packet.symbol!==a.symbol||compareTime(packet.cutoff,a.as_of)>0)invalid('packet.scope');
  packetBindings.push({packet_hash:await snapshotHash(packet),cutoff:packet.cutoff,data_through:packet.data_through??null});
  for(const e of packet.evidence){
   if(compareTime(e.available_at,packet.cutoff)>0||e.published_at!==null&&compareTime(e.published_at,e.available_at)>0
    ||e.first_seen_at!==undefined&&compareTime(e.first_seen_at,e.available_at)>0||e.as_of!==undefined&&compareTime(e.as_of,e.available_at)>0)invalid('evidence.time');
   if(e.kind!=='PRICE'){other.push(e);continue;}
   const body=json(e),day=date(body.date,'bar.date');
   if(e.symbol!==a.symbol||!isMarketTradingDate('TW',day)||![body.open,body.high,body.low,body.close,body.volume,body.amount].every(v=>finite(v)&&v>0)
    ||Number(body.high)<Math.max(Number(body.open),Number(body.close))||Number(body.low)>Math.min(Number(body.open),Number(body.close))
    ||typeof body.session_scope!=='string'||!body.session_scope.trim()||body.currency!==undefined&&body.currency!=='TWD'
    ||body.price_basis!==undefined&&body.price_basis!=='RAW_UNADJUSTED'||compareTime(e.available_at,day+'T13:30:00+08:00')<0)invalid('bar');
   observations.push({e,row:{date:day,open:Number(body.open),high:Number(body.high),low:Number(body.low),close:Number(body.close),
    volume:Number(body.volume),amount:Number(body.amount),session_scope:body.session_scope,available_at:e.available_at,evidence_ids:[e.id]}});
  }
 }
 const groups=new Map<string,typeof observations>();for(const o of observations){const g=groups.get(o.row.date)??[];g.push(o);groups.set(o.row.date,g);}
 const rows:Row[]=[];
 for(const [day,group]of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const values=group.map(o=>JSON.stringify([o.row.open,o.row.high,o.row.low,o.row.close,o.row.volume,o.row.amount,o.row.session_scope]));
  if(new Set(values).size!==1){add('CONFLICTING_PRICE_OBSERVATIONS',day,'Different prices, units or session scopes exist for the same date; no favorable revision is selected.');continue;}
  group.sort((x,y)=>compareTime(x.e.available_at,y.e.available_at));
  rows.push({...group[0].row,evidence_ids:[...new Set(group.map(o=>o.e.id))]});
 }
 if(!rows.length)add('NO_VERIFIED_PRICE_SESSIONS','prices','Supply retained daily OHLCV observations.');
 if(new Set(rows.map(r=>r.session_scope)).size>1)add('MIXED_HISTORY_SESSION_SCOPE','prices','Do not pool ordinary-session and official-all-trades histories.');
 const gaps=rows.slice(1).flatMap((row,i)=>previousMarketTradingDate('TW',row.date)===rows[i].date?[]:[{after:rows[i].date,before:row.date}]);
 if(gaps.length)add('HISTORY_SESSION_GAPS','prices','Missing exchange sessions are not interpolated.');
 let run=0,longest=0;for(let i=0;i<rows.length;i++){run=i&&previousMarketTradingDate('TW',rows[i].date)===rows[i-1].date?run+1:1;longest=Math.max(longest,run);}
 const start=rows[0]?.date??null,end=rows.at(-1)?.date??null,actionPolicy=a.corporate_action_policy??'REQUIRE_NO_ACTIONS_FULL_HISTORY';
 const actionCheck=start&&end?await shortActionCoverageForWindow(other,a.symbol,start,end,actionPolicy):null;
 const actionDates=actionPolicy==='RAW_EXCLUDE_EVENT_WINDOWS'?actionCheck?.event_dates??[]:[];
 const capacities=a.holding_sessions.slice().sort((x,y)=>x-y).map(h=>windows(rows,warmup,h,null,actionDates));
 for(const c of capacities)if(c.point_in_time_complete_windows===0)add('NO_MATURED_POINT_IN_TIME_WINDOW','horizon.'+c.holding_sessions,
  'Warmup plus the full outcome horizon must fit, and each signal input must have been received before its next-session entry time.');
 const actionProofs=actionCheck?.proofs??[];
 if(!actionProofs.length)add('COMPLETE_CORPORATE_ACTION_HISTORY_REQUIRED','corporate_actions',
  'Provide complete no-action coverage or a complete sourced event inventory under RAW_EXCLUDE_EVENT_WINDOWS. Known-event windows are excluded; incomplete inventories cannot prove an event-free window.');
 if(actionPolicy==='REQUIRE_NO_ACTIONS_FULL_HISTORY'&&actionCheck?.overlapping_events.length)
  add('KNOWN_CORPORATE_ACTION_CONTRADICTS_NO_ACTION_COVERAGE','corporate_actions','Positive event evidence is not discarded because its inventory is narrower or incomplete.');
 let split:null|{counts:Record<string,number>;oos_capacity:ReturnType<typeof windows>[];purge_sessions:number}=null;
 if(a.protocol===null){
  add('FROZEN_CALIBRATION_PROTOCOL_REQUIRED','protocol','Declare train/validation/OOS dates, sample targets, costs and execution rules before seeing OOS outcomes.');
  add('EXPLICIT_COST_MODEL_REQUIRED','protocol.cost_model','Fees, minimum charges, tax, position size and slippage have not been locked.');
  add('EXPLICIT_EXECUTION_MODEL_REQUIRED','protocol.execution_policy','Entry, ambiguous intraday ordering, limit-lock behavior and exchange ticks have not been locked.');
 }
 else{const p=a.protocol;
  exact(p,['schema','version','declared_at','method_hash','train','validation','oos','purge_sessions','minimums','cost_model','execution_policy'],'protocol');
  if(p.schema!=='SHORT_CALIBRATION_PROTOCOL_V1'||typeof p.version!=='string'||!p.version.trim()||!validObservationTime(p.declared_at)
   ||compareTime(p.declared_at,a.as_of)>0||p.method_hash!==methodHash)invalid('protocol.identity');
  for(const phase of ['train','validation','oos'] as const)exact(p[phase],['from','through'],'protocol.'+phase);
  const dates={train:expected(p.train),validation:expected(p.validation),oos:expected(p.oos)};
  exact(p.minimums,['train_sessions','validation_sessions','oos_sessions','nonoverlapping_oos_windows'],'protocol.minimums');
  for(const [key,v]of Object.entries(p.minimums))integer(v,1,10000,'protocol.minimums.'+key);
  const purge=integer(p.purge_sessions,maxHorizon,1000,'protocol.purge_sessions');
  if(p.train.through>=p.validation.from||p.validation.through>=p.oos.from||compareTime(p.declared_at,p.oos.from+'T09:00:00+08:00')>=0)
   add('OOS_SPLIT_LEAKAGE','protocol','The parameter/protocol lock must precede the first OOS execution session; training, validation and OOS must be strictly ordered.');
  const gap=(from:string,to:string)=>{let count=0,d=nextEntrySession(from);while(d<to&&count<=1000){count++;d=nextEntrySession(d);}return count;};
  if(gap(p.train.through,p.validation.from)<purge||gap(p.validation.through,p.oos.from)<purge)
   add('OUTCOME_PURGE_GAP_INSUFFICIENT','protocol.purge_sessions','Purge at least the longest outcome horizon between fitting, validation and OOS targets.');
  const counts:Record<string,number>={};
  for(const phase of ['train','validation','oos'] as const){counts[phase]=rows.filter(r=>dates[phase].includes(r.date)).length;
   if(counts[phase]!==dates[phase].length||counts[phase]<p.minimums[phase+'_sessions' as keyof typeof p.minimums])
    add('SPLIT_HISTORY_INSUFFICIENT','protocol.'+phase,`Observed ${counts[phase]} sessions; this protocol requires its complete ${dates[phase].length}-session interval and at least ${p.minimums[phase+'_sessions' as keyof typeof p.minimums]}.`);}
  if(rows.some(r=>(dates.train.includes(r.date)||dates.validation.includes(r.date))&&compareTime(r.available_at,p.declared_at)>0))
   add('FIT_SOURCE_NOT_AVAILABLE_AT_LOCK','protocol.declared_at','The data used for training or parameter selection must have been received before the frozen protocol/parameter time.');
  const oos=a.holding_sessions.map(h=>windows(rows,warmup,h,p.oos,actionDates));
  for(const c of oos)if(c.nonoverlapping_outcome_windows<p.minimums.nonoverlapping_oos_windows)
   add('OOS_SAMPLE_CAPACITY_INSUFFICIENT','horizon.'+c.holding_sessions,`Only ${c.nonoverlapping_outcome_windows} nonoverlapping known-before-entry outcome windows; protocol requires ${p.minimums.nonoverlapping_oos_windows}. These are not executed trades.`);
  split={counts,oos_capacity:oos,purge_sessions:purge};
  const cost=p.cost_model;
  if(cost===null)add('EXPLICIT_COST_MODEL_REQUIRED','protocol.cost_model','Freeze fees, minimum charges, tax, position size and slippage; no rates are supplied automatically.');
  else{exact(cost,['version','quantity','minimum_fee_twd','buy_fee','sell_fee','sell_tax','slippage_each_side'],'protocol.cost_model');
   if(typeof cost.version!=='string'||!cost.version.trim())invalid('protocol.cost_model.version');integer(cost.quantity,1,1000000000,'protocol.cost_model.quantity');
   if(!finite(cost.minimum_fee_twd)||cost.minimum_fee_twd<0||![cost.buy_fee,cost.sell_fee,cost.sell_tax,cost.slippage_each_side].every(v=>finite(v)&&v>=0&&v<1))invalid('protocol.cost_model');}
  const execution=p.execution_policy;
  if(execution===null)add('EXPLICIT_EXECUTION_MODEL_REQUIRED','protocol.execution_policy','Daily OHLC cannot establish the order of intraday triggers and stops, queue priority or actual fills.');
  else{exact(execution,['version','entry','ambiguous_intraday','limit_lock','tick_schedule_evidence_ids'],'protocol.execution_policy');
   if(typeof execution.version!=='string'||!execution.version.trim()||execution.entry!=='NEXT_SESSION_OPEN_WITHIN_LOCKED_RANGE'||execution.ambiguous_intraday!=='UNCONFIRMED'
    ||execution.limit_lock!=='UNCONFIRMED'||!Array.isArray(execution.tick_schedule_evidence_ids)||!execution.tick_schedule_evidence_ids.length)invalid('protocol.execution_policy');
   const known=new Set(other.filter(e=>compareTime(e.available_at,p.declared_at)<=0).map(e=>e.id));
   if(execution.tick_schedule_evidence_ids.some(id=>!known.has(id)))add('EXCHANGE_TICK_EVIDENCE_REQUIRED','protocol.execution_policy','Require exchange price-band evidence known by the protocol lock; a single supplied tick is not an exchange schedule.');}
 }
 const body={schema:'DAILY_AI_SHORT_CALIBRATION_QUALIFICATION_V1' as const,symbol:a.symbol,method_id:a.method.method_id,method_hash:methodHash,
  method_parameters:a.method.parameters,parameter_classification:'EXPLICIT_METHOD_HYPOTHESIS_NOT_EMPIRICAL_VALIDATION',
  as_of:a.as_of,provenance:a.provenance,protocol_hash:a.protocol?await snapshotHash(a.protocol):null,protocol:a.protocol,
  state:issues.length?'INSUFFICIENT':'READY_FOR_EXECUTION',issues,packet_bindings:packetBindings,
  history:{observations:observations.length,unique_sessions:rows.length,duplicate_observations:observations.length-groups.size,conflicting_sessions:groups.size-rows.length,from:start,through:end,longest_consecutive_sessions:longest,
   warmup_sessions:warmup,session_gaps:gaps,capacity:capacities,earliest_receipts:rows.map(r=>({date:r.date,available_at:r.available_at,evidence_ids:r.evidence_ids}))},
  action_coverage:actionProofs,corporate_action_policy:actionPolicy,excluded_action_dates:actionDates,split,
  method_review:{required_review:'METHODOLOGY',scope:'SHORT_STRATEGY_VALIDATION',state:'INSUFFICIENT',
   prerequisites:issues.map(i=>i.code),remaining:['ACTUAL_FROZEN_METHOD_WALK_FORWARD_EVALUATION','BASELINE_AND_REGIME_COMPARISON','INDEPENDENT_METHOD_REVIEW'],
   arithmetic_correctness_is_strategy_validation:false},
  universe_scope:'SINGLE_SYMBOL_DATA_CAPACITY_NOT_UNIVERSE_SELECTION_VALIDATION',
  strategy_calibrated:false,signal_edge:'UNPROVEN',metrics:null,executed_strategy_samples:0,forward_performance_samples:0,
  review:null,methodology_approved:false,member_published:false};
 return freeze({...body,qualification_hash:await snapshotHash(body)});
}

/** Bind the prerequisite to the method-review document, without issuing a
 * positive review or pretending data capacity is an investment edge. */
export async function shortCalibrationMethodReviewRequirement(receipt:Awaited<ReturnType<typeof assessDailyAiShortCalibration>>,method:ShortCalibrationMethod){
 const {qualification_hash,...body}=receipt;validateMethod(method);
 if(await snapshotHash(body)!==qualification_hash||await snapshotHash(method)!==receipt.method_hash||receipt.strategy_calibrated!==false
  ||receipt.metrics!==null||receipt.methodology_approved!==false||receipt.review!==null)invalid('review_receipt');
 return {schema:'DAILY_AI_SHORT_METHOD_REVIEW_REQUIREMENT_V1',method_id:method.method_id,method_hash:receipt.method_hash,qualification_hash,
  data_readiness:receipt.state,review:'METHODOLOGY_REQUIRED',strategy_validation:'INSUFFICIENT',
  blocking_codes:[...new Set([...receipt.issues.map(i=>i.code),...receipt.method_review.remaining])],
  arithmetic_only_cannot_satisfy:true,approved:false,member_published:false};
}
