import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import type { Report } from '@/types/report';
import { trackPageView, trackEvent } from '@/utils/analytics';
import { trackEngagementEvent } from '@/services/engagementService';
import { useHomeDashboard } from '@/hooks/useHomeDashboard';
import { formatTaipeiDate } from '@/utils/tradingDay';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildMarketState, type MarketState } from '@/services/marketStateEngine';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import { renderSafeText } from '@/utils/renderSafe';

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function formatTaipeiTime(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

type TimelineStatus = 'completed' | 'current' | 'upcoming' | 'paused';

interface TimelineNode {
  time: string;
  minute: number;
  label: string;
  detail: string;
  status: TimelineStatus;
}

interface OpportunityPreviewItem {
  symbol: string;
  name: string;
  priority: string;
  reason: string;
}

function getTaipeiMinutes(timestamp: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function mapOpportunityStock(stock: Record<string, unknown>): OpportunityPreviewItem | null {
  const symbol = firstString(stock.symbol, stock.ticker, stock.code, stock.stock_code);
  const name = firstString(stock.name, stock.stock_name, stock.company_name);
  const priorityValue = stock.priority ?? stock.star_rating ?? stock.stars;
  const priority = typeof priorityValue === 'string' || typeof priorityValue === 'number'
    ? String(priorityValue)
    : '';
  const reason = firstString(stock.reason, stock.investment_reason, stock.why, stock.role, stock.selection_reason);
  if (!symbol && !name) return null;
  return { symbol, name, priority, reason };
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

  // When morningState is not yet available, use data.report as fallback.
  // This prevents blank pages when resolveMorningAlphaState silently fails.
  const fallbackReport = data?.report ?? null;
  const fallbackMorningAlpha = data?.morningAlpha ?? null;

  // Date display — morningState first, then data.report, then today
  const dataStatus = ms?.dataStatus ?? null;
  const displayReportDate = dataStatus === 'missing_today_report' || dataStatus === 'market_closed'
    ? todayTaipeiStr
    : (ms?.reportDate || fallbackReport?.report_date || fallbackMorningAlpha?.reportDate || todayTaipeiStr);
  const displayMarketDataDate = ms?.marketDataDate || ms?.activeReport?.marketDataBasisDate || fallbackMorningAlpha?.marketDataBasisDate || '—';
  const displayUsMarketDate = ms?.usMarketDate || fallbackMorningAlpha?.usMarketBasisDate || '—';
  const fallbackAI = asRecord(fallbackReport?.ai_strategy_json);
  const nestedAI = asRecord(fallbackAI?.ai_strategy_json);
  const generatedAtFallback = firstString(
    ms?.activeReport?.generatedAt,
    fallbackMorningAlpha?.generatedAt,
    fallbackAI?.generated_at,
    fallbackAI?.generatedAt,
    fallbackAI?.report_generated_at,
    (fallbackReport as Record<string, unknown> | null)?.generated_at,
    fallbackReport?.created_at,
    (fallbackReport as Record<string, unknown> | null)?.updated_at,
    nestedAI?.generated_at,
  );
  const displayCreatedAt = ms?.createdAtTaipei && ms.createdAtTaipei !== '—'
    ? ms.createdAtTaipei
    : formatTaipeiTime(generatedAtFallback);

  // Status — morningState first, then fallback
  const isTodayReport = ms?.isReportForToday ?? (fallbackReport?.report_date === todayTaipeiStr);
  const reportExists = dataStatus === 'missing_today_report'
    ? false
    : (ms?.reportExists ?? (!!fallbackReport || !!fallbackMorningAlpha?.reportId));
  const publishReady = ms?.publishReady ?? fallbackMorningAlpha?.publishReady ?? false;
  // Unified data contract: single display state for all core pages.
  // Home, TodayReport, Opportunities, WarRoom, MemberNote ALL read from the same parser.
  // No more page-level ai_strategy_json parsing. No more root column fallback inconsistency.
  const displayState: MorningAlphaDisplayState = useMemo(() => {
    return getMorningAlphaDisplayState(ms?.resolveResult?.rawRow as Record<string, unknown> | null ?? null);
  }, [ms]);

  // These now read from the unified displayState — same values as TodayReport, Opportunities, WarRoom, MemberNote
  const displayBias = displayState.marketBias;
  const displayConfidence = displayState.confidenceScore;
  const marketClosedInfo = { closed: displayState.market_status !== 'OPEN', holidayName: displayState.holidayName };

  const homeAI = ms?.resolveResult?.rawRow?.ai_strategy_json as Record<string, unknown> | null;
  const canonicalNarrative = useMemo(() => buildCanonicalNarrative({
    displayState,
    ai: homeAI,
  }), [displayState, homeAI]);
  const decisionLifecycle = canonicalNarrative.decision_lifecycle;
  const homePrimaryTheme = firstString(
    canonicalNarrative.today_script.headline,
    canonicalNarrative.today_focus.headline,
    '資料不足',
  );
  const homeCoreScript = firstString(
    canonicalNarrative.today_focus.summary,
    canonicalNarrative.today_focus.headline,
    '資料不足，等待盤前報告補齊。',
  );
  const homeDontDo = firstString(
    canonicalNarrative.today_focus.risk,
    canonicalNarrative.failure_triggers[0]?.action,
    '資料不足，暫不建立操作提醒。',
  );
  const homeNextVerification = firstString(
    canonicalNarrative.intraday_progress.next_step,
    canonicalNarrative.today_script.current_step,
    '資料不足，等待下一個驗證點。',
  );

  // V377: Simplified display mode — report exists + is for today = normal
  // V8.3: Added market-closed check from ai_strategy_json
  const displayMode = useMemo(() => {
    if (dataStatus === 'market_closed' || marketClosedInfo.closed) return 'market-closed';
    if (dataStatus === 'missing_today_report') return 'no-report';
    if (dataStatus === 'stale_reference_only') return 'not-today';
    if (!reportExists) return 'no-report';
    if (!isTodayReport) return 'not-today';
    return 'normal';
  }, [dataStatus, reportExists, isTodayReport, marketClosedInfo]);

  const [timelineNow, setTimelineNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setTimelineNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const closingAI = asRecord(homeAI?.closing_verification_v2) || asRecord(homeAI?.closing_verification);
  const closingStatus = firstString(closingAI?.status).toLowerCase();
  const hasCompletedClosing = closingStatus === 'completed' || closingStatus === 'direction_completed_data_degraded';
  const currentTaipeiMinutes = getTaipeiMinutes(timelineNow);
  const timelineNodes: TimelineNode[] = useMemo(() => {
    const baseNodes = [
      { time: '07:30', minute: 450, label: '今日劇本', detail: '讀懂今天唯一要驗證的主線。' },
      { time: '09:30', minute: 570, label: '開盤驗證', detail: '確認開盤方向是否支持盤前假設。' },
      { time: '13:30', minute: 810, label: '主線追蹤', detail: '檢查主線擴散、失效條件與停損訊號。' },
      { time: '14:10', minute: 850, label: '收盤驗證', detail: '用真實收盤結果回看今天的判斷。' },
    ];
    if (displayMode === 'market-closed' || !displayState.is_trading_day) {
      return baseNodes.map((node) => ({ ...node, status: 'paused' as const }));
    }
    return baseNodes.map((node, index) => {
      const nextNode = baseNodes[index + 1];
      let status: TimelineStatus = currentTaipeiMinutes < node.minute ? 'upcoming' : 'current';
      if (nextNode && currentTaipeiMinutes >= nextNode.minute) status = 'completed';
      if (!nextNode && hasCompletedClosing) status = 'completed';
      return { ...node, status };
    });
  }, [currentTaipeiMinutes, displayMode, displayState.is_trading_day, hasCompletedClosing]);

  const currentTimelineNode = timelineNodes.find((node) => node.status === 'current')
    || timelineNodes.find((node) => node.status === 'upcoming')
    || timelineNodes[timelineNodes.length - 1];
  const lifecycleStatus = decisionLifecycle.decision_status.status;
  const missionStatus = displayMode === 'market-closed'
    ? '今日流程暫停'
    : lifecycleStatus === 'Completed' || lifecycleStatus === 'Rejected'
      ? '已完成'
      : lifecycleStatus === 'Confirmed'
        ? '驗證中'
        : currentTaipeiMinutes < 450 ? '準備中' : '等待驗證';
  const missionStatusTone = missionStatus === '已完成'
    ? 'ma-badge-success'
    : missionStatus === '驗證中'
      ? 'ma-badge-info'
      : missionStatus === '今日流程暫停'
        ? 'ma-badge-neutral'
        : 'ma-badge-warning';
  const missionHeadline = firstString(
    decisionLifecycle.question.question,
    canonicalNarrative.today_focus.headline,
    homePrimaryTheme,
  );
  const missionSummary = firstString(
    decisionLifecycle.current_thesis.summary,
    canonicalNarrative.today_focus.summary,
    homeCoreScript,
  );
  const missionRisk = firstString(
    decisionLifecycle.failure_condition.trigger,
    decisionLifecycle.failure_condition.meaning,
    homeDontDo,
  );
  const nextAction = firstString(
    decisionLifecycle.decision_status.next_step,
    canonicalNarrative.intraday_progress.next_step,
    homeNextVerification,
  );
  const nextActionTime = displayMode === 'market-closed'
    ? displayState.nextUpdateTime
    : `${currentTimelineNode.time} ${currentTimelineNode.label}`;

  const opportunityPreview = useMemo(() => {
    const source = displayState.v10BeneficiaryEnabled
      ? displayState.v10BeneficiaryStocks
      : displayState.coreBeneficiaryStocks.length > 0
        ? displayState.coreBeneficiaryStocks
        : displayState.beneficiaryStocks;
    return source.map(mapOpportunityStock).filter((item): item is OpportunityPreviewItem => item !== null).slice(0, 5);
  }, [displayState.beneficiaryStocks, displayState.coreBeneficiaryStocks, displayState.v10BeneficiaryEnabled, displayState.v10BeneficiaryStocks]);

  const completedVerification = useMemo(() => {
    const review = data?.todayCloseVerification;
    if (review && firstString(review.verification_label, review.verification_result, review.verification_note)) {
      return {
        date: review.report_date,
        result: firstString(review.verification_label, review.verification_result),
        summary: firstString(review.verification_note, review.actual_market_result),
      };
    }
    if (!hasCompletedClosing) return null;
    return {
      date: firstString(closingAI?.report_date, displayReportDate),
      result: firstString(closingAI?.verdict_label, closingAI?.hit_or_miss, closingAI?.prediction_result),
      summary: firstString(closingAI?.verification_note, closingAI?.summary, closingAI?.what_was_right),
    };
  }, [closingAI, data?.todayCloseVerification, displayReportDate, hasCompletedClosing]);

  // V28: hasReportData — true when we have data from EITHER morningState or fallback
  const hasReportData = hasMorningState || !!fallbackReport || !!fallbackMorningAlpha?.reportId;

  useEffect(() => {
    trackPageView('/');
    trackEngagementEvent('view_home');
  }, []);

  // ═══ Loading ═══
  if (loading && !hasReportData) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-foreground-500 text-sm">載入中...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ═══ Error ═══
  if (error && !hasReportData) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-error-warning-line text-red-500 text-3xl mb-3"></i>
            <h2 className="text-foreground-900 font-semibold text-base mb-2">讀取資料失敗</h2>
            <p className="text-foreground-500 text-sm mb-4">{error}</p>
            <button
              onClick={() => refresh()}
              className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-xl transition-colors whitespace-nowrap"
            >
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // V377: 3-state status badge — simple and professional
  const statusBadge = (() => {
    switch (displayMode) {
      case 'no-report':
        return { label: '目前暫時無法讀取今日資料，請稍後再試', color: 'bg-amber-500/12 border-amber-400/35 text-amber-300', dot: 'bg-amber-400', icon: 'ri-time-line' };
      case 'not-today':
        return { label: '歷史資料模式', color: 'bg-sky-500/12 border-sky-400/35 text-sky-300', dot: 'bg-sky-400', icon: 'ri-history-line' };
      case 'market-closed':
        return { label: '🔴 非交易日', color: 'bg-red-500/12 border-red-400/35 text-red-300', dot: 'bg-red-400', icon: 'ri-calendar-close-line' };
      case 'normal':
        return { label: '今日盤前報告已更新', color: 'bg-emerald-500/12 border-emerald-400/35 text-emerald-300', dot: 'bg-emerald-400', icon: 'ri-check-double-line' };
    }
  })();

  // ═══ Bias color ═══
  const biasColorClass = (() => {
    const b = displayBias || '';
    if (b.includes('偏多') || b.includes('偏強') || b.includes('強多')) return 'text-red-600';
    if (b.includes('偏空') || b.includes('偏弱') || b.includes('強空')) return 'text-emerald-600';
    if (b.includes('震盪') || b.includes('中性') || b.includes('觀察') || b.includes('盤整')) return 'text-amber-600';
    return 'text-foreground-700';
  })();

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
    <div className="min-h-screen bg-background-50 flex flex-col overflow-x-hidden">
      <Navbar marketState={marketState} />

      <main className="flex-1 overflow-x-hidden">

        {/* ═══════════════════════════════════════ */}
        {/* HERO — Simplified, date-focused */}
        {/* ═══════════════════════════════════════ */}
        <section className="relative w-full border-b border-background-200/70 bg-background-50 px-5 pt-8 pb-10 md:px-6 md:pt-12 md:pb-12 overflow-hidden">
          <div className="relative max-w-5xl mx-auto w-full">
            <p className="text-white/35 text-[10px] uppercase tracking-[0.3em] font-semibold mb-6">
              MORNING ALPHA
            </p>

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
                      非交易日 Morning Alpha 不產生盤前判斷、受惠股、盤中追蹤與研究筆記。所有分析將於下一個交易日自動恢復。
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* ═══ Normal / Needs Review ═══ */}
            {(displayMode === 'normal') && hasReportData && (
              <div className="max-w-4xl">
                <div className="mb-5 flex flex-wrap items-center gap-2.5 text-xs text-white/70">
                  <span>{displayReportDate}</span>
                  <span aria-hidden="true" className="text-white/25">•</span>
                  <span>{displayState.market_message || '台股交易日'}</span>
                  <span className={`ma-badge ${missionStatusTone}`}>{missionStatus}</span>
                </div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">Today&apos;s Mission</p>
                <h1 className="max-w-3xl text-3xl font-bold leading-tight text-white md:text-5xl lg:text-6xl">
                  今天唯一要驗證的劇本
                </h1>
                <p className="mt-5 max-w-3xl text-lg font-semibold leading-relaxed text-white/90 md:text-2xl">
                  {renderSafeText(missionHeadline)}
                </p>
                {missionSummary && missionSummary !== missionHeadline && (
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/62 md:text-base">
                    {renderSafeText(missionSummary)}
                  </p>
                )}
                <div className="mt-6 max-w-2xl rounded-2xl border border-white/10 bg-white/[0.06] p-4 md:p-5">
                  <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">下一個行動</p>
                      <p className="mt-1 text-sm font-semibold leading-relaxed text-white">{renderSafeText(nextAction)}</p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">下次回來</p>
                      <p className="mt-1 whitespace-nowrap text-sm font-bold text-amber-200">{nextActionTime}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link
                    to="/war-room"
                    onClick={() => trackEvent('click_war_room', { location: 'home_hero_v2' })}
                    className="ma-btn-primary w-full sm:w-auto"
                  >
                    開始今天判斷
                    <i className="ri-arrow-right-line" aria-hidden="true"></i>
                  </Link>
                  <Link
                    to="/member-note"
                    onClick={() => {
                      trackEvent('click_member_note', { location: 'home_hero_v2' });
                      trackEngagementEvent('click_free_summary');
                    }}
                    className="ma-btn-secondary w-full sm:w-auto"
                  >
                    查看完整研究
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        {(displayMode === 'normal' || displayMode === 'market-closed') && hasReportData && (
          <section className="ma-section pt-0 md:pt-0" aria-labelledby="trading-timeline-title">
            <div className="ma-section-inner">
              <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
                <div>
                  <p className="ma-eyebrow mb-2">Trading Timeline</p>
                  <h2 id="trading-timeline-title" className="text-foreground-900 font-bold text-xl md:text-2xl">今天的判斷節奏</h2>
                </div>
                <p className="text-foreground-500 text-sm">
                  {isClosedMarket ? '今日休市，交易流程暫停。' : `目前節點：${currentTimelineNode?.label || '等待今日流程'}`}
                </p>
              </div>
              <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {timelineNodes.map((node) => {
                  const statusLabel = node.status === 'completed' ? '已完成' : node.status === 'current' ? '目前' : node.status === 'paused' ? '休市暫停' : '稍後';
                  const statusIcon = node.status === 'completed'
                    ? 'ri-check-line'
                    : node.status === 'current'
                      ? 'ri-focus-3-line'
                      : node.status === 'paused'
                        ? 'ri-pause-line'
                        : 'ri-time-line';
                  const statusClass = node.status === 'current'
                    ? 'border-amber-400/40 bg-amber-500/[0.06]'
                    : node.status === 'completed'
                      ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                      : 'border-background-200/80 bg-background-100';
                  const timeClass = node.status === 'current' ? 'text-amber-600' : 'text-foreground-700';

                  return (
                    <li
                      key={node.time}
                      aria-current={node.status === 'current' ? 'step' : undefined}
                      className={`min-w-0 rounded-2xl border p-4 md:p-5 ${statusClass}`}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <span className={`${timeClass} text-sm font-bold tabular-nums`}>{node.time}</span>
                        <span className="inline-flex items-center gap-1 text-foreground-500 text-[10px] font-semibold tracking-wide">
                          <i className={`${statusIcon} text-xs`} aria-hidden="true"></i>
                          {statusLabel}
                        </span>
                      </div>
                      <h3 className="text-foreground-900 font-bold text-sm mb-1">{node.label}</h3>
                      <p className="text-foreground-500 text-xs leading-relaxed">{node.detail}</p>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        )}

        {(displayMode === 'normal') && hasReportData && (
          <section className="w-full px-4 md:px-6 pb-10 md:pb-14">
            <div className="max-w-5xl mx-auto w-full space-y-10">
              <div aria-labelledby="decision-snapshot-title">
                <p className="ma-eyebrow mb-2">Decision Snapshot</p>
                <h2 id="decision-snapshot-title" className="text-foreground-900 font-bold text-xl md:text-2xl mb-5">今天的決策摘要</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <article className="md:col-span-2 min-w-0 bg-foreground-900 border border-foreground-800 rounded-2xl p-5 md:p-7 text-white">
                    <p className="text-amber-200 text-[10px] font-bold uppercase tracking-[0.22em] mb-3">Mission</p>
                    <h3 className="font-bold text-xl md:text-2xl leading-snug mb-3 break-words">{renderSafeText(missionHeadline)}</h3>
                    <p className="text-white/65 text-sm md:text-base leading-relaxed break-words">{renderSafeText(missionSummary)}</p>
                  </article>
                  <div className="grid grid-cols-1 gap-4">
                    <article className="min-w-0 bg-background-100 border border-background-200/70 rounded-2xl p-5">
                      <p className="text-red-600 text-[10px] font-bold uppercase tracking-[0.22em] mb-2">Risk</p>
                      <p className="text-foreground-900 text-sm font-semibold leading-relaxed break-words">{renderSafeText(missionRisk)}</p>
                    </article>
                    <article className="min-w-0 bg-background-100 border border-background-200/70 rounded-2xl p-5">
                      <p className="text-primary-600 text-[10px] font-bold uppercase tracking-[0.22em] mb-2">Next Step</p>
                      <p className="text-foreground-900 text-sm font-semibold leading-relaxed break-words">{renderSafeText(nextAction)}</p>
                    </article>
                    <article className="min-w-0 bg-background-100 border border-background-200/70 rounded-2xl p-5">
                      <p className="text-foreground-400 text-[10px] font-bold uppercase tracking-[0.22em] mb-2">Confidence</p>
                      <p className="text-foreground-900 text-lg font-bold">{displayConfidence === null ? '待確認' : `${displayConfidence}%`}</p>
                    </article>
                  </div>
                </div>
              </div>

              {opportunityPreview.length > 0 && (
                <div aria-labelledby="opportunity-preview-title">
                  <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
                    <div>
                      <p className="ma-eyebrow mb-2">Opportunity Preview</p>
                      <h2 id="opportunity-preview-title" className="text-foreground-900 font-bold text-xl md:text-2xl">今日受惠股預覽</h2>
                    </div>
                    <Link to="/opportunities" className="ma-btn-secondary">查看完整受惠股</Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {opportunityPreview.map((stock) => (
                      <article key={`${stock.symbol}-${stock.name}`} className="min-w-0 bg-background-100 border border-background-200/70 rounded-2xl p-5">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="min-w-0">
                            <p className="text-primary-600 text-xs font-bold mb-1">{stock.symbol}</p>
                            <h3 className="text-foreground-900 font-bold break-words">{stock.name}</h3>
                          </div>
                          {stock.priority && <span className="shrink-0 text-amber-700 text-xs font-semibold">{stock.priority}</span>}
                        </div>
                        {stock.reason && <p className="text-foreground-500 text-sm leading-relaxed break-words">{stock.reason}</p>}
                      </article>
                    ))}
                  </div>
                </div>
              )}

              {completedVerification && (completedVerification.result || completedVerification.summary) && (
                <article className="bg-foreground-900 border border-foreground-800 rounded-2xl p-5 md:p-6 text-white" aria-labelledby="previous-verification-title">
                  <div className="flex items-start justify-between gap-5 flex-wrap">
                    <div className="min-w-0 max-w-2xl">
                      <p className="text-amber-200 text-[10px] font-bold uppercase tracking-[0.22em] mb-2">Previous Verification</p>
                      <h2 id="previous-verification-title" className="text-white font-bold text-xl mb-3">最近一次收盤驗證</h2>
                      <div className="flex items-center gap-3 flex-wrap mb-3">
                        {completedVerification.date && <span className="text-white/50 text-xs">{completedVerification.date}</span>}
                        {completedVerification.result && <span className="text-white text-sm font-bold">{completedVerification.result}</span>}
                      </div>
                      {completedVerification.summary && <p className="text-white/65 text-sm leading-relaxed break-words">{completedVerification.summary}</p>}
                    </div>
                    <Link to="/performance" className="ma-btn-secondary shrink-0">查看歷史績效</Link>
                  </div>
                </article>
              )}

              <div className="bg-background-100 border border-background-200/70 rounded-2xl p-5 md:p-6">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <p className="text-primary-600 text-[10px] font-bold uppercase tracking-[0.24em] mb-1">Data Basis</p>
                    <h2 className="text-foreground-900 font-bold text-lg">今日資料基準</h2>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap ${statusBadge.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`}></span>
                    <i className={`${statusBadge.icon} text-xs`}></i>
                    {statusBadge.label}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs leading-relaxed">
                  <p className="text-foreground-500">台股基準：<span className="text-foreground-800 font-semibold">{displayMarketDataDate}{displayMarketDataDate === displayReportDate ? ' 資料基準' : ' 收盤'}</span></p>
                  <p className="text-foreground-500">美股與海外基準：<span className="text-foreground-800 font-semibold">{displayUsMarketDate}</span></p>
                  <p className="text-foreground-500">報告產生時間：<span className="text-foreground-800 font-semibold">{displayCreatedAt}</span></p>
                </div>
              </div>

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
                    盤前報告每天 07:30 自動產生。若時間已過仍未看到今日報告，請確認盤前報告排程是否正常執行。
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <Link
                    to="/report/today"
                    className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-primary-500 hover:bg-primary-600 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap"
                  >
                    查看上一份報告內容
                    <i className="ri-arrow-right-line"></i>
                  </Link>
                  <Link
                    to="/admin/data-truth"
                    className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-foreground-900 hover:bg-foreground-800 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                  >
                    <i className="ri-radar-line"></i>
                    前往資料真相檢查
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
                  Morning Alpha 每天早上自動產生盤前報告。若目前時間已過 07:30 仍未看到報告，請檢查後台資料真相檢查頁。
                </p>
                <Link
                  to="/admin/data-truth"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-foreground-900 hover:bg-foreground-800 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
                >
                  <i className="ri-radar-line"></i>
                  前往資料真相檢查
                </Link>
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
