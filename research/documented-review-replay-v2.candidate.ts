/** Candidate V2 review replay. V1 receives its original financial namespace;
 * the final SOURCE port applies reviewed judgments only to their bound quote.
 * Registry retention is never source admission or member publication approval. */
import {canonical} from './entry-opportunity.ts';
import {compareTime,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';
import {DOCUMENTED_REVIEW_V2_CONTRACT as C} from './documented-review-v2-contract.candidate.ts';

type Refresh=typeof refreshDailyAiFinancials;
type Rpc=(name:string,args:Record<string,unknown>,signal?:AbortSignal)=>Promise<unknown>;
export type DocumentedReviewState='ACTIVE'|'EXPIRED_NOT_APPLIED'|'PRICE_DATE_UNVERIFIED_NOT_APPLIED'
 |'PRICE_DATE_CHANGED_NOT_APPLIED'|'PRICE_CHANGED_NOT_APPLIED'|'REGISTRY_UNAVAILABLE_NOT_APPLIED'
 |'FINANCIAL_BASE_INCOMPLETE_NOT_APPLIED';
export type DocumentedReviewFact=ResearchFact&{symbol:string;source_admitted:false;member_publication_approved:false;
 review_valid_until:string;review_price_basis:typeof C.review_price_basis};
type ObservedPrice={session_date:string|null;close_twd:number|null};
export type DocumentedReviewProof={schema:'DOCUMENTED_REVIEW_REPLAY_V2';source_seal_sha256:string;facts_sha256:string;
 review_valid_until:string;review_price_basis:typeof C.review_price_basis;review_fact_ids:string[];applied_fact_ids:string[];
 state:DocumentedReviewState;observed_price:ObservedPrice;source_refetched:false;source_admitted:false;member_publication_approved:false};
const invalid=():never=>{throw Error('DOCUMENTED_REVIEW_V2_INVALID');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))invalid();return v as Record<string,unknown>;};
const stopped=(signal?:AbortSignal)=>{if(signal?.aborted)throw Error('DOCUMENTED_REVIEW_V2_ABORTED');};
const reserved=(fact:{id:string})=>fact.id.startsWith('own-documented-review:');
const sorted=<T extends {id:string}>(facts:T[])=>facts.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);

/** Strip only the sealed review namespace before V1 inspects SEC identities.
 * Any partial, changed or cross-issuer review set remains a hard rejection. */
export async function stripVerifiedDocumentedReviews(inputs:FunnelInput[]):Promise<FunnelInput[]>{
 if(!Array.isArray(inputs)||inputs.length!==72||new Set(inputs.map(s=>s.symbol)).size!==72)invalid();
 const found=inputs.flatMap(s=>s.facts.filter(reserved).map(f=>({stock:s.symbol,fact:f})));
 if(found.some(x=>x.stock!=='2330'||(x.fact as DocumentedReviewFact).symbol!=='2330'))invalid();
 if(found.length&&(found.length!==3||await snapshotHash(sorted(found.map(x=>x.fact)))!==C.facts_sha256))invalid();
 return inputs.map(s=>({...structuredClone(s),facts:structuredClone(s.facts.filter(f=>!reserved(f)))}));
}

