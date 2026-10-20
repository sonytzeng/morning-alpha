// Existing PR284 assertions are immutable; current union is separately admitted.
import test from 'node:test';import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {
 verifyIntegrationCandidate,createSourceUnionComposition,sourceUnionParentRead,verifySourceUnionPinnedProof,SOURCE_UNION_PARENTS,
 integrationPhysicalRead,integrationPhysicalMode,integrationInventory,
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
 for(const p of ['src/features/vnext/contracts.ts','src/features/vnext/engine.ts']){
  const payload=candidate.payload.files.find(f=>f.name===p),old=base.payload.files.find(f=>f.name===p);
  if(old){
   assert(payload,'existing Worker dependency must remain present');assert.equal(payload.content,old.content);
   assert.notEqual(payload.content,integrationPhysicalRead(p).toString(),'OriginalObservation changes must not enter the sealed Worker packet');
  }else assert.equal(payload,undefined,'a dependency absent from Worker4 must stay excluded: '+p);
 }
 assert.deepEqual(integrationPhysicalRead(CATALOG),sourceUnionParentRead('actual',CATALOG));
 assert.equal(candidate.payload.verify_jwt,true);
});
test('current union manifest mode and Actual source drift remain rejected before packaging',()=>{
 const paths=integrationInventory(),p='src/features/vnext/v1ActualCanonical.ts';
 assert.throws(()=>verifyIntegrationCandidate(q=>q===p?Buffer.concat([integrationPhysicalRead(q),Buffer.from('DRIFT')]):integrationPhysicalRead(q),paths),/SOURCE_DRIFT/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths,q=>q===p?'100755':integrationPhysicalMode(q)),/MODE_DRIFT/);
});
test('all original PR284 admission and whole-workflow assertions execute unchanged at645 AFTER current admission', {timeout:150000},()=>{
 const r=verifySourceUnionPinnedProof('actual');assert.equal(r.revision,SOURCE_UNION_PARENTS.actual);assert.equal(r.cleanup,'VERIFIED_REMOVED');
});
test('older integration whole-workflow assertions run unchanged at the existing CI965 pin, never over current bytes', {timeout:150000},()=>{
 const r=verifySourceUnionPinnedProof('historical');assert.equal(r.revision,'965263fe15dc672cac6c61af06bfd14d69044dd3');
 assert.equal(r.cleanup,'VERIFIED_REMOVED');
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
