// An outer source-admission layer, not authority to deploy. Older staged
// receipts remain byte-for-byte frozen and validate their own predecessor.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyIntegrationCandidate,integrationHistoricalReader,integrationHistoricalRead,integrationParentPaths} from './integrationAdmission.mjs';
const root=new URL('../../',import.meta.url);
export const CORE_EVIDENCE_BASE='754850ba1c66329d12eac8e98ab799e0a0c9123e';
export const coreEvidenceManifest='docs/operations/evidence/core-evidence-candidate-20261017.json';
export const CORE_EVIDENCE_SCOPE=Object.freeze([
 '.github/workflows/core-evidence-candidate.yml',
 'docs/operations/core-evidence-checkpoint-20261017.md',
 'docs/operations/evidence/core-evidence-status-20261017.json',
 'scripts/academy-v11/auth-environment.mjs',
 'supabase/functions/_shared/recommendation-foundation-candidate.ts',
 'supabase/functions/_shared/recommendation-market-institutional-candidate.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'supabase/functions/get-report-payload/index.ts',
 'tests/coreEvidenceCandidateIntegrity.test.mjs',
 'tests/helpers/coreEvidenceCandidateIntegrity.mjs',
 'tests/helpers/stagedReleaseIntegrity.mjs',
 'tests/recommendationMarketInstitutionalCandidate.test.mjs',
 'tests/recommendationMarketInstitutionalDatabase.integration.mjs',
 'tests/recommendationProducerAdmission.test.mjs',
 'tests/recommendationV2FugleRuntime.test.mjs',
 'tests/stagedReleaseIntegrity.test.mjs',
 'tests/vnextDailyWiring.test.mjs',
]);
const raw=integrationHistoricalReader('core',p=>readFileSync(new URL(p,root)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16e6});
let trackedAtBase;const predecessors=new Map();
function baseFiles(){return trackedAtBase??=new Set(git(['ls-tree','-r','--name-only',CORE_EVIDENCE_BASE]).trim().split('\n'));}
function before(path){
 if(!baseFiles().has(path))return null;
 assert(['tests/helpers/stagedReleaseIntegrity.mjs','supabase/functions/recommendation-stock-evidence-v1/index.ts','supabase/functions/get-report-payload/index.ts','tests/recommendationProducerAdmission.test.mjs','tests/recommendationV2FugleRuntime.test.mjs','tests/stagedReleaseIntegrity.test.mjs','tests/vnextDailyWiring.test.mjs','scripts/academy-v11/auth-environment.mjs'].includes(path),'CORE_EVIDENCE_PROTECTED_CHANGE');
 if(!predecessors.has(path))predecessors.set(path,Buffer.from(git(['show',CORE_EVIDENCE_BASE+':'+path])));
 return Buffer.from(predecessors.get(path));
}
function inventory(){verifyIntegrationCandidate();return integrationParentPaths('core',CORE_EVIDENCE_BASE);}
export function verifyCoreEvidenceCandidate(read=raw,paths=inventory()){
 verifyIntegrationCandidate();read=integrationHistoricalReader('core',read);
 const m=JSON.parse(read(coreEvidenceManifest));
 assert.equal(m.schema,'CORE_EVIDENCE_CANDIDATE_1');assert.equal(m.base,CORE_EVIDENCE_BASE);
 for(const key of ['production_authorized','migration','secret_change','cron_change','auth_rls_change','member_rights_change','threshold_change','member_publication'])assert.equal(m[key],false,'CORE_EVIDENCE_FORBIDDEN_OPERATION:'+key);
 assert.deepEqual(m.files.map(r=>r.path).sort(),[...CORE_EVIDENCE_SCOPE].sort(),'CORE_EVIDENCE_EXACT_SCOPE');
 assert.deepEqual([...paths].sort(),[...CORE_EVIDENCE_SCOPE,coreEvidenceManifest].sort(),'CORE_EVIDENCE_UNKNOWN_PATH');
 for(const row of m.files){
  assert.deepEqual(Object.keys(row).sort(),['path','before_sha256','after_sha256'].sort());
  const old=before(row.path);assert.equal(row.before_sha256,old===null?null:hash(old));
  assert.match(row.after_sha256,/^[a-f0-9]{64}$/);assert.equal(hash(read(row.path)),row.after_sha256,'CORE_EVIDENCE_SOURCE_DRIFT:'+row.path);
 }
 verifyIntegrationCandidate();return m;
}
export function coreEvidenceHistoricalPaths(){
 if(!existsSync(new URL(coreEvidenceManifest,root)))return null;
 verifyCoreEvidenceCandidate();
 return git(['diff','--no-renames','--name-only','-z','f41e117ea109e09ae083ef2c692946a18aca2dcc',CORE_EVIDENCE_BASE,'--']).split('\0').filter(Boolean).sort();
}
export function coreEvidenceHistoricalRead(path,bytes){
 bytes=integrationHistoricalRead('core',path,Buffer.from(bytes));
 // Unlisted files are never translated. Avoid reparsing this outer receipt
 // for every historical Core byte; the full live admission is still mandatory.
 if(!CORE_EVIDENCE_SCOPE.includes(path)||!existsSync(new URL(coreEvidenceManifest,root)))return bytes;
 const m=JSON.parse(raw(coreEvidenceManifest)),row=m.files.find(r=>r.path===path);
 if(!row)return bytes;
 // A newly admitted file did not exist at the historical layer. Preserve
 // injected bytes instead of hiding an old gate's negative-control drift.
 if(row.before_sha256===null){
  if(hash(bytes)===row.after_sha256)throw Object.assign(Error('absent from Core Evidence predecessor: '+path),{code:'ENOENT'});
  return bytes;
 }
 const old=before(path);assert(old,'CORE_EVIDENCE_RECEIPT_MISSING');
 // Custom legacy negative readers retain their drift, rather than being
 // silently replaced with good baseline bytes.
 return hash(bytes)===row.after_sha256?old:bytes;
}
