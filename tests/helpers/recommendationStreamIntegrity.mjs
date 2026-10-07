import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const STREAM_BASE='eb0286320c7874744ab5b3bc74d77b22f6e17c85';
export const STREAM_MANIFEST='docs/10k-program/recommendation-stream-transition.json';
export const STREAM_PATHS=[
 "docs/10k-program/recommendation-stream-runtime.md",
 "supabase/functions/_shared/recommendation-producer.ts",
 "supabase/functions/_shared/recommendation-smoke.ts",
 "supabase/functions/_shared/recommendation-stream.ts",
 "supabase/functions/recommendation-stock-evidence-smoke-v1/index.ts",
 "supabase/functions/recommendation-stock-evidence-v1/index.ts",
 "tests/helpers/premarketAtomicReadinessIntegrity.mjs",
 "tests/helpers/recommendationGatewayIntegrity.mjs",
 "tests/helpers/recommendationStreamIntegrity.mjs",
 "tests/recommendationGatewayIntegrity.test.mjs",
 "tests/recommendationStream.test.mjs",
 "tests/recommendationStreamIntegrity.test.mjs"
].sort();
const paths=new Set(STREAM_PATHS),root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map();
function prior(path){
 if(!cache.has(path)){
  let b=null;try{b=execFileSync('git',['show',STREAM_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==128)throw e;}
  cache.set(path,b);
 }return cache.get(path);
}
function manifest(readSource){
 const m=JSON.parse(readSource(STREAM_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_STREAM_TRANSITION_V1');assert.equal(m.candidate_base_git_sha,STREAM_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),STREAM_PATHS,'only the named Stream candidate paths');
 assert.deepEqual(m.functions,['generate-daily-report-v7','recommendation-stock-evidence-smoke-v1','recommendation-stock-evidence-v1']);
 assert.deepEqual(m.migrations,[]);assert.deepEqual(m.new_secret_names,[]);
 for(const k of ['jwt_gateway_disabled','downstream_auth_change','rls_change','cron_change','threshold_change','business_strategy_change','forward_enabled','methodology_promotion'])assert.equal(m[k],false);
 return m;
}
function checked(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,'unreviewed candidate drift: '+row.path);
 const before=prior(row.path);
 if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}
 else{assert.equal(row.operation,'MODIFY');assert(before);assert.equal(row.predecessor_git_sha,STREAM_BASE);assert.equal(hash(before),row.predecessor_sha256);}
 return before;
}
export function streamTransition(readSource=read){
 const m=manifest(readSource),restored=new Map();for(const row of m.files)restored.set(row.path,checked(row,readSource));
 return {manifest:m,predecessorRead:p=>{
  if(!restored.has(p))return readSource(p);const b=restored.get(p);
  if(b===null)throw Object.assign(Error('absent from Stream predecessor'),{code:'ENOENT'});return b;
 }};
}
export function readStreamPredecessor(path,readSource=read){
 if(!paths.has(path))return readSource(path);
 const row=manifest(readSource).files.find(r=>r.path===path),b=checked(row,readSource);
 if(b===null)throw Object.assign(Error('absent from Stream predecessor'),{code:'ENOENT'});return b;
}
