import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { mapRowToReport } from '@/services/reportService';
import { getMarketBiasLabel, getSentimentColor, formatTaipeiDateTime } from '@/services/narrativeBuilder';
import { isTaipeiToday } from '@/services/marketSourceHealthService';
import type { Report } from '@/types/report';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { getTaipeiNow, formatTaipeiDate } from '@/utils/tradingDay';
import { parseAIStrategy, type ParsedAIStrategy } from '@/utils/aiStrategyParser';

// ═══ Constants ═══
const SECTOR_NAME_MAP: Record<string, string> = {
  Semiconductor: '半導體',
  'AI Server': 'AI伺服器',
  Power: '電源與重電',
  PCB: 'PCB',
  Cooling: '散熱',
  Memory: '記憶體',
  Finance: '金融',
  Shipping: '航運',
  Optical: '光通訊',
  Robotics: '機器人',
  EV: '電動車',
};

// ═══ Helpers ═══
function safeArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.map(String).filter(Boolean);
}
function translateSector(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const skipList = ['market', 'general', 'unknown', 'null', 'undefined'];
  if (skipList.includes(trimmed.toLowerCase())) return null;
  return SECTOR_NAME_MAP[trimmed] || trimmed;
}
function hasValidSectors(list: string[]): boolean {
  return list.map(translateSector).filter(Boolean).length > 0;
}

function deriveCheckpoints(report: Report): { check0915: string; check1030: string; check1300: string } {
  const bias = report.market_bias || '';
  if (bias.includes('偏多')) {
    return {
      check0915: '確認 TAIEX、2330、TXF 開盤方向是否與盤前偏多假設一致。若開盤漲幅超過 0.5%，劇本初步成立。',
      check1030: '觀察半導體、AI、金融等主流族群是否延續強勢。若主流族群轉弱，偏多判斷需下修。',
      check1300: '確認今日漲勢是否由量能支撐，避免只有開高後轉弱。若指數回到開盤價以下，改為中性觀察。',
    };
  }
  if (bias.includes('偏空')) {
    return {
      check0915: '確認 TAIEX、2330、TXF 開盤是否與盤前偏空方向一致。若開盤跌幅超過 0.5%，劇本初步成立。',
      check1030: '觀察是否有族群逆勢轉強。若有族群帶量上攻，偏空判斷需重新評估。',
      check1300: '確認今日跌勢是否有實質賣壓，還是僅為短線獲利了結。若有明顯拉回，改為中性觀察。',
    };
  }
  return {
    check0915: '確認 TAIEX、2330、TXF 開盤方向是否明確。若開盤後方向混沌，今日宜觀望。',
    check1030: '觀察半導體、AI、金融等主流族群是否有明確方向。若無明確主流帶動，維持保守判斷。',
    check1300: '觀察尾盤是否有方向性變化。若維持震盪，今日中性判斷成立。',
  };
}

