import type { Decision } from './contract.ts';
import { ACTION_LABEL, evaluateDecisionV1, object } from './engine.ts';

export type ReportIdentity = { report_date: string; revision_id: string | null; generated_at: string | null };
/** Read only the server-resolved revision. A nested model cannot select its own identity. */
export function decisionFromReport(ai: unknown, identity: ReportIdentity, today: string): Decision {
  const input = object(object(ai).decision_engine_v1);
  if (!identity.revision_id || input.report_date !== identity.report_date || input.revision_id !== identity.revision_id
    || input.generated_at !== identity.generated_at) return evaluateDecisionV1(null, today);
  return evaluateDecisionV1(input, today);
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
