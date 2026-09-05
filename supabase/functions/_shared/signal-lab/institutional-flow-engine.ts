import type {
  InstitutionalFlowInput,
  InstitutionalScoreResult,
  InstitutionalWindowMetrics,
  InstitutionType,
} from "./types.ts";
import {
  cappedDirectionalScore,
  clamp,
  consecutivePositiveDays,
  mean,
  normalizeSymbol,
  percentileRank,
  round,
  safeRatio,
  sum,
  uniqueReasonCodes,
} from "./normalization.ts";

export const INSTITUTIONAL_FEATURE_VERSION = "INSTITUTIONAL_V1";

export interface InstitutionalFlowEngineInput {
  symbol: string;
  signalTimestamp: string;
  flows: InstitutionalFlowInput[];
  crossSectionalRatios?: Partial<Record<InstitutionType, number[]>>;
}

function unavailable(reasonCodes: string[]): InstitutionalScoreResult {
  return {
    status: "unavailable",
    score: null,
    confidence: 0,
    dataCompleteness: 0,
    foreign: null,
    trust: null,
    dealerProprietary: null,
    dealerHedge: null,
    reasonCodes: uniqueReasonCodes(reasonCodes),
    featureVersion: INSTITUTIONAL_FEATURE_VERSION,
  };
}

function windowSum(values: number[], days: number): number | null {
  return values.length >= days ? sum(values.slice(0, days)) : null;
}

function buildMetrics(rows: InstitutionalFlowInput[], cohort: number[]): InstitutionalWindowMetrics | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort((a, b) => b.tradingDate.localeCompare(a.tradingDate));
  const values = ordered.map((row) => row.netVolume);
  const latest = ordered[0];
  const latestRatio = safeRatio(latest.netVolume, latest.marketVolume ?? null);
  return {
    net1d: windowSum(values, 1),
    net3d: windowSum(values, 3),
    net5d: windowSum(values, 5),
    net10d: windowSum(values, 10),
    net20d: windowSum(values, 20),
    consecutiveBuyDays: consecutivePositiveDays(values),
    netBuyToDailyVolume: latestRatio === null ? null : round(latestRatio),
    netBuyToAverageVolume20d: safeRatio(latest.netVolume, latest.averageVolume20d ?? null),
    netValueToAverageTurnover20d: safeRatio(latest.netValue ?? null, latest.averageTurnover20d ?? null),
    crossSectionalPercentile: latestRatio === null ? null : percentileRank(latestRatio, cohort),
  };
}

function metricScore(metrics: InstitutionalWindowMetrics): number {
  const directional = [
    cappedDirectionalScore(metrics.netBuyToDailyVolume, 0.04),
    cappedDirectionalScore(metrics.netBuyToAverageVolume20d, 0.04),
    cappedDirectionalScore(metrics.netValueToAverageTurnover20d, 0.04),
    metrics.crossSectionalPercentile === null ? null : metrics.crossSectionalPercentile * 100,
  ].filter((value): value is number => value !== null);
  const persistence = clamp(50 + metrics.consecutiveBuyDays * 8, 0, 100);
  return round(mean([...directional, persistence]) ?? 50, 4);
}

function addReasons(prefix: "FOREIGN" | "TRUST", metrics: InstitutionalWindowMetrics, reasons: string[]): void {
  if ((metrics.net5d ?? 0) > 0) reasons.push(`${prefix}_5D_ACCUMULATION`);
  if (metrics.consecutiveBuyDays >= 3) reasons.push(`${prefix}_3D_BUYING`);
  if ((metrics.net5d ?? 0) < 0) reasons.push(`${prefix}_5D_DISTRIBUTION`);
  if ((metrics.crossSectionalPercentile ?? 0) >= 0.8) reasons.push(`${prefix}_CROSS_SECTIONAL_STRENGTH`);
}

export function calculateInstitutionalFlow(input: InstitutionalFlowEngineInput): InstitutionalScoreResult {
  const signalTime = Date.parse(input.signalTimestamp);
  if (!Number.isFinite(signalTime)) return unavailable(["INVALID_SIGNAL_TIMESTAMP"]);
  const symbol = normalizeSymbol(input.symbol);
  const matching = input.flows.filter((row) => normalizeSymbol(row.symbol) === symbol);
  if (matching.length === 0) return unavailable(["INSTITUTIONAL_DATA_UNAVAILABLE"]);
  if (matching.some((row) => !Number.isFinite(Date.parse(row.availableAt)) || Date.parse(row.availableAt) > signalTime)) {
    return { ...unavailable(["LOOK_AHEAD_INSTITUTIONAL_INPUT"]), status: "blocked" };
  }

  const grouped = new Map<InstitutionType, InstitutionalFlowInput[]>();
  for (const row of matching) {
    const values = grouped.get(row.institutionType) || [];
    values.push(row);
    grouped.set(row.institutionType, values);
  }
  const metrics = (type: InstitutionType) => buildMetrics(grouped.get(type) || [], input.crossSectionalRatios?.[type] || []);
  const foreign = metrics("foreign");
  const trust = metrics("trust");
  const dealerProprietary = metrics("dealer_proprietary");
  const dealerHedge = metrics("dealer_hedge");
  if (!foreign || !trust) return unavailable(["REQUIRED_INSTITUTIONAL_SERIES_MISSING"]);
  if ((grouped.get("foreign")?.length || 0) < 20 || (grouped.get("trust")?.length || 0) < 20) {
    return unavailable(["INSTITUTIONAL_HISTORY_INSUFFICIENT"]);
  }
  if ([foreign, trust].some((metrics) => metrics.netBuyToDailyVolume === null || metrics.netBuyToAverageVolume20d === null)) {
    return unavailable(["INSTITUTIONAL_DENOMINATOR_MISSING"]);
  }

  const foreignScore = metricScore(foreign);
  const trustScore = metricScore(trust);
  const dealerScore = dealerProprietary ? metricScore(dealerProprietary) : null;
  const score = dealerScore === null
    ? foreignScore * 0.6 + trustScore * 0.4
    : foreignScore * 0.55 + trustScore * 0.4 + dealerScore * 0.05;
  const reasons: string[] = [];
  addReasons("FOREIGN", foreign, reasons);
  addReasons("TRUST", trust, reasons);
  if ((foreign.net5d ?? 0) > 0 && (trust.net5d ?? 0) > 0) reasons.push("INSTITUTIONAL_ALIGNMENT");
  if (dealerHedge && (dealerHedge.net5d ?? 0) !== 0) reasons.push("DEALER_HEDGE_RECORDED_SEPARATELY");
  const suppliedGroups = [foreign, trust, dealerProprietary, dealerHedge].filter(Boolean).length;
  const dataCompleteness = clamp(suppliedGroups / 4, 0, 1);
  return {
    status: suppliedGroups >= 3 ? "ready" : "degraded",
    score: round(score, 4),
    confidence: round(clamp(0.65 + Math.min(0.25, matching.length / 320), 0, 0.9)),
    dataCompleteness: round(dataCompleteness),
    foreign,
    trust,
    dealerProprietary,
    dealerHedge,
    reasonCodes: uniqueReasonCodes(reasons),
    featureVersion: INSTITUTIONAL_FEATURE_VERSION,
  };
}
