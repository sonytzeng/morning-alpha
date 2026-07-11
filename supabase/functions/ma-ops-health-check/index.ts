import { createClient, type SupabaseClient as SupabaseClientType } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "MA_OPS_P1_V1";
const QUERY_TIMEOUT_MS = 3000;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

const ENVIRONMENTS = ["production", "staging", "development"] as const;
const CHECK_TYPES = ["full", "premarket", "report", "opening", "intraday", "closing", "performance", "synthetic"] as const;
const CHECK_NAMES = [
  "market-data-freshness",
  "daily-report-exists",
  "daily-report-date-consistency",
  "daily-report-contract",
  "opening-radar-exists",
  "opening-radar-freshness",
  "war-room-contract",
  "closing-verification-status",
  "performance-source-availability",
  "public-site-synthetic-config",
  "line-push-delivery",
] as const;
const CHECKS_BY_TYPE: Record<CheckType, CheckName[]> = {
  full: [...CHECK_NAMES],
  premarket: ["market-data-freshness", "daily-report-exists"],
  report: ["daily-report-exists", "daily-report-date-consistency", "daily-report-contract"],
  opening: ["market-data-freshness", "opening-radar-exists", "opening-radar-freshness", "war-room-contract"],
  intraday: ["market-data-freshness", "opening-radar-freshness", "war-room-contract"],
  closing: ["closing-verification-status", "line-push-delivery"],
  performance: ["closing-verification-status", "performance-source-availability"],
  synthetic: ["public-site-synthetic-config"],
};

type Environment = typeof ENVIRONMENTS[number];
type CheckType = typeof CHECK_TYPES[number];
type CheckName = typeof CHECK_NAMES[number];
type CheckStatus = "passed" | "warning" | "failed" | "skipped";
type Severity = "info" | "warning" | "critical";
type JsonObject = Record<string, unknown>;

interface GenericTable {
  Row: JsonObject;
  Insert: JsonObject;
  Update: JsonObject;
  Relationships: [];
}

