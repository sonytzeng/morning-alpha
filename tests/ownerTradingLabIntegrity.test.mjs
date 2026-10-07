import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolveRuntimeSparseRecoveryIntegrity,PUBLIC_EXPORT_ARTIFACT_PATH} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Owner Lab exact successor preserves all predecessor seals and 142 Core hashes',()=>{
 const path='docs/10k-program/owner-trading-lab-transition.json',m=JSON.parse(read(path));
 const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
 const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
 assert.equal(verify().ownerTradingLabCandidateIntegrity.reviewedBaselineTransition.core_change,false);
 assert.deepEqual(m.files.filter(r=>r.path.startsWith('supabase/migrations')).map(r=>r.path),['supabase/migrations/20261006082157_owner_trading_lab_v1.sql']);
 assert.deepEqual(m.files.filter(r=>/^supabase\/functions\/[^_][^/]+\/index/.test(r.path)).map(r=>r.path),['supabase/functions/owner-trading-lab-v1/index.ts']);
 for(const row of m.files)assert.throws(()=>verify(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 const bad=structuredClone(m);bad.files.push({...m.files[0],path:'supabase/functions/unapproved/index.ts'});
 assert.throws(()=>verify(p=>p===path?Buffer.from(JSON.stringify(bad)):read(p)),/only the named/);
 for(const [p,h]of Object.entries(JSON.parse(read('docs/10k-program/phase1-core-freeze.json')).protected_files))assert.equal(createHash('sha256').update(readRecommendationPredecessor(p,read)).digest('hex'),h,p);
});
import { readRecommendationPredecessor } from './helpers/recommendationPhaseIntegrity.mjs';
