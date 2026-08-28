export const githubOidcPolicy = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  audience: 'emma:qjgrthjpffhtxvbkfyat:morning-alpha',
  repository: 'sonytzeng/morning-alpha',
  repositoryId: '1274909964',
  repositoryOwnerId: '279634487',
  workflowRef: 'sonytzeng/morning-alpha/.github/workflows/emma-auto-repair-oidc.yml@refs/heads/main',
  ref: 'refs/heads/main',
  subject: 'repo:sonytzeng/morning-alpha:ref:refs/heads/main',
  events: ['schedule', 'workflow_dispatch', 'push'],
});

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16_384) throw new Error('OIDC_SEGMENT_INVALID');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function parseJsonSegment(value) {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(value));
  const parsed = JSON.parse(decoded);
  if (!isRecord(parsed)) throw new Error('OIDC_SEGMENT_NOT_OBJECT');
  return parsed;
}

function exactPositiveInteger(value, maximum) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new Error('OIDC_INTEGER_CLAIM_INVALID');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw new Error('OIDC_INTEGER_CLAIM_INVALID');
  return value;
}

export function validateGitHubOidcClaims(value, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!isRecord(value)) throw new Error('OIDC_CLAIMS_INVALID');
  const audience = value.aud;
  const audienceMatches = audience === githubOidcPolicy.audience ||
    (Array.isArray(audience) && audience.length === 1 && audience[0] === githubOidcPolicy.audience);
  if (!audienceMatches) throw new Error('OIDC_AUDIENCE_INVALID');
  if (value.iss !== githubOidcPolicy.issuer) throw new Error('OIDC_TOKEN_INVALID');
  if (value.repository !== githubOidcPolicy.repository || value.repository_id !== githubOidcPolicy.repositoryId ||
      value.repository_owner_id !== githubOidcPolicy.repositoryOwnerId) throw new Error('GITHUB_REPOSITORY_NOT_ALLOWED');
  if (value.workflow_ref !== githubOidcPolicy.workflowRef || value.ref !== githubOidcPolicy.ref ||
      !githubOidcPolicy.events.includes(value.event_name)) throw new Error('OIDC_TOKEN_INVALID');
  if (value.sub !== githubOidcPolicy.subject) throw new Error('OIDC_TOKEN_INVALID');
  if (!Number.isInteger(value.iat) || !Number.isInteger(value.exp) ||
      (value.nbf !== undefined && !Number.isInteger(value.nbf))) throw new Error('OIDC_TOKEN_INVALID');
  const iat = value.iat;
  const exp = value.exp;
  const nbf = value.nbf ?? iat;
  if (iat > nowSeconds + 60 || nbf > nowSeconds + 60 || exp < nowSeconds - 30 ||
      nowSeconds - iat > 600 || exp - iat > 600 || exp <= iat) throw new Error('OIDC_TOKEN_INVALID');
  exactPositiveInteger(value.run_id, Number.MAX_SAFE_INTEGER);
  exactPositiveInteger(value.run_attempt, 1000);
  return value;
}

export async function verifyGitHubOidcJwt(token, jwks, nowSeconds) {
  if (token.length < 100 || token.length > 16_384) throw new Error('OIDC_TOKEN_INVALID');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('OIDC_TOKEN_INVALID');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonSegment(encodedHeader);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(header.kid)) {
    throw new Error('OIDC_TOKEN_INVALID');
  }
  if (!isRecord(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 20) {
    throw new Error('OIDC_TOKEN_INVALID');
  }
  const key = jwks.keys.find((candidate) => isRecord(candidate) && candidate.kid === header.kid &&
    candidate.kty === 'RSA' && candidate.use === 'sig' && candidate.alg === 'RS256');
  if (!isRecord(key)) throw new Error('OIDC_TOKEN_INVALID');
  const imported = await crypto.subtle.importKey(
    'jwk', key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', imported, decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) throw new Error('OIDC_TOKEN_INVALID');
  return validateGitHubOidcClaims(parseJsonSegment(encodedPayload), nowSeconds);
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