interface Database {
  public: {
    Tables: {
      reports: GenericTable;
      market_data_snapshots: GenericTable;
      opening_market_radar: GenericTable;
      ma_ops_runs: GenericTable;
      ma_ops_checks: GenericTable;
    };
    Views: Record<string, never>;
    Functions: {
      get_public_performance_journal: {
        Args: { p_limit: number };
        Returns: JsonObject[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

interface HealthRequest {
  environment: Environment;
  check_type: CheckType;
  target_date: string;
  dry_run: boolean;
  components: CheckName[] | null;
  request_id: string | null;
}

interface CheckResult {
  component: string;
  check_name: CheckName;
  status: CheckStatus;
  severity: Severity;
  expected_state: JsonObject;
  actual_state: JsonObject;
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  metadata: JsonObject;
}

interface SummaryCounts {
  passed: number;
  warning: number;
  failed: number;
  skipped: number;
}

interface IdempotentRunRow {
  id: string;
  status: "running" | "passed" | "warning" | "failed" | "skipped";
  details_json: unknown;
}

interface ExistingRunResponse {
  body: JsonObject;
  httpStatus: 200 | 202;
}

type SupabaseClient = SupabaseClientType<Database>;
type CheckHandler = (context: CheckContext) => Promise<CheckResult>;

interface CheckContext {
  supabase: SupabaseClient;
  targetDate: string;
}

class RequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function jsonResponse(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

async function constantTimeSecretMatch(presented: string | null, expected: string | null): Promise<boolean> {
  const encoder = new TextEncoder();
  const presentedBytes = encoder.encode(presented ?? "");
  const expectedBytes = encoder.encode(expected ?? "");
  const [presentedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", presentedBytes),
    crypto.subtle.digest("SHA-256", expectedBytes),
  ]);
  const presentedHash = new Uint8Array(presentedDigest);
  const expectedHash = new Uint8Array(expectedDigest);
  let mismatch = (presented === null ? 1 : 0) |
    (expected === null || expected.length === 0 ? 1 : 0) |
    (presentedBytes.length ^ expectedBytes.length);
  for (let index = 0; index < presentedHash.length; index += 1) {
    mismatch |= presentedHash[index] ^ expectedHash[index];
  }
  return mismatch === 0;
}

function getTaipeiDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseRequest(value: unknown): HealthRequest {
  const body = asObject(value);
  const environment = String(body.environment || "production");
  const checkType = String(body.check_type || "full");
  const targetDate = String(body.target_date || getTaipeiDateString());
  const dryRun = body.dry_run === true;
  const requestId = body.request_id === undefined || body.request_id === null ? null : String(body.request_id).trim();

  if (!ENVIRONMENTS.includes(environment as Environment)) throw new RequestError("INVALID_REQUEST", "Invalid environment");
  if (!CHECK_TYPES.includes(checkType as CheckType)) throw new RequestError("INVALID_REQUEST", "Invalid check_type");
  if (!isValidDate(targetDate)) throw new RequestError("INVALID_TARGET_DATE", "target_date must be YYYY-MM-DD");
  if (requestId !== null && (!requestId || requestId.length > 160)) throw new RequestError("INVALID_REQUEST", "Invalid request_id");
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") throw new RequestError("INVALID_REQUEST", "dry_run must be a boolean");

  let components: CheckName[] | null = null;
  if (body.components !== undefined) {
    if (!Array.isArray(body.components)) throw new RequestError("INVALID_REQUEST", "components must be an array");
    if (body.components.length === 0) throw new RequestError("INVALID_REQUEST", "components must not be empty");
    const requested = body.components.map((item) => String(item));
    if (requested.some((item) => !CHECK_NAMES.includes(item as CheckName))) {
      throw new RequestError("INVALID_REQUEST", "components contains an unknown key");
    }
    components = Array.from(new Set(requested)) as CheckName[];
  }

  return {
    environment: environment as Environment,
    check_type: checkType as CheckType,
    target_date: targetDate,
    dry_run: dryRun,
    components,
    request_id: requestId,
  };
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DEPENDENCY_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function makeCheck(
  checkName: CheckName,
  component: string,
  status: CheckStatus,
  severity: Severity,
  expectedState: JsonObject,
  actualState: JsonObject,
  startedAt: number,
  errorCode: string | null = null,
  errorMessage: string | null = null,
  metadata: JsonObject = {},
): CheckResult {
  return {
    component,
    check_name: checkName,
    status,
    severity,
    expected_state: expectedState,
    actual_state: actualState,
    latency_ms: Math.max(0, Date.now() - startedAt),
    error_code: errorCode,
    error_message: errorMessage,
    metadata,
  };
}

function skipped(checkName: CheckName, component: string, reason: string): CheckResult {
  return makeCheck(
    checkName,
    component,
    "skipped",
    "info",
    {},
    {},
    Date.now(),
    "CHECK_NOT_IMPLEMENTABLE_FROM_CURRENT_SCHEMA",
    reason,
  );
}

async function fetchReport(supabase: SupabaseClient, targetDate: string): Promise<JsonObject | null> {
  const result = await withTimeout(supabase
    .from("reports")
    .select("id,report_date,market_bias,confidence_score,report_mode,ai_strategy_json,created_at,updated_at")
    .eq("report_date", targetDate)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle());
  if (result.error) throw new Error("DATABASE_QUERY_FAILED");
  return result.data ? result.data as JsonObject : null;
}

const handlers: Record<CheckName, CheckHandler> = {
  "market-data-freshness": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const result = await withTimeout(supabase
      .from("market_data_snapshots")
      .select("symbol,trading_date,phase,captured_at,source")
      .eq("trading_date", targetDate)
      .order("captured_at", { ascending: false })
      .limit(50));
    if (result.error) throw new Error("DATABASE_QUERY_FAILED");
    const rows = Array.isArray(result.data) ? result.data as JsonObject[] : [];
    const phases = Array.from(new Set(rows.map((row) => String(row.phase || "")).filter(Boolean)));
    const symbols = Array.from(new Set(rows.map((row) => String(row.symbol || "")).filter(Boolean)));
    const latest = rows[0]?.captured_at ? String(rows[0].captured_at) : null;
    return makeCheck(
      "market-data-freshness", "market-data", rows.length > 0 ? "passed" : "failed", rows.length > 0 ? "info" : "critical",
      { trading_date: targetDate, minimum_rows: 1 },
      { trading_date: targetDate, row_count: rows.length, phases, symbol_count: symbols.length, latest_captured_at: latest },
      started, rows.length > 0 ? null : "DATABASE_QUERY_FAILED", rows.length > 0 ? null : "No market snapshot is available for target_date",
    );
  },

  "daily-report-exists": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const report = await fetchReport(supabase, targetDate);
    return makeCheck(
      "daily-report-exists", "daily-report", report ? "passed" : "failed", report ? "info" : "critical",
      { report_date: targetDate, exists: true },
      { report_date: report?.report_date || null, exists: Boolean(report) },
      started, report ? null : "REPORT_MISSING", report ? null : "Daily report is missing",
    );
  },

  "daily-report-date-consistency": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const report = await fetchReport(supabase, targetDate);
    if (!report) return makeCheck("daily-report-date-consistency", "daily-report", "skipped", "info", { target_date: targetDate }, {}, started, "REPORT_MISSING", "Date consistency cannot be checked without a report");
    const ai = asObject(report.ai_strategy_json);
    const nestedDates = [ai.report_date, ai.today_date].filter(nonEmptyString).map(String);
    const mismatches = nestedDates.filter((date) => date !== targetDate);
    return makeCheck(
      "daily-report-date-consistency", "daily-report", mismatches.length === 0 ? "passed" : "failed", mismatches.length === 0 ? "info" : "critical",
      { report_date: targetDate, nested_dates_match_when_present: true },
      { report_date: report.report_date, nested_dates: nestedDates, mismatch_count: mismatches.length },
      started, mismatches.length === 0 ? null : "REPORT_DATE_MISMATCH", mismatches.length === 0 ? null : "Report date fields are inconsistent",
    );
  },

  "daily-report-contract": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const report = await fetchReport(supabase, targetDate);
    if (!report) return makeCheck("daily-report-contract", "daily-report", "skipped", "info", {}, {}, started, "REPORT_MISSING", "Contract cannot be checked without a report");
    const ai = asObject(report.ai_strategy_json);
    const missing = [
      !nonEmptyString(report.market_bias) ? "market_bias" : null,
      report.confidence_score === null || report.confidence_score === undefined || !Number.isFinite(Number(report.confidence_score)) ? "confidence_score" : null,
      Object.keys(ai).length === 0 ? "ai_strategy_json" : null,
      !nonEmptyString(report.report_mode) && !nonEmptyString(ai.report_mode) ? "report_mode" : null,
      typeof ai.is_trading_day !== "boolean" ? "ai_strategy_json.is_trading_day" : null,
      !nonEmptyString(ai.market_status) ? "ai_strategy_json.market_status" : null,
    ].filter((item): item is string => item !== null);
    return makeCheck(
      "daily-report-contract", "daily-report", missing.length === 0 ? "passed" : "failed", missing.length === 0 ? "info" : "critical",
      { required_fields: ["market_bias", "confidence_score", "ai_strategy_json", "report_mode", "is_trading_day", "market_status"] },
      { missing_fields: missing, report_mode: report.report_mode || ai.report_mode || null, is_trading_day: ai.is_trading_day ?? null, market_status: ai.market_status || null },
      started, missing.length === 0 ? null : "REPORT_CONTRACT_INVALID", missing.length === 0 ? null : "Daily report contract is incomplete",
    );
  },

  "opening-radar-exists": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const result = await withTimeout(supabase.from("opening_market_radar").select("id,report_date,radar_status,captured_at").eq("report_date", targetDate).limit(1).maybeSingle());
    if (result.error) throw new Error("DATABASE_QUERY_FAILED");
    const row = result.data ? result.data as JsonObject : null;
    return makeCheck(
      "opening-radar-exists", "opening-radar", row ? "passed" : "failed", row ? "info" : "warning",
      { report_date: targetDate, exists: true }, { exists: Boolean(row), report_date: row?.report_date || null, radar_status: row?.radar_status || null },
      started, row ? null : "RADAR_MISSING", row ? null : "Opening radar is missing",
    );
  },

  "opening-radar-freshness": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const result = await withTimeout(supabase
      .from("opening_market_radar")
      .select("report_date,captured_at,market_data_date,data_status,radar_mode,input_source")
      .eq("report_date", targetDate)
      .limit(1)
      .maybeSingle());
    if (result.error) throw new Error("DATABASE_QUERY_FAILED");
    const row = result.data ? result.data as JsonObject : null;
    if (!row) return makeCheck("opening-radar-freshness", "opening-radar", "skipped", "info", {}, {}, started, "RADAR_MISSING", "Freshness cannot be checked without radar data");
    const consistent = String(row.report_date || "") === targetDate && String(row.market_data_date || "") === targetDate && nonEmptyString(row.captured_at);
    return makeCheck(
      "opening-radar-freshness", "opening-radar", consistent ? "passed" : "failed", consistent ? "info" : "warning",
      { report_date: targetDate, market_data_date: targetDate, captured_at_present: true },
      { report_date: row.report_date || null, market_data_date: row.market_data_date || null, captured_at: row.captured_at || null, data_status: row.data_status || null, radar_mode: row.radar_mode || null, input_source: row.input_source || null },
      started, consistent ? null : "RADAR_STALE", consistent ? null : "Opening radar source date is stale or incomplete",
    );
  },

