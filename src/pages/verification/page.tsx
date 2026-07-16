import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { getTodayIntradayCheck } from '@/services/intradayCheckService';
import { getTodayOpeningRadar, type OpeningRadar } from '@/services/openingRadarService';
import {
  getDataTimestamps,
  formatTimestampForDisplay,
  type DataTimestamps,
} from '@/services/dataTimestampService';
import type { Report } from '@/types/report';
import type { IntradayCheck } from '@/services/intradayCheckService';
import { trackPageView } from '@/utils/analytics';
import { formatTaipeiDate, resolveMarketStatus } from '@/utils/tradingDay';
import { runtimeTimelineStatusLabel } from '@/lib/runtimeDecisionTimeline';
import { mapRowToReport } from '@/services/reportService';
import {
  getMarketSourceHealth,
  computeDataTrustStatus,
  sourceStatusToChinese,
  sourceStatusIcon,
  sourceStatusColor,
  sourceStatusBgColor,
  sourceStatusBorderColor,
  type MarketSourceHealth,
} from '@/services/marketSourceHealthService';
import { fetchNewsFilterStats, type NewsFilterStats } from '@/services/marketNewsService';
import {
  buildVerificationNarrative,
  getSelectedMarketNews,
  getSentimentColor,
  getMarketBiasLabel,
  MARKET_BIAS_EXPLANATION,
  type NewsItem,
} from '@/services/narrativeBuilder';
import { deriveMarketHealthScore, getMarketHealthColor, getDayStatus } from '@/services/marketHealthScore';
import {
  getRecentCloseMarketReviews,
  computeVerificationStats,
  getVerificationLabelStyle,
  type CloseMarketReview,
} from '@/services/closeMarketReviewService';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { applyMarketBiasDowngrade } from '@/utils/marketBiasDowngrade';

function openingStatusToChinese(status: string | null): string {
  if (!status) return '觀察中';
  switch (status) {
    case 'confirmed': return '劇本成立';
    case 'strengthened': return '開盤轉強';
    case 'weakened': return '開盤轉弱';
    case 'invalidated': return '劇本失效';
    case 'reversal': return '市場反轉';
    case 'unknown': return '資料不足';
    default: return '觀察中';
  }
}

function openingStatusColor(status: string | null): string {
  if (!status) return 'text-white/40';
  switch (status) {
    case 'confirmed': return 'text-forest-400';
    case 'strengthened': return 'text-forest-400';
    case 'weakened': return 'text-amber-400';
    case 'invalidated': return 'text-red-400';
    case 'reversal': return 'text-red-400';
    case 'unknown': return 'text-amber-400';
    default: return 'text-white/40';
  }
}

function openingStatusBg(status: string | null): string {
  if (!status) return 'bg-white/5';
  switch (status) {
    case 'confirmed': return 'bg-forest-500/10';
    case 'strengthened': return 'bg-forest-500/10';
    case 'weakened': return 'bg-amber-500/10';
    case 'invalidated': return 'bg-red-500/10';
    case 'reversal': return 'bg-red-500/10';
    case 'unknown': return 'bg-amber-500/10';
    default: return 'bg-white/5';
  }
}

function openingStatusBorder(status: string | null): string {
  if (!status) return 'border-white/10';
  switch (status) {
    case 'confirmed': return 'border-forest-500/20';
    case 'strengthened': return 'border-forest-500/20';
    case 'weakened': return 'border-amber-500/20';
    case 'invalidated': return 'border-red-500/20';
    case 'reversal': return 'border-red-500/20';
    case 'unknown': return 'border-amber-500/20';
    default: return 'border-white/10';
  }
}

