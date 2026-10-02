import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,normalize} from 'node:path';
import test from 'node:test';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
const verify=()=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),read);
test('operational successor pins exact paths and hashes while retaining all predecessor baselines',()=>{
 const result=verify(),manifest=result.operationalMarketCandidateIntegrity.reviewedBaselineTransition;
 assert.equal(manifest.transition_id,'MORNING_ALPHA_OPERATIONAL_MARKET_20261001');
 assert.equal(manifest.candidate_base_git_sha,'7e71532d06731d00cb44a72d4e96305466d650fd');
 assert.equal(result.recorderRetryCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_RECORDER_RETRY_PROJECTION_20260930');
 assert.deepEqual(manifest.files.filter(r=>r.path.startsWith('supabase/migrations/')).map(r=>r.path),[
  'supabase/migrations/20261001065146_operational_market_architecture_v1.sql']);
 assert.equal(manifest.production_destructive_migration,false);
});
test('operational shared contracts have an exact local bundle closure and explicit deployed release scope',()=>{
 const read=verify().publicProjectionCandidateIntegrity.reviewedBaselinePredecessorReadSource;
 const manifest=JSON.parse(read('docs/operations/evidence/operational-market-release-bundles-20261001.json'));
 assert.equal(manifest.production_change_authorized,false);assert.equal(manifest.cron_change,false);
 assert.deepEqual(manifest.deployment_functions,[
  'close-market-review','closing-verification-engine','content-os-morning-alpha-source',
  'continuous-learning-engine','daily-delivery-orchestrator','generate-daily-report-v7',
  'get-report-payload','line-daily-push','ma-ops-health-check','ma-ops-safe-recovery','strategy-replay-engine']);
 assert.deepEqual(manifest.not_deployed,['alpha-coach']);
 const all=new Set();
 function walk(path,seen){if(seen.has(path))return;seen.add(path);all.add(path);
  for(const match of read(path).toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))walk(normalize(dirname(path)+'/'+match[1]),seen);
 }
 for(const [name,expected]of Object.entries(manifest.functions)){
  const actual=new Set();walk('supabase/functions/'+name+'/index.ts',actual);assert.deepEqual([...actual].sort(),expected);
 }
 assert.deepEqual([...all].sort(),Object.keys(manifest.files).sort());
 for(const [path,digest]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(read(path)).digest('hex'),digest,'OPERATIONAL_BUNDLE_DRIFT:'+path);
 for(const excluded of ['fetch-market-data-v10','market-readiness-preflight','opening-market-radar','fetch-global-market-news'])assert(!manifest.functions[excluded]);
});
test('saved full-handler evidence distinguishes actual missing-news replay from synthetic positive controls',()=>{
 const evidence=JSON.parse(read('docs/operations/evidence/operational-market-validation-20261001.json'));
 assert.equal(evidence.production_writes,0);assert.equal(evidence.real_line_calls,0);
 assert.equal(evidence.sql_replay.contract_diff,0);assert.equal(evidence.sql_replay.capsules,26);
 assert.deepEqual(Object.keys(evidence.scenarios).sort(),['fatal','full','learning','real','sector']);
 for(const scenario of Object.values(evidence.scenarios)){
  assert.equal(scenario.result,'PASS');assert.equal(scenario.next_day,'PASS');
  assert.equal(scenario.production_writes,0);assert.equal(scenario.real_line_calls,0);
 }
 assert(evidence.scenarios.full.input_types.includes('SYNTHETIC_AUDITED_NEWS_CONTROL'));
 assert(!evidence.scenarios.real.input_types.includes('SYNTHETIC_AUDITED_NEWS_CONTROL'));
 assert.equal(evidence.scenarios.real.report_level,'DEGRADED');
 assert.equal(evidence.scenarios.learning.learning,'LEARNING_DEGRADED');
 assert.equal(evidence.scenarios.learning.service_available,true);
 assert.equal(evidence.scenarios.fatal.report_level,'CORE_FATAL');
});
