import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import EarlyBirdModal from '@/components/feature/EarlyBirdModal';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { supabase } from '@/lib/supabase';
import type { Report } from '@/types/report';
import { useLatestReport } from '@/hooks/useLatestReport';
import { formatTaipeiDate, resolveMarketStatus } from '@/utils/tradingDay';
import { buildMarketState, type MarketState } from '@/services/marketStateEngine';
import { getTodaySectorRotation, getSignalColor, computeSectorRotationFreshness, type SectorRotationItem, type SectorRotationFreshness } from '@/services/sectorRotationService';
import { resolveIntradayTrackingState, type IntradayTrackingState, type SegmentDisplay } from '@/services/intradayTrackingResolver';
import { useState, useEffect, useMemo } from 'react';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import PaywallCard from '@/components/paywall/PaywallCard';
import V11ObservationSection, { mapV11ObservationItems } from '@/components/v11/V11ObservationSection';
import { buildEntitlementFromTier, hasFeature } from '@/services/entitlementService';
import type { UserEntitlement } from '@/types/subscription';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item)).filter(Boolean);
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatCloseResult(change: number | null, direction: string): string {
  if (change === null) return '等待收盤資料';
  return `TAIEX ${formatPercent(change)}${direction ? `｜${direction}` : ''}`;
}


function scoreTone(score: unknown): { stars: string; label: string; raw: string } {
  const numeric = Number(score);
  const raw = Number.isFinite(numeric) ? `${Math.round(numeric)}/100` : '';
  if (!Number.isFinite(numeric)) return { stars: '☆☆☆☆☆', label: '待驗證', raw };
  if (numeric >= 80) return { stars: '★★★★★', label: '高把握', raw };
  if (numeric >= 65) return { stars: '★★★★☆', label: '中高把握', raw };
  if (numeric >= 50) return { stars: '★★★☆☆', label: '觀察', raw };
  if (numeric >= 35) return { stars: '★★☆☆☆', label: '低把握', raw };
  return { stars: '★☆☆☆☆', label: '僅供觀察', raw };
}

function humanStatus(value: unknown): string {
  const raw = safeText(value, '').toLowerCase();
  if (!raw) return '待驗證';
  if (['ready', 'complete', 'completed'].includes(raw)) return '資料已完成';
  if (raw === 'mixed' || raw === 'partial') return '部分成立';
  if (raw === 'true') return '符合推論';
  if (raw === 'false') return '未符合盤前推論';
  if (raw === 'pending' || raw === 'pending_real_market_data') return '等待收盤資料';
  if (raw === 'degraded') return '資料部分完成';
  return safeText(value, '待驗證');
}

function normalizePredictionResult(value: unknown): string {
  const v = String(value || '').toLowerCase();
  if (v === 'hit' || v === 'correct') return '今日盤前方向命中';
  if (v === 'partial') return '方向部分成立';
  if (v === 'miss' || v === 'wrong') return '今日盤前方向失效';
  if (v === 'pending' || v === 'pending_real_market_data') return '等待收盤資料';
  return '等待收盤資料';
}

function formatVerdictLabel(value: unknown, fallback: unknown): string {
  const label = safeText(value);
  if (label && !['hit', 'miss', 'partial', 'pending'].includes(label.toLowerCase())) return label;

  return normalizePredictionResult(fallback || value);
}

function closeVerificationTone(value: string): SegmentDisplay['color'] {
  if (value.includes('命中') || value === 'hit') return 'green';
  if (value.includes('部分') || value === 'partial' || value.includes('等待') || value === 'pending') return 'amber';
  if (value.includes('失效') || value === 'miss') return 'red';
  return 'slate';
}

export default function WarRoom() {
  return (
    <ErrorBoundary
      fallbackTitle="盤中追蹤暫時無法載入"
      fallbackMessage="資料讀取或畫面渲染時發生錯誤，請稍後再試。"
    >
      <WarRoomContent />
    </ErrorBoundary>
  );
}

