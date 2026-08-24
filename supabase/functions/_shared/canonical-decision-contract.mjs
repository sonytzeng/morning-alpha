const DECISION_ACTION_BY_MODE = Object.freeze({
  recommendations: 'SELECTIVE',
  no_trade: 'WAIT',
  blocked: 'STOP',
});

export function canonicalDecisionAction(decisionMode) {
  return DECISION_ACTION_BY_MODE[String(decisionMode || '').trim().toLowerCase()] || 'STOP';
}

export const CANONICAL_DECISION_ACTIONS = Object.freeze([
  'TRADE',
  'SELECTIVE',
  'WAIT',
  'REDUCE',
  'STOP',
  'CLOSED',
]);
