/** GitHub OIDC -> fixed private staging RPCs. No review or publication capability.
 * Repository IDs were read from the connected GitHub repository on 2026-11-11.
 * The service credential stays inside this Edge Function's existing environment.
 */
export const MARKET_WORKER_POLICY = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  jwks_url: 'https://token.actions.githubusercontent.com/.well-known/jwks',
  audience: 'urn:morning-alpha:taiwan-market-worker-v2',
  repository: 'sonytzeng/morning-alpha', repository_id: '1274909964',
  repository_owner: 'sonytzeng', repository_owner_id: '279634487',
  ref: 'refs/heads/main',
  workflow_ref: 'sonytzeng/morning-alpha/.github/workflows/taiwan-market-daily.yml@refs/heads/main',
  subjects: Object.freeze(['repo:sonytzeng/morning-alpha:ref:refs/heads/main',
    'repo:sonytzeng@279634487/morning-alpha@1274909964:ref:refs/heads/main']),
  events: Object.freeze(['schedule', 'workflow_dispatch']),
  max_body_bytes: 80_000_000, max_response_bytes: 2_000_000,
});
export const MARKET_WORKER_RPCS = Object.freeze([
  'stage_daily_ai_market_capture_v2', 'stage_daily_ai_market_encoded_capture_v2',
  'stage_daily_ai_market_revenue_capture_v2', 'stage_daily_ai_market_public_capture_v2',
  'stage_daily_ai_market_work_plan_v2', 'stage_daily_ai_market_price_inputs_v2',
  'stage_daily_ai_market_price_input_chunk_v2', 'finalize_daily_ai_market_price_inputs_v2',
  'stage_daily_ai_market_price_references_v2', 'claim_daily_ai_market_shard_v2',
  'stage_daily_ai_market_shard_v2', 'stage_daily_ai_market_shard_with_references_v2',
  'finish_daily_ai_market_edition_v2',
  'get_daily_ai_market_worker_seed_manifest_v2', 'get_daily_ai_market_worker_seed_chunk_v2',
  'get_daily_ai_market_worker_checkpoint_v2', 'begin_daily_ai_market_worker_checkpoint_v2',
  'seal_daily_ai_market_worker_checkpoint_v2',
]);
const fail = code => { throw Error('MARKET_WORKER_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder();
function base64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail('TOKEN_ENCODING');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), ch => ch.charCodeAt(0));
}
function decodeJson(value) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64url(value))); }
async function boundedBytes(stream, limit) {
  if (!stream) fail('BODY_REQUIRED');
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) fail('BODY_LIMIT'); chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function verifyMarketWorkerToken(token, { jwks, now = Date.now() }) {
  if (typeof token !== 'string' || token.length < 100 || token.length > 16_000) fail('TOKEN');
  const parts = token.split('.'); if (parts.length !== 3) fail('TOKEN');
  const header = decodeJson(parts[0]), claims = decodeJson(parts[1]), policy = MARKET_WORKER_POLICY;
  if (!object(header) || header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string'
    || !/^[A-Za-z0-9_-]{1,200}$/.test(header.kid) || ['jku', 'x5u', 'jwk', 'crit'].some(key => Object.hasOwn(header, key))) fail('TOKEN_HEADER');
  if (!object(jwks) || !Array.isArray(jwks.keys) || jwks.keys.length > 32) fail('JWKS');
  const matches = jwks.keys.filter(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig'
    && (!key.alg || key.alg === 'RS256'));
  if (matches.length !== 1) fail('TOKEN_KEY');
  const jwk = matches[0];
  if (base64url(jwk.n).byteLength < 256 || jwk.e !== 'AQAB') fail('TOKEN_KEY');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64url(parts[2]), encoder.encode(parts[0] + '.' + parts[1]))) fail('TOKEN_SIGNATURE');
  const seconds = Math.floor(now / 1_000);
  if (!object(claims) || !['iat', 'nbf', 'exp'].every(key => Number.isSafeInteger(claims[key]))
    || claims.iat > seconds + 30 || claims.nbf > seconds + 30 || claims.exp <= seconds
    || claims.exp <= claims.iat || claims.exp - claims.iat > 600 || seconds - claims.iat > 600
    // nbf is a validity start, not token age. GitHub's documented example
    // backdates nbf by 600 seconds; age remains bounded by iat and exp above.
    // https://docs.github.com/en/actions/concepts/security/openid-connect
    || claims.nbf < 0 || claims.nbf > claims.exp) fail('TOKEN_TIME');
  for (const name of ['issuer', 'audience']) if (claims[name === 'issuer' ? 'iss' : 'aud'] !== policy[name]) fail('TOKEN_SCOPE');
  for (const name of ['repository', 'repository_id', 'repository_owner', 'repository_owner_id', 'ref', 'workflow_ref'])
    if (claims[name] !== policy[name]) fail('TOKEN_SCOPE');
  if (!policy.subjects.includes(claims.sub) || !policy.events.includes(claims.event_name)
    || claims.ref_type !== 'branch' || claims.runner_environment !== 'github-hosted'
    || claims.environment !== undefined || claims.job_workflow_ref !== undefined
    || !/^[a-f0-9]{40}$/.test(claims.sha ?? '') || claims.workflow_sha !== claims.sha
    || !/^\d+$/.test(claims.run_id ?? '') || !/^[1-9]\d*$/.test(claims.run_attempt ?? '')
    || typeof claims.jti !== 'string' || !claims.jti || claims.jti.length > 200) fail('TOKEN_SCOPE');
  return { repository_id: claims.repository_id, run_id: claims.run_id, run_attempt: claims.run_attempt, expires_at: claims.exp };
}

