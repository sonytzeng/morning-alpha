// Fresh, loopback-only PostgreSQL. Exact 9/29 Recorder rows are never redated.
// No Production credentials, external dispatch or Production writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const scope = 'ma-runtime-sparse-recovery-20260929';
const db = process.env.MA_ISOLATED_TEST_DB;
const port = process.env.MA_TEST_PGPORT || '55439';
const container = process.env.MA_TEST_DOCKER_CONTAINER;
if (container) assert.match(container, /^ma-runtime-sparse-ci-[0-9]+$/);
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.match(db || '', /^ma_runtime_sparse_test\d+$/);
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const read = path => readFileSync(new URL(path, root), 'utf8');
const args = database => ['-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', port, '-d', database, '-v', 'ON_ERROR_STOP=1'];
function sql(statement, database = db, allowFailure = false) {
  const command = container ? 'docker' : 'psql';
  const commandArgs = container
    ? ['exec', '--env', 'PGUSER=postgres', '--env', 'PGPASSWORD=isolated-ci-only', container,
      'psql', ...args(database), '-c', statement]
    : [...args(database), '-c', statement];
  try { return { ok: true, text: execFileSync(command, commandArgs, {
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
  }).trim() }; } catch (error) {
    if (!allowFailure) throw new Error(String(error.stderr || error.message));
    return { ok: false, text: String(error.stderr || error.message) };
  }
}
const load = path => sql(read(path));
assert.match(sql('select host(inet_server_addr());', 'postgres').text, /^(127\.|10\.|172\.|192\.168\.)/);
assert.equal(sql(`select count(*) from pg_database where datname=${q(db)}`, 'postgres').text, '0');
sql(`create database ${db}`, 'postgres');
load('tests/fixtures/checkpoint-atomicity-baseline.sql');
sql(`create schema ma_isolated_guard; create table ma_isolated_guard.identity(scope text primary key);
  insert into ma_isolated_guard.identity values (${q(scope)});`);
for (const path of [
  '20260911033927_checkpoint_snapshot_atomic_batch_v1.sql',
  '20260917120000_premarket_atomic_readiness_window_v1.sql',
  '20260921120000_premarket_txf_session_date_parity_v1.sql',
  '20260922015748_premarket_tw_cash_phase_contract_v1.sql',
  '20260923120000_premarket_ticker_envelope_session_parity_v1.sql',
  '20260924004011_atomic_txf_minute_boundary_parity_v1.sql',
]) load('supabase/migrations/' + path);

