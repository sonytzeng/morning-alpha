// Source-only throughput probe against an already populated local PGlite DB.
// Never runs an analysis, claims a shard, reviews, publishes, fetches or deploys.
// A new immutable probe plan prevents cached pool receipts from hiding cost.
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {performance} from 'node:perf_hooks';
import process from 'node:process';
import console from 'node:console';
import {URL} from 'node:url';
import {marketSnapshotHash,planTaiwanMarketAnalysis} from '../../research/taiwan-market-universe.mjs';
import {stageDailyAiMarketWorkPlan} from '../../research/daily-ai-market-stage.mjs';
import {prepareDailyAiMarketPriceInputChunks,stageDailyAiMarketPricePrepared} from '../../research/daily-ai-market-references-stage.mjs';

const options={},argv=process.argv.slice(2),required=['--database-path','--output','--universe','--inputs','--bindings'];
for(let i=0;i<argv.length;i+=2){
 if(!required.includes(argv[i])||!argv[i+1]||options[argv[i]])throw Error('LOCAL_CHUNK_PROBE_ARGUMENTS');
 options[argv[i]]=resolve(argv[i+1]);
}
if(required.some(key=>!options[key])||!process.env.MA_PGLITE_MODULE)throw Error('LOCAL_CHUNK_PROBE_PATHS_REQUIRED');
const sha=value=>createHash('sha256').update(value).digest('hex'),dbPath=options['--database-path'],output=options['--output'];
const fileText=name=>readFileSync(new URL('../../research/'+name,import.meta.url),'utf8');
const baseHash=sha(fileText('daily-ai-market-v2.candidate.sql')),referenceHash=sha(fileText('daily-ai-market-references.candidate.sql'));
for(const [suffix,field,expected]of [['.source.json','sql_sha256',baseHash],['.references.json','extension_sha256',referenceHash]]){
 const path=dbPath+suffix;if(!existsSync(path))throw Error('LOCAL_CHUNK_PROBE_EXISTING_DATABASE_REQUIRED');
 const identity=JSON.parse(readFileSync(path,'utf8'));
 if(identity.production_database!==false||identity[field]!==expected)throw Error('LOCAL_CHUNK_PROBE_DATABASE_IDENTITY');
}
const universe=JSON.parse(readFileSync(options['--universe'],'utf8'));
const inputBytes=readFileSync(options['--inputs']),bindingBytes=readFileSync(options['--bindings']);
const inputs=JSON.parse(inputBytes.toString('utf8')),bindings=JSON.parse(bindingBytes.toString('utf8'));
const inputPoolHash=marketSnapshotHash(inputs),inputCount=Object.keys(inputs).length,bindingCount=Object.keys(bindings).length;
const chunkSql=fileText('daily-ai-market-reference-chunks.candidate.sql'),chunkHash=sha(chunkSql),extensionPath=dbPath+'.reference-chunks.json';
mkdirSync(output,{recursive:true});
const contextPath=resolve(output,'probe-context.json');
const savedContext=existsSync(contextPath),cutoff=new Date().toISOString();
const context=savedContext?JSON.parse(readFileSync(contextPath,'utf8')):{
 schema:'TAIWAN_MARKET_REFERENCE_CHUNK_SOURCE_PROBE_V1',source_only_probe:true,analysis_executed:false,
 input_artifact_sha256:sha(inputBytes),binding_artifact_sha256:sha(bindingBytes),input_pool_hash:inputPoolHash,
 plan:planTaiwanMarketAnalysis({universe,cutoff,business_date:new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10),shard_size:64}),
 extension_sha256:chunkHash,created_at:cutoff,production_writes:0,provider_requests:0,
};
if(context.schema!=='TAIWAN_MARKET_REFERENCE_CHUNK_SOURCE_PROBE_V1'||context.source_only_probe!==true
 ||context.input_artifact_sha256!==sha(inputBytes)||context.binding_artifact_sha256!==sha(bindingBytes)
 ||context.input_pool_hash!==inputPoolHash||context.plan.universe_hash!==universe.universe_hash||context.extension_sha256!==chunkHash)
 throw Error('LOCAL_CHUNK_PROBE_CONTEXT_CHANGED');
