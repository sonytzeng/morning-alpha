/** Read-only research follow-up. Price observation is never a proven fill/P&L. */
import {snapshotHash,hashValid,sourceSafe,validTime} from './contracts.ts';
import {traceIssues,type DailyBar} from './researchFunnel.ts';
import {verifyDailyLock,type DailyLock} from './dailyIntelligence.ts';
import {coveredCalendarDate,isMarketTradingDate} from '../../../supabase/functions/_shared/market-session-contract.mjs';
export type OutcomeSource = {symbol:string;observed_at:string;bars:DailyBar[];benchmark:DailyBar[];
 actions:{from:string;through:string;source:string;available_at:string;complete:boolean;events:{effective_date:string;kind:string}[];evidence_hash:string}|null;
 invalidation:{state:'CONFIRMED'|'NOT_OBSERVED'|'UNKNOWN';available_at:string;source:string;evidence_hash:string}|null};
export function targetSessions(actionableAt:string,count:number){
 if(!validTime(actionableAt)||!Number.isInteger(count)||count<1||count>250)return null;
 const date=new Date(Date.parse(actionableAt)+8*3600000).toISOString().slice(0,10),rows:string[]=[];
 for(let i=0;i<550&&rows.length<count;i++){
  const d=new Date(Date.parse(date+'T00:00:00Z')+i*86400000).toISOString().slice(0,10);
  if(!coveredCalendarDate('TW',d))return null;
  if(isMarketTradingDate('TW',d))rows.push(d);
 }
 return rows.length===count?rows:null;
}
export async function researchOutcome(lock:DailyLock,horizon:number,source:OutcomeSource){
 if(!await verifyDailyLock(lock)||!lock.target_sessions.includes(horizon)||source.symbol!==lock.symbol||!validTime(source.observed_at))throw Error('OUTCOME_SCOPE_INVALID');
 const dates=targetSessions(lock.actionable_at,horizon),issues:string[]=[];
 const base={prediction_id:lock.id,prediction_hash:lock.lock_hash,strategy_version:lock.strategy_version,horizon,
  mode:lock.mode,provenance:lock.provenance,observed_at:source.observed_at,outcome_source_hash:await snapshotHash(source),
  actual_fill_confirmed:false,net_return:null,transaction_cost:null,mfe:null,mae:null,maximum_drawdown:null,
  performance_eligible:false,forward_performance_sample:0};
 const result=(state:string,reason:string[],observations:unknown=null)=>({...base,state,reasons:reason,observations});
 if(!dates)return result('UNKNOWN',['CALENDAR_COVERAGE_MISSING']);
 const end=dates.at(-1)!;
 if(Date.parse(source.observed_at)<Date.parse(end+'T13:30:00+08:00'))return result('NOT_MATURED',[]);
 // A partial signal-day daily bar contains prices preceding the lock. Wait for
 // a complete post-lock session; never claim intraday excursion from daily K.
 if(Date.parse(lock.actionable_at)>Date.parse(dates[0]+'T09:00:00+08:00'))return result('UNKNOWN',['INTRADAY_POST_SIGNAL_PATH_MISSING']);
 const series=(rows:DailyBar[])=>dates.map(d=>{const found=rows.filter(b=>b.date===d);if(found.length!==1)return null;const b=found[0];
  return !traceIssues(b,source.observed_at).length&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)
   &&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&Date.parse(b.available_at!)>=Date.parse(d+'T13:30:00+08:00')?b:null;});
 const bars=series(source.bars),benchmark=series(source.benchmark);
 if(bars.some(b=>!b)||benchmark.some(b=>!b))return result('UNKNOWN',['PRICE_OR_BENCHMARK_SESSION_GAP']);
 if(!source.actions||!source.actions.complete||!sourceSafe(source.actions.source)||!hashValid(source.actions.evidence_hash)
  ||!validTime(source.actions.available_at)||Date.parse(source.actions.available_at)>Date.parse(source.observed_at)
  ||source.actions.from>dates[0]||source.actions.through<end)issues.push('CORPORATE_ACTION_COVERAGE_UNVERIFIED');
 else if(source.actions.events.some(e=>e.effective_date>=dates[0]&&e.effective_date<=end))issues.push('VERIFIED_TOTAL_RETURN_ADJUSTMENT_REQUIRED');
 const inv=source.invalidation;
 const invalidation=inv&&['CONFIRMED','NOT_OBSERVED'].includes(inv.state)&&sourceSafe(inv.source)&&hashValid(inv.evidence_hash)
  &&validTime(inv.available_at)&&Date.parse(inv.available_at)>Date.parse(lock.locked_at)&&Date.parse(inv.available_at)<=Date.parse(source.observed_at)?inv.state:'UNKNOWN';
 if(invalidation==='UNKNOWN')issues.push('INVALIDATION_EVIDENCE_MISSING');
 // Even a fully verified daily window supports only price observations. Trade
 // costs, order priority, intraday stop/target order and fills remain unknown.
 issues.push('EXECUTION_AND_COSTS_UNVERIFIED');
 const raw=bars.at(-1)!.close/bars[0]!.open-1,market=benchmark.at(-1)!.close/benchmark[0]!.open-1;
 const adjustmentKnown=!issues.some(i=>/ACTION|ADJUSTMENT/.test(i));
 return result('OBSERVED_NOT_PERFORMANCE',issues,{from:dates[0],through:end,raw_price_change:raw,raw_benchmark_change:market,
  // Company action coverage does not prove the benchmark's adjustment policy.
  // Preserve both raw price observations but do not label them excess return.
  relative_price_change:null,relative_return_status:'BENCHMARK_ADJUSTMENT_UNVERIFIED',adjusted_return:null,invalidation,
  daily_high_bound:adjustmentKnown?Math.max(...bars.map(b=>b!.high/bars[0]!.open-1)):null,
  daily_low_bound:adjustmentKnown?Math.min(...bars.map(b=>b!.low/bars[0]!.open-1)):null,
  label:'完整日區間觀察，不是實際成交、MFE／MAE或交易損益'});
}
export async function outcomeSweep(locks:DailyLock[],load:(l:DailyLock)=>Promise<OutcomeSource>,append:(r:unknown,key:string)=>Promise<void>,maxLocks=24){
 if(!Number.isInteger(maxLocks)||maxLocks<1||maxLocks>24)throw Error('OUTCOME_BATCH_LIMIT');
 const results=[];
 for(const lock of locks.slice(0,maxLocks)){
  const source=await load(lock);
  for(const horizon of lock.target_sessions){const result=await researchOutcome(lock,horizon,source);
   const key=await snapshotHash({prediction:lock.lock_hash,horizon,source:result.outcome_source_hash});await append(result,key);results.push(result);}
 }
 return {processed:Math.min(locks.length,maxLocks),remaining:Math.max(0,locks.length-maxLocks),results,performance_sample:0};
}
