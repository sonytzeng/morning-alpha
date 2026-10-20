// Current union admission is mandatory; the original assertions run at 1db.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 INTEGRATION_MANIFEST,SOURCE_UNION_PARENTS,SOURCE_UNION_SUPPORT,REGISTRY_SUPPORT_PARENT,REGISTRY_SUPPORT_PATHS,
 integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash,
 createSourceUnionComposition,verifyIntegrationCandidate,sourceUnionLineage,sourceUnionParentRead,verifySourceUnionPinnedProof,
} from './helpers/integrationAdmission.mjs';
const flags=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
test('one complete physical current union pins actual645 and registry1db, never mutable worktrees',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(createSourceUnionComposition(),m);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261020-v1-source-union.json');
 assert.deepEqual(SOURCE_UNION_PARENTS,{actual:'64565b5e44568c5c653bd2007992d482df36e60f',registry:'1db13616337633d4765db4650dd27f5dc68c0bd6'});
 assert.equal(REGISTRY_SUPPORT_PARENT,'d74a25d803b6fe6a7dc9e21cef06c3e1306ec559');
 assert.deepEqual(m.source_union,sourceUnionLineage());
 assert.equal(REGISTRY_SUPPORT_PATHS.length,6);assert.equal(new Set(m.files.map(r=>r.path)).size,m.files.length);
 for(const flag of flags)assert.equal(m[flag],false);
 assert.equal(m.source_union.source_authorities_shared,false);assert.equal(m.source_union.member_gate_changed,false);
});
function fixture(){
 const bytes=new Map(),modes=new Map(),paths=integrationInventory(),manifest=JSON.parse(integrationPhysicalRead(INTEGRATION_MANIFEST));
 const read=p=>Buffer.from(bytes.get(p)??integrationPhysicalRead(p));
 const mode=p=>modes.get(p)??integrationPhysicalMode(p);
 const reseal=()=>bytes.set(INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(manifest)));
 return {bytes,modes,paths,manifest,read,mode,reseal,verify:()=>verifyIntegrationCandidate(read,paths,mode)};
}
test('all support paths are exact, and every inherited Runtime/SQL/catalogue refuses even after root rehash',()=>{
 assert.deepEqual(SOURCE_UNION_SUPPORT,[
  '.github/workflows/core-member-integration.yml','.github/workflows/v1-source-integration.yml',
  'tests/helpers/integrationAdmission.mjs','tests/officialPublicAdmission.test.mjs','tests/originalIngressAdmission.test.mjs',
 ]);
 for(const path of ['src/features/vnext/contracts.ts','src/features/vnext/engine.ts','src/features/vnext/dailyRuntime.ts',
  'src/features/vnext/originalRegistryIngress.ts','src/features/vnext/originalRegistryIngress.candidate.sql',
  'src/features/vnext/v1ActualCanonical.ts','supabase/migrations/20261020070000_v1_actual_canonical_candidate.sql',
  'supabase/migrations/20261019123345_original_observation_ingress_candidate_v1.sql',
  'scripts/operations/financial-response-period-20261020/release-catalog.json']){
  const f=fixture();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('UNREVIEWED')]));
  const row=f.manifest.files.find(r=>r.path===path);if(row)row.after_sha256=integrationHash(f.read(path));f.reseal();
  assert.throws(f.verify,/SOURCE_DRIFT/,'rehashing must not admit '+path);
  assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('current-source drift, deleted/unknown inventory, warm reader and executable mode never cache PASS',()=>{
 const f=fixture(),p='src/features/vnext/originalIngress.ts';f.verify();
 f.bytes.set(p,Buffer.concat([f.read(p),Buffer.from('DRIFT')]));assert.throws(f.verify,/SOURCE_DRIFT/);
 f.bytes.delete(p);f.verify();f.modes.set(p,'100755');assert.throws(f.verify,/MODE_DRIFT/);
 f.modes.delete(p);f.paths.push('UNREVIEWED_FILE');assert.throws(f.verify,/UNKNOWN_PATH/);
 f.paths.pop();f.paths.splice(f.paths.indexOf(p),1);assert.throws(f.verify,/UNKNOWN_PATH/);
 assert.throws(()=>verifyIntegrationCandidate(p=>{if(p==='src/features/vnext/engine.ts')throw Error('REMOVED_SOURCE');return integrationPhysicalRead(p);}),/REMOVED_SOURCE/);
 verifyIntegrationCandidate();
});
test('both parent receipt generations, source identities and ALL authorization flags remain independently pinned',()=>{
 for(const p of ['docs/operations/evidence/core-member-integration-20261020-registry-ingress.json',
  'docs/operations/evidence/core-member-integration-20261020-v1-actual-canonical.json',
  'docs/operations/evidence/core-member-integration-20261019-original-ingress.json']){
  const f=fixture();f.bytes.set(p,Buffer.concat([f.read(p),Buffer.from('\n')]));
  const row=f.manifest.files.find(r=>r.path===p);row.after_sha256=integrationHash(f.read(p));f.reseal();assert.throws(f.verify,/DRIFT/);
 }
 for(const flag of flags){const f=fixture();f.manifest[flag]=true;f.reseal();assert.throws(f.verify,/FORBIDDEN/);}
 for(const change of [m=>m.source_union.parents.registry=REGISTRY_SUPPORT_PARENT,m=>m.source_union.source_authorities_shared=true,
  m=>m.source_union.member_gate_changed=true,m=>m.source_union.registry_support.paths.pop(),
  m=>m.source_union.historical_proof.revision='HEAD',m=>m.files.pop()]){
  const f=fixture();change(f.manifest);f.reseal();assert.throws(f.verify);
 }
 assert.throws(()=>sourceUnionParentRead('HEAD','src/features/vnext/contracts.ts'),/UNKNOWN_PARENT/);
});
test('the six CI support updates stay at 1db, including image preparation; no freeze-back to d74',()=>{
 for(const p of REGISTRY_SUPPORT_PATHS)assert.deepEqual(integrationPhysicalRead(p),sourceUnionParentRead('registry',p),p);
 const workflow=integrationPhysicalRead('.github/workflows/original-observation-ingress.yml').toString();
 assert(workflow.includes('Prepare the existing isolated PostgreSQL clock image'));
 assert(workflow.includes('tests/fixtures/runtime-sparse-postgres.Dockerfile'));
 assert(!workflow.includes('continue-on-error:'));assert(!workflow.includes('secrets.'));
});
test('all original Registry admission assertions execute unchanged at exact1db AFTER current admission', {timeout:150000},()=>{
 const r=verifySourceUnionPinnedProof('registry');assert.equal(r.revision,SOURCE_UNION_PARENTS.registry);
 assert.equal(r.cleanup,'VERIFIED_REMOVED');
});
