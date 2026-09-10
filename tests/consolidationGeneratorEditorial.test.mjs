// Actual Generator declarations, assembler and shared quality functions.
// In-memory only: a guarded pre-write call is not a database/publication E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch, assembleResearchMasterV2, admitResearchRecommendations, validateResearchMasterV2, buildBlockedResearchMasterV2 } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketDocument, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketContentIntelligence, isDecisionCriticalMissingSource } from '../supabase/functions/_shared/content-intelligence.ts';
import { evaluateResearchQualityGate } from '../supabase/functions/_shared/research-quality-gate.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';
import { evaluatePublishedMarketDelivery, fetchPublishedDeliveryEvidence } from '../supabase/functions/_shared/market-publication-contract.ts';
import { canonicalDecisionAction } from '../supabase/functions/_shared/canonical-decision-contract.mjs';
import { canonicalReportProjection, presentNumber, RESEARCH_PIPELINE_VERSION } from '../supabase/functions/_shared/research-pipeline-contract.ts';
import { normalizeMarketDataRows } from '../supabase/functions/generate-daily-report-v7/market-data-evidence.ts';
import { filterFreshMarketIndicators, isMarketIndicatorStale } from '../supabase/functions/generate-daily-report-v7/market-freshness.ts';
import { normalizePremiumMarketEvidence } from '../supabase/functions/_shared/premium-evidence.ts';
import { RUNTIME_QUALITY_POLICY, resolveAbstentionDecision, classifyMarketRegime, buildBullBearDebate,
  buildCanonicalDecisionContract, buildCanonicalMemberResearchRevision, evaluateCanonicalSemanticCoherenceGate } from '../supabase/functions/_shared/production-architecture-core.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('supabase/functions/generate-daily-report-v7/index.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const canonicalRecord = isolatedFunction(source, 'canonicalRecord');
const canonicalRecords = isolatedFunction(source, 'canonicalRecords');
const canonicalText = isolatedFunction(source, 'canonicalText');
const PublicationQualityError = isolatedFunction(source, 'PublicationQualityError');
const build = isolatedFunction(source, 'buildCanonicalDecisionPayload', {
  canonicalRecord, canonicalRecords, canonicalText, canonicalMarketDocument, canonicalMarketSourceRefs,
  evaluateMarketContentIntelligence, evaluateMarketReportGate, evaluateResearchQualityGate,
  canonicalDecisionAction, presentNumber, RESEARCH_PIPELINE_VERSION,
  VERSION: isolatedFunction(source, 'VERSION'),
});
const project = isolatedFunction(source, 'projectReviewedMarketDecision', {
  canonicalRecord, canonicalRecords, canonicalText, canonicalMarketDocument,
  canonicalReportProjection, evaluateMarketContentIntelligence, evaluateMarketReportGate,
  PublicationQualityError, presentNumber,
});
const completeFixture = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture');
const decisionSentence = 'SOX 上漲帶動半導體與台積電的隔夜風險偏好。09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
const thinSentence = 'SOX 與半導體指數上漲 1%，台積電與 TAIEX 反映隔夜市場的方向背景。';
const fixture = isolatedFunction(read('tests/consolidationCanonicalEditorial.test.mjs'), 'fixture', {
  completeFixture, decisionSentence, thinSentence,
  // The extracted fixture creates VM-realm arrays; compare its JSON data rather
  // than unrelated Array prototypes while retaining every fixture assertion.
  assert: { ...assert, deepEqual: (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message) },
  assembleCanonicalMarketResearch, buildCanonicalMarketState,
});
function input(sentence = decisionSentence) {
  const ai = plain(fixture(sentence));
  ai.generated_at = ai.canonical_market_state.generated_at;
  ai.important_news = [];
  return ai;
}
const decision = ai => plain(build(ai, ai.important_news, 'normal_overnight', '中性觀察', 64, { is_trading_day: true }));
const editorial = ai => plain(evaluateMarketContentIntelligence(ai, 0));
function expectPreWriteRejection(ai, payload) {
  let reachedWriteBoundary = false;
  assert.throws(() => {
    project(ai, payload, 0);
    reachedWriteBoundary = true;
  }, error => error.constructor.name === 'PublicationQualityError' && Array.isArray(error.reasonCodes));
  assert.equal(reachedWriteBoundary, false);
}

