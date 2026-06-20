import { useMorningAlphaState, type MorningAlphaState } from '@/lib/morningAlpha/resolveMorningAlphaState';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { isTaipeiToday } from '@/services/marketSourceHealthService';
import { mapRowToReport } from '@/services/reportService';
import { getTodayOpeningRadar, getEffectiveDisplayState, mapRowToOpeningRadar, type OpeningRadar } from '@/services/openingRadarService';
import {
  getSafeMarketBias,
  getSafeStrategyLabel,
  checkDataCompleteness,
  type SafeMarketBiasResult,
} from '@/services/safeMarketBias';
import { generateIntelligence, type IntelligenceResult } from '@/services/intelligenceEngine';
import { generatePremiumReport, type PremiumReportResult } from '@/services/premiumReportEngine';
import { getTodayOnlyMarketData } from '@/services/marketStateEngine';
import { getTodayCloseMarketReview, mapRowToCloseMarketReview, type CloseMarketReview } from '@/services/closeMarketReviewService';
import { formatTaipeiDate } from '@/utils/tradingDay';
import { parseAIStrategy, getBestOneLiner, getDisplayBias, getDisplayConfidence, getDataDate, getSourceStatusText, hasRealKeyObservations, getTopItems, shouldShowNonTradingDayWarning, hasTodayGeneratedReport, getReportDisplayDate, getMarketDataBasisDate, type ParsedAIStrategy } from '@/utils/aiStrategyParser';
import type { Report } from '@/types/report';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { NewsItem } from '@/services/narrativeBuilder';
import type { PremiumNewsItem } from '@/services/premiumReportEngine';
import { normalizeMorningAlphaReport, isActualNonTradingDay, type MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { applyMarketBiasDowngrade } from '@/utils/marketBiasDowngrade';

export interface UseLatestReportResult {
  report: Report | null;
  openingRadar: OpeningRadar | null;
  hasTodayReport: boolean;
  isLoading: boolean;
  error: string | null;
  todayTaipeiDate: string;
  inconsistencyWarning: string | null;
  effectiveBias: string;
  effectiveConfidence: number;
  isPremarketOverridden: boolean;
  displayMode: string;
  displayLabel: string;
  displaySummary: string;
  safeBias: SafeMarketBiasResult | null;
  safeBiasLabel: string;
  safeConfidence: number;
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

export function useLatestReport(): UseLatestReportResult {
  const todayTaipeiDate = isTaipeiToday();

  const [report, setReport] = useState<Report | null>(null);
  const [openingRadar, setOpeningRadar] = useState<OpeningRadar | null>(null);
  const [hasTodayReport, setHasTodayReport] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inconsistencyWarning, setInconsistencyWarning] = useState<string | null>(null);

  const [isHistoricalFallback, setIsHistoricalFallback] = useState(false);
  const [fallbackReportDate, setFallbackReportDate] = useState<string | null>(null);
  const [todayCloseVerification, setTodayCloseVerification] = useState<CloseMarketReview | null>(null);

  const [marketData, setMarketData] = useState<SupabaseMarketData[] | null>(null);
  const [marketNews, setMarketNews] = useState<NewsItem[] | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceResult | null>(null);
  const [premiumReport, setPremiumReport] = useState<PremiumReportResult | null>(null);

  // V26: Unified state
  const [morningState, setMorningState] = useState<MorningAlphaState | null>(null);

  const strategy = useMemo<ParsedAIStrategy>(() => parseAIStrategy(report), [report]);
  const canShowMemberContent = strategy.canShowMemberContent;

  const strategyOneLiner = useMemo(() => {
    const isNonTrading = isHistoricalFallback || !hasTodayReport;
    return getBestOneLiner(strategy, report, isNonTrading);
  }, [strategy, report, isHistoricalFallback, hasTodayReport]);

  const strategyBias = useMemo(() => getDisplayBias(strategy, report), [strategy, report]);
  const strategyConfidence = useMemo(() => getDisplayConfidence(strategy, report), [strategy, report]);
  const strategyDataDate = useMemo(() => getDataDate(strategy, report), [strategy, report]);
  const strategySourceStatus = useMemo(() => getSourceStatusText(strategy), [strategy]);
  const strategyTopItems = useMemo(() => getTopItems(strategy), [strategy]);

  const [morningAlpha, setMorningAlpha] = useState<MorningAlphaNormalizedReport>(
    normalizeMorningAlphaReport(null)
  );
  const isNonTradingDay = isActualNonTradingDay();

  const effective = getEffectiveDisplayState(
    openingRadar,
    report?.market_bias,
    report?.confidence_score,
  );

  const safeBias = getSafeMarketBias(report, marketData || null);

  let safeBiasLabel: string;
  let safeConfidence: number;
  let safeAllowAggressive: boolean;
  let safeAllowDirectional: boolean;

  if (!report) {
    safeBiasLabel = '尚未生成報告';
    safeConfidence = 0;
    safeAllowAggressive = false;
    safeAllowDirectional = false;
  } else if (openingRadar?.radar_status === '明顯偏弱' || openingRadar?.radar_status === '盤中轉弱') {
    safeBiasLabel = openingRadar.radar_status === '明顯偏弱' ? '明顯偏弱' : '盤中轉弱';
    safeConfidence = Math.min(safeBias.confidence, openingRadar.confidence_score ?? 40);
    safeAllowAggressive = false;
    safeAllowDirectional = false;
  } else if (openingRadar?.radar_status === '資料不足') {
    safeBiasLabel = '資料不足，暫不判定';
    safeConfidence = Math.min(safeBias.confidence, 60);
    safeAllowAggressive = false;
    safeAllowDirectional = false;
  } else {
    safeBiasLabel = safeBias.bias;
    safeConfidence = safeBias.confidence;
    safeAllowAggressive = safeBias.allowAggressive;
    safeAllowDirectional = safeBias.allowDirectional;
  }

  // V7.53: Post-close market bias auto-downgrade based on TAIEX/TXF/2330
  const finalSafeBiasLabel = applyMarketBiasDowngrade(safeBiasLabel, {
    taiexChange: openingRadar?.taiex_change ?? null,
    txfChange: openingRadar?.txf_change ?? null,
    tsmc2330Change: openingRadar?.tsmc_change ?? null,
  }) || safeBiasLabel;

  const safeStrategyLabel = getSafeStrategyLabel(safeAllowAggressive, safeAllowDirectional);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // V26: Load unified state (runs resolveMorningAlphaState internally)
      const msPromise = import('@/lib/morningAlpha/resolveMorningAlphaState').then((m) =>
        m.resolveMorningAlphaState()
      );

      // V24: Use resolveActiveMorningAlphaReport — SINGLE SOURCE OF TRUTH
      const resolved = await resolveActiveMorningAlphaReport();
      const rptRow = resolved.rawRow;

      // Fetch radar
      const radarRes = await getTodayOpeningRadar();

      if (!rptRow) {
        setReport(null);
        setMorningAlpha(normalizeMorningAlphaReport(null));
        setHasTodayReport(false);
        setIsHistoricalFallback(false);
        setFallbackReportDate(null);
        setInconsistencyWarning(null);
        setOpeningRadar(radarRes);
        setIntelligence(generateIntelligence(null, null, null));
        setPremiumReport(generatePremiumReport(null, null, null, null));
        // Still resolve morningState even without report
        msPromise.then(setMorningState).catch(() => {});
        return;
      }

      const rpt = mapRowToReport(rptRow as unknown as Record<string, unknown>);
      setReport(rpt);
      setMorningAlpha(resolved.report);
      setHasTodayReport(!resolved.isHistoricalFallback);
      setIsHistoricalFallback(resolved.isHistoricalFallback);
      setFallbackReportDate(resolved.fallbackReportDate);

      let activeRadar: OpeningRadar | null = radarRes;
      let activeCloseVerif: CloseMarketReview | null = null;

      if (resolved.isHistoricalFallback && resolved.fallbackReportDate) {
        // V8: Use ai_strategy_json data only — no direct table queries
        // Opening radar and close verification from report fallback handled by services
        try {
          const cmr = await getTodayCloseMarketReview();
          activeCloseVerif = cmr;
        } catch {
          activeCloseVerif = null;
        }
      } else {
        try {
          const cmr = await getTodayCloseMarketReview();
          activeCloseVerif = cmr;
        } catch {
          activeCloseVerif = null;
        }
      }

      setOpeningRadar(activeRadar);
      setTodayCloseVerification(activeCloseVerif);

      const score = rpt.confidence_score ?? 0;
      const bias = rpt.market_bias || '';
      if (score >= 90 && bias.includes('震盪')) {
        setInconsistencyWarning('分數與用詞不一致，請檢查報告生成邏輯');
      } else {
        setInconsistencyWarning(null);
      }

      // V8: Data from ai_strategy_json only — no direct market_data/market_news queries
      setMarketData(null);
      setMarketNews(null);
      setIntelligence(generateIntelligence(rpt, null, null));
      setPremiumReport(generatePremiumReport(rpt, null, null, generateIntelligence(rpt, null, null)));

      // V26: Resolve unified state in background
      msPromise.then(setMorningState).catch(() => {});

    } catch (err) {
      setError(err instanceof Error ? err.message : '資料讀取失敗');
      setReport(null);
      setHasTodayReport(false);
      setInconsistencyWarning(null);
    } finally {
      setIsLoading(false);
    }
  }, [todayTaipeiDate]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    report,
    openingRadar,
    hasTodayReport,
    isLoading,
    error,
    todayTaipeiDate,
    inconsistencyWarning,
    effectiveBias: effective.effectiveBias,
    effectiveConfidence: effective.effectiveConfidence,
    isPremarketOverridden: effective.isOverridden,
    displayMode: effective.displayMode,
    displayLabel: effective.displayLabel,
    displaySummary: effective.displaySummary,
    safeBias,
    safeBiasLabel: finalSafeBiasLabel,
    safeConfidence,
    safeAllowAggressive,
    safeAllowDirectional,
    safeStrategyLabel,
    intelligence,
    premiumReport,
    marketData,
    marketNews,
    marketDataTodayOnly: getTodayOnlyMarketData(marketData),
    refresh: load,
    isHistoricalFallback,
    fallbackReportDate,
    todayCloseVerification,
    strategy,
    canShowMemberContent,
    strategyOneLiner,
    strategyBias,
    strategyConfidence,
    strategyDataDate,
    strategySourceStatus,
    strategyTopItems,
    morningAlpha,
    isNonTradingDay,
    morningState,
  };
}