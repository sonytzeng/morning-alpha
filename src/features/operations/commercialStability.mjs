// Independent read-only acceptance candidate. No Production writes or scheduler.
import {coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate} from '../../../supabase/functions/_shared/market-session-contract.mjs';
export const COMMERCIAL_STABILITY_VERSION='COMMERCIAL_STABILITY_V1';
export const ACCEPTANCE_SLOTS=Object.freeze({AM:'08:15',PM:'15:40'});
const required=['core_market','report','line','public_consistency','member_permissions','recommendation_evaluation'];
const pmRequired=['six_checkpoints','closing','learning'];
const time=at=>{const n=Date.parse(at);return Number.isFinite(n)?new Date(n+8*3600000).toISOString():null;};
export function classifyCommercialDay(date,observations,release,observedThrough=Date.now()){
 if(!coveredCalendarDate('TW',date))return {date,status:'NOT_READY',reasons:['CALENDAR_COVERAGE_UNKNOWN']};
 if(!isMarketTradingDate('TW',date))return {date,status:'NOT_APPLICABLE',reasons:[]};
 if(date==='2026-10-13')return {date,status:'FAIL',reasons:['CONFIRMED_TODAY_CONFIDENCE_PRESENTATION_DEFECT']};
 if(!release?.production_verified||!release?.owner_approved||!/^[a-f0-9]{40}$/.test(release.sha||'')||!time(release.verified_at)||!Number.isFinite(observedThrough)||Date.parse(release.verified_at)>observedThrough)return {date,status:'NOT_READY',reasons:['RELEASE_NOT_VERIFIED']};
 const reasons=[];
 for(const slot of ['AM','PM']){
  const records=observations.filter(r=>r.date===date&&r.slot===slot);
  if(records.length!==1){reasons.push(slot+':MISSING_OR_DUPLICATE_OBSERVATION');continue;}
  const r=records[0],clock=time(r.observed_at),at=Date.parse(r.observed_at);
  if(!clock||clock.slice(0,10)!==date||clock.slice(11,16)!==ACCEPTANCE_SLOTS[slot]||r.release_sha!==release.sha||at<Date.parse(release.verified_at)||at>observedThrough||r.mode!=='NATURAL_READ_ONLY')reasons.push(slot+':INVALID_PROVENANCE');
  if(!['PASS','DEGRADED'].includes(r.operational_status))reasons.push(slot+':CORE_NOT_USABLE');
  for(const key of [...required,...(slot==='PM'?pmRequired:[])])if(r.checks?.[key]!==true)reasons.push(slot+':'+key);
  if(!Array.isArray(r.major_incidents)||r.major_incidents.length)reasons.push(slot+':MAJOR_INCIDENTS');
  if(!['READY','WATCH','NONE','BLOCKED'].includes(r.recommendation?.status)||r.recommendation?.evidence_traceable!==true||r.recommendation?.evaluation_completed!==true||r.recommendation?.pipeline_defect!==false)reasons.push(slot+':RECOMMENDATION_NOT_PROVEN');
 }
 return {date,status:reasons.length?'FAIL':'PASS',reasons};
}
export function commercialStabilityGate(observations,release,observedThrough=Date.now()){
 const dates=[...new Set(observations.map(r=>r.date))].sort(),days=dates.map(date=>classifyCommercialDay(date,observations,release,observedThrough));
 let streak=0,last=null;
 for(const day of days){
  if(day.status==='NOT_APPLICABLE')continue;
  if(day.status!=='PASS'){streak=0;last=day.date;continue;}
  if(last&&previousMarketTradingDate('TW',day.date)!==last)streak=0;
  streak++;last=day.date;
 }
 return {version:COMMERCIAL_STABILITY_VERSION,status:streak>=5?'PASS':'NOT_READY',consecutive_trading_days:streak,days,payment_resume:'OWNER_CONFIRMATION_REQUIRED',production_observation_claimed:false};
}
