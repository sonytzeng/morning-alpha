// SYNTHETIC component/SSR/SDK transport controls. No Production session,
// credentials, provider calls, network, filesystem writes or source admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FunctionsClient } from '@supabase/functions-js';

const require = createRequire(import.meta.url);
const file = 'src/pages/admin/analysis/ProviderCapabilityReview.tsx';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read(file);
const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const BEFORE = Date.parse('2026-10-17T05:00:00Z');
const EXPIRY = Date.parse('2026-10-18T06:00:00Z');
const UNCERTAIN = '結果不確定，請勿重試';
const FIXED = 'v1-provider-capability-review-v1';
const PLAN = [['2330', 'search'], ['2330', 'eps'], ['2330', 'revenue'],
  ['6488', 'search'], ['6488', 'eps'], ['6488', 'revenue']];
const jsx = (type, props) => ({ type, props });
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join(' ')
  : typeof node === 'object' ? text(node.props?.children) : String(node);
function nodes(node, type) {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, type));
  if (!node || typeof node !== 'object') return [];
  return [...(node.type === type ? [node] : []), ...nodes(node.props?.children, type)];
}
function fixture() {
  return { status: 'DIAGNOSTIC_ONLY', candidate_only: true, formal_admission: false,
    member_publication: false, business_writes: 0, control_object_write: 'CONSUMED', summary: {
      probe_status: 'BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED', calls: 6, observed_responses: 6,
      row_count: 384, quarter_count: 384, symbol_mapping: 'HYPOTHESIS_UNVERIFIED', tw72_coverage: 'UNKNOWN',
      current_entitlement: 'UNPROVEN', historical_vintage: 'UNPROVEN', commercial_member_reuse_rights: 'UNPROVEN',
      average_provenance: 'FINNHUB_AVERAGE_INCLUDING_PROPRIETARY', pure_broker_consensus: false,
      observations: PLAN.map(([local_symbol, endpoint]) => ({ local_symbol, endpoint,
        http_status: 200, status: 'OBSERVED_ONLY', shape: endpoint === 'search' ? 'SEARCH_ROWS' : 'QUARTERLY_ESTIMATE_ROWS',
        row_count: 64, quarter_count: 64, accepted_bytes: 65536 })),
    } };
}
function withObservations(observations, probeStatus = 'BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED') {
  const data = fixture();
  Object.assign(data.summary, { observations, probe_status: probeStatus, calls: observations.length,
    observed_responses: observations.filter(row => row.status === 'OBSERVED_ONLY').length,
    row_count: observations.reduce((sum, row) => sum + row.row_count, 0),
    quarter_count: observations.reduce((sum, row) => sum + row.quarter_count, 0) });
  return data;
}
function load(react, runtime, supabase, globals = {}) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, ...globals, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return runtime;
    if (name === '@/lib/supabase') return { supabase };
    throw Error('UNAPPROVED_COMPONENT_IMPORT');
  } }, { filename: file });
  return exports.default;
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

