import { evaluateResearchQualityGate } from './research-quality-gate.ts';

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const validatedEvidenceIds = (value: unknown): string[] | null => Array.isArray(value) && value.length > 0
  && value.every(id => typeof id === 'string' && Boolean(id.trim()))
  ? [...new Set(value as string[])].sort() : null;

/** Optional public provenance, not evidence admission or publication authority.
 * Preserve only an existing complete source label, HTTPS URL and timestamp.
 * Query/fragment URLs are deliberately unsupported: their parameters can carry
 * credentials under arbitrary names. Never strip them and invent a new URL.
 */
export function publicResearchSourceMetadata(value: unknown): {
  title: string; url: string; published_at: string;
} | null {
  const source = record(value);
  const title = source.title, url = source.url, publishedAt = source.published_at;
  if (typeof title !== 'string' || !title.trim() || typeof url !== 'string'
    || !/^https:\/\//i.test(url) || /[\u0000-\u0020\u007f\\?#]/.test(url)
    || typeof publishedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(publishedAt)
    || !Number.isFinite(Date.parse(publishedAt))) return null;
  // Date.parse normalizes impossible calendar dates such as February 30.
  const calendarDate = publishedAt.slice(0, 10);
  if (new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDate) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password
      || parsed.search || parsed.hash) return null;
  } catch {
    return null;
  }
  return { title, url, published_at: publishedAt };
}

/** These are the actual buildEvidenceIndex producer contexts. A missing or
 * unknown label is not affirmative freshness evidence; prior report/sector
 * context cannot relabel an ordinary market or news source as current. */
function marketSourceFreshnessVerified(source: JsonRecord, reportDate: string): boolean {
  const freshness = typeof source.freshness === 'string' ? source.freshness.trim().toLowerCase() : '';
  const priorContext = typeof source.source_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.source_date)
    && source.source_date < reportDate;
  if (source.source === 'sector_rotation_scores') return freshness === 'previous_trading_day' && priorContext;
  if (source.source === 'reports') return freshness === 'previous_report' && priorContext;
  return freshness === 'fresh' || freshness === 'recent';
}

export interface CanonicalMarketState {
  schema_version: 'CANONICAL_MARKET_STATE_V1';
  report_date: string;
  today_date: string;
  generated_at: string;
  data_as_of: string | null;
  status: 'READY' | 'INSUFFICIENT_EVIDENCE';
  document: JsonRecord;
  evidence_ids: string[];
  reason_codes: string[];
}

/** The market document is independently assembled and audited by the producer.
 * Never filter a failed research quality counter here or promote its score.
 * Once the canonical field exists, invalid input cannot fall through to legacy.
 */
export function canonicalMarketDocument(value: unknown): JsonRecord {
  const ai = record(value);
  if (!Object.hasOwn(ai, 'canonical_market_state')) return record(ai.research_master_v2);
  const state = record(ai.canonical_market_state), document = record(state.document);
  const provenance = record(document.provenance);
  const claims = record(record(document.quality).coverage_audit).claims;
  const claimIds = Array.isArray(claims) ? claims.map(claim => validatedEvidenceIds(record(claim).evidence_ids)) : [];
  const expectedIds = claimIds.length > 0 && claimIds.every(ids => ids !== null)
    ? [...new Set(claimIds.flatMap(ids => ids || []))].sort() : null;
  const stateIds = validatedEvidenceIds(state.evidence_ids);
  if (state.schema_version !== 'CANONICAL_MARKET_STATE_V1'
    || state.report_date !== document.report_date || state.today_date !== document.today_date
    || state.report_date !== state.today_date || state.generated_at !== provenance.generated_at
    || state.data_as_of !== document.data_as_of || !expectedIds || !stateIds
    || (state.evidence_ids as unknown[]).length !== stateIds.length
    || JSON.stringify(stateIds) !== JSON.stringify(expectedIds)) return {};
  return document;
}