  "war-room-contract": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const report = await fetchReport(supabase, targetDate);
    if (!report) return makeCheck("war-room-contract", "war-room", "skipped", "info", {}, {}, started, "REPORT_MISSING", "War Room cannot be checked without a report");
    const ai = asObject(report.ai_strategy_json);
    const warRoom = asObject(ai.war_room);
    const required = ["decision_step", "next_role", "confirmation_checklist", "risk_checklist", "capital_rotation_path", "external_priority", "decision_confidence"];
    const missing = required.filter((key) => ai[key] === undefined && warRoom[key] === undefined);
    return makeCheck(
      "war-room-contract", "war-room", missing.length === 0 ? "passed" : "failed", missing.length === 0 ? "info" : "warning",
      { required_fields: required }, { missing_fields: missing, source: Object.keys(warRoom).length > 0 ? "ai_strategy_json.war_room_or_root" : "ai_strategy_json" },
      started, missing.length === 0 ? null : "WAR_ROOM_CONTRACT_INVALID", missing.length === 0 ? null : "War Room contract is incomplete",
    );
  },

  "closing-verification-status": async ({ supabase, targetDate }) => {
    const started = Date.now();
    const report = await fetchReport(supabase, targetDate);
    if (!report) return makeCheck("closing-verification-status", "closing-verification", "skipped", "info", {}, {}, started, "REPORT_MISSING", "Closing verification cannot be checked without a report");
    const verification = asObject(asObject(report.ai_strategy_json).closing_verification_v2);
    if (Object.keys(verification).length === 0) return makeCheck("closing-verification-status", "closing-verification", "warning", "warning", { status: "completed" }, { status: null }, started, "CLOSING_VERIFICATION_PENDING", "closing_verification_v2 is missing");
    const status = String(verification.status || "").toLowerCase();
    const completed = status === "completed" || status === "direction_completed_data_degraded";
    return makeCheck(
      "closing-verification-status", "closing-verification", completed ? "passed" : "warning", completed ? "info" : "warning",
      { status: ["completed", "direction_completed_data_degraded"] },
      { status: verification.status || null, data_status: verification.data_status || null, report_date: verification.report_date || null, no_fake_data: verification.no_fake_data ?? null },
      started, completed ? null : "CLOSING_VERIFICATION_PENDING", completed ? null : "Closing verification is pending",
    );
  },

  "performance-source-availability": async ({ supabase }) => {
    const started = Date.now();
    const result = await withTimeout(supabase.rpc("get_public_performance_journal", { p_limit: 1 }));
    if (result.error) return makeCheck("performance-source-availability", "performance", "failed", "warning", { rpc: "get_public_performance_journal", callable: true }, { callable: false }, started, "PERFORMANCE_SOURCE_UNAVAILABLE", "Performance RPC is unavailable");
    const rows = Array.isArray(result.data) ? result.data : [];
    return makeCheck("performance-source-availability", "performance", "passed", "info", { rpc: "get_public_performance_journal", callable: true }, { callable: true, returned_rows: rows.length }, started);
  },

  "public-site-synthetic-config": async () => {
    const started = Date.now();
    const configured = Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("SITE_URL") || "";
    let valid = false;
    try {
      const url = new URL(configured);
      valid = url.protocol === "https:" && Boolean(url.hostname);
    } catch {
      valid = false;
    }
    return makeCheck(
      "public-site-synthetic-config", "public-site", valid ? "passed" : "skipped", valid ? "info" : "warning",
      { configured_https_url: true, external_request_performed: false }, { configured: Boolean(configured), valid_https_url: valid, external_request_performed: false },
      started, valid ? null : "CHECK_NOT_IMPLEMENTABLE_FROM_CURRENT_SCHEMA", valid ? null : "PUBLIC_SITE_URL or SITE_URL is not configured",
    );
  },

  "line-push-delivery": async () => skipped(
    "line-push-delivery",
    "line-push",
    "P1 does not have a verified audience baseline or delivery natural key; no delivery success is inferred",
  ),
};

