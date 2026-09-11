// Opt-in PostgreSQL fault-injection regression for the 11-provider checkpoint
// commit. It creates a brand-new local database and never connects to Supabase,
// Production, Auth, providers, Cron, LINE or any external service.
//
// MA_LOCAL_SCOPE=ma-checkpoint-atomicity-20260911
// MA_ISOLATED_TEST_DB=ma_checkpoint_atomicity_test<digits>
// node --test tests/checkpointAtomicityDatabase.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const scope = 'ma-checkpoint-atomicity-20260911';
const database = process.env.MA_ISOLATED_TEST_DB;
const host = '127.0.0.1';
const port = process.env.MA_TEST_PGPORT || '55439';
const bin = process.env.MA_TEST_PSQL || 'psql';
const providerKeys = ['SPX', 'IXIC', 'SOX', 'NVDA', 'TSM', 'VIX', 'DXY', 'US10Y', 'TAIEX', '2330', 'TXF'];

if (process.env.MA_LOCAL_SCOPE !== scope || !/^ma_checkpoint_atomicity_test\d+$/.test(database || '')) {
  throw new Error('EXPLICIT_FRESH_LOCAL_CHECKPOINT_DATABASE_SCOPE_REQUIRED');
}

const q = value => `'${String(value).replaceAll("'", "''")}'`;
const j = value => `${q(JSON.stringify(value))}::jsonb`;
const args = (db = database) => ['-X', '-q', '-h', host, '-p', port, '-d', db, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
function command(text, db = database, options = {}) {
  try {
    return execFileSync(bin, [...args(db), '-c', text], {
      encoding: 'utf8', timeout: options.timeout || 30000, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) },
    }).trim();
  } catch (error) {
    throw new Error(`LOCAL_SQL_FAILED: ${error.stderr?.toString().trim() || error.message}`);
  }
}
async function commandAsync(text, options = {}) {
  try {
    const result = await execFileAsync(bin, [...args(), '-c', text], {
      encoding: 'utf8', timeout: options.timeout || 30000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) },
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`LOCAL_SQL_FAILED: ${error.stderr?.toString().trim() || error.message}`);
  }
}
function loadFile(path) {
  try {
    execFileSync(bin, [...args(), '-f', new URL('../' + path, import.meta.url).pathname], {
      encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`LOCAL_SQL_FILE_FAILED:${path}: ${error.stderr?.toString().trim() || error.message}`);
  }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(40);
  }
  throw new Error(`${message}: ${String(last || 'timeout')}`);
}

// Verify the actual endpoint before creating anything.
const serverAddress = command('select host(inet_server_addr());', 'postgres');
const githubIsolatedService = process.env.GITHUB_ACTIONS === 'true'
  && /^(?:172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|10\.)/.test(serverAddress)
  && command('select inet_server_port();', 'postgres') === '5432';
assert.ok(serverAddress === '127.0.0.1' || githubIsolatedService,
  'Only local loopback or this workflow isolated PostgreSQL service is allowed');
assert.equal(command(`select count(*) from pg_database where datname=${q(database)};`, 'postgres'), '0',
  'Never reuse or reset a prior test database');
command(`create database ${database};`, 'postgres');
assert.equal(command('select current_database();'), database);
loadFile('tests/fixtures/checkpoint-atomicity-baseline.sql');
command(`create schema ma_isolated_guard;
  create table ma_isolated_guard.identity(scope text primary key);
  insert into ma_isolated_guard.identity values(${q(scope)});`);
function sql(text, options) {
  assert.equal(command('select scope from ma_isolated_guard.identity;'), scope);
  return command(text, database, options);
}

