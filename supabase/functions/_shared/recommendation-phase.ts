/** Recommendation-only session semantics. Does not change Provider or Atomic. */
import { isMarketTradingDate, previousMarketTradingDate, latestCompletedUsSession, usSessionCloseMinute } from './market-session-contract.mjs';
import { evaluatePremarketTxfSession } from './txf-session-contract.mjs';
import type { DecisionIdentity, Row } from './decision-v1-data.ts';
export type EvaluationPhase = 'PREMARKET' | 'INTRADAY';
export type PhaseStatus = 'PREMARKET_WATCH' | 'PREMARKET_READY' | 'PREMARKET_NONE' | 'READY' | 'NONE' | 'BLOCKED';
export type PhaseCandidate = { symbol: string; status: 'WATCH' | 'READY' | 'NONE' | 'DROP' | 'BLOCKED'; reasons: string[]; post_event_price: 'NOT_YET_OBSERVABLE' | 'PASS' | 'FAIL' | 'MISSING'; post_event_volume: 'NOT_YET_OBSERVABLE' | 'PASS' | 'FAIL' | 'MISSING'; evidence_ids: string[]; relative_strength?:boolean; risk_pass?:boolean };
export type PhaseEvaluation = { evaluation_phase: EvaluationPhase; status: PhaseStatus; universe_count: number; evaluated_count: number; watch_count: number; ready_count: number; none_count: number; blocked_count: number; not_yet_observable_count: number; reason_distribution: Record<string,number>; candidates: PhaseCandidate[] };
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
export function evaluationPhase(at:string):EvaluationPhase {
 const d=new Date(Date.parse(at)+8*3600000);return d.getUTCHours()<9?'PREMARKET':'INTRADAY';
}
export function recommendationQuoteCurrent(row:Row, identity:DecisionIdentity):boolean {
 const at=Date.parse(String(row.captured_at)),now=Date.parse(identity.generated_at),symbol=String(row.symbol);
 if(!Number.isFinite(at)||!Number.isFinite(now)||at>now||Date.parse(String(row.ingested_at))>now)return false;
 const local=new Date(at+8*3600000).toISOString(),phase=evaluationPhase(identity.generated_at);
 const raw=obj(row.raw_payload),native=obj(raw.source_raw);
 if(/^\d{4,6}$/.test(symbol)||symbol==='TAIEX'){
  if(!isMarketTradingDate('TW',identity.report_date))return false;
  const expected=phase==='PREMARKET'?previousMarketTradingDate('TW',identity.report_date):identity.report_date;
  const session=String(raw.evidence_session_date||native.evidence_session_date||row.trading_date);
  if(session!==expected||local.slice(0,10)!==expected)return false;
  const minute=Number(local.slice(11,13))*60+Number(local.slice(14,16));
  const completedClose = row.phase==='close' && minute>=13*60+25 && minute<=13*60+30;
  return phase==='PREMARKET'?completedClose:completedClose || minute>=9*60 && minute<=13*60+30 && now-at<=20*60000;
 }
 if(symbol==='TXF'){
  if(phase==='PREMARKET')return evaluatePremarketTxfSession({tradingDate:identity.report_date,providerSessionDate:raw.evidence_session_date||native.evidence_session_date||native.date||row.trading_date,session:native.session||raw.session,sourceTimestamp:row.captured_at,observedAt:identity.generated_at}).valid===true;
  const minute=Number(local.slice(11,13))*60+Number(local.slice(14,16));
  return local.slice(0,10)===identity.report_date && minute>=525 && minute<=825 && (now-at<=20*60000 || row.phase==='close'&&minute===825);
 }
 if(['SOX','SPX'].includes(symbol)){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
  const p=(key:string)=>parts.find(v=>v.type===key)?.value||'';
  const ny=`${p('year')}-${p('month')}-${p('day')}`;
  return ny===latestCompletedUsSession(now) && Number(p('hour'))*60+Number(p('minute'))>=usSessionCloseMinute(ny) && now-at<=7*86400000;
 }
 return now-at<=80*3600000;
}
export function summarizePhase(phase:EvaluationPhase,candidates:PhaseCandidate[],systemBlocked=false):PhaseEvaluation{
 const count=(s:PhaseCandidate['status'])=>candidates.filter(c=>c.status===s).length;
 const watch=count('WATCH'),ready=count('READY'),none=count('NONE')+count('DROP'),blocked=count('BLOCKED');
 const reasons:Record<string,number>={};for(const c of candidates)for(const r of new Set(c.reasons))reasons[r]=(reasons[r]||0)+1;
 return {evaluation_phase:phase,status:systemBlocked||blocked||!candidates.length?'BLOCKED':phase==='PREMARKET'?(ready?'PREMARKET_READY':watch?'PREMARKET_WATCH':'PREMARKET_NONE'):(ready?'READY':'NONE'),universe_count:candidates.length,evaluated_count:candidates.length-blocked,watch_count:watch,ready_count:ready,none_count:none,blocked_count:blocked,not_yet_observable_count:candidates.filter(c=>c.post_event_price==='NOT_YET_OBSERVABLE').length,reason_distribution:reasons,candidates};
}
/** Missing prior WATCH lineage is null, never an invented zero or a claim that
 * today's whole universe was yesterday's WATCH list. Counts are intersections. */
