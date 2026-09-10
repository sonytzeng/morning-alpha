import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createSubscriberState } from '../shared/subscriber-state-contract.ts';
import { buildCanonicalNarrative } from '../src/lib/canonicalNarrative.ts';
import { buildDecisionPresentation } from '../src/lib/decisionPresentation.ts';
import { resolveClosingVerificationState } from '../src/lib/closingVerificationState.ts';
import { buildRuntimeDecisionTimeline } from '../src/lib/runtimeDecisionTimeline.ts';
import { isMarketPublicationReady, isSubscriberAnalysisUnavailable, subscriberConfidence, recommendationPublication, subscriberObservationSources, resolveSubscriberPayloadIdentity, SUBSCRIBER_ANALYSIS_INCOMPLETE } from '../src/lib/subscriberReportContract.ts';

// Isolated shape fixtures only. No Production request or market data write.
const DAY = '2026-09-08', REV = 'synthetic-state-revision', GENERATED = `${DAY}T00:30:00.000Z`;
const closing = () => ({ status: 'COMPLETE', report_date: DAY, opening_decision_snapshot_id: REV,
  data_status: 'complete', verified_at: `${DAY}T06:30:00.000Z`, actual_direction: 'up', actual_taiex_change: 0.4,
  actual_2330_close: { change_percent: 0.8 }, actual_txf_close: { change_percent: 0.3 },
  prediction_result: 'hit', missing_data: [] });
const wire = (overrides = {}) => createSubscriberState({ report_date: DAY, revision_id: REV, generated_at: GENERATED,
  publicationVerified: true, marketEvidenceReady: true, analysisStatus: 'READY', isTradingDay: true,
  confidenceValue: 64, recommendationGate: { status: 'BLOCKED', eligible: false }, closing: {}, now: `${DAY}T03:00:00.000Z`, ...overrides });
const ai = (state = wire(), overrides = {}) => ({ report_date: DAY, revision_id: REV, generated_at: GENERATED,
  subscriber_state: state, report_status: 'READY', confidence_score: 100,
  content_publish_gate: { overall_status: 'eligible' },
  market_report_gate: { eligible: true, report_status: 'READY' },
  canonical_decision: { status: 'READY', action: 'WAIT', decision_mode: 'market_only', daily_sentence: '合成已發布市場判斷' },
  recommendation_status: 'BLOCKED', recommendation_gate: { status: 'BLOCKED', eligible: false },
  closing_verification_v2: closing(), intraday_sync_status: { windows: { '1430': { status: 'completed', completed_at: `${DAY}T06:30:00.000Z`, evidence: { synthetic: true } } } },
  ...overrides });
function present(value) {
  const displayState = { rawAI: value, reportDate: DAY, currentDate: DAY, is_trading_day: true,
    market_status: 'OPEN', market_message: '正常交易', marketBias: '偏多', dataStatus: 'partial', confidenceScore: 100 };
  const narrative = buildCanonicalNarrative({ ai: value, displayState });
  const presentation = buildDecisionPresentation({ displayState, narrative,
    opportunitySource: [{ symbol: '2330', name: '合成不得外洩股票', reason: '合成資料' }] });
  const timeline = buildRuntimeDecisionTimeline({ ai: value, hasReport: true, reportRevisionId: REV,
    reportGeneratedAt: GENERATED, isTradingDay: true, taipeiMinutes: 16 * 60 });
  return { presentation, narrative, timeline };
}

test('PARTIAL is not FAILED, INVALIDATED or CLOSING_COMPLETE even with STOP, raw close and 100 confidence', () => {
  const value = ai(wire({ publicationVerified: false, analysisStatus: 'PARTIAL' }), {
    canonical_decision: { status: 'PARTIAL', action: 'STOP', decision_mode: 'blocked' },
    content_publish_gate: { overall_status: 'blocked' },
  });
  const { presentation, narrative, timeline } = present(value);
  assert.equal(presentation.primaryDecision.state, 'INSUFFICIENT_DATA');
  assert.equal(presentation.primaryDecision.headline, SUBSCRIBER_ANALYSIS_INCOMPLETE);
  assert.equal(presentation.confidence, undefined);
  assert.deepEqual(presentation.opportunities, []);
  assert.equal(narrative.decision_evidence.status, 'Waiting');
  assert.equal(narrative.decision_evidence.runtimeFailure, false);
  assert.equal(narrative.decision_evidence.closingVerified, false);
  assert.equal(resolveClosingVerificationState(value).state, 'pending');
  assert.notEqual(timeline[0].status, 'completed');
  assert.notEqual(timeline.at(-1).status, 'completed');
});