// Reproduce the immutable Production incident shape before adding any columns or
// guards: first attempt 10 rows (2330 absent), retry 11 rows, different values.
const legacyCorrelationA = '11111111-1111-4111-8111-111111111111';
const legacyCorrelationB = '22222222-2222-4222-8222-222222222222';
const providerArray = `array[${providerKeys.map(q).join(',')}]::text[]`;
sql(`with providers as (
    select provider_key, ordinality::integer as ordinal
    from unnest(${providerArray}) with ordinality item(provider_key, ordinality)
  )
  insert into public.market_checkpoint_snapshots(
    checkpoint,trading_date,captured_at,market_session,symbol,value,change_percent,
    source,source_timestamp,correlation_id,raw
  )
  select '0900','2026-09-11','2026-09-11T09:05:00+08:00','intraday',provider_key,
    1000 + ordinal, ordinal / 10.0, 'P0_FIRST_ATTEMPT',
    '2026-09-11T09:04:00+08:00',${q(legacyCorrelationA)}::uuid,
    jsonb_build_object('contract','FETCH_CHECKPOINT_EVIDENCE_V1','attempt',1)
  from providers where provider_key <> '2330';
  with providers as (
    select provider_key, ordinality::integer as ordinal
    from unnest(${providerArray}) with ordinality item(provider_key, ordinality)
  )
  insert into public.market_checkpoint_snapshots(
    checkpoint,trading_date,captured_at,market_session,symbol,value,change_percent,
    source,source_timestamp,correlation_id,raw
  )
  select '0900','2026-09-11','2026-09-11T09:07:00+08:00','intraday',provider_key,
    2000 + ordinal, ordinal / 5.0, 'P0_RETRY',
    '2026-09-11T09:06:00+08:00',${q(legacyCorrelationB)}::uuid,
    jsonb_build_object('contract','FETCH_CHECKPOINT_EVIDENCE_V1','attempt',2)
  from providers;
  insert into public.market_data_snapshots(
    symbol,name,market,value,change_percent,captured_at,source,phase,trading_date,raw,checkpoint
  ) values
    ('TAIEX','Legacy TAIEX','TW',999,0,'2026-09-10T09:00:00+08:00','LEGACY','intraday','2026-09-10','{}','0900'),
    ('TAIEX','Incident TAIEX','TW',1000,0,'2026-09-11T09:00:00+08:00','INCIDENT','intraday','2026-09-11','{}','0900');`);
const legacyDigest = () => sql(`select md5(string_agg(concat_ws('|',
    id::text,checkpoint,trading_date::text,captured_at::text,market_session,symbol,value::text,
    change_percent::text,source,source_timestamp::text,correlation_id::text,
    snapshot_version::text,raw::text,created_at::text), E'\n' order by snapshot_version))
  from public.market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';`);
const legacyBefore = legacyDigest();
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';"), '21');

loadFile('supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql');
loadFile('supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql');

// Test-only row factory and deterministic write-fault trigger. These objects are
// created only in this fresh database and are not part of the migration.
sql(`create or replace function ma_isolated_guard.checkpoint_rows(
    p_date date, p_checkpoint text, p_delta numeric default 0
  ) returns jsonb language sql immutable set search_path='' as $function$
    with identity as (
      select case p_checkpoint
        when '0900' then '09:05:00' when '0930' then '09:30:00'
        when '1030' then '10:30:00' when '1300' then '13:00:00'
        when '1410' then '14:15:00' when '1430' then '14:35:00'
      end as local_time
    )
    select jsonb_agg(jsonb_build_object(
      'provider_key',provider_key,'symbol',provider_key,
      'value',1000 + ordinal + p_delta,'change_percent',ordinal / 10.0,
      'source','ISOLATED_PROVIDER_' || provider_key,
      'source_timestamp',p_date::text || 'T' || local_time || '+08:00',
      'captured_at',p_date::text || 'T' || local_time || '+08:00',
      'raw',jsonb_build_object(
        'contract','FETCH_CHECKPOINT_EVIDENCE_V1',
        'market',case when ordinal >= 9 then 'TW' else 'US' end,
        'name',provider_key,'source_symbol',provider_key,'change',ordinal / 10.0,
        'source_raw',jsonb_build_object('isolated_fixture',true),
        'freshness_status',case when ordinal >= 9 then 'fresh' else 'provider_returned' end,
        'freshness_age_minutes',0,'captured_session_date',p_date::text,'fallback_used',false
      )
    ) order by ordinal)
    from unnest(public.market_checkpoint_provider_contract_v1())
      with ordinality item(provider_key,ordinal), identity;
  $function$;

  create or replace function ma_isolated_guard.fail_checkpoint_insert()
  returns trigger language plpgsql set search_path='' as $function$
  begin
    if nullif(current_setting('ma_test.fail_provider',true),'') = new.provider_key then
      raise exception 'SIMULATED_DB_INSERT_FAILURE:%', new.provider_key;
    end if;
    return new;
  end;
  $function$;
  create trigger aaa_isolated_checkpoint_insert_failure
    before insert on public.market_checkpoint_snapshots
    for each row execute function ma_isolated_guard.fail_checkpoint_insert();
  grant usage on schema ma_isolated_guard to service_role;
  grant execute on function ma_isolated_guard.checkpoint_rows(date,text,numeric) to service_role;`);

