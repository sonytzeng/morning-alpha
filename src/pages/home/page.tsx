import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import type { Report } from '@/types/report';
import { trackPageView } from '@/utils/analytics';
import { trackEngagementEvent } from '@/services/engagementService';
import { useHomeDashboard } from '@/hooks/useHomeDashboard';
import { formatTaipeiDate } from '@/utils/tradingDay';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildMarketState, type MarketState } from '@/services/marketStateEngine';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import { renderSafeText } from '@/utils/renderSafe';
import { buildDecisionPresentation } from '@/lib/decisionPresentation';
import VisualSectionHeader from '@/components/feature/VisualSectionHeader';
import {
  buildRuntimeDecisionTimeline,
  runtimeTimelineStatusLabel,
  type RuntimeTimelineStatus,
} from '@/lib/runtimeDecisionTimeline';

export default function HomePage() {
  return (
    <ErrorBoundary
      fallbackTitle="首頁暫時無法載入"
      fallbackMessage="資料讀取或畫面渲染時發生錯誤，請稍後再試。"
    >
      <HomePageContent />
    </ErrorBoundary>
  );
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

interface TimelineNode {
  time: string;
  label: string;
  detail: string;
  status: RuntimeTimelineStatus;
}

type UnknownRecord = Record<string, unknown>;

interface ObservationCard {
  title: string;
  reason: string;
  confirmation: string;
  invalidation: string;
}

interface MistakeCard {
  action: string;
  reason: string;
  result: string;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

const LOW_INFORMATION_TEXT = new Set([
  '',
  '資料不足',
  '資料待補',
  'unknown',
  'n/a',
  'no data',
  'null',
  'undefined',
]);

function isMeaningfulText(value: string): boolean {
  return !LOW_INFORMATION_TEXT.has(value.trim().toLowerCase());
}

function firstMeaningfulString(...values: unknown[]): string {
  for (const value of values) {
    const candidate = firstString(value);
    if (candidate && isMeaningfulText(candidate)) return candidate;
  }
  return '';
}

function isSyntheticResearchSentence(value: string): boolean {
  return /^今天要驗證的是\s*.+?\s*能否從.+?傳導到台股代表(?:個)?股[。.]?$/.test(value.trim());
}

function translateKnownTerms(value: string): string {
  return value
    .replace(/\bSEMICONDUCTOR\b/gi, '半導體')
    .replace(/\bAI SERVER\b/gi, 'AI 伺服器族群')
    .replace(/\bPETROCHEMICAL\b/gi, '塑化')
    .replace(/\bSHIPPING\b/gi, '航運')
    .replace(/\bTAIEX\b/gi, '加權指數')
    .replace(/\bTXF\b/gi, '台指期')
    .replace(/\bRuntime\b/gi, '盤中資料')
    .replace(/\b2330\b(?!\s*[／/])/g, '2330／台積電');
}

function uniqueStrings(values: string[], limit: number): string[] {
  return Array.from(new Set(
    values
      .map((value) => value.trim())
      .filter((value) => value && isMeaningfulText(value)),
  )).slice(0, limit);
}

function closingResultLabel(result: string, status: string): string {
  const normalizedResult = result.trim().toLowerCase();
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedResult === 'hit' && normalizedStatus.includes('degraded')) return '方向命中，資料仍不完整';
  if (normalizedResult === 'hit') return '命中';
  if (normalizedResult === 'partial' || normalizedResult === 'partial_hit') return '部分命中';
  if (normalizedResult === 'miss') return '未命中';
  if (normalizedStatus.includes('insufficient')) return '資料不足，尚無法驗證';
  return result;
}

function runtimePhaseLabel(node?: TimelineNode): string {
  if (!node) return '等待下一個驗證';
  switch (node.status) {
    case 'current': return `${node.label}中`;
    case 'completed': return `${node.label}已完成`;
    case 'insufficient': return `${node.label}資料不足`;
    case 'not_applicable': return `${node.label}不適用`;
    default: return `等待${node.label}`;
  }
}

function decisionDayLabel(state: string, hasTodayReport: boolean, currentNode?: TimelineNode): string {
  switch (state) {
    case 'ACT': return '攻擊日';
    case 'STOP': return '防守日';
    case 'CLOSED': return '休市日';
    case 'INSUFFICIENT_DATA': return hasTodayReport ? runtimePhaseLabel(currentNode) : '資料整理中';
    default: return '觀望日';
  }
}

function dataCompletenessLabel(status: string, hasReport: boolean): string {
  const normalized = status.trim().toLowerCase();
  if (['complete', 'completed', 'ready', 'reliable', 'ok', 'sufficient'].includes(normalized)) return '資料完整';
  if (['partial', 'degraded', 'limited', 'stale'].includes(normalized)) return '部分完成';
  return hasReport ? '盤前報告已載入' : '尚未取得報告';
}

function exposureLabel(state: string): string {
  switch (state) {
    case 'ACT': return '依計畫分批';
    case 'STOP': return '保持低曝險';
    case 'CLOSED': return '今日不適用';
    case 'INSUFFICIENT_DATA': return '暫不建立部位';
    default: return '暫不增加曝險';
  }
}

function homeDecisionCopy(state: string, currentNode?: TimelineNode): { headline: string; instruction: string } {
  switch (state) {
    case 'ACT': return { headline: '今日條件成立', instruction: '依計畫分批執行' };
    case 'STOP': return { headline: '今日條件已失效', instruction: '停止原定計畫' };
    case 'CLOSED': return { headline: '今日休市', instruction: '今天不執行盤中流程' };
    case 'INSUFFICIENT_DATA': return {
      headline: runtimePhaseLabel(currentNode),
      instruction: currentNode?.label === '開盤驗證' && currentNode.status === 'pending'
        ? '盤前暫不建立部位'
        : '暫不建立部位',
    };
    default: return { headline: '等待關鍵條件確認', instruction: '暫不追價，等待驗證' };
  }
}

function formatTaipeiTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '未提供更新時間';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未提供更新時間';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayValue(Math.round(value));
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const duration = 520;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{displayValue}{suffix}</>;
}

