/** Detached issuer-fact/review preparation only. No acquisition, storage, clock,
 * credentials, publication or approval. Source projections are human-observed
 * assertions, not issuer signatures. Hashes bind bytes, not semantic truth.
 * Existing V1 and event-alignment methods remain unchanged. */
import { hashValid, snapshotHash, sourceSafe, validTime } from '../src/features/vnext/contracts.ts';
import { eventAlignmentFromDailyReceipts } from './recommendation-event-alignment-candidate.ts';
import type { DecisionIdentity, EvidenceData } from '../supabase/functions/_shared/decision-v1-data.ts';
import type { SourceReceipt } from '../src/features/vnext/dailyAdapter.ts';

export const ISSUER_REVIEW_CONTRACT = 'ISSUER_EVENT_REVIEW_CANDIDATE_V1';
export type IssuerSource = {
  id: string; symbol: string; url: string;
  kind: 'EARNINGS_RELEASE' | 'MANAGEMENT_REPORT' | 'IR_RESULTS_INDEX' | 'BOARD_APPROVAL';
  access: 'DIRECT_DOCUMENT' | 'OFFICIAL_INDEXED_EXCERPT';
  first_seen_at: string; published_date: string | null; published_at: string | null; version: string | null;
};
export type IssuerActual = {
  period: string; period_start: string; period_end: string; source_id: string; basis_source_id: string;
  revenue_twd_billion: number; revenue_precision_twd_billion: number; eps_twd: number; currency: 'TWD';
  period_basis: 'STANDALONE_QUARTER_AS_REPORTED'; accounting_basis: 'CONSOLIDATED_TIFRS';
  eps_basis: 'DILUTED_PER_COMMON_SHARE'; locator: string; basis_locator: string;
};
export type IssuerGuidance = {
  source_id: string; target_period: string; revenue_usd_billion: number[];
  gross_margin_pct: number[]; operating_margin_pct: number[]; fx_twd_per_usd: number;
  direction: null; locator: string;
};
export type IssuerFact = {
  id: string; source_id: string;
  kind: 'COMPANY_RELATION' | 'BUSINESS_DRIVER' | 'COUNTEREVIDENCE' | 'LIMITATION';
  summary: string; locator: string;
};
export type IssuerFacts = {
  schema: 'ISSUER_ALLOWLIST_FACTS_V1'; symbol: string; observed_at: string;
  latest_reported_period: string; latest_source_id: string;
  sources: IssuerSource[]; actuals: IssuerActual[]; guidance: IssuerGuidance[]; facts: IssuerFact[];
};
type BoundClaim = { text: string; fact_ids: string[] };
export type IssuerEventDraft = {
  id: string; symbol: string; title: string; event_source_id: string; proposed_at: string;
  company_relation: BoundClaim; transmission_path: BoundClaim;
  counterevidence: BoundClaim[]; confirmation_condition: BoundClaim;
  invalidation_condition: BoundClaim; cancellation_conditions: BoundClaim[];
};
/** Caller-owned, independently reviewed exact URLs/latest period. Never derive
 * this trust policy from an arbitrary incoming bundle. No URL is dereferenced. */
export type IssuerReviewPolicy = {
  symbol: string; allowed_source_urls: readonly string[]; latest_reported_period: string;
};
const fail = (): never => { throw Error('ISSUER_REVIEW_CONTRACT_INVALID'); };
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
  && v.length <= 600 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const keys = (v: unknown, names: string[]): void => {
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || Object.keys(v).length !== names.length || names.some(k => !Object.hasOwn(v, k))) fail();
};
const list = (v: unknown, max: number, min = 0): void => {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail();
};
const dateValid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && validTime(v + 'T00:00:00Z');
function quarter(period: string) {
  const m = /^(20\d{2})-Q([1-4])$/.exec(period); if (!m) return fail();
  const year = Number(m[1]), q = Number(m[2]);
  return { ordinal: year * 4 + q - 1,
    start: `${year}-${String(q * 3 - 2).padStart(2, '0')}-01`,
    end: new Date(Date.UTC(year, q * 3, 0)).toISOString().slice(0, 10) };
}
const range = (v: unknown, maximum: number) => Array.isArray(v) && v.length === 2
  && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= maximum) && v[0] <= v[1];
