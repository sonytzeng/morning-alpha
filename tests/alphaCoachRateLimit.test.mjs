import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const migration = read('supabase/migrations/20260904143326_alpha_coach_durable_rate_limits.sql');
const edge = read('supabase/functions/alpha-coach/index.ts');
const contract = read('supabase/functions/_shared/alpha-coach-rate-limit.ts');

test('Alpha Coach durable limiter keeps all policies in one protected database contract', () => {
  assert.match(migration, /create table if not exists public\.alpha_coach_rate_limit_policies/);
  assert.match(migration, /\('anonymous', 0, 0, false\)/);
  assert.match(migration, /\('standard', 5, 30, true\)/);
  assert.match(migration, /\('admin', 20, 200, true\)/);
  assert.match(migration, /alpha_coach_rate_limit_policies force row level security/);
  assert.match(migration, /alpha_coach_rate_limit_counters force row level security/);
  assert.match(migration, /revoke all on table public\.alpha_coach_rate_limit_policies from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.alpha_coach_rate_limit_counters from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy/);
});

test('rate-limit check and increment are transaction-safe and multi-instance safe', () => {
  assert.match(migration, /create or replace function public\.consume_alpha_coach_rate_limit_v1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /on conflict \(actor_id, policy_key, window_kind, window_start\) do update/g);
  assert.match(migration, /request_count = public\.alpha_coach_rate_limit_counters\.request_count \+ 1/g);
  assert.doesNotMatch(migration, /runtime_cost_usage/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /grant execute on function public\.consume_alpha_coach_rate_limit_v1\(uuid, text, timestamptz\)[\s\S]*to service_role/);
});

test('Edge enforcement uses auth.getUser identity and a server-side profile role', () => {
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /authData\.user\.id/);
  assert.match(edge, /from\('profiles'\)\.select\('role'\)\.eq\('id', authData\.user\.id\)/);
  assert.match(edge, /resolveAlphaCoachRateLimitPolicy\(verifiedRole\)/);
  assert.match(edge, /serviceClient\.rpc\(functionName, args\)/);
  assert.doesNotMatch(edge, /rateWindows|REQUESTS_PER_MINUTE|Date\.now\(\)/);
  assert.doesNotMatch(`${edge}\n${contract}`, /user_metadata|app_metadata|localStorage|URLSearchParams|[?&]user_id|client[_ -]?tier/i);
  assert.ok(edge.indexOf('auth.getUser(token)') < edge.indexOf('consumeAlphaCoachRateLimit('));
  assert.ok(edge.indexOf("from('profiles').select('role')") < edge.indexOf('consumeAlphaCoachRateLimit('));
});

test('feature flag, unauthorized requests, rate-limit failures, and limit responses fail closed', () => {
  assert.ok(edge.indexOf("Deno.env.get('ALPHA_COACH_ENABLED') !== 'true'") < edge.indexOf('auth.getUser(token)'));
  assert.match(edge, /AUTHENTICATION_REQUIRED/);
  assert.match(edge, /INVALID_SESSION/);
  assert.match(edge, /OWNER_REQUIRED/);
  assert.match(edge, /RATE_LIMIT_BACKEND_ERROR/);
  assert.match(edge, /服務暫時忙碌，請稍後再試。/);
  assert.match(edge, /error: 'RATE_LIMITED'/);
  assert.match(edge, /message: '請稍後再試。'/);
  assert.match(edge, /retry_after_seconds: rateLimit\.retryAfterSeconds/);
  assert.match(edge, /}, 429\)/);
});

test('limiter response validation rejects malformed database responses', () => {
  assert.match(contract, /typeof row\.allowed !== 'boolean'/);
  assert.match(contract, /appliedPolicyKey !== policyKey/);
  assert.match(contract, /status: 'backend_error', reason: 'INVALID_RESPONSE'/);
  assert.match(contract, /status: 'backend_error', reason: 'RPC_ERROR'/);
  assert.match(contract, /Math\.min\(retryAfterSeconds, 3600\)/);
});
