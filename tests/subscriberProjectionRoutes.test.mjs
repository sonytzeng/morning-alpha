import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportProjection.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';

// This is a permanent source-boundary guard, not a substitute for the rendered
// State × Route × Viewport × real local server-role matrix.
const routes = [
  'src/pages/home/page.tsx', 'src/pages/report/TodayReport.tsx',
  'src/pages/reports/ReportDetail.tsx', 'src/pages/reports/ReportsCenter.tsx',
  'src/pages/war-room/WarRoom.tsx', 'src/pages/verification/page.tsx',
  'src/pages/performance/page.tsx', 'src/pages/opportunities/page.tsx',
  'src/pages/member-note/page.tsx',
];
const consumers = [...routes,
  'src/pages/report/components/CoreConclusionCard.tsx',
  'src/pages/report/components/ShareQuoteCard.tsx',
  'src/pages/report/components/RetailMistakeCard.tsx',
  'src/components/base/MarketStatusLight.tsx',
  'src/services/reportService.ts', 'src/services/resolveActiveReport.ts',
  'src/lib/morningAlphaReportAdapter.ts',
  'src/hooks/useAccountDashboard.ts',
  'src/pages/account/components/MorningHeroCard.tsx',
  'src/pages/account/components/TodayInfoCards.tsx',
];
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const parse = path => ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true,
  path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const visit = (node, fn) => { fn(node); ts.forEachChild(node, child => visit(child, fn)); };
const rawConfidence = new Set(['confidence_score', 'confidenceScore', 'decision_confidence']);

