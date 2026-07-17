import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveMarketStatus } from "../_shared/market-status.ts";
import {
  CORE_SYMBOL_QUERY_ALIASES,
  evaluateIntradayCheckpointRows,
  inferIntradayCheckpoint,
  type IntradayCheckpoint,
  normalizeIntradayCheckpoint,
  type RuntimeSnapshotRow,
} from "../_shared/intraday-runtime-contract.ts";

// ═══════════════════════════════════════════════════════════
// Opening Market Radar V3.2 — checkpoint-scoped freshness validation
// V3.1: Fix summaries — dynamically reference reports.market_bias
//       Remove all hardcoded 「盤前偏多假設失效」「劇本成立一致」「方向一致」
//       premarket_bias ALWAYS from reports.market_bias (sole source of truth)
// ═══════════════════════════════════════════════════════════

const VERSION = "V3.2_CHECKPOINT_FRESHNESS";

function createRuntimeClient(url: string, key: string) {
  return createClient(url, key);
}

type RuntimeClient = ReturnType<typeof createRuntimeClient>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

function getTaiwanDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value || "";
  const m = parts.find((p) => p.type === "month")?.value || "";
  const d = parts.find((p) => p.type === "day")?.value || "";
  return `${y}-${m}-${d}`;
}

function getTaipeiHourMinute(): { hour: number; minute: number } {
  const now = new Date();
  const tw = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return { hour: tw.getHours(), minute: tw.getMinutes() };
}

function parseAiStrategyJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function buildIntradaySyncStatusFromRadar(
  existing: unknown,
  reportDate: string,
  checkpoint: IntradayCheckpoint,
  status: "ready" | "insufficient",
  latestCapturedAt: string | null,
  reason: string,
): Record<string, unknown> {
  const existingSync =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {};
  const existingWindows =
    existingSync.windows && typeof existingSync.windows === "object" &&
      !Array.isArray(existingSync.windows)
      ? existingSync.windows as Record<string, unknown>
      : {};
  const nowIso = new Date().toISOString();
  const windows = {
    "0930": existingWindows["0930"] || "pending",
    "1030": existingWindows["1030"] || "pending",
    "1300": existingWindows["1300"] || "pending",
    [checkpoint]: status,
  };
  const values = Object.values(windows).map(String);
  const warning = values.every((value) => value === "ready")
    ? "盤中資料已同步至最新可用時間窗。"
    : values.includes("insufficient")
    ? `checkpoint ${checkpoint} 缺少同日、同 phase 且在 freshness window 內的完整 TAIEX / TXF / 2330 快照。`
    : "等待下一段盤中資料同步。";
  return {
    ...existingSync,
    report_date: reportDate,
    last_checked_at: nowIso,
    source: "opening_market_radar_refresh",
    checkpoint,
    checkpoint_status: status,
    captured_at: latestCapturedAt,
    windows,
    warning,
    reason,
    ledger_guarantee: false,
  };
}

