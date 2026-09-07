import type { Action, Decision } from './contract.ts';

export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const normalizeDecisionSymbol = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase().replace(/^(TWSE:|TPEX:)/, '').replace(/\.(TW|TWO)$/, '') : '';
export function emptyDecision(): Decision {
  return { report_date: '', revision_id: '', generated_at: '', data_as_of: '', market_direction: null, market_regime: null,
    direction_probability: null, model_confidence: null, entry_environment_score: null, market_risk_score: null,
    action: 'INSUFFICIENT_DATA', reason_summary: '目前缺少可核對的評估資料；不能把未完成評估當成沒有機會。',
    evidence: [], confidence_evidence: [], primary_catalysts: [], sector_impacts: [], data_freshness: 'unavailable',
    evidence_quality: 'insufficient', stock_opportunities: [], rejected_opportunity_count: 0, issues: ['SERVER_DECISION_UNAVAILABLE'] };
}

export const ACTION_LABEL: Record<Action, string> = {
  ACTIVE_WATCH: '條件已確認，列入觀察', WAIT_FOR_PULLBACK: '等待較合理的進場條件',
  WAIT_FOR_CONFIRMATION: '等待證據確認', HOLD_WATCH: '維持觀察，不新增部位',
  DO_NOT_CHASE: '價格已偏熱，先不追高', DEFENSIVE: '先控風險，暫緩進場', AVOID: '避開已受損的劇本',
  NO_QUALIFIED_OPPORTUNITY: '今天沒有符合標準的新增機會', INSUFFICIENT_DATA: '評估尚未完成，先等待', NOT_APPLICABLE: '今日休市，等待下一個交易日',
};
export function actionTone(action: Action): 'green' | 'amber' | 'red' | 'blue' {
  return action === 'ACTIVE_WATCH' ? 'green' : action === 'AVOID' || action === 'DEFENSIVE' ? 'red' : action === 'NOT_APPLICABLE' ? 'blue' : 'amber';
}
