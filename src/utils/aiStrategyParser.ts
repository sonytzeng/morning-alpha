/**
 * aiStrategyParser — Unified ai_strategy_json parser for all frontend pages.
 *
 * This is the SINGLE SOURCE OF TRUTH for reading ai_strategy_json data.
 * Every page/hook/component that displays report content MUST use this parser.
 *
 * Rules:
 * - ai_strategy_json is the PRIMARY data source
 * - report.market_bias / report.confidence_score are ONLY fallback/status bar values
 * - Never display root fields as main content if ai_strategy_json has the data
 */

import type { Report } from '@/types/report';
import { isTaipeiWeekendToday, formatTaipeiDate } from '@/utils/tradingDay';

// ═══════════════════════════════════════════════════
// Type definitions for parsed ai_strategy_json
// ═══════════════════════════════════════════════════

export interface FreeSummary {
  today_status: string;
  one_sentence: string;
  market_bias: string;
  confidence_score: number;
  do_not_do: string;
  mindset: string;
  cta_hint: string;
}

export interface ExecutiveBrief {
  one_line: string;
  why_today_matters: string;
  main_risk: string;
  what_member_should_watch_first: string;
}

export interface EvidenceItem {
  signal: string;
  observation: string;
  interpretation: string;
  supports: string;
  confidence_impact: string;
}

export interface OvernightChain {
  catalyst: string;
  affected_sectors: string[];
  taiwan_market_impact: string;
  representative_stocks: RepresentativeStock[];
  intraday_watch_points: string[];
  invalidation_condition: string;
}

export interface RepresentativeStock {
  name: string;
  role: string;
  reason: string;
  what_to_confirm: string;
}

export interface DontDoItem {
  mistake: string;
  why_it_is_dangerous: string;
  better_action: string;
}

export interface CoreWatchItem {
  name: string;
  reason: string;
  signal: string;
  strong_condition: string;
  weak_condition: string;
}

export interface TimelineEntry {
  time: string;
  question: string;
  what_to_watch: string;
  interpretation: string;
  if_confirmed: string;
  if_failed: string;
}

export interface InvalidationItem {
  condition: string;
  meaning: string;
  required_adjustment: string;
  why_member_should_care: string;
}

export interface MemberSection {
  key: string;
  title: string;
  conclusion: string;
  reasoning: string;
  market_context?: string;
  what_changed_from_previous_session?: string;
  supporting_signals?: string[];
  confirmation_conditions?: string[];
  risk_note?: string;
  evidence_items?: EvidenceItem[];
  chains?: OvernightChain[];
  items?: DontDoItem[] | InvalidationItem[];
  core_watch?: CoreWatchItem[];
  secondary_watch?: unknown[];
  risk_watch?: unknown[];
  timeline?: TimelineEntry[];
  premarket_assumption?: string;
  close_result?: string;
  verification_result?: string;
  what_was_right?: string;
  what_was_conservative_or_wrong?: string;
  tomorrow_adjustment?: string;
  recent_review_summary?: string;
  adjustment_today?: string;
  signals_to_confirm?: string[];
  risk_if_repeated?: string;
  data_points?: string[];
  market_mechanism?: string;
  intraday_confirmation?: string[];
  invalidation_conditions?: string[];
  member_takeaway: string;
}

export interface MemberResearchNote {
  title: string;
  generated_for_date: string;
  is_trading_day: boolean;
  data_basis: string;
  latest_trading_date: string;
  executive_brief: ExecutiveBrief;
  sections: MemberSection[];
  key_observations?: KeyObservation[];
  /** V7.53 flat fields — when backend produces flat structure instead of sections array */
  executive_view?: string;
  main_thesis?: string;
  risk_notes?: string;
  /** Overall member note raw object for flat-field access */
  _raw: Record<string, unknown> | null;
}

export interface KeyObservation {
  title: string;
  content: string;
  category?: string;
}

export interface ReelsScript {
  hook_0_5_sec: string;
  core_5_25_sec: string;
  risk_25_40_sec: string;
  watch_40_55_sec: string;
  cta_55_60_sec: string;
  full_script: string;
}

export interface SocialPost {
  title: string;
  three_points: string[];
  risk_reminder: string;
  cta: string;
  full_post: string;
}

export interface LinePushCopy {
  title: string;
  market_bias: string;
  confidence: string;
  one_sentence: string;
  do_not_do: string;
  watch_point: string;
  cta: string;
}

export interface ReasoningChainStep {
  step: string;
  evidence: string;
  inference: string;
  confidence: number;
}

export interface IntradayValidationPlan {
  open_0900_0930: string;
  mid_session_1000_1130: string;
  afternoon_1300_1330: string;
  fail_signals: string[];
}

export interface ClosingFeedbackPlan {
  what_to_check_after_close: string;
  how_to_score_today: string;
  what_to_adjust_tomorrow: string;
}

export interface MemberResearchNoteV2 {
  opening_thesis?: Record<string, unknown>;
  core_reasoning?: string[];
  first_beneficiary_stock?: Record<string, unknown> | null;
  risk_scenarios?: Record<string, unknown>[];
  capital_rotation_scenarios?: Record<string, unknown>[];
  tomorrow_follow_up?: Record<string, unknown>;
  closing_feedback_placeholder?: Record<string, unknown>;
  intraday_time_windows?: Record<string, unknown>[];
  overnight_chain?: Array<{
    event?: string;
    source_market?: string;
    impact_logic?: string;
    taiwan_mapping?: string;
    confidence?: number;
  }>;
  taiwan_impact_map?: Array<{
    sector?: string;
    why_it_matters?: string;
    affected_stocks?: string[];
    sensitivity?: string;
    invalidation?: string;
  }>;
  beneficiary_candidates?: Array<{
    stock_code?: string;
    stock_name?: string;
    sector?: string;
    reason?: string;
    evidence?: string[];
    risk?: string;
    confidence?: number;
  }>;
  intraday_validation?: Array<{
    time_window?: string;
    what_to_watch?: string;
    bullish_confirm?: string;
    bearish_fail?: string;
    neutral_condition?: string;
  }>;
  invalidation_conditions?: Array<{
    condition?: string;
    meaning?: string;
    action_note?: string;
  }>;
  invalidation_rules?: Array<{
    condition?: string;
    meaning?: string;
    action_note?: string;
  }>;
  closing_feedback_plan?: {
    what_to_compare?: string;
    success_criteria?: string;
    miss_reason_tracking?: string;
  };
  subscriber_value_sentence?: string;
  data_status?: 'complete' | 'partial' | 'insufficient';
}

