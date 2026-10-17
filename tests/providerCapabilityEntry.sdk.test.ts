// Actual candidate index + pinned Supabase SDK 2.115.0, SYNTHETIC HTTP only.
// Run: deno test --no-config --no-lock --cached-only --allow-read this-file
// No --allow-net/--allow-env, real env lookup, Auth/Storage/provider E2E or
// deployment/entitlement/formal-Auth approval is exercised or claimed here.

const PROJECT = 'https://cttfzgvhiewfckydcrci.supabase.co';
const ORIGIN = 'https://morningalphatw.com';
const BUCKET = 'v1-provider-capability-review-20261017';
const MARKER = 'once.json';
const ENTRY_PATH = '/functions/v1/v1-provider-capability-review-v1';
const ANON = 'synthetic-anon-not-a-real-credential';
const SERVICE = 'synthetic-service-not-a-real-credential';
const JWT = 'synthetic.owner.signature';
const PROVIDER_TOKEN = 'SYNTHETIC_PROVIDER_KEY_NOT_REAL_123';
const PRIVATE = 'SYNTHETIC_PRIVATE_RESPONSE_MUST_NOT_ESCAPE';
const UID = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-10-17T00:00:00Z');
const AUTH = 'GET /auth/v1/user';
const OWNER = 'POST /rest/v1/rpc/is_research_owner_v1';
const BUCKET_READ = 'GET /storage/v1/bucket/' + BUCKET;
const LIST = 'POST /storage/v1/object/list/' + BUCKET;
const UPLOAD = 'POST /storage/v1/object/' + BUCKET + '/' + MARKER;
const PROVIDERS = Object.freeze([
  'https://finnhub.io/api/v1/search?q=2330',
  'https://finnhub.io/api/v1/stock/eps-estimate?symbol=2330.TW&freq=quarterly',
  'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=2330.TW&freq=quarterly',
  'https://finnhub.io/api/v1/search?q=6488',
  'https://finnhub.io/api/v1/stock/eps-estimate?symbol=6488.TWO&freq=quarterly',
  'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=6488.TWO&freq=quarterly',
]);

function assert(value: unknown, message = 'synthetic SDK contract assertion failed'): asserts value {
  // Never format actual values: headers/SDK error values may contain canaries.
  if (!value) throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected safe response object');
  return value as Record<string, unknown>;
}
function same(actual: unknown, expected: unknown, message: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}
const json = (body: unknown, status = 200) => Response.json(body, {status});
type Handler = (request: Request) => Promise<Response>;
type Trace = {operation: string; provider: boolean; signal: AbortSignal};
type Options = {
  projectUrl?: string;
  authStatus?: number; authPayload?: unknown;
  ownerStatus?: number; ownerPayload?: unknown;
  bucketStatus?: number; bucketPayload?: unknown;
  listStatus?: number; listPayload?: unknown;
  uploadStatus?: number;
  providerStatus?: number; providerPayload?: unknown; providerThrows?: boolean;
};
type Harness = {handle: Handler; trace: Trace[]; envReads: string[]};
let sequence = 0;
function syntheticTest(name: string, fn: () => Promise<void>) {
  // Grant no network/env permissions per case, independently of the CI command.
  // Plain --allow-read is sufficient; native network/env access is never granted.
  Deno.test({name, permissions: {read: 'inherit', net: false, env: false}, fn});
}

function providerPayload(target: string) {
  const url = new URL(target);
  if (url.pathname === '/api/v1/search') {
    const symbol = url.searchParams.get('q') === '2330' ? '2330.TW' : '6488.TWO';
    return {count: 1, result: [{symbol, displaySymbol: symbol, description: PRIVATE,
      type: 'Common Stock', private_metadata: PROVIDER_TOKEN}]};
  }
  const metric = url.pathname.includes('/eps-') ? 'eps' : 'revenue';
  return {symbol: url.searchParams.get('symbol'), freq: 'quarterly', data: [1, 2, 3, 4].map(quarter => ({
    year: 2025, quarter, period: ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'][quarter - 1],
    [metric + 'Avg']: 10, [metric + 'Low']: 8, [metric + 'High']: 12,
    numberAnalysts: 3, revision: PRIVATE,
  }))};
}

