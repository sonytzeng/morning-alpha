import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {LINE_CARD_BASE,lineCardTransition} from './helpers/lineDecisionIntegrity.mjs';
import {V2_FORWARD_PATHS,V2_FORWARD_MANIFEST,v2ForwardTransition,forwardChangedPaths,forwardPrior} from './helpers/recommendationV2ForwardIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const changedManifest=change=>{const m=JSON.parse(read(V2_FORWARD_MANIFEST));change(m);return p=>p===V2_FORWARD_MANIFEST?Buffer.from(JSON.stringify(m)):read(p);};
test('Forward candidate enforces exact file set, predecessor hashes and frozen methodology',()=>{
 const transition=v2ForwardTransition();
 lineCardTransition(); // Validate every exact successor byte before restoring history.
 const forwardPaths=execFileSync('git',['diff','--name-only','-z','10208c0817718d29f9f86284c32cff5c3ffb39e6',LINE_CARD_BASE],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
 assert.deepEqual(forwardPaths,[...V2_FORWARD_PATHS,V2_FORWARD_MANIFEST].sort());
 assert(forwardChangedPaths().length>=forwardPaths.length);
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
  assert.deepEqual(lineCardTransition().predecessorRead(path),forwardPrior(path),path);
 for(const change of [m=>m.functions.push('unreviewed-function'),m=>m.migrations.push('unreviewed.sql')])assert.throws(()=>v2ForwardTransition(changedManifest(change)));
});
