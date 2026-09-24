// Opt-in fresh PostgreSQL 17 replay of the exact sanitized 9/24 Production
// Atomic candidate. It never connects to Production or external providers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scope = 'ma-atomic-row-contract-20260924';
const database = process.env.MA_ISOLATED_TEST_DB;
const port = process.env.MA_TEST_PGPORT || '55439';
const bin = process.env.MA_TEST_PSQL || 'psql';
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.match(database || '', /^ma_atomic_row_contract_test\d+$/);
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const args = (db = database) => ['-X', '-q', '-h', '127.0.0.1', '-p', port, '-d', db, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];

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
command(`create database ${database};`, 'postgres');
load('tests/fixtures/checkpoint-atomicity-baseline.sql');
command(`create schema ma_isolated_guard;
  create table ma_isolated_guard.identity(scope text primary key);
  insert into ma_isolated_guard.identity values(${q(scope)});`);
const sql = (statement, allowFailure = false) => {
  assert.equal(command('select scope from ma_isolated_guard.identity;').output, scope);
  return command(statement, database, allowFailure);
};

for (const path of [
  'supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql',
  'supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql',
  'supabase/migrations/20260921120000_premarket_txf_session_date_parity_v1.sql',
  'supabase/migrations/20260922015748_premarket_tw_cash_phase_contract_v1.sql',
  'supabase/migrations/20260923120000_premarket_ticker_envelope_session_parity_v1.sql',
]) load(path);

const signature = 'public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)';
assert.equal(sql(`select md5(pg_get_functiondef(${q(signature)}::regprocedure));`).output,
  'e6f6e3804fcfd41b811ea01a575f03e2');
const metadata = () => sql(`select jsonb_build_object(
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatile',provolatile,
  'config',proconfig,'acl',proacl::text,'result',pg_get_function_result(oid))
  from pg_proc where oid=${q(signature)}::regprocedure;`).output;
const metadataBefore = metadata();

const fixture = JSON.parse(readFileSync(new URL('./fixtures/production-parity-v4/atomic-row-20260924.json', import.meta.url), 'utf8'));
assert.equal(fixture.schema_version, 'PRODUCTION_RECORDED_ATOMIC_CANDIDATE_V1');
assert.equal(fixture.evidence_type, 'DEIDENTIFIED_PRODUCTION_RECORDER_EVIDENCE');
assert.equal(fixture.historical_result, 'ATOMIC_0_OF_11_FAIL_UNCHANGED');
assert.equal(fixture.rows.length, 11);
assert.equal(new Set(fixture.rows.map(row => row.provider_key)).size, 11);
assert.deepEqual(fixture.rows.map(row => row.provider_key).sort(),
  ['2330', 'DXY', 'IXIC', 'NVDA', 'SOX', 'SPX', 'TAIEX', 'TSM', 'TXF', 'US10Y', 'VIX']);
assert.equal(fixture.rows.find(row => row.provider_key === 'TXF').source_timestamp,
  '2026-09-23T21:00:00.084Z');

function invoke(rows, businessDate, correlationId = fixture.correlation_id, allowFailure = false) {
  const key = `market-checkpoint:${businessDate}:PREMARKET:MARKET_CHECKPOINT_PROVIDER_V1`;
  return sql(`begin; set role service_role; select public.commit_market_checkpoint_batch_v1(
    ${q(businessDate)}::date,'PREMARKET','premarket',${q(correlationId)}::uuid,
    ${q(key)},${q(JSON.stringify(rows))}::jsonb)::text; rollback;`, allowFailure);
}

// The exact historical payload reproduces the Production rejection before the
// candidate migration. The transaction can never rewrite the retained failure.
const exactBefore = invoke(fixture.rows, fixture.business_date, fixture.correlation_id, true);
assert.equal(exactBefore.ok, false);
assert.match(exactBefore.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/);
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-24';").output, '0');

load('supabase/migrations/20260924004011_atomic_txf_minute_boundary_parity_v1.sql');
const candidateHash = sql(`select md5(pg_get_functiondef(${q(signature)}::regprocedure));`).output;
assert.notEqual(candidateHash, 'e6f6e3804fcfd41b811ea01a575f03e2');
assert.equal(metadata(), metadataBefore);
load('supabase/migrations/20260924004011_atomic_txf_minute_boundary_parity_v1.sql');
assert.equal(sql(`select md5(pg_get_functiondef(${q(signature)}::regprocedure));`).output, candidateHash);
assert.equal(metadata(), metadataBefore);

