import { calculateInstitutionalFlow } from "./institutional-flow-engine.ts";
import { calculateTechnicalAnalysis } from "./technical-analysis-engine.ts";
import { calculateMarketRegime } from "./market-regime-engine.ts";
import { calculateCrossSignal, DEFAULT_SIGNAL_LAB_STRATEGY } from "./cross-signal-engine.ts";
import { runDataQualityGate } from "./data-quality.ts";
import { cappedDirectionalScore, finiteNumber, normalizeSymbol, percentileRank } from "./normalization.ts";
import { sha256Hex, stableSerialize } from "./snapshot-hash.ts";
import { buildShadowPrediction, nextCalculationVersion, predictionIdempotencyKey } from "./shadow-pipeline.ts";
import { assessScoreCalibration, buildWalkForwardWindows, calculateBacktestOutcomes, calibrateScores, selectDeterministicRandomBaseline, simpleMomentumEligible, splitChronologically, summarizeOutcomes, validateBacktestInputs } from "./backtest-engine.ts";
import { evaluateMatureOutcomes } from "./forward-outcome-engine.ts";
import { parseSignalStrategy } from "./strategy-contract.ts";
import { translateReasonCode } from "./reason-labels.ts";
import type { CorporateActionInput, InstitutionalFlowInput, MarketCostConfig, OhlcvBar } from "./types.ts";

const SIGNAL_TIME = "2026-03-22T07:00:00.000Z";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dates(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index));
    return date.toISOString().slice(0, 10);
  });
}

function priceBars(symbol = "2330", count = 80, drift = 0.4): OhlcvBar[] {
  return dates(count).map((tradingDate, index) => {
    const close = 100 + index * drift + Math.sin(index / 4);
    return {
      symbol, market: symbol === "TAIEX" ? "INDEX" : "TWSE", tradingDate,
      open: close - 0.2, high: close + 1, low: close - 1, close,
      volume: 1_000_000 + index * 10_000, turnover: close * 1_000_000,
      adjustedClose: close, adjustmentStatus: "adjusted",
      availableAt: `${tradingDate}T06:00:00.000Z`, provider: "fixture", sourceRef: `fixture:${symbol}:${tradingDate}`,
    };
  });
}

function institutionRows(symbol = "2330", count = 20): InstitutionalFlowInput[] {
  return ["foreign", "trust", "dealer_proprietary", "dealer_hedge"].flatMap((institutionType, typeIndex) => dates(80).slice(-count).map((tradingDate, index) => ({
    symbol, market: "TWSE" as const, tradingDate,
    institutionType: institutionType as InstitutionalFlowInput["institutionType"],
    netVolume: institutionType === "dealer_hedge" ? -100 - index : 1_000 + index * 20 + typeIndex,
    netValue: 50_000_000, marketVolume: 2_000_000, averageVolume20d: 1_500_000, averageTurnover20d: 150_000_000,
    availableAt: `${tradingDate}T08:00:00.000Z`, provider: "fixture", sourceRef: `fixture:${institutionType}:${tradingDate}`,
  })));
}

function readyQuality(bars: OhlcvBar[], flows: InstitutionalFlowInput[]) {
  return runDataQualityGate({ signalTimestamp: SIGNAL_TIME, bars, institutionalFlows: flows, eligibleSymbols: ["2330"], completeSymbols: ["2330"], tradingCalendarStatus: "ready", expectedTradingDates: bars.map((bar) => bar.tradingDate) });
}

Deno.test("normalization rejects absent values and normalizes Taiwanese symbols", () => {
  assert(finiteNumber(null) === null && finiteNumber("") === null, "absent numeric values must be rejected");
  assert(finiteNumber("123.45") === 123.45, "numeric strings should remain usable");
  assert(normalizeSymbol("TWSE:2330.TW") === "2330", "TWSE symbol should normalize");
  assert(normalizeSymbol("^TWII") === "TAIEX", "TAIEX aliases should normalize");
});

