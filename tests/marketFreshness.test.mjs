import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeMarketFreshnessDates,
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

test('news older than 48 hours is excluded before report generation', () => {
  const now = Date.parse('2026-08-18T00:00:00.000Z');
  const rows = [
    { id: 'fresh', published_at: '2026-08-17T12:00:00.000Z' },
    { id: 'old', published_at: '2026-07-16T12:00:00.000Z' },
  ];
  assert.deepEqual(filterRecentNewsRows(rows, now, 48).map((row) => row.id), ['fresh']);
});