// Reuse the actual orchestration's manifest statements, not a second test-side
// threshold. The database below is a transport double only; all quality,
// assembler, decision and pre-publication functions remain the real functions.
const marketUsable = isolatedFunction(source, 'hasUsableMarketEvidence');
const marketFind = isolatedFunction(source, 'findIndicator', { hasUsableMarketEvidence: marketUsable });
const marketUs = isolatedFunction(source, 'checkMVPStatus', { findIndicator: marketFind });
const marketTw = isolatedFunction(source, 'checkTWCoreStatus', { findIndicator: marketFind });
const marketStale = isolatedFunction(source, 'isCoreMarketDataStale', { isMarketIndicatorStale });
const staleSources = isolatedFunction(source, 'detectStaleCoreMarketData', { isCoreMarketDataStale: marketStale });
const unavailableSources = isolatedFunction(source, 'detectUnavailableMarketData', { findIndicator: marketFind, isCoreMarketDataStale: marketStale });
const manifestStart = source.indexOf('    const twStatus=checkTWCoreStatus(');
const manifestEnd = source.indexOf("    log('MARKET_DATA valid=", manifestStart);
assert.ok(manifestStart >= 0 && manifestEnd > manifestStart);
const manifestStatements = source.slice(manifestStart, manifestEnd);
const assemblyAttach = isolatedFunction(source, 'attachResearchMasterV2Shadow', {
  admitResearchRecommendations, assembleResearchMasterV2, validateResearchMasterV2,
  assembleCanonicalMarketResearch, buildCanonicalMarketState, buildBlockedResearchMasterV2,
});
const failMissing = isolatedFunction(source, 'failClosedForMissingRequiredEvidence');
const sourceNow = Date.parse('2026-07-14T00:01:00.000Z');
const sourceDates = { twCoreDate: '2026-07-13', usGlobalDate: '2026-07-13' };
const marketRows = () => ['NVDA', 'TSM', 'SPX', 'TAIEX', 'TXF', '2330', 'SOX', 'VIX'].map((symbol, index) => ({
  symbol, name: symbol, market: ['TAIEX', 'TXF', '2330'].includes(symbol) ? 'TW' : 'US', value: 100 + index, change_percent: 1,
  captured_at: ['TAIEX', 'TXF', '2330'].includes(symbol) ? '2026-07-13T06:30:00.000Z' : '2026-07-13T20:00:00.000Z',
}));
function assembleRequiredInput(rows) {
  const normalized = normalizeMarketDataRows(rows, sourceNow), marketData = normalized.marketData;
  const researchMarketData = filterFreshMarketIndicators(marketData, sourceDates, sourceNow);
  const assembly = plain(completeFixture()), ai = input();
  delete ai.canonical_market_state; delete ai.research_master_v2;
  const manifest = isolatedFunction('function actualManifest(){' + manifestStatements
    + '\nreturn {twStatus,mvpStatus,requiredEvidenceAvailable,missingSources,dataQuality};}', 'actualManifest', {
    checkTWCoreStatus: marketTw, checkMVPStatus: marketUs, marketData, researchMarketData, log: () => {},
    dataCount: normalized.dataCount, marketFetch: normalized, rawDataForDates: rows,
    newsData: [assembly.evidenceIndex.find(row => row.evidence_id === 'NEWS001')], newsFetch: { newsData: [] },
    sectorData: [assembly.evidenceIndex.find(row => row.evidence_id === 'SEC001')], sectorRotationReferenceDate: '2026-07-13',
    staleCoreSources: staleSources(marketData, sourceDates), unavailableSources: unavailableSources(marketData, sourceDates),
  })();
  ai.data_quality = manifest.dataQuality; ai.missing_sources = plain(manifest.missingSources);
  assembly.legacy = ai; assembly.evidencePack.data_quality.missing_sources = plain(manifest.missingSources);
  assemblyAttach(ai, assembly, () => {});
  const finalAi = manifest.requiredEvidenceAvailable ? ai : failMissing(ai, ai.missing_sources, () => {});
  return { ai: finalAi, manifest, marketData, researchMarketData };
}
const writer = isolatedFunction(source, 'writeReport', {
  canonicalRecord, canonicalText, canonicalMarketDocument, PublicationQualityError,
  buildImportantNewsPayload: isolatedFunction(source, 'buildImportantNewsPayload', { canonicalRecord }),
  normalizePremiumMarketEvidence: row => normalizePremiumMarketEvidence(row, sourceNow),
  applyFreshNewsEvidenceGate: isolatedFunction(source, 'applyFreshNewsEvidenceGate'),
  safeInteger: isolatedFunction(source, 'safeInteger'), dScoreFromAI: isolatedFunction(source, 'dScoreFromAI'),
  extractMarketNumericPayload: isolatedFunction(source, 'extractMarketNumericPayload', { findIndicator: marketFind }),
  finalSanitizeTWStocks: isolatedFunction(source, 'finalSanitizeTWStocks'),
  evaluateMarketContentIntelligence, evaluatePremiumContentGate, isDecisionCriticalMissingSource,
  resolveAbstentionDecision, RUNTIME_QUALITY_POLICY, classifyMarketRegime, buildBullBearDebate,
  buildCanonicalDecisionPayload: build, buildCanonicalDecisionContract, buildCanonicalMemberResearchRevision,
  evaluateResearchQualityGate, evaluateCanonicalSemanticCoherenceGate, projectReviewedMarketDecision: project,
});
const failureStart = source.indexOf('    const qualityFailure=err instanceof PublicationQualityError;');
const failureEnd = source.indexOf('\n  }\n});', failureStart);
assert.ok(failureStart >= 0 && failureEnd > failureStart);
const failureResponse = isolatedFunction('async function actualFailureResponse(err){'
  + source.slice(failureStart, failureEnd) + '\n}', 'actualFailureResponse', {
  PublicationQualityError, activeInputRun: null, inputRunClient: null, correlationId: 'test-correlation',
  VERSION: isolatedFunction(source, 'VERSION'), logs: [], log: () => {},
  corsResponse: isolatedFunction(source, 'corsResponse', { Response, CORS_HEADERS: isolatedFunction(source, 'CORS_HEADERS') }),
});
async function guardedWrite(value, rpcCalls) {
  const reachedAtomicBoundary = new Error('ACTUAL_ATOMIC_PUBLICATION_BOUNDARY');
  const db = {
    from(table) {
      assert.ok(['reports', 'trading_day_state'].includes(table));
      const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'publish_research_bundle_v1'); rpcCalls.push({ name, args }); throw reachedAtomicBoundary;
    },
  };
  try {
    await writer(db, '2026-07-14', value.ai, '中性觀察', 80, 'normal_overnight', value.marketData, [], () => {},
      { is_trading_day: true, market_closed: false, holiday_name: null, reason: 'TRADING_DAY' }, sourceDates, '', null,
      'synthetic-correlation', 1, '2026-07-14T00:01:00.000Z', { id: 'synthetic-input-run', fingerprint: 'synthetic-input-fingerprint', attempt: 1 });
    assert.fail('The controlled write must either reject or reach its explicit non-persistent RPC boundary');
  } catch (error) { return { error, reachedAtomicBoundary: error === reachedAtomicBoundary }; }
}

