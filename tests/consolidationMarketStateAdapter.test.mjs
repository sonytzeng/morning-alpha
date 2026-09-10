import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildMarketState, getTodayOnlyMarketData, getMarketDataFreshnessLabel, isMarketDataToday } from '../src/services/marketStateEngine.ts';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportContract.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';

// Exercise the actual shared projection with synthetic subscriber-read shapes.
// These fixtures are not market evidence, DB publication receipts or E2E proof.
const today = '2026-09-09';
const now = new Date(`${today}T16:00:00+08:00`);
const rowFor = ai => ({ report_date: ai.report_date, revision_id: ai.revision_id,
  generated_at: ai.generated_at, today_date: today, ai_strategy_json: ai });
const projectionFor = row => getSubscriberReportProjection(row, { todayDate: today });
const legacyNoise = {
  todayOpeningRadar: { report_date: today, radar_status: 'CONFIRMED', confidence_score: 100,
    taiex_change: 9, txf_change: 9, tsmc_change: 9 },
  todayCloseVerification: { report_date: today, status: 'completed', data_quality: 'complete',
    verification_result: '命中', actual_market_result: '明顯上漲', taiex_change: 9 },
  sectorRotationFreshness: { isStale: false },
};
const adapt = (row, overrides = {}) => buildMarketState({ todayReport: row, nowTaipei: now, ...legacyNoise, ...overrides });

for (const scenario of ['READY', 'PARTIAL', 'BLOCKED', 'FAILED', 'INVALIDATED', 'NOT_DUE',
  'MARKET_READY_RECOMMENDATION_BLOCKED', 'MISSING_CONFIDENCE', 'CLOSING_COMPLETE', 'RUNTIME_INVALIDATED']) {
  test(`legacy adapter consumes the actual projection without raw-state overrides: ${scenario}`, () => {
    const row = rowFor(subscriberProjectionFixture(scenario)), projection = projectionFor(row);
    const state = adapt(row);
    assert.equal(state.confidenceScore, projection.confidence.value);
    assert.equal(state.confidenceLabel, projection.confidence.label);
    assert.equal(state.displayLabel, projection.marketDecision.label);
    assert.equal(state.displayVerdict, projection.marketDecision.summary || projection.statusLabel);
    assert.equal(state.marketPhase === 'after_close_verified', projection.closing.complete);
    assert.equal(state.reportAvailability.hasTodayCloseVerification, projection.closing.complete);
    assert.equal(state.timelineItems[0].confidence, projection.confidence.value);
    assert.ok(state.topThreeFocus.every(item => item.score === undefined), 'no fabricated focus scores');
    for (const [key, checkpoint] of Object.entries(projection.runtime.checkpoints)) {
      assert.equal(state.timelineItems.find(item => item.time === `${key.slice(0, 2)}:${key.slice(2)}`).status,
        checkpoint.status, 'checkpoint labels/presence cannot replace verified projection state');
    }
    if (!projection.analysisAvailable) {
      assert.equal(state.confidenceScore, null);
      assert.equal(state.reportAvailability.shouldShowTodayReportContent, false);
      assert.equal(state.timelineItems.some(item => item.status === 'completed'), false);
      assert.doesNotMatch(JSON.stringify(state), /100\s*\/\s*100|已完成|完整回顧|已更新/);
    }
    if (scenario === 'PARTIAL') assert.equal(state.dataQuality, 'partial');
  });
}

test('elapsed browser time, fresh quotes and detached close/radar cannot complete an unexecuted checkpoint', () => {
  const row = rowFor(subscriberProjectionFixture('NOT_DUE'));
  const early = adapt(row, { nowTaipei: new Date(`${today}T07:00:00+08:00`) });
  const late = adapt(row, { nowTaipei: new Date(`${today}T23:59:00+08:00`) });
  assert.deepEqual(late, early);
  assert.equal(late.marketPhase, 'pre_market');
  assert.equal(late.sourceFreshness.radarFresh, false);
  assert.equal(late.sourceFreshness.closeVerificationFresh, false);
  const freshQuotes = ['TAIEX', 'TXF', '2330'].map(symbol => ({ symbol,
    captured_at: `${today}T15:00:00+08:00`, change_percent: 9, value: 999 }));
  const withQuotes = adapt(row, { todayMarketData: freshQuotes });
  assert.equal(withQuotes.sourceFreshness.taiexFresh, true);
  assert.equal(withQuotes.marketPhase, early.marketPhase);
  assert.equal(withQuotes.displayVerdict, early.displayVerdict);
  assert.deepEqual(withQuotes.timelineItems, early.timelineItems);
  assert.equal(withQuotes.confidenceScore, early.confidenceScore);
});

