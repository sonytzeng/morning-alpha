import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Signal Lab API verifies session and profiles.role on the server', async () => {
  const source = await read('supabase/functions/signal-lab-api/index.ts');
  assert.match(source, /authClient\.auth\.getUser\(accessToken\)/);
  assert.match(source, /from\("profiles"\).*select\("role"\)/s);
  assert.match(source, /ADMIN_REQUIRED/);
  assert.doesNotMatch(source, /localStorage|user_metadata|[?&]tier=/);
});

test('Signal Lab browser service has no direct table access', async () => {
  const source = await read('src/services/signalLabService.ts');
  assert.match(source, /functions\.invoke\('signal-lab-api'/);
  assert.doesNotMatch(source, /\.from\(['"]signal_lab_/);
});

test('Signal Lab functions retain JWT verification and no production integrations', async () => {
  const config = await read('supabase/config.toml');
  for (const fn of ['signal-lab-api', 'signal-lab-shadow', 'signal-lab-outcomes']) {
    assert.match(config, new RegExp(`\\[functions\\.${fn}\\]\\s+verify_jwt = true`));
  }
  const files = await Promise.all([
    read('supabase/functions/signal-lab-shadow/index.ts'),
    read('supabase/functions/signal-lab-outcomes/index.ts'),
  ]);
  const source = files.join('\n');
  assert.doesNotMatch(source, /from\(["'](reports|recommendations|subscriptions|line_push_logs)["']\)/);
  assert.doesNotMatch(source, /generate-daily-report|line-daily-push|content-os|emma/i);
});

test('Signal Lab route is isolated and uses the server-backed page', async () => {
  const router = await read('src/router/config.tsx');
  assert.match(router, /path: "\/signal-lab"/);
  assert.match(router, /<DeferredRoute><SignalLabPage \/><\/DeferredRoute>/);
});
