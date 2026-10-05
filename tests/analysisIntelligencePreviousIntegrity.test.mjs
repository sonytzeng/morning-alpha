import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const path='docs/10k-program/phase2-comparison-transition.json';
const manifest=JSON.parse(read(path));
const expected=[
 'docs/10k-program/phase2-previous-comparison-candidate.md',
 'src/pages/admin/analysis/IntelligenceView.tsx',
 'supabase/functions/_shared/analysis-intelligence-job.mjs',
 'supabase/functions/_shared/analysis-intelligence-v1.mjs',
 'supabase/migrations/20261005103458_analysis_previous_comparison_nonblocking_v1.sql',
 'tests/analysisIntelligence.test.mjs',
 'tests/analysisIntelligenceDatabase.integration.mjs',
 'tests/analysisIntelligenceIntegrity.test.mjs',
 'tests/analysisIntelligencePreviousComparison.test.mjs',
 'tests/analysisIntelligencePreviousIntegrity.test.mjs',
 'tests/analysisIntelligenceUI.test.mjs',
 'tests/fixtures/phase2-analysis/previous-comparison-production.json',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
];
const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
test('comparison successor pins exact files, all hashes and released predecessor lineage',()=>{
 assert.equal(manifest.candidate_base_git_sha,'2b87c2134ac2449ba93c7a54a4de20c1f5017822');
 assert.deepEqual(manifest.files.map(r=>r.path).sort(),expected);
 assert.equal(verify().analysisComparisonCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_PREVIOUS_COMPARISON_20261005');
 for(const row of manifest.files) assert.throws(()=>verify(p=>p===row.path?Buffer.concat([read(p),Buffer.from('UNREVIEWED')]):read(p)),/unreviewed candidate drift/);
 for(const p of ['docs/10k-program/phase2-candidate-integrity.json','docs/10k-program/phase2-baseline-transition.json','supabase/migrations/20261005083437_analysis_intelligence_shadow_v1.sql']){
   const old=execFileSync('git',['show',manifest.candidate_base_git_sha+':'+p]);assert.equal(createHash('sha256').update(old).digest('hex'),createHash('sha256').update(read(p)).digest('hex'));
 }
 const core=JSON.parse(read('docs/10k-program/phase1-core-freeze.json'));
 for(const [p,hash] of Object.entries(core.protected_files))assert.equal(createHash('sha256').update(read(p)).digest('hex'),hash,p);
});
test('only two research RPCs can change; calendar, current guards and security preserved',()=>{
 const sql=read(expected.find(p=>p.startsWith('supabase/migrations/'))).toString();
 assert.deepEqual([...sql.matchAll(/create or replace function ([^(]+)/g)].map(x=>x[1]),['public.research_analysis_input_v1','public.store_research_analysis_v1']);
 assert.match(sql,/public.previous_market_session_v1\('TW',p_date\)/);
 assert.match(sql,/RESEARCH_COMPARISON_PREDECESSOR_MISMATCH/);
 assert.doesNotMatch(sql,/grant |revoke |create policy|alter table|cron\./i);
 assert.match(sql,/RESEARCH_TRUSTED_ASOF_CORE_REQUIRED/);assert.match(sql,/RESEARCH_FORWARD_CANNOT_BE_BACKDATED/);
 assert.match(sql,/RESEARCH_PREVIOUS_READSET_MISMATCH/);assert.match(sql,/RESEARCH_COMPARISON_UNAVAILABLE_INVALID/);
});
