/** OFFLINE OWNER RESEARCH CANDIDATE. No handler, browser, DB, dispatch or
 * promotion path. Not a drop-in replacement for formal Decision V1.
 * V2 changes the research question from expectations surprise to actual growth.
 * An event FACT only admits a research WATCH, never an actionable READY. */
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import type {EvidenceData,DecisionIdentity,Row} from '../supabase/functions/_shared/decision-v1-data.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import type {CompanyEvent} from '../supabase/functions/_shared/recommendation-company-events.ts';
import {COMPANY_EVENT_SOURCES} from '../supabase/functions/_shared/recommendation-company-events.ts';

export type ShareFlow={symbol:string;trading_date:string;institution_type:'foreign'|'investment_trust'|'dealer';buy_shares:number;sell_shares:number;net_shares:number;unit:'SHARES';source_ref:string;available_at:string};
export type ActualQuarter={symbol:string;period:string;revenue:number;eps:number;revenue_unit:string;eps_unit:string;source_ref:string;published_at:string;available_at:string};
export type ShadowInput={data:EvidenceData;identity:DecisionIdentity;shares:ShareFlow[];actuals:ActualQuarter[];events:CompanyEvent[]};
const stamp=(s:string)=>Date.parse(s),finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const validUrl=(s:string)=>{try{return new URL(s).protocol==='https:';}catch{return false;}};
function pressure(input:ShadowInput,symbol:string){
 const cutoff=stamp(input.identity.generated_at),expected=previousMarketTradingDate('TW',input.identity.report_date);
 const rows=input.shares.filter(r=>r.symbol===symbol&&r.trading_date===expected&&Number.isFinite(stamp(r.available_at))&&stamp(r.available_at)<=cutoff);
 const types=['foreign','investment_trust','dealer'];
 if(rows.length!==3||!types.every(t=>rows.filter(r=>r.institution_type===t).length===1)||rows.some(r=>r.unit!=='SHARES'||!validUrl(r.source_ref)||stamp(r.available_at)<stamp(r.trading_date+'T13:30:00+08:00')||![r.buy_shares,r.sell_shares,r.net_shares].every(Number.isSafeInteger)||r.buy_shares<0||r.sell_shares<0||r.buy_shares-r.sell_shares!==r.net_shares))return null;
 const gross=rows.reduce((s,r)=>s+r.buy_shares+r.sell_shares,0);
 if(!Number.isSafeInteger(gross)||gross<=0)return null;
 return {value:rows.reduce((s,r)=>s+r.net_shares,0)/gross,unit:'SHARES_NORMALIZED_PRESSURE',source_refs:rows.map(r=>r.source_ref)};
}
function growth(input:ShadowInput,symbol:string){
 const cutoff=stamp(input.identity.generated_at),q=(p:string)=>{const m=p.match(/^(\d{4})-Q([1-4])$/);return m?Number(m[1])*4+Number(m[2]):NaN;};
 const rows=input.actuals.filter(r=>r.symbol===symbol&&Number.isFinite(stamp(r.available_at))&&stamp(r.available_at)<=cutoff&&Number.isFinite(stamp(r.published_at))&&stamp(r.published_at)<=stamp(r.available_at)).sort((a,b)=>q(b.period)-q(a.period));
 if(rows.length<5)return null;
 const five=rows.slice(0,5),latest=five[0],prior=five[4];
 if(five.some((r,i)=>!Number.isFinite(q(r.period))||i>0&&q(five[i-1].period)-q(r.period)!==1||Date.UTC(Number(r.period.slice(0,4)),Number(r.period.slice(-1))*3,0,15,59,59)>=stamp(r.published_at)||!finite(r.revenue)||r.revenue<0||!finite(r.eps)||!validUrl(r.source_ref)||!r.revenue_unit||!r.eps_unit||r.revenue_unit==='SOURCE_REPORTED_NOT_CONVERTED'||r.revenue_unit!==latest.revenue_unit||r.eps_unit!==latest.eps_unit||cutoff-stamp(r.published_at)>550*86400000)||cutoff-stamp(latest.published_at)>120*86400000||prior.revenue<=0)return null;
 return {revenue_yoy:latest.revenue/prior.revenue-1,eps_change:latest.eps-prior.eps,eps_latest:latest.eps,
  research_question:'ACTUAL_GROWTH_NOT_EARNINGS_SURPRISE',consensus_available:false,source_refs:five.map(r=>r.source_ref)};
}
function event(input:ShadowInput,symbol:string){
 const cutoff=stamp(input.identity.generated_at);
 return input.events.filter(e=>e.symbol===symbol&&e.event_fact===true&&e.bullishness===null&&e.impact_review==='REQUIRED'&&e.raw_retained===false&&/^[a-f0-9]{64}$/.test(e.source_hash)&&COMPANY_EVENT_SOURCES.some(s=>s.url===e.source_ref&&s.exchange===e.exchange)&&Number.isFinite(stamp(e.published_at))&&Number.isFinite(stamp(e.available_at))&&stamp(e.published_at)<=stamp(e.available_at)&&stamp(e.available_at)<=cutoff&&cutoff-stamp(e.published_at)<=72*3600000)
  .sort((a,b)=>b.published_at.localeCompare(a.published_at)||a.source_hash.localeCompare(b.source_hash))[0]??null;
}
/** Do not replace unknown evidence with synthetic TWD/consensus/mappings.
 * The original V1 evaluator always sees the original unmodified input.
 * Price response/sector/risk/market prerequisites remain explicit blockers.
 * This exploratory stage cannot emit READY; impact and prospective entry
 * calibration need separately reviewed design and future Forward validation. */
