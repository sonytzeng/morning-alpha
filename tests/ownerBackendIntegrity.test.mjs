import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
 OWNER_BACKEND_BASE,OWNER_BACKEND_MANIFEST,OWNER_BACKEND_PATHS,OWNER_BACKEND_MIGRATION,
 OWNER_BACKEND_PREDECESSOR,ownerBackendPrior,ownerBackendTransition,ownerBackendChangedPaths,
} from './helpers/ownerBackendIntegrity.mjs';
import {linePromotionTransition,linePromotionChangedPaths,LINE_PROMOTION_PATHS,LINE_PROMOTION_MANIFEST} from './helpers/lineProductionPromotionIntegrity.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>readFileSync(new URL('../'+p,import.meta.url));

test('Owner Backend release requires an exact sealed file set and exactly one named read-model migration',()=>{
 const t=ownerBackendTransition(); // Missing/unsealed manifest must fail, never skip.
 assert.deepEqual(ownerBackendChangedPaths(),[...OWNER_BACKEND_PATHS,OWNER_BACKEND_MANIFEST].sort());
 assert.deepEqual(t.manifest.files.filter(r=>r.path.startsWith('supabase/migrations/')).map(r=>r.path),[OWNER_BACKEND_MIGRATION]);
 assert.deepEqual(t.manifest.files.filter(r=>r.path.startsWith('supabase/functions/')),[]);
 for(const row of t.manifest.files){
  if(row.operation==='ADD')assert.throws(()=>t.predecessorRead(row.path),{code:'ENOENT'});
  else assert.deepEqual(t.predecessorRead(row.path),ownerBackendPrior(row.path));
 }
});

test('Owner Backend successor preserves released LINE promotion scope/hashes and every prior Function/migration',()=>{
 const t=ownerBackendTransition();
 assert.deepEqual(read(OWNER_BACKEND_PREDECESSOR),ownerBackendPrior(OWNER_BACKEND_PREDECESSOR));
 linePromotionTransition(t.predecessorRead);
 assert.deepEqual(linePromotionChangedPaths(),[...LINE_PROMOTION_PATHS,LINE_PROMOTION_MANIFEST].sort());
 const protectedPaths=execFileSync('git',['ls-tree','-r','--name-only','-z',OWNER_BACKEND_BASE,'--',
  'supabase/functions','supabase/migrations','supabase/config.toml','src/features/line','src/pages/admin/analysis',
  '.github/workflows/deploy-morning-alpha-runtime.yml','.github/workflows/morning-alpha-runtime-checkpoints.yml'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 assert(protectedPaths.length>0);
 for(const p of protectedPaths)assert.deepEqual(read(p),ownerBackendPrior(p),'unchanged released source: '+p);
});

test('Owner Backend release rejects drift in every sealed byte and a rewritten LINE predecessor',()=>{
 const t=ownerBackendTransition();
 for(const row of t.manifest.files)assert.throws(()=>ownerBackendTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 assert.throws(()=>ownerBackendTransition(p=>p===OWNER_BACKEND_PREDECESSOR?Buffer.from('{}'):read(p)),/immutable LINE promotion baseline/);
});
