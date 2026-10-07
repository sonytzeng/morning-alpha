import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const HARD_GATE_BASE='82600edeef0fbc37fbfa64c939ade72315458e1b';
export const HARD_GATE_MANIFEST='docs/10k-program/recommendation-hard-gate-transition.json';
export const HARD_GATE_PATHS=[
 '.github/workflows/validate-release.yml',
 'docs/10k-program/recommendation-hard-gate-audit.md',
 'research/recommendation-v2-shadow.ts',
 'supabase/functions/_shared/recommendation-company-events.ts',
 'supabase/functions/_shared/recommendation-smoke.ts',
 'supabase/functions/recommendation-stock-evidence-smoke-v1/index.ts',
 'tests/helpers/recommendationHardGateIntegrity.mjs',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
 'tests/helpers/stockAcquisitionIntegrity.mjs',
 'tests/productContract.test.mjs',
 'tests/recommendationHardGateAudit.test.mjs',
 'tests/recommendationHardGateIntegrity.test.mjs',
 'tests/recommendationRuntimeSmoke.test.mjs',
 'tests/stockAcquisitionIntegrity.test.mjs',
].sort();
const paths=new Set(HARD_GATE_PATHS),root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),objects=new Map();
function predecessor(path){
 if(!objects.has(path)){
  let bytes=null;try{bytes=execFileSync('git',['show',HARD_GATE_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==128)throw e;}
  objects.set(path,bytes);
 }
 return objects.get(path);
}
function manifest(readSource){
 const m=JSON.parse(readSource(HARD_GATE_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_HARD_GATE_TRANSITION_V1');assert.equal(m.candidate_base_git_sha,HARD_GATE_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),HARD_GATE_PATHS,'only the named Hard Gate candidate paths');
 assert.deepEqual(m.functions,['recommendation-stock-evidence-smoke-v1']);assert.deepEqual(m.migrations,[]);
 for(const k of ['auth_change','rls_change','secret_change','cron_change','threshold_change','core_change','production_deploy','forward_enabled','methodology_promotion'])assert.equal(m[k],false);
 return m;
}
function checked(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,`unreviewed candidate drift: ${row.path}`);
 const before=predecessor(row.path);
 if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}
 else{assert.equal(row.operation,'MODIFY');assert(before);assert.equal(row.predecessor_git_sha,HARD_GATE_BASE);assert.equal(hash(before),row.predecessor_sha256);}
 return before;
}
export function hardGateTransition(readSource=read){
 const m=manifest(readSource),restored=new Map();for(const row of m.files)restored.set(row.path,checked(row,readSource));
 return {manifest:m,predecessorRead:p=>{
  if(!restored.has(p))return readSource(p);const bytes=restored.get(p);
  if(bytes===null)throw Object.assign(Error('absent from Hard Gate predecessor'),{code:'ENOENT'});return bytes;
 }};
}
export function readHardGatePredecessor(path,readSource=read){
 if(!paths.has(path))return readSource(path);
 const row=manifest(readSource).files.find(r=>r.path===path),bytes=checked(row,readSource);
 if(bytes===null)throw Object.assign(Error('absent from Hard Gate predecessor'),{code:'ENOENT'});return bytes;
}
