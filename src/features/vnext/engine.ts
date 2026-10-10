import { HORIZONS, FROZEN_V1_REF, hashValid, snapshotHash, sourceSafe, validTime } from './contracts.ts';
import type { Evidence, EventRevision, Horizon, License, Observation, ObservationState, Projection, SupplyRelation } from './contracts.ts';
const t = Date.parse;
const unique = (ids: string[]) => new Set(ids).size === ids.length;

/** Availability is never inferred from a publication date or candle date. */
export function evidenceIssues(e: Evidence, cutoff: string): string[] {
  const issues: string[] = [];
  if (!e.id || !e.symbol || !e.source || !sourceSafe(e.source_ref) || !hashValid(e.snapshot_hash)) issues.push('SOURCE_LINEAGE_INVALID');
  const stamps = [cutoff, e.published_at, e.first_seen_at, e.available_at, e.as_of, e.last_verified_at, e.valid_until];
  if (!stamps.every(validTime)) return [...issues, 'TIME_INVALID'];
  if (t(e.as_of) > t(e.published_at) || t(e.published_at) > t(e.available_at) || t(e.first_seen_at) > t(e.available_at)
      || t(e.available_at) > t(cutoff) || t(e.last_verified_at) > t(cutoff) || t(e.last_verified_at) < t(e.available_at)) issues.push('POINT_IN_TIME_INVALID');
  if (t(e.valid_until) <= t(cutoff)) issues.push('STALE_EVIDENCE');
  if (e.quality !== 'PASS') issues.push('QUALITY_REJECTED');
  if (!e.relevant) issues.push('RELEVANCE_REJECTED');
  if (!['CONFIRMED_FACT', 'REPORTED_CLAIM', 'INFERENCE', 'UNVERIFIED'].includes(e.classification)) issues.push('CLASSIFICATION_INVALID');
  return issues;
}

export function eventTimeline(rows: EventRevision[], cutoff: string) {
  if (!validTime(cutoff)) throw Error('CUTOFF_INVALID');
  const events = new Map<string, EventRevision[]>();
  for (const row of rows) {
    if (![row.published_at, row.first_seen_at, row.available_at, row.last_verified_at].every(validTime)
      || !row.event_id || !row.source || !row.source_event_id || !row.title || !row.invalidation
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || !hashValid(row.snapshot_hash)
      || !row.evidence_ids.length || !unique(row.evidence_ids) || !row.affected_companies.length
      || !['CONFIRMED_FACT', 'REPORTED_CLAIM', 'INFERENCE', 'UNVERIFIED'].includes(row.classification)
      || !row.expected_horizons.length || row.expected_horizons.some(h => !Object.hasOwn(HORIZONS, h))
      || t(row.available_at) < Math.max(t(row.published_at), t(row.first_seen_at))
      || t(row.last_verified_at) < t(row.available_at)) throw Error('EVENT_INVALID');
    if (t(row.available_at) > t(cutoff) || t(row.last_verified_at) > t(cutoff)) continue;
    const revisions = events.get(row.event_id) ?? [];
    if (revisions.some(r => r.source !== row.source || r.source_event_id !== row.source_event_id)) throw Error('EVENT_ID_COLLISION');
    const prior = revisions.find(r => r.revision === row.revision);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw Error('IMMUTABLE_REVISION_CONFLICT');
    if (!prior) revisions.push(structuredClone(row));
    events.set(row.event_id, revisions);
  }
  return [...events.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([event_id, revisions]) => {
    const timeline = revisions.sort((a, b) => a.revision - b.revision);
    if (timeline.some((r, i) => i > 0 && t(r.available_at) < t(timeline[i - 1].available_at))) throw Error('EVENT_REVISION_TIME_REVERSED');
    return { event_id, timeline, current: timeline[timeline.length - 1], distinct_event_count: 1 };
  });
}

export function supplyRelationStatus(row: SupplyRelation, evidence: Evidence[], cutoff: string) {
  if (!validTime(cutoff) || ![row.observed_at, row.available_at, row.valid_from].every(validTime)
    || (row.valid_to !== null && !validTime(row.valid_to)) || !row.id || !row.from || !row.to || row.from === row.to || !row.source
    || !['CUSTOMER', 'SUPPLIER', 'COMPETITOR', 'PRODUCT', 'INDUSTRY'].includes(row.type)
    || t(row.available_at) < t(row.observed_at) || t(row.available_at) > t(cutoff)
    || t(row.valid_from) > t(cutoff) || (row.valid_to !== null && t(row.valid_to) <= t(cutoff))
    || row.verification_status !== 'VERIFIED' || row.confidence !== 'DOCUMENTED'
    || !row.evidence_ids.length || !unique(row.evidence_ids)) return 'UNKNOWN';
  if (row.revenue_exposure !== null && (!Number.isFinite(row.revenue_exposure) || row.revenue_exposure < 0 || row.revenue_exposure > 1)) return 'UNKNOWN';
  return row.evidence_ids.every(id => {
    const matches = evidence.filter(e => e.id === id);
    return matches.length === 1 && matches[0].kind === 'SUPPLY_CHAIN' && matches[0].source === row.source && [row.from, row.to].includes(matches[0].symbol)
      && matches[0].classification === 'CONFIRMED_FACT' && evidenceIssues(matches[0], cutoff).length === 0;
  }) ? 'SUPPORTED_RELATION_NOT_PRICE_FORECAST' : 'UNKNOWN';
}

