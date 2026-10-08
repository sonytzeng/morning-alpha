import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 OWNER_BACKEND_BASE,OWNER_BACKEND_MANIFEST,OWNER_BACKEND_PATHS,OWNER_BACKEND_MIGRATION,
 OWNER_BACKEND_PREDECESSOR,OWNER_BACKEND_PREDECESSOR_SHA256,OWNER_BACKEND_FALSE_FLAGS,
 ownerBackendPrior,ownerBackendTransition,ownerBackendAwareReader,
} from './helpers/ownerBackendIntegrity.mjs';
import {linePromotionTransition,LINE_PROMOTION_MANIFEST} from './helpers/lineProductionPromotionIntegrity.mjs';
import {resolveRuntimeSparseRecoveryIntegrity,PUBLIC_EXPORT_ARTIFACT_PATH} from './helpers/premarketAtomicReadinessIntegrity.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
// Deliberately synthetic, in-memory candidate. This tests transition mechanics
// without creating a release manifest or blessing the live UI/SQL while edited.
function fixture(){
 const bytes=new Map(OWNER_BACKEND_PATHS.map(p=>[p,Buffer.from('SYNTHETIC_OWNER_BACKEND_TEST_ONLY:'+p)]));
 const manifest={schema_version:'OWNER_BACKEND_SIMPLE_MODE_TRANSITION_V1',base:OWNER_BACKEND_BASE,
  predecessor_manifest:OWNER_BACKEND_PREDECESSOR,predecessor_sha256:OWNER_BACKEND_PREDECESSOR_SHA256,
  functions:[],migrations:[OWNER_BACKEND_MIGRATION],read_only_rpc:'public.get_owner_backend_status_v1()',owner_only:true,
  ...Object.fromEntries(OWNER_BACKEND_FALSE_FLAGS.map(k=>[k,false])),
  files:OWNER_BACKEND_PATHS.map(path=>{const b=ownerBackendPrior(path);return {path,operation:b===null?'ADD':'MODIFY',
   predecessor_git_sha:b===null?null:OWNER_BACKEND_BASE,predecessor_sha256:b===null?null:hash(b),candidate_sha256:hash(bytes.get(path))};})};
 const source=p=>{
  if(p===OWNER_BACKEND_MANIFEST)return Buffer.from(JSON.stringify(manifest));
  if(bytes.has(p))return bytes.get(p);
  const b=ownerBackendPrior(p);if(b===null)throw Object.assign(Error('absent fixture'),{code:'ENOENT'});return b;
 };
 return {bytes,manifest,source};
}

test('synthetic Owner successor restores exact released bytes/absence and retains the full LINE promotion seal',()=>{
 const f=fixture(),t=ownerBackendTransition(f.source);
 assert.equal(t.manifest.files.length,23);
 assert.deepEqual(t.manifest.files.filter(r=>r.path.startsWith('supabase/migrations/')).map(r=>r.path),[OWNER_BACKEND_MIGRATION]);
 for(const row of t.manifest.files){
  if(row.operation==='ADD')assert.throws(()=>t.predecessorRead(row.path),{code:'ENOENT'});
  else assert.deepEqual(t.predecessorRead(row.path),ownerBackendPrior(row.path));
 }
 assert.throws(()=>t.predecessorRead(OWNER_BACKEND_MANIFEST),{code:'ENOENT'});
 assert.deepEqual(t.predecessorRead(OWNER_BACKEND_PREDECESSOR),ownerBackendPrior(OWNER_BACKEND_PREDECESSOR));
 assert.equal(hash(t.predecessorRead(LINE_PROMOTION_MANIFEST)),OWNER_BACKEND_PREDECESSOR_SHA256);
 const promotion=linePromotionTransition(t.predecessorRead);
 assert.equal(promotion.manifest.schema_version,'LINE_V659_MEMBER_TEMPLATE_PROMOTION_V1');
 assert.equal(ownerBackendAwareReader(t.predecessorRead),t.predecessorRead);
 assert.deepEqual(ownerBackendAwareReader(f.source)('src/pages/admin/Admin.tsx'),ownerBackendPrior('src/pages/admin/Admin.tsx'));
});

