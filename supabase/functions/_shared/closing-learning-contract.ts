import { CORE_SYMBOL_ALIASES, isSnapshotInCloseWindow, taipeiDateFromIso, type RuntimeSnapshotRow } from './intraday-runtime-contract.ts';
import { resolveMarketStatus } from './market-status.ts';
import { evaluateCheckpointFreshness } from './market-runtime-stability.mjs';
import { buildCanonicalMarketState, canonicalMarketDocument, canonicalMarketSourceRefs } from './canonical-market-state.ts';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const records = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export type OpeningPublication = {
  schema_version: 'CORE_OPENING_PUBLICATION_V1';
  status: 'PUBLISHED' | 'BLOCKED';
  report_id: string;
  report_date: string;
  revision_id: string;
  opening_publication_revision_id: string;
  publication_run_id: string | null;
  snapshot_version: number | null;
  decision_mode: string;
  recommended_symbols: string[];
  predicted_at: string | null;
  reason_codes: string[];
};

/** Existing DB authority is reports.ai_strategy_json.revision_id plus the
 * successful atomic publication receipt. An internal current/QA row is not it.
 * The versioned pointer is additive; a malformed present contract never falls
 * back to a legacy alias. No opening pointer is guessed for intraday reports. */
export function resolveOpeningPublicationIdentity(reportValue: unknown): OpeningPublication {
  const report = object(reportValue), ai = object(report.ai_strategy_json);
  const contract = object(ai.market_publication_contract);
  const reportDate = text(report.report_date), revision = text(ai.revision_id);
  const reasons: string[] = [];
  let openingRevision = revision;
  if (ai.market_publication_contract !== undefined && ai.market_publication_contract !== null) {
    if (contract.schema_version !== 'CORE_MARKET_PUBLICATION_V1' || contract.status !== 'PUBLISHED'
      || contract.report_date !== reportDate || contract.revision_id !== revision
      || !text(contract.opening_publication_revision_id)) reasons.push('MARKET_PUBLICATION_CONTRACT_INVALID');
    openingRevision = text(contract.opening_publication_revision_id);
  }
  if (!text(report.id) || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !revision || !openingRevision) reasons.push('OPENING_PUBLICATION_POINTER_MISSING');
  return {
    schema_version: 'CORE_OPENING_PUBLICATION_V1', status: 'BLOCKED',
    report_id: text(report.id), report_date: reportDate, revision_id: revision,
    opening_publication_revision_id: openingRevision, publication_run_id: null,
    snapshot_version: null, decision_mode: '', recommended_symbols: [], predicted_at: null, reason_codes: reasons,
  };
}

