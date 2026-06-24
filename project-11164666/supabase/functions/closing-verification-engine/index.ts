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

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return asObject(parsed);
    } catch {
      return {};
    }
  }
  return {};
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

type TaiexCloseData = {
  symbol: string;
  change: number;
  capturedAt: string | null;
  updatedAt: string | null;
};

type PredictedDirection = "bullish" | "bearish" | "neutral";
type StructuredActualDirection = "up" | "down" | "flat";
type StructuredPredictionResult = "hit" | "miss" | "partial" | "pending";

function scorePrediction(predictedBias: string, actualTaiexChange: number): { result: string; score: number; direction: string } {
  const normalized = normalizePredictedBias(predictedBias);
  const direction = actualDirection(actualTaiexChange);
  const correct =
    (normalized === "BULLISH" && actualTaiexChange > 0) ||
    (normalized === "BEARISH" && actualTaiexChange < 0) ||
    (normalized === "NEUTRAL" && Math.abs(actualTaiexChange) < 0.5);
  return { result: correct ? "CORRECT" : "WRONG", score: correct ? 100 : 0, direction };
}

function normalizeStructuredPredictedDirection(predictedBias: string): PredictedDirection {
  if (predictedBias.includes("多") || predictedBias.includes("偏強")) return "bullish";
  if (predictedBias.includes("空") || predictedBias.includes("偏弱")) return "bearish";
  return "neutral";
}

function getStructuredActualDirection(change: number): StructuredActualDirection {
  if (change >= 0.3) return "up";
  if (change <= -0.3) return "down";
  return "flat";
}

function getStructuredPredictionResult(
  predictedDirection: PredictedDirection,
  actualDirectionValue: StructuredActualDirection | "unknown",
): StructuredPredictionResult {
  if (actualDirectionValue === "unknown") return "pending";
  if (
    (predictedDirection === "bullish" && actualDirectionValue === "up") ||
    (predictedDirection === "bearish" && actualDirectionValue === "down") ||
    (predictedDirection === "neutral" && actualDirectionValue === "flat")
  ) {
    return "hit";
  }
  if (
    (predictedDirection === "bullish" && actualDirectionValue === "flat") ||
    (predictedDirection === "bearish" && actualDirectionValue === "flat") ||
    (predictedDirection === "neutral" && actualDirectionValue !== "flat")
  ) {
    return "partial";
  }
  return "miss";
}

function scoreStructuredPrediction(result: StructuredPredictionResult, confidence: number | null): number {
  const confidenceValue = confidence ?? 50;
  if (result === "hit") return Math.max(85, Math.min(100, 85 + Math.round(confidenceValue * 0.15)));
  if (result === "partial") return Math.max(55, Math.min(75, 55 + Math.round(confidenceValue * 0.2)));
  if (result === "miss") return Math.max(20, Math.min(45, 45 - Math.round(confidenceValue * 0.25)));
  return 0;
}

function directionLabel(direction: StructuredActualDirection | "unknown"): string {
  if (direction === "up") return "上漲";
  if (direction === "down") return "下跌";
  if (direction === "flat") return "震盪";
  return "未知";
}

function verdictLabel(result: StructuredPredictionResult): string {
  if (result === "hit") return "今日盤前方向命中";
  if (result === "partial") return "方向部分成立";
  if (result === "miss") return "今日盤前方向失效";
  return "等待有效收盤資料";
}

