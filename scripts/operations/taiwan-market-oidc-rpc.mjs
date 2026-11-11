/** Server-side GitHub Actions adapter. Does not read a Supabase service key. */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { MARKET_WORKER_POLICY, MARKET_WORKER_RPCS } from '../../supabase/functions/_shared/taiwan-market-worker-gateway.mjs';

const endpoint = 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/taiwan-market-worker-v2';
const fail = code => { throw Error('TAIWAN_MARKET_OIDC_' + code); };
async function boundedText(stream, limit, code) {
  if (!stream) fail(code);
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) fail(code); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function createTaiwanMarketOidcRpc({ env = process.env, fetchImpl = fetch, clock = () => Date.now() } = {}) {
  let cached = null;
  return async (name, args) => {
    if (!MARKET_WORKER_RPCS.includes(name) || args === null || typeof args !== 'object' || Array.isArray(args)) fail('RPC_SCOPE');
    if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== MARKET_WORKER_POLICY.repository
      || env.GITHUB_REF !== MARKET_WORKER_POLICY.ref || !MARKET_WORKER_POLICY.events.includes(env.GITHUB_EVENT_NAME)) fail('ACTIONS_SCOPE');
    if (!cached || cached.expires <= clock() + 60_000) {
      const request = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL ?? 'https://invalid.invalid');
      if (request.protocol !== 'https:' || request.username || request.password || request.port
        || !request.hostname.endsWith('.actions.githubusercontent.com') || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) fail('ACTIONS_TOKEN_ENDPOINT');
      request.searchParams.set('audience', MARKET_WORKER_POLICY.audience);
      const response = await fetchImpl(request, { headers: { Authorization: 'Bearer ' + env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
        redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) fail('ACTIONS_TOKEN_UNAVAILABLE');
      const text = await boundedText(response.body, 32_000, 'ACTIONS_TOKEN_SIZE');
      const token = JSON.parse(text).value;
      if (typeof token !== 'string' || token.length > 16_000 || token.split('.').length !== 3) fail('ACTIONS_TOKEN');
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (!Number.isSafeInteger(claims.exp) || claims.exp * 1_000 <= clock() + 30_000 || claims.aud !== MARKET_WORKER_POLICY.audience) fail('ACTIONS_TOKEN_TIME');
      cached = { token, expires: claims.exp * 1_000 };
    }
    const text = JSON.stringify(args); if (Buffer.byteLength(text) > MARKET_WORKER_POLICY.max_body_bytes) fail('RPC_BODY_SIZE');
    const response = await fetchImpl(endpoint + '/' + name, { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + cached.token, 'Content-Type': 'application/json' }, body: text,
      signal: AbortSignal.timeout(90_000) });
    const output = await boundedText(response.body, MARKET_WORKER_POLICY.max_response_bytes, 'RPC_RESPONSE_SIZE');
    const body = JSON.parse(output);
    if (!response.ok) return { data: null, error: { code: String(body.code ?? 'TRANSPORT_ERROR'), message: String(body.message ?? body.code ?? 'TRANSPORT_ERROR') } };
    return { data: body, error: null };
  };
}
export const rpc = createTaiwanMarketOidcRpc();
