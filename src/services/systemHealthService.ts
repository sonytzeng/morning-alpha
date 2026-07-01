import { supabase } from '@/lib/supabase';

// ===== Types =====

export interface ReportStatus {
  report_date: string;
  created_at: string;
  market_bias: string | null;
  confidence_score: number | null;
  summary: string | null;
  status: 'normal' | 'expired' | 'missing';
  isToday: boolean;
}

export interface MarketDataStatus {
  latestCapturedAt: string;
  todayCount: number;
  coreSymbols: {
    TAIEX: boolean;
    TXF: boolean;
    '2330': boolean;
    TSM: boolean;
    SOX: boolean;
    VIX: boolean;
    DXY: boolean;
    US10Y: boolean;
  };
  missingCore: string[];
  status: 'normal' | 'warning' | 'error';
  isToday: boolean;
}

export interface MarketNewsStatus {
  latestCreatedAt: string;
  todayTotal: number;
  selectedToday: number;
  avgFinalScore: number;
  rejectedCount: number;
  status: 'normal' | 'warning' | 'error';
  isToday: boolean;
}

export interface LinePushStatus {
  todayPushCount: number;
  todaySuccessCount: number;
  todayFailCount: number;
  latestPushAt: string | null;
  status: 'normal' | 'warning' | 'unknown';
}

export interface CronStatus {
  name: string;
  slug: string;
  status: 'normal' | 'unknown';
}

export interface LatestReport {
  report_date: string;
  created_at: string;
  market_bias: string | null;
  confidence_score: number | null;
  summary: string | null;
}

export interface LatestMarketData {
  symbol: string;
  name: string;
  value: number;
  change_percent: number;
  captured_at: string;
  isCore: boolean;
  isToday: boolean;
}

export interface LatestMarketNews {
  title: string;
  source: string;
  category: string;
  final_score: number;
  is_selected: boolean;
  related_tw_names: string[];
  rejection_reason: string;
  created_at: string;
  isLowRelevance: boolean;
}

export interface HealthScore {
  score: number;
  label: 'healthy' | 'usable' | 'warning' | 'error';
  breakdown: {
    reports: number;
    marketData: number;
    marketNews: number;
    coreSymbols: number;
    lowRelevance: number;
  };
}

export interface IntradayStatus {
  check_date: string;
  opening_status: string | null;
  status: 'normal' | 'expired' | 'missing';
  isToday: boolean;
}

export interface SystemHealthData {
  reportStatus: ReportStatus;
  marketDataStatus: MarketDataStatus;
  marketNewsStatus: MarketNewsStatus;
  intradayStatus: IntradayStatus;
  openingRadarStatus: {
    check_date: string;
    radar_status: string | null;
    market_bias: string | null;
    confidence_score: number | null;
    is_premarket_overridden: boolean;
    override_reason: string | null;
    status: 'normal' | 'expired' | 'missing';
    isToday: boolean;
  };
  linePushStatus: LinePushStatus;
  cronStatuses: CronStatus[];
  latestReports: LatestReport[];
  latestMarketData: LatestMarketData[];
  latestMarketNews: LatestMarketNews[];
  healthScore: HealthScore;
}

// ===== Constants =====

const CORE_SYMBOLS = ['TAIEX', 'TXF', '2330', 'TSM', 'SOX', 'VIX', 'DXY', 'US10Y'];

const LOW_RELEVANCE_KEYWORDS = [
  '401k', 'retirement', 'social security', 'credit card', 'mortgage', 'personal finance',
];

const CRON_FUNCTIONS = [
  { name: 'cron-generate-report', slug: 'cron-generate-report' },
  { name: 'fetch-market-data-v10', slug: 'fetch-market-data-v10' },
  { name: 'fetch-global-market-news', slug: 'fetch-global-market-news' },
  { name: 'line-daily-push', slug: 'line-daily-push' },
];

// ===== Helpers =====