for (const symbol of ['NVDA', 'TSM', 'SPX']) test('actual required-source manifest blocks publication before RPC for ' + symbol, async () => {
  for (const [name, mutate] of [
    ['absent', rows => rows.filter(row => row.symbol !== symbol)],
    ['invalid value', rows => rows.map(row => row.symbol === symbol ? { ...row, value: null } : row)],
    ['invalid change', rows => rows.map(row => row.symbol === symbol ? { ...row, change_percent: '' } : row)],
    ['stale session', rows => rows.map(row => row.symbol === symbol ? { ...row, captured_at: '2026-07-10T20:00:00.000Z' } : row)],
  ]) {
    const value = assembleRequiredInput(mutate(marketRows())), calls = [];
    assert.equal(value.manifest.requiredEvidenceAvailable, false, name);
    assert.ok(value.manifest.missingSources.includes('required_us_market_evidence'), name);
    assert.equal(value.manifest.dataQuality, 'degraded', name);
    assert.equal(value.ai.research_master_v2.provenance.source_status, 'partial', name);
    const payload = decision(value.ai); assert.equal(payload.decision_mode, 'blocked', name);
    const attempted = await guardedWrite(value, calls);
    assert.equal(attempted.reachedAtomicBoundary, false, name); assert.equal(calls.length, 0, name);
    assert.equal(attempted.error.constructor.name, 'PublicationQualityError', name);
    assert.ok(attempted.error.reasonCodes.includes('CANONICAL_DECISION_BLOCKED'), name);
    const response = await failureResponse(attempted.error), body = await response.json();
    assert.equal(response.status, 409, name); assert.equal(body.error_code, 'RESEARCH_QUALITY_REJECTED', name);
    assert.ok(body.reason_codes.includes('CANONICAL_DECISION_BLOCKED'), name);
  }
});
test('complete required inputs retain market-only publication with company recommendations blocked', async () => {
  const value = assembleRequiredInput(marketRows()), calls = [];
  assert.equal(value.manifest.requiredEvidenceAvailable, true);
  assert.deepEqual(plain(value.manifest.missingSources), []); assert.equal(value.manifest.dataQuality, 'complete');
  const payload = decision(value.ai); assert.equal(payload.decision_mode, 'market_only');
  assert.equal(payload.recommendation_status, 'BLOCKED'); assert.deepEqual(payload.generated_text.recommendations, []);
  const attempted = await guardedWrite(value, calls);
  assert.equal(attempted.reachedAtomicBoundary, true, String(attempted.error)); assert.equal(calls.length, 1);
  assert.equal(calls[0].args.p_decision.decision_mode, 'market_only');
  assert.deepEqual(plain(calls[0].args.p_decision.generated_text.recommendations), []);
});