export interface V8Beneficiary {
  symbol: string;
  name: string;
  sector: string;
  reason_chain: string[];
  confidence_score: number;
  risk_level: 'low' | 'medium' | 'high';
  invalidation_condition: string;
}

export interface V8BeneficiaryChain {
  status: 'ready' | 'insufficient';
  source_signals: unknown[];
  beneficiaries: V8Beneficiary[];
}

export interface V8OvernightChainItem {
  theme: string;
  event: string;
  causal_steps: string[];
  taiwan_impact: '偏多' | '偏空' | '中性' | '觀察';
  affected_sectors: string[];
  watch_points: string[];
  invalidation_condition: string;
}

export interface V8OvernightCausalChain {
  status: 'ready' | 'insufficient';
  chains: V8OvernightChainItem[];
}

export interface V8DailySentence {
  status: 'ready' | 'insufficient';
  sentence: string;
  logic_source: string[];
  tone: 'clear, sharp, human-readable';
}

export interface RenewalValueBlock {
  why_member_should_read_today: string;
  what_free_news_does_not_provide: string;
  tomorrow_followup_hook: string;
}

export interface PremiumValueSummary {
  why_member_would_pay: string;
  free_vs_member_gap: string;
  daily_return_reason: string;
  strongest_member_value_today: string;
  retention_hook: string;
}

export interface ContentPublishGateData {
  overall_status: string;
  blocking_issues: string[];
}

export interface ParsedAIStrategy {
  // Raw JSON
  raw: Record<string, unknown> | null;

  // Version & source
  ai_version: string;
  source: string;

  // Quality flags
  quality_score: number;
  member_value_score: number;
  no_fake_fallback: boolean;
  fake_fallback_used: boolean;
  data_date_aligned: boolean;
  publish_ready: boolean;
  is_template_like: boolean;

  // Gate check (computed)
  canShowMemberContent: boolean;

  // Data info
  market_data_latest_date: string;

  // Free summary
  free_summary: FreeSummary | null;

  // Member research note (9 sections)
  member_research_note: string | MemberResearchNote | null;
  member_research_note_v2: MemberResearchNoteV2 | null;
  closing_verification_v2: Record<string, unknown> | null;

  // V8 JSON contract
  v8_beneficiary_chain: V8BeneficiaryChain;
  v8_overnight_causal_chain: V8OvernightCausalChain;
  v8_daily_sentence: V8DailySentence;

  // Key observations (for "三件重要的事")
  key_observations: KeyObservation[];

  // Reasoning chain
  reasoning_chain: ReasoningChainStep[];

  // Overnight impact chain
  overnight_impact_chain: OvernightChain[];

  // Intraday validation plan
  intraday_validation_plan: IntradayValidationPlan | null;

  // Invalidation conditions
  invalidation_conditions: InvalidationItem[];

  // Closing feedback plan
  closing_feedback_plan: ClosingFeedbackPlan | null;

  // Renewal value
  renewal_value_block: RenewalValueBlock | null;

  // Premium value summary
  premium_value_summary: PremiumValueSummary | null;

  // Content quality flags
  content_quality_flags: Record<string, unknown> | null;

  // Content publish gate
  content_publish_gate: ContentPublishGateData | null;

  // Media content
  reels_script: ReelsScript | null;
  social_post: SocialPost | null;
  line_push_copy: LinePushCopy | null;
}

// ═══════════════════════════════════════════════════
// Helpers
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

function grabNum(obj: unknown, key: string, fallback?: number): number {
  if (!obj || typeof obj !== 'object') return fallback ?? 0;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') { const n = Number(v); if (!Number.isNaN(n)) return n; }
  return fallback ?? 0;
}

function grabBool(obj: unknown, key: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  if (v === true || v === 'true') return true;
  return false;
}

function grabObj(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  // Edge Function sometimes writes nested objects as JSON-encoded strings inside the JSONB column.
  // Parse it here transparently so frontend pages don't need to know about the storage format.
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* not valid JSON string — treat as absent */ }
  }
  return null;
}

/**
 * Grab a value that can be either a plain text string or a structured object.
 * Unlike grabObj, this does NOT attempt JSON.parse — pure text strings are returned as-is.
 * Used for member_research_note and its fallback fields.
 */
function grabStringOrObj(obj: unknown, key: string): string | Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  if (!v) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  // Pure text string — return directly, do NOT JSON.parse
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

function grabArr<T>(obj: unknown, key: string): T[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  return Array.isArray(o[key]) ? (o[key] as T[]) : [];
}

function optionalStr(obj: unknown, key: string): string | undefined {
  const value = grabStr(obj, key);
  return value || undefined;
}

function optionalNum(obj: unknown, key: string): number | undefined {
  const value = grabNum(obj, key, Number.NaN);
  return Number.isNaN(value) ? undefined : value;
}

