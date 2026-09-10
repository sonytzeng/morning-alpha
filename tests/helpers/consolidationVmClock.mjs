// Dedicated empty/test VM only. No SQL, credentials, application status writes,
// host clock mutation, old Colima access, or implicit VM start is implemented here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const timestamp = value => {
  assert.equal(typeof value, 'string');
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const ms = Date.parse(value);
  assert.equal(new Date(ms).toISOString(), value, 'Invalid clock timestamp');
  return ms;
};

export function validateVmClockConfiguration(config) {
  assert.match(config.root, /^\/private\/tmp\/ma-clock-\d{8}-\d{6}$/);
  assert.equal(config.limaHome, config.root + '/lima');
  assert.equal(config.instance, 'clock');
  assert.equal(config.configPath, config.root + '/clock.yaml');
  assert.match(config.configSha256, /^[a-f0-9]{64}$/);
  assert.match(config.bootId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  return { root: config.root, limaHome: config.limaHome, instance: config.instance,
    configPath: config.configPath, configSha256: config.configSha256, bootId: config.bootId };
}

/** A host monotonic witness catches accidental host-wall-clock changes. */
export function hostClockWitness() {
  return { wall_ms: Date.now(), monotonic_ns: process.hrtime.bigint().toString() };
}

export function assertHostClockUnchanged(before, after, toleranceMs = 1500) {
  const elapsed = Number(BigInt(after.monotonic_ns) - BigInt(before.monotonic_ns)) / 1e6;
  assert.ok(elapsed >= 0, 'Host monotonic clock regressed');
  assert.ok(Math.abs((after.wall_ms - before.wall_ms) - elapsed) <= toleranceMs,
    'Host wall clock changed during the VM-only operation');
}

/** These must be observations from actual PostgreSQL, Edge and Auth calls in
 * one run. This validator does not produce those receipts or a full E2E PASS. */
export function validateRuntimeClockWitness(witness) {
  assert.equal(witness.schema_version, 'CONSOLIDATION_RUNTIME_CLOCK_V1');
  assert.match(witness.scope, /^ma-consolidation-v1-\d{14}$/);
  assert.match(witness.boot_id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(witness.host_clock_unchanged, true);
  assert.equal(witness.guest_time_sync_disabled, true);
  assert.equal(witness.egress_default_deny, true);
  const start = timestamp(witness.guest_before), end = timestamp(witness.guest_after);
  assert.ok(end >= start && end - start <= 15000, 'Clock witness must use one bounded observation window');
  assert.deepEqual(Object.keys(witness.runtimes).sort(), ['auth', 'edge', 'postgres']);
  for (const name of ['postgres', 'edge', 'auth']) {
    const receipt = witness.runtimes[name], at = timestamp(receipt.observed_at);
    assert.equal(receipt.scope, witness.scope);
    assert.equal(receipt.boot_id, witness.boot_id);
    assert.equal(receipt.clock_override, false, 'Business runtimes must use the shared guest clock');
    assert.match(receipt.image_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.receipt_sha256, /^[a-f0-9]{64}$/);
    assert.ok(at >= start - 1000 && at <= end + 1000, `${name} observed a different clock`);
  }
  assert.equal(witness.runtimes.postgres.observation, 'clock_timestamp');
  assert.equal(witness.runtimes.edge.observation, 'Date.now');
  assert.equal(witness.runtimes.auth.observation, 'authenticated_session_issued_at');
  return { scope: witness.scope, clock_consistent: true, full_e2e_executed: false };
}

export function createVmClockController(configuration) {
  const config = validateVmClockConfiguration(configuration);
  assert.equal(process.platform, 'darwin', 'This driver controls a separate macOS-hosted Linux VM');
  assert.equal(realpathSync(config.root), resolve(config.root), 'VM root must not be a symlink');
  assert.equal(hash(readFileSync(config.configPath)), config.configSha256, 'VM configuration drift');
  const yaml = readFileSync(config.configPath, 'utf8');
  for (const setting of ['plain: true', 'mounts: []', 'networks: []']) {
    assert.ok(yaml.split('\n').includes(setting), `Required isolated VM setting missing: ${setting}`);
  }
  const environment = { PATH: process.env.PATH, HOME: process.env.HOME,
    LIMA_HOME: config.limaHome, LANG: 'C', LC_ALL: 'C' };
  const guest = args => execFileSync('limactl', ['shell', '--workdir', '/', config.instance, ...args], {
    env: environment, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  function assertIdentity() {
    assert.equal(guest(['hostname']), 'lima-clock');
    assert.equal(guest(['cat', '/proc/sys/kernel/random/boot_id']), config.bootId, 'Unexpected VM boot/replacement');
    assert.equal(guest(['systemctl', 'show', '--property=ActiveState', '--value', 'systemd-timesyncd']), 'inactive');
    assert.equal(guest(['systemctl', 'show', '--property=UnitFileState', '--value', 'systemd-timesyncd']), 'disabled');
  }
  function observe() {
    assertIdentity();
    const seconds = guest(['date', '-u', '+%s']);
    assert.match(seconds, /^\d+$/);
    return { boot_id: config.bootId, observed_at: new Date(Number(seconds) * 1000).toISOString(),
      host: hostClockWitness() };
  }
  function advance(target) {
    const targetMs = timestamp(target), before = observe();
    assert.ok(targetMs >= Date.parse(before.observed_at), 'Never rewind an active replay VM');
    const hostBefore = hostClockWitness();
    // The command is an argv array targeting this exact new VM, never the host.
    guest(['sudo', '-n', 'date', '-u', '-s', '@' + Math.floor(targetMs / 1000)]);
    const after = observe();
    assertHostClockUnchanged(hostBefore, after.host);
    assert.ok(Date.parse(after.observed_at) >= targetMs && Date.parse(after.observed_at) - targetMs <= 30000,
      'Guest time changed unexpectedly or clock operation exceeded its bound');
    return { scope: 'DEDICATED_VM_CLOCK_ONLY', before, after, target,
      host_clock_unchanged: true, full_e2e_executed: false };
  }
  return Object.freeze({ observe, advance });
}