test('missing report plus apparently complete raw data stays unavailable with null confidence', () => {
  const state = adapt(null);
  assert.equal(state.confidenceScore, null);
  assert.equal(state.reportAvailability.hasTodayReport, false);
  assert.equal(state.reportAvailability.hasTodayCloseVerification, false);
  assert.equal(state.timelineItems.some(item => item.status === 'completed'), false);
});

for (const [label, change] of [
  ['revision', row => { row.revision_id = 'other-synthetic-revision'; }],
  ['date', row => { row.report_date = '2026-09-08'; }],
  ['generation time', row => { row.generated_at = `${today}T07:31:00+08:00`; }],
  ['outer invalid version', row => { row.subscriber_state = { ...row.ai_strategy_json.subscriber_state, schema_version: 'unknown' }; }],
]) {
  test(`full-envelope ${label} mismatch never falls back to nested READY or COMPLETE`, () => {
    const row = rowFor(subscriberProjectionFixture('CLOSING_COMPLETE')); change(row);
    const projection = projectionFor(row), state = adapt(row);
    assert.equal(projection.analysisAvailable, false);
    assert.equal(state.confidenceScore, null);
    assert.equal(state.reportAvailability.shouldShowTodayReportContent, false);
    assert.equal(state.reportAvailability.hasTodayCloseVerification, false);
    assert.equal(state.marketPhase === 'after_close_verified', false);
    assert.equal(state.timelineItems.some(item => item.status === 'completed'), false);
  });
}

test('explicit projection remains authoritative when a caller also supplies a contradictory raw row', () => {
  const projection = projectionFor(rowFor(subscriberProjectionFixture('PARTIAL')));
  const state = adapt(rowFor(subscriberProjectionFixture('CLOSING_COMPLETE')), { projection });
  assert.equal(state.confidenceScore, null);
  assert.equal(state.dataQuality, 'partial');
  assert.equal(state.displayLabel, projection.marketDecision.label);
  assert.equal(state.marketPhase === 'after_close_verified', false);
});

test('only a revision-bound executed checkpoint can select intraday; wrong revision cannot', () => {
  const row = rowFor(subscriberProjectionFixture('READY')), ai = row.ai_strategy_json;
  ai.intraday_sync_status.windows['0930'] = { status: 'COMPLETED', report_date: today,
    revision_id: ai.revision_id, completed_at: `${today}T09:31:00+08:00`, evidence: { synthetic: true } };
  assert.equal(adapt(row).marketPhase, 'intraday');
  assert.equal(adapt(row).sourceFreshness.radarFresh, true);
  ai.intraday_sync_status.windows['0930'].revision_id = 'other-synthetic-revision';
  assert.equal(adapt(row).marketPhase, 'pre_market');
  assert.equal(adapt(row).sourceFreshness.radarFresh, false);
});

test('stale prior report is never described as today or used to replace the canonical current date', () => {
  const row = rowFor(subscriberProjectionFixture('STALE')), state = adapt(row);
  assert.equal(state.todayDate, today);
  assert.equal(state.blockedStaleData, true);
  assert.equal(state.sourceFreshness.reportFresh, false);
  assert.equal(state.reportAvailability.shouldShowTodayReportContent, false);
  assert.match(state.heroTitle, /歷史|非今日/);
  assert.doesNotMatch(state.heroTitle, /今日.*已更新|完整回顧/);
  const atTaipeiMidnight = adapt(rowFor(subscriberProjectionFixture('READY')), {
    nowTaipei: new Date('2026-09-09T16:01:00Z'),
  });
  assert.equal(atTaipeiMidnight.todayDate, '2026-09-10');
  assert.equal(atTaipeiMidnight.blockedStaleData, true);
});

