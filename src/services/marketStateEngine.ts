/**
 * Legacy MarketState presentation adapter.
 *
 * SubscriberReportProjection is the only analysis/publication/runtime authority.
 * This module formats that projection into the old shape; it never interprets
 * raw radar/closing/confidence fields or creates evidence from the browser clock.
 * Independent quote-freshness utilities remain available to data services.
 */
import { formatTaipeiDate } from '../utils/tradingDay.ts';
import { getSubscriberReportProjection, type SubscriberReportProjection } from '../lib/subscriberReportContract.ts';
import type { SupabaseMarketData } from './marketDataService';

export type MarketPhase = 'pre_market' | 'intraday' | 'after_close_pending' | 'after_close_verified';
export type IntradayBias = 'pre_market_only' | 'bullish_watch' | 'neutral_watch' | 'weak_watch' | 'risk_off' | 'after_close_pending' | 'verified';
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
  confidenceScore: number | null;
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
  reportAvailability: ReportAvailability;
  timelineItems: TimelineItem[];
  topThreeFocus: TopThreeItem[];
}

export interface BuildMarketStateParams {
  /** Prefer the already-resolved projection; an explicit projection wins over
   * any detached raw report supplied by a legacy caller. */
  projection?: SubscriberReportProjection;
  /** Full row/envelope, never a caller-selected nested state alias. */
  todayReport?: unknown;
  todayMarketData?: SupabaseMarketData[] | null;
  /** Source-compatible, intentionally ignored: these are not state authority. */
  todayOpeningRadar?: unknown;
  todayCloseVerification?: unknown;
  sectorRotationFreshness?: unknown;
  /** Used only for the current date/quote freshness, never runtime completion. */
  nowTaipei?: Date;
}

function isFreshToday(dateStr: string | null | undefined, todayStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return Number.isFinite(date.getTime()) && formatTaipeiDate(date) === todayStr;
}

/** Pure quote date filtering, not publication or execution proof. */
export function isMarketDataToday(
  item: { captured_at?: string; updated_at?: string },
  todayStr?: string,
): boolean {
  return isFreshToday(item.updated_at || item.captured_at, todayStr || formatTaipeiDate());
}

/** Input is newest-first, as supplied by the market-data service. Preserve one
 * current-day record per symbol without mutating the caller's array. */
export function getTodayOnlyMarketData(
  allMarketData: SupabaseMarketData[] | null | undefined,
  todayStr?: string,
): SupabaseMarketData[] {
  const today = todayStr || formatTaipeiDate();
  const seen = new Set<string>();
  return (allMarketData || []).filter(item => {
    if (seen.has(item.symbol) || !isMarketDataToday(item, today)) return false;
    seen.add(item.symbol);
    return true;
  });
}

export function getMarketDataFreshnessLabel(
  symbol: string,
  allMarketData: SupabaseMarketData[] | null | undefined,
  todayStr?: string,
): { isFresh: boolean; label: string; staleDate: string | null } {
  const item = allMarketData?.find(row => row.symbol === symbol);
  if (!item) return { isFresh: false, label: `${symbol} 暫缺`, staleDate: null };
  if (isMarketDataToday(item, todayStr)) {
    return { isFresh: true, label: `${symbol} 今日即時`, staleDate: null };
  }
  const staleDate = (item.updated_at || item.captured_at || '').slice(0, 10);
  return { isFresh: false, label: `${symbol} 非今日即時（${staleDate}）`, staleDate };
}

const CHECKPOINT_TITLES = {
  '0900': '開盤資料',
  '0930': '開盤驗證',
  '1030': '主線確認',
  '1300': '盤中追蹤',
  '1410': '收盤資料',
  '1430': '收盤驗證',
} as const;

/** Compatibility formatting only. All completion, availability and confidence
 * come directly from the shared projection, not quote presence or elapsed time. */
