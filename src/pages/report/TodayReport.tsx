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
import { mapV11ObservationItems, type V11ObservationItem } from '@/components/v11/V11ObservationSection';
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

const MAIN_LINE_KEYWORDS = [
  '電子權值',
  'AI供應鏈',
  'AI伺服器',
  '半導體',
  '金融',
  '航運',
  '塑化',
  'PCB',
  'CCL',
  'IC設計',
  '高速傳輸',
  '散熱',
  '記憶體',
  '營建',
  '綠能',
  '鋼鐵',
  '生技',
];

function extractMainLineKeyword(value: unknown): string {
  const text = safeText(value, '');
  if (!text) return '';
  return MAIN_LINE_KEYWORDS.find((keyword) => text.includes(keyword)) || '';
}

function normalizeMainLine(value: string): string {
  const text = cleanScriptName(value);
  if (['PCB', 'CCL', 'IC設計', '高速傳輸', '散熱', '記憶體', 'AI伺服器'].includes(text)) return 'AI供應鏈';
  return text;
}

function inferMainLine(ai: AnyObj, displayState: MorningAlphaDisplayState | null, observations: V11ObservationItem[]): string {
  const thesis = asObj(asObj(ai.member_research_note_v2).opening_thesis);
  const strategySummary = asObj(ai.strategy_summary);
  const marketThesis = asObj(asObj(ai.v10_analysis_debug).market_thesis);
  const v10Thesis = asObj(marketThesis.market_thesis);
  const firstObservation = observations.find((item) => item.industryName || item.industryCode);
  const candidate = firstText(
    strategySummary.main_theme,
    strategySummary.primary_theme,
    strategySummary.market_focus,
    extractMainLineKeyword(strategySummary.summary),
    extractMainLineKeyword(strategySummary.today_strategy),
    extractMainLineKeyword(displayState?.todayQuote),
    extractMainLineKeyword(displayState?.actionGuidance),
    extractMainLineKeyword(v10Thesis.market_story),
    extractMainLineKeyword(v10Thesis.taiwan_transmission),
    v10Thesis.primary_driver,
    thesis.primary_theme,
    extractMainLineKeyword(thesis.market_story),
    firstObservation?.industryName,
    firstObservation?.industryCode,
    '等待主線確認',
  );

  return normalizeMainLine(candidate);
}

function inferActionStatus(bias: string, score: number | null | undefined, radar: RadarView | null, pendingTitle: string): string {
  const radarStatus = safeText(radar?.radar_status, '');
  if (radarStatus.includes('風險') || bias.includes('偏弱') || bias.includes('偏空')) return '不可追價';
  if (!radar) return pendingTitle.includes('尚未同步') ? '等待資金同步' : '等待量能確認';
  if (radarStatus.includes('偏強') && typeof score === 'number' && score >= 65) return '可觀察';
  if (radarStatus.includes('觀察') || bias.includes('觀察')) return '主線形成中';
  return '等待量能確認';
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
  sync: IntradaySyncView,
  closingState: ClosingVerificationState,
): VerificationFocus {
  const line = mainLine === '等待主線確認' ? '主線' : mainLine;
  const confirming = '2330、TAIEX、TXF 是否同向';
  const ifFailed = `不追價，${line} 未確認前維持觀察。`;
  const is0930Ready = sync.status0930 === 'ready' || Boolean(radar);
  const is1030Ready = sync.status1030 === 'ready';
  const is1300Ready = sync.status1300 === 'ready';

  if (minutes < 570) {
    return {
      currentStage: '等待開盤驗證',
      nextStep: '09:30 看 2330、TAIEX、TXF 是否同向',
      confirming,
      ifFailed,
      dataStatus: '09:30 尚未到時間窗',
      isSynced: is0930Ready,
    };
  }

  if (minutes < 630) {
    return {
      currentStage: is0930Ready ? '09:30 開盤驗證中' : '09:30 資料尚未同步',
      nextStep: '10:30 看主線是否擴散',
      confirming,
      ifFailed,
      dataStatus: is0930Ready ? '09:30 已同步，10:30 尚未到時間窗' : pendingTitle,
      isSynced: is0930Ready,
    };
  }

  if (minutes < 780) {
    return {
      currentStage: is1030Ready ? '10:30 主線確認已同步' : '10:30 資料尚未同步',
      nextStep: '13:00 看是否失效',
      confirming: `${line} 是否從代表股擴散到同族群`,
      ifFailed,
      dataStatus: is1030Ready ? '10:30 已同步，13:00 尚未到時間窗' : '10:30 資料尚未同步，13:00 尚未到時間窗',
      isSynced: is1030Ready,
    };
  }

  if (minutes < 850) {
    return {
      currentStage: is1300Ready ? '13:00 風險確認已同步' : '13:00 資料尚未同步',
      nextStep: '14:10 等待收盤資料同步',
      confirming: `${line} 是否守住盤中確認條件`,
      ifFailed,
      dataStatus: is1300Ready ? '13:00 已同步，等待收盤資料' : '13:00 資料尚未同步，等待收盤資料',
      isSynced: is1300Ready,
    };
  }

  return {
    currentStage: closingState.label,
    nextStep: closingState.nextStep,
    confirming: `${line} 是否延續到收盤`,
    ifFailed: '收盤驗證未完成前，不把盤中反彈當成確認。',
    dataStatus: closingState.label,
    isSynced: closingState.completed,
  };
}

