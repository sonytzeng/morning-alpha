import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {verifyIntegrationCandidate,INTEGRATION_MANIFEST,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash} from './helpers/integrationAdmission.mjs';
import {verifyOwnerRegimeDisplay,ownerRegimeDisplayWebsiteOperations,OWNER_REGIME_DISPLAY_BASE,OWNER_REGIME_DISPLAY_MANIFEST,OWNER_REGIME_DISPLAY_SOURCE} from './helpers/ownerRegimeDisplayAdmission.mjs';
import {verifyOwnerStatusCopy} from './helpers/ownerStatusCopyAdmission.mjs';
const prior=path=>execFileSync('git',['--no-replace-objects','show',OWNER_REGIME_DISPLAY_BASE+':'+path]);

test('current label repair admits one exact website source and preserves both live dependencies',()=>{
 const m=verifyOwnerRegimeDisplay(),ops=ownerRegimeDisplayWebsiteOperations();
 assert.equal(m.production_authorized,false);assert.equal(m.website.operation_count,1);
 assert.deepEqual(ops.map(row=>row.path),[OWNER_REGIME_DISPLAY_SOURCE]);
 assert.equal(ops[0].classification,'CLIENT_UI_MARKET_REGIME_LABEL_ONLY');
 assert.equal(ops[0].source_bytes,readFileSync(OWNER_REGIME_DISPLAY_SOURCE).length);
 for(const row of m.protected_sources){assert.deepEqual(readFileSync(row.path),prior(row.path));assert.equal(integrationHash(readFileSync(row.path)),row.sha256);}
 assert.deepEqual(readFileSync(m.predecessor.path),prior(m.predecessor.path));
 assert.equal(integrationHash(readFileSync(m.predecessor.path)),m.predecessor.sha256);
 // Original physical guards stay strict; the changed runtime is never called
 // an unchanged historical type-only or copy-only source package.
 assert.throws(()=>verifyOwnerStatusCopy(),/OWNER_COPY_SOURCE|OWNER_COPY_WEBSITE_SOURCE/);
 ops[0].target_sha256='0'.repeat(64);assert.notEqual(ownerRegimeDisplayWebsiteOperations()[0].target_sha256,ops[0].target_sha256);
});

test('complete current source, modes, missing and unknown inventory fail closed',()=>{
 const paths=integrationInventory(),m=verifyOwnerRegimeDisplay();
 for(const row of [...m.files,...m.protected_sources]){
  const good=integrationPhysicalRead(row.path),bad=Buffer.concat([good,Buffer.from('INJECTED')]);
  assert.throws(()=>verifyOwnerRegimeDisplay(path=>path===row.path?bad:integrationPhysicalRead(path),paths),/SOURCE_DRIFT/);
  assert.throws(()=>verifyOwnerRegimeDisplay(integrationPhysicalRead,paths,path=>path===row.path?'100755':integrationPhysicalMode(path)),/MODE/);
 }
 for(const extra of ['src/unreviewed.ts','tests/unreviewed.test.mjs','docs/unreviewed.json'])assert.throws(()=>verifyOwnerRegimeDisplay(integrationPhysicalRead,[...paths,extra]),/UNKNOWN_PATH/);
 assert.throws(()=>verifyOwnerRegimeDisplay(integrationPhysicalRead,paths.filter(path=>path!==OWNER_REGIME_DISPLAY_SOURCE)),/UNKNOWN_PATH/);
 const error=Error('SOURCE_ERROR');assert.throws(()=>verifyOwnerRegimeDisplay(path=>{if(path===OWNER_REGIME_DISPLAY_SOURCE)throw error;return integrationPhysicalRead(path);}),actual=>actual===error);
});

