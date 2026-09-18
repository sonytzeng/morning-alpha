import {
  reconstructSectorRotationFromAuthoritativeClose,
  SECTOR_RECONSTRUCTION_SOURCE,
  type AuthoritativeCloseRow,
} from '../supabase/functions/generate-daily-report-v7/market-data-evidence.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 2026-09-17 Production 14:30 authoritative close shape and public market
// changes; internal batch identity is replaced with one local fixture UUID.
const values: Array<[string, number, string]> = [
  ['2330', 1.89, '2026-09-17T05:30:00Z'],
  ['DXY', 0.6378, '2026-09-16T20:00:00Z'],
  ['IXIC', 0.0255, '2026-09-16T20:00:00Z'],
  ['NVDA', 0.8154, '2026-09-16T20:00:00Z'],
  ['SOX', 0.6435, '2026-09-16T20:00:00Z'],
  ['SPX', -0.441, '2026-09-16T20:00:00Z'],
  ['TAIEX', 0.96, '2026-09-17T05:30:00Z'],
  ['TSM', 0.9595, '2026-09-16T20:00:00Z'],
  ['TXF', 0.84, '2026-09-17T05:44:59.886Z'],
  ['US10Y', 0.0991, '2026-09-16T20:00:00Z'],
  ['VIX', 0.931, '2026-09-16T20:00:00Z'],
];

function closeRows(date = '2026-09-17'): AuthoritativeCloseRow[] {
  const dayShift = Date.parse(`${date}T00:00:00Z`) - Date.parse('2026-09-17T00:00:00Z');
  return values.map(([symbol, change_percent, captured_at]) => ({
    symbol, change_percent, captured_at: new Date(Date.parse(captured_at) + dayShift).toISOString(),
    committed_at: `${date}T06:30:03.417Z`,
    trading_date: date, checkpoint: '1430', phase: 'close',
    batch_id: '11111111-1111-4111-8111-111111111111',
    provider_contract_version: 'MARKET_CHECKPOINT_PROVIDER_V1',
  }));
}

Deno.test('9/17 Production close evidence reconstructs exact 9/17 research context without writing history', () => {
  const input = closeRows();
  const before = JSON.stringify(input);
  const result = reconstructSectorRotationFromAuthoritativeClose(input, '2026-09-17');
  assert(result.status === 'RECONSTRUCTED', 'the genuine 11-row close batch must be sufficient');
  assert(result.rows.length === 4, 'only four sectors are mapped by genuine 11-provider evidence');
  const semiconductor = result.rows.find(row => row.sector === '半導體');
  assert(semiconductor?.rotation_score === 60.8, 'derived score must follow observed market changes');
  assert(semiconductor.lineage.source === SECTOR_RECONSTRUCTION_SOURCE, 'origin must not impersonate published sector scores');
  assert(semiconductor.lineage.business_date === '2026-09-17', 'lineage must retain the previous trading date');
  assert(JSON.stringify(input) === before, 'derivation must not mutate historical input');
  assert(JSON.stringify(reconstructSectorRotationFromAuthoritativeClose(input, '2026-09-17')) === JSON.stringify(result), 'derivation must be reproducible');
});

Deno.test('missing or partial prior close evidence fails closed rather than inventing sector scores', () => {
  for (const input of [[], closeRows().slice(1)]) {
    const result = reconstructSectorRotationFromAuthoritativeClose(input, '2026-09-17');
    assert(result.status === 'UNAVAILABLE' && result.rows.length === 0, 'no partial evidence may pass');
  }
});

Deno.test('wrong business date, mixed batch, duplicate provider and invalid values all fail closed', () => {
  const mutations: Array<(rows: AuthoritativeCloseRow[]) => void> = [
    rows => { rows[0].trading_date = '2026-09-16'; },
    rows => { rows[0].batch_id = '22222222-2222-4222-8222-222222222222'; },
    rows => { rows[0].symbol = 'DXY'; },
    rows => { rows[0].change_percent = null; },
    rows => { rows[0].captured_at = '2026-09-18T07:00:00Z'; },
    rows => { rows[0].captured_at = '2026-09-16T05:30:00Z'; },
    rows => { rows[0].provider_contract_version = 'UNKNOWN'; },
  ];
  for (const mutate of mutations) {
    const input = closeRows(); mutate(input);
    assert(reconstructSectorRotationFromAuthoritativeClose(input, '2026-09-17').status === 'UNAVAILABLE',
      'invalid close evidence must never be promoted');
  }
});

Deno.test('two consecutive failed report dates do not create a permanent research dependency chain', () => {
  const first = reconstructSectorRotationFromAuthoritativeClose(closeRows('2026-09-17'), '2026-09-17');
  const second = reconstructSectorRotationFromAuthoritativeClose(closeRows('2026-09-18'), '2026-09-18');
  assert(first.status === 'RECONSTRUCTED' && second.status === 'RECONSTRUCTED',
    'each next trading day must independently use its immediately preceding authoritative close');
  assert(second.rows.every(row => row.score_date === '2026-09-18'), 'must not reuse the 9/17 context for 9/21');
});