type TradingScript = {
  name: string;
  why: string;
  representatives: string;
  status: string;
  condition: string;
  invalidation: string;
  closeResult: string;
  tomorrowAction: string;
};

function cleanScriptName(value: string): string {
  const text = value.trim();
  const map: Record<string, string> = {
    SEMICONDUCTOR: '半導體',
    AI_SERVER: 'AI供應鏈',
    ELECTRONIC_BLUE_CHIP: '電子權值',
    PCB: 'PCB',
    CCL: 'CCL',
    IC_DESIGN: 'IC設計',
    HIGH_SPEED_TRANSMISSION: '高速傳輸',
    THERMAL: '散熱',
    MEMORY: '記憶體',
  };
  return map[text] || text.replace(/_/g, ' ');
}

function scriptNameFromItem(item: V11ObservationItem): string {
  const chainTheme = item.observationChain.find((part) => {
    const text = safeText(part, '');
    return text && !text.includes(item.symbol) && !text.includes(item.name);
  });
  return cleanScriptName(firstText(item.industryName, item.industryCode, chainTheme, '今日主線'));
}

function compactSentence(value: string, fallback: string): string {
  const text = safeText(value, fallback);
  return text
    .replace(/\s+/g, ' ')
    .replace(/。.*$/, '。')
    .trim();
}

function flattenReadableText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return safeText(value, '');
  if (Array.isArray(value)) return value.map(flattenReadableText).filter(Boolean).join('。');
  if (value && typeof value === 'object') {
    return Object.values(value as AnyObj).map(flattenReadableText).filter(Boolean).join('。');
  }
  return '';
}

function collectRelatedLines(source: unknown, scriptName: string, representatives: string[]): string[] {
  const rows = Array.isArray(source) ? source : Object.values(asObj(source));
  const needles = [scriptName, ...representatives.map((item) => item.split(' ')[0]).filter(Boolean)]
    .filter(Boolean)
    .map((item) => item.toLowerCase());
  const lines: string[] = [];

  for (const row of rows) {
    const text = flattenReadableText(row);
    if (!text) continue;
    const lower = text.toLowerCase();
    if (needles.length > 0 && !needles.some((needle) => lower.includes(needle))) continue;
    lines.push(text);
  }

  return uniqueBy(lines, (line) => line).slice(0, 3);
}

function deriveScriptSupport(ai: AnyObj, scriptName: string, representatives: string[]) {
  const note = asObj(ai.member_research_note_v2);
  const intradayTracking = asObj(ai.intraday_tracking);
  const validation = asObj(ai.validation);
  const openingRadar = asObj(ai.opening_radar);

  return {
    why: collectRelatedLines(
      [
        note.first_beneficiary_stock,
        note.beneficiary_reasoning,
        note.capital_rotation_scenarios,
        note.opening_thesis,
        ai.v8_beneficiary_chain,
      ],
      scriptName,
      representatives,
    )[0],
    condition: collectRelatedLines(
      [
        note.intraday_time_windows,
        note.intraday_validation,
        intradayTracking,
        validation,
        openingRadar,
      ],
      scriptName,
      representatives,
    )[0],
    invalidation: collectRelatedLines(
      [
        note.invalidation_conditions,
        note.invalidation_rules,
        note.risk_scenarios,
        ai.risk_analysis,
      ],
      scriptName,
      representatives,
    )[0],
  };
}