function getTaipeiToday(): string {
  const now = new Date();
  const taipeiDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const yyyy = taipeiDate.getFullYear();
  const mm = String(taipeiDate.getMonth() + 1).padStart(2, '0');
  const dd = String(taipeiDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getTaipeiTodayStart(): string {
  return `${getTaipeiToday()}T00:00:00+08:00`;
}

function isDateToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const today = getTaipeiToday();
  return dateStr.startsWith(today);
}

function isLowRelevanceNews(title: string): boolean {
  const lower = title.toLowerCase();
  return LOW_RELEVANCE_KEYWORDS.some((kw) => lower.includes(kw));
}

// ===== Data Fetching =====

async function fetchReportStatus(): Promise<ReportStatus> {
  const today = getTaipeiToday();

  const { data, error } = await supabase
    .from('reports')
    .select('report_date, created_at, market_bias, confidence_score, summary')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      report_date: '-',
      created_at: '-',
      market_bias: null,
      confidence_score: null,
      summary: null,
      status: 'missing',
      isToday: false,
    };
  }

  const row = data as Record<string, unknown>;
  const reportDate = String(row.report_date || '');
  const isToday = reportDate === today;

  let status: ReportStatus['status'] = 'missing';
  if (isToday) {
    status = 'normal';
  } else if (reportDate < today) {
    status = 'expired';
  }

  return {
    report_date: reportDate,
    created_at: String(row.created_at || '-'),
    market_bias: row.market_bias ? String(row.market_bias) : null,
    confidence_score: row.confidence_score ? Number(row.confidence_score) : null,
    summary: row.summary ? String(row.summary) : null,
    status,
    isToday,
  };
}

async function fetchMarketDataStatus(): Promise<MarketDataStatus> {
  const todayStart = getTaipeiTodayStart();

  // Get latest captured_at
  const { data: latest } = await supabase
    .from('market_data')
    .select('captured_at')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestCapturedAt = latest ? String((latest as Record<string, unknown>).captured_at || '-') : '-';
  const isToday = isDateToday(latestCapturedAt);

  // Get today's data symbols
  const { data: todayData } = await supabase
    .from('market_data')
    .select('symbol')
    .gte('captured_at', todayStart);

  const todaySymbols = new Set((todayData || []).map((r: Record<string, unknown>) => String(r.symbol)));
  const coreSymbols = {
    TAIEX: todaySymbols.has('TAIEX'),
    TXF: todaySymbols.has('TXF'),
    '2330': todaySymbols.has('2330'),
    TSM: todaySymbols.has('TSM'),
    SOX: todaySymbols.has('SOX'),
    VIX: todaySymbols.has('VIX'),
    DXY: todaySymbols.has('DXY'),
    US10Y: todaySymbols.has('US10Y'),
  };

  const missingCore = CORE_SYMBOLS.filter((s) => !todaySymbols.has(s));

  let status: MarketDataStatus['status'] = 'normal';
  if (missingCore.length >= 6) {
    status = 'error';
  } else if (missingCore.includes('TXF') || missingCore.includes('2330') || missingCore.length >= 3) {
    status = 'warning';
  }

  return {
    latestCapturedAt,
    todayCount: todaySymbols.size,
    coreSymbols,
    missingCore,
    status,
    isToday,
  };
}

async function fetchMarketNewsStatus(): Promise<MarketNewsStatus> {
  const todayStart = getTaipeiTodayStart();

  const { data: todayNews } = await supabase
    .from('market_news')
    .select('is_selected, final_score, rejection_reason, created_at')
    .gte('created_at', todayStart);

  const rows = (todayNews || []) as Array<{
    is_selected: boolean;
    final_score: number | null;
    rejection_reason: string | null;
    created_at: string;
  }>;

  const selected = rows.filter((r) => r.is_selected);
  const rejected = rows.filter((r) => !r.is_selected && r.rejection_reason);
  const avgFinalScore = rows.length > 0
    ? Math.round(rows.reduce((sum, r) => sum + (r.final_score || 0), 0) / rows.length)
    : 0;

  const latestCreatedAt = rows.length > 0
    ? rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), rows[0].created_at)
    : '-';

  let status: MarketNewsStatus['status'] = 'normal';
  if (selected.length === 0) {
    status = 'error';
  } else if (selected.length < 3) {
    status = 'warning';
  }

  return {
    latestCreatedAt,
    todayTotal: rows.length,
    selectedToday: selected.length,
    avgFinalScore,
    rejectedCount: rejected.length,
    status,
    isToday: isDateToday(latestCreatedAt),
  };
}

