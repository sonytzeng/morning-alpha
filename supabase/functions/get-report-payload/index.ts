import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveMarketStatus } from "../_shared/market-status.ts";
import { evaluatePremiumContentGate } from "../_shared/premium-content-gate.ts";

type SubscriptionTier = "free" | "member" | "vip" | "admin";

type ReportRow = Record<string, unknown> & {
  id?: string;
  report_date?: string;
  market_bias?: string | null;
  confidence_score?: number | string | null;
  summary?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  ai_strategy_json?: unknown;
};

type ProfileRow = {
  role?: string | null;
  subscription_status?: string | null;
  membership_tier?: string | null;
  paid_until?: string | null;
};

type PayloadContext = {
  openingRadar: Record<string, unknown> | null;
  sectorRotationRows: Record<string, unknown>[];
  marketDataSnapshots: Record<string, unknown>[];
  decisionSnapshot: Record<string, unknown> | null;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

const PUBLIC_LOCKED_SECTIONS = [
  "opportunities_full",
  "member_note_full",
  "war_room_full",
  "vip_fund_flow",
  "vip_accuracy_history",
  "vip_alerts",
];

const MEMBER_LOCKED_SECTIONS = [
  "vip_fund_flow",
  "vip_accuracy_history",
  "vip_alerts",
];

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[] : [];
}

