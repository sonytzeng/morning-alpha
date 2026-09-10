import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { getSubscriberReportProjection, subscriberObservationSources } from '../src/lib/subscriberReportContract.ts';
import { resolveMarketStatus } from '../src/utils/tradingDay.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';

// Pure formatting tests: real projection and calendar implementations, synthetic
// shapes. No Auth substitute, database writes or Production delivery assertions.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const displaySource = read('src/lib/morningAlphaDisplayState.ts');
const closeSource = read('src/services/closeMarketReviewService.ts');
const record = isolatedFunction(displaySource, 'record');
const rows = isolatedFunction(displaySource, 'rows', { record });
const displayFor = day => isolatedFunction(displaySource, 'getMorningAlphaDisplayState', {
  exports: {}, record, rows, getSubscriberReportProjection, subscriberObservationSources,
  resolveMarketStatus: requestedDay => resolveMarketStatus(requestedDay || day),
});
const closeHelpers = Object.fromEntries(['safeString', 'safeNumber', 'safeBoolean', 'safeObject']
  .map(name => [name, isolatedFunction(closeSource, name)]));
const closeReview = isolatedFunction(closeSource, 'mapClosingVerificationToCloseMarketReview', { exports: {}, ...closeHelpers });
const rowFor = ai => ({ report_date: ai.report_date, revision_id: ai.revision_id,
  generated_at: ai.generated_at, today_date: '2026-09-09', ai_strategy_json: ai });

for (const state of ['READY', 'PARTIAL', 'BLOCKED', 'FAILED', 'INVALIDATED', 'NOT_DUE',
  'MARKET_READY_RECOMMENDATION_BLOCKED', 'MISSING_CONFIDENCE', 'CLOSING_COMPLETE', 'RUNTIME_INVALIDATED']) {
  test(`display/closing formatters retain the canonical result: ${state}`, () => {
    const row = rowFor(subscriberProjectionFixture(state));
    row.confidence_score = 100; row.market_bias = 'RAW_CONFIRMED';
    const projection = getSubscriberReportProjection(row, { todayDate: '2026-09-09' });
    const display = displayFor('2026-09-09')(row, { market_bias: 'RAW_RADAR_CONFIRMED', confidence_score: 100 });
    assert.equal(display.reportDate, projection.identity.reportDate);
    assert.equal(display.confidenceScore, projection.confidence.value);
    assert.equal(display.marketBias, projection.marketDecision.bias || projection.marketDecision.label);
    assert.equal(display.todayQuote, projection.marketDecision.summary || projection.title);
    assert.deepEqual(JSON.parse(JSON.stringify(display.beneficiaryStocks)), projection.recommendation.items);
    const closing = closeReview(projection);
    assert.equal(Boolean(closing), projection.closing.complete);
    if (!projection.analysisAvailable) {
      assert.equal(display.memberResearchNote, null);
      assert.equal(display.openingRadar, null);
      assert.equal(display.confidenceScore, null);
      assert.equal(display.beneficiaryStocks.length, 0);
      assert.equal(closing, null);
    }
    if (closing) {
      assert.equal(closing.report_date, projection.identity.reportDate);
      assert.equal(closing.premarket_confidence, projection.confidence.value);
      assert.equal(closing.created_at, projection.closing.result.verified_at);
      assert.equal(closing.data_quality, 'verified');
    }
  });
}

for (const [name, mutate] of [
  ['wrong revision', row => { row.revision_id = 'other-synthetic-revision'; }],
  ['wrong business date', row => { row.report_date = '2026-09-08'; }],
  ['wrong generation', row => { row.generated_at = '2026-09-09T11:00:00+08:00'; }],
  ['missing close time', row => { delete row.ai_strategy_json.closing_verification_v2.verified_at; }],
  ['missing close evidence', row => { delete row.ai_strategy_json.closing_verification_v2.actual_txf_close; }],
]) {
  test(`closing cannot manufacture a verified review: ${name}`, () => {
    const row = rowFor(subscriberProjectionFixture('CLOSING_COMPLETE')); mutate(row);
    assert.equal(closeReview(getSubscriberReportProjection(row)), null);
  });
}

test('closing formatter consumes projected frozen opening metadata, never the newer published thesis', () => {
  const ai = subscriberProjectionFixture('CLOSING_COMPLETE');
  const opening = ai.revision_id, current = 'synthetic-published-after-close';
  ai.revision_id = current; ai.generated_at = '2026-09-09T15:00:00+08:00';
  ai.canonical_decision.id = current;
  ai.subscriber_state.revision_id = current; ai.subscriber_state.generated_at = ai.generated_at;
  ai.market_publication_contract = { schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED',
    report_date: ai.report_date, revision_id: current, opening_publication_revision_id: opening };
  ai.closing_verification_v2.opening_bias = 'synthetic-frozen-bearish';
  ai.closing_verification_v2.opening_confidence = 61;
  let projection = getSubscriberReportProjection(rowFor(ai));
  assert.equal(projection.marketDecision.bias, '偏多'); assert.equal(projection.confidence.value, 73);
  const closing = closeReview(projection);
  assert.equal(closing.premarket_bias, 'synthetic-frozen-bearish');
  assert.equal(closing.premarket_confidence, 61);
  assert.equal(closing.premarket_summary, null);
  delete ai.closing_verification_v2.opening_bias; delete ai.closing_verification_v2.opening_confidence;
  projection = getSubscriberReportProjection(rowFor(ai));
  assert.equal(projection.closing.complete, true, 'Missing optional opening display text is not missing close evidence');
  const unknown = closeReview(projection);
  assert.equal(unknown.premarket_bias, null); assert.equal(unknown.premarket_confidence, null);
  assert.equal(unknown.premarket_summary, null);
});

