import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {GLOBAL8_SOURCE_SYMBOLS,isMarketTradingDate,previousMarketTradingDate,latestCompletedUsSession,usSessionCloseMinute} from '../supabase/functions/_shared/market-session-contract.mjs';
import {previousTradingDay,resolveMarketStatus} from '../supabase/functions/_shared/market-status.ts';
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
// Explicit synthetic completed quotes; no historical Production payload is
// changed or represented as a real completed-quote response.
const completedQuote = (key, date, timestamp) => {
  const payload = quote(key, date, timestamp);
  return { ...payload, closePrice: payload.price, isClose: true };
};

async function resolve(key, payload, options) {
  const resolver = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
  return resolver(async request => request.endpoint.includes('/tickers?')
    ? { status: 200, payload: { type: 'INDEX', exchange: 'TWSE', data: [] } }
    : { status: 200, payload }, options);
}

test('9/22 retained Production metadata preserves historical rejection and contract-only ticker shapes', () => {
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
  assert.match(production.payload_provenance, /Contract-only reconstruction/);
  assert.match(production.payload_provenance, /no unretained raw response is claimed/);
});

test('SYNTHETIC PREMARKET date contract selects the weekday, Monday and holiday completed session', () => {
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
      sourceTimestamp: `${scenario[2]}T13:30:00+08:00`, observedAt: `${scenario[1]}T07:00:00+08:00`,
    }).valid, true, scenario[0]);
  }
});

test('PREMARKET rejects retained contract-only prior ticker and synthetic current ticker as completed closes', async () => {
  for (const key of ['TAIEX', '2330']) {
    // Retain the old date/value exactly: this was a reconstructed ticker
    // shape, and is now a negative control rather than quote truth.
    const priorTicker = await resolve(key, production.premarket_contract_payloads[key], {
      phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
    });
    assert.equal(priorTicker.ok, false, key);
    assert.equal(priorTicker.rejectedField, 'completed_close');
    const currentEnvelope = await resolve(key, ticker(key, '2026-09-22'), {
      phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
    });
    assert.equal(currentEnvelope.ok, false, key);
    assert.equal(currentEnvelope.rejectedField, 'completed_close');
    for (const date of ['2026-09-18', '2026-09-23']) {
      const invalid = await resolve(key, ticker(key, date), {
        phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
      });
      assert.equal(invalid.ok, false, `${key}:${date}`);
      assert.equal(invalid.failureCode, 'STALE_PROVIDER_DATA');
    }
  }
});

