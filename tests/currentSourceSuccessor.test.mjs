import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {integrationPhysicalRead as physical,integrationPhysicalMode as physicalMode,integrationInventory,integrationHash,verifyIntegrationCandidate,CURRENT_INTEGRATION_MANIFEST,sourceUnionLineage} from './helpers/integrationAdmission.mjs';
import {CURRENT_SOURCE_BASE,CURRENT_SOURCE_HEAD,CURRENT_SOURCE_CATALOG,CURRENT_SOURCE_CATALOG_SHA256,CURRENT_SOURCE_SUPPORT,currentSourceDefinition,currentSourceHash,currentSourcePriorPatch} from './helpers/currentSourceCatalog.mjs';
import {reviewedSuccessorPaths} from './helpers/currentSourceSuccessor.mjs';
const readJson=p=>JSON.parse(physical(p));
function fixture(){
 const bytes=new Map(),modes=new Map(),paths=integrationInventory(),manifest=readJson(CURRENT_INTEGRATION_MANIFEST);
 const read=p=>bytes.has(p)?bytes.get(p):physical(p),mode=p=>modes.get(p)??physicalMode(p);
 const reseal=()=>bytes.set(CURRENT_INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(manifest)));
 const mirror=p=>{const row=manifest.files.find(r=>r.path===p);assert(row);row.after_sha256=integrationHash(read(p));reseal();};
 return {bytes,modes,paths,manifest,read,mode,reseal,mirror,verify:()=>verifyIntegrationCandidate(read,paths,mode)};
}
test('current composition appends all 48 immutable Git changes and preserves the prior terminal verbatim',()=>{
 const m=verifyIntegrationCandidate(),c=currentSourceDefinition(),lineage=sourceUnionLineage().reviewed_successor.current_git_successor;
 assert.equal(c.files.length,48);assert.equal(c.base,CURRENT_SOURCE_BASE);assert.equal(c.head,CURRENT_SOURCE_HEAD);
 assert.equal(integrationHash(physical(CURRENT_SOURCE_CATALOG)),CURRENT_SOURCE_CATALOG_SHA256);
 assert.equal(lineage.exact_git_delta,48);assert.equal(lineage.scope_review.independent_review,false);
 const before=execFileSync('git',['--no-replace-objects','show',CURRENT_SOURCE_BASE+':'+c.prior_manifest.path]);
 assert.deepEqual(physical(c.prior_manifest.path),before);assert.equal(JSON.parse(before).files.length,865);assert.equal(m.files.length,903);
 assert.equal(currentSourceHash('research/entry-opportunity.ts'),'49253f89038cdf67fd56819bb49e3bcf0fcd916de99f11c8bbb342e720ddaac9');
 for(const row of c.files)assert.equal(integrationHash(physical(row.path)),row.after.sha256);
});
test('every newly admitted source rejects a changed live body even after terminal hashes are mirrored',()=>{
 const c=currentSourceDefinition();
 for(const row of [...c.files,...c.local_support_patch]){const f=fixture();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_CURRENT_SOURCE')]));f.mirror(row.path);assert.throws(f.verify,/SOURCE_DRIFT/,'live '+row.path);}
});
test('CI patch keeps every previous control and only appends both successor test suites',()=>{
 const c=currentSourceDefinition(),patch=c.local_support_patch[0];assert.equal(c.local_support_patch.length,7);
 const before=execFileSync('git',['--no-replace-objects','cat-file','blob',patch.before.oid]).toString(),after=physical(patch.path).toString();
 assert.equal(after.replace(' tests/currentSourceSuccessor.test.mjs tests/reviewedSourceSuccessor.test.mjs',''),before);
 assert.equal(integrationHash(physical(patch.path)),patch.after.sha256);
 assert.equal(currentSourceHash(patch.path),patch.after.sha256);
});
test('Core CI retains all five ff88 proofs and runs all three later suites on the current tree',()=>{
 const workflow=physical('.github/workflows/core-member-integration.yml').toString();
 const block=name=>workflow.split('      - name: '+name+'\n')[1]?.split('      - name:')[0];
 const current=block('Current Owner publication replay and completed research controls');assert(current);assert.doesNotMatch(current,/working-directory:|\bif:|continue-on-error:|--test-skip-pattern/);
 for(const path of ['tests/ownerLegacyPublication.test.mjs','tests/completedResearch.test.mjs','tests/entryCompletedSession.test.mjs'])assert(current.includes(path));
 const replay=physical('tests/ownerLegacyPublication.test.mjs').toString();assert(replay.includes("verifySourceUnionPinnedProof('owner_copy')"));assert(replay.includes('ff88a4ed7ce10116a6fad84110770953941fcd08'));assert(replay.includes('result.tests_run,result.tests_passed'));assert(replay.includes('VERIFIED_REMOVED'));
 for(const path of ['tests/ownerStatusCopyAdmission.test.mjs','tests/frontendTypeClosureAdmission.test.mjs','tests/researchSourceContracts.test.mjs','tests/ownerReleaseReviewPackage.test.mjs','tests/r9FunctionalSourceClosure.test.mjs']){
  assert(execFileSync('git',['--no-replace-objects','show','ff88a4ed7ce10116a6fad84110770953941fcd08:'+path]).length>0);
 }
});
test('catalog, source and manifest co-mutation cannot create a new Git successor authority',()=>{
 const f=fixture(),c=readJson(CURRENT_SOURCE_CATALOG),row=c.files.find(r=>r.path==='research/entry-opportunity.ts');
 f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nFORGED')]));row.after.sha256=integrationHash(f.read(row.path));
 f.bytes.set(CURRENT_SOURCE_CATALOG,Buffer.from(JSON.stringify(c)));f.mirror(row.path);f.mirror(CURRENT_SOURCE_CATALOG);
 f.manifest.source_union.reviewed_successor.current_git_successor.catalog.sha256=integrationHash(f.read(CURRENT_SOURCE_CATALOG));f.reseal();
 assert.throws(f.verify,/CURRENT_SOURCE_CATALOG_DRIFT/);
});
test('support bytes, missing data, executable modes and unknown or omitted paths all remain closed',()=>{
 for(const p of CURRENT_SOURCE_SUPPORT){const f=fixture();f.bytes.set(p,Buffer.concat([f.read(p),Buffer.from('\nFORGED_SUPPORT')]));f.mirror(p);assert.throws(f.verify,/SUPPORT_SOURCE_DRIFT/);}
 for(const p of [CURRENT_SOURCE_CATALOG,...CURRENT_SOURCE_SUPPORT,currentSourceDefinition().prior_manifest.path,...currentSourceDefinition().files.map(r=>r.path),...currentSourceDefinition().local_support_patch.map(r=>r.path)]){
  for(const mode of ['100755','120000']){const f=fixture();f.modes.set(p,mode);assert.throws(f.verify,/MODE/,'mode '+p);}
 }
 const absent=fixture();absent.bytes.set('src/features/vnext/ownerDailyResearch.ts',undefined);assert.throws(absent.verify);
 const extra=fixture();extra.paths.push('research/unreviewed-candidate.ts');assert.throws(extra.verify,/INTEGRATION_UNKNOWN_PATH/);
 const missing=fixture();missing.paths.splice(missing.paths.indexOf('src/features/vnext/ownerDailyResearch.ts'),1);assert.throws(missing.verify,/INTEGRATION_UNKNOWN_PATH/);
});
test('an initial PASS caches no current-source acceptance and immutable catalog metadata cannot be poisoned',()=>{
 const f=fixture();f.verify();const p='src/features/vnext/dailyRuntime.ts';f.bytes.set(p,Buffer.concat([f.read(p),Buffer.from('\nLATE_MUTATION')]));f.mirror(p);assert.throws(f.verify,/INTEGRATION_SOURCE_DRIFT:src\/features\/vnext\/dailyRuntime\.ts/);
 const c=currentSourceDefinition();assert.throws(()=>{c.files[0].after.sha256='0'.repeat(64);},TypeError);
 assert.equal(currentSourceHash('research/entry-opportunity.ts'),'49253f89038cdf67fd56819bb49e3bcf0fcd916de99f11c8bbb342e720ddaac9');
 const paths=reviewedSuccessorPaths();paths.fill('UNREVIEWED_PATH');assert(!reviewedSuccessorPaths().includes('UNREVIEWED_PATH'));
 const patch=c.local_support_patch[0],copy=currentSourcePriorPatch(patch.path);copy.fill(0);
 assert.equal(integrationHash(currentSourcePriorPatch(patch.path)),patch.before.sha256);
});
test('source identity never grants financial, publication, production or threshold authority',()=>{
 for(const flag of Object.keys(currentSourceDefinition().authority)){
  const f=fixture();f.manifest.source_union.reviewed_successor.current_git_successor[flag]=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);
 }
});
