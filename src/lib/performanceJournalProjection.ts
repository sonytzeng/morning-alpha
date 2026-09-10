import { getSubscriberReportProjection } from './subscriberReportProjection.ts';

type Row = Record<string, unknown>;
export type PublicPerformanceSelection = {
  reportDate: string;
  /** The exact server row; never rebuild a closing receipt from flat result fields. */
  row: Row | null;
  issue: 'CONFLICTING_PUBLIC_PERFORMANCE_ROWS' | null;
};

const record = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Row : null;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const row = record(value);
  if (row) return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** The public RPC owns row selection. Identical repeated transport rows are
 * deduplicated; contradictory rows for the same market date are unavailable.
 * No browser confidence/quality/outcome/timestamp ranking may pick a winner.
 * A flat legacy RPC response remains readable, but cannot manufacture the
 * publication identity or close receipt needed by the subscriber projection. */
export function selectPublicPerformanceRows(value: unknown): PublicPerformanceSelection[] {
  const selected = new Map<string, { selection: PublicPerformanceSelection; fingerprint: string }>();
  for (const candidate of Array.isArray(value) ? value : []) {
    const row = record(candidate);
    if (!row) continue;
    const reportDate = getSubscriberReportProjection(row, { historical: true }).identity.reportDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
    const fingerprint = stableJson(row);
    const existing = selected.get(reportDate);
    if (!existing) selected.set(reportDate, { selection: { reportDate, row, issue: null }, fingerprint });
    else if (existing.fingerprint !== fingerprint) {
      existing.selection = { reportDate, row: null, issue: 'CONFLICTING_PUBLIC_PERFORMANCE_ROWS' };
    }
  }
  return Array.from(selected.values(), value => value.selection);
}