function harness({ now = BEFORE, invoke, realJsx = false } = {}) {
  let clock = now, cursor = 0, nextTimer = 0, tree, unmounted = false;
  const slots = [], effects = [], queued = [], timers = new Map(), listeners = new Set(), calls = [];
  let resolve, reject;
  const response = new Promise((yes, no) => { resolve = yes; reject = no; });
  const hooks = {
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { assert(!unmounted, 'no state update after unmount'); slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useEffect(fn, deps) {
      const i = cursor++, previous = effects[i];
      if (!previous || !deps || deps.some((v, j) => !Object.is(v, previous.deps[j]))) {
        queued.push(() => { previous?.cleanup?.(); effects[i] = { fn, deps, cleanup: fn() }; });
      }
    },
  };
  const supabase = { auth: { onAuthStateChange(listener) {
    listeners.add(listener); return { data: { subscription: { unsubscribe() { listeners.delete(listener); } } } };
  } }, functions: { invoke(...args) { calls.push(args); return invoke ? invoke(...args) : response; } } };
  const Component = load(hooks, realJsx ? require('react/jsx-runtime') : { jsx, jsxs: jsx }, supabase, {
    Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, due: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function render() {
    cursor = 0; tree = Component();
    while (queued.length) queued.shift()();
    return tree;
  }
  render();
  return {
    calls, render, get text() { return text(render()); },
    get button() { return nodes(render(), 'button')[0]; },
    click() { this.button.props.onClick(); },
    event(event) { for (const listener of [...listeners]) listener(event); },
    get authCallback() { return [...listeners][0]; },
    get subscriptions() { return listeners.size; },
    setClock(at) { clock = at; },
    advance(ms) {
      clock += ms;
      for (;;) {
        const entry = [...timers].sort((a, b) => a[1].due - b[1].due).find(([, timer]) => timer.due <= clock);
        if (!entry) break;
        timers.delete(entry[0]); entry[1].fn();
      }
    },
    async resolve(data = fixture(), error = null) { resolve({ data, error }); await flush(); },
    async reject(error = Error('PRIVATE_ERROR_PAYLOAD')) { reject(error); await flush(); },
    strictEffectReplay() {
      for (const effect of effects.filter(Boolean)) { effect.cleanup?.(); effect.cleanup = effect.fn(); }
    },
    unmount() { for (const effect of effects.filter(Boolean)) effect.cleanup?.(); unmounted = true; },
    get timers() { return timers.size; },
    get snapshot() { return slots.find(slot => slot?.kind === 'result')?.summary; },
  };
}

test('SYNTHETIC real React SSR: explanatory copy, no invoke, expired button disabled', () => {
  const forbidden = () => { throw Error('SSR_MUST_NOT_ACCESS_TRANSPORT'); };
  for (const [now, disabled] of [[BEFORE, false], [EXPIRY, true]]) {
    const Component = load(React, require('react/jsx-runtime'), { auth: { onAuthStateChange: forbidden }, functions: { invoke: forbidden } }, {
      Date: class extends Date { static now() { return now; } },
    });
    const html = renderToStaticMarkup(React.createElement(Component));
    assert.match(html, /執行一次資料能力檢查/); assert.match(html, /最多6次 GET／整批15秒/);
    assert.match(html, /2026-10-18T06:00:00Z/); assert.match(html, /不是會員功能/);
    assert.match(html, /不改業務資料、不公開研究/); assert.match(html, /私有一次性標記/);
    assert.match(html, /實際 API 200 也不代表 V1 完整/);
    assert.equal(/<button[^>]*\sdisabled(?:=|\s|>)/.test(html), disabled);
  }
});

test('SYNTHETIC mount, rerender and StrictMode effect replay never invoke', () => {
  const h = harness(); h.render(); h.strictEffectReplay(); h.render();
  assert.equal(h.calls.length, 0); assert.equal(h.subscriptions, 1);
  h.event('INITIAL_SESSION'); h.event('TOKEN_REFRESHED');
  assert.equal(h.calls.length, 0); assert.equal(h.button.props.disabled, false);
  h.unmount(); assert.equal(h.subscriptions, 0); assert.equal(h.timers, 0);
});

test('SYNTHETIC synchronous ref claims before double click; fixed function and empty body only', async () => {
  const h = harness(), staleClick = h.button.props.onClick;
  staleClick(); staleClick(); h.click();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], FIXED);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])), { body: {} });
  assert.equal(h.button.props.disabled, true);
  await h.resolve(); assert.match(h.text, /限定診斷已完成/); h.click(); assert.equal(h.calls.length, 1);
  h.unmount();
});

test('SYNTHETIC real pinned FunctionsClient transport: exactly one POST {} without credentials/network', async () => {
  const requests = [];
  const sdk = new FunctionsClient('https://synthetic.invalid/functions/v1', { customFetch: async (url, init) => {
    requests.push({ url, init }); return Response.json(fixture());
  } });
  const h = harness({ invoke: sdk.invoke.bind(sdk) }); h.click(); await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://synthetic.invalid/functions/v1/' + FIXED);
  assert.equal(requests[0].init.method, 'POST'); assert.equal(requests[0].init.body, '{}');
  assert.deepEqual(Object.keys(requests[0].init.headers), ['Content-Type']);
  assert.match(h.text, /限定診斷已完成/); h.click(); assert.equal(requests.length, 1); h.unmount();
});