export function evaluateObservation(o: Observation, evidence: Evidence[], now: string) {
  const issues: string[] = [];
  if (!Object.hasOwn(HORIZONS, o.horizon)) return { state: 'WATCHING' as ObservationState, issues: ['HORIZON_INVALID'], eligible: false };
  if (![now, o.created_at, o.as_of, o.available_at, o.last_verified_at, o.next_review_at, o.expires_at].every(validTime)
    || t(o.as_of) > t(o.available_at) || t(o.available_at) > t(o.created_at)
    || t(o.last_verified_at) > t(o.created_at) || t(o.last_verified_at) < t(o.available_at)
    || t(o.next_review_at) <= t(o.created_at) || t(o.expires_at) <= t(o.created_at) || t(o.created_at) > t(now)) issues.push('OBSERVATION_TIME_INVALID');
  if (!o.id || !o.symbol || !o.company || !o.reason || !o.strategy_version || !hashValid(o.snapshot_hash)) issues.push('OBSERVATION_LINEAGE_INVALID');
  if (!o.evidence_ids.length || !unique(o.evidence_ids) || !unique(evidence.map(e => e.id))) issues.push('EVIDENCE_ID_INVALID');
  const selected = o.evidence_ids.map(id => evidence.find(e => e.id === id));
  if (selected.some(e => !e || e.symbol !== o.symbol)) issues.push('MISSING_OR_WRONG_SYMBOL_EVIDENCE');
  const usable = selected.filter((e): e is Evidence => !!e && e.symbol === o.symbol);
  for (const e of usable) issues.push(...evidenceIssues(e, o.created_at));
  for (const kind of HORIZONS[o.horizon].required) {
    if (!usable.some(e => e.kind === kind && e.classification === 'CONFIRMED_FACT' && evidenceIssues(e, o.created_at).length === 0)) issues.push('MISSING_' + kind);
  }
  const conditions = [...o.confirmation_conditions, ...o.invalidation_conditions];
  if (!o.confirmation_conditions.length || !o.invalidation_conditions.length || conditions.some(c => !c.text || !['CONFIRMED', 'NOT_MET', 'UNKNOWN'].includes(c.state)
    || !c.evidence_ids.length || !unique(c.evidence_ids) || c.evidence_ids.some(id => !o.evidence_ids.includes(id)))) issues.push('CONDITIONS_UNTRACEABLE');
  let state: ObservationState = 'WATCHING';
  if (validTime(now) && validTime(o.expires_at) && t(now) >= t(o.expires_at)) state = 'EXPIRED';
  else if (issues.length === 0 && o.invalidation_conditions.some(c => c.state === 'CONFIRMED')) state = 'INVALIDATED';
  else if (issues.length === 0 && o.confirmation_conditions.every(c => c.state === 'CONFIRMED') && o.invalidation_conditions.every(c => c.state === 'NOT_MET')) state = 'CONDITION_MET';
  if (validTime(now) && validTime(o.next_review_at) && t(now) >= t(o.next_review_at)) issues.push('REVIEW_OVERDUE');
  return { state, issues: [...new Set(issues)], eligible: issues.length === 0 && !['EXPIRED', 'INVALIDATED'].includes(state) };
}

