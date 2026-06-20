/**
 * resolveMorningAlphaState — SINGLE SOURCE OF TRUTH for ALL Morning Alpha pages
 *
 * This is the ONLY entry point for reading any Morning Alpha data. Every page
 * (home, today-report, war-room, member-note, admin, system-check) MUST use
 * this function and consume its output. No page is allowed to:
 *
 *   - Call supabase.from('reports') directly
 *   - Check ai_strategy_json.publish_ready inline
 *   - Read report.market_bias / report.confidence_score directly
 *   - Build its own data fetching logic
 *   - Use literal ":reportDate" in navigation
 *
 * All of the above are COMPUTED HERE and exposed via the normalized output.
 *
 * Date contract (locked):
 *   reportDate         = reports.report_date (the date this report serves)
 *   marketDataDate     = ai_strategy_json.market_data_date or tw_core_date (premarket TW basis)
 *   usMarketDate       = ai_strategy_json.us_global_date (US/global basis)
 *   createdAtTaipei    = reports.created_at → Asia/Taipei
 *   todayTaipeiDate    = frontend today (only for "is today?" checks, never overrides reportDate)
 *
 * publish_ready rules (locked):
 *   reportExists=false → "今日報告尚未產生"
 *   reportExists=true, publishReady=false → "報告已產生，需人工檢查" (frontend still shows content)
 *   reportExists=true, publishReady=true → "可公開"
 *   LINE/Reels/Social readiness does NOT affect reportExists or display.
 *
 * Member content: ALWAYS public during beta. No paywall, no lock, no blur, no preview.
 */