function formatChange(val: number | null): string {
  if (val === null || val === undefined) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function changeColor(val: number | null): string {
  if (val === null || val === undefined) return 'text-white/30';
  if (val > 0) return 'text-forest-400';
  if (val < 0) return 'text-red-400';
  return 'text-white/40';
}

function formatTaipeiDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

export default function VerificationPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [intraday, setIntraday] = useState<IntradayCheck | null>(null);
  const [openingRadar, setOpeningRadar] = useState<OpeningRadar | null>(null);
  const [selectedNews, setSelectedNews] = useState<NewsItem[]>([]);
  const [timestamps, setTimestamps] = useState<DataTimestamps | null>(null);
  const [sourceHealth, setSourceHealth] = useState<MarketSourceHealth[]>([]);
  const [newsStats, setNewsStats] = useState<NewsFilterStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todayMarketStatus = resolveMarketStatus(formatTaipeiDate());
  const isNonTradingDay = !todayMarketStatus.is_trading_day;
  const notApplicableLabel = runtimeTimelineStatusLabel('not_applicable');

  // Close market reviews
  const [closeMarketReviews, setCloseMarketReviews] = useState<CloseMarketReview[]>([]);
  const [cmrLoading, setCmrLoading] = useState(true);

  // Monthly stats
  const [monthlyStats, setMonthlyStats] = useState<{
    totalPredictions: number;
    confirmedCount: number;
    failedCount: number;
    successRate: number;
  }>({ totalPredictions: 0, confirmedCount: 0, failedCount: 0, successRate: 0 });

  // V7.53: close_validation from ai_strategy_json — DEPRECATED, using close_market_reviews table now (V393)
  // const [closeValidation, setCloseValidation] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    trackPageView('/verification');

    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [resolved, intradayData, radarData, newsItems, tsData, healthData, newsStatsData] = await Promise.all([
          resolveActiveMorningAlphaReport(),
          getTodayIntradayCheck(),
          getTodayOpeningRadar(),
          getSelectedMarketNews(8),
          getDataTimestamps(),
          getMarketSourceHealth(),
          fetchNewsFilterStats().catch(() => null),
        ]);

        // V8: Monthly stats computed from available data (no direct intraday_checks query)
        const monthlyStatsFallback = { totalPredictions: 0, confirmedCount: 0, failedCount: 0, successRate: 0 };

        let reportData: Report | null = resolved.rawRow
          ? mapRowToReport(resolved.rawRow as unknown as Record<string, unknown>)
          : null;

        // V7.53: Apply market bias downgrade for post-close
        if (reportData && radarData) {
          const downgradedBias = applyMarketBiasDowngrade(reportData.market_bias, {
            taiexChange: radarData.taiex_change ?? null,
            txfChange: radarData.txf_change ?? null,
            tsmc2330Change: radarData.tsmc_change ?? null,
          });
          if (downgradedBias && downgradedBias !== reportData.market_bias) {
            reportData = { ...reportData, market_bias: downgradedBias };
          }
        }

        setReport(reportData);
        setIntraday(intradayData);
        setOpeningRadar(radarData);
        setSelectedNews(newsItems);
        setTimestamps(tsData);
        setSourceHealth(healthData);
        setNewsStats(newsStatsData);
        setMonthlyStats(monthlyStatsFallback);

        getRecentCloseMarketReviews(7)
          .then((cmrs) => {
            setCloseMarketReviews(cmrs);
            setCmrLoading(false);
          })
          .catch(() => {
            setCmrLoading(false);
          });
      } catch {
        setError('驗證資料暫時無法取得，請稍後重新載入。');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-forest-500/30 border-t-forest-500 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-white/40 text-sm">載入驗證資料中...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-error-warning-line text-red-500 text-3xl mb-3"></i>
            <h2 className="text-white font-semibold text-base mb-2">讀取資料失敗</h2>
            <p className="text-white/50 text-sm mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="min-h-11 px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10"
            >
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const verification = buildVerificationNarrative(report, intraday, selectedNews);
  const openingStatus = intraday?.opening_status ?? null;
  const isCritical = openingStatus === 'invalidated' || openingStatus === 'reversal';
  const isUnknown = openingStatus === 'unknown';

  // 今日盤勢分數
  const marketHealth = deriveMarketHealthScore(
    openingRadar?.radar_status ?? null,
    openingRadar?.market_bias ?? null,
    report?.market_bias ?? null,
  );
  const healthColor = getMarketHealthColor(marketHealth.score);

  // 一眼看懂今日狀態
  const dayStatus = openingRadar
    ? getDayStatus(
        openingRadar.radar_status,
        openingRadar.market_bias,
        report?.market_bias ?? null,
        openingRadar.taiex_change,
        openingRadar.tsmc_change,
      )
    : null;

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* Header */}
        <section className="w-full px-4 md:px-6 pt-8 pb-6 md:pt-14 md:pb-10">
          <div className="max-w-5xl mx-auto w-full">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
                SCRIPT VERIFICATION
              </p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
                <i className="ri-shield-check-line"></i>
                信任中心
              </span>
            </div>
            <h1 className="text-white font-bold text-2xl md:text-4xl mb-3 leading-tight">
              信任中心
            </h1>
            <p className="text-white/40 text-sm md:text-base leading-relaxed max-w-2xl">
              驗證 07:30 盤前劇本與 09:15 開盤雷達的一致性。比對盤前假設與開盤後實際變化，建立對系統的長期信任。
            </p>

            {/* Monthly Stats */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 md:p-4 rounded-xl bg-navy-900/60 border border-navy-800 text-center">
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">本月預測</p>
                <p className="text-white font-bold text-xl md:text-2xl">{monthlyStats.totalPredictions}<span className="text-white/30 text-sm ml-1">次</span></p>
              </div>
              <div className="p-3 md:p-4 rounded-xl bg-forest-500/5 border border-forest-500/10 text-center">
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">成立</p>
                <p className="text-forest-400 font-bold text-xl md:text-2xl">{monthlyStats.confirmedCount}<span className="text-forest-400/50 text-sm ml-1">次</span></p>
              </div>
              <div className="p-3 md:p-4 rounded-xl bg-red-500/5 border border-red-500/10 text-center">
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">失敗</p>
                <p className="text-red-400 font-bold text-xl md:text-2xl">{monthlyStats.failedCount}<span className="text-red-400/50 text-sm ml-1">次</span></p>
              </div>
              <div className={`p-3 md:p-4 rounded-xl border text-center ${
                monthlyStats.successRate >= 70 ? 'bg-forest-500/5 border-forest-500/10' :
                monthlyStats.successRate >= 50 ? 'bg-amber-500/5 border-amber-500/10' :
                'bg-red-500/5 border-red-500/10'
              }`}>
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">成功率</p>
                <p className={`font-bold text-xl md:text-2xl ${
                  monthlyStats.successRate >= 70 ? 'text-forest-400' :
                  monthlyStats.successRate >= 50 ? 'text-amber-400' :
                  'text-red-400'
                }`}>{monthlyStats.successRate}<span className="text-white/30 text-sm ml-1">%</span></p>
              </div>
            </div>
          </div>
        </section>

        {/* Content */}
        <section className="w-full px-4 md:px-6 pb-10 md:pb-16">
          <div className="max-w-5xl mx-auto w-full space-y-6 md:space-y-8">
            {/* Section 1: 07:30 盤前劇本 */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
                    PRE-MARKET SCRIPT
                  </p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
                    <i className="ri-sun-line"></i>
                    07:30 盤前劇本
                  </span>
                </div>
              </div>

              {report ? (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  {/* V14: Weekend fallback indicator */}
                  {isNonTradingDay && report.report_date !== todayMarketStatus.market_date && (
                    <div className="mb-4 px-3 py-2 rounded-lg bg-sky-500/[0.05] border border-sky-500/10 flex items-center gap-2">
                      <i className="ri-calendar-line text-sky-400 text-xs"></i>
                      <span className="text-sky-400/80 text-xs">
                        今天非交易日，顯示最近交易日（{report.report_date}）盤前劇本
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-white font-bold text-lg md:text-xl">
                        {getMarketBiasLabel(report.market_bias, report.confidence_score)}
                        {report.confidence_score !== null && (
                          <span className="ml-2 text-base md:text-lg font-semibold text-white/60">
                            盤前判讀把握度 {report.confidence_score}/100
                          </span>
                        )}
                      </h2>
                      <p className="text-white/40 text-sm mt-1">
                        報告產生時間：{formatTaipeiDateTime(report.created_at)}
                      </p>
                      <p className="text-white/25 text-[10px] mt-1 leading-relaxed">{MARKET_BIAS_EXPLANATION}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-white/20 text-[10px] uppercase tracking-wider">報告日期</span>
                      <p className="text-white/60 text-sm font-medium">{report.report_date}</p>
                    </div>
                  </div>

                  {/* 盤前假設 - 使用 narrative builder */}
                  <div className="mb-4 p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">盤前假設</p>
                    <p className="text-white/70 text-sm leading-relaxed">{verification.premarketAssumption}</p>
                  </div>

                  {/* 主線 */}
                  {report.key_drivers && report.key_drivers.length > 0 && (
                    <div className="mb-4">
                      <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">盤前主線</p>
                      <div className="flex flex-wrap gap-2">
                        {report.key_drivers.slice(0, 3).map((driver, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 bg-forest-500/10 border border-forest-500/20 rounded-lg text-forest-400 text-xs">
                            {driver}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 不要顯示 report.summary 或 important_news_json，避免與其他頁面重複 */}
                </div>
              ) : (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse"></div>
                    <span className="text-white/30 text-xs font-medium">
                      {isNonTradingDay ? `今日非交易日 · ${notApplicableLabel}` : '等待報告'}
                    </span>
                  </div>
                  <p className="text-white/50 text-sm leading-relaxed">
                    {isNonTradingDay
                      ? '今天非交易日，本節點不適用；等待下一個交易日。'
                      : '今日盤前劇本尚未產生，系統會在 07:30 前自動生成。'}
                  </p>
                </div>
              )}
            </section>

            {/* Section 2: 09:15 開盤驗證 (opening_market_radar primary) */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
                    OPENING VERIFICATION
                  </p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
                    <i className="ri-radar-line"></i>
                    09:15 開盤驗證
                  </span>
                </div>
              </div>

              {openingRadar ? (
                <div className="bg-navy-900/60 border border-red-500/20 rounded-2xl p-5 md:p-6">
                  {/* 信任中心：07:30 → 09:15 → 驗證結果 → 今日解讀 */}
                  
                  {/* 07:30 盤前劇本 */}
                  <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-forest-500/10 text-forest-400 border border-forest-500/20 whitespace-nowrap">
                      07:30
                    </span>
                    <span className="text-white/20 text-[10px] uppercase tracking-wider whitespace-nowrap">盤前劇本</span>
                    <span className="text-white/70 text-sm font-medium">{openingRadar.premarket_bias || report?.market_bias || '—'}</span>
                    {report?.confidence_score != null && (
                      <span className="text-white/25 text-xs ml-auto whitespace-nowrap">盤前判讀把握度 {report.confidence_score}/100</span>
                    )}
                  </div>

                  {/* 09:15 開盤驗證 */}
                  <div className="flex items-center gap-3 mb-4 p-3 rounded-xl border border-red-500/20 bg-red-500/[0.03]">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 whitespace-nowrap">
                      09:15
                    </span>
                    <span className="text-white/20 text-[10px] uppercase tracking-wider whitespace-nowrap">開盤驗證</span>
                    <span className="text-red-400 text-sm font-semibold">{openingRadar.radar_status}</span>
                    {openingRadar.confidence_score != null && (
                      <span className="text-white/25 text-xs ml-auto whitespace-nowrap">盤中判讀把握度 {openingRadar.confidence_score}/100</span>
                    )}
                    {openingRadar.is_premarket_overridden && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] font-medium rounded-full border border-red-500/20">
                        <i className="ri-alert-fill"></i>
                        已降級
                      </span>
                    )}
                  </div>

                  {/* 驗證結果 */}
                  <div className="mb-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1.5">驗證結果</p>
                    <p className="text-white/80 text-sm leading-relaxed font-medium">
                      {report && openingRadar.premarket_bias && openingRadar.radar_status === '明顯偏弱' ? (
                        <>盤中雷達已將盤前<span className="text-amber-400">「{openingRadar.premarket_bias}」</span>劇本降級為<span className="text-red-400 font-semibold">「{openingRadar.radar_status}」</span>。盤前偏多假設已失效。</>
                      ) : openingRadar.radar_status === '劇本成立' ? (
                        <>盤前劇本<span className="text-forest-400 font-semibold">「{openingRadar.premarket_bias || report?.market_bias || '—'}」</span>已通過開盤驗證，方向一致。</>
                      ) : openingRadar.radar_status === '資料不足' ? (
                        <>台股核心指標不足，暫無法完成開盤驗證。</>
                      ) : (
                        <>{openingRadar.summary || `開盤雷達判斷：${openingRadar.radar_status}`}</>
                      )}
                    </p>
                  </div>

                  {/* 今日解讀 */}
                  <div className="mb-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1.5">今日解讀</p>
                    <p className="text-white/70 text-sm leading-relaxed">
                      {openingRadar.radar_status === '明顯偏弱' || openingRadar.radar_status === '盤中轉弱' ? (
                        <>盤前偏保守，盤中修正成功。今日<span className="text-red-400 font-semibold">不應追價</span>，優先觀察權值股是否止跌。</>
                      ) : openingRadar.radar_status === '劇本成立' ? (
                        <>盤前判斷與盤中走勢一致，可依盤前策略執行。</>
                      ) : (
                        <>等待更多盤中訊號確認方向。</>
                      )}
                    </p>
                  </div>

                  {/* Data Grid */}
                  <div className="grid grid-cols-3 gap-3 md:gap-4 mb-5">
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">加權指數</p>
                      <p className={`text-base md:text-lg font-bold ${changeColor(openingRadar.taiex_change ?? null)}`}>
                        {formatChange(openingRadar.taiex_change ?? null)}
                      </p>
                    </div>
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台指期</p>
                      <p className={`text-base md:text-lg font-bold ${changeColor(openingRadar.txf_change ?? null)}`}>
                        {formatChange(openingRadar.txf_change ?? null)}
                      </p>
                    </div>
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台積電</p>
                      <p className={`text-base md:text-lg font-bold ${changeColor(openingRadar.tsmc_change ?? null)}`}>
                        {formatChange(openingRadar.tsmc_change ?? null)}
                      </p>
                    </div>
                  </div>

                  {/* TXF 缺資料提示 */}
                  {(openingRadar.txf_change === null) && (
                    <div className="mb-4 p-3 rounded-xl bg-amber-500/[0.03] border border-amber-500/10">
                      <p className="text-amber-400/80 text-xs flex items-center gap-1.5">
                        <i className="ri-information-line"></i>
                        TXF 資料暫缺，本次盤中雷達把握度僅根據 TAIEX 與 2330 的實際跌幅判定，不包含台指期確認。
                      </p>
                    </div>
                  )}

                  {/* 盤中說明 / 推翻原因 */}
                  {openingRadar.override_reason && (
                    <div className="mb-4 p-3 md:p-4 rounded-xl bg-red-500/[0.03] border border-red-500/10">
                      <p className="text-red-400/70 text-[10px] uppercase tracking-wider mb-2">推翻原因</p>
                      <p className="text-white/70 text-sm leading-relaxed">{openingRadar.override_reason}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <div className="flex items-center gap-1.5 text-white/20 text-xs">
                      <i className="ri-time-line text-[10px]"></i>
                      <span>雷達更新時間 {formatTaipeiDateTime(openingRadar.updated_at)}</span>
                    </div>
                    <button
                      onClick={() => window.location.reload()}
                      className="inline-flex min-h-11 items-center gap-1.5 text-white/30 hover:text-white/50 text-xs transition-colors"
                    >
                      <i className="ri-refresh-line text-[10px]"></i>
                      重新整理
                    </button>
                  </div>
                </div>
              ) : intraday ? (
                /* Fallback: intraday_checks (legacy) */
                <div className={`rounded-2xl border ${openingStatusBorder(openingStatus)} ${openingStatusBg(openingStatus)} p-5 md:p-6`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-5">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${isCritical ? 'bg-red-400' : isUnknown ? 'bg-amber-400' : 'bg-forest-400'} animate-pulse`}></div>
                      <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${openingStatusBorder(openingStatus)} ${openingStatusColor(openingStatus)}`}>
                        {openingStatusToChinese(openingStatus)}
                      </span>
                    </div>
                    <div className="hidden sm:block w-px h-6 bg-white/10"></div>
                    {intraday.scenario_result && (
                      <span className="text-white/60 text-sm">{intraday.scenario_result}</span>
                    )}
                  </div>

                  <div className="mb-4 p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">驗證結果</p>
                    <p className="text-white/80 text-sm leading-relaxed font-medium">{verification.openingResult}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 md:gap-4 mb-5">
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">加權指數</p>
                      <p className={`text-base md:text-lg font-bold ${changeColor(intraday.taiex_change)}`}>
                        {formatChange(intraday.taiex_change)}
                      </p>
                    </div>
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台指期</p>
                      <p className={`text-base md:text-lg font-bold ${changeColor(intraday.futures_change)}`}>
                        {formatChange(intraday.futures_change)}
                      </p>
                    </div>
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台積電</p>
                      <p className={`text-base md:text-lg font-bold ${changeColor(intraday.tsmc_change)}`}>
                        {formatChange(intraday.tsmc_change)}
                      </p>
                    </div>
                  </div>

                  <div className="mb-4 p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">AI 校正</p>
                    <p className="text-white/80 text-sm leading-relaxed font-medium">
                      {intraday.ai_summary || '開盤雷達更新中...'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <div className="flex items-center gap-1.5 text-white/20 text-xs">
                      <i className="ri-time-line text-[10px]"></i>
                      <span>更新時間 {formatTaipeiDateTime(intraday.created_at)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse"></div>
                    <span className="text-white/30 text-xs font-medium px-2.5 py-1 rounded-full border border-white/10 bg-white/5">
                      {isNonTradingDay ? `今日非交易日 · ${notApplicableLabel}` : '等待更新'}
                    </span>
                  </div>
                  <p className="text-white/50 text-sm leading-relaxed">
                    {isNonTradingDay
                      ? '今天非交易日，本節點不適用；等待下一個交易日。'
                      : '09:15 開盤雷達尚未更新，系統會在開盤後驗證盤前劇本是否成立。'}
                  </p>
                </div>
              )}
            </section>

            {/* Section 2.5: 收盤驗證 — close_market_reviews table (V393: direction comparison) */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
                    CLOSE VALIDATION
                  </p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
                    <i className="ri-moon-clear-line"></i>
                    收盤驗證
                  </span>
                </div>
              </div>

              {(() => {
                // V394: Use ORIGINAL 07:30 premarket bias from openingRadar.premarket_bias
                // NOT report.market_bias (downgraded by radar) or close_market_reviews.premarket_bias (overwritten)
                const todayReview = closeMarketReviews.find(
                  (r) => r.report_date === (report?.report_date || '')
                );

                // Original 07:30 premarket bias — preserved in opening_market_radar.premarket_bias
                // at generation time, BEFORE any intraday radar downgrade
                const originalPremarket = (
                  openingRadar?.premarket_bias ||
                  ''
                ).trim();

                // Post-radar value (for reference only — NOT used as comparison baseline)
                const radarDowngradedBias = todayReview?.premarket_bias || report?.market_bias || '';

                const vr = (todayReview?.verification_result || '').trim();
                const note = todayReview?.verification_note || '';
                const closeResult = todayReview?.actual_market_result || '';
                const taiexClose = todayReview?.taiex_change;
                const tsmcClose = todayReview?.tsmc_change;

                // ── V394: Direction comparison logic ──
                // Compare original 07:30 premarket vs actual close result
                function isBullish(bias: string): boolean {
                  return bias.includes('偏多') || bias.includes('強勢') || bias.includes('看多');
                }
                function isBearish(bias: string): boolean {
                  return bias.includes('偏空') || bias.includes('轉弱') || bias.includes('偏弱');
                }
                function isNeutral(bias: string): boolean {
                  return bias.includes('中性') || bias.includes('震盪') || bias.includes('觀望');
                }
                function closeIsDown(): boolean {
                  return (taiexClose != null && taiexClose < -0.01) ||
                    (tsmcClose != null && tsmcClose < -0.01);
                }
                function closeIsUp(): boolean {
                  return (taiexClose != null && taiexClose > 0.01) ||
                    (tsmcClose != null && tsmcClose > 0.01);
                }

                // Determine display label and description based on ORIGINAL premarket vs close
                let displayLabel = '';
                let displayDesc = '';
                let labelColor = 'text-slate-400';
                let labelBg = 'bg-slate-500/10';
                let labelBorder = 'border-slate-500/20';
                let labelIcon = 'ri-time-line';

                if (!todayReview) {
                  displayLabel = '尚未產生';
                  displayDesc = '收盤驗證會在 close-market-review 排程執行後自動產生，通常於台股收盤後更新。';
                } else if (!originalPremarket) {
                  // No original premarket data — show system result but note limitation
                  displayLabel = '資料不足';
                  displayDesc = `無法確認原始盤前假設（07:30）。系統收盤驗證結果：${vr}。`;
                  labelColor = 'text-slate-400';
                  labelBg = 'bg-slate-500/10';
                  labelBorder = 'border-slate-500/20';
                  labelIcon = 'ri-question-line';
                } else if (vr === '方向一致' && !closeIsDown()) {
                  // System says consistent AND close is not down → trust it
                  displayLabel = '方向一致';
                  displayDesc = `07:30 盤前假設「${originalPremarket}」與收盤結果「${closeResult || '—'}」方向一致。`;
                  labelColor = 'text-emerald-400';
                  labelBg = 'bg-emerald-500/10';
                  labelBorder = 'border-emerald-500/20';
                  labelIcon = 'ri-check-double-line';
                } else if (isBullish(originalPremarket) && closeIsDown()) {
                  // PREMARKET BULLISH but CLOSE DOWN → direction correction
                  displayLabel = '方向修正';
                  const radarNote = openingRadar?.radar_status
                    ? `盤中雷達${openingRadar.radar_status === '盤中轉弱' ? '已捕捉轉弱訊號' : `顯示「${openingRadar.radar_status}」`}，`
                    : '';
                  displayDesc = `07:30 原始盤前假設「${originalPremarket}」，但收盤結果未支持盤前偏多假設（TAIEX ${taiexClose != null ? (taiexClose >= 0 ? '+' : '') + taiexClose.toFixed(2) : '—'}%、2330 ${tsmcClose != null ? (tsmcClose >= 0 ? '+' : '') + tsmcClose.toFixed(2) : '—'}%）。${radarNote}今日應標記為「盤中修正成功，但盤前方向失準」。`;
                  labelColor = 'text-amber-400';
                  labelBg = 'bg-amber-500/10';
                  labelBorder = 'border-amber-500/20';
                  labelIcon = 'ri-contrast-2-line';
                } else if (isBearish(originalPremarket) && closeIsDown()) {
                  // PREMARKET BEARISH and CLOSE DOWN → consistent
                  displayLabel = '方向一致';
                  displayDesc = `07:30 盤前假設「${originalPremarket}」與收盤下跌結果方向一致。`;
                  labelColor = 'text-emerald-400';
                  labelBg = 'bg-emerald-500/10';
                  labelBorder = 'border-emerald-500/20';
                  labelIcon = 'ri-check-double-line';
                } else if (isNeutral(originalPremarket) && Math.abs(taiexClose || 0) < 0.5) {
                  // PREMARKET NEUTRAL and CLOSE small range → mostly consistent
                  displayLabel = '大致一致';
                  displayDesc = `07:30 盤前假設「${originalPremarket}」與收盤小幅波動結果大致一致。`;
                  labelColor = 'text-emerald-400';
                  labelBg = 'bg-emerald-500/10';
                  labelBorder = 'border-emerald-500/20';
                  labelIcon = 'ri-check-line';
                } else if (vr === '未命中') {
                  displayLabel = '方向反轉';
                  displayDesc = note || `07:30 盤前假設「${originalPremarket}」vs 收盤「${closeResult}」— 盤前判斷與收盤實際方向完全相反。`;
                  labelColor = 'text-red-400';
                  labelBg = 'bg-red-500/10';
                  labelBorder = 'border-red-500/20';
                  labelIcon = 'ri-close-circle-line';
                } else if (vr === '資料不足' || vr === '待確認') {
                  displayLabel = vr;
                  displayDesc = note || '';
                } else {
                  // Fallback: use system's original verification_result but note we're comparing original premarket
                  displayLabel = vr;
                  displayDesc = note || `盤前（07:30）「${originalPremarket}」vs 收盤「${closeResult}」`;
                }

                return (
                  <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                    {/* V394: Three-column comparison: Original Premarket → Radar → Close */}
                    {todayReview && originalPremarket && (
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">07:30 盤前假設</p>
                          <p className="text-white/80 font-semibold text-sm">{originalPremarket}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">盤中雷達</p>
                          <p className={`font-semibold text-sm ${openingRadar?.radar_status?.includes('轉弱') ? 'text-red-400' : 'text-white/80'}`}>
                            {openingRadar?.radar_status || '—'}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">收盤結果</p>
                          <p className="text-white/80 font-semibold text-sm">{closeResult || '—'}</p>
                        </div>
                      </div>
                    )}

                    {/* No original premarket fallback — show 2-col */}
                    {todayReview && !originalPremarket && (
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">盤前方向</p>
                          <p className="text-white/80 font-semibold text-sm">{radarDowngradedBias}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">收盤結果</p>
                          <p className="text-white/80 font-semibold text-sm">{closeResult || '—'}</p>
                        </div>
                      </div>
                    )}

                    {/* Radar downgrade warning — when original premarket differs from today's report.market_bias */}
                    {originalPremarket && radarDowngradedBias && originalPremarket !== radarDowngradedBias && (
                      <div className="mb-4 p-3 rounded-xl bg-red-500/[0.03] border border-red-500/10">
                        <p className="text-red-400/70 text-[10px] uppercase tracking-wider mb-1">盤中方向修正</p>
                        <p className="text-white/70 text-sm leading-relaxed">
                          盤中雷達已將原始盤前假設「{originalPremarket}」降級為「{radarDowngradedBias}」。
                          收盤驗證應以原始 07:30 盤前假設為基準進行比對。
                        </p>
                      </div>
                    )}

                    {/* Verification badge */}
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${labelBorder} ${labelBg} mb-3`}>
                      <i className={`${labelIcon} ${labelColor} text-sm`}></i>
                      <span className={`${labelColor} text-sm font-semibold`}>{displayLabel}</span>
                    </div>

                    {/* Description / summary */}
                    {displayDesc && (
                      <p className="text-white/60 text-sm leading-relaxed">{displayDesc}</p>
                    )}

                    {/* Close market data */}
                    {todayReview && (taiexClose !== null || tsmcClose !== null) && (
                      <div className="mt-4 pt-4 border-t border-white/5 flex flex-wrap items-center gap-4 text-xs text-white/40">
                        {taiexClose !== null && (
                          <span>加權指數：<span className={taiexClose >= 0 ? 'text-emerald-400' : 'text-red-400'}>{taiexClose >= 0 ? '+' : ''}{taiexClose.toFixed(2)}%</span></span>
                        )}
                        {tsmcClose !== null && (
                          <span>台積電：<span className={tsmcClose >= 0 ? 'text-emerald-400' : 'text-red-400'}>{tsmcClose >= 0 ? '+' : ''}{tsmcClose.toFixed(2)}%</span></span>
                        )}
                      </div>
                    )}

                    {!todayReview && (
                      <div className="text-center py-3">
                        <p className="text-slate-500 text-xs max-w-md mx-auto">{displayDesc}</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </section>

            {/* Section 3: 10:30 主流延續確認 */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">CONTINUATION CHECK</p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
                    <i className="ri-time-line"></i>
                    10:30 確認
                  </span>
                </div>
              </div>
              <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                <div className="mb-4">
                  <h2 className="text-white font-bold text-base md:text-lg mb-2">盤前假設是否成立？</h2>
                  <p className="text-white/60 text-sm leading-relaxed">
                    {openingRadar 
                      ? `開盤驗證已完成：${openingRadar.radar_status}（把握度 ${openingRadar.confidence_score ?? '—'}/100）。${openingRadar.is_premarket_overridden ? '盤前假設已被盤中走勢推翻，改以防守觀察為主。' : '開盤結果支持盤前判斷。'}`
                      : verification.narrative
                    }
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">確認分數</p>
                    <p className={`text-lg font-bold ${verification.confirmationScore >= 60 ? 'text-forest-400' : verification.confirmationScore >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
                      {verification.confirmationScore}/100
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">劇本狀態</p>
                    <p className={`text-sm font-semibold ${verification.isConfirmed ? 'text-forest-400' : 'text-amber-400'}`}>
                      {verification.isConfirmed ? '已確認' : '待觀察'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">高分新聞</p>
                    <p className="text-white font-semibold text-sm">{verification.verifiedNews.length} 則</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 4: 使用到的高分新聞 */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">SELECTED NEWS</p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
                    <i className="ri-check-double-line"></i>
                    高品質篩選
                  </span>
                </div>
              </div>

              {selectedNews.length > 0 ? (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  <div className="space-y-3">
                    {selectedNews.map((news, idx) => (
                      <div key={news.id || idx} className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-forest-500/10 rounded-lg flex items-center justify-center flex-shrink-0 border border-forest-500/20">
                            <span className="text-forest-400 text-xs font-bold">{idx + 1}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white/80 text-sm font-medium">{news.title}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-white/30 text-xs">{news.source}</span>
                              <span className="text-white/30 text-xs">·</span>
                              <span className="text-white/30 text-xs">{news.category}</span>
                              <span className="text-white/30 text-xs">·</span>
                              <span className="text-forest-400 text-xs font-medium">{news.finalScore}/100</span>
                            </div>
                            {news.relatedTwNames.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {news.relatedTwNames.map((name, nidx) => (
                                  <span key={nidx} className="inline-flex items-center px-2 py-0.5 bg-navy-800 border border-navy-700 rounded text-white/50 text-[10px]">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <div className="flex items-start gap-2">
                      <i className="ri-information-line text-white/30 text-sm mt-0.5 flex-shrink-0"></i>
                      <p className="text-white/40 text-xs leading-relaxed">
                        以上新聞已通過品質篩選（is_selected=true），按 final_score 降冪排列。已排除 401k、Social Security、退休、信用卡、房貸、個人理財等低相關新聞。
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse"></div>
                    <span className="text-white/30 text-xs font-medium">等待新聞資料</span>
                  </div>
                  <p className="text-white/50 text-sm leading-relaxed">
                    高分新聞會在 fetch-global-market-news 執行後自動更新。
                  </p>
                </div>
              )}
            </section>

            {/* Section 5: market_data 實際變化 */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">MARKET DATA</p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 text-white/40 text-[10px] font-medium rounded-full border border-white/10">
                    <i className="ri-line-chart-line"></i>
                    實際市場變化
                  </span>
                </div>
              </div>
              <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">加權指數</p>
                    <p className={`text-lg font-bold ${changeColor(openingRadar?.taiex_change ?? intraday?.taiex_change ?? null)}`}>
                      {formatChange(openingRadar?.taiex_change ?? intraday?.taiex_change ?? null)}
                    </p>
                  </div>
                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台指期</p>
                    <p className={`text-lg font-bold ${changeColor(openingRadar?.txf_change ?? intraday?.futures_change ?? null)}`}>
                      {formatChange(openingRadar?.txf_change ?? intraday?.futures_change ?? null)}
                    </p>
                  </div>
                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">台積電</p>
                    <p className={`text-lg font-bold ${changeColor(openingRadar?.tsmc_change ?? intraday?.tsmc_change ?? null)}`}>
                      {formatChange(openingRadar?.tsmc_change ?? intraday?.tsmc_change ?? null)}
                    </p>
                  </div>
                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                    <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">ADR</p>
                    <p className="text-lg font-bold text-white/30">—</p>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-start gap-2">
                    <i className="ri-information-line text-white/30 text-sm mt-0.5 flex-shrink-0"></i>
                    <p className="text-white/40 text-xs leading-relaxed">
                      市場變化優先採用 09:15 開盤驗證；資料尚未到齊時，只顯示目前可確認的盤中紀錄。所有結果都會與 07:30 盤前劇本分開標示。
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 6: News Filter Results */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
                    NEWS FILTER
                  </p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
                    <i className="ri-filter-3-line"></i>
                    新聞篩選結果
                  </span>
                </div>
              </div>

              {newsStats ? (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 mb-5">
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">今日抓取</p>
                      <p className="text-white font-bold text-lg">{newsStats.totalToday}</p>
                      <p className="text-white/30 text-[10px]">則新聞</p>
                    </div>
                    <div className="p-3 md:p-4 rounded-xl bg-forest-500/5 border border-forest-500/10 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">AI 選中</p>
                      <p className="text-forest-400 font-bold text-lg">{newsStats.selectedToday}</p>
                      <p className="text-white/30 text-[10px]">高品質新聞</p>
                    </div>
                    <div className="p-3 md:p-4 rounded-xl bg-red-500/5 border border-red-500/10 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">排除低相關</p>
                      <p className="text-red-400 font-bold text-lg">{newsStats.rejectedToday}</p>
                      <p className="text-white/30 text-[10px]">已過濾</p>
                    </div>
                    <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">平均品質分</p>
                      <p className="text-white font-bold text-lg">{newsStats.avgFinalScore}</p>
                      <p className="text-white/30 text-[10px]">/100</p>
                    </div>
                  </div>

                  {/* Highest Score News */}
                  {newsStats.maxScoreNews && (
                    <div className="mb-4 p-3 md:p-4 rounded-xl bg-amber-500/[0.03] border border-amber-500/10">
                      <div className="flex items-center gap-2 mb-2">
                        <i className="ri-trophy-line text-amber-400 text-sm"></i>
                        <span className="text-amber-400/70 text-xs font-medium">最高分新聞</span>
                        <span className="text-amber-400 text-xs font-bold ml-auto">{newsStats.maxFinalScore}/100</span>
                      </div>
                      <p className="text-white/80 text-sm font-medium">{newsStats.maxScoreNews.title}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="text-white/30 text-[10px]">{newsStats.maxScoreNews.source}</span>
                        <span className="text-white/30 text-[10px]">·</span>
                        <span className="text-white/30 text-[10px]">{newsStats.maxScoreNews.category}</span>
                      </div>
                    </div>
                  )}

                  {/* Top Taiwan Watchlist */}
                  {newsStats.topTwNames.length > 0 && (
                    <div className="mb-4">
                      <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">對應台股觀察股</p>
                      <div className="flex flex-wrap gap-2">
                        {newsStats.topTwNames.map((name, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-navy-800 border border-navy-700 rounded-lg text-white/70 text-xs"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Footer note */}
                  <div className="pt-4 border-t border-white/5">
                    <div className="flex items-start gap-2">
                      <i className="ri-information-line text-white/30 text-sm mt-0.5 flex-shrink-0"></i>
                      <p className="text-white/40 text-xs leading-relaxed">
                        新聞篩選已排除 401k、Social Security、退休、信用卡、房貸、個人理財等低相關新聞。只有與台股有直接關聯（含台股映射）且 final_score &gt;= 60 的新聞才會被選中。
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse"></div>
                    <span className="text-white/30 text-xs font-medium">等待新聞資料更新</span>
                  </div>
                  <p className="text-white/50 text-sm leading-relaxed">
                    新聞篩選統計會在 fetch-global-market-news 執行後自動更新。
                  </p>
                </div>
              )}
            </section>

            {/* Section 7: Data Source Health */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
                    DATA SOURCE CHECK
                  </p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 text-white/40 text-[10px] font-medium rounded-full border border-white/10">
                    <i className="ri-shield-check-line"></i>
                    資料來源檢查
                  </span>
                </div>
              </div>

              <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                {/* Overall status */}
                {(() => {
                  const trustStatus = computeDataTrustStatus(sourceHealth);
                  return (
                    <div className={`mb-4 p-3 md:p-4 rounded-xl border ${trustStatus.statusBorder} ${trustStatus.statusBg} flex items-center gap-3`}>
                      <div className={`w-2 h-2 rounded-full ${trustStatus.overallStatus === 'complete' ? 'bg-forest-400' : trustStatus.overallStatus === 'partial' ? 'bg-amber-400' : 'bg-red-400'}`}></div>
                      <div>
                        <p className={`text-sm font-semibold ${trustStatus.statusColor}`}>
                          資料完整度：{trustStatus.statusLabel}
                        </p>
                        {trustStatus.warningMessage && (
                          <p className="text-white/40 text-xs mt-0.5">{trustStatus.warningMessage}</p>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Source list */}
                <div className="space-y-2">
                  {sourceHealth.length > 0 ? (
                    sourceHealth.map((source) => {
                      const icon = sourceStatusIcon(source.status);
                      const color = sourceStatusColor(source.status);
                      const bg = sourceStatusBgColor(source.status);
                      const border = sourceStatusBorderColor(source.status);
                      return (
                        <div key={source.source_name} className={`p-3 md:p-4 rounded-xl border ${border} ${bg} flex items-center gap-3`}>
                          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                            <i className={`${icon} ${color} text-base`}></i>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-white/70 text-sm font-medium">{source.source_name}</p>
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${border} ${color}`}>
                                {sourceStatusToChinese(source.status)}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-white/30 text-xs">
                              <span>最新資料：{formatTaipeiDateTime(source.latest_data_at)}</span>
                              <span>筆數：{source.records_count}</span>
                              {source.error_message && (
                                <span className="text-amber-300/60">{source.error_message}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-white/40 text-sm">資料來源健康檢查尚未執行</p>
                      <p className="text-white/25 text-xs mt-1">系統會自動檢查並更新資料來源狀態</p>
                    </div>
                  )}
                </div>

                {/* Footer note */}
                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-start gap-2">
                    <i className="ri-information-line text-white/30 text-sm mt-0.5 flex-shrink-0"></i>
                    <p className="text-white/40 text-xs leading-relaxed">
                      資料來源檢查顯示 Morning Alpha 各資料來源的最新狀態。若某來源顯示「警告」或「錯誤」，代表該資料來源可能尚未更新或資料不足，AI 報告的相關判斷可能受到影響。
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Section 8: Data Source Transparency */}
            <section className="w-full">
              <div className="mb-4 md:mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
                    DATA TRANSPARENCY
                  </p>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 text-white/40 text-[10px] font-medium rounded-full border border-white/10">
                    <i className="ri-database-2-line"></i>
                    資料來源透明度
                  </span>
                </div>
              </div>

              <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <i className="ri-file-text-line text-white/30 text-sm"></i>
                      <p className="text-white/30 text-[10px] uppercase tracking-wider">盤前報告</p>
                    </div>
                    <p className="text-white/70 text-sm font-medium">
                      {timestamps ? formatTimestampForDisplay(timestamps.reportCreatedAt) : '—'}
                    </p>
                    <p className="text-white/30 text-xs mt-1">reports 表最新資料</p>
                  </div>

                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <i className="ri-radar-line text-white/30 text-sm"></i>
                      <p className="text-white/30 text-[10px] uppercase tracking-wider">開盤雷達</p>
                    </div>
                    <p className="text-white/70 text-sm font-medium">
                      {timestamps ? formatTimestampForDisplay(timestamps.openingRadarCreatedAt) : '—'}
                    </p>
                    <p className="text-white/30 text-xs mt-1">09:15 開盤驗證最新更新</p>
                  </div>

                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <i className="ri-line-chart-line text-white/30 text-sm"></i>
                      <p className="text-white/30 text-[10px] uppercase tracking-wider">市場數據</p>
                    </div>
                    <p className="text-white/70 text-sm font-medium">
                      {timestamps ? formatTimestampForDisplay(timestamps.marketDataCapturedAt) : '—'}
                    </p>
                    <p className="text-white/30 text-xs mt-1">盤中市場資料最新更新</p>
                  </div>

                  <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                      <i className="ri-newspaper-line text-white/30 text-sm"></i>
                      <p className="text-white/30 text-[10px] uppercase tracking-wider">最新新聞</p>
                    </div>
                    <p className="text-white/70 text-sm font-medium">
                      {timestamps ? formatTimestampForDisplay(timestamps.marketNewsPublishedAt) : '—'}
                    </p>
                    <p className="text-white/30 text-xs mt-1">市場新聞最新更新</p>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-white/5">
                  <div className="flex items-start gap-2">
                    <i className="ri-information-line text-white/30 text-sm mt-0.5 flex-shrink-0"></i>
                    <p className="text-white/40 text-xs leading-relaxed">
                      所有資料時間均轉換為 Asia/Taipei 時區顯示。盤前劇本（07:30）與開盤雷達（09:15）是兩個獨立的資料來源，不可混為同一個「市場情緒」判斷。
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Back to home */}
            <div className="flex items-center justify-center pt-4">
              <Link
                to="/"
                className="inline-flex min-h-11 items-center gap-2 text-white/40 hover:text-white/60 text-sm transition-colors"
              >
                <i className="ri-arrow-left-line"></i>
                返回首頁
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