function WarRoomContent() {
  const { report, isLoading, error,
    openingRadar,
    isHistoricalFallback, fallbackReportDate,
    marketData, marketDataTodayOnly,
    todayCloseVerification,
    strategyBias,
    strategyConfidence,
    strategyDataDate,
    morningState,
  } = useLatestReport();

  const [sectorData, setSectorData] = useState<SectorRotationItem[]>([]);
  const [sectorScoreDate, setSectorScoreDate] = useState<string | null>(null);
  const [sectorLoaded, setSectorLoaded] = useState(false);
  const [sectorFreshness, setSectorFreshness] = useState<SectorRotationFreshness | null>(null);

  const [earlyBirdOpen, setEarlyBirdOpen] = useState(false);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);

  const todayTaipeiStr = formatTaipeiDate();
  const canonicalMarketStatus = resolveMarketStatus(todayTaipeiStr);
  const isNonTradingDay = canonicalMarketStatus.market_status !== 'OPEN';
  const isWeekend = canonicalMarketStatus.market_status === 'WEEKEND';
  // V27: Is the active report for today?
  const isReportForToday = report?.report_date === todayTaipeiStr;
  const canViewWarRoomFull = hasFeature(entitlement, 'war_room_full');

  useEffect(() => {
    if (morningState?.resolveResult?.tier) {
      setEntitlement(buildEntitlementFromTier(morningState.resolveResult.tier));
    }
  }, [morningState?.resolveResult?.tier]);

  // V8.4: Unified display state — same parser as all other pages
  const displayState: MorningAlphaDisplayState | null = useMemo(() => {
    if (!morningState?.resolveResult?.rawRow) return null;
    return getMorningAlphaDisplayState(morningState.resolveResult.rawRow as Record<string, unknown> | null ?? null);
  }, [morningState]);
  const reportAI = isRecord(report?.ai_strategy_json) ? report.ai_strategy_json as Record<string, unknown> : null;
  const rawAI = displayState?.rawAI ?? reportAI;
  const closeVerification =
    rawAI?.closing_verification_v2 && typeof rawAI.closing_verification_v2 === 'object'
      ? rawAI.closing_verification_v2 as Record<string, unknown>
      : rawAI?.closing_verification && typeof rawAI.closing_verification === 'object'
        ? rawAI.closing_verification as Record<string, unknown>
        : todayCloseVerification && typeof todayCloseVerification === 'object'
          ? todayCloseVerification as Record<string, unknown>
          : null;
  const closeVerificationRecord =
    isRecord(closeVerification) && Object.keys(closeVerification).length > 0 ? closeVerification : null;
  const closePredictedBias = safeText(
    closeVerificationRecord?.predicted_bias ??
      closeVerificationRecord?.opening_bias ??
      displayState?.marketBias ??
      rawAI?.market_bias,
    '—',
  );
  const closePredictedScore = safeNumber(
    closeVerificationRecord?.predicted_confidence ??
      closeVerificationRecord?.opening_confidence ??
      closeVerificationRecord?.confidence_score ??
      displayState?.confidenceScore,
  );
  const closeActualTaiexClose =
    isRecord(closeVerificationRecord?.actual_taiex_close) ? closeVerificationRecord.actual_taiex_close : null;
  const closeActualTaiexChangeRaw =
    closeVerificationRecord?.actual_taiex_change ??
    closeActualTaiexClose?.change_percent ??
    closeActualTaiexClose?.close_change_percent;
  const closeTaiexChange =
    typeof closeActualTaiexChangeRaw === 'number'
      ? closeActualTaiexChangeRaw
      : typeof closeActualTaiexChangeRaw === 'string' && closeActualTaiexChangeRaw.trim() !== ''
        ? Number(closeActualTaiexChangeRaw)
        : null;
  const closeActualTaiexChange =
    closeTaiexChange !== null && Number.isFinite(closeTaiexChange)
      ? closeTaiexChange
      : null;
  const closeActualDirection = safeText(closeVerificationRecord?.actual_direction);
  const closeResultText =
    closeActualTaiexChange !== null && Number.isFinite(closeActualTaiexChange)
      ? `TAIEX ${closeActualTaiexChange >= 0 ? '+' : ''}${closeActualTaiexChange.toFixed(2)}%`
      : '等待收盤資料';
  const closeAccuracyScore = safeNumber(closeVerificationRecord?.accuracy_score);
  const closeVerdictLabel =
    String(closeVerificationRecord?.verdict_label || '').trim() ||
    normalizePredictionResult(
      closeVerificationRecord?.prediction_result ||
      closeVerificationRecord?.hit_or_miss ||
      closeVerificationRecord?.status,
    );
  const closeVerificationNote =
    String(closeVerificationRecord?.verification_note || '').trim() ||
    String(closeVerificationRecord?.reason || '').trim() ||
    '今日尚未完成收盤驗證，收盤後系統會回寫盤前判斷是否成立。';
  const closeMissReason = safeText(closeVerificationRecord?.miss_reason);
  const closeFailedAssumptions = safeStringArray(closeVerificationRecord?.failed_assumptions);
  const closeTomorrowWatchPoints = safeStringArray(closeVerificationRecord?.tomorrow_watch_points);
  const closeLessonsLearned = safeStringArray(closeVerificationRecord?.lessons_learned);
  const isCloseVerificationPending = closeVerificationRecord
    ? ['pending', 'pending_real_market_data'].includes(String(
        closeVerificationRecord.status ||
        closeVerificationRecord.hit_or_miss ||
        closeVerificationRecord.prediction_result ||
        closeVerificationRecord.data_status ||
        '',
      ).toLowerCase())
    : false;
  const isCloseVerificationDegraded = closeVerificationRecord
    ? String(closeVerificationRecord.data_status || '').toLowerCase() === 'degraded'
      || String(closeVerificationRecord.status || '').toLowerCase() === 'direction_completed_data_degraded'
    : false;
  const closeTone = closeVerificationTone(
    safeText(closeVerificationRecord?.prediction_result || closeVerificationRecord?.hit_or_miss || closeVerdictLabel),
  );
  const marketClosedInfo = displayState
    ? { closed: displayState.market_status !== 'OPEN', holidayName: displayState.holidayName }
    : { closed: isWeekend, holidayName: isWeekend ? '週末休市' : null as string | null };

  // Taipei hour for status logic
  const taipeiHour = useMemo(() => {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' })).getHours();
  }, []);

  const marketState: MarketState = buildMarketState({
    todayReport: report,
    todayOpeningRadar: openingRadar,
    todayMarketData: marketDataTodayOnly ?? marketData ?? null,
    todayCloseVerification: todayCloseVerification,
    sectorRotationFreshness: sectorFreshness,
  });

  useEffect(() => {
    getTodaySectorRotation(todayTaipeiStr)
      .then((result) => {
        setSectorData(result.items);
        setSectorScoreDate(result.scoreDate || todayTaipeiStr);

        const now = new Date();
        const taipeiNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
        const hour = taipeiNow.getHours();
        const min = taipeiNow.getMinutes();
        const isAfterClose = hour > 13 || (hour === 13 && min >= 30);
        const hasCloseVerif = todayCloseVerification !== null && todayCloseVerification.report_date === todayTaipeiStr;

        let phaseForFreshness = 'intraday';
        if (isNonTradingDay) phaseForFreshness = 'pre_market';
        else if (isAfterClose && hasCloseVerif) phaseForFreshness = 'after_close_verified';
        else if (isAfterClose) phaseForFreshness = 'after_close_pending';
        else if (hour < 9) phaseForFreshness = 'pre_market';

        setSectorFreshness(computeSectorRotationFreshness(result, todayTaipeiStr, phaseForFreshness));
        setSectorLoaded(true);
      })
      .catch(() => {
        setSectorFreshness(null);
        setSectorLoaded(true);
      });
  }, [todayTaipeiStr, todayCloseVerification]);

  // ═══ V25: Unified intraday tracking state ═══
  const tracking = useMemo<IntradayTrackingState>(() => {
    return resolveIntradayTrackingState({
      report,
      reportDate: report?.report_date || null,
      premarketBaseDate: strategyDataDate || report?.report_date || null,
      todayDate: todayTaipeiStr,
      openingRadar,
      marketDataTodayOnly,
      marketData,
      closeReview: todayCloseVerification,
      sectorItems: sectorData,
      sectorScoreDate,
      sectorFreshness,
      taipeiHour,
      isWeekend,
    });
  }, [report, strategyDataDate, todayTaipeiStr, openingRadar, marketDataTodayOnly, marketData, todayCloseVerification, sectorData, sectorScoreDate, sectorFreshness, taipeiHour, isWeekend]);

  const sectorCanUseAsTodayStrategy = sectorFreshness?.canUseAsTodayStrategy ?? false;
  const sectorIsStale = sectorFreshness?.isStale ?? false;
  const v10BeneficiaryEnabled = displayState?.v10BeneficiaryEnabled === true
    || rawAI?.v10_beneficiary_enabled === true
    || rawAI?.v10_beneficiary_enabled === 'true';
  const v11ObservationScripts = mapV11ObservationItems(rawAI?.v10_observation_watchlist || displayState?.v10ObservationWatchlist, 5);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-amber-400/60 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-white/50 text-sm">載入中...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // V10.0: Market closed — show today's market status, NOT last report date
  if (marketClosedInfo.closed) {
    const nextDate = displayState?.nextTradingDate || '—';
    const nextWeekday = displayState?.nextTradingWeekday || '';
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-red-500/20 rounded-2xl p-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-400/20 flex items-center justify-center">
              <span className="text-2xl">🔴</span>
            </div>
            <h1 className="text-white font-bold text-xl mb-2">今日市場狀態</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-red-500/12 border border-red-400/30 rounded-full text-red-300 text-[10px] font-semibold mb-3 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
              非交易日
            </span>
            <p className="text-slate-400 text-sm mb-1">
              日期：{displayState?.currentDate || report?.report_date || todayTaipeiStr}（{displayState?.currentWeekday || ''}）
            </p>
            <p className="text-slate-500 text-sm mb-4">
              原因：{displayState?.holidayName || marketClosedInfo.holidayName || '休市'}
            </p>
            <div className="bg-navy-800/70 border border-navy-700/70 rounded-xl p-4 mb-5">
              <p className="text-slate-400 text-xs mb-1">下一個交易日</p>
              <p className="text-white font-bold text-base">{nextDate}（{nextWeekday}）</p>
              <p className="text-slate-500 text-[10px] mt-1">07:30 自動更新</p>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed mb-5">
              今日台股休市，盤中追蹤暫停。所有分析功能將於下一個交易日自動恢復。
            </p>
            <Link to="/" className="inline-block mt-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10">
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-radar-line text-white/20 text-3xl mb-3"></i>
            <h2 className="text-white font-semibold text-base mb-2">
              {error ? '讀取失敗' : '尚無盤前報告資料'}
            </h2>
            <p className="text-white/50 text-sm mb-4">
              {error ? error : '目前沒有任何盤前報告資料。請確認資料來源是否正常運作。'}
            </p>
            <Link to="/" className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors inline-block whitespace-nowrap border border-white/10">
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ── Helpers for card rendering ──
  const segmentBorder = (color: SegmentDisplay['color']) => {
    switch (color) {
      case 'green': return 'border-emerald-400/35';
      case 'amber': return 'border-amber-400/35';
      case 'red': return 'border-red-400/35';
      case 'slate': return 'border-slate-600/50';
    }
  };

  const segmentBg = (color: SegmentDisplay['color']) => {
    switch (color) {
      case 'green': return 'bg-emerald-500/[0.04]';
      case 'amber': return 'bg-amber-500/[0.04]';
      case 'red': return 'bg-red-500/[0.04]';
      case 'slate': return 'bg-slate-800/50';
    }
  };

  const segmentBadgeStyle = (color: SegmentDisplay['color']) => {
    switch (color) {
      case 'green': return 'bg-emerald-500/12 text-emerald-300 border-emerald-400/35';
      case 'amber': return 'bg-amber-500/12 text-amber-300 border-amber-400/35';
      case 'red': return 'bg-red-500/12 text-red-300 border-red-400/35';
      case 'slate': return 'bg-slate-700/60 text-slate-400 border-slate-600/50';
    }
  };

  const showTodaySectorRotation = tracking.hasTodaySectorRotation && (sectorFreshness?.canUseAsTodayStrategy ?? false);
  const showSectorReference = !showTodaySectorRotation && (sectorFreshness?.canUseAsReference ?? false) && sectorData.length > 0;
  const showSectorCards = showTodaySectorRotation || showSectorReference;
  const sectorTitle = showTodaySectorRotation
    ? '今日類股輪動'
    : showSectorReference
      ? '上一交易日類股輪動參考'
      : '類股輪動';
  const sectorBadgeText = showSectorReference ? '歷史參考' : tracking.sectorRotation.statusText;

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar marketState={marketState} />

      <main className="flex-1 overflow-x-hidden">
        {/* ── TOP BAR ── */}
        <div className="border-b border-navy-800 bg-navy-900/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-amber-500/15 flex items-center justify-center">
                <i className="ri-sword-line text-amber-300 text-sm"></i>
              </div>
              <h1 className="text-slate-50 font-bold text-sm md:text-base whitespace-nowrap">
                盤中追蹤
              </h1>
              {/* Report date badge */}
              {tracking.reportDate && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/12 text-emerald-300 text-[10px] font-medium rounded-full border border-emerald-400/35 whitespace-nowrap">
                  <i className="ri-calendar-line"></i>
                  報告日期：{tracking.reportDate}
                </span>
              )}
              {/* Premarket base date badge */}
              {tracking.premarketBaseDate && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/12 text-sky-300 text-[10px] font-medium rounded-full border border-sky-500/20 whitespace-nowrap">
                  <i className="ri-database-2-line"></i>
                  台股盤前基準：{tracking.premarketBaseDate} 收盤
                </span>
              )}
              {/* Radar date badge */}
              {tracking.intradayRadarDate && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border whitespace-nowrap ${tracking.hasTodayOpeningRadar ? 'bg-emerald-500/12 text-emerald-300 border-emerald-400/35' : 'bg-amber-500/12 text-amber-300 border-amber-400/35'}`}>
                  <i className="ri-radar-line"></i>
                  盤中雷達：{tracking.intradayRadarDate}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium whitespace-nowrap border ${segmentBadgeStyle(tracking.intraday.color)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tracking.intraday.color === 'green' ? 'bg-emerald-400' : tracking.intraday.color === 'red' ? 'bg-red-400' : tracking.intraday.color === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                {humanStatus(tracking.intraday.statusText)}
              </span>
            </div>
            {isHistoricalFallback && fallbackReportDate && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/12 text-sky-300 text-[10px] font-medium rounded-full border border-sky-500/20 whitespace-nowrap">
                <i className="ri-history-line"></i>
                歷史資料模式：{fallbackReportDate}
              </span>
            )}
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-5">

          {/* ═══ Non-trading day banner ═══ */}
          {isNonTradingDay && (
            <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-500/20 flex items-start gap-3">
              <i className="ri-calendar-line text-amber-400 text-sm mt-0.5"></i>
              <p className="text-amber-400/80 text-sm leading-relaxed">
                今天非交易日，以下顯示最近交易日（{fallbackReportDate || report?.report_date || ''}）資料。
              </p>
            </div>
          )}

          {/* V27: Not today's report warning */}
          {!isNonTradingDay && !isReportForToday && report && (
            <div className="p-4 rounded-xl bg-red-500/[0.06] border border-red-500/20 flex items-start gap-3">
              <i className="ri-calendar-check-line text-red-400 text-sm mt-0.5"></i>
              <div>
                <p className="text-red-300 text-sm font-semibold">今日盤前報告尚未產生</p>
                <p className="text-red-400/60 text-xs mt-1">
                  以下顯示上一份報告（{report.report_date}），非今日 {todayTaipeiStr} 盤前報告。盤中雷達仍以 today 資料為準。
                </p>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════ */}
          {/* CARD 1 — 07:30 盤前方向 */}
          {/* ═══════════════════════════════════════ */}
          <section className={`rounded-2xl border p-5 md:p-6 ${segmentBorder(tracking.premarket.color)} ${segmentBg(tracking.premarket.color)}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-forest-500/10 text-forest-400 border border-forest-500/20 whitespace-nowrap">07:30</span>
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">盤前方向</h2>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${segmentBadgeStyle(tracking.premarket.color)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tracking.premarket.color === 'green' ? 'bg-emerald-400' : tracking.premarket.color === 'red' ? 'bg-red-400' : tracking.premarket.color === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                {tracking.premarket.statusText}
              </span>
            </div>
            {tracking.premarket.showContent && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">盤前方向</p>
                    <p className="text-white/80 text-sm font-medium">{displayState?.marketBias || '—'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">判斷把握度</p>
                    <p className="text-white/80 text-sm font-medium">{displayState?.confidenceScore != null ? `${scoreTone(displayState.confidenceScore).stars} ${scoreTone(displayState.confidenceScore).label}` : '待驗證'}</p>
                  </div>
                </div>
                <p className="text-white/40 text-xs leading-relaxed">
                  盤前方向來自 {tracking.reportDate || '—'} 報告，市場資料基準採用最近完整交易日 {tracking.premarketBaseDate || '—'} 收盤資料。
                  盤前尚未有今日完整收盤資料，本篇使用最近完整交易日作為市場基準。
                </p>
              </div>
            )}
            {!tracking.premarket.showContent && (
              <p className="text-white/40 text-xs leading-relaxed">{tracking.premarket.description}</p>
            )}
          </section>

          {v10BeneficiaryEnabled && (
            <V11ObservationSection
              items={v11ObservationScripts}
              tone="dark"
              subtitle="盤中只看一件事：資金有沒有真的跟上。"
            />
          )}

          {/* ═══════════════════════════════════════ */}
          {/* CARD 2 — 09:30 盤中雷達 */}
          {/* ═══════════════════════════════════════ */}
          <section className={`rounded-2xl border p-5 md:p-6 ${segmentBorder(tracking.intraday.color)} ${segmentBg(tracking.intraday.color)}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">09:30</span>
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">盤中雷達</h2>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${segmentBadgeStyle(tracking.intraday.color)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tracking.intraday.color === 'green' ? 'bg-emerald-400' : tracking.intraday.color === 'red' ? 'bg-red-400' : tracking.intraday.color === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                {humanStatus(tracking.intraday.statusText)}
              </span>
            </div>
            {tracking.intraday.showContent && openingRadar && tracking.intraday.isToday && canViewWarRoomFull && (
              <div className="space-y-3">
                {/* Radar summary card */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`text-sm font-semibold ${openingRadar.radar_status?.includes('偏弱') || openingRadar.radar_status?.includes('轉弱') ? 'text-red-400' : 'text-white/80'}`}>
                      {openingRadar.radar_status}
                    </span>
                  </div>
                  {openingRadar.summary && (
                    <p className="text-white/50 text-xs leading-relaxed">{openingRadar.summary}</p>
                  )}
                  {((openingRadar as unknown as Record<string, unknown>).data_status === 'degraded'
                    || (openingRadar as unknown as Record<string, unknown>).radar_mode === 'two_core_without_txf') && (
                    <p className="mt-2 text-amber-300/80 text-xs leading-relaxed">
                      盤中雷達以 TAIEX / 2330 雙核心資料產生，TXF 尚未接入完整驗證。
                    </p>
                  )}
                </div>
                {/* Intraday snapshot: only openingRadar values after freshness gate passes. */}
                {openingRadar && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { symbol: 'TAIEX', change: openingRadar.taiex_change },
                      { symbol: 'TXF', change: openingRadar.txf_change },
                      { symbol: '2330', change: openingRadar.tsmc_change },
                    ].map((item) => {
                      const changeNum = item.change == null ? null : Number(item.change);
                      const isUp = changeNum !== null && changeNum > 0;
                      const isDown = changeNum !== null && changeNum < 0;
                      return (
                        <div key={item.symbol} className="p-2 rounded-lg bg-white/[0.02] border border-white/5">
                          <span className="text-white/30 text-[9px] block">{item.symbol}</span>
                          <div className="flex items-baseline gap-1.5">
                            {changeNum !== null && !Number.isNaN(changeNum) ? (
                              <span className={`text-[10px] font-mono ${isUp ? 'text-red-400' : isDown ? 'text-emerald-400' : 'text-slate-400'}`}>
                                {changeNum >= 0 ? '+' : ''}{changeNum.toFixed(2)}%
                              </span>
                            ) : (
                              <span className="text-white/30 text-xs font-mono">資料待更新</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-white/40 text-xs leading-relaxed">
                  資料日期：{tracking.intradayRadarDate}｜觀察節點：09:30、10:30、13:30
                </p>
              </div>
            )}
            {tracking.intraday.showContent && openingRadar && tracking.intraday.isToday && !canViewWarRoomFull && (
              <PaywallCard
                title="升級會員查看盤中驗證細節"
                description="盤中雷達細節、指標同步性與驗證訊號已收在會員版，避免把盤前劇本誤讀成盤中結論。"
                requiredTier="member"
                featureList={['盤中雷達摘要', 'TAIEX / TXF / 2330 同步驗證', '盤中劇本失效提醒']}
                ctaText="查看會員方案"
              />
            )}
            {(!tracking.intraday.showContent || !tracking.intraday.isToday) && (
              <div>
                <p className="text-white/50 text-sm mb-2">{tracking.intraday.description}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">盤前方向</p>
                    <p className="text-white/80 text-sm font-medium">{displayState?.marketBias || '偏多觀察'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">今日待驗證</p>
                    <p className="text-white/80 text-sm font-medium">TAIEX、TXF、2330 是否同向</p>
                  </div>
                </div>
                {tracking.isOpeningRadarStale && openingRadar && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/[0.06] border border-red-500/15">
                    <p className="text-red-300/70 text-xs">
                      盤中雷達資料過期，以下為 {tracking.intradayRadarDate} 舊資料，不作為今日判斷。
                    </p>
                  </div>
                )}
                <p className="text-white/25 text-[10px] mt-2 leading-relaxed">
                  觀察節點：09:30、10:30、13:30。上述時間為 Morning Alpha 系統更新時間，非交易時間。
                </p>
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════ */}
          {/* CARD 3 — 14:10 收盤驗證 */}
          {/* ═══════════════════════════════════════ */}
          <section className={`rounded-2xl border p-5 md:p-6 ${segmentBorder(tracking.closeReview.color)} ${segmentBg(tracking.closeReview.color)}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 whitespace-nowrap">14:10</span>
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">收盤驗證</h2>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${segmentBadgeStyle(tracking.closeReview.color)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tracking.closeReview.color === 'green' ? 'bg-emerald-400' : tracking.closeReview.color === 'red' ? 'bg-red-400' : tracking.closeReview.color === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                {humanStatus(tracking.closeReview.statusText)}
              </span>
            </div>
            {closeVerificationRecord && isCloseVerificationPending ? (
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                <p className="text-white/70 text-sm font-medium mb-1">等待收盤資料</p>
                <p className="text-white/45 text-xs leading-relaxed">收盤驗證待完成。有效收盤資料同步後，才會展開驗證說明、失效假設與明日觀察。</p>
              </div>
            ) : closeVerificationRecord ? (
              <div className="space-y-3">
                {isCloseVerificationDegraded && (
                  <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-400/20">
                    <p className="text-amber-200 text-sm font-semibold mb-1">大盤方向已驗證，個股與類股資料仍不完整</p>
                    <p className="text-amber-100/70 text-xs leading-relaxed">目前只完成大盤方向驗證；受惠股收盤資料或當日類股輪動尚未完整，因此不把本次驗證視為完整回測。</p>
                  </div>
                )}
                <div>
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1.5">驗證結論</p>
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${segmentBadgeStyle(closeTone)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${closeTone === 'green' ? 'bg-emerald-400' : closeTone === 'red' ? 'bg-red-400' : closeTone === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                    {closeVerdictLabel}
                  </div>
                </div>

                {canViewWarRoomFull ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">盤前方向</p>
                        <p className="text-white/80 text-sm font-medium break-words">{closePredictedBias}</p>
                        {closePredictedScore !== null && (
                          <p className="text-white/35 text-xs mt-1">{scoreTone(closePredictedScore).stars} {scoreTone(closePredictedScore).label}</p>
                        )}
                      </div>
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">收盤結果</p>
                        <p className={`text-sm font-medium ${closeTaiexChange === null ? 'text-white/50' : closeTaiexChange >= 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                          {closeResultText}
                        </p>
                      </div>
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">驗證分數</p>
                        <p className="text-white/80 text-sm font-medium">{closeAccuracyScore !== null ? `${closeAccuracyScore}/100` : '—'}</p>
                      </div>
                    </div>

                    <div className={`p-4 rounded-xl border ${segmentBorder(closeTone)} ${segmentBg(closeTone)}`}>
                      <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">驗證說明</p>
                      <p className="text-slate-200 text-xs leading-relaxed">{closeVerificationNote}</p>
                    </div>

                    {closeMissReason && (
                      <div className="p-4 rounded-xl bg-red-500/[0.04] border border-red-400/20">
                        <p className="text-red-300 text-[10px] uppercase tracking-wider mb-2">失效原因</p>
                        <p className="text-red-100/80 text-xs leading-relaxed">{closeMissReason}</p>
                      </div>
                    )}

                    {closeFailedAssumptions.length > 0 && (
                      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">失效假設</p>
                        <ul className="space-y-2">
                          {closeFailedAssumptions.map((item, idx) => (
                            <li key={`${item}-${idx}`} className="flex items-start gap-2 text-slate-300 text-xs leading-relaxed">
                              <span className="text-red-300 mt-0.5">•</span>
                              <span className="min-w-0 break-words">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {closeTomorrowWatchPoints.length > 0 && (
                      <div className="p-4 rounded-xl bg-sky-500/[0.04] border border-sky-400/20">
                        <p className="text-sky-300 text-[10px] uppercase tracking-wider mb-2">明日觀察重點</p>
                        <ul className="space-y-2">
                          {closeTomorrowWatchPoints.map((item, idx) => (
                            <li key={`${item}-${idx}`} className="flex items-start gap-2 text-slate-200 text-xs leading-relaxed">
                              <span className="text-sky-300 mt-0.5">•</span>
                              <span className="min-w-0 break-words">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {closeLessonsLearned.length > 0 && (
                      <div className="p-4 rounded-xl bg-violet-500/[0.04] border border-violet-400/20">
                        <p className="text-violet-300 text-[10px] uppercase tracking-wider mb-2">模型修正筆記</p>
                        <ul className="space-y-2">
                          {closeLessonsLearned.map((item, idx) => (
                            <li key={`${item}-${idx}`} className="flex items-start gap-2 text-slate-200 text-xs leading-relaxed">
                              <span className="text-violet-300 mt-0.5">•</span>
                              <span className="min-w-0 break-words">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <p className="text-white/40 text-xs leading-relaxed">
                      每次收盤驗證都是下一次判斷的基礎。回看盤前方向與實際走勢的差異，累積更穩定的市場節奏。
                    </p>
                  </>
                ) : (
                  <PaywallCard
                    title="升級會員查看完整收盤驗證"
                    description="免費版顯示今日命中或失準結果；會員可查看驗證說明、失效假設、明日觀察重點與模型修正筆記。"
                    requiredTier="member"
                    featureList={['驗證說明', '失效假設與明日觀察', '模型修正筆記']}
                    tone="dark"
                  />
                )}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <p className="text-white/50 text-sm leading-relaxed">
                  今日尚未完成收盤驗證，收盤後系統會回寫盤前判斷是否成立。
                </p>
              </div>
            )}
          </section>

          {/* ═══════════════════════════════════════ */}
          {/* CARD 4 — 14:20 類股輪動 */}
          {/* ═══════════════════════════════════════ */}
          <section className={`rounded-2xl border p-5 md:p-6 ${segmentBorder(tracking.sectorRotation.color)} ${segmentBg(tracking.sectorRotation.color)}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 whitespace-nowrap">14:20</span>
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">
                  {sectorTitle}
                </h2>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${segmentBadgeStyle(tracking.sectorRotation.color)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tracking.sectorRotation.color === 'green' ? 'bg-emerald-400' : tracking.sectorRotation.color === 'red' ? 'bg-red-400' : tracking.sectorRotation.color === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                {sectorBadgeText}
              </span>
            </div>

            {showSectorCards ? (
              <div className="space-y-3">
                {/* Stale reference warning */}
                {showSectorReference && (
                  <div className="p-3 rounded-lg bg-amber-500/[0.06] border border-amber-400/30 flex items-start gap-2">
                    <i className="ri-history-line text-amber-400 text-sm mt-0.5"></i>
                    <p className="text-amber-300/70 text-xs leading-relaxed">
                      此區塊為上一交易日類股輪動參考（{tracking.sectorRotationDate}），不代表今日即時輪動，也不參與今日判斷分數。
                    </p>
                  </div>
                )}

                {/* Sector cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sectorData.slice(0, 6).map((item) => {
                    const colors = getSignalColor(item.signal_label);
                    const isFresh = showTodaySectorRotation;
                    return (
                      <div key={item.sector} className={`p-3 rounded-xl border ${isFresh ? `${colors.bg} ${colors.border}` : 'bg-slate-800/70 border-slate-700/70'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-slate-100 font-semibold text-xs">{item.sector}</span>
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${isFresh ? `${colors.bg} ${colors.border} ${colors.text}` : 'bg-amber-500/10 border-amber-400/30 text-amber-300'}`}>
                            <span className={`w-1 h-1 rounded-full ${isFresh ? colors.dot : 'bg-amber-400'}`}></span>
                            {isFresh ? (item.signal_label || item.direction || '—') : '歷史參考'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${isFresh ? 'bg-emerald-500/60' : 'bg-cyan-400/50'}`} style={{ width: `${Math.min(item.rotation_score, 100)}%` }} />
                          </div>
                          <span className="text-slate-400 text-[10px] font-mono tabular-nums w-6 text-right">{item.rotation_score}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : tracking.sectorRotation.showContent && sectorData.length === 0 ? (
              <div className="bg-white/[0.02] border border-white/5 rounded-xl p-5 text-center">
                <div className="w-10 h-10 rounded-xl bg-navy-800 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-pie-chart-line text-white/30 text-lg"></i>
                </div>
                <p className="text-white/50 text-sm">今日類股輪動尚未更新，暫不顯示排行。</p>
                <p className="text-white/25 text-xs mt-1">請等待收盤後資料更新。</p>
              </div>
            ) : (
              <p className="text-white/50 text-sm">{tracking.sectorRotation.description}</p>
            )}

            {/* Weak / Avoid sectors */}
            {sectorLoaded && showTodaySectorRotation && sectorData.filter((s) => s.rotation_score < 20).length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5">
                <h3 className="text-white/40 text-[10px] uppercase tracking-[0.3em] font-semibold mb-3">
                  相對弱勢 / 避開方向
                </h3>
                <div className="space-y-2">
                  {sectorData
                    .filter((s) => s.rotation_score < 20)
                    .slice(0, 3)
                    .map((item) => (
                      <div key={item.sector} className="p-2.5 rounded-lg bg-red-500/[0.03] border border-red-500/10 flex items-center gap-3">
                        <div className="w-7 h-7 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                          <i className="ri-arrow-down-line text-red-400 text-xs"></i>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-xs font-semibold">{item.sector}</span>
                            <span className="text-red-400 text-[10px] font-mono">輪動分 {item.rotation_score}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </section>

          {/* Observation note */}
          <p className="text-white/20 text-[10px] text-center leading-relaxed">
            觀察節點：09:30、10:30、13:30。上述時間為 Morning Alpha 系統更新時間，非交易時間。
          </p>

          {/* Member CTA */}
          <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6 text-center">
            <p className="text-slate-300 text-sm mb-3 leading-relaxed">
              完整盤前研究筆記請前往研究筆記頁查看。
            </p>
            <Link
              to="/member-note"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500/12 hover:bg-amber-500/18 text-amber-300 text-sm font-medium rounded-xl transition-colors border border-amber-400/30 cursor-pointer whitespace-nowrap"
            >
              查看完整研究筆記
              <i className="ri-arrow-right-line"></i>
            </Link>
          </section>

        </div>
      </main>

      <EarlyBirdModal isOpen={earlyBirdOpen} onClose={() => setEarlyBirdOpen(false)} />
      <Footer />
    </div>
  );
}