/** Server only policy input. Client tier never authorizes this projection. */
export function publicationGate(o: Observation, evidence: Evidence[], licenses: License[], policy: {
  now: string; approved_snapshot_hash: string | null; approval_at: string | null;
  content_kind: 'RESEARCH_OBSERVATION'; audience: 'free' | 'premium';
}) {
  const result = evaluateObservation(o, evidence, policy.now), issues = [...result.issues];
  if (!result.eligible) issues.push('OBSERVATION_NOT_ELIGIBLE');
  if (policy.content_kind !== 'RESEARCH_OBSERVATION' || o.mode !== 'FORWARD_SHADOW') issues.push('RESEARCH_CLASSIFICATION_REQUIRED');
  if (o.publication_status !== 'APPROVED' || policy.approved_snapshot_hash !== o.snapshot_hash
    || !policy.approval_at || !validTime(policy.approval_at) || t(policy.approval_at) < t(o.created_at) || t(policy.approval_at) > t(policy.now)) issues.push('PUBLICATION_NOT_APPROVED');
  const copy = [o.reason, ...o.confirmation_conditions.map(c => c.text), ...o.invalidation_conditions.map(c => c.text)].join(' ');
  if (/保證|穩賺|必漲|必賺|高勝率|正式推薦|買進訊號/.test(copy)) issues.push('MISLEADING_COPY');
  for (const id of o.evidence_ids) {
    const e = evidence.find(item => item.id === id), matches = licenses.filter(l => l.id === e?.license_id && l.source === e?.source);
    const l = matches.length === 1 ? matches[0] : null;
    if (!l || !l.storage || !l.derived || !l.commercial || !l.redistribution || !l.attribution || !sourceSafe(l.document_url)
      || !validTime(l.reviewed_at) || t(l.reviewed_at) > t(policy.now) || (l.expires_at !== null && (!validTime(l.expires_at) || t(l.expires_at) <= t(policy.now)))) issues.push('LICENSE_NOT_CLEARED');
  }
  return { allowed: issues.length === 0, issues: [...new Set(issues)], state: result.state };
}

export function projectObservation(o: Observation, evidence: Evidence[], state: ObservationState): Projection {
  return { id: o.id, symbol: o.symbol, company: o.company, horizon: o.horizon, status: state, reason: o.reason,
    mode:o.mode, created_at:o.created_at, as_of:o.as_of,
    confirmation: o.confirmation_conditions.map(c => c.text), invalidation: o.invalidation_conditions.map(c => c.text), next_review_at: o.next_review_at,
    evidence: o.evidence_ids.flatMap(id => { const e = evidence.find(row => row.id === id); return e ? [{ summary: e.summary, source: e.source,
      source_ref: e.source_ref, available_at: e.available_at, classification: e.classification }] : []; }) };
}

export async function lockObservation(o: Observation, evidence: Evidence[]) {
  const { snapshot_hash: _, ...payload } = o;
  const expected = await snapshotHash({ observation: payload, evidence: evidence.filter(e => o.evidence_ids.includes(e.id)).sort((a, b) => a.id.localeCompare(b.id)) });
  if (o.snapshot_hash !== expected) throw Error('SNAPSHOT_MISMATCH');
  if (evaluateObservation(o, evidence, o.created_at).issues.length) throw Error('OBSERVATION_INVALID');
  return structuredClone(o); // Persistence is append-only; this is not a write API.
}

export type ValidationCoverage = {
  point_in_time: boolean; historical_universe: boolean; corporate_actions: boolean;
  executable_prices: boolean; cost_model_version: string | null; regimes: string[];
  frozen_v1_ref: string; available_sessions: number; train_end: string; validation_start: string;
  validation_end: string; oos_start: string; oos_end: string; frozen_at: string;
  baselines: string[]; walk_forward: boolean;
};
export function validationReadiness(horizon: Horizon, c: ValidationCoverage) {
  const required = HORIZONS[horizon].outcomes.at(-1)!;
  const issues: string[] = [];
  for (const field of ['point_in_time', 'historical_universe', 'corporate_actions', 'executable_prices', 'walk_forward'] as const) if (!c[field]) issues.push(field.toUpperCase());
  if (!c.cost_model_version) issues.push('COST_MODEL_MISSING');
  if (c.frozen_v1_ref !== FROZEN_V1_REF) issues.push('FROZEN_V1_DRIFT');
  if (!Number.isSafeInteger(c.available_sessions) || c.available_sessions <= required) issues.push('HISTORY_INSUFFICIENT');
  if (!['TAIEX', 'RANDOM_ELIGIBLE', 'MOMENTUM', 'FROZEN_V1', 'CANDIDATE'].every(x => c.baselines.includes(x))) issues.push('BASELINES_INCOMPLETE');
  if (!['UP', 'DOWN', 'RANGE'].every(x => c.regimes.includes(x))) issues.push('REGIMES_INCOMPLETE');
  if (![c.train_end, c.validation_start, c.validation_end, c.oos_start, c.oos_end, c.frozen_at].every(validTime)
    || !(t(c.train_end) < t(c.validation_start) && t(c.validation_start) <= t(c.validation_end)
    && t(c.validation_end) < t(c.oos_start) && t(c.oos_start) <= t(c.oos_end) && t(c.frozen_at) < t(c.oos_start))) issues.push('SPLIT_LEAKAGE');
  return { data_ready: issues.length === 0, issues, BACKTEST_VALIDITY: issues.length ? 'INSUFFICIENT' : 'READY_FOR_EXECUTION', SIGNAL_EDGE: 'UNPROVEN', metrics: null };
}
