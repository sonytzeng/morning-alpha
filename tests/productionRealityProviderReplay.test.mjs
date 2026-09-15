import assert from 'node:assert/strict';
import test from 'node:test';
import { replayProductionRealityProviderBatch } from './helpers/productionRealityProviderReplay.mjs';
import { CHECKPOINT_PROVIDER_KEYS, validateAtomicCheckpointEvidenceRows } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

test('Production-shaped 07:00 provider replay reaches one complete atomic candidate without claiming a natural day', async () => {
  const replay = await replayProductionRealityProviderBatch();
  assert.equal(replay.source, 'DEIDENTIFIED_PRODUCTION_SHAPES');
  assert.equal(replay.provider_count, 11);
  assert.equal(replay.evidence.length, 11);
  assert.deepEqual(replay.evidence.map(row => row.provider_key), CHECKPOINT_PROVIDER_KEYS);
  assert.equal(validateAtomicCheckpointEvidenceRows(replay.evidence).valid, true);
  assert.equal(replay.historical_success_claim, false);
  assert.equal(replay.natural_day_pass_claimed, false);
  assert.deepEqual(replay.synthetic_adjustments.map(row => row.symbol), ['2330']);
});

test('the captured prior TAIEX contract rejection still produces atomic 0 instead of 10', async () => {
  const replay = await replayProductionRealityProviderBatch();
  const withoutTaiex = replay.evidence.filter(row => row.provider_key !== 'TAIEX');
  assert.equal(withoutTaiex.length, 10);
  assert.deepEqual(validateAtomicCheckpointEvidenceRows(withoutTaiex), {
    valid: false, error: 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY', rowCount: 10,
  });
});
