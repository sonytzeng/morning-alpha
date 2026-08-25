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
const loginPage = read('src/pages/auth/LoginPage.tsx');
const membershipService = read('src/services/membershipService.ts');
const memberNote = read('src/pages/member-note/page.tsx');
const performance = read('src/pages/performance/page.tsx');
const verification = read('src/pages/verification/page.tsx');
const reportsCenter = read('src/pages/reports/ReportsCenter.tsx');
const reportDetail = read('src/pages/reports/ReportDetail.tsx');
const observationSection = read('src/components/v11/V11ObservationSection.tsx');
const openingMarketRadar = read('supabase/functions/opening-market-radar/index.ts');
const dailyReportGenerator = read('supabase/functions/generate-daily-report-v7/index.ts');
const runtimeDeployWorkflow = read('.github/workflows/deploy-morning-alpha-runtime.yml');
const runtimeCheckpointWorkflow = read('.github/workflows/morning-alpha-runtime-checkpoints.yml');
const publicResearchText = read('src/utils/publicResearchText.ts');
const publicRuntimeCopy = read('src/utils/publicRuntimeCopy.ts');
const reportPayloadFunction = read('supabase/functions/get-report-payload/index.ts');
const premiumAvailability = read('src/lib/premiumContentAvailability.ts');
const premiumGate = read('supabase/functions/_shared/premium-content-gate.ts');
const contentIntelligence = read('supabase/functions/_shared/content-intelligence.ts');
const lineDailyPush = read('supabase/functions/line-daily-push/index.ts');
const dailyDeliveryOrchestrator = read('supabase/functions/daily-delivery-orchestrator/index.ts');
const globalMarketNews = read('supabase/functions/fetch-global-market-news/index.ts');
const closingVerification = read('supabase/functions/closing-verification-engine/index.ts');
const opsHealthCheck = read('supabase/functions/ma-ops-health-check/index.ts');
const contentIntelligenceMigration = read('supabase/migrations/20260820131721_content_intelligence_v2_foundation.sql');
const deliveryGuaranteeMigration = read('supabase/migrations/20260821080555_daily_delivery_guarantee.sql');
const accountDashboard = read('src/hooks/useAccountDashboard.ts');
const accountInfoCards = read('src/pages/account/components/TodayInfoCards.tsx');

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

test('the LINE report destination opens the dedicated daily report page', () => {
  assert.match(routeConfig, /const TodayReport = lazy/);
  assert.match(routeConfig, /path: "\/report\/today",\s*element: <DeferredRoute><TodayReport \/><\/DeferredRoute>/);
  assert.doesNotMatch(routeConfig, /path: "\/report\/today",\s*element: <Navigate to="\/" replace \/>/);
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
  assert.match(reportService, /if \(limit <= 0\) return \[\];/);
  assert.match(reportService, /callGetReportHistory\(limit\)/);
  assert.match(reportPayloadFunction, /history_limit/);
  assert.match(reportPayloadFunction, /Math\.min\(30, Math\.max\(1, requestedLimit\)\)/);
  assert.match(reportPayloadFunction, /buildHistorySummary/);
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
  assert.match(runtimeTimeline, /elapsedPendingIndexes\[elapsedPendingIndexes\.length - 1\]/);
  assert.match(runtimeTimeline, /elapsedPendingIndexes\.slice\(0, -1\)/);
  assert.doesNotMatch(runtimeTimeline, /待 Runtime|Runtime checkpoint/);
});

test('synthetic research sentences are naturalized across every public report surface', () => {
  assert.match(publicResearchText, /naturalizeSyntheticResearchSentence/);
  assert.match(publicResearchText, /是今天的主要觀察方向，先等市場承接確認/);
  for (const source of [home, today, opportunities, warRoom, verification, reportsCenter, reportDetail]) {
    assert.match(source, /humanizePublicRuntimeText/);
  }
  assert.match(publicRuntimeCopy, /naturalizeSyntheticResearchSentence/);
  assert.match(publicRuntimeCopy, /資料補齊前不更新判斷/);
  assert.match(performance, /目前沒有可計入績效的完整收盤紀錄/);
});

test('opening radar degrades safely when only TXF is unavailable', () => {
  assert.match(openingMarketRadar, /txfOnlyMissing/);
  assert.match(openingMarketRadar, /hasTaiex\s*&&\s*hasTsmc/);
  assert.match(openingMarketRadar, /checkpoint_cash_core_degraded/);
  assert.match(openingMarketRadar, /const checkpointUsable = checkpointEvaluation\.ready \|\| degradedCheckpointUsable/);
  assert.match(openingMarketRadar, /if \(!checkpointUsable\)/);
});

