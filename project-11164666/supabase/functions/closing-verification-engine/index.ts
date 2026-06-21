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

function taipeiDateFromIso(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value || ""}-${parts.find((p) => p.type === "month")?.value || ""}-${parts.find((p) => p.type === "day")?.value || ""}`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizePredictedBias(value: string): "BULLISH" | "BEARISH" | "NEUTRAL" {
  if (value.includes("多") || value.includes("強")) return "BULLISH";
  if (value.includes("空") || value.includes("弱")) return "BEARISH";
  return "NEUTRAL";
}

function actualDirection(change: number): "POSITIVE" | "NEGATIVE" | "NEUTRAL" {
  if (change > 0) return "POSITIVE";
  if (change < 0) return "NEGATIVE";
  return "NEUTRAL";
}

function scorePrediction(predictedBias: string, actualTaiexChange: number): { result: string; score: number; direction: string } {
  const normalized = normalizePredictedBias(predictedBias);
  const direction = actualDirection(actualTaiexChange);
  const correct =
    (normalized === "BULLISH" && actualTaiexChange > 0) ||
    (normalized === "BEARISH" && actualTaiexChange < 0) ||
    (normalized === "NEUTRAL" && Math.abs(actualTaiexChange) < 0.5);
  return { result: correct ? "CORRECT" : "WRONG", score: correct ? 100 : 0, direction };
}

async function fetchTodayTaiexChange(
  supabase: ReturnType<typeof createClient>,
  today: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("market_data")
    .select("symbol,change_percent,captured_at,updated_at")
    .in("symbol", ["TAIEX", "TWII", "^TWII"])
    .order("captured_at", { ascending: false })
    .limit(10);

  if (error || !Array.isArray(data)) return null;

  for (const row of data as Record<string, unknown>[]) {
    const dataDate = taipeiDateFromIso(row.captured_at || row.updated_at);
    if (dataDate !== today) continue;
    const change = Number(row.change_percent);
    if (!Number.isNaN(change)) return change;
  }
  return null;
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

  const today = getTaipeiDateString();
  const { data: report, error: reportError } = await supabase
    .from("reports")
    .select("id,report_date,market_bias,confidence_score,ai_strategy_json")
    .eq("report_date", today)
    .maybeSingle();

  if (reportError) {
    return jsonResponse({ success: false, error: reportError.message, report_date: today }, 500);
  }
  if (!report) {
    return jsonResponse({ success: false, error: "MISSING_REPORT", report_date: today, no_fake_data: true }, 404);
  }

  const reportRow = report as Record<string, unknown>;
  const ai = asObject(reportRow.ai_strategy_json);
  const predictedBias = String(reportRow.market_bias || ai.market_bias || "");
  const confidenceRaw = reportRow.confidence_score ?? ai.confidence_score;
  const confidence = confidenceRaw === null || confidenceRaw === undefined || Number.isNaN(Number(confidenceRaw))
    ? null
    : Math.max(0, Math.min(100, Math.round(Number(confidenceRaw))));

  const taiexChange = await fetchTodayTaiexChange(supabase, today);

  let actualDirectionValue = "UNKNOWN";
  let predictionResult = "PENDING_REAL_MARKET_DATA";
  let accuracyScore = 0;
  let reason: Record<string, unknown> = {
    message: "Missing real TAIEX close data. No fake fallback used.",
  };

  if (taiexChange !== null) {
    const scored = scorePrediction(predictedBias, taiexChange);
    actualDirectionValue = scored.direction;
    predictionResult = scored.result;
    accuracyScore = scored.score;
    reason = {
      predicted_bias: predictedBias,
      normalized_predicted_bias: normalizePredictedBias(predictedBias),
      rule: "BULLISH>0, BEARISH<0, NEUTRAL abs(change)<0.5",
      no_fake_fallback: true,
    };
  }

  const { error: insertError } = await supabase.from("prediction_accuracy_logs").insert({
    report_date: today,
    predicted_bias: predictedBias || null,
    confidence,
    actual_taiex_change: taiexChange,
    actual_direction: actualDirectionValue,
    prediction_result: predictionResult,
    accuracy_score: accuracyScore,
    reason,
  });

  if (insertError) {
    return jsonResponse({ success: false, error: insertError.message, report_date: today }, 500);
  }

  return jsonResponse({
    success: true,
    report_date: today,
    prediction_result: predictionResult,
    accuracy_score: accuracyScore,
    no_fake_data: true,
  });
});
