import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {workerTransition,WORKER_BASE,WORKER_PATHS,WORKER_MANIFEST} from './helpers/recommendationWorkerIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Worker exact scope/hashes and PR201 lineage; only dedicated auth, no new business permission',()=>{
 const {manifest}=workerTransition();
 const changed=execFileSync('git',['diff','--name-only',WORKER_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual([...new Set([...changed,...untracked])].sort(),[...WORKER_PATHS,WORKER_MANIFEST].sort());
 for(const row of manifest.files)assert.throws(()=>workerTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 const bad=structuredClone(manifest);bad.files.push({...manifest.files[0],path:'supabase/functions/unapproved/index.ts'});
 assert.throws(()=>workerTransition(p=>p===WORKER_MANIFEST?Buffer.from(JSON.stringify(bad)):read(p)),/only the named/);
 for(const path of ['supabase/config.toml','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/_shared/recommendation-phase.ts','supabase/functions/_shared/recommendation-producer.ts','supabase/functions/generate-daily-report-v7/index.ts','research/recommendation-v2-shadow.ts','docs/10k-program/recommendation-hard-gate-transition.json'])assert.deepEqual(read(path),execFileSync('git',['show',WORKER_BASE+':'+path]));
});
