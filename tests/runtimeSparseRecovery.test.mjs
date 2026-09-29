import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateAtomicCheckpointEvidenceRows } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fixtureText = read('tests/fixtures/production-parity-v4/runtime-sparse-recovery-20260929.json');
const fixture = JSON.parse(fixtureText);
const sql = read('supabase/migrations/20260929145000_runtime_checkpoint_sparse_recovery_v1.sql');

test('9/29 two real Recorder captures preserve dates, hashes and complete provider contracts', () => {
  assert.equal(createHash('sha256').update(fixtureText).digest('hex'), '713f669627f92d5f3eae6791016e352bb0b72316a87087dbe58c43dd11a510aa');
  assert.equal(fixture.synthetic, false);
  assert.equal(fixture.business_date, '2026-09-29');
  assert.deepEqual(fixture.captures.map(capture => capture.checkpoint), ['1410', '1430']);
  for (const capture of fixture.captures) {
    assert.equal(capture.evidence_ids.length, 11);
    assert.equal(new Set(capture.evidence_ids).size, 11);
    assert.equal(capture.raw_payload_hashes.length, 11);
    assert.equal(capture.rows.length, 11);
    assert.equal(validateAtomicCheckpointEvidenceRows(capture.rows).valid, true);
    assert.equal(capture.rows.find(row => row.provider_key === 'TXF').source_timestamp, '2026-09-29T05:45:00.060Z');
  }
});

test('the sole sparse migration admits no general rank skip, caller-only proof or history rewrite', () => {
  assert.match(sql, /b8499733b0eb7ac12565594aecce9928/);
  assert.match(sql, /RUNTIME_SPARSE_RECOVERY_PREDECESSOR_MISMATCH/);
  assert.match(sql, /p_trading_date = \(clock_timestamp\(\) at time zone 'Asia\/Taipei'\)::date/);
  assert.match(sql, /upper\(prior.value->>'status'\) in \('FAILED','DEGRADED'\)/);
  assert.match(sql, /market_checkpoint_batch_integrity_v1\(p_trading_date,p_checkpoint\)/);
  assert.match(sql, /v_sparse_batch.correlation_id=p_correlation_id/);
  assert.match(sql, /v_sparse_batch.committed_provider_count=11/);
  assert.match(sql, /v_sparse_validation->>'reused'='true'/);
  assert.match(sql, /public.commit_market_checkpoint_batch_v1\(/);
  assert.match(sql, /if not coalesce\(v_sparse_recovery,false\)/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from)\s+public\./i);
  assert.doesNotMatch(sql, /(?:grant|revoke|alter policy|cron\.(?:schedule|unschedule))\s/i);
  assert.match(sql, /v_catalog_before is distinct from/);
});

test('real-recorded inputs do not contain secret or member fields', () => {
  function check(value) {
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      assert.doesNotMatch(key, /authorization|cookie|secret|token|api.?key|password|recipient|email|phone|member|profile/i);
      check(item);
    }
  }
  check(fixture);
  assert.doesNotMatch(fixtureText, /Bearer\s|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
});
