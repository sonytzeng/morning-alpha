import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportProjection.ts';
import { getSubscriberOpportunityList } from '../src/lib/subscriberOpportunities.ts';
import { normalizeDecisionSymbol } from '../src/features/decision-v1/engine.ts';
import { renderSafeText } from '../src/utils/renderSafe.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const hookSource = read('src/hooks/useAccountDashboard.ts');
const day = '2026-09-09';
const helperDependencies = { getSubscriberReportProjection, isTaipeiToday: () => day, exports: {} };
for (const name of ['asRecord', 'asRecords', 'firstText', 'latestTimestamp', 'getAccountIntradayView', 'computeStreakFromReports', 'formatTaipeiTimeShort']) {
  helperDependencies[name] = isolatedFunction(hookSource, name, helperDependencies);
}
const fixture = name => {
  const body = subscriberProjectionFixture(name, { todayDate: day });
  return { ...body, id: body.revision_id, created_at: body.generated_at, ai_strategy_json: body };
};

async function loadDashboard(report) {
  const requests = [];
  const load = isolatedFunction(hookSource, 'loadAccountDashboard', {
    ...helperDependencies,
    getTodayReport: async () => { requests.push('today'); return report; },
    getLatestReports: async limit => { requests.push(`history:${limit}`); return report ? [report] : []; },
    isDateTaipeiToday: value => typeof value === 'string' && value.startsWith(day),
  });
  const data = await load();
  assert.deepEqual(requests, ['today', 'history:30']);
  assert.equal(data.error, null);
  return data;
}

function loadComponent(path, exportedName = 'default') {
  const module = { exports: {} };
  const compiled = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const dependencies = {
    '@/utils/renderSafe': { renderSafeText },
    '@/lib/subscriberReportProjection': { getSubscriberReportProjection },
    '@/services/marketSourceHealthService': { isTaipeiToday: () => day },
    '@/hooks/useAccountDashboard': { formatTaipeiTimeShort: helperDependencies.formatTaipeiTimeShort,
      getAccountIntradayView: helperDependencies.getAccountIntradayView },
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, require: name => {
    if (name in dependencies) return dependencies[name];
    if (['react/jsx-runtime', 'react-router-dom'].includes(name)) return require(name);
    throw new Error(`UNAPPROVED_COMPONENT_TEST_IMPORT:${name}`);
  } }, { filename: path });
  return module.exports[exportedName];
}
const Hero = loadComponent('src/pages/account/components/MorningHeroCard.tsx');
const Info = loadComponent('src/pages/account/components/TodayInfoCards.tsx');
const render = (Component, data, overrides = {}) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(Component, { ...data, isWeekend: false, hasAnyReport: true, fallbackReportDate: data.todayReport?.report_date ?? null, ...overrides })));

test('account PARTIAL cannot become a successful report or streak even with raw confidence 100 and client boolean true', async () => {
  const report = fixture('PARTIAL');
  report.confidence_score = 100;
  const data = await loadDashboard(report);
  assert.equal(data.hasTodayReport, false);
  assert.equal(data.streak, 0);
  assert.equal(data.hasIntradayData, false);
  assert.equal(data.marketDataLatestAt, null);
  for (const Component of [Hero, Info]) {
    const html = render(Component, data, { hasTodayReport: true });
    assert.match(html, /分析尚未完成／證據不足/);
    assert.match(html, /data-report-date="2026-09-09"/);
    assert.doesNotMatch(html, /100\s*\/\s*100|\b0\s*\/\s*100|完整判斷|最近交易日報告已產生|>\s*正常\s*</);
  }
});

test('account READY market survives recommendation BLOCKED; missing confidence remains unavailable', async () => {
  for (const state of ['MARKET_READY_RECOMMENDATION_BLOCKED', 'MISSING_CONFIDENCE']) {
    const data = await loadDashboard(fixture(state));
    assert.equal(data.hasTodayReport, true);
    assert.equal(data.streak, 1);
    for (const Component of [Hero, Info]) {
      const html = render(Component, data);
      assert.doesNotMatch(html, /100\s*\/\s*100|\b0\s*\/\s*100/);
      if (state === 'MISSING_CONFIDENCE') assert.match(html, /(?:資料|證據)不足/);
      else assert.match(html, /73\s*\/\s*100/);
    }
  }
});

