import { HORIZONS, sourceSafe, type Horizon } from './contracts.ts';
import { validProjectionTime } from './projection.ts';
import { parsePublicMarketReadModel, PUBLIC_REGIMES } from '../../lib/publicMarketReadModel.ts';
import { resolveSubscriberPayloadIdentity } from '../../lib/subscriberReportContract.ts';

export const STOCK_OBSERVATION_NAV = Object.freeze({to:'/stocks',label:'股票觀察'});
export const MEMBER_NAVIGATION = Object.freeze([
  {to:'/report/today',label:'今日市場'}, STOCK_OBSERVATION_NAV,
  {to:'/academy',label:'股票學院'}, {to:'/account',label:'會員中心'},
]);
export type MemberEvidence = {summary:string;source:string;url:string;available_at:string;classification:string;stance:'SUPPORTS'|'CONTRADICTS'|'CONTEXT'};
export type MemberDetails = {evidence:MemberEvidence[];
  events:{title:string;source:string;available_at:string;invalidation:string;urls:string[]}[];
  relations:{from:string;to:string;type:string;source:string;available_at:string;urls:string[]}[];
  outcomes:{horizon_days:number;state:'NOT_MATURED'|'NOT_ENTERED'|'UNCONFIRMED';observed_at:string}[]};
export type MemberObservation = {id:string;symbol:string;company:string;horizon:Horizon;
  status:'WATCHING'|'CONDITION_MET'|'INVALIDATED'|'EXPIRED'|'REVIEW_DUE';reason:string;risk:string;
  created_at:string;as_of:string;next_review_at:string;confirmation:string[];invalidation:string[];details:MemberDetails|null};
export type MemberResearch = {tier:'free'|'premium'|'owner';business_date:string;observations:MemberObservation[];history:MemberObservation[];watchlist:string[]};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('MEMBER_OBJECT');return v as Record<string,unknown>;};
const text=(v:unknown):string=>{if(typeof v!=='string'||!v.trim()||v.length>3000)throw Error('MEMBER_TEXT');return v;};
const array=(v:unknown,max=500):unknown[]=>{if(!Array.isArray(v)||v.length>max)throw Error('MEMBER_ARRAY');return v;};
const texts=(v:unknown)=>array(v,100).map(text);
const time=(v:unknown):string=>{if(!validProjectionTime(v))throw Error('MEMBER_TIME');return v;};
const one=<T extends string>(v:unknown,options:readonly T[]):T=>{if(!options.includes(v as T))throw Error('MEMBER_ENUM');return v as T;};
const url=(v:unknown)=>{const s=text(v);if(!sourceSafe(s))throw Error('MEMBER_SOURCE');return s;};
const urls=(v:unknown)=>{const a=array(v,50).map(url);if(!a.length)throw Error('MEMBER_SOURCE');return a;};
function details(v:unknown):MemberDetails{
 const d=object(v);
 return {evidence:array(d.evidence,100).map(v=>{const e=object(v);return {summary:text(e.summary),source:text(e.source),url:url(e.url),available_at:time(e.available_at),
  classification:one(e.classification,['CONFIRMED_FACT','REPORTED_CLAIM','INFERENCE','UNVERIFIED']),stance:one(e.stance,['SUPPORTS','CONTRADICTS','CONTEXT'])};}),
 events:array(d.events,50).map(v=>{const e=object(v);return {title:text(e.title),source:text(e.source),available_at:time(e.available_at),invalidation:text(e.invalidation),urls:urls(e.urls)};}),
 relations:array(d.relations,50).map(v=>{const r=object(v);return {from:text(r.from),to:text(r.to),type:one(r.type,['CUSTOMER','SUPPLIER','COMPETITOR','PRODUCT']),source:text(r.source),available_at:time(r.available_at),urls:urls(r.urls)};}),
 outcomes:array(d.outcomes,10).map(v=>{const o=object(v);if(!Number.isInteger(o.horizon_days)||Number(o.horizon_days)<1)throw Error('MEMBER_OUTCOME');return {horizon_days:Number(o.horizon_days),state:one(o.state,['NOT_MATURED','NOT_ENTERED','UNCONFIRMED']),observed_at:time(o.observed_at)};})};
}
export function parseMemberResearch(value:unknown):MemberResearch{
 const p=object(value),tier=one(p.tier,['free','premium','owner']);
 if(p.schema!=='VNEXT_MEMBER_V1'||p.research_only!==true||typeof p.business_date!=='string'||!validProjectionTime(p.business_date+'T00:00:00Z'))throw Error('MEMBER_CONTRACT');
 const read=(value:unknown):MemberObservation=>{const o=object(value);
  if(tier==='free'&&o.details!==null)throw Error('FREE_DETAIL_LEAK');
  if(tier!=='free'&&o.details===null)throw Error('PREMIUM_DETAILS_MISSING');
  const card:MemberObservation={id:text(o.id),symbol:text(o.symbol),company:text(o.company),horizon:one(o.horizon,Object.keys(HORIZONS) as Horizon[]),
   status:one(o.status,['WATCHING','CONDITION_MET','INVALIDATED','EXPIRED','REVIEW_DUE']),reason:text(o.reason),risk:text(o.risk),created_at:time(o.created_at),as_of:time(o.as_of),next_review_at:time(o.next_review_at),
   confirmation:texts(o.confirmation),invalidation:texts(o.invalidation),details:o.details===null?null:details(o.details)};
  if(!card.confirmation.length||!card.invalidation.length||Date.parse(card.as_of)>Date.parse(card.created_at)||Date.parse(card.next_review_at)<=Date.parse(card.created_at))throw Error('MEMBER_PIT');
  for(const e of [...card.details?.evidence||[],...card.details?.events||[],...card.details?.relations||[]])if(Date.parse(e.available_at)>Date.parse(card.created_at))throw Error('MEMBER_FUTURE_EVIDENCE');
  return card;
 };
 const observations=array(p.observations).map(read),history=array(p.history).map(read),watchlist=array(p.watchlist,200).map(text);
 const ids=[...observations,...history].map(o=>o.id);
 if(new Set(ids).size!==ids.length||new Set(watchlist).size!==watchlist.length||watchlist.some(id=>!ids.includes(id)))throw Error('MEMBER_IDENTITY');
 if(tier==='free'&&(new Set(observations.map(o=>o.symbol)).size>3||history.length||watchlist.length))throw Error('FREE_SCOPE');
 return {tier,business_date:p.business_date,observations,history,watchlist};
}

/** Minimal view of the existing canonical public model; never infer a direction
 * from research scores, and never manufacture a current-date report. */
export function memberMarketSummary(value:unknown):{date:string;direction:string;regime:string;action:string}|null{
 try{const r=object(value),identity=resolveSubscriberPayloadIdentity(value),payload=object(r.payload);
  if(!identity)return null;
  const verified=parsePublicMarketReadModel(payload.public_market_read_model,{report_date:identity.reportDate,revision_id:identity.revisionId});
  if(!verified)return null;
  return {date:verified.business_date,direction:verified.market_direction,regime:PUBLIC_REGIMES[verified.market_regime],action:{ACT:'依正式條件評估',WAIT:'先等確認',STOP:'暫停行動'}[verified.action]};
 }catch{return null;}
}
