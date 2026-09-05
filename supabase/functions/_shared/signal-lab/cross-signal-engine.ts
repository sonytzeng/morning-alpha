import type { CrossSignalResult, InstitutionalScoreResult, MarketRegimeResult, SignalLabel, SignalStrategy, TechnicalScoreResult } from "./types.ts";
import { clamp, round, uniqueReasonCodes } from "./normalization.ts";

export const DEFAULT_SIGNAL_LAB_STRATEGY: SignalStrategy = {
  version: "SIGNAL_LAB_V1_SHADOW",
  featureVersion: "SIGNAL_FEATURES_V1",
  weights: { technical: 0.4, institutional: 0.35, volume: 0.15, marketRegime: 0.1 },
  thresholds: { strongPositive: 85, positive: 70, neutral: 45, negative: 30 },
};

export interface CrossSignalEngineInput {
  institutional: InstitutionalScoreResult;
  technical: TechnicalScoreResult;
  marketRegime: MarketRegimeResult;
  strategy?: SignalStrategy;
  optionalFundamentalScore?: number | null;
  optionalNewsScore?: number | null;
}

function labelFor(score: number, strategy: SignalStrategy): SignalLabel {
  if (score >= strategy.thresholds.strongPositive) return "STRONG_POSITIVE";
  if (score >= strategy.thresholds.positive) return "POSITIVE";
  if (score >= strategy.thresholds.neutral) return "NEUTRAL";
  if (score >= strategy.thresholds.negative) return "NEGATIVE";
  return "STRONG_NEGATIVE";
}

export function calculateCrossSignal(input: CrossSignalEngineInput): CrossSignalResult {
  const strategy = input.strategy || DEFAULT_SIGNAL_LAB_STRATEGY;
  const reasons = uniqueReasonCodes([
    ...input.institutional.reasonCodes,
    ...input.technical.reasonCodes,
    ...input.marketRegime.reasonCodes,
  ]);
  const required = [input.institutional, input.technical, input.marketRegime];
  if (required.some((component) => component.status === "blocked")) {
    return { status: "blocked", score: null, label: null, confidence: 0, dataCompleteness: 0, reasonCodes: uniqueReasonCodes([...reasons, "MANDATORY_COMPONENT_BLOCKED"]), strategyVersion: strategy.version, featureVersion: strategy.featureVersion };
  }
  const institutional = input.institutional.score;
  const technical = input.technical.score;
  const volume = input.technical.volumeScore;
  const regime = input.marketRegime.score;
  if ([institutional, technical, volume, regime].some((value) => value === null)) {
    return { status: "unavailable", score: null, label: null, confidence: 0, dataCompleteness: 0, reasonCodes: uniqueReasonCodes([...reasons, "MANDATORY_COMPONENT_UNAVAILABLE"]), strategyVersion: strategy.version, featureVersion: strategy.featureVersion };
  }
  const weightSum = Object.values(strategy.weights).reduce((total, weight) => total + weight, 0);
  if (Math.abs(weightSum - 1) > 1e-9 || Object.values(strategy.weights).some((weight) => weight < 0)) {
    return { status: "blocked", score: null, label: null, confidence: 0, dataCompleteness: 0, reasonCodes: ["INVALID_STRATEGY_WEIGHTS"], strategyVersion: strategy.version, featureVersion: strategy.featureVersion };
  }
  const score = technical! * strategy.weights.technical + institutional! * strategy.weights.institutional + volume! * strategy.weights.volume + regime! * strategy.weights.marketRegime;
  const dataCompleteness = Math.min(input.institutional.dataCompleteness, input.technical.dataCompleteness, input.marketRegime.dataCompleteness);
  const confidence = clamp(Math.min(input.institutional.confidence, input.technical.confidence, input.marketRegime.confidence) * dataCompleteness, 0, 1);
  return {
    status: required.every((component) => component.status === "ready") ? "ready" : "degraded",
    score: round(score, 4), label: labelFor(score, strategy), confidence: round(confidence), dataCompleteness: round(dataCompleteness),
    reasonCodes: reasons, strategyVersion: strategy.version, featureVersion: strategy.featureVersion,
  };
}
