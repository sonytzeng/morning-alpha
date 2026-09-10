import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportContract.ts';
import { resolvePremiumContentAvailability } from '../src/lib/premiumContentAvailability.ts';
import { getSubscriberOpportunityList } from '../src/lib/subscriberOpportunities.ts';
import { selectPublicPerformanceRows } from '../src/lib/performanceJournalProjection.ts';
import { canShowBeginnerRecommendations } from '../src/features/learning/beginnerReportContract.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';

// Synthetic read contracts exercise real production projection/formatters.
// They are not publisher, entitlement, durable DB or full-E2E verification.
const rowFor = ai => ({ report_date: ai.report_date, revision_id: ai.revision_id,
  generated_at: ai.generated_at, today_date: ai.report_date, ai_strategy_json: ai });
const fixture = name => rowFor(subscriberProjectionFixture(name));

for (const scenario of ['READY', 'PARTIAL', 'BLOCKED', 'FAILED', 'INVALIDATED', 'MARKET_READY_RECOMMENDATION_BLOCKED']) {
  test(`Premium compatibility cannot re-evaluate publication: ${scenario}`, () => {
    const row = fixture(scenario);
    row.ai_strategy_json.premium_content_status = 'eligible';
    row.ai_strategy_json.premium_decision_mode = 'recommendations';
    row.ai_strategy_json.member_value_score = 100;
    row.ai_strategy_json.fresh_news_count = 100;
    const projection = getSubscriberReportProjection(row), availability = resolvePremiumContentAvailability(row);
    assert.equal(availability.marketContentAvailable, projection.analysisAvailable);
    assert.equal(availability.eligible, projection.analysisAvailable);
    assert.equal(availability.decisionMode, projection.recommendation.available ? 'recommendations' : 'blocked');
    assert.equal(getSubscriberOpportunityList(row).length > 0, projection.recommendation.available);
  });
}

for (const status of [undefined, '', 'unknown', 'degraded', 'blocked']) {
  test(`published/qualified market does not promote independent Premium ${String(status)}`, () => {
    const row = fixture('READY');
    Object.assign(row.ai_strategy_json, { premium_content_status: status,
      member_value_score: 100, fresh_news_count: 100, v10_data_quality_status: 'sufficient', data_quality: 'complete' });
    const projection = getSubscriberReportProjection(row), availability = resolvePremiumContentAvailability(row);
    assert.equal(projection.recommendation.available, true);
    assert.equal(availability.marketContentAvailable, true);
    assert.equal(availability.eligible, false);
    assert.deepEqual(getSubscriberOpportunityList(row), []);
    assert.equal(canShowBeginnerRecommendations({ action: 'ACT', premiumEligible: availability.eligible,
      decisionMode: availability.decisionMode, reportDate: row.report_date, todayDate: row.today_date,
      isHistoricalFallback: false }), false);
  });
}

test('stock-blocked published market narrative remains available without an invented no-trade conclusion', () => {
  const row = fixture('MARKET_READY_RECOMMENDATION_BLOCKED');
  Object.assign(row.ai_strategy_json, { premium_content_status: 'blocked', premium_decision_mode: 'no_trade',
    v10_data_quality_status: 'insufficient_positive_evidence', v10_observation_watchlist: [{}, {}, {}] });
  const availability = resolvePremiumContentAvailability(row);
  assert.equal(availability.marketContentAvailable, true);
  assert.equal(availability.eligible, false);
  assert.equal(availability.decisionMode, 'blocked');
  assert.deepEqual(getSubscriberOpportunityList(row), []);
  const member = readFileSync(new URL('../src/pages/member-note/page.tsx', import.meta.url), 'utf8');
  assert.ok(member.indexOf('研究摘要 · 30 秒決策') < member.indexOf('canViewMemberNoteFull && memberResearchPublishable'));
  assert.match(member, /memberResearchPublishable = premiumAvailability\.eligible/);
});

test('diagnostic scores preserve genuine zero/null and cannot block a qualified Premium row', () => {
  const row = fixture('READY');
  Object.assign(row.ai_strategy_json, { member_value_score: null, fresh_news_count: null, important_news: [] });
  assert.equal(resolvePremiumContentAvailability(row).memberValueScore, null);
  assert.equal(resolvePremiumContentAvailability(row).eligible, true);
  row.ai_strategy_json.member_value_score = 0;
  assert.equal(resolvePremiumContentAvailability(row).memberValueScore, 0);
  assert.equal(resolvePremiumContentAvailability(row).eligible, true);
});

test('qualified V10 positive control renders exact canonical items, ignoring legacy status and preview lists', () => {
  const row = fixture('READY');
  Object.assign(row.ai_strategy_json, { v10_beneficiary_enabled: true, v10_data_quality_status: 'QUALIFIED',
    today_beneficiary_stocks_v10: [{ symbol: '9999', name: 'unselected synthetic preview' }],
    v10_observation_watchlist: [{ symbol: '8888', name: 'unselected synthetic observation' }] });
  const opportunities = getSubscriberOpportunityList(row);
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].symbol, '2330');
  assert.ok(opportunities[0].oneLineReason && opportunities[0].confirmation && opportunities[0].invalidation);
  assert.doesNotMatch(JSON.stringify(opportunities), /9999|8888/);
});

