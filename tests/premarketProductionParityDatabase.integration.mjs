// Opt-in fresh PostgreSQL 17 replay for the sole 9/23 candidate migration.
// It connects only to the explicitly scoped loopback database and never to Production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  CHECKPOINT_PROVIDER_KEYS,
  buildCheckpointEvidence,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const scope = 'ma-premarket-production-parity-20260923';
const database = process.env.MA_ISOLATED_TEST_DB;
const port = process.env.MA_TEST_PGPORT || '55439';
const bin = process.env.MA_TEST_PSQL || 'psql';
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.match(database || '', /^ma_premarket_parity_test\d+$/);
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

load('supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql');
load('supabase/migrations/20260917120000_premarket_atomic_readiness_window_v1.sql');
load('supabase/migrations/20260921120000_premarket_txf_session_date_parity_v1.sql');
load('supabase/migrations/20260922015748_premarket_tw_cash_phase_contract_v1.sql');
assert.equal(sql("select md5(pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure));").output,
  '00fcf28b4af0331b30dd2cea068dc3dc');
const metadataBefore = sql(`select jsonb_build_object(
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatile',provolatile,
  'config',proconfig,'acl',proacl::text,'result',pg_get_function_result(oid))
  from pg_proc where oid='public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;`).output;

function batch({ tradingDate, observedAt, twSessionDate, twEnvelopeDate = tradingDate, txfDate, txfTimestamp }) {
  const correlationId = randomUUID();
  const rows = CHECKPOINT_PROVIDER_KEYS.map((providerKey, index) => {
    const market = ['TAIEX', '2330', 'TXF'].includes(providerKey) ? 'TW' : 'US';
    const sourceTimestamp = providerKey === 'TXF' ? txfTimestamp
      : ['TAIEX', '2330'].includes(providerKey) ? `${twSessionDate}T00:00:00+08:00`
        : new Date(Date.parse(observedAt) - 12 * 60 * 60 * 1000).toISOString();
    const raw = providerKey === 'TXF' ? { date: txfDate, session: 'afterhours' }
      : ['TAIEX', '2330'].includes(providerKey) ? {
        date: twEnvelopeDate,
        response_date: twEnvelopeDate,
        provider_envelope_date: twEnvelopeDate,
        evidence_session_date: twSessionDate,
      } : {};
    const evidence = buildCheckpointEvidence({
      phase: 'premarket', checkpoint: 'premarket', tradingDate, observedAt, correlationId,
    }, {
      value: 100 + index, change: 0, changePercent: 0, capturedAt: sourceTimestamp,
      provider: providerKey === 'TXF' ? 'fugle_futopt' : market === 'TW' ? 'fugle' : 'finnhub',
      sourceSymbol: providerKey === 'TXF' ? 'TXF1!' : providerKey, raw,
    }, { displaySymbol: providerKey, finnhubSymbol: providerKey, market, name: providerKey });
    return evidence.valid ? { provider_key: providerKey, ...evidence.row } : { provider_key: providerKey, error: evidence.error };
  });
  return { correlationId, rows };
}
function commitRows(config, candidate, allowFailure = false) {
  const key = `market-checkpoint:${config.tradingDate}:PREMARKET:MARKET_CHECKPOINT_PROVIDER_V1`;
  return sql(`set role service_role; select public.commit_market_checkpoint_batch_v1(
    ${q(config.tradingDate)}::date,'PREMARKET','premarket',${q(candidate.correlationId)}::uuid,
    ${q(key)},${q(JSON.stringify(candidate.rows))}::jsonb)::text;`, allowFailure);
}
function commit(config, allowFailure = false) {
  const candidate = batch(config);
  assert.equal(candidate.rows.some(row => row.error), false);
  assert.equal(validateAtomicCheckpointEvidenceRows(candidate.rows).valid, true);
  return commitRows(config, candidate, allowFailure);
}

const production923 = {
  tradingDate: '2026-09-23', observedAt: '2026-09-23T07:00:02.000+08:00',
  twSessionDate: '2026-09-22', twEnvelopeDate: '2026-09-23',
  txfDate: '2026-09-22', txfTimestamp: '2026-09-23T05:00:00+08:00',
};
const before = commit(production923, true);
assert.equal(before.ok, false);
assert.match(before.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/);
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-23';").output, '0');

load('supabase/migrations/20260923120000_premarket_ticker_envelope_session_parity_v1.sql');
load('supabase/migrations/20260923120000_premarket_ticker_envelope_session_parity_v1.sql');
assert.equal(sql(`select pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure)
  like '%provider_envelope_date%';`).output, 't');
assert.equal(sql(`select jsonb_build_object(
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatile',provolatile,
  'config',proconfig,'acl',proacl::text,'result',pg_get_function_result(oid))
  from pg_proc where oid='public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure;`).output, metadataBefore);