function buildVerificationNote(
  predictedBias: string,
  taiexChange: number | null,
  actualDirectionValue: StructuredActualDirection | "unknown",
  result: StructuredPredictionResult,
): string {
  if (result === "pending" || taiexChange === null) {
    return "收盤驗證已執行，但尚未取得有效 TAIEX 收盤資料；系統未使用假資料。";
  }
  const changeText = `${taiexChange >= 0 ? "+" : ""}${taiexChange.toFixed(2)}%`;
  if (result === "hit") {
    return `盤前判斷為${predictedBias || "未明"}，收盤 TAIEX ${directionLabel(actualDirectionValue)} ${changeText}，實際方向與盤前假設大致一致。`;
  }
  if (result === "partial") {
    return `盤前判斷為${predictedBias || "未明"}，收盤 TAIEX ${directionLabel(actualDirectionValue)} ${changeText}，方向沒有完全展開，今日判斷僅部分成立。`;
  }
  return `盤前判斷為${predictedBias || "未明"}，但收盤 TAIEX ${directionLabel(actualDirectionValue)} ${changeText}，實際方向與盤前假設相反，今日判斷失效。`;
}

function buildMissReason(
  predictedDirection: PredictedDirection,
  actualDirectionValue: StructuredActualDirection | "unknown",
  result: StructuredPredictionResult,
): string | null {
  if (result === "hit" || result === "pending") return null;
  if (result === "partial" && actualDirectionValue === "flat") return "台股收盤接近震盪，盤前方向沒有完全展開";
  if (predictedDirection === "bullish" && actualDirectionValue !== "up") return "盤前偏多假設未被收盤指數確認";
  if (predictedDirection === "bearish" && actualDirectionValue !== "down") return "盤前偏弱假設未被收盤指數確認";
  if (predictedDirection === "neutral" && actualDirectionValue !== "flat") return "中性盤前假設遇到明確方向行情，收盤結果超出原本劇本";
  return "收盤結果與盤前方向不完全一致";
}

function buildFailedAssumptions(
  predictedDirection: PredictedDirection,
  actualDirectionValue: StructuredActualDirection | "unknown",
  result: StructuredPredictionResult,
): string[] {
  if (result === "hit" || result === "pending") return [];
  const items: string[] = [];
  if (predictedDirection === "bullish") {
    items.push("盤前預期台股延續多方，但收盤指數未站上正報酬");
  } else if (predictedDirection === "bearish") {
    items.push("盤前預期台股偏弱，但收盤指數未形成明確負報酬");
  } else {
    items.push("盤前預期台股震盪，但收盤方向超出中性劇本");
  }
  if (actualDirectionValue === "down") {
    items.push("台積電與指數帶動力不足以支撐盤前方向");
    items.push("盤中轉弱訊號優先於盤前假設");
  } else if (actualDirectionValue === "up") {
    items.push("台指期與權值股買盤強於盤前保守假設");
  } else {
    items.push("收盤缺乏明確趨勢，盤前方向未能取得指數確認");
  }
  return items.slice(0, 3);
}

function buildTomorrowWatchPoints(
  result: StructuredPredictionResult,
  actualDirectionValue: StructuredActualDirection | "unknown",
): string[] {
  const directionText = actualDirectionValue === "down" ? "轉弱" : actualDirectionValue === "up" ? "轉強" : "震盪";
  if (result === "miss") {
    return [
      `明天優先觀察今日${directionText}方向是否延續，避免沿用已失效的盤前劇本。`,
      "台積電開盤與台指期是否同向，決定權值股是否重新取得主導權。",
      "AI/半導體族群是否跟隨大盤修正，若不同步需降低族群推論權重。",
    ];
  }
  if (result === "hit") {
    return [
      `明天觀察今日${directionText}方向是否延續，確認盤前模型是否具備連續性。`,
      "台積電與台指期是否維持同向，作為盤前方向延續的第一驗證點。",
      "AI/半導體族群是否續強或續弱，確認資金是否從指數擴散到族群。",
    ];
  }
  return [
    "明天優先觀察今日震盪是否轉為明確方向，避免過度解讀單日收盤。",
    "台積電與台指期是否同向突破或跌破平盤，是盤前假設重新定錨的關鍵。",
    "AI/半導體族群是否出現同步量能，決定今日部分成立的劇本能否延伸。",
  ];
}

