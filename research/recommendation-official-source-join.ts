/** Offline wiring into the ORIGINAL V1 evaluator. No DB, HTTP, clock, source
 * promotion or publication. Public availability is not a completed causal review.
 * This separate study must never be substituted for a saved formal decision. */
import type { DecisionIdentity, EvidenceData, Row } from '../supabase/functions/_shared/decision-v1-data.ts';
import { buildEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import { normalizeCompanyEvents, COMPANY_EVENT_SOURCES, type CompanyEvent } from '../supabase/functions/_shared/recommendation-company-events.ts';
import { withMarketInstitutionalEvidence, type MarketFlowCapture } from '../supabase/functions/_shared/recommendation-market-institutional-candidate.ts';
import { createRetainedQuarterActuals, withRetainedQuarterActuals } from '../supabase/functions/_shared/recommendation-quarter-actuals-candidate.ts';
import { snapshotHash, validTime } from '../src/features/vnext/contracts.ts';
import {withRetainedIssuerActualInputs, type RetainedIssuerActualInput} from './issuer-actual-v1-input.ts';

type AnnouncementSource = typeof COMPANY_EVENT_SOURCES[number];
export type OfficialAnnouncementInput = {
  source: AnnouncementSource; received_at: string; response_sha256: string;
  /** In-memory original HTTP bytes only. Raw explanations never escape. */
  response_body: Uint8Array;
};
/** Explicit subject verification, not causal/quality/publication approval. The
 * hash must match the existing official parser's exact identifying fields. */
export type OfficialSubjectReview = {
  symbol: string; source_hash: string; subject: string; reviewed_at: string;
};
export type OfficialReportedFinancialReceipt = {
  /** First acquisition may precede usability; neither instant is publication. */
  source: string; first_seen_at: string; available_at: string; source_response_sha256: string;
  status: string; source_admitted: false; published_at: null; rows: Row[];
};
const financialSources = new Set(['https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',
  'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_fh','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci']);
const timestamp = (v: unknown) => typeof v === 'string' && validTime(v) ? Date.parse(v) : NaN;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const asArray = (v: unknown): Row[] => Array.isArray(v) ? v.filter((r): r is Row => r !== null && typeof r === 'object' && !Array.isArray(r)) : [];

export async function buildOfficialV1SourceCandidate(options: {
  data: EvidenceData; identity: DecisionIdentity; market_flow?: MarketFlowCapture;
  announcements: OfficialAnnouncementInput[]; subject_reviews?: OfficialSubjectReview[];
  reported_financial_receipts?: OfficialReportedFinancialReceipt[];
  retained_issuer_actuals?: readonly RetainedIssuerActualInput[];
}) {
  // Capture once before the first await. Later caller mutations must not change
  // the subject/time/source that was verified against the original body hash.
  options = structuredClone(options);
  const { identity } = options, cutoff = timestamp(identity.generated_at);
  if (!Number.isFinite(cutoff) || identity.today_date !== identity.report_date || !identity.is_trading_day
    || new Date(cutoff + 8 * 3600000).toISOString().slice(0, 10) !== identity.report_date
    || !/^[A-Za-z0-9:_-]{1,128}$/.test(identity.revision_id) || options.announcements.length > 2
    || new Set(options.announcements.map(r => r.source.url)).size !== options.announcements.length
    || (options.subject_reviews?.length ?? 0) > 500) throw Error('OFFICIAL_JOIN_SCOPE_INVALID');
  const original = structuredClone(options.data), before = buildEvidenceDecision(original, identity);
  let data = structuredClone(original);
  const issues: string[] = [], events: CompanyEvent[] = [], receipts: Row[] = [];
  const financial = options.reported_financial_receipts ?? [];
  const financialSymbols = new Set<string>();
  if (financial.length > 3 || new Set(financial.map(r => r.source)).size !== financial.length) throw Error('OFFICIAL_FINANCIAL_SCOPE');
  for (const capture of financial) {
    const firstSeen = timestamp(capture.first_seen_at), available = timestamp(capture.available_at);
    if (!financialSources.has(capture.source) || capture.status !== 'CAPTURED_REVIEW_REQUIRED' || capture.source_admitted !== false
      || capture.published_at !== null || !hash(capture.source_response_sha256) || !Number.isFinite(firstSeen) || !Number.isFinite(available)
      || firstSeen > available || available > cutoff || !Array.isArray(capture.rows)
      || capture.rows.length > 72) throw Error('OFFICIAL_FINANCIAL_RECEIPT');
    const seen = new Set<string>();
    for (const row of capture.rows) {
      const symbol = String(row['公司代號']), year = String(row['年度']), quarter = String(row['季別']);
      if (!data.universe.some(r => r.symbol === symbol && r.is_active === true) || !/^\d{3,4}$/.test(year) || !/^[1-4]$/.test(quarter)
        || row.direct_single_quarter !== false || row.period_basis !== 'AS_REPORTED_PERIOD_BASIS_UNVERIFIED'
        || row.published_at !== null || row.consensus !== null || row.guidance !== null || row.source_admitted !== false
        || seen.has(symbol) || financialSymbols.has(symbol) || typeof row['出表日期'] !== 'string'
        || !/^\d{7,8}$/.test(row['出表日期'])) throw Error('OFFICIAL_FINANCIAL_ROW');
      seen.add(symbol);
      financialSymbols.add(symbol);
      const fiscalYear = Number(year) + (year.length === 3 ? 1911 : 0);
      if (Date.UTC(fiscalYear, Number(quarter) * 3, 0, 16) >= available) throw Error('OFFICIAL_FINANCIAL_FUTURE_PERIOD');
      const fields: Row = {};
      for (const key of ['營業收入','營業成本','營業毛利（毛損）','營業利益（損失）','本期淨利（淨損）','基本每股盈餘（元）','淨收益','利息淨收益','利息以外淨收益']) {
        if (Object.hasOwn(row, key)) {
          if (typeof row[key] !== 'string' || String(row[key]).length > 80 || !/^(?:|-?\d+(?:\.\d+)?)$/.test(String(row[key]))) throw Error('OFFICIAL_FINANCIAL_VALUE');
          fields[key] = row[key];
        }
      }
      if (!Object.hasOwn(fields, '基本每股盈餘（元）')) throw Error('OFFICIAL_FINANCIAL_VALUE');
      const sourceIdentity = { source: capture.source, response_sha256: capture.source_response_sha256, symbol,
        fiscal_period: `${fiscalYear}-Q${quarter}`, first_seen_at: capture.first_seen_at, available_at: capture.available_at,
        source_date_as_reported: row['出表日期'], reported_fields: fields };
      const joined: Row = { id: 'official-reported:' + await snapshotHash(sourceIdentity), provider: 'OFFICIAL_REPORTED_FINANCIAL_CANDIDATE',
        symbol, fiscal_period: sourceIdentity.fiscal_period, source_ref: capture.source, created_at: capture.available_at,
        announced_at: null, available_at: capture.available_at, eps_actual: null, revenue_actual: null,
        eps_consensus: null, revenue_consensus: null, guidance_direction: null, source_admitted: false,
        actual_only: false, reported_snapshot_only: true, actual_source: sourceIdentity };
      const old = data.earnings.filter(r => r.id === joined.id);
      if (old.some(r => JSON.stringify(r) !== JSON.stringify(joined))) throw Error('OFFICIAL_FINANCIAL_CONFLICT');
      if (!old.length) data.earnings.push(joined);
    }
    receipts.push({ source: capture.source, response_sha256: capture.source_response_sha256,
      normalized_rows_sha256: await snapshotHash(capture.rows), received_at: capture.first_seen_at,
      first_seen_at: capture.first_seen_at, available_at: capture.available_at, rows: capture.rows.length,
      original_publication_time: null, period_basis: 'UNPROVEN_SINGLE_QUARTER_VS_YTD', source_admitted: false });
  }
  if (options.market_flow) data = await withMarketInstitutionalEvidence(data, identity, structuredClone(options.market_flow));
  const capsule = await createRetainedQuarterActuals(identity, identity.generated_at);
  if (capsule) data = (await withRetainedQuarterActuals(data, { report_date: identity.report_date,
    producer_revision_id: identity.revision_id, producer_cutoff: identity.generated_at, evidence_cutoff: identity.generated_at }, capsule)).data;
  const retainedActuals = await withRetainedIssuerActualInputs(data, identity, options.retained_issuer_actuals ?? []);
  data = retainedActuals.data;
  receipts.push(...retainedActuals.source_receipts);
  for (const gap of retainedActuals.gaps) issues.push(String(gap.reason));
  for (const input of options.announcements) {
    if (!hash(input.response_sha256) || !Number.isFinite(timestamp(input.received_at)) || timestamp(input.received_at) > cutoff
      || !(input.response_body instanceof Uint8Array) || input.response_body.length < 2 || input.response_body.length > 3_000_000)
      throw Error('OFFICIAL_JOIN_RECEIPT_INVALID');
    const bytes = input.response_body.slice();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== input.response_sha256) throw Error('OFFICIAL_JOIN_RESPONSE_HASH_MISMATCH');
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw Error('OFFICIAL_JOIN_JSON_INVALID'); }
    const normalized = await normalizeCompanyEvents(input.source, payload, input.received_at,
      data.universe.filter(r => r.is_active === true).map(r => String(r.symbol)));
    events.push(...normalized);
    receipts.push({ source: input.source.url, response_sha256: input.response_sha256,
      payload_sha256: await snapshotHash(payload), received_at: input.received_at,
      available_at: input.received_at, source_rows: asArray(payload).length, matched_events: normalized.length,
      original_version: null, raw_retained: false, causal_review: 'NOT_PERFORMED' });
  }
  const reviews = options.subject_reviews ?? [];
  if (new Set(reviews.map(r => r.source_hash)).size !== reviews.length) throw Error('OFFICIAL_JOIN_REVIEW_DUPLICATE');
  for (const review of reviews) {
    const matched = events.filter(e => e.source_hash === review.source_hash && e.symbol === review.symbol);
    if (matched.length !== 1 || !Number.isFinite(timestamp(review.reviewed_at)) || timestamp(review.reviewed_at) > cutoff
      || timestamp(review.reviewed_at) < timestamp(matched[0]?.available_at)
      || typeof review.subject !== 'string' || review.subject !== review.subject.trim() || !review.subject || review.subject.length > 4000
      || /[\u0000-\u001f\u007f]|@|(?:\+?886|09\d\d)[\d ()-]{6,}/u.test(review.subject)) throw Error('OFFICIAL_JOIN_REVIEW_INVALID');
    const e = matched[0];
    if (await snapshotHash([e.source_ref, e.symbol, e.published_at, review.subject]) !== e.source_hash)
      throw Error('OFFICIAL_JOIN_SUBJECT_HASH_MISMATCH');
    const row: Row = { id: 'official-event:' + e.source_hash, title: review.subject,
      // A dataset URL is not an event identity. A local record-hash fragment
      // prevents old aggregate-URL catalyst refs from matching another issuer.
      summary: null, source_name: e.exchange + ' 官方重大訊息',
      source_url: e.source_ref + '#record-sha256=' + e.source_hash, source_list_url: e.source_ref,
      published_at: e.published_at, created_at: review.reviewed_at, event_type: e.event_type,
      symbols: [e.symbol], sectors: [], source_hash: e.source_hash, first_seen_at: e.available_at,
      response_sha256: receipts.find(r => r.source === e.source_ref)?.response_sha256,
      impact: 'UNKNOWN', causal_review: 'REQUIRED', publication_approved: false };
    const old = data.news.filter(r => r.id === row.id);
    if (old.some(r => JSON.stringify(r) !== JSON.stringify(row))) throw Error('OFFICIAL_JOIN_EXISTING_ROW_CONFLICT');
    if (!old.length) data.news.push(row);
  }
  if (events.some(e => !reviews.some(r => r.source_hash === e.source_hash))) issues.push('ANNOUNCEMENT_SUBJECT_REVIEW_REQUIRED');
  // Critically: no new mapping, price, institutional stock amounts, Consensus
  // or guidance is manufactured. The original missing-data gates still apply.
  const after = buildEvidenceDecision(data, identity);
  const counts = (d: typeof after) => ({ universe: d.phase_evaluation?.universe_count ?? 0,
    evaluated: d.phase_evaluation?.evaluated_count ?? 0, blocked: d.phase_evaluation?.blocked_count ?? 0,
    ready: d.phase_evaluation?.ready_count ?? 0, watch: d.phase_evaluation?.watch_count ?? 0,
    none: d.phase_evaluation?.none_count ?? 0 });
  return { contract: 'OFFICIAL_V1_SOURCE_JOIN_CANDIDATE_V1', candidate_only: true, production_authorized: false,
    identity: structuredClone(identity), source_receipts: receipts, official_events: events,
    before: counts(before), after: counts(after), decision: after, data,
    input_sha256: await snapshotHash({ identity, original, receipts, reviews, market_flow: options.market_flow ?? null }),
    issues, original_thresholds_changed: false, member_publication_approved: false,
    business_writes: [], forward_sample: 0, outcome_sample: 0 };
}
