// Current ordinary UI-label repair only. Historical B24, type-only and Owner
// copy receipts stay byte-for-byte unchanged and retain their strict guards.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyIntegrationCandidate,integrationInventory,integrationPhysicalRead,integrationPhysicalMode} from './integrationAdmission.mjs';

export const OWNER_REGIME_DISPLAY_BASE='a3602de17198dd9b769a16671ed97c4763e21cd8';
export const OWNER_REGIME_DISPLAY_MANIFEST='docs/operations/evidence/owner-regime-display-20261019.json';
export const OWNER_REGIME_DISPLAY_SOURCE='src/features/research/cockpit.ts';
const TEST='tests/ownerCockpit.test.mjs';
const BEFORE='0a7045339e65a1b4784a5c8351b37768a240dd08aac76f979002dc0c1be7b3a3';
const AFTER='5fcbb18d73af49674914de59fd1c3f88eda62d8be98e83af0a072d343f38ea65';
const FILES=Object.freeze([
 {path:OWNER_REGIME_DISPLAY_SOURCE,mode:'100644',before_sha256:BEFORE,after_sha256:AFTER},
 {path:TEST,mode:'100644',before_sha256:'709d8104a9612def7f4ae1602646bacaaa2a773b4b88fe6598b1c15236702529',after_sha256:'2eb47cb345b6edc91248d859f5ffdaa248454208b26bb5ac1e8431e7bbf25cec'},
]);
const PROTECTED=Object.freeze([
 {path:'src/pages/admin/analysis/OwnerCockpit.tsx',mode:'100644',sha256:'45ce7e4e776b9ffb7250b7603255928f839d8e8bb27c30b11afdc19f383e29fd'},
 {path:'src/lib/publicMarketReadModel.ts',mode:'100644',sha256:'9f99fd79e0dcbf1e10fcfabd12896230f4d77ca5a30c3f3560f50af45dc4684e'},
]);
const PREDECESSOR={path:'docs/operations/evidence/core-member-integration-20261019-priced-in-coverage.json',sha256:'06e83cf19c0a9753426ea385338810757506b8886a6280d602493500fe91c2ff'};
const FLAGS=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=new URL('../../',import.meta.url);
const prior=path=>execFileSync('git',['--no-replace-objects','show',OWNER_REGIME_DISPLAY_BASE+':'+path],{cwd:root,maxBuffer:1024*1024});

export function verifyOwnerRegimeDisplay(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 verifyIntegrationCandidate(read,paths,mode);
 const bytes=Buffer.from(read(OWNER_REGIME_DISPLAY_MANIFEST)),m=JSON.parse(bytes);
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','protected_sources','predecessor','website',...FLAGS].sort());
 assert.equal(m.schema,'MORNING_ALPHA_OWNER_REGIME_DISPLAY_V1');assert.equal(m.base,OWNER_REGIME_DISPLAY_BASE);
 for(const flag of FLAGS)assert.equal(m[flag],false,'OWNER_REGIME_FORBIDDEN:'+flag);
 assert.deepEqual(m.files,FILES);assert.deepEqual(m.protected_sources,PROTECTED);assert.deepEqual(m.predecessor,PREDECESSOR);
 assert.equal(hash(read(PREDECESSOR.path)),PREDECESSOR.sha256,'OWNER_REGIME_PRIOR_RECEIPT');
 assert.deepEqual(Buffer.from(read(PREDECESSOR.path)),prior(PREDECESSOR.path),'OWNER_REGIME_IMMUTABLE_PREDECESSOR');
 for(const row of FILES){
  assert.equal(hash(prior(row.path)),row.before_sha256,'OWNER_REGIME_BEFORE');
  assert.equal(hash(read(row.path)),row.after_sha256,'OWNER_REGIME_SOURCE');assert.equal(mode(row.path),row.mode,'OWNER_REGIME_MODE');
  assert.equal(hash(integrationPhysicalRead(row.path)),row.after_sha256,'OWNER_REGIME_PHYSICAL_SOURCE');
  assert.equal(integrationPhysicalMode(row.path),row.mode,'OWNER_REGIME_PHYSICAL_MODE');
 }
 for(const row of PROTECTED){
  assert.equal(hash(prior(row.path)),row.sha256,'OWNER_REGIME_PROTECTED_BASE');
  assert.equal(hash(read(row.path)),row.sha256,'OWNER_REGIME_PROTECTED_SOURCE');assert.equal(mode(row.path),row.mode,'OWNER_REGIME_PROTECTED_MODE');
  assert.equal(hash(integrationPhysicalRead(row.path)),row.sha256,'OWNER_REGIME_PROTECTED_PHYSICAL_SOURCE');
  assert.equal(integrationPhysicalMode(row.path),row.mode,'OWNER_REGIME_PROTECTED_PHYSICAL_MODE');
 }
 assert.deepEqual(m.website,{operation_count:1,operations:[{path:OWNER_REGIME_DISPLAY_SOURCE,mode:'100644',operation:'MODIFY',classification:'CLIENT_UI_MARKET_REGIME_LABEL_ONLY',expected_live_before_sha256:BEFORE,target_sha256:AFTER,source_bytes:4977}]});
 assert.deepEqual(integrationPhysicalRead(OWNER_REGIME_DISPLAY_MANIFEST),bytes,'OWNER_REGIME_RECEIPT_CHANGED');
 verifyIntegrationCandidate();return structuredClone(m);
}
export function ownerRegimeDisplayWebsiteOperations(){return verifyOwnerRegimeDisplay().website.operations;}
