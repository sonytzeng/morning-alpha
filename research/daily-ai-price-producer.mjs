/** Server-side price production: calculate -> bind retained evidence -> prepare
 * -> optionally stage the exact body in the existing private price sidecar.
 * No review, source right, Owner approval or member publication is created here.
 * The injected RPC port is the only side-effect boundary; DRY_RUN never uses it.
 */
import {calculateDailyAiPricePlan} from './daily-ai-price-calculation.ts';
import {preparePricePlanCandidate} from './prepare-price-plan-candidate.mjs';
import {validateAnalysisPacket} from './daily-ai-analysis.ts';
import {compareTime,hashValid,HORIZONS,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import {validateDailyAiPricePlanBody} from '../src/features/vnext/dailyAiPricePlan.ts';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw Error('PRICE_PRODUCER_'+code);};
const exact=(value,keys)=>{
 if(!object(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))fail('INPUT_FIELDS');
};
const time=value=>typeof value==='string'&&validObservationTime(value);
const before=(left,right)=>compareTime(left,right)<0;
const atMost=(left,right)=>compareTime(left,right)<=0;
const freeze=value=>{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);
  Object.freeze(value);
 }
 return value;
};
const checkAbort=signal=>{if(signal?.aborted)fail('ABORTED');};
const baseResult=(input,mode)=>({schema:'DAILY_AI_PRICE_PRODUCTION_V1',mode,edition_id:input.edition.id,
 symbol:input.card.symbol,horizon:input.card.horizon,review:null,authorizes_publication:false,
 member_published:false,source_use_approved:false,methodology_approved:false,model_calls:0});
const ineligible=(input,mode,reason,field=null)=>freeze({...baseResult(input,mode),status:'INELIGIBLE',
 reason,field,calculation:null,candidate:null,review_request:null,stage_request:null,
 stage_attempted:false,staged:false});

function scope(input,now){
 exact(input,['edition','card','packet','calculation_input']);
 const {edition,card,packet,calculation_input:calculation}=input,current=new Date(now).toISOString();
 if(!object(edition)||!object(card)||!object(packet)||!object(calculation)
  ||typeof edition.id!=='string'||!hashValid(edition.id)||typeof card.symbol!=='string'||!/^\d{4,6}$/.test(card.symbol)
  ||typeof card.horizon!=='string'||!own(HORIZONS,card.horizon)||!['WATCH','WAIT','AVOID','INSUFFICIENT'].includes(card.status)
  ||typeof card.company!=='string'||!card.company.trim())fail('IDENTITY');
 if(!time(edition.evidence_cutoff)||!time(edition.prepared_at)||!time(edition.expires_at)
  ||!atMost(edition.evidence_cutoff,edition.prepared_at)||!atMost(edition.prepared_at,current)
  ||!before(current,edition.expires_at))fail('EDITION_TIME');
 if(!Array.isArray(packet.evidence)||!packet.evidence.length||packet.evidence.length>100)fail('PACKET');
 validateAnalysisPacket(packet);
 if(packet.symbol!==card.symbol||packet.company!==card.company||!time(packet.cutoff)
  ||compareTime(packet.cutoff,edition.evidence_cutoff)!==0
  ||typeof packet.data_through!=='string'||packet.data_through!==edition.data_through
  ||calculation.symbol!==card.symbol||calculation.horizon!==card.horizon
  ||!time(calculation.cutoff)||compareTime(calculation.cutoff,packet.cutoff)!==0
  ||calculation.data_through!==packet.data_through||calculation.currency!=='TWD')fail('IDENTITY');
 if(!time(calculation.as_of)||!time(calculation.expires_at)
  ||!atMost(edition.evidence_cutoff,calculation.as_of)||!atMost(calculation.as_of,current)
  ||!before(current,calculation.expires_at)||!atMost(calculation.expires_at,edition.expires_at))fail('CALCULATION_TIME');
 if(!Array.isArray(calculation.evidence)||!calculation.evidence.length||calculation.evidence.length>100)fail('EVIDENCE');
 // Numeric evidence must belong to this security. A market-wide observation
 // can supply context, but cannot stand in for the company's price/financials.
 for(const evidence of calculation.evidence){
  if(!object(evidence)||typeof evidence.id!=='string'
   ||['PRICE','FINANCIAL'].includes(evidence.kind)&&evidence.symbol!==card.symbol)fail('EVIDENCE_IDENTITY');
 }
 if(new Set(calculation.evidence.map(value=>value.id)).size!==calculation.evidence.length)fail('EVIDENCE_DUPLICATE');
}

