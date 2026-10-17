/** Unapproved, expiring Owner-only diagnostic candidate. No business writes.
 * The only write is a durable private Storage once marker; it is NOT zero-write.
 * No cleanup, bucket creation, entitlement mutation or deployment is performed.
 */
export const CAPABILITY_REVIEW_BUCKET = 'v1-provider-capability-review-20261017';
export const CAPABILITY_REVIEW_MARKER = 'once.json';
export const CAPABILITY_REVIEW_ORIGIN = 'https://morningalphatw.com';
export const CAPABILITY_REVIEW_EXPIRES = '2026-10-18T06:00:00Z';
export const CAPABILITY_REVIEW_DEADLINE_MS = 15_000;
export const CAPABILITY_REVIEW_CANDIDATE = Object.freeze({
  function_name: 'v1-provider-capability-review-v1', verify_jwt: true,
  expires_at: CAPABILITY_REVIEW_EXPIRES, candidate_only: true, deployment_authorized: false,
  business_writes: 0, control_object_write: 'PRIVATE_ONCE_MARKER_ONLY',
  formal_admission: false, member_publication: false,
});

type Result<T> = {data: T | null; error: unknown};
export type ReviewContext = {
  signal: AbortSignal; assertActive: () => void; remainingMs: () => number;
};
type UserClient = {
  auth: {getUser: (jwt: string) => PromiseLike<Result<{user: {id: string} | null}>>};
  rpc: (name: 'is_research_owner_v1') => {
    abortSignal: (signal: AbortSignal) => PromiseLike<Result<unknown>>;
  };
};
type ClaimStore = {
  getBucket: (bucket: string) => PromiseLike<Result<{id: string; public: boolean}>>;
  list: (bucket: string, prefix: string, options: {limit: 2; offset: 0}) => PromiseLike<Result<unknown[]>>;
  upload: (bucket: string, path: string, bytes: Uint8Array,
    options: {upsert: false; contentType: 'application/json'; cacheControl: '0'}) => PromiseLike<Result<{path: string}>>;
};
export type CapabilityReviewDependencies = {
  createUserClient: (authorization: string, context: ReviewContext) => UserClient;
  createClaimStore: (context: ReviewContext) => ClaimStore;
  createProbe: (context: ReviewContext) => {run: (options: {signal: AbortSignal; remainingMs: number}) => PromiseLike<unknown>};
  wallNow?: () => number;
  monotonicNow?: () => number;
};
const expires = Date.parse(CAPABILITY_REVIEW_EXPIRES);
const statuses = new Set(['BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED', 'BLOCKED_INPUT',
  'BLOCKED_CONFIGURATION', 'BLOCKED_CREDENTIAL', 'BATCH_DEADLINE', 'CLOCK_INVALID',
  'CALL_TIMEOUT', 'AMBIGUOUS_RESPONSE', 'HTTP_STOP', 'BODY_LIMIT', 'ROW_LIMIT',
  'NETWORK_OR_AMBIGUOUS', 'OBSERVED_ONLY']);
const observationStatuses = new Set(['BATCH_DEADLINE', 'CLOCK_INVALID', 'CALL_TIMEOUT',
  'AMBIGUOUS_RESPONSE', 'HTTP_STOP', 'BODY_LIMIT', 'ROW_LIMIT', 'NETWORK_OR_AMBIGUOUS', 'OBSERVED_ONLY']);