async function fetchLinePushStatus(): Promise<LinePushStatus> {
  const todayStart = getTaipeiTodayStart();

  try {
    const { data, error } = await supabase
      .from('line_push_logs')
      .select('status, created_at')
      .gte('created_at', todayStart);

    if (error) {
      return {
        todayPushCount: 0,
        todaySuccessCount: 0,
        todayFailCount: 0,
        latestPushAt: null,
        status: 'unknown',
      };
    }

    const rows = (data || []) as Array<{ status: string; created_at: string }>;
    const success = rows.filter((r) => r.status === 'success');
    const failed = rows.filter((r) => r.status !== 'success');

    const latestPushAt = rows.length > 0
      ? rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), rows[0].created_at)
      : null;

    return {
      todayPushCount: rows.length,
      todaySuccessCount: success.length,
      todayFailCount: failed.length,
      latestPushAt,
      status: rows.length > 0 ? (failed.length === 0 ? 'normal' : 'warning') : 'unknown',
    };
  } catch {
    return {
      todayPushCount: 0,
      todaySuccessCount: 0,
      todayFailCount: 0,
      latestPushAt: null,
      status: 'unknown',
    };
  }
}

async function fetchCronStatuses(): Promise<CronStatus[]> {
  return CRON_FUNCTIONS.map((fn) => ({
    name: fn.name,
    slug: fn.slug,
    status: 'unknown' as const,
  }));
}

async function fetchLatestReports(limit = 7): Promise<LatestReport[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('report_date, created_at, market_bias, confidence_score, summary')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data || []).map((row: Record<string, unknown>) => ({
    report_date: String(row.report_date || '-'),
    created_at: String(row.created_at || '-'),
    market_bias: row.market_bias ? String(row.market_bias) : null,
    confidence_score: row.confidence_score ? Number(row.confidence_score) : null,
    summary: row.summary ? String(row.summary) : null,
  }));
}

async function fetchLatestMarketData(limit = 30): Promise<LatestMarketData[]> {
  const today = getTaipeiToday();

  const { data, error } = await supabase
    .from('market_data')
    .select('symbol, name, value, change_percent, captured_at')
    .order('captured_at', { ascending: false })
    .limit(limit);

  if (error) return [];

  // Deduplicate by symbol
  const seen = new Set<string>();
  const result: LatestMarketData[] = [];

  for (const row of (data || [])) {
    const r = row as Record<string, unknown>;
    const symbol = String(r.symbol);

    if (!seen.has(symbol)) {
      seen.add(symbol);
      const capturedAt = String(r.captured_at || '-');
      result.push({
        symbol,
        name: String(r.name || ''),
        value: Number(r.value ?? 0),
        change_percent: Number(r.change_percent ?? 0),
        captured_at: capturedAt,
        isCore: CORE_SYMBOLS.includes(symbol),
        isToday: capturedAt.startsWith(today),
      });
    }
  }

  return result;
}

async function fetchLatestMarketNews(limit = 30): Promise<LatestMarketNews[]> {
  const { data, error } = await supabase
    .from('market_news')
    .select('title, source, category, final_score, is_selected, related_tw_names, rejection_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data || []).map((row: Record<string, unknown>) => ({
    title: String(row.title || ''),
    source: String(row.source || ''),
    category: String(row.category || ''),
    final_score: Number(row.final_score ?? 0),
    is_selected: Boolean(row.is_selected),
    related_tw_names: Array.isArray(row.related_tw_names) ? row.related_tw_names as string[] : [],
    rejection_reason: row.rejection_reason ? String(row.rejection_reason) : '',
    created_at: String(row.created_at || '-'),
    isLowRelevance: isLowRelevanceNews(String(row.title || '')),
  }));
}

async function fetchIntradayStatus(): Promise<IntradayStatus> {
  const today = getTaipeiToday();

  const { data, error } = await supabase
    .from('intraday_checks')
    .select('check_date, opening_status')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      check_date: '-',
      opening_status: null,
      status: 'missing',
      isToday: false,
    };
  }

  const row = data as Record<string, unknown>;
  const checkDate = String(row.check_date || '');

  return {
    check_date: checkDate,
    opening_status: row.opening_status ? String(row.opening_status) : null,
    status: checkDate === today ? 'normal' : checkDate < today ? 'expired' : 'missing',
    isToday: checkDate === today,
  };
}

