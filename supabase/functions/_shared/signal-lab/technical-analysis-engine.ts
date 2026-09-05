import type { CorporateActionInput, OhlcvBar, TechnicalIndicators, TechnicalScoreResult } from "./types.ts";
import { clamp, mean, normalizeSymbol, round, uniqueReasonCodes } from "./normalization.ts";

export const TECHNICAL_FEATURE_VERSION = "TECHNICAL_V1";

export interface TechnicalAnalysisEngineInput {
  symbol: string;
  signalTimestamp: string;
  bars: OhlcvBar[];
  corporateActions?: CorporateActionInput[];
}

function unavailable(status: "unavailable" | "blocked", reasons: string[]): TechnicalScoreResult {
  return {
    status,
    score: null,
    trendScore: null,
    momentumScore: null,
    volumeScore: null,
    volatilityScore: null,
    structureScore: null,
    confidence: 0,
    dataCompleteness: 0,
    indicators: null,
    reasonCodes: uniqueReasonCodes(reasons),
    featureVersion: TECHNICAL_FEATURE_VERSION,
  };
}

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  return slice.reduce((total, value) => total + value, 0) / slice.length;
}

function emaSeries(values: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const output: number[] = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    output.push(values[index] * multiplier + output[index - 1] * (1 - multiplier));
  }
  return output;
}

function rsi(values: number[], period = 14): number {
  const changes = values.slice(-period - 1).slice(1).map((value, index) => value - values.slice(-period - 1)[index]);
  const gains = changes.map((value) => Math.max(value, 0));
  const losses = changes.map((value) => Math.max(-value, 0));
  const averageGain = mean(gains) || 0;
  const averageLoss = mean(losses) || 0;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function standardDeviation(values: number[]): number {
  const average = mean(values) || 0;
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)) || 0);
}

