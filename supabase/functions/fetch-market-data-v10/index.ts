import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { resolveMarketStatus } from '../_shared/market-status.ts';

// ═══════════════════════════════════════════════════════════
// fetch-market-data-v10 V10.8 — PROVIDER FALLBACK + FRESHNESS METADATA
// Uses Finnhub for US equities/ETF proxies, Fugle/TWSE for Taiwan core, best-effort Fugle futopt for TXF.
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

interface MarketQuote {
  value: number;
  change: number;
  changePercent: number;
  capturedAt: string;
  provider: string;
  sourceSymbol: string;
  raw: Record<string, unknown>;
}

interface ProviderFailureDetail {
  provider: string;
  symbol: string;
  endpoint: string;
  status?: number;
  error?: string;
}

interface SymbolConfig {
  finnhubSymbol: string;
  displaySymbol: string;
  name: string;
  market: string;
  taiwanImpact: string;
}

type MarketDataPhase = "premarket" | "intraday" | "close" | "manual_backfill";

interface RequestBody {
  phase?: MarketDataPhase;
  include_beneficiary_close?: boolean;
  beneficiary_close?: boolean;
  beneficiary_close_only?: boolean;
}

const SYMBOLS: SymbolConfig[] = [
  { finnhubSymbol: "SPY", displaySymbol: "SPX", name: "S&P 500（proxy: SPY ETF proxy）", market: "US", taiwanImpact: "美股整體健康度指標" },
  { finnhubSymbol: "QQQ", displaySymbol: "IXIC", name: "Nasdaq（proxy: QQQ ETF proxy）", market: "US", taiwanImpact: "科技股風向標" },
  { finnhubSymbol: "SOXX", displaySymbol: "SOX", name: "費城半導體指數（proxy: SOXX ETF proxy）", market: "US", taiwanImpact: "半導體族群強弱指標" },
  { finnhubSymbol: "NVDA", displaySymbol: "NVDA", name: "Nvidia", market: "US", taiwanImpact: "AI 龍頭，直接牽動台灣 AI 供應鏈" },
  { finnhubSymbol: "TSM", displaySymbol: "TSM", name: "TSMC ADR", market: "US", taiwanImpact: "台積電 ADR 連動台股價格" },
  { finnhubSymbol: "VXX", displaySymbol: "VIX", name: "恐慌指數（proxy: VXX ETN proxy）", market: "US", taiwanImpact: "市場恐慌情緒" },
  { finnhubSymbol: "DXY", displaySymbol: "DXY", name: "美元指數", market: "US", taiwanImpact: "影響外資流向與台幣匯率" },
  { finnhubSymbol: "US10Y", displaySymbol: "US10Y", name: "美國10年債殖利率", market: "US", taiwanImpact: "影響資金成本與科技股估值" },
  { finnhubSymbol: "TAIEX", displaySymbol: "TAIEX", name: "台股加權指數", market: "TW", taiwanImpact: "台股大盤整體風向指標" },
  { finnhubSymbol: "2330", displaySymbol: "2330", name: "台積電", market: "TW", taiwanImpact: "台股權值股龍頭" },
  { finnhubSymbol: "TXF", displaySymbol: "TXF", name: "台指期", market: "TW", taiwanImpact: "台指期提供期貨領先訊號" },
];

const CLOSE_CORE_SYMBOLS = new Set(["TAIEX", "2330", "TXF", "SPX", "IXIC", "SOX", "NVDA", "TSM", "VIX"]);

