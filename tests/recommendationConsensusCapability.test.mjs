import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assessQuarterlyConsensusCapability as assess,
  CONSENSUS_CAPABILITY_CONTRACT as contract,
  FINNHUB_AVERAGE_PROVENANCE as provenance,
  CONSENSUS_CANDIDATE_MAX_BYTES as limit,
} from '../supabase/functions/_shared/recommendation-consensus-capability-candidate.ts';

// SYNTHETIC parser controls only. No API responses, live identities, coverage,
// entitlement, historical-vintage authenticity or licensed-use evidence.
const source = 'https://openapi.twse.com.tw/v1/opendata/t187ap14_L';
const after = day => day + 'T01:00:00Z';
function fixture() {
  const periods = [
    [2025, 3, '2025-07-01', '2025-09-30', '2025-11-10'],
    [2025, 4, '2025-10-01', '2025-12-31', '2026-03-10'],
    [2026, 1, '2026-01-01', '2026-03-31', '2026-05-10'],
    [2026, 2, '2026-04-01', '2026-06-30', '2026-08-10'],
  ];
  const quarters = periods.map(([year, quarter, start, end, announced]) => {
    const common = {
      currency: 'TWD', period_basis: 'STANDALONE_QUARTER', accounting_basis: 'IFRS', eps_basis: 'BASIC',
      measurement_ref: 'synthetic:documented-dimensions', revision_ref: `synthetic:${year}-Q${quarter}`,
    };
    const estimate = metric => ({
      ...common, kind: 'ESTIMATE', provider: 'FINNHUB', endpoint: `/stock/${metric}-estimate`,
      first_seen_at: after(end), available_at: after(end), source_as_of: null,
      unit: metric === 'eps' ? 'CURRENCY_PER_SHARE' : 'CURRENCY_UNITS', scale: 1, provenance,
      payload: { symbol: 'SYNTHETIC.TW', freq: 'quarterly', data: [{
        year, quarter, period: end, numberAnalysts: 4,
        [metric + 'Avg']: metric === 'eps' ? 5 : 100_000,
        [metric + 'Low']: metric === 'eps' ? 4 : 90_000,
        [metric + 'High']: metric === 'eps' ? 6 : 110_000,
      }] },
    });
    return {
      fiscal_year: year, fiscal_quarter: quarter, period_start: start, period_end: end,
      actuals: {
        ...common, kind: 'ACTUAL', provider: 'TWSE', source_ref: source, symbol: '2330',
        fiscal_year: year, fiscal_quarter: quarter, period_start: start, period_end: end,
        published_at: after(announced), first_seen_at: after(announced), available_at: after(announced),
        eps_unit: 'CURRENCY_PER_SHARE', revenue_unit: 'CURRENCY_UNITS', scale: 1,
        eps_actual: 5.5, revenue_actual: 105_000,
      },
      eps_estimate: estimate('eps'), revenue_estimate: estimate('revenue'),
    };
  });
  return {
    contract, symbol: '2330', provider_symbol: 'SYNTHETIC.TW', symbol_mapping_ref: 'synthetic:common-share-mapping',
    currency: 'TWD', cutoff: '2026-10-16T23:00:00Z', quarters,
    guidance: {
      kind: 'ISSUER_GUIDANCE', provider: 'TWSE', symbol: '2330', direction: 'up', source_ref: source,
      revision_ref: 'synthetic:guidance-review', published_at: '2026-08-10T02:00:00Z',
      first_seen_at: '2026-08-10T02:01:00Z', available_at: '2026-08-10T02:01:00Z',
    },
  };
}
const evaluate = input => assess(JSON.stringify(input));
const blocked = result => {
  assert.equal(result.status, 'BLOCKED_INPUT');
  assert.deepEqual(result.rows, []); assert.equal(result.guidance, null);
  assert.equal(result.v1_admitted, false); assert.equal(result.member_publication_approved, false);
  assert.equal(result.reasons.length, 1);
};

test('SYNTHETIC valid shape remains externally blocked, never broker consensus or V1 rows', () => {
  const input = fixture(), before = structuredClone(input), result = evaluate(input);
  assert.deepEqual(input, before);
  assert.equal(result.status, 'CANDIDATE_SHAPE_VALID_EXTERNAL_BLOCKED');
  assert.equal(result.rows.length, 4);
  assert.equal(result.rows[0].fiscal_period, '2025-Q3');
  assert.equal(result.rows[3].fiscal_period, '2026-Q2');
  assert.equal(result.rows[0].eps_estimate_average, 5);
  assert.equal(result.rows[0].estimate_provenance, provenance);
  assert.equal(result.rows[0].eps_source_as_of, null);
  assert.equal(result.v1_admitted, false); assert.equal(result.member_publication_approved, false);
  assert.equal(result.pure_broker_consensus, false);
  assert.equal(result.guidance.direction, 'up');
  assert.deepEqual(result.external_blockers, [
    'TW72_COVERAGE_UNPROVEN', 'CURRENT_ENTITLEMENT_UNPROVEN', 'FOUR_QUARTER_HISTORICAL_ASOF_UNPROVEN',
    'COMMERCIAL_MEMBER_REUSE_RIGHTS_UNPROVEN', 'PURE_BROKER_CONSENSUS_NOT_ESTABLISHED',
  ]);
  assert(result.rows.every(row => !('eps_consensus' in row) && !('revenue_consensus' in row)));
  result.external_blockers.length = 0;
  assert.equal(evaluate(input).external_blockers.length, 5, 'no shared mutable admission state');
});

