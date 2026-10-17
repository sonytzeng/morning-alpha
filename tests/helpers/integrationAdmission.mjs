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
export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r4.json';
const PRIOR_INTEGRATION='8146eb4be02acd1a8ccf55e9b47c48cae762dc5e';
const FROZEN_INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261017.json';
const PRIOR_R2='cc167304814b2223977a36802b2666ea8203ff36';
const FROZEN_R2_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r2.json';
const PRIOR_R3='8320a544726ee3f5e4be47d53288416e091b6211';
const FROZEN_R3_MANIFEST='docs/operations/evidence/core-member-integration-20261017-r3.json';
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
 FROZEN_INTEGRATION_MANIFEST,FROZEN_R2_MANIFEST,FROZEN_R3_MANIFEST,
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
].sort());
const root=new URL('../../',import.meta.url);
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:64e6});
export const integrationHash=b=>createHash('sha256').update(b).digest('hex');
const trees=new Map();
function tree(revision){
 assert.match(revision,/^[a-f0-9]{40}$/,'INTEGRATION_IMMUTABLE_PARENT');
 if(!trees.has(revision)){
  const rows=git(['ls-tree','-rz',revision]).split('\0').filter(Boolean).map(r=>{const [meta,path]=r.split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(type,'blob');assert.match(mode,/^100(644|755)$/);return {path,mode,oid};});
  const bytes=execFileSync('git',['cat-file','--batch'],{cwd:root,input:rows.map(r=>r.oid).join('\n')+'\n',maxBuffer:64e6});
  let at=0;const result=new Map();for(const row of rows){const end=bytes.indexOf(10,at);assert(end>=at);const [oid,type,n]=bytes.subarray(at,end).toString().split(' '),size=Number(n);assert.equal(oid,row.oid);assert.equal(type,'blob');assert(Number.isSafeInteger(size)&&size>=0);at=end+1;assert.equal(bytes[at+size],10);result.set(row.path,{...row,bytes:Buffer.from(bytes.subarray(at,at+size))});at+=size+1;}assert.equal(at,bytes.length);trees.set(revision,result);
 }
 return trees.get(revision);
}
export function integrationParentRead(view,path){const row=tree(INTEGRATION_PARENTS[view]).get(path);if(!row)throw Object.assign(Error('INTEGRATION_PARENT_ABSENT:'+path),{code:'ENOENT'});return Buffer.from(row.bytes);}
export function integrationParentPaths(view,base){
 assert.match(base,/^[a-f0-9]{40}$/,'IMMUTABLE_GIT_REVISION_REQUIRED');
 return git(['diff','--no-renames','--name-only','-z',base,INTEGRATION_PARENTS[view],'--']).split('\0').filter(Boolean).sort();
}
export function readRegularIntegrationFile(url){assert(lstatSync(url).isFile()&&!lstatSync(url).isSymbolicLink(),'INTEGRATION_REGULAR_FILE');return readFileSync(url);}
export function integrationPhysicalRead(path){return readRegularIntegrationFile(new URL(path,root));}
export function integrationPhysicalMode(path){return lstatSync(new URL(path,root)).mode&0o111?'100755':'100644';}
export function integrationInventory(){return [...new Set([...git(['diff','--no-renames','--name-only','-z',INTEGRATION_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();}
export function integrationScope(){
 // Member branched before later main receipts. Those inherited main changes
 // are NOT deletions/replacements authorized by its candidate.
 assert.equal(git(['merge-base',INTEGRATION_PARENTS.core,INTEGRATION_PARENTS.member]).trim(),MEMBER_FORK,'INTEGRATION_PARENT_FORK');
 return [...new Set([...integrationParentPaths('core',INTEGRATION_BASE),...integrationParentPaths('member',MEMBER_FORK),...INTEGRATION_DELTAS])].sort();
}
export function verifyIntegrationCandidate(read=integrationPhysicalRead,paths=integrationInventory(),mode=integrationPhysicalMode){
 const m=JSON.parse(read(INTEGRATION_MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','parents','files','production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].sort());
 assert.equal(m.schema,'CORE_MEMBER_COMPOSITION_V1');assert.equal(m.base,INTEGRATION_BASE);assert.deepEqual(m.parents,INTEGRATION_PARENTS);
 assert.deepEqual(Buffer.from(read(FROZEN_INTEGRATION_MANIFEST)),tree(PRIOR_INTEGRATION).get(FROZEN_INTEGRATION_MANIFEST).bytes,'INTEGRATION_PRIOR_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R2_MANIFEST)),tree(PRIOR_R2).get(FROZEN_R2_MANIFEST).bytes,'INTEGRATION_R2_RECEIPT_DRIFT');
 assert.deepEqual(Buffer.from(read(FROZEN_R3_MANIFEST)),tree(PRIOR_R3).get(FROZEN_R3_MANIFEST).bytes,'INTEGRATION_R3_RECEIPT_DRIFT');
 for(const flag of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[flag],false,'INTEGRATION_FORBIDDEN:'+flag);
 assert.deepEqual(m.files.map(r=>r.path),integrationScope(),'INTEGRATION_EXACT_SCOPE');
 assert.deepEqual([...paths].sort(),[...integrationScope(),INTEGRATION_MANIFEST].sort(),'INTEGRATION_UNKNOWN_PATH');
 const baseline=tree(INTEGRATION_BASE);
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256','mode','origin'].sort());
  const before=baseline.get(row.path);assert.equal(row.before_sha256,before?integrationHash(before.bytes):null);
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.equal(integrationHash(read(row.path)),row.after_sha256,'INTEGRATION_SOURCE_DRIFT:'+row.path);
  assert.equal(mode(row.path),row.mode,'INTEGRATION_MODE_DRIFT:'+row.path);assert.match(row.mode,/^100(644|755)$/);
  if(INTEGRATION_DELTAS.includes(row.path))assert.equal(row.origin,'composition');
  else{
   assert(['core','member','shared'].includes(row.origin));const sources=row.origin==='shared'?['core','member']:[row.origin];
   for(const source of sources){const parent=tree(INTEGRATION_PARENTS[source]).get(row.path);assert(parent);assert.equal(row.after_sha256,integrationHash(parent.bytes),'INTEGRATION_PARENT_SOURCE:'+row.path);assert.equal(row.mode,parent.mode);}
  }
 }
 // Unchanged baseline bytes and modes remain protected too. This detects an
 // incomplete/falsified inventory, not just alterations to named new files.
 const listed=new Set(m.files.map(r=>r.path));for(const [path,row]of baseline)if(!listed.has(path)){
  assert.equal(integrationHash(read(path)),integrationHash(row.bytes),'INTEGRATION_BASELINE_DRIFT:'+path);assert.equal(mode(path),row.mode,'INTEGRATION_BASELINE_MODE:'+path);
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
 const base=tree(INTEGRATION_BASE).get(path),expected=row?.after_sha256??(base?integrationHash(base.bytes):null),mode=row?.mode??base?.mode;
 if(!expected||integrationHash(bytes)!==expected)return bytes;
 assert.equal(integrationHash(integrationPhysicalRead(path)),expected,'INTEGRATION_CHANGED_AFTER_ADMISSION:'+path);
 assert.equal(integrationPhysicalMode(path),mode,'INTEGRATION_CHANGED_MODE:'+path);
 return integrationParentRead(view,path);
}
export function integrationHistoricalReader(view,source=integrationPhysicalRead){return path=>integrationHistoricalRead(view,path,Buffer.from(source(path)));}