// Tests are intentionally sequential: each case owns/restores all global stubs.
// The query changes only the LOCAL index identity, not the remote SDK URL/cache.
async function withEntry(options: Options, run: (h: Harness) => Promise<void>) {
  const nativeFetch = globalThis.fetch, nativeGet = Deno.env.get, nativeServe = Deno.serve;
  const nativeNow = Date.now;
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originalConsole = consoleMethods.map(name => console[name]);
  const trace: Trace[] = [], envReads: string[] = [], violations: string[] = [];
  const expectedProviderFailure = new Error(PRIVATE + PROVIDER_TOKEN);
  let handler: Handler | undefined, served = 0, consoleCalls = 0;
  const rejectTransport = () => {
    violations.push('UNAPPROVED_SYNTHETIC_HTTP_OPERATION');
    throw new Error('UNAPPROVED_SYNTHETIC_HTTP_OPERATION');
  };
  try {
    for (const name of consoleMethods) console[name] = () => {consoleCalls++;};
    Date.now = () => NOW;
    // No fallback to nativeGet, including unknown SDK environment names.
    Deno.env.get = (name: string) => {
      envReads.push(name);
      const values: Record<string, string> = {
        SUPABASE_URL: options.projectUrl ?? PROJECT,
        SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
        FINNHUB_API_KEY: PROVIDER_TOKEN,
      };
      return values[name] ?? 'SYNTHETIC_UNUSED_ENV_VALUE';
    };
    Deno.serve = ((candidate: Handler) => {
      assert(typeof candidate === 'function', 'entry must register its actual handler');
      handler = candidate; served++;
      return {};
    }) as typeof Deno.serve;
    globalThis.fetch = async (input, init) => {try {
      const request = new Request(input, init), url = new URL(request.url);
      assert(!request.signal.aborted, 'transport started after abort');
      assert(init?.redirect === 'error', 'all transports must prohibit redirects');
      const operation = request.method + ' ' + url.pathname;
      if (url.origin === PROJECT) {
        if (url.search || url.hash || ![AUTH, OWNER, BUCKET_READ, LIST, UPLOAD].includes(operation)) rejectTransport();
        const userOperation = operation === AUTH || operation === OWNER;
        assert(request.headers.get('apikey') === (userOperation ? ANON : SERVICE), 'SDK credential class crossed boundary');
        assert(request.headers.get('authorization') === 'Bearer ' + (userOperation ? JWT : SERVICE), 'SDK authorization crossed boundary');
        assert(!request.headers.has('X-Finnhub-Token'), 'provider credential reached project transport');
        assert(init?.cache === 'no-store', 'SDK transport must not cache');
        trace.push({operation, provider: false, signal: request.signal});
        if (operation === AUTH) {
          if (options.authStatus) return json({code: 'bad_jwt', message: PRIVATE + JWT}, options.authStatus);
          return json(Object.hasOwn(options, 'authPayload') ? options.authPayload : {
            id: UID, aud: 'authenticated', app_metadata: {}, user_metadata: {owner: true},
            created_at: '2026-01-01T00:00:00Z',
          });
        }
        if (operation === OWNER) {
          assert(await request.text() === '{}', 'Owner predicate must have no caller identity argument');
          if (options.ownerStatus) return json({message: PRIVATE + JWT}, options.ownerStatus);
          return json(Object.hasOwn(options, 'ownerPayload') ? options.ownerPayload : true);
        }
        if (operation === BUCKET_READ) {
          if (options.bucketStatus) return json({message: PRIVATE + SERVICE}, options.bucketStatus);
          return json(Object.hasOwn(options, 'bucketPayload') ? options.bucketPayload : {
            id: BUCKET, name: BUCKET, public: false,
          });
        }
        if (operation === LIST) {
          const body = record(JSON.parse(await request.text()));
          assert(body.prefix === '' && body.limit === 2 && body.offset === 0, 'Storage list scope changed');
          assert(Object.keys(body).every(key => ['prefix', 'limit', 'offset', 'sortBy'].includes(key)), 'unexpected Storage list field');
          if (options.listStatus) return json({message: PRIVATE + SERVICE}, options.listStatus);
          return json(Object.hasOwn(options, 'listPayload') ? options.listPayload : []);
        }
        assert(operation === UPLOAD, 'unapproved Storage write');
        assert(request.headers.get('x-upsert') === 'false', 'once marker must use create-only SDK serialization');
        assert(request.headers.get('content-type') === 'application/json', 'marker content type changed');
        assert(request.headers.get('cache-control') === 'max-age=0', 'marker cache setting changed');
        assert(await request.text() === '{"used":true}', 'marker body must not retain identities or credentials');
        if (options.uploadStatus) return json({statusCode: String(options.uploadStatus), error: 'Duplicate', message: PRIVATE + SERVICE}, options.uploadStatus);
        // Actual Storage API wire shape; NOT the handler port's {path: ...}.
        // The real fixed SDK must turn this into data.path === 'once.json'.
        return json({Key: BUCKET + '/' + MARKER});
      }
      if (!PROVIDERS.includes(request.url)) rejectTransport();
      assert(request.method === 'GET' && !request.body, 'provider operation must be fixed GET without body');
      assert(init?.credentials === 'omit' && init.cache === 'no-store' && init.referrerPolicy === 'no-referrer', 'provider isolation options changed');
      same([...request.headers.keys()].sort(), ['accept', 'x-finnhub-token'], 'provider header allowlist changed');
      assert(request.headers.get('X-Finnhub-Token') === PROVIDER_TOKEN, 'provider must use injected token header');
      assert(!request.url.includes(PROVIDER_TOKEN) && !request.url.includes(JWT) && !request.url.includes(SERVICE), 'credential entered provider URL');
      const number = trace.filter(call => call.provider).length;
      assert(number < 6 && request.url === PROVIDERS[number], 'provider target/order or six-call limit changed');
      trace.push({operation: 'provider:' + number, provider: true, signal: request.signal});
      if (options.providerThrows) throw expectedProviderFailure;
      if (options.providerStatus) return json({error: PRIVATE + PROVIDER_TOKEN}, options.providerStatus);
      return json(Object.hasOwn(options, 'providerPayload') ? options.providerPayload : providerPayload(request.url));
    } catch (error) {
      // SDK/handler catches must never turn a failed wire assertion into an
      // apparently passing negative test. Only the explicit throw fixture is
      // expected; collect fixed labels, never raw errors/headers/credentials.
      if (error !== expectedProviderFailure) violations.push('SYNTHETIC_WIRE_ASSERTION_FAILED');
      throw error;
    }};
    // SDK initialization may inspect runtime metadata. It is initialized under
    // the SAME synthetic env/fetch stubs, never before them or with real env.
    // Then isolate the candidate index's own import-time behavior; both imports
    // use the identical pinned SDK module, not a replacement client factory.
    await import('https://esm.sh/@supabase/supabase-js@2.115.0');
    assert(trace.length === 0, 'SDK initialization attempted HTTP transport');
    envReads.length = 0;
    const entry = new URL('../supabase/functions/v1-provider-capability-review-v1/index.ts', import.meta.url);
    entry.searchParams.set('synthetic_sdk_contract', String(++sequence));
    await import(entry.href);
    assert(served === 1 && handler, 'actual index was not captured exactly once');
    assert(trace.length === 0 && envReads.length === 0, 'entry import must not perform runtime I/O or credential lookup');
    await run({handle: handler, trace, envReads});
    assert(violations.length === 0, 'unexpected project/provider/business endpoint attempted');
    assert(consoleCalls === 0, 'candidate or SDK emitted unexpected console output');
  } finally {
    globalThis.fetch = nativeFetch; Deno.env.get = nativeGet; Deno.serve = nativeServe; Date.now = nativeNow;
    consoleMethods.forEach((name, index) => {console[name] = originalConsole[index];});
  }
}