async function runCheck(name: CheckName, context: CheckContext): Promise<CheckResult> {
  const started = Date.now();
  try {
    return await handlers[name](context);
  } catch (error) {
    const code = error instanceof Error && error.message === "DEPENDENCY_TIMEOUT" ? "DATABASE_QUERY_FAILED" : "DATABASE_QUERY_FAILED";
    return makeCheck(name, name, "failed", "warning", {}, {}, started, code, "The check query failed", {
      timeout: error instanceof Error && error.message === "DEPENDENCY_TIMEOUT",
    });
  }
}

function summarize(checks: CheckResult[]): SummaryCounts {
  return checks.reduce<SummaryCounts>((summary, check) => {
    summary[check.status] += 1;
    return summary;
  }, { passed: 0, warning: 0, failed: 0, skipped: 0 });
}

function deriveRunState(checks: CheckResult[]): { status: "passed" | "warning" | "failed"; severity: Severity } {
  if (checks.some((check) => check.status === "failed" && check.severity === "critical")) return { status: "failed", severity: "critical" };
  if (checks.length > 0 && checks.every((check) => check.status === "skipped")) return { status: "warning", severity: "warning" };
  if (checks.some((check) => check.status === "failed" || check.status === "warning")) return { status: "warning", severity: "warning" };
  return { status: "passed", severity: "info" };
}

