import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFinnhubQuarterlyProbe as create, FINNHUB_QUARTERLY_PROBE_MANIFEST as manifest} from '../scripts/capability/finnhub-quarterly-probe.mjs';

// SYNTHETIC transports with genuine WHATWG Response/ReadableStream. No provider
// data, network, credentials, coverage, entitlement or licensing is established.
const TOKEN = 'SYNTHETIC_TOKEN_NOT_A_REAL_KEY_1234';
const CANARY = 'SYNTHETIC_PRIVATE_PROVIDER_TEXT';
const urls = [
  'https://finnhub.io/api/v1/search?q=2330',
  'https://finnhub.io/api/v1/stock/eps-estimate?symbol=2330.TW&freq=quarterly',
  'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=2330.TW&freq=quarterly',
  'https://finnhub.io/api/v1/search?q=6488',
  'https://finnhub.io/api/v1/stock/eps-estimate?symbol=6488.TWO&freq=quarterly',
  'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=6488.TWO&freq=quarterly',
];
const json = (value, init = {}) => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}, ...init});
function payload(url) {
  const u = new URL(url), symbol = u.searchParams.get('symbol') ?? (u.searchParams.get('q') === '2330' ? '2330.TW' : '6488.TWO');
  if (u.pathname.endsWith('/search')) return {count: 1, result: [{symbol, displaySymbol: symbol, description: CANARY + TOKEN, type: 'Common Stock'}]};
  const metric = u.pathname.includes('eps-') ? 'eps' : 'revenue';
  return {symbol, freq: 'quarterly', data: [1, 2, 3, 4].map(quarter => ({year: 2025, quarter,
    period: ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'][quarter - 1],
    [metric + 'Avg']: 10, [metric + 'Low']: 8, [metric + 'High']: 12, numberAnalysts: 3, revision: CANARY + TOKEN}))};
}
function setup(override, extra = {}) {
  const requests = [], credentials = {count: 0};
  const probe = create({fetch: (url, init) => {
    requests.push({url, init});
    return override ? override(url, init, requests.length) : json(payload(url));
  }, getCredential: () => { credentials.count++; return TOKEN; }, ...extra});
  return {probe, requests, credentials};
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fakeTime(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const time = {ms: 0};
  return {clock: () => time.ms, time, advance: async ms => { time.ms += ms; t.mock.timers.tick(ms); await flush(); }};
}
function safe(result) {
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, new RegExp(TOKEN + '|' + CANARY));
  for (const key of ['formal_admission', 'member_publication', 'pure_broker_consensus', 'backend_binding_approved']) assert.equal(result[key], false);
  assert.equal(result.symbol_mapping, 'HYPOTHESIS_UNVERIFIED');
  assert.equal(result.tw72_coverage, 'UNKNOWN');
  assert.equal(result.historical_vintage, 'UNPROVEN');
  assert.equal(result.current_entitlement, 'UNPROVEN');
  assert.equal(result.commercial_member_reuse_rights, 'UNPROVEN');
  assert.equal(result.average_provenance, 'FINNHUB_AVERAGE_INCLUDING_PROPRIETARY');
  assert.equal(result.global_cross_isolate_rate_control, 'NOT_IMPLEMENTED');
}

