// Opt-in fresh local PostgreSQL replay for the sole 9/22 candidate migration.
// It never connects to Production and never writes external business data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  CHECKPOINT_PROVIDER_KEYS,
  buildCheckpointEvidence,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const scope = 'ma-tw-cash-phase-contract-20260922';
const database = process.env.MA_ISOLATED_TEST_DB;
const port = process.env.MA_TEST_PGPORT || '55439';
const bin = process.env.MA_TEST_PSQL || 'psql';
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.match(database || '', /^ma_tw_cash_phase_test\d+$/);
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

sql(`with providers as (
    select provider_key, ordinality::integer ordinal
    from unnest(array[${CHECKPOINT_PROVIDER_KEYS.map(q).join(',')}]::text[]) with ordinality p(provider_key, ordinality)
  ), attempts as (select * from (values (1,1),(2,2)) v(attempt, multiplier))
  insert into public.market_checkpoint_snapshots(
    checkpoint,trading_date,captured_at,market_session,symbol,value,change_percent,
    source,source_timestamp,correlation_id,raw
  ) select '0900','2026-09-11','2026-09-11T09:05:00+08:00','intraday',provider_key,
    1000 + ordinal * multiplier,0,'ISOLATED_HISTORY','2026-09-11T09:04:00+08:00',
    case attempt when 1 then '11111111-1111-4111-8111-111111111111' else '22222222-2222-4222-8222-222222222222' end::uuid,
    jsonb_build_object('contract','FETCH_CHECKPOINT_EVIDENCE_V1','attempt',attempt)
  from providers cross join attempts where attempt = 2 or provider_key <> '2330';`);
const historySql = `select md5(string_agg(concat_ws('|',id::text,checkpoint,trading_date::text,
  captured_at::text,market_session,symbol,value::text,source_timestamp::text,raw::text), E'\\n' order by snapshot_version))
  from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';`;
const historyDigest = sql(historySql).output;

load('supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql');
load('supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql');
load('supabase/migrations/20260921120000_premarket_txf_session_date_parity_v1.sql');
assert.equal(sql("select md5(pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure));").output,
  '8f45427f702fd8dc17fa0089089f08e8');
const metadataBefore = sql(`select jsonb_build_object(
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatile',provolatile,
  'config',proconfig,'acl',proacl::text,'result',pg_get_function_result(oid))
  from pg_proc where oid='public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;`).output;

load('supabase/migrations/20260922015748_premarket_tw_cash_phase_contract_v1.sql');
load('supabase/migrations/20260922015748_premarket_tw_cash_phase_contract_v1.sql');
assert.equal(sql(`select pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure)
  like '%TW_CASH_PREMARKET_LATEST_COMPLETED_SESSION_V1%';`).output, 't');
assert.equal(sql(`select jsonb_build_object(
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatile',provolatile,
  'config',proconfig,'acl',proacl::text,'result',pg_get_function_result(oid))
  from pg_proc where oid='public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;`).output, metadataBefore);