// The historical 9/23 call now clears the row contract and reaches the
// immutable 08:45 deadline. It must not backfill the retained Production FAIL.
const historicalAfter = commit(production923, true);
assert.equal(historicalAfter.ok, false);
assert.match(historicalAfter.output, /PREMARKET_READINESS_DEADLINE_EXCEEDED/);
assert.doesNotMatch(historicalAfter.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/);
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-23';").output, '0');

for (const [name, config] of Object.entries({
  production922: { tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00', twSessionDate: '2026-09-21', twEnvelopeDate: '2026-09-22', txfDate: '2026-09-21', txfTimestamp: '2026-09-22T05:00:00+08:00' },
  production921: { tradingDate: '2026-09-21', observedAt: '2026-09-21T07:00:00+08:00', twSessionDate: '2026-09-18', twEnvelopeDate: '2026-09-21', txfDate: '2026-09-18', txfTimestamp: '2026-09-19T05:00:00+08:00' },
})) {
  const candidate = batch(config);
  assert.equal(candidate.rows.some(row => row.error), false, name);
  assert.equal(validateAtomicCheckpointEvidenceRows(candidate.rows).valid, true, name);
}

for (const [name, config] of Object.entries({
  weekdayCurrentEnvelope: { tradingDate: '2026-09-24', observedAt: '2026-09-24T07:00:00+08:00', twSessionDate: '2026-09-23', twEnvelopeDate: '2026-09-24', txfDate: '2026-09-23', txfTimestamp: '2026-09-24T05:00:00+08:00' },
  weekdayPriorEnvelope: { tradingDate: '2026-10-20', observedAt: '2026-10-20T06:50:00+08:00', twSessionDate: '2026-10-19', twEnvelopeDate: '2026-10-19', txfDate: '2026-10-19', txfTimestamp: '2026-10-20T05:00:00+08:00' },
  holidayReturn: { tradingDate: '2026-09-28', observedAt: '2026-09-28T07:00:00+08:00', twSessionDate: '2026-09-24', twEnvelopeDate: '2026-09-28', txfDate: '2026-09-24', txfTimestamp: '2026-09-25T05:00:00+08:00' },
})) {
  const result = commit(config, true);
  assert.equal(result.ok, true, `${name}: ${result.output}`);
  assert.equal(JSON.parse(result.output.split('\n').at(-1)).row_count, 11, name);
}

for (const [name, config, mutate] of [
  ['stale-envelope', { tradingDate: '2026-09-29', observedAt: '2026-09-29T07:00:00+08:00', twSessionDate: '2026-09-28', twEnvelopeDate: '2026-09-29', txfDate: '2026-09-28', txfTimestamp: '2026-09-29T05:00:00+08:00' }, row => {
    row.raw.source_raw.date = '2026-09-26';
    row.raw.source_raw.response_date = '2026-09-26';
    row.raw.source_raw.provider_envelope_date = '2026-09-26';
  }],
  ['wrong-evidence-session', { tradingDate: '2026-09-30', observedAt: '2026-09-30T07:00:00+08:00', twSessionDate: '2026-09-29', twEnvelopeDate: '2026-09-30', txfDate: '2026-09-29', txfTimestamp: '2026-09-30T05:00:00+08:00' }, row => {
    row.raw.source_raw.evidence_session_date = '2026-09-28';
  }],
  ['contradictory-envelope-lineage', { tradingDate: '2026-10-01', observedAt: '2026-10-01T07:00:00+08:00', twSessionDate: '2026-09-30', twEnvelopeDate: '2026-10-01', txfDate: '2026-09-30', txfTimestamp: '2026-10-01T05:00:00+08:00' }, row => {
    row.raw.source_raw.response_date = '2026-09-30';
  }],
]) {
  const candidate = batch(config);
  mutate(candidate.rows.find(row => row.provider_key === 'TAIEX'));
  const result = commitRows(config, candidate, true);
  assert.equal(result.ok, false, name);
  assert.match(result.output, /ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID/, name);
  assert.equal(sql(`select count(*) from market_checkpoint_snapshots where trading_date=${q(config.tradingDate)};`).output, '0');
}

console.log('PREMARKET_PRODUCTION_PARITY_DB=PASS; 9_23_BEFORE=ROW_CONTRACT_FAIL; 9_23_AFTER=ROW_CONTRACT_PASS_DEADLINE_REJECTED; FUTURE_ATOMIC=11; 9_23_HISTORY=0; 9_22=PASS; 9_21=PASS; MONDAY_HOLIDAY=PASS; STALE_INVALID_ROWS=0; METADATA=UNCHANGED');
