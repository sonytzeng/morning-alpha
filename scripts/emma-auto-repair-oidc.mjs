import { pathToFileURL } from 'node:url';

const expected = Object.freeze({
  repository: 'sonytzeng/morning-alpha',
  ref: 'refs/heads/main',
  audience: 'emma:qjgrthjpffhtxvbkfyat:morning-alpha',
  brokerUrl: 'https://qjgrthjpffhtxvbkfyat.supabase.co/functions/v1/emma-multisite-github-broker',
});
const maxResponseBytes = 512 * 1024;
const safeEvents = new Set(['schedule', 'workflow_dispatch', 'push']);
const forbiddenCredentialKeys = /(?:^|_)(?:token|pat|password|secret|private_key|api_key|authorization)(?:$|_)/i;
const credentialValuePattern = /^(?:Bearer\s+|gh[pousr]_|github_pat_)/i;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : '';
}

function exactSha(value, length) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value) ? value : '';
}

export function containsCredentialMaterial(value, depth = 0) {
  if (depth > 8) return true;
  if (typeof value === 'string') return credentialValuePattern.test(value.trim());
  if (Array.isArray(value)) return value.some((item) => containsCredentialMaterial(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => {
    const normalized = key.toLowerCase();
    if (!['credential_type', 'github_credential_type', 'github_token_fallback', 'authorization_source'].includes(normalized) &&
        forbiddenCredentialKeys.test(normalized)) return true;
    return containsCredentialMaterial(item, depth + 1);
  });
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function parseBrokerResult(value) {
  if (!isRecord(value) || containsCredentialMaterial(value)) throw new Error('BROKER_RESPONSE_INVALID');
  if (value.status === 'IDLE') {
    if (value.dispatched !== false || value.oidc_status !== 'PASS' || value.github_write_status !== 'NOT_ATTEMPTED') {
      throw new Error('BROKER_IDLE_INVALID');
    }
    return Object.freeze({
      status: 'IDLE',
      repository: expected.repository,
      oidc_status: 'PASS',
      github_write_status: 'NOT_ATTEMPTED',
      merge_verification: 'NOT_PERFORMED',
      deployment_verification: 'NOT_PERFORMED',
    });
  }
  if (value.status !== 'DISPATCHED' || value.dispatched !== true || value.oidc_status !== 'PASS' ||
      !['PASS', 'REUSED'].includes(value.github_write_status) ||
      value.credential_type !== 'github_app_installation' ||
      value.merge_verification !== 'NOT_MERGED' || value.deployment_verification !== 'NOT_PERFORMED') {
    throw new Error('BROKER_DISPATCH_INVALID');
  }

  const dispatchId = exactUuid(value.dispatch_id ?? value.dispatch?.id ?? value.dispatch?.dispatch_id);
  const branchName = typeof value.branch_name === 'string' && /^emma\/auto-repair-[0-9a-f]{12}$/.test(value.branch_name)
    ? value.branch_name : '';
  const seedHeadSha = exactSha(value.seed_head_sha, 40);
  const taskSha256 = exactSha(value.task_sha256, 64);
  const pullRequestNumber = positiveInteger(value.pull_request_number);
  const dispatchCommentId = positiveInteger(value.dispatch_comment_id);
  const pullRequestUrl = typeof value.pull_request_url === 'string' &&
      value.pull_request_url === `https://github.com/${expected.repository}/pull/${pullRequestNumber}`
    ? value.pull_request_url : '';
  if (!dispatchId || !branchName || !seedHeadSha || !taskSha256 || !pullRequestNumber || !pullRequestUrl || !dispatchCommentId) {
    throw new Error('BROKER_EVIDENCE_INVALID');
  }
  for (const key of ['branch_reused', 'task_seed_reused', 'pull_request_reused', 'dispatch_comment_reused']) {
    if (typeof value[key] !== 'boolean') throw new Error('BROKER_IDEMPOTENCY_EVIDENCE_INVALID');
  }
  for (const key of ['duplicate_branch', 'duplicate_task_seed', 'duplicate_pr', 'duplicate_comment']) {
    if (value[key] !== undefined && value[key] !== 0) throw new Error('BROKER_DUPLICATE_EVIDENCE_INVALID');
  }
  return Object.freeze({
    status: 'DISPATCHED',
    repository: expected.repository,
    dispatch_id: dispatchId,
    branch_name: branchName,
    seed_head_sha: seedHeadSha,
    task_sha256: taskSha256,
    pull_request_number: pullRequestNumber,
    pull_request_url: pullRequestUrl,
    dispatch_comment_id: dispatchCommentId,
    oidc_status: 'PASS',
    github_write_status: value.github_write_status,
    credential_type: 'github_app_installation',
    branch_reused: value.branch_reused,
    task_seed_reused: value.task_seed_reused,
    pull_request_reused: value.pull_request_reused,
    dispatch_comment_reused: value.dispatch_comment_reused,
    duplicate_branch: value.duplicate_branch ?? 0,
    duplicate_task_seed: value.duplicate_task_seed ?? 0,
    duplicate_pr: value.duplicate_pr ?? 0,
    duplicate_comment: value.duplicate_comment ?? 0,
    merge_verification: 'NOT_MERGED',
    deployment_verification: 'NOT_PERFORMED',
  });
}

async function readJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new Error('RESPONSE_TOO_LARGE');
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error('BROKER_RESPONSE_INVALID');
  }
}

async function oidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '';
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? '';
  if (!requestUrl.startsWith('https://') || !requestToken) throw new Error('OIDC_RUNTIME_MISSING');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', expected.audience);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${requestToken}` },
    redirect: 'error',
  });
  const body = await readJson(response);
  if (!response.ok || typeof body?.value !== 'string' || body.value.length < 100) {
    throw new Error('OIDC_TOKEN_REQUEST_FAILED');
  }
  return body.value;
}

async function brokerDispatch() {
  const assertion = await oidcToken();
  const response = await fetch(expected.brokerUrl, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${assertion}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'dispatch' }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const code = typeof body?.error === 'string' && /^[A-Z0-9_]{1,120}$/.test(body.error)
      ? body.error : `BROKER_HTTP_${response.status}`;
    throw new Error(code);
  }
  return parseBrokerResult(body);
}

function verifyWorkflowProvenance() {
  if (process.env.GITHUB_REPOSITORY !== expected.repository || process.env.GITHUB_REF !== expected.ref ||
      !safeEvents.has(process.env.GITHUB_EVENT_NAME ?? '') ||
      process.env.EMMA_OIDC_AUDIENCE !== expected.audience ||
      process.env.EMMA_OIDC_BROKER_URL !== expected.brokerUrl) {
    throw new Error('WORKFLOW_PROVENANCE_INVALID');
  }
}

async function main() {
  verifyWorkflowProvenance();
  console.log(JSON.stringify(await brokerDispatch()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((cause) => {
    const code = cause instanceof Error && /^[A-Z0-9_]{1,120}$/.test(cause.message)
      ? cause.message : 'OIDC_WORKFLOW_FAILURE';
    console.error(JSON.stringify({ status: 'FAILED', error: code }));
    process.exitCode = 1;
  });
}
