import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { recommendationPublication, resolveSubscriberPayloadIdentity, isMarketPublicationReady, hasCompleteUniverseAssessment, RECOMMENDATION_EVIDENCE_INSUFFICIENT } from '../src/lib/subscriberReportContract.ts';
import { buildDecisionPresentation } from '../src/lib/decisionPresentation.ts';
import { buildCanonicalNarrative } from '../src/lib/canonicalNarrative.ts';
import { opportunitySummary, decisionFromReport } from '../src/features/decision-v1/presentation.ts';
import { emptyDecision } from '../src/features/decision-v1/engine.ts';

// Isolated regression fixtures; never sent to Production or counted as market evidence.
const DAY = '2026-09-08', REV = 'synthetic-published-revision';
const generatedAt = `${DAY}T00:35:00.000Z`;
function marketAi() {
  return { report_date: DAY, revision_id: REV, generated_at: generatedAt,
    report_status: 'READY', recommendation_status: 'BLOCKED', premium_content_status: 'blocked',
    content_publish_gate: { overall_status: 'eligible' },
    market_report_gate: { eligible: true, status: 'READY_MARKET_ONLY', report_status: 'READY' },
    recommendation_gate: { status: 'BLOCKED', eligible: false, screening: { status: 'INCOMPLETE', universe_count: 2, evaluated_count: 0 } },
    canonical_decision: { id: REV, status: 'READY', action: 'WAIT', decision_mode: 'market_only',
      daily_sentence: '合成已發布市場判斷：指數上漲，先等待量價確認。', reasons: ['合成市場證據已核對'], do_not_do: '合成條件未確認前不追價' },
  };
}
function display(ai) {
  return { rawAI: ai, reportDate: DAY, currentDate: DAY, is_trading_day: true, market_status: 'OPEN', dataStatus: 'partial', market_message: '正常交易', marketBias: '偏多' };
}

test('today canonical envelope remains today despite old holiday/internal QA fields', () => {
  const ai = { ...marketAi(), internal_qa: { report_date: '2026-09-06', market_bias: '休市', status: 'BLOCKED' } };
  const identity = resolveSubscriberPayloadIdentity({ today_date: DAY, report_date: DAY, revision_id: REV, generated_at: generatedAt, payload: ai });
  assert.deepEqual(identity, { reportDate: DAY, revisionId: REV, generatedAt, todayDate: DAY });
  assert.equal(isMarketPublicationReady(ai), true);
});

test('mixed date/revision/generation envelopes fail closed rather than relabel stale holiday data', () => {
  for (const patch of [{ report_date: '2026-09-06' }, { revision_id: 'synthetic-qa-revision' }, { generated_at: `${DAY}T01:00:00.000Z` }]) {
    assert.equal(resolveSubscriberPayloadIdentity({ today_date: DAY, report_date: DAY, revision_id: REV, generated_at: generatedAt, payload: { ...marketAi(), ...patch } }), null);
  }
});

test('same-day PARTIAL candidate is not publication proof and does not become an older report', () => {
  for (const patch of [
    { content_publish_gate: { overall_status: 'blocked' } },
    { content_publish_gate: null },
    { canonical_decision: { ...marketAi().canonical_decision, status: 'PARTIAL' } },
    { canonical_decision: null },
  ]) {
    const ai = { ...marketAi(), ...patch };
    assert.equal(isMarketPublicationReady(ai), false);
    assert.equal(resolveSubscriberPayloadIdentity({ report_date: DAY, revision_id: REV, payload: ai }).reportDate, DAY);
  }
  assert.equal(isMarketPublicationReady({ ...marketAi(), content_publish_gate: { overall_status: 'eligible' } }), true);
});

test('server identity is authoritative while legacy envelopes retain payload metadata fallback', () => {
  assert.equal(resolveSubscriberPayloadIdentity({ report_date: DAY, payload: marketAi() }).revisionId, REV);
  assert.equal(resolveSubscriberPayloadIdentity({ report_date: DAY, payload: marketAi() }).generatedAt, generatedAt);
  assert.equal(resolveSubscriberPayloadIdentity({ report_date: null, payload: marketAi() }), null);
});

