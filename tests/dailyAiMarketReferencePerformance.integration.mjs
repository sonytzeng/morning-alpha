// Disposable PGlite only. Measure the exact same retained real-reference
// inputs before/after an equivalent helper optimization. No source download,
// shared database, publication, approval or production write is performed.
// These timings isolate expansion/hash/source-binding work, not a full RPC.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import {createMarketOwnerFixture} from './helpers/dailyAiMarketOwnerFixture.mjs';
import {marketSnapshotHash as hash} from '../research/taiwan-market-universe.mjs';

for(const key of ['MA_PGLITE_MODULE','MA_REFERENCE_RUN_DIR','MA_REFERENCE_PERFORMANCE_RECEIPT'])if(!process.env[key])throw Error(key+'_REQUIRED');
const sha=v=>createHash('sha256').update(v).digest('hex'),runDir=process.env.MA_REFERENCE_RUN_DIR;
const poolBytes=readFileSync(resolve(runDir,'price-input-pool.json')),bindingBytes=readFileSync(resolve(runDir,'price-input-bindings.json'));
const inputs=JSON.parse(poolBytes),bindings=JSON.parse(bindingBytes),all=JSON.parse(readFileSync(resolve(runDir,'price-research.json'),'utf8'));
const selected=[];
for(const stock of all)for(const horizon of ['SHORT','MEDIUM','LONG']){
 const reference=stock[horizon.toLowerCase()];
 if(reference&&(horizon==='SHORT'&&reference.schema==='TAIWAN_OBSERVED_PRICE_RANGE_V1'||reference.state==='CALCULATED_RESEARCH_ONLY'))
  selected.push({security_id:stock.security_id,horizon,reference,reference_hash:reference.reference_hash});
}
assert(selected.length>=32);
const sample=selected.slice(0,32),f=await createMarketOwnerFixture(),{db}=f;
const signatures=['vnext_market.price_expand(jsonb,jsonb,integer)','vnext_market.price_validate_reference_sources(jsonb,jsonb,text,integer)',
 'public.stage_daily_ai_market_price_references_v2(text,text,text)'];
const beforeHashes=['14cba48a127da9b3bb500f691132c5df','f4f701242475042224408f8bdf3b8f1a','71fe131c114760f4373f0b7cc5881d40'];
const afterHashes=['19cae08b9d07c70247c1db91daa6e7ee','c32673666a53f6750ac474f1259931a3','296cdb91f6446b567275c8001fd25a42'];
const receipt={schema:'MARKET_REFERENCE_EQUIVALENT_PERFORMANCE_V1',started_at:new Date().toISOString(),runtime:process.version,
 source_files:{pool:{bytes:poolBytes.length,sha256:sha(poolBytes)},bindings:{bytes:bindingBytes.length,sha256:sha(bindingBytes)}},
 input_pool_hash:hash(inputs),pool_nodes:Object.keys(inputs).length,raw_bindings:Object.keys(bindings).length,
 measurement_scope:'REAL_REFERENCE_EXPANSION_CANONICAL_HASH_AND_SOURCE_BINDINGS_ONLY_NOT_FULL_RPC',
 sizes:[8,16,32],measurements:[],equivalence_cases:0,production_writes:0,provider_requests:0,shared_database_opened:false};
