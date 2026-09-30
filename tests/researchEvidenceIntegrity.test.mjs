import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
test('Research successor pins the sole candidate migration, one Function and immutable sparse-recovery predecessor',()=>{
 const result=verify();
 const transition=result.researchEvidenceRecoveryCandidateIntegrity.reviewedBaselineTransition;
 assert.equal(transition.transition_id,'MORNING_ALPHA_RESEARCH_EVIDENCE_RECOVERY_20260930');
 assert.equal(transition.predecessor_integrity_id,'MORNING_ALPHA_RUNTIME_SPARSE_RECOVERY_20260929');
 assert.deepEqual(transition.files.filter(r=>r.path.startsWith('supabase/')).map(r=>r.path).sort(),[
  'supabase/functions/generate-daily-report-v7/index.ts',
  'supabase/functions/generate-daily-report-v7/market-data-evidence.ts',
  'supabase/migrations/20260930005956_research_committed_close_provenance_v1.sql',
 ]);
 for(const row of transition.files)assert.throws(()=>verify(path=>path===row.path?Buffer.concat([read(path),Buffer.from('\nUNREVIEWED_DRIFT')]):read(path)),/unreviewed candidate drift/);
 assert.equal(result.runtimeSparseRecoveryCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_RUNTIME_SPARSE_RECOVERY_20260929');
});
