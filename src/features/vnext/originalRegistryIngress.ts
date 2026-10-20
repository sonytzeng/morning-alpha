/** BACKEND-ONLY, UNDEPLOYED CANDIDATE. An adapter for ALREADY registered and
 * independently approved Evidence, not a source/License/review creation API.
 * Trust pins and readers come from a private server-owned registry, never an
 * HTTP body. A hash proves byte identity, not origin, truth or legal permission:
 * an independent onboarding authority would need to establish those separately.
 * Real source onboarding is NOT completed by this candidate. DB administration
 * must install distinct SOURCE/QUALITY/RIGHTS authorities and immutable approval
 * versions. Pins and reviewer strings alone cannot authorize a transaction.
 * This private registeredSource adapter + SQL row-hash check is NOT a formal V1
 * publisher and does NOT establish approved production data. Its ONLY output
 * path is the original research-only Observation; no source scope is expanded.
 * No Worker/browser imports this module and no production caller is activated.
 */
import { HORIZONS, compareTime, hashValid, snapshotHash, sourceSafe, validObservationTime } from './contracts.ts';
import type { Evidence, License } from './contracts.ts';
import { evidenceIssues } from './engine.ts';
import { persistOriginalObservation, validateOriginalIngressRequest } from './originalIngress.ts';
import type { OriginalIngressReceipt, OriginalIngressRequest } from './originalIngress.ts';

export type OriginalSourceReceipt = {
  schema: 'ORIGINAL_RETAINED_SOURCE_RECEIPT_1'; id: string;
  source: string; source_ref: string; raw_sha256: string; captured_by: string;
  published_at: string; first_seen_at: string; available_at: string; as_of: string;
};
export type OriginalSourceReview = {
  purpose: 'SOURCE_QUALITY' | 'PRIVATE_STORAGE_DERIVATION'; result: 'PASS' | 'FAIL' | 'PENDING';
  reviewer_ref: string; reviewed_at: string; expires_at: string; document_hash: string;
  evidence_hash: string; receipt_hash: string; license_hash: string;
};
export type ApprovedOriginalRegistryRecord = {
  schema: 'ORIGINAL_APPROVED_REGISTRY_RECORD_1'; evidence: Evidence; license: License;
  receipt: OriginalSourceReceipt; quality_review: OriginalSourceReview; rights_review: OriginalSourceReview;
};
export type OriginalRegistryPin = { evidence_id: string; record_hash: string; approval_id: string };
/** Fixed, reusable source metadata, NOT a publication permission or raw artifact.
 * Produced only after pin/byte/review checks, bound to the exact Evidence ID.
 * Kept outside ORIGINAL_OBSERVATION_RECEIPT_1 so its SQL contract is unchanged.
 * "Verified" means checked against supplied private pins, NOT onboarded source
 * authority, approved production data, or formal V1 publication clearance.
 */
export type VerifiedOriginalSourceReceipt = {
  schema: 'ORIGINAL_VERIFIED_SOURCE_RECEIPT_1'; evidence_id: string; registry_record_hash: string; approval_id: string;
  evidence_snapshot_hash: string; evidence_record_hash: string; license_record_hash: string; receipt_hash: string; raw_sha256: string;
  quality_document_hash: string; rights_document_hash: string; license_id: string; license_hash: string;
  source: string; source_ref: string; published_at: string; first_seen_at: string; available_at: string;
  as_of: string; last_verified_at: string; use: 'PRIVATE_STORAGE_DERIVATION'; member_publication: false;
};
export type OriginalRegistryIngressReceipt = OriginalIngressReceipt & { source_receipts: VerifiedOriginalSourceReceipt[] };
export const ORIGINAL_REGISTRY_INGRESS_RPC = 'ingest_vnext_original_registry_candidate_v1';
export type OriginalRegistrySourceExpectation = Pick<VerifiedOriginalSourceReceipt, 'evidence_id' | 'evidence_record_hash' | 'license_record_hash' | 'approval_id' | 'registry_record_hash'>;
export const ORIGINAL_REGISTRY_READ_RPC = 'read_original_registry_source_candidate_v1';
export type OriginalRegistryReadRpc = (name: typeof ORIGINAL_REGISTRY_READ_RPC,
  args: { p_evidence_id: string; p_version_id: string }) => Promise<unknown>;
/** Fixed two-ID server reader. No latest-row fallback, caller approval or data.
 * SQL performs current authority/expiry/revocation checks; the writer repeats
 * them atomically, so this read is NOT a reusable authorization capability.
 */
