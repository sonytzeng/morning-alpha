import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const digest=b=>createHash('sha256').update(b).digest('hex');
const expected=[
 '.github/workflows/analysis-intelligence.yml',
 'docs/10k-program/phase2-persistence-candidate.md',
 'src/features/research/intelligence.ts',
 'src/pages/admin/analysis/IntelligenceView.tsx',
 'src/pages/admin/analysis/page.tsx',
 'supabase/functions/_shared/analysis-intelligence-job.mjs',
 'supabase/functions/research-analysis-shadow-v1/index.ts',
 'supabase/migrations/20261005130832_analysis_shadow_persistence_v1.sql',
 'tests/analysisIntelligence.test.mjs',
 'tests/analysisIntelligencePersistence.integration.mjs',
 'tests/analysisIntelligencePersistenceIntegrity.test.mjs',
 'tests/analysisIntelligenceUI.test.mjs',
 'tests/browser/analysisIntelligence.vite.ts',
 'tests/browser/analysisIntelligenceHarness.tsx',
 'tests/browser/analysisIntelligenceSupabaseMock.ts',
 'tests/helpers/analysisShadowHandler.mjs',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
 'tests/ownerAccountAnalysisNavigation.test.mjs',
];
const path='docs/10k-program/phase2-persistence-transition.json';
test('Shadow persistence preserves exact predecessor lineage and 142 Core files',()=>{
 const m=JSON.parse(read(path));
 assert.equal(m.candidate_base_git_sha,'a7c06135ac6664a8d758a9ef2ce4b2ffafb67252');
 assert.deepEqual(m.files.map(x=>x.path).sort(),expected);
 const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
 const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
 assert.equal(verify().analysisPersistenceCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_SHADOW_PERSISTENCE_20261005');
 for(const row of m.files)assert.throws(()=>verify(p=>p===row.path?Buffer.concat([read(p),Buffer.from('UNREVIEWED')]):read(p)),/unreviewed candidate drift/);
 for(const p of ['docs/10k-program/phase2-comparison-transition.json','docs/10k-program/phase2-baseline-transition.json',
  'supabase/migrations/20261005103458_analysis_previous_comparison_nonblocking_v1.sql'])
  assert.equal(digest(read(p)),digest(execFileSync('git',['show',m.candidate_base_git_sha+':'+p])));
 const core=JSON.parse(read('docs/10k-program/phase1-core-freeze.json'));
 assert.equal(Object.keys(core.protected_files).length,142);
 for(const [p,h]of Object.entries(core.protected_files))assert.equal(digest(readRecommendationPredecessor(p,read)),h,p);
});
test('the only migration is research-only with existing RLS and no activation or business backfill',()=>{
 const sql=read(expected.find(p=>p.startsWith('supabase/migrations/'))).toString();
 assert.deepEqual([...sql.matchAll(/create (?:or replace )?function ([^(]+)/g)].map(x=>x[1]),
  ['public.store_research_analysis_v1','public.get_owner_analysis_v2']);
 assert.equal((sql.match(/security_invoker=true/g)||[]).length,2);
 assert.doesNotMatch(sql,/create policy|alter policy|disable row level|cron\.|http_post|net\.|insert into public\.(?:reports|decision_snapshots|market_checkpoint|line_)|update public\.|delete from/i);
 for(const token of ['SHADOW_PERSISTENCE_PREDECESSOR_MISMATCH','RESEARCH_OWNER_REQUIRED',
  'RESEARCH_FORWARD_OUTCOME_ALREADY_KNOWN','RESEARCH_FORWARD_CANNOT_BE_BACKDATED','RESEARCH_SOURCE_READSET_MISMATCH',
  'RESEARCH_CANONICAL_ALREADY_LOCKED','analysis_cutoff_at=v_cutoff','observation_kind=v_kind'])assert(sql.includes(token),token);
});
import { readRecommendationPredecessor } from './helpers/recommendationPhaseIntegrity.mjs';