test('SYNTHETIC acquisition executes exactly six fixed sequential GETs, token header only, counts only', async () => {
  let active = 0, peak = 0;
  const {probe, requests, credentials} = setup(async url => { peak = Math.max(peak, ++active); await Promise.resolve(); active--; return json(payload(url)); });
  const result = await probe.run(); safe(result);
  assert.equal(result.status, 'BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED');
  assert.equal(result.calls, 6); assert.equal(credentials.count, 1); assert.equal(peak, 1);
  assert.deepEqual(requests.map(r => r.url), urls);
  for (const {url, init} of requests) {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
    assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal('body' in init, false);
    assert.deepEqual(init.headers, {Accept: 'application/json', 'X-Finnhub-Token': TOKEN});
    assert(init.signal instanceof AbortSignal); assert(!url.includes(TOKEN));
  }
  assert.deepEqual(result.observations.map(o => o.row_count), [1, 4, 4, 1, 4, 4]);
  assert.deepEqual(result.observations.map(o => o.quarter_count), [0, 4, 4, 0, 4, 4]);
  assert.equal(result.observations[1].metadata_present_rows.numberAnalysts, 4);
  assert.equal(result.observations[1].metadata_present_rows.currency, 0);
  assert.equal(result.observations[1].metadata_present_rows.revision, 4);
  assert.equal(result.observations[1].metadata_present_rows.first_seen_at, 0);
  assert(Object.isFrozen(result.observations[1].metadata_present_rows));
  assert.throws(() => { result.formal_admission = true; });
});
test('one instance, concurrent callers and later callers share the exact one-shot promise', async () => {
  const {probe, requests, credentials} = setup();
  const first = probe.run();
  const others = Array.from({length: 30}, () => probe.run());
  assert(others.every(p => p === first));
  const results = await Promise.all(others);
  assert(results.every(r => r === results[0])); assert.equal(probe.run(), first);
  assert.equal(requests.length, 6); assert.equal(credentials.count, 1);
});
test('callback reentrancy cannot reserve a second execution', async () => {
  let probe, nested;
  probe = create({fetch: url => json(payload(url)), getCredential: () => { nested = probe.run(); return TOKEN; }});
  const first = probe.run(); await first; assert.equal(nested, first);
});
for (const credential of [undefined, null, '', 'short', ' ' + TOKEN, TOKEN + '\r\nx-header: injected', {}, {token: TOKEN}, 'a'.repeat(129), 123]) {
  test('invalid credential blocks zero calls and consumes the instance: ' + typeof credential + '/' + String(credential).length, async () => {
    const {probe, requests} = setup(undefined, {getCredential: () => credential});
    const first = probe.run(); const result = await first; safe(result);
    assert.equal(result.status, 'BLOCKED_CREDENTIAL'); assert.equal(result.calls, 0);
    assert.equal(requests.length, 0); assert.equal(probe.run(), first);
  });
}
test('credential callback throw/rejection is sanitized, zero calls, no retry', async () => {
  for (const getCredential of [() => { throw Error(TOKEN + CANARY); }, async () => { throw Error(TOKEN + CANARY); }]) {
    const {probe, requests} = setup(undefined, {getCredential});
    const result = await probe.run(); safe(result); assert.equal(result.calls, 0); assert.equal(requests.length, 0);
  }
});
for (const field of ['url', 'headers', 'symbol', 'symbols', 'body', 'deadline', 'retries']) test('configuration cannot supply arbitrary ' + field, async () => {
  const {probe, requests, credentials} = setup(undefined, {[field]: CANARY});
  const result = await probe.run(); safe(result); assert.equal(result.status, 'BLOCKED_CONFIGURATION');
  assert.equal(requests.length, 0); assert.equal(credentials.count, 0);
});
test('run input is rejected, not interpreted, and consumes the same instance', async () => {
  const {probe, requests} = setup(); const first = probe.run({url: CANARY, headers: {Authorization: TOKEN}, symbol: 'ARBITRARY'});
  assert.equal((await first).status, 'BLOCKED_INPUT'); assert.equal(probe.run(), first); assert.equal(requests.length, 0);
});
test('missing transport never falls back to ambient fetch; config accessors are not invoked', async () => {
  let accessed = false;
  for (const dependency of [undefined, {}, {getCredential: () => TOKEN}, {fetch: 'not a function', getCredential: () => TOKEN},
    Object.defineProperty({}, 'fetch', {get() { accessed = true; throw Error(TOKEN); }})]) {
    assert.equal((await create(dependency).run()).status, 'BLOCKED_CONFIGURATION');
  }
  assert.equal(accessed, false);
});

