import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeMarketFreshnessDates,
  filterFreshMarketIndicators,
  filterRecentNewsRows,
  isMarketIndicatorStale,
} from '../supabase/functions/generate-daily-report-v7/market-freshness.ts';

test('US close keeps the New York trading date across Taipei midnight', () => {
  const rows = [
    { symbol: 'SPX', captured_at: '2026-08-17T20:00:00.000Z' },
    { symbol: 'TAIEX', captured_at: '2026-08-17T05:30:00.000Z' },
  ];
  assert.deepEqual(computeMarketFreshnessDates(rows, '2026-08-18'), {
    twCoreDate: '2026-08-17',
    usGlobalDate: '2026-08-17',
  });
});

test('fresh US close is not marked stale because Taipei is on the next date', () => {
  const dates = { twCoreDate: '2026-08-17', usGlobalDate: '2026-08-17' };
  const now = Date.parse('2026-08-18T00:00:00.000Z');
  assert.equal(isMarketIndicatorStale('2026-08-17T20:00:00.000Z', 'SPX', dates, now), false);
});

test('premarket futures do not make the previous Taiwan cash close stale', () => {
  const rows = [
    { symbol: 'TAIEX', captured_at: '2026-08-24T05:30:00.000Z' },
    { symbol: '2330', captured_at: '2026-08-24T05:30:00.000Z' },
    { symbol: 'TXF', captured_at: '2026-08-24T21:00:00.000Z' },
    { symbol: 'SPX', captured_at: '2026-08-24T20:00:00.000Z' },
  ];
  const dates = computeMarketFreshnessDates(rows, '2026-08-25');
  assert.deepEqual(dates, {
    twCoreDate: '2026-08-24',
    usGlobalDate: '2026-08-24',
  });
  assert.equal(isMarketIndicatorStale('2026-08-24T05:30:00.000Z', 'TAIEX', dates), false);
  assert.equal(isMarketIndicatorStale('2026-08-24T21:00:00.000Z', 'TXF', dates), false);
});

test('Taiwan cash freshness advances once the current session opens', () => {
  const rows = [
    { symbol: 'TAIEX', captured_at: '2026-08-25T01:00:20.000Z' },
    { symbol: '2330', captured_at: '2026-08-25T01:00:21.000Z' },
    { symbol: 'TXF', captured_at: '2026-08-24T21:00:00.000Z' },
  ];
  const dates = computeMarketFreshnessDates(rows, '2026-08-25');
  assert.equal(dates.twCoreDate, '2026-08-25');
  assert.equal(isMarketIndicatorStale('2026-08-24T05:30:00.000Z', 'TAIEX', dates), true);
  assert.equal(isMarketIndicatorStale('2026-08-25T01:00:20.000Z', 'TAIEX', dates), false);
});

test('news older than 48 hours is excluded before report generation', () => {
  const now = Date.parse('2026-08-18T00:00:00.000Z');
  const rows = [
    { id: 'fresh', published_at: '2026-08-17T12:00:00.000Z' },
    { id: 'old', published_at: '2026-07-16T12:00:00.000Z' },
  ];
  assert.deepEqual(filterRecentNewsRows(rows, now, 48).map((row) => row.id), ['fresh']);
});

test('stale commodity rows are excluded from research inputs', () => {
  const dates = { twCoreDate: '2026-08-28', usGlobalDate: '2026-08-28' };
  const rows = [
    { symbol: 'NVDA', updatedAt: '2026-08-28T20:00:00.000Z' },
    { symbol: 'CL', updatedAt: '2026-08-27T20:00:00.000Z' },
    { symbol: 'TAIEX', updatedAt: '2026-08-28T05:30:00.000Z' },
  ];
  assert.deepEqual(
    filterFreshMarketIndicators(rows, dates).map((row) => row.symbol),
    ['NVDA', 'TAIEX'],
  );
});
