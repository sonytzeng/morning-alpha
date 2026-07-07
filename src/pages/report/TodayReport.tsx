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
import PaywallCard from '@/components/paywall/PaywallCard';
import { mapV11ObservationItems, type V11ObservationItem } from '@/components/v11/V11ObservationSection';
import { isFreshIntradayData } from '@/utils/intradayFreshness';
import { getTodayOpeningRadar } from '@/services/openingRadarService';
import { buildEntitlementFromTier, hasFeature } from '@/services/entitlementService';
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
  data_status?: string;
  missing_sources?: string[];
  radar_mode?: string;
  txf_status?: string;
  input_source?: string;
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


function scoreTone(score: unknown): { stars: string; label: string; raw: string } {
  const numeric = Number(score);
  const raw = Number.isFinite(numeric) ? `${Math.round(numeric)}/100` : '';
  if (!Number.isFinite(numeric)) return { stars: '☆☆☆☆☆', label: '待驗證', raw };
  if (numeric >= 80) return { stars: '★★★★★', label: '高把握', raw };
  if (numeric >= 65) return { stars: '★★★★☆', label: '中高把握', raw };
  if (numeric >= 50) return { stars: '★★★☆☆', label: '觀察', raw };
  if (numeric >= 35) return { stars: '★★☆☆☆', label: '低把握', raw };
  return { stars: '★☆☆☆☆', label: '僅供觀察', raw };
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

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => safeText(item, '')).filter(Boolean);
  const text = safeText(value, '');
  return text ? [text] : [];
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFor(item).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function inferMainLine(ai: AnyObj, displayState: MorningAlphaDisplayState | null, observations: V11ObservationItem[]): string {
  const thesis = asObj(asObj(ai.member_research_note_v2).opening_thesis);
  const strategySummary = asObj(ai.strategy_summary);
  const marketThesis = asObj(asObj(ai.v10_analysis_debug).market_thesis);
  const v10Thesis = asObj(marketThesis.market_thesis);
  const firstObservation = observations.find((item) => item.industryName || item.industryCode);

  return firstText(
    strategySummary.main_theme,
    strategySummary.primary_theme,
    strategySummary.market_focus,
    v10Thesis.primary_driver,
    thesis.primary_theme,
    thesis.market_story,
    firstObservation?.industryName,
    firstObservation?.industryCode,
    displayState?.actionGuidance,
    '等待主線確認',
  );
}

function inferActionStatus(bias: string, score: number | null | undefined, radar: RadarView | null, pendingTitle: string): string {
  const radarStatus = safeText(radar?.radar_status, '');
  if (radarStatus.includes('風險') || bias.includes('偏弱') || bias.includes('偏空')) return '風險升高';
  if (!radar) return pendingTitle.includes('尚未同步') ? '等待確認' : '等待驗證';
  if (radarStatus.includes('偏強') && typeof score === 'number' && score >= 65) return '可小量觀察';
  if (radarStatus.includes('觀察') || bias.includes('觀察')) return '等待確認';
  return '不追價';
}

function nextVerificationPoint(minutes: number, radar: RadarView | null): string {
  if (minutes < 570) return '09:30 看 2330 與電子量能';
  if (minutes < 630) return radar ? '10:30 看主線是否擴散' : '09:30 開盤驗證資料同步';
  if (minutes < 780) return '13:00 看主線是否失效';
  if (minutes < 850) return '14:10 等待收盤資料同步';
  return '收盤後看驗證結果';
}

function buildOperationSteps(
  mainLine: string,
  nextPoint: string,
  actionStatus: string,
): string[] {
  const line = mainLine === '等待主線確認' ? '今日主線' : mainLine;
  const conservative = actionStatus === '風險升高' || actionStatus === '不追價';

  return [
    `先看 ${nextPoint.replace(/^09:30 看 /, '').replace(/^10:30 看 /, '')}。`,
    conservative ? `再確認 ${line} 是否止穩，不把反彈直接當成轉強。` : `再看 ${line} 是否從代表股擴散到同族群。`,
    '未確認前不追價。',
    '13:00 前若未擴散，今日維持觀察。',
  ];
}

