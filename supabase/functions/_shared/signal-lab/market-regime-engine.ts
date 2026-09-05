import type { MarketRegimeResult, OhlcvBar } from "./types.ts";
import { clamp, mean, round, uniqueReasonCodes } from "./normalization.ts";

export const MARKET_REGIME_FEATURE_VERSION = "MARKET_REGIME_V1";

export interface MarketRegimeEngineInput {
  signalTimestamp: string;
  taiexBars: OhlcvBar[];
  breadthPercentAboveMa20?: number | null;
}

function empty(status: "unavailable" | "blocked", reasons: string[]): MarketRegimeResult {
  return { status, regime: null, score: null, confidence: 0, dataCompleteness: 0, reasonCodes: reasons, featureVersion: MARKET_REGIME_FEATURE_VERSION };
}

function average(values: number[], period: number): number {
  const selected = values.slice(-period);
  return selected.reduce((total, value) => total + value, 0) / selected.length;
}

export function calculateMarketRegime(input: MarketRegimeEngineInput): MarketRegimeResult {
  const signalTime = Date.parse(input.signalTimestamp);
  if (!Number.isFinite(signalTime)) return empty("blocked", ["INVALID_SIGNAL_TIMESTAMP"]);
  const bars = [...input.taiexBars].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  if (bars.length < 60) return empty("unavailable", ["TAIEX_HISTORY_INSUFFICIENT"]);
  if (bars.some((bar) => Date.parse(bar.availableAt) > signalTime || !Number.isFinite(Date.parse(bar.availableAt)))) {
    return empty("blocked", ["LOOK_AHEAD_TAIEX_INPUT"]);
  }
  const closes = bars.map((bar) => bar.adjustedClose ?? bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const ma20 = average(closes, 20);
  const ma60 = average(closes, 60);
  const priorMa20 = average(closes.slice(0, -5), 20);
  const latest = closes.at(-1) as number;
  const returns = closes.slice(-21).slice(1).map((value, index) => value / closes.slice(-21)[index] - 1);
  const avgReturn = mean(returns) || 0;
  const volatility20 = Math.sqrt(mean(returns.map((value) => (value - avgReturn) ** 2)) || 0) * Math.sqrt(252);
  const relativeVolume = (volumes.at(-1) as number) / Math.max(average(volumes.slice(0, -1), 20), 1);
  const trend = (latest / ma20 - 1) * 400 + (ma20 / ma60 - 1) * 400 + (ma20 / priorMa20 - 1) * 300;
  const breadth = input.breadthPercentAboveMa20 == null ? 0 : (input.breadthPercentAboveMa20 - 0.5) * 40;
  const score = clamp(50 + trend + breadth, 0, 100);
  const highVolatility = volatility20 >= 0.28;
  const regime = highVolatility ? "HIGH_VOLATILITY" : score >= 62 ? "BULLISH" : score <= 38 ? "BEARISH" : "SIDEWAYS";
  const reasons: string[] = [];
  if (ma20 > ma60) reasons.push("TAIEX_MA20_ABOVE_MA60");
  else reasons.push("TAIEX_MA20_BELOW_MA60");
  if (latest > ma20) reasons.push("TAIEX_ABOVE_MA20");
  else reasons.push("TAIEX_BELOW_MA20");
  if (volatility20 >= 0.28) reasons.push("TAIEX_HIGH_VOLATILITY");
  if (relativeVolume >= 1.2) reasons.push("TAIEX_VOLUME_EXPANSION");
  if (input.breadthPercentAboveMa20 == null) reasons.push("MARKET_BREADTH_UNAVAILABLE");
  return {
    status: input.breadthPercentAboveMa20 == null ? "degraded" : "ready",
    regime,
    score: round(score, 4),
    confidence: round(input.breadthPercentAboveMa20 == null ? 0.7 : 0.85),
    dataCompleteness: input.breadthPercentAboveMa20 == null ? 0.8 : 1,
    reasonCodes: uniqueReasonCodes(reasons),
    featureVersion: MARKET_REGIME_FEATURE_VERSION,
  };
}
