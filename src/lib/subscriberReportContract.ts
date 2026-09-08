import { parseSubscriberState, INCOMPLETE_ANALYSIS_MESSAGE, RECOMMENDATION_INSUFFICIENT_MESSAGE, type SubscriberState } from '../../shared/subscriber-state-contract.ts';

/** Subscriber projection only: publication, stock evidence and entitlement are
 * separate contracts. This module neither evaluates evidence nor grants access. */
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const RECOMMENDATION_EVIDENCE_INSUFFICIENT = RECOMMENDATION_INSUFFICIENT_MESSAGE;
export const SUBSCRIBER_ANALYSIS_INCOMPLETE = INCOMPLETE_ANALYSIS_MESSAGE;

/** New payloads are interpreted by the same schema as the producer. An invalid
 * version is an unavailable contract, never permission to use legacy fields. */
export function subscriberState(value: unknown): SubscriberState | null {
  const ai = record(value);
  return parseSubscriberState(ai.subscriber_state, {
    report_date: ai.report_date, revision_id: ai.revision_id, generated_at: ai.generated_at,
  });
}

export function hasSubscriberState(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(record(value), 'subscriber_state');
}

export function isSubscriberAnalysisUnavailable(value: unknown): boolean {
  const ai = record(value);
  if (hasSubscriberState(ai)) {
    const state = subscriberState(ai);
    return !state || state.publication !== 'PUBLISHED' || state.analysis !== 'READY';
  }
  const canonical = record(ai.canonical_decision), publication = record(ai.content_publish_gate);
  // Legacy explicitly-unpublished candidates remain on their real report date.
  // STOP/closing/quality labels cannot turn them into published judgments.
  if (ai.content_publish_gate !== undefined && publication.overall_status !== 'eligible') return true;
  if (ai.canonical_decision !== undefined && canonical.status !== 'READY') return true;
  return typeof ai.report_status === 'string' && ai.report_status !== 'READY';
}

export function subscriberConfidence(value: unknown, legacyValue: unknown): number | null {
  if (isSubscriberAnalysisUnavailable(value)) return null;
  if (hasSubscriberState(value)) {
    const confidence = subscriberState(value)?.confidence;
    return confidence?.status === 'AVAILABLE' ? confidence.value : null;
  }
  if ((typeof legacyValue !== 'number' && typeof legacyValue !== 'string')
    || (typeof legacyValue === 'string' && !legacyValue.trim())) return null;
  const score = typeof legacyValue === 'number' ? legacyValue : Number(legacyValue);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export function hasCompleteUniverseAssessment(value: unknown): boolean {
  const screening = record(value);
  return screening.status === 'COMPLETE'
    && typeof screening.universe_count === 'number' && Number.isInteger(screening.universe_count) && screening.universe_count > 0
    && typeof screening.evaluated_count === 'number' && screening.evaluated_count === screening.universe_count
    && Array.isArray(screening.rejected) && screening.rejected.length === 0;
}

export function isMarketPublicationReady(value: unknown): boolean {
  const ai = record(value), gate = record(ai.market_report_gate);
  if (hasSubscriberState(ai)) return !isSubscriberAnalysisUnavailable(ai);
  // Evidence eligibility is not proof that a candidate was atomically published.
  // Retain its current date, but never present PARTIAL/internal QA as READY.
  const publication = record(ai.content_publish_gate), canonical = record(ai.canonical_decision);
  if (ai.content_publish_gate !== undefined && publication.overall_status !== 'eligible') return false;
  if (ai.canonical_decision !== undefined && canonical.status !== 'READY') return false;
  return gate.eligible === true && (gate.report_status === 'READY' || ai.report_status === 'READY');
}

export function recommendationPublication(value: unknown): { explicit: boolean; stocksAllowed: boolean; notice: string | null } {
  const ai = record(value), gate = record(ai.recommendation_gate || record(ai.market_report_gate).recommendation_gate);
  if (hasSubscriberState(ai)) {
    const state = subscriberState(ai);
    if (isSubscriberAnalysisUnavailable(ai) || !state || state.recommendation === 'BLOCKED') {
      return { explicit: true, stocksAllowed: false, notice: RECOMMENDATION_EVIDENCE_INSUFFICIENT };
    }
    if (state.recommendation === 'QUALIFIED') return { explicit: true, stocksAllowed: true, notice: null };
    // A versioned no-qualified label still requires complete-universe evidence.
    // It must never fall through to a stale QUALIFIED alias and restore stocks.
    const screening = gate.screening || record(ai.decision_engine_v1).screening;
    return { explicit: true, stocksAllowed: false,
      notice: gate.universe_evaluation_complete === true && hasCompleteUniverseAssessment(screening)
        ? '今天沒有符合標準的新增機會' : RECOMMENDATION_EVIDENCE_INSUFFICIENT };
  }
  const status = text(ai.recommendation_status || gate.status).toUpperCase();
  if (!status && Object.keys(gate).length === 0) return { explicit: false, stocksAllowed: false, notice: null };
  if (status === 'QUALIFIED' && gate.eligible === true) return { explicit: true, stocksAllowed: true, notice: null };
  const screening = gate.screening || record(ai.decision_engine_v1).screening;
  if (status === 'NO_QUALIFIED_OPPORTUNITY' && gate.universe_evaluation_complete === true && hasCompleteUniverseAssessment(screening)) {
    return { explicit: true, stocksAllowed: false, notice: '今天沒有符合標準的新增機會' };
  }
  return { explicit: true, stocksAllowed: false, notice: RECOMMENDATION_EVIDENCE_INSUFFICIENT };
}

/** Keep market/sector observations when stock publication is withheld. Only
 * structured stock identities are excluded; prose is not used to guess one. */
export function subscriberObservationSources(value: unknown, beneficiaries: unknown[], observations: unknown[]): unknown[] {
  const publication = recommendationPublication(value);
  if (!publication.explicit || publication.stocksAllowed) return [...beneficiaries, ...observations];
  return observations.filter((value) => {
    const item = record(value);
    if (['stock_code', 'stock_id', 'stock_name', 'company_name'].some((key) => text(item[key]) || typeof item[key] === 'number')) return false;
    return !['symbol', 'ticker', 'code'].some((key) => {
      const identity = typeof item[key] === 'number' ? String(item[key]) : text(item[key]);
      return /^(?:(?:TWSE|TPEX):)?\d{4,6}(?:\.(?:TW|TWO))?$/i.test(identity);
    });
  });
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
