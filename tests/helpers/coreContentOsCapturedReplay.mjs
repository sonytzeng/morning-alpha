// Actual handler + actual installed SDK. The supplied DB transport is a test
// double (or an explicitly labelled SQL bridge), never a Supabase gateway.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { createServer } from 'node:http';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('../../', import.meta.url));
export const CAPTURE_PATH = 'tests/fixtures/consolidation-v1/content-os/persisted-market-only-20260921.json';
export const CAPTURE_SHA256 = '066d585138d882774cf6a14ef68c19fa11d5424c1ac24a5887dacef94f01adf2';
export const captureHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const capturedOutput = () => {
  const bytes = readFileSync(resolve(repo, CAPTURE_PATH));
  assert.equal(captureHash(bytes), CAPTURE_SHA256, 'Original captured output must not be rewritten into a positive fixture');
  const capture = JSON.parse(bytes);
  assert.equal(capture.scope, 'ma-consolidation-v1-20260909170000');
  assert.equal(capture.report_date, '2026-09-21');
  assert.equal(capture.provenance.output_fixture_only, true);
  assert.equal(capture.provenance.historical_capture, false);
  assert.equal(capture.preservation.public_before_sha256, capture.preservation.public_after_sha256);
  return capture;
};

export const FIXTURE_SERVICE_KEY = 'LOCAL_CONTENT_OS_SDK_FIXTURE_NOT_A_REAL_KEY';
export const FIXTURE_INTERNAL_TOKEN = 'LOCAL_CONTENT_OS_INTERNAL_FIXTURE_NOT_A_SECRET';
export const FIXTURE_SOURCE_TOKEN = 'LOCAL_CONTENT_OS_SOURCE_FIXTURE_NOT_A_SECRET';

/** This VM captures Deno.serve, retaining every actual handler/Auth/validator
 * declaration. Only the exact SDK import and process-local test Date are bound. */
export function capturedContentOsHandler(endpoint, { now = '2026-09-21T15:35:30+08:00', env = {} } = {}) {
  assert.equal(new URL(endpoint).hostname, '127.0.0.1');
  assert.equal(require('@supabase/supabase-js/package.json').version, '2.57.4');
  const modules = new Map(), diagnostics = [], loadedSources = [];
  let handler;
  const environment = { SUPABASE_URL: endpoint, SUPABASE_SERVICE_ROLE_KEY: FIXTURE_SERVICE_KEY,
    CRON_SECRET: FIXTURE_INTERNAL_TOKEN, SONY_CONTENT_OS_SOURCE_TOKEN: FIXTURE_SOURCE_TOKEN, ...env };
  const fixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  };
  const scopedFetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(url.origin, endpoint, 'No external/provider/Production request is allowed');
    return fetch(input, { ...init, redirect: 'error' });
  };
  const globals = { Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, AbortSignal, setTimeout, clearTimeout, Date: fixedDate, crypto: webcrypto,
    fetch: scopedFetch,
    console: { log() {}, info() {}, warn: (...args) => diagnostics.push(['warn', ...args]), error: (...args) => diagnostics.push(['error', ...args]) },
    Deno: { env: { get: key => environment[key] }, serve: fn => { assert.equal(handler, undefined); handler = fn; } } };
  function load(path) {
    assert.ok(path.startsWith(repo), 'Business dependency must stay in this repository');
    if (modules.has(path)) return modules.get(path).exports;
    const source = readFileSync(path, 'utf8');
    loadedSources.push({ path: path.slice(repo.length), sha256: captureHash(source) });
    const module = { exports: {} }; modules.set(path, module);
    const localRequire = specifier => {
      if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier));
      assert.equal(specifier, 'npm:@supabase/supabase-js@2.57.4', 'Only the actual pinned SDK import may be mapped');
      const sdk = require('@supabase/supabase-js');
      return { ...sdk, createClient: (url, key, options = {}) => {
        assert.equal(url, endpoint); assert.equal(key, FIXTURE_SERVICE_KEY);
        return sdk.createClient(url, key, { ...options, global: { ...options.global, fetch: scopedFetch } });
      } };
    };
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(js, { ...globals, module, exports: module.exports, require: localRequire }, { filename: path });
    return module.exports;
  }
  load(resolve(repo, 'supabase/functions/content-os-morning-alpha-source/index.ts'));
  assert.equal(typeof handler, 'function');
  return { handler, diagnostics, loadedSources, clock_kind: 'EXPLICIT_PROCESS_LOCAL_CAPTURE_REPLAY', sdk_version: '2.57.4' };
}

