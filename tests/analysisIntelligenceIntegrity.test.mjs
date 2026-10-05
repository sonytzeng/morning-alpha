import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const hash=p=>createHash('sha256').update(read(p)).digest('hex');
const manifest=JSON.parse(read('docs/10k-program/phase2-candidate-integrity.json'));
const expected=[
  ".github/workflows/analysis-intelligence.yml",
  "docs/10k-program/phase2-analysis-contract.md",
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
