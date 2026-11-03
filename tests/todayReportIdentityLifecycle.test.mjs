// Run the actual report lifecycle with controlled promises; no production Auth or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/pages/report/TodayReport.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('TodayReport.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TodayReportContent');
assert(component, 'bind the real report component');
const effects = component.body.statements.filter(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect');
assert.equal(effects.length, 1, 'bind the single report load lifecycle rather than a test substitute');
const script = ts.transpileModule(`const effect = ${effects[0].expression.arguments[0].getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText + '\neffect';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function resolved(marker = 'current') {
  return {
    rawRow: { id: marker, report_date: '2026-10-30', private: marker },
    active_report_date: '2026-10-30', revision_id: `revision-${marker}`,
    generated_at: '2026-10-30T00:00:00.000Z',
    isHistoricalFallback: true, fallbackReportDate: '2026-10-29',
  };
}

function runtime() {
  const state = {}, writes = [], pending = [], entitlementPending = [], microtasks = [], subscriptions = [];
  let invalidations = 0;
  const globals = {
    Promise,
    trackPageView() {}, trackEngagementEvent() {},
    PRODUCT_FEATURE_FLAGS: { beginner_report_mode: { enabled: true } },
    resolveActiveMorningAlphaReport() { const request = deferred(); pending.push(request); return request.promise; },
    getCurrentEntitlement() { const request = deferred(); entitlementPending.push(request); return request.promise; },
    invalidateReportRequestCache() { invalidations++; },
    mapRowToReport: row => row,
    normalizeRadarFromReport: row => ({ marker: row.private }),
    getMorningAlphaDisplayState: row => ({ rawRow: row }),
    queueMicrotask: callback => microtasks.push(callback),
    supabase: { auth: { onAuthStateChange(callback) {
      const subscription = { callback, active: true };
      subscriptions.push(subscription);
      return { data: { subscription: { unsubscribe() { subscription.active = false; } } } };
    } } },
  };
  for (const name of ['Report', 'Identity', 'ReportSnapshotRadar', 'Loading', 'Error',
    'IsHistoricalFallback', 'FallbackReportDate', 'Entitlement', 'DisplayState']) {
    const key = name[0].toLowerCase() + name.slice(1);
    globals[`set${name}`] = value => { state[key] = value; writes.push(key); };
  }
  const mount = vm.runInNewContext(script, globals);
  const complete = (index, marker) => {
    pending[index].resolve(resolved(marker));
    entitlementPending[index].resolve({ tier: 'member', marker });
  };
  return {
    mount, state, writes, pending, entitlementPending, subscriptions, complete,
    event(event, session = { user: { id: 'same-synthetic-member' } }) {
      for (const subscription of subscriptions) if (subscription.active) subscription.callback(event, session);
    },
    flushAuth() { while (microtasks.length) microtasks.shift()(); },
    get invalidations() { return invalidations; },
  };
}

function assertCleared(state) {
  for (const key of ['report', 'reportSnapshotRadar', 'displayState', 'entitlement', 'fallbackReportDate', 'error']) {
    assert.equal(state[key], null, `${key} is synchronously cleared`);
  }
  assert.equal(state.identity.report_date, '');
  assert.equal(state.identity.revision_id, null);
  assert.equal(state.identity.generated_at, null);
  assert.equal(state.isHistoricalFallback, false);
  assert.equal(state.loading, true);
}

test('SIGNED_OUT clears every report field and entitlement synchronously, then reads outside the Auth callback', async () => {
  const r = runtime(), dispose = r.mount();
  r.complete(0, 'previous'); await flush();
  assert.equal(r.state.report.private, 'previous');
  assert.equal(r.state.entitlement.marker, 'previous');
  assert.equal(r.state.reportSnapshotRadar.marker, 'previous');
  assert.equal(r.state.isHistoricalFallback, true);
  r.event('SIGNED_OUT', null);
  assertCleared(r.state);
  assert.equal(r.invalidations, 1);
  assert.equal(r.pending.length, 1, 'do not read the SDK while its Auth callback holds a lock');
  r.flushAuth(); assert.equal(r.pending.length, 2);
  r.complete(1, 'public-after-logout'); await flush();
  assert.equal(r.state.report.private, 'public-after-logout');
  assert.equal(r.state.loading, false);
  dispose();
});

test('a previous-identity resolve cannot repopulate any report, identity or entitlement field', async () => {
  const r = runtime(), dispose = r.mount();
  r.event('SIGNED_IN'); assertCleared(r.state); r.flushAuth();
  const before = r.writes.length;
  r.complete(0, 'late-private-previous-identity'); await flush();
  assert.equal(r.writes.length, before);
  assertCleared(r.state);
  r.complete(1, 'current-identity'); await flush();
  assert.equal(r.state.report.private, 'current-identity');
  assert.equal(r.state.identity.revision_id, 'revision-current-identity');
  assert.equal(r.state.entitlement.marker, 'current-identity');
  dispose();
});

test('a previous-identity rejection cannot set an error or finish the current loading state', async () => {
  const r = runtime(), dispose = r.mount();
  r.event('SIGNED_OUT', null); r.flushAuth();
  const before = r.writes.length;
  r.pending[0].reject(Error('SYNTHETIC_OLD_IDENTITY_ERROR'));
  r.entitlementPending[0].reject(Error('SYNTHETIC_OLD_ENTITLEMENT_ERROR'));
  await flush();
  assert.equal(r.writes.length, before);
  assertCleared(r.state);
  r.complete(1, 'current'); await flush();
  assert.equal(r.state.error, null);
  assert.equal(r.state.loading, false);
  dispose();
});

test('same-user TOKEN_REFRESHED fences older work and collapses superseded scheduled Auth reads', async () => {
  const r = runtime(), dispose = r.mount();
  r.event('SIGNED_IN'); r.flushAuth();
  assert.equal(r.pending.length, 2);
  r.event('TOKEN_REFRESHED');
  r.event('USER_UPDATED');
  assertCleared(r.state);
  r.flushAuth();
  assert.equal(r.pending.length, 3, 'only the newest queued generation starts a read');
  r.complete(1, 'same-user-old-token'); r.complete(0, 'older-session'); await flush();
  assertCleared(r.state);
  r.complete(2, 'same-user-new-token'); await flush();
  assert.equal(r.state.report.private, 'same-user-new-token');
  assert.equal(r.invalidations, 3);
  dispose();
});

test('unmount invalidates pending success and queued Auth reloads and unsubscribes', async () => {
  const r = runtime(), dispose = r.mount();
  r.event('PASSWORD_RECOVERY');
  dispose();
  const before = r.writes.length;
  r.flushAuth(); assert.equal(r.pending.length, 1);
  r.complete(0, 'late-after-unmount'); await flush();
  assert.equal(r.writes.length, before);
  assert.equal(r.subscriptions[0].active, false);
});

test('StrictMode setup-cleanup-setup accepts only the current effect continuation', async () => {
  const r = runtime();
  r.mount()();
  const dispose = r.mount();
  const before = r.writes.length;
  r.complete(0, 'strictmode-disposed-effect'); await flush();
  assert.equal(r.writes.length, before);
  r.complete(1, 'strictmode-current-effect'); await flush();
  assert.equal(r.state.report.private, 'strictmode-current-effect');
  assert.equal(r.subscriptions.filter(subscription => subscription.active).length, 1);
  dispose();
  assert.equal(r.subscriptions.some(subscription => subscription.active), false);
});

test('INITIAL_SESSION does not clear a resolved report or multiply initial reads', async () => {
  const r = runtime(), dispose = r.mount();
  r.event('INITIAL_SESSION'); r.flushAuth();
  assert.equal(r.pending.length, 1);
  assert.equal(r.entitlementPending.length, 1);
  assert.equal(r.invalidations, 0);
  r.complete(0, 'initial'); await flush();
  const before = r.writes.length;
  r.event('INITIAL_SESSION'); r.flushAuth(); await flush();
  assert.equal(r.writes.length, before);
  assert.equal(r.pending.length, 1);
  assert.equal(r.state.report.private, 'initial');
  dispose();
});
