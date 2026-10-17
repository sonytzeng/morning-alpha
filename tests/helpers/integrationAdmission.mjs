// A separate composition seal. Child receipts keep their original bytes and
// are tested at immutable parent trees, only AFTER the complete live tree is
// admitted here. This is source integrity, never deployment authorization.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export const INTEGRATION_BASE='754850ba1c66329d12eac8e98ab799e0a0c9123e';
const MEMBER_FORK='cf3b6b21c9e3d022a8132ed3b566b544d290a48f';
export const INTEGRATION_PARENTS=Object.freeze({core:'bc48d784487fd5ae63ac2bb9c28d9343de41034f',member:'bcf665cad237e9c5e76c9abdd12cc12d5133aaed'});
export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r8.json';
const PRIOR_INTEGRATION='8146eb4be02acd1a8ccf55e9b47c48cae762dc5e';
const FROZEN_INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261017.json';
const PRIOR_R2='cc167304814b2223977a36802b2666ea8203ff36';
const FROZEN_R2_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r2.json';
const PRIOR_R3='8320a544726ee3f5e4be47d53288416e091b6211';
const FROZEN_R3_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r3.json';
const PRIOR_R4='6a06ea7fd35265a3be39463dd1b68698ca1a9c22';
const FROZEN_R4_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r4.json';
const PRIOR_R5='bfc2bcc482f961124c1c89265f89254de910428e';
const FROZEN_R5_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r5.json';
const PRIOR_R6='1a3b8c902a9b08b69525aea5a280bf546295ffe4';
const FROZEN_R6_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r6.json';
const PRIOR_R7='b29ee8a80f798c20d8ae5e9234ade8544852d10f';
const FROZEN_R7_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r7.json';
// Explicitly reviewed composition deltas. No patterns, glob, deployment flags,
// automatic inventory admission or addition to any previous release catalogue.
export const INTEGRATION_DELTAS=Object.freeze([
 '.nvmrc','.github/workflows/core-member-integration.yml',
 '.github/workflows/analysis-intelligence.yml','.github/workflows/academy-v11.yml',
 '.github/workflows/checkpoint-atomicity-validation.yml','.github/workflows/entry-opportunity.yml',
 '.github/workflows/owner-cockpit.yml','.github/workflows/owner-trading-lab.yml',
 '.github/workflows/recommendation-v2-shadow.yml','.github/workflows/research-foundation.yml',
 '.github/workflows/staged-release-240.yml','.github/workflows/validate-release.yml',
 '.github/workflows/vnext-candidate.yml','.github/workflows/core-evidence-candidate.yml',
 FROZEN_INTEGRATION_MANIFEST,FROZEN_R2_MANIFEST,FROZEN_R3_MANIFEST,FROZEN_R4_MANIFEST,FROZEN_R5_MANIFEST,FROZEN_R6_MANIFEST,FROZEN_R7_MANIFEST,
 'docs/operations/evidence/owner-release-review-r8-20261017.json',
 'docs/operations/evidence/v1-source-gap-detail-r8-20261017.json',
 'docs/operations/evidence/v1-provider-capability-exact-manifest-r8-20261017.json',
 'docs/operations/owner-release-decisions-r8-20261017.md',
 'docs/operations/v1-provider-capability-evidence-20261017.md',
 'scripts/capability/finnhub-quarterly-probe.mjs',
 'tests/finnhubQuarterlyProbe.test.mjs','tests/ownerReleaseReviewPackage.test.mjs',
 'supabase/functions/v1-provider-capability-review-v1/handler.ts',
 'supabase/functions/v1-provider-capability-review-v1/index.ts',
 'tests/providerCapabilityOwnerBoundary.test.mjs',
 'src/pages/account/components/MorningHeroCard.tsx',
 'tests/accountSubscriberProjection.test.mjs','tests/accountReportSchedule.test.mjs',
 'scripts/vnext/membership-preview.mjs','tests/browser/membership.harness.tsx',
 'tests/providerCapabilityClaimDatabase.integration.mjs',
 'tests/providerCapabilityEntry.sdk.test.ts',
 'src/pages/admin/analysis/ProviderCapabilityReview.tsx',
 'src/pages/admin/analysis/page.tsx','tests/providerCapabilityReviewUi.test.mjs',
 'tests/ownerAccountAnalysisNavigation.test.mjs','tests/analysisIntelligenceUI.test.mjs',
 'docs/operations/core-member-integration-20261017.md',
 'docs/operations/v1-source-capability-20261017.md',
 'scripts/academy-v11/auth-environment.mjs',
 'supabase/functions/get-report-payload/index.ts',
 'supabase/functions/_shared/research-owner-field-access.ts',
 'supabase/functions/_shared/recommendation-consensus-capability-candidate.ts',
 'tests/helpers/integrationAdmission.mjs','tests/integrationAdmission.test.mjs',
 'tests/helpers/coreEvidenceCandidateIntegrity.mjs','tests/coreEvidenceCandidateIntegrity.test.mjs',
 'tests/helpers/vnextIntegrity.mjs','tests/vnextIntegrity.test.mjs',
 'tests/helpers/stagedReleaseIntegrity.mjs','tests/stagedReleaseIntegrity.test.mjs',
 'tests/recommendationMarketInstitutionalCandidate.test.mjs',
 'tests/researchOwnerFieldAccess.test.mjs','tests/researchOwnerFieldAccess.sdk.test.ts',
 'tests/recommendationConsensusCapability.test.mjs',
 'tests/academyV11Integrity.test.mjs','tests/helpers/marketNewsReportIntegrity.mjs',
 'tests/helpers/recommendationHistoricalBatch.mjs','tests/recommendationHistoricalBatch.test.mjs',
 'tests/analysisIntelligencePersistenceIntegrity.test.mjs',
 'tests/analysisIntelligenceIntegrity.test.mjs',
 'tests/analysisIntelligencePreviousIntegrity.test.mjs',
 'tests/analysisIntelligenceShadowAuthIntegrity.test.mjs',
 'tests/ownerTradingLabIntegrity.test.mjs','tests/researchFoundation.test.mjs',
 'tests/helpers/v2HistoricalBatch.mjs',
 'tests/recommendationV2Integrity.test.mjs','tests/recommendationV2ForwardIntegrity.test.mjs',
 'tests/recommendationV2RuntimeIntegrity.test.mjs',
].sort());
const root=new URL('../../',import.meta.url);
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,encoding:'utf8',maxBuffer:64e6});
export const integrationHash=b=>createHash('sha256').update(b).digest('hex');
const trees=new Map();
// Prior receipts need one immutable blob each, not an entire historical tree
// retained in the 512MiB test worker. Live files/validation are never cached.
const frozenReceipts=new Map();
function frozenReceipt(revision,path){
 assert.match(revision,/^[a-f0-9]{40}$/);
 const key=revision+':'+path;
 if(!frozenReceipts.has(key)){
  const rows=git(['--no-replace-objects','ls-tree','-z',revision,'--',path]).split('\0').filter(Boolean);
  assert.equal(rows.length,1);const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');
  assert.equal(name,path);assert.equal(mode,'100644');assert.equal(type,'blob');assert.match(oid,/^[a-f0-9]{40}$/);
  const bytes=execFileSync('git',['--no-replace-objects','cat-file','blob',oid],{cwd:root,maxBuffer:1024*1024});
  frozenReceipts.set(key,Buffer.from(bytes));
 }
 return Buffer.from(frozenReceipts.get(key));
}
function tree(revision){
 assert.match(revision,/^[a-f0-9]{40}$/,'INTEGRATION_IMMUTABLE_PARENT');
 if(!trees.has(revision)){
  const rows=git(['ls-tree','-rz',revision]).split('\0').filter(Boolean).map(r=>{const [meta,path]=r.split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(type,'blob');assert.match(mode,/^100(644|755)$/);return {path,mode,oid};});
  const bytes=execFileSync('git',['--no-replace-objects','cat-file','--batch'],{cwd:root,input:rows.map(r=>r.oid).join('\n')+'\n',maxBuffer:64e6});
  let at=0;const result=new Map();for(const row of rows){const end=bytes.indexOf(10,at);assert(end>=at);const [oid,type,n]=bytes.subarray(at,end).toString().split(' '),size=Number(n);assert.equal(oid,row.oid);assert.equal(type,'blob');assert(Number.isSafeInteger(size)&&size>=0);at=end+1;assert.equal(bytes[at+size],10);const body=Buffer.from(bytes.subarray(at,at+size));result.set(row.path,{...row,bytes:body,sha256:integrationHash(body)});at+=size+1;}assert.equal(at,bytes.length);trees.set(revision,result);
 }
 return trees.get(revision);
}
export function integrationParentRead(view,path){const row=tree(INTEGRATION_PARENTS[view]).get(path);if(!row)throw Object.assign(Error('INTEGRATION_PARENT_ABSENT:'+path),{code:'ENOENT'});return Buffer.from(row.bytes);}
const parentRanges=new Map();let fixedScope;
export function integrationParentPaths(view,base){
 assert(Object.hasOwn(INTEGRATION_PARENTS,view),'INTEGRATION_UNKNOWN_PARENT');
 assert.match(base,/^[a-f0-9]{40}$/,'IMMUTABLE_GIT_REVISION_REQUIRED');
 const key=base+':'+INTEGRATION_PARENTS[view];
 if(!parentRanges.has(key))parentRanges.set(key,Object.freeze(git(['diff','--no-renames','--name-only','-z',base,INTEGRATION_PARENTS[view],'--']).split('\0').filter(Boolean).sort()));
 return [...parentRanges.get(key)];
}
export function readRegularIntegrationFile(url){assert(lstatSync(url).isFile()&&!lstatSync(url).isSymbolicLink(),'INTEGRATION_REGULAR_FILE');return readFileSync(url);}
export function integrationPhysicalRead(path){return readRegularIntegrationFile(new URL(path,root));}
export function integrationPhysicalMode(path){return lstatSync(new URL(path,root)).mode&0o111?'100755':'100644';}
export function integrationInventory(){return [...new Set([...git(['diff','--no-renames','--name-only','-z',INTEGRATION_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();}
export function integrationScope(){
 // Member branched before later main receipts. Those inherited main changes
 // are NOT deletions/replacements authorized by its candidate.
 if(!fixedScope){
  assert.equal(git(['merge-base',INTEGRATION_PARENTS.core,INTEGRATION_PARENTS.member]).trim(),MEMBER_FORK,'INTEGRATION_PARENT_FORK');
  fixedScope=Object.freeze([...new Set([...integrationParentPaths('core',INTEGRATION_BASE),...integrationParentPaths('member',MEMBER_FORK),...INTEGRATION_DELTAS])].sort());
 }
 return [...fixedScope];
}
export function verifyIntegrationCandidate(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 const m=JSON.parse(read(INTEGRATION_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','parents','files','production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].sort());
 assert.equal(m.schema,'CORE_MEMBER_COMPOSITION_V1');assert.equal(m.base,INTEGRATION_BASE);assert.deepEqual(m.parents,INTEGRATION_PARENTS);
 assert.deepEqual(Buffer.from(read(FROZEN_INTEGRATION_MANIFEST)),frozenReceipt(PRIOR_INTEGRATION,FROZEN_INTEGRATION_MANIFEST),'INTEGRATION_PRIOR_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R2_MANIFEST)),frozenReceipt(PRIOR_R2,FROZEN_R2_MANIFEST),'INTEGRATION_R2_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R3_MANIFEST)),frozenReceipt(PRIOR_R3,FROZEN_R3_MANIFEST),'INTEGRATION_R3_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R4_MANIFEST)),frozenReceipt(PRIOR_R4,FROZEN_R4_MANIFEST),'INTEGRATION_R4_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R5_MANIFEST)),frozenReceipt(PRIOR_R5,FROZEN_R5_MANIFEST),'INTEGRATION_R5_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R6_MANIFEST)),frozenReceipt(PRIOR_R6,FROZEN_R6_MANIFEST),'INTEGRATION_R6_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R7_MANIFEST)),frozenReceipt(PRIOR_R7,FROZEN_R7_MANIFEST),'INTEGRATION_R7_RECEIPT_DRIFT');
 for(const flag of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[flag],false,'INTEGRATION_FORBIDDEN:'+flag);
 const scope=integrationScope();
 assert.deepEqual(m.files.map(r=>r.path),scope,'INTEGRATION_EXACT_SCOPE');
 assert.deepEqual([...paths].sort(),[...scope,INTEGRATION_MANIFEST].sort(),'INTEGRATION_UNKNOWN_PATH');
 const baseline=tree(INTEGRATION_BASE);
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256','mode','origin'].sort());
  const before=baseline.get(row.path);assert.equal(row.before_sha256,before?before.sha256:null);
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.equal(integrationHash(read(row.path)),row.after_sha256,'INTEGRATION_SOURCE_DRIFT:'+row.path);
  assert.equal(mode(row.path),row.mode,'INTEGRATION_MODE_DRIFT:'+row.path);assert.match(row.mode,/^100(644|755)$/);
  if(INTEGRATION_DELTAS.includes(row.path))assert.equal(row.origin,'composition');
  else{
   assert(['core','member','shared'].includes(row.origin));const sources=row.origin==='shared'?['core','member']:[row.origin];
   for(const source of sources){const parent=tree(INTEGRATION_PARENTS[source]).get(row.path);assert(parent);assert.equal(row.after_sha256,parent.sha256,'INTEGRATION_PARENT_SOURCE:'+row.path);assert.equal(row.mode,parent.mode);}
  }
 }
 // Unchanged baseline bytes and modes remain protected too. This detects an
 // incomplete/falsified inventory, not just alterations to named new files.
 const listed=new Set(m.files.map(r=>r.path));for(const [path,row]of baseline)if(!listed.has(path)){
  assert.equal(integrationHash(read(path)),row.sha256,'INTEGRATION_BASELINE_DRIFT:'+path);assert.equal(mode(path),row.mode,'INTEGRATION_BASELINE_MODE:'+path);
 }
 return m;
}
// Translation never erases injected consumer bytes. The caller must run full
// admission at its public boundary, then reread/validate again before return.
// Every translated byte must equal the current exact seal, not a filename.
// Decode only: a single cache entry keyed by the complete freshly-read JSON
// bytes. It never caches filesystem reads, hashes, modes, status, admission or
// validation outcomes. Malformed replacement text throws, never falls back.
let decodedBytes,decodedRows;
export function integrationSealRow(path,bytes){
 if(!decodedBytes||!decodedBytes.equals(bytes)){
  const m=JSON.parse(bytes),rows=m.files.map(row=>Object.freeze({...row}));
  decodedRows=rows;decodedBytes=Buffer.from(bytes);
 }
 return decodedRows.find(row=>row.path===path);
}
export function integrationHistoricalRead(view,path,bytes){
 const row=integrationSealRow(path,integrationPhysicalRead(INTEGRATION_MANIFEST));
 const base=tree(INTEGRATION_BASE).get(path),expected=row?.after_sha256??base?.sha256??null,mode=row?.mode??base?.mode;
 if(!expected||integrationHash(bytes)!==expected)return bytes;
 assert.equal(integrationHash(integrationPhysicalRead(path)),expected,'INTEGRATION_CHANGED_AFTER_ADMISSION:'+path);
 assert.equal(integrationPhysicalMode(path),mode,'INTEGRATION_CHANGED_MODE:'+path);
 return integrationParentRead(view,path);
}
export function integrationHistoricalReader(view,source=integrationPhysicalRead){return path=>{
 const value=source(path),bytes=Buffer.from(value);
 // A JS string with unpaired surrogates cannot round-trip through UTF-8.
 // Preserve that injected value verbatim; never normalize it into valid bytes
 // that could look like an exact admitted source and erase the mutation.
 if(typeof value==='string'&&bytes.toString('utf8')!==value)return value;
 const restored=integrationHistoricalRead(view,path,bytes);
 // Preserve an injected text reader's representation. Turning its UTF-8 view
 // of an unchanged binary baseline into a Buffer is not byte-preserving; the
 // older text-aware validator must receive the original text representation.
 // Mandatory physical admission remains binary and independently fail closed.
 return typeof value==='string'?(restored.equals(bytes)?value:restored.toString('utf8')):restored;
};}
