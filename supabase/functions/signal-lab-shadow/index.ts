import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { runDataQualityGate } from "../_shared/signal-lab/data-quality.ts";
import { calculateMarketRegime } from "../_shared/signal-lab/market-regime-engine.ts";
import { buildShadowPrediction, nextCalculationVersion } from "../_shared/signal-lab/shadow-pipeline.ts";
import { sha256Hex } from "../_shared/signal-lab/snapshot-hash.ts";
import { normalizeSymbol, safeRatio } from "../_shared/signal-lab/normalization.ts";
import { parseSignalStrategy } from "../_shared/signal-lab/strategy-contract.ts";
import type { CorporateActionInput, InstitutionalFlowInput, InstitutionType, OhlcvBar, TechnicalScoreResult } from "../_shared/signal-lab/types.ts";

const VERSION = "SIGNAL_LAB_SHADOW_V1";
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

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAllPages(
  fetchPage: (from: number, to: number) => Promise<{ data: JsonRecord[] | null; error: QueryError | null }>,
  pageSize = 1000,
  maximumPages = 250,
): Promise<{ data: JsonRecord[]; error: QueryError | null }> {
  const all: JsonRecord[] = [];
  for (let page = 0; page < maximumPages; page += 1) {
    const from = page * pageSize;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: [], error: result.error };
    const rows = result.data || [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
  return { data: [], error: { code: "INPUT_PAGE_LIMIT_EXCEEDED" } };
}

function latestRevisions(rows: JsonRecord[], keyFor: (row: JsonRecord) => string): JsonRecord[] {
  const latest = new Map<string, JsonRecord>();
  for (const row of rows) {
    const key = keyFor(row);
    const existing = latest.get(key);
    if (!existing || text(row.available_at) > text(existing.available_at)) latest.set(key, row);
  }
  return [...latest.values()];
}

function toPrice(row: JsonRecord): OhlcvBar | null {
  const open = number(row.open); const high = number(row.high); const low = number(row.low); const close = number(row.close); const volume = number(row.volume);
  const market = text(row.market);
  if ([open, high, low, close, volume].some((value) => value === null) || !["TWSE", "TPEX", "INDEX"].includes(market)) return null;
  return {
    symbol: normalizeSymbol(text(row.symbol)), market: market as OhlcvBar["market"], tradingDate: text(row.trading_date),
    open: open!, high: high!, low: low!, close: close!, volume: volume!, turnover: number(row.turnover), adjustedClose: number(row.adjusted_close),
    adjustmentStatus: text(row.adjustment_status) as OhlcvBar["adjustmentStatus"], availableAt: text(row.available_at), provider: text(row.provider), sourceDataset: text(row.source_dataset), sourceRef: text(row.source_ref), sourceHash: text(row.source_hash),
  };
}

function toFlow(row: JsonRecord): InstitutionalFlowInput | null {
  const netVolume = number(row.net_volume); const market = text(row.market); const institutionType = text(row.institution_type);
  if (netVolume === null || !["TWSE", "TPEX"].includes(market) || !["foreign", "trust", "dealer_proprietary", "dealer_hedge"].includes(institutionType)) return null;
  return {
    symbol: normalizeSymbol(text(row.symbol)), market: market as InstitutionalFlowInput["market"], tradingDate: text(row.trading_date),
    institutionType: institutionType as InstitutionalFlowInput["institutionType"], buyVolume: number(row.buy_volume), sellVolume: number(row.sell_volume), netVolume,
    netValue: number(row.net_value), marketVolume: number(row.market_volume), averageVolume20d: number(row.average_volume_20d), averageTurnover20d: number(row.average_turnover_20d),
    availableAt: text(row.available_at), provider: text(row.provider), sourceDataset: text(row.source_dataset), sourceRef: text(row.source_ref), sourceHash: text(row.source_hash),
  };
}

function toAction(row: JsonRecord): CorporateActionInput {
  return { symbol: normalizeSymbol(text(row.symbol)), actionDate: text(row.action_date), actionType: text(row.action_type) as CorporateActionInput["actionType"], adjustmentFactor: number(row.adjustment_factor), availableAt: text(row.available_at), resolved: Boolean(row.resolved), sourceHash: text(row.source_hash) };
}

function taipeiDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function marketFeatureRow(
  symbol: string,
  signalDate: string,
  signalTimestamp: string,
  featureVersion: string,
  sourceSnapshotHash: string,
  symbolBars: OhlcvBar[],
  technical: TechnicalScoreResult,
) {
  const ordered = [...symbolBars].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  const latest = ordered.at(-1);
  if (!latest) return null;
  const closeAt = (offset: number) => ordered.at(-1 - offset)?.adjustedClose ?? ordered.at(-1 - offset)?.close ?? null;
  const returnFor = (days: number) => {
    const prior = closeAt(days); const close = latest.adjustedClose ?? latest.close;
    return prior && prior > 0 ? close / prior - 1 : null;
  };
  const prior20 = ordered.slice(-21, -1);
  const averageVolume20 = prior20.length === 20 ? prior20.reduce((total, bar) => total + bar.volume, 0) / 20 : null;
  return {
    symbol, signal_date: signalDate, signal_timestamp: signalTimestamp, feature_version: featureVersion,
    status: technical.status, close: latest.adjustedClose ?? latest.close, volume: latest.volume,
    relative_volume: averageVolume20 && averageVolume20 > 0 ? latest.volume / averageVolume20 : null,
    return_1d: returnFor(1), return_5d: returnFor(5), return_20d: returnFor(20),
    data_completeness: technical.dataCompleteness, reason_codes: technical.reasonCodes,
    source_snapshot_hash: sourceSnapshotHash, features: {},
  };
}

Deno.serve(async (request: Request) => {
  const startedAtMs = Date.now();
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ success: false, error: "SERVER_CONFIGURATION_MISSING" }, 500);
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return json({ success: false, error: "AUTHENTICATION_REQUIRED" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (token !== serviceRoleKey) {
    const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    if (authError || !authData.user) return json({ success: false, error: "INVALID_SESSION" }, 401);
    const { data: profile } = await service.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
    if (String(profile?.role || "").toLowerCase() !== "admin") return json({ success: false, error: "ADMIN_REQUIRED" }, 403);
  }

  const signalTimestamp = new Date().toISOString();
  const signalDate = taipeiDate();
  const historyStartDate = new Date(`${signalDate}T00:00:00.000Z`);
  historyStartDate.setUTCDate(historyStartDate.getUTCDate() - 180);
  const historyStart = historyStartDate.toISOString().slice(0, 10);
  const { data: strategyRow, error: strategyError } = await service.from("signal_lab_strategy_versions").select("version,feature_version,weights,score_thresholds").eq("status", "shadow").maybeSingle();
  if (strategyError) return json({ success: false, error: "STRATEGY_LOOKUP_FAILED" }, 500);
  if (!strategyRow) return json({ success: false, status: "blocked", error: "NO_ACTIVE_SHADOW_STRATEGY" }, 409);
  const strategy = parseSignalStrategy(strategyRow);
  if (!strategy) return json({ success: false, status: "blocked", error: "INVALID_SHADOW_STRATEGY" }, 409);

  const [pricesResult, flowsResult, universeResult, actionsResult, calendarResult] = await Promise.all([
    fetchAllPages(async (from, to) => {
      const { data, error } = await service.from("signal_lab_daily_prices").select("provider,source_dataset,market,symbol,trading_date,open,high,low,close,volume,turnover,adjusted_close,adjustment_status,available_at,source_ref,source_hash").gte("trading_date", historyStart).lte("trading_date", signalDate).lte("available_at", signalTimestamp).order("trading_date", { ascending: false }).range(from, to);
      return { data: data as JsonRecord[] | null, error };
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await service.from("signal_lab_institutional_inputs").select("provider,source_dataset,market,symbol,trading_date,institution_type,buy_volume,sell_volume,net_volume,net_value,market_volume,average_volume_20d,average_turnover_20d,available_at,source_ref,source_hash").gte("trading_date", historyStart).lte("trading_date", signalDate).lte("available_at", signalTimestamp).order("trading_date", { ascending: false }).range(from, to);
      return { data: data as JsonRecord[] | null, error };
    }),
    fetchAllPages(async (from, to) => {
      const { data, error } = await service.from("signal_lab_universe_memberships").select("provider,market,symbol,listed_from,listed_to,status,available_at,source_ref,source_hash").lte("listed_from", signalDate).or(`listed_to.is.null,listed_to.gte.${signalDate}`).lte("available_at", signalTimestamp).range(from, to);
      return { data: data as JsonRecord[] | null, error };
    }, 1000, 10),
    fetchAllPages(async (from, to) => {
      const { data, error } = await service.from("signal_lab_corporate_actions").select("symbol,action_date,action_type,adjustment_factor,available_at,source_hash,metadata").gte("action_date", historyStart).lte("action_date", signalDate).lte("available_at", signalTimestamp).range(from, to);
      return { data: data as JsonRecord[] | null, error };
    }, 1000, 50),
    fetchAllPages(async (from, to) => {
      const { data, error } = await service.from("signal_lab_trading_calendar").select("provider,market,trading_date,is_trading_day,session_status,available_at,source_ref,source_hash").eq("market", "TWSE").gte("trading_date", historyStart).lte("trading_date", signalDate).lte("available_at", signalTimestamp).order("trading_date", { ascending: false }).range(from, to);
      return { data: data as JsonRecord[] | null, error };
    }, 1000, 10),
  ]);
  const queryFailure = [pricesResult, flowsResult, universeResult, actionsResult, calendarResult].find((result) => result.error);
  if (queryFailure?.error) return json({ success: false, error: "INPUT_QUERY_FAILED" }, 500);
  const canonicalPriceRows = latestRevisions(pricesResult.data || [], (row) => `${normalizeSymbol(text(row.symbol))}:${text(row.trading_date)}`);
  const canonicalFlowRows = latestRevisions(flowsResult.data || [], (row) => `${normalizeSymbol(text(row.symbol))}:${text(row.trading_date)}:${text(row.institution_type)}`);
  const canonicalActionRows = latestRevisions(actionsResult.data || [], (row) => `${normalizeSymbol(text(row.symbol))}:${text(row.action_date)}:${text(row.action_type)}`);
  const canonicalUniverseRows = latestRevisions(universeResult.data || [], (row) => `${text(row.market)}:${normalizeSymbol(text(row.symbol))}:${text(row.listed_from)}`);
  const canonicalCalendarRows = latestRevisions(calendarResult.data || [], (row) => `${text(row.market)}:${text(row.trading_date)}`);
  const bars = canonicalPriceRows.map((row: JsonRecord) => toPrice(row)).filter((row): row is OhlcvBar => row !== null);
  const flows = canonicalFlowRows.map((row: JsonRecord) => toFlow(row)).filter((row): row is InstitutionalFlowInput => row !== null);
  const eligibleSymbols = [...new Set(canonicalUniverseRows.filter((row) => row.status === "listed").map((row) => normalizeSymbol(text(row.symbol))).filter(Boolean))];
  const actions = canonicalActionRows.map((row: JsonRecord) => toAction({ ...row, resolved: Boolean((row.metadata as JsonRecord | null)?.resolved) }));
  const expectedTradingDates = canonicalCalendarRows.filter((row) => row.is_trading_day === true).map((row) => text(row.trading_date)).filter(Boolean).sort();
  const completeSymbols = eligibleSymbols.filter((symbol) => {
    const symbolBars = bars.filter((bar) => bar.symbol === symbol);
    const symbolFlows = flows.filter((flow) => flow.symbol === symbol);
    const latestForeign = symbolFlows.filter((row) => row.institutionType === "foreign").sort((a, b) => b.tradingDate.localeCompare(a.tradingDate))[0];
    const latestTrust = symbolFlows.filter((row) => row.institutionType === "trust").sort((a, b) => b.tradingDate.localeCompare(a.tradingDate))[0];
    return symbolBars.length >= 60 && symbolFlows.filter((row) => row.institutionType === "foreign").length >= 20 && symbolFlows.filter((row) => row.institutionType === "trust").length >= 20
      && Boolean(latestForeign?.marketVolume && latestForeign.averageVolume20d && latestTrust?.marketVolume && latestTrust.averageVolume20d);
  });
  const quality = runDataQualityGate({
    signalTimestamp,
    bars,
    institutionalFlows: flows,
    corporateActions: actions,
    eligibleSymbols,
    completeSymbols,
    tradingCalendarStatus: canonicalCalendarRows.length > 0 ? "ready" : "unavailable",
    expectedTradingDates,
  });
  const crossSectionalRatios = (["foreign", "trust", "dealer_proprietary", "dealer_hedge"] as InstitutionType[]).reduce<Partial<Record<InstitutionType, number[]>>>((cohorts, institutionType) => {
    const latestBySymbol = new Map<string, InstitutionalFlowInput>();
    for (const flow of flows.filter((row) => row.institutionType === institutionType && eligibleSymbols.includes(row.symbol))) {
      const existing = latestBySymbol.get(flow.symbol);
      if (!existing || flow.tradingDate > existing.tradingDate || (flow.tradingDate === existing.tradingDate && flow.availableAt > existing.availableAt)) latestBySymbol.set(flow.symbol, flow);
    }
    cohorts[institutionType] = [...latestBySymbol.values()].map((flow) => safeRatio(flow.netVolume, flow.marketVolume ?? null)).filter((ratio): ratio is number => ratio !== null);
    return cohorts;
  }, {});
  const inputHash = await sha256Hex({
    strategyVersion: strategy.version,
    featureVersion: strategy.featureVersion,
    bars: [...bars].sort((a, b) => `${a.symbol}:${a.tradingDate}:${a.availableAt}:${a.provider}`.localeCompare(`${b.symbol}:${b.tradingDate}:${b.availableAt}:${b.provider}`)),
    flows: [...flows].sort((a, b) => `${a.symbol}:${a.tradingDate}:${a.institutionType}:${a.availableAt}`.localeCompare(`${b.symbol}:${b.tradingDate}:${b.institutionType}:${b.availableAt}`)),
    eligibleSymbols: [...eligibleSymbols].sort(),
    universe: [...canonicalUniverseRows].sort((a, b) => `${text(a.market)}:${text(a.symbol)}:${text(a.listed_from)}:${text(a.available_at)}`.localeCompare(`${text(b.market)}:${text(b.symbol)}:${text(b.listed_from)}:${text(b.available_at)}`)),
    actions: [...actions].sort((a, b) => `${a.symbol}:${a.actionDate}:${a.actionType}:${a.availableAt}`.localeCompare(`${b.symbol}:${b.actionDate}:${b.actionType}:${b.availableAt}`)),
    calendar: [...canonicalCalendarRows].sort((a, b) => `${text(a.trading_date)}:${text(a.available_at)}`.localeCompare(`${text(b.trading_date)}:${text(b.available_at)}`)),
  });
  const { data: existingRun } = await service.from("signal_lab_shadow_runs").select("id,status,prediction_count").eq("run_date", signalDate).eq("strategy_version", strategy.version).eq("input_snapshot_hash", inputHash).maybeSingle();
  if (existingRun) return json({ success: true, version: VERSION, idempotent: true, run: existingRun });

  const taiexBars = bars.filter((bar) => bar.market === "INDEX" && ["TAIEX", "TWII"].includes(bar.symbol));
  const marketRegime = calculateMarketRegime({ signalTimestamp, taiexBars });
  const existingPredictionQuery = completeSymbols.length === 0
    ? { data: [] as JsonRecord[], error: null }
    : await service.from("signal_lab_signal_predictions")
      .select("symbol,source_snapshot_hash,calculation_version")
      .eq("signal_date", signalDate)
      .eq("strategy_version", strategy.version)
      .in("symbol", completeSymbols);
  const { data: existingPredictionRows, error: existingPredictionError } = existingPredictionQuery;
  if (existingPredictionError) return json({ success: false, error: "PREDICTION_IDEMPOTENCY_QUERY_FAILED" }, 500);
  const drafts = [];
  const evaluations = [];
  for (const symbol of completeSymbols) {
    const result = await buildShadowPrediction({ symbol, signalDate, signalTimestamp, bars, institutionalFlows: flows, corporateActions: actions, marketRegime, dataQuality: quality, strategy, crossSectionalRatios });
    evaluations.push({ symbol, result });
    if (result.prediction) {
      const existingForSymbol = (existingPredictionRows || []).filter((row: JsonRecord) => normalizeSymbol(text(row.symbol)) === symbol).map((row: JsonRecord) => ({ sourceSnapshotHash: text(row.source_snapshot_hash), calculationVersion: number(row.calculation_version) || 1 }));
      const version = nextCalculationVersion(existingForSymbol, result.prediction.sourceSnapshotHash);
      if (!version.reused) drafts.push({ ...result.prediction, calculationVersion: version.calculationVersion });
    }
  }
  const duration = Date.now() - startedAtMs;
  const { error: qualityInsertError } = await service.from("signal_lab_data_quality_runs").insert({
    run_date: signalDate, run_timestamp: signalTimestamp, feature_version: strategy.featureVersion, status: quality.status,
    eligible_universe: quality.eligibleUniverse, analyzed_count: quality.analyzedCount, complete_count: quality.completeCount, coverage_ratio: quality.coverageRatio,
    freshness_status: quality.reasonCodes.some((code) => code.includes("STALE")) ? "stale" : "current", missing_count: quality.issues.filter((entry) => entry.code.includes("MISSING") || entry.code.includes("INSUFFICIENT")).length,
    duplicate_count: quality.issues.filter((entry) => entry.code.includes("DUPLICATE")).length, blocked_reason_codes: quality.reasonCodes, source_snapshot_hash: inputHash, compute_duration_ms: duration,
  });
  if (qualityInsertError) return json({ success: false, error: "QUALITY_LEDGER_WRITE_FAILED" }, 500);
  const marketRegimeHash = await sha256Hex({ taiexBars, featureVersion: marketRegime.featureVersion });
  const { error: regimeError } = await service.from("signal_lab_market_regimes").upsert({
    signal_date: signalDate, signal_timestamp: signalTimestamp, feature_version: marketRegime.featureVersion, status: marketRegime.status,
    regime: marketRegime.regime, regime_score: marketRegime.score, confidence: marketRegime.confidence, data_completeness: marketRegime.dataCompleteness,
    reason_codes: marketRegime.reasonCodes, source_snapshot_hash: marketRegimeHash, features: {},
  }, { onConflict: "signal_timestamp,feature_version,source_snapshot_hash", ignoreDuplicates: true });
  if (regimeError) return json({ success: false, error: "MARKET_REGIME_WRITE_FAILED" }, 500);
  const institutionalFeatures = evaluations.flatMap(({ symbol, result }) => result.institutional && result.sourceSnapshotHash ? [{
    symbol, signal_date: signalDate, signal_timestamp: signalTimestamp, feature_version: result.institutional.featureVersion, status: result.institutional.status,
    institutional_score: result.institutional.score, confidence: result.institutional.confidence, data_completeness: result.institutional.dataCompleteness,
    foreign_metrics: result.institutional.foreign || {}, trust_metrics: result.institutional.trust || {},
    dealer_metrics: { proprietary: result.institutional.dealerProprietary, hedge: result.institutional.dealerHedge }, reason_codes: result.institutional.reasonCodes,
    source_snapshot_hash: result.sourceSnapshotHash,
  }] : []);
  const technicalFeatures = evaluations.flatMap(({ symbol, result }) => result.technical && result.sourceSnapshotHash ? [{
    symbol, signal_date: signalDate, signal_timestamp: signalTimestamp, feature_version: result.technical.featureVersion, status: result.technical.status,
    technical_score: result.technical.score, trend_score: result.technical.trendScore, momentum_score: result.technical.momentumScore,
    volume_score: result.technical.volumeScore, volatility_score: result.technical.volatilityScore, structure_score: result.technical.structureScore,
    confidence: result.technical.confidence, data_completeness: result.technical.dataCompleteness, indicators: result.technical.indicators || {},
    reason_codes: result.technical.reasonCodes, source_snapshot_hash: result.sourceSnapshotHash,
  }] : []);
  const marketFeatures = evaluations.flatMap(({ symbol, result }) => {
    if (!result.sourceSnapshotHash || !result.technical) return [];
    const row = marketFeatureRow(symbol, signalDate, signalTimestamp, strategy.featureVersion, result.sourceSnapshotHash, bars.filter((bar) => bar.symbol === symbol), result.technical);
    return row ? [row] : [];
  });
  if (marketFeatures.length > 0) {
    const { error } = await service.from("signal_lab_market_features").upsert(marketFeatures, { onConflict: "symbol,signal_timestamp,feature_version,source_snapshot_hash", ignoreDuplicates: true });
    if (error) return json({ success: false, error: "MARKET_FEATURE_WRITE_FAILED" }, 500);
  }
  if (institutionalFeatures.length > 0) {
    const { error } = await service.from("signal_lab_institutional_features").upsert(institutionalFeatures, { onConflict: "symbol,signal_timestamp,feature_version,source_snapshot_hash", ignoreDuplicates: true });
    if (error) return json({ success: false, error: "INSTITUTIONAL_FEATURE_WRITE_FAILED" }, 500);
  }
  if (technicalFeatures.length > 0) {
    const { error } = await service.from("signal_lab_technical_features").upsert(technicalFeatures, { onConflict: "symbol,signal_timestamp,feature_version,source_snapshot_hash", ignoreDuplicates: true });
    if (error) return json({ success: false, error: "TECHNICAL_FEATURE_WRITE_FAILED" }, 500);
  }
  if (drafts.length > 0) {
    const { error: predictionError } = await service.from("signal_lab_signal_predictions").insert(drafts.map((draft) => ({
      prediction_id: crypto.randomUUID(), symbol: draft.symbol, signal_date: draft.signalDate, signal_timestamp: draft.signalTimestamp,
      signal_score: draft.signalScore, signal_label: draft.signalLabel, institutional_score: draft.institutionalScore, technical_score: draft.technicalScore,
      volume_score: draft.volumeScore, market_regime: draft.marketRegime, market_regime_score: draft.marketRegimeScore, confidence: draft.confidence,
      data_completeness: draft.dataCompleteness, reason_codes: draft.reasonCodes, strategy_version: draft.strategyVersion, feature_version: draft.featureVersion,
      source_snapshot_hash: draft.sourceSnapshotHash, calculation_version: draft.calculationVersion,
    })));
    if (predictionError && predictionError.code !== "23505") return json({ success: false, error: "PREDICTION_WRITE_FAILED" }, 500);
  }
  const runStatus = quality.status === "blocked" || marketRegime.status === "blocked" || marketRegime.status === "unavailable" ? "blocked" : "completed";
  const { data: run, error: runError } = await service.from("signal_lab_shadow_runs").insert({
    run_date: signalDate, started_at: signalTimestamp, completed_at: new Date().toISOString(), strategy_version: strategy.version, feature_version: strategy.featureVersion,
    status: runStatus, eligible_universe: eligibleSymbols.length, analyzed_count: completeSymbols.length, prediction_count: drafts.length,
    input_snapshot_hash: inputHash, blocked_reason_codes: unique([...quality.reasonCodes, ...marketRegime.reasonCodes]), compute_duration_ms: duration,
  }).select("id,status,prediction_count").single();
  if (runError) return json({ success: false, error: "SHADOW_RUN_WRITE_FAILED" }, 500);
  return json({ success: true, version: VERSION, idempotent: false, run });
});

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
