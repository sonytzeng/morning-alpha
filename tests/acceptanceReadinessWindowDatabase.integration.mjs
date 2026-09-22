// Run only after coreConsolidationDatabase.integration.mjs has created its
// fresh, loopback-only schema and valid full-day fixture in the same CI job.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const predecessorScope = 'ma-core-consolidation-20260909';
const scope = 'ma-acceptance-readiness-parity-20260922';
const database = process.env.MA_ISOLATED_TEST_DB;
assert.equal(process.env.MA_LOCAL_SCOPE, predecessorScope);
assert.equal(process.env.MA_ACCEPTANCE_LOCAL_SCOPE, scope);
assert.match(database || '', /^ma_core_consolidation_test\d+$/);

const bin = process.env.MA_TEST_PSQL || 'psql';
const port = process.env.MA_TEST_PGPORT || '55439';
const args = ['-X', '-q', '-h', '127.0.0.1', '-p', port, '-d', database, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const command = statement => execFileSync(bin, [...args, '-c', statement], {
  encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
}).trim();
const sql = statement => {
  assert.equal(command('select scope from ma_isolated_guard.identity;'), predecessorScope);
  assert.match(command('select host(inet_server_addr());'), /^(?:127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/);
  return command(statement);
};
const migration = new URL('../supabase/migrations/20260922153000_acceptance_readiness_window_parity_v1.sql', import.meta.url).pathname;
const migrationSource = readFileSync(migration, 'utf8');
assert.match(migrationSource, /ACCEPTANCE_READINESS_WINDOW_BASELINE_MISMATCH/);

const signature = 'public.capture_morning_alpha_acceptance_v1(date,text)';
const metadata = () => JSON.parse(sql(`select json_build_object(
  'definition',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),
  'acl',p.proacl::text,'definer',p.prosecdef,'volatility',p.provolatile,
  'settings',p.proconfig,'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))
  from pg_proc p where p.oid=${q(signature)}::regprocedure;`));
const before = metadata();
assert.equal(before.definition, '6b24694c90fff258727147df13ae2638');
const historical = () => sql(`select md5(coalesce(string_agg(row_to_json(a)::text,E'\\n' order by a.id::text),''))
  from production_acceptance_results a;`);
const historicalBefore = historical();

execFileSync(bin, [...args, '-f', migration], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
const once = metadata();
execFileSync(bin, [...args, '-f', migration], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
assert.deepEqual(metadata(), once);
const { definition: ignoredBefore, ...authorityBefore } = before;
const { definition: ignoredAfter, ...authorityAfter } = once;
assert.notEqual(ignoredAfter, ignoredBefore);
assert.deepEqual(authorityAfter, authorityBefore);
assert.equal(once.anon, false);
assert.equal(once.authenticated, false);
assert.equal(once.service_role, true);
assert.equal(historical(), historicalBefore);

const reportDate = sql(`select report_date::text from line_delivery_outbox
  where push_type='daily_report' and status='SENT'
  group by report_date having count(*)=1 order by report_date limit 1;`);
assert.match(reportDate, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(sql(`select count(*) from market_checkpoint_snapshots where trading_date=${q(reportDate)} and checkpoint='PREMARKET';`), '6');

function captureAt(time, label) {
  const at = `${reportDate}T${time}:00+08:00`;
  const output = sql(`begin;
    update line_delivery_outbox set sent_at=${q(at)} where report_date=${q(reportDate)} and push_type='daily_report';
    update market_checkpoint_snapshots set captured_at=${q(at)},created_at=${q(at)}::timestamptz+interval '3 seconds'
      where trading_date=${q(reportDate)} and checkpoint='PREMARKET';
    update runtime_http_dispatches set completed_at=${q(at)} where trading_date=${q(reportDate)} and job_name='daily_delivery' and dispatch_status='SUCCEEDED';
    update runtime_http_dispatches set dispatch_status='SKIPPED',response_success=true,response_error_code=null
      where trading_date=${q(reportDate)} and dispatch_status in ('FAILED','TIMED_OUT','DEAD_LETTERED');
    update runtime_dead_letters set status='resolved',resolved_at=${q(at)}
      where status='open' and (context->>'trading_date'=${q(reportDate)} or context->>'dispatch_id' in
        (select id::text from runtime_http_dispatches where trading_date=${q(reportDate)}));
    set local role service_role;
    create temp table isolated_acceptance_boundary on commit drop as
      select public.capture_morning_alpha_acceptance_v1(${q(reportDate)},${q('ISOLATED_ACCEPTANCE_WINDOW_' + label)}) id;
    select row_to_json(a) from production_acceptance_results a join isolated_acceptance_boundary b on b.id=a.id;
    rollback;`);
  return JSON.parse(output.split('\n').find(line => line.startsWith('{')) || 'null');
}

for (const [time, verdict, sla, recovered] of [
  ['07:00', 'PASS', 'PASS', false],
  ['07:29', 'PASS', 'PASS', false],
  ['07:31', 'PASS', 'MISS', true],
  ['08:00', 'PASS', 'MISS', true],
  ['08:30', 'PASS', 'MISS', true],
  ['08:44', 'PASS', 'MISS', true],
  ['08:45', 'FAIL', 'MISS', false],
]) test(`actual isolated Acceptance classifies ${time} without mixing readiness and SLA`, () => {
  const result = captureAt(time, time.replace(':', ''));
  assert.ok(result);
  assert.equal(result.verdict, verdict, JSON.stringify(result.blocking_checks));
  assert.equal(result.evidence.lifecycle_status, verdict);
  assert.equal(result.evidence.readiness_status, verdict === 'PASS' ? 'PASS' : 'FAIL');
  assert.equal(result.evidence.delivery_sla_status, sla);
  assert.equal(result.evidence.recovered_within_readiness_window, recovered);
  assert.equal(result.evidence.readiness_deadline_at, `${reportDate}T08:45:00+08:00`);
  assert.equal(result.evidence.delivery_sla_deadline_at, `${reportDate}T07:30:00+08:00`);
  assert.equal(result.evidence.automatic_blocking_checks.includes('REPORT_DELIVERY_NOT_ON_TIME'), sla === 'MISS');
  assert.equal(result.blocking_checks.includes('READINESS_WINDOW_DEADLINE_EXCEEDED'), verdict === 'FAIL');
  assert.equal(historical(), historicalBefore);
});

test('migration and all rolled-back boundary observations preserve every historical Acceptance row', () => {
  assert.equal(historical(), historicalBefore);
});
