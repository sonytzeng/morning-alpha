import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import {execFileSync} from 'node:child_process';
import{verifyCoreEvidenceCandidate,coreEvidenceManifest,CORE_EVIDENCE_SCOPE,coreEvidenceHistoricalRead}from'./helpers/coreEvidenceCandidateIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const paths=[...CORE_EVIDENCE_SCOPE,coreEvidenceManifest].sort();
test('candidate admits only exact Producer/Reader wiring; SQL, rights and thresholds stay frozen',()=>{
 const m=verifyCoreEvidenceCandidate(read,paths);assert.equal(m.files.length,17);
 assert.equal(m.files.filter(r=>r.before_sha256!==null).length,8);
});
test('rate-limited Auth registry replacement changes only the already-verified official image identity',()=>{
 const path='scripts/academy-v11/auth-environment.mjs';
 const base=execFileSync('git',['show','754850ba1c66329d12eac8e98ab799e0a0c9123e:'+path],{encoding:'utf8'});
 const old='public.ecr.aws/supabase/gotrue:v2.194.0',pinned='ghcr.io/supabase/gotrue@sha256:2b352c02adf11a2025cd5993c246ef85db73743553c39194d2b1862d1cc4d1fd';
 assert.equal(base.split(old).length-1,1);assert.equal(read(path).toString(),base.replace(old,pinned));
});
test('all new files, unknown paths and forbidden operation changes fail closed',()=>{
 const m=JSON.parse(read(coreEvidenceManifest));
 for(const row of m.files)assert.throws(()=>verifyCoreEvidenceCandidate(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p),paths));
 assert.throws(()=>verifyCoreEvidenceCandidate(read,[...paths,'supabase/functions/line-daily-push/index.ts']));
 for(const key of ['production_authorized','migration','secret_change','cron_change','auth_rls_change','member_rights_change','threshold_change','member_publication']){
  const copy=structuredClone(m);copy[key]=true;
  assert.throws(()=>verifyCoreEvidenceCandidate(p=>p===coreEvidenceManifest?Buffer.from(JSON.stringify(copy)):read(p),paths));
 }
});
test('historical reader peels only exact current helper bytes; injected drift is retained',()=>{
 const p='tests/helpers/stagedReleaseIntegrity.mjs',good=read(p),bad=Buffer.concat([good,Buffer.from('DRIFT')]);
 assert.notDeepEqual(coreEvidenceHistoricalRead(p,good),good);
 assert.deepEqual(coreEvidenceHistoricalRead(p,bad),bad);
 assert.deepEqual(coreEvidenceHistoricalRead('package.json',read('package.json')),read('package.json'));
});
test('historical Core inventory cannot mistake newly admitted files for old runtime dependencies',()=>{
 const m=JSON.parse(read(coreEvidenceManifest));
 for(const row of m.files.filter(r=>r.before_sha256===null)){
  assert.throws(()=>coreEvidenceHistoricalRead(row.path,read(row.path)),{code:'ENOENT'});
  const drift=Buffer.concat([read(row.path),Buffer.from('DRIFT')]);
  assert.deepEqual(coreEvidenceHistoricalRead(row.path,drift),drift);
 }
});
