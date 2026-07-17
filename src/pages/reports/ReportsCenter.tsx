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

const publicReportText = (value: unknown) => String(value ?? '')
  .trim()
  .replace(/\bSEMICONDUCTOR\b/gi, '半導體')
  .replace(/\bMEMORY\b/gi, '記憶體')
  .replace(/\bELECTRONICS\b/gi, '電子')
  .replace(/\bFINANCIAL\b/gi, '金融')
  .replace(/\bDEFENSIVE\b/gi, '防禦型族群')
  .replace(/\bAI[ _-]?SERVER\b/gi, 'AI 伺服器')
  .replace(/\bTAIEX\b/gi, '加權指數')
  .replace(/\bTXF\b/gi, '台指期')
  .replace(/\bADR\b/gi, '海外存託憑證')
  .replace(/\bunknown\b/gi, '尚未取得')
  .replace(/\s+/g, ' ')
  .trim();

const previewText = (report: Report) => {
  const text = report.summary || report.today_summary || report.today_quote || '';
  return publicReportText(text);
};

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

        const allDates = all.map((r) => r.report_date);
        if (allDates.length > 0) {
          const cmrMap = await getCloseMarketReviewsByDates(allDates);
          const labelMap = new Map<string, ReturnType<typeof getVerificationLabelStyle>>();
          for (const [date, cmr] of cmrMap) {
            labelMap.set(date, getVerificationLabelStyle(cmr.verification_label));
          }
          setVerificationMap(labelMap);
        }
      } catch {
        setError('歷史報告暫時無法取得，請稍後重新載入。');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!selectedReport) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedReport(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [selectedReport]);

  const getSentimentColor = (bias: string) => {
    if (bias.includes('偏多') || bias.includes('偏強') || bias.includes('強多')) {
      return { text: 'text-rose-300', badge: 'ma-badge-danger', dot: 'bg-rose-300' };
    }
    if (bias.includes('偏空') || bias.includes('偏弱') || bias.includes('強空')) {
      return { text: 'text-emerald-300', badge: 'ma-badge-success', dot: 'bg-emerald-300' };
    }
    return { text: 'text-amber-300', badge: 'ma-badge-warning', dot: 'bg-amber-300' };
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    return `${month}/${day} (${weekDays[d.getDay()]})`;
  };

  const getScoreLabel = (score: number | null) => {
    if (score === null || score === undefined) return { label: '觀察中', color: 'text-white/45' };
    if (score >= 80) return { label: '高把握度', color: 'text-emerald-300' };
    if (score >= 60) return { label: '明確', color: 'text-emerald-300/80' };
    if (score >= 40) return { label: '中性', color: 'text-amber-300' };
    if (score >= 20) return { label: '偏弱', color: 'text-amber-300/80' };
    return { label: '謹慎', color: 'text-rose-300' };
  };

  const selectedAI = selectedReport?.ai_strategy_json && typeof selectedReport.ai_strategy_json === 'object'
    ? selectedReport.ai_strategy_json as Record<string, unknown>
    : {};
  const selectedV10Enabled = selectedAI.v10_beneficiary_enabled === true || selectedAI.v10_beneficiary_enabled === 'true';
  const selectedV11ObservationScripts = mapV11ObservationItems(selectedAI.v10_observation_watchlist, 5);
  const allReports = [...reports7, ...reports30];
  const latestReportDate = allReports[0]?.report_date || '';

  const renderReportCard = (r: Report, emphasis: 'featured' | 'compact' = 'compact') => {
    const displayBias = getMarketBiasLabel(r.market_bias, r.confidence_score);
    const color = getSentimentColor(r.market_bias || displayBias);
    const scoreInfo = getScoreLabel(r.confidence_score);
    const vLabel = verificationMap.get(r.report_date);
    const summary = previewText(r);

    return (
      <article key={r.id} className="ma-card-interactive group">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <button type="button" onClick={() => setSelectedReport(r)} className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="ma-badge ma-badge-info">
                <i className="ri-calendar-line text-[11px]" />
                {formatDate(r.report_date)}
              </span>
              {vLabel && (
                <span className={`ma-badge ${vLabel.bg} ${vLabel.border} ${vLabel.text}`}>
                  <i className={`${vLabel.icon} text-[11px]`} />
                  {vLabel.display}
                </span>
              )}
              <span className={`ma-badge ${color.badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
                {displayBias}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-[112px_minmax(0,1fr)] md:items-start">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center md:text-left">
                <p className="text-white/35 text-[10px] tracking-[0.22em] mb-1">報告</p>
                <p className="text-white text-lg font-bold leading-tight">{r.report_date}</p>
                <p className={`mt-2 text-sm font-semibold ${scoreInfo.color}`}>{r.confidence_score ?? '—'}<span className="text-white/30 text-xs ml-1">/100</span></p>
                <p className="text-white/40 text-xs mt-1">{scoreInfo.label}</p>
              </div>

              <div className="min-w-0">
                <h3 className="ma-card-title text-white group-hover:text-amber-200 transition-colors">
                  Morning Alpha 盤前研究｜{r.report_date}
                </h3>
                {summary && (
                  <p className={`ma-body mt-2 text-white/65 ${emphasis === 'featured' ? 'line-clamp-3' : 'line-clamp-2'}`}>
                    {summary.slice(0, 160)}
                  </p>
                )}
                <p className="ma-caption mt-3 text-white/35">
                  點擊卡片快速預覽；完整內容保留原始盤前判斷與驗證脈絡。
                </p>
              </div>
            </div>
          </button>

          <Link to={`/reports/${r.report_date}`} className="ma-btn-outline shrink-0 border-white/10 text-white hover:bg-white/10 md:self-center">
            查看完整報告
            <i className="ri-arrow-right-up-line" />
          </Link>
        </div>
      </article>
    );
  };

  if (loading) {
    return (
      <div className="ma-page flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-3" />
            <span className="ma-body">載入歷史報告...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="ma-page flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="ma-card max-w-md text-center">
            <i className="ri-error-warning-line text-rose-400 text-3xl mb-3" />
            <h2 className="ma-card-title mb-2">讀取歷史報告失敗</h2>
            <p className="ma-body mb-4">{error}</p>
            <button onClick={() => window.location.reload()} className="ma-btn-primary">
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="ma-page flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        <section className="relative w-full overflow-hidden px-4 py-10 md:px-6 md:py-14">
          <div className="absolute inset-0 bg-gradient-to-b from-[#07111f] via-[#0b1628] to-background-50" />
          <div className="relative mx-auto grid w-full max-w-5xl gap-5 md:grid-cols-[minmax(0,1fr)_260px] md:items-end">
            <div>
              <p className="text-white/35 text-[10px] tracking-[0.3em] font-semibold mb-4">報告中心</p>
              <h1 className="text-white font-bold text-3xl md:text-5xl leading-tight mb-4">歷史研究報告</h1>
              <p className="text-white/78 text-base md:text-lg leading-relaxed max-w-2xl">
                回看 Morning Alpha 每個交易日的盤前判斷、關鍵劇本與驗證脈絡。
              </p>
              <p className="mt-3 text-white/40 text-xs leading-relaxed max-w-2xl">{MARKET_BIAS_EXPLANATION}</p>
            </div>

            <div className="ma-card-glass">
              <p className="text-amber-200 text-[10px] tracking-[0.22em] font-semibold mb-2">累積報告</p>
              <p className="text-white text-4xl font-bold leading-none">{allReports.length}</p>
              <p className="text-white/60 text-sm mt-2">已載入研究報告</p>
              {latestReportDate && <p className="text-white/35 text-xs mt-4">最近更新：{latestReportDate}</p>}
            </div>
          </div>
        </section>

        <section className="ma-section pt-0">
          <div className="ma-section-inner space-y-8 md:space-y-10">
            <div className="ma-card flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="ma-eyebrow mb-1">顯示範圍</p>
                <h2 className="ma-card-title">目前顯示最近 30 份報告</h2>
                <p className="ma-body mt-1">保留既有資料排序與讀取邏輯；本頁未新增篩選條件。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="ma-badge ma-badge-info">最近 7 份：{reports7.length}</span>
                <span className="ma-badge ma-badge-neutral">更多歷史：{reports30.length}</span>
              </div>
            </div>

            <section>
              <div className="mb-4 md:mb-5">
                <p className="ma-eyebrow mb-1">最近報告</p>
                <h2 className="ma-section-title">最近 7 天報告</h2>
              </div>
              {reports7.length > 0 ? (
                <div className="space-y-4">
                  {reports7.map((report) => renderReportCard(report, 'featured'))}
                </div>
              ) : (
                <div className="ma-card text-center">
                  <h3 className="ma-card-title">目前沒有符合條件的報告</h3>
                  <p className="ma-body mt-2">調整日期或篩選條件後再查看。</p>
                </div>
              )}
            </section>

            <section>
              <div className="mb-4 md:mb-5">
                <p className="ma-eyebrow mb-1">歷史紀錄</p>
                <h2 className="ma-section-title">更多歷史報告</h2>
              </div>
              {reports30.length > 0 ? (
                <div className="space-y-4">
                  {reports30.map((report) => renderReportCard(report))}
                </div>
              ) : (
                <div className="ma-card text-center">
                  <h3 className="ma-card-title">目前沒有更多歷史報告</h3>
                  <p className="ma-body mt-2">系統會在更多交易日累積後自動出現。</p>
                </div>
              )}
            </section>

            <section className="ma-card-elevated text-center">
              <h3 className="text-white font-bold text-base md:text-lg mb-2">想每天收到盤前報告？</h3>
              <p className="text-white/60 text-sm mb-5">每天早上 07:30，幫你整理戰場情勢。</p>
              <div className="flex flex-col gap-3 w-full sm:flex-row sm:justify-center">
                <Link to="/report/today" className="ma-btn-primary w-full sm:w-auto">
                  <i className="ri-file-list-3-line" />
                  查看今日盤前判斷
                </Link>
                <Link to="/" className="ma-btn-secondary w-full sm:w-auto">
                  <i className="ri-arrow-left-line" />
                  回首頁
                </Link>
              </div>
            </section>
          </div>
        </section>
      </main>

      <Footer />

      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07111f]/70 backdrop-blur-sm" onClick={() => setSelectedReport(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-preview-title"
            className="ma-card-elevated w-full max-w-2xl max-h-[85dvh] overflow-y-auto overscroll-contain p-0"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 border-b border-white/10 bg-[#07111f]/95 px-5 py-4 md:px-6 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span id="report-preview-title" className="text-white font-bold text-sm">{formatDate(selectedReport.report_date)}</span>
                  <span className="text-white/35 text-xs">{selectedReport.report_date}</span>
                  {(() => {
                    const vLabel = verificationMap.get(selectedReport.report_date);
                    if (!vLabel) return null;
                    return <span className={`ma-badge ${vLabel.bg} ${vLabel.border} ${vLabel.text}`}><i className={`${vLabel.icon} text-[11px]`} />{vLabel.display}</span>;
                  })()}
                </div>
                <p className="text-white/50 text-xs">快速預覽</p>
              </div>
              <button type="button" aria-label="關閉報告預覽" onClick={() => setSelectedReport(null)} className="ma-btn-ghost min-h-11 min-w-11 text-white/60 hover:bg-white/10 hover:text-white">
                <i className="ri-close-line text-lg" />
              </button>
            </div>

            <div className="px-5 py-5 md:px-6 space-y-5">
              <div className="flex items-center gap-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center">
                  <p className={`text-xl font-bold ${getSentimentColor(selectedReport.market_bias || '').text}`}>{selectedReport.confidence_score ?? 0}</p>
                  <p className="text-white/35 text-xs">把握度</p>
                </div>
                <div>
                  <p className="text-white font-medium text-sm">劇本成立度</p>
                  <p className="text-white/45 text-xs">{getScoreLabel(selectedReport.confidence_score).label}</p>
                </div>
              </div>

              {(selectedReport.summary || selectedReport.ai_confidence_reason) && (
                <div className="ma-callout bg-amber-500/[0.04] border-amber-400/20">
                  <div className="flex items-center gap-2 mb-2">
                    <i className="ri-sword-line text-amber-300 text-sm" />
                    <span className="text-amber-200 text-xs font-semibold">AI 軍師解讀</span>
                  </div>
                  <p className="text-white/75 text-sm leading-relaxed whitespace-pre-line">{publicReportText(selectedReport.summary || selectedReport.ai_confidence_reason)}</p>
                </div>
              )}

              {selectedReport.today_strategy && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {(selectedReport.today_strategy.do || []).length > 0 && (
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                      <h4 className="text-emerald-200 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i className="ri-check-line" />該做</h4>
                      <div className="space-y-1.5">{(selectedReport.today_strategy.do || []).map((item, idx) => <p key={idx} className="text-white/65 text-sm">{publicReportText(item)}</p>)}</div>
                    </div>
                  )}
                  {(selectedReport.today_strategy.avoid || []).length > 0 && (
                    <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4">
                      <h4 className="text-rose-200 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i className="ri-close-line" />不該做</h4>
                      <div className="space-y-1.5">{(selectedReport.today_strategy.avoid || []).map((item, idx) => <p key={idx} className="text-white/65 text-sm">{publicReportText(item)}</p>)}</div>
                    </div>
                  )}
                </div>
              )}

              {(selectedReport.watch_sectors_json || []).length > 0 && (
                <div>
                  <h4 className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-2">今日主線</h4>
                  <div className="space-y-2">{(selectedReport.watch_sectors_json || []).map((s, idx) => <div key={idx} className="flex items-center gap-2 text-sm text-white/70"><span className="text-white/35 text-xs">{idx + 1}.</span><span>{publicReportText(s.sector)}</span>{s.direction && <span className="text-white/40 text-xs">({publicReportText(s.direction)})</span>}</div>)}</div>
                </div>
              )}

              {selectedV10Enabled && (
                <V11ObservationSection items={selectedV11ObservationScripts} tone="dark" className="bg-transparent border-white/10" subtitle="用同一套 brief 回看：當天到底在等什麼。" />
              )}

              {!selectedV10Enabled && (selectedReport.focus_stock_json || []).length > 0 && (
                <div>
                  <h4 className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-2">資金觀察方向</h4>
                  <div className="flex flex-wrap gap-2">{(selectedReport.focus_stock_json || []).map((s, idx) => <span key={idx} className="ma-badge ma-badge-neutral">{publicReportText(s.group)}{s.direction && <span className="text-white/40">· {publicReportText(s.direction)}</span>}</span>)}</div>
                </div>
              )}

              {(selectedReport.risk_factors_json || []).length > 0 && (
                <div>
                  <h4 className="text-white/45 text-xs font-semibold uppercase tracking-wider mb-2">風險因素</h4>
                  <div className="space-y-2">{(selectedReport.risk_factors_json || []).map((r, idx) => <div key={idx} className="flex items-center gap-2 text-sm"><span className={`text-xs font-medium ${r.level === 'high' ? 'text-rose-300' : r.level === 'medium' ? 'text-amber-300' : 'text-white/45'}`}>{r.level === 'high' ? '高' : r.level === 'medium' ? '中' : '低'}</span><span className="text-white/65">{publicReportText(r.title)}</span></div>)}</div>
                </div>
              )}

              {selectedReport.today_quote && (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start gap-2"><i className="ri-double-quotes-l text-amber-300/50 text-lg flex-shrink-0 mt-0.5" /><p className="text-amber-100/75 text-sm italic leading-relaxed">{publicReportText(selectedReport.today_quote)}</p></div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 border-t border-white/10 bg-[#07111f]/95 px-5 py-4 md:px-6 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setSelectedReport(null)} className="ma-btn-ghost min-h-11 text-white/60 hover:bg-white/10 hover:text-white">關閉</button>
              <Link to={`/reports/${selectedReport.report_date}`} onClick={() => setSelectedReport(null)} className="ma-btn-primary">查看完整報告</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
