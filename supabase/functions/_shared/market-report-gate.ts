import { evaluateContentIntelligence, evaluateMarketContentIntelligence, hasDecisionGradeSourceCoverage } from './content-intelligence.ts';
import { evaluateResearchQualityGate } from './research-quality-gate.ts';
import { companyEvidenceSupported, presentNumber } from './research-pipeline-contract.ts';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const records = (value: unknown): JsonRecord[] => Array.isArray(value) ? value.map(record) : [];
const symbol = (value: unknown): string => typeof value === 'string' ? value.toUpperCase().replace(/^(TWSE:|TPEX:)/, '').replace(/\.(TW|TWO)$/, '') : '';
export const RECOMMENDATION_EVIDENCE_INSUFFICIENT_MESSAGE = '推薦評估證據不足，今日暫不發布正式個股推薦';

/** No rows is not a completed universe assessment. Admission and full-universe
 * exclusion are distinct proofs; a model-authored empty list proves neither. */
export function evaluateStockRecommendationGate(value: unknown) {
  const ai = record(value), master = record(ai.research_master_v2);
  const rows = records(ai.today_beneficiary_stocks_v10);
  const canonicalStocks = records(record(master.sections).representative_stocks);
  const evidence = records(record(ai.v10_analysis_debug).evidence_index);
  const news = records(ai.important_news);
  const generatedAt = Date.parse(String(record(master.provenance).generated_at || ai.generated_at || ''));
  const reasons: string[] = [];
  for (const row of rows) {
    const code = symbol(row.symbol || row.stock_code || row.stock_id);
    const company = { symbol: code, name: row.name || row.stock_name,
      aliases: code === '2330' ? ['TSMC', 'Taiwan Semiconductor'] : code === '2317' ? ['Hon Hai', 'Foxconn'] : [] };
    const admission = record(row.research_evidence_admission);
    const admittedIds = admission.contract_version === 'COMPANY_EVIDENCE_ADMISSION_V1'
      && admission.status === 'PASSED' && admission.report_date === master.report_date
      && Array.isArray(admission.company_evidence_ids) ? admission.company_evidence_ids : [];
    const sourceRows = evidence.filter(item => admittedIds.includes(item.evidence_id));
    const hasCompanySource = [...sourceRows, ...news.map((item): JsonRecord => ({ ...item, evidence_type: 'market_news' }))].some(item => {
      const at = Date.parse(String(item.published_at || item.data_as_of || ''));
      return Number.isFinite(at) && Number.isFinite(generatedAt) && at <= generatedAt
        && generatedAt - at <= 48 * 60 * 60 * 1000
        && !/^(stale|expired|invalid|conflicting)$/i.test(String(item.freshness || ''))
        && companyEvidenceSupported(company, item);
    });
    if (!code || !hasCompanySource) reasons.push(`company_recommendation_evidence_missing:${code || 'unknown'}`);
    if (!canonicalStocks.some(stock => symbol(stock.symbol) === code && Array.isArray(stock.evidence_refs) && stock.evidence_refs.length > 0)) {
      reasons.push(`company_recommendation_not_in_audited_research:${code || 'unknown'}`);
    }
  }
  if (rows.length && !evaluateContentIntelligence(ai, news.length).publishable) reasons.push('recommendation_reasoning_incomplete');
  if (rows.length && !evaluateResearchQualityGate(master).eligible) reasons.push('recommendation_research_evidence_not_ready');
  const decision = record(ai.decision_v1), screening = record(decision.screening);
  const universe = presentNumber(screening.universe_count), evaluated = presentNumber(screening.evaluated_count);
  const complete = decision.schema_version === 'decision-evidence-v1'
    && decision.report_date === master.report_date && decision.today_date === master.today_date
    && decision.generated_at === record(master.provenance).generated_at
    && typeof decision.revision_id === 'string' && Boolean(decision.revision_id)
    && screening.status === 'COMPLETE' && universe !== null && Number.isSafeInteger(universe) && universe > 0
    && evaluated === universe && Array.isArray(screening.rejected) && screening.rejected.length === 0
    && decision.evidence_quality === 'complete' && decision.data_freshness === 'valid_at_assessment'
    && Array.isArray(decision.evidence) && decision.evidence.length > 0;
  const noQualified = rows.length === 0 && complete && decision.action === 'NO_QUALIFIED_OPPORTUNITY'
    && Array.isArray(decision.stock_opportunities) && decision.stock_opportunities.length === 0;
  const eligible = rows.length > 0 && reasons.length === 0;
  if (!eligible && !noQualified && !rows.length) reasons.push('recommendation_evaluation_evidence_insufficient');
  const status: 'QUALIFIED' | 'BLOCKED' | 'NO_QUALIFIED_OPPORTUNITY' = eligible ? 'QUALIFIED' : noQualified ? 'NO_QUALIFIED_OPPORTUNITY' : 'BLOCKED';
  return { contract_version: 'STOCK_RECOMMENDATION_GATE_V1', eligible, status,
    reason_codes: [...new Set(reasons)], universe_evaluation_complete: complete,
    screening: complete ? { status: 'COMPLETE', universe_count: universe, evaluated_count: evaluated, rejected: [] } : { status: 'INCOMPLETE', universe_count: universe, evaluated_count: evaluated, rejected: [] },
    subscriber_message: status === 'BLOCKED' ? RECOMMENDATION_EVIDENCE_INSUFFICIENT_MESSAGE : noQualified ? '今天沒有符合標準的標的' : null };
}

