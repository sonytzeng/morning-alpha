// Disposable database and SYNTHETIC padded nodes. No real-data DB, HTTP or deployment.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import console from 'node:console';
import {createMarketOwnerFixture} from './helpers/dailyAiMarketOwnerFixture.mjs';
import {marketSnapshotHash,planTaiwanMarketAnalysis} from '../research/taiwan-market-universe.mjs';
import {marketStageCanonical as canonical,stageDailyAiMarketWorkPlan} from '../research/daily-ai-market-stage.mjs';
import {prepareDailyAiMarketPriceInputChunks,prepareDailyAiMarketPriceInputs,stageDailyAiMarketPricePrepared} from '../research/daily-ai-market-references-stage.mjs';

const f=await createMarketOwnerFixture(),sha=value=>createHash('sha256').update(value).digest('hex');
const chunkName='stage_daily_ai_market_price_input_chunk_v2',finalName='finalize_daily_ai_market_price_inputs_v2';
const expectedBefore=['e2cf76383a0de59d0a2e1f6966c68189','eb5baf5025258d30ec9f0e9040011258'];
async function definitions(){
 await f.db.exec('reset role');const values=[];
 for(const name of [chunkName,finalName])values.push((await f.db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',['public.'+name+'(text,text,text)'])).rows[0].hash);
 await f.identity(null,'service_role');return values;
}
try{
 await f.db.exec('reset role');await f.executeFile('daily-ai-market-reference-chunks.candidate.sql');await f.identity(null,'service_role');
 assert.deepEqual(await definitions(),expectedBefore);
 const cutoff=new Date(Date.parse(f.plan.cutoff)+100).toISOString();
 const plan=planTaiwanMarketAnalysis({universe:f.universe,cutoff,business_date:new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10),shard_size:64});
 assert.equal((await stageDailyAiMarketWorkPlan({rpc:f.rpc,universe:f.universe,plan})).state,'STAGED');
 const padding='SYNTHETIC_ONLY_'.repeat(36572),inputs={};
 for(let index=0;index<64;index++){const node={fixture:'SYNTHETIC_CAPACITY_BOUNDARY',index,padding};inputs[marketSnapshotHash(node)]=node;}
 const args={planHash:plan.plan_hash,inputs,bindings:{},inputPoolHash:marketSnapshotHash(inputs)};
 const body={schema:'TAIWAN_MARKET_PRICE_INPUT_POOL_V1',plan_hash:plan.plan_hash,input_pool_hash:args.inputPoolHash,inputs,bindings:{}};
 const bodyText=canonical(body),bodyHash=sha(bodyText),bytes=Buffer.byteLength(bodyText);
 assert(bytes>32000000&&bytes<64000000);assert.throws(()=>prepareDailyAiMarketPriceInputs(args),/REFERENCE_SIZE/);
 const prepared=prepareDailyAiMarketPriceInputChunks(args);assert.equal(prepared.original_body_hash,bodyHash);
 assert(prepared.chunks.every(c=>Buffer.byteLength(c.args.p_body_text)<=1000000));
 let accepted=0;
 for(const item of prepared.chunks){
  const result=await stageDailyAiMarketPricePrepared({rpc:f.rpc,prepared:item});
  if(result.state==='REJECTED'){assert.equal(result.reason,'MARKET_REFERENCE_INPUT_COUNT');break;}
  assert.equal(result.state,'STAGED',JSON.stringify(result));accepted++;
 }
 assert(accepted>0&&accepted<prepared.chunks.length);
 await assert.rejects(f.call(finalName,prepared.finalize.args),/MARKET_REFERENCE_FINALIZE_INCOMPLETE/);
 console.log(JSON.stringify({phase:1,state:'PASS',label:'original global 32 MB bound rejects the next chunk atomically',pool_bytes:bytes,accepted_chunks:accepted,total_chunks:prepared.chunks.length}));

 await f.db.exec('reset role');await f.executeFile('daily-ai-market-reference-capacity.candidate.sql');await f.identity(null,'service_role');
 assert.deepEqual(await definitions(),['9ac9067664841b6ac6e699cbe718884e','f9693db28224428d0ab48f1b61a92743']);
 for(const item of prepared.chunks.slice(accepted))assert.equal((await stageDailyAiMarketPricePrepared({rpc:f.rpc,prepared:item})).state,'STAGED');
 const finalized=await stageDailyAiMarketPricePrepared({rpc:f.rpc,prepared:prepared.finalize});assert.equal(finalized.state,'STAGED',JSON.stringify(finalized));assert.equal(finalized.replayed,false);
 await assert.rejects(f.call('stage_daily_ai_market_price_inputs_v2',{p_plan_hash:plan.plan_hash,p_body_text:bodyText,p_body_hash:bodyHash}),/MARKET_REFERENCE_INPUT_HASH/);
 await f.db.exec('reset role');
 const stored=(await f.db.query('select body_hash,octet_length(body_text) bytes from vnext_market.price_input_pools where plan_id=$1',[plan.plan_hash])).rows[0];
 assert.equal(stored.body_hash,bodyHash);assert.equal(stored.bytes,bytes);
 assert.equal((await f.db.query("select md5(prosrc) hash from pg_proc where oid='public.stage_daily_ai_market_price_inputs_v2(text,text,text)'::regprocedure")).rows[0].hash,'a8e5ee899c3231d5b70fd3e19178069b');
 await f.executeFile('daily-ai-market-reference-capacity.rollback.sql');await f.identity(null,'service_role');
 assert.deepEqual(await definitions(),expectedBefore);
 assert.equal((await stageDailyAiMarketPricePrepared({rpc:f.rpc,prepared:prepared.finalize})).replayed,true);
 await f.db.exec('reset role');
 const counts=(await f.db.query('select (select count(*)::int from vnext_market.reviews) reviews,(select count(*)::int from vnext_market.publication_events) publications')).rows[0];
 assert.deepEqual(counts,{reviews:0,publications:0});
 console.log(JSON.stringify({phase:2,state:'PASS',label:'guarded 64 MB extension accepts exact bounded pool; legacy stays 32 MB; rollback restores exact definitions and retains completed data',pool_bytes:bytes,body_hash:bodyHash,...counts}));
}finally{await f.close();}
