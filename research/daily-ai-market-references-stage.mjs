/** Optional, immutable research-reference preparation. No recommendation
 * approval or publication, and no automatic retry after an unknown RPC result. */
import {createHash,randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {marketSnapshotHash} from './taiwan-market-universe.mjs';
import {marketStageCanonical,prepareDailyAiMarketShard} from './daily-ai-market-stage.mjs';
import {taiwanResearchReferenceSummary} from './taiwan-market-price-reference.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const fail=c=>{throw Error('DAILY_AI_MARKET_STAGE_'+c);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const encode=(v,max)=>{const text=marketStageCanonical(v);if(Buffer.byteLength(text)>max)fail('REFERENCE_SIZE');return text;};
function preparePriceInputPool({planHash,inputs,bindings,inputPoolHash},maximumBytes){
 if(!isHash(planHash)||!object(inputs)||!object(bindings)||inputPoolHash!==marketSnapshotHash(inputs))fail('REFERENCE_INPUTS');
 const body={schema:'TAIWAN_MARKET_PRICE_INPUT_POOL_V1',plan_hash:planHash,input_pool_hash:inputPoolHash,inputs,bindings};
 const text=encode(body,maximumBytes),body_hash=sha(text);
 return {rpc:'stage_daily_ai_market_price_inputs_v2',plan_hash:planHash,input_pool_hash:inputPoolHash,body_hash,
  args:{p_plan_hash:planHash,p_body_text:text,p_body_hash:body_hash}};
}
export function prepareDailyAiMarketPriceInputs(args){return preparePriceInputPool(args,32000000);}
/** Bound the database work per request. Finalization reconstructs the exact
 * original pool body; chunking changes neither evidence nor its global hash. */
export function prepareDailyAiMarketPriceInputChunks(args){
 // Only the bounded chunk transport admits a 64 MB assembled pool. The legacy
 // one-request API retains its original 32 MB limit.
 const original=preparePriceInputPool(args,64000000),{planHash,inputs,bindings,inputPoolHash}=args;
 const chunks=[],allBindings=new Set();let nodes={},bound={},bytes=0,count=0;
 const flush=()=>{if(count){chunks.push({inputs:nodes,bindings:bound});nodes={};bound={};bytes=0;count=0;}};
 const sourceBindings=value=>{const found={};const visit=v=>{
  if(Array.isArray(v)){v.forEach(visit);return;}if(!object(v))return;
  if(v.capture_id||v.source_row_hash){if(!v.capture_id||!v.source_row_hash)fail('REFERENCE_SOURCE_PARTIAL');
   const h=marketSnapshotHash(v),sid=bindings[h];if(!/^(TWSE|TPEX|EMERGING):\d{4,6}$/.test(sid??''))fail('REFERENCE_SOURCE_IDENTITY');
   found[h]=sid;allBindings.add(h);return;}Object.values(v).forEach(visit);};visit(value);return found;};
 for(const h of Object.keys(inputs).sort()){
  const value=inputs[h];if(h!==marketSnapshotHash(value))fail('REFERENCE_NODE_HASH');
  const itemBindings=sourceBindings(value),size=Buffer.byteLength(marketStageCanonical({[h]:value}));
  const additional=Object.keys(itemBindings).filter(k=>!Object.hasOwn(bound,k)).length*100;
  if(count>=256||count&&bytes+size+additional>900000)flush();
  nodes[h]=value;Object.assign(bound,itemBindings);bytes+=size+Object.keys(itemBindings).length*100;count++;
  if(bytes>950000)fail('REFERENCE_NODE_SIZE');
 }
 flush();if(!chunks.length)chunks.push({inputs:{},bindings:{}});
 if(allBindings.size!==Object.keys(bindings).length)fail('REFERENCE_BINDING_SET');
 const prepared=chunks.map((part,index)=>{
  const body={schema:'TAIWAN_MARKET_PRICE_INPUT_CHUNK_V1',plan_hash:planHash,input_pool_hash:inputPoolHash,
   chunk_index:index,chunk_count:chunks.length,...part},text=encode(body,1000000),body_hash=sha(text);
  return {rpc:'stage_daily_ai_market_price_input_chunk_v2',plan_hash:planHash,input_pool_hash:inputPoolHash,
   chunk_index:index,chunk_count:chunks.length,body_hash,args:{p_plan_hash:planHash,p_body_text:text,p_body_hash:body_hash}};
 });
 const body={schema:'TAIWAN_MARKET_PRICE_INPUT_FINALIZE_V1',plan_hash:planHash,input_pool_hash:inputPoolHash,
  chunk_count:chunks.length,input_count:Object.keys(inputs).length,binding_count:Object.keys(bindings).length,expected_body_hash:original.body_hash};
 const text=encode(body,2000),body_hash=sha(text);
 return {chunks:prepared,finalize:{rpc:'finalize_daily_ai_market_price_inputs_v2',plan_hash:planHash,input_pool_hash:inputPoolHash,
  body_hash,args:{p_plan_hash:planHash,p_body_text:text,p_body_hash:body_hash}},original_body_hash:original.body_hash};
}
export function prepareDailyAiMarketPriceReferenceBatches({planHash,references,inputPoolHash}){
 if(!isHash(planHash)||!isHash(inputPoolHash)||!Array.isArray(references))fail('REFERENCE_BATCH');
 const batches=[],bySecurity=Object.create(null);let items=[],bytes=0;
 const flush=()=>{if(!items.length)return;const body={schema:'TAIWAN_MARKET_PRICE_REFERENCE_BATCH_V1',plan_hash:planHash,input_pool_hash:inputPoolHash,items};
  const text=encode(body,16000000),body_hash=sha(text);batches.push({rpc:'stage_daily_ai_market_price_references_v2',plan_hash:planHash,input_pool_hash:inputPoolHash,body_hash,items:items.length,
   args:{p_plan_hash:planHash,p_body_text:text,p_body_hash:body_hash}});items=[];bytes=0;};
 for(const stock of references){if(!/^(TWSE|TPEX|EMERGING):\d{4,6}$/.test(stock.security_id)||Object.hasOwn(bySecurity,stock.security_id))fail('REFERENCE_IDENTITY');
  const summaries={SHORT:null,MEDIUM:null,LONG:null};bySecurity[stock.security_id]=summaries;
  for(const horizon of ['SHORT','MEDIUM','LONG']){const reference=stock[horizon.toLowerCase()];
   const summary=taiwanResearchReferenceSummary({security_id:stock.security_id,horizon,reference,input_pool_hash:inputPoolHash});if(!summary)continue;
   summaries[horizon]=summary;const reference_text=encode(reference,1500000),item={security_id:stock.security_id,horizon,reference_text,reference_hash:reference.reference_hash,summary};
   const itemBytes=Buffer.byteLength(marketStageCanonical(item))+1;if(items.length>=8||bytes+itemBytes>4000000)flush();items.push(item);bytes+=itemBytes;
  }
 }
 flush();return {batches,bySecurity};
}
export function prepareDailyAiMarketShardWithReferences(args){
 const baseline=prepareDailyAiMarketShard(args),body=JSON.parse(baseline.args.p_result_text);
 const references=new Map(args.results.map(r=>[r.security_id,r.research_references]));
 for(const item of body.items){const r=references.get(item.security_id);
  if(!object(r)||Object.keys(r).sort().join(',')!=='LONG,MEDIUM,SHORT')fail('REFERENCE_PROJECTION');
  item.references_text=encode(r,16000);item.references_hash=sha(item.references_text);
 }
 body.schema='DAILY_AI_MARKET_SHARD_RESULT_WITH_REFERENCES_V2';const result_text=encode(body,16000000),result_hash=sha(result_text);
 return {...baseline,result_hash,rpc:'stage_daily_ai_market_shard_with_references_v2',args:{...baseline.args,p_result_text:result_text,p_result_hash:result_hash}};
}
async function invoke(rpc,name,args){
 try{const response=await rpc(name,args);if(!object(response))return {state:'OUTCOME_UNKNOWN',code:'INVALID_RPC_ENVELOPE'};
  if(response.error){const code=String(response.error.code??'RPC_ERROR'),message=String(response.error.message??'');
   return {state:/^(?:P0001|42501|22\w{3}|23\w{3}|PGRST202|42883)$/.test(code)?'REJECTED':'OUTCOME_UNKNOWN',code,
    ...(/^MARKET_[A-Z0-9_]{1,100}$/.test(message)?{reason:message}:{})};}
  return {state:'CONFIRMED',data:response.data};
 }catch{return {state:'OUTCOME_UNKNOWN',code:'TRANSPORT_ACKNOWLEDGEMENT_UNKNOWN'};}
}
export async function stageDailyAiMarketPricePrepared({rpc,prepared}){
 if(!['stage_daily_ai_market_price_inputs_v2','stage_daily_ai_market_price_input_chunk_v2','finalize_daily_ai_market_price_inputs_v2','stage_daily_ai_market_price_references_v2'].includes(prepared?.rpc))fail('REFERENCE_RPC');
 const result=await invoke(rpc,prepared.rpc,prepared.args);if(result.state!=='CONFIRMED')return result;
 const r=result.data,chunk=prepared.rpc==='stage_daily_ai_market_price_input_chunk_v2';
 if(chunk){
  if(!object(r)||r.schema!=='DAILY_AI_MARKET_PRICE_INPUT_CHUNK_STAGED_V1'||r.plan_hash!==prepared.plan_hash
   ||r.input_pool_hash!==prepared.input_pool_hash||r.chunk_index!==prepared.chunk_index||r.chunk_count!==prepared.chunk_count
   ||r.body_hash!==prepared.body_hash||typeof r.replayed!=='boolean')return {state:'OUTCOME_UNKNOWN',code:'REFERENCE_RECEIPT'};
  return {state:'STAGED',plan_hash:r.plan_hash,input_pool_hash:r.input_pool_hash,chunk_index:r.chunk_index,body_hash:r.body_hash,replayed:r.replayed};
 }
 const pool=['stage_daily_ai_market_price_inputs_v2','finalize_daily_ai_market_price_inputs_v2'].includes(prepared.rpc);
 if(!object(r)||r.schema!==(pool?'DAILY_AI_MARKET_PRICE_INPUTS_STAGED_V1':'DAILY_AI_MARKET_PRICE_REFERENCES_STAGED_V1')
  ||r.plan_hash!==prepared.plan_hash||r.input_pool_hash!==prepared.input_pool_hash
  ||pool&&typeof r.replayed!=='boolean'||!pool&&(r.items!==prepared.items||r.body_hash!==prepared.body_hash))return {state:'OUTCOME_UNKNOWN',code:'REFERENCE_RECEIPT'};
 return {state:'STAGED',plan_hash:r.plan_hash,input_pool_hash:r.input_pool_hash,body_hash:prepared.body_hash,...(pool?{replayed:r.replayed}:{items:r.items})};
}
export async function runDailyAiMarketShardWithReferences({rpc,planHash,workerRef,analyseShard,requestKey=randomUUID()}){
 if(!isHash(planHash)||typeof workerRef!=='string'||!workerRef.trim()||workerRef.length>200||typeof analyseShard!=='function')fail('WORKER_SCOPE');
 const base={plan_hash:planHash,request_key:requestKey,member_published:false,review_required:true};
 const claim=await invoke(rpc,'claim_daily_ai_market_shard_v2',{p_plan_hash:planHash,p_worker_ref:workerRef,p_request_key:requestKey});
 if(claim.state!=='CONFIRMED')return {...base,...claim};const work=claim.data;
 if(!object(work)||work.schema!=='DAILY_AI_MARKET_SHARD_CLAIM_V2'||work.plan_hash!==planHash)return {...base,state:'OUTCOME_UNKNOWN',code:'CLAIM_RECEIPT'};
 if(work.state==='NO_WORK'&&Number.isSafeInteger(work.remaining)&&Number.isSafeInteger(work.exhausted))return {...base,state:'NO_WORK',remaining:work.remaining,exhausted:work.exhausted};
 if(!object(work.shard)||work.request_key!==requestKey||!isHash(work.shard.shard_id))return {...base,state:'OUTCOME_UNKNOWN',code:'CLAIM_SCOPE'};
 if(work.state==='COMPLETED'&&isHash(work.result_hash))return {...base,state:'STAGED',replayed:true,shard_id:work.shard.shard_id,result_hash:work.result_hash,cards:work.shard.expected_cards};
 if(work.state==='LEASE_EXPIRED')return {...base,state:'LEASE_EXPIRED',shard_id:work.shard.shard_id};
 if(work.state!=='CLAIMED')return {...base,state:'OUTCOME_UNKNOWN',code:'CLAIM_STATE'};
 const results=await analyseShard(JSON.parse(marketStageCanonical(work))),prepared=prepareDailyAiMarketShardWithReferences({planHash,shard:work.shard,leaseId:work.lease_id,results});
 const staged=await invoke(rpc,prepared.rpc,prepared.args),r=staged.data;
 if(staged.state!=='CONFIRMED')return {...base,...staged,shard_id:prepared.shard_id,result_hash:prepared.result_hash};
 if(!object(r)||r.schema!=='DAILY_AI_MARKET_SHARD_STAGED_V2'||r.plan_hash!==planHash||r.shard_id!==prepared.shard_id||r.result_hash!==prepared.result_hash
  ||r.cards!==prepared.cards||r.member_published!==false||r.review_required!==true||typeof r.replayed!=='boolean')return {...base,state:'OUTCOME_UNKNOWN',code:'SHARD_RECEIPT',shard_id:prepared.shard_id,result_hash:prepared.result_hash};
 return {...base,state:'STAGED',shard_id:r.shard_id,result_hash:r.result_hash,cards:r.cards,replayed:r.replayed};
}
