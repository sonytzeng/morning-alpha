// Fixed source integrity for the original Producer15 deployment closure.
// No production invocation, source admission, business backfill or recommendation proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyIntegrationCandidate,INTEGRATION_MANIFEST,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash} from './helpers/integrationAdmission.mjs';
const BASE='a1f4abb2d73ee6495fc1c212f774c2f2dd627771';
const MANIFEST='docs/operations/evidence/producer15-monthly-source-admission-20261019.json';
const FLAGS=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
const prior=path=>execFileSync('git',['--no-replace-objects','show',BASE+':'+path],{maxBuffer:8*1024*1024});
const FILES=[{"path":"scripts/operations/producer15-monthly-release-20261019/release-catalog.json","mode":"100644","before_sha256":null,"after_sha256":"8f2d0a6c7ed0f9f203d2a446f0e617fd77439808602a9fd1f561407e43ee0227"},{"path":"scripts/operations/producer15-monthly-release-20261019/materialize.mjs","mode":"100644","before_sha256":null,"after_sha256":"7570a29761ea2f075d59e98303ee27ee8bd1cd59eeda7d65e592fa82661af06d"},{"path":"scripts/operations/producer15-monthly-release-20261019/README.md","mode":"100644","before_sha256":null,"after_sha256":"f602980e5539c8cdc0e3fed419d8f35c4805d4664022c4928557dbece1bf0fa4"},{"path":"tests/producer15MonthlyRelease.test.mjs","mode":"100644","before_sha256":null,"after_sha256":"62cbcea269fb119d7659247443989df1452ca99d71143f88a156a814eab57903"}];
const SCOPE={"mode":"EXISTING_PRODUCER15_DELIVERY_CLOSURE","new_product":false,"main_producer_replaced":false,"sdk_change":false,"original_runtime_files":20,"unchanged_original_runtime_files":19,"fixed_entry_edits":5,"type_only_import_extension_bytes":3,"type_erasure_equivalent":true,"fresh_sdk_http_proof":false,"private_capture":false,"quarter_capsule":false,"new_data_acquisition":false,"quality_threshold_change":false,"formal_recommendation_e2e":false};
const PAYLOAD={"candidate":{"files":22,"runtime":21,"type_only":1,"sha256":"1ce72754fdfe0e63460d8cf0091f649d9dcd8b030f08d5693a086a6d08eff991"},"recovery":{"files":21,"runtime":20,"type_only":1,"sha256":"abc82c50b6b47a65c49671c03f6a25fa34f50c6a3d1781fb1bad763bd4848488"},"exact_original_rollback_sha256":"80998b0fd69daa0d281c06857b9da1b4f2354894bf75b26a121f14b808a73031"};
function candidate(){
 verifyIntegrationCandidate();const m=JSON.parse(readFileSync(MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','protected_sources','prior_rules','predecessor','scope','payload',...FLAGS].sort());
 assert.equal(m.schema,'PRODUCER15_MONTHLY_DELIVERY_SOURCE_ADMISSION_V1');assert.equal(m.base,BASE);assert.deepEqual(m.files,FILES);
 for(const flag of FLAGS)assert.equal(m[flag],false);
 assert.deepEqual(m.scope,SCOPE);assert.deepEqual(m.payload,PAYLOAD);
 for(const row of FILES){assert.equal(row.before_sha256,null);assert.equal(integrationHash(readFileSync(row.path)),row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);}
 for(const row of [...m.protected_sources,...m.prior_rules]){
  assert.deepEqual(readFileSync(row.path),prior(row.path),'unchanged current source or historical assertion:'+row.path);
  assert.equal(integrationHash(readFileSync(row.path)),row.sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 assert.deepEqual(readFileSync(m.predecessor.path),prior(m.predecessor.path));assert.equal(integrationHash(readFileSync(m.predecessor.path)),m.predecessor.sha256);
 return m;
}
test('the exact four-file Producer15 delivery artifact preserves current main, original runtime, LONG and C source boundaries',()=>{
 const m=candidate();assert.equal(m.files.length,4);assert.equal(m.protected_sources.length,12);assert.equal(m.prior_rules.length,6);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261019-producer15-monthly-release.json');
 const c=JSON.parse(readFileSync(FILES[0].path));
 assert.equal(c.base_head,BASE);assert.equal(c.production_authorized,false);assert.deepEqual(c.scope,{
  sdk_change:false,current_main_producer_replacement:false,quarter_capsule:false,private_capture:false,source_admission:false,business_backfill:false,
  core_writes:false,member_rights:false,auth_rls_cron:false,line:false,payment:false});
 for(const variant of ['candidate','recovery']){
  assert.equal(c.variants[variant].payload_sha256,PAYLOAD[variant].sha256);assert.equal(c.variants[variant].files.length,PAYLOAD[variant].files);
  assert.equal(c.variants[variant].runtime_files,PAYLOAD[variant].runtime);assert.equal(c.variants[variant].type_only_files,1);
 }
 assert.equal(c.original_rollback_payload_sha256,PAYLOAD.exact_original_rollback_sha256);
 assert.equal(c.baseline_fresh_proof.sdk_remote_eszip_bodies_proven,false);
});
test('current outer verification appends only a fixed LONG predecessor and the exact reviewed delivery artifact inventory',()=>{
 const path='tests/helpers/integrationAdmission.mjs';let expected=prior(path).toString();
 expected=expected.replace("export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-retained-quarter-family.json';",
  "export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-producer15-monthly-release.json';");
 const marker="const FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST='docs/operations/evidence/core-member-integration-20261019-c-worker-rpc-diagnostics.json';";
 expected=expected.replace(marker,marker+"\nconst PRIOR_RETAINED_QUARTER_FAMILY='a1f4abb2d73ee6495fc1c212f774c2f2dd627771';\nconst FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST='docs/operations/evidence/core-member-integration-20261019-retained-quarter-family.json';");
 expected=expected.replace('export const INTEGRATION_DELTAS=Object.freeze([',"export const INTEGRATION_DELTAS=Object.freeze([\n FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST,\n 'docs/operations/evidence/producer15-monthly-source-admission-20261019.json',\n 'tests/producer15MonthlyAdmission.test.mjs',\n 'scripts/operations/producer15-monthly-release-20261019/release-catalog.json',\n 'scripts/operations/producer15-monthly-release-20261019/materialize.mjs',\n 'scripts/operations/producer15-monthly-release-20261019/README.md',\n 'tests/producer15MonthlyRelease.test.mjs',");
 const check=" assert.deepEqual(Buffer.from(read(FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST)),frozenReceipt(PRIOR_C_WORKER_RPC_DIAGNOSTICS,FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST),'INTEGRATION_C_WORKER_RPC_DIAGNOSTICS_RECEIPT_DRIFT');";
 expected=expected.replace(check,check+"\n assert.deepEqual(Buffer.from(read(FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST)),frozenReceipt(PRIOR_RETAINED_QUARTER_FAMILY,FROZEN_RETAINED_QUARTER_FAMILY_MANIFEST),'INTEGRATION_RETAINED_QUARTER_FAMILY_RECEIPT_DRIFT');");
 assert.equal(readFileSync(path,'utf8'),expected,'all earlier source, physical, inventory, mode and flag refusals remain exact');
});
test('all current source drift, unknown paths, modes, deletions and unlisted baseline changes are refused',()=>{
 const seal=verifyIntegrationCandidate(),paths=integrationInventory();
 for(const row of seal.files){const bad=Buffer.concat([integrationPhysicalRead(row.path),Buffer.from('CURRENT_SOURCE_DRIFT')]);assert.throws(()=>verifyIntegrationCandidate(path=>path===row.path?bad:integrationPhysicalRead(path),paths),/DRIFT/);}
 for(const row of FILES){
  assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths,p=>p===row.path?'100755':integrationPhysicalMode(p)),/MODE/);
  assert.throws(()=>verifyIntegrationCandidate(path=>{if(path===row.path)throw Error('SOURCE_REMOVED');return integrationPhysicalRead(path);},paths),/SOURCE_REMOVED/);
  assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths.filter(p=>p!==row.path)),/UNKNOWN_PATH/);
 }
 for(const path of ['scripts/operations/producer15-monthly-release-20261019/unreviewed.json','tests/private-provider-pack.json','docs/unreviewed.json'])assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,[...paths,path]),/UNKNOWN_PATH/);
 const path='package-lock.json',bad=Buffer.concat([integrationPhysicalRead(path),Buffer.from('BASELINE_DRIFT')]);assert.throws(()=>verifyIntegrationCandidate(p=>p===path?bad:integrationPhysicalRead(p),paths),/BASELINE_DRIFT/);
});
test('the current source receipt cannot authorize deployment, alter original parents or replace the frozen LONG seal',()=>{
 const original=verifyIntegrationCandidate(),paths=integrationInventory();
 for(const mutate of [m=>m.parents.member='HEAD',m=>m.files.pop(),m=>m.files.push({...m.files[0],path:'PRIVATE_UNREVIEWED'}),...FLAGS.map(flag=>m=>m[flag]=true)]){
  const forged=structuredClone(original);mutate(forged);assert.throws(()=>verifyIntegrationCandidate(path=>path===INTEGRATION_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path),paths));
 }
 const previous=candidate().predecessor.path;assert.throws(()=>verifyIntegrationCandidate(path=>path===previous?Buffer.concat([integrationPhysicalRead(path),Buffer.from(' ') ]):integrationPhysicalRead(path),paths),/RETAINED_QUARTER_FAMILY_RECEIPT_DRIFT/);
});
test('only immutable LONG source proofs move to fixed a1 while exact artifact and every current behavior remain current',()=>{
 const path='.github/workflows/core-member-integration.yml',text=readFileSync(path,'utf8');let expected=prior(path).toString();
 expected=expected.replace('          node --experimental-strip-types --test tests/retainedQuarterFamilyAdmission.test.mjs','          node --experimental-strip-types --test tests/producer15MonthlyAdmission.test.mjs');
 const marker='      - name: Current retained-quarter adapter and unchanged research funnel refusal controls';
 const addition=`      - name: Current exact Producer15 monthly delivery and original parser refusal controls
        env:
          NODE_OPTIONS: --experimental-strip-types
        run: node --experimental-strip-types --test tests/producer15MonthlyRelease.test.mjs
      - name: Check out the immutable pre-Producer15-delivery LONG source proofs only
        uses: actions/checkout@v4
        with:
          ref: a1f4abb2d73ee6495fc1c212f774c2f2dd627771
          path: build/producer15-monthly-historical-base
          fetch-depth: 0
          persist-credentials: false
      - name: Historical a1 LONG source and workflow proofs unchanged
        working-directory: build/producer15-monthly-historical-base
        env:
          NODE_OPTIONS: --experimental-strip-types
        run: node --experimental-strip-types --test tests/retainedQuarterFamilyAdmission.test.mjs
`;
 expected=expected.replace(marker,addition+marker);
 const denoMarker='      - run: deno check --no-lock research/retained-quarter-financials.ts supabase/functions/vnext-daily-research-v1/index.ts supabase/functions/get-report-payload/index.ts supabase/functions/recommendation-stock-evidence-v1/index.ts supabase/functions/v1-provider-capability-review-v1/index.ts';
 const denoAddition=`      - name: Materialize and type-check the exact current Producer15 candidate and recovery
        run: |
          node scripts/operations/producer15-monthly-release-20261019/materialize.mjs candidate
          node scripts/operations/producer15-monthly-release-20261019/materialize.mjs recovery
          deno check --no-lock build/producer15-monthly-release-20261019/candidate/supabase/functions/recommendation-stock-evidence-v1/index.ts build/producer15-monthly-release-20261019/recovery/supabase/functions/recommendation-stock-evidence-v1/index.ts
`;
 expected=expected.replace(denoMarker,denoAddition+denoMarker);assert.equal(text,expected,'all original tests, memory/time guards, current builds and historical artifact jobs retain exact bytes');
 const steps=text.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));
 const admission=steps.find(block=>block.includes('verifyIntegrationCandidate();'));assert(admission);assert(admission.includes('tests/producer15MonthlyAdmission.test.mjs'));assert.doesNotMatch(admission,/working-directory:/);
 const checkout=steps.find(block=>block.includes('path: build/producer15-monthly-historical-base'));assert(checkout);assert(checkout.includes('ref: '+BASE));assert.match(checkout,/persist-credentials: false/);assert(steps.indexOf(admission)<steps.indexOf(checkout));
 const old=steps.find(block=>block.includes('run: node --experimental-strip-types --test tests/retainedQuarterFamilyAdmission.test.mjs'));assert(old);assert.match(old,/working-directory: build\/producer15-monthly-historical-base/);
 const artifact=steps.find(block=>block.includes('run: node --experimental-strip-types --test tests/producer15MonthlyRelease.test.mjs'));assert(artifact);assert.doesNotMatch(artifact,/working-directory:/);
 const output=steps.find(block=>block.includes('materialize.mjs candidate'));assert(output);assert.doesNotMatch(output,/working-directory:/);
 const setup=steps.find(block=>block.includes('uses: denoland/setup-deno@v2'));assert(setup);assert(steps.indexOf(setup)<steps.indexOf(output));assert(steps.indexOf(artifact)<steps.indexOf(output));
 const quarterPath='.github/workflows/owner-quarter-live-candidate.yml',quarter=readFileSync(quarterPath,'utf8');assert.equal(quarter,prior(quarterPath).toString().replace('node --experimental-strip-types --test tests/retainedQuarterFamilyAdmission.test.mjs','node --experimental-strip-types --test tests/producer15MonthlyAdmission.test.mjs'));
 const quarterSteps=quarter.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));const quarterAdmission=quarterSteps.find(block=>block.includes('verifyIntegrationCandidate();'));const quarterCheckout=quarterSteps.find(block=>block.includes('path: build/priced-in-historical-base'));
 assert(quarterAdmission&&quarterCheckout);assert(quarterAdmission.includes('tests/producer15MonthlyAdmission.test.mjs'));assert.doesNotMatch(quarterAdmission,/working-directory:/);assert(quarterSteps.indexOf(quarterAdmission)<quarterSteps.indexOf(quarterCheckout));
 for(const file of ['.github/workflows/vnext-candidate.yml','.github/workflows/recommendation-v2-shadow.yml','.github/workflows/c-worker-sdk-freshness-20261019.yml'])assert.deepEqual(readFileSync(file),prior(file),'all current behavior selection, memory/deadline and original SDK guards retained:'+file);
});