export function validateOpeningPublication(input: {
  report: unknown; snapshot: unknown; publicationRun: unknown; now?: number;
}): OpeningPublication {
  const identity = resolveOpeningPublicationIdentity(input.report);
  const snapshot = object(input.snapshot), run = object(input.publicationRun);
  const result = object(object(run.provider_status).result), generated = object(snapshot.generated_text);
  const reasons = [...identity.reason_codes], now = input.now ?? Date.now();
  const predictedAt = text(snapshot.valid_from), publishedAt = text(run.completed_at);
  const predictedTime = Date.parse(predictedAt), publishedTime = Date.parse(publishedAt);
  const openingTime = Date.parse(`${identity.report_date}T09:00:00+08:00`);
  if (snapshot.id !== identity.opening_publication_revision_id || snapshot.report_id !== identity.report_id
    || snapshot.report_date !== identity.report_date || snapshot.session_type !== 'PREMARKET'
    || snapshot.status !== 'READY' || !finite(snapshot.version) || snapshot.version <= 0
    || !['market_only', 'recommendations', 'no_trade'].includes(text(snapshot.decision_mode))) reasons.push('OPENING_SNAPSHOT_UNVERIFIED');
  if (!text(generated.market_bias) && !text(snapshot.market_regime)) reasons.push('OPENING_MARKET_PREDICTION_MISSING');
  if (!Array.isArray(snapshot.source_refs) || snapshot.source_refs.length === 0) reasons.push('OPENING_SOURCE_REFS_MISSING');
  if (Object.hasOwn(generated, 'canonical_market_state')) {
    const state = object(generated.canonical_market_state);
    const document = canonicalMarketDocument(generated);
    const audited = buildCanonicalMarketState(document);
    const expectedRefs = canonicalMarketSourceRefs(generated);
    const sourceKeys = (rows: Json[]) => rows.map(row => JSON.stringify([
      row.evidence_id, row.source, row.source_date, row.freshness,
    ])).sort();
    if (state.status !== 'READY' || audited.status !== 'READY' || audited.report_date !== identity.report_date
      || state.report_date !== identity.report_date
      || Object.keys(document).length === 0 || expectedRefs.length === 0
      || JSON.stringify(sourceKeys(expectedRefs)) !== JSON.stringify(sourceKeys(records(snapshot.source_refs)))) {
      reasons.push('OPENING_FROZEN_MARKET_DOCUMENT_UNVERIFIED');
    }
  }
  if (!Number.isFinite(predictedTime) || predictedTime > now || predictedTime >= openingTime
    || taipeiDateFromIso(predictedAt) !== identity.report_date) reasons.push('OPENING_PREDICTION_TIME_INVALID');
  if (run.status !== 'SUCCEEDED' || !text(run.id) || run.trading_date !== identity.report_date
    || !text(run.idempotency_key).startsWith('research-input:') || result.success !== true
    || result.report_id !== identity.report_id || result.report_date !== identity.report_date
    || result.decision_snapshot_id !== identity.opening_publication_revision_id
    || !Number.isFinite(publishedTime) || publishedTime < predictedTime || publishedTime >= openingTime
    || publishedTime > now || taipeiDateFromIso(publishedAt) !== identity.report_date) reasons.push('OPENING_ATOMIC_PUBLICATION_RECEIPT_MISSING');
  if (snapshot.decision_mode === 'market_only' && (!Array.isArray(generated.recommendations)
    || generated.recommendations.length !== 0)) reasons.push('MARKET_ONLY_STOCK_PREDICTION_FORBIDDEN');
  return { ...identity, status: reasons.length === 0 ? 'PUBLISHED' : 'BLOCKED',
    publication_run_id: text(run.id) || null, snapshot_version: finite(snapshot.version) ? snapshot.version : null,
    decision_mode: text(snapshot.decision_mode),
    recommended_symbols: records(generated.recommendations).map(row => text(row.symbol || row.stock_symbol || row.code).toUpperCase()).filter(Boolean),
    predicted_at: predictedAt || null, reason_codes: [...new Set(reasons)] };
}

export function isTrustedCloseSnapshot(rowValue: unknown, reportDate: string, now = Date.now()): boolean {
  const row = object(rowValue);
  // Fetch persists provider quote time in captured_at (not fetch wall time).
  // When an explicit source timestamp is supplied it must also be fresh; it
  // cannot be hidden behind a later captured_at or a present malformed alias.
  const suppliedSourceTime = [row.source_timestamp, row.source_at, object(row.raw).returned_date].find(value => value !== undefined);
  const sourceAt = suppliedSourceTime === undefined ? text(row.captured_at) : text(suppliedSourceTime);
  const symbol = Object.entries(CORE_SYMBOL_ALIASES).find(([, aliases]) => (aliases as readonly string[]).includes(text(row.symbol).toUpperCase()))?.[0];
  const freshness = evaluateCheckpointFreshness({ captured_at: sourceAt, evaluated_at: new Date(now).toISOString(),
    trading_date: reportDate, phase: 'close', market: 'TW', symbol: symbol === 'TSMC' ? '2330' : symbol || row.symbol });
  return text(row.source).length > 0 && finite(row.value) && row.value > 0 && finite(row.change_percent)
    && isSnapshotInCloseWindow(row as RuntimeSnapshotRow, reportDate)
    && Date.parse(text(row.captured_at)) <= now && Date.parse(sourceAt) <= Date.parse(text(row.captured_at))
    && freshness.valid === true;
}

export function closingDueState(reportDate: string, now = Date.now()): 'NOT_APPLICABLE' | 'NOT_DUE' | 'DUE' {
  if (!resolveMarketStatus(reportDate).is_trading_day) return 'NOT_APPLICABLE';
  return now < Date.parse(`${reportDate}T14:10:00+08:00`) ? 'NOT_DUE' : 'DUE';
}

export type ClosingContract = {
  schema_version: 'CORE_CLOSING_V1';
  report_date: string;
  opening_publication_revision_id: string;
  status: 'COMPLETE' | 'PENDING' | 'INSUFFICIENT_EVIDENCE';
  closing_snapshot_id: string | null;
  evidence_fingerprint: string | null;
  evidence_ready: boolean;
  market_close: Json | null;
  market_evaluation: 'COMPLETE' | 'INSUFFICIENT_EVIDENCE';
  stock_evaluation: 'COMPLETE' | 'NOT_APPLICABLE' | 'INSUFFICIENT_EVIDENCE';
  verified_at: string | null;
  reason_codes: string[];
  market_reason_codes: string[];
  stock_reason_codes: string[];
};