Deno.test("normalization caps extreme directional values", () => {
  assert(cappedDirectionalScore(10_000, 0.04) === 100, "extreme value must be capped");
  const rank = percentileRank(1_000, [1, 2, 3, 4, 5]);
  assert(rank !== null && rank <= 1, "winsorized percentile must remain bounded");
});

Deno.test("institutional engine computes required windows and preserves dealer hedge separately", () => {
  const result = calculateInstitutionalFlow({
    symbol: "2330",
    signalTimestamp: SIGNAL_TIME,
    flows: institutionRows(),
    crossSectionalRatios: { foreign: [-0.04, -0.01, 0.01, 0.02, 0.04], trust: [-0.03, 0, 0.01, 0.03] },
  });
  assert(result.status === "ready" && result.score !== null, "complete institutional data should be ready");
  assert(result.foreign?.net20d !== null && result.trust?.net20d !== null, "20D windows must exist");
  assert(result.foreign?.crossSectionalPercentile !== null, "runtime cohort should produce a cross-sectional percentile");
  assert((result.dealerHedge?.net5d || 0) < 0, "hedge flow must stay separate");
});

Deno.test("institutional engine returns unavailable instead of zero when required data is missing", () => {
  const result = calculateInstitutionalFlow({ symbol: "2330", signalTimestamp: SIGNAL_TIME, flows: [] });
  assert(result.status === "unavailable" && result.score === null, "missing flow must not become a zero score");
});

Deno.test("institutional available_at blocks look-ahead input", () => {
  const flows = institutionRows();
  flows[0].availableAt = "2026-09-06T00:00:00.000Z";
  const result = calculateInstitutionalFlow({ symbol: "2330", signalTimestamp: SIGNAL_TIME, flows });
  assert(result.status === "blocked" && result.score === null, "future institutional row must block generation");
});

Deno.test("institutional engine rejects missing volume denominators instead of fabricating zero", () => {
  const flows = institutionRows();
  for (const row of flows.filter((value) => value.institutionType === "foreign" && value.tradingDate === dates(80).at(-1))) row.marketVolume = null;
  const result = calculateInstitutionalFlow({ symbol: "2330", signalTimestamp: SIGNAL_TIME, flows });
  assert(result.status === "unavailable" && result.score === null, "missing denominator must fail closed");
});

Deno.test("technical engine calculates the five score groups without future pivots", () => {
  const result = calculateTechnicalAnalysis({ symbol: "2330", signalTimestamp: SIGNAL_TIME, bars: priceBars() });
  assert(result.status === "ready" && result.score !== null, "complete price history should produce a technical score");
  assert(result.trendScore !== null && result.momentumScore !== null && result.volumeScore !== null && result.volatilityScore !== null && result.structureScore !== null, "all component scores must exist");
});

Deno.test("technical engine rejects short history", () => {
  const result = calculateTechnicalAnalysis({ symbol: "2330", signalTimestamp: SIGNAL_TIME, bars: priceBars("2330", 59) });
  assert(result.status === "unavailable" && result.score === null, "short history must be unavailable");
});

Deno.test("technical engine blocks rows unavailable at signal time", () => {
  const bars = priceBars();
  bars.at(-1)!.availableAt = "2026-09-06T00:00:00.000Z";
  const result = calculateTechnicalAnalysis({ symbol: "2330", signalTimestamp: SIGNAL_TIME, bars });
  assert(result.status === "blocked", "future bar must never be backfilled into a prior signal");
});

Deno.test("technical engine blocks unresolved corporate actions", () => {
  const action: CorporateActionInput = { symbol: "2330", actionDate: "2026-03-01", actionType: "cash_dividend", availableAt: "2026-03-01T00:00:00Z", resolved: false };
  const result = calculateTechnicalAnalysis({ symbol: "2330", signalTimestamp: SIGNAL_TIME, bars: priceBars(), corporateActions: [action] });
  assert(result.status === "blocked" && result.reasonCodes.includes("UNRESOLVED_CORPORATE_ACTION"), "unresolved action must block analysis");
});

