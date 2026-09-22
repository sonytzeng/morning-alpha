import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CHECKPOINT_PROVIDER_KEYS,
  buildCheckpointEvidence,
  validateAtomicCheckpointEvidenceRows,
} from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import {
  TXF_PREMARKET_SESSION_CONTRACT,
  evaluatePremarketTxfSession,
} from '../supabase/functions/_shared/txf-session-contract.mjs';
import { previousTradingDay } from '../supabase/functions/_shared/market-status.ts';
import { hasFailedEvidenceDependency } from '../supabase/functions/_shared/daily-delivery-recovery.ts';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const production = JSON.parse(read('tests/fixtures/production-parity-v3/txf-weekend-20260921.json'));
const correlationId = '21083538-0000-4000-8000-000000000001';

function evaluate({ tradingDate, providerSessionDate, sourceTimestamp, observedAt, session = 'afterhours' }) {
  return evaluatePremarketTxfSession({ tradingDate, providerSessionDate, sourceTimestamp, observedAt, session });
}

function fullBatch(txf = production.txf) {
  const input = {
    phase: 'premarket', checkpoint: 'premarket', tradingDate: production.business_date,
    observedAt: production.observed_at, correlationId,
  };
  return CHECKPOINT_PROVIDER_KEYS.map((providerKey, index) => {
    const market = ['TAIEX', '2330', 'TXF'].includes(providerKey) ? 'TW' : 'US';
    const quote = providerKey === 'TXF'
      ? {
        value: 100 + index, change: 1, changePercent: 0.1,
        capturedAt: txf.source_timestamp, provider: 'fugle_futopt', sourceSymbol: txf.source_symbol,
        raw: { date: txf.provider_session_date, session: txf.session, provider: 'fugle_futopt' },
      }
      : {
        value: 100 + index, change: 1, changePercent: 0.1,
        capturedAt: market === 'TW' ? '2026-09-18T00:00:00+08:00' : '2026-09-18T16:00:00-04:00',
        provider: market === 'TW' ? 'fugle' : 'finnhub', sourceSymbol: providerKey,
        raw: { provider: market === 'TW' ? 'fugle' : 'finnhub',
          ...(market === 'TW' ? { date: '2026-09-18', response_date: '2026-09-18' } : {}) },
      };
    const result = buildCheckpointEvidence(input, quote, {
      displaySymbol: providerKey, finnhubSymbol: providerKey, market, name: providerKey,
    });
    if (!result.valid) return { provider_key: providerKey, error: result.error };
    return { provider_key: providerKey, ...result.row };
  });
}

test('TXF_SESSION_MAPPING: weekday, Monday and long-holiday premarket map to the latest valid session', () => {
  for (const scenario of [
    {
      name: 'weekday', tradingDate: '2026-09-22', providerSessionDate: '2026-09-21',
      sourceTimestamp: '2026-09-22T05:00:00+08:00', observedAt: '2026-09-22T06:50:00+08:00',
    },
    {
      name: 'monday', tradingDate: '2026-09-21', providerSessionDate: '2026-09-18',
      sourceTimestamp: '2026-09-19T05:00:00+08:00', observedAt: '2026-09-21T06:50:00+08:00',
    },
    {
      name: 'long holiday', tradingDate: '2026-06-22', providerSessionDate: '2026-06-18',
      sourceTimestamp: '2026-06-19T05:00:00+08:00', observedAt: '2026-06-22T06:50:00+08:00',
    },
  ]) {
    const result = evaluate(scenario);
    assert.equal(result.valid, true, `${scenario.name}: ${result.error || 'invalid'}`);
    assert.equal(result.contract, TXF_PREMARKET_SESSION_CONTRACT);
    assert.equal(previousTradingDay(scenario.tradingDate), scenario.providerSessionDate);
  }
});

