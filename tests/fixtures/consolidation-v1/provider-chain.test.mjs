// Real production parsers, evidence builders, assembler and projection; no DB
// persistence or actual business handler invocation. Not a full-chain runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayCheckpointConstruction, replayProviderQuote } from '../../helpers/consolidationProviderReplay.mjs';
import { isolatedFunction } from '../../helpers/isolatedEdgeLoader.mjs';
import { buildCheckpointEvidence, checkpointCollectionContract } from '../../../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import { assembleResearchMasterV2, assembleCanonicalMarketResearch, validateResearchMasterV2 } from '../../../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState } from '../../../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../../../supabase/functions/_shared/market-report-gate.ts';
import { normalizePremiumMarketEvidence } from '../../../supabase/functions/_shared/premium-evidence.ts';
import { canonicalReportProjection } from '../../../supabase/functions/_shared/research-pipeline-contract.ts';
import { createSubscriberState, getSubscriberReportProjection } from '../../../src/lib/subscriberReportContract.ts';
import { loadConsolidationFixtures, loadConsolidationProviderInput } from './index.mjs';

const fixture = () => structuredClone(loadConsolidationProviderInput('synthetic-provider-input-20260714'));
const assemblerSource = readFileSync(new URL('../../../supabase/functions/generate-daily-report-v7/research-master-v2.test.ts', import.meta.url), 'utf8');

async function marketCounterfactual(mutate = () => {}) {
  const vendor = fixture();
  mutate(vendor);
  const replay = await replayCheckpointConstruction(vendor);
  const input = isolatedFunction(assemblerSource, 'completeFixture')();
  input.dataAsOf = vendor.collection.observedAt;
  input.generatedAt = '2026-07-13T22:31:00.000Z';
  const marketEvidence = replay.observations.map(observed => {
    if (!observed.evidence.valid) return null;
    const row = observed.evidence.row;
    return normalizePremiumMarketEvidence({ symbol: row.symbol, name: row.raw.name,
      value: row.value, changePercent: row.change_percent, updatedAt: row.source_timestamp }, Date.parse(input.generatedAt));
  });
  for (const [id, symbol] of [['MD001', 'SOX'], ['MD002', 'VIX']]) {
    const observed = replay.observations.find(row => row.symbol === symbol);
    const index = input.evidenceIndex.find(row => row.evidence_id === id);
    if (!observed.evidence.valid) {
      index.freshness = 'invalid'; index.published_at = null;
      continue;
    }
    const row = observed.evidence.row;
    const normalized = marketEvidence.find(value => value?.symbol === symbol);
    index.freshness = normalized?.freshness_status || 'invalid';
    index.source = `synthetic-provider:${row.source}`;
    index.published_at = row.source_timestamp;
    index.summary = `${symbol} price ${row.value}; change ${row.change_percent}%; deterministic provider-shaped observation.`;
    index.raw_reference = `${symbol}:${observed.parsed.response_sha256}`;
  }
  const ai = input.legacy;
  ai.data_quality = 'complete'; ai.missing_sources = []; ai.v10_beneficiary_enabled = true;
  const verifiedMarket = marketEvidence.filter(value => value && ['fresh', 'recent'].includes(value.freshness_status));
  // Counts derive from the actual normalizer above; no captured 76 or success
  // score is assigned to this new market audit. News ingestion remains unrun.
  ai.content_evidence_quality = { contract_version: 'PREMIUM_EVIDENCE_V1',
    verified_market_count: verifiedMarket.length, verified_news_count: 0,
    verified_catalyst_count: verifiedMarket.length, all_news_traceable: true,
    blank_market_change_count: verifiedMarket.filter(value => !Number.isFinite(value.change_percent)).length,
    rejected_market_row_count: replay.observations.length - verifiedMarket.length };
  ai.today_quote = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  ai.v8_daily_sentence = { sentence: ai.today_quote };
  ai.free_summary = { one_sentence: ai.today_quote };
  ai.member_research_note_v2.today_core_thesis = ai.today_quote;
  ai.today_beneficiary_stocks_v10 = vendor.unsupported_stock_symbols.map(symbol => ({
    symbol, name: `synthetic-${symbol}`, reason: 'Only sector evidence; company support is absent', evidence_refs: ['SEC001'],
    confirmation: 'Synthetic proposed condition: inspect sector breadth at 09:30; no confirmed observation.',
    invalidation: 'Synthetic proposed invalidation: no company evidence means no recommendation.',
  }));
  const privateDocument = assembleResearchMasterV2(input);
  privateDocument.quality = validateResearchMasterV2(privateDocument, input).quality;
  ai.stock_research = { schema_version: 'STOCK_RESEARCH_V1', report_date: input.reportDate, document: privateDocument };
  const market = assembleCanonicalMarketResearch(input);
  ai.canonical_market_state = buildCanonicalMarketState(market);
  ai.research_master_v2 = market;
  return { vendor, replay, input, ai, privateDocument, market, gate: evaluateMarketReportGate(ai, input.reportDate) };
}

