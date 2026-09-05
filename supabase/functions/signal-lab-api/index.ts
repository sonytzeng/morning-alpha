import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { translateReasonCode } from "../_shared/signal-lab/reason-labels.ts";

const VERSION = "SIGNAL_LAB_API_V1";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ success: false, error: "SERVER_CONFIGURATION_MISSING" }, 500);

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) return json({ success: false, error: "AUTHENTICATION_REQUIRED" }, 401);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) return json({ success: false, error: "INVALID_SESSION" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await service.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (profileError) return json({ success: false, error: "ROLE_LOOKUP_FAILED" }, 500);
  if (String(profile?.role || "").toLowerCase() !== "admin") return json({ success: false, error: "ADMIN_REQUIRED" }, 403);

  const [predictions, experiments, quality, shadow] = await Promise.all([
    service.from("signal_lab_signal_predictions").select("prediction_id,symbol,signal_date,signal_score,signal_label,institutional_score,technical_score,volume_score,market_regime,confidence,data_completeness,reason_codes,strategy_version,created_at").order("signal_date", { ascending: false }).order("signal_score", { ascending: false }).limit(50),
    service.from("signal_lab_strategy_experiments").select("id,strategy_version,experiment_name,dataset_start,dataset_end,validity_status,edge_status,bias_flags,metrics,baselines,completed_at").order("created_at", { ascending: false }).limit(20),
    service.from("signal_lab_data_quality_runs").select("id,run_date,run_timestamp,status,eligible_universe,analyzed_count,complete_count,coverage_ratio,freshness_status,missing_count,duplicate_count,blocked_reason_codes,compute_duration_ms").order("run_timestamp", { ascending: false }).limit(20),
    service.from("signal_lab_shadow_runs").select("id,run_date,started_at,completed_at,strategy_version,status,eligible_universe,analyzed_count,prediction_count,blocked_reason_codes,compute_duration_ms,error_code").order("started_at", { ascending: false }).limit(20),
  ]);
  const failed = [predictions, experiments, quality, shadow].find((result) => result.error);
  if (failed?.error) {
    console.error("SIGNAL_LAB_READ_FAILED", failed.error.code);
    return json({ success: false, error: "SIGNAL_LAB_UNAVAILABLE" }, 503);
  }
  const signalRows = (predictions.data || []).map((row: JsonRecord) => ({
    ...row,
    reasons: array(row.reason_codes).map((code) => translateReasonCode(String(code))),
  }));
  return json({
    success: true,
    version: VERSION,
    internal: true,
    disclaimer: "僅供內部研究與前瞻驗證，不構成投資建議。",
    signals: signalRows,
    experiments: experiments.data || [],
    quality: quality.data || [],
    shadowRuns: shadow.data || [],
  });
});