test('synthetic successor rejects every drifted/missing candidate and never caches candidate bytes',()=>{
 const f=fixture();ownerBackendTransition(f.source);
 for(const path of OWNER_BACKEND_PATHS){
  assert.throws(()=>ownerBackendTransition(p=>p===path?Buffer.concat([f.source(p),Buffer.from('DRIFT')]):f.source(p)),/unreviewed candidate drift/);
  assert.throws(()=>ownerBackendTransition(p=>{if(p===path)throw Object.assign(Error('missing'),{code:'ENOENT'});return f.source(p);}),{code:'ENOENT'});
 }
 f.bytes.set(OWNER_BACKEND_PATHS[0],Buffer.from('changed after prior validation'));
 assert.throws(()=>ownerBackendTransition(f.source),/unreviewed candidate drift/);
 assert.throws(()=>ownerBackendAwareReader(f.source),/unreviewed candidate drift/);
});

test('synthetic successor rejects unknown/duplicate scopes, extra migrations, deploys and security/production escalation',()=>{
 const mutations=[
  m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.push({...m.files[0],path:'unapproved'}),
  m=>m.base='unreviewed',m=>m.schema_version='unreviewed',m=>m.predecessor_manifest='unreviewed',m=>m.predecessor_sha256='0'.repeat(64),
  m=>m.functions.push('line-daily-push'),m=>m.migrations=[],m=>m.migrations.push('supabase/migrations/unapproved.sql'),
  m=>m.migrations=[OWNER_BACKEND_MIGRATION.replace('20261008040043','20261008040044')],
  m=>m.read_only_rpc='public.some_other_rpc()',m=>m.owner_only=false,
  ...OWNER_BACKEND_FALSE_FLAGS.map(k=>m=>{m[k]=true;}),
  m=>m.files[0].predecessor_sha256='0'.repeat(64),m=>m.files[0].predecessor_git_sha='HEAD',
  m=>m.files.find(r=>r.operation==='ADD').operation='MODIFY',
  m=>m.files.find(r=>r.operation==='MODIFY').operation='ADD',
  m=>m.files[0].candidate_sha256='invalid',
 ];
 for(const mutate of mutations){const f=fixture();mutate(f.manifest);assert.throws(()=>ownerBackendTransition(f.source));}
});

test('synthetic successor cannot rewrite LINE history or omit the seal at the release entrypoint',()=>{
 const f=fixture();
 assert.throws(()=>ownerBackendTransition(p=>p===OWNER_BACKEND_PREDECESSOR?Buffer.from('{}'):f.source(p)),/immutable LINE promotion baseline/);
 assert.throws(()=>ownerBackendTransition(p=>{if(p===OWNER_BACKEND_MANIFEST)throw Object.assign(Error('missing'),{code:'ENOENT'});return f.source(p);}),{code:'ENOENT'});
 const historical=p=>{const b=ownerBackendPrior(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;};
 assert.equal(ownerBackendAwareReader(historical),historical);
 assert.doesNotThrow(()=>linePromotionTransition(historical));
});

test('synthetic Owner successor restores the entire prior Core chain without changing registry hashes or prior inventories',()=>{
 const f=fixture(),registry=JSON.parse(f.source('docs/operations/core-stability-incident-amendment-20260908.json'));
 const historical=p=>{const b=ownerBackendPrior(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;};
 const before=resolveRuntimeSparseRecoveryIntegrity(registry,historical(PUBLIC_EXPORT_ARTIFACT_PATH),historical);
 const after=resolveRuntimeSparseRecoveryIntegrity(registry,f.source(PUBLIC_EXPORT_ARTIFACT_PATH),f.source);
 assert.deepEqual(after.newCandidatePaths,before.newCandidatePaths);
 for(const row of registry.files)assert.equal(after.fileHash(row),before.fileHash(row),row.path);
 assert.deepEqual(after.ownerTradingLabCandidateIntegrity,before.ownerTradingLabCandidateIntegrity);
 for(const p of ['tests/fixtures/line-v659-promotion-transition.json','tests/fixtures/line-compact-transition.json',
  'docs/operations/evidence/line-final-usability-transition.json','docs/operations/evidence/line-final-copy-transition.json',
  'docs/operations/evidence/line-decision-card-v2-transition.json','docs/10k-program/recommendation-v2-forward-transition.json'])
  assert.deepEqual(f.source(p),historical(p),'immutable prior seal: '+p);
});
