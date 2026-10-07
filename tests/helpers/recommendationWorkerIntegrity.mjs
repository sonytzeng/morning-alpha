import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const WORKER_BASE='f4c2542f5917f73d9d31eb0bf1170a3e31c061f4';
export const WORKER_MANIFEST='docs/10k-program/recommendation-worker-transition.json';
export const WORKER_PATHS=[
 'docs/10k-program/recommendation-worker-production.md',
 'supabase/functions/recommendation-stock-evidence-smoke-v1/auth.ts',
 'supabase/functions/recommendation-stock-evidence-smoke-v1/index.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'supabase/functions/_shared/recommendation-smoke.ts',
 'supabase/functions/_shared/recommendation-stock-evidence.ts',
 'supabase/functions/_shared/recommendation-company-events.ts',
 'supabase/functions/_shared/recommendation-runtime-summary.ts',
 'tests/recommendationSmokeWorkerAuth.test.mjs',
 'tests/recommendationRuntimeSmoke.test.mjs',
 'tests/recommendationRuntimeSummary.test.mjs',
 'tests/recommendationPhase.test.mjs',
 'tests/recommendationHardGateAudit.test.mjs',
 'tests/stockAcquisitionSmoke.test.mjs',
 'tests/recommendationWorkerIntegrity.test.mjs',
 'tests/helpers/recommendationWorkerIntegrity.mjs',
 'tests/helpers/recommendationHardGateIntegrity.mjs',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
 'tests/recommendationHardGateIntegrity.test.mjs',
 'tests/productContract.test.mjs',
].sort();
const paths=new Set(WORKER_PATHS),root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map();
function prior(path){
 if(!cache.has(path)){
  let b=null;try{b=execFileSync('git',['show',WORKER_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==128)throw e;}
  cache.set(path,b);
 }return cache.get(path);
}
function manifest(readSource){
 const m=JSON.parse(readSource(WORKER_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_WORKER_TRANSITION_V1');assert.equal(m.candidate_base_git_sha,WORKER_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),WORKER_PATHS,'only the named Worker candidate paths');
 assert.deepEqual(m.functions,['recommendation-stock-evidence-smoke-v1','recommendation-stock-evidence-v1']);
 assert.deepEqual(m.migrations,[]);assert.deepEqual(m.new_secret_names,['RECOMMENDATION_SMOKE_WORKER_TOKEN']);
 assert.equal(m.auth_scope,'recommendation-stock-evidence-smoke-v1:dedicated-machine-only');
 for(const k of ['gateway_change','downstream_auth_change','rls_change','cron_change','threshold_change','core_change','forward_enabled','methodology_promotion'])assert.equal(m[k],false);
 return m;
}
function checked(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,`unreviewed candidate drift: ${row.path}`);
 const before=prior(row.path);
 if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}
 else{assert.equal(row.operation,'MODIFY');assert(before);assert.equal(row.predecessor_git_sha,WORKER_BASE);assert.equal(hash(before),row.predecessor_sha256);}
 return before;
}
export function workerTransition(readSource=read){
 const m=manifest(readSource),restored=new Map();for(const row of m.files)restored.set(row.path,checked(row,readSource));
 return {manifest:m,predecessorRead:p=>{
  if(!restored.has(p))return readSource(p);const b=restored.get(p);
  if(b===null)throw Object.assign(Error('absent from Worker predecessor'),{code:'ENOENT'});return b;
 }};
}
export function readWorkerPredecessor(path,readSource=read){
 if(!paths.has(path))return readSource(path);
 const row=manifest(readSource).files.find(r=>r.path===path),b=checked(row,readSource);
 if(b===null)throw Object.assign(Error('absent from Worker predecessor'),{code:'ENOENT'});return b;
}
