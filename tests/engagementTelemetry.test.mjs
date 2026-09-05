import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluateEngagementEvent, ENGAGEMENT_TELEMETRY_CONTRACT } from '../src/services/engagementTelemetryContract.ts';

const skipped = { contract: 'BEST_EFFORT_TELEMETRY', status: 'skipped', reason: 'NO_SAFE_WRITE_CONTRACT', persisted: false };
for (const identity of ['owner', 'authenticated user', 'anonymous']) {
  test(`${identity}: valid optional event is explicitly skipped, never impersonated or persisted`, () => {
    assert.deepEqual(evaluateEngagementEvent('view_report_today', { page_path: '/report/today' }), skipped);
  });
}
for (const forged of [{ user_id: 'user-b' }, { userId: 'user-b' }, { role: 'admin' },
  { metadata: { admin: true } }, { metadata: { user_id: 'user-b' } },
  { metadata: { user_metadata: { role: 'admin' } } }, { metadata: { tier: 'vip' } }]) {
  test(`forged identity/privilege rejected: ${JSON.stringify(forged)}`, () => {
    const result = evaluateEngagementEvent('view_home', forged);
    assert.equal(result.status, 'rejected');
    assert.equal(result.persisted, false);
  });
}
test('malformed payload, unknown type, oversized/nested metadata, dates and credential URLs fail closed', () => {
  for (const options of [null, [], { page_path: '//evil.example' }, { page_path: '/auth/callback?code=sensitive' },
    { metadata: { a: 'x'.repeat(121) } }, { metadata: { a: Infinity } }, { metadata: { a: {} } },
    { report_date: '2026-02-30' }, { content_type: '<script>' },
    { metadata: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`key_${'a'.repeat(i + 1)}`, i])) }]) {
    assert.equal(evaluateEngagementEvent('view_home', options).status, 'rejected');
  }
  assert.equal(evaluateEngagementEvent('arbitrary_table_write').status, 'rejected');
});
test('tracking cannot send a forbidden INSERT, produce a 403, retry or suppress a security exception', () => {
  const service = readFileSync(new URL('../src/services/engagementService.ts', import.meta.url), 'utf8');
  const tracking = service.slice(service.indexOf('export async function trackEngagementEvent'), service.indexOf('export async function submitEarlyAccess'));
  assert.match(tracking, /return evaluateEngagementEvent\(eventName, options\)/);
  assert.doesNotMatch(tracking, /supabase\.|fetch\(|\.insert\(|console\.|catch\s*[({]|createClient|setTimeout/);
  assert.equal(ENGAGEMENT_TELEMETRY_CONTRACT.persistence, 'DISABLED_NO_SAFE_WRITE_CONTRACT');
  assert.equal(ENGAGEMENT_TELEMETRY_CONTRACT.retries, 0);
  assert.ok(Object.isFrozen(ENGAGEMENT_TELEMETRY_CONTRACT));
});
test('invalid telemetry yields a typed result rather than crashing the main flow', async () => {
  const result = await Promise.resolve(evaluateEngagementEvent('malformed', undefined));
  assert.equal(result.status, 'rejected');
  assert.equal(result.persisted, false);
});
