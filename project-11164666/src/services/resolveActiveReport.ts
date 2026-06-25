/**
 * resolveActiveMorningAlphaReport — SINGLE SOURCE OF TRUTH for report reading
 *
 * Every page (home, today-report, dashboard, war-room, admin) MUST use this function
 * to get the current active Morning Alpha report. No page should do its own
 * supabase.from('reports').select() directly.
 *
 * Resolution rules:
 * A. Priority: today's report (report_date = todayTaipeiDate)
 * B. Fallback: fetchBestReport() (prefers publish_ready, then latest)
 * C. URL param reportDate: only used if valid YYYY-MM-DD format, NOT literal
 *    placeholders like ":reportDate", "undefined", "null", or empty strings
 * D. Returns normalized MorningAlphaNormalizedReport
 * E. If no reports exist at all, returns empty state
 * F. Never generates fake data
 */

import { supabase } from '@/lib/supabase';
import { getFrontendMarketDateState, type FrontendMarketStatus } from '@/utils/marketDate';
import {
  REPORTS_STABLE_COLUMNS,
  fetchBestReport,
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
  is_today_report: boolean;
  is_stale_report: boolean;
  stale_reason: string | null;
  data_status: 'ready' | 'missing_today_report' | 'market_closed' | 'stale_reference_only' | 'unavailable';
  tier: SubscriptionTier;
  locked_sections: string[];
  payload_source: 'server_trimmed_payload' | 'server_payload_unavailable' | 'direct_reports_fallback' | 'empty';
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

function toTrimmedReportRow(response: ServerReportPayloadResponse): ReportRow | null {
  if (!response.payload || !response.report_date) return null;
  const payload = response.payload;
  return {
    id: `server-trimmed:${response.report_date}`,
    report_date: response.report_date,
    market_bias: typeof payload.market_bias === 'string' ? payload.market_bias : null,
    confidence_score: payload.confidence_score != null ? Number(payload.confidence_score) : null,
    created_at: '',
    ai_strategy_json: payload,
    summary: typeof payload.today_quote === 'string' ? payload.today_quote : null,
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
    payloadSource = rawRow ? 'direct_reports_fallback' : 'empty',
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

function buildUnavailableReportRow(todayDate: string): ReportRow {
  return {
    id: `server-payload-unavailable:${todayDate}`,
    report_date: todayDate,
    market_bias: '資料暫不可用',
    confidence_score: null,
    created_at: '',
    ai_strategy_json: null,
    summary: '資料暫時無法載入，請稍後再試',
    watch_sectors_json: null,
  };
}

function buildServerPayloadUnavailableResult(params: {
  todayDate: string;
  marketStatus: FrontendMarketStatus;
  closedReason: string | null;
}): ResolveResult {
  const { todayDate, marketStatus, closedReason } = params;
  const row = buildUnavailableReportRow(todayDate);
  return buildResolveResult({
    report: normalizeMorningAlphaReport(row),
    rawRow: row,
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

function isDebugFullFallbackEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug_full_fallback') !== '1') return false;
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return isLocalhost || import.meta.env.DEV === true;
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

async function resolveActiveMorningAlphaReportFromReports(
  urlReportDate: string | null | undefined,
  market: ReturnType<typeof getFrontendMarketDateState>,
): Promise<ResolveResult> {
  const todayStr = market.today_date;

  // ── Rule B: URL param only if valid ──
  if (urlReportDate && isValidDateParam(urlReportDate)) {
    const { data, error } = await supabase
      .from('reports')
      .select(REPORTS_STABLE_COLUMNS)
      .eq('report_date', urlReportDate)
      .maybeSingle();

    if (!error && data) {
      const row = toReportRow(data as Record<string, unknown>);
      const normalized = normalizeMorningAlphaReport(row);
      return buildResolveResult({
        report: normalized,
        rawRow: row,
        source: 'url_param',
        queriedDate: urlReportDate,
        todayDate: todayStr,
        marketStatus: market.market_status,
        closedReason: market.closed_reason,
        dataStatus: urlReportDate === todayStr ? 'ready' : 'stale_reference_only',
        staleReason: urlReportDate !== todayStr ? `URL 指定歷史報告 ${urlReportDate}` : null,
      });
    }
    // URL param didn't match — fall through to normal resolution
  }

  // ── Rule A: Today's report first ──
  const { data: todayData, error: todayErr } = await supabase
    .from('reports')
    .select(REPORTS_STABLE_COLUMNS)
    .eq('report_date', todayStr)
    .maybeSingle();

  if (!todayErr && todayData) {
    const row = toReportRow(todayData as Record<string, unknown>);
    return buildResolveResult({
      report: normalizeMorningAlphaReport(row),
      rawRow: row,
      source: 'today_match',
      queriedDate: todayStr,
      todayDate: todayStr,
      marketStatus: market.market_status,
      closedReason: market.closed_reason,
      dataStatus: 'ready',
    });
  }

  // ── Market closed: latest report is reference only, never today's report ──
  if (market.market_status === 'closed') {
    const bestRow = await fetchBestReport();

    if (bestRow) {
      return buildResolveResult({
        report: normalizeMorningAlphaReport(bestRow),
        rawRow: bestRow,
        source: 'best_fallback',
        queriedDate: bestRow.report_date,
        todayDate: todayStr,
        marketStatus: market.market_status,
        closedReason: market.closed_reason,
        dataStatus: 'market_closed',
        staleReason: `今日休市（${market.closed_reason || '休市'}），${bestRow.report_date} 僅供歷史參考`,
      });
    }

    return buildResolveResult({
      report: normalizeMorningAlphaReport(null),
      rawRow: null,
      source: 'empty',
      queriedDate: todayStr,
      todayDate: todayStr,
      marketStatus: market.market_status,
      closedReason: market.closed_reason,
      dataStatus: 'market_closed',
      staleReason: `今日休市（${market.closed_reason || '休市'}）`,
    });
  }

  // ── Trading day: never backfill today with latest report ──
  return buildResolveResult({
    report: normalizeMorningAlphaReport(null),
    rawRow: null,
    source: 'empty',
    queriedDate: todayStr,
    todayDate: todayStr,
    marketStatus: market.market_status,
    closedReason: market.closed_reason,
    dataStatus: 'missing_today_report',
    staleReason: '交易日尚未產生今日盤前報告',
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
    if (isDebugFullFallbackEnabled()) {
      // Dev-only. Never enable in production.
      console.warn('SECURITY_DEBUG_FULL_REPORT_FALLBACK_USED', error);
      return resolveActiveMorningAlphaReportFromReports(urlReportDate, market);
    }
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
