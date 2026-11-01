/** Offline issuer-IR normalization. Hash/receipt checks bind supplied claims to
 * retained PDF bytes; they do not verify financial table interpretation, grant
 * source rights, admit a batch or publish to members. No HTTP or database port. */
import {compareTime,hashValid,snapshotHash,sourceSafe,validObservationTime} from '../src/features/vnext/contracts.ts';
import {traceIssues,type FunnelInput,type ResearchFact} from '../src/features/vnext/researchFunnel.ts';

export const ISSUER_IR_FINANCIAL_CANDIDATE_VERSION='ISSUER_IR_FINANCIAL_CANDIDATE_V1';
export type IssuerIrDocument={symbol:string;url:string;sha256:string;bytes:number;body:Uint8Array;
 first_seen_at:string;available_at:string;published_at:string|null};
export type IssuerIrEpsBasis='PRESERVE_REPORTED'|'BASIC'|'DILUTED';
export type IssuerIrLocator={page:number;section:string;rows:string[];column:string;document:string|null};
export type IssuerIrFinancialCandidate=ResearchFact&{symbol:string;source_sha256:string;source_bytes:number;
 source_locator:IssuerIrLocator;source_claim_hash:string;normalizer_version:typeof ISSUER_IR_FINANCIAL_CANDIDATE_VERSION;
 candidate_only:true;source_admitted:false;member_publication_approved:false;data_quality_status:string};
