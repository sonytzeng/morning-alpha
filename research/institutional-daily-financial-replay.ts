/** Existing SOURCE replay pattern for exact reviewed official share counts.
 * No refetch, model call, commercial grant, lot or currency conversion. */
import {compareTime,hashValid,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import {canonical} from './entry-opportunity.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {DailyAiFinancialRefreshProof,refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';
import {INSTITUTIONAL_SOURCE_SEAL,INSTITUTIONAL_FACTS_SHA256,INSTITUTIONAL_REGISTRY_CUTOFF,INSTITUTIONAL_FACT_IDS,INSTITUTIONAL_SYMBOLS} from './institutional-registry.constants.ts';
export {INSTITUTIONAL_SOURCE_SEAL,INSTITUTIONAL_FACTS_SHA256};
export type VerifiedInstitutionalFact=ResearchFact&{symbol:string;kind:'INSTITUTIONAL';basis:'SHARES';unit:'SHARES';
 source_sha256:string;source_bytes:number;source_received_at:string;not_currency:true;source_admitted:false;member_publication_approved:false};
type Refresh=typeof refreshDailyAiFinancials;
type LoadRegistry=(args:{p_source_seal:string;p_cutoff:string},signal:AbortSignal)=>Promise<unknown>;
type ReplayProof={schema:'DAILY_AI_OFFICIAL_INSTITUTIONAL_REPLAY_V1';source_seal_sha256:string;facts_sha256:string;
 fact_ids:string[];source_refetched:false;source_admitted:false;member_publication_approved:false};
const fixedIds=new Set<string>(INSTITUTIONAL_FACT_IDS),fixedSymbols=new Set<string>(INSTITUTIONAL_SYMBOLS);
const fail=():never=>{throw Error('INSTITUTIONAL_REPLAY_INVALID');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>;};
const own=(f:ResearchFact)=>fixedIds.has(f.id);
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('INSTITUTIONAL_REPLAY_ABORTED');};
const ordered=(facts:ResearchFact[])=>facts.slice().sort((a,b)=>a.id.localeCompare(b.id));

/** Distinct captures of the same public row may share its row ID and hash.
 * Preserve the pre-existing capture byte-for-byte: never replace its receipt
 * clock, claim the sealed registry was replayed, or infer a commercial grant. */
export async function matchesExistingInstitutionalCaptures(inputs:FunnelInput[],registry:VerifiedInstitutionalFact[],cutoff:string){
 if(!validObservationTime(cutoff)||inputs.length!==72||registry.length!==144||new Set(inputs.map(i=>i.symbol)).size!==72)return false;
 const byId=new Map(registry.map(f=>[f.id,f]));
 if(byId.size!==144)return false;
 const existing=inputs.flatMap(i=>i.facts.filter(f=>byId.has(f.id)).map(f=>({symbol:i.symbol,f})));
 if(existing.length!==144||new Set(existing.map(x=>x.f.id)).size!==144)return false;
 const protectedFields=['unit','not_currency','source_admitted','member_publication_approved','source_received_at','source_sha256','source_bytes','source_locator'];
 const ignoredFields=new Set([...protectedFields,'first_seen_at','available_at']);
 const body=(value:ResearchFact)=>Object.fromEntries(Object.entries(value).filter(([k])=>!ignoredFields.has(k)));
 for(const {symbol,f} of existing){
  const expected=byId.get(f.id);if(!expected||symbol!==expected.symbol)return false;
  if(protectedFields.some(k=>Object.hasOwn(f,k)))return false;
  if(canonical(body(f))!==canonical(body(expected)))return false;
  if(!f.first_seen_at||!f.available_at||!f.as_of||![f.first_seen_at,f.available_at,f.as_of].every(validObservationTime)
   ||compareTime(f.as_of,f.first_seen_at)>0||compareTime(f.first_seen_at,f.available_at)>0||compareTime(f.available_at,cutoff)>0)return false;
 }
 return true;
}

