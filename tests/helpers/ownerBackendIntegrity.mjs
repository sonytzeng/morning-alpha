import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MARKET_NEWS_BASE,marketNewsAwareReader} from './marketNewsIntegrity.mjs';

export const OWNER_BACKEND_BASE='16b0f6b0206844a6a537379199bef007717b9b3b';
export const OWNER_BACKEND_MANIFEST='docs/operations/evidence/owner-backend-simple-mode-transition.json';
export const OWNER_BACKEND_PREDECESSOR='tests/fixtures/line-v659-promotion-transition.json';
export const OWNER_BACKEND_PREDECESSOR_SHA256='e66aa0d24f9363741c195f94aea727d907d7a2eb34ea3479f2b9fdf9e0c09498';
export const OWNER_BACKEND_MIGRATION='supabase/migrations/20261008040043_owner_backend_status_read_model_v1.sql';
// Named scope only. Never derive authorization from a working-tree inventory,
// a manifest supplied by the caller, or a mutable file-count allowance.
export const OWNER_BACKEND_PATHS=[
 '.github/workflows/validate-release.yml',
 'docs/operations/owner-backend-simple-mode.md',
 'src/features/owner/status.ts',
 'src/pages/admin/Admin.tsx',
 'src/pages/admin/data-truth/page.tsx',
 'src/pages/admin/learning/page.tsx',
 'src/pages/admin/simple/OwnerSimplePage.tsx',
 'src/pages/admin/simple/owner-simple.css',
 'src/pages/admin/system-check/page.tsx',
 'src/pages/admin/system-health/page.tsx',
 'src/pages/admin/today-content/page.tsx',
 OWNER_BACKEND_MIGRATION,
 'tests/continuousLearningIntegration.test.mjs',
 'tests/fixtures/owner-backend-dependencies.sql',
 'tests/fixtures/owner-backend-ui.mjs',
 'tests/helpers/lineProductionPromotionIntegrity.mjs',
 'tests/helpers/ownerBackendIntegrity.mjs',
 'tests/lineProductionPromotionIntegrity.test.mjs',
 'tests/ownerBackend.test.mjs',
 'tests/ownerBackendDatabase.integration.mjs',
 'tests/ownerBackendIntegrity.test.mjs',
 'tests/ownerBackendTransition.test.mjs',
 'tests/productContract.test.mjs',
].sort();
export const OWNER_BACKEND_FALSE_FLAGS=[
 'core_auth_change','rls_policy_change','secret_change','cron_change',
 'v1_evaluation_change','v2_promotion','member_template_promotion',
 'production_data_write','manual_line_send',
];
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const priorCache=new Map(),restored=new WeakSet();
export function ownerBackendPrior(p){
 if(!priorCache.has(p)){
  const exists=git(['ls-tree','--name-only',OWNER_BACKEND_BASE,'--',p]).trim();
  priorCache.set(p,exists?execFileSync('git',['show',OWNER_BACKEND_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }
 return priorCache.get(p);
}
export function ownerBackendTransition(source=read){
 source=marketNewsAwareReader(source);
 const m=JSON.parse(source(OWNER_BACKEND_MANIFEST));
 assert.equal(m.schema_version,'OWNER_BACKEND_SIMPLE_MODE_TRANSITION_V1');
 assert.equal(m.base,OWNER_BACKEND_BASE);
 assert.equal(m.predecessor_manifest,OWNER_BACKEND_PREDECESSOR);
 assert.equal(m.predecessor_sha256,OWNER_BACKEND_PREDECESSOR_SHA256);
 assert.equal(hash(ownerBackendPrior(OWNER_BACKEND_PREDECESSOR)),OWNER_BACKEND_PREDECESSOR_SHA256,'pinned LINE promotion predecessor');
 assert.equal(hash(source(OWNER_BACKEND_PREDECESSOR)),OWNER_BACKEND_PREDECESSOR_SHA256,'immutable LINE promotion baseline');
 assert.deepEqual(m.files.map(r=>r.path).sort(),OWNER_BACKEND_PATHS,'only the named Owner Backend candidate paths');
 assert.deepEqual(m.functions,[],'Owner Backend permits no Edge Function changes/deploys');
 assert.deepEqual(m.migrations,[OWNER_BACKEND_MIGRATION]);
 assert.equal(m.read_only_rpc,'public.get_owner_backend_status_v1()');
 assert.equal(m.owner_only,true);
 for(const key of OWNER_BACKEND_FALSE_FLAGS)assert.equal(m[key],false,key);
 const before=new Map();
 for(const row of m.files){
  const b=ownerBackendPrior(row.path);
  assert.equal(row.operation,b===null?'ADD':'MODIFY',row.path);
  assert.equal(row.predecessor_git_sha,b===null?null:OWNER_BACKEND_BASE,row.path);
  assert.equal(row.predecessor_sha256,b===null?null:hash(b),row.path);
  assert.match(row.candidate_sha256,/^[a-f0-9]{64}$/);
  assert.equal(hash(source(row.path)),row.candidate_sha256,'unreviewed candidate drift (Owner Backend): '+row.path);
  before.set(row.path,b);
 }
 const predecessorRead=p=>{
  if(p===OWNER_BACKEND_MANIFEST)throw Object.assign(Error('absent from Owner Backend predecessor'),{code:'ENOENT'});
  if(!before.has(p))return source(p);
  const b=before.get(p);
  if(b===null)throw Object.assign(Error('absent from Owner Backend predecessor'),{code:'ENOENT'});
  return b;
 };
 restored.add(predecessorRead);
 return {manifest:m,predecessorRead};
}
// Only historical synthetic readers may predate this successor. Release gates
// call ownerBackendTransition unconditionally: a missing seal is a failure.
export function ownerBackendAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(OWNER_BACKEND_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return ownerBackendTransition(source).predecessorRead;
}
export function ownerBackendChangedPaths(){
 return git(['diff','--name-only','-z',OWNER_BACKEND_BASE,MARKET_NEWS_BASE,'--']).split('\0').filter(Boolean).sort();
}
