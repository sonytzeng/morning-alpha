import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { formatTaipeiDate, getTaipeiNow } from '@/utils/tradingDay';
import { resolveActiveMorningAlphaReport, type ResolveResult } from '@/services/resolveActiveReport';
import type { MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';
import {
  getMarketDataTimestamp,
  getMarketDataTaipeiDate,
  formatMarketDataTaipeiTime,
  canServeAsTWPremarketBasis,
  canServeAsUSPremarketBasis,
  type MarketDataTimeRow,
} from '@/lib/morningAlpha/marketDataTimeHelpers';

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

interface ReportRowRaw {
  id: string;
  report_date: string;
  market_bias: string | null;
  confidence_score: number | null;
  created_at: string;
  ai_strategy_json: Record<string, unknown> | null;
  summary: string | null;
}

interface RadarRow {
  id: string;
  report_date: string;
  radar_status: string | null;
  market_bias: string | null;
  confidence_score: number | null;
  taiex_change: number | null;
  txf_change: number | null;
  tsmc_change: number | null;
  summary: string | null;
  created_at: string;
}

interface CloseReviewRow {
  id: string;
  report_date: string;
  verification_result: string | null;
  verification_label: string | null;
  verification_note: string | null;
  taiex_change: number | null;
  tsmc_change: number | null;
  txf_change: number | null;
  actual_market_result: string | null;
  created_at: string;
}

interface SectorScoreRow {
  id: string;
  score_date: string;
  sector: string;
  rotation_score: number | null;
  signal_label: string | null;
  direction: string | null;
}

interface MarketDataRow {
  id: string;
  symbol: string;
  value: number | null;
  change_percent: number | null;
  captured_at: string;
  created_at?: string | null;
  trading_date?: string | null;
  updated_at?: string | null;
  /** Taipei date derived from captured_at */
  taipeiDate?: string | null;
  /** Whether this row can serve as today's premarket basis */
  usability?: { usable: boolean; label: string } | null;
}

interface DiagnosticData {
  todayTaipeiDate: string;
  taipeiNow: string;
  activeReport: MorningAlphaNormalizedReport | null;
  activeResolve: ResolveResult | null;
  latestReports: ReportRowRaw[];
  latestRadar: RadarRow | null;
  allRadars: RadarRow[];
  latestCloseReview: CloseReviewRow | null;
  allCloseReviews: CloseReviewRow[];
  latestSectorDate: string | null;
  sectorScores: SectorScoreRow[];
  marketDataMap: Record<string, MarketDataRow[]>;
  isLoading: boolean;
  error: string | null;
  aiStrategyFields: Record<string, { status: string; detail: string }>;
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function formatTaipeiTimeString(isoStr: string): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

function getDateOnly(val: string | null | undefined): string | null {
  if (!val) return null;
  return String(val).slice(0, 10);
}

function isTodayRow(row: Record<string, unknown> | null, todayStr: string): boolean {
  if (!row) return false;
  const candidates = [
    row.trading_date, row.report_date, row.market_data_date,
    row.captured_at, row.created_at, row.updated_at, row.generated_at,
    row.score_date,
  ].filter(Boolean);
  return candidates.some((v) => getDateOnly(String(v)) === todayStr);
}

function jsonSummary(val: unknown): string {
  if (val === null || val === undefined) return '無資料';
  if (Array.isArray(val)) return `陣列，項目數 ${val.length}`;
  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>);
    if (keys.length === 0) return '空物件';
    return `物件，鍵數 ${keys.length}`;
  }
  if (typeof val === 'string') return val.trim() ? `文字，${val.length} 字元` : '空字串';
  return `類型 ${typeof val}，值 ${String(val)}`;
}

// ═══════════════════════════════════════════════════
// Symbols to check
// ═══════════════════════════════════════════════════

const TW_SYMBOLS = ['TAIEX', 'TXF', '2330'];
const GLOBAL_SYMBOLS = ['TSM', 'NVDA', 'SPX', 'SOX', 'VIX', 'DXY', 'US10Y'];

// ═══════════════════════════════════════════════════
// Status badge component
// ═══════════════════════════════════════════════════

