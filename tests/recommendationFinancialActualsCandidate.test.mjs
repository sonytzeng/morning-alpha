import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  FINANCIAL_CANDIDATE_SYMBOLS as symbols, FINANCIAL_CANDIDATE_SOURCES as sources,
  normalizeFinancialActualsCandidate as normalize, acquireFinancialActualsCandidate as acquire,
  financialActualsCandidateCoverage as coverage,
} from '../supabase/functions/_shared/recommendation-financial-actuals-candidate.ts';
import {OFFICIAL_ACTUAL_SOURCES, normalizeOfficialActuals} from '../supabase/functions/_shared/recommendation-official-actuals.ts';

// Actual official HTTP samples, allowlisted immediately on receipt. Deliberate
// negative mutations below are synthetic; offline replay is not another live GET.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/financial-actuals-official-candidate.json', import.meta.url), 'utf8'));
const sample = kind => fixture.captures.find(c => c.kind === kind);
const now = '2026-10-17T07:17:00Z';
const rows = kind => normalize(kind, sample(kind).rows, now);
const captures = () => sources.map(s => ({kind: s.kind, source: s.url, dataset: s.dataset,
  received_at: now, status: 'PASS', http_status: 200, total_source_rows: sample(s.kind).total_rows, rows: rows(s.kind)}));

