/**
 * Morning Alpha Report Adapter — SINGLE SOURCE OF TRUTH
 *
 * This is the ONLY file that reads raw Supabase reports rows and parses
 * ai_strategy_json. Every page, hook, and service in the entire project
 * MUST consume data through this adapter's normalized output.
 *
 * V28 Field mapping (reports table has NO top-level ai_version, publish_ready, market_data_date):
 *   aiVersion      → ai_strategy_json.version
 *   publishReady   → ai_strategy_json.content_publish_gate (primary) || ai_strategy_json.publish_ready (fallback)
 *   TW basis       → ai_strategy_json.tw_core_date > data_basis > market_data_date > selected_symbol_dates
 *   US basis       → ai_strategy_json.us_global_date > us_market_date
 *   generatedAt    → generated_at aliases > report timestamps
 */

import { supabase } from '@/lib/supabase';
import { formatTaipeiDate, isTaipeiWeekendToday } from '@/utils/tradingDay';

// ═══════════════════════════════════════════════════
// Raw Supabase Row Type
// ═══════════════════════════════════════════════════

export interface ReportRow {
  id: string;
  report_date: string;
  market_bias: string | null;
  confidence_score: number | null;
  created_at: string;
  updated_at?: string | null;
  ai_strategy_json: Record<string, unknown> | null;
  summary: string | null;
  watch_sectors_json: Record<string, unknown>[] | null;
}

// ═══════════════════════════════════════════════════
// Normalized Output Type
// ═══════════════════════════════════════════════════

export interface MorningAlphaNormalizedReport {
  rawReport: ReportRow | null;
  strategy: Record<string, unknown> | null;

  reportId: string;
  reportCreatedAt: string;
  reportDate: string;
  reportDisplayDate: string;
  /** TW core date: tw_core_date > data_basis > market_data_date */
  marketDataBasisDate: string;
  /** US/Global date: us_global_date > us_market_date */
  usMarketBasisDate: string;
  /** generated_at > created_at */
  generatedAt: string;

  aiVersion: string;
  source: string;

  marketBias: string;
  confidenceScore: number | null;
  qualityScore: number;
  memberValueScore: number;

  publishReady: boolean;
  contentGateStatus: string;
  noFakeFallback: boolean;
  fakeFallbackUsed: boolean;
  dataDateAligned: boolean;

  qualityPass: boolean;
  memberValuePass: boolean;
  canPublish: boolean;

  hasFreeSummary: boolean;
  hasMemberResearchNote: boolean;
  hasReasoningChain: boolean;
  hasOvernightImpactChain: boolean;
  hasIntradayPlan: boolean;
  hasInvalidationConditions: boolean;
  hasClosingPlan: boolean;
  hasRenewalBlock: boolean;
  hasReelsScript: boolean;
  hasSocialPost: boolean;
  hasLineCopy: boolean;

  freeSummary: Record<string, unknown> | null;
  oneSentence: string;
  importantObservations: { title: string; content: string }[];

  memberNote: Record<string, unknown> | null;
  reasoningChain: Record<string, unknown>[];
  overnightImpactChain: Record<string, unknown>[];
  intradayPlan: Record<string, unknown> | null;
  invalidationConditions: Record<string, unknown>[];
  closingPlan: Record<string, unknown> | null;
  renewalBlock: Record<string, unknown> | null;
  reelsScript: Record<string, unknown> | null;
  socialPost: Record<string, unknown> | null;
  lineCopy: Record<string, unknown> | null;

  memberNoteSectionCount: number;
  memberNoteTitle: string;
  memberNoteExecutiveView: string;
  memberNoteDataBasis: string;
  memberNoteKeyObservations: Record<string, unknown>[];
  memberNoteMainThesis: string;
  memberNoteRiskNotes: string;

  dashboardStatus: { level: 'success' | 'warning' | 'error'; label: string; message: string };
  contentStatus: {
    baseReport: boolean; freeSummary: boolean; memberResearchNote: boolean;
    reelsScript: boolean; socialPost: boolean; lineCopy: 'ready' | 'not_connected';
    qualityCheck: boolean; autoPublish: boolean;
  };
  publicPageStatus: {
    displayLabel: string; displayBias: string; displayConfidence: number | null; sourceStatusText: string;
  };
  adminActionRequired: boolean;
  nextActionText: string;