function nonEmptyStrings(values: unknown[]): string[] | undefined {
  const result = values.map(String).map((v) => v.trim()).filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function clampScore(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseV8Status(value: unknown): 'ready' | 'insufficient' {
  return value === 'ready' ? 'ready' : 'insufficient';
}

function parseRiskLevel(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
}

function parseTaiwanImpact(value: unknown): '偏多' | '偏空' | '中性' | '觀察' {
  if (value === '偏多' || value === '偏空' || value === '中性' || value === '觀察') return value;
  return '觀察';
}

export function emptyV8BeneficiaryChain(): V8BeneficiaryChain {
  return { status: 'insufficient', source_signals: [], beneficiaries: [] };
}

export function emptyV8OvernightCausalChain(): V8OvernightCausalChain {
  return { status: 'insufficient', chains: [] };
}

export function emptyV8DailySentence(): V8DailySentence {
  return { status: 'insufficient', sentence: '', logic_source: [], tone: 'clear, sharp, human-readable' };
}

function parseV8BeneficiaryChain(raw: unknown): V8BeneficiaryChain {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyV8BeneficiaryChain();
  const obj = raw as Record<string, unknown>;
  const beneficiaries = Array.isArray(obj.beneficiaries)
    ? (obj.beneficiaries as unknown[]).map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return {
        symbol: grabStr(row, 'symbol'),
        name: grabStr(row, 'name'),
        sector: grabStr(row, 'sector'),
        reason_chain: grabArr<unknown>(row, 'reason_chain').map(String).map((v) => v.trim()).filter(Boolean),
        confidence_score: clampScore(row.confidence_score, 0),
        risk_level: parseRiskLevel(row.risk_level),
        invalidation_condition: grabStr(row, 'invalidation_condition'),
      };
    }).filter((item) => item.symbol && item.name && item.reason_chain.length > 0)
    : [];

  return {
    status: parseV8Status(obj.status),
    source_signals: Array.isArray(obj.source_signals) ? obj.source_signals : [],
    beneficiaries,
  };
}

function parseV8OvernightCausalChain(raw: unknown): V8OvernightCausalChain {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyV8OvernightCausalChain();
  const obj = raw as Record<string, unknown>;
  const chains = Array.isArray(obj.chains)
    ? (obj.chains as unknown[]).map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return {
        theme: grabStr(row, 'theme'),
        event: grabStr(row, 'event'),
        causal_steps: grabArr<unknown>(row, 'causal_steps').map(String).map((v) => v.trim()).filter(Boolean),
        taiwan_impact: parseTaiwanImpact(row.taiwan_impact),
        affected_sectors: grabArr<unknown>(row, 'affected_sectors').map(String).map((v) => v.trim()).filter(Boolean),
        watch_points: grabArr<unknown>(row, 'watch_points').map(String).map((v) => v.trim()).filter(Boolean),
        invalidation_condition: grabStr(row, 'invalidation_condition'),
      };
    }).filter((item) => item.event && item.causal_steps.length > 0)
    : [];

  return {
    status: parseV8Status(obj.status),
    chains,
  };
}

function parseV8DailySentence(raw: unknown): V8DailySentence {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyV8DailySentence();
  const obj = raw as Record<string, unknown>;
  return {
    status: parseV8Status(obj.status),
    sentence: grabStr(obj, 'sentence'),
    logic_source: grabArr<unknown>(obj, 'logic_source').map(String).map((v) => v.trim()).filter(Boolean),
    tone: 'clear, sharp, human-readable',
  };
}

// ═══════════════════════════════════════════════════
// Main Parser
// ═══════════════════════════════════════════════════