function request(options: {url?: string; origin?: string; body?: string; method?: string; headers?: Record<string, string>} = {}) {
  const method = options.method ?? 'POST';
  return new Request(options.url ?? PROJECT + ENTRY_PATH, {method,
    headers: {Origin: options.origin ?? ORIGIN, Authorization: 'Bearer ' + JWT,
      'Content-Type': 'application/json', ...options.headers},
    ...(method === 'POST' ? {body: options.body ?? '{}'} : {}),
  });
}
async function safeBody(response: Response, status: number) {
  assert(response.status === status, 'unexpected synthetic entry response status');
  const text = await response.text();
  for (const canary of [PRIVATE, ANON, SERVICE, JWT, PROVIDER_TOKEN, UID]) assert(!text.includes(canary), 'private synthetic value escaped HTTP response');
  const body = record(JSON.parse(text));
  assert(body.candidate_only === true && body.formal_admission === false && body.member_publication === false, 'diagnostic response escalated admission');
  assert(body.business_writes === 0, 'diagnostic response changed business-write contract');
  assert(!/FORMAL_AUTH_PASS|PRODUCTION_AUTH_PASS/.test(text), 'synthetic result claimed formal Auth acceptance');
  return body;
}
function operations(trace: Trace[]) {return trace.filter(call => !call.provider).map(call => call.operation);}
function noProvider(h: Harness) {
  assert(h.trace.every(call => !call.provider), 'denied request called provider');
  assert(!h.envReads.includes('FINNHUB_API_KEY'), 'denied request retrieved provider credential');
}

