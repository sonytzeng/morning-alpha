// Actual assembler, Editorial scorer and publication authority, in memory only.
// Synthetic persisted-row shapes are not a database publication or full-chain PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketContentIntelligence } from '../supabase/functions/_shared/content-intelligence.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePublishedMarketDelivery } from '../supabase/functions/_shared/market-publication-contract.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fixture = isolatedFunction(read('tests/consolidationPublicationConsumers.test.mjs'), 'fixture', {
  read, isolatedFunction, structuredClone, assembleCanonicalMarketResearch, buildCanonicalMarketState,
  canonicalMarketSourceRefs, evaluateMarketReportGate, assert,
});
const NOW = '2026-09-09T04:00:00.000Z';
const evaluate = f => evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member,
  evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date),
  { publicationRun: f.publicationRun, now: NOW, todayDate: f.report.report_date, premiumEligible: false });
const editorial = f => evaluateMarketContentIntelligence(f.snapshot.generated_text, 0);
const assertBlocked = (f, reason) => {
  const result = evaluate(f);
  assert.equal(result.eligible, false, JSON.stringify(result));
  assert.equal(result.projection.analysisAvailable, false);
  assert.deepEqual(result.projection.recommendation.items, []);
  assert.ok(result.reason_codes.includes(reason), JSON.stringify(result.reason_codes));
};

test('frozen real Editorial and durable publication remain available with recommendation QA blocked', () => {
  const f = fixture(), measured = editorial(f), before = JSON.stringify(f);
  assert.equal(measured.publishable, true);
  assert.equal(f.snapshot.content_score, measured.score);
  const result = evaluate(f);
  assert.equal(result.eligible, true, JSON.stringify(result.reason_codes));
  assert.equal(result.projection.analysisAvailable, true);
  assert.deepEqual(result.projection.recommendation.items, []);
  assert.equal(JSON.stringify(f), before, 'Read-only evaluation must not rewrite the frozen evidence');
});

for (const [name, mutate] of [
  ['raw copy aliases', ai => { ai.today_quote = '等待資料確認。'; ai.daily_sentence = '注意風險。'; ai.free_summary = {}; ai.v8_daily_sentence = {}; }],
  ['private member prose and score', ai => { ai.member_research_note_v2 = {}; ai.member_value_score = 0; ai.content_score = 0; }],
  ['current market document invalid', ai => { ai.canonical_market_state = { status: 'PARTIAL', document: {} }; ai.research_master_v2 = {}; }],
  ['current evidence metadata absent', ai => { delete ai.content_evidence_quality; delete ai.data_quality; delete ai.missing_sources; }],
  ['current source quality failed', ai => { ai.content_evidence_quality = { verified_market_count: 0 }; ai.data_quality = 'failed'; ai.missing_sources = ['private_stock']; }],
  ['current stock research failed', ai => { ai.stock_research = { status: 'BLOCKED', document: {} }; ai.today_beneficiary_stocks_v10 = []; ai.research_generation_audit = { status: 'failed' }; }],
]) test(`committed market projection is invariant to ${name}`, () => {
  const f = fixture(), baseline = evaluate(f), frozen = JSON.stringify(f.snapshot);
  mutate(f.report.ai_strategy_json);
  const actual = evaluate(f);
  assert.equal(actual.eligible, true, JSON.stringify(actual.reason_codes));
  assert.deepEqual(actual.projection.marketDecision, baseline.projection.marketDecision);
  assert.deepEqual(actual.marketContent, baseline.marketContent);
  assert.equal(JSON.stringify(f.snapshot), frozen);
  assert.deepEqual(actual.projection.recommendation.items, []);
});

