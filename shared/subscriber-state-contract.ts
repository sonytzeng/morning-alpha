/** The same pure wire contract is imported by the Edge reader and subscriber UI.
 * This projection does not publish data, evaluate research, or grant access. */
export const SUBSCRIBER_STATE_SCHEMA_VERSION = 'ma-subscriber-state-v1' as const;
export const INCOMPLETE_ANALYSIS_MESSAGE = '今日分析尚未完成／證據不足';
export const RECOMMENDATION_INSUFFICIENT_MESSAGE = '推薦評估證據不足，今日暫不發布正式個股推薦';

export type SubscriberState = {
  schema_version: typeof SUBSCRIBER_STATE_SCHEMA_VERSION;
  report_date: string;
  revision_id: string | null;
  generated_at: string | null;
  publication: 'PUBLISHED' | 'UNPUBLISHED';
  analysis: 'READY' | 'PARTIAL' | 'INSUFFICIENT_EVIDENCE';
  closing: 'NOT_DUE' | 'PENDING' | 'COMPLETE' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE';
  recommendation: 'QUALIFIED' | 'BLOCKED' | 'NO_QUALIFIED_OPPORTUNITY';
  confidence: { status: 'AVAILABLE' | 'UNAVAILABLE'; value: number | null };
  reason_codes: string[];
};

