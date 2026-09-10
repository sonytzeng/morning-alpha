import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as settle } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual Home effect, not a separately implemented subscription.
// These are deterministic lifecycle unit tests; real Auth/RLS/WebSocket evidence
// is supplied separately by the isolated persistent Browser acceptance.
const source = readFileSync(new URL('../src/hooks/useHomeDashboard.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('useHomeDashboard.ts', source, ts.ScriptTarget.Latest, true);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effects.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(effects.length, 1, 'Test must bind the actual single Home lifecycle');
const script = ts.transpileModule(`const effect = ${effects[0].getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText + '\neffect';
const tables = ['market_data', 'reports', 'intraday_checks', 'opening_market_radar',
  'market_source_health', 'market_news', 'close_market_reviews'];

function setup() {
  let resolveAuth, rejectAuth, resolveSession, rejectSession;
  const ready = new Promise((resolve, reject) => { resolveAuth = resolve; rejectAuth = reject; });
  const sessionReady = new Promise((resolve, reject) => { resolveSession = resolve; rejectSession = reject; });
  // Prevent an old implementation which never consumes this promise from
  // creating an unrelated unhandled-rejection failure in the red test run.
  ready.catch(() => {});
  sessionReady.catch(() => {});
  const calls = { auth: [], channels: [], removed: [], refresh: 0, morning: 0, warnings: [] };
  const timers = new Set(), listeners = new Set();
  const supabase = {
    auth: { getSession: () => sessionReady },
    realtime: { setAuth: (...args) => { calls.auth.push(args); return ready; } },
    channel(topic) {
      const channel = { topic, bindings: [], subscribed: 0,
        on(event, filter, callback) { this.bindings.push({ event, filter, callback }); return this; },
        subscribe() { this.subscribed++; return this; },
      };
      calls.channels.push(channel); return channel;
    },
    removeChannel(channel) { calls.removed.push(channel); return Promise.resolve('ok'); },
  };
  const globals = {
    supabase, loadMorningState: () => { calls.morning++; }, refresh: () => { calls.refresh++; },
    getAdaptiveDashboardPollMs: () => 300000,
    document: { visibilityState: 'visible',
      addEventListener: (name, fn) => listeners.add(fn), removeEventListener: (name, fn) => listeners.delete(fn) },
    window: { addEventListener: (name, fn) => listeners.add(fn), removeEventListener: (name, fn) => listeners.delete(fn) },
    setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => calls.warnings.push(args) },
  };
  return { mount: vm.runInNewContext(script, globals), calls, timers, listeners, resolveAuth, rejectAuth,
    resolveSession: (session = { access_token: 'UNIT_SESSION_MARKER_NOT_A_JWT' }, error = null) => resolveSession({ data: { session }, error }), rejectSession };
}

test('Home waits for the SDK session callback before creating or joining any channel', async () => {
  const s = setup(); const dispose = s.mount();
  assert.equal(s.calls.channels.length, 0);
  s.resolveSession(); await settle();
  assert.equal(s.calls.auth.length, 1);
  assert.deepEqual(s.calls.auth[0], ['UNIT_SESSION_MARKER_NOT_A_JWT'], 'Only the actual SDK session is used, not a role or client override');
  assert.equal(s.calls.channels.length, 0, 'No anonymous first join while a member session is still resolving');
  s.resolveAuth(); await settle();
  assert.equal(s.calls.channels.length, 1);
  assert.equal(s.calls.channels[0].subscribed, 1); dispose();
});

test('all seven real Home table bindings and report refresh callbacks remain intact', async () => {
  const s = setup(); const dispose = s.mount(); s.resolveSession(); s.resolveAuth(); await settle();
  const channel = s.calls.channels[0]; assert.equal(channel.topic, 'morning-alpha-home-live');
  assert.deepEqual(channel.bindings.map(b => b.filter.table), tables);
  for (const binding of channel.bindings) {
    assert.equal(binding.event, 'postgres_changes'); assert.equal(binding.filter.event, '*');
    assert.equal(binding.filter.schema, 'public'); assert.equal(binding.filter.filter, undefined);
    const before = { refresh: s.calls.refresh, morning: s.calls.morning }; binding.callback();
    assert.equal(s.calls.refresh, before.refresh + 1);
    assert.equal(s.calls.morning, before.morning + (binding.filter.table === 'reports' ? 1 : 0));
  }
  dispose(); assert.equal(s.calls.removed.length, 1); assert.equal(s.calls.removed[0], channel);
  assert.equal(s.timers.size, 0); assert.equal(s.listeners.size, 0);
});

test('unmount while session resolves never creates a late orphan subscription', async () => {
  const s = setup(); const dispose = s.mount(); dispose(); s.resolveSession(); s.resolveAuth(); await settle();
  assert.equal(s.calls.channels.length, 0); assert.equal(s.calls.removed.length, 0);
  assert.equal(s.timers.size, 0); assert.equal(s.listeners.size, 0);
});

test('StrictMode setup-cleanup-setup creates only the current live subscription', async () => {
  const s = setup(); s.mount()(); const dispose = s.mount(); s.resolveSession(); s.resolveAuth(); await settle();
  assert.equal(s.calls.auth.length, 1); assert.equal(s.calls.channels.length, 1);
  assert.equal(s.calls.channels[0].subscribed, 1); dispose(); assert.equal(s.calls.removed.length, 1);
});

test('SDK auth failure never falls back to an unauthenticated subscription', async () => {
  const s = setup(); const dispose = s.mount(); s.resolveSession(); s.rejectAuth(new Error('unit-only auth failure')); await settle();
  assert.equal(s.calls.channels.length, 0); assert.equal(s.calls.removed.length, 0);
  assert.equal(s.timers.size, 1, 'Existing bounded reconciliation poll remains available');
  assert.equal(s.calls.warnings.length, 1); assert.equal(s.calls.warnings[0].length, 1);
  assert.equal(typeof s.calls.warnings[0][0], 'string');
  assert.ok(!s.calls.warnings[0][0].includes('unit-only'), 'Do not print raw Auth errors or credentials'); dispose();
});

test('late SDK auth rejection after unmount is handled without a log or subscription', async () => {
  const s = setup(); const dispose = s.mount(); s.resolveSession(); await settle(); dispose(); s.rejectAuth(new Error('unit-only late failure')); await settle();
  assert.equal(s.calls.channels.length, 0); assert.equal(s.calls.warnings.length, 0);
});

test('anonymous subscriptions do not pass the opaque publishable API key as a session JWT', async () => {
  const s = setup(); const dispose = s.mount(); s.resolveSession(null); await settle();
  assert.equal(s.calls.auth.length, 0); assert.equal(s.calls.channels.length, 1);
  assert.equal(s.calls.channels[0].bindings.length, 7); dispose();
});

test('session lookup errors fail closed instead of treating the user as anonymous', async () => {
  const s = setup(); const dispose = s.mount(); s.resolveSession(null, new Error('unit-only lookup failure')); await settle();
  assert.equal(s.calls.auth.length, 0); assert.equal(s.calls.channels.length, 0);
  assert.equal(s.calls.warnings.length, 1); dispose();
});

test('unmount while Realtime authorization resolves never subscribes', async () => {
  const s = setup(); const dispose = s.mount(); s.resolveSession(); await settle(); dispose(); s.resolveAuth(); await settle();
  assert.equal(s.calls.auth.length, 1); assert.equal(s.calls.channels.length, 0);
});
