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
import { buildDecisionPresentation, type PresentationDecisionState } from '@/lib/decisionPresentation';
import {
  buildRuntimeDecisionTimeline,
  runtimeTimelineStatusLabel,
  selectNextRuntimeTimelineNode,
  type RuntimeTimelineNode,
} from '@/lib/runtimeDecisionTimeline';

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

type TodayValidationStatus = 'confirmed' | 'current' | 'pending' | 'failed' | 'missing';
type TodayTimelineState = 'completed' | 'current' | 'upcoming' | 'insufficient' | 'not_applicable';

function firstPopulatedText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function safeStockDisplayText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text === 'null' || text === 'undefined') return '';

  const debugLikePatterns = [
    /\b(?:event_)?score\s*=/i,
    /^\s*[a-z][a-z0-9_]*\s*=\s*[^=]+\s*$/i,
    /^\s*[a-z][a-z0-9]*_[a-z0-9_]+\s*$/i,
    /^\s*[-+]?\d+(?:\.\d+)?(?:\s*\/\s*\d+|\s*%)?\s*$/,
    /^\s*[\[{].*[\]}]\s*$/s,
  ];

  return debugLikePatterns.some((pattern) => pattern.test(text)) ? '' : publicTodayText(text);
}

function publicTodayText(value: unknown): string {
  const text = safeText(value, '');
  if (!text) return '';
  return text
    .replace(/checkpoint\s*(\d{2})(\d{2})/gi, (_match, hours: string, minutes: string) => `${hours}:${minutes} 驗證節點`)
    .replace(/freshness window/gi, '有效時間範圍')
    .replace(/同\s*phase/gi, '同一資料階段')
    .replace(/\bTAIEX\b/gi, '加權指數')
    .replace(/\bTXF\b/gi, '台指期')
    .replace(/\bRuntime\b/gi, '盤中資料')
    .replace(/\bAI Server\b/gi, 'AI 伺服器族群')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeValidationText(value: unknown): string {
  const text = publicTodayText(value)
    .replace(/\b2330\b(?:\s*[／/]\s*台積電)?/g, '台積電')
    .replace(/\s*[／/]\s*/g, '、')
    .replace(/\s+/g, ' ')
    .trim();
  if (/09:30/.test(text) && /缺少/.test(text) && /加權指數/.test(text) && /台指期/.test(text)) {
    return '09:30 開盤資料不完整：缺少同一時間範圍的加權指數、台指期與台積電快照，因此暫不判斷主線是否成立。';
  }
  return text
    .replace(/驗證節點\s*缺少同日、同一資料階段且在有效時間範圍內的完整/g, '資料不完整：缺少同一時間範圍的')
    .replace(/驗證節點/g, '驗證')
    .trim();
}

function todayDecisionCopy(
  state: PresentationDecisionState,
  timeline: RuntimeTimelineNode[],
): { headline: string; instruction: string } {
  if (state === 'ACT') return { headline: '驗證條件已成立', instruction: '條件成立，依計畫分批執行' };
  if (state === 'STOP') return { headline: '原定條件已失效', instruction: '停止原定計畫，先控制風險' };
  if (state === 'CLOSED') return { headline: '今日休市', instruction: '今天不執行盤中流程' };
  const latestInsufficient = [...timeline].reverse().find((node) => node.status === 'insufficient');
  if (state === 'INSUFFICIENT_DATA' && latestInsufficient) {
    return {
      headline: `${latestInsufficient.label}資料不足`,
      instruction: '暫不建立部位',
    };
  }
  if (state === 'INSUFFICIENT_DATA') {
    return {
      headline: '等待盤中資料確認',
      instruction: '暫不建立部位',
    };
  }
  return {
    headline: '關鍵條件仍待確認',
    instruction: '先不要追價',
  };
}

function workbenchTitle(state: PresentationDecisionState, nextNode: RuntimeTimelineNode): string {
  if (state === 'ACT') return '條件成立，接下來只做計畫內的事';
  if (state === 'STOP') return '原定條件失效，先停止再重新判斷';
  if (state === 'CLOSED') return '今日流程已結束';
  const subject = nextNode.label === '主線確認'
    ? '主線是否成立'
    : nextNode.label === '開盤驗證'
      ? '開盤訊號是否一致'
      : nextNode.label;
  return nextNode.status === 'current'
    ? `現在先確認${subject}`
    : `${nextNode.time} 前，先確認${subject}`;
}

function listText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => safeText(item, '')).filter(Boolean).join('、');
  return safeText(value, '');
}

