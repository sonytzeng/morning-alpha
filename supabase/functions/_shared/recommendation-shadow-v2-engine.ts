/** Prospective research hypothesis, not formal Recommendation V1.
 * Pure calculation: no fetch, DB, credentials, dispatch, or promotion. */
import type { EvidenceData, DecisionIdentity, Row } from './decision-v1-data.ts';
import type { Capture } from './recommendation-stock-evidence.ts';
import { RECOMMENDATION_UNIVERSE } from './recommendation-stock-evidence.ts';
import { recommendationQuoteCurrent } from './recommendation-phase.ts';
import { previousMarketTradingDate, isMarketTradingDate } from './market-session-contract.mjs';
import type { CompanyEvent } from './recommendation-company-events.ts';
import type { Shares, ActualGrowth, V2SourceCapture } from './recommendation-shadow-v2-sources.ts';
import { V2_HORIZONS } from './recommendation-shadow-v2-summary.ts';

export const V2_METHODOLOGY='RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0';
export const V2_POLICY=Object.freeze({min_average_amount_twd:50_000_000,max_stop_distance:.08,min_sector_peers:3,min_relative_strength:0,min_momentum:0,max_market_daily_change:3,
 horizons:V2_HORIZONS,consensus_required:false,production_eligible:false,promotion_min_forward_dates:20});
