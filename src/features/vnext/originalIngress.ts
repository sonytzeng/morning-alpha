/** Backend-only candidate port. Never imported by member/Owner browser code.
 * C identity is correlation only: no C score/status/string becomes an original
 * Condition, evidence item, quality review, permission, or member approval.
 */
import { HORIZONS, VNEXT_VERSION, hashValid, validObservationTime as validTime, compareTime, snapshotHash } from './contracts.ts';
import type { Condition, Evidence, Horizon, Observation } from './contracts.ts';
import { evaluateObservation, lockObservation } from './engine.ts';

export const ORIGINAL_INGRESS_RPC = 'ingest_vnext_original_observation_candidate_v1';
export type OriginalIngressRequest = {
  schema: 'ORIGINAL_OBSERVATION_INGRESS_1';
  c_prediction_id: string; c_lock_hash: string; symbol: string; company: string;
  horizon: Horizon; reason: string; evidence_ids: string[];
  confirmation_conditions: Condition[]; invalidation_conditions: Condition[];
  next_review_at: string; expires_at: string;
};
export type OriginalIngressReceipt = {
  replayed: boolean; observation: Observation; evidence: Evidence[];
  state: ReturnType<typeof evaluateObservation>['state'];
  lineage: { c_prediction_id: string; c_lock_hash: string; c_source_revision: string; c_generated_at: string; c_cutoff: string };
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const boundedText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 100
  && v.every(x => typeof x === 'string' && hashValid(x)) && new Set(v).size === v.length;
function conditions(v: unknown, selected: string[]): v is Condition[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every(c => object(c) && exact(c, ['text', 'state', 'evidence_ids'])
    && boundedText(c.text, 3000) && c.state === 'UNKNOWN'
    && ids(c.evidence_ids) && c.evidence_ids.every(id => selected.includes(id)));
}
export function validateOriginalIngressRequest(v: unknown): asserts v is OriginalIngressRequest {
  if (!object(v) || !exact(v, ['schema', 'c_prediction_id', 'c_lock_hash', 'symbol', 'company', 'horizon', 'reason',
    'evidence_ids', 'confirmation_conditions', 'invalidation_conditions', 'next_review_at', 'expires_at'])
    || v.schema !== 'ORIGINAL_OBSERVATION_INGRESS_1' || typeof v.c_prediction_id !== 'string'
    || !/^[a-zA-Z0-9:_-]{1,256}$/.test(v.c_prediction_id) || typeof v.c_lock_hash !== 'string' || !hashValid(v.c_lock_hash)
    || typeof v.symbol !== 'string' || !/^[0-9]{4,6}$/.test(v.symbol) || !boundedText(v.company, 200) || !boundedText(v.reason, 3000)
    || !Object.hasOwn(HORIZONS, String(v.horizon)) || !ids(v.evidence_ids)
    || !conditions(v.confirmation_conditions, v.evidence_ids) || !conditions(v.invalidation_conditions, v.evidence_ids)
    || typeof v.next_review_at !== 'string' || !validTime(v.next_review_at) || typeof v.expires_at !== 'string' || !validTime(v.expires_at)
    || new TextEncoder().encode(JSON.stringify(v)).byteLength > 65536) throw Error('ORIGINAL_REQUEST_INVALID');
}

const evidenceKeys = ['id', 'symbol', 'kind', 'source', 'source_ref', 'license_id', 'published_at', 'first_seen_at', 'available_at',
  'as_of', 'last_verified_at', 'valid_until', 'snapshot_hash', 'classification', 'quality', 'relevant', 'summary'];
function originalEvidence(v: unknown): v is Evidence {
  return object(v) && exact(v, evidenceKeys) && evidenceKeys.filter(k => k !== 'relevant').every(k => typeof v[k] === 'string')
    && typeof v.relevant === 'boolean' && typeof v.id === 'string' && hashValid(v.id)
    && Object.values(HORIZONS).some(h => (h.required as readonly string[]).includes(String(v.kind)));
}
const observationKeys = ['id', 'symbol', 'company', 'horizon', 'created_at', 'as_of', 'available_at', 'last_verified_at',
  'next_review_at', 'expires_at', 'reason', 'evidence_ids', 'confirmation_conditions', 'invalidation_conditions',
  'strategy_version', 'mode', 'snapshot_hash', 'publication_status'];

/** One fixed RPC, no automatic retries. If the reply is lost, the same request
 * key reconciles the sealed receipt; a new key may not re-create the C lock.
 * This does not register sources or grant any right to publish its response.
 */
export async function persistOriginalObservation(requestKey: string, input: OriginalIngressRequest,
  rpc: (name: typeof ORIGINAL_INGRESS_RPC, args: { p_request_key: string; p_request: OriginalIngressRequest }) => Promise<unknown>): Promise<OriginalIngressReceipt> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestKey)) throw Error('ORIGINAL_REQUEST_KEY_INVALID');
  validateOriginalIngressRequest(input);
  const request = structuredClone(input);
  const result = await rpc(ORIGINAL_INGRESS_RPC, { p_request_key: requestKey, p_request: request });
  if (!object(result) || !exact(result, ['schema', 'replayed', 'snapshot']) || result.schema !== 'ORIGINAL_OBSERVATION_RECEIPT_1'
    || typeof result.replayed !== 'boolean' || !object(result.snapshot) || !exact(result.snapshot, ['observation', 'evidence', 'state', 'lineage'])) throw Error('ORIGINAL_RECEIPT_INVALID');
  const s = result.snapshot, o = s.observation, lineage = s.lineage;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.c_prediction_id));
  const expectedId = 'original-' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (!object(o) || !exact(o, observationKeys) || !ids(o.evidence_ids)
    || observationKeys.filter(k => !['evidence_ids', 'confirmation_conditions', 'invalidation_conditions'].includes(k)).some(k => typeof o[k] !== 'string')
    || !conditions(o.confirmation_conditions, o.evidence_ids) || !conditions(o.invalidation_conditions, o.evidence_ids)
    || !Array.isArray(s.evidence) || s.evidence.length !== request.evidence_ids.length || !s.evidence.every(originalEvidence)
    || !object(lineage) || !exact(lineage, ['c_prediction_id', 'c_lock_hash', 'c_source_revision', 'c_generated_at', 'c_cutoff'])
    || lineage.c_prediction_id !== request.c_prediction_id || lineage.c_lock_hash !== request.c_lock_hash
    || typeof lineage.c_source_revision !== 'string' || !hashValid(lineage.c_source_revision)
    || typeof lineage.c_generated_at !== 'string' || !validTime(lineage.c_generated_at)
    || typeof lineage.c_cutoff !== 'string' || !validTime(lineage.c_cutoff)
    || typeof o.created_at !== 'string' || compareTime(lineage.c_cutoff, lineage.c_generated_at) > 0
    || compareTime(lineage.c_generated_at, o.created_at) > 0 || o.id !== expectedId
    || o.symbol !== request.symbol || o.horizon !== request.horizon || o.company !== request.company || o.reason !== request.reason
    || o.strategy_version !== VNEXT_VERSION || o.mode !== 'FORWARD_SHADOW' || o.publication_status !== 'RESEARCH_ONLY'
    || [...o.evidence_ids].sort().join(',') !== [...request.evidence_ids].sort().join(',')
    || typeof o.next_review_at !== 'string' || compareTime(o.next_review_at, request.next_review_at) !== 0
    || typeof o.expires_at !== 'string' || compareTime(o.expires_at, request.expires_at) !== 0
    || await snapshotHash(o.confirmation_conditions) !== await snapshotHash(request.confirmation_conditions)
    || await snapshotHash(o.invalidation_conditions) !== await snapshotHash(request.invalidation_conditions)) throw Error('ORIGINAL_RECEIPT_SCOPE_INVALID');
  // lockObservation re-checks the *original* required evidence and exact hash;
  // this is not a new scoring model or C QUALIFIED -> CONDITION_MET mapping.
  const observation = await lockObservation(o as Observation, s.evidence);
  if (s.evidence.some(e => compareTime(e.available_at, lineage.c_cutoff as string) > 0
    || compareTime(e.last_verified_at, lineage.c_cutoff as string) > 0)) throw Error('ORIGINAL_RECEIPT_CUTOFF_INVALID');
  const evaluated = evaluateObservation(observation, s.evidence, observation.created_at);
  if (s.state !== evaluated.state) throw Error('ORIGINAL_RECEIPT_STATE_INVALID');
  return { replayed: result.replayed, observation, evidence: s.evidence, state: evaluated.state,
    lineage: lineage as OriginalIngressReceipt['lineage'] };
}
