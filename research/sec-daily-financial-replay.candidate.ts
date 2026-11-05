/** Candidate SOURCE financial port. Replays only the fixed, separately verified
 * SEC observations; never re-fetches, re-dates, admits or publishes a source.
 * Install with the matching private registry/validator migration, not alone. */
import {canonical} from './entry-opportunity.ts';
import {compareTime,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import type {FunnelInput} from '../src/features/vnext/researchFunnel.ts';
import type {DailyAiFinancialRefreshProof,DailyAiFinancialRefreshResult,refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';
import {withSecQuarterFinancials,type SecQuarterFact} from './sec-quarter-financials.ts';

export const SEC_RETAINED_SOURCE_SEAL='a4398990a8bf63580efae7afee918613783249573f78e1ca7a11fd70de0f6edb';
export const SEC_RETAINED_FACTS_SHA256='d0402e790286173f8cac9cb9b8cf216d4c3dc0db78dc83f3ac1c91878d141527';
export const SEC_RETAINED_DOCUMENTS_SHA256='77fe7baac1e3208c5fb82c4c9c2613177307a6f583a70b7b5496a2338967f710';
export const SEC_RETAINED_REPLAY_GAPS=[
 'SEC_SOURCE_RETAINED_REPLAY_NOT_REFRESHED',
 'SEC_TIFRS_QUARTERS_NOT_RECONCILED_TO_IASB_ANNUAL_IFRS',
 'SEC_RELEASE_NOT_BOARD_APPROVED_AT_RELEASE_REVISIONS_AND_QUALITATIVE_REVIEW_PENDING',
];
export type SecRetainedReplayProof={schema:'DAILY_AI_SEC_RETAINED_REPLAY_V1';source_seal_sha256:string;facts_sha256:string;
 fact_ids:string[];replay_basis:'RETAINED_ORIGINAL_RECEIPTS_NOT_REOBSERVED';source_refetched:false;
 source_admitted:false;member_publication_approved:false};
type Refresh=typeof refreshDailyAiFinancials;
type LoadRegistry=(args:{p_source_seal:string;p_cutoff:string},signal:AbortSignal)=>Promise<unknown>;
type Registry={facts:SecQuarterFact[];source_documents:unknown[]};
const fail=():never=>{throw Error('SEC_DAILY_REGISTRY_INVALID');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>;};
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('SEC_DAILY_REPLAY_ABORTED');};
const ownSec=(f:{id:string;source:string})=>f.id.startsWith('sec-quarter:')
 ||/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1046179\//.test(f.source);

/** The server registry is itself hash-bound to the retained source candidate.
 * The fact hash is JS canonical JSON, not PostgreSQL jsonb::text formatting. */
export async function parseRetainedSecDailyRegistry(raw:unknown,cutoff:string):Promise<Registry>{
 const r=object(raw);
 const keys=['schema','source_seal_sha256','facts_sha256','facts','source_documents','source_documents_sha256',
  'replay_basis','source_admitted','member_publication_approved'];
 if(Object.keys(r).sort().join('|')!==keys.sort().join('|')||r.schema!=='DAILY_AI_SEC_RETAINED_REGISTRY_V1'
  ||r.source_seal_sha256!==SEC_RETAINED_SOURCE_SEAL||r.facts_sha256!==SEC_RETAINED_FACTS_SHA256
  ||r.source_documents_sha256!==SEC_RETAINED_DOCUMENTS_SHA256||r.source_admitted!==false||r.member_publication_approved!==false
  ||r.replay_basis!=='RETAINED_ORIGINAL_RECEIPTS_NOT_REOBSERVED'||!validObservationTime(cutoff)
  ||!Array.isArray(r.facts)||r.facts.length!==12||!Array.isArray(r.source_documents)||r.source_documents.length!==8
  ||await snapshotHash(r.facts)!==SEC_RETAINED_FACTS_SHA256||await snapshotHash(r.source_documents)!==SEC_RETAINED_DOCUMENTS_SHA256)fail();
 const facts=r.facts as SecQuarterFact[];
 if(facts.some(f=>f.symbol!=='2330'||[f.available_at,f.first_seen_at,f.as_of].some(t=>
   typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0))||new Set(facts.map(f=>f.id)).size!==12)fail();
 // Includes unchanged per-fact evidence hashes, source flags and chronology.
 await withSecQuarterFinancials({symbol:'2330',cutoff,facts:[]} as unknown as FunnelInput,facts);
 return {facts:structuredClone(facts),source_documents:structuredClone(r.source_documents as unknown[])};
}

/** Retain identical observations once. A revision or namespace collision needs
 * a new reviewed registry; the adapter never replaces it automatically. */
export async function mergeRetainedSecDailyFacts(input:FunnelInput,facts:SecQuarterFact[]):Promise<FunnelInput>{
 if(input.symbol!=='2330'){
  if(input.facts.some(ownSec))throw Error('SEC_DAILY_REPLAY_SCOPE');
  return structuredClone(input);
 }
 const approved=new Map(facts.map(f=>[f.id,f]));
 if(input.facts.some(f=>ownSec(f)&&(!approved.has(f.id)||canonical(f)!==canonical(approved.get(f.id)))))throw Error('SEC_DAILY_REPLAY_DRIFT');
 const missing:SecQuarterFact[]=[];
 for(const fact of facts){
  const old=input.facts.filter(f=>f.kind===fact.kind&&f.period===fact.period);
  if(!old.length)missing.push(fact);
  else if(old.length!==1||canonical(old[0])!==canonical(fact))throw Error('SEC_DAILY_REPLAY_CONFLICT');
 }
 return withSecQuarterFinancials(input,missing);
}

/** Wrap the existing official open-API collector without modifying its source
 * proof. The separate sec_replay extension is checked by the new DB wrapper. */
export function withRetainedSecDailyFinancials(baseRefresh:Refresh,load:LoadRegistry):Refresh{
 return async request=>{
  const financial=await baseRefresh(request);stopped(request.signal);
  const cutoff=request.clock();
  if(!validObservationTime(cutoff)||!validObservationTime(financial.cutoff)||compareTime(financial.cutoff,cutoff)>0)throw Error('SEC_DAILY_REPLAY_CLOCK');
  let raw:unknown;
  try{raw=await load({p_source_seal:SEC_RETAINED_SOURCE_SEAL,p_cutoff:cutoff},request.signal);}
  catch{
   stopped(request.signal);
   // Old valid facts remain in the baseline. The DB wrapper validates their
   // unchanged bytes; absence of the new source cannot create replacement data.
   const missing='SEC_RETAINED_SOURCE_REPLAY_UNAVAILABLE';
   return {...financial,additionalGaps:[...new Set([...financial.additionalGaps,missing])],
    gapsBySymbol:{...financial.gapsBySymbol,'2330':[...new Set([...(financial.gapsBySymbol['2330']??[]),missing])]}};
  }
  stopped(request.signal);const registry=await parseRetainedSecDailyRegistry(raw,cutoff);
  const inputs:FunnelInput[]=[];
  for(const input of financial.inputs){
   stopped(request.signal);inputs.push(await mergeRetainedSecDailyFacts({...input,cutoff},registry.facts));
  }
  if(inputs.length!==72||new Set(inputs.map(s=>s.symbol)).size!==72||!inputs.some(s=>s.symbol==='2330'))throw Error('SEC_DAILY_REPLAY_SCOPE');
  const sec_replay:SecRetainedReplayProof={schema:'DAILY_AI_SEC_RETAINED_REPLAY_V1',source_seal_sha256:SEC_RETAINED_SOURCE_SEAL,
   facts_sha256:SEC_RETAINED_FACTS_SHA256,fact_ids:registry.facts.map(f=>f.id).sort(),
   replay_basis:'RETAINED_ORIGINAL_RECEIPTS_NOT_REOBSERVED',source_refetched:false,source_admitted:false,member_publication_approved:false};
  const proof:DailyAiFinancialRefreshProof&{sec_replay:SecRetainedReplayProof}={...financial.proof,sec_replay};
  const gapsBySymbol={...financial.gapsBySymbol,'2330':[...new Set([
   ...SEC_RETAINED_REPLAY_GAPS,...(financial.gapsBySymbol['2330']??[])
    .filter(g=>g!=='FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA'),
  ])]};
  return {...financial,inputs,cutoff,gapsBySymbol,proof} satisfies DailyAiFinancialRefreshResult;
 };
}