Deno.test("technical engine blocks unadjusted history with unknown corporate actions", () => {
  const bars = priceBars();
  bars[10].adjustmentStatus = "unavailable";
  const result = calculateTechnicalAnalysis({ symbol: "2330", signalTimestamp: SIGNAL_TIME, bars });
  assert(result.status === "blocked" && result.reasonCodes.includes("ADJUSTED_PRICE_UNAVAILABLE"), "unknown adjustment status must block technical scoring");
});

Deno.test("market regime is deterministic and does not use AI", () => {
  const first = calculateMarketRegime({ signalTimestamp: SIGNAL_TIME, taiexBars: priceBars("TAIEX") });
  const second = calculateMarketRegime({ signalTimestamp: SIGNAL_TIME, taiexBars: priceBars("TAIEX") });
  assert(JSON.stringify(first) === JSON.stringify(second), "regime calculation must be deterministic");
  assert(first.regime === "BULLISH", "upward fixture should be bullish");
});

Deno.test("market regime returns unavailable for insufficient TAIEX history", () => {
  const result = calculateMarketRegime({ signalTimestamp: SIGNAL_TIME, taiexBars: priceBars("TAIEX", 20) });
  assert(result.status === "unavailable" && result.score === null, "missing index history must not be guessed");
});

Deno.test("cross signal honors versioned weights and never emits BUY or SELL", () => {
  const bars = priceBars(); const flows = institutionRows();
  const institutional = calculateInstitutionalFlow({ symbol: "2330", signalTimestamp: SIGNAL_TIME, flows });
  const technical = calculateTechnicalAnalysis({ symbol: "2330", signalTimestamp: SIGNAL_TIME, bars });
  const marketRegime = calculateMarketRegime({ signalTimestamp: SIGNAL_TIME, taiexBars: priceBars("TAIEX") });
  const result = calculateCrossSignal({ institutional, technical, marketRegime });
  assert(result.score !== null && result.strategyVersion === DEFAULT_SIGNAL_LAB_STRATEGY.version, "versioned cross score expected");
  assert(!["BUY", "SELL"].includes(String(result.label)), "shadow labels must not use recommendation language");
});

Deno.test("persisted snake-case strategy contract maps without changing weights", () => {
  const strategy = parseSignalStrategy({
    version: "SIGNAL_LAB_V1_SHADOW",
    feature_version: "SIGNAL_FEATURES_V1",
    weights: { technical: 0.4, institutional: 0.35, volume: 0.15, market_regime: 0.1 },
    score_thresholds: { strong_positive: 85, positive: 70, neutral: 45, negative: 30 },
  });
  assert(strategy?.weights.marketRegime === 0.1 && strategy.thresholds.strongPositive === 85, "database strategy must map to the engine contract");
});

Deno.test("invalid persisted strategy fails closed instead of using defaults", () => {
  const strategy = parseSignalStrategy({
    version: "BROKEN",
    feature_version: "SIGNAL_FEATURES_V1",
    weights: { technical: 0.4, institutional: 0.35, volume: 0.15 },
    score_thresholds: { strong_positive: 85, positive: 70, neutral: 45, negative: 30 },
  });
  assert(strategy === null, "missing persisted weight must block shadow generation");
});

Deno.test("cross signal fails closed when institutional data is unavailable", () => {
  const result = calculateCrossSignal({
    institutional: calculateInstitutionalFlow({ symbol: "2330", signalTimestamp: SIGNAL_TIME, flows: [] }),
    technical: calculateTechnicalAnalysis({ symbol: "2330", signalTimestamp: SIGNAL_TIME, bars: priceBars() }),
    marketRegime: calculateMarketRegime({ signalTimestamp: SIGNAL_TIME, taiexBars: priceBars("TAIEX") }),
  });
  assert(result.status === "unavailable" && result.score === null, "mandatory missing component must prevent a signal");
});

