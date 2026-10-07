import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {streamTransition,STREAM_BASE,STREAM_PATHS,STREAM_MANIFEST} from './helpers/recommendationStreamIntegrity.mjs';
import {CLOSE_BASE,readClosePredecessor} from './helpers/recommendationCompletedCloseIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('stream transport exact scope, hashes, predecessor and unchanged business/security contracts',()=>{
 const {manifest}=streamTransition();
 const changed=execFileSync('git',['diff','--name-only',STREAM_BASE,CLOSE_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const untracked=[];
 assert.deepEqual([...new Set([...changed,...untracked])].sort(),[...STREAM_PATHS,STREAM_MANIFEST].sort());
 for(const row of manifest.files)assert.throws(()=>streamTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 for(const p of ['supabase/config.toml','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/recommendation-stock-evidence-smoke-v1/auth.ts','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/_shared/recommendation-phase.ts','supabase/functions/_shared/recommendation-stock-evidence.ts','supabase/functions/generate-daily-report-v7/index.ts','research/recommendation-v2-shadow.ts','docs/10k-program/recommendation-gateway-transition.json'])assert.deepEqual(readClosePredecessor(p),execFileSync('git',['show',STREAM_BASE+':'+p]));
});
