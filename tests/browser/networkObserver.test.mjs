import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { metadataOnly, observeFetch, sanitizedPath } from './networkObserver.ts';

test('network observer removes query, fragment, credentials and opaque/identifying path segments', () => {
  assert.equal(sanitizedPath('https://user:secret@example.test/auth/callback?code=secret#token'), '/auth/callback');
  assert.equal(sanitizedPath('/users/person%40example.test/aabbccddeeff001122334455'), '/users/:redacted/:redacted');
});
test('metadata whitelist never persists headers, bodies, tokens or unexpected properties', () => {
  const input = { method: 'post', path: '/auth/token?secret=x#y', status: 403, duration: 12.5, timestamp: 123,
    headers: { Authorization: 'test-secret' }, body: 'test-secret', token: 'test-secret', cookie: 'test-secret' };
  const output = metadataOnly(input);
  assert.deepEqual(output, { method: 'POST', path: '/auth/token', status: 403, duration: 12.5, timestamp: 123 });
  assert.equal(JSON.stringify(output).includes('secret'), false);
});
test('fetch observer preserves exact input/response and captures real status and duration without reading sensitive fields', async () => {
  const rows = [];
  const response = new Response('private test payload', { status: 201 });
  Object.defineProperty(response, 'headers', { get() { throw new Error('must not read response headers'); } });
  const options = { method: 'POST' };
  for (const key of ['headers', 'body']) Object.defineProperty(options, key, { get() { throw new Error('must not read request contents'); } });
  const input = '/rpc/check?token=secret#private';
  let calls = 0;
  const original = async (...args) => {
    calls++; assert.equal(args[0], input); assert.equal(args[1], options); return response;
  };
  const clocks = [10, 25.5];
  const wrapped = observeFetch(original, row => rows.push(row), () => clocks.shift(), () => 1234);
  assert.equal(await wrapped(input, options), response);
  assert.equal(response.bodyUsed, false);
  assert.equal(calls, 1);
  assert.deepEqual(rows, [{ method: 'POST', path: '/rpc/check', status: 201, duration: 15.5, timestamp: 1234 }]);
});
test('Request object is passed through unchanged and never consumed', async () => {
  const request = new Request('https://example.test/rpc/safe?private=value', { method: 'POST', body: 'private' });
  const rows = [];
  const wrapped = observeFetch(async input => { assert.equal(input, request); return new Response(null, { status: 204 }); }, row => rows.push(row));
  await wrapped(request);
  assert.equal(request.bodyUsed, false);
  assert.equal(rows[0].method, 'POST'); assert.equal(rows[0].status, 204);
  assert.equal(rows[0].path, '/rpc/safe');
});
test('fetch rejection is rethrown without retries or persisting its message', async () => {
  const failure = new Error('private payload'); const rows = []; let count = 0;
  await assert.rejects(observeFetch(async () => { count++; throw failure; }, row => rows.push(row))('/safe'), err => err === failure);
  assert.equal(count, 1); assert.equal(rows[0].status, 0);
  assert.equal(JSON.stringify(rows).includes('private'), false);
});
test('observer storage/sink failure cannot change network response or rejection', async () => {
  const response = new Response(null, { status: 200 });
  const sink = () => { throw new Error('storage denied'); };
  assert.equal(await observeFetch(async () => response, sink)('/safe'), response);
  const error = new Error('original');
  await assert.rejects(observeFetch(async () => { throw error; }, sink)('/safe'), value => value === error);
});
test('observer is opt-in localhost serve-only, never logs payloads or sends telemetry', () => {
  const bootstrap = readFileSync(new URL('./networkObserverBootstrap.ts', import.meta.url), 'utf8');
  const config = readFileSync(new URL('./vite.config.ts', import.meta.url), 'utf8');
  assert.match(config, /command !== 'serve'.*process\.env\.MA_BEGINNER_E2E !== '1'/);
  assert.match(config, /apply: 'serve'/);
  assert.match(bootstrap, /!import\.meta\.env\.DEV.*window\.location\.origin !== 'http:\/\/localhost:3000'/);
  assert.doesNotMatch(bootstrap, /\.headers|\.body|\.text\(|\.json\(|console\.|sendBeacon|XMLHttpRequest\(|localStorage|supabase/);
  assert.match(bootstrap, /textContent = JSON\.stringify/);
  assert.match(bootstrap, /entry\.responseStatus/);
  assert.match(bootstrap, /entry\.initiatorType === 'fetch'\) return/);
});
test('actual production artifacts and production entrypoints exclude the network observer', () => {
  const root = new URL('../../', import.meta.url);
  for (const file of ['vite.config.ts', 'src/main.tsx', 'src/router/config.tsx']) {
    assert.doesNotMatch(readFileSync(new URL(file, root), 'utf8'), /networkObserver|__e2e\/network/);
  }
  const output = new URL('out/', root);
  // CI runs tests before its build step. Produce real artifacts rather than
  // skipping this safety assertion on a clean checkout.
  if (!existsSync(output)) execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: root, stdio: 'pipe' });
  assert.ok(existsSync(output), 'production build must exist for acceptance');
  for (const path of readdirSync(output, { recursive: true }).filter(p => /\.(js|html|map)$/.test(p))) {
    assert.doesNotMatch(readFileSync(new URL(path, output), 'utf8'), /networkObserver|network-metadata-report|ma:pr100:network-metadata-only/);
  }
});
