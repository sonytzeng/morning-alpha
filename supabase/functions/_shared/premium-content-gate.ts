export type PremiumContentStatus = 'eligible' | 'degraded' | 'blocked';

export interface PremiumContentGateResult {
  status: PremiumContentStatus;
  eligible: boolean;
  reason_codes: string[];
  recommendation_count: number;
  complete_recommendation_count: number;
}
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
    : [];
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function recommendationRows(ai: JsonRecord): JsonRecord[] {
  const v10 = asRecords(ai.today_beneficiary_stocks_v10);
  if (v10.length > 0) return v10;
  const today = asRecords(ai.today_beneficiary_stocks);
  if (today.length > 0) return today;
  return asRecords(ai.beneficiary_stocks);
}

function hasSpecificSource(stock: JsonRecord): boolean {
  const basis = firstText(
    stock.data_basis,
    stock.evidence_source,
    stock.source_reference,
    stock.source,
    ...(Array.isArray(stock.evidence_inputs) ? stock.evidence_inputs : []),
    ...(Array.isArray(stock.supporting_evidence) ? stock.supporting_evidence : []),
  );
  if (basis.length < 8) return false;
  return !/市場數據綜合判斷|情境觸發|綜合研判|未提供|unknown/i.test(basis);
}

function hasCompleteRecommendation(stock: JsonRecord): boolean {
  const eventSource = firstText(stock.trigger_event, stock.catalyst, stock.event_source);
  const transmission = firstText(
    stock.transmission_logic,
    stock.reason_chain,
    stock.causal_chain,
    stock.reason,
    stock.why_this_stock,
  );
  const taiwanRelationship = firstText(
    stock.taiwan_supply_chain_link,
    stock.supply_chain_relationship,
    stock.company_relationship,
    stock.why_this_stock,
  );
  const confirmation = firstText(
    stock.intraday_validation,
    stock.validation_signal,
    stock.confirmation_signal,
    stock.watch_point,
  );
  const invalidation = firstText(
    stock.invalidation_condition,
    stock.not_buy_signal,
    stock.risk_note,
    stock.risk,
  );

  return eventSource.length >= 10
    && transmission.length >= 28
    && taiwanRelationship.length >= 12
    && confirmation.length >= 12
    && invalidation.length >= 12
    && hasSpecificSource(stock);
}

export function evaluatePremiumContentGate(
  aiValue: unknown,
  importantNewsCount: number,
): PremiumContentGateResult {
  const ai = asRecord(aiValue);
  const gate = asRecord(ai.content_publish_gate);
  const reasons: string[] = [];
  const overallStatus = firstText(gate.overall_status).toLowerCase();
  const blockingIssues = Array.isArray(gate.blocking_issues)
    ? gate.blocking_issues.map(String).filter(Boolean)
    : [];
  const memberValueScore = Number(ai.member_value_score);
  const dataQualityStatus = firstText(ai.v10_data_quality_status).toLowerCase();
  const rows = recommendationRows(ai);
  const completeRows = rows.filter(hasCompleteRecommendation);

  if (Object.keys(gate).length === 0) reasons.push('content_publish_gate_missing');
  if (!['可公開', 'ready', 'publishable', 'eligible'].some((status) => overallStatus.includes(status))) {
    reasons.push('content_publish_gate_not_ready');
  }
  if (blockingIssues.length > 0) reasons.push('content_publish_gate_blocked');
  if (!Number.isFinite(memberValueScore) || memberValueScore < 90) reasons.push('member_value_below_90');
  if (dataQualityStatus !== 'sufficient') reasons.push('positive_evidence_insufficient');
  if (importantNewsCount < 1) reasons.push('fresh_news_evidence_missing');
  if (rows.length > 0 && completeRows.length !== rows.length) reasons.push('recommendation_reasoning_incomplete');

  const reasonCodes = unique(reasons);
  return {
    status: reasonCodes.length === 0 ? 'eligible' : overallStatus.includes('降級') ? 'degraded' : 'blocked',
    eligible: reasonCodes.length === 0,
    reason_codes: reasonCodes,
    recommendation_count: rows.length,
    complete_recommendation_count: completeRows.length,
  };
}
