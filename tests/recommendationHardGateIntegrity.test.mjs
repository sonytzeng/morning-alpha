import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {hardGateTransition,HARD_GATE_BASE,HARD_GATE_PATHS,HARD_GATE_MANIFEST} from './helpers/recommendationHardGateIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Hard Gate exact additive candidate scope, every hash, predecessor lineage; no Production change',()=>{
 const {manifest}=hardGateTransition();
 const changed=execFileSync('git',['diff','--name-only',HARD_GATE_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual([...new Set([...changed,...untracked])].sort(),[...HARD_GATE_PATHS,HARD_GATE_MANIFEST].sort());
 for(const row of manifest.files)assert.throws(()=>hardGateTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 const bad=structuredClone(manifest);bad.files.push({...manifest.files[0],path:'supabase/functions/unapproved/index.ts'});
 assert.throws(()=>hardGateTransition(p=>p===HARD_GATE_MANIFEST?Buffer.from(JSON.stringify(bad)):read(p)),/only the named/);
 for(const path of ['docs/10k-program/stock-acquisition-transition.json','docs/10k-program/recommendation-phase-transition.json','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/recommendation-stock-evidence-v1/index.ts'])assert.deepEqual(read(path),execFileSync('git',['show',HARD_GATE_BASE+':'+path]));
});
