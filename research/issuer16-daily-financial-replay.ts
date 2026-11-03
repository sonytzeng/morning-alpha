/** Native SEC HTML / issuer-download PDF facts, strictly inside the existing
 * complete 26-fact quarantine context. No old gate or normal-model exception. */
import {compareTime,hashValid,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {DailyAiFinancialRefreshProof,refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';
import {ISSUER16_SOURCE_SEAL,ISSUER16_FACTS_SHA256,ISSUER16_REGISTRY_CUTOFF,ISSUER16_FACT_IDS,
 REQUIRED_ISSUER14_SORTED_SHA256,REQUIRED_UMC12_SORTED_SHA256} from './issuer16-registry.constants.ts';
export {ISSUER16_SOURCE_SEAL,ISSUER16_FACTS_SHA256};
type Refresh=typeof refreshDailyAiFinancials;
type LoadRegistry=(args:{p_source_seal:string;p_cutoff:string},signal:AbortSignal)=>Promise<unknown>;
export type Issuer16Fact=ResearchFact&{symbol:'3006'|'3711';kind:'EPS'|'MARGIN';basis:'SINGLE_QUARTER';
 normalizer_version:'ISSUER16_NATIVE_FINANCIALS_V1';source_candidate_id:string;source_candidate_evidence_hash:string;
 source_candidate_file_sha256:string;source_sha256:string;source_bytes:number;source_received_at:string;
 as_of_basis:'FINANCIAL_PERIOD_END_NOT_PUBLICATION';derived_at?:string;source_admitted:false;member_publication_approved:false};
type ReplayProof={schema:'DAILY_AI_ISSUER16_IR_REPLAY_V1';source_seal_sha256:string;facts_sha256:string;
 fact_ids:string[];source_refetched:false;source_admitted:false;member_publication_approved:false};
const fixedIds=new Set<string>(ISSUER16_FACT_IDS),symbols=['3006','3711'];
const CALCULATED='CALCULATED_GROSS_MARGIN_FROM_SAME_QUARTER_REPORTED_AMOUNTS';
const QGAP='QUARANTINED_ISSUER_RESEARCH_NOT_LICENSED_FOR_MODEL_OR_MEMBER_USE';
const fail=():never=>{throw Error('ISSUER16_REPLAY_INVALID');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>;};
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('ISSUER16_REPLAY_ABORTED');};
const ordered=(facts:ResearchFact[])=>facts.slice().sort((a,b)=>a.id.localeCompare(b.id));
const own=(f:ResearchFact)=>fixedIds.has(f.id);
const quarterEnd=(period:string|null)=>({
 '2025-Q4':'2025-12-31T23:59:59+08:00','2026-Q1':'2026-03-31T23:59:59+08:00',
 '2026-Q2':'2026-06-30T23:59:59+08:00','2026-Q3':'2026-09-30T23:59:59+08:00',
} as Record<string,string>)[period??''];

/** The new 16 are deliberately not an independent non-quarantined route. */
export async function requireIssuer16QuarantineContext(inputs:FunnelInput[]):Promise<void>{
 inputs=structuredClone(inputs);
 if(!Array.isArray(inputs)||inputs.length!==72||new Set(inputs.map(i=>i.symbol)).size!==72
  ||inputs.some(i=>!Array.isArray(i.facts)))fail();
 for(const [prefix,count,hash]of[['issuer-ir-direct:',14,REQUIRED_ISSUER14_SORTED_SHA256],['umc-ir-direct:',12,REQUIRED_UMC12_SORTED_SHA256]] as const){
  const found=inputs.flatMap(i=>i.facts.filter(f=>f.id.startsWith(prefix)).map(f=>({symbol:i.symbol,fact:f})));
  if(found.length!==count||found.some(x=>x.symbol!==(x.fact as {symbol?:string}).symbol)
   ||await snapshotHash(ordered(found.map(x=>x.fact)))!==hash)fail();
 }
}

export async function parseIssuer16DailyRegistry(raw:unknown,cutoff:string):Promise<Issuer16Fact[]>{
 let captured:unknown;try{captured=structuredClone(raw);}catch{fail();}
 const r=object(captured);
 if(r.schema!=='DAILY_AI_ISSUER16_REGISTRY_V1'||r.source_seal_sha256!==ISSUER16_SOURCE_SEAL
  ||r.facts_sha256!==ISSUER16_FACTS_SHA256||r.registry_cutoff!==ISSUER16_REGISTRY_CUTOFF
  ||r.source_admitted!==false||r.member_publication_approved!==false||!validObservationTime(cutoff)
  ||compareTime(cutoff,ISSUER16_REGISTRY_CUTOFF)<0||!Array.isArray(r.facts)||r.facts.length!==16
  ||await snapshotHash(r.facts)!==ISSUER16_FACTS_SHA256)fail();
 const facts=r.facts as Issuer16Fact[];
 for(const f of facts){
  const {id,evidence_hash,...body}=f;
  if(!fixedIds.has(id)||!symbols.includes(f.symbol)||!['EPS','MARGIN'].includes(f.kind)||!quarterEnd(f.period)
   ||f.basis!=='SINGLE_QUARTER'||f.as_of!==quarterEnd(f.period)||f.as_of_basis!=='FINANCIAL_PERIOD_END_NOT_PUBLICATION'
   ||f.normalizer_version!=='ISSUER16_NATIVE_FINANCIALS_V1'||f.source_admitted!==false||f.member_publication_approved!==false
   ||f.published_at!==null||!hashValid(f.source_sha256)||!hashValid(f.source_candidate_evidence_hash)
   ||!hashValid(f.source_candidate_file_sha256)||typeof f.source_candidate_id!=='string'||!f.source_candidate_id
   ||!Number.isSafeInteger(f.source_bytes)||f.source_bytes<5
   ||[f.available_at,f.first_seen_at,f.as_of,f.source_received_at].some(t=>typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0)
   ||typeof f.available_at!=='string'||typeof f.first_seen_at!=='string'||typeof f.as_of!=='string'
   ||compareTime(f.first_seen_at,f.available_at)>0||compareTime(f.as_of,f.available_at)>0
   ||typeof f.values.value!=='number'||!Number.isFinite(f.values.value)||evidence_hash!==await snapshotHash(body))fail();
  if(f.kind==='EPS'){
   if(f.values.measurement_basis!=='BASIC'||f.values.unit!=='TWD_PER_COMMON_SHARE'||f.values.consolidation!=='CONSOLIDATED')fail();
  }else if(f.symbol==='3006'&&f.period==='2025-Q4'){
   if(f.values.measurement_basis!=='DIRECTLY_REPORTED_GROSS_MARGIN'||f.values.unit!=='PERCENT')fail();
  }else{
   const revenue=f.values.revenue_thousand_twd,gross=f.values.gross_profit_thousand_twd;
   if(f.values.measurement_basis!==CALCULATED||f.values.unit!=='PERCENT'||!Number.isSafeInteger(revenue)||!Number.isSafeInteger(gross)
    ||Number(revenue)<=0||Math.abs(Number(gross)/Number(revenue)*100-Number(f.values.value))>1e-12
    ||f.derived_at!==ISSUER16_REGISTRY_CUTOFF||f.available_at!==f.derived_at
    ||f.values.precision!=='CALCULATED_RATIO_NOT_SOURCE_ROUNDED_PERCENT')fail();
  }
 }
 if(new Set(facts.map(f=>f.id)).size!==16||new Set(facts.map(f=>f.symbol+':'+f.kind+':'+f.period)).size!==16)fail();
 return structuredClone(facts);
}

export async function mergeIssuer16DailyFacts(input:FunnelInput,registry:Issuer16Fact[]):Promise<FunnelInput>{
 const owned=structuredClone(input),facts=structuredClone(registry).filter(f=>f.symbol===owned.symbol);
 const registered=new Map(facts.map(f=>[f.id,f]));
 for(const f of owned.facts.filter(own))if(!registered.has(f.id)||await snapshotHash(f)!==await snapshotHash(registered.get(f.id)))fail();
 for(const f of facts){
  if([f.available_at,f.first_seen_at,f.as_of].some(t=>typeof t!=='string'||compareTime(t,owned.cutoff)>0))fail();
  const old=owned.facts.filter(x=>x.kind===f.kind&&x.period===f.period);
  if(old.length>1||old.length===1&&await snapshotHash(old[0])!==await snapshotHash(f))fail();
  if(old.length===0)owned.facts.push(f);
 }
 return owned;
}

export function withRetainedIssuer16DailyFinancials(baseRefresh:Refresh,load:LoadRegistry):Refresh{
 return async request=>{
  stopped(request.signal);const ownedRequest={...request,inputs:structuredClone(request.inputs)},baseline=ownedRequest.inputs;
  if(!Array.isArray(baseline)||baseline.length!==72||new Set(baseline.map(i=>i.symbol)).size!==72||baseline.some(i=>!Array.isArray(i.facts)))fail();
  if(baseline.some(i=>i.facts.some(own))){await requireIssuer16QuarantineContext(baseline);stopped(ownedRequest.signal);}
  const began=ownedRequest.clock();if(!validObservationTime(began))fail();let raw:unknown;
  try{raw=await load({p_source_seal:ISSUER16_SOURCE_SEAL,p_cutoff:began},ownedRequest.signal);}
  catch{stopped(ownedRequest.signal);const financial=await baseRefresh(ownedRequest);stopped(ownedRequest.signal);
   return {...financial,additionalGaps:[...new Set([...financial.additionalGaps,'ISSUER16_FIXED_REGISTRY_UNAVAILABLE_NOT_APPLIED'])]};}
  const facts=await parseIssuer16DailyRegistry(raw,began);stopped(ownedRequest.signal);await requireIssuer16QuarantineContext(baseline);
  const oldFacts=baseline.flatMap(i=>i.facts.filter(own).map(f=>({symbol:i.symbol,fact:f})));
  if(oldFacts.some(x=>x.symbol!==(x.fact as Issuer16Fact).symbol)
   ||oldFacts.length&&await snapshotHash(ordered(oldFacts.map(x=>x.fact)))!==await snapshotHash(ordered(facts)))fail();
  const stripped=baseline.map(i=>({...i,facts:i.facts.filter(f=>!own(f))}));
  const financial=structuredClone(await baseRefresh({...ownedRequest,inputs:stripped}));stopped(ownedRequest.signal);
  const cutoff=ownedRequest.clock();
  if(!validObservationTime(cutoff)||!validObservationTime(financial.cutoff)||compareTime(began,cutoff)>0
   ||compareTime(financial.cutoff,cutoff)>0||financial.proof.removals.some(r=>fixedIds.has(r.id)))fail();
  await requireIssuer16QuarantineContext(financial.inputs);stopped(ownedRequest.signal);
  const inputs:FunnelInput[]=[];for(const i of financial.inputs)inputs.push(await mergeIssuer16DailyFacts({...i,cutoff},facts));
  const issuer16_replay:ReplayProof={schema:'DAILY_AI_ISSUER16_IR_REPLAY_V1',source_seal_sha256:ISSUER16_SOURCE_SEAL,
   facts_sha256:ISSUER16_FACTS_SHA256,fact_ids:facts.map(f=>f.id).sort(),source_refetched:false,source_admitted:false,member_publication_approved:false};
  const proof:DailyAiFinancialRefreshProof&{issuer16_replay:ReplayProof}={...financial.proof,issuer16_replay};
  const gapsBySymbol={...financial.gapsBySymbol};
  for(const symbol of symbols)gapsBySymbol[symbol]=[...new Set([...(gapsBySymbol[symbol]??[]),
   'ISSUER16_RECEIPT_TIME_ONLY_COMMERCIAL_USE_REVIEW_REQUIRED','CALCULATED_MARGIN_FROM_REPORTED_AMOUNTS_NOT_DIRECT_SOURCE_PERCENT',
   'TOTAL_CASH_CAPEX_DEMAND_MOAT_VALUATION_REQUIRE_SEPARATE_EVIDENCE'])];
  return {...financial,inputs,cutoff,proof,gapsBySymbol,additionalGaps:[...new Set([...financial.additionalGaps,QGAP,
   'ISSUER16_SOURCE_ONLY_REQUIRES_COMPLETE_EXISTING_QUARANTINE_CONTEXT'])]};
 };
}
