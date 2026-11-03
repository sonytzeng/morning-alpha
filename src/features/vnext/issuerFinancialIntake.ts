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

// Four independently re-extracted issuer sentences report actual quarterly USD
// spending. Pin their original facts; this is not a generic FX/CAPEX adapter.
const umcCapexHashes:Readonly<Record<string,string>>=Object.freeze({
 '2025-Q4':'08a6d6691251cd89053419d06d00ec8e37e422afbd9dda99c8695bb1980e4ce1',
 '2026-Q1':'5118ed42b0eed386fd3c3c89cda06ff8160c0c633c1fe8272f9618a73f5b1d29',
 '2026-Q2':'d130b7e5108148a574bc0522f4bd7de350a724b8f59ec596e654cfd83cfacc0e',
 '2026-Q3':'15cf646dc2da5fadd53931d3e6b9acc3adae9d16a2ae29c33a03d0f598dbb842',
});
function verifiedUmcUsdCapex(f:IssuerFact):boolean{
 return f.symbol==='2303'&&f.kind==='CAPEX'&&f.period!==null&&f.evidence_hash===umcCapexHashes[f.period]
  &&f.values.unit==='USD_MILLION'&&f.values.currency==='USD'&&f.values.scale===1000000
  &&f.values.conversion_to_twd==='NOT_PERFORMED'
  &&f.values.measurement_basis==='DIRECTLY_REPORTED_CAPEX_SPENDING_USD'
  &&f.values.scope==='ACTUAL_QUARTER_SPENDING_NOT_ANNUAL_BUDGET_OR_PPE';
}

/** A portal JSON point has an axis locator, never an invented PDF page. The
 * pinned packet still binds the inspected original and its source study. */
function validOriginalLocator(f:IssuerFact,reviewedAt:string):boolean{
 const locator=f.source_locator;
 if(!locator||typeof locator!=='object'||Array.isArray(locator))return false;
 if(f.source!=='https://mopsfin.twse.com.tw/compare/data'&&Number.isSafeInteger(locator.page)&&Number(locator.page)>0)return true;
 const p=f as IssuerFact&Partial<{normalizer_version:string;original_kind:string;source_received_at:string;
  source_candidate_id:string;source_candidate_evidence_hash:string;source_candidate_file_sha256:string;
  source_candidate_available_at:string;source_candidate_derived_at:string;derived_at:string;as_of_basis:string;
  direct_single_quarter:boolean;ttm_established:boolean;interpretation_only:boolean;
  source_terms_evidence:{url:string;sha256:string;bytes:number;received_at:string;consolidation_key_home_sha256:string}}>;
 const point=locator.point,terms=p.source_terms_evidence,derivedAt=p.derived_at;
 return f.kind==='MARGIN'&&f.source==='https://mopsfin.twse.com.tw/compare/data'&&!Object.hasOwn(locator,'page')
  &&p.normalizer_version==='PORTAL_MARGIN_VERIFIED_REPLAY_V1'&&p.original_kind==='MARGIN'
  &&p.as_of_basis==='FINANCIAL_PERIOD_END_NOT_PUBLICATION'&&p.direct_single_quarter===false
  &&p.ttm_established===false&&p.interpretation_only===true&&f.published_at===null
  &&f.first_seen_at===p.source_received_at&&f.available_at===p.derived_at
  &&p.source_candidate_id===`official-portal-calculated-margin:${f.symbol}:${f.period}:${f.source_sha256}`
  &&f.id===`portal-margin-verified:${f.symbol}:${f.period}:${f.source_sha256}`
  &&hashValid(p.source_candidate_evidence_hash??'')&&hashValid(p.source_candidate_file_sha256??'')
  &&typeof derivedAt==='string'&&validObservationTime(derivedAt)
  &&[p.source_received_at,p.source_candidate_available_at,p.source_candidate_derived_at,derivedAt].every(at=>
   typeof at==='string'&&validObservationTime(at)&&compareTime(at,reviewedAt)<=0&&compareTime(at,derivedAt)<=0)
  &&f.values.measurement_basis==='OFFICIAL_PORTAL_CALCULATED_GROSS_MARGIN'
  &&f.values.consolidation_as_reported==='C'&&f.values.consolidation==='CONSOLIDATED'
  &&f.values.formula==='single_quarter_gross_profit / single_quarter_revenue * 100'
  &&f.values.source_rounding==='SOURCE_PORTAL_TWO_DECIMAL_MAX; UNDERLYING_AMOUNTS_NOT_IN_THIS_RESPONSE'
  &&f.values.single_quarter_amount_basis===(f.period?.endsWith('Q4')
   ?'OFFICIAL_PORTAL_FY_CUMULATIVE_MINUS_Q3_CUMULATIVE':'ISSUER_REPORTED_SINGLE_QUARTER_AMOUNTS_PER_SOURCE_TERMS')
  &&locator.request_metric==='GrossMargin'&&typeof locator.series_company_label==='string'&&locator.series_company_label.length>0
  &&Number.isSafeInteger(locator.axis_index)&&Number(locator.axis_index)>=0
  &&locator.period_label===f.period?.replace('-','')&&Array.isArray(point)&&point.length===3
  &&point[0]===locator.axis_index&&point[1]===f.values.value&&point[2]==='C'
  &&!!terms&&terms.url==='https://mopsfin.twse.com.tw/terms'&&hashValid(terms.sha256)
  &&Number.isSafeInteger(terms.bytes)&&terms.bytes>0&&hashValid(terms.consolidation_key_home_sha256)
  &&validObservationTime(terms.received_at)&&compareTime(terms.received_at,derivedAt)<=0;
}

