import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {V2_BASE,V2_PATHS,V2_MANIFEST} from './helpers/recommendationV2Integrity.mjs';
import {V2_RUNTIME_BASE,assertV2SealedManifest} from './helpers/recommendationV2RuntimeIntegrity.mjs';
import {withV2HistoricalBatch,checkV2InjectedRowDrift} from './helpers/v2HistoricalBatch.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('V2 exact named set, hashes and historical lineage; formal strategy/security unchanged',()=>{
 let expired,expiredTransition;
 withV2HistoricalBatch(read,view=>{
 expired=view;
 expiredTransition=view.v2Transition();
 const {manifest}=expiredTransition;
 assertV2SealedManifest();
 // PR206 is sealed at its merge commit. Successor working-tree changes are
 // checked separately in recommendationV2RuntimeIntegrity.test.mjs.
 const changed=execFileSync('git',['diff','--name-only',V2_BASE,V2_RUNTIME_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual(changed.sort(),[...V2_PATHS,V2_MANIFEST].sort());
 for(const row of manifest.files){
  const original=read(row.path),mutated=Buffer.concat([original,Buffer.from('DRIFT')]);
  assert.throws(()=>checkV2InjectedRowDrift('shadow',row,p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p),original,mutated),/unreviewed candidate drift/);
 }
 for(const p of ['supabase/config.toml','supabase/functions/_shared/internal-function-auth.mjs','supabase/functions/recommendation-stock-evidence-smoke-v1/auth.ts','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/_shared/recommendation-producer.ts','supabase/functions/_shared/recommendation-phase.ts','supabase/functions/_shared/recommendation-stock-evidence.ts','docs/10k-program/recommendation-completed-close-transition.json'])assert.deepEqual(view.readV2RuntimePredecessor(p),execFileSync('git',['show',V2_BASE+':'+p]));
 const sql=read('supabase/migrations/20261007092045_recommendation_v2_owner_shadow.sql').toString();
 assert.doesNotMatch(sql,/create or replace|alter (?:role|policy)|cron\.|vault\.|update public\.|delete from public\./i);
 assert(!manifest.files.some(r=>r.path.includes('line-daily-push')));
 });
 assert.throws(()=>expired.readForward(V2_MANIFEST),/V2_BATCH_CLOSED/);
 assert.throws(()=>expired.v2Transition(),/V2_BATCH_CLOSED/);
 assert.throws(()=>expiredTransition.predecessorRead(V2_PATHS[0]),/V2_BATCH_CLOSED/);
});

test('synthetic V2 adapter controls: asynchronous consumers and altered mutation descriptions fail closed',()=>{
 let invoked=false;
 assert.throws(()=>withV2HistoricalBatch(read,async()=>{invoked=true;}),/V2_BATCH_SYNC_ONLY/);
 assert.equal(invoked,false);
 const row={path:V2_PATHS[0]},original=Buffer.from('SYNTHETIC_ONLY');
 assert.throws(()=>checkV2InjectedRowDrift('shadow',row,read,original,Buffer.from('OTHER_BYTES')),/V2_BATCH_MUTATED_BYTES/);
 assert.throws(()=>checkV2InjectedRowDrift('shadow',{path:'../outside'},read,original,Buffer.concat([original,Buffer.from('DRIFT')])),/V2_BATCH_DRIFT_PATH/);
});
