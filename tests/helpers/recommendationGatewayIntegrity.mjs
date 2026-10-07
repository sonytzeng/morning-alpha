import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readStreamPredecessor} from './recommendationStreamIntegrity.mjs';
export const GATEWAY_BASE='db5f1ec285a2cb98df05aa6b1edb30450906f62a';
export const GATEWAY_MANIFEST='docs/10k-program/recommendation-gateway-transition.json';
export const GATEWAY_PATHS=[
 'docs/10k-program/recommendation-gateway-runtime.md',
 'supabase/functions/_shared/recommendation-producer.ts',
 'supabase/functions/_shared/recommendation-smoke.ts',
 'supabase/functions/generate-daily-report-v7/index.ts',
 'supabase/functions/recommendation-stock-evidence-smoke-v1/index.ts',
 'tests/recommendationProducer.test.mjs',
 'tests/recommendationRuntimeSmoke.test.mjs',
 'tests/recommendationWorkerIntegrity.test.mjs',
 'tests/recommendationGatewayIntegrity.test.mjs',
 'tests/helpers/recommendationGatewayIntegrity.mjs',
 'tests/helpers/recommendationWorkerIntegrity.mjs',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
].sort();
const paths=new Set(GATEWAY_PATHS),root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map();
function prior(path){
 if(!cache.has(path)){
  let b=null;try{b=execFileSync('git',['show',GATEWAY_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==128)throw e;}
  cache.set(path,b);
 }return cache.get(path);
}
function manifest(readSource){
 const m=JSON.parse(readSource(GATEWAY_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_GATEWAY_TRANSITION_V1');assert.equal(m.candidate_base_git_sha,GATEWAY_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),GATEWAY_PATHS,'only the named Gateway candidate paths');
 assert.deepEqual(m.functions,['generate-daily-report-v7','recommendation-stock-evidence-smoke-v1']);
 assert.deepEqual(m.migrations,[]);assert.deepEqual(m.new_secret_names,['RECOMMENDATION_GATEWAY_ANON_JWT']);
 for(const k of ['jwt_gateway_disabled','downstream_auth_change','rls_change','cron_change','threshold_change','business_strategy_change','forward_enabled','methodology_promotion'])assert.equal(m[k],false);
 return m;
}
function checked(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,'unreviewed candidate drift: '+row.path);
 const before=prior(row.path);
 if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}
 else{assert.equal(row.operation,'MODIFY');assert(before);assert.equal(row.predecessor_git_sha,GATEWAY_BASE);assert.equal(hash(before),row.predecessor_sha256);}
 return before;
}
export function gatewayTransition(readSource=read){
 const current=readSource;readSource=p=>readStreamPredecessor(p,current);
 const m=manifest(readSource),restored=new Map();for(const row of m.files)restored.set(row.path,checked(row,readSource));
 return {manifest:m,predecessorRead:p=>{
  if(!restored.has(p))return readSource(p);const b=restored.get(p);
  if(b===null)throw Object.assign(Error('absent from Gateway predecessor'),{code:'ENOENT'});return b;
 }};
}
export function readGatewayPredecessor(path,readSource=read){
 const current=readSource;readSource=p=>readStreamPredecessor(p,current);
 if(!paths.has(path))return readSource(path);
 const row=manifest(readSource).files.find(r=>r.path===path),b=checked(row,readSource);
 if(b===null)throw Object.assign(Error('absent from Gateway predecessor'),{code:'ENOENT'});return b;
}
