/** Internal retained-fact intake for the existing private research runner.
 * Integrity does not grant source rights, company review or publication. */
import {snapshotHash,hashValid,validObservationTime,compareTime,sourceSafe} from './contracts.ts';
import {traceIssues,type ResearchFact} from './researchFunnel.ts';
import type {AcquiredResearch} from './dailyIntelligence.ts';

type IssuerFact=ResearchFact&{symbol:string;source_admitted:false;member_publication_approved:false;
 source_sha256:string;source_bytes:number;source_locator:Record<string,unknown>};
export type IssuerFinancialPacket={schema:'PRIVATE_RETAINED_ISSUER_FINANCIALS_V1';created_at:string;source_study_sha256:string;
 source_admitted:false;member_publication_approved:false;methodology_promoted:false;facts:IssuerFact[];
 known_release_deadlines:Record<string,string>;release_deadline_sources:Record<string,string>;max_age_days:7};
const refuse=(ok:unknown,code:string)=>{if(!ok)throw Error('ISSUER_FINANCIAL_'+code);};
const quarterEnd=(period:string|null)=>{const m=/^(20\d\d)-Q([1-4])$/.exec(period??'');return m?new Date(Date.UTC(Number(m[1]),Number(m[2])*3,0)).toISOString().slice(0,10):null;};

