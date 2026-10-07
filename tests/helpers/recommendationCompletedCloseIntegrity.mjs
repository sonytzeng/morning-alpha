import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readV2Predecessor} from './recommendationV2Integrity.mjs';
export const CLOSE_BASE='f7f9cc7bfdf6e6adec65aca11f234af0339293e5';
export const CLOSE_MANIFEST='docs/10k-program/recommendation-completed-close-transition.json';
export const CLOSE_PATHS=[
 "docs/10k-program/recommendation-completed-close-runtime.md",
 "supabase/functions/_shared/recommendation-phase.ts",
 "supabase/functions/_shared/recommendation-stock-evidence.ts",
 "tests/helpers/premarketAtomicReadinessIntegrity.mjs",
 "tests/helpers/recommendationCompletedCloseIntegrity.mjs",
 "tests/helpers/recommendationStreamIntegrity.mjs",
 "tests/recommendationCompletedClose.test.mjs",
 "tests/recommendationCompletedCloseIntegrity.test.mjs",
 "tests/recommendationStreamIntegrity.test.mjs"
].sort();
const paths=new Set(CLOSE_PATHS),root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map();
function prior(path){
 if(!cache.has(path)){
  let b=null;try{b=execFileSync('git',['show',CLOSE_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==128)throw e;}
  cache.set(path,b);
 }return cache.get(path);
}
function manifest(readSource){
 const m=JSON.parse(readSource(CLOSE_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_CLOSE_TRANSITION_V1');assert.equal(m.candidate_base_git_sha,CLOSE_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),CLOSE_PATHS,'only the named Close candidate paths');
 assert.deepEqual(m.functions,['generate-daily-report-v7','recommendation-stock-evidence-smoke-v1','recommendation-stock-evidence-v1']);
 assert.deepEqual(m.migrations,[]);assert.deepEqual(m.new_secret_names,[]);
 for(const k of ['jwt_gateway_disabled','downstream_auth_change','rls_change','cron_change','threshold_change','business_strategy_change','forward_enabled','methodology_promotion'])assert.equal(m[k],false);
 return m;
}
function checked(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,'unreviewed candidate drift: '+row.path);
 const before=prior(row.path);
 if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}
 else{assert.equal(row.operation,'MODIFY');assert(before);assert.equal(row.predecessor_git_sha,CLOSE_BASE);assert.equal(hash(before),row.predecessor_sha256);}
 return before;
}
export function closeTransition(readSource=read){
 const current=readSource;readSource=p=>readV2Predecessor(p,current);
 const m=manifest(readSource),restored=new Map();for(const row of m.files)restored.set(row.path,checked(row,readSource));
 return {manifest:m,predecessorRead:p=>{
  if(!restored.has(p))return readSource(p);const b=restored.get(p);
  if(b===null)throw Object.assign(Error('absent from Close predecessor'),{code:'ENOENT'});return b;
 }};
}
export function readClosePredecessor(path,readSource=read){
 const current=readSource;readSource=p=>readV2Predecessor(p,current);
 if(!paths.has(path))return readSource(path);
 const row=manifest(readSource).files.find(r=>r.path===path),b=checked(row,readSource);
 if(b===null)throw Object.assign(Error('absent from Close predecessor'),{code:'ENOENT'});return b;
}
