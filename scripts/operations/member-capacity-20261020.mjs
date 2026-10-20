// SYNTHETIC LOCAL DB-LAYER CAPACITY MODEL. Not Production/Auth E2E/investment evidence.
// Usage: node --experimental-strip-types scripts/operations/member-capacity-20261020.mjs --run
// No URL/port/credential arguments, no image pulls, no existing DB/container reuse.
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,mkdirSync,writeFileSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {resolveEffectiveMemberAccess} from '../../supabase/functions/_shared/member-entitlement.ts';
import {contentSql} from '../academy-v11/load-content.mjs';
import {syntheticLessons} from '../../tests/fixtures/academy-v11-lessons.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const BASELINE='8c110263ddcf83e4471dfc8e32adafd1c47c2c40';
export const DELIVERY_ROOT=resolve(ROOT,'product-delivery-20261020');
export const SOURCE_PATHS=Object.freeze([
 'supabase/migrations/20260822183421_member_access_trial_state_machine.sql',
 'supabase/migrations/20261013045054_membership_legacy_policy_candidate.sql',
 'supabase/migrations/20261009053655_academy_member_learning_v11.sql',
 'supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql',
 'supabase/functions/member-access/index.ts','supabase/functions/_shared/member-entitlement.ts',
 'scripts/academy-v11/load-content.mjs','tests/fixtures/academy-v11-lessons.mjs',
]);
export const MODEL=Object.freeze({members:10000,seed:20261020,max_clients:16,max_connections:24,
 statement_timeout_ms:2000,latency_limit_ms:2000,max_duration_seconds:30,run_deadline_ms:180000,
 steady:Object.freeze({name:'steady',clients:4,rate:20,seconds:15,active_fraction:0.02,think_seconds:10}),
 peak:Object.freeze({name:'peak',clients:16,rate:100,seconds:15,active_fraction:0.10,think_seconds:10})});
