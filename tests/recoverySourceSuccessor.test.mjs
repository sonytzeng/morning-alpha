import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {integrationPhysicalRead as physical,integrationPhysicalMode as physicalMode,integrationInventory,integrationHash,verifyIntegrationCandidate,createSourceUnionComposition,CURRENT_INTEGRATION_MANIFEST,INTEGRATION_MANIFEST,sourceUnionLineage} from './helpers/integrationAdmission.mjs';
import {CURRENT_SOURCE_MANIFEST,CURRENT_SOURCE_CATALOG} from './helpers/currentSourceCatalog.mjs';
import {RECOVERY_SOURCE_BASE,RECOVERY_SOURCE_HEAD,RECOVERY_SOURCE_CATALOG,RECOVERY_SOURCE_CATALOG_SHA256,RECOVERY_SOURCE_MANIFEST,RECOVERY_SOURCE_SUPPORT,recoverySourceDefinition,recoverySourceHash,recoverySourcePriorPatch} from './helpers/recoverySourceCatalog.mjs';
import {reviewedSuccessorPaths as recoveryReviewedSuccessorPaths,readRecoveryRegularFile} from './helpers/recoverySourceSuccessor.mjs';
import {reviewedSuccessorPaths,recoveryPriorRead,ciShardPriorRead} from './helpers/ciShardSourceSuccessor.mjs';
import {CI_SHARD_SOURCE_MANIFEST} from './helpers/ciShardSourceCatalog.mjs';
const root=new URL('../',import.meta.url),git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root});
const readJson=p=>JSON.parse(physical(p));
function fixture(){
 const bytes=new Map(),modes=new Map(),paths=integrationInventory(),manifest=readJson(CURRENT_INTEGRATION_MANIFEST);
 const read=p=>bytes.has(p)?bytes.get(p):physical(p),mode=p=>modes.get(p)??physicalMode(p);
 const reseal=()=>bytes.set(CURRENT_INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(manifest)));
 const mirror=p=>{const row=manifest.files.find(r=>r.path===p);assert(row);row.after_sha256=integrationHash(read(p));reseal();};
 return {bytes,modes,paths,manifest,read,mode,reseal,mirror,verify:()=>verifyIntegrationCandidate(read,paths,mode)};
}
test('recovery appends the exact sixteen-file committed delta after the unchanged 903-file predecessor',()=>{
 const live=verifyIntegrationCandidate(),m=readJson(RECOVERY_SOURCE_MANIFEST),c=recoverySourceDefinition();assert.deepEqual(createSourceUnionComposition(),live);
 assert.equal(RECOVERY_SOURCE_MANIFEST,'docs/operations/evidence/core-member-integration-20261105-recovery-source.json');assert.equal(CURRENT_INTEGRATION_MANIFEST,CI_SHARD_SOURCE_MANIFEST);assert.equal(c.base,RECOVERY_SOURCE_BASE);assert.equal(c.head,RECOVERY_SOURCE_HEAD);assert.equal(c.files.length,16);
 assert.deepEqual(physical(CURRENT_SOURCE_MANIFEST),git(['show',RECOVERY_SOURCE_BASE+':'+CURRENT_SOURCE_MANIFEST]));assert.equal(readJson(CURRENT_SOURCE_MANIFEST).files.length,903);
 assert.deepEqual(physical(CURRENT_SOURCE_CATALOG),git(['show',RECOVERY_SOURCE_BASE+':'+CURRENT_SOURCE_CATALOG]));
 const additions=c.files.filter(r=>r.before===null).length,priorInventory=[...new Set([...readJson(INTEGRATION_MANIFEST).files.map(r=>r.path),...recoveryReviewedSuccessorPaths()])].sort();
 assert.equal(c.local_fixture.length,27);assert.equal(m.files.length,903+additions+2+RECOVERY_SOURCE_SUPPORT.length+c.local_fixture.length);assert.equal(priorInventory.length+1,m.files.length+1);assert.deepEqual(priorInventory,m.files.map(r=>r.path));assert.equal(integrationInventory().length,live.files.length+1);
 assert.equal(integrationHash(physical(RECOVERY_SOURCE_CATALOG)),RECOVERY_SOURCE_CATALOG_SHA256);
 const lineage=sourceUnionLineage().reviewed_successor.recovery_git_successor;assert.equal(lineage.exact_git_delta,16);assert.equal(lineage.scope_review.independent_review,false);
 for(const row of c.files)assert.equal(integrationHash(ciShardPriorRead(row.path,physical(row.path))),row.after.sha256);
});
test('every recovery source and support patch rejects a mirrored live-body mutation',()=>{
 for(const row of [...recoverySourceDefinition().files,...recoverySourceDefinition().local_support_patch]){
  const f=fixture();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_RECOVERY_SOURCE')]));f.mirror(row.path);assert.throws(f.verify,/SOURCE_DRIFT/,row.path);
 }
 for(const row of recoverySourceDefinition().local_fixture){const f=fixture();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nFORGED_SQL_FIXTURE')]));f.mirror(row.path);assert.throws(f.verify,/SOURCE_DRIFT/,row.path);}
});
test('catalog, new source and terminal receipt co-mutation cannot authorize a different Git delta',()=>{
 const f=fixture(),c=readJson(RECOVERY_SOURCE_CATALOG),row=c.files.find(r=>r.path==='src/features/vnext/dailyRuntime.ts');
 f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nFORGED_RECOVERY')]));row.after.sha256=integrationHash(f.read(row.path));
 f.bytes.set(RECOVERY_SOURCE_CATALOG,Buffer.from(JSON.stringify(c)));f.mirror(row.path);f.mirror(RECOVERY_SOURCE_CATALOG);
 f.manifest.source_union.reviewed_successor.recovery_git_successor.catalog.sha256=integrationHash(f.read(RECOVERY_SOURCE_CATALOG));f.reseal();
 assert.throws(f.verify,/RECOVERY_SOURCE_CATALOG_DRIFT/);
});
test('current verifier support rejects tampering even when all generated file hashes are mirrored',()=>{
 for(const path of RECOVERY_SOURCE_SUPPORT){const f=fixture();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\nFORGED_VERIFIER')]));f.mirror(path);assert.throws(f.verify,/SUPPORT_SOURCE_DRIFT/,path);}
});
test('physical source reader refuses both file and ancestor symlinks with exact temporary cleanup',()=>{
 const folder=mkdtempSync(join(tmpdir(),'ma-recovery-regular-'));try{
  mkdirSync(join(folder,'real'));writeFileSync(join(folder,'real','source.mjs'),'SYNTHETIC_SOURCE');
  symlinkSync(join(folder,'real','source.mjs'),join(folder,'file-link.mjs'));symlinkSync(join(folder,'real'),join(folder,'parent-link'));
  const base=pathToFileURL(folder+'/');assert.equal(readRecoveryRegularFile('real/source.mjs',base).toString(),'SYNTHETIC_SOURCE');
  for(const path of ['file-link.mjs','parent-link/source.mjs'])assert.throws(()=>readRecoveryRegularFile(path,base),/RECOVERY_SOURCE_REGULAR_FILE/);
  for(const path of ['../source.mjs','/absolute','real//source.mjs','real/./source.mjs'])assert.throws(()=>readRecoveryRegularFile(path,base),/RECOVERY_SOURCE_PATH/);
 }finally{rmSync(folder,{recursive:true,force:true});assert(!existsSync(folder));}
});
test('all predecessor receipts, source modes, missing and unknown paths remain protected',()=>{
 const c=recoverySourceDefinition();
 for(const path of [RECOVERY_SOURCE_CATALOG,...RECOVERY_SOURCE_SUPPORT,c.prior_manifest.path,...c.files.map(r=>r.path),...c.local_support_patch.map(r=>r.path),...c.local_fixture.map(r=>r.path)]){
  for(const mode of ['100755','120000']){const f=fixture();f.modes.set(path,mode);assert.throws(f.verify,/MODE/,path+':'+mode);}
 }
 const prior=fixture();prior.bytes.set(c.prior_manifest.path,Buffer.concat([prior.read(c.prior_manifest.path),Buffer.from('\n')]));prior.mirror(c.prior_manifest.path);assert.throws(prior.verify,/PRIOR_MANIFEST_DRIFT/);
 const missing=fixture();missing.paths.splice(missing.paths.indexOf('tests/vnextRevenueFallback.test.mjs'),1);assert.throws(missing.verify,/INTEGRATION_UNKNOWN_PATH/);
 const extra=fixture();extra.paths.push('research/unreviewed-recovery.ts');assert.throws(extra.verify,/INTEGRATION_UNKNOWN_PATH/);
 const absent=fixture();absent.bytes.set('src/features/vnext/dailyRuntime.ts',undefined);assert.throws(absent.verify);
});
test('prior-byte reflection is exact, cannot erase injected bytes, and immutable metadata returns owned copies',()=>{
 verifyIntegrationCandidate();const path='src/features/vnext/dailyRuntime.ts',current=ciShardPriorRead(path,physical(path)),c=recoverySourceDefinition(),row=c.files.find(r=>r.path===path);
 assert.equal(integrationHash(recoveryPriorRead(path,current)),row.before.sha256);assert.equal(recoverySourceHash(path),row.after.sha256);
 const injected=Buffer.concat([current,Buffer.from('\nINJECTED_AFTER_ADMISSION')]);assert.deepEqual(recoveryPriorRead(path,injected),injected);
 assert.equal(recoveryPriorRead(path,'\ud800'),'\ud800');assert.equal(recoveryPriorRead('unknown/path',injected),injected);
 const copy=recoverySourcePriorPatch(path);copy.fill(0);assert.equal(integrationHash(recoverySourcePriorPatch(path)),row.before.sha256);
 assert.throws(()=>{c.files[0].after.sha256='0'.repeat(64);},TypeError);
 const paths=reviewedSuccessorPaths();paths.fill('POISON');assert(!reviewedSuccessorPaths().includes('POISON'));
 const f=fixture();f.verify();f.bytes.set(path,injected);f.mirror(path);assert.throws(f.verify,/INTEGRATION_SOURCE_DRIFT/);
});
test('workflow preserves all prior source commands and appends real recovery regressions without weakening limits',()=>{
 verifyIntegrationCandidate();const row=recoverySourceDefinition().local_support_patch[0],after=ciShardPriorRead(row.path,physical(row.path)).toString();
 let restored=after;for(const edit of [...row.exact_edits].reverse()){assert.equal(restored.split(edit.after).length,2);restored=restored.replace(edit.after,edit.before);}
 assert.deepEqual(Buffer.from(restored),git(['show',RECOVERY_SOURCE_BASE+':'+row.path]));
 assert.match(after,/--max-old-space-size=512/);assert.match(after,/timeout-minutes: 45/);
 for(const path of ['tests/currentSourceSuccessor.test.mjs','tests/reviewedSourceSuccessor.test.mjs','tests/recoverySourceSuccessor.test.mjs','tests/vnextProviderRetryAfter.test.mjs','tests/vnextRevenueFallback.test.mjs','tests/institutionalCaptureCompatibility.test.mjs','tests/dailyAiMemberComparison.test.mjs','tests/vnextPrewarmSql.integration.mjs','tests/dailyAiInstitutionalIssuer16Database.integration.mjs'])assert(after.includes(path),path);
 assert.match(after,/@electric-sql\/pglite@0\.3\.14/);assert.match(after,/export MA_PGLITE_MODULE="\$RUNNER_TEMP\/ma-recovery-pglite\/node_modules\/@electric-sql\/pglite\/dist\/index\.js"/);
 assert.match(after,/export MA_VALIDATOR_DEFS_DIR="\$GITHUB_WORKSPACE\/tests\/fixtures\/recovery-source-validators-20261105"/);
 assert(after.includes('tests/dailyAiFullNestedLocal.integration.mjs'));assert(after.includes('tests/vnextWarmPgliteLocal.integration.mjs'));
 assert.doesNotMatch(after,/continue-on-error|--test-skip-pattern|--test-name-pattern/);
});
test('engineering source identity grants no financial method, data rights, publication or production authority',()=>{
 for(const [flag,value]of Object.entries(recoverySourceDefinition().authority)){
  assert.equal(value,false);const f=fixture();f.manifest.source_union.reviewed_successor.recovery_git_successor[flag]=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);
 }
 const f=fixture();f.manifest.source_union.reviewed_successor.recovery_git_successor.scope_review.independent_review=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);
});