test('ALL_SUBSCRIBER_ROUTES_USE_CANONICAL_PROJECTION', () => {
  for (const path of consumers) {
    const file = parse(path);
    let hasImport = false, hasCall = false;
    visit(file, node => {
      if (ts.isImportDeclaration(node) && /subscriberReportProjection/.test(node.moduleSpecifier.text)
        && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        hasImport ||= node.importClause.namedBindings.elements.some(item => item.name.text === 'getSubscriberReportProjection');
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === 'getSubscriberReportProjection') hasCall = true;
    });
    assert.ok(hasImport && hasCall, `${path} must call the single subscriber projection, not a route-local replacement`);
  }
  assert.match(source('supabase/functions/get-report-payload/index.ts'), /getSubscriberReportProjection/);
  assert.match(source('shared/subscriber-state-contract.ts'), /src\/lib\/subscriberReportContract/);
  assert.match(source('src/lib/subscriberReportProjection.ts'), /from ['"]\.\/subscriberReportContract/);
});

test('NO_ROUTE_READS_RAW_CONFIDENCE_DIRECTLY', () => {
  const violations = [];
  for (const path of consumers) {
    const file = parse(path);
    visit(file, node => {
      let key = null;
      if (ts.isPropertyAccessExpression(node)) key = node.name.text;
      if (ts.isElementAccessExpression(node) && node.argumentExpression
        && ts.isStringLiteralLike(node.argumentExpression)) key = node.argumentExpression.text;
      // Catch aliases such as `const {confidence_score: score} = raw` as reads.
      if (ts.isBindingElement(node)) key = (node.propertyName || node.name).getText(file).replace(/^['"]|['"]$/g, '');
      if (key && rawConfidence.has(key)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        violations.push(`${path}:${line + 1}:${node.getText(file)}`);
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'confidence'
        && !/projection|presentation/i.test(node.expression.getText(file))) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        violations.push(`${path}:${line + 1}:unprojected ${node.getText(file)}`);
      }
    });
  }
  assert.deepEqual(violations, [], 'Raw confidence must be suppressed centrally, never interpreted by a subscriber consumer');
});

test('WAR_ROOM_CHECKPOINT_STATE_COMES_ONLY_FROM_BOUND_SUBSCRIBER_PROJECTION', () => {
  const code = source('src/pages/war-room/WarRoom.tsx');
  assert.doesNotMatch(code, /getRuntimeCheckpointState|intraday_sync_status|buildWarRoomTimeline/,
    'Raw checkpoint parsers cannot determine a subscriber headline, timeline or freshness');
  for (const field of ['projection.runtime.checkpoints', 'projection.runtime.confirmedIntradayEvidence',
    'projection.runtime.newIntradayEvidence', 'projection.closing.complete']) assert.ok(code.includes(field));
  assert.doesNotMatch(code, /todayCloseVerification\?\.data_quality/);
  const sharedTimeline = source('src/lib/runtimeDecisionTimeline.ts');
  assert.match(sharedTimeline, /getSubscriberReportProjection\(ai\)/);
  assert.match(sharedTimeline, /projection\.runtime\.checkpoints/);
  assert.doesNotMatch(sharedTimeline, /getRuntimeCheckpointState|intraday_sync_status|openingCompleted|isClosingVerificationComplete/,
    'All subscriber timelines must share the same bound proof, including Home, Today and Verification');
});

test('stale Today, Verification and War Room early returns retain canonical identity rather than adopting today', () => {
  for (const [path, condition] of [
    ['src/pages/report/TodayReport.tsx', '!isReportForToday'],
    ['src/pages/verification/page.tsx', 'isHistoricalFallback'],
    ['src/pages/war-room/WarRoom.tsx', 'projection.historical'],
  ]) {
    const file = parse(path);
    let checked = false;
    visit(file, node => {
      if (!ts.isIfStatement(node) || node.expression.getText(file) !== condition) return;
      const branch = node.thenStatement.getText(file);
      for (const expected of ['data-subscriber-state={projection.displayStatus}',
        'data-report-date={projection.identity.reportDate}',
        'data-revision-id={projection.identity.revisionId']) assert.ok(branch.includes(expected), `${path}: ${expected}`);
      if (path === 'src/pages/war-room/WarRoom.tsx') {
        assert.doesNotMatch(branch, /report\.report_date/,
          'Historical route and copy must use the projection identity, not a second raw row interpretation');
        assert.ok(branch.includes('to={`/reports/${projection.identity.reportDate}`}'));
        assert.match(branch, /不會把歷史時間軸冒充成今天進度/);
      }
      checked = true;
    });
    assert.equal(checked, true, `${path} must explicitly handle the previous-day report`);
  }
});

test('internal raw Voice QA mounts only after authenticated server entitlement; local preference cannot grant access', () => {
  const file = parse('src/pages/voice/VoicePage.tsx');
  const wrapper = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'VoicePage');
  assert.ok(wrapper);
  const code = wrapper.getText(file);
  assert.match(code, /await getCurrentEntitlement\(\)/);
  assert.match(code, /entitlement\.isLoggedIn && entitlement\.isAdmin/);
  assert.ok(code.indexOf('if (checking || !authorized)') < code.indexOf('return <InternalVoicePage'));
  assert.doesNotMatch(code, /localStorage|user_metadata|searchParams|generateVoiceScript\(|getTodayVoiceReport\(/);
  assert.match(code, /setAuthorized\(false\)/);
  assert.match(code, /onAuthStateChange/);
});

const partial = () => {
  const value = subscriberProjectionFixture('PARTIAL');
  value.confidence_score = 100;
  value.canonical_decision.confidence_score = 100;
  value.free_summary = { confidence_score: 100, title: '會員完整判讀' };
  return getSubscriberReportProjection(value, { todayDate: value.report_date });
};
test('PARTIAL_NEVER_SHOWS_RAW_CONFIDENCE', () => {
  const p = partial();
  assert.equal(p.confidence.value, null); assert.equal(p.confidence.suppressed, true);
  assert.doesNotMatch(p.confidence.label, /100/);
});
test('PARTIAL_NEVER_SHOWS_COMPLETE_INTERPRETATION', () => {
  const p = partial();
  assert.equal(p.analysisAvailable, false); assert.equal(p.displayStatus, 'PARTIAL');
  assert.match(p.title, /分析尚未完成／證據不足/);
  assert.doesNotMatch(p.title + p.statusLabel, /完整判讀|失效|已完成/);
  assert.equal(p.marketDecision.summary, null);
});
test('PARTIAL_NEVER_SHOWS_CLOSING_COMPLETE', () => {
  const p = partial();
  assert.equal(p.closing.complete, false); assert.equal(p.closing.result, null);
  assert.notEqual(p.closing.state, 'COMPLETE');
});
