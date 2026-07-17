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
const opportunities = read('src/pages/opportunities/page.tsx');
const warRoom = read('src/pages/war-room/WarRoom.tsx');
const pricing = read('src/pages/pricing/Pricing.tsx');
const earlyAccessForm = read('src/components/feature/EarlyAccessForm.tsx');
const memberNote = read('src/pages/member-note/page.tsx');
const performance = read('src/pages/performance/page.tsx');
const verification = read('src/pages/verification/page.tsx');
const reportsCenter = read('src/pages/reports/ReportsCenter.tsx');
const reportDetail = read('src/pages/reports/ReportDetail.tsx');
const observationSection = read('src/components/v11/V11ObservationSection.tsx');
const openingMarketRadar = read('supabase/functions/opening-market-radar/index.ts');
const runtimeDeployWorkflow = read('.github/workflows/deploy-morning-alpha-runtime.yml');
const runtimeCheckpointWorkflow = read('.github/workflows/morning-alpha-runtime-checkpoints.yml');

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
  'src/pages/pricing/Pricing.tsx',
  'src/pages/NotFound.tsx',
  'src/components/feature/EarlyAccessForm.tsx',
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
  '/pricing',
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
  assert.match(runtimeTimeline, /node\.status === 'completed' \|\| node\.status === 'insufficient'/);
  assert.match(runtimeTimeline, /node\.status === 'pending' && index < lastResolvedIndex/);
  assert.match(warRoomMapper, /reconcileRuntimeTimeline\(nodes\)/);
  assert.match(runtimeTimeline, /scheduledMinutes <= taipeiMinutes/);
  assert.doesNotMatch(runtimeTimeline, /待 Runtime|Runtime checkpoint/);
});

test('opening radar degrades safely when only TXF is unavailable', () => {
  assert.match(openingMarketRadar, /txfOnlyMissing/);
  assert.match(openingMarketRadar, /hasTaiex\s*&&\s*hasTsmc/);
  assert.match(openingMarketRadar, /checkpoint_cash_core_degraded/);
  assert.match(openingMarketRadar, /const checkpointUsable = checkpointEvaluation\.ready \|\| degradedCheckpointUsable/);
  assert.match(openingMarketRadar, /if \(!checkpointUsable\)/);
});

