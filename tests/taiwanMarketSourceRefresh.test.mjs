import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

test('daily source worker preserves exact receipts, native export forms, request budgets and durable halts', () => {
  const file = fileURLToPath(new URL('./taiwanMarketSourceRefresh.test.py', import.meta.url));
  const result = spawnSync('python3', [file, '-v'], { encoding: 'utf8', timeout: 90_000, maxBuffer: 2_000_000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
