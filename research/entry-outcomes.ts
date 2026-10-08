/** Offline Outcome contract. Daily bars prove ranges, not orders, queue priority
 * or fills. Nothing in this module writes a Prediction, Outcome or trade. */
import { ENTRY_POLICY, HORIZONS, entryHash, nextEntrySession, type Bar, type EntryResult } from './entry-opportunity.ts';
import {isMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

export const OUTCOME_VERSION='ENTRY_OUTCOME_2.0.0';
export type CostPolicy={version:'ILLUSTRATIVE_TW_CASH_LOCKED_V1';quantity:number;minimum_fee_twd:number;
  buy_fee:number;sell_fee:number;sell_tax:number;slippage:number;rounding:'CEIL_TWD';account_costs_verified:false};
export type EntryLock={id:string;symbol:string;strategy_version:string;mode:'FORWARD'|'HISTORICAL_REPLAY';
  provenance:'REAL_RETAINED'|'SYNTHETIC_TEST';locked_at:string;evaluation_time:string;evidence_cutoff:string;
  evidence_hash:string;prediction:EntryResult;costs:CostPolicy;lock_sha256:string};
export type CorporateAction={symbol:string;effective_date:string;kind:'CASH_DIVIDEND'|'SPLIT'|'RIGHTS'|'CAPITAL_REDUCTION';
  source_ref:string;available_at:string;cash_per_share:number|null;new_shares_per_old_share:number|null};
export type ActionCoverage={symbol:string;from:string;through:string;available_at:string;source_ref:string;
  coverage:'COMPLETE_SOURCE_WINDOW';events:CorporateAction[];content_sha256:string};
export type OutcomeEvidence={bars:Bar[];benchmark:Bar[];observed_at:string;source_ref:string;
  price_basis:'UNADJUSTED';corporate_actions:ActionCoverage[];benchmark_symbol:string};
const stamp=Date.parse,hash=(s:string)=>/^[a-f0-9]{64}$/.test(s);
const day=(s:string)=>new Date(stamp(s)+8*3600000).toISOString().slice(0,10);
/** Session eligibility is not proof that a suspended/limit-locked stock traded. */
export function firstTradableWindowAfterSignal(signal:string){
  if(!Number.isFinite(stamp(signal)))return null;
  const date=day(signal),open=stamp(date+'T09:00:00+08:00'),close=stamp(date+'T13:30:00+08:00');
  if(isMarketTradingDate('TW',date)&&stamp(signal)<close)return {session:date,
    not_before:stamp(signal)<open?date+'T09:00:00+08:00':signal,first_execution_time:null,
    basis:stamp(signal)<open?'NEXT_SESSION_OPEN':'NEXT_TRADE_AFTER_SIGNAL_UNVERIFIED'};
  const next=nextEntrySession(date);return {session:next,not_before:next+'T09:00:00+08:00',
    first_execution_time:null,basis:'NEXT_SESSION_OPEN'};
}
export async function entryLockHash(lock:Omit<EntryLock,'lock_sha256'>|EntryLock){
  const {lock_sha256:_,...payload}=lock as EntryLock;return entryHash(payload);
}
function validCosts(c:CostPolicy){return c&&c.version==='ILLUSTRATIVE_TW_CASH_LOCKED_V1'&&
  Number.isSafeInteger(c.quantity)&&c.quantity>0&&c.minimum_fee_twd>=0&&Number.isFinite(c.minimum_fee_twd)&&
  c.buy_fee===ENTRY_POLICY.buyFee&&c.sell_fee===ENTRY_POLICY.sellFee&&c.sell_tax===ENTRY_POLICY.sellTax&&
  c.slippage===ENTRY_POLICY.slippageEachSide&&c.rounding==='CEIL_TWD'&&c.account_costs_verified===false;}
function officialSource(ref:string,synthetic:boolean){
  if(synthetic&&ref.startsWith('SYNTHETIC_'))return true;
  try{const u=new URL(ref);return u.protocol==='https:'&&!u.username&&!u.password&&
    ['api.fugle.tw','www.twse.com.tw','wwwc.twse.com.tw','openapi.twse.com.tw','www.tpex.org.tw'].includes(u.hostname)&&
    ![...u.searchParams.keys()].some(k=>/token|secret|key|auth/i.test(k));}catch{return false;}
}
async function adjustmentIssue(lock:EntryLock,e:OutcomeEvidence,from:string,through:string){
  if(e.price_basis!=='UNADJUSTED'||!e.benchmark_symbol||e.benchmark_symbol===lock.symbol||!Array.isArray(e.corporate_actions))return 'ADJUSTMENT_SOURCE_MISSING';
  for(const symbol of [lock.symbol,e.benchmark_symbol]){
    const rows=e.corporate_actions.filter(c=>c.symbol===symbol);if(rows.length!==1)return 'ADJUSTMENT_COVERAGE_MISSING_OR_DUPLICATE';
    const c=rows[0],{content_sha256,...payload}=c;
    if(c.coverage!=='COMPLETE_SOURCE_WINDOW'||!/^\d{4}-\d{2}-\d{2}$/.test(c.from)||!/^\d{4}-\d{2}-\d{2}$/.test(c.through)||
      c.from>from||c.through<through||!officialSource(c.source_ref,lock.provenance==='SYNTHETIC_TEST')||!hash(content_sha256)||
      await entryHash(payload)!==content_sha256||!Number.isFinite(stamp(c.available_at))||
      stamp(c.available_at)>stamp(e.observed_at)||stamp(c.available_at)<stamp(through+'T13:30:00+08:00'))return 'ADJUSTMENT_LINEAGE_INVALID';
    for(const a of c.events){
      if(a.symbol!==symbol||a.effective_date<c.from||a.effective_date>c.through||
        !officialSource(a.source_ref,lock.provenance==='SYNTHETIC_TEST')||!Number.isFinite(stamp(a.available_at))||
        stamp(a.available_at)>stamp(c.available_at))return 'CORPORATE_ACTION_LINEAGE_INVALID';
      // Never apply a later vendor-adjusted history to locked raw entry prices.
      // Rights/cash entitlement and the chosen stop adjustment policy require a
      // separately sourced total-return ledger. Absence is not zero dividends.
      if(a.effective_date>=from&&a.effective_date<=through)return 'CORPORATE_ACTION_TOTAL_RETURN_LEDGER_REQUIRED';
    }
  }
  return null;
}
export async function evaluateEntryOutcome(lock:EntryLock,evidence:OutcomeEvidence,horizon:number){
  const p=lock.prediction,plan=p.plan,observed=stamp(evidence.observed_at);
  const base={version:OUTCOME_VERSION,prediction_id:lock.id,strategy_version:lock.strategy_version,horizon,mode:lock.mode,provenance:lock.provenance,
    evidence_hash:await entryHash(evidence),prediction_evidence_hash:lock.evidence_hash,lock_sha256:lock.lock_sha256,
    ordering:'UNKNOWN_UNLESS_DAILY_PATH_UNAMBIGUOUS',cost_model:lock.costs,observed_at:evidence.observed_at,
    first_tradable_window:firstTradableWindowAfterSignal(lock.evaluation_time),
    actual_fill_confirmed:false,performance_eligible:false,maximum_drawdown:null};
  const unavailable=(reason:string)=>({...base,state:'UNAVAILABLE',reason,net_return:null});
  const unknown=(reason:string)=>({...base,state:'UNCONFIRMED',reason,net_return:null,mfe:null,mae:null});
  if(!['FORWARD','HISTORICAL_REPLAY'].includes(lock.mode)||!['REAL_RETAINED','SYNTHETIC_TEST'].includes(lock.provenance)||
    !(HORIZONS as readonly number[]).includes(horizon)||!p||!plan||p.symbol!==lock.symbol||p.strategy_version!==lock.strategy_version||
    p.strategy_version!==p.strategy+'_1.0.0'||JSON.stringify(p.horizons)!==JSON.stringify(HORIZONS)||
    !hash(lock.evidence_hash)||!hash(lock.lock_sha256)||await entryLockHash(lock)!==lock.lock_sha256||!validCosts(lock.costs)||
    !Number.isFinite(observed)||![lock.evidence_cutoff,lock.evaluation_time,lock.locked_at].every(t=>Number.isFinite(stamp(t)))||
    stamp(lock.evidence_cutoff)>stamp(lock.evaluation_time)||stamp(lock.evaluation_time)>stamp(lock.locked_at))return unavailable('LOCK_INVALID');
  if(p.status!=='ENTRY_READY')return unavailable('NOT_A_CONFIRMED_ENTRY_LOCK');
  if(!isMarketTradingDate('TW',plan.not_before)||plan.expires_on!==plan.not_before||
    ![plan.trigger,plan.stop,plan.target,...plan.reference_range].every(v=>Number.isFinite(v)&&v>0)||
    plan.reference_range[0]!==plan.trigger||plan.stop>=plan.trigger||plan.reference_range[1]<plan.trigger||plan.target<=plan.reference_range[1])return unavailable('PLAN_INVALID');
  if(day(lock.evaluation_time)>=plan.not_before||stamp(lock.locked_at)>=stamp(plan.not_before+'T09:00:00+08:00'))return unavailable('NOT_PROSPECTIVE');
  const dates=[plan.not_before];while(dates.length<horizon)dates.push(nextEntrySession(dates.at(-1)!));
  if(observed<stamp(dates.at(-1)!+'T13:30:00+08:00'))return unavailable('NOT_MATURED');
  if(!evidence.source_ref)return unavailable('OUTCOME_SOURCE_MISSING');
  const adjustment=await adjustmentIssue(lock,evidence,day(lock.evidence_cutoff),dates.at(-1)!);
  if(adjustment)return unavailable(adjustment);
  function get(series:Bar[]){return dates.map(date=>{const rows=series.filter(b=>b.date===date);if(rows.length!==1)return null;
    const b=rows[0];return [b.open,b.high,b.low,b.close,b.volume,b.amount].every(v=>Number.isFinite(v)&&v>0)&&
      b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&!!b.source_ref&&
      Number.isFinite(stamp(b.available_at))&&stamp(b.available_at)>=stamp(date+'T13:30:00+08:00')&&stamp(b.available_at)<=observed?b:null;});}
  const bars=get(evidence.bars),benchmark=get(evidence.benchmark);
  if(bars.some(b=>!b)||benchmark.some(b=>!b))return unavailable('SESSION_OR_AVAILABILITY_GAP');
  const first=bars[0]!,upper=plan.reference_range[1];
  const noFill=(reason:string)=>({...base,state:'NOT_ENTERED',reason,net_return:null,entry_date:null});
  if(first.high<=plan.trigger)return noFill('TRIGGER_NOT_REACHED_BEFORE_EXPIRY');
  if(first.open<=plan.stop)return noFill('INVALIDATED_BEFORE_ENTRY');
  if(first.open>upper)return noFill('OPENING_GAP_OUTSIDE_LOCKED_RANGE_NO_CHASE');
  if(first.open<=plan.trigger)return unknown('INTRADAY_TRIGGER_PRICE_AND_ORDER_UNCONFIRMED');
  const fill=first.open*(1+lock.costs.slippage);
  if(fill>upper)return noFill('SLIPPAGE_EXCEEDS_ENTRY_RANGE');
  let exit=bars.at(-1)!.close,exitIndex=horizon-1,stopHit=false,targetHit=false,mfeBound=0,maeBound=0,peak=fill,closeDrawdown=0;
  for(let i=0;i<bars.length;i++){
    const b=bars[i]!;
    if(i>0&&b.open<=plan.stop){exit=b.open;exitIndex=i;stopHit=true;break;}
    if(i>0&&b.open>=plan.target){exit=plan.target;exitIndex=i;targetHit=true;break;}
    if(b.low<=plan.stop&&b.high>=plan.target)return unknown('SAME_DAY_STOP_TARGET_ORDER_UNCONFIRMED');
    if(b.low<=plan.stop){exit=plan.stop;exitIndex=i;stopHit=true;break;}
    if(b.high>=plan.target){exit=plan.target;exitIndex=i;targetHit=true;break;}
    mfeBound=Math.max(mfeBound,b.high/fill-1);maeBound=Math.min(maeBound,b.low/fill-1);
    peak=Math.max(peak,b.close);closeDrawdown=Math.min(closeDrawdown,b.close/peak-1);
  }
  const q=lock.costs.quantity,buy=fill*q,sell=exit*(1-lock.costs.slippage)*q;
  const buyFee=Math.ceil(Math.max(lock.costs.minimum_fee_twd,buy*lock.costs.buy_fee));
  const sellFee=Math.ceil(Math.max(lock.costs.minimum_fee_twd,sell*lock.costs.sell_fee));
  const tax=Math.ceil(sell*lock.costs.sell_tax),net=(sell-sellFee-tax)/(buy+buyFee)-1;
  // A close cannot stand for the index at an intraday stop/target timestamp.
  const benchmarkReturn=stopHit||targetHit?null:benchmark[exitIndex]!.close/benchmark[0]!.open-1;
  return {...base,state:'MODELLED',entry_date:dates[0],first_eligible_time:dates[0]+'T09:00:00+08:00',exit_date:dates[exitIndex],
    entry_price:fill,exit_price:exit,gross_return:exit/fill-1,net_return:net,benchmark_return:benchmarkReturn,excess_return:benchmarkReturn===null?null:net-benchmarkReturn,
    fee_twd:buyFee+sellFee,tax_twd:tax,minimum_fee_included:true,
    mfe:null,mae:null,mfe_daily_bound:stopHit||targetHit?null:mfeBound,mae_daily_bound:stopHit||targetHit?null:maeBound,
    close_or_exit_drawdown:stopHit||targetHit?null:closeDrawdown,stop_hit:stopHit,target_hit:targetHit,
    execution:'DAILY_OPEN_HYPOTHESIS_NOT_EXECUTABLE_FILL_PROOF',
    metrics_scope:'MODEL_ONLY; NO_QUEUE_OR_CAPACITY_PROOF; EXCURSIONS_ARE_BOUNDS; NOT_ACCOUNT_PNL'};
}
export type EntryOutcome=Awaited<ReturnType<typeof evaluateEntryOutcome>>;
export function summarizeEntryOutcomes(rows:EntryOutcome[]){
  const dedup=new Map<string,EntryOutcome>();
  for(const r of rows){const k=r.prediction_id+':'+r.horizon;if(dedup.has(k)&&JSON.stringify(dedup.get(k))!==JSON.stringify(r))throw Error('CONFLICTING_OUTCOME');dedup.set(k,r);}
  return [...new Set(rows.map(r=>r.strategy_version))].sort().flatMap(strategy=>HORIZONS.map(horizon=>{
    const forward=[...dedup.values()].filter(r=>r.strategy_version===strategy&&r.horizon===horizon&&r.mode==='FORWARD'&&r.provenance==='REAL_RETAINED');
    // Daily model rows never graduate into real win rates or expectancy.
    return {strategy,horizon,modelled_samples:forward.filter(r=>r.state==='MODELLED').length,
      unconfirmed_samples:forward.filter(r=>r.state==='UNCONFIRMED').length,entered_samples:0,win_rate:null,
      average_return:null,expectancy:null,mean_mfe:null,mean_mae:null,mean_excess_return:null,maximum_drawdown:null,
      analysis_value:'INSUFFICIENT_SAMPLE',not_account_performance:true};
  }));
}
