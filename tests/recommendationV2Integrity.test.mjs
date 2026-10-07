import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {v2Transition,V2_BASE,V2_PATHS,V2_MANIFEST} from './helpers/recommendationV2Integrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('V2 exact named set, hashes and historical lineage; formal strategy/security unchanged',()=>{
 const {manifest}=v2Transition();
 const changed=execFileSync('git',['diff','--name-only',V2_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual([...new Set([...changed,...untracked])].sort(),[...V2_PATHS,V2_MANIFEST].sort());
 for(const row of manifest.files)assert.throws(()=>v2Transition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 for(const p of ['supabase/config.toml','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/recommendation-stock-evidence-smoke-v1/auth.ts','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/_shared/recommendation-producer.ts','supabase/functions/_shared/recommendation-phase.ts','supabase/functions/_shared/recommendation-stock-evidence.ts','docs/10k-program/recommendation-completed-close-transition.json'])assert.deepEqual(read(p),execFileSync('git',['show',V2_BASE+':'+p]));
 const sql=read('supabase/migrations/20261007092045_recommendation_v2_owner_shadow.sql').toString();
 assert.doesNotMatch(sql,/create or replace|alter (?:role|policy)|cron\.|vault\.|update public\.|delete from public\./i);
 assert(!manifest.files.some(r=>r.path.includes('line-daily-push')));
});
