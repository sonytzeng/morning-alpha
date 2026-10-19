// Current C diagnostic admission. Earlier source/CI assertions keep their
// original bytes and execute separately at immutable965, not a translated HEAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyIntegrationCandidate,INTEGRATION_MANIFEST,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash} from './helpers/integrationAdmission.mjs';
const BASE='965263fe15dc672cac6c61af06bfd14d69044dd3';
const MANIFEST='docs/operations/evidence/c-worker-rpc-diagnostics-20261019.json';
const FLAGS=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
const prior=path=>execFileSync('git',['--no-replace-objects','show',BASE+':'+path],{maxBuffer:8*1024*1024});
const FILES=[
 {path:'supabase/functions/vnext-daily-research-v1/index.ts',mode:'100644',before_sha256:'9260ec345dcb8a6e96c8f65ccc110789ec6d9dc5316fe46c1b229172e8abc792',after_sha256:'fbc591c736dbc15913feeec381c14433b96004c4f03cce38ae21673af4c6c89d'},
 {path:'tests/cWorkerRpcFailureDiagnostics.integration.mjs',mode:'100644',before_sha256:null,after_sha256:'7ddec97080ef7597f83915e1ee6f81fbaf257ec00db3e710babed3e31b492c34'},
];
function candidate(){
 verifyIntegrationCandidate();const m=JSON.parse(readFileSync(MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','protected_sources','prior_rules','predecessor','runtime','scope',...FLAGS].sort());
 assert.equal(m.schema,'C_WORKER_RPC_DIAGNOSTICS_SOURCE_CANDIDATE_V1');assert.equal(m.base,BASE);assert.deepEqual(m.files,FILES);
 for(const flag of FLAGS)assert.equal(m[flag],false);
 assert.deepEqual(m.runtime,{function:'vnext-daily-research-v1',baseline_version:2,verify_jwt:true,import_map:false,payload_files:74,runtime_files:44,unchanged_payload_files:73,
  candidate_payload_sha256:'c86202f3123aeddefc6ca39efdca0b25cfcadee955527cff7c1a92a7dee6e7d9',recovery_payload_sha256:'0d88f57588d02cb63ba467a3803b44815110a67ad5712e40903c241806bd02d2'});
 assert.deepEqual(m.scope,{fixed_rpc_names:3,fixed_runtime_operations:13,unknown_code:'GENERIC',raw_error_or_request_logging:false,original_refusal_preserved:true,timeout_ms:8000,
  business_behavior_change:false,retry_reset_or_replay:false,provider_or_worker_invocation:false});
 for(const row of FILES){
  if(row.before_sha256!==null)assert.equal(integrationHash(prior(row.path)),row.before_sha256);
  assert.equal(integrationHash(readFileSync(row.path)),row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 for(const row of [...m.protected_sources,...m.prior_rules]){
  assert.deepEqual(readFileSync(row.path),prior(row.path),'immutable predecessor:'+row.path);assert.equal(integrationHash(readFileSync(row.path)),row.sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 assert.deepEqual(readFileSync(m.predecessor.path),prior(m.predecessor.path));assert.equal(integrationHash(readFileSync(m.predecessor.path)),m.predecessor.sha256);
 return m;
}
test('current C diagnostic candidate is exactly two source files with original Worker2 and previous source rules retained',()=>{
 const m=candidate();assert.equal(m.files.length,2);assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261019-c-worker-rpc-diagnostics.json');
 assert.equal(m.protected_sources.length,8);assert.equal(m.prior_rules.length,7);
});
test('the current outer verifier changes only its new fixed receipt and exact reviewed source inventory',()=>{
 const path='tests/helpers/integrationAdmission.mjs';let expected=prior(path).toString();
 expected=expected.replace("export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-source-acquisition.json';",
  "export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-c-worker-rpc-diagnostics.json';");
 const marker="const FROZEN_OWNER_REGIME_DISPLAY_MANIFEST='docs/operations/evidence/core-member-integration-20261019-owner-regime-display.json';";
 expected=expected.replace(marker,marker+"\nconst PRIOR_SOURCE_ACQUISITION='965263fe15dc672cac6c61af06bfd14d69044dd3';\nconst FROZEN_SOURCE_ACQUISITION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-source-acquisition.json';");
 expected=expected.replace('export const INTEGRATION_DELTAS=Object.freeze([',"export const INTEGRATION_DELTAS=Object.freeze([\n FROZEN_SOURCE_ACQUISITION_MANIFEST,\n 'docs/operations/evidence/c-worker-rpc-diagnostics-20261019.json',\n 'docs/operations/c-worker-rpc-diagnostics-20261019.md',\n 'tests/cWorkerRpcDiagnosticsAdmission.test.mjs',\n 'tests/cWorkerRpcFailureDiagnostics.integration.mjs',");
 const check=" assert.deepEqual(Buffer.from(read(FROZEN_OWNER_REGIME_DISPLAY_MANIFEST)),frozenReceipt(PRIOR_OWNER_REGIME_DISPLAY,FROZEN_OWNER_REGIME_DISPLAY_MANIFEST),'INTEGRATION_OWNER_REGIME_DISPLAY_RECEIPT_DRIFT');";
 expected=expected.replace(check,check+"\n assert.deepEqual(Buffer.from(read(FROZEN_SOURCE_ACQUISITION_MANIFEST)),frozenReceipt(PRIOR_SOURCE_ACQUISITION,FROZEN_SOURCE_ACQUISITION_MANIFEST),'INTEGRATION_SOURCE_ACQUISITION_RECEIPT_DRIFT');");
 assert.equal(readFileSync(path,'utf8'),expected,'all existing physical, historical, baseline, scope, mode and flag refusals retain their exact implementation');
});
test('complete current source retains per-file drift, exact modes, deleted paths and unknown inventory refusals',()=>{
 const m=verifyIntegrationCandidate(),paths=integrationInventory();
 for(const row of m.files){
  const bad=Buffer.concat([integrationPhysicalRead(row.path),Buffer.from('INJECTED_CURRENT_SOURCE')]);
  assert.throws(()=>verifyIntegrationCandidate(path=>path===row.path?bad:integrationPhysicalRead(path),paths),/DRIFT/);
 }
 for(const path of FILES.map(row=>row.path)){
  assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths,p=>p===path?'100755':integrationPhysicalMode(p)),/MODE/);
  assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===path)throw Object.assign(Error('MISSING_CURRENT_SOURCE'),{code:'ENOENT'});return integrationPhysicalRead(p);},paths),/MISSING_CURRENT_SOURCE/);
  assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths.filter(p=>p!==path)),/UNKNOWN_PATH/);
 }
 for(const path of ['supabase/functions/unreviewed/index.ts','tests/unreviewed.test.mjs','docs/unreviewed.json'])assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,[...paths,path]),/UNKNOWN_PATH/);
 // The inherited immutable/baseline files are covered even with a forged
 // inventory that omits an unchanged path.
 const path='package-lock.json',bad=Buffer.concat([integrationPhysicalRead(path),Buffer.from('BASELINE_DRIFT')]);
 assert.throws(()=>verifyIntegrationCandidate(p=>p===path?bad:integrationPhysicalRead(p),paths),/BASELINE_DRIFT/);
});
test('new outer receipt cannot authorize deployment, replace parents, remove rows or alter a predecessor',()=>{
 const original=verifyIntegrationCandidate(),paths=integrationInventory();
 for(const mutate of [m=>m.parents.core='HEAD',m=>m.files.pop(),m=>m.files.push({...m.files[0],path:'UNREVIEWED'}),...FLAGS.map(flag=>m=>m[flag]=true)]){
  const forged=structuredClone(original);mutate(forged);assert.throws(()=>verifyIntegrationCandidate(path=>path===INTEGRATION_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path),paths));
 }
 const previous=candidate().predecessor.path;
 assert.throws(()=>verifyIntegrationCandidate(path=>path===previous?Buffer.concat([integrationPhysicalRead(path),Buffer.from(' ') ]):integrationPhysicalRead(path),paths),/SOURCE_ACQUISITION_RECEIPT_DRIFT/);
});
test('fixed965 historical source assertions and current C protocol use explicit separate checkouts',()=>{
 const workflow=readFileSync('.github/workflows/core-member-integration.yml','utf8');
 const steps=workflow.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));
 const admission=steps.find(block=>block.includes('verifyIntegrationCandidate();'));assert(admission);assert.doesNotMatch(admission,/working-directory:/);
 assert(admission.includes('tests/cWorkerRpcDiagnosticsAdmission.test.mjs'));
 const checkout=steps.find(block=>block.includes('path: build/c-worker-rpc-historical-base'));assert(checkout);assert.match(checkout,/ref: 965263fe15dc672cac6c61af06bfd14d69044dd3/);assert.match(checkout,/persist-credentials: false/);
 assert(steps.indexOf(admission)<steps.indexOf(checkout));
 const proof=steps.find(block=>block.includes('run: node --experimental-strip-types --test tests/integrationAdmission.test.mjs tests/recommendationV2SourceAcquisitionAdmission.test.mjs'));
 assert(proof);assert.match(proof,/working-directory: build\/c-worker-rpc-historical-base/);
 const vm=steps.find(block=>block.includes('tests/cWorkerRpcFailureDiagnostics.integration.mjs'));assert(vm);assert.doesNotMatch(vm,/working-directory:/);
 assert(vm.includes('--experimental-vm-modules --require ./tests/helpers/cWorkerLocalSdkNetworkDenied.cjs --test --test-concurrency=1'));
 const check=steps.find(block=>block.includes('deno check --no-lock supabase/functions/vnext-daily-research-v1/index.ts'));assert(check);assert.doesNotMatch(check,/working-directory:/);
 for(const command of ['npm run type-check','npm run lint','npm run build']){const step=steps.find(block=>block.includes('run: '+command));assert(step);assert.doesNotMatch(step,/working-directory:/);}
 for(const legacy of ['tests/integrationAdmission.test.mjs','tests/recommendationV2SourceAcquisitionAdmission.test.mjs','tests/helpers/sourceAcquisitionCloseAdmission.mjs'])assert.deepEqual(readFileSync(legacy),prior(legacy));
 // The independent quarter-artifact job also starts from the current source.
 // Its old integration proof already runs unchanged at fixed965 above.
 const quarterPath='.github/workflows/owner-quarter-live-candidate.yml',quarter=readFileSync(quarterPath,'utf8');
 const expectedQuarter=prior(quarterPath).toString().replace('node --experimental-strip-types --test tests/integrationAdmission.test.mjs',
  'node --experimental-strip-types --test tests/cWorkerRpcDiagnosticsAdmission.test.mjs');
 assert.equal(quarter,expectedQuarter,'only the current admission test selector changes; every historical quarter artifact command stays intact');
 const quarterSteps=quarter.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));
 const quarterAdmission=quarterSteps.find(block=>block.includes('verifyIntegrationCandidate();'));
 const quarterCheckout=quarterSteps.find(block=>block.includes('path: build/priced-in-historical-base'));
 assert(quarterAdmission&&quarterCheckout);assert(quarterAdmission.includes('tests/cWorkerRpcDiagnosticsAdmission.test.mjs'));
 assert.doesNotMatch(quarterAdmission,/working-directory:/);assert(quarterSteps.indexOf(quarterAdmission)<quarterSteps.indexOf(quarterCheckout));
});
test('V2 behavior glob preserves every current behavior file and moves only one exact source proof to fixed965',()=>{
 const path='.github/workflows/recommendation-v2-shadow.yml',current=readFileSync(path,'utf8'),original=prior(path).toString();
 const old='        run: node --experimental-strip-types --test tests/recommendationV2*.test.mjs';
 const replacement=`        run: |
          # Only the immutable source-admission proof moves to fixed965 in the
          # Core integration job; every current V2 behavior test still runs here.
          files=(tests/recommendationV2*.test.mjs)
          current=()
          historical=0
          for file in "\${files[@]}"; do
            if [ "$file" = tests/recommendationV2SourceAcquisitionAdmission.test.mjs ]; then
              historical=$((historical + 1))
            else
              current+=("$file")
            fi
          done
          test "$historical" -eq 1
          test "\${#current[@]}" -eq "$((${'${#files[@]}'} - 1))"
          node --experimental-strip-types --test "\${current[@]}"`;
 assert(current.includes(replacement));assert.equal(current.replace(replacement,old),original,'no other V2 job command, timeout, source or setting changes');
 assert(!/continue|grep -v|filter\(/.test(replacement));
});
test('the old single-event public SDK check is immutable and never evidence for the new diagnostic entrypoint',()=>{
 const files=['.github/workflows/c-worker-sdk-freshness-20261019.yml','scripts/operations/sdk-public-freshness-20261019/sdk_public_freshness.py',
  'scripts/operations/sdk-public-freshness-20261019/sdk-freshness-plan.json','scripts/operations/sdk-public-freshness-20261019/test_sdk_public_freshness_offline.py'];
 for(const path of files)assert.deepEqual(readFileSync(path),prior(path));
 const workflow=readFileSync(files[0],'utf8'),plan=JSON.parse(readFileSync(files[2]));
 assert.match(workflow,/types: \[synchronize\]/);assert.match(workflow,/head\.ref == 'codex\/market-regime-compatibility-20261019'/);
 assert(workflow.includes('test "$GITHUB_RUN_NUMBER" = 1'));assert(workflow.includes('test "$GITHUB_RUN_ATTEMPT" = 1'));
 assert.equal(plan.head_branch,'codex/market-regime-compatibility-20261019');assert.equal(plan.event.action,'synchronize');
 assert.equal(plan.repair_args_sha256,'1668a874bf6d48b29fc6b49a774242ac584d6fe7b6ab0f02e130d1328c554bed');
 assert(!workflow.includes(FILES[0].path),'the old SDK checker does not check the new C entrypoint');
 assert.notEqual(plan.repair_args_sha256,candidate().runtime.candidate_payload_sha256);
});
