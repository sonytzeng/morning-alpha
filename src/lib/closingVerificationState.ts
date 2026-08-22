export type ClosingVerificationState = 'complete' | 'degraded' | 'pending';

export interface ResolvedClosingVerification {
  state: ClosingVerificationState;
  record: Record<string, unknown>;
  taiexChange: number | null;
  outcome: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function firstNormalizedText(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizedText(value);
    if (text) return text;
  }
  return '';
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function closingCandidate(value: unknown): UnknownRecord {
  const source = asRecord(value);
  const v2 = asRecord(source.closing_verification_v2);
  if (Object.keys(v2).length > 0) return v2;
  const legacy = asRecord(source.closing_verification);
  if (Object.keys(legacy).length > 0) return legacy;
  return source;
}

function hasNamedDirection(value: unknown): boolean {
  const direction = normalizedText(value);
  return Boolean(direction)
    && !['unknown', 'pending', 'unavailable', 'n/a', '尚未取得', '待資料'].includes(direction);
}

export function resolveClosingVerificationState(...sources: unknown[]): ResolvedClosingVerification {
  let record: UnknownRecord = {};
  for (const source of sources) {
    const candidate = closingCandidate(source);
    if (Object.keys(candidate).length > 0) {
      record = candidate;
      break;
    }
  }

  const taiex = asRecord(record.actual_taiex_close);
  const taiexChange = numberOrNull(record.actual_taiex_change)
    ?? numberOrNull(record.taiex_change)
    ?? numberOrNull(taiex.change_percent)
    ?? numberOrNull(taiex.close_change_percent)
    ?? numberOrNull(taiex.change);
  const status = firstNormalizedText(
    record.status,
    record.verification_status,
    record.closing_verification_status,
    record.data_quality,
  );
  const dataStatus = firstNormalizedText(record.data_status, record.data_quality);
  const outcome = firstNormalizedText(
    record.hit_or_miss,
    record.prediction_result,
    record.result,
    record.verification_result,
  );
  // A hit/miss label is only an evaluation claim. It cannot prove what the
  // market actually did. Public verification therefore requires a real
  // direction or TAIEX change before a completed status is trusted.
  const hasActualMarketDirection = hasNamedDirection(record.actual_direction)
    || taiexChange !== null;
  const completed = ['completed', 'complete', 'ready', 'done', 'verified'].includes(status)
    || status.includes('direction_completed')
    || status.includes('verified');

  if (!completed || !hasActualMarketDirection) {
    return { state: 'pending', record, taiexChange, outcome };
  }

  const degraded = status.includes('degraded')
    || ['degraded', 'insufficient', 'partial'].includes(dataStatus);
  return {
    state: degraded ? 'degraded' : 'complete',
    record,
    taiexChange,
    outcome,
  };
}

export function isClosingVerificationComplete(...sources: unknown[]): boolean {
  return resolveClosingVerificationState(...sources).state !== 'pending';
}