async function bindEvidence(input){
 const original=new Map(input.packet.evidence.map(evidence=>[evidence.id,evidence]));
 const hashes=new Map();
 for(const evidence of input.calculation_input.evidence){
  const retained=original.get(evidence.id);
  if(!retained)fail('EVIDENCE_MISSING');
  const [given,expected]=await Promise.all([snapshotHash(evidence),snapshotHash(retained)]);
  if(given!==expected)fail('EVIDENCE_MISMATCH');
  hashes.set(evidence.id,expected);
 }
 return hashes;
}

async function validateCalculation(calculation,input,evidenceHashes){
 const {calculation_hash:calculationHash,...payload}=calculation;
 if(calculation.schema!=='DAILY_AI_PRICE_CALCULATION_V1'||calculation.status!=='CALCULATED_REVIEW_REQUIRED'
  ||calculation.symbol!==input.card.symbol||calculation.horizon!==input.card.horizon
  ||calculation.cutoff!==input.calculation_input.cutoff||calculation.data_through!==input.packet.data_through
  ||calculation.as_of!==input.calculation_input.as_of||calculation.expires_at!==input.calculation_input.expires_at
  ||calculation.currency!=='TWD'||calculation.method!==input.calculation_input.method_id
  ||calculation.method_id!==calculation.method||calculation.review!==null||calculation.buy_ready!==false
  ||calculation.research_only!==true||calculation.production_eligible!==false
  ||!hashValid(calculationHash)||!hashValid(calculation.input_hash)||!hashValid(calculation.assumption_hash)
  ||calculation.input_hash!==await snapshotHash(input.calculation_input)||calculationHash!==await snapshotHash(payload))fail('CALCULATION_BINDING');
 if(!Array.isArray(calculation.evidence_ids)||!calculation.evidence_ids.length
  ||!Array.isArray(calculation.evidence_bindings)
  ||new Set(calculation.evidence_bindings.map(item=>item.id)).size!==calculation.evidence_bindings.length)fail('CALCULATION_EVIDENCE');
 const bindings=new Map(calculation.evidence_bindings.map(item=>[item.id,item.evidence_hash]));
 for(const id of calculation.evidence_ids){
  if(!evidenceHashes.has(id)||bindings.get(id)!==evidenceHashes.get(id))fail('CALCULATION_EVIDENCE');
 }
 for(const [id,hash] of bindings)if(!evidenceHashes.has(id)||hash!==evidenceHashes.get(id))fail('CALCULATION_EVIDENCE');
}

/** A timeout/cancellation after dispatch cannot prove that Postgres rolled back.
 * Preserve the exact hash/request for reconciliation, and never retry here. */
async function dispatch(rpc,request,{signal,timeoutMs}){
 const controller=new AbortController();let timer,abort;
 try{
  const cancellation=new Promise((_,reject)=>{
   abort=()=>{controller.abort();reject(Error('ABORTED'));};
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
  const response=await Promise.race([
   Promise.resolve().then(()=>{
    if(controller.signal.aborted)throw Error('ABORTED');
    return rpc(request.name,structuredClone(request.args),{signal:controller.signal});
   }),cancellation,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},timeoutMs);}),
  ]);
  if(!object(response))return {confirmed:false,reason:'STAGE_RESPONSE_INVALID'};
  if(own(response,'error')&&response.error!==null&&response.error!==undefined)return {confirmed:false,reason:'STAGE_REJECTED'};
  const receipt=own(response,'data')?response.data:response;
  const keys=['schema','plan_hash','review_required','member_published'];
  if(!object(receipt)||Object.keys(receipt).length!==keys.length||Object.keys(receipt).some(key=>!keys.includes(key))
   ||receipt.schema!=='DAILY_AI_PRICE_PLAN_STAGED_V1'||receipt.plan_hash!==request.args.p_plan_hash
   ||receipt.review_required!==true||receipt.member_published!==false)return {confirmed:false,reason:'STAGE_RESPONSE_INVALID'};
  return {confirmed:true,receipt:structuredClone(receipt)};
 }catch(error){
  return {confirmed:false,reason:error?.message==='TIMEOUT'?'STAGE_TIMEOUT':error?.message==='ABORTED'?'STAGE_ABORTED':'STAGE_TRANSPORT_ERROR'};
 }finally{
  clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);controller.abort();
 }
}

/** Calculate from an explicit method/input packet; never accept a prefilled
 * price plan or PASS review. STAGE only registers an unreviewed private plan.
 * `rpc` is a server-owned port with Supabase's {data,error} response (a direct
 * decoded RPC receipt is also accepted). The port must honor options.signal.
 */
