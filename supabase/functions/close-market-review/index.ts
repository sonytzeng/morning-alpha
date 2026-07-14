// V1.5_STRICT_CLOSE_SNAPSHOT
// Repository V1.2 was behind deployed V1.4. This version preserves V1.4 report sync while
// requiring same-day phase=close snapshots and explicit force for legacy correction.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveMarketStatus } from "../_shared/market-status.ts";
import {
  CORE_SYMBOL_ALIASES,
  CORE_SYMBOL_QUERY_ALIASES,
  evaluateCloseSnapshotRows,
  type RuntimeSnapshotRow,
} from "../_shared/intraday-runtime-contract.ts";

const VERSION = "V1.5_STRICT_CLOSE_SNAPSHOT";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getTaiwanDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeSymbol(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function rowForAliases(
  rows: RuntimeSnapshotRow[],
  aliases: readonly string[],
): RuntimeSnapshotRow | null {
  const aliasSet = new Set(aliases.map(normalizeSymbol));
  return rows.find((row) => aliasSet.has(normalizeSymbol(row.symbol))) || null;
}

function readChange(row: RuntimeSnapshotRow | null): number | null {
  if (!row) return null;
  const value = Number(row.change_percent);
  return Number.isFinite(value) ? value : null;
}

function classifyCloseResult(taiexChange: number | null): string {
  if (taiexChange === null) return "收盤資料不足";
  if (taiexChange >= 1.0) return "明顯上漲";
  if (taiexChange >= 0.3) return "小漲";
  if (taiexChange > -0.3) return "震盪";
  if (taiexChange > -1.0) return "小跌";
  return "明顯下跌";
}

function generateVerification(
  marketBias: string | null,
  closeResult: string,
  taiexChange: number | null,
  tsmcChange: number | null,
): { validation_result: string; summary: string } {
  const bias = (marketBias || "").trim();
  const taiexText = taiexChange !== null
    ? `加權指數 ${taiexChange >= 0 ? "+" : ""}${taiexChange.toFixed(2)}%`
    : "";
  const tsmcText = tsmcChange !== null
    ? `，台積電 ${tsmcChange >= 0 ? "+" : ""}${tsmcChange.toFixed(2)}%`
    : "";
  const marketText = taiexText ? `（${taiexText}${tsmcText}）` : "";

  if (!bias) {
    return {
      validation_result: "資料不足",
      summary:
        `收盤實際結果為「${closeResult}」${marketText}，但盤前假設資料暫缺，無法比對。`,
    };
  }
  if (closeResult === "收盤資料不足") {
    return {
      validation_result: "資料不足",
      summary:
        `07:30 盤前原始假設為「${bias}」，但收盤資料不足，無法完成今日驗證。`,
    };
  }

  const isNeutral = bias.includes("中性") || bias.includes("震盪") ||
    bias.includes("觀察");
  const isBullish = bias.includes("偏多");
  const isBearish = bias.includes("偏弱") || bias.includes("偏空") ||
    bias.includes("高風險") || bias.includes("保守");
  const isUp = closeResult === "明顯上漲" || closeResult === "小漲";
  const isDown = closeResult === "明顯下跌" || closeResult === "小跌";
  const isRanging = closeResult === "震盪";
  const summary = (result: string, conclusion: string) => ({
    validation_result: result,
    summary:
      `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${marketText}。系統判定：${conclusion}。`,
  });

  if (isBullish && isUp) return summary("方向一致", "方向一致");
  if (isBullish && isDown) return summary("未命中", "偏多假設未命中");
  if (isBearish && isDown) return summary("方向一致", "風險觀點成立");
  if (isBearish && isUp) return summary("未命中", "盤前風險判斷偏保守");
  if (isNeutral && isRanging) return summary("大致一致", "大致一致");
  if (isNeutral && isUp) {
    return summary("部分命中，盤前偏保守", "盤前偏保守，未完全捕捉漲幅");
  }
  if (isNeutral && isDown) {
    return summary("部分命中，風險低估", "下跌風險高於盤前假設");
  }
  return summary("待確認", "尚待進一步確認");
}

function hasStrictCloseProvenance(
  rawPayload: unknown,
  reportDate: string,
): boolean {
  const raw = asObject(rawPayload);
  return raw.source_table === "market_data_snapshots" &&
    raw.source_phase === "close" &&
    raw.trading_date === reportDate &&
    raw.no_intraday_fallback === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const logs: string[] = [];
  const startTime = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    logs.push(line);
    console.log(line);
  };

  try {
    const cronSecret = req.headers.get("x-cron-secret") || "";
    const authHeader = req.headers.get("Authorization") || "";
    const envCronSecret = Deno.env.get("CRON_SECRET") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const hasValidCronSecret = Boolean(
      envCronSecret && cronSecret === envCronSecret,
    );
    const hasValidBearer = authHeader.startsWith("Bearer ") &&
      [supabaseAnonKey, supabaseServiceRole].includes(authHeader.slice(7));

    if (!hasValidCronSecret && !hasValidBearer) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: "Unauthorized",
      }, 401);
    }
    if (!supabaseUrl || !supabaseServiceRole) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: "Supabase credentials missing",
      }, 500);
    }

    const url = new URL(req.url);
    const isForce =
      (url.searchParams.get("force") || "").toLowerCase() === "true";
    const overrideDate = url.searchParams.get("report_date");
    if (isForce && !overrideDate) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: "FORCE_REQUIRES_EXPLICIT_REPORT_DATE",
      }, 400);
    }
    if (overrideDate && (!isForce || !isValidDateString(overrideDate))) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: "REPORT_DATE_OVERRIDE_REQUIRES_FORCE_AND_VALID_DATE",
      }, 400);
    }

    const today = getTaiwanDateString();
    const reportDate = overrideDate || today;
    if (!isValidDateString(reportDate)) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: "INVALID_REPORT_DATE",
      }, 400);
    }

    const marketStatus = resolveMarketStatus(reportDate);
    if (!isForce && !marketStatus.is_trading_day) {
      return jsonResponse({
        success: true,
        skipped: true,
        version: VERSION,
        reason: "MARKET_STATUS_NOT_OPEN",
        report_date: reportDate,
        market_status: marketStatus.market_status,
      });
    }

    log(
      `=== Close Market Review ${VERSION} [${requestId}] date=${reportDate} force=${isForce} ===`,
    );
    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    const snapshotResult = await supabase
      .from("market_data_snapshots")
      .select(
        "symbol,name,value,change_percent,captured_at,source,trading_date,phase",
      )
      .eq("trading_date", reportDate)
      .eq("phase", "close")
      .in("symbol", CORE_SYMBOL_QUERY_ALIASES)
      .order("captured_at", { ascending: false });

    if (snapshotResult.error) throw snapshotResult.error;
    const snapshots = (snapshotResult.data || []) as RuntimeSnapshotRow[];
    const closeEvaluation = evaluateCloseSnapshotRows(snapshots, reportDate);
    if (!closeEvaluation.ready) {
      log(
        `PENDING_REAL_CLOSE_SNAPSHOT missing=${
          closeEvaluation.missingSymbols.join(",") || "out_of_window"
        }`,
      );
      return jsonResponse({
        success: true,
        pending: true,
        version: VERSION,
        action: "no_write",
        status: "pending_real_close_snapshot",
        report_date: reportDate,
        missing_sources: closeEvaluation.missingSymbols,
        rejected_row_count: closeEvaluation.rejectedRows.length,
        required_phase: "close",
        close_window: "13:30-15:30 Asia/Taipei",
        no_intraday_fallback: true,
        logs,
      });
    }

    const acceptedRows = closeEvaluation.acceptedRows;
    const taiexRow = rowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TAIEX);
    const tsmcRow = rowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TSMC);
    const txfRow = rowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TXF);
    const taiexChange = readChange(taiexRow);
    const tsmcChange = readChange(tsmcRow);
    const txfChange = readChange(txfRow);

    const reportResult = await supabase
      .from("reports")
      .select(
        "id,report_date,market_bias,confidence_score,summary,ai_strategy_json,created_at",
      )
      .eq("report_date", reportDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reportResult.error) throw reportResult.error;
    if (!reportResult.data) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: "REPORT_NOT_FOUND",
        report_date: reportDate,
        logs,
      }, 404);
    }

    const reportRow = reportResult.data as Record<string, unknown>;
    const existingAiStrategy = asObject(reportRow.ai_strategy_json);
    const existingReviewResult = await supabase
      .from("close_market_reviews")
      .select("id,verification_result,raw_payload,updated_at,created_at")
      .eq("report_date", reportDate)
      .maybeSingle();
    if (existingReviewResult.error) throw existingReviewResult.error;

    const existingReview = existingReviewResult.data as
      | Record<string, unknown>
      | null;
    const existingResult = String(existingReview?.verification_result || "")
      .trim();
    const existingReportResult = String(
      asObject(existingAiStrategy.close_validation).result || "",
    ).trim();
    const existingIsFinal = Boolean(
      existingResult && existingResult !== "資料不足" &&
        existingResult !== "待確認",
    );
    const reportIsFinal = Boolean(
      existingReportResult && existingReportResult !== "資料不足" &&
        existingReportResult !== "待確認",
    );
    const strictProvenance = existingReview
      ? hasStrictCloseProvenance(existingReview.raw_payload, reportDate)
      : false;

    if (!isForce && existingIsFinal && strictProvenance) {
      return jsonResponse({
        success: true,
        version: VERSION,
        action: "skipped_idempotent",
        report_date: reportDate,
        logs,
      });
    }
    if (
      !isForce &&
      ((existingIsFinal && !strictProvenance) ||
        (!existingReview && reportIsFinal))
    ) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: "EXISTING_REVIEW_REQUIRES_EXPLICIT_CORRECTION",
        correction_strategy:
          `after separate approval call ?force=true&report_date=${reportDate}`,
        historical_row_modified: false,
        report_date: reportDate,
        logs,
      }, 409);
    }

    const premarketBias = String(reportRow.market_bias || "");
    const premarketConfidence = Number(reportRow.confidence_score || 0);
    const premarketSummary = String(reportRow.summary || "");
    const closeResult = classifyCloseResult(taiexChange);
    const verification = generateVerification(
      premarketBias,
      closeResult,
      taiexChange,
      tsmcChange,
    );
    const now = new Date().toISOString();
    const snapshotProvenance = acceptedRows.map((row) => ({
      symbol: row.symbol,
      captured_at: row.captured_at,
      source: row.source || null,
    }));

    const closeMarketReview = {
      version: VERSION,
      report_date: reportDate,
      generated_at: now,
      premarket_bias: premarketBias,
      premarket_confidence: premarketConfidence,
      premarket_summary: premarketSummary,
      actual_market_result: closeResult,
      verification_result: verification.validation_result,
      verification_note: verification.summary,
      taiex_change: taiexChange,
      tsmc_change: tsmcChange,
      txf_change: txfChange,
      data_quality: "高可信",
      data_source: "market_data_snapshots phase=close",
      missing_data: [],
      latest_market_rows: snapshotProvenance,
    };
    const closeValidation = {
      version: VERSION,
      result: verification.validation_result,
      label: verification.validation_result,
      summary: verification.summary,
      close_result: closeResult,
      premarket_bias: premarketBias,
      taiex_change: taiexChange,
      tsmc_change: tsmcChange,
      txf_change: txfChange,
      data_quality: "高可信",
      generated_at: now,
      missing_data: [],
      data_source: "market_data_snapshots phase=close",
    };
    const rawPayload = {
      version: VERSION,
      request_id: requestId,
      source_table: "market_data_snapshots",
      source_phase: "close",
      trading_date: reportDate,
      close_window: "13:30-15:30 Asia/Taipei",
      no_intraday_fallback: true,
      force_overwrite: isForce,
      snapshots: snapshotProvenance,
    };

    const upsertResult = await supabase
      .from("close_market_reviews")
      .upsert({
        report_date: reportDate,
        premarket_bias: premarketBias,
        premarket_confidence: premarketConfidence,
        premarket_summary: premarketSummary,
        taiex_change: taiexChange,
        tsmc_change: tsmcChange,
        txf_change: txfChange,
        actual_market_result: closeResult,
        verification_result: verification.validation_result,
        verification_label: verification.validation_result,
        verification_note: verification.summary,
        data_quality: "高可信",
        missing_data: [],
        raw_payload: rawPayload,
        updated_at: now,
      }, { onConflict: "report_date" });
    if (upsertResult.error) throw upsertResult.error;

    const reportUpdateResult = await supabase
      .from("reports")
      .update({
        ai_strategy_json: {
          ...existingAiStrategy,
          close_market_review: closeMarketReview,
          close_validation: closeValidation,
          close_review_synced_at: now,
          close_review_source: "close-market-review",
        },
      })
      .eq("id", reportRow.id);
    if (reportUpdateResult.error) throw reportUpdateResult.error;

    return jsonResponse({
      success: true,
      version: VERSION,
      action: isForce ? "force_corrected_and_synced" : "written_and_synced",
      report_date: reportDate,
      close_result: closeResult,
      validation_result: verification.validation_result,
      taiex_change: taiexChange,
      tsmc_change: tsmcChange,
      txf_change: txfChange,
      source_table: "market_data_snapshots",
      source_phase: "close",
      synced_to_reports_ai_strategy_json: true,
      duration_ms: Date.now() - startTime,
      logs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FATAL: ${message}`);
    return jsonResponse({
      success: false,
      version: VERSION,
      error: message,
      logs,
    }, 500);
  }
});
