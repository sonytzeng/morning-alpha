import { callGetReportHistory, callGetReportPayload } from '@/services/entitlementService';
import { getSubscriberReportProjection } from '@/lib/subscriberReportProjection';
import type { ServerReportPayloadResponse } from '@/types/subscription';
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
    nestedAI?.generated_at,
    payload.updated_at,
    payload.created_at,
  );
}

export function mapRowToReport(row: Record<string, unknown>): Report {
  const projection = getSubscriberReportProjection(row);
  const ai = safeJsonObject<AIStrategy & Record<string, unknown>>(row.ai_strategy_json);
  const tradingDay = row.is_trading_day ?? ai?.is_trading_day;
  const statePresent = Object.prototype.hasOwnProperty.call(row, 'subscriber_state')
    || Object.prototype.hasOwnProperty.call(ai ?? {}, 'subscriber_state');
  return {
    id: projection.identity.revisionId ?? safeString(row.id) ?? '',
    report_date: projection.identity.reportDate,
    revision_id: projection.identity.revisionId,
    generated_at: projection.identity.generatedAt,
    today_date: projection.identity.todayDate,
    data_as_of: safeString(row.data_as_of),
    ...(statePresent ? { subscriber_state: row.subscriber_state ?? ai?.subscriber_state } : {}),
    canonical: asRecord(row.canonical) ?? asRecord(ai?.canonical),
    canonical_decision: asRecord(row.canonical_decision) ?? asRecord(ai?.canonical_decision),
    content_publish_gate: asRecord(row.content_publish_gate) ?? asRecord(ai?.content_publish_gate),
    market_report_gate: asRecord(row.market_report_gate) ?? asRecord(ai?.market_report_gate),
    recommendation_gate: asRecord(row.recommendation_gate) ?? asRecord(ai?.recommendation_gate),
    report_status: safeString(row.report_status ?? ai?.report_status) ?? undefined,
    closing_verification_v2: asRecord(row.closing_verification_v2) ?? asRecord(ai?.closing_verification_v2),
    closing_verification: asRecord(row.closing_verification) ?? asRecord(ai?.closing_verification),
    publication: row.publication ?? ai?.publication,
    market_status: safeString(row.market_status ?? ai?.market_status),
    is_trading_day: typeof tradingDay === 'boolean' ? tradingDay : null,
    action: projection.marketDecision.action,
    summary: projection.marketDecision.summary,
    market_bias: projection.marketDecision.bias,
    confidence_score: projection.confidence.value,
    confidence_label: projection.confidence.label,
    can_watch: projection.recommendation.available ? safeStringArray(row.can_watch) : null,
    avoid_today: projection.analysisAvailable ? safeStringArray(row.avoid_today) : null,
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
    focus_stock_json: projection.recommendation.available ? safeJsonArray<FocusStock>(row.focus_stock_json) : null,
    tomorrow_watch_json: safeJsonArray<TomorrowWatch>(row.tomorrow_watch_json),
    global_events_json: safeJsonArray<GlobalEvent>(row.global_events_json),
    ai_strategy_json: ai,
    important_news_json: safeJsonArray<ImportantNews>(row.important_news_json),
    yesterday_summary: safeString(row.yesterday_summary),
    today_summary: projection.marketDecision.summary,
    created_at: String(row.created_at || ''),
    // V2 新增欄位
    today_quote: projection.marketDecision.summary,
    today_strategy: projection.analysisAvailable ? safeJsonObject<TodayStrategy>(row.today_strategy) : null,
    watch_sectors_detailed: safeJsonArray(row.watch_sectors_detailed),
    ai_psychology: safeString(row.ai_psychology),
    ai_retail_reminder: safeString(row.ai_retail_reminder),
    ai_confidence_reason: projection.analysisAvailable ? safeString(row.ai_confidence_reason) : null,
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

function mapPayloadResponse(response: ServerReportPayloadResponse): Report | null {
  if (!response.report_date || !response.payload) return null;
  // Preserve the complete server-trimmed payload and its canonical identity. A
  // date-only synthetic id must never be substituted for a publication revision.
  return mapRowToReport({
    ...response.payload,
    ...response,
    ai_strategy_json: response.payload,
    created_at: response.generated_at ?? getPayloadGeneratedAt(response.payload),
  });
}

export async function getTodayReport(): Promise<Report | null> {
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;

  try {
    const response = await callGetReportPayload({ reportDate: today });
    return mapPayloadResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'REPORT_NOT_FOUND') console.info('Today report is not available yet.');
    else console.error('getTodayReport error:', message);
    return null;
  }
}

export async function getReportByDate(date: string): Promise<Report | null> {
  try {
    const response = await callGetReportPayload({ reportDate: date });
    return mapPayloadResponse(response);
  } catch (error) {
    console.error('getReportByDate error:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getLatestReports(limit = 7): Promise<Report[]> {
  try {
    if (limit <= 0) return [];
    const response = await callGetReportHistory(limit);
    return response.reports.map((summary) => mapRowToReport({
      ...summary,
      id: summary.revision_id ?? summary.id,
      created_at: summary.generated_at,
    }));
  } catch (error) {
    console.error('getLatestReports error:', error instanceof Error ? error.message : error);
    return [];
  }
}
