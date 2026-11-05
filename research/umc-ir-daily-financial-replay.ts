/** Fixed-seal SOURCE adapter for independently re-extracted issuer PDF facts.
 * Research ingestion only. This is not a commercial-use or publication grant.
 * Install only with the matching private registry / SQL validation wrapper. */
import {compareTime,hashValid,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {DailyAiFinancialRefreshProof,refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';

export const UMC_IR_SOURCE_SEAL='fd579e5d06f89ff3e3d84aba9cf532e7839e79b1984841906387cc9b04ac5ccc';
export const UMC_IR_FACTS_SHA256='294e037c75a35ae1ab272540685bede596c92c2f7677007c10c3d0bca0ed346b';
export type VerifiedUmcFact=ResearchFact&{symbol:'2303';kind:'EPS'|'MARGIN'|'CAPEX';source_sha256:string;
 source_bytes:number;normalizer_version:'UMC_IR_DIRECT_FINANCIALS_V1';source_admitted:false;member_publication_approved:false};
type Refresh=typeof refreshDailyAiFinancials;
type LoadRegistry=(args:{p_source_seal:string;p_cutoff:string},signal:AbortSignal)=>Promise<unknown>;
type ReplayProof={schema:'DAILY_AI_UMC_IR_REPLAY_V1';source_seal_sha256:string;facts_sha256:string;
 fact_ids:string[];source_refetched:false;source_admitted:false;member_publication_approved:false};
const fail=():never=>{throw Error('UMC_IR_REPLAY_INVALID');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>;};
const own=(f:ResearchFact)=>f.id.startsWith('umc-ir-direct:');
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('UMC_IR_REPLAY_ABORTED');};

export async function parseUmcIrDailyRegistry(raw:unknown,cutoff:string):Promise<VerifiedUmcFact[]>{
 let captured:unknown;try{captured=structuredClone(raw);}catch{fail();}
 const r=object(captured);
 if(r.schema!=='DAILY_AI_UMC_IR_REGISTRY_V1'||r.source_seal_sha256!==UMC_IR_SOURCE_SEAL
  ||r.facts_sha256!==UMC_IR_FACTS_SHA256||r.source_admitted!==false||r.member_publication_approved!==false
  ||!validObservationTime(cutoff)||!Array.isArray(r.facts)||r.facts.length!==12
  ||await snapshotHash(r.facts)!==UMC_IR_FACTS_SHA256)fail();
 const facts=r.facts as VerifiedUmcFact[];
 for(const f of facts){
  const {id,evidence_hash,...body}=f;
  if(!['2303'].includes(f.symbol)||!['EPS','MARGIN','CAPEX'].includes(f.kind)
   ||f.basis!=='SINGLE_QUARTER'||f.normalizer_version!=='UMC_IR_DIRECT_FINANCIALS_V1'
   ||f.source_admitted!==false||f.member_publication_approved!==false||f.published_at!==null
   ||!hashValid(f.source_sha256)||!Number.isSafeInteger(f.source_bytes)||f.source_bytes<5
   ||[f.first_seen_at,f.available_at,f.as_of].some(t=>typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0)
   ||typeof f.first_seen_at!=='string'||typeof f.available_at!=='string'||typeof f.as_of!=='string'
   ||compareTime(f.first_seen_at,f.available_at)>0||compareTime(f.as_of,f.available_at)>0
   ||typeof f.values.value!=='number'||!Number.isFinite(f.values.value)
   ||f.kind==='EPS'&&(f.values.unit!=='TWD_PER_COMMON_SHARE'||f.values.measurement_basis!=='BASIC')
   ||f.kind==='MARGIN'&&f.values.unit!=='PERCENT'
   ||f.kind==='CAPEX'&&(f.values.unit!=='USD_MILLION'||f.values.currency!=='USD'||f.values.scale!==1000000
    ||f.values.conversion_to_twd!=='NOT_PERFORMED'||f.values.measurement_basis!=='DIRECTLY_REPORTED_CAPEX_SPENDING_USD'
    ||f.values.scope!=='ACTUAL_QUARTER_SPENDING_NOT_ANNUAL_BUDGET_OR_PPE')
   ||id!==`umc-ir-direct:${f.symbol}:${f.period}:${f.kind}:${f.source_sha256}`
   ||evidence_hash!==await snapshotHash(body))fail();
 }
 if(new Set(facts.map(f=>f.id)).size!==12
  ||new Set(facts.map(f=>f.symbol+':'+f.kind+':'+f.period)).size!==12)fail();
 return structuredClone(facts);
}

/** Existing exact observations survive; collisions fail rather than overwrite
 * as-reported financials or switch BASIC/DILUTED series without a new review. */
export async function mergeUmcIrDailyFacts(input:FunnelInput,registry:VerifiedUmcFact[]):Promise<FunnelInput>{
 const owned=structuredClone(input),facts=structuredClone(registry).filter(f=>f.symbol===owned.symbol);
 const registered=new Map(facts.map(f=>[f.id,f]));
 for(const f of owned.facts.filter(own)){
  const expected=registered.get(f.id);
  if(!expected||await snapshotHash(f)!==await snapshotHash(expected))fail();
 }
 for(const f of facts){
  if([f.available_at,f.first_seen_at,f.as_of].some(t=>typeof t!=='string'||compareTime(t,owned.cutoff)>0))fail();
  const old=owned.facts.filter(x=>x.kind===f.kind&&x.period===f.period);
  if(old.length>1||old.length===1&&await snapshotHash(old[0])!==await snapshotHash(f))fail();
  if(old.length===0)owned.facts.push(f);
 }
 const eps=owned.facts.filter(f=>f.kind==='EPS');
 if(facts.length&&eps.some(f=>f.values.measurement_basis!=='BASIC'))fail();
 return owned;
}

export function withRetainedUmcIrDailyFinancials(baseRefresh:Refresh,load:LoadRegistry):Refresh{
 return async request=>{
  stopped(request.signal);
  const ownedRequest={...request,inputs:structuredClone(request.inputs)};
  const baseline=ownedRequest.inputs;
  if(!Array.isArray(baseline)||baseline.length!==72||new Set(baseline.map(i=>i.symbol)).size!==72
   ||baseline.some(i=>!Array.isArray(i.facts)))fail();
  const began=ownedRequest.clock();
  if(!validObservationTime(began))fail();
  let raw:unknown;
  try{raw=await load({p_source_seal:UMC_IR_SOURCE_SEAL,p_cutoff:began},ownedRequest.signal);}
  catch{
   stopped(ownedRequest.signal);const financial=await baseRefresh(ownedRequest);stopped(ownedRequest.signal);
   return {...financial,additionalGaps:[...new Set([
    ...financial.additionalGaps,'UMC_IR_RETAINED_REGISTRY_UNAVAILABLE_NOT_APPLIED'])]};
  }
  const facts=await parseUmcIrDailyRegistry(raw,began);stopped(ownedRequest.signal);
  // The original refresh removes restricted company-site facts and records a
  // removal proof. Its SQL counterpart receives issuer facts stripped by the
  // fixed-registry wrapper. Therefore remove *only already exact fixed facts*
  // from the refresh's owned baseline first; never erase proof.removals later.
  const oldFacts=baseline.flatMap(i=>i.facts.filter(own).map(f=>({company:i.symbol,fact:f})));
  if(oldFacts.some(({company,fact})=>company!==(fact as VerifiedUmcFact).symbol))fail();
  if(oldFacts.length&&await snapshotHash(oldFacts.map(x=>x.fact).sort((a,b)=>a.id.localeCompare(b.id)))
   !==await snapshotHash([...facts].sort((a,b)=>a.id.localeCompare(b.id))))fail();
  const stripped=baseline.map(i=>({...i,facts:i.facts.filter(f=>!own(f))}));
  const financial=await baseRefresh({...ownedRequest,inputs:stripped});stopped(ownedRequest.signal);
  const cutoff=ownedRequest.clock();
  if(!validObservationTime(cutoff)||!validObservationTime(financial.cutoff)
   ||compareTime(began,cutoff)>0||compareTime(financial.cutoff,cutoff)>0
   ||financial.proof.removals.some(r=>r.id.startsWith('umc-ir-direct:')))fail();
  const inputs:FunnelInput[]=[];
  for(const input of financial.inputs)inputs.push(await mergeUmcIrDailyFacts({...input,cutoff},facts));
  if(inputs.length!==72||new Set(inputs.map(i=>i.symbol)).size!==72||!['2303'].every(s=>inputs.some(i=>i.symbol===s)))fail();
  const umc_ir_replay:ReplayProof={schema:'DAILY_AI_UMC_IR_REPLAY_V1',source_seal_sha256:UMC_IR_SOURCE_SEAL,
   facts_sha256:UMC_IR_FACTS_SHA256,fact_ids:facts.map(f=>f.id).sort(),source_refetched:false,
   source_admitted:false,member_publication_approved:false};
  const proof:DailyAiFinancialRefreshProof&{umc_ir_replay:ReplayProof}={...financial.proof,umc_ir_replay};
  const gapsBySymbol={...financial.gapsBySymbol};
  for(const symbol of ['2303'])gapsBySymbol[symbol]=[...new Set([
   ...(gapsBySymbol[symbol]??[]).filter(g=>!['FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA',
    'CAPEX_DEMAND_MOAT_VALUATION_REQUIRE_SEPARATE_EVIDENCE'].includes(g)),
   'UMC_IR_RECEIPT_TIME_ONLY_COMMERCIAL_USE_REVIEW_REQUIRED','DEMAND_MOAT_VALUATION_REQUIRE_SEPARATE_EVIDENCE',
   'UMC_CAPEX_USD_MILLION_NOT_CONVERTED_TO_TWD',
  ])];
  return {...financial,inputs,cutoff,proof,gapsBySymbol};
 };
}