export function buildCanonicalMarketState(documentValue: unknown): CanonicalMarketState {
  const document = record(documentValue), quality = evaluateResearchQualityGate(document);
  const audit = record(record(document.quality).coverage_audit);
  const claims = Array.isArray(audit.claims) ? audit.claims.map(record) : [];
  const reasons = [...quality.reason_codes];
  if (audit.contract_version !== 'CLAIM_EVIDENCE_LEDGER_V1' || !claims.length
    || audit.denominator !== claims.length || audit.numerator !== claims.length
    || claims.some(claim => claim.scope !== 'market' || claim.supported !== true
      || !Array.isArray(claim.evidence_ids) || !claim.evidence_ids.length
      || !Array.isArray(claim.reason_codes) || claim.reason_codes.length > 0)) reasons.push('market_claim_ledger_incomplete');
  const stocks = record(document.sections).representative_stocks;
  if (!Array.isArray(stocks) || stocks.length > 0) reasons.push('stock_claim_in_market_document');
  if (document.report_date !== document.today_date || document.timezone !== 'Asia/Taipei') reasons.push('market_date_mismatch');
  const provenance = record(document.provenance);
  if (typeof provenance.generated_at !== 'string' || !Number.isFinite(Date.parse(provenance.generated_at))) reasons.push('market_generation_time_missing');
  const generatedAt = Date.parse(String(provenance.generated_at || ''));
  for (const claim of claims) {
    const sources = Array.isArray(claim.sources) ? claim.sources.map(record) : [];
    const ids = validatedEvidenceIds(claim.evidence_ids), sourceIds = validatedEvidenceIds(sources.map(source => source.evidence_id));
    if (!ids || !sourceIds || JSON.stringify(ids) !== JSON.stringify(sourceIds)) reasons.push('market_claim_source_id_mismatch');
    if (!sources.length || sources.some(source => typeof source.source !== 'string' || !source.source.trim()
      || typeof source.source_date !== 'string' || !Number.isFinite(Date.parse(source.source_date))
      || Date.parse(source.source_date) > generatedAt
      || !marketSourceFreshnessVerified(source, String(document.report_date || '')))) reasons.push('market_source_provenance_invalid');
  }
  const evidenceIds = [...new Set(claims.flatMap(claim => Array.isArray(claim.evidence_ids)
    ? claim.evidence_ids.filter((id): id is string => typeof id === 'string' && Boolean(id)) : []))];
  return {
    schema_version: 'CANONICAL_MARKET_STATE_V1', report_date: String(document.report_date || ''),
    today_date: String(document.today_date || ''), generated_at: String(provenance.generated_at || ''),
    data_as_of: typeof document.data_as_of === 'string' ? document.data_as_of : null,
    status: reasons.length === 0 ? 'READY' : 'INSUFFICIENT_EVIDENCE', document,
    evidence_ids: evidenceIds, reason_codes: [...new Set(reasons)],
  };
}

/** Compatibility aliases are views of the same market document, not another
 * selector or another publication decision. Stock research stays independent. */
export function marketDocumentInput(value: unknown): JsonRecord {
  const ai = record(value);
  return { ...ai, research_master_v2: canonicalMarketDocument(ai) };
}

/** Exact producer ledger tuples, not new sources inferred from narrative text. */
export function canonicalMarketSourceRefs(value: unknown): JsonRecord[] {
  const document = canonicalMarketDocument(value);
  const claims = record(record(document.quality).coverage_audit).claims;
  if (!Array.isArray(claims)) return [];
  const sources = claims.flatMap(value => {
    const claim = record(value);
    return claim.scope === 'market' && claim.supported === true && Array.isArray(claim.sources)
      ? claim.sources.map(record) : [];
  });
  const unique = new Map<string, JsonRecord>();
  for (const source of sources) {
    const tuple = { evidence_id: source.evidence_id, source: source.source,
      source_date: source.source_date, freshness: source.freshness };
    unique.set(JSON.stringify(tuple), { ...tuple, ...publicResearchSourceMetadata(source) });
  }
  return [...unique.values()];
}
