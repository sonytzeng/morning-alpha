import {HORIZONS,hashValid,sourceSafe,validObservationTime,type Horizon} from './contracts.ts';

export const DAILY_AI_MEMBER_STATES={WATCH:'值得追蹤',WAIT:'等待確認',AVOID:'暫不考慮',INSUFFICIENT:'資料不足'} as const;
export type DailyAiMemberState=keyof typeof DAILY_AI_MEMBER_STATES;
export type DailyAiMemberClaim={text:string;evidence_ids:string[]};
export type DailyAiMemberSource={id:string;source:string;kind:'NEWS'|'MARKET'|'FINANCIAL'|'PRICE';
 published_at:string|null;available_at:string;time_basis:'PUBLISHED'|'OBSERVED_AFTER_RECEIPT';
 first_seen_at:string|null;as_of:string|null;evidence_hash:string|null};
export type DailyAiMemberCard={symbol:string;company:string;horizon:Horizon;status:DailyAiMemberState;
 reason:DailyAiMemberClaim;counter_evidence:DailyAiMemberClaim[]|null;confirmation:string;invalidation:string;
 gaps:string[];sources:DailyAiMemberSource[]|null;classification:'INFERENCE'};
export type DailyAiMemberEdition={id:string;edition_date:string;data_through:string;evidence_cutoff:string;
 prepared_at:string;expires_at:string;mode:'AS_OF_RESEARCH';forecast:false;performance_available:false};
export type DailyAiMemberResearch={schema:'VNEXT_AI_MEMBER_EDITION_V1';tier:'free'|'premium'|'owner';business_date:string;
 research_only:true;edition:DailyAiMemberEdition|null;cards:DailyAiMemberCard[]};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_MEMBER_OBJECT');return value as Record<string,unknown>;};
const text=(value:unknown,max=1500)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('AI_MEMBER_TEXT');return value;};
const array=(value:unknown,max=216):unknown[]=>{if(!Array.isArray(value)||value.length>max)throw Error('AI_MEMBER_ARRAY');return value;};
const time=(value:unknown)=>{const s=text(value,40);if(!validObservationTime(s))throw Error('AI_MEMBER_TIME');return s;};
const nullableTime=(value:unknown)=>value===null?null:time(value);
const day=(value:unknown)=>{const s=text(value,10);if(!/^\d{4}-\d\d-\d\d$/.test(s)||!validObservationTime(s+'T00:00:00Z'))throw Error('AI_MEMBER_DATE');return s;};
const one=<T extends string>(value:unknown,values:readonly T[]):T=>{if(typeof value!=='string'||!values.includes(value as T))throw Error('AI_MEMBER_ENUM');return value as T;};
const hash=(value:unknown)=>{const s=text(value,64);if(!hashValid(s))throw Error('AI_MEMBER_HASH');return s;};
const claim=(value:unknown):DailyAiMemberClaim=>{const r=object(value),ids=array(r.evidence_ids,100).map(v=>text(v,200));
 if(!ids.length||new Set(ids).size!==ids.length)throw Error('AI_MEMBER_CITATION');return {text:text(r.text),evidence_ids:ids};};

/** Only the approved member projection is accepted. Provider receipts, raw input
 * content and unapproved job output are never copied into the browser model. */
