import { evaluateContentIntelligence, hasAuditedCanonicalNoTrade, hasDecisionGradeSourceCoverage } from './content-intelligence.ts';
import { evaluateResearchQualityGate } from './research-quality-gate.ts';
import { presentNumber } from './research-pipeline-contract.ts';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

/** Public research quality is independent of paid-note depth and entitlement.
 * This does NOT relax the 100% evidence / 0 unsupported / 90 editorial contract.
 * Recommendation admission happens before assembly; rejected rows stay in the
 * private generation audit, never in the published market document. */
export function evaluateMarketReportGate(value: unknown, expectedReportDate?: string) {
  const ai = record(value), master = record(ai.research_master_v2);
  const research = evaluateResearchQualityGate(master);
  const content = evaluateContentIntelligence(ai, Array.isArray(ai.important_news) ? ai.important_news.length : 0);
  const quality = record(ai.content_evidence_quality);
  const rows = Array.isArray(ai.today_beneficiary_stocks_v10) ? ai.today_beneficiary_stocks_v10 : [];
  const noRecommendation = rows.length === 0 && hasAuditedCanonicalNoTrade(ai);
  const reasons = [...research.reason_codes, ...content.reason_codes];
  const markets = presentNumber(quality.verified_market_count);
  const blank = presentNumber(quality.blank_market_change_count);
  if (!hasDecisionGradeSourceCoverage(ai, rows.length ? 'recommendations' : 'no_trade')
    || markets === null || markets <= 0 || blank !== 0) reasons.push('market_evidence_incomplete');
  if (expectedReportDate && (master.report_date !== expectedReportDate || master.today_date !== expectedReportDate)) reasons.push('report_date_mismatch');
  if (!rows.length && !noRecommendation) reasons.push('no_recommendation_not_audited');
  if (!content.publishable) reasons.push('market_editorial_not_ready');
  const reasonCodes = [...new Set(reasons)];
  const eligible = research.eligible && content.publishable && reasonCodes.length === 0;
  const status: 'READY' | 'READY_NO_RECOMMENDATION' | 'PARTIAL' | 'BLOCKED' = eligible
    ? noRecommendation ? 'READY_NO_RECOMMENDATION' : 'READY'
    : reasons.includes('market_evidence_incomplete') ? 'PARTIAL' : 'BLOCKED';
  const guide = record(record(master.sections).decision_guide);
  return {
    contract_version: 'MARKET_REPORT_GATE_V1', eligible, status,
    report_status: eligible ? 'READY' : status,
    recommendation_status: eligible ? noRecommendation ? 'NO_RECOMMENDATION' : 'QUALIFIED' : 'NOT_EVALUATED',
    decision_mode: eligible ? noRecommendation ? 'no_trade' : 'recommendations' : 'blocked',
    reason_codes: reasonCodes, content_score: content.score,
    wait_reason: eligible && noRecommendation ? '今日市場報告已通過證據檢查，但沒有個股同時通過公司證據與成立／失效條件門檻；保留市場觀察，不建立推薦。' : null,
    watch_condition: noRecommendation ? String(guide.first_watch || '') : null,
    next_recheck_time: noRecommendation ? String(guide.next_checkpoint_time || '') : null,
  };
}