function normalizeCloseResult(value: unknown): string {
  const text = safeText(value, '').toLowerCase();
  if (text.includes('hit') || text.includes('命中') || text.includes('confirmed')) return '成立';
  if (text.includes('partial') || text.includes('mixed') || text.includes('部分')) return '待確認';
  if (text.includes('miss') || text.includes('failed') || text.includes('失準')) return '未成立';
  return '';
}

function buildCloseScriptOutcome(ai: AnyObj, representatives: string[]): { closeResult: string; tomorrowAction: string } {
  const closing = Object.keys(asObj(ai.closing_verification_v2)).length > 0
    ? asObj(ai.closing_verification_v2)
    : asObj(ai.closing_verification);
  const listValidation = asObj(closing.beneficiary_list_validation);
  const items = Array.isArray(listValidation.items) ? listValidation.items.map(asObj) : [];
  const repSymbols = representatives
    .map((item) => item.split(' ')[0]?.trim())
    .filter(Boolean);
  const matched = items.filter((item) => repSymbols.includes(safeText(item.symbol, '')));
  const completeMatched = matched.filter((item) => safeText(item.data_status, '') === 'complete');

  if (completeMatched.length > 0) {
    const outperformed = completeMatched.filter((item) => item.outperformed_taiex === true).length;
    if (outperformed === completeMatched.length) return { closeResult: '成立', tomorrowAction: '延續觀察' };
    if (outperformed === 0) return { closeResult: '未成立', tomorrowAction: '降級觀察' };
    return { closeResult: '待確認', tomorrowAction: '降級觀察' };
  }

  const overall = normalizeCloseResult(closing.hit_or_miss || closing.status);
  if (overall === '成立') return { closeResult: '成立', tomorrowAction: '延續觀察' };
  if (overall === '未成立') return { closeResult: '未成立', tomorrowAction: '降級觀察' };
  return { closeResult: '待確認', tomorrowAction: '降級觀察' };
}

