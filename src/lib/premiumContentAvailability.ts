export interface PremiumContentAvailability {
  status: 'eligible' | 'degraded' | 'blocked';
  eligible: boolean;
  decisionMode: 'recommendations' | 'no_trade' | 'blocked';
  reasonCodes: string[];
  memberValueScore: number | null;
  freshNewsCount: number;
}
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function resolvePremiumContentAvailability(value: unknown): PremiumContentAvailability {
  const ai = asRecord(value);
  const explicitStatus = String(ai.premium_content_status ?? '').trim().toLowerCase();
  const explicitDecisionMode = String(ai.premium_decision_mode ?? '').trim().toLowerCase();
  const gate = asRecord(ai.content_publish_gate);
  const gateStatus = String(gate.overall_status ?? '').trim().toLowerCase();
  const reasonCodes = Array.from(new Set([
    ...asStrings(ai.premium_content_reason_codes),
    ...asStrings(gate.blocking_issues),
  ]));
  const score = Number(ai.member_value_score);
  const memberValueScore = Number.isFinite(score) ? score : null;
  const importantNews = Array.isArray(ai.important_news) ? ai.important_news.length : 0;
  const explicitNewsCount = Number(ai.fresh_news_count);
  const freshNewsCount = Number.isFinite(explicitNewsCount) ? explicitNewsCount : importantNews;
  const dataQuality = String(ai.v10_data_quality_status ?? '').trim().toLowerCase();
  const sourceDataQuality = String(ai.data_quality ?? '').trim().toLowerCase();
  const v10Enabled = ai.v10_beneficiary_enabled === true || String(ai.v10_beneficiary_enabled).toLowerCase() === 'true';
  const recommendationCount = v10Enabled
    ? (Array.isArray(ai.today_beneficiary_stocks_v10) ? ai.today_beneficiary_stocks_v10.length : 0)
    : (Array.isArray(ai.today_beneficiary_stocks) ? ai.today_beneficiary_stocks.length : 0);
  const observationCount = Array.isArray(ai.v10_observation_watchlist) ? ai.v10_observation_watchlist.length : 0;
  const inferredDecisionMode = recommendationCount > 0
    ? 'recommendations'
    : dataQuality === 'insufficient_positive_evidence' && observationCount >= 3
      ? 'no_trade'
      : 'blocked';
  const decisionMode = explicitDecisionMode === 'recommendations' || explicitDecisionMode === 'no_trade'
    ? explicitDecisionMode
    : inferredDecisionMode;

  if (explicitStatus === 'eligible') {
    return { status: 'eligible', eligible: true, decisionMode, reasonCodes, memberValueScore, freshNewsCount };
  }
  if (explicitStatus === 'blocked' || explicitStatus === 'degraded') {
    return {
      status: explicitStatus,
      eligible: false,
      decisionMode: 'blocked',
      reasonCodes,
      memberValueScore,
      freshNewsCount,
    };
  }

  const strictEligible = Object.keys(gate).length > 0
    && (gateStatus.includes('可公開') || gateStatus === 'eligible')
    && reasonCodes.length === 0
    && memberValueScore !== null
    && memberValueScore >= 90
    && sourceDataQuality === 'complete'
    && (
      (recommendationCount > 0 && ['sufficient', 'partial'].includes(dataQuality))
      || (recommendationCount === 0 && dataQuality === 'insufficient_positive_evidence' && observationCount >= 3)
    )
    && freshNewsCount > 0;

  return {
    status: strictEligible ? 'eligible' : gateStatus.includes('降級') ? 'degraded' : 'blocked',
    eligible: strictEligible,
    decisionMode: strictEligible ? decisionMode : 'blocked',
    reasonCodes,
    memberValueScore,
    freshNewsCount,
  };
}
