/** Offline bridge for already-normalized issuer originals into the ORIGINAL V1
 * input. Not a SourceReceipt, canonical writer, source admission or prediction.
 * A pinned parser-result digest proves retained bytes, never issuer/rights review.
 * Importing performs no I/O; unreviewed publication/version fields stay null. */
import type {DecisionIdentity, EvidenceData, Row} from '../supabase/functions/_shared/decision-v1-data.ts';
import {snapshotHash, validTime, validObservationTime, compareTime, sourceSafe} from '../src/features/vnext/contracts.ts';

export type RetainedIssuerActualInput = {parsed: unknown; parsed_sha256: string};
const object = (v: unknown): Row => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const time = (v: unknown) => typeof v === 'string' && validTime(v) ? Date.parse(v) : NaN;
const observedTime = (v: unknown): v is string => typeof v === 'string' && validObservationTime(v);
const ordered = (a: unknown,b: unknown) => observedTime(a) && observedTime(b) && compareTime(a,b) <= 0;
function refuse(ok: unknown, code: string): asserts ok {if (!ok) throw Error('ISSUER_ACTUAL_INPUT_' + code);}
const zeroApproval = (v: Row) => ['source_admission','quality_admission','member_publication',
  'symbol_to_issuer_mapping_reviewed','accounting_classification_reviewed'].every(k => v[k] === false);
const numeric = (v: unknown): number => {
  // Python Decimal preserves small displayed resolutions as e.g. 1E-8. Accept
  // that exact bounded dialect, not arbitrary Number coercion or underflow.
  refuse(typeof v === 'string' && v.length <= 64, 'DECIMAL');
  const match = /^-?\d{1,40}(?:\.(\d{1,12}))?(?:E([+-]?\d{1,2}))?$/.exec(v);
  refuse(match, 'DECIMAL');
  const exponent = Number(match[2] ?? 0);
  refuse(exponent >= -12 && exponent <= 16 && (match[1]?.length ?? 0) - exponent <= 12, 'DECIMAL');
  const n = Number(v); refuse(Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER, 'DECIMAL'); return n;
};

/** Complete native Revenue + BASIC ordinary EPS pairs only. Missing pairs are
 * retained as explicit private gaps, not zero values or generic financial revenue.
 * Source/quality/rights/announcement checks in canonical SQL are NOT bypassed. */
