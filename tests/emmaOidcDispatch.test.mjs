import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTask, parseClaim, redactEvidence } from '../scripts/emma-auto-repair-oidc.mjs';

const claim = {
  dispatch_id: '11111111-1111-4111-8111-111111111111',
  claim_token: '22222222-2222-4222-8222-222222222222',
  owner_id: '33333333-3333-4333-8333-333333333333',
  health_event_id: '44444444-4444-4444-8444-444444444444',
  mission_id: '55555555-5555-4555-8555-555555555555',
  mission_run_id: '66666666-6666-4666-8666-666666666666',
  repository_name: 'sonytzeng/morning-alpha',
  base_ref: 'main',
  head_ref: 'emma/auto-repair-123456789abc',
  task_path: '.emma/tasks/auto-repair-11111111-1111-4111-8111-111111111111.md',
  approved_change_paths: ['supabase/functions/closing-verification-engine/'],
  required_checks: [{ name: 'validate', app_id: 15368, app_slug: 'github-actions' }],
  mission_title: 'Repair closing verification',
  mission_goal: 'Repair the verified defect.',
  source_evidence: { status: 'MISSED', api_key: 'do-not-copy' },
};

test('accepts only a bounded Morning Alpha claim', () => {
  assert.equal(parseClaim(claim).repository_name, 'sonytzeng/morning-alpha');
  assert.throws(() => parseClaim({ ...claim, repository_name: 'sonytzeng/other' }));
  assert.throws(() => parseClaim({ ...claim, base_ref: 'release' }));
  assert.throws(() => parseClaim({ ...claim, required_checks: [{ name: 'spoofed', app_id: 1, app_slug: 'x' }] }));
});

test('redacts credential-shaped evidence and builds immutable markers', () => {
  assert.equal(redactEvidence(claim.source_evidence).api_key, '[REDACTED]');
  const task = buildTask(claim, 'a'.repeat(40));
  assert.match(task, /emma-auto-repair:11111111-1111-4111-8111-111111111111/);
  assert.match(task, /emma-codex-repair:55555555-5555-4555-8555-555555555555:66666666-6666-4666-8666-666666666666/);
  assert.doesNotMatch(task, /do-not-copy/);
  assert.match(task, /Never merge, deploy, execute migrations/);
});
