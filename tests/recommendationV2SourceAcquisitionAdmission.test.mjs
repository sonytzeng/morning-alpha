import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyIntegrationCandidate,INTEGRATION_MANIFEST,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash,integrationHistoricalRead,integrationParentRead} from './helpers/integrationAdmission.mjs';
import {verifySourceAcquisitionClose,SOURCE_ACQUISITION_BASE,SOURCE_ACQUISITION_MANIFEST} from './helpers/sourceAcquisitionCloseAdmission.mjs';
const prior=path=>execFileSync('git',['--no-replace-objects','show',SOURCE_ACQUISITION_BASE+':'+path]);

test('current acquisition repair has exact fixed-base source hashes and preserves every predecessor rule',()=>{
 const m=verifySourceAcquisitionClose(),seal=verifyIntegrationCandidate();
 assert.equal(m.base,'6b7017fcbb9fa2fd085f9658eca4d6ce382c32a3');assert.equal(m.files.length,6);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261019-source-acquisition.json');
 for(const row of [...m.prior_rules,...m.protected_sources])assert.deepEqual(readFileSync(row.path),prior(row.path));
 assert.deepEqual(readFileSync(m.predecessor.path),prior(m.predecessor.path));
 assert.equal(integrationHash(readFileSync(m.predecessor.path)),m.predecessor.sha256);
 assert(seal.files.length>JSON.parse(prior(m.predecessor.path)).files.length);
 const outcome='supabase/functions/_shared/recommendation-v2-forward-outcomes.ts',good=integrationPhysicalRead(outcome);
 assert.deepEqual(integrationHistoricalRead('member',outcome,good),integrationParentRead('member',outcome));
 const injected=Buffer.concat([good,Buffer.from('INJECTED_OUTCOME')]);assert.deepEqual(integrationHistoricalRead('member',outcome,injected),injected);
 m.files.pop();assert.equal(verifySourceAcquisitionClose().files.length,6);
});

test('new source, manifest flags, modes, inventory and unchanged old assertions remain fail closed',()=>{
 const m=verifySourceAcquisitionClose(),paths=integrationInventory();
 for(const row of m.files){
  const bad=Buffer.concat([integrationPhysicalRead(row.path),Buffer.from('NEW_SOURCE_DRIFT')]);
  assert.throws(()=>verifySourceAcquisitionClose(path=>path===row.path?bad:integrationPhysicalRead(path),paths),/SOURCE_DRIFT/);
  assert.throws(()=>verifySourceAcquisitionClose(integrationPhysicalRead,paths,path=>path===row.path?'100755':integrationPhysicalMode(path)),/MODE/);
 }
 for(const path of ['src/unreviewed.ts','tests/unreviewed.test.mjs','docs/unreviewed.json'])assert.throws(()=>verifySourceAcquisitionClose(integrationPhysicalRead,[...paths,path]),/UNKNOWN_PATH/);
 assert.throws(()=>verifySourceAcquisitionClose(integrationPhysicalRead,paths.filter(path=>path!==m.files[0].path)),/UNKNOWN_PATH/);
 const failure=Error('SOURCE_READ_FAILURE');assert.throws(()=>verifySourceAcquisitionClose(path=>{if(path===m.files[0].path)throw failure;return integrationPhysicalRead(path);},paths),error=>error===failure);
 for(const mutate of [x=>x.base='HEAD',x=>x.files.pop(),x=>x.prior_rules.pop(),x=>x.predecessor.sha256='0'.repeat(64),x=>x.scope.source_fallback=true,x=>x.deployment_candidates.source_merge_is_deployment=true,x=>x.deployment_candidates.caller.production_authorized=true,x=>x.deployment_candidates.producer.production_authorized=true,
  ...['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].map(flag=>x=>x[flag]=true)]){
  const forged=structuredClone(m);mutate(forged);assert.throws(()=>verifySourceAcquisitionClose(path=>path===SOURCE_ACQUISITION_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path),paths));
 }
 assert.throws(()=>verifySourceAcquisitionClose(path=>path===m.predecessor.path?Buffer.concat([integrationPhysicalRead(path),Buffer.from(' ') ]):integrationPhysicalRead(path),paths),/OWNER_REGIME_DISPLAY_RECEIPT_DRIFT/);
});

test('old Owner proof runs only at fixed6b while complete current source and new regressions stay current',()=>{
 const workflow=readFileSync('.github/workflows/core-member-integration.yml','utf8');
 const steps=workflow.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));
 const admission=steps.find(block=>block.includes('verifyIntegrationCandidate();'));assert(admission);assert.doesNotMatch(admission,/working-directory:/);
 const checkout=steps.find(block=>block.includes('path: build/source-acquisition-historical-base'));assert(checkout);
 assert(steps.indexOf(admission)<steps.indexOf(checkout));assert.match(checkout,/ref: 6b7017fcbb9fa2fd085f9658eca4d6ce382c32a3/);assert.match(checkout,/persist-credentials: false/);
 const old=steps.find(block=>block.includes('run: node --experimental-strip-types --test tests/ownerRegimeDisplayAdmission.test.mjs'));
 assert(old);assert.match(old,/working-directory: build\/source-acquisition-historical-base/);
 const current=steps.find(block=>block.includes('tests/recommendationV2SourceAcquisitionAdmission.test.mjs'));assert(current);assert.doesNotMatch(current,/working-directory:/);assert(current.includes('tests/ownerCockpit.test.mjs'));
 assert(!current.includes('tests/ownerRegimeDisplayAdmission.test.mjs'));
 const v2=readFileSync('.github/workflows/recommendation-v2-shadow.yml','utf8');assert(v2.includes('tests/recommendationV2*.test.mjs'));
 for(const command of ['npm run type-check','npm run lint','npm run build']){const step=steps.find(block=>block.includes('run: '+command));assert(step);assert.doesNotMatch(step,/working-directory:/);}
 const legacy='tests/ownerRegimeDisplayAdmission.test.mjs';assert.deepEqual(readFileSync(legacy),prior(legacy));
 const integration=readFileSync('tests/helpers/integrationAdmission.mjs','utf8');assert(integration.includes("const PRIOR_OWNER_REGIME_DISPLAY='6b7017fcbb9fa2fd085f9658eca4d6ce382c32a3'"));
});
