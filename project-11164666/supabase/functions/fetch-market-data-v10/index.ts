import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ═══════════════════════════════════════════════════════════
// fetch-market-data-v10 V10.7 — FINNHUB ONLY + 29s OVERALL TIMEOUT
// Zero Yahoo Finance. Zero query1.finance.yahoo.com.
// Each symbol: 6s timeout, max 1 retry.
// Overall: 28s hard cap → always returns within 30s for cron.
// ═══════════════════════════════════════════════════════════

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-secret, x-cron-secret",
};

const SYMBOL_DELAY_MS = 800;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_RETRIES = 1;
const OVERALL_TIMEOUT_MS = 28_000;

interface FinnhubQuote {
  c: number;
  d: number;
  dp: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

interface SymbolConfig {
  finnhubSymbol: string;
  displaySymbol: string;
  name: string;
  market: string;
  taiwanImpact: string;
}

const SYMBOLS: SymbolConfig[] = [
  { finnhubSymbol: "SPX", displaySymbol: "SPX", name: "S&P 500", market: "US", taiwanImpact: "美股整體健康度指標" },
  { finnhubSymbol: "IXIC", displaySymbol: "IXIC", name: "Nasdaq", market: "US", taiwanImpact: "科技股風向標" },
  { finnhubSymbol: "SOX", displaySymbol: "SOX", name: "費城半導體指數", market: "US", taiwanImpact: "半導體族群強弱指標" },
  { finnhubSymbol: "NVDA", displaySymbol: "NVDA", name: "Nvidia", market: "US", taiwanImpact: "AI 龍頭，直接牽動台灣 AI 供應鏈" },
  { finnhubSymbol: "TSM", displaySymbol: "TSM", name: "TSMC ADR", market: "US", taiwanImpact: "台積電 ADR 連動台股價格" },
  { finnhubSymbol: "VIX", displaySymbol: "VIX", name: "恐慌指數", market: "US", taiwanImpact: "市場恐慌情緒" },
  { finnhubSymbol: "DXY", displaySymbol: "DXY", name: "美元指數", market: "US", taiwanImpact: "影響外資流向與台幣匯率" },
  { finnhubSymbol: "US10Y", displaySymbol: "US10Y", name: "美國10年債殖利率", market: "US", taiwanImpact: "影響資金成本與科技股估值" },
  { finnhubSymbol: "TAIEX", displaySymbol: "TAIEX", name: "台股加權指數", market: "TW", taiwanImpact: "台股大盤整體風向指標" },
  { finnhubSymbol: "2330", displaySymbol: "2330", name: "台積電", market: "TW", taiwanImpact: "台股權值股龍頭" },
];

// MVP required symbols for safe bias to work
const MVP_REQUIRED = ["NVDA", "TSM", "SPX"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFinnhubQuote(
  finnhubSymbol: string,
  apiKey: string,
  logPrefix: string,
): Promise<FinnhubQuote | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSymbol)}&token=${apiKey}`;

      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const waitMs = 10000 * (attempt + 1);
        console.log(`[${logPrefix}] 429 rate-limited, waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}`);
        await sleep(waitMs);
        continue;
      }

      if (response.status === 503) {
        if (attempt < MAX_RETRIES) {
          console.log(`[${logPrefix}] 503 unavailable, retry ${attempt + 1}/${MAX_RETRIES} after 3s`);
          await sleep(3000);
          continue;
        }
        return null;
      }

      if (!response.ok) {
        console.error(`[${logPrefix}] HTTP ${response.status}, aborting`);
        return null;
      }

      const data: FinnhubQuote = await response.json();

      // Finnhub returns all zeros for invalid/missing symbols
      if (data.c === 0 && data.h === 0 && data.l === 0 && data.o === 0 && data.pc === 0) {
        console.error(`[${logPrefix}] Finnhub returned all-zero quote — symbol may be invalid or unsupported`);
        return null;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      if (isTimeout) {
        console.error(`[${logPrefix}] TIMEOUT after ${FETCH_TIMEOUT_MS / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      } else {
        console.error(`[${logPrefix}] Fetch error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (attempt < MAX_RETRIES) {
        await sleep(3000);
        continue;
      }
      return null;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  const batchTag = `V10.7:${requestId}`;
  const startedMs = Date.now();

  console.log(`[${batchTag}] ======== START ${startedAt} ========`);

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Auth: x-cron-secret ──
    const incomingCronSecret = req.headers.get("x-cron-secret") || "";
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    if (!cronSecret) {
      console.error(`[${batchTag}] CRON_SECRET is not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error", reason: "CRON_SECRET is not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    if (incomingCronSecret !== cronSecret) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // ── Finnhub API Key ──
    const finnhubApiKey = Deno.env.get("FINNHUB_API_KEY") || "";
    if (!finnhubApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing FINNHUB_API_KEY" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    // ── Supabase ──
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing Supabase credentials" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const inserted: Array<{ symbol: string; name: string; value: number; change_percent: number }> = [];
    const failed: string[] = [];
    const allSymbols = SYMBOLS.map((s) => s.displaySymbol);

    // ═══════════════════════════════════════════════════════
    // Fetch all symbols sequentially with delay
    // Overall deadline: OVERALL_TIMEOUT_MS from start
    // Single failure → continue (do not abort batch)
    // ═══════════════════════════════════════════════════════
    let timedOut = false;

    for (let i = 0; i < SYMBOLS.length; i++) {
      // Check overall timeout before each symbol
      if (Date.now() - startedMs > OVERALL_TIMEOUT_MS) {
        console.warn(`[${batchTag}] OVERALL TIMEOUT after ${OVERALL_TIMEOUT_MS / 1000}s — ${SYMBOLS.length - i} symbols skipped`);
        for (let j = i; j < SYMBOLS.length; j++) {
          failed.push(SYMBOLS[j].displaySymbol);
        }
        timedOut = true;
        break;
      }

      const config = SYMBOLS[i];

      if (i > 0) {
        await sleep(SYMBOL_DELAY_MS);
      }

      console.log(`[${batchTag}] [${i + 1}/${SYMBOLS.length}] Fetching ${config.displaySymbol}...`);

      try {
        const quote = await fetchFinnhubQuote(config.finnhubSymbol, finnhubApiKey, `${batchTag}:${config.displaySymbol}`);

        if (!quote) {
          console.error(`[${batchTag}] [${i + 1}/${SYMBOLS.length}] ${config.displaySymbol} fetch returned null`);
          failed.push(config.displaySymbol);
          continue;
        }

        const value = quote.c;
        const changePercent = quote.dp;

        console.log(`[${batchTag}] [${i + 1}/${SYMBOLS.length}] ${config.displaySymbol} ${value} (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`);

        const capturedAt = new Date().toISOString();

        const { error: insertErr } = await supabase
          .from("market_data")
          .upsert({
            symbol: config.displaySymbol,
            name: config.name,
            value: value,
            change_percent: changePercent,
            captured_at: capturedAt,
            updated_at: capturedAt,
            market: config.market,
            taiwan_impact: config.taiwanImpact,
          }, { onConflict: "symbol" });

        if (insertErr) {
          console.error(`[${batchTag}] ${config.displaySymbol} DB error: ${insertErr.message}`);
          failed.push(config.displaySymbol);
          continue;
        }

        inserted.push({
          symbol: config.displaySymbol,
          name: config.name,
          value: value,
          change_percent: changePercent,
        });

        console.log(`[${batchTag}] ${config.displaySymbol} saved to market_data`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${batchTag}] ${config.displaySymbol} exception: ${msg}`);
        failed.push(config.displaySymbol);
      }
    }

    // Determine health
    const mvpSuccess = MVP_REQUIRED.every((s) => inserted.find((i) => i.symbol === s));
    const healthy = mvpSuccess && inserted.length >= 3;

    const elapsed = ((Date.now() - startedMs) / 1000).toFixed(1);

    console.log(`[${batchTag}] DONE in ${elapsed}s | inserted=${inserted.length} failed=${failed.length} healthy=${healthy}${timedOut ? " (timed out)" : ""}`);

    return new Response(
      JSON.stringify({
        success: true,
        version: "V10.7_FINNHUB_ONLY_TIMEOUT_SAFE",
        request_id: requestId,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        elapsed_seconds: parseFloat(elapsed),
        inserted: inserted,
        failed: failed,
        symbols: allSymbols,
        healthy: healthy,
        timed_out: timedOut,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error(`[${batchTag}] FATAL: ${msg}`);
    return new Response(
      JSON.stringify({
        success: false,
        version: "V10.7",
        error: "INTERNAL_ERROR",
        reason: msg,
        inserted: [],
        failed: [],
        symbols: [],
        healthy: false,
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