export function createOriginalRegistryApprovedReader(pins: readonly OriginalRegistryPin[], rpc: OriginalRegistryReadRpc) {
  const versions = new Map(pins.map(p => [p.evidence_id, p.approval_id]));
  return (id: string) => {
    const version = versions.get(id);
    if (!version || !hashValid(id) || !uuid(version)) throw Error('ORIGINAL_REGISTRY_NOT_APPROVED');
    return rpc(ORIGINAL_REGISTRY_READ_RPC, { p_evidence_id: id, p_version_id: version });
  };
}
export type OriginalRegistryRpc = (name: typeof ORIGINAL_REGISTRY_INGRESS_RPC, args: {
  p_request_key: string; p_request: OriginalIngressRequest; p_sources: OriginalRegistrySourceExpectation[];
}) => Promise<unknown>;
export type OriginalRegistryPorts = {
  // Exact reviewed record digests, provisioned independently of the producer.
  pins: readonly OriginalRegistryPin[]; producer_ref: string;
  capture_issuers: readonly string[]; quality_reviewers: readonly string[]; rights_reviewers: readonly string[];
  // Must read the CURRENT approved registry: null on revoked/missing approval.
  // Never fall back to an unreviewed archive or to a previous cached PASS.
  readApproved: (evidenceId: string) => Promise<unknown>;
  readArtifact: (sha256: string) => Promise<Uint8Array>;
  now: () => string;
  rpc: OriginalRegistryRpc;
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length
  && keys.every(k => Object.hasOwn(v, k));
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 3000;
const hash = (v: unknown): v is string => typeof v === 'string' && hashValid(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const time = (v: unknown): v is string => typeof v === 'string' && validObservationTime(v);
const evidenceTimes = ['published_at', 'first_seen_at', 'available_at', 'as_of', 'last_verified_at', 'valid_until'] as const;
/** Same UTC/microsecond envelope as original_iso_v1; never round via Date.parse
 * before extracting the fraction. These hashes bind the EXISTING SQL rows.
 */
function registryIso(value: string): string {
  if (!time(value)) throw Error('ORIGINAL_REGISTRY_TIME_INVALID');
  const fraction = /\.(\d{1,6})(?=Z$|[+-]\d\d:\d\d$)/.exec(value)?.[1] ?? '';
  const seconds = value.replace(/\.\d{1,6}(?=Z$|[+-]\d\d:\d\d$)/, '');
  const utc = new Date(seconds).toISOString();
  if (utc.length !== 24 || utc.startsWith('0000')) throw Error('ORIGINAL_REGISTRY_TIME_INVALID');
  return utc.slice(0, 19) + '.' + fraction.padEnd(6, '0') + 'Z';
}
export async function originalRegistryRowHashes(evidence: Evidence, license: License) {
  return { evidence_record_hash: await snapshotHash({ ...evidence, ...Object.fromEntries(evidenceTimes.map(k => [k, registryIso(evidence[k])])) }),
    license_record_hash: await snapshotHash({ ...license, reviewed_at: registryIso(license.reviewed_at),
      expires_at: license.expires_at === null ? null : registryIso(license.expires_at) }) };
}
const evidenceKeys = ['id', 'symbol', 'kind', 'source', 'source_ref', 'license_id', ...evidenceTimes,
  'snapshot_hash', 'classification', 'quality', 'relevant', 'summary'] as const;
function evidenceShape(v: unknown): v is Evidence {
  return record(v) && exact(v, evidenceKeys) && evidenceKeys.filter(k => k !== 'relevant').every(k => text(v[k]))
    && typeof v.relevant === 'boolean' && hash(v.id) && hash(v.snapshot_hash) && /^\d{4,6}$/.test(v.symbol as string)
    && evidenceTimes.every(k => time(v[k]))
    && Object.values(HORIZONS).some(h => (h.required as readonly string[]).includes(v.kind as string));
}
function licenseShape(v: unknown): v is License {
  return record(v) && exact(v, ['id', 'source', 'document_url', 'reviewed_at', 'storage', 'derived',
    'commercial', 'redistribution', 'attribution', 'expires_at'])
    && ['id', 'source', 'document_url', 'attribution'].every(k => text(v[k]))
    && ['storage', 'derived', 'commercial', 'redistribution'].every(k => typeof v[k] === 'boolean')
    && time(v.reviewed_at) && (v.expires_at === null || time(v.expires_at)) && sourceSafe(v.document_url as string);
}
function receiptShape(v: unknown): v is OriginalSourceReceipt {
  return record(v) && exact(v, ['schema', 'id', 'source', 'source_ref', 'raw_sha256', 'captured_by',
    'published_at', 'first_seen_at', 'available_at', 'as_of']) && v.schema === 'ORIGINAL_RETAINED_SOURCE_RECEIPT_1'
    && hash(v.id) && hash(v.raw_sha256) && ['source', 'source_ref', 'captured_by'].every(k => text(v[k]))
    && ['published_at', 'first_seen_at', 'available_at', 'as_of'].every(k => time(v[k]));
}
function reviewShape(v: unknown): v is OriginalSourceReview {
  return record(v) && exact(v, ['purpose', 'result', 'reviewer_ref', 'reviewed_at', 'expires_at', 'document_hash',
    'evidence_hash', 'receipt_hash', 'license_hash']) && text(v.reviewer_ref) && time(v.reviewed_at) && time(v.expires_at)
    && ['document_hash', 'evidence_hash', 'receipt_hash', 'license_hash'].every(k => hash(v[k]));
}
function sameEvidence(left: Evidence, right: Evidence): boolean {
  return evidenceKeys.every(k => evidenceTimes.includes(k as typeof evidenceTimes[number])
    ? compareTime(left[k] as string, right[k] as string) === 0 : left[k] === right[k]);
}
async function artifact(hash: string, read: OriginalRegistryPorts['readArtifact']) {
  const source = await read(hash);
  if (!(source instanceof Uint8Array) || source.byteLength === 0 || source.byteLength > 12_000_000)
    throw Error('ORIGINAL_REGISTRY_ARTIFACT_INVALID');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(source));
  if ([...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('') !== hash)
    throw Error('ORIGINAL_REGISTRY_ARTIFACT_HASH_MISMATCH');
}

/** Does not persist an unregistered source or convert C QUALIFIED into a
 * recommendation. Reuses the existing atomic RPC/immutable sealed receipt.
 * Every call re-reads approval and artifacts (including an explicit retry).
 * Transport/receipt failures have unknown commit status: no retry or new key.
 */
export function createOriginalRegistryIngress(ports: OriginalRegistryPorts) {
  if (!text(ports.producer_ref) || !Array.isArray(ports.pins) || !ports.pins.length
    || !ports.pins.every(p => record(p) && exact(p, ['evidence_id', 'record_hash', 'approval_id']) && hash(p.evidence_id) && hash(p.record_hash) && uuid(p.approval_id)))
    throw Error('ORIGINAL_REGISTRY_CONFIG_INVALID');
  const pins = new Map(ports.pins.map(p => [p.evidence_id, p.record_hash]));
  const versions = new Map(ports.pins.map(p => [p.evidence_id, p.approval_id]));
  if (pins.size !== ports.pins.length) throw Error('ORIGINAL_REGISTRY_PIN_COLLISION');
  const principals = [ports.capture_issuers, ports.quality_reviewers, ports.rights_reviewers];
  if (principals.some(a => !Array.isArray(a) || !a.length || a.some(v => !text(v)) || new Set(a).size !== a.length))
    throw Error('ORIGINAL_REGISTRY_CONFIG_INVALID');
  // Capture configuration once; callers cannot mutate approval pins/principals
  // while a read is suspended. Readers themselves remain live for revocation.
  const [issuers, qualityReviewers, rightsReviewers] = principals.map(a => new Set(a));
  const { readApproved, readArtifact, now, rpc, producer_ref: producer } = ports;
  return async (requestKey: string, input: OriginalIngressRequest): Promise<OriginalRegistryIngressReceipt> => {
    validateOriginalIngressRequest(input);
    const request = structuredClone(input), at = now();
    if (!time(at)) throw Error('ORIGINAL_REGISTRY_TIME_INVALID');
    const selected: Evidence[] = [], sourceReceipts: VerifiedOriginalSourceReceipt[] = [], permitUntil: string[] = [];
    for (const id of request.evidence_ids) {
      if (!pins.has(id)) throw Error('ORIGINAL_REGISTRY_NOT_APPROVED');
      const loaded = await readApproved(id);
      if (!record(loaded) || !exact(loaded, ['schema', 'evidence', 'license', 'receipt', 'quality_review', 'rights_review'])
        || loaded.schema !== 'ORIGINAL_APPROVED_REGISTRY_RECORD_1' || !evidenceShape(loaded.evidence)
        || !licenseShape(loaded.license) || !receiptShape(loaded.receipt)
        || !reviewShape(loaded.quality_review) || !reviewShape(loaded.rights_review)) throw Error('ORIGINAL_REGISTRY_RECORD_INVALID');
      const r = structuredClone(loaded) as ApprovedOriginalRegistryRecord;
      if (await snapshotHash(r) !== pins.get(id)) throw Error('ORIGINAL_REGISTRY_PIN_MISMATCH');
      const e = r.evidence, l = r.license, receipt = r.receipt;
      const { id: receiptId, ...receiptBody } = receipt;
      if (e.id !== id || e.symbol !== request.symbol || evidenceIssues(e, at).length
        || receiptId !== await snapshotHash(receiptBody) || !issuers.has(receipt.captured_by)
        || receipt.source !== e.source || receipt.source_ref !== e.source_ref
        || (['published_at', 'first_seen_at', 'available_at', 'as_of'] as const).some(k => compareTime(receipt[k], e[k]) !== 0))
        throw Error('ORIGINAL_REGISTRY_SOURCE_INVALID');
      if (l.id !== e.license_id || l.source !== e.source || !l.storage || !l.derived || !sourceSafe(l.document_url)
        || compareTime(l.reviewed_at, e.last_verified_at) > 0
        || (l.expires_at !== null && compareTime(l.expires_at, at) <= 0)) throw Error('ORIGINAL_REGISTRY_RIGHTS_INVALID');
      const evidenceHash = await snapshotHash(e), licenseHash = await snapshotHash(l);
      for (const [review, purpose, reviewers] of [
        [r.quality_review, 'SOURCE_QUALITY', qualityReviewers],
        [r.rights_review, 'PRIVATE_STORAGE_DERIVATION', rightsReviewers],
      ] as const) {
        if (review.purpose !== purpose || review.result !== 'PASS' || !reviewers.has(review.reviewer_ref)
          || review.reviewer_ref === producer || review.reviewer_ref === receipt.captured_by
          || r.quality_review.reviewer_ref === r.rights_review.reviewer_ref
          || review.evidence_hash !== evidenceHash || review.receipt_hash !== receiptId || review.license_hash !== licenseHash
          || compareTime(review.reviewed_at, e.available_at) < 0 || compareTime(review.reviewed_at, l.reviewed_at) < 0
          || compareTime(review.reviewed_at, e.last_verified_at) > 0 || compareTime(review.expires_at, at) <= 0)
          throw Error('ORIGINAL_REGISTRY_INDEPENDENT_REVIEW_INVALID');
      }
      // Neither a plausible URL nor a hex digest is a retained receipt. Require
      // the exact pinned raw bytes AND the separately reviewed documents.
      for (const digest of new Set([receipt.raw_sha256, r.quality_review.document_hash, r.rights_review.document_hash]))
        await artifact(digest, readArtifact);
      selected.push(e);
      permitUntil.push(r.quality_review.expires_at, r.rights_review.expires_at);
      if (l.expires_at !== null) permitUntil.push(l.expires_at);
      sourceReceipts.push({ schema: 'ORIGINAL_VERIFIED_SOURCE_RECEIPT_1', evidence_id: id, registry_record_hash: pins.get(id)!,
        approval_id: versions.get(id)!,
        evidence_snapshot_hash: e.snapshot_hash, ...await originalRegistryRowHashes(e, l), receipt_hash: receiptId, raw_sha256: receipt.raw_sha256,
        quality_document_hash: r.quality_review.document_hash, rights_document_hash: r.rights_review.document_hash,
        license_id: l.id, license_hash: licenseHash, source: e.source, source_ref: e.source_ref,
        published_at: e.published_at, first_seen_at: e.first_seen_at, available_at: e.available_at, as_of: e.as_of,
        last_verified_at: e.last_verified_at, use: 'PRIVATE_STORAGE_DERIVATION', member_publication: false });
    }
    if (HORIZONS[request.horizon].required.some(kind => !selected.some(e => e.kind === kind && e.classification === 'CONFIRMED_FACT')))
      throw Error('ORIGINAL_REGISTRY_HORIZON_INCOMPLETE');
    const beforeWrite = now();
    if (!time(beforeWrite) || compareTime(beforeWrite, at) < 0) throw Error('ORIGINAL_REGISTRY_TIME_INVALID');
    // Bound the asynchronous artifact-read window; an expired review must not
    // become permission to start a write merely because it was fresh on entry.
    for (const e of selected) if (evidenceIssues(e, beforeWrite).length) throw Error('ORIGINAL_REGISTRY_SOURCE_INVALID');
    if (permitUntil.some(t => compareTime(t, beforeWrite) <= 0)) throw Error('ORIGINAL_REGISTRY_REVIEW_EXPIRED_DURING_READ');
    const result = await persistOriginalObservation(requestKey, request, (_name, args) => rpc(ORIGINAL_REGISTRY_INGRESS_RPC, {
      ...args, p_sources: sourceReceipts.map(({ evidence_id, evidence_record_hash, license_record_hash, approval_id, registry_record_hash }) =>
        ({ evidence_id, evidence_record_hash, license_record_hash, approval_id, registry_record_hash })),
    }));
    if (result.evidence.some(e => !selected.some(s => sameEvidence(e, s))))
      throw Error('ORIGINAL_REGISTRY_COMMITTED_EVIDENCE_MISMATCH');
    // Microsecond cutoff and original required kinds are still authoritative in
    // the unchanged SQL and original engine. No new numerical market thresholds.
    return { ...result, source_receipts: sourceReceipts };
  };
}