export function parseAIStrategy(report: Report | null): ParsedAIStrategy {
  const raw = (report as Record<string, unknown> | null)?.ai_strategy_json as Record<string, unknown> | null;
  const ai = raw || {};

  // ── Version & Source ──
  const aiVersion = grabStr(ai, 'version', 'ai_version');
  const source = grabStr(ai, 'source');

  // ── Quality Flags ──
  const qualityScore = grabNum(ai, 'quality_score', 0);
  const memberValueScore = grabNum(ai, 'member_value_score', 0);
  const noFakeFallback = grabBool(ai, 'no_fake_fallback');
  const fakeFallbackUsed = grabBool(ai, 'fake_fallback_used');
  const dataDateAligned = grabBool(ai, 'data_date_aligned');
  const publishReady = grabBool(ai, 'publish_ready');
  const isTemplateLike = grabBool(ai, 'is_template_like');

  // ── Data date ──
  const marketDataLatestDate = grabStr(ai, 'market_data_latest_date', 'generated_for_date');

  // ── Free Summary ──
  const fsRaw = grabObj(ai, 'free_summary');
  const freeSummary: FreeSummary | null = fsRaw ? {
    today_status: grabStr(fsRaw, 'today_status'),
    one_sentence: grabStr(fsRaw, 'one_sentence'),
    market_bias: grabStr(fsRaw, 'market_bias'),
    confidence_score: grabNum(fsRaw, 'confidence_score', 0),
    do_not_do: grabStr(fsRaw, 'do_not_do'),
    mindset: grabStr(fsRaw, 'mindset'),
    cta_hint: grabStr(fsRaw, 'cta_hint'),
  } : null;

  // ── Member Research Note ──
  // V399: Fallback chain: member_research_note → complete_research_note → full_research_note → research_note
  // Supports both plain-text strings and structured JSON objects (no JSON.parse on strings).
  const mrnRaw = grabStringOrObj(ai, 'member_research_note')
    || grabStringOrObj(ai, 'complete_research_note')
    || grabStringOrObj(ai, 'full_research_note')
    || grabStringOrObj(ai, 'research_note');

  let memberResearchNote: string | MemberResearchNote | null = null;

  if (mrnRaw) {
    // Plain text string → store directly, no JSON.parse
    if (typeof mrnRaw === 'string') {
      memberResearchNote = mrnRaw;
    } else {
    const ebRaw = grabObj(mrnRaw, 'executive_brief');
    const sectionsRaw = grabArr<Record<string, unknown>>(mrnRaw, 'sections');

    const sections: MemberSection[] = sectionsRaw.map((s) => ({
      key: grabStr(s, 'key'),
      title: grabStr(s, 'title'),
      conclusion: grabStr(s, 'conclusion'),
      reasoning: grabStr(s, 'reasoning'),
      market_context: grabStr(s, 'market_context'),
      what_changed_from_previous_session: grabStr(s, 'what_changed_from_previous_session'),
      supporting_signals: grabArr<string>(s, 'supporting_signals'),
      confirmation_conditions: grabArr<string>(s, 'confirmation_conditions'),
      risk_note: grabStr(s, 'risk_note'),
      evidence_items: grabArr<EvidenceItem>(s, 'evidence_items'),
      chains: grabArr<OvernightChain>(s, 'chains'),
      items: grabArr<DontDoItem | InvalidationItem>(s, 'items'),
      core_watch: grabArr<CoreWatchItem>(s, 'core_watch'),
      secondary_watch: grabArr<unknown>(s, 'secondary_watch'),
      risk_watch: grabArr<unknown>(s, 'risk_watch'),
      timeline: grabArr<TimelineEntry>(s, 'timeline'),
      premarket_assumption: grabStr(s, 'premarket_assumption'),
      close_result: grabStr(s, 'close_result'),
      verification_result: grabStr(s, 'verification_result'),
      what_was_right: grabStr(s, 'what_was_right'),
      what_was_conservative_or_wrong: grabStr(s, 'what_was_conservative_or_wrong'),
      tomorrow_adjustment: grabStr(s, 'tomorrow_adjustment'),
      recent_review_summary: grabStr(s, 'recent_review_summary'),
      adjustment_today: grabStr(s, 'adjustment_today'),
      signals_to_confirm: grabArr<string>(s, 'signals_to_confirm'),
      risk_if_repeated: grabStr(s, 'risk_if_repeated'),
      data_points: grabArr<string>(s, 'data_points'),
      market_mechanism: grabStr(s, 'market_mechanism'),
      intraday_confirmation: grabArr<string>(s, 'intraday_confirmation'),
      invalidation_conditions: grabArr<string>(s, 'invalidation_conditions'),
      member_takeaway: grabStr(s, 'member_takeaway'),
    }));

    // Key observations
    const keyObsRaw = grabArr<Record<string, unknown>>(mrnRaw, 'key_observations');
    const keyObs: KeyObservation[] = keyObsRaw.map((k) => ({
      title: grabStr(k, 'title'),
      content: grabStr(k, 'content'),
      category: grabStr(k, 'category'),
    }));

    memberResearchNote = {
      title: grabStr(mrnRaw, 'title'),
      generated_for_date: grabStr(mrnRaw, 'generated_for_date'),
      is_trading_day: grabBool(mrnRaw, 'is_trading_day'),
      data_basis: grabStr(mrnRaw, 'data_basis'),
      latest_trading_date: grabStr(mrnRaw, 'latest_trading_date'),
      executive_brief: {
        one_line: grabStr(ebRaw || {}, 'one_line'),
        why_today_matters: grabStr(ebRaw || {}, 'why_today_matters'),
        main_risk: grabStr(ebRaw || {}, 'main_risk'),
        what_member_should_watch_first: grabStr(ebRaw || {}, 'what_member_should_watch_first'),
      },
      sections,
      key_observations: keyObs,
      // V7.53 flat fields
      executive_view: grabStr(mrnRaw, 'executive_view'),
      main_thesis: grabStr(mrnRaw, 'main_thesis'),
      risk_notes: grabStr(mrnRaw, 'risk_notes'),
      _raw: mrnRaw,
    };
    } // end else (structured object)
  }

  // ── Member Research Note V2 ──
  const mrnV2Raw = grabObj(ai, 'member_research_note_v2');
  const memberResearchNoteV2: MemberResearchNoteV2 | null = mrnV2Raw ? {
    ...mrnV2Raw,
    opening_thesis: grabObj(mrnV2Raw, 'opening_thesis') || undefined,
    core_reasoning: nonEmptyStrings(grabArr<unknown>(mrnV2Raw, 'core_reasoning')),
    first_beneficiary_stock: grabObj(mrnV2Raw, 'first_beneficiary_stock') || null,
    risk_scenarios: grabArr<Record<string, unknown>>(mrnV2Raw, 'risk_scenarios'),
    capital_rotation_scenarios: grabArr<Record<string, unknown>>(mrnV2Raw, 'capital_rotation_scenarios'),
    tomorrow_follow_up: grabObj(mrnV2Raw, 'tomorrow_follow_up') || undefined,
    closing_feedback_placeholder: grabObj(mrnV2Raw, 'closing_feedback_placeholder') || undefined,
    intraday_time_windows: grabArr<Record<string, unknown>>(mrnV2Raw, 'intraday_time_windows'),
    overnight_chain: grabArr<Record<string, unknown>>(mrnV2Raw, 'overnight_chain').map((item) => ({
      event: optionalStr(item, 'event'),
      source_market: optionalStr(item, 'source_market'),
      impact_logic: optionalStr(item, 'impact_logic'),
      taiwan_mapping: optionalStr(item, 'taiwan_mapping'),
      confidence: optionalNum(item, 'confidence'),
    })),
    taiwan_impact_map: grabArr<Record<string, unknown>>(mrnV2Raw, 'taiwan_impact_map').map((item) => ({
      sector: optionalStr(item, 'sector'),
      why_it_matters: optionalStr(item, 'why_it_matters'),
      affected_stocks: nonEmptyStrings(grabArr<unknown>(item, 'affected_stocks')),
      sensitivity: optionalStr(item, 'sensitivity'),
      invalidation: optionalStr(item, 'invalidation'),
    })),
    beneficiary_candidates: grabArr<Record<string, unknown>>(mrnV2Raw, 'beneficiary_candidates').map((item) => ({
      stock_code: optionalStr(item, 'stock_code'),
      stock_name: optionalStr(item, 'stock_name'),
      sector: optionalStr(item, 'sector'),
      reason: optionalStr(item, 'reason'),
      evidence: nonEmptyStrings(grabArr<unknown>(item, 'evidence')),
      risk: optionalStr(item, 'risk'),
      confidence: optionalNum(item, 'confidence'),
    })),
    intraday_validation: grabArr<Record<string, unknown>>(mrnV2Raw, 'intraday_validation').map((item) => ({
      time_window: optionalStr(item, 'time_window'),
      what_to_watch: optionalStr(item, 'what_to_watch'),
      bullish_confirm: optionalStr(item, 'bullish_confirm'),
      bearish_fail: optionalStr(item, 'bearish_fail'),
      neutral_condition: optionalStr(item, 'neutral_condition'),
    })),
    invalidation_conditions: grabArr<Record<string, unknown>>(mrnV2Raw, 'invalidation_conditions').map((item) => ({
      condition: optionalStr(item, 'condition'),
      meaning: optionalStr(item, 'meaning'),
      action_note: optionalStr(item, 'action_note'),
    })),
    invalidation_rules: [
      ...grabArr<Record<string, unknown>>(mrnV2Raw, 'invalidation_rules'),
      ...grabArr<Record<string, unknown>>(mrnV2Raw, 'invalidation_conditions'),
    ].map((item) => ({
      condition: optionalStr(item, 'condition'),
      meaning: optionalStr(item, 'meaning'),
      action_note: optionalStr(item, 'action_note'),
    })),
    closing_feedback_plan: (() => {
      const rawPlan = grabObj(mrnV2Raw, 'closing_feedback_plan');
      if (!rawPlan) return undefined;
      return {
        what_to_compare: optionalStr(rawPlan, 'what_to_compare'),
        success_criteria: optionalStr(rawPlan, 'success_criteria'),
        miss_reason_tracking: optionalStr(rawPlan, 'miss_reason_tracking'),
      };
    })(),
    subscriber_value_sentence: optionalStr(mrnV2Raw, 'subscriber_value_sentence'),
    data_status: ['complete', 'partial', 'insufficient'].includes(grabStr(mrnV2Raw, 'data_status'))
      ? grabStr(mrnV2Raw, 'data_status') as MemberResearchNoteV2['data_status']
      : undefined,
  } : null;

  // ── V8 JSON contract ──
  const v8BeneficiaryChain = parseV8BeneficiaryChain(ai.v8_beneficiary_chain);
  const v8OvernightCausalChain = parseV8OvernightCausalChain(ai.v8_overnight_causal_chain);
  const v8DailySentence = parseV8DailySentence(ai.v8_daily_sentence);
  const closingVerificationV2 = grabObj(ai, 'closing_verification_v2');

  // ── Key observations (from ai_strategy_json directly) ──
  const keyObsFromAI = grabArr<Record<string, unknown>>(ai, 'key_observations');
  const keyObservations: KeyObservation[] = keyObsFromAI.map((k) => ({
    title: grabStr(k, 'title'),
    content: grabStr(k, 'content'),
    category: grabStr(k, 'category'),
  }));

  // ── Reasoning chain ──
  const reasoningRaw = grabArr<Record<string, unknown>>(ai, 'reasoning_chain');
  const reasoningChain: ReasoningChainStep[] = reasoningRaw.map((r) => ({
    step: grabStr(r, 'step'),
    evidence: grabStr(r, 'evidence'),
    inference: grabStr(r, 'inference'),
    confidence: grabNum(r, 'confidence', 0),
  }));

  // ── Overnight impact chain ──
  const ocRaw = grabArr<Record<string, unknown>>(ai, 'overnight_impact_chain');
  const overnightImpactChain: OvernightChain[] = ocRaw.map((c) => ({
    catalyst: grabStr(c, 'catalyst'),
    affected_sectors: grabArr<string>(c, 'affected_sectors'),
    taiwan_market_impact: grabStr(c, 'taiwan_market_impact', 'taiwan_link'),
    representative_stocks: grabArr<Record<string, unknown>>(c, 'representative_stocks').map((rs) => ({
      name: grabStr(rs, 'name'),
      role: grabStr(rs, 'role'),
      reason: grabStr(rs, 'reason'),
      what_to_confirm: grabStr(rs, 'what_to_confirm'),
    })),
    intraday_watch_points: grabArr<string>(c, 'intraday_watch_points'),
    invalidation_condition: grabStr(c, 'invalidation_condition'),
  }));

  // ── Intraday validation plan ──
  const ivpRaw = grabObj(ai, 'intraday_validation_plan');
  const intradayValidationPlan: IntradayValidationPlan | null = ivpRaw ? {
    open_0900_0930: grabStr(ivpRaw, 'open_0900_0930'),
    mid_session_1000_1130: grabStr(ivpRaw, 'mid_session_1000_1130'),
    afternoon_1300_1330: grabStr(ivpRaw, 'afternoon_1300_1330'),
    fail_signals: grabArr<string>(ivpRaw, 'fail_signals'),
  } : null;

  // ── Invalidation conditions ──
  const invRaw = grabArr<Record<string, unknown>>(ai, 'invalidation_conditions');
  const invalidationConditions: InvalidationItem[] = invRaw.map((i) => ({
    condition: grabStr(i, 'condition'),
    meaning: grabStr(i, 'meaning'),
    required_adjustment: grabStr(i, 'required_adjustment'),
    why_member_should_care: grabStr(i, 'why_member_should_care'),
  }));

  // ── Closing feedback plan ──
  const cfpRaw = grabObj(ai, 'closing_feedback_plan');
  const closingFeedbackPlan: ClosingFeedbackPlan | null = cfpRaw ? {
    what_to_check_after_close: grabStr(cfpRaw, 'what_to_check_after_close'),
    how_to_score_today: grabStr(cfpRaw, 'how_to_score_today'),
    what_to_adjust_tomorrow: grabStr(cfpRaw, 'what_to_adjust_tomorrow'),
  } : null;

  // ── Renewal value block ──
  const rvbRaw = grabObj(ai, 'renewal_value_block');
  const renewalValueBlock: RenewalValueBlock | null = rvbRaw ? {
    why_member_should_read_today: grabStr(rvbRaw, 'why_member_should_read_today'),
    what_free_news_does_not_provide: grabStr(rvbRaw, 'what_free_news_does_not_provide'),
    tomorrow_followup_hook: grabStr(rvbRaw, 'tomorrow_followup_hook'),
  } : null;

  // ── Premium value summary ──
  const pvsRaw = grabObj(ai, 'premium_value_summary');
  const premiumValueSummary: PremiumValueSummary | null = pvsRaw ? {
    why_member_would_pay: grabStr(pvsRaw, 'why_member_would_pay'),
    free_vs_member_gap: grabStr(pvsRaw, 'free_vs_member_gap'),
    daily_return_reason: grabStr(pvsRaw, 'daily_return_reason'),
    strongest_member_value_today: grabStr(pvsRaw, 'strongest_member_value_today'),
    retention_hook: grabStr(pvsRaw, 'retention_hook'),
  } : null;

  // ── Media ──
  const reelsRaw = grabObj(ai, 'reels_script');
  const reelsScript: ReelsScript | null = reelsRaw ? {
    hook_0_5_sec: grabStr(reelsRaw, 'hook_0_5_sec'),
    core_5_25_sec: grabStr(reelsRaw, 'core_5_25_sec'),
    risk_25_40_sec: grabStr(reelsRaw, 'risk_25_40_sec'),
    watch_40_55_sec: grabStr(reelsRaw, 'watch_40_55_sec'),
    cta_55_60_sec: grabStr(reelsRaw, 'cta_55_60_sec'),
    full_script: grabStr(reelsRaw, 'full_script'),
  } : null;

  const socialRaw = grabObj(ai, 'social_post');
  const socialPost: SocialPost | null = socialRaw ? {
    title: grabStr(socialRaw, 'title'),
    three_points: grabArr<string>(socialRaw, 'three_points'),
    risk_reminder: grabStr(socialRaw, 'risk_reminder'),
    cta: grabStr(socialRaw, 'cta'),
    full_post: grabStr(socialRaw, 'full_post'),
  } : null;

  const lineRaw = grabObj(ai, 'line_push_copy');
  const linePushCopy: LinePushCopy | null = lineRaw ? {
    title: grabStr(lineRaw, 'title'),
    market_bias: grabStr(lineRaw, 'market_bias'),
    confidence: grabStr(lineRaw, 'confidence'),
    one_sentence: grabStr(lineRaw, 'one_sentence'),
    do_not_do: grabStr(lineRaw, 'do_not_do'),
    watch_point: grabStr(lineRaw, 'watch_point'),
    cta: grabStr(lineRaw, 'cta'),
  } : null;

  // ── Content quality flags ──
  const contentQualityFlags = grabObj(ai, 'content_quality_flags');

  // ── Content publish gate ──
  const cpgRaw = grabObj(ai, 'content_publish_gate');
  const contentPublishGate: ContentPublishGateData | null = cpgRaw ? {
    overall_status: grabStr(cpgRaw, 'overall_status'),
    blocking_issues: grabArr<string>(cpgRaw, 'blocking_issues'),
  } : null;

  return {
    raw,
    ai_version: aiVersion,
    source,
    quality_score: qualityScore,
    member_value_score: memberValueScore,
    no_fake_fallback: noFakeFallback,
    fake_fallback_used: fakeFallbackUsed,
    data_date_aligned: dataDateAligned,
    publish_ready: publishReady,
    is_template_like: isTemplateLike,
    canShowMemberContent: hasValidMemberResearchTextValue(memberResearchNote) || hasValidMemberResearchNoteV2Value(memberResearchNoteV2),
    market_data_latest_date: marketDataLatestDate,
    free_summary: freeSummary,
    member_research_note: memberResearchNote,
    member_research_note_v2: memberResearchNoteV2,
    closing_verification_v2: closingVerificationV2,
    v8_beneficiary_chain: v8BeneficiaryChain,
    v8_overnight_causal_chain: v8OvernightCausalChain,
    v8_daily_sentence: v8DailySentence,
    key_observations: keyObservations,
    reasoning_chain: reasoningChain,
    overnight_impact_chain: overnightImpactChain,
    intraday_validation_plan: intradayValidationPlan,
    invalidation_conditions: invalidationConditions,
    closing_feedback_plan: closingFeedbackPlan,
    renewal_value_block: renewalValueBlock,
    premium_value_summary: premiumValueSummary,
    content_quality_flags: contentQualityFlags,
    content_publish_gate: contentPublishGate,
    reels_script: reelsScript,
    social_post: socialPost,
    line_push_copy: linePushCopy,
  };
}