  diagnostics: {
    reportId: string; aiVersion: string; source: string; publishReady: boolean;
    noFakeFallback: boolean; fakeFallbackUsed: boolean; dataDateAligned: boolean;
    qualityScore: number; memberValueScore: number;
    marketDataBasisDate: string; usMarketBasisDate: string; generatedAt: string;
    contentGateStatus: string; reportDisplayDate: string;
    hasFreeSummary: boolean; hasMemberResearchNote: boolean; hasReasoningChain: boolean;
    hasOvernightImpactChain: boolean; hasIntradayPlan: boolean; hasInvalidationConditions: boolean;
    hasClosingPlan: boolean; hasRenewalBlock: boolean; hasReelsScript: boolean;
    hasSocialPost: boolean; hasLineCopy: boolean;
    blockingIssues: string[];
  };

  isOpenAISource: boolean;
  memberNoteDisplayTitle: string;
  memberNoteDisplaySubtitle: string;
}

// ═══════════════════════════════════════════════════
// Query Helpers
// ═══════════════════════════════════════════════════

export const REPORTS_STABLE_COLUMNS =
  'id, report_date, market_bias, confidence_score, ai_strategy_json, summary, created_at, watch_sectors_json';

function isReportsRlsBlocked(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return code === '42501' || message.includes('permission denied') || message.includes('row-level security');
}

export async function fetchLatestReports(limit = 10): Promise<ReportRow[]> {
  const { data, error } = await supabase
    .from('reports')
    .select(REPORTS_STABLE_COLUMNS)
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isReportsRlsBlocked(error)) {
      console.warn('REPORTS_RLS_BLOCKED_PUBLIC_HISTORY', error.message);
      return [];
    }
    throw new Error(`fetchLatestReports: ${error.message}`);
  }

  return (data || []).map((r: Record<string, unknown>) => ({
    id: String(r.id || ''),
    report_date: String(r.report_date || ''),
    market_bias: r.market_bias ? String(r.market_bias) : null,
    confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
    created_at: String(r.created_at || ''),
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
    ai_strategy_json: (r.ai_strategy_json as Record<string, unknown>) || null,
    summary: r.summary ? String(r.summary) : null,
    watch_sectors_json: Array.isArray(r.watch_sectors_json) ? (r.watch_sectors_json as Record<string, unknown>[]) : null,
  }));
}

export async function fetchLatestSingleReport(): Promise<ReportRow | null> {
  const { data, error } = await supabase
    .from('reports')
    .select(REPORTS_STABLE_COLUMNS)
    .order('report_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    if (isReportsRlsBlocked(error)) {
      console.warn('REPORTS_RLS_BLOCKED_PUBLIC_HISTORY', error.message);
      return null;
    }
    throw new Error(`fetchLatestSingleReport: ${error.message}`);
  }
  if (!data || data.length === 0) return null;

  const r = data[0] as Record<string, unknown>;
  return {
    id: String(r.id || ''),
    report_date: String(r.report_date || ''),
    market_bias: r.market_bias ? String(r.market_bias) : null,
    confidence_score: r.confidence_score != null ? Number(r.confidence_score) : null,
    created_at: String(r.created_at || ''),
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
    ai_strategy_json: (r.ai_strategy_json as Record<string, unknown>) || null,
    summary: r.summary ? String(r.summary) : null,
    watch_sectors_json: Array.isArray(r.watch_sectors_json) ? (r.watch_sectors_json as Record<string, unknown>[]) : null,
  };
}

