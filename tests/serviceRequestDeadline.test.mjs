// Execute the real browser services with a fake clock and fetch; no network or Auth is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness(fetch = () => { throw Error('NETWORK_FORBIDDEN'); }, getSessionOverride) {
  const timers = new Map();
  let timerId = 0;
  const cache = new Map();
  const session = { access_token: 'synthetic-local-only', user: { id: 'synthetic-member' } };
  const globals = {
    Promise, Error, AbortController, URL, URLSearchParams, Date,
    setTimeout(fn, delay) { assert(delay > 0 && delay <= 20_000); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch,
  };
  function load(path) {
    const absolute = resolve(root, path);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const source = ts.transpileModule(readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      ...globals, module, exports: module.exports,
      require(name) {
        if (name === '@/lib/supabase') return { supabase: { auth: {
          getSession: getSessionOverride || (async () => ({ data: { session }, error: null })),
        } } };
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(resolve(dirname(absolute), name + (name.endsWith('.ts') ? '' : '.ts')));
        throw Error('UNAPPROVED_TEST_IMPORT: ' + name);
      },
    }, { filename: absolute });
    return module.exports;
  }
  return {
    load,
    get timerCount() { return timers.size; },
    expire() {
      assert.equal(timers.size, 1, 'exactly one live request deadline is expected');
      const [id, fn] = timers.entries().next().value;
      timers.delete(id); fn();
    },
  };
}

test('request deadline clears its timer on success and on an ordinary error', async () => {
  const h = harness();
  const { requestWithDeadline } = h.load('src/services/requestDeadline.ts');
  let signal;
  assert.equal(await requestWithDeadline(async value => { signal = value; return 'ready'; }), 'ready');
  assert.equal(signal.aborted, false);
  assert.equal(h.timerCount, 0);
  const failure = Error('SYNTHETIC_CONNECTION_ERROR');
  await assert.rejects(requestWithDeadline(async () => { throw failure; }), error => error === failure);
  assert.equal(h.timerCount, 0);
});

test('a hung request rejects at its deadline even when it ignores abort; late completion cannot revive it', async () => {
  const h = harness();
  const { requestWithDeadline } = h.load('src/services/requestDeadline.ts');
  const stalled = deferred();
  let signal;
  const result = requestWithDeadline(value => { signal = value; return stalled.promise; });
  const rejected = assert.rejects(result, /REQUEST_TIMEOUT/);
  await flush(); h.expire();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(h.timerCount, 0);
  stalled.resolve('late'); await flush();
  await assert.rejects(result, /REQUEST_TIMEOUT/);
  assert.equal(await requestWithDeadline(async () => 'retry-success'), 'retry-success');
  assert.equal(h.timerCount, 0);
});

for (const stage of ['fetch', 'body']) {
  test(`member-access ${stage} stall aborts and permits a fresh retry`, async () => {
    let calls = 0, signal;
    const stalled = deferred();
    const expected = { success: true, membership: { state: 'free' } };
    const h = harness(async (_url, init) => {
      calls++; signal = init.signal;
      if (calls === 1 && stage === 'fetch') return stalled.promise;
      return { ok: true, status: 200, json: () => calls === 1 ? stalled.promise : Promise.resolve(expected) };
    });
    const service = h.load('src/services/membershipService.ts');
    const result = service.fetchMemberAccess('status');
    const rejected = assert.rejects(result, /會員服務回應逾時，請稍後再試。/);
    await flush(); h.expire(); await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(await service.fetchMemberAccess('status'), expected);
    assert.equal(calls, 2);
    assert.equal(h.timerCount, 0);
  });
}