test('market assembler keeps the complete decision sentence rather than truncating at its first period', () => {
  const ai = input();
  assert.equal(ai.canonical_market_state.document.sections.executive_summary.text, decisionSentence);
  assert.equal(evaluateResearchQualityGate(ai.canonical_market_state.document).eligible, true);
  assert.equal(ai.canonical_market_state.status, 'READY');
});

test('actual builder freezes measured inputs and publishes the same canonical sentence it scored', () => {
  const ai = input(), payload = decision(ai);
  assert.equal(payload.decision_mode, 'market_only', JSON.stringify(payload.market_report_gate));
  assert.equal(canonicalMarketDocument(payload.generated_text).sections?.executive_summary?.text, decisionSentence);
  const projected = plain(project(ai, payload, 0));
  assert.equal(payload.generated_text.daily_sentence, decisionSentence);
  assert.deepEqual(payload.generated_text.content_evidence_quality, ai.content_evidence_quality);
  assert.equal(payload.generated_text.data_quality, ai.data_quality);
  assert.deepEqual(payload.generated_text.missing_sources, ai.missing_sources);
  assert.deepEqual(editorial(projected), editorial(ai));
  assert.equal(payload.content_score, editorial(projected).score);
  assert.deepEqual(payload.content_score_breakdown, editorial(projected).breakdown);
  assert.equal(projected.today_quote, decisionSentence);
  assert.equal(projected.free_summary.one_sentence, decisionSentence);
  assert.equal(projected.v8_daily_sentence.sentence, decisionSentence);
});