for (const field of ['report_date', 'revision_id', 'generated_at']) {
  test(`premium and opportunities retain full-envelope ${field} contradictions`, () => {
    const row = fixture('READY');
    row[field] = field === 'report_date' ? '2026-09-08' : field === 'generated_at'
      ? '2026-09-09T07:31:00+08:00' : 'different-synthetic-revision';
    assert.equal(resolvePremiumContentAvailability(row).eligible, false);
    assert.deepEqual(getSubscriberOpportunityList(row), []);
  });
}

test('already-resolved historical/unavailable projection stays authoritative for compatibility callers', () => {
  const row = fixture('READY'), partial = getSubscriberReportProjection(fixture('PARTIAL'));
  assert.equal(resolvePremiumContentAvailability(row, partial).eligible, false);
  assert.deepEqual(getSubscriberOpportunityList(row, partial), []);
  const historical = getSubscriberReportProjection(row, { historical: true });
  assert.equal(resolvePremiumContentAvailability(row, historical).decisionMode, 'blocked');
  assert.deepEqual(getSubscriberOpportunityList(row, historical), []);
});

test('server-selected full performance row survives unchanged, including real close identity and confidence zero', () => {
  const row = fixture('CLOSING_COMPLETE');
  row.ai_strategy_json.subscriber_state.confidence.value = 0;
  const [selected] = selectPublicPerformanceRows([row]);
  assert.equal(selected.row, row);
  assert.equal(selected.issue, null);
  const projection = getSubscriberReportProjection(selected.row, { historical: true });
  assert.equal(projection.analysisAvailable, true);
  assert.equal(projection.closing.complete, true);
  assert.equal(projection.confidence.value, 0);
});

test('exact duplicate performance transport rows deduplicate, never choose a score/outcome/time winner', () => {
  const row = fixture('CLOSING_COMPLETE'), copy = structuredClone(row);
  assert.equal(selectPublicPerformanceRows([row, copy]).length, 1);
  assert.equal(selectPublicPerformanceRows([row, copy])[0].row, row);
  copy.updated_at = '2026-09-09T23:59:00+08:00';
  copy.confidence_score = 100;
  for (const rows of [[row, copy], [copy, row]]) {
    const [selection] = selectPublicPerformanceRows(rows);
    assert.equal(selection.row, null);
    assert.equal(selection.issue, 'CONFLICTING_PUBLIC_PERFORMANCE_ROWS');
    assert.equal(getSubscriberReportProjection(selection.row, { historical: true }).closing.complete, false);
  }
});

test('conflicting same-date identity blocks only that date; other real historical rows remain', () => {
  const row = fixture('CLOSING_COMPLETE'), conflict = fixture('READY');
  const historical = rowFor(subscriberProjectionFixture('CLOSING_COMPLETE', { todayDate: '2026-09-08' }));
  const selections = selectPublicPerformanceRows([row, conflict, historical]);
  assert.equal(selections[0].row, null);
  assert.equal(selections[1].row, historical);
  assert.equal(getSubscriberReportProjection(selections[1].row, { historical: true }).closing.complete, true);
});

test('legacy flat performance values cannot manufacture a publication identity or closing receipt', () => {
  const flat = { report_date: '2026-09-09', market_bias: '偏多', confidence_score: 100,
    verification_status: 'completed', verification_data_status: 'complete', hit_or_miss: 'hit',
    actual_taiex_close: 30000, updated_at: '2026-09-09T14:30:00+08:00' };
  const [selection] = selectPublicPerformanceRows([flat]);
  assert.equal(selection.row, flat);
  assert.equal(selection.row.ai_strategy_json, undefined);
  const projection = getSubscriberReportProjection(selection.row, { historical: true });
  assert.equal(projection.analysisAvailable, false);
  assert.equal(projection.confidence.value, null);
  assert.equal(projection.closing.complete, false);
});

test('Performance entry builder counts valid real projection outcomes but excludes flat/conflicting rows', () => {
  const source = readFileSync(new URL('../src/pages/performance/page.tsx', import.meta.url), 'utf8');
  const deps = { getSubscriberReportProjection, isFutureReportDate: () => false };
  for (const name of ['asRecord', 'text', 'firstText', 'publicPerformanceText', 'numberOrNull',
    'listFromUnknown', 'listFromAdjustment', 'normalizeOutcome', 'directionFromChange', 'buildEntry', 'calculateStats']) {
    deps[name] = isolatedFunction(source, name, deps);
  }
  const row = fixture('CLOSING_COMPLETE');
  const entry = deps.buildEntry(selectPublicPerformanceRows([row])[0]);
  assert.equal(entry.outcome, 'complete');
  assert.equal(entry.hasCompleteVerification, true);
  assert.equal(deps.calculateStats([entry]).validCount, 1);
  const conflict = deps.buildEntry({ reportDate: row.report_date, row: null, issue: 'CONFLICTING_PUBLIC_PERFORMANCE_ROWS' });
  assert.equal(conflict.outcome, 'insufficient');
  assert.equal(deps.calculateStats([conflict]).weightedSuccessRate, null);
});
