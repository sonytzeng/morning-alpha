import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-cron-secret",
};

interface SourceHealth {
  source_name: string;
  source_type: string;
  status: string;
  last_success_at: string | null;
  last_error_at: string | null;
  latest_data_at: string | null;
  records_count: number;
  success_rate: number;
  error_message: string | null;
  symbols: string[];
  metadata: Record<string, unknown>;
}

const SOURCE_DEFS: { name: string; type: string }[] = [
  { name: "FINNHUB", type: "market_data" },
  { name: "TWSE", type: "market_data" },
  { name: "TAIFEX", type: "market_data" },
  { name: "GNEWS", type: "news" },
  { name: "OPENAI", type: "ai_analysis" },
  { name: "SUPABASE_REPORTS", type: "report" },
];

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const logs: string[] = [];
  const warnings: string[] = [];

  console.log(`[HEALTH:${requestId}] start - ${now}`);

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

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
        { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
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
          logs,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const nowDate = new Date();
    const todayStr = nowDate.toISOString().slice(0, 10);

    const hasFinnhubKey = Boolean(Deno.env.get("FINNHUB_API_KEY"));
    logs.push(`FINNHUB_API_KEY: ${hasFinnhubKey ? "present" : "missing"}`);

    let marketDataLatestAt: string | null = null;
    let marketDataCount24h = 0;
    let marketDataSymbols: string[] = [];
    try {
      const { data: mdLatest, error: mdLatestErr } = await supabase
        .from("market_data")
        .select("captured_at, symbol")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mdLatestErr && mdLatest) {
        marketDataLatestAt = mdLatest.captured_at;
      }
      if (mdLatestErr) {
        logs.push(`market_data latest query error: ${mdLatestErr.message}`);
      }

      const { data: mdRecent, error: mdRecentErr } = await supabase
        .from("market_data")
        .select("symbol")
        .gte("captured_at", new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString());
      if (!mdRecentErr && mdRecent) {
        marketDataCount24h = mdRecent.length;
        marketDataSymbols = [...new Set(mdRecent.map((r) => String(r.symbol)).filter(Boolean))];
      }
      if (mdRecentErr) {
        logs.push(`market_data 24h query error: ${mdRecentErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`market_data query exception: ${msg}`);
    }

    let marketNewsLatestAt: string | null = null;
    let marketNewsCount36h = 0;
    let selectedNewsCount36h = 0;
    try {
      const { data: mnLatest, error: mnLatestErr } = await supabase
        .from("market_news")
        .select("published_at")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mnLatestErr && mnLatest) {
        marketNewsLatestAt = mnLatest.published_at;
      }
      if (mnLatestErr) {
        logs.push(`market_news latest query error: ${mnLatestErr.message}`);
      }

      const { data: mnRecent, error: mnRecentErr } = await supabase
        .from("market_news")
        .select("is_selected, taiwan_impact_score")
        .gte("published_at", new Date(nowDate.getTime() - 36 * 60 * 60 * 1000).toISOString());
      if (!mnRecentErr && mnRecent) {
        marketNewsCount36h = mnRecent.length;
        selectedNewsCount36h = mnRecent.filter(
          (r) => r.is_selected === true || r.is_selected === "true"
        ).length;
      }
      if (mnRecentErr) {
        logs.push(`market_news 36h query error: ${mnRecentErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`market_news query exception: ${msg}`);
    }

    let todayReportExists = false;
    let todayReportCreatedAt: string | null = null;
    try {
      const { data: reportData, error: reportErr } = await supabase
        .from("reports")
        .select("created_at")
        .eq("report_date", todayStr)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!reportErr && reportData) {
        todayReportExists = true;
        todayReportCreatedAt = reportData.created_at;
      }
      if (reportErr) {
        logs.push(`reports today query error: ${reportErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`reports query exception: ${msg}`);
    }

    let todayIntradayCheckExists = false;
    let todayIntradayCheckCreatedAt: string | null = null;
    try {
      const { data: intradayData, error: intradayErr } = await supabase
        .from("intraday_checks")
        .select("created_at")
        .eq("check_date", todayStr)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!intradayErr && intradayData) {
        todayIntradayCheckExists = true;
        todayIntradayCheckCreatedAt = intradayData.created_at;
      }
      if (intradayErr) {
        logs.push(`intraday_checks today query error: ${intradayErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`intraday_checks query exception: ${msg}`);
    }

    let hasTaiex = false;
    let hasTxf = false;
    let has2330 = false;
    try {
      const { data: twSymbols, error: twErr } = await supabase
        .from("market_data")
        .select("symbol, captured_at")
        .in("symbol", ["TAIEX", "TXF", "2330"])
        .gte("captured_at", new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString());
      if (!twErr && twSymbols) {
        hasTaiex = twSymbols.some((r) => r.symbol === "TAIEX");
        hasTxf = twSymbols.some((r) => r.symbol === "TXF");
        has2330 = twSymbols.some((r) => r.symbol === "2330");
      }
      if (twErr) {
        logs.push(`TW symbols query error: ${twErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`TW symbols query exception: ${msg}`);
    }

    let hasAiScoredNews = false;
    try {
      const { data: aiNews, error: aiNewsErr } = await supabase
        .from("market_news")
        .select("id")
        .gte("published_at", new Date(nowDate.getTime() - 36 * 60 * 60 * 1000).toISOString())
        .gt("taiwan_impact_score", 0)
        .limit(1);
      if (!aiNewsErr && aiNews && aiNews.length > 0) {
        hasAiScoredNews = true;
      }
      if (aiNewsErr) {
        logs.push(`AI scored news query error: ${aiNewsErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`AI scored news query exception: ${msg}`);
    }

    const sources: SourceHealth[] = [];
    const upsertRecords: Record<string, unknown>[] = [];

    {
      const usSymbols = marketDataSymbols.filter((s) =>
        ["IXIC", "SOX", "SPX", "VIX", "US10Y", "TSM", "NVDA", "AMD", "DXY", "CL"].includes(s)
      );
      const status = hasFinnhubKey ? "healthy" : "warning";
      const errorMsg = hasFinnhubKey ? null : "FINNHUB_API_KEY 尚未設定";
      const source: SourceHealth = {
        source_name: "FINNHUB",
        source_type: "market_data",
        status,
        last_success_at: status === "healthy" ? now : null,
        last_error_at: status !== "healthy" ? now : null,
        latest_data_at: marketDataLatestAt,
        records_count: usSymbols.length,
        success_rate: usSymbols.length > 0 ? 100 : 0,
        error_message: errorMsg,
        symbols: usSymbols,
        metadata: { has_api_key: hasFinnhubKey },
      };
      sources.push(source);
      upsertRecords.push({
        source_name: source.source_name,
        source_type: source.source_type,
        status: source.status,
        last_success_at: source.last_success_at,
        last_error_at: source.last_error_at,
        latest_data_at: source.latest_data_at,
        records_count: source.records_count,
        success_rate: source.success_rate,
        error_message: source.error_message,
        symbols: source.symbols,
        metadata: source.metadata,
        updated_at: now,
      });
    }

    {
      const status = hasTaiex ? "healthy" : "warning";
      const errorMsg = hasTaiex ? null : "尚未取得台股加權指數資料";
      const source: SourceHealth = {
        source_name: "TWSE",
        source_type: "market_data",
        status,
        last_success_at: hasTaiex ? now : null,
        last_error_at: hasTaiex ? null : now,
        latest_data_at: hasTaiex ? marketDataLatestAt : null,
        records_count: hasTaiex ? 1 : 0,
        success_rate: hasTaiex ? 100 : 0,
        error_message: errorMsg,
        symbols: hasTaiex ? ["TAIEX"] : [],
        metadata: { has_2330: has2330 },
      };
      sources.push(source);
      upsertRecords.push({
        source_name: source.source_name,
        source_type: source.source_type,
        status: source.status,
        last_success_at: source.last_success_at,
        last_error_at: source.last_error_at,
        latest_data_at: source.latest_data_at,
        records_count: source.records_count,
        success_rate: source.success_rate,
        error_message: source.error_message,
        symbols: source.symbols,
        metadata: source.metadata,
        updated_at: now,
      });
    }

    {
      const status = hasTxf ? "healthy" : "warning";
      const errorMsg = hasTxf ? null : "尚未取得台指期資料";
      const source: SourceHealth = {
        source_name: "TAIFEX",
        source_type: "market_data",
        status,
        last_success_at: hasTxf ? now : null,
        last_error_at: hasTxf ? null : now,
        latest_data_at: hasTxf ? marketDataLatestAt : null,
        records_count: hasTxf ? 1 : 0,
        success_rate: hasTxf ? 100 : 0,
        error_message: errorMsg,
        symbols: hasTxf ? ["TXF"] : [],
        metadata: {},
      };
      sources.push(source);
      upsertRecords.push({
        source_name: source.source_name,
        source_type: source.source_type,
        status: source.status,
        last_success_at: source.last_success_at,
        last_error_at: source.last_error_at,
        latest_data_at: source.latest_data_at,
        records_count: source.records_count,
        success_rate: source.success_rate,
        error_message: source.error_message,
        symbols: source.symbols,
        metadata: source.metadata,
        updated_at: now,
      });
    }

    {
      let newsStatus: string;
      let newsErrorMsg: string | null = null;
      if (marketNewsLatestAt) {
        const latestNewsTime = new Date(marketNewsLatestAt).getTime();
        const hoursAgo = (nowDate.getTime() - latestNewsTime) / (1000 * 60 * 60);
        if (hoursAgo <= 18 && marketNewsCount36h > 0) {
          newsStatus = "healthy";
        } else if (hoursAgo <= 36 && marketNewsCount36h > 0) {
          newsStatus = "warning";
          newsErrorMsg = `最新新聞已超過 ${Math.floor(hoursAgo)} 小時`;
        } else {
          newsStatus = "error";
          newsErrorMsg = marketNewsCount36h === 0 ? "最近 36 小時無新聞資料" : "最新新聞資料過舊";
        }
      } else {
        newsStatus = "error";
        newsErrorMsg = "無新聞資料";
      }
      const source: SourceHealth = {
        source_name: "GNEWS",
        source_type: "news",
        status: newsStatus,
        last_success_at: newsStatus !== "error" ? now : null,
        last_error_at: newsStatus === "error" ? now : null,
        latest_data_at: marketNewsLatestAt,
        records_count: marketNewsCount36h,
        success_rate: marketNewsCount36h > 0 ? 100 : 0,
        error_message: newsErrorMsg,
        symbols: [],
        metadata: { selected_count: selectedNewsCount36h },
      };
      sources.push(source);
      upsertRecords.push({
        source_name: source.source_name,
        source_type: source.source_type,
        status: source.status,
        last_success_at: source.last_success_at,
        last_error_at: source.last_error_at,
        latest_data_at: source.latest_data_at,
        records_count: source.records_count,
        success_rate: source.success_rate,
        error_message: source.error_message,
        symbols: source.symbols,
        metadata: source.metadata,
        updated_at: now,
      });
    }

    {
      const status = hasAiScoredNews ? "healthy" : "warning";
      const errorMsg = hasAiScoredNews ? null : "尚未產生 AI 新聞評分資料";
      const source: SourceHealth = {
        source_name: "OPENAI",
        source_type: "ai_analysis",
        status,
        last_success_at: hasAiScoredNews ? now : null,
        last_error_at: hasAiScoredNews ? null : now,
        latest_data_at: hasAiScoredNews ? marketNewsLatestAt : null,
        records_count: hasAiScoredNews ? selectedNewsCount36h : 0,
        success_rate: hasAiScoredNews ? 100 : 0,
        error_message: errorMsg,
        symbols: [],
        metadata: {},
      };
      sources.push(source);
      upsertRecords.push({
        source_name: source.source_name,
        source_type: source.source_type,
        status: source.status,
        last_success_at: source.last_success_at,
        last_error_at: source.last_error_at,
        latest_data_at: source.latest_data_at,
        records_count: source.records_count,
        success_rate: source.success_rate,
        error_message: source.error_message,
        symbols: source.symbols,
        metadata: source.metadata,
        updated_at: now,
      });
    }

    {
      const status = todayReportExists ? "healthy" : "warning";
      const errorMsg = todayReportExists ? null : "今日 AI 報告尚未產生";
      const source: SourceHealth = {
        source_name: "SUPABASE_REPORTS",
        source_type: "report",
        status,
        last_success_at: todayReportExists ? now : null,
        last_error_at: todayReportExists ? null : now,
        latest_data_at: todayReportCreatedAt,
        records_count: todayReportExists ? 1 : 0,
        success_rate: todayReportExists ? 100 : 0,
        error_message: errorMsg,
        symbols: [],
        metadata: { has_intraday_check: todayIntradayCheckExists },
      };
      sources.push(source);
      upsertRecords.push({
        source_name: source.source_name,
        source_type: source.source_type,
        status: source.status,
        last_success_at: source.last_success_at,
        last_error_at: source.last_error_at,
        latest_data_at: source.latest_data_at,
        records_count: source.records_count,
        success_rate: source.success_rate,
        error_message: source.error_message,
        symbols: source.symbols,
        metadata: source.metadata,
        updated_at: now,
      });
    }

    try {
      const { error: upsertErr } = await supabase
        .from("market_source_health")
        .upsert(upsertRecords, { onConflict: "source_name" });
      if (upsertErr) {
        logs.push(`market_source_health upsert error: ${upsertErr.message}`);
        warnings.push(`無法更新資料源狀態: ${upsertErr.message}`);
      } else {
        logs.push(`market_source_health upsert success: ${upsertRecords.length} sources`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logs.push(`market_source_health upsert exception: ${msg}`);
      warnings.push(`無法更新資料源狀態: ${msg}`);
    }

    const health = {
      market_data_latest_at: marketDataLatestAt,
      market_data_count_24h: marketDataCount24h,
      market_news_latest_at: marketNewsLatestAt,
      market_news_count_36h: marketNewsCount36h,
      selected_news_count_36h: selectedNewsCount36h,
      today_report_exists: todayReportExists,
      today_report_created_at: todayReportCreatedAt,
      today_intraday_check_exists: todayIntradayCheckExists,
      today_intraday_check_created_at: todayIntradayCheckCreatedAt,
      has_taiex: hasTaiex,
      has_txf: hasTxf,
      has_2330: has2330,
      has_finnhub_key: hasFinnhubKey,
    };

    const responseBody = {
      success: true,
      version: "V1",
      request_id: requestId,
      checked_at: now,
      health,
      sources,
      warnings,
      logs,
    };

    console.log(`[HEALTH:${requestId}] done - ${sources.length} sources checked`);

    return new Response(
      JSON.stringify(responseBody),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (fatalErr) {
    const msg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error(`[HEALTH:${requestId}] FATAL: ${msg}`);
    logs.push(`FATAL: ${msg}`);

    return new Response(
      JSON.stringify({
        success: false,
        error: "INTERNAL_ERROR",
        reason: msg,
        logs,
        warnings: ["資料源健康檢查發生致命錯誤"],
        sources: [],
        health: {},
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
