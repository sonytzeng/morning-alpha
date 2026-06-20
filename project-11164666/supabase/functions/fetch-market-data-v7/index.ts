import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// DEPRECATED: superseded by fetch-market-data-v10.
// This legacy function is intentionally disabled to prevent accidental writes to market_data.
// ===== fetch-market-data-v7 =====
// Purpose: Fetch market data from Yahoo Finance and write to market_data table
// Supports: IXIC, SOX, TSM, DXY, CL, SPX, VIX, US10Y, NVDA, AMD
// Features: per-symbol error isolation, change/change_percent calculation, status rules
// Strategy: independent fetch per symbol, log errors, never fail the whole function

interface SymbolConfig {
  symbol: string;
  yahooSymbol: string;
  name: string;
  market: string;
  taiwanImpact: string;
}

const SYMBOLS: SymbolConfig[] = [
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
];

interface YahooChartResult {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
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

async function fetchYahooFinance(yahooSymbol: string): Promise<{
  value: number;
  change: number;
  changePercent: number;
} | null> {
  const encoded = encodeURIComponent(yahooSymbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=1d`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`[FETCH] Yahoo API HTTP ${response.status} for ${yahooSymbol}`);
      return null;
    }

    const data: YahooChartResult = await response.json();

    if (!data.chart?.result || data.chart.result.length === 0) {
      console.error(`[FETCH] Yahoo API empty result for ${yahooSymbol}`);
      return null;
    }

    const meta = data.chart.result[0].meta;
    if (!meta) {
      console.error(`[FETCH] Yahoo API missing meta for ${yahooSymbol}`);
      return null;
    }

    const currentPrice = meta.regularMarketPrice ?? 0;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? 0;

    if (currentPrice === 0 || previousClose === 0) {
      console.error(`[FETCH] Invalid price data for ${yahooSymbol}: current=${currentPrice}, previous=${previousClose}`);
      return null;
    }

    const change = currentPrice - previousClose;
    const changePercent = (change / previousClose) * 100;

    return {
      value: currentPrice,
      change,
      changePercent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FETCH] Exception for ${yahooSymbol}: ${message}`);
    return null;
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  console.log(`[MARKET:${requestId}] start - ${now}`);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
      },
    });
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: "DEPRECATED_FUNCTION_DISABLED",
      reason: "fetch-market-data-v7 is deprecated and no longer writes market_data. Use fetch-market-data-v10.",
      replacement: "fetch-market-data-v10",
    }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );

  // ===== 1. Auth =====
  const adminSecret = Deno.env.get("ADMIN_API_SECRET") || "";
  const authHeader = req.headers.get("Authorization") || "";
  if (adminSecret && !authHeader.includes(adminSecret)) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // ===== 2. Supabase client =====
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing Supabase credentials" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ===== 3. Fetch each symbol independently =====
  const results: Array<{
    symbol: string;
    name: string;
    value: number;
    change: number;
    changePercent: number;
    status: string;
    market: string;
    taiwanImpact: string;
  }> = [];

  const errors: Array<{ symbol: string; reason: string }> = [];

  for (const config of SYMBOLS) {
    try {
      const data = await fetchYahooFinance(config.yahooSymbol);

      if (!data) {
        errors.push({ symbol: config.symbol, reason: "Yahoo Finance fetch failed" });
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
      });

      console.log(`[MARKET:${requestId}] ${config.symbol}: ${data.value.toFixed(2)} (${data.change >= 0 ? "+" : ""}${data.change.toFixed(2)}, ${data.changePercent >= 0 ? "+" : ""}${data.changePercent.toFixed(2)}%) [${status}]`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ symbol: config.symbol, reason: message });
      console.error(`[MARKET:${requestId}] ${config.symbol} error: ${message}`);
    }
  }

  // ===== 4. Write to market_data =====
  const upsertRecords = results.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    market: r.market,
    value: r.value,
    change: r.change,
    change_percent: r.changePercent,
    status: r.status,
    taiwan_impact: r.taiwanImpact,
    captured_at: now,
    updated_at: now,
  }));

  let upsertResult: { success: boolean; error?: string } = { success: false };

  if (upsertRecords.length > 0) {
    const { error: upsertError } = await supabase
      .from("market_data")
      .upsert(upsertRecords, { onConflict: "symbol" });

    if (upsertError) {
      console.error(`[MARKET:${requestId}] upsert error: ${upsertError.message}`);
      upsertResult = { success: false, error: upsertError.message };
    } else {
      console.log(`[MARKET:${requestId}] upsert success: ${upsertRecords.length} records`);
      upsertResult = { success: true };
    }
  } else {
    console.error(`[MARKET:${requestId}] no records to upsert`);
  }

  // ===== 5. Response =====
  const success = upsertResult.success && results.length > 0;
  const statusCode = success ? 200 : 500;

  return new Response(
    JSON.stringify({
      success,
      request_id: requestId,
      fetched_at: now,
      total_symbols: SYMBOLS.length,
      success_count: results.length,
      error_count: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      data: results.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        value: r.value,
        change: r.change,
        change_percent: r.changePercent,
        status: r.status,
      })),
      upsert_error: upsertResult.error || undefined,
    }),
    {
      status: statusCode,
      headers: { "Content-Type": "application/json" },
    },
  );
});
