/**
 * Compatibility display shape for existing subscribers.
 * SubscriberReportProjection owns status, identity, confidence and recommendations.
 * The calendar describes today's session only; it never relabels a historical report.
 */
import { resolveMarketStatus, type MarketStatusCode, type MarketStatusType, type SessionType } from '@/utils/tradingDay';
import { getSubscriberReportProjection, subscriberObservationSources } from './subscriberReportContract.ts';

export interface MorningAlphaDisplayState {
  /** The report's date (YYYY-MM-DD) */
  reportDate: string;
  /** True when market is closed (holiday / weekend / non-trading day) */
  isMarketClosed: boolean;
  /** Holiday name if applicable, null otherwise */
  holidayName: string | null;
  /** Projected market bias; never a raw/radar override. */
  marketBias: string;
  /** Projected confidence; missing or suppressed evidence remains null. */
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


function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((row): row is Record<string, unknown> => row !== null) : [];
}

/** Formatting only: no independent publication, recommendation or confidence gate. */
export function getMorningAlphaDisplayState(
  rawRow: Record<string, unknown> | null,
  liveOpeningRadar: Record<string, unknown> | null = null,
): MorningAlphaDisplayState {
  const ai = record(rawRow?.ai_strategy_json);
  const envelopeProjection = getSubscriberReportProjection(rawRow);
  // Server today_date is authoritative when supplied; only an absent envelope
  // uses the local calendar. Report date itself is never substituted for today.
  const calendar = resolveMarketStatus(envelopeProjection.identity.todayDate || undefined);
  const projection = envelopeProjection.identity.todayDate ? envelopeProjection
    : getSubscriberReportProjection(rawRow, { todayDate: calendar.market_date });
  const serverClosedToday = projection.identity.reportDate === calendar.market_date
    && projection.closing.state === 'NOT_APPLICABLE';
  const closed = !calendar.is_trading_day || serverClosedToday;
  const status = serverClosedToday && calendar.is_trading_day ? 'EMERGENCY_CLOSE' : calendar.market_status;
  const marketMessage = serverClosedToday && calendar.is_trading_day ? '今日非交易日，等待下一個交易日。' : calendar.market_message;
  const contentAvailable = projection.analysisAvailable && !closed;
  const content = contentAvailable ? ai : null;
  const recommendationItems = contentAvailable ? rows(projection.recommendation.items) : [];
  const observationRows = contentAvailable
    ? rows(subscriberObservationSources(rawRow, [], rows(content?.v10_observation_watchlist)))
    : [];
  const riskRows = contentAvailable
    ? rows(subscriberObservationSources(rawRow, [], rows(content?.v10_risk_watchlist)))
    : [];
  const marketStatus: MarketStatusType = status === 'OPEN' ? 'trading'
    : status === 'WEEKEND' ? 'weekend'
      : status === 'HOLIDAY' ? 'holiday' : 'special_closed';
  const note = content?.member_research_note;
  return {
    reportDate: projection.identity.reportDate,
    isMarketClosed: closed,
    holidayName: closed ? calendar.closed_reason : null,
    marketBias: closed ? '休市' : projection.marketDecision.bias || projection.marketDecision.label,
    confidenceScore: closed ? null : projection.confidence.value,
    confidenceLabel: closed ? '休市不評分' : projection.confidence.label,
    todayQuote: closed ? marketMessage : projection.marketDecision.summary || projection.title,
    beneficiaryStocks: recommendationItems,
    memberResearchNote: typeof note === 'string' ? note : record(note),
    // Quote content is not permission to override the canonical decision or checkpoint state.
    openingRadar: contentAvailable ? liveOpeningRadar || record(content?.opening_radar) : null,
    dataBasisLabel: projection.identity.reportDate,
    coreBeneficiaryStocks: recommendationItems,
    extendedWatchlist: observationRows,
    scenarioWatchlist: riskRows,
    dataStatus: projection.evidence.status === 'SUFFICIENT' ? 'sufficient' : 'insufficient',
    dataBasisNote: projection.evidence.status === 'SUFFICIENT' ? '' : projection.statusLabel,
    causalOvernightImpactChains: rows(content?.causal_overnight_impact_chains),
    v10BeneficiaryEnabled: content?.v10_beneficiary_enabled === true,
    v10BeneficiaryStocks: recommendationItems,
    v10ObservationWatchlist: observationRows,
    v10RiskWatchlist: riskRows,
    v10DataQualityStatus: projection.recommendation.status,
    v10Warning: projection.recommendation.message || '',
    // Content access only. State readers must pass the complete row to the projection.
    rawAI: ai,
    rawRow,
    market_status: status,
    market_date: calendar.market_date,
    market_message: marketMessage,
    next_trading_day: calendar.next_trading_day,
    is_trading_day: !closed,
    session_type: closed ? 'CLOSED' : calendar.session_type,
    marketStatus,
    currentDate: calendar.market_date,
    currentWeekday: calendar.current_weekday,
    nextTradingDate: calendar.next_trading_day,
    nextTradingWeekday: calendar.next_trading_weekday,
    nextUpdateTime: calendar.next_update_time,
  };
}
export { getMorningAlphaDisplayState as getDisplayState };
