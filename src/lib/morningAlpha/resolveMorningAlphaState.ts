/**
 * resolveMorningAlphaState — SINGLE SOURCE OF TRUTH for ALL Morning Alpha pages
 *
 * This is the ONLY entry point for reading any Morning Alpha data. Every page
 * (home, today-report, war-room, member-note, admin, system-check) MUST use
 * this function and consume its output. No page is allowed to:
 *
 *   - Read the reports table directly
 *   - Check ai_strategy_json.publish_ready inline
 *   - Read report.market_bias / report.confidence_score directly
 *   - Build its own data fetching logic
 *   - Use literal ":reportDate" in navigation
 *
 * All state is projected by SubscriberReportProjection; this resolver only loads
 * the canonical selected envelope and formats already-authorized content.
 *
 * Date contract (locked):
 *   reportDate         = reports.report_date (the date this report serves)
 *   marketDataDate     = ai_strategy_json.market_data_date or tw_core_date (premarket TW basis)
 *   usMarketDate       = ai_strategy_json.us_global_date (US/global basis)
 *   createdAtTaipei    = reports.created_at → Asia/Taipei
 *   todayTaipeiDate    = active server envelope date; never a second browser-clock decision
 *
 * Publication and completion are evidence-backed projection states, never
 * inferred from row existence, client time, or internal quality counters.
 *
 * Report content should come from server-trimmed payload when available.
 * Frontend gates are display scaffolding only; raw data security requires server-side trimming + RLS.
 */

