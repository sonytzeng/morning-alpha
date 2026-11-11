// SYNTHETIC issuers and observations in a disposable local database only.
// Exercise the actual JS transport against SQL, including lost acknowledgements.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import console from 'node:console';
import {URL} from 'node:url';
import {createMarketOwnerFixture} from './helpers/dailyAiMarketOwnerFixture.mjs';
import {marketSnapshotHash,planTaiwanMarketAnalysis} from '../research/taiwan-market-universe.mjs';
import {marketStageCanonical as canonical,stageDailyAiMarketCapture,stageDailyAiMarketWorkPlan,
 runDailyAiMarketShard,finishDailyAiMarketEdition} from '../research/daily-ai-market-stage.mjs';
import {prepareDailyAiMarketPriceInputs,prepareDailyAiMarketPriceInputChunks,
 stageDailyAiMarketPricePrepared} from '../research/daily-ai-market-references-stage.mjs';

const f=await createMarketOwnerFixture(),{db,rpc,call}=f;
const sha=value=>createHash('sha256').update(value).digest('hex'),clone=value=>JSON.parse(JSON.stringify(value));
const CHUNK='stage_daily_ai_market_price_input_chunk_v2',FINAL='finalize_daily_ai_market_price_inputs_v2';
let phase=0,serial=0;
const pass=label=>console.log(JSON.stringify({phase:++phase,state:'PASS',label}));
const bodyArgs=body=>{const text=canonical(body);return {p_plan_hash:body.plan_hash,p_body_text:text,p_body_hash:sha(text)};};
const bodyOf=prepared=>JSON.parse(prepared.args.p_body_text);
async function service(){await f.identity(null,'service_role');}
async function admin(){await db.exec('reset role');}
async function freshPlan(){
 const cutoff=new Date(Date.parse(f.plan.cutoff)+(++serial)*100).toISOString();
 const business_date=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
 const plan=planTaiwanMarketAnalysis({universe:f.universe,business_date,cutoff,shard_size:64});
 assert.equal((await stageDailyAiMarketWorkPlan({rpc,universe:f.universe,plan})).state,'STAGED');return plan;
}
async function state(plan){
 await admin();const result=(await db.query(`select
  (select count(*)::int from vnext_market.price_input_chunk_sets where plan_id=$1) sets,
  (select count(*)::int from vnext_market.price_input_chunks where plan_id=$1) chunks,
  (select count(*)::int from vnext_market.price_input_nodes where plan_id=$1) nodes,
  (select count(*)::int from vnext_market.price_input_raw_bindings where plan_id=$1) bindings,
  (select count(*)::int from vnext_market.price_input_pools where plan_id=$1) pools,
  (select count(*)::int from vnext_market.reviews) reviews,
  (select count(*)::int from vnext_market.publication_events) publications`,[plan.plan_hash])).rows[0];
 await service();return result;
}
function rawBindings(value,out=new Map()){
 if(Array.isArray(value))value.forEach(v=>rawBindings(v,out));
 else if(value&&typeof value==='object'){
  if(value.capture_id||value.source_row_hash)out.set(marketSnapshotHash(value),value);
  else Object.values(value).forEach(v=>rawBindings(v,out));
 }return out;
}
async function finishSynthetic(plan){
 const result=await runDailyAiMarketShard({rpc,planHash:plan.plan_hash,workerRef:'SYNTHETIC_CHUNK_TEST',analyseShard:async work=>{
  await admin();const rows=(await db.query('select security_id,packet_text,analysis_text from vnext_market.stock_results where plan_id=$1',[f.plan.plan_hash])).rows;
  await service();return work.companies.map(company=>{
   const row=rows.find(r=>r.security_id===company.security_id),packet=JSON.parse(row.packet_text),analysis=JSON.parse(row.analysis_text);
   packet.cutoff=plan.cutoff;analysis.cutoff=plan.cutoff;analysis.input_hash=marketSnapshotHash(packet);
   return {security_id:company.security_id,packet,analysis};
  });
 }});assert.equal(result.state,'STAGED',JSON.stringify(result));
 const finished=await finishDailyAiMarketEdition({rpc,planHash:plan.plan_hash,expiresAt:new Date(Date.now()+3600000).toISOString()});
 assert.equal(finished.state,'STAGED_REVIEW_REQUIRED',JSON.stringify(finished));return finished;
}
try{
 await admin();await f.executeFile('daily-ai-market-reference-chunks.candidate.sql');await service();
 const baseline=JSON.parse(f.preparedPool.args.p_body_text),raws=rawBindings(baseline.inputs);
 const [bindingHash,binding]=raws.entries().next().value,sid=baseline.bindings[bindingHash];
 const inputs=Object.fromEntries(Array.from({length:300},(_,index)=>{
  const node={schema:'SYNTHETIC_PRICE_NODE_V1',security_id:sid,source_capture:binding,index,fixture:'SYNTHETIC_ONLY'};
  return [marketSnapshotHash(node),node];
 })),bindings={[bindingHash]:sid},inputPoolHash=marketSnapshotHash(inputs);
 const plan=await freshPlan(),prepared=prepareDailyAiMarketPriceInputChunks({planHash:plan.plan_hash,inputs,bindings,inputPoolHash});
 assert.equal(prepared.chunks.length,2);
 const empty=await state(plan);assert.deepEqual(empty,{sets:0,chunks:0,nodes:0,bindings:0,pools:0,reviews:0,publications:0});

 for(const mutate of [b=>{b.source_sha256='0'.repeat(64);},b=>{b.source_row_hash='1'.repeat(64);},
  b=>{b.received_at=new Date(Date.parse(b.received_at)-1).toISOString();},b=>{b.row_path=[9999];b.row_index=9999;}]){
  const bad=clone(binding);mutate(bad);const h=marketSnapshotHash(bad),node={source_capture:bad},nh=marketSnapshotHash(node);
  const batch=prepareDailyAiMarketPriceInputChunks({planHash:plan.plan_hash,inputs:{[nh]:node},bindings:{[h]:sid},inputPoolHash:marketSnapshotHash({[nh]:node})});
  await assert.rejects(call(CHUNK,batch.chunks[0].args),/MARKET_EVIDENCE_/);assert.deepEqual(await state(plan),empty);
 }
 const wrongIssuer=f.universe.companies.find(c=>c.security_id!==sid).security_id;
 const wrong=bodyOf(prepared.chunks[0]);wrong.bindings[bindingHash]=wrongIssuer;
 await assert.rejects(call(CHUNK,bodyArgs(wrong)),/MARKET_EVIDENCE_SYMBOL/);assert.deepEqual(await state(plan),empty);
 const missing=bodyOf(prepared.chunks[0]);missing.bindings={};
 await assert.rejects(call(CHUNK,bodyArgs(missing)),/MARKET_REFERENCE_SOURCE_BINDING/);
 const extra=bodyOf(prepared.chunks[0]);extra.bindings['f'.repeat(64)]=sid;
 await assert.rejects(call(CHUNK,bodyArgs(extra)),/MARKET_REFERENCE_EXTRA_BINDING/);
 const nodeBad=bodyOf(prepared.chunks[0]);nodeBad.inputs[Object.keys(nodeBad.inputs)[0]].index=-1;
 await assert.rejects(call(CHUNK,bodyArgs(nodeBad)),/MARKET_REFERENCE_INPUT_NODE_HASH/);
 const tooMany=bodyOf(prepared.chunks[0]);Object.assign(tooMany.inputs,bodyOf(prepared.chunks[1]).inputs);
 await assert.rejects(call(CHUNK,bodyArgs(tooMany)),/MARKET_REFERENCE_CHUNK_COUNT/);
 const huge={...bodyOf(prepared.chunks[0]),inputs:{['0'.repeat(64)]:{value:'x'.repeat(1000000)}}};
 await assert.rejects(call(CHUNK,bodyArgs(huge)),/MARKET_REFERENCE_CHUNK_HASH/);
 await assert.rejects(call(CHUNK,{...prepared.chunks[0].args,p_body_hash:'0'.repeat(64)}),/MARKET_REFERENCE_CHUNK_HASH/);
 assert.deepEqual(await state(plan),empty);

 const receivedAt=new Date(Date.now()-500).toISOString(),lateRow={'公司代號':sid.split(':')[1],fixture:'SYNTHETIC_LATER_RECEIPT'};
 const bytes=Buffer.from(JSON.stringify([lateRow])),receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:'twse_valuation',
  url:'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d',format:'json',state:'CAPTURED',status:200,
  started_at:receivedAt,received_at:receivedAt,bytes:bytes.length,sha256:sha(bytes),row_count:1,synthetic_fixture:true};
 const saved=await stageDailyAiMarketCapture({rpc,receipt,bytes});assert.equal(saved.state,'STAGED');
 const late={capture_id:saved.capture_id,source_id:receipt.source_id,source_url:receipt.url,source_sha256:receipt.sha256,
  source_bytes:receipt.bytes,received_at:receivedAt,row_index:0,row_path:[0],symbol_field:'公司代號',source_row_hash:marketSnapshotHash(lateRow)};
 const lateHash=marketSnapshotHash(late),lateInputs={[lateHash]:late};
 const latePrepared=prepareDailyAiMarketPriceInputChunks({planHash:plan.plan_hash,inputs:lateInputs,bindings:{[lateHash]:sid},inputPoolHash:marketSnapshotHash(lateInputs)});
 await assert.rejects(call(CHUNK,latePrepared.chunks[0].args),/MARKET_EVIDENCE_TIME_OR_SOURCE/);assert.deepEqual(await state(plan),empty);
 pass('bounded chunks reject changed source/row/time/issuer, late receipt, missing/extra binding and bad node atomically');

 // Deliver chunk 1 first, lose its acknowledgement, then resume explicitly.
 let requests=0;
 const unknown=await stageDailyAiMarketPricePrepared({prepared:prepared.chunks[1],rpc:async(name,args)=>{
  requests++;await call(name,args);throw Error('SYNTHETIC_ACK_LOST');
 }});assert.equal(unknown.state,'OUTCOME_UNKNOWN');assert.equal(requests,1);
 assert.equal((await state(plan)).chunks,1);assert.equal((await state(plan)).bindings,1);
 await assert.rejects(call(FINAL,prepared.finalize.args),/MARKET_REFERENCE_FINALIZE_INCOMPLETE/);
 const replay=await stageDailyAiMarketPricePrepared({rpc,prepared:prepared.chunks[1]});assert.equal(replay.state,'STAGED');assert.equal(replay.replayed,true);
 const conflict=bodyOf(prepared.chunks[1]);conflict.bindings[bindingHash]=wrongIssuer;
 await assert.rejects(call(CHUNK,bodyArgs(conflict)),/MARKET_REFERENCE_CHUNK_REPLAY_CONFLICT/);
 const otherBinding=bodyOf(prepared.chunks[0]);otherBinding.bindings[bindingHash]=wrongIssuer;
 await assert.rejects(call(CHUNK,bodyArgs(otherBinding)),/MARKET_REFERENCE_CHUNK_BINDING_CONFLICT/);
 assert.equal((await state(plan)).chunks,1);
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:prepared.chunks[0]})).state,'STAGED');
 assert.deepEqual(await state(plan),{...empty,sets:1,chunks:2,nodes:300,bindings:1});
 const wrongFinal=bodyOf(prepared.finalize);wrongFinal.expected_body_hash='e'.repeat(64);
 await assert.rejects(call(FINAL,bodyArgs(wrongFinal)),/MARKET_REFERENCE_FINALIZE_BODY_HASH/);
 const countFinal=bodyOf(prepared.finalize);countFinal.input_count++;
 await assert.rejects(call(FINAL,bodyArgs(countFinal)),/MARKET_REFERENCE_FINALIZE_INCOMPLETE/);
 assert.equal((await state(plan)).pools,0);
 const finalizeUnknown=await stageDailyAiMarketPricePrepared({prepared:prepared.finalize,rpc:async(name,args)=>{
  await call(name,args);throw Error('SYNTHETIC_FINALIZE_ACK_LOST');
 }});assert.equal(finalizeUnknown.state,'OUTCOME_UNKNOWN');assert.equal((await state(plan)).pools,1);
 const finalReplay=await stageDailyAiMarketPricePrepared({rpc,prepared:prepared.finalize});assert.equal(finalReplay.state,'STAGED');assert.equal(finalReplay.replayed,true);
 await admin();const stored=(await db.query('select body_text,body_hash,input_pool_hash from vnext_market.price_input_pools where plan_id=$1',[plan.plan_hash])).rows[0];await service();
 const original=prepareDailyAiMarketPriceInputs({planHash:plan.plan_hash,inputs,bindings,inputPoolHash});
 assert.equal(stored.body_text,original.args.p_body_text);assert.equal(stored.body_hash,original.body_hash);assert.equal(stored.input_pool_hash,inputPoolHash);
 pass('out-of-order/lost-ACK resume validates each distinct binding once and finalizes byte-identical original pool');

 const finished=await finishSynthetic(plan);assert.equal(finished.member_published,false);
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:prepared.chunks[0]})).replayed,true);
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:prepared.finalize})).replayed,true);
 const legacyPlan=await freshPlan(),legacy=prepareDailyAiMarketPriceInputs({planHash:legacyPlan.plan_hash,inputs,bindings,inputPoolHash});
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:legacy})).state,'STAGED');await finishSynthetic(legacyPlan);
 const legacyChunks=prepareDailyAiMarketPriceInputChunks({planHash:legacyPlan.plan_hash,inputs,bindings,inputPoolHash});
 for(const item of legacyChunks.chunks)assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:item})).state,'STAGED');
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:legacyChunks.finalize})).replayed,true);
 const noPoolPlan=await freshPlan();await finishSynthetic(noPoolPlan);
 const sealed=prepareDailyAiMarketPriceInputChunks({planHash:noPoolPlan.plan_hash,inputs,bindings,inputPoolHash});
 await assert.rejects(call(CHUNK,sealed.chunks[0].args),/MARKET_REFERENCE_EDITION_SEALED/);
 const emptyPlan=await freshPlan(),emptyPool=prepareDailyAiMarketPriceInputChunks({planHash:emptyPlan.plan_hash,inputs:{},bindings:{},inputPoolHash:marketSnapshotHash({})});
 assert.equal(emptyPool.chunks.length,1);assert.equal(bodyOf(emptyPool.chunks[0]).chunk_index,0);
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:emptyPool.chunks[0]})).state,'STAGED');
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:emptyPool.finalize})).state,'STAGED');
 const emptyState=await state(emptyPlan);assert.equal(emptyState.nodes,0);assert.equal(emptyState.bindings,0);assert.equal(emptyState.pools,1);
 const current=await state(plan);assert.equal(current.reviews,0);assert.equal(current.publications,0);
 pass('sealed/legacy exact replay and sole empty-pool chunk work without adding prices, review or publication');

 const tableNames=['price_input_chunk_sets','price_input_chunks','price_input_nodes','price_input_raw_bindings'];
 for(const role of ['anon','authenticated','service_role']){
  await f.identity(role==='authenticated'?f.owner:null,role);
  for(const name of tableNames)await assert.rejects(db.query('select * from vnext_market.'+name),e=>e.code==='42501');
  await assert.rejects(db.query('select vnext_market.price_validate_raw_binding_v2($1,$2,$3,$4)',[f.universe.universe_hash,plan.cutoff,sid,binding]),e=>e.code==='42501');
  if(role!=='service_role')for(const item of [prepared.chunks[0],prepared.finalize])await assert.rejects(call(item.rpc,item.args),e=>e.code==='42501');
 }
 await admin();const flags=(await db.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='vnext_market'::regnamespace and relname=any($1)",[tableNames])).rows;
 assert.equal(flags.length,4);assert(flags.every(r=>r.relrowsecurity&&r.relforcerowsecurity));
 for(const name of tableNames){
  await assert.rejects(db.query('update vnext_market.'+name+' set plan_id=plan_id'),/MARKET_IMMUTABLE/);
  await assert.rejects(db.query('delete from vnext_market.'+name),/MARKET_IMMUTABLE/);
 }
 await service();const beforeRollback=await state(plan);await admin();
 await db.exec(readFileSync(new URL('../research/daily-ai-market-reference-chunks.rollback.sql',import.meta.url),'utf8'));await service();
 for(const item of [prepared.chunks[0],prepared.finalize])await assert.rejects(call(item.rpc,item.args),e=>e.code==='42501');
 assert.deepEqual(await state(plan),beforeRollback);
 assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:original})).replayed,true);
 pass('FORCE RLS, service-only RPC grants, immutable tables and feature-only rollback retain every original byte');
}finally{await f.close();}