export async function mergeIssuerFinancials(acquired:AcquiredResearch,packet:IssuerFinancialPacket,expectedHash:string):Promise<AcquiredResearch>{
 // Own both preimages before digest awaits; never revise a saved checkpoint.
 const input=structuredClone(acquired),p=structuredClone(packet),{snapshot_hash,...body}=input;
 refuse(hashValid(snapshot_hash)&&snapshot_hash===await snapshotHash(body),'ACQUIRED_HASH');
 refuse(hashValid(expectedHash)&&expectedHash===await snapshotHash(p),'PACKET_HASH');
 refuse(p.schema==='PRIVATE_RETAINED_ISSUER_FINANCIALS_V1'&&p.source_admitted===false&&p.member_publication_approved===false
  &&p.methodology_promoted===false&&p.max_age_days===7&&validObservationTime(p.created_at)&&hashValid(p.source_study_sha256)
  &&Array.isArray(p.facts)&&p.facts.length>0&&p.facts.length<=864,'PACKET_SCOPE');
 refuse(validObservationTime(input.evidence_cutoff)&&input.inputs.length===72&&new Set(input.inputs.map(i=>i.symbol)).size===72
  &&input.inputs.every(i=>i.cutoff===input.evidence_cutoff),'INPUT_SCOPE');
 const ids=new Set<string>(),keys=new Set<string>(),bases=new Map<string,Set<string>>();
 const universe=new Set(input.inputs.map(i=>i.symbol));
 for(const f of p.facts){
  const {id,evidence_hash,...factBody}=f,periodEnd=quarterEnd(f.period),key=`${f.symbol}:${f.kind}:${f.period}`,value=f.values.value;
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('ISSUER_FINANCIAL_FACT_SCOPE');
  refuse(!ids.has(id)&&!keys.has(key)&&universe.has(f.symbol),'DUPLICATE_OR_UNKNOWN');ids.add(id);keys.add(key);
  refuse(['EPS','MARGIN','CAPEX'].includes(f.kind)&&f.basis==='SINGLE_QUARTER'&&periodEnd!==null
   &&f.as_of?.slice(0,10)===periodEnd&&f.source_admitted===false&&f.member_publication_approved===false
   // This is a reference to a locally inspected issuer original, not an HTTP
   // response body. The runner's existing 8 MB download limit is unchanged.
   &&hashValid(f.source_sha256)&&Number.isSafeInteger(f.source_bytes)&&f.source_bytes>0&&f.source_bytes<=32*1024*1024
   &&f.source_locator!==null&&typeof f.source_locator==='object'&&Number.isSafeInteger(f.source_locator.page)&&Number(f.source_locator.page)>0
   &&traceIssues(f,p.created_at).length===0,'FACT_SCOPE');
  refuse(evidence_hash===await snapshotHash(factBody),'FACT_HASH');
  if(f.kind==='EPS'){
   refuse(f.values.unit==='TWD_PER_COMMON_SHARE'&&['BASIC','DILUTED'].includes(String(f.values.measurement_basis)),'EPS_UNIT');
   const bs=bases.get(f.symbol)??new Set<string>();bs.add(String(f.values.measurement_basis));bases.set(f.symbol,bs);refuse(bs.size===1,'EPS_BASIS');
  }else if(f.kind==='MARGIN')refuse(f.values.unit==='PERCENT'&&value>=0&&value<=100,'MARGIN_UNIT');
  else refuse(['TWD','TWD_MILLION'].includes(String(f.values.unit))&&value>=0
   &&['EXPENDITURE_MAGNITUDE_NOT_CASH_INFLOW','ISSUER_REPORTED_CASH_OUTFLOW_MAGNITUDE'].includes(String(f.values.measurement_basis)),'CAPEX_UNIT');
 }
 refuse(p.known_release_deadlines&&p.release_deadline_sources
  &&Object.keys(p.known_release_deadlines).sort().join('|')===Object.keys(p.release_deadline_sources).sort().join('|'),'RELEASE_SCOPE');
 for(const [symbol,at] of Object.entries(p.known_release_deadlines))refuse(universe.has(symbol)&&validObservationTime(at)&&sourceSafe(p.release_deadline_sources[symbol]),'RELEASE_SCOPE');
 const issues=[...(input.source_issues??[])];
 const addIssue=(key:string,reason:string)=>{if(!issues.some(i=>i.kind==='ISSUER_FINANCIALS'&&i.key===key&&i.reason===reason))issues.push({kind:'ISSUER_FINANCIALS',key,reason});};
 const age=Date.parse(input.evidence_cutoff)-Date.parse(p.created_at);
 if(age<0||age>=p.max_age_days*86400000){
  addIssue(expectedHash,age<0?'RETAINED_PACKET_NOT_YET_AVAILABLE':'RETAINED_PACKET_REVIEW_EXPIRED');
 }else{
  for(const i of input.inputs){
   const facts=p.facts.filter(f=>f.symbol===i.symbol);if(!facts.length)continue;
   const release=p.known_release_deadlines[i.symbol];
   if(release&&compareTime(input.evidence_cutoff,release)>=0){addIssue(i.symbol,'NEW_ISSUER_RELEASE_REQUIRES_REVIEW');continue;}
   // A newer reported quarter cannot be concealed by the retained series.
   const latest=facts.filter(f=>f.kind==='EPS').map(f=>f.period!).sort().at(-1);
   if(i.facts.some(f=>['EPS','FINANCIAL_YTD'].includes(f.kind)&&quarterEnd(f.period)&&latest&&f.period!>latest)){
    addIssue(i.symbol,'NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW');continue;
   }
   for(const fact of facts){
    refuse(traceIssues(fact,input.evidence_cutoff).length===0,'FUTURE_FACT');
    const existing=i.facts.filter(f=>f.kind===fact.kind&&f.period===fact.period);
    refuse(existing.length<=1,'EXISTING_CONFLICT');
    if(existing.length){refuse(await snapshotHash(existing[0])===await snapshotHash(fact),'EXISTING_CONFLICT');continue;}
    refuse(!i.facts.some(f=>f.id===fact.id),'EXISTING_ID_CONFLICT');
    if(fact.kind==='EPS')refuse(!i.facts.some(f=>f.kind==='EPS'&&f.basis==='SINGLE_QUARTER'
     &&(f.values.unit!==fact.values.unit||f.values.measurement_basis!==fact.values.measurement_basis)),'EPS_BASIS');
    i.facts.push(fact);
   }
   addIssue(i.symbol,'ISSUER_FACTS_PRIVATE_USAGE_AND_PUBLICATION_UNVERIFIED');
  }
 }
 const next={...body,inputs:input.inputs,...(issues.length?{source_issues:issues}:{})};
 return {...next,snapshot_hash:await snapshotHash(next)};
}