function buildLessonsLearned(result: StructuredPredictionResult, predictedDirection: PredictedDirection): string[] {
  if (result === "pending") {
    return [
      "缺少有效收盤資料時不評分，避免用假資料污染模型回測。",
      "收盤驗證必須等 TAIEX 真實資料完成後再更新模型權重。",
    ];
  }
  const lessons = [
    "收盤驗證應優先參考 TAIEX 與 TXF 是否同向。",
    "盤前海外訊號若未轉化為台股核心權值股，需降級為觀察。",
  ];
  if (result === "miss" && predictedDirection === "bullish") {
    lessons.unshift("高信心偏多若遇到開盤後核心指標轉弱，應降低盤前權重。");
  } else if (result === "miss" && predictedDirection === "bearish") {
    lessons.unshift("高信心偏弱若遇到權值股逆勢撐盤，應降低空方推論權重。");
  } else if (result === "hit") {
    lessons.unshift("盤前方向被收盤確認時，可保留同方向族群作為隔日第一觀察。");
  }
  return lessons.slice(0, 3);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getCloseWindowRange(taipeiDate: string): { start: string; end: string } {
  return {
    start: `${taipeiDate}T05:30:00.000Z`,
    end: `${taipeiDate}T07:30:00.000Z`,
  };
}

async function parseRequestBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return asObject(body);
  } catch {
    return {};
  }
}