type VerificationFocus = {
  currentStage: string;
  nextStep: string;
  confirming: string;
  ifFailed: string;
  dataStatus: string;
  isSynced: boolean;
};

function buildVerificationFocus(
  minutes: number,
  radar: RadarView | null,
  mainLine: string,
  pendingTitle: string,
): VerificationFocus {
  const line = mainLine === '等待主線確認' ? '主線' : mainLine;
  const confirming = '2330、TAIEX、TXF 是否同向';
  const ifFailed = `不追價，${line} 未確認前維持觀察。`;

  if (minutes < 570) {
    return {
      currentStage: '等待開盤驗證',
      nextStep: '09:30 看 2330、TAIEX、TXF 是否同向',
      confirming,
      ifFailed,
      dataStatus: '09:30 尚未到時間窗',
      isSynced: Boolean(radar),
    };
  }

  if (minutes < 630) {
    return {
      currentStage: radar ? '09:30 開盤驗證中' : '09:30 資料尚未同步',
      nextStep: '10:30 看主線是否擴散',
      confirming,
      ifFailed,
      dataStatus: radar ? '09:30 已同步，10:30 尚未到時間窗' : pendingTitle,
      isSynced: Boolean(radar),
    };
  }

  if (minutes < 780) {
    return {
      currentStage: '10:30 主線確認中',
      nextStep: '13:00 看是否失效',
      confirming: `${line} 是否從代表股擴散到同族群`,
      ifFailed,
      dataStatus: radar ? '13:00 尚未到時間窗' : pendingTitle,
      isSynced: Boolean(radar),
    };
  }

  if (minutes < 850) {
    return {
      currentStage: '13:00 風險確認中',
      nextStep: '14:10 等待收盤資料同步',
      confirming: `${line} 是否守住盤中確認條件`,
      ifFailed,
      dataStatus: radar ? '等待收盤資料同步' : pendingTitle,
      isSynced: Boolean(radar),
    };
  }

  return {
    currentStage: '等待收盤驗證',
    nextStep: '收盤後確認今日判斷是否成立',
    confirming: `${line} 是否延續到收盤`,
    ifFailed: '收盤驗證未完成前，不把盤中反彈當成確認。',
    dataStatus: radar ? '等待收盤資料同步' : pendingTitle,
    isSynced: Boolean(radar),
  };
}

type VerificationQuestion = {
  question: string;
  representative: string;
  status: string;
  condition: string;
  invalidation: string;
};

function questionTitle(item: V11ObservationItem): string {
  const chainTheme = item.observationChain.find((part) => part && !part.includes(item.symbol) && !part.includes(item.name));
  if (chainTheme) return `${chainTheme}能不能接住資金？`;
  if (item.industryName) return `${item.industryName}能不能接棒？`;
  return '今天有沒有新主線？';
}

function buildVerificationQuestions(
  items: V11ObservationItem[],
  statusText: string,
  limit = 5,
): VerificationQuestion[] {
  const questions = items
    .map((item) => ({
      question: questionTitle(item),
      representative: [item.symbol, item.name].filter(Boolean).join(' ') || '待確認代表股',
      status: item.confirmationPendingReason ? '等待盤中確認' : statusText,
      condition: item.confirmationPendingReason || '需要代表股與大盤同向，且族群量能同步擴散。',
      invalidation: item.stopObservingCondition || '若開盤後沒有量能或代表股無法站穩，今日不列為強主線。',
    }))
    .filter((item) => item.question && item.condition);

  return uniqueBy(
    questions,
    (item) => `${item.question}|${item.condition}|${item.invalidation}`,
  ).slice(0, limit);
}

type OvernightChainView = {
  key: string;
  event: string;
  sector: string;
  representative: string;
  validation: string;
  invalidation: string;
};

