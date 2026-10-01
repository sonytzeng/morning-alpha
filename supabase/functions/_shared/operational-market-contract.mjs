// Core trust is not research completeness. Pure contract: no I/O, no strategy,
// no new provider rules, and no dependency on yesterday's publication outcome.
import { validateAtomicCheckpointEvidenceRows, checkpointBatchIdempotencyKey } from './fetch-checkpoint-evidence.mjs';

export const OPERATIONAL_MARKET_VERSION = 'OPERATIONAL_MARKET_V1';
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
const sameDay = (value, day) => Number.isFinite(time(value)) && new Date(time(value) + 8 * 3600000).toISOString().slice(0, 10) === day;
const empty = value => Array.isArray(value) && value.length === 0;

/** DB proof must be obtained from market_checkpoint_batch_integrity_v1, never
 * synthesized from a success HTTP status or the mutable market_quotes view. */
export function evaluateOperationalCore(input = {}) {
  const proof = record(input.integrity), batch = record(input.batch);
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const day = input.business_date, observed = input.observed_at;
  const reasons = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) || !sameDay(observed, day)) reasons.push('CORE_BUSINESS_DATE_INVALID');
  if (proof.contract !== 'MARKET_CHECKPOINT_ATOMICITY_V1' || proof.status !== 'PASS'
    || proof.business_date !== day || proof.checkpoint !== 'PREMARKET'
    || !uuid(proof.batch_id) || !uuid(proof.correlation_id)
    || !/^[0-9a-f]{32}$/.test(String(proof.payload_hash || ''))
    || proof.idempotency_key !== checkpointBatchIdempotencyKey(day, 'PREMARKET')) reasons.push('CORE_ATOMIC_PROOF_INVALID');
  for (const [key, expected] of Object.entries({ canonical_row_count:11, unbatched_row_count:0,
    committed_batch_count:1, distinct_batch_id_count:1, distinct_provider_count:11,
    duplicate_authoritative_provider_count:0, compatibility_row_count:11,
    compatibility_provider_count:11, compatibility_mismatch_count:0, mixed_batch_revision_count:0 })) {
    if (proof[key] !== expected) reasons.push('CORE_INTEGRITY_' + key.toUpperCase());
  }
  if (batch.status !== 'COMMITTED' || batch.business_date !== day || batch.checkpoint !== 'PREMARKET'
    || batch.market_session !== 'premarket' || batch.expected_provider_count !== 11 || batch.committed_provider_count !== 11
    || batch.provider_contract_version !== 'MARKET_CHECKPOINT_PROVIDER_V1'
    || !sameDay(batch.committed_at, day) || time(batch.committed_at) > time(observed)
    || ['batch_id','correlation_id','idempotency_key','payload_hash'].some(key => batch[key] !== proof[key])) reasons.push('CORE_COMMITTED_BATCH_INVALID');
  const rowGate = validateAtomicCheckpointEvidenceRows(rows);
  if (!rowGate.valid) reasons.push(String(rowGate.error));
  if (rows.some(value => {
    const row = record(value);
    return row.trading_date !== day || row.checkpoint !== 'PREMARKET' || row.market_session !== 'premarket'
      || row.batch_id !== proof.batch_id || row.correlation_id !== proof.correlation_id
      || row.idempotency_key !== proof.idempotency_key || !sameDay(row.captured_at, day)
      || !Number.isFinite(time(row.source_timestamp)) || time(row.source_timestamp) > time(row.captured_at)
      || time(row.captured_at) > time(batch.committed_at) || time(row.source_timestamp) > time(observed);
  })) reasons.push('CORE_ROW_IDENTITY_OR_TIME_INVALID');
  // snapshot_version is a row sequence, not the batch revision. The immutable
  // batch/correlation/payload tuple above is the authoritative revision.
  if (rows.some(value => !Number.isSafeInteger(record(value).snapshot_version) || record(value).snapshot_version < 1)) reasons.push('CORE_ROW_VERSION_INVALID');
  const reason_codes = [...new Set(reasons)];
  return { contract_version:OPERATIONAL_MARKET_VERSION, business_date:day,
    status:reason_codes.length ? 'BLOCKED' : 'READY', classification:reason_codes.length ? 'CORE_FATAL' : 'CORE_READY',
    core_evidence_revision:reason_codes.length ? null : proof.batch_id,
    source_correlation_id:proof.correlation_id ?? null, reason_codes };
}

