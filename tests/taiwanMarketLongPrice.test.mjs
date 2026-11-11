// SYNTHETIC_TEST_ONLY. No provider, SQL, review, publication or actual return.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { calculateTaiwanLongPeerReference, TAIWAN_LONG_PEER_PRICE_POLICY } from '../research/taiwan-market-long-price.mjs';
import { marketSnapshotHash } from '../research/taiwan-market-universe.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const cutoff = '2026-11-11T11:00:00.000Z', received = '2026-11-11T10:00:00.000000Z';
const quoteDate = '2026-11-11';
function reference(family, symbol, year = 2026) {
  const source_id = 'SYNTHETIC_' + family + '_' + year, source_url = 'https://openapi.twse.com.tw/v1/opendata/synthetic_fixture_' + family;
  const source_sha256 = sha('SYNTHETIC_RAW_BYTES:' + source_id);
  const body = { source_id, url: source_url, source_sha256, received_at: received };
  return { capture_id: marketSnapshotHash(body), source_id, source_url, source_sha256, source_bytes: 100,
    received_at: received, row_index: Number(symbol) - 1000, row_path: [Number(symbol) - 1000],
    symbol_field: '公司代號', source_row_hash: sha('SYNTHETIC_ROW:' + source_id + ':' + symbol), synthetic_fixture: true };
}
function fixture(multiples = [1, 2, 3, 4, 5]) {
  const securities = [], annual_metrics = new Map();
  for (const [index, pb] of [2, ...multiples].entries()) {
    const symbol = String(1000 + index), security_id = 'TWSE:' + symbol;
    securities.push({ security_id, company: { security_id, market: 'TWSE', symbol, company: 'SYNTHETIC issuer ' + symbol,
      industry_code: '24', instrument_kind: 'ORDINARY_COMPANY_EQUITY' }, observations: [
      { family: 'PRICE', date: quoteDate, close: 100, valid_trade: true, available_at: received, source_capture: reference('PRICE', symbol) },
      { family: 'VALUATION', date: quoteDate, close: 100, pb, financial_period: '2026Q3',
        available_at: received, source_capture: reference('VALUATION', symbol) },
    ] });
    annual_metrics.set(security_id, [2023, 2024, 2025].map(year => ({ year, net_profit: 100, parent_net_profit: 80,
      equity: 500, assets: 1000, operating_cashflow: 120, period_verified: true, unit_verified: true,
      source_captures: { income: reference('INCOME', symbol, year), balance: reference('BALANCE', symbol, year),
        cashflow: reference('CASHFLOW', symbol, year) } })));
  }
  return { security_id: 'TWSE:1000', securities, annual_metrics, cutoff, expected_quote_date: quoteDate };
}
const calc = fixture => calculateTaiwanLongPeerReference(fixture);
const values = (f, id = f.security_id) => f.annual_metrics.get(id);

test('an observed cash reconciliation mismatch requires review without inventing a zero or alleging fraud', () => {
  const f = fixture();
  values(f)[1].cashflow_reconciliation = { within_year: true, opening_matches_previous_closing: false,
    tolerance_twd_thousands: 2, interpretation: 'MISMATCH_REQUIRES_RESTATEMENT_OR_RECLASSIFICATION_REVIEW_NOT_FRAUD_INFERENCE' };
  const r = calc(f); assert.notEqual(r.state, 'CALCULATED_RESEARCH_ONLY');
  assert.ok(r.reasons.includes('2024_CASHFLOW_BALANCE_RECONCILIATION_REVIEW_REQUIRED'));
  assert.equal(r.issuer_quality.annuals[1].cashflow_reconciliation.opening_matches_previous_closing, false);
  values(f)[1].cashflow_reconciliation.opening_matches_previous_closing = null;
  assert.equal(calc(f).state, 'CALCULATED_RESEARCH_ONLY');
});
function renameMarket(f, index, market) {
  const s = f.securities[index], before = s.security_id, after = market + ':' + s.company.symbol;
  s.security_id = after; s.company.security_id = after; s.company.market = market;
  f.annual_metrics.set(after, f.annual_metrics.get(before)); f.annual_metrics.delete(before);
}

test('exact P/B sensitivity: five other qualified peers [1,2,3,4,5] imply [100,150,200] from issuer 100/PB2', () => {
  const f = fixture(), r = calc(f);
  assert.equal(r.state, 'CALCULATED_RESEARCH_ONLY'); assert.equal(r.peer_count, 5);
  assert.deepEqual(r.multiple_scenarios, [2, 3, 4]); assert.deepEqual(r.price_scenarios, [100, 150, 200]);
  assert.deepEqual(r.peer_quantiles, [0.25, 0.5, 0.75]); assert.equal(r.issuer_excluded_from_peer_sample, true);
  assert.ok(r.peers.every(peer => peer.security_id !== f.security_id));
  assert.equal(r.policy.profit_basis, 'CONSOLIDATED_NET_PROFIT_AS_REPORTED_NOT_PARENT_PROFIT_SUBSTITUTION');
  assert.equal(r.forecast, false); assert.equal(r.production_eligible, false); assert.equal(r.buy_ready, false);
  assert.equal(r.methodology_approved, false); assert.equal(r.review, null); assert.equal(r.source_use_review, null);
  assert.equal(r.member_published, false); assert.equal(r.performance_available, false);
  assert.match(r.range_meaning, /NOT_INTRINSIC_VALUE_OR_TARGET/); assert.equal(Object.hasOwn(r, 'entry_range'), false);
});