function batch({ tradingDate, phase, checkpoint, observedAt, twDate, twTimestamp, txfDate, txfTimestamp, txfSession = 'afterhours' }) {
  const correlationId = randomUUID();
  const rows = CHECKPOINT_PROVIDER_KEYS.map((providerKey, index) => {
    const market = ['TAIEX', '2330', 'TXF'].includes(providerKey) ? 'TW' : 'US';
    const sourceTimestamp = providerKey === 'TXF' ? txfTimestamp
      : ['TAIEX', '2330'].includes(providerKey) ? twTimestamp
        : new Date(Date.parse(observedAt) - 12 * 60 * 60 * 1000).toISOString();
    const raw = providerKey === 'TXF' ? { date: txfDate, session: txfSession }
      : ['TAIEX', '2330'].includes(providerKey) ? { date: twDate, response_date: twDate } : {};
    const evidence = buildCheckpointEvidence({ phase, checkpoint, tradingDate, observedAt, correlationId }, {
      value: 100 + index, change: 1, changePercent: 0.1, capturedAt: sourceTimestamp,
      provider: providerKey === 'TXF' ? 'fugle_futopt' : market === 'TW' ? 'fugle' : 'finnhub',
      sourceSymbol: providerKey === 'TXF' ? 'TXF1!' : providerKey, raw,
    }, { displaySymbol: providerKey, finnhubSymbol: providerKey, market, name: providerKey });
    return evidence.valid ? { provider_key: providerKey, ...evidence.row } : { provider_key: providerKey, error: evidence.error };
  });
  return { correlationId, rows };
}
function commit(config, allowFailure = false) {
  const candidate = batch(config);
  if (candidate.rows.some(row => row.error)) return { ok: false, edge: true, output: candidate.rows.find(row => row.error).error, rows: candidate.rows };
  assert.equal(validateAtomicCheckpointEvidenceRows(candidate.rows).valid, true);
  return commitRows(config, candidate.correlationId, candidate.rows, allowFailure);
}
function commitRows(config, correlationId, rows, allowFailure = false) {
  const label = config.phase === 'premarket' ? 'PREMARKET' : config.checkpoint;
  const key = `market-checkpoint:${config.tradingDate}:${label}:MARKET_CHECKPOINT_PROVIDER_V1`;
  return sql(`set role service_role; select public.commit_market_checkpoint_batch_v1(
    ${q(config.tradingDate)}::date,${q(label)},${q(config.phase)},${q(correlationId)}::uuid,
    ${q(key)},${q(JSON.stringify(rows))}::jsonb)::text;`, allowFailure);
}

const scenarios = {
  monday: { tradingDate: '2026-09-21', phase: 'premarket', checkpoint: 'premarket', observedAt: '2026-09-21T07:00:00+08:00',
    twDate: '2026-09-18', twTimestamp: '2026-09-18T00:00:00+08:00', txfDate: '2026-09-18', txfTimestamp: '2026-09-19T05:00:00+08:00' },
  production922: { tradingDate: '2026-09-22', phase: 'premarket', checkpoint: 'premarket', observedAt: '2026-09-22T07:00:00+08:00',
    twDate: '2026-09-21', twTimestamp: '2026-09-21T00:00:00+08:00', txfDate: '2026-09-21', txfTimestamp: '2026-09-22T05:00:00+08:00' },
  weekday: { tradingDate: '2026-10-21', phase: 'premarket', checkpoint: 'premarket', observedAt: '2026-10-21T07:00:00+08:00',
    twDate: '2026-10-20', twTimestamp: '2026-10-20T00:00:00+08:00', txfDate: '2026-10-20', txfTimestamp: '2026-10-21T05:00:00+08:00' },
  holidayReturn: { tradingDate: '2026-09-28', phase: 'premarket', checkpoint: 'premarket', observedAt: '2026-09-28T07:00:00+08:00',
    twDate: '2026-09-24', twTimestamp: '2026-09-24T00:00:00+08:00', txfDate: '2026-09-24', txfTimestamp: '2026-09-25T05:00:00+08:00' },
  intraday: { tradingDate: '2026-09-29', phase: 'intraday', checkpoint: '0900', observedAt: '2026-09-29T09:05:00+08:00',
    twDate: '2026-09-29', twTimestamp: '2026-09-29T09:04:00+08:00', txfDate: '2026-09-29', txfTimestamp: '2026-09-29T09:04:00+08:00', txfSession: 'regular' },
  close: { tradingDate: '2026-09-30', phase: 'close', checkpoint: '1410', observedAt: '2026-09-30T14:15:00+08:00',
    twDate: '2026-09-30', twTimestamp: '2026-09-30T13:30:00+08:00', txfDate: '2026-09-30', txfTimestamp: '2026-09-30T13:40:00+08:00', txfSession: 'regular' },
};
for (const name of ['monday', 'production922']) {
  const candidate = batch(scenarios[name]);
  assert.equal(candidate.rows.some(row => row.error), false, name);
  assert.equal(validateAtomicCheckpointEvidenceRows(candidate.rows).valid, true, name);
}
for (const [name, scenario] of Object.entries(scenarios).filter(([key]) => !['monday', 'production922'].includes(key))) {
  const result = commit(scenario, true);
  assert.equal(result.ok, true, `${name}: ${result.output}`);
  assert.equal(JSON.parse(result.output.split('\n').at(-1)).row_count, 11, name);
}