function HomeSkeleton() {
  return (
    <div className="ma-page ma-pixel-page ma-home-page ma-home-v2-page flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex-1" aria-busy="true" aria-label="今日決策資料載入中">
        <section className="ma-home-v2-skeleton-hero">
          <div className="ma-pixel-content ma-home-v2-skeleton-grid">
            <div>
              <div className="ma-home-v2-skeleton-line is-short" />
              <div className="ma-home-v2-skeleton-line is-title" />
              <div className="ma-home-v2-skeleton-line is-copy" />
              <div className="ma-home-v2-skeleton-line is-button" />
            </div>
            <div className="ma-home-v2-skeleton-metrics">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="ma-home-v2-skeleton-card" />
              ))}
            </div>
          </div>
        </section>
        <div className="ma-pixel-content ma-home-v2-content">
          {Array.from({ length: 4 }, (_, index) => (
            <section key={index} className="ma-home-v2-skeleton-section">
              <div className="ma-home-v2-skeleton-line is-short" />
              <div className="ma-home-v2-skeleton-card is-wide" />
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function HomePageContent() {
  const { data, loading, error, refresh, morningState } = useHomeDashboard();

  const report: Report | null = data?.report ?? null;
  const todayTaipeiStr = formatTaipeiDate();

  const marketState: MarketState = buildMarketState({
    todayReport: report,
    todayOpeningRadar: data?.openingRadar ?? null,
    todayMarketData: data?.marketDataTodayOnly ?? data?.marketData ?? null,
    todayCloseVerification: data?.todayCloseVerification ?? null,
  });

  // Stable mode: use morningState as single source of truth.
  const ms = morningState;
  const hasMorningState = !!ms;

  // Formal pages fail closed and never switch to an independently fetched report revision.
  const dataStatus = ms?.dataStatus ?? null;
  const displayReportDate = ms?.reportDate || todayTaipeiStr;
  const isTodayReport = ms?.isReportForToday ?? false;
  const reportExists = ms?.reportExists ?? false;
  const hasHistoricalReport = reportExists && !isTodayReport;
  // Unified data contract: single display state for all core pages.
  // Home, TodayReport, Opportunities, WarRoom, MemberNote ALL read from the same parser.
  // No more page-level ai_strategy_json parsing. No more root column fallback inconsistency.
  const displayState: MorningAlphaDisplayState = useMemo(() => {
    return getMorningAlphaDisplayState(ms?.resolveResult?.rawRow as unknown as Record<string, unknown> | null ?? null);
  }, [ms]);

  // These now read from the unified displayState — same values as TodayReport, Opportunities, WarRoom, MemberNote
  const marketIsClosed = displayState.market_status !== 'OPEN';

  const homeAI = ms?.resolveResult?.rawRow?.ai_strategy_json as Record<string, unknown> | null;
  const canonicalNarrative = useMemo(() => buildCanonicalNarrative({
    displayState,
    ai: homeAI,
  }), [displayState, homeAI]);

  // V377: Simplified display mode — report exists + is for today = normal
  // V8.3: Added market-closed check from ai_strategy_json
  const displayMode = useMemo(() => {
    if (dataStatus === 'market_closed' || marketIsClosed) return 'market-closed';
    if (dataStatus === 'missing_today_report') return hasHistoricalReport ? 'not-today' : 'no-report';
    if (dataStatus === 'stale_reference_only') return 'not-today';
    if (!reportExists) return 'no-report';
    if (!isTodayReport) return 'not-today';
    return 'normal';
  }, [dataStatus, hasHistoricalReport, reportExists, isTodayReport, marketIsClosed]);

  const timelineNodes: TimelineNode[] = buildRuntimeDecisionTimeline({
    ai: homeAI,
    hasReport: reportExists && isTodayReport,
    reportRevisionId: ms?.revisionId,
    reportGeneratedAt: ms?.generatedAt,
    isTradingDay: displayMode !== 'market-closed' && displayState.is_trading_day,
  });

  const currentTimelineNode = timelineNodes.find((node) => node.status === 'current')
    || timelineNodes.find((node) => node.status === 'pending')
    || timelineNodes[timelineNodes.length - 1];
  const presentation = useMemo(() => buildDecisionPresentation({
    displayState,
    narrative: canonicalNarrative,
    nextCheckpointFallback: `${currentTimelineNode.time} ${currentTimelineNode.label}`,
  }), [canonicalNarrative, currentTimelineNode.label, currentTimelineNode.time, displayState]);
  const decisionState = presentation.primaryDecision.state;
  const homeDecision = homeDecisionCopy(decisionState, currentTimelineNode);
  const nextAction = homeDecision.instruction;
  const decisionContext = translateKnownTerms([
    presentation.marketBiasLabel ? `今天市場${presentation.marketBiasLabel}。` : '',
    presentation.primaryDecision.reason,
  ].filter(Boolean).join(' ') || displayState.market_message || '今日資料整理中，正在等待市場資料完成。');
  const publicSummary = asRecord(homeAI?.public_summary);
  const openingRadar = asRecord(homeAI?.opening_radar);
  const intradayTracking = asRecord(homeAI?.intraday_tracking);
  const intradaySync = asRecord(homeAI?.intraday_sync_status);
  const closingV2 = asRecord(homeAI?.closing_verification_v2);
  const closingLegacy = asRecord(homeAI?.closing_verification);
  const closingSummary = asRecord(homeAI?.closing);
  const closingRecord = Object.keys(closingV2).length > 0
    ? closingV2
    : Object.keys(closingLegacy).length > 0
      ? closingLegacy
      : closingSummary;
  const closingStatus = firstString(
    closingRecord.status,
    closingRecord.data_status,
    closingRecord.verification_status,
  );
  const closingResultValue = firstString(
    closingRecord.verdict_label,
    closingRecord.prediction_result,
    closingRecord.result,
    closingRecord.hit_or_miss,
  );
  const hasRuntimeClosing = Boolean(closingResultValue || /completed|degraded|verified/.test(closingStatus.toLowerCase()));
  const nextActionTime = displayMode === 'market-closed'
    ? displayState.nextUpdateTime
    : hasRuntimeClosing ? '今日收盤驗證已完成' : (presentation.nextCheckpoint.time || currentTimelineNode.time);
  const nextActionLabel = hasRuntimeClosing
    ? '查看收盤驗證結果'
    : translateKnownTerms(presentation.nextCheckpoint.label || currentTimelineNode.label);
  const researchMaster = asRecord(homeAI?.research_master_v2);
  const researchMetadata = asRecord(researchMaster.metadata);
  const reportRecord = asRecord(report);
  const confidenceScore = firstNumber(
    presentation.confidence?.score,
    displayState.confidenceScore,
  );
  const riskLevel = firstString(
    homeAI?.risk_level,
    publicSummary.risk_level,
    openingRadar.risk_level,
    intradayTracking.risk_level,
  ) || '尚未定級';
  const lastUpdatedAt = firstString(
    homeAI?.data_as_of,
    openingRadar.data_as_of,
    openingRadar.updated_at,
    intradayTracking.updated_at,
    ms?.generatedAt,
  );
  const normalizedRiskLevel = riskLevel.toLowerCase();
  const riskLevelDisplay = ['high', 'critical', 'severe'].includes(normalizedRiskLevel)
    ? '高'
    : ['medium', 'moderate'].includes(normalizedRiskLevel)
      ? '中'
      : ['low', 'limited'].includes(normalizedRiskLevel)
        ? '低'
        : riskLevel;
  const aiVersion = firstString(
    homeAI?.version,
    homeAI?.engine_version,
    researchMetadata.engine_version,
    publicSummary.engine_version,
  ) || '未提供版本資訊';
  const morningBriefCandidate = firstMeaningfulString(
    homeAI?.morning_brief,
    publicSummary.morning_brief,
    canonicalNarrative.today_focus.why,
    canonicalNarrative.today_focus.summary,
    displayState.todayQuote,
    decisionContext,
  );
  const morningBrief = translateKnownTerms(
    isSyntheticResearchSentence(morningBriefCandidate)
      ? decisionContext
      : morningBriefCandidate,
  );
  const marketStatusLabel = decisionDayLabel(decisionState, reportExists && isTodayReport, currentTimelineNode);
  const decisionTone = decisionState === 'ACT'
    ? 'success'
    : decisionState === 'STOP'
      ? 'danger'
      : decisionState === 'CLOSED' || decisionState === 'INSUFFICIENT_DATA'
        ? 'neutral'
        : 'warning';

  const riskObservation = asRecord(displayState.v10ObservationWatchlist.find((source) => {
    const item = asRecord(source);
    return firstString(item.role, item.role_label).toUpperCase() === 'RISK';
  }));
  const largestRisk = translateKnownTerms(firstMeaningfulString(
    presentation.invalidationItems[0],
    riskObservation.observation_reason,
    riskObservation.narrative,
    canonicalNarrative.failure_triggers[0]?.trigger,
    canonicalNarrative.today_focus.risk,
  ) || '今日資料整理中，正在等待風險訊號完成。');
  const waitingFor = translateKnownTerms(hasRuntimeClosing
    ? firstMeaningfulString(
      displayState.v10Warning,
      intradaySync.warning,
      '等待缺失市場資料補齊',
    )
    : firstMeaningfulString(
      presentation.nextCheckpoint.label,
      canonicalNarrative.intraday_progress.next_step,
      currentTimelineNode.label,
      nextAction,
    ) || '等待下一個有效市場節點。');
  const finalDecisionReasons = uniqueStrings([
    presentation.primaryDecision.reason || '',
    ...(decisionState === 'ACT'
      ? presentation.confirmationItems
      : presentation.invalidationItems),
    ...canonicalNarrative.failure_triggers.map((item) => item.meaning),
    firstString(riskObservation.observation_reason),
  ], 4);

  const observationSource = [
    ...displayState.v10BeneficiaryStocks,
    ...displayState.coreBeneficiaryStocks,
    ...displayState.beneficiaryStocks,
    ...displayState.v10ObservationWatchlist,
  ];
  const observationCards = observationSource.reduce<ObservationCard[]>((items, source) => {
    const item = asRecord(source);
    const title = translateKnownTerms(firstMeaningfulString(
      item.role_title,
      item.role_label,
      item.name,
      item.stock_name,
      item.industry_name,
      item.industry,
      item.sector,
    ));
    const reason = translateKnownTerms(firstMeaningfulString(
      item.observation_reason,
      item.narrative,
      item.why_selected,
      item.reason,
      item.role_description,
    ));
    const confirmation = translateKnownTerms(firstMeaningfulString(
      item.validation_point,
      item.confirmation_reason,
      item.confirmation_needed,
      item.watch_point,
      item.action_implication,
    ));
    const invalidation = translateKnownTerms(firstMeaningfulString(
      item.stop_observing_condition,
      item.stop_condition,
      item.invalidation_condition,
      item.failure_condition,
      item.risk_note,
    ));
    if (!title || (!reason && !confirmation && !invalidation)) return items;
    const key = `${title}|${reason}|${confirmation}|${invalidation}`;
    if (items.some((existing) => `${existing.title}|${existing.reason}|${existing.confirmation}|${existing.invalidation}` === key)) return items;
    items.push({ title, reason, confirmation, invalidation });
    return items;
  }, []).slice(0, 3);

  const rawAvoidItems = [
    ...asArray(reportRecord.avoid_today),
    ...asArray(homeAI?.avoid_today),
    ...asArray(publicSummary.do_not_do),
    ...(typeof publicSummary.do_not_do === 'string' ? [publicSummary.do_not_do] : []),
  ];
  const mistakeCards = (rawAvoidItems.length > 0
    ? rawAvoidItems
    : canonicalNarrative.failure_triggers
  ).reduce<MistakeCard[]>((items, source, index) => {
    const item = asRecord(source);
    const failure = canonicalNarrative.failure_triggers[index];
    const action = firstMeaningfulString(
      item.title,
      item.avoid,
      item.action,
      item.trigger,
      typeof source === 'string' ? source : '',
    );
    const reason = firstMeaningfulString(
      item.reason,
      item.meaning,
      item.why,
      riskObservation.observation_reason,
      riskObservation.narrative,
      failure?.meaning,
      canonicalNarrative.today_focus.risk,
    );
    const result = firstMeaningfulString(
      item.result,
      item.consequence,
      item.action_note,
      riskObservation.stop_condition,
      riskObservation.stop_observing_condition,
      failure?.action,
      presentation.primaryDecision.instruction,
    );
    if (!action) return items;
    items.push({
      action: translateKnownTerms(action),
      reason: translateKnownTerms(reason),
      result: translateKnownTerms(result),
    });
    return items;
  }, []).slice(0, 3);

  const tradeReadiness = decisionState === 'ACT'
    ? '條件成立才做'
    : decisionState === 'STOP'
      ? '今天不做'
      : '先等待';
  const todayStrategy = translateKnownTerms(firstMeaningfulString(
    homeAI?.today_strategy,
    homeAI?.recommended_strategy,
    publicSummary.today_strategy,
    publicSummary.strategy,
    openingRadar.today_strategy,
    openingRadar.strategy,
    canonicalNarrative.today_focus.action,
    presentation.primaryDecision.instruction,
  ) || (decisionState === 'ACT' ? '只做已確認的主線' : '保留現金，等待確認'));
  const priorityFocus = observationCards.length > 0
    ? observationCards.map((item) => item.title).join('、')
    : waitingFor;
  const mostLikelyMistake = mistakeCards[0]?.action || largestRisk;

  const closingOutcome = canonicalNarrative.closing_outcome;
  const closingDisplayResult = closingResultLabel(
    firstMeaningfulString(closingOutcome.result, closingResultValue),
    closingStatus,
  );
  const hasClosingOutcome = Boolean(
    closingDisplayResult
    || closingOutcome.summary
    || closingOutcome.accuracy
    || closingOutcome.lessons.length,
  );
  const credibilityItems = [
    { label: '資料更新時間', value: formatTaipeiTimestamp(lastUpdatedAt) },
    { label: '分析版本', value: aiVersion },
    { label: '資料狀態', value: dataCompletenessLabel(displayState.dataStatus, reportExists) },
    {
      label: '判斷信心',
      value: confidenceScore == null ? '等待資料確認' : `${Math.round(confidenceScore)}/100`,
    },
  ];

  const hasReportData = hasMorningState && reportExists;

  useEffect(() => {
    trackPageView('/');
    trackEngagementEvent('view_home');
  }, []);

  // ═══ Loading ═══
  if (loading && !hasReportData) {
    return <HomeSkeleton />;
  }

  // ═══ Error ═══
  if (error && !hasReportData) {
    return (
      <div className="ma-page ma-pixel-page ma-home-page ma-home-v2-page flex min-h-screen flex-col">
        <Navbar />
        <main className="ma-home-v2-state-shell">
          <section className="ma-home-v2-state-card" role="status">
            <i className="ri-radar-line" aria-hidden="true" />
            <p className="ma-pixel-eyebrow">資料狀態</p>
            <h1>今日資料整理中</h1>
            <p>AI 正在等待市場資料完成。你可以稍後重新整理，不會顯示不完整的交易判斷。</p>
            <button
              onClick={() => refresh()}
              className="ma-pixel-primary-button"
            >
              重新載入
            </button>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  const closedHero = (() => {
    switch (displayState.market_status) {
      case 'TYPHOON':
        return {
          title: '今日休市',
          subtitle: '颱風停班停市',
          body: 'Morning Alpha 今日不建立交易劇本。今日沒有盤中驗證，AI 已切換休市模式。',
          primary: '查看昨日收盤驗證',
          primaryTo: '/war-room',
          secondary: '查看完整研究筆記',
          secondaryTo: '/member-note',
          chips: ['今晚國際市場', '下一交易日前瞻'],
        };
      case 'WEEKEND':
        return {
          title: '今天沒有台股交易',
          subtitle: '週末休市',
          body: 'Morning Alpha 今日不建立交易劇本，也不啟動盤中驗證。',
          primary: '查看本週總結',
          primaryTo: '/performance',
          secondary: '查看完整研究筆記',
          secondaryTo: '/member-note',
          chips: ['本週總結', '下一交易日前瞻'],
        };
      case 'HOLIDAY':
        return {
          title: '今日國定假日休市',
          subtitle: displayState.holidayName || '國定假日休市',
          body: 'Morning Alpha 今日不建立交易劇本，也不啟動盤中驗證。',
          primary: '查看昨日收盤驗證',
          primaryTo: '/war-room',
          secondary: '查看完整研究筆記',
          secondaryTo: '/member-note',
          chips: ['今晚國際市場', '下一交易日前瞻'],
        };
      default:
        return {
          title: '今日休市',
          subtitle: displayState.market_message || displayState.holidayName || '休市',
          body: 'Morning Alpha 今日不建立交易劇本，也不啟動盤中驗證。',
          primary: '查看昨日收盤驗證',
          primaryTo: '/war-room',
          secondary: '查看完整研究筆記',
          secondaryTo: '/member-note',
          chips: ['今晚國際市場', '下一交易日前瞻'],
        };
    }
  })();

  return (
    <div className="ma-page ma-pixel-page ma-home-page ma-home-v2-page flex flex-col overflow-x-hidden">
      <Navbar marketState={marketState} />

      <main className="flex-1 overflow-x-hidden">

        {displayMode === 'normal' && hasReportData && (
          <>
            <section className={`ma-home-v2-hero is-${decisionTone}`}>
              <div className="ma-pixel-content ma-home-v2-hero-grid">
                <div className="ma-home-v2-hero-copy">
                  <div className="ma-home-v2-status-row">
                    <span className={`ma-home-v2-status-badge is-${decisionTone}`}>
                      <span aria-hidden="true" />
                      {marketStatusLabel}
                    </span>
                    <span>{displayReportDate}</span>
                  </div>
                  <p className="ma-pixel-eyebrow"><i className="ri-focus-3-line" aria-hidden="true" />Morning Alpha 今日判斷</p>
                  <h1>{renderSafeText(homeDecision.instruction)}</h1>
                  <p className="ma-home-v2-hero-subtitle">{renderSafeText(decisionContext)}</p>
                  <div className="ma-home-v2-next-line">
                    <span>下一次確認</span>
                    <strong>{renderSafeText(nextActionTime)}</strong>
                    <span>{renderSafeText(nextActionLabel)}</span>
                  </div>
                  <div className="ma-home-v2-hero-actions">
                    <Link to="/report/today" className="ma-pixel-primary-button">
                      查看今日完整判斷
                      <i className="ri-arrow-right-line" aria-hidden="true" />
                    </Link>
                    <Link to="/member-note" className="ma-pixel-text-link">
                      查看完整研究
                      <i className="ri-arrow-right-line" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
                <div className="ma-home-v2-dashboard" aria-label="今日決策儀表板">
                  <article className="ma-home-v2-metric">
                    <p>判斷信心</p>
                    <strong>
                      {confidenceScore == null
                        ? '等待資料確認'
                        : <AnimatedNumber value={confidenceScore} suffix="/100" />}
                    </strong>
                    {confidenceScore != null && (
                      <div className="ma-home-v2-progress" aria-label={`AI 信心 ${Math.round(confidenceScore)} 分`}>
                        <span style={{ width: `${Math.min(100, Math.max(0, confidenceScore))}%` }} />
                      </div>
                    )}
                    <span>
                      {renderSafeText(translateKnownTerms(presentation.confidence?.explanation || '盤前信心，仍需盤中資料驗證'))}
                    </span>
                  </article>
                  <article className="ma-home-v2-metric">
                    <p>風險等級</p>
                    <strong>{renderSafeText(riskLevelDisplay)}</strong>
                    <span>依現有報告風險欄位</span>
                  </article>
                  <article className="ma-home-v2-metric">
                    <p>建議部位</p>
                    <strong>{exposureLabel(decisionState)}</strong>
                    <span>{renderSafeText(marketStatusLabel)}</span>
                  </article>
                  <article className="ma-home-v2-metric">
                    <p>資料更新</p>
                    <strong>{formatTaipeiTimestamp(lastUpdatedAt)}</strong>
                    <span>台北時間</span>
                  </article>
                </div>
              </div>
            </section>

            <div className="ma-pixel-content ma-home-v2-content">
              <section className="ma-home-v2-brief" aria-labelledby="morning-brief-title">
                <div>
                  <p className="ma-pixel-eyebrow"><i className="ri-sun-line" aria-hidden="true" />盤前摘要</p>
                  <h2 id="morning-brief-title">{renderSafeText(morningBrief)}</h2>
                </div>
                <dl className="ma-home-v2-credibility">
                  {credibilityItems.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{renderSafeText(item.value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-labelledby="four-answers-title">
                <VisualSectionHeader
                  icon="ri-question-answer-line"
                  title="今天先回答四件事"
                  description="三分鐘看完能不能做、怎麼做、先看什麼，以及最該避開的錯。"
                />
                <div className="ma-home-v2-answer-grid">
                  <article className={`ma-home-v2-answer-card is-${decisionTone}`}>
                    <p>今天值得交易嗎？</p>
                    <strong>{tradeReadiness}</strong>
                    <span>{renderSafeText(marketStatusLabel)}</span>
                  </article>
                  <article className="ma-home-v2-answer-card is-warning">
                    <p>今天適合哪種策略？</p>
                    <strong>{renderSafeText(todayStrategy)}</strong>
                    <span>只採用目前證據支持的做法</span>
                  </article>
                  <article className="ma-home-v2-answer-card is-neutral">
                    <p>今天優先看什麼？</p>
                    <strong>{renderSafeText(priorityFocus)}</strong>
                    <span>最多三項，往下查看成立與取消條件</span>
                  </article>
                  <article className="ma-home-v2-answer-card is-danger">
                    <p>今天最容易犯的錯？</p>
                    <strong>{renderSafeText(mostLikelyMistake)}</strong>
                    <span>{renderSafeText(largestRisk)}</span>
                  </article>
                </div>
              </section>

              <section aria-labelledby="final-decision-title">
                <VisualSectionHeader
                  icon="ri-brain-line"
                  title="今日最終判斷"
                  description="只呈現目前證據支持的結論，不用市場形容詞替代驗證。"
                />
                <article className={`ma-home-v2-decision-card is-${decisionTone}`}>
                  <div className="ma-home-v2-decision-lead">
                    <p>目前決策</p>
                    <h2 id="final-decision-title">{renderSafeText(homeDecision.headline)}</h2>
                    <strong>{renderSafeText(homeDecision.instruction)}</strong>
                    <span>{renderSafeText(presentation.primaryDecision.reason || decisionContext)}</span>
                  </div>
                  <div className="ma-home-v2-decision-evidence">
                    <p>判定依據</p>
                    {finalDecisionReasons.length > 0 ? (
                      <ul>
                        {finalDecisionReasons.map((reason) => (
                          <li key={reason}>
                            <i className="ri-check-line" aria-hidden="true" />
                            <span>{renderSafeText(translateKnownTerms(reason))}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="ma-home-v2-empty">
                        <strong>今日資料整理中</strong>
                        <span>AI 正在等待市場資料完成。</span>
                      </div>
                    )}
                    <div className="ma-home-v2-verdict">
                      <span>Morning Alpha 判定</span>
                      <strong>{renderSafeText(homeDecision.instruction)}</strong>
                    </div>
                  </div>
                </article>
                <div className="ma-home-v2-runtime" role="list" aria-label="今日驗證節點">
                  {timelineNodes.map((node) => (
                    <div key={node.time} className={`is-${node.status}`} role="listitem">
                      <span aria-hidden="true" />
                      <p>{node.time}</p>
                      <strong>{renderSafeText(node.label)}</strong>
                      <small>{runtimeTimelineStatusLabel(node.status)}</small>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-labelledby="observations-title">
                <VisualSectionHeader
                  icon="ri-radar-line"
                  title="今日優先觀察"
                  description="最多三項；先看為什麼入選，再看何時成立、何時取消。"
                />
                {observationCards.length > 0 ? (
                  <div className="ma-home-v2-observation-grid">
                    {observationCards.map((item) => (
                      <article key={`${item.title}-${item.reason}`} className="ma-home-v2-observation-card">
                        <div>
                          <p>優先觀察</p>
                          <h3>{renderSafeText(item.title)}</h3>
                        </div>
                        <div>
                          <p>原因</p>
                          <strong>{renderSafeText(item.reason || '今日資料整理中')}</strong>
                        </div>
                        <div>
                          <p>確認條件</p>
                          <strong>{renderSafeText(item.confirmation || '等待下一個有效市場節點確認。')}</strong>
                        </div>
                        <div>
                          <p>取消條件</p>
                          <strong>{renderSafeText(item.invalidation || '目前報告尚未提供取消條件，暫不升級判斷。')}</strong>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="ma-home-v2-empty is-section">
                    <strong>今日資料整理中</strong>
                    <span>AI 正在等待市場資料完成，不會用固定觀察句填補。</span>
                  </div>
                )}
              </section>

              <section aria-labelledby="mistakes-title">
                <VisualSectionHeader
                  icon="ri-error-warning-line"
                  title="今天最容易犯的錯"
                  description="把不要做、原因與可能結果放在同一條決策鏈。"
                />
                {mistakeCards.length > 0 ? (
                  <div className={`ma-home-v2-mistake-grid${mistakeCards.length === 1 ? ' is-single' : ''}`}>
                    {mistakeCards.map((item) => (
                      <article key={`${item.action}-${item.reason}`} className="ma-home-v2-mistake-card">
                        <div>
                          <span>不要做什麼</span>
                          <h3>{renderSafeText(item.action)}</h3>
                        </div>
                        <div>
                          <span>原因</span>
                          <p>{renderSafeText(item.reason || '今日資料整理中')}</p>
                        </div>
                        <div>
                          <span>容易造成什麼結果</span>
                          <p>{renderSafeText(item.result || 'AI 正在等待市場資料完成。')}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="ma-home-v2-empty is-section">
                    <strong>今日資料整理中</strong>
                    <span>AI 正在等待風險條件完成，不會顯示空泛提醒。</span>
                  </div>
                )}
              </section>

              <section className="ma-home-v2-analysis-cta" aria-labelledby="analysis-cta-title">
                <div>
                  <p className="ma-pixel-eyebrow"><i className="ri-node-tree" aria-hidden="true" />完整決策鏈</p>
                  <h2 id="analysis-cta-title">查看完整 AI 推理</h2>
                  <p>了解今天判斷如何形成。</p>
                </div>
                <Link to="/member-note" className="ma-pixel-primary-button">
                  查看完整 AI 推理
                  <i className="ri-arrow-right-line" aria-hidden="true" />
                </Link>
              </section>

              <section aria-labelledby="history-title">
                <VisualSectionHeader
                  icon="ri-line-chart-line"
                  title="歷史績效"
                  description="用最近一次真實收盤驗證，連回長期公開紀錄。"
                />
                <article className="ma-home-v2-history-card">
                  {hasClosingOutcome ? (
                    <div>
                      <p>最近一次收盤驗證</p>
                      <h2 id="history-title">{renderSafeText(closingDisplayResult)}</h2>
                      {closingOutcome.summary && <strong>{renderSafeText(closingOutcome.summary)}</strong>}
                      {closingOutcome.accuracy && <span>{renderSafeText(closingOutcome.accuracy)}</span>}
                    </div>
                  ) : (
                    <div className="ma-home-v2-empty">
                      <strong>驗證資料累積中</strong>
                      <span>完成收盤驗證後，這裡會呈現真實判斷結果。</span>
                    </div>
                  )}
                  <Link to="/performance" className="ma-pixel-text-link">
                    查看完整歷史績效
                    <i className="ri-arrow-right-line" aria-hidden="true" />
                  </Link>
                </article>
              </section>

              <section className="ma-home-v2-footer-cta">
                <div>
                  <p>下一個決策節點</p>
                  <h2>{renderSafeText(nextActionTime)}</h2>
                  <span>{renderSafeText(waitingFor)}</span>
                </div>
                <Link to="/report/today" className="ma-pixel-primary-button">
                  回到今日判斷
                  <i className="ri-arrow-right-line" aria-hidden="true" />
                </Link>
              </section>
            </div>
          </>
        )}
        {displayMode !== 'normal' && (
        <section className="relative w-full overflow-hidden border-b border-background-200/70 bg-background-50 px-5 py-4 md:px-6 md:py-5">
          <div className="relative max-w-5xl mx-auto w-full">

            {/* ═══ Safe Mode: No Report ═══ */}
            {displayMode === 'no-report' && (
              <div className="bg-amber-500/[0.08] border border-amber-400/30 rounded-2xl p-6 mb-6 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
                  <i className="ri-time-line text-amber-400 text-2xl"></i>
                </div>
                <h1 className="text-white font-bold text-xl md:text-2xl mb-2">
                  今日報告尚未產生
                </h1>
                <p className="text-amber-200/70 text-sm leading-relaxed max-w-md mx-auto">
                  目前尚未取得今日報告，請稍後再查看。每天 07:30 自動更新。
                </p>
              </div>
            )}

            {/* ═══ Safe Mode: Not Today's Report ═══ */}
            {displayMode === 'not-today' && hasReportData && (
              <div className="bg-red-500/[0.06] border border-red-400/25 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-400/20 flex items-center justify-center flex-shrink-0">
                    <i className="ri-calendar-check-line text-red-400 text-lg"></i>
                  </div>
                  <div>
                    <h1 className="text-white font-bold text-xl md:text-2xl mb-1">
                      今日盤前報告尚未產生
                    </h1>
                    <p className="text-red-200/70 text-sm leading-relaxed">
                      今日 {todayTaipeiStr} 尚無盤前報告，目前顯示最近一份報告（{displayReportDate}）。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ V10.0: Market Closed — Today's Market Status (NOT last report date) ═══ */}
            {displayMode === 'market-closed' && (
              <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-400/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xl">🔴</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h1 className="text-white font-bold text-xl md:text-2xl">
                        {closedHero.title}
                      </h1>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500/12 border border-red-400/30 rounded-full text-red-300 text-[10px] font-semibold whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                        {closedHero.subtitle}
                      </span>
                    </div>

                    <p className="text-white/78 text-sm leading-relaxed mb-4">{closedHero.body}</p>

                    {/* Date and reason */}
                    <div className="space-y-1.5 mb-4">
                      <p className="text-white/70 text-sm leading-relaxed">
                        <span className="text-white/40">日期：</span>
                        <span className="text-white/80 font-semibold">{displayState.currentDate}（{displayState.currentWeekday}）</span>
                      </p>
                      <p className="text-white/70 text-sm leading-relaxed">
                        <span className="text-white/40">市場狀態：</span>
                        <span className="text-white/80">{displayState.market_message}</span>
                      </p>
                      <p className="text-white/70 text-sm leading-relaxed">
                        <span className="text-white/40">下一個交易日：</span>
                        <span className="text-white/80 font-semibold">{displayState.nextTradingDate}（{displayState.nextTradingWeekday}）</span>
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 mb-4">
                      <Link to={closedHero.primaryTo} className="ma-btn-primary min-h-[40px] px-4 py-2 text-xs">{closedHero.primary}</Link>
                      <Link to={closedHero.secondaryTo} className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-white/10 border border-white/10 text-white text-xs font-semibold">{closedHero.secondary}</Link>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {closedHero.chips.map((chip) => (
                        <span key={chip} className="inline-flex rounded-full border border-white/12 bg-white/8 px-3 py-1 text-white/62 text-[10px] font-semibold">{chip}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ V10.0: Market Closed — Next Update Time Card ═══ */}
            {displayMode === 'market-closed' && (
              <section className="w-full px-4 md:px-6 pb-10 md:pb-14">
                <div className="max-w-5xl mx-auto w-full">
                  <div className="bg-background-100 border border-background-200/70 rounded-2xl p-6 md:p-8">
                    <div className="text-center mb-5">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-amber-500/10 border border-amber-400/20 flex items-center justify-center">
                        <i className="ri-time-line text-amber-400 text-2xl"></i>
                      </div>
                      <h2 className="text-foreground-900 font-bold text-lg mb-2">下一次更新時間</h2>
                      <p className="text-foreground-500 text-sm leading-relaxed max-w-md mx-auto">
                        Morning Alpha 盤前研究筆記將於：
                      </p>
                    </div>

                    <div className="max-w-sm mx-auto bg-background-50 border border-background-200/70 rounded-xl p-5 text-center">
                      <p className="text-foreground-900 font-bold text-xl mb-1">
                        {displayState.nextTradingDate}
                      </p>
                      <p className="text-foreground-500 text-sm mb-3">
                        {displayState.nextTradingWeekday}
                      </p>
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500/10 border border-primary-500/20 rounded-full">
                        <i className="ri-sun-line text-primary-500 text-sm"></i>
                        <span className="text-primary-600 font-semibold text-sm">07:30 自動更新</span>
                      </div>
                    </div>

                    <p className="text-foreground-400 text-xs text-center mt-5 leading-relaxed max-w-lg mx-auto">
                      今日非交易日，本節點不適用；等待下一個交易日。
                    </p>
                  </div>
                </div>
              </section>
            )}

          </div>
        </section>
        )}

        {/* ═══ Safe Mode: Not Today — reference card only ═══ */}
        {displayMode === 'not-today' && hasReportData && (
          <section className="w-full px-4 md:px-6 pb-10 md:pb-14">
            <div className="max-w-5xl mx-auto w-full">
              <div className="bg-background-100 border border-background-200/70 rounded-2xl p-6 md:p-8">
                <h2 className="text-foreground-900 font-bold text-lg mb-3">
                  上一份盤前報告參考｜{displayReportDate}
                </h2>
                <p className="text-foreground-500 text-sm leading-relaxed mb-4">
                  今日 {todayTaipeiStr} 尚無盤前報告，以下為歷史資料模式（{displayReportDate}）僅供參考，非今日盤前報告。
                </p>
                <div className="bg-amber-500/[0.04] border border-amber-400/20 rounded-xl p-4 mb-5">
                  <p className="text-amber-700 text-xs leading-relaxed">
                    盤前報告每天 07:30 更新；今日內容尚未完成前，歷史日期會清楚標示，不會當成今日判斷。
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <Link
                    to={`/reports/${displayReportDate}`}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-primary-500 hover:bg-primary-600 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap"
                  >
                    查看 {displayReportDate} 公開報告
                    <i className="ri-arrow-right-line"></i>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ═══ Safe Mode: No Report — secondary message ═══ */}
        {displayMode === 'no-report' && (
          <section className="w-full px-4 md:px-6 pb-10 md:pb-14">
            <div className="max-w-5xl mx-auto w-full">
              <div className="bg-background-100 border border-background-200/70 rounded-2xl p-6 md:p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-background-50 border border-background-200/70 flex items-center justify-center">
                  <i className="ri-sun-line text-foreground-300 text-2xl"></i>
                </div>
                <h2 className="text-foreground-900 font-bold text-lg mb-2">
                  每天 07:30 自動更新
                </h2>
                <p className="text-foreground-500 text-sm leading-relaxed max-w-md mx-auto mb-6">
                  今日盤前內容尚未就緒。完成後會自動出現在首頁；目前不顯示不完整判斷，也不以舊資料冒充今日內容。
                </p>
                <button
                  type="button"
                  onClick={() => refresh()}
                  className="ma-btn-secondary whitespace-nowrap"
                >
                  <i className="ri-refresh-line"></i>
                  重新檢查最新內容
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* Disclaimer */}
        {/* ═══════════════════════════════════════ */}
        <section className="w-full px-4 md:px-6 pb-10 md:pb-16">
          <div className="max-w-5xl mx-auto w-full text-center">
            <p className="text-foreground-400 text-xs leading-relaxed max-w-2xl mx-auto">
              本平台提供市場資訊整理與情緒判讀參考，不構成投資建議。Morning Alpha 由愛吉網路資訊有限公司營運，統一編號 60374105。
            </p>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
