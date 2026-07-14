import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import VisualSectionHeader from '@/components/feature/VisualSectionHeader';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { useLatestReport } from '@/hooks/useLatestReport';
import { formatTaipeiDate, resolveMarketStatus } from '@/utils/tradingDay';
import { buildMarketState, type MarketState } from '@/services/marketStateEngine';
import { getTodaySectorRotation, getSignalColor, computeSectorRotationFreshness, type SectorRotationItem, type SectorRotationFreshness } from '@/services/sectorRotationService';
import { resolveIntradayTrackingState, type IntradayTrackingState, type SegmentDisplay } from '@/services/intradayTrackingResolver';
import { useState, useEffect, useMemo } from 'react';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import {
  buildWarRoomClosingState,
  buildWarRoomObservationCards,
  buildWarRoomTimeline,
} from './warRoomPresentationMapper';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function firstRecordText(record: Record<string, unknown> | null, keys: string[], fallback = ''): string {
  if (!record) return fallback;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = safeText(value);
      if (text) return text;
    }
  }
  return fallback;
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
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

function decisionStatusLabel(value: unknown): string {
  const raw = safeText(value).toLowerCase();
  if (raw === 'confirmed') return '🟢 已確認';
  if (raw === 'rejected') return '🔴 已失效';
  if (raw === 'completed') return '⚪ 今日驗證完成';
  return '🟡 等待確認';
}

function evidenceStatusMark(value: string): string {
  if (value === '已同步') return '✅';
  if (value === '已失效') return '❌';
  if (value === '尚未同步') return '⏳';
  return '…';
}

function compactChineseText(value: unknown, fallback: string, limit = 25): string {
  const text = safeText(value, fallback).replace(/\s+/g, '');
  return text.length > limit ? text.slice(0, limit) : text;
}

function resolveNextReturnTime(nextStep: unknown, status: unknown): string {
  const step = safeText(nextStep);
  const raw = safeText(status).toLowerCase();
  if (raw === 'completed') return '明日 07:30';
  if (step.includes('13')) return '13:00';
  if (step.includes('10')) return '10:30';
  if (step.includes('09') || step.includes('9')) return '09:30';

  const taipeiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const minutes = taipeiNow.getHours() * 60 + taipeiNow.getMinutes();
  if (minutes < 9 * 60 + 30) return '09:30';
  if (minutes < 10 * 60 + 30) return '10:30';
  if (minutes < 13 * 60) return '13:00';
  return '明日 07:30';
}