test('Market PASS + recommendation BLOCKED keeps the current published market decision and withholds stocks', () => {
  const ai = marketAi(), state = display(ai);
  const narrative = buildCanonicalNarrative({ ai, displayState: state });
  const result = buildDecisionPresentation({ displayState: state, narrative, opportunitySource: [{ symbol: '2330', name: '測試公司', reason: '不應顯示' }] });
  assert.equal(result.dateLabel, DAY);
  assert.equal(result.primaryDecision.state, 'WAIT');
  assert.deepEqual(result.opportunities, []);
  assert.match(result.mission.explanation, /合成已發布市場判斷/);
  assert.deepEqual(recommendationPublication(ai), { explicit: true, stocksAllowed: false, notice: RECOMMENDATION_EVIDENCE_INSUFFICIENT });
});

test('internal research QA draft cannot replace the pinned published market explanation', () => {
  const ai = marketAi();
  ai.member_research_note_v2 = { opening_thesis: { title: '合成 QA 候選', summary: '合成 QA 尚未發布', action: 'QA BLOCKED' } };
  ai.v10_core_market_thesis = { primary_driver: '合成舊分析', market_story: '合成舊分析結論' };
  const narrative = buildCanonicalNarrative({ ai, displayState: display(ai), memberResearchNoteV2: ai.member_research_note_v2 });
  assert.equal(narrative.today_focus.summary, ai.canonical_decision.daily_sentence);
  assert.equal(narrative.today_focus.why, '合成市場證據已核對');
  assert.equal(narrative.today_script.headline, ai.canonical_decision.daily_sentence);
  assert.doesNotMatch(narrative.decision_lifecycle.current_thesis.summary, /QA/);
});

test('recommendation blocked does not invent a rejected market thesis; real STOP is preserved', () => {
  const ai = marketAi();
  for (const action of ['WAIT', 'STOP']) {
    ai.canonical_decision = { ...ai.canonical_decision, action, decision_mode: 'blocked' };
    const state = display(ai), narrative = buildCanonicalNarrative({ ai, displayState: state });
    assert.equal(buildDecisionPresentation({ displayState: state, narrative }).primaryDecision.state, action);
  }
  ai.canonical_decision = { ...ai.canonical_decision, action: '', decision_mode: 'blocked' };
  delete ai.market_report_gate;
  const state = display(ai), narrative = buildCanonicalNarrative({ ai, displayState: state });
  assert.equal(buildDecisionPresentation({ displayState: state, narrative }).primaryDecision.state, 'INSUFFICIENT_DATA');
});

test('recommendation BLOCKED notice wins over empty-list/no-qualified wording and cannot add scores', () => {
  const decision = { ...emptyDecision(), action: 'NO_QUALIFIED_OPPORTUNITY' };
  assert.equal(opportunitySummary(decision, 0), RECOMMENDATION_EVIDENCE_INSUFFICIENT);
  assert.equal(opportunitySummary(decision, 4, false, RECOMMENDATION_EVIDENCE_INSUFFICIENT), RECOMMENDATION_EVIDENCE_INSUFFICIENT);
  assert.equal(decision.direction_probability, null);
  assert.equal(decision.entry_environment_score, null);
  assert.equal(decision.stock_opportunities.length, 0);
});

