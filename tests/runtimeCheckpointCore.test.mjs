import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferSnapshotCheckpoint,
  normalizeSnapshotCheckpoint,
  resolveSnapshotCheckpoint,
  stateForSnapshotCheckpoint,
} from '../supabase/functions/_shared/runtime-checkpoint-core.mjs';

test('explicit checkpoints must belong to the requested phase', () => {
  assert.equal(normalizeSnapshotCheckpoint('09:30', 'intraday'), '0930');
  assert.equal(normalizeSnapshotCheckpoint('1410', 'intraday'), null);
  assert.equal(resolveSnapshotCheckpoint({ phase: 'close', checkpoint: '0930', hour: 14, minute: 10 }), null);
});

test('checkpoint inference is deterministic in Asia Taipei operational windows', () => {
  assert.equal(inferSnapshotCheckpoint('intraday', 9, 0), '0900');
  assert.equal(inferSnapshotCheckpoint('intraday', 9, 30), '0930');
  assert.equal(inferSnapshotCheckpoint('intraday', 10, 30), '1030');
  assert.equal(inferSnapshotCheckpoint('intraday', 13, 0), '1300');
  assert.equal(inferSnapshotCheckpoint('close', 14, 10), '1410');
  assert.equal(inferSnapshotCheckpoint('close', 14, 30), '1430');
});

test('every scheduled snapshot maps to a monotonic trading-day state', () => {
  assert.deepEqual(
    ['0900', '0930', '1030', '1300', '1410', '1430'].map(stateForSnapshotCheckpoint),
    [
      'MARKET_OPEN_CAPTURED',
      'CHECKPOINT_0930_CAPTURED',
      'CHECKPOINT_1030_CAPTURED',
      'CHECKPOINT_1300_CAPTURED',
      'CLOSE_1410_CAPTURED',
      'CLOSE_1430_CAPTURED',
    ],
  );
});