export async function produceDailyAiPricePlan(input,options={}){
 if(!object(options)||Object.keys(options).some(key=>!['mode','rpc','now','signal','timeoutMs'].includes(key)))fail('OPTIONS');
 const {mode='DRY_RUN',rpc,signal,timeoutMs=10000}=options,now=options.now??Date.now(),wallStarted=Date.now();
 if(!['DRY_RUN','STAGE'].includes(mode)||!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime())
  ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000
  ||mode==='STAGE'&&typeof rpc!=='function'
  ||signal!==undefined&&(!object(signal)||typeof signal.addEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('OPTIONS');
 checkAbort(signal);
 // Own all preimages before the first asynchronous operation; callers may
 // reuse their packet objects for other stocks while this production awaits.
 const owned=structuredClone(input);scope(owned,now);
 const evidenceHashes=await bindEvidence(owned);checkAbort(signal);
 if(!['WATCH','WAIT'].includes(owned.card.status))return ineligible(owned,mode,'CARD_'+owned.card.status);
 let calculation;
 try{calculation=await calculateDailyAiPricePlan(owned.calculation_input,now);}
 catch(error){
  if(error?.code==='PRICE_CALCULATION_MISSING_INPUT')return ineligible(owned,mode,error.code,
   typeof error.field==='string'?error.field:null);
  throw error;
 }
 checkAbort(signal);await validateCalculation(calculation,owned,evidenceHashes);
 const binding='計算紀錄 SHA-256：'+calculation.calculation_hash;
 const body={schema:'DAILY_AI_PRICE_PLAN_V1',edition_id:owned.edition.id,symbol:calculation.symbol,horizon:calculation.horizon,
  status:'VERIFIED',currency:'TWD',method:calculation.method,basis:calculation.basis+'\n'+binding,
  entry_range:calculation.entry_range,wait_above:calculation.wait_above,stop_kind:calculation.stop_kind,stop:calculation.stop,
  stop_evidence_ids:calculation.stop_evidence_ids,invalidation:calculation.invalidation,evidence_ids:calculation.evidence_ids,
  as_of:calculation.as_of,expires_at:calculation.expires_at,buy_ready:false};
 const methodNote={...calculation.method_note,derivation:calculation.method_note.derivation+'\n'+binding
  +'\n輸入 SHA-256：'+calculation.input_hash+'\n假設 SHA-256：'+calculation.assumption_hash};
 const candidate=await preparePricePlanCandidate({edition:owned.edition,card:owned.card,packet:owned.packet,
  body,method_note:methodNote},now);
 if(new TextEncoder().encode(candidate.body_text).length>16000)fail('SQL_BODY_SIZE');
 const reviewRequest={schema:'DAILY_AI_PRICE_REVIEW_REQUEST_V1',status:'PENDING',edition_id:owned.edition.id,
  symbol:owned.card.symbol,horizon:owned.card.horizon,plan_hash:candidate.plan_hash,
  calculation_hash:calculation.calculation_hash,input_hash:calculation.input_hash,assumption_hash:calculation.assumption_hash,
  packet_hash:candidate.packet_hash,card_hash:candidate.card_hash,method_document_hash:candidate.method_note_hash,
  evidence_ids:[...calculation.evidence_ids],prepared_at:candidate.prepared_at,expires_at:body.expires_at,
  required_reviews:['QUALITY','TIME','SOURCE_USE','METHODOLOGY'],review:null,source_use_approved:false,methodology_approved:false};
 const stageRequest={name:'stage_daily_ai_price_plan_v1',args:{p_body_text:candidate.body_text,p_plan_hash:candidate.plan_hash}};
 const result={...baseResult(owned,mode),calculation,candidate,review_request:reviewRequest,stage_request:stageRequest};
 checkAbort(signal);
 if(mode==='DRY_RUN')return freeze({...result,status:'CALCULATED_REVIEW_REQUIRED',stage_attempted:false,staged:false});
 // Recheck elapsed time immediately before dispatch. An expired input must not
 // be staged just because the initial calculation used an earlier wall clock.
 const effectiveNow=now+Math.max(0,Date.now()-wallStarted);
 validateDailyAiPricePlanBody(body,{edition:owned.edition,card:owned.card,evidence:owned.packet.evidence},effectiveNow);
 checkAbort(signal);
 const staged=await dispatch(rpc,stageRequest,{signal,timeoutMs});
 if(!staged.confirmed)return freeze({...result,status:'STAGE_OUTCOME_UNKNOWN',reason:staged.reason,stage_attempted:true,staged:false});
 return freeze({...result,status:'STAGED_REVIEW_REQUIRED',stage_attempted:true,staged:true,stage_receipt:staged.receipt});
}