export async function parseInstitutionalDailyRegistry(raw:unknown,cutoff:string):Promise<VerifiedInstitutionalFact[]>{
 let captured:unknown;try{captured=structuredClone(raw);}catch{fail();}
 const r=object(captured);
 if(r.schema!=='DAILY_AI_OFFICIAL_INSTITUTIONAL_REGISTRY_V1'||r.source_seal_sha256!==INSTITUTIONAL_SOURCE_SEAL
  ||r.facts_sha256!==INSTITUTIONAL_FACTS_SHA256||r.source_admitted!==false||r.member_publication_approved!==false
  ||r.registry_cutoff!==INSTITUTIONAL_REGISTRY_CUTOFF||!validObservationTime(cutoff)||compareTime(cutoff,INSTITUTIONAL_REGISTRY_CUTOFF)<0
  ||!Array.isArray(r.facts)||r.facts.length!==144
  ||await snapshotHash(r.facts)!==INSTITUTIONAL_FACTS_SHA256)fail();
 const facts=r.facts as VerifiedInstitutionalFact[];
 for(const f of facts){
  if(!fixedIds.has(f.id)||!fixedSymbols.has(f.symbol)||f.kind!=='INSTITUTIONAL'||f.basis!=='SHARES'||f.unit!=='SHARES'
   ||f.not_currency!==true||f.source_admitted!==false||f.member_publication_approved!==false||f.published_at!==null
   ||!['2026-10-29','2026-10-30'].includes(f.period??'')||!hashValid(f.source_sha256)||!hashValid(f.evidence_hash)
   ||!Number.isSafeInteger(f.source_bytes)||f.source_bytes<5
   ||[f.first_seen_at,f.available_at,f.as_of,f.source_received_at].some(t=>typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0)
   ||f.first_seen_at!==f.available_at||f.available_at!==f.source_received_at
   ||typeof f.as_of!=='string'||typeof f.available_at!=='string'||compareTime(f.as_of,f.available_at)>0
   ||f.as_of!==f.period+'T13:30:00+08:00'
   ||!Object.values(f.values).every(Number.isSafeInteger)
   ||Object.keys(f.values).sort().join('|')!==['net_shares','foreign_net_shares','trust_net_shares','dealer_net_shares'].sort().join('|')
   ||Number(f.values.foreign_net_shares)+Number(f.values.trust_net_shares)+Number(f.values.dealer_net_shares)!==f.values.net_shares)fail();
 }
 if(new Set(facts.map(f=>f.id)).size!==144||new Set(facts.map(f=>f.symbol+':'+f.period)).size!==144
  ||[...fixedSymbols].some(symbol=>facts.filter(f=>f.symbol===symbol).length!==2))fail();
 return structuredClone(facts);
}

/** Exact fixed IDs only. Older institutional observations are never stripped
 * by their generic INSTITUTIONAL prefix, and conflicting same-day data fails. */
export async function mergeInstitutionalDailyFacts(input:FunnelInput,registry:VerifiedInstitutionalFact[]):Promise<FunnelInput>{
 const owned=structuredClone(input),facts=structuredClone(registry).filter(f=>f.symbol===owned.symbol);
 if(!fixedSymbols.has(owned.symbol)||facts.length!==2)fail();
 const registered=new Map(facts.map(f=>[f.id,f]));
 for(const f of owned.facts.filter(own)){
  const expected=registered.get(f.id);if(!expected||await snapshotHash(f)!==await snapshotHash(expected))fail();
 }
 for(const f of facts){
  if([f.available_at,f.first_seen_at,f.as_of].some(t=>typeof t!=='string'||compareTime(t,owned.cutoff)>0))fail();
  const old=owned.facts.filter(x=>x.kind==='INSTITUTIONAL'&&x.period===f.period);
  if(old.length>1||old.length===1&&await snapshotHash(old[0])!==await snapshotHash(f))fail();
  if(old.length===0)owned.facts.push(f);
 }
 return owned;
}

