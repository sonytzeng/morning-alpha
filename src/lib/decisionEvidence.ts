export type RuntimeDecisionStatus = 'Waiting' | 'Confirmed' | 'Rejected' | 'Completed';

export interface DecisionRuntimeEvidence {
  status: RuntimeDecisionStatus;
  reason: string;
  completedCheckpoints: number;
  totalCheckpoints: number;
  checklistAvailable: boolean;
  marketSnapshotAvailable: boolean;
  runtimeFailure: boolean;
  closingVerified: boolean;
}

export type RuntimeCheckpointState = 'completed' | 'failed' | 'insufficient' | 'pending';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function exactStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasStructuredEvidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value as UnknownRecord).length > 0;
  return typeof value === 'string' ? value.trim().length > 0 : value === true;
}

function normalizeCheckpointKey(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '').padStart(4, '0') : '';
}

export function getRuntimeCheckpointState(syncValue: unknown, checkpoint: string): RuntimeCheckpointState {
  const sync = record(syncValue);
  const windows = record(sync.windows);
  const normalizedKey = normalizeCheckpointKey(checkpoint);
  const windowValue = windows[normalizedKey] ?? windows[checkpoint];
  const window = record(windowValue);
  const status = exactStatus(window.status ?? window.checkpoint_status ?? windowValue);
  const currentCheckpointMatches = normalizeCheckpointKey(sync.checkpoint) === normalizedKey;
  const currentStatusMatches = currentCheckpointMatches
    && exactStatus(sync.checkpoint_status) === status;
  const windowEvidence = Boolean(window.completed_at)
    || Boolean(window.failed_at)
    || window.real_checkpoint_observation === true
    || hasStructuredEvidence(window.evidence);
  const currentSnapshotEvidence = currentStatusMatches
    && Boolean(sync.last_checked_at)
    && Boolean(sync.captured_at);
  const failureEvidence = windowEvidence
    || (currentStatusMatches && Boolean(sync.last_checked_at) && hasStructuredEvidence(sync.reason));

  if (['ready', 'complete', 'completed', 'synced'].includes(status)) {
    return windowEvidence || currentSnapshotEvidence ? 'completed' : 'pending';
  }
  if (['failed', 'rejected', 'invalidated'].includes(status)) {
    return failureEvidence ? 'failed' : 'insufficient';
  }
  if (['missing', 'stale', 'insufficient', 'not_updated'].includes(status)) return 'insufficient';
  return 'pending';
}

function hasNumericValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed);
}

function hasCoreOpeningEvidence(openingRadar: UnknownRecord): boolean {
  return [openingRadar.taiex_change, openingRadar.txf_change, openingRadar.tsmc_change]
    .filter(hasNumericValue).length >= 2;
}

function hasMarketSnapshot(ai: UnknownRecord): boolean {
  const snapshots = Array.isArray(ai.market_data_snapshots) ? ai.market_data_snapshots : [];
  const completeSymbols = new Set(snapshots.flatMap((item) => {
    const row = record(item);
    if (!hasNumericValue(row.value) || !hasNumericValue(row.change_percent)) return [];
    const rawSymbol = String(row.symbol ?? row.ticker ?? '').trim().toUpperCase();
    const symbol = rawSymbol.replace(/^(TWSE|TPEX):/, '').replace(/\.(TW|TWO)$/, '');
    if (['TAIEX', '^TWII'].includes(symbol)) return ['TAIEX'];
    if (['TXF', 'TX', 'TX1', 'TX01'].includes(symbol)) return ['TXF'];
    if (symbol === '2330') return ['2330'];
    return [];
  }));
  return ['TAIEX', 'TXF', '2330'].every((symbol) => completeSymbols.has(symbol));
}

function closingResult(ai: UnknownRecord): { verified: boolean; rejected: boolean } {
  const v2 = record(ai.closing_verification_v2);
  const closing = Object.keys(v2).length > 0 ? v2 : record(ai.closing_verification);
  const status = exactStatus(closing.status ?? closing.data_status ?? closing.verification_status);
  const outcome = exactStatus(closing.hit_or_miss ?? closing.prediction_result ?? closing.result);
  const verified = ['completed', 'complete', 'ready', 'done'].includes(status)
    && Boolean(outcome || closing.actual_direction || closing.verification_note);
  const rejected = ['miss', 'failed', 'rejected', 'wrong', 'incorrect'].includes(outcome);
  return { verified, rejected };
}

export function buildDecisionRuntimeEvidence(params: {
  ai?: UnknownRecord | null;
  checklistItemCount: number;
}): DecisionRuntimeEvidence {
  const ai = record(params.ai);
  const openingRadar = record(ai.opening_radar);
  const sync = record(ai.intraday_sync_status);
  const checkpointStates = ['0930', '1030', '1300'].map((checkpoint) => getRuntimeCheckpointState(sync, checkpoint));
  const completedCheckpoints = checkpointStates.filter((status) => status === 'completed').length;
  const failedCheckpoint = checkpointStates.some((status) => status === 'failed');
  const marketSnapshotAvailable = hasMarketSnapshot(ai);
  const checklistAvailable = params.checklistItemCount > 0;
  const closing = closingResult(ai);
  const runtimeFailure = closing.rejected
    || failedCheckpoint
    || (openingRadar.is_premarket_overridden === true && hasCoreOpeningEvidence(openingRadar));

  if (closing.verified) {
    return {
      status: closing.rejected ? 'Rejected' : 'Completed',
      reason: closing.rejected ? '收盤驗證確認原劇本失效。' : '收盤驗證已完成。',
      completedCheckpoints,
      totalCheckpoints: checkpointStates.length,
      checklistAvailable,
      marketSnapshotAvailable,
      runtimeFailure,
      closingVerified: true,
    };
  }

  if (runtimeFailure && marketSnapshotAvailable) {
    return {
      status: 'Rejected',
      reason: 'Runtime checkpoint 已回傳明確失敗證據。',
      completedCheckpoints,
      totalCheckpoints: checkpointStates.length,
      checklistAvailable,
      marketSnapshotAvailable,
      runtimeFailure: true,
      closingVerified: false,
    };
  }

  if (completedCheckpoints > 0 && checklistAvailable && marketSnapshotAvailable) {
    return {
      status: 'Confirmed',
      reason: 'Runtime checkpoint、驗證清單與市場快照均已到位。',
      completedCheckpoints,
      totalCheckpoints: checkpointStates.length,
      checklistAvailable,
      marketSnapshotAvailable,
      runtimeFailure: false,
      closingVerified: false,
    };
  }

  return {
    status: 'Waiting',
    reason: !marketSnapshotAvailable
      ? '市場快照不足，暫不升級決策。'
      : !checklistAvailable
        ? '驗證清單不足，暫不升級決策。'
        : '尚無完成的 Runtime checkpoint。',
    completedCheckpoints,
    totalCheckpoints: checkpointStates.length,
    checklistAvailable,
    marketSnapshotAvailable,
    runtimeFailure: false,
    closingVerified: false,
  };
}

export function canPresentConfirmedDecision(evidence: DecisionRuntimeEvidence): boolean {
  return evidence.status === 'Confirmed'
    && evidence.completedCheckpoints > 0
    && evidence.checklistAvailable
    && evidence.marketSnapshotAvailable
    && !evidence.runtimeFailure;
}

export function canPresentRejectedDecision(evidence: DecisionRuntimeEvidence): boolean {
  return evidence.status === 'Rejected'
    && evidence.runtimeFailure
    && (evidence.marketSnapshotAvailable || evidence.closingVerified);
}
