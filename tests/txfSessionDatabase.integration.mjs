// Opt-in, fresh local PostgreSQL verification for the named 9/21 TXF migration.
// It creates a new database and never connects to Production or external providers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CHECKPOINT_PROVIDER_KEYS,
  buildCheckpointEvidence,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const scope = 'ma-txf-session-parity-20260921';
const database = process.env.MA_ISOLATED_TEST_DB;
const port = process.env.MA_TEST_PGPORT || '55439';
const bin = process.env.MA_TEST_PSQL || 'psql';
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.match(database || '', /^ma_txf_session_parity_test\d+$/);
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
  /^(?:127\.0\.0\.1|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/,
  'The explicit loopback connection must terminate at a local/private container address');
assert.equal(command(`select count(*) from pg_database where datname=${q(database)};`, 'postgres').output, '0');
command(`create database ${database};`, 'postgres');
load('tests/fixtures/checkpoint-atomicity-baseline.sql');
command(`create schema ma_isolated_guard;
  create table ma_isolated_guard.identity(scope text primary key);
  insert into ma_isolated_guard.identity values(${q(scope)});`);

function sql(statement, allowFailure = false) {
  assert.equal(command('select scope from ma_isolated_guard.identity;').output, scope);
  return command(statement, database, allowFailure);
}

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
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';").output, '21');
const historicalDigestSql = `select md5(string_agg(concat_ws('|',
  id::text,checkpoint,trading_date::text,captured_at::text,market_session,symbol,value::text,
  change_percent::text,source,source_timestamp::text,correlation_id::text,
  snapshot_version::text,raw::text,created_at::text), E'\\n' order by snapshot_version))
  from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';`;
const historicalDigest = sql(historicalDigestSql).output;

load('supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql');
load('supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql');
assert.equal(sql("select md5(pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure));").output,
  'a23ebaaed203ae96d32008f7d23066fa');
const metadataBefore = sql(`select jsonb_build_object(
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatile',provolatile,
  'config',proconfig,'acl',proacl::text,'result',pg_get_function_result(oid))
  from pg_proc where oid='public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;`).output;

function batch({ tradingDate, observedAt, txfSessionDate, txfSourceTimestamp, txfSession = 'afterhours' }) {
  const input = { phase: 'premarket', checkpoint: 'premarket', tradingDate, observedAt, correlationId: randomUUID() };
  const rows = CHECKPOINT_PROVIDER_KEYS.map((providerKey, index) => {
    const market = ['TAIEX', '2330', 'TXF'].includes(providerKey) ? 'TW' : 'US';
    const sourceTimestamp = providerKey === 'TXF' ? txfSourceTimestamp
      : market === 'TW' ? new Date(Date.parse(observedAt) - 10 * 60 * 1000).toISOString()
        : new Date(Date.parse(observedAt) - 24 * 60 * 60 * 1000).toISOString();
    const quote = {
      value: 100 + index, change: 1, changePercent: 0.1, capturedAt: sourceTimestamp,
      provider: providerKey === 'TXF' ? 'fugle_futopt' : market === 'TW' ? 'fugle' : 'finnhub',
      sourceSymbol: providerKey === 'TXF' ? 'TXF1!' : providerKey,
      raw: providerKey === 'TXF' ? { date: txfSessionDate, session: txfSession } : {},
    };
    const evidence = buildCheckpointEvidence(input, quote, {
      displaySymbol: providerKey, finnhubSymbol: providerKey, market, name: providerKey,
    });
    return evidence.valid ? { provider_key: providerKey, ...evidence.row } : { provider_key: providerKey, error: evidence.error };
  });
  return { correlationId: input.correlationId, rows };
}

function commit(config, allowFailure = false) {
  const candidate = batch(config);
  if (candidate.rows.some(row => row.error)) return { ok: false, output: candidate.rows.find(row => row.error).error, rows: candidate.rows };
  assert.equal(validateAtomicCheckpointEvidenceRows(candidate.rows).valid, true);
  return commitRows(config.tradingDate, candidate.correlationId, candidate.rows, allowFailure);
}

