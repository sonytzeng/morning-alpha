import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {marketNewsAwareReader} from './helpers/marketNewsIntegrity.mjs';
import {LINE_PROMOTION_PATHS,LINE_PROMOTION_MANIFEST,linePromotionTransition,linePromotionChangedPaths,linePromotionPrior} from './helpers/lineProductionPromotionIntegrity.mjs';
import {ownerBackendTransition} from './helpers/ownerBackendIntegrity.mjs';
const read=marketNewsAwareReader(p=>readFileSync(new URL('../'+p,import.meta.url)));
test('promotion exact file set/hash/lineage and single allowed Function',()=>{
 ownerBackendTransition(); // Validate every successor byte before historical restoration.
 const t=linePromotionTransition();
 assert.deepEqual(linePromotionChangedPaths(),[...LINE_PROMOTION_PATHS,LINE_PROMOTION_MANIFEST].sort());
 for(const r of t.manifest.files){if(r.operation==='ADD')assert.throws(()=>t.predecessorRead(r.path),{code:'ENOENT'});else assert.deepEqual(t.predecessorRead(r.path),linePromotionPrior(r.path));}
 for(const p of ['supabase/config.toml','supabase/functions/_shared/market-publication-contract.ts','supabase/functions/_shared/line-daily-flex-message.mjs',
  'supabase/functions/daily-delivery-orchestrator/index.ts','supabase/functions/generate-daily-report-v7/index.ts',
  'supabase/functions/_shared/internal-function-auth.mjs','src/pages/admin/analysis/LineDecisionPreview.tsx'])
  assert.deepEqual(read(p),linePromotionPrior(p),p);
});
test('promotion rejects unknown files/bytes, rewritten predecessor, unrelated deploy and auth/write escalation',()=>{
 for(const p of LINE_PROMOTION_PATHS)assert.throws(()=>linePromotionTransition(q=>q===p?Buffer.concat([read(q),Buffer.from('DRIFT')]):read(q)),/unreviewed candidate drift/);
 for(const mutate of [m=>m.files.pop(),m=>m.files.push({...m.files[0],path:'unknown'}),m=>m.functions.push('other'),
  m=>m.manual_line_send=true,m=>m.production_data_write=true,m=>m.auth_change=true,m=>m.v2_promotion=true,
  m=>m.recommendation_source='SHADOW_V2',m=>m.predecessor_sha256='bad']){
  const m=JSON.parse(read(LINE_PROMOTION_MANIFEST));mutate(m);
  assert.throws(()=>linePromotionTransition(p=>p===LINE_PROMOTION_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));
 }
 assert.throws(()=>linePromotionTransition(p=>p==='tests/fixtures/line-compact-transition.json'?Buffer.from('{}'):read(p)),/immutable PR214/);
});