const negatives = [
  ['unknown capability flag cannot grant permission', x => { x.entitlement = true; }],
  ['unmapped provider identity', x => { delete x.symbol_mapping_ref; }],
  ['ADR cannot silently replace local common share mapping', x => { x.quarters[0].eps_estimate.payload.symbol = 'TSM'; }],
  ['non-TWD scope / no automatic FX', x => { x.currency = 'USD'; }],
  ['cutoff without timezone', x => { x.cutoff = '2026-10-16T23:00:00'; }],
  ['impossible cutoff date', x => { x.cutoff = '2026-02-30T23:00:00Z'; }],
  ['only three quarters', x => { x.quarters.pop(); }],
  ['fifth quarter', x => { x.quarters.push(structuredClone(x.quarters[3])); }],
  ['duplicate quarter', x => { x.quarters[1] = structuredClone(x.quarters[0]); }],
  ['missing fiscal quarter', x => { x.quarters[1].fiscal_quarter = 2; }],
  ['reversed quarters', x => { x.quarters.reverse(); }],
  ['annual span mislabeled quarterly', x => { x.quarters[0].period_start = '2025-01-01'; }],
  ['YTD actual mislabeled as standalone', x => { x.quarters[3].actuals.period_start = '2026-01-01'; }],
  ['YTD explicit basis', x => { x.quarters[0].actuals.period_basis = 'YTD'; }],
  ['wrong actual company', x => { x.quarters[0].actuals.symbol = '2317'; }],
  ['wrong actual quarter', x => { x.quarters[0].actuals.fiscal_quarter = 2; }],
  ['no sourced actual', x => { x.quarters[0].actuals.provider = 'LLM'; }],
  ['source host suffix spoof', x => { x.quarters[0].actuals.source_ref = 'https://openapi.twse.com.tw.invalid/a'; }],
  ['credential-bearing source URL', x => { x.quarters[0].actuals.source_ref += '?token=SYNTHETIC_PRIVATE'; }],
  ['estimate cannot substitute for actual', x => { x.quarters[0].actuals.kind = 'ESTIMATE'; }],
  ['revenue share units', x => { x.quarters[0].actuals.revenue_unit = 'SHARES'; }],
  ['implicit million conversion forbidden', x => { x.quarters[0].revenue_estimate.scale = 1_000_000; }],
  ['missing explicit estimate units', x => { delete x.quarters[0].revenue_estimate.unit; }],
  ['missing measurement evidence reference', x => { delete x.quarters[0].eps_estimate.measurement_ref; }],
  ['mismatched accounting basis', x => { x.quarters[0].eps_estimate.accounting_basis = 'ADJUSTED'; }],
  ['mismatched basic/diluted basis', x => { x.quarters[0].eps_estimate.eps_basis = 'DILUTED'; }],
  ['currency mismatch', x => { x.quarters[0].revenue_estimate.currency = 'USD'; }],
  ['vendor average cannot self-promote to broker consensus', x => { x.quarters[0].eps_estimate.provenance = 'PURE_BROKER_CONSENSUS'; }],
  ['arbitrary estimate provider', x => { x.quarters[0].eps_estimate.provider = 'OTHER'; }],
  ['wrong endpoint', x => { x.quarters[0].revenue_estimate.endpoint = '/stock/earnings'; }],
  ['annual payload frequency', x => { x.quarters[0].eps_estimate.payload.freq = 'annual'; }],
  ['raw actual field cannot be smuggled into estimate', x => { x.quarters[0].eps_estimate.payload.data[0].epsActual = 6; }],
  ['two selected records are ambiguous', x => { const e = x.quarters[0].eps_estimate; e.payload.data.push(structuredClone(e.payload.data[0])); }],
  ['wrong vendor quarter', x => { x.quarters[0].eps_estimate.payload.data[0].quarter = 4; }],
  ['wrong vendor period end', x => { x.quarters[0].revenue_estimate.payload.data[0].period = '2025-12-31'; }],
  ['null average is not zero', x => { x.quarters[0].eps_estimate.payload.data[0].epsAvg = null; }],
  ['string average not coerced', x => { x.quarters[0].eps_estimate.payload.data[0].epsAvg = '5'; }],
  ['inconsistent high/low', x => { x.quarters[0].eps_estimate.payload.data[0].epsLow = 7; }],
  ['zero revenue estimate', x => { x.quarters[0].revenue_estimate.payload.data[0].revenueAvg = 0; }],
  ['zero analyst count does not imply consensus', x => { x.quarters[0].revenue_estimate.payload.data[0].numberAnalysts = 0; }],
  ['fractional analyst count', x => { x.quarters[0].eps_estimate.payload.data[0].numberAnalysts = 1.5; }],
  ['unsafe numeric magnitude', x => { x.quarters[0].actuals.revenue_actual = Number.MAX_SAFE_INTEGER + 1; }],
  ['today downloaded estimate cannot backfill past actual', x => {
    const e = x.quarters[0].eps_estimate; e.first_seen_at = x.cutoff; e.available_at = x.cutoff;
  }],
  ['same-instant estimate/announcement is not pre-announcement evidence', x => {
    const q = x.quarters[0]; q.eps_estimate.first_seen_at = q.actuals.published_at; q.eps_estimate.available_at = q.actuals.published_at;
  }],
  ['availability earlier than first seen', x => { x.quarters[0].eps_estimate.available_at = '2025-09-29T01:00:00Z'; }],
  ['source-as-of later than first seen', x => { x.quarters[0].eps_estimate.source_as_of = '2026-01-01T01:00:00Z'; }],
  ['missing current-value revision receipt', x => { delete x.quarters[0].eps_estimate.revision_ref; }],
  ['actual first seen beyond cutoff', x => { x.quarters[3].actuals.first_seen_at = '2027-01-01T01:00:00Z'; }],
  ['actual available beyond cutoff', x => { x.quarters[3].actuals.available_at = '2027-01-01T01:00:00Z'; }],
  ['actual announced before completed quarter', x => { x.quarters[0].actuals.published_at = '2025-09-29T01:00:00Z'; }],
  ['missing guidance never becomes stable', x => { delete x.guidance; }],
  ['unsourced guidance', x => { delete x.guidance.source_ref; }],
  ['guidance direction unspecified', x => { x.guidance.direction = null; }],
  ['guidance predates latest reported quarter', x => { x.guidance.published_at = '2025-11-10T01:00:00Z'; }],
  ['guidance first seen after cutoff', x => { x.guidance.first_seen_at = '2027-01-01T01:00:00Z'; }],
  ['guidance for wrong company', x => { x.guidance.symbol = '2317'; }],
];
for (const [name, mutate] of negatives) test('fail closed: ' + name, () => {
  const input = fixture(); mutate(input); blocked(evaluate(input));
});