test('provider-shaped responses run actual Fetch declarations and evidence construction, not persistence', async () => {
  const replay = await replayCheckpointConstruction(fixture());
  assert.equal(replay.scope, 'PROVIDER_COMPONENT_CHAIN_ONLY');
  for (const row of replay.observations) {
    assert.equal(row.evidence.valid, true, `${row.symbol}: ${row.evidence.error}`);
    assert.equal(row.evidence.row.raw.contract, 'FETCH_CHECKPOINT_EVIDENCE_V1');
    assert.equal(row.parsed.network_requests, 0);
    assert.equal(row.durable_readback_verified, false);
    assert.equal(row.evidence.row.snapshot_version, undefined);
    assert.equal(row.evidence.row.id, undefined);
  }
});

test('source-shaped counterfactual independently audits market while five company claims stay private and blocked', async () => {
  const { input, ai, market, privateDocument, gate } = await marketCounterfactual();
  assert.equal(ai.canonical_market_state.status, 'READY', JSON.stringify(ai.canonical_market_state.reason_codes));
  assert.equal(gate.eligible, true, JSON.stringify(gate));
  assert.equal(gate.decision_mode, 'market_only');
  assert.equal(gate.recommendation_gate.status, 'BLOCKED');
  assert.equal(gate.recommendation_gate.universe_evaluation_complete, false);
  assert.notEqual(gate.recommendation_status, 'NO_QUALIFIED_OPPORTUNITY');
  assert.equal(privateDocument.sections.representative_stocks.length, 5);
  assert.ok(privateDocument.quality.unsupported_claims.length >= 5);
  assert.equal(market.sections.representative_stocks.length, 0);
  assert.ok(market.quality.coverage_audit.claims.every(claim => claim.scope === 'market' && claim.supported));
  const privateBefore = JSON.stringify(privateDocument);
  const projected = canonicalReportProjection(ai, { decision_mode: gate.decision_mode, action: 'WAIT',
    generated_text: { market_report_gate: gate, daily_sentence: market.sections.core_thesis.statement, recommendations: [] } });
  assert.deepEqual(projected.today_beneficiary_stocks_v10, []);
  assert.equal(JSON.stringify(projected.stock_research.document), privateBefore);
  // A producer READY decision without a committed SQL receipt is UNPUBLISHED.
  const state = createSubscriberState({ report_date: input.reportDate, revision_id: null,
    generated_at: input.generatedAt, publicationVerified: false, marketEvidenceReady: gate.eligible,
    analysisStatus: gate.report_status, isTradingDay: true, confidenceValue: 100,
    recommendationGate: gate.recommendation_gate, closing: null, now: input.generatedAt });
  assert.equal(state.publication, 'UNPUBLISHED');
  assert.equal(state.confidence.status, 'UNAVAILABLE');
  assert.equal(state.closing, 'NOT_DUE');
  const subscriber = getSubscriberReportProjection({ ...projected, report_date: input.reportDate,
    revision_id: null, generated_at: input.generatedAt, subscriber_state: state });
  assert.equal(subscriber.analysisAvailable, false);
});

