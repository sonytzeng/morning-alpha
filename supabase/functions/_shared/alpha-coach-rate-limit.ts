export const ALPHA_COACH_RATE_LIMIT_RPC = 'consume_alpha_coach_rate_limit_v1';

export type AlphaCoachRateLimitPolicyKey = 'standard' | 'admin';

type RateLimitRpcResult = {
  data: unknown;
  error: unknown;
};

export type RateLimitRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => PromiseLike<RateLimitRpcResult>;

export type AlphaCoachRateLimitResult =
  | {
    status: 'allowed';
    policyKey: AlphaCoachRateLimitPolicyKey;
    minuteCount: number;
    minuteLimit: number;
    hourCount: number;
    hourLimit: number;
  }
  | {
    status: 'limited';
    policyKey: AlphaCoachRateLimitPolicyKey;
    retryAfterSeconds: number;
  }
  | {
    status: 'backend_error';
    reason: 'RPC_ERROR' | 'INVALID_RESPONSE';
  };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value;
}

function firstRow(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

export function resolveAlphaCoachRateLimitPolicy(role: unknown): AlphaCoachRateLimitPolicyKey {
  return typeof role === 'string' && role.trim().toLowerCase() === 'admin'
    ? 'admin'
    : 'standard';
}

export async function consumeAlphaCoachRateLimit(
  rpc: RateLimitRpc,
  actorId: string,
  policyKey: AlphaCoachRateLimitPolicyKey,
): Promise<AlphaCoachRateLimitResult> {
  const { data, error } = await rpc(ALPHA_COACH_RATE_LIMIT_RPC, {
    p_actor_id: actorId,
    p_policy_key: policyKey,
  });
  if (error) return { status: 'backend_error', reason: 'RPC_ERROR' };

  const row = firstRow(data);
  const appliedPolicyKey = row.applied_policy_key;
  const minuteCount = finiteInteger(row.minute_count);
  const minuteLimit = finiteInteger(row.minute_limit);
  const hourCount = finiteInteger(row.hour_count);
  const hourLimit = finiteInteger(row.hour_limit);
  if (
    typeof row.allowed !== 'boolean'
    || appliedPolicyKey !== policyKey
    || minuteCount === null
    || minuteLimit === null
    || hourCount === null
    || hourLimit === null
    || minuteCount < 0
    || hourCount < 0
    || minuteLimit <= 0
    || hourLimit < minuteLimit
  ) {
    return { status: 'backend_error', reason: 'INVALID_RESPONSE' };
  }

  if (!row.allowed) {
    const retryAfterSeconds = finiteInteger(row.retry_after_seconds);
    if (retryAfterSeconds === null || retryAfterSeconds <= 0) {
      return { status: 'backend_error', reason: 'INVALID_RESPONSE' };
    }
    return {
      status: 'limited',
      policyKey,
      retryAfterSeconds: Math.min(retryAfterSeconds, 3600),
    };
  }

  return {
    status: 'allowed',
    policyKey,
    minuteCount,
    minuteLimit,
    hourCount,
    hourLimit,
  };
}
