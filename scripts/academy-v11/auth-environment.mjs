// Real Supabase Auth + PostgREST in a disposable, loopback-only environment.
// No Production URL, credential, member, email delivery or role-selector endpoint.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {contentSql,loadReviewedCourse} from './load-content.mjs';
import {syntheticLessons} from '../../tests/fixtures/academy-v11-lessons.mjs';

export const localAuthBase='http://127.0.0.1:55632';
export const localRestBase='http://127.0.0.1:55633';
// Public disposable-test password, never a Production credential.
export const localTestPassword='Academy-local-only-2026!';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const run=(args,options={})=>{
 try{return execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8e6,...options}).trim();}
 catch(error){const detail=String(error.stderr||'').split('\n').filter(line=>/^(ERROR|FATAL|HINT):/.test(line)).join(' ').replace(/[a-f0-9]{32,}/g,'[redacted]');throw Error('LOCAL_ACADEMY_DOCKER_OPERATION_FAILED: '+args[0]+' '+detail);}
};
export async function startAuthEnvironment(){
 const name='ma-academy-auth-'+process.pid,db=name+'-db',auth=name+'-auth',rest=name+'-rest';
 const secret=randomBytes(48).toString('hex'),password=randomBytes(24).toString('hex');
 const env={...process.env,POSTGRES_PASSWORD:password,GOTRUE_DB_DATABASE_URL:`postgres://postgres:${password}@${db}:5432/postgres?search_path=auth`,GOTRUE_JWT_SECRET:secret,PGRST_DB_URI:`postgres://authenticator:${password}@${db}:5432/postgres`,PGRST_JWT_SECRET:secret};
 const cleanup=()=>{for(const id of [rest,auth,db]){try{run(['rm','-f','-v',id]);}catch{/* only our disposable containers */}}try{run(['network','rm',name]);}catch{/* already gone */}};
 const sql=s=>run(['exec','-i',db,'psql','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],{input:s});
 const jwt=claims=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify(claims)).toString('base64url');return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');};
 const anon=jwt({role:'anon',iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400});
 try{
  run(['network','create',name]);
  run(['run','-d','--name',db,'--network',name,'-e','POSTGRES_PASSWORD','postgres:17'],{env});
  let ready=false;for(let i=0;i<40;i++){try{sql('select 1');ready=true;break;}catch{await delay(500);}}assert.ok(ready,'LOCAL_DB_READY');
  sql(`create schema auth;create extension if not exists pgcrypto;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role authenticator login password '${password}' noinherit;grant anon,authenticated to authenticator;grant usage on schema public,auth to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;`);
  run(['run','-d','--name',auth,'--network',name,'-p','127.0.0.1:55632:9999','-e','GOTRUE_DB_DATABASE_URL','-e','GOTRUE_JWT_SECRET','-e','GOTRUE_DB_DRIVER=postgres','-e','GOTRUE_API_HOST=0.0.0.0','-e','PORT=9999','-e','GOTRUE_API_PORT=9999','-e','API_EXTERNAL_URL='+localAuthBase,'-e','GOTRUE_SITE_URL=http://127.0.0.1:3219','-e','GOTRUE_JWT_AUD=authenticated','-e','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated','-e','GOTRUE_JWT_ADMIN_ROLES=service_role','-e','GOTRUE_JWT_EXP=3600','-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=true','-e','GOTRUE_MAILER_AUTOCONFIRM=true','-e','GOTRUE_LOG_LEVEL=error','public.ecr.aws/supabase/gotrue:v2.194.0'],{env});
  console.log('LOCAL_AUTH_CONTAINER='+auth);
  ready=false;for(let i=0;i<240;i++){try{if((await fetch(localAuthBase+'/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}await delay(500);}
  if(!ready){const log=run(['logs','--tail','8',auth]).replaceAll(password,'[redacted]').replaceAll(secret,'[redacted]');throw Error('LOCAL_AUTH_READY: '+log);}
  sql(`create table public.profiles(id uuid primary key references auth.users(id),role text,subscription_status text,membership_tier text,paid_until timestamptz);
  create table public.member_entitlements(user_id uuid primary key references auth.users(id),state text,tier text,source text,access_started_at timestamptz,access_ends_at timestamptz,trial_started_at timestamptz,trial_ends_at timestamptz,current_period_end timestamptz,cancel_at_period_end boolean);
  revoke all on public.profiles,public.member_entitlements from public,anon,authenticated;
  create schema research_private;create table research_private.owner_access(principal_id uuid primary key,enabled boolean);revoke all on schema research_private from public,anon,authenticated;`);
  const owner=read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql');
  sql(owner.slice(owner.indexOf('create function public.is_research_owner_v1()'),owner.indexOf('create table public.research_feature_versions')));
  sql(read('supabase/migrations/20261009053655_academy_member_learning_v11.sql'));
  sql(contentSql(process.env.MA_ACADEMY_COURSE?loadReviewedCourse(process.env.MA_ACADEMY_COURSE):syntheticLessons,process.env.MA_ACADEMY_PDF_DIR));
  const accounts={};
  for(const role of ['free','premium','owner','other']){
   const email=role+'@academy.test';
   const response=await fetch(localAuthBase+'/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:localTestPassword})});
   if(response.status!==200){const logs=spawnSync('docker',['logs','--tail','4',auth],{encoding:'utf8'});throw Error('LOCAL_AUTH_SIGNUP_'+role+' '+response.status+' '+(logs.stdout+logs.stderr).replaceAll(password,'[redacted]').replaceAll(secret,'[redacted]'));}
   const body=await response.json(),id=body.user?.id||body.id;
   assert.match(id,/^[0-9a-f-]{36}$/);accounts[role]={email,id};
   sql(`insert into public.profiles(id,role) values('${id}','${role==='owner'?'admin':'free'}');`);
   if(role==='owner')sql(`insert into research_private.owner_access values('${id}',true)`);
   if(role==='premium')sql(`insert into public.member_entitlements(user_id,state,tier,source) values('${id}','paid_active','member','manual')`);
  }
  run(['run','-d','--name',rest,'--network',name,'-p','127.0.0.1:55633:3000','-e','PGRST_DB_URI','-e','PGRST_JWT_SECRET','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_JWT_AUD=authenticated','-e','PGRST_LOG_LEVEL=crit','postgrest/postgrest:v14.13'],{env});
  ready=false;for(let i=0;i<40;i++){try{if((await fetch(localRestBase+'/')).ok){ready=true;break;}}catch{}await delay(500);}assert.ok(ready,'LOCAL_REST_READY');
  return {accounts,anon,cleanup,sql};
 }catch(error){cleanup();throw error;}
}

export async function verifyAuthEnvironment(runtime){
 const checks=[];
 const login=async role=>{const r=await fetch(localAuthBase+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:runtime.accounts[role].email,password:localTestPassword})});assert.equal(r.status,200,role+' password login');return r.json();};
 const rpc=async(token,name,body={})=>{const r=await fetch(localRestBase+'/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const sessions={};
 for(const [role,count] of [['free',7],['premium',10],['owner',10],['other',7]]){
  sessions[role]=await login(role);
  const user=await fetch(localAuthBase+'/user',{headers:{Authorization:'Bearer '+sessions[role].access_token}});assert.equal(user.status,200);
  const c=await rpc(sessions[role].access_token,'get_academy_catalog_v11');assert.equal(c.status,200);assert.equal(c.body.tier,role==='other'?'free':role);assert.equal(c.body.chapters.filter(x=>x.allowed).length,count);checks.push(role+' real password login + server catalog');
 }
 const free=sessions.free.access_token,other=sessions.other.access_token;
 for(const [name,params] of [['get_academy_lesson_v11',{p_chapter_id:'trend-advanced'}],['get_academy_pdf_v11',{p_edition:'premium'}]])assert.equal((await rpc(free,name,params)).status,403);
 assert.equal((await rpc(null,'get_academy_catalog_v11')).status,401);checks.push('anonymous / Free premium lesson and PDF DENY');
 const forged=await fetch(localAuthBase+'/user',{method:'PUT',headers:{Authorization:'Bearer '+free,'Content-Type':'application/json'},body:JSON.stringify({data:{tier:'premium',owner:true}})});assert.equal(forged.status,200);
 assert.equal((await rpc(free,'get_academy_catalog_v11')).body.tier,'free');checks.push('user_metadata cannot elevate entitlement');
 const tampered=free.split('.');tampered[1]=Buffer.from(JSON.stringify({sub:runtime.accounts.owner.id,role:'authenticated',exp:4102444800})).toString('base64url');assert.equal((await rpc(tampered.join('.'),'get_academy_catalog_v11')).status,401);checks.push('forged JWT rejected by PostgREST');
 const chapter=await rpc(free,'get_academy_lesson_v11',{p_chapter_id:'candles'});assert.equal(chapter.status,200);
 const lesson=chapter.body;
 for(const [i,q] of lesson.questions.entries())assert.equal((await rpc(free,'record_academy_progress_v11',{p_chapter_id:lesson.id,p_question_id:q.id,p_choice_index:q.correctIndex,p_position:i+1,p_complete:false})).status,200);
 assert.equal((await rpc(free,'record_academy_progress_v11',{p_chapter_id:lesson.id,p_complete:true})).status,200);
 assert.equal((await rpc(other,'get_academy_catalog_v11')).body.progress.length,0);
 const cross=await fetch(localRestBase+'/academy_progress_v11?user_id=eq.'+runtime.accounts.free.id,{headers:{Authorization:'Bearer '+other}});assert.equal(cross.status,200);assert.deepEqual(await cross.json(),[]);checks.push('A/B row-level isolation');
 const logout=await fetch(localAuthBase+'/logout',{method:'POST',headers:{Authorization:'Bearer '+free}});assert.equal(logout.status,204);
 const refresh=await fetch(localAuthBase+'/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:sessions.free.refresh_token})});assert.equal(refresh.status,400);
 const again=await login('free'),saved=(await rpc(again.access_token,'get_academy_catalog_v11')).body.progress;assert.equal(saved.find(x=>x.chapter_id==='candles')?.completed,true);checks.push('real logout / revoked refresh / re-login persistence');
 return {checks,auth:'REAL_SUPABASE_AUTH_LOCAL_TEST_ACCOUNTS',production_identity:false,production_changed:false};
}

if(process.argv[1]===new URL(import.meta.url).pathname){
 let runtime;try{runtime=await startAuthEnvironment();console.log(JSON.stringify(await verifyAuthEnvironment(runtime)));}catch(error){console.error(error instanceof assert.AssertionError?error.message:String(error));process.exitCode=1;}finally{runtime?.cleanup();}
}
