import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { mapRowToReport } from '@/services/reportService';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { trackPageView } from '@/utils/analytics';
import { trackEngagementEvent } from '@/services/engagementService';
import { renderSafeText } from '@/utils/renderSafe';
import { formatTaipeiDate } from '@/utils/tradingDay';
import type { Report } from '@/types/report';
import { isAISemiconductorWeak, isAIStock, DEFENSE_KEYWORDS } from '@/utils/marketBiasDowngrade';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';

type AnyObj = Record<string, any>;

type RadarView = {
  version?: string;
  report_date?: string;
  radar_status?: string;
  market_bias?: string;
  confidence_score?: number | string | null;
  summary?: string;
  today_quote?: string;
  taiex_change?: number | null;
  txf_change?: number | null;
  tsmc_change?: number | null;
  spx_change?: number | null;
  sox_change?: number | null;
  vix_change?: number | null;
  us10y_change?: number | null;
  generated_at?: string;
  data_source?: string;
};

function asObj(value: unknown): AnyObj {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyObj) : {};
}

function asArray(value: unknown): AnyObj[] {
  return Array.isArray(value) ? value.filter((x) => x && typeof x === 'object') as AnyObj[] : [];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function safeText(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s.length > 0 && s !== 'null' && s !== 'undefined' ? s : fallback;
}

function getBiasClass(bias?: string | null): string {
  const b = bias || '';
  if (b.includes('偏多') || b === '偏多') return 'bg-red-500/12 text-red-300 border-red-400/30';
  if (b.includes('偏空') || b.includes('偏弱') || b.includes('高風險')) return 'bg-emerald-500/12 text-emerald-300 border-emerald-400/30';
  return 'bg-amber-500/12 text-amber-300 border-amber-400/30';
}

function getRadarClass(status?: string | null): string {
  const s = status || '';
  if (s.includes('偏強')) return 'bg-red-500/12 text-red-300 border-red-400/30';
  if (s.includes('轉弱') || s.includes('偏弱') || s.includes('風險')) return 'bg-emerald-500/12 text-emerald-300 border-emerald-400/30';
  if (s.includes('資料不足')) return 'bg-slate-500/12 text-slate-300 border-slate-400/20';
  return 'bg-amber-500/12 text-amber-300 border-amber-400/30';
}

function normalizeRadarFromReport(report: Report | null): RadarView | null {
  if (!report) return null;

  const ai = asObj((report as AnyObj).ai_strategy_json);
  const opening = asObj(ai.opening_radar);

  if (Object.keys(opening).length > 0) {
    return {
      version: safeText(opening.version, ''),
      report_date: safeText(opening.report_date || report.report_date, ''),
      radar_status: safeText(opening.radar_status || opening.status, ''),
      market_bias: safeText(opening.market_bias || opening.bias, ''),
      confidence_score: opening.confidence_score ?? null,
      summary: safeText(opening.summary || opening.opening_summary, ''),
      today_quote: safeText(opening.today_quote, ''),
      taiex_change: toNumber(opening.taiex_change),
      txf_change: toNumber(opening.txf_change),
      tsmc_change: toNumber(opening.tsmc_change),
      spx_change: toNumber(opening.spx_change),
      sox_change: toNumber(opening.sox_change),
      vix_change: toNumber(opening.vix_change),
      us10y_change: toNumber(opening.us10y_change),
      generated_at: safeText(opening.generated_at, ''),
      data_source: safeText(opening.data_source, 'reports.ai_strategy_json.opening_radar'),
    };
  }

  return null;
}

function getOneLiner(report: Report | null, radar: RadarView | null): string {
  const ai = asObj((report as AnyObj | null)?.ai_strategy_json);

  // V8.2: ai.today_quote → ai.summary first (unified contract)
  const todayQuote = safeText(ai.today_quote, '');
  if (todayQuote) return todayQuote;

  const aiSummary = safeText(ai.summary, '');
  if (aiSummary) return aiSummary;

  const radarSummary = safeText(radar?.summary, '');
  if (radarSummary) return radarSummary;

  const radarQuote = safeText(radar?.today_quote, '');
  if (radarQuote) return radarQuote;

  const todaySummary = safeText((report as AnyObj | null)?.today_summary, '');
  if (todaySummary) return todaySummary;

  const summary = safeText((report as AnyObj | null)?.summary, '');
  if (summary) return summary;

  const free = asObj(ai.free_summary);
  const freeSentence = safeText(free.one_sentence, '');
  if (freeSentence) return freeSentence;

  const member = asObj(ai.member_reading);
  const memberSummary = safeText(member.summary, '');
  if (memberSummary) return memberSummary;

  return '';
}

function buildObservations(report: Report | null, radar: RadarView | null): string[] {
  const ai = asObj((report as AnyObj | null)?.ai_strategy_json);
  const items: string[] = [];

  if (radar) {
    items.push(`盤中雷達：${safeText(radar.radar_status)}，方向 ${safeText(radar.market_bias)}，把握度 ${safeText(radar.confidence_score)}/100。`);
    items.push(`台股三核心：TAIEX ${pct(radar.taiex_change)}、TXF ${pct(radar.txf_change)}、2330 ${pct(radar.tsmc_change)}。`);
  }

  const mrn = asObj(ai.member_research_note);
  const keyObs = asArray(mrn.key_observations).slice(0, 3);
  for (const k of keyObs) {
    const line = safeText(k.content || k.title, '');
    if (line) items.push(line);
  }

  const reasonChain = asArray(ai.reasoning_chain).slice(0, 3);
  for (const r of reasonChain) {
    const line = `${safeText(r.step, '')}${r.evidence ? `：${safeText(r.evidence, '')}` : ''}`;
    if (line.trim() && !items.includes(line)) items.push(line);
  }

  while (items.length < 5) {
    const fallback = [
      '09:30 先確認 TAIEX、TXF、2330 是否同向。',
      '10:30 檢查權值股與 AI 伺服器族群是否延續。',
      '若盤中走勢與盤前假設相反，今日判讀必須降級。',
      '不要把受惠名單當成直接買進清單。',
      '收盤後需回寫驗證結果，避免明天沿用錯誤劇本。',
    ];
    const next = fallback.find((x) => !items.includes(x));
    if (!next) break;
    items.push(next);
  }

  return items.slice(0, 5);
}

function TodayReportContent() {
  const [report, setReport] = useState<Report | null>(null);
  const [radar, setRadar] = useState<RadarView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // V8.4: Unified display state — same source as Home, Opportunities, WarRoom, MemberNote
  const [displayState, setDisplayState] = useState<MorningAlphaDisplayState | null>(null);
  const marketClosed = displayState
    ? { closed: displayState.isMarketClosed, holidayName: displayState.holidayName }
    : { closed: false, holidayName: null };

  useEffect(() => {
    trackPageView('/report/today');
    trackEngagementEvent('view_report_today');

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const resolved = await resolveActiveMorningAlphaReport();
        const finalReport = resolved.rawRow
          ? mapRowToReport(resolved.rawRow as unknown as Record<string, unknown>)
          : null;

        if (!finalReport) {
          setReport(null);
          setRadar(null);
          return;
        }

        setReport(finalReport);

        // V8.4: Unified display state — same parser as all other pages
        const ds = getMorningAlphaDisplayState(resolved.rawRow as Record<string, unknown> | null);
        setDisplayState(ds);

        // V8: Radar ONLY from ai_strategy_json.opening_radar — no table fallback
        const radarFromReport = normalizeRadarFromReport(finalReport);
        setRadar(radarFromReport);
      } catch (err) {
        console.error('TodayReport load failed:', err);
        setError(err instanceof Error ? err.message : '讀取今日判斷失敗');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const todayStr = formatTaipeiDate();
  const isReportForToday = report?.report_date === todayStr;
  const ai = asObj((report as AnyObj | null)?.ai_strategy_json);

  // V8.4: Unified display state — marketBias and confidenceScore from getMorningAlphaDisplayState
  // Same values as Home, Opportunities, WarRoom, MemberNote. No opening_radar override.
  const displayBias = displayState?.marketBias || '—';
  const displayScore = displayState?.confidenceScore ?? null;
  const radarStatus = radar?.radar_status || '尚未同步';
  const oneLiner = getOneLiner(report, radar);
  const observations = useMemo(() => buildObservations(report, radar), [report, radar]);

  const marketDataBasisDate =
    safeText(ai.market_data_latest_date || ai.tw_core_date || report?.report_date, '—');

  // V8: Beneficiary stocks filtered via ai_strategy_json radar data (not market_data table)
  const beneficiaryStocks = (() => {
    const raw = [
      ...asArray(ai.today_beneficiary_stocks),
      ...asArray(ai.beneficiary_stocks),
    ].filter((item, index, arr) => {
      const symbol = safeText(item.symbol, '');
      return symbol && arr.findIndex((x) => safeText(x.symbol, '') === symbol) === index;
    });

    // V8: Use radar.sox_change & radar.tsmc_change from ai_strategy_json
    const soxPct = radar?.sox_change ?? null;
    const tsmcCore = radar?.tsmc_change ?? null;

    const aiSemiconductorWeak = isAISemiconductorWeak(
      { taiexChange: null, txfChange: null, tsmc2330Change: tsmcCore },
      soxPct,
    );

    if (!aiSemiconductorWeak) return raw.slice(0, 6);

    const filtered = raw.filter((item) => !isAIStock({
      group: safeText(item.group || item.sector || item.category, ''),
      name: safeText(item.name, ''),
      reason: safeText(item.reason || item.thesis, ''),
    }));

    const sorted = [...filtered].sort((a, b) => {
      const aText = (safeText(a.group || a.sector || '', '') + safeText(a.reason || a.thesis || '', '')).toLowerCase();
      const bText = (safeText(b.group || b.sector || '', '') + safeText(b.reason || b.thesis || '', '')).toLowerCase();
      const aDef = DEFENSE_KEYWORDS.some((kw) => aText.includes(kw)) ? 1 : 0;
      const bDef = DEFENSE_KEYWORDS.some((kw) => bText.includes(kw)) ? 1 : 0;
      return bDef - aDef;
    });

    return sorted.slice(0, 6);
  })();

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">載入今日判斷資料...</p>
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
          <div className="max-w-md text-center bg-navy-900/70 border border-red-500/20 rounded-2xl p-6">
            <i className="ri-error-warning-line text-red-400 text-3xl" />
            <h1 className="text-white font-bold mt-3">讀取失敗</h1>
            <p className="text-slate-400 text-sm mt-2">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10"
            >
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-navy-800 rounded-2xl p-6">
            <i className="ri-time-line text-slate-500 text-3xl" />
            <h1 className="text-white font-bold mt-3">今日報告尚未產生</h1>
            <p className="text-slate-400 text-sm mt-2">每天 07:30 自動生成，請稍後再查看。</p>
            <Link to="/" className="inline-block mt-5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10">
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // V10.0: Market closed — show today's market status, NOT last report date
  if (marketClosed.closed) {
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
              日期：{displayState?.currentDate || report.report_date}（{displayState?.currentWeekday || ''}）
            </p>
            <p className="text-slate-500 text-sm mb-4">
              原因：{displayState?.holidayName || marketClosed.holidayName || '休市'}
            </p>
            <div className="bg-navy-800/70 border border-navy-700/70 rounded-xl p-4 mb-5">
              <p className="text-slate-400 text-xs mb-1">下一個交易日</p>
              <p className="text-white font-bold text-base">{nextDate}（{nextWeekday}）</p>
              <p className="text-slate-500 text-[10px] mt-1">07:30 自動更新</p>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed mb-5">
              今日不產生盤前判斷、盤中雷達、方向判斷與受惠股。所有分析將於下一個交易日自動恢復。
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

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        <div className="border-b border-navy-800 bg-navy-900/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="w-7 h-7 rounded-md bg-emerald-500/15 flex items-center justify-center">
                <i className="ri-line-chart-line text-emerald-400 text-sm" />
              </div>
              <h1 className="text-white font-bold text-sm md:text-base">今日盤前判斷</h1>

              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${getBiasClass(displayBias)}`}>
                <i className="ri-record-circle-line text-[9px]" />
                {displayBias}
              </span>

              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${getRadarClass(radarStatus)}`}>
                <i className="ri-radar-line text-[9px]" />
                {radarStatus}
              </span>

              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 text-sky-300 text-[10px] font-medium rounded-full border border-sky-400/25">
                <i className="ri-calendar-line text-[9px]" />
                報告日期：{report.report_date}
              </span>

              {!isReportForToday && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-300 text-[10px] font-medium rounded-full border border-red-400/25">
                  非今日報告：今日為 {todayStr}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6">
            <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
              今日狀態總覽
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">目前方向</p>
                <p className="text-slate-50 font-bold text-base">{displayBias}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">判斷把握度</p>
                <p className="text-slate-50 font-bold text-base">{displayScore != null ? `${displayScore}/100` : '—'}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">雷達狀態</p>
                <p className="text-slate-50 font-bold text-base">{radarStatus}</p>
              </div>

              <div className="p-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/20 sm:col-span-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <p className="text-sky-300 text-[10px] uppercase tracking-wider mb-0.5">台股盤前基準</p>
                    <p className="text-sky-200 text-xs font-semibold">{marketDataBasisDate} 收盤</p>
                  </div>
                  <div>
                    <p className="text-sky-300 text-[10px] uppercase tracking-wider mb-0.5">盤中資料</p>
                    <p className="text-sky-100 text-xs font-semibold">
                      {radar ? `已同步：${radarStatus}` : '等待 09:30 開盤雷達更新'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-slate-500 text-[10px] mt-3 leading-relaxed">
              把握度不是漲跌分數，而是資料與劇本一致性的參考。盤中雷達同步後，畫面優先顯示 opening_radar，不再沿用舊盤前文字。
            </p>
          </section>

          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6">
            <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
              今日一句話
            </h2>
            <p className="text-slate-200 text-sm leading-relaxed">
              <strong className="text-slate-50">
                {renderSafeText(oneLiner || '盤中雷達尚未提供有效摘要。')}
              </strong>
            </p>
          </section>

          {radar && (
            <section className="bg-navy-900/70 border border-cyan-500/20 rounded-2xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">
                  盤中雷達
                </h2>
                <span className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-full border ${getRadarClass(radarStatus)}`}>
                  <i className="ri-radar-line" />
                  {radarStatus}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] mb-1">TAIEX</p>
                  <p className="text-slate-100 font-bold">{pct(radar.taiex_change)}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] mb-1">TXF</p>
                  <p className="text-slate-100 font-bold">{pct(radar.txf_change)}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] mb-1">2330</p>
                  <p className="text-slate-100 font-bold">{pct(radar.tsmc_change)}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] mb-1">雷達分數</p>
                  <p className="text-slate-100 font-bold">{safeText(radar.confidence_score)}/100</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-2">雷達說明</p>
                <p className="text-slate-200 text-sm leading-relaxed">{renderSafeText(radar.summary)}</p>
              </div>
            </section>
          )}

          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6">
            <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
              今日重要觀察
            </h2>

            <div className="space-y-3">
              {observations.map((item, idx) => (
                <div key={idx} className="flex gap-3 p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <div className="w-7 h-7 rounded-md bg-slate-700/70 border border-slate-600/50 flex items-center justify-center flex-shrink-0">
                    <span className="text-slate-300 text-xs font-bold">{idx + 1}</span>
                  </div>
                  <p className="text-slate-200 text-sm leading-relaxed">{renderSafeText(item)}</p>
                </div>
              ))}
            </div>
          </section>

          {beneficiaryStocks.length > 0 && (
            <section className="bg-navy-900/70 border border-amber-500/15 rounded-2xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">
                  今日受惠觀察
                </h2>
                <span className="text-amber-300 text-[10px] px-2 py-1 rounded-full bg-amber-500/10 border border-amber-400/20">
                  觀察名單，不是買進訊號
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {beneficiaryStocks.map((stock, idx) => (
                  <div key={`${safeText(stock.symbol)}-${idx}`} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-slate-100 font-bold">{safeText(stock.symbol)}</span>
                      <span className="text-slate-100 font-bold">{safeText(stock.name)}</span>
                      <span className="ml-auto text-[10px] text-amber-300 bg-amber-500/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                        觀察
                      </span>
                    </div>
                    <p className="text-slate-300 text-xs leading-relaxed">{renderSafeText(stock.reason || stock.thesis || stock.watch_point)}</p>
                    {stock.risk && (
                      <p className="text-red-300/80 text-xs leading-relaxed mt-2">風險：{renderSafeText(stock.risk)}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="text-center mt-5">
                <Link
                  to="/opportunities"
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500/12 hover:bg-amber-500/18 text-amber-300 font-semibold text-sm rounded-xl transition-colors border border-amber-400/30"
                >
                  查看今日受惠股
                  <i className="ri-arrow-right-line" />
                </Link>
              </div>
            </section>
          )}

          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6 text-center">
            <h2 className="text-white font-bold text-base mb-3">完整研究筆記</h2>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xl mx-auto mb-5">
              完整版包含盤中驗證、失效條件、受惠族群與收盤回饋。若盤中雷達與盤前假設相反，系統會以雷達為優先顯示。
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to={`/reports/${report.report_date}`}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors"
              >
                查看完整判讀
                <i className="ri-arrow-right-line" />
              </Link>

              <Link
                to="/member-note"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white/5 hover:bg-white/10 text-slate-200 font-semibold text-sm rounded-xl transition-colors border border-white/10"
              >
                查看完整研究筆記
                <i className="ri-arrow-right-line" />
              </Link>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function TodayReport() {
  return (
    <ErrorBoundary>
      <TodayReportContent />
    </ErrorBoundary>
  );
}