export type IssuerFinancialBinding={packet:IssuerFinancialPacket;expectedHash:string};
export async function mergeIssuerFinancialBatch(acquired:AcquiredResearch,bindings:readonly IssuerFinancialBinding[]):Promise<AcquiredResearch>{
 // Own every preimage before the first digest await. Packets retain independent
 // hashes, release deadlines and expiries; only the large acquired copy/hash
 // is shared within this one call, never across invocations or checkpoints.
 const input=structuredClone(acquired),releases=structuredClone(bindings),{snapshot_hash,...body}=input;
 refuse(hashValid(snapshot_hash)&&snapshot_hash===await snapshotHash(body),'ACQUIRED_HASH');
 refuse(Array.isArray(releases),'RELEASE_BINDINGS_SCOPE');
 for(const release of releases)await mergeOwnedIssuerFinancials(input,release.packet,release.expectedHash);
 const {snapshot_hash:priorHash,...next}=input;void priorHash;
 return {...next,snapshot_hash:await snapshotHash(next)};
}
export async function mergeIssuerFinancials(acquired:AcquiredResearch,packet:IssuerFinancialPacket,expectedHash:string):Promise<AcquiredResearch>{
 return mergeIssuerFinancialBatch(acquired,[{packet,expectedHash}]);
}
/** Input and packet are private copies owned by mergeIssuerFinancialBatch. */
async function mergeOwnedIssuerFinancials(input:AcquiredResearch,p:IssuerFinancialPacket,expectedHash:string):Promise<void>{
 refuse(hashValid(expectedHash)&&expectedHash===await snapshotHash(p),'PACKET_HASH');
 refuse(p.schema==='PRIVATE_RETAINED_ISSUER_FINANCIALS_V1'&&p.source_admitted===false&&p.member_publication_approved===false
  &&p.methodology_promoted===false&&p.max_age_days===7&&validObservationTime(p.created_at)&&hashValid(p.source_study_sha256)
  &&Array.isArray(p.facts)&&p.facts.length>0&&p.facts.length<=864,'PACKET_SCOPE');
 refuse(validObservationTime(input.evidence_cutoff)&&input.inputs.length===72&&new Set(input.inputs.map(i=>i.symbol)).size===72
  &&input.inputs.every(i=>i.cutoff===input.evidence_cutoff&&(i.omitted_fact_ids===undefined
   ||Array.isArray(i.omitted_fact_ids)&&i.omitted_fact_ids.every(id=>typeof id==='string'&&id.length>0)
    &&new Set(i.omitted_fact_ids).size===i.omitted_fact_ids.length)),'INPUT_SCOPE');
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
   &&validOriginalLocator(f,p.created_at)
   &&traceIssues(f,p.created_at).length===0,'FACT_SCOPE');
  refuse(evidence_hash===await snapshotHash(factBody),'FACT_HASH');
  if(f.kind==='EPS'){
   refuse(f.values.unit==='TWD_PER_COMMON_SHARE'&&['BASIC','DILUTED'].includes(String(f.values.measurement_basis)),'EPS_UNIT');
   const bs=bases.get(f.symbol)??new Set<string>();bs.add(String(f.values.measurement_basis));bases.set(f.symbol,bs);refuse(bs.size===1,'EPS_BASIS');
  }else if(f.kind==='MARGIN')refuse(f.values.unit==='PERCENT'&&value<=100,'MARGIN_UNIT');
  else refuse(value>=0&&(verifiedUmcUsdCapex(f)||['TWD','TWD_MILLION'].includes(String(f.values.unit))
   &&['EXPENDITURE_MAGNITUDE_NOT_CASH_INFLOW','ISSUER_REPORTED_CASH_OUTFLOW_MAGNITUDE'].includes(String(f.values.measurement_basis))),'CAPEX_UNIT');
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
   const latest=facts.filter(f=>f.kind==='EPS'||f.kind==='CAPEX').map(f=>f.period!).sort().at(-1);
   if(i.facts.some(f=>['EPS','FINANCIAL_YTD'].includes(f.kind)&&quarterEnd(f.period)&&latest&&f.period!>latest)){
    addIssue(i.symbol,'NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW');continue;
   }
   for(const fact of facts){
    refuse(traceIssues(fact,input.evidence_cutoff).length===0,'FUTURE_FACT');
    const existing=i.facts.filter(f=>f.kind===fact.kind&&f.period===fact.period);
    refuse(existing.length<=1,'EXISTING_CONFLICT');
    // Source-native USD remains USD. Check repeated intake as well: an exact
    // quarter cannot hide a conflicting currency elsewhere in the series.
    if(fact.kind==='CAPEX')refuse(!i.facts.some(f=>f.kind==='CAPEX'&&f.basis==='SINGLE_QUARTER'
     &&['unit','currency','scale'].some(key=>f.values[key]!==fact.values[key])),'CAPEX_BASIS');
    if(existing.length){refuse(await snapshotHash(existing[0])===await snapshotHash(fact),'EXISTING_CONFLICT');continue;}
    refuse(!i.facts.some(f=>f.id===fact.id)&&!i.omitted_fact_ids?.includes(fact.id),'EXISTING_ID_CONFLICT');
    if(fact.kind==='EPS')refuse(!i.facts.some(f=>f.kind==='EPS'&&f.basis==='SINGLE_QUARTER'
     &&(f.values.unit!==fact.values.unit||f.values.measurement_basis!==fact.values.measurement_basis)),'EPS_BASIS');
    i.facts.push(fact);
   }
   addIssue(i.symbol,'ISSUER_FACTS_PRIVATE_USAGE_AND_PUBLICATION_UNVERIFIED');
  }
 }
 if(issues.length)input.source_issues=issues;
}
