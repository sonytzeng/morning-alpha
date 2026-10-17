/** Detached, credential-free financial actuals candidate. Importing performs no I/O.
 * Not imported by Producer/Canonical and never admits Recommendation evidence.
 * Attribution: FSC Securities and Futures Bureau / TWSE, 2026, datasets below,
 * Open Government Data License 1.0 https://data.gov.tw/license (dataset-specific).
 */
import { OFFICIAL_ACTUAL_SOURCES, OFFICIAL_FINANCIAL_HOLDING_SOURCE, normalizeOfficialActuals, acquireOfficialActuals } from './recommendation-official-actuals.ts';

export const FINANCIAL_CANDIDATE_SYMBOLS = Object.freeze(['2881', '2882', '2884', '2885', '2891']);
export const FINANCIAL_CANDIDATE_SOURCES = Object.freeze([
  Object.freeze({kind: 'monthly_revenue', url: OFFICIAL_ACTUAL_SOURCES[1].url,
    dataset: 'https://data.gov.tw/dataset/18420'}),
  Object.freeze({kind: 'eps_summary', url: OFFICIAL_ACTUAL_SOURCES[2].url,
    dataset: 'https://data.gov.tw/dataset/20756'}),
  Object.freeze({kind: 'financial_holding_income', url: OFFICIAL_FINANCIAL_HOLDING_SOURCE.url,
    dataset: 'https://data.gov.tw/dataset/91999'}),
] as const);
type Kind = typeof FINANCIAL_CANDIDATE_SOURCES[number]['kind'];
type Raw = Record<string, unknown>;
export type FinancialActualCandidateRow = {
  symbol: string; company_name: string; kind: Kind; source: string; dataset: string;
  source_date: string; period: string; observed_at: string; available_at: string; first_seen_at: string;
  original_publication_time: null; source_timestamp: null; source_vintage: null;
  availability_basis: 'FIRST_OBSERVED_THIS_CAPTURE_NOT_ORIGINAL_PUBLICATION';
  period_basis: 'SINGLE_MONTH_AS_REPORTED' | 'UNPROVEN_SINGLE_QUARTER_VS_YTD';
  amount_unit: 'SOURCE_REPORTED_NOT_CONVERTED'; eps_unit: 'SOURCE_FIELD_YUAN' | null;
  monthly_revenue_as_reported: number | null; eps_as_reported: number | null;
  reported_fields: Record<string, number | null>;
  standalone_quarter_eps: null; standalone_quarter_revenue: null;
  consensus: null; guidance: null; formal_admission: false; member_publication: false;
};
export type FinancialCandidateCapture = {
  kind: Kind; source: string; dataset: string; received_at: string;
  http_status: number | null; status: 'PASS' | 'DEADLINE' | 'HTTP_STOP' | 'CONTRACT_INVALID' | 'TRANSPORT_FAILURE';
  total_source_rows: number | null; rows: FinancialActualCandidateRow[];
  first_seen_at: string | null; response_sha256: string | null; response_bytes: number | null;
  missing_symbols: string[]; null_actual_symbols: string[];
};
const isRow = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
function numeric(v: unknown): number | null {
  const value = text(v);
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value.replaceAll(',', ''));
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER ? number : null;
}
function descriptor(kind: Kind) {
  const source = FINANCIAL_CANDIDATE_SOURCES.find(s => s.kind === kind);
  if (!source) throw Error('FINANCIAL_CONTRACT_INVALID');
  return source;
}
function instant(value: string): number {
  // Require an explicit timezone; never use the host timezone as market time.
  const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(stamp)) throw Error('FINANCIAL_CONTRACT_INVALID');
  return stamp;
}

export function normalizeFinancialActualsCandidate(kind: Kind, payload: unknown, receivedAt: string): FinancialActualCandidateRow[] {
  descriptor(kind);
  instant(receivedAt);
  if (!Array.isArray(payload) || payload.length > 3000 || payload.some(r => !isRow(r)))
    throw Error('FINANCIAL_CONTRACT_INVALID');
  const normalized = normalizeOfficialActuals(kind === 'monthly_revenue' ? OFFICIAL_ACTUAL_SOURCES[1]
    : kind === 'eps_summary' ? OFFICIAL_ACTUAL_SOURCES[2] : OFFICIAL_FINANCIAL_HOLDING_SOURCE,
  payload, receivedAt, FINANCIAL_CANDIDATE_SYMBOLS);
  return candidateRows(kind, normalized);
}

