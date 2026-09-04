import {
  ALPHA_COACH_RATE_LIMIT_RPC,
  consumeAlphaCoachRateLimit,
  resolveAlphaCoachRateLimitPolicy,
  type RateLimitRpc,
} from './alpha-coach-rate-limit.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rpcReturning(data: unknown, error: unknown = null): RateLimitRpc {
  return () => Promise.resolve({ data, error });
}

const allowedRow = {
  allowed: true,
  retry_after_seconds: 0,
  minute_count: 1,
  minute_limit: 5,
  hour_count: 1,
  hour_limit: 30,
  applied_policy_key: 'standard',
};

Deno.test('first authenticated request is allowed and uses the server actor id', async () => {
  let observedName = '';
  let observedArgs: Record<string, unknown> = {};
  const rpc: RateLimitRpc = (name, args) => {
    observedName = name;
    observedArgs = args;
    return Promise.resolve({ data: [allowedRow], error: null });
  };
  const result = await consumeAlphaCoachRateLimit(rpc, '11111111-1111-4111-8111-111111111111', 'standard');
  assert(result.status === 'allowed', 'first request must be allowed');
  assert(observedName === ALPHA_COACH_RATE_LIMIT_RPC, 'must call the durable limiter RPC');
  assert(observedArgs.p_actor_id === '11111111-1111-4111-8111-111111111111', 'must forward only the authenticated actor id');
  assert(!('user_id' in observedArgs), 'must not accept a client user_id field');
});

Deno.test('under-limit requests remain allowed with returned counters', async () => {
  const result = await consumeAlphaCoachRateLimit(rpcReturning([{ ...allowedRow, minute_count: 4, hour_count: 12 }]), 'actor', 'standard');
  assert(result.status === 'allowed', 'under-limit request must be allowed');
  assert(result.minuteCount === 4 && result.hourCount === 12, 'must retain database counters');
});

Deno.test('over-limit response is denied with a bounded retry interval', async () => {
  const result = await consumeAlphaCoachRateLimit(rpcReturning([{
    ...allowedRow,
    allowed: false,
    retry_after_seconds: 60,
    minute_count: 5,
  }]), 'actor', 'standard');
  assert(result.status === 'limited', 'over-limit request must be denied');
  assert(result.retryAfterSeconds === 60, 'must return the database retry interval');
});

Deno.test('database errors fail closed', async () => {
  const result = await consumeAlphaCoachRateLimit(rpcReturning(null, { code: 'DATABASE_UNAVAILABLE' }), 'actor', 'standard');
  assert(result.status === 'backend_error' && result.reason === 'RPC_ERROR', 'RPC failure must fail closed');
});

Deno.test('malformed database responses fail closed', async () => {
  for (const response of [null, [], [{ ...allowedRow, allowed: 'true' }], [{ ...allowedRow, retry_after_seconds: null, allowed: false }]]) {
    const result = await consumeAlphaCoachRateLimit(rpcReturning(response), 'actor', 'standard');
    assert(result.status === 'backend_error', 'invalid response must fail closed');
  }
});

Deno.test('admin role receives only the centrally configured admin policy key', () => {
  assert(resolveAlphaCoachRateLimitPolicy('admin') === 'admin', 'admin must use admin policy');
  assert(resolveAlphaCoachRateLimitPolicy('ADMIN') === 'admin', 'role normalization must be deterministic');
  assert(resolveAlphaCoachRateLimitPolicy('vip') === 'standard', 'non-admin roles must not receive admin limits');
  assert(resolveAlphaCoachRateLimitPolicy({ role: 'admin' }) === 'standard', 'forged metadata objects must not elevate policy');
});