for (const http of [401, 403, 429, 400, 404, 500, 503, 302]) test('HTTP ' + http + ' aborts/cancels, stops sequential acquisition, never retries', async () => {
  let cancelled = 0;
  const {probe, requests} = setup(() => new Response(new ReadableStream({cancel() { cancelled++; }}, {highWaterMark: 0}), {status: http}));
  const promise = probe.run(), result = await promise; safe(result); await flush();
  assert.equal(result.status, 'HTTP_STOP'); assert.equal(result.observations[0].http_status, http);
  assert.equal(requests.length, 1); assert.equal(cancelled, 1); assert.equal(requests[0].init.signal.aborted, true);
  assert.equal(probe.run(), promise);
});
test('redirected response and changed final target are rejected even from injected transport', async () => {
  for (const [key, value] of [['redirected', true], ['url', 'https://arbitrary.invalid/' + CANARY]]) {
    const {probe, requests} = setup(url => { const response = json(payload(url)); Object.defineProperty(response, key, {value}); return response; });
    const result = await probe.run(); safe(result); assert.equal(result.status, 'HTTP_STOP'); assert.equal(requests.length, 1);
  }
});
test('sync/async network errors cannot echo secrets or continue', async () => {
  for (const transport of [() => { throw Error(TOKEN + CANARY); }, async () => { throw Error(TOKEN + CANARY); }]) {
    const {probe, requests} = setup(transport); const result = await probe.run(); safe(result);
    assert.equal(result.status, 'NETWORK_OR_AMBIGUOUS'); assert.equal(result.calls, 1); assert.equal(requests.length, 1);
    assert.equal(requests[0].init.signal.aborted, true);
  }
});
for (const mutate of [x => { x.result = []; x.count = 0; }, x => { x.result.push({...x.result[0]}); x.count = 2; },
  x => { x.result[0].symbol = 'TSM'; }, x => { x.count = 2; }, x => { x.error = TOKEN + CANARY; },
  x => { delete x.result; }]) test('ambiguous search stops before estimate acquisition', async () => {
  const {probe, requests} = setup(url => { const x = payload(url); mutate(x); return json(x); });
  const result = await probe.run(); safe(result); assert.equal(result.status, 'AMBIGUOUS_RESPONSE'); assert.equal(requests.length, 1);
});
test('empty estimate arrays are observations, never coverage, entitlement or four-quarter success', async () => {
  const {probe} = setup(url => { const x = payload(url); if (x.data) x.data = []; return json(x); });
  const result = await probe.run(); safe(result); assert.equal(result.calls, 6);
  for (const o of result.observations.filter(o => o.endpoint !== 'search')) {
    assert.equal(o.shape, 'EMPTY'); assert.equal(o.row_count, 0); assert.equal(o.quarter_count, 0);
  }
});
const badEstimate = [
  x => { x.symbol = 'TSM'; }, x => { x.freq = 'annual'; }, x => { x.data[0].quarter = 0; },
  x => { x.data[0].period = '2025-02-30'; }, x => { x.data[0].epsAvg = null; },
  x => { x.data[0].epsAvg = '10'; }, x => { x.data[0].epsLow = 11; }, x => { x.data[0].epsHigh = 9; },
  x => { x.data[0].epsActual = 12; }, x => { x.data.push({...x.data[0]}); },
];
for (const mutate of badEstimate) test('ambiguous quarterly estimate stops, no data or error text returned', async () => {
  const {probe, requests} = setup(url => { const x = payload(url); if (x.data) mutate(x); return json(x); });
  const result = await probe.run(); safe(result); assert.equal(result.status, 'AMBIGUOUS_RESPONSE'); assert.equal(requests.length, 2);
});
test('65 rows exceeds the JSON row cap without another request', async () => {
  const {probe, requests} = setup(url => { const x = payload(url); if (x.data) x.data = Array.from({length: 65}, () => x.data[0]); return json(x); });
  const result = await probe.run(); safe(result); assert.equal(result.status, 'ROW_LIMIT'); assert.equal(requests.length, 2);
});
for (const body of ['{', 'null', '[]', JSON.stringify({error: TOKEN + CANARY})]) test('malformed/ambiguous JSON safely stops', async () => {
  const {probe, requests} = setup(() => new Response(body, {headers: {'content-type': 'application/json'}}));
  const result = await probe.run(); safe(result); assert.equal(result.status, 'AMBIGUOUS_RESPONSE'); assert.equal(requests.length, 1);
});
for (const headers of [{}, {'content-type': 'text/html'}, {'content-type': 'application/json', 'content-length': 'x'},
  {'content-type': 'application/json', 'content-length': '65537'}]) test('response headers cannot bypass bounded JSON acquisition', async () => {
  const {probe, requests} = setup(url => new Response(JSON.stringify(payload(url)), {headers}));
  const result = await probe.run(); safe(result); assert.notEqual(result.status, 'BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED');
  assert.equal(requests.length, 1); assert.equal(requests[0].init.signal.aborted, true);
});
test('64 KiB exactly accepted, one byte more cancelled, no content-length required', async () => {
  const exact = setup((url, init, n) => n === 1
    ? new Response(JSON.stringify(payload(url)).padEnd(65536), {headers: {'content-type': 'application/json'}}) : json(payload(url)));
  const accepted = await exact.probe.run(); safe(accepted); assert.equal(accepted.calls, 6);
  assert.equal(accepted.observations[0].accepted_bytes, 65536);
  for (const size of [65536, 65537]) {
    if (size === 65536) continue;
    let cancelled = 0;
    const {probe, requests} = setup((url, init, n) => {
      if (n > 1) return json(payload(url));
      const text = JSON.stringify(payload(url));
      const bytes = new TextEncoder().encode(text + ' '.repeat(size - text.length));
      return new Response(new ReadableStream({start(c) { c.enqueue(bytes); }, cancel() { cancelled++; }}, {highWaterMark: 0}), {headers: {'content-type': 'application/json'}});
    });
    const result = await probe.run(); safe(result); assert.equal(result.status, 'BODY_LIMIT');
    assert.equal(requests.length, 1); assert.equal(cancelled, 1); assert.equal(requests[0].init.signal.aborted, true);
  }
});
test('byte cap is UTF-8 not character count; invalid UTF-8 is ambiguous', async () => {
  for (const bytes of [new TextEncoder().encode('中'.repeat(22000)), new Uint8Array([0xff, 0xff])]) {
    const {probe, requests} = setup(() => new Response(bytes, {headers: {'content-type': 'application/json'}}));
    const result = await probe.run(); safe(result); assert.equal(requests.length, 1);
    assert.equal(result.status, bytes.length > 65536 ? 'BODY_LIMIT' : 'AMBIGUOUS_RESPONSE');
  }
});
test('infinite zero-length chunks cannot starve deadline timers indefinitely', async () => {
  let cancelled = 0;
  const {probe} = setup(() => new Response(new ReadableStream({pull(c) { c.enqueue(new Uint8Array()); }, cancel() { cancelled++; }}, {highWaterMark: 0}), {headers: {'content-type': 'application/json'}}));
  const result = await probe.run(); assert.equal(result.status, 'BODY_LIMIT'); assert.equal(result.calls, 1); assert.equal(cancelled, 1);
});