function candidateRows(kind: Kind, normalized: Raw[]): FinancialActualCandidateRow[] {
  const source = descriptor(kind);
  return normalized.map(row => {
    const original = isRow(row.reported_fields_as_reported) ? row.reported_fields_as_reported : {};
    const keys = kind === 'monthly_revenue' ? ['營業收入-當月營收', '累計營業收入-當月累計營收']
      : kind === 'eps_summary' ? ['基本每股盈餘(元)', '營業收入', '稅後淨利']
        : ['基本每股盈餘（元）', '利息淨收益', '利息以外淨收益', '淨收益', '本期稅後淨利（淨損）'];
    const reported: Record<string, number | null> = {};
    for (const key of keys) reported[key] = numeric(original[key]);
    return {
      symbol: text(row.symbol), company_name: text(row.company_name), kind,
      source: source.url, dataset: source.dataset, source_date: text(row.source_date), period: text(row.period),
      observed_at: text(row.observed_at), available_at: text(row.available_at), first_seen_at: text(row.first_seen_at),
      original_publication_time: null, source_timestamp: null, source_vintage: null,
      availability_basis: 'FIRST_OBSERVED_THIS_CAPTURE_NOT_ORIGINAL_PUBLICATION',
      period_basis: kind === 'monthly_revenue' ? 'SINGLE_MONTH_AS_REPORTED' : 'UNPROVEN_SINGLE_QUARTER_VS_YTD',
      amount_unit: 'SOURCE_REPORTED_NOT_CONVERTED', eps_unit: kind === 'monthly_revenue' ? null : 'SOURCE_FIELD_YUAN',
      monthly_revenue_as_reported: kind === 'monthly_revenue' ? numeric(row.revenue_actual_as_reported) : null,
      eps_as_reported: kind === 'monthly_revenue' ? null : numeric(row.eps_actual_as_reported),
      reported_fields: reported, standalone_quarter_eps: null, standalone_quarter_revenue: null,
      consensus: null, guidance: null, formal_admission: false, member_publication: false,
    };
  });
}

/** Explicitly injected public transport only: 3 fixed GETs, no retry, no keys,
 * max4s/source and15s/batch through the existing official acquisition adapter.
 * Does not persist, run on import, or call Supabase. */
export async function acquireFinancialActualsCandidate(options: {
  fetcher: typeof fetch; now: () => string; signal: AbortSignal;
}): Promise<FinancialCandidateCapture[]> {
  const official = await acquireOfficialActuals({...options, symbols: FINANCIAL_CANDIDATE_SYMBOLS, profile: 'financial_candidate'});
  return FINANCIAL_CANDIDATE_SOURCES.map(source => {
    const capture = official.find(c => c.source === source.url)!;
    const status: FinancialCandidateCapture['status'] = capture.status === 'PASS' ? 'PASS'
      : capture.status === 'OFFICIAL_DEADLINE' ? 'DEADLINE' : capture.status.startsWith('OFFICIAL_HTTP_') ? 'HTTP_STOP'
        : capture.status === 'OFFICIAL_TRANSPORT_FAILURE' ? 'TRANSPORT_FAILURE' : 'CONTRACT_INVALID';
    return {kind: source.kind, source: source.url, dataset: source.dataset, received_at: capture.received_at,
      http_status: capture.http_status, status, total_source_rows: capture.source_row_count ?? null,
      first_seen_at: capture.first_seen_at ?? null, response_sha256: capture.source_response_sha256 ?? null,
      response_bytes: capture.response_bytes ?? null, missing_symbols: capture.missing_symbols ?? [],
      null_actual_symbols: capture.null_actual_symbols ?? [], rows: candidateRows(source.kind, capture.rows)};
  });
}

export function financialActualsCandidateCoverage(captures: readonly FinancialCandidateCapture[], cutoff: string) {
  const latestKnown = instant(cutoff);
  // Current receipt, not the source's date-only label, controls historical use.
  const rows = captures.filter(c => c.status === 'PASS' && instant(c.received_at) <= latestKnown)
    .flatMap(c => c.rows).filter(r => instant(r.available_at) <= latestKnown);
  const conflicts = FINANCIAL_CANDIDATE_SYMBOLS.filter(symbol => {
    const eps = rows.filter(r => r.symbol === symbol && r.eps_as_reported !== null);
    return eps.some(a => eps.some(b => a.period === b.period && a.eps_as_reported !== b.eps_as_reported));
  });
  const count = (kind: Kind, field: 'monthly_revenue_as_reported' | 'eps_as_reported') =>
    new Set(rows.filter(r => r.kind === kind && typeof r[field] === 'number' && Number.isFinite(r[field])
      && (field !== 'eps_as_reported' || !conflicts.includes(r.symbol))).map(r => r.symbol)).size;
  return {target_symbols: FINANCIAL_CANDIDATE_SYMBOLS.length,
    monthly_revenue_as_reported: count('monthly_revenue', 'monthly_revenue_as_reported'),
    eps_summary_as_reported: count('eps_summary', 'eps_as_reported'),
    financial_holding_eps_as_reported: count('financial_holding_income', 'eps_as_reported'),
    conflicting_eps_symbols: conflicts,
    reported_months: [...new Set(rows.filter(r => r.kind === 'monthly_revenue').map(r => r.period))].sort(),
    reported_quarter_labels: [...new Set(rows.filter(r => r.kind !== 'monthly_revenue').map(r => r.period))].sort(),
    proven_standalone_quarters: 0, complete_four_quarter_actuals: 0,
    exact_publication_time: null, historical_missing_monthly_reason: 'UNKNOWN_NO_ORIGINAL_RAW_VERSION',
    formal_admission: false, member_publication: false, business_writes: 0};
}
