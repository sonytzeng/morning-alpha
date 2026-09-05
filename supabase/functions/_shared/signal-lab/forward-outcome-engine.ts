import { calculateBacktestOutcomes } from "./backtest-engine.ts";
import { normalizeSymbol } from "./normalization.ts";
import { sha256Hex } from "./snapshot-hash.ts";
import type { BacktestOutcome, MarketCostConfig, OhlcvBar, SignalLabel } from "./types.ts";

export interface OutcomePredictionInput {
  predictionId: string;
  symbol: string;
  signalDate: string;
  signalTimestamp: string;
  signalScore: number;
  signalLabel: SignalLabel;
}

export interface ForwardOutcomeDraft extends BacktestOutcome {
  predictionId: string;
  maturityDate: string;
  evidenceHash: string;
  marketCostVersion: string;
  evaluatedAt: string;
}

function latestDailyBars(rows: OhlcvBar[], symbol: string): OhlcvBar[] {
  const normalized = normalizeSymbol(symbol);
  const latest = new Map<string, OhlcvBar>();
  for (const row of rows.filter((candidate) => normalizeSymbol(candidate.symbol) === normalized)) {
    const existing = latest.get(row.tradingDate);
    if (!existing || row.availableAt > existing.availableAt) latest.set(row.tradingDate, row);
  }
  return [...latest.values()].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
}

export async function evaluateMatureOutcomes(
  prediction: OutcomePredictionInput,
  bars: OhlcvBar[],
  taiexBars: OhlcvBar[],
  costs: MarketCostConfig,
  evaluatedAt: string,
): Promise<ForwardOutcomeDraft[]> {
  const symbolBars = latestDailyBars(bars, prediction.symbol);
  const benchmarkBars = latestDailyBars(taiexBars, "TAIEX");
  const entry = symbolBars.find((bar) => bar.tradingDate === prediction.signalDate);
  const benchmarkEntry = benchmarkBars.find((bar) => bar.tradingDate === prediction.signalDate);
  if (!entry || !benchmarkEntry || entry.adjustmentStatus === "unavailable" || entry.adjustmentStatus === "blocked") return [];
  const future = symbolBars.filter((bar) => bar.tradingDate > prediction.signalDate && bar.availableAt <= evaluatedAt);
  const benchmarkByDate = new Map(benchmarkBars.filter((bar) => bar.tradingDate > prediction.signalDate && bar.availableAt <= evaluatedAt).map((bar) => [bar.tradingDate, bar]));
  const aligned = future.filter((bar) => benchmarkByDate.has(bar.tradingDate));
  const benchmarkFuture = aligned.map((bar) => benchmarkByDate.get(bar.tradingDate)!);
  const outcomes = calculateBacktestOutcomes({
    ...prediction,
    entryClose: entry.adjustedClose ?? entry.close,
    futureCloses: aligned.map((bar) => bar.adjustedClose ?? bar.close),
    futureHighs: aligned.map((bar) => bar.high),
    futureLows: aligned.map((bar) => bar.low),
    taiexEntryClose: benchmarkEntry.adjustedClose ?? benchmarkEntry.close,
    taiexFutureCloses: benchmarkFuture.map((bar) => bar.adjustedClose ?? bar.close),
  }, costs);
  return Promise.all(outcomes.map(async (outcome) => {
    const days = Number.parseInt(outcome.horizon, 10);
    const evidenceRows = aligned.slice(0, days);
    return {
      ...outcome,
      predictionId: prediction.predictionId,
      maturityDate: evidenceRows.at(-1)!.tradingDate,
      evidenceHash: await sha256Hex({ prediction, entry, benchmarkEntry, evidenceRows, benchmarkRows: benchmarkFuture.slice(0, days), costs }),
      marketCostVersion: costs.version,
      evaluatedAt,
    };
  }));
}
