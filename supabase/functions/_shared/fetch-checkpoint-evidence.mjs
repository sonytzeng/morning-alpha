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
      source_symbol: quote.sourceSymbol, change: Number(quote.change), source_raw: record(quote.raw) },
  } };
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