test('SYNTHETIC picks bounded totals/classifications; raw observations, URLs, errors and provider values never render', async () => {
  const clean = harness(); clean.click(); await clean.resolve();
  assert.deepEqual(nodes(clean.render(), 'dd').map(text).map(value => value.replace(/\s/g, '')), ['6／6', '6／6', '384／384', '384／384']);
  assert.match(clean.text, /仍未證明/); clean.unmount();
  const data = fixture();
  data.raw = 'PRIVATE_RAW_TOP'; data.error = '<script>PRIVATE_ERROR</script>';
  data.summary.observations = [{ local_symbol: '2330', endpoint: 'eps', status: 'PRIVATE_ENUM', raw: 'PRIVATE_PROVIDER_VALUE' }];
  data.summary.unknown = 'https://private.invalid/PRIVATE_URL';
  const h = harness(); h.click(); await h.resolve(data);
  assert.match(h.text, new RegExp(UNCERTAIN)); assert.match(h.text, /仍未證明/);
  assert.doesNotMatch(h.text, /PRIVATE|2330|private\.invalid|<script>/); h.unmount();
});

test('SYNTHETIC zero totals remain zero, not invented coverage', async () => {
  const data = fixture(); Object.assign(data.summary, { calls: 0, observed_responses: 0, row_count: 0, quarter_count: 0, observations: [] });
  const h = harness(); h.click(); await h.resolve(data);
  assert.deepEqual(nodes(h.render(), 'dd').map(text).map(value => value.replace(/\s/g, '')), ['0／6', '0／6', '0／384', '0／384']);
  assert.match(h.text, /季度計數不代表連續四季完整/); h.unmount();
});

test('SYNTHETIC malformed/noninteger/out-of-bound counters fail closed without resetting once', async () => {
  const cases = [
    ['calls', -1], ['calls', 7], ['calls', '6'], ['calls', null], ['calls', 1.5], ['calls', NaN],
    ['observed_responses', 7], ['observed_responses', -1], ['observed_responses', '1'],
    ['row_count', -1], ['row_count', 385], ['row_count', 1.5], ['row_count', Infinity], ['row_count', '64'],
    ['quarter_count', -1], ['quarter_count', 385], ['quarter_count', '4'], ['quarter_count', NaN],
  ];
  for (const [key, value] of cases) {
    const h = harness(), data = fixture(); data.summary[key] = value;
    h.click(); await h.resolve(data);
    assert.match(h.text, new RegExp(UNCERTAIN), key); assert.doesNotMatch(h.text, /資料列總數/);
    h.click(); assert.equal(h.calls.length, 1); h.unmount();
  }
  for (const patch of [{ calls: 1, observed_responses: 2 }, { calls: 1, row_count: 65 }, { calls: 1, quarter_count: 65 }]) {
    const h = harness(), data = fixture(); Object.assign(data.summary, patch);
    h.click(); await h.resolve(data); assert.match(h.text, new RegExp(UNCERTAIN)); h.unmount();
  }
});

test('SYNTHETIC unknown/prototype status and admission/rights upgrades never display as valid results', async () => {
  const changes = [
    data => { data.status = 'PRIVATE_STATUS'; }, data => { data.summary.probe_status = '__proto__'; },
    data => { data.summary.probe_status = 'PRIVATE_STATUS'; }, data => { data.summary.probe_status = 'constructor'; },
    data => { data.candidate_only = false; }, data => { data.formal_admission = true; },
    data => { data.member_publication = true; }, data => { data.business_writes = 1; },
    data => { data.control_object_write = 'POSSIBLE'; }, data => { data.summary.symbol_mapping = 'VERIFIED'; },
    data => { data.summary.tw72_coverage = 72; }, data => { data.summary.current_entitlement = 'PROVEN'; },
    data => { data.summary.historical_vintage = 'PROVEN'; }, data => { data.summary.commercial_member_reuse_rights = 'PROVEN'; },
    data => { data.summary.average_provenance = 'PURE_BROKER'; }, data => { data.summary.pure_broker_consensus = true; },
    data => { delete data.summary.quarter_count; }, data => { data.summary = []; },
  ];
  for (const change of changes) {
    const h = harness(), data = fixture(); change(data); h.click(); await h.resolve(data);
    assert.match(h.text, new RegExp(UNCERTAIN)); assert.doesNotMatch(h.text, /PRIVATE|限定診斷已完成|資料列總數/); h.unmount();
  }
});