/** Completion is reconstructed from an exact opening identity and real quote
 * receipts, never from lifecycle status, elapsed time or a legacy COMPLETE alias. */
export function evaluateClosingContract(input: {
  opening: OpeningPublication; closing?: unknown; closingSnapshot?: unknown; expectedSnapshotId?: string | null; now?: number;
}): ClosingContract {
  const { opening } = input, snapshot = object(input.closingSnapshot), generated = object(snapshot.generated_text);
  // Once a durable receipt is supplied, its immutable body is the only outcome
  // source. Report aliases cannot repair or override a malformed receipt.
  const closing = Object.keys(snapshot).length > 0 ? object(generated.closing_verification_v2) : object(input.closing);
  const now = input.now ?? Date.now();
  const reasons = [...opening.reason_codes], stockReasons: string[] = [], verifiedAt = text(closing.verified_at);
  const verifiedTime = Date.parse(verifiedAt);
  if (opening.status !== 'PUBLISHED') reasons.push('OPENING_PUBLICATION_UNVERIFIED');
  if (closing.report_date !== opening.report_date || closing.opening_decision_snapshot_id !== opening.opening_publication_revision_id
    || closing.opening_decision_snapshot_version !== opening.snapshot_version) reasons.push('CLOSING_OPENING_REVISION_MISMATCH');
  if (closing.status !== 'completed' || closing.data_status !== 'complete') reasons.push('CLOSING_NOT_COMPLETE');
  if (!Number.isFinite(verifiedTime) || verifiedTime > now || taipeiDateFromIso(verifiedAt) !== opening.report_date) reasons.push('CLOSING_VERIFICATION_TIME_INVALID');
  const aliases: Record<string, readonly string[]> = { actual_taiex_close: CORE_SYMBOL_ALIASES.TAIEX,
    actual_2330_close: CORE_SYMBOL_ALIASES.TSMC, actual_txf_close: CORE_SYMBOL_ALIASES.TXF };
  for (const field of Object.keys(aliases)) {
    const quote = object(closing[field]);
    // Older v2 receipts declare the close table/window in data_source, but lack
    // quote-level phase/date. Only that known strict producer contract may adapt.
    const strictLegacy = closing.version === 'S2_P2_CLOSE_VERIFICATION_V2'
      && object(closing.data_source).table === 'market_data_snapshots'
      && object(closing.data_source).no_fake_data === true;
    const row = { ...quote, phase: quote.phase ?? (strictLegacy ? 'close' : null),
      trading_date: quote.trading_date ?? (strictLegacy ? closing.report_date : null) };
    if (!aliases[field].includes(text(quote.symbol).toUpperCase()) || !isTrustedCloseSnapshot(row, opening.report_date, now)
      || Date.parse(text(quote.captured_at)) > verifiedTime) reasons.push(`CLOSING_${field.toUpperCase()}_MISSING`);
  }
  if (closing.actual_direction !== 'up' && closing.actual_direction !== 'down' && closing.actual_direction !== 'flat') reasons.push('CLOSING_DIRECTION_MISSING');
  if (!['hit', 'miss', 'partial'].includes(text(closing.hit_or_miss))) reasons.push('CLOSING_OUTCOME_MISSING');
  const beneficiary = object(closing.beneficiary_list_validation);
  const noStocks = opening.decision_mode === 'market_only' || opening.decision_mode === 'no_trade';
  let stock: ClosingContract['stock_evaluation'] = noStocks ? 'NOT_APPLICABLE' : 'COMPLETE';
  if (noStocks) {
    if (!Array.isArray(closing.predicted_beneficiary_stocks) || closing.predicted_beneficiary_stocks.length !== 0
      || !Array.isArray(beneficiary.items) || beneficiary.items.length !== 0) reasons.push('UNEXPECTED_STOCK_OUTCOME');
  } else if (beneficiary.data_status !== 'complete' || records(beneficiary.items).length === 0
    || records(beneficiary.items).length !== records(closing.predicted_beneficiary_stocks).length
    || records(beneficiary.items).some(row => row.data_status !== 'complete' || !finite(row.close_change_percent))) {
    stock = 'INSUFFICIENT_EVIDENCE'; stockReasons.push('STOCK_CLOSE_EVIDENCE_INCOMPLETE');
  }
  const evidenceReady = reasons.length === 0;
  const fingerprint = text(closing.evidence_fingerprint);
  const snapshotTime = Date.parse(text(snapshot.valid_from));
  if (!text(snapshot.id) || (input.expectedSnapshotId && snapshot.id !== input.expectedSnapshotId)
    || snapshot.report_id !== opening.report_id || snapshot.report_date !== opening.report_date
    || snapshot.session_type !== 'CLOSING' || snapshot.status !== 'FINAL'
    || snapshot.coverage_score !== 100 || object(snapshot.source_freshness).status !== 'complete'
    || generated.opening_decision_snapshot_id !== opening.opening_publication_revision_id
    || generated.opening_decision_snapshot_version !== opening.snapshot_version
    || !fingerprint || generated.evidence_fingerprint !== fingerprint
    || !Number.isFinite(snapshotTime) || snapshotTime < verifiedTime || snapshotTime > now
    || taipeiDateFromIso(text(snapshot.valid_from)) !== opening.report_date) reasons.push('DURABLE_CLOSING_RECEIPT_MISSING');
  const complete = reasons.length === 0;
  return { schema_version: 'CORE_CLOSING_V1', report_date: opening.report_date,
    opening_publication_revision_id: opening.opening_publication_revision_id,
    status: complete ? 'COMPLETE' : evidenceReady || Object.keys(closing).length === 0 ? 'PENDING' : 'INSUFFICIENT_EVIDENCE',
    closing_snapshot_id: complete ? text(snapshot.id) : null, evidence_fingerprint: fingerprint || null, evidence_ready: evidenceReady,
    market_close: complete ? { ...object(closing.actual_taiex_close), table: 'market_data_snapshots',
      phase: 'close', trading_date: opening.report_date } : null,
    market_evaluation: complete ? 'COMPLETE' : 'INSUFFICIENT_EVIDENCE', stock_evaluation: stock,
    verified_at: complete ? verifiedAt : null, reason_codes: [...new Set(reasons)],
    market_reason_codes: [...new Set(reasons)], stock_reason_codes: [...new Set(stockReasons)] };
}