export async function compareRecommendationV2(input:ShadowInput){
 const v1=buildEvidenceDecision(input.data,input.identity),phase=v1.phase_evaluation;
 const replaceable=new Set(['THREE_INSTITUTIONS_MISSING','FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING','SOURCED_COMPANY_CATALYST_MAPPING_MISSING','EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING']);
 const candidates=(phase?.candidates??[]).map(c=>{
  const flow=pressure(input,c.symbol),actual=growth(input,c.symbol),companyEvent=event(input,c.symbol);
  const blockers=c.reasons.filter(r=>!replaceable.has(r));
  if(input.data.failures.length)blockers.push('SOURCE_LOAD_FAILED');
  if(!flow)blockers.push('V2_SHARES_SOURCE_INCOMPLETE');
  if(!actual)blockers.push('V2_ACTUAL_GROWTH_HISTORY_INCOMPLETE');
  if(!companyEvent)blockers.push('V2_OFFICIAL_COMPANY_EVENT_MISSING');
  // This WATCH is explicitly a research-observation queue, NOT V1's entry
  // WATCH. Event-reaction remains unassessed and cannot produce READY.
  const rejected=flow!==null&&flow.value<=0||actual!==null&&(actual.revenue_yoy<0||actual.eps_change<0||actual.eps_latest<=0);
  return {symbol:c.symbol,v1_status:c.status,v1_reasons:c.reasons,v2_status:blockers.length?'BLOCKED':rejected?'NONE':'WATCH',
   scope:'RESEARCH_OBSERVATION_ONLY',blockers:[...new Set(blockers)].sort(),flow,actual,event:companyEvent,
   reason:rejected?'OBSERVED_DIRECTION_OR_ACTUAL_GROWTH_REJECTED':'OFFICIAL_EVENT_REQUIRES_IMPACT_REVIEW_AND_ENTRY_VALIDATION',
   entry_evaluation:'NOT_RUN',ready_candidate:false,changes:['TWD pressure → same-stock SHARES pressure','expectations surprise → actual growth (different question)','derived bullish catalyst → official event fact, impact unproven']};
 });
 const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v as Row).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(input))));
 const digest=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
 return {methodology:'RECOMMENDATION_V2_RESEARCH_CANDIDATE',input_sha256:digest,both_versions_same_input:true,
  v1_status:phase?.status??'BLOCKED',candidates,owner_only:true,offline_only:true,shadow_only:true,
  production_enabled:false,forward_enabled:false,forward_sample:0,calibration:'INSUFFICIENT_SAMPLE',promotion_allowed:false,business_writes:[]};
}
