/** Separate zero-model checkpoint; only pending private staging is reachable. */
import {authorDailyResearch,AUTHOR_VERSION} from '../../../research/daily-ai-zero-paid-author.mjs';
import {canonical,nextEntrySession} from '../../../research/entry-opportunity.ts';
import {validateAnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import {evaluateResearch} from '../../../src/features/vnext/researchFunnel.ts';
import {snapshotHash,hashValid,validObservationTime,compareTime} from '../../../src/features/vnext/contracts.ts';
import {previousMarketTradingDate} from '../_shared/market-session-contract.mjs';
import {validateReviewedAnalysisSnapshot} from '../../../research/reviewed-snapshot-validator.mjs';
import {stockAnalysisRequestRejection,readStockAnalysisRequestText} from './handler.ts';
import {runDailyAiPriceWork} from '../../../research/daily-ai-price-work.mjs';

type Rpc=(name:string,args:Record<string,unknown>,signal?:AbortSignal)=>Promise<unknown>;
type Ports={internalSecret:string;rpc:Rpc;clock:()=>string};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('ZERO_PAID_DRAFT_RESPONSE');return v as Record<string,unknown>;};
const states=['SOURCE_UNAVAILABLE','EXPIRED','BUSY','EXHAUSTED','CACHED','GENERATE'];
const reply=(status:number,value:Record<string,unknown>)=>Response.json({...value,model_calls:0,member_published:false,independent_review_required:true},
 {status,headers:{'Cache-Control':'no-store'}});
