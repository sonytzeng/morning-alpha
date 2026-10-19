import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import { IDENTITY, evidenceRows } from './fixtures/decision-evidence-rows.mjs';

// Synthetic correctness regressions, not provider data, a backtest or Production E2E.
const run = data => buildEvidenceDecision(data, IDENTITY);
const candidate = (decision, symbol) => decision.phase_evaluation.candidates.find(row => row.symbol === symbol);
const opportunity = (decision, symbol) => decision.stock_opportunities.find(row => row.symbol === symbol);
const mixedQuarter = data => {
  data.earnings.find(row => row.symbol === '2330' && row.fiscal_period === '2026-Q1').eps_actual = 3;
};

test('a fully measured mixed result does not remove other stocks entry evidence', () => {
  const baseline = run(evidenceRows()), data = evidenceRows();
  mixedQuarter(data);
  const result = run(data);
  assert.equal(result.screening.status, 'COMPLETE');
  assert.equal(result.screening.evaluated_count, 3);
  assert.equal(candidate(result, '2330').status, 'NONE');
  assert.deepEqual(candidate(result, '2330').reasons, ['FOUR_QUARTER_FUNDAMENTAL_CRITERIA_NOT_MET']);
  // Only earnings changed: all observed price-response evidence remains identical.
  assert.deepEqual(result.factor_availability.priced_in, baseline.factor_availability.priced_in);
  assert.deepEqual(result.entry_environment_score, baseline.entry_environment_score);
  assert.equal(result.phase_evaluation.ready_count, 2);
  assert.equal(result.phase_evaluation.none_count, 1);
  for (const symbol of ['2317', '2382']) {
    assert.equal(candidate(result, symbol).status, 'READY');
    assert.deepEqual(opportunity(result, symbol).priced_in_score, opportunity(baseline, symbol).priced_in_score);
    assert.deepEqual(opportunity(result, symbol).opportunity_score, opportunity(baseline, symbol).opportunity_score);
  }
});

test('a fully measured quality rejection remains part of whole-universe price coverage', () => {
  const baseline = run(evidenceRows()), data = evidenceRows();
  data.flows.filter(row => row.symbol === '2330').forEach(row => {
    row.buy_amount = 1; row.sell_amount = 1000; row.net_amount = -999;
  });
  data.quotes.filter(row => row.symbol === '2330' && row.phase === 'intraday').forEach(row => {
    row.value = 100; row.raw_payload.source_raw.total.tradeVolume = 1;
  });
  const result = run(data);
  assert.equal(result.screening.status, 'COMPLETE');
  assert.equal(result.screening.evaluated_count, 3);
  assert.equal(candidate(result, '2330').status, 'DROP');
  assert.deepEqual(candidate(result, '2330').reasons, ['QUALITY_THRESHOLD_NOT_MET']);
  assert.equal(result.factor_availability.priced_in.status, 'AVAILABLE');
  assert.ok(result.factor_availability.priced_in.evidence_ids.some(id => id.includes('2330-2026-09-07')));
  assert.notEqual(result.entry_environment_score, null);
  assert.equal(result.phase_evaluation.ready_count, 2);
  assert.equal(result.phase_evaluation.none_count, 1);
  for (const symbol of ['2317', '2382']) {
    assert.equal(candidate(result, symbol).status, 'READY');
    assert.deepEqual(opportunity(result, symbol).opportunity_score, opportunity(baseline, symbol).opportunity_score);
  }
});

test('a missing or late post-event measurement still blocks the whole universe', () => {
  for (const problem of ['zero-volume', 'late-ingestion']) {
    const data = evidenceRows(); mixedQuarter(data);
    data.quotes.filter(row => row.symbol === '2330' && row.phase === 'intraday').forEach(row => {
      if (problem === 'zero-volume') row.raw_payload.source_raw.total.tradeVolume = 0;
      else row.ingested_at = '2026-09-07T03:00:00Z';
    });
    const result = run(data);
    assert.equal(result.screening.status, 'INCOMPLETE', problem);
    assert.equal(candidate(result, '2330').status, 'BLOCKED', problem);
    assert.equal(result.factor_availability.priced_in.status, 'UNAVAILABLE', problem);
    assert.equal(result.entry_environment_score, null, problem);
    assert.equal(result.action, 'INSUFFICIENT_DATA', problem);
    assert.equal(result.phase_evaluation.ready_count, 0, problem);
    assert.deepEqual(result.stock_opportunities, [], problem);
  }
});