type RecordValue=Record<string,unknown>;
function fail(suffix:string):never{throw Error('ISSUER_IR_'+suffix);}
const object=(v:unknown):RecordValue=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('OBJECT');return v as RecordValue;};
const text=(v:unknown,max=500):string=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('TEXT');return v;};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const number=(v:unknown):number=>{if(!finite(v))fail('NUMBER');return v;};
const timestamp=(v:unknown)=>{const s=text(v,40);if(!validObservationTime(s))fail('TIME');return s;};
const sameTime=(a:string,b:string)=>compareTime(a,b)===0;
const before=(a:string,b:string)=>compareTime(a,b)<=0;
const digest=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b))),v=>v.toString(16).padStart(2,'0')).join('');
function periodEnd(period:string,basis:string){
 const q=/^(20\d{2})-Q([1-4])$/.exec(period),c=/^(20\d{2})-(H1|9M|FY)$/.exec(period);
 if(basis==='SINGLE_QUARTER'&&q)return new Date(Date.UTC(Number(q[1]),Number(q[2])*3,0)).toISOString().slice(0,10);
 const month=basis==='SIX_MONTH_CUMULATIVE'&&c?.[2]==='H1'?6:
  basis==='NINE_MONTH_CUMULATIVE'&&c?.[2]==='9M'?9:basis==='FULL_YEAR'&&c?.[2]==='FY'?12:null;
 if(month!==null&&c)return new Date(Date.UTC(Number(c[1]),month,0)).toISOString().slice(0,10);
 fail('PERIOD_BASIS');
}
function locator(value:unknown):IssuerIrLocator{
 const r=object(value),page=r.page??r.pdf_page;
 if(!Number.isSafeInteger(page)||Number(page)<1||Number(page)>5000)fail('LOCATOR');
 const rawRows=r.rows??(r.row===undefined?undefined:[r.row]);
 if(!Array.isArray(rawRows)||!rawRows.length||rawRows.length>20)fail('LOCATOR');
 return {page:Number(page),section:text(r.section??r.table??r.note),rows:rawRows.map(v=>text(v)),
  column:text(r.column),document:r.document===undefined?null:text(r.document)};
}
function primitiveValues(raw:RecordValue,keys:string[]){
 const result:ResearchFact['values']={};
 for(const key of keys)if(raw[key]!==undefined){const v=raw[key];
  if(v!==null&&typeof v!=='string'&&!finite(v))fail('VALUE_TYPE');result[key]=v as number|string|null;
 }
 return result;
}
function normalizeValues(raw:RecordValue,epsBasis:IssuerIrEpsBasis){
 const sourceKind=text(raw.kind,80),v=object(raw.values);
 let kind=sourceKind,basis=text(raw.basis,80),period=text(raw.period,20),values:ResearchFact['values'];
 if(sourceKind==='EPS'){
  if(basis!=='SINGLE_QUARTER')fail('EPS_NOT_SINGLE_QUARTER');
  if(v.unit!==undefined&&v.unit!=='TWD_PER_COMMON_SHARE')fail('EPS_UNIT');
  for(const key of ['value','basic_eps_twd_per_share','diluted_eps_twd_per_share'])if(v[key]!==undefined&&!finite(v[key]))fail('EPS_VALUE');
  if(v.reported_decimal!==undefined&&(typeof v.reported_decimal!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(v.reported_decimal)
   ||finite(v.value)&&Number(v.reported_decimal)!==v.value))fail('EPS_REPORTED_DECIMAL');
  const basic=v.basic_eps_twd_per_share,diluted=v.diluted_eps_twd_per_share;
  const chosen=epsBasis==='BASIC'?basic:epsBasis==='DILUTED'?diluted:undefined;
  const suppliedBasis=v.measurement_basis;
  if(finite(v.value)&&(suppliedBasis==='BASIC'&&finite(basic)&&basic!==v.value
   ||suppliedBasis==='DILUTED'&&finite(diluted)&&diluted!==v.value))fail('EPS_CONFLICTING_VALUES');
  const directChosen=finite(v.value)&&v.unit==='TWD_PER_COMMON_SHARE'
   &&((epsBasis==='BASIC'&&suppliedBasis==='BASIC')||(epsBasis==='DILUTED'&&suppliedBasis==='DILUTED'));
  if(finite(chosen)||directChosen){
   values={value:finite(chosen)?chosen:number(v.value),unit:'TWD_PER_COMMON_SHARE',measurement_basis:epsBasis,
    ...primitiveValues(v,['basic_eps_twd_per_share','diluted_eps_twd_per_share','assurance','consolidation','accounting_standard','subsequent_revision_review'])};
   if(v.reported_decimal!==undefined){
    if(suppliedBasis===epsBasis&&Number(v.reported_decimal)===values.value)values.reported_decimal=String(v.reported_decimal);
    else{values.source_reported_decimal=String(v.reported_decimal);values.source_reported_decimal_basis=typeof suppliedBasis==='string'?suppliedBasis:'NOT_ESTABLISHED';}
   }
  }else{
   // An unknown dilution basis must not satisfy evaluateResearch's EPS count.
   kind='EPS_REPORTED_UNSPECIFIED';
   values={unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTION_BASIS_NOT_SELECTED_OR_UNVERIFIED',
    ...primitiveValues(v,['value','reported_decimal','basic_eps_twd_per_share','diluted_eps_twd_per_share','assurance','consolidation','accounting_standard','subsequent_revision_review'])};
   if(!finite(values.value)&&!finite(values.basic_eps_twd_per_share)&&!finite(values.diluted_eps_twd_per_share))fail('EPS_VALUE');
   if(v.value!==undefined&&v.unit!=='TWD_PER_COMMON_SHARE')fail('EPS_UNIT');
  }
 }else if(sourceKind==='MARGIN'){
  if(basis!=='SINGLE_QUARTER')fail('MARGIN_NOT_SINGLE_QUARTER');
  if(v.measurement_basis==='DIRECTLY_REPORTED_GROSS_MARGIN'){
   if(v.unit!=='PERCENT')fail('MARGIN_UNIT');
   if(v.reported_decimal!==undefined&&(typeof v.reported_decimal!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(v.reported_decimal)
    ||Number(v.reported_decimal)!==number(v.value)))fail('MARGIN_REPORTED_DECIMAL');
   for(const key of ['operating_margin_percent','net_margin_percent'])if(v[key]!==undefined&&(!finite(v[key])||v[key]>100))fail('MARGIN_COMPONENT');
   values={value:number(v.value),unit:'PERCENT',measurement_basis:'DIRECTLY_REPORTED_GROSS_MARGIN',
    ...primitiveValues(v,['reported_decimal','operating_margin_percent','net_margin_percent','assurance','consolidation','accounting_standard','subsequent_revision_review'])};
  }else if(v.measurement_basis==='DERIVED_RATIO_OF_SAME_DIRECT_THREE_MONTH_REPORTED_AMOUNTS'){
   const revenue=number(v.revenue_thousand_twd),profit=number(v.gross_profit_thousand_twd),margin=number(v.gross_margin_percent);
   if(revenue<=0||v.formula!=='gross_profit / operating_revenue * 100'||v.not_source_rounded_percent!==true
    ||Math.abs(profit/revenue*100-margin)>1e-9)fail('MARGIN_FORMULA');
   values={value:margin,unit:'PERCENT',measurement_basis:'DERIVED_RATIO_OF_SAME_DIRECT_THREE_MONTH_REPORTED_AMOUNTS',
    revenue_thousand_twd:revenue,gross_profit_thousand_twd:profit,formula:'gross_profit / operating_revenue * 100',
    precision:'CALCULATED_RATIO_NOT_SOURCE_ROUNDED_PERCENT'};
  }else fail('MARGIN_BASIS');
  if(Number(values.value)>100)fail('MARGIN_RANGE');
 }else if(sourceKind==='PPE_ACQUISITION_AND_CASH_PAID'||sourceKind==='PPE_ACQUISITION'){
  // Preserve the period and PPE definition. Never relabel it CAPEX or derive
  // quarter cash flow by subtracting cumulative or annual disclosures.
  const acquisition=number(v.ppe_acquisitions_thousand_twd);
  if(acquisition<0||v.not_total_capital_expenditure!==true||v.intangibles_excluded!==true
   ||v.no_quarter_differencing_performed!==true)fail('PPE_SCOPE');
  if(v.cash_paid_for_ppe_thousand_twd!==undefined&&(!finite(v.cash_paid_for_ppe_thousand_twd)||v.cash_paid_for_ppe_thousand_twd<0))fail('PPE_VALUE');
  if(v.unit!==undefined&&v.unit!=='THOUSAND_TWD')fail('PPE_UNIT');
  values={ppe_acquisitions_thousand_twd:acquisition,unit:'THOUSAND_TWD',measurement_basis:text(v.measurement_basis),
   capex_comparability:'NOT_ESTABLISHED_PPE_ONLY',intangibles_scope:'EXCLUDED',quarter_differencing:'NOT_PERFORMED',
   ...primitiveValues(v,['cash_paid_for_ppe_thousand_twd','original_period_label'])};
 }else fail('UNSUPPORTED_KIND');
 periodEnd(period,basis);return {kind,basis,period,values};
}

