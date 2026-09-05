import {
  parseFugleHistoricalCandles,
  parseTpexDailyBars,
  parseTpexInstitutionalFlows,
  parseTradingDate,
  parseTwseDailyBars,
  parseTwseTaiexObservations,
  validateHistoricalDataset,
} from "./historical-data-adapters.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const options = {
  fetchedAt: "2026-09-05T02:00:00.000Z",
  sourceRef: "https://example.invalid/official",
  sourceHash: "a".repeat(64),
};

Deno.test("historical adapter parses ROC and ISO dates without browser locale", () => {
  assert(parseTradingDate("1150904") === "2026-09-04", "ROC date should map to Gregorian date");
  assert(parseTradingDate("2026-09-04") === "2026-09-04", "ISO date should remain stable");
  assert(parseTradingDate("1150230") === null, "invalid calendar date must fail closed");
});

Deno.test("TWSE daily adapter preserves real OHLCV and marks adjustment unavailable", () => {
  const result = parseTwseDailyBars([{
    Date: "1150904", Code: "2330", OpeningPrice: "1,398.00", HighestPrice: "1,410.00",
    LowestPrice: "1,390.00", ClosingPrice: "1,405.00", TradeVolume: "32100000", TradeValue: "45000000000",
  }], options);
  assert(result.rows.length === 1 && result.rows[0].close === 1405, "TWSE bar should parse numeric strings");
  assert(result.rows[0].adjustmentStatus === "unavailable", "official current bar must not pretend to be adjusted");
  assert(result.rows[0].availableAt === options.fetchedAt, "forward acquisition must preserve observed availability");
});

Deno.test("TWSE daily adapter never converts missing data into zero", () => {
  const result = parseTwseDailyBars([{
    Date: "1150904", Code: "2330", OpeningPrice: "", HighestPrice: "1410", LowestPrice: "1390",
    ClosingPrice: "1405", TradeVolume: "32100000",
  }], options);
  assert(result.rows.length === 0 && result.issues.some((entry) => entry.code === "INVALID_OHLCV_ROW"), "missing open must block the row");
});

Deno.test("TPEx daily adapter creates a real OTC bar", () => {
  const result = parseTpexDailyBars([{
    Date: "1150904", SecuritiesCompanyCode: "6488", Open: "988", High: "1000", Low: "980", Close: "995",
    TradingShares: "1200000", TransactionAmount: "1194000000",
  }], options);
  assert(result.rows.length === 1 && result.rows[0].market === "TPEX" && result.rows[0].volume === 1_200_000, "TPEx bar should normalize");
});

Deno.test("TWSE TAIEX current-month endpoint remains incomplete without volume", () => {
  const result = parseTwseTaiexObservations([{
    Date: "1150904", OpeningIndex: "24300", HighestIndex: "24500", LowestIndex: "24200", ClosingIndex: "24450",
  }], options);
  assert(result.rows.length === 1 && result.rows[0].volume === null && !result.rows[0].readyForSignal, "missing index volume must remain explicit");
  assert(result.issues.some((entry) => entry.code === "TAIEX_VOLUME_UNAVAILABLE" && entry.severity === "blocking"), "TAIEX volume gap must block validation");
});

Deno.test("TPEx institutional adapter keeps foreign and trust but rejects absent dealer split", () => {
  const marketVolumes = new Map([["6488:2026-09-04", 1_200_000]]);
  const result = parseTpexInstitutionalFlows([{
    Date: "1150904", SecuritiesCompanyCode: "6488",
    "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Buy": "100000",
    " Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Total Sell": "80000",
    "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference": "20000",
    "SecuritiesInvestmentTrustCompanies-TotalBuy": "30000",
    "SecuritiesInvestmentTrustCompanies-TotalSell": "10000",
    "SecuritiesInvestmentTrustCompanies-Difference": "20000",
    "Dealers-TotalBuy": "5000", "Dealers-TotalSell": "4000", "Dealers-Difference": "1000",
  }], { ...options, marketVolumes });
  assert(result.rows.length === 2, "only safely identified institution types should be emitted");
  assert(result.rows.every((row) => row.marketVolume === 1_200_000), "joined market denominator should be retained");
  assert(result.issues.some((entry) => entry.code === "DEALER_PROPRIETARY_HISTORY_UNAVAILABLE"), "aggregate dealer must not become proprietary flow");
  assert(result.issues.some((entry) => entry.code === "DEALER_HEDGE_HISTORY_UNAVAILABLE"), "aggregate dealer must not become hedge flow");
});

