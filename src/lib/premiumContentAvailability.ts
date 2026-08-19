export interface PremiumContentAvailability {
  status: 'eligible' | 'degraded' | 'blocked';
  eligible: boolean;
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

  if (explicitStatus === 'eligible') {
    return { status: 'eligible', eligible: true, reasonCodes, memberValueScore, freshNewsCount };
  }
  if (explicitStatus === 'blocked' || explicitStatus === 'degraded') {
    return {
      status: explicitStatus,
      eligible: false,
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
    && dataQuality === 'sufficient'
    && freshNewsCount > 0;

  return {
    status: strictEligible ? 'eligible' : gateStatus.includes('降級') ? 'degraded' : 'blocked',
    eligible: strictEligible,
    reasonCodes,
    memberValueScore,
    freshNewsCount,
  };
}