async function fetchTaiexCloseDataForDate(
  supabase: ReturnType<typeof createClient>,
  targetDate: string,
): Promise<{ closeData: TaiexCloseData | null; closeWindow: { start: string; end: string } }> {
  const closeWindow = getCloseWindowRange(targetDate);
  const { data, error } = await supabase
    .from("market_data")
    .select("symbol,change_percent,captured_at,updated_at")
    .in("symbol", ["TAIEX", "TWII", "^TWII"])
    .gte("captured_at", closeWindow.start)
    .lte("captured_at", closeWindow.end)
    .order("captured_at", { ascending: false })
    .limit(10);

  if (error || !Array.isArray(data)) return { closeData: null, closeWindow };

  for (const row of data as Record<string, unknown>[]) {
    const dataDate = taipeiDateFromIso(row.captured_at || row.updated_at);
    if (dataDate !== targetDate) continue;
    const change = Number(row.change_percent);
    if (!Number.isNaN(change)) {
      return {
        closeData: {
          symbol: String(row.symbol || "TAIEX"),
          change,
          capturedAt: row.captured_at ? String(row.captured_at) : row.updated_at ? String(row.updated_at) : null,
          updatedAt: row.updated_at ? String(row.updated_at) : null,
        },
        closeWindow,
      };
    }
  }
  return { closeData: null, closeWindow };
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

  const requestBody = await parseRequestBody(req);
  const today = getTaipeiDateString();
  const backfillMode = requestBody.backfill === true;
  const requestedTargetDate = requestBody.target_date;

  if (backfillMode && !isValidDateString(requestedTargetDate)) {
    return jsonResponse({
      success: false,
      error: "INVALID_TARGET_DATE",
      today_date: today,
      backfill_mode: true,
      no_fake_data: true,
    }, 400);
  }

  const verificationDate = backfillMode && isValidDateString(requestedTargetDate)
    ? requestedTargetDate
    : today;

  if (verificationDate > today) {
    return jsonResponse({
      success: false,
      error: "TARGET_DATE_IN_FUTURE",
      verification_date: verificationDate,
      today_date: today,
      backfill_mode: backfillMode,
      no_fake_data: true,
    }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .select("id,report_date,market_bias,confidence_score,ai_strategy_json")
    .eq("report_date", verificationDate)
    .maybeSingle();

  if (reportError) {
    return jsonResponse({
      success: false,
      error: reportError.message,
      verification_date: verificationDate,
      today_date: today,
      backfill_mode: backfillMode,
    }, 500);
  }
  if (!report) {
    return jsonResponse({
      success: false,
      error: "MISSING_REPORT",
      verification_date: verificationDate,
      today_date: today,
      backfill_mode: backfillMode,
      no_fake_data: true,
    }, 404);
  }

  const reportRow = report as Record<string, unknown>;
  const ai = parseJsonObject(reportRow.ai_strategy_json);
  const predictedBias = String(reportRow.market_bias || ai.market_bias || "");
  const confidenceRaw = reportRow.confidence_score ?? ai.confidence_score;
  const confidence = confidenceRaw === null || confidenceRaw === undefined || Number.isNaN(Number(confidenceRaw))
    ? null
    : Math.max(0, Math.min(100, Math.round(Number(confidenceRaw))));

  const { closeData: taiexCloseData, closeWindow } = await fetchTaiexCloseDataForDate(supabase, verificationDate);
  const taiexChange = taiexCloseData?.change ?? null;

  if (taiexChange === null) {
    const pendingClosingVerification: Record<string, unknown> = {
      version: "P20_CLOSE_WINDOW_VERIFICATION",
      status: "pending_real_market_data",
      verified_at: new Date().toISOString(),
      report_date: verificationDate,
      predicted_bias: predictedBias || null,
      predicted_confidence: confidence,
      confidence_score: confidence,
      actual_taiex_change: null,
      actual_direction: "unknown",
      verdict_label: "等待有效收盤資料",
      verification_note: "收盤驗證已執行，但尚未取得 13:30-15:30 台北收盤窗口內的 TAIEX 資料；系統未使用假資料。",
      miss_reason: null,
      failed_assumptions: [],
      tomorrow_watch_points: buildTomorrowWatchPoints("pending", "unknown"),
      lessons_learned: buildLessonsLearned("pending", normalizeStructuredPredictedDirection(predictedBias)),
      data_source: {
        source: "market_data",
        symbol: "TAIEX",
        taiex_symbol: "TAIEX",
        captured_at: null,
        updated_at: null,
        close_window_start: closeWindow.start,
        close_window_end: closeWindow.end,
        table: "market_data",
      },
      reason: {
        message: "Missing real TAIEX close data in strict close window. No fake fallback used.",
      },
      no_fake_data: true,
    };

    const { error: updatePendingError } = await supabase
      .from("reports")
      .update({ ai_strategy_json: { ...ai, closing_verification: pendingClosingVerification } })
      .eq("id", reportRow.id);

    if (updatePendingError) {
      return jsonResponse({
        success: false,
        error: updatePendingError.message,
        code: "NO_CLOSE_DATA",
        verification_date: verificationDate,
        today_date: today,
        backfill_mode: backfillMode,
        close_window_start: closeWindow.start,
        close_window_end: closeWindow.end,
        status: "pending_real_market_data",
        report_updated: false,
        log_inserted: false,
        no_fake_data: true,
      }, 500);
    }

    return jsonResponse({
      success: false,
      code: "NO_CLOSE_DATA",
      verification_date: verificationDate,
      today_date: today,
      backfill_mode: backfillMode,
      close_window_start: closeWindow.start,
      close_window_end: closeWindow.end,
      status: "pending_real_market_data",
      report_updated: true,
      log_inserted: false,
      no_fake_data: true,
    });
  }

  const scored = scorePrediction(predictedBias, taiexChange);
  const actualDirectionValue = scored.direction;
  const predictionResult = scored.result;
  const accuracyScore = scored.score;
  const reason: Record<string, unknown> = {
    predicted_bias: predictedBias,
    normalized_predicted_bias: normalizePredictedBias(predictedBias),
    rule: "BULLISH>0, BEARISH<0, NEUTRAL abs(change)<0.5",
    no_fake_fallback: true,
    close_window_start: closeWindow.start,
    close_window_end: closeWindow.end,
  };

  const { error: insertError } = await supabase.from("prediction_accuracy_logs").insert({
    report_date: verificationDate,
    predicted_bias: predictedBias || null,
    confidence,
    actual_taiex_change: taiexChange,
    actual_direction: actualDirectionValue,
    prediction_result: predictionResult,
    accuracy_score: accuracyScore,
    reason,
  });

  if (insertError) {
    return jsonResponse({
      success: false,
      error: insertError.message,
      verification_date: verificationDate,
      today_date: today,
      backfill_mode: backfillMode,
    }, 500);
  }

  const predictedDirection = normalizeStructuredPredictedDirection(predictedBias);
  const structuredActualDirection = taiexChange === null ? "unknown" : getStructuredActualDirection(taiexChange);
  const structuredPredictionResult = getStructuredPredictionResult(predictedDirection, structuredActualDirection);
  const structuredAccuracyScore = scoreStructuredPrediction(structuredPredictionResult, confidence);
  const failedAssumptions = buildFailedAssumptions(predictedDirection, structuredActualDirection, structuredPredictionResult);
  const tomorrowWatchPoints = buildTomorrowWatchPoints(structuredPredictionResult, structuredActualDirection);
  const lessonsLearned = buildLessonsLearned(structuredPredictionResult, predictedDirection);
  const closingVerification = {
    version: "P20_CLOSE_WINDOW_VERIFICATION",
    status: "completed",
    verified_at: new Date().toISOString(),
    report_date: verificationDate,
    predicted_bias: predictedBias || null,
    predicted_confidence: confidence,
    confidence_score: confidence,
    actual_taiex_change: taiexChange,
    actual_direction: structuredActualDirection === "unknown" ? "flat" : structuredActualDirection,
    prediction_result: structuredPredictionResult,
    accuracy_score: structuredAccuracyScore,
    verdict_label: verdictLabel(structuredPredictionResult),
    verification_note: buildVerificationNote(predictedBias, taiexChange, structuredActualDirection, structuredPredictionResult),
    miss_reason: buildMissReason(predictedDirection, structuredActualDirection, structuredPredictionResult),
    failed_assumptions: failedAssumptions,
    tomorrow_watch_points: tomorrowWatchPoints,
    lessons_learned: lessonsLearned,
    data_source: {
      source: "market_data",
      symbol: taiexCloseData.symbol,
      taiex_symbol: taiexCloseData.symbol,
      captured_at: taiexCloseData.capturedAt,
      updated_at: taiexCloseData.updatedAt,
      close_window_start: closeWindow.start,
      close_window_end: closeWindow.end,
      table: "market_data",
    },
    legacy_actual_direction: actualDirectionValue,
    legacy_prediction_result: predictionResult,
    legacy_accuracy_score: accuracyScore,
    reason,
    no_fake_data: true,
  };

  const updatedAiStrategyJson = {
    ...ai,
    closing_verification: closingVerification,
  };

  const { error: updateReportError } = await supabase
    .from("reports")
    .update({ ai_strategy_json: updatedAiStrategyJson })
    .eq("id", reportRow.id);

  if (updateReportError) {
    return jsonResponse({
      success: false,
      error: updateReportError.message,
      verification_date: verificationDate,
      today_date: today,
      backfill_mode: backfillMode,
      prediction_log_inserted: true,
      report_updated: false,
      closing_verification_status: "completed",
      no_fake_data: true,
    }, 500);
  }

  return jsonResponse({
    success: true,
    verification_date: verificationDate,
    today_date: today,
    backfill_mode: backfillMode,
    prediction_result: structuredPredictionResult,
    verdict_label: verdictLabel(structuredPredictionResult),
    legacy_prediction_result: predictionResult,
    accuracy_score: structuredAccuracyScore,
    actual_taiex_change: taiexChange,
    report_updated: true,
    log_inserted: true,
    closing_verification_status: "completed",
    no_fake_data: true,
  });
});