/**
 * Get the best "one sentence" summary for display.
 * Priority: ai_strategy_json.free_summary.one_sentence →
 *           social_post.title →
 *           member_research_note.executive_brief.one_line（前120字）→
 *           fallback
 */
export function getBestOneLiner(strategy: ParsedAIStrategy, report: Report | null, isNonTradingDay: boolean): string {
  // V7.54: Only show non-trading notice on actual weekends
  if (isNonTradingDay) {
    const date = strategy.market_data_latest_date || report?.report_date || '';
    return `最近交易日（${date}）盤前摘要`;
  }

  // 1. free_summary.one_sentence
  if (strategy.free_summary?.one_sentence && !isGenericVague(strategy.free_summary.one_sentence)) {
    return strategy.free_summary.one_sentence;
  }

  // 2. social_post.title
  if (strategy.social_post?.title && strategy.social_post.title.trim().length > 0) {
    return strategy.social_post.title;
  }

  // 3. member_research_note plain text (V399)
  if (typeof strategy.member_research_note === 'string' && strategy.member_research_note.trim().length > 0) {
    const s = strategy.member_research_note;
    return s.length > 120 ? s.slice(0, 120) + '...' : s;
  }

  // 4. member_research_note executive_brief one_line (first 120 chars)
  const mn = strategy.member_research_note as MemberResearchNote | null;
  const oneLine = mn?.executive_brief?.one_line;
  if (oneLine && oneLine.trim().length > 0) {
    return oneLine.length > 120 ? oneLine.slice(0, 120) + '...' : oneLine;
  }

  // 5. member_research_note main_thesis (V7.54)
  const mainThesis = mn?.main_thesis;
  if (mainThesis && mainThesis.trim().length > 0) {
    return mainThesis.length > 120 ? mainThesis.slice(0, 120) + '...' : mainThesis;
  }

  // 5. No useful data — return empty
  return '';
}

