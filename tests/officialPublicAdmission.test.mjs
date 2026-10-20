// Existing PR284 assertions are immutable; current union is separately admitted.
import test from 'node:test';import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {
 verifyIntegrationCandidate,createSourceUnionComposition,sourceUnionParentRead,reuseSourceUnionPinnedProof,SOURCE_UNION_PARENTS,
 integrationPhysicalRead,integrationPhysicalMode,integrationInventory,
 integrationHash,integrationHistoricalRead,SOURCE_UNION_R3_FILES,SOURCE_UNION_R3_BASE,SOURCE_UNION_R4_FILES,
 SOURCE_UNION_R5_FILES,FROZEN_SOURCE_UNION_R4,FROZEN_SOURCE_UNION_R5,FROZEN_SOURCE_UNION_R6,INTEGRATION_MANIFEST,
} from './helpers/integrationAdmission.mjs';
import {assemble as financial,CHANGED,CATALOG} from '../scripts/operations/financial-response-period-20261020/materialize.mjs';
import {worker4Baseline} from '../scripts/operations/forward-cutoff-20261020/materialize.mjs';
test('the ONE current seal is full, current and independent of either frozen parent proof',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(createSourceUnionComposition(),m);
 for(const path of ['.github/workflows/validate-release.yml','tests/helpers/clockedPsql.mjs',
  'tests/coldSourcePriorityAdmission.test.mjs','tests/r10FunctionalSourceClosure.test.mjs']){
  assert.deepEqual(integrationPhysicalRead(path),sourceUnionParentRead('actual',path));
  assert.deepEqual(integrationPhysicalRead(path),sourceUnionParentRead('registry',path));
 }
});
test('current union preserves the7986 four-source Worker packet, never mixing original contracts/engine',()=>{
 const candidate=financial('candidate'),recovery=financial('recovery'),base=worker4Baseline();
 assert.equal(candidate.sha256,'7986f277660d0b9a3500d7f45a32be247f1d1d7514c1590b5db2956ace2fd596');
 assert.deepEqual(recovery.bytes,base.bytes);
 const different=candidate.payload.files.filter((f,i)=>f.content!==base.payload.files[i].content).map(f=>f.name).sort();
 assert.deepEqual(different,[...CHANGED].sort());assert.equal(different.length,4);
 for(const path of CHANGED)assert.deepEqual(integrationPhysicalRead(path),sourceUnionParentRead('actual',path));
 for(const p of ['src/features/vnext/contracts.ts','src/features/vnext/engine.ts','supabase/functions/_shared/decision-v1-evidence.ts']){
  const payload=candidate.payload.files.find(f=>f.name===p),old=base.payload.files.find(f=>f.name===p);
  if(old){
   assert(payload,'existing Worker dependency must remain present');assert.equal(payload.content,old.content);
   assert.notEqual(payload.content,integrationPhysicalRead(p).toString(),'OriginalObservation changes must not enter the sealed Worker packet');
  }else assert.equal(payload,undefined,'a dependency absent from Worker4 must stay excluded: '+p);
 }
 for(const {path}of SOURCE_UNION_R3_FILES){
  const payload=candidate.payload.files.find(f=>f.name===path),old=base.payload.files.find(f=>f.name===path);
  assert.deepEqual(payload,old,'no R3 PDF/capacity/Master/evaluator source delta enters the sealed Worker packet: '+path);
 }
 for(const {path}of SOURCE_UNION_R4_FILES){
  const payload=candidate.payload.files.find(f=>f.name===path),old=base.payload.files.find(f=>f.name===path);
  assert.deepEqual(payload,old,'R4 loader/metadata deltas never enter the sealed7986 Worker packet: '+path);
 }
 assert.deepEqual(integrationPhysicalRead(CATALOG),sourceUnionParentRead('actual',CATALOG));
 assert.equal(candidate.payload.verify_jwt,true);
});
test('R4 admits current evaluator before the unchanged issuer review can reconstruct its exact R9 view',()=>{
 verifyIntegrationCandidate();
 const path='supabase/functions/_shared/decision-v1-evidence.ts',current=integrationPhysicalRead(path);
 assert.equal(integrationHash(current),SOURCE_UNION_R4_FILES.find(r=>r.path===path).after_sha256);
 assert.equal(integrationHash(integrationHistoricalRead('core',path,current)),'2ef106edc162fb28b7579322dff9b89057b184a2166f51ce57ed31781190d848');
 const injected=Buffer.concat([current,Buffer.from('UNREVIEWED_EVALUATOR')]);
 assert.deepEqual(integrationHistoricalRead('core',path,injected),injected,'historical reflection must not erase injected bytes');
 assert.throws(()=>verifyIntegrationCandidate(p=>p===path?injected:integrationPhysicalRead(p)),/SOURCE_DRIFT/);
 for(const p of ['tests/recommendationIssuerEventReview.test.mjs','research/recommendation-issuer-event-review-candidate.ts'])assert.deepEqual(integrationPhysicalRead(p),sourceUnionParentRead('actual',p));
 const r3=verifyIntegrationCandidate().source_union.r3;assert.equal(r3.base,SOURCE_UNION_R3_BASE);
 assert.equal(r3.evaluator_evidence,'MEMORY_BASIS_CONTROL_AND_FRESH_DB_FIXTURE_NOT_PRODUCTION_ROLE_OR_RAW_PAYLOAD_PROOF');
});
test('current union manifest mode and Actual source drift remain rejected before packaging',()=>{
 const paths=integrationInventory(),p='src/features/vnext/v1ActualCanonical.ts';
 assert.throws(()=>verifyIntegrationCandidate(q=>q===p?Buffer.concat([integrationPhysicalRead(q),Buffer.from('DRIFT')]):integrationPhysicalRead(q),paths),/SOURCE_DRIFT/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths,q=>q===p?'100755':integrationPhysicalMode(q)),/MODE_DRIFT/);
});
test('all original PR284 admission and whole-workflow assertions have verified unchanged prior CI evidence at645 AFTER current admission', {timeout:150000},()=>{
 const r=reuseSourceUnionPinnedProof('actual');assert.equal(r.revision,SOURCE_UNION_PARENTS.actual);assert.equal(r.prior_cleanup_evidence,'VERIFIED_REMOVED_BY_PRIOR_EXECUTION');
});
test('older integration whole-workflow assertions have verified unchanged prior CI evidence at the existing CI965 pin, never over current bytes', {timeout:150000},()=>{
 const r=reuseSourceUnionPinnedProof('historical');assert.equal(r.revision,'965263fe15dc672cac6c61af06bfd14d69044dd3');
 assert.equal(r.prior_cleanup_evidence,'VERIFIED_REMOVED_BY_PRIOR_EXECUTION');
 const workflow=integrationPhysicalRead('.github/workflows/core-member-integration.yml').toString();
 assert(workflow.includes('ref: '+r.revision));assert(workflow.includes('working-directory: build/c-worker-rpc-historical-base'));
});
test('CI keeps current timing/Registry/Actual checks distinct from exact parent packaging and old workflow assertions',()=>{
 const workflow=integrationPhysicalRead('.github/workflows/core-member-integration.yml').toString();
 assert(workflow.includes('tests/vnextForwardCutoffRuntime.test.mjs'));
 assert(workflow.includes('ref: '+SOURCE_UNION_PARENTS.actual));
 assert(workflow.includes('working-directory: build/v1-source-union-pr284'));
 const forward=workflow.split('      - name: Materialize and check the exact forward-cutoff candidate and Worker4 recovery')[1]?.split('      - name:')[0];
 assert(forward,'fixed-parent forward packaging step must exist');
 assert(forward.includes('working-directory: build/v1-source-union-pr284'));
 assert(forward.includes('deno check --no-config --no-lock --no-remote --deny-import --no-npm --node-modules-dir=none build/forward-cutoff-20261020/candidate/supabase/functions/vnext-daily-research-v1/index.ts build/forward-cutoff-20261020/recovery/supabase/functions/vnext-daily-research-v1/index.ts'),'both exact fixed-parent entrypoints require isolated complete typechecking');
 const union=integrationPhysicalRead('.github/workflows/v1-source-integration.yml').toString();
 assert(union.includes('tests/originalIngressAdmission.test.mjs tests/officialPublicAdmission.test.mjs'));
 assert(union.includes('tests/vnextOriginalRegistryIngress.test.mjs'));assert(union.includes('tests/v1ActualCanonical.test.mjs'));
 assert(!union.includes('continue-on-error:'));assert(!union.includes('secrets.'));
});
test('ALL workflow routes forbid current execution of the old forward root/whole-workflow proof',()=>{
 verifyIntegrationCandidate();
 for(const name of readdirSync(new URL('../.github/workflows/',import.meta.url)).filter(n=>n.endsWith('.yml')||n.endsWith('.yaml'))){
  const text=integrationPhysicalRead('.github/workflows/'+name).toString();
  for(const block of text.split(/(?=^      - )/m))if(/run:[\s\S]*tests\/forwardCutoffAdmission\.test\.mjs/.test(block)){
   assert(block.includes('working-directory: build/v1-source-union-pr284'),name+': old proof must not run against current');
   assert(text.includes('ref: '+SOURCE_UNION_PARENTS.actual),name+': packaging pin must be exact645');
  }
 }
 const continuous=integrationPhysicalRead('.github/workflows/continuous-research-lifecycle.yml').toString();
 for(const name of ['continuousLearningCore','continuousLearningTemporal','continuousLearningIntegration','continuousLearningRelease','vnextOutcomeCacheRecovery','vnextContinuousUpdate'])assert(continuous.includes('tests/'+name+'.test.mjs'));
 assert(!continuous.includes('working-directory:'),'these actual current continuous tests must remain current');
});
test('R5 full PR composition adds the old R4 root and three new paths, never a four-file-only seal or Worker grant',()=>{
 const m=verifyIntegrationCandidate(),old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R4));
 const paths=[...new Set([...old.files.map(r=>r.path),FROZEN_SOURCE_UNION_R4,...SOURCE_UNION_R5_FILES.map(r=>r.path)])].sort();
 assert.equal(old.files.length,515);assert.equal(paths.length,519);
 assert.deepEqual(m.files.filter(r=>![FROZEN_SOURCE_UNION_R5,FROZEN_SOURCE_UNION_R6].includes(r.path)).map(r=>r.path),paths);
 assert.deepEqual(integrationInventory(),[...paths,FROZEN_SOURCE_UNION_R5,FROZEN_SOURCE_UNION_R6,INTEGRATION_MANIFEST].sort());
 assert.equal(JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R5)).files.length,519,'R5 complete assertion stays frozen, not rewritten');
 assert.equal(JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R6)).files.length,520,'R6 complete assertion stays frozen, not rewritten');
 const candidate=financial('candidate'),recovery=financial('recovery'),base=worker4Baseline();
 assert.equal(candidate.sha256,'7986f277660d0b9a3500d7f45a32be247f1d1d7514c1590b5db2956ace2fd596');
 assert.deepEqual(recovery.bytes,base.bytes);
 for(const {path}of SOURCE_UNION_R5_FILES)for(const packet of [candidate,recovery,base]){
  assert.equal(packet.payload.files.find(f=>f.name===path),undefined,'R5 source must remain absent from every Worker packet: '+path);
 }
 for(const flag of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[flag],false);
});
test('R5 both CI routes run both new synthetic suites unconditionally AFTER full admission, with no private replay or skip',()=>{
 verifyIntegrationCandidate();
 const suites=['tests/officialDailyOpenDataCandidate.test.mjs','tests/officialDailyLicenseScope.test.mjs'];
 for(const path of ['.github/workflows/v1-source-integration.yml','.github/workflows/core-member-integration.yml']){
  const workflow=integrationPhysicalRead(path).toString();
  const admission=workflow.indexOf('tests/originalIngressAdmission.test.mjs tests/officialPublicAdmission.test.mjs');
  const block=workflow.split(/(?=^      - )/m).find(b=>suites.every(p=>b.includes(p)));
  assert(block,'both synthetic suites must execute together: '+path);
  assert(workflow.indexOf(block)>admission&&admission>=0);assert(block.includes('run: node --experimental-strip-types --test --test-concurrency=1 '+suites.join(' ')));
  assert.doesNotMatch(block,/\bif:|continue-on-error:|secrets\.|--test-skip-pattern|--replay-manifest|\/private\/|realfile/i);
  assert(workflow.includes('contents: read'));assert.doesNotMatch(workflow,/schedule:|contents: write|supabase deploy|supabase db push/);
 }
 for(const path of suites){
  const text=integrationPhysicalRead(path).toString();
  assert.doesNotMatch(text,/\btest\.skip\b|\bskip\s*:|\bprocess\.env\b|existsSync\(|\/private\/|realfile/i);
 }
});
test('R5 CI pins Deno2.9.2 and fully type-checks the exact research source offline after admission',()=>{
 verifyIntegrationCandidate();
 const workflow=integrationPhysicalRead('.github/workflows/v1-source-integration.yml').toString();
 const current=workflow.split('  current-union:')[1]?.split('  r3-evaluator-fresh-db:')[0];assert(current);
 const gate=current.indexOf('tests/originalIngressAdmission.test.mjs tests/officialPublicAdmission.test.mjs');
 const synthetic=current.indexOf('tests/officialDailyOpenDataCandidate.test.mjs tests/officialDailyLicenseScope.test.mjs');
 const setup=current.indexOf('uses: denoland/setup-deno@v2');
 const command='run: deno check --no-config --no-lock --no-remote --deny-import --no-npm --node-modules-dir=none --sloppy-imports research/official-daily-open-data-candidate.ts';
 const check=current.indexOf(command);
 assert(gate>=0&&synthetic>gate&&setup>synthetic&&check>setup);
 assert.match(current,/uses: denoland\/setup-deno@v2\n        with:\n          deno-version: v2\.9\.2\n/);
 const block=current.split(/(?=^      - )/m).find(b=>b.includes(command));assert(block);
 assert.doesNotMatch(block,/\bif:|continue-on-error:|--no-check|--allow-|secrets\./);
 assert.deepEqual(integrationPhysicalRead('src/features/vnext/contracts.ts'),sourceUnionParentRead('registry','src/features/vnext/contracts.ts'));
});
