import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// generate-sector-rotation
// Produces sector_rotation_scores from real close-window market_data only.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

type MarketRow = {
  symbol: string;
  name: string;
  change_percent: number;
  captured_at: string | null;
  updated_at: string | null;
};

type SectorConfig = {
  sector: string;
  symbols: string[];
  keywords: string[];
};

type SectorScore = {
  sector: string;
  sub_sector: string;
  score_date: string;
  rotation_score: number;
  direction: "positive" | "negative" | "neutral";
  signal_label: "轉強" | "轉弱" | "觀察" | "無明確優勢";
  news_score: number;
  market_score: number;
  global_score: number;
  risk_score: number;
  confidence_score: number;
  leading_symbols: string[];
  lagging_symbols: string[];
  summary: string;
  generated_at: string;
  created_at: string;
};

type TradingDayInfo = {
  isTradingDay: boolean;
  marketClosed: boolean;
  reason: string;
  holidayName: string | null;
};

type RequestBody = {
  backfill?: boolean;
  target_date?: string;
};

const TAIWAN_HOLIDAYS_2026: Record<string, string> = {
  "2026-01-01": "元旦",
  "2026-02-16": "春節休市",
  "2026-02-17": "春節休市",
  "2026-02-18": "春節休市",
  "2026-02-19": "春節休市",
  "2026-02-20": "春節休市",
  "2026-02-27": "和平紀念日補假",
  "2026-04-03": "兒童節補假",
  "2026-04-06": "清明節補假",
  "2026-06-19": "端午節",
  "2026-09-25": "中秋節",
  "2026-10-09": "國慶日補假",
};

const SECTORS: SectorConfig[] = [
  { sector: "半導體", symbols: ["2330", "TSM", "NVDA", "SOX"], keywords: ["半導體", "晶片", "台積電", "tsmc", "nvidia", "nvda", "sox", "semiconductor", "chip"] },
  { sector: "AI伺服器", symbols: ["NVDA", "AMD", "SMCI", "2382", "3231", "6669"], keywords: ["AI", "伺服器", "server", "nvidia", "nvda", "amd", "smci", "廣達", "緯創"] },
  { sector: "電子權值", symbols: ["2330", "2317", "2454", "2308"], keywords: ["電子", "權值", "台積電", "鴻海", "聯發科", "台達電"] },
  { sector: "金融", symbols: ["2881", "2882", "2884", "2886", "2891"], keywords: ["金融", "銀行", "金控", "利率", "殖利率", "bank", "yield"] },
  { sector: "航運", symbols: ["2603", "2609", "2615"], keywords: ["航運", "貨櫃", "海運", "運價", "shipping", "freight"] },
  { sector: "觀光餐飲", symbols: ["2727", "2707", "2753"], keywords: ["觀光", "餐飲", "旅遊", "飯店", "tourism", "restaurant"] },
  { sector: "大盤", symbols: ["TAIEX", "TXF", "^TWII"], keywords: ["大盤", "加權", "台股", "台指期", "taiex", "twii"] },
];

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getTaipeiParts(): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const value = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function taipeiWindowUtc(date: string): { start: string; end: string } {
  return {
    start: `${date}T05:30:00.000Z`,
    end: `${date}T07:30:00.000Z`,
  };
}

function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function getTaiwanTradingDayInfo(date: string): TradingDayInfo {
  if (!isValidDateString(date)) {
    return { isTradingDay: false, marketClosed: true, reason: "INVALID_DATE", holidayName: "日期格式錯誤" };
  }

  const [year, month, day] = date.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { isTradingDay: false, marketClosed: true, reason: "WEEKEND", holidayName: "週末休市" };
  }

  const holidayName = TAIWAN_HOLIDAYS_2026[date] || null;
  if (holidayName) {
    return { isTradingDay: false, marketClosed: true, reason: "HOLIDAY", holidayName };
  }

  return { isTradingDay: true, marketClosed: false, reason: "TRADING_DAY_CONFIRMED", holidayName: null };
}

