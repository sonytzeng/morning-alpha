/** Evaluation only. Does not create, backfill or overwrite a production outcome. */
import { normalizeDecisionSymbol } from './engine.ts';
export const FORWARD_HORIZONS = [5, 20, 60] as const;
export type ForwardObservation = {
  decision_revision: string; symbol: string; category: 'DIRECTION' | 'DO_NOT_CHASE' | 'MISPRICING';
  horizon: 1 | 5 | 20 | 60; decision_at: string; frozen_at: string; observed_at: string;
  due_at: string; is_trading_day: boolean; data_status: string; evidence_ids: string[];
  outcome: 'hit' | 'miss'; execution: 'NATURAL' | 'REPLAY' | 'RECOVERY';
};
export function summarizeForwardValidation(rows: ForwardObservation[], asOf: string) {
  const valid = new Map<string, ForwardObservation>(), rejected = new Set<string>();
  let excluded = 0;
  for (const row of rows) {
    const times = [row.decision_at, row.frozen_at, row.observed_at, row.due_at, asOf].map(Date.parse);
    const [decision, frozen, observed, due, current] = times;
    if (!row.decision_revision || !row.symbol || ![1, 5, 20, 60].includes(row.horizon)
      || !['DIRECTION', 'DO_NOT_CHASE', 'MISPRICING'].includes(row.category)
      || times.some((time) => !Number.isFinite(time)) || frozen > decision || decision >= due
      || observed < due || observed > current || !row.is_trading_day || row.data_status !== 'complete'
      || row.execution !== 'NATURAL' || !row.evidence_ids.length || !['hit', 'miss'].includes(row.outcome)) {
      excluded++; continue;
    }
    const key = `${row.decision_revision}:${normalizeDecisionSymbol(row.symbol)}:${row.category}:${row.horizon}`;
    if (rejected.has(key)) { excluded++; continue; }
    const prior = valid.get(key);
    if (prior && prior.outcome !== row.outcome) { valid.delete(key); rejected.add(key); excluded += 2; }
    else if (!prior) valid.set(key, row);
    else excluded++;
  }
  const observations = [...valid.values()];
  const cohorts = [...new Set(observations.map(row => `${row.category}:${row.horizon}`))].map(key => {
    const cohort = observations.filter(row => `${row.category}:${row.horizon}` === key);
    return { key, valid_count: cohort.length, hit_rate: cohort.length >= 20 ? cohort.filter(row => row.outcome === 'hit').length / cohort.length : null };
  });
  return { observations, valid_count: observations.length, excluded_count: excluded,
    cohorts, hit_rate: cohorts.length === 1 ? cohorts[0].hit_rate : null };
}

export function closingDataComplete(status: string, dataStatus: string, hasDirection: boolean): boolean {
  return hasDirection && ['completed', 'complete', 'ready'].includes(status)
    && ['complete', 'completed', 'ready'].includes(dataStatus);
}