async function patchReportAfterRadar(
  supabase: RuntimeClient,
  reportDate: string,
  openingRadar: Record<string, unknown> | null,
  checkpoint: IntradayCheckpoint,
  checkpointStatus: "ready" | "insufficient",
  latestCapturedAt: string | null,
  marketDataSource: string,
  checkpointReason: string,
  log: (message: string) => void,
): Promise<{ patched: boolean; error: string | null }> {
  const { data: reportRow, error: reportErr } = await supabase
    .from("reports")
    .select("id, ai_strategy_json")
    .eq("report_date", reportDate)
    .maybeSingle();

  if (reportErr) {
    log(`REPORT_REFRESH_ERROR: ${reportErr.message}`);
    return { patched: false, error: reportErr.message };
  }
  if (!reportRow) {
    log(`REPORT_REFRESH_SKIPPED: no report row for ${reportDate}`);
    return { patched: false, error: "report_not_found" };
  }

  const typedReportRow = reportRow as unknown as Record<string, unknown>;
  const ai = parseAiStrategyJson(typedReportRow.ai_strategy_json);
  const patchedAi: Record<string, unknown> = {
    ...ai,
    intraday_sync_status: buildIntradaySyncStatusFromRadar(
      ai.intraday_sync_status,
      reportDate,
      checkpoint,
      checkpointStatus,
      latestCapturedAt,
      checkpointReason,
    ),
  };

  if (openingRadar) {
    const radarStatus = String(openingRadar.radar_status || "");
    const radarSummary = String(openingRadar.summary || "");
    patchedAi.opening_radar_status = radarStatus;
    patchedAi.opening_radar = openingRadar;
    patchedAi.today_summary = radarSummary || ai.today_summary || ai.summary ||
      "";
    patchedAi.intraday_tracking = {
      ...(ai.intraday_tracking && typeof ai.intraday_tracking === "object" &&
          !Array.isArray(ai.intraday_tracking)
        ? ai.intraday_tracking as Record<string, unknown>
        : {}),
      source: "opening_market_radar",
      checkpoint,
      status: radarStatus,
      market_bias: openingRadar.market_bias,
      confidence_score: openingRadar.confidence_score,
      summary: radarSummary,
      captured_at: latestCapturedAt,
      input_source: marketDataSource,
      updated_at: new Date().toISOString(),
    };
    const observationRoles = Array.isArray(ai.v10_observation_watchlist)
      ? ai.v10_observation_watchlist.filter((item) =>
        item && typeof item === "object" && !Array.isArray(item)
      ) as Record<string, unknown>[]
      : [];
    const role = (name: string) =>
      observationRoles.find((item) => String(item.role || "") === name) || {};
    const mainThesis = role("MAIN_THESIS");
    const confirmation = role("CONFIRMATION");
    const risk = role("RISK");
    const capitalNext = role("CAPITAL_NEXT");
    const external = role("EXTERNAL");
    const previousWarRoom = ai.war_room && typeof ai.war_room === "object" &&
        !Array.isArray(ai.war_room)
      ? ai.war_room as Record<string, unknown>
      : {};

    patchedAi.war_room = {
      ...previousWarRoom,
      source: "opening_market_radar",
      checkpoint,
      status: radarStatus,
      market_bias: openingRadar.market_bias,
      confidence_score: openingRadar.confidence_score,
      summary: radarSummary,
      captured_at: latestCapturedAt,
      input_source: marketDataSource,
      updated_at: new Date().toISOString(),
      decision_step: mainThesis.decision_step ?? 1,
      next_role: mainThesis.next_role ?? "CONFIRMATION",
      confirmation_checklist: confirmation.confirmation_checklist ?? [],
      risk_checklist: risk.risk_checklist ?? [],
      capital_rotation_path: capitalNext.capital_rotation_path ?? [],
      external_priority: external.external_priority ?? [],
      decision_confidence: mainThesis.decision_confidence ??
        openingRadar.confidence_score,
      observation_roles: observationRoles,
    };
  }

  const { error: updateErr } = await supabase
    .from("reports")
    .update({ ai_strategy_json: patchedAi })
    .eq("id", String(typedReportRow.id || ""));

  if (updateErr) {
    log(`REPORT_REFRESH_ERROR: ${updateErr.message}`);
    return { patched: false, error: updateErr.message };
  }

  log(`REPORT_REFRESH_OK: patched reports.ai_strategy_json for ${reportDate}`);
  return { patched: true, error: null };
}

interface MarketDataRow {
  symbol: string;
  name: string;
  value: number;
  change_percent: number;
  captured_at: string;
  source?: string;
  trading_date: string;
  phase: string;
}

interface OpeningRadarResult {
  radar_status: string;
  market_bias: string;
  confidence_score: number;
  summary: string;
  is_premarket_overridden: boolean;
  override_reason: string;
  taiex_change: number | null;
  txf_change: number | null;
  tsmc_change: number | null;
  spx_change: number | null;
  sox_change: number | null;
  vix_change: number | null;
  dxy_change: number | null;
  us10y_change: number | null;
}

function findSymbol(
  data: MarketDataRow[],
  candidates: string[],
): MarketDataRow | null {
  for (const c of candidates) {
    const found = data.find((r) => r.symbol.toUpperCase() === c.toUpperCase());
    if (found) return found;
  }
  return null;
}

function getLatestCapturedAt(data: MarketDataRow[]): string | null {
  let latest = "";
  for (const row of data) {
    if (row.captured_at && (!latest || row.captured_at > latest)) {
      latest = row.captured_at;
    }
  }
  return latest || null;
}