test('SYNTHETIC known diagnostic stop status uses fixed uncertain copy, never raw status', async () => {
  const h = harness(), data = fixture(); data.summary.probe_status = 'HTTP_STOP';
  h.click(); await h.resolve(data); assert.match(h.text, new RegExp(UNCERTAIN));
  assert.doesNotMatch(h.text, /HTTP_STOP/); h.unmount();
});

test('SYNTHETIC SDK error, throw and malformed body use one fixed error with no retry', async () => {
  for (const kind of ['error', 'reject', 'null', 'html', 'getter']) {
    const h = harness(); h.click();
    if (kind === 'reject') await h.reject();
    else {
      const data = kind === 'null' ? null : kind === 'html' ? '<b>PRIVATE_RAW</b>' : fixture();
      if (kind === 'getter') Object.defineProperty(data, 'status', { get() { throw Error('PRIVATE_JSON_TRAP'); } });
      await h.resolve(data, kind === 'error' ? { context: 'PRIVATE_ERROR', message: 'PRIVATE_ERROR' } : null);
    }
    assert.match(h.text, new RegExp(UNCERTAIN)); assert.doesNotMatch(h.text, /PRIVATE|限定診斷已完成/);
    h.click(); assert.equal(h.calls.length, 1); h.unmount();
  }
});

for (const event of ['SIGNED_OUT', 'SIGNED_IN', 'USER_UPDATED']) {
  test(`SYNTHETIC ${event} clears completed totals and permanently disables current instance`, async () => {
    const h = harness(); h.click(); await h.resolve(); assert.match(h.text, /資料列總數/);
    h.event(event); assert.doesNotMatch(h.text, /資料列總數|限定診斷已完成/);
    assert.match(h.text, /結果已清除/); h.click(); assert.equal(h.calls.length, 1); h.unmount();
  });
  test(`SYNTHETIC ${event} wins in-flight late success/error and stale click`, async () => {
    for (const reject of [false, true]) {
      const h = harness(), staleClick = h.button.props.onClick; h.click(); h.event(event);
      if (reject) await h.reject(); else await h.resolve();
      staleClick(); assert.equal(h.calls.length, 1); assert.doesNotMatch(h.text, /資料列總數|限定診斷已完成|PRIVATE/);
      assert.match(h.text, /結果已清除/); h.unmount();
    }
  });
}

test('SYNTHETIC auth change before click blocks stale handler, without reading session/token', () => {
  const h = harness(), staleClick = h.button.props.onClick;
  h.event('SIGNED_OUT'); staleClick(); assert.equal(h.calls.length, 0); h.unmount();
});

test('SYNTHETIC unmount unsubscribes and ignores late success/rejection without state updates', async () => {
  for (const reject of [false, true]) {
    const h = harness(), queuedAuth = h.authCallback; h.click(); h.unmount();
    queuedAuth('SIGNED_OUT'); assert.equal(h.subscriptions, 0); assert.equal(h.timers, 0);
    if (reject) await h.reject(); else await h.resolve();
    assert.equal(h.calls.length, 1);
  }
});

test('SYNTHETIC local 15s deadline wins late response and never releases once', async () => {
  const h = harness(); h.click(); h.advance(15_000); assert.match(h.text, new RegExp(UNCERTAIN));
  await h.resolve(); assert.doesNotMatch(h.text, /資料列總數|限定診斷已完成/);
  h.click(); assert.equal(h.calls.length, 1); h.unmount();
  const queued = harness(); queued.click(); queued.setClock(BEFORE + 15_000); await queued.resolve();
  assert.match(queued.text, new RegExp(UNCERTAIN), 'late microtask cannot beat queued timer'); queued.unmount();
});

test('SYNTHETIC expiry/invalid clock blocks initial and stale clicks; expiry clears late response', async () => {
  for (const now of [EXPIRY, EXPIRY + 1, NaN]) {
    const h = harness({ now }); assert.equal(h.button.props.disabled, true); h.click();
    assert.equal(h.calls.length, 0); h.unmount();
  }
  const stale = harness(), click = stale.button.props.onClick; stale.setClock(EXPIRY); click();
  assert.equal(stale.calls.length, 0); assert.equal(stale.button.props.disabled, true); stale.unmount();
  const pending = harness({ now: EXPIRY - 1 }); pending.click(); pending.advance(1); await pending.resolve();
  assert.match(pending.text, /已到期/); assert.doesNotMatch(pending.text, /資料列總數/);
  assert.equal(pending.button.props.disabled, true); pending.unmount();
});

