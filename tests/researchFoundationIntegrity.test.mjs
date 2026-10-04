import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const manifestPath='docs/10k-program/phase1-baseline-transition.json';
const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
const allowed=[
  '.github/workflows/research-foundation.yml',
  'supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql',
  'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
];
test('Phase 1 seals only the named schema/workflow/test adapter and preserves complete predecessor lineage',()=>{
  const result=verify(),m=result.researchFoundationCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(m.transition_id,'MORNING_ALPHA_RESEARCH_FOUNDATION_20261004');
  assert.equal(m.candidate_base_git_sha,'3b33db3688ba350da0372b50f3391da922b639ea');
  assert.equal(m.predecessor_integrity_id,'MORNING_ALPHA_PUBLIC_MARKET_PROJECTION_20261002');
  assert.deepEqual(m.files.map(row=>row.path).sort(),allowed);
  assert.deepEqual(m.files.filter(row=>row.operation==='MODIFY').map(row=>row.path),[allowed[2]]);
  assert.equal(result.publicProjectionCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_PUBLIC_MARKET_PROJECTION_20261002');
  assert.deepEqual(result.atomicCoreInventory,{predecessor_count:109,candidate_count:110,
    reviewed_addition:'supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql'});
});
test('Phase 1 does not accept unknown hashes, historical mutations or privilege escalation',()=>{
  for(const path of allowed)assert.throws(()=>verify(name=>name===path
    ? Buffer.concat([read(name),Buffer.from('\n-- unknown drift\n')]):read(name)),/unreviewed candidate drift/);
  for(const mutate of [m=>{m.files[2].predecessor_sha256='0'.repeat(64);},m=>{m.auth_change=true;},m=>{m.rls_relaxation=true;}]){
    const m=JSON.parse(read(manifestPath));mutate(m);
    assert.throws(()=>verify(name=>name===manifestPath?Buffer.from(JSON.stringify(m)):read(name)));
  }
});
