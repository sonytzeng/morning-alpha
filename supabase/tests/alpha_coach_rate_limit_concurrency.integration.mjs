import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.ALPHA_COACH_RATE_LIMIT_TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('ALPHA_COACH_RATE_LIMIT_TEST_DATABASE_URL is required for the isolated database concurrency test');
}

const actor = '33333333-3333-4333-8333-333333333333';
const persistenceActor = '44444444-4444-4444-8444-444444444444';
const observedAt = '2026-09-04 06:45:10+00';

function query(sql) {
  return execFileSync('psql', [databaseUrl, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
  }).trim();
}

async function queryAsync(sql) {
  const { stdout } = await execFileAsync('psql', [databaseUrl, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
  });
  return stdout.trim();
}

query(`delete from public.alpha_coach_rate_limit_counters where actor_id in ('${actor}'::uuid, '${persistenceActor}'::uuid)`);

const firstSession = query(`set role service_role; select minute_count from public.consume_alpha_coach_rate_limit_v1('${persistenceActor}'::uuid, 'standard', '${observedAt}'::timestamptz)`);
const secondSession = query(`set role service_role; select minute_count from public.consume_alpha_coach_rate_limit_v1('${persistenceActor}'::uuid, 'standard', '${observedAt}'::timestamptz)`);
assert.equal(firstSession, '1', 'first database session must persist count 1');
assert.equal(secondSession, '2', 'a new database session must observe the durable count');

const attempts = await Promise.all(Array.from({ length: 12 }, () => queryAsync(
  `set role service_role; select allowed from public.consume_alpha_coach_rate_limit_v1('${actor}'::uuid, 'standard', '${observedAt}'::timestamptz)`,
)));
assert.equal(attempts.filter((value) => value === 't').length, 5, 'exactly five concurrent requests may pass');
assert.equal(attempts.filter((value) => value === 'f').length, 7, 'remaining concurrent requests must be denied');

const stored = query(`select request_count from public.alpha_coach_rate_limit_counters where actor_id='${actor}'::uuid and policy_key='standard' and window_kind='minute'`);
assert.equal(stored, '5', 'denied concurrent requests must not increment or bypass the quota');

console.log('alpha coach durable rate limit database integration: PASS');