// MVP required symbols for safe bias to work
const MVP_REQUIRED = ["NVDA", "TSM", "SPX"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStockSymbol(value: unknown): string {
  const row = asRecord(value);
  return String(row.symbol || row.ticker || row.stock_code || row.stock_id || "").trim().toUpperCase();
}

function readStockName(value: unknown): string {
  const row = asRecord(value);
  return String(row.name || row.stock_name || row.company_name || "").trim();
}

function isTaiwanStockSymbol(symbol: string): boolean {
  return /^\d{4,6}$/.test(symbol);
}

function buildBeneficiarySymbolConfigs(ai: Record<string, unknown>): SymbolConfig[] {
  const primary = Array.isArray(ai.today_beneficiary_stocks) ? ai.today_beneficiary_stocks : [];
  const secondary = Array.isArray(ai.beneficiary_stocks) ? ai.beneficiary_stocks : [];
  const existing = new Set(SYMBOLS.map((item) => item.displaySymbol.toUpperCase()));
  const seen = new Set<string>();
  const configs: SymbolConfig[] = [];

  for (const item of [...primary, ...secondary]) {
    const symbol = readStockSymbol(item);
    if (!symbol || !isTaiwanStockSymbol(symbol) || existing.has(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    configs.push({
      finnhubSymbol: symbol,
      displaySymbol: symbol,
      name: readStockName(item) || symbol,
      market: "TW",
      taiwanImpact: "今日受惠股收盤驗證資料",
    });
    if (configs.length >= 12) break;
  }

  return configs;
}

async function fetchBeneficiarySymbolConfigsForDate(
  supabase: ReturnType<typeof createClient>,
  reportDate: string,
  logPrefix: string,
): Promise<SymbolConfig[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("ai_strategy_json")
    .eq("report_date", reportDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[${logPrefix}] beneficiary symbol lookup skipped: ${error.message}`);
    return [];
  }

  const ai = asRecord((data as Record<string, unknown> | null)?.ai_strategy_json);
  return buildBeneficiarySymbolConfigs(ai);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function resolveDefaultPhase(hour: number, minute: number): MarketDataPhase {
  const currentMinutes = hour * 60 + minute;
  if (currentMinutes >= 5 * 60 && currentMinutes <= 8 * 60 + 59) return "premarket";
  if (currentMinutes >= 9 * 60 && currentMinutes <= 13 * 60 + 29) return "intraday";
  if (currentMinutes >= 13 * 60 + 30) return "close";
  return "manual_backfill";
}

function isMarketDataPhase(value: unknown): value is MarketDataPhase {
  return value === "premarket" || value === "intraday" || value === "close" || value === "manual_backfill";
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

async function fetchFinnhubQuote(
  finnhubSymbol: string,
  apiKey: string,
  logPrefix: string,
  failureDetails?: ProviderFailureDetail[],
): Promise<MarketQuote | null> {
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

      return {
        value: data.c,
        change: data.d,
        changePercent: data.dp,
        capturedAt: normalizeTimestamp(data.t || Date.now()),
        provider: "finnhub",
        sourceSymbol: finnhubSymbol,
        raw: {
          provider: "finnhub",
          finnhub_symbol: finnhubSymbol,
          quote: {
            current: data.c,
            change: data.d,
            change_percent: data.dp,
            high: data.h,
            low: data.l,
            open: data.o,
            previous_close: data.pc,
            timestamp: data.t,
            captured_at: normalizeTimestamp(data.t || Date.now()),
          },
        },
      };
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

function extractNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/,/g, "").trim();
      if (cleaned && cleaned !== "-" && cleaned !== "--") {
        const parsed = Number(cleaned);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return null;
}

function taipeiDateTimeToIso(dateValue: unknown, timeValue: unknown): string {
  const date = String(dateValue || "").replace(/\D/g, "");
  const time = String(timeValue || "00:00:00").trim();
  if (date.length === 8) {
    const yyyy = date.slice(0, 4);
    const mm = date.slice(4, 6);
    const dd = date.slice(6, 8);
    const normalizedTime = /^\d{2}:\d{2}:\d{2}$/.test(time) ? time : "00:00:00";
    const parsed = new Date(`${yyyy}-${mm}-${dd}T${normalizedTime}+08:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Providers may return seconds, milliseconds, microseconds, or nanoseconds.
    const millis = value > 1_000_000_000_000_000
      ? Math.floor(value / 1_000_000)
      : value > 100_000_000_000_000
        ? Math.floor(value / 1_000)
        : value > 1_000_000_000_000
          ? value
          : value * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      if (year >= 2000 && year <= 2100) return parsed.toISOString();
    }
  }

  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric) && numeric > 0) return normalizeTimestamp(numeric);
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getUTCFullYear();
      if (year >= 2000 && year <= 2100) return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function normalizeFugleQuote(data: Record<string, unknown>, sourceSymbol: string): MarketQuote | null {
  const trade = data.trade && typeof data.trade === "object" && !Array.isArray(data.trade)
    ? data.trade as Record<string, unknown>
    : {};
  const price = extractNumber(data, ["price", "closePrice", "lastPrice", "last", "z"]) ??
    extractNumber(trade, ["price", "closePrice", "lastPrice", "last"]);
  const previousClose = extractNumber(data, ["previousClose", "previous_close", "referencePrice", "y"]);
  const change = extractNumber(data, ["change", "priceChange"]);
  let changePercent = extractNumber(data, ["changePercent", "change_percent", "priceChangePercent"]);

  if (price === null || price <= 0) return null;
  const computedChange = change ?? (previousClose && previousClose > 0 ? price - previousClose : 0);
  if (changePercent === null) {
    changePercent = previousClose && previousClose > 0 ? (computedChange / previousClose) * 100 : 0;
  }

  const capturedAt = normalizeTimestamp(data.lastUpdated || data.last_updated || data.updatedAt || trade.at || data.time || data.date);
  return {
    value: price,
    change: computedChange,
    changePercent,
    capturedAt,
    provider: "fugle",
    sourceSymbol,
    raw: {
      provider: "fugle",
      source_symbol: sourceSymbol,
      date: data.date || null,
      type: data.type || null,
      market: data.market || null,
      exchange: data.exchange || null,
      captured_at: capturedAt,
      price,
      change: computedChange,
      change_percent: changePercent,
    },
  };
}

async function fetchFugleQuoteFromPath(
  path: string,
  symbol: string,
  apiKey: string,
  logPrefix: string,
  providerLabel: string,
  failureDetails?: ProviderFailureDetail[],
): Promise<MarketQuote | null> {
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`https://api.fugle.tw/marketdata/v1.0/${path}/${encodeURIComponent(symbol)}`, {
      headers: {
        "Accept": "application/json",
        "X-API-KEY": apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.warn(`[${logPrefix}] Fugle ${providerLabel} ${symbol} HTTP ${response.status}`);
      failureDetails?.push({ provider: providerLabel, symbol, endpoint: path, status: response.status });
      return null;
    }
    const data = await response.json();
    const quote = normalizeFugleQuote(data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}, symbol);
    return quote ? { ...quote, provider: providerLabel, raw: { ...quote.raw, provider: providerLabel } } : null;
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[${logPrefix}] Fugle ${providerLabel} ${symbol} failed: ${message}`);
    failureDetails?.push({ provider: providerLabel, symbol, endpoint: path, error: message });
    return null;
  }
}

async function fetchFugleStockQuote(symbol: string, apiKey: string, logPrefix: string, failureDetails?: ProviderFailureDetail[]): Promise<MarketQuote | null> {
  return fetchFugleQuoteFromPath("stock/intraday/quote", symbol, apiKey, logPrefix, "fugle", failureDetails);
}

async function fetchFugleJson(
  pathWithQuery: string,
  apiKey: string,
  logPrefix: string,
  failureDetails?: ProviderFailureDetail[],
): Promise<unknown | null> {
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`https://api.fugle.tw/marketdata/v1.0/${pathWithQuery}`, {
      headers: { "Accept": "application/json", "X-API-KEY": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      let body = "";
      try { body = (await response.text()).slice(0, 240); } catch { body = ""; }
      console.warn(`[${logPrefix}] Fugle futopt discovery ${pathWithQuery} HTTP ${response.status} ${body}`);
      failureDetails?.push({ provider: "fugle_futopt", symbol: "TXF", endpoint: pathWithQuery, status: response.status, error: body || undefined });
      return null;
    }
    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[${logPrefix}] Fugle futopt discovery ${pathWithQuery} failed: ${message}`);
    failureDetails?.push({ provider: "fugle_futopt", symbol: "TXF", endpoint: pathWithQuery, error: message });
    return null;
  }
}

function flattenTickerRows(input: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const maybeSymbol = record.symbol ?? record.ticker ?? record.code ?? record.contractCode ?? record.contract_code;
    if (typeof maybeSymbol === "string") rows.push(record);
    for (const key of ["data", "items", "tickers", "products", "contracts", "results"]) visit(record[key]);
  };
  visit(input);
  return rows;
}

function textField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function isActiveContract(row: Record<string, unknown>): boolean {
  const status = textField(row, ["status", "state", "tradeStatus", "tradingStatus", "isActive", "active"]).toLowerCase();
  if (!status) return true;
  if (["false", "0", "inactive", "expired", "delisted", "suspended", "halted", "closed"].includes(status)) return false;
  return true;
}

function expiryMillis(row: Record<string, unknown>): number {
  const expiry = textField(row, ["deliveryDate", "expiryDate", "expireDate", "lastTradingDate", "settlementDate"]);
  if (expiry) {
    const normalized = /^\d{8}$/.test(expiry) ? `${expiry.slice(0,4)}-${expiry.slice(4,6)}-${expiry.slice(6,8)}` : expiry;
    const parsed = Date.parse(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  const ym = textField(row, ["deliveryMonth", "contractMonth", "yearMonth", "month"]);
  if (/^\d{6}$/.test(ym)) {
    const parsed = Date.parse(`${ym.slice(0,4)}-${ym.slice(4,6)}-01T00:00:00Z`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.MAX_SAFE_INTEGER;
}

function selectNearestTxfContract(rows: Record<string, unknown>[]): string | null {
  const now = Date.now();
  const candidates = rows
    .map((row) => {
      const symbol = textField(row, ["symbol", "ticker", "code", "contractCode", "contract_code"]);
      const product = textField(row, ["product", "productId", "product_id", "rootSymbol", "underlying", "underlyingSymbol", "commodity", "type", "name"]);
      return { row, symbol, product, expiry: expiryMillis(row) };
    })
    .filter((item) => item.symbol && /^TXF[A-Z0-9]+$/i.test(item.symbol))
    .filter((item) => /TXF|臺指|台指|TAIEX/i.test(`${item.product} ${item.symbol}`))
    .filter((item) => isActiveContract(item.row))
    .sort((a, b) => {
      const aFuture = a.expiry >= now ? 0 : 1;
      const bFuture = b.expiry >= now ? 0 : 1;
      if (aFuture !== bFuture) return aFuture - bFuture;
      return a.expiry - b.expiry || a.symbol.localeCompare(b.symbol);
    });
  return candidates[0]?.symbol || null;
}

async function getActiveTxfContractSymbol(
  apiKey: string,
  logPrefix: string,
  failureDetails?: ProviderFailureDetail[],
): Promise<string | null> {
  const endpoints = [
    "futopt/intraday/tickers?type=FUTURE",
    "futopt/intraday/tickers?type=FUTURES",
    "futopt/intraday/tickers",
    "futopt/products?type=FUTURE",
    "futopt/products",
  ];
  for (const endpoint of endpoints) {
    const json = await fetchFugleJson(endpoint, apiKey, logPrefix, failureDetails);
    const rows = flattenTickerRows(json);
    const symbol = selectNearestTxfContract(rows);
    if (symbol) {
      console.log(`[${logPrefix}] resolved TXF contract ${symbol} via ${endpoint}`);
      return symbol;
    }
    if (json) failureDetails?.push({ provider: "fugle_futopt", symbol: "TXF", endpoint, error: "cannot_resolve_active_txf_contract" });
  }
  return null;
}

async function fetchFugleFutOptQuote(
  symbol: string,
  apiKey: string,
  logPrefix: string,
  session: "regular" | "afterhours",
  failureDetails?: ProviderFailureDetail[],
): Promise<MarketQuote | null> {
  const query = session === "afterhours" ? "?session=afterhours" : "";
  const quote = await fetchFugleQuoteFromPath(`futopt/intraday/quote${query}`, symbol, apiKey, logPrefix, "fugle_futopt", failureDetails);
  return quote ? { ...quote, raw: { ...quote.raw, product: "TXF", session } } : null;
}

function normalizeTwseQuote(data: Record<string, unknown>, sourceSymbol: string): MarketQuote | null {
  const rows = Array.isArray(data.msgArray) ? data.msgArray : [];
  const row = rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])
    ? rows[0] as Record<string, unknown>
    : {};
  const price = extractNumber(row, ["z", "pz", "a"]);
  const previousClose = extractNumber(row, ["y"]);
  if (price === null || price <= 0 || previousClose === null || previousClose <= 0) return null;

  const change = price - previousClose;
  const changePercent = (change / previousClose) * 100;
  const capturedAt = taipeiDateTimeToIso(row.d, row.t);
  return {
    value: price,
    change,
    changePercent,
    capturedAt,
    provider: "twse",
    sourceSymbol,
    raw: {
      provider: "twse",
      source_symbol: sourceSymbol,
      date: row.d || null,
      time: row.t || null,
      price,
      previous_close: previousClose,
      change,
      change_percent: changePercent,
    },
  };
}

async function fetchTwseQuote(
  exCh: string,
  sourceSymbol: string,
  logPrefix: string,
): Promise<MarketQuote | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://mis.twse.com.tw/stock/index.jsp",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.warn(`[${logPrefix}] TWSE ${sourceSymbol} HTTP ${response.status}`);
      return null;
    }
    const data = await response.json();
    return normalizeTwseQuote(data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}, sourceSymbol);
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[${logPrefix}] TWSE ${sourceSymbol} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function fetchTaiwanCoreQuote(
  config: SymbolConfig,
  fugleApiKey: string,
  logPrefix: string,
  phase: MarketDataPhase,
  failureDetails?: ProviderFailureDetail[],
): Promise<MarketQuote | null> {
  if (config.displaySymbol === "2330") {
    return await fetchFugleStockQuote("2330", fugleApiKey, logPrefix, failureDetails) ??
      await fetchTwseQuote("tse_2330.tw", "2330", logPrefix) ??
      null;
  }

  if (config.displaySymbol === "TAIEX") {
    const fugleIndexCandidates = ["IX0001", "TAIEX"];
    for (const candidate of fugleIndexCandidates) {
      const quote = await fetchFugleStockQuote(candidate, fugleApiKey, logPrefix, failureDetails);
      if (quote) return { ...quote, sourceSymbol: candidate };
    }
    return await fetchTwseQuote("tse_t00.tw", "TAIEX", logPrefix);
  }

  if (config.displaySymbol === "TXF") {
    const contractSymbol = await getActiveTxfContractSymbol(fugleApiKey, logPrefix, failureDetails);
    if (!contractSymbol) {
      failureDetails?.push({ provider: "fugle_futopt", symbol: "TXF", endpoint: "contract_resolution", error: "cannot_resolve_active_txf_contract" });
      return null;
    }
    const preferredSession: "regular" | "afterhours" = phase === "premarket" || phase === "manual_backfill" ? "afterhours" : "regular";
    const fallbackSession: "regular" | "afterhours" = preferredSession === "afterhours" ? "regular" : "afterhours";
    const quote = await fetchFugleFutOptQuote(contractSymbol, fugleApiKey, logPrefix, preferredSession, failureDetails);
    if (quote) return { ...quote, sourceSymbol: contractSymbol, raw: { ...quote.raw, fallback_used: false } };
    const fallbackQuote = await fetchFugleFutOptQuote(contractSymbol, fugleApiKey, logPrefix, fallbackSession, failureDetails);
    if (fallbackQuote) return { ...fallbackQuote, sourceSymbol: contractSymbol, raw: { ...fallbackQuote.raw, fallback_used: true, fallback_from_session: preferredSession } };
  }

  if (isTaiwanStockSymbol(config.displaySymbol)) {
    const symbol = config.displaySymbol;
    return await fetchFugleStockQuote(symbol, fugleApiKey, logPrefix, failureDetails) ??
      await fetchTwseQuote(`tse_${symbol}.tw`, symbol, logPrefix) ??
      null;
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
    const fugleApiKey = Deno.env.get("FUGLE_API_KEY") || "";

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
    const requestBody = await readRequestBody(req);
    const taipei = getTaipeiParts();
    const phase = isMarketDataPhase(requestBody.phase) ? requestBody.phase : resolveDefaultPhase(taipei.hour, taipei.minute);
    const tradingDate = taipei.date;
    const marketStatus = resolveMarketStatus(tradingDate);
    if (!marketStatus.is_trading_day && requestBody.force_run !== true) {
      console.log(`[${batchTag}] MARKET_CLOSED_SKIP status=${marketStatus.market_status} date=${tradingDate}`);
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: "MARKET_STATUS_NOT_OPEN",
        phase,
        trading_date: tradingDate,
        market_status: marketStatus.market_status,
        session_type: marketStatus.session_type,
        is_trading_day: marketStatus.is_trading_day,
        market_message: marketStatus.market_message,
        next_trading_day: marketStatus.next_trading_day,
        version: VERSION,
      }), { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
    }
    const beneficiaryCloseOnly = phase === "close" && requestBody.beneficiary_close_only === true;
    const includeBeneficiaryClose = phase === "close" && (beneficiaryCloseOnly || requestBody.include_beneficiary_close === true || requestBody.beneficiary_close === true);

    const beneficiarySymbolConfigs = includeBeneficiaryClose
      ? await fetchBeneficiarySymbolConfigsForDate(supabase, tradingDate, batchTag)
      : [];
    const coreSymbolConfigs = beneficiaryCloseOnly
      ? []
      : phase === "close"
      ? SYMBOLS.filter((item) => CLOSE_CORE_SYMBOLS.has(item.displaySymbol))
      : SYMBOLS;
    const symbolConfigs = [...coreSymbolConfigs, ...beneficiarySymbolConfigs];

    const inserted: Array<{ symbol: string; name: string; value: number; change_percent: number }> = [];
    const failed: string[] = [];
    const snapshotErrors: Array<{ symbol: string; error: string }> = [];
    const dbWriteErrors: Array<{ symbol: string; error: string }> = [];
    const providerUsedBySymbol: Record<string, string> = {};
    const providerFailureDetails: ProviderFailureDetail[] = [];
    const twCoreSymbolsSuccess: string[] = [];
    const twCoreSymbolsFailed: Array<{ symbol: string; reason: string }> = [];
    let snapshotUpsertedCount = 0;
    const allSymbols = symbolConfigs.map((s) => s.displaySymbol);

    console.log(`[${batchTag}] phase=${phase} trading_date=${tradingDate} taipei=${taipei.hour}:${String(taipei.minute).padStart(2, "0")} close_core_only=${phase === "close" && !includeBeneficiaryClose} beneficiary_close_only=${beneficiaryCloseOnly} beneficiary_symbols=${beneficiarySymbolConfigs.map((s) => s.displaySymbol).join(",") || "none"}`);

    // ═══════════════════════════════════════════════════════
    // Fetch all symbols sequentially with delay
    // Overall deadline: OVERALL_TIMEOUT_MS from start
    // Single failure → continue (do not abort batch)
    // ═══════════════════════════════════════════════════════
    let timedOut = false;

    for (let i = 0; i < symbolConfigs.length; i++) {
      // Check overall timeout before each symbol
      if (Date.now() - startedMs > OVERALL_TIMEOUT_MS) {
        console.warn(`[${batchTag}] OVERALL TIMEOUT after ${OVERALL_TIMEOUT_MS / 1000}s — ${symbolConfigs.length - i} symbols skipped`);
        for (let j = i; j < symbolConfigs.length; j++) {
          failed.push(symbolConfigs[j].displaySymbol);
        }
        timedOut = true;
        break;
      }

      const config = symbolConfigs[i];

      if (i > 0 && !(phase === "close" && !includeBeneficiaryClose)) {
        await sleep(SYMBOL_DELAY_MS);
      }

      console.log(`[${batchTag}] [${i + 1}/${symbolConfigs.length}] Fetching ${config.displaySymbol}...`);

      try {
        const quote = config.market === "TW"
          ? await fetchTaiwanCoreQuote(config, fugleApiKey, `${batchTag}:${config.displaySymbol}`, phase, providerFailureDetails)
          : await fetchFinnhubQuote(config.finnhubSymbol, finnhubApiKey, `${batchTag}:${config.displaySymbol}`);

        if (!quote) {
          console.error(`[${batchTag}] [${i + 1}/${symbolConfigs.length}] ${config.displaySymbol} fetch returned null`);
          failed.push(config.displaySymbol);
          if (config.market === "TW") {
            twCoreSymbolsFailed.push({
              symbol: config.displaySymbol,
              reason: config.displaySymbol === "2330"
                ? "FUGLE_STOCK_AND_TWSE_FALLBACK_FAILED"
                : config.displaySymbol === "TXF"
                  ? "FUGLE_FUTOPT_FALLBACK_FAILED"
                  : "FUGLE_INDEX_AND_TWSE_FALLBACK_FAILED",
            });
          }
          continue;
        }

        const value = quote.value;
        const change = quote.change;
        const changePercent = quote.changePercent;
        const capturedAt = quote.capturedAt || new Date().toISOString();
        providerUsedBySymbol[config.displaySymbol] = quote.provider;
        if (config.market === "TW") twCoreSymbolsSuccess.push(config.displaySymbol);

        console.log(`[${batchTag}] [${i + 1}/${symbolConfigs.length}] ${config.displaySymbol} ${value} (${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%)`);

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
          dbWriteErrors.push({ symbol: config.displaySymbol, error: insertErr.message });
          continue;
        }

        const snapshotPayload = {
          symbol: config.displaySymbol,
          name: config.name,
          market: config.market,
          value: value,
          change_percent: changePercent,
          captured_at: capturedAt,
          source: quote.provider,
          phase,
          trading_date: tradingDate,
          raw: {
            provider: quote.provider,
            source_symbol: quote.sourceSymbol,
            display_symbol: config.displaySymbol,
            requested_at: startedAt,
            returned_date: quote.capturedAt,
            freshness_status: "provider_returned",
            fallback_used: quote.sourceSymbol !== config.finnhubSymbol,
            source_raw: quote.raw,
            quote: {
              current: value,
              change,
              change_percent: changePercent,
            },
            request_id: requestId,
          },
        };

        const { error: snapshotErr } = await supabase
          .from("market_data_snapshots")
          .upsert(snapshotPayload, { onConflict: "symbol,trading_date,phase" });

        if (snapshotErr) {
          console.error(`[${batchTag}] ${config.displaySymbol} snapshot DB error: ${snapshotErr.message}`);
          snapshotErrors.push({ symbol: config.displaySymbol, error: snapshotErr.message });
        } else {
          snapshotUpsertedCount++;
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
    const twCoreStatus = {
      taiex: twCoreSymbolsSuccess.includes("TAIEX") ? "ok" : "failed",
      stock_2330: twCoreSymbolsSuccess.includes("2330") ? "ok" : "failed",
      txf: twCoreSymbolsSuccess.includes("TXF") ? "ok" : "not_configured_or_failed",
    };

    const elapsed = ((Date.now() - startedMs) / 1000).toFixed(1);

    console.log(`[${batchTag}] DONE in ${elapsed}s | inserted=${inserted.length} failed=${failed.length} healthy=${healthy}${timedOut ? " (timed out)" : ""}`);

    return new Response(
      JSON.stringify({
        success: true,
        version: "V10.8_PROVIDER_FALLBACK_FRESHNESS",
        request_id: requestId,
        phase,
        trading_date: tradingDate,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        elapsed_seconds: parseFloat(elapsed),
        inserted: inserted,
        failed: failed,
        beneficiary_symbols_requested: beneficiarySymbolConfigs.map((s) => s.displaySymbol),
        close_core_only: phase === "close" && !includeBeneficiaryClose,
        beneficiary_close_only: beneficiaryCloseOnly,
        beneficiary_close_deferred: phase === "close" && !includeBeneficiaryClose,
        tw_core_status: twCoreStatus,
        tw_core_symbols_success: twCoreSymbolsSuccess,
        tw_core_symbols_failed: twCoreSymbolsFailed,
        provider_used_by_symbol: providerUsedBySymbol,
        db_write_errors: dbWriteErrors,
        txf_status: twCoreStatus.txf,
        txf_candidate_errors: providerFailureDetails.filter((f) => f.provider === "fugle_futopt"),
        provider_failures: providerFailureDetails,
        snapshot_upserted_count: snapshotUpsertedCount,
        snapshot_errors: snapshotErrors,
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
        version: "V10.8",
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
