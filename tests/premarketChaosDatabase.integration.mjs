// Opt-in, loopback-only PostgreSQL reproduction of the late premarket gate.
// The 9/17 capture is real and hash-bound; the 9/18 positive control is an
// explicitly synthetic DB-only counterfactual, never a Production observation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { validateRealProductionCapture } from './helpers/productionRealityProviderReplay.mjs';
import { REQUIRED_PROVIDER_CONFIG, normalizeRequiredFinnhubQuote, normalizeRequiredTaiwanCoreQuote, resolveRequiredTxfQuote, validateRequiredProviderEvidence } from '../supabase/functions/_shared/required-provider-validation.mjs';
import { resolveFugle2330Provider, resolveFugleTaiexProvider } from '../supabase/functions/_shared/fugle-taiex-provider.mjs';
import { validateAtomicCheckpointEvidenceRows } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const database = process.env.MA_ISOLATED_TEST_DB;
const port = process.env.MA_TEST_PGPORT;
assert.match(database || '', /^ma_checkpoint_atomicity_test\d+$/);
assert.match(port || '', /^\d{5}$/);
assert.equal(process.env.MA_LOCAL_SCOPE, 'ma-checkpoint-atomicity-20260911');
const capture = JSON.parse(readFileSync(new URL('./fixtures/premarket-readiness-v1/production-current-20260917.json', import.meta.url)));
validateRealProductionCapture(capture, REQUIRED_PROVIDER_CONFIG.map(slot => slot.key));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

function sql(statement, { allowFailure = false } = {}) {
  try {
    return { ok: true, output: execFileSync('psql', ['-X', '-A', '-t', '-h', '127.0.0.1', '-p', port,
      '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', statement], {
      encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() };
  } catch (error) {
    if (!allowFailure) throw error;
    return { ok: false, output: String(error.stderr || '').trim() };
  }
}

async function realRows() {
  const rows = [];
  for (const slot of REQUIRED_PROVIDER_CONFIG) {
    const response = capture.responses[slot.key];
    let normalized;
    if (slot.provider === 'finnhub') normalized = normalizeRequiredFinnhubQuote(response.payload, slot.sourceSymbol);
    else if (slot.key === 'TAIEX' || slot.key === '2330') {
      const resolver = slot.key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
      const resolved = await resolver(async request => request.endpoint.includes('/tickers?')
        ? { status: 200, payload: { type: 'INDEX', exchange: 'TWSE', data: [] } }
        : { status: response.http_status, payload: response.payload },
      { tradingDate: capture.business_date, phase: 'premarket' });
      assert.equal(resolved.ok, true, `${slot.key} real Production adapter`);
      normalized = normalizeRequiredTaiwanCoreQuote(resolved, slot.key);
    } else {
      const resolved = await resolveRequiredTxfQuote(async endpoint => endpoint === response.endpoint
        ? { status: response.http_status, payload: response.payload, error: null }
        : { status: 404, payload: null, error: 'HTTP_404' },
      { phase: 'premarket', tradingDate: capture.business_date, observedAt: capture.capture_time,
        nowMs: Date.parse(capture.capture_time) });
      normalized = resolved.quote;
    }
    const evidence = validateRequiredProviderEvidence(slot, normalized, {
      phase: 'premarket', checkpoint: 'premarket', tradingDate: capture.business_date,
      observedAt: capture.capture_time, correlationId: '17310000-0000-4000-8000-000000000001',
    });
    assert.equal(evidence.valid, true, `${slot.key}: ${evidence.error || 'invalid'}`);
    rows.push({ provider_key: slot.key, ...evidence.row });
  }
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).valid, true);
  return rows;
}

function commit(date, rows) {
  const key = `market-checkpoint:${date}:PREMARKET:MARKET_CHECKPOINT_PROVIDER_V1`;
  return sql(`set role service_role; select public.commit_market_checkpoint_batch_v1(
    ${quote(date)}::date,'PREMARKET','premarket',${quote(randomUUID())}::uuid,
    ${quote(key)},${quote(JSON.stringify(rows))}::jsonb)::text;`, { allowFailure: true });
}

const fingerprint = sql("select md5(pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure));").output;
assert.equal(sql("select scope from ma_isolated_guard.identity;").output, 'ma-checkpoint-atomicity-20260911');
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-11' and checkpoint='0900';").output, '21');
assert.equal(sql("select verdict from production_acceptance_results where business_date='2026-09-11';").output, 'FAIL');
const rows = await realRows();
const historical = commit('2026-09-17', rows);
assert.equal(historical.ok, false);
assert.match(historical.output, /ATOMIC_CHECKPOINT_COLLECTION_TIME_INVALID/);
assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-17' and checkpoint='PREMARKET';").output, '0');

if (process.env.MA_CHAOS_CANDIDATE === '1') {
  assert.notEqual(fingerprint, '0fc2b7fb85932a72e2f64cf792665a37');
  const definition = sql("select pg_get_functiondef('public.commit_market_checkpoint_batch_v1(date,text,text,uuid,text,jsonb)'::regprocedure);").output;
  assert.match(definition, /T08:44:59\.999999\+08:00/);
  assert.match(definition, /p_business_date <= date '2026-09-17'/);
  assert.equal((definition.match(/PREMARKET_READINESS_DEADLINE_EXCEEDED/g) || []).length, 2,
    'deadline must be checked after the advisory lock and again before returning the committed batch');
  // Only the DB boundary is being tested here: these values are deliberately
  // counterfactual, not a real 9/18 vendor response or a Production replay.
  const syntheticAt = (date, time) => structuredClone(rows).map(row => ({ ...row,
    captured_at: `${date}T${time}+08:00`,
    source_timestamp: row.raw.market === 'TW' ? `${date}T08:30:00+08:00` : row.source_timestamp,
  }));
  const synthetic = syntheticAt('2026-09-18', '08:31:16');
  const result = commit('2026-09-18', synthetic);
  assert.equal(result.ok, true, result.output);
  assert.equal(JSON.parse(result.output.split('\n').at(-1)).row_count, 11);
  assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-18' and checkpoint='PREMARKET';").output, '11');
  const retry = commit('2026-09-18', synthetic);
  assert.equal(retry.ok, true, retry.output);
  assert.equal(JSON.parse(retry.output.split('\n').at(-1)).reused, true);
  assert.equal(sql("select count(*) from market_checkpoint_batches where business_date='2026-09-18' and checkpoint='PREMARKET';").output, '1');
  for (const [date, time] of [['2026-09-21', '08:35:00'], ['2026-09-22', '08:44:59.999999']]) {
    const late = commit(date, syntheticAt(date, time));
    assert.equal(late.ok, true, `${date} ${late.output}`);
    assert.equal(JSON.parse(late.output.split('\n').at(-1)).row_count, 11);
  }
  const expired = commit('2026-09-23', syntheticAt('2026-09-23', '08:45:00'));
  assert.equal(expired.ok, false);
  assert.match(expired.output, /ATOMIC_CHECKPOINT_COLLECTION_TIME_INVALID/);
  assert.equal(sql("select count(*) from market_checkpoint_snapshots where trading_date='2026-09-23' and checkpoint='PREMARKET';").output, '0');
} else {
  assert.equal(fingerprint, '0fc2b7fb85932a72e2f64cf792665a37');
}
console.log(`PREMARKET_DB_CHAOS=${process.env.MA_CHAOS_CANDIDATE === '1' ? 'CANDIDATE' : 'BASELINE'}; REAL_CAPTURE_0831=VALID; HISTORICAL_ROWS=0`);
