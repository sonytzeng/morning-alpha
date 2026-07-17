import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const routeConfig = read('src/router/config.tsx');
const navbar = read('src/components/feature/Navbar.tsx');
const footer = read('src/components/feature/Footer.tsx');
const home = read('src/pages/home/page.tsx');
const today = read('src/pages/report/TodayReport.tsx');

const publicSourceFiles = [
  'src/pages/home/page.tsx',
  'src/pages/report/TodayReport.tsx',
  'src/pages/opportunities/page.tsx',
  'src/pages/war-room/WarRoom.tsx',
  'src/pages/member-note/page.tsx',
  'src/pages/performance/page.tsx',
  'src/pages/reports/ReportsCenter.tsx',
  'src/pages/reports/ReportDetail.tsx',
  'src/pages/account/Account.tsx',
  'src/pages/verification/page.tsx',
  'src/pages/faq/page.tsx',
  'src/pages/terms/page.tsx',
  'src/pages/privacy/page.tsx',
  'src/pages/contact/page.tsx',
  'src/pages/NotFound.tsx',
  'src/components/feature/Navbar.tsx',
  'src/components/feature/Footer.tsx',
];

const publicSources = publicSourceFiles.map((path) => ({ path, source: read(path) }));

const expectedRoutes = [
  '/',
  '/report/today',
  '/opportunities',
  '/member-note',
  '/performance',
  '/reports',
  '/reports/:reportDate',
  '/war-room',
  '/verification',
  '/account',
  '/faq',
  '/terms',
  '/privacy',
  '/contact',
];

