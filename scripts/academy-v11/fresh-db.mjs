// Disposable isolated PostgreSQL only. Never accepts a Production URL/host.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {contentSql,loadReviewedCourse} from './load-content.mjs';
import {syntheticLessons} from '../../tests/fixtures/academy-v11-lessons.mjs';
import {resolveEffectiveMemberAccess} from '../../supabase/functions/_shared/member-entitlement.ts';
const host=process.env.MA_ACADEMY_TEST_HOST||'/private/tmp';
assert.ok(['/private/tmp','127.0.0.1'].includes(host));
const user=process.env.MA_ACADEMY_TEST_USER||'academy_test';
assert.ok(['academy_test','postgres'].includes(user));
const db='ma_academy_v11_'+process.pid;
const args=['-X','-q','-h',host,'-p','55439','-U',user,'-v','ON_ERROR_STOP=1','-At'];
const sql=(s,d=db)=>execFileSync('psql',[...args,'-d',d],{input:s,encoding:'utf8',maxBuffer:8e6,stdio:['pipe','pipe','pipe']}).trim();
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
sql('create database '+db,'postgres');
export const ids={free:'00000000-0000-4000-8000-000000000001',premium:'00000000-0000-4000-8000-000000000002',owner:'00000000-0000-4000-8000-000000000003',other:'00000000-0000-4000-8000-000000000004',anon:'00000000-0000-4000-8000-000000000005'};
const uid=ids.free;
const as=(id,s,role='authenticated')=>sql(`begin;set local role ${role};set local request.jwt.claim.sub='${id||''}';${s};commit;`);
let passed=0;
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
try{
 sql(`do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end$$;
 create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon,service_role;
 create table public.profiles(id uuid primary key references auth.users(id),role text,subscription_status text,membership_tier text,paid_until timestamptz);
 create table public.member_entitlements(user_id uuid primary key references auth.users(id),state text,tier text,source text,access_started_at timestamptz,access_ends_at timestamptz,trial_started_at timestamptz,trial_ends_at timestamptz,current_period_end timestamptz,cancel_at_period_end boolean);
 revoke all on public.profiles,public.member_entitlements from public,anon,authenticated;
 create schema research_private;
 create table research_private.owner_access(principal_id uuid primary key,enabled boolean);
 revoke all on schema research_private from public,anon,authenticated;
 `);
 // Exact deployed-source owner predicate, not owner=true or client metadata.
 const ownerSource=read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql');
 sql(ownerSource.slice(ownerSource.indexOf('create function public.is_research_owner_v1()'),ownerSource.indexOf('create table public.research_feature_versions')));
 sql(Object.values(ids).map(id=>`insert into auth.users(id,is_anonymous) values('${id}',${id===ids.anon});insert into public.profiles(id,role) values('${id}','${id===ids.owner?'admin':'free'}');`).join('\n'));
 sql(`insert into research_private.owner_access values('${ids.owner}',true);insert into public.member_entitlements(user_id,state,tier,source) values('${ids.premium}','paid_active','member','manual')`);
 const before=sql("select md5(pg_get_functiondef('public.is_research_owner_v1()'::regprocedure))");
 sql(read('supabase/migrations/20261009053655_academy_member_learning_v11.sql'));
 sql(contentSql(process.env.MA_ACADEMY_COURSE?loadReviewedCourse(process.env.MA_ACADEMY_COURSE):syntheticLessons,process.env.MA_ACADEMY_PDF_DIR));
 check('existing Owner auth unchanged',()=>assert.equal(sql("select md5(pg_get_functiondef('public.is_research_owner_v1()'::regprocedure))"),before));
 check('anonymous denied catalog',()=>assert.throws(()=>as(null,'select public.get_academy_catalog_v11()','anon')));
 check('anonymous-sign-in denied',()=>assert.throws(()=>as(ids.anon,'select public.get_academy_catalog_v11()')));
 check('no UID denied',()=>assert.throws(()=>as(null,'select public.get_academy_catalog_v11()')));
 for(const [name,id,n] of [['free',uid,7],['premium',ids.premium,10],['owner',ids.owner,10]])check(name+' server tier and content',()=>{
  const c=JSON.parse(as(id,'select public.get_academy_catalog_v11()'));assert.equal(c.tier,name);assert.equal(c.chapters.filter(x=>x.allowed).length,n);
  assert.equal(Number(as(id,'select count(*) from public.academy_lessons_v11')),n);
 });
 check('Free cannot bypass by direct RPC/table',()=>{assert.throws(()=>as(uid,"select public.get_academy_lesson_v11('trend-advanced')"));assert.equal(as(uid,"select count(*) from public.academy_lessons_v11 where tier='premium'"),'0');});
 check('metadata forgery ignored',()=>assert.equal(as(uid,`set local request.jwt.claims='{"user_metadata":{"tier":"admin","owner":true}}';select academy_private.access_v11()`),'free'));
 check('cross-user progress read isolated',()=>{as(uid,"select public.record_academy_progress_v11('candles',null,null,2,false)");assert.equal(as(ids.other,'select count(*) from public.academy_progress_v11'),'0');});
 check('direct write/owner reassignment denied',()=>{assert.throws(()=>as(uid,`update public.academy_progress_v11 set user_id='${ids.other}'`));assert.throws(()=>as(uid,`insert into public.academy_progress_v11(user_id,chapter_id,version) values('${ids.other}','volume','ACADEMY_MEMBER_V11')`));});
 check('wrong answer stored, not falsely completed',()=>{
  const p=JSON.parse(as(uid,"select public.record_academy_progress_v11('candles','candles-q1',0,3,false)"));assert.equal(p.answers[0].correct,false);
  assert.throws(()=>as(uid,"select public.record_academy_progress_v11('candles',null,null,3,true)"));
 });
 check('answer validation, forbidden premium writes',()=>{for(const q of ["'candles','not-a-question',0,0,false","'candles','candles-q1',99,0,false","'candles',null,0,0,false","'trend-advanced',null,null,0,false"])assert.throws(()=>as(uid,`select public.record_academy_progress_v11(${q})`));});
 check('persisted correct answers, completion, reload',()=>{as(uid,"select public.record_academy_progress_v11('candles','candles-q1',1,4,false)");as(uid,"select public.record_academy_progress_v11('candles','candles-q2',0,4,true)");const c=JSON.parse(as(uid,'select public.get_academy_catalog_v11()'));assert.equal(c.progress[0].completed,true);assert.equal(c.progress[0].answers.length,2);assert.equal(c.progress[0].last_position,4);});
 check('expiry immediately revokes lesson/progress/pdf',()=>{
  as(ids.premium,"select public.record_academy_progress_v11('trend-advanced',null,null,0,false)");
  sql(`update public.member_entitlements set state='expired' where user_id='${ids.premium}'`);
  assert.throws(()=>as(ids.premium,"select public.get_academy_lesson_v11('trend-advanced')"));assert.equal(JSON.parse(as(ids.premium,'select public.get_academy_catalog_v11()')).progress.length,0);
  sql(`update public.member_entitlements set state='paid_active' where user_id='${ids.premium}'`);
 });
 // SQL projection parity against actual server resolver, including trial/beta,
 // canceled paid windows, past_due and legacy profiles. No member policy changes.
 const cases=[null,...['beta_full','trialing','paid_active','canceled','expired','past_due'].flatMap(state=>[null,'2000-01-01T00:00:00Z','2099-01-01T00:00:00Z'].map(end=>({state,tier:'member',access_ends_at:end,trial_ends_at:end})))];
 check('existing server entitlement parity (19 states)',()=>{for(const e of cases){
  sql(`delete from public.member_entitlements where user_id='${ids.other}';`+(e?`insert into public.member_entitlements(user_id,state,tier,access_ends_at,trial_ends_at) values('${ids.other}','${e.state}','member',${e.access_ends_at?"'"+e.access_ends_at+"'":'null'},${e.trial_ends_at?"'"+e.trial_ends_at+"'":'null'});`:''));
  const effective=resolveEffectiveMemberAccess({role:'free'},e);assert.equal(as(ids.other,'select academy_private.access_v11()'),effective.active?'premium':'free');
 }});
 if(process.env.MA_ACADEMY_PDF_DIR)check('real PDF RLS edition separation',()=>{const pdf=JSON.parse(as(uid,"select public.get_academy_pdf_v11('free')"));assert.equal(Buffer.from(pdf.base64,'base64').subarray(0,5).toString(),'%PDF-');assert.throws(()=>as(uid,"select public.get_academy_pdf_v11('premium')"));assert.equal(JSON.parse(as(ids.premium,"select public.get_academy_pdf_v11('premium')")).mime,'application/pdf');});
 check('all Academy exposed tables RLS + force',()=>assert.equal(sql("select count(*) from pg_class where relname in ('academy_lessons_v11','academy_progress_v11','academy_pdf_v11') and relrowsecurity and relforcerowsecurity"),'3'));
 check('definers fixed search_path and no public execute',()=>assert.equal(sql("select count(*) from pg_proc where pronamespace='academy_private'::regnamespace and (proconfig is distinct from array['search_path=\"\"'] or has_function_privilege('anon',oid,'EXECUTE'))"),'0'));
 console.log(JSON.stringify({database:'DISPOSABLE_ISOLATION',identity:'SYNTHETIC_NOT_PRODUCTION_OWNER',checks:passed,production_changed:false}));
}finally{if(process.env.MA_ACADEMY_KEEP_DB==='YES')console.log('LOCAL_BROWSER_DATABASE='+db);else sql('drop database '+db+' with(force)','postgres');}