test('Home exposes unfinished analysis in its visible Hero, not only in collapsed decision details', () => {
  const home = readFileSync(new URL('../src/pages/home/page.tsx', import.meta.url), 'utf8');
  assert.match(home, /const heroDecisionSentence = analysisUnavailable\s*\? SUBSCRIBER_ANALYSIS_INCOMPLETE/);
  const heroHeading = home.indexOf('<h1>{renderSafeText(heroDecisionSentence)}</h1>');
  const collapsedDetails = home.indexOf('<details');
  assert.ok(heroHeading >= 0 && collapsedDetails > heroHeading, 'the explicit unfinished status must be visible before collapsed details');
  const value = ai(wire({ publicationVerified: false, analysisStatus: 'PARTIAL' }));
  assert.equal(isSubscriberAnalysisUnavailable(value), true);
  assert.equal(present(value).presentation.primaryDecision.headline, SUBSCRIBER_ANALYSIS_INCOMPLETE);
  assert.equal(subscriberConfidence(value, 100), null);
});

test('legacy explicit PARTIAL is fail closed before canonical STOP or close claims', () => {
  const value = ai(undefined, { canonical_decision: { status: 'PARTIAL', action: 'STOP' } });
  delete value.subscriber_state;
  const { presentation, narrative } = present(value);
  assert.equal(presentation.primaryDecision.state, 'INSUFFICIENT_DATA');
  assert.equal(presentation.confidence, undefined);
  assert.equal(narrative.decision_evidence.runtimeFailure, false);
  assert.equal(resolveClosingVerificationState(value).state, 'pending');
});

test('READY published market decision remains visible while recommendation is BLOCKED', () => {
  const value = ai(), { presentation } = present(value);
  assert.equal(isMarketPublicationReady(value), true);
  assert.equal(presentation.primaryDecision.state, 'WAIT');
  assert.equal(presentation.mission.explanation, '合成已發布市場判斷');
  assert.equal(presentation.confidence.score, 64);
  assert.equal(recommendationPublication(value).stocksAllowed, false);
  assert.match(recommendationPublication(value).notice, /推薦評估證據不足/);
  assert.deepEqual(presentation.opportunities, []);
});

