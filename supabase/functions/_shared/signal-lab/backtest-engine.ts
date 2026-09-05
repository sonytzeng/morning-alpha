import type {
  BacktestMetrics,
  BacktestOutcome,
  BacktestPrediction,
  BacktestSplit,
  CalibrationBucket,
  MarketCostConfig,
  SignalLabel,
} from "./types.ts";
import { mean, round } from "./normalization.ts";

export const BACKTEST_ENGINE_VERSION = "SIGNAL_BACKTEST_V1";
export const HORIZONS = [1, 5, 10, 20, 60] as const;

export interface BacktestValidityInput {
  availableAtProven: boolean;
  corporateActionsHandled: boolean;
  historicalUniverseAvailable: boolean;
  adjustedPriceMethodologyKnown: boolean;
}

export interface BacktestValidityResult {
  status: "valid" | "insufficient";
  biasFlags: string[];
}

export interface BaselineComparison {
  horizon: BacktestOutcome["horizon"];
  signalLab: BacktestMetrics;
  taiex: BacktestMetrics;
  randomEligible: BacktestMetrics | null;
  simpleMomentum: BacktestMetrics | null;
  edgeStatus: "unproven" | "not_proven";
}

export interface WalkForwardWindow<T> {
  train: T[];
  validation: T[];
  outOfSample: T[];
}

function direction(label: SignalLabel): 1 | -1 | 0 {
  if (label === "STRONG_POSITIVE" || label === "POSITIVE") return 1;
  if (label === "STRONG_NEGATIVE" || label === "NEGATIVE") return -1;
  return 0;
}

function horizonName(days: number): BacktestOutcome["horizon"] {
  return `${days}D` as BacktestOutcome["horizon"];
}

export function validateBacktestInputs(input: BacktestValidityInput): BacktestValidityResult {
  const flags: string[] = [];
  if (!input.availableAtProven) flags.push("AVAILABLE_AT_UNPROVEN", "LOOK_AHEAD_BIAS_RISK");
  if (!input.corporateActionsHandled) flags.push("CORPORATE_ACTION_HANDLING_MISSING");
  if (!input.historicalUniverseAvailable) flags.push("SURVIVORSHIP_BIAS_RISK");
  if (!input.adjustedPriceMethodologyKnown) flags.push("ADJUSTED_PRICE_METHODOLOGY_UNKNOWN");
  return { status: flags.length === 0 ? "valid" : "insufficient", biasFlags: [...new Set(flags)].sort() };
}

export function splitChronologically<T>(rows: T[], dateFor: (row: T) => string): BacktestSplit<T> {
  const ordered = [...rows].sort((a, b) => dateFor(a).localeCompare(dateFor(b)));
  const trainEnd = Math.floor(ordered.length * 0.6);
  const validationEnd = Math.floor(ordered.length * 0.8);
  return {
    train: ordered.slice(0, trainEnd),
    validation: ordered.slice(trainEnd, validationEnd),
    outOfSample: ordered.slice(validationEnd),
  };
}

export function buildWalkForwardWindows<T>(
  rows: T[],
  dateFor: (row: T) => string,
  trainSize: number,
  validationSize: number,
  outOfSampleSize: number,
  stepSize = outOfSampleSize,
): WalkForwardWindow<T>[] {
  if ([trainSize, validationSize, outOfSampleSize, stepSize].some((value) => !Number.isInteger(value) || value <= 0)) return [];
  const ordered = [...rows].sort((a, b) => dateFor(a).localeCompare(dateFor(b)));
  const windows: WalkForwardWindow<T>[] = [];
  for (let start = 0; start + trainSize + validationSize + outOfSampleSize <= ordered.length; start += stepSize) {
    const validationStart = start + trainSize;
    const outOfSampleStart = validationStart + validationSize;
    windows.push({
      train: ordered.slice(start, validationStart),
      validation: ordered.slice(validationStart, outOfSampleStart),
      outOfSample: ordered.slice(outOfSampleStart, outOfSampleStart + outOfSampleSize),
    });
  }
  return windows;
}

function deterministicSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectDeterministicRandomBaseline(symbols: string[], signalDate: string, count: number): string[] {
  return [...new Set(symbols)].sort((a, b) => deterministicSeed(`${signalDate}:${a}`) - deterministicSeed(`${signalDate}:${b}`)).slice(0, Math.max(0, count));
}

export function simpleMomentumEligible(closes: number[]): boolean {
  if (closes.length < 60 || closes.some((value) => !Number.isFinite(value) || value <= 0)) return false;
  const ma20 = closes.slice(-20).reduce((total, value) => total + value, 0) / 20;
  const ma60 = closes.slice(-60).reduce((total, value) => total + value, 0) / 60;
  return ma20 > ma60;
}