test('premarket workflow delegates to the durable recovery state machine', () => {
  assert.match(runtimeDeployWorkflow, /supabase db push --linked/);
  assert.match(runtimeCheckpointWorkflow, /cron: '10 23 \* \* 0-4'/);
  assert.match(runtimeCheckpointWorkflow, /cron: '35 23 \* \* 0-4'/);
  assert.match(runtimeCheckpointWorkflow, /daily-delivery-orchestrator/);
  const newsAction = dailyDeliveryOrchestrator.indexOf("'fetch-global-market-news'");
  const reportAction = dailyDeliveryOrchestrator.indexOf("'generate-daily-report-v7'");
  const lineAction = dailyDeliveryOrchestrator.lastIndexOf("'line-daily-push'");
  assert.ok(newsAction >= 0, 'recovery router must refresh global market news');
  assert.ok(newsAction < reportAction, 'evidence refresh must precede report regeneration');
  assert.ok(reportAction < lineAction, 'report regeneration must precede premium delivery');
  assert.match(dailyDeliveryOrchestrator, /clock\.minutes >= 7 \* 60 \+ 30/);
  assert.match(dailyDeliveryOrchestrator, /payload\.success !== false/);
  assert.match(dailyDeliveryOrchestrator, /invokeFunctionWithRetry/);
  assert.match(dailyDeliveryOrchestrator, /actionFailures\.length === 0/);
  assert.match(dailyDeliveryOrchestrator, /success: completed/);
  assert.match(dailyDeliveryOrchestrator, /EVIDENCE_REFRESH_DEPENDENCY_FAILED/);
  assert.match(dailyDeliveryOrchestrator, /deliveryBlockedByEvidenceFailure/);
  const premarketJob = runtimeCheckpointWorkflow.slice(
    runtimeCheckpointWorkflow.indexOf('  premarket:'),
    runtimeCheckpointWorkflow.indexOf('  intraday:'),
  );
  assert.match(premarketJob, /\.status == "SUCCEEDED" or \(\.status == "SKIPPED" and \.reason == "MARKET_STATUS_NOT_OPEN"\)/);
  assert.doesNotMatch(premarketJob, /\.status == "DEGRADED"/);
  assert.match(premarketJob, /action_failures/);
  assert.match(dailyDeliveryOrchestrator, /PIPELINE_SLOT_ALREADY_CLAIMED/);
  assert.match(dailyDeliveryOrchestrator, /existingStatus/);
  assert.match(globalMarketNews, /from\("news_events"\)/);
  assert.match(globalMarketNews, /canonical_complete: canonicalComplete/);
  assert.match(globalMarketNews, /classifyProviderFailures/);
  assert.match(globalMarketNews, /incomingCronSecret !== envCronSecret/);
  assert.doesNotMatch(globalMarketNews, /authorization\.includes\("Bearer"\)/);
  assert.match(globalMarketNews, /PROVIDER_FETCH_TIMEOUT_MS/);
  assert.match(globalMarketNews, /Promise\.all\(providerFetches\)/);
  assert.match(globalMarketNews, /NO_VALID_NEWS_FETCHED/);
  assert.match(globalMarketNews, /invalid_published_at_count/);
});

test('authenticated recovery can force report regeneration after a code-only fix', () => {
  assert.match(dailyDeliveryOrchestrator, /const forceRegenerate = body\.force_regenerate === true/);
  assert.match(dailyDeliveryOrchestrator, /if \(forceRegenerate\) actions = \['regenerate_report'\]/);
  assert.ok(
    dailyDeliveryOrchestrator.indexOf('authorizeRequest(req, supabase, cronSecret)')
      < dailyDeliveryOrchestrator.indexOf('const forceRegenerate = body.force_regenerate === true'),
    'force regeneration must only be parsed after internal authentication',
  );
});

test('LINE delivery is fail-closed and persists per-subscriber retries', () => {
  const hardGate = lineDailyPush.indexOf("reason: 'PREMIUM_CONTENT_NOT_ELIGIBLE'");
  const subscriberDelivery = lineDailyPush.indexOf('deliverOutboxMessage({', hardGate);
  assert.ok(hardGate >= 0, 'LINE must expose a hard premium content gate');
  assert.ok(subscriberDelivery > hardGate, 'subscriber delivery must happen only after the hard gate');
  assert.match(lineDailyPush, /snapshotStatus === 'READY'/);
  assert.match(lineDailyPush, /snapshotScore >= 90/);
  assert.match(lineDailyPush, /claim_line_delivery_outbox_v1/);
  assert.match(lineDailyPush, /mark_line_delivery_outbox_v1/);
  assert.match(lineDailyPush, /delivery_mode === 'incident'/);
  assert.match(deliveryGuaranteeMigration, /create table if not exists public\.line_delivery_outbox/);
  assert.match(deliveryGuaranteeMigration, /for update skip locked/);
  assert.match(deliveryGuaranteeMigration, /0-40\/5 23 \* \* 0-4/);
  assert.match(deliveryGuaranteeMigration, /decision_snapshots_premium_90_gate/);
  assert.match(deliveryGuaranteeMigration, /new\.content_score is null or new\.content_score < 90/);
  assert.match(opsHealthCheck, /ready_90_point_decision_snapshot/);
});

