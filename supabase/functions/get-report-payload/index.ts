import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return paidUntil >= Date.now();
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
    toStringValue(report.created_at) ||
    toStringValue(report.updated_at) ||
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

function getConfidenceLabel(score: number | null): string {
  if (score === null) return "資料完整度待確認";
  if (score >= 75) return "高把握度";
  if (score >= 55) return "中等把握度";
  if (score > 0) return "偏低";
  return "偏低，請查看缺失來源";
}

function getBeneficiaryArrays(ai: Record<string, unknown>): Record<string, unknown>[][] {
  return [
    asArray(ai.today_beneficiary_stocks),
    asArray(ai.beneficiary_stocks),
    asArray(ai.core_beneficiary_stocks),
  ];
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
  const closing = asObject(ai.closing_verification);
  if (Object.keys(closing).length === 0) return null;
  return {
    status: toStringValue(closing.status),
    verdict_label: toStringValue(closing.verdict_label),
    prediction_result: toStringValue(closing.prediction_result),
  };
}

function buildClosingSummary(ai: Record<string, unknown>): Record<string, unknown> | null {
  const closing = asObject(ai.closing_verification);
  if (Object.keys(closing).length === 0) return null;
  return {
    status: toStringValue(closing.status),
    verdict_label: toStringValue(closing.verdict_label),
    prediction_result: toStringValue(closing.prediction_result),
    verification_note: toStringValue(closing.verification_note),
    actual_taiex_change: toNumberValue(closing.actual_taiex_change),
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
    ...asArray(note.invalidation_rules),
    ...asArray(ai.invalidation_conditions),
    ...candidateRisks,
  ].filter(Boolean);
}

function buildPublicPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getAi(report);
  const confidenceScore = getConfidenceScore(report, ai);
  const openingRadar = ctx.openingRadar || asObject(ai.opening_radar);
  const publicSummary = asObject(ai.public_summary);
  const freeSummary = asObject(ai.free_summary);
  const dailySentence = getTodayQuote(report, ai);
  return {
    report_date: getReportDate(report),
    market_date: getMarketDate(report, ai),
    base_date: getMarketDate(report, ai),
    generated_at: getGeneratedAt(report, ai),
    market_status: toStringValue(ai.market_status) || (ai.is_trading_day === false ? "closed" : "open"),
    closed_reason: toStringValue(ai.closed_reason) || toStringValue(ai.holiday_name),
    market_bias: getMarketBias(report, ai),
    confidence_score: confidenceScore,
    confidence_label: getConfidenceLabel(confidenceScore),
    confidence_band: getConfidenceBand(confidenceScore),
    today_quote: dailySentence,
    daily_sentence: dailySentence,
    v8_daily_sentence: asObject(ai.v8_daily_sentence),
    public_summary: Object.keys(publicSummary).length > 0 ? publicSummary : freeSummary,
    beneficiary_count: getBeneficiaryCount(ai),
    one_teaser_stock: buildTeaserStock(ai),
    opening_radar_status: toStringValue(openingRadar.radar_status) || toStringValue(openingRadar.status),
    opening_radar: openingRadar,
    input_source: toStringValue(openingRadar.input_source) || null,
    degraded_metadata: {
      data_status: toStringValue(openingRadar.data_status),
      missing_sources: Array.isArray(openingRadar.missing_sources) ? openingRadar.missing_sources : [],
      radar_mode: toStringValue(openingRadar.radar_mode),
      txf_status: toStringValue(openingRadar.txf_status),
      input_source: toStringValue(openingRadar.input_source),
    },
    sector_rotation_scores: ctx.sectorRotationRows,
    market_data_snapshots: ctx.marketDataSnapshots,
    closing_verification: buildClosingVerdict(ai),
    data_quality: toStringValue(ai.data_quality) || toStringValue(ai.data_status) || toStringValue(asObject(ai.member_research_note_v2).data_status) || "unknown",
  };
}

function buildMemberPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getAi(report);
  const note = asObject(ai.member_research_note_v2);
  const publicPayload = buildPublicPayload(report, ctx);
  const publicDegradedMetadata = asObject(publicPayload.degraded_metadata);
  return {
    ...publicPayload,
    confidence_score: getConfidenceScore(report, ai),
    today_beneficiary_stocks: asArray(ai.today_beneficiary_stocks),
    beneficiary_stocks: asArray(ai.beneficiary_stocks),
    core_beneficiary_stocks: asArray(ai.core_beneficiary_stocks),
    source_signals: ai.source_signals || asObject(ai.v8_beneficiary_chain).source_signals || [],
    why_this_stock: ai.why_this_stock || null,
    degraded_metadata: {
      ...publicDegradedMetadata,
      report_data_quality: toStringValue(ai.data_quality) || toStringValue(ai.data_status),
      missing_sources: Array.isArray(ai.missing_sources) ? ai.missing_sources : publicDegradedMetadata.missing_sources,
    },
    member_research_note_v2: note,
    overnight_chain: note.overnight_chain || asObject(ai.v8_overnight_causal_chain).chains || ai.causal_overnight_impact_chains || [],
    validation_signal: buildValidationSignals(ai),
    invalidation_condition: buildInvalidationConditions(ai),
    closing_verification: buildClosingSummary(ai),
  };
}

