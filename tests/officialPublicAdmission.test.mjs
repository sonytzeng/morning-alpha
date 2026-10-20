import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyIntegrationCandidate,createOfficialPublicComposition,INTEGRATION_MANIFEST,OFFICIAL_PUBLIC_BASE,
 OFFICIAL_PUBLIC_DELTAS,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash} from './helpers/integrationAdmission.mjs';
test('complete current source is exact, old receipts intact and all Production flags false',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(createOfficialPublicComposition(),m);
 assert.equal(OFFICIAL_PUBLIC_BASE,'7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3');
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261020-continuous-lifecycle.json');
 assert.equal(OFFICIAL_PUBLIC_DELTAS.length,38);
 for(const f of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[f],false);
});
test('new source drift, executable-bit drift, unknown files and altered deployment sources refuse',()=>{
 const paths=integrationInventory(),source='research/recommendation-official-source-join.ts';
 assert.throws(()=>verifyIntegrationCandidate(p=>p===source?Buffer.concat([integrationPhysicalRead(p),Buffer.from('DRIFT')]):integrationPhysicalRead(p),paths),/SOURCE_DRIFT/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,[...paths,'UNREVIEWED_FILE']),/UNKNOWN_PATH/);
 assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths,p=>p===source?'100755':integrationPhysicalMode(p)),/MODE_DRIFT/);
 const immutable='supabase/functions/_shared/decision-v1-evidence.ts',read=p=>p===immutable?Buffer.concat([integrationPhysicalRead(p),Buffer.from('DRIFT')]):integrationPhysicalRead(p);
 const m=JSON.parse(integrationPhysicalRead(INTEGRATION_MANIFEST));m.files.find(r=>r.path===immutable).after_sha256=integrationHash(read(immutable));
 assert.throws(()=>verifyIntegrationCandidate(p=>p===INTEGRATION_MANIFEST?Buffer.from(JSON.stringify(m)):read(p),paths),/SOURCE_DRIFT/);
 assert.throws(()=>createOfficialPublicComposition(read,paths),/SOURCE_DRIFT/);
});
test('historical Atomic assertions and Production SQL stay unchanged; only the isolated CI clock is pinned',()=>{
 assert.equal(integrationHash(integrationPhysicalRead('tests/atomicRowContract20260924Database.integration.mjs')),
  'b8c0bf551c51107a56d82f0abdfb9a6e31c22f341502548f75e46e4a612b67e8');
 const workflow=integrationPhysicalRead('.github/workflows/validate-release.yml').toString();
 assert.ok(workflow.includes("FAKETIME=@2026-10-20 00:35:00"));
 assert.ok(workflow.includes('ma-news-clock-ci-${{ github.run_id }}-atomic" --network none'));
 assert.ok(workflow.includes('MA_ISOLATED_TEST_DB: ma_atomic_row_contract_test1'));
 const bridge=integrationPhysicalRead('tests/helpers/clockedPsql.mjs').toString();
 assert.ok(bridge.includes(".HostConfig.NetworkMode"));
 assert.ok(bridge.includes(".trim(),'none'"));
 assert.ok(bridge.includes("assert.equal(args[++i],'127.0.0.1')"));
});
