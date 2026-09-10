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

import { formatTaipeiDate, isTaipeiWeekendToday } from '@/utils/tradingDay';
import { callGetReportPayload } from '@/services/entitlementService';
import type { ServerReportPayloadResponse } from '@/types/subscription';
import { getSubscriberReportProjection, type SubscriberReportProjection } from '@/lib/subscriberReportProjection';

// ═══════════════════════════════════════════════════
// Raw Supabase Row Type
// ═══════════════════════════════════════════════════

export interface ReportRow {
  id: string;
  report_date: string;
  revision_id?: string | null;
  generated_at?: string | null;
  today_date?: string | null;
  data_as_of?: string | null;
  subscriber_state?: unknown;
  canonical_decision?: Record<string, unknown> | null;
  content_publish_gate?: Record<string, unknown> | null;
  market_report_gate?: Record<string, unknown> | null;
  recommendation_gate?: Record<string, unknown> | null;
  report_status?: string | null;
  is_trading_day?: boolean | null;
  closing_verification_v2?: Record<string, unknown> | null;
  closing_verification?: Record<string, unknown> | null;
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
  /** Subscriber presentation authority; rawReport/strategy below are internal data only. */
  subscriberProjection: SubscriberReportProjection;
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

  dashboardStatus: { level: 'success' | 'info' | 'warning' | 'error'; label: string; message: string };
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

function payloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstPayloadString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function mapServerPayloadToReportRow(response: ServerReportPayloadResponse): ReportRow | null {
  const payload = payloadRecord(response.payload);
  if (!payload || !response.report_date) return null;
  const projection = getSubscriberReportProjection(response);
  const generatedAt = projection.identity.generatedAt ?? '';
  return {
    id: projection.identity.revisionId ?? firstPayloadString(payload.id),
    report_date: projection.identity.reportDate,
    revision_id: projection.identity.revisionId,
    generated_at: projection.identity.generatedAt,
    today_date: projection.identity.todayDate,
    data_as_of: response.data_as_of ?? (firstPayloadString(payload.data_as_of) || null),
    ...(Object.prototype.hasOwnProperty.call(payload, 'subscriber_state') ? { subscriber_state: payload.subscriber_state } : {}),
    canonical_decision: payloadRecord(payload.canonical_decision),
    content_publish_gate: payloadRecord(payload.content_publish_gate),
    market_report_gate: payloadRecord(payload.market_report_gate),
    recommendation_gate: payloadRecord(payload.recommendation_gate),
    report_status: typeof payload.report_status === 'string' ? payload.report_status : undefined,
    is_trading_day: response.is_trading_day ?? (typeof payload.is_trading_day === 'boolean' ? payload.is_trading_day : null),
    closing_verification_v2: payloadRecord(payload.closing_verification_v2),
    closing_verification: payloadRecord(payload.closing_verification),
    market_bias: projection.marketDecision.bias,
    confidence_score: projection.confidence.value,
    created_at: generatedAt,
    updated_at: firstPayloadString(payload.updated_at) || null,
    ai_strategy_json: payload,
    summary: projection.marketDecision.summary,
    watch_sectors_json: null,
  };
}

export async function fetchLatestReports(limit = 10): Promise<ReportRow[]> {
  if (limit <= 0) return [];
  try {
    const response = await callGetReportPayload();
    const row = mapServerPayloadToReportRow(response);
    return row ? [row] : [];
  } catch (error) {
    console.warn('REPORTS_SERVER_PAYLOAD_UNAVAILABLE', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function fetchLatestSingleReport(): Promise<ReportRow | null> {
  const reports = await fetchLatestReports(1);
  return reports[0] ?? null;
}

export async function fetchBestReport(): Promise<ReportRow | null> {
  const reports = await fetchLatestReports(10);
  if (reports.length === 0) return null;

  // The server selects the canonical business date. An unpublished current
  // report must never be replaced with a more optimistic previous-day report.
  return reports[0];
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

// ═══════════════════════════════════════════════════
// Core Normalization
// ═══════════════════════════════════════════════════

export function normalizeMorningAlphaReport(raw: ReportRow | null): MorningAlphaNormalizedReport {
  const subscriberProjection = getSubscriberReportProjection(raw);
  if (!raw) {
    const todayStr = formatTaipeiDate();
    return {
      subscriberProjection, rawReport: null, strategy: null,
      reportId: '', reportCreatedAt: '', reportDate: todayStr, reportDisplayDate: todayStr,
      marketDataBasisDate: '—', usMarketBasisDate: '—', generatedAt: '',
      aiVersion: '', source: '',
      marketBias: subscriberProjection.marketDecision.label, confidenceScore: null, qualityScore: 0, memberValueScore: 0,
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
      publicPageStatus: { displayLabel: subscriberProjection.statusLabel, displayBias: subscriberProjection.marketDecision.label, displayConfidence: null,
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
  const reportId = subscriberProjection.identity.revisionId ?? raw.id;
  const generatedAt = subscriberProjection.identity.generatedAt ?? '';
  const reportCreatedAt = generatedAt || raw.created_at;
  const reportDate = subscriberProjection.identity.reportDate;
  const reportDisplayDate = subscriberProjection.identity.reportDate;
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
  const marketBias = subscriberProjection.marketDecision.bias ?? subscriberProjection.marketDecision.label;
  const confidenceScore = subscriberProjection.confidence.value;
  const qualityScore = grabNum(ai, 'quality_score');
  const memberValueScore = grabNum(ai, 'member_value_score');

  // ── Quality flags ──
  // V376: Read overall_status in addition to status — Edge Function V7.54.2 writes overall_status
  const rawContentGate = (ai as Record<string, unknown>).content_publish_gate as Record<string, unknown> | undefined;
  const contentGateStatus = grabStr(rawContentGate || null, 'overall_status') || grabStr(rawContentGate || null, 'status');
  const publishReady = subscriberProjection.analysisAvailable;
  const noFakeFallback = grabBool(ai, 'no_fake_fallback');
  const fakeFallbackUsed = grabBool(ai, 'fake_fallback_used');
  const dataDateAligned = grabBool(ai, 'data_date_aligned');

  // ── Computed gates ──
  const canPublish = subscriberProjection.analysisAvailable;
  const qualityPass = qualityScore >= 75;
  const memberValuePass = memberValueScore >= 80;

  // ── Structured data ──
  const freeSummary = canPublish ? {
    ...(grabObj(ai, 'free_summary') || grabObj(ai, 'public_summary') || {}),
    market_bias: marketBias,
    confidence_score: confidenceScore,
    daily_sentence: subscriberProjection.marketDecision.summary,
  } : null;
  const memberNote = canPublish ? grabObj(ai, 'member_research_note') : null;
  const reasoningChain = canPublish ? grabArr(ai, 'reasoning_chain') : [];
  const overnightImpactChain = canPublish ? grabArr(ai, 'overnight_impact_chain') : [];
  const intradayPlan = canPublish ? grabObj(ai, 'intraday_validation_plan') : null;
  const invalidationConditions = (canPublish ? grabArr(ai, 'invalidation_conditions') : []).filter(
    (inv) => typeof inv.condition === 'string' && inv.condition.trim().length > 0,
  );
  const closingPlan = canPublish ? grabObj(ai, 'closing_feedback_plan') : null;
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
  const oneSentence = subscriberProjection.marketDecision.summary ?? subscriberProjection.statusLabel;

  // ── Important observations ──
  const importantObservations = canPublish ? computeImportantObservations(
    memberNoteKeyObservations, reasoningChain, freeSummary, socialPost,
  ) : [];

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
    displayLabel: subscriberProjection.statusLabel,
    displayBias: marketBias,
    displayConfidence: subscriberProjection.confidence.value,
    sourceStatusText: subscriberProjection.analysisAvailable ? '市場證據已通過發布檢查' : subscriberProjection.statusLabel,
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
    subscriberProjection, rawReport: raw, strategy,
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
  return getSubscriberReportProjection({ ...raw, ai_strategy_json: strategy ?? raw.ai_strategy_json }).analysisAvailable;
}

export function getSafeReportDate(report: ReportRow | null): string | null {
  return getSubscriberReportProjection(report).identity.reportDate || null;
}
