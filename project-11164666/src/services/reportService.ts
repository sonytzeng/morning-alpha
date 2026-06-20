import { supabase } from '@/lib/supabase';
import type {
  Report,
  RiskFactor,
  WatchSector,
  FocusStock,
  TomorrowWatch,
  GlobalEvent,
  AIStrategy,
  ImportantNews,
} from '@/types/report';

function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

function safeString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function safeStringArray(val: unknown): string[] | null {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string' && val.trim()) return [val.trim()];
  return null;
}

function safeJsonArray<T>(val: unknown, fallback: T[] = []): T[] | null {
  if (Array.isArray(val)) return val as T[];
  if (val === null || val === undefined) return fallback.length ? fallback : null;
  try {
    if (typeof val === 'string') {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? (parsed as T[]) : fallback;
    }
  } catch {
    // ignore
  }
  return fallback.length ? fallback : null;
}

function safeJsonObject<T extends Record<string, unknown>>(val: unknown, fallback?: T): T | null {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val as T;
  if (val === null || val === undefined) return fallback ?? null;
  try {
    if (typeof val === 'string') {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T;
    }
  } catch {
    // ignore
  }
  return fallback ?? null;
}

export function mapRowToReport(row: Record<string, unknown>): Report {
  return {
    id: String(row.id || ''),
    report_date: String(row.report_date || ''),
    summary: safeString(row.summary),
    market_bias: safeString(row.market_bias),
    confidence_score: safeNumber(row.confidence_score),
    confidence_label: safeString(row.confidence_label),
    can_watch: safeStringArray(row.can_watch),
    avoid_today: safeStringArray(row.avoid_today),
    fear_greed: safeNumber(row.fear_greed),
    fear_greed_summary: safeString(row.fear_greed_summary),
    vix: safeNumber(row.vix),
    vix_summary: safeString(row.vix_summary),
    nasdaq_change: safeNumber(row.nasdaq_change),
    sp500_change: safeNumber(row.sp500_change),
    sox_change: safeNumber(row.sox_change),
    taiex_futures_change: safeNumber(row.taiex_futures_change),
    dxy: safeNumber(row.dxy),
    us_bond_yield: safeNumber(row.us_bond_yield),
    gold_price: safeNumber(row.gold_price),
    oil_price: safeNumber(row.oil_price),
    btc_price: safeNumber(row.btc_price),
    risk_factors_json: safeJsonArray<RiskFactor>(row.risk_factors_json),
    watch_sectors_json: safeJsonArray<WatchSector>(row.watch_sectors_json),
    focus_stock_json: safeJsonArray<FocusStock>(row.focus_stock_json),
    tomorrow_watch_json: safeJsonArray<TomorrowWatch>(row.tomorrow_watch_json),
    global_events_json: safeJsonArray<GlobalEvent>(row.global_events_json),
    ai_strategy_json: safeJsonObject<AIStrategy>(row.ai_strategy_json),
    important_news_json: safeJsonArray<ImportantNews>(row.important_news_json),
    yesterday_summary: safeString(row.yesterday_summary),
    today_summary: safeString(row.today_summary),
    created_at: String(row.created_at || ''),
    // V2 新增欄位
    today_quote: safeString(row.today_quote),
    today_strategy: safeJsonObject(row.today_strategy),
    watch_sectors_detailed: safeJsonArray(row.watch_sectors_detailed),
    ai_psychology: safeString(row.ai_psychology),
    ai_retail_reminder: safeString(row.ai_retail_reminder),
    ai_confidence_reason: safeString(row.ai_confidence_reason),
    // V7 Market Intelligence Engine 新增欄位
    sentiment_score: safeNumber(row.sentiment_score),
    sentiment_label: safeString(row.sentiment_label),
    sentiment_reason: safeString(row.sentiment_reason),
    risk_reason: safeString(row.risk_reason),
    // V8 新增欄位
    key_drivers: safeStringArray(row.key_drivers),
    raw_ai_json: safeJsonObject(row.raw_ai_json),
  };
}

export async function getTodayReport(): Promise<Report | null> {
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;

  // Stable column selection — only columns that definitely exist in reports table
  const stableCols = 'id, report_date, market_bias, confidence_score, summary, ai_strategy_json, created_at';
  const { data, error } = await supabase
    .from('reports')
    .select(stableCols)
    .eq('report_date', today)
    .maybeSingle();

  if (error) {
    console.error('getTodayReport error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToReport(data as Record<string, unknown>);
}

export async function getReportByDate(date: string): Promise<Report | null> {
  const stableCols = 'id, report_date, market_bias, confidence_score, summary, ai_strategy_json, created_at';
  const { data, error } = await supabase
    .from('reports')
    .select(stableCols)
    .eq('report_date', date)
    .maybeSingle();

  if (error) {
    console.error('getReportByDate error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToReport(data as Record<string, unknown>);
}

export async function getLatestReports(limit = 7): Promise<Report[]> {
  const stableCols = 'id, report_date, market_bias, confidence_score, summary, ai_strategy_json, created_at';
  const { data, error } = await supabase
    .from('reports')
    .select(stableCols)
    .order('report_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('getLatestReports error:', error.message);
    return [];
  }

  return (data || []).map((row) => mapRowToReport(row as Record<string, unknown>));
}