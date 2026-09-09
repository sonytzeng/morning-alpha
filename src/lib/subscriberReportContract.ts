/** Keep this dependency-free contract inside src/: Readdy's frontend build
 * does not package root shared/. Edge consumers retain that path via re-export.
 * One implementation only; do not introduce browser or server runtime imports. */
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

/** Subscriber projection only: publication, stock evidence and entitlement are
 * separate contracts. This module neither evaluates evidence nor grants access. */

export const RECOMMENDATION_EVIDENCE_INSUFFICIENT = RECOMMENDATION_INSUFFICIENT_MESSAGE;
export const SUBSCRIBER_ANALYSIS_INCOMPLETE = INCOMPLETE_ANALYSIS_MESSAGE;

export const SUBSCRIBER_PROJECTION_VERSION = 'ma-subscriber-projection-v1' as const;
export const SUBSCRIBER_CHECKPOINT_KEYS = ['0900', '0930', '1030', '1300', '1410', '1430'] as const;
export type SubscriberCheckpointKey = typeof SUBSCRIBER_CHECKPOINT_KEYS[number];
export type SubscriberCheckpoint = {
  status: 'completed' | 'failed' | 'insufficient' | 'pending' | 'not_applicable';
  evidenceVerified: boolean;
  observedAt: string | null;
};
export type SubscriberReportProjection = {
  schemaVersion: typeof SUBSCRIBER_PROJECTION_VERSION;
  identity: { reportDate: string; revisionId: string | null; generatedAt: string | null; todayDate: string | null };
  displayStatus: 'READY' | 'PARTIAL' | 'INSUFFICIENT_EVIDENCE' | 'INVALIDATED';
  statusLabel: string;
  title: string;
  analysisAvailable: boolean;
  confidence: { value: number | null; label: string; suppressed: boolean };
  marketDecision: { action: 'ACT' | 'WAIT' | 'STOP' | 'INSUFFICIENT_DATA'; label: string; bias: string | null; summary: string | null; runtimeFailure: boolean };
  recommendation: { available: boolean; status: SubscriberState['recommendation']; message: string | null; items: unknown[] };
  closing: { state: SubscriberState['closing']; complete: boolean; result: Row | null; outcome: string | null };
  runtime: {
    checkpoints: Record<SubscriberCheckpointKey, SubscriberCheckpoint>;
    confirmedIntradayEvidence: boolean;
    newIntradayEvidence: boolean;
    decisionEvidence: {
      status: 'Waiting' | 'Confirmed' | 'Rejected' | 'Completed';
      reason: string;
      completedCheckpoints: number;
      totalCheckpoints: number;
      checklistAvailable: boolean;
      marketSnapshotAvailable: boolean;
      runtimeFailure: boolean;
      closingVerified: boolean;
    };
  };
  evidence: { status: 'SUFFICIENT' | 'INSUFFICIENT_EVIDENCE' | 'IDENTITY_MISMATCH' | 'INVALID_CONTRACT' };
  historical: boolean;
};

/** A raw checkpoint label is not proof. Each observation must independently
 * bind the published date/revision, an actual timestamp and structured evidence.
 * No parent-window fallback, browser clock or opening quote can supply proof. */
