/** Daily price work uses the stored edition and original batch. A separate
 * immutable input supplies explicit assumptions; no request or model invents
 * them. Calculation/audit staging never supplies a review or publication. */
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {produceDailyAiPricePlan} from './daily-ai-price-producer.mjs';
import {bindDailyAiPriceProfile} from './daily-ai-price-profile.ts';
import {calculateDailyAiPricePlan} from './daily-ai-price-calculation.ts';
import {prepareDailyAiLongRationale} from './daily-ai-long-rationale.ts';
import {proposeDailyAiValuationPolicies} from './daily-ai-valuation-policy-proposal.ts';
import {buildDailyAiActualPriceInput} from './daily-ai-financial-inputs.ts';
import {validateAnalysisPacket} from './daily-ai-analysis.ts';
import {canonical} from './entry-opportunity.ts';
import {compareTime,hashValid,HORIZONS,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';

const sha=text=>createHash('sha256').update(text).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw Error('PRICE_WORK_'+code);};
const stopped=signal=>{if(signal?.aborted)fail('ABORTED');};
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const unwrap=value=>{
 if(!object(value)||own(value,'error')&&value.error!==null&&value.error!==undefined)fail('DATABASE_RESPONSE');
 return own(value,'data')?value.data:value;
};
const safeCode=error=>typeof error?.code==='string'&&/^PRICE_[A-Z0-9_]+$/.test(error.code)?error.code:
 typeof error?.message==='string'&&/^(PRICE_|AI_)[A-Z0-9_]+$/.test(error.message)?error.message:'PRICE_CALCULATION_REJECTED';
const safeField=error=>typeof error?.field==='string'&&error.field.length<=200?error.field:null;
const summary=(work,rows,state)=>({schema:'DAILY_AI_PRICE_WORK_RESULT_V1',state,edition_id:work.edition.id,batch_id:work.batch_id,
 rows,counts:{cards:rows.length,calculated:rows.filter(r=>r.plan_hash).length,
  staged:rows.filter(r=>r.state==='STAGED_REVIEW_REQUIRED').length,
  missing_inputs:rows.filter(r=>r.state==='METHOD_INPUT_REQUIRED').length,
  ineligible:rows.filter(r=>r.state==='INELIGIBLE').length,
  invalid:rows.filter(r=>r.state==='INVALID_INPUT').length},
 review_required:true,member_published:false,model_calls:0});