test('NO_QUALIFIED requires proof of a complete non-empty universe, not an empty result array', () => {
  for (const screening of [{}, { status: 'COMPLETE', universe_count: 0, evaluated_count: 0 }, { status: 'COMPLETE', universe_count: 5, evaluated_count: 4 }, { status: 'INCOMPLETE', universe_count: 5, evaluated_count: 5 }]) {
    assert.equal(hasCompleteUniverseAssessment(screening), false);
    assert.equal(recommendationPublication({ recommendation_status: 'NO_QUALIFIED_OPPORTUNITY', recommendation_gate: { screening } }).notice, RECOMMENDATION_EVIDENCE_INSUFFICIENT);
  }
  const screening = { status: 'COMPLETE', universe_count: 5, evaluated_count: 5, rejected: [] };
  assert.equal(hasCompleteUniverseAssessment(screening), true);
  assert.equal(recommendationPublication({ recommendation_status: 'NO_QUALIFIED_OPPORTUNITY', recommendation_gate: { screening } }).notice, RECOMMENDATION_EVIDENCE_INSUFFICIENT);
  assert.equal(recommendationPublication({ ...marketAi(), recommendation_status: 'NO_QUALIFIED_OPPORTUNITY', recommendation_gate: { universe_evaluation_complete: true, screening } }).notice, '今天沒有符合標準的新增機會');
  assert.equal(recommendationPublication({ recommendation_status: 'NO_QUALIFIED_OPPORTUNITY', recommendation_gate: { universe_evaluation_complete: true, screening } }).notice, RECOMMENDATION_EVIDENCE_INSUFFICIENT, 'A detached complete-universe claim is not publication proof');
  for (const rejected of [undefined, null, ['MISSING_INSTITUTIONAL_EVIDENCE']]) {
    assert.equal(hasCompleteUniverseAssessment({ ...screening, rejected }), false);
    assert.equal(recommendationPublication({ recommendation_status: 'NO_QUALIFIED_OPPORTUNITY', recommendation_gate: { universe_evaluation_complete: true, screening: { ...screening, rejected } } }).notice, RECOMMENDATION_EVIDENCE_INSUFFICIENT);
  }
});

test('malformed server no-qualified decision is downgraded without inventing a new market direction', () => {
  const input = { ...emptyDecision(), report_date: DAY, revision_id: REV, generated_at: generatedAt, data_as_of: generatedAt,
    schema_version: 'decision-evidence-v1', calibration_status: 'INSUFFICIENT_HISTORY', action: 'NO_QUALIFIED_OPPORTUNITY', market_direction: 'BULLISH', screening: { status: 'INCOMPLETE', universe_count: 2, evaluated_count: 0 } };
  const result = decisionFromReport({ ...marketAi(), decision_engine_v1: input }, { report_date: DAY, revision_id: REV, generated_at: generatedAt }, DAY);
  assert.equal(result.action, 'INSUFFICIENT_DATA');
  assert.equal(result.market_direction, 'BULLISH');
  assert.deepEqual(result.stock_opportunities, []);
});

test('stock admission remains independent of Premium entitlement and unknown statuses fail closed', () => {
  assert.equal(recommendationPublication({ ...marketAi(), recommendation_status: 'QUALIFIED', recommendation_gate: { eligible: true }, premium_content_status: 'blocked' }).stocksAllowed, true);
  assert.equal(recommendationPublication({ recommendation_status: 'QUALIFIED', recommendation_gate: { eligible: true }, premium_content_status: 'blocked' }).stocksAllowed, false, 'Detached stock gate cannot grant publication');
  for (const eligible of [undefined, null, false, 'true', 1]) {
    assert.equal(recommendationPublication({ recommendation_status: 'QUALIFIED', recommendation_gate: { eligible } }).stocksAllowed, false, String(eligible));
  }
  assert.equal(recommendationPublication({ recommendation_status: 'UNRECOGNIZED' }).stocksAllowed, false);
  const today = readFileSync(new URL('../src/pages/report/TodayReport.tsx', import.meta.url), 'utf8');
  assert.match(today, /projection\.recommendation\.available && canShowBeginnerRecommendations/);
  assert.match(today, /premiumEligible: premiumAvailability\.eligible/);
  assert.match(today, /emptyStockMessage=\{projection\.recommendation\.message \|\| RECOMMENDATION_EVIDENCE_INSUFFICIENT\}/);
  assert.match(today, /recommendationNotice=\{projection\.recommendation\.message\}/);
});
