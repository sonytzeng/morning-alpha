export type SignalLabStatus = "ready" | "degraded" | "unavailable" | "blocked";

export type MarketRegime = "BULLISH" | "BEARISH" | "SIDEWAYS" | "HIGH_VOLATILITY";

export type SignalLabel =
  | "STRONG_POSITIVE"
  | "POSITIVE"
  | "NEUTRAL"
  | "NEGATIVE"
  | "STRONG_NEGATIVE";

export type InstitutionType = "foreign" | "trust" | "dealer_proprietary" | "dealer_hedge";

export interface OhlcvBar {
  symbol: string;
  market: "TWSE" | "TPEX" | "INDEX";
  tradingDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover?: number | null;
  adjustedClose?: number | null;
  adjustmentStatus: "adjusted" | "not_required" | "unavailable" | "blocked";
  availableAt: string;
  provider: string;
  sourceDataset?: string;
  sourceRef: string;
  sourceHash?: string;
}

export interface InstitutionalFlowInput {
  symbol: string;
  market: "TWSE" | "TPEX";
  tradingDate: string;
  institutionType: InstitutionType;
  buyVolume?: number | null;
  sellVolume?: number | null;
  netVolume: number;
  netValue?: number | null;
  marketVolume?: number | null;
  averageVolume20d?: number | null;
  averageTurnover20d?: number | null;
  availableAt: string;
  provider: string;
  sourceDataset?: string;
  sourceRef: string;
  sourceHash?: string;
}

export interface CorporateActionInput {
  symbol: string;
  actionDate: string;
  actionType:
    | "cash_dividend"
    | "stock_dividend"
    | "split"
    | "capital_reduction"
    | "suspension"
    | "listing"
    | "delisting";
  adjustmentFactor?: number | null;
  availableAt: string;
  resolved: boolean;
  sourceHash?: string;
}

export interface DataQualityIssue {
  code: string;
  severity: "warning" | "blocking";
  symbol?: string;
  tradingDate?: string;
}

export interface DataQualityResult {
  status: "ready" | "degraded" | "blocked";
  eligibleUniverse: number;
  analyzedCount: number;
  completeCount: number;
  coverageRatio: number;
  issues: DataQualityIssue[];
  reasonCodes: string[];
}

export interface InstitutionalWindowMetrics {
  net1d: number | null;
  net3d: number | null;
  net5d: number | null;
  net10d: number | null;
  net20d: number | null;
  consecutiveBuyDays: number;
  netBuyToDailyVolume: number | null;
  netBuyToAverageVolume20d: number | null;
  netValueToAverageTurnover20d: number | null;
  crossSectionalPercentile: number | null;
}

export interface InstitutionalScoreResult {
  status: SignalLabStatus;
  score: number | null;
  confidence: number;
  dataCompleteness: number;
  foreign: InstitutionalWindowMetrics | null;
  trust: InstitutionalWindowMetrics | null;
  dealerProprietary: InstitutionalWindowMetrics | null;
  dealerHedge: InstitutionalWindowMetrics | null;
  reasonCodes: string[];
  featureVersion: string;
}

export interface TechnicalIndicators {
  ma5: number;
  ma10: number;
  ma20: number;
  ma60: number;
  ema20: number;
  ma20Slope: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  relativeVolume20: number;
  atr14Percent: number;
  bollingerWidth20: number;
  recentHigh20: number;
  recentLow20: number;
  support20: number;
  resistance20: number;
  higherHigh: boolean;
  higherLow: boolean;
  lowerHigh: boolean;
  lowerLow: boolean;
  breakout20: boolean;
}

export interface TechnicalScoreResult {
  status: SignalLabStatus;
  score: number | null;
  trendScore: number | null;
  momentumScore: number | null;
  volumeScore: number | null;
  volatilityScore: number | null;
  structureScore: number | null;
  confidence: number;
  dataCompleteness: number;
  indicators: TechnicalIndicators | null;
  reasonCodes: string[];
  featureVersion: string;
}

export interface MarketRegimeResult {
  status: SignalLabStatus;
  regime: MarketRegime | null;
  score: number | null;
  confidence: number;
  dataCompleteness: number;
  reasonCodes: string[];
  featureVersion: string;
}

export interface SignalStrategy {
  version: string;
  featureVersion: string;
  weights: {
    technical: number;
    institutional: number;
    volume: number;
    marketRegime: number;
  };
  thresholds: {
    strongPositive: number;
    positive: number;
    neutral: number;
    negative: number;
  };
}

export interface CrossSignalResult {
  status: SignalLabStatus;
  score: number | null;
  label: SignalLabel | null;
  confidence: number;
  dataCompleteness: number;
  reasonCodes: string[];
  strategyVersion: string;
  featureVersion: string;
}

export interface SignalPredictionDraft {
  symbol: string;
  signalDate: string;
  signalTimestamp: string;
  signalScore: number;
  signalLabel: SignalLabel;
  institutionalScore: number;
  technicalScore: number;
  volumeScore: number;
  marketRegime: MarketRegime;
  marketRegimeScore: number;
  confidence: number;
  dataCompleteness: number;
  reasonCodes: string[];
  strategyVersion: string;
  featureVersion: string;
  sourceSnapshotHash: string;
  calculationVersion: number;
}

export interface MarketCostConfig {
  version: string;
  commissionRate: number;
  sellTaxRate: number;
  slippageRate: number;
}

export interface BacktestOutcome {
  symbol: string;
  signalDate: string;
  horizon: "1D" | "5D" | "10D" | "20D" | "60D";
  grossReturn: number;
  netReturn: number;
  excessReturnVsTaiex: number;
  mfe: number;
  mae: number;
}

export interface BacktestMetrics {
  sampleSize: number;
  hitRate: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  averageWinner: number | null;
  averageLoser: number | null;
  winLossRatio: number | null;
  maxAdverseExcursion: number | null;
  averageExcessReturn: number | null;
  averageMfe: number | null;
  averageMae: number | null;
}

export interface BacktestPrediction {
  predictionId: string;
  symbol: string;
  signalDate: string;
  signalTimestamp: string;
  signalScore: number;
  signalLabel: SignalLabel;
  entryClose: number;
  futureCloses: number[];
  futureHighs: number[];
  futureLows: number[];
  taiexEntryClose: number;
  taiexFutureCloses: number[];
}

export interface BacktestSplit<T> {
  train: T[];
  validation: T[];
  outOfSample: T[];
}

export interface CalibrationBucket {
  bucket: "60-69" | "70-79" | "80-89" | "90-100";
  horizon: "5D" | "20D";
  metrics: BacktestMetrics;
}
