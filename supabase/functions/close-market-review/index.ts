// V1.5_STRICT_CLOSE_SNAPSHOT
// Repository V1.2 was behind deployed V1.4. This version preserves V1.4 report sync while
// requiring same-day phase=close snapshots and explicit force for legacy correction.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveMarketStatus } from "../_shared/market-status.ts";
import { authorizeInternalRequest, internalCredentialsFromEnv } from "../_shared/internal-function-auth.mjs";
import { isTrustedCloseSnapshot, resolveOpeningPublicationIdentity, validateOpeningPublication, type OpeningPublication } from "../_shared/closing-learning-contract.ts";
import {
  CORE_SYMBOL_ALIASES,
  CORE_SYMBOL_QUERY_ALIASES,
  evaluateCloseSnapshotRows,
  type RuntimeSnapshotRow,
} from "../_shared/intraday-runtime-contract.ts";

const VERSION = "V1.5_STRICT_CLOSE_SNAPSHOT";

function createCloseReviewClient(url: string, key: string) {
  return createClient(url, key);
}

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
  return typeof row.change_percent === "number" && Number.isFinite(row.change_percent) ? row.change_percent : null;
}

async function syncCloseReviewProjection(
  supabase: ReturnType<typeof createCloseReviewClient>, opening: OpeningPublication,
  review: Record<string, unknown>, validation: Record<string, unknown>,
): Promise<void> {
  if (review.report_date !== opening.report_date || review.opening_publication_revision_id !== opening.opening_publication_revision_id
    || validation.opening_publication_revision_id !== opening.opening_publication_revision_id) throw new Error("CLOSE_REVIEW_PROJECTION_UNVERIFIED");
  const current = await supabase.from("reports").select("id,report_date,ai_strategy_json,updated_at")
    .eq("id", opening.report_id).eq("report_date", opening.report_date).maybeSingle();
  if (current.error || !current.data) throw new Error("CLOSE_REVIEW_REPORT_READ_FAILED");
  const identity = resolveOpeningPublicationIdentity(current.data);
  if (identity.reason_codes.length || identity.opening_publication_revision_id !== opening.opening_publication_revision_id) throw new Error("CLOSE_REVIEW_PUBLICATION_CHANGED");
  const ai = asObject(current.data.ai_strategy_json);
  let update = supabase.from("reports").update({ ai_strategy_json: { ...ai,
    close_market_review: review, close_validation: validation,
    close_review_synced_at: review.generated_at, close_review_source: "close-market-review" } }).eq("id", opening.report_id);
  update = current.data.updated_at ? update.eq("updated_at", current.data.updated_at) : update.is("updated_at", null);
  const saved = await update.select("id").maybeSingle();
  if (saved.error || !saved.data) throw new Error("CLOSE_REVIEW_PROJECTION_RETRY_REQUIRED");
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
  openingRevision: string,
): boolean {
  const raw = asObject(rawPayload);
  return raw.source_table === "market_data_snapshots" &&
    raw.source_phase === "close" &&
    raw.trading_date === reportDate &&
    raw.opening_publication_revision_id === openingRevision &&
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = await authorizeInternalRequest(req.headers, internalCredentialsFromEnv());
    if (!auth.ok) {
      return jsonResponse({
        success: false,
        version: VERSION,
        error: auth.error_code,
        error_code: auth.error_code,
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
    const supabase = createCloseReviewClient(supabaseUrl, supabaseServiceRole);

    const snapshotResult = await supabase
      .from("market_data_snapshots")
      .select(
        "symbol,name,value,change_percent,captured_at,source,trading_date,phase,raw",
      )
      .eq("trading_date", reportDate)
      .eq("phase", "close")
      .in("symbol", CORE_SYMBOL_QUERY_ALIASES)
      .order("captured_at", { ascending: false });

    if (snapshotResult.error) throw snapshotResult.error;
    const snapshots = ((snapshotResult.data || []) as RuntimeSnapshotRow[])
      .filter(row => isTrustedCloseSnapshot(row, reportDate));
    const closeEvaluation = evaluateCloseSnapshotRows(snapshots, reportDate);
    if (!closeEvaluation.ready) {
      log(
        `PENDING_REAL_CLOSE_SNAPSHOT missing=${
          closeEvaluation.missingSymbols.join(",") || "out_of_window"
        }`,
      );
      return jsonResponse({
        success: false,
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
      }, 409);
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
    const openingIdentity = resolveOpeningPublicationIdentity(reportRow);
    if (openingIdentity.reason_codes.length > 0) {
      return jsonResponse({ success: false, version: VERSION, error: "OPENING_PUBLICATION_UNVERIFIED",
        report_date: reportDate, reason_codes: openingIdentity.reason_codes, action: "no_write" }, 409);
    }
    const openingSnapshotResult = await supabase.from("decision_snapshots").select("*")
      .eq("id", openingIdentity.opening_publication_revision_id).eq("report_id", openingIdentity.report_id)
      .eq("report_date", reportDate).maybeSingle();
    const publicationResult = await supabase.from("pipeline_runs").select("*")
      .eq("trading_date", reportDate).eq("status", "SUCCEEDED").like("idempotency_key", "research-input:%")
      .eq("provider_status->result->>decision_snapshot_id", openingIdentity.opening_publication_revision_id)
      .order("completed_at", { ascending: true }).limit(1).maybeSingle();
    const openingPublication = validateOpeningPublication({ report: reportRow, snapshot: openingSnapshotResult.data, publicationRun: publicationResult.data });
    if (openingSnapshotResult.error || publicationResult.error || openingPublication.status !== "PUBLISHED") {
      return jsonResponse({ success: false, version: VERSION, error: "OPENING_PUBLICATION_UNVERIFIED",
        report_date: reportDate, reason_codes: openingPublication.reason_codes, action: "no_write" }, 409);
    }
    const openingSnapshot = asObject(openingSnapshotResult.data), openingGenerated = asObject(openingSnapshot.generated_text);
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
      ? hasStrictCloseProvenance(existingReview.raw_payload, reportDate, openingPublication.opening_publication_revision_id)
      : false;

    if (!isForce && existingIsFinal && strictProvenance) {
      const existingRaw = asObject(existingReview?.raw_payload);
      const reviewProjection = asObject(existingRaw.review_projection), validationProjection = asObject(existingRaw.validation_projection);
      if (!Object.keys(reviewProjection).length || !Object.keys(validationProjection).length) {
        return jsonResponse({ success: false, version: VERSION, error: "EXISTING_REVIEW_REQUIRES_EXPLICIT_CORRECTION",
          report_date: reportDate, historical_row_modified: false, action: "no_write" }, 409);
      }
      await syncCloseReviewProjection(supabase, openingPublication, reviewProjection, validationProjection);
      return jsonResponse({
        success: true,
        version: VERSION,
        action: "skipped_idempotent",
        synced_to_reports_ai_strategy_json: true,
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

    const premarketBias = String(openingGenerated.market_bias || openingSnapshot.market_regime || "");
    const confidence = openingGenerated.confidence_score ?? openingSnapshot.confidence_score;
    const premarketConfidence = typeof confidence === "number" && Number.isFinite(confidence) ? confidence : null;
    const premarketSummary = String(openingGenerated.daily_sentence || "");
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
      opening_publication_revision_id: openingPublication.opening_publication_revision_id,
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
      opening_publication_revision_id: openingPublication.opening_publication_revision_id,
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
      opening_publication_revision_id: openingPublication.opening_publication_revision_id,
      opening_decision_snapshot_version: openingPublication.snapshot_version,
      publication_run_id: openingPublication.publication_run_id,
      trading_date: reportDate,
      close_window: "13:30-15:30 Asia/Taipei",
      no_intraday_fallback: true,
      force_overwrite: isForce,
      snapshots: snapshotProvenance,
      review_projection: closeMarketReview,
      validation_projection: closeValidation,
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

    await syncCloseReviewProjection(supabase, openingPublication, closeMarketReview, closeValidation);

    return jsonResponse({
      success: true,
      version: VERSION,
      action: isForce ? "force_corrected_and_synced" : "written_and_synced",
      report_date: reportDate,
      close_result: closeResult,
      validation_result: verification.validation_result,
      opening_publication_revision_id: openingPublication.opening_publication_revision_id,
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
