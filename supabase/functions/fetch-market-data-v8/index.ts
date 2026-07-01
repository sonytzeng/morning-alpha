import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// DEPRECATED: superseded by fetch-market-data-v10.
// This legacy function is intentionally disabled to prevent accidental writes to market_data.
// ===== fetch-market-data-v8 =====
// Purpose: Fetch market data from Yahoo Finance
// Supports: IXIC, SOX, TSM, DXY, CL, SPX, VIX, US10Y, NVDA, AMD (US Yahoo)
//           TAIEX (^TWII), 2330 (2330.TW) (Taiwan Yahoo)
// Features: per-symbol error isolation, change/change_percent calculation
// Strategy: independent fetch per symbol, log errors, never fail the whole function

interface SymbolConfig {
  symbol: string;
  yahooSymbol: string;
  name: string;
  market: string;
  taiwanImpact: string;
}

const SYMBOLS: SymbolConfig[] = [
  // US Market
  { symbol: "IXIC", yahooSymbol: "^IXIC", name: "Nasdaq", market: "US", taiwanImpact: "科技股風向標，影響台灣電子股開盤" },
  { symbol: "SOX", yahooSymbol: "^SOX", name: "Philadelphia Semiconductor Index", market: "US", taiwanImpact: "半導體族群強弱指標" },
  { symbol: "TSM", yahooSymbol: "TSM", name: "TSMC ADR", market: "US", taiwanImpact: "台積電 ADR 連動台股價格" },
  { symbol: "DXY", yahooSymbol: "DX-Y.NYB", name: "美元指數", market: "US", taiwanImpact: "影響外資流向與台幣匯率" },
  { symbol: "CL", yahooSymbol: "CL=F", name: "原油", market: "US", taiwanImpact: "影響航運、塑化等原物料族群" },
  { symbol: "SPX", yahooSymbol: "^GSPC", name: "S&P 500", market: "US", taiwanImpact: "美股整體健康度指標" },
  { symbol: "VIX", yahooSymbol: "^VIX", name: "恐慌指數", market: "US", taiwanImpact: "市場恐慌情緒，VIX 升高代表避險需求" },
  { symbol: "US10Y", yahooSymbol: "^TNX", name: "美國10年債殖利率", market: "US", taiwanImpact: "影響資金成本與科技股估值" },
  { symbol: "NVDA", yahooSymbol: "NVDA", name: "Nvidia", market: "US", taiwanImpact: "AI 龍頭，直接牽動台灣 AI 供應鏈" },
  { symbol: "AMD", yahooSymbol: "AMD", name: "AMD", market: "US", taiwanImpact: "CPU/GPU 競爭者，影響半導體族群情緒" },
  // Taiwan Market
  { symbol: "TAIEX", yahooSymbol: "^TWII", name: "台股加權指數", market: "TW", taiwanImpact: "台股大盤整體風向指標" },
  { symbol: "2330", yahooSymbol: "2330.TW", name: "台積電", market: "TW", taiwanImpact: "台股權值股龍頭，影響大盤加權" },
];

// TXF skipped - no reliable source currently
const SKIPPED_SYMBOLS = ["TXF"];

interface YahooChartResult {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        currency?: string;
        exchangeName?: string;
      };
    }>;
    error?: string;
  };
}

function calculateStatus(changePercent: number): string {
  if (changePercent > 0.3) return "up";
  if (changePercent < -0.3) return "down";
  return "flat";
}

