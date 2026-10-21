/** UNAPPROVED server-only SQL capability adapter. No registry import, approval,
 * source acquisition, SDK, credentials, UI, publication, or V1 threshold change.
 * Use the existing server Supabase client's rpc(name,args); no extra credential
 * or private PostgREST schema exposure. The SQL transaction is authority.
 * Reviewed Inline XBRL and the SEPARATE native PDF direct-quarter dialect use
 * the same ID-only transaction. Both require independent source/quality/rights
 * records and exact announcement/version proof; a parser never grants approval.
 * Unknown formats and financial canonical methods remain unsupported.
 */
export const V1_ACTUAL_CANONICAL_CONTRACT = 'V1_ACTUAL_CANONICAL_CANDIDATE_V1';
export const V1_ACTUAL_CANONICAL_FUNCTION = 'append_v1_canonical_actual_candidate_v1';
export type ActualCanonicalIds = { source_revision_id: string; row_id: string };
export type ActualCanonicalResult = ActualCanonicalIds & {
  contract: typeof V1_ACTUAL_CANONICAL_CONTRACT;
  status: 'INSERTED' | 'REPLAY'; earnings_event_id: string; audit_id: string;
  actual_only: true; v1_ready: false; member_publication_approved: false;
};
export type ActualCanonicalRpc = (name: typeof V1_ACTUAL_CANONICAL_FUNCTION,
  args: { p_source_revision_id: string; p_row_id: string }) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

/** Only serializes identifiers. Neither a shape validator nor an admission hook. */
export async function appendCanonicalActual(input: ActualCanonicalIds, rpc: ActualCanonicalRpc): Promise<ActualCanonicalResult> {
  const ids = object(input);
  if (Object.keys(ids).sort().join(',') !== 'row_id,source_revision_id' || !uuid(ids.source_revision_id) || !uuid(ids.row_id)) throw Error('ACTUAL_ID_ONLY_REQUIRED');
  // Snapshot before awaiting: later mutations cannot retarget the receipt.
  const source = ids.source_revision_id, row = ids.row_id;
  const response = await rpc(V1_ACTUAL_CANONICAL_FUNCTION, { p_source_revision_id: source, p_row_id: row });
  if (response.error) throw Error('ACTUAL_CANONICAL_RPC_DENIED');
  const result = object(response.data);
  if (result.contract !== V1_ACTUAL_CANONICAL_CONTRACT || !['INSERTED', 'REPLAY'].includes(String(result.status))
    || result.source_revision_id !== source || result.row_id !== row || !uuid(result.earnings_event_id) || !uuid(result.audit_id)
    || result.actual_only !== true || result.v1_ready !== false || result.member_publication_approved !== false) throw Error('ACTUAL_SQL_RECEIPT_INVALID');
  return { contract: V1_ACTUAL_CANONICAL_CONTRACT, status: result.status as ActualCanonicalResult['status'],
    source_revision_id: source, row_id: row, earnings_event_id: result.earnings_event_id, audit_id: result.audit_id,
    actual_only: true, v1_ready: false, member_publication_approved: false };
}