test('market ready with recommendation blocked remains available without invented recommendation or score', () => {
  const row = rowFor(subscriberProjectionFixture('MARKET_READY_RECOMMENDATION_BLOCKED'));
  row.ai_strategy_json.premium_content_status = 'blocked';
  row.ai_strategy_json.research_generation_audit = { quality: { evidence_coverage: 76, unsupported_claims: 5 } };
  const state = adapt(row);
  assert.equal(state.dataQuality, 'complete');
  assert.equal(state.reportAvailability.shouldShowTodayReportContent, true);
  assert.equal(state.confidenceScore, 73);
  assert.match(state.topThreeFocus.at(-1).description, /推薦評估證據不足/);
  assert.ok(state.topThreeFocus.every(item => item.score === undefined));
});

test('real zero confidence is preserved, and unknown confidence is never capped or replaced', () => {
  const row = rowFor(subscriberProjectionFixture('READY'));
  row.ai_strategy_json.subscriber_state.confidence.value = 0;
  assert.equal(adapt(row).confidenceScore, 0);
  row.ai_strategy_json.subscriber_state.confidence.value = 99;
  assert.equal(adapt(row).confidenceScore, 99);
  row.ai_strategy_json.subscriber_state.confidence = { status: 'UNAVAILABLE', value: null };
  assert.equal(adapt(row).confidenceScore, null);
});

test('non-trading projection never converts historical close presence to a completed current day', () => {
  const row = rowFor(subscriberProjectionFixture('CLOSING_COMPLETE'));
  row.ai_strategy_json.is_trading_day = false;
  row.ai_strategy_json.subscriber_state.closing = 'NOT_APPLICABLE';
  const state = adapt(row);
  assert.equal(state.marketPhase, 'pre_market');
  assert.equal(state.reportAvailability.hasTodayCloseVerification, false);
  assert.ok(state.timelineItems.slice(1).every(item => item.status === 'not_applicable'));
});

test('pure quote-freshness exports keep their caller contract and do not mutate or invent records', () => {
  const rows = [
    { symbol: 'TAIEX', captured_at: `${today}T15:00:00+08:00` },
    { symbol: 'TAIEX', captured_at: `${today}T09:00:00+08:00` },
    { symbol: 'TXF', captured_at: '2026-09-08T23:00:00+08:00' },
    { symbol: '2330', captured_at: '2026-09-08T16:01:00Z' },
  ];
  const before = structuredClone(rows);
  assert.equal(isMarketDataToday(rows[3], today), true, 'Taipei date, not UTC date');
  assert.equal(isMarketDataToday({ captured_at: 'not-a-date' }, today), false);
  assert.deepEqual(getTodayOnlyMarketData(rows, today), [rows[0], rows[3]]);
  assert.deepEqual(getTodayOnlyMarketData(null, today), []);
  assert.deepEqual(rows, before);
  assert.equal(getMarketDataFreshnessLabel('TAIEX', rows, today).isFresh, true);
  assert.equal(getMarketDataFreshnessLabel('TXF', rows, today).isFresh, false);
  assert.deepEqual(getMarketDataFreshnessLabel('MISSING', rows, today), { isFresh: false, label: 'MISSING 暫缺', staleDate: null });
});

test('runtime graph has no raw state interpreters or dead active page MarketState calculations', () => {
  const path = 'src/services/marketStateEngine.ts';
  const code = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const forbidden = new Set(['confidence_score', 'taiex_change', 'actual_market_result', 'verification_result',
    'closing_verification', 'closing_verification_v2', 'canonical_decision', 'subscriber_state', 'radar_status']);
  let projectionCalls = 0;
  const visit = node => {
    if (ts.isPropertyAccessExpression(node)) assert.equal(forbidden.has(node.name.text), false, node.getText(source));
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      assert.equal(forbidden.has(node.argumentExpression.text), false, node.getText(source));
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'getSubscriberReportProjection') projectionCalls++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(projectionCalls, 1);
  for (const legacy of ['classifyCloseResult', 'generateCloseVerificationConclusion', 'getTaipeiHour', 'getTaipeiMinute', 'isAfterMarketClose']) {
    assert.equal(code.includes(legacy), false, `${legacy} no longer a duplicate state interpreter`);
  }
  for (const route of ['home/page.tsx', 'war-room/WarRoom.tsx']) {
    const content = readFileSync(new URL(`../src/pages/${route}`, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /buildMarketState|marketState=\{/);
  }
});
