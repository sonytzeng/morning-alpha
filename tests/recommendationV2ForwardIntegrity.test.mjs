import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {V2_FORWARD_PATHS,V2_FORWARD_MANIFEST,v2ForwardTransition,forwardChangedPaths,forwardPrior} from './helpers/recommendationV2ForwardIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const changedManifest=change=>{const m=JSON.parse(read(V2_FORWARD_MANIFEST));change(m);return p=>p===V2_FORWARD_MANIFEST?Buffer.from(JSON.stringify(m)):read(p);};
test('Forward candidate enforces exact file set, predecessor hashes and frozen methodology',()=>{
 const transition=v2ForwardTransition();
 assert.deepEqual(forwardChangedPaths(),[...V2_FORWARD_PATHS,V2_FORWARD_MANIFEST].sort());
 for(const row of transition.manifest.files){
  if(row.operation==='ADD')assert.throws(()=>transition.predecessorRead(row.path),{code:'ENOENT'});
  else assert.deepEqual(transition.predecessorRead(row.path),forwardPrior(row.path));
 }
});
test('every Forward byte is sealed; missing, duplicated and unknown files fail closed',()=>{
 for(const row of v2ForwardTransition().manifest.files)
  assert.throws(()=>v2ForwardTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('drift')]):read(p)),/unreviewed candidate drift/);
 for(const change of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.push({...m.files[0],path:'unknown'}),m=>{m.base='unreviewed';},m=>{m.predecessor_sha256='0'.repeat(64);}])
  assert.throws(()=>v2ForwardTransition(changedManifest(change)));
 assert.throws(()=>v2ForwardTransition(p=>{if(p===V2_FORWARD_MANIFEST)throw Object.assign(Error('missing'),{code:'ENOENT'});return read(p);}),{code:'ENOENT'});
});
test('Forward authorization does not silently permit production methodology or security changes',()=>{
 for(const key of ['new_secrets','cron_changes','core_auth_changes','rls_policy_changes','v1_threshold_changes','promotion','member_access','business_backfill'])
  assert.throws(()=>v2ForwardTransition(changedManifest(m=>{m[key]=true;})));
 for(const path of ['supabase/config.toml','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/_shared/recommendation-shadow-v2-engine.ts','supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/line-daily-push/index.ts'])
  assert.deepEqual(read(path),forwardPrior(path),path);
 for(const change of [m=>m.functions.push('unreviewed-function'),m=>m.migrations.push('unreviewed.sql')])assert.throws(()=>v2ForwardTransition(changedManifest(change)));
});