/** Explicitly reshape a retained PPE observation whose source period label is
 * a document label (for example Q4 annual report), not its reporting scope. */
export function issuerIrPpeObservationCandidate(value:unknown):RecordValue{
 const r=object(value),label=text(r.period_label,20),match=/^(20\d{2})-Q([1-4])$/.exec(label);
 if(!match||r.derived_by_differencing!==false||r.promoted_as_capex_fact!==false
  ||r.excludes_intangible_acquisition!==true||r.not_total_investing_cashflow!==true)fail('PPE_OBSERVATION');
 const basis=r.reporting_scope==='FULL_YEAR'&&match[2]==='4'?'FULL_YEAR':
  r.reporting_scope==='SIX_MONTHS_YTD'&&match[2]==='2'?'SIX_MONTH_CUMULATIVE':
  r.reporting_scope==='THREE_MONTHS_SINGLE_QUARTER'?'SINGLE_QUARTER':null;
 if(!basis)fail('PPE_OBSERVATION_SCOPE');
 const amount=number(r.reported_thousand_twd);
 if(amount<0||number(r.outflow_positive_magnitude_twd)!==amount*1000)fail('PPE_OBSERVATION_UNIT');
 const period=basis==='FULL_YEAR'?match[1]+'-FY':basis==='SIX_MONTH_CUMULATIVE'?match[1]+'-H1':label;
 return {symbol:r.symbol,kind:'PPE_ACQUISITION',period,basis,values:{ppe_acquisitions_thousand_twd:amount,
  measurement_basis:'DIRECTLY_REPORTED_PPE_ACQUISITION',not_total_capital_expenditure:true,intangibles_excluded:true,
  no_quarter_differencing_performed:true,original_period_label:label},source:r.source,source_sha256:r.source_sha256,
  published_at:r.published_at,first_seen_at:r.first_seen_at,available_at:r.available_at,
  source_locator:{document:r.source_pdf,page:r.page,section:'CONSOLIDATED STATEMENTS OF CASH FLOWS',row:r.reported_row,
   column:text(r.reporting_scope)},source_admitted:false,member_publication_approved:false};
}

