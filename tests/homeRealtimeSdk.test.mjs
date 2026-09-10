import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate as settle } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { RealtimeClient } = require('@supabase/realtime-js');
const { SupabaseClient } = require('@supabase/supabase-js');

// Actual Home effect + installed Realtime/Supabase methods, with an entirely
// in-memory transport and synthetic non-JWT markers. This is not Auth/RLS,
// server event-delivery or persistent Browser acceptance evidence.
const source = readFileSync(new URL('../src/hooks/useHomeDashboard.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('useHomeDashboard.ts', source, ts.ScriptTarget.Latest, true);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effects.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(effects.length, 1, 'Bind the actual single Home lifecycle');
const effectScript = ts.transpileModule(`const effect = ${effects[0].getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText + '\neffect';
const tables = ['market_data', 'reports', 'intraday_checks', 'opening_market_radar',
  'market_source_health', 'market_news', 'close_market_reviews'];
const sessionMarker = 'UNIT_SESSION_MARKER_NOT_A_JWT';
const publicMarker = 'sb_publishable_UNIT_OPAQUE_NOT_A_JWT';

function setup(t) {
  let resolveSession;
  const sessionReady = new Promise(resolve => { resolveSession = resolve; });
  const calls = { session: 0, explicitAuth: [], network: 0, refresh: 0, morning: 0, warnings: [] };
  const transports = [], allChannels = [], timers = new Set(), listeners = new Set();
  class MemoryTransport {
    readyState = 0;
    frames = [];
    constructor() { transports.push(this); }
    send(raw) { this.frames.push(JSON.parse(raw)); }
    open() { this.readyState = 1; this.onopen?.({}); }
    receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const supabase = {
    supabaseKey: publicMarker,
    auth: { getSession() { calls.session++; return sessionReady; } },
  };
  const realtime = new RealtimeClient('ws://unit.invalid/realtime/v1', {
    params: { apikey: publicMarker }, transport: MemoryTransport,
    // The installed Supabase implementation supplies the same lazy callback.
    accessToken: () => SupabaseClient.prototype._getAccessToken.call(supabase),
    fetch: async () => { calls.network++; throw new Error('UNIT_NETWORK_FORBIDDEN'); },
    heartbeatIntervalMs: 600000,
  });
  supabase.realtime = realtime;
  const setAuth = realtime.setAuth.bind(realtime);
  realtime.setAuth = (...args) => {
    if (args.length && args[0] !== null && args[0] !== undefined) {
      calls.explicitAuth.push({ session_marker: args[0] === sessionMarker, opaque_public_key: args[0] === publicMarker });
    }
    return setAuth(...args);
  };
  supabase.channel = (...args) => {
    const channel = SupabaseClient.prototype.channel.apply(supabase, args);
    if (!allChannels.includes(channel)) allChannels.push(channel);
    return channel;
  };
  supabase.removeChannel = (...args) => SupabaseClient.prototype.removeChannel.apply(supabase, args);
  const globals = {
    supabase, refresh: () => { calls.refresh++; }, loadMorningState: () => { calls.morning++; },
    getAdaptiveDashboardPollMs: () => 300000,
    document: { visibilityState: 'visible', addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    window: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => calls.warnings.push(args) },
  };
  const effect = vm.runInNewContext(effectScript, globals);
  const disposers = new Set();
  t.after(async () => {
    for (const dispose of disposers) dispose();
    await settle();
    for (const channel of allChannels) channel.teardown();
    realtime.disconnect();
    assert.equal(calls.network, 0, 'No HTTP request is permitted');
    assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
  });
  return {
    realtime, supabase, calls, transports, timers, listeners,
    resolveSession(member = true) { resolveSession({ data: { session: member ? { access_token: sessionMarker } : null }, error: null }); },
    mount() {
      const cleanup = effect();
      const dispose = () => { if (disposers.delete(dispose)) cleanup(); };
      disposers.add(dispose); return dispose;
    },
    acknowledge(transport) {
      transport.open();
      const joins = transport.frames.filter(frame => frame.event === 'phx_join');
      for (const frame of joins) transport.receive({ topic: frame.topic, event: 'phx_reply', ref: frame.ref,
        payload: { status: 'ok', response: { postgres_changes: frame.payload.config.postgres_changes.map((filter, i) => ({ ...filter, id: i + 1 })) } } });
      return joins;
    },
  };
}

function assertMemberJoin(frame) {
  assert.equal(frame.event, 'phx_join');
  assert.equal(frame.topic, 'realtime:morning-alpha-home-live');
  assert.equal(frame.payload.access_token === sessionMarker, true, 'Actual serialized first join must carry the session marker');
  assert.deepEqual(frame.payload.config.postgres_changes, tables.map(table => ({ event: '*', schema: 'public', table })));
}

test('installed SDK reproduces the tokenless buffered-join race without the Home session barrier', async t => {
  const s = setup(t);
  const channel = s.supabase.channel('morning-alpha-home-live').on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => {}).subscribe();
  const queuedPayload = channel.joinPush.payload;
  s.resolveSession(); await settle();
  assert.equal(s.realtime.accessTokenValue === sessionMarker, true);
  assert.notEqual(channel.joinPush.payload, queuedPayload, 'SDK updates the join object but not the already-buffered push object');
  const [join] = s.acknowledge(s.transports[0]); await settle();
  assert.equal(Object.hasOwn(join.payload, 'access_token'), false);
  assert.equal(channel.state, 'joined'); assert.equal(s.realtime.getChannels().length, 1);
  await s.realtime.setAuth(); await settle();
  assert.equal(s.transports[0].frames.filter(frame => frame.event === 'access_token').length, 0, 'Unchanged lazy token cannot repair the old queued join');
  await s.supabase.removeChannel(channel);
});

test('actual Home effect waits for the member session and sends the first installed-SDK join with all seven bindings', async t => {
  const s = setup(t); const dispose = s.mount();
  assert.equal(s.transports.length, 0); assert.equal(s.realtime.getChannels().length, 0);
  s.resolveSession(); await settle();
  assert.deepEqual(s.calls.explicitAuth, [{ session_marker: true, opaque_public_key: false }]);
  assert.equal(s.transports.length, 1); assert.equal(s.transports[0].frames.length, 0);
  const [join] = s.acknowledge(s.transports[0]); assertMemberJoin(join); await settle();
  const [channel] = s.realtime.getChannels();
  assert.equal(channel.state, 'joined'); assert.equal(channel.bindings.postgres_changes.length, 7);
  assert.equal(s.transports[0].frames.some(frame => frame.event === 'access_token'), false, 'The initial join itself is authorized');
  dispose(); await settle(); assert.equal(s.realtime.getChannels().length, 0);
  assert.equal(s.transports[0].readyState, 3);
});

test('actual Home StrictMode setup-cleanup-setup has one authorized memory-wire join and no late orphan channel', async t => {
  const s = setup(t); s.mount()(); const dispose = s.mount();
  s.resolveSession(); await settle();
  assert.equal(s.transports.length, 1); assert.equal(s.realtime.getChannels().length, 1);
  const joins = s.acknowledge(s.transports[0]); await settle();
  assert.equal(joins.length, 1); assertMemberJoin(joins[0]);
  assert.equal(s.realtime.getChannels()[0].state, 'joined');
  dispose(); await settle(); assert.equal(s.realtime.getChannels().length, 0);
});

test('actual Home cleanup after a joined subscription permits a fresh authorized remount without clearing the replacement', async t => {
  const s = setup(t); const disposeFirst = s.mount(); s.resolveSession(); await settle();
  assertMemberJoin(s.acknowledge(s.transports[0])[0]); await settle();
  const first = s.realtime.getChannels()[0]; disposeFirst(); await settle();
  assert.equal(s.realtime.getChannels().length, 0);
  s.mount(); await settle();
  assert.equal(s.transports.length, 2);
  assertMemberJoin(s.acknowledge(s.transports[1])[0]); await settle();
  assert.equal(s.realtime.getChannels().length, 1);
  assert.notEqual(s.realtime.getChannels()[0], first);
  assert.equal(s.realtime.getChannels()[0].state, 'joined');
});

test('actual Home anonymous path never passes an opaque publishable key to explicit SDK setAuth', async t => {
  const s = setup(t); s.mount(); s.resolveSession(false); await settle();
  assert.equal(s.calls.explicitAuth.length, 0);
  assert.equal(s.transports.length, 1);
  const [join] = s.acknowledge(s.transports[0]); await settle();
  assert.equal(Object.hasOwn(join.payload, 'access_token'), false, 'Anonymous first join keeps the native public socket contract');
  assert.deepEqual(join.payload.config.postgres_changes.map(filter => filter.table), tables);
  assert.equal(s.realtime.getChannels()[0].state, 'joined');
  assert.equal(s.calls.explicitAuth.length, 0, 'SDK internal no-argument lazy calls are distinct from passing a publishable key as JWT');
});

test('actual Home unmount before deferred session resolution creates no installed-SDK transport', async t => {
  const s = setup(t); s.mount()(); s.resolveSession(); await settle();
  assert.equal(s.calls.explicitAuth.length, 0);
  assert.equal(s.transports.length, 0); assert.equal(s.realtime.getChannels().length, 0);
});
