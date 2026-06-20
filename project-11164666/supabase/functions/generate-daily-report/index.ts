import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// DEPRECATED: superseded by generate-daily-report-v7.
// This legacy function is intentionally disabled to prevent accidental writes to reports.
// ===== AI Daily Report Auto-Generation Engine V6 =====
// Morning Alpha V6: 新聞引用強制版（News-Grounding Enforced）
// 核心原則：
// 1. 雙軌資料來源（market_data + market_news）
// 2. 沒有新鮮資料 = 不產生報告
// 3. 新聞優先、數據輔助
// 4. 強制引用今日新聞關鍵詞
// 5. 驗證失敗 = 自動重試 + 強化 Prompt
// 6. 第二次仍失敗 = 回傳 NEWS_GROUNDING_VALIDATION_FAILED

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info, x-cron-secret',
};

function corsResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

const HOURS_24 = 24 * 60 * 60 * 1000;

// ===== TYPES =====
type MarketRegime =
  | 'STRONG_UP_DAY'
  | 'STRONG_DOWN_DAY'
  | 'RANGE_DAY'
  | 'HOT_BUT_RISKY'
  | 'WEAK_BUT_STABILIZING'
  | 'UNKNOWN';

interface MarketRegimeResult {
  regime: MarketRegime;
  reason: string;
  primaryChange: number;
  primarySymbol: string;
}

interface MarketIndicator {
  symbol: string;
  name: string;
  value: number;
  changePercent: number;
  status: string;
  taiwanImpact: string;
}

interface MarketNewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string | null;
  created_at: string;
  related_sectors: string[] | null;
  taiwan_impact_summary: string | null;
  raw_payload: Record<string, unknown> | null;
}

interface FetchNewsResult {
  newsData: MarketNewsItem[];
  latestNewsTime: Date | null;
  isStale: boolean;
  newsCount: number;
}

interface FreshnessCheck {
  marketDataFresh: boolean;
  newsFresh: boolean;
  latestDataTime: Date | null;
  latestNewsTime: Date | null;
  dataCount: number;
  newsCount: number;
}

// ===== NEW: NewsBrief — 新聞預處理摘要 =====
interface NewsBrief {
  topNews: MarketNewsItem[];
  sectorCounts: Record<string, number>;
  mustMentionKeywords: string[];
  topNewsTitles: string[];
}

// ===== NEW: ValidationResult =====
interface ValidationResult {
  passed: boolean;
  matchedKeywords: string[];
  failReasons: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  return corsResponse(
    {
      success: false,
      error: 'DEPRECATED_FUNCTION_DISABLED',
      reason: 'generate-daily-report is deprecated and no longer writes reports. Use generate-daily-report-v7 via cron-generate-report.',
      replacement: 'generate-daily-report-v7',
    },
    410
  );

  const startTime = Date.now();
  const logs: string[] = [];

