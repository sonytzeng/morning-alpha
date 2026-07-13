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
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildCanonicalNarrative, type CanonicalMorningNarrative } from '@/lib/canonicalNarrative';
import { isFreshIntradayData } from '@/utils/intradayFreshness';
import { getTodayOpeningRadar } from '@/services/openingRadarService';

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
  data_status?: string;
  missing_sources?: string[];
  radar_mode?: string;
  txf_status?: string;
  input_source?: string;
};

function asObj(value: unknown): AnyObj {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyObj) : {};
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeText(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s.length > 0 && s !== 'null' && s !== 'undefined' ? s : fallback;
}

function normalizeRadarFromReport(report: Report | null): RadarView | null {
  if (!report) return null;

  const ai = asObj((report as AnyObj).ai_strategy_json);
  const opening = asObj(ai.opening_radar);
  const intradayTracking = asObj(ai.intraday_tracking);
  const intradayRadar = asObj(ai.intraday_radar);
  const sourceRadar = Object.keys(opening).length > 0
    ? opening
    : Object.keys(intradayTracking).length > 0
      ? intradayTracking
      : intradayRadar;

  if (Object.keys(sourceRadar).length > 0) {
    return {
      version: safeText(sourceRadar.version, ''),
      report_date: safeText(sourceRadar.report_date || report.report_date, ''),
      radar_status: safeText(sourceRadar.radar_status || sourceRadar.status, ''),
      market_bias: safeText(sourceRadar.market_bias || sourceRadar.bias, ''),
      confidence_score: sourceRadar.confidence_score ?? null,
      summary: safeText(sourceRadar.summary || sourceRadar.opening_summary, ''),
      today_quote: safeText(sourceRadar.today_quote, ''),
      taiex_change: toNumber(sourceRadar.taiex_change),
      txf_change: toNumber(sourceRadar.txf_change),
      tsmc_change: toNumber(sourceRadar.tsmc_change),
      spx_change: toNumber(sourceRadar.spx_change),
      sox_change: toNumber(sourceRadar.sox_change),
      vix_change: toNumber(sourceRadar.vix_change),
      us10y_change: toNumber(sourceRadar.us10y_change),
      checked_at: safeText(sourceRadar.checked_at, ''),
      captured_at: safeText(sourceRadar.captured_at, ''),
      updated_at: safeText(sourceRadar.updated_at, ''),
      created_at: safeText(sourceRadar.created_at, ''),
      generated_at: safeText(sourceRadar.generated_at, ''),
      data_source: safeText(sourceRadar.data_source, '') || 'reports.ai_strategy_json.opening_radar',
      source_kind: safeText(sourceRadar.source_kind, '') || 'report_snapshot',
      market_data_date: safeText(sourceRadar.market_data_date, ''),
      data_status: safeText(sourceRadar.data_status, ''),
      missing_sources: Array.isArray(sourceRadar.missing_sources) ? sourceRadar.missing_sources.map(String) : [],
      radar_mode: safeText(sourceRadar.radar_mode, ''),
      txf_status: safeText(sourceRadar.txf_status, ''),
      input_source: safeText(sourceRadar.input_source, ''),
    };
  }

  return null;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = safeText(value, '');
    if (text) return text;
  }
  return '';
}

