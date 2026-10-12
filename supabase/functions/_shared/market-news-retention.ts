import { reviewPremiumNewsEvidence } from './premium-evidence.ts';

export interface RetainedNewsInput {
  title: string; source: string; url: string; publishedAt: string;
  isBlacklisted: boolean; isSelected: boolean; finalScore: number;
  taiwanImpactSummary: string;
}

function current(item: RetainedNewsInput, nowMs: number): boolean {
  const published = Date.parse(item.publishedAt);
  return Number.isFinite(published) && published <= nowMs && nowMs - published <= 48 * 3_600_000;
}

/** Retention is not admission. Keep the existing scores/thresholds and 80/12
 * bounds, but stale high-scoring rows cannot evict current eligible evidence.
 * No timestamp, score or article content is rewritten.
 */
export function retainMarketNews<T extends RetainedNewsInput>(items: T[], nowMs: number): T[] {
  const ordered = [...items].sort((a, b) => Number(current(b, nowMs)) - Number(current(a, nowMs)) || b.finalScore - a.finalScore);
  let selected = 0;
  return ordered.slice(0, 80).map(item => {
    const admitted = item.isSelected && !item.isBlacklisted && current(item, nowMs) && selected < 12;
    if (admitted) selected++;
    return { ...item, isSelected: admitted };
  });
}

/** Sequential counts with explicit populations. Preflight calls the unchanged
 * Report policy with its EXACT existing field mapping. It is neither an
 * Evidence Index receipt nor Report acceptance. Never returns article text.
 */
export function marketNewsFunnel(items: RetainedNewsInput[], retained: RetainedNewsInput[], nowMs: number) {
  const nonBlacklisted = items.filter(item => !item.isBlacklisted);
  const fresh = nonBlacklisted.filter(item => current(item, nowMs));
  const selected = fresh.filter(item => item.isSelected);
  const canonical = retained.filter(item => item.isSelected);
  const reasons: Record<string, number> = {};
  let relevancePass = 0, qualityPass = 0;
  for (const item of canonical) {
    const review = reviewPremiumNewsEvidence({ title: item.title, source: item.source, url: item.url,
      published_at: item.publishedAt, taiwan_impact_summary: item.taiwanImpactSummary }, nowMs);
    for (const reason of review.reason_codes) reasons[reason] = (reasons[reason] || 0) + 1;
    if (!review.reason_codes.includes('taiwan_market_relevance_unproven') && !review.reason_codes.includes('taiwan_transmission_missing')) relevancePass++;
    if (review.eligible) qualityPass++;
  }
  return {
    schema_version: 'MARKET_NEWS_FUNNEL_V1', observed_at: new Date(nowMs).toISOString(),
    deduplicated: items.length, blacklist_rejected: items.length - nonBlacklisted.length,
    after_blacklist: nonBlacklisted.length, freshness_rejected: nonBlacklisted.length - fresh.length,
    freshness_pass: fresh.length, producer_selected_before_caps: selected.length,
    producer_selection_rejected: fresh.length - selected.length,
    raw_retained: retained.length, retention_omitted: items.length - retained.length,
    selected_cap_or_retention_omitted: selected.length - canonical.length,
    canonical_requested: canonical.length,
    report_preflight: { population: 'CANONICAL_REQUESTED_NOT_REPORT_ACCEPTED',
      relevance_pass: relevancePass, quality_pass: qualityPass,
      quality_rejected: canonical.length - qualityPass, reason_counts: reasons },
    evidence_index: null, report_accepted: null,
  };
}

/** Only admit known non-sensitive telemetry; never propagate provider bodies. */
export function sanitizeMarketNewsFunnel(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.schema_version !== 'MARKET_NEWS_FUNNEL_V1') return null;
  const result: Record<string, unknown> = { schema_version: v.schema_version };
  for (const k of ['raw', 'invalid_record', 'invalid_timestamp', 'duplicates', 'deduplicated', 'blacklist_rejected',
    'after_blacklist', 'freshness_rejected', 'freshness_pass', 'producer_selected_before_caps',
    'producer_selection_rejected', 'raw_retained', 'retention_omitted', 'selected_cap_or_retention_omitted', 'canonical_requested']) {
    result[k] = typeof v[k] === 'number' && Number.isSafeInteger(v[k]) && Number(v[k]) >= 0 ? v[k] : null;
  }
  result.observed_at = typeof v.observed_at === 'string' && Number.isFinite(Date.parse(v.observed_at))
    ? new Date(v.observed_at).toISOString() : null;
  const p = v.report_preflight && typeof v.report_preflight === 'object' && !Array.isArray(v.report_preflight)
    ? v.report_preflight as Record<string, unknown> : {};
  const reasonCounts = p.reason_counts && typeof p.reason_counts === 'object' ? p.reason_counts as Record<string, unknown> : {};
  const reasons: Record<string, number> = {};
  for (const k of ['headline_too_short','source_missing','url_missing_or_invalid','published_at_missing_or_invalid',
    'outside_freshness_window','taiwan_market_relevance_unproven','taiwan_transmission_missing','decision_catalyst_missing','non_catalyst_editorial_headline']) {
    if (typeof reasonCounts[k] === 'number' && Number.isSafeInteger(reasonCounts[k]) && Number(reasonCounts[k]) >= 0) reasons[k] = Number(reasonCounts[k]);
  }
  result.report_preflight = { population: 'CANONICAL_REQUESTED_NOT_REPORT_ACCEPTED', reason_counts: reasons,
    ...Object.fromEntries(['relevance_pass','quality_pass','quality_rejected'].map(k => [k,
      typeof p[k] === 'number' && Number.isSafeInteger(p[k]) && Number(p[k]) >= 0 ? p[k] : null])) };
  result.evidence_index = null; result.report_accepted = null;
  return result;
}
