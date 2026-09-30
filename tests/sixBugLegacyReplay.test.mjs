import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replayRecordedProviderEvidence,recordedEvidenceContainsSensitiveData} from '../supabase/functions/_shared/production-evidence-recorder.mjs';
const corpus=JSON.parse(readFileSync(new URL('./fixtures/six-bug-legacy-failures-20260930.json',import.meta.url),'utf8'));
test('all thirteen real V1 failures remain immutable and disclose missing historical replay inputs',async()=>{
 assert.equal(corpus.evidence_type,'REAL_EVIDENCE');assert.equal(corpus.rows.length,13);
 const before=JSON.stringify(corpus);
 for(const row of corpus.rows){
  const result=await replayRecordedProviderEvidence(row);
  assert.equal(result.replay_status,'LEGACY_EVIDENCE_INSUFFICIENT',row.id);
  assert.equal(result.deterministic,false);
  assert.match(result.limitation,/calendar\/taxonomy.*complete adapter response trace/);
  assert.equal(recordedEvidenceContainsSensitiveData(row),false);
 }
 assert.equal(JSON.stringify(corpus),before);
});