const sessionFor = checkpoint => ['1410', '1430'].includes(checkpoint) ? 'close' : 'intraday';
const keyFor = (date, checkpoint) => `market-checkpoint:${date}:${checkpoint}:MARKET_CHECKPOINT_PROVIDER_V1`;
const rowsExpr = (date, checkpoint, delta = 0) =>
  `ma_isolated_guard.checkpoint_rows(${q(date)}::date,${q(checkpoint)},${Number(delta)})`;
const incompleteExpr = (date, checkpoint, omittedOrdinal) =>
  `(select jsonb_agg(item order by ordinality) from jsonb_array_elements(${rowsExpr(date, checkpoint)}) with ordinality rows(item,ordinality) where ordinality<>${omittedOrdinal})`;
function commitText(date, checkpoint, correlation = randomUUID(), rows = rowsExpr(date, checkpoint), overrides = {}) {
  const session = overrides.session || sessionFor(checkpoint);
  const key = overrides.idempotencyKey || keyFor(date, checkpoint);
  return `set role service_role; select public.commit_market_checkpoint_batch_v1(
    ${q(date)}::date,${q(checkpoint)},${q(session)},${q(correlation)}::uuid,${q(key)},${rows})::text;`;
}
function commit(date, checkpoint, correlation, rows, overrides) {
  return JSON.parse(sql(commitText(date, checkpoint, correlation, rows, overrides)));
}
function canonicalState(date, checkpoint) {
  return JSON.parse(sql(`select json_build_object(
    'rows',(select count(*) from public.market_checkpoint_snapshots where trading_date=${q(date)}::date and checkpoint=${q(checkpoint)}),
    'batches',(select count(*) from public.market_checkpoint_batches where business_date=${q(date)}::date and checkpoint=${q(checkpoint)}),
    'compatibility',(select count(*) from public.market_data_snapshots where trading_date=${q(date)}::date and checkpoint=${q(checkpoint)}),
    'correlations',(select count(distinct correlation_id) from public.market_checkpoint_snapshots where trading_date=${q(date)}::date and checkpoint=${q(checkpoint)}),
    'batch_ids',(select count(distinct batch_id) from public.market_checkpoint_snapshots where trading_date=${q(date)}::date and checkpoint=${q(checkpoint)}),
    'integrity',public.market_checkpoint_batch_integrity_v1(${q(date)}::date,${q(checkpoint)}));`));
}
function assertZero(date, checkpoint) {
  const state = canonicalState(date, checkpoint);
  assert.equal(state.rows, 0);
  assert.equal(state.batches, 0);
  assert.equal(state.compatibility, 0);
  assert.equal(state.integrity.status, 'MISSING');
}
function assertEleven(date, checkpoint) {
  const state = canonicalState(date, checkpoint);
  assert.deepEqual({ rows: state.rows, batches: state.batches, compatibility: state.compatibility,
    correlations: state.correlations, batch_ids: state.batch_ids, integrity: state.integrity.status },
  { rows: 11, batches: 1, compatibility: 11, correlations: 1, batch_ids: 1, integrity: 'PASS' });
}

