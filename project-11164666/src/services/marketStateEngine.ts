/**
 * Morning Alpha — Market State Engine
 *
 * SINGLE SOURCE OF TRUTH for all frontend market state decisions.
 * Every page (home, /report/today, /war-room) MUST consume this engine.
 * No page may independently compute marketPhase, intradayBias, dataQuality,
 * displayVerdict, heroTitle, or confidence scores.
 *
 * Usage:
 *   const state = buildMarketState({ todayReport, todayOpeningRadar, todayMarketData, todayCloseVerification, nowTaipei });
 *   state.marketPhase  → 'pre_market' | 'intraday' | 'after_close_pending' | 'after_close_verified'
 *   state.displayLabel → e.g. '偏弱觀察'
 *   state.heroTitle    → hero h1 text
 */

import { formatTaipeiDate, isTaipeiWeekend } from '@/utils/tradingDay';
import type { Report } from '@/types/report';
import type { OpeningRadar } from '@/services/openingRadarService';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { CloseMarketReview } from '@/services/closeMarketReviewService';
import type { SectorRotationFreshness } from '@/services/sectorRotationService';

// ════════════════════════════════════════════
// Type Definitions
// ════════════════════════════════════════════

export type MarketPhase =
  | 'pre_market'
  | 'intraday'
  | 'after_close_pending'
  | 'after_close_verified';

export type IntradayBias =
  | 'pre_market_only'
  | 'bullish_watch'
  | 'neutral_watch'
  | 'weak_watch'
  | 'risk_off'
  | 'after_close_pending'
  | 'verified';

export type DataQuality = 'complete' | 'partial' | 'insufficient' | 'mismatch';

export type RiskTone = 'green' | 'yellow' | 'red' | 'gray';

export interface TimelineItem {
  time: string;
  title: string;
  status: string;
  confidence: number | null;
  description: string;
}

export interface TopThreeItem {
  title: string;
  description: string;
  score?: number;
}

export interface ReportAvailability {
  hasTodayReport: boolean;
  hasTodayRadar: boolean;
  hasTodayCloseVerification: boolean;
  shouldShowTodayReportContent: boolean;
  shouldShowCloseVerificationPending: boolean;
}

export interface MarketState {
  todayDate: string;

  marketPhase: MarketPhase;
  intradayBias: IntradayBias;
  dataQuality: DataQuality;
  riskTone: RiskTone;

  displayLabel: string;
  displayVerdict: string;
  heroTitle: string;
  heroSubtitle: string;

  confidenceScore: number;
  confidenceLabel: string;

  dataWarnings: string[];
  blockedStaleData: boolean;

  sourceFreshness: {
    taiexFresh: boolean;
    txfFresh: boolean;
    tsmcFresh: boolean;
    reportFresh: boolean;
    radarFresh: boolean;
    closeVerificationFresh: boolean;
  };

  /** V23: Granular report availability — gates which sections to show */
  reportAvailability: ReportAvailability;

  timelineItems: TimelineItem[];
  topThreeFocus: TopThreeItem[];
}

export interface BuildMarketStateParams {
  todayReport: Report | null;
  todayOpeningRadar: OpeningRadar | null;
  todayMarketData: SupabaseMarketData[] | null;
  todayCloseVerification: CloseMarketReview | null;
  /** V27: Sector rotation data freshness — affects dataQuality */
  sectorRotationFreshness?: SectorRotationFreshness | null;
  nowTaipei?: Date;
}

// ════════════════════════════════════════════
// TAIEX Threshold Constants
// ════════════════════════════════════════════

const TAIEX_WEAK_DROP = -1.00;
const TAIEX_MILD_WEAK = -0.30;
const TAIEX_MILD_STRONG = 0.30;

// ════════════════════════════════════════════
// Helper: Taipei time
// ════════════════════════════════════════════

function getTaipeiNow(date?: Date): Date {
  const d = date || new Date();
  return new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
}

function getTaipeiHour(now?: Date): number {
  return getTaipeiNow(now).getHours();
}

function getTaipeiMinute(now?: Date): number {
  return getTaipeiNow(now).getMinutes();
}

function isAfterMarketClose(now?: Date): boolean {
  const h = getTaipeiHour(now);
  const m = getTaipeiMinute(now);
  return h > 13 || (h === 13 && m >= 30);
}

// ════════════════════════════════════════════
// Helper: Date freshness
// ════════════════════════════════════════════