const taipeiDay = (at: string) => new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 10);

/** No raw HTML/PDF/text-body fields are accepted. Four-quarter actuals stay
 * separate from outlook and consensus; date-only publication never becomes an
 * invented midnight instant or a historical availability receipt. */
export async function prepareIssuerEventReview(
  facts: IssuerFacts, draft: IssuerEventDraft, policy: IssuerReviewPolicy,
  expectedProjectionHash: string, cutoff: string,
) {
  if (!validTime(cutoff) || !hashValid(expectedProjectionHash)) fail();
  policy = structuredClone(policy);
  const projection = structuredClone({ facts, draft });
  if (await snapshotHash(projection) !== expectedProjectionHash) throw Error('ISSUER_REVIEW_SOURCE_HASH_MISMATCH');
  // Work exclusively on the hashed copy; callers cannot mutate it across awaits.
  facts = projection.facts; draft = projection.draft;
  keys(facts, ['schema', 'symbol', 'observed_at', 'latest_reported_period', 'latest_source_id', 'sources', 'actuals', 'guidance', 'facts']);
  if (facts.schema !== 'ISSUER_ALLOWLIST_FACTS_V1' || !/^\d{4,6}$/.test(policy.symbol)
    || facts.symbol !== policy.symbol || !validTime(facts.observed_at)
    || facts.latest_reported_period !== policy.latest_reported_period) fail();
  list(policy.allowed_source_urls, 24, 1); list(facts.sources, 24, 1);
  list(facts.actuals, 4, 4); list(facts.guidance, 4); list(facts.facts, 32, 1);
  const sources = new Map<string, IssuerSource>();
  for (const s of facts.sources) {
    keys(s, ['id', 'symbol', 'url', 'kind', 'access', 'first_seen_at', 'published_date', 'published_at', 'version']);
    if (!text(s.id) || sources.has(s.id) || s.symbol !== facts.symbol || !sourceSafe(s.url)
      || !policy.allowed_source_urls.includes(s.url) || new URL(s.url).search
      || !['EARNINGS_RELEASE', 'MANAGEMENT_REPORT', 'IR_RESULTS_INDEX', 'BOARD_APPROVAL'].includes(s.kind)
      || !['DIRECT_DOCUMENT', 'OFFICIAL_INDEXED_EXCERPT'].includes(s.access)
      || !validTime(s.first_seen_at) || Date.parse(s.first_seen_at) > Date.parse(facts.observed_at)
      || s.published_date !== null && (!dateValid(s.published_date) || s.published_date > taipeiDay(s.first_seen_at))
      || s.version !== null && !text(s.version)
      || s.published_at !== null && (!validTime(s.published_at) || taipeiDay(s.published_at) !== s.published_date
        || Date.parse(s.published_at) > Date.parse(s.first_seen_at))) fail();
    sources.set(s.id, s);
  }
  const get = (id: string) => sources.get(id) ?? fail();
  const latest = get(facts.latest_source_id);
  if (latest.kind !== 'IR_RESULTS_INDEX' || latest.access !== 'DIRECT_DOCUMENT') fail();
  const last = quarter(policy.latest_reported_period), periods = new Set<string>();
  const actuals = facts.actuals.map(a => {
    keys(a, ['period', 'period_start', 'period_end', 'source_id', 'basis_source_id', 'revenue_twd_billion', 'revenue_precision_twd_billion', 'eps_twd',
      'currency', 'period_basis', 'accounting_basis', 'eps_basis', 'locator', 'basis_locator']);
    const q = quarter(a.period), s = get(a.source_id), basis = get(a.basis_source_id);
    if (periods.has(a.period) || q.ordinal > last.ordinal || q.ordinal < last.ordinal - 3
      || a.period_start !== q.start || a.period_end !== q.end || a.currency !== 'TWD'
      || a.period_basis !== 'STANDALONE_QUARTER_AS_REPORTED' || a.accounting_basis !== 'CONSOLIDATED_TIFRS'
      || a.eps_basis !== 'DILUTED_PER_COMMON_SHARE' || s.kind !== 'EARNINGS_RELEASE' || s.access !== 'DIRECT_DOCUMENT'
      || basis.kind !== 'MANAGEMENT_REPORT' || !s.published_date || !basis.published_date
      || s.published_date <= a.period_end || basis.published_date <= a.period_end
      || typeof a.revenue_twd_billion !== 'number' || !Number.isFinite(a.revenue_twd_billion) || a.revenue_twd_billion <= 0
      || !Number.isSafeInteger(Math.round(a.revenue_twd_billion * 1e9))
      || typeof a.revenue_precision_twd_billion !== 'number' || !Number.isFinite(a.revenue_precision_twd_billion)
      || a.revenue_precision_twd_billion < 1e-9 || a.revenue_precision_twd_billion > a.revenue_twd_billion
      || typeof a.eps_twd !== 'number' || !Number.isFinite(a.eps_twd) || Math.abs(a.eps_twd) > 1e6
      || !text(a.locator) || !text(a.basis_locator)) fail();
    periods.add(a.period);
    const available = [s.first_seen_at, basis.first_seen_at].sort((x, y) => Date.parse(x) - Date.parse(y)).at(-1)!;
    return { ...a, revenue_twd: Math.round(a.revenue_twd_billion * 1e9),
      revenue_precision_twd: Math.round(a.revenue_precision_twd_billion * 1e9), conversion: 'BILLION_SCALE_ONLY_NOT_YTD_SUBTRACTION',
      first_seen_at: s.first_seen_at, available_at: available, original_published_at: s.published_at,
      original_version: s.version, ordinary_basis_access: basis.access, consensus: null };
  }).sort((a, b) => a.period.localeCompare(b.period));
  const guidance = facts.guidance.map(g => {
    keys(g, ['source_id', 'target_period', 'revenue_usd_billion', 'gross_margin_pct', 'operating_margin_pct',
      'fx_twd_per_usd', 'direction', 'locator']);
    const s = get(g.source_id);
    if (s.kind !== 'EARNINGS_RELEASE' || s.access !== 'DIRECT_DOCUMENT'
      || g.source_id !== facts.actuals.find(a => a.period === facts.latest_reported_period)?.source_id
      || quarter(g.target_period).ordinal !== last.ordinal + 1 || !range(g.revenue_usd_billion, 1e6)
      || !range(g.gross_margin_pct, 100) || !range(g.operating_margin_pct, 100)
      || typeof g.fx_twd_per_usd !== 'number' || !Number.isFinite(g.fx_twd_per_usd) || g.fx_twd_per_usd <= 0
      || g.direction !== null || !text(g.locator)) fail();
    return { ...g, available_at: s.first_seen_at, reliableGuidance: null,
      interpretation: 'ISSUER_OUTLOOK_NOT_ACTUAL_OR_CONSENSUS_OR_STABLE_DEFAULT' };
  });
  const indexed = new Map<string, IssuerFact>();
  for (const f of facts.facts) {
    keys(f, ['id', 'source_id', 'kind', 'summary', 'locator']); get(f.source_id);
    if (!text(f.id) || indexed.has(f.id) || !text(f.summary) || !text(f.locator)
      || !['COMPANY_RELATION', 'BUSINESS_DRIVER', 'COUNTEREVIDENCE', 'LIMITATION'].includes(f.kind)) fail();
    indexed.set(f.id, f);
  }
  keys(draft, ['id', 'symbol', 'title', 'event_source_id', 'proposed_at', 'company_relation', 'transmission_path',
    'counterevidence', 'confirmation_condition', 'invalidation_condition', 'cancellation_conditions']);
  const eventSource = get(draft.event_source_id);
  if (!text(draft.id) || draft.symbol !== facts.symbol || !text(draft.title) || !validTime(draft.proposed_at)
    || Date.parse(draft.proposed_at) < Date.parse(facts.observed_at)
    || eventSource.kind !== 'EARNINGS_RELEASE' || eventSource.access !== 'DIRECT_DOCUMENT') fail();
  const referenced = new Set([facts.latest_source_id, draft.event_source_id]);
  const claim = (c: BoundClaim, requiredKind?: IssuerFact['kind']) => {
    keys(c, ['text', 'fact_ids']); list(c.fact_ids, 8, 1);
    if (!text(c.text) || new Set(c.fact_ids).size !== c.fact_ids.length) fail();
    const refs = c.fact_ids.map(id => indexed.get(id) ?? fail());
    if (requiredKind && !refs.some(f => f.kind === requiredKind
      && (requiredKind === 'COUNTEREVIDENCE' || f.source_id === draft.event_source_id))
      || refs.some(f => get(f.source_id).access !== 'DIRECT_DOCUMENT')) fail();
    for (const f of refs) referenced.add(f.source_id);
    return { ...c, evidence: refs.map(f => ({ fact_id: f.id, source_url: get(f.source_id).url, locator: f.locator })) };
  };
  list(draft.counterevidence, 8, 1); list(draft.cancellation_conditions, 8, 1);
  const review = { id: draft.id, symbol: draft.symbol, title: draft.title,
    event_source_id: draft.event_source_id, proposed_at: draft.proposed_at,
    company_relation: claim(draft.company_relation, 'COMPANY_RELATION'),
    transmission_path: claim(draft.transmission_path, 'BUSINESS_DRIVER'),
    counterevidence: draft.counterevidence.map(c => claim(c, 'COUNTEREVIDENCE')),
    confirmation_condition: claim(draft.confirmation_condition), invalidation_condition: claim(draft.invalidation_condition),
    cancellation_conditions: draft.cancellation_conditions.map(c => claim(c)),
    claim_status: 'RESEARCH_HYPOTHESES_PENDING_OWNER_NOT_VALIDATED_CAUSALITY', approved: false };
  const at = Date.parse(cutoff), visibleActuals = actuals.filter(a => Date.parse(a.available_at) <= at);
  const available = Date.parse(draft.proposed_at) <= at && [...referenced].every(id => Date.parse(get(id).first_seen_at) <= at);
  return { contract: ISSUER_REVIEW_CONTRACT, candidate_only: true, production_eligible: false, promotion_allowed: false,
    status: available ? 'PENDING_OWNER_REVIEW' : 'HOLD_NOT_AVAILABLE_AT_CUTOFF', cutoff,
    projection_sha256: expectedProjectionHash, actuals: visibleActuals, observed_standalone_actual_quarters: visibleActuals.length,
    direct_common_share_basis_quarters: visibleActuals.filter(a => a.ordinary_basis_access === 'DIRECT_DOCUMENT').length,
    issuer_guidance: guidance.filter(g => Date.parse(g.available_at) <= at), review: available ? review : null,
    blockers: ['OWNER_REVIEW_REQUIRED', 'RESOURCE_RIGHTS_UNVERIFIED', 'ORIGINAL_SOURCE_VINTAGE_UNPROVEN',
      ...(eventSource.published_at === null ? ['EXACT_EVENT_PUBLICATION_TIME_UNPROVEN'] : []),
      ...(actuals.some(a => a.ordinary_basis_access !== 'DIRECT_DOCUMENT') ? ['SOME_ORDINARY_SHARE_BASIS_INDEXED_ONLY'] : [])],
    resource_license: 'HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED', raw_retained: false,
    causal_review: null, formal_admission: false, member_publication: false, business_writes: [], forward_sample: 0, outcome_sample: 0 };
}

/** Connect to the existing method, not a new publication engine. Deliberately
 * never create news/catalyst/mapping/earnings rows or a CausalReview. Even a
 * structurally valid pending draft is NOT passed as an approved review. */
export async function previewIssuerEventReview(
  facts: IssuerFacts, draft: IssuerEventDraft, policy: IssuerReviewPolicy, expectedProjectionHash: string,
  identity: DecisionIdentity, data: EvidenceData, receipts: SourceReceipt[],
) {
  // One invocation owns one cutoff and input snapshot. A caller changing the
  // mutable canonical/receipt objects during review cannot alter stage two.
  const inputs = structuredClone({ facts, draft, policy, identity, data, receipts });
  const review = await prepareIssuerEventReview(inputs.facts, inputs.draft, inputs.policy, expectedProjectionHash, inputs.identity.generated_at);
  const alignment = await eventAlignmentFromDailyReceipts(inputs.identity, inputs.data, inputs.receipts, []);
  return { review, alignment, adapter_reviews_supplied: 0, canonical_rows_created: 0 };
}
