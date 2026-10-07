import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {recommendationTransition,RECOMMENDATION_BASE,RECOMMENDATION_PATHS,RECOMMENDATION_MANIFEST} from './helpers/recommendationPhaseIntegrity.mjs';
import {STOCK_ACQUISITION_BASE} from './helpers/stockAcquisitionIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('exact Recommendation successor files and hashes preserve predecessor bytes, no hidden candidate scope',()=>{
 const {manifest}=recommendationTransition();assert.equal(manifest.files.length,RECOMMENDATION_PATHS.length);
 const changed=execFileSync('git',['diff','--name-only',RECOMMENDATION_BASE,STOCK_ACQUISITION_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual(changed.sort(),[...RECOMMENDATION_PATHS,RECOMMENDATION_MANIFEST].sort());
 for(const row of manifest.files)assert.throws(()=>recommendationTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 const bad=structuredClone(manifest);bad.files.push({...manifest.files[0],path:'supabase/functions/unapproved/index.ts'});
 assert.throws(()=>recommendationTransition(p=>p===RECOMMENDATION_MANIFEST?Buffer.from(JSON.stringify(bad)):read(p)),/only the named/);
 assert.deepEqual(manifest.files.filter(r=>r.path.startsWith('supabase/migrations/')).map(r=>r.path),['supabase/migrations/20261006235430_recommendation_phase_contract_v1.sql']);
});