Deno.test("all prediction reason codes have deterministic Traditional Chinese labels", () => {
  const codes = [
    "FOREIGN_5D_ACCUMULATION", "FOREIGN_3D_BUYING", "FOREIGN_5D_DISTRIBUTION", "FOREIGN_CROSS_SECTIONAL_STRENGTH",
    "TRUST_5D_ACCUMULATION", "TRUST_3D_BUYING", "TRUST_5D_DISTRIBUTION", "TRUST_CROSS_SECTIONAL_STRENGTH",
    "INSTITUTIONAL_ALIGNMENT", "DEALER_HEDGE_RECORDED_SEPARATELY", "MA_SHORT_TERM_ALIGNMENT", "MA20_UPTREND",
    "MACD_POSITIVE", "RELATIVE_VOLUME_EXPANSION", "PRICE_20D_BREAKOUT", "HIGHER_HIGH_HIGHER_LOW",
    "LOWER_HIGH_LOWER_LOW", "HIGH_ATR_RISK", "TAIEX_MA20_ABOVE_MA60", "TAIEX_MA20_BELOW_MA60",
    "TAIEX_ABOVE_MA20", "TAIEX_BELOW_MA20", "TAIEX_HIGH_VOLATILITY", "TAIEX_VOLUME_EXPANSION", "MARKET_BREADTH_UNAVAILABLE",
  ];
  assert(codes.every((code) => translateReasonCode(code) !== code), "prediction reason codes must not leak raw engine labels to the owner UI");
});

Deno.test("snapshot hash is stable across object key order and changes with input", async () => {
  const first = await sha256Hex({ b: 2, a: 1 });
  const reordered = await sha256Hex({ a: 1, b: 2 });
  const changed = await sha256Hex({ a: 1, b: 3 });
  assert(first === reordered && first !== changed && first.length === 64, "SHA256 snapshot contract failed");
  assert(stableSerialize({ b: 2, a: 1 }) === '{"a":1,"b":2}', "canonical serialization must sort keys");
});

Deno.test("data quality gate blocks duplicate and future rows", () => {
  const bars = priceBars();
  const duplicate = { ...bars[0] };
  duplicate.availableAt = "2026-09-06T00:00:00.000Z";
  const result = runDataQualityGate({ signalTimestamp: SIGNAL_TIME, bars: [...bars, duplicate], institutionalFlows: institutionRows(), eligibleSymbols: ["2330"], completeSymbols: ["2330"], tradingCalendarStatus: "ready", expectedTradingDates: bars.map((bar) => bar.tradingDate) });
  assert(result.status === "blocked", "duplicate/future input must block quality gate");
  assert(result.reasonCodes.includes("DUPLICATE_OHLCV_BAR") && result.reasonCodes.includes("LOOK_AHEAD_INPUT"), "quality reasons must be explicit");
});

Deno.test("coverage gate blocks incomplete universe", () => {
  const bars = priceBars();
  const result = runDataQualityGate({ signalTimestamp: SIGNAL_TIME, bars, institutionalFlows: institutionRows(), eligibleSymbols: ["2330", "2317"], completeSymbols: ["2330"], tradingCalendarStatus: "ready", expectedTradingDates: bars.map((bar) => bar.tradingDate) });
  assert(result.status === "blocked" && result.coverageRatio === 0.5, "coverage below 70% must block");
});

Deno.test("data quality gate blocks when the point-in-time trading calendar is unavailable", () => {
  const bars = priceBars();
  const result = runDataQualityGate({ signalTimestamp: SIGNAL_TIME, bars, institutionalFlows: institutionRows(), eligibleSymbols: ["2330"], completeSymbols: ["2330"], tradingCalendarStatus: "unavailable", expectedTradingDates: [] });
  assert(result.status === "blocked" && result.reasonCodes.includes("TRADING_CALENDAR_UNAVAILABLE"), "calendar absence must fail closed");
});