function parseAi(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTier(value: unknown): SubscriptionTier {
  if (value === "member" || value === "vip" || value === "admin") return value;
  return "free";
}

function isPaidUntilValid(value: unknown): boolean {
  const raw = toStringValue(value);
  if (!raw) return true;
  const paidUntil = Date.parse(raw);
  if (!Number.isFinite(paidUntil)) return false;
  return paidUntil > Date.now();
}

function resolveTierFromProfile(profile: ProfileRow | null): SubscriptionTier {
  if (!profile) return "free";

  const roleTier = normalizeTier(toStringValue(profile.role)?.toLowerCase());
  if (roleTier === "admin") return "admin";

  const subscriptionStatus = toStringValue(profile.subscription_status)?.toLowerCase() || "";
  if (subscriptionStatus !== "active") return "free";
  if (!isPaidUntilValid(profile.paid_until)) return "free";

  if (roleTier === "vip" || roleTier === "member") return roleTier;

  const membershipTier = normalizeTier(toStringValue(profile.membership_tier)?.toLowerCase());
  if (membershipTier === "vip" || membershipTier === "member") return membershipTier;
  return "free";
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getAi(report: ReportRow): Record<string, unknown> {
  return parseAi(report.ai_strategy_json);
}

function getImportantNews(report: ReportRow, ai: Record<string, unknown>): Record<string, unknown>[] {
  const reportNews = asArray(report.important_news_json);
  return reportNews.length > 0 ? reportNews : asArray(ai.important_news);
}

function buildPublicNews(newsRows: Record<string, unknown>[]): Record<string, unknown>[] {
  return newsRows.slice(0, 3).map((news) => ({
    title: toStringValue(news.title) || "",
    source: toStringValue(news.source) || "",
    url: toStringValue(news.url),
    published_at: toStringValue(news.published_at) || toStringValue(news.created_at),
    related_sectors: Array.isArray(news.related_sectors) ? news.related_sectors.slice(0, 4) : [],
    taiwan_impact_summary: toStringValue(news.taiwan_impact_summary) || "",
  }));
}

function buildPublicOpeningRadar(value: unknown): Record<string, unknown> {
  const radar = asObject(value);
  return {
    report_date: toStringValue(radar.report_date),
    checkpoint: toStringValue(radar.checkpoint),
    radar_status: toStringValue(radar.radar_status) || toStringValue(radar.status),
    data_status: toStringValue(radar.data_status),
    captured_at: toStringValue(radar.captured_at),
    updated_at: toStringValue(radar.updated_at),
    next_check_time: toStringValue(radar.next_check_time),
  };
}

function getReportDate(report: ReportRow): string {
  return toStringValue(report.report_date) || "";
}

function getMarketBias(report: ReportRow, ai: Record<string, unknown>): string {
  return toStringValue(ai.market_bias) || toStringValue(report.market_bias) || "觀察中";
}

function getConfidenceScore(report: ReportRow, ai: Record<string, unknown>): number | null {
  return toNumberValue(ai.confidence_score) ?? toNumberValue(report.confidence_score);
}

function getConfidenceBand(score: number | null): "high" | "medium" | "low" | "pending" {
  if (score === null) return "pending";
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function getTodayQuote(report: ReportRow, ai: Record<string, unknown>): string {
  const v8Sentence = asObject(ai.v8_daily_sentence);
  const freeSummary = asObject(ai.free_summary);
  return (
    toStringValue(report.today_quote) ||
    toStringValue(v8Sentence.sentence) ||
    toStringValue(ai.daily_sentence) ||
    toStringValue(ai.today_quote) ||
    toStringValue(ai.today_sentence) ||
    toStringValue(freeSummary.daily_sentence) ||
    toStringValue(freeSummary.one_liner) ||
    toStringValue(freeSummary.one_sentence) ||
    toStringValue(freeSummary.summary) ||
    toStringValue(report.summary) ||
    ""
  );
}

function getGeneratedAt(report: ReportRow, ai: Record<string, unknown>): string | null {
  return (
    toStringValue(ai.generated_at) ||
    toStringValue(report.updated_at) ||
    toStringValue(report.created_at) ||
    null
  );
}

function getMarketDate(report: ReportRow, ai: Record<string, unknown>): string | null {
  return (
    toStringValue(ai.market_data_date) ||
    toStringValue(ai.tw_core_date) ||
    toStringValue(ai.market_data_latest_date) ||
    getReportDate(report) ||
    null
  );
}

function toIsoTimestamp(value: unknown): string | null {
  const raw = toStringValue(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function getDataAsOf(ai: Record<string, unknown>, ctx: PayloadContext): string | null {
  const researchMaster = asObject(ai.research_master_v2);
  const openingRadar = ctx.openingRadar || asObject(ai.opening_radar);
  const closingV2 = asObject(ai.closing_verification_v2);
  const closing = asObject(ai.closing_verification);
  const evidenceTimestamps = [
    researchMaster.data_as_of,
    ai.data_as_of,
    openingRadar.captured_at,
    ...ctx.marketDataSnapshots.map((row) => row.captured_at),
    asObject(closingV2.actual_taiex_close).captured_at,
    asObject(closingV2.actual_tsmc_close).captured_at,
    asObject(closingV2.actual_txf_close).captured_at,
    closingV2.verified_at,
    closing.verified_at,
  ]
    .map(toIsoTimestamp)
    .filter((value): value is string => value !== null)
    .sort((a, b) => b.localeCompare(a));

  return evidenceTimestamps[0] || null;
}

function getCanonicalMarketMetadata(
  report: ReportRow,
  ai: Record<string, unknown>,
): { marketStatus: string; isTradingDay: boolean | null; closedReason: string | null } {
  const reportDate = getReportDate(report);
  if (!isValidDate(reportDate)) {
    return {
      marketStatus: toStringValue(ai.market_status) || "unknown",
      isTradingDay: null,
      closedReason: toStringValue(ai.closed_reason) || toStringValue(ai.holiday_name),
    };
  }

  const canonical = resolveMarketStatus(reportDate);
  return {
    marketStatus: canonical.is_trading_day ? "OPEN" : "CLOSED",
    isTradingDay: canonical.is_trading_day,
    closedReason: canonical.closed_reason,
  };
}

function getConfidenceLabel(score: number | null): string {
  if (score === null) return "資料完整度待確認";
  if (score >= 75) return "高把握度";
  if (score >= 55) return "中等把握度";
  if (score > 0) return "偏低";
  return "偏低，請查看缺失來源";
}

function getBeneficiaryArrays(ai: Record<string, unknown>): Record<string, unknown>[][] {
  if (isV10BeneficiaryEnabled(ai)) {
    return [asArray(ai.today_beneficiary_stocks_v10)];
  }
  return [
    asArray(ai.today_beneficiary_stocks),
    asArray(ai.beneficiary_stocks),
    asArray(ai.core_beneficiary_stocks),
  ];
}

function isV10BeneficiaryEnabled(ai: Record<string, unknown>): boolean {
  return ai.v10_beneficiary_enabled === true || toStringValue(ai.v10_beneficiary_enabled) === "true";
}

function getBeneficiaryCount(ai: Record<string, unknown>): number {
  const unique = new Set<string>();
  for (const rows of getBeneficiaryArrays(ai)) {
    for (const row of rows) {
      const symbol = toStringValue(row.symbol) || toStringValue(row.stock_id) || toStringValue(row.stock_code) || "";
      const name = toStringValue(row.stock_name) || toStringValue(row.name) || "";
      const key = symbol || name;
      if (key) unique.add(key);
    }
  }
  return unique.size;
}

function buildTeaserStock(ai: Record<string, unknown>): Record<string, unknown> | null {
  const first = getBeneficiaryArrays(ai).flat().find((row) => toStringValue(row.stock_name) || toStringValue(row.name) || toStringValue(row.symbol));
  if (!first) return null;
  return {
    symbol: toStringValue(first.symbol) || toStringValue(first.stock_id) || toStringValue(first.stock_code) || "",
    name: toStringValue(first.stock_name) || toStringValue(first.name) || toStringValue(first.symbol) || "",
    sector: toStringValue(first.sector) || toStringValue(first.group) || toStringValue(first.category) || "",
  };
}

function buildClosingVerdict(ai: Record<string, unknown>): Record<string, unknown> | null {
  const closingV2 = asObject(ai.closing_verification_v2);
  const closing = Object.keys(closingV2).length > 0 ? closingV2 : asObject(ai.closing_verification);
  if (Object.keys(closing).length === 0) return null;
  return {
    status: toStringValue(closing.status),
    verdict_label: toStringValue(closing.verdict_label) || toStringValue(closing.hit_or_miss),
    prediction_result: toStringValue(closing.prediction_result) || toStringValue(closing.hit_or_miss),
  };
}

function buildClosingSummary(ai: Record<string, unknown>): Record<string, unknown> | null {
  const closingV2 = asObject(ai.closing_verification_v2);
  const closing = Object.keys(closingV2).length > 0 ? closingV2 : asObject(ai.closing_verification);
  if (Object.keys(closing).length === 0) return null;
  const taiexClose = asObject(closing.actual_taiex_close);
  return {
    ...closing,
    status: toStringValue(closing.status),
    verdict_label: toStringValue(closing.verdict_label) || toStringValue(closing.hit_or_miss),
    prediction_result: toStringValue(closing.prediction_result) || toStringValue(closing.hit_or_miss),
    verification_note: toStringValue(closing.verification_note) || toStringValue(closing.what_was_right),
    actual_taiex_change: toNumberValue(closing.actual_taiex_change) ?? toNumberValue(taiexClose.change_percent),
    accuracy_score: toNumberValue(closing.accuracy_score),
    verified_at: toStringValue(closing.verified_at),
  };
}

function buildValidationSignals(ai: Record<string, unknown>): unknown[] {
  const note = asObject(ai.member_research_note_v2);
  const candidates = asArray(note.beneficiary_candidates);
  const candidateSignals = candidates.flatMap((candidate) => [
    candidate.validation_signal,
    candidate.watch_point,
  ]).filter(Boolean);
  const intradayValidation = asArray(note.intraday_validation);
  return [...candidateSignals, ...intradayValidation].filter(Boolean);
}

function buildInvalidationConditions(ai: Record<string, unknown>): unknown[] {
  const note = asObject(ai.member_research_note_v2);
  const candidates = asArray(note.beneficiary_candidates);
  const candidateRisks = candidates.flatMap((candidate) => [
    candidate.invalidation_condition,
    candidate.risk,
    candidate.risk_note,
  ]).filter(Boolean);
  return [
    ...asArray(note.invalidation_conditions),
    ...asArray(note.invalidation_rules),
    ...asArray(ai.invalidation_conditions),
    ...candidateRisks,
  ].filter(Boolean);
}

function buildCanonicalDecision(
  ctx: PayloadContext,
  includePremiumFields: boolean,
): Record<string, unknown> | null {
  const snapshot = ctx.decisionSnapshot;
  if (!snapshot) return null;
  const generatedText = asObject(snapshot.generated_text);
  const base = {
    id: toStringValue(snapshot.id),
    version: toNumberValue(snapshot.version),
    session_type: toStringValue(snapshot.session_type),
    status: toStringValue(snapshot.status),
    action: toStringValue(snapshot.action),
    decision_mode: toStringValue(snapshot.decision_mode),
    market_regime: toStringValue(snapshot.market_regime),
    confidence_score: toNumberValue(snapshot.confidence_score),
    coverage_score: toNumberValue(snapshot.coverage_score),
    content_score: toNumberValue(snapshot.content_score),
    content_grade: toStringValue(snapshot.content_grade),
    daily_sentence: toStringValue(generatedText.daily_sentence),
    reasons: Array.isArray(generatedText.reasons) ? generatedText.reasons.slice(0, 3) : [],
    preferred_sectors: Array.isArray(generatedText.preferred_sectors) ? generatedText.preferred_sectors.slice(0, 3) : [],
    do_not_do: toStringValue(generatedText.do_not_do),
    next_checkpoint: toStringValue(generatedText.next_checkpoint),
    valid_from: toStringValue(snapshot.valid_from),
  };
  if (!includePremiumFields) return base;
  return {
    ...base,
    recommendations: asArray(generatedText.recommendations),
    invalidation_conditions: Array.isArray(generatedText.invalidation_conditions)
      ? generatedText.invalidation_conditions
      : [],
    source_refs: Array.isArray(snapshot.source_refs) ? snapshot.source_refs : [],
    content_score_breakdown: asObject(snapshot.content_score_breakdown),
    reason_codes: Array.isArray(snapshot.reason_codes) ? snapshot.reason_codes : [],
  };
}

function buildPublicPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getAi(report);
  const importantNews = getImportantNews(report, ai);
  const premiumGate = evaluatePremiumContentGate(ai, importantNews.length);
  const confidenceScore = getConfidenceScore(report, ai);
  const openingRadar = ctx.openingRadar || asObject(ai.opening_radar);
  const marketMetadata = getCanonicalMarketMetadata(report, ai);
  const publicSummary = asObject(ai.public_summary);
  const freeSummary = asObject(ai.free_summary);
  const canonicalDecision = buildCanonicalDecision(ctx, false);
  const dailySentence = toStringValue(canonicalDecision?.daily_sentence) || getTodayQuote(report, ai);
  return {
    report_date: getReportDate(report),
    revision_id: toStringValue(canonicalDecision?.id) || toStringValue(report.id),
    market_date: getMarketDate(report, ai),
    base_date: getMarketDate(report, ai),
    generated_at: getGeneratedAt(report, ai),
    data_as_of: getDataAsOf(ai, ctx),
    market_status: marketMetadata.marketStatus,
    is_trading_day: marketMetadata.isTradingDay,
    closed_reason: marketMetadata.closedReason,
    market_bias: getMarketBias(report, ai),
    confidence_score: confidenceScore,
    confidence_label: getConfidenceLabel(confidenceScore),
    confidence_band: getConfidenceBand(confidenceScore),
    today_quote: dailySentence,
    daily_sentence: dailySentence,
    v8_daily_sentence: asObject(ai.v8_daily_sentence),
    public_summary: Object.keys(publicSummary).length > 0 ? publicSummary : freeSummary,
    beneficiary_count: getBeneficiaryCount(ai),
    one_teaser_stock: premiumGate.eligible ? buildTeaserStock(ai) : null,
    v10_beneficiary_enabled: isV10BeneficiaryEnabled(ai),
    v10_data_quality_status: toStringValue(ai.v10_data_quality_status),
    v10_warning: toStringValue(ai.v10_warning),
    v10_candidate_count: toNumberValue(ai.v10_candidate_count),
    premium_content_status: premiumGate.status,
    premium_decision_mode: premiumGate.decision_mode,
    premium_content_reason_codes: premiumGate.reason_codes,
    recommendation_count: premiumGate.recommendation_count,
    complete_recommendation_count: premiumGate.complete_recommendation_count,
    member_value_score: toNumberValue(ai.member_value_score),
    content_score: toNumberValue(canonicalDecision?.content_score) ?? premiumGate.content_score,
    content_grade: toStringValue(canonicalDecision?.content_grade) || premiumGate.content_grade,
    content_score_breakdown: premiumGate.content_score_breakdown,
    canonical_decision: canonicalDecision,
    content_publish_gate: {
      overall_status: premiumGate.status,
      blocking_issues: premiumGate.reason_codes,
    },
    important_news: buildPublicNews(importantNews),
    fresh_news_count: importantNews.length,
    opening_radar_status: toStringValue(openingRadar.radar_status) || toStringValue(openingRadar.status),
    opening_radar: buildPublicOpeningRadar(openingRadar),
    intraday_sync_status: asObject(ai.intraday_sync_status),
    input_source: toStringValue(openingRadar.input_source) || null,
    degraded_metadata: {
      data_status: toStringValue(openingRadar.data_status),
      missing_sources: Array.isArray(openingRadar.missing_sources) ? openingRadar.missing_sources : [],
      radar_mode: toStringValue(openingRadar.radar_mode),
      txf_status: toStringValue(openingRadar.txf_status),
      input_source: toStringValue(openingRadar.input_source),
    },
    sector_rotation_scores: ctx.sectorRotationRows.slice(0, 3).map((row) => ({
      score_date: row.score_date,
      sector: row.sector,
      direction: row.direction,
      signal_label: row.signal_label,
    })),
    sector_rotation_status: asObject(ai.sector_rotation_status),
    market_data_snapshots: ctx.marketDataSnapshots.slice(0, 16),
    closing_verification: buildClosingVerdict(ai),
    data_quality: toStringValue(ai.data_quality) || toStringValue(ai.data_status) || toStringValue(asObject(ai.member_research_note_v2).data_status) || "unknown",
  };
}

function buildMemberPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getAi(report);
  const importantNews = getImportantNews(report, ai);
  const premiumGate = evaluatePremiumContentGate(ai, importantNews.length);
  const note = asObject(ai.member_research_note_v2);
  const v8BeneficiaryChain = asObject(ai.v8_beneficiary_chain);
  const v8OvernightCausalChain = asObject(ai.v8_overnight_causal_chain);
  const publicPayload = buildPublicPayload(report, ctx);
  const publicDegradedMetadata = asObject(publicPayload.degraded_metadata);
  if (!premiumGate.eligible) {
    return {
      ...publicPayload,
      premium_content_status: premiumGate.status,
      premium_content_reason_codes: premiumGate.reason_codes,
      premium_content_unavailable_reason: "EVIDENCE_GATE_NOT_MET",
    };
  }
  return {
    ...publicPayload,
    canonical_decision: buildCanonicalDecision(ctx, true),
    confidence_score: getConfidenceScore(report, ai),
    today_beneficiary_stocks: isV10BeneficiaryEnabled(ai) ? asArray(ai.today_beneficiary_stocks_v10) : asArray(ai.today_beneficiary_stocks),
    beneficiary_stocks: isV10BeneficiaryEnabled(ai) ? asArray(ai.today_beneficiary_stocks_v10) : asArray(ai.beneficiary_stocks),
    core_beneficiary_stocks: isV10BeneficiaryEnabled(ai) ? asArray(ai.today_beneficiary_stocks_v10) : asArray(ai.core_beneficiary_stocks),
    extended_watchlist: isV10BeneficiaryEnabled(ai) ? asArray(ai.v10_observation_watchlist) : asArray(ai.extended_watchlist),
    scenario_watchlist: isV10BeneficiaryEnabled(ai) ? asArray(ai.v10_risk_watchlist) : asArray(ai.scenario_watchlist),
    today_beneficiary_stocks_v10: asArray(ai.today_beneficiary_stocks_v10),
    v10_observation_watchlist: asArray(ai.v10_observation_watchlist),
    v10_risk_watchlist: asArray(ai.v10_risk_watchlist),
    v10_beneficiary_enabled: isV10BeneficiaryEnabled(ai),
    v10_data_quality_status: toStringValue(ai.v10_data_quality_status),
    v10_warning: toStringValue(ai.v10_warning),
    v10_candidate_count: toNumberValue(ai.v10_candidate_count),
    v8_beneficiary_chain: v8BeneficiaryChain,
    v8_overnight_causal_chain: v8OvernightCausalChain,
    source_signals: ai.source_signals || v8BeneficiaryChain.source_signals || [],
    why_this_stock: ai.why_this_stock || null,
    data_status: toStringValue(ai.data_status) || toStringValue(note.data_status) || toStringValue(ai.data_quality) || null,
    data_basis_note: toStringValue(ai.data_basis_note) || toStringValue(note.data_basis_note) || null,
    strategy_summary: ai.strategy_summary || note.strategy_summary || null,
    degraded_metadata: {
      ...publicDegradedMetadata,
      report_data_quality: toStringValue(ai.data_quality) || toStringValue(ai.data_status),
      missing_sources: Array.isArray(ai.missing_sources) ? ai.missing_sources : publicDegradedMetadata.missing_sources,
    },
    member_research_note_v2: note,
    intraday_tracking: asObject(ai.intraday_tracking),
    intraday_time_windows: asArray(note.intraday_time_windows),
    intraday_replay_time_windows: asArray(asObject(ai.closing_verification_v2).intraday_replay_time_windows),
    overnight_chain: note.overnight_chain || v8OvernightCausalChain.chains || ai.causal_overnight_impact_chains || [],
    validation_signal: buildValidationSignals(ai),
    invalidation_condition: buildInvalidationConditions(ai),
    closing_verification: buildClosingSummary(ai),
    closing_verification_v2: asObject(ai.closing_verification_v2),
  };
}

function buildVipPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getAi(report);
  const note = asObject(ai.member_research_note_v2);
  const closing = asObject(ai.closing_verification);
  const memberPayload = buildMemberPayload(report, ctx);
  if (memberPayload.premium_content_status !== "eligible") return memberPayload;
  return {
    ...memberPayload,
    fund_flow_scenario: note.fund_flow_scenario || ai.fund_flow_scenario || null,
    market_mispricing: note.market_mispricing || ai.market_mispricing || null,
    institutional_behavior: note.institutional_behavior || ai.institutional_behavior || null,
    failure_analysis: {
      miss_reason: closing.miss_reason || null,
      failed_assumptions: Array.isArray(closing.failed_assumptions) ? closing.failed_assumptions : [],
      lessons_learned: Array.isArray(closing.lessons_learned) ? closing.lessons_learned : [],
    },
    tomorrow_extension_watch: note.tomorrow_extension_watch || closing.tomorrow_watch_points || null,
  };
}

function buildAdminPayload(report: ReportRow): Record<string, unknown> {
  return report;
}

function buildPayload(report: ReportRow, tier: SubscriptionTier, ctx: PayloadContext): Record<string, unknown> {
  if (tier === "admin") return buildAdminPayload(report);
  if (tier === "vip") return buildVipPayload(report, ctx);
  if (tier === "member") return buildMemberPayload(report, ctx);
  return buildPublicPayload(report, ctx);
}

function buildHistorySummary(report: ReportRow): Record<string, unknown> {
  const ai = getAi(report);
  const confidenceScore = getConfidenceScore(report, ai);
  const dailySentence = getTodayQuote(report, ai);
  return {
    report_date: getReportDate(report),
    revision_id: toStringValue(report.id),
    generated_at: getGeneratedAt(report, ai),
    market_bias: getMarketBias(report, ai),
    confidence_score: confidenceScore,
    confidence_label: getConfidenceLabel(confidenceScore),
    summary: dailySentence,
    today_quote: dailySentence,
  };
}

function getLockedSections(tier: SubscriptionTier): string[] {
  if (tier === "admin" || tier === "vip") return [];
  if (tier === "member") return MEMBER_LOCKED_SECTIONS;
  return PUBLIC_LOCKED_SECTIONS;
}

function createServiceClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function fetchPayloadContext(
  serviceClient: ServiceClient,
  reportDate: string,
): Promise<PayloadContext> {
  const [radarResult, sectorResult, snapshotResult, decisionResult] = await Promise.all([
    serviceClient
      .from("opening_market_radar")
      .select("*")
      .eq("report_date", reportDate)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    serviceClient
      .from("sector_rotation_scores")
      .select("score_date,sector,rotation_score,direction,signal_label,created_at")
      .eq("score_date", reportDate)
      .order("sector", { ascending: true }),
    serviceClient
      .from("market_data_snapshots")
      .select("symbol,name,market,value,change_percent,captured_at,source,phase,trading_date")
      .eq("trading_date", reportDate)
      .order("captured_at", { ascending: false })
      .limit(50),
    serviceClient
      .from("decision_snapshots")
      .select("*")
      .eq("report_date", reportDate)
      .eq("session_type", "PREMARKET")
      .eq("is_current", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (radarResult.error) console.error("GET_REPORT_PAYLOAD_RADAR_QUERY_FAILED", radarResult.error.message);
  if (sectorResult.error) console.error("GET_REPORT_PAYLOAD_SECTOR_QUERY_FAILED", sectorResult.error.message);
  if (snapshotResult.error) console.error("GET_REPORT_PAYLOAD_SNAPSHOT_QUERY_FAILED", snapshotResult.error.message);
  if (decisionResult.error) console.error("GET_REPORT_PAYLOAD_DECISION_QUERY_FAILED", decisionResult.error.message);

  return {
    openingRadar: radarResult.data ? radarResult.data as Record<string, unknown> : null,
    sectorRotationRows: Array.isArray(sectorResult.data) ? sectorResult.data as Record<string, unknown>[] : [],
    marketDataSnapshots: Array.isArray(snapshotResult.data) ? snapshotResult.data as Record<string, unknown>[] : [],
    decisionSnapshot: decisionResult.data ? decisionResult.data as Record<string, unknown> : null,
  };
}

async function resolveTierFromRequest(
  req: Request,
  serviceClient: ServiceClient,
): Promise<{ tier: SubscriptionTier; userId: string | null }> {
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";

  if (bearer) {
    const { data, error } = await serviceClient.auth.getUser(bearer);
    if (!error && data.user) {
      // Do not trust client-supplied tier when Authorization is present.
      const { data: profile, error: profileError } = await serviceClient
        .from("profiles")
        .select("role,subscription_status,membership_tier,paid_until")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError) {
        console.warn("GET_REPORT_PAYLOAD_PROFILE_LOOKUP_FAILED", profileError.message);
        return { tier: "free", userId: data.user.id };
      }

      return {
        tier: resolveTierFromProfile(profile as ProfileRow | null),
        userId: data.user.id,
      };
    }
    return { tier: "free", userId: null };
  }

  // Anonymous requests are always free. Client URL/body values never grant entitlement.
  return { tier: "free", userId: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Only POST allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Supabase credentials missing" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = asObject(await req.json());
  } catch {
    body = {};
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);

  const { tier, userId } = await resolveTierFromRequest(req, serviceClient);

  if (body.history_limit !== undefined) {
    const requestedLimit = Math.trunc(Number(body.history_limit));
    const historyLimit = Number.isFinite(requestedLimit) ? Math.min(30, Math.max(1, requestedLimit)) : 7;
    const { data: historyRows, error: historyError } = await serviceClient
      .from("reports")
      .select("id,report_date,market_bias,confidence_score,summary,today_quote,created_at,updated_at,ai_strategy_json")
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(historyLimit);
    if (historyError) {
      console.error("GET_REPORT_PAYLOAD_HISTORY_QUERY_FAILED", historyError.message);
      return jsonResponse({ success: false, error: "REPORT_HISTORY_QUERY_FAILED" }, 500);
    }
    return jsonResponse({
      tier,
      report_date: null,
      payload: null,
      reports: Array.isArray(historyRows) ? historyRows.map((row) => buildHistorySummary(row as ReportRow)) : [],
      locked_sections: getLockedSections(tier),
      source: "server_trimmed_payload",
      authenticated: Boolean(userId),
    });
  }

  let query = serviceClient
    .from("reports")
    .select("*")
    .order("report_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (isValidDate(body.report_date)) {
    query = serviceClient
      .from("reports")
      .select("*")
      .eq("report_date", body.report_date)
      .order("created_at", { ascending: false })
      .limit(1);
  }

  const { data, error } = await query;
  if (error) {
    console.error("GET_REPORT_PAYLOAD_REPORT_QUERY_FAILED", error.message);
    return jsonResponse({ success: false, error: "REPORT_QUERY_FAILED" }, 500);
  }

  const report = Array.isArray(data) && data.length > 0 ? data[0] as ReportRow : null;
  if (!report) {
    return jsonResponse({
      success: false,
      error: "REPORT_NOT_FOUND",
      tier,
      report_date: isValidDate(body.report_date) ? body.report_date : null,
      payload: null,
      locked_sections: getLockedSections(tier),
      source: "server_trimmed_payload",
    }, 404);
  }

  const context = await fetchPayloadContext(serviceClient, getReportDate(report));
  const publicMetadata = buildPublicPayload(report, context);
  const canonicalDecision = asObject(publicMetadata.canonical_decision);

  return jsonResponse({
    tier,
    report_date: getReportDate(report),
    revision_id: toStringValue(canonicalDecision.id) || toStringValue(report.id),
    generated_at: getGeneratedAt(report, getAi(report)),
    data_as_of: publicMetadata.data_as_of,
    market_status: publicMetadata.market_status,
    is_trading_day: publicMetadata.is_trading_day,
    payload: buildPayload(report, tier, context),
    locked_sections: getLockedSections(tier),
    source: "server_trimmed_payload",
    authenticated: Boolean(userId),
  });
});