import { resolveActiveMorningAlphaReport, type ResolveResult } from '@/services/resolveActiveReport';
import { resolveIntradayTrackingState, type IntradayTrackingState } from '@/services/intradayTrackingResolver';
import { parseAIStrategy, hasMemberResearchNote, type ParsedAIStrategy } from '@/utils/aiStrategyParser';
import { hasUsefulContent, filterUsefulSections, hasAnyUsefulItem } from '@/lib/morningAlpha/contentGuard';
import { normalizeMorningAlphaReport, type MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';
import { formatTaipeiDate, isTaipeiWeekendToday, getTaipeiNow } from '@/utils/tradingDay';
import { getTodayOpeningRadar, type OpeningRadar } from '@/services/openingRadarService';
import { getTodayCloseMarketReview, type CloseMarketReview } from '@/services/closeMarketReviewService';
import {
  fetchSectorRotationScores,
  computeSectorRotationFreshness,
  type SectorRotationItem,
  type SectorRotationFreshness,
  type SectorRotationResult,
} from '@/services/sectorRotationService';
import { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════
// Output Type — EXACTLY as specified
// ═══════════════════════════════════════════════════

export interface MorningAlphaState {
  // ── IDs & Dates ──
  activeReport: MorningAlphaNormalizedReport;
  activeReportId: string;
  reportDate: string;
  todayTaipeiDate: string;
  marketDataDate: string;
  usMarketDate: string;
  createdAtTaipei: string;

  // ── Stable Mode: Strict date checks ──
  /** True ONLY when active report's report_date === todayTaipeiDate */
  isReportForToday: boolean;
  /** True when a report exists AND its report_date is today */
  todayReportExists: boolean;

  // ── Existence & Quality ──
  reportExists: boolean;
  publishReady: boolean;
  needsReview: boolean;
  dataIntegrityStatus: 'complete' | 'partial' | 'insufficient';

  // ── Core Content ──
  marketBias: string;
  confidenceScore: number | null;
  freeSummary: Record<string, unknown> | null;
  memberResearchNote: Record<string, unknown> | null;
  reasoningChain: Record<string, unknown>[];
  overnightImpactChain: Record<string, unknown>[];
  intradayValidationPlan: Record<string, unknown> | null;
  invalidationConditions: Record<string, unknown>[];
  closingFeedbackPlan: Record<string, unknown> | null;
  renewalValueBlock: Record<string, unknown> | null;
  reelsScript: Record<string, unknown> | null;
  socialPost: Record<string, unknown> | null;
  linePush: Record<string, unknown> | null;

  // ── Content Availability ──
  hasMemberContent: boolean;
  hasFreeContent: boolean;
  hasReels: boolean;
  hasSocialPost: boolean;
  hasLinePush: boolean;

  // ── Intraday State ──
  openingRadarState: OpeningRadar | null;
  closeReviewState: CloseMarketReview | null;
  sectorRotationState: SectorRotationResult | null;

  // ── Display Metadata ──
  displayStatus: {
    overallLabel: string;
    memberContentLabel: string;
    subscriptionLabel: string;
    visibilityLabel: string;
    publishBadge: string;
  };
  displayBadges: Array<{
    label: string;
    color: 'green' | 'amber' | 'red' | 'slate';
    icon: string;
  }>;

  // ── Debug (admin only) ──
  debug: {
    reportId: string;
    reportDate: string;
    marketDataDate: string;
    usMarketDate: string;
    createdAtTaipei: string;
    marketBias: string;
    confidenceScore: number | null;
    publishReady: boolean;
    noFakeFallback: boolean;
    fakeFallbackUsed: boolean;
    aiVersion: string;
    source: string;
    qualityScore: number;
    memberValueScore: number;
    resolutionSource: string;
    contentGateStatus: string;
  };

  // ── Raw access (for backward compat) ──
  resolveResult: ResolveResult;
  parsedStrategy: ParsedAIStrategy;
  intradayTracking: IntradayTrackingState | null;
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function formatTaipeiTimeString(isoStr: string): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/**
 * Determine data integrity status based on report quality flags.
 */
function getDataIntegrityStatus(normalized: MorningAlphaNormalizedReport): 'complete' | 'partial' | 'insufficient' {
  if (!normalized.rawReport) return 'insufficient';
  if (normalized.noFakeFallback && !normalized.fakeFallbackUsed && normalized.dataDateAligned) return 'complete';
  if (normalized.noFakeFallback) return 'partial';
  return 'insufficient';
}

/**
 * Build display badges array.
 */
function buildDisplayBadges(normalized: MorningAlphaNormalizedReport, reportExists: boolean, publishReady: boolean): Array<{ label: string; color: 'green' | 'amber' | 'red' | 'slate'; icon: string }> {
  const badges: Array<{ label: string; color: 'green' | 'amber' | 'red' | 'slate'; icon: string }> = [];

  // V376: Public-facing rule — report exists → 今日報告已產生, never 整理中
  if (!reportExists) {
    badges.push({ label: '今日報告尚未產生', color: 'red', icon: 'ri-error-warning-line' });
  } else {
    badges.push({ label: '今日報告已產生', color: 'green', icon: 'ri-check-double-line' });
  }

  // Public visibility: always visible during beta
  badges.push({ label: '完整公開', color: 'green', icon: 'ri-eye-line' });

  // Subscription status (for reference only)
  badges.push({ label: '尚未啟用付款', color: 'slate', icon: 'ri-store-2-line' });

  // Data integrity — still useful for public transparency
  const integrity = getDataIntegrityStatus(normalized);
  if (integrity === 'complete') {
    badges.push({ label: '真實資料 / 無假資料', color: 'green', icon: 'ri-database-2-line' });
  } else if (integrity === 'partial') {
    badges.push({ label: '真實資料 / 部分驗證', color: 'amber', icon: 'ri-database-2-line' });
  }

  return badges;
}

// ═══════════════════════════════════════════════════
// Main Resolver
// ═══════════════════════════════════════════════════

export async function resolveMorningAlphaState(
  urlReportDate?: string | null,
): Promise<MorningAlphaState> {
  const todayStr = formatTaipeiDate();
  const taipeiNow = getTaipeiNow();

  // ── Step 1: Resolve the active report ──
  const resolved = await resolveActiveMorningAlphaReport(urlReportDate);
  const normalized = resolved.report;
  const reportExists = resolved.rawRow !== null;

  // ── Step 2: Parse ai_strategy_json ──
  // We use the aiStrategyParser for rich structured content
  const strategyRaw = (resolved.rawRow?.ai_strategy_json as Record<string, unknown>) || null;

  // ── Step 3: Fetch intraday data sources in parallel (V28: each individually try/caught) ──
  let openingRadar = null;
  let closeReview = null;
  let sectorResult: SectorRotationResult = { items: [], scoreDate: null };

  try {
    openingRadar = await getTodayOpeningRadar();
  } catch (e) {
    console.error('resolveMorningAlphaState: getTodayOpeningRadar failed:', e);
  }
  try {
    closeReview = await getTodayCloseMarketReview();
  } catch (e) {
    console.error('resolveMorningAlphaState: getTodayCloseMarketReview failed:', e);
  }
  try {
    sectorResult = await fetchSectorRotationScores();
  } catch (e) {
    console.error('resolveMorningAlphaState: fetchSectorRotationScores failed:', e);
  }

  // ── Step 4: Build intraday tracking state ──
  let intradayTracking: IntradayTrackingState | null = null;
  try {
    const now = new Date();
    const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const taipeiHour = twNow.getHours();
    const isWeekend = isTaipeiWeekendToday();

    intradayTracking = resolveIntradayTrackingState({
      report: null,
      reportDate: normalized.reportDate,
      premarketBaseDate: normalized.marketDataBasisDate,
      todayDate: todayStr,
      openingRadar,
      marketDataTodayOnly: null,
      marketData: null,
      closeReview,
      sectorItems: sectorResult.items,
      sectorScoreDate: sectorResult.scoreDate,
      sectorFreshness: computeSectorRotationFreshness(
        sectorResult,
        todayStr,
        isWeekend ? 'pre_market' : (taipeiHour >= 14 ? 'after_close_verified' : 'intraday'),
      ),
      taipeiHour,
      isWeekend,
    });
  } catch (e) {
    console.error('resolveMorningAlphaState: resolveIntradayTrackingState failed:', e);
  }

  // ── Step 5: Extract structured content from ai_strategy_json ──
  const ai = strategyRaw || {};
  const marketDataDate = (ai.market_data_date as string) || (ai.tw_core_date as string) || normalized.marketDataBasisDate || '—';
  const usMarketDate = (ai.us_global_date as string) || (ai.us_market_date as string) || '—';
  const createdAtTaipei = formatTaipeiTimeString(normalized.reportCreatedAt);

  // Content extraction
  const freeSummary = (ai.free_summary as Record<string, unknown>) || null;
  const memberResearchNote = (ai.member_research_note as Record<string, unknown>) || null;
  const reasoningChain = Array.isArray(ai.reasoning_chain) ? (ai.reasoning_chain as Record<string, unknown>[]) : [];
  const overnightImpactChain = Array.isArray(ai.overnight_impact_chain) ? (ai.overnight_impact_chain as Record<string, unknown>[]) : [];
  const intradayValidationPlan = (ai.intraday_validation_plan as Record<string, unknown>) || null;
  const invalidationConditions = Array.isArray(ai.invalidation_conditions)
    ? (ai.invalidation_conditions as Record<string, unknown>[])
    : [];
  const closingFeedbackPlan = (ai.closing_feedback_plan as Record<string, unknown>) || null;
  const renewalValueBlock = (ai.renewal_value_block as Record<string, unknown>) || null;
  const reelsScript = (ai.reels_script as Record<string, unknown>) || null;
  const socialPost = (ai.social_post as Record<string, unknown>) || null;
  const linePush = (ai.line_push_copy as Record<string, unknown>)
    || (ai.line_push_message as Record<string, unknown>)
    || (ai.line_message as Record<string, unknown>)
    || null;

  // ── Step 6: Content availability flags ──
  const hasFreeContent = hasUsefulContent(freeSummary);
  const hasMemberContent = hasUsefulContent(memberResearchNote);
  const hasReels = hasUsefulContent(reelsScript);
  const hasSocialPost = hasUsefulContent(socialPost);
  const hasLinePush = hasUsefulContent(linePush);

  // ── Stable Mode: Strict date checks ──
  const reportDateStr = normalized.reportDate;
  const isReportForToday = reportExists && reportDateStr !== '—' && reportDateStr === todayStr;
  const todayReportExists = reportExists && isReportForToday;

  // ── Step 7: Display status (V376: simplified — report exists → 今日報告已產生) ──
  const publishReady = normalized.publishReady;

  const displayStatus = {
    overallLabel: !reportExists
      ? '今日盤前報告尚未產生'
      : !isReportForToday
        ? `今日盤前報告尚未產生，最新報告日期為 ${reportDateStr}`
        : '今日報告已產生',
    memberContentLabel: hasMemberContent ? '完整公開' : '本報告尚未產生會員研究筆記',
    subscriptionLabel: '尚未啟用付款',
    visibilityLabel: '完整公開',
    publishBadge: !reportExists
      ? '尚未產生'
      : !isReportForToday
        ? '非今日報告'
        : '今日報告已產生',
  };

  const displayBadges = buildDisplayBadges(normalized, reportExists, publishReady);

  // ── Step 8: Build debug block ──
  const debug = {
    reportId: normalized.reportId || '—',
    reportDate: normalized.reportDate || '—',
    marketDataDate,
    usMarketDate,
    createdAtTaipei,
    marketBias: normalized.marketBias,
    confidenceScore: normalized.confidenceScore,
    publishReady: normalized.publishReady,
    noFakeFallback: normalized.noFakeFallback,
    fakeFallbackUsed: normalized.fakeFallbackUsed,
    aiVersion: normalized.aiVersion,
    source: normalized.source,
    qualityScore: normalized.qualityScore,
    memberValueScore: normalized.memberValueScore,
    resolutionSource: resolved.source,
    contentGateStatus: normalized.contentGateStatus,
  };

  return {
    // ── IDs & Dates ──
    activeReport: normalized,
    activeReportId: normalized.reportId,
    reportDate: normalized.reportDate,
    todayTaipeiDate: todayStr,
    marketDataDate,
    usMarketDate,
    createdAtTaipei,

    // ── Stable Mode ──
    isReportForToday,
    todayReportExists,

    // ── Existence & Quality ──
    reportExists,
    publishReady,
    needsReview: reportExists && !publishReady,
    dataIntegrityStatus: getDataIntegrityStatus(normalized),

    // ── Core Content ──
    marketBias: normalized.marketBias,
    confidenceScore: normalized.confidenceScore,
    freeSummary,
    memberResearchNote,
    reasoningChain,
    overnightImpactChain,
    intradayValidationPlan,
    invalidationConditions,
    closingFeedbackPlan,
    renewalValueBlock,
    reelsScript,
    socialPost,
    linePush,

    // ── Content Availability ──
    hasMemberContent,
    hasFreeContent,
    hasReels,
    hasSocialPost,
    hasLinePush,

    // ── Intraday State ──
    openingRadarState: openingRadar,
    closeReviewState: closeReview,
    sectorRotationState: sectorResult,

    // ── Display Metadata ──
    displayStatus,
    displayBadges,

    // ── Debug ──
    debug,

    // ── Raw access ──
    resolveResult: resolved,
    parsedStrategy: parseAIStrategy(null), // We don't need the old Report type
    intradayTracking,
  };
}

// ═══════════════════════════════════════════════════
// React Hook — useMorningAlphaState
// ═══════════════════════════════════════════════════

export function useMorningAlphaState(urlReportDate?: string | null) {
  const [state, setState] = useState<MorningAlphaState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await resolveMorningAlphaState(urlReportDate);
      setState(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '資料讀取失敗');
    } finally {
      setIsLoading(false);
    }
  }, [urlReportDate]);

  useEffect(() => {
    load();
  }, [load]);

  return { state, isLoading, error, refresh: load };
}