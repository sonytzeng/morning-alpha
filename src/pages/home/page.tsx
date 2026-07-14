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
import { buildDecisionPresentation, formatCheckpoint } from '@/lib/decisionPresentation';
import VisualSectionHeader from '@/components/feature/VisualSectionHeader';

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

type TimelineStatus = 'completed' | 'current' | 'upcoming' | 'paused';

interface TimelineNode {
  time: string;
  minute: number;
  label: string;
  detail: string;
  status: TimelineStatus;
}

function strategyModeLabel(state: string): string {
  switch (state) {
    case 'ACT': return '執行模式';
    case 'STOP': return '停止模式';
    case 'CLOSED': return '休市模式';
    case 'INSUFFICIENT_DATA': return '資料待補';
    default: return '等待模式';
  }
}

function dataReliabilityLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (['complete', 'completed', 'ready', 'reliable', 'ok'].includes(normalized)) return '高可靠';
  if (['partial', 'degraded', 'limited', 'stale'].includes(normalized)) return '部分資料';
  return '資料待補';
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
  // Status — morningState first, then fallback
  const isTodayReport = ms?.isReportForToday ?? (fallbackReport?.report_date === todayTaipeiStr);
  const reportExists = dataStatus === 'missing_today_report'
    ? false
    : (ms?.reportExists ?? (!!fallbackReport || !!fallbackMorningAlpha?.reportId));
  // Unified data contract: single display state for all core pages.
  // Home, TodayReport, Opportunities, WarRoom, MemberNote ALL read from the same parser.
  // No more page-level ai_strategy_json parsing. No more root column fallback inconsistency.
  const displayState: MorningAlphaDisplayState = useMemo(() => {
    return getMorningAlphaDisplayState(ms?.resolveResult?.rawRow as Record<string, unknown> | null ?? null);
  }, [ms]);

  // These now read from the unified displayState — same values as TodayReport, Opportunities, WarRoom, MemberNote
  const marketClosedInfo = { closed: displayState.market_status !== 'OPEN', holidayName: displayState.holidayName };

  const homeAI = ms?.resolveResult?.rawRow?.ai_strategy_json as Record<string, unknown> | null;
  const canonicalNarrative = useMemo(() => buildCanonicalNarrative({
    displayState,
    ai: homeAI,
  }), [displayState, homeAI]);

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
  const presentation = useMemo(() => buildDecisionPresentation({
    displayState,
    narrative: canonicalNarrative,
    nextCheckpointFallback: `${currentTimelineNode.time} ${currentTimelineNode.label}`,
  }), [canonicalNarrative, currentTimelineNode.label, currentTimelineNode.time, displayState]);
  const nextAction = presentation.primaryDecision.instruction;
  const decisionContext = [
    presentation.marketBiasLabel ? `今天市場${presentation.marketBiasLabel}。` : '',
    presentation.primaryDecision.reason,
  ].filter(Boolean).join(' ') || displayState.market_message || '市場資料尚在更新。';
  const nextActionTime = displayMode === 'market-closed'
    ? displayState.nextUpdateTime
    : formatCheckpoint(presentation.nextCheckpoint);
  const marketObservationCards = [
    {
      label: '盤前把握度',
      value: typeof presentation.confidence?.score === 'number' ? `${presentation.confidence.score}/100` : '資料待補',
      detail: presentation.confidence?.explanation,
      tone: 'primary',
    },
    {
      label: '市場可信度',
      value: dataReliabilityLabel(displayState.dataStatus),
      detail: displayState.dataBasisNote,
      tone: 'primary',
    },
    {
      label: '策略模式',
      value: strategyModeLabel(presentation.primaryDecision.state),
      detail: nextActionTime,
      tone: 'amber',
    },
    {
      label: '主線狀態',
      value: presentation.primaryDecision.headline || '資料待補',
      detail: presentation.primaryDecision.reason,
      tone: presentation.primaryDecision.state === 'ACT'
        ? 'primary'
        : presentation.primaryDecision.state === 'STOP'
          ? 'danger'
          : 'amber',
    },
  ];
  const riskCards = presentation.invalidationItems.slice(0, 3);
  const observationCards = Array.from(new Set([
    ...displayState.v10BeneficiaryStocks,
    ...displayState.coreBeneficiaryStocks,
    ...displayState.beneficiaryStocks,
  ].map((stock) => firstString(
    stock.industry_name,
    stock.industryName,
    stock.sector,
    stock.industry,
    stock.category,
  )).filter(Boolean))).slice(0, 3);

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
    <div className="ma-page ma-pixel-page ma-home-page flex flex-col overflow-x-hidden">
      <Navbar marketState={marketState} />

      <main className="flex-1 overflow-x-hidden">

        {/* ═══════════════════════════════════════ */}
        {/* HERO — Action, context, next */}
        {/* ═══════════════════════════════════════ */}
        {displayMode === 'normal' && hasReportData && (
          <>
            <section className="ma-pixel-hero">
              <div className="ma-pixel-content ma-pixel-hero-grid">
                <div className="ma-pixel-hero-copy">
                  <p className="ma-pixel-eyebrow"><i className="ri-focus-3-line" aria-hidden="true" />今日行動</p>
                  <h1>{renderSafeText(nextAction)}</h1>
                  <p className="ma-pixel-hero-subtitle">{renderSafeText(decisionContext)}</p>
                  <div className="ma-pixel-cta-row">
                    <Link to="/report/today" className="ma-pixel-primary-button">查看今日判斷<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
                    <Link to="/member-note" className="ma-pixel-text-link">查看今日劇本<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
                  </div>
                </div>
                <aside className="ma-pixel-checkpoint-card">
                  <p>下一次確認</p>
                  <strong>{nextActionTime}</strong>
                  <span>{currentTimelineNode.label}</span>
                </aside>
              </div>
            </section>

            <div className="ma-pixel-content ma-pixel-page-sections">
              <section aria-labelledby="market-observation-title">
                <VisualSectionHeader icon="ri-radar-line" title="市場觀察重點" />
                <div className="ma-home-highlight-grid">
                  {marketObservationCards.map((card) => (
                    <article key={card.label} className="ma-card-compact ma-highlight-card min-w-0 p-6">
                      <p className="ma-caption">{card.label}</p>
                      <p className={`mt-2 text-base font-bold leading-snug ${card.tone === 'danger' ? 'text-rose-200' : card.tone === 'amber' ? 'text-amber-300' : 'text-primary-300'}`}>
                        {renderSafeText(card.value)}
                      </p>
                      {card.detail && <p className="mt-2 text-xs leading-relaxed text-foreground-400">{renderSafeText(card.detail)}</p>}
                    </article>
                  ))}
                </div>
              </section>

              <div className="ma-home-panel-grid">
                <section className="ma-home-list-panel" aria-labelledby="risk-focus-title">
                  <VisualSectionHeader icon="ri-error-warning-line" title="今天不要做" />
                  {riskCards.length > 0 ? <div className="ma-home-compact-list">
                    {riskCards.map((item) => (
                      <div key={item} className="ma-home-compact-row is-danger">
                        <i className="ri-forbid-line" aria-hidden="true" />
                        <div><strong>{renderSafeText(item)}</strong></div>
                      </div>
                    ))}
                  </div> : <p className="ma-pixel-empty-state">資料待補</p>}
                </section>

                <section className="ma-home-list-panel" aria-labelledby="observation-focus-title">
                  <VisualSectionHeader icon="ri-eye-line" title="今天要觀察" />
                  {observationCards.length > 0 ? (
                    <div className="ma-home-compact-list">
                      {observationCards.map((item) => (
                        <div key={item} className="ma-home-compact-row is-success">
                          <i className="ri-focus-2-line" aria-hidden="true" />
                          <div><strong>{renderSafeText(item)}</strong></div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="ma-pixel-empty-state">資料待補</p>}
                </section>
              </div>

              <section aria-labelledby="launch-timeline-title">
                <VisualSectionHeader icon="ri-time-line" title="今日關注時間軸" />
                <div className="ma-pixel-timeline" role="list">
                  {timelineNodes.map((node) => (
                    <div key={node.time} className={`ma-pixel-timeline-node is-${node.status}`} role="listitem">
                      <span className="ma-pixel-timeline-dot" aria-hidden="true" />
                      <p className="ma-pixel-timeline-time">{node.time}</p>
                      <p className="ma-pixel-timeline-label">{node.label}</p>
                      <p className="ma-pixel-timeline-state">
                        {node.status === 'completed' ? '已完成' : node.status === 'current' ? '目前' : node.status === 'paused' ? '暫停' : '稍後'}
                      </p>
                    </div>
                  ))}
                </div>
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
                      非交易日 Morning Alpha 不產生盤前判斷、受惠股、盤中追蹤與研究筆記。所有分析將於下一個交易日自動恢復。
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
                    className="ma-btn-secondary whitespace-nowrap"
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
                  className="ma-btn-secondary whitespace-nowrap"
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
