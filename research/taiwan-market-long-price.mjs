/** Source-bound long-horizon relative-price research.
 * Historical quality filters and current peer P/B sensitivities are explicit.
 * No cash-flow valuation, forecast, price target, entry band or approval.
 */
import { marketSnapshotHash } from './taiwan-market-universe.mjs';
import { compareTime, validObservationTime, sourceSafe } from '../src/features/vnext/contracts.ts';
import { coveredCalendarDate, isMarketTradingDate, previousMarketTradingDate,
  MARKET_CALENDAR_VERSION } from '../supabase/functions/_shared/market-session-contract.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Error('TAIWAN_LONG_PRICE_' + code); };
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
export const TAIWAN_LONG_PEER_PRICE_POLICY = freeze({
  version: 'TAIWAN_LONG_QUALITY_PEER_PB_V1', minimum_other_peers: 5,
  quantiles: [0.25, 0.5, 0.75], quantile_rule: 'R7_LINEAR_INTERPOLATION_AT_(N_MINUS_1)_TIMES_P',
  cohort: 'SAME_MARKET_INDUSTRY_QUOTE_DATE_AND_EXPLICIT_OFFICIAL_FINANCIAL_PERIOD',
  leave_one_out: true, instruments: ['ORDINARY_COMPANY_EQUITY'],
  annual_periods: 'THREE_COMPLETED_CALENDAR_YEARS_IMMEDIATELY_BEFORE_CUTOFF_YEAR',
  profit_basis: 'CONSOLIDATED_NET_PROFIT_AS_REPORTED_NOT_PARENT_PROFIT_SUBSTITUTION',
  annual_net_profit: 'ALL_THREE_STRICTLY_POSITIVE',
  parent_net_profit: 'REPORTED_NEGATIVE_EXCLUDES_UNKNOWN_REMAINS_NULL',
  equity_assets: 'ALL_THREE_0_LT_EQUITY_LTE_ASSETS',
  operating_cashflow: 'ALL_THREE_OBSERVED_AT_LEAST_TWO_POSITIVE_AND_THREE_YEAR_SUM_POSITIVE',
  cashflow_reconciliation: 'OBSERVED_WITHIN_YEAR_OR_CROSS_YEAR_MISMATCH_REQUIRES_REVIEW_UNKNOWN_REMAINS_NULL',
  excluded_industry_codes: ['17'], financial_industry: 'SEPARATE_CAPITAL_AND_ASSET_QUALITY_METHOD_REQUIRED',
  performance_validation: 'NOT_ESTABLISHED', methodology_approved: false,
});

