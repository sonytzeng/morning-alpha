import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const RECOMMENDATION_BASE='6c5ae5a5a760d8c3135cd7ccc94ce17e1cd394c6';
export const RECOMMENDATION_MANIFEST='docs/10k-program/recommendation-phase-transition.json';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
// Only immutable git objects are cached. Candidate bytes and manifest hashes
// are re-read on every assertion, including all mutation-negative tests.
const gitObjects=new Map();
function predecessor(path){
 if(!gitObjects.has(path)){
  let bytes=null;try{bytes=execFileSync('git',['show',RECOMMENDATION_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==128)throw e;}
  gitObjects.set(path,bytes);
 }
 return gitObjects.get(path);
}
export const RECOMMENDATION_PATHS=[
 '.github/workflows/validate-release.yml',
 '.github/workflows/research-foundation.yml',
 '.github/workflows/owner-trading-lab.yml',
 'docs/10k-program/recommendation-phase-candidate.md',
 'docs/10k-program/recommendation-phase-real-replay.json',
 'src/features/decision-v1/contract.ts',
 'src/lib/subscriberReportContract.ts',
 'src/pages/admin/analysis/TradingLab.tsx',
 'supabase/functions/_shared/decision-v1-evidence.ts',
 'supabase/functions/_shared/market-report-gate.ts',
 'supabase/functions/_shared/owner-trading-lab.ts',
 'supabase/functions/_shared/recommendation-phase.ts',
 'supabase/functions/_shared/recommendation-producer.ts',
 'supabase/functions/_shared/recommendation-stock-evidence.ts',
 'supabase/functions/generate-daily-report-v7/index.ts',
 'supabase/functions/owner-trading-lab-v1/index.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'supabase/migrations/20261006235430_recommendation_phase_contract_v1.sql',
 'tests/analysisIntelligencePersistenceIntegrity.test.mjs',
 'tests/analysisIntelligencePreviousIntegrity.test.mjs',
 'tests/analysisIntelligenceShadowAuthIntegrity.test.mjs',
 'tests/fixtures/decision-evidence-rows.mjs',
 'tests/decisionEvidencePipeline.test.mjs',
 'tests/publicProjectionIntegrity.test.mjs',
 'tests/fixtures/recommendation-retained-20261006.json',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
 'tests/helpers/recommendationPhaseIntegrity.mjs',
 'tests/ownerTradingLabIntegrity.test.mjs',
 'tests/ownerTradingLabDatabase.integration.mjs',
 'tests/ownerTradingLabHandler.integration.mjs',
 'tests/helpers/ownerLabDenoServer.ts',
 'tests/helpers/ownerLabFixedClock.mjs',
 'tests/recommendationPhase.test.mjs',
 'tests/recommendationPhaseDatabase.integration.mjs',
 'tests/recommendationPhaseIntegrity.test.mjs',
 'tests/recommendationProducer.test.mjs',
 'tests/recommendationRetainedReplay.test.mjs',
 'tests/researchFoundation.test.mjs',
 'tsconfig.app.json',
].sort();
export function recommendationTransition(readSource=read){
 const m=JSON.parse(readSource(RECOMMENDATION_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_PHASE_TRANSITION_V1');assert.equal(m.candidate_base_git_sha,RECOMMENDATION_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),RECOMMENDATION_PATHS,'only the named Recommendation candidate paths');
 for(const k of ['auth_change','rls_change','secret_change','cron_change','production_deploy','forward_enabled'])assert.equal(m[k],false);
 const restored=new Map(),hashes=new Map();
 for(const row of m.files){
  assert.equal(hash(readSource(row.path)),row.candidate_sha256,`unreviewed candidate drift: ${row.path}`);
  assert(['ADD','MODIFY'].includes(row.operation));
  const before=predecessor(row.path);
  if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}
  else{assert(before);assert.equal(row.predecessor_git_sha,RECOMMENDATION_BASE);assert.equal(hash(before),row.predecessor_sha256);}
  restored.set(row.path,before);hashes.set(row.path,row.candidate_sha256);
 }
 return {manifest:m,hashes,predecessorRead:p=>{
  if(!restored.has(p))return readSource(p);const b=restored.get(p);
  if(b===null)throw Object.assign(Error('absent from Recommendation predecessor'),{code:'ENOENT'});return b;
 }};
}
/** Historical freeze is still checked byte-for-byte against its exact released
 * predecessor; the separate successor gate verifies every new candidate byte. */
export function readRecommendationPredecessor(path,readSource=read){
 const m=JSON.parse(readSource(RECOMMENDATION_MANIFEST)),row=m.files.find(r=>r.path===path);
 if(!row)return readSource(path);
 assert.equal(hash(readSource(path)),row.candidate_sha256,`unreviewed candidate drift: ${path}`);
 if(row.operation==='ADD')throw Object.assign(Error('absent from Recommendation predecessor'),{code:'ENOENT'});
 const bytes=predecessor(path);assert(bytes);
 assert.equal(hash(bytes),row.predecessor_sha256);return bytes;
}
