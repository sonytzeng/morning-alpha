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
import { formatTaipeiDate } from '@/utils/tradingDay';
import {
  REPORTS_STABLE_COLUMNS,
  fetchBestReport,
  normalizeMorningAlphaReport,
  type ReportRow,
  type MorningAlphaNormalizedReport,
} from '@/lib/morningAlphaReportAdapter';

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
  source: 'today_match' | 'best_fallback' | 'url_param' | 'empty';
  /** The report_date that was queried */
  queriedDate: string;
  /** True when using historical fallback (not today's report) */
  isHistoricalFallback: boolean;
  /** The fallback report_date if using historical data */
  fallbackReportDate: string | null;
}

/**
 * Resolve the active Morning Alpha report.
 *
 * @param urlReportDate - Optional reportDate from URL params (e.g. from /reports/:reportDate)
 */
export async function resolveActiveMorningAlphaReport(
  urlReportDate?: string | null,
): Promise<ResolveResult> {
  const todayStr = formatTaipeiDate();

  // ── Rule B: URL param only if valid ──
  if (urlReportDate && isValidDateParam(urlReportDate)) {
    const { data, error } = await supabase
      .from('reports')
      .select(REPORTS_STABLE_COLUMNS)
      .eq('report_date', urlReportDate)
      .maybeSingle();

    if (!error && data) {
      const row: ReportRow = {
        id: String(data.id || ''),
        report_date: String(data.report_date || ''),
        market_bias: data.market_bias ? String(data.market_bias) : null,
        confidence_score: data.confidence_score != null ? Number(data.confidence_score) : null,
        created_at: String(data.created_at || ''),
        ai_strategy_json: (data.ai_strategy_json as Record<string, unknown>) || null,
        summary: data.summary ? String(data.summary) : null,
        watch_sectors_json: Array.isArray(data.watch_sectors_json) ? (data.watch_sectors_json as Record<string, unknown>[]) : null,
      };
      return {
        report: normalizeMorningAlphaReport(row),
        rawRow: row,
        source: 'url_param',
        queriedDate: urlReportDate,
        isHistoricalFallback: urlReportDate !== todayStr,
        fallbackReportDate: urlReportDate !== todayStr ? urlReportDate : null,
      };
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
    const row: ReportRow = {
      id: String(todayData.id || ''),
      report_date: String(todayData.report_date || ''),
      market_bias: todayData.market_bias ? String(todayData.market_bias) : null,
      confidence_score: todayData.confidence_score != null ? Number(todayData.confidence_score) : null,
      created_at: String(todayData.created_at || ''),
      ai_strategy_json: (todayData.ai_strategy_json as Record<string, unknown>) || null,
      summary: todayData.summary ? String(todayData.summary) : null,
      watch_sectors_json: Array.isArray(todayData.watch_sectors_json) ? (todayData.watch_sectors_json as Record<string, unknown>[]) : null,
    };
    return {
      report: normalizeMorningAlphaReport(row),
      rawRow: row,
      source: 'today_match',
      queriedDate: todayStr,
      isHistoricalFallback: false,
      fallbackReportDate: null,
    };
  }

  // ── Rule B: Fallback to best report ──
  const bestRow = await fetchBestReport();

  if (bestRow) {
    const isHistorical = bestRow.report_date !== todayStr;
    return {
      report: normalizeMorningAlphaReport(bestRow),
      rawRow: bestRow,
      source: 'best_fallback',
      queriedDate: bestRow.report_date,
      isHistoricalFallback: isHistorical,
      fallbackReportDate: isHistorical ? bestRow.report_date : null,
    };
  }

  // ── Rule F: No reports at all ──
  return {
    report: normalizeMorningAlphaReport(null),
    rawRow: null,
    source: 'empty',
    queriedDate: todayStr,
    isHistoricalFallback: false,
    fallbackReportDate: null,
  };
}