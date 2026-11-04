import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {integrationPhysicalRead as physical,integrationPhysicalMode as physicalMode,integrationInventory,integrationHash,verifyIntegrationCandidate,createSourceUnionComposition,CURRENT_INTEGRATION_MANIFEST,sourceUnionLineage} from './helpers/integrationAdmission.mjs';
import {CI_SHARD_SOURCE_BASE,CI_SHARD_SOURCE_CATALOG,CI_SHARD_SOURCE_CATALOG_SHA256,CI_SHARD_SOURCE_MANIFEST,CI_SHARD_SOURCE_SUPPORT,ciShardSourceDefinition,ciShardSourcePriorPatch} from './helpers/ciShardSourceCatalog.mjs';
import {ciShardPriorRead,recoveryPriorRead,reviewedSuccessorPaths} from './helpers/ciShardSourceSuccessor.mjs';
import {RECOVERY_SOURCE_MANIFEST,RECOVERY_SOURCE_CATALOG,recoverySourceDefinition} from './helpers/recoverySourceCatalog.mjs';
import {recoveryPriorRead as physicalRecoveryPriorRead,recoveryPriorReadWithVerifiedPhysical,verifyRecoverySuccessorWithVerifiedPhysical} from './helpers/recoverySourceSuccessor.mjs';
const root=new URL('../',import.meta.url),git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root});
const workflowPath='.github/workflows/vnext-candidate.yml',readJson=path=>JSON.parse(physical(path));
function fixture(){
 const bytes=new Map(),modes=new Map(),paths=integrationInventory(),manifest=readJson(CURRENT_INTEGRATION_MANIFEST);
 const read=path=>bytes.has(path)?bytes.get(path):physical(path),mode=path=>modes.get(path)??physicalMode(path);
 const reseal=()=>bytes.set(CURRENT_INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(manifest)));
 const mirror=path=>{const row=manifest.files.find(row=>row.path===path);assert(row);row.after_sha256=integrationHash(read(path));reseal();};
 return {bytes,modes,paths,manifest,read,mode,reseal,mirror,verify:()=>verifyIntegrationCandidate(read,paths,mode)};
}
test('CI successor appends exact engineering edits while retaining every frozen receipt and runtime helper',()=>{
 const m=verifyIntegrationCandidate(),c=ciShardSourceDefinition();assert.deepEqual(createSourceUnionComposition(),m);
 assert.equal(CURRENT_INTEGRATION_MANIFEST,CI_SHARD_SOURCE_MANIFEST);assert.equal(c.local_support_patch.length,7);
 for(const path of [RECOVERY_SOURCE_MANIFEST,RECOVERY_SOURCE_CATALOG])assert.deepEqual(physical(path),git(['show',CI_SHARD_SOURCE_BASE+':'+path]));
 assert.equal(readJson(RECOVERY_SOURCE_MANIFEST).files.length,945);assert.equal(m.files.length,950);assert.equal(integrationInventory().length,951);
 assert.equal(integrationHash(physical(CI_SHARD_SOURCE_CATALOG)),CI_SHARD_SOURCE_CATALOG_SHA256);
 for(const path of ['tests/helpers/vnextIntegrity.mjs','scripts/releases/observe-ci-node.mjs'])assert.deepEqual(physical(path),git(['show',CI_SHARD_SOURCE_BASE+':'+path]));
 assert.doesNotMatch(physical('tests/helpers/integrationAdmission.mjs').toString(),/withIntegrationReadScope|scopeManifestSignature|snapshot_reads/);
 assert.equal(sourceUnionLineage().reviewed_successor.ci_shard_successor.scope_review.independent_review,false);
});
test('three independent source jobs are an exact partition of the original seven full test files',()=>{
 verifyIntegrationCandidate();const before=git(['show',CI_SHARD_SOURCE_BASE+':'+workflowPath]).toString(),after=physical(workflowPath).toString();
 const original=before.match(/node scripts\/releases\/observe-ci-node\.mjs ([^\n]+)/)[1];
 const command='--max-old-space-size=512 --experimental-strip-types --test --test-concurrency=1 ';
 assert(original.startsWith(command));const originalFiles=original.slice(command.length).split(' ');assert.equal(originalFiles.length,7);
 const blocks=Object.fromEntries([...after.matchAll(/^  ([a-z-]+):\n([\s\S]*?)(?=^  [a-z-]+:\n|$(?![\s\S]))/gm)].map(match=>[match[1],match[2]]));
 assert.deepEqual(Object.keys(blocks),['source-academy','source-release-integrity','source-successors','vnext-runtime','vnext-isolation']);
 const shardFiles=[];
 for(const name of ['source-academy','source-release-integrity','source-successors']){
  const body=blocks[name];assert.match(body,/timeout-minutes: 45/);assert.match(body,/actions\/checkout@v4/);assert.match(body,/fetch-depth: 0/);assert.match(body,/actions\/setup-node@v4/);assert.match(body,/node-version-file: \.nvmrc/);assert.match(body,/run: npm ci/);
  const commands=[...body.matchAll(/run: node scripts\/releases\/observe-ci-node\.mjs ([^\n]+)/g)];assert.equal(commands.length,1);assert(commands[0][1].startsWith(command));shardFiles.push(...commands[0][1].slice(command.length).split(' '));
  assert.doesNotMatch(body,/continue-on-error|--test-skip-pattern|--test-name-pattern|\bif:|\|\s*tee|member-build|working-directory:/);
 }
 assert.deepEqual(shardFiles.filter(path=>originalFiles.includes(path)).sort(),originalFiles.slice().sort());assert.equal(new Set(shardFiles).size,shardFiles.length);
 assert.deepEqual(shardFiles.filter(path=>!originalFiles.includes(path)),['tests/ciShardSourceSuccessor.test.mjs']);
 assert.doesNotMatch(blocks['vnext-runtime'],/observe-ci-node\.mjs/);assert.match(blocks['vnext-runtime'],/node --test tests\/ciNodeObserver\.test\.mjs/);
 // All pre-existing runtime commands remain byte-for-byte, in order. Only
 // the old source observer and its block marker moved into isolated jobs.
 const oldCommands=[...before.matchAll(/^\s+(?:run: )?(node [^\n]+|MA_VNEXT_BUILD_DIR=[^\n]+|npm install [^\n]+|export MA_[^\n]+|deno check [^\n]+)/gm)].map(m=>m[1]).filter(line=>!line.startsWith('node scripts/releases/observe-ci-node.mjs'));
 const runtimeCommands=[...blocks['vnext-runtime'].matchAll(/^\s+(?:run: )?(node [^\n]+|MA_VNEXT_BUILD_DIR=[^\n]+|npm install [^\n]+|export MA_[^\n]+|deno check [^\n]+)/gm)].map(m=>m[1]);assert.deepEqual(runtimeCommands,oldCommands);
});
test('the preserved required check refuses missing, skipped, cancelled and failed shard results',()=>{
 const text=physical(workflowPath).toString(),aggregate=text.split('  vnext-isolation:\n')[1];assert(aggregate);
 assert.match(aggregate,/if: \$\{\{ always\(\) \}\}/);assert.match(aggregate,/needs: \[vnext-runtime, source-academy, source-release-integrity, source-successors\]/);
 const keys=['RUNTIME_RESULT','ACADEMY_RESULT','RELEASE_RESULT','SUCCESSORS_RESULT'];
 for(const [index,job]of ['vnext-runtime','source-academy','source-release-integrity','source-successors'].entries())assert(aggregate.includes(keys[index]+': ${{ needs.'+job+'.result }}'));
 const script=aggregate.split('        run: |\n')[1].trim().split('\n').map(line=>line.trim()).join('\n');assert.equal(script.split('\n').length,4);
 const run=env=>spawnSync('bash',['-eu','-c',script],{env,encoding:'utf8'}).status;
 const success=Object.fromEntries(keys.map(key=>[key,'success']));assert.equal(run(success),0);
 for(const key of keys)for(const value of ['failure','cancelled','skipped','',undefined]){const env={...success};if(value===undefined)delete env[key];else env[key]=value;assert.notEqual(run(env),0,key+':'+value);}
 assert.doesNotMatch(aggregate,/continue-on-error|\|\|\s*true|exit 0/);
});
test('new source and catalog hashes cannot be mirrored into approval or replace fixed old bytes',()=>{
 for(const row of ciShardSourceDefinition().local_support_patch){const f=fixture();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nFORGED_CI_SOURCE')]));f.mirror(row.path);assert.throws(f.verify,/SOURCE_DRIFT/,row.path);}
 const f=fixture(),catalog=readJson(CI_SHARD_SOURCE_CATALOG),row=catalog.local_support_patch[0];f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nFORGED_CI_WORKFLOW')]));row.after.sha256=integrationHash(f.read(row.path));
 f.bytes.set(CI_SHARD_SOURCE_CATALOG,Buffer.from(JSON.stringify(catalog)));f.mirror(row.path);f.mirror(CI_SHARD_SOURCE_CATALOG);f.manifest.source_union.reviewed_successor.ci_shard_successor.catalog.sha256=integrationHash(f.read(CI_SHARD_SOURCE_CATALOG));f.reseal();assert.throws(f.verify,/CI_SHARD_SOURCE_CATALOG_DRIFT/);
 for(const path of CI_SHARD_SOURCE_SUPPORT){const altered=fixture();altered.bytes.set(path,Buffer.concat([altered.read(path),Buffer.from('\nFORGED_SUPPORT')]));altered.mirror(path);assert.throws(altered.verify,/SUPPORT_SOURCE_DRIFT/);}
});
test('physical bridge translates only current after-images and independently validates both old layers',()=>{
 verifyIntegrationCandidate();const current=physical(workflowPath),row=ciShardSourceDefinition().local_support_patch[0],before=git(['show',CI_SHARD_SOURCE_BASE+':'+workflowPath]);
 assert.deepEqual(ciShardPriorRead(workflowPath,current),before);assert.equal(integrationHash(before),row.before.sha256);
 assert.deepEqual(recoveryPriorRead(workflowPath,current),git(['show',recoverySourceDefinition().base+':'+workflowPath]));
 const injected=Buffer.concat([current,Buffer.from('\nINJECTED')]);assert.deepEqual(ciShardPriorRead(workflowPath,injected),injected);assert.deepEqual(recoveryPriorRead(workflowPath,injected),injected);
 assert.equal(ciShardPriorRead(workflowPath,'\ud800'),'\ud800');assert.deepEqual(ciShardPriorRead(workflowPath,before),before);
 assert.equal(recoveryPriorRead(workflowPath,before),before);assert.equal(recoveryPriorRead(workflowPath,before.toString()),before.toString());
 assert.throws(()=>physicalRecoveryPriorRead(workflowPath,before),/RECOVERY_SOURCE_CHANGED_AFTER_ADMISSION/);
 assert.throws(()=>recoveryPriorReadWithVerifiedPhysical(workflowPath,before,()=>Buffer.from('WRONG_PHYSICAL_IMAGE')),/RECOVERY_SOURCE_CHANGED_AFTER_ADMISSION/);
 assert.throws(()=>verifyRecoverySuccessorWithVerifiedPhysical(path=>ciShardPriorRead(path,physical(path)),physicalMode,()=>Buffer.from('WRONG_PHYSICAL_IMAGE')),/SOURCE_DRIFT/);
 const copy=ciShardSourcePriorPatch(workflowPath);copy.fill(0);assert.equal(integrationHash(ciShardSourcePriorPatch(workflowPath)),row.before.sha256);
 const paths=reviewedSuccessorPaths();paths.fill('POISON');assert(!reviewedSuccessorPaths().includes('POISON'));assert.throws(()=>{ciShardSourceDefinition().local_support_patch[0].after.sha256='0'.repeat(64);},TypeError);
});
test('modes, frozen receipts, inventories and subsequent calls never reuse a previous PASS',()=>{
 const c=ciShardSourceDefinition();
 for(const path of [CI_SHARD_SOURCE_CATALOG,...CI_SHARD_SOURCE_SUPPORT,...c.local_support_patch.map(r=>r.path),c.prior_manifest.path,c.prior_catalog.path])for(const mode of ['100755','120000']){const f=fixture();f.modes.set(path,mode);assert.throws(f.verify,/MODE/,path);}
 for(const path of [c.prior_manifest.path,c.prior_catalog.path]){const f=fixture();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\n')]));f.mirror(path);assert.throws(f.verify,/DRIFT/);}
 const unknown=fixture();unknown.paths.push('tests/unreviewed-ci-control.mjs');assert.throws(unknown.verify,/INTEGRATION_UNKNOWN_PATH/);
 const missing=fixture();missing.paths.splice(missing.paths.indexOf(CI_SHARD_SOURCE_CATALOG),1);assert.throws(missing.verify,/INTEGRATION_UNKNOWN_PATH/);
 const warm=fixture();warm.verify();warm.bytes.set(workflowPath,Buffer.from('REPLACED_AFTER_PASS'));warm.mirror(workflowPath);assert.throws(warm.verify,/SOURCE_DRIFT/);
});
test('CI source identity retains every financial, rights, runtime and publication authority as false',()=>{
 for(const flag of Object.keys(ciShardSourceDefinition().authority)){const f=fixture();f.manifest.source_union.reviewed_successor.ci_shard_successor[flag]=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);}
 const f=fixture();f.manifest.source_union.reviewed_successor.ci_shard_successor.scope_review.independent_review=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);
 const summary=fixture();summary.manifest.source_union.reviewed_successor.ci_shard_successor.local_support_patch[0].after.sha256='0'.repeat(64);summary.reseal();assert.throws(summary.verify,/UNION_LINEAGE_DRIFT/);
});