async function fetchYahooFinance(
  symbol: string,
  yahooSymbol: string,
  logs: string[],
  skippedSymbols: string[],
): Promise<{
  value: number;
  change: number;
  changePercent: number;
  capturedAt: string;
} | null> {
  const encoded = encodeURIComponent(yahooSymbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=1m`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const msg = `Yahoo ${symbol}: HTTP ${response.status}`;
      logs.push(msg);
      skippedSymbols.push(symbol);
      console.error(`[FETCH] ${msg}`);
      return null;
    }

    let data: YahooChartResult;
    try {
      data = await response.json();
    } catch (jsonErr) {
      const msg = jsonErr instanceof Error ? jsonErr.message : String(jsonErr);
      logs.push(`Yahoo ${symbol}: JSON parse error: ${msg}`);
      skippedSymbols.push(symbol);
      console.error(`[FETCH] Yahoo ${symbol}: JSON parse error: ${msg}`);
      return null;
    }

    if (!data?.chart?.result || !Array.isArray(data.chart.result) || data.chart.result.length === 0) {
      const chartError = data?.chart?.error ? ` chart.error=${data.chart.error}` : "";
      logs.push(`Yahoo ${symbol}: missing chart result${chartError}`);
      skippedSymbols.push(symbol);
      console.error(`[FETCH] Yahoo ${symbol}: missing chart result${chartError}`);
      return null;
    }

    const meta = data.chart.result[0]?.meta;
    if (!meta) {
      logs.push(`Yahoo ${symbol}: missing meta`);
      skippedSymbols.push(symbol);
      console.error(`[FETCH] Yahoo ${symbol}: missing meta`);
      return null;
    }

    const price = Number(meta?.regularMarketPrice ?? meta?.previousClose ?? 0);
    const previousClose = Number(meta?.chartPreviousClose ?? meta?.previousClose ?? price);

    if (!Number.isFinite(price) || price <= 0) {
      logs.push(`Yahoo ${symbol}: invalid price=${price}`);
      skippedSymbols.push(symbol);
      console.error(`[FETCH] Yahoo ${symbol}: invalid price=${price}`);
      return null;
    }

    if (!Number.isFinite(previousClose) || previousClose <= 0) {
      logs.push(`Yahoo ${symbol}: invalid previousClose=${previousClose}, using price=${price}`);
      console.error(`[FETCH] Yahoo ${symbol}: invalid previousClose=${previousClose}, using price=${price}`);
    }

    const change = price - previousClose;
    const changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;

    let capturedAt = new Date().toISOString();
    if (meta.regularMarketTime) {
      try {
        const marketTime = new Date(meta.regularMarketTime * 1000);
        if (!Number.isNaN(marketTime.getTime())) {
          capturedAt = marketTime.toISOString();
        }
      } catch {
        // fallback to now
      }
    }

    return {
      value: price,
      change,
      changePercent,
      capturedAt,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logs.push(`Yahoo ${symbol}: exception: ${msg}`);
    skippedSymbols.push(symbol);
    console.error(`[FETCH] Exception for ${symbol}: ${msg}`);
    return null;
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  console.log(`[MARKET:${requestId}] start - ${now}`);

  try {
    // Handle OPTIONS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "DEPRECATED_FUNCTION_DISABLED",
        reason: "fetch-market-data-v8 is deprecated and no longer writes market_data. Use fetch-market-data-v10.",
        replacement: "fetch-market-data-v10",
      }),
      { status: 410, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );

    // === Auth: x-cron-secret vs CRON_SECRET ===
    const incomingCronSecret = req.headers.get("x-cron-secret") || "";
    const envCronSecret = Deno.env.get("CRON_SECRET") || "";

    if (envCronSecret && incomingCronSecret !== envCronSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Unauthorized",
          reason: "Invalid x-cron-secret",
          debug: {
            has_env_cron_secret: Boolean(envCronSecret),
            has_incoming_cron_secret: Boolean(incomingCronSecret),
            incoming_length: incomingCronSecret.length,
            env_length: envCronSecret.length,
          },
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing Supabase credentials",
          reason: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured",
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const results: Array<{
      symbol: string;
      name: string;
      value: number;
      change: number;
      changePercent: number;
      status: string;
      market: string;
      taiwanImpact: string;
      capturedAt: string;
    }> = [];

    const logs: string[] = [];
    const skippedSymbols: string[] = [...SKIPPED_SYMBOLS];

    // === Fetch each symbol individually, never crash the whole function ===
    for (const config of SYMBOLS) {
      try {
        const data = await fetchYahooFinance(config.symbol, config.yahooSymbol, logs, skippedSymbols);

        if (!data) {
          console.error(`[MARKET:${requestId}] ${config.symbol}: fetch returned null`);
          continue;
        }

        const status = calculateStatus(data.changePercent);

        results.push({
          symbol: config.symbol,
          name: config.name,
          value: Number(data.value.toFixed(2)),
          change: Number(data.change.toFixed(2)),
          changePercent: Number(data.changePercent.toFixed(2)),
          status,
          market: config.market,
          taiwanImpact: config.taiwanImpact,
          capturedAt: data.capturedAt,
        });

        console.log(`[MARKET:${requestId}] ${config.symbol}: ${data.value.toFixed(2)} (${data.change >= 0 ? "+" : ""}${data.change.toFixed(2)}, ${data.changePercent >= 0 ? "+" : ""}${data.changePercent.toFixed(2)}%) [${status}]`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logs.push(`Loop ${config.symbol}: exception: ${msg}`);
        skippedSymbols.push(config.symbol);
        console.error(`[MARKET:${requestId}] ${config.symbol} loop error: ${msg}`);
      }
    }

    logs.push(`[SKIP] TXF: TXF_SKIPPED_NO_SOURCE`);

    // === Upsert to Supabase ===
    let upsertSuccess = false;
    let upsertError: string | undefined;

    if (results.length > 0) {
      const upsertRecords = results.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        market: r.market,
        value: r.value,
        change: r.change,
        change_percent: r.changePercent,
        status: r.status,
        taiwan_impact: r.taiwanImpact,
        captured_at: r.capturedAt,
        updated_at: now,
      }));

      try {
        const { error: upsertErrorObj } = await supabase
          .from("market_data")
          .upsert(upsertRecords, { onConflict: "symbol" });

        if (upsertErrorObj) {
          upsertError = upsertErrorObj.message;
          logs.push(`DB upsert error: ${upsertErrorObj.message}`);
          console.error(`[MARKET:${requestId}] upsert error: ${upsertErrorObj.message}`);
        } else {
          upsertSuccess = true;
          console.log(`[MARKET:${requestId}] upsert success: ${upsertRecords.length} records`);
        }
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        upsertError = msg;
        logs.push(`DB upsert exception: ${msg}`);
        console.error(`[MARKET:${requestId}] upsert exception: ${msg}`);
      }
    } else {
      logs.push("No records to upsert");
      console.error(`[MARKET:${requestId}] no records to upsert`);
    }

    const updatedSymbols = results.map((r) => r.symbol);
    const success = upsertSuccess;

    const responseBody = {
      success,
      version: "V8",
      request_id: requestId,
      fetched_at: now,
      total_symbols: SYMBOLS.length,
      success_count: results.length,
      skipped_count: skippedSymbols.length,
      updated_symbols: updatedSymbols,
      skipped_symbols: skippedSymbols,
      warnings: upsertError ? [upsertError] : [],
      logs,
      upsert_error: upsertError || undefined,
      data: results.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        value: r.value,
        change: r.change,
        change_percent: r.changePercent,
        status: r.status,
        market: r.market,
        source: "yahoo",
        captured_at: r.capturedAt,
      })),
    };

    return new Response(
      JSON.stringify(responseBody),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      },
    );
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error(`[MARKET:${requestId}] FATAL: ${msg}`);

    return new Response(
      JSON.stringify({
        success: false,
        error: "INTERNAL_ERROR",
        reason: msg,
        logs: [`FATAL: ${msg}`],
        updated_symbols: [],
        skipped_symbols: [...SKIPPED_SYMBOLS],
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      },
    );
  }
});