test('hung fetch is aborted at 2 seconds; late Response is cancelled, not read; no subsequent calls', async t => {
  const {clock, advance} = fakeTime(t); let resolveFetch, cancelled = 0, pulls = 0;
  const {probe, requests} = setup(() => new Promise(resolve => { resolveFetch = resolve; }), {clock});
  const resultPromise = probe.run(); await flush(); assert.equal(requests.length, 1);
  await advance(1999); assert.equal(requests[0].init.signal.aborted, false);
  await advance(1); const result = await resultPromise; safe(result);
  assert.equal(result.status, 'CALL_TIMEOUT'); assert.equal(requests[0].init.signal.aborted, true);
  resolveFetch(new Response(new ReadableStream({pull() { pulls++; }, cancel() { cancelled++; }}, {highWaterMark: 0}), {headers: {'content-type': 'application/json'}}));
  await flush(); assert.equal(cancelled, 1); assert.equal(pulls, 0); assert.equal(requests.length, 1);
});
test('body timeout aborts and actively cancels pending reader, even if cancel promise never resolves', async t => {
  const {clock, advance} = fakeTime(t); let cancelled = 0;
  const {probe, requests} = setup(() => new Response(new ReadableStream({pull() { return new Promise(() => {}); },
    cancel() { cancelled++; return new Promise(() => {}); }}, {highWaterMark: 0}), {headers: {'content-type': 'application/json'}}), {clock});
  const pending = probe.run(); await flush(); await advance(2000);
  const result = await pending; safe(result); assert.equal(result.status, 'CALL_TIMEOUT');
  assert.equal(cancelled, 1); assert.equal(requests.length, 1); assert.equal(requests[0].init.signal.aborted, true);
});
test('fetch and body share ONE 2-second call budget, not two independent timeouts', async t => {
  const {clock, advance} = fakeTime(t); let cancelled = 0;
  const {probe, requests} = setup(() => new Promise(resolve => setTimeout(() => resolve(new Response(new ReadableStream({
    pull() { return new Promise(() => {}); }, cancel() { cancelled++; }}, {highWaterMark: 0}), {headers: {'content-type': 'application/json'}})), 1600)), {clock});
  const pending = probe.run(); await flush(); await advance(1600); await advance(400);
  assert.equal((await pending).status, 'CALL_TIMEOUT'); assert.equal(cancelled, 1); assert.equal(requests.length, 1);
});
test('15-second batch includes credential wait; in-flight GET aborted, no calls after deadline', async t => {
  const {clock, advance} = fakeTime(t);
  const {probe, requests} = setup(url => new Promise(resolve => setTimeout(() => resolve(json(payload(url))), 1800)), {
    clock, getCredential: () => new Promise(resolve => setTimeout(() => resolve(TOKEN), 10000)),
  });
  const pending = probe.run(); await flush(); await advance(10000); await advance(1800); await advance(1800);
  assert.equal(requests.length, 3); await advance(1400);
  const result = await pending; safe(result); assert.equal(result.status, 'BATCH_DEADLINE');
  assert.equal(requests.length, 3); assert.equal(requests[2].init.signal.aborted, true);
  await advance(10000); assert.equal(requests.length, 3);
});
test('hung credential callback is bounded to 15 seconds, late credential cannot start fetch', async t => {
  const {clock, advance} = fakeTime(t); let deliver;
  const {probe, requests} = setup(undefined, {clock, getCredential: () => new Promise(resolve => { deliver = resolve; })});
  const pending = probe.run(); await flush(); await advance(15000);
  const result = await pending; safe(result); assert.equal(result.status, 'BATCH_DEADLINE'); assert.equal(result.calls, 0);
  deliver(TOKEN); await flush(); assert.equal(requests.length, 0);
});
for (const clock of [() => NaN, () => Infinity, () => -1, () => { throw Error(TOKEN); }]) test('invalid clock blocks zero calls safely', async () => {
  const {probe, requests} = setup(undefined, {clock}); const result = await probe.run(); safe(result);
  assert.equal(result.status, 'CLOCK_INVALID'); assert.equal(requests.length, 0);
});
test('backward or forward-deadline clock movement fails closed, aborts, never extends budget', async () => {
  for (const later of [-1, 15000]) {
    let ms = 0;
    const {probe, requests} = setup(url => { ms = later; return json(payload(url)); }, {clock: () => ms});
    const result = await probe.run(); safe(result); assert.equal(requests.length, 1);
    assert.equal(result.status, later < 0 ? 'CLOCK_INVALID' : 'BATCH_DEADLINE');
    assert.equal(requests[0].init.signal.aborted, true);
  }
});
test('clock detects a 2-second call overrun even before a delayed timeout callback runs', async () => {
  let ms = 0;
  const {probe, requests} = setup(url => { ms = 2000; return json(payload(url)); }, {clock: () => ms});
  const result = await probe.run(); safe(result); assert.equal(result.status, 'CALL_TIMEOUT');
  assert.equal(requests.length, 1); assert.equal(requests[0].init.signal.aborted, true);
});
for (const remainingMs of [-1, 15001, Infinity, NaN, '1000', null, undefined]) test('invalid remaining budget blocks zero calls', async () => {
  const {probe, requests, credentials} = setup(); const result = await probe.run({remainingMs}); safe(result);
  assert.equal(result.status, 'BLOCKED_INPUT'); assert.equal(requests.length, 0); assert.equal(credentials.count, 0);
});
test('only AbortSignal accepted, never arbitrary cancellation objects/accessors or extra run keys', async () => {
  let accessed = false;
  for (const controls of [{signal: {}}, {signal: 'abort'}, {signal: null}, {remainingMs: 1000, headers: {token: TOKEN}},
    Object.defineProperty({}, 'remainingMs', {get() { accessed = true; return 15000; }})]) {
    const {probe, requests} = setup(); assert.equal((await probe.run(controls)).status, 'BLOCKED_INPUT'); assert.equal(requests.length, 0);
  }
  assert.equal(accessed, false);
});
test('zero remaining budget or pre-aborted outer signal blocks even credential retrieval', async () => {
  const controller = new AbortController(); controller.abort(TOKEN + CANARY);
  for (const options of [{remainingMs: 0}, {signal: controller.signal, remainingMs: 500}]) {
    const {probe, requests, credentials} = setup(); const result = await probe.run(options); safe(result);
    assert.equal(result.status, options.signal ? 'EXTERNAL_ABORT' : 'BATCH_DEADLINE');
    assert.equal(requests.length, 0); assert.equal(credentials.count, 0);
  }
});
test('remaining budget begins synchronously at run(), not in a later queued execution', async () => {
  let ms = 0;
  const {probe, requests, credentials} = setup(undefined, {clock: () => ms});
  const pending = probe.run({remainingMs: 100}); ms = 101;
  const result = await pending; safe(result); assert.equal(result.status, 'BATCH_DEADLINE');
  assert.equal(requests.length, 0); assert.equal(credentials.count, 0);
});
test('outer Auth/Storage remaining budget is not replaced with another 15 seconds', async t => {
  const {clock, advance} = fakeTime(t);
  const {probe, requests} = setup(() => new Promise(() => {}), {clock});
  const pending = probe.run({remainingMs: 375}); await flush(); await advance(375);
  const result = await pending; safe(result); assert.equal(result.status, 'BATCH_DEADLINE');
  assert.equal(requests.length, 1); assert.equal(requests[0].init.signal.aborted, true);
});
test('external abort while awaiting credential is sanitized; late credential cannot start acquisition', async () => {
  let deliver;
  const controller = new AbortController();
  const {probe, requests} = setup(undefined, {getCredential: () => new Promise(resolve => { deliver = resolve; })});
  const pending = probe.run({signal: controller.signal, remainingMs: 12000}); await flush();
  controller.abort(TOKEN + CANARY); const result = await pending; safe(result);
  assert.equal(result.status, 'EXTERNAL_ABORT'); assert.equal(result.calls, 0);
  deliver(TOKEN); await flush(); assert.equal(requests.length, 0);
});
test('external abort cancels late fetch Response without reading or proceeding', async () => {
  let deliver, cancelled = 0, pulls = 0;
  const controller = new AbortController();
  const {probe, requests} = setup(() => new Promise(resolve => { deliver = resolve; }));
  const pending = probe.run({signal: controller.signal}); await flush(); controller.abort(TOKEN + CANARY);
  const result = await pending; safe(result); assert.equal(result.status, 'EXTERNAL_ABORT');
  deliver(new Response(new ReadableStream({pull() { pulls++; }, cancel() { cancelled++; }}, {highWaterMark: 0}), {headers: {'content-type': 'application/json'}}));
  await flush(); assert.equal(cancelled, 1); assert.equal(pulls, 0); assert.equal(requests.length, 1);
  assert.equal(requests[0].init.signal.aborted, true);
});
test('external abort actively cancels a pending body reader and stops the same instance permanently', async () => {
  let cancelled = 0;
  const controller = new AbortController();
  const {probe, requests} = setup(() => new Response(new ReadableStream({pull() { return new Promise(() => {}); },
    cancel() { cancelled++; }}, {highWaterMark: 0}), {headers: {'content-type': 'application/json'}}));
  const pending = probe.run({signal: controller.signal, remainingMs: 5000}); await flush(); controller.abort(TOKEN + CANARY);
  const result = await pending; safe(result); assert.equal(result.status, 'EXTERNAL_ABORT');
  assert.equal(cancelled, 1); assert.equal(requests.length, 1); assert.equal(probe.run({remainingMs: 15000}), pending);
});
test('first concurrent run options win; later caller cannot reset deadline or replace outer cancellation', async t => {
  const {clock, advance} = fakeTime(t);
  const controller = new AbortController();
  const {probe, requests} = setup(() => new Promise(() => {}), {clock});
  const first = probe.run({signal: controller.signal, remainingMs: 100});
  const second = probe.run({signal: new AbortController().signal, remainingMs: 15000});
  assert.equal(first, second); await flush(); await advance(100);
  assert.equal((await first).status, 'BATCH_DEADLINE'); assert.equal(requests.length, 1);
});
test('manifest keeps binding/Owner/durable-claim approval external; module has no ambient I/O', () => {
  assert.equal(manifest.max_calls, 6); assert.equal(manifest.deadline_ms, 15000); assert.equal(manifest.per_call_ms, 2000);
  assert.equal(manifest.retries, 0); assert.equal(manifest.backend_binding_approved, false);
  assert.equal(manifest.symbol_mapping, 'HYPOTHESIS_UNVERIFIED'); assert(Object.isFrozen(manifest.hypotheses[0]));
  assert(manifest.future_binding_requires.includes('REAL_OWNER_ONLY_BACKEND_AUTH'));
  assert(manifest.future_binding_requires.includes('DURABLE_CROSS_ISOLATE_CLAIM'));
  const source = readFileSync(new URL('../scripts/capability/finnhub-quarterly-probe.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.|Deno\.|console\.|node:fs|node:http|\.rpc\s*\(|\.upsert\s*\(|Promise\.race|globalThis\.fetch/);
});
