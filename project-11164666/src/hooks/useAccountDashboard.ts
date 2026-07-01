import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Report } from '@/types/report';
import { getTodayReport } from '@/services/reportService';

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

async function loadAccountDashboard(): Promise<AccountDashboardData> {
  const result: AccountDashboardData = {
    todayReport: null,
    hasTodayReport: false,
    marketDataLatestAt: null,
    isMarketDataToday: false,
    marketNewsLatestAt: null,
    selectedNewsCount: 0,
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
    const todayReport = await getTodayReport();
    if (todayReport) {
      result.todayReport = todayReport;
      result.hasTodayReport = true;
    }

    // V8: Simplified — no direct market_data/market_news/opening_market_radar queries
    result.marketDataLatestAt = null;
    result.isMarketDataToday = false;
    result.marketNewsLatestAt = null;
    result.selectedNewsCount = 0;
    result.totalNewsCount = 0;
    result.isMarketNewsToday = false;
    result.intradayLatestAt = null;
    result.intradayCheckDate = null;
    result.hasIntradayData = false;
    result.isIntradayToday = false;
    result.intradayRadarStatus = null;
    result.intradayRadarBias = null;
    result.intradayRadarSummary = null;
    result.isTXFAvailable = false;

    result.recent7 = todayReport ? [todayReport] : [];
    result.recent30 = todayReport ? [todayReport] : [];
    result.streak = todayReport ? 1 : 0;
  } catch (err) {
    result.error = err instanceof Error ? err.message : '資料讀取失敗';
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
    if (diffDays === 1) {
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
