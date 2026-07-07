import { useEffect, useMemo } from 'react';
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
  const marketClosedInfo = { closed: displayState.isMarketClosed, holidayName: displayState.holidayName };

  // ── One-liner: V8.4 unified — displayState.todayQuote first → ai fields fallback ──
  const oneLiner = (() => {
    // Prefer the unified parser's todayQuote (excludes 休市 messages)
    if (displayState.todayQuote && displayState.todayQuote.length > 0 && !displayState.isMarketClosed) {
      return displayState.todayQuote;
    }
    const ai = ms?.resolveResult?.rawRow?.ai_strategy_json as Record<string, unknown> | null;
    if (!ai) return null;
    const src =
      (ai.today_quote as string)?.trim() ||
      (ai.summary as string)?.trim() ||
      (ai.free_summary as Record<string, unknown> | null)?.one_liner as string ||
      (ai.one_liner as string)?.trim() ||
      (ai.today_summary as string)?.trim() ||
      ((ai.free_summary as Record<string, unknown> | null)?.one_sentence as string)?.trim() ||
      (ai.free_summary as Record<string, unknown> | null)?.summary as string ||
      (ai.free_summary as Record<string, unknown> | null)?.today_sentence as string ||
      (ms?.resolveResult?.rawRow?.summary as string)?.trim() ||
      '';
    return src || null;
  })();

  // ── Don't-do today: priority from ai_strategy_json fields (no template fallback) ──
  const dontDoToday = (() => {
    const ai = ms?.resolveResult?.rawRow?.ai_strategy_json as Record<string, unknown> | null;
    if (!ai) return null;
    const src =
      (ai.do_not_do as string)?.trim() ||
      (ai.avoid_action as string)?.trim() ||
      (ai.today_do_not_do as string)?.trim() ||
      (ai.free_summary as Record<string, unknown> | null)?.do_not_do as string ||
      (ai.free_summary as Record<string, unknown> | null)?.avoid_action as string ||
      '';
    return src || null;
  })();

  // ── Today mindset: priority from ai_strategy_json fields (no template fallback) ──
  const todayMindset = (() => {
    const ai = ms?.resolveResult?.rawRow?.ai_strategy_json as Record<string, unknown> | null;
    if (!ai) return null;
    const src =
      (ai.today_mindset as string)?.trim() ||
      (ai.mindset as string)?.trim() ||
      (ai.member_mindset as string)?.trim() ||
      '';
    return src || null;
  })();

  const homeAI = ms?.resolveResult?.rawRow?.ai_strategy_json as Record<string, unknown> | null;
  const homeStrategySummary = asRecord(homeAI?.strategy_summary);
  const homePrimaryTheme = firstString(
    homeStrategySummary?.main_theme,
    homeStrategySummary?.primary_theme,
    homeStrategySummary?.market_focus,
    displayState.todayQuote,
    '今日主線',
  );
  const homeCoreScript = firstString(
    oneLiner,
    todayMindset,
    displayState.todayQuote,
    '今天先確認資金方向，不要急著找飆股。',
  );
  const homeDontDo = firstString(
    dontDoToday,
    '主線沒有被量能確認前，不急著追價。',
  );
  const homeNextVerification = '下一個盤中驗證點';

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

  const heroImageUrl = 'https://readdy.ai/api/search-image?query=Abstract%20artistic%20pre%20dawn%20sky%20with%20soft%20warm%20amber%20and%20deep%20navy%20gradient%2C%20minimalist%20geometric%20shapes%20suggesting%20market%20rhythm%20and%20discipline%2C%20calm%20atmospheric%20composition%20with%20subtle%20light%20rays%20breaking%20through%20darkness%2C%20no%20text%2C%20no%20people%2C%20editorial%20quality%2C%20clean%20elegant%20aesthetic%2C%20warm%20amber%20and%20cream%20tones%20against%20deep%20navy%20sky&width=1600&height=900&seq=ma-hero-v5&orientation=landscape';

  return (
    <div className="min-h-screen bg-background-50 flex flex-col overflow-x-hidden">
      <Navbar marketState={marketState} />

      <main className="flex-1 overflow-x-hidden">

        {/* ═══════════════════════════════════════ */}
        {/* HERO — Simplified, date-focused */}
        {/* ═══════════════════════════════════════ */}
        <section className="relative w-full px-5 md:px-6 pt-8 pb-10 md:pt-16 md:pb-16 overflow-hidden">
          <div className="absolute inset-0">
            <img
              src={heroImageUrl}
              alt=""
              className="w-full h-full object-cover object-top"
              loading="eager"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#07111f]/70 via-[#0b1628]/45 to-background-50"></div>
          </div>

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
                        今日市場狀態
                      </h1>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500/12 border border-red-400/30 rounded-full text-red-300 text-[10px] font-semibold whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                        非交易日
                      </span>
                    </div>

                    {/* Date and reason */}
                    <div className="space-y-1.5 mb-4">
                      <p className="text-white/70 text-sm leading-relaxed">
                        <span className="text-white/40">日期：</span>
                        <span className="text-white/80 font-semibold">{displayState.currentDate}（{displayState.currentWeekday}）</span>
                      </p>
                      <p className="text-white/70 text-sm leading-relaxed">
                        <span className="text-white/40">原因：</span>
                        <span className="text-white/80">{displayState.holidayName || '休市'}</span>
                      </p>
                      <p className="text-white/70 text-sm leading-relaxed">
                        <span className="text-white/40">下一個交易日：</span>
                        <span className="text-white/80 font-semibold">{displayState.nextTradingDate}（{displayState.nextTradingWeekday}）</span>
                      </p>
                    </div>

                    <p className="text-white/30 text-xs leading-relaxed">
                      Morning Alpha 將於下一個交易日上午 07:30 更新盤前研究筆記、受惠股與盤中追蹤。
                    </p>
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
              <>
                <h1 className="text-white font-bold text-3xl md:text-5xl lg:text-6xl mb-4 leading-tight max-w-4xl">
                  今天劇本
                </h1>
                <p className="text-white/86 text-base md:text-xl leading-relaxed max-w-3xl mb-3 font-semibold">
                  {renderSafeText(homeCoreScript)}
                </p>
                <p className="text-white/62 text-sm md:text-lg leading-relaxed max-w-3xl mb-5">
                  今天先確認資金方向，不要急著找飆股。
                </p>

                {/* Status badge */}
                <div className="flex items-center gap-2 mb-4">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap ${statusBadge.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`}></span>
                    <i className={`${statusBadge.icon} text-xs`}></i>
                    {statusBadge.label}
                  </span>
                  {displayMode === 'normal' && (
                    <span className="text-white/40 text-xs">本篇為 {displayReportDate} 盤前報告，台股基準採用 {displayMarketDataDate}{displayMarketDataDate === displayReportDate ? ' 資料基準' : ' 收盤資料'}，美股與海外基準採用 {displayUsMarketDate} 盤前資料。</span>
                  )}
                </div>

                {/* Market data basis — clear & explicit */}
                <div className="flex flex-col gap-1.5 mb-4 max-w-2xl">
                  <p className="text-white/50 text-xs leading-relaxed">
                    台股盤前基準：<span className="text-white/70 font-semibold">{displayMarketDataDate}{displayMarketDataDate === displayReportDate ? ' 資料基準' : ' 收盤'}</span>
                    {displayReportDate !== displayMarketDataDate && displayMarketDataDate !== '—' && (
                      <span className="text-white/35 ml-2">（前一個完整交易日，正常盤前邏輯）</span>
                    )}
                  </p>
                  {displayUsMarketDate !== '—' && (
                    <p className="text-white/40 text-xs leading-relaxed">
                      美股與海外基準：<span className="text-white/60">{displayUsMarketDate}</span>
                    </p>
                  )}
                  <p className="text-white/30 text-[10px] leading-relaxed">
                    報告產生時間：{displayCreatedAt}
                  </p>
                </div>
              </>
            )}

            {/* CTA buttons — hidden on market-closed days */}
            {displayMode !== 'market-closed' && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-6">
              <Link
                to="/member-note"
                onClick={() => {
                  trackEvent('click_member_note', { location: 'home_hero' });
                  trackEngagementEvent('click_free_summary');
                }}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm rounded-xl transition-colors whitespace-nowrap min-h-[48px]"
              >
                查看今天完整研究
                <i className="ri-arrow-right-line"></i>
              </Link>
            </div>
            )}

            {/* Disclaimer */}
            <div className="flex items-center gap-3 flex-wrap mt-5">
              {['完整推理', '主線分析', '失效條件', '盤中驗證', '收盤回測'].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/8 px-3 py-1 text-white/62 text-[10px] font-semibold">
                  <i className="ri-check-line text-amber-300"></i>
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        {(displayMode === 'normal') && hasReportData && (
          <section className="w-full px-4 md:px-6 pb-10 md:pb-14">
            <div className="max-w-5xl mx-auto w-full space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  ['市場方向', displayBias],
                  ['今天不要做', homeDontDo],
                  ['今天先看', homePrimaryTheme],
                  ['下一次驗證', homeNextVerification],
                ].map(([title, body]) => (
                  <div key={title} className="bg-background-100 border border-background-200/70 rounded-2xl p-5">
                    <p className="text-foreground-400 text-[10px] uppercase tracking-[0.22em] mb-2">{title}</p>
                    <p className="text-foreground-900 text-sm font-bold leading-relaxed">{renderSafeText(body)}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  ['30 秒看今天', '先看方向、主線、不要做什麼，再決定要不要進一步讀完整研究。'],
                  ['昨天有沒有猜對？', '收盤後用回測檢查盤前判斷，不把敘事當成答案。'],
                  ['為什麼值得付費？', '會員看的不是更多股票，而是推理、失效條件、盤中驗證與收盤回測。'],
                ].map(([title, body]) => (
                  <div key={title} className="bg-foreground-900 border border-foreground-800 rounded-2xl p-5 text-white">
                    <p className="text-amber-200 text-[10px] uppercase tracking-[0.22em] mb-2">Morning Alpha</p>
                    <h2 className="font-bold text-base mb-2">{title}</h2>
                    <p className="text-white/62 text-sm leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>

              <div className="bg-background-100 border border-background-200/70 rounded-2xl p-5 md:p-6">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
                  <div>
                    <p className="text-primary-600 text-[10px] font-bold uppercase tracking-[0.24em] mb-1">Trading Flow</p>
                    <h2 className="text-foreground-900 font-bold text-xl">Morning Alpha 一天的交易流程</h2>
                  </div>
                  <span className="text-foreground-400 text-xs">盤前到收盤後，只做該做的檢查。</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  {[
                    ['07:30', '讀今天劇本'],
                    ['09:30', '確認開盤方向'],
                    ['10:30', '檢查主線擴散'],
                    ['13:00', '排除失效劇本'],
                    ['14:10', '等待收盤驗證'],
                    ['隔天 07:30', '更新新劇本'],
                  ].map(([time, text]) => (
                    <div key={time} className="rounded-xl bg-background-50 border border-background-200/70 p-3">
                      <p className="text-primary-600 text-xs font-bold mb-1">{time}</p>
                      <p className="text-foreground-700 text-xs leading-relaxed">{text}</p>
                    </div>
                  ))}
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