function responseBody(request: HealthRequest, runId: string | null, checks: CheckResult[], generatedAt: string): JsonObject {
  const state = deriveRunState(checks);
  return {
    ok: true,
    run_id: runId,
    environment: request.environment,
    check_type: request.check_type,
    target_date: request.target_date,
    status: state.status,
    severity: state.severity,
    summary: summarize(checks),
    checks,
    recovery_attempted: false,
    generated_at: generatedAt,
  };
}

async function findIdempotentRun(supabase: SupabaseClient, key: string): Promise<IdempotentRunRow | null> {
  const runResult = await withTimeout(supabase
    .from("ma_ops_runs")
    .select("id,status,details_json")
    .eq("idempotency_key", key)
    .limit(1)
    .maybeSingle());
  if (runResult.error) throw new Error("DATABASE_QUERY_FAILED");
  if (!runResult.data) return null;
  const row = runResult.data as JsonObject;
  const status = String(row.status || "");
  if (!["running", "passed", "warning", "failed", "skipped"].includes(status)) return null;
  return {
    id: String(row.id || ""),
    status: status as IdempotentRunRow["status"],
    details_json: row.details_json,
  };
}

function existingRunResponse(request: HealthRequest, row: IdempotentRunRow): ExistingRunResponse {
  if (row.status === "running") {
    return {
      httpStatus: 202,
      body: {
        ok: true,
        run_id: row.id,
        environment: request.environment,
        check_type: request.check_type,
        target_date: request.target_date,
        status: "running",
        severity: "info",
        summary: { passed: 0, warning: 0, failed: 0, skipped: 0 },
        checks: [],
        recovery_attempted: false,
        generated_at: new Date().toISOString(),
        in_progress: true,
        error_code: "IDEMPOTENT_RUN_IN_PROGRESS",
      },
    };
  }
  const details = asObject(row.details_json);
  return {
    httpStatus: 200,
    body: {
      ...details,
      idempotency_reused: true,
      error_code: "IDEMPOTENT_RESULT_REUSED",
      metadata: { idempotency_code: "IDEMPOTENT_RESULT_REUSED" },
    },
  };
}

