/** Fixed-seal SOURCE adapter for independently re-extracted issuer PDF facts.
 * Research ingestion only. This is not a commercial-use or publication grant.
 * Install only with the matching private registry / SQL validation wrapper. */
import {compareTime,hashValid,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {DailyAiFinancialRefreshProof,refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';

export const ISSUER_IR_SOURCE_SEAL='f4ea34657aa08d4e9db61bb45851510fe1aaa97193ca592a8c983be3ff4c4b32';
export const ISSUER_IR_FACTS_SHA256='feda7f3fd3dc513e30c62c6e398cd4d915178a11a3a52cf3c71f7cbfc435c36e';
export type VerifiedIssuerFact=ResearchFact&{symbol:'2454'|'2379';kind:'EPS'|'MARGIN';source_sha256:string;
 source_bytes:number;normalizer_version:'ISSUER_IR_DIRECT_FINANCIALS_V1';source_admitted:false;member_publication_approved:false};
type Refresh=typeof refreshDailyAiFinancials;
type LoadRegistry=(args:{p_source_seal:string;p_cutoff:string},signal:AbortSignal)=>Promise<unknown>;
type ReplayProof={schema:'DAILY_AI_ISSUER_IR_REPLAY_V1';source_seal_sha256:string;facts_sha256:string;
 fact_ids:string[];source_refetched:false;source_admitted:false;member_publication_approved:false};
const fail=():never=>{throw Error('ISSUER_IR_REPLAY_INVALID');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>;};
const own=(f:ResearchFact)=>f.id.startsWith('issuer-ir-direct:');
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('ISSUER_IR_REPLAY_ABORTED');};

export async function parseIssuerIrDailyRegistry(raw:unknown,cutoff:string):Promise<VerifiedIssuerFact[]>{
 let captured:unknown;try{captured=structuredClone(raw);}catch{fail();}
 const r=object(captured);
 if(r.schema!=='DAILY_AI_ISSUER_IR_REGISTRY_V1'||r.source_seal_sha256!==ISSUER_IR_SOURCE_SEAL
  ||r.facts_sha256!==ISSUER_IR_FACTS_SHA256||r.source_admitted!==false||r.member_publication_approved!==false
  ||!validObservationTime(cutoff)||!Array.isArray(r.facts)||r.facts.length!==14
  ||await snapshotHash(r.facts)!==ISSUER_IR_FACTS_SHA256)fail();
 const facts=r.facts as VerifiedIssuerFact[];
 for(const f of facts){
  const {id,evidence_hash,...body}=f;
  if(!['2454','2379'].includes(f.symbol)||!['EPS','MARGIN'].includes(f.kind)
   ||f.basis!=='SINGLE_QUARTER'||f.normalizer_version!=='ISSUER_IR_DIRECT_FINANCIALS_V1'
   ||f.source_admitted!==false||f.member_publication_approved!==false||f.published_at!==null
   ||!hashValid(f.source_sha256)||!Number.isSafeInteger(f.source_bytes)||f.source_bytes<5
   ||[f.first_seen_at,f.available_at,f.as_of].some(t=>typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0)
   ||typeof f.first_seen_at!=='string'||typeof f.available_at!=='string'||typeof f.as_of!=='string'
   ||compareTime(f.first_seen_at,f.available_at)>0||compareTime(f.as_of,f.available_at)>0
   ||typeof f.values.value!=='number'||!Number.isFinite(f.values.value)
   ||f.kind==='EPS'&&(f.values.unit!=='TWD_PER_COMMON_SHARE'||f.values.measurement_basis!==(f.symbol==='2454'?'BASIC':'DILUTED'))
   ||f.kind==='MARGIN'&&f.values.unit!=='PERCENT'
   ||id!==`issuer-ir-direct:${f.symbol}:${f.period}:${f.kind}:${f.source_sha256}:${f.values.measurement_basis}`
   ||evidence_hash!==await snapshotHash(body))fail();
 }
 if(new Set(facts.map(f=>f.id)).size!==14
  ||new Set(facts.map(f=>f.symbol+':'+f.kind+':'+f.period)).size!==14)fail();
 return structuredClone(facts);
}

/** Existing exact observations survive; collisions fail rather than overwrite
 * as-reported financials or switch BASIC/DILUTED series without a new review. */
export async function mergeIssuerIrDailyFacts(input:FunnelInput,registry:VerifiedIssuerFact[]):Promise<FunnelInput>{
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
 if(facts.length&&eps.some(f=>f.values.measurement_basis!==(owned.symbol==='2454'?'BASIC':'DILUTED')))fail();
 return owned;
}

export function withRetainedIssuerIrDailyFinancials(baseRefresh:Refresh,load:LoadRegistry):Refresh{
 return async request=>{
  stopped(request.signal);
  const ownedRequest={...request,inputs:structuredClone(request.inputs)};
  const baseline=ownedRequest.inputs;
  if(!Array.isArray(baseline)||baseline.length!==72||new Set(baseline.map(i=>i.symbol)).size!==72
   ||baseline.some(i=>!Array.isArray(i.facts)))fail();
  const began=ownedRequest.clock();
  if(!validObservationTime(began))fail();
  let raw:unknown;
  try{raw=await load({p_source_seal:ISSUER_IR_SOURCE_SEAL,p_cutoff:began},ownedRequest.signal);}
  catch{
   stopped(ownedRequest.signal);const financial=await baseRefresh(ownedRequest);stopped(ownedRequest.signal);
   return {...financial,additionalGaps:[...new Set([
    ...financial.additionalGaps,'ISSUER_IR_RETAINED_REGISTRY_UNAVAILABLE_NOT_APPLIED'])]};
  }
  const facts=await parseIssuerIrDailyRegistry(raw,began);stopped(ownedRequest.signal);
  // The original refresh removes restricted company-site facts and records a
  // removal proof. Its SQL counterpart receives issuer facts stripped by the
  // fixed-registry wrapper. Therefore remove *only already exact fixed facts*
  // from the refresh's owned baseline first; never erase proof.removals later.
  const oldFacts=baseline.flatMap(i=>i.facts.filter(own).map(f=>({company:i.symbol,fact:f})));
  if(oldFacts.some(({company,fact})=>company!==(fact as VerifiedIssuerFact).symbol))fail();
  if(oldFacts.length&&await snapshotHash(oldFacts.map(x=>x.fact).sort((a,b)=>a.id.localeCompare(b.id)))
   !==await snapshotHash([...facts].sort((a,b)=>a.id.localeCompare(b.id))))fail();
  const stripped=baseline.map(i=>({...i,facts:i.facts.filter(f=>!own(f))}));
  const financial=await baseRefresh({...ownedRequest,inputs:stripped});stopped(ownedRequest.signal);
  const cutoff=ownedRequest.clock();
  if(!validObservationTime(cutoff)||!validObservationTime(financial.cutoff)
   ||compareTime(began,cutoff)>0||compareTime(financial.cutoff,cutoff)>0
   ||financial.proof.removals.some(r=>r.id.startsWith('issuer-ir-direct:')))fail();
  const inputs:FunnelInput[]=[];
  for(const input of financial.inputs)inputs.push(await mergeIssuerIrDailyFacts({...input,cutoff},facts));
  if(inputs.length!==72||new Set(inputs.map(i=>i.symbol)).size!==72||!['2454','2379'].every(s=>inputs.some(i=>i.symbol===s)))fail();
  const issuer_ir_replay:ReplayProof={schema:'DAILY_AI_ISSUER_IR_REPLAY_V1',source_seal_sha256:ISSUER_IR_SOURCE_SEAL,
   facts_sha256:ISSUER_IR_FACTS_SHA256,fact_ids:facts.map(f=>f.id).sort(),source_refetched:false,
   source_admitted:false,member_publication_approved:false};
  const proof:DailyAiFinancialRefreshProof&{issuer_ir_replay:ReplayProof}={...financial.proof,issuer_ir_replay};
  const gapsBySymbol={...financial.gapsBySymbol};
  for(const symbol of ['2454','2379'])gapsBySymbol[symbol]=[...new Set([
   ...(gapsBySymbol[symbol]??[]).filter(g=>symbol!=='2454'||g!=='FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA'),
   'ISSUER_IR_RECEIPT_TIME_ONLY_COMMERCIAL_USE_REVIEW_REQUIRED','CAPEX_DEMAND_MOAT_VALUATION_REQUIRE_SEPARATE_EVIDENCE',
   ...(symbol==='2379'?['ISSUER_IR_FOUR_CONSECUTIVE_QUARTERS_MISSING']:[]),
  ])];
  return {...financial,inputs,cutoff,proof,gapsBySymbol};
 };
}
