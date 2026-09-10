import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import console from 'node:console';
import vm from 'node:vm';
import ts from 'typescript';
import * as projection from '../src/lib/subscriberReportProjection.ts';
import { createSubscriberState } from '../src/lib/subscriberReportContract.ts';
import { humanizePublicRuntimeText } from '../src/utils/publicRuntimeCopy.ts';

// Pure mapping regression: compile the actual service, never replace its logic.
// Network calls are forbidden. Auth/RLS behavior is covered by isolated E2E,
// not represented by these deliberately non-callable imports.
const forbiddenNetwork = async () => { throw new Error('NETWORK_FORBIDDEN_IN_MAPPING_TEST'); };
const commonImports = {
  '@/services/entitlementService': { callGetReportPayload: forbiddenNetwork, callGetReportHistory: forbiddenNetwork },
  '@/lib/subscriberReportProjection': projection,
};
function loadPureMappingModule(file, imports) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: output.exports,
    require(name) {
      if (!Object.hasOwn(imports, name)) throw new Error(`UNEXPECTED_MAPPING_IMPORT:${name}`);
      return imports[name];
    },
    console, Date, Intl,
  }, { filename: file });
  return output.exports;
}

// Execute the actual private route formatters without mounting a page or
// importing any data-fetching dependencies. AST extraction copies function
// declarations verbatim; an undeclared dependency fails the test.
function loadRouteFormatters(file, names, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement)
    && statement.name && names.includes(statement.name.text));
  assert.equal(functions.length, names.length, 'every tested formatter must exist in the real source');
  const compiled = ts.transpileModule(functions.map(statement => statement.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(`${compiled}\n({${names.join(',')}})`, globals, { filename: file });
}
const service = loadPureMappingModule('../src/services/reportService.ts', commonImports);
const adapter = loadPureMappingModule('../src/lib/morningAlphaReportAdapter.ts', {
  ...commonImports,
  '@/utils/tradingDay': { formatTaipeiDate: () => '2026-09-09', isTaipeiWeekendToday: () => false },
});

const DAY = '2026-09-08', REVISION = 'synthetic-mapping-revision', GENERATED = `${DAY}T00:30:00.000Z`;
const legacy = () => ({
  report_date: DAY, today_date: DAY, revision_id: REVISION, generated_at: GENERATED, is_trading_day: true,
  canonical_decision: { id: REVISION, report_date: DAY, generated_at: GENERATED, status: 'READY',
    action: 'WAIT', market_bias: '偏多', daily_sentence: '合成已發布市場報告', confidence_score: 73 },
  content_publish_gate: { overall_status: 'eligible' }, report_status: 'READY',
  recommendation_gate: { status: 'BLOCKED', eligible: false },
  confidence_score: 100, free_summary: { confidence_score: 100 },
});
const wire = (overrides = {}) => createSubscriberState({
  report_date: DAY, revision_id: REVISION, generated_at: GENERATED,
  publicationVerified: true, marketEvidenceReady: true, analysisStatus: 'READY', isTradingDay: true,
  confidenceValue: 73, recommendationGate: { status: 'BLOCKED', eligible: false },
  closing: {}, now: `${DAY}T03:00:00.000Z`, ...overrides,
});
const row = (payload) => ({ id: 'synthetic-database-row-id', report_date: DAY, revision_id: REVISION,
  generated_at: GENERATED, created_at: GENERATED, confidence_score: 100, market_bias: '偏多', ai_strategy_json: payload });

function assertRoundtrip(payload, expectedConfidence) {
  const input = row(payload);
  const once = service.mapRowToReport(input), twice = service.mapRowToReport(once);
  for (const mapped of [once, twice]) {
    assert.equal(mapped.confidence_score, expectedConfidence);
    assert.equal(mapped.id, REVISION);
    assert.equal(mapped.revision_id, REVISION);
    assert.equal(mapped.report_date, DAY);
    assert.equal(mapped.generated_at, GENERATED);
    assert.equal(Object.hasOwn(mapped, 'subscriber_state'), Object.hasOwn(payload, 'subscriber_state'));
    assert.deepEqual(mapped.canonical_decision, payload.canonical_decision);
    assert.deepEqual(mapped.content_publish_gate, payload.content_publish_gate);
    assert.deepEqual(mapped.recommendation_gate, payload.recommendation_gate);
    assert.equal(mapped.focus_stock_json, null);
  }
  const normalized = adapter.normalizeMorningAlphaReport(input);
  assert.equal(normalized.confidenceScore, expectedConfidence);
  assert.equal(normalized.publicPageStatus.displayConfidence, expectedConfidence);
  assert.equal(normalized.reportId, REVISION);
  assert.equal(normalized.reportDate, DAY);
  assert.equal(normalized.generatedAt, GENERATED);
  assert.equal(normalized.rawReport, input, 'internal raw record remains available, never presentation authority');
  return { once, twice, normalized };
}

test('service/adapter preserve a READY legacy canonical revision without adding an invalid subscriber_state key', () => {
  const result = assertRoundtrip(legacy(), 73);
  assert.equal(result.normalized.canPublish, true);
  assert.equal(result.normalized.oneSentence, '合成已發布市場報告');
  assert.equal(result.normalized.freeSummary.confidence_score, 73, 'free summary 100 cannot override canonical 73');
});

test('PARTIAL raw 100 remains suppressed through repeated service mapping and normalized public summary', () => {
  const payload = legacy();
  payload.canonical_decision.status = 'PARTIAL';
  payload.content_publish_gate.overall_status = 'blocked';
  const result = assertRoundtrip(payload, null);
  assert.equal(result.normalized.canPublish, false);
  assert.equal(result.normalized.freeSummary, null);
  assert.match(result.normalized.oneSentence, /分析尚未完成／證據不足/);
  assert.equal(projection.getSubscriberReportProjection(result.twice).closing.complete, false);
});

test('versioned READY confidence remains authoritative over raw row and nested QA confidence', () => {
  assertRoundtrip({ ...legacy(), subscriber_state: wire() }, 73);
});

test('versioned PARTIAL cannot regain confidence or publication by being mapped to a Report twice', () => {
  const payload = { ...legacy(), subscriber_state: wire({ publicationVerified: false, analysisStatus: 'PARTIAL' }) };
  const result = assertRoundtrip(payload, null);
  assert.equal(result.normalized.subscriberProjection.analysisAvailable, false);
  assert.equal(result.normalized.subscriberProjection.recommendation.available, false);
});

test('explicitly unavailable versioned confidence cannot fall back to 100 from legacy fields', () => {
  assertRoundtrip({ ...legacy(), subscriber_state: wire({ confidenceValue: null }) }, null);
});

test('missing canonical legacy confidence cannot fall back to raw or free-summary 100', () => {
  for (const absent of [null, undefined]) {
    const payload = legacy();
    payload.canonical_decision.confidence_score = absent;
    assertRoundtrip(payload, null);
  }
});

test('a report row identifier or report date cannot replace missing canonical revision evidence', () => {
  const payload = legacy();
  delete payload.revision_id;
  delete payload.canonical_decision.id;
  const input = row(payload);
  delete input.revision_id;
  const result = service.mapRowToReport(input);
  assert.equal(result.id, input.id, 'existing database row id may be retained for identity only');
  assert.equal(result.revision_id, null);
  assert.equal(result.confidence_score, null);
  assert.equal(projection.getSubscriberReportProjection(result).analysisAvailable, false);
  assert.equal(result.id.startsWith('server-trimmed:'), false);
});

test('report history card and dialog never replace canonical closing outcome with a date-only review lookup', () => {
  const source = readFileSync(new URL('../src/pages/reports/ReportsCenter.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getCloseMarketReviewsByDates|verificationMap|cmr\.verification_label/);
  assert.match(source, /projectedClosingLabel\(projection\.closing\)/);
  assert.match(source, /projectedClosingLabel\(selectedProjection\.closing\)/);
  assert.match(source, /if \(!closing\.complete\) return undefined/);
  assert.match(source, /outcomeLabels\[closing\.outcome\]/);
});

test('subscriber routes use the canonical closing outcome even when legacy outcome aliases contradict it', () => {
  const payload = legacy();
  payload.closing_verification_v2 = {
    status: 'completed', data_status: 'complete', report_date: DAY,
    opening_decision_snapshot_id: REVISION, verified_at: `${DAY}T06:30:00.000Z`,
    actual_taiex_change: 1, actual_2330_close: { change_percent: 1 },
    actual_txf_close: { change_percent: 1 }, missing_data: [],
    prediction_result: 'miss', hit_or_miss: 'hit', verdict_label: '方向一致',
  };
  const canonical = projection.getSubscriberReportProjection(row(payload));
  assert.equal(canonical.closing.complete, true);
  assert.equal(canonical.closing.outcome, 'miss');
  assert.equal(canonical.marketDecision.runtimeFailure, true);
  for (const [file, expected] of [
    ['../src/pages/reports/ReportDetail.tsx', /closingOutcomeLabel\(projection\.closing\.outcome\)/],
    ['../src/pages/home/page.tsx', /closingResultLabel\(\s*projection\.closing\.outcome \|\| '',\s*projection\.closing\.state/],
    ['../src/pages/member-note/page.tsx', /humanStatus\(projection\.closing\.outcome\)/],
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, expected);
    assert.doesNotMatch(source, /closing(?:Record|VerificationRecord)?\.hit_or_miss/);
  }
});

test('every allowed canonical closing outcome is rendered consistently by actual Home, Detail and Verification formatters', () => {
  const home = loadRouteFormatters('../src/pages/home/page.tsx', ['closingResultLabel']);
  const detail = loadRouteFormatters('../src/pages/reports/ReportDetail.tsx', ['closingOutcomeLabel']);
  const verification = loadRouteFormatters('../src/pages/verification/page.tsx', [
    'asRecord', 'firstText', 'publicVerificationText', 'valueSummary', 'directionFromChange', 'buildClosingView',
  ], { humanizePublicRuntimeText });
  const expectations = {
    hit: ['命中', '方向符合', 'complete', '完整成立'],
    correct: ['命中', '方向符合', 'complete', '完整成立'],
    partial: ['部分命中', '部分符合', 'partial', '部分成立'],
    mixed: ['部分命中', '部分符合', 'partial', '部分成立'],
    miss: ['未命中', '方向不符', 'failed', '未成立'],
    wrong: ['未命中', '方向不符', 'failed', '未成立'],
    neutral: ['中性結果，收盤驗證已完成', '中性結果，收盤驗證已完成', 'neutral', '中性結果，收盤驗證已完成'],
  };
  for (const [outcome, expected] of Object.entries(expectations)) {
    const payload = legacy();
    payload.closing_verification_v2 = {
      status: 'completed', data_status: 'complete', report_date: DAY,
      opening_decision_snapshot_id: REVISION, verified_at: `${DAY}T06:30:00.000Z`,
      actual_taiex_change: 0, actual_2330_close: { change_percent: 0 },
      actual_txf_close: { change_percent: 0 }, missing_data: [], prediction_result: outcome,
    };
    const canonical = projection.getSubscriberReportProjection(row(payload));
    assert.equal(canonical.closing.complete, true);
    assert.equal(home.closingResultLabel(canonical.closing.outcome, canonical.closing.state), expected[0]);
    assert.equal(detail.closingOutcomeLabel(canonical.closing.outcome), expected[1]);
    const view = verification.buildClosingView(canonical);
    assert.equal(view.complete, true);
    assert.equal(view.outcome, expected[2]);
    assert.equal(view.outcomeLabel, expected[3]);
    assert.doesNotMatch(view.outcomeLabel, /等待|尚未|不足/);
    if (outcome === 'neutral') assert.match(view.statusNote, /不計為命中或失準/);
    payload.closing_verification_v2.status = 'NOT_DUE';
    const notDue = verification.buildClosingView(projection.getSubscriberReportProjection(row(payload)));
    assert.equal(notDue.complete, false);
    assert.equal(notDue.outcome, 'waiting');
  }
});

test('neutral closing remains excluded from hit/miss performance metrics', () => {
  const performance = loadRouteFormatters('../src/pages/performance/page.tsx', ['text', 'normalizeOutcome']);
  assert.equal(performance.normalizeOutcome('neutral'), 'insufficient');
  assert.equal(performance.normalizeOutcome('hit'), 'complete');
  assert.equal(performance.normalizeOutcome('miss'), 'failed');
});
