/** Pure, detached capability candidate; NOT a Finnhub acquisition adapter.
 * All receipt/unit/accounting metadata is declared evidence, not authenticated
 * by this parser. No I/O, clock, credentials, strategy, store or admission hook.
 * Official Finnhub models describe BOTH averages as including proprietary
 * estimates. Never emit earnings_events.*_consensus or publication approval.
 */
export const CONSENSUS_CAPABILITY_CONTRACT = 'FINNHUB_QUARTERLY_CAPABILITY_CANDIDATE_V1';
export const FINNHUB_AVERAGE_PROVENANCE = 'FINNHUB_AVERAGE_INCLUDING_PROPRIETARY';
export const CONSENSUS_CANDIDATE_MAX_BYTES = 64_000;
const DAY = 86_400_000;
const externalBlockers = Object.freeze([
  'TW72_COVERAGE_UNPROVEN', 'CURRENT_ENTITLEMENT_UNPROVEN',
  'FOUR_QUARTER_HISTORICAL_ASOF_UNPROVEN', 'COMMERCIAL_MEMBER_REUSE_RIGHTS_UNPROVEN',
  'PURE_BROKER_CONSENSUS_NOT_ESTABLISHED',
]);
type RecordValue = Record<string, unknown>;
type Receipt = { first_seen_at: string; available_at: string; revision_ref: string };
export type QuarterlyCapabilityRow = {
  symbol: string; provider_symbol: string; fiscal_period: string;
  period_start: string; period_end: string; currency: string; accounting_basis: string;
  eps_basis: string; eps_actual: number; revenue_actual: number;
  eps_estimate_average: number; revenue_estimate_average: number;
  eps_analyst_count: number; revenue_analyst_count: number;
  estimate_provenance: typeof FINNHUB_AVERAGE_PROVENANCE;
  actual_source_ref: string; actual_published_at: string;
  actual_receipt: Receipt; eps_receipt: Receipt; revenue_receipt: Receipt;
  eps_source_as_of: string | null; revenue_source_as_of: string | null;
  measurement_refs: string[];
};
export type ConsensusCapabilityAssessment = {
  contract: typeof CONSENSUS_CAPABILITY_CONTRACT;
  status: 'BLOCKED_INPUT' | 'CANDIDATE_SHAPE_VALID_EXTERNAL_BLOCKED';
  v1_admitted: false; member_publication_approved: false; pure_broker_consensus: false;
  external_blockers: readonly string[]; reasons: string[];
  rows: QuarterlyCapabilityRow[];
  guidance: null | { direction: 'up' | 'stable' | 'down'; source_ref: string; receipt: Receipt; published_at: string };
};
const object = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const keys = (value: RecordValue, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const ref = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{0,159}$/.test(value);
const timestamp = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z') ? at : NaN;
};
const date = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const at = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at : NaN;
};
const receipt = (r: RecordValue): Receipt => ({ first_seen_at: String(r.first_seen_at), available_at: String(r.available_at), revision_ref: String(r.revision_ref) });
const receiptValid = (r: RecordValue, cutoff: number) => {
  const first = timestamp(r.first_seen_at), available = timestamp(r.available_at);
  return Number.isFinite(first) && Number.isFinite(available) && first <= available && available <= cutoff && ref(r.revision_ref);
};
function officialSource(provider: unknown, value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false;
  try {
    const u = new URL(value);
    const hosts = provider === 'TWSE' ? ['openapi.twse.com.tw', 'mops.twse.com.tw', 'mopsov.twse.com.tw']
      : provider === 'TPEX' ? ['www.tpex.org.tw', 'mops.twse.com.tw', 'mopsov.twse.com.tw'] : [];
    return u.protocol === 'https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port && !u.search && !u.hash;
  } catch { return false; }
}
const commonFields = ['kind', 'provider', 'first_seen_at', 'available_at', 'revision_ref', 'currency', 'period_basis', 'accounting_basis', 'eps_basis', 'measurement_ref'];
function dimensions(r: RecordValue, currency: unknown): boolean {
  return r.currency === currency && r.period_basis === 'STANDALONE_QUARTER'
    && ['IFRS', 'US_GAAP', 'ADJUSTED'].includes(String(r.accounting_basis))
    && ['BASIC', 'DILUTED'].includes(String(r.eps_basis)) && ref(r.measurement_ref);
}
function estimate(raw: unknown, metric: 'eps' | 'revenue', q: RecordValue, input: RecordValue, cutoff: number, actual: RecordValue): { average: number; analysts: number; metadata: RecordValue } {
  const r = object(raw), p = object(r.payload);
  if (!keys(r, [...commonFields, 'endpoint', 'unit', 'scale', 'source_as_of', 'provenance', 'payload'])
    || r.kind !== 'ESTIMATE' || r.provider !== 'FINNHUB' || r.endpoint !== `/stock/${metric === 'eps' ? 'eps' : 'revenue'}-estimate`
    || r.provenance !== FINNHUB_AVERAGE_PROVENANCE) throw Error('ESTIMATE_SOURCE_OR_PROVENANCE_INVALID');
  if (!dimensions(r, input.currency) || r.accounting_basis !== actual.accounting_basis || r.eps_basis !== actual.eps_basis
    || r.unit !== (metric === 'eps' ? 'CURRENCY_PER_SHARE' : 'CURRENCY_UNITS') || r.scale !== 1) throw Error('ESTIMATE_DIMENSIONS_UNPROVEN_OR_MISMATCHED');
  if (!receiptValid(r, cutoff) || timestamp(r.available_at) >= timestamp(actual.published_at)
    || !(r.source_as_of === null || Number.isFinite(timestamp(r.source_as_of)) && timestamp(r.source_as_of) <= timestamp(r.first_seen_at))) throw Error('ESTIMATE_NOT_KNOWN_BEFORE_ACTUAL_OR_CUTOFF');
  // A single selected record, plus its declared immutable receipt, is the
  // adapter seam. It is NOT claimed to be a complete raw provider response.
  if (!keys(p, ['symbol', 'freq', 'data']) || p.symbol !== input.provider_symbol || p.freq !== 'quarterly'
    || !Array.isArray(p.data) || p.data.length !== 1) throw Error('ESTIMATE_QUARTERLY_PAYLOAD_INVALID');
  const row = object(p.data[0]), avg = `${metric}Avg`, low = `${metric}Low`, high = `${metric}High`;
  if (!keys(row, ['year', 'quarter', 'period', avg, low, high, 'numberAnalysts'])
    || row.year !== q.fiscal_year || row.quarter !== q.fiscal_quarter || row.period !== q.period_end) throw Error('ESTIMATE_FISCAL_PERIOD_MISMATCH');
  if (![row[avg], row[low], row[high]].every(finite) || Number(row[low]) > Number(row[avg]) || Number(row[avg]) > Number(row[high])
    || metric === 'revenue' && (Number(row[avg]) <= 0 || Number(row[low]) < 0)
    || !Number.isSafeInteger(row.numberAnalysts) || Number(row.numberAnalysts) < 1 || Number(row.numberAnalysts) > 10_000) throw Error('ESTIMATE_VALUES_OR_ANALYST_COUNT_INVALID');
  return { average: Number(row[avg]), analysts: Number(row.numberAnalysts), metadata: r };
}

