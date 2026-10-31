// Local PostgreSQL only. All companies, responses, timestamps and credentials
// below are synthetic; no public source, model or deployment is contacted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {refreshDailyAiFinancials,DAILY_AI_FINANCIAL_URLS} from '../research/daily-ai-financial-refresh.ts';
import {buildDailyAiSeed} from '../research/daily-ai-seed.ts';
import {parseDailyAiSourceSnapshot} from '../supabase/functions/daily-stock-analysis-v1/intake.ts';

const modulePath=process.env.MA_PGLITE_MODULE;assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const sourceCutoff='2026-10-29T12:00:00Z',restrictedDomains=['tsmc.com','mediatek.com','honhai.com'];
const urls=Object.values(DAILY_AI_FINANCIAL_URLS),businessDate=time=>new Date(Date.parse(time)+8*3600000).toISOString().slice(0,10);
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const initialInputs=Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'隔離財務測試'+i,cutoff:sourceCutoff,through:'2026-10-28',next_session:'2026-10-29',expected_sessions:['2026-10-28'],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},
 bars:[{id:'retained-price-'+i,date:'2026-10-28',source:'https://www.twse.com.tw/test-price',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:'2026-10-28T09:00:00Z',evidence_hash:'b'.repeat(64),session_scope:'SYNTHETIC_OFFICIAL_DAY',open:10,high:12,low:9,close:11,volume:100,amount:1100}],
 facts:[{id:'retained-revenue-'+i,kind:'REVENUE',period:'2026-09',basis:'MONTHLY',values:{yoy_percent:10},source:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:'2026-09-30T15:59:59Z',evidence_hash:'c'.repeat(64)}]}));
