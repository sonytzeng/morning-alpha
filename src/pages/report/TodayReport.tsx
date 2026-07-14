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
import { buildDecisionPresentation, formatCheckpoint } from '@/lib/decisionPresentation';
import VisualPageHero from '@/components/feature/VisualPageHero';
import VisualSectionHeader from '@/components/feature/VisualSectionHeader';

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
  const nextCheckpointFallback = nextVerificationPoint(taipeiMinutes, activeIntradayRadar, intradaySyncView, closingVerificationState);
  const presentation = useMemo(() => buildDecisionPresentation({
    displayState,
    narrative: canonicalNarrative,
    nextCheckpointFallback,
  }), [canonicalNarrative, displayState, nextCheckpointFallback]);
  const primaryScenario = presentation.mission.title;
  const oneLineConclusion = presentation.mission.explanation;
  const successConditions = presentation.confirmationItems;
  const stopItems = presentation.invalidationItems;
  const flowConditions = successConditions.length > 0 ? successConditions : ['資料待補'];
  const detailedAction = presentation.actionItems.find((item) => item !== presentation.primaryDecision.instruction)
    || presentation.actionItems[0]
    || presentation.primaryDecision.reason
    || presentation.primaryDecision.instruction;
  const decisionContext = [primaryScenario, oneLineConclusion].filter(Boolean).join('：');
  const nextDecisionTime = formatCheckpoint(presentation.nextCheckpoint);
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
    <div className="ma-page ma-launch-page flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        <VisualPageHero
          eyebrow={isHistoricalFallback ? `歷史資料 · ${report.report_date}` : `今日判斷 · ${report.report_date}`}
          icon="ri-route-line"
          title="今天怎麼做？"
          subtitle={renderSafeText(decisionContext)}
          decisionLabel="目前行動"
          decision={renderSafeText(detailedAction)}
          ctaLabel="查看今天要觀察的股票"
          ctaTo="/opportunities"
        />
        {!isReportForToday && (
          <div className="ma-section-inner px-4 pt-4 md:px-6"><span className="ma-badge ma-badge-danger">歷史資料：{fallbackReportDate || report.report_date}，今日為 {todayStr}</span></div>
        )}

        <div className="ma-section-inner px-5 pb-14 pt-14 md:px-12">
          <section className="ma-card-primary ma-decision-flow-card p-6" aria-labelledby="decision-flow-title">
            <VisualSectionHeader icon="ri-route-line" title="今天第一步" />
            <div className="ma-decision-flow mx-auto mt-6 max-w-4xl">
              <article className="ma-flow-step is-success">
                <span className="ma-flow-index">1</span>
                <div>
                  <h3>開盤第一反應</h3>
                  <p>{renderSafeText(detailedAction)}</p>
                </div>
              </article>

              {flowConditions.map((item, index) => (
                <article key={`${item}-${index}`} className="ma-flow-step is-success">
                  <span className="ma-flow-index">{index + 2}</span>
                  <div>
                    <h3>{index === 0 ? '成立條件' : '繼續確認'}</h3>
                    <p>{renderSafeText(item)}</p>
                  </div>
                </article>
              ))}

              <article className="ma-flow-step is-warning">
                <span className="ma-flow-index">{flowConditions.length + 2}</span>
                <div>
                  <h3>如果失敗</h3>
                  <p>{stopItems[0] ? renderSafeText(stopItems[0]) : '停止今天原本劇本。'}</p>
                </div>
              </article>

              <article className="ma-flow-step is-danger">
                <span className="ma-flow-index">{flowConditions.length + 3}</span>
                <div>
                  <h3>停止今天原本劇本</h3>
                  <p>不再執行原有策略。</p>
                </div>
              </article>

              <article className="ma-flow-step is-neutral">
                <span className="ma-flow-index">{flowConditions.length + 4}</span>
                <div>
                  <h3>等待下一次確認</h3>
                  <p>{nextDecisionTime}</p>
                </div>
              </article>

              <Link to="/opportunities" className="ma-btn-primary mt-6 w-full">
                查看今天要觀察的股票
                <i className="ri-arrow-right-line" aria-hidden="true" />
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
