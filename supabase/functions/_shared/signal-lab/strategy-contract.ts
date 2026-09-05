import type { SignalStrategy } from "./types.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Converts the persisted snake_case strategy contract into the engine's typed
 * domain contract. Invalid or incomplete versions fail closed; no weights or
 * thresholds are silently substituted.
 */
export function parseSignalStrategy(value: unknown): SignalStrategy | null {
  const row = record(value);
  const weights = record(row?.weights);
  const thresholds = record(row?.score_thresholds);
  const version = text(row?.version);
  const featureVersion = text(row?.feature_version);
  if (!row || !weights || !thresholds || !version || !featureVersion) return null;

  const parsed: SignalStrategy = {
    version,
    featureVersion,
    weights: {
      technical: finiteNumber(weights.technical) ?? Number.NaN,
      institutional: finiteNumber(weights.institutional) ?? Number.NaN,
      volume: finiteNumber(weights.volume) ?? Number.NaN,
      marketRegime: finiteNumber(weights.market_regime) ?? Number.NaN,
    },
    thresholds: {
      strongPositive: finiteNumber(thresholds.strong_positive) ?? Number.NaN,
      positive: finiteNumber(thresholds.positive) ?? Number.NaN,
      neutral: finiteNumber(thresholds.neutral) ?? Number.NaN,
      negative: finiteNumber(thresholds.negative) ?? Number.NaN,
    },
  };

  const weightValues = Object.values(parsed.weights);
  const thresholdValues = Object.values(parsed.thresholds);
  if (weightValues.some((entry) => !Number.isFinite(entry) || entry < 0)) return null;
  if (Math.abs(weightValues.reduce((total, entry) => total + entry, 0) - 1) > 1e-9) return null;
  if (thresholdValues.some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 100)) return null;
  if (!(parsed.thresholds.strongPositive > parsed.thresholds.positive
    && parsed.thresholds.positive > parsed.thresholds.neutral
    && parsed.thresholds.neutral > parsed.thresholds.negative)) return null;
  return parsed;
}
