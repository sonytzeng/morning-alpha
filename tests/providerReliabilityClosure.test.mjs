import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  REQUIRED_PROVIDER_COUNT,
  REQUIRED_PROVIDER_SLOTS,
  describeProductionResponseShape,
  sanitizeProductionMarketPayload,
  stableJson,
  validateRequiredProviderRegistry,
} from '../supabase/functions/_shared/provider-reliability-contract.mjs';
import { CHECKPOINT_PROVIDER_KEYS } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const preflight = readFileSync(new URL('../supabase/functions/market-readiness-preflight/index.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260915065000_market_readiness_preflight_v1.sql', import.meta.url), 'utf8');
const failureRegistry = JSON.parse(readFileSync(new URL('../docs/operations/evidence/production-reliability-known-failures-20260915.json', import.meta.url), 'utf8'));
const fixturePaths = [
  'taiex-premarket-20260915.json', 'taiex-intraday-20260915.json',
  'stock-2330-20260915.json', 'txf-afterhours-20260915.json',
];

test('readiness registry is the unchanged 11-provider atomic contract', () => {
  assert.equal(REQUIRED_PROVIDER_COUNT, 11);
  assert.deepEqual(REQUIRED_PROVIDER_SLOTS.map(slot => slot.key), CHECKPOINT_PROVIDER_KEYS);
  assert.equal(validateRequiredProviderRegistry().valid, true);
  assert.equal(validateRequiredProviderRegistry(REQUIRED_PROVIDER_SLOTS.slice(0, 10)).failure_code, 'PROVIDER_REGISTRY_CARDINALITY_INVALID');
  assert.equal(validateRequiredProviderRegistry(REQUIRED_PROVIDER_SLOTS.map(slot =>
    slot.key === 'TAIEX' ? { ...slot, sourceSymbol: 'TAIEX' } : slot,
  )).failure_code, 'PROVIDER_SYMBOL_INVALID');
});

test('production fixture sanitizer retains public market shape and strips credentials', () => {
  const sanitized = sanitizeProductionMarketPayload({
    date: '2026-09-15', symbol: 'IX0001', previousClose: 100,
    authorization: 'Bearer never-store', apiKey: 'never-store', nested: { token: 'never-store' },
    data: [{ symbol: '2330', price: 900, cookie: 'never-store' }],
  });
  assert.deepEqual(sanitized, {
    date: '2026-09-15', symbol: 'IX0001', previousClose: 100,
    data: [{ symbol: '2330', price: 900 }],
  });
  const serialized = JSON.stringify({ sanitized, shape: describeProductionResponseShape(sanitized) });
  assert.doesNotMatch(serialized, /never-store|authorization|apiKey|cookie|token/);
});

test('captured provider fixtures are exact, deidentified, hash-bound Production shapes', () => {
  for (const name of fixturePaths) {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/production-reliability-v1/${name}`, import.meta.url), 'utf8'));
    assert.equal(fixture.schema_version, 'PRODUCTION_PROVIDER_SHAPE_V1');
    assert.equal(fixture.contains_secrets, false);
    assert.equal(fixture.historical_success_claim, false);
    const sanitized = sanitizeProductionMarketPayload(fixture.captured_payload);
    assert.deepEqual(sanitized, fixture.captured_payload);
    assert.equal(createHash('sha256').update(stableJson(sanitized)).digest('hex'), fixture.response_sha256);
    assert.doesNotMatch(JSON.stringify(fixture), /authorization|api[-_]?key|service[-_]?role|bearer|cookie/i);
  }
});

test('06:50 preflight cannot trigger or write a business pipeline artifact', () => {
  assert.match(preflight, /OUTSIDE_0650_PREFLIGHT_WINDOW/);
  assert.match(preflight, /07:00_REFETCH_FROM_PROVIDERS/);
  assert.match(preflight, /NO_PREVIOUS_DAY_DATA/);
  assert.match(preflight, /from\('data_provider_health'\)\.upsert/);
  for (const forbidden of [
    'market_checkpoint_snapshots', 'market_data_snapshots', 'reports', 'recommendations',
    'line_delivery', 'trading_day_state', 'continuous_learning', 'acceptance',
  ]) {
    assert.doesNotMatch(preflight, new RegExp(`from\\(['\"]${forbidden}`));
  }
});

test('preflight schedule is isolated at 06:50 Taipei and private to service role', () => {
  assert.match(migration, /'50 22 \* \* 0-4'/);
  assert.match(migration, /market-readiness-preflight/);
  assert.match(migration, /x-daily-delivery-token/);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.invoke_market_readiness_preflight_v1\(\) from public, anon, authenticated/);
  assert.doesNotMatch(migration, /advance_trading_day_state|generate-daily-report|fetch-market-data|line-daily-push|capture_morning_alpha_acceptance/i);
});

test('known failures separate root cause, cascade, and environment drift without rewriting history', () => {
  assert.equal(failureRegistry.natural_day_pass_claimed, false);
  assert.equal(failureRegistry.historical_failures_preserved, true);
  assert.ok(failureRegistry.entries.every(entry =>
    entry.root_cause && entry.fix && entry.test && entry.production_reality_fixture && typeof entry.still_reachable === 'boolean'));
  assert.equal(failureRegistry.entries.find(entry => entry.id.includes('2330')).classification, 'CASCADE');
  assert.equal(failureRegistry.entries.filter(entry => entry.classification === 'ENVIRONMENT_DRIFT').length, 2);
  assert.ok(failureRegistry.entries.filter(entry => entry.id.startsWith('2026-09-')).every(entry =>
    /PRESERVED$/.test(entry.historical_result)));
});
