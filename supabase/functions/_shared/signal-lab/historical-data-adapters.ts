import { finiteNumber, normalizeSymbol } from "./normalization.ts";
import type { CorporateActionInput, InstitutionalFlowInput, OhlcvBar } from "./types.ts";

type RawRecord = Record<string, unknown>;

export interface HistoricalAdapterIssue {
  code: string;
  severity: "warning" | "blocking";
  dataset: string;
  rowIndex?: number;
  symbol?: string;
}

export interface HistoricalAdapterResult<T> {
  rows: T[];
  issues: HistoricalAdapterIssue[];
}

export interface TaiexPriceObservation {
  symbol: "TAIEX";
  tradingDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: null;
  availableAt: string;
  provider: "TWSE_OPENAPI";
  sourceDataset: "MI_5MINS_HIST";
  sourceRef: string;
  sourceHash?: string;
  readyForSignal: false;
}

export interface DatasetValidationInput {
  bars: OhlcvBar[];
  institutionalFlows: InstitutionalFlowInput[];
  taiexBars: OhlcvBar[];
  corporateActions: CorporateActionInput[];
  historicalUniverseAvailable: boolean;
  availableAtProven: boolean;
  adjustedPriceMethodologyKnown: boolean;
  minimumTradingDays?: number;
}

export interface DatasetValidationSummary {
  status: "pass" | "blocked";
  datasetRows: number;
  symbolCount: number;
  startDate: string | null;
  endDate: string | null;
  tradingDays: number;
  missingRate: number | null;
  duplicateRate: number;
  invalidOhlc: number;
  invalidVolume: number;
  institutionalCoverage: number;
  taiexCoverage: number;
  corporateActionStatus: "complete" | "incomplete";
  availableAtStatus: "proven" | "unproven";
  survivorshipBiasRisk: "absent" | "present";
  reasonCodes: string[];
}

export interface AdapterOptions {
  fetchedAt: string;
  sourceRef: string;
  sourceHash?: string;
}

function records(value: unknown): RawRecord[] {
  if (Array.isArray(value)) return value.filter((row): row is RawRecord => Boolean(row) && typeof row === "object");
  if (!value || typeof value !== "object") return [];
  const data = (value as RawRecord).data;
  return Array.isArray(data) ? data.filter((row): row is RawRecord => Boolean(row) && typeof row === "object") : [];
}

function normalizedFieldMap(row: RawRecord): Map<string, unknown> {
  return new Map(Object.entries(row).map(([key, value]) => [key.trim().replace(/\s+/g, " ").toLowerCase(), value]));
}