export function resolveClosingReceiptPointer(reportValue: unknown, opening: OpeningPublication): string | null {
  const contract = object(object(object(reportValue).ai_strategy_json).closing_contract);
  return contract.schema_version === 'CORE_CLOSING_V1' && contract.status === 'COMPLETE'
    && contract.report_date === opening.report_date
    && contract.opening_publication_revision_id === opening.opening_publication_revision_id
    ? text(contract.closing_snapshot_id) || null : null;
}

/** One statistical observation per forecast lineage/date/scope/symbol. Storage
 * remains append-only; selecting a newer corrective revision never adds a second
 * sample for the same forecast. Unknown/invalid rows cannot win that selection. */
export function selectLearningPredictionSamples<T extends Json>(rows: T[]): T[] {
  const chosen = new Map<string, T>();
  for (const row of rows) {
    if (row.record_status !== 'valid' || !['complete', 'degraded'].includes(text(row.data_quality_status))) continue;
    const key = [row.report_date, row.analysis_window || 'PREMARKET', row.prediction_scope, row.symbol].map(text).join('|');
    const previous = chosen.get(key);
    if (!previous || Number(row.revision || 1) > Number(previous.revision || 1)
      || (Number(row.revision || 1) === Number(previous.revision || 1) && text(row.id) > text(previous.id))) chosen.set(key, row);
  }
  return [...chosen.values()];
}

/** A normal daily run may record only a new/current-day due observation.
 * Completed or past-due original evidence is never revised as an incidental
 * effect of stricter validation, adding metadata, or scanning a 120-day window. */
export function canWriteLearningOutcome(rowValue: unknown, existingValue: unknown, predictionDate: string, targetDate: string): boolean {
  const row = object(rowValue), existing = object(existingValue);
  if (existing.status === 'completed' || (text(existing.target_date) && text(existing.target_date) < targetDate)) return false;
  if (predictionDate < targetDate && row.target_date !== targetDate) return false;
  return !text(row.target_date) || text(row.target_date) >= targetDate;
}

export type LearningContract = {
  schema_version: 'CORE_LEARNING_V1';
  report_date: string;
  opening_publication_revision_id: string;
  status: 'COMPLETE' | 'INSUFFICIENT_EVIDENCE';
  market_prediction_count: number;
  stock_prediction_count: number;
  stock_evaluation: 'COMPLETE' | 'NOT_APPLICABLE' | 'INSUFFICIENT_EVIDENCE';
  reason_codes: string[];
  market_reason_codes: string[];
  stock_reason_codes: string[];
};

