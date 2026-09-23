// Opt-in fresh PostgreSQL 17 validation for the sole Evidence Recorder migration.
// It requires an explicitly named loopback database and cannot connect to Production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const scope = 'ma-production-evidence-recorder-20260923';
const database = process.env.MA_ISOLATED_TEST_DB;
const port = process.env.MA_TEST_PGPORT || '55439';
const bin = process.env.MA_TEST_PSQL || 'psql';
const user = process.env.PGUSER || 'postgres';
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.match(database || '', /^ma_production_evidence_recorder_test\d+$/);
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const args = (db = database) => ['-X', '-q', '-h', '127.0.0.1', '-p', port, '-U', user, '-d', db, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];

function command(statement, db = database, allowFailure = false) {
  try {
    return { ok: true, output: execFileSync(bin, [...args(db), '-c', statement], {
      encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    }).trim() };
  } catch (error) {
    if (!allowFailure) throw new Error(String(error.stderr || error.message));
    return { ok: false, output: String(error.stderr || error.message).trim() };
  }
}

function load(path) {
  execFileSync(bin, [...args(), '-f', new URL(`../${path}`, import.meta.url).pathname], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
  });
}

assert.match(command('select host(inet_server_addr());', 'postgres').output,
  /^(?:127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/);
assert.equal(command(`select count(*) from pg_database where datname=${q(database)};`, 'postgres').output, '0');
command(`do $block$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  alter role service_role bypassrls;
end $block$;`, 'postgres');
command(`create database ${database};`, 'postgres');
load('supabase/migrations/20260923124500_production_evidence_recorder_v1.sql');
load('supabase/migrations/20260923124500_production_evidence_recorder_v1.sql');

assert.equal(command(`select relrowsecurity::text||':'||relforcerowsecurity::text
  from pg_class where oid='public.production_provider_evidence'::regclass;`).output, 'true:true');
assert.equal(command(`select count(*) from information_schema.columns
  where table_schema='public' and table_name='production_provider_evidence';`).output, '30');
assert.equal(command(`select count(*) from pg_trigger where tgrelid='public.production_provider_evidence'::regclass
  and tgname='production_provider_evidence_append_only_v1' and not tgisinternal;`).output, '1');
assert.equal(command(`select count(*) from pg_extension where extname='pg_cron';`).output, '0');

const insertSql = (attemptKey, timestamps = '') => `insert into public.production_provider_evidence (
  business_date,checkpoint,attempt,transport_attempt,attempt_key,provider_key,provider,symbol,endpoint_class,
  market_phase,freshness_result,contract_result,adapter_version,contract_version,normalized_evidence,payload_shape,
  raw_payload_hash,replay_payload,correlation_id,source_function,recorder_version${timestamps ? ',recorded_at,retention_until' : ''}
) values (
  '2026-09-24','PREMARKET',1,1,${q(attemptKey)},'SPX','finnhub','SPY','quote',
  'premarket','fresh','PASS','TEST','MARKET_CHECKPOINT_PROVIDER_V1','{}','{}',${q('a'.repeat(64))},'{}',
  '24070000-0000-4000-8000-000000000001','fetch-market-data-v10','PRODUCTION_EVIDENCE_RECORDER_V1'
  ${timestamps ? `,${timestamps}` : ''}
);`;

for (const role of ['anon', 'authenticated']) {
  const denied = command(`set role ${role}; insert into public.production_provider_evidence
    (business_date,checkpoint,attempt,transport_attempt,attempt_key,provider_key,provider,symbol,endpoint_class,
     market_phase,freshness_result,contract_result,adapter_version,contract_version,normalized_evidence,payload_shape,
     raw_payload_hash,replay_payload,correlation_id,source_function,recorder_version)
    values ('2026-09-24','PREMARKET',1,1,'denied:1','SPX','finnhub','SPY','quote','premarket','fresh','PASS',
      'TEST','MARKET_CHECKPOINT_PROVIDER_V1','{}','{}',${q('a'.repeat(64))},'{}',
      '24070000-0000-4000-8000-000000000001','fetch-market-data-v10','PRODUCTION_EVIDENCE_RECORDER_V1');`, database, true);
  assert.equal(denied.ok, false, `${role} insert must fail`);
}

assert.equal(command(`set role service_role; ${insertSql('PREMARKET:1:1:24070000-0000-4000-8000-000000000001')}
  select count(*) from public.production_provider_evidence;`).output.split('\n').at(-1), '1');
const update = command(`set role service_role; update public.production_provider_evidence set checkpoint='0900';`, database, true);
assert.equal(update.ok, false);
assert.match(update.output, /permission denied|PRODUCTION_PROVIDER_EVIDENCE_APPEND_ONLY/);
const remove = command(`set role service_role; delete from public.production_provider_evidence;`, database, true);
assert.equal(remove.ok, false);
assert.match(remove.output, /permission denied|PRODUCTION_PROVIDER_EVIDENCE_APPEND_ONLY/);

command(`reset role; ${insertSql('expired:1', "now()-interval '91 days',now()-interval '1 day'")}`);
assert.equal(command(`set role service_role; select public.cleanup_expired_production_provider_evidence_v1(1000);`).output, '1');
assert.equal(command(`select count(*) from public.production_provider_evidence;`).output, '1');
assert.equal(command(`select count(*) from information_schema.tables where table_schema='public';`).output, '1');

console.log('PRODUCTION_EVIDENCE_RECORDER_DB=PASS; RLS=FORCED; SERVICE_ROLE=SELECT_INSERT_ONLY; APPEND_ONLY=PASS; RETENTION=90_DAYS; CLEANUP_BOUNDED=PASS; CRON=UNCHANGED');
