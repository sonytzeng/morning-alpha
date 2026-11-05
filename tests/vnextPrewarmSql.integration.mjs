/** Real PostgreSQL + PostgREST + HTTP worker, isolated synthetic identities and
 * controlled clock/provider. NOT Production Auth, natural operation or performance. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,createHmac} from 'node:crypto';
import {createServer} from 'node:http';
import {handleVnextDaily} from '../supabase/functions/vnext-daily-research-v1/handler.ts';
import {directoryPlan,normalizeSource,ADAPTER_VERSION,acquisitionPlan,classifyCompanies} from '../src/features/vnext/dailyAdapter.ts';
import {workDailyRun} from '../src/features/vnext/dailyRuntime.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {canonical} from '../research/entry-opportunity.ts';
import {researchOutcome} from '../src/features/vnext/dailyOutcome.ts';
import {fullCapacityAcquired} from './helpers/vnextFullSnapshotCapacity.mjs';
const migration='supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const name='ma-prewarm-sql-'+randomBytes(16).toString('hex'),db=name+'-db',rest=name+'-rest';
let networkCreated=false,dbCreated=false,restCreated=false;
const secret=randomBytes(48).toString('hex'),password=randomBytes(24).toString('hex');
const env={...process.env,POSTGRES_PASSWORD:password,PGPASSWORD:password,PGRST_DB_URI:`postgres://authenticator:${password}@${db}:5432/postgres`,PGRST_JWT_SECRET:secret};
const run=(a,input)=>execFileSync('docker',a,{env,encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:64e6}).trim();
// Test-local random password only; pass by environment name, never argv value.
const sql=q=>run(['exec','-i','-e','PGPASSWORD',db,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],q);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const token=(role,sub)=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,sub,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');};
const port=55840,base='http://127.0.0.1:'+port,workerPort=55841;
let vmLoopback=false;
async function localFetch(url,options={}){
 if(!vmLoopback)return fetch(url,{...options,signal:AbortSignal.timeout(5000)});
 assert(url.startsWith(base));
 // Colima can delay forwarding a new port to macOS. The fallback still uses
 // real HTTP on that VM's loopback; local test JWTs go only through stdin.
 const config=['url = '+JSON.stringify(url),'request = '+JSON.stringify(options.method??'GET'),...Object.entries(options.headers??{}).map(([k,v])=>'header = '+JSON.stringify(k+': '+v)),...(options.body?['data = '+JSON.stringify(options.body)]:[])].join('\n');
 const raw=execFileSync('colima',['ssh','--','curl','--silent','--show-error','--max-time','5','--write-out','\\n%{http_code}','--config','-'],{input:config,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:64e6});
 const split=raw.lastIndexOf('\n');return new Response(raw.slice(0,split),{status:Number(raw.slice(split+1))});
}
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',free='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',paid='cccccccc-cccc-4ccc-8ccc-cccccccccccc',batch='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let at='2026-10-12T00:00:00.000Z',server;const checks=[];
const advance=t=>{at=t;sql(`update public.vnext_test_clock set at='${t}'`);};
const request=async(role,name,args,sub)=>{
 const r=await localFetch(base+'/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+token(role,sub),'Content-Type':'application/json'},body:JSON.stringify(args)});const data=await r.json();return {status:r.status,data};
};
const sqlErrors=[];
let verifyLockBatch,interruptFinish=false,dropCommitReply=false,preparedBatch;
const rpc=async(name,args)=>{
 if(args.p_op==='FINISH'&&interruptFinish){interruptFinish=false;throw Error('ISOLATED_PROCESS_INTERRUPTED');}
 if(args.p_op==='PREDICTIONS'&&verifyLockBatch){const verify=verifyLockBatch;verifyLockBatch=null;await verify(name,args);}
 const r=await request('service_role',name,args);if(r.status!==200){sqlErrors.push({operation:args.p_op??name,code:r.data.code,message:r.data.message});throw Error(String(r.data.message));}
 if(args.p_op==='PREDICTIONS'&&dropCommitReply){dropCommitReply=false;interruptFinish=true;throw Error('ISOLATED_COMMIT_RESPONSE_LOST');}
 return r.data;
};
try{
 assert(process.env.MA_ISOLATED_DB_TMPFS===undefined||['0','1'].includes(process.env.MA_ISOLATED_DB_TMPFS),'ISOLATED_DB_TMPFS_INVALID');
 const ephemeralStorage=process.env.MA_ISOLATED_DB_TMPFS==='1'?['--tmpfs','/var/lib/postgresql/data:rw,size=268435456']:[];
 run(['network','create',name]);networkCreated=true;
 run(['run','-d','--name',db,'--network',name,...ephemeralStorage,'-e','POSTGRES_PASSWORD','postgres:17']);dbCreated=true;
 let ready=false,readinessCode='UNKNOWN';for(let i=0;i<60;i++){try{sql('select 1');ready=true;break;}catch(error){
  const message=String(error.stderr??'');readinessCode=/permission denied/i.test(message)?'LOCAL_DOCKER_PERMISSION_DENIED':/no password supplied/i.test(message)?'LOCAL_PASSWORD_ENV_MISSING':/password authentication failed/i.test(message)?'LOCAL_PASSWORD_REJECTED':/connection refused|starting up/i.test(message)?'LOCAL_POSTGRES_NOT_READY':/No such container/i.test(message)?'LOCAL_CONTAINER_MISSING':/executable file|exec failed/i.test(message)?'LOCAL_CONTAINER_EXEC_FAILED':'LOCAL_POSTGRES_UNKNOWN';await sleep(300);
 }}assert(ready,'LOCAL_DB_UNAVAILABLE:'+readinessCode);
 sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role authenticator login password '${password}' noinherit;
 grant anon,authenticated,service_role to authenticator;create schema auth;create schema research_private;
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create table public.profiles(id uuid primary key,role text);create table research_private.owner_access(principal_id uuid primary key,enabled boolean);
 insert into public.profiles values('${owner}','admin'),('${free}','free'),('${paid}','premium');insert into research_private.owner_access values('${owner}',true);
 create table public.vnext_test_clock(at timestamptz not null);insert into public.vnext_test_clock values('${at}');
 create function public.vnext_test_now() returns timestamptz language sql volatile as $$select at from public.vnext_test_clock$$;
 create function public.authoritative_market_calendar_v1() returns jsonb language sql stable as $$select '{"TW":{"from":"2026-10-01","through":"2026-10-31"}}'::jsonb$$;
 create function public.market_calendar_session_v1(text,date) returns boolean language sql stable as $$select $2 between '2026-10-01' and '2026-10-31' and extract(isodow from $2)<6 and $2<>'2026-10-09'$$;
 create table public.market_checkpoint_batches(batch_id uuid primary key,business_date date,checkpoint text,status text,expected_provider_count integer,committed_provider_count integer,committed_at timestamptz);
 insert into public.market_checkpoint_batches values('${batch}','2026-10-12','PREMARKET','COMMITTED',11,11,'2026-10-11T23:59:00Z');
 create table public.recommendation_shadow_v2_runs(business_date date,source_batch_id uuid,cutoff timestamptz,evidence jsonb,input_sha256 text);
 create table public.decision_snapshots(id uuid,report_date date,session_type text,status text,created_at timestamptz,generated_text jsonb,market_regime text);
 `);
 const foundation=read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql');sql(foundation.slice(foundation.indexOf('create function public.is_research_owner_v1()'),foundation.indexOf('create table public.research_feature_versions')));
 // Apply exact candidate first with actual DB clock: validates real SQL/schema.
 sql(read(migration));checks.push('Fresh DB exact migration applied');
 const rollback=read('scripts/operations/vnext-checkpoint-state-20261029/runtime-v8-rollback.sql');
 sql(rollback.split('-- BEGIN EXACT V8 RPC\n')[1].split('-- END EXACT V8 RPC')[0]);
 const compactMigration=read('supabase/migrations/20261029055349_vnext_compact_checkpoint_state.sql');
 const acl=sql("select jsonb_build_object('acl',proacl::text,'definer',prosecdef,'config',proconfig) from pg_proc where oid='public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb)'::regprocedure");
 sql(compactMigration);
 assert.equal(sql("select jsonb_build_object('acl',proacl::text,'definer',prosecdef,'config',proconfig) from pg_proc where oid='public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb)'::regprocedure"),acl);
 assert.throws(()=>sql(compactMigration),/CHECKPOINT_STATE_BASELINE_DRIFT/);
 checks.push('Exact deployed RPC baseline -> guarded compact migration; ACL/definer/search_path preserved; reapply refused');
 const count=sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vnext_runtime' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity");assert.equal(count,'8');
 // Apply the exact current 1.1 guarded runtime in this disposable database.
 sql(read('supabase/migrations/20261103005841_vnext_premarket_entry_v11.sql'));
 // Clock injection is exclusively this disposable test database, after exact DDL.
 for(const fname of ['enqueue_vnext_daily_research_v1','claim_vnext_daily_research_v1','vnext_daily_runtime_v1','get_owner_vnext_daily_v1']){
  const def=sql(`select pg_get_functiondef(oid) from pg_proc where proname='${fname}'`);sql(def.replaceAll('clock_timestamp()','public.vnext_test_now()'));
 }
 for(const [table,column] of [['runs','created_at'],['runs','updated_at'],['source_revisions','created_at'],['predictions','locked_at'],['audit','at']])sql(`alter table vnext_runtime.${table} alter column ${column} set default public.vnext_test_now()`);
 run(['run','-d','--name',rest,'--network',name,'-p',`127.0.0.1:${port}:3000`,'-e','PGRST_DB_URI','-e','PGRST_JWT_SECRET','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_LOG_LEVEL=crit','postgrest/postgrest:v14.13']);restCreated=true;
 ready=false;let readiness='NO_CONNECTION';for(let i=0;i<30;i++){try{const response=await localFetch(base);readiness=String(response.status);if(response.ok||response.status===401){ready=true;break;}readiness+=' '+(await response.text()).slice(0,400);}catch{if(process.platform==='darwin'&&i>=3)vmLoopback=true;}await sleep(300);}
 if(!ready)throw Error('LOCAL_POSTGREST_UNAVAILABLE '+readiness);
 for(const [role,sub] of [['anon',null],['authenticated',free],['authenticated',paid]]){
  assert([401,403].includes((await request(role,'get_owner_vnext_daily_v1',{p_date:'2026-10-12'},sub)).status));
  assert([401,403].includes((await request(role,'enqueue_vnext_daily_research_v1',{p_date:'2026-10-12',p_phase:'PREMARKET',p_batch:batch},sub)).status));
 }
 assert.equal((await request('authenticated','get_owner_vnext_daily_v1',{p_date:'2026-10-12'},owner)).status,200);
 assert.throws(()=>sql(`set role authenticated;select * from vnext_runtime.predictions`));checks.push('Owner RPC allow; anonymous/free/premium no raw access or worker write');
 const enqueue=()=>rpc('enqueue_vnext_daily_research_v1',{p_date:'2026-10-12',p_phase:'PREMARKET',p_batch:batch});
 const r=await enqueue();assert.equal((await enqueue()).run_id,r.run_id);assert.equal(sql('select count(*) from vnext_runtime.runs'),'1');
 const claims=await Promise.all([rpc('claim_vnext_daily_research_v1',{p_run:r.run_id}),rpc('claim_vnext_daily_research_v1',{p_run:r.run_id})]);
 assert.equal(claims.filter(c=>c.status==='ACQUIRED').length,1);assert.equal(claims.filter(c=>c.status==='BUSY').length,1);let active=claims.find(c=>c.run)?.run;
 const op=(name,data={})=>rpc('vnext_daily_runtime_v1',{p_run:r.run_id,p_lease:active.lease,p_fence:active.fence,p_op:name,p_data:data});
 const old={...active};advance('2026-10-12T00:02:00.000Z');active=(await rpc('claim_vnext_daily_research_v1',{p_run:r.run_id})).run;assert.equal(active.fence,old.fence+1);
 await assert.rejects(()=>rpc('vnext_daily_runtime_v1',{p_run:r.run_id,p_lease:old.lease,p_fence:old.fence,p_op:'CHECKPOINT',p_data:{}}),/LEASE_FENCED/);checks.push('Concurrent claim + expired lease recovery + stale writer fencing');
 // Synthetic chronology control: canonical publication is later than the V2
 // producer, but already known at the independent VNext evaluation cutoff.
 sql(`insert into public.recommendation_shadow_v2_runs values('2026-10-12','${batch}','2026-10-11T23:59:00Z','{}','${'e'.repeat(64)}');
 insert into public.decision_snapshots values('${'a'.repeat(8)}-1111-4111-8111-${'a'.repeat(12)}','2026-10-12','PREMARKET','READY','2026-10-12T00:00:02Z','{"market_bias":"RANGE"}','RANGE');`);
 assert.equal((await op('ENTRY_SOURCE',{cutoff:at})).market.value.direction,'RANGE');
 assert.equal((await op('ENTRY_SOURCE',{cutoff:'2026-10-11T23:59:00Z'})).market,null);
 assert.deepEqual(await op('ENTRY_SOURCE',{cutoff:'2026-10-12T00:03:00Z'}),{});
 sql('delete from public.recommendation_shadow_v2_runs');
 assert.equal((await op('ENTRY_SOURCE',{cutoff:at})).market.value.direction,'RANGE','Canonical must not depend on optional V2 capsule');
 sql('delete from public.recommendation_shadow_v2_runs;delete from public.decision_snapshots');
 checks.push('Canonical publication between producer and VNext cutoff admitted; future canonical/cutoff denied; original V2 cutoff untouched');
 const dirTasks=await directoryPlan('2026-10-12');
 const cacheReceipt=async task=>{const raw=task.exchange==='TWSE'?RECOMMENDATION_UNIVERSE.map(symbol=>({'公司代號':symbol,'公司名稱':'合成控制 '+symbol,'產業別':'24','上市日期':'0830905'})):[];
  const payload=await normalizeSource(task,raw,at),receipt={task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:ADAPTER_VERSION,raw_hash:await snapshotHash(raw),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};
  assert.equal((await op('SOURCE_BEGIN',task)).status,'FETCH');await op('SOURCE_SAVE',{text:canonical(receipt)});return receipt;
 };
 const receipts=[];for(const t of dirTasks)receipts.push(await cacheReceipt(t));

 // Real SQL / synthetic controlled providers: an immutable old plan begins with
 // a cold task while a warm PRICE task occurs later. Worker must not advance the
 // original cursor or assemble a snapshot after a recoverable first failure.
 const planAll=await acquisitionPlan('2026-10-12',classifyCompanies(receipts));
 const cold=planAll.find(t=>t.kind==='PRICE'&&t.month==='2025-10');
 const warm=planAll.find(t=>t.kind==='PRICE'&&t.month==='2026-10');
 assert(cold&&warm,'EXPECTED_SYNTHETIC_TEST_TASKS');
 await op('PLAN',[cold,warm]);await op('FINISH',{status:'QUEUED'});
 const atFirst=at;let providerCalls=0;
 sql(`insert into public.decision_snapshots values('${'a'.repeat(8)}-1111-4111-8111-${'a'.repeat(12)}','2026-10-12','PREMARKET','READY','2026-10-12T00:00:02Z','{"market_bias":"RANGE"}','RANGE');`);
 const fetcher=async url=>{
  assert.equal(url,warm.url,'ONLY_EXPECTED_WARM_PROVIDER');providerCalls++;
  if(providerCalls===1)return new Response('',{status:503,headers:{'Retry-After':'3'}});
  const payload={stat:'OK',title:`Synthetic ${warm.symbols[0]} monthly`,date:'20261001',
   fields:['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],
   data:[['115/10/08','1000','101000','100','102','99','101']]};
  return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const ports={rpc,clock:()=>at,sleep:async()=>{},fetcher};
 const first=await workDailyRun(r.run_id,ports);
 assert.equal(first.reason,'PREWARM_RETRY_PENDING');
 assert.equal(providerCalls,1);
 assert.equal(sql(`select cursor from vnext_runtime.runs where id='${r.run_id}'`),'0');
 assert.equal(sql(`select (checkpoint->'prewarm_v1'->>'next')::int from vnext_runtime.runs where id='${r.run_id}'`),'1');
 assert.equal(sql(`select checkpoint->'prewarm_v1'->'deferred' from vnext_runtime.runs where id='${r.run_id}'`),'[0]');
 assert.equal(sql(`select count(*) from vnext_runtime.predictions where run_id='${r.run_id}'`),'0');
 assert.equal(sql(`select attempts from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${warm.key}'`),'1');
 assert.equal(sql(`select source_id is null from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${warm.key}'`),'t');
 // The old lease cannot modify CHECKPOINT after the worker has released it.
 await assert.rejects(()=>op('CHECKPOINT',{}),/LEASE_FENCED/);
 active=(await rpc('claim_vnext_daily_research_v1',{p_run:r.run_id})).run;
 assert(active&&active.lease!==old.lease,'NEW_CLAIM_EXPECTED');
 const beforeRetry=await op('SOURCE_BEGIN',warm);assert.equal(beforeRetry.status,'WAIT_RETRY');
 assert.equal(sql(`select attempts from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${warm.key}'`),'1');
 await op('FINISH',{status:'QUEUED'});
 advance(new Date(Date.parse(atFirst)+3000).toISOString());
 const second=await workDailyRun(r.run_id,ports);
 assert.equal(second.reason,'ACQUIRED_SNAPSHOT_CONTINUATION');assert.equal(providerCalls,2);
 assert.equal(sql(`select cursor from vnext_runtime.runs where id='${r.run_id}'`),'0');
 assert.equal(sql(`select plan='${JSON.stringify([cold,warm]).replaceAll("'","''")}'::jsonb from vnext_runtime.runs where id='${r.run_id}'`),'t');
 assert.equal(sql(`select attempts from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${warm.key}'`),'2');
 assert.equal(sql(`select source_id is not null from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${warm.key}'`),'t');
 assert.equal(sql(`select count(*) from vnext_runtime.source_revisions where task_key='${warm.key}'`),'1');
 const stored=JSON.parse(sql(`select checkpoint->'acquired' from vnext_runtime.runs where id='${r.run_id}'`));
 const symbol=stored.entry.stocks.find(s=>s.symbol===warm.symbols[0]);assert(symbol,'EXPECTED_SYMBOL_IN_SNAPSHOT');
 assert.equal(symbol.bars.length,1);assert(Date.parse(symbol.bars[0].available_at)<=Date.parse(stored.evidence_cutoff));
 assert.equal(sql(`select count(*) from vnext_runtime.predictions where run_id='${r.run_id}'`),'0');
 checks.push('Real SQL prewarm: old plan/cursor preserved; 503 -> SQL retry_at -> checkpoint restart -> 200 receipt bound once before pinned snapshot; no prediction fabricated');
 // Exercise the exact prepared-lock guard during the worker's real PREDICTIONS
 // RPC and then verify that actual committed lock rows are immutable. The 216
 // predictions are synthetic INSUFFICIENT test records, not investment advice.
 verifyLockBatch=async(_name,args)=>{
  const prepared=JSON.parse(sql(`select checkpoint from vnext_runtime.runs where id='${r.run_id}'`));
  assert.equal(prepared.locks.length,216);
  const rejected=await request('service_role','vnext_daily_runtime_v1',{
   ...args,p_op:'CHECKPOINT',p_data:{...prepared,locks:[]}});
  assert.match(rejected.data.message,/PREPARED_LOCKS_IMMUTABLE/);
 };
 const forward=await workDailyRun(r.run_id,ports);
 assert.notEqual(forward.status,'BLOCKED',JSON.stringify(sqlErrors));
 assert.equal(sql(`select count(*) from vnext_runtime.predictions where run_id='${r.run_id}'`),'216');
 assert.equal(sql(`select count(*) from vnext_runtime.predictions where run_id='${r.run_id}' and payload->'research'->>'state'='INSUFFICIENT'`),'216');
 const lockedHash=sql(`select md5(string_agg(payload_text,E'\\n' order by id)) from vnext_runtime.predictions where run_id='${r.run_id}'`);
 assert.throws(()=>sql(`update vnext_runtime.predictions set symbol='FAKE' where run_id='${r.run_id}'`));
 assert.throws(()=>sql(`delete from vnext_runtime.predictions where run_id='${r.run_id}'`));
 assert.equal(sql(`select md5(string_agg(payload_text,E'\\n' order by id)) from vnext_runtime.predictions where run_id='${r.run_id}'`),lockedHash);
 assert.equal(sql('select count(*) from vnext_runtime.publication_status where approved'),'0');
 checks.push('Real SQL prepared checkpoint immutable and committed 216 synthetic insufficient locks reject update/delete; no member publication');
 active=(await rpc('claim_vnext_daily_research_v1',{p_run:r.run_id})).run;
 assert(active,'NEW_CLAIM_AFTER_LOCK');
 // Exercise actual SQL attempt exhaustion and retry_at, using an existing cold
 // plan task. This isolated RPC test does not claim the worker waited 300s.
 for(let attempt=1;attempt<=3;attempt++){
  assert.equal((await op('SOURCE_BEGIN',cold)).status,'FETCH');
  const delay=attempt===3?300:3;
  await op('SOURCE_FAIL',{key:cold.key,reason:'SOURCE_HTTP_503',retry_seconds:delay});
  assert.equal(sql(`select attempts from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${cold.key}'`),String(attempt));
  assert.equal(sql(`select extract(epoch from retry_at-public.vnext_test_now())::int from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${cold.key}'`),String(delay));
  if(attempt<3){assert.equal((await op('SOURCE_BEGIN',cold)).status,'WAIT_RETRY');advance(new Date(Date.parse(at)+3000).toISOString());}
 }
 assert.equal((await op('SOURCE_BEGIN',cold)).status,'EXHAUSTED');
 assert.equal(sql(`select source_id is null from vnext_runtime.run_sources where run_id='${r.run_id}' and task_key='${cold.key}'`),'t');
 checks.push('Real SQL retry_at, 300s delay, three-attempt exhaustion, and absent failed source');
 await op('FINISH',{status:'QUEUED'});
 console.log(JSON.stringify({scope:'ISOLATED_SYNTHETIC_CLOCK_PROVIDER_REAL_SQL_HTTP_NOT_PRODUCTION',checks,production_operations:0}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 for(const [created,id] of [[restCreated,rest],[dbCreated,db]])if(created)try{run(['rm','-f','-v',id]);}catch{}
 if(networkCreated)try{run(['network','rm',name]);}catch{}
}