import { resolveActiveMorningAlphaReport, type ResolveResult } from '@/services/resolveActiveReport';
import type { IntradayTrackingState } from '@/services/intradayTrackingResolver';
import { parseAIStrategy, type ParsedAIStrategy } from '@/utils/aiStrategyParser';
import { hasUsefulContent } from '@/lib/morningAlpha/contentGuard';
import type { MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';
import type { SubscriberReportProjection } from '@/lib/subscriberReportContract';
import { mapRowToOpeningRadar, type OpeningRadar } from '@/services/openingRadarService';
import { mapClosingVerificationToCloseMarketReview, type CloseMarketReview } from '@/services/closeMarketReviewService';
import {
  type SectorRotationItem,
  type SectorRotationResult,
} from '@/services/sectorRotationService';
import { useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════
// Output Type — EXACTLY as specified
// ═══════════════════════════════════════════════════

export interface MorningAlphaState {
  // ── IDs & Dates ──
  activeReport: MorningAlphaNormalizedReport;
  subscriberProjection: SubscriberReportProjection;
  activeReportId: string;
  reportDate: string;
  revisionId: string;
  generatedAt: string;
  todayTaipeiDate: string;
  marketDataDate: string;
  usMarketDate: string;
  createdAtTaipei: string;

  // ── Stable Mode: Strict date checks ──
  /** True ONLY when active report's report_date === todayTaipeiDate */
  isReportForToday: boolean;
  /** True when a report exists AND its report_date is today */
  todayReportExists: boolean;
  /** Today's TWSE status from the active report resolver */
  marketStatus: 'open' | 'closed';
  closedReason: string | null;
  dataStatus: ResolveResult['data_status'];
  staleReason: string | null;
  tier: ResolveResult['tier'];
  lockedSections: string[];
  payloadSource: ResolveResult['payload_source'];

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

function getDataIntegrityStatus(projection: SubscriberReportProjection): 'complete' | 'partial' | 'insufficient' {
  return projection.evidence.status === 'SUFFICIENT' ? 'complete'
    : projection.displayStatus === 'PARTIAL' ? 'partial' : 'insufficient';
}
function buildDisplayBadges(projection: SubscriberReportProjection): MorningAlphaState['displayBadges'] {
  return [{
    label: projection.statusLabel,
    color: projection.analysisAvailable ? 'green' : 'amber',
    icon: projection.analysisAvailable ? 'ri-check-double-line' : 'ri-information-line',
  }];
}

// ═══════════════════════════════════════════════════
// Main Resolver
// ═══════════════════════════════════════════════════

export async function resolveMorningAlphaState(
  urlReportDate?: string | null,
): Promise<MorningAlphaState> {
  // ── Step 1: Resolve the active report ──
  const resolved = await resolveActiveMorningAlphaReport(urlReportDate);
  const todayStr = resolved.today_date;
  const normalized = resolved.report;
  const reportExists = resolved.rawRow !== null;
  // Reuse the upstream envelope interpretation. A client clock skew or midnight
  // between reads must not silently turn the same server revision into history.
  const subscriberProjection = resolved.subscriberProjection;

  // ── Step 2: Parse ai_strategy_json ──
  // We use the aiStrategyParser for rich structured content
  const strategyRaw = (resolved.rawRow?.ai_strategy_json as Record<string, unknown>) || null;

  // ── Step 3: Consume runtime sources embedded in this exact report revision ──
  const embeddedRadar = strategyRaw?.opening_radar && typeof strategyRaw.opening_radar === 'object' && !Array.isArray(strategyRaw.opening_radar)
    ? strategyRaw.opening_radar as Record<string, unknown>
    : null;
  const openingRadar = embeddedRadar ? mapRowToOpeningRadar({
    ...embeddedRadar,
    id: embeddedRadar.id || `report:${resolved.revision_id || normalized.reportId}`,
    report_date: embeddedRadar.report_date || normalized.reportDate,
  }) : null;
  const closeReview = mapClosingVerificationToCloseMarketReview(
    subscriberProjection,
  );
  const sectorItems = Array.isArray(strategyRaw?.sector_rotation_scores)
    ? strategyRaw.sector_rotation_scores as unknown as SectorRotationItem[]
    : [];
  const sectorResult: SectorRotationResult = {
    items: sectorItems,
    scoreDate: sectorItems[0]?.score_date || null,
    totalCount: sectorItems.length,
    rawRowCount: sectorItems.length,
    error: null,
    debugInfo: 'server_payload_revision',
    generatedAt: sectorItems.find((item) => item.generated_at)?.generated_at || null,
  };

  // Legacy clock-based resolver is no longer executed. Subscribers consume
  // subscriberProjection.runtime, including verified per-checkpoint identity.
  const intradayTracking: IntradayTrackingState | null = null;

  // ── Step 5: Extract structured content from ai_strategy_json ──
  const ai = subscriberProjection.analysisAvailable ? strategyRaw || {} : {};
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
  const reportDateStr = subscriberProjection.identity.reportDate;
  const isReportForToday = reportExists && reportDateStr !== '—' && reportDateStr === todayStr;
  const todayReportExists = reportExists && isReportForToday;

  // Display state never inherits raw report existence/quality counters.
  const publishReady = subscriberProjection.analysisAvailable;
  const displayStatus = {
    overallLabel: subscriberProjection.historical
      ? `歷史參考（${reportDateStr}）` : subscriberProjection.statusLabel,
    memberContentLabel: hasMemberContent ? '會員研究內容' : '會員研究內容尚未提供',
    subscriptionLabel: resolved.tier,
    visibilityLabel: publishReady ? '市場分析已發布' : subscriberProjection.statusLabel,
    publishBadge: subscriberProjection.statusLabel,
  };
  const displayBadges = buildDisplayBadges(subscriberProjection);

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
    subscriberProjection,
    activeReportId: normalized.reportId,
    reportDate: subscriberProjection.identity.reportDate,
    revisionId: subscriberProjection.identity.revisionId || '',
    generatedAt: subscriberProjection.identity.generatedAt || '',
    todayTaipeiDate: todayStr,
    marketDataDate,
    usMarketDate,
    createdAtTaipei,

    // ── Stable Mode ──
    isReportForToday,
    todayReportExists,
    marketStatus: resolved.market_status,
    closedReason: resolved.closed_reason,
    dataStatus: resolved.data_status,
    staleReason: resolved.stale_reason,
    tier: resolved.tier,
    lockedSections: resolved.locked_sections,
    payloadSource: resolved.payload_source,

    // ── Existence & Quality ──
    reportExists,
    publishReady,
    needsReview: reportExists && !publishReady,
    dataIntegrityStatus: getDataIntegrityStatus(subscriberProjection),

    // ── Core Content ──
    marketBias: subscriberProjection.marketDecision.bias || subscriberProjection.marketDecision.label,
    confidenceScore: subscriberProjection.confidence.value,
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
      setState(null);
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