function mapMarketDataRows(
  rows: Record<string, unknown>[] | null | undefined,
): MarketDataRow[] {
  return (rows || []).map((r: Record<string, unknown>) => ({
    symbol: String(r.symbol || ""),
    name: String(r.name || r.symbol || ""),
    value: Number(r.value || 0),
    change_percent: Number(r.change_percent || 0),
    captured_at: String(r.captured_at || ""),
    source: r.source ? String(r.source) : undefined,
    trading_date: String(r.trading_date || ""),
    phase: String(r.phase || ""),
  })).filter((r) => r.symbol && r.captured_at);
}

async function parseRequestBody(
  req: Request,
): Promise<Record<string, unknown>> {
  if (req.method !== "POST") return {};
  try {
    const value = await req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// ═══════════════════════════════════════════════════════════
// V3.1: Dynamic summary builder — references reports.market_bias
// ═══════════════════════════════════════════════════════════

function buildDynamicSummary(
  radarStatus: string,
  premarketBias: string | null,
  isOverridden: boolean,
  taiexChg: number | null,
  txfChg: number | null,
  ts2330Chg: number | null,
): string {
  const bias = (premarketBias || '未標記').trim();
  const dataParts: string[] = [];
  if (taiexChg !== null) dataParts.push(`TAIEX ${taiexChg >= 0 ? '+' : ''}${taiexChg.toFixed(2)}%`);
  if (txfChg !== null) dataParts.push(`TXF ${txfChg >= 0 ? '+' : ''}${txfChg.toFixed(2)}%`);
  if (ts2330Chg !== null) dataParts.push(`2330 ${ts2330Chg >= 0 ? '+' : ''}${ts2330Chg.toFixed(2)}%`);
  const dataStr = dataParts.length > 0 ? `（${dataParts.join('、')}）` : '';

  if (radarStatus === '明顯偏弱') {
    if (isOverridden && premarketBias) {
      return `07:30 盤前原始假設為「${bias}」，開盤後台股明顯轉弱${dataStr}。系統判定：盤前假設已被推翻，今日以風險控管為主。`;
    }
    return `開盤後台股明顯轉弱${dataStr}，今日以風險控管為主。盤前原始假設為「${bias}」。`;
  }

  if (radarStatus === '盤中轉弱') {
    if (isOverridden && premarketBias) {
      return `07:30 盤前原始假設為「${bias}」，開盤後實際走勢轉弱${dataStr}。系統判定：盤前假設已被推翻，今日改以風險觀察為主。`;
    }
    return `開盤後實際走勢轉弱${dataStr}，今日以風險觀察為主。盤前原始假設為「${bias}」。`;
  }

  if (radarStatus === '偏強確認') {
    if (premarketBias && premarketBias !== '未標記') {
      const isMatch = premarketBias.includes('多');
      if (isMatch) {
        return `07:30 盤前原始假設為「${bias}」，開盤後實際走勢偏強${dataStr}。系統判定：盤中走勢與盤前假設方向一致。`;
      }
      return `07:30 盤前原始假設為「${bias}」，開盤後實際走勢偏強${dataStr}。系統判定：盤中走勢強於盤前假設，盤前判斷偏保守。`;
    }
    return `開盤後實際走勢偏強${dataStr}，盤中追蹤顯示多方訊號明確。`;
  }

  // radarStatus === '觀察中'
  if (premarketBias && premarketBias !== '未標記') {
    return `07:30 盤前原始假設為「${bias}」，開盤後無明確方向訊號${dataStr}。系統判定：繼續觀察盤中走勢是否與盤前假設一致。`;
  }
  return `開盤後無明確方向訊號${dataStr}，繼續觀察盤中走勢。`;
}

// ═══════════════════════════════════════════════════════════
// V3.1: Core radar logic — dynamic summaries
// ═══════════════════════════════════════════════════════════

function computeRadar(data: MarketDataRow[], premarketBias: string | null, premarketConfidence: number | null, log: (m: string) => void): OpeningRadarResult {
  const taiex = findSymbol(data, ['TAIEX', 'TWII', '^TWII']);
  const txf = findSymbol(data, ['TXF', 'TX', 'TXF1']);
  const ts2330 = findSymbol(data, ['2330', '2330.TW', 'TSMC_TW']);
  const spx = findSymbol(data, ['SPX', 'SP500', '^GSPC']);
  const sox = findSymbol(data, ['SOX', 'PHLX', '^SOX']);
  const vix = findSymbol(data, ['VIX', '^VIX']);
  const dxy = findSymbol(data, ['DXY', 'USDINDEX']);
  const us10y = findSymbol(data, ['US10Y', '^TNX']);

  const taiexChg = taiex?.change_percent ?? null;
  const txfChg = txf?.change_percent ?? null;
  const ts2330Chg = ts2330?.change_percent ?? null;

  const twCorePresent = [taiexChg !== null, txfChg !== null, ts2330Chg !== null].filter(Boolean).length;
  const twCoreMissing = 3 - twCorePresent;

  log(`TW Core: TAIEX=${taiexChg} TXF=${txfChg} 2330=${ts2330Chg} present=${twCorePresent}/3`);

  const biasRef = premarketBias || '未標記';

  // If 2+ missing → 資料不足
  if (twCoreMissing >= 2) {
    return {
      radar_status: '資料不足',
      market_bias: '資料不足',
      confidence_score: 60,
      summary: '台股核心指標不足，暫不判定盤中方向。',
      is_premarket_overridden: false,
      override_reason: '台股核心指標不足（TAIEX/TXF/2330 缺少 ≥2）',
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ 明顯偏弱：TAIEX <= -1% or TXF <= -1% or 2330 <= -2% ═══
  if (
    (taiexChg !== null && taiexChg <= -1) ||
    (txfChg !== null && txfChg <= -1) ||
    (ts2330Chg !== null && ts2330Chg <= -2)
  ) {
    const reasonParts: string[] = [];
    if (taiexChg !== null && taiexChg <= -1) reasonParts.push(`TAIEX ${taiexChg.toFixed(2)}%`);
    if (txfChg !== null && txfChg <= -1) reasonParts.push(`TXF ${txfChg.toFixed(2)}%`);
    if (ts2330Chg !== null && ts2330Chg <= -2) reasonParts.push(`2330 ${ts2330Chg.toFixed(2)}%`);

    const isPremarketBullish = Boolean(premarketBias?.includes('多') && !premarketBias?.includes('空'));
    const overridden = isPremarketBullish;

    const dynamicSummary = buildDynamicSummary('明顯偏弱', premarketBias, overridden, taiexChg, txfChg, ts2330Chg);

    return {
      radar_status: '明顯偏弱',
      market_bias: '明顯偏弱',
      confidence_score: 30,
      summary: dynamicSummary,
      is_premarket_overridden: overridden,
      override_reason: overridden ? `盤前${biasRef}(${premarketConfidence})已被推翻：${reasonParts.join('、')} 明顯轉弱` : `${reasonParts.join('、')} 明顯轉弱`,
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ 盤中轉弱 ═══
  const taiexNeg = taiexChg !== null && taiexChg < 0;
  const txfNeg = txfChg !== null && txfChg < 0;
  const ts2330Neg = ts2330Chg !== null && ts2330Chg < 0;

  const moderateWeak =
    (taiexChg !== null && taiexChg <= -0.5) ||
    (txfChg !== null && txfChg <= -0.5) ||
    (ts2330Chg !== null && ts2330Chg <= -1) ||
    (taiexNeg && txfNeg) ||
    (ts2330Neg && taiexNeg);

  if (moderateWeak) {
    const isPremarketBullish = Boolean(premarketBias?.includes('多') && !premarketBias?.includes('空'));
    const overridden = isPremarketBullish;

    const dynamicSummary = buildDynamicSummary('盤中轉弱', premarketBias, overridden, taiexChg, txfChg, ts2330Chg);

    return {
      radar_status: '盤中轉弱',
      market_bias: '偏弱觀察',
      confidence_score: 45,
      summary: dynamicSummary,
      is_premarket_overridden: overridden,
      override_reason: overridden ? `盤前${biasRef}(${premarketConfidence})被推翻：開盤後實際走勢轉弱` : '開盤後實際走勢轉弱',
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ 偏強確認 ═══
  const taiexStrong = taiexChg !== null && taiexChg >= 1;
  const txfStrong = txfChg !== null && txfChg >= 1;

  if (taiexStrong || txfStrong) {
    const dynamicSummary = buildDynamicSummary('偏強確認', premarketBias, false, taiexChg, txfChg, ts2330Chg);

    return {
      radar_status: '偏強確認',
      market_bias: premarketBias?.includes('多') ? premarketBias : '偏多觀察',
      confidence_score: Math.max(75, premarketConfidence ?? 75),
      summary: dynamicSummary,
      is_premarket_overridden: false,
      override_reason: '',
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ No strong signal: neutral ──
  const dynamicSummary = buildDynamicSummary('觀察中', premarketBias, false, taiexChg, txfChg, ts2330Chg);

  return {
    radar_status: '觀察中',
    market_bias: premarketBias || '中性震盪',
    confidence_score: Math.min(60, premarketConfidence ?? 60),
    summary: dynamicSummary,
    is_premarket_overridden: false,
    override_reason: '',
    taiex_change: taiexChg,
    txf_change: txfChg,
    tsmc_change: ts2330Chg,
    spx_change: spx?.change_percent ?? null,
    sox_change: sox?.change_percent ?? null,
    vix_change: vix?.change_percent ?? null,
    dxy_change: dxy?.change_percent ?? null,
    us10y_change: us10y?.change_percent ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const startTime = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  const logs: string[] = [];
  function log(m: string) { const line = `[${new Date().toISOString()}] ${m}`; logs.push(line); console.log(line); }

  try {
    const cronSecret = req.headers.get('x-cron-secret') || '';
    const authHeader = req.headers.get('Authorization') || '';
    const envCronSecret = Deno.env.get('CRON_SECRET') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const hasValidCronSecret = envCronSecret && cronSecret === envCronSecret;
    const hasValidBearer = authHeader.startsWith('Bearer ') &&
      (authHeader.slice(7) === supabaseAnonKey || authHeader.slice(7) === supabaseServiceRole);

    if (!hasValidCronSecret && !hasValidBearer) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    log(`=== Opening Market Radar ${VERSION} [${requestId}] ===`);

    const supabase = createRuntimeClient(
      Deno.env.get('SUPABASE_URL') || '',
      supabaseServiceRole,
    );

    const today = getTaiwanDateString();
    const marketStatus = resolveMarketStatus(today);
    if (!marketStatus.is_trading_day) {
      log(`MARKET_CLOSED_SKIP status=${marketStatus.market_status} date=${today}`);
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: 'MARKET_STATUS_NOT_OPEN',
        report_date: today,
        market_status: marketStatus.market_status,
        session_type: marketStatus.session_type,
        is_trading_day: marketStatus.is_trading_day,
        market_message: marketStatus.market_message,
        next_trading_day: marketStatus.next_trading_day,
        version: VERSION,
        logs,
      }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }
    const { hour, minute } = getTaipeiHourMinute();
    const timeVal = hour * 60 + minute;
    const afterOpen = timeVal >= 9 * 60 + 15;

    const requestBody = await parseRequestBody(req);
    const requestUrl = new URL(req.url);
    const checkpoint = normalizeIntradayCheckpoint(requestBody.checkpoint || requestUrl.searchParams.get('checkpoint'))
      || inferIntradayCheckpoint(hour, minute);
    if (!checkpoint) {
      return new Response(JSON.stringify({
        success: false,
        error: 'INVALID_OR_MISSING_CHECKPOINT',
        accepted_checkpoints: ['0930', '1030', '1300'],
        version: VERSION,
      }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    log(`Taipei time: ${hour}:${String(minute).padStart(2, '0')}, checkpoint=${checkpoint}, afterOpen=${afterOpen}, date=${today}`);

    // 1. Fetch today's premarket report — SOLE SOURCE OF TRUTH
    const { data: reportRow } = await supabase
      .from('reports')
      .select('id, market_bias, confidence_score, report_date')
      .eq('report_date', today)
      .maybeSingle();

    const premarketBias = reportRow ? String((reportRow as Record<string, unknown>).market_bias || '') : null;
    const premarketConfidence = reportRow ? Number((reportRow as Record<string, unknown>).confidence_score || 0) : null;
    const premarketReportId = reportRow ? String((reportRow as Record<string, unknown>).id || '') : null;

    log(`Premarket from reports: bias="${premarketBias}", confidence=${premarketConfidence}`);

    // 2. A checkpoint may only consume same-day, phase=intraday snapshots inside its own freshness window.
    // market_data has no phase/trading_date contract and therefore is intentionally not a fallback.
    const now = new Date().toISOString();

    const { data: snapshotRows, error: snapshotErr } = await supabase
      .from('market_data_snapshots')
      .select('symbol, name, value, change_percent, captured_at, source, trading_date, phase')
      .eq('trading_date', today)
      .eq('phase', 'intraday')
      .in('symbol', CORE_SYMBOL_QUERY_ALIASES)
      .order('captured_at', { ascending: false })
      .limit(50);

    if (snapshotErr) {
      log(`Snapshot query error: ${snapshotErr.message}`);
      return new Response(JSON.stringify({ success: false, error: snapshotErr.message, version: VERSION }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const rawSnapshotRows = (snapshotRows || []) as RuntimeSnapshotRow[];
    const checkpointEvaluation = evaluateIntradayCheckpointRows(rawSnapshotRows, today, checkpoint);
    const marketData = mapMarketDataRows(checkpointEvaluation.acceptedRows as unknown as Record<string, unknown>[]);
    const marketDataSource = 'market_data_snapshots';
    const latestCapturedAt = getLatestCapturedAt(marketData);
    const missingCoreSymbols = checkpointEvaluation.missingSymbols;
    // TAIEX + 2330 are sufficient for a conservative degraded radar. TXF remains
    // valuable confirmation evidence, but a missing futures entitlement must not
    // suppress otherwise valid same-day cash-market observations.
    const hasTaiex = marketData.some((row) => ['TAIEX', 'TWII', '^TWII'].includes(row.symbol.toUpperCase()));
    const hasTsmc = marketData.some((row) => ['2330', '2330.TW', 'TSMC_TW'].includes(row.symbol.toUpperCase()));
    const txfOnlyMissing = missingCoreSymbols.length === 1 && missingCoreSymbols[0] === 'TXF';
    const degradedCheckpointUsable = !checkpointEvaluation.ready && txfOnlyMissing && hasTaiex && hasTsmc;
    const checkpointUsable = checkpointEvaluation.ready || degradedCheckpointUsable;
    const dataStatus = checkpointEvaluation.ready ? 'ready' : degradedCheckpointUsable ? 'degraded' : 'insufficient';
    const radarMode = checkpointEvaluation.ready
      ? 'checkpoint_full_core'
      : degradedCheckpointUsable
        ? 'checkpoint_cash_core_degraded'
        : 'checkpoint_insufficient';
    const txfStatus = missingCoreSymbols.includes('TXF') ? 'missing_for_checkpoint' : 'available';
    const checkpointReason = checkpointEvaluation.ready
      ? `checkpoint ${checkpoint} accepted complete same-day intraday snapshot set`
      : degradedCheckpointUsable
        ? `checkpoint ${checkpoint} accepted degraded same-day TAIEX + 2330 snapshot set; TXF unavailable`
      : `checkpoint ${checkpoint} missing complete in-window snapshot set: ${missingCoreSymbols.join(', ') || 'out_of_window'}`;

    log(`Checkpoint rows: accepted=${marketData.length}, rejected=${checkpointEvaluation.rejectedRows.length}, source=${marketDataSource}, checkpoint=${checkpoint}, latest_captured_at=${latestCapturedAt || 'none'}, missing=${missingCoreSymbols.join(',') || 'none'}`);

    if (!checkpointUsable) {
      const reportRefresh = await patchReportAfterRadar(supabase, today, null, checkpoint, 'insufficient', latestCapturedAt, marketDataSource, checkpointReason, log);
      log(`INSUFFICIENT_CHECKPOINT_DATA: ${checkpointReason}`);
      return new Response(JSON.stringify({
        success: true,
        radar_written: false,
        reason: 'INSUFFICIENT_CHECKPOINT_DATA',
        checkpoint,
        data_status: dataStatus,
        missing_sources: missingCoreSymbols,
        radar_mode: radarMode,
        txf_status: txfStatus,
        report_refresh: reportRefresh,
        version: VERSION,
      }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    // 3. Compute radar
    const radar = computeRadar(marketData, premarketBias, premarketConfidence, log);

    log(`Radar: status=${radar.radar_status}, bias=${radar.market_bias}, confidence=${radar.confidence_score}, overridden=${radar.is_premarket_overridden}`);

    // 4. Upsert to opening_market_radar
    const upsertData: Record<string, unknown> = {
      report_date: today,
      radar_status: radar.radar_status,
      market_bias: radar.market_bias,
      confidence_score: radar.confidence_score,
      taiex_change: radar.taiex_change,
      txf_change: radar.txf_change,
      tsmc_change: radar.tsmc_change,
      spx_change: radar.spx_change,
      sox_change: radar.sox_change,
      vix_change: radar.vix_change,
      dxy_change: radar.dxy_change,
      us10y_change: radar.us10y_change,
      summary: radar.summary,
      premarket_report_id: premarketReportId || null,
      premarket_bias: premarketBias,
      premarket_confidence: premarketConfidence,
      is_premarket_overridden: radar.is_premarket_overridden,
      override_reason: radar.override_reason,
      captured_at: latestCapturedAt,
      source_kind: 'intraday_live',
      data_source: 'market_data_snapshots',
      input_source: marketDataSource,
      market_data_date: today,
      data_status: dataStatus,
      missing_sources: missingCoreSymbols,
      radar_mode: radarMode,
      txf_status: txfStatus,
      created_at: now,
      updated_at: now,
    };

    let degradedMetadataPersisted = true;
    let { error: upsertErr } = await supabase
      .from('opening_market_radar')
      .upsert(upsertData, { onConflict: 'report_date' });

    if (upsertErr && /(data_status|missing_sources|radar_mode|txf_status|input_source)/i.test(upsertErr.message)) {
      degradedMetadataPersisted = false;
      log(`Metadata column warning: ${upsertErr.message}; retrying without degraded metadata columns`);
      const compatibleUpsertData = { ...upsertData };
      delete compatibleUpsertData.data_status;
      delete compatibleUpsertData.missing_sources;
      delete compatibleUpsertData.radar_mode;
      delete compatibleUpsertData.txf_status;
      delete compatibleUpsertData.input_source;
      const retry = await supabase
        .from('opening_market_radar')
        .upsert(compatibleUpsertData, { onConflict: 'report_date' });
      upsertErr = retry.error;
    }

    if (upsertErr) {
      log(`DB ERROR: ${upsertErr.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: upsertErr.message,
        version: VERSION,
        request_id: requestId,
        radar,
        logs,
      }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    log(`SUCCESS: Radar for ${today} written (premarket_bias from reports: "${premarketBias}")`);
    const reportRefresh = await patchReportAfterRadar(supabase, today, upsertData, checkpoint, 'ready', latestCapturedAt, marketDataSource, checkpointReason, log);

    return new Response(JSON.stringify({
      success: true,
      version: VERSION,
      request_id: requestId,
      report_date: today,
      checkpoint,
      radar_status: radar.radar_status,
      market_bias: radar.market_bias,
      confidence_score: radar.confidence_score,
      premarket_bias_source: 'reports.market_bias',
      premarket_bias: premarketBias,
      is_premarket_overridden: radar.is_premarket_overridden,
      override_reason: radar.override_reason,
      taiex_change: radar.taiex_change,
      txf_change: radar.txf_change,
      tsmc_change: radar.tsmc_change,
      captured_at: latestCapturedAt,
      source_kind: 'intraday_live',
      data_source: 'market_data_snapshots',
      input_source: marketDataSource,
      market_data_date: today,
      data_status: dataStatus,
      missing_sources: missingCoreSymbols,
      radar_mode: radarMode,
      txf_status: txfStatus,
      degraded_metadata_persisted: degradedMetadataPersisted,
      report_refresh: reportRefresh,
      after_open: afterOpen,
      duration_ms: Date.now() - startTime,
      logs,
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FATAL: ${msg}`);
    return new Response(JSON.stringify({
      success: false,
      version: VERSION,
      error: msg,
      logs,
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }
});