test('R7 interpolation is deterministic for an even peer sample and does not turn ranks into probabilities', () => {
  const f = fixture([1, 2, 4, 8, 16, 32]), r = calc(f);
  assert.deepEqual(r.multiple_scenarios, [2.5, 6, 14]); assert.deepEqual(r.price_scenarios, [125, 300, 700]);
  const reversed = { ...f, securities: [...f.securities].reverse() };
  assert.equal(calc(reversed).reference_hash, r.reference_hash);
  assert.ok(r.limitations.some(text => text.includes('not probability bounds')));
});

test('leave-one-out remains explicit even if the issuer P/B is an extreme outlier', () => {
  const f = fixture(); f.securities[0].observations[1].pb = 500;
  const r = calc(f); assert.deepEqual(r.multiple_scenarios, [2, 3, 4]);
  assert.deepEqual(r.price_scenarios, [0.4, 0.6, 0.8]); assert.equal(r.peer_count, 5);
});

test('minimum sample is five OTHER peers; four never produce a price, empty array or zero fallback', () => {
  const f = fixture([1, 2, 3, 4]), r = calc(f);
  assert.equal(r.state, 'UNAVAILABLE'); assert.equal(r.peer_count, 4);
  assert.equal(r.reason, 'AT_LEAST_FIVE_OTHER_QUALITY_MATCHED_PEERS_REQUIRED');
  assert.equal(Object.hasOwn(r, 'price_scenarios'), false); assert.equal(r.buy_ready, false);
});

