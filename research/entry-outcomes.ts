import { ENTRY_POLICY, HORIZONS, entryHash, nextEntrySession, type Bar, type EntryResult } from './entry-opportunity.ts';
import {isMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
export type EntryLock = { id: string; symbol: string; strategy_version: string; mode: 'FORWARD' | 'HISTORICAL_REPLAY';
  provenance: 'REAL_RETAINED'|'SYNTHETIC_TEST'; locked_at: string; evaluation_time: string; evidence_hash: string; prediction: EntryResult };
export type OutcomeEvidence = { bars: Bar[]; benchmark: Bar[]; observed_at: string;
  adjustment_verified: boolean; executable: boolean; source_ref: string };
const stamp=Date.parse;
export async function evaluateEntryOutcome(lock: EntryLock, evidence: OutcomeEvidence, horizon: number) {
  const p=lock.prediction,plan=p.plan,observed=stamp(evidence.observed_at);
  const base={prediction_id:lock.id,strategy_version:lock.strategy_version,horizon,mode:lock.mode,provenance:lock.provenance,
    evidence_hash:await entryHash(evidence),prediction_evidence_hash:lock.evidence_hash,
    ordering:'CONSERVATIVE_STOP_FIRST',cost_model:ENTRY_POLICY.costModel,observed_at:evidence.observed_at};
  const unavailable=(reason:string)=>({...base,state:'UNAVAILABLE',reason});
  if(!['FORWARD','HISTORICAL_REPLAY'].includes(lock.mode)||!['REAL_RETAINED','SYNTHETIC_TEST'].includes(lock.provenance)||
    !(HORIZONS as readonly number[]).includes(horizon)||!plan||p.symbol!==lock.symbol||p.strategy_version!==lock.strategy_version||
    !/^[a-f0-9]{64}$/.test(lock.evidence_hash)||!Number.isFinite(observed)||
    !Number.isFinite(stamp(lock.locked_at))||!Number.isFinite(stamp(lock.evaluation_time))||stamp(lock.evaluation_time)>stamp(lock.locked_at))return unavailable('LOCK_INVALID');
  if(p.status!=='ENTRY_READY')return unavailable('NOT_A_CONFIRMED_ENTRY_LOCK');
  if(!isMarketTradingDate('TW',plan.not_before)||plan.expires_on!==plan.not_before||
    ![plan.trigger,plan.stop,plan.target,...plan.reference_range].every(v=>Number.isFinite(v)&&v>0)||
    plan.reference_range[0]!==plan.trigger||plan.stop>=plan.trigger||plan.reference_range[1]<plan.trigger||plan.target<=plan.reference_range[1])return unavailable('PLAN_INVALID');
  if(stamp(lock.locked_at)>=stamp(plan.not_before+'T09:00:00+08:00'))return unavailable('NOT_PROSPECTIVE');
  const dates=[plan.not_before];while(dates.length<horizon)dates.push(nextEntrySession(dates.at(-1)!));
  if(observed<stamp(dates.at(-1)!+'T13:30:00+08:00'))return unavailable('NOT_MATURED');
  if(!evidence.adjustment_verified||!evidence.executable||!evidence.source_ref)return unavailable('EXECUTABILITY_OR_ADJUSTMENT_UNVERIFIED');
  function get(series:Bar[]){return dates.map(date=>{const rows=series.filter(b=>b.date===date);if(rows.length!==1)return null;
    const b=rows[0];return [b.open,b.high,b.low,b.close,b.volume,b.amount].every(v=>Number.isFinite(v)&&v>0)&&
      b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&!!b.source_ref&&
      Number.isFinite(stamp(b.available_at))&&stamp(b.available_at)>=stamp(date+'T13:30:00+08:00')&&stamp(b.available_at)<=observed?b:null;});}
  const bars=get(evidence.bars),benchmark=get(evidence.benchmark);
  if(bars.some(b=>!b)||benchmark.some(b=>!b))return unavailable('SESSION_OR_AVAILABILITY_GAP');
  const first=bars[0]!,upper=plan.reference_range[1];
  if(first.high<=plan.trigger||first.open>upper||first.open<=plan.stop)return {...base,state:'NOT_ENTERED',reason:'TRIGGER_NOT_EXECUTABLE_IN_LOCKED_RANGE',net_return:null};
  const fill=Math.max(first.open,plan.trigger)*(1+ENTRY_POLICY.slippageEachSide);
  if(fill>upper)return {...base,state:'NOT_ENTERED',reason:'SLIPPAGE_EXCEEDS_ENTRY_RANGE',net_return:null};
  let exit=bars.at(-1)!.close,exitIndex=horizon-1,stopHit=false,targetHit=false,mfe=0,mae=0,peak=fill,maxDrawdown=0;
  for(let i=0;i<bars.length;i++){
    const b=bars[i]!;
    if(b.low<=plan.stop){exit=Math.min(b.open,plan.stop);exitIndex=i;stopHit=true;mae=Math.min(mae,exit/fill-1);maxDrawdown=Math.min(maxDrawdown,exit/peak-1);break;}
    if(b.high>=plan.target){exit=Math.max(b.open,plan.target);exitIndex=i;targetHit=true;mfe=Math.max(mfe,exit/fill-1);break;}
    // Daily OHLC cannot establish tick order. Excursions are labelled bounds,
    // never credited after an assumed stop/target exit.
    mfe=Math.max(mfe,b.high/fill-1);mae=Math.min(mae,b.low/fill-1);
    peak=Math.max(peak,b.close);maxDrawdown=Math.min(maxDrawdown,b.close/peak-1);
  }
  const net=(exit*(1-ENTRY_POLICY.slippageEachSide)*(1-ENTRY_POLICY.sellFee-ENTRY_POLICY.sellTax))/(fill*(1+ENTRY_POLICY.buyFee))-1;
  const benchmarkReturn=benchmark[exitIndex]!.close/benchmark[0]!.open-1;
  return {...base,state:'OBSERVED',entry_date:dates[0],exit_date:dates[exitIndex],entry_price:fill,exit_price:exit,
    gross_return:exit/fill-1,net_return:net,benchmark_return:benchmarkReturn,excess_return:net-benchmarkReturn,
    mfe,mae,close_or_exit_drawdown:maxDrawdown,stop_hit:stopHit,target_hit:targetHit,
    execution:'DAILY_OHLC_CONSERVATIVE_MODEL_NOT_ACTUAL_FILL',minimum_fee_included:false,
    metrics_scope:'PRICE_ONLY_EXCLUDES_DISTRIBUTIONS; DAILY_EXCURSION_BOUNDS; ASSUMED_FEES_NOT_ACCOUNT_PNL'};
}
export type EntryOutcome=Awaited<ReturnType<typeof evaluateEntryOutcome>>;
export function summarizeEntryOutcomes(rows: EntryOutcome[]) {
  const dedup=new Map<string,EntryOutcome>();
  for(const r of rows){const k=r.prediction_id+':'+r.horizon;if(dedup.has(k)&&JSON.stringify(dedup.get(k))!==JSON.stringify(r))throw Error('CONFLICTING_OUTCOME');dedup.set(k,r);}
  return [...new Set(rows.map(r=>r.strategy_version))].sort().flatMap(strategy=>HORIZONS.map(horizon=>{
    const valid=[...dedup.values()].filter(r=>r.strategy_version===strategy&&r.horizon===horizon&&r.mode==='FORWARD'&&r.provenance==='REAL_RETAINED'&&r.state==='OBSERVED'&&'net_return'in r&&typeof r.net_return==='number'&&Number.isFinite(r.net_return));
    const values=valid.map(r=>Number('net_return'in r?r.net_return:NaN));
    const n=values.length,mean=(key:string)=>n?valid.reduce((s,r)=>s+Number((r as unknown as Record<string,unknown>)[key]),0)/n:null;
    return {strategy,horizon,entered_samples:n,win_rate:n?values.filter(v=>v>0).length/n:null,average_return:mean('net_return'),
      expectancy:mean('net_return'),mean_mfe:mean('mfe'),mean_mae:mean('mae'),mean_excess_return:mean('excess_return'),
      worst_close_or_exit_drawdown:n?Math.min(...valid.map(r=>Number('close_or_exit_drawdown'in r?r.close_or_exit_drawdown:NaN))):null,
      analysis_value:'INSUFFICIENT_SAMPLE',not_account_performance:true};
  }));
}
