import { constantTimeEqual } from '../_shared/internal-function-auth.mjs';

export const SMOKE_TOKEN_ENV = 'RECOMMENDATION_SMOKE_WORKER_TOKEN';
const valid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Additional machine identity; deployed gateway JWT validation stays enabled.
 * No Core token, service-role, Owner or member identity fallback. The token is
 * never forwarded to the stock producer or to an official market-data source. */
export async function authorizeSmokeWorker(headers: Headers, expected: string, now: number) {
  const deny = (stage: string) => ({ ok: false, error_code: 'SMOKE_WORKER_AUTH_DENIED', stage });
  if (headers.has('origin') || headers.has('referer') || headers.has('sec-fetch-site')) return deny('SERVER_ONLY');
  if (!valid(expected)) return deny('WORKER_CONFIGURATION');
  const token = headers.get('x-recommendation-smoke-token');
  if (!valid(token)) return deny('DEDICATED_IDENTITY');
  if (headers.get('x-recommendation-smoke-version') !== '1') return deny('WORKER_VERSION');
  const issued = headers.get('x-recommendation-smoke-issued-at') || '';
  if (!/^\d{13}$/.test(issued) || !Number.isFinite(now) || now - Number(issued) > 300000 || now - Number(issued) < -30000) return deny('REQUEST_TIME');
  return await constantTimeEqual(token, expected)
    ? { ok: true, error_code: null, stage: 'DEDICATED_IDENTITY' }
    : deny('DEDICATED_IDENTITY');
}
