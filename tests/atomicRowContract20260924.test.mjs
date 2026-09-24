import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateAtomicCheckpointEvidenceRows } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import { evaluatePremarketTxfSession } from '../supabase/functions/_shared/txf-session-contract.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fixture = JSON.parse(read('tests/fixtures/production-parity-v4/atomic-row-20260924.json'));
const incident = JSON.parse(read('docs/operations/evidence/atomic-row-contract-rejection-20260924.json'));
const migration = read('supabase/migrations/20260924004011_atomic_txf_minute_boundary_parity_v1.sql');

test('9/24 real Recorder evidence rebuilds the exact 11-row Edge Atomic candidate', () => {
  assert.equal(fixture.evidence_type, 'DEIDENTIFIED_PRODUCTION_RECORDER_EVIDENCE');
  assert.equal(fixture.real_production_response, 'YES_SANITIZED_BY_RECORDER_V1');
  assert.equal(fixture.historical_result, 'ATOMIC_0_OF_11_FAIL_UNCHANGED');
  assert.equal(fixture.rows.length, 11);
  assert.equal(fixture.incident_evidence_ids.length, 11);
  assert.equal(new Set(fixture.rows.map(row => row.provider_key)).size, 11);
  assert.equal(validateAtomicCheckpointEvidenceRows(fixture.rows).valid, true);
});

test('exact rejection is TXF 05:00:00.084 and remains stable across all recorded retries', () => {
  assert.equal(incident.provider_contract, '11_OF_11_PASS');
  assert.equal(incident.rejected_provider, 'TXF');
  assert.equal(incident.rejected_field, 'source_timestamp.afterhours_window');
  assert.equal(incident.actual, '2026-09-24 05:00:00.084 Asia/Taipei');
  assert.equal(incident.classification, 'EDGE_DB_CONTRACT_DRIFT');
  assert.equal(incident.txf_recorded_attempt_rows, 27);
  assert.equal(incident.txf_distinct_source_timestamps, 1);
  assert.equal(incident.root_cause_stable_across_retries, true);
  assert.equal(Object.values(incident.provider_matrix).filter(value => value.startsWith('FAIL')).length, 1);
  assert.equal(fixture.rows.find(row => row.provider_key === 'TXF').source_timestamp,
    '2026-09-23T21:00:00.084Z');
});

test('Edge minute contract accepts the real TXF timestamp and rejects the next minute', () => {
  const txf = fixture.rows.find(row => row.provider_key === 'TXF');
  const input = {
    tradingDate: fixture.business_date,
    providerSessionDate: txf.raw.txf_provider_session_date,
    session: txf.raw.txf_session_type,
    sourceTimestamp: txf.source_timestamp,
    observedAt: txf.captured_at,
  };
  assert.equal(evaluatePremarketTxfSession(input).valid, true);
  assert.equal(evaluatePremarketTxfSession({
    ...input, sourceTimestamp: '2026-09-23T21:00:59.999Z',
  }).valid, true);
  assert.deepEqual(evaluatePremarketTxfSession({
    ...input, sourceTimestamp: '2026-09-23T21:01:00.000Z',
  }), {
    valid: false,
    error: 'TXF_SESSION_TYPE_MISMATCH',
    expected_session_date: '2026-09-23',
  });
});

test('database candidate is exact-hash guarded and changes only minute upper boundaries', () => {
  assert.match(migration, /v_baseline constant text := 'e6f6e3804fcfd41b811ea01a575f03e2'/);
  assert.match(migration, /time < time '05:01'/);
  assert.match(migration, /time >= time '08:45'/);
  assert.match(migration, /time < time '13:46'/);
  assert.match(migration, /ATOMIC_TXF_MINUTE_BOUNDARY_BASELINE_MISMATCH/);
  assert.doesNotMatch(migration, /create table|alter table|insert into|update |delete from|grant |revoke |cron\.|schedule\(/i);
});
