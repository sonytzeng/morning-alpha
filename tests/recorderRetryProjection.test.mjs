import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {RETRY_CHECKPOINTS,recorderReplayIdentity,RECORDER_PROJECTION_VERSION} from './helpers/recorderRetryReplayContract.mjs';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const path='supabase/migrations/20260930080719_recorder_retry_projection_parity_v1.sql';
test('one forward-only recorder migration preserves exact business and predecessor scope',()=>{
 const sql=read(path).toString();
 for(const checkpoint of RETRY_CHECKPOINTS)assert(sql.includes("'"+checkpoint+"'"));
 assert.equal(RETRY_CHECKPOINTS.length,13);assert.equal(new Set(RETRY_CHECKPOINTS).size,13);
 assert(!sql.includes("'premarket_readiness_retry_0840'"));
 assert.match(sql,/RECORDER_RETRY_PROJECTION_PREDECESSOR_MISMATCH/);
 assert.match(sql,/FINAL_DEADLINE_ATTEMPT/);assert.match(sql,/if v_origin='REPLAY' then return null/);
 assert.match(sql,/on conflict \(\(capsule->>'source_event_id'\)\)/);
 assert.doesNotMatch(sql,/create or replace function public\.(?:advance_trading|commit_market|invoke_premarket|capture_morning|validate_core)/i);
 assert.doesNotMatch(sql,/\b(?:grant|revoke|cron\.schedule|disable trigger|disable row level security)\s/ig);
 assert.doesNotMatch(sql,/\b(?:insert into|update|delete from) public\.(?:reports|line_delivery_outbox|market_checkpoint|production_acceptance)/i);
});
test('Replay keeps source identity separate, old capsules are not fabricated or rewritten',()=>{
 const source=randomUUID(),run=randomUUID();
 const row={id:randomUUID(),capsule:{capture_origin:'PRODUCTION_CAPTURE',recorder_projection_version:RECORDER_PROJECTION_VERSION,
  source_correlation_id:source,args:{p_correlation_id:source},database_inputs:{recorder_projection_version:RECORDER_PROJECTION_VERSION}}};
 const before=JSON.stringify(row),result=recorderReplayIdentity(row,run);
 assert.equal(result.capture_origin,'REPLAY');assert.equal(result.source_correlation_id,source);
 assert.equal(result.replay_correlation_id,source);assert.equal(result.replay_execution_id,run);
 assert.equal(JSON.stringify(row),before);assert.throws(()=>recorderReplayIdentity(row,source),/MUST_BE_SEPARATE/);
 const old=structuredClone(row);delete old.capsule.database_inputs.recorder_projection_version;
 const oldBefore=JSON.stringify(old);assert.equal(recorderReplayIdentity(old,run).replay_status,'LEGACY_RECORDER_PROJECTION_INCOMPLETE');
 assert.equal(JSON.stringify(old),oldBefore);
 const publication={...row,stage:'PUBLICATION',capsule:{...row.capsule,args:{},source_correlation_id:null,database_inputs:{tables:{}}}};
 assert.equal(recorderReplayIdentity(publication,run).replay_status,'READY','args-only Publication contract does not consume Lifecycle projection');
 const bad=structuredClone(row);bad.capsule.source_correlation_id=randomUUID();assert.throws(()=>recorderReplayIdentity(bad,run),/IDENTITY_INVALID/);
});
test('reviewed Recorder successor pins exact files and keeps all six-bug predecessor hashes',()=>{
 const registry=JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json'));
 const verify=(source=read)=>resolveRuntimeSparseRecoveryIntegrity(registry,read(PUBLIC_EXPORT_ARTIFACT_PATH),source);
 const result=verify(),manifest=result.recorderRetryCandidateIntegrity.reviewedBaselineTransition;
 assert.equal(manifest.candidate_base_git_sha,'f9613b3732a00cd8a229c45a1ac683bb0ecb8b09');
 assert.deepEqual(manifest.files.filter(f=>f.path.startsWith('supabase/migrations/')).map(f=>f.path),[path]);
 assert.equal(manifest.files.filter(f=>f.path.startsWith('supabase/functions/')).length,0);
 assert.equal(result.sixBugCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_SIX_BUG_PREVENTIVE_CLOSURE_20260930');
 for(const row of manifest.files)assert.throws(()=>verify(p=>p===row.path?Buffer.concat([read(p),Buffer.from('\nUNREVIEWED_DRIFT')]):read(p)),/unreviewed candidate drift/);
});
