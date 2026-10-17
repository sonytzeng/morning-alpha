/** Descriptive research comparison only. Does not generate or promote signals. */
import { FROZEN_V1_REF, HORIZONS, hashValid, validTime } from './contracts.ts';
import type { Horizon } from './contracts.ts';

export const RESEARCH_ARMS = ['FROZEN_V1', 'MULTI_HORIZON_EVENT', 'COMBINED'] as const;
export type ResearchArm = typeof RESEARCH_ARMS[number];
export type ComparableOutcome = {
  prediction_id: string; symbol: string; strategy_version: string; arm: ResearchArm;
  horizon: Horizon; target_sessions: number; evaluation_time: string;
  evidence_cutoff: string; locked_at: string; outcome_available_at: string;
  mode: 'HISTORICAL_REPLAY' | 'FORWARD_SHADOW'; provenance: 'RETAINED_REAL_EVIDENCE' | 'SYNTHETIC';
  evidence_hash: string; outcome_hash: string; cost_model_version: string;
  executed: boolean; adjustment_verified: boolean; historical_universe_verified: boolean;
  regime: 'UP' | 'DOWN' | 'RANGE';
  gross_return: number; total_cost_return: number; benchmark_taiex: number;
  benchmark_random: number; benchmark_momentum: number; mae: number; mfe: number;
  max_trade_drawdown: number;
};
const timestamp = Date.parse;
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
function issue(row: ComparableOutcome, now: string): string | null {
  if (row.provenance !== 'RETAINED_REAL_EVIDENCE') return 'NON_REAL_EVIDENCE';
  if (!row.prediction_id || !row.symbol || !row.strategy_version || !RESEARCH_ARMS.includes(row.arm)
    || !Object.hasOwn(HORIZONS, row.horizon) || !['UP', 'DOWN', 'RANGE'].includes(row.regime)
    || !['HISTORICAL_REPLAY', 'FORWARD_SHADOW'].includes(row.mode)) return 'IDENTITY_INVALID';
  if (!HORIZONS[row.horizon].outcomes.some(days => days === row.target_sessions)) return 'TARGET_HORIZON_INVALID';
  if (![now, row.evaluation_time, row.evidence_cutoff, row.locked_at, row.outcome_available_at].every(validTime)
    || timestamp(row.evidence_cutoff) > timestamp(row.evaluation_time)
    || timestamp(row.outcome_available_at) <= timestamp(row.evaluation_time)
    || timestamp(row.outcome_available_at) > timestamp(now)
    || timestamp(row.locked_at) > timestamp(now)) return 'POINT_IN_TIME_INVALID';
  if (row.mode === 'FORWARD_SHADOW' && timestamp(row.locked_at) > timestamp(row.evaluation_time)) return 'FORWARD_NOT_PRELOCKED';
  if (!hashValid(row.evidence_hash) || !hashValid(row.outcome_hash)) return 'HASH_MISSING';
  if (!row.executed) return 'NOT_EXECUTED';
  if (!row.adjustment_verified || !row.historical_universe_verified || !row.cost_model_version) return 'VALIDITY_GAP';
  const numbers = [row.gross_return, row.total_cost_return, row.benchmark_taiex, row.benchmark_random,
    row.benchmark_momentum, row.mae, row.mfe, row.max_trade_drawdown];
  if (!numbers.every(Number.isFinite) || row.total_cost_return < 0 || row.mae > 0 || row.mfe < 0
    || row.max_trade_drawdown < 0 || row.max_trade_drawdown > 1) return 'METRIC_INVALID';
  return null;
}

/** Pair at the same decision cutoff, horizon and regime; do not compare unlike samples. */
export function compareCohorts(rows: ComparableOutcome[], now: string) {
  const rejected: { prediction_id: string; reason: string }[] = [];
  const groups = new Map<string, ComparableOutcome[]>();
  const ids = new Set<string>();
  for (const row of rows) {
    const error = ids.has(row.prediction_id) ? 'DUPLICATE_PREDICTION' : issue(row, now);
    ids.add(row.prediction_id);
    if (error) { rejected.push({ prediction_id: row.prediction_id, reason: error }); continue; }
    const key = JSON.stringify([row.symbol, row.evaluation_time, row.evidence_cutoff, row.horizon,
      row.target_sessions, row.mode, row.regime, row.cost_model_version]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const paired: ComparableOutcome[] = [];
  for (const group of groups.values()) {
    if (group.length !== 3 || !RESEARCH_ARMS.every(arm => group.filter(row => row.arm === arm).length === 1)
      || group.some(row => row.benchmark_taiex !== group[0].benchmark_taiex
        || row.benchmark_random !== group[0].benchmark_random || row.benchmark_momentum !== group[0].benchmark_momentum)) {
      rejected.push(...group.map(row => ({ prediction_id: row.prediction_id, reason: 'UNPAIRED_OR_INCONSISTENT_BASELINE' }))); continue;
    }
    paired.push(...group);
  }
  const cohorts = [...new Set(paired.map(row => JSON.stringify([row.arm, row.strategy_version,
    row.horizon, row.target_sessions, row.mode, row.regime, row.cost_model_version])))].map(key => {
    const [arm, strategy_version, horizon, target_sessions, mode, regime, cost_model_version] = JSON.parse(key);
    const sample = paired.filter(row => row.arm === arm && row.strategy_version === strategy_version
      && row.horizon === horizon && row.target_sessions === target_sessions && row.mode === mode
      && row.regime === regime && row.cost_model_version === cost_model_version);
    const net = sample.map(row => row.gross_return - row.total_cost_return);
    const gain = net.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
    const loss = -net.filter(value => value < 0).reduce((sum, value) => sum + value, 0);
    return { arm, strategy_version, horizon, target_sessions, mode, regime, cost_model_version,
      sample_size: sample.length, hit_rate: net.filter(value => value > 0).length / net.length,
      expectancy: average(net), profit_factor: loss > 0 ? gain / loss : null,
      profit_factor_reason: loss > 0 ? null : 'NO_LOSS_SAMPLE',
      excess_taiex: average(sample.map((row, i) => net[i] - row.benchmark_taiex)),
      excess_random: average(sample.map((row, i) => net[i] - row.benchmark_random)),
      excess_momentum: average(sample.map((row, i) => net[i] - row.benchmark_momentum)),
      average_mae: average(sample.map(row => row.mae)), average_mfe: average(sample.map(row => row.mfe)),
      max_trade_drawdown: Math.max(...sample.map(row => row.max_trade_drawdown)),
      portfolio_drawdown: null, portfolio_drawdown_reason: 'ALLOCATION_AND_EXECUTION_PATH_REQUIRED',
      interpretation: 'DESCRIPTIVE_ONLY_NOT_STRATEGY_VALIDATION' };
  });
  return { cohorts, rejected, historical_prediction_count: paired.filter(row => row.mode === 'HISTORICAL_REPLAY').length,
    forward_prediction_count: paired.filter(row => row.mode === 'FORWARD_SHADOW').length,
    SIGNAL_EDGE: 'UNPROVEN', promotion_allowed: false };
}

export function signalDependency(actualRef: string) {
  return { expected_frozen_v1_ref: FROZEN_V1_REF, frozen_v1_match: actualRef === FROZEN_V1_REF,
    production_promotion: false, teacher_thresholds: 'UNRESOLVED',
    production_caller: 'NOT_ENABLED', arms: RESEARCH_ARMS };
}
