import { resolveMorningAlphaState, type MorningAlphaState } from '@/lib/morningAlpha/resolveMorningAlphaState';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { mapRowToReport } from '@/services/reportService';
import type { OpeningRadar } from '@/services/openingRadarService';
import type { SafeMarketBiasResult } from '@/services/safeMarketBias';
import type { IntelligenceResult } from '@/services/intelligenceEngine';
import type { PremiumReportResult } from '@/services/premiumReportEngine';
import type { CloseMarketReview } from '@/services/closeMarketReviewService';
import { formatTaipeiDate } from '@/utils/tradingDay';
import { parseAIStrategy, type ParsedAIStrategy } from '@/utils/aiStrategyParser';
import type { Report } from '@/types/report';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { NewsItem } from '@/services/narrativeBuilder';
import { normalizeMorningAlphaReport, isActualNonTradingDay, type MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';
import { getSubscriberReportProjection } from '@/lib/subscriberReportContract';

export interface UseLatestReportResult {
  report: Report | null;
  openingRadar: OpeningRadar | null;
  hasTodayReport: boolean;
  isLoading: boolean;
  error: string | null;
  todayTaipeiDate: string;
  inconsistencyWarning: string | null;
  effectiveBias: string;
  effectiveConfidence: number | null;
  isPremarketOverridden: boolean;
  displayMode: string;
  displayLabel: string;
  displaySummary: string;
  safeBias: SafeMarketBiasResult | null;
  safeBiasLabel: string;
  safeConfidence: number | null;
  safeAllowAggressive: boolean;
  safeAllowDirectional: boolean;
  safeStrategyLabel: { mode: string; label: string; labelEn: string };
  intelligence: IntelligenceResult | null;
  premiumReport: PremiumReportResult | null;
  marketData: SupabaseMarketData[] | null;
  marketNews: NewsItem[] | null;
  marketDataTodayOnly: SupabaseMarketData[] | null;
  refresh: () => Promise<void>;
  isHistoricalFallback: boolean;
  fallbackReportDate: string | null;
  todayCloseVerification: CloseMarketReview | null;
  strategy: ParsedAIStrategy;
  canShowMemberContent: boolean;
  strategyOneLiner: string;
  strategyBias: string;
  strategyConfidence: number | null;
  strategyDataDate: string;
  strategySourceStatus: string;
  strategyTopItems: { title: string; content: string }[];
  morningAlpha: MorningAlphaNormalizedReport;
  isNonTradingDay: boolean;
  /** V26: Unified Morning Alpha State — SINGLE SOURCE OF TRUTH */
  morningState: MorningAlphaState | null;
}


/**
 * Compatibility hook over ONE resolved envelope. It does not run the retired
 * intelligence, premium-report, safe-bias or radar override translators.
 * Unrouted legacy Dashboard fields remain nullable, not synthetic analysis.
 */
export function useLatestReport(): UseLatestReportResult {
  const [morningState, setMorningState] = useState<MorningAlphaState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const todayTaipeiDate = morningState?.todayTaipeiDate || formatTaipeiDate();
  const report = useMemo(() => morningState?.resolveResult.rawRow
    ? mapRowToReport(morningState.resolveResult.rawRow as unknown as Record<string, unknown>) : null, [morningState]);
  const projection = morningState?.subscriberProjection || getSubscriberReportProjection(null, { todayDate: todayTaipeiDate });
  const resolved = morningState?.resolveResult;
  const strategy = useMemo(() => parseAIStrategy(null), []);
  const morningAlpha = morningState?.activeReport || normalizeMorningAlphaReport(null);
  const isNonTradingDay = morningState ? morningState.marketStatus === 'closed' : isActualNonTradingDay();
  const actionAllowed = projection.analysisAvailable && projection.marketDecision.action === 'ACT' && !projection.historical && !isNonTradingDay;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMorningState(await resolveMorningAlphaState());
    } catch {
      // A failed new request cannot retain a previous revision's success state.
      setMorningState(null);
      setError('盤中追蹤資料暫時無法取得，請稍後重新載入。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return {
    report,
    openingRadar: morningState?.openingRadarState || null,
    hasTodayReport: morningState?.todayReportExists || false,
    isLoading,
    error,
    todayTaipeiDate,
    inconsistencyWarning: null,
    effectiveBias: projection.marketDecision.bias || projection.marketDecision.label,
    effectiveConfidence: projection.confidence.value,
    isPremarketOverridden: false,
    displayMode: projection.marketDecision.action,
    displayLabel: projection.statusLabel,
    displaySummary: projection.marketDecision.summary || projection.title,
    safeBias: null,
    safeBiasLabel: projection.marketDecision.bias || projection.marketDecision.label,
    safeConfidence: projection.confidence.value,
    safeAllowAggressive: actionAllowed,
    safeAllowDirectional: actionAllowed,
    safeStrategyLabel: { mode: projection.marketDecision.action, label: projection.marketDecision.label, labelEn: projection.marketDecision.action },
    intelligence: null,
    premiumReport: null,
    marketData: null,
    marketNews: null,
    marketDataTodayOnly: null,
    refresh: load,
    isHistoricalFallback: resolved?.isHistoricalFallback || false,
    fallbackReportDate: resolved?.fallbackReportDate || null,
    todayCloseVerification: morningState?.closeReviewState || null,
    strategy,
    canShowMemberContent: morningState?.hasMemberContent || false,
    strategyOneLiner: projection.marketDecision.summary || projection.title,
    strategyBias: projection.marketDecision.bias || projection.marketDecision.label,
    strategyConfidence: projection.confidence.value,
    strategyDataDate: projection.identity.reportDate,
    strategySourceStatus: projection.statusLabel,
    strategyTopItems: [],
    morningAlpha,
    isNonTradingDay,
    morningState,
  };
}