function formatMarketChange(value: number | null): string {
  if (value === null) return '尚未取得';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function snapshotChange(ai: AnyObj, keys: string[]): number | null {
  const normalizedKeys = new Set(keys.map((key) => key.toUpperCase()));
  const snapshots = Array.isArray(ai.market_data_snapshots) ? ai.market_data_snapshots : [];
  for (const candidate of snapshots) {
    const row = asObj(candidate);
    const symbol = safeText(row.symbol ?? row.ticker ?? row.name, '').toUpperCase();
    if (!normalizedKeys.has(symbol)) continue;
    const value = toNumber(row.change_percent ?? row.change ?? row.changePercent);
    if (value !== null) return value;
  }
  const snapshot = asObj(ai.market_snapshot);
  for (const key of keys) {
    const row = asObj(snapshot[key]);
    const value = toNumber(row.change_percent ?? row.change ?? row.changePercent);
    if (value !== null) return value;
  }
  return null;
}

function validationStatusLabel(status: TodayValidationStatus): string {
  if (status === 'confirmed') return '已確認';
  if (status === 'current') return '確認中';
  if (status === 'failed') return '未成立';
  if (status === 'missing') return '資料不足';
  return '待確認';
}

function TodayReportContent() {
  const [report, setReport] = useState<Report | null>(null);
  const [reportSnapshotRadar, setReportSnapshotRadar] = useState<RadarView | null>(null);
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
          setDisplayState(getMorningAlphaDisplayState(resolved.rawRow as unknown as Record<string, unknown> | null));
          return;
        }

        setReport(finalReport);

        const radarFromReport = normalizeRadarFromReport(finalReport);
        setReportSnapshotRadar(radarFromReport);
        setDisplayState(getMorningAlphaDisplayState(
          resolved.rawRow as unknown as Record<string, unknown> | null,
          radarFromReport as unknown as Record<string, unknown> | null,
        ));
      } catch {
        setError('最新判斷暫時無法取得，請稍後重新載入。');
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
  const intradayFreshness = useMemo(() => isFreshIntradayData(report as AnyObj | null, reportSnapshotRadar as AnyObj | null), [report, reportSnapshotRadar]);
  const hasFreshIntradayRadar = intradayFreshness.fresh;
  const activeIntradayRadar = hasFreshIntradayRadar ? reportSnapshotRadar : null;
  const canonicalNarrative: CanonicalMorningNarrative = useMemo(() => buildCanonicalNarrative({
    displayState,
    ai,
    memberResearchNoteV2: asObj(ai.member_research_note_v2),
  }), [displayState, ai]);
  const runtimeTimeline = buildRuntimeDecisionTimeline({
    ai,
    hasReport: isReportForToday,
    reportRevisionId: report?.id,
    reportGeneratedAt: report?.created_at,
    isTradingDay: Boolean(displayState?.is_trading_day && displayState.market_status === 'OPEN'),
  });
  const nextRuntimeNode = selectNextRuntimeTimelineNode(runtimeTimeline) || runtimeTimeline[runtimeTimeline.length - 1];
  const nextCheckpointFallback = `${nextRuntimeNode.time} ${nextRuntimeNode.label}`;
  const presentation = useMemo(() => buildDecisionPresentation({
    displayState,
    narrative: canonicalNarrative,
    opportunitySource: displayState
      ? displayState.v10BeneficiaryEnabled
        ? [...displayState.v10BeneficiaryStocks, ...displayState.v10ObservationWatchlist]
        : [...displayState.coreBeneficiaryStocks, ...displayState.beneficiaryStocks]
      : [],
    nextCheckpointFallback,
  }), [canonicalNarrative, displayState, nextCheckpointFallback]);
  const primaryScenario = publicTodayText(presentation.mission.title);
  const oneLineConclusion = publicTodayText(presentation.mission.explanation);
  const successConditions = presentation.confirmationItems;
  const flowConditions = successConditions;
  const nextDecisionTime = `${nextRuntimeNode.time}｜${nextRuntimeNode.label}`;
  const validationSteps = canonicalNarrative.decision_lifecycle.validation_plan.steps.slice(0, 5);
  const hasCompleteDecisionInputs = canonicalNarrative.decision_evidence.marketSnapshotAvailable
    && canonicalNarrative.decision_evidence.checklistAvailable;
  const validationItems: Array<{ label: string; detail: string; status: TodayValidationStatus }> = validationSteps.length > 0
    ? validationSteps.map((step) => ({
        label: humanizeValidationText(firstPopulatedText(step.title, step.detail)),
        detail: step.title && step.detail && step.title !== step.detail ? humanizeValidationText(step.detail) : '',
        status: !hasCompleteDecisionInputs
          ? 'missing' as const
          : step.status === 'completed'
          ? 'confirmed' as const
          : step.status === 'current'
            ? 'current' as const
            : step.status === 'missing'
              ? 'missing' as const
              : 'pending' as const,
      }))
    : flowConditions.map((label) => ({ label: humanizeValidationText(label), detail: '', status: 'missing' as const }));
  const confirmedValidationCount = validationItems.filter((item) => item.status === 'confirmed').length;
  const scriptProgress = hasCompleteDecisionInputs && validationItems.length > 0
    ? Math.round((confirmedValidationCount / validationItems.length) * 100)
    : null;

  const marketMetrics = [
    {
      label: '加權指數',
      value: formatMarketChange(activeIntradayRadar?.taiex_change ?? snapshotChange(ai, ['taiex', 'TAIEX'])),
      icon: 'ri-line-chart-line',
      priority: 'primary',
    },
    {
      label: '台指期',
      value: formatMarketChange(activeIntradayRadar?.txf_change ?? snapshotChange(ai, ['txf', 'TXF'])),
      icon: 'ri-funds-line',
      priority: 'primary',
    },
    {
      label: '台積電',
      value: formatMarketChange(activeIntradayRadar?.tsmc_change ?? snapshotChange(ai, ['2330', 'tsmc', 'TSMC'])),
      icon: 'ri-cpu-line',
      priority: 'primary',
    },
    {
      label: '費半',
      value: formatMarketChange(activeIntradayRadar?.sox_change ?? snapshotChange(ai, ['sox', 'SOX'])),
      icon: 'ri-global-line',
      priority: 'secondary',
    },
    {
      label: '美股期貨',
      value: formatMarketChange(snapshotChange(ai, ['NQ', 'NASDAQ FUTURES', 'US FUTURES'])),
      icon: 'ri-bar-chart-grouped-line',
      priority: 'secondary',
    },
  ];

  const avoidAction = report?.avoid_today?.find((item) => Boolean(item?.trim())) || '';
  const focusStocks = presentation.opportunities
    .filter((stock) => stock.oneLineReason || stock.confirmation || stock.invalidation)
    .slice(0, 3)
    .map((stock) => {
      const readableTexts = [stock.oneLineReason, stock.confirmation, stock.invalidation]
        .map(safeStockDisplayText)
        .filter(Boolean);
      return {
        ...stock,
        displayHeadline: readableTexts[0],
        displayObservation: readableTexts[1],
      };
    });

  const rotation = asObj(ai.capital_rotation_path);
  const reduceWeight = firstPopulatedText(
    listText(rotation.reduce_weight),
    listText(rotation.reduce),
    listText(rotation.decrease),
    listText(ai.reduce_sector_weights),
  );
  const increaseWeight = firstPopulatedText(
    listText(rotation.increase_weight),
    listText(rotation.increase),
    listText(rotation.add),
    listText(ai.increase_sector_weights),
  );
  const activeFailure = canonicalNarrative.failure_triggers[0]
    || (presentation.primaryDecision.state === 'STOP' ? canonicalNarrative.decision_lifecycle.failure_condition : null);

  const decisionCopy = todayDecisionCopy(presentation.primaryDecision.state, runtimeTimeline);
  const nextRuntimeIndex = runtimeTimeline.findIndex((node) => node.time === nextRuntimeNode.time);
  const previousRuntimeNode = [...runtimeTimeline.slice(0, Math.max(0, nextRuntimeIndex))]
    .reverse()
    .find((node) => node.status === 'completed' || node.status === 'insufficient')
    || runtimeTimeline[0];
  const closingRuntimeNode = runtimeTimeline[runtimeTimeline.length - 1];
  const milestoneCandidates = [
    { ...previousRuntimeNode, kicker: '最近結果' },
    { ...nextRuntimeNode, kicker: '下一個判斷' },
    { ...closingRuntimeNode, kicker: '今日收尾' },
  ];
  const decisionMilestones = milestoneCandidates
    .filter((node, index, items) => items.findIndex((candidate) => candidate.time === node.time) === index)
    .map((item) => ({
      ...item,
      state: (item.status === 'pending' ? 'upcoming' : item.status) as TodayTimelineState,
    }));
  const validationProgressLabel = scriptProgress == null
    ? runtimeTimeline.some((node) => node.status === 'insufficient') ? '待補資料' : '等待驗證'
    : `${scriptProgress}%`;
  const todayWorkbenchTitle = workbenchTitle(presentation.primaryDecision.state, nextRuntimeNode);
  const validationState = runtimeTimeline.some((node) => node.status === 'insufficient')
    ? 'insufficient'
    : presentation.primaryDecision.state === 'ACT'
      ? 'confirmed'
      : 'pending';
  const workbenchStateLabel = validationState === 'insufficient'
    ? '待補資料'
    : presentation.primaryDecision.state === 'ACT'
      ? '條件成立'
      : presentation.primaryDecision.state === 'STOP'
        ? '已停止'
        : '驗證中';
  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar marketStatusLabel="資料讀取中" />
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
        <Navbar marketStatusLabel="暫時無法取得" />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-red-500/20 rounded-2xl p-6">
            <i className="ri-error-warning-line text-red-400 text-3xl" />
            <h1 className="text-white font-bold mt-3">讀取失敗</h1>
            <p className="text-slate-400 text-sm mt-2">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 min-h-11 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10"
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
        <Navbar marketStatusLabel="今日休市" />
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
              今日非交易日，本節點不適用；等待下一個交易日。
            </p>
            <Link to="/" className="mt-2 inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10">
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
        <Navbar marketStatusLabel="等待今日報告" />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-navy-800 rounded-2xl p-6">
            <i className="ri-time-line text-slate-500 text-3xl" />
            <h1 className="text-white font-bold mt-3">今日報告尚未產生</h1>
            <p className="text-slate-400 text-sm mt-2">每天 07:30 自動生成，請稍後再查看。</p>
            <Link to="/" className="mt-5 inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10">
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!isReportForToday) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar marketStatusLabel="等待今日報告" />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-amber-400/20 rounded-2xl p-6">
            <i className="ri-calendar-event-line text-amber-300 text-3xl" aria-hidden="true" />
            <h1 className="text-white font-bold text-xl mt-3">今天的判斷尚未產生</h1>
            <p className="text-slate-400 text-sm mt-2">目前最新報告是 {report.report_date}。為避免誤導，歷史行情、股票與收盤結果不會出現在今日工作台。</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link to="/" className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl bg-emerald-500 text-navy-950 text-sm font-semibold">返回首頁</Link>
              <Link to={`/reports/${report.report_date}`} className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl border border-white/10 text-white text-sm">查看 {report.report_date} 歷史報告</Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="ma-page ma-pixel-page ma-today-page flex flex-col overflow-x-hidden">
      <Navbar marketStatusLabel={nextDecisionTime} />

      <main className="flex-1 overflow-x-hidden">
        <section className="ma-today-v4-workbench-shell">
          <div className="ma-pixel-content">
            <article className={`ma-today-v4-workbench is-${presentation.primaryDecision.state.toLowerCase()}`}>
              <header>
                <p className="ma-pixel-eyebrow"><i className="ri-focus-3-line" aria-hidden="true" />今日判斷工作台 · {isHistoricalFallback ? `歷史資料 ${report.report_date}` : report.report_date}</p>
                <span className={`ma-today-v3-state is-${presentation.primaryDecision.state.toLowerCase()}`}>{workbenchStateLabel}</span>
              </header>
              <h1>{todayWorkbenchTitle}</h1>
              <p className="ma-today-v4-thesis">{renderSafeText(oneLineConclusion || primaryScenario)}</p>
              <dl className="ma-today-v4-status-grid">
                <div><dt>現在怎麼做</dt><dd>{renderSafeText(decisionCopy.instruction)}</dd></div>
                <div><dt>為什麼</dt><dd>{renderSafeText(decisionCopy.headline)}</dd></div>
                <div><dt>{nextRuntimeNode.status === 'current' ? '目前節點' : '何時再看'}</dt><dd>{renderSafeText(nextDecisionTime)}</dd></div>
              </dl>
              {avoidAction && <p className="ma-today-v4-caution"><span>今天先不要</span>{renderSafeText(publicTodayText(avoidAction))}</p>}
            </article>
          </div>
        </section>
        {!isReportForToday && (
          <div className="ma-section-inner px-4 pt-4 md:px-6"><span className="ma-badge ma-badge-danger">歷史資料：{fallbackReportDate || report.report_date}，今日為 {todayStr}</span></div>
        )}

        <div className="ma-pixel-content ma-today-v3-sections">
          <section className={`ma-today-v3-validation-card is-${validationState}`}>
            <header className="ma-today-v3-section-header"><div><p>目前卡住的原因</p><h2>下一步要補齊的證據</h2></div><strong>{validationProgressLabel}</strong></header>
            <div className={`ma-today-v3-checklist${validationItems.length === 1 ? ' is-single' : ''}`}>
              {validationItems.map((item, index) => (
                <article key={`${item.label}-${index}`} className={`is-${item.status}`}>
                  <small>步驟 {index + 1}</small>
                  <i className={item.status === 'confirmed' ? 'ri-checkbox-circle-fill' : item.status === 'failed' ? 'ri-close-circle-fill' : item.status === 'current' ? 'ri-loader-4-line' : 'ri-checkbox-blank-circle-line'} aria-hidden="true" />
                  <div><strong>{renderSafeText(item.label)}</strong>{item.detail && <p>{renderSafeText(item.detail)}</p>}</div>
                  <span>{validationStatusLabel(item.status)}</span>
                </article>
              ))}
            </div>
            {scriptProgress != null && <div className="ma-today-v3-validation-progress"><span style={{ width: `${scriptProgress}%` }} /></div>}
          </section>

          <section>
            <header className="ma-today-v3-section-header"><div><p>盤中證據</p><h2>市場即時資料</h2></div><span>{hasFreshIntradayRadar ? '盤中資料已同步' : '依目前可用資料'}</span></header>
            <div className="ma-today-v3-kpi-grid">
              {marketMetrics.map((metric) => (
                <article key={metric.label} className={`ma-today-v3-kpi-card is-${metric.priority}${metric.value === '尚未取得' ? ' is-missing' : ''}`}>
                  <i className={metric.icon} aria-hidden="true" />
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </article>
              ))}
            </div>
          </section>

          {focusStocks.length > 0 && (
            <section>
              <header className="ma-today-v3-section-header"><div><p>今日焦點</p><h2>今日重點股票</h2></div><Link to="/opportunities">查看完整名單<i className="ri-arrow-right-line" aria-hidden="true" /></Link></header>
              <div className={`ma-today-v3-stock-grid is-count-${Math.min(focusStocks.length, 3)}`}>
                {focusStocks.map((stock) => (
                  <Link key={`${stock.symbol}-${stock.name}`} to="/opportunities" className="ma-today-v3-stock-card">
                    <div><div><span>{stock.symbol}</span><h3>{stock.name}</h3></div>{stock.roleLabel && <b>{stock.roleLabel}</b>}</div>
                    {stock.displayHeadline && <p>{stock.displayHeadline}</p>}
                    {stock.displayObservation && <small><i className="ri-focus-3-line" aria-hidden="true" />{stock.displayObservation}</small>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {activeFailure && (
            <section className="ma-today-v3-correction-card">
              <header className="ma-today-v3-section-header"><div><p>劇本調整</p><h2>判斷修正</h2></div><span className={`is-${presentation.primaryDecision.state === 'STOP' ? 'danger' : 'warning'}`}>{presentation.primaryDecision.state === 'STOP' ? '已觸發' : '監控中'}</span></header>
              <div className="ma-today-v3-correction-flow">
                <div className="is-before">
                  <b>原判斷</b>
                  {activeFailure.trigger && <div><span>目前失敗原因</span><strong>{renderSafeText(publicTodayText(activeFailure.trigger))}</strong></div>}
                  {reduceWeight && <div><span>降低權重</span><strong>{renderSafeText(publicTodayText(reduceWeight))}</strong></div>}
                </div>
                <i className="ri-arrow-right-line" aria-hidden="true" />
                <div className="is-after">
                  <b>調整後</b>
                  {activeFailure.action && <div><span>調整方向</span><strong>{renderSafeText(publicTodayText(activeFailure.action))}</strong></div>}
                  {increaseWeight && <div><span>提高權重</span><strong>{renderSafeText(publicTodayText(increaseWeight))}</strong></div>}
                </div>
              </div>
              <footer><span>下一次確認</span><strong>{renderSafeText(nextDecisionTime)}</strong></footer>
            </section>
          )}

          <section>
            <header className="ma-today-v3-section-header"><div><p>決策進度</p><h2>只看上一個結果與下一個動作</h2></div></header>
            <div className="ma-today-v4-progress">
              {decisionMilestones.map((item) => (
                <article key={item.time} className={`is-${item.state}`}>
                  <p>{item.kicker}</p>
                  <div><i aria-hidden="true" /><strong>{item.time}｜{item.label}</strong></div>
                  <span>{runtimeTimelineStatusLabel(item.status)}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="ma-today-v4-next-links">
            <div><p>接著查看</p><span>把今天的判斷一路追蹤到收盤。</span></div>
            <nav aria-label="今日判斷後續頁面">
              <Link to="/war-room">盤中追蹤<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
              <Link to="/verification">收盤驗證<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
              <Link to="/performance">歷史績效<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
            </nav>
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