/**
 * Get the display bias for the status bar.
 * V8.2 Priority: ai_strategy_json.market_bias →
 *                  ai_strategy_json.free_summary.market_bias →
 *                  report.market_bias
 */
export function getDisplayBias(strategy: ParsedAIStrategy, report: Report | null): string {
  // V8.2: ai.market_bias (top-level) is the PRIMARY source
  const aiBias = grabStr(strategy.raw, 'market_bias');
  if (aiBias) return aiBias;
  if (strategy.free_summary?.market_bias && strategy.free_summary.market_bias.trim().length > 0) {
    return strategy.free_summary.market_bias;
  }
  return report?.market_bias || '觀察中';
}

/**
 * Get the display confidence score.
 * V8.2 Priority: ai_strategy_json.confidence_score →
 *                  ai_strategy_json.free_summary.confidence_score →
 *                  report.confidence_score
 */
export function getDisplayConfidence(strategy: ParsedAIStrategy, report: Report | null): number | null {
  // V8.2: ai.confidence_score (top-level) is the PRIMARY source
  const aiConf = grabNum(strategy.raw, 'confidence_score', -1);
  if (aiConf >= 0) return aiConf;
  if (strategy.free_summary?.confidence_score && strategy.free_summary.confidence_score > 0) {
    return strategy.free_summary.confidence_score;
  }
  return report?.confidence_score ?? null;
}

