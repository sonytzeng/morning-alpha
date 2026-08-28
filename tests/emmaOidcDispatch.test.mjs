import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTask, githubFailureCode, parseClaim, redactEvidence, seedBaseSha } from '../scripts/emma-auto-repair-oidc.mjs';
import { validateGitHubOidcClaims } from '../supabase/functions/_shared/githubOidc.mjs';
import { readFileSync } from 'node:fs';

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


test('reports only a bounded GitHub HTTP status', () => {
  assert.equal(githubFailureCode('PR_CREATE', { status: 403 }), 'GITHUB_PULL_REQUEST_PERMISSION_DENIED');
  assert.equal(githubFailureCode('TASK_CREATE', { status: 403 }), 'GITHUB_CONTENTS_PERMISSION_DENIED');
  assert.equal(githubFailureCode('not safe', { status: 999 }), 'GITHUB_HTTP_0');
});

test('binds a replayed task to its immutable seed parent', () => {
  const base = 'b'.repeat(40);
  assert.equal(seedBaseSha({ parents: [{ sha: base }] }), base);
  assert.equal(seedBaseSha({ parents: [] }), '');
  assert.equal(seedBaseSha({ parents: [{ sha: base }, { sha: 'c'.repeat(40) }] }), '');
});

test('fails closed when the GitHub OIDC audience is not exact', () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'emma:wrong-project:morning-alpha',
    sub: 'repo:sonytzeng/morning-alpha:ref:refs/heads/main',
    repository: 'sonytzeng/morning-alpha',
    repository_id: '1274909964',
    repository_owner_id: '279634487',
    workflow_ref: 'sonytzeng/morning-alpha/.github/workflows/emma-auto-repair-oidc.yml@refs/heads/main',
    ref: 'refs/heads/main',
    event_name: 'workflow_dispatch',
    run_id: '33132814978',
    run_attempt: '1',
    iat: now,
    exp: now + 300,
  };
  assert.throws(() => validateGitHubOidcClaims(claims, now), /OIDC_AUDIENCE_INVALID/);
});

test('uses a deterministic repair identity so replay cannot create another task path', () => {
  const parsed = parseClaim(claim);
  assert.equal(parsed.head_ref, parseClaim({ ...claim }).head_ref);
  assert.equal(parsed.task_path, parseClaim({ ...claim }).task_path);
  assert.match(buildTask(parsed, 'a'.repeat(40)), /emma-auto-repair:11111111-1111-4111-8111-111111111111/);
});

test('broker preflights one server credential before any repair mutation and reuses exact artifacts', () => {
  const broker = readFileSync(new URL('../supabase/functions/emma-github-oidc-broker/index.ts', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/emma-auto-repair-oidc.yml', import.meta.url), 'utf8');
  assert.ok(broker.indexOf('assertGitHubWriteCapability') < broker.indexOf("'BRANCH_LOOKUP'"));
  assert.match(broker, /const credential = await new EmmaGitHubCredentialProvider\(\)\.getCredential\(\)/);
  assert.ok(broker.indexOf("Deno.env.get('GITHUB_APP_ID')") < broker.indexOf("Deno.env.get('GITHUB_TOKEN')"));
  assert.match(broker, /permissions: \{ contents: 'write', pull_requests: 'write', issues: 'write' \}/);
  assert.match(broker, /credentialType: 'github_app_installation'/);
  assert.match(broker, /existingPull/);
  assert.match(broker, /commentsResult\.body\.find/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN:/);
  const responseBody = broker.slice(broker.indexOf('const responseBody = {'), broker.indexOf('return json(payload.action', broker.indexOf('const responseBody = {')));
  assert.doesNotMatch(responseBody, /claim_token|credential\.token|GITHUB_TOKEN/);
  const structuredLog = broker.slice(broker.indexOf("event: 'github_write_operation'"), broker.indexOf('}));', broker.indexOf("event: 'github_write_operation'")));
  assert.doesNotMatch(structuredLog, /credential\.token|Authorization|GITHUB_TOKEN/);
});

test('GitHub App installation token is repository-bounded and fails closed on partial configuration', () => {
  const broker = readFileSync(new URL('../supabase/functions/emma-github-oidc-broker/index.ts', import.meta.url), 'utf8');
  assert.match(broker, /repositories: \[REPOSITORY_NAME\]/);
  assert.match(broker, /repository\.id === REPOSITORY_ID/);
  assert.match(broker, /if \(!appId \|\| !installationIdValue \|\| !privateKey\) throw new Error\('GITHUB_APP_CONFIGURATION_INVALID'\)/);
  assert.match(broker, /permissions\.contents !== 'write'/);
  assert.match(broker, /permissions\.pull_requests !== 'write'/);
  assert.match(broker, /permissions\.issues !== 'write'/);
  assert.doesNotMatch(broker, /console\.(?:log|error)[^\n]*(?:privateKey|appJwt|credential\.token)/);
});

test('GitHub permission failures have bounded actionable taxonomy', () => {
  assert.equal(githubFailureCode('INSTALLATION_LOOKUP', { status: 404 }), 'GITHUB_INSTALLATION_NOT_FOUND');
  assert.equal(githubFailureCode('REPOSITORY_LOOKUP', { status: 404 }), 'GITHUB_REPOSITORY_NOT_ALLOWED');
  assert.equal(githubFailureCode('BRANCH_CREATE', { status: 422 }), 'GITHUB_BRANCH_CREATE_FAILED');
});