function latestCompleteSession(cutoff) {
  const date = new Date(Date.parse(cutoff) + 8 * 3_600_000).toISOString().slice(0, 10);
  if (!coveredCalendarDate('TW', date)) return null;
  return isMarketTradingDate('TW', date) && compareTime(cutoff, date + 'T17:05:00+08:00') >= 0
    ? date : previousMarketTradingDate('TW', date);
}
function captureReference(value, cutoff) {
  if (value === null || value === undefined) return null;
  if (!object(value) || !hash(value.capture_id) || !hash(value.source_sha256) || !hash(value.source_row_hash)
    || typeof value.source_id !== 'string' || !value.source_id || !sourceSafe(value.source_url)
    || !Number.isSafeInteger(value.source_bytes) || value.source_bytes < 1 || value.source_bytes > 16_000_000
    || !validObservationTime(value.received_at) || compareTime(value.received_at, cutoff) > 0
    || !Number.isSafeInteger(value.row_index) || value.row_index < 0 || !Array.isArray(value.row_path)
    || !value.row_path.length || value.row_path.length > 16 || value.row_path.some(part => typeof part !== 'string' && !(Number.isSafeInteger(part) && part >= 0))
    || typeof value.symbol_field !== 'string' || !value.symbol_field) fail('CAPTURE_REFERENCE');
  const expected = marketSnapshotHash({ source_id: value.source_id, url: value.source_url,
    source_sha256: value.source_sha256, received_at: value.received_at });
  if (expected !== value.capture_id) fail('CAPTURE_ID');
  return clone(value);
}
function securityIdentity(security) {
  if (!object(security) || !object(security.company) || !Array.isArray(security.observations)
    || !['TWSE', 'TPEX', 'EMERGING'].includes(security.company.market) || !/^\d{4,6}$/.test(security.company.symbol)
    || security.security_id !== security.company.market + ':' + security.company.symbol
    || typeof security.company.industry_code !== 'string' || !security.company.industry_code) fail('SECURITY_IDENTITY');
}
function observation(security, family, cutoff) {
  const rows = security.observations.filter(row => row.family === family && !row.invalidated);
  for (const row of rows) {
    if (!validObservationTime(row.available_at) || compareTime(row.available_at, cutoff) > 0) fail('OBSERVATION_TIME');
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || compareTime(b.available_at, a.available_at));
  // The normalizer normally invalidates duplicates. Keep ambiguity unavailable
  // if an upstream caller bypasses that step; never select a convenient row.
  const latest = rows[0];
  if (rows.some((row, i) => i > 0 && row.date === latest.date)) return null;
  return latest;
}
function annualQuality(rows, years, cutoff) {
  if (rows === undefined || rows === null) return { eligible: false, reasons: ['THREE_VERIFIED_ANNUAL_PERIODS_REQUIRED'], annuals: [] };
  if (!Array.isArray(rows) || rows.length > 20) fail('ANNUAL_METRICS');
  const byYear = new Map();
  for (const row of rows) {
    if (!object(row) || !Number.isInteger(row.year) || row.year < 1912 || row.year > 2200 || byYear.has(row.year)) fail('ANNUAL_YEAR');
    byYear.set(row.year, row);
  }
  const reasons = [], annuals = [];
  for (const year of years) {
    const row = byYear.get(year);
    if (!row) { reasons.push(year + '_ANNUAL_PERIOD_REQUIRED'); continue; }
    const values = {};
    for (const key of ['net_profit', 'parent_net_profit', 'equity', 'assets', 'operating_cashflow']) {
      const value = row[key]; if (value !== null && value !== undefined && !finite(value)) fail('ANNUAL_VALUE'); values[key] = value ?? null;
    }
    if (row.period_verified !== true || row.unit_verified !== true) reasons.push(year + '_ANNUAL_PERIOD_AND_UNIT_VERIFICATION_REQUIRED');
    if (!object(row.source_captures)) reasons.push(year + '_ANNUAL_SOURCE_CAPTURES_REQUIRED');
    const source_captures = {};
    for (const family of ['income', 'balance', 'cashflow']) {
      source_captures[family] = captureReference(row.source_captures?.[family], cutoff);
      if (!source_captures[family]) reasons.push(year + '_' + family.toUpperCase() + '_RAW_REFERENCE_REQUIRED');
    }
    const reconciliation = row.cashflow_reconciliation ? clone(row.cashflow_reconciliation) : null;
    if (reconciliation !== null && (!object(reconciliation)
      || ![null, true, false].includes(reconciliation.within_year)
      || ![null, true, false].includes(reconciliation.opening_matches_previous_closing))) fail('CASHFLOW_RECONCILIATION');
    if (reconciliation?.within_year === false || reconciliation?.opening_matches_previous_closing === false)
      reasons.push(year + '_CASHFLOW_BALANCE_RECONCILIATION_REVIEW_REQUIRED');
    const annual = { year, ...values, cashflow_reconciliation: reconciliation, period_verified: row.period_verified === true, unit_verified: row.unit_verified === true, source_captures };
    annuals.push(annual);
    if (['net_profit', 'equity', 'assets', 'operating_cashflow'].some(key => values[key] === null)) reasons.push(year + '_OBSERVED_QUALITY_FIELDS_REQUIRED');
    if (values.net_profit !== null && values.net_profit <= 0) reasons.push(year + '_POSITIVE_CONSOLIDATED_NET_PROFIT_REQUIRED');
    if (values.parent_net_profit !== null && values.parent_net_profit < 0) reasons.push(year + '_REPORTED_PARENT_LOSS');
    if (values.equity !== null && values.assets !== null && !(values.equity > 0 && values.assets >= values.equity)) reasons.push(year + '_POSITIVE_EQUITY_WITHIN_ASSETS_REQUIRED');
  }
  const cashflows = annuals.map(row => row.operating_cashflow), observed = annuals.length === 3 && cashflows.every(finite);
  const cashflow_sum = observed ? cashflows.reduce((sum, value) => sum + value, 0) : null;
  if (observed && !finite(cashflow_sum)) fail('CASHFLOW_SUM_RANGE');
  if (observed && cashflows.filter(value => value > 0).length < 2) reasons.push('AT_LEAST_TWO_POSITIVE_OPERATING_CASHFLOW_YEARS_REQUIRED');
  if (observed && cashflow_sum <= 0) reasons.push('POSITIVE_THREE_YEAR_OPERATING_CASHFLOW_SUM_REQUIRED');
  return { eligible: reasons.length === 0 && annuals.length === 3, reasons: [...new Set(reasons)], annuals,
    operating_cashflow_sum: cashflow_sum,
    parent_profit_disclosure: { reported_years: annuals.filter(row => row.parent_net_profit !== null).length,
      missing_years: annuals.filter(row => row.parent_net_profit === null).map(row => row.year),
      profit_filter_basis: 'CONSOLIDATED_NET_PROFIT_AS_REPORTED' } };
}
function eligibleSecurity(security, annuals, years, cutoff, date, financialPeriod = null) {
  const reasons = [];
  if (security.company.instrument_kind !== 'ORDINARY_COMPANY_EQUITY') reasons.push('ORDINARY_COMPANY_EQUITY_REQUIRED');
  if (TAIWAN_LONG_PEER_PRICE_POLICY.excluded_industry_codes.includes(security.company.industry_code)) reasons.push('FINANCIAL_SECTOR_QUALITY_METHOD_REQUIRED');
  const quote = observation(security, 'PRICE', cutoff), valuation = observation(security, 'VALUATION', cutoff);
  if (!quote?.valid_trade || !finite(quote.close) || quote.close <= 0 || quote.date !== date) reasons.push('CURRENT_COMPLETE_SESSION_PRICE_REQUIRED');
  if (!valuation || valuation.date !== date || !finite(valuation.close) || valuation.close <= 0 || valuation.close !== quote?.close
    || !finite(valuation.pb) || valuation.pb <= 0 || !/^\d{4}Q[1-4]$/.test(valuation.financial_period ?? '')) reasons.push('SAME_PRICE_DATE_AND_EXPLICIT_OFFICIAL_PB_PERIOD_REQUIRED');
  if (financialPeriod !== null && valuation?.financial_period !== financialPeriod) reasons.push('SAME_OFFICIAL_FINANCIAL_PERIOD_REQUIRED');
  const quote_source = captureReference(quote?.source_capture, cutoff), valuation_source = captureReference(valuation?.source_capture, cutoff);
  if (!quote_source || !valuation_source) reasons.push('QUOTE_AND_PB_RAW_CAPTURE_REFERENCES_REQUIRED');
  for (const [row, source] of [[quote, quote_source], [valuation, valuation_source]]) {
    if (row && source && compareTime(row.available_at, source.received_at) !== 0) fail('OBSERVATION_RECEIPT_BINDING');
  }
  const quality = annualQuality(annuals, years, cutoff); reasons.push(...quality.reasons);
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], quote, valuation, quality,
    market_source_captures: { quote: quote_source, official_pb: valuation_source } };
}
function quantile(sorted, p) {
  const position = (sorted.length - 1) * p, lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}
