import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {
 V2_RUNTIME_BASE,V2_RUNTIME_MANIFEST,V2_RUNTIME_PATHS,V2_SEALED_MANIFEST,V2_RUNTIME_COMPILED_ONLY,
 V2_SEALED_MANIFEST_SHA256,v2RuntimeManifest,v2RuntimeTransition,
 readV2RuntimePredecessor,assertV2RuntimeChangedPaths,v2RuntimeWorkingTreePaths,
} from './helpers/recommendationV2RuntimeIntegrity.mjs';
import {V2_BASE,V2_PATHS,V2_MANIFEST,v2Transition} from './helpers/recommendationV2Integrity.mjs';
import {closeTransition} from './helpers/recommendationCompletedCloseIntegrity.mjs';
import {resolveRuntimeSparseRecoveryIntegrity,PUBLIC_EXPORT_ARTIFACT_PATH} from './helpers/premarketAtomicReadinessIntegrity.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(new URL('../'+path,import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:16*1024*1024});
const priorCache=new Map();
const prior=path=>{
 if(!priorCache.has(path))priorCache.set(path,git(['show',V2_RUNTIME_BASE+':'+path]));
 return priorCache.get(path);
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value));
const missing=()=>Object.assign(Error('fixture absent'),{code:'ENOENT'});

// These hashes describe synthetic bytes held ONLY in memory, never the
// concurrent working tree. This fixture does not seal the release manifest.
function fixture(){
 const manifest=JSON.parse(read(V2_RUNTIME_MANIFEST));
 manifest.seal_status='SEALED';
 const bytes=new Map(manifest.files.map(row=>[row.path,Buffer.from('SYNTHETIC_RUNTIME_ONLY:'+row.path)]));
 for(const row of manifest.files)row.candidate_sha256=hash(bytes.get(row.path));
 const readSource=path=>path===V2_RUNTIME_MANIFEST?json(manifest):bytes.get(path)??prior(path);
 return {manifest,bytes,readSource};
}

test('runtime manifest structure pins predecessor hash, research boundaries and exact named set',()=>{
 const manifest=v2RuntimeManifest();
 assert.equal(manifest.files.length,V2_RUNTIME_PATHS.length);
 assert.equal(hash(prior(V2_SEALED_MANIFEST)),V2_SEALED_MANIFEST_SHA256);
 assert.deepEqual(read(V2_SEALED_MANIFEST),prior(V2_SEALED_MANIFEST));
});

test('provisional or missing seals never become valid runtime integrity',()=>{
 const f=fixture();f.manifest.seal_status='PROVISIONAL';
 for(const row of f.manifest.files)row.candidate_sha256=null;
 assert.throws(()=>v2RuntimeTransition(f.readSource),/manifest is provisional/);
 assert.throws(()=>readV2RuntimePredecessor(V2_RUNTIME_PATHS[0],f.readSource),/manifest is provisional/);
 f.manifest.files[0].candidate_sha256='a'.repeat(64);
 assert.throws(()=>v2RuntimeManifest(f.readSource),/provisional candidate hashes must remain unsealed/);
 const missingManifest=path=>{if(path===V2_RUNTIME_MANIFEST)throw missing();return f.readSource(path);};
 assert.throws(()=>v2RuntimeTransition(missingManifest),{code:'ENOENT'});
});