export function withRetainedInstitutionalDailyFinancials(baseRefresh:Refresh,load:LoadRegistry):Refresh{
 return async request=>{
  stopped(request.signal);
  const ownedRequest={...request,inputs:structuredClone(request.inputs)},baseline=ownedRequest.inputs;
  if(!Array.isArray(baseline)||baseline.length!==72||new Set(baseline.map(i=>i.symbol)).size!==72
   ||baseline.some(i=>!fixedSymbols.has(i.symbol)||!Array.isArray(i.facts)))fail();
  const began=ownedRequest.clock();if(!validObservationTime(began))fail();
  let raw:unknown;
  try{raw=await load({p_source_seal:INSTITUTIONAL_SOURCE_SEAL,p_cutoff:began},ownedRequest.signal);}
  catch{
   stopped(ownedRequest.signal);const financial=await baseRefresh(ownedRequest);stopped(ownedRequest.signal);
   return {...financial,additionalGaps:[...new Set([...financial.additionalGaps,'INSTITUTIONAL_FIXED_SUPPLEMENT_UNAVAILABLE_NOT_APPLIED'])]};
  }
  const facts=await parseInstitutionalDailyRegistry(raw,began);stopped(ownedRequest.signal);
  const oldFacts=baseline.flatMap(i=>i.facts.filter(own).map(f=>({symbol:i.symbol,fact:f})));
  if(oldFacts.some(({symbol,fact})=>symbol!==(fact as VerifiedInstitutionalFact).symbol))fail();
  if(oldFacts.length&&await snapshotHash(ordered(oldFacts.map(x=>x.fact)))!==await snapshotHash(ordered(facts))){
   if(!await matchesExistingInstitutionalCaptures(baseline,facts,began))fail();
   const original=structuredClone(oldFacts.map(x=>x.fact));
   const financial=await baseRefresh(ownedRequest);stopped(ownedRequest.signal);
   const finalFacts=financial.inputs.flatMap(i=>i.facts.filter(own));
   if(financial.inputs.some(i=>i.facts.filter(own).some(f=>i.symbol!==(f as VerifiedInstitutionalFact).symbol))
    ||financial.proof.removals.some(removal=>fixedIds.has(removal.id))
    ||object(financial.proof).institutional_replay!==undefined||await snapshotHash(ordered(finalFacts))!==await snapshotHash(ordered(original)))fail();
   return {...financial,additionalGaps:[...new Set([...financial.additionalGaps,'INSTITUTIONAL_EXISTING_CAPTURE_PRESERVED_REGISTRY_NOT_REPLAYED'])]};
  }
  const stripped=baseline.map(i=>({...i,facts:i.facts.filter(f=>!own(f))}));
  const financial=await baseRefresh({...ownedRequest,inputs:stripped});stopped(ownedRequest.signal);
  const cutoff=ownedRequest.clock();
  if(!validObservationTime(cutoff)||!validObservationTime(financial.cutoff)||compareTime(began,cutoff)>0
   ||compareTime(financial.cutoff,cutoff)>0||financial.proof.removals.some(r=>fixedIds.has(r.id)))fail();
  const inputs:FunnelInput[]=[];
  for(const input of financial.inputs)inputs.push(await mergeInstitutionalDailyFacts({...input,cutoff},facts));
  if(inputs.length!==72||new Set(inputs.map(i=>i.symbol)).size!==72)fail();
  const institutional_replay:ReplayProof={schema:'DAILY_AI_OFFICIAL_INSTITUTIONAL_REPLAY_V1',source_seal_sha256:INSTITUTIONAL_SOURCE_SEAL,
   facts_sha256:INSTITUTIONAL_FACTS_SHA256,fact_ids:facts.map(f=>f.id).sort(),source_refetched:false,source_admitted:false,member_publication_approved:false};
  const proof:DailyAiFinancialRefreshProof&{institutional_replay:ReplayProof}={...financial.proof,institutional_replay};
  const gapsBySymbol={...financial.gapsBySymbol};
  for(const symbol of fixedSymbols)gapsBySymbol[symbol]=[...new Set([...(gapsBySymbol[symbol]??[]),
   'INSTITUTIONAL_TWO_SESSIONS_RETAINED_OFFICIAL_SHARES_NO_CURRENCY_CONVERSION'])];
  return {...financial,inputs,cutoff,proof,gapsBySymbol};
 };
}