// ── V8: Fetch opening_market_radar status ──
async function fetchOpeningRadarStatus(): Promise<SystemHealthData['openingRadarStatus']> {
  const today = getTaipeiToday();

  const { data, error } = await supabase
    .from('opening_market_radar')
    .select('report_date, radar_status, market_bias, confidence_score, is_premarket_overridden, override_reason')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      check_date: '-',
      radar_status: null,
      market_bias: null,
      confidence_score: null,
      is_premarket_overridden: false,
      override_reason: null,
      status: 'missing',
      isToday: false,
    };
  }

  const row = data as Record<string, unknown>;
  const checkDate = String(row.report_date || '');

  return {
    check_date: checkDate,
    radar_status: row.radar_status ? String(row.radar_status) : null,
    market_bias: row.market_bias ? String(row.market_bias) : null,
    confidence_score: row.confidence_score ? Number(row.confidence_score) : null,
    is_premarket_overridden: Boolean(row.is_premarket_overridden),
    override_reason: row.override_reason ? String(row.override_reason) : null,
    status: checkDate === today ? 'normal' : checkDate < today ? 'expired' : 'missing',
    isToday: checkDate === today,
  };
}

function computeHealthScore(
  reportStatus: ReportStatus,
  marketDataStatus: MarketDataStatus,
  marketNewsStatus: MarketNewsStatus,
  openingRadarStatus: SystemHealthData['openingRadarStatus'],
): HealthScore {
  let score = 0;
  const breakdown = {
    reports: 0,
    marketData: 0,
    marketNews: 0,
    openingRadar: 0,
    coreSymbols: 0,
    lowRelevance: 0,
  };

  // Reports: today normal +25
  if (reportStatus.isToday) {
    breakdown.reports = 25;
    score += 25;
  }

  // Market data: today with TAIEX/TXF/2330 >= 2 → +25
  const twCorePresent = (marketDataStatus.coreSymbols.TAIEX ? 1 : 0) + (marketDataStatus.coreSymbols.TXF ? 1 : 0) + (marketDataStatus.coreSymbols['2330'] ? 1 : 0);
  if (marketDataStatus.isToday && twCorePresent >= 2) {
    breakdown.marketData = 25;
    score += 25;
  } else if (marketDataStatus.isToday) {
    breakdown.marketData = 10;
    score += 10;
  }

  // Market news: selected 5-12 +25
  if (marketNewsStatus.selectedToday >= 5 && marketNewsStatus.selectedToday <= 12) {
    breakdown.marketNews = 25;
    score += 25;
  } else if (marketNewsStatus.selectedToday >= 3) {
    breakdown.marketNews = 15;
    score += 15;
  }

  // Opening radar: today executed +25
  if (openingRadarStatus.isToday) {
    breakdown.openingRadar = 25;
    score += 25;
  }

  // If opening radar shows premarket overridden, it's NOT an error — normal risk control
  // Don't deduct points for override

  let label: HealthScore['label'] = 'error';
  if (score >= 90) label = 'healthy';
  else if (score >= 70) label = 'usable';
  else if (score >= 50) label = 'warning';

  return { score: Math.min(100, score), label, breakdown };
}

// ===== Main Export =====

export async function fetchSystemHealth(): Promise<SystemHealthData> {
  const [
    reportStatus,
    marketDataStatus,
    marketNewsStatus,
    intradayStatus,
    openingRadarStatus,
    linePushStatus,
    cronStatuses,
    latestReports,
    latestMarketData,
    latestMarketNews,
  ] = await Promise.all([
    fetchReportStatus(),
    fetchMarketDataStatus(),
    fetchMarketNewsStatus(),
    fetchIntradayStatus(),
    fetchOpeningRadarStatus(),
    fetchLinePushStatus(),
    fetchCronStatuses(),
    fetchLatestReports(7),
    fetchLatestMarketData(30),
    fetchLatestMarketNews(30),
  ]);

  const healthScore = computeHealthScore(reportStatus, marketDataStatus, marketNewsStatus, openingRadarStatus);

  return {
    reportStatus,
    marketDataStatus,
    marketNewsStatus,
    intradayStatus,
    openingRadarStatus,
    linePushStatus,
    cronStatuses,
    latestReports,
    latestMarketData,
    latestMarketNews,
    healthScore,
  };
}