test('report function impact is compiled-only through its unchanged natural Shadow sidecar',()=>{
 const manifest=v2RuntimeManifest(),impact=manifest.compiled_only_dependencies[0];
 assert.deepEqual(manifest.compiled_only_dependencies,V2_RUNTIME_COMPILED_ONLY);
 assert.deepEqual(manifest.functions,['generate-daily-report-v7','recommendation-stock-evidence-smoke-v1','recommendation-stock-evidence-v1']);
 assert(!V2_RUNTIME_PATHS.includes(impact.entrypoint));
 assert(!V2_RUNTIME_PATHS.includes(impact.via));
 assert.deepEqual(read(impact.entrypoint),prior(impact.entrypoint));
 assert.deepEqual(read(impact.via),prior(impact.via));
 assert.match(read(impact.entrypoint).toString(),/import \{ scheduleV2Sidecar \} from '\.\.\/_shared\/recommendation-shadow-v2-runtime\.ts'/);
 for(const path of impact.changed_dependencies){
  assert(V2_RUNTIME_PATHS.includes(path));
  assert(read(impact.via).toString().includes(path.split('/').at(-1)),'unchanged runtime imports reviewed dependency');
 }
 for(const change of [
  m=>{m.functions=m.functions.filter(name=>name!=='generate-daily-report-v7');},
  m=>{m.compiled_only_dependencies=[];},
  m=>{m.compiled_only_dependencies[0].entrypoint_changed=true;},
  m=>{m.compiled_only_dependencies[0].formal_behavior_change=true;},
  m=>{m.compiled_only_dependencies[0].changed_dependencies.push('supabase/functions/_shared/decision-v1-evidence.ts');},
 ]){const f=fixture();change(f.manifest);assert.throws(()=>v2RuntimeTransition(f.readSource));}
});

test('successor restores exact PR206 bytes before PR206 and completed-close hash checks',()=>{
 const f=fixture(),runtime=v2RuntimeTransition(f.readSource);
 assert.deepEqual(v2Transition(f.readSource).manifest,JSON.parse(prior(V2_MANIFEST)));
 assert.deepEqual(v2Transition(runtime.predecessorRead).manifest,JSON.parse(prior(V2_MANIFEST)));
 assert.doesNotThrow(()=>closeTransition(f.readSource));
 assert.doesNotThrow(()=>closeTransition(runtime.predecessorRead));
 for(const row of f.manifest.files){
  assert.equal(runtime.hashes.get(row.path),row.candidate_sha256);
  if(row.operation==='ADD'){
   assert.throws(()=>runtime.predecessorRead(row.path),{code:'ENOENT'});
   assert.throws(()=>readV2RuntimePredecessor(row.path,f.readSource),{code:'ENOENT'});
  }else{
   assert.deepEqual(runtime.predecessorRead(row.path),prior(row.path));
   assert.deepEqual(readV2RuntimePredecessor(row.path,f.readSource),prior(row.path));
  }
 }
 assert.throws(()=>runtime.predecessorRead(V2_RUNTIME_MANIFEST),{code:'ENOENT'});
 assert.deepEqual(runtime.predecessorRead(V2_SEALED_MANIFEST),prior(V2_SEALED_MANIFEST));
});

test('every successor byte hash is enforced, including files overlapping the old chain',()=>{
 const f=fixture();
 for(const row of f.manifest.files){
  const drift=path=>path===row.path?Buffer.concat([f.readSource(path),Buffer.from('DRIFT')]):f.readSource(path);
  assert.throws(()=>v2RuntimeTransition(drift),/unreviewed candidate drift/);
  assert.throws(()=>readV2RuntimePredecessor(row.path,drift),/unreviewed candidate drift/);
 }
 const overlap='tests/helpers/recommendationV2Integrity.mjs';
 assert.throws(()=>v2Transition(path=>path===overlap?Buffer.from('DRIFT'):f.readSource(path)),/unreviewed candidate drift/);
 const absentPath=path=>{if(path===V2_RUNTIME_PATHS[0])throw missing();return f.readSource(path);};
 assert.throws(()=>v2RuntimeTransition(absentPath),{code:'ENOENT'});
});

test('runtime aggregate keeps older lineage and exposes successor hashes first',()=>{
 const f=fixture();
 const registry=JSON.parse(prior('docs/operations/core-stability-incident-amendment-20260908.json'));
 const integrity=resolveRuntimeSparseRecoveryIntegrity(registry,prior(PUBLIC_EXPORT_ARTIFACT_PATH),f.readSource);
 assert.deepEqual(integrity.recommendationV2RuntimeCandidateIntegrity.reviewedBaselineTransition,f.manifest);
 for(const row of f.manifest.files){
  assert.equal(integrity.fileHash(row),row.candidate_sha256);
  if(row.operation==='ADD')assert(integrity.newCandidatePaths.includes(row.path),row.path);
 }
 assert(integrity.recommendationPhaseCandidateIntegrity,'historical public result shape survives');
});