const shapes = new Set(['SEARCH_ROWS', 'EMPTY', 'QUARTERLY_ESTIMATE_ROWS', 'AMBIGUOUS', 'ROW_LIMIT']);
const requests = [
  {local_symbol: '2330', endpoint: 'search'}, {local_symbol: '2330', endpoint: 'eps'},
  {local_symbol: '2330', endpoint: 'revenue'}, {local_symbol: '6488', endpoint: 'search'},
  {local_symbol: '6488', endpoint: 'eps'}, {local_symbol: '6488', endpoint: 'revenue'},
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

// Fixed labels/counts only. Never spread a provider/dependency result into HTTP.
function aggregate(value: unknown) {
  if (!record(value) || typeof value.status !== 'string' || !statuses.has(value.status)
    || !count(value.calls, 6) || !Array.isArray(value.observations)
    || value.observations.length > 6 || value.observations.length !== value.calls) return null;
  let observed = 0, rows = 0, quarters = 0;
  const observations = [];
  for (let index = 0; index < value.observations.length; index++) {
    const item = value.observations[index], expected = requests[index];
    if (!record(item) || item.symbol !== expected.local_symbol || item.endpoint !== expected.endpoint
      || typeof item.status !== 'string' || !observationStatuses.has(item.status)) return null;
    const http = item.http_status, shape = item.shape ?? null;
    const rowCount = item.row_count === undefined ? 0 : item.row_count;
    const quarterCount = item.quarter_count === undefined ? 0 : item.quarter_count;
    const acceptedBytes = item.accepted_bytes === undefined ? 0 : item.accepted_bytes;
    if ((http !== null && (!count(http, 599) || http < 100))
      || (shape !== null && (typeof shape !== 'string' || !shapes.has(shape)))
      || !count(rowCount, 64) || !count(quarterCount, 64) || !count(acceptedBytes, 65536)) return null;
    if (item.status === 'OBSERVED_ONLY') observed++;
    rows += rowCount; quarters += quarterCount;
    // Identity comes from the fixed plan after exact prefix/order validation.
    // Do not spread any item: only these non-sensitive labels/counts may leave.
    observations.push({local_symbol: expected.local_symbol, endpoint: expected.endpoint,
      http_status: http, status: item.status, shape, row_count: rowCount,
      quarter_count: quarterCount, accepted_bytes: acceptedBytes});
  }
  return {probe_status: value.status, calls: value.calls, observed_responses: observed,
    row_count: rows, quarter_count: quarters, observations,
    symbol_mapping: 'HYPOTHESIS_UNVERIFIED', tw72_coverage: 'UNKNOWN',
    current_entitlement: 'UNPROVEN', historical_vintage: 'UNPROVEN',
    commercial_member_reuse_rights: 'UNPROVEN',
    average_provenance: 'FINNHUB_AVERAGE_INCLUDING_PROPRIETARY', pure_broker_consensus: false};
}

export function createCapabilityReviewHandler(deps: CapabilityReviewDependencies) {
  // Fail closed after any local claim attempt, including an uncertain upload.
  // The Storage unique path/upsert=false is the cross-isolate authority.
  let claimAttempted = false;
  return async (request: Request): Promise<Response> => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, request.signal]);
    const monotonic = deps.monotonicNow ?? (() => performance.now());
    const wall = deps.wallNow ?? (() => Date.now());
    let start = NaN, previous = NaN, closed = false, stopStatus = 'DEADLINE';
    let controlWrite = 'NONE';
    const headers: Record<string, string> = {'Cache-Control': 'no-store', Vary: 'Origin',
      'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff'};
    if (request.headers.get('origin') === CAPABILITY_REVIEW_ORIGIN) {
      headers['Access-Control-Allow-Origin'] = CAPABILITY_REVIEW_ORIGIN;
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    const reply = (status: number, label: string, summary?: ReturnType<typeof aggregate>) =>
      Response.json({status: label, candidate_only: true, formal_admission: false,
        member_publication: false, business_writes: 0, control_object_write: controlWrite,
        ...(summary ? {summary} : {})}, {status, headers});
    const context: ReviewContext = {
      signal,
      assertActive: () => {
        const now = monotonic(), date = wall();
        if (!Number.isFinite(date) || date >= expires) stopStatus = 'EXPIRED';
        if (closed || signal.aborted || !Number.isFinite(now) || !Number.isFinite(start)
          || now < 0 || start < 0 || now > Number.MAX_SAFE_INTEGER
          || start > Number.MAX_SAFE_INTEGER - CAPABILITY_REVIEW_DEADLINE_MS
          || now < previous || now - start >= CAPABILITY_REVIEW_DEADLINE_MS || stopStatus === 'EXPIRED') {
          controller.abort(); throw Error('REVIEW_STOPPED');
        }
        previous = now;
      },
      remainingMs: () => {
        context.assertActive();
        return Math.max(0, CAPABILITY_REVIEW_DEADLINE_MS - (previous - start));
      },
    };
    const stopped = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(Error('REVIEW_STOPPED')), {once: true});
    });
    // A handler can reject before awaiting stopped; keep that rejection handled.
    void stopped.catch(() => {});
    const timer = setTimeout(() => controller.abort(), CAPABILITY_REVIEW_DEADLINE_MS);
    const step = async <T>(operation: () => PromiseLike<T>): Promise<T> => {
      context.assertActive();
      const work = Promise.resolve().then(() => {context.assertActive(); return operation();});
      const value = await Promise.race([work, stopped]);
      context.assertActive(); return value;
    };
    try {
      start = previous = monotonic();
      if (request.method === 'OPTIONS') {
        if (request.headers.get('origin') !== CAPABILITY_REVIEW_ORIGIN) return reply(403, 'ORIGIN_DENIED');
        const requested = request.headers.get('access-control-request-headers') ?? '';
        const names = requested ? requested.split(',').map(name => name.trim().toLowerCase()) : [];
        const allowed = new Set(['authorization', 'apikey', 'content-type', 'x-client-info']);
        if (request.headers.get('access-control-request-method') !== 'POST' || requested.length > 128
          || names.length > 4 || new Set(names).size !== names.length || names.some(name => !allowed.has(name))
          || request.body !== null || (request.headers.has('content-length') && request.headers.get('content-length') !== '0'))
          return reply(403, 'PREFLIGHT_DENIED');
        return new Response(null, {status: 204, headers});
      }
      if (request.method !== 'POST') {headers.Allow = 'POST, OPTIONS'; return reply(405, 'METHOD_NOT_ALLOWED');}
      if (request.headers.get('origin') !== CAPABILITY_REVIEW_ORIGIN) return reply(403, 'ORIGIN_DENIED');
      const url = new URL(request.url);
      if (url.search || url.hash || url.username || url.password
        || !url.pathname.endsWith('/v1-provider-capability-review-v1')) return reply(400, 'INPUT_REJECTED');
      const authorization = request.headers.get('authorization') ?? '';
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
      if (!match) return reply(401, 'AUTH_REQUIRED');
      context.assertActive();
      if (!request.body || request.headers.has('content-encoding')
        || (request.headers.has('content-length') && request.headers.get('content-length') !== '2')
        || request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
        return reply(400, 'INPUT_REJECTED');
      const reader = request.body.getReader();
      const bytes: number[] = []; let parts = 0;
      try {
        for (;;) {
          const part = await step(() => reader.read());
          if (part.done) break;
          if (!(part.value instanceof Uint8Array) || ++parts > 4 || bytes.length + part.value.length > 2)
            return reply(400, 'INPUT_REJECTED');
          bytes.push(...part.value);
        }
      } finally {void reader.cancel().catch(() => {});}
      if (bytes.length !== 2 || bytes[0] !== 123 || bytes[1] !== 125) return reply(400, 'INPUT_REJECTED');

      context.assertActive();
      const userClient = deps.createUserClient(authorization, context);
      let user;
      try {user = await step(() => userClient.auth.getUser(match[1]));}
      catch {context.assertActive(); return reply(401, 'AUTH_INVALID');}
      if (user.error !== null || typeof user.data?.user?.id !== 'string' || !user.data.user.id
        || user.data.user.id.length > 256) return reply(401, 'AUTH_INVALID');
      let owner;
      try {owner = await step(() => userClient.rpc('is_research_owner_v1').abortSignal(signal));}
      catch {context.assertActive(); return reply(403, 'RESEARCH_OWNER_REQUIRED');}
      if (owner.error !== null || owner.data !== true) return reply(403, 'RESEARCH_OWNER_REQUIRED');

      context.assertActive();
      if (claimAttempted) return reply(409, 'CLAIM_DENIED');
      const store = deps.createClaimStore(context);
      const bucket = await step(() => store.getBucket(CAPABILITY_REVIEW_BUCKET));
      if (bucket.error !== null || bucket.data?.id !== CAPABILITY_REVIEW_BUCKET || bucket.data.public !== false)
        return reply(409, 'CLAIM_DENIED');
      const objects = await step(() => store.list(CAPABILITY_REVIEW_BUCKET, '', {limit: 2, offset: 0}));
      if (objects.error !== null || !Array.isArray(objects.data) || objects.data.length !== 0)
        return reply(409, 'CLAIM_DENIED');
      context.assertActive();
      if (claimAttempted) return reply(409, 'CLAIM_DENIED');
      claimAttempted = true; controlWrite = 'POSSIBLE';
      const claim = await step(() => store.upload(CAPABILITY_REVIEW_BUCKET, CAPABILITY_REVIEW_MARKER,
        new TextEncoder().encode('{"used":true}'), {upsert: false, contentType: 'application/json', cacheControl: '0'}));
      if (claim.error !== null || claim.data?.path !== CAPABILITY_REVIEW_MARKER) return reply(409, 'CLAIM_DENIED');
      controlWrite = 'CONSUMED';
      context.assertActive();
      const probe = deps.createProbe(context);
      const result = await step(() => probe.run({signal, remainingMs: context.remainingMs()}));
      const summary = aggregate(result);
      context.assertActive();
      return summary ? reply(200, 'DIAGNOSTIC_ONLY', summary) : reply(502, 'PROBE_UNAVAILABLE');
    } catch {
      if (signal.aborted) return reply(stopStatus === 'EXPIRED' ? 410 : 504, stopStatus);
      return reply(503, 'DEPENDENCY_UNAVAILABLE');
    } finally {closed = true; clearTimeout(timer); controller.abort();}
  };
}