async function readRequestBody(req: Request): Promise<RequestBody> {
  try {
    const raw = await req.text();
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RequestBody : {};
  } catch {
    return {};
  }
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function rowTimestamp(row: MarketRow): string {
  return row.captured_at || row.updated_at || "";
}

function isWithinCloseWindow(row: MarketRow, start: string, end: string): boolean {
  const candidates = [row.captured_at, row.updated_at].filter(Boolean) as string[];
  return candidates.some((ts) => ts >= start && ts <= end);
}

function mapMarketRow(row: Record<string, unknown>): MarketRow | null {
  const symbol = normalizeSymbol(String(row.symbol || ""));
  const change = toNumber(row.change_percent);
  if (!symbol || change === null) return null;

  return {
    symbol,
    name: String(row.name || ""),
    change_percent: change,
    captured_at: row.captured_at ? String(row.captured_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

function latestRowsBySymbol(rows: MarketRow[]): MarketRow[] {
  const map = new Map<string, MarketRow>();
  for (const row of rows) {
    const existing = map.get(row.symbol);
    if (!existing || rowTimestamp(row) > rowTimestamp(existing)) {
      map.set(row.symbol, row);
    }
  }
  return [...map.values()];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function directionFromMarket(avgChange: number): "positive" | "negative" | "neutral" {
  if (avgChange >= 0.5) return "positive";
  if (avgChange <= -0.5) return "negative";
  return "neutral";
}

function labelFromMarket(avgChange: number): "轉強" | "轉弱" | "觀察" | "無明確優勢" {
  if (avgChange >= 0.8) return "轉強";
  if (avgChange <= -0.8) return "轉弱";
  if (Math.abs(avgChange) >= 0.3) return "觀察";
  return "無明確優勢";
}

function scoreFromChange(avgChange: number): number {
  return round(clamp(50 + avgChange * 10, 0, 100));
}

function riskScoreFromChange(avgChange: number, changes: number[]): number {
  const dispersion = Math.max(...changes) - Math.min(...changes);
  const downsideRisk = avgChange < 0 ? Math.abs(avgChange) * 10 : 0;
  return round(clamp(dispersion * 6 + downsideRisk, 0, 100));
}

function confidenceFromRows(rows: MarketRow[], start: string, end: string): number {
  const countScore = clamp(rows.length * 22, 25, 75);
  const freshCount = rows.filter((row) => isWithinCloseWindow(row, start, end)).length;
  const freshScore = rows.length > 0 ? (freshCount / rows.length) * 25 : 0;
  return round(clamp(countScore + freshScore, 0, 100));
}

function newsScoreForSector(newsText: string, sector: SectorConfig): number {
  if (!newsText) return 0;
  const lower = newsText.toLowerCase();
  let hits = 0;
  for (const keyword of sector.keywords) {
    if (lower.includes(keyword.toLowerCase())) hits++;
  }
  return round(clamp(hits * 12, 0, 100));
}

function buildSectorScore(params: {
  sector: SectorConfig;
  rows: MarketRow[];
  newsText: string;
  scoreDate: string;
  now: string;
  start: string;
  end: string;
}): SectorScore | null {
  const { sector, rows, newsText, scoreDate, now, start, end } = params;
  const usable = latestRowsBySymbol(rows.filter((row) => sector.symbols.includes(row.symbol)));
  if (usable.length < 1) return null;

  const changes = usable.map((row) => row.change_percent);
  const avgChange = average(changes);
  const marketScore = scoreFromChange(avgChange);
  const newsScore = newsScoreForSector(newsText, sector);
  const riskScore = riskScoreFromChange(avgChange, changes);
  const confidenceScore = confidenceFromRows(usable, start, end);
  const globalScore = round(clamp((marketScore + newsScore) / 2, 0, 100));
  const rotationScore = round(clamp(
    marketScore * 0.55 + newsScore * 0.15 + confidenceScore * 0.2 + (100 - riskScore) * 0.1,
    0,
    100,
  ));

  const sortedByChange = [...usable].sort((a, b) => b.change_percent - a.change_percent);
  const leadingSymbols = sortedByChange.filter((row) => row.change_percent >= avgChange).map((row) => row.symbol);
  const laggingSymbols = sortedByChange.filter((row) => row.change_percent < avgChange).map((row) => row.symbol);
  const details = sortedByChange
    .map((row) => `${row.symbol} ${row.change_percent >= 0 ? "+" : ""}${round(row.change_percent, 2)}%`)
    .join("、");

  return {
    sector: sector.sector,
    sub_sector: sector.sector,
    score_date: scoreDate,
    rotation_score: rotationScore,
    direction: directionFromMarket(avgChange),
    signal_label: labelFromMarket(avgChange),
    news_score: newsScore,
    market_score: marketScore,
    global_score: globalScore,
    risk_score: riskScore,
    confidence_score: confidenceScore,
    leading_symbols: leadingSymbols.length > 0 ? leadingSymbols : sortedByChange.slice(0, 1).map((row) => row.symbol),
    lagging_symbols: laggingSymbols,
    summary: `根據 ${details}，${sector.sector}平均漲跌幅為 ${avgChange >= 0 ? "+" : ""}${round(avgChange, 2)}%，market_score=${marketScore}，news_score=${newsScore}，confidence_score=${confidenceScore}。`,
    generated_at: now,
    created_at: now,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  const taipei = getTaipeiParts();
  let scoreDate = taipei.date;
  const now = new Date().toISOString();
  const logPrefix = `[SECTOR:${requestId}]`;

  try {
    const body = await readRequestBody(req);
    const backfillMode = body.backfill === true && typeof body.target_date === "string" && body.target_date.trim().length > 0;
    const targetDate = backfillMode ? body.target_date!.trim() : taipei.date;
    scoreDate = targetDate;

    const expectedSecret = Deno.env.get("CRON_SECRET") || "";
    if (!expectedSecret) {
      console.error(`${logPrefix} CRON_SECRET is not configured`);
      return jsonResponse({ success: false, error: "Server configuration error", reason: "CRON_SECRET is not configured", score_date: scoreDate }, 500);
    }

    const incomingSecret = req.headers.get("x-cron-secret") || "";
    if (incomingSecret !== expectedSecret) {
      console.error(`${logPrefix} invalid x-cron-secret`);
      return jsonResponse({ success: false, error: "Unauthorized", score_date: scoreDate }, 401);
    }

    if (!isValidDateString(scoreDate)) {
      console.warn(`${logPrefix} invalid target_date: ${scoreDate}`);
      return jsonResponse({
        success: false,
        code: "INVALID_TARGET_DATE",
        reason: "INVALID_TARGET_DATE",
        score_date: scoreDate,
        backfill_mode: backfillMode,
        skipped_reason: "target_date must use YYYY-MM-DD",
      }, 400);
    }

    if (scoreDate > taipei.date) {
      console.warn(`${logPrefix} future target_date rejected: ${scoreDate}`);
      return jsonResponse({
        success: false,
        code: "FUTURE_TARGET_DATE_NOT_ALLOWED",
        reason: "FUTURE_TARGET_DATE_NOT_ALLOWED",
        score_date: scoreDate,
        today_date: taipei.date,
        backfill_mode: backfillMode,
        skipped_reason: "target_date cannot be later than Taiwan today",
      }, 400);
    }

    if (body.backfill === true && !backfillMode) {
      console.warn(`${logPrefix} backfill requested without valid target_date`);
      return jsonResponse({
        success: false,
        code: "BACKFILL_TARGET_DATE_REQUIRED",
        reason: "BACKFILL_TARGET_DATE_REQUIRED",
        score_date: scoreDate,
        today_date: taipei.date,
        backfill_mode: false,
        skipped_reason: "backfill=true requires target_date",
      }, 400);
    }

    const tradingDay = getTaiwanTradingDayInfo(scoreDate);
    if (!tradingDay.isTradingDay) {
      console.log(`${logPrefix} market closed for ${scoreDate}: ${tradingDay.reason}`);
      return jsonResponse({
        success: false,
        code: "MARKET_CLOSED",
        reason: "MARKET_CLOSED",
        score_date: scoreDate,
        today_date: taipei.date,
        backfill_mode: backfillMode,
        market_closed: true,
        trading_day_reason: tradingDay.reason,
        holiday_name: tradingDay.holidayName,
        skipped_reason: tradingDay.holidayName || tradingDay.reason,
      }, 200);
    }

    const isTodayRun = scoreDate === taipei.date;
    if (isTodayRun && (taipei.hour < 14 || (taipei.hour === 14 && taipei.minute < 15))) {
      console.log(`${logPrefix} too early for close rotation: ${scoreDate} ${taipei.hour}:${taipei.minute}`);
      return jsonResponse({
        success: false,
        code: "TOO_EARLY_FOR_CLOSE_ROTATION",
        reason: "TOO_EARLY_FOR_CLOSE_ROTATION",
        score_date: scoreDate,
        today_date: taipei.date,
        backfill_mode: backfillMode,
        skipped_reason: "Taiwan close rotation is allowed after 14:15 Asia/Taipei",
      }, 200);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`${logPrefix} missing Supabase credentials`);
      return jsonResponse({ success: false, error: "Server configuration error", reason: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured", score_date: scoreDate }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const closeWindow = taipeiWindowUtc(scoreDate);
    const marketSelect = "symbol,name,market,value,change_percent,status,taiwan_impact,captured_at,change,updated_at";
    const [capturedResult, updatedResult, newsResult, reportResult] = await Promise.all([
      supabase.from("market_data").select(marketSelect).gte("captured_at", closeWindow.start).lte("captured_at", closeWindow.end).limit(200),
      supabase.from("market_data").select(marketSelect).gte("updated_at", closeWindow.start).lte("updated_at", closeWindow.end).limit(200),
      supabase.from("market_news").select("title,taiwan_impact_summary,related_sectors,published_at,created_at").gte("created_at", `${scoreDate}T00:00:00+08:00`).limit(100),
      supabase.from("reports").select("id,report_date,market_bias,summary,ai_strategy_json").eq("report_date", scoreDate).maybeSingle(),
    ]);

    const marketError = capturedResult.error || updatedResult.error;
    if (marketError) {
      console.error(`${logPrefix} market_data query failed: ${marketError.message}`);
      return jsonResponse({
        success: false,
        code: "MARKET_DATA_QUERY_FAILED",
        reason: "MARKET_DATA_QUERY_FAILED",
        detail: marketError.message,
        score_date: scoreDate,
        backfill_mode: backfillMode,
        close_window_start: closeWindow.start,
        close_window_end: closeWindow.end,
      }, 500);
    }

    const rawRows = [
      ...(capturedResult.data || []),
      ...(updatedResult.data || []),
    ] as Record<string, unknown>[];

    const rows = latestRowsBySymbol(rawRows.map(mapMarketRow).filter((row): row is MarketRow => row !== null));
    if (rows.length === 0) {
      console.log(`${logPrefix} no close-window market_data for ${scoreDate}`);
      return jsonResponse({
        success: false,
        code: "NO_CLOSE_MARKET_DATA",
        reason: "NO_CLOSE_MARKET_DATA",
        score_date: scoreDate,
        today_date: taipei.date,
        backfill_mode: backfillMode,
        close_window_start: closeWindow.start,
        close_window_end: closeWindow.end,
        market_data_count: 0,
        usable_sector_count: 0,
        skipped_reason: "No market_data rows in Taiwan close window",
      }, 200);
    }

    const newsRows = (newsResult.data || []) as Record<string, unknown>[];
    const newsText = newsRows.map((row) => {
      const sectors = Array.isArray(row.related_sectors) ? row.related_sectors.join(" ") : "";
      return `${row.title || ""} ${row.taiwan_impact_summary || ""} ${sectors}`;
    }).join(" ");

    if (newsResult.error) {
      console.warn(`${logPrefix} market_news query warning: ${newsResult.error.message}`);
    }
    if (reportResult.error) {
      console.warn(`${logPrefix} reports query warning: ${reportResult.error.message}`);
    }

    const sectorRows = SECTORS
      .map((sector) => buildSectorScore({ sector, rows, newsText, scoreDate, now, start: closeWindow.start, end: closeWindow.end }))
      .filter((row): row is SectorScore => row !== null)
      .sort((a, b) => b.rotation_score - a.rotation_score);

    if (sectorRows.length === 0) {
      console.log(`${logPrefix} no mapped sectors from ${rows.map((row) => row.symbol).join(",")}`);
      return jsonResponse({
        success: false,
        code: "NO_USABLE_SECTOR_DATA",
        reason: "NO_USABLE_SECTOR_DATA",
        score_date: scoreDate,
        today_date: taipei.date,
        backfill_mode: backfillMode,
        close_window_start: closeWindow.start,
        close_window_end: closeWindow.end,
        market_data_count: rows.length,
        usable_sector_count: 0,
        skipped_reason: "No configured sector had usable mapped symbols",
      }, 200);
    }

    const { count: deletedCount, error: deleteError } = await supabase
      .from("sector_rotation_scores")
      .delete({ count: "exact" })
      .eq("score_date", scoreDate);

    if (deleteError) {
      console.error(`${logPrefix} delete failed: ${deleteError.message}`);
      return jsonResponse({
        success: false,
        code: "DELETE_EXISTING_SECTOR_ROWS_FAILED",
        reason: "DELETE_EXISTING_SECTOR_ROWS_FAILED",
        detail: deleteError.message,
        score_date: scoreDate,
        backfill_mode: backfillMode,
        close_window_start: closeWindow.start,
        close_window_end: closeWindow.end,
        market_data_count: rows.length,
        usable_sector_count: sectorRows.length,
      }, 500);
    }

    const { error: insertError } = await supabase
      .from("sector_rotation_scores")
      .insert(sectorRows);

    if (insertError) {
      console.error(`${logPrefix} insert failed after deleting ${deletedCount || 0} existing rows for ${scoreDate}: ${insertError.message}`);
      return jsonResponse({
        success: false,
        code: "INSERT_SECTOR_ROWS_FAILED",
        reason: "INSERT_SECTOR_ROWS_FAILED",
        detail: insertError.message,
        score_date: scoreDate,
        backfill_mode: backfillMode,
        close_window_start: closeWindow.start,
        close_window_end: closeWindow.end,
        market_data_count: rows.length,
        usable_sector_count: sectorRows.length,
        deleted_count: deletedCount || 0,
      }, 500);
    }

    console.log(`${logPrefix} inserted ${sectorRows.length} sector rows for ${scoreDate} backfill=${backfillMode} deleted=${deletedCount || 0} market_rows=${rows.length}`);
    return jsonResponse({
      success: true,
      score_date: scoreDate,
      today_date: taipei.date,
      backfill_mode: backfillMode,
      close_window_start: closeWindow.start,
      close_window_end: closeWindow.end,
      market_data_count: rows.length,
      usable_sector_count: sectorRows.length,
      deleted_count: deletedCount || 0,
      inserted_count: sectorRows.length,
      inserted: sectorRows.length,
      sectors: sectorRows.map((row) => ({
        sector: row.sector,
        rotation_score: row.rotation_score,
        direction: row.direction,
        signal_label: row.signal_label,
        leading_symbols: row.leading_symbols,
        summary: row.summary,
      })),
    }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} fatal: ${message}`);
    return jsonResponse({ success: false, reason: "INTERNAL_ERROR", detail: message, score_date: scoreDate }, 500);
  }
});