const save=()=>writeFileSync(process.env.MA_REFERENCE_PERFORMANCE_RECEIPT,JSON.stringify(receipt,null,2)+'\n');
let phase=0;const pass=label=>console.log(JSON.stringify({phase:++phase,state:'PASS',label}));
async function hashes(){return(await db.query('select md5(p.prosrc) hash from unnest($1::text[]) with ordinality s(signature,ord) join pg_proc p on p.oid=s.signature::regprocedure order by ord',[signatures])).rows.map(r=>r.hash);}
async function outcome(sql,args){try{return{value:(await db.query(sql,args)).rows[0].value};}catch(e){return{error:{code:e.code,message:e.message}};}}
async function edges(){
 const leaf={capture_id:'a'.repeat(64),source_row_hash:'b'.repeat(64)},sid='TPEX:1259',bound={[hash(leaf)]:sid},out=[];
 const test=async(label,value,depth,sourceBindings=bound,identity=sid,pool={})=>{
  console.log(JSON.stringify({stage:'BOUNDARY',label}));
  out.push({label,expand:await outcome('select vnext_market.price_expand($1::jsonb,$2::jsonb,$3)::text value',[JSON.stringify(value),JSON.stringify(pool),depth]),
   sources:await outcome('select vnext_market.price_validate_reference_sources($1::jsonb,$2::jsonb,$3,$4) value',[JSON.stringify(value),JSON.stringify(sourceBindings),identity,depth])});
 };
 await test('scalar40','value',40);await test('scalar41','value',41);await test('objectScalar40',{x:1},40);await test('arrayScalar40',[1],40);
 await test('emptyObject40',{},40);await test('emptyArray40',[],40);await test('leafSource40',leaf,40);
 await test('inheritedIdentity',{source_capture:leaf},0);await test('overriddenIdentity',{security_id:'TPEX:1268',source_capture:leaf},0);
 await test('partialBinding',{capture_id:leaf.capture_id},0);await test('badParentIdentity',{security_id:'not-an-issuer',source_capture:leaf},0);
 const node={x:1},nodeHash=hash(node);await test('referenceScalarDepth40',{$price_input_ref:nodeHash},40,bound,sid,{[nodeHash]:node});
 await test('forgedNodeHash',{$price_input_ref:nodeHash},0,bound,sid,{[nodeHash]:{x:2}});
 // Exercise the exact 40/41 semantic boundary from depth 37. Deep SPI call
 // stacks in this WASM build can abort the engine before its error handler.
 let deep=0;for(let i=0;i<3;i++)deep={x:deep};await test('scalarAtNested40',deep,37);await test('scalarAtNested41',{x:deep},37);
 return out;
}
try{
 await db.exec('reset role');
 for(const file of ['daily-ai-market-public-supplements.candidate.sql','daily-ai-market-action-coverage.candidate.sql','daily-ai-market-action-evidence-id.candidate.sql',
  'daily-ai-market-reference-chunks.candidate.sql','daily-ai-market-reference-capacity.candidate.sql','daily-ai-market-bvps.candidate.sql'])await f.executeFile(file);
 assert.deepEqual(await hashes(),beforeHashes);
 await db.exec(`set statement_timeout='85s';create schema performance_fixture;
  create table performance_fixture.pool(body jsonb not null);
  create table performance_fixture.refs(ordinal integer primary key,security_id text,horizon text,encoded jsonb,reference_hash text);
  create function performance_fixture.measure(p_count integer,p_extract_once boolean) returns jsonb language plpgsql set search_path='' as $$
  declare pool_body jsonb;price_inputs jsonb;price_bindings jsonb;item record;expanded jsonb;counted integer;actual_hash text;
   results jsonb:='[]';started timestamptz:=clock_timestamp();
  begin
   if p_count not in(8,16,32) then raise exception 'FIXTURE_COUNT';end if;
   select body into strict pool_body from performance_fixture.pool;
   if p_extract_once then price_inputs:=pool_body->'inputs';price_bindings:=pool_body->'bindings';end if;
   for item in select * from performance_fixture.refs order by ordinal limit p_count loop
    expanded:=vnext_market.price_expand(item.encoded-'input_encoding'-'encoded_hash',case when p_extract_once then price_inputs else pool_body->'inputs' end);
    actual_hash:=vnext_market.hash(expanded-'reference_hash');
    if actual_hash is distinct from item.reference_hash or expanded->>'reference_hash' is distinct from item.reference_hash then raise exception 'FIXTURE_REFERENCE_HASH';end if;
    counted:=vnext_market.price_validate_reference_sources(expanded,case when p_extract_once then price_bindings else pool_body->'bindings' end,item.security_id);
    results:=results||jsonb_build_array(jsonb_build_object('security_id',item.security_id,'horizon',item.horizon,'expanded_hash',actual_hash,'source_count',counted));
   end loop;
   return jsonb_build_object('items',p_count,'milliseconds',extract(epoch from clock_timestamp()-started)*1000,'results',results);
  end $$;`);
 await db.query('insert into performance_fixture.pool values($1::jsonb)',[JSON.stringify({inputs,bindings})]);
 await db.query(`insert into performance_fixture.refs select ord::integer,x->>'security_id',x->>'horizon',x->'reference',x->>'reference_hash'
  from jsonb_array_elements($1::jsonb) with ordinality t(x,ord)`,[JSON.stringify(sample)]);
 const originalEdges=await edges();
 assert.equal(originalEdges.find(x=>x.label==='scalar40').expand.value,'"value"');
 assert.equal(originalEdges.find(x=>x.label==='scalar41').expand.error.message,'MARKET_REFERENCE_DEPTH');
 assert.equal(originalEdges.find(x=>x.label==='leafSource40').sources.value,1);
 assert.equal(originalEdges.find(x=>x.label==='leafSource40').expand.error.message,'MARKET_REFERENCE_DEPTH');
 const countGuard="if n>60000 then raise exception 'MARKET_REFERENCE_INPUT_COUNT';end if;return n;";
 assert((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[signatures[1]])).rows[0].prosrc.includes(countGuard));
 for(const count of receipt.sizes){const measurement=(await db.query('select performance_fixture.measure($1,false) value',[count])).rows[0].value;
  receipt.measurements.push({variant:'ORIGINAL',...measurement});save();console.log(JSON.stringify({variant:'ORIGINAL',items:count,milliseconds:measurement.milliseconds}));}
 pass('original real-reference hashes and source counts recorded for the same 8 / 16 / 32 inputs and immutable full pool');

 await f.executeFile('daily-ai-market-reference-performance.candidate.sql');assert.deepEqual(await hashes(),afterHashes);
 const optimizedEdges=await edges();assert.deepEqual(optimizedEdges,originalEdges);receipt.equivalence_cases=optimizedEdges.length;
 assert((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[signatures[1]])).rows[0].prosrc.includes(countGuard));
 receipt.source_count_limit_guard_unchanged=true;
 await f.identity(null,'service_role');assert.equal((await f.call('stage_daily_ai_market_price_references_v2',f.preparedRefs.batches[0].args)).schema,'DAILY_AI_MARKET_PRICE_REFERENCES_STAGED_V1');
 await assert.rejects(db.query('select vnext_market.price_expand($1::jsonb,$2::jsonb)',[JSON.stringify({}),JSON.stringify({})]),e=>e.code==='42501');
 await db.exec('reset role');
 for(const count of receipt.sizes){const measurement=(await db.query('select performance_fixture.measure($1,true) value',[count])).rows[0].value;
  const before=receipt.measurements.find(m=>m.variant==='ORIGINAL'&&m.items===count);assert.deepEqual(measurement.results,before.results);
  receipt.measurements.push({variant:'OPTIMIZED',...measurement,speedup:before.milliseconds/measurement.milliseconds});save();
  console.log(JSON.stringify({variant:'OPTIMIZED',items:count,milliseconds:measurement.milliseconds,speedup:before.milliseconds/measurement.milliseconds}));}
 pass('depth / scalar / identity / partial-binding / node-hash outcomes and every real expanded hash/count are identical; the 60,000-source guard is unchanged');

 await f.executeFile('daily-ai-market-reference-performance.rollback.sql');assert.deepEqual(await hashes(),beforeHashes);
 const restored=(await db.query('select performance_fixture.measure(8,false) value')).rows[0].value;
 assert.deepEqual(restored.results,receipt.measurements[0].results);receipt.measurements.push({variant:'RESTORED_ORIGINAL',...restored});
 await f.identity(null,'service_role');assert.equal((await f.call('stage_daily_ai_market_price_references_v2',f.preparedRefs.batches[0].args)).schema,'DAILY_AI_MARKET_PRICE_REFERENCES_STAGED_V1');
 receipt.state='PASS';receipt.completed_at=new Date().toISOString();receipt.max_rss_bytes=process.resourceUsage().maxRSS*1024;save();
 pass('rollback restores all three exact predecessor bodies and legacy immutable replay; no production or shared database was opened');
}catch(e){receipt.state='FAIL';receipt.failure={phase,code:e.code,message:e.message};save();console.error(JSON.stringify({...receipt.failure,where:e.where,stack:e.stack?.split('\n').slice(0,4)}));process.exitCode=1;}
finally{try{await f.close();}catch(e){console.error(JSON.stringify({fixture_close_error:e.message}));process.exitCode=1;}}
