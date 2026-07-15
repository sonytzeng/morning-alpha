/**
 * resolveActiveMorningAlphaReport — SINGLE SOURCE OF TRUTH for report reading
 *
 * Every page (home, today-report, dashboard, war-room, admin) MUST use this function
 * to get the current active Morning Alpha report. No page should do its own
 * direct reports-table reads.
 *
 * Resolution rules:
 * A. Priority: today's report (report_date = todayTaipeiDate)
 * B. Fail closed when the server-trimmed payload is unavailable
 * C. URL param reportDate: only used if valid YYYY-MM-DD format, NOT literal
 *    placeholders like ":reportDate", "undefined", "null", or empty strings
 * D. Returns normalized MorningAlphaNormalizedReport
 * E. If no reports exist at all, returns empty state
 * F. Never generates fake data
 */

import { getFrontendMarketDateState, type FrontendMarketStatus } from '@/utils/marketDate';
import {
  normalizeMorningAlphaReport,
  type ReportRow,
  type MorningAlphaNormalizedReport,
} from '@/lib/morningAlphaReportAdapter';
import { callGetReportPayload } from '@/services/entitlementService';
import type { ServerReportPayloadResponse, SubscriptionTier } from '@/types/subscription';

/**
 * Validate that a string looks like a real YYYY-MM-DD date.
 * Rejects: ":reportDate", "undefined", "null", "", non-date strings.
 */
function isValidDateParam(val: string | null | undefined): boolean {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (trimmed === '' || trimmed === ':reportDate' || trimmed === 'undefined' || trimmed === 'null') return false;
  // Must match YYYY-MM-DD format
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
}

export interface ResolveResult {
  report: MorningAlphaNormalizedReport;
  /** The raw Supabase row */
  rawRow: ReportRow | null;
  /** Which resolution path was used */
  source: 'server_trimmed_payload' | 'server_payload_unavailable' | 'today_match' | 'best_fallback' | 'url_param' | 'empty';
  /** The report_date that was queried */
  queriedDate: string;
  /** True when using historical fallback (not today's report) */
  isHistoricalFallback: boolean;
  /** The fallback report_date if using historical data */
  fallbackReportDate: string | null;
  /** Asia/Taipei current date */
  today_date: string;
  /** Today's TWSE status, independent from report_date */
  market_status: FrontendMarketStatus;
  /** Weekend / holiday reason when market is closed */
  closed_reason: string | null;
  /** Active report only when it is valid for today's foreground use */
  active_report: MorningAlphaNormalizedReport | null;
  active_report_date: string | null;
  market_data_date: string | null;
  revision_id: string | null;
  generated_at: string | null;
  is_today_report: boolean;
  is_stale_report: boolean;
  stale_reason: string | null;
  data_status: 'ready' | 'missing_today_report' | 'market_closed' | 'stale_reference_only' | 'unavailable';
  tier: SubscriptionTier;
  locked_sections: string[];
  payload_source: 'server_trimmed_payload' | 'server_payload_unavailable' | 'empty';
}

function toReportRow(data: Record<string, unknown>): ReportRow {
  return {
    id: String(data.id || ''),
    report_date: String(data.report_date || ''),
    market_bias: data.market_bias ? String(data.market_bias) : null,
    confidence_score: data.confidence_score != null ? Number(data.confidence_score) : null,
    created_at: String(data.created_at || ''),
    ai_strategy_json: (data.ai_strategy_json as Record<string, unknown>) || null,
    summary: data.summary ? String(data.summary) : null,
    watch_sectors_json: Array.isArray(data.watch_sectors_json) ? (data.watch_sectors_json as Record<string, unknown>[]) : null,
  };
}

