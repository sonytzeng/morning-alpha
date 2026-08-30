import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { containsCredentialMaterial, parseBrokerResult } from '../scripts/emma-auto-repair-oidc.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/emma-auto-repair-oidc.yml');
const script = read('scripts/emma-auto-repair-oidc.mjs');

const dispatched = {
  status: 'DISPATCHED',
  dispatched: true,
  dispatch_id: '11111111-1111-4111-8111-111111111111',
  branch_name: 'emma/auto-repair-123456789abc',
  seed_head_sha: 'a'.repeat(40),
  task_sha256: 'b'.repeat(64),
  pull_request_number: 83,
  pull_request_url: 'https://github.com/sonytzeng/morning-alpha/pull/83',
  dispatch_comment_id: 123456,
  oidc_status: 'PASS',
  github_write_status: 'PASS',
  credential_type: 'github_app_installation',
  branch_reused: false,
  task_seed_reused: false,
  pull_request_reused: false,
  dispatch_comment_reused: false,
  merge_verification: 'NOT_MERGED',
  deployment_verification: 'NOT_PERFORMED',
};

test('workflow grants only OIDC plus repository read and persists no checkout credential', () => {
  assert.match(workflow, /permissions:\s*\n\s+id-token: write\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents:\s*write|pull-requests:\s*write|issues:\s*write/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|github\.token|GH_TOKEN|github_pat_|\bPAT\b/);
});

test('caller performs only OIDC dispatch and never calls GitHub with a caller credential', () => {
  assert.match(script, /emma-multisite-github-broker/);
  assert.match(script, /JSON\.stringify\(\{ action: 'dispatch' \}\)/);
  assert.doesNotMatch(script, /process\.env\.(?:GITHUB_TOKEN|GH_TOKEN)|api\.github\.com|githubFailureCode|dispatchClaim/);
  assert.doesNotMatch(script, /github\.token|Authorization: `Bearer \$\{process\.env/);
});

test('safe broker evidence is allowlisted and installation credentials cannot cross the response', () => {
  const result = parseBrokerResult(dispatched);
  assert.equal(result.credential_type, 'github_app_installation');
  assert.equal(result.pull_request_number, 83);
  assert.equal(result.duplicate_branch, 0);
  for (const unsafe of [
    { ...dispatched, token: 'installation-secret' },
    { ...dispatched, access_token: 'installation-secret' },
    { ...dispatched, nested: { private_key: 'private' } },
    { ...dispatched, nested: { value: 'github_pat_forbidden' } },
  ]) assert.throws(() => parseBrokerResult(unsafe), /BROKER_RESPONSE_INVALID/);
});

test('caller credential detector rejects token, PAT and authorization-shaped material', () => {
  assert.equal(containsCredentialMaterial({ github_token: 'x' }), true);
  assert.equal(containsCredentialMaterial({ pat: 'x' }), true);
  assert.equal(containsCredentialMaterial({ authorization: 'Bearer x' }), true);
  assert.equal(containsCredentialMaterial({ value: 'ghp_forbidden' }), true);
  assert.equal(containsCredentialMaterial({ credential_type: 'github_app_installation' }), false);
});

test('idempotent retry evidence must reuse without duplication', () => {
  const replay = parseBrokerResult({
    ...dispatched,
    github_write_status: 'REUSED',
    branch_reused: true,
    task_seed_reused: true,
    pull_request_reused: true,
    dispatch_comment_reused: true,
    duplicate_branch: 0,
    duplicate_task_seed: 0,
    duplicate_pr: 0,
    duplicate_comment: 0,
  });
  assert.equal(replay.branch_reused, true);
  assert.throws(() => parseBrokerResult({ ...dispatched, duplicate_pr: 1 }), /BROKER_DUPLICATE_EVIDENCE_INVALID/);
});

test('IDLE is truthful and cannot claim a GitHub write', () => {
  assert.deepEqual(parseBrokerResult({
    status: 'IDLE',
    dispatched: false,
    oidc_status: 'PASS',
    github_write_status: 'NOT_ATTEMPTED',
  }), {
    status: 'IDLE',
    repository: 'sonytzeng/morning-alpha',
    oidc_status: 'PASS',
    github_write_status: 'NOT_ATTEMPTED',
    merge_verification: 'NOT_PERFORMED',
    deployment_verification: 'NOT_PERFORMED',
  });
});