test('public route inventory is registered', () => {
  for (const route of expectedRoutes) {
    assert.match(routeConfig, new RegExp(`path:\\s*["']${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`), `missing route: ${route}`);
  }
  assert.match(routeConfig, /path:\s*["']\*["']/, 'missing wildcard 404 route');
});

test('public navigation destinations exist', () => {
  const registered = new Set(expectedRoutes.filter((route) => !route.includes(':')));
  const sources = `${navbar}\n${footer}`;
  const destinations = [...sources.matchAll(/\bto=["'](\/[^"']*)["']/g)].map((match) => match[1]);
  assert.ok(destinations.length > 0, 'navigation inventory must not be empty');
  for (const destination of destinations) {
    assert.ok(registered.has(destination), `navigation destination is not registered: ${destination}`);
  }
});

test('public source has no internal diagnostics destination', () => {
  for (const { path, source } of publicSources) {
    assert.doesNotMatch(source, /\b(?:to|href)=["']\/(?:adr|admin)(?:\/|["'])/i, `${path} links to an internal route`);
  }
  assert.doesNotMatch(home, /資料真相檢查|系統診斷|Active Report|publish_ready|report_id|Edge Function|Cron/i);
});

test('rendered public copy does not expose implementation names', () => {
  const implementationNamePattern = /opening_market_radar|intraday_checks|market_data|market_news|publish_ready|report_id|Edge Function|RPC|Supabase/i;
  for (const { path, source } of publicSources) {
    const sourceWithoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const staticTextNodes = [...sourceWithoutComments.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]);
    for (const textNode of staticTextNodes) {
      assert.doesNotMatch(textNode, implementationNamePattern, `${path} renders an implementation detail`);
    }
  }
});

test('public error states do not render raw exception messages', () => {
  const guardedSources = [
    ...publicSources,
    { path: 'src/hooks/useHomeDashboard.ts', source: read('src/hooks/useHomeDashboard.ts') },
    { path: 'src/hooks/useLatestReport.ts', source: read('src/hooks/useLatestReport.ts') },
    { path: 'src/hooks/useAccountDashboard.ts', source: read('src/hooks/useAccountDashboard.ts') },
  ];
  for (const { path, source } of guardedSources) {
    assert.doesNotMatch(source, /setError\([^\n]*(?:err|error)\.message/i, `${path} forwards a raw exception to public UI`);
  }
  assert.doesNotMatch(read('src/components/base/ErrorBoundary.tsx'), /\{this\.state\.errorMessage\}/);
});

test('public date fallbacks use Asia/Taipei helpers', () => {
  const guardedFiles = [
    'src/hooks/useStreak.ts',
    'src/hooks/useShareQuote.ts',
    'src/services/premiumReportEngine.ts',
    'src/services/memberNotebookEngine.ts',
    'src/services/closeMarketReviewService.ts',
    'src/pages/report/components/ShareQuoteCard.tsx',
  ];
  for (const path of guardedFiles) {
    assert.doesNotMatch(read(path), /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/, `${path} derives a market date from UTC`);
  }
});

test('empty report payload cannot create a blank report destination', () => {
  const reportService = read('src/services/reportService.ts');
  assert.match(reportService, /if \(!response\.report_date \|\| !response\.payload\) return null;/);
  assert.match(reportService, /if \(!response\.report_date \|\| !response\.payload\) return \[\];/);
});

test('mobile menu and 404 provide release-safe interaction', () => {
  assert.match(navbar, /aria-expanded=\{mobileOpen\}/);
  assert.match(navbar, /aria-controls="morning-alpha-mobile-menu"/);
  assert.match(navbar, /event\.key === 'Escape'/);
  const notFound = read('src/pages/NotFound.tsx');
  assert.match(notFound, /找不到這個頁面/);
  assert.doesNotMatch(notFound, /has not been generated|Tell me more|location\.pathname/i);
});

test('runtime timelines reconcile completed later checkpoints', () => {
  const runtimeTimeline = read('src/lib/runtimeDecisionTimeline.ts');
  const warRoomMapper = read('src/pages/war-room/warRoomPresentationMapper.ts');
  assert.match(runtimeTimeline, /node\.status === 'pending' && index < lastCompletedIndex/);
  assert.match(warRoomMapper, /reconcileRuntimeTimeline\(nodes\)/);
  assert.match(runtimeTimeline, /scheduledMinutes <= taipeiMinutes/);
  assert.doesNotMatch(runtimeTimeline, /待 Runtime|Runtime checkpoint/);
});

test('home public decision copy is user-facing and internally consistent', () => {
  for (const label of ['AI Confidence', 'Risk Level', 'Suggested Exposure', 'Last Update', 'Morning Brief', 'AI Final Decision', 'Observation', 'Reason', 'Impact']) {
    assert.doesNotMatch(home, new RegExp(`>${label}<`, 'i'), `home renders untranslated label: ${label}`);
  }
  assert.match(home, /盤前暫不建立部位/);
  assert.match(home, /等待開盤驗證/);
  assert.doesNotMatch(home, /暫不建立交易判斷/);
  assert.match(home, /mistakeCards\.length === 1 \? ' is-single'/);
});

test('today report keeps runtime state and technical copy out of the public UI', () => {
  for (const label of ['Data unavailable', 'SCENARIO VALIDATION', 'FOCUS STOCKS', 'DECISION TIMELINE', 'NEXT JOURNEY', 'War Room', '待 Runtime']) {
    assert.doesNotMatch(today, new RegExp(label, 'i'), `today report renders untranslated label: ${label}`);
  }
  assert.doesNotMatch(today, /劇本驗證 Checklist/);
  assert.match(today, /selectNextRuntimeTimelineNode\(runtimeTimeline\)/);
  assert.match(today, /publicTodayText/);
  assert.match(today, /marketStatusLabel=\{decisionCopy\.headline\}/);
});

test('today report cards show complete text and adapt to the actual item count', () => {
  const css = read('src/index.css');
  const checklistRule = css.match(/\.ma-today-page \.ma-today-v3-checklist p \{([\s\S]*?)\n  \}/)?.[1] || '';
  const stockRule = css.match(/\.ma-today-page \.ma-today-v3-stock-card > p \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(checklistRule, 'missing scoped today validation detail rule');
  assert.ok(stockRule, 'missing scoped today stock reason rule');
  assert.doesNotMatch(checklistRule, /line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
  assert.doesNotMatch(stockRule, /line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
  assert.match(css, /\.ma-today-page \.ma-today-v3-checklist\.is-single/);
  assert.match(css, /\.ma-today-page \.ma-today-v3-stock-grid\.is-count-2/);
});

test('war room observation details are not line clamped', () => {
  const css = read('src/index.css');
  const rule = css.match(/\.ma-war-room-page \.ma-phase2-observation-card dd \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(rule, 'missing scoped observation detail rule');
  assert.doesNotMatch(rule, /line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
});

test('home uses canonical server payload and labels historical fallback', () => {
  const resolver = read('src/services/resolveActiveReport.ts');
  assert.match(resolver, /callGetReportPayload/);
  assert.doesNotMatch(resolver, /from ['"]@\/lib\/supabase['"]/);
  assert.match(home, /hasHistoricalReport \? 'not-today' : 'no-report'/);
  assert.match(home, /to=\{`\/reports\/\$\{displayReportDate\}`\}/);
});
