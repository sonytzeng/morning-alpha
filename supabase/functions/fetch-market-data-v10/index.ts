import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authorizeInternalRequest, internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import { normalizeProviderQuote, summarizeProviderHealth } from '../_shared/market-provider-adapter.mjs';
import {
  resolveSnapshotCheckpoint,
  stateForSnapshotCheckpoint,
} from '../_shared/runtime-checkpoint-core.mjs';
import {
  buildBeneficiaryBatchContract,
  buildBeneficiaryCloseStatus,
  classifyProviderFailures,
  evaluateCheckpointFreshness,
  sanitizeProviderError,
} from '../_shared/market-runtime-stability.mjs';
import {
  normalizeConfiguredProxyQuote,
  normalizeProviderTimestamp,
} from '../_shared/provider-normalization.mjs';

// ═══════════════════════════════════════════════════════════
// fetch-market-data-v10 V10.12 — CLOSE CHECKPOINT OWNERSHIP REPAIR
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
const VERSION = "V10.13_TERMINAL_CHECKPOINT_REUSE";

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
  directionMultiplier?: 1 | -1;
  proxySemantics?: string;
}

interface BeneficiaryLookupResult {
  configs: SymbolConfig[];
  lookupStatus: "not_requested" | "loaded" | "report_not_found" | "query_failed";
  decisionMode: "recommendations" | "no_trade" | "blocked";
  contractValid: boolean;
  sourceField: string;
  v10Enabled: boolean;
  sourceRowCount: number;
  invalidRowCount: number;
  error: string | null;
}

type RuntimeSupabaseClient = ReturnType<typeof createClient<any>>;

type MarketDataPhase = "premarket" | "intraday" | "close" | "manual_backfill";

interface RequestBody {
  phase?: MarketDataPhase;
  checkpoint?: string;
  include_beneficiary_close?: boolean;
  beneficiary_close?: boolean;
  beneficiary_close_only?: boolean;
  force_run?: boolean;
}

const SYMBOLS: SymbolConfig[] = [
  { finnhubSymbol: "SPY", displaySymbol: "SPX", name: "S&P 500（proxy: SPY ETF proxy）", market: "US", taiwanImpact: "美股整體健康度指標" },
  { finnhubSymbol: "QQQ", displaySymbol: "IXIC", name: "Nasdaq（proxy: QQQ ETF proxy）", market: "US", taiwanImpact: "科技股風向標" },
  { finnhubSymbol: "SOXX", displaySymbol: "SOX", name: "費城半導體指數（proxy: SOXX ETF proxy）", market: "US", taiwanImpact: "半導體族群強弱指標" },
  { finnhubSymbol: "NVDA", displaySymbol: "NVDA", name: "Nvidia", market: "US", taiwanImpact: "AI 龍頭，直接牽動台灣 AI 供應鏈" },
  { finnhubSymbol: "TSM", displaySymbol: "TSM", name: "TSMC ADR", market: "US", taiwanImpact: "台積電 ADR 連動台股價格" },
  { finnhubSymbol: "VXX", displaySymbol: "VIX", name: "恐慌指數（proxy: VXX ETN proxy）", market: "US", taiwanImpact: "市場恐慌情緒" },
  { finnhubSymbol: "UUP", displaySymbol: "DXY", name: "美元指數方向（proxy: UUP ETF）", market: "US", taiwanImpact: "影響外資流向與台幣匯率", proxySemantics: "same_direction_us_dollar_proxy" },
  { finnhubSymbol: "IEF", displaySymbol: "US10Y", name: "美國10年債殖利率方向（proxy: inverse IEF ETF）", market: "US", taiwanImpact: "影響資金成本與科技股估值", directionMultiplier: -1, proxySemantics: "inverse_7_10y_treasury_price_proxy" },
  { finnhubSymbol: "TAIEX", displaySymbol: "TAIEX", name: "台股加權指數", market: "TW", taiwanImpact: "台股大盤整體風向指標" },
  { finnhubSymbol: "2330", displaySymbol: "2330", name: "台積電", market: "TW", taiwanImpact: "台股權值股龍頭" },
  { finnhubSymbol: "TXF", displaySymbol: "TXF", name: "台指期", market: "TW", taiwanImpact: "台指期提供期貨領先訊號" },
];

const CLOSE_CORE_SYMBOLS = new Set(["TAIEX", "2330", "TXF", "SPX", "IXIC", "SOX", "NVDA", "TSM", "VIX"]);

// MVP required symbols for safe bias to work
const MVP_REQUIRED = ["NVDA", "TSM", "SPX"];
const TAIWAN_DECISION_REQUIRED = ["TAIEX", "2330"];
const TAIWAN_FIRST_ORDER = ["TAIEX", "2330", "TXF", "SPX", "IXIC", "SOX", "NVDA", "TSM", "VIX", "DXY", "US10Y"];