export async function withRetainedIssuerActualInputs(data: EvidenceData, identity: DecisionIdentity,
  packets: readonly RetainedIssuerActualInput[]) {
  // Freeze before await: a caller cannot retarget the original after its digest.
  const inputs = structuredClone(packets), original = structuredClone(data), id = structuredClone(identity);
  const cutoff = time(id.generated_at);
  refuse(Number.isFinite(cutoff) && id.is_trading_day && id.today_date === id.report_date
    && new Date(cutoff + 8 * 3600000).toISOString().slice(0,10) === id.report_date
    && /^[A-Za-z0-9:_-]{1,128}$/.test(id.revision_id), 'IDENTITY');
  refuse(Array.isArray(inputs) && inputs.length <= 288, 'SCOPE');
  const active = new Set(original.universe.filter(r => r.is_active === true).map(r => r.symbol));
  const seen = new Set<string>(), appended: Row[] = [], receipts: Row[] = [], gaps: Row[] = [];
  let totalBytes = 0;
  for (const packet of inputs) {
    const encoded = JSON.stringify(packet.parsed), bytes = new TextEncoder().encode(encoded).length;
    totalBytes += bytes;
    refuse(bytes > 0 && bytes <= 131072 && totalBytes <= 8_000_000 && hash(packet.parsed_sha256)
      && await snapshotHash(packet.parsed) === packet.parsed_sha256, 'PARSER_DIGEST');
    const p = object(packet.parsed), period = object(p.period_evidence), accounting = object(p.accounting);
    refuse(p.contract === 'issuer-pdf-descriptor-candidate-v1' && p.descriptor_is_approval === false
      && p.private_operator_only === true && p.untrusted_service_sandbox === false && zeroApproval(p)
      && p.ytd_or_annual_subtraction_used === false && p.canonical_writer_invoked === false
      && p.announced_at === null && p.source_version === null && p.revision_chain === null
      && p.legal_reuse_approval === null, 'PRIVATE_CONTRACT');
    refuse(typeof p.entity === 'string' && active.has(p.entity) && /^\d{4,6}$/.test(p.entity)
      && typeof p.source_url === 'string' && sourceSafe(p.source_url) && hash(p.source_sha256)
      && hash(p.descriptor_sha256) && hash(p.receipt_sha256) && Number.isSafeInteger(p.source_bytes)
      && Number(p.source_bytes) > 0 && Number(p.source_bytes) <= 8 * 1024 * 1024, 'SOURCE');
    refuse(ordered(p.first_seen_at,p.source_available_at) && ordered(p.source_available_at,p.first_verified_at)
      && ordered(p.first_verified_at,p.normalization_available_at) && ordered(p.normalization_available_at,p.conservative_available_at)
      && ordered(p.conservative_available_at,id.generated_at) && (p.source_received_at === null
        || ordered(p.first_seen_at,p.source_received_at) && ordered(p.source_received_at,p.source_available_at)), 'TIME');
    refuse(p.capture_kind === 'HTTP_RESPONSE_RECEIPT' && p.http_status === 200 && p.http_status_observed === true
      || p.capture_kind === 'BROWSER_NATIVE_PUBLIC_DOWNLOAD_RECEIPT_V1' && p.http_status === null
        && p.http_status_observed === false, 'CAPTURE_KIND');
    const year = period.year, quarter = period.quarter;
    refuse(Number.isInteger(year) && Number(year) >= 1900 && Number(year) <= 2200
      && Number.isInteger(quarter) && Number(quarter) >= 1 && Number(quarter) <= 4, 'PERIOD');
    const start = new Date(Date.UTC(Number(year), (Number(quarter)-1)*3, 1)).toISOString().slice(0,10);
    const end = new Date(Date.UTC(Number(year), Number(quarter)*3, 0)).toISOString().slice(0,10);
    const afterQuarter = new Date(Date.UTC(Number(year),Number(quarter)*3,1)-8*3600000).toISOString();
    refuse(period.period_start === start && period.period_end === end && ordered(afterQuarter,p.first_seen_at), 'PERIOD');
    const fiscal = `${year}-Q${quarter}`, key = `${p.entity}:${fiscal}`;
    refuse(!seen.has(key), 'DUPLICATE_QUARTER'); seen.add(key);
    refuse(Array.isArray(p.rows) && p.rows.length > 0 && p.rows.length <= 2, 'ROWS');
    const rows = p.rows.map(object), metrics = new Set(rows.map(r => r.metric));
    refuse(metrics.size === rows.length, 'DUPLICATE_METRIC');
    for (const r of rows) {
      refuse(r.entity === p.entity && r.source_sha256 === p.source_sha256 && r.fiscal_period === `${year}Q${quarter}`
        && r.period_start === start && r.period_end === end && r.scope === 'CONSOLIDATED' && r.currency === 'TWD'
        && ['DIRECT_THREE_MONTHS','DIRECT_SINGLE_QUARTER_AS_REPORTED'].includes(String(r.period_basis))
        && zeroApproval(r) && ['revenue','basic_eps'].includes(String(r.metric)), 'MEASUREMENT');
      numeric(r.value_decimal); refuse(numeric(r.display_resolution_decimal) > 0, 'RESOLUTION');
      const cell = object(r.cell);
      refuse(Number.isSafeInteger(cell.page) && Number(cell.page) > 0 && Number(cell.page) <= 160 && Array.isArray(cell.bbox)
        && cell.bbox.length === 4 && cell.bbox.every(v => typeof v === 'number' && Number.isFinite(v))
        && cell.bbox[0] >= 0 && cell.bbox[1] >= 0 && cell.bbox[2] > cell.bbox[0] && cell.bbox[3] > cell.bbox[1], 'LOCATOR');
      if (r.metric === 'revenue') refuse(r.unit === 'TWD' && r.share_proof === null, 'REVENUE_UNIT');
      else {
        const shares = object(r.share_proof);
        refuse(r.unit === 'TWD/ordinary_share' && r.multiplier === '1'
          && shares.share_class === 'ORDINARY' && shares.eps_basis === 'BASIC', 'EPS_UNIT');
      }
    }
    const receipt = {symbol:p.entity, fiscal_period:fiscal, parser_result_sha256:packet.parsed_sha256,
      descriptor_sha256:p.descriptor_sha256, source_ref:p.source_url, source_sha256:p.source_sha256,
      source_bytes:p.source_bytes, original_receipt_sha256:p.receipt_sha256,
      first_seen_at:p.first_seen_at, source_received_at:p.source_received_at, source_available_at:p.source_available_at,
      first_verified_at:p.first_verified_at, normalization_available_at:p.normalization_available_at,
      conservative_available_at:p.conservative_available_at, input_prepared_at:id.generated_at,
      published_at:null, source_version:null, revision_chain:null, legal_reuse_approval:null,
      source_admitted:false, quality_admission:false, member_publication:false};
    receipts.push(receipt);
    if (!metrics.has('revenue') || !metrics.has('basic_eps')) {
      gaps.push({symbol:p.entity,fiscal_period:fiscal,reason:'NATIVE_ACTUAL_PAIR_INCOMPLETE'}); continue;
    }
    // Classification is still an UNREVIEWED source claim. Never adapt financial
    // net revenue into generic Revenue; the formal metric-method review stays held.
    if (!['FSC_ENDORSED_IAS34_INTERIM','FSC_ENDORSED_IFRS',
      'IFRS_AS_ENDORSED_BY_FSC_ANNUAL_POLICY_REVIEW_BOUND'].includes(String(accounting.classification))) {
      gaps.push({symbol:p.entity,fiscal_period:fiscal,reason:'ACCOUNTING_CLASSIFICATION_REVIEW_REQUIRED'}); continue;
    }
    const revenue = rows.find(r => r.metric === 'revenue')!, eps = rows.find(r => r.metric === 'basic_eps')!;
    const row: Row = {id:'held-issuer-actual:' + await snapshotHash({parser:packet.parsed_sha256,identity:id}),
      provider:'RETAINED_ISSUER_PDF_UNADMITTED',symbol:p.entity,fiscal_period:fiscal,source_ref:p.source_url,
      announced_at:null,created_at:id.generated_at,available_at:id.generated_at,
      revenue_actual:numeric(revenue.value_decimal),eps_actual:numeric(eps.value_decimal),
      revenue_consensus:null,eps_consensus:null,guidance_direction:null,actual_only:true,source_admitted:false,
      member_publication_approved:false,legal_reuse_approval:null,revision_chain:null,
      actual_source:{...receipt,accounting_classification:accounting.classification,accounting_classification_reviewed:false,
        symbol_to_issuer_mapping_reviewed:false,source_format:'ISSUER_PDF_NOT_INLINE_XBRL',
        measurements:rows.map(r => ({metric:r.metric,value_decimal:r.value_decimal,display_resolution_decimal:r.display_resolution_decimal,
          unit:r.unit,period_basis:r.period_basis,scope:r.scope,period_start:r.period_start,period_end:r.period_end,
          cell:{page:object(r.cell).page,bbox:[...(object(r.cell).bbox as number[])]},
          eps_basis:r.metric === 'basic_eps' ? 'BASIC' : null,share_class:r.metric === 'basic_eps' ? 'ORDINARY' : null}))}};
    // A later evaluation is not a new source revision. Keep the first private
    // row (including its original ID and preparation/availability times) intact
    // when exactly the same validated packet is reconsidered at a newer cutoff.
    // Never use this read-side reuse as admission, correction or an overwrite.
    const quarterRows = original.earnings.filter(r => r.provider === 'RETAINED_ISSUER_PDF_UNADMITTED'
      && r.symbol === p.entity && r.fiscal_period === fiscal);
    refuse(quarterRows.length <= 1, 'EXISTING_QUARTER_CONFLICT');
    if (quarterRows.length) {
      const prior = quarterRows[0], source = object(prior.actual_source);
      refuse(source.parser_result_sha256 === packet.parsed_sha256, 'EXISTING_QUARTER_CONFLICT');
      refuse(typeof prior.id === 'string' && /^held-issuer-actual:[a-f0-9]{64}$/.test(prior.id)
        && prior.created_at === prior.available_at && source.input_prepared_at === prior.created_at
        && ordered(p.conservative_available_at,prior.created_at) && ordered(prior.created_at,id.generated_at),
      'EXISTING_ROW_CONFLICT');
      const expected = {...row,id:prior.id,created_at:prior.created_at,available_at:prior.available_at,
        actual_source:{...object(row.actual_source),input_prepared_at:prior.created_at}};
      // JSONB round trips may reorder object keys. Compare the complete canonical
      // values, not serialization order; arrays, amounts and all flags still bind.
      refuse(await snapshotHash(prior) === await snapshotHash(expected), 'EXISTING_ROW_CONFLICT');
    } else {
      // A duplicate ID outside its validated company/quarter must not turn an
      // append into implicit reuse of a differently scoped existing row.
      refuse(!original.earnings.some(r => r.id === row.id), 'EXISTING_ROW_CONFLICT');
      appended.push(row);
    }
  }
  return {data:{...original,earnings:[...original.earnings,...appended]},source_receipts:receipts,gaps,
    appended_rows:appended.length,source_admission:false,canonical_writes:0,member_publication:false,
    forward_sample:0,outcome_sample:0};
}