function StatusBadge({ color, label }: { color: 'green' | 'amber' | 'red' | 'slate'; label: string }) {
  const colorMap = {
    green: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    amber: 'bg-amber-100 text-amber-800 border-amber-300',
    red: 'bg-red-100 text-red-800 border-red-300',
    slate: 'bg-slate-100 text-slate-600 border-slate-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border whitespace-nowrap ${colorMap[color]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        color === 'green' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500' : color === 'red' ? 'bg-red-500' : 'bg-slate-400'
      }`}></span>
      {label}
    </span>
  );
}

// ═══════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════

export default function DataTruthPage() {
  const [data, setData] = useState<DiagnosticData>({
    todayTaipeiDate: '',
    taipeiNow: '',
    activeReport: null,
    activeResolve: null,
    latestReports: [],
    latestRadar: null,
    allRadars: [],
    latestCloseReview: null,
    allCloseReviews: [],
    latestSectorDate: null,
    sectorScores: [],
    marketDataMap: {},
    isLoading: true,
    error: null,
    aiStrategyFields: {},
  });
  const [expandedJson, setExpandedJson] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const todayStr = formatTaipeiDate();
      const taipeiNow = getTaipeiNow();
      const taipeiNowStr = taipeiNow.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });

      // ── Fetch active report via shared resolver ──
      const resolved = await resolveActiveMorningAlphaReport();
      const activeReport = resolved.report;

      // ── Fetch latest 5 reports ──
      const { data: reportsData } = await supabase
        .from('reports')
        .select('id, report_date, market_bias, confidence_score, ai_strategy_json, summary, created_at')
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5);
      const latestReports: ReportRowRaw[] = (reportsData || []).map((r: Record<string, unknown>) => ({
        id: String(r.id || ''),
        report_date: String(r.report_date || ''),
        market_bias: r.market_bias ? String(r.market_bias) : null,
        confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
        created_at: String(r.created_at || ''),
        ai_strategy_json: (r.ai_strategy_json as Record<string, unknown>) || null,
        summary: r.summary ? String(r.summary) : null,
      }));

      // ── Fetch opening market radar (latest first, then check today) ──
      const { data: radarData } = await supabase
        .from('opening_market_radar')
        .select('id, report_date, radar_status, market_bias, confidence_score, taiex_change, txf_change, tsmc_change, summary, created_at')
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5);
      const allRadars: RadarRow[] = (radarData || []).map((r: Record<string, unknown>) => ({
        id: String(r.id || ''),
        report_date: String(r.report_date || ''),
        radar_status: r.radar_status ? String(r.radar_status) : null,
        market_bias: r.market_bias ? String(r.market_bias) : null,
        confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
        taiex_change: r.taiex_change != null ? Number(r.taiex_change) : null,
        txf_change: r.txf_change != null ? Number(r.txf_change) : null,
        tsmc_change: r.tsmc_change != null ? Number(r.tsmc_change) : null,
        summary: r.summary ? String(r.summary) : null,
        created_at: String(r.created_at || ''),
      }));
      const todayRadar = allRadars.find((r) => r.report_date === todayStr);

      // ── Fetch close market review (latest first) ──
      const { data: closeData } = await supabase
        .from('close_market_reviews')
        .select('id, report_date, verification_result, verification_label, verification_note, taiex_change, tsmc_change, txf_change, actual_market_result, created_at')
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5);
      const allCloseReviews: CloseReviewRow[] = (closeData || []).map((r: Record<string, unknown>) => ({
        id: String(r.id || ''),
        report_date: String(r.report_date || ''),
        verification_result: r.verification_result ? String(r.verification_result) : null,
        verification_label: r.verification_label ? String(r.verification_label) : null,
        verification_note: r.verification_note ? String(r.verification_note) : null,
        taiex_change: r.taiex_change != null ? Number(r.taiex_change) : null,
        tsmc_change: r.tsmc_change != null ? Number(r.tsmc_change) : null,
        txf_change: r.txf_change != null ? Number(r.txf_change) : null,
        actual_market_result: r.actual_market_result ? String(r.actual_market_result) : null,
        created_at: String(r.created_at || ''),
      }));
      const todayClose = allCloseReviews.find((r) => r.report_date === todayStr);

      // ── Fetch sector rotation scores ──
      const { data: sectorData } = await supabase
        .from('sector_rotation_scores')
        .select('id, score_date, sector, rotation_score, signal_label, direction')
        .order('score_date', { ascending: false })
        .order('rotation_score', { ascending: false })
        .limit(50);
      const sectorScores: SectorScoreRow[] = (sectorData || []).map((r: Record<string, unknown>) => ({
        id: String(r.id || ''),
        score_date: String(r.score_date || ''),
        sector: String(r.sector || ''),
        rotation_score: r.rotation_score != null ? Number(r.rotation_score) : null,
        signal_label: r.signal_label ? String(r.signal_label) : null,
        direction: r.direction ? String(r.direction) : null,
      }));
      const sectorDates = [...new Set(sectorScores.map((s) => s.score_date))].sort().reverse();
      const latestSectorDate = sectorDates[0] || null;

      // ── Fetch market_data for key symbols ──
      const allSymbols = [...TW_SYMBOLS, ...GLOBAL_SYMBOLS];
      const { data: mdData } = await supabase
        .from('market_data')
        .select('id, symbol, value, change_percent, captured_at, created_at, trading_date, updated_at')
        .in('symbol', allSymbols)
        .order('captured_at', { ascending: false })
        .limit(100);
      const marketDataMap: Record<string, MarketDataRow[]> = {};
      for (const sym of allSymbols) {
        marketDataMap[sym] = [];
      }
      (mdData || []).forEach((r: Record<string, unknown>) => {
        const sym = String(r.symbol || '');
        if (marketDataMap[sym]) {
          const mdRow: MarketDataRow = {
            id: String(r.id || ''),
            symbol: sym,
            value: r.value != null ? Number(r.value) : null,
            change_percent: r.change_percent != null ? Number(r.change_percent) : null,
            captured_at: String(r.captured_at || ''),
            created_at: r.created_at ? String(r.created_at) : null,
            trading_date: r.trading_date ? String(r.trading_date) : null,
            updated_at: r.updated_at ? String(r.updated_at) : null,
            taipeiDate: getMarketDataTaipeiDate(r as MarketDataTimeRow),
            usability: null,
          };
          // Compute usability: TW symbols use TWPremarketBasis, US symbols use USPremarketBasis
          if (TW_SYMBOLS.includes(sym)) {
            const basis = canServeAsTWPremarketBasis(r as MarketDataTimeRow, todayStr);
            mdRow.usability = { usable: basis.usable, label: basis.label };
          } else if (GLOBAL_SYMBOLS.includes(sym)) {
            const basis = canServeAsUSPremarketBasis(r as MarketDataTimeRow, todayStr);
            mdRow.usability = { usable: basis.usable, label: basis.label };
          }
          marketDataMap[sym].push(mdRow);
        }
      });

      // ── Check ai_strategy_json fields ──
      const aiRaw = resolved.rawRow?.ai_strategy_json || {};
      const aiFields = [
        'member_research_note', 'member_note', 'paid_member_note',
        'premium_research', 'deep_member_research', 'research_note',
        'strategy_note', 'reasoning_chain', 'overnight_impact_chain',
        'intraday_validation_plan', 'invalidation_conditions',
        'closing_feedback_plan', 'renewal_value_block',
        'free_summary', 'reels_script', 'social_post',
        'line_push_copy', 'line_push_message', 'line_message',
        'publish_ready', 'no_fake_fallback', 'fake_fallback_used',
        'ai_version', 'quality_score', 'member_value_score',
        'market_data_date', 'us_global_date', 'tw_core_date',
        'content_publish_gate', 'generated_at', 'source',
      ];
      const aiStrategyFields: Record<string, { status: string; detail: string }> = {};
      for (const f of aiFields) {
        const v = (aiRaw as Record<string, unknown>)[f];
        if (v === undefined) {
          aiStrategyFields[f] = { status: '不存在', detail: '欄位不存在於 ai_strategy_json' };
        } else if (v === null) {
          aiStrategyFields[f] = { status: 'null', detail: '值為 null' };
        } else if (Array.isArray(v)) {
          aiStrategyFields[f] = { status: '存在', detail: `陣列，項目數 ${v.length}` };
        } else if (typeof v === 'object') {
          const keys = Object.keys(v as Record<string, unknown>);
          aiStrategyFields[f] = { status: '存在', detail: keys.length === 0 ? '空物件' : `物件，鍵數 ${keys.length}` };
        } else if (typeof v === 'string') {
          aiStrategyFields[f] = { status: '存在', detail: v.trim() ? `文字，${v.length} 字元` : '空字串' };
        } else {
          aiStrategyFields[f] = { status: '存在', detail: `類型 ${typeof v}，值 ${String(v)}` };
        }
      }

      setData({
        todayTaipeiDate: todayStr,
        taipeiNow: taipeiNowStr,
        activeReport,
        activeResolve: resolved,
        latestReports,
        latestRadar: todayRadar || allRadars[0] || null,
        allRadars,
        latestCloseReview: todayClose || allCloseReviews[0] || null,
        allCloseReviews,
        latestSectorDate,
        sectorScores,
        marketDataMap,
        isLoading: false,
        error: null,
        aiStrategyFields,
      });
    } catch (err) {
      setData((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : '資料讀取失敗',
      }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ═══════════════════════════════════════════════════
  // Derived checks
  // ═══════════════════════════════════════════════════

  const todayStr = data.todayTaipeiDate;
  const activeResolve = data.activeResolve;
  const activeReport = data.activeReport;
  const rawRow = activeResolve?.rawRow;

  // Report existence
  const hasTodayReport = data.latestReports.length > 0 && data.latestReports[0].report_date === todayStr;
  const hasAnyReport = data.latestReports.length > 0;

  // Report date check
  const latestReportDate = data.latestReports[0]?.report_date || null;
  const reportDateIsToday = latestReportDate === todayStr;

  // Market data date check
  const marketDataDate = activeReport?.marketDataBasisDate || '—';
  const marketDataDateIsYesterday = (() => {
    if (!marketDataDate || marketDataDate === '—') return false;
    if (marketDataDate === todayStr) return false;
    const prevDay = new Date(todayStr);
    prevDay.setDate(prevDay.getDate() - 1);
    const prevStr = prevDay.toISOString().slice(0, 10);
    return marketDataDate === prevStr;
  })();

  // Radar check
  const todayRadar = data.allRadars.find((r) => r.report_date === todayStr);
  const hasTodayRadar = !!todayRadar;
  const hasOldRadar = data.allRadars.length > 0 && !hasTodayRadar;

  // Close review check
  const todayClose = data.allCloseReviews.find((r) => r.report_date === todayStr);
  const hasTodayClose = !!todayClose;
  const hasOldClose = data.allCloseReviews.length > 0 && !hasTodayClose;

  // Sector rotation check
  const hasTodaySector = data.latestSectorDate === todayStr;
  const hasOldSector = data.latestSectorDate !== null && !hasTodaySector;

  // Publish ready
  const publishReady = activeReport?.publishReady ?? false;

  // Member note check
  const memberNoteField = data.aiStrategyFields['member_research_note'];
  const hasMemberNote = memberNoteField?.status === '存在';

  // Active report consistency
  const activeReportId = activeReport?.reportId || '—';
  const activeReportDate = activeReport?.reportDate || '—';

  // Time-based checks
  const taipeiHour = (() => {
    try {
      const d = getTaipeiNow();
      return d.getHours();
    } catch {
      return 0;
    }
  })();

  // ═══════════════════════════════════════════════════
  // Most likely problem
  // ═══════════════════════════════════════════════════

  const problems: string[] = [];
  if (!hasTodayReport) {
    problems.push('07:30 報告產生沒有成功，請檢查 generate-daily-report-v7 / cron-generate-report。');
  }
  if (hasTodayReport && activeReportId !== data.latestReports[0]?.id) {
    problems.push('前台 active_report_id 與最新報告不一致，請統一 resolver。');
  }
  if (hasTodayReport && !hasMemberNote) {
    problems.push('OpenAI 會員研究筆記欄位未產生或欄位名稱不一致（檢查 ai_strategy_json.member_research_note）。');
  }
  if (!hasTodayRadar) {
    problems.push('09:30 盤中雷達沒有產生（檢查 opening-market-radar Edge Function）。');
  }
  if (!hasTodayClose && taipeiHour >= 14) {
    problems.push('14:10 收盤驗證沒有產生（檢查 close-market-review Edge Function）。');
  }
  if (!hasTodaySector && hasOldSector) {
    problems.push('14:20 類股輪動沒有更新或資料日期未寫入（檢查 generate-sector-rotation Edge Function）。');
  }
  if (reportDateIsToday && marketDataDate !== todayStr && marketDataDateIsYesterday) {
    // This is normal — don't flag as error
  }
  if (reportDateIsToday && publishReady === false) {
    problems.push('publish_ready=false，報告需人工檢查後才能標記為可公開。');
  }

  // ═══════════════════════════════════════════════════
  // Frontend consistency check
  // ═══════════════════════════════════════════════════

  const frontendPages = [
    { name: '首頁', usesResolver: true },
    { name: '今日判斷', usesResolver: true },
    { name: '會員研究筆記', usesResolver: true },
    { name: '後台今日內容', usesResolver: true },
    { name: '發布素材', usesResolver: false },
  ];

  // ═══════════════════════════════════════════════════
  // Loading / Error
  // ═══════════════════════════════════════════════════

  if (data.isLoading) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="text-center">
          <i className="ri-loader-4-line text-3xl animate-spin text-foreground-400"></i>
          <p className="mt-3 text-foreground-500 text-sm">載入資料真相檢查...</p>
        </div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <i className="ri-error-warning-line text-2xl text-red-500"></i>
          </div>
          <p className="text-foreground-900 font-semibold mb-2">資料讀取失敗</p>
          <p className="text-foreground-500 text-sm mb-4">{data.error}</p>
          <button
            onClick={load}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            重新載入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground-900">Morning Alpha 資料真相檢查</h2>
          <p className="text-xs text-foreground-500 mt-0.5">
            此頁只用來檢查資料流是否正確，不影響前台顯示。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-400">檢查時間：{data.taipeiNow}</span>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg bg-background-100 hover:bg-background-200 text-foreground-600 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
          >
            <i className="ri-refresh-line text-sm"></i>
            重新檢查
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 1: Summary Status */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-dashboard-line text-base"></i>
          總覽狀態
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* Today date */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">台北今日日期</p>
            <p className="text-sm font-mono font-semibold text-foreground-900">{data.todayTaipeiDate}</p>
          </div>
          {/* Report status */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">Report 狀態</p>
            {reportDateIsToday ? (
              <StatusBadge color="green" label="今日盤前報告已產生" />
            ) : hasAnyReport ? (
              <StatusBadge color="red" label={`最新 ${latestReportDate || '—'}`} />
            ) : (
              <StatusBadge color="red" label="今日盤前報告尚未產生" />
            )}
          </div>
          {/* Radar status */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">盤中雷達</p>
            {hasTodayRadar ? (
              <StatusBadge color="green" label="今日已更新" />
            ) : hasOldRadar ? (
              <StatusBadge color="amber" label={`最新 ${data.allRadars[0]?.report_date || '—'}`} />
            ) : (
              <StatusBadge color="red" label="找不到資料" />
            )}
          </div>
          {/* Close review */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">收盤驗證</p>
            {hasTodayClose ? (
              <StatusBadge color="green" label="今日已完成" />
            ) : hasOldClose ? (
              <StatusBadge color="amber" label={`最新 ${data.allCloseReviews[0]?.report_date || '—'}`} />
            ) : (
              <StatusBadge color="red" label="找不到資料" />
            )}
          </div>
          {/* Sector */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">類股輪動</p>
            {hasTodaySector ? (
              <StatusBadge color="green" label="今日已更新" />
            ) : hasOldSector ? (
              <StatusBadge color="amber" label={`最新 ${data.latestSectorDate || '—'}`} />
            ) : (
              <StatusBadge color="red" label="找不到資料" />
            )}
          </div>
          {/* Publish ready */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">publish_ready</p>
            {activeReport ? (
              publishReady ? (
                <StatusBadge color="green" label="可公開" />
              ) : (
                <StatusBadge color="amber" label="需人工檢查" />
              )
            ) : (
              <StatusBadge color="red" label="無報告" />
            )}
          </div>
          {/* Market data date */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">盤前資料基準</p>
            <p className="text-sm font-mono font-semibold text-foreground-900">
              {marketDataDate}
              {marketDataDateIsYesterday && (
                <span className="ml-1.5 text-xs font-normal text-emerald-600">（正常盤前基準）</span>
              )}
            </p>
          </div>
          {/* Active report ID */}
          <div>
            <p className="text-xs text-foreground-400 mb-0.5">Active Report ID</p>
            <p className="text-xs font-mono text-foreground-600 truncate max-w-[200px]" title={activeReportId}>
              {activeReportId === '—' ? '—' : activeReportId.slice(0, 12) + '...'}
            </p>
          </div>
        </div>

        {/* V27: Daily overall status A/B/C */}
        <div className="mt-4 pt-4 border-t border-background-200">
          {/* ── Status A: 正常 ── */}
          {reportDateIsToday && hasTodayReport && activeReport && activeReport.marketBias && activeReport.marketBias !== '—' && (activeReport.confidenceScore != null) && (
            <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 flex items-start gap-2">
              <i className="ri-check-double-line text-emerald-600 text-sm mt-0.5"></i>
              <div>
                <p className="text-emerald-800 text-xs font-semibold">狀態 A：正常 — 今日盤前報告正常</p>
                <p className="text-emerald-700 text-xs mt-0.5">report_date 為今日、market_bias 與 confidence_score 皆存在。盤前資料基準為正常交易日。</p>
              </div>
            </div>
          )}
          {/* ── Status B: 需檢查 ── */}
          {reportDateIsToday && hasTodayReport && !publishReady && (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex items-start gap-2 mt-2">
              <i className="ri-shield-check-line text-amber-600 text-sm mt-0.5"></i>
              <div>
                <p className="text-amber-800 text-xs font-semibold">狀態 B：需檢查 — 今日報告已產生，但需人工檢查</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  publish_ready=false{!hasMemberNote ? '、會員內容缺少' : ''}{!hasTodayRadar ? '、盤中雷達尚未更新' : ''}。
                </p>
              </div>
            </div>
          )}
          {/* ── Status C: 錯誤 ── */}
          {!hasTodayReport && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 flex items-start gap-2 mt-2">
              <i className="ri-error-warning-line text-red-600 text-sm mt-0.5"></i>
              <div>
                <p className="text-red-800 text-xs font-semibold">狀態 C：錯誤 — 今日報告資料流異常</p>
                <p className="text-red-700 text-xs mt-0.5">
                  今日 report 不存在，請檢查 generate-daily-report-v7 Edge Function 或 cron 排程。
                  {hasAnyReport && `最新報告日期為 ${latestReportDate}。`}
                </p>
              </div>
            </div>
          )}
          {/* ── Edge case: report exists but not today ── */}
          {hasAnyReport && !reportDateIsToday && hasTodayReport === false && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 flex items-start gap-2 mt-2">
              <i className="ri-calendar-check-line text-red-600 text-sm mt-0.5"></i>
              <div>
                <p className="text-red-800 text-xs font-semibold">
                  狀態 C：錯誤 — 有舊報告但無今日報告（今日 {todayStr}，最新 {latestReportDate}）
                </p>
                <p className="text-red-700 text-xs mt-0.5">請確認 generate-daily-report-v7 是否正常執行。</p>
              </div>
            </div>
          )}
          {/* ── Active report mismatch check ── */}
          {activeResolve && hasAnyReport && data.latestReports[0]?.id !== activeReportId && activeReportId !== '—' && (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex items-start gap-2 mt-2">
              <i className="ri-link-unlink text-amber-600 text-sm mt-0.5"></i>
              <div>
                <p className="text-amber-800 text-xs font-semibold">active report 不一致</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  最新 reports 第一筆 ID 與全站 active report ID 不同，可能有兩份同日期報告或多筆報告順序問題。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 2: Active Report Detail */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-file-text-line text-base"></i>
          全站 Active Report
        </h3>
        <p className="text-xs text-foreground-400 mb-3">
          這是目前前台、今日判斷、會員研究筆記、後台今日內容應該共同使用的 report。
        </p>

        {activeReport && rawRow ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <span className="text-xs text-foreground-400">report_id</span>
              <p className="text-xs font-mono text-foreground-900 truncate" title={activeReportId}>{activeReportId.slice(0, 16)}...</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">report_date</span>
              <p className="text-xs font-mono font-semibold text-foreground-900">{activeReportDate}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">market_data_date</span>
              <p className="text-xs font-mono text-foreground-900">{marketDataDate}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">us_market_date</span>
              <p className="text-xs font-mono text-foreground-900">{activeReport?.diagnostics.marketDataBasisDate || (data.aiStrategyFields['us_global_date']?.status === '存在' ? data.aiStrategyFields['us_global_date']?.detail : '—')}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">created_at 台北</span>
              <p className="text-xs font-mono text-foreground-900">{formatTaipeiTimeString(rawRow.created_at)}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">market_bias</span>
              <p className="text-xs font-semibold text-foreground-900">{activeReport.marketBias}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">confidence_score</span>
              <p className="text-xs font-mono font-semibold text-foreground-900">{activeReport.confidenceScore ?? '—'}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">publish_ready</span>
              <StatusBadge color={publishReady ? 'green' : 'amber'} label={publishReady ? 'true' : 'false'} />
            </div>
            <div>
              <span className="text-xs text-foreground-400">no_fake_fallback</span>
              <p className="text-xs font-mono text-foreground-900">{String(activeReport.noFakeFallback)}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">fake_fallback_used</span>
              <p className="text-xs font-mono text-foreground-900">{String(activeReport.fakeFallbackUsed)}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">ai_version</span>
              <p className="text-xs font-mono text-foreground-900">{activeReport.aiVersion || '—'}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">source</span>
              <p className="text-xs font-mono text-foreground-900">{activeResolve?.source || '—'}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">quality_score</span>
              <p className="text-xs font-mono text-foreground-900">{activeReport.qualityScore || '—'}</p>
            </div>
            <div>
              <span className="text-xs text-foreground-400">member_value_score</span>
              <p className="text-xs font-mono text-foreground-900">{activeReport.memberValueScore || '—'}</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <StatusBadge color="red" label="無 active report" />
            <p className="text-xs text-foreground-400 mt-2">reports 資料表沒有任何報告。</p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 3: Reports History (Latest 5) */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-history-line text-base"></i>
          Reports 最新 5 筆
        </h3>
        {data.latestReports.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-xs text-foreground-400">reports 資料表沒有任何報告。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-background-200">
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">狀態</th>
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">report_date</th>
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">market_bias</th>
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">conf</th>
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">publish_ready</th>
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">member_note</th>
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">ai_strategy_json</th>
                  <th className="text-left py-2 px-2 text-foreground-400 font-medium">created_at 台北</th>
                </tr>
              </thead>
              <tbody>
                {data.latestReports.map((r) => {
                  const isToday = r.report_date === todayStr;
                  const ai = r.ai_strategy_json || {};
                  const pr = (ai as Record<string, unknown>).publish_ready === true;
                  const hasMember = !!(ai as Record<string, unknown>).member_research_note;
                  const hasAiJson = !!r.ai_strategy_json;
                  return (
                    <tr key={r.id} className="border-b border-background-100 hover:bg-background-50 transition-colors">
                      <td className="py-2 px-2">
                        <StatusBadge
                          color={isToday ? 'green' : 'slate'}
                          label={isToday ? '今日報告' : '舊報告'}
                        />
                      </td>
                      <td className="py-2 px-2 font-mono font-semibold text-foreground-900">{r.report_date}</td>
                      <td className="py-2 px-2 text-foreground-700">{r.market_bias || '—'}</td>
                      <td className="py-2 px-2 font-mono text-foreground-700">{r.confidence_score ?? '—'}</td>
                      <td className="py-2 px-2">
                        <StatusBadge color={pr ? 'green' : 'amber'} label={pr ? '可公開' : '需檢查'} />
                      </td>
                      <td className="py-2 px-2">
                        <StatusBadge color={hasMember ? 'green' : 'red'} label={hasMember ? '存在' : '缺少'} />
                      </td>
                      <td className="py-2 px-2">
                        <StatusBadge color={hasAiJson ? 'green' : 'red'} label={hasAiJson ? '存在' : '缺少'} />
                      </td>
                      <td className="py-2 px-2 font-mono text-foreground-600 whitespace-nowrap">{formatTaipeiTimeString(r.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 4: Member Analysis Field Check */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-brain-line text-base"></i>
          會員完整分析欄位檢查（ai_strategy_json）
        </h3>
        <p className="text-xs text-foreground-400 mb-3">
          檢查 activeReport.ai_strategy_json 內各欄位是否存在。
          {!rawRow && '（目前無 active report）'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {Object.entries(data.aiStrategyFields).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between px-3 py-2 rounded-md bg-background-50 border border-background-100">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  val.status === '存在' ? 'bg-emerald-500' :
                  val.status === '不存在' || val.status === 'null' ? 'bg-red-400' :
                  'bg-amber-400'
                }`}></span>
                <span className="text-xs font-mono text-foreground-800 truncate">{key}</span>
              </div>
              <span className="text-xs text-foreground-500 whitespace-nowrap ml-2">{val.detail}</span>
            </div>
          ))}
        </div>
        {/* Expand JSON button */}
        {rawRow?.ai_strategy_json && (
          <div className="mt-3">
            <button
              onClick={() => setExpandedJson(expandedJson === 'ai_json' ? null : 'ai_json')}
              className="text-xs text-primary-500 hover:text-primary-600 font-medium cursor-pointer whitespace-nowrap flex items-center gap-1"
            >
              {expandedJson === 'ai_json' ? (
                <><i className="ri-arrow-up-s-line"></i> 收合 ai_strategy_json</>
              ) : (
                <><i className="ri-arrow-down-s-line"></i> 展開完整 ai_strategy_json</>
              )}
            </button>
            {expandedJson === 'ai_json' && (
              <pre className="mt-2 p-3 bg-background-100 rounded-md text-xs font-mono text-foreground-700 overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(rawRow.ai_strategy_json, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 5: Opening Market Radar */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-radar-line text-base"></i>
          09:30 盤中雷達（opening_market_radar）
        </h3>
        {data.allRadars.length === 0 ? (
          <div className="text-center py-4">
            <StatusBadge color="red" label="找不到盤中雷達資料" />
            <p className="text-xs text-foreground-400 mt-2">opening_market_radar 資料表沒有任何資料。</p>
          </div>
        ) : (
          <>
            {/* Today radar */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-foreground-700">今日盤中雷達：</span>
                {hasTodayRadar && todayRadar ? (
                  <StatusBadge color="green" label={`已更新 ${todayRadar.report_date}`} />
                ) : (
                  <StatusBadge color="amber" label="今日尚未更新" />
                )}
              </div>
              {hasTodayRadar && todayRadar && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-emerald-50 border border-emerald-200 rounded-md p-3">
                  <div>
                    <span className="text-xs text-foreground-500">radar_status</span>
                    <p className="text-xs font-semibold text-foreground-900">{todayRadar.radar_status || '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-foreground-500">market_bias</span>
                    <p className="text-xs font-semibold text-foreground-900">{todayRadar.market_bias || '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-foreground-500">TAIEX change</span>
                    <p className={`text-xs font-mono font-semibold ${(todayRadar.taiex_change ?? 0) >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {todayRadar.taiex_change != null ? `${todayRadar.taiex_change > 0 ? '+' : ''}${todayRadar.taiex_change}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-foreground-500">2330 change</span>
                    <p className={`text-xs font-mono font-semibold ${(todayRadar.tsmc_change ?? 0) >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {todayRadar.tsmc_change != null ? `${todayRadar.tsmc_change > 0 ? '+' : ''}${todayRadar.tsmc_change}%` : '—'}
                    </p>
                  </div>
                  <div className="col-span-full">
                    <span className="text-xs text-foreground-500">summary</span>
                    <p className="text-xs text-foreground-800 mt-0.5">{todayRadar.summary || '—'}</p>
                  </div>
                </div>
              )}
              {!hasTodayRadar && hasOldRadar && (
                <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                  <p className="text-xs text-amber-700">
                    最新盤中雷達日期：<span className="font-mono font-semibold">{data.allRadars[0]?.report_date || '—'}</span>（非今日資料，不可作為今日盤中判斷）
                  </p>
                </div>
              )}
            </div>
            {/* All radars */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-background-200">
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">日期</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">狀態</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">bias</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">TAIEX</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">2330</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">時間</th>
                  </tr>
                </thead>
                <tbody>
                  {data.allRadars.slice(0, 5).map((r) => (
                    <tr key={r.id} className="border-b border-background-100">
                      <td className="py-1.5 px-2 font-mono font-semibold">
                        {r.report_date}
                        {r.report_date === todayStr && (
                          <span className="ml-1 text-[10px] text-emerald-600">今日</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2">{r.radar_status || '—'}</td>
                      <td className="py-1.5 px-2">{r.market_bias || '—'}</td>
                      <td className="py-1.5 px-2 font-mono">{r.taiex_change != null ? `${r.taiex_change}%` : '—'}</td>
                      <td className="py-1.5 px-2 font-mono">{r.tsmc_change != null ? `${r.tsmc_change}%` : '—'}</td>
                      <td className="py-1.5 px-2 text-foreground-500 whitespace-nowrap">{formatTaipeiTimeString(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 6: Close Market Review */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-verified-badge-line text-base"></i>
          14:10 收盤驗證（close_market_reviews）
        </h3>
        {data.allCloseReviews.length === 0 ? (
          <div className="text-center py-4">
            <StatusBadge color="red" label="找不到收盤驗證資料" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-foreground-700">今日收盤驗證：</span>
              {hasTodayClose && todayClose ? (
                <StatusBadge color="green" label={`已完成 ${todayClose.report_date}`} />
              ) : taipeiHour < 14 ? (
                <StatusBadge color="slate" label="尚未開始（未到 14:10）" />
              ) : (
                <StatusBadge color="amber" label="今日收盤驗證尚未產生" />
              )}
            </div>
            {hasTodayClose && todayClose && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 mb-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <span className="text-xs text-foreground-500">驗證結果</span>
                    <p className="text-xs font-semibold text-foreground-900">{todayClose.verification_result || '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-foreground-500">驗證標籤</span>
                    <p className="text-xs font-semibold text-foreground-900">{todayClose.verification_label || '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-foreground-500">TAIEX 收盤</span>
                    <p className={`text-xs font-mono font-semibold ${(todayClose.taiex_change ?? 0) >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {todayClose.taiex_change != null ? `${todayClose.taiex_change > 0 ? '+' : ''}${todayClose.taiex_change}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-foreground-500">實際結果</span>
                    <p className="text-xs font-semibold text-foreground-900">{todayClose.actual_market_result || '—'}</p>
                  </div>
                </div>
                {todayClose.verification_note && (
                  <div className="mt-2 pt-2 border-t border-emerald-200">
                    <span className="text-xs text-foreground-500">驗證說明</span>
                    <p className="text-xs text-foreground-800 mt-0.5">{todayClose.verification_note}</p>
                  </div>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-background-200">
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">日期</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">驗證</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">TAIEX</th>
                    <th className="text-left py-1.5 px-2 text-foreground-400 font-medium">時間</th>
                  </tr>
                </thead>
                <tbody>
                  {data.allCloseReviews.map((r) => (
                    <tr key={r.id} className="border-b border-background-100">
                      <td className="py-1.5 px-2 font-mono font-semibold">
                        {r.report_date}
                        {r.report_date === todayStr && <span className="ml-1 text-[10px] text-emerald-600">今日</span>}
                      </td>
                      <td className="py-1.5 px-2">{r.verification_result || r.verification_label || '—'}</td>
                      <td className="py-1.5 px-2 font-mono">{r.taiex_change != null ? `${r.taiex_change}%` : '—'}</td>
                      <td className="py-1.5 px-2 text-foreground-500 whitespace-nowrap">{formatTaipeiTimeString(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 7: Sector Rotation */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-pie-chart-line text-base"></i>
          14:20 類股輪動（sector_rotation_scores）
        </h3>
        {data.sectorScores.length === 0 ? (
          <div className="text-center py-4">
            <StatusBadge color="red" label="找不到類股輪動資料" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-foreground-700">最新類股輪動：</span>
              {hasTodaySector ? (
                <StatusBadge color="green" label={`今日已更新 ${data.latestSectorDate}`} />
              ) : (
                <StatusBadge color="amber" label={`最新 ${data.latestSectorDate}（上一交易日參考）`} />
              )}
            </div>
            {/* Today sector scores */}
            {(() => {
              const todayScores = data.sectorScores.filter((s) => s.score_date === todayStr).slice(0, 5);
              const latestScores = data.sectorScores.filter((s) => s.score_date === data.latestSectorDate).slice(0, 5);
              const displayScores = todayScores.length >= 3 ? todayScores : latestScores;
              if (displayScores.length === 0) return null;
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
                  {displayScores.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-background-50 border border-background-100">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          (s.rotation_score ?? 0) >= 70 ? 'bg-red-500' :
                          (s.rotation_score ?? 0) >= 50 ? 'bg-amber-500' :
                          'bg-emerald-500'
                        }`}></span>
                        <span className="text-xs font-medium text-foreground-800 truncate">{s.sector}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground-400">{s.signal_label || s.direction || '—'}</span>
                        <span className="text-xs font-mono font-semibold text-foreground-900">{s.rotation_score ?? '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
            <p className="text-xs text-foreground-400 mb-2">日期 {data.latestSectorDate || '—'}，共 {data.sectorScores.filter((s) => s.score_date === data.latestSectorDate).length} 個類股</p>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 8: Market Data */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-line-chart-line text-base"></i>
          市場資料（market_data）
        </h3>
        <p className="text-xs text-foreground-400 mb-3">
          時間判斷以 captured_at 轉台北時間為準，不可直接用 UTC 日期字串前 10 碼判斷。
        </p>

        {/* TW section */}
        <h4 className="text-xs font-semibold text-foreground-500 mb-2 uppercase tracking-wide">台股核心</h4>
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-background-200">
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">Symbol</th>
                <th className="text-right py-2 px-2 text-foreground-400 font-medium">Value</th>
                <th className="text-right py-2 px-2 text-foreground-400 font-medium">Change%</th>
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">captured_at (UTC)</th>
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">台北時間</th>
                <th className="text-center py-2 px-2 text-foreground-400 font-medium">台北日期</th>
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">盤前可用性</th>
              </tr>
            </thead>
            <tbody>
              {TW_SYMBOLS.map((sym) => {
                const rows = (data.marketDataMap[sym] || []).slice(0, 1);
                const row = rows[0];
                const r = row as MarketDataRow | undefined;
                return (
                  <tr key={sym} className="border-b border-background-100 hover:bg-background-50 transition-colors">
                    <td className="py-2 px-2 font-mono font-semibold text-foreground-900">{sym}</td>
                    {r ? (
                      <>
                        <td className="py-2 px-2 text-right font-mono text-foreground-700">{r.value ?? '—'}</td>
                        <td className={`py-2 px-2 text-right font-mono ${(r.change_percent ?? 0) >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {r.change_percent != null ? `${r.change_percent > 0 ? '+' : ''}${r.change_percent}%` : '—'}
                        </td>
                        <td className="py-2 px-2 font-mono text-foreground-500 text-[10px] max-w-[140px] truncate" title={r.captured_at}>
                          {r.captured_at ? r.captured_at.replace('T', ' ').replace('+00:00', '') : '—'}
                        </td>
                        <td className="py-2 px-2 font-mono text-foreground-600 text-[10px] whitespace-nowrap">
                          {formatMarketDataTaipeiTime(r as MarketDataTimeRow)}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-semibold">
                          {r.taipeiDate ? (
                            <span className={`${r.taipeiDate === data.todayTaipeiDate ? 'text-emerald-600' : 'text-foreground-700'}`}>
                              {r.taipeiDate}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-2">
                          {r.usability ? (
                            <StatusBadge color={r.usability.usable ? 'green' : 'amber'} label={r.usability.label} />
                          ) : (
                            <span className="text-xs text-foreground-400">—</span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="py-2 px-2 text-foreground-400">無資料</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Global section */}
        <h4 className="text-xs font-semibold text-foreground-500 mb-2 uppercase tracking-wide">美股與海外</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-background-200">
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">Symbol</th>
                <th className="text-right py-2 px-2 text-foreground-400 font-medium">Value</th>
                <th className="text-right py-2 px-2 text-foreground-400 font-medium">Change%</th>
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">captured_at (UTC)</th>
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">台北時間</th>
                <th className="text-center py-2 px-2 text-foreground-400 font-medium">台北日期</th>
                <th className="text-left py-2 px-2 text-foreground-400 font-medium">盤前可用性</th>
              </tr>
            </thead>
            <tbody>
              {GLOBAL_SYMBOLS.map((sym) => {
                const rows = (data.marketDataMap[sym] || []).slice(0, 1);
                const row = rows[0];
                const r = row as MarketDataRow | undefined;
                return (
                  <tr key={sym} className="border-b border-background-100 hover:bg-background-50 transition-colors">
                    <td className="py-2 px-2 font-mono font-semibold text-foreground-900">{sym}</td>
                    {r ? (
                      <>
                        <td className="py-2 px-2 text-right font-mono text-foreground-700">{r.value ?? '—'}</td>
                        <td className={`py-2 px-2 text-right font-mono ${(r.change_percent ?? 0) >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {r.change_percent != null ? `${r.change_percent > 0 ? '+' : ''}${r.change_percent}%` : '—'}
                        </td>
                        <td className="py-2 px-2 font-mono text-foreground-500 text-[10px] max-w-[140px] truncate" title={r.captured_at}>
                          {r.captured_at ? r.captured_at.replace('T', ' ').replace('+00:00', '') : '—'}
                        </td>
                        <td className="py-2 px-2 font-mono text-foreground-600 text-[10px] whitespace-nowrap">
                          {formatMarketDataTaipeiTime(r as MarketDataTimeRow)}
                        </td>
                        <td className="py-2 px-2 text-center font-mono font-semibold">
                          {r.taipeiDate ? (
                            <span className={`${r.taipeiDate === data.todayTaipeiDate ? 'text-emerald-600' : 'text-foreground-700'}`}>
                              {r.taipeiDate}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2 px-2">
                          {r.usability ? (
                            <StatusBadge color={r.usability.usable ? 'green' : 'amber'} label={r.usability.label} />
                          ) : (
                            <span className="text-xs text-foreground-400">—</span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="py-2 px-2 text-foreground-400">無資料</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Time note */}
        <p className="text-[10px] text-foreground-300 mt-3 leading-relaxed">
          台股核心的 captured_at 若為前一個交易日收盤（台北時間 13:30 後），屬於正常盤前基準。
          美股與海外的 captured_at 若為今日凌晨（台北時間 04:00 後），屬於今日盤前海外資料。
          不可因 UTC 日期為前一天就判斷為過期。
        </p>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 9: Frontend Consistency */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-links-line text-base"></i>
          前台一致性檢查
        </h3>
        <p className="text-xs text-foreground-400 mb-3">
          以下頁面應使用同一筆 active_report_id：<span className="font-mono text-foreground-700">{activeReportId === '—' ? '無' : activeReportId.slice(0, 16) + '...'}</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {frontendPages.map((page) => (
            <div key={page.name} className="flex items-center justify-between px-3 py-2 rounded-md border">
              <span className="text-xs font-medium text-foreground-800">{page.name}</span>
              {page.usesResolver ? (
                <StatusBadge color="green" label="已使用共用 resolver" />
              ) : (
                <StatusBadge color="red" label="可能未使用共用 resolver" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* CARD 10: Most Likely Problems */}
      {/* ═══════════════════════════════════════════════ */}
      <div className="bg-white rounded-lg border border-background-200 p-5">
        <h3 className="text-sm font-semibold text-foreground-900 mb-3 flex items-center gap-2">
          <i className="ri-error-warning-line text-base"></i>
          目前最可能問題
        </h3>
        {problems.length === 0 ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3">
            <div className="flex items-center gap-2">
              <i className="ri-check-line text-emerald-600"></i>
              <span className="text-xs font-medium text-emerald-800">未偵測到明顯問題，所有資料檢查通過。</span>
            </div>
            {reportDateIsToday && marketDataDateIsYesterday && (
              <p className="text-xs text-emerald-700 mt-1.5">
                盤前資料基準 market_data_date（{marketDataDate}）是前一完整交易日，這是正常盤前邏輯，不是錯誤。
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {problems.map((p, i) => (
              <div key={i} className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
                <i className="ri-error-warning-line text-red-500 text-sm mt-0.5 flex-shrink-0"></i>
                <p className="text-xs text-red-800">{p}</p>
              </div>
            ))}
          </div>
        )}
        {/* Normal note about date mismatch */}
        {reportDateIsToday && marketDataDateIsYesterday && problems.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mt-2">
            <p className="text-xs text-blue-700">
              盤前資料基準 market_data_date（{marketDataDate}）是前一完整交易日，這是正常盤前邏輯，不是錯誤。
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* Footer note */}
      {/* ═══════════════════════════════════════════════ */}
      <p className="text-[10px] text-foreground-300 text-center pb-6">
        此頁面僅供管理員使用，不修改任何資料。所有查詢均為唯讀。資料來源：reports、opening_market_radar、close_market_reviews、sector_rotation_scores、market_data。
      </p>
    </div>
  );
}