test('paid report fails closed when evidence does not meet the member threshold', () => {
  assert.match(reportDetail, /memberResearchDegraded/);
  assert.match(reportDetail, /resolvePremiumContentAvailability/);
  assert.match(reportDetail, /今日研究資料尚未達付費發布標準/);
  assert.match(reportDetail, /不會把資料不足包裝成高信心受惠股/);
  assert.match(reportDetail, /本報告沒有可核對的 48 小時內新聞來源/);
  assert.doesNotMatch(reportDetail, /等待 09:30 開盤雷達/);
  assert.doesNotMatch(reportDetail, /market_data_latest_date \|\| report\.report_date\} 收盤/);
  assert.match(memberNote, /memberResearchPublishable/);
  assert.match(memberNote, /今日資料不足，不發布付費個股研究/);
  assert.match(memberNote, /resolvePremiumContentAvailability/);
  assert.match(opportunities, /premiumResearchPublishable/);
  assert.match(opportunities, /resolvePremiumContentAvailability/);
  assert.match(reportsCenter, /selectedResearchPublishable/);
  assert.match(reportsCenter, /這天的個股研究已降級/);
  assert.match(premiumAvailability, /Object\.keys\(gate\)\.length > 0/);
  assert.match(premiumAvailability, /memberValueScore >= 90/);
  assert.match(premiumAvailability, /freshNewsCount > 0/);
  assert.match(premiumGate, /recommendation_reasoning_incomplete/);
  assert.match(reportPayloadFunction, /evaluatePremiumContentGate/);
  assert.match(reportPayloadFunction, /if \(!premiumGate\.eligible\)/);
  assert.match(reportPayloadFunction, /one_teaser_stock: premiumGate\.eligible \? buildTeaserStock\(ai\) : null/);
  assert.match(reportPayloadFunction, /premium_content_unavailable_reason: "EVIDENCE_GATE_NOT_MET"/);
});

test('V11 observation roles require fresh evidence and cap confidence', () => {
  assert.match(dailyReportGenerator, /V11_OBSERVATION_ROLE_BUILDER_SKIPPED/);
  assert.match(dailyReportGenerator, /input\.dataQualityStatus!=='sufficient'/);
  assert.match(dailyReportGenerator, /!freshNews\|\|!externalEvidence\|\|!capital/);
  assert.match(dailyReportGenerator, /const dataCap=data==='sufficient'\?85:data==='partial'\?65:50/);
  assert.match(dailyReportGenerator, /item\.evidence_type==='market_news'/);
  assert.match(dailyReportGenerator, /TAIEX\|TWII\|TXF\|MTX\|2330/);
  assert.match(dailyReportGenerator, /不是無條件推薦/);
});

test('legacy opening radar UI fails closed without real core evidence', () => {
  const openingRadarService = read('src/services/openingRadarService.ts');
  const openingRadarComponent = read('src/components/base/OpeningRadar.tsx');
  assert.match(openingRadarService, /hasSufficientOpeningRadarEvidence/);
  assert.match(openingRadarService, /coreEvidenceCount >= 2/);
  assert.match(openingRadarService, /Boolean\(radar\.captured_at\)/);
  assert.match(openingRadarService, /CONFIRMED_RADAR_STATUSES\.has\(radar\.radar_status\)/);
  assert.match(openingRadarService, /radar_status: '資料不足'/);
  assert.doesNotMatch(openingRadarService, /Morning Alpha Radar Freshness/);
  assert.match(openingRadarComponent, /isConfirmed \? '開盤驗證通過' : '等待市場確認'/);
});

