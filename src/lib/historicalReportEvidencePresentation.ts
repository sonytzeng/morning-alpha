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
  const note = record(ai.member_research_note_v2), contract = record(note.canonical_contract);
  // The public reader deliberately supplies a generic validation skeleton.
  // Without the saved contract's identity it is NOT historical evidence.
  const version = record(ai.canonical_decision).version;
  if (contract.report_date !== source.identity.reportDate || contract.snapshot_id !== source.identity.revisionId
    || note.report_date !== undefined && note.report_date !== source.identity.reportDate
    || !Number.isInteger(contract.snapshot_version) || Number(contract.snapshot_version) < 1
    || !Number.isInteger(version) || version !== contract.snapshot_version) return empty;
  const narrative = buildCanonicalNarrative({ displayState: null, ai, memberResearchNoteV2: note });
  const steps = narrative.today_script.steps;
  return {
    steps,
    confirmations: [...new Set(steps.map(step => [step.title, step.detail].filter(Boolean).filter((text, index, all) => all.indexOf(text) === index).join('；')).filter(Boolean))],
    invalidations: [...new Set(narrative.failure_triggers.map(item => [item.trigger, item.action].filter(Boolean).join('；')).filter(Boolean))],
  };
}