function projectSubscriberCheckpoints(ai: Row, identity: SubscriberReportProjection['identity'], ready: boolean,
  nonTrading: boolean, closing: SubscriberState['closing'], closingAt: string): Record<SubscriberCheckpointKey, SubscriberCheckpoint> {
  const sync = record(ai.intraday_sync_status), windows = record(sync.windows);
  const parentMatches = (sync.report_date === undefined || sync.report_date === identity.reportDate)
    && (sync.revision_id === undefined || sync.revision_id === identity.revisionId);
  const entries = SUBSCRIBER_CHECKPOINT_KEYS.map((key): [SubscriberCheckpointKey, SubscriberCheckpoint] => {
    const empty = (status: SubscriberCheckpoint['status']): SubscriberCheckpoint => ({ status, evidenceVerified: false, observedAt: null });
    if (nonTrading) return [key, empty('not_applicable')];
    if (key === '1430') return [key, closing === 'COMPLETE'
      ? { status: 'completed', evidenceVerified: true, observedAt: closingAt }
      : empty(closing === 'INSUFFICIENT_EVIDENCE' || !ready ? 'insufficient' : 'pending')];
    if (!ready) return [key, empty('insufficient')];
    const checkpoint = record(windows[key]);
    if (!Object.keys(checkpoint).length) return [key, empty('pending')];
    const status = text(checkpoint.status).toUpperCase();
    const failed = ['FAILED', 'REJECTED', 'INVALIDATED'].includes(status);
    const completed = ['READY', 'COMPLETE', 'COMPLETED', 'SYNCED'].includes(status);
    if (!failed && !completed) return [key, empty(['MISSING', 'STALE', 'INSUFFICIENT', 'NOT_UPDATED'].includes(status) ? 'insufficient' : 'pending')];
    const observedAt = text(failed ? checkpoint.failed_at : checkpoint.completed_at);
    const at = timestamp(observedAt);
    const day = Number.isFinite(at) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(at)) : '';
    const evidence = checkpoint.evidence;
    const hasEvidence = Array.isArray(evidence)
      ? evidence.some(item => Object.keys(record(item)).length > 0)
      : Object.keys(record(evidence)).length > 0;
    const checkpointStart = Date.parse(`${identity.reportDate}T${key.slice(0, 2)}:${key.slice(2)}:00+08:00`);
    const verified = parentMatches && checkpoint.report_date === identity.reportDate && checkpoint.revision_id === identity.revisionId
      && Boolean(identity.revisionId) && Number.isFinite(at) && at >= timestamp(identity.generatedAt)
      && at >= checkpointStart && day === identity.reportDate && hasEvidence;
    return [key, verified ? { status: failed ? 'failed' : 'completed', evidenceVerified: true, observedAt }
      : empty('insufficient')];
  });
  return Object.fromEntries(entries) as Record<SubscriberCheckpointKey, SubscriberCheckpoint>;
}

/** The ONLY subscriber interpretation boundary. Accepts a trimmed payload,
 * response envelope or report row. Never evaluates a role, fabricates evidence,
 * or advances a checkpoint with browser time. Raw/internal fields cannot override
 * a versioned state. A missing legacy publication receipt fails closed. */
