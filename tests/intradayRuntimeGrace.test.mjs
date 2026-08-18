import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateIntradayCheckpointRows } from '../supabase/functions/_shared/intraday-runtime-contract.ts';

function row(symbol, capturedAt) {
  return {
    symbol,
    captured_at: capturedAt,
    trading_date: '2026-08-18',
    phase: 'intraday',
    value: 1,
    change_percent: 0.1,
  };
}

test('09:30 checkpoint accepts a same-session snapshot when the scheduler starts late', () => {
  const rows = ['TAIEX', 'TXF', '2330'].map((symbol) => row(symbol, '2026-08-18T01:45:00.000Z'));
  const result = evaluateIntradayCheckpointRows(rows, '2026-08-18', '0930');
  assert.equal(result.ready, true);
  assert.deepEqual(result.missingSymbols, []);
});

test('09:30 checkpoint still rejects a later checkpoint snapshot', () => {
  const rows = ['TAIEX', 'TXF', '2330'].map((symbol) => row(symbol, '2026-08-18T02:30:00.000Z'));
  const result = evaluateIntradayCheckpointRows(rows, '2026-08-18', '0930');
  assert.equal(result.ready, false);
});
