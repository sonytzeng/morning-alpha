// Durable evidence contract, not a new market strategy. Collection time and
// provider time are distinct. A recovery request can never create PREMARKET.
import { evaluateCheckpointFreshness } from './market-runtime-stability.mjs';

const WINDOWS = Object.freeze({
  '0900': ['intraday', 540, 555],
  '0930': ['intraday', 565, 585],
  '1030': ['intraday', 625, 645],
  '1300': ['intraday', 775, 795],
  '1410': ['close', 850, 865],
  '1430': ['close', 870, 885],
});
export const CHECKPOINT_PROVIDER_CONTRACT_VERSION = 'MARKET_CHECKPOINT_PROVIDER_V1';
export const CHECKPOINT_PROVIDER_KEYS = Object.freeze([
  'SPX', 'IXIC', 'SOX', 'NVDA', 'TSM', 'VIX', 'DXY', 'US10Y', 'TAIEX', '2330', 'TXF',
]);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const presentFiniteNumber = value =>
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
function taipei(iso) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms + 8 * 3600000).toISOString();
  return { date: date.slice(0, 10), minutes: Number(date.slice(11, 13)) * 60 + Number(date.slice(14, 16)), ms };
}

export function checkpointCollectionContract({ phase, checkpoint, tradingDate, observedAt, correlationId }) {
  const observed = taipei(observedAt);
  if (!observed || observed.date !== tradingDate || !uuid(correlationId)) return { valid: false, error: 'INVALID_EVIDENCE_IDENTITY' };
  if (phase === 'manual_backfill' && checkpoint === 'manual') return { valid: true, checkpoint: 'RECOVERY', session: 'recovery' };
  if (phase === 'premarket' && checkpoint === 'premarket' && observed.minutes <= 455) {
    return { valid: true, checkpoint: 'PREMARKET', session: 'premarket' };
  }
  const window = WINDOWS[checkpoint];
  if (!window || window[0] !== phase || observed.minutes < window[1] || observed.minutes >= window[2]) {
    return { valid: false, error: 'OUTSIDE_REAL_CHECKPOINT_WINDOW' };
  }
  return { valid: true, checkpoint, session: phase };
}

export function buildCheckpointEvidence(input, quote, config) {
  const contract = checkpointCollectionContract(input);
  if (!contract.valid) return { valid: false, error: contract.error };
  if (!quote || !presentFiniteNumber(quote.value) || Number(quote.value) <= 0 ||
    !presentFiniteNumber(quote.changePercent) || !presentFiniteNumber(quote.change)) {
    return { valid: false, error: 'INCOMPLETE_CHECKPOINT_QUOTE' };
  }
  const source = String(quote.provider || '').trim();
  const sourceTime = taipei(quote.capturedAt);
  const observed = taipei(input.observedAt);
  if (!source || source.length > 120 || !sourceTime || sourceTime.ms > observed.ms + 60000) {
    return { valid: false, error: 'INVALID_CHECKPOINT_PROVENANCE' };
  }
  const freshness = evaluateCheckpointFreshness({
    captured_at: quote.capturedAt, evaluated_at: input.observedAt,
    trading_date: input.tradingDate, market: config.market, phase: input.phase, symbol: config.displaySymbol,
  });
  if (!freshness.valid) return { valid: false, error: 'INVALID_CHECKPOINT_SOURCE_TIME' };
  // Existing provider freshness is deliberately preserved for US overnight data.
  // Taiwan intraday quotes additionally belong to this checkpoint, not the prior one.
  const window = WINDOWS[input.checkpoint];
  if (config.market === 'TW' && input.phase === 'intraday' &&
    (sourceTime.minutes < window[1] || sourceTime.minutes >= window[2])) {
    return { valid: false, error: 'SOURCE_OUTSIDE_CHECKPOINT_WINDOW' };
  }
  return { valid: true, row: {
    checkpoint: contract.checkpoint, trading_date: input.tradingDate,
    captured_at: input.observedAt, market_session: contract.session,
    symbol: config.displaySymbol, value: Number(quote.value), change_percent: Number(quote.changePercent),
    source, source_timestamp: quote.capturedAt, correlation_id: input.correlationId,
    raw: { contract: 'FETCH_CHECKPOINT_EVIDENCE_V1', market: config.market, name: config.name,
      source_symbol: quote.sourceSymbol, change: Number(quote.change), source_raw: record(quote.raw),
      freshness_status: freshness.status, freshness_age_minutes: freshness.age_minutes,
      captured_session_date: freshness.captured_session_date,
      fallback_used: quote.sourceSymbol !== config.finnhubSymbol },
  } };
}

export function checkpointBatchIdempotencyKey(tradingDate, checkpoint) {
  return `market-checkpoint:${String(tradingDate || '').trim()}:${String(checkpoint || '').trim()}:${CHECKPOINT_PROVIDER_CONTRACT_VERSION}`;
}

