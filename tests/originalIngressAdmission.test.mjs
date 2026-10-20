// Current R3 admission is mandatory; complete old assertions stay at 1db/c131/4469/8c.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
 INTEGRATION_MANIFEST,SOURCE_UNION_PARENTS,SOURCE_UNION_SUPPORT,REGISTRY_SUPPORT_PARENT,REGISTRY_SUPPORT_PATHS,
 FROZEN_SOURCE_UNION,FROZEN_SOURCE_UNION_NORMALIZER,SOURCE_UNION_NORMALIZER_PRIOR_PARENT,SOURCE_UNION_NORMALIZER_BASE,SOURCE_UNION_NORMALIZER_PARENT,SOURCE_UNION_NORMALIZER_FILES,sourceUnionNormalizerLineage,
 FROZEN_SOURCE_UNION_R2,SOURCE_UNION_R3_BASE,SOURCE_UNION_R3_FILES,sourceUnionR3Lineage,
 integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash,
 createSourceUnionComposition,verifyIntegrationCandidate,sourceUnionLineage,sourceUnionParentRead,verifySourceUnionPinnedProof,
} from './helpers/integrationAdmission.mjs';
const flags=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
test('one complete physical current union pins actual645 and registry1db, never mutable worktrees',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(createSourceUnionComposition(),m);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261020-v1-source-union-r3.json');
 assert.equal(FROZEN_SOURCE_UNION,'docs/operations/evidence/core-member-integration-20261020-v1-source-union.json');
 assert.equal(FROZEN_SOURCE_UNION_NORMALIZER,'docs/operations/evidence/core-member-integration-20261020-v1-source-union-normalizer.json');
 assert.equal(m.files.length,512);assert.equal(integrationInventory().length,513);
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
  m=>m.source_union.historical_proof.revision='HEAD',m=>m.files.pop(),
  m=>m.source_union.prior_normalizer_proof.revision=SOURCE_UNION_NORMALIZER_PARENT,
  m=>m.source_union.prior_normalizer_proof.execution='CURRENT_PASS',m=>m.source_union.prior_normalizer_proof.verified_prior_tests=21,
  m=>m.source_union.prior_normalizer_proof.files[0].sha256='0'.repeat(64)]){
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
test('historical normalizer stays exactly two immutable8fbe blobs; current R3 is a separate eight-file versioned delta',()=>{
 assert.equal(SOURCE_UNION_NORMALIZER_BASE,'c1318bfe8d32f774ecbc1ba17787832bb745b489');
 assert.equal(SOURCE_UNION_NORMALIZER_PARENT,'8fbe1fc3b2fa675594a4cf4f61298e312d133db3');
 assert.deepEqual(SOURCE_UNION_NORMALIZER_FILES,[
  {path:'scripts/official-actuals/issuer-pdf-descriptor.py',mode:'100644',sha256:'0f4157dc10f423dec8fbd0e56bef8e9e81e4a9bc3120dec01f791bf22f123d6b'},
  {path:'tests/test_issuer_pdf_descriptor.py',mode:'100644',sha256:'f2e797e40e65e4f76eb6668fd1747ccfbcf99e8534cd1c6d9e3d3cd4aefff94f'},
 ]);
 assert.equal(SOURCE_UNION_NORMALIZER_PRIOR_PARENT,'4469d69cdcbcdf0cf176b592f158977a7980e1a3');
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_NORMALIZER)),'ac75c13d9314a90cdeb28fb361bb7cc3543946848126a4339d003b7cb9fb97d8');
 const prior=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_NORMALIZER));
 assert.equal(prior.files.length,505);assert.equal(prior.source_union.normalizer.parent,'9ff0f90e737484b1235cfb79c43fcaa5bd40d9d9');
 assert.deepEqual(prior.source_union.normalizer.files,[
  {path:'scripts/official-actuals/issuer-pdf-descriptor.py',mode:'100644',sha256:'d08f6dd37025be801faadb1d498fb47cdd5c463a68f5fe0b55513f99015b2528'},
  {path:'tests/test_issuer_pdf_descriptor.py',mode:'100644',sha256:'439352819ea42c6d9dd7f67f2b5df304c2b23a5debab8ba1ed48bb054aabc595'},
 ]);
 assert.equal(SOURCE_UNION_SUPPORT.length,5);
 const m=verifyIntegrationCandidate();assert.deepEqual(m.source_union.normalizer,sourceUnionNormalizerLineage());
 assert.deepEqual(m.source_union.prior_normalizer_proof,{revision:SOURCE_UNION_NORMALIZER_PRIOR_PARENT,
  execution:'PINNED_PRIOR_PASS_REFERENCE_NOT_CURRENT',verified_prior_tests:20,files:[
   {path:'tests/originalIngressAdmission.test.mjs',sha256:'d79ca4e92357f06b8fef2f105adfa87c0dd1f5deeea91f7f4eab977b411fcb48'},
   {path:'tests/officialPublicAdmission.test.mjs',sha256:'253a4c4c6d346f31a39a105b94473a3ccf6467893bcbfb678af196e11f2cf998'},
   {path:'.github/workflows/v1-source-integration.yml',sha256:'2d8b2095fca1e61e2b40430cf2394f18c78b36f6857927c6440690f71e486311'},
  ]});
 for(const row of SOURCE_UNION_NORMALIZER_FILES){
  assert(!SOURCE_UNION_SUPPORT.includes(row.path));
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_NORMALIZER_PARENT+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(old),row.sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
  assert.notEqual(integrationHash(integrationPhysicalRead(row.path)),row.sha256,'new PDF must not masquerade as8fbe');
 }
 const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(git(['rev-list','--parents','-n','1',SOURCE_UNION_NORMALIZER_PARENT]).trim(),SOURCE_UNION_NORMALIZER_PARENT+' '+SOURCE_UNION_NORMALIZER_BASE);
 assert.equal(git(['diff','--no-renames','--name-status',SOURCE_UNION_NORMALIZER_BASE,SOURCE_UNION_NORMALIZER_PARENT,'--']),
  SOURCE_UNION_NORMALIZER_FILES.map(({path})=>'A\t'+path+'\n').join(''));
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION)),'b9869544786b66e75c38e390550494307dabef4c549745a66f84bd79a1b74d0f');
 assert.equal(m.source_union.normalizer.source_admission,false);assert.equal(m.source_union.normalizer.canonical_admission,false);
 assert.deepEqual(m.source_union.r3,sourceUnionR3Lineage());assert.equal(SOURCE_UNION_R3_FILES.length,8);
});
test('both normalizer blobs reject current drift even with a newly rehashed root and warm reader',()=>{
 for(const {path}of SOURCE_UNION_NORMALIZER_FILES){
  const f=fixture();f.verify();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\nUNREVIEWED')]));
  f.manifest.files.find(r=>r.path===path).after_sha256=integrationHash(f.read(path));f.reseal();
  assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('9ff rollback, either mixed generation and forged old lineage reject even after current-root rehash',()=>{
 const old=SOURCE_UNION_NORMALIZER_FILES.map(({path})=>Buffer.from(execFileSync('git',['--no-replace-objects','show','9ff0f90e737484b1235cfb79c43fcaa5bd40d9d9:'+path],{cwd:new URL('../',import.meta.url)})));
 for(const indices of [[0,1],[0],[1]]){
  const f=fixture();for(const i of indices){const {path}=SOURCE_UNION_NORMALIZER_FILES[i];assert.notEqual(integrationHash(old[i]),integrationHash(f.read(path)));
   f.bytes.set(path,old[i]);f.manifest.files.find(r=>r.path===path).after_sha256=integrationHash(old[i]);}
  f.manifest.source_union.normalizer=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_NORMALIZER)).source_union.normalizer;f.reseal();
  assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('normalizer missing files, executable or symlink modes, extra files and renamed paths fail closed',()=>{
 for(const {path}of SOURCE_UNION_NORMALIZER_FILES){
  const f=fixture();
  assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===path)throw Error('NORMALIZER_MISSING');return f.read(p);},f.paths,f.mode),/NORMALIZER_MISSING/);
  for(const mode of ['100755','120000']){
   f.modes.set(path,mode);f.manifest.files.find(r=>r.path===path).mode=mode;f.reseal();assert.throws(f.verify,/MODE_DRIFT/);
  }
  f.modes.delete(path);f.manifest.files.find(r=>r.path===path).mode='100644';f.reseal();
  f.paths.push(path+'.unreviewed');assert.throws(f.verify,/UNKNOWN_PATH/);
  f.paths.pop();f.paths.splice(f.paths.indexOf(path),1);assert.throws(f.verify,/UNKNOWN_PATH/);
  const renamed=fixture();renamed.manifest.files.find(r=>r.path===path).path=path+'.renamed';renamed.reseal();assert.throws(renamed.verify,/EXACT_SCOPE/);
 }
});
test('normalizer parent, base, path set, modes, hashes and authority fields cannot be self-approved in lineage',()=>{
 for(const change of [
  n=>n.parent='HEAD',n=>n.parent=SOURCE_UNION_NORMALIZER_BASE,n=>n.base=SOURCE_UNION_NORMALIZER_PARENT,
  n=>n.parent='9ff0f90e737484b1235cfb79c43fcaa5bd40d9d9',n=>n.base=SOURCE_UNION_NORMALIZER_PRIOR_PARENT,
  n=>n.files.pop(),n=>n.files.push({...n.files[0],path:'scripts/official-actuals/UNREVIEWED.py'}),
  n=>n.files[0].path='src/features/vnext/dailyRuntime.ts',n=>n.files[0].mode='100755',n=>n.files[0].sha256='0'.repeat(64),
  n=>n.source_admission=true,n=>n.canonical_admission=true,
 ]){const f=fixture();change(f.manifest.source_union.normalizer);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);}
 const f=fixture();f.manifest.source_union.support_paths.push(SOURCE_UNION_NORMALIZER_FILES[0].path);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
});
test('all c131/4469/8c roots remain immutable even after new-root rehash or receipt-parent substitution',()=>{
 for(const path of [FROZEN_SOURCE_UNION,FROZEN_SOURCE_UNION_NORMALIZER,FROZEN_SOURCE_UNION_R2]){
  const f=fixture();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\n')]));
  f.manifest.files.find(r=>r.path===path).after_sha256=integrationHash(f.read(path));f.reseal();
  assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
  const wrongMode=fixture();wrongMode.modes.set(path,'100755');wrongMode.manifest.files.find(r=>r.path===path).mode='100755';wrongMode.reseal();assert.throws(wrongMode.verify,/MODE_DRIFT/);
 }
 for(const view of ['union_prior','normalizer_prior']){
  const g=fixture();g.manifest.source_union.receipts.find(r=>r.view===view).revision=SOURCE_UNION_NORMALIZER_PARENT;g.reseal();assert.throws(g.verify,/LINEAGE_DRIFT/);
 }
});
test('R3 CI runs full admission before fixed Python controls, capacity negatives and current evaluator regressions',()=>{
 const workflow=integrationPhysicalRead('.github/workflows/v1-source-integration.yml').toString();
 const priorWorkflow=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R3_BASE+':.github/workflows/v1-source-integration.yml'],{cwd:new URL('../',import.meta.url)});
 assert.equal(integrationHash(priorWorkflow),'2d8b2095fca1e61e2b40430cf2394f18c78b36f6857927c6440690f71e486311');
 const names=text=>[...text.matchAll(/^    def (test_\w+)\(/gm)].map(m=>m[1]);
 const currentText=integrationPhysicalRead('tests/test_issuer_pdf_descriptor.py').toString();
 const current=names(currentText);assert.equal(current.length,65);
 const old=names(execFileSync('git',['--no-replace-objects','show','9ff0f90e737484b1235cfb79c43fcaa5bd40d9d9:tests/test_issuer_pdf_descriptor.py'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}));
 assert.equal(old.length,28);for(const name of old)assert(current.includes(name),'original synthetic control must remain: '+name);
 const r2=names(execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_NORMALIZER_PARENT+':tests/test_issuer_pdf_descriptor.py'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}));
 assert.equal(r2.length,45);for(const name of r2)assert(current.includes(name),'all45 R2 synthetic controls must remain: '+name);
 const bodies=text=>{
  const starts=[...text.matchAll(/^(?:    def (\w+)\(|(?:class|def) |if __name__)/gm)],result=new Map();
  for(let i=0;i<starts.length;i++)if(starts[i][1]?.startsWith('test_'))result.set(starts[i][1],text.slice(starts[i].index,starts[i+1]?.index??text.length).trimEnd());
  return result;
 };
 const oldBodies=bodies(execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_NORMALIZER_PARENT+':tests/test_issuer_pdf_descriptor.py'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}));
 const newBodies=bodies(currentText);
 assert.equal(oldBodies.size,45);assert.equal(newBodies.size,65);for(const [name,body]of oldBodies)assert.equal(newBodies.get(name),body,'unchanged original Python assertion body: '+name);
 // Keep the previously reviewed 62 controls AND their surrounding source bytes.
 // Only this exact added helper/three-control segment is removed for comparison;
 // this is not an exemption for current parser bytes or a private PDF replay.
 const addedStart=currentText.indexOf('    def q4_ratio_fixture('),addedEnd=currentText.indexOf('def local_replay(',addedStart);
 assert(addedStart>0&&addedEnd>addedStart);
 const prior62=currentText.slice(0,addedStart)+'\n'+currentText.slice(addedEnd);
 assert.equal(integrationHash(Buffer.from(prior62)),'6b47af5d9d3e97bee5edc91886568f591753c868d63475919c864e29458786da');
 assert.equal(names(prior62).length,62);
 assert.deepEqual(current.filter(name=>!names(prior62).includes(name)),[
  'test_q4_actual_cell_cannot_be_yoy_or_qoq','test_q4_padded_quarter_locator_cannot_include_ratio','test_q4_expanded_axis_keeps_native_actual_cell',
 ]);
 const gate=workflow.indexOf('run: node --experimental-strip-types --test --test-concurrency=1 tests/originalIngressAdmission.test.mjs tests/officialPublicAdmission.test.mjs');
 const python=workflow.indexOf('uses: actions/setup-python@v5'),install=workflow.indexOf('python -m pip install --disable-pip-version-check pypdf==6.10.0 pdfplumber==0.11.9');
 const controls=workflow.indexOf('run: python -B tests/test_issuer_pdf_descriptor.py SyntheticControls -v');
 assert(gate>=0&&python>gate&&install>python&&controls>install);assert(workflow.includes("python-version: '3.12'"));
 assert(!workflow.includes('--replay-manifest'));assert(!workflow.includes('continue-on-error:'));assert(!workflow.includes('secrets.'));
 assert(workflow.includes('tests/vnextOriginalRegistryIngress.test.mjs'));assert(workflow.includes('tests/v1ActualCanonical.test.mjs'));
 const models=workflow.indexOf('tests/memberCapacityModel.test.mjs tests/v1FundamentalRevisionSelection.test.mjs');
 assert(models>controls);assert(workflow.includes('tests/recommendationIssuerEventReview.test.mjs'));
 assert(workflow.includes('node --experimental-strip-types tests/v1FundamentalRevisionDatabase.integration.mjs'));
 assert(workflow.includes('needs: current-union'));assert(workflow.includes('timeout-minutes: 5'));
});
test('all13 original c131 union assertions execute unchanged AFTER current admission with verified cleanup', {timeout:150000},()=>{
 const r=verifySourceUnionPinnedProof('union');assert.equal(r.revision,SOURCE_UNION_NORMALIZER_BASE);
 assert.deepEqual(r.tests,['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']);
 assert.equal(r.tests_run,13);assert.equal(r.tests_passed,13);assert.equal(r.cleanup,'VERIFIED_REMOVED');
});
test('R3 pins all eight exact sources to8c before/after bytes without growing the five support paths',()=>{
 const m=verifyIntegrationCandidate(),r3=m.source_union.r3;
 assert.equal(SOURCE_UNION_R3_BASE,'8c110263ddcf83e4471dfc8e32adafd1c47c2c40');
 assert.equal(SOURCE_UNION_SUPPORT.length,5);assert.equal(r3.files.length,8);
 assert.deepEqual(r3.files,SOURCE_UNION_R3_FILES);assert.deepEqual(r3.files.reduce((counts,row)=>(counts[row.group]=(counts[row.group]??0)+1,counts),{}),{pdf:2,capacity:2,delivery:1,evaluator:3});
 for(const row of r3.files){assert(!SOURCE_UNION_SUPPORT.includes(row.path));assert.equal(integrationHash(integrationPhysicalRead(row.path)),row.after_sha256);assert.equal(integrationPhysicalMode(row.path),'100644');}
 assert.equal(r3.prior_root.path,FROZEN_SOURCE_UNION_R2);assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R2)),'d9252d66bf79c19cc1074bd4817a894dea97339927f286a1bf3554e24bf1ec1a');
 assert.equal(r3.worker_payload_changed,false);assert.equal(r3.cle_payload_changed,false);assert.equal(r3.source_admission,false);assert.equal(r3.canonical_admission,false);
});
test('every R3 source refuses tamper plus root/lineage hash reflection, including a warm verifier',()=>{
 for(const row of SOURCE_UNION_R3_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_R3')]));
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r3.files.find(r=>r.path===row.path).after_sha256=reflected;f.reseal();
  assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('all eight R3 paths reject missing, executable/symlink modes, renamed paths and extra inventory',()=>{
 for(const row of SOURCE_UNION_R3_FILES){
  const f=fixture();
  assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===row.path)throw Error('R3_MISSING');return f.read(p);},f.paths,f.mode),/R3_MISSING/);
  for(const mode of ['100755','120000']){f.modes.set(row.path,mode);f.manifest.files.find(r=>r.path===row.path).mode=mode;f.manifest.source_union.r3.files.find(r=>r.path===row.path).mode=mode;f.reseal();assert.throws(f.verify,/MODE_DRIFT/);}
  const extra=fixture();extra.paths.push(row.path+'.unreviewed');assert.throws(extra.verify,/UNKNOWN_PATH/);
  const renamed=fixture();renamed.manifest.files.find(r=>r.path===row.path).path+='-renamed';renamed.reseal();assert.throws(renamed.verify,/EXACT_SCOPE/);
 }
});
test('R3 rejects8fbe rollback and either mixed PDF generation despite reflected hashes',()=>{
 const rows=SOURCE_UNION_R3_FILES.filter(r=>r.group==='pdf');
 for(const indices of [[0,1],[0],[1]]){
  const f=fixture();for(const i of indices){const row=rows[i],old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_NORMALIZER_PARENT+':'+row.path],{cwd:new URL('../',import.meta.url)});
   f.bytes.set(row.path,old);f.manifest.files.find(r=>r.path===row.path).after_sha256=integrationHash(old);f.manifest.source_union.r3.files.find(r=>r.path===row.path).after_sha256=integrationHash(old);}
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);
 }
});
test('R3 base, exact path set, before/after pins and evidence limitations cannot be self-approved',()=>{
 for(const change of [r=>r.base='HEAD',r=>r.files.pop(),r=>r.files.push({...r.files[0],path:'UNREVIEWED'}),r=>r.files[0].before_sha256=null,
  r=>r.files[0].after_sha256='0'.repeat(64),r=>r.prior_root.sha256='0'.repeat(64),r=>r.prior_root.revision=SOURCE_UNION_NORMALIZER_PARENT,
  r=>r.prior_proof.tests=0,r=>r.normalizer_version='8FBE_CURRENT',r=>r.worker_payload_changed=true,r=>r.cle_payload_changed=true,
  r=>r.source_admission=true,r=>r.canonical_admission=true,r=>r.capacity_evidence='PRODUCTION_10000_PASS',r=>r.evaluator_evidence='PRODUCTION_RAW_PAYLOAD_AND_ROLE_PROVED']){
  const f=fixture();change(f.manifest.source_union.r3);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
});
test('all21 unchanged R2 assertions execute at exact8c AFTER full current R3 admission and clean their clones', {timeout:210000},()=>{
 const r=verifySourceUnionPinnedProof('r2');assert.equal(r.revision,SOURCE_UNION_R3_BASE);assert.equal(r.tests_run,21);assert.equal(r.tests_passed,21);assert.equal(r.cleanup,'VERIFIED_REMOVED');
});