function commitRows(tradingDate, correlationId, rows, allowFailure = false) {
  const key = `market-checkpoint:${tradingDate}:PREMARKET:MARKET_CHECKPOINT_PROVIDER_V1`;
  return sql(`set role service_role; select public.commit_market_checkpoint_batch_v1(
    ${q(tradingDate)}::date,'PREMARKET','premarket',${q(correlationId)}::uuid,
    ${q(key)},${q(JSON.stringify(rows))}::jsonb)::text;`, allowFailure);
}

const monday = {
  tradingDate: '2026-10-19', observedAt: '2026-10-19T08:35:00+08:00',
  txfSessionDate: '2026-10-16', txfSourceTimestamp: '2026-10-17T05:00:00+08:00',
};
const before = commit(monday, true);
assert.equal(before.ok, false);
assert.match(before.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/);
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-10-19' and checkpoint='PREMARKET';").output, '0');

load('supabase/migrations/20260921120000_premarket_txf_session_date_parity_v1.sql');
assert.equal(sql(`select pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure) like '%TXF_PREMARKET_SESSION_V1%';`).output, 't');
assert.equal(sql(`select jsonb_build_object(
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatile',provolatile,
  'config',proconfig,'acl',proacl::text,'result',pg_get_function_result(oid))
  from pg_proc where oid='public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;`).output, metadataBefore);
load('supabase/migrations/20260921120000_premarket_txf_session_date_parity_v1.sql');

for (const scenario of [
  monday,
  {
    tradingDate: '2026-10-20', observedAt: '2026-10-20T08:35:00+08:00',
    txfSessionDate: '2026-10-19', txfSourceTimestamp: '2026-10-20T05:00:00+08:00',
  },
  {
    tradingDate: '2026-09-28', observedAt: '2026-09-28T08:35:00+08:00',
    txfSessionDate: '2026-09-24', txfSourceTimestamp: '2026-09-25T05:00:00+08:00',
  },
]) {
  const result = commit(scenario, true);
  assert.equal(result.ok, true, result.output);
  assert.equal(JSON.parse(result.output.split('\n').at(-1)).row_count, 11);
}

for (const [name, scenario, mutate] of [
  ['stale', {
    tradingDate: '2026-10-21', observedAt: '2026-10-21T08:35:00+08:00',
    txfSessionDate: '2026-10-20', txfSourceTimestamp: '2026-10-21T05:00:00+08:00',
  }, row => {
    row.source_timestamp = '2026-10-14T05:00:00+08:00';
    row.raw.captured_session_date = '2026-10-14';
    row.raw.txf_expected_previous_trading_date = '2026-10-13';
    row.raw.txf_provider_session_date = '2026-10-13';
    row.raw.source_raw.date = '2026-10-13';
  }],
  ['wrong-session', {
    tradingDate: '2026-10-22', observedAt: '2026-10-22T08:35:00+08:00',
    txfSessionDate: '2026-10-21', txfSourceTimestamp: '2026-10-22T05:00:00+08:00',
  }, row => {
    row.raw.txf_session_type = 'regular';
    row.raw.source_raw.session = 'regular';
  }],
  ['future', {
    tradingDate: '2026-10-23', observedAt: '2026-10-23T06:50:00+08:00',
    txfSessionDate: '2026-10-22', txfSourceTimestamp: '2026-10-23T05:00:00+08:00',
  }, row => {
    row.source_timestamp = '2026-10-23T07:00:00+08:00';
    row.raw.captured_session_date = '2026-10-23';
  }],
]) {
  const candidate = batch(scenario);
  assert.equal(candidate.rows.some(row => row.error), false, name);
  mutate(candidate.rows.find(row => row.provider_key === 'TXF'));
  const result = commitRows(scenario.tradingDate, candidate.correlationId, candidate.rows, true);
  assert.equal(result.ok, false, name);
  assert.match(result.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/, name);
  assert.equal(sql(`select count(*) from market_checkpoint_snapshots where trading_date=${q(scenario.tradingDate)} and checkpoint='PREMARKET';`).output, '0');
}

assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';").output, '21');
assert.equal(sql(historicalDigestSql).output, historicalDigest);
console.log('TXF_DB_PARITY=PASS; WEEKDAY=PASS; MONDAY=PASS; LONG_HOLIDAY=PASS; INVALID_ROWS=0; HISTORY_9_11=UNCHANGED');