function valueFor(row: RawRecord, aliases: string[]): unknown {
  const normalized = normalizedFieldMap(row);
  for (const alias of aliases) {
    const value = normalized.get(alias.trim().replace(/\s+/g, " ").toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function numberFor(row: RawRecord, aliases: string[]): number | null {
  const value = valueFor(row, aliases);
  if (typeof value === "string") return finiteNumber(value.replaceAll(",", "").replace(/^\+/, ""));
  return finiteNumber(value);
}

export function parseTradingDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? trimmed
    : /^(\d{3})(\d{2})(\d{2})$/.test(trimmed)
      ? trimmed.replace(/^(\d{3})(\d{2})(\d{2})$/, (_, year, month, day) => `${Number(year) + 1911}-${month}-${day}`)
      : null;
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function validFetchedAt(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function issue(dataset: string, code: string, severity: "warning" | "blocking", rowIndex?: number, symbol?: string): HistoricalAdapterIssue {
  return { dataset, code, severity, ...(rowIndex === undefined ? {} : { rowIndex }), ...(symbol ? { symbol } : {}) };
}

function validOhlcv(open: number | null, high: number | null, low: number | null, close: number | null, volume: number | null): boolean {
  return open !== null && high !== null && low !== null && close !== null && volume !== null &&
    [open, high, low, close, volume].every(Number.isFinite) && open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0 &&
    high >= Math.max(open, low, close) && low <= Math.min(open, high, close);
}

export function parseTwseDailyBars(payload: unknown, options: AdapterOptions): HistoricalAdapterResult<OhlcvBar> {
  const dataset = "TWSE_STOCK_DAY_ALL";
  const output: HistoricalAdapterResult<OhlcvBar> = { rows: [], issues: [] };
  if (!validFetchedAt(options.fetchedAt)) return { rows: [], issues: [issue(dataset, "INVALID_FETCHED_AT", "blocking")] };
  records(payload).forEach((row, rowIndex) => {
    const symbol = normalizeSymbol(String(valueFor(row, ["Code"]) || ""));
    if (!/^\d{4,6}$/.test(symbol)) return;
    const tradingDate = parseTradingDate(valueFor(row, ["Date"]));
    const open = numberFor(row, ["OpeningPrice"]);
    const high = numberFor(row, ["HighestPrice"]);
    const low = numberFor(row, ["LowestPrice"]);
    const close = numberFor(row, ["ClosingPrice"]);
    const volume = numberFor(row, ["TradeVolume"]);
    if (!tradingDate || !validOhlcv(open, high, low, close, volume)) {
      output.issues.push(issue(dataset, "INVALID_OHLCV_ROW", "blocking", rowIndex, symbol));
      return;
    }
    output.rows.push({
      symbol,
      market: "TWSE",
      tradingDate,
      open: open!, high: high!, low: low!, close: close!, volume: volume!,
      turnover: numberFor(row, ["TradeValue"]),
      adjustedClose: null,
      adjustmentStatus: "unavailable",
      availableAt: options.fetchedAt,
      provider: "TWSE_OPENAPI",
      sourceDataset: "STOCK_DAY_ALL",
      sourceRef: options.sourceRef,
      sourceHash: options.sourceHash,
    });
  });
  return output;
}

export function parseTpexDailyBars(payload: unknown, options: AdapterOptions): HistoricalAdapterResult<OhlcvBar> {
  const dataset = "TPEX_MAINBOARD_QUOTES";
  const output: HistoricalAdapterResult<OhlcvBar> = { rows: [], issues: [] };
  if (!validFetchedAt(options.fetchedAt)) return { rows: [], issues: [issue(dataset, "INVALID_FETCHED_AT", "blocking")] };
  records(payload).forEach((row, rowIndex) => {
    const symbol = normalizeSymbol(String(valueFor(row, ["SecuritiesCompanyCode"]) || ""));
    if (!/^\d{4,6}$/.test(symbol)) return;
    const tradingDate = parseTradingDate(valueFor(row, ["Date"]));
    const open = numberFor(row, ["Open"]);
    const high = numberFor(row, ["High"]);
    const low = numberFor(row, ["Low"]);
    const close = numberFor(row, ["Close"]);
    const volume = numberFor(row, ["TradingShares"]);
    if (!tradingDate || !validOhlcv(open, high, low, close, volume)) {
      output.issues.push(issue(dataset, "INVALID_OHLCV_ROW", "blocking", rowIndex, symbol));
      return;
    }
    output.rows.push({
      symbol,
      market: "TPEX",
      tradingDate,
      open: open!, high: high!, low: low!, close: close!, volume: volume!,
      turnover: numberFor(row, ["TransactionAmount"]),
      adjustedClose: null,
      adjustmentStatus: "unavailable",
      availableAt: options.fetchedAt,
      provider: "TPEX_OPENAPI",
      sourceDataset: "tpex_mainboard_quotes",
      sourceRef: options.sourceRef,
      sourceHash: options.sourceHash,
    });
  });
  return output;
}

export function parseTwseTaiexObservations(payload: unknown, options: AdapterOptions): HistoricalAdapterResult<TaiexPriceObservation> {
  const dataset = "TWSE_MI_5MINS_HIST";
  const output: HistoricalAdapterResult<TaiexPriceObservation> = { rows: [], issues: [] };
  if (!validFetchedAt(options.fetchedAt)) return { rows: [], issues: [issue(dataset, "INVALID_FETCHED_AT", "blocking")] };
  records(payload).forEach((row, rowIndex) => {
    const tradingDate = parseTradingDate(valueFor(row, ["Date"]));
    const open = numberFor(row, ["OpeningIndex"]);
    const high = numberFor(row, ["HighestIndex"]);
    const low = numberFor(row, ["LowestIndex"]);
    const close = numberFor(row, ["ClosingIndex"]);
    if (!tradingDate || open === null || high === null || low === null || close === null || high < Math.max(open, low, close) || low > Math.min(open, high, close)) {
      output.issues.push(issue(dataset, "INVALID_INDEX_ROW", "blocking", rowIndex, "TAIEX"));
      return;
    }
    output.rows.push({
      symbol: "TAIEX", tradingDate, open, high, low, close, volume: null,
      availableAt: options.fetchedAt,
      provider: "TWSE_OPENAPI",
      sourceDataset: "MI_5MINS_HIST",
      sourceRef: options.sourceRef,
      sourceHash: options.sourceHash,
      readyForSignal: false,
    });
  });
  if (output.rows.length > 0) output.issues.push(issue(dataset, "TAIEX_VOLUME_UNAVAILABLE", "blocking", undefined, "TAIEX"));
  return output;
}

const TPEX_FOREIGN_BUY = [
  "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Buy",
  "ForeignInvestorsIncludeMainlandAreaInvestors-TotalBuy",
];
const TPEX_FOREIGN_SELL = [
  "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Sell",
  "ForeignInvestorsIncludeMainlandAreaInvestors-TotalSell",
];
const TPEX_FOREIGN_NET = [
  "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference",
  "ForeignInvestorsInclude MainlandAreaInvestors-Difference",
];

export function parseTpexInstitutionalFlows(
  payload: unknown,
  options: AdapterOptions & { marketVolumes?: ReadonlyMap<string, number> },
): HistoricalAdapterResult<InstitutionalFlowInput> {
  const dataset = "TPEX_3INSTI_DAILY_TRADING";
  const output: HistoricalAdapterResult<InstitutionalFlowInput> = { rows: [], issues: [] };
  if (!validFetchedAt(options.fetchedAt)) return { rows: [], issues: [issue(dataset, "INVALID_FETCHED_AT", "blocking")] };
  records(payload).forEach((row, rowIndex) => {
    const symbol = normalizeSymbol(String(valueFor(row, ["SecuritiesCompanyCode"]) || ""));
    if (!/^\d{4,6}$/.test(symbol)) return;
    const tradingDate = parseTradingDate(valueFor(row, ["Date"]));
    const marketVolume = options.marketVolumes?.get(`${symbol}:${tradingDate}`) ?? null;
    const groups = [
      {
        type: "foreign" as const,
        buy: numberFor(row, TPEX_FOREIGN_BUY),
        sell: numberFor(row, TPEX_FOREIGN_SELL),
        net: numberFor(row, TPEX_FOREIGN_NET),
      },
      {
        type: "trust" as const,
        buy: numberFor(row, ["SecuritiesInvestmentTrustCompanies-TotalBuy"]),
        sell: numberFor(row, ["SecuritiesInvestmentTrustCompanies-TotalSell"]),
        net: numberFor(row, ["SecuritiesInvestmentTrustCompanies-Difference"]),
      },
    ];
    if (!tradingDate) {
      output.issues.push(issue(dataset, "INVALID_TRADING_DATE", "blocking", rowIndex, symbol));
      return;
    }
    for (const group of groups) {
      if (group.buy === null || group.sell === null || group.net === null) {
        output.issues.push(issue(dataset, "INSTITUTIONAL_VALUE_MISSING", "blocking", rowIndex, symbol));
        continue;
      }
      output.rows.push({
        symbol,
        market: "TPEX",
        tradingDate,
        institutionType: group.type,
        buyVolume: group.buy,
        sellVolume: group.sell,
        netVolume: group.net,
        marketVolume,
        averageVolume20d: null,
        averageTurnover20d: null,
        availableAt: options.fetchedAt,
        provider: "TPEX_OPENAPI",
        sourceDataset: "tpex_3insti_daily_trading",
        sourceRef: options.sourceRef,
        sourceHash: options.sourceHash,
      });
    }
  });
  if (output.rows.length > 0) {
    output.issues.push(issue(dataset, "DEALER_PROPRIETARY_HISTORY_UNAVAILABLE", "blocking"));
    output.issues.push(issue(dataset, "DEALER_HEDGE_HISTORY_UNAVAILABLE", "blocking"));
    output.issues.push(issue(dataset, "INSTITUTIONAL_ROLLING_DENOMINATORS_UNAVAILABLE", "blocking"));
  }
  return output;
}

export function parseFugleHistoricalCandles(
  payload: unknown,
  options: AdapterOptions & { symbol: string; market: OhlcvBar["market"]; adjusted: boolean },
): HistoricalAdapterResult<OhlcvBar> {
  const dataset = "FUGLE_HISTORICAL_CANDLES";
  const output: HistoricalAdapterResult<OhlcvBar> = { rows: [], issues: [] };
  const symbol = normalizeSymbol(options.symbol);
  if (!validFetchedAt(options.fetchedAt)) return { rows: [], issues: [issue(dataset, "INVALID_FETCHED_AT", "blocking")] };
  records(payload).forEach((row, rowIndex) => {
    const tradingDate = parseTradingDate(valueFor(row, ["date", "tradingDate", "trading_date"]));
    const open = numberFor(row, ["open"]);
    const high = numberFor(row, ["high"]);
    const low = numberFor(row, ["low"]);
    const close = numberFor(row, ["close"]);
    const volume = numberFor(row, ["volume"]);
    if (!tradingDate || !validOhlcv(open, high, low, close, volume)) {
      output.issues.push(issue(dataset, "INVALID_OHLCV_ROW", "blocking", rowIndex, symbol));
      return;
    }
    output.rows.push({
      symbol,
      market: options.market,
      tradingDate,
      open: open!, high: high!, low: low!, close: close!, volume: volume!,
      turnover: numberFor(row, ["turnover", "value"]),
      adjustedClose: options.adjusted ? close : null,
      adjustmentStatus: options.adjusted ? "adjusted" : "unavailable",
      // Historical rows remain unavailable to prior signal timestamps unless a separately
      // audited publication-time ledger replaces this conservative acquisition timestamp.
      availableAt: options.fetchedAt,
      provider: "FUGLE_MARKETDATA",
      sourceDataset: options.adjusted ? "historical_candles_adjusted" : "historical_candles_raw",
      sourceRef: options.sourceRef,
      sourceHash: options.sourceHash,
    });
  });
  if (!options.adjusted && output.rows.length > 0) output.issues.push(issue(dataset, "ADJUSTED_PRICE_UNAVAILABLE", "blocking", undefined, symbol));
  output.issues.push(issue(dataset, "HISTORICAL_AVAILABLE_AT_UNPROVEN", "blocking", undefined, symbol));
  return output;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

export function validateHistoricalDataset(input: DatasetValidationInput): DatasetValidationSummary {
  const minimumTradingDays = input.minimumTradingDays ?? 252 * 5;
  const dates = [...new Set(input.bars.map((bar) => bar.tradingDate))].sort();
  const symbols = [...new Set(input.bars.map((bar) => normalizeSymbol(bar.symbol)))];
  const keys = input.bars.map((bar) => `${normalizeSymbol(bar.symbol)}:${bar.tradingDate}`);
  const duplicateRows = keys.length - new Set(keys).size;
  const invalidOhlc = input.bars.filter((bar) => !validOhlcv(bar.open, bar.high, bar.low, bar.close, bar.volume)).length;
  const invalidVolume = input.bars.filter((bar) => !Number.isFinite(bar.volume) || bar.volume < 0).length;
  const expectedCells = symbols.length * dates.length;
  const missingCells = Math.max(0, expectedCells - new Set(keys).size);
  const requiredInstitutions = ["foreign", "trust", "dealer_proprietary", "dealer_hedge"] as const;
  const institutionalKeys = new Set(input.institutionalFlows.map((row) => `${normalizeSymbol(row.symbol)}:${row.tradingDate}:${row.institutionType}`));
  const requiredInstitutionCells = symbols.length * dates.length * requiredInstitutions.length;
  const taiexDates = new Set(input.taiexBars.map((bar) => bar.tradingDate));
  const reasonCodes: string[] = [];
  if (dates.length < minimumTradingDays) reasonCodes.push("HISTORY_RANGE_INSUFFICIENT");
  if (symbols.length === 0) reasonCodes.push("OHLCV_UNAVAILABLE");
  if (missingCells > 0) reasonCodes.push("OHLCV_MISSING_SESSIONS");
  if (duplicateRows > 0) reasonCodes.push("DUPLICATE_OHLCV");
  if (invalidOhlc > 0) reasonCodes.push("INVALID_OHLC");
  if (invalidVolume > 0) reasonCodes.push("INVALID_VOLUME");
  if (institutionalKeys.size < requiredInstitutionCells) reasonCodes.push("INSTITUTIONAL_HISTORY_INCOMPLETE");
  if (taiexDates.size < dates.length || dates.length === 0) reasonCodes.push("TAIEX_HISTORY_INCOMPLETE");
  if (input.corporateActions.length === 0 || !input.adjustedPriceMethodologyKnown) reasonCodes.push("CORPORATE_ACTION_HANDLING_INCOMPLETE");
  if (!input.availableAtProven) reasonCodes.push("AVAILABLE_AT_UNPROVEN");
  if (!input.historicalUniverseAvailable) reasonCodes.push("SURVIVORSHIP_BIAS_RISK");
  return {
    status: reasonCodes.length === 0 ? "pass" : "blocked",
    datasetRows: input.bars.length + input.institutionalFlows.length + input.taiexBars.length + input.corporateActions.length,
    symbolCount: symbols.length,
    startDate: dates[0] || null,
    endDate: dates.at(-1) || null,
    tradingDays: dates.length,
    missingRate: expectedCells === 0 ? null : rate(missingCells, expectedCells),
    duplicateRate: rate(duplicateRows, keys.length),
    invalidOhlc,
    invalidVolume,
    institutionalCoverage: rate(institutionalKeys.size, requiredInstitutionCells),
    taiexCoverage: rate(taiexDates.size, dates.length),
    corporateActionStatus: input.corporateActions.length > 0 && input.adjustedPriceMethodologyKnown ? "complete" : "incomplete",
    availableAtStatus: input.availableAtProven ? "proven" : "unproven",
    survivorshipBiasRisk: input.historicalUniverseAvailable ? "absent" : "present",
    reasonCodes: [...new Set(reasonCodes)].sort(),
  };
}