function normalizePredictionResult(value: unknown): string {
  const v = String(value || '').toLowerCase();
  if (v === 'hit' || v === 'correct') return '今日盤前方向命中';
  if (v === 'partial') return '方向部分成立';
  if (v === 'miss' || v === 'wrong') return '今日盤前方向失效';
  if (v === 'pending' || v === 'pending_real_market_data') return '等待收盤資料';
  return '等待收盤資料';
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
    fallbackReportDate,
    marketData, marketDataTodayOnly,
    todayCloseVerification,
    strategyDataDate,
    morningState,
  } = useLatestReport();

  const [sectorData, setSectorData] = useState<SectorRotationItem[]>([]);
  const [sectorScoreDate, setSectorScoreDate] = useState<string | null>(null);
  const [sectorLoaded, setSectorLoaded] = useState(false);
  const [sectorFreshness, setSectorFreshness] = useState<SectorRotationFreshness | null>(null);

  const todayTaipeiStr = formatTaipeiDate();
  const canonicalMarketStatus = resolveMarketStatus(todayTaipeiStr);
  const isNonTradingDay = canonicalMarketStatus.market_status !== 'OPEN';
  const isWeekend = canonicalMarketStatus.market_status === 'WEEKEND';
  // V27: Is the active report for today?
  const isReportForToday = report?.report_date === todayTaipeiStr;
  // V8.4: Unified display state — same parser as all other pages
  const displayState: MorningAlphaDisplayState | null = useMemo(() => {
    if (!morningState?.resolveResult?.rawRow) return null;
    return getMorningAlphaDisplayState((morningState.resolveResult.rawRow as unknown as Record<string, unknown>) ?? null);
  }, [morningState]);
  const reportAI = isRecord(report?.ai_strategy_json) ? report.ai_strategy_json as Record<string, unknown> : null;
  const rawAI = displayState?.rawAI ?? reportAI;
  const closingVerificationV2 = isRecord(rawAI?.closing_verification_v2)
    ? rawAI.closing_verification_v2
    : null;
  const publicClosingVerification = isRecord(rawAI?.closing_verification)
    ? rawAI.closing_verification
    : null;
  const closeVerification =
    closingVerificationV2
      ? closingVerificationV2
      : publicClosingVerification
        ? publicClosingVerification
        : todayCloseVerification && typeof todayCloseVerification === 'object'
          ? todayCloseVerification as unknown as Record<string, unknown>
          : null;
  const closeVerificationRecord =
    isRecord(closeVerification) && Object.keys(closeVerification).length > 0 ? closeVerification : null;
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
  const closeResultText =
    closeTaiexChange !== null && Number.isFinite(closeTaiexChange)
      ? `TAIEX ${closeTaiexChange >= 0 ? '+' : ''}${closeTaiexChange.toFixed(2)}%`
      : '等待收盤資料';
  const closeVerdictLabel =
    String(closeVerificationRecord?.verdict_label || '').trim() ||
    normalizePredictionResult(
      closeVerificationRecord?.prediction_result ||
      closeVerificationRecord?.hit_or_miss ||
      closeVerificationRecord?.status,
    );
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

  const canonicalNarrative = buildCanonicalNarrative({
    displayState,
    ai: rawAI,
  });
  const decisionLifecycle = canonicalNarrative.decision_lifecycle;
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
            <h1 className="text-white font-bold text-xl mb-2">今天沒有盤中驗證</h1>
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
              今日台股休市，盤中追蹤暫停。若需參考，以下僅能查看最近交易日資料。
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
  const decisionStatus = decisionLifecycle.decision_status;
  const decisionWhy = compactChineseText(decisionStatus.reason, '等待盤中資料確認。');
  const nextReturnTime = resolveNextReturnTime(
    decisionStatus.next_step || canonicalNarrative.intraday_progress.next_step,
    decisionStatus.status,
  );
  const presentationNow = new Date();
  const closingState = buildWarRoomClosingState({
    closingVerificationV2,
    publicClosingVerification,
    todayCloseVerification,
    now: presentationNow,
  });
  const phase2CurrentStatus = closingState.isPostClose
    ? closingState.label
    : decisionStatusLabel(decisionStatus.status);
  const phase2NextConfirmation = closingState.isPostClose
    ? closingState.label
    : nextReturnTime;
  const tsmcChange = safeNumber(openingRadar?.tsmc_change);
  const taiexChange = safeNumber(openingRadar?.taiex_change);
  const txfChange = safeNumber(openingRadar?.txf_change);
  const syncedStatus = (value: number | null) => {
    if (value !== null) return '已同步';
    return openingRadar ? '等待資料' : '尚未同步';
  };
  const evidenceConclusion = (() => {
    if (decisionStatus.status === 'Rejected') return '因此，早上劇本已失效。';
    if (decisionStatus.status === 'Confirmed') return '因此，目前維持早上劇本。';
    if (decisionStatus.status === 'Completed') return '因此，今日驗證已完成。';
    return '因此，目前維持等待確認。';
  })();
  const evidenceCards = [
    {
      label: '2330',
      status: syncedStatus(tsmcChange),
      note: tsmcChange !== null ? formatPercent(tsmcChange) : '缺少盤中資料',
    },
    {
      label: 'TAIEX',
      status: syncedStatus(taiexChange),
      note: taiexChange !== null ? formatPercent(taiexChange) : '缺少盤中資料',
    },
    {
      label: 'TXF',
      status: syncedStatus(txfChange),
      note: txfChange !== null ? formatPercent(txfChange) : '缺少盤中資料',
    },
    {
      label: '主線族群',
      status: showTodaySectorRotation ? '已同步' : showSectorReference ? '尚未同步' : '等待資料',
      note: compactChineseText(sectorData[0]?.sector || canonicalNarrative.today_focus.headline || '等待資料', '等待資料', 18),
    },
  ];
  const changedGroups = [
    {
      label: '已成立',
      items: canonicalNarrative.intraday_progress.completed_steps.slice(0, 2),
    },
    {
      label: '未成立',
      items: decisionStatus.status === 'Waiting' ? [decisionWhy] : [],
    },
    {
      label: '新增訊號',
      items: [safeText(openingRadar?.summary)].filter(Boolean).slice(0, 2),
    },
    {
      label: '失效條件',
      items: [canonicalNarrative.decision_lifecycle.failure_condition.trigger].filter(Boolean).slice(0, 2),
    },
  ].filter((group) => group.items.length > 0);

  const capitalRotation = isRecord(rawAI?.capital_rotation_path) ? rawAI.capital_rotation_path : null;
  const intradaySummaryCards = [
    { label: '最新方向', value: safeText(openingRadar?.radar_status, humanStatus(tracking.intraday.statusText)), detail: openingRadar?.summary ? compactChineseText(openingRadar.summary, '', 30) : decisionWhy, tone: 'blue' },
    { label: '資金', value: firstRecordText(capitalRotation, ['current_focus', 'summary', 'direction'], '資料待補'), detail: sectorData[0]?.sector ? `目前關注：${sectorData[0].sector}` : '', tone: 'green' },
    { label: '主線', value: safeText(sectorData[0]?.sector || canonicalNarrative.today_focus.headline, '資料待補'), detail: canonicalNarrative.today_focus.summary, tone: 'amber' },
    { label: '目前動作', value: safeText(decisionStatus.next_step || canonicalNarrative.intraday_progress.current_step, '等待確認'), detail: phase2NextConfirmation, tone: decisionStatus.status === 'Rejected' ? 'red' : 'green' },
  ];
  const supportingSignals = Array.from(new Set([
    ...canonicalNarrative.intraday_progress.completed_steps,
    ...evidenceCards.filter((item) => item.status === '已同步').map((item) => `${item.label} ${item.note}`),
  ].filter(Boolean))).slice(0, 3);
  const opposingSignals = Array.from(new Set([
    canonicalNarrative.decision_lifecycle.failure_condition.trigger,
    ...canonicalNarrative.failure_triggers.map((item) => item.trigger),
  ].filter(Boolean))).slice(0, 3);
  const phase2Timeline = buildWarRoomTimeline({
    intradaySyncStatus: isRecord(rawAI?.intraday_sync_status) ? rawAI.intraday_sync_status : null,
    openingRadar: isRecord(openingRadar) ? openingRadar : null,
    closingVerificationV2,
    publicClosingVerification,
    todayCloseVerification,
    now: presentationNow,
  });
  const phase2Observations = buildWarRoomObservationCards({
    sources: [
    ...(displayState?.v10ObservationWatchlist || []),
    ...(displayState?.coreBeneficiaryStocks || []),
    ],
    closingVerificationV2,
    publicClosingVerification,
    todayCloseVerification,
    fallbackNext: nextReturnTime,
    fallbackStop: canonicalNarrative.decision_lifecycle.failure_condition.trigger,
    now: presentationNow,
    limit: 3,
  });


  return (
    <div className="ma-page ma-pixel-page ma-war-room-page flex flex-col overflow-x-hidden">
      <Navbar marketState={marketState} />

      <main className="flex-1 overflow-x-hidden">
        <section className="ma-pixel-hero">
          <div className="ma-pixel-content ma-pixel-hero-grid">
            <div className="ma-pixel-hero-copy">
              <p className="ma-pixel-eyebrow"><i className="ri-pulse-line" aria-hidden="true" />盤中追蹤</p>
              <h1>盤中即時追蹤</h1>
              <p className="ma-pixel-hero-subtitle">{safeText(decisionWhy)}</p>
              <div className="ma-pixel-cta-row"><Link to="/report/today" className="ma-pixel-primary-button">查看今日判斷<i className="ri-arrow-right-line" aria-hidden="true" /></Link></div>
            </div>
            <aside className="ma-phase2-status-card">
              <div><span>目前狀態</span><strong>{phase2CurrentStatus}</strong></div>
              <div><span>最新確認</span><p>{safeText(decisionWhy)}</p></div>
              <div><span>下一次確認</span><p>{phase2NextConfirmation}</p></div>
            </aside>
          </div>
        </section>

        <div className="ma-pixel-content ma-pixel-page-sections">
          <section>
            <VisualSectionHeader icon="ri-radar-line" title="盤中重點" />
            <div className="ma-phase2-kpi-grid">
              {intradaySummaryCards.map((item) => (
                <article key={item.label} className={`ma-phase2-kpi-card is-${item.tone}`}>
                  <p>{item.label}</p><strong>{safeText(item.value)}</strong>{item.detail && <span>{safeText(item.detail)}</span>}
                </article>
              ))}
            </div>
          </section>

          {(supportingSignals.length > 0 || opposingSignals.length > 0) && (
            <section className="ma-phase2-signal-grid">
              <div className="ma-phase2-list-panel is-support"><VisualSectionHeader icon="ri-check-line" title="支持原判斷" />{supportingSignals.map((item) => <div key={item} className="ma-phase2-signal-row"><i className="ri-check-line" aria-hidden="true" /><span>{safeText(item)}</span></div>)}</div>
              <div className="ma-phase2-list-panel is-oppose"><VisualSectionHeader icon="ri-close-line" title="反對原判斷" />{opposingSignals.map((item) => <div key={item} className="ma-phase2-signal-row"><i className="ri-close-line" aria-hidden="true" /><span>{safeText(item)}</span></div>)}</div>
            </section>
          )}

          <section>
            <VisualSectionHeader icon="ri-time-line" title="盤中時間軸" />
            <div className="ma-phase2-timeline">{phase2Timeline.map((item) => <div key={item.time} className={`ma-phase2-timeline-node is-${item.status}`}><strong>{item.time}</strong><p>{item.label}</p><span>{item.statusLabel}</span></div>)}</div>
          </section>

          {phase2Observations.length > 0 && (
            <section>
              <VisualSectionHeader icon="ri-eye-line" title="目前觀察" />
              <div className="ma-phase2-observation-grid">{phase2Observations.map((item) => <article key={item.key} className="ma-phase2-observation-card"><header className="ma-phase2-observation-header"><div><h3>{safeText(item.name)}</h3>{item.roles.length > 0 && <p>{item.roles.join('／')}</p>}</div><span className={`is-${item.statusTone}`}>{safeText(item.status)}</span></header><dl><div><dt>{item.detailLabel}</dt><dd>{safeText(item.next)}</dd></div><div><dt>停止條件</dt><dd>{safeText(item.stop)}</dd></div></dl></article>)}</div>
            </section>
          )}
        </div>

        <div className="ma-phase2-legacy-detail max-w-5xl mx-auto px-4 md:px-6 py-5 md:py-6 space-y-3">

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

          <section className="ma-card-primary">
            <VisualSectionHeader icon="ri-focus-3-line" title="目前判斷" description={decisionWhy} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="ma-card-compact">
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">目前狀態</p>
                <p className="text-white font-bold text-base">{decisionStatusLabel(decisionStatus.status)}</p>
              </div>
              <div className="ma-card-compact">
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">最新驗證</p>
                <p className="text-white/80 text-sm font-medium leading-snug">{decisionWhy}</p>
              </div>
              <div className="ma-card-compact">
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">下一次確認</p>
                <p className="text-white/80 text-sm font-medium leading-snug">{phase2NextConfirmation}</p>
              </div>
            </div>
          </section>

          <section className="ma-card">
            <VisualSectionHeader icon="ri-scales-3-line" title="目前依據" description="四個核心證據" />
            <div className="divide-y divide-white/8 rounded-xl border border-white/8 bg-navy-900/45 overflow-hidden">
              {evidenceCards.map((item) => (
                <div key={item.label} className="grid grid-cols-[72px_36px_1fr] sm:grid-cols-[90px_42px_1fr_100px] gap-2 px-3 py-2 items-center">
                  <p className="text-white/55 text-xs font-semibold">{item.label}</p>
                  <p className="text-sm">{evidenceStatusMark(item.status)}</p>
                  <p className="text-white text-xs font-medium leading-snug">{item.status}</p>
                  <p className="hidden sm:block text-white/35 text-xs text-right">{compactChineseText(item.note, '等待資料', 12)}</p>
                </div>
              ))}
            </div>
            <p className="text-white/60 text-xs leading-snug mt-3">{evidenceConclusion}</p>
          </section>

          <section className="ma-card">
            <VisualSectionHeader icon="ri-exchange-line" title="哪些條件改變了" />
            {changedGroups.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {changedGroups.map((group) => (
                  <div key={group.label} className="p-3 rounded-xl bg-navy-900/60 border border-white/8">
                    <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">{group.label}</p>
                    <ul className="space-y-1">
                      {group.items.slice(0, 2).map((item, idx) => (
                        <li key={`${group.label}-${idx}`} className="text-white/75 text-sm leading-snug break-words">
                          {compactChineseText(item, '等待資料確認。', 36)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-white/45 text-sm">目前尚無新的條件變化。</p>
            )}
          </section>

          <VisualSectionHeader icon="ri-radar-line" title="深入盤中資訊" description="想深讀時再往下看。" />

          {/* ═══════════════════════════════════════ */}
          {/* CARD 2 — 09:30 盤中雷達 */}
          {/* ═══════════════════════════════════════ */}
          <section className={`rounded-2xl border p-4 ${segmentBorder(tracking.intraday.color)} ${segmentBg(tracking.intraday.color)}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">09:30</span>
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">盤中雷達</h2>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${segmentBadgeStyle(tracking.intraday.color)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tracking.intraday.color === 'green' ? 'bg-emerald-400' : tracking.intraday.color === 'red' ? 'bg-red-400' : tracking.intraday.color === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                {humanStatus(tracking.intraday.statusText)}
              </span>
            </div>
            {tracking.intraday.showContent && openingRadar && tracking.intraday.isToday && (
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
            {(!tracking.intraday.showContent || !tracking.intraday.isToday) && (
              <div>
                <p className="text-white/50 text-sm mb-2">{tracking.intraday.description}</p>
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
          {/* CARD 1 — 07:30 盤前方向 */}
          {/* ═══════════════════════════════════════ */}
          {/* ═══════════════════════════════════════ */}
          {/* CARD 3 — 14:10 收盤驗證 */}
          {/* ═══════════════════════════════════════ */}
          <section className={`rounded-2xl border p-4 ${segmentBorder(tracking.closeReview.color)} ${segmentBg(tracking.closeReview.color)}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 whitespace-nowrap">14:10</span>
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">收盤驗證</h2>
              </div>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${segmentBadgeStyle(tracking.closeReview.color)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tracking.closeReview.color === 'green' ? 'bg-emerald-400' : tracking.closeReview.color === 'red' ? 'bg-red-400' : tracking.closeReview.color === 'amber' ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                {humanStatus(tracking.closeReview.statusText)}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-white/[0.025] border border-white/5 px-3 py-2">
              <div className="min-w-0">
                <p className="text-white/35 text-[10px] uppercase tracking-wider">收盤驗證</p>
                <p className="text-white/75 text-sm font-medium truncate">
                  {closeVerificationRecord && !isCloseVerificationPending ? closeVerdictLabel : '未完成'}
                  {closeVerificationRecord && !isCloseVerificationPending && closeResultText !== '等待收盤資料' ? `｜${closeResultText}` : ''}
                </p>
                {isCloseVerificationDegraded && (
                  <p className="text-amber-200/75 text-xs mt-0.5">個股與類股資料仍不完整。</p>
                )}
              </div>
              <Link to="/performance" className="shrink-0 inline-flex text-amber-300 hover:text-amber-200 text-sm font-semibold">
                查看完整 Decision Journal →
              </Link>
            </div>
          </section>

          {/* ═══════════════════════════════════════ */}
          {/* CARD 4 — 14:20 類股輪動 */}
          {/* ═══════════════════════════════════════ */}
          <section className={`rounded-2xl border p-4 ${segmentBorder(tracking.sectorRotation.color)} ${segmentBg(tracking.sectorRotation.color)}`}>
            <div className="flex items-center justify-between mb-3">
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

        </div>
      </main>

      <Footer />
    </div>
  );
}