test('raw prose tampering cannot change builder or pre/post projection market editorial quality', () => {
  const ai = input(), before = decision(ai), expected = editorial(ai);
  ai.today_quote = '等待資料確認，注意風險。'; ai.daily_sentence = '市場瞬息萬變。';
  ai.free_summary = { one_sentence: '注意風險。' }; ai.v8_daily_sentence = { sentence: '等待資料確認。' };
  ai.member_research_note_v2 = { today_core_thesis: 'PRIVATE_QA_FAILED' };
  const after = decision(ai), projected = project(ai, after, 0);
  assert.equal(after.content_score, before.content_score);
  assert.deepEqual(after.content_score_breakdown, before.content_score_breakdown);
  assert.equal(after.generated_text.daily_sentence, before.generated_text.daily_sentence);
  assert.deepEqual(editorial(projected), expected);
  assert.deepEqual(after.generated_text.recommendations, []);
});

test('thin canonical executive sentence is blocked before the guarded write boundary despite healthy coverage', () => {
  const ai = input(thinSentence), payload = decision(ai);
  assert.equal(ai.canonical_market_state.status, 'READY');
  assert.ok(payload.content_score < 90);
  assert.equal(payload.decision_mode, 'blocked');
  expectPreWriteRejection(ai, payload);
});

test('forged stored editorial 100 cannot repair a thin canonical document', () => {
  const healthy = decision(input()), ai = input(thinSentence), payload = decision(ai);
  payload.content_score = 100; payload.content_grade = 'high_quality';
  payload.content_score_breakdown = healthy.content_score_breakdown;
  payload.reason_codes = []; payload.generic_content_flags = [];
  expectPreWriteRejection(ai, payload);
});

for (const [name, tamper] of [
  ['score', payload => { payload.content_score -= 1; }],
  ['breakdown', payload => { payload.content_score_breakdown.risk -= 1; }],
  ['reason codes', payload => { payload.reason_codes = ['UNREVIEWED_REASON']; }],
  ['generic flags', payload => { payload.generic_content_flags = ['UNREVIEWED_GENERIC']; }],
  ['content grade', payload => { payload.content_grade = 'degraded'; }],
  ['frozen sentence', payload => { payload.generated_text.daily_sentence = thinSentence; }],
  ['split canonical document', payload => { payload.generated_text.canonical_market_state.document.sections.core_thesis.confidence = 37; }],
  ['missing frozen measurements', payload => { delete payload.generated_text.content_evidence_quality; }],
]) {
  test(`actual projection guard rejects pre/post editorial mismatch: ${name}`, () => {
    const ai = input(), payload = decision(ai); tamper(payload);
    expectPreWriteRejection(ai, payload);
  });
}

test('qualified company evidence survives canonical editorial projection without weakening Premium', () => {
  const ai = input(), f = { report: { report_date: ai.research_master_v2.report_date, ai_strategy_json: ai },
    snapshot: { generated_text: { canonical_market_state: structuredClone(ai.canonical_market_state) } },
    member: { canonical_contract: { primary_symbols: [] } } };
  const qualify = isolatedFunction(read('tests/consolidationCurrentPayloadAuthority.test.mjs'), 'qualifyCurrentFixture', {
    isolatedFunction, read, assert, structuredClone, exports: {}, admitResearchRecommendations, assembleResearchMasterV2,
    validateResearchMasterV2, evaluatePremiumContentGate, evaluateMarketReportGate,
  });
  qualify(f);
  const payload = decision(ai), projected = plain(project(ai, payload, 0));
  assert.equal(payload.decision_mode, 'recommendations');
  assert.equal(payload.generated_text.recommendations.length, 1);
  assert.equal(payload.generated_text.recommendations[0].symbol, '2330');
  assert.equal(projected.today_beneficiary_stocks_v10.length, 1);
  assert.equal(projected.today_beneficiary_stocks_v10[0].symbol, '2330');
  assert.equal(evaluatePremiumContentGate(ai, 0).eligible, true);
  assert.deepEqual(editorial(projected), editorial(ai));
});

