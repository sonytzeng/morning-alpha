import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { getLatestReports } from '@/services/reportService';
import { trackPageView } from '@/utils/analytics';
import { getMarketBiasLabel, MARKET_BIAS_EXPLANATION } from '@/services/narrativeBuilder';
import {
  getCloseMarketReviewsByDates,
  getVerificationLabelStyle,
} from '@/services/closeMarketReviewService';
import type { Report } from '@/types/report';
import V11ObservationSection, { mapV11ObservationItems } from '@/components/v11/V11ObservationSection';

export default function ReportsCenter() {
  const [reports7, setReports7] = useState<Report[]>([]);
  const [reports30, setReports30] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [verificationMap, setVerificationMap] = useState<Map<string, ReturnType<typeof getVerificationLabelStyle>>>(new Map());

  useEffect(() => {
    trackPageView('/reports');

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const all = await getLatestReports(30);
        setReports7(all.slice(0, 7));
        setReports30(all.slice(7, 30));

        // Fetch close market reviews for all report dates
        const allDates = all.map((r) => r.report_date);
        if (allDates.length > 0) {
          const cmrMap = await getCloseMarketReviewsByDates(allDates);
          const labelMap = new Map<string, ReturnType<typeof getVerificationLabelStyle>>();
          for (const [date, cmr] of cmrMap) {
            labelMap.set(date, getVerificationLabelStyle(cmr.verification_label));
          }
          setVerificationMap(labelMap);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取資料失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // V377: 台股語境 — 偏多紅、偏空綠、震盪琥珀
  const getSentimentColor = (bias: string) => {
    if (bias.includes('偏多') || bias.includes('偏強') || bias.includes('強多')) {
      return {
        text: 'text-red-400',
        bg: 'bg-red-500/10',
        border: 'border-red-500/20',
        dot: 'bg-red-400',
      };
    }
    if (bias.includes('偏空') || bias.includes('偏弱') || bias.includes('強空')) {
      return {
        text: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
        dot: 'bg-emerald-400',
      };
    }
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      dot: 'bg-amber-400',
    };
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${month}/${day} (${weekDays[d.getDay()]})`;
  };

  const getScoreLabel = (score: number | null) => {
    if (score === null || score === undefined) return { label: '觀察中', color: 'text-white/40' };
    if (score >= 80) return { label: '高把握度', color: 'text-forest-400' };
    if (score >= 60) return { label: '明確', color: 'text-forest-400/70' };
    if (score >= 40) return { label: '中性', color: 'text-amber-400' };
    if (score >= 20) return { label: '偏弱', color: 'text-amber-400/70' };
    return { label: '謹慎', color: 'text-red-400' };
  };

  const selectedAI = selectedReport?.ai_strategy_json && typeof selectedReport.ai_strategy_json === 'object'
    ? selectedReport.ai_strategy_json as Record<string, unknown>
    : {};
  const selectedV10Enabled = selectedAI.v10_beneficiary_enabled === true || selectedAI.v10_beneficiary_enabled === 'true';
  const selectedV11ObservationScripts = mapV11ObservationItems(selectedAI.v10_observation_watchlist, 5);

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-white/50 text-sm">載入歷史報告...</span>
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
            <i className="ri-error-warning-line text-red-500 text-3xl mb-3" />
            <h2 className="text-white font-semibold text-base mb-2">讀取歷史報告失敗</h2>
            <p className="text-white/50 text-sm mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10"
            >
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        <div className="w-full px-4 md:px-6 py-6 md:py-10">
          <div className="max-w-5xl mx-auto w-full space-y-8 md:space-y-10">

            {/* ===== HEADER ===== */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold mb-1">
                  REPORTS ARCHIVE
                </p>
                <h1 className="text-white font-bold text-xl md:text-2xl mb-1">歷史驗證</h1>
                <p className="text-white/50 text-sm">
                  回顧過去每一天的盤前判斷，訓練自己對市場節奏的感知。
                </p>
                <p className="text-white/30 text-[10px] mt-2 leading-relaxed">{MARKET_BIAS_EXPLANATION}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border bg-white/5 border-white/10 text-white/40">
                  <i className="ri-archive-line text-white/30" />
                  共 {reports7.length + reports30.length} 份報告
                </span>
              </div>
            </div>

            {/* ===== 最近 7 天 ===== */}
            <section>
              <div className="mb-4 md:mb-5">
                <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold mb-1">
                  LAST 7 DAYS
                </p>
                <h2 className="text-white font-bold text-lg md:text-xl">最近 7 天報告</h2>
              </div>

              {reports7.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                  {reports7.map((r) => {
                    const displayBias = getMarketBiasLabel(r.market_bias, r.confidence_score);
                    const color = getSentimentColor(r.market_bias || displayBias);
                    const scoreInfo = getScoreLabel(r.confidence_score);
                    const combinedBias = `${scoreInfo.label}・${displayBias}`;
                    const vLabel = verificationMap.get(r.report_date);
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelectedReport(r)}
                        className="bg-navy-900/60 border border-navy-800 rounded-2xl p-4 md:p-5 text-left hover:border-navy-600 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-white/50 text-xs font-medium">
                            {formatDate(r.report_date)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {vLabel && (
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${vLabel.bg} ${vLabel.border} ${vLabel.text}`}>
                                <i className={`${vLabel.icon} text-[9px]`}></i>
                                {vLabel.display}
                              </span>
                            )}
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${color.bg} ${color.border} ${color.text}`}>
                              <div className={`w-1 h-1 rounded-full ${color.dot}`} />
                              {combinedBias}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-lg font-bold ${scoreInfo.color}`}>
                            {r.confidence_score ?? 0}
                          </span>
                          <span className="text-white/30 text-xs">/100</span>
                          <span className={`text-xs ${scoreInfo.color}`}>{scoreInfo.label}</span>
                        </div>
                        <p className="text-white/50 text-xs leading-relaxed line-clamp-2">
                          {(r.summary || '').slice(0, 100) || r.today_quote || '無摘要'}
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-white/30 text-[10px]">點擊卡片快速預覽</span>
                          <Link
                            to={`/reports/${r.report_date}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 text-[10px] font-medium transition-colors whitespace-nowrap"
                          >
                            <i className="ri-external-link-line" />
                            查看完整報告
                          </Link>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  <p className="text-white/40 text-sm">暫無最近 7 天報告資料。</p>
                </div>
              )}
            </section>

            {/* ===== 最近 30 天 ===== */}
            <section>
              <div className="mb-4 md:mb-5">
                <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold mb-1">
                  LAST 30 DAYS
                </p>
                <h2 className="text-white font-bold text-lg md:text-xl">最近 30 天報告</h2>
              </div>

              {reports30.length > 0 ? (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px]">
                      <thead>
                        <tr className="bg-white/5">
                          <th className="px-4 py-3 text-left text-white/40 text-xs font-medium whitespace-nowrap">
                            日期
                          </th>
                          <th className="px-4 py-3 text-left text-white/40 text-xs font-medium whitespace-nowrap">
                            市場情緒
                          </th>
                          <th className="px-4 py-3 text-left text-white/40 text-xs font-medium whitespace-nowrap">
                            分數
                          </th>
                          <th className="px-4 py-3 text-left text-white/40 text-xs font-medium whitespace-nowrap">
                            摘要
                          </th>
                          <th className="px-4 py-3 text-right text-white/40 text-xs font-medium whitespace-nowrap">
                            操作
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports30.map((r) => {
                          const displayBias = getMarketBiasLabel(r.market_bias, r.confidence_score);
                          const color = getSentimentColor(r.market_bias || displayBias);
                          const scoreInfo = getScoreLabel(r.confidence_score);
                          const combinedBias = `${scoreInfo.label}・${displayBias}`;
                          const vLabel = verificationMap.get(r.report_date);
                          return (
                            <tr
                              key={r.id}
                              className="border-t border-white/5 hover:bg-white/5 transition-colors"
                            >
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="text-white text-sm font-medium">
                                  {formatDate(r.report_date)}
                                </span>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  {vLabel && (
                                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${vLabel.bg} ${vLabel.border} ${vLabel.text}`}>
                                      <i className={`${vLabel.icon} text-[9px]`}></i>
                                      {vLabel.display}
                                    </span>
                                  )}
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${color.bg} ${color.border} ${color.text}`}>
                                    <div className={`w-1 h-1 rounded-full ${color.dot}`} />
                                    {combinedBias}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="text-white text-sm font-medium">
                                  {r.confidence_score ?? 0}
                                </span>
                                <span className="text-white/30 text-xs ml-1">/100</span>
                              </td>
                              <td className="px-4 py-3">
                                <p className="text-white/50 text-xs leading-relaxed truncate max-w-xs">
                                  {(r.summary || '').slice(0, 100) || r.today_quote || '無摘要'}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <Link
                                  to={`/reports/${r.report_date}`}
                                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 text-xs font-medium transition-colors"
                                >
                                  <i className="ri-external-link-line" />
                                  完整報告
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                  <p className="text-white/40 text-sm">暫無更多歷史報告資料。</p>
                </div>
              )}
            </section>

            {/* ===== CTA ===== */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-8 text-center">
              <h3 className="text-white font-bold text-base md:text-lg mb-2">
                想每天收到盤前報告？
              </h3>
              <p className="text-white/50 text-sm mb-4">
                每天早上 07:30，幫你整理戰場情勢。
              </p>
              <div className="flex flex-col gap-3 w-full sm:flex-row sm:justify-center">
                <Link
                  to="/report/today"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-white/10 hover:bg-white/15 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap min-h-[48px] w-full sm:w-auto border border-white/10"
                >
                  <i className="ri-file-list-3-line" />
                  查看今日盤前判斷
                </Link>
                <Link
                  to="/"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm font-medium rounded-xl transition-colors border border-white/10 whitespace-nowrap min-h-[48px] w-full sm:w-auto"
                >
                  <i className="ri-arrow-left-line" />
                  回首頁
                </Link>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />

      {/* ===== 報告詳情 Modal ===== */}
      {selectedReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07111f]/60 backdrop-blur-sm"
          onClick={() => setSelectedReport(null)}
        >
          <div
            className="bg-navy-900 border border-navy-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-navy-900 border-b border-navy-700 px-5 md:px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold text-sm">
                    {formatDate(selectedReport.report_date)}
                  </span>
                  <span className="text-white/30 text-xs">
                    {selectedReport.report_date}
                  </span>
                </div>
                {(() => {
                  const vLabel = verificationMap.get(selectedReport.report_date);
                  if (vLabel) {
                    return (
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${vLabel.bg} ${vLabel.border} ${vLabel.text}`}>
                        <i className={`${vLabel.icon} text-[9px]`}></i>
                        {vLabel.display}
                      </span>
                    );
                  }
                  return null;
                })()}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${getSentimentColor(selectedReport.market_bias || '').bg} ${getSentimentColor(selectedReport.market_bias || '').border} ${getSentimentColor(selectedReport.market_bias || '').text}`}>
                  <div className={`w-1 h-1 rounded-full ${getSentimentColor(selectedReport.market_bias || '').dot}`} />
                  {`${getScoreLabel(selectedReport.confidence_score).label}・${getMarketBiasLabel(selectedReport.market_bias, selectedReport.confidence_score)}`}
                </span>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-5 md:px-6 py-5 space-y-5">
              {/* 分數 */}
              <div className="flex items-center gap-3">
                <div className="relative w-16 h-16">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="42"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${(selectedReport.confidence_score ?? 0) * 2.64} 264`}
                      className={getSentimentColor(selectedReport.market_bias || '').text}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-sm font-bold ${getSentimentColor(selectedReport.market_bias || '').text}`}>
                      {selectedReport.confidence_score ?? 0}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-white font-medium text-sm">劇本成立度</p>
                  <p className="text-white/40 text-xs">
                    {getScoreLabel(selectedReport.confidence_score).label}
                  </p>
                </div>
              </div>

              {/* AI 解讀 */}
              {(selectedReport.summary || selectedReport.ai_confidence_reason) && (
                <div className="bg-amber-500/[0.03] border border-amber-500/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <i className="ri-sword-line text-amber-400/60 text-sm" />
                    <span className="text-amber-400/70 text-xs font-medium">AI 軍師解讀</span>
                  </div>
                  <p className="text-white/70 text-sm leading-relaxed whitespace-pre-line">
                    {selectedReport.summary || selectedReport.ai_confidence_reason}
                  </p>
                </div>
              )}

              {/* 今日策略 */}
              {selectedReport.today_strategy && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(selectedReport.today_strategy.do || []).length > 0 && (
                    <div>
                      <h4 className="text-forest-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <i className="ri-check-line" />
                        該做
                      </h4>
                      <div className="space-y-1.5">
                        {(selectedReport.today_strategy.do || []).map((item, idx) => (
                          <p key={idx} className="text-white/60 text-sm">{item}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {(selectedReport.today_strategy.avoid || []).length > 0 && (
                    <div>
                      <h4 className="text-red-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <i className="ri-close-line" />
                        不該做
                      </h4>
                      <div className="space-y-1.5">
                        {(selectedReport.today_strategy.avoid || []).map((item, idx) => (
                          <p key={idx} className="text-white/60 text-sm">{item}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 主線 */}
              {(selectedReport.watch_sectors_json || []).length > 0 && (
                <div>
                  <h4 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">
                    今日主線
                  </h4>
                  <div className="space-y-1.5">
                    {(selectedReport.watch_sectors_json || []).map((s, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-white/30 text-xs">{idx + 1}.</span>
                        <span className="text-white/70 text-sm">{s.sector}</span>
                        {s.direction && (
                          <span className="text-white/40 text-xs">({s.direction})</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedV10Enabled && (
                <V11ObservationSection
                  items={selectedV11ObservationScripts}
                  tone="dark"
                  className="bg-transparent border-white/10"
                  subtitle="用同一套 brief 回看：當天到底在等什麼。"
                />
              )}

              {/* 資金觀察方向 */}
              {!selectedV10Enabled && (selectedReport.focus_stock_json || []).length > 0 && (
                <div>
                  <h4 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">
                    資金觀察方向
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {(selectedReport.focus_stock_json || []).map((s, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-navy-800 border border-navy-700 rounded-lg text-white/70 text-xs"
                      >
                        {s.group}
                        {s.direction && (
                          <span className="text-white/40">· {s.direction}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 風險因素 */}
              {(selectedReport.risk_factors_json || []).length > 0 && (
                <div>
                  <h4 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">
                    風險因素
                  </h4>
                  <div className="space-y-1.5">
                    {(selectedReport.risk_factors_json || []).map((r, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${r.level === 'high' ? 'text-red-400' : r.level === 'medium' ? 'text-amber-400' : 'text-white/40'}`}>
                          {r.level === 'high' ? '高' : r.level === 'medium' ? '中' : '低'}
                        </span>
                        <span className="text-white/60 text-sm">{r.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 語錄 */}
              {selectedReport.today_quote && (
                <div className="bg-navy-800/50 border border-navy-700 rounded-xl p-4">
                  <div className="flex items-start gap-2">
                    <i className="ri-double-quotes-l text-amber-500/30 text-lg flex-shrink-0 mt-0.5" />
                    <p className="text-amber-400/60 text-sm italic leading-relaxed">
                      {selectedReport.today_quote}
                    </p>
                  </div>
                </div>
              )}

              {/* 市場數據 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {selectedReport.nasdaq_change !== null && (
                  <div className="bg-navy-800/50 border border-navy-700 rounded-xl p-3 text-center">
                    <p className="text-white/30 text-[10px] mb-1">Nasdaq</p>
                    <p className={`text-sm font-semibold ${selectedReport.nasdaq_change >= 0 ? 'text-forest-400' : 'text-red-400'}`}>
                      {selectedReport.nasdaq_change >= 0 ? '+' : ''}{selectedReport.nasdaq_change}%
                    </p>
                  </div>
                )}
                {selectedReport.sp500_change !== null && (
                  <div className="bg-navy-800/50 border border-navy-700 rounded-xl p-3 text-center">
                    <p className="text-white/30 text-[10px] mb-1">S&amp;P 500</p>
                    <p className={`text-sm font-semibold ${selectedReport.sp500_change >= 0 ? 'text-forest-400' : 'text-red-400'}`}>
                      {selectedReport.sp500_change >= 0 ? '+' : ''}{selectedReport.sp500_change}%
                    </p>
                  </div>
                )}
                {selectedReport.sox_change !== null && (
                  <div className="bg-navy-800/50 border border-navy-700 rounded-xl p-3 text-center">
                    <p className="text-white/30 text-[10px] mb-1">SOX</p>
                    <p className={`text-sm font-semibold ${selectedReport.sox_change >= 0 ? 'text-forest-400' : 'text-red-400'}`}>
                      {selectedReport.sox_change >= 0 ? '+' : ''}{selectedReport.sox_change}%
                    </p>
                  </div>
                )}
                {selectedReport.vix !== null && (
                  <div className="bg-navy-800/50 border border-navy-700 rounded-xl p-3 text-center">
                    <p className="text-white/30 text-[10px] mb-1">VIX</p>
                    <p className={`text-sm font-semibold ${selectedReport.vix > 25 ? 'text-red-400' : selectedReport.vix > 18 ? 'text-amber-400' : 'text-forest-400'}`}>
                      {selectedReport.vix}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="sticky bottom-0 bg-navy-900 border-t border-navy-700 px-5 md:px-6 py-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setSelectedReport(null)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-colors border border-white/10"
              >
                關閉
              </button>
              <Link
                to="/report/today"
                onClick={() => setSelectedReport(null)}
                className="px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-sm rounded-xl transition-colors border border-amber-500/20"
              >
                查看今日報告
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
