// Entry-only M2M identity. Gateway JWT remains independently enforced.
// Never send the secret itself; bind a short-lived HMAC to this worker and body.
export const ENTRY_WORKER_SECRET = 'ENTRY_OPPORTUNITY_WORKER_TOKEN';
export const ENTRY_WORKER_AUDIENCE = 'entry-opportunity-shadow-v1';
export const ENTRY_AUTH_VERSION = '1';
const encoder = new TextEncoder();
const validSecret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
async function key(secret, usage) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, [usage]);
}
async function message(body, issued) {
  const hash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  return encoder.encode(`ENTRY_WORKER_V${ENTRY_AUTH_VERSION}\n${ENTRY_WORKER_AUDIENCE}\nPOST\n${issued}\n${hash}`);
}
export async function entryWorkerHeaders(secret, body, now = Date.now()) {
  if (!validSecret(secret) || typeof body !== 'string' || !Number.isSafeInteger(now)) throw Error('ENTRY_CALLER_CONFIG_INVALID');
  const issued = String(now);
  const signature = hex(await crypto.subtle.sign('HMAC', await key(secret, 'sign'), await message(body, issued)));
  return {'Content-Type':'application/json', 'x-entry-worker-version':ENTRY_AUTH_VERSION,
    'x-entry-worker-issued-at':issued, 'x-entry-worker-signature':signature};
}
export async function authorizeEntryWorker(headers, body, expected, now = Date.now()) {
  const deny = reason => ({ok:false, reason});
  if (headers.has('origin') || headers.has('referer') || headers.has('sec-fetch-site')) return deny('ENTRY_SERVER_ONLY');
  if (!validSecret(expected)) return deny('ENTRY_WORKER_UNCONFIGURED');
  const signature = headers.get('x-entry-worker-signature');
  if (!signature) return deny('ENTRY_AUTH_MISSING');
  if (!/^[a-f0-9]{64}$/.test(signature) || headers.get('x-entry-worker-version') !== ENTRY_AUTH_VERSION) return deny('ENTRY_AUTH_INVALID');
  const issued = headers.get('x-entry-worker-issued-at') || '';
  if (!/^\d{13}$/.test(issued) || !Number.isSafeInteger(now)) return deny('ENTRY_AUTH_INVALID');
  const age = now - Number(issued);
  if (age < -30000 || age > 300000) return deny('ENTRY_AUTH_EXPIRED');
  const bytes = Uint8Array.from(signature.match(/../g), x => parseInt(x,16));
  // WebCrypto HMAC verification avoids a variable-time string comparison.
  return await crypto.subtle.verify('HMAC', await key(expected, 'verify'), bytes, await message(body, issued))
    ? {ok:true, reason:null} : deny('ENTRY_AUTH_INVALID');
}
