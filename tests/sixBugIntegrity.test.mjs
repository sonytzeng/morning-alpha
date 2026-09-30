import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,normalize} from 'node:path';
import test from 'node:test';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
test('six-bug successor pins one named migration and preserves the complete predecessor lineage',()=>{
 const result=verify(),manifest=result.sixBugCandidateIntegrity.reviewedBaselineTransition;
 assert.equal(manifest.transition_id,'MORNING_ALPHA_SIX_BUG_PREVENTIVE_CLOSURE_20260930');
 assert.equal(manifest.candidate_base_git_sha,'2e530bc0db49bf76d6188642b79e112b339872aa');
 assert.deepEqual(manifest.files.filter(r=>r.path.startsWith('supabase/migrations/')).map(r=>r.path),['supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql']);
 assert.equal(result.researchEvidenceRecoveryCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_RESEARCH_EVIDENCE_RECOVERY_20260930');
 assert.deepEqual(manifest.reviewed_calendar_declarations.map(row=>row.name),['TAIWAN_HOLIDAYS_2026','resolveMarketStatus']);
 for(const row of manifest.reviewed_calendar_declarations){
  assert.notEqual(row.predecessor_sha256,row.candidate_sha256);
  assert.equal(result.declarationHash(row),row.candidate_sha256);
 }
 for(const row of manifest.files)assert.throws(()=>verify(path=>path===row.path?Buffer.concat([read(path),Buffer.from('\nUNREVIEWED_DRIFT')]):read(path)),/unreviewed candidate drift/);
});
test('release bundle dependency closure is exact and shared hashes cannot drift independently',()=>{
 const manifest=JSON.parse(read('docs/operations/evidence/six-bug-release-bundles-20260930.json'));
 assert.equal(manifest.production_change_authorized,false);assert.equal(manifest.cron_change,false);
 const all=new Set();
 function walk(path,seen){if(seen.has(path))return;seen.add(path);all.add(path);const source=read(path).toString();
  for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))walk(normalize(dirname(path)+'/'+match[1]),seen);
 }
 for(const [name,expected]of Object.entries(manifest.functions)){
  const actual=new Set();walk('supabase/functions/'+name+'/index.ts',actual);assert.deepEqual([...actual].sort(),expected);
 }
 assert.deepEqual([...all].sort(),Object.keys(manifest.files).sort());
 for(const [path,digest]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(read(path)).digest('hex'),digest,'BUNDLE_DEPENDENCY_DRIFT:'+path);
 for(const name of ['line-daily-push','closing-verification-engine','continuous-learning-engine','close-market-review','ma-ops-health-check'])assert(manifest.functions[name].includes('supabase/functions/_shared/canonical-market-state.ts'));
});
test('all fourteen duplicated groups are explicitly dispositioned; guarded differences are not fabricated product bugs',()=>{
 const groups=JSON.parse(read('docs/operations/evidence/six-bug-contract-groups-20260930.json'));
 assert.equal(groups.length,14);assert.equal(new Set(groups.map(g=>g.id)).size,14);
 for(const row of groups){assert(['SAFE_IDENTICAL_DUPLICATION','DRIFT_RISK','CONFIRMED_DRIFT'].includes(row.classification));assert(row.gates.length>0);for(const path of row.gates)assert(read(path).length>0);}
 assert.equal(groups.find(g=>g.id==='C11').disposition,'NON_REACHABLE_GUARDED_RISK');
 assert.equal(groups.find(g=>g.id==='C12').disposition,'NON_REACHABLE_GUARDED_RISK');
});
