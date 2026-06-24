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
import { parseAIStrategy } from '@/utils/aiStrategyParser';
import type { Report } from '@/types/report';
import { isAISemiconductorWeak, isAIStock, DEFENSE_KEYWORDS } from '@/utils/marketBiasDowngrade';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import DailySentenceCard from '@/components/v8/DailySentenceCard';
import OvernightCausalChainCard from '@/components/v8/OvernightCausalChainCard';
import PaywallCard from '@/components/paywall/PaywallCard';
import { isFreshIntradayData } from '@/utils/intradayFreshness';
import { getTodayOpeningRadar } from '@/services/openingRadarService';
import { getCurrentEntitlement, hasFeature } from '@/services/entitlementService';
import type { UserEntitlement } from '@/types/subscription';

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
  checked_at?: string;
  captured_at?: string;
  updated_at?: string;
  created_at?: string;
  generated_at?: string;
  data_source?: string;
  source_kind?: string;
  market_data_date?: string;
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

function biasFromRadarStatus(status?: string | null): string {
  const s = safeText(status, '');
  if (s.includes('明顯偏弱')) return '明顯偏弱';
  if (s.includes('盤中轉弱')) return '偏弱觀察';
  if (s.includes('偏強確認')) return '偏強確認';
  if (s.includes('觀察中')) return '觀察中';
  return '觀察中';
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
      checked_at: safeText(opening.checked_at, ''),
      captured_at: safeText(opening.captured_at, ''),
      updated_at: safeText(opening.updated_at, ''),
      created_at: safeText(opening.created_at, ''),
      generated_at: safeText(opening.generated_at, ''),
      data_source: 'reports.ai_strategy_json.opening_radar',
      source_kind: 'report_snapshot',
    };
  }

  return null;
}

