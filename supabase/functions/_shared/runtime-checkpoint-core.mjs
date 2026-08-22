export const SNAPSHOT_CHECKPOINTS = Object.freeze([
  'premarket',
  '0900',
  '0930',
  '1030',
  '1300',
  '1410',
  '1430',
  'manual',
]);

const CHECKPOINT_PHASE = Object.freeze({
  premarket: 'premarket',
  '0900': 'intraday',
  '0930': 'intraday',
  '1030': 'intraday',
  '1300': 'intraday',
  '1410': 'close',
  '1430': 'close',
  manual: 'manual_backfill',
});

export function normalizeSnapshotCheckpoint(value, phase) {
  const checkpoint = String(value || '').trim().toLowerCase().replace(':', '');
  return SNAPSHOT_CHECKPOINTS.includes(checkpoint) && CHECKPOINT_PHASE[checkpoint] === phase
    ? checkpoint
    : null;
}

export function inferSnapshotCheckpoint(phase, hour, minute) {
  if (phase === 'premarket') return 'premarket';
  if (phase === 'manual_backfill') return 'manual';
  const minutes = Number(hour) * 60 + Number(minute);
  if (!Number.isFinite(minutes)) return null;
  if (phase === 'intraday') {
    if (minutes < 9 * 60 + 15) return '0900';
    if (minutes < 10 * 60) return '0930';
    if (minutes < 11 * 60 + 45) return '1030';
    return '1300';
  }
  if (phase === 'close') return minutes < 14 * 60 + 25 ? '1410' : '1430';
  return null;
}

export function resolveSnapshotCheckpoint({ phase, checkpoint, hour, minute }) {
  if (checkpoint !== undefined && checkpoint !== null && String(checkpoint).trim()) {
    return normalizeSnapshotCheckpoint(checkpoint, phase);
  }
  return inferSnapshotCheckpoint(phase, hour, minute);
}

export function stateForSnapshotCheckpoint(checkpoint) {
  const states = {
    premarket: 'PREMARKET_CAPTURED',
    '0900': 'MARKET_OPEN_CAPTURED',
    '0930': 'CHECKPOINT_0930_CAPTURED',
    '1030': 'CHECKPOINT_1030_CAPTURED',
    '1300': 'CHECKPOINT_1300_CAPTURED',
    '1410': 'CLOSE_1410_CAPTURED',
    '1430': 'CLOSE_1430_CAPTURED',
    manual: 'MANUAL_CAPTURED',
  };
  return states[checkpoint] || null;
}