test('peer matching requires identical market, industry, current quote day and official financial period', () => {
  const f = fixture([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  renameMarket(f, 6, 'TPEX'); f.securities[7].company.industry_code = '25';
  f.securities[8].observations[1].financial_period = '2026Q2';
  for (const o of f.securities[9].observations) o.date = '2026-11-10';
  const r = calc(f); assert.equal(r.peer_count, 5); assert.deepEqual(r.multiple_scenarios, [2, 3, 4]);
  assert.equal(r.same_scope_candidates, 7); assert.equal(r.excluded_peers.length, 2);
  assert.ok(r.excluded_peers.find(p => p.security_id === 'TWSE:1008').reasons.includes('SAME_OFFICIAL_FINANCIAL_PERIOD_REQUIRED'));
  assert.ok(r.excluded_peers.find(p => p.security_id === 'TWSE:1009').reasons.includes('CURRENT_COMPLETE_SESSION_PRICE_REQUIRED'));
  assert.ok(r.excluded_peers.every(p => /^[a-f0-9]{64}$/.test(p.evaluated_input_hash)));
});

test('issuer and peers use the same three-year quality filters; a huge bad-quality P/B does not move a quantile', () => {
  const f = fixture([1, 2, 3, 4, 5, 1000]);
  values(f, 'TWSE:1006')[1].net_profit = -1;
  const r = calc(f); assert.equal(r.peer_count, 5); assert.deepEqual(r.price_scenarios, [100, 150, 200]);
  assert.ok(r.excluded_peers[0].reasons.includes('2024_POSITIVE_CONSOLIDATED_NET_PROFIT_REQUIRED'));
  values(f)[1].net_profit = -1;
  const badIssuer = calc(f); assert.equal(badIssuer.state, 'UNAVAILABLE');
  assert.ok(badIssuer.reasons.includes('2024_POSITIVE_CONSOLIDATED_NET_PROFIT_REQUIRED'));
});

test('three real CFO values are required; at least two must be positive and their three-year sum positive', () => {
  const f = fixture(); [-20, 10, 11].forEach((v, i) => { values(f)[i].operating_cashflow = v; });
  let r = calc(f); assert.equal(r.state, 'CALCULATED_RESEARCH_ONLY'); assert.equal(r.issuer_quality.operating_cashflow_sum, 1);
  values(f)[0].operating_cashflow = -22; r = calc(f);
  assert.equal(r.state, 'UNAVAILABLE'); assert.ok(r.reasons.includes('POSITIVE_THREE_YEAR_OPERATING_CASHFLOW_SUM_REQUIRED'));
  values(f)[0].operating_cashflow = null; r = calc(f);
  assert.equal(r.issuer_quality.operating_cashflow_sum, null); assert.ok(r.reasons.includes('2023_OBSERVED_QUALITY_FIELDS_REQUIRED'));
  [0, 0, 10].forEach((v, i) => { values(f)[i].operating_cashflow = v; }); r = calc(f);
  assert.ok(r.reasons.includes('AT_LEAST_TWO_POSITIVE_OPERATING_CASHFLOW_YEARS_REQUIRED'));
});

test('missing parent-attributable earnings remain unknown; a reported parent loss is excluded without substituting total profit', () => {
  const f = fixture(); for (const a of values(f)) a.parent_net_profit = null;
  let r = calc(f); assert.equal(r.state, 'CALCULATED_RESEARCH_ONLY');
  assert.deepEqual(r.issuer_quality.parent_profit_disclosure.missing_years, [2023, 2024, 2025]);
  assert.ok(r.issuer_quality.annuals.every(a => a.parent_net_profit === null && a.net_profit === 100));
  values(f)[1].parent_net_profit = -1; r = calc(f);
  assert.equal(r.state, 'UNAVAILABLE'); assert.ok(r.reasons.includes('2024_REPORTED_PARENT_LOSS'));
});

test('missing, inconsistent or unverified annual balance fields cannot be normalized to zero or approved', () => {
  for (const mutate of [a => { a.assets = null; }, a => { a.assets = 499; }, a => { a.equity = 0; },
    a => { a.period_verified = false; }, a => { a.unit_verified = false; }, a => { a.source_captures.cashflow = null; }]) {
    const f = fixture(); mutate(values(f)[0]); assert.equal(calc(f).state, 'UNAVAILABLE');
  }
  const f = fixture(); values(f).shift(); const r = calc(f);
  assert.ok(r.reasons.includes('2023_ANNUAL_PERIOD_REQUIRED'));
});

test('financial issuers require a separate quality method and emerging averages cannot become closing prices', () => {
  const f = fixture(); f.securities.forEach(s => { s.company.industry_code = '17'; });
  assert.ok(calc(f).reasons.includes('FINANCIAL_SECTOR_QUALITY_METHOD_REQUIRED'));
  const emerging = fixture(); renameMarket(emerging, 0, 'EMERGING'); emerging.security_id = 'EMERGING:1000';
  emerging.securities[0].observations[0].close = null; emerging.securities[0].observations[0].average = 100;
  assert.ok(calc(emerging).reasons.includes('CURRENT_COMPLETE_SESSION_PRICE_REQUIRED'));
  const tdr = fixture(); tdr.securities[0].company.instrument_kind = 'TDR';
  assert.ok(calc(tdr).reasons.includes('ORDINARY_COMPANY_EQUITY_REQUIRED'));
});

test('wrong quote dates and price/PB mismatches are unavailable; future or forged provenance throws', () => {
  const f = fixture(); f.securities[0].observations[1].close = 101;
  assert.equal(calc(f).state, 'UNAVAILABLE');
  const stale = fixture(); stale.securities[0].observations[0].date = '2026-11-10';
  assert.ok(calc(stale).reasons.includes('CURRENT_COMPLETE_SESSION_PRICE_REQUIRED'));
  const future = fixture(); future.securities[1].observations[0].available_at = '2026-11-12T00:00:00Z';
  assert.throws(() => calc(future), /OBSERVATION_TIME/);
  const forged = fixture(); values(forged)[0].source_captures.income.capture_id = '0'.repeat(64);
  assert.throws(() => calc(forged), /CAPTURE_ID/);
  assert.throws(() => calc({ ...fixture(), expected_quote_date: '2026-11-10' }), /EXPECTED_SESSION_MISMATCH/);
});

test('all selected peer annual and market raw references survive, and result/hash are immutable without freezing caller inputs', () => {
  const f = fixture(), r = calc(f), { reference_hash, ...body } = r;
  assert.equal(reference_hash, marketSnapshotHash(body)); assert.equal(r.policy_hash, marketSnapshotHash(TAIWAN_LONG_PEER_PRICE_POLICY));
  assert.deepEqual(r.issuer_source_captures.quote, f.securities[0].observations[0].source_capture);
  for (const peer of r.peers) {
    assert.equal(peer.annual_quality.annuals.length, 3);
    for (const annual of peer.annual_quality.annuals) {
      const original = values(f, peer.security_id).find(row => row.year === annual.year);
      assert.deepEqual(annual.source_captures, original.source_captures);
    }
  }
  assert.equal(Object.isFrozen(r), true); assert.equal(Object.isFrozen(r.peers[0].annual_quality.annuals[0].source_captures.income), true);
  assert.equal(Object.isFrozen(values(f)[0]), false);
  assert.throws(() => { r.price_scenarios[0] = 999; }, TypeError);
  const previous = r.reference_hash; values(f)[0].net_profit = 101; assert.notEqual(calc(f).reference_hash, previous);
});

test('duplicate identities/periods, strings and non-finite financial values are malformed instead of missing-data defaults', () => {
  const repeated = fixture(); repeated.securities.push(repeated.securities[0]); assert.throws(() => calc(repeated), /DUPLICATE_SECURITY/);
  const years = fixture(); values(years).push(values(years)[0]); assert.throws(() => calc(years), /ANNUAL_YEAR/);
  for (const value of ['100', NaN, Infinity]) { const f = fixture(); values(f)[0].net_profit = value; assert.throws(() => calc(f), /ANNUAL_VALUE/); }
});