export async function fetchBestReport(): Promise<ReportRow | null> {
  const reports = await fetchLatestReports(10);
  if (reports.length === 0) return null;

  // V28: Check content_publish_gate first, then fall back to ai.publish_ready
  const ready = reports.find((r) => {
    const ai = r.ai_strategy_json;
    if (!ai) return false;
    const cpg = (ai as Record<string, unknown>).content_publish_gate as Record<string, unknown> | undefined;
    if (cpg) {
      const status = cpg.status as string | undefined;
      if (status && ['pass', 'passed', 'ready', 'approved'].includes(status.toLowerCase())) return true;
    }
    const pr = (ai as Record<string, unknown>).publish_ready;
    return pr === true || pr === 'true';
  });

  if (ready && ready.id !== reports[0].id) {
    const latest = reports[0];
    const latestAi = latest.ai_strategy_json;
    if (latestAi) {
      const noFake = (latestAi as Record<string, unknown>).no_fake_fallback === true;
      const fakeUsed = (latestAi as Record<string, unknown>).fake_fallback_used === true;
      if (noFake && !fakeUsed) return latest;
    }
    if (!latestAi && latest.report_date === reports[0].report_date) return latest;
  }

  return ready || reports[0];
}

// ═══════════════════════════════════════════════════
// Safe Accessors
// ═══════════════════════════════════════════════════

function grabStr(obj: unknown, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

function grabNum(obj: unknown, key: string): number {
  if (!obj || typeof obj !== 'object') return 0;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') { const n = Number(v); if (!Number.isNaN(n)) return n; }
  return 0;
}

function grabBool(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  return v === true || v === 'true';
}

function grabObj(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  // Edge Function sometimes writes nested objects as JSON-encoded strings inside the JSONB column.
  // Parse it here transparently so normalized report consumers don't need to handle this case.
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* not valid JSON string — treat as absent */ }
  }
  return null;
}