function validateWork(value,now,signal){
 stopped(signal);const work=structuredClone(value);
 if(!Number.isFinite(now)||!object(work)||work.schema!=='DAILY_AI_PRICE_WORK_V1'
  ||!hashValid(work.batch_id)||!object(work.edition)||!hashValid(work.edition.id)
  ||work.member_published!==false||work.review_required!==true
  ||work.work_key!==undefined&&!hashValid(work.work_key))fail('CONTEXT');
 if(Buffer.byteLength(JSON.stringify(work))>64_000_000)fail('CONTEXT_SIZE');
 const e=work.edition,current=new Date(now).toISOString();
 for(const key of ['evidence_cutoff','prepared_at','expires_at'])if(!validObservationTime(e[key]))fail('EDITION_TIME');
 if(compareTime(e.evidence_cutoff,e.prepared_at)>0||compareTime(e.prepared_at,current)>0||compareTime(current,e.expires_at)>=0)fail('EDITION_EXPIRED');
 if(!Array.isArray(work.packets)||work.packets.length!==72||!Array.isArray(work.cards)||work.cards.length!==216
  ||!Array.isArray(work.inputs)||work.inputs.length>216
  ||work.profiles!==undefined&&(!Array.isArray(work.profiles)||work.profiles.length>216))fail('UNIVERSE');
 const packets=new Map(),cards=new Map(),inputs=new Map(),profiles=new Map();
 for(const packet of work.packets){
  validateAnalysisPacket(packet);
  if(packets.has(packet.symbol)||compareTime(packet.cutoff,e.evidence_cutoff)!==0||packet.data_through!==e.data_through)fail('PACKET_IDENTITY');
  packets.set(packet.symbol,packet);
 }
 for(const card of work.cards){
  if(!object(card)||!packets.has(card.symbol)||!Object.hasOwn(HORIZONS,card.horizon)
   ||packets.get(card.symbol).company!==card.company||!['WATCH','WAIT','AVOID','INSUFFICIENT'].includes(card.status))fail('CARD_IDENTITY');
  const key=card.symbol+':'+card.horizon;if(cards.has(key))fail('CARD_DUPLICATE');cards.set(key,card);
 }
 for(const row of work.inputs){
  if(!object(row)||!Number.isSafeInteger(row.registration_id)||row.registration_id<1||!hashValid(row.input_hash)
   ||typeof row.input_text!=='string'||Buffer.byteLength(row.input_text)>1_500_000||sha(row.input_text)!==row.input_hash)fail('INPUT_HASH');
  const key=row.symbol+':'+row.horizon;
  if(!cards.has(key)||inputs.has(key))fail('INPUT_IDENTITY');
  inputs.set(key,row);
 }
 for(const row of work.profiles??[]){
  if(!object(row)||!Number.isSafeInteger(row.registration_id)||row.registration_id<1||!hashValid(row.profile_hash)
   ||typeof row.profile_text!=='string'||Buffer.byteLength(row.profile_text)>1_500_000||sha(row.profile_text)!==row.profile_hash)fail('PROFILE_HASH');
  const key=row.symbol+':'+row.horizon;
  if(!cards.has(key)||profiles.has(key))fail('PROFILE_IDENTITY');
  profiles.set(key,row);
 }
 return {work,e,packets,cards,inputs,profiles};
}

/** Create today's explicit inputs from finite-lived registered methods. Only
 * quote/bar slots change; the binder preserves forecasts and source versions.
 * This pure preparation does not pretend the inputs were already registered. */
