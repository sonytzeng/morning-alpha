import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
 INTEGRATION_MANIFEST,CURRENT_INTEGRATION_MANIFEST,INTEGRATION_BASE,RUNTIME_INTEGRITY_FILES,SOURCE_UNION_SUPPORT,
 integrationInventory,integrationScope,integrationPhysicalRead,integrationPhysicalMode,integrationHash,
 createSourceUnionComposition,verifyIntegrationCandidate,sourceUnionLineage,
} from './helpers/integrationAdmission.mjs';
import {
 REVIEWED_SUCCESSOR_BASE,REVIEWED_SUCCESSOR_HEAD,REVIEWED_SUCCESSOR_CATALOG,
 REVIEWED_SUCCESSOR_CATALOG_SHA256,REVIEWED_SUCCESSOR_SUPPORT,reviewedSuccessorLineage,
} from './helpers/reviewedSourceSuccessor.mjs';
const root=new URL('../',import.meta.url);
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root});
function fixture(){
 const bytes=new Map(),modes=new Map(),paths=integrationInventory(),manifest=JSON.parse(integrationPhysicalRead(CURRENT_INTEGRATION_MANIFEST));
 const read=p=>bytes.has(p)?bytes.get(p):integrationPhysicalRead(p);
 const mode=p=>modes.get(p)??integrationPhysicalMode(p);
 const reseal=()=>bytes.set(CURRENT_INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(manifest)));
 const mirror=p=>{const row=manifest.files.find(r=>r.path===p);assert(row);row.after_sha256=integrationHash(read(p));reseal();};
 return {bytes,modes,paths,manifest,read,mode,reseal,mirror,verify:()=>verifyIntegrationCandidate(read,paths,mode)};
}
test('successor admits the complete Git delta and preserves the immutable prior terminal and lineage',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(createSourceUnionComposition(),m);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261022-runtime-integrity.json');
 assert.equal(CURRENT_INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261103-current-source.json');
 assert.deepEqual(m.files.map(r=>r.path),integrationScope());
 assert.deepEqual(integrationInventory(),[...integrationScope(),CURRENT_INTEGRATION_MANIFEST].sort());
 // The old terminal remains immutable with all 865 rows. Current source has
 // an additional exact Git delta, whose live negative controls run separately.
 const previous=JSON.parse(git(['show','da0e07dd23aee62f31cd669d0d090d948e6d1171:docs/operations/evidence/core-member-integration-20261102-reviewed-successor.json']));
 assert.equal(previous.files.length,865);assert.equal(m.files.length,902);assert.equal(integrationInventory().length,903);
 assert.equal(integrationHash(integrationPhysicalRead(INTEGRATION_MANIFEST)),'554e96d7d84995d8bc19091bbfa7e2dfb152fec6980d32502e963f4b860c199e');
 assert.deepEqual(integrationPhysicalRead(INTEGRATION_MANIFEST),git(['show',REVIEWED_SUCCESSOR_BASE+':'+INTEGRATION_MANIFEST]));
 const old=JSON.parse(integrationPhysicalRead(INTEGRATION_MANIFEST)),lineage=sourceUnionLineage();
 delete lineage.reviewed_successor;assert.deepEqual(old.source_union,lineage);
 assert.equal(old.files.length,586);assert.equal(RUNTIME_INTEGRITY_FILES.length,86);
 const successor=reviewedSuccessorLineage();assert.equal(successor.complete_git_delta,286);
 assert.deepEqual(REVIEWED_SUCCESSOR_SUPPORT,['tests/helpers/reviewedSourceSuccessor.mjs','tests/reviewedSourceSuccessor.test.mjs']);
 assert.deepEqual(successor.legacy_harness_support_paths,[...SOURCE_UNION_SUPPORT]);
 assert.equal(successor.harness_trust_root,'EXISTING_TRUSTED_VERIFIER_NOT_SELF_SEALED_GIT_OBJECT');
 assert.deepEqual(successor.before_composition,{sealed:17,baseline:22,added:247});
 assert.equal(successor.base,REVIEWED_SUCCESSOR_BASE);assert.equal(successor.head,REVIEWED_SUCCESSOR_HEAD);
 assert.equal(successor.local_patch.files.length,25);
 assert.equal(successor.catalog.sha256,REVIEWED_SUCCESSOR_CATALOG_SHA256);
 for(const flag of ['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'])assert.equal(successor[flag],false);
});
test('every immutable and separately reviewed local source after-image rejects tampering with a mirrored terminal hash',()=>{
 const catalog=JSON.parse(integrationPhysicalRead(REVIEWED_SUCCESSOR_CATALOG));
 for(const row of [...new Map([...catalog.files,...catalog.local_patch.files].map(row=>[row.path,row])).values()]){
  const f=fixture();f.bytes.set(row.path,Buffer.concat([Buffer.from(f.read(row.path)),Buffer.from('\nUNREVIEWED')]));f.mirror(row.path);
  assert.throws(f.verify,/SOURCE_DRIFT/,'tamper '+row.path);
 }
});
test('new verifier support bytes refuse terminal co-mutation and remain an exact two-path extension',()=>{
 for(const path of REVIEWED_SUCCESSOR_SUPPORT){
  const f=fixture();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\nUNREVIEWED_SUPPORT')]));f.mirror(path);
  assert.throws(f.verify,/SUCCESSOR_SUPPORT_SOURCE_DRIFT/);
 }
 const f=fixture();f.manifest.source_union.reviewed_successor.support_paths.push('tests/unreviewed-support.mjs');f.reseal();
 assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);
});
test('catalog and source co-mutation cannot turn a live snapshot into immutable Git authority',()=>{
 const f=fixture(),catalog=JSON.parse(f.read(REVIEWED_SUCCESSOR_CATALOG));
 const row=catalog.files.find(r=>r.path==='src/features/vnext/dailyRuntime.ts');
 f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nFORGED')]));row.after_sha256=integrationHash(f.read(row.path));
 f.bytes.set(REVIEWED_SUCCESSOR_CATALOG,Buffer.from(JSON.stringify(catalog)));f.mirror(row.path);f.mirror(REVIEWED_SUCCESSOR_CATALOG);
 f.manifest.source_union.reviewed_successor.catalog.sha256=integrationHash(f.read(REVIEWED_SUCCESSOR_CATALOG));f.reseal();
 assert.throws(f.verify,/SUCCESSOR_CATALOG_DRIFT/);
});
test('successor rejects executable/symlink modes, missing source and incomplete or unknown inventory',()=>{
 const catalog=JSON.parse(integrationPhysicalRead(REVIEWED_SUCCESSOR_CATALOG));
 for(const path of new Set([catalog.files[0].path,'src/features/vnext/dailyRuntime.ts',...catalog.local_patch.files.map(row=>row.path),REVIEWED_SUCCESSOR_CATALOG,...REVIEWED_SUCCESSOR_SUPPORT,INTEGRATION_MANIFEST,CURRENT_INTEGRATION_MANIFEST])){
  for(const mode of ['100755','120000']){const f=fixture();f.modes.set(path,mode);assert.throws(f.verify,/MODE/,'mode '+path);}
  const missing=fixture();missing.bytes.set(path,undefined);assert.throws(missing.verify,undefined,'missing '+path);
 }
 const f=fixture();f.paths.push('research/unreviewed-source.ts');assert.throws(f.verify,/INTEGRATION_UNKNOWN_PATH/);
 const g=fixture();g.paths.splice(g.paths.indexOf(catalog.files[0].path),1);assert.throws(g.verify,/INTEGRATION_UNKNOWN_PATH/);
});
test('all source and operational authority flags remain false and forged lineage is refused',()=>{
 for(const flag of ['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed']){
  const f=fixture();f.manifest.source_union.reviewed_successor[flag]=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);
 }
 for(const flag of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled']){
  const f=fixture();f.manifest[flag]=true;f.reseal();assert.throws(f.verify,/INTEGRATION_FORBIDDEN/);
 }
 const f=fixture();f.manifest.base=REVIEWED_SUCCESSOR_HEAD;f.reseal();assert.throws(f.verify);
 const g=fixture();g.manifest.source_union.reviewed_successor.head=INTEGRATION_BASE;g.reseal();assert.throws(g.verify,/UNION_LINEAGE_DRIFT/);
});
