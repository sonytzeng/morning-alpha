import { buildCanonicalNarrative } from './canonicalNarrative.ts';
import { getSubscriberReportProjection, type SubscriberReportProjection } from './subscriberReportContract.ts';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Display only. Reuse the saved canonical explanation; never derive a market
 * rule, price threshold or observation time from a direction label. */
export function historicalReportEvidencePresentation(value: unknown, projection: SubscriberReportProjection) {
  const source = getSubscriberReportProjection(value, { historical: true });
  const empty = { confirmations: [] as string[], invalidations: [] as string[], steps: [] as ReturnType<typeof buildCanonicalNarrative>['today_script']['steps'] };
  if (!projection.analysisAvailable || !source.analysisAvailable
    || source.identity.reportDate !== projection.identity.reportDate
    || source.identity.revisionId !== projection.identity.revisionId) return empty;
  const row = record(value);
  const ai = { ...record(row.ai_strategy_json), ...row };
  const narrative = buildCanonicalNarrative({ displayState: null, ai, memberResearchNoteV2: record(ai.member_research_note_v2) });
  const steps = narrative.today_script.steps;
  return {
    steps,
    confirmations: [...new Set(steps.map(step => [step.title, step.detail].filter(Boolean).filter((text, index, all) => all.indexOf(text) === index).join('；')).filter(Boolean))],
    invalidations: [...new Set(narrative.failure_triggers.map(item => [item.trigger, item.action].filter(Boolean).join('；')).filter(Boolean))],
  };
}
