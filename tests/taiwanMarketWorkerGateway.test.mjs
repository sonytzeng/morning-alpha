// SYNTHETIC signing key and RPC responses. No production request or credential.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { MARKET_WORKER_POLICY as policy, MARKET_WORKER_RPCS, verifyMarketWorkerToken,
  createMarketWorkerGateway } from '../supabase/functions/_shared/taiwan-market-worker-gateway.mjs';
import { createTaiwanMarketOidcRpc } from '../scripts/operations/taiwan-market-oidc-rpc.mjs';

const now = Date.parse('2026-11-11T11:10:00Z'), second = now / 1_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'SYNTHETIC-KEY', alg: 'RS256', use: 'sig' }] };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(overrides = {}, header = {}) {
  const payload = { iss: policy.issuer, aud: policy.audience, sub: policy.subjects[0], iat: second - 10,
    nbf: second - 10, exp: second + 290, jti: 'SYNTHETIC-JTI', repository: policy.repository,
    repository_id: policy.repository_id, repository_owner: policy.repository_owner,
    repository_owner_id: policy.repository_owner_id, ref: policy.ref, workflow_ref: policy.workflow_ref,
    event_name: 'schedule', ref_type: 'branch', runner_environment: 'github-hosted',
    sha: 'a'.repeat(40), workflow_sha: 'a'.repeat(40), run_id: '12345', run_attempt: '1', ...overrides };
  const text = encode({ alg: 'RS256', typ: 'JWT', kid: 'SYNTHETIC-KEY', ...header }) + '.' + encode(payload);
  return text + '.' + sign('RSA-SHA256', Buffer.from(text), privateKey).toString('base64url');
}
const verify = value => verifyMarketWorkerToken(value, { jwks, now });
function request(jwt = token(), rpc = MARKET_WORKER_RPCS[0], extra = {}) {
  return new Request('https://example.invalid/functions/v1/taiwan-market-worker-v2/' + rpc, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt, ...(extra.headers ?? {}) },
    body: extra.body ?? '{"synthetic":true}',
  });
}
function gateway(fetchImpl) { return createMarketWorkerGateway({ supabaseUrl: 'https://cttfzgvhiewfckydcrci.supabase.co',
  serviceRoleKey: 'SYNTHETIC_SERVER_ONLY_KEY', fetchImpl, clock: () => now }); }

test('checkpoint capability is three fixed RPCs behind the same main-only OIDC gate, never direct keys or tables', async () => {
  const names = ['get_daily_ai_market_worker_checkpoint_v2', 'begin_daily_ai_market_worker_checkpoint_v2',
    'seal_daily_ai_market_worker_checkpoint_v2'];
  assert.deepEqual(MARKET_WORKER_RPCS.filter(name => name.includes('worker_checkpoint')), names);
  let calls = 0;
  const handler = gateway(async url => { if (url === policy.jwks_url) return Response.json(jwks);
    calls++; return Response.json({ synthetic: true }); });
  for (const name of names) {
    assert.equal((await handler(request(token(), name))).status, 200);
    assert.equal((await handler(request(token({ event_name: 'pull_request' }), name))).status, 401);
    assert.equal((await handler(request(token({ repository_id: '1' }), name))).status, 401);
  }
  for (const name of ['worker_checkpoints', 'get_checkpoint_key', 'delete_daily_ai_market_worker_checkpoint_v2'])
    assert.equal((await handler(request(token(), name))).status, 403);
  assert.equal(calls, 3);
});

test('OIDC seed capability contains exactly the two private readers and never upload/finalize', async () => {
  const readers = ['get_daily_ai_market_worker_seed_manifest_v2', 'get_daily_ai_market_worker_seed_chunk_v2'];
  assert.deepEqual(MARKET_WORKER_RPCS.filter(name => name.includes('worker_seed')), readers);
  const forwarded = [], handler = gateway(async url => {
    if (url === policy.jwks_url) return Response.json(jwks);
    forwarded.push(String(url)); return Response.json({ synthetic: true });
  });
  for (const name of readers) assert.equal((await handler(request(token(), name))).status, 200);
  assert.equal(forwarded.length, 2);
  for (const name of ['stage_daily_ai_market_worker_seed_v2', 'stage_daily_ai_market_worker_seed_chunk_v2', 'finalize_daily_ai_market_worker_seed_v2'])
    assert.equal((await handler(request(token(), name))).status, 403);
  assert.equal(forwarded.length, 2);
});