if(!savedContext)writeFileSync(contextPath,JSON.stringify(context,null,2)+'\n',{flag:'wx'});
const prepared=prepareDailyAiMarketPriceInputChunks({planHash:context.plan.plan_hash,inputs,bindings,inputPoolHash});
const statePath=resolve(output,'probe-staging.json'),journal=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{
 ...context,plan_hash:context.plan.plan_hash,input_count:inputCount,binding_count:bindingCount,chunk_count:prepared.chunks.length,
 original_body_hash:prepared.original_body_hash,max_chunk_bytes:Math.max(...prepared.chunks.map(c=>Buffer.byteLength(c.args.p_body_text))),
 records:[],state:'PREPARING',
};
const persist=()=>writeFileSync(statePath,JSON.stringify(journal,null,2)+'\n');
if(journal.plan_hash!==context.plan.plan_hash||journal.original_body_hash!==prepared.original_body_hash||journal.extension_sha256!==chunkHash)
 throw Error('LOCAL_CHUNK_PROBE_JOURNAL_CHANGED');
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite(dbPath);await db.waitReady;
async function rpc(name,args){
 if(!['stage_daily_ai_market_work_plan_v2','stage_daily_ai_market_price_input_chunk_v2','finalize_daily_ai_market_price_inputs_v2'].includes(name))throw Error('LOCAL_CHUNK_PROBE_RPC_SCOPE');
 try{const values=Object.values(args);return {data:(await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result,error:null};}
 catch(error){return {data:null,error:{code:error.code,message:error.message}};}
}
try{
 if(existsSync(extensionPath)){
  if(JSON.parse(readFileSync(extensionPath,'utf8')).extension_sha256!==chunkHash)throw Error('LOCAL_CHUNK_PROBE_EXTENSION_CHANGED');
 }else{
  await db.exec(chunkSql);writeFileSync(extensionPath,JSON.stringify({extension_sha256:chunkHash,production_database:false})+'\n',{flag:'wx'});
 }
 const initial=(await db.query(`select
  (select count(*)::int from vnext_market.price_input_pools where plan_id=$1) pools,
  (select count(*)::int from vnext_market.price_input_chunks where plan_id=$1) chunks,
  (select count(*)::int from vnext_market.price_input_raw_bindings where plan_id=$1) bindings,
  (select count(*)::int from vnext_market.stock_results where plan_id=$1) stocks,
  (select count(*)::int from vnext_market.reviews) reviews,
  (select count(*)::int from vnext_market.publication_events) publications`,[context.plan.plan_hash])).rows[0];
 if(!Object.hasOwn(journal,'initial_state')){
  if(initial.pools||initial.chunks||initial.bindings||initial.stocks)throw Error('LOCAL_CHUNK_PROBE_MUST_START_EMPTY');
  journal.initial_state=initial;journal.fresh_uncached_source_validation=true;persist();
 }
 await db.exec('set role service_role');
 const plan=await stageDailyAiMarketWorkPlan({rpc,universe,plan:context.plan});
 if(plan.state!=='STAGED')throw Error('LOCAL_CHUNK_PROBE_PLAN:'+JSON.stringify(plan));
 journal.plan_receipt=plan;persist();
 for(const item of [...prepared.chunks,prepared.finalize]){
  journal.pending={rpc:item.rpc,body_hash:item.body_hash,chunk_index:item.chunk_index??null,started_at:new Date().toISOString()};persist();
  const started=performance.now(),receipt=await stageDailyAiMarketPricePrepared({rpc,prepared:item});
  const record={rpc:item.rpc,body_hash:item.body_hash,chunk_index:item.chunk_index??null,milliseconds:Math.round(performance.now()-started),...receipt};
  journal.records.push(record);delete journal.pending;persist();console.log(JSON.stringify(record));
  if(receipt.state!=='STAGED')throw Error('LOCAL_CHUNK_PROBE_ACK_NOT_CONFIRMED');
 }
 await db.exec('reset role');
 const final=(await db.query(`select p.input_pool_hash,p.body_hash,
  (select count(*)::int from vnext_market.price_input_nodes where plan_id=p.plan_id) nodes,
  (select count(*)::int from vnext_market.price_input_raw_bindings where plan_id=p.plan_id) bindings,
  (select count(*)::int from vnext_market.stock_results where plan_id=p.plan_id) stocks,
  (select count(*)::int from vnext_market.editions where plan_id=p.plan_id) editions,
  (select count(*)::int from vnext_market.reviews) reviews,
  (select count(*)::int from vnext_market.publication_events) publications
  from vnext_market.price_input_pools p where plan_id=$1`,[context.plan.plan_hash])).rows[0];
 if(!final||final.input_pool_hash!==inputPoolHash||final.body_hash!==prepared.original_body_hash
  ||final.nodes!==inputCount||final.bindings!==bindingCount||final.stocks||final.editions
  ||final.reviews!==journal.initial_state.reviews||final.publications!==journal.initial_state.publications)
  throw Error('LOCAL_CHUNK_PROBE_FINAL_BINDING');
 const uncached=journal.records.filter(r=>r.replayed===false),maximum=Math.max(...uncached.map(r=>r.milliseconds));
 journal.final_state=final;journal.max_uncached_rpc_milliseconds=maximum;
 journal.all_measured_rpcs_within_85s=journal.records.every(r=>r.milliseconds<85000);
 journal.state=journal.all_measured_rpcs_within_85s?'SOURCE_ONLY_CHUNKS_CONFIRMED_WITHIN_BUDGET':'SOURCE_ONLY_CONFIRMED_BUT_TIME_BUDGET_FAILED';
 journal.completed_at=new Date().toISOString();persist();
 console.log(JSON.stringify({state:journal.state,plan_hash:journal.plan_hash,input_pool_hash:inputPoolHash,input_count:inputCount,binding_count:bindingCount,
  chunks:prepared.chunks.length,max_rpc_milliseconds:maximum,source_only_probe:true,analysis_executed:false,production_writes:0,provider_requests:0}));
 if(!journal.all_measured_rpcs_within_85s)process.exitCode=1;
}catch(error){journal.state='STOPPED';journal.error={message:error.message,code:error.code??null};persist();console.error(JSON.stringify(journal.error));process.exitCode=1;}
finally{await db.close();}