export async function prepareDailyAiProfileInputs(value,{now=Date.now(),signal}={}){
 const {work,e,packets,cards,inputs,profiles}=validateWork(value,now,signal),rows=[],items=[],proposals=new Map();
 for(const [key,card] of cards){
  stopped(signal);const stored=inputs.get(key),profile=profiles.get(key);
  const row={symbol:card.symbol,horizon:card.horizon,profile_hash:profile?.profile_hash??null};
  // A missing long valuation review must not prevent creating the calculation
  // that its first review needs. This only registers an explicit research
  // input. The price-plan branch below keeps the original eligibility gate.
  if(card.status==='AVOID'||card.status==='INSUFFICIENT'&&card.horizon!=='LONG'){
   rows.push({...row,state:'INELIGIBLE',reason:'RESEARCH_CARD_'+card.status});continue;
  }
  // A registered current-batch input always wins. Revisions use the explicit
  // single-input registration, never a daily worker's implicit overwrite.
  if(stored){rows.push({...row,state:'INPUT_ALREADY_REGISTERED',input_hash:stored.input_hash});continue;}
  if(!profile){
   // The versioned 2330 proposal is an explicit analyst draft, with every
   // number and limitation exposed. It initializes review material only when
   // no input/profile exists; it never replaces an expired or revised method.
   if(card.symbol==='2330'&&['MEDIUM','LONG'].includes(card.horizon))try{
    let proposal=proposals.get(card.symbol);
    if(!proposal){proposal=await proposeDailyAiValuationPolicies({packet:packets.get(card.symbol),formed_at:new Date(now).toISOString(),now});proposals.set(card.symbol,proposal);}
    if(proposal.state==='FINANCIAL_INPUT_REQUIRED'){
     const missing=proposal.actuals.missing.MEDIUM.length?proposal.actuals.missing.MEDIUM:[{
      code:'ACTUAL_EPS_SUM_NOT_POSITIVE',field:card.horizon+'.reported_eps_sum',
      detail:'A nonpositive reported EPS sum remains an actual observation but cannot serve as the positive historical base required by this valuation method.'}];
     rows.push({...row,state:'METHOD_UPDATE_REQUIRED',reason:missing[0].code,missing});continue;
    }
    const policy=proposal.policies.find(p=>p.horizon===card.horizon);
    if(policy){
     const built=await buildDailyAiActualPriceInput({packet:packets.get(card.symbol),as_of:new Date(now).toISOString(),expires_at:e.expires_at,policy});
     if(built.status==='INPUT_READY_REVIEW_REQUIRED'){
      const input_text=canonical(built.calculation_input),input_hash=sha(input_text);
      if(Buffer.byteLength(input_text)>1_500_000)fail('INPUT_SIZE');
      items.push({input_text,input_hash});rows.push({...row,state:'INPUT_PREPARED_REVIEW_REQUIRED',input_hash,
       parameter_source:'EXPLICIT_INTERNAL_RESEARCH_PROPOSAL',proposal_version:proposal.version,proposal_hash:proposal.proposal_hash,
       policy_hash:built.policy_hash,methodology_approved:false});continue;
     }
     rows.push({...row,state:'METHOD_UPDATE_REQUIRED',reason:built.missing[0]?.code??'PROPOSAL_ACTUAL_INPUTS_REQUIRED',missing:built.missing});continue;
    }
   }catch(error){stopped(signal);rows.push({...row,state:'INVALID_PROFILE',reason:safeCode(error),field:safeField(error)});continue;}
   rows.push({...row,state:'METHOD_PROFILE_REQUIRED',reason:'EXPLICIT_METHOD_PROFILE_REQUIRED'});continue;
  }
  try{
   const parsed=JSON.parse(profile.profile_text);
   if(await snapshotHash(parsed)!==profile.profile_hash||parsed.symbol!==card.symbol||parsed.horizon!==card.horizon)fail('PROFILE_CANONICAL_IDENTITY');
   const binding=await bindDailyAiPriceProfile({profile:parsed,packet:packets.get(card.symbol),edition:e,now});
   if(binding.profile_hash!==profile.profile_hash||binding.member_published!==false||binding.review_required!==true)fail('PROFILE_BINDING');
   if(binding.status==='METHOD_UPDATE_REQUIRED'){
    rows.push({...row,state:'METHOD_UPDATE_REQUIRED',reason:binding.missing[0]?.code??'METHOD_UPDATE_REQUIRED',missing:binding.missing});continue;
   }
   if(binding.status!=='BOUND_REVIEW_REQUIRED'||!binding.calculation_input)fail('PROFILE_BINDING');
   const input_text=canonical(binding.calculation_input),input_hash=sha(input_text);
   if(Buffer.byteLength(input_text)>1_500_000)fail('INPUT_SIZE');
   items.push({input_text,input_hash});
   rows.push({...row,state:'INPUT_PREPARED_REVIEW_REQUIRED',input_hash,binding:binding.binding});
  }catch(error){stopped(signal);rows.push({...row,state:'INVALID_PROFILE',reason:safeCode(error),field:safeField(error)});}
 }
 stopped(signal);
 return {schema:'DAILY_AI_PRICE_PROFILE_INPUTS_PREPARED_V1',batch_id:work.batch_id,edition_id:e.id,rows,
  counts:{profiles:profiles.size,inputs_prepared:items.length,proposal_inputs:rows.filter(r=>r.parameter_source==='EXPLICIT_INTERNAL_RESEARCH_PROPOSAL').length,
   already_registered:rows.filter(r=>r.state==='INPUT_ALREADY_REGISTERED').length,
   method_updates:rows.filter(r=>r.state==='METHOD_UPDATE_REQUIRED').length,missing_profiles:rows.filter(r=>r.state==='METHOD_PROFILE_REQUIRED').length,
   invalid_profiles:rows.filter(r=>r.state==='INVALID_PROFILE').length},
  registration_request:{name:'stage_daily_ai_price_inputs_batch_v1',args:{p_batch_id:work.batch_id,p_items:items}},
  review_required:true,member_published:false};
}