test('verified repository IDs, main, workflow and short-lived RSA signature accept both exact GitHub subject formats', async () => {
  for (const sub of policy.subjects) assert.deepEqual(await verify(token({ sub })), {
    repository_id: policy.repository_id, run_id: '12345', run_attempt: '1', expires_at: second + 290 });
});
test('forks, renamed-owner IDs, wrong audience, pull requests, tags and different workflows fail closed', async () => {
  for (const changes of [{ repository_id: '1' }, { repository_owner_id: '1' }, { repository: 'fork/morning-alpha' },
    { sub: 'repo:fork/morning-alpha:ref:refs/heads/main' }, { aud: 'wrong' }, { iss: 'https://evil.invalid' },
    { ref: 'refs/heads/feature' }, { ref_type: 'tag' }, { workflow_ref: policy.workflow_ref.replace('daily.yml', 'other.yml') },
    { event_name: 'pull_request' }, { event_name: 'pull_request_target' }, { runner_environment: 'self-hosted' },
    { workflow_sha: 'b'.repeat(40) }, { job_workflow_ref: policy.workflow_ref }, { environment: 'production' }])
    await assert.rejects(verify(token(changes)), /TOKEN_SCOPE/);
});
test('expired, future, excessive lifetime and invalid signature tokens are rejected', async () => {
  for (const changes of [{ exp: second }, { iat: second + 31 }, { nbf: second + 31 }, { exp: second + 601 }, { iat: second - 601 }])
    await assert.rejects(verify(token(changes)), /TOKEN_TIME/);
  const jwt = token().split('.'); jwt[1] = encode({ exp: second + 300 });
  await assert.rejects(verify(jwt.join('.')), /TOKEN_SIGNATURE/);
});
test('GitHub documented backdated nbf is accepted without relaxing iat age, expiry or not-before', async () => {
  // GitHub's official sample has iat=1632493567 and nbf=1632492967.
  assert.equal((await verify(token({ nbf: second - 610 }))).expires_at, second + 290);
  for (const changes of [{ nbf: -1 }, { nbf: second + 31 }, { iat: second - 601, nbf: second - 1201 }])
    await assert.rejects(verify(token(changes)), /TOKEN_TIME/);
});
test('algorithm confusion, token-supplied keys and ambiguous JWKS cannot redirect trust', async () => {
  for (const header of [{ alg: 'none' }, { alg: 'HS256' }, { jku: 'https://evil.invalid/keys' }, { jwk: jwks.keys[0] }, { crit: ['extra'] }])
    await assert.rejects(verify(token({}, header)), /TOKEN_HEADER/);
  await assert.rejects(verify(token({}, { kid: 'unknown' })), /TOKEN_KEY/);
  await assert.rejects(verifyMarketWorkerToken(token(), { jwks: { keys: [...jwks.keys, ...jwks.keys] }, now }), /TOKEN_KEY/);
});
test('gateway streams only an allowlisted private RPC and replaces client authorization with the existing server credential', async () => {
  const calls = [], handler = gateway(async (url, init) => {
    calls.push({ url: String(url), init });
    if (url === policy.jwks_url) return Response.json(jwks);
    assert.equal(init.headers.Authorization, 'Bearer SYNTHETIC_SERVER_ONLY_KEY');
    assert.equal(await new Response(init.body).text(), '{"synthetic":true}');
    return Response.json({ schema: 'SYNTHETIC_RECEIPT', replayed: false });
  });
  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 200);
  assert.equal(calls.filter(c => c.url === policy.jwks_url).length, 1);
  assert.ok(calls.filter(c => c.url !== policy.jwks_url).every(c => c.url === 'https://cttfzgvhiewfckydcrci.supabase.co/rest/v1/rpc/' + MARKET_WORKER_RPCS[0]));
});
test('unauthenticated requests, owner approval, review writes and arbitrary URLs never reach PostgREST', async () => {
  let upstream = 0;
  const handler = gateway(async url => { if (url === policy.jwks_url) return Response.json(jwks); upstream++; throw Error('UNEXPECTED'); });
  for (const name of ['review_daily_ai_market_edition_v2', 'stage_daily_ai_market_review_v2',
    'submit_daily_ai_owner_market_review_v2', 'delete_reports', 'rpc']) assert.equal((await handler(request(token(), name))).status, 403);
  assert.equal((await handler(request('invalid'))).status, 401);
  assert.equal((await handler(request(token(), MARKET_WORKER_RPCS[0], { headers: { origin: 'https://evil.invalid' } }))).status, 403);
  assert.equal(upstream, 0);
});
test('oversized and compressed bodies are refused before fetching keys; upstream unknown outcomes remain unknown', async () => {
  let calls = 0; const handler = gateway(async () => { calls++; throw Error('UNEXPECTED'); });
  assert.equal((await handler(request(token(), MARKET_WORKER_RPCS[0], { headers: { 'content-length': String(policy.max_body_bytes + 1) } }))).status, 413);
  assert.equal((await handler(request(token(), MARKET_WORKER_RPCS[0], { headers: { 'content-encoding': 'gzip' } }))).status, 415);
  assert.equal(calls, 0);
  const unknown = gateway(async url => { if (url === policy.jwks_url) return Response.json(jwks); throw Error('SYNTHETIC_LOST_ACK'); });
  assert.equal((await unknown(request())).status, 504);
});
test('key-service redirect/errors fail without a retry or private data request', async () => {
  let calls = 0; const handler = gateway(async () => { calls++; return new Response('unavailable', { status: 503 }); });
  assert.equal((await handler(request())).status, 503); assert.equal(calls, 1);
});
test('GitHub adapter caches an expiring OIDC token, retains SQL rejection and never reads a service key', async () => {
  const calls = [], env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: policy.repository, GITHUB_REF: policy.ref,
    GITHUB_EVENT_NAME: 'schedule', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://vstoken.actions.githubusercontent.com/SYNTHETIC?api-version=2',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'SYNTHETIC_RUNNER_REQUEST_TOKEN' };
  const rpc = createTaiwanMarketOidcRpc({ env, clock: () => now, fetchImpl: async (url, init) => {
    calls.push(String(url));
    if (String(url).startsWith('https://vstoken.')) { assert.equal(new URL(url).searchParams.get('audience'), policy.audience); return Response.json({ value: token() }); }
    assert.equal(init.headers.Authorization, 'Bearer ' + token());
    return Response.json({ code: 'P0001', message: 'MARKET_SYNTHETIC_REJECTION' }, { status: 400 });
  } });
  const result = await rpc(MARKET_WORKER_RPCS[0], { synthetic: true });
  assert.equal(result.error.code, 'P0001'); await rpc(MARKET_WORKER_RPCS[0], { synthetic: true });
  assert.equal(calls.length, 3);
  await assert.rejects(rpc('stage_daily_ai_market_review_v2', {}), /RPC_SCOPE/); assert.equal(calls.length, 3);
});
test('adapter cannot run in a PR or locally and rejects runner-token endpoint substitution before network', async () => {
  const base = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: policy.repository, GITHUB_REF: policy.ref, GITHUB_EVENT_NAME: 'schedule' };
  for (const env of [{}, { ...base, GITHUB_EVENT_NAME: 'pull_request' }, { ...base,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://evil.invalid', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'SYNTHETIC' }]) {
    const rpc = createTaiwanMarketOidcRpc({ env, fetchImpl: async () => { throw Error('UNEXPECTED_NETWORK'); } });
    await assert.rejects(rpc(MARKET_WORKER_RPCS[0], {}), /ACTIONS_SCOPE|ACTIONS_TOKEN_ENDPOINT/);
  }
});

test('chunked request crossing the real byte limit is canceled and remains an unknown acknowledgement', async () => {
  let canceled = false, transferred = 0;
  // Reuse one buffer; do not allocate an 80 MB synthetic request string.
  const chunk = new Uint8Array(1_000_000);
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(chunk); }, cancel() { canceled = true; } });
  const handler = gateway(async (url, init) => {
    if (url === policy.jwks_url) return Response.json(jwks);
    const reader = init.body.getReader();
    try { for (;;) { const {value,done} = await reader.read(); if(done)break; transferred += value.byteLength; } }
    finally { reader.releaseLock(); }
    return Response.json({ unexpected: true });
  });
  const req = new Request('https://example.invalid/functions/v1/taiwan-market-worker-v2/' + MARKET_WORKER_RPCS[0], {
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token()},body:stream,duplex:'half',
  });
  const response = await handler(req);
  assert.equal(response.status,504);assert.equal((await response.json()).code,'MARKET_WORKER_ACKNOWLEDGEMENT_UNKNOWN');
  assert.equal(transferred,policy.max_body_bytes);assert.equal(canceled,true);assert.equal(stream.locked,false);
});
test('an early upstream rejection cancels the unread request and releases its reader', async () => {
  let canceled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([123])); }, cancel() { canceled = true; } });
  const handler = gateway(async url => url===policy.jwks_url?Response.json(jwks):Response.json({code:'P0001',message:'MARKET_SYNTHETIC_REJECT'},{status:400}));
  const req = new Request('https://example.invalid/functions/v1/taiwan-market-worker-v2/' + MARKET_WORKER_RPCS[0], {
    method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token()},body:stream,duplex:'half',
  });
  assert.equal((await handler(req)).status,400);assert.equal(canceled,true);assert.equal(stream.locked,false);
});
test('adapter bounds actual token and RPC response streams before full text allocation', async () => {
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:policy.repository,GITHUB_REF:policy.ref,GITHUB_EVENT_NAME:'schedule',
    ACTIONS_ID_TOKEN_REQUEST_URL:'https://vstoken.actions.githubusercontent.com/SYNTHETIC',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'SYNTHETIC'};
  for(const stage of ['TOKEN','RPC']){
    let canceled=false,reads=0,calls=0;const chunk=new Uint8Array(stage==='TOKEN'?16001:1_000_001);
    const stream=new ReadableStream({pull(controller){reads++;controller.enqueue(chunk);},cancel(){canceled=true;}});
    const rpc=createTaiwanMarketOidcRpc({env,clock:()=>now,fetchImpl:async url=>{
      calls++;if(String(url).startsWith('https://vstoken.')&&stage==='RPC')return Response.json({value:token()});return new Response(stream);
    }});
    await assert.rejects(rpc(MARKET_WORKER_RPCS[0],{}),stage==='TOKEN'?/ACTIONS_TOKEN_SIZE/:/RPC_RESPONSE_SIZE/);
    assert.equal(canceled,true);assert(reads<=3);assert.equal(calls,stage==='TOKEN'?1:2);assert.equal(stream.locked,false);
  }
});
