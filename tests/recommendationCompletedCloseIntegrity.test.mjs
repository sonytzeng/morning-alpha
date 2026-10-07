import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {closeTransition,CLOSE_BASE,CLOSE_PATHS,CLOSE_MANIFEST} from './helpers/recommendationCompletedCloseIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('completed close exact scope, hashes, predecessor and unchanged business/security contracts',()=>{
 const {manifest}=closeTransition();
 const changed=execFileSync('git',['diff','--name-only',CLOSE_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual([...new Set([...changed,...untracked])].sort(),[...CLOSE_PATHS,CLOSE_MANIFEST].sort());
 for(const row of manifest.files)assert.throws(()=>closeTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 for(const p of ['supabase/config.toml','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/recommendation-stock-evidence-smoke-v1/auth.ts','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/generate-daily-report-v7/index.ts','research/recommendation-v2-shadow.ts','docs/10k-program/recommendation-gateway-transition.json'])assert.deepEqual(read(p),execFileSync('git',['show',CLOSE_BASE+':'+p]));
});