function grabArr(obj: unknown, key: string): Record<string, unknown>[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  return Array.isArray(o[key]) ? (o[key] as Record<string, unknown>[]) : [];
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resolveGeneratedAt(raw: ReportRow, ai: Record<string, unknown>): string {
  const rawRecord = raw as unknown as Record<string, unknown>;
  return firstNonEmptyString(
    ai.generated_at,
    ai.generatedAt,
    ai.report_generated_at,
    rawRecord.created_at,
    rawRecord.updated_at,
    grabObj(ai, 'ai_strategy_json')?.generated_at,
  );
}

// ═══════════════════════════════════════════════════
// Core Normalization
// ═══════════════════════════════════════════════════

export function normalizeMorningAlphaReport(raw: ReportRow | null): MorningAlphaNormalizedReport {
  if (!raw) {
    const todayStr = formatTaipeiDate();
    return {
      rawReport: null, strategy: null,
      reportId: '', reportCreatedAt: '', reportDate: todayStr, reportDisplayDate: todayStr,
      marketDataBasisDate: '—', usMarketBasisDate: '—', generatedAt: '',
      aiVersion: '', source: '',
      marketBias: '—', confidenceScore: null, qualityScore: 0, memberValueScore: 0,
      publishReady: false, contentGateStatus: '', noFakeFallback: false, fakeFallbackUsed: false, dataDateAligned: false,
      qualityPass: false, memberValuePass: false, canPublish: false,
      hasFreeSummary: false, hasMemberResearchNote: false, hasReasoningChain: false,
      hasOvernightImpactChain: false, hasIntradayPlan: false, hasInvalidationConditions: false,
      hasClosingPlan: false, hasRenewalBlock: false, hasReelsScript: false, hasSocialPost: false,
      hasLineCopy: false,
      freeSummary: null, oneSentence: '今日盤前報告尚未產生。', importantObservations: [],
      memberNote: null, reasoningChain: [], overnightImpactChain: [], intradayPlan: null,
      invalidationConditions: [], closingPlan: null, renewalBlock: null,
      reelsScript: null, socialPost: null, lineCopy: null,
      memberNoteSectionCount: 0, memberNoteTitle: '', memberNoteExecutiveView: '',
      memberNoteDataBasis: '', memberNoteKeyObservations: [], memberNoteMainThesis: '',
      memberNoteRiskNotes: '',
      dashboardStatus: { level: 'error', label: '報告缺失', message: 'reports 資料表無報告，請檢查 cron 排程。' },
      contentStatus: { baseReport: false, freeSummary: false, memberResearchNote: false,
        reelsScript: false, socialPost: false, lineCopy: 'not_connected', qualityCheck: false, autoPublish: false },
      publicPageStatus: { displayLabel: '報告準備中', displayBias: '—', displayConfidence: null,
        sourceStatusText: '資料驗證中' },
      adminActionRequired: true, nextActionText: '請檢查 cron-job.org 排程與 Edge Function 是否正常執行。',
      diagnostics: { reportId: '', aiVersion: '', source: '', publishReady: false,
        noFakeFallback: false, fakeFallbackUsed: false, dataDateAligned: false,
        qualityScore: 0, memberValueScore: 0,
        marketDataBasisDate: '—', usMarketBasisDate: '—', generatedAt: '',
        contentGateStatus: '', reportDisplayDate: todayStr,
        hasFreeSummary: false, hasMemberResearchNote: false, hasReasoningChain: false,
        hasOvernightImpactChain: false, hasIntradayPlan: false, hasInvalidationConditions: false,
        hasClosingPlan: false, hasRenewalBlock: false, hasReelsScript: false,
        hasSocialPost: false, hasLineCopy: false, blockingIssues: [] },
      isOpenAISource: false,
      memberNoteDisplayTitle: 'Morning Alpha 盤前研究筆記',
      memberNoteDisplaySubtitle: '報告尚未產生。',
    };
  }

  const ai = raw.ai_strategy_json || {};
  const strategy = ai;

  // ── IDs & dates ──
  const reportId = raw.id;
  const generatedAt = resolveGeneratedAt(raw, ai);
  const reportCreatedAt = generatedAt || raw.created_at;
  const reportDate = raw.report_date || formatTaipeiDate();
  const reportDisplayDate = raw.report_date || formatTaipeiDate();
  // V28: TW core date — priority: tw_core_date > data_basis > market_data_date > raw.report_date
  const marketDataBasisDate =
    grabStr(ai, 'tw_core_date') || grabStr(ai, 'data_basis') || grabStr(ai, 'market_data_date') || grabStr(ai, 'market_data_latest_date') || raw.report_date || '—';
  // V28: US/Global date — priority: us_global_date > us_market_date > raw.report_date
  const usMarketBasisDate =
    grabStr(ai, 'us_global_date') || grabStr(ai, 'us_market_date') || raw.report_date || '—';
  // ── Version & source (reports table has NO top-level ai_version) ──
  const aiVersion = grabStr(ai, 'version');
  const source = grabStr(ai, 'source');
  const isOpenAISource = source.startsWith('openai');

  // ── Core values ──
  // V8.3: ai_strategy_json.market_bias is PRIMARY source, root column is fallback only
  const marketBias = grabStr(ai, 'market_bias') || (raw.market_bias ?? '') || grabStr(ai, 'estimated_market_bias_from_market_data') || '—';
  // V8.3: ai_strategy_json.confidence_score is PRIMARY source, root column is fallback only
  const aiConfValue = (ai as Record<string, unknown>).confidence_score;
  const aiConfScore = (typeof aiConfValue === 'number' && !Number.isNaN(aiConfValue)) ? aiConfValue : null;
  const confidenceScore = aiConfScore ?? raw.confidence_score ?? null;
  const qualityScore = grabNum(ai, 'quality_score');
  const memberValueScore = grabNum(ai, 'member_value_score');

  // ── Quality flags ──
  // V376: Read overall_status in addition to status — Edge Function V7.54.2 writes overall_status
  const rawContentGate = (ai as Record<string, unknown>).content_publish_gate as Record<string, unknown> | undefined;
  const contentGateStatus = grabStr(rawContentGate || null, 'overall_status') || grabStr(rawContentGate || null, 'status');
  const contentGatePassed = rawContentGate && (
    ['pass', 'passed', 'ready', 'approved'].includes(contentGateStatus.toLowerCase()) ||
    contentGateStatus === '可公開'
  );
  const publishReady = contentGatePassed || grabBool(ai, 'publish_ready');
  const noFakeFallback = grabBool(ai, 'no_fake_fallback');
  const fakeFallbackUsed = grabBool(ai, 'fake_fallback_used');
  const dataDateAligned = grabBool(ai, 'data_date_aligned');

  // ── Computed gates ──
  const canPublish =
    !!raw && !!raw.report_date && !!raw.market_bias && raw.confidence_score != null &&
    !!raw.ai_strategy_json && noFakeFallback && !fakeFallbackUsed && contentGatePassed;
  const qualityPass = qualityScore >= 75;
  const memberValuePass = memberValueScore >= 80;

  // ── Structured data ──
  const freeSummary = grabObj(ai, 'free_summary') || grabObj(ai, 'public_summary');
  const memberNote = grabObj(ai, 'member_research_note');
  const reasoningChain = grabArr(ai, 'reasoning_chain');
  const overnightImpactChain = grabArr(ai, 'overnight_impact_chain');
  const intradayPlan = grabObj(ai, 'intraday_validation_plan');
  const invalidationConditions = grabArr(ai, 'invalidation_conditions').filter(
    (inv) => typeof inv.condition === 'string' && inv.condition.trim().length > 0,
  );
  const closingPlan = grabObj(ai, 'closing_feedback_plan');
  const renewalBlock = grabObj(ai, 'renewal_value_block');
  const reelsScript = grabObj(ai, 'reels_script');
  const socialPost = grabObj(ai, 'social_post');
  const lineCopy = grabObj(ai, 'line_push_copy') || grabObj(ai, 'line_push_message') || grabObj(ai, 'line_message');

  // ── Content flags ──
  const hasFreeSummary = !!freeSummary || !!ai.free_summary;
  const hasReasoningChain = reasoningChain.length > 0;
  const hasOvernightImpactChain = overnightImpactChain.length > 0;
  const hasIntradayPlan = !!(intradayPlan && (intradayPlan.open_0900_0930 || intradayPlan.mid_session_1000_1130 || intradayPlan.afternoon_1300_1330));
  const hasInvalidationConditions = invalidationConditions.length > 0;
  const hasClosingPlan = !!(closingPlan && (closingPlan.what_to_check_after_close || closingPlan.how_to_score_today || closingPlan.what_to_adjust_tomorrow));
  const hasRenewalBlock = !!(renewalBlock && (renewalBlock.why_member_should_read_today || renewalBlock.what_free_news_does_not_provide || renewalBlock.tomorrow_followup_hook));
  const hasReelsScript = !!(reelsScript && (reelsScript.hook_0_5_sec || reelsScript.core_5_25_sec || reelsScript.risk_25_40_sec || reelsScript.watch_40_55_sec || reelsScript.cta_55_60_sec));
  const hasSocialPost = !!(socialPost && (socialPost.title || socialPost.full_post));
  const hasLineCopy = !!lineCopy;

  // ── Member note detail ──
  const memberNoteTitle = grabStr(memberNote, 'title');
  const memberNoteExecutiveView = grabStr(memberNote, 'executive_view');
  const memberNoteDataBasis = grabStr(memberNote, 'data_basis');
  const memberNoteKeyObservations = Array.isArray(memberNote?.key_observations)
    ? (memberNote!.key_observations as Record<string, unknown>[]) : [];
  const memberNoteMainThesis = grabStr(memberNote, 'main_thesis');
  const memberNoteRiskNotes = grabStr(memberNote, 'risk_notes');

  const hasMemberResearchNote =
    !!memberNoteTitle || !!memberNoteExecutiveView || !!memberNoteDataBasis ||
    memberNoteKeyObservations.length > 0 || !!memberNoteMainThesis || !!memberNoteRiskNotes;

  const sectionParts: unknown[] = [
    memberNoteTitle, memberNoteExecutiveView, memberNoteDataBasis,
    ...memberNoteKeyObservations, memberNoteMainThesis, memberNoteRiskNotes,
  ];
  const memberNoteSectionCount = sectionParts.filter((p) => {
    if (p === null || p === undefined) return false;
    if (typeof p === 'string') return p.trim().length > 0;
    return true;
  }).length;

  // ── One sentence ──
  const oneSentence = computeOneSentence(ai, freeSummary, socialPost, memberNote);

  // ── Important observations ──
  const importantObservations = computeImportantObservations(
    memberNoteKeyObservations, reasoningChain, freeSummary, socialPost,
  );

  // ── Content status ──
  const contentStatus = {
    baseReport: true,
    freeSummary: !!oneSentence && oneSentence !== '今日盤前報告已產生，但一句話摘要尚未完成前端 mapping。',
    memberResearchNote: hasMemberResearchNote,
    reelsScript: hasReelsScript,
    socialPost: hasSocialPost,
    lineCopy: hasLineCopy ? 'ready' as const : 'not_connected' as const,
    qualityCheck: qualityPass && memberValuePass && publishReady,
    autoPublish: publishReady,
  };

  // ── Dashboard status ──
  const dashboardStatus = canPublish
    ? { level: 'success' as const, label: '可公開', message: '今日報告已通過發布檢查，內容品質與會員價值達標。' }
    : (raw && noFakeFallback
        ? { level: 'info' as const, label: '今日報告已產生', message: '今日報告已產生，請查看下方內容。' }
        : { level: 'error' as const, label: '尚未產生', message: '尚未產生可公開的報告，請檢查 cron 排程與 Edge Function 是否正常執行。' });

  const adminActionRequired = !canPublish;
  const nextActionText = canPublish ? '前往前台驗收內容顯示' : '查看 diagnostics 與 content_publish_gate';

  // ── Public page status ──
  const publicPageStatus = {
    displayLabel: raw ? '今日報告已產生' : '今日報告尚未產生',
    displayBias: grabStr(freeSummary, 'market_bias') || marketBias,
    displayConfidence: freeSummary ? grabNum(freeSummary, 'confidence_score') || (confidenceScore ?? null) : (confidenceScore ?? null),
    sourceStatusText: noFakeFallback && !fakeFallbackUsed && dataDateAligned
      ? '真實資料 / 無假資料 / 已通過發布檢查'
      : noFakeFallback ? '真實資料 / 無假資料' : '資料驗證中',
  };

  // ── Diagnostics ──
  const cpgRaw = grabObj(ai, 'content_publish_gate');
  const diagnostics = {
    reportId, aiVersion, source, publishReady,
    noFakeFallback, fakeFallbackUsed, dataDateAligned,
    qualityScore, memberValueScore,
    marketDataBasisDate, usMarketBasisDate, generatedAt,
    contentGateStatus, reportDisplayDate,
    hasFreeSummary, hasMemberResearchNote, hasReasoningChain, hasOvernightImpactChain,
    hasIntradayPlan, hasInvalidationConditions, hasClosingPlan, hasRenewalBlock,
    hasReelsScript, hasSocialPost, hasLineCopy,
    blockingIssues: Array.isArray(cpgRaw?.blocking_issues) ? (cpgRaw!.blocking_issues as string[]) : [],
  };

  // ── Member note display ──
  const memberNoteDisplayTitle = `Morning Alpha ${reportDisplayDate} 盤前研究筆記`;
  const noteBasisDate = marketDataBasisDate !== '—' ? marketDataBasisDate : (usMarketBasisDate !== '—' ? usMarketBasisDate : '');
  const memberNoteDisplaySubtitle = noteBasisDate
    ? `本篇使用台股最近完整交易日 ${noteBasisDate}，核心資料包含 TAIEX、2330、TXF、SPX、IXIC、SOX、NVDA、TSM、VIX、DXY、US10Y。`
    : '本篇盤前研究筆記。';

  return {
    rawReport: raw, strategy,
    reportId, reportCreatedAt, reportDate, reportDisplayDate,
    marketDataBasisDate, usMarketBasisDate, generatedAt,
    aiVersion, source,
    marketBias, confidenceScore, qualityScore, memberValueScore,
    publishReady, contentGateStatus,
    noFakeFallback, fakeFallbackUsed, dataDateAligned,
    qualityPass, memberValuePass, canPublish,
    hasFreeSummary, hasMemberResearchNote, hasReasoningChain,
    hasOvernightImpactChain, hasIntradayPlan, hasInvalidationConditions,
    hasClosingPlan, hasRenewalBlock, hasReelsScript, hasSocialPost, hasLineCopy,
    freeSummary, oneSentence, importantObservations,
    memberNote, reasoningChain, overnightImpactChain, intradayPlan,
    invalidationConditions, closingPlan, renewalBlock,
    reelsScript, socialPost, lineCopy,
    memberNoteSectionCount, memberNoteTitle, memberNoteExecutiveView,
    memberNoteDataBasis, memberNoteKeyObservations, memberNoteMainThesis, memberNoteRiskNotes,
    dashboardStatus, contentStatus, publicPageStatus,
    adminActionRequired, nextActionText,
    diagnostics,
    isOpenAISource,
    memberNoteDisplayTitle,
    memberNoteDisplaySubtitle,
  };
}

// ═══════════════════════════════════════════════════
// One Sentence Computation
// ═══════════════════════════════════════════════════

const FORBIDDEN_ONE_LINERS = [
  '今天非交易日', '等待更多市場訊號', '保持觀望', '關注後續',
  '市場方向：中性震盪', '等待更多資料確認', '市場情緒持平',
  '關注市場變化', '需謹慎', '留意風險', '等待更多訊號',
  '可能受到影響', '影響市場情緒', '投資人應保持謹慎',
  '市場情緒中性震盪', '半導體與 AI 成為焦點', '靈活應對',
  '關注半導體', '保持靈活',
];

function isForbiddenOneLiner(text: string): boolean {
  return FORBIDDEN_ONE_LINERS.some((p) => text.includes(p));
}

function computeOneSentence(
  ai: Record<string, unknown>,
  freeSummary: Record<string, unknown> | null,
  socialPost: Record<string, unknown> | null,
  memberNote: Record<string, unknown> | null,
): string {
  const v8DailySentence = grabObj(ai, 'v8_daily_sentence');
  const v8Sentence = v8DailySentence?.sentence;
  if (typeof v8Sentence === 'string' && v8Sentence.trim() && !isForbiddenOneLiner(v8Sentence)) {
    return v8Sentence.trim();
  }
  const aiDailySentence = ai.daily_sentence;
  if (typeof aiDailySentence === 'string' && aiDailySentence.trim() && !isForbiddenOneLiner(aiDailySentence)) {
    return aiDailySentence.trim();
  }
  const aiTodayQuote = ai.today_quote;
  if (typeof aiTodayQuote === 'string' && aiTodayQuote.trim() && !isForbiddenOneLiner(aiTodayQuote)) {
    return aiTodayQuote.trim();
  }
  const fsDailySentence = freeSummary?.daily_sentence;
  if (typeof fsDailySentence === 'string' && fsDailySentence.trim() && !isForbiddenOneLiner(fsDailySentence)) {
    return fsDailySentence.trim();
  }
  // V28: free_summary.one_liner (primary for one-liner)
  const fsOneLiner = freeSummary?.one_liner;
  if (typeof fsOneLiner === 'string' && fsOneLiner.trim() && !isForbiddenOneLiner(fsOneLiner)) {
    return fsOneLiner.trim();
  }
  // free_summary.one_sentence
  const fsOneSentence = freeSummary?.one_sentence;
  if (typeof fsOneSentence === 'string' && fsOneSentence.trim() && !isForbiddenOneLiner(fsOneSentence)) {
    return fsOneSentence.trim();
  }
  // free_summary.summary
  const fsSummary = freeSummary?.summary;
  if (typeof fsSummary === 'string' && fsSummary.trim() && !isForbiddenOneLiner(fsSummary)) {
    return fsSummary.length > 200 ? fsSummary.slice(0, 200) + '...' : fsSummary.trim();
  }
  // social_post.title
  const spTitle = socialPost?.title;
  if (typeof spTitle === 'string' && spTitle.trim() && !isForbiddenOneLiner(spTitle)) {
    return spTitle.trim();
  }
  // member_research_note.main_thesis
  const mnThesis = memberNote?.main_thesis;
  if (typeof mnThesis === 'string' && mnThesis.trim() && !isForbiddenOneLiner(mnThesis)) {
    return mnThesis.length > 120 ? mnThesis.slice(0, 120) + '...' : mnThesis;
  }
  // member_research_note.executive_view
  const mnExecView = memberNote?.executive_view;
  if (typeof mnExecView === 'string' && mnExecView.trim() && !isForbiddenOneLiner(mnExecView)) {
    return mnExecView.length > 120 ? mnExecView.slice(0, 120) + '...' : mnExecView;
  }
  return '';
}

// ═══════════════════════════════════════════════════
// Important Observations
// ═══════════════════════════════════════════════════

function computeImportantObservations(
  keyObservations: Record<string, unknown>[],
  reasoningChain: Record<string, unknown>[],
  freeSummary: Record<string, unknown> | null,
  socialPost: Record<string, unknown> | null,
): { title: string; content: string }[] {
  if (keyObservations.length >= 3) {
    return keyObservations.slice(0, 5).map((k) => ({
      title: (k.title as string) || '觀察重點',
      content: (k.content as string) || (k.category as string) || '',
    }));
  }
  if (reasoningChain.length >= 3) {
    return reasoningChain.slice(0, 5).map((r) => ({
      title: (r.step as string) || '推理步驟',
      content: `${r.evidence ? (r.evidence as string) + ' → ' : ''}${r.inference || ''}`,
    }));
  }
  if (freeSummary?.three_points && Array.isArray(freeSummary.three_points)) {
    const pts = freeSummary.three_points as string[];
    if (pts.length >= 3) {
      return pts.slice(0, 5).map((p, i) => ({ title: `重點 ${i + 1}`, content: p }));
    }
  }
  if (socialPost?.three_points && Array.isArray(socialPost.three_points)) {
    const pts = socialPost.three_points as string[];
    if (pts.length >= 3) {
      return pts.slice(0, 5).map((p, i) => ({ title: `重點 ${i + 1}`, content: p }));
    }
  }
  return [];
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

export function isActualNonTradingDay(): boolean {
  return isTaipeiWeekendToday();
}

export function isReportGeneratedToday(raw: ReportRow | null): boolean {
  if (!raw?.created_at) return false;
  const todayStr = formatTaipeiDate();
  try {
    const d = new Date(raw.created_at);
    if (Number.isNaN(d.getTime())) return false;
    const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const y = tw.getFullYear();
    const m = String(tw.getMonth() + 1).padStart(2, '0');
    const dd = String(tw.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}` === todayStr;
  } catch { return false; }
}

export function isReportHealthy(raw: ReportRow | null, strategy?: Record<string, unknown> | null): boolean {
  if (!raw || !raw.report_date) return false;
  const ai = strategy || raw.ai_strategy_json || {};
  const confidence = Number(
    (ai as Record<string, unknown>).confidence_score || raw.confidence_score || 0,
  );
  const noFakeFallback = (ai as Record<string, unknown>).no_fake_fallback === true || (raw as unknown as Record<string, unknown>).no_fake_fallback === true;
  const fakeFallbackUsed = (ai as Record<string, unknown>).fake_fallback_used === true || (raw as unknown as Record<string, unknown>).fake_fallback_used === true;
  const blocked = ((ai as Record<string, unknown>).content_publish_gate as Record<string, unknown>)?.blocked === true;
  return confidence >= 70 && noFakeFallback && !fakeFallbackUsed && !blocked;
}

export function getSafeReportDate(report: ReportRow | null): string | null {
  if (!report) return null;
  const rd = report.report_date;
  if (rd && rd.trim() !== '' && rd !== ':reportDate' && rd !== 'undefined' && rd !== 'null') return rd;
  const ai = report.ai_strategy_json;
  if (ai) {
    const mdDate = (ai as Record<string, unknown>).market_data_latest_date;
    if (typeof mdDate === 'string' && mdDate.trim() !== '' && mdDate !== ':reportDate') return mdDate.trim();
    const gfd = (ai as Record<string, unknown>).generated_for_date;
    if (typeof gfd === 'string' && gfd.trim() !== '' && gfd !== ':reportDate') return gfd.trim();
  }
  return null;
}
