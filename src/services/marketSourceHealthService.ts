import { supabase } from '@/lib/supabase';
import { isWithin36Hours } from '@/utils/tradingDay';

export interface MarketSourceHealth {
  id: string;
  source_name: string;
  source_type: string;
  status: 'healthy' | 'warning' | 'error' | 'unknown';
  last_success_at: string | null;
  last_error_at: string | null;
  latest_data_at: string | null;
  records_count: number;
  success_rate: number;
  error_message: string | null;
  symbols: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DataTrustStatus {
  overallStatus: 'complete' | 'partial' | 'insufficient' | 'not_generated';
  statusLabel: string;
  statusColor: string;
  statusBg: string;
  statusBorder: string;
  marketDataLatestAt: string | null;
  marketNewsLatestAt: string | null;
  selectedNewsCount: number;
  todayReportExists: boolean;
  todayReportCreatedAt: string | null;
  todayIntradayExists: boolean;
  todayIntradayCreatedAt: string | null;
  hasTaiex: boolean;
  hasTxf: boolean;
  missingItems: string[];
  warningMessage: string | null;
  sources: MarketSourceHealth[];
  staleness: DataTrustStaleness;
}

export interface DataTrustStaleness {
  marketDataToday: boolean;
  marketNewsToday: boolean;
  reportToday: boolean;
  intradayToday: boolean;
}

function safeStatus(val: string): 'healthy' | 'warning' | 'error' | 'unknown' {
  if (val === 'healthy' || val === 'warning' || val === 'error') return val;
  return 'unknown';
}

function safeNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

function safeStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return [];
}

function safeMetadata(val: unknown): Record<string, unknown> {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
  return {};
}

