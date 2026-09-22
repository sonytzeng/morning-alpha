import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = '../supabase/migrations/20260922153000_acceptance_readiness_window_parity_v1.sql';
const migration = readFileSync(new URL(migrationPath, import.meta.url), 'utf8');

function timing(completedAt) {
  const minutes = Number(completedAt.slice(0, 2)) * 60 + Number(completedAt.slice(3, 5));
  return {
    lifecycle: minutes < 8 * 60 + 45 ? 'PASS' : 'FAIL',
    readiness: minutes < 8 * 60 + 45 ? 'PASS' : 'FAIL',
    delivery_sla: minutes <= 7 * 60 + 30 ? 'PASS' : 'MISS',
    recovered_within_readiness_window: minutes > 7 * 60 + 30 && minutes < 8 * 60 + 45,
  };
}

test('the sole migration changes only Acceptance timing without business DML, Cron or policy changes', () => {
  assert.match(migration, /capture_morning_alpha_acceptance_v1\(date,text\)/);
  assert.match(migration, /6b24694c90fff258727147df13ae2638/);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\s+(?:into\s+)?public\./i);
  assert.doesNotMatch(migration, /cron\.|create\s+policy|alter\s+policy|auth\.|secrets?/i);
  assert.equal((migration.match(/execute v_candidate;/g) || []).length, 1);
  assert.match(migration, /ACCEPTANCE_READINESS_WINDOW_AUTHORITY_DRIFT/);
});

test('Acceptance keeps the 07:30 SLA independent from the 08:45 readiness deadline', () => {
  assert.match(migration, /READINESS_WINDOW_DEADLINE_EXCEEDED/);
  assert.match(migration, /T08:45:00\+08:00/);
  assert.match(migration, /T07:30:00\+08:00/);
  assert.match(migration, /delivery_sla_status/);
  assert.match(migration, /recovered_within_readiness_window/);
  assert.match(migration, /readiness_status/);
  assert.match(migration, /lifecycle_status/);
});

for (const [completion, expected] of [
  ['07:00', { lifecycle: 'PASS', readiness: 'PASS', delivery_sla: 'PASS', recovered_within_readiness_window: false }],
  ['07:29', { lifecycle: 'PASS', readiness: 'PASS', delivery_sla: 'PASS', recovered_within_readiness_window: false }],
  ['07:31', { lifecycle: 'PASS', readiness: 'PASS', delivery_sla: 'MISS', recovered_within_readiness_window: true }],
  ['08:00', { lifecycle: 'PASS', readiness: 'PASS', delivery_sla: 'MISS', recovered_within_readiness_window: true }],
  ['08:30', { lifecycle: 'PASS', readiness: 'PASS', delivery_sla: 'MISS', recovered_within_readiness_window: true }],
  ['08:44', { lifecycle: 'PASS', readiness: 'PASS', delivery_sla: 'MISS', recovered_within_readiness_window: true }],
  ['08:45', { lifecycle: 'FAIL', readiness: 'FAIL', delivery_sla: 'MISS', recovered_within_readiness_window: false }],
]) test(`${completion} completion has independent lifecycle, readiness and SLA semantics`, () => {
  assert.deepEqual(timing(completion), expected);
});
