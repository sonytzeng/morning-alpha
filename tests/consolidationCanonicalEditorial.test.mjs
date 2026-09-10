// Actual market assembler and editorial evaluator, in-memory only.
// No provider, SQL, persisted publication, Auth or Production execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketContentIntelligence, evaluateContentIntelligence } from '../supabase/functions/_shared/content-intelligence.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';

const decisionSentence = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
const thinSentence = 'SOX 與半導體指數上漲 1%，台積電與 TAIEX 反映隔夜市場的方向背景。';
const completeFixture = isolatedFunction(readFileSync(new URL('../supabase/functions/generate-daily-report-v7/research-master-v2.test.ts', import.meta.url), 'utf8'), 'completeFixture');

function fixture(sentence = decisionSentence) {
  const input = completeFixture(), ai = input.legacy;
  Object.assign(ai, {
    today_quote: sentence, daily_sentence: sentence, v8_daily_sentence: { sentence },
    free_summary: { one_sentence: sentence }, market_thesis: { reasons: [] }, preferred_sectors: [],
    today_beneficiary_stocks: [], today_beneficiary_stocks_v10: [], v10_beneficiary_enabled: true,
    v10_data_quality_status: 'insufficient_positive_evidence', data_quality: 'complete', missing_sources: [],
    content_evidence_quality: { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 3,
      verified_news_count: 1, blank_market_change_count: 0, all_news_traceable: true },
  });
  ai.member_research_note_v2.today_core_thesis = sentence;
  ai.canonical_market_state = buildCanonicalMarketState(assembleCanonicalMarketResearch(input));
  ai.research_master_v2 = ai.canonical_market_state.document;
  assert.equal(ai.canonical_market_state.status, 'READY', JSON.stringify(ai.canonical_market_state.reason_codes));
  assert.equal(ai.research_master_v2.quality.evidence_coverage, 100);
  assert.deepEqual(ai.research_master_v2.sections.representative_stocks, []);
  return ai;
}
const evaluate = ai => evaluateMarketContentIntelligence(ai, 1);

test('actual audited market sentence remains editorial eligible with stock recommendations blocked', () => {
  const ai = fixture(), editorial = evaluate(ai), gate = evaluateMarketReportGate(ai, ai.research_master_v2.report_date);
  assert.ok(editorial.score >= 90, JSON.stringify(editorial));
  assert.equal(editorial.publishable, true);
  assert.equal(gate.eligible, true);
  assert.equal(gate.recommendation_gate.status, 'BLOCKED');
  assert.equal(editorial.breakdown.actionability, 15);
  assert.equal(editorial.breakdown.risk, 10);
});

for (const [name, tamper] of [
  ['today_quote', ai => { ai.today_quote = '等待資料確認，注意風險。'; }],
  ['daily_sentence and v8', ai => { delete ai.today_quote; ai.daily_sentence = '等待資料確認。'; ai.v8_daily_sentence = { sentence: '注意風險。' }; }],
  ['free summary', ai => { ai.free_summary = { one_sentence: '市場瞬息萬變，注意風險。', summary: '等待資料確認。' }; }],
  ['private member note', ai => { ai.member_research_note_v2 = { core_reasoning: '注意風險。', subscriber_value_sentence: '市場瞬息萬變。' }; }],
  ['reason aliases', ai => { ai.market_thesis = { reasons: Array(10).fill('raw reason') }; ai.key_drivers = Array(10).fill('raw'); ai.reasoning_chain = Array(10).fill('raw'); }],
  ['sector aliases', ai => { ai.preferred_sectors = Array(10).fill('raw sector'); ai.watch_sectors = Array(10).fill('raw'); ai.watch_sectors_detailed = Array(10).fill({ name: 'raw' }); }],
  ['Taiwan transmission alias', ai => { ai.taiwan_transmission = 'x'; }],
  ['private QA detail', ai => { ai.data_quality_detail = { missing_sources: ['private_company_research'], status: 'failed' }; ai.stock_research = { document: { quality: { evidence_coverage: 0 } } }; }],
  ['all raw prose removed', ai => { for (const key of ['today_quote', 'daily_sentence', 'v8_daily_sentence', 'free_summary', 'member_research_note_v2', 'market_thesis', 'key_drivers', 'reasoning_chain', 'preferred_sectors', 'watch_sectors', 'watch_sectors_detailed', 'taiwan_transmission']) delete ai[key]; }],
]) {
  test(`same canonical market document is invariant to ${name}`, () => {
    const ai = fixture(), expected = evaluate(ai), document = JSON.stringify(ai.canonical_market_state);
    tamper(ai);
    assert.equal(JSON.stringify(ai.canonical_market_state), document);
    assert.deepEqual(evaluate(ai), expected);
  });
}