export async function parseDocumentedReviewRegistry(raw:unknown,cutoff:string):Promise<DocumentedReviewFact[]>{
 const r=object(raw),keys=['schema','source_seal_sha256','facts_sha256','facts','source_review_sha256','review_receipt_sha256',
  'review_valid_until','review_price_basis','source_admitted','member_publication_approved'];
 if(Object.keys(r).sort().join('|')!==keys.sort().join('|')||r.schema!=='DOCUMENTED_REVIEW_REGISTRY_V2'
  ||r.source_seal_sha256!==C.source_seal_sha256||r.facts_sha256!==C.facts_sha256
  ||r.source_review_sha256!==C.source_review_sha256||r.review_receipt_sha256!==C.review_receipt_sha256
  ||r.review_valid_until!==C.review_valid_until||canonical(r.review_price_basis)!==canonical(C.review_price_basis)
  ||r.source_admitted!==false||r.member_publication_approved!==false||!validObservationTime(cutoff)
  ||!Array.isArray(r.facts)||r.facts.length!==3||await snapshotHash(sorted(r.facts as DocumentedReviewFact[]))!==C.facts_sha256)invalid();
 const facts=r.facts as DocumentedReviewFact[];
 for(const fact of facts){
  // Own-review hashes retain their ID in the original preimage. This differs
  // from the older SEC numeric parser; never rewrite either source's seal.
  const {evidence_hash,...body}=fact;const id=fact.id;
  if(fact.symbol!=='2330'||!C.review_fact_ids.includes(id)||fact.basis!=='DOCUMENTED_REVIEW'
   ||fact.source_admitted!==false||fact.member_publication_approved!==false||fact.review_valid_until!==C.review_valid_until
   ||canonical(fact.review_price_basis)!==canonical(C.review_price_basis)||evidence_hash!==await snapshotHash(body)
   ||[fact.available_at,fact.first_seen_at,fact.as_of].some(t=>typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0))invalid();
 }
 return structuredClone(facts);
}

export function documentedReviewState(inputs:FunnelInput[],cutoff:string):{state:DocumentedReviewState;observed_price:ObservedPrice}{
 if(!validObservationTime(cutoff))invalid();
 const stock=inputs.find(s=>s.symbol==='2330'),bars=stock?.bars.filter(b=>b.date===stock.through)??[];
 const close=bars.length===1&&typeof bars[0].close==='number'&&Number.isFinite(bars[0].close)&&bars[0].close>0?bars[0].close:null;
 const observed_price={session_date:stock?.through??null,close_twd:close};
 if(compareTime(cutoff,C.review_valid_until)>=0)return {state:'EXPIRED_NOT_APPLIED',observed_price};
 if(!stock||!/^\d{4}-\d\d-\d\d$/.test(stock.through)||close===null)return {state:'PRICE_DATE_UNVERIFIED_NOT_APPLIED',observed_price};
 if(stock.through!==C.review_price_basis.session_date)return {state:'PRICE_DATE_CHANGED_NOT_APPLIED',observed_price};
 if(close!==C.review_price_basis.close_twd)return {state:'PRICE_CHANGED_NOT_APPLIED',observed_price};
 if(stock.facts.filter(f=>f.id.startsWith('sec-quarter:2330:')).length!==12)return {state:'FINANCIAL_BASE_INCOMPLETE_NOT_APPLIED',observed_price};
 return {state:'ACTIVE',observed_price};
}

export function documentedReviewProof(state:DocumentedReviewState,observed_price:ObservedPrice):DocumentedReviewProof{
 return {schema:'DOCUMENTED_REVIEW_REPLAY_V2',source_seal_sha256:C.source_seal_sha256,facts_sha256:C.facts_sha256,
  review_valid_until:C.review_valid_until,review_price_basis:structuredClone(C.review_price_basis),
  review_fact_ids:[...C.review_fact_ids],applied_fact_ids:state==='ACTIVE'?[...C.review_fact_ids]:[],state,observed_price,
  source_refetched:false,source_admitted:false,member_publication_approved:false};
}

/** The parallel financial collector intentionally sees no review facts. Price
 * activation is deferred until SOURCE has merged the newly acquired bars. */
export function withDocumentedReviewV2Financials(v1:Refresh):Refresh{
 return async request=>{stopped(request.signal);const inputs=await stripVerifiedDocumentedReviews(request.inputs);
  return v1({...request,inputs});};
}