const sha=b=>createHash('sha256').update(b).digest('hex');
const env=()=>({PATH:process.env.PATH,HOME:homedir(),LC_ALL:'C',LANG:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function validatePhase(p){
 assert.deepEqual(Object.keys(p).sort(),['active_fraction','clients','name','rate','seconds','think_seconds']);
 assert(['steady','peak'].includes(p.name));
 assert(Number.isInteger(p.clients)&&p.clients>=1&&p.clients<=16,'CLIENT_LIMIT');
 assert(Number.isInteger(p.rate)&&p.rate>=1&&p.rate<=100,'RATE_LIMIT');
 assert(Number.isInteger(p.seconds)&&p.seconds>=1&&p.seconds<=30,'DURATION_LIMIT');
 assert(p.rate*p.seconds<=3000,'REQUEST_LIMIT');
 assert(p.active_fraction>0&&p.active_fraction<=0.1&&p.think_seconds===10);
 assert.equal(p.rate,MODEL.members*p.active_fraction/p.think_seconds,'MODEL_RATE');
 return {...p};
}
export function phaseBudget(p){
 validatePhase(p);const perClient=Math.floor(p.rate*p.seconds/p.clients);
 assert(perClient>=1,'NONEMPTY_TRANSACTION_BUDGET');
 const cap=perClient*p.clients;assert(cap<=3000,'HARD_TRANSACTION_LIMIT');
 return {transactions_per_client:perClient,hard_transaction_cap:cap,process_timeout_ms:(p.seconds+10)*1000};
}
export function readRegularSource(path,root=ROOT){
 assert(SOURCE_PATHS.includes(path),'SOURCE_PATH_NOT_ALLOWLISTED');
 let target=root;assert(lstatSync(target).isDirectory()&&!lstatSync(target).isSymbolicLink(),'REGULAR_SOURCE_ROOT');
 for(const [i,part]of path.split('/').entries()){
  target=join(target,part);const s=lstatSync(target);assert(!s.isSymbolicLink(),'SOURCE_SYMLINK');
  assert(i===path.split('/').length-1?s.isFile()&&s.size<=1048576:s.isDirectory(),'REGULAR_BOUNDED_SOURCE');
 }
 const b=readFileSync(target);assert(b.length<=1048576,'SOURCE_SIZE_LIMIT');return b;
}
export function assertLocalDockerEndpoint(endpoint){
 assert(typeof endpoint==='string'&&/^unix:\/\/[A-Za-z0-9_./-]+\.sock$/.test(endpoint),'LOCAL_UNIX_DOCKER_ONLY');
 assert(!endpoint.slice(7).split('/').includes('..'),'LOCAL_UNIX_DOCKER_ONLY');return endpoint;
}
export function assertOwnedInspection(info,name,nonce){
 assert.equal(info.Name,'/'+name,'OWNED_CONTAINER_NAME');
 assert.equal(info.Config.Labels?.['morning-alpha.member-capacity'],nonce,'OWNED_CONTAINER_LABEL');
 assert.equal(info.HostConfig.NetworkMode,'none','NETWORK_NONE_REQUIRED');
 assert.equal(info.HostConfig.ReadonlyRootfs,true,'READONLY_ROOT_REQUIRED');
 assert(!info.HostConfig.Privileged,'NO_PRIVILEGED_CONTAINER');
 assert.deepEqual(info.HostConfig.PortBindings||{},{});assert.equal(info.HostConfig.Binds?.length||0,0,'NO_HOST_BINDS');
}
export function cleanupOwnedContainer(docker,inspect,name,nonce){
 const list=()=>docker(['ps','-a','--filter','label=morning-alpha.member-capacity='+nonce,'--format','{{.ID}}']);
 const owned=list();if(owned){assert(!owned.includes('\n'),'OWNED_CONTAINER_COUNT');assertOwnedInspection(inspect(),name,nonce);docker(['rm','-f','-v',name]);}
 assert.equal(list(),'','CLEANUP_CONTAINER_REMAINS');
 return {status:'VERIFIED_REMOVED',owned_container:name,network_objects_created:0,volumes_created:0};
}
export function selectedColumns(source,table){
 assert(['profiles','member_entitlements','membership_access_config'].includes(table));
 const rows=[...source.matchAll(new RegExp('\\.from\\("'+table+'"\\)\\s*\\.select\\("([^"]+)"\\)','g'))];
 assert.equal(rows.length,1,'EXACT_MEMBER_ACCESS_SELECT:'+table);
 assert(/^[a-z_]+(?:,[a-z_]+)*$/.test(rows[0][1]),'EXPLICIT_COLUMNS_ONLY');return rows[0][1];
}
export function memberId(i){assert(Number.isInteger(i)&&i>=1&&i<=10000);return '00000000-0000-4000-8000-'+String(i).padStart(12,'0');}
export function expectedTier(i){memberId(i);return i===10000?'owner':i%10>=3&&i%10<=7?'premium':'free';}
const idExpr="('00000000-0000-4000-8000-'||lpad(:member::text,12,'0'))::uuid";
export function workloadSql(columns){
 for(const table of ['profiles','member_entitlements','membership_access_config'])assert(/^[a-z_]+(?:,[a-z_]+)*$/.test(columns[table]));
 return `\\set member random(1, 10000)
BEGIN READ ONLY;
SET LOCAL statement_timeout='2000ms';
SET LOCAL lock_timeout='1000ms';
SET LOCAL ROLE service_role;
SELECT ${columns.profiles} FROM public.profiles WHERE id=${idExpr};
SELECT ${columns.member_entitlements} FROM public.member_entitlements WHERE user_id=${idExpr};
SELECT ${columns.membership_access_config} FROM public.membership_access_config WHERE config_key='primary';
SELECT public.get_member_policy_receipt_v1(${idExpr});
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',(${idExpr})::text,true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(${idExpr})::text,'role','authenticated')::text,true);
SELECT 1/((count(*)=1 AND bool_and(id=${idExpr}))::int) FROM public.profiles;
SELECT 1/((count(*)=0)::int) FROM public.profiles WHERE id=('00000000-0000-4000-8000-'||lpad(((:member % 10000)+1)::text,12,'0'))::uuid;
SELECT 1/((count(*)=1 AND bool_and(user_id=${idExpr}))::int) FROM public.academy_progress_v11;
WITH result AS MATERIALIZED (SELECT public.get_academy_catalog_v11() AS body)
SELECT body,1/(((body->>'tier')=CASE WHEN :member=10000 THEN 'owner' WHEN :member%10 BETWEEN 3 AND 7 THEN 'premium' ELSE 'free' END)::int) FROM result;
ROLLBACK;
`;
}
export function quantiles(samples){
 assert(samples.length>0&&samples.every(x=>Number.isFinite(x)&&x>=0),'VALID_LATENCY_SAMPLES');
 const s=[...samples].sort((a,b)=>a-b),at=p=>s[Math.max(0,Math.ceil(s.length*p)-1)];
 return {count:s.length,p50_ms:at(.5),p95_ms:at(.95),p99_ms:at(.99),max_ms:s.at(-1)};
}
export function parseTransactionLogs(text){
 const latency=[],execution=[],lag=[];let skipped=0,failed=0;
 for(const line of text.trim().split('\n').filter(Boolean)){
  const f=line.trim().split(/\s+/);assert(f.length===7,'PG17_LOG_FORMAT');
  if(f[2]==='skipped'){skipped++;continue;}if(f[2]==='failed'){failed++;continue;}
  const us=Number(f[2]),wait=Number(f[6]);assert(Number.isFinite(us)&&Number.isFinite(wait)&&us>=wait&&wait>=0,'PG17_LOG_LATENCY');
  latency.push(us/1000);execution.push((us-wait)/1000);lag.push(wait/1000);
 }
 return {scheduled_latency:quantiles(latency),execution_latency:quantiles(execution),schedule_lag:quantiles(lag),skipped,failed};
}
export function parsePgbench(text){
 const value=re=>{const m=text.match(re);assert(m,'PGBENCH_SUMMARY_MISSING');return Number(m[1]);};
 return {completed:value(/number of transactions actually processed:\s*(\d+)/),
  failed:value(/number of failed transactions:\s*(\d+)/),
  skipped:Number(text.match(/number of transactions skipped:\s*(\d+)/)?.[1]||0),
  tps:value(/tps = ([\d.]+)/)};
}
export function safePlan(plan){
 const keys=['Node Type','Relation Name','Index Name','Actual Rows','Actual Loops','Actual Total Time','Shared Hit Blocks','Shared Read Blocks','Total Cost'];
 const pick=n=>Object.fromEntries([...keys.filter(k=>n[k]!==undefined).map(k=>[k,n[k]]),...(n.Plans?[['Plans',n.Plans.map(pick)]]:[])]);
 assert(Array.isArray(plan)&&plan.length===1&&plan[0].Plan,'EXPLAIN_JSON');
 return {plan:pick(plan[0].Plan),planning_ms:plan[0]['Planning Time'],execution_ms:plan[0]['Execution Time']};
}
function sources(){
 const bytes=new Map();const metadata=SOURCE_PATHS.map(path=>{const current=readRegularSource(path);const pinned=execFileSync('git',['--no-replace-objects','show',BASELINE+':'+path],{cwd:ROOT,env:env(),maxBuffer:8e6,timeout:10000});assert.deepEqual(current,pinned,'BASELINE_SOURCE_DRIFT:'+path);bytes.set(path,current);return {path,sha256:sha(current)};});
 return {metadata,read:path=>{assert(bytes.has(path),'SOURCE_PATH_NOT_ALLOWLISTED');return bytes.get(path).toString('utf8');}};
}
function prerequisitesSql(){return `
CREATE EXTENSION pgcrypto; CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE capacity_worker LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT anon,authenticated,service_role TO capacity_worker;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz NOT NULL DEFAULT now(),is_anonymous boolean NOT NULL DEFAULT false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),role text,subscription_status text,membership_tier text,paid_until timestamptz,email text,updated_at timestamptz DEFAULT now());
REVOKE ALL ON public.profiles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.profiles TO anon,authenticated;
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING ((SELECT auth.uid())=id);
CREATE SCHEMA research_private; CREATE TABLE research_private.owner_access(principal_id uuid PRIMARY KEY,enabled boolean);
REVOKE ALL ON SCHEMA research_private FROM PUBLIC,anon,authenticated;
`;}
function seedSql(){return `
INSERT INTO auth.users(id,email) SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'synthetic-'||i||'@capacity.invalid' FROM generate_series(1,10000)i;
INSERT INTO public.profiles(id,email,role,subscription_status) SELECT id,email,CASE WHEN id='${memberId(10000)}' THEN 'admin' ELSE 'free' END,'inactive' FROM auth.users;
INSERT INTO research_private.owner_access VALUES('${memberId(10000)}',true);
INSERT INTO public.member_entitlements(user_id,state,tier,source,access_started_at,access_ends_at,trial_started_at,trial_ends_at,metadata)
SELECT ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 CASE WHEN i=10000 THEN 'owner' WHEN i%10 BETWEEN 3 AND 5 THEN 'paid_active' WHEN i%10=6 THEN 'trialing' WHEN i%10=7 THEN 'canceled' WHEN i%10=8 THEN 'expired' ELSE 'past_due' END,
 CASE WHEN i=10000 THEN 'admin' ELSE 'member' END,CASE WHEN i=10000 THEN 'owner' ELSE 'manual' END,
 now()-interval '1 day',CASE WHEN i=10000 THEN NULL WHEN i%10 IN(8,9) THEN now()-interval '1 hour' ELSE now()+interval '7 days' END,
 CASE WHEN i%10=6 THEN now()-interval '1 day' END,CASE WHEN i%10=6 THEN now()+interval '7 days' END,'{"synthetic":true,"payment_verified":false}'::jsonb
FROM generate_series(1,10000)i WHERE i%10 BETWEEN 3 AND 9 OR i=10000;
INSERT INTO public.academy_progress_v11(user_id,chapter_id,version) SELECT id,'candles','ACADEMY_MEMBER_V11' FROM auth.users;
ANALYZE;
`;}
const asUser=(id,sql)=>`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='${id}';${sql};ROLLBACK;`;
const invariantSql=()=>`SELECT jsonb_build_object(${['profiles','member_entitlements','membership_access_config','membership_access_events','billing_webhook_events','academy_progress_v11'].map(table=>`'${table}',(SELECT jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex')) FROM public.${table} t)`).join(',')},'policy_rows',(SELECT count(*) FROM membership_private.policy_versions))`;

export async function runCapacity({seconds=15}={}){
 const phases=[validatePhase({...MODEL.steady,seconds}),validatePhase({...MODEL.peak,seconds})];
 const nonce=randomUUID(),name='ma-member-capacity-'+nonce;
 const report={schema:'MEMBER_CAPACITY_SYNTHETIC_DB_MODEL_1',baseline:BASELINE,run_id:nonce,status:'BLOCKED',synthetic:true,
  production_used:false,production_auth_e2e:false,production_10000_member_capacity:'UNKNOWN_NOT_PROVEN',investment_evidence:false,
  payments:false,line:false,cost:'UNKNOWN',model:MODEL,phases:[],cleanup:{status:'NOT_CREATED'},limitations:[
   'DB-layer member-access status reads + existing entitlement resolver and Academy RPC/RLS; NOT Edge/Auth/HTTP end-to-end.',
   'Synthetic Auth prerequisite schema and controlled SQL identity claims, not signed Production sessions.',
   '10,000 stored accounts; NOT 10,000 concurrent connections. Local PostgreSQL is not a Supabase managed pool benchmark.',
   'All 10,000 DB rows are checked by the existing resolver separately; load uses random controlled SQL identities. Distinct load users are not recorded.',
   'Per-client transaction counts provide a hard cap; seconds describe the target scheduling window, not an exact fixed-duration run.',
   'No Production sizing/cost/SLO claim; local safety limits are not an approved product SLO.',
  ]};
 let host,created=false,cleaning=false,stage='source_pins';const deadline=performance.now()+MODEL.run_deadline_ms;
 const docker=(args,{input,timeout=15000}={})=>{assert(cleaning||performance.now()<deadline,'RUN_DEADLINE');try{return execFileSync('docker',[...(host?['--host',host]:[]),...args],{env:env(),input,timeout:cleaning?timeout:Math.max(1,Math.min(timeout,Math.floor(deadline-performance.now()))),encoding:'utf8',maxBuffer:20e6,stdio:['pipe','pipe','pipe']}).trim();}catch(error){throw Object.assign(Error('LOCAL_DOCKER_'+args[0]),{cause:error});}};
 const sql=(s,user='postgres',timeout=15000)=>docker(['exec','-i',name,'psql','-h','127.0.0.1','-p','5432','-XqAt','-U',user,'-d','postgres','-v','ON_ERROR_STOP=1','--set=VERBOSITY=sqlstate'],{input:s,timeout});
 const inspect=()=>JSON.parse(docker(['container','inspect',name]))[0];
 const denied=(s)=>{let caught;try{sql(s,'capacity_worker');}catch(e){caught=e;}assert(caught,'EXPECTED_DB_DENIAL');assert.match(String(caught.cause?.stderr),/42501/,'DENIAL_MUST_BE_PERMISSION_NOT_BROKEN_SQL');};
 try{
  const bundle=sources(),read=bundle.read;report.sources=bundle.metadata;
  report.harness=['scripts/operations/member-capacity-20261020.mjs','tests/memberCapacityModel.test.mjs'].map(path=>({path,sha256:sha(readFileSync(join(ROOT,path)))}));
  stage='local_docker';host=assertLocalDockerEndpoint(docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']));
  assert(lstatSync(host.slice(7)).isSocket(),'LOCAL_DOCKER_SOCKET');
  const image=JSON.parse(docker(['image','inspect','postgres:17']))[0];assert.match(image.Id,/^sha256:[a-f0-9]{64}$/);report.image_id=image.Id;
  stage='create_owned_network_none';created=true;
  docker(['run','--pull','never','-d','--name',name,'--label','morning-alpha.member-capacity='+nonce,'--network','none','--read-only',
   '--cpus','1','--memory','1g','--memory-swap','1g','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=536870912',
   '--tmpfs','/var/run/postgresql:rw,size=16777216','--tmpfs','/tmp:rw,size=67108864','-e','POSTGRES_HOST_AUTH_METHOD=trust',
   image.Id,'-c','max_connections=24','-c','shared_buffers=128MB','-c','work_mem=4MB','-c','statement_timeout=2000','-c','lock_timeout=1000']);
  assertOwnedInspection(inspect(),name,nonce);stage='readiness';let ready=false;
  const readyDeadline=performance.now()+20000;while(performance.now()<readyDeadline){try{if(sql('SELECT 1','postgres',1000)==='1'){ready=true;break;}}catch{}await pause(250);}assert(ready,'LOCAL_DB_READY_DEADLINE');
  report.server={version:sql('SHOW server_version'),max_connections:Number(sql('SHOW max_connections')),cpu_limit:1,memory_limit_bytes:1073741824,network:'none',database_host:'127.0.0.1',ports_published:0};
  assert.equal(Math.floor(Number(sql('SHOW server_version_num'))/10000),17);
  stage='existing_schema';sql(prerequisitesSql());
  const owner=read(SOURCE_PATHS[3]);sql(owner.slice(owner.indexOf('create function public.is_research_owner_v1()'),owner.indexOf('create table public.research_feature_versions')));
  sql(read(SOURCE_PATHS[0]));sql(read(SOURCE_PATHS[1]));sql(read(SOURCE_PATHS[2]));sql(contentSql(syntheticLessons));sql(seedSql());
  const columns=Object.fromEntries(['profiles','member_entitlements','membership_access_config'].map(t=>[t,selectedColumns(read('supabase/functions/member-access/index.ts'),t)]));
  report.member_access_selects=columns;const workload=workloadSql(columns);report.workload_sha256=sha(workload);
  const before=JSON.parse(sql(invariantSql()));assert.equal(before.profiles.rows,10000);assert.equal(before.policy_rows,0);
  stage='all_10000_existing_resolver';
  const all=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',p.id,'profile',to_jsonb(p),'entitlement',CASE WHEN e.user_id IS NULL THEN NULL ELSE to_jsonb(e) END) ORDER BY p.id) FROM public.profiles p LEFT JOIN public.member_entitlements e ON e.user_id=p.id`));
  assert.equal(all.length,10000);const tiers={free:0,premium:0,owner:0};
  all.forEach((row,i)=>{assert.equal(row.id,memberId(i+1));const a=resolveEffectiveMemberAccess(row.profile,row.entitlement);const tier=a.tier==='admin'?'owner':a.active?'premium':'free';assert.equal(tier,expectedTier(i+1));tiers[tier]++;});report.all_accounts_actual_db_reads_and_existing_resolver={count:all.length,tiers};
  stage='rls_controls';let checks=0;
  for(const i of [1,2,3,4,5,6,7,8,9,10,10000]){
   const body=JSON.parse(sql(asUser(memberId(i),'SELECT public.get_academy_catalog_v11()'),'capacity_worker'));assert.equal(body.user_id,memberId(i));assert.equal(body.tier,expectedTier(i));assert.equal(body.progress.length,1);assert.equal(body.chapters.filter(c=>c.allowed).length,expectedTier(i)==='free'?7:10);checks++;
  }
  for(const role of ['anon','authenticated']){
   denied(`BEGIN;SET LOCAL ROLE ${role};SET LOCAL request.jwt.claim.sub='${memberId(1)}';SELECT * FROM public.member_entitlements;ROLLBACK;`);checks++;
  }
  denied('BEGIN;SET LOCAL ROLE anon;SELECT public.get_academy_catalog_v11();ROLLBACK;');checks++;
  denied("BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='';SELECT public.get_academy_catalog_v11();ROLLBACK;");checks++;
  for(const t of ['profiles','academy_progress_v11']){const id=t==='profiles'?'id':'user_id';assert.equal(sql(asUser(memberId(1),`SELECT count(*) FROM public.${t} WHERE ${id}='${memberId(3)}'`),'capacity_worker'),'0');checks++;}
  assert.equal(sql(asUser(memberId(1),"SET LOCAL request.jwt.claims='{\"user_metadata\":{\"role\":\"admin\",\"tier\":\"premium\"}}';SELECT public.get_academy_catalog_v11()->>'tier'"),'capacity_worker'),'free');checks++;
  assert.equal(sql(asUser(memberId(1),"WITH x AS (UPDATE public.profiles SET role='admin' RETURNING id) SELECT count(*) FROM x"),'capacity_worker'),'0');checks++;
  denied(asUser(memberId(1),`INSERT INTO public.academy_progress_v11(user_id,chapter_id,version) VALUES('${memberId(3)}','volume','ACADEMY_MEMBER_V11')`));checks++;
  assert.equal(sql(asUser(memberId(1),"SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname=current_user"),'capacity_worker'),'f');checks++;
  const reused=sql(asUser(memberId(1),'SELECT count(*) FROM public.academy_progress_v11')+asUser(memberId(3),'SELECT count(*) FROM public.academy_progress_v11')+"BEGIN;SET LOCAL ROLE authenticated;SELECT auth.uid() IS NULL;ROLLBACK;",'capacity_worker');assert.equal(reused,'1\n1\nt');checks++;
  report.isolation={controls_passed:checks,all_passed:true,raw_entitlements:'DENIED',cross_account:'DENIED',metadata_escalation:'DENIED',reused_connection_identity_reset:true};
  report.plans={
   profile_rls:safePlan(JSON.parse(sql(asUser(memberId(1),`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT ${columns.profiles} FROM public.profiles WHERE id='${memberId(1)}'`),'capacity_worker'))),
   entitlement_service:safePlan(JSON.parse(sql(`BEGIN;SET LOCAL ROLE service_role;EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT ${columns.member_entitlements} FROM public.member_entitlements WHERE user_id='${memberId(3)}';ROLLBACK;`,'capacity_worker'))),
   existing_catalog_rpc:safePlan(JSON.parse(sql(asUser(memberId(3),'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT public.get_academy_catalog_v11()'),'capacity_worker'))),
  };
  report.rls_tables=JSON.parse(sql("SELECT jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM pg_class WHERE oid IN ('public.profiles'::regclass,'public.member_entitlements'::regclass,'public.academy_progress_v11'::regclass,'public.academy_lessons_v11'::regclass)"));assert(report.rls_tables.every(t=>t.rls));
  for(const phase of phases){
   stage='load_'+phase.name;assertOwnedInspection(inspect(),name,nonce);let observed=0,monitorError;
   const timer=setInterval(()=>{try{observed=Math.max(observed,Number(sql("SELECT count(*) FROM pg_stat_activity WHERE usename='capacity_worker'")));}catch(e){monitorError=e;}},1000);
   const started=performance.now(),budget=phaseBudget(phase);assert(deadline-started>budget.process_timeout_ms,'PHASE_DEADLINE_BUDGET');let output;
   try{output=await new Promise((ok,no)=>{const args=['--host',host,'exec','-i',name,'pgbench','-h','127.0.0.1','-p','5432','-U','capacity_worker','-d','postgres','-n','-c',String(phase.clients),'-j','2','-t',String(budget.transactions_per_client),'-R',String(phase.rate),'--latency-limit=2000','--max-tries=1','--random-seed=20261020','-l','--log-prefix=/tmp/member-capacity-'+phase.name,'-f','/dev/stdin'];const child=execFile('docker',args,{env:env(),encoding:'utf8',maxBuffer:4e6,timeout:budget.process_timeout_ms},(error,stdout)=>error?no(Error('LOAD_PROCESS_FAILED')):ok(stdout));child.stdin.on('error',()=>{});child.stdin.end(workload);});}finally{clearInterval(timer);}
   if(monitorError)throw monitorError;assert(observed>0&&observed<=phase.clients+1,'CONNECTION_BOUND');
   const summary=parsePgbench(output),files=docker(['exec',name,'find','/tmp','-maxdepth','1','-type','f','-name','member-capacity-'+phase.name+'.*']).split('\n').filter(Boolean);
   assert(files.length>=1&&files.length<=2);for(const f of files)assert(new RegExp('^/tmp/member-capacity-'+phase.name+'\\.[0-9.]+$').test(f));
   const logs=parseTransactionLogs(files.map(f=>docker(['exec',name,'cat',f])).join('\n'));
   assert.equal(logs.scheduled_latency.count,summary.completed,'COMPLETE_LATENCY_INVENTORY');assert.equal(logs.skipped,summary.skipped);assert.equal(logs.failed,summary.failed);
   assert(summary.completed+summary.failed+summary.skipped<=budget.hard_transaction_cap,'HARD_TRANSACTION_LIMIT');
   report.phases.push({...phase,...budget,...summary,...logs,wall_seconds:(performance.now()-started)/1000,observed_max_worker_sessions:observed,rate_attainment:summary.tps/phase.rate});
   assert.equal(summary.failed,0,'LOAD_ERRORS');assert.equal(summary.skipped,0,'LOAD_SKIPS');assert(summary.completed>0,'NO_LOAD_TRANSACTIONS');
  }
  stage='read_invariance';assert.deepEqual(JSON.parse(sql(invariantSql())),before,'READ_WORKLOAD_MUTATED_DATA');report.read_invariance={unchanged:true,before_after:before};
  report.status='PASS_SYNTHETIC_LOCAL_DB_MODEL_ONLY';report.measured_at=new Date().toISOString();
 }catch(error){report.status=stage==='local_docker'?'BLOCKED_LOCAL_DOCKER':'FAIL';report.failure={stage,code:error instanceof assert.AssertionError?'ASSERTION_FAILED':error.message};}
 finally{
  if(created){cleaning=true;try{report.cleanup=cleanupOwnedContainer(docker,inspect,name,nonce);}
   catch{report.cleanup={status:'FAIL',owned_container:name};report.status='FAIL';}}
 }
 return report;
}
function saveReport(report){
 try{mkdirSync(DELIVERY_ROOT,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 const s=lstatSync(DELIVERY_ROOT);assert(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o022)===0,'CONTROLLED_DELIVERY_ROOT');
 const path=join(DELIVERY_ROOT,'member-capacity-'+report.run_id+'.json');
 writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,mode:0o600});return path;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);assert(args.length===1&&['--run','--model'].includes(args[0]),'Use --model or --run; no remote URL/port/credential options');
 if(args[0]==='--model')console.log(JSON.stringify({synthetic:true,model:MODEL,production_capacity:'UNKNOWN',cost:'UNKNOWN'}));
 else{const report=await runCapacity();const path=saveReport(report);console.log(JSON.stringify({status:report.status,report:path,cleanup:report.cleanup,phases:report.phases,production_capacity:report.production_10000_member_capacity,cost:report.cost}));if(!report.status.startsWith('PASS_'))process.exitCode=1;}
}