Deno.test("data quality gate blocks a missing expected trading session", () => {
  const bars = priceBars();
  const result = runDataQualityGate({ signalTimestamp: SIGNAL_TIME, bars: bars.slice(1), institutionalFlows: institutionRows(), eligibleSymbols: ["2330"], completeSymbols: ["2330"], requiredBars: 59, tradingCalendarStatus: "ready", expectedTradingDates: bars.map((bar) => bar.tradingDate) });
  assert(result.status === "blocked" && result.reasonCodes.includes("MISSING_TRADING_DATE"), "missing session must not be hidden by a sufficient row count");
});

Deno.test("backtest validity exposes look-ahead, corporate action and survivorship risk", () => {
  const validity = validateBacktestInputs({ availableAtProven: false, corporateActionsHandled: false, historicalUniverseAvailable: false, adjustedPriceMethodologyKnown: false });
  assert(validity.status === "insufficient", "invalid history must not pass");
  assert(validity.biasFlags.includes("LOOK_AHEAD_BIAS_RISK") && validity.biasFlags.includes("SURVIVORSHIP_BIAS_RISK"), "bias flags missing");
});

Deno.test("chronological split keeps train validation and out-of-sample separated", () => {
  const split = splitChronologically(dates(10), (value) => value);
  assert(split.train.length === 6 && split.validation.length === 2 && split.outOfSample.length === 2, "60/20/20 split expected");
  assert(split.train.at(-1)! < split.validation[0] && split.validation.at(-1)! < split.outOfSample[0], "split chronology leaked");
});

Deno.test("walk-forward windows never overlap future observations into training", () => {
  const windows = buildWalkForwardWindows(dates(20), (value) => value, 8, 4, 4, 4);
  assert(windows.length === 2, "expected two complete walk-forward windows");
  for (const window of windows) assert(window.train.at(-1)! < window.validation[0] && window.validation.at(-1)! < window.outOfSample[0], "walk-forward chronology leaked");
});

Deno.test("random and simple momentum baselines are deterministic", () => {
  const symbols = ["2330", "2317", "2454", "2308"];
  assert(JSON.stringify(selectDeterministicRandomBaseline(symbols, "2026-03-21", 2)) === JSON.stringify(selectDeterministicRandomBaseline(symbols, "2026-03-21", 2)), "random baseline must be reproducible");
  assert(simpleMomentumEligible(priceBars().map((bar) => bar.close)), "uptrend fixture should satisfy simple momentum");
});

Deno.test("backtest calculates five horizons and non-zero Taiwan costs", () => {
  const costs: MarketCostConfig = { version: "TW_STOCK_COST_2026_V1", commissionRate: 0.001425, sellTaxRate: 0.003, slippageRate: 0.0005 };
  const outcomes = calculateBacktestOutcomes({ predictionId: "p1", symbol: "2330", signalDate: "2026-01-01", signalTimestamp: SIGNAL_TIME, signalScore: 88, signalLabel: "STRONG_POSITIVE", entryClose: 100, futureCloses: Array.from({ length: 60 }, (_, index) => 101 + index), futureHighs: Array.from({ length: 60 }, (_, index) => 102 + index), futureLows: Array.from({ length: 60 }, (_, index) => 99 + index), taiexEntryClose: 100, taiexFutureCloses: Array.from({ length: 60 }, (_, index) => 100.2 + index * 0.1) }, costs);
  assert(outcomes.length === 5, "all maturity horizons required");
  assert(outcomes[0].netReturn < outcomes[0].grossReturn, "costs must not be zero");
});