export function parseDailyAiMember(value:unknown,expectedBusinessDate?:string,now=Date.now()):DailyAiMemberResearch{
 if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw Error('AI_MEMBER_NOW');
 const p=object(value),tier=one(p.tier,['free','premium','owner']),business_date=day(p.business_date);
 if(p.schema!=='VNEXT_AI_MEMBER_EDITION_V1'||p.research_only!==true)throw Error('AI_MEMBER_CONTRACT');
 if(expectedBusinessDate!==undefined&&business_date!==expectedBusinessDate)throw Error('AI_MEMBER_REQUEST_DATE');
 const values=array(p.cards);
 if(p.edition===null){if(values.length)throw Error('AI_MEMBER_EMPTY_EDITION');return {schema:'VNEXT_AI_MEMBER_EDITION_V1',tier,business_date,research_only:true,edition:null,cards:[]};}
 const e=object(p.edition),edition:DailyAiMemberEdition={id:hash(e.id),edition_date:day(e.edition_date),data_through:day(e.data_through),
  evidence_cutoff:time(e.evidence_cutoff),prepared_at:time(e.prepared_at),expires_at:time(e.expires_at),mode:'AS_OF_RESEARCH',forecast:false,performance_available:false};
 if(e.mode!=='AS_OF_RESEARCH'||e.forecast!==false||e.performance_available!==false)throw Error('AI_MEMBER_SCOPE');
 const cutoff=Date.parse(edition.evidence_cutoff),prepared=Date.parse(edition.prepared_at);
 if(cutoff>prepared||prepared>now||Date.parse(edition.expires_at)<=now||Date.parse(edition.expires_at)<=prepared
  ||new Date(cutoff+8*3600000).toISOString().slice(0,10)!==edition.edition_date
  ||Date.parse(edition.data_through+'T13:30:00+08:00')>cutoff)throw Error('AI_MEMBER_CHRONOLOGY');
 const cards=values.map(value=>{const r=object(value),symbol=text(r.symbol,6);
  if(!/^\d{4,6}$/.test(symbol)||r.classification!=='INFERENCE')throw Error('AI_MEMBER_CARD');
  const horizon=one(r.horizon,Object.keys(HORIZONS) as Horizon[]),status=one(r.status,Object.keys(DAILY_AI_MEMBER_STATES) as DailyAiMemberState[]);
  const reason=claim(r.reason),gaps=array(r.gaps,130).map(v=>text(v));
  if(status==='INSUFFICIENT'&&!gaps.length)throw Error('AI_MEMBER_GAPS');
  let sources:DailyAiMemberSource[]|null=null,counter_evidence:DailyAiMemberClaim[]|null=null;
  if(tier==='free'){
   if(Object.hasOwn(r,'sources')||Object.hasOwn(r,'counter_evidence'))throw Error('AI_MEMBER_FREE_SCOPE');
  }else{
   sources=array(r.sources,100).map(value=>{const s=object(value),url=text(s.source,3000),published_at=nullableTime(s.published_at),available_at=time(s.available_at);
    const first_seen_at=nullableTime(s.first_seen_at),as_of=nullableTime(s.as_of),evidence_hash=s.evidence_hash===null?null:hash(s.evidence_hash);
    const time_basis=one(s.time_basis,['PUBLISHED','OBSERVED_AFTER_RECEIPT']);
    if(!sourceSafe(url)||Date.parse(available_at)>cutoff
     ||published_at!==null&&(time_basis!=='PUBLISHED'||Date.parse(published_at)>Date.parse(available_at))
     ||published_at===null&&(time_basis!=='OBSERVED_AFTER_RECEIPT'||first_seen_at===null||as_of===null||evidence_hash===null)
     ||first_seen_at!==null&&Date.parse(first_seen_at)>Date.parse(available_at)||as_of!==null&&Date.parse(as_of)>Date.parse(available_at))throw Error('AI_MEMBER_SOURCE');
    return {id:text(s.id,200),source:url,kind:one(s.kind,['NEWS','MARKET','FINANCIAL','PRICE']),published_at,available_at,time_basis,first_seen_at,as_of,evidence_hash};
   });
   if(!sources.length||new Set(sources.map(s=>s.id)).size!==sources.length)throw Error('AI_MEMBER_SOURCE');
   counter_evidence=array(r.counter_evidence,20).map(claim);const ids=new Set(sources.map(s=>s.id));
   if([reason,...counter_evidence].some(c=>c.evidence_ids.some(id=>!ids.has(id))))throw Error('AI_MEMBER_CITATION');
  }
  return {symbol,company:text(r.company,100),horizon,status,reason,counter_evidence,confirmation:text(r.confirmation),invalidation:text(r.invalidation),gaps,sources,classification:'INFERENCE' as const};
 });
 const symbols=new Set(cards.map(c=>c.symbol)),expectedSymbols=tier==='free'?3:72;
 if(cards.length!==expectedSymbols*3||symbols.size!==expectedSymbols
  ||new Set(cards.map(c=>c.symbol+':'+c.horizon)).size!==cards.length
  ||[...symbols].some(symbol=>new Set(cards.filter(c=>c.symbol===symbol).map(c=>c.company)).size!==1))throw Error('AI_MEMBER_UNIVERSE');
 return {schema:'VNEXT_AI_MEMBER_EDITION_V1',tier,business_date,research_only:true,edition,cards};
}
