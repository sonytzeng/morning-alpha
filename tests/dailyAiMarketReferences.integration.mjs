// Disposable PGlite/Auth fixture. Every issuer, bar, valuation, source right
// and review here is SYNTHETIC. No provider, production or browser calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import {URL} from 'node:url';
import {normalizeOfficialCompanyCapture,buildTaiwanMarketUniverse,planTaiwanMarketAnalysis,marketSnapshotHash,
 TAIWAN_COMPANY_SOURCES} from '../research/taiwan-market-universe.mjs';
import {marketStageCanonical as canonical,prepareDailyAiMarketShard,stageDailyAiMarketCapture,
 stageDailyAiMarketWorkPlan,finishDailyAiMarketEdition} from '../research/daily-ai-market-stage.mjs';
import {compactTaiwanPriceReference,expandTaiwanPriceReference,taiwanResearchReferenceSummary} from '../research/taiwan-market-price-reference.mjs';
import {createDailyAiMarketPageRequestV2,parseDailyAiMarketPageV2,cacheDailyAiMarketPageV2} from '../src/features/vnext/dailyAiMarketPageV2.ts';
import {isMarketTradingDate,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

if(!process.env.MA_PGLITE_MODULE)throw Error('MA_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
const sha=value=>createHash('sha256').update(value).digest('hex'),clone=value=>JSON.parse(JSON.stringify(value));
const owner='00000000-0000-0000-0000-000000000001',premium='00000000-0000-0000-0000-000000000002',free='00000000-0000-0000-0000-000000000003';
const at=Date.now(),received=new Date(at-120000).toISOString(),formed=new Date(at-90000).toISOString(),cutoff=new Date(at-60000).toISOString();
const day=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
const quoteDay=isMarketTradingDate('TW',day)&&Date.parse(cutoff)>=Date.parse(day+'T17:05:00+08:00')?day:previousMarketTradingDate('TW',day);
const issuer='TWSE:1000',csvCell=value=>'"'+String(value).replaceAll('"','""')+'"';
const captures=[],rosters=[],rawRows=new Map(),valuationRows=new Map(),history=[];
let phase=0,plan,universe,poolBody,items,expiry,finished;
const passed=label=>console.log(JSON.stringify({phase:++phase,result:'PASS',label}));
async function identity(id,role='authenticated'){
 await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[id??'']);await db.exec('set role '+role);
}
async function call(name,args){
 assert.match(name,/^[a-z_0-9]+$/);const values=Object.values(args);
 return (await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result;
}
async function rpc(name,args){try{return {data:await call(name,args),error:null};}catch(error){return {data:null,error:{code:error.code,message:error.message}};}}
async function counts(){
 await db.exec('reset role');const result=(await db.query(`select
  (select count(*)::int from vnext_market.price_input_pools) pools,
  (select count(*)::int from vnext_market.price_references) refs,
  (select count(*)::int from vnext_market.stock_results) stocks,
  (select count(*)::int from vnext_market.cards) cards,
  (select count(*)::int from vnext_market.shard_results) shards,
  (select count(*)::int from vnext_market.evidence) evidence,
  (select count(*)::int from vnext_market.plan_sources) sources`)).rows[0];await db.exec('set role service_role');return result;
}
const scope=(id,tier)=>({identity:id,tier,generation:1,signal:new globalThis.AbortController().signal,requestDate:new Date(Date.now()+8*3600000).toISOString().slice(0,10)});
async function page(id,tier,horizon='MEDIUM',cache=null){
 await identity(id);const auth=scope(id,tier),query={horizon,market:'ALL',status:'ALL',search:'',sort:'STATUS_MARKET_SYMBOL_ASC',page_size:60};
 const request=await createDailyAiMarketPageRequestV2(auth,query,{}),raw=await call('get_daily_ai_member_market_page_v2',{p_request:request});
 const parsed=await parseDailyAiMarketPageV2(raw,auth,request,cache);return {raw,parsed,auth,request,cache:cacheDailyAiMarketPageV2(parsed,auth,request)};
}
async function capture(source_id,url,body,format='json',row_count=Array.isArray(body)?body.length:null){
 const text=typeof body==='string'?body:JSON.stringify(body),bytes=Buffer.from(text),receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id,url,
  format,state:'CAPTURED',status:200,started_at:new Date(at-121000).toISOString(),received_at:received,bytes:bytes.length,sha256:sha(bytes),row_count,synthetic_fixture:true};
 const item={receipt,bytes},staged=await stageDailyAiMarketCapture({rpc,...item});assert.equal(staged.state,'STAGED',JSON.stringify(staged));captures.push(item);return item;
}
function binding(capture,row,index,path=[index],field='公司代號'){
 const r=capture.receipt;return {capture_id:marketSnapshotHash({source_id:r.source_id,url:r.url,source_sha256:r.sha256,received_at:r.received_at}),
  source_id:r.source_id,source_url:r.url,source_sha256:r.sha256,source_bytes:r.bytes,received_at:r.received_at,
  row_index:index,row_path:path,symbol_field:field,source_row_hash:marketSnapshotHash(row)};
}
function evidence(symbol,kind,body){
 const content=canonical(body),hash=sha(content);return {id:'market-'+hash.slice(0,40),symbol,kind,source:body.source_capture.source_url,published_at:null,
  available_at:received,first_seen_at:received,as_of:received,time_basis:'OBSERVED_AFTER_RECEIPT',evidence_hash:hash,content};
}
function result(company){
 const raw=rawRows.get(company.security_id),values=[evidence(company.symbol,'MARKET',{kind:'OFFICIAL_SECURITY_IDENTITY',symbol:company.symbol,
  market:company.market,fixture:'SYNTHETIC_TEST_ONLY',source_capture:binding(raw.capture,raw.row,raw.index)})];
 if(valuationRows.has(company.security_id))values.push(evidence(company.symbol,'FINANCIAL',{kind:'SYNTHETIC_VALUATION',symbol:company.symbol,
  source_capture:valuationRows.get(company.security_id).binding}));
 if(company.security_id===issuer)for(const bar of history)values.push(evidence(company.symbol,'PRICE',bar));
 const packet={symbol:company.symbol,company:company.company,cutoff:plan.cutoff,data_through:quoteDay,data_gaps:['SYNTHETIC_TEST_ONLY'],evidence:values};
 const analysis={schema:'DAILY_AI_STOCK_ANALYSIS_V2',symbol:company.symbol,cutoff:plan.cutoff,input_hash:marketSnapshotHash(packet),
  analysis_origin:'DETERMINISTIC_SCREENING',method_version:'TAIWAN_MARKET_RESEARCH_V1',model_generated:false,member_published:false,
  sources:values.map(({content:ignored,...source})=>{void ignored;return source;}),horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',
   reason:{text:'SYNTHETIC contract fixture, not an investment conclusion.',evidence_ids:[values[0].id]},counter_evidence:[],
   confirmation:'SYNTHETIC confirmation only.',invalidation:'SYNTHETIC invalidation only.',gaps:[]}))};
 return {security_id:company.security_id,packet,analysis};
}
function poolDocument(inputs,bindings){return {schema:'TAIWAN_MARKET_PRICE_INPUT_POOL_V1',plan_hash:plan.plan_hash,input_pool_hash:marketSnapshotHash(inputs),inputs,bindings};}
function bodyArgs(body){const text=canonical(body);return {p_plan_hash:plan.plan_hash,p_body_text:text,p_body_hash:sha(text)};}
const stagePool=body=>call('stage_daily_ai_market_price_inputs_v2',bodyArgs(body));
const batch=entries=>({schema:'TAIWAN_MARKET_PRICE_REFERENCE_BATCH_V1',plan_hash:plan.plan_hash,input_pool_hash:poolBody.input_pool_hash,items:entries});
const stageReferences=entries=>call('stage_daily_ai_market_price_references_v2',bodyArgs(batch(entries)));
function encodedItem(horizon,full,inputs,bindings){
 const encoded=compactTaiwanPriceReference(full,inputs,bindings),expanded=expandTaiwanPriceReference(encoded,inputs);
 return {security_id:issuer,horizon,reference_text:canonical(encoded),reference_hash:expanded.reference_hash,summary:null};
}
function reencode(item,change){
 const full=expandTaiwanPriceReference(JSON.parse(item.reference_text),poolBody.inputs);delete full.reference_hash;change(full);
 full.reference_hash=marketSnapshotHash(full);const encoded={...full,input_encoding:'SHARED_PRICE_INPUTS_V1',encoded_hash:marketSnapshotHash(full)};
 const summary=taiwanResearchReferenceSummary({security_id:issuer,horizon:item.horizon,reference:full,input_pool_hash:poolBody.input_pool_hash});
 return {...item,reference_text:canonical(encoded),reference_hash:full.reference_hash,summary};
}
function shardArgs(claim,{legacy=false}={}){
 const results=claim.companies.map(result),prepared=prepareDailyAiMarketShard({planHash:plan.plan_hash,shard:claim.shard,leaseId:claim.lease_id,results});
 if(legacy)return prepared.args;
 const body=JSON.parse(prepared.args.p_result_text);body.schema='DAILY_AI_MARKET_SHARD_RESULT_WITH_REFERENCES_V2';
 for(const row of body.items){const refs=Object.fromEntries(['SHORT','MEDIUM','LONG'].map(h=>[h,items.find(i=>i.security_id===row.security_id&&i.horizon===h)?.summary??null]));
  row.references_text=canonical(refs);row.references_hash=sha(row.references_text);}
 const text=canonical(body);return {...prepared.args,p_result_text:text,p_result_hash:sha(text)};
}