test('SYNTHETIC page mounts exactly one slot inside original ready Owner RPC branch only', () => {
  const page = read('src/pages/admin/analysis/page.tsx');
  const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const slots = [], gates = [];
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ProviderCapabilityReview') slots.push(node);
    if (ts.isIfStatement(node) && node.expression.getText(ast) === "state.kind === 'ready' && state.data") gates.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(slots.length, 1); assert.equal(gates.length, 1);
  assert(slots[0].pos > gates[0].thenStatement.pos && slots[0].end < gates[0].thenStatement.end);
  assert.match(page, /supabase\.rpc\('get_research_foundation_v1'\)/);
  assert.match(page, /supabase\.rpc\('get_owner_analysis_v2'/);
  assert.match(page, /intelligence\.error\?\.code === '42501'/);
  assert.doesNotMatch(source, /getSession|getUser|access_token|Authorization|localStorage|sessionStorage|console\.|JSON\.stringify|\.rpc\(|\.from\(|fetch\(/);
  assert.equal((source.match(/supabase\.functions\.invoke\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /claimed\.current\s*=\s*false/);
});

test('SYNTHETIC every exact plan prefix is accepted; item details are initially collapsed and at most six rows', async () => {
  for (let length = 0; length <= 6; length++) {
    const h = harness(), data = withObservations(fixture().summary.observations.slice(0, length));
    h.click(); await h.resolve(data);
    assert.match(h.text, /限定診斷已完成/);
    const details = nodes(h.render(), 'details');
    assert.equal(details.length, 1); assert.equal(details[0].props.open, undefined);
    assert.equal(text(nodes(details[0], 'summary')[0]), '各項檢查結果');
    assert.equal(nodes(details[0], 'li').length, length);
    assert.deepEqual(nodes(h.render(), 'dd').map(text).map(value => value.replace(/\s/g, '')),
      [`${length}／6`, `${length}／6`, `${length * 64}／384`, `${length * 64}／384`]);
    h.unmount();
  }
});

test('SYNTHETIC real React result DOM: valid partial prefix explains 403 and empty without raw metadata', async () => {
  const observations = fixture().summary.observations.slice(0, 2);
  Object.assign(observations[0], { shape: 'EMPTY', row_count: 0, quarter_count: 0, accepted_bytes: 0 });
  Object.assign(observations[1], { http_status: 403, status: 'HTTP_STOP', shape: null,
    row_count: 0, quarter_count: 0, accepted_bytes: 0 });
  const h = harness({ realJsx: true }); h.click(); await h.resolve(withObservations(observations, 'HTTP_STOP'));
  const html = renderToStaticMarkup(h.render()), compact = html.replace(/\s/g, '');
  assert.match(compact, /2330每股盈餘估計：HTTP403／權限拒絕/);
  assert.match(html, /沒有資料（不代表零值或不支援）/);
  assert.match(html, /結果不確定，請勿重試/);
  assert.match(compact, /列數0；季度欄位計數0/);
  assert.equal((html.match(/<li[ >]/g) ?? []).length, 2);
  assert.doesNotMatch(html.match(/<details[^>]*>/)[0], /\sopen(?:=|\s|>)/);
  assert.doesNotMatch(html, /6488|營收估計|HTTP_STOP|EMPTY|accepted_bytes|local_symbol|PRIVATE/);
  h.event('SIGNED_OUT');
  assert.doesNotMatch(renderToStaticMarkup(h.render()), /2330|各項檢查結果|HTTP403/);
  h.unmount();
});

test('SYNTHETIC null HTTP is a fixed unavailable label, never an invented HTTP or error text', async () => {
  const item = fixture().summary.observations[0];
  Object.assign(item, { http_status: null, status: 'NETWORK_OR_AMBIGUOUS', shape: null, row_count: 0, quarter_count: 0 });
  const h = harness(); h.click(); await h.resolve(withObservations([item], 'NETWORK_OR_AMBIGUOUS'));
  assert.match(h.text.replace(/\s/g, ''), /2330股票搜尋：HTTP未取得／連線或回應無法確認/);
  assert.doesNotMatch(h.text, /HTTP0|HTTPnull|NETWORK_OR_AMBIGUOUS/); h.unmount();
});

test('SYNTHETIC unknown fields at every envelope level reject the entire result without reflection', async () => {
  const mutations = [
    data => { data.raw = '<script>PRIVATE_RAW</script>'; },
    data => { data.error = 'PRIVATE_ERROR'; },
    data => { data.summary.provider_url = 'https://private.invalid/PRIVATE_URL'; },
    data => { data.summary.observations[0].raw = 'PRIVATE_PROVIDER_VALUE'; },
    data => { data.summary.observations[0].error_text = 'PRIVATE_ERROR_TEXT'; },
    data => { Object.defineProperty(data.summary.observations[0], '__proto__', { value: 'PRIVATE_PROTO', enumerable: true }); },
    data => { data.summary.observations[0].data = { PRIVATE_PAYLOAD: true }; },
  ];
  for (const mutate of mutations) {
    const h = harness(), data = fixture(); mutate(data); h.click(); await h.resolve(data);
    assert.match(h.text, new RegExp(UNCERTAIN));
    assert.doesNotMatch(h.text, /PRIVATE|private\.invalid|<script>|資料列總數|2330|6488|各項檢查結果/);
    assert.equal(h.snapshot, undefined); h.click(); assert.equal(h.calls.length, 1); h.unmount();
  }
});

test('SYNTHETIC wrong order, duplicate, skipped plan entry or invalid observation inventory rejects whole result', async () => {
  const mutations = [
    data => { [data.summary.observations[0], data.summary.observations[1]] = [data.summary.observations[1], data.summary.observations[0]]; },
    data => { data.summary.observations[1] = { ...data.summary.observations[0] }; },
    data => { data.summary.observations = data.summary.observations.slice(1); data.summary.calls = 5; },
    data => { data.summary.observations[3].local_symbol = '2330'; },
    data => { data.summary.observations[0].local_symbol = 'PRIVATE_SYMBOL'; },
    data => { data.summary.observations[0].endpoint = 'PRIVATE_ENDPOINT'; },
    data => { data.summary.observations.push({ ...data.summary.observations[0] }); },
    data => { data.summary.observations.pop(); },
    data => { data.summary.observations = {}; },
    data => { delete data.summary.observations; },
    data => { delete data.summary.observations[0].shape; },
    data => { delete data.summary.observations[0].accepted_bytes; },
    data => { data.summary.row_count = 383; },
    data => { data.summary.quarter_count = 383; },
    data => { data.summary.observed_responses = 5; },
  ];
  for (const mutate of mutations) {
    const h = harness(), data = fixture(); mutate(data); h.click(); await h.resolve(data);
    assert.match(h.text, new RegExp(UNCERTAIN));
    assert.doesNotMatch(h.text, /PRIVATE|資料列總數|2330|6488|各項檢查結果/); assert.equal(h.snapshot, undefined); h.unmount();
  }
});

test('SYNTHETIC per-item count bounds apply even when aggregate totals are within allowed bounds', async () => {
  for (const field of ['row_count', 'quarter_count']) {
    for (const value of [-1, 65, 1.5, NaN, Infinity, '1', null, undefined]) {
      const observations = fixture().summary.observations;
      for (const row of observations) { row.row_count = 1; row.quarter_count = 1; }
      observations[0][field] = value;
      const data = withObservations(observations);
      // Keep the aggregate itself valid for nonnumeric input as well; malformed
      // per-item values may not be hidden by otherwise valid totals.
      if (!Number.isFinite(data.summary.row_count)) data.summary.row_count = 6;
      if (!Number.isFinite(data.summary.quarter_count)) data.summary.quarter_count = 6;
      const h = harness(); h.click(); await h.resolve(data);
      assert.match(h.text, new RegExp(UNCERTAIN), `${field}:${String(value)}`);
      assert.equal(h.snapshot, undefined); assert.doesNotMatch(h.text, /各項檢查結果/); h.unmount();
    }
  }
  for (const value of [0, 64]) {
    const observations = fixture().summary.observations;
    for (const row of observations) { row.row_count = value; row.quarter_count = value; }
    const h = harness(); h.click(); await h.resolve(withObservations(observations));
    assert.match(h.text, /限定診斷已完成/); assert.equal(nodes(h.render(), 'li').length, 6); h.unmount();
  }
});

test('SYNTHETIC item HTTP/status/shape/byte allowlists reject unknowns and accept exact documented boundaries', async () => {
  for (const [field, values] of [
    ['http_status', [99, 600, -1, 1.5, '200', undefined, NaN, Infinity]],
    ['status', ['PRIVATE_STATUS', 'constructor', '__proto__', null, undefined, 'BLOCKED_INPUT']],
    ['shape', ['PRIVATE_SHAPE', 'constructor', '__proto__', false, undefined]],
    ['accepted_bytes', [-1, 65537, 1.5, '64', null, undefined, NaN, Infinity]],
  ]) {
    for (const value of values) {
      const h = harness(), data = fixture(); data.summary.observations[0][field] = value;
      h.click(); await h.resolve(data); assert.match(h.text, new RegExp(UNCERTAIN), `${field}:${String(value)}`);
      assert.doesNotMatch(h.text, /PRIVATE|各項檢查結果|資料列總數/); h.unmount();
    }
  }
  for (const http of [100, 599, null]) {
    const item = fixture().summary.observations[0]; item.http_status = http;
    const h = harness(); h.click(); await h.resolve(withObservations([item]));
    assert.equal(nodes(h.render(), 'li').length, 1); h.unmount();
  }
  for (const status of ['BATCH_DEADLINE', 'CLOCK_INVALID', 'CALL_TIMEOUT', 'AMBIGUOUS_RESPONSE', 'HTTP_STOP',
    'BODY_LIMIT', 'ROW_LIMIT', 'NETWORK_OR_AMBIGUOUS', 'OBSERVED_ONLY']) {
    const item = fixture().summary.observations[0]; item.status = status;
    const h = harness(); h.click(); await h.resolve(withObservations([item], status));
    assert.equal(nodes(h.render(), 'li').length, 1); assert(!h.text.includes(status)); h.unmount();
  }
  for (const shape of ['SEARCH_ROWS', 'EMPTY', 'QUARTERLY_ESTIMATE_ROWS', 'AMBIGUOUS', 'ROW_LIMIT', null]) {
    const item = fixture().summary.observations[0]; item.shape = shape;
    const h = harness(); h.click(); await h.resolve(withObservations([item]));
    assert.equal(nodes(h.render(), 'li').length, 1); if (shape) assert(!h.text.includes(shape)); h.unmount();
  }
});

test('SYNTHETIC snapshot copies only fixed identity/classification/count fields, not backend metadata or input references', async () => {
  const data = fixture(), h = harness(); h.click(); await h.resolve(data);
  assert.deepEqual(Object.keys(h.snapshot).sort(), ['calls', 'label', 'observations', 'observed', 'quarters', 'rows']);
  for (let index = 0; index < 6; index++) {
    const item = h.snapshot.observations[index];
    assert.deepEqual(Object.keys(item).sort(), ['endpoint', 'http', 'quarters', 'rows', 'shape', 'status', 'symbol']);
    assert.equal(item.symbol, PLAN[index][0]); assert.equal(item.endpoint, PLAN[index][1]);
    assert.notEqual(item, data.summary.observations[index]);
    assert(!Object.hasOwn(item, 'accepted_bytes')); assert(!Object.hasOwn(item, 'raw'));
  }
  Object.assign(data.summary.observations[0], { local_symbol: 'PRIVATE_SYMBOL', endpoint: 'PRIVATE_ENDPOINT',
    status: 'PRIVATE_STATUS', shape: 'PRIVATE_SHAPE', http_status: 999, row_count: 999, raw: 'PRIVATE_RAW' });
  data.summary.observations.length = 0;
  assert.equal(nodes(h.render(), 'li').length, 6); assert.match(h.text, /股票搜尋/);
  assert.doesNotMatch(h.text, /PRIVATE|999|65536|accepted_bytes|local_symbol|SEARCH_ROWS|QUARTERLY_ESTIMATE_ROWS/);
  h.unmount();
});