function buildObservations(report: Report | null, radar: RadarView | null): string[] {
  const ai = asObj((report as AnyObj | null)?.ai_strategy_json);
  const items: string[] = [];

  if (radar) {
    const radarLine = safeText(radar.summary || radar.radar_status, '');
    if (radarLine) items.push(radarLine);
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

  return items.slice(0, 5);
}

function TodayReportContent() {
  const [report, setReport] = useState<Report | null>(null);
  const [reportSnapshotRadar, setReportSnapshotRadar] = useState<RadarView | null>(null);
  const [liveRadar, setLiveRadar] = useState<RadarView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHistoricalFallback, setIsHistoricalFallback] = useState(false);
  const [fallbackReportDate, setFallbackReportDate] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);
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
        setIsHistoricalFallback(resolved.isHistoricalFallback);
        setFallbackReportDate(resolved.fallbackReportDate);
        if (!finalReport) {
          setReport(null);
          setReportSnapshotRadar(null);
          setLiveRadar(null);
          setDisplayState(getMorningAlphaDisplayState(resolved.rawRow as Record<string, unknown> | null));
          return;
        }

        setReport(finalReport);

        const radarFromReport = normalizeRadarFromReport(finalReport);
        const radarFromTable = await getTodayOpeningRadar();
        setReportSnapshotRadar(radarFromReport);
        setLiveRadar(radarFromTable);
        setDisplayState(getMorningAlphaDisplayState(
          resolved.rawRow as Record<string, unknown> | null,
          radarFromTable as unknown as Record<string, unknown> | null,
        ));
      } catch (err) {
        console.error('TodayReport load failed:', err);
        setError(err instanceof Error ? err.message : '讀取今日判斷失敗');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  useEffect(() => {
    // P27 is UI scaffold only. Full security requires P28 server-side payload trimming and P29 RLS lockdown.
    // Do not treat frontend gating as data security.
    getCurrentEntitlement().then(setEntitlement).catch(() => setEntitlement(null));
  }, []);

  const todayStr = formatTaipeiDate();
  const isReportForToday = report?.report_date === todayStr;
  const ai = asObj((report as AnyObj | null)?.ai_strategy_json);
  const parsedStrategy = useMemo(() => parseAIStrategy(report), [report]);

  // V8.4: Unified display state — marketBias and confidenceScore from getMorningAlphaDisplayState
  // Same values as Home, Opportunities, WarRoom, MemberNote. No opening_radar override.
  const displayBias = displayState?.marketBias || '—';
  const intradayFreshness = useMemo(() => isFreshIntradayData(report as AnyObj | null, liveRadar as AnyObj | null), [report, liveRadar]);
  const hasFreshIntradayRadar = intradayFreshness.fresh;
  const premarketBiasLabel = safeText(displayBias, '待判斷');
  const activeIntradayRadar = hasFreshIntradayRadar ? liveRadar : null;
  const effectiveIntradayRadar = activeIntradayRadar;
  const overviewRadarStatusText = activeIntradayRadar
    ? safeText(activeIntradayRadar.radar_status, '觀察中')
    : '盤中資料未同步';
  const overviewBiasText = activeIntradayRadar
    ? safeText(activeIntradayRadar.market_bias, '') || biasFromRadarStatus(overviewRadarStatusText)
    : `盤前假設：${premarketBiasLabel}`;
  const overviewScoreText = activeIntradayRadar
    ? (activeIntradayRadar.confidence_score != null ? `${safeText(activeIntradayRadar.confidence_score)}/100` : '—')
    : '待驗證';
  const overviewSyncText = activeIntradayRadar
    ? `已同步：${overviewRadarStatusText}`
    : '盤中資料未同步';
  const todaySentenceText = activeIntradayRadar?.summary
    ? safeText(activeIntradayRadar.summary)
    : '目前僅保留07:30盤前假設，今日方向需等待09:00後有效盤中資料驗證。';
  const observations = useMemo(
    () => (activeIntradayRadar ? buildObservations(report, activeIntradayRadar) : []),
    [report, activeIntradayRadar],
  );
  const safeDailySentence = hasFreshIntradayRadar
    ? { status: 'ready' as const, sentence: todaySentenceText, logic_source: ['opening_market_radar.summary'], tone: 'clear, sharp, human-readable' as const }
    : { status: 'insufficient' as const, sentence: '', logic_source: [], tone: 'clear, sharp, human-readable' as const };
  const canViewTodayReportFull = hasFeature(entitlement, 'today_report_full');

  const marketDataBasisDate =
    safeText(ai.market_data_latest_date || ai.tw_core_date || report?.report_date, '—');
  const marketDataBasisLabel = marketDataBasisDate === report?.report_date
    ? `${marketDataBasisDate} 資料基準`
    : `${marketDataBasisDate} 收盤`;

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
    const soxPct = effectiveIntradayRadar?.sox_change ?? null;
    const tsmcCore = effectiveIntradayRadar?.tsmc_change ?? null;

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
              日期：{displayState?.currentDate || report?.report_date || todayStr}（{displayState?.currentWeekday || ''}）
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
              <h1 className="text-white font-bold text-sm md:text-base">{isHistoricalFallback ? '歷史資料模式' : '今日盤前判斷'}</h1>

              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${getBiasClass(overviewBiasText)}`}>
                <i className="ri-record-circle-line text-[9px]" />
                {overviewBiasText}
              </span>

              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${getRadarClass(overviewRadarStatusText)}`}>
                <i className="ri-radar-line text-[9px]" />
                {overviewRadarStatusText}
              </span>

              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-500/10 text-sky-300 text-[10px] font-medium rounded-full border border-sky-400/25">
                <i className="ri-calendar-line text-[9px]" />
                報告日期：{report.report_date}
              </span>

              {!isReportForToday && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-300 text-[10px] font-medium rounded-full border border-red-400/25">
                  歷史資料模式：{fallbackReportDate || report.report_date}，今日為 {todayStr}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6">
            <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
              {isHistoricalFallback ? '歷史報告總覽' : '今日狀態總覽'}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">目前方向</p>
                <p className="text-slate-50 font-bold text-base">{overviewBiasText}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">判斷把握度</p>
                <p className="text-slate-50 font-bold text-base">{overviewScoreText}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">雷達狀態</p>
                <p className="text-slate-50 font-bold text-base">{overviewRadarStatusText}</p>
              </div>

              <div className="p-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/20 sm:col-span-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <div>
                    <p className="text-sky-300 text-[10px] uppercase tracking-wider mb-0.5">台股盤前基準</p>
                    <p className="text-sky-200 text-xs font-semibold">{marketDataBasisLabel}</p>
                  </div>
                  <div>
                    <p className="text-sky-300 text-[10px] uppercase tracking-wider mb-0.5">盤中資料</p>
                    <p className="text-sky-100 text-xs font-semibold">
                      {overviewSyncText}
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
              {isHistoricalFallback ? '報告一句話' : '今日一句話'}
            </h2>
            <p className="text-slate-200 text-sm leading-relaxed">
              <strong className="text-slate-50">
                {renderSafeText(todaySentenceText || '盤中雷達尚未提供有效摘要。')}
              </strong>
            </p>
          </section>

          <DailySentenceCard dailySentence={safeDailySentence} tone="dark" />

          <section className="bg-navy-900/70 border border-cyan-500/20 rounded-2xl p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">
                盤中雷達
              </h2>
              <span className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-full border ${getRadarClass(overviewRadarStatusText)}`}>
                <i className="ri-radar-line" />
                {overviewRadarStatusText}
              </span>
            </div>

            {activeIntradayRadar ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
                  <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-400 text-[10px] mb-1">TAIEX</p>
                    <p className="text-slate-100 font-bold">{pct(activeIntradayRadar.taiex_change)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-400 text-[10px] mb-1">TXF</p>
                    <p className="text-slate-100 font-bold">{pct(activeIntradayRadar.txf_change)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-400 text-[10px] mb-1">2330</p>
                    <p className="text-slate-100 font-bold">{pct(activeIntradayRadar.tsmc_change)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-400 text-[10px] mb-1">雷達分數</p>
                    <p className="text-slate-100 font-bold">{safeText(activeIntradayRadar.confidence_score)}/100</p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-2">雷達說明</p>
                  <p className="text-slate-200 text-sm leading-relaxed">{renderSafeText(activeIntradayRadar.summary)}</p>
                  <p className="text-slate-500 text-[10px] mt-3">
                    資料時間：{intradayFreshness.timestampLabel || safeText(activeIntradayRadar.updated_at || activeIntradayRadar.generated_at)}
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <p className="text-slate-100 font-semibold text-sm mb-2">盤中資料未同步</p>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    目前僅顯示 07:30 盤前假設，尚未取得今日 09:00 後盤中資料。昨日收盤漲跌不會作為今日盤中確認。
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-400 text-[10px] mb-1">盤前假設</p>
                    <p className="text-slate-100 font-bold">{premarketBiasLabel}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-400 text-[10px] mb-1">今日待驗證</p>
                    <p className="text-slate-100 font-bold">TAIEX、TXF、2330 是否同向</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6">
            <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
              {isHistoricalFallback ? '報告重要觀察' : '今日重要觀察'}
            </h2>

            <div className="space-y-3">
              {observations.length > 0 ? (
                observations.map((item, idx) => (
                  <div key={idx} className="flex gap-3 p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <div className="w-7 h-7 rounded-md bg-slate-700/70 border border-slate-600/50 flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-300 text-xs font-bold">{idx + 1}</span>
                    </div>
                    <p className="text-slate-200 text-sm leading-relaxed">{renderSafeText(item)}</p>
                  </div>
                ))
              ) : (
                <div className="flex gap-3 p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <div className="w-7 h-7 rounded-md bg-slate-700/70 border border-slate-600/50 flex items-center justify-center flex-shrink-0">
                    <i className="ri-database-2-line text-slate-300 text-xs"></i>
                  </div>
                  <p className="text-slate-200 text-sm leading-relaxed">目前資料不足，等待盤前報告補齊。</p>
                </div>
              )}
            </div>
          </section>

          {beneficiaryStocks.length > 0 && canViewTodayReportFull && (
            <section className="bg-navy-900/70 border border-amber-500/15 rounded-2xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">
                  {isHistoricalFallback ? '歷史受惠觀察' : '今日受惠觀察'}
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

          {beneficiaryStocks.length > 0 && !canViewTodayReportFull && (
            <PaywallCard
              title="升級會員查看完整盤前研究鏈"
              description={`今日已追蹤 ${beneficiaryStocks.length} 檔受惠觀察股。完整受惠股、盤中驗證、失效條件與收盤回測，已收在會員版。`}
              requiredTier="member"
              featureList={['完整今日受惠股', '受惠推理與驗證訊號', '失效條件與風險提醒']}
              tone="dark"
            />
          )}

          {canViewTodayReportFull ? (
            <>
              <OvernightCausalChainCard chain={parsedStrategy.v8_overnight_causal_chain} tone="dark" />

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
            </>
          ) : (
            <PaywallCard
              title="完整研究筆記已收在會員版"
              description="會員可查看 overnight causal chain、盤中驗證、失效條件與完整收盤回測，不只看方向，也看判斷如何被驗證。"
              requiredTier="member"
              featureList={['前夜事件傳導鏈', '盤中驗證與失效條件', '完整研究筆記與回測']}
              tone="dark"
            />
          )}
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
