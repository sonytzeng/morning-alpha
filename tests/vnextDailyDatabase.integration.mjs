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
const migration='supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const name='ma-vnext-wiring-'+process.pid,db=name+'-db',rest=name+'-rest';
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
 run(['network','create',name]);run(['run','-d','--name',db,'--network',name,...ephemeralStorage,'-e','POSTGRES_PASSWORD','postgres:17']);
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
 const count=sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vnext_runtime' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity");assert.equal(count,'8');
 // Clock injection is exclusively this disposable test database, after exact DDL.
 for(const fname of ['enqueue_vnext_daily_research_v1','claim_vnext_daily_research_v1','vnext_daily_runtime_v1','get_owner_vnext_daily_v1']){
  const def=sql(`select pg_get_functiondef(oid) from pg_proc where proname='${fname}'`);sql(def.replaceAll('clock_timestamp()','public.vnext_test_now()'));
 }
 for(const [table,column] of [['runs','created_at'],['runs','updated_at'],['source_revisions','created_at'],['predictions','locked_at'],['audit','at']])sql(`alter table vnext_runtime.${table} alter column ${column} set default public.vnext_test_now()`);
 run(['run','-d','--name',rest,'--network',name,'-p',`127.0.0.1:${port}:3000`,'-e','PGRST_DB_URI','-e','PGRST_JWT_SECRET','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_LOG_LEVEL=crit','postgrest/postgrest:v14.13']);
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
 // Controlled permanent-denial response; real SQL, no MOPS network access.
 // A denied optional source must stay missing, not consume three invocations
 // per task and starve later evidence. Actual source/lock rows stay untouched.
 const deniedPlan=(await acquisitionPlan('2026-10-12',classifyCompanies(receipts))).filter(t=>t.kind==='EVENT').slice(0,2);
 await op('PLAN',deniedPlan);await op('FINISH',{status:'QUEUED'});
 let deniedRequests=0;
 const deniedResult=await workDailyRun(r.run_id,{rpc,clock:()=>at,sleep:async()=>{},fetcher:async url=>{
  assert(deniedPlan.some(t=>t.url===url));deniedRequests++;return new Response('',{status:403});
 }});
 assert.equal(deniedRequests,2,'permanent denial must advance to the next source, not retry the first');
 assert.equal(sql('select cursor from vnext_runtime.runs'),'2');
 assert.equal(sql("select count(*) from vnext_runtime.run_sources where reason='SOURCE_ACCESS_RESTRICTED' and attempts=1 and source_id is null"),'2');
 assert.equal(sql('select count(*) from vnext_runtime.predictions'),'0');
 assert.equal(deniedResult.status,'QUEUED');
 checks.push('Real SQL permanent403 source classification: one bounded attempt per source, cursor advances, no fake receipt/prediction or source-access bypass');
 // Restore only the disposable fixture plan before the independent existing
 // crash/lock/outcome tests below; no Production plan can be reset this way.
 sql("update vnext_runtime.runs set plan='[]',cursor=0");
 active=(await rpc('claim_vnext_daily_research_v1',{p_run:r.run_id})).run;
 // This end-to-end control has no price evidence: every symbol remains
 // insufficient, never synthetic buy points or a claimed real run.
 await op('PLAN',[dirTasks[0]]);await op('CURSOR',{cursor:1});await op('CHECKPOINT',{});await op('FINISH',{status:'QUEUED'});
 advance('2026-10-12T00:57:50.000Z');
 sql(`insert into public.decision_snapshots values('${'a'.repeat(8)}-1111-4111-8111-${'a'.repeat(12)}','2026-10-12','PREMARKET','READY','2026-10-12T00:57:49Z','{"market_bias":"RANGE"}','RANGE');`);
 verifyLockBatch=async(name,args)=>{
  preparedBatch=structuredClone(args.p_data);
  const malformed=structuredClone(args);malformed.p_data.at(-1).canonical='{}';
  const bad=await request('service_role',name,malformed);assert.match(bad.data.message,/PREDICTION_HASH/);
  assert.equal(sql('select count(*) from vnext_runtime.predictions'),'0');assert.equal(sql('select count(*) from vnext_runtime.publication_status'),'0');
  advance('2026-10-12T01:01:00.000Z');
  // Advance the lease only in this disposable DB so the forward deadline,
  // rather than the separate stale-lease check, is exercised directly.
  sql("update vnext_runtime.runs set lease_until='2026-10-12T01:02:00Z'");
  const late=await request('service_role',name,args);assert.match(late.data.message,/FORWARD_TIME_INVALID/);
  assert.equal(sql('select count(*) from vnext_runtime.predictions'),'0');
  advance('2026-10-12T00:57:50.000Z');sql("update vnext_runtime.runs set lease_until='2026-10-12T00:59:30Z'");
  const altered=await request('service_role',name,{...args,p_op:'CHECKPOINT',p_data:{locks:[],acquired:{snapshot_hash:'f'.repeat(64)}}});
  assert.match(altered.data.message,/PREPARED_LOCKS_IMMUTABLE/);
  checks.push('Last-row failure rolls back entire batch; no late forward lock; prepared checkpoint immutable');
  // Fault-inject process loss between CHECKPOINT and the SQL commit. Refuse
  // FINISH too, leaving the actual fenced lease for crash recovery to claim.
  interruptFinish=true;throw Error('ISOLATED_CRASH_BEFORE_COMMIT');
 };
 const pending=[];const workerSecret=randomBytes(40).toString('hex');
 server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const result=await handleVnextDaily(new Request('http://127.0.0.1:'+workerPort,{method:req.method,headers:req.headers,body}),{
  cronSecret:workerSecret,rpc,clock:()=>at,fetcher:async()=>{throw Error('UNEXPECTED_NETWORK');},sleep:async()=>{},background:p=>pending.push(p),continueRun:async()=>{},
 });res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());});
 await new Promise(resolve=>server.listen(workerPort,'127.0.0.1',resolve));
 const invoke=()=>fetch('http://127.0.0.1:'+workerPort,{method:'POST',headers:{'x-vnext-internal':workerSecret,'Content-Type':'application/json'},body:JSON.stringify({run_id:r.run_id})});
 assert.equal((await invoke()).status,202);await Promise.all(pending);
 assert.equal(sql('select count(*) from vnext_runtime.predictions'),'0');
 assert.equal(sql("select jsonb_array_length(checkpoint->'locks') from vnext_runtime.runs"),'216');
 const preparedFingerprint=sql("select md5((checkpoint->'locks')::text) from vnext_runtime.runs");
 assert.notEqual(sql('select state from vnext_runtime.runs'),'COMPLETE');
 advance('2026-10-12T00:59:31.000Z');
 // Recovery must submit the checkpoint bytes. The database commits, but the
 // caller loses that response: another retry must reconcile, not duplicate.
 verifyLockBatch=async(_name,args)=>assert.deepEqual(args.p_data,preparedBatch);dropCommitReply=true;
 assert.equal((await invoke()).status,202);await Promise.all(pending);
 assert.equal(sql('select count(*) from vnext_runtime.predictions'),'216');
 assert.equal(sql("select md5((checkpoint->'locks')::text) from vnext_runtime.runs"),preparedFingerprint);
 assert.notEqual(sql('select state from vnext_runtime.runs'),'COMPLETE');
 const committedFingerprint=sql("select jsonb_build_object('predictions',count(*),'payload',md5(string_agg(payload_text,E'\\n' order by id)),'queue',(select count(*) from vnext_runtime.outcome_queue),'publication',(select count(*) from vnext_runtime.publication_status)) from vnext_runtime.predictions");
 advance('2026-10-12T01:01:12.000Z');
 assert.equal((await invoke()).status,202);await Promise.all(pending);
 assert.equal(sql("select md5((checkpoint->'locks')::text) from vnext_runtime.runs"),preparedFingerprint);
 assert.equal(sql("select jsonb_build_object('predictions',count(*),'payload',md5(string_agg(payload_text,E'\\n' order by id)),'queue',(select count(*) from vnext_runtime.outcome_queue),'publication',(select count(*) from vnext_runtime.publication_status)) from vnext_runtime.predictions"),committedFingerprint);
 checks.push('Real SQL crash before commit -> 0 rows; actual 100s lease expiry -> exact 216 rows; response lost -> next actual lease expiry after cutoff reconciles unchanged Prediction/queue/publication fingerprints');
 assert.equal(sql('select count(*) from vnext_runtime.predictions'),'216',JSON.stringify(sqlErrors)+sql("select jsonb_build_object('state',state,'reason',reason,'failure',checkpoint->'failure') from vnext_runtime.runs"));assert.equal(sql("select count(*) from vnext_runtime.predictions where payload->'research'->>'state'='INSUFFICIENT'"),'216');
 assert.equal(sql("select count(*) from vnext_runtime.publication_status where approved"),'0');
 assert.equal(sql("select state from vnext_runtime.runs"),'COMPLETE');
 assert.equal((await invoke()).status,202);await Promise.all(pending);assert.equal(sql('select count(*) from vnext_runtime.predictions'),'216');
 checks.push('HTTP worker -> transactional SQL -> 216 immutable insufficient judgments -> idempotent no duplicate/publication');
 assert.throws(()=>sql("update vnext_runtime.predictions set symbol='FAKE'"));assert.throws(()=>sql('delete from vnext_runtime.predictions'));
 assert.throws(()=>sql("update vnext_runtime.source_revisions set source='FAKE'"));checks.push('Prediction/source/publication append-only triggers');
 const ownerRead=await request('authenticated','get_owner_vnext_daily_v1',{p_date:'2026-10-12'},owner);assert.equal(ownerRead.data.predictions.length,216);assert.equal(ownerRead.data.member_published,0);
 const wrong=token('authenticated',free).split('.');wrong[1]=Buffer.from(JSON.stringify({role:'authenticated',sub:owner,exp:4102444800})).toString('base64url');
 assert.equal((await localFetch(base+'/rpc/get_owner_vnext_daily_v1',{method:'POST',headers:{Authorization:'Bearer '+wrong.join('.'),'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await localFetch(base+'/rpc/get_owner_vnext_daily_v1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);checks.push('Forged JWT / logged-out private read denied');
 // Resume the completed isolated run solely to test RPC outcome rejection and
 // atomic source retry limits. Never mutate a production checkpoint.
 sql("update vnext_runtime.runs set state='QUEUED'");active=(await rpc('claim_vnext_daily_research_v1',{p_run:r.run_id})).run;
 assert.equal((await op('DUE_OUTCOMES')).length,0);
 const lock=ownerRead.data.predictions.find(p=>p.horizon==='SHORT');
 const source={symbol:lock.symbol,observed_at:at,bars:[],benchmark:[],actions:null,invalidation:null};
 const outcome=await researchOutcome(lock,1,source),oid=await snapshotHash({prediction:lock.lock_hash,horizon:1,source:outcome.outcome_source_hash});
 assert.equal(outcome.state,'NOT_MATURED');
 await assert.rejects(()=>op('OUTCOME',{id:oid,result:{...outcome,state:'OBSERVED_NOT_PERFORMANCE'}}),/OUTCOME_NOT_MATURED/);
 await assert.rejects(()=>op('OUTCOME',{id:oid,result:{...outcome,performance_eligible:true,net_return:0.1}}),/OUTCOME_CONTRACT/);
 await op('OUTCOME',{id:oid,result:outcome});await op('OUTCOME',{id:oid,result:outcome});assert.equal(sql('select count(*) from vnext_runtime.outcomes'),'1');
 await assert.rejects(()=>op('OUTCOME',{id:oid,result:{...outcome,reasons:['changed']}}),/OUTCOME_IDEMPOTENCY_CONFLICT/);
 const retryTask={...dirTasks[0],key:'9'.repeat(64)};
 for(let i=0;i<3;i++){assert.equal((await op('SOURCE_BEGIN',retryTask)).status,'FETCH');await op('SOURCE_FAIL',{key:retryTask.key,reason:'RATE_LIMITED',retry_seconds:3});if(i<2){assert.equal((await op('SOURCE_BEGIN',retryTask)).status,'WAIT_RETRY');advance(new Date(Date.parse(at)+4000).toISOString());}}
 assert.equal((await op('SOURCE_BEGIN',retryTask)).status,'EXHAUSTED');
 advance('2026-10-12T06:00:00.000Z');
 sql("update vnext_runtime.runs set state='COMPLETE',lease=null,lease_until=null");
 const closeClaim=await rpc('claim_vnext_daily_research_v1',{p_run:r.run_id});assert.equal(closeClaim.status,'ACQUIRED');active=closeClaim.run;
 checks.push('Previously COMPLETE run wakes at an existing post-close checkpoint for matured outcomes only');
 const matured={...outcome,observed_at:at,state:'OBSERVED_NOT_PERFORMANCE',outcome_source_hash:'e'.repeat(64),observations:{label:'SYNTHETIC SQL CONTRACT CONTROL'}};
 await op('OUTCOME',{id:'e'.repeat(64),result:matured});await op('OUTCOME_CHECKED',{id:lock.id});
 assert.equal(sql(`select completed_horizons::text from vnext_runtime.outcome_queue where prediction_id='${lock.id}'`),'{1}');
 sql(`update vnext_runtime.outcome_queue set last_checked=null where prediction_id='${lock.id}'`);
 // Bound the query to this control without changing any immutable prediction.
 sql(`update vnext_runtime.outcome_queue set last_checked='2026-10-12' where prediction_id<>'${lock.id}'`);
 assert.equal((await op('DUE_OUTCOMES')).length,0,'future horizons must not occupy the due queue');
 advance('2026-10-16T06:00:00.000Z');
 // A new legal day resumes outcomes via its own natural run, never rewrites the
 // old prediction. This fixture extends only the current run's lease to inspect
 // maturity directly; old-date worker admission remains separately denied.
 sql("update vnext_runtime.runs set lease_until='2026-10-16T06:02:00Z'");
 sql(`update vnext_runtime.outcome_queue set last_checked='2026-10-16' where prediction_id<>'${lock.id}'`);
 const laterDue=await op('DUE_OUTCOMES');
 assert.deepEqual(laterDue.find(p=>p.prediction.id===lock.id).horizons,[5]);
 assert(laterDue.every(p=>p.prediction.horizon!=='LONG'),'unknown future calendar must not be mistaken for matured long outcomes');
 checks.push('Matured horizons only; future long work cannot starve 1D/5D outcomes; next due advances after completion');
 checks.push('Outcome maturity / no fake P&L / append idempotency; persisted three-attempt rate limit');
 // Preserve immutable evidence across actual DB transactions and API retries.
 assert.equal(sql("select count(*) from vnext_runtime.outcomes where payload->>'performance_eligible'='true'"),'0');
 assert.equal(sql("select count(*) from vnext_runtime.predictions where payload->>'mode'<>'FORWARD_SHADOW'"),'0');
 // Roll back only the new execution entrypoints, retaining immutable research.
 const preserved=sql("select jsonb_build_object('prediction',md5((select string_agg(payload_text,E'\\n'order by id)from vnext_runtime.predictions)),'outcome',md5((select string_agg(payload::text,E'\\n'order by id)from vnext_runtime.outcomes)),'audit',count(*))from vnext_runtime.audit");
 sql('revoke execute on function public.enqueue_vnext_daily_research_v1(date,text,uuid),public.claim_vnext_daily_research_v1(uuid),public.vnext_daily_runtime_v1(uuid,uuid,integer,text,jsonb) from service_role');
 assert.equal((await request('service_role','claim_vnext_daily_research_v1',{p_run:r.run_id})).status,403);
 assert.equal((await request('authenticated','get_owner_vnext_daily_v1',{p_date:'2026-10-12'},owner)).status,200);
 assert.equal(sql("select jsonb_build_object('prediction',md5((select string_agg(payload_text,E'\\n'order by id)from vnext_runtime.predictions)),'outcome',md5((select string_agg(payload::text,E'\\n'order by id)from vnext_runtime.outcomes)),'audit',count(*))from vnext_runtime.audit"),preserved);
 checks.push('Exact execution rollback: only new worker RPC revoked; Owner forensics and prediction/outcome/audit byte fingerprints retained');
 console.log(JSON.stringify({scope:'ISOLATED_SYNTHETIC_CLOCK_AND_IDENTITIES_REAL_SQL_HTTP_NOT_PRODUCTION',checks,production_operations:0,real_forward_sample:0,real_outcome_sample:0}));
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 for(const id of [rest,db])try{run(['rm','-f','-v',id]);}catch{}
 try{run(['network','rm',name]);}catch{}
}