export function phaseFunnel(p:PhaseEvaluation,priorWatch:string[]|null=null){
 const cs=p.candidates,clean=(rs:PhaseCandidate[],reasons:string[])=>rs.filter(c=>!c.reasons.some(r=>reasons.includes(r)));
 const liquidity=clean(cs,['FRESH_QUOTE_MISSING','CONFLICTING_QUOTES','20_DAILY_VOLUMES_MISSING']);
 const market=liquidity.filter(c=>!c.reasons.some(r=>r.startsWith('MARKET_REQUIRED_')||r==='MARKET_RISK_REJECTED'));
 const sector=clean(market,['SECTOR_REACTION_MISSING']);
 const evidence=sector.filter(c=>c.status!=='BLOCKED');
 const rows=p.evaluation_phase==='PREMARKET'?cs:priorWatch===null?null:cs.filter(c=>priorWatch.includes(c.symbol));
 const price=rows?.filter(c=>c.post_event_price==='PASS'),volume=price?.filter(c=>c.post_event_volume==='PASS');
 const relative=volume?.filter(c=>c.relative_strength===true),risk=relative?.filter(c=>c.risk_pass===true),entry=risk?.filter(c=>c.status==='READY');
 return {premarket:{universe:p.universe_count,scanned:cs.length,liquidity:liquidity.length,market_fit:market.length,sector_fit:sector.length,evidence:evidence.length,watch:p.watch_count,ready:p.ready_count,none:p.none_count,blocked:p.blocked_count,not_yet_observable:p.not_yet_observable_count},
  intraday:{watch_input:priorWatch?.length??null,price_confirmed:price?.length??null,volume_confirmed:volume?.length??null,relative_strength:relative?.length??null,risk:risk?.length??null,entry:entry?.length??null,ready:entry?.length??null,drop:rows?.filter(c=>c.status==='DROP'||c.status==='NONE').length??null},
  watch_lineage:priorWatch===null?'UNAVAILABLE':'SAME_DAY_PERSISTED_PREMARKET_PROOF',liquidity_definition:'existing price and 20-day volume completeness; no new threshold'};
}
/** Consecutive expected trading days, not report count. Missing days do not disappear. */
export function recommendationServiceSla(days:{date:string;status:string}[],today:string){
 const byDay=new Map<string,string[]>();for(const d of days){const rows=byDay.get(d.date)||[];rows.push(d.status);byDay.set(d.date,rows);}
 const since=days.map(d=>d.date).filter(d=>isMarketTradingDate('TW',d)&&d<=today).sort()[0];
 let date=today,streak=0;
 for(let i=0;i<60&&date&&since&&date>=since;i++){
  if(isMarketTradingDate('TW',date)){
   const states=byDay.get(date)||[];
   if(states.length===1&&['READY','NONE','PREMARKET_READY','PREMARKET_NONE','PREMARKET_WATCH','QUALIFIED','NO_QUALIFIED_OPPORTUNITY'].includes(states[0]))break;
   streak++;
  }
  date=previousMarketTradingDate('TW',date)||'';
 }
 return {blocked_streak:streak,status:!since?'UNAVAILABLE':streak>=5?'RECOMMENDATION_SERVICE_DEGRADED':streak>=3?'WARNING':'NORMAL',coverage_start:since||null,missing_day_policy:'BLOCKED_WITHIN_RECORDED_COVERAGE',none_is_failure:false,watch_is_failure:false};
}