const field = (row, path) => path.split(/->>?/).reduce((value, key) => value?.[key], row);
const unquote = value => value.replace(/^"|"$/g, '');
export function selectCapturedRows(tables, table, query) {
  assert.ok(Object.hasOwn(tables, table), 'Unexpected fixture table: ' + table);
  let rows = structuredClone(tables[table]);
  for (const [key, raw] of query) {
    if (['select', 'order', 'limit', 'offset'].includes(key) || key.startsWith('semantic_coherence_reviews.')) continue;
    rows = rows.filter(row => {
      const value = field(row, key);
      if (raw.startsWith('eq.')) return String(value) === raw.slice(3);
      if (raw.startsWith('neq.')) return String(value) !== raw.slice(4);
      if (raw === 'is.null') return value == null;
      if (raw === 'not.is.null') return value != null;
      if (raw.startsWith('in.(') && raw.endsWith(')')) return raw.slice(4, -1).split(',').map(unquote).includes(String(value));
      if (raw.startsWith('like.')) {
        const pattern = raw.slice(5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('%', '.*');
        return new RegExp('^' + pattern + '$').test(String(value));
      }
      for (const operator of ['gte', 'lte', 'gt', 'lt']) if (raw.startsWith(operator + '.')) {
        const wanted = raw.slice(operator.length + 1);
        return operator === 'gte' ? value >= wanted : operator === 'lte' ? value <= wanted : operator === 'gt' ? value > wanted : value < wanted;
      }
      throw new Error('Unimplemented fixture filter must fail closed: ' + key + '=' + raw);
    });
  }
  const order = query.get('order');
  if (order) rows.sort((a, b) => {
    for (const term of order.split(',')) {
      const [key, direction] = term.split('.'), left = field(a, key), right = field(b, key);
      if (left === right) continue;
      return (left < right ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    }
    return 0;
  });
  const offset = Number(query.get('offset') || 0), limit = query.has('limit') ? Number(query.get('limit')) : rows.length;
  assert.ok(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 0);
  rows = rows.slice(offset, offset + limit);
  if (table === 'member_content_revisions' && query.get('select')?.includes('semantic_coherence_reviews(')) {
    for (const row of rows) row.semantic_coherence_reviews = tables.semantic_coherence_reviews
      .filter(review => review.member_content_revision_id === row.id).sort((a, b) => b.checked_at.localeCompare(a.checked_at))
      .slice(0, Number(query.get('semantic_coherence_reviews.limit') || tables.semantic_coherence_reviews.length));
  }
  return rows;
}

/** RPC responses in this default lane are explicitly simulated incident state.
 * No terminal/Acceptance success is ever manufactured by the HTTP double. */
export function incidentTransport(tables, trace, now = '2026-09-21T15:35:30+08:00') {
  return async (name, body) => {
    assert.ok(['record_content_os_incident_v1', 'resolve_content_os_incident_v1'].includes(name));
    const incidents = tables.content_os_sync_incidents;
    trace.push({ kind: 'SIMULATED_INCIDENT_RPC', name, body: structuredClone(body) });
    if (name === 'record_content_os_incident_v1') {
      let row = incidents.find(item => item.incident_key === body.p_incident_key);
      if (!row) { row = { id: webcrypto.randomUUID(), incident_key: body.p_incident_key, attempt_count: 0, first_seen_at: now }; incidents.push(row); }
      Object.assign(row, { business_date: body.p_business_date, snapshot_id: body.p_snapshot_id,
        snapshot_version: body.p_snapshot_version, status: 'OPEN', reason_codes: body.p_reason_codes,
        attempt_count: row.attempt_count + 1, last_seen_at: now, resolved_at: null,
        last_http_status: body.p_http_status, metadata: body.p_metadata });
      return row.id;
    }
    const matches = incidents.filter(row => row.incident_key === body.p_incident_key && row.status === 'OPEN');
    for (const row of matches) Object.assign(row, { status: 'RESOLVED', resolved_at: now, last_seen_at: now,
      snapshot_version: body.p_snapshot_version ?? row.snapshot_version,
      metadata: { ...row.metadata, ...body.p_metadata }, last_http_status: 200 });
    return matches.length;
  };
}

export async function runCapturedContentOs(tables, options = {}) {
  const trace = [], incidentTrace = []; let transportError;
  const rpc = options.rpc ?? incidentTransport(tables, incidentTrace, options.now);
  const queryRows = options.queryRows ?? ((table, query) => selectCapturedRows(tables, table, query));
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1');
      assert.equal(request.headers.apikey, FIXTURE_SERVICE_KEY);
      const url = new URL(request.url, 'http://127.0.0.1');
      assert.ok(url.pathname.startsWith('/rest/v1/'));
      const name = url.pathname.split('/').at(-1), isRpc = url.pathname.startsWith('/rest/v1/rpc/');
      trace.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
      if (options.failTable === name || options.failRpc === name) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'EXPLICIT_LOCAL_TRANSPORT_FAILURE', code: 'XX000' })); return;
      }
      let value;
      if (isRpc) {
        assert.equal(request.method, 'POST'); let text = '';
        for await (const chunk of request) { text += chunk; assert.ok(text.length < 100000); }
        value = await rpc(name, JSON.parse(text));
      } else { assert.equal(request.method, 'GET', 'Evidence tables must never be written'); value = await queryRows(name, url.searchParams); }
      response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value));
    } catch (error) { transportError = error; response.writeHead(500, { 'content-type': 'application/json' }); response.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  const loaded = capturedContentOsHandler(endpoint, options);
  const headers = options.headers ?? { 'x-cron-secret': FIXTURE_INTERNAL_TOKEN };
  try {
    const response = await loaded.handler(new Request(endpoint + '/functions/v1/content-os-morning-alpha-source', {
      method: options.method ?? 'GET', headers,
    }));
    const body = await response.json(); if (transportError) throw transportError;
    return { status: response.status, body, trace, incidentTrace, diagnostics: loaded.diagnostics,
      loadedSources: loaded.loadedSources, sdk_version: loaded.sdk_version,
      method: 'ACTUAL_HANDLER_SDK_WITH_EXPLICIT_DB_TRANSPORT_DOUBLE', full_supabase_claim: false,
      real_auth_gateway_executed: false, process_local_clock: true };
  } finally { await new Promise(done => server.close(done)); }
}