const consumerSource = read('tests/consolidationPublicationConsumers.test.mjs');
const publishedFixture = isolatedFunction(consumerSource, 'fixture', {
  isolatedFunction, read, assert, structuredClone, assembleCanonicalMarketResearch,
  buildCanonicalMarketState, canonicalMarketSourceRefs, evaluateMarketReportGate,
});
const database = isolatedFunction(consumerSource, 'database', { assert });
const readPublication = isolatedFunction(source, 'readGeneratedPublication', {
  fetchPublishedDeliveryEvidence, evaluatePublishedMarketDelivery, evaluateMarketReportGate, evaluatePremiumContentGate,
});
async function readPublished(f, trace = []) {
  return readPublication(database(f, trace), { reportId: f.report.id, aiJson: f.report.ai_strategy_json }, f.report.report_date, 0);
}

test('actual Generator publication readback uses frozen proof despite failed current market/private QA', async () => {
  const f = publishedFixture(), trace = [], ai = f.report.ai_strategy_json;
  ai.canonical_market_state = { status: 'INSUFFICIENT_EVIDENCE' };
  ai.content_evidence_quality = {}; ai.data_quality = 'partial'; ai.missing_sources = ['private_company_research'];
  ai.today_quote = '等待資料確認。'; ai.member_research_note_v2 = {}; ai.member_value_score = 0;
  const result = await readPublished(f, trace);
  assert.equal(result.marketGate.eligible, false);
  assert.equal(result.premiumGate.eligible, false);
  assert.equal(result.publication.eligible, true, JSON.stringify(result.publication.reason_codes));
  assert.equal(result.publication.projection.identity.revisionId, f.snapshot.id);
  assert.equal(result.publication.projection.analysisAvailable, true);
  assert.equal(result.snapshot.id, f.snapshot.id);
  assert.equal(result.publicationRun.id, f.publicationRun.id);
  assert.equal(trace.length, 3);
  assert.deepEqual(trace.map(row => row.table).sort(), ['decision_snapshots', 'member_content_revisions', 'pipeline_runs']);
});

for (const [name, mutate] of [
  ['missing actual run', f => { f.publicationRun = null; }],
  ['failed actual run', f => { f.publicationRun.status = 'FAILED'; }],
  ['mismatched snapshot', f => { f.snapshot.report_id = 'synthetic-other-report'; }],
  ['mismatched member', f => { f.member.decision_snapshot_id = 'synthetic-other-revision'; }],
]) {
  test(`actual Generator publication readback fails closed: ${name}`, async () => {
    const f = publishedFixture(); mutate(f);
    const result = await readPublished(f);
    assert.equal(result.publication.eligible, false);
    assert.equal(result.publication.projection.analysisAvailable, false);
  });
}

test('actual Generator readback rejects thin frozen editorial with stored 100 and a healthy current draft', async () => {
  const f = publishedFixture(), thin = input(thinSentence);
  f.snapshot.generated_text.canonical_market_state = thin.canonical_market_state;
  f.snapshot.generated_text.daily_sentence = thinSentence;
  f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
  assert.equal(f.snapshot.content_score, 100, 'The deliberately wrong old stored score is the counterexample');
  assert.equal(evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date).eligible, true);
  const result = await readPublished(f);
  assert.equal(result.publication.eligible, false);
  assert.ok(result.publication.reason_codes.includes('FROZEN_MARKET_EDITORIAL_UNVERIFIED'));
  assert.ok(result.publication.reason_codes.includes('FROZEN_MARKET_EDITORIAL_SCORE_MISMATCH'));
  assert.equal(result.publication.projection.analysisAvailable, false);
});