// ═══ Main Component ═══
export default function ReportDetail() {
  const { reportDate } = useParams<{ reportDate: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const taipeiToday = isTaipeiToday();
  const effectiveReportDate = report?.report_date || reportDate;
  const isToday = effectiveReportDate === taipeiToday || (!reportDate || reportDate === ':reportDate' || reportDate === 'undefined' || reportDate === 'null') && report?.report_date === taipeiToday;

  // V8: Close verification from ai_strategy_json only
  const strategy: ParsedAIStrategy = parseAIStrategy(report);
  const hasClosingData = !!strategy.closing_feedback_plan || !!strategy.raw?.['closing_validation'];

  const now = getTaipeiNow();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const displayStatus = (() => {
    if (!report) return { label: '今日報告尚未產生', chip: 'slate', icon: 'ri-time-line' };
    if (hasClosingData) return { label: '收盤驗證完成', chip: 'emerald', icon: 'ri-check-double-line' };
    if (hour >= 9 && hour < 13 || (hour === 13 && minute < 30)) return { label: '盤中追蹤中', chip: 'amber', icon: 'ri-radar-line' };
    if (hour >= 14 || (hour === 13 && minute >= 30) || (hour === 14 && minute >= 10)) return { label: '等待收盤驗證更新', chip: 'amber', icon: 'ri-hourglass-line' };
    return { label: '收盤待驗證', chip: 'amber', icon: 'ri-time-line' };
  })();

  const statusBanner = (() => {
    if (!report) return { title: '今日報告尚未產生', body: '請等待系統產生今日報告。', chip: 'slate' };
    if (hasClosingData) return { title: '今日收盤驗證已完成', body: '系統已將盤前假設與收盤結果比對，請查看下方收盤驗證與明日修正方向。', chip: 'emerald' };
    return { title: '今日仍在追蹤中', body: '今日盤前劇本尚未完成收盤驗證，請搭配盤中追蹤觀察。', chip: 'amber' };
  })();

  useEffect(() => {
    const isInvalidReportDate = !reportDate || reportDate === ':reportDate' || reportDate === 'undefined' || reportDate === 'null';
    async function load() {
      try {
        setLoading(true);
        setError(null);

        // V8: resolveActiveMorningAlphaReport — SINGLE SOURCE OF TRUTH
        const resolved = isInvalidReportDate
          ? await resolveActiveMorningAlphaReport()
          : await resolveActiveMorningAlphaReport(reportDate);

        const reportData = resolved.rawRow
          ? mapRowToReport(resolved.rawRow as unknown as Record<string, unknown>)
          : null;

        setReport(reportData);
        if (!reportData) {
          setError(isInvalidReportDate ? '目前尚無可用報告，請稍後重新整理。' : `找不到 ${reportDate} 的報告`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取資料失敗');
      } finally { setLoading(false); }
    }
    load();
  }, [reportDate]);

  // ═══ Loading ═══
  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-white/50 text-sm">載入完整判讀...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ═══ Error ═══
  if (error || !report) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-file-list-3-line text-white/30 text-3xl mb-3" />
            <h2 className="text-white font-semibold text-base mb-2">{error || '報告不存在'}</h2>
            <p className="text-white/50 text-sm mb-4">該日期的報告尚未產生，或日期格式不正確</p>
            <Link to="/reports" className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors inline-block whitespace-nowrap border border-white/10">返回報告列表</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ═══ Data Ready ═══
  const sentimentColor = getSentimentColor(report.market_bias);
  const displayBias = getMarketBiasLabel(report.market_bias, report.confidence_score ?? 0);
  const canWatchRaw = safeArray(report.can_watch);
  const avoidRaw = safeArray(report.avoid_today);
  const keyDrivers = safeArray(report.key_drivers);
  const checkpoints = deriveCheckpoints(report);

  // Translated watch/avoid directions
  const watchSectors = canWatchRaw.map(translateSector).filter(Boolean) as string[];
  const avoidSectors = avoidRaw.map(translateSector).filter(Boolean) as string[];

  // Script reasons
  const scriptWhy = report.ai_confidence_reason || report.summary || '盤前訊號來自多個數據源的一致性分析。';
  const scriptValidate = [
    keyDrivers.length > 0 ? `盤前主線 ${keyDrivers.slice(0, 3).join('、')} 開盤後是否延續` : null,
    watchSectors.length > 0 ? `受惠族群 ${watchSectors.slice(0, 2).join('、')} 是否有資金流入` : null,
    '開盤 15 分鐘內指數方向是否與盤前判斷一致',
  ].filter(Boolean) as string[];

  const scriptInvalid = [
    avoidSectors.length > 0 ? `${avoidSectors.slice(0, 2).join('、')} 意外轉強，劇本前提改變` : null,
    '若開盤後 30 分鐘內加權指數反向波動超過 1%，劇本下修',
    '若國際盤中出現重大利空，今日觀察轉為保守',
  ].filter(Boolean) as string[];

  // Chip color helper
  const chipColors: Record<string, string> = {
    emerald: 'bg-emerald-500/12 border-emerald-400/35 text-emerald-300',
    amber: 'bg-amber-500/12 border-amber-400/35 text-amber-300',
    slate: 'bg-slate-700/70 border-slate-500/40 text-slate-300',
  };
  const chipDots: Record<string, string> = { emerald: 'bg-emerald-400', amber: 'bg-amber-400', slate: 'bg-slate-400' };

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* ═══ HERO ═══ */}
        <section className="relative w-full px-4 md:px-6 pt-8 pb-6 md:pt-12 md:pb-8 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-navy-900 via-navy-950 to-navy-950" />
          <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)', backgroundSize: '48px 48px' }} />

          <div className="relative max-w-4xl mx-auto w-full">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              <Link to="/" className="text-white/40 hover:text-white text-xs flex items-center gap-1 transition-colors whitespace-nowrap"><i className="ri-arrow-left-line" /> 回首頁</Link>
              {isToday ? (<>
                <span className="text-white/20 text-xs">/</span>
                <Link to="/report/today" className="text-white/40 hover:text-white text-xs transition-colors whitespace-nowrap">今日判斷</Link>
                <span className="text-white/20 text-xs">/</span>
                <span className="text-white/60 text-xs">完整判讀</span>
              </>) : (<>
                <span className="text-white/20 text-xs">/</span>
                <Link to="/reports" className="text-white/40 hover:text-white text-xs transition-colors whitespace-nowrap">報告中心</Link>
                <span className="text-white/20 text-xs">/</span>
                <span className="text-white/60 text-xs">{report.report_date}</span>
              </>)}
            </div>

            {/* Title + Status */}
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h1 className="text-white font-bold text-xl md:text-2xl mb-2">
                  Morning Alpha 會員完整判讀｜{report.report_date || formatTaipeiDate()}
                </h1>
                <p className="text-slate-300 text-sm leading-relaxed max-w-xl">
                  這是今日盤前假設、盤中追蹤與收盤驗證的完整紀錄。
                </p>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white/25 text-[10px] font-medium tracking-wide whitespace-nowrap">目前狀態</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${chipColors[displayStatus.chip]}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${chipDots[displayStatus.chip]}`} />
                      {displayStatus.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/25 text-[10px] font-medium tracking-wide whitespace-nowrap">盤前假設</span>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border ${sentimentColor.badge}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${sentimentColor.light}`} />
                      {displayBias}
                    </span>
                  </div>
                </div>
                <div className="relative w-16 h-16">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                    <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${(report.confidence_score ?? 0) * 2.64} 264`} className={sentimentColor.progress} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-base font-bold ${sentimentColor.text}`}>{report.confidence_score ?? '—'}</span>
                    <span className="text-white/20 text-[9px]">把握度</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ Status Banner ═══ */}
        <section className="w-full px-4 md:px-6 pb-4 md:pb-6">
          <div className="max-w-4xl mx-auto w-full">
            <div className={`rounded-2xl p-5 md:p-6 ${
              statusBanner.chip === 'emerald' ? 'bg-emerald-500/[0.06] border border-emerald-400/25' :
              statusBanner.chip === 'amber' ? 'bg-amber-500/[0.06] border border-amber-400/25' :
              'bg-slate-800/70 border border-slate-600/40'
            }`}>
              <div className="flex items-start gap-3 mb-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  statusBanner.chip === 'emerald' ? 'bg-emerald-500/15 border border-emerald-400/30' :
                  statusBanner.chip === 'amber' ? 'bg-amber-500/15 border border-amber-400/30' :
                  'bg-slate-700/70 border border-slate-500/40'
                }`}>
                  <i className={`text-sm ${
                    statusBanner.chip === 'emerald' ? 'ri-check-double-line text-emerald-300' :
                    statusBanner.chip === 'amber' ? 'ri-time-line text-amber-300' :
                    'ri-time-line text-slate-300'
                  }`}></i>
                </div>
                <div>
                  <h3 className={`font-semibold text-sm mb-1 ${
                    statusBanner.chip === 'emerald' ? 'text-emerald-200' :
                    statusBanner.chip === 'amber' ? 'text-amber-200' :
                    'text-slate-200'
                  }`}>{statusBanner.title}</h3>
                  <p className="text-slate-300 text-sm leading-relaxed">{statusBanner.body}</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to="/report/today" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap">
                  <i className="ri-file-list-3-line"></i>查看今日判斷
                </Link>
                <Link to="/war-room" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/15 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap border border-white/10">
                  <i className="ri-radar-line"></i>查看盤中追蹤
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ CONTENT ═══ */}
        <section className="w-full overflow-x-hidden px-4 md:px-6 pb-16 md:pb-24">
          <div className="max-w-4xl mx-auto w-full space-y-6 md:space-y-8">

            {/* ── 1. 今日完整判讀 ── */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center"><i className="ri-sun-line text-amber-400 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">今日完整判讀</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">今日完整判讀</h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">報告日期</p>
                  <p className="text-slate-50 font-bold text-sm">{report.report_date}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">盤前假設</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${sentimentColor.badge}`}>
                    <div className={`w-1 h-1 rounded-full ${sentimentColor.light}`} />{displayBias}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">盤前判讀把握度</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-bold ${sentimentColor.text}`}>{report.confidence_score ?? '—'}</span>
                    <span className="text-slate-400 text-xs">/100</span>
                  </div>
                </div>
              </div>
              {/* V22: Premarket data basis info */}
              <div className="p-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/15 mb-4">
                <div className="flex items-center gap-4 flex-wrap text-xs">
                  <div>
                    <span className="text-sky-400/70 text-[10px] uppercase tracking-wider">台股盤前基準</span>
                    <span className="text-sky-200 font-semibold ml-2">{strategy.market_data_latest_date || report.report_date} 收盤</span>
                  </div>
                  {(strategy.market_data_latest_date && strategy.market_data_latest_date !== report.report_date) && (
                    <span className="text-sky-400/50 text-[10px]">前一個完整交易日，正常</span>
                  )}
                  <div className="ml-auto">
                    <span className="text-sky-400/70 text-[10px] uppercase tracking-wider">盤中資料</span>
                    <span className="text-amber-400/80 font-semibold ml-2">等待 09:30 開盤雷達</span>
                  </div>
                </div>
              </div>

              {(report.summary || report.today_summary) && (
                <div className="bg-amber-500/[0.04] border border-amber-500/15 rounded-xl p-4 mb-3">
                  <p className="text-amber-300/70 text-xs font-medium mb-2 flex items-center gap-1.5"><i className="ri-file-text-line" /> 今日摘要</p>
                  <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{report.today_summary || report.summary}</p>
                </div>
              )}

              <p className="text-slate-500 text-[10px] leading-relaxed">判讀把握度代表資料一致性，不代表漲跌保證。市場方向代表今日盤勢強弱判讀。</p>
              <p className="text-slate-500 text-[10px] leading-relaxed mt-2">此分數代表系統對 07:30 盤前假設的資料一致性把握，不代表行情樂觀程度，也不代表最終結果。</p>
            </section>

            {/* ── 2. 今日核心判斷 ── */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-rose-500/15 flex items-center justify-center"><i className="ri-focus-3-line text-rose-400 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">今日核心判斷</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">今日核心判斷</h2>

              {/* 劇本成立原因 */}
              <div className="mb-4">
                <h3 className="text-rose-300 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i className="ri-check-double-line" /> 劇本成立原因</h3>
                <div className="bg-rose-500/[0.04] border border-rose-500/15 rounded-xl p-4">
                  <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{scriptWhy}</p>
                </div>
              </div>

              {/* 需要驗證的條件 */}
              <div className="mb-4">
                <h3 className="text-amber-300 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i className="ri-search-eye-line" /> 需要驗證的條件</h3>
                <div className="space-y-2">
                  {scriptValidate.map((c, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/[0.04] border border-amber-500/15">
                      <div className="w-5 h-5 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-amber-300 text-[10px] font-medium">{idx + 1}</span></div>
                      <span className="text-slate-200 text-sm leading-relaxed">{c}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 劇本失效條件 */}
              <div>
                <h3 className="text-rose-300 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i className="ri-close-circle-line" /> 劇本失效條件</h3>
                {scriptInvalid.length > 0 ? (
                  <div className="space-y-2">
                    {scriptInvalid.map((c, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-red-500/[0.04] border border-red-500/15">
                        <div className="w-5 h-5 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5"><i className="ri-close-line text-red-400 text-[10px]" /></div>
                        <span className="text-slate-200 text-sm leading-relaxed">{c}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-300 text-sm leading-relaxed">目前沒有額外失效條件，主要觀察 TAIEX、2330、TXF 是否同步轉弱。</p>
                  </div>
                )}
              </div>
            </section>

            {/* ── 3. 受惠族群 ── */}
            {watchSectors.length > 0 && (
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-emerald-500/15 flex items-center justify-center"><i className="ri-arrow-up-circle-line text-emerald-300 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">受惠族群</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">受惠族群</h2>
              <div className="space-y-2">
                {watchSectors.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/[0.04] border border-emerald-500/15">
                    <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0 mt-0.5"><span className="text-emerald-300 text-[10px] font-medium">{idx + 1}</span></div>
                    <span className="text-slate-200 text-sm leading-relaxed">{item}</span>
                  </div>
                ))}
              </div>
              {keyDrivers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {keyDrivers.map((d, idx) => (
                    <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800/70 border border-slate-700/70 rounded-lg text-slate-300 text-[10px]">
                      <i className="ri-flashlight-line text-amber-400/60" />{d}
                    </span>
                  ))}
                </div>
              )}
            </section>
            )}

            {/* ── 4. 避開族群 ── */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-red-500/15 flex items-center justify-center"><i className="ri-arrow-down-circle-line text-red-400 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">避開族群</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">避開族群</h2>
              {avoidSectors.length > 0 ? (
                <div className="space-y-2">
                  {avoidSectors.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-red-500/[0.04] border border-red-500/15">
                      <div className="w-5 h-5 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0 mt-0.5"><i className="ri-close-line text-red-400 text-[10px]" /></div>
                      <span className="text-slate-200 text-sm leading-relaxed">{item}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-300 text-sm leading-relaxed">今日沒有明確需要避開的族群，仍以開盤後量價驗證為準。</p>
                </div>
              )}
            </section>

            {/* ── 5. 市場資料基準 ── */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-sky-500/15 flex items-center justify-center"><i className="ri-bar-chart-2-line text-sky-300 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">市場資料基準</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">市場資料基準</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">台股盤前基準</p>
                  <p className="text-white/70 text-sm font-medium">{strategy.market_data_latest_date || report.report_date} 收盤</p>
                </div>
                <div className="p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
                  <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">市場數據記錄</p>
                  <p className="text-white/70 text-sm font-medium">{strategy.global_market_status_count ?? 0} 項</p>
                </div>
              </div>

              <p className="text-slate-500 text-[10px] mt-3">
                市場資料基準來自 {report.report_date} 盤前報告的 ai_strategy_json。
              </p>
            </section>

            {/* ── 6. 新聞依據 ── */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center"><i className="ri-newspaper-line text-amber-400 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">新聞依據</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">新聞依據</h2>
              {(strategy.important_news && strategy.important_news.length > 0) ? (
                <div className="space-y-3">
                  {strategy.important_news.slice(0, 5).map((n: Record<string, unknown>, idx: number) => (
                    <div key={idx} className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                      <p className="text-slate-200 text-sm font-medium leading-relaxed">{String(n.title || n.headline || '')}</p>
                      <div className="flex items-center gap-3 flex-wrap text-[10px] mt-1.5">
                        {n.source && <span className="text-slate-500">{String(n.source)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 text-sm">新聞資料從 ai_strategy_json 讀取中，請查看盤前報告取得最新新聞分析。</p>
              )}
            </section>

            {/* ── 7. AI 心理提醒 ── */}
            {(report.ai_psychology || report.ai_retail_reminder) && (
              <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-md bg-emerald-500/15 flex items-center justify-center"><i className="ri-mental-health-line text-emerald-300 text-xs" /></div>
                  <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">AI 心理提醒</p>
                </div>
                <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">AI 心理提醒</h2>
                {report.ai_psychology && (
                  <div className="mb-3">
                    <h3 className="text-slate-400 text-xs font-medium mb-2 flex items-center gap-1.5"><i className="ri-brain-line text-emerald-400/60" /> 心理狀態</h3>
                    <div className="bg-emerald-500/[0.04] border border-emerald-500/15 rounded-xl p-4">
                      <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{report.ai_psychology}</p>
                    </div>
                  </div>
                )}
                {report.ai_retail_reminder && (
                  <div>
                    <h3 className="text-slate-400 text-xs font-medium mb-2 flex items-center gap-1.5"><i className="ri-user-heart-line text-amber-400/60" /> 散戶提醒</h3>
                    <div className="bg-amber-500/[0.04] border border-amber-500/15 rounded-xl p-4">
                      <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{report.ai_retail_reminder}</p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── 8. 盤中檢查點 ── */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-amber-500/15 flex items-center justify-center"><i className="ri-time-line text-amber-400 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">盤中檢查點</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">盤中檢查點</h2>

              <div className="space-y-4">
                <div className="relative pl-6 border-l-2 border-emerald-500/20">
                  <div className="absolute left-0 top-0 -translate-x-1/2 w-3 h-3 rounded-full bg-emerald-500/30 border-2 border-emerald-500/20" />
                  <div className="pb-4">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-[10px] font-medium border border-emerald-500/20 mb-2"><i className="ri-sun-line" /> 09:15 開盤確認</span>
                    <p className="text-slate-300 text-sm leading-relaxed">{checkpoints.check0915}</p>
                  </div>
                </div>
                <div className="relative pl-6 border-l-2 border-amber-500/20">
                  <div className="absolute left-0 top-0 -translate-x-1/2 w-3 h-3 rounded-full bg-amber-500/30 border-2 border-amber-500/20" />
                  <div className="pb-4">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 text-[10px] font-medium border border-amber-500/20 mb-2"><i className="ri-radar-line" /> 10:30 主流確認</span>
                    <p className="text-slate-300 text-sm leading-relaxed">{checkpoints.check1030}</p>
                  </div>
                </div>
                <div className="relative pl-6">
                  <div className="absolute left-0 top-0 -translate-x-1/2 w-3 h-3 rounded-full bg-red-500/20 border-2 border-red-500/10" />
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-medium border border-red-500/20 mb-2"><i className="ri-timer-line" /> 13:00 收盤前確認</span>
                    <p className="text-slate-300 text-sm leading-relaxed">{checkpoints.check1300}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* ── 9. 收盤驗證與修正 ── */}
            <section className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-md bg-rose-500/15 flex items-center justify-center"><i className="ri-shield-flash-line text-rose-400 text-xs" /></div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-semibold">收盤驗證與修正</p>
              </div>
              <h2 className="text-slate-50 font-bold text-lg md:text-xl mb-4">收盤驗證與修正</h2>

              {report.risk_reason && (
                <div className="mb-4">
                  <h3 className="text-rose-300 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i className="ri-alert-line" /> 風險提醒</h3>
                  <div className="bg-red-500/[0.04] border border-red-500/15 rounded-xl p-4">
                    <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-line">{report.risk_reason}</p>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-amber-300 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"><i className="ri-loop-left-line" /> 明日修正方向</h3>
                <div className="bg-amber-500/[0.04] border border-amber-500/15 rounded-xl p-4">
                  <p className="text-slate-200 text-sm leading-relaxed">
                    若開盤後主流族群無法延續，今日劇本需下修為觀望。
                    {report.market_bias?.includes('偏多') ? ' 若加權指數開高走低或台積電轉弱，偏多判斷需重新評估，改以震盪視角觀察今日盤勢。' : ''}
                    {report.market_bias?.includes('偏空') ? ' 若加權指數開低走高或權值股逆勢轉強，偏空判斷需調整為中性震盪。' : ''}
                  </p>
                </div>
              </div>
            </section>

            {/* ── 10. 合規提醒 ── */}
            <section className="bg-navy-950 border border-navy-800 rounded-2xl p-5 md:p-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-800/70 flex items-center justify-center flex-shrink-0 mt-0.5"><i className="ri-information-line text-slate-400 text-sm" /></div>
                <div>
                  <h3 className="text-slate-50 font-medium text-sm mb-1">合規提醒</h3>
                  <p className="text-slate-500 text-xs leading-relaxed">本內容為市場資訊整理與情境判讀，不構成任何買賣建議、投資邀約或保證獲利。所有判斷均基於公開市場數據與 AI 分析模型，僅供參考。投資決策應由使用者自行判斷，並承擔相應風險。</p>
                </div>
              </div>
            </section>

            {/* ── Footer CTA ── */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-8 text-center">
              <div className="max-w-lg mx-auto">
                <h3 className="text-slate-50 font-bold text-base md:text-lg mb-2">{isToday ? '正在追蹤今日盤勢？' : '想查看其他日期的研究筆記？'}</h3>
                <p className="text-slate-400 text-sm mb-4">{isToday ? '前往今日判斷與盤中追蹤，查看最新市場狀態。' : '回報告中心瀏覽過去 30 天的盤前紀錄。'}</p>
                <div className="flex flex-col gap-3 w-full sm:flex-row sm:justify-center">
                  {isToday ? (<>
                    <Link to="/report/today" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap min-h-[48px] w-full sm:w-auto"><i className="ri-file-list-3-line" />今日判斷</Link>
                    <Link to="/war-room" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-800/70 hover:bg-slate-700/70 text-slate-200 text-sm font-medium rounded-xl transition-colors whitespace-nowrap min-h-[48px] w-full sm:w-auto border border-slate-600/40"><i className="ri-radar-line" />盤中追蹤</Link>
                  </>) : (<>
                    <Link to="/reports" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-800/70 hover:bg-slate-700/70 text-slate-200 text-sm font-medium rounded-xl transition-colors whitespace-nowrap min-h-[48px] w-full sm:w-auto border border-slate-600/40"><i className="ri-archive-line" />報告中心</Link>
                    <Link to="/report/today" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap min-h-[48px] w-full sm:w-auto"><i className="ri-file-list-3-line" />查看今日報告</Link>
                  </>)}
                </div>
              </div>
            </div>

          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}