export function evaluateLearningContract(input: {
  opening: OpeningPublication; closing: ClosingContract; predictions: unknown; outcomes: unknown; now?: number;
}): LearningContract {
  const { opening, closing } = input, now = input.now ?? Date.now();
  const reasons: string[] = [], stockReasons: string[] = [], predictions = records(input.predictions), outcomes = records(input.outcomes);
  if (opening.status !== 'PUBLISHED' || closing.status !== 'COMPLETE' || !closing.closing_snapshot_id
    || closing.opening_publication_revision_id !== opening.opening_publication_revision_id
    || closing.report_date !== opening.report_date) reasons.push('LEARNING_CLOSING_UNVERIFIED');
  const market = predictions.filter(row => row.prediction_scope === 'market' && row.symbol === 'TAIEX');
  const stocks = predictions.filter(row => row.prediction_scope === 'symbol');
  if (market.length !== 1) reasons.push('MARKET_PREDICTION_REQUIRED');
  const noStocks = opening.decision_mode === 'market_only' || opening.decision_mode === 'no_trade';
  if (noStocks && stocks.length > 0) reasons.push('UNEXPECTED_STOCK_PREDICTION');
  if (!noStocks && (stocks.length !== opening.recommended_symbols.length || stocks.length === 0
    || stocks.some(row => !opening.recommended_symbols.includes(text(row.symbol))))) stockReasons.push('STOCK_PREDICTION_SET_INCOMPLETE');
  for (const prediction of predictions) {
    const scopedReasons = prediction.prediction_scope === 'symbol' ? stockReasons : reasons;
    if (prediction.report_date !== opening.report_date || prediction.decision_snapshot_id !== opening.opening_publication_revision_id
      || prediction.record_status !== 'valid' || prediction.data_quality_status !== 'complete') scopedReasons.push('LEARNING_PREDICTION_REVISION_UNVERIFIED');
    const close = outcomes.find(row => row.prediction_id === prediction.id && row.horizon === 'close');
    const refs = records(close?.source_refs), evaluated = Date.parse(text(close?.evaluated_at));
    const marketClose = object(closing.market_close);
    if (!close || close.target_date !== opening.report_date || close.status !== 'completed' || close.data_quality_status !== 'complete'
      || !finite(close.return_percent) || typeof close.direction_correct !== 'boolean'
      || !Number.isFinite(evaluated) || evaluated > now || evaluated < Date.parse(opening.predicted_at || '')
      || !refs.some(ref => {
        // Read-only compatibility: an old immutable outcome may reference the
        // exact quote without embedding values. Only the verified durable
        // market receipt can supply those missing values; nothing is rewritten.
        const exactMarketRef = prediction.prediction_scope === 'market' && ref.symbol === marketClose.symbol
          && ref.phase === marketClose.phase && ref.trading_date === marketClose.trading_date
          && ref.source === marketClose.source && ref.captured_at === marketClose.captured_at;
        const proof = exactMarketRef ? { ...marketClose, ...ref,
          value: ref.value === undefined ? marketClose.value : ref.value,
          change_percent: ref.change_percent === undefined ? marketClose.change_percent : ref.change_percent } : ref;
        return ref.table === 'market_data_snapshots' && ref.symbol === prediction.symbol
          && isTrustedCloseSnapshot(proof, opening.report_date, now) && finite(close.return_percent) && finite(proof.change_percent)
          && Math.abs(proof.change_percent - close.return_percent) < 0.00000001
          && Date.parse(text(ref.captured_at)) <= evaluated;
      })) scopedReasons.push('REAL_CLOSE_OUTCOME_REQUIRED');
  }
  return { schema_version: 'CORE_LEARNING_V1', report_date: opening.report_date,
    opening_publication_revision_id: opening.opening_publication_revision_id,
    status: reasons.length === 0 ? 'COMPLETE' : 'INSUFFICIENT_EVIDENCE',
    market_prediction_count: market.length, stock_prediction_count: stocks.length,
    stock_evaluation: noStocks ? stocks.length === 0 ? 'NOT_APPLICABLE' : 'INSUFFICIENT_EVIDENCE'
      : stockReasons.length === 0 ? 'COMPLETE' : 'INSUFFICIENT_EVIDENCE',
    reason_codes: [...new Set(reasons)], market_reason_codes: [...new Set(reasons)], stock_reason_codes: [...new Set(stockReasons)] };
}