/**
 * Get the data date for display.
 */
export function getDataDate(strategy: ParsedAIStrategy, report: Report | null): string {
  const mn = strategy.member_research_note;
  const genDate = typeof mn === 'object' && mn ? mn.generated_for_date : '';
  return strategy.market_data_latest_date || genDate || report?.report_date || '—';
}

/**
 * Check if text contains generic vague phrases.
 */
const GENERIC_VAGUE_PATTERNS = [
  '市場情緒持平', '保持觀望', '關注市場變化', '需謹慎', '留意風險',
  '等待更多訊號', '可能受到影響', '影響市場情緒', '投資人應保持謹慎',
  '市場情緒中性震盪', '半導體與 AI 成為焦點', '靈活應對', '等待更多資料確認',
  '關注半導體', '保持靈活', '市場方向：中性震盪', '等待更多市場訊號',
];

const INVALID_MEMBER_NOTE_PATTERNS = [
  '休市',
  '尚未生成',
  '尚未產生',
  '暫無資料',
  '資料不足',
  '等待盤前報告',
  '等待下一次報告',
];

function isGenericVague(text: string): boolean {
  return GENERIC_VAGUE_PATTERNS.some((p) => text.includes(p));
}

function hasAnyObjectText(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    if (typeof item === 'number') return Number.isFinite(item);
    if (Array.isArray(item)) return item.length > 0;
    return false;
  });
}

export function hasValidMemberResearchText(strategy: ParsedAIStrategy): boolean {
  return hasValidMemberResearchTextValue(strategy.member_research_note);
}

function hasValidMemberResearchTextValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < 300) return false;
  if (INVALID_MEMBER_NOTE_PATTERNS.some((pattern) => text.includes(pattern))) return false;
  return true;
}

export function hasValidMemberResearchNoteV2(strategy: ParsedAIStrategy): boolean {
  return hasValidMemberResearchNoteV2Value(strategy.member_research_note_v2);
}

function hasValidMemberResearchNoteV2Value(note: MemberResearchNoteV2 | null): boolean {
  if (!note) return false;

  const nonEmptySections = [
    note.overnight_chain?.some(hasAnyObjectText),
    note.taiwan_impact_map?.some(hasAnyObjectText),
    note.beneficiary_candidates?.some(hasAnyObjectText),
    note.intraday_validation?.some(hasAnyObjectText),
    note.invalidation_rules?.some(hasAnyObjectText),
    note.closing_feedback_plan ? hasAnyObjectText(note.closing_feedback_plan) : false,
  ].filter(Boolean).length;

  return nonEmptySections >= 2;
}

/**
 * Get the source status text for display.
 */
export function getSourceStatusText(strategy: ParsedAIStrategy): string {
  if (strategy.no_fake_fallback && !strategy.fake_fallback_used && strategy.data_date_aligned) {
    return '真實資料 / 無假資料 / 已通過發布檢查';
  }
  if (strategy.no_fake_fallback) {
    return '真實資料 / 無假資料';
  }
  return '資料驗證中';
}

