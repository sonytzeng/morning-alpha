import assert from 'node:assert/strict';
import test from 'node:test';
import {
  replayProductionRealityProviderBatch,
  validateRealProductionCapture,
} from './helpers/productionRealityProviderReplay.mjs';
import { CHECKPOINT_PROVIDER_KEYS, validateAtomicCheckpointEvidenceRows } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

test('unchanged historical ticker-based replay fails closed under the repaired current adapter', async () => {
  // This helper retains original real responses and its original synthetic
  // ticker phase adjustment. It no longer proves current 11/11 quote readiness.
  await assert.rejects(replayProductionRealityProviderBatch,
    /TAIEX_REALITY_ADAPTER_FAILED:PROVIDER_RESPONSE_CONTRACT_INVALID/);
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

test('synthetic partial Atomic control cannot turn a rejected cash provider into a ten-row commit', () => {
  // Explicit cardinality-only control, not fabricated retained provider data.
  const partial=CHECKPOINT_PROVIDER_KEYS.filter(key=>key!=='TAIEX').map(provider_key=>({provider_key}));
  assert.deepEqual(validateAtomicCheckpointEvidenceRows(partial), {
    valid: false, error: 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY', rowCount: 10,
  });
});