function isFreshToday(dateStr: string | null | undefined, todayStr: string): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const y = tw.getFullYear();
    const m = String(tw.getMonth() + 1).padStart(2, '0');
    const dd = String(tw.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}` === todayStr;
  } catch { return false; }
}

function isMarketDataFreshToday(
  item: { captured_at?: string; updated_at?: string },
  todayStr: string,
): boolean {
  const d = item.updated_at || item.captured_at || null;
  return isFreshToday(d, todayStr);
}

// ════════════════════════════════════════════
// Data Freshness Utilities — Cross-date filtering
// ════════════════════════════════════════════

/**
 * Check if a market_data record's captured_at / updated_at is from today (Taipei date).
 * Only records whose timestamp falls within today's Taipei date are considered fresh.
 */
export function isMarketDataToday(
  item: { captured_at?: string; updated_at?: string },
  todayStr?: string,
): boolean {
  const d = item.updated_at || item.captured_at || null;
  if (!d) return false;
  const today = todayStr || formatTaipeiDate(getTaipeiNow());
  return isFreshToday(d, today);
}

/**
 * Filter market_data to only include records from today (Taipei date).
 * Each symbol keeps its latest today record only.
 * Returns empty array if no today data exists.
 */
export function getTodayOnlyMarketData(
  allMarketData: SupabaseMarketData[] | null | undefined,
  todayStr?: string,
): SupabaseMarketData[] {
  if (!allMarketData || allMarketData.length === 0) return [];
  const today = todayStr || formatTaipeiDate(getTaipeiNow());

  const todayData = allMarketData.filter((m) => isMarketDataToday(m, today));

  const seen = new Set<string>();
  const deduped: SupabaseMarketData[] = [];
  for (const item of todayData) {
    if (!seen.has(item.symbol)) {
      seen.add(item.symbol);
      deduped.push(item);
    }
  }

  return deduped;
}

/**
 * Get a display label for market_data freshness.
 */
export function getMarketDataFreshnessLabel(
  symbol: string,
  allMarketData: SupabaseMarketData[] | null | undefined,
  todayStr?: string,
): { isFresh: boolean; label: string; staleDate: string | null } {
  const today = todayStr || formatTaipeiDate(getTaipeiNow());
  if (!allMarketData || allMarketData.length === 0) {
    return { isFresh: false, label: `${symbol} 暫缺`, staleDate: null };
  }

  const item = allMarketData.find((m) => m.symbol === symbol);
  if (!item) {
    return { isFresh: false, label: `${symbol} 暫缺`, staleDate: null };
  }

  if (isMarketDataToday(item, today)) {
    return { isFresh: true, label: `${symbol} 今日即時`, staleDate: null };
  }

  const dateStr = (item.updated_at || item.captured_at || '').slice(0, 10);
  return {
    isFresh: false,
    label: `${symbol} 非今日即時（${dateStr}）`,
    staleDate: dateStr,
  };
}

// ════════════════════════════════════════════
// Close Verification Helpers — Dynamic conclusion
// ════════════════════════════════════════════

/** Classify the close result from taiex_change or actual_market_result text */
export function classifyCloseResult(taiexChange: number | null, actualResult: string | null): string {
  if (taiexChange !== null) {
    if (taiexChange >= 1.0) return '明顯上漲';
    if (taiexChange >= 0.3) return '小漲';
    if (taiexChange > -0.3) return '震盪';
    if (taiexChange > -1.0) return '小跌';
    return '明顯下跌';
  }
  if (actualResult) {
    const r = actualResult.trim();
    // V44: 若 actual_market_result 本身含「資料不足」就直接回傳，讓上游攔截
    if (r.includes('資料不足')) return '收盤資料不足';
    if (r.length > 0 && r !== 'null' && r !== 'undefined') return r;
  }
  return '收盤資料不足';
}

/**
 * Generate the dynamic close verification conclusion based on:
 * - reports.market_bias (the true premarket assumption — single source of truth)
 * - actual close result (from taiex_change or actual_market_result)
 *
 * NEVER hardcode "偏多觀察" or "盤前劇本命中" — always derive from reports.market_bias.
 */
export function generateCloseVerificationConclusion(
  premarketBias: string | undefined | null,
  closeResult: string,
  taiexChange: number | null,
): string {
  // ── V44 GUARD: 收盤資料不足 → 不得產生命中等判定 ──
  const isCloseInsufficient =
    closeResult.includes('資料不足') ||
    closeResult.includes('資料尚未生成') ||
    closeResult.includes('收盤資料不足');
  if (isCloseInsufficient) {
    const bias = (premarketBias || '').trim();
    const biasText = bias ? `盤前原始假設為『${bias}』，` : '';
    return `最近交易日收盤資料不足，因此暫不做命中判定。${biasText}請等待下一個交易日完整資料後再驗證。`;
  }

  const bias = (premarketBias || '').trim();
  if (!bias) {
    const taiexStr = taiexChange !== null ? `（TAIEX ${taiexChange >= 0 ? '+' : ''}${taiexChange.toFixed(2)}%）` : '';
    return `收盤實際結果${closeResult}${taiexStr}，盤前假設資料暫缺，無法比對。`;
  }

  const isNeutralShock = bias.includes('中性震盪') || (bias.includes('中性') && bias.includes('震盪'));
  const isBullish = bias.includes('偏多');
  const isBearishOrRisk = bias.includes('偏弱') || bias.includes('偏空') || bias.includes('高風險') || bias.includes('保守');
  const isClearlyUp = closeResult === '明顯上漲';
  const isUp = closeResult === '明顯上漲' || closeResult === '小漲';
  const isDown = closeResult === '明顯下跌' || closeResult === '小跌';
  const isRanging = closeResult === '震盪';
  const taiexStr = taiexChange !== null ? `（TAIEX ${taiexChange >= 0 ? '+' : ''}${taiexChange.toFixed(2)}%）` : '';

  if (isNeutralShock && isClearlyUp) {
    return `盤前原始假設為『${bias}』，收盤實際結果明顯上漲${taiexStr}。本日盤前判斷偏保守，未完全捕捉漲幅，但可作為後續模型校正依據。`;
  }

  if (isBullish && isUp) {
    return `盤前原始假設為『${bias}』，收盤實際結果${closeResult}${taiexStr}，方向判斷一致。`;
  }

  if (isBullish && isDown) {
    return `盤前原始假設為『${bias}』，收盤實際結果${closeResult}${taiexStr}，方向判斷未命中，需檢討盤前偏多訊號權重。`;
  }

  if (isBearishOrRisk && isUp) {
    return `盤前原始假設偏保守或偏弱（『${bias}』），收盤實際結果${closeResult}${taiexStr}，本日判斷未命中，需檢查早盤資料與權值股強度。`;
  }

  if (isBearishOrRisk && isDown) {
    return `盤前原始假設為『${bias}』，收盤實際結果${closeResult}${taiexStr}，風險觀點成立，方向判斷一致。`;
  }

  if (isNeutralShock && isRanging) {
    return `盤前原始假設為『${bias}』，收盤結果為震盪${taiexStr}，與盤前假設大致一致。`;
  }

  if (isNeutralShock) {
    return `盤前原始假設為『${bias}』，收盤實際結果${closeResult}${taiexStr}。盤前判斷大致符合區間預期。`;
  }

  if (isBullish && isRanging) {
    return `盤前原始假設為『${bias}』，收盤結果為震盪${taiexStr}，方向判斷部分命中，漲幅未完全符合偏多預期。`;
  }

  return `盤前原始假設為『${bias}』，收盤實際結果${closeResult}${taiexStr}。`;
}

// ════════════════════════════════════════════
// Core: buildMarketState
// ════════════════════════════════════════════

export function buildMarketState(params: BuildMarketStateParams): MarketState {
  const {
    todayReport,
    todayOpeningRadar,
    todayMarketData,
    todayCloseVerification,
    sectorRotationFreshness,
    nowTaipei,
  } = params;

  const now = nowTaipei || new Date();
  const todayStr = formatTaipeiDate(getTaipeiNow(now));
  const taipeiHr = getTaipeiHour(now);
  const isAfterClose = isAfterMarketClose(now);
  const weekend = isTaipeiWeekend(getTaipeiNow(now));

  // ── Source Freshness ──
  const marketDataItems = todayMarketData || [];
  const taiexItem = marketDataItems.find((m) => m.symbol === 'TAIEX');
  const txfItem = marketDataItems.find((m) => m.symbol === 'TXF');
  const tsmcItem = marketDataItems.find((m) => m.symbol === '2330');

  const taiexFresh = taiexItem ? isMarketDataFreshToday(taiexItem, todayStr) : false;
  const txfFresh = txfItem ? isMarketDataFreshToday(txfItem, todayStr) : false;
  const tsmcFresh = tsmcItem ? isMarketDataFreshToday(tsmcItem, todayStr) : false;
  const reportFresh = todayReport ? todayReport.report_date === todayStr : false;
  const radarFresh = todayOpeningRadar ? todayOpeningRadar.report_date === todayStr : false;
  const closeVerificationFresh = todayCloseVerification !== null && todayCloseVerification.report_date === todayStr;

  // ── TAIEX change extraction ──
  const taiexChange: number | null = (() => {
    if (todayOpeningRadar?.taiex_change !== null && todayOpeningRadar?.taiex_change !== undefined) {
      return todayOpeningRadar.taiex_change;
    }
    if (taiexItem && taiexFresh) {
      return Number(taiexItem.change_percent);
    }
    return null;
  })();

  const hasTxfData = todayOpeningRadar?.txf_change !== null || (txfItem && txfFresh);
  const hasTsmcData = todayOpeningRadar?.tsmc_change !== null || (tsmcItem && tsmcFresh);

  // ── Market Phase ──
  let marketPhase: MarketPhase = 'pre_market';

  // V43: Detect review mode — non-trading day showing historical data
  const isReviewMode = weekend && todayReport !== null && todayReport.report_date !== todayStr;
  const hasReviewData = isReviewMode && (todayOpeningRadar !== null || todayCloseVerification !== null);

  if (isReviewMode && hasReviewData) {
    // Non-trading day but we have complete historical data — show verified state
    if (todayCloseVerification !== null) {
      marketPhase = 'after_close_verified';
    } else if (todayOpeningRadar !== null) {
      marketPhase = 'after_close_pending';
    } else {
      marketPhase = 'pre_market';
    }
  } else if (weekend) {
    marketPhase = 'pre_market';
  } else if (isAfterClose) {
    if (todayCloseVerification !== null) {
      marketPhase = 'after_close_verified';
    } else {
      marketPhase = 'after_close_pending';
    }
  } else if (taipeiHr >= 9) {
    marketPhase = 'intraday';
  } else {
    marketPhase = 'pre_market';
  }

  // ── Intraday Bias ──
  let intradayBias: IntradayBias = 'neutral_watch';
  let displayLabel = '觀察中';
  let displayVerdict = '';
  let riskTone: RiskTone = 'gray';

  if (marketPhase === 'pre_market') {
    intradayBias = 'pre_market_only';
    if (isReviewMode) {
      displayLabel = '非交易日，顯示最近交易日資料';
      displayVerdict = `今天非交易日，目前顯示最近交易日（${todayReport?.report_date || ''}）的盤前劇本。盤中追蹤與收盤驗證資料尚未完整同步。`;
    } else {
      displayLabel = todayReport ? '盤前等待' : '等待報告';
      displayVerdict = '尚在盤前階段，等待 09:00 開盤後進行盤中驗證。';
    }
    riskTone = 'gray';
  } else if (marketPhase === 'after_close_pending') {
    intradayBias = 'after_close_pending';
    if (isReviewMode) {
      displayLabel = '最近交易日收盤待驗證';
      displayVerdict = `最近交易日（${todayReport?.report_date || ''}）已收盤，系統正在等待收盤資料同步與盤後驗證結果。盤前劇本與盤中追蹤可在下方回顧。`;
    } else {
      displayLabel = '收盤待驗證';
      displayVerdict = '今日已收盤，系統正在等待收盤資料同步與盤後驗證結果。不使用昨日資料替代。今日盤前劇本與盤中追蹤可在下方回顧。';
    }
    riskTone = 'yellow';
  } else if (marketPhase === 'after_close_verified') {
    intradayBias = 'verified';
    if (isReviewMode) {
      displayLabel = '最近交易日收盤驗證完成';
    } else {
      displayLabel = '收盤驗證完成';
    }

    // V44: 優先檢查收盤資料是否不足（verification_result / data_quality / closeResult）
    const cvTaiex = todayCloseVerification?.taiex_change ?? null;
    const actualResultText = todayCloseVerification?.actual_market_result || '';
    const closeResult = classifyCloseResult(cvTaiex, actualResultText);
    const premarketBias = todayReport?.market_bias || '';

    const isCloseDataInsufficient =
      todayCloseVerification?.verification_result === '資料不足' ||
      todayCloseVerification?.data_quality === 'insufficient' ||
      closeResult.includes('資料不足') ||
      closeResult.includes('資料尚未生成');

    if (isCloseDataInsufficient) {
      if (isReviewMode) {
        displayLabel = '最近交易日收盤資料不足';
      } else {
        displayLabel = '收盤資料不足';
      }
      const biasText = premarketBias ? `盤前原始假設為『${premarketBias}』，` : '';
      displayVerdict = `收盤資料不足，暫不做命中判定。${biasText}請等待下一個交易日完整資料後再驗證。`;
      riskTone = 'gray';
    } else {
      const verifSummary = todayCloseVerification?.verification_note || todayCloseVerification?.premarket_summary || '';
      const conclusionText = generateCloseVerificationConclusion(premarketBias, closeResult, cvTaiex);
      const noteSuffix = verifSummary ? `（補充說明：${verifSummary.slice(0, 100)}）` : '';

      if (isReviewMode) {
        const vr = todayCloseVerification?.verification_result || '';
        // V45: Cleaner review-mode display — uses 『』 for inline quoting
        const biasPart = premarketBias ? `盤前原始假設為『${premarketBias}』，` : '';
        const vrPart = vr ? `，驗證結論為『${vr}』` : '';
        displayVerdict = `最近交易日收盤驗證完成。${biasPart}收盤實際結果${closeResult}${vrPart}。`;
      } else {
        displayVerdict = conclusionText + noteSuffix;
      }
    }
    riskTone = 'gray';
  } else if (taiexChange === null) {
    intradayBias = 'neutral_watch';
    displayLabel = '資料不足';
    displayVerdict = '今日盤中資料不足，暫不產生方向判斷。';
    riskTone = 'gray';
  } else if (taiexChange <= TAIEX_WEAK_DROP) {
    intradayBias = 'risk_off';
    displayLabel = '盤中轉弱';
    displayVerdict = '台股盤中明顯轉弱，先以風險控管為主，不追空也不急著接刀。';
    riskTone = 'green';
  } else if (taiexChange <= TAIEX_MILD_WEAK) {
    intradayBias = 'weak_watch';
    displayLabel = '偏弱觀察';
    displayVerdict = '台股盤中偏弱，短線先觀察賣壓是否擴散，不宜過早判定反彈成立。';
    riskTone = 'green';
  } else if (taiexChange < TAIEX_MILD_STRONG) {
    intradayBias = 'neutral_watch';
    displayLabel = '震盪觀察';
    displayVerdict = '台股盤中仍在震盪區間，方向尚未明確，等待權值股與期貨訊號確認。';
    riskTone = 'yellow';
  } else {
    intradayBias = 'bullish_watch';
    displayLabel = '偏強觀察';
    displayVerdict = '台股盤中轉強，但仍需確認台積電、台指期與半導體族群是否同步補上。';
    riskTone = 'red';
  }

  // Downgrade text when data incomplete
  if (marketPhase === 'intraday' && taiexChange !== null) {
    if (!hasTxfData || !hasTsmcData) {
      const missingParts: string[] = [];
      if (!hasTxfData) missingParts.push('TXF 暫缺');
      if (!hasTsmcData) missingParts.push('2330 非今日即時');
      const suffix = missingParts.length > 0 ? `，${missingParts.join('、')}，盤中判斷需降權處理` : '';

      if (intradayBias === 'weak_watch') {
        displayVerdict = `台股盤中偏弱（TAIEX ${taiexChange >= 0 ? '+' : ''}${taiexChange.toFixed(2)}%）${suffix}。先觀察賣壓是否集中於權值股，還是擴散至多數族群。`;
      } else if (intradayBias === 'risk_off') {
        displayVerdict = `台股盤中明顯轉弱（TAIEX ${taiexChange.toFixed(2)}%）${suffix}。先以風險控管為主，確認賣壓消化後再評估。`;
      } else if (intradayBias === 'bullish_watch') {
        displayVerdict = `台股盤中轉強，但${suffix}，需等待台積電與台指期出現一致性確認訊號。`;
      }
    }
  }

  // ── Data Quality ──
  // V45: On review mode (non-trading day with historical data), don't downgrade
  // dataQuality based on today's live market data absence. The quality should reflect
  // the historical close_market_reviews data we ARE showing.
  let dataQuality: DataQuality = 'complete';
  const dataWarnings: string[] = [];

  if (isReviewMode && hasReviewData) {
    // Review mode: data quality depends on close verification availability
    const hasCloseVerif = todayCloseVerification !== null;
    const hasRadar = todayOpeningRadar !== null;
    if (hasCloseVerif && hasRadar) {
      dataQuality = 'complete';
    } else if (hasCloseVerif || hasRadar) {
      dataQuality = 'partial';
    } else {
      dataQuality = 'insufficient';
      dataWarnings.push('最近交易日收盤驗證與開盤雷達資料待同步');
    }
  } else if (!taiexFresh && taiexChange === null) {
    dataQuality = 'insufficient';
    dataWarnings.push('TAIEX 無今日資料');
  } else if (!hasTxfData && !hasTsmcData) {
    dataQuality = 'insufficient';
    dataWarnings.push('TXF 與 2330 皆缺今日資料，僅基於 TAIEX 判斷');
  } else if (!hasTxfData || !hasTsmcData) {
    dataQuality = 'partial';
    if (!hasTxfData) dataWarnings.push('TXF 暫缺');
    if (!hasTsmcData) dataWarnings.push('2330 非今日即時');
  }

  if (sectorRotationFreshness?.isStale) {
    if (dataQuality === 'complete') {
      dataQuality = 'partial';
    }
    dataWarnings.push('類股輪動資料過舊，今日族群主策略暫不採用；盤前盤中請以隔夜影響鏈為主。');
  }

  let blockedStaleData = false;
  if (!reportFresh && todayReport) {
    dataWarnings.push(`今日報告不存在，使用 ${todayReport.report_date} 歷史報告。`);
    blockedStaleData = true;
  }

  // ── V23: Report Availability ──
  const reportAvailability: ReportAvailability = {
    hasTodayReport: reportFresh,
    hasTodayRadar: radarFresh,
    hasTodayCloseVerification: closeVerificationFresh,
    shouldShowTodayReportContent: reportFresh || radarFresh,
    shouldShowCloseVerificationPending: marketPhase === 'after_close_pending' && !closeVerificationFresh,
  };

  // ── Confidence Score ──
  let confidenceScore = 0;
  let confidenceLabel = '';

  if (marketPhase === 'intraday' && todayOpeningRadar) {
    const baseScore = todayOpeningRadar.confidence_score ?? 50;

    if (dataQuality === 'complete') {
      confidenceScore = Math.min(baseScore, 85);
      confidenceLabel = '核心資料完整，把握度上限 85/100';
    } else if (dataQuality === 'partial') {
      confidenceScore = Math.min(baseScore, 65);
      confidenceLabel = '核心資料不完整，把握度上限 65/100';
    } else {
      confidenceScore = Math.min(baseScore, 55);
      confidenceLabel = '資料不足，把握度上限 55/100';
    }
  } else if (todayReport) {
    confidenceScore = Math.min(todayReport.confidence_score ?? 50, 70);
    confidenceLabel = '盤前判讀，等待開盤驗證';
  } else {
    confidenceScore = 0;
    confidenceLabel = '無可用資料';
  }

  // ── Hero Text ──
  let heroTitle = '';
  let heroSubtitle = '';

  if (isReviewMode && hasReviewData) {
    const reportDate = todayReport?.report_date || '';
    heroTitle = `今天非交易日，顯示最近交易日 ${reportDate} 完整回顧。`;
    heroSubtitle = `回看 ${reportDate} 的盤前原始假設、盤中追蹤與收盤驗證結果，累積下一次更穩定的市場判斷紀律。`;
  } else if (weekend) {
    heroTitle = '今天非交易日，先回看最近一次盤前劇本。';
    heroSubtitle = '每天 07:30 前，整理全球市場、半導體、美股與台股盤前訊號，給你一份可判讀的台股盤前劇本。';
  } else if (marketPhase === 'pre_market') {
    // V7.54: On weekdays, always say "today's pre-market report", even if data is from previous trading day
    const hasReport = todayReport !== null;
    heroTitle = hasReport ? '今日盤前報告已更新' : '今天開盤前，先看盤前劇本站在哪一邊。';
    heroSubtitle = hasReport
      ? `盤前判讀已結合今日自動化流程更新，使用最近完整交易日 ${todayReport?.report_date || ''} 資料。`
      : '每天 07:30 前，整理全球市場、半導體、美股與台股盤前訊號，給你一份可判讀的台股盤前劇本。';
  } else if (marketPhase === 'intraday') {
    heroTitle = '現在盤中，先看市場正在驗證哪個劇本。';
    heroSubtitle = '用 TAIEX、台指期、台積電與族群輪動，確認盤前劇本是否成立。';
  } else if (marketPhase === 'after_close_pending') {
    heroTitle = '今日盤前與盤中追蹤已完成，等待收盤驗證。';
    heroSubtitle = '先回看今日盤前劇本與盤中追蹤；收盤資料同步後，系統會補上今日驗證結果。';
  } else {
    heroTitle = '今日收盤驗證完成，回看劇本是否符合實際走勢。';
    heroSubtitle = '系統已完成今日盤前劇本、盤中追蹤與收盤資料對照，可查看今日驗證結果。';
  }

  // ── Timeline Items ──
  const timelineItems: TimelineItem[] = buildTimelineItems(
    todayReport,
    todayOpeningRadar,
    todayCloseVerification,
    todayStr,
    marketPhase,
    weekend,
    reportFresh,
    radarFresh,
  );

  // ── Top Three Focus ──
  const topThreeFocus: TopThreeItem[] = buildTopThreeFocus(
    intradayBias,
    marketPhase,
    taiexChange,
    hasTxfData,
    hasTsmcData,
  );

  return {
    todayDate: todayStr,

    marketPhase,
    intradayBias,
    dataQuality,
    riskTone,

    displayLabel,
    displayVerdict,
    heroTitle,
    heroSubtitle,

    confidenceScore,
    confidenceLabel,

    dataWarnings,
    blockedStaleData,

    sourceFreshness: {
      taiexFresh,
      txfFresh,
      tsmcFresh,
      reportFresh,
      radarFresh,
      closeVerificationFresh,
    },

    reportAvailability,

    timelineItems,
    topThreeFocus,
  };
}

// ════════════════════════════════════════════
// Timeline Builder
// ════════════════════════════════════════════

function buildTimelineItems(
  report: Report | null,
  openingRadar: OpeningRadar | null,
  closeVerif: CloseMarketReview | null,
  todayStr: string,
  phase: MarketPhase,
  weekend: boolean,
  reportFresh: boolean,
  radarFresh: boolean,
): TimelineItem[] {
  const items: TimelineItem[] = [];

  // ── 07:30 盤前劇本 ──
  if (report && report.report_date === todayStr) {
    items.push({
      time: '07:30',
      title: '盤前劇本',
      status: report.market_bias || '已生成',
      confidence: report.confidence_score ?? null,
      description: `盤前判讀把握度 ${report.confidence_score ?? '—'}/100，${report.market_bias || '等待開盤驗證'}。`,
    });
  } else if (report && !reportFresh) {
    items.push({
      time: '07:30',
      title: '盤前劇本（最近交易日）',
      status: report.market_bias || '已生成',
      confidence: report.confidence_score ?? null,
      description: `資料日期：${report.report_date}，非今日報告。`,
    });
  } else {
    items.push({
      time: '07:30',
      title: '盤前劇本',
      status: weekend ? '非交易日' : '等待生成',
      confidence: null,
      description: weekend ? '今天非交易日，盤前劇本暫停產生。' : '每日 07:30 自動生成。',
    });
  }

  // ── 09:15 盤中追蹤 ──
  if (openingRadar && radarFresh) {
    const taiexTxt = openingRadar.taiex_change !== null
      ? `TAIEX ${openingRadar.taiex_change >= 0 ? '+' : ''}${openingRadar.taiex_change.toFixed(2)}%`
      : '';
    const txfTxt = openingRadar.txf_change !== null
      ? `TXF ${openingRadar.txf_change >= 0 ? '+' : ''}${openingRadar.txf_change.toFixed(2)}%`
      : 'TXF 暫缺';
    const tsmcTxt = openingRadar.tsmc_change !== null
      ? `2330 ${openingRadar.tsmc_change >= 0 ? '+' : ''}${openingRadar.tsmc_change.toFixed(2)}%`
      : '2330 暫缺';
    const parts = [taiexTxt, txfTxt, tsmcTxt].filter(Boolean);

    let radarStatus = openingRadar.radar_status;
    let radarDescription = `盤中判讀把握度 ${openingRadar.confidence_score ?? '—'}/100。${parts.join('，')}`;

    if (phase === 'after_close_verified' && closeVerif) {
      const cvTaiex = closeVerif.taiex_change;
      if (cvTaiex !== null && cvTaiex <= -1.00) {
        radarStatus = '風險未解除';
        radarDescription = `盤中訊號未能扭轉盤前風險，收盤結果偏弱（TAIEX ${cvTaiex >= 0 ? '+' : ''}${cvTaiex.toFixed(2)}%），後續需降低偏多判讀權重。`;
      } else if (cvTaiex !== null && cvTaiex <= -0.30) {
        radarStatus = '偏弱觀察';
        radarDescription = `收盤結果偏弱（TAIEX ${cvTaiex >= 0 ? '+' : ''}${cvTaiex.toFixed(2)}%），盤中追蹤未能有效轉向。`;
      } else if (cvTaiex !== null && cvTaiex < 0.30) {
        radarStatus = '震盪觀察';
        radarDescription = `收盤結果為震盪（TAIEX ${cvTaiex >= 0 ? '+' : ''}${cvTaiex.toFixed(2)}%），盤中方向未明確表態。`;
      } else if (cvTaiex !== null) {
        radarStatus = '偏強觀察';
        radarDescription = `收盤結果偏強（TAIEX ${cvTaiex >= 0 ? '+' : ''}${cvTaiex.toFixed(2)}%），盤中訊號獲得確認。`;
      }
    }

    items.push({
      time: '09:15',
      title: '盤中追蹤',
      status: radarStatus,
      confidence: openingRadar.confidence_score ?? null,
      description: radarDescription,
    });
  } else if (openingRadar && !radarFresh) {
    items.push({
      time: '09:15',
      title: '盤中追蹤（最近交易日）',
      status: openingRadar.radar_status,
      confidence: openingRadar.confidence_score ?? null,
      description: `資料日期：${openingRadar.report_date}，非今日雷達。`,
    });
  } else {
    items.push({
      time: '09:15',
      title: '盤中追蹤',
      status: weekend ? '非交易日' : (phase === 'pre_market' ? '等待開盤' : '等待更新'),
      confidence: null,
      description: weekend
        ? '今天非交易日，盤中追蹤暫停。'
        : phase === 'pre_market'
        ? '09:15 開盤後將自動更新。'
        : '開盤雷達尚未更新。',
    });
  }

  // ── 13:30 收盤驗證 ──
  if (phase === 'after_close_verified') {
    const verificationNote = closeVerif?.verification_note ?? closeVerif?.verification_result ?? null;
    const descriptionParts: string[] = ['今日收盤驗證已完成。'];
    if (closeVerif?.verification_result) {
      descriptionParts.push(`結果：${closeVerif.verification_result}。`);
    }
    if (closeVerif?.premarket_summary) {
      descriptionParts.push(`盤前假設：${closeVerif.premarket_summary.slice(0, 80)}...`);
    }
    items.push({
      time: '13:30',
      title: '今日收盤驗證',
      status: '已完成',
      confidence: null,
      description: descriptionParts.join(''),
    });
  } else if (phase === 'after_close_pending') {
    items.push({
      time: '13:30',
      title: '今日收盤驗證',
      status: '待完成',
      confidence: null,
      description: '今日已收盤，系統正在等待今日收盤資料與驗證結果，不使用昨日資料替代。',
    });
  } else {
    items.push({
      time: '13:30',
      title: '今日收盤驗證',
      status: weekend ? '非交易日' : '待收盤後更新',
      confidence: null,
      description: weekend ? '今天非交易日。' : '13:30 收盤後將進行驗證。',
    });
  }

  return items;
}

// ════════════════════════════════════════════
// Top Three Focus Builder
// ════════════════════════════════════════════

function buildTopThreeFocus(
  bias: IntradayBias,
  phase: MarketPhase,
  _taiexChange: number | null,
  hasTxf: boolean,
  hasTsmc: boolean,
): TopThreeItem[] {
  const dataNote = (!hasTxf || !hasTsmc) ? '，但需注意資料不完整' : '';

  if (phase === 'pre_market') {
    return [
      {
        title: '等待開盤確認',
        description: '盤前劇本已生成，等待 09:00 開盤後以實際走勢驗證盤前假設。',
        score: 70,
      },
      {
        title: '觀察全球市場收盤',
        description: '美股、半導體、美元、美債等外部指標是盤前劇本的主要依據。',
        score: 65,
      },
      {
        title: '不躁進，等訊號',
        description: '盤前資訊僅為假設，開盤後實際資金流向才是確認的關鍵。',
        score: 60,
      },
    ];
  }

  if (phase === 'after_close_pending' || phase === 'after_close_verified') {
    if (phase === 'after_close_pending') {
      return [
        {
          title: '今日盤前劇本回顧',
          description: '回看 07:30 盤前假設與市場開盤後是否一致，確認盤前主線判斷是否經得起盤中驗證。',
          score: 75,
        },
        {
          title: '今日盤中追蹤回顧',
          description: '檢查 09:15 後 TAIEX、台指期、台積電與族群輪動是否支持盤前劇本，找出盤中關鍵轉折。',
          score: 70,
        },
        {
          title: '等待收盤驗證',
          description: '收盤資料同步後，系統才會產生今日最終驗證，不使用昨日資料替代。',
          score: 60,
        },
      ];
    }
    return [
      {
        title: '收盤驗證完成',
        description: '收盤後系統已比對今日盤前劇本、盤中追蹤與實際收盤結果，可回看今日劇本是否符合實際走勢。',
      },
      {
        title: '回看盤中關鍵轉折',
        description: '確認今日盤中是否有重大訊號改變了盤前假設方向，作為明日盤前判斷參考。',
      },
      {
        title: '累積下一次判斷品質',
        description: '每次驗證都是下次盤前判讀的參考基礎，連續驗證能提高系統判斷準確度。',
      },
    ];
  }

  if (bias === 'risk_off') {
    return [
      {
        title: '觀察賣壓是否擴散',
        description: 'TAIEX 盤中明顯轉弱，需確認是否只是權值股壓回，或擴散到多數族群。',
      },
      {
        title: '等待 TXF 與 2330 補上確認',
        description: `台指期或台積電資料不足時${dataNote}，不宜把盤中方向判斷得過滿。`,
      },
      {
        title: '降低追價與重倉風險',
        description: '盤中轉弱時先控制部位節奏，不因單一反彈訊號過早放大風險。',
      },
    ];
  }

  if (bias === 'weak_watch') {
    return [
      {
        title: '觀察賣壓是否擴散',
        description: 'TAIEX 盤中偏弱，需確認是否只是權值股壓回，或擴散到多數族群。',
      },
      {
        title: '等待 TXF 與 2330 補上確認',
        description: `台指期或台積電資料不足時${dataNote}，不宜把盤中方向判斷得過滿。`,
      },
      {
        title: '降低追價與重倉風險',
        description: '盤中偏弱時先控制部位節奏，不因單一反彈訊號過早放大風險。',
      },
    ];
  }

  if (bias === 'bullish_watch') {
    return [
      {
        title: '確認反彈是否成立',
        description: `TAIEX 盤中轉強${dataNote}，需確認權值股與半導體族群是否同步補上。`,
      },
      {
        title: '觀察權值股承接',
        description: '台積電與大型權值股是今日反彈能否延續的核心觀察點。',
      },
      {
        title: '不追高，等量能與族群擴散',
        description: '盤中反彈驗證中，不代表全面樂觀，仍需觀察量能與族群擴散。',
      },
    ];
  }

  return [
    {
      title: '等待方向突破',
      description: '台股盤中仍在震盪區間，等待明確的多空方向表態。',
    },
    {
      title: '觀察權值股與期貨同步性',
      description: '權值股與台指期的同步性是判斷方向可靠度的重要依據。',
    },
    {
      title: '控制短線交易頻率',
      description: '震盪區間內頻繁交易容易被雙邊掃損，以觀察為主。',
    },
  ];
}

// ════════════════════════════════════════════
// V45 PM Consistency: Shared non-trading-day message
// ════════════════════════════════════════════

/**
 * Unified non-trading-day reminder text.
 * Every page MUST use this function instead of hardcoding its own version.
 *
 * Rule: Non-trading day ≠ data insufficient.
 * On non-trading days, the system shows the latest trading day's data.
 */
export function formatNonTradingDayReminder(fallbackDate: string | null | undefined): string {
  const date = fallbackDate || '最近交易日';
  return `今天非交易日，以下顯示最近交易日（${date}）資料。非交易日不產生新報告，不影響資料完整性與驗證結論。`;
}

/**
 * Compact badge version — just the key info without the full explanation.
 */
export function formatNonTradingDayBadge(fallbackDate: string | null | undefined): string {
  const date = fallbackDate || '最近交易日';
  return `最近交易日 ${date}`;
}

/**
 * 收盤驗證完成的今日心法（統一一律使用此文案）
 */
export const AFTER_CLOSE_VERIFIED_WISDOM = '收盤驗證是明天判斷的基礎。回看今天的盤前假設與收盤結果，才能累積穩定判斷規律。';

/**
 * 收盤資料不足時的心法
 */
export const CLOSE_DATA_INSUFFICIENT_WISDOM = '資料不足時不要硬判斷，等完整收盤資料出現後再回測盤前假設。';

// ════════════════════════════════════════════
// Convenience: Report title based on marketPhase
// ════════════════════════════════════════════

export function getReportTitle(phase: MarketPhase, hasReportContent = true): string {
  switch (phase) {
    case 'pre_market':
      return 'Morning Alpha 盤前完整判讀';
    case 'intraday':
      return 'Morning Alpha 盤中追蹤判讀';
    case 'after_close_pending':
      return hasReportContent ? 'Morning Alpha 今日判讀摘要' : 'Morning Alpha 收盤後待驗證';
    case 'after_close_verified':
      return 'Morning Alpha 今日完整判讀';
  }
}

// ════════════════════════════════════════════
// Data quality display labels
// ════════════════════════════════════════════

export function getDataQualityLabel(quality: DataQuality): string {
  switch (quality) {
    case 'complete': return '資料完整';
    case 'partial': return '資料部分完整';
    case 'insufficient': return '資料不足';
    case 'mismatch': return '資料異常';
  }
}

// ════════════════════════════════════════════
// Report status label (for WarRoom)
// ════════════════════════════════════════════

export function getWarRoomStatusLabel(state: MarketState): string {
  if (state.marketPhase === 'after_close_verified') {
    return '今日收盤驗證已完成，盤中追蹤已進入收盤後驗證階段。';
  }
  if (state.marketPhase === 'after_close_pending') {
    return `今日已收盤，等待盤後驗證。（TAIEX ${state.confidenceScore > 0 ? '資料可用' : '資料不足'}）`;
  }
  return state.displayVerdict;
}