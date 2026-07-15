import { callGetReportPayload } from '@/services/entitlementService';
import type {
  Report,
  RiskFactor,
  WatchSector,
  FocusStock,
  TomorrowWatch,
  GlobalEvent,
  AIStrategy,
  ImportantNews,
  TodayStrategy,
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

function safeJsonObject<T extends object>(val: unknown, fallback?: T): T | null {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getPayloadGeneratedAt(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  const nestedAI = asRecord(payload.ai_strategy_json);
  return firstString(
    payload.generated_at,
    payload.generatedAt,
    payload.report_generated_at,
    payload.created_at,
    payload.updated_at,
    nestedAI?.generated_at,
  );
}

function getPayloadSummary(payload: Record<string, unknown> | undefined): string | null {
  if (!payload) return null;
  const nestedAI = asRecord(payload.ai_strategy_json);
  const publicSummary = asRecord(payload.public_summary) || asRecord(nestedAI?.public_summary) || asRecord(payload.free_summary);
  const v8DailySentence = asRecord(nestedAI?.v8_daily_sentence) || asRecord(payload.v8_daily_sentence);
  return firstString(
    v8DailySentence?.sentence,
    nestedAI?.daily_sentence,
    payload.daily_sentence,
    publicSummary?.daily_sentence,
    payload.summary,
    payload.today_quote,
  );
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
    today_strategy: safeJsonObject<TodayStrategy>(row.today_strategy),
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

  try {
    const response = await callGetReportPayload({ reportDate: today });
    return mapRowToReport({
      id: `server-trimmed:${response.report_date}`,
      report_date: response.report_date,
      market_bias: response.payload?.market_bias,
      confidence_score: response.payload?.confidence_score,
      summary: getPayloadSummary(response.payload),
      ai_strategy_json: response.payload,
      created_at: getPayloadGeneratedAt(response.payload),
    });
  } catch (error) {
    console.error('getTodayReport error:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getReportByDate(date: string): Promise<Report | null> {
  try {
    const response = await callGetReportPayload({ reportDate: date });
    return mapRowToReport({
      id: `server-trimmed:${response.report_date}`,
      report_date: response.report_date,
      market_bias: response.payload?.market_bias,
      confidence_score: response.payload?.confidence_score,
      summary: getPayloadSummary(response.payload),
      ai_strategy_json: response.payload,
      created_at: getPayloadGeneratedAt(response.payload),
    });
  } catch (error) {
    console.error('getReportByDate error:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getLatestReports(limit = 7): Promise<Report[]> {
  try {
    const response = await callGetReportPayload();
    const report = mapRowToReport({
      id: `server-trimmed:${response.report_date}`,
      report_date: response.report_date,
      market_bias: response.payload?.market_bias,
      confidence_score: response.payload?.confidence_score,
      summary: getPayloadSummary(response.payload),
      ai_strategy_json: response.payload,
      created_at: getPayloadGeneratedAt(response.payload),
    });
    return limit > 0 ? [report] : [];
  } catch (error) {
    console.error('getLatestReports error:', error instanceof Error ? error.message : error);
    return [];
  }
}
