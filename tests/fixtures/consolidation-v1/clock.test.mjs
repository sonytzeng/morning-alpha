// Pure guard tests. Synthetic observations here are not runtime-clock proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVmClockConfiguration, validateRuntimeClockWitness,
  assertHostClockUnchanged } from '../../helpers/consolidationVmClock.mjs';

const root = '/private/tmp/ma-clock-20260909-020052';
const config = () => ({ root, limaHome: root + '/lima', instance: 'clock', configPath: root + '/clock.yaml',
  configSha256: 'a'.repeat(64), bootId: '2879f43f-0819-4a08-88dc-195166474350' });
const witness = () => {
  const scope = 'ma-consolidation-v1-20260909020052', boot_id = config().bootId;
  return { schema_version: 'CONSOLIDATION_RUNTIME_CLOCK_V1', scope, boot_id,
    host_clock_unchanged: true, guest_time_sync_disabled: true, egress_default_deny: true,
    guest_before: '2026-09-08T23:00:00.000Z', guest_after: '2026-09-08T23:00:02.000Z',
    runtimes: Object.fromEntries([['postgres', 'clock_timestamp'], ['edge', 'Date.now'],
      ['auth', 'authenticated_session_issued_at']].map(([name, observation]) => [name, {
        scope, boot_id, observation, observed_at: '2026-09-08T23:00:01.000Z', clock_override: false,
        image_sha256: 'sha256:' + 'b'.repeat(64), receipt_sha256: 'c'.repeat(64),
      }])) };
};

test('VM controller configuration rejects old profiles and non-tmp/shared paths', () => {
  assert.equal(validateVmClockConfiguration(config()).instance, 'clock');
  for (const mutation of [c => { c.root = '/Users/sonytzeng/.colima'; },
    c => { c.limaHome = '/Users/sonytzeng/.colima/_lima'; }, c => { c.instance = 'default'; },
    c => { c.configPath = '/tmp/other.yaml'; }, c => { c.bootId = 'other'; }]) {
    const value = config(); mutation(value); assert.throws(() => validateVmClockConfiguration(value));
  }
});
test('runtime witness requires actual Auth, Edge and PostgreSQL in one bounded clock window', () => {
  assert.equal(validateRuntimeClockWitness(witness()).clock_consistent, true);
  assert.equal(validateRuntimeClockWitness(witness()).full_e2e_executed, false);
  for (const mutation of [w => { delete w.runtimes.auth; }, w => { w.runtimes.auth.observation = 'container_date'; },
    w => { w.runtimes.edge.clock_override = true; }, w => { w.runtimes.postgres.observed_at = '2026-09-09T02:00:00.000Z'; },
    w => { w.runtimes.auth.boot_id = 'different'; }, w => { w.host_clock_unchanged = false; },
    w => { w.guest_after = '2026-09-08T23:05:00.000Z'; }]) {
    const value = witness(); mutation(value); assert.throws(() => validateRuntimeClockWitness(value));
  }
});
test('host wall time must track monotonic elapsed time, not the shifted guest epoch', () => {
  const before = { wall_ms: 100000, monotonic_ns: '1000000000' };
  assert.doesNotThrow(() => assertHostClockUnchanged(before, { wall_ms: 102000, monotonic_ns: '3000000000' }));
  assert.throws(() => assertHostClockUnchanged(before, { wall_ms: 200000, monotonic_ns: '3000000000' }));
});