  function log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    logs.push(line);
    console.log(line);
  }

  try {
    // === 0. Cron secret auth check ===
    const incomingCronSecret = req.headers.get('x-cron-secret') || '';
    const envCronSecret = Deno.env.get('CRON_SECRET') || '';

    if (!envCronSecret || incomingCronSecret !== envCronSecret) {
      return corsResponse(
        { success: false, error: 'Unauthorized', reason: 'Invalid x-cron-secret' },
        401
      );
    }

    log('=== START: generate-daily-report V6 (News-Grounding Enforced) ===');

    // === 1. Get Supabase client ===
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // === 2. Get OpenAI key ===
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      log('ERROR: OPENAI_API_KEY not configured');
      return corsResponse(
        {
          success: false,
          error: 'OPENAI_API_KEY_NOT_CONFIGURED',
          reason: 'OPENAI_API_KEY not configured in environment',
          logs,
        },
        500
      );
    }

    // === 3. Fetch BOTH market data and market news in parallel ===
    const [marketResult, newsResult] = await Promise.all([
      fetchMarketDataWithFreshness(supabase, log),
      fetchLatestMarketNews(supabase, log),
    ]);

    log(
      `Market data: ${marketResult.dataCount} indicators, latest: ${marketResult.latestDataTime?.toISOString() || 'N/A'}, stale: ${marketResult.isStale}`
    );
    log(
      `Market news: ${newsResult.newsCount} items, latest: ${newsResult.latestNewsTime?.toISOString() || 'N/A'}, stale: ${newsResult.isStale}`
    );

    // === 4. Dual-source freshness check ===
    const freshness: FreshnessCheck = {
      marketDataFresh: !marketResult.isStale && marketResult.dataCount > 0,
      newsFresh: !newsResult.isStale && newsResult.newsCount > 0,
      latestDataTime: marketResult.latestDataTime,
      latestNewsTime: newsResult.latestNewsTime,
      dataCount: marketResult.dataCount,
      newsCount: newsResult.newsCount,
    };

    log(`Freshness: marketDataFresh=${freshness.marketDataFresh}, newsFresh=${freshness.newsFresh}`);

    // === 4.1. STRICT: if BOTH stale/empty, refuse to generate ===
    if (!freshness.marketDataFresh && !freshness.newsFresh) {
      log('ERROR: Both market_data and market_news are stale or empty. Refusing to generate fake report.');
      return corsResponse(
        {
          success: false,
          error: 'NO_FRESH_MARKET_DATA',
          reason: `Both market_data and market_news are empty or stale. Latest data: ${marketResult.latestDataTime?.toISOString() || 'none'}, latest news: ${newsResult.latestNewsTime?.toISOString() || 'none'}. Daily report was NOT generated.`,
          latest_market_data_time: marketResult.latestDataTime?.toISOString() || null,
          latest_news_time: newsResult.latestNewsTime?.toISOString() || null,
          market_data_count: marketResult.dataCount,
          market_news_count: newsResult.newsCount,
          logs,
        },
        500
      );
    }

    // === 5. Detect market regime from real data (market_data first, news assists) ===
    const regimeResult = detectMarketRegime(marketResult.marketData, newsResult.newsData);
    log(
      `Market regime: ${regimeResult.regime} (primary: ${regimeResult.primarySymbol} ${regimeResult.primaryChange >= 0 ? '+' : ''}${regimeResult.primaryChange.toFixed(2)}%) — ${regimeResult.reason}`
    );

    // === 6. Fetch yesterday's report for context ===
    const yesterdayReport = await fetchYesterdayReport(supabase, log);
    log(`Yesterday report: ${yesterdayReport ? yesterdayReport.report_date : 'none found'}`);

    // === 7. NEW V6: Build NewsBrief with mustMentionKeywords ===
    const newsBrief = buildNewsBrief(newsResult.newsData);
    log(`NewsBrief: topNews=${newsBrief.topNews.length}, mustMentionKeywords=${newsBrief.mustMentionKeywords.join(', ')}`);
    log(`SectorCounts top 5: ${Object.entries(newsBrief.sectorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join(', ')}`);

    // === 8. Build V6 strategic AI prompt with news-grounding rules ===
    const prompt = buildSystemPromptV6(
      marketResult.marketData,
      newsResult.newsData,
      yesterdayReport,
      regimeResult,
      freshness,
      newsBrief
    );
    log(`Prompt built: V6 with mustMentionKeywords=[${newsBrief.mustMentionKeywords.join(', ')}]`);

    // === 9. First OpenAI call ===
    const aiResult1 = await callOpenAI(openaiKey, prompt, log, 'V6-attempt-1');
    if (!aiResult1) {
      log('ERROR: OpenAI attempt 1 returned null');
      return corsResponse(
        {
          success: false,
          error: 'OPENAI_GENERATION_FAILED',
          reason: 'OpenAI returned null or invalid JSON on first attempt',
          logs,
        },
        500
      );
    }

    // === 10. Validate first attempt against news ===
    const validation1 = validateReportAgainstNews(aiResult1, newsResult.newsData, newsBrief);
    log(`Validation attempt 1: passed=${validation1.passed}, matched=[${validation1.matchedKeywords.join(', ')}]`);
    if (!validation1.passed) {
      log(`Validation failed reasons: ${validation1.failReasons.join('; ')}`);
    }

    let finalAiResult: Record<string, unknown>;
    let validationResult: ValidationResult;

    if (validation1.passed) {
      finalAiResult = aiResult1;
      validationResult = validation1;
      log('V6: First attempt passed validation — proceeding');
    } else {
      // === 11. Retry with stronger news-grounding hint ===
      log('V6: First attempt failed validation — retrying with stronger news-grounding prompt');
      const retryPrompt = buildRetryPromptV6(prompt, newsBrief, validation1);
      const aiResult2 = await callOpenAI(openaiKey, retryPrompt, log, 'V6-attempt-2');

      if (!aiResult2) {
        log('ERROR: OpenAI attempt 2 returned null');
        return corsResponse(
          {
            success: false,
            error: 'OPENAI_GENERATION_FAILED',
            reason: 'OpenAI returned null or invalid JSON on retry',
            must_mention_keywords: newsBrief.mustMentionKeywords,
            logs,
          },
          500
        );
      }

      const validation2 = validateReportAgainstNews(aiResult2, newsResult.newsData, newsBrief);
      log(`Validation attempt 2: passed=${validation2.passed}, matched=[${validation2.matchedKeywords.join(', ')}]`);
      if (!validation2.passed) {
        log(`Validation 2 failed reasons: ${validation2.failReasons.join('; ')}`);
      }

      if (validation2.passed) {
        finalAiResult = aiResult2;
        validationResult = validation2;
        log('V6: Second attempt passed validation — proceeding');
      } else {
        // Both attempts failed — return NEWS_GROUNDING_VALIDATION_FAILED
        log('ERROR: Both attempts failed news-grounding validation. Refusing to write report.');
        return corsResponse(
          {
            success: false,
            error: 'NEWS_GROUNDING_VALIDATION_FAILED',
            reason: 'AI output did not sufficiently reference today\'s news after two attempts',
            must_mention_keywords: newsBrief.mustMentionKeywords,
            attempt1_fail_reasons: validation1.failReasons,
            attempt2_fail_reasons: validation2.failReasons,
            top_news_titles: newsBrief.topNewsTitles,
            logs,
          },
          500
        );
      }
    }

    // === 12. Normalize with freshness-based confidence clamping ===
    const report = normalizeReportV6(finalAiResult, freshness, newsBrief);
    log(`Report normalized: bias=${report.market_bias}, confidence=${report.confidence_score}, label=${report.confidence_label}`);

    // === 13. Build allowed payload (only DB columns that exist) ===
    const allowedPayload = buildAllowedReportPayload(report);
    log(`Allowed payload keys: ${Object.keys(allowedPayload).join(', ')}`);

    // === 14. Upsert to reports table ===
    const today = new Date().toISOString().slice(0, 10);
    const { error: upsertError } = await supabase
      .from('reports')
      .upsert(
        {
          report_date: today,
          ...allowedPayload,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'report_date' }
      );

    if (upsertError) {
      log(`ERROR: DB upsert failed: ${upsertError.message}`);
      return corsResponse(
        {
          success: false,
          error: 'DATABASE_UPSERT_FAILED',
          reason: `Database upsert failed: ${upsertError.message}`,
          detail: upsertError.message,
          logs,
        },
        500
      );
    }

    log(`SUCCESS: Report upserted for ${today}`);
    const duration = Date.now() - startTime;
    log(`Total duration: ${duration}ms`);

    return corsResponse(
      {
        success: true,
        report_date: today,
        market_regime: regimeResult.regime,
        latest_market_data_time: freshness.latestDataTime?.toISOString() || null,
        latest_news_time: freshness.latestNewsTime?.toISOString() || null,
        market_data_count: freshness.dataCount,
        market_news_count: freshness.newsCount,
        market_data_fresh: freshness.marketDataFresh,
        market_news_fresh: freshness.newsFresh,
        market_bias: report.market_bias,
        summary: report.summary,
        today_quote: report.today_quote,
        // V6 new fields
        news_grounding_passed: validationResult.passed,
        must_mention_keywords: newsBrief.mustMentionKeywords,
        matched_keywords: validationResult.matchedKeywords,
        top_news_titles: newsBrief.topNewsTitles,
        duration_ms: duration,
        logs,
      },
      200
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FATAL ERROR: ${msg}`);
    return corsResponse(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        reason: msg,
        logs,
      },
      500
    );
  }
});

// ===== FETCH MARKET DATA WITH FRESHNESS CHECK =====
async function fetchMarketDataWithFreshness(
  supabase: ReturnType<typeof createClient>,
  log: (msg: string) => void
): Promise<{
  marketData: MarketIndicator[];
  latestDataTime: Date | null;
  isStale: boolean;
  dataCount: number;
}> {
  try {
    const { data, error } = await supabase
      .from('market_data')
      .select('*')
      .order('captured_at', { ascending: false })
      .limit(30);

    if (error) {
      log(`ERROR: market_data query failed: ${error.message}`);
      return { marketData: [], latestDataTime: null, isStale: true, dataCount: 0 };
    }

    if (!data || data.length === 0) {
      log('WARN: market_data table is EMPTY');
      return { marketData: [], latestDataTime: null, isStale: true, dataCount: 0 };
    }

    let latestDataTime: Date | null = null;
    for (const row of data) {
      const t = row.captured_at || row.created_at;
      if (t) {
        const d = new Date(t);
        if (!latestDataTime || d > latestDataTime) latestDataTime = d;
      }
    }

    const now = Date.now();
    const isStale = !latestDataTime || now - latestDataTime.getTime() > HOURS_24;

    if (isStale) {
      log(`WARN: market_data stale. Latest: ${latestDataTime?.toISOString() || 'none'}`);
    }

    const marketData: MarketIndicator[] = data.map((row: Record<string, unknown>) => ({
      symbol: String(row.symbol || ''),
      name: String(row.name || ''),
      value: Number(row.value) || 0,
      changePercent: Number(row.change_percent) || 0,
      status: String(row.status || 'flat'),
      taiwanImpact: String(row.taiwan_impact || ''),
    }));

    return { marketData, latestDataTime, isStale, dataCount: data.length };
  } catch (err) {
    log(`ERROR: fetchMarketDataWithFreshness exception: ${err instanceof Error ? err.message : String(err)}`);
    return { marketData: [], latestDataTime: null, isStale: true, dataCount: 0 };
  }
}

// ===== FETCH LATEST MARKET NEWS =====
async function fetchLatestMarketNews(
  supabase: ReturnType<typeof createClient>,
  log: (msg: string) => void
): Promise<FetchNewsResult> {
  try {
    const { data, error } = await supabase
      .from('market_news')
      .select('id, title, source, url, published_at, created_at, related_sectors, taiwan_impact_summary, raw_payload')
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      log(`ERROR: market_news query failed: ${error.message}`);
      return { newsData: [], latestNewsTime: null, isStale: true, newsCount: 0 };
    }

    if (!data || data.length === 0) {
      log('WARN: market_news table is EMPTY');
      return { newsData: [], latestNewsTime: null, isStale: true, newsCount: 0 };
    }

    let latestNewsTime: Date | null = null;
    for (const row of data) {
      const t = row.published_at || row.created_at;
      if (t) {
        const d = new Date(t);
        if (!latestNewsTime || d > latestNewsTime) latestNewsTime = d;
      }
    }

    const now = Date.now();
    const isStale = !latestNewsTime || now - latestNewsTime.getTime() > HOURS_24;

    if (isStale) {
      log(`WARN: market_news stale. Latest: ${latestNewsTime?.toISOString() || 'none'}`);
    } else {
      log(`OK: market_news fresh. Latest: ${latestNewsTime?.toISOString()}, count: ${data.length}`);
    }

    const newsData: MarketNewsItem[] = data.map((row: Record<string, unknown>) => ({
      id: String(row.id || ''),
      title: String(row.title || ''),
      source: String(row.source || ''),
      url: String(row.url || ''),
      published_at: row.published_at ? String(row.published_at) : null,
      created_at: String(row.created_at || ''),
      related_sectors: Array.isArray(row.related_sectors) ? row.related_sectors : null,
      taiwan_impact_summary: row.taiwan_impact_summary ? String(row.taiwan_impact_summary) : null,
      raw_payload: row.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload as Record<string, unknown> : null,
    }));

    return { newsData, latestNewsTime, isStale, newsCount: data.length };
  } catch (err) {
    log(`ERROR: fetchLatestMarketNews exception: ${err instanceof Error ? err.message : String(err)}`);
    return { newsData: [], latestNewsTime: null, isStale: true, newsCount: 0 };
  }
}

// ===== NEW V6: BUILD NEWS BRIEF =====
function buildNewsBrief(newsData: MarketNewsItem[]): NewsBrief {
  const topNews = newsData.slice(0, 8);
  const topNewsTitles = topNews.map((n) => n.title).filter(Boolean);

  // Count sector frequencies
  const sectorCounts: Record<string, number> = {};
  for (const news of newsData) {
    if (Array.isArray(news.related_sectors)) {
      for (const sector of news.related_sectors) {
        if (sector && typeof sector === 'string') {
          const s = sector.trim();
          if (s) sectorCounts[s] = (sectorCounts[s] || 0) + 1;
        }
      }
    }
  }

  // Extract must-mention keywords from top news titles and taiwan_impact_summary
  const mustMentionKeywords = extractMustMentionKeywords(topNews, sectorCounts);

  return { topNews, sectorCounts, mustMentionKeywords, topNewsTitles };
}

// ===== NEW V6: EXTRACT MUST-MENTION KEYWORDS =====
function extractMustMentionKeywords(
  topNews: MarketNewsItem[],
  sectorCounts: Record<string, number>
): string[] {
  const keywords: string[] = [];

  // Priority 1: Well-known company / entity names from titles
  const importantEntities = [
    // Companies
    'Nvidia', 'NVIDIA', 'AMD', 'Intel', 'TSMC', 'SK Hynix', 'Samsung', 'Apple', 'Microsoft', 'Google', 'Meta',
    'Broadcom', 'Qualcomm', 'ASML', 'Applied Materials', 'Micron', 'Tesla', 'Amazon', 'Alibaba', 'Tencent',
    // Macro indicators / events
    'Fed', 'Federal Reserve', 'FOMC', 'Powell', 'tariff', 'Tariff', 'tariffs',
    'oil', 'Oil', 'crude', 'Crude', 'WTI', 'Brent',
    'dollar', 'Dollar', 'DXY', 'USD',
    'bond', 'Bond', 'yield', 'Yield',
    'gold', 'Gold',
    'bitcoin', 'Bitcoin', 'BTC', 'crypto', 'Crypto',
    // Markets
    'Asian stocks', 'Asian market', 'Taiwan', 'TAIEX',
    'S&P', 'Nasdaq', 'SOX', 'semiconductor',
    'CPI', 'inflation', 'Inflation', 'GDP', 'employment',
    // Sectors
    'AI server', 'AI chip', 'memory', 'Memory', 'HBM', 'CoWoS',
    'shipping', 'Shipping', 'freight',
    'banking', 'Bank', 'financial', 'Financial',
    'biotech', 'Biotech', 'pharma', 'Pharma',
    'EV', 'electric vehicle', 'Electric Vehicle',
    'solar', 'Solar', 'energy', 'Energy',
  ];

  // Scan top news titles for important entities
  const allTitleText = topNews.map((n) => `${n.title || ''} ${n.taiwan_impact_summary || ''}`).join(' ');
  for (const entity of importantEntities) {
    if (allTitleText.toLowerCase().includes(entity.toLowerCase()) && !keywords.includes(entity)) {
      keywords.push(entity);
      if (keywords.length >= 6) break;
    }
  }

  // Priority 2: If not enough from companies, extract uppercase words from titles
  if (keywords.length < 3) {
    for (const news of topNews) {
      if (!news.title) continue;
      // Match proper nouns: capitalized words, all-caps abbreviations, known financial terms
      const matches = news.title.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*|[A-Z]{2,}(?:\s[A-Z]{2,})*)\b/g) || [];
      for (const match of matches) {
        const cleaned = match.trim();
        if (
          cleaned.length > 2 &&
          !['The', 'A', 'An', 'In', 'On', 'At', 'By', 'For', 'Of', 'To', 'Up', 'As', 'Is', 'Be', 'It', 'Or', 'And', 'But', 'So', 'Yet', 'Nor', 'ETF', 'IPO'].includes(cleaned) &&
          !keywords.includes(cleaned)
        ) {
          keywords.push(cleaned);
          if (keywords.length >= 6) break;
        }
      }
      if (keywords.length >= 6) break;
    }
  }

  // Priority 3: Top sectors from sectorCounts
  if (keywords.length < 3) {
    const topSectors = Object.entries(sectorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);
    for (const sector of topSectors) {
      if (!keywords.includes(sector)) {
        keywords.push(sector);
        if (keywords.length >= 6) break;
      }
    }
  }

  // Ensure at least 3 keywords — use first news title words as last resort
  if (keywords.length < 3 && topNews.length > 0) {
    const firstTitle = topNews[0].title || '';
    const words = firstTitle.split(/\s+/).filter((w) => w.length > 3);
    for (const word of words) {
      if (!keywords.includes(word)) {
        keywords.push(word);
        if (keywords.length >= 3) break;
      }
    }
  }

  return keywords.slice(0, 6);
}

// ===== NEW V6: VALIDATE REPORT AGAINST NEWS =====
function validateReportAgainstNews(
  report: Record<string, unknown>,
  newsData: MarketNewsItem[],
  newsBrief: NewsBrief
): ValidationResult {
  const failReasons: string[] = [];
  const matchedKeywords: string[] = [];

  // Combine summary + today_summary + important_news_json text for keyword matching
  const summaryText = String(report.summary || '');
  const todaySummaryText = String(report.today_summary || '');
  const importantNewsText = JSON.stringify(report.important_news_json || []);
  const combinedText = `${summaryText} ${todaySummaryText} ${importantNewsText}`;

  // Rule 1: Must mention at least 2 of mustMentionKeywords
  for (const kw of newsBrief.mustMentionKeywords) {
    if (combinedText.toLowerCase().includes(kw.toLowerCase())) {
      matchedKeywords.push(kw);
    }
  }
  if (matchedKeywords.length < 2) {
    failReasons.push(
      `Only ${matchedKeywords.length}/2 required keywords mentioned. Missing: [${newsBrief.mustMentionKeywords.filter((k) => !matchedKeywords.includes(k)).join(', ')}]`
    );
  }

  // Rule 2: important_news_json must have at least 2 items with real titles from market_news
  const importantNewsArr = Array.isArray(report.important_news_json) ? report.important_news_json as Record<string, unknown>[] : [];
  if (importantNewsArr.length < 2) {
    failReasons.push(`important_news_json has only ${importantNewsArr.length} items (need >= 2)`);
  } else {
    // Check if at least 1 title matches a real news title
    const realTitles = newsData.map((n) => n.title.toLowerCase().trim());
    const hasRealTitle = importantNewsArr.some((item) => {
      const itemTitle = String(item.title || '').toLowerCase().trim();
      // Allow partial match (title contains or is contained in real title)
      return realTitles.some((rt) => {
        if (!rt || !itemTitle) return false;
        return rt.includes(itemTitle.slice(0, 20)) || itemTitle.includes(rt.slice(0, 20));
      });
    });
    if (!hasRealTitle) {
      failReasons.push('important_news_json titles do not match any real market_news titles');
    }
  }

  // Rule 3: watch_sectors_json must have at least 2 items
  const watchSectorsArr = Array.isArray(report.watch_sectors_json) ? report.watch_sectors_json as Record<string, unknown>[] : [];
  if (watchSectorsArr.length < 2) {
    failReasons.push(`watch_sectors_json has only ${watchSectorsArr.length} items (need >= 2)`);
  }

  // Rule 4: summary/today_summary must not be generic-only (if it only mentions AI/半導體 without specific names)
  const genericOnlyPattern = /^[^a-zA-Z\u4e00-\u9fa5]*?(AI|半導體|ETF|不要追高)[^a-zA-Z\u4e00-\u9fa5]*$/i;
  const summaryOnlyGeneric = (
    (summaryText.toLowerCase().includes('ai') || summaryText.includes('半導體') || summaryText.includes('etf')) &&
    matchedKeywords.length === 0
  );
  if (summaryOnlyGeneric) {
    failReasons.push('summary contains only generic terms (AI/半導體/ETF) without specific news references');
  }

  return {
    passed: failReasons.length === 0,
    matchedKeywords,
    failReasons,
  };
}

// ===== NEW V6: BUILD RETRY PROMPT =====
function buildRetryPromptV6(
  originalPrompt: string,
  newsBrief: NewsBrief,
  validation: ValidationResult
): string {
  const retryHeader = `【重要：上一版內容未通過新聞引用驗證】

驗證失敗原因：
${validation.failReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

你必須重新生成，並強制在 summary、today_summary、important_news_json 中引用以下關鍵詞中的至少 2 個：

必須引用關鍵詞：${newsBrief.mustMentionKeywords.join('、')}

今天前 8 則新聞標題（important_news_json 必須來自這裡，不可憑空生成）：
${newsBrief.topNewsTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

禁止：
- 不得只寫「AI 類股表現」「半導體受到關注」「ETF 適合保守」等空泛句子
- 不得讓 summary 看起來和昨天一樣
- 不得讓 important_news_json 裡出現「市場動態」這種無意義標題

請重新生成完整 JSON，確保：
1. summary 必須出現至少 1 個具體新聞名稱或事件
2. today_summary 必須出現至少 1 個具體新聞名稱或事件  
3. important_news_json 前 2 筆的 title 必須來自上方新聞列表
4. watch_sectors_json 必須根據新聞 related_sectors 統整，至少 2 個不同族群

---

`;

  return retryHeader + originalPrompt;
}

// ===== MARKET REGIME DETECTOR =====
function detectMarketRegime(marketData: MarketIndicator[], newsData: MarketNewsItem[]): MarketRegimeResult {
  const findBySymbols = (symbols: string[]) => {
    for (const sym of symbols) {
      const found = marketData.find((m) => m.symbol.toUpperCase() === sym.toUpperCase());
      if (found) return found;
    }
    return null;
  };

  const taiwanSymbols = ['TAIEX', 'TWII', 'TX', 'TAIEX_FUTURES'];
  const taiwan = findBySymbols(taiwanSymbols);

  const usSymbols = ['SOX', 'IXIC', 'SPX', 'SP500'];
  const us = findBySymbols(usSymbols);

  let primary: MarketIndicator | null = null;
  let primarySource = '';

  if (taiwan) {
    primary = taiwan;
    primarySource = 'Taiwan';
  } else if (us) {
    primary = us;
    primarySource = 'US';
  } else {
    const significant = marketData.find((m) => Math.abs(m.changePercent) >= 0.5);
    if (significant) {
      primary = significant;
      primarySource = 'fallback';
    }
  }

  // If no market data, infer from news
  if (!primary && newsData.length > 0) {
    const sentiment = inferNewsSentiment(newsData);
    if (sentiment !== 0) {
      const change = sentiment;
      if (change >= 1.0) return { regime: 'STRONG_UP_DAY', reason: `News sentiment strongly positive`, primaryChange: change, primarySymbol: 'NEWS' };
      if (change <= -1.0) return { regime: 'STRONG_DOWN_DAY', reason: `News sentiment strongly negative`, primaryChange: change, primarySymbol: 'NEWS' };
      if (change >= 0.5) return { regime: 'HOT_BUT_RISKY', reason: `News sentiment positive`, primaryChange: change, primarySymbol: 'NEWS' };
      if (change <= -0.5) return { regime: 'WEAK_BUT_STABILIZING', reason: `News sentiment negative`, primaryChange: change, primarySymbol: 'NEWS' };
      return { regime: 'RANGE_DAY', reason: `News sentiment neutral`, primaryChange: change, primarySymbol: 'NEWS' };
    }
  }

  if (!primary) {
    return { regime: 'UNKNOWN', reason: 'No recognizable market indicators or news sentiment found', primaryChange: 0, primarySymbol: 'N/A' };
  }

  const change = primary.changePercent;

  if (change >= 1.0) return { regime: 'STRONG_UP_DAY', reason: `${primarySource} ${primary.symbol} up ${change.toFixed(2)}%`, primaryChange: change, primarySymbol: primary.symbol };
  if (change <= -1.0) return { regime: 'STRONG_DOWN_DAY', reason: `${primarySource} ${primary.symbol} down ${change.toFixed(2)}%`, primaryChange: change, primarySymbol: primary.symbol };
  if (change >= 0.5) return { regime: 'HOT_BUT_RISKY', reason: `${primarySource} ${primary.symbol} up ${change.toFixed(2)}%, hot but moderate`, primaryChange: change, primarySymbol: primary.symbol };
  if (change <= -0.5) return { regime: 'WEAK_BUT_STABILIZING', reason: `${primarySource} ${primary.symbol} down ${change.toFixed(2)}%, weak but stabilizing`, primaryChange: change, primarySymbol: primary.symbol };

  return { regime: 'RANGE_DAY', reason: `${primarySource} ${primary.symbol} ${change >= 0 ? '+' : ''}${change.toFixed(2)}%, within range`, primaryChange: change, primarySymbol: primary.symbol };
}

function inferNewsSentiment(newsData: MarketNewsItem[]): number {
  let score = 0;
  let count = 0;

  const bullishKeywords = ['大漲', '強勢', '上漲', '偏多', '熱潮', '突破', '領漲', '創高', '強勁', '復甦', '樂觀', '看好', '升溫', '反彈', '資金流入', '買盤', '多頭'];
  const bearishKeywords = ['大跌', '重挫', '弱勢', '下跌', '偏空', '崩跌', '跳水', '殺盤', '悲觀', '看淡', '降溫', '賣壓', '資金流出', '空頭', '修正', '回落', '走弱'];

  for (const news of newsData) {
    const text = `${news.title || ''} ${news.taiwan_impact_summary || ''}`;
    if (!text) continue;

    const hasBullish = bullishKeywords.some((k) => text.includes(k));
    const hasBearish = bearishKeywords.some((k) => text.includes(k));

    if (hasBullish && !hasBearish) score += 1;
    else if (hasBearish && !hasBullish) score -= 1;
    count += 1;
  }

  if (count === 0) return 0;
  return (score / count) * 1.5;
}

// ===== FETCH YESTERDAY'S REPORT =====
async function fetchYesterdayReport(
  supabase: ReturnType<typeof createClient>,
  log: (msg: string) => void
): Promise<Record<string, unknown> | null> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('reports')
      .select('today_quote, market_bias, confidence_score, summary, today_summary, avoid_today, important_news_json, report_date')
      .eq('report_date', yStr)
      .maybeSingle();

    if (error) {
      log(`WARN: yesterday report fetch failed: ${error.message}`);
      return null;
    }
    return data;
  } catch (err) {
    log(`WARN: fetchYesterdayReport exception: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ===== AI PROMPT BUILDER V6 =====
function buildSystemPromptV6(
  marketData: MarketIndicator[],
  newsData: MarketNewsItem[],
  yesterdayReport: Record<string, unknown> | null,
  regime: MarketRegimeResult,
  freshness: FreshnessCheck,
  newsBrief: NewsBrief
): string {
  const mdText = marketData
    .map((m) => {
      const emoji = m.changePercent > 0 ? '▲' : m.changePercent < 0 ? '▼' : '—';
      return `- ${m.name} (${m.symbol}): ${m.value.toLocaleString()} (${emoji}${Math.abs(m.changePercent).toFixed(2)}%) — ${m.taiwanImpact}`;
    })
    .join('\n');

  const newsText = newsData
    .map((n, i) => {
      const time = n.published_at || n.created_at;
      const sectors = Array.isArray(n.related_sectors) ? n.related_sectors.join('、') : '—';
      return `${i + 1}. 【${n.source}】${n.title}\n   時間：${time || '未知'} | 相關族群：${sectors}\n   台股影響：${n.taiwan_impact_summary || '暫無摘要'}`;
    })
    .join('\n\n');

  const yesterdayContext = yesterdayReport
    ? `昨天 AI 說：「${yesterdayReport.today_quote || yesterdayReport.summary || '整理市場情緒'}」，判斷為 ${yesterdayReport.market_bias || '中性'}。
昨天 summary 主要角度：${yesterdayReport.today_summary || yesterdayReport.summary || ''}
昨天 avoid_today：${Array.isArray(yesterdayReport.avoid_today) ? yesterdayReport.avoid_today.join('；') : ''}
昨天重要新聞：${Array.isArray(yesterdayReport.important_news_json) ? (yesterdayReport.important_news_json as Record<string, unknown>[]).map((n) => n.title || '').join('、') : ''}`
    : '這是第一天生成報告，沒有昨天內容可參考。';

  const dataFreshnessNote = freshness.marketDataFresh
    ? '市場數據（market_data）為最新，可供今日判斷參考。'
    : '市場數據（market_data）已較舊，只能當背景，不可當成今日盤勢。今日判斷必須以新聞為主。';

  const newsFreshnessNote = freshness.newsFresh
    ? '今日新聞（market_news）為最新，是今日判斷的主要依據。'
    : '今日新聞（market_news）已較舊，無法作為今日主要依據。';

  const regimeInstructions = buildRegimeInstructions(regime.regime);

  // V6: top sector summary
  const topSectors = Object.entries(newsBrief.sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}(出現${v}次)`)
    .join('、');

  return `你叫 Morning Alpha，是每天盤前陪使用者冷靜下來的 AI 盤前軍師。

你不是新聞網站。不是數據平台。不是投顧老師。不是分析師報告。
你像一個真正看過很多市場循環、經歷過多次崩盤與復甦的成熟交易者。
你從不喊單、不報明牌、不說「穩賺」。
你每天 07:30 出現在使用者面前，用一句話幫他們在開盤前穩住情緒、建立判斷框架。

## 你的核心人格
- 冷靜、理性、不追高、重視風險、像看過很多市場循環的人
- 不浮誇、不喊單、不報明牌、不像投顧老師
- 更像真正成熟交易者，像每天早上提醒你的 AI
- 你關心的是「使用者今天會不會因為情緒做錯決定」
- 你有情緒感、有溫度、有人味

## 你的語氣
- 白話、有節奏、有情緒、有紀律感
- 說話像一個有經驗的朋友在旁邊輕輕提醒
- 禁止「本研究建議」、「據分析顯示」等論文感詞彙
- 禁止太像機器、太像分析師報告

## 禁止（絕對不能出現）
- 不可保證獲利、不可報明牌、不可給買進價、賣出價、目標價
- 不可說穩賺、不可使用投顧喊單語氣
- 不可使用過度艱深術語（可以用但要馬上白話解釋）
- 不可每次都重複「AI、半導體、ETF、不要追高」（除非今日新聞真的提到）
- 不可空泛摘要、無聊財經新聞語氣
- 每次內容要有差異，用不同角度切入
- 不可出現「推薦做多」、「推薦做空」、「推薦指數」、「今日推薦」、「明牌」、「飆股」、「必漲」、「必跌」、「建議買進」、「建議賣出」、「進場點」、「出場點」、「目標價」、「老師帶單」、「保證獲利」
- 不可出現簡體中文

## 資料來源狀態
${dataFreshnessNote}
${newsFreshnessNote}

## 今日市場狀態
${regimeInstructions}

## 市場數據（背景參考）
${mdText || '（無最新市場數據）'}

## 今日最新新聞（這是今日判斷的核心依據，必須優先使用）
${newsText || '（無最新新聞）'}

## 今日新聞族群分佈（來自 related_sectors 統計）
${topSectors || '（無族群資料）'}

## 昨天內容（供參考，避免重複相同角度）
${yesterdayContext}

## ★★★ V6 核心規則：新聞引用強制 ★★★

以下是今天必須引用的新聞關鍵詞，summary、today_summary、important_news_json 至少要引用其中 2 個：
【必須引用關鍵詞】：${newsBrief.mustMentionKeywords.join('、')}

今天前 8 則新聞標題（important_news_json 的 title 必須來自這裡，不可憑空生成）：
${newsBrief.topNewsTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

新聞引用強制規則：
1. summary 必須明確引用 important_news_json 前 3 筆中至少 1 筆新聞的事件或名稱。
2. today_summary 必須明確引用 important_news_json 前 3 筆中至少 1 筆新聞的事件或名稱。
3. watch_sectors_json 必須從今日新聞 related_sectors 統整，不可只憑印象寫 AI / 半導體 / ETF。
4. 如果新聞裡有 SK Hynix、Nvidia、Fed、油價、美債、關稅、航運、金融、生技等具體事件，summary 或 today_summary 必須至少提到一個具體名稱。
5. 禁止 summary 只寫通用句，例如：「今天市場情緒明顯向好」「半導體和AI受到青睞」「切勿急著追高」。
6. 禁止每天固定輸出 AI、半導體、ETF（除非今日新聞真的提到這些族群）。
7. 如果新聞涉及多個不同族群，watch_sectors_json 必須至少包含 2 個不同族群。
8. 如果新聞只有科技類，仍必須具體寫出新聞來源或事件，例如 SK Hynix 記憶體、Nvidia AI 晶片，而不是只寫「AI 族群」。

## 避免重複規則
1. 今天內容不得重複昨天 today_quote 的角度或句子
2. 不得重複昨天 summary 的主要觀點
3. 不得每天都寫 AI / 半導體 / ETF / 不要追高（除非今日有相關新聞）
4. 必須根據今日市場狀態與新聞改寫角度
5. 若昨天已經提醒「不要追第一根」，今天不要又寫同樣的話
6. 若昨天已經提醒「不要情緒進場」，今天換一個角度
7. 如果昨天已經提到某新聞，今天不要重複同一條新聞

## 輸出格式（嚴格 JSON，不要任何其他文字）

{
  "today_quote": "今天最有力量的一句話，30字以內，有情緒感，像軍師在耳邊提醒。必須跟昨天不同。",
  "market_bias": "偏多" 或 "偏空" 或 "中性" 或 "震盪偏多" 或 "震盪偏空",
  "confidence_score": 0~100 的整數,
  "confidence_label": "盤前資料一致性標籤",
  "summary": "用 1~2 句話總結今天市場氛圍。必須出現具體新聞事件或名稱，不可只有空泛句子。",
  "today_strategy": {
    "do": ["今天適合做的事，根據今日新聞與市場狀態，最多4項"],
    "avoid": ["今天不要做的事，最多4項"]
  },
  "can_watch": ["觀察方向，根據今日新聞，2~3項"],
  "avoid_today": ["避免方向，2~3項"],
  "watch_sectors_detailed": [
    {
      "sector": "族群名稱（必須來自今日新聞 related_sectors）",
      "aiObservation": "AI 一句觀察，必須提及具體新聞事件",
      "isOverheated": true 或 false,
      "isSuitableToChase": true 或 false,
      "riskLevel": "low" 或 "medium" 或 "high"
    }
  ],
  "fear_greed": 貪婪指數數值 0~100,
  "fear_greed_summary": "用一句白話解釋貪婪指數對新手的意義",
  "vix": VIX 數值,
  "vix_summary": "用一句白話解釋 VIX",
  "nasdaq_change": Nasdaq 漲跌幅數字,
  "sp500_change": S&P500 漲跌幅數字,
  "sox_change": 費城半導體漲跌幅數字,
  "taiex_futures_change": 台指期夜盤漲跌幅數字,
  "dxy": 美元指數數值,
  "us_bond_yield": 美國十年債殖利率數值,
  "gold_price": 黃金價格,
  "oil_price": 原油價格,
  "btc_price": 比特幣價格,
  "risk_factors_json": [
    {"title": "風險名稱（根據今日新聞）", "level": "low/medium/high", "description": "用一句白話解釋"}
  ],
  "ai_psychology": "AI 心理提醒，今天散戶最容易犯的心理錯誤，40字以內",
  "ai_retail_reminder": "AI 對散戶的具體提醒，根據今日新聞，50字以內",
  "ai_confidence_reason": "AI 為什麼這樣判斷，2~3 句話。如果數據舊而新聞新，請說明『市場數據較舊，今日判斷以新聞與情緒線索為主』",
  "watch_sectors_json": [
    {"sector": "族群名稱（必須來自今日新聞 related_sectors，不可固定 AI/半導體/ETF）", "direction": "偏多/中性/偏空", "reason": "一句話，必須提及具體新聞或事件"}
  ],
  "focus_stock_json": [
    {"group": "族群名稱", "direction": "偏多/中性/偏空", "reason": "一句話解釋"}
  ],
  "tomorrow_watch_json": [
    {"name": "觀察項目", "reason": "一句話為什麼要注意"}
  ],
  "global_events_json": [
    {"source": "事件來源", "event": "事件標題（必須來自今日新聞）", "taiwanImpact": "對台股可能影響", "beginnerTip": "新手一句提醒", "relatedSector": "相關族群"}
  ],
  "ai_strategy_json": {
    "conservative": "保守型建議，不是買什麼而是怎麼思考",
    "aggressive": "積極型建議，不是買什麼而是怎麼思考",
    "overall_advice": "整體建議一句話",
    "risk_warning": "風險提醒一句話"
  },
  "important_news_json": [
    {"title": "新聞標題（必須來自今日 market_news，不可憑空生成）", "summary": "為什麼重要（一句話）", "impact": "對台股影響", "sectors": ["相關族群"]}
  ],
  "yesterday_summary": "昨天市場簡短回顧，1~2 句話",
  "today_summary": "今日補充說明，1~2 句話，必須出現具體新聞事件或名稱",
  "script_valid_conditions": ["劇本成立條件，根據今日新聞，2~4項"],
  "script_invalid_conditions": ["劇本失效條件，2~4項"],
  "today_key_signal": "今天最該盯的單一訊號，根據今日最重要新聞，一句話",
  "today_key_signal_reason": "為什麼要盯這個訊號，一句話",
  "intraday_checkpoints": [
    {"time": "09:00", "check": "開盤後檢查項目", "why": "為什麼這個時間點重要"},
    {"time": "10:30", "check": "早盤確認項目", "why": "為什麼這個時間點重要"},
    {"time": "13:00", "check": "收盤前檢查項目", "why": "為什麼這個時間點重要"}
  ],
  "correction_guide": "如果今天盤前劇本錯了，該怎麼修正，2~3 句話"
}

## 重要規則
1. 所有文字必須是繁體中文。
2. 禁止使用專業術語堆疊，禁止像投顧語氣。
3. 禁止給出具體買進點、賣出點、目標價、飆股推薦。
4. 數字欄位必須是數字（number），不可加 % 符號。
5. 陣列欄位必須是陣列，即使只有一筆也要用 []。
6. 每個陣列 2~6 項，不要過長。
7. 所有描述限制在 1~2 句話，最多不超過 60 個字。
8. important_news_json 的 title 必須來自今日新聞，不可憑空生成。
9. watch_sectors_json 必須根據新聞 related_sectors 統整，不可每天固定 AI / 半導體 / ETF。
10. 輸出必須是純 JSON，前後不可有 markdown 程式碼區塊標記。`;
}

function buildRegimeInstructions(regime: MarketRegime): string {
  const base = `今日市場狀態判斷：${regime}`;

  switch (regime) {
    case 'STRONG_UP_DAY':
      return `${base}

今天市場明顯轉強。AI 必須承認這個強度，不可硬寫成過度保守。
- 承認今天多方氣勢明顯
- 提醒不要追第一根，但同時說明主流強度
- 不要否認行情，而是確認主流能不能延續到中午
語氣範例：「今天市場明顯轉強，重點不是否認行情，而是確認主流能不能延續到中午。」`;

    case 'STRONG_DOWN_DAY':
      return `${base}

今天市場明顯轉弱。AI 必須明確說市場進入防守。
- 明確說市場進入防守狀態
- 不可寫成普通震盪
- 提醒大跌日最容易犯的錯：把反彈當成反轉
語氣範例：「今天市場明顯轉弱，重點不是猜低點，而是先停止用昨天的情緒判斷今天。」`;

    case 'RANGE_DAY':
      return `${base}

今天市場沒有明確方向，處於震盪區間。
- 寫成觀望與等待確認
- 不要假裝有方向
語氣範例：「今天市場沒有明確方向，真正該做的是等主流自己走出來。」`;

    case 'HOT_BUT_RISKY':
      return `${base}

今天市場偏熱，但熱度已接近過熱邊緣。
- 承認熱度，但提醒過熱風險
- 真正要看的是資金有沒有延續
語氣範例：「今天市場很熱，但熱不代表安全。真正要看的是資金有沒有延續。」`;

    case 'WEAK_BUT_STABILIZING':
      return `${base}

今天市場偏弱，但賣壓有降溫跡象。
- 承認市場仍弱，但提醒不要恐慌
- 今天重點是觀察，不是急著進場
語氣範例：「市場還沒真正轉強，但賣壓有降溫跡象。今天重點是觀察，不是急著翻多。」`;

    case 'UNKNOWN':
    default:
      return `${base}

市場資料不足，無法明確判斷方向。
- 坦承資料有限，不做過度推斷
語氣範例：「今天市場訊號不夠清楚，真正該做的是等更多訊號出現。」`;
  }
}

// ===== OPENAI CALLER =====
async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  log: (msg: string) => void,
  label = 'call'
): Promise<Record<string, unknown> | null> {
  try {
    log(`Calling OpenAI [${label}]...`);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content:
              '請根據以上市場數據與今日最新新聞，以 Morning Alpha 盤前軍師的身份生成今日盤前策略 JSON。記得：1) today_quote 要有情緒感、有新意、跟昨天不同。2) summary 和 today_summary 必須出現具體新聞名稱或事件。3) important_news_json 的 title 必須來自今日新聞列表。4) watch_sectors_json 必須根據新聞 related_sectors 統整。5) script_valid_conditions 與 script_invalid_conditions 必須具體、可觀察。',
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.85,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`ERROR: OpenAI HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      return null;
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      log(`ERROR: OpenAI [${label}] response missing content`);
      return null;
    }

    try {
      const parsed = JSON.parse(content);
      log(`OpenAI [${label}] JSON parsed successfully`);
      return parsed;
    } catch (parseErr) {
      log(`ERROR: JSON parse failed [${label}]: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const extracted = JSON.parse(jsonMatch[1].trim());
          log(`JSON extracted from markdown block [${label}]`);
          return extracted;
        } catch {
          log(`ERROR: Extracted markdown JSON also invalid [${label}]`);
        }
      }
      return null;
    }
  } catch (err) {
    log(`ERROR: OpenAI fetch exception [${label}]: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ===== REPORT NORMALIZER V6 =====
function normalizeReportV6(
  raw: Record<string, unknown>,
  freshness: FreshnessCheck,
  newsBrief: NewsBrief
): Record<string, unknown> {
  const safeNum = (val: unknown, fallback = 0): number => {
    const n = Number(val);
    return Number.isNaN(n) ? fallback : n;
  };

  const safeStr = (val: unknown, fallback = ''): string => {
    if (val === null || val === undefined) return fallback;
    return String(val);
  };

  const safeStrArr = (val: unknown, fallback: string[] = []): string[] => {
    if (Array.isArray(val)) return val.map(String).filter(Boolean);
    if (typeof val === 'string' && val.trim())
      return val.split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean);
    return fallback;
  };

  const safeObjArr = (val: unknown, fallback: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(val)) return val.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
    return fallback;
  };

  const safeObj = (val: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> => {
    if (val && typeof val === 'object' && !Array.isArray(val)) return val as Record<string, unknown>;
    return fallback;
  };

  // today_strategy
  const rawStrategy = safeObj(raw.today_strategy || raw.ai_strategy_json || raw.ai_strategy);
  const todayStrategy = {
    do: safeStrArr(rawStrategy.do || rawStrategy.should_do),
    avoid: safeStrArr(rawStrategy.avoid || rawStrategy.donts || rawStrategy.should_not),
  };

  // global_events
  const rawEvents = safeObjArr(raw.global_events_json || raw.global_events);
  const globalEvents = rawEvents.map((e) => ({
    source: safeStr(e.source, '全球市場'),
    event: safeStr(e.event, '國際市場變動'),
    taiwanImpact: safeStr(e.taiwanImpact || e.taiwan_impact, '可能影響台股開盤氣氛'),
    beginnerTip: safeStr(e.beginnerTip || e.beginner_tip, '建議觀察後再決定'),
    relatedSector: safeStr(e.relatedSector || e.related_sector, '大盤'),
  }));

  // risk_factors — V6: fallback uses news-derived content
  const rawRisks = safeObjArr(raw.risk_factors_json || raw.risk_factors);
  const riskFactors = rawRisks.map((r) => {
    const levelRaw = String(r.level || r.severity || 'medium').toLowerCase();
    const level =
      levelRaw.includes('high') || levelRaw.includes('高') ? 'high' :
      levelRaw.includes('low') || levelRaw.includes('低') ? 'low' : 'medium';
    return {
      title: safeStr(r.title || r.factor || r.name, '市場風險'),
      level,
      description: safeStr(r.description || r.impact || r.detail || r.reason, '請留意市場波動'),
    };
  });

  // V6: watch_sectors fallback uses sectorCounts (NOT hardcoded AI/半導體/ETF)
  const rawSectors = safeObjArr(raw.watch_sectors_json || raw.watch_sectors || raw.sector_direction);
  const watchSectors = rawSectors.map((s) => ({
    sector: safeStr(s.sector || s.name || s.group, '大盤'),
    direction: safeStr(s.direction || s.trend || s.signal || '中性', '中性'),
    reason: safeStr(s.reason || s.why || s.description, '暫無明確訊號'),
  }));

  // V6: watch_sectors fallback from sectorCounts
  const watchSectorsFallback = Object.entries(newsBrief.sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sector]) => ({ sector, direction: '觀察', reason: '來自今日新聞族群統計' }));

  // focus_stock
  const rawFocus = safeObjArr(raw.focus_stock_json || raw.focus_stocks || raw.taiwan_stock_focus);
  const focusStocks = rawFocus.map((f) => ({
    group: safeStr(f.group || f.sector || f.name || f.theme, '大盤'),
    direction: safeStr(f.direction || f.trend || f.signal, '觀察'),
    reason: safeStr(f.reason || f.why || f.description, '暫時觀望'),
  }));

  // tomorrow_watch
  const rawTomorrow = safeObjArr(raw.tomorrow_watch_json || raw.tomorrow_watchlist || raw.tomorrow_watch);
  const tomorrowWatch = rawTomorrow.map((t) => ({
    name: safeStr(t.name || t.stock || t.item || t.title, '大盤動向'),
    reason: safeStr(t.reason || t.why || t.note || t.description, '持續觀察'),
  }));

  // V6: important_news fallback uses topNews (NOT hardcoded "市場動態")
  const rawNews = safeObjArr(raw.important_news_json || raw.important_news || raw.top_news);
  const importantNews = rawNews.map((n) => ({
    title: safeStr(n.title || n.headline, '市場新聞'),
    summary: safeStr(n.summary || n.explanation || n.description || n.content, '持續關注'),
    impact: safeStr(n.impact || n.effect || n.taiwan_impact, '影響待觀察'),
    sectors: safeStrArr(n.sectors || n.related_sectors || n.affected_sectors),
  }));

  // V6: important_news fallback from topNews
  const importantNewsFallback = newsBrief.topNews.slice(0, 3).map((n) => ({
    title: n.title,
    summary: n.taiwan_impact_summary || '持續關注',
    impact: n.taiwan_impact_summary || '影響待觀察',
    sectors: Array.isArray(n.related_sectors) ? n.related_sectors : [],
  }));

  // watch_sectors_detailed
  const rawWatchDetailed = safeObjArr(raw.watch_sectors_detailed || raw.sector_heat_map);
  const watchSectorsDetailed = rawWatchDetailed.map((s) => ({
    sector: safeStr(s.sector || s.name || s.group, '族群'),
    aiObservation: safeStr(s.aiObservation || s.observation || s.note || s.analysis, '持續觀察'),
    isOverheated: Boolean(s.isOverheated || s.overheated || s.heat === 'high'),
    isSuitableToChase: Boolean(s.isSuitableToChase || s.chaseable || s.suitable),
    riskLevel: String(s.riskLevel || s.risk || s.level || 'medium').toLowerCase().includes('high') ? 'high' :
      String(s.riskLevel || s.risk || s.level || 'medium').toLowerCase().includes('low') ? 'low' : 'medium',
  }));

  // V6: watch_sectors_detailed fallback from sectorCounts
  const watchDetailedFallback = Object.entries(newsBrief.sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sector]) => ({
      sector,
      aiObservation: '來自今日新聞，持續觀察資金動向',
      isOverheated: false,
      isSuitableToChase: false,
      riskLevel: 'medium',
    }));

  // intraday_checkpoints
  const rawCheckpoints = safeObjArr(raw.intraday_checkpoints || raw.checkpoints);
  const intradayCheckpoints = rawCheckpoints.length > 0
    ? rawCheckpoints.map((cp) => ({
        time: safeStr(cp.time || cp.checkpoint || '10:30', '10:30'),
        check: safeStr(cp.check || cp.item || cp.watch || '觀察主流族群'),
        why: safeStr(cp.why || cp.reason || cp.importance || '確認盤勢方向'),
      }))
    : [
        { time: '09:00', check: '開盤後先看情緒有沒有過熱', why: '不要急著跟第一波' },
        { time: '10:30', check: '主流族群是否延續', why: '不要只看單一熱門股' },
        { time: '13:00', check: '確認今天有沒有因為情緒做多餘動作', why: '收盤前自我檢查' },
      ];

  const scriptValid = safeStrArr(raw.script_valid_conditions || raw.valid_conditions);
  const scriptInvalid = safeStrArr(raw.script_invalid_conditions || raw.invalid_conditions);

  const todayKeySignal = safeStr(raw.today_key_signal || raw.key_signal, '10:30 前主流族群是否延續');
  const todayKeySignalReason = safeStr(raw.today_key_signal_reason || raw.key_signal_reason, '如果主流散掉，今天就不要再用早上的情緒判斷');
  const correctionGuide = safeStr(raw.correction_guide || raw.if_wrong, '如果盤前劇本錯了，重點不是猜低點，而是先停止用舊情緒判斷。觀察主流是否退潮，再決定下一步。');

  // bias normalization
  let bias = safeStr(raw.market_bias, '中性');
  if (!['偏多', '偏空', '中性', '震盪偏多', '震盪偏空'].includes(bias)) {
    if (bias.includes('多') || bias.toLowerCase().includes('bull')) bias = '偏多';
    else if (bias.includes('空') || bias.toLowerCase().includes('bear')) bias = '偏空';
    else bias = '中性';
  }

  let todayQuote = safeStr(raw.today_quote, '');
  if (!todayQuote) {
    todayQuote = '市場每天都有訊號，但你的情緒不該是其中之一。';
  }

  const rawAiStrategy = safeObj(raw.ai_strategy_json || raw.ai_strategy);
  const aiStrategy = {
    conservative: safeStr(rawAiStrategy.conservative, '今天先觀察大盤方向，不急著操作'),
    aggressive: safeStr(rawAiStrategy.aggressive, '可留意市場熱門方向，但建議分批試水溫'),
    overall_advice: safeStr(rawAiStrategy.overall_advice, '市場方向尚不明確，建議觀望'),
    risk_warning: safeStr(rawAiStrategy.risk_warning, '任何投資都有風險，建議設定停損觀察點'),
  };

  // V6 freshness-based confidence clamping
  let confidenceScore = Math.max(0, Math.min(100, safeNum(raw.confidence_score, 50)));
  let confidenceLabel = safeStr(raw.confidence_label, '尚可');
  let aiConfidenceReason = safeStr(raw.ai_confidence_reason, '');

  if (!freshness.marketDataFresh && freshness.newsFresh) {
    if (confidenceScore > 70) confidenceScore = 70;
    if (!confidenceLabel.includes('新聞有效')) confidenceLabel = '新聞有效、數據待更新';
    if (!aiConfidenceReason.includes('數據較舊')) {
      aiConfidenceReason = '市場數據較舊，今日判斷以新聞與情緒線索為主。' + aiConfidenceReason;
    }
  } else if (freshness.marketDataFresh && !freshness.newsFresh) {
    if (confidenceScore > 75) confidenceScore = 75;
    if (!confidenceLabel.includes('新聞不足')) confidenceLabel = '數據尚可、新聞不足';
    if (!aiConfidenceReason.includes('新聞不足')) {
      aiConfidenceReason = '今日新聞資料較少，判斷主要依據市場數據。' + aiConfidenceReason;
    }
  }

  // V6: summary fallback uses topNews title
  const summaryFallback = newsBrief.topNews.length > 0
    ? `今日市場關注 ${newsBrief.topNews[0].title.slice(0, 30)}...，持續觀察相關族群動向。`
    : '今日市場情報整理中...';

  return {
    today_quote: todayQuote,
    summary: safeStr(raw.summary, summaryFallback),
    market_bias: bias,
    confidence_score: confidenceScore,
    confidence_label: confidenceLabel,
    today_strategy: todayStrategy,
    can_watch: safeStrArr(raw.can_watch, []),
    avoid_today: safeStrArr(raw.avoid_today, ['開盤追高', '重壓單一股', '情緒單']),
    fear_greed: Math.max(0, Math.min(100, safeNum(raw.fear_greed, 50))),
    fear_greed_summary: safeStr(raw.fear_greed_summary, '市場情緒中等'),
    vix: safeNum(raw.vix, 18),
    vix_summary: safeStr(raw.vix_summary, '市場波動正常'),
    nasdaq_change: safeNum(raw.nasdaq_change),
    sp500_change: safeNum(raw.sp500_change),
    sox_change: safeNum(raw.sox_change),
    taiex_futures_change: safeNum(raw.taiex_futures_change || raw.taiwan_futures_change),
    dxy: safeNum(raw.dxy || raw.dxy_index),
    us_bond_yield: safeNum(raw.us_bond_yield || raw.us10y_yield),
    gold_price: safeNum(raw.gold_price),
    oil_price: safeNum(raw.oil_price),
    btc_price: safeNum(raw.btc_price),
    risk_factors_json: riskFactors.length > 0 ? riskFactors : [
      { title: '市場情緒不穩', level: 'medium', description: '追價風險提高，建議分批觀察' },
      { title: '盤中震盪', level: 'medium', description: '短線容易來回洗，不要追殺' },
    ],
    // V6: use sectorCounts fallback instead of hardcoded AI/半導體/ETF
    watch_sectors_json: watchSectors.length > 0 ? watchSectors : (watchSectorsFallback.length > 0 ? watchSectorsFallback : [
      { sector: '大盤', direction: '中性', reason: '暫時觀望' },
    ]),
    focus_stock_json: focusStocks.length > 0 ? focusStocks : [
      { group: '大盤', direction: '觀察', reason: '等待方向明朗' },
    ],
    tomorrow_watch_json: tomorrowWatch.length > 0 ? tomorrowWatch : [
      { name: '大盤開盤方向', reason: '確認今日趨勢' },
    ],
    global_events_json: globalEvents.length > 0 ? globalEvents : [
      { source: '全球市場', event: '國際市場變動', taiwanImpact: '影響台股開盤', beginnerTip: '建議觀察', relatedSector: '大盤' },
    ],
    ai_strategy_json: aiStrategy,
    // V6: use topNews fallback instead of hardcoded "市場動態"
    important_news_json: importantNews.length > 0 ? importantNews : (importantNewsFallback.length > 0 ? importantNewsFallback : [
      { title: '今日市場新聞', summary: '持續關注', impact: '影響待觀察', sectors: [] },
    ]),
    yesterday_summary: safeStr(raw.yesterday_summary, '昨日市場正常波動'),
    today_summary: safeStr(raw.today_summary, summaryFallback),
    // V6: watch_sectors_detailed fallback from sectorCounts
    watch_sectors_detailed: watchSectorsDetailed.length > 0 ? watchSectorsDetailed : (watchDetailedFallback.length > 0 ? watchDetailedFallback : [
      { sector: '大盤', aiObservation: '資金動向持續觀察', isOverheated: false, isSuitableToChase: false, riskLevel: 'medium' },
    ]),
    ai_psychology: safeStr(raw.ai_psychology, '今天最容易犯的錯，是看到別人賺錢後開始焦慮。記住：市場永遠有明天。'),
    ai_retail_reminder: safeStr(raw.ai_retail_reminder, '散戶今天最容易被新聞情緒帶著走。冷靜觀察比衝動進場更重要。'),
    ai_confidence_reason: aiConfidenceReason || '根據市場數據與情緒指標，AI 認為今天市場方向尚待確認，建議先觀察再決定。',
    script_valid_conditions: scriptValid.length > 0 ? scriptValid : [
      '主流族群沒有快速退潮',
      '10:30 前成交量正常放大',
    ],
    script_invalid_conditions: scriptInvalid.length > 0 ? scriptInvalid : [
      '開高走低',
      '主流沒有擴散',
    ],
    today_key_signal: todayKeySignal,
    today_key_signal_reason: todayKeySignalReason,
    intraday_checkpoints: intradayCheckpoints,
    correction_guide: correctionGuide,
  };
}

// ===== BUILD ALLOWED REPORT PAYLOAD =====
function buildAllowedReportPayload(report: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys = [
    'summary',
    'market_bias',
    'confidence_score',
    'confidence_label',
    'today_quote',
    'today_strategy',
    'can_watch',
    'avoid_today',
    'fear_greed',
    'fear_greed_summary',
    'vix',
    'vix_summary',
    'nasdaq_change',
    'sp500_change',
    'sox_change',
    'taiex_futures_change',
    'dxy',
    'us_bond_yield',
    'gold_price',
    'oil_price',
    'btc_price',
    'risk_factors_json',
    'watch_sectors_json',
    'focus_stock_json',
    'tomorrow_watch_json',
    'global_events_json',
    'ai_strategy_json',
    'important_news_json',
    'yesterday_summary',
    'today_summary',
    'watch_sectors_detailed',
    'ai_psychology',
    'ai_retail_reminder',
    'ai_confidence_reason',
  ];

  const payload: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in report) {
      payload[key] = report[key];
    }
  }

  // Merge extended V6 fields into ai_strategy_json
  const aiStrategy = payload.ai_strategy_json && typeof payload.ai_strategy_json === 'object'
    ? { ...payload.ai_strategy_json as Record<string, unknown> }
    : {};

  if (Array.isArray(report.script_valid_conditions) && report.script_valid_conditions.length > 0) {
    aiStrategy.script_valid_conditions = report.script_valid_conditions;
  }
  if (Array.isArray(report.script_invalid_conditions) && report.script_invalid_conditions.length > 0) {
    aiStrategy.script_invalid_conditions = report.script_invalid_conditions;
  }
  if (report.today_key_signal) {
    aiStrategy.today_key_signal = report.today_key_signal;
  }
  if (report.today_key_signal_reason) {
    aiStrategy.today_key_signal_reason = report.today_key_signal_reason;
  }
  if (Array.isArray(report.intraday_checkpoints) && report.intraday_checkpoints.length > 0) {
    aiStrategy.intraday_checkpoints = report.intraday_checkpoints;
  }
  if (report.correction_guide) {
    aiStrategy.correction_guide = report.correction_guide;
  }

  payload.ai_strategy_json = aiStrategy;

  return payload;
}