test('account historical fallback retains its date and cannot announce a current report', async () => {
  const data = await loadDashboard(fixture('STALE'));
  assert.equal(data.hasTodayReport, false);
  assert.equal(data.streak, 0);
  const html = render(Hero, data, { hasTodayReport: true });
  assert.match(html, /2026-09-08/);
  assert.doesNotMatch(html, /查看今日完整判斷|100\s*\/\s*100/);
  assert.match(read('src/pages/account/Account.tsx'), /<MembershipStatusCard\s*\/>/);
  assert.match(read('src/pages/account/Account.tsx'), /<MorningReminderCard\s*\/>/);
});

function accountCheckpointFixture(change = {}) {
  const report = fixture('READY');
  const ai = report.ai_strategy_json;
  ai.opening_radar = { report_date: day, captured_at: `${day}T09:31:00+08:00`,
    radar_status: '劇本成立', market_bias: '偏多' };
  const checkpoint = { status: 'completed', report_date: day, revision_id: report.revision_id,
    completed_at: `${day}T09:31:00+08:00`, evidence: { source: 'isolated-test-only' }, ...change };
  ai.intraday_sync_status.windows['0930'] = checkpoint;
  report.intraday_sync_status = ai.intraday_sync_status;
  return report;
}

test('account never turns raw radar text, stale identity or empty evidence into a completed checkpoint', async () => {
  for (const change of [
    { revision_id: 'previous-revision' }, { revision_id: undefined },
    { report_date: '2026-09-08' }, { evidence: null }, { evidence: [{}] },
    { completed_at: undefined }, { completed_at: `${day}T09:20:00+08:00` },
  ]) {
    const data = await loadDashboard(accountCheckpointFixture(change));
    assert.equal(data.hasTodayReport, true);
    assert.equal(data.hasIntradayData, false);
    assert.equal(data.isIntradayToday, false);
    assert.equal(data.intradayLatestAt, null);
    assert.equal(data.intradayRadarStatus, null);
    const html = render(Info, data, { hasIntradayData: true, isIntradayToday: true,
      intradayRadarStatus: '劇本成立', intradayCheckDate: day, intradayLatestAt: `${day}T09:31:00+08:00` });
    assert.match(html, /尚未取得符合本報告版本的開盤驗證/);
    assert.doesNotMatch(html, /劇本成立|開盤驗證已完成|開盤驗證回報失敗/);
  }
  const report = accountCheckpointFixture();
  delete report.ai_strategy_json.intraday_sync_status.windows['0930'];
  assert.equal((await loadDashboard(report)).hasIntradayData, false);
});

test('account preserves valid completed and failed 09:30 receipts without reading raw status labels', async () => {
  for (const failed of [false, true]) {
    const report = accountCheckpointFixture(failed
      ? { status: 'failed', failed_at: `${day}T09:31:00+08:00` } : {});
    const data = await loadDashboard(report);
    assert.equal(data.hasTodayReport, true);
    assert.equal(data.hasIntradayData, true);
    assert.equal(data.isIntradayToday, true);
    assert.equal(data.intradayLatestAt, `${day}T09:31:00+08:00`);
    assert.equal(data.intradayCheckDate, day);
    const html = render(Info, data);
    assert.match(html, failed ? /開盤驗證回報失敗/ : /開盤驗證已完成/);
    assert.doesNotMatch(html, /劇本成立/);
  }
});