// Reproduce just the catalog-pinned current lifecycle objects, not historical
// scheduler/secrets migrations. The prerequisite stub contains no business data.
sql('create table public.runtime_http_dispatches(id uuid primary key);');
const history = read('supabase/migrations/20260827084613_production_reliability_daily_lifecycle.sql');
sql(history.match(/create table if not exists public\.runtime_lifecycle_events \([\s\S]*?\n\);/)[0]);
const canonical = read('supabase/migrations/20260907072722_reconcile_canonical_schema_truth.sql');
const predecessor = canonical.match(/CREATE OR REPLACE FUNCTION public\.advance_trading_day_state_v1\([\s\S]*?\$function\$;/)[0];
sql(predecessor);
sql('revoke all on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb) from public,anon,authenticated; grant execute on function public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb) to service_role;');
const signature = 'public.advance_trading_day_state_v1(date,text,text,text,uuid,jsonb)';
const hash = () => sql(`select md5(pg_get_functiondef(${q(signature)}::regprocedure))`).text;
assert.equal(hash(), 'b8499733b0eb7ac12565594aecce9928');
const catalog = () => sql(`select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,
  'config',proconfig,'defaults',proargdefaults::text,'result',prorettype) from pg_proc where oid=${q(signature)}::regprocedure`).text;
const beforeCatalog = catalog();
const atomicHash = () => sql("select md5(pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure))").text;
const beforeAtomic = atomicHash();
const fixtureBytes = read('tests/fixtures/production-parity-v4/runtime-sparse-recovery-20260929.json');
const fixture = JSON.parse(fixtureBytes);
assert.equal(fixture.synthetic, false);
assert.equal(fixture.captures.length, 2);
const exactDate = '2026-09-29';
const currentDate = sql("select (clock_timestamp() at time zone 'Asia/Taipei')::date").text;
// Exact historical success requires the dedicated isolation clock to be 9/29.
// A different clock must fail, never silently relabel this real fixture.
assert.equal(currentDate, exactDate, 'TEST_ENVIRONMENT: use controlled 2026-09-29 isolated PostgreSQL clock; do not rewrite Recorder evidence');
const date = q(exactDate) + '::date';
const first = fixture.captures[0], second = fixture.captures[1];
const key = cp => `market-checkpoint:${exactDate}:${cp}:MARKET_CHECKPOINT_PROVIDER_V1`;
const state = cp => ({ '1410': 'CLOSE_1410_CAPTURED', '1430': 'CLOSE_1430_CAPTURED' })[cp];
function commit(capture, rows = capture.rows) {
  return `select public.commit_market_checkpoint_batch_v1(${date},${q(capture.checkpoint)},'close',
    ${q(capture.correlation_id)}::uuid,${q(key(capture.checkpoint))},${q(JSON.stringify(rows))}::jsonb);`;
}
function advance(capture = first, overrides = {}) {
  return `select to_jsonb(public.advance_trading_day_state_v1(
    ${q(overrides.date || exactDate)}::date,${q(overrides.state || state(capture.checkpoint))},
    ${q(overrides.checkpoint || capture.checkpoint)},'SUCCEEDED',
    ${q(overrides.correlation || capture.correlation_id)}::uuid,
    jsonb_build_object('atomic_checkpoint_complete',true,
      'atomic_batch_id',${overrides.batch || `(select batch_id from market_checkpoint_batches where checkpoint=${q(capture.checkpoint)})`},
      'atomic_idempotency_key',${q(overrides.key || key(capture.checkpoint))})))
    - 'created_at' - 'updated_at' - 'last_metadata';`;
}
const failed = `select public.advance_trading_day_state_v1(${date},'PREMARKET_CAPTURED','premarket','FAILED',
  '00000000-0000-4000-8000-000000000001','{"reason_codes":["FUGLE_ENTITLEMENT_DENIED"],"delivery_sla":"MISS"}');`;
const failedQuery = `select checkpoint_status->'premarket' from trading_day_state where trading_date=${date}`;
const transaction = (body, fail = false) => sql(`begin; ${body} rollback;`, db, fail);
const oldFailure = transaction(failed + commit(first) + advance(first), true);
assert.equal(oldFailure.ok, false);
assert.match(oldFailure.text, /current=0, requested=90/);
const secondOldFailure = transaction(failed + commit(second) + advance(second), true);
assert.match(secondOldFailure.text, /current=0, requested=100/);

const sequential = ['SCHEDULED','PREMARKET_CAPTURED','REPORT_GENERATED','EDITORIAL_APPROVED',
  'PREMARKET_DELIVERED','MARKET_OPEN_CAPTURED','CHECKPOINT_0930_CAPTURED','CHECKPOINT_1030_CAPTURED',
  'CHECKPOINT_1300_CAPTURED','CLOSE_1410_CAPTURED','CLOSE_1430_CAPTURED','CLOSING_VERIFIED',
  'FEEDBACK_COMPLETED','LEARNING_COMPLETED','HEALTH_AUDITED','DAY_COMPLETED'];
const sequenceSQL = sequential.map((name, index) => `select (public.advance_trading_day_state_v1(${date},${q(name)},
  ${q('normal_' + index)},'SUCCEEDED','00000000-0000-4000-8000-000000000002','{}')).state_rank;`).join('\n');
const normalBefore = transaction(sequenceSQL).text;
const migration = 'supabase/migrations/20260929145000_runtime_checkpoint_sparse_recovery_v1.sql';
load(migration);
const candidateHash = hash();
assert.notEqual(candidateHash, 'b8499733b0eb7ac12565594aecce9928');
assert.equal(catalog(), beforeCatalog);
assert.equal(atomicHash(), beforeAtomic);
load(migration);
assert.equal(hash(), candidateHash);
assert.equal(catalog(), beforeCatalog);
assert.equal(transaction(sequenceSQL).text, normalBefore);

// Durable fresh-isolation exact Recorder replay. Only real RPCs write outputs.
sql(failed);
const historicalFailure = sql(failedQuery).text;
sql(commit(first));
const firstAdvance = sql(advance(first));
assert.match(firstAdvance.text, /"state_rank": 90/);
assert.match(firstAdvance.text, /ACCEPTED_BY_SPARSE_RECOVERY/);
sql(commit(second));
assert.match(sql(advance(second)).text, /"state_rank": 100/);
assert.equal(sql(failedQuery).text, historicalFailure);
sql(advance(second));
assert.equal(sql("select count(*) from market_checkpoint_snapshots").text, '22');
assert.equal(sql("select count(*) from market_checkpoint_batches").text, '2');
assert.equal(sql("select count(*) from authoritative_market_data_snapshots_v1 where trading_date='2026-09-29'").text, '22');
assert.equal(sql("select count(*) from runtime_lifecycle_events where checkpoint='1430' and status='SUCCEEDED'").text, '1');
assert.equal(sql(`select count(*) from trading_day_state where trading_date=${date}+1`).text, '0');

// Model corruption only inside rolled-back local administrator transactions.
// Production immutable rows, triggers and indexes are never altered.
const resetState = `delete from runtime_lifecycle_events; delete from trading_day_state; ${failed}`;
function reject(name, body, expected = /lifecycle_predecessor_not_satisfied|ATOMIC_CHECKPOINT|duplicate key|check constraint/) {
  const result = transaction(resetState + body, true);
  assert.equal(result.ok, false, name);
  assert.match(result.text, expected, name);
}
reject('wrong correlation', advance(first, { correlation: '00000000-0000-4000-8000-000000000099' }));
reject('wrong date', advance(first, { date: '2026-09-28' }));
reject('future date', advance(first, { date: '2026-09-30' }));
reject('wrong checkpoint/state', advance(first, { checkpoint: '1300' }));
reject('invented batch', advance(first, { batch: "'00000000-0000-4000-8000-000000000099'" }));
reject('wrong idempotency key', advance(first, { key: 'fabricated' }));
reject('not a runtime checkpoint', advance(first, { checkpoint: 'closing_verification', state: 'CLOSING_VERIFIED' }));
reject('no prior terminal failure', `delete from runtime_lifecycle_events; delete from trading_day_state; ${advance(first)}`);
for (const prior of ['SCHEDULED','RUNNING','SKIPPED']) {
  reject('prior ' + prior, `update trading_day_state set checkpoint_status=jsonb_set(checkpoint_status,'{premarket,status}',${q(JSON.stringify(prior))}); ${advance(first)}`);
}
const corrupt = statement => `set local session_replication_role=replica; ${statement} set local session_replication_role=origin;`;
reject('partial batch 10/11', corrupt("delete from market_checkpoint_snapshots where checkpoint='1410' and provider_key='TXF';") + advance(first));
reject('no batch', corrupt("delete from market_checkpoint_snapshots where checkpoint='1410'; delete from market_checkpoint_batches where checkpoint='1410';") + advance(first));
reject('duplicate authoritative batch', "insert into market_checkpoint_batches select gen_random_uuid(),business_date,checkpoint,market_session,correlation_id,idempotency_key||':duplicate',provider_contract_version,status,expected_provider_count,committed_provider_count,payload_hash,committed_at,created_at from market_checkpoint_batches where checkpoint='1410';");
reject('mixed revision', corrupt("update market_checkpoint_snapshots set correlation_id=gen_random_uuid() where checkpoint='1410' and provider_key='TXF';") + advance(first));
reject('stale evidence', corrupt("update market_checkpoint_snapshots set source_timestamp=source_timestamp-interval '8 days' where checkpoint='1410' and provider_key='TXF';") + advance(first));
reject('future evidence', corrupt("update market_checkpoint_snapshots set source_timestamp=clock_timestamp()+interval '1 day' where checkpoint='1410' and provider_key='TXF';") + advance(first));
reject('wrong session', corrupt("update market_checkpoint_snapshots set market_session='intraday' where checkpoint='1410' and provider_key='TXF';") + advance(first));
reject('stale committed batch', corrupt("update market_checkpoint_batches set committed_at=committed_at-interval '1 day' where checkpoint='1410';") + advance(first));
reject('future committed batch', corrupt("update market_checkpoint_batches set committed_at=clock_timestamp()+interval '1 hour' where checkpoint='1410';") + advance(first));
assert.equal(sql(failedQuery).text, historicalFailure);
assert.equal(atomicHash(), beforeAtomic);
console.log(JSON.stringify({ status: 'PASS', schema: 'FRESH_ISOLATION', predecessor: 'b8499733b0eb7ac12565594aecce9928',
  candidate: candidateHash, real_evidence_sha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  recorder_replays: '1410+1430', before: 'REJECTED_90_100', after: 'RECOVERED_90_THEN_100',
  sequential_unchanged: true, atomic_unchanged: true, historical_failure_unchanged: true,
  idempotent_retry: true, cross_day_state_leak: 0, production_writes: 0,
  full_handler_shadow: 'SEPARATE_GATE_NOT_CLAIMED_BY_DATABASE_TEST' }));
