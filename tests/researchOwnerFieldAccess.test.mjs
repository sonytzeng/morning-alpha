// SYNTHETIC Auth/DB ports, actual Reader entrypoint + unchanged local dependencies.
// No Production/GoTrue/RLS/Gateway E2E claim; all network is denied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { canReadResearchOwnerFields, withoutResearchOwnerReceipt, RESEARCH_OWNER_FIELD_DEADLINE_MS } from '../supabase/functions/_shared/research-owner-field-access.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const URL_BASE = 'https://synthetic-reader.invalid';
const TOKEN = 'synthetic-request-jwt-not-a-credential';
const UID = 'synthetic-server-resolved-user';
const ANON = 'synthetic-anon-not-a-credential';
const SERVICE = 'synthetic-service-not-a-credential';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setImmediate(r));

function authFactory(options = {}) {
  const trace = [];
  const createClient = (url, key, config) => {
    trace.push(['client', url, key, config]);
    return {
      auth: { getUser: async token => {
        trace.push(['getUser', token]);
        if (options.authThrows) throw Error('SYNTHETIC_PRIVATE_AUTH_ERROR');
        return options.authResult ? await options.authResult : { data: { user: { id: options.authId ?? UID } }, error: options.authError ?? null };
      } },
      rpc: name => {
        trace.push(['rpc', name]);
        if (options.rpcThrows) throw Error('SYNTHETIC_PRIVATE_RPC_ERROR');
        return { abortSignal: signal => {
          trace.push(['rpcSignal', signal]);
          return options.rpcResult ?? Promise.resolve({ data: Object.hasOwn(options, 'owner') ? options.owner : true, error: options.rpcError ?? null });
        } };
      },
    };
  };
  return { createClient, trace };
}

function accessOptions(factory, overrides = {}) {
  return { request: new Request(URL_BASE, { headers: { Authorization: 'Bearer ' + TOKEN } }),
    tier: 'admin', userId: UID, supabaseUrl: URL_BASE, anonKey: ANON, createClient: factory.createClient, ...overrides };
}

function sourceReport(stringAi = false) {
  const ai = { generated_at: '2026-10-16T00:00:00Z', data_quality: 'insufficient',
    legacy_diagnostic: { keep: 'old-private-diagnostic' },
    recommendation_stock_evidence: { contract: 'RECOMMENDATION_STOCK_EVIDENCE_V1',
      captures: [], legacy_receipt: { keep: 1 }, foundation_candidate: { private_marker: 'SYNTHETIC_NEW_PRIVATE_RECEIPT' } } };
  return { id: 'synthetic-report', report_date: '2026-10-16', summary: 'unchanged report',
    unrelated_diagnostic: { keep: true }, ai_strategy_json: stringAi ? JSON.stringify(ai) : ai };
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function actualReader(options = {}) {
  const report = freeze(sourceReport(options.stringAi));
  const owner = authFactory(options);
  const trace = [], diagnostics = [], cache = new Map();
  const service = {
    auth: { getUser: async token => { trace.push(['resolverAuth', token]); return { data: { user: { id: UID } }, error: null }; } },
    rpc: async name => {
      trace.push(['serviceRpc', name]);
      assert.equal(name, 'ensure_member_entitlement_v1', 'Owner predicate must never use service-role');
      return { data: { state: 'paid_active', tier: 'member', access_ends_at: '2099-01-01T00:00:00Z', owner: true }, error: null };
    },
    from: table => {
      let single = false;
      const data = table === 'reports' ? [report] : table === 'profiles'
        ? [{ role: options.role ?? 'admin', subscription_status: 'active' }] : [];
      const query = new Proxy({}, { get(_target, method) {
        if (method === 'then') return (yes, no) => Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(yes, no);
        return (...args) => { trace.push(['query', table, method, ...args]); if (method === 'maybeSingle' || method === 'single') single = true; return query; };
      } });
      return query;
    },
  };
  let handler;
  const globals = { Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal,
    performance, Date, setTimeout, clearTimeout, crypto: webcrypto,
    fetch: () => { throw Error('NETWORK_FORBIDDEN'); },
    console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(name => [name, (...args) => diagnostics.push([name, ...args])])),
    Deno: { env: { get: name => ({ SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      ...(options.missingAnon ? {} : { SUPABASE_ANON_KEY: ANON }) })[name] }, serve: fn => { handler = fn; } },
  };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    if (path.endsWith('.json')) { module.exports = { default: JSON.parse(readFileSync(path, 'utf8')) }; return module.exports; }
    const source = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    });
    assert.equal((source.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, path);
    const require = name => {
      if (name.startsWith('.')) return load(resolve(dirname(path), name));
      assert.equal(name, 'https://esm.sh/@supabase/supabase-js@2.115.0', 'Fixed SDK import only');
      return { createClient: (url, key, config) => {
        if (key === SERVICE) { trace.push(['serviceClient']); return service; }
        assert.equal(key, ANON); return owner.createClient(url, key, config);
      } };
    };
    vm.runInNewContext(source.outputText, { ...globals, module, exports: module.exports, require }, { filename: path });
    return module.exports;
  }
  load(resolve(root, 'supabase/functions/get-report-payload/index.ts'));
  return { report, trace, ownerTrace: owner.trace, diagnostics,
    async call(body = {}) {
      const response = await handler(new Request(URL_BASE + '/functions/v1/get-report-payload?tier=admin', {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ report_date: report.report_date, tier: 'admin', owner: true, ...body }),
      }));
      return { status: response.status, body: await response.json() };
    } };
}