// Depending on wall-clock time, the preserved 9/24 replay either reaches the
// immutable 08:45 deadline or returns an isolated COMMITTED result that is
// rolled back. It must no longer fail the row contract.
const exactAfter = invoke(fixture.rows, fixture.business_date, fixture.correlation_id, true);
assert.doesNotMatch(exactAfter.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/);
if (exactAfter.ok) assert.match(exactAfter.output, /"row_count": 11/);
else assert.match(exactAfter.output, /PREMARKET_READINESS_DEADLINE_EXCEEDED/);
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-24';").output, '0');

// A clock-forward derivative is used only to prove future commit capability;
// the permanent Production fixture above remains byte-for-byte unchanged.
const shifted = JSON.parse(JSON.stringify(fixture.rows)
  .replaceAll('2026-09-24', '2026-10-20')
  .replaceAll('2026-09-23', '2026-10-19')
  .replaceAll('2026-09-22', '2026-10-18'));
const accepted = invoke(shifted, '2026-10-20');
assert.match(accepted.output, /"row_count": 11/);

function mutated(mutate) {
  const rows = structuredClone(shifted);
  mutate(rows, rows.find(row => row.provider_key === 'TXF'));
  return rows;
}
function rejected(name, rows) {
  const result = invoke(rows, '2026-10-20', fixture.correlation_id, true);
  assert.equal(result.ok, false, name);
  assert.match(result.output, /ATOMIC_CHECKPOINT_(?:ROW_CONTRACT_INVALID|PROVIDER_CARDINALITY|PROVIDER_SET_MISMATCH)/, name);
}

// Minute precision is exact: the complete 05:00 and 13:45 minutes are valid;
// 05:01 and 13:46 remain rejected. Session/date/freshness invariants stay strict.
const afterhoursBoundary = mutated((_rows, txf) => {
  txf.source_timestamp = '2026-10-19T21:00:59.999Z';
  txf.raw.source_raw.captured_at = txf.source_timestamp;
});
assert.match(invoke(afterhoursBoundary, '2026-10-20').output, /"row_count": 11/);
rejected('afterhours-after-minute', mutated((_rows, txf) => {
  txf.source_timestamp = '2026-10-19T21:01:00.000Z';
  txf.raw.source_raw.captured_at = txf.source_timestamp;
}));
const regularBoundary = mutated((_rows, txf) => {
  txf.source_timestamp = '2026-10-19T05:45:59.999Z';
  txf.raw.source_raw.captured_at = txf.source_timestamp;
  txf.raw.captured_session_date = '2026-10-19';
  txf.raw.txf_session_type = 'regular';
  txf.raw.source_raw.session = 'regular';
});
assert.match(invoke(regularBoundary, '2026-10-20').output, /"row_count": 11/);
rejected('regular-after-minute', mutated((_rows, txf) => {
  txf.source_timestamp = '2026-10-19T05:46:00.000Z';
  txf.raw.source_raw.captured_at = txf.source_timestamp;
  txf.raw.captured_session_date = '2026-10-19';
  txf.raw.txf_session_type = 'regular';
  txf.raw.source_raw.session = 'regular';
}));
rejected('wrong-session', mutated((_rows, txf) => {
  txf.raw.txf_session_type = 'regular';
  txf.raw.source_raw.session = 'regular';
}));
rejected('wrong-session-date', mutated((_rows, txf) => {
  txf.raw.txf_provider_session_date = '2026-10-16';
  txf.raw.source_raw.date = '2026-10-16';
}));
rejected('future-source', mutated((_rows, txf) => {
  txf.source_timestamp = '2026-10-20T00:01:00.000Z';
  txf.raw.source_raw.captured_at = txf.source_timestamp;
}));
rejected('stale-source', mutated((_rows, txf) => {
  txf.source_timestamp = '2026-10-11T21:00:00.084Z';
  txf.raw.source_raw.captured_at = txf.source_timestamp;
}));
rejected('missing-source-timestamp', mutated((_rows, txf) => { delete txf.source_timestamp; }));
rejected('partial-batch', shifted.slice(0, 10));

assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date in ('2026-09-24','2026-10-20');").output, '0');
console.log('2026_09_24_PROVIDER_PASS_ATOMIC_FAIL_REGRESSION=PASS; REJECTED_PROVIDER=TXF; REJECTED_FIELD=source_timestamp.afterhours_window; EDGE_DB_PARITY=PASS; ATOMIC_0_OR_11=UNCHANGED; EXACT_HISTORY=0; INVALID_ROWS_ACCEPTED=0');
