import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getTaipeiDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")?.value || ""}-${parts.find((p) => p.type === "month")?.value || ""}-${parts.find((p) => p.type === "day")?.value || ""}`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function hasArrayItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasMemberResearchNoteV2(ai: Record<string, unknown>): boolean {
  const note = asObject(ai.member_research_note_v2);
  if (Object.keys(note).length === 0) return false;
  const filledSections = [
    note.overnight_chain,
    note.taiwan_impact_map,
    note.beneficiary_candidates,
    note.intraday_validation,
    note.invalidation_rules,
    note.closing_feedback_plan,
  ].filter((section) => hasArrayItems(section) || (section && typeof section === "object" && !Array.isArray(section))).length;
  return filledSections >= 2 && String(note.data_status || "") !== "insufficient";
}

async function optionalExists(
  supabase: ReturnType<typeof createClient>,
  table: string,
  dateColumn: string,
  date: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.from(table).select("id").eq(dateColumn, date).limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Only POST allowed" }, 405);

  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret) return jsonResponse({ success: false, error: "CRON_SECRET not set" }, 500);
  if (req.headers.get("x-cron-secret") !== expectedSecret) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Supabase credentials missing" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checkDate = getTaipeiDateString();

  const { data: reportRows, error: reportError } = await supabase
    .from("reports")
    .select("id,report_date,market_bias,confidence_score,ai_strategy_json,created_at")
    .order("report_date", { ascending: false })
    .limit(1);

  if (reportError) {
    return jsonResponse({ success: false, error: reportError.message, check_date: checkDate }, 500);
  }

  const latestReport = Array.isArray(reportRows) && reportRows.length > 0
    ? reportRows[0] as Record<string, unknown>
    : null;
  const ai = asObject(latestReport?.ai_strategy_json);
  const reportDate = latestReport?.report_date ? String(latestReport.report_date) : null;

  const reportExists = !!latestReport;
  const reportDateCorrect = reportDate === checkDate;
  const hasMarketBias = !!String(latestReport?.market_bias || ai.market_bias || "").trim();
  const confidenceValue = latestReport?.confidence_score ?? ai.confidence_score;
  const hasConfidence = confidenceValue !== null && confidenceValue !== undefined && !Number.isNaN(Number(confidenceValue));
  const hasMemberNoteV2 = hasMemberResearchNoteV2(ai);

  const openingRadarTableExists = await optionalExists(supabase, "opening_market_radar", "report_date", checkDate);
  const closingVerificationTableExists = await optionalExists(supabase, "close_market_reviews", "report_date", checkDate);
  const sectorRotationTableExists = await optionalExists(supabase, "sector_rotation_scores", "score_date", checkDate);

  const hasOpeningRadar = hasArrayItems(ai.opening_radar) || openingRadarTableExists;
  const hasSectorRotation =
    Number(ai.sector_rotation_rows || 0) > 0 ||
    String(ai.sector_rotation_data_status || "") === "available" ||
    hasArrayItems(asObject(ai.member_research_note_v2).taiwan_impact_map) ||
    sectorRotationTableExists;
  const hasClosingVerification = !!ai.closing_verification || !!ai.close_validation || closingVerificationTableExists;

  const issues: string[] = [];
  if (!reportExists) issues.push("MISSING_REPORT");
  if (reportExists && !reportDateCorrect) issues.push("DATE_MISMATCH");
  if (!hasMarketBias) issues.push("MISSING_MARKET_BIAS");
  if (!hasConfidence) issues.push("MISSING_CONFIDENCE");
  if (!hasMemberNoteV2) issues.push("MISSING_MEMBER_RESEARCH_NOTE_V2");
  if (!hasOpeningRadar) issues.push("MISSING_OPENING_RADAR");
  if (!hasSectorRotation) issues.push("MISSING_SECTOR_ROTATION");
  if (!hasClosingVerification) issues.push("MISSING_CLOSING_VERIFICATION");

  const healthScore =
    (reportExists ? 20 : 0) +
    (hasMemberNoteV2 ? 20 : 0) +
    (hasOpeningRadar ? 20 : 0) +
    (hasSectorRotation ? 20 : 0) +
    (hasClosingVerification ? 20 : 0);

  const canEnterV8 =
    healthScore >= 90 &&
    reportDateCorrect &&
    hasMemberNoteV2 &&
    !issues.some((issue) => ["MISSING_REPORT", "DATE_MISMATCH", "MISSING_MEMBER_RESEARCH_NOTE_V2"].includes(issue));

  const rawSnapshot = {
    latest_report_id: latestReport?.id || null,
    latest_report_date: reportDate,
    latest_report_created_at: latestReport?.created_at || null,
    has_ai_strategy_json: Object.keys(ai).length > 0,
    opening_radar_table_exists: openingRadarTableExists,
    sector_rotation_table_exists: sectorRotationTableExists,
    closing_verification_table_exists: closingVerificationTableExists,
    member_research_note_v2_status: asObject(ai.member_research_note_v2).data_status || null,
  };

  const { error: insertError } = await supabase.from("system_health_logs").insert({
    check_date: checkDate,
    report_exists: reportExists,
    report_date_correct: reportDateCorrect,
    has_market_bias: hasMarketBias,
    has_confidence: hasConfidence,
    has_member_note_v2: hasMemberNoteV2,
    has_opening_radar: hasOpeningRadar,
    has_sector_rotation: hasSectorRotation,
    has_closing_verification: hasClosingVerification,
    health_score: healthScore,
    issues,
    raw_snapshot: rawSnapshot,
  });

  if (insertError) {
    return jsonResponse({ success: false, error: insertError.message, check_date: checkDate }, 500);
  }

  return jsonResponse({
    success: true,
    check_date: checkDate,
    health_score: healthScore,
    issues,
    can_enter_v8: canEnterV8,
  });
});