try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
  create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
  insert into auth.users values('${owner}',false),('${premium}',false),('${free}',false);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create table public.profiles(id uuid primary key,role text,subscription_status text,paid_until timestamptz);
  insert into public.profiles values('${owner}','admin',null,null),('${premium}','member',null,null),('${free}','member',null,null);
  create table public.member_entitlements(user_id uuid primary key,state text,access_ends_at timestamptz,current_period_end timestamptz,trial_ends_at timestamptz);
  insert into public.member_entitlements values('${premium}','paid_active',now()+interval '1 hour',null,null),('${free}','free',null,null,null);
  create function public.is_research_owner_v1() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
  create schema academy_private;create schema vnext_private;create table vnext_private.source_licenses(source text primary key,
   storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
 const access=readFileSync(new URL('../supabase/migrations/20261009053655_academy_member_learning_v11.sql',import.meta.url),'utf8');
 const start=access.indexOf('create function academy_private.access_v11()'),end=access.indexOf('revoke all on function academy_private.access_v11()',start);
 assert(start>0&&end>start);await db.exec(access.slice(start,end));
 for(const file of ['daily-ai-market-v2.candidate.sql','daily-ai-market-financial-csv.candidate.sql','daily-ai-market-references.candidate.sql'])await db.exec(readFileSync(new URL('../research/'+file,import.meta.url),'utf8'));
 await identity(null,'service_role');let index=0,marketIndex=0;
 for(const [sourceId,spec]of Object.entries(TAIWAN_COMPANY_SOURCES)){
  const rows=Array.from({length:marketIndex++<2?28:27},()=>{const symbol=String(1000+index++);return {'公司代號':symbol,'公司名稱':'Synthetic issuer '+symbol,'公司簡稱':'Synthetic '+symbol,
   '產業別':'01','出表日期':day.replaceAll('-',''),[spec.market==='TPEX'?'上櫃日期':'上市日期']:'20200101'};});
  const body=spec.format==='json'?rows:'\uFEFF'+Object.keys(rows[0]).map(csvCell).join(',')+'\r\n'+rows.map(r=>Object.values(r).map(csvCell).join(',')).join('\r\n')+'\r\n';
  const cap=await capture(sourceId,spec.url,body,spec.format,rows.length);rosters.push(normalizeOfficialCompanyCapture(cap));rows.forEach((row,i)=>rawRows.set(spec.market+':'+row.公司代號,{row,index:i,capture:cap}));
 }
 const rawVals=Array.from({length:6},(_,i)=>({'公司代號':String(1000+i),close:119,pe:[10,8,10,12,16,20][i],pb:[2,1.2,1.5,2,2.5,2.8][i],date:quoteDay,synthetic:true}));
 const vc=await capture('twse_valuation','https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d',rawVals);
 rawVals.forEach((row,i)=>valuationRows.set('TWSE:'+row.公司代號,{row,binding:binding(vc,row,i)}));
 const dates=[quoteDay];while(dates.length<20)dates.unshift(previousMarketTradingDate('TW',dates[0]));
 for(const [i,date]of dates.entries()){
  const close=100+i,row=['1000','SYNTHETIC','1000','1','100000',String(close),String(close+2),String(close-2),String(close)];
  const cap=await capture('TWSE_DAILY_'+date.replaceAll('-',''),'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date='+date.replaceAll('-','')+'&type=ALLBUT0999&response=json',
   {stat:'OK',date:date.replaceAll('-',''),tables:[{data:[row]}]});
  history.push({schema:'TAIWAN_MARKET_HISTORY_OBSERVATION_V1',kind:'DAILY_OHLCVA',family:'PRICE',symbol:'1000',market:'TWSE',date,open:close,high:close+2,low:close-2,close,
   volume:1000,amount:100000,currency:'TWD',price_basis:'RAW_UNADJUSTED',session_scope:'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES',all_trades_session_complete:true,
   source_capture:binding(cap,row,0,['tables',0,'data',0],'0')});
 }
 universe=buildTaiwanMarketUniverse({rosters,formed_at:formed});plan=planTaiwanMarketAnalysis({universe,business_date:day,cutoff,shard_size:64});
 assert.equal((await stageDailyAiMarketWorkPlan({rpc,universe,plan})).state,'STAGED');
 const baseBinding=valuationRows.get(issuer).binding,beforePool=await counts();
 for(const change of [b=>b.source_sha256='0'.repeat(64),b=>b.source_row_hash='1'.repeat(64),b=>b.received_at=new Date(at-86400000).toISOString()]){
  const bad=clone(baseBinding);change(bad);const hash=marketSnapshotHash(bad);await assert.rejects(stagePool(poolDocument({[hash]:bad},{[hash]:issuer})),/MARKET_EVIDENCE_/);assert.deepEqual(await counts(),beforePool);
 }
 const hash=marketSnapshotHash(baseBinding);await assert.rejects(stagePool(poolDocument({[hash]:baseBinding},{[hash]:'TWSE:1001'})),/MARKET_EVIDENCE_SYMBOL/);assert.deepEqual(await counts(),beforePool);
 const peerRows=Array.from(valuationRows.entries()).filter(([id])=>id!==issuer),inputs={},bindings={};
 const common={security_id:issuer,state:'CALCULATED_RESEARCH_ONLY',quote_date:quoteDay,current_price:119,peer_count:5,
  issuer_source_captures:[baseBinding],forecast:false,buy_ready:false,production_eligible:false,review:null,fixture:'SYNTHETIC_TEST_ONLY'};
 const medium={...common,schema:'TAIWAN_PEER_RERATING_SCENARIO_V1',method:'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE',metric:'PE',
  current_multiple:10,peer_quantiles:[.25,.5,.75],multiple_scenarios:[10,12,16],price_scenarios:[119,142.8,190.4],
  peers:peerRows.map(([security_id,v])=>({security_id,multiple:v.row.pe,source_capture:v.binding}))};
 const long={...common,schema:'TAIWAN_LONG_QUALITY_PEER_PB_REFERENCE_V1',method:'CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB',method_version:'TAIWAN_LONG_QUALITY_PEER_PB_V1',
  metric:'PB',current_official_pb:2,peer_quantiles:[.25,.5,.75],multiple_scenarios:[1.5,2,2.5],price_scenarios:[89.25,119,148.75],
  peers:peerRows.map(([security_id,v])=>({security_id,official_pb:v.row.pb,market_source_captures:[v.binding],annual_quality:{fixture:'SYNTHETIC_PROJECTION_ONLY'}}))};
 const short={schema:'TAIWAN_OBSERVED_PRICE_RANGE_V1',security_id:issuer,through:quoteDay,current_price:119,range:[98,121],
  input_packet_hash:result(universe.companies.find(c=>c.security_id===issuer)).analysis.input_hash,source_capture_ids:history.map(b=>b.source_capture.capture_id),
  forecast:false,buy_ready:false,production_eligible:false,fixture:'SYNTHETIC_TEST_ONLY'};
 items=[encodedItem('SHORT',short,inputs,bindings),encodedItem('MEDIUM',medium,inputs,bindings),encodedItem('LONG',long,inputs,bindings)];poolBody=poolDocument(inputs,bindings);
 for(const item of items){const expanded=expandTaiwanPriceReference(JSON.parse(item.reference_text),inputs);item.summary=taiwanResearchReferenceSummary({security_id:issuer,horizon:item.horizon,reference:expanded,input_pool_hash:poolBody.input_pool_hash});}
 assert.equal((await stagePool(poolBody)).replayed,false);assert.equal((await stagePool(poolBody)).replayed,true);
 const changed=clone(poolBody);changed.inputs.extra={};changed.input_pool_hash=marketSnapshotHash(changed.inputs);await assert.rejects(stagePool(changed),/MARKET_REFERENCE_INPUT_REPLAY/);
 const persistedPool=await counts();assert.equal(persistedPool.pools,1);assert.equal(persistedPool.refs,0);
 passed('pool verifies original raw hash, row hash, symbol and receipt time; exact replay is immutable');

 const summaryBad=clone(items);summaryBad.at(-1).summary.lower+=1;await assert.rejects(stageReferences(summaryBad),/MARKET_REFERENCE_SUMMARY/);assert.equal((await counts()).refs,0);
 const nullMethod=reencode(items[1],r=>r.method=null);await assert.rejects(stageReferences([nullMethod]),/MARKET_REFERENCE_(?:METHOD|SUMMARY)/);
 const inlineBad=reencode(items[1],r=>r.issuer_source_captures[0].source_row_hash='9'.repeat(64));await assert.rejects(stageReferences([inlineBad]),/MARKET_REFERENCE_(?:SOURCE|POOL)_/);
 const issuerMismatch=reencode(items[1],r=>r.issuer_source_captures[0]=peerRows[0][1].binding);await assert.rejects(stageReferences([issuerMismatch]),/MARKET_REFERENCE_SOURCE_/);
 assert.equal((await counts()).refs,0);
 // An internally consistent but invented SHORT range cannot cross the atomic
 // packet boundary, even when its summary and calculation hashes all match.
 for(const change of [r=>r.range[0]=99,r=>r.current_price=118,r=>r.input_packet_hash='0'.repeat(64)]){
  await db.exec('begin');
  try{
   const temporary=[reencode(items[0],change),items[1],items[2]];await stageReferences(temporary);
   const work=await call('claim_daily_ai_market_shard_v2',{p_plan_hash:plan.plan_hash,p_worker_ref:'synthetic-short-negative',p_request_key:randomUUID()});
   const args=shardArgs(work),body=JSON.parse(args.p_result_text),row=body.items.find(i=>i.security_id===issuer);
   row.references_text=canonical(Object.fromEntries(temporary.map(item=>[item.horizon,item.summary])));row.references_hash=sha(row.references_text);
   const text=canonical(body);await assert.rejects(call('stage_daily_ai_market_shard_with_references_v2',{...args,p_result_text:text,p_result_hash:sha(text)}),/MARKET_REFERENCE_SHORT_/);
  }finally{await db.exec('rollback');}
 }
 assert.equal((await counts()).refs,0);const registered=await stageReferences(items);assert.equal(registered.items,3);assert.equal((await stageReferences(items)).items,3);
 await db.exec('reset role');await assert.rejects(db.exec('update vnext_market.price_references set reference_hash=reference_hash'),/MARKET_IMMUTABLE/);
 await assert.rejects(db.exec('delete from vnext_market.price_input_pools'),/MARKET_IMMUTABLE/);
 await identity(premium);await assert.rejects(call('get_daily_ai_owner_market_references_v2',{p_plan_hash:plan.plan_hash,p_security_id:issuer}),e=>e.code==='42501');
 await assert.rejects(db.query('select * from vnext_market.price_input_pools'),e=>e.code==='42501');
 await identity(owner);const preview=await call('get_daily_ai_owner_market_references_v2',{p_plan_hash:plan.plan_hash,p_security_id:issuer});
 assert.equal(preview.references.length,3);for(const r of preview.references)assert.deepEqual(r.summary,items.find(i=>i.horizon===r.horizon).summary);
 const missing=await call('get_daily_ai_owner_market_references_v2',{p_plan_hash:plan.plan_hash,p_security_id:'TWSE:1001'});assert.deepEqual(missing.references,[]);
 await db.exec('reset role');await db.query('update auth.users set is_anonymous=true where id=$1',[owner]);await identity(owner);
 await assert.rejects(call('get_daily_ai_owner_market_references_v2',{p_plan_hash:plan.plan_hash,p_security_id:issuer}),e=>e.code==='42501');
 await db.exec('reset role');await db.query('update auth.users set is_anonymous=false where id=$1',[owner]);await identity(null,'service_role');
 passed('registry expands the exact shared inputs, rejects changed summaries, null methods and unbound inline sources; Owner access keeps all existing gates');

 const claim=await call('claim_daily_ai_market_shard_v2',{p_plan_hash:plan.plan_hash,p_worker_ref:'synthetic-reference-worker',p_request_key:randomUUID()});
 const args=shardArgs(claim),body=JSON.parse(args.p_result_text),badBody=clone(body),last=badBody.items.at(-1);
 last.references_text=canonical({SHORT:null,MEDIUM:items[1].summary,LONG:null});last.references_hash=sha(last.references_text);
 const beforeShard=await counts(),badText=canonical(badBody);await assert.rejects(call('stage_daily_ai_market_shard_with_references_v2',{...args,p_result_text:badText,p_result_hash:sha(badText)}),/MARKET_REFERENCE_PROJECTION_BINDING/);
 assert.deepEqual(await counts(),beforeShard);
 // Projection must also recompute the observed range from the same packet.
 const shortCorrupt=clone(body),row=shortCorrupt.items.find(i=>i.security_id===issuer),packet=JSON.parse(row.packet_text);
 const bar=packet.evidence.find(e=>JSON.parse(e.content).schema==='TAIWAN_MARKET_HISTORY_OBSERVATION_V1');
 const altered=JSON.parse(bar.content);altered.low-=1;bar.content=canonical(altered);bar.evidence_hash=sha(bar.content);bar.id='market-'+bar.evidence_hash.slice(0,40);
 row.packet_text=canonical(packet);row.packet_hash=sha(row.packet_text);const analysis=JSON.parse(row.analysis_text);analysis.input_hash=row.packet_hash;
 analysis.sources=packet.evidence.map(({content:ignored,...s})=>{void ignored;return s;});row.analysis_text=canonical(analysis);row.analysis_hash=sha(row.analysis_text);
 const badShortText=canonical(shortCorrupt);await assert.rejects(call('stage_daily_ai_market_shard_with_references_v2',{...args,p_result_text:badShortText,p_result_hash:sha(badShortText)}),/MARKET_REFERENCE_SHORT_/);assert.deepEqual(await counts(),beforeShard);
 const staged=await call('stage_daily_ai_market_shard_with_references_v2',args);assert.equal(staged.result_hash,args.p_result_hash);assert.equal(staged.replayed,false);
 assert.equal((await call('stage_daily_ai_market_shard_with_references_v2',args)).replayed,true);
 await db.exec('reset role');const saved=(await db.query('select result_hash,result_text from vnext_market.shard_results where shard_id=$1',[claim.shard.shard_id])).rows[0];
 assert.equal(sha(saved.result_text),saved.result_hash);assert.equal(saved.result_text,args.p_result_text);
 const savedCards=(await db.query('select horizon,card from vnext_market.cards where plan_id=$1 and security_id=$2',[plan.plan_hash,issuer])).rows;
 for(const c of savedCards)assert.deepEqual(c.card.research_reference,items.find(i=>i.horizon===c.horizon).summary);
 await identity(null,'service_role');const next=await call('claim_daily_ai_market_shard_v2',{p_plan_hash:plan.plan_hash,p_worker_ref:'synthetic-legacy-worker',p_request_key:randomUUID()});
 await call('stage_daily_ai_market_shard_v2',shardArgs(next,{legacy:true}));
 expiry=new Date(Date.now()+15000).toISOString();finished=await finishDailyAiMarketEdition({rpc,planHash:plan.plan_hash,expiresAt:expiry});assert.equal(finished.state,'STAGED_REVIEW_REQUIRED',JSON.stringify(finished));
 assert.equal((await counts()).cards,249);assert.equal((await stageReferences(items)).items,3,'finished immutable references support exact resume');
 await assert.rejects(stageReferences([reencode(items[1],r=>r.current_price=118)]),/MARKET_REFERENCE_REPLAY/);
 const newAfterFinish=clone(items[1]);newAfterFinish.security_id='TWSE:1001';await assert.rejects(stageReferences([newAfterFinish]),/MARKET_REFERENCE_/);
 passed('last-item reference corruption rolls back all stock/card/evidence writes; SHORT binds the exact packet and atomic results hash; legacy cards remain compatible');

 assert.equal((await page(premium,'premium')).parsed.edition,null);await identity(owner);
 assert.equal((await call('get_daily_ai_owner_market_references_v2',{p_plan_hash:plan.plan_hash,p_security_id:issuer})).references.length,3);
 const documents=['QUALITY','TIME','SOURCE_USE','METHODOLOGY'].map(kind=>{const text='SYNTHETIC '+kind+' review for control verification only.';return {kind,text,hash:sha(text)};});
 const reviewBody={schema:'DAILY_AI_MARKET_REVIEW_V2',edition_id:finished.edition_id,snapshot_hash:finished.edition_id,reviewer_ref:'synthetic-reviewer',quality:'PASS',time_status:'PASS',licensing:'PASS',methodology:'PASS',
  document_hashes:Object.fromEntries(documents.map(d=>[d.kind,d.hash])),reason:'SYNTHETIC only, not production approval.',expires_at:expiry};
 async function review(change={}){await identity(null,'service_role');const text=canonical({...reviewBody,...change});return call('stage_daily_ai_market_review_v2',{p_review_text:text,p_review_hash:sha(text),p_documents:documents});}
 let checked=await review(),approve={p_edition_id:finished.edition_id,p_review_id:checked.review_id,p_action:'APPROVE',p_audience:'free',p_request_key:randomUUID()};
 await identity(owner);await assert.rejects(call('review_daily_ai_market_edition_v2',approve),/MARKET_PUBLICATION_NOT_READY/);
 await db.exec('reset role');for(const url of [...new Set(captures.map(c=>c.receipt.url))])await db.query("insert into vnext_private.source_licenses values($1,true,true,true,now(),$2,'https://data.gov.tw/license','SYNTHETIC test rights only')",[url,expiry]);
 checked=await review({methodology:'FAIL',reason:'SYNTHETIC methodology not approved.'});await identity(owner);await assert.rejects(call('review_daily_ai_market_edition_v2',{...approve,p_review_id:checked.review_id,p_request_key:randomUUID()}),/MARKET_PUBLICATION_NOT_READY/);
 checked=await review({reason:'SYNTHETIC corrected control review.'});approve={...approve,p_review_id:checked.review_id,p_request_key:randomUUID()};await identity(owner);await call('review_daily_ai_market_edition_v2',approve);
 for(const horizon of ['SHORT','MEDIUM','LONG']){const data=await page(premium,'premium',horizon),card=data.parsed.cards.find(c=>c.symbol==='1000');
  assert.deepEqual(card.research_reference,items.find(i=>i.horizon===horizon).summary);assert.equal(card.price,null);assert.equal(card.research_reference.buy_ready,false);
  assert(data.parsed.cards.filter(c=>c.symbol!=='1000').every(c=>c.research_reference===null));}
 const freePage=await page(free,'free');assert.equal(freePage.parsed.cards.length,3);assert(freePage.raw.cards.every(c=>c.research_reference===null));
 await identity(null,'anon');await assert.rejects(call('get_daily_ai_member_market_page_v2',{p_request:freePage.request}),e=>e.code==='42501');
 passed('four PASS documents, current rights and Owner action precede visibility; real member parser accepts all three methods and free strips every reference');

 await db.exec('reset role');await db.query('update vnext_private.source_licenses set commercial_allowed=false where source=$1',[vc.receipt.url]);
 assert.equal((await page(premium,'premium')).parsed.edition,null);await db.exec('reset role');await db.query('update vnext_private.source_licenses set commercial_allowed=true where source=$1',[vc.receipt.url]);
 await identity(owner);await call('review_daily_ai_market_edition_v2',{...approve,p_action:'REVOKE',p_request_key:randomUUID()});assert.equal((await page(premium,'premium')).parsed.edition,null);
 await identity(owner);await call('review_daily_ai_market_edition_v2',{...approve,p_request_key:randomUUID()});assert.equal((await page(premium,'premium')).parsed.cards.find(c=>c.symbol==='1000').research_reference.lower,119);
 await new Promise(resolve=>globalThis.setTimeout(resolve,Math.max(0,Date.parse(expiry)-Date.now()+30)));
 const expired=await page(premium,'premium');assert.equal(expired.parsed.edition,null);assert.equal(expired.parsed.cards.length,0);
 passed('valuation-source rights withdrawal, Owner revoke and actual elapsed edition expiry all clear references and cards');
 console.log(JSON.stringify({result:'PASS',phases:phase,synthetic_securities:83,cards:249,registered_references:3,provider_requests:0,production_writes:0,methodology_approval:false}));
}catch(error){console.error(JSON.stringify({result:'FAIL',completed_phases:phase,message:error.message,code:error.code,where:error.where,stack:error.stack?.split('\n').slice(0,5)}));process.exitCode=1;}
finally{await db.close();}
