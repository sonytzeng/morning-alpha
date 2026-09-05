import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { evaluateMatureOutcomes, type OutcomePredictionInput } from "../_shared/signal-lab/forward-outcome-engine.ts";
import { normalizeSymbol } from "../_shared/signal-lab/normalization.ts";
import type { MarketCostConfig, OhlcvBar, SignalLabel } from "../_shared/signal-lab/types.ts";

const VERSION = "SIGNAL_LAB_OUTCOMES_V1";
type JsonRecord = Record<string, unknown>;
type QueryError = { code?: string; message?: string };
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function json(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAllPages(
  fetchPage: (from: number, to: number) => Promise<{ data: JsonRecord[] | null; error: QueryError | null }>,
  maximumPages = 100,
): Promise<{ data: JsonRecord[]; error: QueryError | null }> {
  const rows: JsonRecord[] = [];
  for (let page = 0; page < maximumPages; page += 1) {
    const result = await fetchPage(page * 1000, page * 1000 + 999);
    if (result.error) return { data: [], error: result.error };
    const next = result.data || [];
    rows.push(...next);
    if (next.length < 1000) return { data: rows, error: null };
  }
  return { data: [], error: { code: "OUTCOME_PAGE_LIMIT_EXCEEDED" } };
}

function toBar(row: JsonRecord): OhlcvBar | null {
  const open = number(row.open); const high = number(row.high); const low = number(row.low); const close = number(row.close); const volume = number(row.volume);
  const market = text(row.market);
  if ([open, high, low, close, volume].some((value) => value === null) || !["TWSE", "TPEX", "INDEX"].includes(market)) return null;
  return { symbol: normalizeSymbol(text(row.symbol)), market: market as OhlcvBar["market"], tradingDate: text(row.trading_date), open: open!, high: high!, low: low!, close: close!, volume: volume!, turnover: number(row.turnover), adjustedClose: number(row.adjusted_close), adjustmentStatus: text(row.adjustment_status) as OhlcvBar["adjustmentStatus"], availableAt: text(row.available_at), provider: text(row.provider), sourceDataset: text(row.source_dataset), sourceRef: text(row.source_ref), sourceHash: text(row.source_hash) };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""; const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || ""; const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ success: false, error: "SERVER_CONFIGURATION_MISSING" }, 500);
  const authorization = request.headers.get("Authorization") || ""; const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return json({ success: false, error: "AUTHENTICATION_REQUIRED" }, 401);
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (token !== serviceRoleKey) {
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return json({ success: false, error: "INVALID_SESSION" }, 401);
    const { data: profile } = await service.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (String(profile?.role || "").toLowerCase() !== "admin") return json({ success: false, error: "ADMIN_REQUIRED" }, 403);
  }

  const { data: predictionRows, error: predictionError } = await service.from("signal_lab_signal_predictions").select("prediction_id,symbol,signal_date,signal_timestamp,signal_score,signal_label,strategy_version").order("signal_date", { ascending: true }).limit(200);
  if (predictionError) return json({ success: false, error: "PREDICTION_QUERY_FAILED" }, 500);
  if (!predictionRows?.length) return json({ success: true, version: VERSION, evaluated: 0, written: 0 });
  const ids = predictionRows.map((row: JsonRecord) => text(row.prediction_id));
  const symbols = [...new Set(predictionRows.map((row: JsonRecord) => normalizeSymbol(text(row.symbol))).concat("TAIEX", "TWII", "^TWII"))];
  const minimumDate = predictionRows.reduce((minimum: string, row: JsonRecord) => !minimum || text(row.signal_date) < minimum ? text(row.signal_date) : minimum, "");
  const [existingResult, pricesResult, strategyResult] = await Promise.all([
    service.from("signal_lab_signal_outcomes").select("prediction_id,horizon,status,evidence_hash").in("prediction_id", ids),
    fetchAllPages(async (from, to) => {
      const { data, error } = await service.from("signal_lab_daily_prices").select("provider,source_dataset,market,symbol,trading_date,open,high,low,close,volume,turnover,adjusted_close,adjustment_status,available_at,source_ref,source_hash").in("symbol", symbols).gte("trading_date", minimumDate).order("trading_date", { ascending: true }).range(from, to);
      return { data: data as JsonRecord[] | null, error };
    }),
    service.from("signal_lab_strategy_versions").select("version,market_cost_version").in("version", [...new Set(predictionRows.map((row: JsonRecord) => text(row.strategy_version)))]),
  ]);
  if (existingResult.error || pricesResult.error || strategyResult.error) return json({ success: false, error: "OUTCOME_INPUT_QUERY_FAILED" }, 500);
  const costVersions = [...new Set((strategyResult.data || []).map((row: JsonRecord) => text(row.market_cost_version)).filter(Boolean))];
  const { data: costRows, error: costError } = await service.from("signal_lab_market_cost_configs").select("version,commission_rate,sell_tax_rate,slippage_rate").in("version", costVersions);
  if (costError) return json({ success: false, error: "COST_QUERY_FAILED" }, 500);
  const strategyCost = new Map((strategyResult.data || []).map((row: JsonRecord) => [text(row.version), text(row.market_cost_version)]));
  const costs = new Map((costRows || []).map((row: JsonRecord) => [text(row.version), { version: text(row.version), commissionRate: number(row.commission_rate)!, sellTaxRate: number(row.sell_tax_rate)!, slippageRate: number(row.slippage_rate)! } satisfies MarketCostConfig]));
  const existing = new Set((existingResult.data || []).filter((row: JsonRecord) => row.status === "complete").map((row: JsonRecord) => `${text(row.prediction_id)}:${text(row.horizon)}:${text(row.evidence_hash)}`));
  const bars = (pricesResult.data || []).map((row: JsonRecord) => toBar(row)).filter((row): row is OhlcvBar => row !== null);
  const taiexBars = bars.filter((row) => row.symbol === "TAIEX");
  const evaluatedAt = new Date().toISOString();
  const drafts = [];
  for (const row of predictionRows as JsonRecord[]) {
    const cost = costs.get(strategyCost.get(text(row.strategy_version)) || "");
    if (!cost) continue;
    const prediction: OutcomePredictionInput = { predictionId: text(row.prediction_id), symbol: normalizeSymbol(text(row.symbol)), signalDate: text(row.signal_date), signalTimestamp: text(row.signal_timestamp), signalScore: number(row.signal_score) || 0, signalLabel: text(row.signal_label) as SignalLabel };
    drafts.push(...await evaluateMatureOutcomes(prediction, bars, taiexBars, cost, evaluatedAt));
  }
  const pendingWrites = drafts.filter((draft) => !existing.has(`${draft.predictionId}:${draft.horizon}:${draft.evidenceHash}`));
  if (pendingWrites.length > 0) {
    const { error: writeError } = await service.from("signal_lab_signal_outcomes").upsert(pendingWrites.map((draft) => ({ prediction_id: draft.predictionId, horizon: draft.horizon, maturity_date: draft.maturityDate, status: "complete", forward_return: draft.grossReturn, net_forward_return: draft.netReturn, excess_return_vs_taiex: draft.excessReturnVsTaiex, mfe: draft.mfe, mae: draft.mae, market_cost_version: draft.marketCostVersion, evidence_hash: draft.evidenceHash, evaluated_at: draft.evaluatedAt, updated_at: draft.evaluatedAt })), { onConflict: "prediction_id,horizon" });
    if (writeError) return json({ success: false, error: "OUTCOME_WRITE_FAILED" }, 500);
  }
  return json({ success: true, version: VERSION, evaluated: predictionRows.length, written: pendingWrites.length, idempotent: pendingWrites.length === 0 });
});
