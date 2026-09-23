import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  TAIWAN_CASH_SESSION_CONTRACTS,
  evaluateTaiwanCashSession,
  taiwanCashExpectedSession,
} from '../supabase/functions/_shared/taiwan-cash-session-contract.mjs';
import {
  resolveFugle2330Provider,
  resolveFugleTaiexProvider,
  normalizeFugleTaiwanCoreResult,
} from '../supabase/functions/_shared/fugle-taiex-provider.mjs';
import {
  CHECKPOINT_PROVIDER_KEYS,
  buildCheckpointEvidence,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const production = JSON.parse(read('tests/fixtures/premarket-phase-v1/production-contract-20260922.json'));
const correlationId = '22070000-0000-4000-8000-000000000001';

const ticker = (key, date) => key === 'TAIEX'
  ? { symbol: 'IX0001', type: 'INDEX', exchange: 'TWSE', market: 'TSE', date, previousClose: 47718.84 }
  : { symbol: '2330', type: 'EQUITY', exchange: 'TWSE', market: 'TSE', date, previousClose: 2480, referencePrice: 2480 };
const quote = (key, date, timestamp) => key === 'TAIEX'
  ? { symbol: 'IX0001', type: 'INDEX', exchange: 'TWSE', market: 'TSE', date,
    price: 48000, previousClose: 47718.84, lastUpdated: timestamp }
  : { symbol: '2330', type: 'EQUITY', exchange: 'TWSE', market: 'TSE', date,
    price: 2500, previousClose: 2480, lastUpdated: timestamp };

async function resolve(key, payload, options) {
  const resolver = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
  return resolver(async request => request.endpoint.includes('/tickers?')
    ? { status: 200, payload: { type: 'INDEX', exchange: 'TWSE', data: [] } }
    : { status: 200, payload }, options);
}

test('9/22 retained Production evidence proves a date-only design rejection, not a provider outage', () => {
  assert.equal(production.contains_secrets, false);
  assert.deepEqual(production.business_writes, []);
  assert.equal(production.saved_production_evidence['0650'].global_pass_count, 8);
  assert.equal(production.saved_production_evidence['0650'].txf_status, 'PASS');
  for (const key of ['taiex', 'stock_2330']) {
    assert.equal(production.saved_production_evidence['0650'][`${key}_http_status`], 200);
    assert.equal(production.saved_production_evidence['0650'][`${key}_rejected_field`], 'date');
  }
  assert.equal(production.saved_production_evidence['0835'].atomic_error, 'ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID');
  assert.equal(production.saved_production_evidence['0900'].provider_count, 11);
  assert.equal(production.latest_completed_tw_session.date, '2026-09-21');
  assert.equal(production.saved_production_evidence['0900'].taiex_previous_close, production.latest_completed_tw_session.taiex_close);
  assert.equal(production.saved_production_evidence['0900'].stock_2330_previous_close, production.latest_completed_tw_session.stock_2330_close);
  assert.equal(production.real_raw_premarket_payload_retained, false);
});

test('PREMARKET: weekday, Monday and holiday return select exactly the latest completed TW session', () => {
  for (const scenario of [
    ['weekday', '2026-09-22', '2026-09-21'],
    ['monday', '2026-09-21', '2026-09-18'],
    ['holiday return', '2026-09-28', '2026-09-24'],
  ]) {
    const expected = taiwanCashExpectedSession({ phase: 'premarket', tradingDate: scenario[1] });
    assert.equal(expected.valid, true, scenario[0]);
    assert.equal(expected.expected_session_date, scenario[2], scenario[0]);
    assert.equal(expected.contract, TAIWAN_CASH_SESSION_CONTRACTS.premarket);
    assert.equal(evaluateTaiwanCashSession({
      phase: 'premarket', tradingDate: scenario[1], providerSessionDate: scenario[2],
      sourceTimestamp: `${scenario[2]}T00:00:00+08:00`, observedAt: `${scenario[1]}T07:00:00+08:00`,
    }).valid, true, scenario[0]);
  }
});

test('PREMARKET TAIEX/2330 adapter accepts prior/current envelopes and rejects stale or future dates', async () => {
  for (const key of ['TAIEX', '2330']) {
    const valid = await resolve(key, production.premarket_contract_payloads[key], {
      phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
    });
    assert.equal(valid.ok, true, key);
    assert.equal(valid.validation.session_contract.contract, TAIWAN_CASH_SESSION_CONTRACTS.premarket);
    const currentEnvelope = await resolve(key, ticker(key, '2026-09-22'), {
      phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
    });
    assert.equal(currentEnvelope.ok, true, key);
    assert.equal(currentEnvelope.validation.evidence_session_date, '2026-09-21', key);
    for (const date of ['2026-09-18', '2026-09-23']) {
      const invalid = await resolve(key, ticker(key, date), {
        phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
      });
      assert.equal(invalid.ok, false, `${key}:${date}`);
      assert.equal(invalid.failureCode, 'STALE_PROVIDER_DATA');
    }
  }
});

test('09:00 transition and CLOSE require the current completed/current trading session', async () => {
  for (const key of ['TAIEX', '2330']) {
    const intraday = await resolve(key, quote(key, '2026-09-22', '2026-09-22T09:00:15+08:00'), {
      phase: 'intraday', tradingDate: '2026-09-22', observedAt: '2026-09-22T09:00:20+08:00',
    });
    assert.equal(intraday.ok, true, key);
    assert.equal(intraday.validation.session_contract.contract, TAIWAN_CASH_SESSION_CONTRACTS.intraday);
    const prior = await resolve(key, quote(key, '2026-09-21', '2026-09-21T13:30:00+08:00'), {
      phase: 'intraday', tradingDate: '2026-09-22', observedAt: '2026-09-22T09:00:20+08:00',
    });
    assert.equal(prior.ok, false, key);
    const close = await resolve(key, quote(key, '2026-09-22', '2026-09-22T13:30:00+08:00'), {
      phase: 'close', tradingDate: '2026-09-22', observedAt: '2026-09-22T14:10:00+08:00',
    });
    assert.equal(close.ok, true, key);
    assert.equal(close.validation.session_contract.contract, TAIWAN_CASH_SESSION_CONTRACTS.close);
    const earlyClose = await resolve(key, quote(key, '2026-09-22', '2026-09-22T13:00:00+08:00'), {
      phase: 'close', tradingDate: '2026-09-22', observedAt: '2026-09-22T14:10:00+08:00',
    });
    assert.equal(earlyClose.ok, false, key);
  }
});

test('9/22 contract replay forms exactly 11 or 0 and preserves real session dates', async () => {
  const input = { phase: 'premarket', checkpoint: 'premarket', tradingDate: '2026-09-22',
    observedAt: '2026-09-22T07:00:00+08:00', correlationId };
  const rows = [];
  for (const [index, providerKey] of CHECKPOINT_PROVIDER_KEYS.entries()) {
    let normalized;
    if (providerKey === 'TAIEX' || providerKey === '2330') {
      const result = await resolve(providerKey, production.premarket_contract_payloads[providerKey], input);
      normalized = normalizeFugleTaiwanCoreResult(result, providerKey);
    } else if (providerKey === 'TXF') {
      normalized = { value: 100 + index, change: 1, changePercent: 0.1,
        capturedAt: '2026-09-22T05:00:00+08:00', provider: 'fugle_futopt', sourceSymbol: 'TXF1!',
        raw: { date: '2026-09-21', session: 'afterhours' } };
    } else {
      normalized = { value: 100 + index, change: 1, changePercent: 0.1,
        capturedAt: '2026-09-21T16:00:00-04:00', provider: 'finnhub', sourceSymbol: providerKey, raw: {} };
    }
    const evidence = buildCheckpointEvidence(input, normalized, {
      displaySymbol: providerKey, finnhubSymbol: providerKey,
      market: ['TAIEX', '2330', 'TXF'].includes(providerKey) ? 'TW' : 'US', name: providerKey,
    });
    assert.equal(evidence.valid, true, `${providerKey}:${evidence.error || 'invalid'}`);
    rows.push({ provider_key: providerKey, ...evidence.row });
  }
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).valid, true);
  assert.equal(rows.length, 11);
  assert.equal(rows.find(row => row.provider_key === 'TAIEX').raw.tw_cash_expected_session_date, '2026-09-21');
  const stale = structuredClone(rows);
  const taiex = stale.find(row => row.provider_key === 'TAIEX');
  taiex.raw.tw_cash_provider_session_date = '2026-09-18';
  assert.equal(validateAtomicCheckpointEvidenceRows(stale).valid, false);
  assert.equal(validateAtomicCheckpointEvidenceRows(stale.filter(row => row.provider_key !== 'TAIEX')).rowCount, 10);
});

test('Preflight, Fetch and Atomic consume the same shared cash-session contract', () => {
  const shared = read('supabase/functions/_shared/fetch-checkpoint-evidence.mjs');
  const adapter = read('supabase/functions/_shared/fugle-taiex-provider.mjs');
  const preflight = read('supabase/functions/market-readiness-preflight/index.ts');
  const fetch = read('supabase/functions/fetch-market-data-v10/index.ts');
  const migration = read('supabase/migrations/20260922015748_premarket_tw_cash_phase_contract_v1.sql');
  assert.match(adapter, /evaluateTaiwanCashSession/);
  assert.match(shared, /evaluateTaiwanCashSession/);
  for (const source of [preflight, fetch]) {
    assert.match(source, /resolveFugleTaiexProvider/);
    assert.match(source, /resolveFugle2330Provider/);
  }
  for (const marker of Object.values(TAIWAN_CASH_SESSION_CONTRACTS)) assert.match(migration, new RegExp(marker));
});
