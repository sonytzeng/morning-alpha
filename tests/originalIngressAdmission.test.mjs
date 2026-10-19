// Source admission only. Injected-reader controls are NOT physical candidate PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {INTEGRATION_MANIFEST,ORIGINAL_INGRESS_BASE,ORIGINAL_INGRESS_DELTAS,FROZEN_COLD_SOURCE_MANIFEST,
 integrationHash,integrationScope,integrationPhysicalRead,integrationPhysicalMode,
 createOriginalIngressComposition,verifyIntegrationCandidate} from './helpers/integrationAdmission.mjs';
const expected=[
 '.github/workflows/original-observation-ingress.yml','docs/operations/original-observation-ingress-20261019.md',
 'src/features/vnext/contracts.ts','src/features/vnext/engine.ts','src/features/vnext/originalIngress.ts',
 'supabase/migrations/20261019123345_original_observation_ingress_candidate_v1.sql',
 'tests/coldSourcePriorityAdmission.test.mjs','tests/helpers/integrationAdmission.mjs','tests/originalIngressAdmission.test.mjs','tests/r10FunctionalSourceClosure.test.mjs',
 'tests/vnextContracts.test.mjs','tests/vnextOriginalIngress.test.mjs','tests/vnextOriginalIngressDatabase.integration.mjs','tests/vnextOriginalTimestamp.test.ts',
].sort();
const flags=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
const frozen=()=>execFileSync('git',['--no-replace-objects','show',ORIGINAL_INGRESS_BASE+':'+FROZEN_COLD_SOURCE_MANIFEST],{maxBuffer:1024*1024});
test('the actual complete current candidate must be sealed before historical proofs',()=>{
 const m=verifyIntegrationCandidate();
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261019-original-ingress.json');
 assert.deepEqual(ORIGINAL_INGRESS_DELTAS,expected);
 assert.deepEqual(integrationPhysicalRead(FROZEN_COLD_SOURCE_MANIFEST),frozen());
 assert.equal(integrationHash(frozen()),'c0835bd41c75a3a40e32d2fc63990d0b55b65886a99a7c4da6d3c47f32968c24');
 for(const flag of flags)assert.equal(m[flag],false);
 assert.deepEqual(createOriginalIngressComposition(),m);
});
// Missing Main-owned drafts get explicit synthetic bytes only in this reader.
// They are never written, substituted into actual admission, or claimed as ready.
function fixture(){
 const bytes=new Map(),modes=new Map(),scope=integrationScope(),paths=[...scope,INTEGRATION_MANIFEST].sort();
 const read=path=>{
  if(!bytes.has(path))try{bytes.set(path,Buffer.from(integrationPhysicalRead(path)));modes.set(path,integrationPhysicalMode(path));}
  catch(error){if(error.code!=='ENOENT'||!expected.includes(path))throw error;bytes.set(path,Buffer.from('SYNTHETIC_ADMISSION_READER_ONLY:'+path));modes.set(path,'100644');}
  return Buffer.from(bytes.get(path));
 };
 const mode=path=>{read(path);return modes.get(path);};
 const manifest=createOriginalIngressComposition(read,paths,mode);
 bytes.set(INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(manifest)));modes.set(INTEGRATION_MANIFEST,'100644');
 return {bytes,modes,paths,read,mode,manifest,verify(){return verifyIntegrationCandidate(read,paths,mode);}};
}
test('synthetic reader controls reject byte, mode and unknown-path drift without caching admission',()=>{
 const f=fixture();f.verify();const path='src/features/vnext/originalIngress.ts',original=f.read(path);
 f.bytes.set(path,Buffer.concat([original,Buffer.from('DRIFT')]));assert.throws(()=>f.verify(),/SOURCE_DRIFT/);
 f.bytes.set(path,original);f.verify();f.modes.set(path,'100755');assert.throws(()=>f.verify(),/MODE_DRIFT/);
 f.modes.set(path,'100644');f.paths.push('UNREVIEWED_ORIGINAL_INGRESS_FILE');assert.throws(()=>f.verify(),/UNKNOWN_PATH/);
});
test('resealing cannot authorize unrelated historical source, workflow or catalogue drift',()=>{
 for(const path of ['src/features/vnext/dailyRuntime.ts','.github/workflows/core-member-integration.yml','scripts/operations/cold-source-priority-20261019/release-catalog.json']){
  const f=fixture();f.bytes.set(path,Buffer.concat([f.read(path),Buffer.from('UNREVIEWED')]));
  const row=f.manifest.files.find(row=>row.path===path);assert(row);row.after_sha256=integrationHash(f.read(path));
  f.bytes.set(INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(f.manifest)));
  const exactSourceRejection=error=>{
   assert.equal(String(error.message).split('\n')[0],'INTEGRATION_SOURCE_DRIFT:'+path);
   assert.match(error.message,/INTEGRATION_ORIGINAL_BASE_DRIFT/);return true;
  };
  assert.throws(()=>f.verify(),exactSourceRejection);
  assert.throws(()=>createOriginalIngressComposition(f.read,f.paths,f.mode),exactSourceRejection);
 }
});
test('entire retained receipt, authorization flags and incomplete seals fail closed',()=>{
 const f=fixture();f.bytes.set(FROZEN_COLD_SOURCE_MANIFEST,Buffer.concat([f.read(FROZEN_COLD_SOURCE_MANIFEST),Buffer.from('\n')]));
 assert.throws(()=>f.verify(),/COLD_SOURCE_RECEIPT_DRIFT/);
 for(const flag of flags){const g=fixture();g.manifest[flag]=true;g.bytes.set(INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(g.manifest)));assert.throws(()=>g.verify(),/FORBIDDEN/);}
 const g=fixture();g.manifest.files.find(row=>row.path==='src/features/vnext/originalIngress.ts').after_sha256=null;
 g.bytes.set(INTEGRATION_MANIFEST,Buffer.from(JSON.stringify(g.manifest)));assert.throws(()=>g.verify());
});
test('current CI and pinned historical proof are distinct, unconditional and not authorized for Production',()=>{
 const workflow=integrationPhysicalRead('.github/workflows/original-observation-ingress.yml').toString();
 for(const command of ['tests/originalIngressAdmission.test.mjs','tests/vnextOriginalTimestamp.test.ts','tests/vnextOriginalIngress.test.mjs','tests/vnextOriginalIngressDatabase.integration.mjs','npm run type-check','npm run lint','npm run build'])assert(workflow.includes(command),command);
 assert(workflow.includes('ref: '+ORIGINAL_INGRESS_BASE));assert(workflow.includes('needs: current-candidate'));
 assert(workflow.includes('node --experimental-strip-types --test tests/coldSourcePriorityAdmission.test.mjs'));
 assert(!workflow.includes('secrets.'));assert(!workflow.includes('continue-on-error:'));assert(!workflow.includes('pull_request_target:'));
 const wrapper=integrationPhysicalRead('tests/coldSourcePriorityAdmission.test.mjs').toString();
 assert(wrapper.includes(ORIGINAL_INGRESS_BASE));assert(wrapper.includes('2f20ae753c8bab656d3d40e47b42d2879a0baa70ce8dd7cce5db96a55b706bbd'));
 assert(wrapper.includes('verifyIntegrationCandidate()'));assert(!wrapper.includes('.skip('));assert.deepEqual(ORIGINAL_INGRESS_DELTAS,expected);
 const r10=integrationPhysicalRead('tests/r10FunctionalSourceClosure.test.mjs').toString();
 assert(r10.includes(ORIGINAL_INGRESS_BASE));assert(r10.includes('e11c59ee77a16e28b55c2b0c0ab2aadf84599d72e8cdcb848f0d76f2b8004f69'));
 assert(r10.includes('verifyIntegrationCandidate()'));assert(!r10.includes('.skip('));
});
