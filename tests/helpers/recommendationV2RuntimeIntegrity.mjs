import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const V2_RUNTIME_BASE='4f8884ddf4b08c5cbb124c2d48acb31ed31e40f7';
export const V2_RUNTIME_MANIFEST='docs/10k-program/recommendation-v2-runtime-transition.json';
export const V2_SEALED_MANIFEST='docs/10k-program/recommendation-v2-shadow-transition.json';
export const V2_SEALED_MANIFEST_SHA256='8b926738bf49167054e2cb38ab3552fdea0c58ac5a71bc81ca8e97cb5c98f0e3';
export const V2_RUNTIME_MIGRATION='20261007113746_recommendation_v2_watch_prospective_lock.sql';
export const V2_RUNTIME_DEPLOY_NOTE='Candidate artifact only: production_deploy=false is not live deployment telemetry or deployment authorization. The three-function inventory includes generate-daily-report-v7 compiled-only dependencies; each deployment requires separate explicit approval.';
export const V2_RUNTIME_COMPILED_ONLY=[{
 function:'generate-daily-report-v7',
 entrypoint:'supabase/functions/generate-daily-report-v7/index.ts',
 via:'supabase/functions/_shared/recommendation-shadow-v2-runtime.ts',
 changed_dependencies:[
  'supabase/functions/_shared/recommendation-shadow-v2-engine.ts',
  'supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts',
 ],
 entrypoint_changed:false,
 formal_behavior_change:false,
 reason:'Existing natural V2 Shadow sidecar bundles the WATCH outcome evaluator and institutional evidence output. Compiled dependencies only; no report index, V1 gates, selection or formal report behavior change. Function inventory is not deployment authorization.',
}];
// Explicitly reviewed scope. Finalization must update this list and
// the successor manifest together; never derive an allowlist from the diff.
export const V2_RUNTIME_PATHS=[
 '.github/workflows/recommendation-v2-shadow.yml',
 'src/features/research/recommendation-shadow-v2-summary.ts',
 'src/pages/admin/analysis/RecommendationShadow.tsx',
 'supabase/functions/_shared/recommendation-shadow-v2-engine.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-smoke.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-sources.ts',
 'supabase/functions/_shared/recommendation-smoke.ts',
 'supabase/functions/recommendation-stock-evidence-smoke-v1/index.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'supabase/migrations/'+V2_RUNTIME_MIGRATION,
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
 'tests/helpers/recommendationV2Integrity.mjs',
 'tests/helpers/recommendationV2RuntimeIntegrity.mjs',
 'tests/recommendationRuntimeSmoke.test.mjs',
 'tests/recommendationV2FugleRuntime.test.mjs',
 'tests/recommendationV2Integrity.test.mjs',
 'tests/recommendationV2Prospective.test.mjs',
 'tests/recommendationV2RuntimeIntegrity.test.mjs',
 'tests/recommendationV2Smoke.test.mjs',
 'tests/recommendationV2UI.test.mjs',
 'tests/recommendationV2WatchLock.test.mjs',
 'tests/recommendationV2WatchLockDatabase.integration.mjs',
].sort();

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(new URL('../../'+path,import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths=new Set(V2_RUNTIME_PATHS),cache=new Map(),restoredReaders=new WeakSet();
const absent=()=>Object.assign(Error('absent from V2 runtime predecessor'),{code:'ENOENT'});
function prior(path){
 if(!cache.has(path)){
  // Enumerate the immutable tree first: a missing object or git failure must
  // not be mistaken for a legitimate ADD operation.
  const exists=execFileSync('git',['ls-tree','--name-only',V2_RUNTIME_BASE,'--',path],{cwd:root,encoding:'utf8'}).trim();
  cache.set(path,exists?execFileSync('git',['show',V2_RUNTIME_BASE+':'+path],{cwd:root}):null);
 }
 return cache.get(path);
}

export function assertV2SealedManifest(readSource=read){
 assert.equal(hash(readSource(V2_SEALED_MANIFEST)),V2_SEALED_MANIFEST_SHA256,'sealed PR206 manifest drift');
 assert.equal(hash(prior(V2_SEALED_MANIFEST)),V2_SEALED_MANIFEST_SHA256,'sealed PR206 Git manifest drift');
}

export function v2RuntimeManifest(readSource=read){
 const m=JSON.parse(readSource(V2_RUNTIME_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_V2_RUNTIME_TRANSITION_V1');
 assert.equal(m.candidate_base_git_sha,V2_RUNTIME_BASE);
 assert.equal(m.predecessor_manifest,V2_SEALED_MANIFEST);
 assert.equal(m.predecessor_manifest_sha256,V2_SEALED_MANIFEST_SHA256);
 assert.deepEqual(m.files.map(row=>row.path).sort(),V2_RUNTIME_PATHS,'exact reviewed V2 runtime candidate set');
 assert.deepEqual(m.functions,['generate-daily-report-v7','recommendation-stock-evidence-smoke-v1','recommendation-stock-evidence-v1']);
 assert.deepEqual(m.compiled_only_dependencies,V2_RUNTIME_COMPILED_ONLY,'exact compiled-only report dependency impact');
 assert.equal(m.production_deploy_note,V2_RUNTIME_DEPLOY_NOTE);
 assert.deepEqual(m.migrations,[V2_RUNTIME_MIGRATION]);
 assert.deepEqual(m.new_secret_names,[]);
 for(const key of ['core_auth_change','core_rls_change','cron_change','v1_threshold_change','business_strategy_change','methodology_promotion','member_access','production_deploy'])assert.equal(m[key],false,key);
 for(const key of ['owner_shadow_only','forward_lock_prospective_only','watch_lock_forward_only','fugle_shares_acquisition','authorized_research_only_persistence','readonly_smoke_preserved'])assert.equal(m[key],true,key);
 assert(['PROVISIONAL','SEALED'].includes(m.seal_status),'explicit successor seal status required');
 for(const row of m.files){
  assert.equal(row.predecessor_git_sha,V2_RUNTIME_BASE,'runtime predecessor commit: '+row.path);
  const before=prior(row.path);
  assert.equal(row.operation,before===null?'ADD':'MODIFY','runtime predecessor operation: '+row.path);
  assert.equal(row.predecessor_sha256,before===null?null:hash(before),'runtime predecessor hash: '+row.path);
  if(m.seal_status==='PROVISIONAL')assert.equal(row.candidate_sha256,null,'provisional candidate hashes must remain unsealed');
  else assert.match(row.candidate_sha256,/^[a-f0-9]{64}$/,'sealed candidate hash required: '+row.path);
 }
 assertV2SealedManifest(readSource);
 return m;
}

function sealedManifest(readSource){
 const m=v2RuntimeManifest(readSource);
 assert.equal(m.seal_status,'SEALED','V2 runtime manifest is provisional; await main-agent final file-set approval and hash sealing');
 return m;
}
function checked(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,'unreviewed candidate drift (V2 runtime): '+row.path);
 return prior(row.path);
}

export function v2RuntimeTransition(readSource=read){
 const manifest=sealedManifest(readSource),restored=new Map(),hashes=new Map();
 for(const row of manifest.files){restored.set(row.path,checked(row,readSource));hashes.set(row.path,row.candidate_sha256);}
 const predecessorRead=path=>{
  if(path===V2_RUNTIME_MANIFEST)throw absent();
  if(!restored.has(path))return readSource(path);
  const before=restored.get(path);if(before===null)throw absent();return before;
 };
 // Only readers produced after all candidate checks may bypass a second
 // restoration. Never silently accept ENOENT for the successor manifest.
 restoredReaders.add(predecessorRead);
 return {manifest,hashes,predecessorRead};
}

export function readV2RuntimePredecessor(path,readSource=read){
 if(restoredReaders.has(readSource))return readSource(path);
 if(path===V2_SEALED_MANIFEST){assertV2SealedManifest(readSource);return readSource(path);}
 if(!paths.has(path))return readSource(path);
 const row=sealedManifest(readSource).files.find(row=>row.path===path),before=checked(row,readSource);
 if(before===null)throw absent();return before;
}

export function assertV2RuntimeChangedPaths(changedPaths){
 assert.deepEqual([...changedPaths].sort(),[...V2_RUNTIME_PATHS,V2_RUNTIME_MANIFEST].sort(),
  'exact V2 runtime Git diff; unknown, missing or duplicate files fail');
}

export function v2RuntimeWorkingTreePaths(){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 return [...new Set([...git(['diff','--name-only','-z',V2_RUNTIME_BASE,'--']),
  ...git(['ls-files','--others','--exclude-standard','-z'])])].sort();
}