for (const [name, base, mutate] of [
  ['stale-premarket', { ...scenarios.weekday, tradingDate: '2026-10-22', observedAt: '2026-10-22T07:00:00+08:00', twDate: '2026-10-21', twTimestamp: '2026-10-21T00:00:00+08:00', txfDate: '2026-10-21', txfTimestamp: '2026-10-22T05:00:00+08:00' }, row => {
    row.source_timestamp = '2026-10-20T00:00:00+08:00'; row.raw.source_raw.date = '2026-10-20'; row.raw.source_raw.response_date = '2026-10-20';
    row.raw.tw_cash_provider_session_date = '2026-10-20';
  }],
  ['future-premarket', { ...scenarios.weekday, tradingDate: '2026-10-23', observedAt: '2026-10-23T07:00:00+08:00', twDate: '2026-10-22', twTimestamp: '2026-10-22T00:00:00+08:00', txfDate: '2026-10-22', txfTimestamp: '2026-10-23T05:00:00+08:00' }, row => {
    row.source_timestamp = '2026-10-23T00:00:00+08:00'; row.raw.source_raw.date = '2026-10-23'; row.raw.source_raw.response_date = '2026-10-23';
    row.raw.tw_cash_provider_session_date = '2026-10-23';
  }],
  ['intraday-previous-session', { ...scenarios.intraday, tradingDate: '2026-10-26', observedAt: '2026-10-26T09:05:00+08:00', twDate: '2026-10-26', twTimestamp: '2026-10-26T09:04:00+08:00', txfDate: '2026-10-26', txfTimestamp: '2026-10-26T09:04:00+08:00' }, row => {
    row.source_timestamp = '2026-10-23T13:30:00+08:00'; row.raw.source_raw.date = '2026-10-23'; row.raw.source_raw.response_date = '2026-10-23';
    row.raw.tw_cash_provider_session_date = '2026-10-23';
  }],
  ['close-previous-session', { ...scenarios.close, tradingDate: '2026-10-27', observedAt: '2026-10-27T14:15:00+08:00', twDate: '2026-10-27', twTimestamp: '2026-10-27T13:30:00+08:00', txfDate: '2026-10-27', txfTimestamp: '2026-10-27T13:40:00+08:00' }, row => {
    row.source_timestamp = '2026-10-26T13:30:00+08:00'; row.raw.source_raw.date = '2026-10-26'; row.raw.source_raw.response_date = '2026-10-26';
    row.raw.tw_cash_provider_session_date = '2026-10-26';
  }],
]) {
  const candidate = batch(base);
  assert.equal(candidate.rows.some(row => row.error), false, name);
  mutate(candidate.rows.find(row => row.provider_key === 'TAIEX'));
  const result = commitRows(base, candidate.correlationId, candidate.rows, true);
  assert.equal(result.ok, false, name);
  assert.match(result.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/, name);
  assert.equal(sql(`select count(*) from market_checkpoint_snapshots where trading_date=${q(base.tradingDate)};`).output, '0');
}

assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';").output, '21');
assert.equal(sql(historySql).output, historyDigest);
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-22' and checkpoint='PREMARKET';").output, '0');
console.log('TW_CASH_PHASE_DB=PASS; 9_21=PASS; 9_22=PASS; MONDAY=PASS; HOLIDAY=PASS; INTRADAY=PASS; CLOSE=PASS; INVALID_BATCH_ROWS=0; HISTORY_9_11=UNCHANGED');
