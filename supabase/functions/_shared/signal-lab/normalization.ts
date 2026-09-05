export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

export function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const values = [...sortedValues].sort((a, b) => a - b);
  const index = clamp(p, 0, 1) * (values.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  const weight = index - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

export function winsorize(value: number, cohort: number[], lower = 0.05, upper = 0.95): number {
  const valid = cohort.filter(Number.isFinite);
  const low = percentile(valid, lower);
  const high = percentile(valid, upper);
  if (low === null || high === null) return value;
  return clamp(value, low, high);
}

export function percentileRank(value: number, cohort: number[]): number | null {
  const valid = cohort.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length < 2) return null;
  const bounded = winsorize(value, valid);
  let below = 0;
  let equal = 0;
  for (const candidate of valid) {
    if (candidate < bounded) below += 1;
    else if (candidate === bounded) equal += 1;
  }
  return (below + 0.5 * equal) / valid.length;
}

export function cappedDirectionalScore(value: number | null, scale: number): number | null {
  if (value === null || !Number.isFinite(value) || scale <= 0) return null;
  return clamp(50 + 50 * Math.tanh(value / scale), 0, 100);
}

export function normalizeSymbol(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/^TWSE:/, "").replace(/^TPEX:/, "").replace(/\.TW$/, "").replace(/\.TWO$/, "");
  return ["TAIEX", "TWII", "^TWII"].includes(normalized) ? "TAIEX" : normalized;
}

export function consecutivePositiveDays(valuesNewestFirst: number[]): number {
  let count = 0;
  for (const value of valuesNewestFirst) {
    if (value <= 0) break;
    count += 1;
  }
  return count;
}

export function uniqueReasonCodes(codes: string[]): string[] {
  return [...new Set(codes)].sort();
}