test('migration twice preserves the immutable 2026-09-11 10+11 incident exactly and Acceptance records FAIL', () => {
  assert.equal(legacyDigest(), legacyBefore);
  assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';"), '21');
  const integrity = JSON.parse(sql("select public.market_checkpoint_batch_integrity_v1('2026-09-11','0900');"));
  assert.equal(integrity.status, 'FAIL');
  assert.equal(integrity.canonical_row_count, 21);
  assert.equal(integrity.unbatched_row_count, 21);
  assert.equal(integrity.production_2026_09_11_evidence_preserved, true);
  assert.equal(sql("select count(*) from authoritative_market_data_snapshots_v1 where trading_date='2026-09-10';"), '1');
  assert.equal(sql("select count(*) from authoritative_market_data_snapshots_v1 where trading_date='2026-09-11';"), '0');
  assert.throws(() => commit('2026-09-11', '0900'), /ATOMIC_CHECKPOINT_CUTOVER_REJECTED/);
  assert.throws(() => sql(`insert into market_checkpoint_snapshots(
    checkpoint,trading_date,captured_at,market_session,symbol,value,change_percent,source,source_timestamp,correlation_id,raw
  ) values('0900','2026-09-11','2026-09-11T09:08:00+08','intraday','2330',1,0,'RETRY','2026-09-11T09:08:00+08',gen_random_uuid(),'{}');`),
  /ATOMIC_CHECKPOINT_DIRECT_INSERT_REJECTED/);
  const row = JSON.parse(sql(`set role service_role;
    insert into public.production_acceptance_results(
      business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence
    ) values('2026-09-11','P0_ATOMICITY_TEST',${q('2026-09-11:p0-atomicity-test')},'PASS','{}','{}')
    returning json_build_object('verdict',verdict,'blocking',blocking_checks,'evidence',evidence);`));
  assert.equal(row.verdict, 'FAIL');
  assert.ok(row.blocking.includes('CHECKPOINT_0900_INTEGRITY_VIOLATION'));
  assert.equal(row.evidence.checkpoint_atomicity['0900'].canonical_row_count, 21);
});

test('provider 1/5/11 timeout and HTTP 500 leave 0; a complete retry writes exactly 11', () => {
  const cases = [
    ['provider-1-timeout', '2026-09-12', '0900', 1],
    ['provider-5-timeout', '2026-09-13', '0930', 5],
    ['provider-11-timeout', '2026-09-14', '1030', 11],
    ['provider-http-500', '2026-09-15', '1300', 6],
  ];
  for (const [label, date, checkpoint, ordinal] of cases) {
    assert.throws(() => commit(date, checkpoint, randomUUID(), incompleteExpr(date, checkpoint, ordinal)),
      /ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY/, label);
    assertZero(date, checkpoint);
    const retry = commit(date, checkpoint);
    assert.equal(retry.row_count, 11, label);
    assert.equal(retry.reused, false, label);
    assertEleven(date, checkpoint);
  }
});

test('stale, malformed, duplicate provider, wrong session and wrong idempotency all fail closed', () => {
  const cases = [
    ['stale', '2026-09-16', '1410',
      `jsonb_set(${rowsExpr('2026-09-16', '1410')},'{4,raw,freshness_status}','"stale"'::jsonb)`, {}, /ROW_CONTRACT_INVALID/],
    ['malformed', '2026-09-17', '1430',
      `jsonb_set(${rowsExpr('2026-09-17', '1430')},'{4,value}','"bad"'::jsonb)`, {}, /ROW_CONTRACT_INVALID/],
    ['missing-market', '2026-09-17', '1410',
      `(${rowsExpr('2026-09-17', '1410')} #- '{4,raw,market}')`, {}, /ROW_CONTRACT_INVALID/],
    ['missing-freshness-status', '2026-09-18', '1430',
      `(${rowsExpr('2026-09-18', '1430')} #- '{4,raw,freshness_status}')`, {}, /ROW_CONTRACT_INVALID/],
    ['missing-captured-session-date', '2026-09-19', '1300',
      `(${rowsExpr('2026-09-19', '1300')} #- '{4,raw,captured_session_date}')`, {}, /ROW_CONTRACT_INVALID/],
    ['duplicate', '2026-09-20', '0900',
      `jsonb_set(jsonb_set(${rowsExpr('2026-09-20', '0900')},'{10,provider_key}','"SPX"'::jsonb),'{10,symbol}','"SPX"'::jsonb)`, {}, /PROVIDER_CARDINALITY|PROVIDER_SET_MISMATCH/],
    ['wrong-session', '2026-10-03', '0930', rowsExpr('2026-10-03', '0930'), { session: 'close' }, /SESSION_MISMATCH/],
    ['wrong-key', '2026-10-04', '1030', rowsExpr('2026-10-04', '1030'), { idempotencyKey: 'changed-per-retry' }, /IDEMPOTENCY_MISMATCH/],
  ];
  for (const [label, date, checkpoint, rows, overrides, expected] of cases) {
    assert.throws(() => commit(date, checkpoint, randomUUID(), rows, overrides), expected, label);
    assertZero(date, checkpoint);
  }
});