export type Availability='AVAILABLE'|'PARTIAL'|'UNAVAILABLE';
export type V2Evidence={status:Availability;value:unknown;reason:string;source_refs:string[]};
export type Bar={date:string;open:number;high:number;low:number;close:number;volume:number;amount:number;source_ref:string;available_at:string};
export type V2Input={identity:DecisionIdentity;data:EvidenceData;captures:Capture[];sources:(V2SourceCapture<Shares|ActualGrowth>&{kind:string})[];events:CompanyEvent[];events_complete:boolean;quarterly_actuals?:Row[];v1:Row};
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
const stamp=(v:unknown)=>Date.parse(String(v));
const known=(r:Row,cutoff:number)=>Number.isFinite(stamp(r.captured_at))&&stamp(r.captured_at)<=cutoff&&Number.isFinite(stamp(r.ingested_at))&&stamp(r.ingested_at)<=cutoff;
const evidence=(status:Availability,value:unknown,reason:string,refs:string[]=[]):V2Evidence=>({status,value,reason,source_refs:[...new Set(refs)].sort()});
export function v2Canonical(value:unknown){
 const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v as Row).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
 return JSON.stringify(canonical(value));
}
export async function v2Hash(value:unknown){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v2Canonical(value)))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function nextV2Session(date:string){
 for(let i=1;i<=30;i++){const d=new Date(Date.parse(date+'T00:00:00Z')+i*86400000).toISOString().slice(0,10);if(isMarketTradingDate('TW',d))return d;}
 throw Error('V2_CALENDAR_UNAVAILABLE');
}
export function v2Bars(input:V2Input,symbol:string):Bar[]{
 const cutoff=stamp(input.identity.generated_at),last=previousMarketTradingDate('TW',input.identity.report_date);
 if(!last)return [];
 const cs=input.captures.filter(c=>c.symbol===symbol&&c.endpoint==='historical/candles');
 if(cs.length!==1||cs[0].status!=='PASS'||stamp(cs[0].received_at)>cutoff)return [];
 const dates=new Set<string>(),out:Bar[]=[];
 for(const r of cs[0].rows){const p=obj(r.raw_payload),date=String(r.trading_date);
  if(r.symbol!==symbol||!known(r,cutoff)||!isMarketTradingDate('TW',date)||date>last||dates.has(date)||
   p.contract!=='RECOMMENDATION_STOCK_EVIDENCE_V1'||p.volume_unit!=='SHARES'||p.amount_unit!=='TWD'||
   ![p.open,p.high,p.low,p.close,p.volume_shares,p.amount_twd].every(finite)||
   Math.min(Number(p.open),Number(p.high),Number(p.low),Number(p.close))<=0||Number(p.volume_shares)<0||Number(p.amount_twd)<0||
   Number(p.high)<Math.max(Number(p.open),Number(p.close))||Number(p.low)>Math.min(Number(p.open),Number(p.close)))return [];
  dates.add(date);out.push({date,open:Number(p.open),high:Number(p.high),low:Number(p.low),close:Number(p.close),volume:Number(p.volume_shares),amount:Number(p.amount_twd),source_ref:String(r.id),available_at:String(r.ingested_at)});
 }
 let expected:string|null=last;for(let i=0;i<20;i++){if(!expected||!dates.has(expected))return [];expected=previousMarketTradingDate('TW',expected);}
 return out.sort((a,b)=>a.date.localeCompare(b.date));
}
function benchmark(input:V2Input,dates:string[]):number[]|null{
 const cutoff=stamp(input.identity.generated_at),result:number[]=[];
 for(const date of dates){
  const rows=input.data.quotes.filter(r=>r.symbol==='TAIEX'&&r.trading_date===date&&r.phase==='close'&&known(r,cutoff)&&finite(r.value)&&r.value>0);
  // A calendar match is insufficient: each row must satisfy that session's
  // completed-close contract, evaluated before the following open.
  const id={...input.identity,report_date:nextV2Session(date),generated_at:nextV2Session(date)+'T08:30:00+08:00'};
  const valid=rows.filter(r=>recommendationQuoteCurrent(r,id));
  if(!valid.length||new Set(valid.map(r=>r.value)).size!==1)return null;
  result.push(Number(valid[0].value));
 }return result;
}
export async function evaluateV2Shadow(input:V2Input){
 const cutoff=stamp(input.identity.generated_at),date=input.identity.report_date;
 const universe=input.data.universe.filter(r=>r.is_active===true).map(r=>String(r.symbol)).sort();
 const exact=JSON.stringify(universe)===JSON.stringify([...RECOMMENDATION_UNIVERSE].sort());
 if(!exact||!Number.isFinite(cutoff)||input.identity.today_date!==date||!isMarketTradingDate('TW',date)||input.v1.report_date!==date||input.v1.generated_at!==input.identity.generated_at)throw Error('V2_COMPARISON_IDENTITY_INVALID');
 const bySymbol=new Map(RECOMMENDATION_UNIVERSE.map(s=>[s,v2Bars(input,s).slice(-20)]));
 const marketRows=input.data.quotes.filter(r=>r.symbol==='TAIEX'&&known(r,cutoff)&&recommendationQuoteCurrent(r,input.identity)).sort((a,b)=>stamp(b.captured_at)-stamp(a.captured_at));
 const market=marketRows[0],marketConflict=marketRows.some(r=>r.captured_at===market?.captured_at&&r.value!==market.value);
 const validMarket=market&&!marketConflict&&finite(market.value)&&finite(market.change_percent);
 const v1Candidates=Array.isArray(obj(input.v1.phase_evaluation).candidates)?obj(input.v1.phase_evaluation).candidates as Row[]:[];
 const candidates=RECOMMENDATION_UNIVERSE.map(symbol=>{
  const bars=bySymbol.get(symbol)!,refs=bars.map(b=>b.source_ref),last=bars.at(-1),prior=bars[0];
  const metrics:Record<string,V2Evidence>={},blocked:string[]=[],rejected:string[]=[],pending:string[]=[];
  const availableBars=bars.length===20&&last!==undefined&&prior!==undefined;
  metrics.market=evidence(validMarket?'AVAILABLE':'UNAVAILABLE',validMarket?{daily_change_percent:market.change_percent}:null,'TAIEX_CURRENT_PHASE',[String(market?.id||'')].filter(Boolean));
  if(!validMarket)blocked.push('MARKET_SOURCE_INVALID');else if(Number(market.change_percent)<-V2_POLICY.max_market_daily_change)rejected.push('MARKET_DOWNSIDE_RISK');
  if(!availableBars)blocked.push('OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID');
  const amount=availableBars?mean(bars.map(b=>b.amount)):null;
  metrics.liquidity=evidence(availableBars?'AVAILABLE':'UNAVAILABLE',amount,'AVERAGE_20_COMPLETED_SESSIONS_TWD',refs);
  if(amount!==null&&(amount<V2_POLICY.min_average_amount_twd||bars.some(b=>b.volume<=0)))rejected.push('OBSERVED_LIQUIDITY_INSUFFICIENT');
  const momentum=availableBars?last.close/prior.close-1:null;
  metrics.momentum=evidence(momentum!==null?'AVAILABLE':'UNAVAILABLE',momentum,'20_CLOSE_TREND',refs);
  if(momentum!==null&&momentum<V2_POLICY.min_momentum)rejected.push('NEGATIVE_MOMENTUM');
  const index=availableBars?benchmark(input,bars.map(b=>b.date)):null;
  const relative=index&&momentum!==null?momentum-(index.at(-1)!/index[0]-1):null;
  metrics.relative_strength=evidence(relative!==null?'AVAILABLE':'UNAVAILABLE',relative,'SAME_SESSION_STOCK_MINUS_TAIEX_RETURN',refs);
  if(relative===null)blocked.push('BENCHMARK_SESSION_HISTORY_MISSING');else if(relative<V2_POLICY.min_relative_strength)rejected.push('UNDERPERFORMING_MARKET');
  const sector=String(input.data.universe.find(r=>r.symbol===symbol)?.sector||'');
  const peers=input.data.universe.filter(r=>r.is_active===true&&r.sector===sector&&r.symbol!==symbol).map(r=>bySymbol.get(String(r.symbol))||[]).filter(b=>b.length===20&&b[0].date===bars[0]?.date&&b[19].date===last?.date);
  const sectorReturn=sector&&peers.length>=V2_POLICY.min_sector_peers?mean(peers.map(b=>b[19].close/b[0].close-1)):null;
  // Return comparison consumes each peer's first/last close. Keep those exact
  // references, not 20 repeated bars per peer per candidate (quadratic payload).
  // Full validated histories remain in the immutable input capsule.
  metrics.sector=evidence(sectorReturn!==null?'AVAILABLE':'PARTIAL',sectorReturn,'CANONICAL_SECTOR_EQUAL_WEIGHT_EX_SELF',peers.flatMap(b=>[b[0].source_ref,b[19].source_ref]));
  if(sectorReturn===null)pending.push('SECTOR_COMPARISON_INSUFFICIENT');else if(sectorReturn<0)rejected.push('SECTOR_TREND_NEGATIVE');
  const ratio=availableBars&&mean(bars.map(b=>b.volume))>0?last.volume/mean(bars.map(b=>b.volume)):null;
  metrics.volume_price=evidence(ratio!==null?'AVAILABLE':'UNAVAILABLE',ratio,'LAST_COMPLETED_VOLUME_DIV_20_SESSION_AVERAGE',refs);
  if(ratio!==null&&ratio<1)pending.push('VOLUME_CONFIRMATION_PENDING');
  const shares=input.sources.filter(c=>c.kind==='shares'&&c.status==='PASS'&&stamp(c.received_at)<=cutoff).flatMap(c=>c.rows).filter((r):r is Shares=>'unit'in r&&r.symbol===symbol&&stamp(r.available_at)<=cutoff);
  shares.sort((a,b)=>b.session.localeCompare(a.session));
  const flow=shares[0],conflict=flow&&shares.filter(r=>r.session===flow.session).length!==1;
  const gross=flow?[flow.foreign,flow.trust,flow.dealer].reduce((s,f)=>s+f.buy+f.sell,0):0;
  const pressure=flow&&!conflict&&gross>0?[flow.foreign,flow.trust,flow.dealer].reduce((s,f)=>s+f.net,0)/gross:null;
  const net=flow&&!conflict?[flow.foreign,flow.trust,flow.dealer].reduce((s,f)=>s+f.net,0):null;
  const flowBar=flow?bars.find(b=>b.date===flow.session):undefined;
  metrics.institutional=evidence(pressure!==null?'AVAILABLE':'PARTIAL',pressure===null?null:{normalized_pressure:pressure,net_shares:net,relative_to_daily_volume:flowBar&&flowBar.volume>0?Number(net)/flowBar.volume:null,unit:'SHARES',session:flow.session},'SHARES_NOT_TWD; RELATIVE_VOLUME_REQUIRES_SAME_SESSION',flow?[flow.source]:[]);
  if(conflict)blocked.push('INSTITUTIONAL_SOURCE_CONFLICT');else if(pressure===null)pending.push('INSTITUTIONAL_DIRECTION_UNAVAILABLE');else if(pressure<=0)rejected.push('INSTITUTIONAL_SELLING_PRESSURE');
  const growths=input.sources.filter(c=>c.kind==='growth'&&c.status==='PASS'&&stamp(c.received_at)<=cutoff).flatMap(c=>c.rows).filter((r):r is ActualGrowth=>'actual_only'in r&&r.symbol===symbol&&stamp(r.available_at)<=cutoff);
  const growth=growths.length===1?growths[0]:null;
  const quarters=(input.quarterly_actuals||[]).filter(r=>r.symbol===symbol&&finite(r.eps_actual_as_reported)&&stamp(r.available_at)<=cutoff);
  const quarter=quarters.length===1?quarters[0]:null;
  metrics.fundamental=evidence(growth?'PARTIAL':'UNAVAILABLE',growth?{revenue_yoy:growth.revenue_yoy,revenue_mom:growth.revenue_mom,period:growth.period,
   eps_actual_as_reported:quarter?.eps_actual_as_reported??null,eps_period:quarter?.period??null,eps_basis:'AS_REPORTED_NOT_ASSUMED_STANDALONE_QUARTER',eps_trend:null,
   fundamental_direction:growth.revenue_yoy===null||growth.revenue_mom===null?'UNAVAILABLE':growth.revenue_yoy>=0&&growth.revenue_mom>=0?'ACTUAL_GROWTH':'ACTUAL_DETERIORATION',
   acceleration:null,acceleration_reason:'DISTINCT_PRIOR_PERIOD_SNAPSHOT_REQUIRED',consensus:'CONSENSUS_UNAVAILABLE'}:null,'ACTUAL_REVENUE_GROWTH; EPS_TREND_NOT_ESTABLISHED', [...(growth?[growth.source]:[]),...(quarter?[String(quarter.source)]:[])]);
  if(quarter&&Number(quarter.eps_actual_as_reported)<0)rejected.push('ACTUAL_REPORTED_EPS_NEGATIVE');
  if(growths.length>1)blocked.push('FUNDAMENTAL_SOURCE_CONFLICT');
  if(!growth||growth.revenue_yoy===null||growth.revenue_mom===null)pending.push('ACTUAL_GROWTH_UNAVAILABLE');
  else if(growth.revenue_yoy<0||growth.revenue_mom<0)rejected.push('ACTUAL_REVENUE_DETERIORATION');
  const events=input.events.filter(e=>e.symbol===symbol&&e.bullishness===null&&stamp(e.available_at)<=cutoff&&stamp(e.published_at)<=stamp(e.available_at)&&cutoff-stamp(e.published_at)<=72*3600000);
  metrics.catalyst=evidence(input.events_complete?'AVAILABLE':'PARTIAL',{events,positive_inference:false},events.length?'OFFICIAL_EVENT_REQUIRES_REVIEW':'NO_RECENT_EVENT_IN_AVAILABLE_FEED',events.map(e=>e.source_ref));
  if(!input.events_complete)pending.push('EVENT_SOURCE_UNAVAILABLE');
  if(events.length)pending.push('MATERIAL_EVENT_IMPACT_UNASSESSED');
  const trigger=availableBars?Math.max(...bars.map(b=>b.high)):null,stop=availableBars?Math.min(...bars.slice(-5).map(b=>b.low)):null;
  const distance=trigger!==null&&stop!==null?(trigger-stop)/trigger:null;
  metrics.risk=evidence(distance!==null?'AVAILABLE':'UNAVAILABLE',distance,'BREAKOUT_TO_FIVE_SESSION_LOW_DISTANCE',refs);
  if(distance!==null&&(distance<=0||distance>V2_POLICY.max_stop_distance))rejected.push('STOP_DISTANCE_OUTSIDE_RESEARCH_RISK_BUDGET');
  const start=nextV2Session(date);
  metrics.entry=evidence(trigger!==null&&stop!==null?'AVAILABLE':'UNAVAILABLE',{not_before:start,condition:'NEXT_SESSION_TRADE_STRICTLY_ABOVE_20_SESSION_HIGH',trigger_price:trigger,invalidation_price:stop,expires_after_sessions:1},'PROSPECTIVE_CONDITIONAL_LONG; NOT_EXECUTED',refs);
  const status=blocked.length?'BLOCKED':rejected.length?'NONE':pending.length?'WATCH':'READY';
  const v1=v1Candidates.find(c=>c.symbol===symbol);
  return {symbol,status,evidence:metrics,blockers:blocked,rejections:rejected,pending,
   supporting:[...(momentum!==null&&momentum>=0?['POSITIVE_COMPLETED_PRICE_TREND']:[]),...(relative!==null&&relative>=0?['NOT_UNDERPERFORMING_TAIEX']:[]),...(pressure!==null&&pressure>0?['INSTITUTIONAL_NET_BUY_SHARES']:[]),...(growth&&growth.revenue_yoy!==null&&growth.revenue_yoy>=0?['ACTUAL_REVENUE_YOY_NONNEGATIVE']:[])],
   contradicting:rejected,
   evidence_completeness:Object.values(metrics).filter(e=>e.status==='AVAILABLE').length/Object.keys(metrics).length,
   confidence:null,confidence_reason:'FORWARD_CALIBRATION_REQUIRED',entry:metrics.entry.value,horizons:V2_POLICY.horizons,
   v1_status:v1?.status??'BLOCKED',v1_reasons:v1?.reasons??['V1_RESULT_UNAVAILABLE']};
 });
 const counts=Object.fromEntries(['WATCH','READY','NONE','BLOCKED'].map(s=>[s,candidates.filter(c=>c.status===s).length]));
 return {methodology_version:V2_METHODOLOGY,policy:V2_POLICY,business_date:date,cutoff:input.identity.generated_at,
  source_revision:input.identity.revision_id,input_sha256:await v2Hash(input),candidates,counts,universe:72,scanned:candidates.length,
  same_universe_cutoff:true,shadow_only:true,owner_only:true,production_eligible:false,promotion_allowed:false,
  forward_sample:0,outcome_sample:0,analysis_value:'INSUFFICIENT_SAMPLE'};
}
