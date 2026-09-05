import type {
  CorporateActionInput,
  DataQualityResult,
  InstitutionalFlowInput,
  InstitutionalScoreResult,
  MarketRegimeResult,
  OhlcvBar,
  SignalPredictionDraft,
  SignalStrategy,
  TechnicalScoreResult,
  InstitutionType,
} from "./types.ts";
import { calculateInstitutionalFlow } from "./institutional-flow-engine.ts";
import { calculateTechnicalAnalysis } from "./technical-analysis-engine.ts";
import { calculateCrossSignal, DEFAULT_SIGNAL_LAB_STRATEGY } from "./cross-signal-engine.ts";
import { sha256Hex } from "./snapshot-hash.ts";
import { normalizeSymbol, uniqueReasonCodes } from "./normalization.ts";

export interface ShadowSignalInput {
  symbol: string;
  signalDate: string;
  signalTimestamp: string;
  bars: OhlcvBar[];
  institutionalFlows: InstitutionalFlowInput[];
  corporateActions: CorporateActionInput[];
  marketRegime: MarketRegimeResult;
  dataQuality: DataQualityResult;
  strategy?: SignalStrategy;
  calculationVersion?: number;
  crossSectionalRatios?: Partial<Record<InstitutionType, number[]>>;
}

export interface ShadowSignalResult {
  status: "ready" | "degraded" | "unavailable" | "blocked";
  prediction: SignalPredictionDraft | null;
  reasonCodes: string[];
  institutional: InstitutionalScoreResult | null;
  technical: TechnicalScoreResult | null;
  sourceSnapshotHash: string | null;
}

export async function buildShadowPrediction(input: ShadowSignalInput): Promise<ShadowSignalResult> {
  const symbol = normalizeSymbol(input.symbol);
  const strategy = input.strategy || DEFAULT_SIGNAL_LAB_STRATEGY;
  const symbolBars = input.bars.filter((row) => normalizeSymbol(row.symbol) === symbol).sort((a, b) => `${a.tradingDate}:${a.availableAt}:${a.provider}`.localeCompare(`${b.tradingDate}:${b.availableAt}:${b.provider}`));
  const symbolFlows = input.institutionalFlows.filter((row) => normalizeSymbol(row.symbol) === symbol).sort((a, b) => `${a.tradingDate}:${a.institutionType}:${a.availableAt}`.localeCompare(`${b.tradingDate}:${b.institutionType}:${b.availableAt}`));
  const symbolActions = input.corporateActions.filter((row) => normalizeSymbol(row.symbol) === symbol).sort((a, b) => `${a.actionDate}:${a.actionType}:${a.availableAt}`.localeCompare(`${b.actionDate}:${b.actionType}:${b.availableAt}`));
  const sourceSnapshotHash = await sha256Hex({
    symbol,
    signalDate: input.signalDate,
    bars: symbolBars,
    institutionalFlows: symbolFlows,
    corporateActions: symbolActions,
    marketRegime: input.marketRegime,
    featureVersion: strategy.featureVersion,
    strategyVersion: strategy.version,
  });
  const institutional = calculateInstitutionalFlow({
    symbol,
    signalTimestamp: input.signalTimestamp,
    flows: input.institutionalFlows,
    crossSectionalRatios: input.crossSectionalRatios,
  });
  const technical = calculateTechnicalAnalysis({ symbol, signalTimestamp: input.signalTimestamp, bars: input.bars, corporateActions: input.corporateActions });
  const cross = calculateCrossSignal({ institutional, technical, marketRegime: input.marketRegime, strategy });
  if (input.dataQuality.status === "blocked") {
    return {
      status: "blocked",
      prediction: null,
      reasonCodes: uniqueReasonCodes(["DATA_QUALITY_GATE_BLOCKED", ...input.dataQuality.reasonCodes, ...cross.reasonCodes]),
      institutional,
      technical,
      sourceSnapshotHash,
    };
  }
  if (cross.score === null || cross.label === null || institutional.score === null || technical.score === null || technical.volumeScore === null || input.marketRegime.regime === null || input.marketRegime.score === null) {
    return { status: cross.status, prediction: null, reasonCodes: cross.reasonCodes, institutional, technical, sourceSnapshotHash };
  }
  return {
    status: cross.status,
    prediction: {
      symbol,
      signalDate: input.signalDate,
      signalTimestamp: input.signalTimestamp,
      signalScore: cross.score,
      signalLabel: cross.label,
      institutionalScore: institutional.score,
      technicalScore: technical.score,
      volumeScore: technical.volumeScore,
      marketRegime: input.marketRegime.regime,
      marketRegimeScore: input.marketRegime.score,
      confidence: cross.confidence,
      dataCompleteness: cross.dataCompleteness,
      reasonCodes: cross.reasonCodes,
      strategyVersion: strategy.version,
      featureVersion: strategy.featureVersion,
      sourceSnapshotHash,
      calculationVersion: input.calculationVersion || 1,
    },
    reasonCodes: cross.reasonCodes,
    institutional,
    technical,
    sourceSnapshotHash,
  };
}

export function predictionIdempotencyKey(prediction: SignalPredictionDraft): string {
  return [prediction.symbol, prediction.signalDate, prediction.strategyVersion, prediction.sourceSnapshotHash, prediction.calculationVersion].join(":");
}

export function nextCalculationVersion(
  existing: Array<{ sourceSnapshotHash: string; calculationVersion: number }>,
  sourceSnapshotHash: string,
): { reused: boolean; calculationVersion: number } {
  const same = existing.find((row) => row.sourceSnapshotHash === sourceSnapshotHash);
  if (same) return { reused: true, calculationVersion: same.calculationVersion };
  const highest = existing.reduce((maximum, row) => Math.max(maximum, row.calculationVersion), 0);
  return { reused: false, calculationVersion: highest + 1 };
}
