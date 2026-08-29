const PHASES = new Set(['premarket', 'intraday', 'close', 'manual_backfill']);

function requiredText(value, field) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`IMMUTABLE_CHECKPOINT_${field.toUpperCase()}_REQUIRED`);
  return normalized;
}

function requiredFinite(value, field) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`IMMUTABLE_CHECKPOINT_${field.toUpperCase()}_REQUIRED`);
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`IMMUTABLE_CHECKPOINT_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

export function canonicalCheckpointName(phase, checkpoint) {
  if (!PHASES.has(phase)) throw new Error('IMMUTABLE_CHECKPOINT_PHASE_INVALID');
  if (phase === 'premarket') return 'PREMARKET';
  if (phase === 'manual_backfill') return 'RECOVERY';
  return `${phase}_${requiredText(checkpoint, 'checkpoint')}`.toUpperCase();
}

export function marketSessionForPhase(phase) {
  if (!PHASES.has(phase)) throw new Error('IMMUTABLE_CHECKPOINT_PHASE_INVALID');
  return phase === 'manual_backfill' ? 'recovery' : phase;
}

export function buildImmutableMarketCheckpoint(input) {
  const capturedAt = requiredText(input?.captured_at, 'captured_at');
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new Error('IMMUTABLE_CHECKPOINT_CAPTURED_AT_INVALID');
  }
  const sourceTimestamp = requiredText(
    input?.source_timestamp ?? capturedAt,
    'source_timestamp',
  );
  if (!Number.isFinite(Date.parse(sourceTimestamp))) {
    throw new Error('IMMUTABLE_CHECKPOINT_SOURCE_TIMESTAMP_INVALID');
  }

  return {
    checkpoint: canonicalCheckpointName(input?.phase, input?.checkpoint),
    trading_date: requiredText(input?.trading_date, 'trading_date'),
    captured_at: capturedAt,
    market_session: marketSessionForPhase(input?.phase),
    symbol: requiredText(input?.symbol, 'symbol'),
    value: requiredFinite(input?.value, 'value'),
    change_percent: input?.change_percent === null || input?.change_percent === undefined || input?.change_percent === ''
      ? null
      : requiredFinite(input.change_percent, 'change_percent'),
    source: requiredText(input?.source, 'source'),
    source_timestamp: sourceTimestamp,
    correlation_id: requiredText(input?.correlation_id, 'correlation_id'),
    raw: input?.raw && typeof input.raw === 'object' && !Array.isArray(input.raw)
      ? input.raw
      : {},
  };
}

export function immutableCheckpointIdentity(snapshot) {
  return [snapshot?.correlation_id, snapshot?.checkpoint, snapshot?.symbol]
    .map((value) => requiredText(value, 'identity'))
    .join(':');
}