test('database failures at inserted rows 1/5/10 roll back batch, canonical and compatibility rows', () => {
  const cases = [
    ['2026-09-21', '0900', providerKeys[0]],
    ['2026-09-22', '0930', providerKeys[4]],
    ['2026-09-23', '1030', providerKeys[9]],
  ];
  for (const [date, checkpoint, provider] of cases) {
    assert.throws(() => sql(`set role service_role; set ma_test.fail_provider=${q(provider)};
      select public.commit_market_checkpoint_batch_v1(${q(date)},${q(checkpoint)},${q(sessionFor(checkpoint))},
        ${q(randomUUID())},${q(keyFor(date, checkpoint))},${rowsExpr(date, checkpoint)});`),
    /SIMULATED_DB_INSERT_FAILURE/);
    assertZero(date, checkpoint);
    assert.equal(commit(date, checkpoint).row_count, 11);
    assertEleven(date, checkpoint);
  }
});

test('duplicate Cron trigger and 2x/10x retries with changed timestamp/correlation reuse the first immutable 11 rows', () => {
  const date = '2026-09-24', checkpoint = '0900';
  const firstCorrelation = randomUUID();
  const first = commit(date, checkpoint, firstCorrelation);
  const before = sql(`select md5(string_agg(to_jsonb(s)::text,E'\n' order by provider_key))
    from market_checkpoint_snapshots s where trading_date=${q(date)} and checkpoint=${q(checkpoint)};`);
  for (let attempt = 0; attempt < 10; attempt++) {
    const changed = `jsonb_set(jsonb_set(${rowsExpr(date, checkpoint, 100 + attempt)},
      '{0,captured_at}',to_jsonb(${q(date + 'T09:06:00+08:00')}::text)),
      '{0,source_timestamp}',to_jsonb(${q(date + 'T09:06:00+08:00')}::text))`;
    const retry = commit(date, checkpoint, randomUUID(), changed);
    assert.equal(retry.reused, true);
    assert.equal(retry.payload_matches, false);
    assert.equal(retry.correlation_id, firstCorrelation);
    assert.equal(retry.batch_id, first.batch_id);
    assert.equal(retry.row_count, 11);
  }
  assertEleven(date, checkpoint);
  assert.equal(sql(`select md5(string_agg(to_jsonb(s)::text,E'\n' order by provider_key))
    from market_checkpoint_snapshots s where trading_date=${q(date)} and checkpoint=${q(checkpoint)};`), before);
});

test('explicit pre-commit abort rolls an otherwise valid 11-row RPC back to 0', () => {
  const date = '2026-09-25', checkpoint = '1300';
  sql(`begin; set local role service_role;
    select public.commit_market_checkpoint_batch_v1(${q(date)},${q(checkpoint)},'intraday',${q(randomUUID())},
      ${q(keyFor(date, checkpoint))},${rowsExpr(date, checkpoint)});
    rollback;`);
  assertZero(date, checkpoint);
});

