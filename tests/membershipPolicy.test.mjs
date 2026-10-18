import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolveEffectiveMemberAccess} from '../supabase/functions/_shared/member-entitlement.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
export const membershipMigration='supabase/migrations/20261013045054_membership_legacy_policy_candidate.sql';
test('candidate migration never activates a policy or rewrites existing canonical grants on installation',()=>{
 const sql=read(membershipMigration);
 assert.match(sql,/v_now := clock_timestamp\(\)/);
 assert.doesNotMatch(sql,/p_effective_at|update public\.member_entitlements|update public\.profiles|delete from/i);
 assert.match(sql,/where not coalesce\(u.is_anonymous,false\)/);
 assert.match(sql,/LEGACY_POLICY_REVIEW_REQUIRED/);
 assert.match(sql,/PAYMENT_PROVIDER_REVIEW_REQUIRED/);
 assert.match(sql,/pg_advisory_xact_lock_shared\(67230130\)/);
 assert.match(sql,/IMMUTABLE_MEMBERSHIP_POLICY/);
 assert.match(sql,/revoke all on all tables in schema membership_private from public, anon, authenticated, service_role/);
 assert.doesNotMatch(sql,/select public\.activate_membership_policy_candidate_v1/);
});
test('member endpoint retains exactly the same authenticated user derivation and existing resolver',()=>{
 const path='supabase/functions/member-access/index.ts';
 const base=execFileSync('git',['show','2a5d461ec3d98bfc8bc3177a295c95e299b7bda2:'+path],{encoding:'utf8'});
 const expected=base.replace('supabase-js@2"','supabase-js@2.115.0"').replace('rpc("ensure_member_entitlement_v1"','rpc("ensure_member_entitlement_v2"')
 .replace('  return jsonResponse({\n    success: true,','  const policyResult = await serviceClient.rpc("get_member_policy_receipt_v1", { p_user_id: userData.user.id });\n  if (policyResult.error) {\n    return jsonResponse({ success: false, error: "ACCESS_POLICY_UNAVAILABLE" }, 503);\n  }\n  const policy = asObject(policyResult.data);\n\n  return jsonResponse({\n    success: true,')
 .replace('    membership: access,','    membership: { ...access, legacyReviewRequired: policy.legacy_review_required === true },');
 assert.equal(read(path),expected);
});
test('unchanged Report caller reaches the same policy through its existing service-only RPC',()=>{
 const sql=read(membershipMigration);
 assert.match(read('supabase/functions/get-report-payload/index.ts'),/rpc\("ensure_member_entitlement_v1"/);
 assert.match(sql,/alter function public\.ensure_member_entitlement_v1\(uuid\) set schema membership_private/);
 assert.match(sql,/select public\.ensure_member_entitlement_v2\(p_user_id\)/);
 assert.match(sql,/return membership_private\.ensure_member_entitlement_pre_policy_v1\(p_user_id\)/);
 assert.match(sql,/revoke all on function public\.ensure_member_entitlement_v1\(uuid\) from public,anon,authenticated/);
 assert.match(sql,/revoke all on function membership_private\.ensure_member_entitlement_pre_policy_v1\(uuid\) from public,anon,authenticated,service_role/);
});
test('materializing an unknown-expiry legacy grant preserves access, not a verified payment claim',()=>{
 const before=resolveEffectiveMemberAccess({role:'member',subscription_status:'active',paid_until:null},null);
 const after=resolveEffectiveMemberAccess({role:'member'}, {state:'beta_full',tier:'member',source:'manual',access_ends_at:null});
 assert.equal(before.tier,after.tier);assert.equal(before.active,after.active);
 assert.equal(after.accessEndsAt,null);assert.notEqual(after.source,'payment_provider');
});
test('new Free has no automatic trial; canonical expiry and cancellation remain effective at read time',()=>{
 assert.equal(resolveEffectiveMemberAccess({role:'free',subscription_status:'inactive'},null).active,false);
 const now=Date.now(),future=new Date(now+60000).toISOString(),past=new Date(now-60000).toISOString();
 for(const [state,end,active] of [['beta_full',past,false],['paid_active',future,true],['canceled',future,true],['canceled',past,false],['past_due',future,false],['expired',future,false]]){
  assert.equal(resolveEffectiveMemberAccess({role:'free'},{state,tier:'member',access_ends_at:end},now).active,active);
 }
});
test('member copy does not promise automatic trial or a live checkout',()=>{
 assert.match(read('supabase/functions/member-access/index.ts'),/^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@2\.115\.0";/);
 const card=read('src/components/membership/MembershipStatusCard.tsx'),pricing=read('src/pages/pricing/Pricing.tsx');
 assert.match(card,/原有權益不變/);assert.match(card,/legacyReviewRequired/);assert.match(card,/SIGNED_OUT/);
 assert.doesNotMatch(pricing,/正式啟用後，才開始計算完整 14 天試用|前 14 天完整試用。/);
 assert.equal(pricing,execFileSync('git',['show','9da487db73055eb983379ca2879822ebeb8f8906:src/pages/pricing/Pricing.tsx'],{encoding:'utf8'}));
 assert.match(pricing,/目前尚未啟用付款/);assert.match(pricing,/NT\$199/);
});
test('isolated Preview uses the runtime loopback endpoints, never a stale hardcoded Auth or REST port',()=>{
 const preview=read('scripts/vnext/membership-preview.mjs');
 assert.match(preview,/import \{startAuthEnvironment,localAuthBase,localRestBase\} from '\.\.\/academy-v11\/auth-environment\.mjs'/);
 assert.match(preview,/fetch\(localAuthBase\+'\/user'/);
 assert.match(preview,/'\/auth\/v1':\{target:localAuthBase/);
 assert.match(preview,/'\/rest\/v1':\{target:localRestBase/);
 assert.doesNotMatch(preview,/55632|55633|https:\/\//);
 const script="const m=await import('./scripts/academy-v11/local-auth-endpoints.mjs');console.log(JSON.stringify([m.localAuthBase,m.localRestBase]));";
 const run=(auth,rest)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('../',import.meta.url),env:{...process.env,MA_ISOLATED_AUTH_PORT:auth,MA_ISOLATED_REST_PORT:rest},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.deepEqual(run('56832','56833'),['http://127.0.0.1:56832','http://127.0.0.1:56833']);
 for(const [auth,rest] of [['56832','56832'],['0','56833'],['https://example.com','56833']])assert.throws(()=>run(auth,rest));
});
test('fresh isolated Auth may explicitly use bounded disposable tmpfs without pruning other data',()=>{
 const environment=read('scripts/academy-v11/auth-environment.mjs');
 assert.match(environment,/MA_ISOLATED_DB_TMPFS==='1'\?\['--tmpfs','\/var\/lib\/postgresql\/data:rw,size=268435456'\]:\[\]/);
 assert.match(environment,/ISOLATED_DB_TMPFS_INVALID/);
 assert.doesNotMatch(environment,/docker (?:system|volume) prune|Production.*(?:password|token)=/);
});