function mapRowToHealth(row: Record<string, unknown>): MarketSourceHealth {
  return {
    id: String(row.id || ''),
    source_name: String(row.source_name || ''),
    source_type: String(row.source_type || ''),
    status: safeStatus(String(row.status || 'unknown')),
    last_success_at: row.last_success_at ? String(row.last_success_at) : null,
    last_error_at: row.last_error_at ? String(row.last_error_at) : null,
    latest_data_at: row.latest_data_at ? String(row.latest_data_at) : null,
    records_count: safeNumber(row.records_count),
    success_rate: safeNumber(row.success_rate),
    error_message: row.error_message ? String(row.error_message) : null,
    symbols: safeStringArray(row.symbols),
    metadata: safeMetadata(row.metadata),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export async function getMarketSourceHealth(): Promise<MarketSourceHealth[]> {
  const { data, error } = await supabase
    .from('market_source_health')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('getMarketSourceHealth error:', error.message);
    return [];
  }

  return (data || []).map((row) => mapRowToHealth(row as Record<string, unknown>));
}

export function computeDataTrustStatus(
  sources: MarketSourceHealth[],
  actualTimestamps?: {
    marketDataLatestAt?: string | null;
    marketNewsLatestAt?: string | null;
    reportDate?: string | null;
    reportCreatedAt?: string | null;
    intradayCheckDate?: string | null;
    intradayCreatedAt?: string | null;
    selectedNewsCount?: number;
  },
): DataTrustStatus {
  // 安全防護：若傳入的 sources 不是陣列，轉為空陣列
  const safeSources = Array.isArray(sources) ? sources : [];
  const ts = actualTimestamps || {};

  try {
    const finnhub = safeSources.find((s) => s.source_name === 'FINNHUB');
    const twse = safeSources.find((s) => s.source_name === 'TWSE');
    const taifex = safeSources.find((s) => s.source_name === 'TAIFEX');
    const gnews = safeSources.find((s) => s.source_name === 'GNEWS');
    const openai = safeSources.find((s) => s.source_name === 'OPENAI');
    const reports = safeSources.find((s) => s.source_name === 'SUPABASE_REPORTS');

    const hasMarketData = finnhub?.status === 'healthy' || (finnhub?.records_count ?? 0) > 0;
    const hasTaiex = twse?.status === 'healthy';
    const hasTxf = taifex?.status === 'healthy';
    const hasNews = gnews?.status === 'healthy' || gnews?.status === 'warning';
    const hasReport = reports?.status === 'healthy';
    const hasIntraday = !!ts.intradayCreatedAt;

    // ---- Use actual timestamps from data tables when available ----
    const mdLatestAt = ts.marketDataLatestAt ?? finnhub?.latest_data_at ?? twse?.latest_data_at ?? null;
    const newsLatestAt = ts.marketNewsLatestAt ?? gnews?.latest_data_at ?? null;
    const reportCreatedAt = ts.reportCreatedAt ?? reports?.latest_data_at ?? null;
    const intradayCreatedAt = ts.intradayCreatedAt ?? null;

    // ---- Check Taipei-today freshness ----
    const reportToday = ts.reportDate
      ? ts.reportDate === isTaipeiToday()
      : isDateTaipeiToday(reportCreatedAt);
    const marketDataToday = isDateTaipeiToday(mdLatestAt);
    const marketNewsToday = isDateTaipeiToday(newsLatestAt);
    const intradayToday = ts.intradayCheckDate
      ? ts.intradayCheckDate === isTaipeiToday()
      : isDateTaipeiToday(intradayCreatedAt);

    const staleness: DataTrustStaleness = {
      marketDataToday,
      marketNewsToday,
      reportToday,
      intradayToday,
    };

    // ---- Compute status ----
    const missingItems: string[] = [];
    if (!hasMarketData) missingItems.push('市場資料');
    // V12: If opening_market_radar has data (hasIntraday), don't require TAIFEX/TWSE health
    if (!hasIntraday && !hasTaiex && !hasTxf) missingItems.push('台股開盤驗證資料');
    if (!hasNews) missingItems.push('新聞資料');
    if (!hasReport) missingItems.push('今日 AI 報告');

    // Stale data warnings (data exists but is not from today)
    if (hasMarketData && !marketDataToday) missingItems.push('市場資料尚未更新至今日');
    if (hasNews && !marketNewsToday) missingItems.push('最新新聞尚未更新至今日');

    let overallStatus: DataTrustStatus['overallStatus'];
    let statusLabel: string;
    let warningMessage: string | null = null;

    if (!hasReport) {
      overallStatus = 'not_generated';
      statusLabel = '尚未產生';
      warningMessage = '今日 AI 報告尚未產生';
    } else if (!hasMarketData && !hasNews) {
      overallStatus = 'insufficient';
      statusLabel = '資料不足';
      warningMessage = '市場資料與新聞資料均不足';
    } else if (!hasIntraday && !hasTaiex && !hasTxf && hasMarketData && hasNews) {
      overallStatus = 'partial';
      statusLabel = '部分完整';
      warningMessage = '台股開盤驗證資料不足';
    } else if (missingItems.length > 0) {
      overallStatus = 'partial';
      statusLabel = '部分完整';
      // Build a clear warning about what's stale vs what's complete
      const staleWarnings: string[] = [];
      if (reportToday && (!marketDataToday || !marketNewsToday || !intradayToday)) {
        staleWarnings.push('報告已產生，但部分資料來源尚未更新');
      }
      if (!marketDataToday && hasMarketData) staleWarnings.push('市場資料尚未更新至今日');
      if (!marketNewsToday && hasNews) staleWarnings.push('最新新聞尚未更新至今日');
      if (!intradayToday && hasIntraday) staleWarnings.push('開盤雷達尚未更新至今日');
      warningMessage = staleWarnings.length > 0 ? staleWarnings.join('；') : `缺少：${missingItems.join('、')}`;
    } else {
      // All sources healthy — but check freshness
      if (!marketDataToday || !marketNewsToday || !intradayToday) {
        overallStatus = 'partial';
        statusLabel = '部分完整';
        const staleWarnings: string[] = [];
        if (reportToday && (!marketDataToday || !marketNewsToday || !intradayToday)) {
          staleWarnings.push('報告已產生，但部分資料來源尚未更新');
        }
        if (!marketDataToday) staleWarnings.push('市場資料尚未更新至今日');
        if (!marketNewsToday) staleWarnings.push('最新新聞尚未更新至今日');
        if (!intradayToday) staleWarnings.push('開盤雷達尚未更新至今日');
        warningMessage = staleWarnings.join('；');
      } else {
        // ALL four sources are today → truly complete
        overallStatus = 'complete';
        statusLabel = '資料完整';
      }
    }

    const statusColorMap: Record<string, { color: string; bg: string; border: string }> = {
      complete: { color: 'text-forest-400', bg: 'bg-forest-500/10', border: 'border-forest-500/20' },
      partial: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
      insufficient: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
      not_generated: { color: 'text-white/40', bg: 'bg-white/5', border: 'border-white/10' },
    };

    const style = statusColorMap[overallStatus] || statusColorMap.not_generated;

    return {
      overallStatus,
      statusLabel,
      statusColor: style.color,
      statusBg: style.bg,
      statusBorder: style.border,
      marketDataLatestAt: mdLatestAt,
      marketNewsLatestAt: newsLatestAt,
      selectedNewsCount: safeNumber(
        ts.selectedNewsCount ?? openai?.records_count ?? gnews?.metadata?.selected_count,
      ),
      todayReportExists: hasReport,
      todayReportCreatedAt: reportCreatedAt,
      todayIntradayExists: hasIntraday,
      todayIntradayCreatedAt: intradayCreatedAt,
      hasTaiex,
      hasTxf,
      missingItems,
      warningMessage,
      sources: safeSources,
      staleness,
    };
  } catch (error) {
    console.error('computeDataTrustStatus error:', error);
    return {
      overallStatus: 'not_generated',
      statusLabel: '尚未產生',
      statusColor: 'text-white/40',
      statusBg: 'bg-white/5',
      statusBorder: 'border-white/10',
      marketDataLatestAt: null,
      marketNewsLatestAt: null,
      selectedNewsCount: 0,
      todayReportExists: false,
      todayReportCreatedAt: null,
      todayIntradayExists: false,
      todayIntradayCreatedAt: null,
      hasTaiex: false,
      hasTxf: false,
      missingItems: [],
      warningMessage: '計算資料信任狀態時發生錯誤',
      sources: [],
      staleness: {
        marketDataToday: false,
        marketNewsToday: false,
        reportToday: false,
        intradayToday: false,
      },
    } as unknown as DataTrustStatus;
  }
}

export function sourceStatusToChinese(status: string): string {
  switch (status) {
    case 'healthy': return '正常';
    case 'warning': return '警告';
    case 'error': return '錯誤';
    default: return '未知';
  }
}

export function sourceStatusIcon(status: string): string {
  switch (status) {
    case 'healthy': return 'ri-checkbox-circle-line';
    case 'warning': return 'ri-error-warning-line';
    case 'error': return 'ri-close-circle-line';
    default: return 'ri-question-mark';
  }
}

export function sourceStatusColor(status: string): string {
  switch (status) {
    case 'healthy': return 'text-forest-400';
    case 'warning': return 'text-amber-400';
    case 'error': return 'text-red-400';
    default: return 'text-white/30';
  }
}

export function sourceStatusBgColor(status: string): string {
  switch (status) {
    case 'healthy': return 'bg-forest-500/10';
    case 'warning': return 'bg-amber-500/10';
    case 'error': return 'bg-red-500/10';
    default: return 'bg-white/5';
  }
}

export function sourceStatusBorderColor(status: string): string {
  switch (status) {
    case 'healthy': return 'border-forest-500/20';
    case 'warning': return 'border-amber-500/20';
    case 'error': return 'border-red-500/20';
    default: return 'border-white/10';
  }
}

export function formatTaipeiDateTime(dateStr: string | null): string {
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

export function isWithinHours(dateStr: string | null, hours: number): boolean {
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return false;
    const diffMs = Date.now() - d.getTime();
    return diffMs <= hours * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function isTaipeiToday(): string {
  const now = new Date();
  const tw = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const y = tw.getFullYear();
  const m = String(tw.getMonth() + 1).padStart(2, '0');
  const d = String(tw.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isDateTaipeiToday(dateStr: string | null | undefined): boolean {
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
 * V2: 36-hour freshness check for market data.
 * This replaces the old "is today" check — data within 36h is considered fresh.
 * On weekends/non-trading days, this prevents false "stale" labeling.
 */
export function isDataFresh36h(dateStr: string | null | undefined): boolean {
  return isWithin36Hours(dateStr);
}
