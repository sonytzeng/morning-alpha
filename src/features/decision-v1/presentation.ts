import type { Decision } from './contract.ts';
import { ACTION_LABEL, emptyDecision, object } from './engine.ts';

export type ReportIdentity = { report_date: string; revision_id: string | null; generated_at: string | null };
const textList = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
function isServerDecision(value: unknown): value is Decision {
  const d = object(value);
  if (d.schema_version !== 'decision-evidence-v1' || d.calibration_status !== 'INSUFFICIENT_HISTORY'
    || d.direction_probability !== null || typeof d.action !== 'string' || !(d.action in ACTION_LABEL)
    || typeof d.reason_summary !== 'string' || !textList(d.issues) || !textList(d.primary_catalysts) || !textList(d.sector_impacts)
    || !['unavailable', 'valid_at_assessment'].includes(String(d.data_freshness)) || !['complete', 'insufficient'].includes(String(d.evidence_quality))
    || ![null, 'BULLISH', 'BEARISH', 'RANGE'].includes(d.market_direction as string | null)
    || ![null, 'TREND', 'RANGE', 'RISK_OFF', 'HIGH_VOLATILITY'].includes(d.market_regime as string | null)
    || !Array.isArray(d.evidence) || !Array.isArray(d.confidence_evidence) || !Array.isArray(d.stock_opportunities)) return false;
  const refs = new Set<string>();
  for (const value of d.evidence) {
    const e = object(value);
    if (typeof e.id !== 'string' || refs.has(e.id) || typeof e.summary !== 'string' || typeof e.source !== 'string'
      || !['market', 'event', 'fundamental', 'calibration'].includes(String(e.kind))
      || e.report_date !== d.report_date || e.revision_id !== d.revision_id || typeof e.observed_at !== 'string'
      || !Number.isFinite(Date.parse(e.observed_at)) || Date.parse(e.observed_at) > Date.parse(String(d.generated_at))) return false;
    refs.add(e.id);
  }
  const validScore = (v: unknown): boolean => {
    if (v === null) return true;
    const s = object(v);
    return typeof s.value === 'number' && Number.isFinite(s.value) && s.value >= 0 && s.value <= 100
      && s.meaning === 'quality_index' && s.score_version === 'ma-decision-v1.0' && typeof s.calculation === 'string' && !!s.calculation
      && textList(s.evidence_ids) && s.evidence_ids.length > 0 && s.evidence_ids.every(id => refs.has(id))
      && Object.keys(object(s.inputs)).length > 0 && Object.values(object(s.inputs)).every(n => typeof n === 'number' && Number.isFinite(n));
  };
  if (![d.model_confidence, d.entry_environment_score, d.market_risk_score, d.direction_evidence_score ?? null].every(validScore)) return false;
  if (!d.confidence_evidence.every(e => refs.has(String(object(e).id)))) return false;
  for (const v of d.stock_opportunities) {
    const o = object(v), t = object(o.transmission);
    if (typeof o.symbol !== 'string' || !/^\d{4,6}$/.test(o.symbol) || typeof o.company_name !== 'string' || typeof o.thesis !== 'string'
      || typeof o.action !== 'string' || !(o.action in ACTION_LABEL) || o.data_quality !== 'complete'
      || !textList(o.invalidation_conditions) || !o.invalidation_conditions.length || !Array.isArray(o.evidence) || !o.evidence.every(e => refs.has(String(object(e).id)))
      || !['MISPRICING_CANDIDATE', 'FUNDAMENTAL_DAMAGE', 'CATALYST_WATCH'].includes(String(o.classification))
      || ['catalyst', 'cause', 'market_impact', 'sector', 'company_exposure', 'fundamental_explanation', 'price_reaction', 'priced_in', 'risk_reward'].some(k => typeof t[k] !== 'string')
      || !['POSITIVE', 'INTACT', 'DAMAGED'].includes(String(t.fundamental_impact)) || !textList(t.evidence_ids) || !t.evidence_ids.every(id => refs.has(id))
      || !o.opportunity_score || ![o.opportunity_score, o.catalyst_score, o.priced_in_score, o.risk_score, o.mispricing_score].every(validScore)) return false;
  }
  return true;
}
/** Read only the server-resolved revision. A nested model cannot select its own identity. */
export function decisionFromReport(ai: unknown, identity: ReportIdentity, today: string): Decision {
  const input = object(object(ai).decision_engine_v1);
  if (!identity.revision_id || input.report_date !== identity.report_date || input.revision_id !== identity.revision_id
    || input.generated_at !== identity.generated_at || identity.report_date !== today || typeof input.generated_at !== 'string'
    || !Number.isFinite(Date.parse(input.generated_at)) || typeof input.data_as_of !== 'string' || !Number.isFinite(Date.parse(input.data_as_of))
    || Date.parse(input.data_as_of) > Date.parse(input.generated_at) || !isServerDecision(input)) return emptyDecision();
  return input;
}
export function opportunitySummary(decision: Decision, legacyQualifiedCount: number, stocksWithheld = false): string {
  if (decision.action === 'NOT_APPLICABLE') return '今日休市，不建立新的交易機會';
  if (decision.action === 'NO_QUALIFIED_OPPORTUNITY') return ACTION_LABEL.NO_QUALIFIED_OPPORTUNITY;
  const count = decision.stock_opportunities.filter((o) => !['AVOID', 'DO_NOT_CHASE'].includes(o.action)).length;
  if (decision.action === 'DO_NOT_CHASE') return '目前以不追價為優先；不是新增進場訊號';
  if (decision.action === 'AVOID' || decision.action === 'DEFENSIVE') return '先處理風險，不新增進場訊號';
  if (stocksWithheld && decision.action !== 'INSUFFICIENT_DATA') return '個股內容尚未開放；不代表今天沒有合格機會';
  if (decision.action !== 'INSUFFICIENT_DATA' && count) return `${count} 檔有證據的觀察候選；不是買進指令`;
  if (legacyQualifiedCount) return `${legacyQualifiedCount} 檔已發布觀察；新進場評估尚未完成`;
  return '機會評估尚未完成；不代表今天沒有機會';
}
/** The new read model never overrides the server-published canonical decision or paid gate. */
export function applyPublishedDecisionGate(decision: Decision, canonicalAction: string, premiumEligible: boolean): Decision {
  if (decision.action === 'INSUFFICIENT_DATA' || decision.action === 'NOT_APPLICABLE') return decision;
  let action = decision.action;
  if (canonicalAction === 'STOP') action = 'DEFENSIVE';
  else if (canonicalAction !== 'ACT' && action === 'ACTIVE_WATCH') action = 'WAIT_FOR_CONFIRMATION';
  const actionable = canonicalAction === 'ACT' && premiumEligible;
  const reason = canonicalAction === 'STOP' ? '已發布的決策仍為停止進場；新評估不能覆蓋原有風險限制。'
    : canonicalAction !== 'ACT' && decision.action === 'ACTIVE_WATCH' ? '已發布的決策尚未允許進場，先等待正式驗證。' : decision.reason_summary;
  return { ...decision, action, reason_summary: reason, stock_opportunities: actionable ? decision.stock_opportunities : [] };
}
export function intradayAnswer(input: { status: string; runtimeFailure: boolean; confirmedEvidence: boolean; closing: string }) {
  if (input.runtimeFailure || input.closing === 'miss') return { title: '早上的判斷已改變，先控風險', action: '停止沿用原判斷', tone: 'red' as const };
  if (input.closing === 'partial') return { title: '早上的判斷只有部分成立', action: '保留成立部分，其餘等待確認', tone: 'amber' as const };
  if ((input.status === 'confirmed' && input.confirmedEvidence) || input.closing === 'hit') return { title: '目前證據仍支持早上的判斷', action: '維持觀察，不代表現在適合追價', tone: 'green' as const };
  return { title: '尚無足夠新證據改變早上的判斷', action: '先維持觀察，等待新的驗證', tone: 'amber' as const };
}
