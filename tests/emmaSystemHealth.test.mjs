import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Morning Alpha sends bounded signed health evidence to the exact Emma endpoint', () => {
  const emitter = read('supabase/functions/_shared/emma-system-health.ts');
  assert.match(emitter, /qjgrthjpffhtxvbkfyat\.supabase\.co/);
  assert.match(emitter, /EMMA_SYSTEM_HEALTH_WEBHOOK_SECRET/);
  assert.match(emitter, /X-Emma-Timestamp/);
  assert.match(emitter, /X-Emma-Event-Id/);
  assert.match(emitter, /X-Emma-Signature/);
  assert.match(emitter, /HMAC/);
  assert.match(emitter, /AbortSignal\.timeout\(5_000\)/);
  assert.doesNotMatch(emitter, /SUPABASE_SERVICE_ROLE_KEY|Authorization/);
});

test('MA-Ops maps scheduler, report and closing evidence without claiming repair', () => {
  const health = read('supabase/functions/ma-ops-health-check/index.ts');
  assert.match(health, /cron\.daily_report/);
  assert.match(health, /report\.today/);
  assert.match(health, /closing\.verification/);
  assert.match(health, /reportHealthToEmma/);
  assert.doesNotMatch(health, /details: \{ run_id: runId, target_date: request\.target_date, checks: reportChecks \}/);
  assert.doesNotMatch(health, /emma-dispatch-codex|prepare_emma_incident_mission/);
});