test('today calendar never relabels a historical report as today or applies an old holiday to a trading day', () => {
  const ai = subscriberProjectionFixture('READY');
  ai.is_trading_day = false; ai.market_status = 'closed';
  const row = rowFor(ai);
  for (const day of ['2026-09-10', '2026-09-12', '2026-10-09']) {
    row.today_date = day;
    const display = displayFor(day)(row);
    assert.equal(display.reportDate, ai.report_date);
    assert.equal(display.currentDate, day);
    assert.equal(display.isMarketClosed, !resolveMarketStatus(day).is_trading_day);
  }
});

test('server today_date survives client clock skew in both resolver and compatibility display', async () => {
  const ai = subscriberProjectionFixture('READY');
  const row = rowFor(ai);
  const projection = getSubscriberReportProjection(row);
  const resolverSource = read('src/lib/morningAlpha/resolveMorningAlphaState.ts');
  // Content-only dependencies are inert; identity, state and formatters below
  // execute the actual implementation. This is not a server/Auth E2E substitute.
  const resolved = { rawRow: row, report: { reportDate: ai.report_date, reportCreatedAt: ai.generated_at },
    subscriberProjection: projection, today_date: '2026-09-09', revision_id: ai.revision_id,
    tier: 'member', locked_sections: [], market_status: 'open', data_status: 'ready' };
  const resolve = isolatedFunction(resolverSource, 'resolveMorningAlphaState', {
    exports: {}, resolveActiveMorningAlphaReport: async () => resolved,
    formatTaipeiDate: () => { throw new Error('CLIENT_CLOCK_MUST_NOT_REPROJECT_SERVER_IDENTITY'); },
    getSubscriberReportProjection: () => { throw new Error('DUPLICATE_SUBSCRIBER_INTERPRETATION'); },
    formatTaipeiTimeString: isolatedFunction(resolverSource, 'formatTaipeiTimeString'),
    mapClosingVerificationToCloseMarketReview: closeReview,
    hasUsefulContent: value => Boolean(value), parseAIStrategy: () => ({}),
    getDataIntegrityStatus: isolatedFunction(resolverSource, 'getDataIntegrityStatus'),
    buildDisplayBadges: isolatedFunction(resolverSource, 'buildDisplayBadges'),
  });
  const state = await resolve();
  assert.equal(state.subscriberProjection, projection);
  assert.equal(state.todayTaipeiDate, resolved.today_date);
  assert.equal(state.isReportForToday, true);
  assert.equal(state.subscriberProjection.historical, false);
  for (const clientDay of ['2026-09-08', '2026-09-10', '2026-09-12']) {
    const display = displayFor(clientDay)(row);
    assert.equal(display.currentDate, resolved.today_date);
    assert.equal(display.reportDate, ai.report_date);
    assert.equal(display.beneficiaryStocks.length, projection.recommendation.items.length);
    assert.equal(display.isMarketClosed, false);
  }
});

test('same-day server non-trading contract closes display without raw market bias interpretation', () => {
  const ai = subscriberProjectionFixture('READY');
  ai.is_trading_day = false; ai.market_status = 'closed';
  const display = displayFor('2026-09-09')(rowFor(ai));
  assert.equal(display.isMarketClosed, true);
  assert.equal(display.is_trading_day, false);
  assert.equal(display.session_type, 'CLOSED');
  assert.equal(display.confidenceScore, null);
  assert.equal(display.beneficiaryStocks.length, 0);
});

test('stock-like observation aliases cannot bypass an unavailable recommendation projection', () => {
  const macro = { sector: 'synthetic-sector', observation: 'synthetic market observation' };
  const stocks = [{ symbol: 'TWSE:2330' }, { ticker: '2330.TW' }, { stock_name: 'synthetic-stock' }];
  for (const input of [null, {}, rowFor(subscriberProjectionFixture('PARTIAL')),
    rowFor(subscriberProjectionFixture('MARKET_READY_RECOMMENDATION_BLOCKED'))]) {
    assert.deepEqual(subscriberObservationSources(input, stocks, [...stocks, macro]), [macro]);
  }
  const row = rowFor(subscriberProjectionFixture('READY'));
  assert.equal(subscriberObservationSources(row, stocks, [macro]).length, 4);
});

test('active compatibility hook and resolver do not execute retired state generators', () => {
  const hook = read('src/hooks/useLatestReport.ts');
  const resolver = read('src/lib/morningAlpha/resolveMorningAlphaState.ts');
  assert.doesNotMatch(hook, /(?:getEffectiveDisplayState|getSafeMarketBias|generateIntelligence|generatePremiumReport|applyMarketBiasDowngrade|getDisplayConfidence)\s*\(/);
  assert.doesNotMatch(resolver, /resolveIntradayTrackingState\s*\(|getRuntimeCheckpointState\s*\(|taipeiHour\s*=/);
  assert.doesNotMatch(resolver, /revisionId:\s*[^\n]*\|\|\s*normalized\.reportId/);
  assert.match(resolver, /mapClosingVerificationToCloseMarketReview\(\s*subscriberProjection/);
  assert.match(hook, /setMorningState\(null\)/, 'failed request clears all prior revision-derived state');
  assert.match(hook, /todayTaipeiDate = morningState\?\.todayTaipeiDate \|\| formatTaipeiDate\(\)/,
    'compatibility metadata uses the same server date after resolution');
});
