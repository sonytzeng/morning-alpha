import { pathToFileURL } from 'node:url';
import {
  buildEmmaRepairTask,
  emmaGithubRepairPolicy,
  githubErrorCode,
  parseEmmaRepairClaim,
  redactEmmaEvidence,
  seedBaseSha,
} from '../supabase/functions/_shared/emma-github-repair-contract.mjs';

const maxResponseBytes = 512 * 1024;

export const parseClaim = parseEmmaRepairClaim;
export const redactEvidence = redactEmmaEvidence;
export const buildTask = buildEmmaRepairTask;
export { seedBaseSha };

export function githubFailureCode(operation, response) {
  return githubErrorCode(operation, response?.status);
}

async function readJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new Error('RESPONSE_TOO_LARGE');
  return text ? JSON.parse(text) : null;
}

async function oidcToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '';
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? '';
  if (!requestUrl.startsWith('https://') || !requestToken) throw new Error('OIDC_RUNTIME_MISSING');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', emmaGithubRepairPolicy.audience);
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

async function dispatchThroughBroker() {
  const response = await fetch(emmaGithubRepairPolicy.brokerUrl, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${await oidcToken()}`,
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
  return body;
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== emmaGithubRepairPolicy.repository ||
      process.env.GITHUB_REF !== 'refs/heads/main' ||
      !['schedule', 'workflow_dispatch', 'push'].includes(process.env.GITHUB_EVENT_NAME ?? '') ||
      process.env.EMMA_OIDC_AUDIENCE !== emmaGithubRepairPolicy.audience ||
      process.env.EMMA_OIDC_BROKER_URL !== emmaGithubRepairPolicy.brokerUrl) {
    throw new Error('WORKFLOW_PROVENANCE_INVALID');
  }
  const result = await dispatchThroughBroker();
  console.log(JSON.stringify({
    status: result?.status ?? 'VERIFICATION_REQUIRED',
    repository: emmaGithubRepairPolicy.repository,
    dispatched: result?.dispatched === true,
    pull_request_url: result?.pull_request_url ?? null,
    github_create_pr_http_status: result?.github_create_pr_http_status ?? null,
    github_credential_type: result?.github_credential_type ?? null,
    merge: 'NOT_PERFORMED',
    production_deploy: 'NOT_PERFORMED',
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((cause) => {
    const code = cause instanceof Error && /^[A-Z0-9_]{1,120}$/.test(cause.message)
      ? cause.message : 'OIDC_WORKFLOW_FAILURE';
    console.error(JSON.stringify({ status: 'FAILED', error: code }));
    process.exitCode = 1;
  });
}
