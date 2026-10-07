/** Gross, unlevered conditional-long research outcomes. No trade creation.
 * Daily OHLC cannot establish intrabar ordering: stop-first is conservative. */
import { isMarketTradingDate } from './market-session-contract.mjs';
import { nextV2Session, V2_METHODOLOGY, V2_POLICY, type Bar } from './recommendation-shadow-v2-engine.ts';
export type LockedV2={id:string;symbol:string;methodology_version:string;observation_kind:'FORWARD'|'HISTORICAL_REPLAY';locked_at:string;cutoff:string;input_sha256:string;status:string;entry:{not_before:string;trigger_price:number;invalidation_price:number}};
export type V2Outcome={prediction_id:string;prediction_status:string;horizon:number;state:'PENDING'|'NOT_ENTERED'|'OBSERVED'|'UNAVAILABLE';reason:string;entry_at:string|null;exit_at:string|null;return:number|null;mfe:number|null;mae:number|null;win_loss:'WIN'|'LOSS'|'FLAT'|null;gross_of_costs:true;ordering:'CONSERVATIVE_STOP_FIRST';methodology_version:string};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function evaluateV2Outcome(p:LockedV2,bars:Bar[],horizon:typeof V2_POLICY.horizons[number],observedAt:string):V2Outcome{
 const output:V2Outcome={prediction_id:p.id,prediction_status:p.status,horizon,state:'PENDING',reason:'HORIZON_NOT_OBSERVED',entry_at:null,exit_at:null,return:null,mfe:null,mae:null,win_loss:null,gross_of_costs:true,ordering:'CONSERVATIVE_STOP_FIRST',methodology_version:p.methodology_version};
 const reject=(reason:string):V2Outcome=>({...output,state:'UNAVAILABLE',reason});
 const locked=Date.parse(p.locked_at),cutoff=Date.parse(p.cutoff),observed=Date.parse(observedAt),start=Date.parse(p.entry.not_before+'T09:00:00+08:00');
 if(p.observation_kind!=='FORWARD'||p.methodology_version!==V2_METHODOLOGY||!V2_POLICY.horizons.includes(horizon)||
  ![locked,cutoff,observed,start].every(Number.isFinite)||locked<cutoff||locked>=start||observed<locked||
  !isMarketTradingDate('TW',p.entry.not_before)||!/^[a-f0-9]{64}$/.test(p.input_sha256)||!['WATCH','READY'].includes(p.status))return reject('NOT_A_PROSPECTIVE_LOCKED_WATCH_OR_READY_PREDICTION');
 const trigger=p.entry.trigger_price,stop=p.entry.invalidation_price;
 if(!finite(trigger)||!finite(stop)||stop<=0||trigger<=stop)return reject('ENTRY_CONTRACT_INVALID');
 const expected:string[]=[];let date=p.entry.not_before;
 for(let i=0;i<horizon;i++){expected.push(date);date=nextV2Session(date);}
 const rows:Bar[]=[];
 for(const date of expected){
  if(observed<Date.parse(date+'T13:30:00+08:00'))return output;
  const matches=bars.filter(b=>b.date===date&&Date.parse(b.available_at)<=observed);
  if(matches.length!==1)return reject(matches.length?'CONFLICTING_OUTCOME_BAR':'COMPLETED_SESSION_BAR_MISSING');
  const b=matches[0];
  if(![b.open,b.high,b.low,b.close,b.volume,b.amount].every(finite)||Math.min(b.open,b.high,b.low,b.close)<=0||b.volume<=0||b.amount<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||!b.source_ref||Date.parse(b.available_at)<Date.parse(b.date+'T13:30:00+08:00'))return reject('OUTCOME_BAR_INVALID_OR_NOT_TRADABLE');
  rows.push(b);
 }
 const first=rows[0];
 // A condition that did not trigger on the next session expires. It is not a
 // zero-return winning trade, and must be excluded from performance denominators.
 if(first.high<=trigger)return {...output,state:'NOT_ENTERED',reason:'NEXT_SESSION_ENTRY_EXPIRED'};
 const entry=Math.max(first.open,trigger),risk=(entry-stop)/entry;
 if(risk>V2_POLICY.max_stop_distance)return {...output,state:'NOT_ENTERED',reason:'OPEN_GAP_EXCEEDS_LOCKED_RISK_BUDGET'};
 let exit=rows.at(-1)!.close,exitDate=rows.at(-1)!.date,max=entry,min=entry;
 for(let i=0;i<rows.length;i++){
  const b=rows[i];
  // On entry day both entry and stop may have traded. Assume entry then stop;
  // never claim the day's high as a favourable excursion before proven entry.
  if(b.low<=stop){exit=i>0&&b.open<stop?b.open:stop;min=Math.min(min,exit);exitDate=b.date;break;}
  if(i>0)max=Math.max(max,b.high);min=Math.min(min,b.low);
 }
 const ret=exit/entry-1;
 return {...output,state:'OBSERVED',reason:'GROSS_OHLC_CONSERVATIVE_RESEARCH_OUTCOME',entry_at:first.date,exit_at:exitDate,return:ret,mfe:max/entry-1,mae:min/entry-1,win_loss:ret>0?'WIN':ret<0?'LOSS':'FLAT'};
}
export { summarizeV2Outcomes } from '../../../src/features/research/recommendation-shadow-v2-summary.ts';
