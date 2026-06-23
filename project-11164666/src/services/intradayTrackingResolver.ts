/**
 * resolveIntradayTrackingState — SINGLE SOURCE OF TRUTH for intraday page data status
 *
 * Determines the freshness and display status of four data segments:
 *   1. 07:30 盤前假設 (reports)
 *   2. 09:30 盤中雷達 (opening_market_radar + market_data)
 *   3. 14:10 收盤驗證 (close_market_reviews)
 *   4. 14:20 類股輪動 (sector_rotation_scores)
 *
 * RULES:
 * - If a data source has no TODAY data, NEVER show yesterday's data as today's
 * - Yesterday's data may be shown as "上一交易日參考" but NOT as "今日已更新"
 * - market_data_date from reports is a PREMARKET basis date, NOT a radar date
 */

import type { OpeningRadar } from '@/services/openingRadarService';
import type { CloseMarketReview } from '@/services/closeMarketReviewService';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { SectorRotationItem, SectorRotationFreshness } from '@/services/sectorRotationService';
import type { Report } from '@/types/report';
import { isFreshIntradayData } from '@/utils/intradayFreshness';

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function getDateOnly(value: unknown): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function isDateToday(dateVal: string | null | undefined, todayStr: string): boolean {
  if (!dateVal) return false;
  return String(dateVal).slice(0, 10) === todayStr;
}

/**
 * Try to extract a date from a row's date-like columns.
 */
function getRowDate(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  return getDateOnly(
    row.trading_date ||
    row.report_date ||
    row.market_data_date ||
    row.score_date ||
    row.captured_at ||
    row.created_at ||
    row.updated_at ||
    row.generated_at,
  );
}

// ═══════════════════════════════════════════
// Status enums
// ═══════════════════════════════════════════

export type SegmentStatus =
  | 'ready'           // Today's data exists and is valid
  | 'not_updated'     // No today data yet, but it's before the expected time
  | 'pending'         // After expected time but data not yet generated
  | 'stale'           // Only old data exists, cannot use as today
  | 'stale_reference' // Old data exists and is shown as reference (not today)
  | 'missing';        // No data at all

export interface SegmentDisplay {
  /** Primary status badge text */
  statusText: string;
  /** Detailed description */
  description: string;
  /** Color scheme for the card */
  color: 'green' | 'amber' | 'red' | 'slate';
  /** Whether content should be rendered */
  showContent: boolean;
  /** The date this segment's data represents */
  dataDate: string | null;
  /** True only when data is from today */
  isToday: boolean;
}

export interface IntradayTrackingState {
  // ── Dates ──
  reportDate: string | null;
  premarketBaseDate: string | null;
  intradayRadarDate: string | null;
  closeReviewDate: string | null;
  sectorRotationDate: string | null;

  // ── Statuses ──
  premarketStatus: SegmentStatus;
  intradayStatus: SegmentStatus;
  closeReviewStatus: SegmentStatus;
  sectorRotationStatus: SegmentStatus;

  // ── Boolean flags ──
  hasTodayMarketData: boolean;
  hasTodayOpeningRadar: boolean;
  hasTodayCloseReview: boolean;
  hasTodaySectorRotation: boolean;

  isOpeningRadarStale: boolean;
  isCloseReviewStale: boolean;
  isSectorRotationStale: boolean;

  // ── Display-ready segments ──
  premarket: SegmentDisplay;
  intraday: SegmentDisplay;
  closeReview: SegmentDisplay;
  sectorRotation: SegmentDisplay;
}

export interface IntradayTrackingInput {
  /** Active Morning Alpha report */
  report: Report | null;
  /** report_date from the report */
  reportDate: string | null;
  /** market_data_date from ai_strategy_json */
  premarketBaseDate: string | null;
  /** Taipei today in YYYY-MM-DD */
  todayDate: string;
  /** Opening radar row */
  openingRadar: OpeningRadar | null;
  /** Today-only market data rows */
  marketDataTodayOnly: SupabaseMarketData[] | null;
  /** All market data rows (fallback to check freshness) */
  marketData: SupabaseMarketData[] | null;
  /** Close market review */
  closeReview: CloseMarketReview | null;
  /** Sector rotation items */
  sectorItems: SectorRotationItem[];
  /** Sector rotation score date */
  sectorScoreDate: string | null;
  /** Sector rotation freshness */
  sectorFreshness: SectorRotationFreshness | null;
  /** Current Taipei hour */
  taipeiHour: number;
  /** Whether today is a weekend */
  isWeekend: boolean;
}

/**
 * Build the intraday tracking state from all data sources.
 * This is a PURE function — no side effects, no Supabase calls.
 */
