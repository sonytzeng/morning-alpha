import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {integrationPhysicalRead as physical,integrationPhysicalMode as physicalMode,integrationInventory,integrationHash,verifyIntegrationCandidate,createSourceUnionComposition,CURRENT_INTEGRATION_MANIFEST,sourceUnionLineage} from './helpers/integrationAdmission.mjs';
import {MODEL_USE_SOURCE_BASE,MODEL_USE_SOURCE_HEAD,MODEL_USE_SOURCE_CATALOG,MODEL_USE_SOURCE_CATALOG_SHA256,MODEL_USE_SOURCE_MANIFEST,MODEL_USE_SOURCE_SUPPORT,modelUseSourceDefinition,modelUseSourcePriorPatch} from './helpers/modelUseSourceCatalog.mjs';
import {modelUsePriorRead,reviewedSuccessorPaths} from './helpers/modelUseSourceSuccessor.mjs';
import {CI_SHARD_SOURCE_MANIFEST,CI_SHARD_SOURCE_CATALOG} from './helpers/ciShardSourceCatalog.mjs';
import {verifyCiShardSuccessorWithVerifiedPhysical} from './helpers/ciShardSourceSuccessor.mjs';
const root=new URL('../',import.meta.url),git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root});
function fixture(){
 const bytes=new Map(),modes=new Map(),paths=integrationInventory(),manifest=JSON.parse(physical(CURRENT_INTEGRATION_MANIFEST));
 const read=path=>bytes.has(path)?bytes.get(path):physical(path),mode=path=>modes.get(path)??physicalMode(path);
 const reseal=()=>bytes.set(CURRENT_INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(manifest)));
 const mirror=path=>{const row=manifest.files.find(row=>row.path===path);assert(row);row.after_sha256=integrationHash(read(path));reseal();};
 return {bytes,modes,paths,manifest,read,mode,reseal,mirror,verify:()=>verifyIntegrationCandidate(read,paths,mode)};
}
test('source-use successor verifies the actual twelve-file Git delta and all 965 current files',()=>{
 const m=verifyIntegrationCandidate(),c=modelUseSourceDefinition();assert.deepEqual(createSourceUnionComposition(),m);
 assert.equal(CURRENT_INTEGRATION_MANIFEST,MODEL_USE_SOURCE_MANIFEST);assert.equal(c.base,MODEL_USE_SOURCE_BASE);assert.equal(c.head,MODEL_USE_SOURCE_HEAD);assert.equal(c.files.length,12);
 assert.equal(m.files.length,965);assert.equal(integrationInventory().length,966);assert.equal(c.local_support_patch.length,8);
 assert.equal(integrationHash(physical(MODEL_USE_SOURCE_CATALOG)),MODEL_USE_SOURCE_CATALOG_SHA256);
 assert.deepEqual(git(['rev-list','--parents','-n','1',c.head]).toString().trim().split(' '),[c.head,c.base]);
 for(const pin of [c.prior_manifest,c.prior_catalog])assert.deepEqual(physical(pin.path),git(['show',MODEL_USE_SOURCE_BASE+':'+pin.path]));
 assert.equal(JSON.parse(physical(CI_SHARD_SOURCE_MANIFEST)).files.length,950);assert.equal(CI_SHARD_SOURCE_CATALOG,c.prior_catalog.path);
 const lineage=sourceUnionLineage().reviewed_successor.model_source_use_successor;assert.equal(lineage.exact_git_delta,12);assert.equal(lineage.scope_review.independent_review,false);
});
test('every new source and support body refuses mirrored terminal hashes',()=>{
 for(const row of [...modelUseSourceDefinition().files,...modelUseSourceDefinition().local_support_patch]){
  const f=fixture();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_MODEL_SOURCE')]));f.mirror(row.path);assert.throws(f.verify,/SOURCE_DRIFT/,row.path);
 }
 for(const path of MODEL_USE_SOURCE_SUPPORT){const f=fixture();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\nFORGED_SUPPORT')]));f.mirror(path);assert.throws(f.verify,/SUPPORT_SOURCE_DRIFT/,path);}
});
test('source, catalog and lineage co-mutation cannot authorize a different batch reader',()=>{
 const f=fixture(),c=JSON.parse(physical(MODEL_USE_SOURCE_CATALOG)),row=c.files.find(row=>row.path.endsWith('/intake.ts'));
 f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nFORGED_MODEL_GATE')]));row.after.sha256=integrationHash(f.read(row.path));
 f.bytes.set(MODEL_USE_SOURCE_CATALOG,Buffer.from(JSON.stringify(c)));f.mirror(row.path);f.mirror(MODEL_USE_SOURCE_CATALOG);
 f.manifest.source_union.reviewed_successor.model_source_use_successor.catalog.sha256=integrationHash(f.read(MODEL_USE_SOURCE_CATALOG));f.reseal();assert.throws(f.verify,/MODEL_USE_SOURCE_CATALOG_DRIFT/);
});
test('only current physical after-images may enter the older CI identity',()=>{
 verifyIntegrationCandidate();const path='supabase/functions/daily-stock-analysis-v1/intake.ts',row=modelUseSourceDefinition().files.find(row=>row.path===path),current=physical(path),before=git(['show',MODEL_USE_SOURCE_BASE+':'+path]);
 assert.deepEqual(modelUsePriorRead(path,current),before);assert.equal(integrationHash(before),row.before.sha256);
 const injected=Buffer.concat([current,Buffer.from('\nINJECTED')]);assert.deepEqual(modelUsePriorRead(path,injected),injected);assert.deepEqual(modelUsePriorRead(path,before),before);
 assert.equal(modelUsePriorRead(path,'\ud800'),'\ud800');assert.equal(modelUsePriorRead('unknown/path','UNCHANGED'),'UNCHANGED');
 assert.throws(()=>verifyCiShardSuccessorWithVerifiedPhysical(p=>modelUsePriorRead(p,physical(p)),physicalMode,()=>Buffer.from('WRONG_PHYSICAL_IMAGE')),/SOURCE_DRIFT/);
 const copy=modelUseSourcePriorPatch(path);copy.fill(0);assert.equal(integrationHash(modelUseSourcePriorPatch(path)),row.before.sha256);
 const paths=reviewedSuccessorPaths();paths.fill('POISON');assert(!reviewedSuccessorPaths().includes('POISON'));assert.throws(()=>{modelUseSourceDefinition().files[0].after.sha256='0'.repeat(64);},TypeError);
});
test('unknown paths, omitted sources, mode changes and later mutation remain rejected',()=>{
 const c=modelUseSourceDefinition();
 for(const path of [MODEL_USE_SOURCE_CATALOG,...MODEL_USE_SOURCE_SUPPORT,...c.files.map(row=>row.path),...c.local_support_patch.map(row=>row.path),c.prior_manifest.path,c.prior_catalog.path])for(const mode of ['100755','120000']){const f=fixture();f.modes.set(path,mode);assert.throws(f.verify,/MODE/,path);}
 const unknown=fixture();unknown.paths.push('research/unreviewed-model-source.ts');assert.throws(unknown.verify,/INTEGRATION_UNKNOWN_PATH/);
 const missing=fixture();missing.paths.splice(missing.paths.indexOf('supabase/functions/daily-stock-analysis-v1/model-source-review.ts'),1);assert.throws(missing.verify,/INTEGRATION_UNKNOWN_PATH/);
 const warm=fixture();warm.verify();warm.bytes.set('supabase/functions/daily-stock-analysis-v1/intake.ts',Buffer.from('CHANGED_AFTER_PASS'));warm.mirror('supabase/functions/daily-stock-analysis-v1/intake.ts');assert.throws(warm.verify,/SOURCE_DRIFT/);
});
test('code identity supplies no investment, contract, model, publication or deployment approval',()=>{
 const c=modelUseSourceDefinition();for(const flag of Object.keys(c.authority)){assert.equal(c.authority[flag],false);const f=fixture();f.manifest.source_union.reviewed_successor.model_source_use_successor[flag]=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);}
 const f=fixture();f.manifest.source_union.reviewed_successor.model_source_use_successor.scope_review.independent_review=true;f.reseal();assert.throws(f.verify,/UNION_LINEAGE_DRIFT/);
 const workflow=physical('.github/workflows/vnext-candidate.yml').toString();assert(workflow.includes('tests/modelUseSourceSuccessor.test.mjs tests/dailyAiModelSourceUse.test.mjs'));assert.doesNotMatch(workflow,/continue-on-error|--test-skip-pattern/);
});
