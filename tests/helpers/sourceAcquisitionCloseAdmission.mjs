// Outer source-only admission. All previous receipts/assertions stay immutable.
// This seal never authorizes Provider calls, a deployment or methodology changes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {verifyIntegrationCandidate,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash} from './integrationAdmission.mjs';
export const SOURCE_ACQUISITION_BASE='6b7017fcbb9fa2fd085f9658eca4d6ce382c32a3';
export const SOURCE_ACQUISITION_MANIFEST='docs/operations/evidence/source-acquisition-close-20261019.json';
const FILES=Object.freeze([
 {
  "path": "supabase/functions/_shared/recommendation-monthly-response-sharing.ts",
  "mode": "100644",
  "before_sha256": null,
  "after_sha256": "f4db375a05303478d5639f958f7b7b6b61739eb025833e88ab95983b61caa7b9"
 },
 {
  "path": "supabase/functions/_shared/recommendation-v2-forward-outcomes.ts",
  "mode": "100644",
  "before_sha256": "6b6f8d16bb9bf66739512674a84c375695f3bc03d1d92d98cc7f1f8e043f83c7",
  "after_sha256": "d3947bcee40e254b821c75107769dfbfe6bde5b70bde7f425cb4dae2a049f100"
 },
 {
  "path": "supabase/functions/recommendation-stock-evidence-v1/index.ts",
  "mode": "100644",
  "before_sha256": "2b4dc7ce5f76f0b1fe0b847590261fb9239a839c4a82404e614bd69dfa625d41",
  "after_sha256": "41d64e5fa4faaa9c930ce96f7f216f0321c01475e32aa666cd2cd75ed6ffd97e"
 },
 {
  "path": "tests/recommendationV2ForwardOutcomes.test.mjs",
  "mode": "100644",
  "before_sha256": "9f35455e1f464bc96ccdc134a840e2b54da67223d6d5f46fa2bb0b4ca07126bb",
  "after_sha256": "d117ab1cfb193e80b030d4243e98fceb29f24f5448f7f7ac2bac192d2b163ef6"
 },
 {
  "path": "tests/recommendationV2FugleRuntime.test.mjs",
  "mode": "100644",
  "before_sha256": "46510466a011b1978749206f24038da51386ee85c81ce900ae823538056dd725",
  "after_sha256": "d276a68e2c6fcc2774bd2c3e132bf117612aa29b320e7e9242f1fef15df33f18"
 },
 {
  "path": "tests/recommendationV2MonthlyResponseSharing.test.mjs",
  "mode": "100644",
  "before_sha256": null,
  "after_sha256": "aeb7ea65f1c65aa886f2a09aa2f57c6e7aa7d383244023d45e8982061839cc50"
 }
]);
const PROTECTED=Object.freeze([
 {
  "path": "supabase/functions/_shared/decision-v1-evidence.ts",
  "mode": "100644",
  "sha256": "327928dd61babe767873a38ddc1cd933ce440d0f8fc6c269f4bcc8b4bdd37156"
 },
 {
  "path": "supabase/functions/_shared/recommendation-shadow-v2-engine.ts",
  "mode": "100644",
  "sha256": "5d934bb7c2be21ff66a0043a945b0d91edcbeb2a57166882715e8813da31766e"
 },
 {
  "path": "supabase/functions/_shared/recommendation-official-actuals.ts",
  "mode": "100644",
  "sha256": "3b166e74cee4515a6a7e3bf726faf418742c5c22112e9363b38b337257d76a0c"
 },
 {
  "path": "supabase/functions/_shared/recommendation-shadow-v2-sources.ts",
  "mode": "100644",
  "sha256": "98475003460d215e764bf011aba5fae7a603ba3455e54be547dba75e79e23708"
 },
 {
  "path": "supabase/functions/vnext-daily-research-v1/index.ts",
  "mode": "100644",
  "sha256": "9260ec345dcb8a6e96c8f65ccc110789ec6d9dc5316fe46c1b229172e8abc792"
 },
 {
  "path": "supabase/functions/recommendation-v2-forward-worker-v1/index.ts",
  "mode": "100644",
  "sha256": "e8c39bb557400b8dbabf76ce841984be4c9ee60b2867bb6602e4dd2260f42c58"
 }
]);
const PRIOR_RULES=Object.freeze([
 {
  "path": "tests/helpers/ownerRegimeDisplayAdmission.mjs",
  "mode": "100644",
  "sha256": "a5b4b4688a977cdde95339c3e976ef7c218d2fe8a3374c38788d170446ec37f9"
 },
 {
  "path": "tests/ownerRegimeDisplayAdmission.test.mjs",
  "mode": "100644",
  "sha256": "c13e9504e9002720e9afc54691285d26acd3136ffd406131906c0a6b01da5041"
 },
 {
  "path": "tests/helpers/vnextIntegrity.mjs",
  "mode": "100644",
  "sha256": "a8299e24647e07fa9dc6eb23f094188d8dcaf3d37633c4666be784b300eb067b"
 },
 {
  "path": "tests/vnextIntegrity.test.mjs",
  "mode": "100644",
  "sha256": "cd3efd52bffccf3315d659674ed017fa15f3be642860389c4c8bbdc543c9b68c"
 },
 {
  "path": "tests/integrationAdmission.test.mjs",
  "mode": "100644",
  "sha256": "539e44ccda3168a0b0fdb13ef8fb700b93e994d763f8f0a8a981c720a56cdcbf"
 }
]);
const PREDECESSOR={"path":"docs/operations/evidence/core-member-integration-20261019-owner-regime-display.json","sha256":"2c65df89767113c38c43e6536e84dd798b9985d3c68711f5094c9279ffe26a43"};
const PRIOR_CANDIDATE={"commit":"7cd552903e7c08234f8728aecdf99d495087bc3c","tree":"b8a08955eafd8e205b83a7e115cd7d2cf674d448"};
const SCOPE={"monthly_requests":"TWO_FIXED_OFFICIAL_URLS_ONE_ANONYMOUS_GET_EACH_PER_BUNDLE","outcome_bars":"OBSERVED_AT_CLOCK_WITH_HORIZON_CUTOFF_ENFORCED","source_fallback":false,"methodology_change":false,"reset_or_replay":false,"provider_invocation":false};
const DEPLOYMENTS={"source_merge_is_deployment":false,"caller":{"function":"recommendation-v2-forward-worker-v1","baseline_version":3,"candidate_kind":"SINGLE_OUTCOME_DIAGNOSTIC_DEPENDENCY_ONLY","sdk":"FIXED_SUPABASE_JS_2.57.4","entrypoint_or_hook_change":false,"other_declared_sources":"UNCHANGED_BASELINE_21_OF_22","production_authorized":false},"producer":{"function":"recommendation-stock-evidence-v1","baseline_version":15,"candidate_kind":"SAME_BATCH_MONTHLY_RESPONSE_SHARING_SOURCE_ONLY","deployment_status":"HOLD_EXISTING_UNVERSIONED_SDK_FINGERPRINT_MISMATCH","production_authorized":false}};
const FLAGS=["production_authorized","migration_execution","auth_rls_change","member_rights_activation","caller_activation","research_publication","line_send","payment_enabled"];
const root=new URL('../../',import.meta.url);
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,maxBuffer:1024*1024});
const prior=path=>git(['show',SOURCE_ACQUISITION_BASE+':'+path]);
export function verifySourceAcquisitionClose(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyIntegrationCandidate(read,paths,mode);
 const bytes=Buffer.from(read(SOURCE_ACQUISITION_MANIFEST)),m=JSON.parse(bytes);
 assert.deepEqual(Object.keys(m).sort(),['schema','base','prior_candidate','files','protected_sources','prior_rules','predecessor','scope','deployment_candidates',...FLAGS].sort());
 assert.equal(m.schema,'MORNING_ALPHA_SOURCE_ACQUISITION_CLOSE_V1');assert.equal(m.base,SOURCE_ACQUISITION_BASE);
 assert.deepEqual(m.prior_candidate,PRIOR_CANDIDATE);assert.deepEqual(m.files,FILES);
 assert.deepEqual(m.protected_sources,PROTECTED);assert.deepEqual(m.prior_rules,PRIOR_RULES);assert.deepEqual(m.predecessor,PREDECESSOR);assert.deepEqual(m.scope,SCOPE);assert.deepEqual(m.deployment_candidates,DEPLOYMENTS);
 for(const flag of FLAGS)assert.equal(m[flag],false,'SOURCE_ACQUISITION_FORBIDDEN:'+flag);
 assert.equal(integrationHash(read(PREDECESSOR.path)),PREDECESSOR.sha256,'SOURCE_ACQUISITION_PRIOR_RECEIPT');
 assert.deepEqual(Buffer.from(read(PREDECESSOR.path)),prior(PREDECESSOR.path),'SOURCE_ACQUISITION_IMMUTABLE_PREDECESSOR');
 for(const row of FILES){
  if(row.before_sha256===null)assert.equal(git(['ls-tree',SOURCE_ACQUISITION_BASE,'--',row.path]).length,0,'SOURCE_ACQUISITION_BASE_ABSENT');
  else assert.equal(integrationHash(prior(row.path)),row.before_sha256,'SOURCE_ACQUISITION_BEFORE');
  assert.equal(integrationHash(read(row.path)),row.after_sha256,'SOURCE_ACQUISITION_SOURCE');assert.equal(mode(row.path),row.mode,'SOURCE_ACQUISITION_MODE');
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),row.after_sha256,'SOURCE_ACQUISITION_PHYSICAL_SOURCE');
  assert.equal(integrationPhysicalMode(row.path),row.mode,'SOURCE_ACQUISITION_PHYSICAL_MODE');
 }
 for(const row of [...PROTECTED,...PRIOR_RULES]){
  assert.equal(integrationHash(prior(row.path)),row.sha256,'SOURCE_ACQUISITION_PROTECTED_BASE');
  assert.equal(integrationHash(read(row.path)),row.sha256,'SOURCE_ACQUISITION_PROTECTED_SOURCE');assert.equal(mode(row.path),row.mode,'SOURCE_ACQUISITION_PROTECTED_MODE');
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),row.sha256,'SOURCE_ACQUISITION_PROTECTED_PHYSICAL_SOURCE');
  assert.equal(integrationPhysicalMode(row.path),row.mode,'SOURCE_ACQUISITION_PROTECTED_PHYSICAL_MODE');
 }
 // The synthetic module catalogue grows; original test assertions do not shrink.
 const harness='tests/recommendationV2FugleRuntime.test.mjs',text=Buffer.from(read(harness)).toString();
 for(const line of prior(harness).toString().split('\n').filter(line=>line.includes('assert')))assert(text.includes(line),'SOURCE_ACQUISITION_PRIOR_ASSERTION_REMOVED');
 assert.deepEqual(integrationPhysicalRead(SOURCE_ACQUISITION_MANIFEST),bytes,'SOURCE_ACQUISITION_RECEIPT_CHANGED');
 verifyIntegrationCandidate();return structuredClone(m);
}
