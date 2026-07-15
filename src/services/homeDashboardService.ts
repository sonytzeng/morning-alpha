import { mapRowToReport } from '@/services/reportService';
import { type IntradayCheck } from '@/services/intradayCheckService';
import {
  computeDataTrustStatus,
  type MarketSourceHealth,
  isTaipeiToday,
} from '@/services/marketSourceHealthService';
import type { SupabaseMarketData } from '@/services/marketDataService';
import type { Report } from '@/types/report';
import { mapRowToOpeningRadar, type OpeningRadar } from '@/services/openingRadarService';
import { getTodayOnlyMarketData } from '@/services/marketStateEngine';
import { mapClosingVerificationToCloseMarketReview, type CloseMarketReview } from '@/services/closeMarketReviewService';
import { normalizeMorningAlphaReport, type MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';

export interface HomeDashboardData {
  marketData: SupabaseMarketData[];
  /** V22: Today-only market data — excludes records from previous dates */
  marketDataTodayOnly: SupabaseMarketData[];
  report: Report | null;
  intradayCheck: IntradayCheck | null;
  openingRadar: OpeningRadar | null;
  marketSourceHealth: MarketSourceHealth[];
  dataTrustStatus: ReturnType<typeof computeDataTrustStatus> | null;
  latestNewsAt: string | null;
  /** 今日 AI 精選新聞數 (is_selected=true) */
  selectedNewsCount: number;
  /** 今日總新聞數 (published_at 或 created_at 在台北今日範圍內) */
  totalNewsCount: number;
  lastSyncAt: string | null;
  error: string | null;
  /** V10: True when today has no report and we fell back to historical data */
  isHistoricalFallback: boolean;
  /** V10: The report_date of the fallback report (null if using today's report) */
  fallbackReportDate: string | null;
  todayCloseVerification: CloseMarketReview | null;
  /** V7.55: Morning Alpha Normalized Report from the adapter */
  morningAlpha: MorningAlphaNormalizedReport | null;
}

export async function loadHomeDashboardData(): Promise<HomeDashboardData> {
  const result: HomeDashboardData = {
    marketData: [],
    marketDataTodayOnly: [],
    report: null,
    intradayCheck: null,
    openingRadar: null,
    marketSourceHealth: [],
    dataTrustStatus: null,
    latestNewsAt: null,
    selectedNewsCount: 0,
    totalNewsCount: 0,
    lastSyncAt: new Date().toISOString(),
    error: null,
    isHistoricalFallback: false,
    fallbackReportDate: null,
    todayCloseVerification: null,
    morningAlpha: null,
  };

  try {
    const taipeiToday = isTaipeiToday();

    // V8: Single Source of Truth — resolveActiveMorningAlphaReport
    const resolved = await resolveActiveMorningAlphaReport();

    // V8: Market data placeholders — data from ai_strategy_json
    result.marketData = [];
    result.marketDataTodayOnly = [];

    // V24: Report from unified resolver
    if (resolved.rawRow) {
      result.report = mapRowToReport(resolved.rawRow as unknown as Record<string, unknown>);
      result.morningAlpha = resolved.report;
      result.isHistoricalFallback = resolved.isHistoricalFallback;
      result.fallbackReportDate = resolved.fallbackReportDate;
      const rawRow = resolved.rawRow as unknown as Record<string, unknown>;
      const ai = rawRow.ai_strategy_json && typeof rawRow.ai_strategy_json === 'object' && !Array.isArray(rawRow.ai_strategy_json)
        ? rawRow.ai_strategy_json as Record<string, unknown>
        : {};
      const embeddedRadar = ai.opening_radar && typeof ai.opening_radar === 'object' && !Array.isArray(ai.opening_radar)
        ? ai.opening_radar as Record<string, unknown>
        : null;
      if (embeddedRadar) {
        result.openingRadar = mapRowToOpeningRadar({
          ...embeddedRadar,
          id: embeddedRadar.id || `report:${resolved.revision_id || resolved.rawRow.id}`,
          report_date: embeddedRadar.report_date || resolved.rawRow.report_date,
        });
      }
      const closing = ai.closing_verification_v2 || ai.closing_verification;
      result.todayCloseVerification = mapClosingVerificationToCloseMarketReview(
        resolved.rawRow.report_date,
        closing,
      );
    } else {
      result.morningAlpha = resolved.report;
    }

    // V8: Simplified data trust — from report data only
    result.totalNewsCount = 0;
    result.selectedNewsCount = 0;
    result.latestNewsAt = null;
    result.marketSourceHealth = [];

    // V8: Simplified data trust — report-based only
    result.dataTrustStatus = {
      overallStatus: result.report ? 'partial' : 'insufficient',
      statusLabel: result.report ? '報告已載入' : '資料不足',
      statusColor: result.report ? 'text-amber-400' : 'text-red-400',
      statusBg: result.report ? 'bg-amber-500/10' : 'bg-red-500/10',
      statusBorder: result.report ? 'border-amber-500/20' : 'border-red-500/20',
      marketDataLatestAt: null,
      marketNewsLatestAt: null,
      selectedNewsCount: 0,
      todayReportExists: !!result.report,
      todayReportCreatedAt: result.report?.created_at ?? null,
      todayIntradayExists: !!result.openingRadar,
      todayIntradayCreatedAt: result.openingRadar?.created_at ?? null,
      hasTaiex: false,
      hasTxf: false,
      missingItems: [],
      warningMessage: null,
      sources: [],
      staleness: { marketDataToday: false, marketNewsToday: false, reportToday: true, intradayToday: false },
    };

  } catch (err) {
    result.error = err instanceof Error ? err.message : '資料讀取失敗';
  }

  return result;
}

/**
 * 用台北日期比對 dateStr 是否為今天
 */
function isDateTaipeiToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const today = isTaipeiToday();
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const y = tw.getFullYear();
    const m = String(tw.getMonth() + 1).padStart(2, '0');
    const dd = String(tw.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}` === today;
  } catch {
    return false;
  }
}

/**
 * 格式化為 Asia/Taipei 的 HH:mm:ss
 */
export function formatTaipeiTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
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
 * 格式化為 Asia/Taipei 的 MM/DD HH:mm
 */
export function formatTaipeiShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/**
 * 取得 market_data 最新 captured_at
 */
export function getLatestMarketDataTime(data: HomeDashboardData): string | null {
  if (!data.marketData || data.marketData.length === 0) return null;
  return data.marketData[0]?.captured_at ?? null;
}

/**
 * 取得 intraday_check 的時間（優先 created_at，fallback check_date + check_time）
 */
export function getIntradayCheckTime(check: IntradayCheck | null): string | null {
  if (!check) return null;
  if (check.created_at) return check.created_at;
  if (check.check_date && check.check_time) {
    return `${check.check_date}T${check.check_time}`;
  }
  return null;
}
