// An outer source-admission layer, not authority to deploy. Older staged
// receipts remain byte-for-byte frozen and validate their own predecessor.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url);
export const CORE_EVIDENCE_BASE='754850ba1c66329d12eac8e98ab799e0a0c9123e';
export const coreEvidenceManifest='docs/operations/evidence/core-evidence-candidate-20261017.json';
export const CORE_EVIDENCE_SCOPE=Object.freeze([
 '.github/workflows/core-evidence-candidate.yml',
 'docs/operations/core-evidence-checkpoint-20261017.md',
 'docs/operations/evidence/core-evidence-status-20261017.json',
 'supabase/functions/_shared/recommendation-foundation-candidate.ts',
 'supabase/functions/_shared/recommendation-market-institutional-candidate.ts',
 'tests/coreEvidenceCandidateIntegrity.test.mjs',
 'tests/helpers/coreEvidenceCandidateIntegrity.mjs',
 'tests/helpers/stagedReleaseIntegrity.mjs',
 'tests/recommendationMarketInstitutionalCandidate.test.mjs',
 'tests/recommendationMarketInstitutionalDatabase.integration.mjs',
]);
const raw=p=>readFileSync(new URL(p,root));
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16e6});
let trackedAtBase,predecessor;
function baseFiles(){return trackedAtBase??=new Set(git(['ls-tree','-r','--name-only',CORE_EVIDENCE_BASE]).trim().split('\n'));}
function before(path){
 if(!baseFiles().has(path))return null;
 assert.equal(path,'tests/helpers/stagedReleaseIntegrity.mjs','CORE_EVIDENCE_PROTECTED_CHANGE');
 predecessor??=Buffer.from(git(['show',CORE_EVIDENCE_BASE+':'+path]));return Buffer.from(predecessor);
}
function inventory(){return [...new Set([...git(['diff','--no-renames','--name-only','-z',CORE_EVIDENCE_BASE,'--']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean))].sort();}
export function verifyCoreEvidenceCandidate(read=raw,paths=inventory()){
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
 return m;
}
export function coreEvidenceHistoricalPaths(){
 if(!existsSync(new URL(coreEvidenceManifest,root)))return null;
 verifyCoreEvidenceCandidate();
 return git(['diff','--no-renames','--name-only','-z','f41e117ea109e09ae083ef2c692946a18aca2dcc',CORE_EVIDENCE_BASE,'--']).split('\0').filter(Boolean).sort();
}
export function coreEvidenceHistoricalRead(path,bytes){
 if(path!=='tests/helpers/stagedReleaseIntegrity.mjs'||!existsSync(new URL(coreEvidenceManifest,root)))return bytes;
 const m=JSON.parse(raw(coreEvidenceManifest)),row=m.files.find(r=>r.path===path),old=before(path);
 assert(row&&old,'CORE_EVIDENCE_RECEIPT_MISSING');
 // Custom legacy negative readers retain their drift, rather than being
 // silently replaced with good baseline bytes.
 return hash(bytes)===row.after_sha256?old:bytes;
}