for (const method of ['callGetReportPayload', 'callGetReportHistory']) {
  test(`${method} rejects a session lookup crossing Auth invalidation before any fetch, then permits fresh retry`, async () => {
    const oldSession = deferred();
    let sessionCalls = 0, fetchCalls = 0;
    const expected = { tier: 'free', report: null, reports: [] };
    const h = harness(async () => {
      fetchCalls++;
      return { ok: true, status: 200, json: async () => expected };
    }, () => {
      sessionCalls++;
      return sessionCalls === 1 ? oldSession.promise : Promise.resolve({ data: { session: null }, error: null });
    });
    const service = h.load('src/services/entitlementService.ts');
    const old = service[method]();
    const rejected = assert.rejects(old, /AUTH_CHANGED/);
    assert.equal(sessionCalls, 1);
    assert.equal(fetchCalls, 0);
    service.invalidateReportRequestCache();
    oldSession.resolve({ data: { session: {
      access_token: 'synthetic-old-local-only', user: { id: 'synthetic-old-member' },
    } }, error: null });
    await rejected;
    assert.equal(fetchCalls, 0, 'an old session must not create new work after its Auth generation was invalidated');
    assert.equal(h.timerCount, 0);
    assert.equal(await service[method](), expected);
    assert.equal(sessionCalls, 2);
    assert.equal(fetchCalls, 1);
    assert.equal(h.timerCount, 0);
  });

  test(`${method} shares one bounded body read and evicts timed-out inflight work before retry`, async () => {
    let calls = 0, signal;
    const stalled = deferred();
    const expected = { success: true, tier: 'member', report: null, reports: [] };
    const h = harness(async (_url, init) => {
      calls++; signal = init.signal;
      return { ok: true, status: 200, json: () => calls === 1 ? stalled.promise : Promise.resolve(expected) };
    });
    const service = h.load('src/services/entitlementService.ts');
    const first = service[method](), shared = service[method]();
    const failures = [assert.rejects(first, /REQUEST_TIMEOUT/), assert.rejects(shared, /REQUEST_TIMEOUT/)];
    await flush();
    assert.equal(calls, 1);
    h.expire(); await Promise.all(failures);
    assert.equal(signal.aborted, true);
    assert.equal(await service[method](), expected);
    assert.equal(calls, 2);
    stalled.resolve({ tier: 'admin', private: 'stale' }); await flush();
    assert.equal(await service[method](), expected, 'a late timed-out body cannot replace the successful cached retry');
    assert.equal(calls, 2);
    assert.equal(h.timerCount, 0);
  });

  test(`${method} keeps ordinary HTTP failures retryable and clears deadline timers`, async () => {
    let calls = 0;
    const expected = { tier: 'free', report: null, reports: [] };
    const h = harness(async () => {
      calls++;
      return calls === 1
        ? { ok: false, status: 503, json: async () => ({ error: 'SYNTHETIC_UNAVAILABLE' }) }
        : { ok: true, status: 200, json: async () => expected };
    });
    const service = h.load('src/services/entitlementService.ts');
    await assert.rejects(service[method](), /SYNTHETIC_UNAVAILABLE/);
    assert.equal(h.timerCount, 0);
    assert.equal(await service[method](), expected);
    assert.equal(calls, 2);
    assert.equal(h.timerCount, 0);
  });

  test(`${method} invalidation prevents old work from replacing cache or evicting a newer same-user request`, async () => {
    let calls = 0;
    const oldBody = deferred(), newBody = deferred();
    const expected = { tier: 'free', report: null, reports: [] };
    const h = harness(async () => {
      calls++;
      return { ok: true, status: 200, json: () => calls === 1 ? oldBody.promise : newBody.promise };
    });
    const service = h.load('src/services/entitlementService.ts');
    const old = service[method]();
    const oldSettled = old.catch(() => null);
    await flush();
    service.invalidateReportRequestCache();
    const current = service[method]();
    await flush(); assert.equal(calls, 2);
    oldBody.resolve({ tier: 'admin', private: 'previous-auth-generation' });
    await oldSettled;
    const shared = service[method]();
    await flush();
    assert.equal(calls, 2, 'the previous request finally must not evict the current inflight request');
    newBody.resolve(expected);
    assert.equal(await current, expected);
    assert.equal(await shared, expected);
    assert.equal(await service[method](), expected);
    assert.equal(calls, 2);
    assert.equal(h.timerCount, 0);
  });
}