/** Initial LONG valuation review is independent of a publishable price plan.
 * Only already registered inputs are evaluated; no parameters or qualitative
 * verdicts are invented, and an INSUFFICIENT card remains INSUFFICIENT. */
export async function prepareDailyAiLongReviewWork(value,{now=Date.now(),signal}={}){
 const {work,e,packets,cards,inputs}=validateWork(value,now,signal),rows=[],items=[];
 for(const [key,card] of cards){
  if(card.horizon!=='LONG'||card.status!=='INSUFFICIENT')continue;
  stopped(signal);const stored=inputs.get(key);
  if(!stored){rows.push({symbol:card.symbol,horizon:'LONG',state:'METHOD_INPUT_REQUIRED',input_hash:null});continue;}
  const row={symbol:card.symbol,horizon:'LONG',input_hash:stored.input_hash};
  try{
   const input=JSON.parse(stored.input_text),packet=packets.get(card.symbol);
   if(await snapshotHash(input)!==stored.input_hash||input.symbol!==card.symbol||input.horizon!=='LONG'
    ||input.cutoff!==packet.cutoff||input.data_through!==packet.data_through
    ||await snapshotHash(input.evidence)!==await snapshotHash(packet.evidence))fail('LONG_PREPARATION_INPUT');
   const expiresAt=compareTime(input.expires_at,e.expires_at)<0?input.expires_at:e.expires_at;
   const calculation=await calculateDailyAiPricePlan(input,now);
   const preparation=await prepareDailyAiLongRationale({packet,calculation_input:input,as_of:input.as_of,expires_at:expiresAt,now});
   if(preparation.valuation_calculation?.calculation_hash!==calculation.calculation_hash
    ||preparation.valuation_calculation?.input_hash!==stored.input_hash||preparation.selection_qualified!==false
    ||preparation.review!==null||preparation.member_published!==false)fail('LONG_PREPARATION_BINDING');
   const {calculation_hash,...calculationBody}=calculation,{preparation_hash,...preparationBody}=preparation;
   const item={input_hash:stored.input_hash,calculation_hash,calculation_text:canonical(calculationBody),
    preparation_hash,preparation_text:canonical(preparationBody)};
   if(sha(item.calculation_text)!==calculation_hash||sha(item.preparation_text)!==preparation_hash)fail('LONG_PREPARATION_HASH');
   items.push(item);rows.push({...row,state:'PREPARED_REVIEW_REQUIRED',calculation_hash,preparation_hash,
    missing:preparation.missing.map(m=>({code:m.code,field:m.field}))});
  }catch(error){stopped(signal);rows.push({...row,state:'INVALID_INPUT',reason:safeCode(error),field:safeField(error)});}
 }
 return {summary:{schema:'DAILY_AI_LONG_REVIEW_WORK_V1',rows,
  counts:{requested:rows.length,prepared:items.length,missing_inputs:rows.filter(r=>r.state==='METHOD_INPUT_REQUIRED').length,
   invalid:rows.filter(r=>r.state==='INVALID_INPUT').length},state:items.length?'PREPARED_REVIEW_REQUIRED':'NO_PREPARATIONS_REQUIRED',
  review_required:true,selection_qualified:false,member_published:false},
  stage_request:{name:'stage_daily_ai_long_preparations_batch_v1',args:{p_edition_id:e.id,p_items:items}}};
}

/** Offline entry used by the daily worker and the explicit local CLI. Rows
 * fail independently; invalid identities/context fail before any stage call. */
