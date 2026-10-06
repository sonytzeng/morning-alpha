// Dedicated research identity. No shared Core Auth, JWT or service-role fallback.
export const SHADOW_AUTH_VERSION = '1';
export const SHADOW_TOKEN_ENV = 'SHADOW_ANALYSIS_WORKER_TOKEN';
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);

export function shadowWorkerHeaders(token, now = Date.now()) {
  if (!validToken(token) || !Number.isSafeInteger(now)) throw Error('SHADOW_CALLER_CONFIGURATION_INVALID');
  return { 'Content-Type': 'application/json', 'x-shadow-worker-token': token,
    'x-shadow-worker-version': SHADOW_AUTH_VERSION, 'x-shadow-worker-issued-at': String(now) };
}

export async function authorizeShadowWorker(headers, expectedToken, now = Date.now()) {
  const reject = (reason, stage) => ({ ok: false, reason, stage });
  // A server credential must not turn an Owner/member browser into a writer.
  // Node's server-side fetch also emits Sec-Fetch-Mode; it is NOT a browser identity.
  if (headers.has('origin') || headers.has('referer') || headers.has('sec-fetch-site'))
    return reject('AUTH_INVALID', 'SERVER_ONLY');
  if (!validToken(expectedToken)) return reject('AUTH_INVALID', 'WORKER_CONFIGURATION');
  const token = headers.get('x-shadow-worker-token');
  if (!token) return reject('AUTH_MISSING', 'DEDICATED_IDENTITY');
  if (!validToken(token)) return reject('AUTH_INVALID', 'DEDICATED_IDENTITY');
  if (headers.get('x-shadow-worker-version') !== SHADOW_AUTH_VERSION)
    return reject('AUTH_VERSION_MISMATCH', 'WORKER_VERSION');
  const issued = headers.get('x-shadow-worker-issued-at') || '';
  if (!/^\d{13}$/.test(issued)) return reject('AUTH_INVALID', 'REQUEST_TIME');
  const age = now - Number(issued);
  if (age < -30000 || age > 300000) return reject('AUTH_EXPIRED', 'REQUEST_TIME');
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a,b] = await Promise.all([digest(token),digest(expectedToken)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i=0;i<left.length;i++) difference |= left[i]^right[i];
  return difference === 0 ? {ok:true,reason:null,stage:'DEDICATED_IDENTITY'} : reject('AUTH_INVALID','DEDICATED_IDENTITY');
}

// V1 is explicitly manual Historical Replay only. No arbitrary operations/RPCs.
export function permittedShadowReplay(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const keys=Object.keys(input).sort();
  return JSON.stringify(keys) === JSON.stringify(['analysis_cutoff_at','business_date','observation_kind','operation'])
    && input.operation === 'ANALYZE' && input.observation_kind === 'HISTORICAL_REPLAY'
    && ['2026-09-30','2026-10-01','2026-10-02'].includes(input.business_date)
    && input.analysis_cutoff_at === input.business_date+'T07:30:00+08:00';
}