export async function handleZeroPaidStockDraft(req:Request,ports:Ports,limits={runMs:25000}){
 const rejected=stockAnalysisRequestRejection(req,ports.internalSecret);if(rejected)return rejected;
 let batchId:string;
 try{const input=object(JSON.parse(await readStockAnalysisRequestText(req)));
  if(Object.keys(input).length!==1||typeof input.draft_batch_id!=='string'||!hashValid(input.draft_batch_id))throw Error('ZERO_PAID_DRAFT_SCOPE');batchId=input.draft_batch_id;
 }catch{return reply(422,{error:'SCOPE_INVALID'});}
 if(!Number.isInteger(limits.runMs)||limits.runMs<1||limits.runMs>25000)return reply(500,{error:'WORKER_CONFIGURATION_INVALID'});
 let stage='PREPARE';let stagedEdition:Record<string,unknown>|null=null;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const stageEdition=async(snapshot:string,expires:unknown,state:'DRAFT_CACHED'|'DRAFT_STAGED')=>{
  if(typeof expires!=='string'||!validObservationTime(expires)||Date.parse(expires)<=Date.parse(ports.clock()))throw Error('ZERO_PAID_DRAFT_EXPIRY');
  stage='EDITION';
  const staged=object(await ports.rpc('stage_offline_reviewed_analysis_edition_v1',{p_snapshot_hash:snapshot,p_expires_at:expires}));
  if(staged.state!=='OFFLINE_EDITION_STAGED_FULL_REVIEW_REQUIRED'||staged.snapshot_hash!==snapshot
   ||typeof staged.edition_id!=='string'||!hashValid(staged.edition_id)||staged.analysis_origin!=='OFFLINE_REVIEWED'
   ||staged.model_jobs!==0||staged.cards!==216||staged.model_calls!==0||staged.reviews_copied!==false||staged.member_published!==false)throw Error('ZERO_PAID_DRAFT_EDITION');
  // Both a newly authored edition and a cached one use the exact stored
  // context. A price failure stays separate from the completed research draft.
  stage='PRICE';
  stagedEdition={state,batch_id:batchId,snapshot_hash:snapshot,edition_id:staged.edition_id,cards:216,owner_preview_ready:true};
  const priceWork=await runDailyAiPriceWork({editionId:staged.edition_id,batchId,rpc:ports.rpc,clock:ports.clock,signal:controller.signal});
  return reply(200,{...stagedEdition,price_work:priceWork});
 };
 const work=async()=>{
  const seed=object(await ports.rpc('prepare_zero_paid_stock_draft_v1',{p_batch_id:batchId},controller.signal));
  if(seed.schema!=='ZERO_PAID_DRAFT_CHECKPOINT_V1'||seed.batch_id!==batchId||seed.author_version!==AUTHOR_VERSION
   ||seed.model_calls!==0||seed.member_published!==false||seed.independent_review_required!==true
   ||typeof seed.state!=='string'||!states.includes(seed.state))throw Error('ZERO_PAID_DRAFT_SEED');
  if(seed.state==='CACHED'){
   if(typeof seed.snapshot_hash!=='string'||!hashValid(seed.snapshot_hash)||seed.cards!==216)throw Error('ZERO_PAID_DRAFT_CACHED');
   return stageEdition(seed.snapshot_hash,seed.expires_at,'DRAFT_CACHED');
  }
  if(seed.state!=='GENERATE')return reply(seed.state==='BUSY'?202:409,{state:seed.state,batch_id:batchId});
  if(typeof seed.payload_text!=='string'||typeof seed.prepared_at!=='string'||!validObservationTime(seed.prepared_at)
   ||typeof seed.expires_at!=='string'||!validObservationTime(seed.expires_at)||compareTime(seed.prepared_at,seed.expires_at)>=0
   ||!Number.isInteger(seed.attempt)||Number(seed.attempt)<1||Number(seed.attempt)>3)throw Error('ZERO_PAID_DRAFT_PREPARATION');
  const now=ports.clock();if(!validObservationTime(now))throw Error('ZERO_PAID_DRAFT_CLOCK');
  stage='AUTHOR';
  const result=object(await authorDailyResearch({batchText:seed.payload_text,prepared_at:seed.prepared_at,expires_at:seed.expires_at,now:Date.parse(now)},
   {canonical,snapshotHash,validateAnalysisPacket,evaluateResearch,previousMarketTradingDate,nextEntrySession,validateSnapshot:validateReviewedAnalysisSnapshot}));
  if(controller.signal.aborted)throw Error('ZERO_PAID_DRAFT_ABORTED');
  const prepared=object(result.prepared_request),args=object(prepared.args),validation=object(result.validation);
  if(prepared.rpc!=='stage_offline_reviewed_analysis_snapshot_v1'||prepared.model_calls!==0||prepared.production_writes!==0||prepared.member_published!==false
   ||validation.batch_id!==batchId||validation.authorizes_publication!==false||validation.independent_review_required!==true
   ||validation.numeric_review_required!==false||typeof args.p_body_text!=='string'||typeof args.p_snapshot_hash!=='string'
   ||!hashValid(args.p_snapshot_hash)||typeof args.p_validator_document_hash!=='string'||!hashValid(args.p_validator_document_hash))throw Error('ZERO_PAID_DRAFT_AUTHOR');
  // Once staging begins, let the bounded immutable write settle. A retry will
  // check its exact snapshot before attempting another author computation.
  stage='SNAPSHOT';
  const stored=object(await ports.rpc('stage_offline_reviewed_analysis_snapshot_v1',args));
  if(stored.state!=='OFFLINE_SNAPSHOT_STAGED_FULL_REVIEW_REQUIRED'||stored.snapshot_hash!==args.p_snapshot_hash||stored.cards!==216
   ||stored.model_generated!==false||stored.model_calls!==0||stored.independent_review_required!==true||stored.member_published!==false)throw Error('ZERO_PAID_DRAFT_STAGE');
  return stageEdition(stored.snapshot_hash as string,seed.expires_at,'DRAFT_STAGED');
 };
 try{return await Promise.race([work(),new Promise<Response>(resolve=>{timer=setTimeout(()=>{
  controller.abort();
  // A price deadline cannot erase the confirmed edition receipt. The price
  // write may already be in flight, so its outcome remains explicitly unknown.
  resolve(stagedEdition?reply(200,{...stagedEdition,price_work:{state:'PRICE_WORK_DEADLINE_REACHED',outcome_unknown:true,
   review_required:true,member_published:false}}):reply(504,{error:'ZERO_PAID_DRAFT_TIMEOUT',batch_id:batchId}));
 },limits.runMs);})]);}
 catch(error){console.warn('ZERO_PAID_DRAFT_PENDING',JSON.stringify({stage,kind:error instanceof ReferenceError?'RUNTIME_REFERENCE_ERROR':'VALIDATION_OR_DATABASE_REJECTED'}));return reply(503,{error:'ZERO_PAID_DRAFT_PENDING',batch_id:batchId});}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}

/** One server-only continuation per successful source response. Member reads
 * cannot reach this path; the target is the same fixed project and isolated draft function. */
export async function dispatchZeroPaidStockDraft(batchId:string,projectUrl:string,internalSecret:string,fetcher:typeof fetch){
 if(!hashValid(batchId)||internalSecret.length<24)throw Error('ZERO_PAID_DISPATCH_SCOPE');
 const url=new URL(projectUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('ZERO_PAID_DISPATCH_URL');
 const target=new URL('/functions/v1/daily-stock-draft-v1',url);
 const response=await fetcher(target,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-vnext-internal':internalSecret},
  body:JSON.stringify({draft_batch_id:batchId}),signal:AbortSignal.timeout(28000)});
 if(!response.ok)throw Error('ZERO_PAID_DISPATCH_PENDING');
 const r=object(await response.json());
 if(r.batch_id!==batchId||!['DRAFT_CACHED','DRAFT_STAGED','BUSY'].includes(String(r.state))||r.model_calls!==0||r.member_published!==false
  ||r.independent_review_required!==true)throw Error('ZERO_PAID_DISPATCH_UNCONFIRMED');
 return r;
}