function buildOvernightChainViews(chain: unknown): OvernightChainView[] {
  const rows = Array.isArray(chain)
    ? asArray(chain)
    : asArray(asObj(chain).chains || asObj(chain).items || asObj(chain).events);

  const mapped = rows.map((row) => {
    const chainParts = textList(row.chain || row.transmission_chain || row.observation_chain);
    const event = firstText(row.event, row.event_title, row.chain_title, row.main_theme, chainParts[0], '前夜事件待整理');
    const sector = firstText(row.sector, row.industry_name, row.industry, row.impact_sector, chainParts[1], '影響族群待確認');
    const representative = firstText(row.representative_stock, row.stock, row.symbol && row.name ? `${row.symbol} ${row.name}` : '', chainParts[2], '代表股待確認');
    const validation = firstText(row.validation, row.intraday_validation, row.validation_signal, row.watch_point, '盤中先看代表股與族群量能是否同步。');
    const invalidation = firstText(row.invalidation, row.invalidation_condition, row.stop_condition, '若代表股無法站穩或族群未擴散，今日先降權。');
    const key = firstText(row.event_key, row.sector, row.chain_title, row.main_theme, `${event}|${sector}`);
    return { key, event, sector, representative, validation, invalidation };
  });

  return uniqueBy(mapped, (item) => item.key).slice(0, 4);
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
        setEntitlement(buildEntitlementFromTier(resolved.tier));
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
        setLiveRadar((radarFromTable as unknown as RadarView | null) || radarFromReport);
        setDisplayState(getMorningAlphaDisplayState(
          resolved.rawRow as Record<string, unknown> | null,
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
  const parsedStrategy = useMemo(() => parseAIStrategy(report), [report]);

  // V8.4: Unified display state — marketBias and confidenceScore from getMorningAlphaDisplayState
  // Same values as Home, Opportunities, WarRoom, MemberNote. No opening_radar override.
  const displayBias = displayState?.marketBias || '—';
  const intradayFreshness = useMemo(() => isFreshIntradayData(report as AnyObj | null, liveRadar as AnyObj | null), [report, liveRadar]);
  const hasFreshIntradayRadar = intradayFreshness.fresh;
  const premarketBiasLabel = safeText(displayBias, '待判斷');
  const activeIntradayRadar = hasFreshIntradayRadar ? liveRadar : null;
  const effectiveIntradayRadar = activeIntradayRadar;
  const publicSummary = asObj(ai.public_summary) || asObj(ai.free_summary);
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
  const intradayPendingTitle = taipeiMinutes < 570
    ? '等待 09:30 第一段盤中資料'
    : taipeiMinutes < 630
      ? '09:30 盤中資料尚未同步'
      : taipeiMinutes < 780
        ? '10:30 資料尚未同步，13:00 尚未到時間窗'
        : taipeiMinutes < 815
          ? '13:00 盤中資料尚未同步'
          : '等待收盤資料同步';
  const intradayPendingDescription = taipeiMinutes >= 815
    ? '已進入收盤資料等待區間，盤中時間窗仍未完整同步；收盤驗證完成前不視為已完成。'
    : taipeiMinutes >= 630
      ? '已過盤中驗證時間窗，缺少資料時會明確標示尚未同步，不視為系統已完成。'
      : '目前先保留盤前方向，盤中時間窗會在資料同步後更新；待驗證不代表已完成。';
  const overviewRadarStatusText = activeIntradayRadar
    ? safeText(activeIntradayRadar.radar_status, '觀察中')
    : intradayPendingTitle;
  const overviewBiasText = premarketBiasLabel;
  const displayScore = scoreTone(displayState?.confidenceScore);
  const overviewScoreText = displayState?.confidenceScore != null
    ? `${displayScore.stars} ${displayScore.label}`
    : '待驗證';
  const overviewSyncText = activeIntradayRadar
    ? `已同步：${overviewRadarStatusText}`
    : intradayPendingTitle;
  const v10BeneficiaryEnabled = displayState?.v10BeneficiaryEnabled === true || ai.v10_beneficiary_enabled === true || ai.v10_beneficiary_enabled === 'true';
  const v11ObservationScripts = mapV11ObservationItems(ai.v10_observation_watchlist || displayState?.v10ObservationWatchlist, 5);
  const mainLine = inferMainLine(ai, displayState, v11ObservationScripts);
  const actionStatus = inferActionStatus(overviewBiasText, displayState?.confidenceScore, activeIntradayRadar, intradayPendingTitle);
  const nextVerification = nextVerificationPoint(taipeiMinutes, activeIntradayRadar);
  const operationSteps = buildOperationSteps(mainLine, nextVerification, actionStatus);
  const verificationFocus = buildVerificationFocus(taipeiMinutes, activeIntradayRadar, mainLine, intradayPendingTitle);
  const verificationQuestions = buildVerificationQuestions(v11ObservationScripts, activeIntradayRadar ? `觀察中：${overviewRadarStatusText}` : intradayPendingTitle);
  const overnightChainViews = buildOvernightChainViews(parsedStrategy.v8_overnight_causal_chain);
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
      ...asArray(publicSummary.beneficiary_stocks),
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
              {isHistoricalFallback ? '歷史操作總覽' : '今日操作總覽'}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">今日方向</p>
                <p className="text-slate-50 font-bold text-base">{overviewBiasText}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">今日操作狀態</p>
                <p className="text-slate-50 font-bold text-base">{actionStatus}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">今日主線</p>
                <p className="text-slate-50 font-bold text-base">{renderSafeText(mainLine)}</p>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/70 border border-slate-700/70">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">下一個驗證點</p>
                <p className="text-slate-50 font-bold text-base">{nextVerification}</p>
              </div>

              <div className="p-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/20 sm:col-span-2 lg:col-span-4">
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
                  <div>
                    <p className="text-sky-300 text-[10px] uppercase tracking-wider mb-0.5">判斷把握度</p>
                    <p className="text-sky-100 text-xs font-semibold">{overviewScoreText}</p>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-slate-500 text-[10px] mt-3 leading-relaxed">
              今日判斷頁只回答今天怎麼做。完整推理、受惠股與收盤回測，請到完整研究筆記查看。
            </p>
          </section>

          <section className="bg-navy-900/70 border border-emerald-500/15 rounded-2xl p-5 md:p-6">
            <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
              今天操作策略
            </h2>
            <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {operationSteps.map((step, index) => (
                  <div key={`${step}-${index}`} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/12 border border-emerald-400/25 text-emerald-200 text-xs font-bold flex items-center justify-center shrink-0">
                      {index + 1}
                    </div>
                    <p className="text-slate-200 text-sm leading-relaxed">{renderSafeText(step)}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-navy-900/70 border border-cyan-500/20 rounded-2xl p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">
                目前驗證焦點
              </h2>
              <span className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-full border ${getRadarClass(overviewRadarStatusText)}`}>
                <i className="ri-radar-line" />
                {overviewRadarStatusText}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {[
                  { label: '目前階段', value: verificationFocus.currentStage },
                  { label: '下一步', value: verificationFocus.nextStep },
                  { label: '正在確認', value: verificationFocus.confirming },
                  { label: '若失敗', value: verificationFocus.ifFailed },
                  { label: '資料狀態', value: verificationFocus.dataStatus },
                ].map((item) => (
                  <div key={item.label} className="min-w-0">
                    <p className="text-cyan-300 text-[10px] font-semibold mb-1">{item.label}</p>
                    <p className="text-slate-200 text-sm leading-relaxed">{renderSafeText(item.value)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-xl bg-sky-500/[0.06] border border-sky-500/20 px-4 py-3">
              <p className="text-sky-200 text-xs leading-relaxed">
                {verificationFocus.isSynced
                  ? `資料已同步${intradayFreshness.timestampLabel ? `：${intradayFreshness.timestampLabel}` : ''}。`
                  : '資料尚未同步，系統會在下一個驗證點更新。'}
              </p>
            </div>
          </section>

          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6">
            <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
              {isHistoricalFallback ? '歷史待驗證問題' : '今日五個待驗證問題'}
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {verificationQuestions.length > 0 ? (
                verificationQuestions.map((item, idx) => (
                  <article key={`${item.question}-${idx}`} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">問題 {idx + 1}</p>
                        <h3 className="text-slate-50 font-bold text-base leading-snug">{renderSafeText(item.question)}</h3>
                      </div>
                      <span className="shrink-0 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-400/20 px-2 py-0.5 rounded-full">
                        待驗證
                      </span>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-slate-500 text-[10px] mb-1">代表股</p>
                        <p className="text-slate-200 text-sm font-semibold">{renderSafeText(item.representative)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] mb-1">目前狀態</p>
                        <p className="text-slate-300 text-sm leading-relaxed">{renderSafeText(item.status)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] mb-1">觀察條件</p>
                        <p className="text-slate-300 text-sm leading-relaxed">{renderSafeText(item.condition)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[10px] mb-1">失效條件</p>
                        <p className="text-slate-300 text-sm leading-relaxed">{renderSafeText(item.invalidation)}</p>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="lg:col-span-2 flex gap-3 p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <i className="ri-database-2-line text-slate-300 text-sm mt-0.5"></i>
                  <p className="text-slate-200 text-sm leading-relaxed">目前尚未形成高品質待驗證問題，等待盤中或收盤資料完成。</p>
                </div>
              )}
            </div>
          </section>

          {!v10BeneficiaryEnabled && beneficiaryStocks.length > 0 && canViewTodayReportFull && (
            <section className="bg-navy-900/70 border border-amber-500/15 rounded-2xl p-5 md:p-6">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold">
                  {isHistoricalFallback ? '歷史資金觀察' : '今日資金觀察'}
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
            </section>
          )}

          {!v10BeneficiaryEnabled && beneficiaryStocks.length > 0 && !canViewTodayReportFull && (
            <PaywallCard
              title="升級會員查看完整盤前研究鏈"
              description={`今日已追蹤 ${beneficiaryStocks.length} 檔資金觀察股。完整推理、盤中驗證、失效條件與收盤回測，已收在會員版。`}
              requiredTier="member"
              featureList={['完整今日受惠股', '受惠推理與驗證訊號', '失效條件與風險提醒']}
              tone="dark"
            />
          )}

          {canViewTodayReportFull ? (
            <>
              <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6">
                <h2 className="text-slate-100 text-[10px] uppercase tracking-[0.3em] font-semibold mb-4">
                  前夜事件傳導鏈
                </h2>

                {overnightChainViews.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {overnightChainViews.map((item) => (
                      <article key={item.key} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                        <div className="space-y-3">
                          <div>
                            <p className="text-slate-500 text-[10px] mb-1">前夜事件</p>
                            <p className="text-slate-100 text-sm font-semibold">{renderSafeText(item.event)}</p>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <p className="text-slate-500 text-[10px] mb-1">影響族群</p>
                              <p className="text-slate-300 text-sm">{renderSafeText(item.sector)}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 text-[10px] mb-1">今天代表股</p>
                              <p className="text-slate-300 text-sm">{renderSafeText(item.representative)}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-slate-500 text-[10px] mb-1">今天怎麼驗證</p>
                            <p className="text-slate-300 text-sm leading-relaxed">{renderSafeText(item.validation)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-[10px] mb-1">失效條件</p>
                            <p className="text-slate-300 text-sm leading-relaxed">{renderSafeText(item.invalidation)}</p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <p className="text-slate-300 text-sm leading-relaxed">前夜事件傳導鏈尚未整理完成，先以今日操作總覽與待驗證問題為主。</p>
                  </div>
                )}
              </section>

              <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6 text-center">
                <h2 className="text-white font-bold text-base mb-3">下一步</h2>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xl mx-auto mb-5">
                  今日判斷先看操作方向與下一個驗證點；完整推理、失效條件與收盤回測請進完整研究筆記。
                </p>

                <div className="flex justify-center">
                  <Link
                    to="/member-note"
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors"
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
              description="會員可查看 前夜事件傳導鏈、盤中驗證、失效條件與完整收盤回測，不只看方向，也看判斷如何被驗證。"
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