function financialFetcher({eps='49.33',exported='1151031',fail=false}={}){
 return async source=>{
  const url=String(source);assert(urls.includes(url),'only the three fixed official financial sources are allowed');
  if(fail)return new Response('private isolated financial failure',{status:503});
  const row={'公司代號':'1000','年度':'115','季別':'2','出表日期':exported};
  if(url===DAILY_AI_FINANCIAL_URLS.TWSE_EPS)return Response.json([{...row,'基本每股盈餘(元)':eps}]);
  if(url===DAILY_AI_FINANCIAL_URLS.TWSE_INCOME)return Response.json([{...row,'營業收入':'100','營業毛利（毛損）淨額':'40','營業利益（損失）':'30','本期淨利（淨損）':'20'}]);
  return Response.json([{'SecuritiesCompanyCode':'1001','Year':'115','季別':'2','Date':exported,'基本每股盈餘':'1.23'}]);
 };
}
const capture=async(inputs,{clock=()=>new Date().toISOString(),...options}={})=>refreshDailyAiFinancials({inputs,businessDate:businessDate(clock()),clock,fetcher:financialFetcher(options),signal:new AbortController().signal});
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_runtime.runs(id uuid primary key,business_date date,checkpoint jsonb,source_revision text,updated_at timestamptz default now());
 create table vnext_runtime.source_revisions(id text primary key,receipt jsonb);create table vnext_runtime.run_sources(run_id uuid,source_id text);
 create table public.runtime_http_dispatches(trading_date date,job_name text,checkpoint text,dispatch_status text);
 create table public.news_events(id uuid primary key,title text,summary text,source_name text,provider text,source_url text,published_at timestamptz,created_at timestamptz,fingerprint text);
 create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz default now());
 insert into vault.decrypted_secrets(name,decrypted_secret) values('morning_alpha_daily_delivery_token','isolated-financial-test-delivery-token-000000');
 create schema net;create table net.requests(id bigint generated always as identity,body jsonb);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.requests(body) values(body) returning id into n;return n;end$$;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('00000000-0000-0000-0000-000000000002');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);`);
 for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-handoff','daily-ai-member','daily-ai-use-review','daily-ai-intake','daily-ai-market-policy-v2','daily-ai-financial-refresh-v3']){
  await db.exec(readFileSync(new URL('../research/'+name+'.candidate.sql',import.meta.url),'utf8'));
 }
 // A real earlier helper capture establishes the same-period observation that
 // the new official receipt may supersede; other retained facts stay byte exact.
 const oldCapture=await capture(initialInputs,{clock:()=>sourceCutoff,eps:'1.25',exported:'1151029'}),baseline=oldCapture.inputs;
 for(let i=0;i<3;i++)baseline[i].facts.push({id:'restricted-issuer-'+i,kind:'EPS',period:'2026-Q2',basis:'SINGLE_QUARTER',values:{eps:8},source:'https://investor.'+restrictedDomains[i]+'/financial-report',
  published_at:null,first_seen_at:sourceCutoff,available_at:sourceCutoff,as_of:'2026-06-30T15:59:59Z',evidence_hash:'e'.repeat(64)});
 const run='00000000-0000-0000-0000-000000000001',revision='a'.repeat(64),companies=baseline.map((i,n)=>({symbol:i.symbol,company:i.company,exchange:n===1?'TPEX':'TWSE'}));
 await db.query('insert into vnext_runtime.runs values($1,$2,$3,$4,now())',[run,businessDate(sourceCutoff),{acquired:{inputs:baseline,evidence_cutoff:sourceCutoff,snapshot_hash:revision}},revision]);
 await db.query('insert into vnext_runtime.source_revisions values($1,$2)',['directory',{task:{kind:'DIRECTORY'},status:'OK',payload:{rows:companies}}]);
 await db.query('insert into vnext_runtime.run_sources values($1,$2)',[run,'directory']);
 const call=async(op,id,args={})=>(await db.query('select public.daily_stock_ai_intake_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',
  [op,id,args.lease??null,args.inputs??null,args.gaps??null,args.batch_id??null,args.code??null,args.symbol_gaps??null,args.market??null,args.financial_refresh??null])).rows[0].result;
 const enqueue=async()=>(await db.query('select public.enqueue_daily_stock_ai_intake_v1() result')).rows[0].result;
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(enqueue,/permission denied/);
  await assert.rejects(()=>call('CLAIM','00000000-0000-0000-0000-000000000099'),/permission denied/);await db.exec('reset role');
 }
 await db.exec('set role service_role');const queued=await enqueue(),id=queued.intake_id,claim=await call('CLAIM',id);assert.equal(claim.state,'ACQUIRED');assert.equal(claim.inputs.length,72);
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_intakes'),/permission denied/);await db.exec('reset role');
 const updated=await capture(claim.inputs),failed=await capture(claim.inputs,{fail:true});
 assert.equal(updated.proof.responses.length,3);assert.equal(updated.proof.additions.length,3);assert.equal(updated.proof.removals.filter(r=>r.reason==='RESTRICTED_COMPANY_WEBSITE_FACT_REMOVED_WITHOUT_RELABEL').length,3);
 assert(updated.proof.removals.some(r=>r.reason==='OFFICIAL_API_SAME_REPORTED_PERIOD_SUPERSEDED_BY_NEW_RECEIPT'));
 const retained=claim.inputs[0].facts.find(f=>f.kind==='REVENUE');assert.deepEqual(updated.inputs[0].facts.find(f=>f.id===retained.id),retained);
 assert.equal(updated.inputs[0].facts.find(f=>f.kind==='EPS_AS_REPORTED').values.value,49.33);
 assert.equal(claim.inputs[0].facts.find(f=>f.kind==='EPS_AS_REPORTED').values.value,1.25);
 const validate=async(inputs,proof)=>(await db.query('select vnext_runtime.validate_daily_ai_financial_refresh_v3($1,$2,$3,clock_timestamp(),$4::date) result',
  [claim.inputs,inputs,proof,queued.business_date])).rows[0].result;
 assert.deepEqual(await validate(updated.inputs,updated.proof),updated.proof);
 assert.deepEqual(await validate(failed.inputs,failed.proof),failed.proof);
 for(let i=0;i<3;i++)assert(!JSON.stringify(failed.inputs[i].facts).includes(restrictedDomains[i]));
 assert.deepEqual(failed.inputs[0].facts.find(f=>f.id===retained.id),retained);assert.deepEqual(failed.inputs[0].facts.find(f=>f.kind==='EPS_AS_REPORTED'),claim.inputs[0].facts.find(f=>f.kind==='EPS_AS_REPORTED'));
 const tamperCases=[
  ['response hash',(inputs,proof)=>{proof.responses[0].source_sha256='f'.repeat(64);}],
  ['response bytes',(inputs,proof)=>{proof.responses[0].source_bytes++;}],
  ['response text',(inputs,proof)=>{proof.responses[0].response_text+=' ';}],
  ['row text',(inputs,proof)=>{const row=JSON.parse(proof.additions[0].row_text);row['基本每股盈餘(元)']='999';proof.additions[0].row_text=JSON.stringify(row);}],
  ['body text',(inputs,proof)=>{const body=JSON.parse(proof.additions[0].body_text);body.values.value=999;proof.additions[0].body_text=JSON.stringify(body);}],
  ['missing addition audit',(inputs,proof)=>{proof.additions.pop();}],
  ['missing removal audit',(inputs,proof)=>{proof.removals.pop();}],
  ['arbitrary fact',(inputs)=>{inputs[0].facts.push({...retained,id:'fabricated-financial-fact',values:{yoy_percent:999}});}],
  ['changed retained fact',(inputs)=>{inputs[0].facts.find(f=>f.id===retained.id).values.yoy_percent=999;}],
  ['restricted fact reintroduced',(inputs)=>{inputs[0].facts.push(claim.inputs[0].facts.find(f=>f.id==='restricted-issuer-0'));}],
 ];
 for(const [label,change] of tamperCases){
  const inputs=structuredClone(updated.inputs),proof=structuredClone(updated.proof);change(inputs,proof);
  await assert.rejects(()=>validate(inputs,proof),/AI_INTAKE_FINANCIAL_/,label);
 }
 // Recomputing a forged body hash/ID cannot override the actual source row.
 const forgedInputs=structuredClone(updated.inputs),forgedProof=structuredClone(updated.proof),addition=forgedProof.additions.find(a=>a.symbol==='1000'&&a.fact_id.includes('EPS_AS_REPORTED'));
 const forgedBody=JSON.parse(addition.body_text);forgedBody.values.value=999;addition.body_text=JSON.stringify(forgedBody);const forgedHash=await digest(addition.body_text),oldId=addition.fact_id;
 addition.fact_id='official-open-api:1000:EPS_AS_REPORTED:2026-Q2:'+forgedHash;
 const oldFact=forgedInputs[0].facts.find(f=>f.id===oldId);forgedInputs[0].facts=forgedInputs[0].facts.map(f=>f===oldFact?{...forgedBody,id:addition.fact_id,evidence_hash:forgedHash}:f);
 await assert.rejects(()=>validate(forgedInputs,forgedProof),/AI_INTAKE_FINANCIAL_/);
 // A null proof may remove prohibited legacy observations; it cannot admit new
 // financial figures without a captured response and complete linkage audit.
 const cleanup=structuredClone(claim.inputs);for(const input of cleanup)input.facts=input.facts.filter(f=>!restrictedDomains.some(domain=>new URL(f.source).hostname.endsWith(domain)));
 const nullProof=await validate(cleanup,null);assert.equal(nullProof.schema,'DAILY_AI_FINANCIAL_REFRESH_V1');assert.deepEqual(nullProof.additions,[]);
 await assert.rejects(()=>validate(updated.inputs,null),/AI_INTAKE_FINANCIAL_/);
 const sourceArgs=result=>({lease:claim.lease,inputs:result.inputs,gaps:result.additionalGaps,symbol_gaps:result.gapsBySymbol,market:[],financial_refresh:result.proof});
 // Full real RPC acceptance is tested for both endpoint failure cleanup and
 // new official facts. The first transaction is rolled back to reuse the lease.
 await db.exec('set role service_role;begin');
 try{
  const sourced=await call('SOURCE',id,sourceArgs(failed));assert.equal(sourced.state,'SOURCED');
  assert(!JSON.stringify(sourced.inputs[0].facts).includes('tsmc.com'));assert.deepEqual(sourced.inputs[0].facts.find(f=>f.id===retained.id),retained);
 }finally{await db.exec('rollback;reset role');}
 await db.exec('set role service_role');const sourced=await call('SOURCE',id,sourceArgs(updated));assert.equal(sourced.state,'SOURCED');
 assert(sourced.inputs.every(i=>i.cutoff===sourced.cutoff));assert.equal(sourced.inputs[0].facts.find(f=>f.kind==='EPS_AS_REPORTED').values.value,49.33);
 for(const domain of restrictedDomains)assert(!JSON.stringify(sourced.inputs).includes(domain));
 assert(!JSON.stringify(sourced).includes('response_text'),'service read view must expose a summary, not private response blobs');
 const parsed=await parseDailyAiSourceSnapshot(sourced,sourced.cutoff,new AbortController().signal,'INTAKE'),seed=await buildDailyAiSeed({...parsed,cutoff:sourced.cutoff});
 for(const domain of restrictedDomains)assert(!seed.payload_text.includes(domain));
 await db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[seed.payload_text,seed.metadata.payload_hash]);
 const completed=await call('COMPLETE',id,{lease:claim.lease,batch_id:seed.metadata.payload_hash});assert.equal(completed.state,'COMPLETE');
 assert.equal((await call('CLAIM',id)).batch_id,seed.metadata.payload_hash);
 await db.exec('reset role');
 console.log('PASS: real official helper proofs accepted by isolated V3 SQL; response/row/body/hash/arbitrary-fact tampering rejected; retained facts preserved; restricted cleanup on endpoint failure; same-period supersession; private raw proof isolation; full SOURCE→seed→COMPLETE. No model, network, Cron or production writes.');
}catch(error){
 console.error(JSON.stringify({error:String(error.message).slice(0,5000),code:error.code,where:error.where,
  site:error.stack?.split('\n').find(line=>line.includes('dailyAiFinancialRefreshDatabase.integration.mjs'))}));
 process.exitCode=1;
}finally{await db.close();}
