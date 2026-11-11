// SYNTHETIC issuers, inputs, reference, review documents and rights only.
// Disposable local PGlite; no HTTP, production or browser calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import {URL} from 'node:url';
import {normalizeOfficialCompanyCapture,buildTaiwanMarketUniverse,planTaiwanMarketAnalysis,marketSnapshotHash,TAIWAN_COMPANY_SOURCES} from '../../research/taiwan-market-universe.mjs';
import {marketStageCanonical as canonical,stageDailyAiMarketCapture,stageDailyAiMarketWorkPlan,finishDailyAiMarketEdition} from '../../research/daily-ai-market-stage.mjs';
import {compactTaiwanPriceReference} from '../../research/taiwan-market-price-reference.mjs';
import {prepareDailyAiMarketPriceInputs,prepareDailyAiMarketPriceReferenceBatches,stageDailyAiMarketPricePrepared,runDailyAiMarketShardWithReferences} from '../../research/daily-ai-market-references-stage.mjs';
import {previousMarketTradingDate} from '../../supabase/functions/_shared/market-session-contract.mjs';
export const OWNER_IDS={owner:'00000000-0000-0000-0000-000000000001',premium:'00000000-0000-0000-0000-000000000002',free:'00000000-0000-0000-0000-000000000003'};
export async function createMarketOwnerFixture({firstSymbol=1000,companyNames={}}={}){
 if(!process.env.MA_PGLITE_MODULE)throw Error('MA_PGLITE_MODULE_REQUIRED');
 const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
 const sha=value=>createHash('sha256').update(value).digest('hex'),at=Date.now(),received=new Date(at-120000).toISOString(),formed=new Date(at-90000).toISOString(),cutoff=new Date(at-60000).toISOString();
 const day=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10),quoteDay=previousMarketTradingDate('TW',day);
 const {owner,premium,free}=OWNER_IDS,rawRows=new Map(),valuation=new Map(),rosters=[];
 const executeFile=async file=>db.exec(readFileSync(new URL('../../research/'+file,import.meta.url),'utf8'));
 async function identity(id,role='authenticated'){await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[id??'']);await db.exec('set role '+role);}
 async function call(name,args={}){assert.match(name,/^[a-z_0-9]+$/);const values=Object.values(args);return(await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result;}
 async function rpc(name,args){try{return{data:await call(name,args),error:null};}catch(e){return{data:null,error:{code:e.code,message:e.message}};}}
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
  create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
  insert into auth.users values('${owner}',false),('${premium}',false),('${free}',false);
  create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create table public.profiles(id uuid primary key,role text,subscription_status text,paid_until timestamptz);
  insert into public.profiles values('${owner}','admin',null,null),('${premium}','member',null,null),('${free}','member',null,null);
  create table public.member_entitlements(user_id uuid primary key,state text,access_ends_at timestamptz,current_period_end timestamptz,trial_ends_at timestamptz);
  insert into public.member_entitlements values('${premium}','paid_active',now()+interval'1 hour',null,null),('${free}','free',null,null,null);
  create function public.is_research_owner_v1()returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
  create schema academy_private;create schema vnext_private;create table vnext_private.source_licenses(source text primary key,
   storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
 const access=readFileSync(new URL('../../supabase/migrations/20261009053655_academy_member_learning_v11.sql',import.meta.url),'utf8'),start=access.indexOf('create function academy_private.access_v11()'),end=access.indexOf('revoke all on function academy_private.access_v11()',start);
 assert(start>0&&end>start);await db.exec(access.slice(start,end));
 for(const file of ['daily-ai-market-v2.candidate.sql','daily-ai-market-financial-csv.candidate.sql','daily-ai-market-references.candidate.sql','daily-ai-market-owner-review.candidate.sql'])await executeFile(file);
 await identity(null,'service_role');
 async function capture(source_id,url,body,format='json',row_count=body.length){
  const bytes=Buffer.from(typeof body==='string'?body:JSON.stringify(body)),receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id,url,format,state:'CAPTURED',status:200,
   started_at:new Date(at-121000).toISOString(),received_at:received,bytes:bytes.length,sha256:sha(bytes),row_count,synthetic_fixture:true};
  assert.equal((await stageDailyAiMarketCapture({rpc,receipt,bytes})).state,'STAGED');return{receipt,bytes};
 }
 const csvCell=v=>'"'+String(v).replaceAll('"','""')+'"';let index=0;
 for(const [id,spec]of Object.entries(TAIWAN_COMPANY_SOURCES)){
  const rows=Array.from({length:spec.market==='TWSE'?12:6},()=>{const symbol=String(firstSymbol+index++);return{'公司代號':symbol,'公司名稱':companyNames[symbol]?.company??'SYNTHETIC issuer '+symbol,'公司簡稱':companyNames[symbol]?.short_name??'SYNTHETIC '+symbol,'產業別':'01','出表日期':day.replaceAll('-',''),[spec.market==='TPEX'?'上櫃日期':'上市日期']:'20200101'};});
  const body=spec.format==='json'?rows:Object.keys(rows[0]).map(csvCell).join(',')+'\r\n'+rows.map(row=>Object.values(row).map(csvCell).join(',')).join('\r\n')+'\r\n';
  const cap=await capture(id,spec.url,body,spec.format,rows.length);rosters.push(normalizeOfficialCompanyCapture(cap));rows.forEach((row,i)=>rawRows.set(spec.market+':'+row.公司代號,{cap,row,index:i}));
 }
 const rows=Array.from({length:6},(_,i)=>({'公司代號':String(firstSymbol+i),date:quoteDay,close:100,pe:[10,8,10,12,16,20][i],synthetic:true}));
 const vc=await capture('twse_valuation','https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d',rows);rows.forEach((row,i)=>valuation.set('TWSE:'+row.公司代號,{cap:vc,row,index:i}));
 function binding(item){const {cap:{receipt:r},row,index:i}=item;return {capture_id:marketSnapshotHash({source_id:r.source_id,url:r.url,source_sha256:r.sha256,received_at:r.received_at}),source_id:r.source_id,
  source_url:r.url,source_sha256:r.sha256,source_bytes:r.bytes,received_at:r.received_at,row_index:i,row_path:[i],symbol_field:'公司代號',source_row_hash:marketSnapshotHash(row)};}
 const universe=buildTaiwanMarketUniverse({rosters,formed_at:formed}),plan=planTaiwanMarketAnalysis({universe,business_date:day,cutoff,shard_size:64});
 assert.equal((await stageDailyAiMarketWorkPlan({rpc,universe,plan})).state,'STAGED');
 const issuer='TWSE:'+firstSymbol,inputs={},bindings={},full={schema:'TAIWAN_PEER_RERATING_SCENARIO_V1',security_id:issuer,state:'CALCULATED_RESEARCH_ONLY',method:'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE',
  quote_date:quoteDay,current_price:100,metric:'PE',current_multiple:10,peer_count:5,peer_quantiles:[.25,.5,.75],multiple_scenarios:[10,12,16],price_scenarios:[100,120,160],
  issuer_source_captures:[binding(valuation.get(issuer))],peers:[...valuation].filter(([id])=>id!==issuer).map(([security_id,v])=>({security_id,multiple:v.row.pe,source_capture:binding(v)})),
  forecast:false,buy_ready:false,production_eligible:false,review:null,fixture:'SYNTHETIC_TEST_ONLY'};
 const compact=compactTaiwanPriceReference(full,inputs,bindings),inputPoolHash=marketSnapshotHash(inputs);
 const preparedPool=prepareDailyAiMarketPriceInputs({planHash:plan.plan_hash,inputs,bindings,inputPoolHash});assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared:preparedPool})).state,'STAGED');
 const preparedRefs=prepareDailyAiMarketPriceReferenceBatches({planHash:plan.plan_hash,references:[{security_id:issuer,short:null,medium:compact,long:null}],inputPoolHash});
 for(const prepared of preparedRefs.batches)assert.equal((await stageDailyAiMarketPricePrepared({rpc,prepared})).state,'STAGED');
 function evidence(symbol,kind,item){const content=canonical({kind:'SYNTHETIC_TEST_ONLY',symbol,source_capture:binding(item)}),hash=sha(content);return{id:'market-'+hash.slice(0,40),symbol,kind,source:item.cap.receipt.url,published_at:null,
  available_at:received,first_seen_at:received,as_of:received,time_basis:'OBSERVED_AFTER_RECEIPT',evidence_hash:hash,content};}
 function result(company){const evidenceList=[evidence(company.symbol,'MARKET',rawRows.get(company.security_id))];if(valuation.has(company.security_id))evidenceList.push(evidence(company.symbol,'FINANCIAL',valuation.get(company.security_id)));
  const packet={symbol:company.symbol,company:company.company,cutoff:plan.cutoff,data_through:quoteDay,data_gaps:['SYNTHETIC_TEST_ONLY'],evidence:evidenceList};
  return {security_id:company.security_id,packet,analysis:{schema:'DAILY_AI_STOCK_ANALYSIS_V2',symbol:company.symbol,cutoff:plan.cutoff,input_hash:marketSnapshotHash(packet),analysis_origin:'DETERMINISTIC_SCREENING',method_version:'TAIWAN_MARKET_RESEARCH_V1',model_generated:false,member_published:false,
   sources:evidenceList.map(({content:omitted,...source})=>{void omitted;return source;}),horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'SYNTHETIC contract data, not an investment conclusion.',evidence_ids:[evidenceList[0].id]},counter_evidence:[],confirmation:'SYNTHETIC only; wait for real confirmation.',invalidation:'SYNTHETIC only; no investment action.',gaps:[]}))},
   research_references:preparedRefs.bySecurity[company.security_id]??{SHORT:null,MEDIUM:null,LONG:null}};
 }
 const staged=await runDailyAiMarketShardWithReferences({rpc,planHash:plan.plan_hash,workerRef:'SYNTHETIC_OWNER_CONTRACT_TEST',analyseShard:async work=>work.companies.map(result)});assert.equal(staged.state,'STAGED',JSON.stringify(staged));
 const expiresAt=new Date(Date.now()+3600000).toISOString(),finish=await finishDailyAiMarketEdition({rpc,planHash:plan.plan_hash,expiresAt});assert.equal(finish.state,'STAGED_REVIEW_REQUIRED');
 const editionId=finish.edition_id;
 const scope=(id=owner)=>({identity:id,tier:'owner',generation:1,signal:new globalThis.AbortController().signal});
 const submission=(statuses={})=>({schema:'DAILY_AI_MARKET_OWNER_REVIEW_REQUEST_V1',edition_id:editionId,reason:'SYNTHETIC reviewer reasoning for contract verification only.',documents:['QUALITY','TIME','SOURCE_USE','METHODOLOGY'].map(kind=>({kind,status:statuses[kind]??'PENDING',document_url:'https://example.com/synthetic-review/'+kind,notes:'SYNTHETIC test document explanation, not actual research approval.'}))});
 async function grantSyntheticRights(){await db.exec('reset role');await db.exec(`insert into vnext_private.source_licenses select source_url,true,true,true,now()-interval'1 minute',now()+interval'1 hour','https://example.com/SYNTHETIC-license','SYNTHETIC rights only' from vnext_market.edition_sources where edition_id='${editionId}'`);await identity(owner);}
 return{db,call,rpc,identity,scope,submission,grantSyntheticRights,editionId,plan,universe,issuer,expiresAt,preparedPool,preparedRefs,
  owner,premium,free,sha,canonical,executeFile,randomUUID,close:()=>db.close()};
}