test('unknown, missing, duplicate and renamed manifest paths fail closed',()=>{
 for(const change of [
  m=>m.files.push({...m.files[0],path:'supabase/functions/unreviewed/index.ts'}),
  m=>m.files.pop(),
  m=>m.files.push({...m.files[0]}),
  m=>{m.files[0].path='../outside';},
 ]){
  const f=fixture();change(f.manifest);
  assert.throws(()=>v2RuntimeTransition(f.readSource),/exact reviewed V2 runtime candidate set/);
 }
 const expected=[...V2_RUNTIME_PATHS,V2_RUNTIME_MANIFEST];
 assert.doesNotThrow(()=>assertV2RuntimeChangedPaths(expected));
 for(const paths of [[...expected,'unknown.txt'],expected.slice(1),[...expected,expected[0]]])
  assert.throws(()=>assertV2RuntimeChangedPaths(paths),/exact V2 runtime Git diff/);
});

test('predecessor SHA, operation, hash and sealed PR206 manifest cannot be rewritten',()=>{
 for(const change of [
  m=>{m.candidate_base_git_sha=V2_BASE;},
  m=>{m.predecessor_manifest_sha256='0'.repeat(64);},
  m=>{m.files[0].predecessor_git_sha=V2_BASE;},
  m=>{m.files[0].predecessor_sha256='0'.repeat(64);},
  m=>{m.files[0].operation='ADD';},
  m=>{m.files[0].candidate_sha256=null;},
  m=>{m.files.find(row=>row.operation==='ADD').operation='MODIFY';},
 ]){const f=fixture();change(f.manifest);assert.throws(()=>v2RuntimeTransition(f.readSource));}
 const f=fixture();
 assert.throws(()=>v2RuntimeTransition(path=>path===V2_SEALED_MANIFEST?Buffer.concat([prior(path),Buffer.from('\n')]):f.readSource(path)),/sealed PR206 manifest drift/);
 for(const key of ['core_auth_change','core_rls_change','cron_change','v1_threshold_change','business_strategy_change','methodology_promotion','member_access','production_deploy']){
  const bad=fixture();bad.manifest[key]=true;assert.throws(()=>v2RuntimeTransition(bad.readSource));
 }
});

test('end-to-end Git scope compares sealed V2_BASE..PR206 separately from the runtime successor',()=>{
 const historical=git(['diff','--name-only','-z',V2_BASE,V2_RUNTIME_BASE,'--']).toString().split('\0').filter(Boolean);
 assert.deepEqual(historical.sort(),[...V2_PATHS,V2_MANIFEST].sort());
 const sealed=JSON.parse(prior(V2_MANIFEST));
 for(const row of sealed.files)assert.equal(hash(prior(row.path)),row.candidate_sha256,'sealed PR206 hash: '+row.path);
 assertV2RuntimeChangedPaths(v2RuntimeWorkingTreePaths());
 // Deliberately fails until the main agent approves the final file set and
 // explicitly seals candidate hashes; provisional is not a passing release.
 assert.doesNotThrow(()=>v2RuntimeTransition());
});

test('runtime keeps V1, Auth, RLS baseline, Cron and predecessor migrations unchanged',()=>{
 for(const path of [
  'supabase/config.toml',
  'supabase/functions/_shared/internal-function-auth.mjs',
  'supabase/functions/recommendation-stock-evidence-smoke-v1/auth.ts',
  'supabase/functions/_shared/decision-v1-evidence.ts',
  'supabase/functions/_shared/recommendation-phase.ts',
  'supabase/functions/_shared/recommendation-stock-evidence.ts',
  'supabase/functions/_shared/recommendation-producer.ts',
  'supabase/functions/generate-daily-report-v7/index.ts',
  'supabase/functions/line-daily-push/index.ts',
  'supabase/migrations/20261007092045_recommendation_v2_owner_shadow.sql',
 ])assert.deepEqual(read(path),prior(path),'protected predecessor bytes: '+path);
 const workflow='.github/workflows/recommendation-v2-shadow.yml';
 // The isolated WATCH DB job is new; workflow trigger/permissions stay sealed.
 assert.equal(read(workflow).toString().split('\njobs:')[0],prior(workflow).toString().split('\njobs:')[0]);
});