test('bounded malformed/non-JSON/UTF-8 input returns safe diagnostics, never partial rows', () => {
  for (const input of [null, {}, [], '', '{', 'null', '[]', '0', '"SYNTHETIC_PRIVATE"', 'x'.repeat(limit + 1), '中'.repeat(limit / 2)]) {
    const result = assess(input); blocked(result);
    assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_PRIVATE/);
  }
});
test('valid local boundaries: cutoff equality, signed/zero EPS, explicit source-as-of retained', () => {
  const input = fixture(), q = input.quarters[0];
  q.actuals.eps_actual = -1;
  Object.assign(q.eps_estimate.payload.data[0], { epsLow: -2, epsAvg: 0, epsHigh: 1 });
  q.eps_estimate.source_as_of = q.eps_estimate.first_seen_at;
  input.guidance.available_at = input.cutoff;
  const result = evaluate(input);
  assert.equal(result.status, 'CANDIDATE_SHAPE_VALID_EXTERNAL_BLOCKED');
  assert.equal(result.rows[0].eps_actual, -1); assert.equal(result.rows[0].eps_estimate_average, 0);
  assert.equal(result.rows[0].eps_source_as_of, q.eps_estimate.source_as_of);
  assert.equal(result.v1_admitted, false);
});
test('late failure cannot leak earlier valid quarters or mutable input state', () => {
  const input = fixture(); input.quarters[3].revenue_estimate.provenance = 'UNPROVEN';
  blocked(evaluate(input));
  assert.deepEqual(evaluate(fixture()), evaluate(fixture()));
});
test('pure detached module has no runtime/provider/store imports or ambient I/O', () => {
  const url = new URL('../supabase/functions/_shared/recommendation-consensus-capability-candidate.ts', import.meta.url);
  const text = readFileSync(url, 'utf8');
  assert.doesNotMatch(text, /^\s*import\s/m);
  assert.doesNotMatch(text, /\bfetch\s*\(|Deno\.|process\.|Date\.now\s*\(|new Date\s*\(\s*\)|console\.|setTimeout\s*\(|\.rpc\s*\(/);
  assert.doesNotMatch(text, /SUPABASE_.*KEY|FINNHUB_API_KEY|\.from\s*\(|\.upsert\s*\(/);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('NO_NETWORK_ALLOWED'); };
  try { assert.equal(evaluate(fixture()).rows.length, 4); } finally { globalThis.fetch = oldFetch; }
});