test('actual assembler thin frozen sentence scores below threshold despite intact Research 100 and stored Editorial 100', () => {
  const f = fixture();
  const input = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture')();
  const thin = 'SOX 與半導體指數上漲 1%，台積電與 TAIEX 反映隔夜市場的方向背景。';
  input.legacy.member_research_note_v2.today_core_thesis = thin;
  input.legacy.today_quote = thin;
  input.legacy.v8_daily_sentence = { sentence: thin };
  input.legacy.free_summary = { one_sentence: thin };
  const state = buildCanonicalMarketState(assembleCanonicalMarketResearch(input));
  assert.equal(state.status, 'READY');
  assert.equal(state.document.quality.evidence_coverage, 100);
  f.snapshot.generated_text.canonical_market_state = state;
  f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
  // This is the deliberately wrong old receipt, not a fixture quality override.
  assert.equal(f.snapshot.content_score, 100);
  assert.equal(editorial(f).score, 70);
  assert.equal(editorial(f).publishable, false);
  assertBlocked(f, 'FROZEN_MARKET_EDITORIAL_UNVERIFIED');
  assert.ok(evaluate(f).reason_codes.includes('FROZEN_MARKET_EDITORIAL_SCORE_MISMATCH'));
  assert.equal(evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date).eligible, true,
    'A healthy current report must not repair the deficient frozen publication');
});

for (const [name, mutate] of [
  ['missing measurements', generated => { delete generated.content_evidence_quality; }],
  ['missing measured contract', generated => { delete generated.content_evidence_quality.contract_version; }],
  ['missing market count', generated => { delete generated.content_evidence_quality.verified_market_count; }],
  ['string market count', generated => { generated.content_evidence_quality.verified_market_count = '3'; }],
  ['missing news count', generated => { delete generated.content_evidence_quality.verified_news_count; }],
  ['negative news count', generated => { generated.content_evidence_quality.verified_news_count = -1; }],
  ['missing blank count', generated => { delete generated.content_evidence_quality.blank_market_change_count; }],
  ['blank market change', generated => { generated.content_evidence_quality.blank_market_change_count = 1; }],
  ['missing traceability', generated => { delete generated.content_evidence_quality.all_news_traceable; }],
  ['untraceable news', generated => { generated.content_evidence_quality.all_news_traceable = false; }],
  ['missing source quality', generated => { delete generated.data_quality; }],
  ['incomplete source quality', generated => { generated.data_quality = 'partial'; }],
  ['missing source gaps', generated => { delete generated.missing_sources; }],
  ['malformed source gaps', generated => { generated.missing_sources = [null]; }],
  ['unresolved source gaps', generated => { generated.missing_sources = ['required_tw_market']; }],
]) test(`frozen ${name} fails closed even when current measurements remain complete`, () => {
  const f = fixture(); mutate(f.snapshot.generated_text);
  assert.equal(evaluateMarketContentIntelligence(f.report.ai_strategy_json, 0).publishable, true);
  assertBlocked(f, 'FROZEN_MARKET_EDITORIAL_UNVERIFIED');
});

test('qualifying frozen Editorial still requires exact stored score parity', () => {
  const f = fixture(); f.snapshot.content_score = editorial(f).score - 1;
  assert.equal(editorial(f).publishable, true);
  assertBlocked(f, 'FROZEN_MARKET_EDITORIAL_SCORE_MISMATCH');
});

for (const [name, mutate, reason] of [
  ['missing durable run', f => { f.publicationRun = null; }, 'MARKET_PUBLICATION_DURABLE_RECEIPT_MISSING'],
  ['wrong receipt revision', f => { f.publicationRun.provider_status.result.decision_snapshot_id = 'wrong'; }, 'MARKET_PUBLICATION_DURABLE_RECEIPT_MISSING'],
  ['wrong receipt date', f => { f.publicationRun.trading_date = '2026-09-08'; }, 'MARKET_PUBLICATION_DURABLE_RECEIPT_MISSING'],
  ['wrong original member', f => { f.member.decision_snapshot_id = 'wrong'; }, 'PUBLISHED_MARKET_RECEIPT_NOT_ELIGIBLE'],
  ['missing opening pointer', f => { delete f.report.ai_strategy_json.market_publication_contract.opening_publication_revision_id; }, 'MARKET_PUBLICATION_CONTRACT_INVALID'],
  ['missing frozen source refs', f => { f.snapshot.source_refs = []; }, 'FROZEN_MARKET_DOCUMENT_UNVERIFIED'],
  ['malformed frozen CMS', f => { f.snapshot.generated_text.canonical_market_state = { status: 'READY', document: {} }; }, 'FROZEN_MARKET_DOCUMENT_UNVERIFIED'],
]) test(`qualified Editorial cannot waive ${name}`, () => {
  const f = fixture(); mutate(f); assertBlocked(f, reason);
});