test('audited coverage 100 cannot promote a thin canonical sentence or let raw strong prose repair it', () => {
  const ai = fixture(thinSentence), before = evaluate(ai);
  assert.ok(before.score < 90);
  assert.equal(before.publishable, false);
  assert.deepEqual(before.generic_flags, ['daily_sentence_action_missing', 'daily_sentence_checkpoint_missing', 'daily_sentence_change_condition_missing']);
  ai.today_quote = decisionSentence; ai.free_summary.one_sentence = decisionSentence;
  ai.v8_daily_sentence.sentence = decisionSentence; ai.daily_sentence = decisionSentence;
  assert.deepEqual(evaluate(ai), before);
  assert.equal(evaluateMarketReportGate(ai, ai.research_master_v2.report_date).eligible, false);
});

test('changing canonical prose changes editorial quality while every raw prose alias stays fixed', () => {
  const strong = fixture(), thin = fixture(thinSentence);
  for (const key of ['today_quote', 'daily_sentence', 'v8_daily_sentence', 'free_summary', 'member_research_note_v2']) thin[key] = structuredClone(strong[key]);
  assert.equal(evaluate(strong).publishable, true);
  assert.equal(evaluate(thin).publishable, false);
  assert.ok(evaluate(thin).score < evaluate(strong).score);
});

test('missing canonical executive sentence has no raw or core-thesis fallback', () => {
  const ai = fixture(); ai.canonical_market_state.document.sections.executive_summary.text = '';
  assert.equal(evaluate(ai).publishable, false);
  assert.ok(evaluate(ai).generic_flags.includes('daily_sentence_too_thin'));
});

test('present malformed canonical state cannot fall through to a healthy compatibility master', () => {
  const ai = fixture(); ai.canonical_market_state = { status: 'READY', document: {} };
  assert.equal(evaluate(ai).publishable, false);
  assert.equal(evaluateMarketReportGate(ai).eligible, false);
});

test('legacy canonical document remains compatible but legacy prose cannot override it', () => {
  const ai = fixture(); delete ai.canonical_market_state;
  const before = evaluate(ai); ai.today_quote = '等待資料確認，注意風險。'; ai.free_summary.one_sentence = '市場瞬息萬變。';
  assert.equal(before.publishable, true);
  assert.deepEqual(evaluate(ai), before);
});

test('independent recommendation editorial evaluator retains its existing prose gate', () => {
  const ai = fixture(), before = evaluateContentIntelligence(ai, 1);
  ai.today_quote = '等待資料確認，注意風險。';
  const after = evaluateContentIntelligence(ai, 1);
  assert.notDeepEqual(after, before);
  assert.ok(after.generic_flags.includes('generic_watch_risk'));
});

for (const [name, mutate] of [
  ['measurement object absent', ai => { delete ai.content_evidence_quality; }],
  ['measurement contract absent', ai => { delete ai.content_evidence_quality.contract_version; }],
  ['market count absent', ai => { delete ai.content_evidence_quality.verified_market_count; }],
  ['market count zero', ai => { ai.content_evidence_quality.verified_market_count = 0; }],
  ['market count string', ai => { ai.content_evidence_quality.verified_market_count = '3'; }],
  ['market count fractional', ai => { ai.content_evidence_quality.verified_market_count = 3.5; }],
  ['news count absent', ai => { delete ai.content_evidence_quality.verified_news_count; }],
  ['news count negative', ai => { ai.content_evidence_quality.verified_news_count = -1; }],
  ['news count string', ai => { ai.content_evidence_quality.verified_news_count = '1'; }],
  ['blank count absent', ai => { delete ai.content_evidence_quality.blank_market_change_count; }],
  ['blank count string', ai => { ai.content_evidence_quality.blank_market_change_count = '0'; }],
  ['blank change present', ai => { ai.content_evidence_quality.blank_market_change_count = 1; }],
  ['traceability absent', ai => { delete ai.content_evidence_quality.all_news_traceable; }],
  ['traceability false with news', ai => { ai.content_evidence_quality.all_news_traceable = false; }],
  ['traceability non-boolean', ai => { ai.content_evidence_quality.all_news_traceable = 'true'; }],
  ['source quality absent', ai => { delete ai.data_quality; ai.data_quality_detail = { status: 'complete', missing_sources: [] }; }],
  ['source gaps absent', ai => { delete ai.missing_sources; ai.data_quality_detail = { missing_sources: [] }; }],
  ['source gaps malformed', ai => { ai.missing_sources = [null]; }],
  ['source gaps unresolved', ai => { ai.missing_sources = ['required_tw_market']; }],
]) {
  test(`frozen market measurements fail closed: ${name}`, () => {
    const ai = fixture(); mutate(ai);
    assert.equal(evaluate(ai).publishable, false, JSON.stringify(evaluate(ai)));
  });
}

test('real zero news is allowed only with complete explicit market measurements', () => {
  const ai = fixture(); ai.content_evidence_quality.verified_news_count = 0;
  assert.equal(evaluate(ai).publishable, true);
  delete ai.content_evidence_quality.all_news_traceable;
  assert.equal(evaluate(ai).publishable, false);
});
