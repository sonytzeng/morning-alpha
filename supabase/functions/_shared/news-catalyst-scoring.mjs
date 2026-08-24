const SYSTEMIC_CATALYST_PATTERN = /(?:\boil\b|crude|wti|brent|opec|iran|sanction|tariff|export control|trade war|federal reserve|\bfed\b|fomc|interest rate|rate (?:cut|hike)|treasury yield|bond yield|\bdxy\b|us dollar|market (?:crash|rally|selloff)|geopolit|conflict|war)/i;

export function applySystemicCatalystFloors(input) {
  const relevanceScore = Number(input?.relevanceScore) || 0;
  const taiwanRelevanceScore = Number(input?.taiwanRelevanceScore) || 0;
  const impactScore = Number(input?.impactScore) || 0;
  const eligible = input?.hasMappedTransmission === true &&
    input?.hasImpactEvidence === true &&
    String(input?.category || '') !== 'Other' &&
    SYSTEMIC_CATALYST_PATTERN.test(String(input?.text || ''));

  if (!eligible) {
    return { relevanceScore, taiwanRelevanceScore, impactScore, applied: false };
  }

  return {
    relevanceScore: Math.max(60, relevanceScore),
    taiwanRelevanceScore: Math.max(60, taiwanRelevanceScore),
    impactScore: Math.max(60, impactScore),
    applied: true,
  };
}