test('malformed provider numbers are rejected rather than coerced to market evidence', async () => {
  for (const value of [null, '', ' ', 'NaN', -1, 0]) {
    const input = fixture(); input.quotes[0].response.c = value;
    const replay = await replayCheckpointConstruction(input);
    assert.equal(replay.observations[0].evidence.valid, false, String(value));
  }
  for (const patch of [{ price: null }, { change: null }, { changePercent: '' }]) {
    const entry = fixture().quotes[2]; Object.assign(entry.response, patch);
    assert.equal((await replayProviderQuote(entry)).quote, null);
  }
});

test('stale or future raw market source time blocks the independently assembled market', async () => {
  for (const t of [0, Date.parse('2026-07-01T20:00:00Z') / 1000, Date.parse('2026-07-14T20:00:00Z') / 1000]) {
    const result = await marketCounterfactual(input => { input.quotes[0].response.t = t; });
    // Existing premarket Fetch preserves provider-returned overnight timestamps;
    // the actual premium evidence normalizer rejects stale research input later.
    if (t === 0 || t > Date.parse(result.input.generatedAt) / 1000) {
      assert.equal(result.replay.observations[0].evidence.valid, false);
    } else {
      assert.equal(result.replay.observations[0].evidence.valid, true);
      assert.equal(result.input.evidenceIndex[0].freshness, 'stale');
    }
    assert.equal(result.gate.eligible, false, JSON.stringify(result.gate));
  }
});

test('real checkpoint windows distinguish premarket, six phases and recovery without overriding a clock', () => {
  const base = fixture().collection;
  assert.equal(checkpointCollectionContract(base).valid, true);
  for (const [checkpoint, phase, time] of [['0900', 'intraday', '09:00'], ['0930', 'intraday', '09:30'],
    ['1030', 'intraday', '10:30'], ['1300', 'intraday', '13:00'], ['1410', 'close', '14:10'], ['1430', 'close', '14:30']]) {
    const input = { ...base, checkpoint, phase, observedAt: `2026-07-14T${time}:00+08:00` };
    assert.equal(checkpointCollectionContract(input).valid, true, checkpoint);
    assert.equal(checkpointCollectionContract({ ...input, observedAt: '2026-07-14T16:00:00+08:00' }).valid, false);
  }
  assert.equal(checkpointCollectionContract({ ...base, observedAt: '2026-07-14T08:00:00+08:00' }).valid, false);
  assert.equal(checkpointCollectionContract({ ...base, phase: 'manual_backfill', checkpoint: 'manual' }).checkpoint, 'RECOVERY');
});

test('a 09:00 Taiwan quote cannot fill the 09:30 checkpoint even when received at 09:30', async () => {
  const input = fixture();
  const entry = input.quotes[2]; entry.response.lastUpdated = '2026-07-14T09:00:00+08:00';
  const { quote } = await replayProviderQuote(entry);
  const result = buildCheckpointEvidence({ ...input.collection, phase: 'intraday', checkpoint: '0930',
    observedAt: '2026-07-14T09:30:00+08:00' }, quote, entry.config);
  assert.equal(result.valid, false);
});

test('provider counterfactual cannot replace the original 9/9 76/5 capture or imply whole-day success', () => {
  const { fixtures } = loadConsolidationFixtures();
  const historical = fixtures.get('2026-09-09-premarket-quality');
  assert.equal(historical.observed.research_quality.evidence_coverage, 76);
  assert.equal(historical.observed.research_quality.unsupported_claims.length, 5);
  assert.equal(historical.observed.premarket_business_gate, 'FAIL');
  assert.equal(historical.observed.full_day_acceptance, 'NOT_DUE');
  assert.notEqual(fixture().collection.tradingDate, historical.market_date.report_date);
  for (const boundary of ['IMMUTABLE_DB_READBACK', 'SQL_PUBLICATION', 'AUTH_RLS', 'LINE_OUTBOX', 'CLOSING', 'LEARNING', 'ACCEPTANCE']) {
    assert.ok(fixture().unexecuted_boundaries.includes(boundary));
  }
});