/** Validate only declared, pre-normalized evidence. A valid shape NEVER grants
 * entitlement, vintage authenticity, coverage, licensing or formal admission.
 * Serialized JSON bounds parsing, avoids getters/cycles and rejects unknown
 * capability flags. Diagnostics never echo input, URLs or parser exceptions.
 */
export function assessQuarterlyConsensusCapability(serialized: unknown): ConsensusCapabilityAssessment {
  const result: ConsensusCapabilityAssessment = {
    contract: CONSENSUS_CAPABILITY_CONTRACT, status: 'BLOCKED_INPUT',
    v1_admitted: false, member_publication_approved: false, pure_broker_consensus: false,
    external_blockers: [...externalBlockers], reasons: [], rows: [], guidance: null,
  };
  try {
    if (typeof serialized !== 'string' || serialized.length > CONSENSUS_CANDIDATE_MAX_BYTES
      || new TextEncoder().encode(serialized).byteLength > CONSENSUS_CANDIDATE_MAX_BYTES) throw Error('INPUT_LIMIT_OR_TYPE_INVALID');
    let parsed: unknown;
    try { parsed = JSON.parse(serialized); } catch { throw Error('INPUT_JSON_INVALID'); }
    const input = object(parsed), cutoff = timestamp(input.cutoff);
    if (!keys(input, ['contract', 'symbol', 'provider_symbol', 'symbol_mapping_ref', 'currency', 'cutoff', 'quarters', 'guidance'])
      || input.contract !== CONSENSUS_CAPABILITY_CONTRACT || !/^\d{4,6}$/.test(String(input.symbol)) || typeof input.symbol !== 'string'
      || typeof input.provider_symbol !== 'string' || !/^[A-Z0-9][A-Z0-9.:-]{0,31}$/.test(input.provider_symbol)
      || !ref(input.symbol_mapping_ref) || input.currency !== 'TWD'
      || !Number.isFinite(cutoff)) throw Error('IDENTITY_OR_CUTOFF_INVALID');
    if (!Array.isArray(input.quarters) || input.quarters.length !== 4) throw Error('EXACT_FOUR_QUARTERS_REQUIRED');
    const rows: QuarterlyCapabilityRow[] = [];
    let previousOrdinal: number | undefined, previousEnd: number | undefined, latestPublication = -Infinity;
    for (const value of input.quarters) {
      const q = object(value), a = object(q.actuals), start = date(q.period_start), end = date(q.period_end);
      if (!keys(q, ['fiscal_year', 'fiscal_quarter', 'period_start', 'period_end', 'actuals', 'eps_estimate', 'revenue_estimate'])
        || !Number.isInteger(q.fiscal_year) || Number(q.fiscal_year) < 1900 || Number(q.fiscal_year) > 2200
        || ![1, 2, 3, 4].includes(Number(q.fiscal_quarter)) || typeof q.fiscal_quarter !== 'number'
        || !Number.isFinite(start) || !Number.isFinite(end) || end - start < 69 * DAY || end - start > 109 * DAY
        || Math.abs(new Date(end).getUTCFullYear() - Number(q.fiscal_year)) > 1) throw Error('STANDALONE_QUARTER_PERIOD_INVALID');
      const ordinal = Number(q.fiscal_year) * 4 + Number(q.fiscal_quarter);
      if (previousOrdinal !== undefined && ordinal !== previousOrdinal + 1
        || previousEnd !== undefined && start !== previousEnd + DAY) throw Error('QUARTERS_NOT_CONSECUTIVE');
      previousOrdinal = ordinal; previousEnd = end;
      if (!keys(a, [...commonFields, 'symbol', 'fiscal_year', 'fiscal_quarter', 'period_start', 'period_end', 'source_ref', 'published_at', 'eps_unit', 'revenue_unit', 'scale', 'eps_actual', 'revenue_actual'])
        || a.kind !== 'ACTUAL' || !officialSource(a.provider, a.source_ref)
        || a.symbol !== input.symbol || a.fiscal_year !== q.fiscal_year || a.fiscal_quarter !== q.fiscal_quarter
        || a.period_start !== q.period_start || a.period_end !== q.period_end
        || !dimensions(a, input.currency) || a.eps_unit !== 'CURRENCY_PER_SHARE' || a.revenue_unit !== 'CURRENCY_UNITS' || a.scale !== 1
        || !finite(a.eps_actual) || !finite(a.revenue_actual) || a.revenue_actual < 0) throw Error('ACTUAL_SOURCE_DIMENSIONS_OR_VALUES_INVALID');
      const published = timestamp(a.published_at);
      // Period bounds are Taipei accounting dates, not browser-local dates.
      const completed = end + DAY - 8 * 3_600_000;
      if (!receiptValid(a, cutoff) || !Number.isFinite(published) || published < completed || published > timestamp(a.first_seen_at)) throw Error('ACTUAL_TIME_INVALID');
      const eps = estimate(q.eps_estimate, 'eps', q, input, cutoff, a);
      const revenue = estimate(q.revenue_estimate, 'revenue', q, input, cutoff, a);
      latestPublication = Math.max(latestPublication, published);
      rows.push({
        symbol: input.symbol, provider_symbol: input.provider_symbol, fiscal_period: `${q.fiscal_year}-Q${q.fiscal_quarter}`,
        period_start: String(q.period_start), period_end: String(q.period_end), currency: input.currency,
        accounting_basis: String(a.accounting_basis), eps_basis: String(a.eps_basis), eps_actual: a.eps_actual, revenue_actual: a.revenue_actual,
        eps_estimate_average: eps.average, revenue_estimate_average: revenue.average,
        eps_analyst_count: eps.analysts, revenue_analyst_count: revenue.analysts, estimate_provenance: FINNHUB_AVERAGE_PROVENANCE,
        actual_source_ref: a.source_ref, actual_published_at: String(a.published_at),
        actual_receipt: receipt(a), eps_receipt: receipt(eps.metadata), revenue_receipt: receipt(revenue.metadata),
        eps_source_as_of: eps.metadata.source_as_of === null ? null : String(eps.metadata.source_as_of),
        revenue_source_as_of: revenue.metadata.source_as_of === null ? null : String(revenue.metadata.source_as_of),
        measurement_refs: [String(input.symbol_mapping_ref), String(a.measurement_ref), String(eps.metadata.measurement_ref), String(revenue.metadata.measurement_ref)],
      });
    }
    const g = object(input.guidance), published = timestamp(g.published_at);
    if (!keys(g, ['kind', 'provider', 'symbol', 'direction', 'source_ref', 'published_at', 'first_seen_at', 'available_at', 'revision_ref'])
      || g.kind !== 'ISSUER_GUIDANCE' || g.symbol !== input.symbol || !['up', 'stable', 'down'].includes(String(g.direction))
      || !officialSource(g.provider, g.source_ref) || !receiptValid(g, cutoff)
      || !Number.isFinite(published) || published < latestPublication || published > timestamp(g.first_seen_at)) throw Error('LATEST_SOURCED_GUIDANCE_REQUIRED');
    result.rows = rows;
    result.guidance = { direction: g.direction as 'up' | 'stable' | 'down', source_ref: g.source_ref, receipt: receipt(g), published_at: String(g.published_at) };
    result.status = 'CANDIDATE_SHAPE_VALID_EXTERNAL_BLOCKED';
    return result;
  } catch (error) {
    // Only internal fixed error codes can reach here; no raw data reflection.
    result.reasons = [error instanceof Error && /^[A-Z_]{1,100}$/.test(error.message) ? error.message : 'INPUT_INVALID'];
    return result;
  }
}