export async function prepareDailyAiPriceWork(value,{now=Date.now(),signal}={}){
 const {work,e,packets,cards,inputs}=validateWork(value,now,signal);
 const rows=[],items=[],reviewPackets=[];
 for(const [key,card] of cards){
  stopped(signal);const stored=inputs.get(key),row={symbol:card.symbol,horizon:card.horizon,input_hash:stored?.input_hash??null};
  if(card.status==='INSUFFICIENT'||card.status==='AVOID'){
   rows.push({...row,state:'INELIGIBLE',reason:'RESEARCH_CARD_'+card.status});continue;
  }
  if(!stored){rows.push({...row,state:'METHOD_INPUT_REQUIRED',reason:'EXPLICIT_METHOD_PARAMETERS_AND_EVIDENCE_REQUIRED'});continue;}
  try{
   const input=JSON.parse(stored.input_text);
   if(await snapshotHash(input)!==stored.input_hash)fail('INPUT_CANONICAL_HASH');
   const result=await produceDailyAiPricePlan({edition:e,card,packet:packets.get(card.symbol),calculation_input:input},{mode:'DRY_RUN',now,signal});
   if(result.status==='INELIGIBLE'){rows.push({...row,state:'INELIGIBLE',reason:result.reason,field:result.field});continue;}
   if(result.status!=='CALCULATED_REVIEW_REQUIRED'||result.member_published!==false)fail('PRODUCER_RESULT');
   const {calculation_hash,...calculationBody}=result.calculation;
   const item={input_hash:stored.input_hash,body_text:result.candidate.body_text,plan_hash:result.candidate.plan_hash,
    calculation_text:canonical(calculationBody),calculation_hash,
    method_note_text:canonical(result.candidate.method_note),method_note_hash:result.candidate.method_note_hash,
    review_request_text:canonical(result.review_request)};
   if(sha(item.calculation_text)!==item.calculation_hash||sha(item.method_note_text)!==item.method_note_hash)fail('AUDIT_HASH');
   items.push(item);reviewPackets.push(result);
   rows.push({...row,state:'CALCULATED_REVIEW_REQUIRED',plan_hash:item.plan_hash,calculation_hash:item.calculation_hash});
  }catch(error){
   stopped(signal);rows.push({...row,state:'INVALID_INPUT',reason:safeCode(error),field:safeField(error)});
  }
 }
 stopped(signal);
 return {summary:summary(work,rows,items.length?'CALCULATED_REVIEW_REQUIRED':work.inputs.length?'NO_ELIGIBLE_PRICE_PLANS':'METHOD_INPUTS_REQUIRED'),
  stage_request:{name:'stage_daily_ai_price_work_batch_v1',args:{p_edition_id:e.id,p_items:items}},review_packets:reviewPackets};
}

async function call(rpc,name,args,signal,timeoutMs){
 const controller=new AbortController();let timer,abort;
 try{
  const cancellation=new Promise((_,reject)=>{
   abort=()=>{controller.abort();reject(Error('PRICE_WORK_ABORTED'));};
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
  return await Promise.race([Promise.resolve().then(()=>{stopped(controller.signal);return rpc(name,args,controller.signal);}),cancellation,
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('PRICE_WORK_TIMEOUT'));},timeoutMs);})]);
 }finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);controller.abort();}
}

/** Called after the actual edition RPC in both GENERATE and CACHED paths.
 * Missing daily inputs can be bound from registered method profiles and saved
 * by one atomic input call. A fresh read confirms those exact immutable inputs
 * before one atomic price/audit call. No per-stock HTTP loop or review call. */