function buildTradingScripts(
  items: V11ObservationItem[],
  statusText: string,
  ai: AnyObj,
  limit = 3,
): TradingScript[] {
  const grouped = new Map<string, V11ObservationItem[]>();
  for (const item of items) {
    const name = scriptNameFromItem(item);
    const current = grouped.get(name) || [];
    current.push(item);
    grouped.set(name, current);
  }

  return Array.from(grouped.entries())
    .map(([name, group]) => {
      const representatives = uniqueBy(
        group
          .map((item) => [item.symbol, item.name].filter(Boolean).join(' ').trim())
          .filter(Boolean),
        (value) => value,
      ).slice(0, 2);
      const primary = group[0];
      const support = deriveScriptSupport(ai, name, representatives);
      const why = compactSentence(
        firstText(primary.observationReason, support.why),
        `${name}還沒轉成強主線，今天先看資金是否願意靠過來。`,
      );
      const condition = compactSentence(
        firstText(primary.confirmationPendingReason, support.condition),
        '需要代表股與大盤同向，且族群量能同步擴散。',
      );
      const invalidation = compactSentence(
        firstText(primary.stopObservingCondition, support.invalidation),
        '若開盤後沒有量能或代表股無法站穩，今天放棄。',
      );
      const outcome = buildCloseScriptOutcome(ai, representatives);

      return {
        name,
        why,
        representatives: representatives.join(' / ') || '待確認代表股',
        status: primary.confirmationPendingReason ? '等待盤中確認' : statusText,
        condition,
        invalidation,
        closeResult: outcome.closeResult,
        tomorrowAction: outcome.tomorrowAction,
      };
    })
    .filter((item) => item.name && item.why)
    .slice(0, limit);
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
  // V8.4: Unified display state — marketBias and confidenceScore from getMorningAlphaDisplayState
  // Same values as Home, Opportunities, WarRoom, MemberNote. No opening_radar override.
  const displayBias = displayState?.marketBias || '—';
  const intradayFreshness = useMemo(() => isFreshIntradayData(report as AnyObj | null, liveRadar as AnyObj | null), [report, liveRadar]);
  const hasFreshIntradayRadar = intradayFreshness.fresh;
  const premarketBiasLabel = safeText(displayBias, '待判斷');
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
  const intradayPendingTitle = taipeiMinutes < 570
    ? '等待 09:30 第一段盤中資料'
    : taipeiMinutes < 630
      ? '09:30 盤中資料尚未同步'
      : taipeiMinutes < 780
        ? '10:30 資料尚未同步，13:00 尚未到時間窗'
        : taipeiMinutes < 815
          ? '13:00 盤中資料尚未同步'
          : '等待收盤驗證資料同步';
  const intradayPendingDescription = taipeiMinutes >= 815
    ? '已進入收盤驗證等待區間，收盤驗證完成前不視為已完成。'
    : taipeiMinutes >= 630
      ? '已過盤中驗證時間窗，缺少資料時會明確標示尚未同步，不視為系統已完成。'
      : '目前先保留盤前方向，盤中時間窗會在資料同步後更新；待驗證不代表已完成。';
  const overviewBiasText = premarketBiasLabel;
  const displayScore = scoreTone(displayState?.confidenceScore);
  const overviewScoreText = displayState?.confidenceScore != null
    ? `${displayScore.stars} ${displayScore.label}`
    : '待驗證';
  const v11ObservationScripts = mapV11ObservationItems(ai.v10_observation_watchlist || displayState?.v10ObservationWatchlist, 5);
  const intradaySyncView = getIntradaySyncView(ai);
  const closingVerificationState = getClosingVerificationState(ai);
  const mainLine = inferMainLine(ai, displayState, v11ObservationScripts);
  const actionStatus = inferActionStatus(overviewBiasText, displayState?.confidenceScore, activeIntradayRadar, intradayPendingTitle);
  const nextVerification = nextVerificationPoint(taipeiMinutes, activeIntradayRadar, intradaySyncView, closingVerificationState);
  const operationSteps = buildOperationSteps(mainLine, nextVerification, actionStatus);
  const verificationFocus = buildVerificationFocus(
    taipeiMinutes,
    activeIntradayRadar,
    mainLine,
    intradayPendingTitle,
    intradaySyncView,
    closingVerificationState,
  );
  const overviewRadarStatusText = verificationFocus.dataStatus;
  const overviewSyncText = verificationFocus.dataStatus;
  const tradingScripts = buildTradingScripts(v11ObservationScripts, verificationFocus.currentStage, ai);

  const marketDataBasisDate =
    safeText(ai.market_data_latest_date || ai.tw_core_date || report?.report_date, '—');
  const marketDataBasisLabel = marketDataBasisDate === report?.report_date
    ? `${marketDataBasisDate} 資料基準`
    : `${marketDataBasisDate} 收盤`;

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
              今天該怎麼做
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
              {isHistoricalFallback ? '歷史劇本驗證結果' : '今日劇本驗證結果'}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {closingVerificationState.completed && tradingScripts.length > 0 ? (
                tradingScripts.slice(0, 3).map((item) => (
                  <article key={item.name} className="p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h3 className="text-slate-50 font-bold text-base leading-snug">{renderSafeText(item.name)}</h3>
                        <p className="text-slate-400 text-xs mt-1">{renderSafeText(item.representatives)}</p>
                      </div>
                      <span className={`shrink-0 px-2 py-1 rounded-full border text-[10px] font-semibold ${
                        item.closeResult === '成立'
                          ? 'bg-emerald-500/12 text-emerald-300 border-emerald-400/30'
                          : item.closeResult === '未成立'
                            ? 'bg-red-500/12 text-red-300 border-red-400/30'
                            : 'bg-amber-500/12 text-amber-300 border-amber-400/30'
                      }`}>
                        收盤結果：{item.closeResult}
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <p className="text-slate-500 text-[10px] mb-1">驗證重點</p>
                        <p className="text-slate-300 text-sm leading-relaxed">{renderSafeText(item.condition)}</p>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 border border-slate-700/60 px-3 py-2">
                        <span className="text-slate-500 text-[10px]">明日是否延續</span>
                        <span className="text-slate-100 text-xs font-semibold">{renderSafeText(item.tomorrowAction)}</span>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="md:col-span-3 flex gap-3 p-4 rounded-xl bg-slate-800/70 border border-slate-700/70">
                  <i className="ri-database-2-line text-slate-300 text-sm mt-0.5"></i>
                  <p className="text-slate-200 text-sm leading-relaxed">收盤驗證資料不足，明日降級觀察。</p>
                </div>
              )}
            </div>
          </section>

          <section className="bg-navy-900/70 border border-navy-800 rounded-2xl p-5 md:p-6 text-center">
            <Link
              to="/member-note"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-colors"
            >
              查看完整研究筆記
              <i className="ri-arrow-right-line" />
            </Link>
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