export function validateAtomicCheckpointEvidenceRows(rows) {
  if (!Array.isArray(rows)) return { valid: false, error: 'ATOMIC_CHECKPOINT_ROWS_ARRAY_REQUIRED' };
  if (rows.length !== CHECKPOINT_PROVIDER_KEYS.length) {
    return { valid: false, error: 'ATOMIC_CHECKPOINT_PROVIDER_CARDINALITY', rowCount: rows.length };
  }
  const keys = rows.map(row => String(record(row).provider_key || ''));
  if (new Set(keys).size !== CHECKPOINT_PROVIDER_KEYS.length ||
    CHECKPOINT_PROVIDER_KEYS.some(key => !keys.includes(key))) {
    return { valid: false, error: 'ATOMIC_CHECKPOINT_PROVIDER_SET_MISMATCH', providerKeys: keys };
  }
  for (const rowValue of rows) {
    const row = record(rowValue), raw = record(row.raw);
    if (String(row.provider_key || '') !== String(row.symbol || '') ||
      !presentFiniteNumber(row.value) || Number(row.value) <= 0 ||
      !presentFiniteNumber(row.change_percent) || !presentFiniteNumber(raw.change) ||
      !String(row.source || '').trim() || !taipei(row.captured_at) || !taipei(row.source_timestamp) ||
      raw.contract !== 'FETCH_CHECKPOINT_EVIDENCE_V1' || !['TW', 'US'].includes(String(raw.market || '')) ||
      !['fresh', 'provider_returned'].includes(String(raw.freshness_status || '')) ||
      !presentFiniteNumber(raw.freshness_age_minutes) || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw.captured_session_date || ''))) {
      return { valid: false, error: 'ATOMIC_CHECKPOINT_ROW_CONTRACT_INVALID', providerKey: row.provider_key || null };
    }
  }
  return { valid: true, rows };
}

export function parseAtomicCheckpointCommit(value, expected = {}) {
  const payload = record(value), rows = Array.isArray(payload.rows) ? payload.rows : [];
  const validated = validateAtomicCheckpointEvidenceRows(rows);
  const batchId = String(payload.batch_id || ''), correlationId = String(payload.correlation_id || '');
  if (payload.contract !== 'MARKET_CHECKPOINT_ATOMIC_COMMIT_V1' || payload.status !== 'COMMITTED' ||
    Number(payload.row_count) !== CHECKPOINT_PROVIDER_KEYS.length || !uuid(batchId) || !uuid(correlationId) ||
    !validated.valid) {
    return { valid: false, error: validated.error || 'ATOMIC_CHECKPOINT_COMMIT_RESPONSE_INVALID' };
  }
  if (expected.tradingDate && rows.some(row => String(record(row).trading_date || '') !== expected.tradingDate)) {
    return { valid: false, error: 'ATOMIC_CHECKPOINT_COMMIT_DATE_MISMATCH' };
  }
  if (expected.checkpoint && rows.some(row => String(record(row).checkpoint || '') !== expected.checkpoint)) {
    return { valid: false, error: 'ATOMIC_CHECKPOINT_COMMIT_LABEL_MISMATCH' };
  }
  if (expected.idempotencyKey && String(payload.idempotency_key || '') !== expected.idempotencyKey) {
    return { valid: false, error: 'ATOMIC_CHECKPOINT_COMMIT_IDEMPOTENCY_MISMATCH' };
  }
  if (rows.some(row => {
    const item = record(row);
    return String(item.batch_id || '') !== batchId || String(item.correlation_id || '') !== correlationId ||
      String(item.idempotency_key || '') !== String(payload.idempotency_key || '');
  })) return { valid: false, error: 'ATOMIC_CHECKPOINT_COMMIT_MIXED_IDENTITY' };
  return { valid: true, payload, rows, batchId, correlationId, reused: payload.reused === true };
}

export function quoteFromCheckpointEvidence(row) {
  const raw = record(row.raw);
  return { value: Number(row.value), change: Number(raw.change), changePercent: Number(row.change_percent),
    capturedAt: row.source_timestamp, provider: row.source, sourceSymbol: raw.source_symbol, raw: record(raw.source_raw) };
}

export function validRetainedCheckpointRow(row, input, config) {
  if (!row || row.trading_date !== input.tradingDate || row.correlation_id !== input.correlationId ||
    row.symbol !== config.displaySymbol || !presentFiniteNumber(row.snapshot_version) || Number(row.snapshot_version) <= 0 ||
    !presentFiniteNumber(row.value) || !presentFiniteNumber(row.change_percent) || !presentFiniteNumber(record(row.raw).change) ||
    record(row.raw).contract !== 'FETCH_CHECKPOINT_EVIDENCE_V1') return false;
  const validated = buildCheckpointEvidence({ ...input, observedAt: row.captured_at }, quoteFromCheckpointEvidence(row), config);
  return validated.valid === true && row.checkpoint === validated.row.checkpoint && row.market_session === validated.row.market_session;
}