/** Public research quality is independent of paid-note depth and entitlement.
 * This does NOT relax the 100% evidence / 0 unsupported / 90 editorial contract.
 * Recommendation admission happens before assembly; rejected rows stay in the
 * private generation audit, never in the published market document. */
export function evaluateMarketReportGate(value: unknown, expectedReportDate?: string) {
  const ai = record(value), master = record(ai.research_master_v2);
  const research = evaluateResearchQualityGate(master);
  const content = evaluateMarketContentIntelligence(ai, Array.isArray(ai.important_news) ? ai.important_news.length : 0);
  const quality = record(ai.content_evidence_quality);
  const rows = Array.isArray(ai.today_beneficiary_stocks_v10) ? ai.today_beneficiary_stocks_v10 : [];
  const recommendationGate = evaluateStockRecommendationGate(ai);
  const noRecommendation = !recommendationGate.eligible;
  const reasons = [...research.reason_codes, ...content.reason_codes];
  const markets = presentNumber(quality.verified_market_count);
  const blank = presentNumber(quality.blank_market_change_count);
  if (!hasDecisionGradeSourceCoverage(ai, rows.length ? 'recommendations' : 'no_trade')
    || markets === null || markets <= 0 || blank !== 0) reasons.push('market_evidence_incomplete');
  if (expectedReportDate && (master.report_date !== expectedReportDate || master.today_date !== expectedReportDate)) reasons.push('report_date_mismatch');
  if (!content.publishable) reasons.push('market_editorial_not_ready');
  const reasonCodes = [...new Set(reasons)];
  const eligible = research.eligible && content.publishable && reasonCodes.length === 0;
  const status: 'READY' | 'READY_MARKET_ONLY' | 'PARTIAL' | 'BLOCKED' = eligible
    ? noRecommendation ? 'READY_MARKET_ONLY' : 'READY'
    : reasons.includes('market_evidence_incomplete') ? 'PARTIAL' : 'BLOCKED';
  const guide = record(record(master.sections).decision_guide);
  return {
    contract_version: 'MARKET_REPORT_GATE_V2', report_date: String(master.report_date || ''), eligible, status,
    report_status: eligible ? 'READY' : status,
    recommendation_status: recommendationGate.status,
    recommendation_gate: recommendationGate,
    // The coordinated canonical/semantic/SQL contract has a distinct
    // market_only branch. Missing stock evidence is never coerced to no_trade.
    decision_mode: eligible ? noRecommendation ? 'market_only' : 'recommendations' : 'blocked',
    reason_codes: reasonCodes, content_score: content.score,
    wait_reason: noRecommendation ? recommendationGate.subscriber_message : null,
    watch_condition: noRecommendation ? String(guide.first_watch || '') : null,
    next_recheck_time: noRecommendation ? String(guide.next_checkpoint_time || '') : null,
  };
}
