const TERMINAL_TRADING_DAY_STATES = new Set([
  'CLOSING_VERIFIED',
  'LEARNING_COMPLETED',
]);

const TERMINAL_CHECKPOINT_STATUSES = new Set([
  'SUCCEEDED',
  'DEGRADED_TERMINAL',
]);

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalized(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function hasTerminalClosingEvidence({
  tradingDayState,
  closeMarketReview,
  closingDecisionSnapshot,
  learningRun,
} = {}) {
  const state = asRecord(tradingDayState);
  const currentState = normalized(state.current_state);
  if (TERMINAL_TRADING_DAY_STATES.has(currentState)) return true;

  const checkpoints = asRecord(state.checkpoint_status);
  const close1430 = asRecord(checkpoints['1430']);
  if (TERMINAL_CHECKPOINT_STATUSES.has(normalized(close1430.status))) return true;

  const closingSnapshot = asRecord(closingDecisionSnapshot);
  if (normalized(closingSnapshot.status) === 'FINAL') return true;

  if (closeMarketReview && typeof closeMarketReview === 'object') return true;
  if (normalized(asRecord(learningRun).status) === 'SUCCEEDED') return true;

  return false;
}

export function resolveCanonicalRuntimeMarketStatus({
  isTradingDay,
  tradingDayState,
  closeMarketReview,
  closingDecisionSnapshot,
  learningRun,
} = {}) {
  if (isTradingDay !== true) return 'CLOSED';
  return hasTerminalClosingEvidence({
    tradingDayState,
    closeMarketReview,
    closingDecisionSnapshot,
    learningRun,
  })
    ? 'CLOSED'
    : 'OPEN';
}