test('runtime deployment and missing checkpoint schedules are reproducible', () => {
  for (const functionName of ['fetch-market-data-v10', 'fetch-global-market-news', 'opening-market-radar', 'close-market-review', 'closing-verification-engine', 'ma-ops-health-check', 'generate-daily-report-v7', 'generate-sector-rotation', 'line-daily-push', 'daily-delivery-orchestrator', 'get-report-payload']) {
    assert.match(runtimeDeployWorkflow, new RegExp(`functions deploy ${functionName}`), `runtime deploy omits ${functionName}`);
  }
  for (const schedule of ["10 23 * * 0-4", "35 23 * * 0-4", "0 1 * * 1-5", "5 1 * * 1-5", "30 1 * * 1-5", "35 1 * * 1-5", "30 2 * * 1-5", "35 2 * * 1-5", "0 5 * * 1-5", "5 5 * * 1-5", "10 6 * * 1-5", "15 6 * * 1-5", "30 6 * * 1-5", "35 6 * * 1-5"]) {
    assert.match(runtimeCheckpointWorkflow, new RegExp(schedule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing runtime schedule: ${schedule}`);
  }
  assert.match(runtimeCheckpointWorkflow, /\{\\"phase\\":\\"intraday\\",\\"checkpoint\\":\\"\$CHECKPOINT\\"\}/);
  assert.match(runtimeCheckpointWorkflow, /\{\\"phase\\":\\"close\\",\\"checkpoint\\":\\"\$CHECKPOINT\\"\}/);
  assert.match(runtimeCheckpointWorkflow, /beneficiary_close_only\\":true/);
  assert.match(runtimeCheckpointWorkflow, /beneficiary_close_status\.complete == true/);
  assert.match(runtimeCheckpointWorkflow, /canonical_complete == true/);
  assert.match(runtimeCheckpointWorkflow, /core_batch_complete == true/);
  assert.match(runtimeCheckpointWorkflow, /required_core_complete == true/);
  assert.match(runtimeCheckpointWorkflow, /provider_health_write_errors \| length/);
  assert.match(runtimeCheckpointWorkflow, /checkpoint_complete == true/);
  assert.match(runtimeCheckpointWorkflow, /daily-delivery-orchestrator/);
  assert.match(runtimeCheckpointWorkflow, /\{\\"checkpoint\\":\\"\$CHECKPOINT\\"\}/);
  assert.match(runtimeCheckpointWorkflow, /snapshot_upserted_count >= 2/);
  assert.match(runtimeCheckpointWorkflow, /tw_core_symbols_success \| index\("TAIEX"\) != null/);
  assert.match(runtimeCheckpointWorkflow, /tw_core_status\.taiex == "ok"/);
  assert.match(runtimeCheckpointWorkflow, /tw_core_status\.stock_2330 == "ok"/);
  assert.match(runtimeCheckpointWorkflow, /for attempt in 1 2 3/);
  assert.match(runtimeCheckpointWorkflow, /timeout-minutes: 45/);
  assert.match(runtimeCheckpointWorkflow, /--max-time 180/);
  assert.match(runtimeCheckpointWorkflow, /Intraday snapshots unavailable/);
  assert.match(runtimeCheckpointWorkflow, /Closing review failed/);
  assert.match(runtimeCheckpointWorkflow, /Sector rotation deferred/);
  assert.match(runtimeCheckpointWorkflow, /continue-on-error: true/);
  assert.match(runtimeCheckpointWorkflow, /steps\.sector-rotation\.outcome == 'failure'/);
  assert.match(runtimeCheckpointWorkflow, /Missing TAIEX close evidence/);
  assert.match(runtimeCheckpointWorkflow, /Beneficiary close evidence incomplete/);
  assert.match(runtimeCheckpointWorkflow, /Closing verification incomplete/);
  assert.match(runtimeCheckpointWorkflow, /written_and_synced/);
  assert.match(runtimeCheckpointWorkflow, /closing-verification-engine/);
  assert.match(runtimeCheckpointWorkflow, /closing_verification_status/);
  assert.match(runtimeCheckpointWorkflow, /generate-sector-rotation/);
  assert.match(runtimeCheckpointWorkflow, /secrets\.CRON_SECRET/);
  assert.match(runtimeCheckpointWorkflow, /Wait until the checkpoint snapshot window/);
  assert.match(runtimeCheckpointWorkflow, /TZ=Asia\/Taipei/);
  assert.match(runtimeCheckpointWorkflow, /id: checkpoint-state/);
  assert.match(runtimeCheckpointWorkflow, /get-report-payload/);
  assert.match(runtimeCheckpointWorkflow, /already_complete=true/);
  assert.match(runtimeCheckpointWorkflow, /id: closing-state/);
  assert.match(runtimeCheckpointWorkflow, /id: sector-state/);
  assert.match(runtimeCheckpointWorkflow, /sector_rotation_scores/);
  assert.match(runtimeCheckpointWorkflow, /closing-verification-status/);
  assert.match(runtimeDeployWorkflow, /db push --linked/);
  assert.ok(runtimeDeployWorkflow.indexOf('db push --linked') < runtimeDeployWorkflow.indexOf('functions deploy daily-delivery-orchestrator'));
  assert.match(opsHealthCheck, /evaluatePremiumContentGate/);
  assert.match(opsHealthCheck, /intraday_validation\)\.length < 3/);
  assert.match(opsHealthCheck, /invalidation_rules\)\.length < 2/);
  assert.match(opsHealthCheck, /verifiedCatalystCount < 1/);
  assert.match(opsHealthCheck, /verified_market_count/);
  assert.match(runtimeCheckpointWorkflow, /&& 'premarket'/);
});

test('LINE brief identifies analysis and market-data times and refuses weak day-trading scripts', () => {
  for (const label of ['07:30 盤前', '今日一句', '最大機會', '最大風險', '下一確認', '分析產生', '資料截止']) {
    assert.match(lineDailyPush, new RegExp(label), `LINE brief is missing ${label}`);
  }
  assert.match(lineDailyPush, /evaluatePremiumContentGate/);
  assert.match(lineDailyPush, /資料未達標，不建立個股劇本/);
  assert.match(lineDailyPush, /ALREADY_SENT/);
  assert.match(lineDailyPush, /X-Line-Retry-Key/);
});

test('trading-day reports and public timelines fail closed with correct times', () => {
  const reportGenerator = read('supabase/functions/generate-daily-report-v7/index.ts');
  const runtimeTimeline = read('src/lib/runtimeDecisionTimeline.ts');
  assert.doesNotMatch(reportGenerator, /if\(dow===1\)return REPORT_MODE_WEEKEND/);
  assert.match(reportGenerator, /30000,'openai_chat_completions'/);
  assert.doesNotMatch(reportGenerator, /sentence:'今天要驗證的是 '/);
  assert.match(reportGenerator, /hasAnalyzedDailySentence/);
  assert.match(reportGenerator, /未出現前不升級判斷/);
  assert.match(runtimeTimeline, /time: '13:00'/);
  assert.match(runtimeTimeline, /time: '14:30'/);
  assert.doesNotMatch(runtimeTimeline, /time: '13:30'/);
  assert.match(today, /if \(!isReportForToday\)/);
  assert.match(warRoom, /report\.report_date !== todayTaipeiStr/);
  assert.match(warRoom, /不會把歷史時間軸冒充成今天進度/);
});

test('member research note labels same-day Taiwan recovery data as intraday, not a completed close', () => {
  assert.match(dailyReportGenerator, /const isIntradayTaiwanBasis=dates\.twCoreDate===todayDate/);
  assert.match(dailyReportGenerator, /isIntradayTaiwanBasis\?' 盤中最新資料':' 最近完整收盤'/);
  assert.doesNotMatch(dailyReportGenerator, /本日盤前基準日期：台股 '\+dates\.twCoreDate\+' 收盤/);
});

test('opening radar preserves the complete War Room decision contract', () => {
  for (const field of ['decision_step', 'next_role', 'confirmation_checklist', 'risk_checklist', 'capital_rotation_path', 'external_priority', 'decision_confidence']) {
    assert.match(openingMarketRadar, new RegExp(`${field}:`), `opening radar omits War Room field ${field}`);
  }
  assert.match(openingMarketRadar, /v10_observation_watchlist/);
  assert.match(openingMarketRadar, /observation_roles: observationRoles/);
});

test('TXF discovery and quote URLs follow the Fugle futopt contract', () => {
  const source = read('supabase/functions/fetch-market-data-v10/index.ts');
  assert.match(source, /continuousAlias = "TXF1!"/);
  assert.match(
    source,
    /futopt\/intraday\/tickers\?type=FUTURE&exchange=TAIFEX&session=\$\{session\}&product=TXF/,
  );
  assert.match(source, /"futopt\/intraday\/quote"/);
  assert.match(source, /session === "afterhours" \? \{ session: "afterhours" \} : undefined/);
  assert.doesNotMatch(source, /futopt\/intraday\/quote\?session=/);
  assert.doesNotMatch(source, /futopt\/products/);
  assert.match(source, /`tse_\$\{symbol\}\.tw`/);
  assert.match(source, /`otc_\$\{symbol\}\.tw`/);
  assert.match(source, /provider: "twse_mis"/);
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
  assert.match(home, /今天先回答四件事/);
  assert.match(home, /今天適合哪種策略/);
  assert.match(home, /今天優先看什麼/);
  assert.match(home, /確認條件/);
  assert.match(home, /取消條件/);
  assert.doesNotMatch(home, /81%|勝率保證|保證獲利/);
  assert.match(home, /isSyntheticResearchSentence/);
  assert.match(home, /get_public_performance_journal/);
  assert.match(home, /latestPublicClosing/);
  assert.match(home, /查看完整研究與當沖條件/);
  assert.doesNotMatch(home, /查看完整 AI 推理/);
  assert.match(home, /最近一次收盤驗證 ·/);
  assert.match(home, /dataStatus === 'complete'/);
  assert.match(home, /hasDirection/);
  assert.match(home, /資料不足，已安全降級/);
  assert.match(home, /selectNextRuntimeTimelineNode\(timelineNodes\)/);
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
  assert.match(today, /humanizePublicRuntimeText/);
  assert.match(today, /matchingValidationStep/);
  assert.match(today, /nextRuntimeNode\.status === 'current' \|\| nextRuntimeNode\.status === 'insufficient'/);
  assert.match(today, /節點時間已到，但完整市場資料尚未到齊；資料補齊前不更新判斷/);
  assert.match(today, /label: `\$\{nextRuntimeNode\.time\} \$\{nextRuntimeNode\.label\}`/);
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
  assert.match(opportunities, /humanizePublicRuntimeText/);
  assert.match(opportunities, /hasStrongBeneficiaryEvidence/);
  assert.match(opportunities, /今天沒有強受惠股，先觀察/);
  assert.match(opportunities, /不把觀察股包裝成受惠股/);
  assert.match(opportunities, /legacyObservationStocks/);
  assert.match(opportunities, /hasUsableLegacyEvidence/);
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
  assert.match(warRoom, /humanizePublicRuntimeText/);
});

test('member note turns actual intraday evidence into a fail-closed day-trading decision', () => {
  for (const label of ['今日當沖決策', '今天是否適合當沖', '只看這個型態', '成立條件', '放棄條件', '優先觀察', '下一確認時間']) {
    assert.match(memberNote, new RegExp(label), `member note is missing day-trading decision copy: ${label}`);
  }
  assert.match(memberNote, /hasCompleteDayTradingEvidence/);
  assert.match(memberNote, /資料不足，今天不建立當沖劇本/);
  assert.match(memberNote, /intraday_time_windows/);
  assert.match(memberNote, /intraday_validation/);
  assert.doesNotMatch(memberNote, /保證獲利|必買|穩賺/);
  assert.match(pricing, /今日是否適合當沖、成立條件與放棄條件/);
  assert.match(pricing, /資料不足就不建立劇本/);
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
  assert.match(paywallCard, /\/login\?next=\/member-note/);
  assert.match(paywallCard, /<Link to=\{targetHref\}/);
  assert.doesNotMatch(paywallCard, /window\.location|window\.open|target=["']_blank/);
  assert.match(routeConfig, /path: "\/login"/);
  assert.match(routeConfig, /path: "\/auth\/callback"/);
  assert.match(loginPage, /創始測試期間不扣款/);
  assert.match(membershipService, /signInWithOtp/);
  assert.match(membershipService, /shouldCreateUser: true/);
  assert.match(pricing, /document\.getElementById\(location\.hash\.slice\(1\)\)/);
  for (const label of ['免費與會員差在哪裡', '14 天怎麼判斷值不值得', '盤前決策', '收盤驗證']) {
    assert.match(pricing, new RegExp(label), `pricing is missing concrete member value: ${label}`);
  }
});

test('core product pages have distinct jobs instead of repeated dashboard surfaces', () => {
  for (const label of ['研究摘要', '因果鏈', '雙向證據', '個股檔案', '使用方式', '收盤驗證']) {
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
  assert.match(memberNote, /humanizePublicRuntimeText/);
  assert.match(memberNote, /naturalizeResearchHeadline/);
  assert.match(memberNote, /是今天的主要觀察方向，先等市場承接確認/);
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
  assert.match(verification, /resolveClosingVerificationState/);
  assert.match(verification, /部分個股或期貨欄位不足/);
  assert.match(verification, /if \(isHistoricalFallback\)/);
  assert.match(verification, /不會把 .* 的進度誤標為今天/);
});

test('report pages translate public market labels and require a real closing outcome', () => {
  for (const label of ['>REPORTS CENTER<', '>Report<', '>FILTER<', '>LATEST RESEARCH<', '>ARCHIVE<']) {
    assert.doesNotMatch(reportsCenter, new RegExp(label, 'i'), `reports center renders an untranslated label: ${label}`);
  }
  assert.match(reportsCenter, /publicReportText/);
  assert.match(reportDetail, /resolveClosingVerificationState/);
  assert.match(reportDetail, /收盤方向已驗證（部分資料不足）/);
  assert.match(reportDetail, /歷史收盤驗證資料不足/);
  assert.match(reportDetail, /closingVerification\.taiexChange\.toFixed\(2\)/);
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

test('account health cards use the server-trimmed report contract instead of hard-coded missing data', () => {
  assert.match(accountDashboard, /getLatestReports\(30\)/);
  assert.match(accountDashboard, /payload\.market_data_snapshots/);
  assert.match(accountDashboard, /payload\.important_news/);
  assert.match(accountDashboard, /payload\.opening_radar/);
  assert.doesNotMatch(accountDashboard, /V8: Simplified — no direct market_data/);
  assert.match(accountInfoCards, /09:30 開盤校正/);
  assert.doesNotMatch(accountInfoCards, /09:15 開盤校正/);
  assert.match(accountInfoCards, /此份報告未納入可核對的新鮮新聞/);
  assert.match(reportDetail, /serverMarketSnapshots\.length/);
});


test('daily report freshness follows expected trading sessions and never writes the confidence/date template', () => {
  const reportGenerator = read('supabase/functions/generate-daily-report-v7/index.ts');
  const marketFreshness = read('supabase/functions/generate-daily-report-v7/market-freshness.ts');
  assert.match(reportGenerator, /computeMarketFreshnessDates/);
  assert.match(marketFreshness, /America\/New_York/);
  assert.match(marketFreshness, /filterRecentNewsRows/);
  assert.match(reportGenerator, /detectStaleCoreMarketData\(marketData,dates\)/);
  assert.match(reportGenerator, /applyBiasGuardrails\(marketData,dScore\.baseScore,dates\)/);
  assert.match(reportGenerator, /resolveEvidenceBackedDailySentence/);
  assert.match(reportGenerator, /isSyntheticDailySentence/);
  assert.match(reportGenerator, /dailySentenceFingerprint/);
  assert.match(reportGenerator, /previousDailySentence/);
  assert.ok(reportPayloadFunction.indexOf('toStringValue(report.today_quote)') < reportPayloadFunction.indexOf('toStringValue(v8Sentence.sentence)'));
  assert.doesNotMatch(reportGenerator, /marketBias\+'，信心 '\+confScore\+'\/100，基準日期 '/);
});

test('paid research enforces fresh evidence and complete beneficiary reasoning', () => {
  const reportGenerator = read('supabase/functions/generate-daily-report-v7/index.ts');
  assert.match(reportGenerator, /OPENAI_EVIDENCE_GUARDRAILS/);
  assert.match(reportGenerator, /發布時間在 48 小時內/);
  assert.match(reportGenerator, /enforceMemberResearchIntegrity/);
  assert.match(reportGenerator, /note\.data_status='partial'/);
  assert.match(reportGenerator, /note\.beneficiary_reasoning=orderedReasoning\.slice\(0,10\)/);
  assert.match(reportGenerator, /validation_signal:validation/);
  assert.match(reportGenerator, /invalidation_condition:invalidation/);
  assert.match(reportGenerator, /calculateMemberValueScore/);
  assert.match(reportGenerator, /evidenceBackedNoTrade/);
  assert.match(reportGenerator, /member_value_score_below_90/);
  assert.match(reportGenerator, /source_refs:record\.source_refs/);
  assert.match(reportGenerator, /applyV10EvidenceBackedNarrative/);
  assert.match(reportGenerator, /premium_content_gate/);
});

test('content intelligence applies the approved 100-point editorial score and rejects generic copy', () => {
  for (const dimension of [
    'evidence',
    'freshness',
    'taiwan_relevance',
    'specificity',
    'actionability',
    'risk',
    'originality',
    'readability',
  ]) {
    assert.match(contentIntelligence, new RegExp(`\\b${dimension}\\b`));
  }
  assert.match(contentIntelligence, /RUNTIME_QUALITY_POLICY/);
  assert.match(contentIntelligence, /gradeContentScore/);
  assert.match(contentIntelligence, /premium_publish_min/);
  assert.match(contentIntelligence, /generic_content_detected/);
  assert.match(premiumGate, /evaluateContentIntelligence/);
  assert.match(premiumGate, /content_score_breakdown/);
  assert.match(dailyReportGenerator, /內容評分 \$\{contentReview\.score\}\/100/);
  assert.doesNotMatch(dailyReportGenerator, /未達 80 分發布門檻/);
});

test('report, site payload, and LINE converge on the same immutable decision snapshot', () => {
  assert.match(dailyReportGenerator, /publish_decision_snapshot_v3/);
  assert.match(dailyReportGenerator, /buildCanonicalDecisionPayload/);
  assert.match(reportPayloadFunction, /\.from\("decision_snapshots"\)/);
  assert.match(reportPayloadFunction, /canonical_decision/);
  assert.match(lineDailyPush, /\.from\('decision_snapshots'\)/);
  assert.match(lineDailyPush, /decisionSnapshot\?\.generated_text/);
  assert.match(closingVerification, /opening_decision_snapshot_id/);
  assert.match(closingVerification, /p_session_type:\s*"CLOSING"/);
  assert.match(closingVerification, /closing_decision_snapshot_id/);
  assert.match(contentIntelligenceMigration, /pg_advisory_xact_lock/);
  assert.match(contentIntelligenceMigration, /snapshot_fingerprint/);
  assert.match(contentIntelligenceMigration, /editorial_reviews/);
  assert.match(contentIntelligenceMigration, /content_feedback/);
  assert.match(contentIntelligenceMigration, /research_sessions/);
  assert.match(contentIntelligenceMigration, /research_facts/);
  assert.match(contentIntelligenceMigration, /research_catalysts/);
  assert.match(contentIntelligenceMigration, /catalyst_tw_mappings/);
});

test('production recovery migration closes public write and raw snapshot exposure', () => {
  assert.match(contentIntelligenceMigration, /alter table public\.intraday_checks enable row level security/);
  assert.match(contentIntelligenceMigration, /alter table public\.market_data_snapshots enable row level security/);
  assert.match(contentIntelligenceMigration, /revoke all on table public\.market_data_snapshots from anon, authenticated/);
  assert.match(contentIntelligenceMigration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*public\.reports from anon, authenticated/);
  assert.match(contentIntelligenceMigration, /drop policy if exists reports_authenticated_read_temporary on public\.reports/);
  assert.match(contentIntelligenceMigration, /create policy reports_admin_read/);
  assert.match(contentIntelligenceMigration, /profiles\.id = \(select auth\.uid\(\)\)/);
  assert.match(contentIntelligenceMigration, /revoke select on table public\.reports from anon, authenticated/);
  assert.match(contentIntelligenceMigration, /security_invoker = true/);
});

test('LINE daily push is paginated, multicast, retry-safe, and subscriber-idempotent', () => {
  const lineDailyPush = read('supabase/functions/line-daily-push/index.ts');
  assert.match(lineDailyPush, /SUBSCRIBER_PAGE_SIZE = 1000/);
  assert.match(lineDailyPush, /LINE_MULTICAST_BATCH_SIZE = 500/);
  assert.match(lineDailyPush, /fetchAlreadySentIds/);
  assert.match(lineDailyPush, /'ALREADY_SENT'/);
  assert.match(lineDailyPush, /message\/multicast/);
  assert.match(lineDailyPush, /X-Line-Retry-Key/);
  assert.match(lineDailyPush, /customAggregationUnits/);
  assert.match(lineDailyPush, /dailySentence\.sentence/);
  assert.ok(lineDailyPush.indexOf('report.today_quote') < lineDailyPush.indexOf('copy.one_sentence'));
  assert.match(lineDailyPush, /確認：/);
  assert.match(lineDailyPush, /避免：/);
  assert.doesNotMatch(lineDailyPush, /sent:\s*true,\s*report_date: reportDate,\s*total_subscribers: 0/);
});


test('closing verification accepts delayed same-day close snapshots without weakening provenance', () => {
  const contract = read('supabase/functions/_shared/intraday-runtime-contract.ts');
  const engine = read('supabase/functions/closing-verification-engine/index.ts');
  assert.match(contract, /row\.phase !== "close"/);
  assert.match(contract, /row\.trading_date !== tradingDate/);
  assert.match(contract, /taipeiDateFromIso\(row\.captured_at\) !== tradingDate/);
  assert.match(contract, /capturedMinutes <= 18 \* 60/);
  assert.match(engine, /T10:00:00\.000Z/);
  assert.match(engine, /13:30-18:00 台北收盤驗證窗口內/);
});

test('closing verification never falls back to legacy stocks after V10 cutover', () => {
  const engine = read('supabase/functions/closing-verification-engine/index.ts');
  assert.match(engine, /isV10BeneficiaryEnabled/);
  assert.match(engine, /ai\.today_beneficiary_stocks_v10/);
  assert.match(engine, /const secondary = v10Enabled\s*\? \[\]/);
  assert.match(engine, /beneficiary_decision_mode/);
  assert.match(engine, /not_applicable_no_recommendations/);
  assert.match(engine, /個股命中驗證不適用/);
});
