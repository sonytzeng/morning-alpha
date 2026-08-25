type UnknownRecord = Record<string, unknown>;

const RUNTIME_OVERLAY_KEYS = [
  "opening_radar",
  "opening_radar_status",
  "intraday_sync_status",
  "intraday_tracking",
  "war_room",
  "closing_verification",
  "closing_verification_v2",
] as const;

const RUNTIME_CHECKPOINTS = ["0930", "1030", "1300"] as const;

function asObject(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasValues(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as UnknownRecord).length > 0;
  return value !== null && value !== undefined && value !== "";
}

function hasPersistedRuntimeEvidence(syncValue: unknown): boolean {
  const sync = asObject(syncValue);
  const source = text(sync.source).toLowerCase();
  const windows = asObject(sync.windows);
  const hasResolvedWindow = Object.values(windows).some((value) => {
    const window = asObject(value);
    const status = text(window.status || window.checkpoint_status || value).toLowerCase();
    return [
      "ready",
      "complete",
      "completed",
      "synced",
      "succeeded",
      "failed",
      "insufficient",
    ].includes(status);
  });
  return hasResolvedWindow || (
    source === "opening_market_radar_refresh"
    && Boolean(sync.checkpoint)
    && Boolean(sync.last_checked_at)
  );
}

export function preserveRuntimeReportOverlay(
  generatedAiValue: unknown,
  existingAiValue: unknown,
): UnknownRecord {
  const generated = { ...asObject(generatedAiValue) };
  const existing = asObject(existingAiValue);

  for (const key of RUNTIME_OVERLAY_KEYS) {
    const existingValue = existing[key];
    if (!hasValues(existingValue)) continue;
    if (key === "intraday_sync_status" && !hasPersistedRuntimeEvidence(existingValue)) continue;
    generated[key] = existingValue;
  }
  return generated;
}

function normalizeLedgerStatus(value: unknown): "completed" | "failed" | "pending" {
  const status = text(value).toUpperCase();
  if (["SUCCEEDED", "SUCCESS", "COMPLETED", "READY", "DONE"].includes(status)) return "completed";
  if (["FAILED", "ERROR", "REJECTED", "INSUFFICIENT"].includes(status)) return "failed";
  return "pending";
}

function resolvedWindowFromLedger(entryValue: unknown, fallbackUpdatedAt: unknown): UnknownRecord | null {
  const entry = asObject(entryValue);
  if (Object.keys(entry).length === 0) return null;
  const status = normalizeLedgerStatus(entry.status);
  if (status === "pending") return null;

  const metadata = asObject(entry.metadata);
  const resolvedAt = text(entry.updated_at) || text(fallbackUpdatedAt) || null;
  const evidence = {
    source: "trading_day_state",
    state: text(entry.state) || null,
    required_core_complete: metadata.required_core_complete === true,
    canonical_complete: metadata.canonical_complete === true,
    snapshot_upserted_count: Number.isFinite(Number(metadata.snapshot_upserted_count))
      ? Number(metadata.snapshot_upserted_count)
      : null,
  };
  return status === "completed"
    ? {
      status,
      completed_at: resolvedAt,
      real_checkpoint_observation: true,
      evidence,
    }
    : {
      status,
      failed_at: resolvedAt,
      real_checkpoint_observation: true,
      evidence,
    };
}

export function buildCanonicalIntradaySyncStatus(
  existingSyncValue: unknown,
  tradingDayStateValue: unknown,
): UnknownRecord {
  const existing = asObject(existingSyncValue);
  const tradingDayState = asObject(tradingDayStateValue);
  const checkpointStatus = asObject(tradingDayState.checkpoint_status);
  if (Object.keys(checkpointStatus).length === 0) return existing;

  const windows: UnknownRecord = { ...asObject(existing.windows) };
  let latestCheckpoint = text(existing.checkpoint);
  let latestStatus = text(existing.checkpoint_status);
  let latestCapturedAt = text(existing.captured_at);

  for (const checkpoint of RUNTIME_CHECKPOINTS) {
    const ledgerWindow = resolvedWindowFromLedger(
      checkpointStatus[checkpoint],
      tradingDayState.updated_at,
    );
    if (!ledgerWindow) continue;
    windows[checkpoint] = ledgerWindow;
    latestCheckpoint = checkpoint;
    latestStatus = text(ledgerWindow.status);
    latestCapturedAt = text(ledgerWindow.completed_at || ledgerWindow.failed_at);
  }

  const completedCount = RUNTIME_CHECKPOINTS.filter((checkpoint) => {
    const window = asObject(windows[checkpoint]);
    return text(window.status).toLowerCase() === "completed";
  }).length;

  return {
    ...existing,
    report_date: text(tradingDayState.trading_date) || text(existing.report_date) || null,
    source: "trading_day_state",
    ledger_guarantee: true,
    current_state: text(tradingDayState.current_state) || null,
    state_rank: Number.isFinite(Number(tradingDayState.state_rank))
      ? Number(tradingDayState.state_rank)
      : null,
    checkpoint: latestCheckpoint || null,
    checkpoint_status: latestStatus || null,
    captured_at: latestCapturedAt || null,
    last_checked_at: text(tradingDayState.updated_at) || text(existing.last_checked_at) || null,
    windows,
    warning: completedCount > 0
      ? `已完成 ${completedCount} 個盤中驗證節點。`
      : text(existing.warning) || "等待第一個盤中驗證節點。",
  };
}