function prioritizeCoreSymbols(configs: SymbolConfig[], phase: MarketDataPhase): SymbolConfig[] {
  if (phase === "premarket" || phase === "manual_backfill") return configs;
  const priority = new Map(TAIWAN_FIRST_ORDER.map((symbol, index) => [symbol, index]));
  return [...configs].sort((left, right) =>
    (priority.get(left.displaySymbol) ?? Number.MAX_SAFE_INTEGER) -
    (priority.get(right.displaySymbol) ?? Number.MAX_SAFE_INTEGER)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isTaiwanStockSymbol(symbol: string): boolean {
  return /^\d{4,6}$/.test(symbol);
}

async function fetchBeneficiarySymbolConfigsForDate(
  supabase: RuntimeSupabaseClient,
  reportDate: string,
  logPrefix: string,
): Promise<BeneficiaryLookupResult> {
  const decisionResult = await supabase
    .from("decision_snapshots")
    .select("decision_mode,generated_text")
    .eq("report_date", reportDate)
    .eq("session_type", "PREMARKET")
    .eq("is_current", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (decisionResult.error) {
    console.warn(`[${logPrefix}] beneficiary decision lookup failed: ${decisionResult.error.message}`);
    return {
      configs: [],
      lookupStatus: "query_failed",
      decisionMode: "blocked",
      contractValid: false,
      sourceField: "decision_snapshots",
      v10Enabled: true,
      sourceRowCount: 0,
      invalidRowCount: 0,
      error: decisionResult.error.message,
    };
  }

  if (decisionResult.data) {
    const decision = asRecord(decisionResult.data);
    const generatedText = asRecord(decision.generated_text);
    const recommendations = Array.isArray(generatedText.recommendations) ? generatedText.recommendations : [];
    const decisionMode = String(decision.decision_mode || "").trim().toLowerCase();
    if (decisionMode === "no_trade" || decisionMode === "blocked") {
      const contractValid = recommendations.length === 0;
      return {
        configs: [],
        lookupStatus: "loaded",
        decisionMode: contractValid ? decisionMode : "blocked",
        contractValid,
        sourceField: "decision_snapshots.generated_text.recommendations",
        v10Enabled: true,
        sourceRowCount: recommendations.length,
        invalidRowCount: contractValid ? 0 : recommendations.length,
        error: contractValid ? null : "non_recommendation_decision_contains_recommendations",
      };
    }

    const contract = buildBeneficiaryBatchContract({
      v10_beneficiary_enabled: true,
      today_beneficiary_stocks_v10: recommendations,
    }, {
      existingSymbols: [],
      maxSymbols: 12,
    });
    const contractValid = decisionMode === "recommendations" && contract.contract_valid === true &&
      contract.invalid_row_count === 0 && contract.configs.length > 0;
    return {
      configs: contractValid ? contract.configs as SymbolConfig[] : [],
      lookupStatus: "loaded",
      decisionMode: contractValid ? "recommendations" : "blocked",
      contractValid,
      sourceField: "decision_snapshots.generated_text.recommendations",
      v10Enabled: true,
      sourceRowCount: contract.source_row_count,
      invalidRowCount: contract.invalid_row_count,
      error: contractValid ? null : "invalid_canonical_beneficiary_contract",
    };
  }

  const { data, error } = await supabase
    .from("reports")
    .select("ai_strategy_json")
    .eq("report_date", reportDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(`[${logPrefix}] beneficiary symbol lookup skipped: ${error.message}`);
    return {
      configs: [],
      lookupStatus: "query_failed",
      decisionMode: "blocked",
      contractValid: false,
      sourceField: "unknown",
      v10Enabled: false,
      sourceRowCount: 0,
      invalidRowCount: 0,
      error: error.message,
    };
  }

  if (!data) {
    console.warn(`[${logPrefix}] beneficiary symbol lookup failed: report_not_found`);
    return {
      configs: [],
      lookupStatus: "report_not_found",
      decisionMode: "blocked",
      contractValid: false,
      sourceField: "unknown",
      v10Enabled: false,
      sourceRowCount: 0,
      invalidRowCount: 0,
      error: "report_not_found",
    };
  }

  const ai = asRecord((data as Record<string, unknown> | null)?.ai_strategy_json);
  const contract = buildBeneficiaryBatchContract(ai, {
    existingSymbols: [],
    maxSymbols: 12,
  });
  const decisionMode: BeneficiaryLookupResult["decisionMode"] =
    contract.decision_mode === "recommendations" || contract.decision_mode === "no_trade"
      ? contract.decision_mode
      : "blocked";
  const contractValid = contract.contract_valid === true && contract.invalid_row_count === 0;
  return {
    configs: contractValid ? contract.configs as SymbolConfig[] : [],
    lookupStatus: "loaded",
    decisionMode: contractValid ? decisionMode : "blocked",
    contractValid,
    sourceField: contract.source_field,
    v10Enabled: contract.v10_enabled,
    sourceRowCount: contract.source_row_count,
    invalidRowCount: contract.invalid_row_count,
    error: contractValid ? null : "invalid_report_beneficiary_contract",
  };
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
        if (attempt < MAX_RETRIES) {
          const waitMs = 10000 * (attempt + 1);
          console.log(`[${logPrefix}] 429 rate-limited, waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}`);
          await sleep(waitMs);
          continue;
        }
        failureDetails?.push({ provider: "finnhub", symbol: finnhubSymbol, endpoint: "quote", status: response.status });
        return null;
      }

      if (response.status === 503) {
        if (attempt < MAX_RETRIES) {
          console.log(`[${logPrefix}] 503 unavailable, retry ${attempt + 1}/${MAX_RETRIES} after 3s`);
          await sleep(3000);
          continue;
        }
        failureDetails?.push({ provider: "finnhub", symbol: finnhubSymbol, endpoint: "quote", status: response.status });
        return null;
      }

      if (!response.ok) {
        console.error(`[${logPrefix}] HTTP ${response.status}, aborting`);
        failureDetails?.push({ provider: "finnhub", symbol: finnhubSymbol, endpoint: "quote", status: response.status });
        return null;
      }

      const data: FinnhubQuote = await response.json();

      // Finnhub returns all zeros for invalid/missing symbols
      if (data.c === 0 && data.h === 0 && data.l === 0 && data.o === 0 && data.pc === 0) {
        console.error(`[${logPrefix}] Finnhub returned all-zero quote — symbol may be invalid or unsupported`);
        failureDetails?.push({ provider: "finnhub", symbol: finnhubSymbol, endpoint: "quote", error: "all_zero_quote" });
        return null;
      }

      return {
        value: data.c,
        change: data.d,
        changePercent: data.dp,
        capturedAt: normalizeTimestamp(data.t),
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
            captured_at: normalizeTimestamp(data.t),
          },
        },
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof DOMException && err.name === "AbortError";
      const message = sanitizeProviderError(err instanceof Error ? err.message : String(err));
      if (isTimeout) {
        console.error(`[${logPrefix}] TIMEOUT after ${FETCH_TIMEOUT_MS / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      } else {
        console.error(`[${logPrefix}] Fetch error: ${message}`);
      }
      if (attempt < MAX_RETRIES) {
        await sleep(3000);
        continue;
      }
      failureDetails?.push({
        provider: "finnhub",
        symbol: finnhubSymbol,
        endpoint: "quote",
        error: isTimeout ? "timeout" : message,
      });
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
  return "";
}

function normalizeTimestamp(value: unknown): string {
  return normalizeProviderTimestamp(value);
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

  const lastTrade = data.lastTrade && typeof data.lastTrade === "object" && !Array.isArray(data.lastTrade)
    ? data.lastTrade as Record<string, unknown>
    : {};
  const total = data.total && typeof data.total === "object" && !Array.isArray(data.total)
    ? data.total as Record<string, unknown>
    : {};
  const capturedAt = normalizeTimestamp(
    data.lastUpdated || data.last_updated || data.updatedAt || lastTrade.time || total.time ||
      data.closeTime || trade.at || data.time || data.date,
  );
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
  query?: Record<string, string>,
): Promise<MarketQuote | null> {
  if (!apiKey) {
    failureDetails?.push({ provider: providerLabel, symbol, endpoint: path, error: "missing_api_key" });
    return null;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);
  try {
    const search = query ? `?${new URLSearchParams(query).toString()}` : "";
    const response = await fetch(`https://api.fugle.tw/marketdata/v1.0/${path}/${encodeURIComponent(symbol)}${search}`, {
      headers: {
        "Accept": "application/json",
        "X-API-KEY": apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      let errorBody = "";
      try { errorBody = sanitizeProviderError((await response.text()).slice(0, 240)); } catch { errorBody = ""; }
      console.warn(`[${logPrefix}] Fugle ${providerLabel} ${symbol} HTTP ${response.status}${errorBody ? ` ${errorBody}` : ""}`);
      failureDetails?.push({ provider: providerLabel, symbol, endpoint: path, status: response.status, error: errorBody || undefined });
      return null;
    }
    const data = await response.json();
    const quote = normalizeFugleQuote(data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}, symbol);
    return quote ? { ...quote, provider: providerLabel, raw: { ...quote.raw, provider: providerLabel } } : null;
  } catch (err) {
    clearTimeout(timeoutId);
    const message = sanitizeProviderError(err instanceof Error ? err.message : String(err));
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
  if (!apiKey) {
    failureDetails?.push({ provider: "fugle_futopt", symbol: "TXF", endpoint: pathWithQuery, error: "missing_api_key" });
    return null;
  }
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
      try { body = sanitizeProviderError((await response.text()).slice(0, 240)); } catch { body = ""; }
      console.warn(`[${logPrefix}] Fugle futopt discovery ${pathWithQuery} HTTP ${response.status} ${body}`);
      failureDetails?.push({ provider: "fugle_futopt", symbol: "TXF", endpoint: pathWithQuery, status: response.status, error: body || undefined });
      return null;
    }
    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    const message = sanitizeProviderError(err instanceof Error ? err.message : String(err));
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
  preferredSession: "REGULAR" | "AFTERHOURS",
  failureDetails?: ProviderFailureDetail[],
): Promise<string | null> {
  const sessions = preferredSession === "REGULAR"
    ? ["REGULAR", "AFTERHOURS"]
    : ["AFTERHOURS", "REGULAR"];
  const endpoints = sessions.map((session) =>
    `futopt/intraday/tickers?type=FUTURE&exchange=TAIFEX&session=${session}&product=TXF`
  );
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
  const quote = await fetchFugleQuoteFromPath(
    "futopt/intraday/quote",
    symbol,
    apiKey,
    logPrefix,
    "fugle_futopt",
    failureDetails,
    session === "afterhours" ? { session: "afterhours" } : undefined,
  );
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
  failureDetails?: ProviderFailureDetail[],
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
      failureDetails?.push({ provider: "twse_mis", symbol: sourceSymbol, endpoint: exCh, status: response.status });
      return null;
    }
    const data = await response.json();
    return normalizeTwseQuote(data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}, sourceSymbol);
  } catch (err) {
    clearTimeout(timeoutId);
    const message = sanitizeProviderError(err instanceof Error ? err.message : String(err));
    console.warn(`[${logPrefix}] TWSE ${sourceSymbol} failed: ${message}`);
    failureDetails?.push({ provider: "twse_mis", symbol: sourceSymbol, endpoint: exCh, error: message });
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
      await fetchTwseQuote("tse_2330.tw", "2330", logPrefix, failureDetails) ??
      null;
  }

  if (config.displaySymbol === "TAIEX") {
    // IX0001 is the TWSE price index. IR0001 is the total-return index and is
    // not semantically interchangeable with TAIEX; accepting it silently
    // produces a plausible but materially wrong six-digit market level.
    const fugleIndexCandidates = ["IX0001", "TAIEX"];
    for (const candidate of fugleIndexCandidates) {
      const quote = await fetchFugleStockQuote(candidate, fugleApiKey, logPrefix, failureDetails);
      if (quote) return { ...quote, sourceSymbol: candidate };
    }
    return await fetchTwseQuote("tse_t00.tw", "TAIEX", logPrefix, failureDetails);
  }

  if (config.displaySymbol === "TXF") {
    const preferredSession: "regular" | "afterhours" = phase === "premarket" || phase === "manual_backfill" ? "afterhours" : "regular";
    const fallbackSession: "regular" | "afterhours" = preferredSession === "afterhours" ? "regular" : "afterhours";
    const aliasFailureStart = failureDetails?.length || 0;
    const continuousAlias = "TXF1!";
    const aliasQuote = await fetchFugleFutOptQuote(continuousAlias, fugleApiKey, logPrefix, preferredSession, failureDetails);
    if (aliasQuote) {
      return { ...aliasQuote, sourceSymbol: continuousAlias, raw: { ...aliasQuote.raw, contract_resolution: "continuous_alias", fallback_used: false } };
    }
    const aliasAccessBlocked = (failureDetails || []).slice(aliasFailureStart)
      .some((detail) => [401, 402, 403].includes(Number(detail.status)));
    if (aliasAccessBlocked) return null;

    const aliasFallbackQuote = await fetchFugleFutOptQuote(continuousAlias, fugleApiKey, logPrefix, fallbackSession, failureDetails);
    if (aliasFallbackQuote) {
      return {
        ...aliasFallbackQuote,
        sourceSymbol: continuousAlias,
        raw: { ...aliasFallbackQuote.raw, contract_resolution: "continuous_alias", fallback_used: true, fallback_from_session: preferredSession },
      };
    }
    const contractSymbol = await getActiveTxfContractSymbol(
      fugleApiKey,
      logPrefix,
      preferredSession === "afterhours" ? "AFTERHOURS" : "REGULAR",
      failureDetails,
    );
    if (!contractSymbol) {
      failureDetails?.push({ provider: "fugle_futopt", symbol: "TXF", endpoint: "contract_resolution", error: "cannot_resolve_active_txf_contract" });
      return null;
    }
    const quote = await fetchFugleFutOptQuote(contractSymbol, fugleApiKey, logPrefix, preferredSession, failureDetails);
    if (quote) return { ...quote, sourceSymbol: contractSymbol, raw: { ...quote.raw, contract_resolution: "ticker_discovery", fallback_used: false } };
    const fallbackQuote = await fetchFugleFutOptQuote(contractSymbol, fugleApiKey, logPrefix, fallbackSession, failureDetails);
    if (fallbackQuote) return { ...fallbackQuote, sourceSymbol: contractSymbol, raw: { ...fallbackQuote.raw, contract_resolution: "ticker_discovery", fallback_used: true, fallback_from_session: preferredSession } };
  }

  if (isTaiwanStockSymbol(config.displaySymbol)) {
    const symbol = config.displaySymbol;
    return await fetchFugleStockQuote(symbol, fugleApiKey, logPrefix, failureDetails) ??
      await fetchTwseQuote(`tse_${symbol}.tw`, symbol, logPrefix, failureDetails) ??
      await fetchTwseQuote(`otc_${symbol}.tw`, symbol, logPrefix, failureDetails) ??
      null;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const requestedCorrelationId = req.headers.get("x-correlation-id") || "";
  const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCorrelationId)
    ? requestedCorrelationId
    : crypto.randomUUID();
  const requestId = correlationId.slice(0, 8);
  const startedAt = new Date().toISOString();
  const batchTag = `${VERSION}:${requestId}`;
  const startedMs = Date.now();

  console.log(`[${batchTag}] ======== START ${startedAt} ========`);

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Auth: shared internal service contract ──
    const auth = await authorizeInternalRequest(req.headers, internalCredentialsFromEnv());
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ success: false, error: auth.error_code, error_code: auth.error_code }),
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
    const checkpoint = resolveSnapshotCheckpoint({
      phase,
      checkpoint: requestBody.checkpoint,
      hour: taipei.hour,
      minute: taipei.minute,
    });
    if (!checkpoint) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "INVALID_CHECKPOINT_FOR_PHASE",
          phase,
          checkpoint: requestBody.checkpoint || null,
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
      );
    }
    const tradingDate = taipei.date;
    const marketStatus = resolveMarketStatus(tradingDate);
    if (!marketStatus.is_trading_day && requestBody.force_run !== true) {
      console.log(`[${batchTag}] MARKET_CLOSED_SKIP status=${marketStatus.market_status} date=${tradingDate}`);
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: "MARKET_STATUS_NOT_OPEN",
        phase,
        checkpoint,
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

    // A completed checkpoint is an immutable point-in-time observation. Backup
    // Cron or an operator replay may safely reuse it, but must never replace the
    // 09:00 snapshot with a later quote just because the same checkpoint label
    // was sent again.
    if (!beneficiaryCloseOnly) {
      const requiredSymbols = phase === "premarket" || phase === "manual_backfill"
        ? MVP_REQUIRED
        : TAIWAN_DECISION_REQUIRED;
      const { data: existingDayState, error: existingDayStateError } = await supabase
        .from("trading_day_state")
        .select("checkpoint_status")
        .eq("trading_date", tradingDate)
        .maybeSingle();
      if (existingDayStateError) {
        console.warn(`[${batchTag}] CHECKPOINT_REUSE_STATE_LOOKUP_FAILED ${existingDayStateError.message}`);
      } else {
        const checkpointRecord = asRecord(asRecord(existingDayState?.checkpoint_status)[checkpoint]);
        const checkpointMetadata = asRecord(checkpointRecord.metadata);
        const terminalCheckpoint = String(checkpointRecord.status || "") === "SUCCEEDED"
          && checkpointMetadata.required_core_complete === true
          && checkpointMetadata.canonical_complete === true;
        if (terminalCheckpoint) {
          const { data: existingSnapshots, error: existingSnapshotsError } = await supabase
            .from("market_data_snapshots")
            .select("symbol,name,value,change_percent,captured_at,source")
            .eq("trading_date", tradingDate)
            .eq("phase", phase)
            .eq("checkpoint", checkpoint)
            .in("symbol", requiredSymbols);
          const snapshotRows = Array.isArray(existingSnapshots) ? existingSnapshots : [];
          const existingSymbols = new Set(snapshotRows.map((row) => String(row.symbol || "")));
          const snapshotContractComplete = !existingSnapshotsError
            && requiredSymbols.every((symbol) => existingSymbols.has(symbol));
          if (snapshotContractComplete) {
            console.log(`[${batchTag}] CHECKPOINT_REUSED checkpoint=${checkpoint} symbols=${requiredSymbols.join(",")}`);
            return new Response(JSON.stringify({
              success: true,
              version: VERSION,
              request_id: requestId,
              correlation_id: correlationId,
              phase,
              checkpoint,
              trading_date: tradingDate,
              started_at: startedAt,
              completed_at: new Date().toISOString(),
              inserted: snapshotRows,
              failed: [],
              canonical_complete: true,
              snapshot_complete: true,
              core_batch_complete: true,
              required_core_symbols: requiredSymbols,
              required_core_complete: true,
              provider_health: { status: "reused_terminal_checkpoint", healthy: true },
              provider_health_write_errors: [],
              trading_day_state_status: "SUCCEEDED",
              trading_day_state_error: null,
              trading_day_state_transition_skipped: true,
              tw_core_status: {
                taiex: existingSymbols.has("TAIEX") ? "ok" : "missing",
                stock_2330: existingSymbols.has("2330") ? "ok" : "missing",
                txf: existingSymbols.has("TXF") ? "ok" : "missing",
              },
              tw_core_symbols_success: requiredSymbols.filter((symbol) => existingSymbols.has(symbol)),
              tw_core_symbols_failed: requiredSymbols.filter((symbol) => !existingSymbols.has(symbol)),
              checkpoint_complete: true,
              checkpoint_reused: true,
              operation_succeeded: true,
              snapshot_upserted_count: 0,
              snapshot_reused_count: snapshotRows.length,
              snapshot_errors: [],
              symbols: requiredSymbols,
              healthy: true,
              timed_out: false,
            }), { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
          }
          console.warn(`[${batchTag}] CHECKPOINT_REUSE_CONTRACT_INCOMPLETE checkpoint=${checkpoint} error=${existingSnapshotsError?.message || "required snapshots missing"}`);
        }
      }
    }

    const beneficiaryLookup: BeneficiaryLookupResult = includeBeneficiaryClose
      ? await fetchBeneficiarySymbolConfigsForDate(supabase, tradingDate, batchTag)
      : {
        configs: [],
        lookupStatus: "not_requested",
        decisionMode: "blocked",
        contractValid: false,
        sourceField: "not_requested",
        v10Enabled: false,
        sourceRowCount: 0,
        invalidRowCount: 0,
        error: null,
      };
    const beneficiarySymbolConfigs = beneficiaryLookup.configs;
    const baseCoreSymbolConfigs = beneficiaryCloseOnly
      ? []
      : phase === "close"
      ? SYMBOLS.filter((item) => CLOSE_CORE_SYMBOLS.has(item.displaySymbol))
      : SYMBOLS;
    const coreSymbolConfigs = prioritizeCoreSymbols(baseCoreSymbolConfigs, phase);
    const symbolConfigs = [...coreSymbolConfigs, ...beneficiarySymbolConfigs];

    const inserted: Array<{ symbol: string; name: string; value: number; change_percent: number }> = [];
    const failed: string[] = [];
    const snapshotErrors: Array<{ symbol: string; error: string }> = [];
    const dbWriteErrors: Array<{ symbol: string; error: string }> = [];
    const canonicalWriteErrors: Array<{ symbol: string; error: string }> = [];
    const providerHealthWriteErrors: string[] = [];
    const providerUsedBySymbol: Record<string, string> = {};
    const providerFailureDetails: ProviderFailureDetail[] = [];
    const twCoreSymbolsSuccess: string[] = [];
    const twCoreSymbolsFailed: Array<{ symbol: string; reason: string }> = [];
    const snapshotSymbolsSuccess: string[] = [];
    const canonicalSymbolsSuccess: string[] = [];
    let snapshotUpsertedCount = 0;
    let canonicalUpsertedCount = 0;
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
        const fetchedQuote = config.market === "TW"
          ? await fetchTaiwanCoreQuote(config, fugleApiKey, `${batchTag}:${config.displaySymbol}`, phase, providerFailureDetails)
          : await fetchFinnhubQuote(config.finnhubSymbol, finnhubApiKey, `${batchTag}:${config.displaySymbol}`, providerFailureDetails);
        const quote = normalizeConfiguredProxyQuote(fetchedQuote, config) as MarketQuote | null;

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
                  : config.displaySymbol === "TAIEX"
                    ? "FUGLE_INDEX_AND_TWSE_FALLBACK_FAILED"
                    : "FUGLE_STOCK_AND_TWSE_FALLBACK_FAILED",
            });
          }
          continue;
        }

        const freshness = evaluateCheckpointFreshness({
          captured_at: quote.capturedAt,
          evaluated_at: new Date().toISOString(),
          trading_date: tradingDate,
          market: config.market,
          phase,
          symbol: config.displaySymbol,
        });
        if (freshness.valid !== true) {
          const freshnessError = `provider_timestamp:${String(freshness.status || "invalid")}`;
          console.error(`[${batchTag}] ${config.displaySymbol} rejected: ${freshnessError}`);
          failed.push(config.displaySymbol);
          providerFailureDetails.push({
            provider: quote.provider,
            symbol: config.displaySymbol,
            endpoint: "normalized_quote",
            error: freshnessError,
          });
          if (config.market === "TW") {
            twCoreSymbolsFailed.push({ symbol: config.displaySymbol, reason: "STALE_OR_INVALID_PROVIDER_TIMESTAMP" });
          }
          continue;
        }

        const value = quote.value;
        const change = quote.change;
        const changePercent = quote.changePercent;
        const capturedAt = quote.capturedAt;
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
          checkpoint,
          trading_date: tradingDate,
          raw: {
            provider: quote.provider,
            source_symbol: quote.sourceSymbol,
            display_symbol: config.displaySymbol,
            requested_at: startedAt,
            returned_date: quote.capturedAt,
            freshness_status: freshness.status,
            freshness_age_minutes: freshness.age_minutes,
            captured_session_date: freshness.captured_session_date,
            fallback_used: quote.sourceSymbol !== config.finnhubSymbol,
            source_raw: quote.raw,
            quote: {
              current: value,
              change,
              change_percent: changePercent,
            },
            request_id: requestId,
            checkpoint,
          },
        };

        const { error: snapshotErr } = await supabase
          .from("market_data_snapshots")
          .upsert(snapshotPayload, { onConflict: "symbol,trading_date,phase,checkpoint" });

        if (snapshotErr) {
          console.error(`[${batchTag}] ${config.displaySymbol} snapshot DB error: ${snapshotErr.message}`);
          snapshotErrors.push({ symbol: config.displaySymbol, error: snapshotErr.message });
        } else {
          snapshotUpsertedCount++;
          snapshotSymbolsSuccess.push(config.displaySymbol);
        }

        const canonicalQuote = normalizeProviderQuote({
          provider: quote.provider,
          symbol: config.displaySymbol,
          source_symbol: quote.sourceSymbol,
          name: config.name,
          market: config.market,
          trading_date: tradingDate,
          phase,
          value,
          change,
          change_percent: changePercent,
          captured_at: capturedAt,
          freshness_status: freshness.status,
          correlation_id: correlationId,
          raw_payload: snapshotPayload.raw,
        });

        if (!canonicalQuote.valid) {
          canonicalWriteErrors.push({ symbol: config.displaySymbol, error: canonicalQuote.errors.join(",") });
        } else {
          const canonicalPayload = {
            ...canonicalQuote.record,
            asset_type: canonicalQuote.asset_type,
            quality_status: "verified",
          };
          const { data: canonicalRow, error: canonicalErr } = await supabase
            .from("market_quotes")
            .upsert(canonicalPayload, { onConflict: "provider,symbol,captured_at,phase" })
            .select("id")
            .maybeSingle();

          if (canonicalErr) {
            canonicalWriteErrors.push({ symbol: config.displaySymbol, error: canonicalErr.message });
          } else {
            canonicalUpsertedCount++;
            let specializedWriteSucceeded = true;
            const specializedPayload = {
              market_quote_id: canonicalRow?.id || null,
              provider: quote.provider,
              symbol: config.displaySymbol,
              market: config.market,
              trading_date: tradingDate,
              phase,
              value,
              change_percent: changePercent,
              captured_at: capturedAt,
              correlation_id: correlationId,
            };
            const specializedTable = canonicalQuote.asset_type === "future"
              ? "futures_snapshots"
              : canonicalQuote.asset_type === "index"
              ? "market_indices"
              : null;
            if (specializedTable) {
              const { error: specializedErr } = await supabase
                .from(specializedTable)
                .upsert(specializedPayload, { onConflict: "provider,symbol,captured_at,phase" });
              if (specializedErr) {
                specializedWriteSucceeded = false;
                canonicalWriteErrors.push({ symbol: config.displaySymbol, error: `${specializedTable}:${specializedErr.message}` });
              }
            }
            if (specializedWriteSucceeded) canonicalSymbolsSuccess.push(config.displaySymbol);
          }
        }

        inserted.push({
          symbol: config.displaySymbol,
          name: config.name,
          value: value,
          change_percent: changePercent,
        });

        console.log(`[${batchTag}] ${config.displaySymbol} saved to market_data`);
      } catch (err) {
        const msg = sanitizeProviderError(err instanceof Error ? err.message : String(err));
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

    const summarizedProviderHealth = summarizeProviderHealth({
      requested_count: symbolConfigs.length,
      succeeded_count: inserted.length,
      failed_count: failed.length,
      timed_out: timedOut,
    });
    const overallHealth = beneficiaryCloseOnly && beneficiaryLookup.lookupStatus === "loaded" && beneficiaryLookup.contractValid &&
        (beneficiaryLookup.decisionMode === "no_trade" || beneficiaryLookup.decisionMode === "blocked")
      ? {
        status: "healthy",
        success_rate: 100,
        requested_count: 0,
        succeeded_count: 0,
        failed_count: 0,
        timed_out: false,
      }
      : summarizedProviderHealth;
    const classifiedProviderFailures = classifyProviderFailures(providerFailureDetails);
    const canonicalComplete = canonicalUpsertedCount === inserted.length && canonicalWriteErrors.length === 0;
    const snapshotComplete = snapshotUpsertedCount === inserted.length && snapshotErrors.length === 0;
    const requiredCoreSymbols = phase === "premarket" || phase === "manual_backfill"
      ? MVP_REQUIRED
      : TAIWAN_DECISION_REQUIRED;
    const requiredCoreComplete = requiredCoreSymbols.every((symbol) =>
      inserted.some((item) => item.symbol === symbol) &&
      snapshotSymbolsSuccess.includes(symbol) &&
      canonicalSymbolsSuccess.includes(symbol)
    );
    const coreBatchComplete = !beneficiaryCloseOnly && requiredCoreComplete &&
      snapshotErrors.length === 0 && canonicalComplete;
    const beneficiaryCloseStatus = buildBeneficiaryCloseStatus({
      lookup_status: beneficiaryLookup.lookupStatus,
      decision_mode: beneficiaryLookup.decisionMode,
      contract_valid: beneficiaryLookup.contractValid,
      requested_symbols: beneficiarySymbolConfigs.map((item) => item.displaySymbol),
      inserted_symbols: inserted.map((item) => item.symbol),
      snapshot_symbols: snapshotSymbolsSuccess,
      canonical_symbols: canonicalSymbolsSuccess,
    });
    const providerDegradationCodes = new Set([
      "AUTHENTICATION_FAILED",
      "BLOCKED_BY_SUBSCRIPTION",
      "CONFIGURATION_MISSING",
      "RATE_LIMITED",
      "PROVIDER_UNAVAILABLE",
      "TIMEOUT",
      "STALE_PROVIDER_DATA",
    ]);
    const hasProviderDegradation = classifiedProviderFailures.some((failure: Record<string, unknown>) =>
      providerDegradationCodes.has(String(failure.failure_code || ""))
    );
    const healthProvider = beneficiaryCloseOnly
      ? "market_fetch_v10_beneficiary_close"
      : "market_fetch_v10";
    const providerHealthPayloads = [{
      provider: healthProvider,
      service_date: tradingDate,
      phase,
      checkpoint,
      ...overallHealth,
      latency_ms: Date.now() - startedMs,
      last_error_code: timedOut
        ? "OVERALL_TIMEOUT"
        : !canonicalComplete
          ? "CANONICAL_WRITE_FAILED"
          : beneficiaryCloseOnly && beneficiaryCloseStatus.complete !== true
            ? String(beneficiaryCloseStatus.status || "BENEFICIARY_CLOSE_INCOMPLETE")
            : classifiedProviderFailures[0]?.failure_code || (failed.length > 0 ? "PARTIAL_PROVIDER_FAILURE" : null),
      correlation_id: correlationId,
      details: {
        providers_by_symbol: providerUsedBySymbol,
        provider_failures: classifiedProviderFailures,
        canonical_write_errors: canonicalWriteErrors,
        beneficiary_lookup: beneficiaryLookup,
        beneficiary_close_status: beneficiaryCloseStatus,
        core_batch_complete: coreBatchComplete,
        required_core_symbols: requiredCoreSymbols,
        required_core_complete: requiredCoreComplete,
        canonical_complete: canonicalComplete,
        snapshot_complete: snapshotComplete,
        has_provider_degradation: hasProviderDegradation,
      },
      checked_at: new Date().toISOString(),
    }];
    const { error: providerHealthError } = await supabase
      .from("data_provider_health")
      .upsert(providerHealthPayloads, { onConflict: "provider,service_date,phase,checkpoint" });
    if (providerHealthError) providerHealthWriteErrors.push(providerHealthError.message);

    let relatedCoreHealth = {
      status: beneficiaryCloseOnly ? "missing" : String(overallHealth.status || "unknown"),
      evidence_complete: beneficiaryCloseOnly ? false : coreBatchComplete,
      healthy: beneficiaryCloseOnly
        ? false
        : overallHealth.status === "healthy" && !hasProviderDegradation && providerHealthWriteErrors.length === 0,
      error: null as string | null,
    };
    if (beneficiaryCloseOnly) {
      const { data: coreHealthRow, error: coreHealthError } = await supabase
        .from("data_provider_health")
        .select("status,details")
        .eq("provider", "market_fetch_v10")
        .eq("service_date", tradingDate)
        .eq("phase", phase)
        .eq("checkpoint", checkpoint)
        .maybeSingle();
      if (coreHealthError) {
        relatedCoreHealth = {
          status: "lookup_failed",
          evidence_complete: false,
          healthy: false,
          error: coreHealthError.message,
        };
      } else {
        const coreDetails = asRecord((coreHealthRow as Record<string, unknown> | null)?.details);
        const coreStatus = String((coreHealthRow as Record<string, unknown> | null)?.status || "missing");
        relatedCoreHealth = {
          status: coreStatus,
          evidence_complete: coreDetails.core_batch_complete === true,
          healthy: coreStatus === "healthy" && coreDetails.has_provider_degradation !== true,
          error: coreHealthRow ? null : "core_health_missing",
        };
      }
    }

    const state = stateForSnapshotCheckpoint(checkpoint);
    // The authoritative close-core pass owns the checkpoint transition. Premium
    // beneficiary coverage is a separate idempotent pass and must not make a
    // healthy TAIEX/2330/TXF batch look degraded while that second pass is
    // intentionally deferred.
    const checkpointEvidenceComplete = beneficiaryCloseOnly
      ? beneficiaryCloseStatus.complete === true && canonicalComplete && snapshotComplete && relatedCoreHealth.evidence_complete
      : coreBatchComplete;
    const checkpointStatus = checkpointEvidenceComplete && failed.length === 0 && !timedOut && !hasProviderDegradation &&
        providerHealthWriteErrors.length === 0 && relatedCoreHealth.healthy
      ? "SUCCEEDED"
      : "DEGRADED";
    // A beneficiary-only close pass validates premium recommendations after the
    // core close pass. It must never overwrite the checkpoint's authoritative
    // TAIEX/2330/TXF completeness metadata with an empty core batch.
    const tradingDayStateResult = beneficiaryCloseOnly
      ? { error: null }
      : state
      ? await supabase.rpc("advance_trading_day_state_v1", {
        p_trading_date: tradingDate,
        p_state: state,
        p_checkpoint: checkpoint,
        p_status: checkpointStatus,
        p_correlation_id: correlationId,
        p_metadata: {
          phase,
          requested_count: symbolConfigs.length,
          snapshot_upserted_count: snapshotUpsertedCount,
          canonical_upserted_count: canonicalUpsertedCount,
          canonical_complete: canonicalComplete,
          failed_symbols: failed,
          beneficiary_close_status: beneficiaryCloseStatus,
          core_batch_complete: coreBatchComplete,
          required_core_symbols: requiredCoreSymbols,
          required_core_complete: requiredCoreComplete,
          related_core_health: relatedCoreHealth,
          provider_failure_codes: classifiedProviderFailures.map((failure: Record<string, unknown>) => failure.failure_code),
        },
      })
      : { error: { message: "checkpoint_state_mapping_missing" } };
    const tradingDayStateError = tradingDayStateResult.error;
    const operationSucceeded = !timedOut && providerHealthWriteErrors.length === 0 && !tradingDayStateError &&
      (beneficiaryCloseOnly ? checkpointEvidenceComplete : coreBatchComplete);

    console.log(`[${batchTag}] DONE in ${elapsed}s | inserted=${inserted.length} failed=${failed.length} healthy=${healthy}${timedOut ? " (timed out)" : ""}`);

    return new Response(
      JSON.stringify({
        success: operationSucceeded,
        version: VERSION,
        request_id: requestId,
        correlation_id: correlationId,
        phase,
        checkpoint,
        trading_date: tradingDate,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        elapsed_seconds: parseFloat(elapsed),
        inserted: inserted,
        failed: failed,
        beneficiary_symbols_requested: beneficiarySymbolConfigs.map((s) => s.displaySymbol),
        beneficiary_lookup: {
          status: beneficiaryLookup.lookupStatus,
          decision_mode: beneficiaryLookup.decisionMode,
          contract_valid: beneficiaryLookup.contractValid,
          source_field: beneficiaryLookup.sourceField,
          v10_enabled: beneficiaryLookup.v10Enabled,
          source_row_count: beneficiaryLookup.sourceRowCount,
          invalid_row_count: beneficiaryLookup.invalidRowCount,
          error: beneficiaryLookup.error,
        },
        beneficiary_close_status: beneficiaryCloseStatus,
        close_core_only: phase === "close" && !includeBeneficiaryClose,
        beneficiary_close_only: beneficiaryCloseOnly,
        beneficiary_close_deferred: phase === "close" && !includeBeneficiaryClose,
        tw_core_status: twCoreStatus,
        tw_core_symbols_success: twCoreSymbolsSuccess,
        tw_core_symbols_failed: twCoreSymbolsFailed,
        provider_used_by_symbol: providerUsedBySymbol,
        db_write_errors: dbWriteErrors,
        canonical_upserted_count: canonicalUpsertedCount,
        canonical_write_errors: canonicalWriteErrors,
        canonical_complete: canonicalComplete,
        snapshot_complete: snapshotComplete,
        core_batch_complete: coreBatchComplete,
        required_core_symbols: requiredCoreSymbols,
        required_core_complete: requiredCoreComplete,
        related_core_health: relatedCoreHealth,
        provider_health: overallHealth,
        provider_health_write_errors: providerHealthWriteErrors,
        trading_day_state_status: checkpointStatus,
        trading_day_state_error: tradingDayStateError?.message || null,
        trading_day_state_transition_skipped: beneficiaryCloseOnly,
        checkpoint_complete: checkpointEvidenceComplete && !tradingDayStateError,
        operation_succeeded: operationSucceeded,
        txf_status: twCoreStatus.txf,
        txf_candidate_errors: classifiedProviderFailures.filter((f: Record<string, unknown>) => f.provider === "fugle_futopt"),
        provider_failures: classifiedProviderFailures,
        snapshot_upserted_count: snapshotUpsertedCount,
        snapshot_errors: snapshotErrors,
        symbols: allSymbols,
        healthy: healthy,
        timed_out: timedOut,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (fatalErr) {
    const msg = sanitizeProviderError(fatalErr instanceof Error ? fatalErr.message : String(fatalErr));
    console.error(`[${batchTag}] FATAL: ${msg}`);
    return new Response(
      JSON.stringify({
        success: false,
        version: VERSION,
        correlation_id: correlationId,
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