function sealed(value) { return freeze({ ...value, reference_hash: marketSnapshotHash(value) }); }

/** annual_metrics is a Map keyed by security_id. The upstream financial
 * normalizer supplies verified annual periods, consistent units and raw-row
 * bindings; this function checks those bindings but does not reparse raw bytes.
 */
export function calculateTaiwanLongPeerReference({ security_id, securities, annual_metrics, cutoff, expected_quote_date = undefined }) {
  if (!validObservationTime(cutoff) || !Array.isArray(securities) || !securities.length || securities.length > 10_000
    || !(annual_metrics instanceof Map) || typeof security_id !== 'string') fail('INPUT');
  const ids = new Set();
  for (const security of securities) { securityIdentity(security); if (ids.has(security.security_id)) fail('DUPLICATE_SECURITY'); ids.add(security.security_id); }
  const security = securities.find(item => item.security_id === security_id); if (!security) fail('ISSUER_NOT_IN_UNIVERSE');
  const date = latestCompleteSession(cutoff);
  if (expected_quote_date !== undefined && expected_quote_date !== date) fail('EXPECTED_SESSION_MISMATCH');
  const cutoffYear = Number(new Date(Date.parse(cutoff) + 8 * 3_600_000).toISOString().slice(0, 4));
  const years = [cutoffYear - 3, cutoffYear - 2, cutoffYear - 1];
  const common = { schema: 'TAIWAN_LONG_QUALITY_PEER_PB_REFERENCE_V1', method_version: TAIWAN_LONG_PEER_PRICE_POLICY.version,
    method: 'CURRENT_PRICE_TIMES_QUALITY_MATCHED_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB',
    security_id, horizon: 'LONG', cutoff, expected_quote_date: date, calendar_version: MARKET_CALENDAR_VERSION,
    market: security.company.market, industry_code: security.company.industry_code, currency: 'TWD',
    quality_years: years, policy: TAIWAN_LONG_PEER_PRICE_POLICY, policy_hash: marketSnapshotHash(TAIWAN_LONG_PEER_PRICE_POLICY),
    research_only: true, methodology_approved: false, production_eligible: false, buy_ready: false, member_published: false,
    forecast: false, performance_available: false, review: null, source_use_review: null,
    range_meaning: 'QUALITY_MATCHED_PEER_PB_RERATING_SENSITIVITY_NOT_INTRINSIC_VALUE_OR_TARGET',
    source_value_validation_scope: 'UPSTREAM_NORMALIZED_ANNUAL_RECORDS_AND_RAW_ROW_REFERENCES_NOT_REPARSED_HERE',
    limitations: [
      'Peer P/B values are current market observations, not a calibrated fair-value or return model.',
      'Consolidated net profit is not substituted for parent-attributable profit; missing parent profit remains unknown.',
      'Operating cash flow is not free cash flow to equity. Capital expenditure, financing and future distributions are not modelled.',
      'Official P/B rounding and accounting differences affect the sensitivity. No inferred EPS or book-value-per-share is asserted.',
      'The selected three annual periods and current roster are as-of research, not a point-in-time historical backtest.',
      'Quantile values are sample ranks, not probability bounds, execution prices or a time-to-realization forecast.',
    ] };
  if (!date) return sealed({ ...common, state: 'UNAVAILABLE', reason: 'TRADING_CALENDAR_COVERAGE_REQUIRED', peer_count: 0 });
  const issuer = eligibleSecurity(security, annual_metrics.get(security_id), years, cutoff, date);
  if (!issuer.eligible) return sealed({ ...common, state: 'UNAVAILABLE', reason: 'ISSUER_QUALITY_AND_PRICE_REQUIREMENTS_NOT_MET',
    reasons: issuer.reasons, issuer_quality: issuer.quality, issuer_source_captures: issuer.market_source_captures, peer_count: 0 });
  const peers = [], excluded_peers = [];
  const candidates = securities.filter(other => other.security_id !== security_id && other.company.market === security.company.market
    && other.company.industry_code === security.company.industry_code);
  for (const other of candidates) {
    const result = eligibleSecurity(other, annual_metrics.get(other.security_id), years, cutoff, date, issuer.valuation.financial_period);
    if (!result.eligible) {
      excluded_peers.push({ security_id: other.security_id, reasons: result.reasons,
        evaluated_input_hash: marketSnapshotHash({ company: other.company, quote: result.quote, valuation: result.valuation, quality: result.quality }) });
      continue;
    }
    peers.push({ security_id: other.security_id, official_pb: result.valuation.pb, quote_date: result.quote.date,
      current_price: result.quote.close, financial_period: result.valuation.financial_period,
      market_source_captures: result.market_source_captures, annual_quality: result.quality });
  }
  peers.sort((a, b) => a.security_id.localeCompare(b.security_id)); excluded_peers.sort((a, b) => a.security_id.localeCompare(b.security_id));
  const universe_scope_hash = marketSnapshotHash(securities.map(item => ({ security_id: item.security_id,
    market: item.company.market, industry_code: item.company.industry_code,
    instrument_kind: item.company.instrument_kind })).sort((a, b) => a.security_id.localeCompare(b.security_id)));
  const input = { security_id, cutoff, quote_date: date, current_price: issuer.quote.close, official_pb: issuer.valuation.pb,
    financial_period: issuer.valuation.financial_period, issuer_quality: issuer.quality,
    issuer_source_captures: issuer.market_source_captures, peers, excluded_peers, universe_scope_hash, policy_hash: common.policy_hash };
  const binding = { input_hash: marketSnapshotHash(input), universe_scope_hash,
    input_hash_scope: 'ISSUER_SELECTED_PEERS_EVALUATED_EXCLUSION_HASHES_AND_SUPPLIED_UNIVERSE_IDENTITIES',
    current_price: issuer.quote.close, current_official_pb: issuer.valuation.pb,
    quote_date: date, financial_period: issuer.valuation.financial_period, issuer_quality: issuer.quality,
    issuer_source_captures: issuer.market_source_captures, peer_count: peers.length, same_scope_candidates: candidates.length,
    peers, excluded_peers, issuer_excluded_from_peer_sample: true };
  if (peers.length < TAIWAN_LONG_PEER_PRICE_POLICY.minimum_other_peers) return sealed({ ...common, ...binding,
    state: 'UNAVAILABLE', reason: 'AT_LEAST_FIVE_OTHER_QUALITY_MATCHED_PEERS_REQUIRED' });
  const multiples = peers.map(peer => peer.official_pb).sort((a, b) => a - b);
  const multiple_scenarios = TAIWAN_LONG_PEER_PRICE_POLICY.quantiles.map(p => quantile(multiples, p));
  const price_scenarios = multiple_scenarios.map(pb => issuer.quote.close * (pb / issuer.valuation.pb));
  if (price_scenarios.some(value => !finite(value) || value <= 0)) fail('PRICE_ARITHMETIC_RANGE');
  return sealed({ ...common, ...binding, state: 'CALCULATED_RESEARCH_ONLY', metric: 'PB',
    peer_quantiles: [...TAIWAN_LONG_PEER_PRICE_POLICY.quantiles], multiple_scenarios, price_scenarios,
    arithmetic: { formula: 'current_price * (peer_pb_quantile / current_official_pb)', rounding: 'NONE_RESEARCH_VALUES_NOT_ORDER_TICKS',
      example_unit: 'TWD_PER_SHARE_TIMES_DIMENSIONLESS_PB_RATIO' } });
}