async function killDuringSleep({ date, checkpoint, committed, signal, label }) {
  const appName = `ma-p0-${label}-${randomUUID()}`;
  const call = `select public.commit_market_checkpoint_batch_v1(${q(date)},${q(checkpoint)},${q(sessionFor(checkpoint))},
    ${q(randomUUID())},${q(keyFor(date, checkpoint))},${rowsExpr(date, checkpoint)});`;
  const script = committed
    ? `begin; set local role service_role; ${call} commit; select pg_sleep(30);`
    : `begin; set local role service_role; ${call} select pg_sleep(30); commit;`;
  const child = spawn(bin, [...args(), '-c', script], {
    env: { ...process.env, PGAPPNAME: appName }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  await waitUntil(async () => Number(command(`select count(*) from pg_stat_activity where application_name=${q(appName)} and query like '%pg_sleep%';`)) === 1,
    `${label} did not reach the injected sleep`);
  const visible = Number(sql(`select count(*) from market_checkpoint_snapshots where trading_date=${q(date)} and checkpoint=${q(checkpoint)};`));
  assert.equal(visible, committed ? 11 : 0);
  child.kill(signal);
  await new Promise(resolve => child.once('close', resolve));
  assert.ok(!stderr.includes('ATOMIC_CHECKPOINT_'), stderr);
}

test('network/client loss before commit and process crash cannot expose a partial batch', async () => {
  await killDuringSleep({ date: '2026-09-26', checkpoint: '1410', committed: false, signal: 'SIGTERM', label: 'precommit-network' });
  assertZero('2026-09-26', '1410');
  await killDuringSleep({ date: '2026-09-27', checkpoint: '1430', committed: false, signal: 'SIGKILL', label: 'process-crash' });
  assertZero('2026-09-27', '1430');
});

test('response timeout after commit plus retry retains the same complete 11 rows', async () => {
  const date = '2026-09-28', checkpoint = '0930';
  await killDuringSleep({ date, checkpoint, committed: true, signal: 'SIGKILL', label: 'postcommit-timeout' });
  assertEleven(date, checkpoint);
  const retry = commit(date, checkpoint, randomUUID(), rowsExpr(date, checkpoint, 999));
  assert.equal(retry.reused, true);
  assert.equal(retry.payload_matches, false);
  assertEleven(date, checkpoint);
});

test('2 and 5 concurrent retries serialize to one batch, one correlation and exactly 11 rows', async () => {
  for (const [date, checkpoint, concurrency] of [
    ['2026-09-29', '1030', 2],
    ['2026-09-30', '1300', 5],
  ]) {
    const calls = Array.from({ length: concurrency }, (_, index) =>
      commandAsync(commitText(date, checkpoint, randomUUID(), rowsExpr(date, checkpoint, index * 100))));
    const results = (await Promise.all(calls)).map(JSON.parse);
    assert.equal(results.filter(row => row.reused === false).length, 1);
    assert.equal(new Set(results.map(row => row.batch_id)).size, 1);
    assert.equal(new Set(results.map(row => row.correlation_id)).size, 1);
    assert.ok(results.every(row => row.row_count === 11));
    assertEleven(date, checkpoint);
  }
});

test('all six checkpoints expose 0 before lifecycle success and exactly 11 authoritative rows after it', () => {
  const date = '2026-10-01';
  const checkpoints = ['0900', '0930', '1030', '1300', '1410', '1430'];
  const status = {};
  for (const checkpoint of checkpoints) {
    const result = commit(date, checkpoint);
    assertEleven(date, checkpoint);
    assert.equal(sql(`select count(*) from authoritative_market_data_snapshots_v1 where trading_date=${q(date)} and checkpoint=${q(checkpoint)};`), '0');
    status[checkpoint] = {
      status: 'SUCCEEDED', correlation_id: result.correlation_id, updated_at: date + 'T15:00:00+08:00',
      metadata: { atomic_batch_id: result.batch_id, atomic_checkpoint_complete: true },
    };
  }
  sql(`insert into trading_day_state(trading_date,current_state,state_rank,checkpoint_status,last_metadata)
    values(${q(date)},'DAY_COMPLETED',100,${j(status)},'{}');`);
  for (const checkpoint of checkpoints) {
    assert.equal(sql(`select count(*) from authoritative_market_data_snapshots_v1 where trading_date=${q(date)} and checkpoint=${q(checkpoint)};`), '11');
  }
});

test('deferred database guard rejects direct partial batches and both evidence tables are immutable', () => {
  const date = '2026-10-02', checkpoint = '0900';
  assert.throws(() => sql(`set role service_role;
    insert into market_checkpoint_batches(business_date,checkpoint,market_session,correlation_id,idempotency_key,
      provider_contract_version,status,expected_provider_count,committed_provider_count,payload_hash)
    values(${q(date)},${q(checkpoint)},'intraday',${q(randomUUID())},${q(keyFor(date, checkpoint))},
      'MARKET_CHECKPOINT_PROVIDER_V1','COMMITTED',11,11,'direct-partial');`),
  /ATOMIC_CHECKPOINT_DEFERRED_INTEGRITY_VIOLATION/);
  assertZero(date, checkpoint);
  const committed = commit(date, checkpoint);
  assert.throws(() => sql(`update market_checkpoint_batches set payload_hash='changed' where batch_id=${q(committed.batch_id)};`),
    /market_checkpoint_batch_is_immutable/);
  assert.throws(() => sql(`delete from market_checkpoint_snapshots where batch_id=${q(committed.batch_id)};`),
    /market_checkpoint_evidence_is_immutable/);
  assertEleven(date, checkpoint);
});

test('1000 seeded random fault/retry combinations never produce partial, duplicate or mixed authoritative batches', () => {
  sql(`create table ma_isolated_guard.random_result(total integer,zero_count integer,eleven_count integer);
  do $random_test$
  declare
    v_i integer; v_mode integer; v_retry integer; v_count integer; v_distinct integer;
    v_zero integer := 0; v_eleven integer := 0; v_failed boolean;
    v_date date; v_checkpoint text; v_session text; v_key text; v_rows jsonb; v_result jsonb;
  begin
    perform setseed(0.0911);
    for v_i in 0..999 loop
      v_mode := floor(random() * 20)::integer;
      v_date := date '2030-01-01' + v_i;
      v_checkpoint := (array['0900','0930','1030','1300','1410','1430'])[(v_i % 6) + 1];
      v_session := case when v_checkpoint in ('1410','1430') then 'close' else 'intraday' end;
      v_key := 'market-checkpoint:' || v_date::text || ':' || v_checkpoint || ':MARKET_CHECKPOINT_PROVIDER_V1';
      v_rows := ma_isolated_guard.checkpoint_rows(v_date,v_checkpoint,v_i / 1000.0);
      perform set_config('ma_test.fail_provider','',true);

      if v_mode in (0,1,2,3) then
        select jsonb_agg(item order by ordinality) into v_rows
        from jsonb_array_elements(v_rows) with ordinality rows(item,ordinality)
        where ordinality <> (array[1,5,11,6])[v_mode + 1];
      elsif v_mode = 4 then
        v_rows := jsonb_set(v_rows,'{4,raw,freshness_status}','"stale"'::jsonb);
      elsif v_mode = 5 then
        v_rows := jsonb_set(v_rows,'{4,value}','"malformed"'::jsonb);
      elsif v_mode between 6 and 8 then
        perform set_config('ma_test.fail_provider',(array['SPX','TSM','2330'])[v_mode - 5],true);
      elsif v_mode in (15,16) then
        v_rows := jsonb_set(jsonb_set(v_rows,'{10,provider_key}','"SPX"'::jsonb),'{10,symbol}','"SPX"'::jsonb);
      end if;

      v_failed := false;
      begin
        v_result := public.commit_market_checkpoint_batch_v1(v_date,v_checkpoint,v_session,gen_random_uuid(),v_key,v_rows);
        if v_mode in (9,19) then raise exception 'SIMULATED_UNCOMMITTED_PROCESS_LOSS'; end if;
      exception when others then
        v_failed := true;
      end;
      perform set_config('ma_test.fail_provider','',true);

      if v_mode in (10,11,12,13,14,17,18) then
        if v_failed then raise exception 'RANDOM_VALID_CASE_FAILED:%:%',v_i,v_mode; end if;
        for v_retry in 1..case when v_mode=12 then 10 when v_mode in (10,11,13,14,17,18) then 2 else 0 end loop
          if v_mode = 17 then
            v_rows := jsonb_set(jsonb_set(ma_isolated_guard.checkpoint_rows(v_date,v_checkpoint,500 + v_retry),
              '{0,captured_at}',to_jsonb(v_date::text || case v_checkpoint
                when '0900' then 'T09:06:00+08:00' when '0930' then 'T09:31:00+08:00'
                when '1030' then 'T10:31:00+08:00' when '1300' then 'T13:01:00+08:00'
                when '1410' then 'T14:16:00+08:00' else 'T14:36:00+08:00' end)),
              '{0,source_timestamp}',to_jsonb(v_date::text || case v_checkpoint
                when '0900' then 'T09:06:00+08:00' when '0930' then 'T09:31:00+08:00'
                when '1030' then 'T10:31:00+08:00' when '1300' then 'T13:01:00+08:00'
                when '1410' then 'T14:16:00+08:00' else 'T14:36:00+08:00' end));
          else
            v_rows := ma_isolated_guard.checkpoint_rows(v_date,v_checkpoint,500 + v_retry);
          end if;
          v_result := public.commit_market_checkpoint_batch_v1(v_date,v_checkpoint,v_session,gen_random_uuid(),v_key,v_rows);
          if v_result->>'reused' <> 'true' or (v_result->>'row_count')::integer <> 11 then
            raise exception 'RANDOM_RETRY_NOT_STABLE:%:%',v_i,v_mode;
          end if;
        end loop;
      elsif not v_failed then
        raise exception 'RANDOM_INVALID_CASE_COMMITTED:%:%',v_i,v_mode;
      end if;

      select count(*),count(distinct coalesce(batch_id::text,correlation_id::text))
        into v_count,v_distinct from public.market_checkpoint_snapshots
        where trading_date=v_date and checkpoint=v_checkpoint;
      if v_count not in (0,11) or (v_count=11 and v_distinct<>1) then
        raise exception 'RANDOM_PARTIAL_OR_MIXED_BATCH:%:%:%:%',v_i,v_mode,v_count,v_distinct;
      end if;
      if v_count=0 then v_zero:=v_zero+1; else v_eleven:=v_eleven+1; end if;
    end loop;
    insert into ma_isolated_guard.random_result values(1000,v_zero,v_eleven);
  end;
  $random_test$;`, { timeout: 120000 });
  const result = JSON.parse(sql(`select row_to_json(r) from ma_isolated_guard.random_result r;`));
  assert.equal(result.total, 1000);
  assert.equal(result.zero_count + result.eleven_count, 1000);
  assert.ok(result.zero_count > 500 && result.eleven_count > 200, JSON.stringify(result));
  assert.equal(sql(`select count(*) from (
      select trading_date,checkpoint,count(*) from market_checkpoint_snapshots
      where trading_date>=date '2030-01-01' group by trading_date,checkpoint having count(*)<>11
    ) partial;`), '0');
  assert.equal(sql(`select count(*) from (
      select trading_date,checkpoint,provider_key,count(*) from market_checkpoint_snapshots
      where trading_date>=date '2030-01-01' group by trading_date,checkpoint,provider_key having count(*)<>1
    ) duplicates;`), '0');
  assert.equal(sql(`select count(*) from (
      select trading_date,checkpoint,count(distinct batch_id) batches,count(distinct correlation_id) correlations
      from market_checkpoint_snapshots where trading_date>=date '2030-01-01'
      group by trading_date,checkpoint having count(distinct batch_id)<>1 or count(distinct correlation_id)<>1
    ) mixed;`), '0');
});

test('private grants and authoritative-view contract remain fail-closed', () => {
  const acl = JSON.parse(sql(`select json_build_object(
    'anon_rpc',has_function_privilege('anon','public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)','EXECUTE'),
    'auth_rpc',has_function_privilege('authenticated','public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)','EXECUTE'),
    'service_rpc',has_function_privilege('service_role','public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)','EXECUTE'),
    'anon_view',has_table_privilege('anon','public.authoritative_market_data_snapshots_v1','SELECT'),
    'service_view',has_table_privilege('service_role','public.authoritative_market_data_snapshots_v1','SELECT'),
    'batch_rls',(select relrowsecurity and relforcerowsecurity from pg_class where oid='public.market_checkpoint_batches'::regclass));`));
  assert.deepEqual(acl, {
    anon_rpc: false, auth_rpc: false, service_rpc: true,
    anon_view: false, service_view: true, batch_rls: true,
  });
});