export function buildMarketState(params: BuildMarketStateParams): MarketState {
  const projection = params.projection ?? getSubscriberReportProjection(params.todayReport, {
    todayDate: formatTaipeiDate(params.nowTaipei),
  });
  const todayDate = projection.identity.todayDate || formatTaipeiDate(params.nowTaipei);
  const reportFresh = projection.identity.reportDate === todayDate && !projection.historical;
  const radarFresh = reportFresh && projection.runtime.confirmedIntradayEvidence;
  const closeVerificationFresh = reportFresh && projection.closing.complete;
  const closingPending = projection.analysisAvailable
    && (projection.closing.state === 'PENDING' || projection.closing.state === 'INSUFFICIENT_EVIDENCE');
  const marketPhase: MarketPhase = projection.closing.complete ? 'after_close_verified'
    : closingPending ? 'after_close_pending'
    : projection.runtime.confirmedIntradayEvidence ? 'intraday' : 'pre_market';
  const intradayBias: IntradayBias = projection.closing.complete ? 'verified'
    : closingPending ? 'after_close_pending'
    : projection.marketDecision.action === 'STOP' ? 'risk_off'
    : projection.runtime.confirmedIntradayEvidence ? 'neutral_watch' : 'pre_market_only';
  const dataQuality: DataQuality = projection.evidence.status === 'IDENTITY_MISMATCH' ? 'mismatch'
    : projection.displayStatus === 'PARTIAL' ? 'partial'
    : projection.analysisAvailable ? 'complete' : 'insufficient';
  // Existing Taiwan market color convention, applied only to projected text.
  const bias = projection.marketDecision.bias || '';
  const riskTone: RiskTone = !projection.analysisAvailable ? 'gray'
    : /偏空|偏弱|強空/.test(bias) ? 'green'
    : /偏多|偏強|強多/.test(bias) ? 'red' : 'yellow';
  const dataWarnings = [
    ...(!projection.analysisAvailable ? [projection.statusLabel] : []),
    ...(projection.historical ? [`資料日期：${projection.identity.reportDate}，非今日報告。`] : []),
  ];
  const quoteFresh = (symbol: string) => (params.todayMarketData || [])
    .some(item => item.symbol === symbol && isMarketDataToday(item, todayDate));
  const timelineItems: TimelineItem[] = [
    {
      time: '07:30', title: '盤前劇本', status: projection.statusLabel,
      confidence: projection.confidence.value,
      description: projection.marketDecision.summary || projection.statusLabel,
    },
    ...Object.entries(CHECKPOINT_TITLES).map(([key, title]): TimelineItem => {
      const checkpoint = projection.runtime.checkpoints[key as keyof typeof CHECKPOINT_TITLES];
      return {
        time: `${key.slice(0, 2)}:${key.slice(2)}`, title,
        status: checkpoint.status,
        confidence: null,
        description: projection.runtime.decisionEvidence.reason,
      };
    }),
  ];
  return {
    todayDate, marketPhase, intradayBias, dataQuality, riskTone,
    displayLabel: projection.marketDecision.label,
    displayVerdict: projection.marketDecision.summary || projection.statusLabel,
    heroTitle: projection.historical ? projection.statusLabel : projection.title,
    heroSubtitle: projection.marketDecision.summary || projection.statusLabel,
    confidenceScore: projection.confidence.value,
    confidenceLabel: projection.confidence.label,
    dataWarnings,
    blockedStaleData: projection.historical,
    sourceFreshness: {
      taiexFresh: quoteFresh('TAIEX'), txfFresh: quoteFresh('TXF'), tsmcFresh: quoteFresh('2330'),
      reportFresh, radarFresh, closeVerificationFresh,
    },
    reportAvailability: {
      hasTodayReport: reportFresh && projection.analysisAvailable,
      hasTodayRadar: radarFresh,
      hasTodayCloseVerification: closeVerificationFresh,
      shouldShowTodayReportContent: reportFresh && projection.analysisAvailable,
      shouldShowCloseVerificationPending: reportFresh && closingPending,
    },
    timelineItems,
    topThreeFocus: [
      { title: '市場判斷', description: projection.marketDecision.label },
      { title: '驗證進度', description: projection.runtime.decisionEvidence.reason },
      { title: '個股推薦', description: projection.recommendation.message || '只顯示已通過推薦證據的個股。' },
    ],
  };
}
