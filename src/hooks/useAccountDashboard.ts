import { useState, useEffect, useCallback } from 'react';
import type { Report } from '@/types/report';
import { getLatestReports, getTodayReport } from '@/services/reportService';
import { isDateTaipeiToday, isTaipeiToday } from '@/services/marketSourceHealthService';

export interface AccountDashboardData {
  // Today report
  todayReport: Report | null;
  hasTodayReport: boolean;

  // Market data freshness
  marketDataLatestAt: string | null;
  isMarketDataToday: boolean;

  // Market news freshness
  marketNewsLatestAt: string | null;
  /** AI 精選新聞數 (is_selected=true, 今日範圍) */
  selectedNewsCount: number;
  /** 今日總新聞數 (published_at 或 created_at 在台北今日) */
  totalNewsCount: number;
  isMarketNewsToday: boolean;

  // Intraday (opening radar) freshness
  intradayLatestAt: string | null;
  intradayCheckDate: string | null;
  hasIntradayData: boolean;
  isIntradayToday: boolean;
  intradayRadarStatus: string | null;
  intradayRadarBias: string | null;
  intradayRadarSummary: string | null;

  // TXF-specific freshness
  isTXFAvailable: boolean;

  // Streak (computed from reports table)
  streak: number;

  // Timeline data
  recent7: Report[];
  recent30: Report[];

  // Meta
  loading: boolean;
  error: string | null;
  refreshedAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
    : [];
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function latestTimestamp(rows: Record<string, unknown>[], keys: string[]): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const candidate = firstText(...keys.map((key) => row[key]));
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp) && timestamp > latestMs) {
      latest = candidate;
      latestMs = timestamp;
    }
  }
  return latest;
}

async function loadAccountDashboard(): Promise<AccountDashboardData> {
  const result: AccountDashboardData = {
    todayReport: null,
    hasTodayReport: false,
    marketDataLatestAt: null,
    isMarketDataToday: false,
    marketNewsLatestAt: null,
    selectedNewsCount: 0,
    totalNewsCount: 0,
    isMarketNewsToday: false,
    intradayLatestAt: null,
    intradayCheckDate: null,
    hasIntradayData: false,
    isIntradayToday: false,
    intradayRadarStatus: null,
    intradayRadarBias: null,
    intradayRadarSummary: null,
    isTXFAvailable: false,
    streak: 0,
    recent7: [],
    recent30: [],
    loading: true,
    error: null,
    refreshedAt: new Date().toISOString(),
  };

  try {
    const [todayReport, history] = await Promise.all([
      getTodayReport(),
      getLatestReports(30),
    ]);
    if (todayReport) {
      result.todayReport = todayReport;
      result.hasTodayReport = true;
    }

    // Use the same server-trimmed payload as the rest of the public product.
    // This avoids opening direct browser access to raw reports or provider data.
    const payload = asRecord(todayReport?.ai_strategy_json);
    const marketSnapshots = asRecords(payload.market_data_snapshots);
    const importantNews = asRecords(payload.important_news);
    const openingRadar = asRecord(payload.opening_radar);

    result.marketDataLatestAt = latestTimestamp(marketSnapshots, ['captured_at', 'created_at', 'updated_at'])
      || firstText(payload.data_as_of);
    result.isMarketDataToday = isDateTaipeiToday(result.marketDataLatestAt);

    result.marketNewsLatestAt = latestTimestamp(importantNews, ['published_at', 'created_at']);
    const freshNewsCount = Number(payload.fresh_news_count);
    result.selectedNewsCount = Number.isFinite(freshNewsCount)
      ? Math.max(0, Math.trunc(freshNewsCount))
      : importantNews.length;
    result.totalNewsCount = result.selectedNewsCount;
    result.isMarketNewsToday = isDateTaipeiToday(result.marketNewsLatestAt);

    result.intradayLatestAt = firstText(openingRadar.captured_at, openingRadar.updated_at);
    result.intradayCheckDate = firstText(openingRadar.report_date);
    result.intradayRadarStatus = firstText(openingRadar.radar_status, payload.opening_radar_status);
    result.hasIntradayData = Boolean(
      result.intradayCheckDate || result.intradayLatestAt || result.intradayRadarStatus,
    );
    result.isIntradayToday = result.intradayCheckDate === isTaipeiToday()
      || isDateTaipeiToday(result.intradayLatestAt);
    result.intradayRadarBias = result.hasIntradayData ? todayReport?.market_bias || null : null;
    result.intradayRadarSummary = firstText(openingRadar.data_status);
    result.isTXFAvailable = marketSnapshots.some((snapshot) =>
      /^(TXF|MTX|TAIEX_FUTURES)$/i.test(String(snapshot.symbol || snapshot.code || '')),
    );

    result.recent30 = history.length > 0 ? history : todayReport ? [todayReport] : [];
    result.recent7 = result.recent30.slice(0, 7);
    result.streak = computeStreakFromReports(result.recent30);
  } catch {
    result.error = '觀察中心資料暫時無法取得，請稍後重新載入。';
  }

  result.loading = false;
  return result;
}

function computeStreakFromReports(reports: Report[]): number {
  if (!reports || reports.length === 0) return 0;

  const today = isTaipeiToday();
  const dates = reports
    .map((r) => r.report_date)
    .filter((d): d is string => !!d)
    .sort()
    .reverse(); // newest first

  if (dates.length === 0) return 0;

  // Must start from today
  if (dates[0] !== today) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T00:00:00');
    const curr = new Date(dates[i] + 'T00:00:00');
    const diffDays = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    // Friday-to-Monday and ordinary exchange closures can span multiple
    // calendar days while still being consecutive report days.
    if (diffDays >= 1 && diffDays <= 3) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

export function useAccountDashboard() {
  const [data, setData] = useState<AccountDashboardData>({
    todayReport: null,
    hasTodayReport: false,
    marketDataLatestAt: null,
    isMarketDataToday: false,
    marketNewsLatestAt: null,
    selectedNewsCount: 0,
    totalNewsCount: 0,
    isMarketNewsToday: false,
    intradayLatestAt: null,
    intradayCheckDate: null,
    hasIntradayData: false,
    isIntradayToday: false,
    intradayRadarStatus: null,
    intradayRadarBias: null,
    intradayRadarSummary: null,
    isTXFAvailable: false,
    streak: 0,
    recent7: [],
    recent30: [],
    loading: true,
    error: null,
    refreshedAt: null,
  });

  const load = useCallback(async () => {
    const d = await loadAccountDashboard();
    setData(d);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    data,
    loading: data.loading,
    error: data.error,
    refresh: load,
  };
}

export function formatTaipeiTimeShort(dateStr: string | null | undefined): string {
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
