/** Source-only release adapter: retained issuer Actual for a separate Owner
 * study. No market-flow acquisition, formal admission or Member input change. */
import type {DecisionIdentity,EvidenceData,Row} from './decision-v1-data.ts';
import type {buildRecommendationProof} from './recommendation-stock-evidence.ts';
import {persistedRecommendationReaderInput} from './recommendation-stock-evidence.ts';
import {evaluationPhase} from './recommendation-phase.ts';
import {createRetainedQuarterActuals,withRetainedQuarterActuals,type OwnerQuarterActualsView} from './recommendation-quarter-actuals-candidate.ts';

export const OWNER_QUARTER_RECEIPT_CONTRACT='RECOMMENDATION_OWNER_QUARTER_RECEIPT_V1';
type Proof=Awaited<ReturnType<typeof buildRecommendationProof>>;
type Capsule=NonNullable<Awaited<ReturnType<typeof createRetainedQuarterActuals>>>;
type Receipt={contract:typeof OWNER_QUARTER_RECEIPT_CONTRACT;evidence_cutoff:string;quarter_actuals:Capsule;
 formal_evaluator_changed:false;member_publication_approved:false};
type CandidateProof=Omit<Proof,'acquisition'>&{acquisition:Proof['acquisition']&{foundation_candidate?:Receipt}};
const object=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const instant=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;

/** Attach only while constructing a fresh Producer proof for a new natural
 * Report. Existing cache bytes, formal proof and persisted Reports are never
 * changed here. Optional retained-source refusal cannot break formal output. */
export async function attachOwnerQuarterCapsule(proof:Proof,identity:DecisionIdentity,evidenceCutoff:string):Promise<CandidateProof>{
 try{
  if(evaluationPhase(identity.generated_at)!=='PREMARKET'
   ||proof.acquisition.contract!=='RECOMMENDATION_STOCK_EVIDENCE_V1'
   ||proof.acquisition.business_date!==identity.report_date||proof.acquisition.cutoff!==identity.generated_at
   ||proof.decision.report_date!==identity.report_date||proof.decision.revision_id!==identity.revision_id
   ||proof.decision.generated_at!==identity.generated_at||Object.hasOwn(proof.acquisition,'foundation_candidate'))return proof;
  const capsule=await createRetainedQuarterActuals(identity,evidenceCutoff);
  if(!capsule)return proof;
  return {...proof,acquisition:{...proof.acquisition,foundation_candidate:{contract:OWNER_QUARTER_RECEIPT_CONTRACT,
   evidence_cutoff:evidenceCutoff,quarter_actuals:capsule,formal_evaluator_changed:false,member_publication_approved:false}}};
 }catch{return proof;}
}

/** A missing saved capsule remains missing. The Owner Reader consumes an
 * indivisible Producer/Report binding; it never constructs or refreshes one. */
export async function persistedOwnerQuarterInput(data:EvidenceData,identity:DecisionIdentity,ai:Row,
 access:{ownerAuthorized:boolean}={ownerAuthorized:false}):Promise<{data:EvidenceData;priorWatch:string[]|null;quarterActuals?:OwnerQuarterActualsView}>{
 const base=await persistedRecommendationReaderInput(data,identity,ai);
 if(access.ownerAuthorized!==true||base.data.failures.length>data.failures.length)return base;
 const capture=object(ai.recommendation_stock_evidence),value=capture.foundation_candidate;
 if(value===undefined)return base;
 const fail=(reason:string)=>({...base,data:{...base.data,failures:[...base.data.failures,'OWNER_QUARTER_'+reason]}});
 if(evaluationPhase(identity.generated_at)!=='PREMARKET')return fail('READER_PHASE_MISMATCH');
 const saved=object(value),keys=['contract','evidence_cutoff','quarter_actuals','formal_evaluator_changed','member_publication_approved'];
 if(JSON.stringify(Object.keys(saved).sort())!==JSON.stringify(keys.sort())||saved.contract!==OWNER_QUARTER_RECEIPT_CONTRACT
  ||saved.formal_evaluator_changed!==false||saved.member_publication_approved!==false)return fail('RECEIPT_INVALID');
 const evidenceCutoff=instant(saved.evidence_cutoff),producerCutoff=instant(capture.cutoff);
 if(!Number.isFinite(evidenceCutoff)||!Number.isFinite(producerCutoff)||evidenceCutoff>producerCutoff)return fail('CUTOFF_INVALID');
 if(saved.quarter_actuals===undefined)return fail('CAPSULE_MISSING');
 const actuals=await withRetainedQuarterActuals(base.data,{report_date:identity.report_date,
  producer_revision_id:String(ai.correlation_id),producer_cutoff:String(capture.cutoff),evidence_cutoff:String(saved.evidence_cutoff)},saved.quarter_actuals);
 return {...base,...actuals};
}