export function classifyOperationalEnhancements({ news_count, sector_count, missing_sources = [], learning_available = true } = {}) {
  const missing = Array.isArray(missing_sources) ? missing_sources : [];
  const news = Number.isSafeInteger(news_count) && news_count > 0 ? 'AVAILABLE'
    : missing.includes('market_news:no_verified_relevant_items') ? 'UNAVAILABLE' : 'PENDING';
  const sector = Number.isSafeInteger(sector_count) && sector_count > 0 ? 'AVAILABLE'
    : missing.some(x => /sector_rotation.*pending/.test(String(x))) ? 'PENDING' : 'UNAVAILABLE';
  const allowed = /^(market_news(?::no_verified_relevant_items)?|sector_rotation_scores:\d{4}-\d{2}-\d{2}|sector_rotation_reconstruction_pending|learning_evidence)$/;
  const other = missing.filter(x => typeof x !== 'string' || !allowed.test(x));
  return { news_context:news, sector_rotation:sector, learning_evidence:learning_available ? 'AVAILABLE' : 'UNAVAILABLE',
    unknown_missing_sources:other,
    missing_evidence:[...(news === 'AVAILABLE' ? [] : ['NEWS_CONTEXT']), ...(sector === 'AVAILABLE' ? [] : ['SECTOR_ROTATION']),
      ...(other.length ? ['RESEARCH_ENHANCEMENT'] : [])] };
}

/** The unchanged company gate is the sole authority for READY/NONE/BLOCKED. */
export function operationalRecommendationStatus(gateValue) {
  const gate = record(gateValue), screening = record(gate.screening);
  if (gate.status === 'QUALIFIED' && gate.eligible === true && empty(gate.reason_codes)) return 'READY';
  if (gate.status === 'NO_QUALIFIED_OPPORTUNITY' && gate.eligible === false
    && gate.universe_evaluation_complete === true && screening.status === 'COMPLETE'
    && Number.isSafeInteger(screening.universe_count) && screening.universe_count > 0
    && screening.evaluated_count === screening.universe_count && empty(screening.rejected)) return 'NONE';
  return 'BLOCKED';
}

export function evaluateOperationalMarket(input = {}) {
  const core = evaluateOperationalCore(record(input.core));
  const enhancements = classifyOperationalEnhancements(record(input.enhancements));
  // Only the immutable 11-provider core decides fatality. An unrecognized
  // research enhancement is disclosed as unavailable, never silently FULL.
  const ready = core.status === 'READY';
  const report = !ready ? 'CORE_FATAL' : enhancements.missing_evidence.length ? 'DEGRADED' : 'FULL';
  return { contract_version:OPERATIONAL_MARKET_VERSION, business_date:core.business_date, core_market:core,
    market_decision:ready ? 'READY' : 'BLOCKED', report_level:report,
    publication_status:ready ? 'ELIGIBLE' : 'BLOCKED', enhancements,
    missing_evidence:enhancements.missing_evidence, unavailable_sections:enhancements.missing_evidence,
    confidence_impact:enhancements.missing_evidence.length ? 'CORE_ONLY_RESEARCH_LIMITED' : 'NONE',
    recommendation_status:operationalRecommendationStatus(input.recommendation_gate),
    reason_codes:[...core.reason_codes] };
}

export function operationalDocumentResult(value) {
  const document=record(value), capsule=record(document.operational_market), input=record(capsule.input), core=record(input.core);
  if(capsule.contract_version!==OPERATIONAL_MARKET_VERSION || core.business_date!==document.report_date
    || core.observed_at!==record(document.provenance).generated_at)return null;
  return evaluateOperationalMarket(input);
}

/** Availability is not an assertion of full lifecycle success or on-time SLA. */
export function evaluateOperationalAvailability(input = {}) {
  const state = record(input.operational), core = record(state.core_market);
  const published = input.publication_verified === true && ['FULL','DEGRADED'].includes(state.report_level);
  const line = input.normal_line_count === 1 && input.line_receipt_verified === true;
  const ready = core.status === 'READY' && state.market_decision === 'READY';
  return { contract_version:OPERATIONAL_MARKET_VERSION,
    dimensions:{ CORE_MARKET:ready ? 'PASS' : 'FAIL', REPORT_PUBLICATION:published ? state.report_level + '_PUBLISHED' : 'BLOCKED',
      RECOMMENDATION:['READY','NONE','BLOCKED'].includes(state.recommendation_status) ? state.recommendation_status : 'BLOCKED',
      LINE:line ? 'PASS' : 'FAIL', CLOSING:input.closing_status === 'PASS' ? 'PASS' : 'PENDING',
      LEARNING:input.learning_status === 'PASS' ? 'PASS' : 'LEARNING_DEGRADED',
      DATA_SLA:input.delivery_sla === 'PASS' ? 'PASS' : 'MISS' },
    service_available:ready && published && line };
}
