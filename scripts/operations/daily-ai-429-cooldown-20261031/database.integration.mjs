// Real isolated PostgreSQL17.5. Vault and pg_net are instrumented local ports;
// no production credential, network call, dispatch or job reset occurs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const module=process.env.MA_PGLITE_MODULE;assert(module?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(module),db=new PGlite();await db.waitReady;
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const manifest=JSON.parse(read('candidate-manifest.json')),live=read('live-definition.sql'),candidate=read('candidate.sql'),rollback=read('rollback.sql');
const sha=value=>createHash('sha256').update(value).digest('hex');
const signature='public.dispatch_daily_stock_ai_batch_v1(text)',batch='a'.repeat(64),otherBatch='b'.repeat(64),cutoff='2026-10-31T08:00:00.123456Z';
const inputA='c'.repeat(64),inputB='d'.repeat(64),inputOther='e'.repeat(64),token='isolated-only-delivery-token-000000';
let checks=0,serial=0,phase='setup';
const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const ok=(value,message)=>{assert(value,message);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const sqlBody=sql=>sql.replace(/\nbegin;\n/,'\n').replace(/\ncommit;\s*$/,'\n');
const metadata=async()=>(await db.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid=$1::regprocedure",[signature])).rows[0].value;
const definition=async()=>(await db.query('select pg_get_functiondef($1::regprocedure) value',[signature])).rows[0].value;
const jobs=async()=>(await db.query('select coalesce(jsonb_agg(to_jsonb(j) order by id),\'[]\'::jsonb) value from vnext_runtime.ai_stock_jobs j')).rows[0].value;
const batches=async()=>(await db.query('select coalesce(jsonb_agg(to_jsonb(b) order by id),\'[]\'::jsonb) value from vnext_runtime.ai_stock_batches b')).rows[0].value;
const counters=async()=>(await db.query(`select jsonb_build_object('vault',(select count(*) from vault.read_audit),'post',(select count(*) from net.requests),'dispatch',(select count(*) from vnext_runtime.ai_stock_dispatches)) value`)).rows[0].value;
const dispatch=async(id=batch)=>(await db.query('select public.dispatch_daily_stock_ai_batch_v1($1) value',[id])).rows[0].value;
async function asService(fn){await db.exec('set role service_role');let failed=false;try{return await fn();}catch(error){failed=true;throw error;}finally{try{await db.exec('reset role');}catch(error){if(!failed)throw error;}}}
async function isolated(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function seedJob({symbol='1000',input=inputA,at=cutoff,state='FAILED',attempts=1,code='STOCK_AI_PROVIDER_HTTP_429',revision='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low'}={}){
 const id=sha('isolated-job-'+(++serial));
 await db.query(`insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result,code)
 values($1,$2,$3,$4,$5,$6,$7,'00000000-0000-0000-0000-000000000001',clock_timestamp()+interval '90 seconds',$8,$9)`,
 [id,input,revision,symbol,at,state,attempts,state==='COMPLETE'?{synthetic_completed_result:true,unaltered:true}:null,code]);return id;
}
async function blockUnchanged(){
 const before={jobs:await jobs(),batches:await batches(),counters:await counters()};
 equal(await asService(()=>dispatch()),{state:'BLOCKED_PROVIDER_RATE_LIMIT',batch_id:batch,member_published:false});
 equal(await jobs(),before.jobs,'All jobs, attempts, leases and COMPLETE bytes must stay exact');
 equal(await batches(),before.batches,'Immutable batch payload/cutoff must stay exact');
 equal(await counters(),before.counters,'Blocked dispatch must not read Vault, enqueue HTTP or insert a receipt');
}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create role isolated_owner;
 create schema vnext_runtime;create schema vault;create schema net;
 create table vnext_runtime.ai_stock_batches(id text primary key,cutoff timestamptz not null,payload jsonb not null);
 create table vnext_runtime.ai_stock_dispatches(request_id bigint primary key,batch_id text not null references vnext_runtime.ai_stock_batches(id),created_at timestamptz not null default clock_timestamp());
 alter table vnext_runtime.ai_stock_batches enable row level security;alter table vnext_runtime.ai_stock_batches force row level security;
 alter table vnext_runtime.ai_stock_dispatches enable row level security;alter table vnext_runtime.ai_stock_dispatches force row level security;
 revoke all on vnext_runtime.ai_stock_batches,vnext_runtime.ai_stock_dispatches from public,anon,authenticated,service_role;
 create table vault.secret_values(name text,decrypted_secret text,created_at timestamptz not null default clock_timestamp());
 create table vault.read_audit(at_time timestamptz not null default clock_timestamp());
 create function vault.read_secrets() returns setof vault.secret_values language plpgsql volatile as $$begin insert into vault.read_audit default values;return query select * from vault.secret_values;end$$;
 create view vault.decrypted_secrets as select * from vault.read_secrets();
 create table net.requests(id bigint generated always as identity primary key,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id into n;return n;end$$;
 revoke all on schema vault,net from public,anon,authenticated,service_role;
 revoke all on all tables in schema vault,net from public,anon,authenticated,service_role;
 revoke all on all functions in schema vault,net from public,anon,authenticated,service_role;`);
 await db.exec(read('../../../research/daily-ai-jobs.candidate.sql'));
 await db.exec(live);
 await db.exec(`revoke all on function public.dispatch_daily_stock_ai_batch_v1(text) from public,anon,authenticated,service_role;grant execute on function public.dispatch_daily_stock_ai_batch_v1(text) to service_role;`);
 await db.query('insert into vnext_runtime.ai_stock_batches values($1,$2,$3),($4,$2,$5)',[
  batch,cutoff,{packet_hashes:{1000:inputA,1001:inputB}},otherBatch,{packet_hashes:{2000:inputOther}}]);
 await db.query('insert into vault.secret_values(name,decrypted_secret) values($1,$2)',['morning_alpha_daily_delivery_token',token]);
 const complete=await seedJob({symbol:'1001',input:inputB,state:'COMPLETE',code:null});
 const originalMetadata=await metadata(),originalJobs=await jobs(),originalBatches=await batches();
 equal((await db.query('select version() value')).rows[0].value.split(' ').slice(0,2).join(' '),'PostgreSQL 17.5');
 equal(sha(live),manifest.baseline_definition_sha256);equal(sha(await definition()),manifest.baseline_definition_sha256);
 equal(sha(candidate),manifest.candidate_sql_sha256);equal(sha(rollback),manifest.rollback_sql_sha256);
 equal(originalMetadata.proacl,['postgres=X/postgres','service_role=X/postgres']);
 phase='baseline guards';
 const drifts=[
  ['missing',`drop function ${signature}`,/BASELINE_MISSING/],
  ['body',live.replace('AI_DISPATCH_SCOPE','AI_DISPATCH_SCOPE_DRIFT'),/BASELINE_DRIFT/],
  ['owner',`alter function ${signature} owner to isolated_owner`,/PRIVILEGE_DRIFT/],
  ['ACL',`grant execute on function ${signature} to authenticated`,/PRIVILEGE_DRIFT/],
  ['definer',`alter function ${signature} security invoker`,/BASELINE_DRIFT|PRIVILEGE_DRIFT/],
  ['volatility',`alter function ${signature} stable`,/BASELINE_DRIFT|PRIVILEGE_DRIFT/],
  ['search path',`alter function ${signature} set search_path=public`,/BASELINE_DRIFT|PRIVILEGE_DRIFT/],
  ['strict',`alter function ${signature} strict`,/BASELINE_DRIFT|PRIVILEGE_DRIFT/],
  ['leakproof',`alter function ${signature} leakproof`,/BASELINE_DRIFT|PRIVILEGE_DRIFT/],
  ['parallel',`alter function ${signature} parallel safe`,/BASELINE_DRIFT|PRIVILEGE_DRIFT/],
 ];
 for(const [label,mutation,pattern] of drifts){phase='guard '+label;await isolated(async()=>{await db.exec(mutation);await rejects(()=>db.exec(sqlBody(candidate)),pattern);});equal(await definition(),live);equal(await metadata(),originalMetadata);}
 await isolated(async()=>{await rejects(()=>db.exec(sqlBody(candidate).replace(manifest.candidate_definition_sha256,'0'.repeat(64))),/RESULT_DRIFT/);});
 equal(await definition(),live);equal(await metadata(),originalMetadata);equal(await jobs(),originalJobs);equal(await counters(),{vault:0,post:0,dispatch:0});
 phase='apply exact candidate';await db.exec(candidate);
 equal(sha(await definition()),manifest.candidate_definition_sha256);equal(await definition(),read('candidate-definition.sql'));
 equal(await metadata(),originalMetadata);equal(await jobs(),originalJobs);equal(await batches(),originalBatches);equal(await counters(),{vault:0,post:0,dispatch:0});
 await isolated(async()=>{await rejects(()=>db.exec(sqlBody(candidate)),/BASELINE_DRIFT/);});equal(sha(await definition()),manifest.candidate_definition_sha256);
 phase='service-only function and raw isolation';
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await rejects(()=>dispatch(),/permission denied/);}finally{await db.exec('reset role');}}
 await asService(async()=>{for(const table of ['vnext_runtime.ai_stock_jobs','vnext_runtime.ai_stock_batches','vnext_runtime.ai_stock_dispatches','vault.decrypted_secrets','net.requests'])await rejects(()=>db.query('select * from '+table),/permission denied/);});
 equal(await counters(),{vault:0,post:0,dispatch:0});
 phase='matching scope 429 at every retained attempt/state/revision';
 for(const state of ['FAILED','RUNNING'])for(const attempts of [1,2,3])for(const revision of ['gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low','gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-9:reasoning-low','other-exact-revision']){
  await isolated(async()=>{await seedJob({state,attempts,revision});await blockUnchanged();});
 }
 phase='block takes precedence over budget and missing credentials';
 await isolated(async()=>{await seedJob();await db.exec('delete from vault.secret_values');await db.query('insert into vnext_runtime.ai_stock_dispatches select n,$1,clock_timestamp() from generate_series(10000,10215)n',[batch]);await blockUnchanged();});
 phase='unrelated scope and near-match codes cannot block';
 for(const symbolMatches of [false,true])for(const inputMatches of [false,true])for(const cutoffMatches of [false,true]){
  if(symbolMatches&&inputMatches&&cutoffMatches)continue;
  await isolated(async()=>{await seedJob({symbol:symbolMatches?'1000':'2000',input:inputMatches?inputA:inputOther,at:cutoffMatches?cutoff:'2026-10-31T08:00:00.123457Z'});
   const oldJobs=await jobs();equal((await asService(()=>dispatch())).state,'DISPATCHED');equal(await jobs(),oldJobs);equal(await counters(),{vault:1,post:1,dispatch:1});});
 }
 for(const code of [null,'STOCK_AI_PROVIDER_HTTP_4290','STOCK_AI_PROVIDER_HTTP_429_','STOCK_AI_PROVIDER_HTTP_429 ','STOCK_AI_PROVIDER_HTTP_401','STOCK_AI_PROVIDER_HTTP_403','STOCK_AI_PROVIDER_HTTP_500','AI_BATCH_FAILED','AI_ANALYSIS_TIMEOUT']){
  await isolated(async()=>{await seedJob({code});equal((await asService(()=>dispatch())).state,'DISPATCHED');equal(await counters(),{vault:1,post:1,dispatch:1});});
 }
 await isolated(async()=>{await seedJob({symbol:'2000',input:inputOther});equal((await asService(()=>dispatch(batch))).state,'DISPATCHED');equal(await counters(),{vault:1,post:1,dispatch:1});
  const before=await counters();equal(await asService(()=>dispatch(otherBatch)),{state:'BLOCKED_PROVIDER_RATE_LIMIT',batch_id:otherBatch,member_published:false});equal(await counters(),before);});
 phase='normal exact transport and unchanged completed result';
 await isolated(async()=>{const before=await jobs(),value=await asService(()=>dispatch());equal(value.state,'DISPATCHED');equal(value.batch_id,batch);equal(value.member_published,false);ok(!JSON.stringify(value).includes(token));equal(await jobs(),before);
  const request=(await db.query('select url,headers,body,timeout_milliseconds from net.requests')).rows[0];
  equal(request,{url:'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',headers:{'Content-Type':'application/json','x-daily-delivery-token':token},body:{batch_id:batch},timeout_milliseconds:60000});});
 phase='original budget boundary remains216';
 await isolated(async()=>{await db.query('insert into vnext_runtime.ai_stock_dispatches select n,$1,clock_timestamp() from generate_series(20000,20214)n',[batch]);
  equal((await asService(()=>dispatch())).state,'DISPATCHED');equal(await counters(),{vault:1,post:1,dispatch:216});equal(await asService(()=>dispatch()),{state:'DISPATCH_BUDGET_EXHAUSTED'});equal(await counters(),{vault:1,post:1,dispatch:216});});
 phase='original credential and selector checks';
 for(const value of [null,'x'.repeat(23),'x'.repeat(513)])await isolated(async()=>{await db.exec('delete from vault.secret_values');if(value!==null)await db.query('insert into vault.secret_values(name,decrypted_secret) values($1,$2)',['morning_alpha_daily_delivery_token',value]);await rejects(()=>asService(()=>dispatch()),/AI_DISPATCH_CREDENTIAL_UNAVAILABLE/);});
 for(const value of ['x'.repeat(24),'x'.repeat(512)])await isolated(async()=>{await db.query('update vault.secret_values set decrypted_secret=$1',[value]);equal((await asService(()=>dispatch())).state,'DISPATCHED');equal(await counters(),{vault:1,post:1,dispatch:1});});
 for(const value of [null,'','g'.repeat(64),'a'.repeat(63),'a'.repeat(65)])await rejects(()=>asService(()=>dispatch(value)),/AI_DISPATCH_SCOPE/);
 await rejects(()=>asService(()=>dispatch('f'.repeat(64))),/AI_DISPATCH_BATCH_MISSING/);equal(await counters(),{vault:0,post:0,dispatch:0});
 phase='rollback guards and exact restoration';
 await isolated(async()=>{await db.exec(`grant execute on function ${signature} to authenticated`);await rejects(()=>db.exec(sqlBody(rollback)),/PRIVILEGE_DRIFT/);});
 equal(await metadata(),originalMetadata);await db.exec(rollback);equal(await definition(),live);equal(await metadata(),originalMetadata);equal(await jobs(),originalJobs);equal(await batches(),originalBatches);equal(await counters(),{vault:0,post:0,dispatch:0});
 await isolated(async()=>{await rejects(()=>db.exec(sqlBody(rollback)),/ROLLBACK_BASELINE_DRIFT/);});
 phase='rollback restores old behavior without changing historical jobs';
 await isolated(async()=>{await seedJob();equal((await asService(()=>dispatch())).state,'DISPATCHED');equal(await counters(),{vault:1,post:1,dispatch:1});});
 await db.exec(candidate);equal(sha(await definition()),manifest.candidate_definition_sha256);equal(await metadata(),originalMetadata);equal(await jobs(),originalJobs);equal(await batches(),originalBatches);
 equal((await db.query('select result from vnext_runtime.ai_stock_jobs where id=$1',[complete])).rows[0].result,{synthetic_completed_result:true,unaltered:true});
 console.log(JSON.stringify({status:'PASS',checks,postgres:'17.5',baseline_definition_sha256:manifest.baseline_definition_sha256,candidate_definition_sha256:manifest.candidate_definition_sha256,production_calls:0,external_calls:0,local_vault_and_net_instrumented:true,limitation:'Isolated single PostgreSQL/WASM connection; no production multi-connection timing, queued Edge cancellation or provider recovery proof.'},null,2));
}catch(error){console.error('FAIL phase: '+phase);throw error;}finally{await db.close();}
