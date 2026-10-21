/** Offline administrative intake, NOT source admission, approval or a writer.
 * Reuses the retained-original validator; PDF evidence never becomes an XBRL
 * QName. All unknown announcement/version/rights remain unknown. A DB owner
 * must independently provision source, quality and rights authorities before
 * the existing ID-only transaction could accept any prepared record.
 * No I/O, SDK, credentials, RPC or import-time side effects. */
import type {DecisionIdentity, EvidenceData, Row} from '../supabase/functions/_shared/decision-v1-data.ts';
import {withRetainedIssuerActualInputs, type RetainedIssuerActualInput} from './issuer-actual-v1-input.ts';

const object = (v: unknown): Row => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const proofCell = (v: Row) => {
  const cell = object(v.cell);
  return {page:cell.page, bbox:structuredClone(cell.bbox), period_basis:v.period_basis,
    unit:v.unit, value_decimal:v.value_decimal, resolution_decimal:v.display_resolution_decimal};
};

export async function prepareIssuerActualCanonicalIntake(data: EvidenceData, identity: DecisionIdentity,
  packets: readonly RetainedIssuerActualInput[]) {
  // Validate in an empty earnings overlay so an idempotent already-held row is
  // also prepared. The original data is never mutated or treated as approval.
  const overlay = structuredClone(data); overlay.earnings = [];
  const retained = await withRetainedIssuerActualInputs(overlay, identity, packets);
  const gaps = [...retained.gaps];
  const eligible = retained.data.earnings.filter(row => {
    // The private parser accepts 8 MiB, while this existing SQL capability has
    // an 8,000,000-byte storage contract. Do not prepare an uninsertable source
    // or silently widen the canonical bound to match a parsing limit.
    if (Number(object(row.actual_source).source_bytes) <= 8_000_000) return true;
    gaps.push({symbol:row.symbol,fiscal_period:row.fiscal_period,reason:'CANONICAL_SOURCE_BYTES_UNSUPPORTED'});
    return false;
  });
  const prepared = eligible.map(row => {
    const source = object(row.actual_source), measurements = Array.isArray(source.measurements)
      ? source.measurements.map(object) : [];
    const revenue = measurements.find(r => r.metric === 'revenue');
    const eps = measurements.find(r => r.metric === 'basic_eps');
    if (!revenue || !eps) throw Error('ISSUER_ACTUAL_INTAKE_PAIR_REQUIRED');
    const period = /^(\d{4})-Q([1-4])$/.exec(String(row.fiscal_period));
    if (!period) throw Error('ISSUER_ACTUAL_INTAKE_PERIOD');
    const measurement = {contract:'ISSUER_PDF_DIRECT_QUARTER_MEASUREMENT_V1',
      symbol:row.symbol, source_sha256:source.source_sha256, descriptor_sha256:source.descriptor_sha256,
      parser_result_sha256:source.parser_result_sha256, receipt_sha256:source.original_receipt_sha256,
      period_start:revenue.period_start, period_end:revenue.period_end,
      revenue:proofCell(revenue), eps:proofCell(eps)};
    return {
      // A link for review tooling, never an authorization or DB UUID.
      intake_key:source.parser_result_sha256,
      source:{provider:'RETAINED_ISSUER_PDF',symbol:row.symbol,source_kind:'ISSUER_FILING',
        source_format:'ISSUER_PDF_DIRECT_QUARTER_V1',source_ref:source.source_ref,
        source_sha256:source.source_sha256,source_bytes:source.source_bytes,
        receipt_document_ref:'sha256:'+String(source.original_receipt_sha256),
        receipt_document_sha256:source.original_receipt_sha256,
        source_version_ref:null,version_status:'UNKNOWN',first_seen_at:source.first_seen_at,
        available_at:source.conservative_available_at},
      actual:{symbol:row.symbol,fiscal_year:Number(period[1]),fiscal_quarter:Number(period[2]),
        period_start:revenue.period_start,period_end:revenue.period_end,period_basis:'DIRECT_STANDALONE_QUARTER',
        profile:'NONFINANCIAL_IFRS',revenue_definition:'IFRS_REVENUE',accounting_basis:'IFRS_AS_REPORTED',
        consolidation:'CONSOLIDATED',currency:'TWD',revenue_unit:'TWD',revenue_scale:1,
        revenue_resolution_twd:revenue.display_resolution_decimal,share_class:'COMMON_SHARE',eps_basis:'BASIC',
        eps_unit:'TWD_PER_COMMON_SHARE',revenue_namespace:null,revenue_concept:null,eps_namespace:null,eps_concept:null,
        revenue_locator:'PDF_PAGE:'+String(object(revenue.cell).page),eps_locator:'PDF_PAGE:'+String(object(eps.cell).page),
        revenue_actual:revenue.value_decimal,eps_actual:eps.value_decimal,pdf_measurement:measurement},
      review_requirements:{announced_at:null,announcement_precision:null,announcement_source_ref:null,
        announcement_document_sha256:null,announcement_version_ref:null,
        quality_status:'PENDING',internal_rights_status:'PENDING',source_status:'PENDING',
        required_use:'INTERNAL_CANONICAL_ACTUAL_STORAGE_ONLY'},
    };
  });
  return {contract:'ISSUER_ACTUAL_CANONICAL_INTAKE_CANDIDATE_V1',prepared,gaps,
    source_admission:false,quality_approval:false,canonical_writes:0,member_publication:false,
    forward_sample:0,outcome_sample:0};
}