export function resolveIntradayTrackingState(input: IntradayTrackingInput): IntradayTrackingState {
  const {
    report, reportDate, premarketBaseDate, todayDate,
    openingRadar, marketDataTodayOnly,
    closeReview, sectorItems, sectorScoreDate, sectorFreshness,
    taipeiHour, isWeekend,
  } = input;

  // ═══ 1. Premarket (07:30) ═══
  const premarketStatus: SegmentStatus = report ? 'ready' : 'missing';
  const premarketDisplay: SegmentDisplay = report
    ? {
        statusText: '已產生',
        description: `盤前假設來自 ${reportDate || '—'} 報告，市場資料基準：${premarketBaseDate || '—'} 收盤`,
        color: 'green',
        showContent: true,
        dataDate: reportDate,
        isToday: reportDate === todayDate,
      }
    : {
        statusText: '尚未產生',
        description: '尚無盤前報告資料，請確認 Daily Report 排程是否正常。',
        color: 'red',
        showContent: false,
        dataDate: null,
        isToday: false,
      };

  // ═══ 2. Intraday Radar (09:30) ═══
  const radarDate = openingRadar?.report_date || null;
  const radarFreshness = isFreshIntradayData({ report_date: reportDate }, openingRadar as unknown as Record<string, unknown> | null);
  const radarIsToday = isDateToday(radarDate, todayDate);
  const radarIsFreshToday = radarFreshness.fresh;

  // Check if market_data has today data with TW core symbols
  const todayMkt = marketDataTodayOnly ?? [];
  const hasTaiex = todayMkt.some((m) => m.symbol === 'TAIEX');
  const hasTsmc = todayMkt.some((m) => m.symbol === '2330');
  const hasTxf = todayMkt.some((m) => m.symbol === 'TXF');
  const hasTodayMarketData = hasTaiex || hasTsmc || hasTxf;

  let intradayStatus: SegmentStatus;
  let radarDisplay: SegmentDisplay;

  if (radarIsFreshToday && openingRadar) {
    // Today's radar exists
    intradayStatus = 'ready';
    radarDisplay = {
      statusText: '盤中雷達已更新',
      description: `資料時間：${radarFreshness.timestampLabel || todayDate}｜狀態：${openingRadar.radar_status || '—'}`,
      color: 'green',
      showContent: true,
      dataDate: todayDate,
      isToday: true,
    };
  } else if (openingRadar && !radarIsFreshToday) {
    // A radar row exists, but it is not a verified today intraday record. Never render its numbers.
    intradayStatus = 'stale';
    radarDisplay = {
      statusText: '盤中資料尚未同步',
      description: radarIsToday
        ? '盤中資料尚未同步。目前僅顯示 07:30 盤前假設，尚未取得今日 09:00 後盤中資料。昨日收盤漲跌不會作為今日盤中確認。'
        : `目前僅有 ${radarDate || '—'} 的舊雷達資料。今日尚未開盤或資料尚未更新。請等待 09:30 / 10:30 / 13:00。`,
      color: 'amber',
      showContent: false,
      dataDate: radarDate,
      isToday: false,
    };
  } else if (hasTodayMarketData) {
    // No radar but market_data has today data
    intradayStatus = 'pending';
    radarDisplay = {
      statusText: '今日市場資料已更新，等待雷達判讀',
      description: `market_data 已有 ${todayDate} 的 TAIEX/2330/TXF 資料，等待 opening_market_radar 判讀。`,
      color: 'amber',
      showContent: true,
      dataDate: todayDate,
      isToday: true,
    };
  } else if (isWeekend) {
    intradayStatus = 'not_updated';
    radarDisplay = {
      statusText: '非交易日',
      description: '今日為非交易日，不產生盤中雷達。',
      color: 'slate',
      showContent: false,
      dataDate: null,
      isToday: false,
    };
  } else {
    // No radar data at all
    intradayStatus = 'not_updated';
    radarDisplay = {
      statusText: '盤中雷達尚未更新',
      description: '目前尚未取得今日盤中雷達資料，請等待 09:30 / 10:30 / 13:00 更新。',
      color: 'amber',
      showContent: false,
      dataDate: null,
      isToday: false,
    };
  }

  // ═══ 3. Close Review (14:10) ═══
  const closeDate = closeReview?.report_date || null;
  const closeIsToday = isDateToday(closeDate, todayDate);
  const isAfterClose = taipeiHour >= 14 || (taipeiHour === 13 && new Date().getMinutes() >= 30);

  let closeReviewStatus: SegmentStatus;
  let closeDisplay: SegmentDisplay;

  if (closeIsToday && closeReview?.verification_result === 'PENDING_REAL_MARKET_DATA') {
    closeReviewStatus = 'pending';
    closeDisplay = {
      statusText: '等待真實收盤資料',
      description: '收盤驗證已執行，但尚缺真實台股收盤資料。系統未使用假資料。',
      color: 'amber',
      showContent: true,
      dataDate: todayDate,
      isToday: true,
    };
  } else if (closeIsToday && closeReview) {
    closeReviewStatus = 'ready';
    closeDisplay = {
      statusText: '收盤驗證已完成',
      description: `驗證結果：${closeReview.verification_result || '—'}｜TAIEX ${closeReview.taiex_change != null ? (closeReview.taiex_change >= 0 ? '+' : '') + closeReview.taiex_change.toFixed(2) + '%' : '—'}`,
      color: 'green',
      showContent: true,
      dataDate: todayDate,
      isToday: true,
    };
  } else if (closeReview && !closeIsToday) {
    // Only old close review exists
    closeReviewStatus = 'stale';
    closeDisplay = {
      statusText: '今日收盤驗證尚未產生',
      description: `目前僅有 ${closeDate || '—'} 的舊驗證資料，不可作為今日收盤結果。`,
      color: 'red',
      showContent: false,
      dataDate: closeDate,
      isToday: false,
    };
  } else if (isWeekend) {
    closeReviewStatus = 'not_updated';
    closeDisplay = {
      statusText: '非交易日',
      description: '今日為非交易日，不產生收盤驗證。',
      color: 'slate',
      showContent: false,
      dataDate: null,
      isToday: false,
    };
  } else if (!isAfterClose) {
    // Before 14:10
    closeReviewStatus = 'not_updated';
    closeDisplay = {
      statusText: '收盤驗證尚未開始',
      description: '目前尚未到收盤時間，收盤驗證將於 14:10 後產生。',
      color: 'slate',
      showContent: false,
      dataDate: null,
      isToday: false,
    };
  } else {
    // After 14:10 but no data
    closeReviewStatus = 'pending';
    closeDisplay = {
      statusText: '今日收盤驗證尚未產生',
      description: '收盤時間已過，等待 close-market-review 排程執行。',
      color: 'amber',
      showContent: false,
      dataDate: null,
      isToday: false,
    };
  }

  // ═══ 4. Sector Rotation (14:20) ═══
  const sectorIsToday = isDateToday(sectorScoreDate, todayDate);
  const canUseAsToday = sectorFreshness?.canUseAsTodayStrategy ?? false;

  let sectorRotationStatus: SegmentStatus;
  let sectorDisplay: SegmentDisplay;

  if (sectorIsToday && canUseAsToday) {
    sectorRotationStatus = 'ready';
    sectorDisplay = {
      statusText: '今日類股輪動已更新',
      description: `資料日期：${todayDate}｜共 ${sectorItems.length} 個類股`,
      color: 'green',
      showContent: true,
      dataDate: todayDate,
      isToday: true,
    };
  } else if (sectorIsToday && !canUseAsToday) {
    // Today data exists but premature (before 14:15)
    sectorRotationStatus = 'pending';
    sectorDisplay = {
      statusText: '今日類股輪動需待收盤後驗證',
      description: '今日類股輪動資料於 14:15 前產生，可能非最終收盤後驗證結果。',
      color: 'amber',
      showContent: true,
      dataDate: todayDate,
      isToday: true,
    };
  } else if (sectorItems.length > 0 && sectorScoreDate) {
    // Has data but not today's
    sectorRotationStatus = 'stale_reference';
    sectorDisplay = {
      statusText: '上一交易日類股參考',
      description: `資料日期：${sectorScoreDate}｜此資料為上一筆類股輪動參考，不代表今日即時輪動。`,
      color: 'slate',
      showContent: true,
      dataDate: sectorScoreDate,
      isToday: false,
    };
  } else {
    sectorRotationStatus = 'missing';
    sectorDisplay = {
      statusText: '類股輪動尚未產生',
      description: '尚無任何類股輪動資料。請確認 generate-sector-rotation 排程是否正常。',
      color: 'red',
      showContent: false,
      dataDate: null,
      isToday: false,
    };
  }

  return {
    reportDate,
    premarketBaseDate,
    intradayRadarDate: radarIsToday ? todayDate : radarDate,
    closeReviewDate: closeIsToday ? todayDate : closeDate,
    sectorRotationDate: sectorIsToday ? todayDate : sectorScoreDate,

    premarketStatus,
    intradayStatus,
    closeReviewStatus,
    sectorRotationStatus,

    hasTodayMarketData,
    hasTodayOpeningRadar: radarIsFreshToday,
    hasTodayCloseReview: closeIsToday,
    hasTodaySectorRotation: sectorIsToday && canUseAsToday,

    isOpeningRadarStale: !radarIsToday && openingRadar !== null,
    isCloseReviewStale: !closeIsToday && closeReview !== null,
    isSectorRotationStale: !sectorIsToday && sectorItems.length > 0,

    premarket: premarketDisplay,
    intraday: radarDisplay,
    closeReview: closeDisplay,
    sectorRotation: sectorDisplay,
  };
}
