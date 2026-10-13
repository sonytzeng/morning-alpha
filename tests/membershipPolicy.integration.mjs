// Real disposable GoTrue + PostgREST + PostgreSQL. Never connects to Production.
// Billing rows below are synthetic SQL controls, NOT a Payment Provider sandbox.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {startAuthEnvironment,localAuthBase,localRestBase,localTestPassword} from '../scripts/academy-v11/auth-environment.mjs';
import {resolveEffectiveMemberAccess} from '../supabase/functions/_shared/member-entitlement.ts';
import {installCandidate} from '../scripts/vnext/isolation.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
export const migration='supabase/migrations/20261013045054_membership_legacy_policy_candidate.sql';
export async function installMembershipCandidate(runtime){
 // Replace only the disposable Academy fixture's skeletal entitlement table
 // with the real baseline schema and constraints. Academy implementation stays.
 runtime.sql(`alter table public.profiles add column email text, add column updated_at timestamptz default now();drop table public.member_entitlements;`);
 runtime.sql(read('supabase/migrations/20260822183421_member_access_trial_state_machine.sql'));
 runtime.sql(`insert into public.member_entitlements(user_id,state,tier,source,access_ends_at) values('${runtime.accounts.premium.id}','paid_active','member','manual',now()+interval '2 days');`);
 const before=runtime.sql("select jsonb_build_object('config',(select to_jsonb(c) from public.membership_access_config c),'entitlements',(select jsonb_agg(e order by user_id) from public.member_entitlements e))::text");
 const originalActivationBody=runtime.sql("select prosrc from pg_proc where oid='public.ensure_member_entitlement_v1(uuid)'::regprocedure");
 runtime.sql(read(migration));
 assert.equal(runtime.sql("select prosrc from pg_proc where oid='membership_private.ensure_member_entitlement_pre_policy_v1(uuid)'::regprocedure"),originalActivationBody,'legacy implementation preserved exactly, only private location changed');
 // Match the read-only Production profile RLS shape verified on 2026-10-13:
 // table privileges exist, but there is no INSERT/UPDATE policy.
 runtime.sql(`alter table public.profiles enable row level security;grant select,insert,update on public.profiles to anon,authenticated;
 create policy "Users can read own profile" on public.profiles for select using ((select auth.uid())=id);`);
 assert.equal(runtime.sql("select jsonb_build_object('config',(select to_jsonb(c) from public.membership_access_config c),'entitlements',(select jsonb_agg(e order by user_id) from public.member_entitlements e))::text"),before,'installation does not change existing access/config');
 runtime.sql("notify pgrst,'reload schema'");
}
export async function verifyMembershipPolicy(runtime){
 const checks=[],accounts={...runtime.accounts},sessions={};
 const signup=async name=>{const r=await fetch(localAuthBase+'/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@academy.test',password:localTestPassword})});assert.equal(r.status,200);const b=await r.json(),id=b.user?.id||b.id;assert.match(id,/^[a-f0-9-]{36}$/);accounts[name]={id,email:name+'@academy.test'};runtime.sql(`insert into public.profiles(id,role,subscription_status) values('${id}','free','inactive')`);return id;};
 const login=async name=>{const r=await fetch(localAuthBase+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accounts[name].email,password:localTestPassword})});assert.equal(r.status,200);sessions[name]=await r.json();return sessions[name];};
 const rpc=async(name,fn,body={})=>{const r=await fetch(localRestBase+'/rpc/'+fn,{method:'POST',headers:{'Content-Type':'application/json',...(name?{Authorization:'Bearer '+sessions[name].access_token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const concurrent=sql=>new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',`ma-academy-auth-${process.pid}-db`,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code?reject(Error(err.slice(0,800))):resolve(out.trim()));p.stdin.end(sql);});
 runtime.sql(`update public.profiles set subscription_status='active',membership_tier='member' where id='${accounts.other.id}';`);
 for(const [name,state,extra] of [
  ['beta','beta_full',"null,null,null,'{}'::jsonb"],
  ['finite','beta_full',"now()+interval '1 day',null,null,'{}'::jsonb"],
  ['permanent','beta_full',"null,null,null,'{\"permanent\":true}'::jsonb"],
  ['trial','trialing',"now()+interval '1 day',now(),now()+interval '1 day','{}'::jsonb"],
  ['cancelled','canceled',"now()+interval '1 day',null,null,'{}'::jsonb"],
  ['expired','expired',"now()-interval '1 day',null,null,'{}'::jsonb"]]){
  const id=await signup(name);runtime.sql(`insert into public.member_entitlements(user_id,state,tier,source,access_ends_at,trial_started_at,trial_ends_at,metadata) values('${id}','${state}','member','manual',${extra})`);
 }
 const original=runtime.sql('select jsonb_agg(e order by user_id)::text from public.member_entitlements e');
 for(const fn of ['ensure_member_entitlement_v1','ensure_member_entitlement_v2'])runtime.sql(`begin;select public.${fn}('${accounts.free.id}');do $$begin if not exists(select 1 from public.member_entitlements where user_id='${accounts.free.id}' and state='beta_full') then raise exception 'PRE_ACTIVATION_DRIFT';end if;end$$;rollback;`);
 assert.equal(runtime.sql('select count(*) from membership_private.policy_versions'),'0');
 for(const role of ['free','premium','owner','other'])await login(role);
 for(const role of [null,'free','premium','owner'])for(const [fn,body] of [
  ['activate_membership_policy_candidate_v1',{p_approval_reference:'NOT_AUTHORIZED'}],
  ['ensure_member_entitlement_v2',{p_user_id:accounts.other.id}],
  ['ensure_member_entitlement_v1',{p_user_id:accounts.other.id}],
  ['get_member_policy_receipt_v1',{p_user_id:accounts.other.id}],
  ['apply_membership_billing_event_v1',{p_provider:'TEST',p_provider_event_id:'TEST',p_event_type:'TEST',p_user_id:accounts.free.id,p_subscription_status:'active',p_tier:'member',p_current_period_end:new Date(Date.now()+60000).toISOString()}]]){
   assert.ok([401,403].includes((await rpc(role,fn,body)).status),role+' cannot mutate entitlement / inspect private policy');
 }
 assert.throws(()=>runtime.sql("select public.activate_membership_policy_candidate_v1(null)"));
 assert.throws(()=>runtime.sql("begin;update public.membership_access_config set billing_mode='provider';select public.activate_membership_policy_candidate_v1('ISOLATED_TEST_ONLY');rollback;"));
 const activations=await Promise.all(Array.from({length:8},()=>concurrent("set role service_role;select public.activate_membership_policy_candidate_v1('ISOLATED_TEST_ONLY')")));
 assert.equal(activations.map(JSON.parse).filter(x=>!x.replayed).length,1);
 const cutoff=JSON.parse(activations[0]).effective_at;
 assert.equal(new Set(activations.map(x=>JSON.parse(x).effective_at)).size,1);
 assert.equal(runtime.sql(`select jsonb_agg(e order by user_id)::text from public.member_entitlements e where user_id not in('${accounts.owner.id}','${accounts.other.id}')`),original);
 assert.equal(runtime.sql("select signup_mode||':'||billing_mode from public.membership_access_config"),'free:disabled');
 assert.equal(runtime.sql(`select review_status from membership_private.legacy_snapshots where user_id='${accounts.other.id}'`),'LEGACY_POLICY_REVIEW_REQUIRED');
 assert.equal(runtime.sql(`select review_status from membership_private.legacy_snapshots where user_id='${accounts.permanent.id}'`),'EXPLICIT_PERMANENT');
 assert.equal(runtime.sql(`select count(*) from public.member_entitlements where user_id='${accounts.free.id}'`),'0','account age alone is not Premium');
 checks.push('fresh real schema; installation inert; 8 concurrent activations = 1 immutable cutoff; canonical bytes unchanged; profile grant preserved with unknown expiry');
 for(const table of ['policy_versions','legacy_snapshots']){
  assert.throws(()=>runtime.sql(`update membership_private.${table} set ${table==='policy_versions'?'version=version':'basis=basis'}`));
  assert.throws(()=>runtime.sql(`delete from membership_private.${table}`));
  for(const role of ['anon','authenticated','service_role'])assert.throws(()=>runtime.sql(`begin;set role ${role};select * from membership_private.${table};rollback;`));
 }
 assert.throws(()=>runtime.sql("select public.activate_membership_policy_candidate_v1('DIFFERENT_APPROVAL')"));
 const stable=runtime.sql('select jsonb_agg(e order by user_id)::text from public.member_entitlements e');
 await Promise.all(Array.from({length:8},()=>concurrent(`set role service_role;select public.ensure_member_entitlement_v2('${accounts.beta.id}')`)));
 runtime.sql(`begin;update public.membership_access_config set signup_mode='trialing';select public.ensure_member_entitlement_v2('${accounts.beta.id}');rollback;`);
 assert.equal(runtime.sql('select jsonb_agg(e order by user_id)::text from public.member_entitlements e'),stable);
 await Promise.all(Array.from({length:8},()=>concurrent(`set role service_role;select public.ensure_member_entitlement_v1('${accounts.beta.id}');select public.ensure_member_entitlement_v1('${accounts.owner.id}')`)));
 assert.equal(runtime.sql('select jsonb_agg(e order by user_id)::text from public.member_entitlements e'),stable,'unchanged Report caller also preserves all versions and dates');
 for(const who of ['other','owner','finite']){
  assert.throws(()=>runtime.sql(`select public.apply_membership_billing_event_v1('ISOLATED_SQL_CONTROL','unsafe-${who}','payment_failed','${accounts[who].id}','past_due','member',now())`));
 }
 assert.equal(runtime.sql('select jsonb_agg(e order by user_id)::text from public.member_entitlements e'),stable);
 assert.equal(runtime.sql("select count(*) from public.billing_webhook_events where provider_event_id like 'unsafe-%'"),'0','failed callback transaction leaves no partial event');
 checks.push('billing update cannot shorten active legacy term, erase unknown-expiry grant or replace Owner; failed transaction rolls back entirely');
 const newId=await signup('newfree');await login('newfree');
 assert.equal(runtime.sql(`select public.ensure_member_entitlement_v2('${newId}') is null`),'t');
 assert.equal(runtime.sql(`set role service_role;select public.ensure_member_entitlement_v1('${newId}') is null`),'t','existing Report caller cannot auto-grant Beta');
 assert.equal(runtime.sql(`select count(*) from public.member_entitlements where user_id='${newId}'`),'0');
 assert.throws(()=>runtime.sql(`begin;set role service_role;select membership_private.ensure_member_entitlement_pre_policy_v1('${newId}');rollback;`));
 assert.equal(runtime.sql(`select created_at > '${cutoff}' from auth.users where id='${newId}'`),'t');
 for(const [name,tier] of [['owner','owner'],['free','free'],['other','premium'],['newfree','free'],['premium','premium'],['beta','premium'],['finite','premium'],['trial','premium'],['cancelled','premium'],['expired','free']]){
  await login(name);const c=await rpc(name,'get_academy_catalog_v11');assert.equal(c.status,200);assert.equal(c.body.tier,tier,name);assert.equal(c.body.chapters.filter(x=>x.allowed).length,tier==='free'?7:10);
 }
 await fetch(localAuthBase+'/user',{method:'PUT',headers:{Authorization:'Bearer '+sessions.newfree.access_token,'Content-Type':'application/json'},body:JSON.stringify({data:{tier:'premium',role:'admin'}})});
 assert.equal((await rpc('newfree','get_academy_catalog_v11')).body.tier,'free');
 const patch=await fetch(localRestBase+'/profiles?id=eq.'+newId,{method:'PATCH',headers:{Authorization:'Bearer '+sessions.newfree.access_token,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({role:'admin',subscription_status:'active'})});
 assert.equal(patch.status,200);assert.deepEqual(await patch.json(),[]);
 assert.equal(runtime.sql(`select role||':'||subscription_status from public.profiles where id='${newId}'`),'free:inactive');
 const otherProfile=await fetch(localRestBase+'/profiles?id=eq.'+accounts.other.id,{headers:{Authorization:'Bearer '+sessions.newfree.access_token}});
 assert.deepEqual(await otherProfile.json(),[]);
 assert.equal((await rpc('newfree','get_academy_lesson_v11',{p_chapter_id:'trend-advanced'})).status,403);
 installCandidate(runtime);
 runtime.sql(read('supabase/migrations/20261012080628_vnext_member_publication_control_candidate.sql'));
 runtime.sql("notify pgrst,'reload schema'");
 for(let n=0;n<20;n++){if((await rpc('free','get_vnext_member_v1')).status!==404)break;await new Promise(r=>setTimeout(r,100));}
 for(const [name,tier] of [['owner','owner'],['newfree','free'],['other','premium'],['premium','premium']]){
  const result=await rpc(name,'get_vnext_member_v1');assert.equal(result.status,200);assert.equal(result.body.tier,tier);
  assert.equal(result.body.observations.length,0,'payment/access cannot publish unreviewed research');
 }
 assert.equal((await rpc(null,'get_vnext_member_v1')).status,401);
 assert.equal((await rpc('newfree','get_vnext_member_v1',{tier:'premium'})).status,404);
 checks.push('real Auth new Free 7 chapters, legacy/Premium 10, Owner unchanged, metadata spoof denied, no login-time beta/trial/version drift; VNext server tiers aligned; unreviewed research invisible');
 // Existing provider-neutral SQL contract only. No real payment, no signed
 // callback, no refund policy is invented in the absence of a known provider.
 for(const [status,expected] of [['active','premium'],['canceled','premium'],['past_due','free'],['expired','free']]){
  const sql=`select public.apply_membership_billing_event_v1('ISOLATED_SQL_CONTROL','event-${status}','subscription','${newId}','${status}','member',now()+interval '1 day','customer-test','subscription-test',false,'{}')`;
  runtime.sql(sql);runtime.sql(sql);assert.equal((await rpc('newfree','get_academy_catalog_v11')).body.tier,expected);
  assert.equal(runtime.sql(`select count(*) from public.billing_webhook_events where provider_event_id='event-${status}'`),'1');
 }
 assert.throws(()=>runtime.sql(`select public.apply_membership_billing_event_v1('ISOLATED_SQL_CONTROL','refund','refund','${newId}','refunded','member',now())`));
 assert.equal((await rpc('other','get_academy_catalog_v11')).body.tier,'premium','no cross-account overwrite');
 const legacy=JSON.parse(runtime.sql(`select to_jsonb(e)::text from public.member_entitlements e where user_id='${accounts.other.id}'`));
 assert.equal(resolveEffectiveMemberAccess({role:'member'},legacy).active,true);
 await login('other');assert.equal((await rpc('other','get_academy_catalog_v11')).body.tier,'premium');
 const l=await fetch(localAuthBase+'/logout',{method:'POST',headers:{Authorization:'Bearer '+sessions.other.access_token}});assert.equal(l.status,204);
 const refresh=await fetch(localAuthBase+'/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:sessions.other.refresh_token})});assert.equal(refresh.status,400);
 assert.equal((await rpc(null,'get_academy_catalog_v11')).status,401);
 await login('other');assert.equal((await rpc('other','get_academy_catalog_v11')).body.tier,'premium');
 checks.push('existing SQL active/cancelled/expired/past_due and duplicate-event controls; refund unsupported explicitly; logout/relogin rights stable');
 return {checks,accounts,identity:'REAL_SUPABASE_AUTH_ISOLATED_ONLY',payment_provider_e2e:'PENDING_PROVIDER_NOT_IDENTIFIED',production_changed:false};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const runtime=await startAuthEnvironment();try{
  await installMembershipCandidate(runtime);const result=await verifyMembershipPolicy(runtime);delete result.accounts;console.log(JSON.stringify(result));
 }finally{runtime.cleanup();}
}
