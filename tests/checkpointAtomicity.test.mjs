import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CHECKPOINT_PROVIDER_CONTRACT_VERSION,
  CHECKPOINT_PROVIDER_KEYS,
  checkpointBatchIdempotencyKey,
  parseAtomicCheckpointCommit,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function evidenceRows(overrides = {}) {
  const batchId = overrides.batchId || randomUUID();
  const correlationId = overrides.correlationId || randomUUID();
  const idempotencyKey = checkpointBatchIdempotencyKey('2026-09-14', '0930');
  return CHECKPOINT_PROVIDER_KEYS.map((providerKey, index) => ({
    id: randomUUID(),
    provider_key: providerKey,
    symbol: providerKey,
    value: 100 + index,
    change_percent: index / 10,
    source: providerKey === 'TAIEX' ? 'TWSE' : 'LOCAL_PROVIDER',
    source_timestamp: '2026-09-14T09:30:00+08:00',
    captured_at: '2026-09-14T09:30:00+08:00',
    trading_date: '2026-09-14',
    checkpoint: '0930',
    market_session: 'intraday',
    correlation_id: correlationId,
    batch_id: batchId,
    idempotency_key: idempotencyKey,
    snapshot_version: index + 1,
    raw: {
      contract: 'FETCH_CHECKPOINT_EVIDENCE_V1',
      market: ['TAIEX', '2330', 'TXF'].includes(providerKey) ? 'TW' : 'US',
      name: providerKey,
      source_symbol: providerKey,
      change: index / 10,
      source_raw: {},
      freshness_status: providerKey === 'TAIEX' || providerKey === '2330' || providerKey === 'TXF' ? 'fresh' : 'provider_returned',
      freshness_age_minutes: 0,
      captured_session_date: '2026-09-14',
      fallback_used: false,
    },
  }));
}

test('provider contract is the exact immutable 11-slot set', () => {
  assert.equal(CHECKPOINT_PROVIDER_CONTRACT_VERSION, 'MARKET_CHECKPOINT_PROVIDER_V1');
  assert.deepEqual(CHECKPOINT_PROVIDER_KEYS, [
    'SPX', 'IXIC', 'SOX', 'NVDA', 'TSM', 'VIX', 'DXY', 'US10Y', 'TAIEX', '2330', 'TXF',
  ]);
  assert.equal(validateAtomicCheckpointEvidenceRows(evidenceRows()).valid, true);
});

for (const index of [0, 4, 10]) {
  test(`provider #${index + 1} timeout leaves assembly incomplete`, () => {
    const rows = evidenceRows();
    rows.splice(index, 1);
    assert.deepEqual(validateAtomicCheckpointEvidenceRows(rows), {
      valid: false,
      error: 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY',
      rowCount: 10,
    });
  });
}

test('HTTP 500/null provider result and malformed payload cannot form a batch', () => {
  const missing = evidenceRows().slice(0, 10);
  assert.equal(validateAtomicCheckpointEvidenceRows(missing).valid, false);
  for (const mutation of [
    row => { row.value = null; },
    row => { row.change_percent = 'bad'; },
    row => { row.raw.change = undefined; },
    row => { row.source = ''; },
    row => { row.raw.contract = 'OTHER'; },
  ]) {
    const rows = evidenceRows();
    mutation(rows[5]);
    assert.equal(validateAtomicCheckpointEvidenceRows(rows).valid, false);
  }
});

test('duplicate provider response is rejected even when row count is 11', () => {
  const rows = evidenceRows();
  rows[10] = { ...rows[9] };
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).error, 'ATOMIC_CHECKPOINT_PROVIDER_SET_MISMATCH');
});

test('commit response must contain one batch, correlation and idempotency identity', () => {
  const rows = evidenceRows();
  const payload = {
    contract: 'MARKET_CHECKPOINT_ATOMIC_COMMIT_V1',
    status: 'COMMITTED',
    reused: false,
    payload_matches: true,
    batch_id: rows[0].batch_id,
    correlation_id: rows[0].correlation_id,
    idempotency_key: rows[0].idempotency_key,
    row_count: 11,
    rows,
  };
  assert.equal(parseAtomicCheckpointCommit(payload, {
    tradingDate: '2026-09-14', checkpoint: '0930', idempotencyKey: rows[0].idempotency_key,
  }).valid, true);
  const mixed = structuredClone(payload);
  mixed.rows[5].batch_id = randomUUID();
  assert.equal(parseAtomicCheckpointCommit(mixed).error, 'ATOMIC_CHECKPOINT_COMMIT_MIXED_IDENTITY');
});

test('fetch writes checkpoint evidence only through the atomic RPC', () => {
  const source = read('supabase/functions/fetch-market-data-v10/index.ts');
  assert.match(source, /commit_market_checkpoint_batch_v1/);
  assert.match(source, /validateAtomicCheckpointEvidenceRows/);
  assert.match(source, /atomic_checkpoint_row_count/);
  assert.match(source, /RECOVER_COMMITTED_ATOMIC_BATCH/);
  assert.match(source, /read_committed_market_checkpoint_batch_v1/);
  const committedReadback = source.indexOf('const { data: committedRows');
  const wallClockGate = source.indexOf('if (!beneficiaryCloseOnly && !collection.valid');
  assert.ok(committedReadback >= 0 && wallClockGate > committedReadback,
    'a committed response-loss batch must be recovered before the wall-clock retry gate');
  assert.match(source, /if \(committedRecoveryRows\.length === 0\) await Promise\.all/);
  assert.doesNotMatch(source, /from\(["']market_checkpoint_snapshots["']\)\.upsert/);
  assert.match(source, /const requiredCoreSymbols = \[\.\.\.CHECKPOINT_PROVIDER_KEYS\]/);
  assert.match(source, /const CLOSE_CORE_SYMBOLS = new Set\(CHECKPOINT_PROVIDER_KEYS\)/);
});

test('all affected core readers fail closed through the authoritative view', () => {
  for (const path of [
    'supabase/functions/opening-market-radar/index.ts',
    'supabase/functions/close-market-review/index.ts',
    'supabase/functions/closing-verification-engine/index.ts',
    'supabase/functions/continuous-learning-engine/index.ts',
    'supabase/functions/generate-sector-rotation/index.ts',
    'supabase/functions/ma-ops-health-check/index.ts',
    'supabase/functions/strategy-replay-engine/index.ts',
  ]) assert.match(read(path), /authoritative_market_data_snapshots_v1/, path);
});

test('migration preserves 2026-09-11 and defines transaction/idempotency/concurrency gates', () => {
  const migration = read('supabase/migrations/20260911033927_checkpoint_snapshot_atomic_batch_v1.sql');
  assert.match(migration, /business_date > date '2026-09-11'/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY/);
  assert.match(migration, /ATOMIC_CHECKPOINT_COMPATIBILITY_CONFLICT/);
  assert.match(migration, /create unique index if not exists market_data_snapshots_atomic_identity_uidx/i);
  assert.match(migration, /on conflict \(symbol, trading_date, phase, checkpoint\)\s+where raw->>'checkpoint_batch_id' is not null/i);
  assert.match(migration, /CHECKPOINT_' \|\| v_checkpoint \|\| '_INTEGRITY_VIOLATION/);
  assert.match(migration, /security_invoker = true/i);
});

test('runtime workflow requires exactly 11 rows without changing its schedule', () => {
  const workflow = read('.github/workflows/morning-alpha-runtime-checkpoints.yml');
  assert.match(workflow, /snapshot_upserted_count == 11/);
  assert.match(workflow, /atomic_checkpoint_row_count == 11/);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
});