async function persistAuditResult(
  supabase: SupabaseClient,
  runId: string,
  checks: CheckResult[],
  response: JsonObject,
  state: { status: "passed" | "warning" | "failed"; severity: Severity },
): Promise<void> {
  let finalized = false;
  let failureStage = "checks_insert";
  try {
    const checkRows = checks.map((check) => ({
      run_id: runId,
      component: check.component,
      check_name: check.check_name,
      expected_state: check.expected_state,
      actual_state: check.actual_state,
      status: check.status,
      severity: check.severity,
      latency_ms: check.latency_ms,
      error_code: check.error_code,
      error_message: check.error_message,
      metadata_json: check.metadata,
    }));
    const checksInsert = await supabase.from("ma_ops_checks").insert(checkRows);
    if (checksInsert.error) throw new Error("DATABASE_QUERY_FAILED");

    failureStage = "run_finalize";
    const summary = summarize(checks);
    const completed = await supabase.from("ma_ops_runs").update({
      completed_at: new Date().toISOString(),
      status: state.status,
      severity: state.severity,
      summary: `passed=${summary.passed}, warning=${summary.warning}, failed=${summary.failed}, skipped=${summary.skipped}`,
      details_json: response,
      recovery_attempted: false,
    }).eq("id", runId);
    if (completed.error) throw new Error("DATABASE_QUERY_FAILED");
    finalized = true;
  } catch {
    // The finally block performs the single best-effort convergence write.
  } finally {
    if (!finalized) {
      await supabase.from("ma_ops_runs").update({
        completed_at: new Date().toISOString(),
        status: "failed",
        severity: "critical",
        summary: `MA-Ops audit persistence failed at ${failureStage}`,
        details_json: {
          ok: false,
          run_id: runId,
          error_code: "AUDIT_PERSISTENCE_FAILED",
          persistence_stage: failureStage,
          recovery_attempted: false,
        },
        recovery_attempted: false,
      }).eq("id", runId);
    }
  }
  if (!finalized) throw new Error("DATABASE_QUERY_FAILED");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error_code: "INVALID_REQUEST", message: "Only POST is allowed", request_id: null }, 405);

  let requestId: string | null = null;
  try {
    const expectedSecret = Deno.env.get("CRON_SECRET") ?? null;
    const presentedSecret = req.headers.get("x-cron-secret");
    if (!await constantTimeSecretMatch(presentedSecret, expectedSecret)) {
      return jsonResponse({ ok: false, error_code: "UNAUTHORIZED", message: "Unauthorized", request_id: null }, 401);
    }

    const rawBody = await req.text();
    if (rawBody.length > 65536) throw new RequestError("INVALID_REQUEST", "Request body is too large");
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new RequestError("INVALID_REQUEST", "Request body must be valid JSON");
    }
    const request = parseRequest(parsedBody);
    requestId = request.request_id;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("INTERNAL_ERROR");
    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const idempotencyKey = request.request_id
      ? `maops:p1:${request.environment}:${request.check_type}:${request.target_date}:${request.request_id}`
      : null;
    if (!request.dry_run && idempotencyKey) {
      const existing = await findIdempotentRun(supabase, idempotencyKey);
      if (existing) {
        const result = existingRunResponse(request, existing);
        return jsonResponse(result.body, result.httpStatus);
      }
    }

    const selected = request.components ?? CHECKS_BY_TYPE[request.check_type];
    const generatedAt = new Date().toISOString();
    if (request.dry_run) {
      const checks = await Promise.all(selected.map((name) => runCheck(name, { supabase, targetDate: request.target_date })));
      return jsonResponse(responseBody(request, null, checks, generatedAt));
    }

    const initial = await supabase.from("ma_ops_runs").insert({
      environment: request.environment,
      check_type: request.check_type,
      started_at: generatedAt,
      status: "running",
      severity: "info",
      summary: "MA-Ops P1 health check running",
      details_json: { version: VERSION, target_date: request.target_date },
      recovery_attempted: false,
      idempotency_key: idempotencyKey,
    }).select("id").single();

    if (initial.error || !initial.data) {
      if (idempotencyKey) {
        const existing = await findIdempotentRun(supabase, idempotencyKey);
        if (existing) {
          const result = existingRunResponse(request, existing);
          return jsonResponse(result.body, result.httpStatus);
        }
      }
      throw new Error("DATABASE_QUERY_FAILED");
    }

    const runId = String((initial.data as JsonObject).id);
    let persistenceStarted = false;
    try {
      const checks = await Promise.all(selected.map((name) => runCheck(name, { supabase, targetDate: request.target_date })));
      const state = deriveRunState(checks);
      const response = responseBody(request, runId, checks, generatedAt);
      persistenceStarted = true;
      await persistAuditResult(supabase, runId, checks, response, state);
      return jsonResponse(response);
    } catch (error) {
      if (!persistenceStarted) {
        await supabase.from("ma_ops_runs").update({
          completed_at: new Date().toISOString(),
          status: "failed",
          severity: "critical",
          summary: "MA-Ops check execution failed before audit persistence",
          details_json: {
            ok: false,
            run_id: runId,
            error_code: "INTERNAL_ERROR",
            persistence_stage: "check_execution",
            recovery_attempted: false,
          },
          recovery_attempted: false,
        }).eq("id", runId);
      }
      throw error;
    }
  } catch (error) {
    const code = error instanceof RequestError ? error.code : error instanceof Error && error.message === "DATABASE_QUERY_FAILED" ? "DATABASE_QUERY_FAILED" : "INTERNAL_ERROR";
    const message = error instanceof RequestError ? error.message : "Health check failed safely";
    const status = code === "INTERNAL_ERROR" || code === "DATABASE_QUERY_FAILED" ? 500 : 400;
    return jsonResponse({ ok: false, error_code: code, message, request_id: requestId }, status);
  }
});