export async function normalizeIssuerIrFinancialCandidates(input:{symbol:string;allowedOrigins:string[];cutoff:string;
 documents:IssuerIrDocument[];candidates:unknown[];epsBasis?:IssuerIrEpsBasis}){
 const owned=structuredClone(input),symbol=text(owned.symbol,6),cutoff=timestamp(owned.cutoff),epsBasis=owned.epsBasis??'PRESERVE_REPORTED';
 if(!/^\d{4,6}$/.test(symbol)||!['PRESERVE_REPORTED','BASIC','DILUTED'].includes(epsBasis)
  ||!Array.isArray(owned.documents)||!owned.documents.length||owned.documents.length>64
  ||!Array.isArray(owned.candidates)||!owned.candidates.length||owned.candidates.length>128
  ||!Array.isArray(owned.allowedOrigins)||!owned.allowedOrigins.length||owned.allowedOrigins.length>10)fail('SCOPE');
 const origins=new Set(owned.allowedOrigins.map(origin=>{
  if(!sourceSafe(origin)||new URL(origin).origin!==origin)fail('ORIGIN');return origin;
 }));
 const documents=new Map<string,IssuerIrDocument>();let total=0;
 for(const d of owned.documents){
  if(!d||typeof d!=='object')fail('DOCUMENT');
  if(d.symbol!==symbol||!sourceSafe(d.url)||!origins.has(new URL(d.url).origin)||!new URL(d.url).pathname.toLowerCase().endsWith('.pdf')
   ||!hashValid(d.sha256)||!(d.body instanceof Uint8Array)||!Number.isSafeInteger(d.bytes)||d.bytes<5||d.bytes>20000000
   ||d.body.byteLength!==d.bytes||new TextDecoder().decode(d.body.slice(0,5))!=='%PDF-'||await digest(d.body)!==d.sha256
   ||documents.has(d.url))fail('DOCUMENT');
  total+=d.bytes;if(total>64000000)fail('DOCUMENT_LIMIT');
  const first=timestamp(d.first_seen_at),available=timestamp(d.available_at);
  if(!before(first,available)||!before(available,cutoff)||d.published_at!==null&&!before(timestamp(d.published_at),available))fail('DOCUMENT_TIME');
  documents.set(d.url,d);
 }
 const facts:IssuerIrFinancialCandidate[]=[];
 for(const value of owned.candidates){
  const r=object(value),d=documents.get(String(r.source));
  if(!d||r.symbol!==symbol||r.source_sha256!==d.sha256||r.source_bytes!==undefined&&r.source_bytes!==d.bytes
   ||r.source_admitted!==false||r.member_publication_approved!==false)fail('CLAIM_DOCUMENT_BINDING');
  if(r.published_at!==undefined&&r.source_published_at!==undefined&&r.published_at!==r.source_published_at)fail('CLAIM_PUBLICATION_CONFLICT');
  if(!sameTime(timestamp(r.first_seen_at),d.first_seen_at)||!sameTime(timestamp(r.available_at),d.available_at)
   ||(r.published_at??r.source_published_at??null)!==d.published_at)fail('CLAIM_RECEIPT_BINDING');
  if(r.evidence_hash!==undefined&&r.fact_hash!==undefined)fail('CLAIM_HASH_AMBIGUOUS');
  if(r.evidence_hash!==undefined){const {id,evidence_hash,...body}=r;void id;
   if(!hashValid(String(evidence_hash))||await snapshotHash(body)!==evidence_hash)fail('CLAIM_HASH');}
  if(r.fact_hash!==undefined){const {fact_hash,...body}=r;
   if(!hashValid(String(fact_hash))||await snapshotHash(body)!==fact_hash)fail('CLAIM_HASH');}
  const normalized=normalizeValues(r,epsBasis),end=periodEnd(normalized.period,normalized.basis)+'T23:59:59+08:00';
  const asOf=r.as_of===undefined?end:timestamp(r.as_of);
  if(!sameTime(asOf,end)||!before(asOf,d.available_at))fail('CLAIM_PERIOD_TIME');
  const source_claim_hash=await snapshotHash(r),source_locator=locator(r.source_locator??r.locator);
  const body:Omit<IssuerIrFinancialCandidate,'id'|'evidence_hash'>={symbol,...normalized,source:d.url,published_at:d.published_at,first_seen_at:d.first_seen_at,available_at:d.available_at,
   as_of:asOf,source_sha256:d.sha256,source_bytes:d.bytes,source_locator,source_claim_hash,
   normalizer_version:ISSUER_IR_FINANCIAL_CANDIDATE_VERSION,candidate_only:true as const,source_admitted:false as const,
   member_publication_approved:false as const,data_quality_status:'PRIVATE_CANDIDATE_SOURCE_CONTENT_EPS_COMPARABILITY_AND_USE_REVIEW_REQUIRED'};
  const basisTag=normalized.kind==='EPS'?epsBasis:normalized.kind==='EPS_REPORTED_UNSPECIFIED'?'UNSPECIFIED':'NA';
  facts.push({...body,id:`issuer-ir:${symbol}:${normalized.period}:${normalized.kind}:${d.sha256}:${source_claim_hash.slice(0,16)}:${basisTag}`,
   evidence_hash:await snapshotHash(body)});
 }
 if(new Set(facts.map(f=>f.kind+':'+f.period)).size!==facts.length)fail('DUPLICATE_PERIOD');
 const kinds=['EPS','EPS_REPORTED_UNSPECIFIED','MARGIN','CAPEX','PPE_ACQUISITION','PPE_ACQUISITION_AND_CASH_PAID'];
 return {schema:ISSUER_IR_FINANCIAL_CANDIDATE_VERSION,symbol,cutoff,eps_basis_selection:epsBasis,facts,
  coverage:Object.fromEntries(kinds.map(kind=>[kind,facts.filter(f=>f.kind===kind).map(f=>f.period)])),
  gaps:[...new Set(['SOURCE_NUMERIC_COLUMN_AND_USAGE_REVIEW_REQUIRED','DEMAND_MOAT_VALUATION_REQUIRE_SEPARATE_REVIEW',
   ...(!facts.some(f=>f.kind==='CAPEX')?['CAPEX_NOT_ESTABLISHED_BY_PPE_DISCLOSURES']:[]),
   ...(facts.some(f=>f.kind==='EPS_REPORTED_UNSPECIFIED')?['EPS_DILUTION_BASIS_NOT_ESTABLISHED']:[]),
   ...(facts.some(f=>f.published_at===null)?['ORIGINAL_PUBLICATION_TIME_UNKNOWN_RECEIPT_REVIEW_ONLY']:[])])],
  candidate_only:true as const,source_admitted:false as const,member_publication_approved:false as const,
  model_calls:0 as const,production_writes:0 as const};
}