test('real samples have explicit full-response denominators, actual receipt and dataset-specific OGL attribution', () => {
  assert.deepEqual(fixture.captures.map(c => c.total_rows), [1088, 1085, 13]);
  assert.deepEqual(fixture.captures.map(c => c.selected_rows), [5, 5, 5]);
  assert.equal(fixture.collection.real_http_gets, 3);
  for (const c of fixture.captures) {
    assert.equal(c.http_status, 200); assert.match(c.response_sha256, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(c.received_at) > Date.parse('2026-10-16T23:59:59Z'));
    assert.deepEqual(c.rows.map(r => r['公司代號']), symbols);
  }
  assert.equal(fixture.attribution.license_url, 'https://data.gov.tw/license');
  assert.deepEqual(fixture.attribution.datasets.map(d => d.catalog), sources.map(s => s.dataset));
});
test('all five current monthly values use the existing generic mapping: no finance exclusion established', () => {
  const old = normalizeOfficialActuals(OFFICIAL_ACTUAL_SOURCES[1], sample('monthly_revenue').rows, now, symbols);
  assert.equal(old.filter(r => Number.isFinite(r.revenue_actual_as_reported)).length, 5);
  assert.deepEqual(rows('monthly_revenue').map(r => r.monthly_revenue_as_reported), old.map(r => r.revenue_actual_as_reported));
  assert.equal(rows('monthly_revenue')[0].monthly_revenue_as_reported, 19467727);
  assert.equal(coverage(captures(), now).historical_missing_monthly_reason, 'UNKNOWN_NO_ORIGINAL_RAW_VERSION');
});
test('real FH full-width EPS is mapped explicitly, with original source and period, not a new independent quarter', () => {
  const financial = rows('financial_holding_income'), eps = rows('eps_summary');
  assert.deepEqual(financial.map(r => r.eps_as_reported), [6.67, 4.95, 1.32, 2.64, 1.96]);
  assert.deepEqual(financial.map(r => r.eps_as_reported), eps.map(r => r.eps_as_reported));
  for (const r of financial) { assert.equal(r.source, sources[2].url); assert.equal(r.period, '2026-Q2'); }
  assert.deepEqual(coverage(captures(), now).reported_quarter_labels, ['2026-Q2']);
});
test('financial interest/noninterest/net-revenue fields retain exact labels and never become generic revenue', () => {
  const [r] = rows('financial_holding_income');
  assert.equal(r.reported_fields['利息淨收益'], 112076678);
  assert.equal(r.reported_fields['利息以外淨收益'], 172468262);
  assert.equal(r.reported_fields['淨收益'], 5446990);
  assert.equal(r.standalone_quarter_revenue, null);
  assert.equal(r.monthly_revenue_as_reported, null);
  assert.equal(Object.hasOwn(r.reported_fields, '營業收入'), false);
});
test('single-quarter versus YTD, units and original publication/vintage are never invented', () => {
  for (const c of captures()) for (const r of c.rows) {
    assert.equal(r.original_publication_time, null); assert.equal(r.source_timestamp, null); assert.equal(r.source_vintage, null);
    assert.equal(r.observed_at, now); assert.equal(r.available_at, now); assert.equal(r.first_seen_at, now);
    assert.equal(r.amount_unit, 'SOURCE_REPORTED_NOT_CONVERTED');
    assert.equal(r.standalone_quarter_eps, null); assert.equal(r.standalone_quarter_revenue, null);
    assert.equal(r.formal_admission, false); assert.equal(r.member_publication, false);
    if (r.kind !== 'monthly_revenue') assert.equal(r.period_basis, 'UNPROVEN_SINGLE_QUARTER_VS_YTD');
  }
  assert.equal(coverage(captures(), now).proven_standalone_quarters, 0);
  assert.equal(coverage(captures(), now).complete_four_quarter_actuals, 0);
});
test('EPS never derives from subtraction, including two cumulative-looking report labels', () => {
  const raw = sample('financial_holding_income').rows[0];
  const q1 = normalize('financial_holding_income', [{...raw, '季別': '1', '基本每股盈餘（元）': '3.00'}], now)[0];
  const q2 = normalize('financial_holding_income', [raw], now)[0];
  assert.equal(q1.standalone_quarter_eps, null); assert.equal(q2.standalone_quarter_eps, null);
  assert.equal(q2.eps_as_reported, 6.67);
  assert.throws(() => normalize('financial_holding_income', [raw, {...raw, '季別': '1'}], now), /DUPLICATE_SYMBOL/);
});
test('late current acquisition cannot repair the old cutoff even when source_date says 10/16', () => {
  const old = coverage(captures(), '2026-10-15T23:06:47.913Z');
  assert.deepEqual([old.monthly_revenue_as_reported, old.eps_summary_as_reported, old.financial_holding_eps_as_reported], [0, 0, 0]);
  const current = coverage(captures(), now);
  assert.deepEqual([current.monthly_revenue_as_reported, current.eps_summary_as_reported, current.financial_holding_eps_as_reported], [5, 5, 5]);
  assert.deepEqual(current.reported_months, ['2026-09']);
});
test('missing/invalid numbers stay null while genuine zero and negative actuals survive', () => {
  const raw = sample('monthly_revenue').rows[0];
  for (const v of ['', '--', null, '1,2', 'NaN', 'Infinity', '9007199254740992'])
    assert.equal(normalize('monthly_revenue', [{...raw, '營業收入-當月營收': v}], now)[0].monthly_revenue_as_reported, null);
  for (const [v, expected] of [['0', 0], ['-1.5', -1.5], ['1,234', 1234]])
    assert.equal(normalize('monthly_revenue', [{...raw, '營業收入-當月營收': v}], now)[0].monthly_revenue_as_reported, expected);
});
test('future/broken dates, unfinished quarters, unsupported kind and missing timezone fail closed', () => {
  const raw = sample('eps_summary').rows[0];
  for (const value of ['1151018', '1150230', 'unknown'])
    assert.throws(() => normalize('eps_summary', [{...raw, '出表日期': value}], now));
  assert.throws(() => normalize('eps_summary', [{...raw, '季別': '4'}], now));
  for (const value of ['2026-10-17', '2026-10-17T07:00:00', 'invalid'])
    assert.throws(() => normalize('eps_summary', [raw], value));
  assert.throws(() => normalize('other', [], now));
});
test('PII, provider text, extra stocks and arbitrary fields do not reach candidate output', () => {
  const raw = sample('monthly_revenue').rows[0];
  const result = normalize('monthly_revenue', [{...raw, EmailAddress: 'PRIVATE_CONTACT', '備註': 'PRIVATE_NOTE'},
    {...raw, '公司代號': '9999'}], now);
  assert.equal(result.length, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|EmailAddress|9999|備註/);
});
test('cross-source EPS disagreement is surfaced and excluded from counted EPS coverage', () => {
  const all = captures(); all[2].rows[0].eps_as_reported = 999;
  const result = coverage(all, now);
  assert.deepEqual(result.conflicting_eps_symbols, ['2881']);
  assert.equal(result.eps_summary_as_reported, 4); assert.equal(result.financial_holding_eps_as_reported, 4);
  assert.equal(result.complete_four_quarter_actuals, 0);
});
test('offline replay uses the actual loader, exactly 3 allowlisted sequential credential-free GETs', async () => {
  let calls = 0, active = 0, maximum = 0;
  const result = await acquire({now: () => now, signal: AbortSignal.timeout(2000), fetcher: async (url, init) => {
    calls++; active++; maximum = Math.max(maximum, active);
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, {Accept: 'application/json'});
    const s = sources.find(s => s.url === url); assert.ok(s); active--;
    return Response.json(sample(s.kind).rows);
  }});
  assert.equal(calls, 3); assert.equal(maximum, 1); assert.ok(result.every(c => c.status === 'PASS'));
  for (const c of result) { assert.match(c.response_sha256, /^[a-f0-9]{64}$/); assert.equal(c.first_seen_at, now); }
  assert.deepEqual(result.map(c => c.total_source_rows), [5, 5, 5]); // replay subset, not full live denominator
  assert.equal(coverage(result, now).monthly_revenue_as_reported, 5);
});
test('aborted acquisition starts no transport; a noncooperative fetch cannot hang or start later requests', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const stopped = await acquire({now: () => now, signal: controller.signal, fetcher: async () => { calls++; }});
  assert.equal(calls, 0); assert.ok(stopped.every(c => c.status === 'DEADLINE'));
  const running = new AbortController();
  const pending = acquire({now: () => now, signal: running.signal, fetcher: () => { calls++; return new Promise(() => {}); }});
  setTimeout(() => running.abort(), 5);
  const result = await pending; assert.equal(calls, 1); assert.ok(result.every(c => c.status === 'DEADLINE'));
});
test('non-200, malformed JSON, invalid content-type and oversized bodies never leak raw text or retry', async () => {
  for (const [factory, expected] of [
    [() => new Response('PRIVATE_REMOTE', {status: 429}), 'HTTP_STOP'],
    [() => new Response('{', {headers: {'Content-Type': 'application/json'}}), 'CONTRACT_INVALID'],
    [() => new Response('PRIVATE_REMOTE', {headers: {'Content-Type': 'text/html'}}), 'CONTRACT_INVALID'],
    [() => new Response(' '.repeat(1_500_001), {headers: {'Content-Type': 'application/json'}}), 'CONTRACT_INVALID'],
  ]) {
    let calls = 0;
    const result = await acquire({now: () => now, signal: AbortSignal.timeout(2000), fetcher: async () => { calls++; return factory(); }});
    assert.equal(calls, 3); assert.ok(result.every(c => c.status === expected && c.rows.length === 0));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REMOTE/);
  }
  const result = await acquire({now: () => now, signal: AbortSignal.timeout(2000), fetcher: async () => { throw Error('PRIVATE_CREDENTIAL'); }});
  assert.ok(result.every(c => c.status === 'TRANSPORT_FAILURE')); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CREDENTIAL/);
});
test('candidate stays detached: no runtime credentials, database client, writer, canonical or Producer imports', () => {
  const source = readFileSync(new URL('../supabase/functions/_shared/recommendation-financial-actuals-candidate.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Deno\.env|process\.env|createClient|Deno\.serve|\.insert\(|\.upsert\(|\.update\(/);
  const imports = [...source.matchAll(/^import .+ from '([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(imports, ['./recommendation-official-actuals.ts']);
  assert.match(source, /acquireOfficialActuals\(\{\.\.\.options, symbols: FINANCIAL_CANDIDATE_SYMBOLS, profile: 'financial_candidate'\}\)/);
});
test('duplicate/future source contracts and malformed UTF-8 are not misreported as transport failures', async () => {
  for (const bad of ['duplicate', 'future', 'utf8']) {
    const result = await acquire({now: () => now, signal: AbortSignal.timeout(2000), fetcher: async url => {
      if (bad === 'utf8') return new Response(new Uint8Array([0xff]), {headers: {'Content-Type': 'application/json'}});
      const s = sources.find(s => s.url === url), raw = sample(s.kind).rows[0];
      return Response.json(bad === 'duplicate' ? [raw, raw] : [{...raw, '出表日期': '1151018'}]);
    }});
    assert.ok(result.every(c => c.status === 'CONTRACT_INVALID' && c.rows.length === 0));
  }
});
test('late fetch response is cancelled and never parsed after external abort', async () => {
  const controller = new AbortController(); let resolve, cancelled = 0, calls = 0;
  const pending = acquire({now: () => now, signal: controller.signal,
    fetcher: () => { calls++; return new Promise(done => { resolve = done; }); }});
  controller.abort(); await pending;
  resolve(new Response(new ReadableStream({cancel() { cancelled++; }}), {headers: {'Content-Type': 'application/json'}}));
  await new Promise(done => setTimeout(done, 0));
  assert.equal(calls, 1); assert.equal(cancelled, 1);
});