export async function applyDocumentedReviews(inputs:FunnelInput[],facts:DocumentedReviewFact[],cutoff:string,stateOverride?:'REGISTRY_UNAVAILABLE_NOT_APPLIED'){
 const clean=await stripVerifiedDocumentedReviews(inputs),phase=documentedReviewState(clean,cutoff);
 const state=stateOverride??phase.state;
 if(state==='ACTIVE'){
  if(facts.length!==3||await snapshotHash(sorted(facts))!==C.facts_sha256
   ||facts.some(f=>typeof f.available_at!=='string'||compareTime(f.available_at,cutoff)>0))invalid();
  const stock=clean.find(s=>s.symbol==='2330');if(!stock)throw Error('DOCUMENTED_REVIEW_V2_INVALID');
  if(stock.facts.some(f=>['DEMAND','MOAT','VALUATION'].includes(f.kind)))throw Error('DOCUMENTED_REVIEW_V2_CONFLICT');
  stock.facts.push(...structuredClone(facts));
 }
 return {inputs:clean,proof:documentedReviewProof(state,phase.observed_price)};
}

/** Intercept only the final SOURCE transaction, after the price/financial merge.
 * Every other original RPC keeps its exact arguments, signal and response. */
export function withDocumentedReviewV2SourceRpc(v1Rpc:Rpc,clock:()=>string):Rpc{
 return async(name,args,signal)=>{
  if(name!=='daily_stock_ai_intake_v1'||args.p_op!=='SOURCE')return v1Rpc(name,args,signal);
  stopped(signal);let cutoff=clock();if(!validObservationTime(cutoff))invalid();
  const inputs=args.p_inputs as FunnelInput[];const financial=object(args.p_financial_refresh);
  if(financial.schema!=='DAILY_AI_FINANCIAL_REFRESH_V1')invalid();
  let raw:unknown,unavailable=false;
  const controller=new AbortController(),readSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{raw=await Promise.race([
   v1Rpc('load_daily_stock_ai_documented_reviews_v2',{p_source_seal:C.source_seal_sha256,p_cutoff:cutoff},readSignal),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('DOCUMENTED_REVIEW_REGISTRY_TIMEOUT'));},2000);}),
  ]);}
  catch{stopped(signal);unavailable=true;}
  finally{if(timer)clearTimeout(timer);controller.abort();}
  cutoff=clock();if(!validObservationTime(cutoff))invalid();
  const facts=unavailable?[]:await parseDocumentedReviewRegistry(raw,cutoff);stopped(signal);
  const replay=await applyDocumentedReviews(inputs,facts,cutoff,unavailable?'REGISTRY_UNAVAILABLE_NOT_APPLIED':undefined);
  const gaps=object(args.p_symbol_gaps??{}),old=Array.isArray(gaps['2330'])?gaps['2330'] as string[]:[];
  const replacement=replay.proof.state==='ACTIVE'?'OWN_REVIEW_NOT_SEC_VERDICT_BOUND_QUOTE_EXPIRY_ASSUMPTIONS_NOT_FCFE_OR_DIVIDENDS':'DOCUMENTED_REVIEWS_STALE_OR_UNAVAILABLE_NOT_APPLIED_LONG_REQUIRES_REFRESH';
  const kept=old.filter(g=>g!=='SEC_RELEASE_NOT_BOARD_APPROVED_AT_RELEASE_REVISIONS_AND_QUALITATIVE_REVIEW_PENDING'
   &&g!=='DEMAND_MOAT_VALUATION_REVIEW_PENDING'&&!g.startsWith('DOCUMENTED_REVIEWS_')
   &&g!=='OWN_REVIEW_NOT_SEC_VERDICT_BOUND_QUOTE_EXPIRY_ASSUMPTIONS_NOT_FCFE_OR_DIVIDENDS');
  const symbolGaps={...gaps,'2330':[...new Set([...kept,replacement])]};
  if(symbolGaps['2330'].length>20)throw Error('DOCUMENTED_REVIEW_V2_GAP_LIMIT');
  return v1Rpc(name,{...args,p_inputs:replay.inputs,p_symbol_gaps:symbolGaps,
   p_financial_refresh:{...financial,documented_review_replay:replay.proof}},signal);
 };
}
