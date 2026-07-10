/**
 * MorningAlphaDisplayState — SINGLE unified data contract for ALL frontend pages.
 *
 * This is the ONLY function that ALL 5 pages (home, today-report, opportunities,
 * war-room, member-note) must use to get their display data.
 *
 * RULES (locked):
 * 1. ai_strategy_json is the PRIMARY and ONLY data source
 * 2. report.market_bias / report.confidence_score (root columns) are ONLY fallbacks
 *    when ai_strategy_json does not exist at all
 * 3. If ai_strategy_json exists, root columns are NEVER used to override
 * 4. isMarketClosed is computed HERE, once, not in each page
 * 5. When isMarketClosed=true, all trading values are forced to neutral
 * 6. opening_market_radar may override marketBias/confidenceScore ONLY when it
 *    passes the true intraday freshness contract.
 */

import { resolveMarketStatus, type MarketStatusCode, type MarketStatusType, type SessionType } from '@/utils/tradingDay';
import { isFreshIntradayData } from '@/utils/intradayFreshness';

// ═══════════════════════════════════════════════════
// Output Type — FIXED STRUCTURE
// ═══════════════════════════════════════════════════

export interface MorningAlphaDisplayState {
  /** The report's date (YYYY-MM-DD) */
  reportDate: string;
  /** True when market is closed (holiday / weekend / non-trading day) */
  isMarketClosed: boolean;
  /** Holiday name if applicable, null otherwise */
  holidayName: string | null;
  /** Market bias — primary: ai_strategy_json.market_bias, fallback: report.market_bias. Forced to '休市' when isMarketClosed */
  marketBias: string;
  /** Confidence score — primary: ai_strategy_json.confidence_score, fallback: report.confidence_score. null when isMarketClosed */
  confidenceScore: number | null;
  /** Confidence label — display text for the confidence level. '休市不評分' when isMarketClosed */
  confidenceLabel: string;
  /** Today's quote / one-liner — forced to休市 message when isMarketClosed */
  todayQuote: string;
  /** Beneficiary stocks array — empty when isMarketClosed */
  beneficiaryStocks: Record<string, unknown>[];
  /** Member research note — null when isMarketClosed */
  memberResearchNote: string | Record<string, unknown> | null;
  /** Opening radar data — supplementary ONLY, null when isMarketClosed */
  openingRadar: Record<string, unknown> | null;
  /** Data basis label for display */
  dataBasisLabel: string;
  /** V9.0: Three-tier beneficiary — core stocks (3) */
  coreBeneficiaryStocks: Record<string, unknown>[];
  /** V9.0: Three-tier beneficiary — extended watchlist (5-8) */
  extendedWatchlist: Record<string, unknown>[];
  /** V9.0: Three-tier beneficiary — scenario watchlist (5-10) */
  scenarioWatchlist: Record<string, unknown>[];
  /** V9.0: Data status — sufficient / partial / insufficient */
  dataStatus: string;
  /** V9.0: Data basis explanation */
  dataBasisNote: string;
  /** V9.0: Causal overnight impact chains */
  causalOvernightImpactChains: Record<string, unknown>[];
  /** V10: True when the report explicitly enables the three-layer beneficiary model. */
  v10BeneficiaryEnabled: boolean;
  /** V10: Strong beneficiaries only. Empty means no positive-evidence strong beneficiary. */
  v10BeneficiaryStocks: Record<string, unknown>[];
  /** V10: Neutral observation watchlist. Not a beneficiary list. */
  v10ObservationWatchlist: Record<string, unknown>[];
  /** V10: Negative-evidence risk watchlist. Not a short recommendation. */
  v10RiskWatchlist: Record<string, unknown>[];
  /** V10: Data quality status for the three-layer beneficiary model. */
  v10DataQualityStatus: string;
  /** V10: Human-readable warning from the V10 sidecar. */
  v10Warning: string;
  /** The raw ai_strategy_json object (for pages that need additional fields) */
  rawAI: Record<string, unknown> | null;
  /** The raw report row (for pages that need root-level fields) */
  rawRow: Record<string, unknown> | null;
  /** P0: Canonical market status — independent of report data. Always reflects TODAY. */
  market_status: MarketStatusCode;
  /** P0: Canonical market date (YYYY-MM-DD). */
  market_date: string;
  /** P0: Canonical non-trading / trading message. */
  market_message: string;
  /** P0: Canonical next trading day (YYYY-MM-DD). */
  next_trading_day: string;
  /** P0.1: Canonical trading-day flag. */
  is_trading_day: boolean;
  /** P0.1: Canonical session type. */
  session_type: SessionType;
  /** Legacy status retained for older components while they migrate. */
  marketStatus: MarketStatusType;
  /** V10.0: Today's date (YYYY-MM-DD) — the actual current date, NOT the report date */
  currentDate: string;
  /** V10.0: Today's weekday in Chinese */
  currentWeekday: string;
  /** V10.0: Next trading date (YYYY-MM-DD) */
  nextTradingDate: string;
  /** V10.0: Next trading weekday in Chinese */
  nextTradingWeekday: string;
  /** V10.0: Human-readable next update time e.g. "2026-06-22（星期一）07:30" */
  nextUpdateTime: string;
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function grabStr(obj: Record<string, unknown> | null, ...keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

function grabNum(obj: Record<string, unknown> | null, key: string): number | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') { const n = Number(v); if (!Number.isNaN(n)) return n; }
  return null;
}

function grabArr(obj: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
  if (!obj) return [];
  const v = obj[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function grabObj(obj: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!obj) return null;
  const v = obj[key];
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function grabBool(obj: Record<string, unknown> | null, key: string): boolean {
  if (!obj) return false;
  const v = obj[key];
  return v === true || v === 'true';
}

function humanizeV10MarketSentence(
  sentence: string,
  v10Enabled: boolean,
  strong: Record<string, unknown>[],
  observation: Record<string, unknown>[],
  risk: Record<string, unknown>[],
): string {
  if (!v10Enabled) return sentence;
  const looksLikeRawAxis = /今天要驗證的是\s+[A-Z_]+\s+能否/.test(sentence) || /SEMICONDUCTOR|AI_SERVER|ELECTRONIC_BLUE_CHIP/.test(sentence);
  if (!looksLikeRawAxis) return sentence;

  const firstIndustry = (rows: Record<string, unknown>[]) => {
    const row = rows[0] || {};
    return String(row.industry_name || row.industry || row.sector || '').trim() || String(row.industry_code || '').trim() || '主要族群';
  };

  if (strong.length > 0) {
    return `今天先看資金是否集中到 ${firstIndustry(strong)}，再確認代表股是否同步轉強。`;
  }
  if (observation.length > 0) {
    return '今天還沒有足夠正向證據支持強受惠股，先觀察資金是否從觀察族群中擴散。';
  }
  if (risk.length > 0) {
    return '前夜資料對部分族群偏壓，今天先避免把風險族群誤判成受惠股。';
  }
  return sentence;
}

function getFreshRadarOverride(
  rawRow: Record<string, unknown> | null,
  openingRadar: Record<string, unknown> | null,
): { marketBias: string; confidenceScore: number | null } | null {
  if (!rawRow || !openingRadar) return null;
  const freshness = isFreshIntradayData(rawRow, openingRadar);
  if (!freshness.fresh) return null;

  const marketBias = grabStr(openingRadar, 'market_bias', 'radar_status');
  const confidenceScore = grabNum(openingRadar, 'confidence_score');
  if (!marketBias && confidenceScore === null) return null;

  return {
    marketBias: marketBias || '觀察中',
    confidenceScore,
  };
}

/**
 * Unified market-closed check.
 * Sources: ai_strategy_json.is_trading_day, market_closed, holiday_name, market_bias
 */
function computeIsMarketClosed(ai: Record<string, unknown> | null): { closed: boolean; holidayName: string | null } {
  if (!ai) return { closed: false, holidayName: null };

  const closed =
    ai.is_trading_day === false ||
    ai.market_closed === true ||
    !!ai.holiday_name ||
    ai.market_bias === '休市';

  return {
    closed,
    holidayName: closed ? ((ai.holiday_name as string) || null) : null,
  };
}

// ═══════════════════════════════════════════════════
// Main Function — THE ONLY FUNCTION PAGES SHOULD CALL
// ═══════════════════════════════════════════════════

export function getMorningAlphaDisplayState(
  rawRow: Record<string, unknown> | null,
  liveOpeningRadar: Record<string, unknown> | null = null,
): MorningAlphaDisplayState {
  const ai = (rawRow?.ai_strategy_json as Record<string, unknown>) || null;
  const reportDate = (rawRow?.report_date as string) || '—';
  const { closed, holidayName } = computeIsMarketClosed(ai);

  // P0: Canonical market status — ALWAYS reflects today, independent of report data
  const marketState = resolveMarketStatus();
  const currentDate = marketState.market_date;
  const currentWeekday = marketState.current_weekday;
  const isTodayNonTrading = marketState.market_status !== 'OPEN';
  const todayHolidayName = marketState.closed_reason;
  const nextTradingDate = marketState.next_trading_day;
  const nextTradingWeekday = marketState.next_trading_weekday;
  const nextUpdateTime = marketState.next_update_time;
  const legacyMarketStatus: MarketStatusType = marketState.market_status === 'OPEN'
    ? 'trading'
    : marketState.market_status === 'WEEKEND'
      ? 'weekend'
      : marketState.market_status === 'HOLIDAY'
        ? 'holiday'
        : 'special_closed';

  // V10.0: The effective display reason: prefer today's market status over report's holiday name
  // Example: today is Saturday, report is from Friday (端午節) → display "週末休市" not "端午節"
  const effectiveHolidayName = isTodayNonTrading
    ? (todayHolidayName || (marketState.market_status === 'WEEKEND' ? '週末休市' : holidayName))
    : holidayName;

  const effectiveMarketStatus = isTodayNonTrading
    ? legacyMarketStatus
    : 'trading' as MarketStatusType;

  // ── Market closed: force all trading values to neutral ──
  // Use today's Taipei trading status, not the active report date, so historical
  // fallback reports cannot overwrite weekend / holiday gates.
  if (closed || isTodayNonTrading) {
    return {
      reportDate: currentDate, // V10.0: Show TODAY's date, not last report date
      isMarketClosed: true,
      holidayName: effectiveHolidayName,
      marketBias: '休市',
      confidenceScore: null,
      confidenceLabel: '休市不評分',
      todayQuote: `今日台股休市${effectiveHolidayName ? `（${effectiveHolidayName}）` : ''}，不產生盤前交易判斷。`,
      beneficiaryStocks: [],
      memberResearchNote: `今日台股休市${effectiveHolidayName ? `（${effectiveHolidayName}）` : ''}，Morning Alpha 不產生盤前研究筆記。請於下一個台股交易日再查看完整盤前研究內容。`,
      openingRadar: null,
      dataBasisLabel: '休市',
      coreBeneficiaryStocks: [],
      extendedWatchlist: [],
      scenarioWatchlist: [],
      dataStatus: 'insufficient',
      dataBasisNote: '休市日不進行受惠股分析',
      causalOvernightImpactChains: [],
      v10BeneficiaryEnabled: false,
      v10BeneficiaryStocks: [],
      v10ObservationWatchlist: [],
      v10RiskWatchlist: [],
      v10DataQualityStatus: '',
      v10Warning: '',
      rawAI: ai,
      rawRow,
      market_status: marketState.market_status,
      market_date: marketState.market_date,
      market_message: marketState.market_message,
      next_trading_day: marketState.next_trading_day,
      is_trading_day: marketState.is_trading_day,
      session_type: marketState.session_type,
      marketStatus: effectiveMarketStatus,
      currentDate,
      currentWeekday,
      nextTradingDate,
      nextTradingWeekday,
      nextUpdateTime,
    };
  }

  // ── Trading day: ai_strategy_json is primary, root columns are fallback ONLY ──
  const aiExists = ai && Object.keys(ai).length > 0;

  const reportMarketBias = aiExists
    ? (grabStr(ai, 'market_bias') || (rawRow?.market_bias as string) || '觀察中')
    : ((rawRow?.market_bias as string) || '觀察中');

  const reportConfidenceScore = aiExists
    ? (grabNum(ai, 'confidence_score') ?? (rawRow?.confidence_score as number | null) ?? null)
    : ((rawRow?.confidence_score as number | null) ?? null);

  const radarOverride = getFreshRadarOverride(rawRow, liveOpeningRadar);
  const marketBias = radarOverride?.marketBias ?? reportMarketBias;
  const confidenceScore = radarOverride ? radarOverride.confidenceScore : reportConfidenceScore;

  const confidenceLabel = confidenceScore === null
    ? '休市不評分'
    : confidenceScore >= 75 ? '高' : confidenceScore >= 55 ? '中' : '低';

  const v8DailySentence = grabObj(ai, 'v8_daily_sentence');
  const publicSummary = grabObj(ai, 'public_summary') || grabObj(ai, 'free_summary');
  const v10BeneficiaryEnabled = aiExists ? grabBool(ai, 'v10_beneficiary_enabled') : false;
  const v10BeneficiaryStocks = aiExists ? grabArr(ai, 'today_beneficiary_stocks_v10') : [];
  const v10ObservationWatchlist = aiExists ? grabArr(ai, 'v10_observation_watchlist') : [];
  const v10RiskWatchlist = aiExists ? grabArr(ai, 'v10_risk_watchlist') : [];
  const v10DataQualityStatus = aiExists ? grabStr(ai, 'v10_data_quality_status') : '';
  const v10Warning = aiExists ? grabStr(ai, 'v10_warning') : '';
  const rawTodayQuote = aiExists
    ? (
        grabStr(v8DailySentence, 'sentence') ||
        grabStr(ai, 'daily_sentence', 'today_quote', 'today_sentence', 'summary') ||
        grabStr(publicSummary, 'daily_sentence', 'one_liner', 'one_sentence', 'summary') ||
        ''
      )
    : '';
  const todayQuote = humanizeV10MarketSentence(rawTodayQuote, v10BeneficiaryEnabled, v10BeneficiaryStocks, v10ObservationWatchlist, v10RiskWatchlist);

  const beneficiaryStocks = aiExists
    ? (v10BeneficiaryEnabled
        ? v10BeneficiaryStocks
        : [
            ...grabArr(ai, 'today_beneficiary_stocks'),
            ...grabArr(ai, 'beneficiary_stocks'),
            ...grabArr(publicSummary, 'beneficiary_stocks'),
          ])
    : [];

  // V9/V10: Three-tier beneficiary. When V10 is enabled, never let V9 masquerade as strong beneficiaries.
  const coreBeneficiaryStocks = aiExists
    ? (v10BeneficiaryEnabled ? v10BeneficiaryStocks : grabArr(ai, 'core_beneficiary_stocks'))
    : [];
  const extendedWatchlist = aiExists
    ? (v10BeneficiaryEnabled ? v10ObservationWatchlist : grabArr(ai, 'extended_watchlist'))
    : [];
  const scenarioWatchlist = aiExists
    ? (v10BeneficiaryEnabled ? v10RiskWatchlist : grabArr(ai, 'scenario_watchlist'))
    : [];
  const dataStatus = aiExists
    ? (v10BeneficiaryEnabled ? (v10DataQualityStatus || 'unknown') : (grabStr(ai, 'data_status') || 'unknown'))
    : 'unknown';
  const dataBasisNote = aiExists
    ? (v10BeneficiaryEnabled ? (v10Warning || grabStr(ai, 'data_basis_note') || '') : (grabStr(ai, 'data_basis_note') || ''))
    : '';

  // V9.0: Causal overnight impact chains
  const causalOvernightImpactChains = aiExists
    ? grabArr(ai, 'causal_overnight_impact_chains')
    : [];

  const memberResearchNote = aiExists
    ? ((ai.member_research_note as string | Record<string, unknown>) || null)
    : null;

  const openingRadar = liveOpeningRadar || (aiExists
    ? (
        grabObj(ai, 'opening_radar') ||
        grabObj(ai, 'intraday_tracking') ||
        grabObj(ai, 'intraday_radar')
      )
    : null);

  const dataBasisLabel = aiExists
    ? (grabStr(ai, 'tw_core_date', 'market_data_latest_date', 'data_basis') || reportDate)
    : reportDate;

  return {
    reportDate,
    isMarketClosed: false,
    holidayName: null,
    marketBias,
    confidenceScore,
    confidenceLabel,
    todayQuote,
    beneficiaryStocks,
    memberResearchNote,
    openingRadar,
    dataBasisLabel,
    coreBeneficiaryStocks,
    extendedWatchlist,
    scenarioWatchlist,
    dataStatus,
    dataBasisNote,
    causalOvernightImpactChains,
    v10BeneficiaryEnabled,
    v10BeneficiaryStocks,
    v10ObservationWatchlist,
    v10RiskWatchlist,
    v10DataQualityStatus,
    v10Warning,
    rawAI: ai,
    rawRow,
    market_status: marketState.market_status,
    market_date: marketState.market_date,
    market_message: marketState.market_message,
    next_trading_day: marketState.next_trading_day,
    is_trading_day: marketState.is_trading_day,
    session_type: marketState.session_type,
    marketStatus: effectiveMarketStatus,
    currentDate,
    currentWeekday,
    nextTradingDate,
    nextTradingWeekday,
    nextUpdateTime,
  };
}

/**
 * Legacy-compatible wrapper: same as getMorningAlphaDisplayState but accepts
 * a ReportRow from the adapter. Prefer getMorningAlphaDisplayState(rawRow) directly.
 */
export { getMorningAlphaDisplayState as getDisplayState };