export function calculateBacktestOutcomes(prediction: BacktestPrediction, costs: MarketCostConfig): BacktestOutcome[] {
  const factor = direction(prediction.signalLabel);
  if (factor === 0 || prediction.entryClose <= 0 || prediction.taiexEntryClose <= 0) return [];
  const roundTripCost = costs.commissionRate * 2 + costs.sellTaxRate + costs.slippageRate * 2;
  return HORIZONS.flatMap((days) => {
    const exit = prediction.futureCloses[days - 1];
    const taiexExit = prediction.taiexFutureCloses[days - 1];
    const highs = prediction.futureHighs.slice(0, days);
    const lows = prediction.futureLows.slice(0, days);
    if (![exit, taiexExit].every((value) => Number.isFinite(value) && value > 0) || highs.length < days || lows.length < days) return [];
    const gross = factor * (exit / prediction.entryClose - 1);
    const benchmark = factor * (taiexExit / prediction.taiexEntryClose - 1);
    const favorable = factor === 1
      ? Math.max(...highs) / prediction.entryClose - 1
      : 1 - Math.min(...lows) / prediction.entryClose;
    const adverse = factor === 1
      ? Math.min(...lows) / prediction.entryClose - 1
      : 1 - Math.max(...highs) / prediction.entryClose;
    return [{
      symbol: prediction.symbol,
      signalDate: prediction.signalDate,
      horizon: horizonName(days),
      grossReturn: round(gross),
      netReturn: round(gross - roundTripCost),
      excessReturnVsTaiex: round(gross - benchmark),
      mfe: round(favorable),
      mae: round(adverse),
    }];
  });
}

export function summarizeOutcomes(outcomes: BacktestOutcome[]): BacktestMetrics {
  const wins = outcomes.filter((row) => row.netReturn > 0);
  const losses = outcomes.filter((row) => row.netReturn < 0);
  const grossProfit = wins.reduce((total, row) => total + row.netReturn, 0);
  const grossLoss = Math.abs(losses.reduce((total, row) => total + row.netReturn, 0));
  const averageWinner = mean(wins.map((row) => row.netReturn));
  const averageLoser = mean(losses.map((row) => row.netReturn));
  return {
    sampleSize: outcomes.length,
    hitRate: outcomes.length === 0 ? null : round(wins.length / outcomes.length),
    expectancy: mean(outcomes.map((row) => row.netReturn)),
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : round(grossProfit / grossLoss),
    averageWinner: averageWinner === null ? null : round(averageWinner),
    averageLoser: averageLoser === null ? null : round(averageLoser),
    winLossRatio: averageWinner === null || averageLoser === null || averageLoser === 0 ? null : round(averageWinner / Math.abs(averageLoser)),
    maxAdverseExcursion: outcomes.length === 0 ? null : round(Math.min(...outcomes.map((row) => row.mae))),
    averageExcessReturn: mean(outcomes.map((row) => row.excessReturnVsTaiex)),
    averageMfe: mean(outcomes.map((row) => row.mfe)),
    averageMae: mean(outcomes.map((row) => row.mae)),
  };
}

function bucketFor(score: number): CalibrationBucket["bucket"] | null {
  if (score >= 90 && score <= 100) return "90-100";
  if (score >= 80) return "80-89";
  if (score >= 70) return "70-79";
  if (score >= 60) return "60-69";
  return null;
}

export function calibrateScores(
  rows: Array<{ prediction: BacktestPrediction; outcomes: BacktestOutcome[] }>,
): CalibrationBucket[] {
  const buckets: CalibrationBucket["bucket"][] = ["60-69", "70-79", "80-89", "90-100"];
  return buckets.flatMap((bucket) => (["5D", "20D"] as const).map((horizon) => ({
    bucket,
    horizon,
    metrics: summarizeOutcomes(rows.flatMap((row) => bucketFor(row.prediction.signalScore) === bucket
      ? row.outcomes.filter((outcome) => outcome.horizon === horizon)
      : [])),
  })));
}

export function assessScoreCalibration(
  calibration: CalibrationBucket[],
  horizon: CalibrationBucket["horizon"],
  minimumSamplesPerBucket = 30,
): "pass" | "fail" | "insufficient" {
  const ordered = (["60-69", "70-79", "80-89", "90-100"] as const).map((bucket) => calibration.find((row) => row.bucket === bucket && row.horizon === horizon));
  if (ordered.some((row) => !row || row.metrics.sampleSize < minimumSamplesPerBucket || row.metrics.expectancy === null)) return "insufficient";
  const expectancy = ordered.map((row) => row!.metrics.expectancy!);
  return expectancy.every((value, index) => index === 0 || value >= expectancy[index - 1]) ? "pass" : "fail";
}

export function compareToBaselines(
  horizon: BacktestOutcome["horizon"],
  signalLab: BacktestOutcome[],
  taiex: BacktestOutcome[],
  randomEligible?: BacktestOutcome[],
  simpleMomentum?: BacktestOutcome[],
): BaselineComparison {
  const signalMetrics = summarizeOutcomes(signalLab.filter((row) => row.horizon === horizon));
  const taiexMetrics = summarizeOutcomes(taiex.filter((row) => row.horizon === horizon));
  const momentumMetrics = simpleMomentum ? summarizeOutcomes(simpleMomentum.filter((row) => row.horizon === horizon)) : null;
  const edgeStatus = signalMetrics.expectancy !== null && momentumMetrics !== null && momentumMetrics.expectancy !== null && signalMetrics.expectancy > momentumMetrics.expectancy
    ? "unproven"
    : "not_proven";
  return {
    horizon,
    signalLab: signalMetrics,
    taiex: taiexMetrics,
    randomEligible: randomEligible ? summarizeOutcomes(randomEligible.filter((row) => row.horizon === horizon)) : null,
    simpleMomentum: momentumMetrics,
    edgeStatus,
  };
}
