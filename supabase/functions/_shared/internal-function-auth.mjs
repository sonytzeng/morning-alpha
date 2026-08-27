function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export const INTERNAL_AUTH_ERROR_CODES = Object.freeze({
  MISSING: 'INTERNAL_AUTH_MISSING',
  INVALID: 'INTERNAL_AUTH_INVALID',
  EXPIRED: 'INTERNAL_AUTH_EXPIRED',
  VERSION_MISMATCH: 'INTERNAL_AUTH_VERSION_MISMATCH',
});

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export async function constantTimeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash[index] ^ rightHash[index];
  return difference === 0;
}

function headerValue(headers, name) {
  return headers && typeof headers.get === 'function' ? (headers.get(name) || '').trim() : '';
}

export function parseBearerAuthorizationHeader(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, token: null, error_code: INTERNAL_AUTH_ERROR_CODES.MISSING };
  const match = raw.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !present(match[1])) {
    return { ok: false, token: null, error_code: INTERNAL_AUTH_ERROR_CODES.INVALID };
  }
  return { ok: true, token: match[1], error_code: null };
}

function parseExpiry(value) {
  if (!present(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function authorizeInternalRequest(headers, credentials = {}, now = new Date()) {
  let presented = headerValue(headers, 'x-cron-secret');
  if (!presented) {
    const authorization = headerValue(headers, 'authorization');
    if (authorization) {
      const parsed = parseBearerAuthorizationHeader(authorization);
      if (!parsed.ok) return { ok: false, credential: null, version: String(credentials.version || 'v1'), error_code: parsed.error_code };
      presented = parsed.token || '';
    }
  }
  const presentedVersion = headerValue(headers, 'x-internal-auth-version');
  const expectedVersion = String(credentials.version || 'v1');
  if (!presented) {
    const apiKey = headerValue(headers, 'apikey');
    if (present(credentials.serviceRoleKey) && apiKey && await constantTimeEqual(apiKey, credentials.serviceRoleKey)) {
      return { ok: true, credential: 'service_role', version: expectedVersion, error_code: null };
    }
    return { ok: false, credential: null, version: expectedVersion, error_code: INTERNAL_AUTH_ERROR_CODES.MISSING };
  }
  if (presentedVersion && presentedVersion !== expectedVersion) {
    return { ok: false, credential: null, version: expectedVersion, error_code: INTERNAL_AUTH_ERROR_CODES.VERSION_MISMATCH };
  }
  if (present(credentials.currentToken) && await constantTimeEqual(presented, credentials.currentToken)) {
    return { ok: true, credential: 'current', version: expectedVersion, error_code: null };
  }
  if (present(credentials.previousToken) && await constantTimeEqual(presented, credentials.previousToken)) {
    const expiresAt = parseExpiry(credentials.previousExpiresAt);
    if (expiresAt === null || now.getTime() >= expiresAt) {
      return { ok: false, credential: 'previous', version: expectedVersion, error_code: INTERNAL_AUTH_ERROR_CODES.EXPIRED };
    }
    return { ok: true, credential: 'previous', version: expectedVersion, error_code: null };
  }
  return { ok: false, credential: null, version: expectedVersion, error_code: INTERNAL_AUTH_ERROR_CODES.INVALID };
}

export function internalCredentialsFromEnv(env = Deno.env) {
  return {
    currentToken: env.get('CRON_SECRET') || '',
    previousToken: env.get('CRON_SECRET_PREVIOUS') || '',
    previousExpiresAt: env.get('CRON_SECRET_PREVIOUS_EXPIRES_AT') || '',
    version: env.get('INTERNAL_AUTH_VERSION') || 'v1',
    serviceRoleKey: env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  };
}

export function buildInternalFunctionHeaders({ cronSecret, serviceRoleKey, source, version } = {}) {
  const runtimeVersion = present(version)
    ? version
    : typeof Deno !== 'undefined'
      ? Deno.env.get('INTERNAL_AUTH_VERSION') || 'v1'
      : 'v1';
  const headers = { 'Content-Type': 'application/json' };
  if (present(cronSecret)) headers['x-cron-secret'] = cronSecret;
  // Supabase opaque and legacy API keys belong in `apikey`, not in
  // `Authorization: Bearer ...`. This keeps service-to-service calls compatible
  // with both key formats while the target function retains its own auth guard.
  if (present(serviceRoleKey)) headers.apikey = serviceRoleKey;
  headers['x-internal-auth-version'] = runtimeVersion;
  if (present(source)) headers['x-internal-call-source'] = source;
  return headers;
}