test('SYNTHETIC helper: admin + matching Auth identity + literal predicate true; same JWT and anon client only', async () => {
  const f = authFactory(); assert.equal(await canReadResearchOwnerFields(accessOptions(f)), true);
  assert.deepEqual(f.trace.map(x => x[0]), ['client', 'getUser', 'rpc', 'rpcSignal']);
  assert.equal(f.trace[0][2], ANON); assert.equal(f.trace[1][1], TOKEN);
  assert.equal(f.trace[0][3].global.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(f.trace[0][3].auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  assert.equal(f.trace[2][1], 'is_research_owner_v1');
  assert.equal(RESEARCH_OWNER_FIELD_DEADLINE_MS, 2000);
});

for (const [label, overrides] of [
  ['free', { tier: 'free' }], ['member', { tier: 'member' }], ['vip', { tier: 'vip' }],
  ['no resolver identity', { userId: null }], ['no URL', { supabaseUrl: '' }], ['no anon config', { anonKey: '' }],
  ['no JWT', { request: new Request(URL_BASE) }],
]) test(`SYNTHETIC helper denies ${label} without Auth/RPC`, async () => {
  const f = authFactory(); assert.equal(await canReadResearchOwnerFields(accessOptions(f, overrides)), false); assert.deepEqual(f.trace, []);
});

for (const [label, options] of [
  ['identity mismatch', { authId: 'another-user' }], ['Auth error', { authError: { message: 'PRIVATE' } }],
  ['missing Auth user', { authResult: Promise.resolve({ data: { user: null }, error: null }) }], ['Auth throw', { authThrows: true }],
]) test(`SYNTHETIC helper ${label} cannot start Owner RPC`, async () => {
  const f = authFactory(options); assert.equal(await canReadResearchOwnerFields(accessOptions(f)), false);
  assert.equal(f.trace.filter(x => x[0] === 'rpc').length, 0);
});

for (const value of [false, null, undefined, 'true', 1, {}, [true], { owner: true }]) test(`SYNTHETIC helper rejects predicate ${JSON.stringify(value)}`, async () => {
  const f = authFactory({ owner: value }); assert.equal(await canReadResearchOwnerFields(accessOptions(f)), false);
  assert.equal(f.trace.filter(x => x[0] === 'rpc').length, 1);
});

for (const options of [{ rpcError: { message: 'PRIVATE' } }, { rpcThrows: true }]) test('SYNTHETIC helper RPC failures deny without retry', async () => {
  const f = authFactory(options); assert.equal(await canReadResearchOwnerFields(accessOptions(f)), false);
  assert.equal(f.trace.filter(x => x[0] === 'rpc').length, 1);
});

for (const stringAi of [false, true]) test(`receipt projection is copy-on-write; stringAi=${stringAi}`, () => {
  const report = freeze(sourceReport(stringAi)), before = JSON.stringify(report), projected = withoutResearchOwnerReceipt(report);
  const ai = stringAi ? JSON.parse(projected.ai_strategy_json) : projected.ai_strategy_json;
  assert.equal(JSON.stringify(report), before); assert.notEqual(projected, report);
  assert.equal(typeof projected.ai_strategy_json, stringAi ? 'string' : 'object');
  const expected = sourceReport(); delete expected.ai_strategy_json.recommendation_stock_evidence.foundation_candidate;
  assert.deepEqual({ ...projected, ai_strategy_json: ai }, expected);
  assert.equal(projected.unrelated_diagnostic, report.unrelated_diagnostic);
  if (!stringAi) {
    assert.notEqual(ai, report.ai_strategy_json); assert.notEqual(ai.recommendation_stock_evidence, report.ai_strategy_json.recommendation_stock_evidence);
    assert.equal(ai.legacy_diagnostic, report.ai_strategy_json.legacy_diagnostic);
    assert.equal(ai.recommendation_stock_evidence.legacy_receipt, report.ai_strategy_json.recommendation_stock_evidence.legacy_receipt);
  }
  assert.equal(withoutResearchOwnerReceipt(projected), projected);
});

for (const ai of [undefined, null, [], '{bad', '[]', { recommendation_stock_evidence: null }, { keep: 1 }]) test('legacy/malformed report without receipt is unchanged', () => {
  const report = freeze({ ai_strategy_json: ai }); assert.equal(withoutResearchOwnerReceipt(report), report);
});

test('actual Reader denies nonOwner admin only new field/raw receipt, preserves report/diagnostics/formal projection', async () => {
  const f = actualReader({ owner: false }), before = JSON.stringify(f.report), result = await f.call();
  assert.equal(result.status, 200); assert.equal(result.body.tier, 'admin');
  assert.equal(result.body.payload.owner_market_foundation_candidate, undefined);
  assert.equal(JSON.stringify(f.report), before);
  const raw = result.body.payload.admin_source_report;
  assert.deepEqual(raw, withoutResearchOwnerReceipt(f.report));
  assert.doesNotMatch(JSON.stringify(result.body), /SYNTHETIC_NEW_PRIVATE_RECEIPT/);
  assert.equal(result.body.payload.decision_engine_v1.schema_version, 'decision-evidence-v1');
  assert.equal(f.ownerTrace.filter(x => x[0] === 'getUser').length, 1);
  assert.equal(f.ownerTrace.filter(x => x[0] === 'rpc').length, 1);
  assert.deepEqual(f.diagnostics, []);
});

test('actual Reader genuine ResearchOwner admin retains new field/raw receipt without changing formal/member decision', async () => {
  const allowed = actualReader(), denied = actualReader({ owner: false });
  const a = await allowed.call(), b = await denied.call();
  assert.equal(a.status, 200); assert.equal(a.body.payload.owner_market_foundation_candidate.candidate_only, true);
  assert.equal(a.body.payload.owner_market_foundation_candidate.member_publication_approved, false);
  assert.deepEqual(a.body.payload.admin_source_report, allowed.report);
  assert.deepEqual(a.body.payload.decision_engine_v1, b.body.payload.decision_engine_v1);
  assert.deepEqual(a.body.subscriber_projection, b.body.subscriber_projection);
});

for (const [label, options] of [
  ['missing anon config', { missingAnon: true }], ['different Auth identity', { authId: 'foreign-user' }],
  ['Auth exception', { authThrows: true }], ['RPC exception', { rpcThrows: true }],
  ['nonboolean true', { owner: 'true' }], ['object owner', { owner: { owner: true } }],
  ['legacy string AI', { owner: false, stringAi: true }],
]) test(`actual Reader ${label} fails closed only on additive research fields`, async () => {
  const f = actualReader(options), result = await f.call();
  assert.equal(result.status, 200); assert.equal(result.body.tier, 'admin');
  assert.equal(result.body.payload.owner_market_foundation_candidate, undefined);
  assert.deepEqual(result.body.payload.admin_source_report, withoutResearchOwnerReceipt(f.report));
  assert.deepEqual(f.diagnostics, []); assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_AUTH_ERROR|PRIVATE_RPC_ERROR/);
  if (options.authId || options.authThrows || options.missingAnon) assert.equal(f.ownerTrace.filter(x => x[0] === 'rpc').length, 0);
});

test('actual Reader non-admin cannot grant new fields with request or entitlement owner flags', async () => {
  const f = actualReader({ role: 'user' }), result = await f.call();
  assert.equal(result.status, 200); assert.notEqual(result.body.tier, 'admin');
  assert.equal(result.body.payload.owner_market_foundation_candidate, undefined); assert.deepEqual(f.ownerTrace, []);
});

for (const stringAi of [false, true]) test(`actual history projection never includes receipt even for admin Owner; stringAi=${stringAi}`, async () => {
  const f = actualReader({ stringAi }), before = JSON.stringify(f.report), result = await f.call({ history_limit: 1 });
  assert.equal(result.status, 200); assert.equal(result.body.tier, 'admin'); assert.equal(result.body.payload, null);
  assert.equal(result.body.reports.length, 1); assert.equal(result.body.reports[0].report_id, f.report.id);
  assert.doesNotMatch(JSON.stringify(result.body), /foundation_candidate|SYNTHETIC_NEW_PRIVATE_RECEIPT|legacy_diagnostic|old-private-diagnostic/);
  assert.equal(JSON.stringify(f.report), before); assert.deepEqual(f.ownerTrace, []);
});

test('actual Reader total 2s deadline returns base report; late Auth cannot launch RPC', async () => {
  const late = deferred(), f = actualReader({ authResult: late.promise });
  const started = performance.now(), result = await f.call();
  assert.equal(result.status, 200); assert.equal(result.body.payload.owner_market_foundation_candidate, undefined);
  assert.ok(performance.now() - started < 3000);
  late.resolve({ data: { user: { id: UID } }, error: null }); await tick(); await tick();
  assert.equal(f.ownerTrace.filter(x => x[0] === 'rpc').length, 0);
  assert.deepEqual(f.diagnostics, []);
});

test('SYNTHETIC total deadline is shared by Auth and RPC, not reset per step; ignores late true', async () => {
  const late = deferred(), f = authFactory({ authResult: new Promise(r => setTimeout(() => r({ data: { user: { id: UID } }, error: null }), 1200)), rpcResult: late.promise });
  const started = performance.now(); assert.equal(await canReadResearchOwnerFields(accessOptions(f)), false);
  assert.ok(performance.now() - started < 2600);
  assert.equal(f.trace.filter(x => x[0] === 'rpc').length, 1);
  assert.equal(f.trace.find(x => x[0] === 'rpcSignal')[1].aborted, true);
  late.resolve({ data: true, error: null }); await tick();
});

test('request cancellation denies immediately; late getUser never starts RPC', async () => {
  const late = deferred(), f = authFactory({ authResult: late.promise }), abort = new AbortController();
  const pending = canReadResearchOwnerFields(accessOptions(f, { request: new Request(URL_BASE, { headers: { Authorization: 'Bearer ' + TOKEN }, signal: abort.signal }) }));
  abort.abort(); assert.equal(await pending, false);
  late.resolve({ data: { user: { id: UID } }, error: null }); await tick();
  assert.equal(f.trace.filter(x => x[0] === 'rpc').length, 0);
});