/** At most one bounded JWKS fetch per cache lifetime; unknown keys fail closed. */
export function createMarketWorkerGateway({ supabaseUrl, serviceRoleKey, fetchImpl = fetch, clock = () => Date.now() }) {
  if (supabaseUrl !== 'https://cttfzgvhiewfckydcrci.supabase.co' || typeof serviceRoleKey !== 'string' || !serviceRoleKey) fail('SERVER_CONFIG');
  let keyCache = null;
  const response = (status, code) => Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
  return async request => {
    const url = new URL(request.url), path = url.pathname.split('/').filter(Boolean), rpc = path.at(-1);
    if (request.method !== 'POST' || path.at(-2) !== 'taiwan-market-worker-v2' || !MARKET_WORKER_RPCS.includes(rpc)
      || url.search || request.headers.has('origin')) return response(403, 'MARKET_WORKER_ROUTE');
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
      || !['', 'identity'].includes(request.headers.get('content-encoding') ?? '')) return response(415, 'MARKET_WORKER_CONTENT_TYPE');
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MARKET_WORKER_POLICY.max_body_bytes)) return response(413, 'MARKET_WORKER_BODY_LIMIT');
    try {
      const authorization = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get('authorization') ?? '');
      if (!authorization) return response(401, 'MARKET_WORKER_UNAUTHORIZED');
      if (!keyCache || keyCache.expires <= clock()) {
        const loaded = await fetchImpl(MARKET_WORKER_POLICY.jwks_url, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
        if (!loaded.ok) return response(503, 'MARKET_WORKER_KEY_SERVICE_UNAVAILABLE');
        const bytes = await boundedBytes(loaded.body, 128_000);
        keyCache = { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), expires: clock() + 300_000 };
      }
      await verifyMarketWorkerToken(authorization[1], { jwks: keyCache.value, now: clock() });
    } catch { return response(401, 'MARKET_WORKER_UNAUTHORIZED'); }
    if (!request.body) return response(400, 'MARKET_WORKER_BODY_REQUIRED');
    // Stream the already authenticated request. The SQL function validates its
    // complete JSON/bytes before the transaction can write any private rows.
    const reader = request.body.getReader(); let total = 0, released = false;
    const release = () => { if (!released) { released = true; reader.releaseLock(); } };
    const cancelSource = async reason => {
      if (released) return;
      try { await reader.cancel(reason); } catch { /* Preserve the upstream outcome. */ }
      finally { release(); }
    };
    const body = new ReadableStream({
      async pull(controller) {
        try { const { value, done } = await reader.read();
          if (done) { controller.close(); release(); return; }
          total += value.byteLength;
          if (total > MARKET_WORKER_POLICY.max_body_bytes) { await cancelSource('BODY_LIMIT'); fail('BODY_LIMIT'); }
          controller.enqueue(value);
        } catch (error) { await cancelSource(error); controller.error(error); }
      },
      async cancel(reason) { await cancelSource(reason); },
    });
    try {
      const upstream = await fetchImpl(supabaseUrl + '/rest/v1/rpc/' + rpc, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey },
        body, duplex: 'half', signal: AbortSignal.timeout(85_000) });
      const bytes = await boundedBytes(upstream.body, MARKET_WORKER_POLICY.max_response_bytes);
      if (!upstream.ok) {
        let error; try { error = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* No raw server HTML. */ }
        return Response.json({ code: typeof error?.code === 'string' ? error.code.slice(0,80) : 'MARKET_WORKER_UPSTREAM_ERROR',
          message: typeof error?.message === 'string' ? error.message.slice(0,512) : 'MARKET_WORKER_UPSTREAM_ERROR' },
        { status: upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502, headers: { 'Cache-Control': 'no-store' } });
      }
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    } catch { return response(504, 'MARKET_WORKER_ACKNOWLEDGEMENT_UNKNOWN'); }
    finally { await cancelSource('UPSTREAM_FINISHED'); }
  };
}
