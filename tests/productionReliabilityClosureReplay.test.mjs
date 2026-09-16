import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { replayProductionRealityProviderBatch } from './helpers/productionRealityProviderReplay.mjs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('Production reality affected-path replay composes with the immutable actual full-chain baseline', async () => {
  const providerReplay = await replayProductionRealityProviderBatch();
  const baselineUrl = new URL('./fixtures/consolidation-v1/local-runs/full-chain-market-only-20260921.json', import.meta.url);
  const baselineBytes = readFileSync(baselineUrl);
  const baseline = JSON.parse(baselineBytes);

  assert.equal(providerReplay.provider_count, 11);
  assert.equal(providerReplay.atomic.valid, true);
  assert.equal(providerReplay.source, 'REAL_PRODUCTION_CAPTURE');
  assert.equal(providerReplay.replay_uses_same_adapter_as_production, true);
  assert.equal(providerReplay.replay_uses_same_contract_as_production, true);
  assert.equal(providerReplay.replay_uses_correct_market_phase, true);
  const taiex = providerReplay.evidence.find(row => row.provider_key === 'TAIEX');
  assert.equal(taiex?.source, 'fugle');
  assert.equal(taiex?.raw?.source_symbol, 'IX0001');
  assert.equal(taiex?.raw?.source_raw?.price_basis, 'CURRENT_SESSION_PREVIOUS_CLOSE_REFERENCE');
  assert.equal(taiex?.raw?.source_raw?.response_date, '2026-09-16');
  assert.equal(taiex?.raw?.freshness_status, 'provider_returned');

  assert.equal(sha256(baselineBytes), '9ac767daa8e6275af75c85044bfbfc8a789c18fab75888b74cabeebce3c97743');
  assert.equal(baseline.provenance.output_evidence_only, true);
  assert.equal(baseline.observed.status, 'PASS');
  assert.equal(baseline.observed.full_persisted_chain_executed, true);
  assert.equal(baseline.observed.actual_handlers, 12);
  assert.equal(baseline.observed.record_count, 96);
  assert.deepEqual(baseline.observed.checkpoints.map(row => row.checkpoint), [
    'PREMARKET', '0900', '0930', '1030', '1300', '1410', '1430',
  ]);
  assert.ok(baseline.observed.checkpoints.every(row => row.producer_readback_verified === true));
  assert.equal(baseline.observed.line.exact_retry_receipt_unchanged, true);
  assert.equal(baseline.observed.closing.status, 'COMPLETE');
  assert.equal(baseline.observed.learning.status, 'COMPLETE');
  assert.equal(baseline.observed.terminal.success, true);
  assert.equal(baseline.observed.acceptance.verdict, 'PASS');
  assert.equal(baseline.scope_limits.production_requests, 0);
  assert.equal(baseline.scope_limits.external_provider_business_requests, 0);
});

test('historical Production failures remain failures and are not replay inputs', () => {
  const registry = readJson('../docs/operations/evidence/production-reliability-known-failures-20260915.json');
  assert.equal(registry.historical_failures_preserved, true);
  assert.equal(registry.natural_day_pass_claimed, false);
  const historical = registry.entries.filter(row => row.historical_result === 'FAIL_PRESERVED');
  assert.ok(historical.length >= 3);
  assert.ok(historical.every(row => row.still_reachable === false));
});