function getMarketDataDate(row: ReportRow | null): string | null {
  const ai = row?.ai_strategy_json as Record<string, unknown> | null;
  const value = ai?.market_data_date || ai?.tw_core_date || null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getPayloadGeneratedAt(payload: Record<string, unknown>): string {
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

function getPayloadDailySentence(payload: Record<string, unknown>): string {
  const nestedAI = asRecord(payload.ai_strategy_json);
  const publicSummary = asRecord(payload.public_summary) || asRecord(nestedAI?.public_summary) || asRecord(payload.free_summary);
  const v8DailySentence = asRecord(nestedAI?.v8_daily_sentence) || asRecord(payload.v8_daily_sentence);
  return firstString(
    v8DailySentence?.sentence,
    nestedAI?.daily_sentence,
    payload.v8_daily_sentence,
    payload.daily_sentence,
    publicSummary?.daily_sentence,
    payload.summary,
    payload.today_quote,
  );
}

function toTrimmedReportRow(response: ServerReportPayloadResponse): ReportRow | null {
  if (!response.payload || !response.report_date) return null;
  const payload = response.payload;
  const generatedAt = getPayloadGeneratedAt(payload);
  const dailySentence = getPayloadDailySentence(payload);
  return {
    id: response.revision_id || `server-trimmed:${response.report_date}`,
    report_date: response.report_date,
    market_bias: typeof payload.market_bias === 'string' ? payload.market_bias : null,
    confidence_score: payload.confidence_score != null ? Number(payload.confidence_score) : null,
    created_at: generatedAt,
    updated_at: firstString(payload.updated_at),
    ai_strategy_json: payload,
    summary: dailySentence || null,
    watch_sectors_json: null,
  };
}

function buildResolveResult(params: {
  report: MorningAlphaNormalizedReport;
  rawRow: ReportRow | null;
  source: ResolveResult['source'];
  queriedDate: string;
  todayDate: string;
  marketStatus: FrontendMarketStatus;
  closedReason: string | null;
  dataStatus: ResolveResult['data_status'];
  staleReason?: string | null;
  tier?: SubscriptionTier;
  lockedSections?: string[];
  payloadSource?: ResolveResult['payload_source'];
}): ResolveResult {
  const {
    report,
    rawRow,
    source,
    queriedDate,
    todayDate,
    marketStatus,
    closedReason,
    dataStatus,
    staleReason = null,
    tier = 'free',
    lockedSections = [],
    payloadSource = 'empty',
  } = params;
  const isTodayReport = !!rawRow && rawRow.report_date === todayDate;
  const isHistoricalFallback = !!rawRow && rawRow.report_date !== todayDate;
  const activeReport = dataStatus === 'ready' ? report : null;

  return {
    report,
    rawRow,
    source,
    queriedDate,
    isHistoricalFallback,
    fallbackReportDate: isHistoricalFallback ? rawRow?.report_date ?? null : null,
    today_date: todayDate,
    market_status: marketStatus,
    closed_reason: closedReason,
    active_report: activeReport,
    active_report_date: rawRow?.report_date ?? null,
    market_data_date: getMarketDataDate(rawRow),
    revision_id: rawRow?.id || null,
    generated_at: rawRow?.created_at || null,
    is_today_report: isTodayReport,
    is_stale_report: dataStatus === 'stale_reference_only' || isHistoricalFallback,
    stale_reason: staleReason,
    data_status: dataStatus,
    tier,
    locked_sections: lockedSections,
    payload_source: payloadSource,
  };
}

function getServerPayloadDataStatus(params: {
  rawRow: ReportRow;
  todayDate: string;
  marketStatus: FrontendMarketStatus;
  closedReason: string | null;
}): { dataStatus: ResolveResult['data_status']; staleReason: string | null } {
  const { rawRow, todayDate, marketStatus, closedReason } = params;
  if (rawRow.report_date === todayDate) return { dataStatus: 'ready', staleReason: null };
  if (marketStatus === 'closed') {
    return {
      dataStatus: 'market_closed',
      staleReason: `今日休市（${closedReason || '休市'}），${rawRow.report_date} 僅供歷史參考`,
    };
  }
  return {
    dataStatus: 'missing_today_report',
    staleReason: '交易日尚未產生今日盤前報告',
  };
}

function getAllLockedSections(): string[] {
  return [
    'opportunities_full',
    'member_note_full',
    'war_room_full',
    'vip_fund_flow',
    'vip_accuracy_history',
    'vip_alerts',
  ];
}

function buildServerPayloadUnavailableResult(params: {
  todayDate: string;
  marketStatus: FrontendMarketStatus;
  closedReason: string | null;
}): ResolveResult {
  const { todayDate, marketStatus, closedReason } = params;
  return buildResolveResult({
    report: normalizeMorningAlphaReport(null),
    rawRow: null,
    source: 'server_payload_unavailable',
    queriedDate: todayDate,
    todayDate,
    marketStatus,
    closedReason,
    dataStatus: 'unavailable',
    staleReason: '資料暫時無法載入，請稍後再試',
    tier: 'free',
    lockedSections: getAllLockedSections(),
    payloadSource: 'server_payload_unavailable',
  });
}

async function resolveViaServerTrimmedPayload(params: {
  urlReportDate?: string | null;
  todayDate: string;
  marketStatus: FrontendMarketStatus;
  closedReason: string | null;
}): Promise<ResolveResult | null> {
  const { urlReportDate, todayDate, marketStatus, closedReason } = params;
  const requestedDate = urlReportDate && isValidDateParam(urlReportDate) ? urlReportDate : null;
  const response = await callGetReportPayload({ reportDate: requestedDate });
  const row = toTrimmedReportRow(response);
  if (!row) return null;
  const normalized = normalizeMorningAlphaReport(row);
  const isUrlHistorical = Boolean(requestedDate && requestedDate !== todayDate);
  const status = isUrlHistorical
    ? { dataStatus: 'stale_reference_only' as const, staleReason: `URL 指定歷史報告 ${requestedDate}` }
    : getServerPayloadDataStatus({ rawRow: row, todayDate, marketStatus, closedReason });

  return buildResolveResult({
    report: normalized,
    rawRow: row,
    source: 'server_trimmed_payload',
    queriedDate: requestedDate || row.report_date || todayDate,
    todayDate,
    marketStatus,
    closedReason,
    dataStatus: status.dataStatus,
    staleReason: status.staleReason,
    tier: response.tier,
    lockedSections: response.locked_sections || [],
    payloadSource: 'server_trimmed_payload',
  });
}

/**
 * Resolve the active Morning Alpha report.
 *
 * @param urlReportDate - Optional reportDate from URL params (e.g. from /reports/:reportDate)
 */
export async function resolveActiveMorningAlphaReport(
  urlReportDate?: string | null,
): Promise<ResolveResult> {
  const market = getFrontendMarketDateState();
  const todayStr = market.today_date;

  try {
    const serverResult = await resolveViaServerTrimmedPayload({
      urlReportDate,
      todayDate: todayStr,
      marketStatus: market.market_status,
      closedReason: market.closed_reason,
    });
    if (serverResult) return serverResult;
  } catch (error) {
    console.error('SERVER_TRIMMED_REPORT_PAYLOAD_UNAVAILABLE', error);
    return buildServerPayloadUnavailableResult({
      todayDate: todayStr,
      marketStatus: market.market_status,
      closedReason: market.closed_reason,
    });
  }

  return buildServerPayloadUnavailableResult({
    todayDate: todayStr,
    marketStatus: market.market_status,
    closedReason: market.closed_reason,
  });
}
