import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const STOCK_ACQUISITION_BASE='63e1a167a03bc39fa2cce3b4979f7e6a398a81b0';
export const STOCK_ACQUISITION_MANIFEST='docs/10k-program/stock-acquisition-transition.json';
export const STOCK_ACQUISITION_PATHS=[
 'docs/10k-program/stock-acquisition-candidate.md',
 'supabase/functions/_shared/recommendation-stock-evidence.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'tests/helpers/recommendationPhaseIntegrity.mjs',
 'tests/helpers/stockAcquisitionIntegrity.mjs',
 'tests/recommendationPhaseIntegrity.test.mjs',
 'tests/stockAcquisitionIntegrity.test.mjs',
 'tests/stockAcquisitionSmoke.test.mjs',
].sort();
const candidatePaths=new Set(STOCK_ACQUISITION_PATHS);
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const gitObjects=new Map();
function predecessor(path){
 if(!gitObjects.has(path)){
  let bytes=null;
  try{bytes=execFileSync('git',['show',STOCK_ACQUISITION_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}
  catch(e){if(e.status!==128)throw e;}
  gitObjects.set(path,bytes);
 }
 return gitObjects.get(path);
}
function manifest(readSource){
 const m=JSON.parse(readSource(STOCK_ACQUISITION_MANIFEST));
 assert.equal(m.schema_version,'STOCK_ACQUISITION_TRANSITION_V1');
 assert.equal(m.candidate_base_git_sha,STOCK_ACQUISITION_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),STOCK_ACQUISITION_PATHS,'only the named Stock Acquisition candidate paths');
 assert.deepEqual(m.functions,['recommendation-stock-evidence-v1']);
 assert.deepEqual(m.migrations,[]);
 for(const k of ['auth_change','rls_change','secret_change','cron_change','threshold_change','core_change','production_deploy','forward_enabled'])assert.equal(m[k],false);
 return m;
}
function verifiedPredecessor(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,`unreviewed candidate drift: ${row.path}`);
 const before=predecessor(row.path);
 if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}
 else{assert.equal(row.operation,'MODIFY');assert(before);assert.equal(row.predecessor_git_sha,STOCK_ACQUISITION_BASE);assert.equal(hash(before),row.predecessor_sha256);}
 return before;
}
export function stockAcquisitionTransition(readSource=read){
 const m=manifest(readSource),restored=new Map();
 for(const row of m.files)restored.set(row.path,verifiedPredecessor(row,readSource));
 return {manifest:m,predecessorRead:p=>{
  if(!restored.has(p))return readSource(p);
  const bytes=restored.get(p);
  if(bytes===null)throw Object.assign(Error('absent from Stock Acquisition predecessor'),{code:'ENOENT'});
  return bytes;
 }};
}
// Older seals continue to validate the exact released bytes. The successor
// validates every current byte first; no historical hash is replaced.
export function readStockAcquisitionPredecessor(path,readSource=read){
 if(!candidatePaths.has(path))return readSource(path);
 const row=manifest(readSource).files.find(r=>r.path===path);
 if(!row)return readSource(path);
 const bytes=verifiedPredecessor(row,readSource);
 if(bytes===null)throw Object.assign(Error('absent from Stock Acquisition predecessor'),{code:'ENOENT'});
 return bytes;
}