export async function runDailyAiPriceWork({editionId,batchId,rpc,clock,signal,timeoutMs=8000}){
 if(!hashValid(editionId)||!hashValid(batchId)||typeof rpc!=='function'||typeof clock!=='function'
  ||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>8000)fail('PORTS');
 const unavailable=(reason)=>({schema:'DAILY_AI_PRICE_WORK_RESULT_V1',state:'PRICE_WORKFLOW_UNAVAILABLE',edition_id:editionId,batch_id:batchId,
  reason,stage_attempted:false,review_required:true,member_published:false,model_calls:0});
 let lastWorkKey=null;
 const readWork=async()=>{
  const work=unwrap(await call(rpc,'get_daily_ai_price_work_v1',{p_edition_id:editionId},signal,timeoutMs));
  if(!object(work)||work.edition?.id!==editionId||work.batch_id!==batchId)fail('CONTEXT_IDENTITY');
  if(work.work_key!==undefined&&!hashValid(work.work_key))fail('WORK_KEY');
  lastWorkKey=work.work_key??null;
  return work;
 };
 // A completed draft alone must not stop the existing scheduler from resuming
 // its unfinished price work. Record only a confirmed terminal result bound
 // to the latest DB work key; uncertainty never becomes a completion receipt.
 const finish=async(result)=>{
  if(['STAGE_OUTCOME_UNKNOWN','STAGE_DEFERRED','PAYLOAD_LIMIT'].includes(result.long_review_preparations?.state))
   return {...result,completion:{state:'DEFERRED',attempted:false,reason:'LONG_REVIEW_PREPARATION_UNCONFIRMED'}};
  if(lastWorkKey===null)return {...result,completion:{state:'CHECKPOINT_NOT_AVAILABLE',attempted:false}};
  const states=['METHOD_INPUTS_REQUIRED','NO_ELIGIBLE_PRICE_PLANS','PRICES_STAGED_REVIEW_REQUIRED','PARTIAL_PRICES_STAGED_REVIEW_REQUIRED'];
  if(!states.includes(result.state))return result;
  let attempted=false;
  try{
   stopped(signal);
   const resultText=canonical(JSON.parse(JSON.stringify(result))),resultHash=sha(resultText);
   if(Buffer.byteLength(resultText)>1_000_000)fail('COMPLETION_SIZE');
   attempted=true;
   const receipt=unwrap(await call(rpc,'finish_daily_ai_price_work_v1',{
    p_edition_id:editionId,p_work_key:lastWorkKey,p_result_text:resultText,p_result_hash:resultHash,
   },signal,timeoutMs));
   if(!object(receipt)||receipt.schema!=='DAILY_AI_PRICE_WORK_FINISHED_V1'||receipt.edition_id!==editionId
    ||receipt.work_key!==lastWorkKey||typeof receipt.replayed!=='boolean'||!hashValid(receipt.result_hash)
    ||!receipt.replayed&&receipt.result_hash!==resultHash||receipt.member_published!==false||receipt.review_required!==true)fail('COMPLETION_RECEIPT');
   return {...result,completion:{state:'CONFIRMED',attempted:true,work_key:lastWorkKey,result_hash:receipt.result_hash,replayed:receipt.replayed}};
  }catch(error){
   return {...result,completion:{state:attempted?'OUTCOME_UNKNOWN':'DEFERRED',attempted,work_key:lastWorkKey,reason:safeCode(error)}};
  }
 };
 const readNow=()=>{const at=clock();if(!validObservationTime(at))fail('CLOCK');return Date.parse(at);};
 let prepared,inputWork,longReviewWork,registrationAttempted=false,registrationConfirmed=false;
 try{
  stopped(signal);
  let work=await readWork();
  const profileWork=await prepareDailyAiProfileInputs(work,{now:readNow(),signal});
  const {registration_request,...profileSummary}=profileWork;
  inputWork={...profileSummary,state:'NO_NEW_PROFILE_INPUTS',registration_attempted:false,registered:0};
  const inputItems=registration_request.args.p_items;
  if(inputItems.length){
   if(Buffer.byteLength(JSON.stringify(inputItems))>64_000_000)fail('INPUT_BATCH_SIZE');
   const expected=new Map(profileWork.rows.filter(row=>row.state==='INPUT_PREPARED_REVIEW_REQUIRED').map(row=>[row.input_hash,row]));
   if(expected.size!==inputItems.length)fail('INPUT_BATCH_IDENTITY');
   stopped(signal);registrationAttempted=true;
   inputWork={...inputWork,state:'INPUT_REGISTRATION_OUTCOME_UNKNOWN',registration_attempted:true};
   const receipt=unwrap(await call(rpc,registration_request.name,registration_request.args,signal,timeoutMs));
   if(!object(receipt)||receipt.schema!=='DAILY_AI_PRICE_INPUTS_BATCH_STAGED_V1'||receipt.batch_id!==batchId
    ||receipt.review_required!==true||receipt.member_published!==false||!Array.isArray(receipt.items)||receipt.items.length!==inputItems.length)fail('INPUT_REGISTRATION_RECEIPT');
   const seen=new Set(),registrationIds=new Set();
   for(const row of receipt.items){
    const wanted=expected.get(row.input_hash);
    if(!wanted||seen.has(row.input_hash)||row.schema!=='DAILY_AI_PRICE_CALCULATION_INPUT_STAGED_V1'||row.batch_id!==batchId
     ||row.symbol!==wanted.symbol||row.horizon!==wanted.horizon||row.registered!==true
     ||!Number.isSafeInteger(row.registration_id)||row.registration_id<1||registrationIds.has(row.registration_id)
     ||row.review_required!==true||row.member_published!==false)fail('INPUT_REGISTRATION_RECEIPT');
    seen.add(row.input_hash);registrationIds.add(row.registration_id);
   }
   registrationConfirmed=true;
   inputWork={...inputWork,state:'INPUTS_REGISTERED_REVIEW_REQUIRED',registered:seen.size,
    rows:inputWork.rows.map(row=>seen.has(row.input_hash)?{...row,state:'INPUT_REGISTERED_REVIEW_REQUIRED'}:row)};
   // Do not stage prices from hypothetical registration IDs or a local merged
   // packet. Reload the database, including any concurrent explicit revision.
   work=await readWork();
   const current=validateWork(work,readNow(),signal);
   for(const wanted of expected.values())if(current.inputs.get(wanted.symbol+':'+wanted.horizon)?.input_hash!==wanted.input_hash)fail('INPUT_REGISTRATION_READBACK');
  }
  prepared=await prepareDailyAiPriceWork(work,{now:readNow(),signal});
  longReviewWork=await prepareDailyAiLongReviewWork(work,{now:readNow(),signal});
  const inputRows=new Map(inputWork.rows.map(row=>[row.symbol+':'+row.horizon,row]));
  prepared.summary.rows=prepared.summary.rows.map(row=>{
   const binding=inputRows.get(row.symbol+':'+row.horizon);
   return row.state==='METHOD_INPUT_REQUIRED'&&binding&&['METHOD_UPDATE_REQUIRED','INVALID_PROFILE'].includes(binding.state)
    ?{...row,reason:binding.reason,field:binding.field??null,missing:binding.missing??[],profile_hash:binding.profile_hash}:row;
  });
 }catch(error){
  return {...unavailable(safeCode(error)),
   state:registrationConfirmed?'INPUTS_REGISTERED_PRICE_WORK_DEFERRED':registrationAttempted?'INPUT_REGISTRATION_OUTCOME_UNKNOWN':'PRICE_WORKFLOW_UNAVAILABLE',
   ...(inputWork?{input_work:inputWork}:{})};
 }
 prepared.summary={...prepared.summary,input_work:inputWork};
 if(longReviewWork.summary.rows.length){
  let longSummary={...longReviewWork.summary,stage_attempted:false};
  const longItems=longReviewWork.stage_request.args.p_items;
  if(longItems.length){
   if(Buffer.byteLength(JSON.stringify(longItems))>12_000_000)longSummary={...longSummary,state:'PAYLOAD_LIMIT'};
   else try{
    stopped(signal);longSummary={...longSummary,stage_attempted:true};
    const receipt=unwrap(await call(rpc,longReviewWork.stage_request.name,longReviewWork.stage_request.args,signal,timeoutMs));
    if(!object(receipt)||receipt.schema!=='DAILY_AI_LONG_PREPARATIONS_STAGED_V1'||receipt.edition_id!==editionId
     ||receipt.member_published!==false||receipt.review_required!==true||!Array.isArray(receipt.items)||receipt.items.length!==longItems.length)fail('LONG_PREPARATION_RECEIPT');
    const expected=new Map(longItems.map(item=>[item.input_hash,item])),seen=new Set();
    for(const item of receipt.items){const wanted=expected.get(item.input_hash);
     if(!wanted||seen.has(item.input_hash)||item.calculation_hash!==wanted.calculation_hash||item.preparation_hash!==wanted.preparation_hash
      ||typeof item.replayed!=='boolean')fail('LONG_PREPARATION_RECEIPT');seen.add(item.input_hash);
    }
    longSummary={...longSummary,state:'STAGED_REVIEW_REQUIRED',
     rows:longSummary.rows.map(row=>seen.has(row.input_hash)?{...row,state:'STAGED_REVIEW_REQUIRED'}:row)};
   }catch(error){longSummary={...longSummary,state:longSummary.stage_attempted?'STAGE_OUTCOME_UNKNOWN':'STAGE_DEFERRED',reason:safeCode(error)};}
  }
  prepared.summary.long_review_preparations=longSummary;
 }
 const items=prepared.stage_request.args.p_items;
 if(!items.length)return finish({...prepared.summary,stage_attempted:false});
 if(Buffer.byteLength(JSON.stringify(items))>12_000_000)return {...prepared.summary,state:'PRICE_STAGE_PAYLOAD_LIMIT',stage_attempted:false};
 let attempted=false;
 const unknown=reason=>({...prepared.summary,state:attempted?'STAGE_OUTCOME_UNKNOWN':'PRICE_STAGE_DEFERRED',reason,stage_attempted:attempted,
  rows:prepared.summary.rows.map(row=>attempted&&row.plan_hash?{...row,state:'STAGE_OUTCOME_UNKNOWN'}:row)});
 try{
  // The original input times and plan hashes survive CACHED invocations. The
  // database is responsible for replay of the exact immutable write.
  stopped(signal);
  attempted=true;
  const receipt=unwrap(await call(rpc,prepared.stage_request.name,prepared.stage_request.args,signal,timeoutMs));
  if(!object(receipt)||receipt.schema!=='DAILY_AI_PRICE_WORK_BATCH_STAGED_V1'||receipt.edition_id!==editionId
   ||receipt.review_required!==true||receipt.member_published!==false||!Array.isArray(receipt.items)||receipt.items.length!==items.length)fail('STAGE_RECEIPT');
  const expected=new Map(items.map(item=>[item.plan_hash,item])),seen=new Set();
  for(const row of receipt.items){
   const expectedRow=expected.get(row.plan_hash);
   if(!expectedRow||seen.has(row.plan_hash)||row.input_hash!==expectedRow.input_hash||row.calculation_hash!==expectedRow.calculation_hash
    ||row.method_note_hash!==expectedRow.method_note_hash||!hashValid(row.review_request_hash)
    ||typeof row.replayed!=='boolean'||row.review_required!==true||row.member_published!==false)fail('STAGE_RECEIPT');
   seen.add(row.plan_hash);
  }
  const rows=prepared.summary.rows.map(row=>seen.has(row.plan_hash)?{...row,state:'STAGED_REVIEW_REQUIRED'}:row);
  return finish({...prepared.summary,state:prepared.summary.counts.invalid||prepared.summary.counts.missing_inputs?'PARTIAL_PRICES_STAGED_REVIEW_REQUIRED':'PRICES_STAGED_REVIEW_REQUIRED',
   rows,counts:{...prepared.summary.counts,staged:seen.size},stage_attempted:true});
 }catch(error){return unknown(safeCode(error));}
}
