import assert from 'node:assert/strict';
import test from 'node:test';
import {
  replayProductionRealityProviderBatch,
  validateRealProductionCapture,
} from './helpers/productionRealityProviderReplay.mjs';
import { CHECKPOINT_PROVIDER_KEYS, validateAtomicCheckpointEvidenceRows } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

test('real Production 07:00 provider replay reaches one complete atomic candidate without claiming a natural day', async () => {
  const replay = await replayProductionRealityProviderBatch();
  assert.equal(replay.source, 'REAL_PRODUCTION_CAPTURE');
  assert.equal(replay.real_production_capture, true);
  assert.equal(replay.replay_uses_same_adapter_as_production, true);
  assert.equal(replay.replay_uses_same_contract_as_production, true);
  assert.equal(replay.replay_uses_correct_market_phase, true);
  assert.equal(replay.provider_count, 11);
  assert.equal(replay.evidence.length, 11);
  assert.deepEqual(replay.evidence.map(row => row.provider_key), CHECKPOINT_PROVIDER_KEYS);
  assert.equal(validateAtomicCheckpointEvidenceRows(replay.evidence).valid, true);
  assert.equal(replay.historical_success_claim, false);
  assert.equal(replay.natural_day_pass_claimed, false);
  assert.deepEqual(replay.synthetic_adjustments, ['TAIWAN_PHASE_SESSION_CONTRACT_FIXTURE']);
});

test('Production Replay rejects fixtures that are not marked as real Production captures', () => {
  assert.throws(() => validateRealProductionCapture({
    real_production_capture: false,
    business_date: '2026-09-16',
    market_phase: 'premarket',
    capture_time: '2026-09-16T07:00:00+08:00',
    contains_secrets: false,
    lineage: { business_writes: [] },
    responses: {},
  }), /REAL_PRODUCTION_CAPTURE_REQUIRED/);
});

test('the captured prior TAIEX contract rejection still produces atomic 0 instead of 10', async () => {
  const replay = await replayProductionRealityProviderBatch();
  const withoutTaiex = replay.evidence.filter(row => row.provider_key !== 'TAIEX');
  assert.equal(withoutTaiex.length, 10);
  assert.deepEqual(validateAtomicCheckpointEvidenceRows(withoutTaiex), {
    valid: false, error: 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY', rowCount: 10,
  });
});