test('TXF_SESSION_MAPPING: stale, wrong-session and future evidence fail closed', () => {
  assert.equal(evaluate({
    tradingDate: '2026-09-21', providerSessionDate: '2026-09-11',
    sourceTimestamp: '2026-09-12T05:00:00+08:00', observedAt: '2026-09-21T06:50:00+08:00',
  }).error, 'TXF_SESSION_STALE');
  assert.equal(evaluate({
    tradingDate: '2026-09-21', providerSessionDate: '2026-09-18', session: 'regular',
    sourceTimestamp: '2026-09-19T05:00:00+08:00', observedAt: '2026-09-21T06:50:00+08:00',
  }).error, 'TXF_SESSION_TYPE_MISMATCH');
  assert.equal(evaluate({
    tradingDate: '2026-09-21', providerSessionDate: '2026-09-18',
    sourceTimestamp: '2026-09-21T07:00:00+08:00', observedAt: '2026-09-21T06:50:00+08:00',
  }).error, 'TXF_FUTURE_TIMESTAMP');
});

test('9/21 sanitized Production contract replay becomes 11/11 without rewriting the historical failure', () => {
  assert.equal(production.contract_relevant_fields_from_production, true);
  assert.equal(production.contains_secrets, false);
  assert.deepEqual(production.business_writes, []);
  assert.deepEqual(production.provider_state, {
    TAIEX: 'READY', '2330': 'READY', TXF: 'READY', required_provider_count: 11, provider_failures: [],
  });
  assert.deepEqual(production.production_outcome, {
    atomic_error: 'ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID', committed_rows: 0, report_count: 0,
  });
  const rows = fullBatch();
  assert.equal(rows.some(row => row.error), false, JSON.stringify(rows));
  assert.equal(validateAtomicCheckpointEvidenceRows(rows).valid, true);
  assert.equal(rows.find(row => row.provider_key === 'TXF').raw.txf_expected_previous_trading_date, '2026-09-18');
});

test('invalid TXF can never become a partial or mixed Atomic batch', () => {
  const rows = fullBatch({ ...production.txf, session: 'regular' });
  assert.equal(rows.find(row => row.provider_key === 'TXF').error, 'TXF_SESSION_TYPE_MISMATCH');
  const accepted = rows.filter(row => !row.error);
  assert.equal(accepted.length, 10);
  assert.deepEqual(validateAtomicCheckpointEvidenceRows(accepted), {
    valid: false, error: 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY', rowCount: 10,
  });
});

test('Edge and Preflight pass identical trading-date and observation identity into the shared TXF adapter', () => {
  const fetch = read('supabase/functions/fetch-market-data-v10/index.ts');
  const preflight = read('supabase/functions/market-readiness-preflight/index.ts');
  assert.match(fetch, /\{ phase, tradingDate, observedAt \}/);
  assert.match(preflight, /\{ phase: 'premarket', tradingDate, observedAt: String\(evidenceInput\.observedAt \|\| ''\) \}/);
  for (const source of [fetch, preflight]) assert.match(source, /resolveRequiredTxfQuote/);
});

test('runtime orchestration never advances to report generation after an Atomic market refresh failure', async () => {
  const source = read('supabase/functions/daily-delivery-orchestrator/index.ts');
  let reportCalls = 0;
  const executeRecoveryActions = isolatedFunction(source, 'executeRecoveryActions', {
    hasFailedEvidenceDependency,
    invokeFunctionWithRetry: async (_base, name) => ({
      ok: name !== 'fetch-market-data-v10', status: name === 'fetch-market-data-v10' ? 409 : 200,
      payload: name === 'fetch-market-data-v10' ? { error: 'ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID' } : { success: true },
    }),
    invokeFunction: async () => { reportCalls += 1; return { ok: true, status: 200, payload: { success: true } }; },
    Promise,
  });
  const results = await executeRecoveryActions({
    actions: ['refresh_market', 'regenerate_report'], baseUrl: 'http://127.0.0.1.invalid',
    cronSecret: 'fixture-only', attempt: 1, reasonCodes: [], allowIncident: false,
    reportDate: '2026-09-21', suppressNotifications: true,
  });
  assert.equal(results.refresh_market.ok, false);
  assert.equal(results.regenerate_report.status, 424);
  assert.equal(results.regenerate_report.payload.error, 'EVIDENCE_REFRESH_DEPENDENCY_FAILED');
  assert.equal(reportCalls, 0);
});