Deno.test("TPEx institutional adapter never derives a missing net value from zero", () => {
  const result = parseTpexInstitutionalFlows([{
    Date: "1150904", SecuritiesCompanyCode: "6488",
    "ForeignInvestorsIncludeMainlandAreaInvestors-TotalBuy": "100000",
    "ForeignInvestorsIncludeMainlandAreaInvestors-TotalSell": "80000",
    "SecuritiesInvestmentTrustCompanies-TotalBuy": "30000",
    "SecuritiesInvestmentTrustCompanies-TotalSell": "10000",
  }], options);
  assert(result.rows.length === 0, "missing net values must not produce institution rows");
  assert(result.issues.filter((entry) => entry.code === "INSTITUTIONAL_VALUE_MISSING").length === 2, "each incomplete institution row should be audited");
});

Deno.test("Fugle candle adapter is conservative about historical availability", () => {
  const result = parseFugleHistoricalCandles({ data: [{ date: "2026-09-04", open: 100, high: 105, low: 99, close: 104, volume: 1000 }] }, {
    ...options, symbol: "2330", market: "TWSE", adjusted: true,
  });
  assert(result.rows.length === 1 && result.rows[0].adjustmentStatus === "adjusted", "adjusted response should remain labelled");
  assert(result.rows[0].availableAt === options.fetchedAt, "historical fetch time cannot be backdated to trading day");
  assert(result.issues.some((entry) => entry.code === "HISTORICAL_AVAILABLE_AT_UNPROVEN"), "point-in-time availability must remain blocked");
});

Deno.test("dataset validation blocks a one-day partial official sample", () => {
  const bars = parseTwseDailyBars([{
    Date: "1150904", Code: "2330", OpeningPrice: "1398", HighestPrice: "1410", LowestPrice: "1390",
    ClosingPrice: "1405", TradeVolume: "32100000", TradeValue: "45000000000",
  }], options).rows;
  const summary = validateHistoricalDataset({
    bars,
    institutionalFlows: [],
    taiexBars: [],
    corporateActions: [],
    historicalUniverseAvailable: false,
    availableAtProven: false,
    adjustedPriceMethodologyKnown: false,
  });
  assert(summary.status === "blocked" && summary.tradingDays === 1, "one day is not a historical validation dataset");
  assert(summary.reasonCodes.includes("HISTORY_RANGE_INSUFFICIENT"), "history gate should explain the block");
  assert(summary.reasonCodes.includes("INSTITUTIONAL_HISTORY_INCOMPLETE"), "institutional absence should explain the block");
  assert(summary.reasonCodes.includes("SURVIVORSHIP_BIAS_RISK"), "current-only universe must not pass");
});

Deno.test("dataset validation reports duplicates and missing sessions deterministically", () => {
  const base = parseTwseDailyBars([{
    Date: "1150904", Code: "2330", OpeningPrice: "1398", HighestPrice: "1410", LowestPrice: "1390",
    ClosingPrice: "1405", TradeVolume: "32100000", TradeValue: "45000000000",
  }], options).rows[0];
  const summary = validateHistoricalDataset({
    bars: [base, { ...base }],
    institutionalFlows: [], taiexBars: [], corporateActions: [],
    historicalUniverseAvailable: false, availableAtProven: false, adjustedPriceMethodologyKnown: false,
  });
  assert(summary.duplicateRate === 0.5 && summary.reasonCodes.includes("DUPLICATE_OHLCV"), "duplicate rate must be explicit");
});