type Row = Record<string, unknown>;
type Identity = { report_date?: unknown; revision_id?: unknown; generated_at?: unknown };
const record = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const timestamp = (v: unknown): number => typeof v === 'string' && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(v) ? Date.parse(v) : NaN;
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const number = (v: unknown): number | null => {
  if (typeof v !== 'number' && (typeof v !== 'string' || !v.trim())) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
const score = (v: unknown): number | null => { const n = number(v); return n !== null && n >= 0 && n <= 100 ? n : null; };

/** Unknown versions and contradictory states are errors, never legacy fallback.
 * Identity checking is optional only for callers already handling an envelope. */
export function parseSubscriberState(value: unknown, identity: Identity = {}): SubscriberState | null {
  const s = record(value), confidence = record(s.confidence);
  if (s.schema_version !== SUBSCRIBER_STATE_SCHEMA_VERSION || !validDate(s.report_date)
    || !(s.revision_id === null || (typeof s.revision_id === 'string' && s.revision_id.trim()))
    || !(s.generated_at === null || Number.isFinite(timestamp(s.generated_at)))
    || !['PUBLISHED', 'UNPUBLISHED'].includes(String(s.publication))
    || !['READY', 'PARTIAL', 'INSUFFICIENT_EVIDENCE'].includes(String(s.analysis))
    || !['NOT_DUE', 'PENDING', 'COMPLETE', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE'].includes(String(s.closing))
    || !['QUALIFIED', 'BLOCKED', 'NO_QUALIFIED_OPPORTUNITY'].includes(String(s.recommendation))
    || !Array.isArray(s.reason_codes) || !s.reason_codes.every(v => typeof v === 'string')
    || !['AVAILABLE', 'UNAVAILABLE'].includes(String(confidence.status))) return null;
  for (const key of ['report_date', 'revision_id', 'generated_at'] as const) {
    if (identity[key] !== undefined && identity[key] !== s[key]) return null;
  }
  if (confidence.status === 'AVAILABLE'
    ? typeof confidence.value !== 'number' || score(confidence.value) === null
    : confidence.value !== null) return null;
  if (s.publication === 'PUBLISHED') {
    if (s.analysis !== 'READY' || !s.revision_id || !s.generated_at) return null;
  } else if (s.analysis === 'READY' || s.closing === 'COMPLETE' || s.recommendation !== 'BLOCKED' || confidence.status !== 'UNAVAILABLE') return null;
  if (s.analysis === 'INSUFFICIENT_EVIDENCE' && confidence.status !== 'UNAVAILABLE') return null;
  return value as SubscriberState;
}

export function resolveSubscriberState(ai: unknown): SubscriberState | null {
  const row = record(ai);
  return parseSubscriberState(row.subscriber_state, {
    report_date: row.report_date, revision_id: row.revision_id, generated_at: row.generated_at,
  });
}

/** Shared receipt semantics, without browser-clock advancement. The server
 * separately rejects future receipts against its authoritative request time. */
export function hasMatchingSubscriberClosingReceipt(value: unknown, identity: {
  report_date: string; revision_id: string | null; generated_at: string | null;
}): boolean {
  const close = record(value), at = timestamp(close.verified_at);
  const actuals = [close.actual_taiex_change ?? record(close.actual_taiex_close).change_percent,
    record(close.actual_2330_close).change_percent ?? record(close.actual_tsmc_close).change_percent,
    record(close.actual_txf_close).change_percent];
  const outcome = text(close.prediction_result || close.hit_or_miss).toLowerCase();
  const verifiedDate = Number.isFinite(at) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(at)) : '';
  return validDate(identity.report_date) && Boolean(identity.revision_id)
    && ['COMPLETE', 'COMPLETED', 'VERIFIED'].includes(text(close.status).toUpperCase())
    && text(close.data_status).toLowerCase() === 'complete'
    && close.report_date === identity.report_date && close.opening_decision_snapshot_id === identity.revision_id
    && Number.isFinite(at) && at >= timestamp(identity.generated_at)
    && at >= Date.parse(`${identity.report_date}T14:10:00+08:00`) && verifiedDate === identity.report_date
    && actuals.every(v => number(v) !== null)
    && ['hit', 'partial', 'miss', 'correct', 'wrong', 'mixed', 'neutral'].includes(outcome)
    && Array.isArray(close.missing_data) && close.missing_data.length === 0;
}

export function createSubscriberState(input: {
  report_date: string; revision_id: string | null; generated_at: string | null;
  publicationVerified: boolean; marketEvidenceReady: boolean; analysisStatus: unknown;
  isTradingDay: boolean | null; confidenceValue: unknown; recommendationGate: unknown;
  closing: unknown; now: string;
}): SubscriberState {
  const published = input.publicationVerified && input.marketEvidenceReady
    && input.analysisStatus === 'READY' && validDate(input.report_date)
    && Boolean(input.revision_id) && Number.isFinite(timestamp(input.generated_at));
  const reasons: string[] = [];
  if (!published) reasons.push('MARKET_ANALYSIS_UNPUBLISHED');
  if (!input.marketEvidenceReady) reasons.push('INSUFFICIENT_MARKET_EVIDENCE');
  const confidenceValue = published ? score(input.confidenceValue) : null;
  if (confidenceValue === null) reasons.push('CONFIDENCE_UNAVAILABLE');

  const gate = record(input.recommendationGate), screening = record(gate.screening);
  const completeUniverse = gate.universe_evaluation_complete === true && screening.status === 'COMPLETE'
    && Number.isInteger(screening.universe_count) && Number(screening.universe_count) > 0
    && screening.evaluated_count === screening.universe_count
    && Array.isArray(screening.rejected) && screening.rejected.length === 0;
  const recommendation = published && gate.status === 'QUALIFIED' && gate.eligible === true ? 'QUALIFIED'
    : published && gate.status === 'NO_QUALIFIED_OPPORTUNITY' && completeUniverse ? 'NO_QUALIFIED_OPPORTUNITY' : 'BLOCKED';

  const close = record(input.closing), status = text(close.status).toUpperCase();
  const now = timestamp(input.now), at = timestamp(close.verified_at);
  const due = Date.parse(`${input.report_date}T14:10:00+08:00`);
  let closing: SubscriberState['closing'] = 'PENDING';
  if (input.isTradingDay === false) closing = 'NOT_APPLICABLE';
  else if (status === 'NOT_DUE' || (Number.isFinite(now) && now < due)) closing = 'NOT_DUE';
  else if (Object.keys(close).length) {
    const complete = published && at <= now && hasMatchingSubscriberClosingReceipt(close, input);
    closing = complete ? 'COMPLETE' : 'INSUFFICIENT_EVIDENCE';
    if (!complete) reasons.push('CLOSING_PUBLICATION_EVIDENCE_UNVERIFIED');
  }
  return {
    schema_version: SUBSCRIBER_STATE_SCHEMA_VERSION,
    report_date: input.report_date, revision_id: input.revision_id, generated_at: input.generated_at,
    publication: published ? 'PUBLISHED' : 'UNPUBLISHED',
    analysis: published ? 'READY' : input.analysisStatus === 'PARTIAL' ? 'PARTIAL' : 'INSUFFICIENT_EVIDENCE',
    closing, recommendation,
    confidence: { status: confidenceValue === null ? 'UNAVAILABLE' : 'AVAILABLE', value: confidenceValue }, reason_codes: reasons,
  };
}