function buildVipPayload(report: ReportRow, ctx: PayloadContext): Record<string, unknown> {
  const ai = getAi(report);
  const note = asObject(ai.member_research_note_v2);
  const closing = asObject(ai.closing_verification);
  return {
    ...buildMemberPayload(report, ctx),
    fund_flow_scenario: note.fund_flow_scenario || ai.fund_flow_scenario || null,
    market_mispricing: note.market_mispricing || ai.market_mispricing || null,
    institutional_behavior: note.institutional_behavior || ai.institutional_behavior || null,
    prediction_accuracy_logs_summary: {
      status: "placeholder",
      message: "P28 scaffold: weekly accuracy summary will be served after P29 entitlement-backed aggregation.",
    },
    failure_analysis: {
      miss_reason: closing.miss_reason || null,
      failed_assumptions: Array.isArray(closing.failed_assumptions) ? closing.failed_assumptions : [],
      lessons_learned: Array.isArray(closing.lessons_learned) ? closing.lessons_learned : [],
    },
    tomorrow_extension_watch: note.tomorrow_extension_watch || closing.tomorrow_watch_points || null,
    weekly_accuracy: {
      status: "placeholder",
      message: "P28 scaffold: VIP weekly accuracy will be computed server-side in a later phase.",
    },
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

function getLockedSections(tier: SubscriptionTier): string[] {
  if (tier === "admin" || tier === "vip") return [];
  if (tier === "member") return MEMBER_LOCKED_SECTIONS;
  return PUBLIC_LOCKED_SECTIONS;
}

async function fetchPayloadContext(
  serviceClient: ReturnType<typeof createClient>,
  reportDate: string,
): Promise<PayloadContext> {
  const [radarResult, sectorResult, snapshotResult] = await Promise.all([
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
  ]);

  if (radarResult.error) console.error("GET_REPORT_PAYLOAD_RADAR_QUERY_FAILED", radarResult.error.message);
  if (sectorResult.error) console.error("GET_REPORT_PAYLOAD_SECTOR_QUERY_FAILED", sectorResult.error.message);
  if (snapshotResult.error) console.error("GET_REPORT_PAYLOAD_SNAPSHOT_QUERY_FAILED", snapshotResult.error.message);

  return {
    openingRadar: radarResult.data ? radarResult.data as Record<string, unknown> : null,
    sectorRotationRows: Array.isArray(sectorResult.data) ? sectorResult.data as Record<string, unknown>[] : [],
    marketDataSnapshots: Array.isArray(snapshotResult.data) ? snapshotResult.data as Record<string, unknown>[] : [],
  };
}

async function resolveTierFromRequest(
  req: Request,
  body: Record<string, unknown>,
  serviceClient: ReturnType<typeof createClient>,
): Promise<{ tier: SubscriptionTier; devOverride: boolean; userId: string | null }> {
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
        return { tier: "free", devOverride: false, userId: data.user.id };
      }

      return {
        tier: resolveTierFromProfile(profile as ProfileRow | null),
        devOverride: false,
        userId: data.user.id,
      };
    }
    return { tier: "free", devOverride: false, userId: null };
  }

  // TODO P29: dev-only override for local/manual payload testing.
  // Production entitlement must come from verified server-side profiles/subscriptions, never from client-supplied tier.
  const devTier = body.tier || new URL(req.url).searchParams.get("tier");
  if (devTier) {
    return { tier: normalizeTier(devTier), devOverride: true, userId: null };
  }
  return { tier: "free", devOverride: false, userId: null };
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

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { tier, devOverride, userId } = await resolveTierFromRequest(req, body, serviceClient);

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
      dev_override: devOverride,
    }, 404);
  }

  const context = await fetchPayloadContext(serviceClient, getReportDate(report));

  return jsonResponse({
    tier,
    report_date: getReportDate(report),
    payload: buildPayload(report, tier, context),
    locked_sections: getLockedSections(tier),
    source: "server_trimmed_payload",
    dev_override: devOverride,
    authenticated: Boolean(userId),
  });
});