export function calculateTechnicalAnalysis(input: TechnicalAnalysisEngineInput): TechnicalScoreResult {
  const signalTime = Date.parse(input.signalTimestamp);
  if (!Number.isFinite(signalTime)) return unavailable("blocked", ["INVALID_SIGNAL_TIMESTAMP"]);
  const symbol = normalizeSymbol(input.symbol);
  const bars = input.bars
    .filter((bar) => normalizeSymbol(bar.symbol) === symbol)
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  if (bars.length < 60) return unavailable("unavailable", ["PRICE_HISTORY_INSUFFICIENT"]);
  if (bars.some((bar) => !Number.isFinite(Date.parse(bar.availableAt)) || Date.parse(bar.availableAt) > signalTime)) {
    return unavailable("blocked", ["LOOK_AHEAD_PRICE_INPUT"]);
  }
  if (bars.some((bar) => bar.adjustmentStatus === "unavailable" || bar.adjustmentStatus === "blocked")) {
    return unavailable("blocked", ["ADJUSTED_PRICE_UNAVAILABLE"]);
  }
  const relevantActions = (input.corporateActions || []).filter((action) => normalizeSymbol(action.symbol) === symbol);
  if (relevantActions.some((action) => !action.resolved)) {
    return unavailable("blocked", ["UNRESOLVED_CORPORATE_ACTION"]);
  }

  const closes = bars.map((bar) => bar.adjustedClose ?? bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const volumes = bars.map((bar) => bar.volume);
  const latest = closes.at(-1) as number;
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const ema20 = emaSeries(closes, 20).at(-1) as number;
  const priorMa20 = sma(closes.slice(0, -1), 20);
  const ma20Slope = (ma20 - priorMa20) / priorMa20;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdSeries = closes.map((_, index) => ema12[index] - ema26[index]);
  const macd = macdSeries.at(-1) as number;
  const macdSignal = emaSeries(macdSeries, 9).at(-1) as number;
  const trueRanges = bars.slice(-14).map((bar, index, slice) => {
    const previousClose = index === 0 ? closes.at(-15) as number : slice[index - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  const atr14Percent = (mean(trueRanges) || 0) / latest;
  const close20 = closes.slice(-20);
  const std20 = standardDeviation(close20);
  const bollingerWidth20 = ma20 > 0 ? (4 * std20) / ma20 : 0;
  const previous20High = Math.max(...highs.slice(-21, -1));
  const recentHigh20 = Math.max(...highs.slice(-20));
  const recentLow20 = Math.min(...lows.slice(-20));
  const priorHigh10 = Math.max(...highs.slice(-20, -10));
  const currentHigh10 = Math.max(...highs.slice(-10));
  const priorLow10 = Math.min(...lows.slice(-20, -10));
  const currentLow10 = Math.min(...lows.slice(-10));
  const relativeVolume20 = (volumes.at(-1) as number) / Math.max(sma(volumes.slice(0, -1), 20), 1);
  const indicators: TechnicalIndicators = {
    ma5: round(ma5), ma10: round(ma10), ma20: round(ma20), ma60: round(ma60), ema20: round(ema20),
    ma20Slope: round(ma20Slope), rsi14: round(rsi(closes)), macd: round(macd), macdSignal: round(macdSignal),
    relativeVolume20: round(relativeVolume20), atr14Percent: round(atr14Percent), bollingerWidth20: round(bollingerWidth20),
    recentHigh20: round(recentHigh20), recentLow20: round(recentLow20), support20: round(recentLow20), resistance20: round(recentHigh20),
    higherHigh: currentHigh10 > priorHigh10, higherLow: currentLow10 > priorLow10,
    lowerHigh: currentHigh10 < priorHigh10, lowerLow: currentLow10 < priorLow10, breakout20: latest > previous20High,
  };

  const trendScore = clamp(50 + (latest > ma20 ? 15 : -15) + (ma20 > ma60 ? 20 : -20) + clamp(ma20Slope * 1000, -15, 15), 0, 100);
  const momentumScore = clamp(50 + (indicators.rsi14 - 50) * 0.6 + (macd > macdSignal ? 18 : -18), 0, 100);
  const volumeScore = clamp(50 + (relativeVolume20 - 1) * 30 + (bars.at(-1)!.close >= bars.at(-1)!.open ? 8 : -8), 0, 100);
  const volatilityScore = clamp(75 - Math.max(0, atr14Percent - 0.02) * 1000 - Math.max(0, bollingerWidth20 - 0.12) * 150, 0, 100);
  const structureScore = clamp(50 + (indicators.higherHigh ? 15 : 0) + (indicators.higherLow ? 15 : 0) - (indicators.lowerHigh ? 15 : 0) - (indicators.lowerLow ? 15 : 0) + (indicators.breakout20 ? 20 : 0), 0, 100);
  const technicalScore = trendScore * 0.35 + momentumScore * 0.3 + volatilityScore * 0.1 + structureScore * 0.25;
  const reasons: string[] = [];
  if (ma5 > ma10 && ma10 > ma20) reasons.push("MA_SHORT_TERM_ALIGNMENT");
  if (ma20 > ma60 && ma20Slope > 0) reasons.push("MA20_UPTREND");
  if (macd > macdSignal) reasons.push("MACD_POSITIVE");
  if (relativeVolume20 >= 1.5) reasons.push("RELATIVE_VOLUME_EXPANSION");
  if (indicators.breakout20) reasons.push("PRICE_20D_BREAKOUT");
  if (indicators.higherHigh && indicators.higherLow) reasons.push("HIGHER_HIGH_HIGHER_LOW");
  if (indicators.lowerHigh && indicators.lowerLow) reasons.push("LOWER_HIGH_LOWER_LOW");
  if (atr14Percent >= 0.04) reasons.push("HIGH_ATR_RISK");
  return {
    status: bars.length >= 80 ? "ready" : "degraded",
    score: round(technicalScore, 4),
    trendScore: round(trendScore, 4), momentumScore: round(momentumScore, 4), volumeScore: round(volumeScore, 4),
    volatilityScore: round(volatilityScore, 4), structureScore: round(structureScore, 4),
    confidence: round(clamp(0.65 + Math.min(0.25, (bars.length - 60) / 240), 0, 0.9)),
    dataCompleteness: round(clamp(bars.length / 80, 0, 1)), indicators,
    reasonCodes: uniqueReasonCodes(reasons), featureVersion: TECHNICAL_FEATURE_VERSION,
  };
}