/**
 * Determine if we have key observations to show instead of "三件重要的事".
 */
export function hasRealKeyObservations(strategy: ParsedAIStrategy): boolean {
  return strategy.key_observations.length > 0;
}

/**
 * Get the 3-5 most important things from key_observations or reasoning_chain.
 */
export function getTopItems(strategy: ParsedAIStrategy): { title: string; content: string }[] {
  // Prefer key_observations
  if (strategy.key_observations.length >= 3) {
    return strategy.key_observations.slice(0, 5).map((k) => ({
      title: k.title || '觀察重點',
      content: k.content || k.category || '',
    }));
  }

  // Fallback to reasoning_chain
  if (strategy.reasoning_chain.length >= 3) {
    return strategy.reasoning_chain.slice(0, 5).map((r) => ({
      title: r.step || '推理步驟',
      content: `${r.evidence ? r.evidence + ' → ' : ''}${r.inference || ''}`,
    }));
  }

  return [];
}

/**
 * V7.53: Check if member_research_note has real content (flat or sections-based).
 */
export function hasMemberResearchNote(strategy: ParsedAIStrategy): boolean {
  return hasValidMemberResearchNoteV2(strategy) || hasValidMemberResearchText(strategy);
}

/**
 * V7.53: Count member note sections from flat fields (when sections array is empty).
 */
export function getMemberNoteSectionCount(rawNote: Record<string, unknown> | null): number {
  if (!rawNote) return 0;
  const parts: unknown[] = [
    (rawNote as Record<string, unknown>).title,
    (rawNote as Record<string, unknown>).executive_view,
    (rawNote as Record<string, unknown>).data_basis,
    ...(Array.isArray((rawNote as Record<string, unknown>).key_observations)
      ? (rawNote as Record<string, unknown>).key_observations as unknown[]
      : []),
    (rawNote as Record<string, unknown>).main_thesis,
    (rawNote as Record<string, unknown>).risk_notes,
  ];
  return parts.filter((p) => {
    if (p === null || p === undefined) return false;
    if (typeof p === 'string') return p.trim().length > 0;
    return true;
  }).length;
}

/**
 * V7.53: Get content string for comparison table — from member note main_thesis or executive_view.
 */
export function getMemberCoreThesis(strategy: ParsedAIStrategy): string {
  const mn = strategy.member_research_note;
  if (!mn) return '—';
  // Plain text string
  if (typeof mn === 'string') {
    return mn.length > 120 ? mn.slice(0, 120) + '...' : mn;
  }
  if (mn.main_thesis && mn.main_thesis.trim()) {
    return mn.main_thesis.length > 120 ? mn.main_thesis.slice(0, 120) + '...' : mn.main_thesis;
  }
  if (mn.executive_view && mn.executive_view.trim()) {
    return mn.executive_view.length > 120 ? mn.executive_view.slice(0, 120) + '...' : mn.executive_view;
  }
  return '—';
}

// ═══════════════════════════════════════════════════
// V7.54: Three-Date Concept Helpers
// ═══════════════════════════════════════════════════

/**
 * Get the report DISPLAY date — always today's Taipei date.
 * This is the date shown to users as "this is today's report".
 */
export function getReportDisplayDate(): string {
  return formatTaipeiDate();
}

/**
 * Get the market data BASIS date — the actual date of the underlying market data.
 * May differ from display date for pre-market reports (e.g. Monday uses Friday's data).
 */
export function getMarketDataBasisDate(strategy: ParsedAIStrategy, report: Report | null): string {
  if (strategy.market_data_latest_date && strategy.market_data_latest_date.trim().length > 0) {
    return strategy.market_data_latest_date;
  }
  const mn = strategy.member_research_note;
  if (typeof mn === 'object' && mn?.generated_for_date) {
    return mn.generated_for_date;
  }
  return report?.report_date || '—';
}

/**
 * Returns true ONLY on actual weekends (Sat/Sun) or explicit holiday flag.
 * Does NOT use report.report_date mismatch as a signal.
 *
 * Rule: Monday-Friday are trading days. report.report_date may differ from
 * today's date (e.g. pre-market using last complete trading day data), but
 * that does NOT make it a non-trading day.
 */
export function shouldShowNonTradingDayWarning(): boolean {
  return isTaipeiWeekendToday();
}

/**
 * Check if the report was GENERATED today (based on created_at in Taipei timezone).
 * This is DIFFERENT from checking report_date — a report generated today may use
 * data from the previous trading day.
 */
export function hasTodayGeneratedReport(report: Report | null): boolean {
  if (!report) return false;
  const raw = (report as Record<string, unknown>);
  const createdAt = raw.created_at as string | null;
  if (!createdAt) return false;

  const todayStr = formatTaipeiDate();
  try {
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return false;
    const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const y = tw.getFullYear();
    const m = String(tw.getMonth() + 1).padStart(2, '0');
    const dd = String(tw.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}` === todayStr;
  } catch {
    return false;
  }
}

/**
 * Check if today is a market-closed day based on ai_strategy_json flags.
 * Uses V8.3_TRADING_DAY_GATE fields written by generate-daily-report-v7.
 *
 * Returns { closed: boolean, holidayName: string | null }
 */
export function isMarketClosed(ai: Record<string, unknown> | null): { closed: boolean; holidayName: string | null } {
  if (!ai) return { closed: false, holidayName: null };

  const closed =
    ai.is_trading_day === false ||
    ai.market_closed === true ||
    !!ai.holiday_name ||
    ai.market_bias === '休市';

  return {
    closed,
    holidayName: closed ? ((ai.holiday_name as string) || null) : null,
  };
}