test('runtime deployment and missing checkpoint schedules are reproducible', () => {
  for (const functionName of ['fetch-market-data-v10', 'opening-market-radar', 'close-market-review', 'ma-ops-health-check']) {
    assert.match(runtimeDeployWorkflow, new RegExp(`functions deploy ${functionName}`), `runtime deploy omits ${functionName}`);
  }
  for (const schedule of ["30 2 * * 1-5", "0 5 * * 1-5", "20 6 * * 1-5"]) {
    assert.match(runtimeCheckpointWorkflow, new RegExp(schedule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing runtime schedule: ${schedule}`);
  }
  assert.match(runtimeCheckpointWorkflow, /\{"phase":"intraday"\}/);
  assert.match(runtimeCheckpointWorkflow, /\{\\"checkpoint\\":\\"\$CHECKPOINT\\"\}/);
  assert.match(runtimeCheckpointWorkflow, /snapshot_upserted_count >= 2/);
  assert.match(runtimeCheckpointWorkflow, /written_and_synced/);
  assert.match(runtimeCheckpointWorkflow, /secrets\.CRON_SECRET/);
});

test('TXF discovery and quote URLs follow the Fugle futopt contract', () => {
  const source = read('supabase/functions/fetch-market-data-v10/index.ts');
  assert.match(
    source,
    /futopt\/intraday\/tickers\?type=FUTURE&exchange=TAIFEX&session=\$\{session\}&product=TXF/,
  );
  assert.match(source, /"futopt\/intraday\/quote"/);
  assert.match(source, /\{ session: session === "afterhours" \? "AFTERHOURS" : "REGULAR" \}/);
  assert.doesNotMatch(source, /futopt\/intraday\/quote\?session=/);
  assert.doesNotMatch(source, /futopt\/products/);
});

test('home public decision copy is user-facing and internally consistent', () => {
  for (const label of ['AI Confidence', 'Risk Level', 'Suggested Exposure', 'Last Update', 'Morning Brief', 'AI Final Decision', 'Observation', 'Reason', 'Impact']) {
    assert.doesNotMatch(home, new RegExp(`>${label}<`, 'i'), `home renders untranslated label: ${label}`);
  }
  assert.match(home, /盤前暫不建立部位/);
  assert.match(home, /runtimePhaseLabel\(currentNode\)/);
  assert.match(home, /homeDecisionCopy\(decisionState, currentTimelineNode\)/);
  assert.match(home, /decisionDayLabel\(decisionState, reportExists && isTodayReport, currentTimelineNode\)/);
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
  assert.match(today, /marketStatusLabel=\{nextDecisionTime\}/);
});

test('today report is a drill-down workbench rather than a duplicate home dashboard', () => {
  for (const label of ['今日判斷工作台', '現在怎麼做', '為什麼', '何時再看', '下一步要補齊的證據', '只看上一個結果與下一個動作']) {
    assert.match(today, new RegExp(label), `today report is missing workbench copy: ${label}`);
  }
  assert.doesNotMatch(today, /ma-today-v3-advice-card/);
  assert.doesNotMatch(today, />判斷信心</);
  assert.match(today, /09:30 開盤資料不完整：缺少同一時間範圍的加權指數、台指期與台積電快照/);
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

test('opportunities is a candidate screening flow with complete public copy', () => {
  for (const label of ['今日機會篩選台', '不把觀察股包裝成受惠股', '主線先成立', '個股要承接', '風險不能破', '觀察股比較', '為什麼先觀察', '成立前要看到', '什麼情況取消']) {
    assert.match(opportunities, new RegExp(label), `opportunities is missing screening copy: ${label}`);
  }
  assert.doesNotMatch(opportunities, />09:30 確認</);
  assert.match(opportunities, /selectNextRuntimeTimelineNode\(runtimeTimeline\)/);
  assert.match(opportunities, /replace\(\/\\bTAIEX\\b\/gi, '加權指數'\)/);
  assert.match(opportunities, /replace\(\/\\bTXF\\b\/gi, '台指期'\)/);
  assert.match(opportunities, /hasStrongBeneficiaryEvidence/);
  assert.match(opportunities, /今天沒有強受惠股，先觀察/);
  assert.match(opportunities, /不把觀察股包裝成受惠股/);
  const css = read('src/index.css');
  const cardRule = css.match(/\.ma-opportunities-page \.ma-opportunity-card \{([^}]*)\}/)?.[1] || '';
  const detailRule = css.match(/\.ma-opportunities-page \.ma-opportunity-details > div > dd \{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(cardRule, /max-height:\s*360px|overflow:\s*hidden/);
  assert.doesNotMatch(detailRule, /line-clamp|overflow:\s*hidden/);
  assert.match(detailRule, /white-space:\s*normal/);
});

test('war room is a live monitor rather than another dashboard page', () => {
  for (const label of ['盤中監控中', '盤中更新', '還沒有新的盤中更新', '跟早上相比，哪裡變了？', '現在怎麼做']) {
    assert.match(warRoom, new RegExp(label), `war room is missing monitor copy: ${label}`);
  }
  for (const repeatedSurface of ['證據矩陣', '監控清單', 'ma-war-room-v3-evidence-table', 'ma-war-room-v3-watch-table']) {
    assert.doesNotMatch(warRoom, new RegExp(repeatedSurface), `war room still repeats a morning surface: ${repeatedSurface}`);
  }
  assert.match(warRoom, /hasNewIntradayEvidence/);
  assert.match(warRoom, /getRuntimeCheckpointState\(runtimeSyncStatus, '1030'\) === 'completed'/);
  assert.match(warRoom, /getRuntimeCheckpointState\(runtimeSyncStatus, '1300'\) === 'completed'/);
  assert.match(warRoom, /feedTimeline/);
  for (const legacySurface of ['ma-pixel-hero', 'ma-phase2-kpi-grid', 'ma-phase2-timeline', 'ma-phase2-observation-grid']) {
    assert.doesNotMatch(warRoom, new RegExp(legacySurface), `war room still uses repeated surface: ${legacySurface}`);
  }
  assert.match(warRoom, /publicWarRoomText/);
  assert.match(warRoom, /replace\(\/\\bunknown\\b\/gi, '尚未取得'\)/);
  assert.match(warRoom, /replace\(\/\\bTAIEX\\b\/gi, '加權指數'\)/);
  assert.match(warRoom, /replace\(\/\\bTXF\\b\/gi, '台指期'\)/);
  assert.match(warRoom, /replace\(\/\\bADR\\b\/gi, '海外存託憑證'\)/);
});

test('war room rows show complete text and use a distinct responsive surface', () => {
  const css = read('src/index.css');
  const feedRule = css.match(/\.ma-war-room-page \.ma-war-room-v3-feed p \{([\s\S]*?)\n  \}/)?.[1] || '';
  const noUpdateRule = css.match(/\.ma-war-room-page \.ma-war-room-v3-no-update p \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.ok(feedRule, 'missing scoped monitor feed rule');
  assert.ok(noUpdateRule, 'missing scoped monitor empty-state rule');
  assert.doesNotMatch(feedRule, /line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
  assert.doesNotMatch(noUpdateRule, /line-clamp|overflow:\s*hidden|display:\s*-webkit-box/);
  assert.match(feedRule, /overflow-wrap:\s*anywhere/);
  assert.match(noUpdateRule, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.ma-war-room-page \.ma-war-room-v3-layout/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.ma-war-room-page \.ma-war-room-v3-layout/);
});

test('membership conversion route is public, honest, and records a real submission result', () => {
  for (const label of ['Morning Alpha 會員計畫', '公開測試', '創始會員', '加入早鳥名單', '登記不等於購買']) {
    assert.match(pricing, new RegExp(label), `pricing is missing honest conversion copy: ${label}`);
  }
  assert.match(earlyAccessForm, /await submitEarlyAccess/);
  assert.match(earlyAccessForm, /if \(!result\.success\)/);
  assert.doesNotMatch(pricing, /台中 · 上班族投資人|台北 · 三年股齡|高雄 · 新手投資人|新竹 · 科技業/);
  assert.doesNotMatch(pricing, /data-readdy-form|readdy\.ai\/api\/form/);
  assert.doesNotMatch(earlyAccessForm, /data-readdy-form|readdy\.ai\/api\/form/);
  const paywallCard = read('src/components/paywall/PaywallCard.tsx');
  assert.match(paywallCard, /\/pricing#early-access/);
  assert.match(paywallCard, /<Link to=\{targetHref\}/);
  assert.doesNotMatch(paywallCard, /window\.location|window\.open|target=["']_blank/);
  assert.match(pricing, /document\.getElementById\(location\.hash\.slice\(1\)\)/);
});

test('core product pages have distinct jobs instead of repeated dashboard surfaces', () => {
  for (const label of ['研究摘要', '因果鏈', '雙向證據', '個股檔案', '使用方式']) {
    assert.match(memberNote, new RegExp(label), `member note is missing editorial chapter: ${label}`);
  }
  assert.match(memberNote, /ma-research-note-v3-masthead/);
  assert.doesNotMatch(memberNote, /ma-pixel-hero|ma-phase2-kpi-grid|ma-phase2-status-card/);

  for (const label of ['公開決策帳本', '驗證帳本', '統計方法', '哪些資料會被計入']) {
    assert.match(performance, new RegExp(label), `performance is missing audit ledger copy: ${label}`);
  }
  assert.match(performance, /ma-performance-v3-ledger/);
  assert.doesNotMatch(performance, /ma-pixel-hero|ma-phase2-kpi-grid|ma-phase2-status-card/);

  assert.match(home, /ma-home-v2/);
  assert.match(today, /ma-today-v4-workbench/);
  assert.match(opportunities, /ma-opportunities-v2/);
  assert.match(warRoom, /ma-war-room-v3/);
});

test('member note translates research enums and checkpoint diagnostics for readers', () => {
  assert.match(memberNote, /replace\(\/\\bSEMICONDUCTOR\\b\/gi, '半導體'\)/);
  assert.match(memberNote, /開盤資料不完整：加權指數、台指期與台積電快照尚未在同一有效時間內到齊/);
});

test('performance excludes outcomes that have no verifiable closing direction', () => {
  assert.match(performance, /const hasVerifiableDirection/);
  assert.match(performance, /const hasNamedDirection/);
  assert.match(performance, /numberOrNull\(actualTaiexClose\?\.change_percent\)/);
  assert.match(performance, /if \(!hasVerifiableDirection\) return false/);
  assert.match(performance, /publicPerformanceText/);
});

test('verification is a public fail-closed audit instead of an internal diagnostics page', () => {
  for (const label of ['今日驗證', '盤前假設', '盤中進度', '收盤結果', '驗證規則', '資料未完整前不判定命中', '必須取得真實收盤方向或漲跌幅']) {
    assert.match(verification, new RegExp(label), `verification is missing public audit copy: ${label}`);
  }
  for (const internalName of ['FINNHUB', 'SUPABASE_REPORTS', 'close-market-review', 'DATA SOURCE CHECK', 'SCRIPT VERIFICATION', 'OPENAI']) {
    assert.doesNotMatch(verification, new RegExp(internalName, 'i'), `verification exposes an internal name: ${internalName}`);
  }
  assert.match(verification, /hasActualOutcome/);
  assert.match(verification, /\['completed', 'complete', 'ready', 'done'\]\.includes\(status\)/);
});

test('report pages translate public market labels and require a real closing outcome', () => {
  for (const label of ['>REPORTS CENTER<', '>Report<', '>FILTER<', '>LATEST RESEARCH<', '>ARCHIVE<']) {
    assert.doesNotMatch(reportsCenter, new RegExp(label, 'i'), `reports center renders an untranslated label: ${label}`);
  }
  assert.match(reportsCenter, /publicReportText/);
  assert.match(reportDetail, /hasVerifiableClosingData/);
  assert.match(reportDetail, /hasNamedDirection \|\| change !== null/);
  assert.doesNotMatch(reportDetail, /!!strategy\.closing_feedback_plan/);
  assert.match(observationSection, /步驟 \$\{step\}/);
  assert.match(observationSection, /盤前觀察/);
  assert.match(observationSection, /publicObservationText/);
});

test('home uses canonical server payload and labels historical fallback', () => {
  const resolver = read('src/services/resolveActiveReport.ts');
  assert.match(resolver, /callGetReportPayload/);
  assert.doesNotMatch(resolver, /from ['"]@\/lib\/supabase['"]/);
  assert.match(home, /hasHistoricalReport \? 'not-today' : 'no-report'/);
  assert.match(home, /to=\{`\/reports\/\$\{displayReportDate\}`\}/);
});