export function getSubscriberReportProjection(value: unknown, options: { todayDate?: string; historical?: boolean } = {}): SubscriberReportProjection {
  const outer = record(value);
  const payload = Object.keys(record(outer.payload)).length ? record(outer.payload) : outer;
  const nested = record(payload.ai_strategy_json);
  // Trimmed public fields win over the admin-only nested raw report.
  const ai: Row = { ...nested, ...payload };
  const canonical = record(ai.canonical_decision);
  const stateValue = outer.subscriber_state ?? ai.subscriber_state;
  const rawState = record(stateValue);
  const reportDate = text(outer.report_date || ai.report_date || canonical.report_date || rawState.report_date);
  const revisionId = text(outer.revision_id || ai.revision_id || canonical.id || rawState.revision_id) || null;
  const generatedAt = text(outer.generated_at || ai.generated_at || canonical.generated_at || rawState.generated_at || outer.created_at) || null;
  const todayDate = validDate(options.todayDate) ? options.todayDate
    : validDate(outer.today_date) ? outer.today_date : validDate(ai.today_date) ? ai.today_date : null;
  const identity = { reportDate, revisionId, generatedAt, todayDate };
  const matches = (values: unknown[], expected: unknown) => values.every(v => v === undefined || v === null || v === '' || v === expected);
  const mixedIdentity = !matches([outer.report_date, ai.report_date, canonical.report_date, rawState.report_date], reportDate)
    || !matches([outer.revision_id, ai.revision_id, canonical.id, rawState.revision_id], revisionId)
    || !matches([outer.generated_at, ai.generated_at, canonical.generated_at, rawState.generated_at], generatedAt);
  const hasState = Object.prototype.hasOwnProperty.call(outer, 'subscriber_state') || Object.prototype.hasOwnProperty.call(ai, 'subscriber_state');
  const state = hasState ? parseSubscriberState(stateValue, { report_date: reportDate, revision_id: revisionId, generated_at: generatedAt }) : null;
  const validIdentity = validDate(reportDate) && Boolean(revisionId) && Number.isFinite(timestamp(generatedAt)) && !mixedIdentity;
  const publication = record(ai.content_publish_gate);
  const ready = validIdentity && (hasState
    ? state?.publication === 'PUBLISHED' && state.analysis === 'READY'
    : canonical.status === 'READY' && publication.overall_status === 'eligible'
      && (ai.report_status === undefined || ai.report_status === 'READY'));
  const partial = state?.analysis === 'PARTIAL' || (!hasState && canonical.status === 'PARTIAL');
  const confidenceValue = !ready ? null : hasState
    ? state?.confidence.status === 'AVAILABLE' ? state.confidence.value : null
    : score(canonical.confidence_score);
  const historical = options.historical === true || Boolean(todayDate && reportDate && todayDate !== reportDate);
  const nonTrading = ai.is_trading_day === false;
  const rawAction = text(canonical.action).toUpperCase();
  let action: SubscriberReportProjection['marketDecision']['action'] = !ready ? 'INSUFFICIENT_DATA'
    : nonTrading ? 'WAIT' : ['ACT', 'WAIT', 'STOP'].includes(rawAction) ? rawAction as 'ACT' | 'WAIT' | 'STOP' : 'INSUFFICIENT_DATA';
  const gate = record(ai.recommendation_gate || record(ai.market_report_gate).recommendation_gate);
  const recommendationStatus = hasState ? state?.recommendation : text(ai.recommendation_status || gate.status).toUpperCase();
  const screening = gate.screening || record(ai.decision_engine_v1).screening;
  const noQualified = ready && recommendationStatus === 'NO_QUALIFIED_OPPORTUNITY'
    && gate.universe_evaluation_complete === true && hasCompleteUniverseAssessment(screening);
  const qualified = ready && !historical && !nonTrading && recommendationStatus === 'QUALIFIED'
    && (hasState ? state?.recommendation === 'QUALIFIED' : gate.eligible === true);
  const candidates = canonical.recommendations ?? ai.today_beneficiary_stocks_v10 ?? ai.today_beneficiary_stocks
    ?? record(ai.decision_engine_v1).stock_opportunities ?? ai.stock_recommendations ?? ai.recommendations;
  const items = qualified && Array.isArray(candidates) ? candidates : [];
  const recommendation: SubscriberReportProjection['recommendation'] = {
    available: qualified, status: qualified ? 'QUALIFIED' : noQualified ? 'NO_QUALIFIED_OPPORTUNITY' : 'BLOCKED',
    message: qualified ? null : noQualified ? '今天沒有符合標準的新增機會' : RECOMMENDATION_INSUFFICIENT_MESSAGE, items,
  };
  // Priority is deterministic. No fallback from an explicit NOT_DUE or invalid
  // v2 receipt to a legacy completed claim from another revision.
  const close = record(ai.closing_verification_v2 ?? ai.closing_verification ?? ai.todayCloseVerification);
  const declaredClose = hasState ? state?.closing : text(close.status).toUpperCase();
  const receipt = ready && hasMatchingSubscriberClosingReceipt(close, { report_date: reportDate, revision_id: revisionId, generated_at: generatedAt });
  let closingState: SubscriberState['closing'] = 'PENDING';
  if (nonTrading || declaredClose === 'NOT_APPLICABLE') closingState = 'NOT_APPLICABLE';
  else if (declaredClose === 'NOT_DUE') closingState = 'NOT_DUE';
  else if (receipt && (!hasState || declaredClose === 'COMPLETE')) closingState = 'COMPLETE';
  else if (!ready || Object.keys(close).length || declaredClose === 'INSUFFICIENT_EVIDENCE') closingState = 'INSUFFICIENT_EVIDENCE';
  const checkpoints = projectSubscriberCheckpoints(ai, identity, ready, nonTrading, closingState, text(close.verified_at));
  const failedCheckpoint = Object.values(checkpoints).some(checkpoint => checkpoint.status === 'failed');
  const runtimeFailure = ready && (failedCheckpoint || closingState === 'COMPLETE'
    && ['miss', 'wrong'].includes(text(close.prediction_result || close.hit_or_miss).toLowerCase()));
  if (runtimeFailure) action = 'STOP';
  const displayStatus = runtimeFailure ? 'INVALIDATED' : ready ? 'READY' : partial && !mixedIdentity ? 'PARTIAL' : 'INSUFFICIENT_EVIDENCE';
  const statusLabel = ready ? runtimeFailure ? '驗證顯示原判斷已失效' : historical ? '歷史市場分析（非今日）' : nonTrading ? '今日非交易日' : '市場分析已發布' : INCOMPLETE_ANALYSIS_MESSAGE;
  const rawSummary = text(canonical.daily_sentence || ai.daily_sentence || ai.summary);
  // Legacy prose may repeat an unverified numeric confidence. Withholding that
  // summary is safer than editing the number or inventing replacement analysis.
  const summary = confidenceValue !== null ? rawSummary : rawSummary.split(/[；;\n]/).filter(clause =>
    !/\d+(?:\.\d+)?\s*\/\s*100/.test(clause)
    && !/(?:信心|把握|confidence|評分)[^。；\n]{0,16}\d+(?:\.\d+)?\s*(?:%|分)/i.test(clause)).join('；');
  // Preserve the existing three-core-market and nonempty checklist prerequisites
  // inside the single subscriber projection. Availability may withhold a claim;
  // it never supplies missing publication, revision-bound runtime or close proof.
  const snapshots = Array.isArray(ai.market_data_snapshots) ? ai.market_data_snapshots : [];
  const coreSymbols = new Set(snapshots.flatMap(value => {
    const row = record(value);
    if (number(row.value) === null || number(row.change_percent) === null) return [];
    const symbol = text(row.symbol || row.ticker).toUpperCase().replace(/^(TWSE|TPEX):/, '').replace(/\.(TW|TWO)$/, '');
    if (['TAIEX', '^TWII'].includes(symbol)) return ['TAIEX'];
    if (['TXF', 'TX', 'TX1', 'TX01'].includes(symbol)) return ['TXF'];
    return symbol === '2330' ? ['2330'] : [];
  }));
  const marketSnapshotAvailable = ['TAIEX', 'TXF', '2330'].every(symbol => coreSymbols.has(symbol));
  const note = record(ai.member_research_note_v2);
  const timeWindows = Array.isArray(note.intraday_time_windows)
    ? note.intraday_time_windows.filter(value => value !== null && typeof value === 'object' && !Array.isArray(value)) : [];
  const checklistRows = timeWindows.length ? timeWindows : Array.isArray(note.intraday_validation)
    ? note.intraday_validation.map(value => typeof value === 'string' ? { what_to_watch: value } : record(value)) : [];
  const hasContent = (value: unknown): boolean => Boolean(text(value)) || typeof value === 'number' && Number.isFinite(value);
  const checklistAvailable = ready && !nonTrading && checklistRows.slice(0, 5).some(value => {
    const row = record(value);
    return ['title', 'purpose', 'what_to_watch', 'action_note', 'signals_to_watch', 'bullish_confirmation', 'bullish_confirm']
      .some(key => hasContent(row[key]));
  });
  const completedCheckpoints = (['0930', '1030', '1300'] as const)
    .filter(key => checkpoints[key].status === 'completed' && checkpoints[key].evidenceVerified).length;
  const decisionEvidence: SubscriberReportProjection['runtime']['decisionEvidence'] = {
    status: 'Waiting', reason: '尚無完成的盤中驗證節點。', completedCheckpoints, totalCheckpoints: 3,
    checklistAvailable, marketSnapshotAvailable, runtimeFailure: false, closingVerified: false,
  };
  if (!ready) decisionEvidence.reason = INCOMPLETE_ANALYSIS_MESSAGE;
  else if (closingState === 'NOT_APPLICABLE') decisionEvidence.reason = '今日非交易日，本節點不適用，等待下一個交易日。';
  else if (closingState === 'COMPLETE') {
    const closingRejected = ['miss', 'wrong'].includes(text(close.prediction_result || close.hit_or_miss).toLowerCase());
    decisionEvidence.status = closingRejected ? 'Rejected' : 'Completed';
    decisionEvidence.reason = closingRejected ? '收盤驗證確認原劇本失效。' : '收盤驗證已完成。';
    decisionEvidence.runtimeFailure = closingRejected;
    decisionEvidence.closingVerified = true;
  } else if (runtimeFailure && marketSnapshotAvailable) {
    decisionEvidence.status = 'Rejected';
    decisionEvidence.reason = '盤中驗證節點已回傳明確失敗證據。';
    decisionEvidence.runtimeFailure = true;
  } else if (completedCheckpoints > 0 && checklistAvailable && marketSnapshotAvailable) {
    decisionEvidence.status = 'Confirmed';
    decisionEvidence.reason = '盤中驗證節點、驗證清單與市場快照均已到位。';
  } else if (!marketSnapshotAvailable) decisionEvidence.reason = '市場快照不足，暫不升級決策。';
  else if (!checklistAvailable) decisionEvidence.reason = '驗證清單不足，暫不升級決策。';
  return {
    schemaVersion: SUBSCRIBER_PROJECTION_VERSION, identity, displayStatus, statusLabel,
    title: ready ? 'Morning Alpha 市場判讀' : INCOMPLETE_ANALYSIS_MESSAGE, analysisAvailable: ready,
    confidence: { value: confidenceValue, label: confidenceValue === null ? '證據不足，暫不提供把握度' : `${confidenceValue} / 100`, suppressed: confidenceValue === null },
    marketDecision: { action, label: !ready ? INCOMPLETE_ANALYSIS_MESSAGE : nonTrading ? '等待下一個交易日'
      : action === 'ACT' ? '依已確認條件執行' : action === 'STOP' ? '停止原定計畫' : action === 'WAIT' ? '等待確認' : INCOMPLETE_ANALYSIS_MESSAGE,
      bias: ready ? text(canonical.market_bias || ai.market_bias) || null : null,
      summary: ready ? summary || null : null, runtimeFailure },
    recommendation,
    closing: { state: closingState, complete: closingState === 'COMPLETE', result: closingState === 'COMPLETE' ? close : null,
      outcome: closingState === 'COMPLETE' ? text(close.prediction_result || close.hit_or_miss).toLowerCase() || null : null },
    runtime: { checkpoints, decisionEvidence,
      confirmedIntradayEvidence: (['0930', '1030', '1300'] as const).some(key => checkpoints[key].status === 'completed'),
      newIntradayEvidence: ready && (closingState === 'COMPLETE' || checkpoints['1030'].status === 'completed' || checkpoints['1300'].status === 'completed') },
    evidence: { status: mixedIdentity ? 'IDENTITY_MISMATCH' : hasState && !state ? 'INVALID_CONTRACT' : ready ? 'SUFFICIENT' : 'INSUFFICIENT_EVIDENCE' }, historical,
  };
}

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
  return !getSubscriberReportProjection(value).analysisAvailable;
}

export function subscriberConfidence(value: unknown, legacyValue: unknown): number | null {
  return getSubscriberReportProjection({ confidence_score: legacyValue, ...record(value) }).confidence.value;
}

export function hasCompleteUniverseAssessment(value: unknown): boolean {
  const screening = record(value);
  return screening.status === 'COMPLETE'
    && typeof screening.universe_count === 'number' && Number.isInteger(screening.universe_count) && screening.universe_count > 0
    && typeof screening.evaluated_count === 'number' && screening.evaluated_count === screening.universe_count
    && Array.isArray(screening.rejected) && screening.rejected.length === 0;
}

export function isMarketPublicationReady(value: unknown): boolean {
  return getSubscriberReportProjection(value).analysisAvailable;
}

export function recommendationPublication(value: unknown): { explicit: boolean; stocksAllowed: boolean; notice: string | null } {
  const recommendation = getSubscriberReportProjection(value).recommendation;
  return { explicit: true, stocksAllowed: recommendation.available, notice: recommendation.message };
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