test('account nontrading 09:30 checkpoint remains not applicable even if raw radar claims completion', async () => {
  const report = accountCheckpointFixture();
  report.is_trading_day = false;
  report.market_status = 'CLOSED';
  report.ai_strategy_json.is_trading_day = false;
  report.ai_strategy_json.market_status = 'CLOSED';
  const data = await loadDashboard(report);
  assert.equal(data.hasIntradayData, false);
  const html = render(Info, data, { isWeekend: true });
  assert.match(html, /本節點不適用，等待下一個交易日/);
  assert.doesNotMatch(html, /劇本成立|開盤驗證已完成/);
});

test('account checkpoint consumers cannot read raw radar status as a subscriber decision', () => {
  assert.match(hookSource, /Object\.assign\(result, getAccountIntradayView\(projection\)\)/);
  assert.doesNotMatch(hookSource, /openingRadar\.(?:radar_status|data_status)|payload\.opening_radar_status/);
  const info = read('src/pages/account/components/TodayInfoCards.tsx');
  assert.match(info, /getAccountIntradayView\(projection\)/);
  assert.doesNotMatch(info, /intradayRadarStatus\s*===/);
});

test('canonical qualified observations preserve identity and narrative without exposing unbound per-item confidence', () => {
  const path = 'src/components/v11/V11ObservationSection.tsx';
  const report = fixture('MISSING_CONFIDENCE');
  report.ai_strategy_json.canonical_decision.recommendations[0].decision_confidence = 100;
  const projection = getSubscriberReportProjection(report, { todayDate: day });
  assert.equal(projection.analysisAvailable, true);
  assert.equal(projection.recommendation.available, true);
  assert.equal(projection.confidence.value, null);
  const items = loadComponent(path, 'mapV11ObservationItems')(projection.recommendation.items);
  assert.equal(items.length, 1);
  assert.equal(items[0].symbol, '2330');
  assert.match(items[0].narrative, /合成隔離證據/);
  assert.equal(items[0].decisionConfidence, null);
  const Component = loadComponent(path);
  for (const rows of [items, items.map(item => ({ ...item, decisionConfidence: 100 }))]) {
    const html = renderToStaticMarkup(React.createElement(Component, { items: rows }));
    assert.match(html, /2330/);
    assert.match(html, /合成隔離證據/);
    assert.doesNotMatch(html, /信心\s*100|100\s*\/\s*100/);
  }
});

test('subscriber semantic consumers cannot reintroduce raw checkpoint or detached closing interpreters', () => {
  const paths = [
    'src/pages/home/page.tsx', 'src/pages/report/TodayReport.tsx',
    'src/pages/reports/ReportsCenter.tsx', 'src/pages/reports/ReportDetail.tsx',
    'src/pages/war-room/WarRoom.tsx', 'src/pages/verification/page.tsx',
    'src/pages/performance/page.tsx', 'src/pages/opportunities/page.tsx',
    'src/pages/member-note/page.tsx', 'src/hooks/useAccountDashboard.ts',
    'src/pages/account/components/MorningHeroCard.tsx', 'src/pages/account/components/TodayInfoCards.tsx',
    'src/lib/canonicalNarrative.ts', 'src/lib/decisionPresentation.ts', 'src/lib/runtimeDecisionTimeline.ts',
    'src/components/v11/V11ObservationSection.tsx', 'src/components/base/MarketStatusLight.tsx',
  ];
  const forbidden = new Set(['getRuntimeCheckpointState', 'buildDecisionRuntimeEvidence',
    'resolveClosingVerificationState', 'isClosingVerificationComplete']);
  for (const path of paths) {
    const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const violations = [];
    const visit = node => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        const values = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter(item => !item.isTypeOnly) : [];
        const typeOnly = bindings && ts.isNamedImports(bindings) && !node.importClause?.name && values.length === 0;
        if (!typeOnly && /warRoomPresentationMapper/.test(node.moduleSpecifier.text)) violations.push('legacy mapper value import');
        for (const item of values) if (forbidden.has((item.propertyName || item.name).text)) violations.push(item.getText(file));
        if (bindings && ts.isNamespaceImport(bindings) && /decisionEvidence|closingVerificationState/.test(node.moduleSpecifier.text)) {
          violations.push('raw interpreter namespace import');
        }
      }
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
        if (forbidden.has(name)) violations.push(name);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    assert.deepEqual(violations, [], `${path} must get subscriber runtime semantics from the canonical projection`);
  }
});