syntheticTest('SYNTHETIC entry SDK contract runs without net/env permission', async () => {
  // Deno reports an ungranted permission as prompt without an explicit --deny
  // flag; neither state grants access, and this suite never requests permission.
  assert((await Deno.permissions.query({name: 'net'})).state !== 'granted', 'test must run without --allow-net');
  assert((await Deno.permissions.query({name: 'env'})).state !== 'granted', 'test must run without --allow-env');
});

syntheticTest('SYNTHETIC entry contract pins the actual imported SDK to 2.115.0', async () => {
  const source = await Deno.readTextFile(new URL('../supabase/functions/v1-provider-capability-review-v1/index.ts', import.meta.url));
  assert(/import\s*\{\s*createClient\s*\}\s*from\s*['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2\.115\.0['"]/.test(source), 'actual entry SDK pin changed');
});

syntheticTest('SYNTHETIC actual index + SDK: Owner, real upload wire shape, six fixed GETs, safe UNPROVEN summary', async () => {
  await withEntry({}, async h => {
    const result = await h.handle(request()), body = await safeBody(result, 200), summary = record(body.summary);
    same(operations(h.trace), [AUTH, OWNER, BUCKET_READ, LIST, UPLOAD], 'actual SDK request sequence changed');
    assert(h.trace.length === 11 && h.trace.filter(call => call.provider).length === 6, 'unexpected total bounded HTTP operations');
    assert(h.envReads.filter(name => name === 'FINNHUB_API_KEY').length === 1, 'provider credential must be retrieved once after claim');
    assert(body.status === 'DIAGNOSTIC_ONLY' && body.control_object_write === 'CONSUMED', 'real SDK marker response was not accepted');
    assert(summary.calls === 6 && summary.observed_responses === 6 && summary.row_count === 18 && summary.quarter_count === 16, 'counts-only summary changed');
    assert(summary.tw72_coverage === 'UNKNOWN' && summary.symbol_mapping === 'HYPOTHESIS_UNVERIFIED', 'hypotheses became proven coverage');
    for (const key of ['current_entitlement', 'historical_vintage', 'commercial_member_reuse_rights']) assert(summary[key] === 'UNPROVEN', 'diagnostic claimed external proof');
    assert(summary.pure_broker_consensus === false, 'provider average became pure broker consensus');
    assert(Array.isArray(summary.observations) && summary.observations.length === 6, 'safe per-request observations missing');
    for (const [index, item] of summary.observations.entries()) {
      const observation = record(item);
      assert(observation.local_symbol === (index < 3 ? '2330' : '6488'), 'observation target changed');
      assert(observation.endpoint === ['search', 'eps', 'revenue'][index % 3], 'observation endpoint changed');
      assert(observation.http_status === 200 && observation.status === 'OBSERVED_ONLY', 'observation HTTP status lost');
      assert(Object.keys(observation).every(key => ['local_symbol', 'endpoint', 'http_status', 'status', 'shape', 'row_count', 'quarter_count', 'accepted_bytes'].includes(key)), 'raw provider field escaped observation');
    }
    const count = h.trace.length;
    await safeBody(await h.handle(request()), 409);
    assert(h.trace.length === count + 2 && h.trace.filter(call => call.provider).length === 6, 'same handler repeated claim/provider work');
  });
});

for (const options of [{authStatus: 401}, {authPayload: {unexpected: PRIVATE}}]) {
  syntheticTest('SYNTHETIC actual SDK: invalid Auth stops before Owner RPC and privileged credentials', async () => {
    await withEntry(options, async h => {
      await safeBody(await h.handle(request()), 401);
      same(operations(h.trace), [AUTH], 'Auth denial reached another SDK operation');
      assert(!h.envReads.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Auth denial retrieved service key'); noProvider(h);
    });
  });
}
for (const ownerPayload of [false, null, 'true', {owner: true, message: PRIVATE}]) {
  syntheticTest('SYNTHETIC actual SDK: non-Owner/nonboolean RPC cannot create Storage client', async () => {
    await withEntry({ownerPayload}, async h => {
      await safeBody(await h.handle(request()), 403);
      same(operations(h.trace), [AUTH, OWNER], 'Owner denial reached Storage');
      assert(!h.envReads.includes('SUPABASE_SERVICE_ROLE_KEY'), 'non-Owner retrieved service key'); noProvider(h);
    });
  });
}
syntheticTest('SYNTHETIC actual SDK: Owner RPC HTTP error is sanitized and not retried', async () => {
  await withEntry({ownerStatus: 403}, async h => {
    await safeBody(await h.handle(request()), 403); same(operations(h.trace), [AUTH, OWNER], 'Owner HTTP failure continued'); noProvider(h);
  });
});

for (const input of [
  {origin: 'https://unapproved.invalid'},
  {url: 'https://unapproved.invalid/arbitrary-target'},
  {url: PROJECT + ENTRY_PATH + '?url=https://unapproved.invalid'},
  {body: '{"url":"https://unapproved.invalid","symbol":"ARBITRARY"}'},
]) {
  syntheticTest('SYNTHETIC entry: wrong Origin/arbitrary target or input cannot reach HTTP transport', async () => {
    await withEntry({}, async h => {
      await safeBody(await h.handle(request(input)), input.origin ? 403 : 400);
      assert(h.trace.length === 0 && h.envReads.length === 0, 'invalid request reached configuration/transport'); noProvider(h);
    });
  });
}
for (const projectUrl of ['https://unapproved.invalid', PROJECT + '/other', PROJECT + '?url=x',
  'http://cttfzgvhiewfckydcrci.supabase.co', 'https://synthetic-user@cttfzgvhiewfckydcrci.supabase.co']) {
  syntheticTest('SYNTHETIC entry: runtime configuration must pin exact project before credential/HTTP access', async () => {
    await withEntry({projectUrl}, async h => {
      await safeBody(await h.handle(request()), 503);
      assert(h.trace.length === 0, 'invalid project configuration reached transport');
      assert(!h.envReads.includes('SUPABASE_ANON_KEY') && !h.envReads.includes('SUPABASE_SERVICE_ROLE_KEY'), 'invalid project retrieved SDK credential'); noProvider(h);
    });
  });
}

for (const options of [
  {bucketPayload: {id: BUCKET, public: true}}, {bucketPayload: {unknown: PRIVATE}}, {bucketStatus: 403},
]) {
  syntheticTest('SYNTHETIC actual Storage SDK: public/unknown/error bucket stops before list/upload', async () => {
    await withEntry(options, async h => {
      await safeBody(await h.handle(request()), 409);
      same(operations(h.trace), [AUTH, OWNER, BUCKET_READ], 'invalid bucket continued'); noProvider(h);
    });
  });
}
for (const options of [{listPayload: [{name: MARKER}]}, {listPayload: [{name: 'unexpected-object'}]},
  {listPayload: {unknown: PRIVATE}}, {listStatus: 403}]) {
  syntheticTest('SYNTHETIC actual Storage SDK: nonempty/unknown/error list stops before upload', async () => {
    await withEntry(options, async h => {
      await safeBody(await h.handle(request()), 409);
      same(operations(h.trace), [AUTH, OWNER, BUCKET_READ, LIST], 'invalid Storage list continued'); noProvider(h);
    });
  });
}
syntheticTest('SYNTHETIC actual Storage SDK: upload 409 consumes local attempt, zero provider calls or retry', async () => {
  await withEntry({uploadStatus: 409}, async h => {
    const body = await safeBody(await h.handle(request()), 409);
    assert(body.control_object_write === 'POSSIBLE', 'uncertain claim must not become success');
    same(operations(h.trace), [AUTH, OWNER, BUCKET_READ, LIST, UPLOAD], 'claim SDK sequence changed'); noProvider(h);
    await safeBody(await h.handle(request()), 409);
    assert(h.trace.filter(call => call.operation === UPLOAD).length === 1, 'failed marker upload was retried'); noProvider(h);
  });
});

for (const options of [{providerStatus: 401}, {providerStatus: 403}, {providerStatus: 429},
  {providerPayload: {unknown_schema: PRIVATE}}, {providerThrows: true}]) {
  syntheticTest('SYNTHETIC entry: provider HTTP/unknown schema/throw is bounded counts-only, no raw echo', async () => {
    await withEntry(options, async h => {
      const body = await safeBody(await h.handle(request()), 200), summary = record(body.summary);
      assert(body.control_object_write === 'CONSUMED' && summary.calls === 1, 'provider failure must remain once-only fail-fast observation');
      assert(summary.current_entitlement === 'UNPROVEN' && summary.tw72_coverage === 'UNKNOWN', 'HTTP failure invented entitlement/coverage');
      assert(h.trace.filter(call => call.provider).length === 1, 'provider failure retried or continued');
      assert(Array.isArray(summary.observations) && summary.observations.length === 1, 'safe failure observation missing');
      const observation = record(summary.observations[0]);
      assert(observation.local_symbol === '2330' && observation.endpoint === 'search', 'failure target binding changed');
      if (options.providerStatus) assert(observation.http_status === options.providerStatus && observation.status === 'HTTP_STOP', 'HTTP failure classification lost');
      assert(!h.trace.some(call => call.operation.includes('/rest/v1/') && call.operation !== OWNER), 'business endpoint was invoked');
    });
  });
}

syntheticTest('SYNTHETIC entry: exact-origin preflight is local only and does not claim Auth acceptance', async () => {
  await withEntry({}, async h => {
    const response = await h.handle(request({method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info',
    }}));
    assert(response.status === 204 && await response.text() === '', 'fixed preflight not supported');
    assert(response.headers.get('access-control-allow-origin') === ORIGIN, 'CORS Origin changed');
    assert(h.trace.length === 0 && h.envReads.length === 0, 'preflight reached Auth/Storage/provider');
  });
});