/** Explicit offline merge. Unadmitted source flags survive into the review
 * input; this cannot install a SOURCE adapter or amend a sealed batch. */
export async function withIssuerIrFinancialCandidatesForReview(input:FunnelInput,facts:IssuerIrFinancialCandidate[],mode:'OFFLINE_PRIVATE_REVIEW_ONLY'){
 // Capture the entire input before the first await; a concurrent caller cannot
 // move its cutoff or replace existing EPS while a digest is being checked.
 const ownedInput=structuredClone(input),owned=structuredClone(facts),keys=new Set<string>();
 if(mode!=='OFFLINE_PRIVATE_REVIEW_ONLY'||!validObservationTime(ownedInput.cutoff)||owned.length>128)fail('REVIEW_SCOPE');
 for(const f of owned){
  const {id,evidence_hash,...body}=f,key=f.kind+':'+f.period;
  const basisTag=f.kind==='EPS'?String(f.values.measurement_basis):f.kind==='EPS_REPORTED_UNSPECIFIED'?'UNSPECIFIED':'NA';
  if(f.symbol!==ownedInput.symbol||f.candidate_only!==true||f.source_admitted!==false||f.member_publication_approved!==false
   ||f.normalizer_version!==ISSUER_IR_FINANCIAL_CANDIDATE_VERSION||!hashValid(f.source_sha256)||!hashValid(f.source_claim_hash)
   ||!['EPS','EPS_REPORTED_UNSPECIFIED','MARGIN','PPE_ACQUISITION','PPE_ACQUISITION_AND_CASH_PAID'].includes(f.kind)
   ||f.kind==='EPS'&&!['BASIC','DILUTED'].includes(String(f.values.measurement_basis))||traceIssues(f,ownedInput.cutoff).length
   ||keys.has(key)||ownedInput.facts.some(old=>old.id===id||old.kind+':'+old.period===key)
   ||id!==`issuer-ir:${f.symbol}:${f.period}:${f.kind}:${f.source_sha256}:${f.source_claim_hash.slice(0,16)}:${basisTag}`
   ||evidence_hash!==await snapshotHash(body))fail('REVIEW_MERGE');
  keys.add(key);
 }
 const eps=[...ownedInput.facts,...owned].filter(f=>f.kind==='EPS');
 if(eps.some(f=>f.values.unit!=='TWD_PER_COMMON_SHARE'||!['BASIC','DILUTED'].includes(String(f.values.measurement_basis)))
  ||new Set(eps.map(f=>f.values.measurement_basis)).size>1)fail('EPS_SERIES_BASIS');
 return {...ownedInput,facts:[...ownedInput.facts,...owned]};
}
