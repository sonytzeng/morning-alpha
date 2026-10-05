import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PUBLIC_EXPORT_ARTIFACT_PATH, resolveRuntimeSparseRecoveryIntegrity, readAnalysisIntelligencePredecessor } from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const hash=p=>createHash('sha256').update(readAnalysisIntelligencePredecessor(p)).digest('hex');
const manifest=JSON.parse(read('docs/10k-program/phase2-candidate-integrity.json'));
const expected=[
  ".github/workflows/analysis-intelligence.yml",
  "docs/10k-program/phase2-analysis-contract.md",
  "docs/10k-program/phase2-baseline-transition.json",
  "src/features/research/intelligence.ts",
  "src/pages/admin/analysis/IntelligenceView.tsx",
  "src/pages/admin/analysis/page.tsx",
  "supabase/functions/_shared/analysis-intelligence-job.mjs",
  "supabase/functions/_shared/analysis-intelligence-v1.mjs",
  "supabase/functions/research-analysis-shadow-v1/index.ts",
  "supabase/migrations/20261005083437_analysis_intelligence_shadow_v1.sql",
  "tests/analysisIntelligence.test.mjs",
  "tests/analysisIntelligenceDatabase.integration.mjs",
  "tests/analysisIntelligenceIntegrity.test.mjs",
  "tests/analysisIntelligenceUI.test.mjs",
  "tests/browser/analysisIntelligence.vite.ts",
  "tests/browser/analysisIntelligenceHarness.tsx",
  "tests/browser/analysisIntelligenceSupabaseMock.ts",
  "tests/fixtures/phase2-analysis/cle-linkage.json",
  "tests/fixtures/phase2-analysis/dependencies.sql",
  "tests/fixtures/phase2-analysis/intraday-integrity.json",
  "tests/fixtures/phase2-analysis/production-cores.json",
  "tests/fixtures/phase2-analysis/research-context.json",
  "tests/helpers/phase2AnalysisFixtures.mjs",
  "tests/helpers/premarketAtomicReadinessIntegrity.mjs",
  "tests/ownerAccountAnalysisNavigation.test.mjs"
];
test('Phase 2 pins the exact reviewed candidate and immutable Phase 1 predecessor',()=>{
  assert.equal(manifest.base_sha,'1fcf24a7a2d7d7a602e555639a200f3b002a31ce');
  assert.deepEqual(Object.keys(manifest.files).sort(),expected);
  for(const [path,digest] of Object.entries(manifest.files))assert.equal(hash(path),digest,path);
  assert.deepEqual(Object.keys(manifest.predecessors).sort(),['docs/10k-program/phase1-baseline-transition.json','docs/10k-program/phase1-core-freeze.json']);
  for(const [path,digest] of Object.entries(manifest.predecessors))assert.equal(hash(path),digest,path);
  const core=JSON.parse(read('docs/10k-program/phase1-core-freeze.json'));
  assert.equal(Object.keys(core.protected_files).length,142);
  for(const [path,digest] of Object.entries(core.protected_files))assert.equal(hash(path),digest,path);
  assert.deepEqual(expected.filter(p=>p.startsWith('supabase/migrations/')),['supabase/migrations/20261005083437_analysis_intelligence_shadow_v1.sql']);
  assert.deepEqual(expected.filter(p=>/^supabase\/functions\/[^_][^/]+\/index\.ts$/.test(p)),['supabase/functions/research-analysis-shadow-v1/index.ts']);
  assert.equal(manifest.production_changes_authorized,false);
  assert.equal(manifest.cron_changes,false);
  assert.equal(manifest.forward_sample,0);
});

test('Phase 2 joins the sealed lineage without admitting unknown runtime files or altering predecessor hashes',()=>{
  const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
  const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
  const transitionPath='docs/10k-program/phase2-baseline-transition.json';
  const result=verify(),m=result.analysisIntelligenceCandidateIntegrity.reviewedBaselineTransition;
  assert.equal(m.transition_id,'MORNING_ALPHA_ANALYSIS_INTELLIGENCE_20261005');
  assert.equal(m.candidate_base_git_sha,manifest.base_sha);
  assert.deepEqual(m.files.map(r=>r.path).sort(),[
    '.github/workflows/analysis-intelligence.yml',
    'supabase/functions/_shared/analysis-intelligence-job.mjs',
    'supabase/functions/_shared/analysis-intelligence-v1.mjs',
    'supabase/functions/research-analysis-shadow-v1/index.ts',
    'supabase/migrations/20261005083437_analysis_intelligence_shadow_v1.sql',
    'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
  ]);
  assert.equal(result.researchFoundationCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_RESEARCH_FOUNDATION_20261004');
  assert.equal(result.atomicCoreInventory.predecessor_count,109);
  assert.equal(result.atomicCoreInventory.candidate_count,110);
  for(const row of m.files)assert.throws(()=>verify(path=>path===row.path?Buffer.concat([read(path),Buffer.from('\nUNKNOWN')]):read(path)),/unreviewed candidate drift/);
  for(const mutate of [x=>{x.files.at(-1).predecessor_sha256='0'.repeat(64);},x=>{x.auth_change=true;},x=>{x.rls_relaxation=true;}]){
    const changed=structuredClone(m);mutate(changed);
    assert.throws(()=>verify(path=>path===transitionPath?Buffer.from(JSON.stringify(changed)):read(path)));
  }
});
