import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeFugleTaiwanCoreResult,
  resolveFugle2330Provider,
  resolveFugleTaiexProvider,
} from '../supabase/functions/_shared/fugle-taiex-provider.mjs';
import {
  REQUIRED_PROVIDER_CONFIG,
  validateRequiredProviderEvidence,
} from '../supabase/functions/_shared/required-provider-validation.mjs';
import {
  CHECKPOINT_PROVIDER_KEYS,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const fixture = JSON.parse(readFileSync(new URL(
  './fixtures/premarket-phase-v1/production-parity-20260923.json',
  import.meta.url,
), 'utf8'));
const migration = readFileSync(new URL(
  '../supabase/migrations/20260923120000_premarket_ticker_envelope_session_parity_v1.sql',
  import.meta.url,
), 'utf8');
const correlationId = '23070002-2300-4000-8000-000000000001';
const input = {
  phase: 'premarket',
  checkpoint: 'premarket',
  tradingDate: fixture.business_date,
  observedAt: fixture.fetch_0700.first_attempt_at,
  correlationId,
};

async function resolveTaiwan(key, payload) {
  const resolver = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
  return resolver(async request => request.endpoint.includes('/tickers?')
    ? { status: 200, payload: { type: 'INDEX', exchange: 'TWSE', data: [] } }
    : { status: 200, payload }, {
    phase: input.phase,
    tradingDate: input.tradingDate,
    observedAt: input.observedAt,
  });
}

test('9/23 retained Production evidence reproduces the exact 06:50 PASS to 07:00 date rejection', () => {
  assert.equal(fixture.fixture_type, 'REAL_PRODUCTION_PREDICATE_RECONSTRUCTION');
  assert.equal(fixture.real_raw_0700_payload_retained, false);
  assert.equal(fixture.contains_secrets, false);
  assert.deepEqual(fixture.business_writes, []);
  assert.equal(fixture.readiness_0650.succeeded_count, 11);
  assert.equal(fixture.historical_outcome.premarket_atomic_rows, 0);
  assert.equal(fixture.historical_outcome.historical_failure_rewritten, false);
  for (const key of ['TAIEX', '2330']) {
    const at0650 = fixture.readiness_0650.providers[key];
    const at0700 = fixture.fetch_0700.rejected_providers.find(row => row.provider_key === key);
    assert.equal(at0650.provider_envelope_date, '2026-09-22');
    assert.equal(at0700.provider_envelope_date, '2026-09-23');
    assert.equal(at0650.evidence_session_date, '2026-09-22');
    assert.equal(at0700.evidence_session_date, '2026-09-22');
    assert.equal(at0700.http_status, 200);
    assert.equal(at0700.failure_code, 'STALE_PROVIDER_DATA');
    assert.equal(at0700.rejected_field, 'date');
    const legacyPredicate = value => value.provider_envelope_date === value.evidence_session_date;
    assert.equal(legacyPredicate(at0650), true);
    assert.equal(legacyPredicate(at0700), false);
  }
});

test('9/23 database candidate pins the deployed predecessor and changes only the premarket envelope/session predicate', () => {
  assert.match(migration, /v_baseline constant text := '00fcf28b4af0331b30dd2cea068dc3dc'/);
  assert.match(migration, /source_raw'->>'evidence_session_date'/);
  assert.match(migration, /source_raw'->>'provider_envelope_date'/);
  assert.match(migration, /not in \(v_tw_cash_expected_session_date::text, p_business_date::text\)/);
  assert.match(migration, /PREMARKET_TICKER_ENVELOPE_SESSION_BASELINE_MISMATCH/);
  assert.doesNotMatch(migration, /create table|alter table|insert into|update |delete from|grant |revoke |08:45|07:30/i);
});

test('9/23 current ticker envelope preserves the prior completed session lineage for both Taiwan providers', async () => {
  for (const key of ['TAIEX', '2330']) {
    const result = await resolveTaiwan(key, fixture.contract_payloads[key]);
    assert.equal(result.ok, true, key);
    assert.equal(result.validation.provider_envelope_date, '2026-09-23', key);
    assert.equal(result.validation.evidence_session_date, '2026-09-22', key);
    assert.equal(result.validation.session_contract.provider_session_date, '2026-09-22', key);
    const normalized = normalizeFugleTaiwanCoreResult(result, key);
    assert.equal(normalized.value, fixture.immutable_session_lineage[key].close, key);
    assert.equal(normalized.raw.provider_envelope_date, '2026-09-23', key);
    assert.equal(normalized.raw.evidence_session_date, '2026-09-22', key);
    const slot = REQUIRED_PROVIDER_CONFIG.find(item => item.key === key);
    const evidence = validateRequiredProviderEvidence(slot, normalized, input);
    assert.equal(evidence.valid, true, `${key}:${evidence.error || 'invalid'}`);
    assert.equal(evidence.row.raw.tw_cash_provider_session_date, '2026-09-22', key);
    assert.equal(evidence.row.raw.source_raw.response_date, '2026-09-23', key);
  }
});

test('9/23 parity fix remains fail-closed for stale/future premarket and prior-session intraday payloads', async () => {
  for (const key of ['TAIEX', '2330']) {
    for (const date of ['2026-09-21', '2026-09-24']) {
      const result = await resolveTaiwan(key, { ...fixture.contract_payloads[key], date });
      assert.equal(result.ok, false, `${key}:${date}`);
      assert.equal(result.failureCode, 'STALE_PROVIDER_DATA', `${key}:${date}`);
    }
    const resolver = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
    const priorIntraday = await resolver(async request => request.endpoint.includes('/tickers?')
      ? { status: 200, payload: { type: 'INDEX', exchange: 'TWSE', data: [] } }
      : { status: 200, payload: {
        ...fixture.contract_payloads[key],
        date: '2026-09-22',
        price: fixture.immutable_session_lineage[key].close,
        lastUpdated: '2026-09-22T13:30:00+08:00',
      } }, {
      phase: 'intraday',
      tradingDate: '2026-09-23',
      observedAt: '2026-09-23T09:00:20+08:00',
    });
    assert.equal(priorIntraday.ok, false, key);
    assert.equal(priorIntraday.failureCode, 'STALE_PROVIDER_DATA', key);
  }
});

test('9/23 Taiwan evidence completes one 11-row Atomic contract without changing the other nine slots', async () => {
  const rows = CHECKPOINT_PROVIDER_KEYS.map((key, index) => ({
    provider_key: key,
    checkpoint: 'PREMARKET',
    trading_date: fixture.business_date,
    captured_at: input.observedAt,
    market_session: 'premarket',
    symbol: key,
    value: 100 + index,
    change_percent: 0,
    source: ['TAIEX', '2330'].includes(key) ? 'fugle' : key === 'TXF' ? 'fugle_futopt' : 'finnhub',
    source_timestamp: key === 'TXF' ? '2026-09-23T05:00:00+08:00'
      : ['TAIEX', '2330'].includes(key) ? '2026-09-22T00:00:00+08:00' : '2026-09-22T16:00:00-04:00',
    correlation_id: correlationId,
    raw: {
      contract: 'FETCH_CHECKPOINT_EVIDENCE_V1',
      market: ['TAIEX', '2330', 'TXF'].includes(key) ? 'TW' : 'US',
      change: 0,
      freshness_status: ['TAIEX', '2330', 'TXF'].includes(key) ? 'fresh' : 'provider_returned',
      freshness_age_minutes: 0,
      captured_session_date: key === 'TXF' ? '2026-09-23' : '2026-09-22',
      source_raw: {},
    },
  }));
  for (const key of ['TAIEX', '2330']) {
    const result = await resolveTaiwan(key, fixture.contract_payloads[key]);
    const normalized = normalizeFugleTaiwanCoreResult(result, key);
    const slot = REQUIRED_PROVIDER_CONFIG.find(item => item.key === key);
    const evidence = validateRequiredProviderEvidence(slot, normalized, input);
    const index = rows.findIndex(row => row.provider_key === key);
    rows[index] = { provider_key: key, ...evidence.row };
  }
  const txf = rows.find(row => row.provider_key === 'TXF');
  Object.assign(txf.raw, {
    txf_session_contract: 'TXF_PREMARKET_SESSION_V1',
    txf_expected_previous_trading_date: '2026-09-22',
    txf_provider_session_date: '2026-09-22',
    txf_session_type: 'afterhours',
    source_raw: { date: '2026-09-22', session: 'afterhours' },
  });
  assert.deepEqual(rows.map(row => row.provider_key), CHECKPOINT_PROVIDER_KEYS);
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).valid, true);
  assert.equal(validateAtomicCheckpointEvidenceRows(rows.filter(row => row.provider_key !== 'TAIEX')).rowCount, 10);
});
