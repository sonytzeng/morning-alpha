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