Deno.test("backtest metrics and calibration keep empty buckets explicit", () => {
  const empty = summarizeOutcomes([]);
  assert(empty.sampleSize === 0 && empty.hitRate === null, "empty metrics must be null, not zero claims");
  const calibration = calibrateScores([]);
  assert(calibration.length === 8 && calibration.every((row) => row.metrics.sampleSize === 0), "all calibration buckets should remain visible and empty");
  assert(assessScoreCalibration(calibration, "5D") === "insufficient", "empty buckets must never pass calibration");
});

Deno.test("forward outcome pipeline only emits matured horizons and is evidence-idempotent", async () => {
  const costs: MarketCostConfig = { version: "TW_STOCK_COST_2026_V1", commissionRate: 0.001425, sellTaxRate: 0.003, slippageRate: 0.0005 };
  const stock = priceBars("2330", 80);
  const taiex = priceBars("TAIEX", 80, 0.1);
  const signalDate = stock[19].tradingDate;
  const prediction = { predictionId: "p1", symbol: "2330", signalDate, signalTimestamp: `${signalDate}T07:00:00Z`, signalScore: 88, signalLabel: "STRONG_POSITIVE" as const };
  const first = await evaluateMatureOutcomes(prediction, stock, taiex, costs, SIGNAL_TIME);
  const second = await evaluateMatureOutcomes(prediction, stock, taiex, costs, SIGNAL_TIME);
  assert(first.length === 5, "all horizons should be mature in the fixture");
  assert(first.map((row) => row.evidenceHash).join() === second.map((row) => row.evidenceHash).join(), "same evidence must produce the same hashes");
});

Deno.test("shadow prediction is deterministic and idempotent for identical snapshots", async () => {
  const bars = priceBars(); const flows = institutionRows();
  const marketRegime = calculateMarketRegime({ signalTimestamp: SIGNAL_TIME, taiexBars: priceBars("TAIEX") });
  const quality = readyQuality(bars, flows);
  const input = { symbol: "2330", signalDate: "2026-03-21", signalTimestamp: SIGNAL_TIME, bars, institutionalFlows: flows, corporateActions: [], marketRegime, dataQuality: quality };
  const first = await buildShadowPrediction(input);
  const second = await buildShadowPrediction(input);
  assert(first.prediction !== null && second.prediction !== null, `fixture should produce a shadow prediction: ${JSON.stringify({ first, second })}`);
  assert(predictionIdempotencyKey(first.prediction) === predictionIdempotencyKey(second.prediction), "same snapshot must reuse the same idempotency identity");
});

Deno.test("shadow prediction has zero output when the quality gate blocks", async () => {
  const bars = priceBars(); const flows = institutionRows();
  const marketRegime = calculateMarketRegime({ signalTimestamp: SIGNAL_TIME, taiexBars: priceBars("TAIEX") });
  const blocked = runDataQualityGate({ signalTimestamp: SIGNAL_TIME, bars, institutionalFlows: flows, eligibleSymbols: ["2330", "2317"], completeSymbols: [], tradingCalendarStatus: "ready", expectedTradingDates: bars.map((bar) => bar.tradingDate) });
  const result = await buildShadowPrediction({ symbol: "2330", signalDate: "2026-03-21", signalTimestamp: SIGNAL_TIME, bars, institutionalFlows: flows, corporateActions: [], marketRegime, dataQuality: blocked });
  assert(result.status === "blocked" && result.prediction === null, "blocked data must never create a prediction");
  assert(result.technical !== null && result.institutional !== null && result.sourceSnapshotHash !== null, "blocked run should preserve auditable feature results");
});

Deno.test("changed input hash creates a new calculation version without overwriting", () => {
  const rows = [{ sourceSnapshotHash: "a", calculationVersion: 1 }, { sourceSnapshotHash: "b", calculationVersion: 2 }];
  assert(nextCalculationVersion(rows, "b").reused && nextCalculationVersion(rows, "b").calculationVersion === 2, "same evidence should reuse the existing calculation");
  const changed = nextCalculationVersion(rows, "c");
  assert(!changed.reused && changed.calculationVersion === 3, "changed evidence should increment calculation version");
});
