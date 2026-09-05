import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const path = new URL('../supabase/migrations/20260905032615_signal_lab_v1_foundation.sql', import.meta.url);
const sql = await readFile(path, 'utf8');

const TABLES = [
  'daily_prices', 'trading_calendar', 'institutional_inputs', 'universe_memberships', 'corporate_actions',
  'market_features', 'institutional_features', 'technical_features', 'market_regimes',
  'market_cost_configs', 'strategy_versions', 'strategy_experiments', 'signal_predictions',
  'signal_outcomes', 'data_quality_runs', 'shadow_runs',
];

test('Signal Lab tables are isolated behind a consistent prefix', () => {
  for (const table of TABLES) assert.match(sql, new RegExp(`create table if not exists public\\.signal_lab_${table}\\b`, 'i'));
});

test('every Signal Lab table receives RLS, FORCE RLS and no browser grant', () => {
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table public\.%I from public, anon, authenticated/i);
  assert.match(sql, /grant all on table public\.%I to service_role/i);
  for (const table of TABLES) assert.match(sql, new RegExp(`'signal_lab_${table}'`));
});

test('prediction and source ledgers are immutable', () => {
  assert.match(sql, /signal_lab_daily_prices_immutable/i);
  assert.match(sql, /signal_lab_trading_calendar_immutable/i);
  assert.match(sql, /signal_lab_institutional_inputs_immutable/i);
  assert.match(sql, /signal_lab_universe_memberships_immutable/i);
  assert.match(sql, /signal_lab_corporate_actions_immutable/i);
  assert.match(sql, /signal_lab_predictions_immutable/i);
  assert.match(sql, /SIGNAL_LAB_IMMUTABLE_RECORD/);
});

test('stored symbols use one canonical Taiwan identity', () => {
  assert.match(sql, /symbol text not null check \(symbol ~ '\^\[0-9\]\{4,6\}\$'\)/);
  assert.match(sql, /symbol text not null check \(symbol ~ '\^\(TAIEX\|\[0-9\]\{4,6\}\)\$'\)/);
});

test('Signal Lab cannot alter production recommendation tables', () => {
  assert.doesNotMatch(sql, /\b(update|delete from|alter table)\s+public\.(reports|recommendations|subscriptions|profiles)\b/i);
});