test('SYNTHETIC PREMARKET requests prior completed quotes and preserves source timestamp and measured change', async () => {
  for (const key of ['TAIEX', '2330']) {
    const payload = completedQuote(key, '2026-09-21', '2026-09-21T13:30:00+08:00');
    const calls = [], resolver = key === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
    const result = await resolver(async request => {
      calls.push(request.endpoint);
      return request.endpoint.includes('/tickers?')
        ? { status: 200, payload: { type: 'INDEX', exchange: 'TWSE', data: [] } }
        : { status: 200, payload };
    }, { phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00' });
    assert.equal(result.ok, true, key);
    assert.equal(result.endpoint, `stock/intraday/quote/${key === 'TAIEX' ? 'IX0001' : '2330'}`);
    assert.ok(calls.every(endpoint => !endpoint.includes('/ticker/')));
    assert.equal(result.validation.session_contract.contract, TAIWAN_CASH_SESSION_CONTRACTS.premarket);
    const normalized = normalizeFugleTaiwanCoreResult(result, key);
    assert.equal(normalized.capturedAt, '2026-09-21T05:30:00.000Z');
    assert.equal(normalized.raw.evidence_session_date, '2026-09-21');
    assert.equal(normalized.value, payload.closePrice);
    assert.equal(normalized.change, payload.closePrice - payload.previousClose);
    assert.ok(normalized.changePercent > 0);
  }
});

test('SYNTHETIC PREMARKET direct adapter rejects reference price without actual previousClose', async () => {
  for (const key of ['TAIEX', '2330']) {
    const payload = completedQuote(key, '2026-09-21', '2026-09-21T13:30:00+08:00');
    payload.referencePrice = payload.previousClose;
    delete payload.previousClose;
    const result = await resolve(key, payload, {
      phase: 'premarket', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
    });
    assert.equal(result.ok, false, key);
    assert.equal(result.rejectedField, 'completed_close');
  }
});

test('SYNTHETIC manual_backfill preserves the existing reference-only ticker route', async () => {
  for (const key of ['TAIEX', '2330']) {
    const result = await resolve(key, ticker(key, '2026-09-22'), {
      phase: 'manual_backfill', tradingDate: '2026-09-22', observedAt: '2026-09-22T07:00:00+08:00',
    });
    assert.equal(result.ok, true, key);
    assert.equal(result.endpoint, `stock/intraday/ticker/${key === 'TAIEX' ? 'IX0001' : '2330'}`);
    assert.match(result.priceBasis, /REFERENCE/);
    assert.equal(result.validation.session_contract, null);
  }
});

test('SYNTHETIC 09:00 transition and CLOSE retain the current completed/current trading session contract', async () => {
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

test('SYNTHETIC completed-quote replay forms exactly 11 or 0 with explicit session dates', async () => {
  const input = { phase: 'premarket', checkpoint: 'premarket', tradingDate: '2026-09-22',
    observedAt: '2026-09-22T07:00:00+08:00', correlationId };
  const rows = [];
  for (const [index, providerKey] of CHECKPOINT_PROVIDER_KEYS.entries()) {
    let normalized;
    if (providerKey === 'TAIEX' || providerKey === '2330') {
      const result = await resolve(providerKey, completedQuote(providerKey, '2026-09-21', '2026-09-21T13:30:00+08:00'), input);
      normalized = normalizeFugleTaiwanCoreResult(result, providerKey);
    } else if (providerKey === 'TXF') {
      normalized = { value: 100 + index, change: 1, changePercent: 0.1,
        capturedAt: '2026-09-22T05:00:00+08:00', provider: 'fugle_futopt', sourceSymbol: 'TXF1!',
        raw: { date: '2026-09-21', session: 'afterhours' } };
    } else {
      normalized = { value: 100 + index, change: 1, changePercent: 0.1,
        capturedAt: '2026-09-21T16:00:00-04:00', provider: 'finnhub', sourceSymbol: GLOBAL8_SOURCE_SYMBOLS[providerKey], raw: {} };
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

test('cash helper follows central exceptional closure without inventing a typhoon cause', () => {
  const exceptional=resolveMarketStatus('2026-10-23');
  assert.equal(exceptional.is_trading_day,false);assert.equal(exceptional.market_status,'EMERGENCY_CLOSE');
  assert.equal(exceptional.next_trading_day,'2026-10-27');
  assert.equal(resolveMarketStatus('2026-07-10').market_status,'TYPHOON','original specific July status remains');
  for(const [date,expected]of [['2026-10-27','2026-10-22'],['2026-11-02','2026-10-30']]){
    assert.equal(previousTradingDay(date),expected);assert.equal(previousMarketTradingDate('TW',date),expected);
    assert.equal(taiwanCashExpectedSession({phase:'premarket',tradingDate:date}).expected_session_date,expected);
  }
});

test('cash calendar rejects impossible and out-of-range dates rather than normalizing them', () => {
  for(const date of ['2026-02-30','not-a-date','2024-12-31','2027-01-01']){
    assert.equal(previousTradingDay(date),null,date);assert.equal(resolveMarketStatus(date).is_trading_day,false,date);
  }
});

test('TW exceptional repair leaves US latest completed session and half-day rules unchanged', () => {
  assert.equal(latestCompletedUsSession(Date.parse('2026-11-02T07:00:00+08:00')),'2026-10-30');
  assert.equal(isMarketTradingDate('US','2026-11-26'),false);assert.equal(isMarketTradingDate('US','2026-11-27'),true);
  assert.equal(usSessionCloseMinute('2026-11-27'),780);assert.equal(usSessionCloseMinute('2026-10-30'),960);
});