test('Home keeps the blocked recommendation notice visible and does not treat an empty list as completed screening', () => {
  const home = readFileSync(new URL('../src/pages/home/page.tsx', import.meta.url), 'utf8');
  assert.match(home, /const projection = getSubscriberReportProjection\(/);
  assert.match(home, /const recommendationNotice = projection\.recommendation\.message/);
  const visibleNotice = home.indexOf('<span>{renderSafeText(recommendationNotice ||');
  assert.ok(visibleNotice >= 0 && visibleNotice < home.indexOf('<details'), 'stock publication status must remain visible before collapsed details');
  assert.match(home, /const observationSource = projection\.recommendation\.items/);
  assert.match(home, /<strong>\{recommendationNotice \|\| \(evidenceIsInsufficient/);
  assert.doesNotMatch(home, /今日觀察名單已完成|今日沒有強受惠股/);
  const blocked = ai(), qualified = ai(wire({ recommendationGate: { status: 'QUALIFIED', eligible: true } }));
  assert.equal(isMarketPublicationReady(blocked), true);
  assert.equal(recommendationPublication(blocked).stocksAllowed, false);
  assert.equal(recommendationPublication(blocked).notice, '推薦評估證據不足，今日暫不發布正式個股推薦');
  assert.equal(isMarketPublicationReady(qualified), true);
  assert.equal(recommendationPublication(qualified).stocksAllowed, true);
  assert.equal(recommendationPublication(qualified).notice, null);
  const beneficiaries = [{ symbol: '2330', name: '合成個股', reason: '不得發布的舊候選' }];
  const sectorFact = { sector: '合成產業', observation_reason: '合成市場傳導事實' };
  const indexFact = { symbol: 'TAIEX', name: '合成指數', observation_reason: '合成指數量價觀察' };
  const observations = [sectorFact, indexFact, { symbol: 'TWSE:2330' }, { ticker: '2344.TW' }, { stock_name: '合成個股' }];
  assert.deepEqual(subscriberObservationSources(blocked, beneficiaries, observations), [sectorFact, indexFact]);
  assert.deepEqual(subscriberObservationSources(qualified, beneficiaries, observations), [...beneficiaries, ...observations]);
});

test('versioned NO_QUALIFIED never falls through to legacy QUALIFIED stock permission', () => {
  const screening = { status: 'COMPLETE', universe_count: 3, evaluated_count: 3, rejected: [] };
  const state = wire({ recommendationGate: { status: 'NO_QUALIFIED_OPPORTUNITY', universe_evaluation_complete: true, screening } });
  assert.equal(state.recommendation, 'NO_QUALIFIED_OPPORTUNITY');
  const value = ai(state, { recommendation_status: 'QUALIFIED', recommendation_gate: { status: 'QUALIFIED', eligible: true } });
  assert.deepEqual(recommendationPublication(value), { explicit: true, stocksAllowed: false, notice: '推薦評估證據不足，今日暫不發布正式個股推薦' });
  assert.deepEqual(present(value).presentation.opportunities, []);
  value.recommendation_gate = { ...value.recommendation_gate, universe_evaluation_complete: true, screening };
  assert.deepEqual(recommendationPublication(value), { explicit: true, stocksAllowed: false, notice: '今天沒有符合標準的新增機會' });
  const qualified = ai(wire({ recommendationGate: { status: 'QUALIFIED', eligible: true } }));
  assert.deepEqual(recommendationPublication(qualified), { explicit: true, stocksAllowed: true, notice: null });
  qualified.subscriber_state.schema_version = 'unknown-state-version';
  assert.equal(recommendationPublication(qualified).stocksAllowed, false);
});

test('Closing NOT_DUE cannot be completed by elapsed browser clock or a captured checkpoint', () => {
  const value = ai(wire({ closing: { status: 'NOT_DUE' } }));
  assert.equal(resolveClosingVerificationState(value).state, 'pending');
  assert.equal(present(value).timeline.at(-1).status, 'pending');
});

test('Closing COMPLETE requires matching verified publication outcome before display', () => {
  const value = ai(wire({ closing: closing(), now: `${DAY}T07:00:00.000Z` }));
  assert.equal(value.subscriber_state.closing, 'COMPLETE');
  assert.equal(resolveClosingVerificationState(value).state, 'complete');
  assert.equal(present(value).timeline.at(-1).status, 'completed');
  const missing = { ...value, closing_verification_v2: {} };
  assert.equal(resolveClosingVerificationState(missing).state, 'pending');
});

test('a COMPLETE wire state cannot bless mismatched or incomplete detached closing evidence', () => {
  const value = ai(wire({ closing: closing(), now: `${DAY}T07:00:00.000Z` }));
  assert.equal(resolveClosingVerificationState(value).state, 'complete');
  for (const patch of [{ report_date: '2026-09-07' }, { report_date: undefined },
    { opening_decision_snapshot_id: 'another-revision' }, { opening_decision_snapshot_id: null },
    { status: 'direction_completed_data_degraded' }, { data_status: 'degraded' },
    { actual_2330_close: {} }, { actual_txf_close: { change_percent: null } },
    { missing_data: undefined }, { missing_data: ['TXF'] }, { verified_at: null },
    { verified_at: `${DAY}T02:00:00.000Z` }, { prediction_result: 'unknown' }]) {
    const mixed = { ...value, closing_verification_v2: { ...closing(), ...patch } };
    assert.equal(resolveClosingVerificationState(mixed).state, 'pending');
    assert.notEqual(present(mixed).timeline.at(-1).status, 'completed');
    assert.equal(present(mixed).narrative.decision_evidence.closingVerified, false);
  }
});

test('MISSING_CONFIDENCE is unavailable, never the raw 100 or a fabricated numeric fallback', () => {
  const value = ai(wire({ confidenceValue: null }));
  assert.equal(present(value).presentation.confidence, undefined);
  assert.equal(subscriberConfidence(value, 100), null);
  for (const invalid of [undefined, null, '', ' ', false, true, [], {}, Infinity, NaN, 101, -1]) {
    assert.equal(subscriberConfidence({}, invalid), null, String(invalid));
  }
  assert.equal(subscriberConfidence({}, 0), null, 'A detached numeric value is not a published confidence');
  assert.equal(subscriberConfidence(ai(wire({ confidenceValue: 0 })), 100), 0, 'A published real zero remains zero');
});

test('unbound QA assessment prose cannot impersonate missing confidence while market facts and formal scores survive', () => {
  const value = ai(wire({ confidenceValue: null }), {
    canonical_decision: { status: 'READY', action: 'WAIT', daily_sentence: '合成已發布市場判斷',
      reasons: ['資料為最近完整交易日收盤；綜合評分 100/100', '成交量增加5%', '台股站回100日均線', '股價100元；殖利率5%'] },
    quality_score: 100,
  });
  const missing = present(value);
  assert.equal(missing.presentation.confidence, undefined);
  assert.equal(missing.narrative.today_focus.why, '資料為最近完整交易日收盤；成交量增加5%；台股站回100日均線；股價100元；殖利率5%');
  assert.doesNotMatch(missing.narrative.today_focus.why, /100\s*\/\s*100/);
  value.subscriber_state = wire({ confidenceValue: 90 });
  assert.equal(present(value).presentation.confidence.score, 90);
  assert.equal(present(value).narrative.today_focus.why, missing.narrative.today_focus.why);
  value.canonical_decision.reasons = ['綜合評分 85/100', '品質分數：95/100', 'confidence_score=100/100'];
  value.taiwan_transmission = '不應補入的內部草稿信心 100/100';
  assert.equal(present(value).narrative.today_focus.why, '');
  assert.equal(present(value).presentation.confidence.score, 90);
  assert.equal(present(value).narrative.today_focus.summary, '合成已發布市場判斷');
});

test('legacy missing runtime evidence does not display a numeric confidence even if the old row stores 100', () => {
  const { presentation } = present({ confidence_score: 100, market_bias: '偏多' });
  assert.equal(presentation.primaryDecision.state, 'INSUFFICIENT_DATA');
  assert.equal(presentation.confidence, undefined);
});

test('INSUFFICIENT_EVIDENCE never publishes scores, a failed thesis or recommendations', () => {
  const value = ai(wire({ marketEvidenceReady: false, analysisStatus: 'INSUFFICIENT_EVIDENCE' }));
  const { presentation, narrative } = present(value);
  assert.equal(isMarketPublicationReady(value), false);
  assert.equal(presentation.primaryDecision.state, 'INSUFFICIENT_DATA');
  assert.equal(presentation.confidence, undefined);
  assert.equal(narrative.decision_evidence.status, 'Waiting');
  assert.deepEqual(presentation.opportunities, []);
});

test('unknown schema versions and mixed state identities cannot fall back to legacy READY/100', () => {
  for (const state of [null, { ...wire(), schema_version: 'future-v99' }, { ...wire(), revision_id: 'wrong' }, { ...wire(), report_date: '2026-09-06' }]) {
    const value = ai(state);
    assert.equal(isSubscriberAnalysisUnavailable(value), true);
    assert.equal(present(value).presentation.primaryDecision.state, 'INSUFFICIENT_DATA');
    assert.equal(subscriberConfidence(value, 100), null);
  }
});

test('UNPUBLISHED keeps the current envelope date and revision, never a stale previous-day fallback', () => {
  const value = ai(wire({ publicationVerified: false, analysisStatus: 'PARTIAL' }));
  assert.deepEqual(resolveSubscriberPayloadIdentity({ report_date: DAY, revision_id: REV, generated_at: GENERATED, payload: value }),
    { reportDate: DAY, revisionId: REV, generatedAt: GENERATED, todayDate: null });
  assert.equal(present(value).presentation.dateLabel, DAY);
});

test('non-trading publication state stays CLOSED/not_applicable rather than an unfinished trading checkpoint', () => {
  const value = ai(wire({ publicationVerified: false, analysisStatus: 'PARTIAL', isTradingDay: false }));
  const displayState = { rawAI: value, reportDate: DAY, currentDate: DAY, is_trading_day: false, market_status: 'HOLIDAY' };
  const narrative = buildCanonicalNarrative({ ai: value, displayState });
  const presentation = buildDecisionPresentation({ displayState, narrative });
  assert.equal(presentation.primaryDecision.state, 'CLOSED');
  assert.equal(presentation.primaryDecision.headline, '今日休市');
  assert.ok(buildRuntimeDecisionTimeline({ ai: value, hasReport: true, isTradingDay: false }).every(node => node.status === 'not_applicable'));
});