test('new authority, source catalogues, lineage and website widening cannot be forged',()=>{
 const m=verifyOwnerRegimeDisplay(),paths=integrationInventory();
 for(const mutate of [row=>row.base='HEAD',row=>row.files.pop(),row=>row.protected_sources.pop(),row=>row.predecessor.sha256='0'.repeat(64),row=>row.website.operations.push({...row.website.operations[0]}),
  ...['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].map(flag=>row=>row[flag]=true)]){
  const forged=structuredClone(m);mutate(forged);assert.throws(()=>verifyOwnerRegimeDisplay(path=>path===OWNER_REGIME_DISPLAY_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path),paths));
 }
 const seal=verifyIntegrationCandidate();
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261019-owner-regime-display.json');
 const original=JSON.parse(readFileSync(m.predecessor.path));assert.equal(seal.files.length,original.files.length+5);
 assert.throws(()=>verifyIntegrationCandidate(path=>path===m.predecessor.path?Buffer.concat([readFileSync(path),Buffer.from(' ')]):integrationPhysicalRead(path),paths),/PRICED_IN_COVERAGE_RECEIPT_DRIFT/);
});

test('historical UI proofs and current SSR and strict app compilation use distinct fixed source views',()=>{
 const text=readFileSync('.github/workflows/core-member-integration.yml','utf8');
 const steps=text.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));
 const admission=steps.find(block=>block.includes('verifyIntegrationCandidate();'));
 const checkout=steps.find(block=>block.includes('path: build/owner-regime-historical-base'));
 assert(admission&&checkout);assert(steps.indexOf(admission)<steps.indexOf(checkout));assert.doesNotMatch(admission,/working-directory:/);
 assert.match(checkout,/ref: a3602de17198dd9b769a16671ed97c4763e21cd8/);assert.match(checkout,/persist-credentials: false/);
 const historical=steps.filter(block=>/^        working-directory: build\/owner-regime-historical-base$/m.test(block));
 assert.equal(historical.length,3);
 const dependencies=steps.filter(block=>/run: npm ci --ignore-scripts/.test(block));assert.equal(dependencies.length,2);
 assert(dependencies.every(block=>/^        working-directory: build\/(?:priced-in|owner-regime)-historical-base$/m.test(block)));
 assert.equal(historical.filter(block=>/run: npm ci --ignore-scripts/.test(block)).length,1);
 const proofs=historical.find(block=>block.includes('tests/researchSourceContracts.test.mjs'));assert(proofs);
 for(const path of ['ownerStatusCopyAdmission','frontendTypeClosureAdmission','researchSourceContracts','ownerReleaseReviewPackage','r9FunctionalSourceClosure'])assert(proofs.includes('tests/'+path+'.test.mjs'));
 const current=steps.find(block=>block.includes('tests/ownerRegimeDisplayAdmission.test.mjs'));assert(current);assert.doesNotMatch(current,/working-directory:/);
 assert(current.includes('tests/ownerCockpit.test.mjs'));assert(!current.includes('tests/researchSourceContracts.test.mjs'));
 for(const command of ['npm run type-check','npm run lint','npm run build']){
  const block=steps.find(block=>block.includes('run: '+command));assert(block);assert.doesNotMatch(block,/working-directory:/);
 }
 const archive=steps.find(block=>block.includes("'owner-regime-display-source.zip'"));assert(archive);assert.doesNotMatch(archive,/working-directory:/);
 const historicArchive=historical.find(block=>block.includes("'owner-status-copy-source.zip'"));assert(historicArchive);
 assert(historicArchive.includes("source_view:'HISTORICAL_OWNER_STATUS_COPY_A360'"));
 assert.equal((historicArchive.match(/source_base:'a3602de17198dd9b769a16671ed97c4763e21cd8'/g)||[]).length,2);
 assert(!historicArchive.includes('actual current physical source'));
 assert(archive.includes('verifyOwnerRegimeDisplay()'));assert(archive.includes("'CURRENT_OWNER_REGIME_DISPLAY_SOURCE'"));
 for(const path of ['tests/ownerStatusCopyAdmission.test.mjs','tests/frontendTypeClosureAdmission.test.mjs','tests/researchSourceContracts.test.mjs','tests/ownerReleaseReviewPackage.test.mjs','tests/r9FunctionalSourceClosure.test.mjs','tests/helpers/ownerStatusCopyAdmission.mjs','tests/helpers/frontendTypeClosureAdmission.mjs'])assert.deepEqual(readFileSync(path),prior(path),'immutable historical assertion:'+path);
});
