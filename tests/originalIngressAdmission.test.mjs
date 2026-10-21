// Current R8 admission is mandatory. R4's original 35 assertions and exact
// R5 repro runner remain immutable; historical CI reuse is NOT current execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,symlinkSync,lstatSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {
 INTEGRATION_MANIFEST,SOURCE_UNION_PARENTS,SOURCE_UNION_SUPPORT,REGISTRY_SUPPORT_PARENT,REGISTRY_SUPPORT_PATHS,
 FROZEN_SOURCE_UNION,FROZEN_SOURCE_UNION_NORMALIZER,SOURCE_UNION_NORMALIZER_PRIOR_PARENT,SOURCE_UNION_NORMALIZER_BASE,SOURCE_UNION_NORMALIZER_PARENT,SOURCE_UNION_NORMALIZER_FILES,sourceUnionNormalizerLineage,
 FROZEN_SOURCE_UNION_R2,SOURCE_UNION_R3_BASE,SOURCE_UNION_R3_FILES,sourceUnionR3Lineage,
 FROZEN_SOURCE_UNION_R3,SOURCE_UNION_R4_BASE,SOURCE_UNION_R4_FILES,sourceUnionR4Lineage,
 FROZEN_SOURCE_UNION_R4,SOURCE_UNION_R5_BASE,SOURCE_UNION_R5_FILES,sourceUnionR5Lineage,readRegularIntegrationFile,
 FROZEN_SOURCE_UNION_R5,SOURCE_UNION_R6_BASE,SOURCE_UNION_PRIOR_CI,sourceUnionR6Lineage,
 FROZEN_SOURCE_UNION_R6,SOURCE_UNION_R7_BASE,SOURCE_UNION_R7_FILES,sourceUnionR7Lineage,
 FROZEN_SOURCE_UNION_R7,SOURCE_UNION_R8_BASE,SOURCE_UNION_R8_FILES,sourceUnionR8Lineage,INTEGRATION_BASE,
 FROZEN_SOURCE_UNION_R8,SOURCE_UNION_R9_BASE,SOURCE_UNION_R9_FILES,sourceUnionR9Lineage,
 FROZEN_SOURCE_UNION_R9,SOURCE_UNION_R10_BASE,SOURCE_UNION_R10_FILES,sourceUnionR10Lineage,
 FROZEN_SOURCE_UNION_R10,SOURCE_UNION_R11_BASE,SOURCE_UNION_R11_FILES,sourceUnionR11Lineage,
 FROZEN_SOURCE_UNION_R11,FROZEN_SOURCE_UNION_R12,SOURCE_UNION_R12_BASE,SOURCE_UNION_R12_HEAD,SOURCE_UNION_R12_FILES,sourceUnionR12Lineage,
 FROZEN_SOURCE_UNION_R13,SOURCE_UNION_R14_BASE,SOURCE_UNION_R14_FILES,sourceUnionR14Lineage,
 integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash,
 createSourceUnionComposition,verifyIntegrationCandidate,sourceUnionLineage,sourceUnionParentRead,reuseSourceUnionPinnedProof,
} from './helpers/integrationAdmission.mjs';
const flags=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
test('R8 complete physical current union preserves R4/R5/R6/R7 assertions at their immutable parents',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(createSourceUnionComposition(),m);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261021-v1-source-union-r14.json');
 assert.equal(FROZEN_SOURCE_UNION_R7,'docs/operations/evidence/core-member-integration-20261021-v1-source-union-r7.json');
 assert.equal(FROZEN_SOURCE_UNION,'docs/operations/evidence/core-member-integration-20261020-v1-source-union.json');
 assert.equal(FROZEN_SOURCE_UNION_NORMALIZER,'docs/operations/evidence/core-member-integration-20261020-v1-source-union-normalizer.json');
 assert.equal(m.files.length,537);assert.equal(integrationInventory().length,538);
 const r11=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R11));assert.equal(r11.files.length,533);
 const r11Inventory=execFileSync('git',['--no-replace-objects','diff','--no-renames','--name-only','-z',INTEGRATION_BASE,SOURCE_UNION_R12_BASE,'--'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).split('\0').filter(Boolean).sort();
 assert.equal(r11Inventory.length,534);assert.deepEqual(r11Inventory,[...r11.files.map(r=>r.path),FROZEN_SOURCE_UNION_R11].sort());
 assert.equal(JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R8)).files.length,525,'R8 full root remains frozen');
 const r7=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R7));assert.equal(r7.files.length,521);
 const r7Inventory=execFileSync('git',['--no-replace-objects','diff','--no-renames','--name-only','-z',INTEGRATION_BASE,SOURCE_UNION_R8_BASE,'--'],{cwd:new URL('../',import.meta.url),encoding:'utf8'}).split('\0').filter(Boolean).sort();
 assert.equal(r7Inventory.length,522);assert.deepEqual(r7Inventory,[...r7.files.map(r=>r.path),FROZEN_SOURCE_UNION_R7].sort());
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
test('all original Registry admission assertions have verified unchanged prior CI evidence at exact1db AFTER current admission', {timeout:150000},()=>{
 const r=reuseSourceUnionPinnedProof('registry');assert.equal(r.revision,SOURCE_UNION_PARENTS.registry);
 assert.equal(r.prior_cleanup_evidence,'VERIFIED_REMOVED_BY_PRIOR_EXECUTION');
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
test('all c131/4469/8c/cbb roots remain immutable even after new-root rehash or receipt-parent substitution',()=>{
 for(const path of [FROZEN_SOURCE_UNION,FROZEN_SOURCE_UNION_NORMALIZER,FROZEN_SOURCE_UNION_R2,FROZEN_SOURCE_UNION_R3]){
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
 const current=names(currentText);assert.equal(current.length,77);
 const r11Text=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R12_BASE+':tests/test_issuer_pdf_descriptor.py'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 const r11=names(r11Text);assert.equal(r11.length,65);for(const name of r11)assert(current.includes(name),'all65 R11 synthetic controls must remain: '+name);
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
 assert.equal(oldBodies.size,45);assert.equal(newBodies.size,77);for(const [name,body]of oldBodies)assert.equal(newBodies.get(name),body,'unchanged original Python assertion body: '+name);
 const r11Bodies=bodies(r11Text);assert.equal(r11Bodies.size,65);for(const [name,body]of r11Bodies)assert.equal(newBodies.get(name),body,'unchanged R11 Python assertion body: '+name);
 // Keep the previously reviewed 62 controls AND their surrounding source bytes.
 // Only this exact added helper/three-control segment is removed for comparison;
 // this is not an exemption for current parser bytes or a private PDF replay.
 const addedStart=r11Text.indexOf('    def q4_ratio_fixture('),addedEnd=r11Text.indexOf('def local_replay(',addedStart);
 assert(addedStart>0&&addedEnd>addedStart);
 const prior62=r11Text.slice(0,addedStart)+'\n'+r11Text.slice(addedEnd);
 assert.equal(integrationHash(Buffer.from(prior62)),'6b47af5d9d3e97bee5edc91886568f591753c868d63475919c864e29458786da');
 assert.equal(names(prior62).length,62);
 assert.deepEqual(r11.filter(name=>!names(prior62).includes(name)),[
  'test_q4_actual_cell_cannot_be_yoy_or_qoq','test_q4_padded_quarter_locator_cannot_include_ratio','test_q4_expanded_axis_keeps_native_actual_cell',
 ]);
 assert.deepEqual(current.filter(name=>!r11.includes(name)),[
  'test_public_link_unknown_transport_stays_unknown','test_public_link_cannot_forge_transport_or_publication',
  'test_public_link_binds_bytes_path_exact_link_period_and_private_source','test_public_link_no_extra_capture_self_approval_headers_or_future_copy',
  'test_direct_interim_common_note_native_pair','test_content_flow_is_version_selected_not_global_text_guessing',
  'test_content_flow_preserves_stated_unit_exception_not_ytd_or_approval','test_interim_revenue_must_not_use_the_percentage_cell_in_same_quarter',
  'test_interim_cannot_take_ytd_or_prior_year_even_with_expanded_axis','test_interim_note_period_shares_units_and_native_eps_must_agree',
  'test_interim_no_unrelated_currency_note_or_diluted_row','test_adjacent_note_decimal_only_when_native_tokens_touch',
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
test('all13 original c131 union assertions have verified unchanged prior CI evidence AFTER current admission with verified cleanup', {timeout:150000},()=>{
 const r=reuseSourceUnionPinnedProof('union');assert.equal(r.revision,SOURCE_UNION_NORMALIZER_BASE);
 assert.deepEqual(r.tests,['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']);
 assert.equal(r.prior_tests_total,13);assert.equal(r.prior_tests_passed,13);assert.equal(r.prior_cleanup_evidence,'VERIFIED_REMOVED_BY_PRIOR_EXECUTION');
});
test('R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7/R8 replacements differ in current',()=>{
 const m=verifyIntegrationCandidate(),r3=m.source_union.r3;
 assert.equal(SOURCE_UNION_R3_BASE,'8c110263ddcf83e4471dfc8e32adafd1c47c2c40');
 assert.equal(SOURCE_UNION_SUPPORT.length,5);assert.equal(r3.files.length,8);
 assert.deepEqual(r3.files,SOURCE_UNION_R3_FILES);assert.deepEqual(r3.files.reduce((counts,row)=>(counts[row.group]=(counts[row.group]??0)+1,counts),{}),{pdf:2,capacity:2,delivery:1,evaluator:3});
 for(const row of r3.files){
  assert(!SOURCE_UNION_SUPPORT.includes(row.path));
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R4_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(old),row.after_sha256,'unchanged R3 generation at exact cbb');
  const replacement=SOURCE_UNION_R14_FILES.find(r=>r.path===row.path)??SOURCE_UNION_R12_FILES.find(r=>r.path===row.path)??SOURCE_UNION_R9_FILES.find(r=>r.path===row.path)??SOURCE_UNION_R8_FILES.find(r=>r.path===row.path)??SOURCE_UNION_R7_FILES.find(r=>r.path===row.path)??SOURCE_UNION_R4_FILES.find(r=>r.path===row.path);
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),replacement?.after_sha256??row.after_sha256);
  assert.equal(integrationPhysicalMode(row.path),'100644');
 }
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
test('all21 unchanged R2 assertions reuse verified exact8c evidence under the R4 CI; no new historical execution',()=>{
 const r=reuseSourceUnionPinnedProof('r2');assert.equal(r.revision,SOURCE_UNION_R3_BASE);assert.equal(r.prior_tests_total,21);assert.equal(r.prior_tests_passed,21);assert.equal(r.prior_cleanup_evidence,'VERIFIED_REMOVED_BY_PRIOR_EXECUTION');
});
test('R4 pins exactly four loader/metadata sources over cbb without source rights or Worker activation',()=>{
 const m=verifyIntegrationCandidate(),r4=m.source_union.r4;
 assert.equal(SOURCE_UNION_R4_BASE,'cbb1fa65c925c3d0a5a437ca3d2916db34425cd1');
 assert.deepEqual(r4,sourceUnionR4Lineage());assert.equal(SOURCE_UNION_SUPPORT.length,5);
 assert.deepEqual(r4.files.map(r=>r.path),[
  'supabase/functions/_shared/decision-v1-data.ts','supabase/functions/_shared/decision-v1-evidence.ts',
  'tests/v1EarningsMetadataRead.test.mjs','tests/v1FundamentalRevisionDatabase.integration.mjs',
 ]);
 for(const row of r4.files){
  assert(!SOURCE_UNION_SUPPORT.includes(row.path));assert.equal(integrationPhysicalMode(row.path),'100644');
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),SOURCE_UNION_R14_FILES.find(r=>r.path===row.path)?.after_sha256??row.after_sha256);
 }
 assert.equal(r4.prior_root.path,FROZEN_SOURCE_UNION_R3);
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R3)),'0bed00b3d21f3776dc875d505eef45e31e2af546e5cbfa0e798f13e8f1258f56');
 const prior=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R3));assert.equal(prior.files.length,512);
 assert.deepEqual(m.source_union.r3,prior.source_union.r3,'R3 lineage must never be rewritten to R4 bytes');
 for(const flag of ['source_admission','canonical_admission','production_authorized','thresholds_changed','worker_payload_changed','cle_payload_changed'])assert.equal(r4[flag],false);
});
test('R4 every source rejects warm tamper and reflected root, R3 or R4 hashes',()=>{
 for(const row of SOURCE_UNION_R4_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_R4')]));
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r4.files.find(r=>r.path===row.path).after_sha256=reflected;
  const old=f.manifest.source_union.r3.files.find(r=>r.path===row.path);if(old)old.after_sha256=reflected;
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('R4 all four sources reject missing, executable, symlink, renamed and unknown paths',()=>{
 for(const row of SOURCE_UNION_R4_FILES){
  const f=fixture();assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===row.path)throw Error('R4_MISSING');return f.read(p);},f.paths,f.mode),/R4_MISSING/);
  for(const mode of ['100755','120000']){
   const g=fixture();g.modes.set(row.path,mode);g.manifest.files.find(r=>r.path===row.path).mode=mode;g.manifest.source_union.r4.files.find(r=>r.path===row.path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);
  }
  const extra=fixture();extra.paths.push(row.path+'.unreviewed');assert.throws(extra.verify,/UNKNOWN_PATH/);
  const removed=fixture();removed.paths.splice(removed.paths.indexOf(row.path),1);assert.throws(removed.verify,/UNKNOWN_PATH/);
  const renamed=fixture();renamed.manifest.files.find(r=>r.path===row.path).path+='-renamed';renamed.reseal();assert.throws(renamed.verify,/EXACT_SCOPE/);
 }
});
test('R4 cbb rollback or mixed loader/evaluator generations cannot self-seal',()=>{
 const existing=SOURCE_UNION_R4_FILES.filter(r=>r.before_sha256!==null);
 for(const rows of [existing,...existing.map(row=>[row])]){
  const f=fixture();for(const row of rows){
   const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R4_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
   f.bytes.set(row.path,old);f.manifest.files.find(r=>r.path===row.path).after_sha256=integrationHash(old);
   f.manifest.source_union.r4.files.find(r=>r.path===row.path).after_sha256=integrationHash(old);
  }
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);
 }
});
test('R4 lineage cannot reflect mutable parents, altered scope, hashes or authorization claims',()=>{
 for(const change of [r=>r.base='HEAD',r=>r.files.pop(),r=>r.files.push({...r.files[0],path:'UNREVIEWED'}),
  r=>r.files[0].before_sha256=null,r=>r.files[0].after_sha256='0'.repeat(64),r=>r.files[0].path='src/features/vnext/dailyRuntime.ts',
  r=>r.prior_root.sha256='0'.repeat(64),r=>r.prior_root.revision=SOURCE_UNION_R3_BASE,r=>r.prior_proof.tests=0,
  r=>r.prior_proof.files[0].sha256='0'.repeat(64),r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.production_authorized=true,r=>r.thresholds_changed=true,r=>r.worker_payload_changed=true,r=>r.cle_payload_changed=true,
  r=>r.evidence='PRODUCTION_AUTH_OR_SOURCE_RIGHTS_PROVED']){
  const f=fixture();change(f.manifest.source_union.r4);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
 const f=fixture();f.manifest.source_union.support_paths.push(SOURCE_UNION_R4_FILES[0].path);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
});
test('R4 CI retains current metadata regression and bounded real JSONB fixture after complete admission',()=>{
 verifyIntegrationCandidate();const workflow=integrationPhysicalRead('.github/workflows/v1-source-integration.yml').toString();
 const gate=workflow.indexOf('run: node --experimental-strip-types --test --test-concurrency=1 tests/originalIngressAdmission.test.mjs tests/officialPublicAdmission.test.mjs');
 const metadata=workflow.indexOf('tests/v1EarningsMetadataRead.test.mjs');assert(gate>=0&&metadata>gate);
 assert(workflow.includes('needs: current-union'));assert(workflow.includes('timeout-minutes: 5'));
 const admission=workflow.indexOf('verifyIntegrationCandidate();'),prepare=workflow.indexOf('run: docker pull postgres:17');
 const fixture=workflow.indexOf('run: timeout 120s node --experimental-strip-types tests/v1FundamentalRevisionDatabase.integration.mjs');
 assert(admission>=0&&prepare>admission&&fixture>prepare);
 assert(!workflow.includes('continue-on-error:'));assert(!workflow.includes('secrets.'));
});
test('R4 all28 unchanged R3 assertions reuse exact cbb evidence under verified R4 CI; no new clones', {timeout:450000},()=>{
 const r=reuseSourceUnionPinnedProof('r3');assert.equal(r.revision,SOURCE_UNION_R4_BASE);
 assert.equal(r.prior_tests_total,28);assert.equal(r.prior_tests_passed,28);assert.equal(r.prior_cleanup_evidence,'VERIFIED_REMOVED_BY_PRIOR_EXECUTION');
});
test('R5 pins precisely the four frozen code deltas over dfec and revalidates all R4 source/root bytes',()=>{
 const m=verifyIntegrationCandidate(),r5=m.source_union.r5;
 assert.equal(SOURCE_UNION_R5_BASE,'dfec08a533f6c6da299ecc879af96fc49cca5d59');
 assert.deepEqual(r5,sourceUnionR5Lineage());assert.equal(SOURCE_UNION_SUPPORT.length,5);
 assert.deepEqual(r5.files.map(r=>r.path),[
  'research/official-daily-open-data-candidate.ts','tests/officialDailyOpenDataCandidate.test.mjs',
  'src/features/vnext/publicationClearance.ts','tests/officialDailyLicenseScope.test.mjs',
 ]);
 for(const row of r5.files){
  assert(!SOURCE_UNION_SUPPORT.includes(row.path));assert.equal(integrationPhysicalMode(row.path),row.mode);
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),row.after_sha256);
 }
 assert.equal(r5.prior_root.path,FROZEN_SOURCE_UNION_R4);
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R4)),'0ca370d03f4453f410c295880f074acaf703da10912cd1a7a1af874539b69fb4');
 const old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R4));assert.equal(old.files.length,515);
 for(const generation of ['normalizer','r3','r4'])assert.deepEqual(m.source_union[generation],old.source_union[generation]);
 for(const row of SOURCE_UNION_R4_FILES){
  const bytes=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R5_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(bytes),row.after_sha256);
  const replacement=SOURCE_UNION_R14_FILES.find(r=>r.path===row.path);
  if(replacement){
   assert.deepEqual(execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R14_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)}),bytes);
   assert.equal(integrationHash(integrationPhysicalRead(row.path)),replacement.after_sha256);
  }else assert.deepEqual(integrationPhysicalRead(row.path),bytes);
  assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 const oldTest=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R5_BASE+':tests/originalIngressAdmission.test.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert(oldTest.includes("assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261021-v1-source-union-r4.json');"));
 assert(oldTest.includes('assert.equal(m.files.length,515);assert.equal(integrationInventory().length,516);'));
 for(const flag of ['source_admission','canonical_admission','publication_approval','production_authorized','thresholds_changed','rights_gate_changed','worker_payload_changed','cle_payload_changed'])assert.equal(r5[flag],false);
});
test('R5 each source refuses warm tamper even after reflecting hashes into the full root and R5 lineage',()=>{
 for(const row of SOURCE_UNION_R5_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_R5')]));
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r5.files.find(r=>r.path===row.path).after_sha256=reflected;f.reseal();
  assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('R5 every source refuses deletion, executable/symlink mode, renamed and unknown paths',()=>{
 for(const row of SOURCE_UNION_R5_FILES){
  const f=fixture(),missing=p=>{if(p===row.path)throw Error('R5_MISSING');return f.read(p);};
  assert.throws(()=>verifyIntegrationCandidate(missing,f.paths,f.mode),/R5_MISSING/);
  assert.throws(()=>createSourceUnionComposition(missing,f.paths,f.mode),/R5_MISSING/);
  for(const mode of ['100755','120000']){
   const g=fixture();g.modes.set(row.path,mode);g.manifest.files.find(r=>r.path===row.path).mode=mode;
   g.manifest.source_union.r5.files.find(r=>r.path===row.path).mode=mode;g.reseal();
   assert.throws(g.verify,/MODE_DRIFT/);assert.throws(()=>createSourceUnionComposition(g.read,g.paths,g.mode),/MODE_DRIFT/);
  }
  const extra=fixture();extra.paths.push(row.path+'.unreviewed');assert.throws(extra.verify,/UNKNOWN_PATH/);
  const removed=fixture();removed.paths.splice(removed.paths.indexOf(row.path),1);assert.throws(removed.verify,/UNKNOWN_PATH/);
  const renamed=fixture();renamed.manifest.files.find(r=>r.path===row.path).path+='-renamed';renamed.reseal();assert.throws(renamed.verify,/EXACT_SCOPE/);
 }
});
test('R5 each actual filesystem symlink is refused without following an otherwise exact source',()=>{
 const folder=mkdtempSync(join(tmpdir(),'ma-r5-symlink-'));
 try{
  for(const row of SOURCE_UNION_R5_FILES){
   const link=join(folder,basename(row.path));symlinkSync(new URL('../'+row.path,import.meta.url),link);
   assert(lstatSync(link).isSymbolicLink());
   const read=p=>p===row.path?readRegularIntegrationFile(link):integrationPhysicalRead(p);
   assert.throws(()=>verifyIntegrationCandidate(read),/INTEGRATION_REGULAR_FILE/);
   assert.throws(()=>createSourceUnionComposition(read),/INTEGRATION_REGULAR_FILE/);
  }
 }finally{rmSync(folder,{recursive:true,force:true});assert(!existsSync(folder));}
});
test('R5 each dfec rollback and the complete/mixed old generation fail despite forged current hashes',()=>{
 for(const rows of [SOURCE_UNION_R5_FILES,...SOURCE_UNION_R5_FILES.map(row=>[row])]){
  const f=fixture(),missing=new Set();
  for(const row of rows){
   if(row.before_sha256===null){
    missing.add(row.path);f.paths.splice(f.paths.indexOf(row.path),1);
    f.manifest.files.splice(f.manifest.files.findIndex(r=>r.path===row.path),1);
    f.manifest.source_union.r5.files.splice(f.manifest.source_union.r5.files.findIndex(r=>r.path===row.path),1);
   }else{
    const bytes=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R5_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
    assert.equal(integrationHash(bytes),row.before_sha256);f.bytes.set(row.path,bytes);
    f.manifest.files.find(r=>r.path===row.path).after_sha256=integrationHash(bytes);
    f.manifest.source_union.r5.files.find(r=>r.path===row.path).after_sha256=integrationHash(bytes);
   }
  }
  f.reseal();const read=p=>{if(missing.has(p))throw Error('R5_ROLLBACK_ABSENT');return f.read(p);};
  assert.throws(()=>verifyIntegrationCandidate(read,f.paths,f.mode),/SOURCE_DRIFT|R5_ROLLBACK_ABSENT/);
  assert.throws(()=>createSourceUnionComposition(read,f.paths,f.mode),/SOURCE_DRIFT|R5_ROLLBACK_ABSENT/);
 }
});
test('R5 rehashed old R4 root, old R4 sources and substituted historical receipts are never grandfathered',()=>{
 for(const path of [FROZEN_SOURCE_UNION_R4,...SOURCE_UNION_R4_FILES.map(r=>r.path)]){
  const f=fixture();f.verify();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\nFORGED_R4')]));
  const reflected=integrationHash(f.read(path));f.manifest.files.find(r=>r.path===path).after_sha256=reflected;
  if(path===FROZEN_SOURCE_UNION_R4)f.manifest.source_union.r5.prior_root.sha256=reflected;
  else f.manifest.source_union.r4.files.find(r=>r.path===path).after_sha256=reflected;
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
  for(const mode of ['100755','120000']){
   const g=fixture();g.modes.set(path,mode);g.manifest.files.find(r=>r.path===path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);
  }
  assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===path)throw Error('R4_MISSING');return integrationPhysicalRead(p);}),/R4_MISSING/);
 }
});
test('R5 cannot self-approve mutable parents, altered pins/proofs, source rights, rightsGate or Production',()=>{
 for(const change of [r=>r.base='HEAD',r=>r.base=SOURCE_UNION_R4_BASE,r=>r.files.pop(),r=>r.files.push({...r.files[0],path:'UNREVIEWED'}),
  r=>r.files[0].before_sha256='0'.repeat(64),r=>r.files[0].after_sha256='0'.repeat(64),r=>r.files[0].path='src/features/vnext/dailyRuntime.ts',
  r=>r.prior_root.sha256='0'.repeat(64),r=>r.prior_root.revision=SOURCE_UNION_R4_BASE,r=>r.prior_proof.tests=28,
  r=>r.prior_proof.revision='HEAD',r=>r.prior_proof.files[0].sha256='0'.repeat(64),r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.publication_approval=true,r=>r.production_authorized=true,r=>r.thresholds_changed=true,r=>r.rights_gate_changed=true,
  r=>r.worker_payload_changed=true,r=>r.cle_payload_changed=true,r=>r.evidence='REAL_SOURCE_OR_RIGHTS_APPROVED']){
  const f=fixture();change(f.manifest.source_union.r5);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
 for(const row of SOURCE_UNION_R5_FILES){const f=fixture();f.manifest.source_union.support_paths.push(row.path);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);}
});
test('R6 explicitly reuses all35 exact dfec R4 assertions; does not claim current historical execution', {timeout:870000},()=>{
 const r=reuseSourceUnionPinnedProof('r4');assert.equal(r.revision,SOURCE_UNION_R5_BASE);
 assert.deepEqual(r.tests,['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']);
 assert.equal(r.prior_tests_total,35);assert.equal(r.prior_tests_passed,35);assert.equal(r.prior_cleanup_evidence,'VERIFIED_REMOVED_BY_PRIOR_EXECUTION');
});
test('R6 preserves the exact R5 root and all four source deltas while classifying historical reuse truthfully',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(m.source_union.r6,sourceUnionR6Lineage());
 assert.equal(SOURCE_UNION_R6_BASE,'2d59c622ad302148039d0c0a9c5612851e2694f8');
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R5)),'70ca483c3f20a695adb4d49913a8f98b40b96c091ae07b4f8d653f986efa7ca3');
 const old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R5));
 assert.deepEqual(m.source_union.r5,old.source_union.r5);assert.equal(old.files.length,519);
 for(const view of ['actual','registry','historical','union','r2','r3','r4']){
  const r=reuseSourceUnionPinnedProof(view);
  assert.equal(r.execution,'REUSED_VERIFIED_PRIOR_CI_NOT_CURRENT_EXECUTION');
  assert.equal(r.tests_executed_here,0);assert.equal(r.production_verified,false);
  assert.equal(r.current_source_admission,'VERIFIED_BEFORE_REFERENCE');
  assert.equal(r.ci_reference.head,SOURCE_UNION_R5_BASE);assert.equal(r.ci_reference.check_run_id,118862262592);
  assert.equal(r.ci_reference.check_name,'current-union');assert.equal(r.ci_reference.conclusion,'success');
  assert.equal(r.ci_reference.url,'https://github.com/sonytzeng/morning-alpha/actions/runs/39490554002/job/118862262592');
  assert.equal(r.ci_reference.reuse_scope,'BYTE_IDENTICAL_IMMUTABLE_PARENT_PROOFS_ONLY_NOT_CURRENT_CODE_OR_PRODUCTION');
  assert.equal(r.ci_reference.prior_current_skips,0);
 }
 assert.throws(()=>reuseSourceUnionPinnedProof('HEAD'),/UNKNOWN_PARENT/);
 assert.throws(()=>reuseSourceUnionPinnedProof('not-verified-new-head'),/UNKNOWN_PARENT/);
 assert(Object.isFrozen(SOURCE_UNION_PRIOR_CI));
});
test('R6 cannot self-certify a different CI head/result, old root, runtime grant or source interpretation',()=>{
 for(const mutate of [r=>r.base='HEAD',r=>r.prior_root.sha256='0'.repeat(64),r=>r.prior_ci.head='HEAD',
  r=>r.prior_ci.conclusion='skipped',r=>r.prior_ci.check_run_id++,r=>r.prior_ci.prior_current_skips=1,
  r=>r.prior_ci.prior_current_tests=0,r=>r.current_historical_execution=true,r=>r.current_code_tests_required=false,
  r=>r.original_assertions_preserved_at_exact_parents=false,r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.production_authorized=true,r=>r.thresholds_changed=true,r=>r.worker_payload_changed=true]){
  const f=fixture();mutate(f.manifest.source_union.r6);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
 const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R6_BASE+':tests/originalIngressAdmission.test.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert(old.includes("verifySourceUnionPinnedProof('r4')"),'original executable assertions and reproducer remain at immutable R5');
 assert(old.includes('assert.equal(r.tests_run,35);assert.equal(r.tests_passed,35)'));
});
test('R7 admits only the existing private refresh caller, its controls and current Master over frozen R6',()=>{
 const m=verifyIntegrationCandidate(),r=m.source_union.r7,old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R6));
 assert.deepEqual(r,sourceUnionR7Lineage());assert.equal(SOURCE_UNION_R7_BASE,'fb1370106ac19df04033b0025644edeb14896d42');
 assert.equal(old.files.length,520);assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R6)),'561f245b3494020bf1ba6c9aea67adaa08ada8459d10a6ca4316a2d6c0a3a64d');
 assert.deepEqual(r.files.map(f=>f.path),['docs/operations/PRODUCT_DELIVERY_MASTER.md','scripts/vnext/event-alignment-refresh.mjs','tests/eventAlignmentRefresh.test.mjs']);
 for(const row of r.files){
  const immutable=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R8_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(immutable),row.after_sha256);
  const replacement=SOURCE_UNION_R12_FILES.find(f=>f.path===row.path)??SOURCE_UNION_R9_FILES.find(f=>f.path===row.path)??SOURCE_UNION_R8_FILES.find(f=>f.path===row.path);
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),replacement?.after_sha256??row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
  assert.equal(old.files.find(f=>f.path===row.path).after_sha256,row.before_sha256);assert(!SOURCE_UNION_SUPPORT.includes(row.path));
 }
 for(const generation of ['normalizer','r3','r4','r5','r6'])assert.deepEqual(m.source_union[generation],old.source_union[generation]);
 for(const flag of ['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','worker_payload_changed','cle_payload_changed'])assert.equal(r[flag],false);
});
test('R7 rejects source replacement, reflected hashes, missing files and executable or symlink modes',()=>{
 for(const row of SOURCE_UNION_R7_FILES){
  const f=fixture();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_R7')]));
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r7.files.find(r=>r.path===row.path).after_sha256=reflected;f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);
  assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
  for(const mode of ['100755','120000']){const g=fixture();g.modes.set(row.path,mode);g.manifest.files.find(r=>r.path===row.path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);}
  const missing=fixture();assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===row.path)throw Error('R7_MISSING');return missing.read(p);},missing.paths,missing.mode),/R7_MISSING/);
 }
});
test('R7 cannot claim source, rights, quality, Production, payload or method approval by resealing',()=>{
 for(const change of [r=>r.base='HEAD',r=>r.prior_root.sha256='0'.repeat(64),r=>r.files.pop(),r=>r.files[0].before_sha256=null,
  r=>r.input_scope='VERIFIED_SOURCE_RECEIPTS',r=>r.source_admission=true,r=>r.canonical_admission=true,r=>r.quality_approval=true,
  r=>r.rights_gate_changed=true,r=>r.publication_approval=true,r=>r.production_authorized=true,r=>r.thresholds_changed=true,
  r=>r.worker_payload_changed=true,r=>r.cle_payload_changed=true,r=>r.original_assertions_preserved_at_exact_parents=false]){
  const f=fixture();change(f.manifest.source_union.r7);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
});
test('R8 pins seven independent exact before/after deltas and preserves the full frozen R7 root and lineage',()=>{
 const m=verifyIntegrationCandidate(),r=m.source_union.r8,old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R7));
 assert.equal(SOURCE_UNION_R8_BASE,'44baf6b5663d9b7bf251d3f2ab16d2e00fd66e70');assert.deepEqual(r,sourceUnionR8Lineage());
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R7)),'e64bcc91568afa112ab31bc3d68a5426291cd90dd2a177e4a2352a717b1b9916');
 assert.equal(old.files.length,521);assert.equal(SOURCE_UNION_R8_FILES.length,7);
 assert.deepEqual(r.files.map(f=>f.path),['research/issuer-actual-v1-input.ts','research/recommendation-official-source-join.ts',
  'scripts/official-actuals/evaluate-public-v1.mjs','tests/retainedIssuerActuals.test.mjs','tests/officialV1SourceJoin.test.mjs',
  'docs/operations/PRODUCT_DELIVERY_MASTER.md','docs/operations/evidence/v1-source-gap-matrix-20261021.json']);
 const added=r.files.filter(f=>f.before_sha256===null).map(f=>f.path);
 const r9Added=SOURCE_UNION_R9_FILES.filter(f=>f.before_sha256===null).map(f=>f.path);
 const r10Added=SOURCE_UNION_R10_FILES.filter(f=>!old.files.some(r=>r.path===f.path)).map(f=>f.path);
 const r12Added=SOURCE_UNION_R12_FILES.filter(f=>f.before_sha256===null).map(f=>f.path);
 assert.equal(added.length,3);assert.deepEqual(m.files.map(f=>f.path),[...old.files.map(f=>f.path),FROZEN_SOURCE_UNION_R7,...added,FROZEN_SOURCE_UNION_R8,...r9Added,FROZEN_SOURCE_UNION_R9,...r10Added,FROZEN_SOURCE_UNION_R10,FROZEN_SOURCE_UNION_R11,...r12Added,FROZEN_SOURCE_UNION_R13].sort());
 assert.equal(m.files.length,537);assert.deepEqual(integrationInventory(),[...m.files.map(f=>f.path),INTEGRATION_MANIFEST].sort());
 for(const row of r.files){
  const replacement=SOURCE_UNION_R12_FILES.find(f=>f.path===row.path)??SOURCE_UNION_R11_FILES.find(f=>f.path===row.path)??SOURCE_UNION_R9_FILES.find(f=>f.path===row.path);
  const immutable=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R9_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(immutable),row.after_sha256,'exact R8 generation remains pinned');
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),replacement?.after_sha256??row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
  assert.equal(old.files.find(f=>f.path===row.path)?.after_sha256??null,row.before_sha256);
  assert(!SOURCE_UNION_SUPPORT.includes(row.path));assert.equal(m.files.find(f=>f.path===row.path).origin,'composition');
 }
 for(const generation of ['normalizer','r3','r4','r5','r6','r7'])assert.deepEqual(m.source_union[generation],old.source_union[generation]);
 const master=r.files.find(f=>f.path==='docs/operations/PRODUCT_DELIVERY_MASTER.md');
 assert.equal(master.before_sha256,SOURCE_UNION_R7_FILES.find(f=>f.path===master.path).after_sha256);
 assert.deepEqual(r.supersedes,[{path:master.path,prior_generation:'r7',before_sha256:master.before_sha256,after_sha256:master.after_sha256,
  prior_root_unchanged:true,prior_assertions:'PRESERVED_AT_EXACT_44BAF6B_PARENT_WITH_CURRENT_DRIFT_CONTROLS'}]);
 assert.equal(r.current_code_tests_required,true);assert.equal(r.current_historical_execution,false);
});
test('R8 every source rejects warm drift and reflected root, R7 and R8 lineage hashes',()=>{
 for(const row of SOURCE_UNION_R8_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_R8')]));
  assert.throws(f.verify,/SOURCE_DRIFT/);
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r8.files.find(r=>r.path===row.path).after_sha256=reflected;
  const previous=f.manifest.source_union.r7.files.find(r=>r.path===row.path);if(previous)previous.after_sha256=reflected;
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('R8 all seven paths reject deletion, executable/symlink modes, renamed rows and unknown inventory',()=>{
 for(const {path}of SOURCE_UNION_R8_FILES){
  const f=fixture();
  assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===path)throw Error('R8_MISSING');return f.read(p);},f.paths,f.mode),/R8_MISSING/);
  for(const mode of ['100755','120000']){
   f.modes.set(path,mode);f.manifest.files.find(r=>r.path===path).mode=mode;f.reseal();assert.throws(f.verify,/MODE_DRIFT/);
  }
  const renamed=fixture();renamed.manifest.files.find(r=>r.path===path).path=path+'.renamed';renamed.reseal();assert.throws(renamed.verify,/EXACT_SCOPE/);
  for(const paths of [f.paths.filter(p=>p!==path),[...f.paths,path+'.unknown']])assert.throws(()=>verifyIntegrationCandidate(f.read,paths,integrationPhysicalMode),/UNKNOWN_PATH/);
 }
});
test('R8 physical symlinks cannot impersonate any of the seven exact source files',()=>{
 const folder=mkdtempSync(join(tmpdir(),'ma-r8-symlink-'));
 try{
  for(const {path}of SOURCE_UNION_R8_FILES){
   const link=join(folder,basename(path));symlinkSync(new URL('../'+path,import.meta.url),link);
   assert(lstatSync(link).isSymbolicLink());assert.throws(()=>readRegularIntegrationFile(link),/REGULAR_FILE/);
   assert.throws(()=>verifyIntegrationCandidate(p=>p===path?readRegularIntegrationFile(link):integrationPhysicalRead(p)),/REGULAR_FILE/);
  }
 }finally{rmSync(folder,{recursive:true,force:true});assert(!existsSync(folder));}
});
test('R8 refuses each exact R7 rollback and mixed old generations despite reflected hashes',()=>{
 const existing=SOURCE_UNION_R8_FILES.filter(r=>r.before_sha256!==null);
 for(const rows of [...existing.map(r=>[r]),existing]){
  const f=fixture();f.verify();
  for(const row of rows){
   const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R8_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
   assert.equal(integrationHash(old),row.before_sha256);f.bytes.set(row.path,old);
   f.manifest.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;
   f.manifest.source_union.r8.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;
  }
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('R8 frozen R7 root bytes, mode and historical proof identities cannot be resealed or substituted',()=>{
 const f=fixture(),path=FROZEN_SOURCE_UNION_R7;f.verify();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\n')]));
 const reflected=integrationHash(f.read(path));f.manifest.files.find(r=>r.path===path).after_sha256=reflected;
 f.manifest.source_union.r8.prior_root.sha256=reflected;f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);
 assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 const mode=fixture();mode.modes.set(path,'100755');mode.manifest.files.find(r=>r.path===path).mode='100755';mode.reseal();assert.throws(mode.verify,/MODE_DRIFT/);
 for(const mutate of [r=>r.prior_root.revision=SOURCE_UNION_R7_BASE,r=>r.prior_root.path=FROZEN_SOURCE_UNION_R6,
  r=>r.prior_proof.revision='HEAD',r=>r.prior_proof.tests=0,r=>r.prior_proof.files.pop(),r=>r.prior_proof.files[0].sha256='0'.repeat(64)]){
  const g=fixture();mutate(g.manifest.source_union.r8);g.reseal();assert.throws(g.verify,/LINEAGE_DRIFT/);
 }
});
test('R8 cannot self-certify altered pins, Master supersession, business review, rights, deployment or payload approval',()=>{
 for(const mutate of [r=>r.base='HEAD',r=>r.files.pop(),r=>r.files[0].after_sha256='0'.repeat(64),r=>r.files[1].before_sha256=null,
  r=>r.supersedes=[],r=>r.supersedes[0].before_sha256='0'.repeat(64),r=>r.supersedes[0].prior_root_unchanged=false,
  r=>r.input_scope='BUSINESS_DATA_REVIEW_PASSED',r=>r.current_code_tests_required=false,r=>r.current_historical_execution=true,
  r=>r.original_assertions_preserved_at_exact_parents=false,r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.quality_approval=true,r=>r.rights_gate_changed=true,r=>r.publication_approval=true,r=>r.production_authorized=true,
  r=>r.thresholds_changed=true,r=>r.worker_payload_changed=true,r=>r.cle_payload_changed=true]){
  const f=fixture();mutate(f.manifest.source_union.r8);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
 const subset=fixture();subset.manifest.files=subset.manifest.files.filter(r=>SOURCE_UNION_R8_FILES.some(f=>f.path===r.path));subset.reseal();assert.throws(subset.verify,/EXACT_SCOPE/);
});
test('R8 retains every R7 admission test and all unadapted assertion bodies; exact R7 source is never rewritten',()=>{
 const adapted=new Set(['R7 complete physical current union preserves R4/R5/R6 assertions at their immutable parents',
  'R4 pins exactly four loader/metadata sources over cbb without source rights or Worker activation',
  'R4 admits current evaluator before the unchanged issuer review can reconstruct its exact R9 view',
  'R5 pins precisely the four frozen code deltas over dfec and revalidates all R4 source/root bytes',
  'R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7 replacements differ in current',
  'R7 admits only the existing private refresh caller, its controls and current Master over frozen R6',
  'R3 CI runs full admission before fixed Python controls, capacity negatives and current evaluator regressions',
  'R5 full PR composition adds the old R4 root and three new paths, never a four-file-only seal or Worker grant']);
 const renamed=new Map([
  ['R7 complete physical current union preserves R4/R5/R6 assertions at their immutable parents','R8 complete physical current union preserves R4/R5/R6/R7 assertions at their immutable parents'],
  ['R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7 replacements differ in current','R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7/R8 replacements differ in current'],
 ]);
 const bodies=text=>{const starts=[...text.matchAll(/^test\('([^']+)'/gm)];return new Map(starts.map((r,i)=>[r[1],text.slice(r.index,starts[i+1]?.index??text.length).trimEnd()]));};
 let count=0;
 for(const path of ['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']){
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R8_BASE+':'+path],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const pin=sourceUnionR8Lineage().prior_proof.files.find(r=>r.path===path);assert.equal(integrationHash(Buffer.from(old)),pin.sha256);
  const before=bodies(old),after=bodies(integrationPhysicalRead(path).toString());count+=before.size;
  for(const [name,body]of before){
   const current=after.get(renamed.get(name)??name);assert(current,'every original test remains: '+name);
   if(!adapted.has(name))assert.equal(current,body,'unchanged original assertions: '+name);
   else assert((current.match(/\bassert[.(]/g)??[]).length>=(body.match(/\bassert[.(]/g)??[]).length,'no adapted assertion count reduction: '+name);
   assert.doesNotMatch(current.split('\n')[0],/\btest\.skip\b|\bskip\s*:/);
  }
 }
 assert.equal(count,51);assert.equal(adapted.size,8);
});
test('R9 admits the exact native PDF intake delta without changing the frozen R8 lineage or granting any business permission',()=>{
 const m=verifyIntegrationCandidate(),r=m.source_union.r9,old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R8));
 assert.deepEqual(r,sourceUnionR9Lineage());assert.equal(SOURCE_UNION_R9_FILES.length,9);
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R8)),'b773a7050a97ffc37fa2cfacf7da03cc9d855972998d1418bcae5fd92406d787');
 assert.equal(old.files.length,525);assert.deepEqual(m.source_union.r8,old.source_union.r8);
 const added=SOURCE_UNION_R9_FILES.filter(f=>f.before_sha256===null).map(f=>f.path);
 const r10Added=SOURCE_UNION_R10_FILES.filter(f=>!old.files.some(r=>r.path===f.path)).map(f=>f.path);
 const r12Added=SOURCE_UNION_R12_FILES.filter(f=>f.before_sha256===null).map(f=>f.path);
 assert.equal(added.length,3);assert.deepEqual(m.files.map(f=>f.path),[...old.files.map(f=>f.path),FROZEN_SOURCE_UNION_R8,...added,FROZEN_SOURCE_UNION_R9,...r10Added,FROZEN_SOURCE_UNION_R10,FROZEN_SOURCE_UNION_R11,...r12Added,FROZEN_SOURCE_UNION_R13].sort());
 for(const row of SOURCE_UNION_R9_FILES){
  assert.equal(old.files.find(f=>f.path===row.path)?.after_sha256??null,row.before_sha256);
  const immutable=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R10_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(immutable),row.after_sha256,'exact R9 generation remains pinned');
  const replacement=SOURCE_UNION_R12_FILES.find(f=>f.path===row.path);
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),replacement?.after_sha256??row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 for(const flag of ['source_admission','canonical_admission','quality_approval','production_authorized','publication_approval','thresholds_changed','worker_payload_changed','cle_payload_changed'])assert.equal(r[flag],false);
});
test('R9 rejects source, mode, inventory, old-generation and reflected-lineage drift before any candidate packaging',()=>{
 for(const row of SOURCE_UNION_R9_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nR9_UNREVIEWED')]));
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r9.files.find(r=>r.path===row.path).after_sha256=reflected;f.reseal();
  assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
  for(const mode of ['100755','120000']){
   const g=fixture();g.modes.set(row.path,mode);g.manifest.files.find(r=>r.path===row.path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);
  }
  const absent=fixture();assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===row.path)throw Error('R9_MISSING');return absent.read(p);},absent.paths,absent.mode),/R9_MISSING/);
  if(row.before_sha256){
   const g=fixture(),old=execFileSync('git',['show',SOURCE_UNION_R9_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
   g.bytes.set(row.path,old);g.manifest.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;
   g.manifest.source_union.r9.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;g.reseal();assert.throws(g.verify,/SOURCE_DRIFT/);
  }
 }
 for(const change of [r=>r.production_authorized=true,r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.quality_approval=true,r=>r.publication_approval=true,r=>r.thresholds_changed=true,r=>r.worker_payload_changed=true,
  r=>r.files.pop(),r=>r.base='HEAD',r=>r.prior_root.sha256='0'.repeat(64)]){
  const f=fixture();change(f.manifest.source_union.r9);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
});
test('R9 preserves all 61 R8 admission assertions at their exact parent; only five explicit current-view cases are adapted',()=>{
 const adapted=new Set(['R8 complete physical current union preserves R4/R5/R6/R7 assertions at their immutable parents',
  'R4 pins exactly four loader/metadata sources over cbb without source rights or Worker activation',
  'R4 admits current evaluator before the unchanged issuer review can reconstruct its exact R9 view',
  'R5 pins precisely the four frozen code deltas over dfec and revalidates all R4 source/root bytes',
  'R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7/R8 replacements differ in current',
  'R7 admits only the existing private refresh caller, its controls and current Master over frozen R6',
  'R3 CI runs full admission before fixed Python controls, capacity negatives and current evaluator regressions',
  'R8 retains every R7 admission test and all unadapted assertion bodies; exact R7 source is never rewritten',
  'R8 pins seven independent exact before/after deltas and preserves the full frozen R7 root and lineage',
  'R5 full PR composition adds the old R4 root and three new paths, never a four-file-only seal or Worker grant']);
 const bodies=text=>{const starts=[...text.matchAll(/^test\('([^']+)'/gm)];return new Map(starts.map((r,i)=>[r[1],text.slice(r.index,starts[i+1]?.index??text.length).trimEnd()]));};
 let count=0;
 for(const path of ['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']){
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R9_BASE+':'+path],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const before=bodies(old),after=bodies(integrationPhysicalRead(path).toString());count+=before.size;
  for(const [name,body]of before){
   const current=after.get(name);assert(current,'original test retained: '+name);
   if(!adapted.has(name))assert.equal(current,body,'all original assertions unchanged: '+name);
   else assert((current.match(/\bassert[.(]/g)??[]).length>=(body.match(/\bassert[.(]/g)??[]).length);
   assert.doesNotMatch(current.split('\n')[0],/\btest\.skip\b|\bskip\s*:/);
  }
 }
 assert.equal(count,61);assert.equal(adapted.size,10);
});
test('R10 pins only the company-event identity correction over the unchanged complete R9 root',()=>{
 const m=verifyIntegrationCandidate(),r=m.source_union.r10,old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R9));
 assert.deepEqual(r,sourceUnionR10Lineage());assert.equal(SOURCE_UNION_R10_FILES.length,2);
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R9)),'54cda51cf63f6d0c3dd2eb2729ebe6c5deb2722905cf368d140c1ec962ad8869');
 assert.equal(old.files.length,529);assert.deepEqual(m.source_union.r9,old.source_union.r9);
 const added=SOURCE_UNION_R10_FILES.filter(f=>!old.files.some(r=>r.path===f.path)).map(f=>f.path);assert.equal(added.length,2);
 const r12Added=SOURCE_UNION_R12_FILES.filter(f=>f.before_sha256===null).map(f=>f.path);
 assert.deepEqual(m.files.map(f=>f.path),[...old.files.map(f=>f.path),FROZEN_SOURCE_UNION_R9,...added,FROZEN_SOURCE_UNION_R10,FROZEN_SOURCE_UNION_R11,...r12Added,FROZEN_SOURCE_UNION_R13].sort());
 for(const row of SOURCE_UNION_R10_FILES){
  const prior=row.before_sha256===null?null:old.files.find(f=>f.path===row.path)?.after_sha256??integrationHash(execFileSync('git',['show',INTEGRATION_BASE+':'+row.path],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','ignore']}));
  assert.equal(prior,row.before_sha256);
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 for(const flag of ['source_admission','canonical_admission','quality_approval','production_authorized','publication_approval','thresholds_changed','existing_release_payloads_changed'])assert.equal(r[flag],false);
});
test('R10 rejects reflected source, mode, omission, old-generation and lineage changes',()=>{
 for(const row of SOURCE_UNION_R10_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nR10_UNREVIEWED')]));
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r10.files.find(r=>r.path===row.path).after_sha256=reflected;f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);
  assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
  const absent=fixture();assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===row.path)throw Error('R10_MISSING');return absent.read(p);},absent.paths,absent.mode),/R10_MISSING/);
  for(const mode of ['100755','120000']){const g=fixture();g.modes.set(row.path,mode);g.manifest.files.find(r=>r.path===row.path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);}
  if(row.before_sha256){const g=fixture();g.bytes.set(row.path,execFileSync('git',['show',SOURCE_UNION_R10_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)}));
   g.manifest.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;g.manifest.source_union.r10.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;g.reseal();assert.throws(g.verify,/SOURCE_DRIFT/);}
 }
 for(const change of [r=>r.production_authorized=true,r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.quality_approval=true,r=>r.publication_approval=true,r=>r.thresholds_changed=true,r=>r.existing_release_payloads_changed=true,
  r=>r.files.pop(),r=>r.base='HEAD',r=>r.prior_root.sha256='0'.repeat(64)]){
  const f=fixture();change(f.manifest.source_union.r10);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
});
test('R10 retains all 64 R9 admission cases; four full-current inventory views only are adapted',()=>{
 const adapted=new Set(['R8 complete physical current union preserves R4/R5/R6/R7 assertions at their immutable parents',
  'R4 pins exactly four loader/metadata sources over cbb without source rights or Worker activation',
  'R4 admits current evaluator before the unchanged issuer review can reconstruct its exact R9 view',
  'R5 pins precisely the four frozen code deltas over dfec and revalidates all R4 source/root bytes',
  'R3 CI runs full admission before fixed Python controls, capacity negatives and current evaluator regressions',
  'R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7/R8 replacements differ in current',
  'R7 admits only the existing private refresh caller, its controls and current Master over frozen R6',
  'R8 retains every R7 admission test and all unadapted assertion bodies; exact R7 source is never rewritten',
  'R9 preserves all 61 R8 admission assertions at their exact parent; only five explicit current-view cases are adapted',
  'R8 pins seven independent exact before/after deltas and preserves the full frozen R7 root and lineage',
  'R9 admits the exact native PDF intake delta without changing the frozen R8 lineage or granting any business permission',
  'R5 full PR composition adds the old R4 root and three new paths, never a four-file-only seal or Worker grant']);
 const bodies=text=>{const starts=[...text.matchAll(/^test\('([^']+)'/gm)];return new Map(starts.map((r,i)=>[r[1],text.slice(r.index,starts[i+1]?.index??text.length).trimEnd()]));};
 let count=0;
 for(const path of ['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']){
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R10_BASE+':'+path],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const before=bodies(old),after=bodies(integrationPhysicalRead(path).toString());count+=before.size;
  for(const [name,body]of before){const current=after.get(name);assert(current,'original test retained: '+name);
   if(!adapted.has(name))assert.equal(current,body,'original assertions unchanged: '+name);
   else assert((current.match(/\bassert[.(]/g)??[]).length>=(body.match(/\bassert[.(]/g)??[]).length);
   assert.doesNotMatch(current.split('\n')[0],/\btest\.skip\b|\bskip\s*:/);
  }
 }
 assert.equal(count,64);assert.equal(adapted.size,12);
});
test('R11 admits only the retained incremental reuse fix and preserves the complete immutable R10 root',()=>{
 const m=verifyIntegrationCandidate(),r=m.source_union.r11,old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R10));
 assert.deepEqual(r,sourceUnionR11Lineage());assert.equal(SOURCE_UNION_R11_FILES.length,2);
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R10)),'f97d3d429b3b93839522a6c8c8fdecda0ba2daa7a95fed0644143e5d1984d904');
 const r12Added=SOURCE_UNION_R12_FILES.filter(f=>f.before_sha256===null).map(f=>f.path);
 assert.equal(old.files.length,532);assert.deepEqual(m.files.map(f=>f.path),[...old.files.map(f=>f.path),FROZEN_SOURCE_UNION_R10,FROZEN_SOURCE_UNION_R11,...r12Added,FROZEN_SOURCE_UNION_R13].sort());
 for(const [key,value]of Object.entries(old.source_union))assert.deepEqual(m.source_union[key],value);
 for(const row of SOURCE_UNION_R11_FILES){
  assert.equal(old.files.find(f=>f.path===row.path)?.after_sha256,row.before_sha256);
  const immutable=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R12_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(immutable),row.after_sha256,'exact R11 generation remains pinned');
  const replacement=SOURCE_UNION_R12_FILES.find(f=>f.path===row.path);
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),replacement?.after_sha256??row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 for(const flag of ['source_admission','canonical_admission','quality_approval','production_authorized','publication_approval','thresholds_changed','existing_release_payloads_changed'])assert.equal(r[flag],false);
});
test('R11 cannot admit altered source, old code, mode, inventory, lineage, rights or deployment by resealing',()=>{
 for(const row of SOURCE_UNION_R11_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nR11_UNREVIEWED')]));
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r11.files.find(r=>r.path===row.path).after_sha256=reflected;f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);
  assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
  const absent=fixture();assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===row.path)throw Error('R11_MISSING');return absent.read(p);},absent.paths,absent.mode),/R11_MISSING/);
  for(const mode of ['100755','120000']){const g=fixture();g.modes.set(row.path,mode);g.manifest.files.find(r=>r.path===row.path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);}
  const g=fixture();g.bytes.set(row.path,execFileSync('git',['show',SOURCE_UNION_R11_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)}));
  g.manifest.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;g.manifest.source_union.r11.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;g.reseal();assert.throws(g.verify,/SOURCE_DRIFT/);
 }
 for(const change of [r=>r.production_authorized=true,r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.quality_approval=true,r=>r.publication_approval=true,r=>r.thresholds_changed=true,r=>r.existing_release_payloads_changed=true,
  r=>r.files.pop(),r=>r.base='HEAD',r=>r.prior_root.sha256='0'.repeat(64)]){
  const f=fixture();change(f.manifest.source_union.r11);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
});
test('R11 preserves all 67 R10 assertions; only five current inventory/source views are explicitly adapted',()=>{
 const adapted=new Set(['R8 complete physical current union preserves R4/R5/R6/R7 assertions at their immutable parents',
  'R4 pins exactly four loader/metadata sources over cbb without source rights or Worker activation',
  'R4 admits current evaluator before the unchanged issuer review can reconstruct its exact R9 view',
  'R5 pins precisely the four frozen code deltas over dfec and revalidates all R4 source/root bytes',
  'R3 CI runs full admission before fixed Python controls, capacity negatives and current evaluator regressions',
  'R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7/R8 replacements differ in current',
  'R7 admits only the existing private refresh caller, its controls and current Master over frozen R6',
  'R8 retains every R7 admission test and all unadapted assertion bodies; exact R7 source is never rewritten',
  'R9 preserves all 61 R8 admission assertions at their exact parent; only five explicit current-view cases are adapted',
  'R10 retains all 64 R9 admission cases; four full-current inventory views only are adapted',
  'R8 pins seven independent exact before/after deltas and preserves the full frozen R7 root and lineage',
  'R9 admits the exact native PDF intake delta without changing the frozen R8 lineage or granting any business permission',
  'R10 pins only the company-event identity correction over the unchanged complete R9 root',
  'R5 full PR composition adds the old R4 root and three new paths, never a four-file-only seal or Worker grant']);
 const bodies=text=>{const starts=[...text.matchAll(/^test\('([^']+)'/gm)];return new Map(starts.map((r,i)=>[r[1],text.slice(r.index,starts[i+1]?.index??text.length).trimEnd()]));};
 let count=0;
 for(const path of ['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']){
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R11_BASE+':'+path],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const before=bodies(old),after=bodies(integrationPhysicalRead(path).toString());count+=before.size;
  for(const [name,body]of before){const current=after.get(name);assert(current,'original test retained: '+name);
   if(!adapted.has(name))assert.equal(current,body,'original assertions unchanged: '+name);
   else assert((current.match(/\bassert[.(]/g)??[]).length>=(body.match(/\bassert[.(]/g)??[]).length);
   assert.doesNotMatch(current.split('\n')[0],/\btest\.skip\b|\bskip\s*:/);
  }
 }
 assert.equal(count,67);assert.equal(adapted.size,14);
});
test('R13 pins the exact R12 nine-file commit, both immutable roots and the full current composition without authority',()=>{
 const m=verifyIntegrationCandidate(),r=m.source_union.r12,old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R11));
 const git=(...args)=>execFileSync('git',['--no-replace-objects',...args],{cwd:new URL('../',import.meta.url)});
 assert.equal(SOURCE_UNION_R12_BASE,'3f8ad958105973d64cc7e34ae9391b2804e8ea44');
 assert.equal(SOURCE_UNION_R12_HEAD,'b7bfeba3a6047c792246bdf8393ef0ebd46bcefc');
 assert.deepEqual(git('rev-list','--parents','-n','1',SOURCE_UNION_R12_HEAD).toString().trim().split(' '),[SOURCE_UNION_R12_HEAD,SOURCE_UNION_R12_BASE]);
 assert.equal(SOURCE_UNION_R12_FILES.length,9);assert.equal(new Set(SOURCE_UNION_R12_FILES.map(f=>f.path)).size,9);
 assert.deepEqual(SOURCE_UNION_R12_FILES.map(f=>f.path).sort(),[
  'docs/operations/PRODUCT_DELIVERY_MASTER.md',FROZEN_SOURCE_UNION_R12,
  'research/issuer-actual-v1-input.ts','research/recommendation-official-source-join.ts',
  'scripts/official-actuals/issuer-pdf-descriptor.py','tests/officialV1SourceJoin.test.mjs',
  'tests/officialV1SourceJoinJsonb.integration.mjs','tests/retainedIssuerActuals.test.mjs','tests/test_issuer_pdf_descriptor.py',
 ].sort());
 assert.deepEqual(git('diff','--no-renames','--name-status','-z',SOURCE_UNION_R12_BASE,SOURCE_UNION_R12_HEAD,'--').toString().split('\0').filter(Boolean),
  [...SOURCE_UNION_R12_FILES].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0).flatMap(f=>[f.before_sha256===null?'A':'M',f.path]));
 assert.deepEqual(r,sourceUnionR12Lineage());assert.equal(r.base,SOURCE_UNION_R12_BASE);assert.equal(r.head,SOURCE_UNION_R12_HEAD);
 assert.deepEqual(r.prior_root,{revision:SOURCE_UNION_R12_BASE,path:FROZEN_SOURCE_UNION_R11,sha256:'99f045102c0e148164b0b97ad2e568e7e2865905fc54fa8f9fe1c85dde0cd269'});
 assert.deepEqual(r.approved_root,{revision:SOURCE_UNION_R12_HEAD,path:FROZEN_SOURCE_UNION_R12,sha256:'3f77e92bda7dd30921f8dbb4751f26262caddc7121ba66681d34647310fd5cb9'});
 for(const root of [r.prior_root,r.approved_root]){
  assert.equal(integrationHash(git('show',root.revision+':'+root.path)),root.sha256);
  assert.equal(integrationHash(integrationPhysicalRead(root.path)),root.sha256);assert.equal(integrationPhysicalMode(root.path),'100644');
 }
 assert.equal(old.files.length,533);for(const [key,value]of Object.entries(old.source_union))assert.deepEqual(m.source_union[key],value);
 for(const row of SOURCE_UNION_R12_FILES){
  const before=git('ls-tree',SOURCE_UNION_R12_BASE,'--',row.path).toString();
  assert.equal(before?integrationHash(git('show',SOURCE_UNION_R12_BASE+':'+row.path)):null,row.before_sha256);
  assert.equal(old.files.find(f=>f.path===row.path)?.after_sha256??null,row.before_sha256);
  assert.equal(integrationHash(git('show',SOURCE_UNION_R12_HEAD+':'+row.path)),row.after_sha256);
  assert.match(git('ls-tree',SOURCE_UNION_R12_HEAD,'--',row.path).toString(),/^100644 blob [a-f0-9]{40}\t/);
  assert.equal(integrationHash(integrationPhysicalRead(row.path)),row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
  assert.equal(row.mode,'100644');assert(!SOURCE_UNION_SUPPORT.includes(row.path));
 }
 const added=SOURCE_UNION_R12_FILES.filter(f=>f.before_sha256===null).map(f=>f.path);assert.equal(added.length,2);
 assert.deepEqual(m.files.map(f=>f.path),[...old.files.map(f=>f.path),FROZEN_SOURCE_UNION_R11,...added,FROZEN_SOURCE_UNION_R13].sort());
 assert.equal(m.schema,'CORE_MEMBER_COMPOSITION_V1');assert.equal(m.files.length,537);assert.equal(integrationInventory().length,538);
 assert.deepEqual(integrationInventory(),[...m.files.map(f=>f.path),INTEGRATION_MANIFEST].sort());
 for(const flag of flags)assert.equal(m[flag],false);
 for(const flag of ['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'])assert.equal(r[flag],false);
});
test('R13 rejects each R12 source drift even after warm admission and reflected current and lineage hashes',()=>{
 for(const row of SOURCE_UNION_R12_FILES){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nR12_UNREVIEWED')]));
  assert.throws(f.verify,/SOURCE_DRIFT/);
  const reflected=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=reflected;
  f.manifest.source_union.r12.files.find(r=>r.path===row.path).after_sha256=reflected;
  for(const generation of ['r3','r7','r8','r9','r11']){
   const prior=f.manifest.source_union[generation].files.find(r=>r.path===row.path);if(prior)prior.after_sha256=reflected;
  }
  if(row.path===FROZEN_SOURCE_UNION_R12)f.manifest.source_union.r12.approved_root.sha256=reflected;
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 }
});
test('R13 all nine R12 paths reject missing files, executable or symlink modes, renamed rows and extra inventory',()=>{
 for(const {path}of SOURCE_UNION_R12_FILES){
  const f=fixture(),missing=p=>{if(p===path)throw Error('R12_MISSING');return f.read(p);};
  assert.throws(()=>verifyIntegrationCandidate(missing,f.paths,f.mode),/R12_MISSING/);
  assert.throws(()=>createSourceUnionComposition(missing,f.paths,f.mode),/R12_MISSING/);
  for(const mode of ['100755','120000']){
   const g=fixture();g.modes.set(path,mode);g.manifest.files.find(r=>r.path===path).mode=mode;
   g.manifest.source_union.r12.files.find(r=>r.path===path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);
   assert.throws(()=>createSourceUnionComposition(g.read,g.paths,g.mode),/MODE_DRIFT/);
  }
  const renamed=fixture();renamed.manifest.files.find(r=>r.path===path).path=path+'.renamed';renamed.reseal();assert.throws(renamed.verify,/EXACT_SCOPE/);
  for(const paths of [f.paths.filter(p=>p!==path),[...f.paths,path+'.unknown']]){
   assert.throws(()=>verifyIntegrationCandidate(f.read,paths,f.mode),/UNKNOWN_PATH/);
   assert.throws(()=>createSourceUnionComposition(f.read,paths,f.mode),/UNKNOWN_PATH/);
  }
 }
});
test('R13 refuses every single and mixed R12 rollback to the exact immutable R11 parent',()=>{
 for(const rows of [...SOURCE_UNION_R12_FILES.map(row=>[row]),SOURCE_UNION_R12_FILES]){
  const f=fixture(),missing=new Set();f.verify();
  for(const row of rows){
   if(row.before_sha256===null){
    missing.add(row.path);f.paths.splice(f.paths.indexOf(row.path),1);
    f.manifest.files.splice(f.manifest.files.findIndex(r=>r.path===row.path),1);
    f.manifest.source_union.r12.files.splice(f.manifest.source_union.r12.files.findIndex(r=>r.path===row.path),1);
   }else{
    const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R12_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
    assert.equal(integrationHash(old),row.before_sha256);f.bytes.set(row.path,old);
    f.manifest.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;
    f.manifest.source_union.r12.files.find(r=>r.path===row.path).after_sha256=row.before_sha256;
   }
  }
  f.reseal();const read=p=>{if(missing.has(p))throw Error('R12_ROLLBACK_ABSENT');return f.read(p);};
  assert.throws(()=>verifyIntegrationCandidate(read,f.paths,f.mode),/SOURCE_DRIFT|R12_ROLLBACK_ABSENT/);
  assert.throws(()=>createSourceUnionComposition(read,f.paths,f.mode),/SOURCE_DRIFT|R12_ROLLBACK_ABSENT/);
 }
});
test('R13 cannot reseal the frozen R11 root or substitute R12 parent, commit, source pins, lineage or authority flags',()=>{
 const f=fixture(),path=FROZEN_SOURCE_UNION_R11;f.verify();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('\n')]));
 const reflected=integrationHash(f.read(path));f.manifest.files.find(r=>r.path===path).after_sha256=reflected;
 f.manifest.source_union.r12.prior_root.sha256=reflected;f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);
 assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
 for(const mode of ['100755','120000']){
  const g=fixture();g.modes.set(path,mode);g.manifest.files.find(r=>r.path===path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);
 }
 assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===path)throw Error('R11_ROOT_MISSING');return integrationPhysicalRead(p);}),/R11_ROOT_MISSING/);
 for(const change of [r=>r.base='HEAD',r=>r.head='HEAD',r=>r.head=SOURCE_UNION_R12_BASE,r=>r.files.pop(),
  r=>r.files.push({...r.files[0],path:'UNREVIEWED'}),r=>r.files[0].before_sha256=null,r=>r.files[0].after_sha256='0'.repeat(64),
  r=>r.files[0].path='src/features/vnext/dailyRuntime.ts',r=>r.files[0].mode='100755',
  r=>r.prior_root.revision=SOURCE_UNION_R12_HEAD,r=>r.prior_root.path=FROZEN_SOURCE_UNION_R10,r=>r.prior_root.sha256='0'.repeat(64),
  r=>r.approved_root.revision=SOURCE_UNION_R12_BASE,r=>r.approved_root.path=INTEGRATION_MANIFEST,r=>r.approved_root.sha256='0'.repeat(64),
  r=>r.owner_approval_scope='PRODUCTION_APPROVED',r=>r.source_admission=true,r=>r.canonical_admission=true,
  r=>r.quality_approval=true,r=>r.rights_gate_changed=true,r=>r.publication_approval=true,r=>r.production_authorized=true,
  r=>r.thresholds_changed=true,r=>r.existing_release_payloads_changed=true]){
  const g=fixture();change(g.manifest.source_union.r12);g.reseal();assert.throws(g.verify,/LINEAGE_DRIFT/);
 }
 for(const row of SOURCE_UNION_R12_FILES){const g=fixture();g.manifest.source_union.support_paths.push(row.path);g.reseal();assert.throws(g.verify,/LINEAGE_DRIFT/);}
 for(const flag of flags){const g=fixture();g.manifest[flag]=true;g.reseal();assert.throws(g.verify,/FORBIDDEN/);}
});
test('R13 preserves all 70 R11 admission tests with only explicit current-view and nested preservation adaptations',()=>{
 const adapted=new Set([
  'R8 complete physical current union preserves R4/R5/R6/R7 assertions at their immutable parents',
  'R3 CI runs full admission before fixed Python controls, capacity negatives and current evaluator regressions',
  'R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7/R8 replacements differ in current',
  'R4 pins exactly four loader/metadata sources over cbb without source rights or Worker activation',
  'R4 admits current evaluator before the unchanged issuer review can reconstruct its exact R9 view',
  'R5 pins precisely the four frozen code deltas over dfec and revalidates all R4 source/root bytes',
  'R7 admits only the existing private refresh caller, its controls and current Master over frozen R6',
  'R8 pins seven independent exact before/after deltas and preserves the full frozen R7 root and lineage',
  'R8 retains every R7 admission test and all unadapted assertion bodies; exact R7 source is never rewritten',
  'R9 admits the exact native PDF intake delta without changing the frozen R8 lineage or granting any business permission',
  'R9 preserves all 61 R8 admission assertions at their exact parent; only five explicit current-view cases are adapted',
  'R10 pins only the company-event identity correction over the unchanged complete R9 root',
  'R10 retains all 64 R9 admission cases; four full-current inventory views only are adapted',
  'R11 admits only the retained incremental reuse fix and preserves the complete immutable R10 root',
  'R11 preserves all 67 R10 assertions; only five current inventory/source views are explicitly adapted',
  'R5 full PR composition adds the old R4 root and three new paths, never a four-file-only seal or Worker grant',
 ]);
 const bodies=text=>{const starts=[...text.matchAll(/^test\('([^']+)'/gm)];return new Map(starts.map((r,i)=>[r[1],text.slice(r.index,starts[i+1]?.index??text.length).trimEnd()]));};
 let count=0;const changed=new Set();
 for(const path of ['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']){
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R12_BASE+':'+path],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const approved=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R12_HEAD+':'+path],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.equal(approved,old,'R12 never rewrote any R11 admission assertions');
  const before=bodies(old),after=bodies(integrationPhysicalRead(path).toString());count+=before.size;
  for(const [name,body]of before){const current=after.get(name);assert(current,'original test retained: '+name);
   if(current!==body)changed.add(name);
   if(!adapted.has(name))assert.equal(current,body,'original assertions unchanged: '+name);
   else assert((current.match(/\bassert[.(]/g)??[]).length>=(body.match(/\bassert[.(]/g)??[]).length,'no adapted assertion reduction: '+name);
   assert.doesNotMatch(current.split('\n')[0],/\btest\.skip\b|\bskip\s*:/);
  }
 }
 assert.equal(count,70);assert.equal(adapted.size,16);assert.deepEqual([...changed].sort(),[...adapted].sort(),'only actual changed current views are named');
});
test('R14 admits only the three exact evaluator JSONB/reread sources while preserving the frozen complete R13 tree',()=>{
 const m=verifyIntegrationCandidate(),r=m.source_union.r14,old=JSON.parse(integrationPhysicalRead(FROZEN_SOURCE_UNION_R13));
 assert.deepEqual(r,sourceUnionR14Lineage());assert.equal(r.base,SOURCE_UNION_R14_BASE);
 assert.equal(r.prior_root.revision,'9dcd21603d6f32dad57cfc2f8dfc14f56852ce35');
 assert.equal(integrationHash(integrationPhysicalRead(FROZEN_SOURCE_UNION_R13)),'5b1bb18cbd821dd3ebb7d11974492f19942b422922a92058e369a6fc8fa105a8');
 assert.equal(old.files.length,536);assert.equal(m.files.length,537);assert.equal(integrationInventory().length,538);
 for(const [key,value]of Object.entries(old.source_union))assert.deepEqual(m.source_union[key],value);
 assert.deepEqual(m.files.map(f=>f.path),[...old.files.map(f=>f.path),FROZEN_SOURCE_UNION_R13].sort());
 assert.deepEqual(r.files.map(f=>f.path),['supabase/functions/_shared/decision-v1-evidence.ts','tests/v1FundamentalRevisionSelection.test.mjs','tests/v1FundamentalRevisionDatabase.integration.mjs']);
 for(const row of r.files){
  const original=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R14_BASE+':'+row.path],{cwd:new URL('../',import.meta.url)});
  assert.equal(integrationHash(original),row.before_sha256);assert.equal(integrationHash(integrationPhysicalRead(row.path)),row.after_sha256);
  assert.equal(integrationPhysicalMode(row.path),row.mode);assert(!SOURCE_UNION_SUPPORT.includes(row.path));
 }
 for(const flag of ['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'])assert.equal(r[flag],false);
 for(const flag of flags)assert.equal(m[flag],false);
});
test('R14 rejects all source and frozen-root mutations, missing/mode changes and reflected lineage/authority claims',()=>{
 for(const row of [...SOURCE_UNION_R14_FILES,{path:FROZEN_SOURCE_UNION_R13}]){
  const f=fixture();f.verify();f.bytes.set(row.path,Buffer.concat([f.read(row.path),Buffer.from('\nUNREVIEWED_R14')]));
  const hash=integrationHash(f.read(row.path));f.manifest.files.find(r=>r.path===row.path).after_sha256=hash;
  const entry=f.manifest.source_union.r14.files.find(r=>r.path===row.path);
  if(entry)entry.after_sha256=hash;else f.manifest.source_union.r14.prior_root.sha256=hash;
  f.reseal();assert.throws(f.verify,/SOURCE_DRIFT/);assert.throws(()=>createSourceUnionComposition(f.read,f.paths,f.mode),/SOURCE_DRIFT/);
  for(const mode of ['100755','120000']){const g=fixture();g.modes.set(row.path,mode);g.manifest.files.find(r=>r.path===row.path).mode=mode;g.reseal();assert.throws(g.verify,/MODE_DRIFT/);}
  assert.throws(()=>verifyIntegrationCandidate(p=>{if(p===row.path)throw Error('R14_MISSING');return integrationPhysicalRead(p);}),/R14_MISSING/);
 }
 for(const change of [r=>r.base='HEAD',r=>r.files.pop(),r=>r.files[0].after_sha256='0'.repeat(64),
  r=>r.prior_root.revision='HEAD',r=>r.prior_root.sha256='0'.repeat(64),r=>r.scope='SOURCE_APPROVED',
  ...['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'].map(k=>r=>{r[k]=true;})]){
  const f=fixture();change(f.manifest.source_union.r14);f.reseal();assert.throws(f.verify,/LINEAGE_DRIFT/);
 }
});
test('R14 retains all 77 R13 admission assertions; only sixteen explicitly named current views change',()=>{
 const adapted=new Set([
  'R8 complete physical current union preserves R4/R5/R6/R7 assertions at their immutable parents',
  'R3 pins all eight exact sources to8c before/after bytes; only explicit R4/R7/R8 replacements differ in current',
  'R4 pins exactly four loader/metadata sources over cbb without source rights or Worker activation',
  'R8 pins seven independent exact before/after deltas and preserves the full frozen R7 root and lineage',
  'R13 pins the exact R12 nine-file commit, both immutable roots and the full current composition without authority',
  'R13 preserves all 70 R11 admission tests with only explicit current-view and nested preservation adaptations',
  'R4 admits current evaluator before the unchanged issuer review can reconstruct its exact R9 view',
  'R5 full PR composition adds the old R4 root and three new paths, never a four-file-only seal or Worker grant',
  'R5 pins precisely the four frozen code deltas over dfec and revalidates all R4 source/root bytes',
  'R8 retains every R7 admission test and all unadapted assertion bodies; exact R7 source is never rewritten',
  'R9 admits the exact native PDF intake delta without changing the frozen R8 lineage or granting any business permission',
  'R9 preserves all 61 R8 admission assertions at their exact parent; only five explicit current-view cases are adapted',
  'R10 pins only the company-event identity correction over the unchanged complete R9 root',
  'R10 retains all 64 R9 admission cases; four full-current inventory views only are adapted',
  'R11 admits only the retained incremental reuse fix and preserves the complete immutable R10 root',
  'R11 preserves all 67 R10 assertions; only five current inventory/source views are explicitly adapted',
 ]);
 const bodies=text=>{const starts=[...text.matchAll(/^test\('([^']+)'/gm)];return new Map(starts.map((r,i)=>[r[1],text.slice(r.index,starts[i+1]?.index??text.length).trimEnd()]));};
 let count=0;const changed=new Set();
 for(const path of ['tests/originalIngressAdmission.test.mjs','tests/officialPublicAdmission.test.mjs']){
  const old=execFileSync('git',['--no-replace-objects','show',SOURCE_UNION_R14_BASE+':'+path],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  const before=bodies(old),after=bodies(integrationPhysicalRead(path).toString());count+=before.size;
  for(const [name,body]of before){const current=after.get(name);assert(current,'R13 assertion retained: '+name);
   if(current!==body)changed.add(name);
   if(!adapted.has(name))assert.equal(current,body,'R13 assertion body unchanged: '+name);
   else assert((current.match(/\bassert[.(]/g)??[]).length>=(body.match(/\bassert[.(]/g)??[]).length,'no assertion reduction: '+name);
   assert.doesNotMatch(current.split('\n')[0],/\btest\.skip\b|\bskip\s*:/);
  }
 }
 assert.equal(count,77);assert.equal(adapted.size,16);assert.deepEqual([...changed].sort(),[...adapted].sort());
});
