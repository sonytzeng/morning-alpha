/** Subscriber projection only: publication, stock evidence and entitlement are
 * separate contracts. This module neither evaluates evidence nor grants access. */
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const RECOMMENDATION_EVIDENCE_INSUFFICIENT = '推薦評估證據不足，今日暫不發布正式個股推薦';

export function hasCompleteUniverseAssessment(value: unknown): boolean {
  const screening = record(value);
  return screening.status === 'COMPLETE'
    && typeof screening.universe_count === 'number' && Number.isInteger(screening.universe_count) && screening.universe_count > 0
    && typeof screening.evaluated_count === 'number' && screening.evaluated_count === screening.universe_count
    && Array.isArray(screening.rejected) && screening.rejected.length === 0;
}

export function isMarketPublicationReady(value: unknown): boolean {
  const ai = record(value), gate = record(ai.market_report_gate);
  // Evidence eligibility is not proof that a candidate was atomically published.
  // Retain its current date, but never present PARTIAL/internal QA as READY.
  const publication = record(ai.content_publish_gate), canonical = record(ai.canonical_decision);
  if (ai.content_publish_gate !== undefined && publication.overall_status !== 'eligible') return false;
  if (ai.canonical_decision !== undefined && canonical.status !== 'READY') return false;
  return gate.eligible === true && (gate.report_status === 'READY' || ai.report_status === 'READY');
}

export function recommendationPublication(value: unknown): { explicit: boolean; stocksAllowed: boolean; notice: string | null } {
  const ai = record(value), gate = record(ai.recommendation_gate || record(ai.market_report_gate).recommendation_gate);
  const status = text(ai.recommendation_status || gate.status).toUpperCase();
  if (!status && Object.keys(gate).length === 0) return { explicit: false, stocksAllowed: false, notice: null };
  if (status === 'QUALIFIED' && gate.eligible === true) return { explicit: true, stocksAllowed: true, notice: null };
  const screening = gate.screening || record(ai.decision_engine_v1).screening;
  if (status === 'NO_QUALIFIED_OPPORTUNITY' && gate.universe_evaluation_complete === true && hasCompleteUniverseAssessment(screening)) {
    return { explicit: true, stocksAllowed: false, notice: '今天沒有符合標準的新增機會' };
  }
  return { explicit: true, stocksAllowed: false, notice: RECOMMENDATION_EVIDENCE_INSUFFICIENT };
}

/** The server envelope selects the revision. Reject mixed envelopes rather than
 * silently showing an older nested holiday report under today's date. */
export function resolveSubscriberPayloadIdentity(value: unknown): {
  reportDate: string; revisionId: string | null; generatedAt: string | null; todayDate: string | null;
} | null {
  const response = record(value), payload = record(response.payload);
  const reportDate = text(response.report_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || Object.keys(payload).length === 0) return null;
  const revisionId = text(response.revision_id) || text(payload.revision_id) || null;
  const generatedAt = text(response.generated_at) || text(payload.generated_at) || null;
  if (text(payload.report_date) && payload.report_date !== reportDate) return null;
  if (text(response.revision_id) && text(payload.revision_id) && response.revision_id !== payload.revision_id) return null;
  if (text(response.generated_at) && text(payload.generated_at) && response.generated_at !== payload.generated_at) return null;
  const todayDate = text(response.today_date);
  return { reportDate, revisionId, generatedAt, todayDate: /^\d{4}-\d{2}-\d{2}$/.test(todayDate) ? todayDate : null };
}