function recordList(value: unknown): AnyObj[] {
  return Array.isArray(value)
    ? value.filter((item): item is AnyObj => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function uniqueTextList(values: unknown[], limit = 5): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = safeText(value, '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

type DecisionStock = {
  symbol: string;
  name: string;
  sector: string;
  reason: string;
};

function mapDecisionStock(value: AnyObj): DecisionStock | null {
  const symbol = firstText(value.symbol, value.stock_code, value.stock_id, value.ticker, value.code);
  const name = firstText(value.stock_name, value.name, value.company_name);
  if (!symbol && !name) return null;
  return {
    symbol,
    name,
    sector: firstText(value.sector, value.group, value.industry),
    reason: firstText(value.reason, value.rationale, value.investment_reason, value.benefit_source, value.watch_point),
  };
}

function humanMarketConclusion(displayState: MorningAlphaDisplayState | null): string {
  if (!displayState) return '資料不足';
  if (!displayState.is_trading_day || displayState.market_status !== 'OPEN') return '休市';
  const bias = safeText(displayState.marketBias, '');
  if (bias.includes('多') || bias.includes('強')) return '偏多觀察';
  if (bias.includes('空') || bias.includes('弱')) return '偏空防守';
  if (!bias || bias.includes('不足')) return '資料不足';
  return '等待確認';
}

function marketConclusionTone(conclusion: string): string {
  if (conclusion === '偏多觀察') return 'ma-badge-success';
  if (conclusion === '偏空防守') return 'ma-badge-danger';
  if (conclusion === '休市' || conclusion === '資料不足') return 'ma-badge-neutral';
  return 'ma-badge-warning';
}

function nextVerificationPoint(
  minutes: number,
  radar: RadarView | null,
  sync: IntradaySyncView,
  closingState: ClosingVerificationState,
): string {
  const is0930Ready = sync.status0930 === 'ready' || Boolean(radar);
  const is1030Ready = sync.status1030 === 'ready';
  const is1300Ready = sync.status1300 === 'ready';
  if (minutes < 570) return '09:30 看 2330、TAIEX、TXF 是否同向';
  if (minutes < 630) return is0930Ready ? '10:30 看主線是否擴散' : '09:30 開盤驗證資料同步';
  if (minutes < 780) return is1030Ready ? '13:00 看主線是否失效' : '10:30 主線確認資料同步';
  if (minutes < 850) return is1300Ready ? '14:10 等待收盤驗證資料同步' : '13:00 風險確認資料同步';
  return closingState.nextStep;
}

type IntradayWindowStatus = 'ready' | 'pending' | 'missing' | 'unknown';

type IntradaySyncView = {
  status0930: IntradayWindowStatus;
  status1030: IntradayWindowStatus;
  status1300: IntradayWindowStatus;
  warning: string;
  lastCheckedAt: string;
};

type ClosingVerificationState = {
  exists: boolean;
  completed: boolean;
  label: string;
  nextStep: string;
};

function normalizeWindowStatus(value: unknown): IntradayWindowStatus {
  const text = safeText(value, '').toLowerCase();
  if (!text) return 'unknown';
  if (['ready', 'complete', 'completed', 'synced'].includes(text)) return 'ready';
  if (['missing', 'not_updated', 'failed', 'stale'].includes(text)) return 'missing';
  if (['pending', 'waiting', 'not_started'].includes(text)) return 'pending';
  return 'unknown';
}

function pickWindowStatus(windows: AnyObj, ...keys: string[]): IntradayWindowStatus {
  for (const key of keys) {
    const status = normalizeWindowStatus(windows[key]);
    if (status !== 'unknown') return status;
  }
  return 'unknown';
}

function getIntradaySyncView(ai: AnyObj): IntradaySyncView {
  const sync = asObj(ai.intraday_sync_status);
  const windows = asObj(sync.windows);

  return {
    status0930: pickWindowStatus(windows, '0930', '09:30', '930', 'opening', 'open'),
    status1030: pickWindowStatus(windows, '1030', '10:30', 'mainline', 'main_line'),
    status1300: pickWindowStatus(windows, '1300', '13:00', 'risk', 'risk_check'),
    warning: safeText(sync.warning, ''),
    lastCheckedAt: safeText(sync.last_checked_at || sync.updated_at, ''),
  };
}

function getClosingVerificationState(ai: AnyObj): ClosingVerificationState {
  const closingV2 = asObj(ai.closing_verification_v2);
  const closingLegacy = asObj(ai.closing_verification);
  const closing = Object.keys(closingV2).length > 0 ? closingV2 : closingLegacy;
  const exists = Object.keys(closing).length > 0;
  const status = safeText(closing.status || closing.data_status || closing.verification_status, '').toLowerCase();
  const hasResult = Boolean(
    safeText(closing.hit_or_miss || closing.result || closing.actual_direction || closing.what_was_right || closing.what_was_wrong, ''),
  );
  const completed = exists && (
    ['completed', 'complete', 'ready', 'done'].some((keyword) => status.includes(keyword))
    || status.includes('已完成')
    || hasResult
  );

  return {
    exists,
    completed,
    label: completed ? '收盤驗證已完成' : '等待收盤驗證資料同步',
    nextStep: completed ? '查看收盤驗證結果' : '等待收盤驗證資料同步',
  };
}

function TodayReportContent() {
  const [report, setReport] = useState<Report | null>(null);
  const [reportSnapshotRadar, setReportSnapshotRadar] = useState<RadarView | null>(null);
  const [liveRadar, setLiveRadar] = useState<RadarView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHistoricalFallback, setIsHistoricalFallback] = useState(false);
  const [fallbackReportDate, setFallbackReportDate] = useState<string | null>(null);
  // V8.4: Unified display state — same source as Home, Opportunities, WarRoom, MemberNote
  const [displayState, setDisplayState] = useState<MorningAlphaDisplayState | null>(null);
  const marketClosed = displayState
    ? { closed: displayState.market_status !== 'OPEN', holidayName: displayState.holidayName }
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
          setDisplayState(getMorningAlphaDisplayState(resolved.rawRow as unknown as Record<string, unknown> | null));
          return;
        }

        setReport(finalReport);

        const radarFromReport = normalizeRadarFromReport(finalReport);
        const radarFromTable = await getTodayOpeningRadar();
        setReportSnapshotRadar(radarFromReport);
        setLiveRadar((radarFromTable as unknown as RadarView | null) || radarFromReport);
        setDisplayState(getMorningAlphaDisplayState(
          resolved.rawRow as unknown as Record<string, unknown> | null,
          (radarFromTable || radarFromReport) as unknown as Record<string, unknown> | null,
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


  const todayStr = formatTaipeiDate();
  const isReportForToday = report?.report_date === todayStr;
  const ai = asObj((report as AnyObj | null)?.ai_strategy_json);
  // V8.4: Unified display state — marketBias and confidenceScore from getMorningAlphaDisplayState
  // Same values as Home, Opportunities, WarRoom, MemberNote. No opening_radar override.
  const intradayFreshness = useMemo(() => isFreshIntradayData(report as AnyObj | null, liveRadar as AnyObj | null), [report, liveRadar]);
  const hasFreshIntradayRadar = intradayFreshness.fresh;
  const activeIntradayRadar = hasFreshIntradayRadar ? liveRadar : null;
  const taipeiNow = new Date();
  const taipeiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(taipeiNow);
  const taipeiHour = Number(taipeiParts.find((part) => part.type === 'hour')?.value || 0);
  const taipeiMinute = Number(taipeiParts.find((part) => part.type === 'minute')?.value || 0);
  const taipeiMinutes = taipeiHour * 60 + taipeiMinute;
  const intradaySyncView = getIntradaySyncView(ai);
  const closingVerificationState = getClosingVerificationState(ai);
  const canonicalNarrative: CanonicalMorningNarrative = useMemo(() => buildCanonicalNarrative({
    displayState,
    ai,
    memberResearchNoteV2: asObj(ai.member_research_note_v2),
  }), [displayState, ai]);
  const decisionLifecycle = canonicalNarrative.decision_lifecycle;
  const memberNoteV2 = asObj(ai.member_research_note_v2);
  const marketConclusion = humanMarketConclusion(displayState);
  const primaryScenario = firstText(
    decisionLifecycle.question.question,
    decisionLifecycle.current_thesis.title,
    canonicalNarrative.today_focus.headline,
  );
  const oneLineConclusion = firstText(
    decisionLifecycle.current_thesis.summary,
    canonicalNarrative.today_focus.summary,
    displayState?.todayQuote,
  );
  const canActText = decisionLifecycle.decision_status.status === 'Confirmed'
    ? '條件已確認，可依原定計畫行動'
    : decisionLifecycle.decision_status.status === 'Rejected'
      ? '原判斷已失效，停止原定計畫'
      : decisionLifecycle.decision_status.status === 'Completed'
        ? '今日判斷流程已完成'
        : '先等待確認，不急著行動';
  const nextVerification = firstText(
    decisionLifecycle.validation_plan.next_step,
    nextVerificationPoint(taipeiMinutes, activeIntradayRadar, intradaySyncView, closingVerificationState),
  );
  const currentActions = uniqueTextList([
    canonicalNarrative.today_focus.action,
    decisionLifecycle.decision_status.next_step,
    decisionLifecycle.validation_plan.next_step,
  ], 3);
  const successConditions = uniqueTextList([
    ...decisionLifecycle.validation_plan.steps.map((step) => firstText(step.detail, step.title)),
    canonicalNarrative.intraday_progress.current_step,
    canonicalNarrative.intraday_progress.next_step,
  ], 5);
  const stopItems = uniqueTextList([
    decisionLifecycle.failure_condition.trigger,
    decisionLifecycle.failure_condition.meaning,
    decisionLifecycle.failure_condition.action,
    ...canonicalNarrative.failure_triggers.flatMap((item) => [item.trigger, item.meaning, item.action]),
    ...recordList(memberNoteV2.risk_scenarios).map((item) => firstText(item.condition, item.risk, item.response)),
    ...recordList(memberNoteV2.invalidation_conditions).map((item) => firstText(item.condition, item.meaning, item.action_note)),
  ], 5);
  const stockSource = displayState?.v10BeneficiaryEnabled
    ? displayState.v10BeneficiaryStocks
    : displayState?.coreBeneficiaryStocks.length
      ? displayState.coreBeneficiaryStocks
      : displayState?.beneficiaryStocks || [];
  const priorityStocks = stockSource
    .map((item) => mapDecisionStock(item))
    .filter((item): item is DecisionStock => item !== null)
    .slice(0, 5);
  const prioritySectors = uniqueTextList(priorityStocks.map((item) => item.sector), 3);
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
    <div className="ma-page flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        <div className="border-b border-background-200/70 bg-background-100/80">
          <div className="ma-section-inner flex flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <h1 className="text-sm font-bold text-foreground-900 md:text-base">{isHistoricalFallback ? '歷史資料模式' : '今日判斷'}</h1>
            <span className="ma-badge ma-badge-neutral"><i className="ri-calendar-line" aria-hidden="true" />{report.report_date}</span>
            {!isReportForToday && (
              <span className="ma-badge ma-badge-danger">歷史資料：{fallbackReportDate || report.report_date}，今日為 {todayStr}</span>
            )}
          </div>
        </div>

        <div className="ma-section-inner space-y-6 px-4 py-6 md:px-6 md:py-8">
          <section className="ma-card-elevated" aria-labelledby="today-conclusion-title">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground-400">今日結論</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h2 id="today-conclusion-title" className="text-3xl font-bold leading-tight text-foreground-900 md:text-4xl">{marketConclusion}</h2>
                  <span className={`ma-badge ${marketConclusionTone(marketConclusion)}`}>{displayState?.market_message || '等待市場狀態'}</span>
                </div>
              </div>
              <div className="max-w-md rounded-xl border border-background-200/70 bg-background-100 p-4 md:text-right">
                <p className="text-xs text-foreground-400">今天能不能做？</p>
                <p className="mt-1 text-base font-bold leading-relaxed text-foreground-900">{canActText}</p>
              </div>
            </div>
          </section>

          <section className="ma-card" aria-labelledby="main-scenario-title">
            <p className="text-xs font-semibold text-foreground-400">今天唯一劇本</p>
            <h2 id="main-scenario-title" className="mt-3 text-2xl font-bold leading-snug text-foreground-900 md:text-3xl">{renderSafeText(primaryScenario)}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-foreground-500 md:text-base">{renderSafeText(oneLineConclusion)}</p>
          </section>

          <section className="ma-card" aria-labelledby="current-action-title">
            <h2 id="current-action-title" className="ma-section-title mb-4">現在你要做什麼</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {(currentActions.length > 0 ? currentActions : ['等待盤中資料']).map((action, index) => (
                <div key={`${action}-${index}`} className="flex items-start gap-3 rounded-xl border border-background-200/70 bg-background-50 p-4">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-bold text-foreground-700">{index + 1}</span>
                  <p className="text-sm leading-relaxed text-foreground-700">{renderSafeText(action)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="ma-card" aria-labelledby="success-conditions-title">
            <div className="mb-4">
              <h2 id="success-conditions-title" className="ma-section-title">劇本成立條件</h2>
              <p className="mt-2 text-sm text-foreground-500">出現以下訊號，今天的主要判斷才算成立。</p>
            </div>
            {successConditions.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {successConditions.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex items-start gap-3 rounded-xl border border-background-200/70 bg-background-50 p-4">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-foreground-400/40 text-[10px] text-foreground-500" aria-hidden="true">□</span>
                    <p className="text-sm leading-relaxed text-foreground-700">{renderSafeText(item)}</p>
                  </div>
                ))}
              </div>
            ) : <p className="ma-body">目前尚未形成確認訊號。</p>}
          </section>

          <section className="ma-card" aria-labelledby="stop-title">
            <div className="mb-4 flex items-start gap-3">
              <i className="ri-stop-circle-line mt-0.5 text-rose-300" aria-hidden="true" />
              <div>
                <h2 id="stop-title" className="ma-section-title">劇本失敗條件</h2>
                <p className="mt-2 text-sm text-foreground-500">任何一項出現，就停止原本判斷。</p>
              </div>
            </div>
            {stopItems.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {stopItems.map((item, index) => (
                  <div key={`${item}-${index}`} className="rounded-xl border border-rose-400/15 bg-rose-500/[0.04] p-4">
                    <p className="text-sm leading-relaxed text-rose-100/80">{renderSafeText(item)}</p>
                  </div>
                ))}
              </div>
            ) : <p className="ma-body">失效條件尚未完整，暫不放大動作。</p>}
          </section>

          {(prioritySectors.length > 0 || priorityStocks.length > 0) && (
            <section className="ma-card" aria-labelledby="priority-title">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="priority-title" className="ma-section-title">今天優先觀察</h2>
                </div>
                <Link to="/opportunities" className="ma-btn-outline">查看全部觀察名單</Link>
              </div>
              {prioritySectors.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {prioritySectors.map((sector) => <span key={sector} className="ma-badge ma-badge-neutral">{sector}</span>)}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {priorityStocks.map((stock) => (
                  <article key={`${stock.symbol}-${stock.name}`} className="min-w-0 rounded-xl border border-background-200/70 bg-background-50 p-4">
                    <p className="text-xs font-bold text-foreground-500">{stock.symbol}</p>
                    <h3 className="mt-1 font-bold text-foreground-900">{stock.name}</h3>
                    {stock.reason && <p className="mt-2 text-xs leading-relaxed text-foreground-500">{stock.reason}</p>}
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="ma-card-elevated flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="next-return-title">
            <div className="min-w-0">
              <h2 id="next-return-title" className="ma-section-title">下一次回來</h2>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-300">{renderSafeText(nextVerification)}</p>
            </div>
            <Link to="/member-note" className="ma-btn-primary w-full sm:w-auto">查看完整研究<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
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