test('observation component has no raw confidence reads, while its callers use canonical recommendation items', () => {
  const path = 'src/components/v11/V11ObservationSection.tsx';
  const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const forbidden = new Set(['confidence_score', 'confidenceScore', 'decision_confidence']);
  const reads = [];
  const visit = node => {
    const key = ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
    if (key && forbidden.has(key)) reads.push(key);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(reads, []);
  assert.match(read('src/pages/reports/ReportsCenter.tsx'), /mapV11ObservationItems\(selectedProjection\.recommendation\.items/);
  assert.match(read('src/pages/reports/ReportDetail.tsx'), /mapV11ObservationItems\(projection\.recommendation\.items/);
});

function evaluateRouteConst(path, name, dependencies) {
  const source = read(path), file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) initializer = node.initializer?.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(initializer, `${path}:${name}`);
  const js = ts.transpileModule(`const result = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`${js}\nresult`, dependencies);
}

test('Today legacy and Decision V1 candidates are restricted to canonical normalized symbols before top-three selection', () => {
  const path = 'src/pages/report/TodayReport.tsx';
  const projection = getSubscriberReportProjection(subscriberProjectionFixture('READY'));
  const dependencies = { projection, asObj: value => value, normalizeDecisionSymbol };
  const allowedSymbols = evaluateRouteConst(path, 'allowedSymbols', dependencies);
  const candidates = [
    { symbol: '2317', oneLineReason: 'unpublished' },
    { symbol: 'TWSE:2330', oneLineReason: 'canonical alias' },
    { symbol: '2330.TW', oneLineReason: 'canonical alias' },
  ];
  const legacy = evaluateRouteConst(path, 'publishedOpportunities', { allowedSymbols, normalizeDecisionSymbol, presentation: { opportunities: candidates } });
  const decision = evaluateRouteConst(path, 'productDecision', { allowedSymbols, normalizeDecisionSymbol,
    publishedDecision: { action: 'ACTIVE_WATCH', stock_opportunities: candidates } });
  assert.deepEqual(Array.from(legacy, item => normalizeDecisionSymbol(item.symbol)), ['2330', '2330']);
  assert.deepEqual(Array.from(decision.stock_opportunities, item => normalizeDecisionSymbol(item.symbol)), ['2330', '2330']);
  const source = read(path);
  assert.match(source, /focusStocks = \(recommendationAccess && !hasDecisionV1Input \? publishedOpportunities/);
  assert.match(source, /: publishedOpportunities\s*\.filter/);
});

test('Opportunities headline counts only canonical stocks that survive rendering completeness checks', () => {
  const path = 'src/pages/opportunities/page.tsx';
  const report = fixture('READY');
  report.ai_strategy_json.today_beneficiary_stocks_v10 = [{ symbol: '2317', name: 'unselected preview' }];
  const canonicalStocks = getSubscriberOpportunityList(report);
  assert.deepEqual(canonicalStocks.map(stock => stock.symbol), ['2330']);
  const completeEnoughStocks = canonicalStocks.filter(stock => stock.oneLineReason && stock.confirmation && stock.invalidation)
    .map(stock => ({ stock }));
  const visibleStrongCount = evaluateRouteConst(path, 'visibleStrongCount', {
    completeEnoughStocks,
  });
  assert.equal(visibleStrongCount, 1);
  assert.match(read(path), /今天有 \$\{visibleStrongCount\} 檔通過推薦篩選/);
  assert.match(read(path), /presentedStocks = getSubscriberOpportunityList\(ds\.rawRow, projection\)/);
  report.ai_strategy_json.premium_content_status = 'blocked';
  assert.deepEqual(getSubscriberOpportunityList(report), [], 'canonical qualification cannot bypass Premium');
  assert.doesNotMatch(read(path), /今天有 \$\{strongOpportunityStocks\.length\}/);
});
