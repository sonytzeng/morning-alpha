import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {MARKET_NEWS_BASE,MARKET_NEWS_MANIFEST,MARKET_NEWS_PATHS,marketNewsPrior,marketNewsTransition,marketNewsChangedPaths} from './helpers/marketNewsIntegrity.mjs';
import {ownerBackendTransition} from './helpers/ownerBackendIntegrity.mjs';
import {entryAwareReader} from './helpers/entryOpportunityIntegrity.mjs';
const read=entryAwareReader(p=>readFileSync(new URL('../'+p,import.meta.url)));
test('news candidate preserves exact predecessor and has only one deployable Function, no Production authorization',()=>{
 const t=marketNewsTransition();ownerBackendTransition(t.predecessorRead);
 assert.deepEqual(marketNewsChangedPaths(),[...MARKET_NEWS_PATHS,MARKET_NEWS_MANIFEST].sort());
 const protectedPaths=execFileSync('git',['ls-tree','-r','--name-only',MARKET_NEWS_BASE,'--','supabase','src','research','.github'],{encoding:'utf8'}).trim().split('\n');
 for(const p of protectedPaths){if(p==='supabase/functions/daily-delivery-orchestrator/index.ts')continue;
  assert.deepEqual(read(p),marketNewsPrior(p),'unchanged business/quality/security path '+p);
 }
});
test('news transition rejects changed bytes, unknown paths, altered historical seal or deployment escalation',()=>{
 for(const p of MARKET_NEWS_PATHS)assert.throws(()=>marketNewsTransition(q=>q===p?Buffer.concat([read(q),Buffer.from('DRIFT')]):read(q)),/unreviewed candidate drift/);
 for(const mutate of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.functions.push('generate-daily-report-v7'),
  m=>m.migrations.push('extra'),m=>m.quality_threshold_change=true,m=>m.production_deploy_authorized=true,m=>m.base='HEAD']){
  const m=JSON.parse(read(MARKET_NEWS_MANIFEST));mutate(m);
  assert.throws(()=>marketNewsTransition(p=>p===MARKET_NEWS_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));
 }
 assert.throws(()=>marketNewsTransition(p=>p==='docs/operations/evidence/owner-backend-simple-mode-transition.json'?Buffer.from('{}'):read(p)),/immutable Owner Backend/);
});
