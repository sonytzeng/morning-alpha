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

const RUNTIME_CHECKPOINTS = ["0900", "0930", "1030", "1300", "1410", "1430"] as const;

type RuntimeCompletionContext = {
  closeMarketReview?: unknown;
  closingDecisionSnapshot?: unknown;
  learningRun?: unknown;
};

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

function hasFiniteNumber(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
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

function normalizeOutcome(value: unknown): "hit" | "partial" | "miss" | "pending" {
  const normalized = text(value).toLowerCase();
  if (["hit", "correct", "confirmed", "success", "accurate", "方向一致", "大致一致", "命中"].includes(normalized)) return "hit";
  if (["partial", "mixed", "partially_confirmed"].includes(normalized) || normalized.includes("部分")) return "partial";
  if (["miss", "wrong", "failed", "rejected", "incorrect", "inaccurate", "未命中"].includes(normalized)) return "miss";
  return "pending";
}

function isAuthoritativeCloseComplete(value: unknown): boolean {
  const review = asObject(value);
  if (Object.keys(review).length === 0) return false;
  const missingData = Array.isArray(review.missing_data) ? review.missing_data : [];
  const dataQuality = text(review.data_quality).toLowerCase();
  const hasActualDirection = Boolean(text(review.actual_market_result)) || hasFiniteNumber(review.taiex_change);
  return hasActualDirection
    && missingData.length === 0
    && ["高可信", "verified", "complete", "high_confidence"].includes(dataQuality)
    && normalizeOutcome(review.verification_result || review.verification_label) !== "pending";
}

function isAuthoritativeClosingSnapshotComplete(value: unknown): boolean {
  const snapshot = asObject(value);
  const generatedText = asObject(snapshot.generated_text);
  const hasActualDirection = Boolean(text(generatedText.actual_direction))
    || hasFiniteNumber(generatedText.actual_taiex_change);
  return ["FINAL", "COMPLETED", "READY"].includes(text(snapshot.status).toUpperCase())
    && hasActualDirection;
}

function authoritativeCloseWindow(
  checkpoint: "1410" | "1430",
  context: RuntimeCompletionContext,
): UnknownRecord | null {
  const review = asObject(context.closeMarketReview);
  if (!isAuthoritativeCloseComplete(review)) return null;
  return {
    status: "completed",
    completed_at: text(review.updated_at) || text(review.created_at) || null,
    real_checkpoint_observation: true,
    evidence: {
      source: "close_market_review",
      checkpoint,
      authoritative: true,
      data_quality: text(review.data_quality) || null,
      official_close_semantics: true,
      taiex_change: hasFiniteNumber(review.taiex_change) ? Number(review.taiex_change) : null,
      tsmc_change: hasFiniteNumber(review.tsmc_change) ? Number(review.tsmc_change) : null,
      txf_change: hasFiniteNumber(review.txf_change) ? Number(review.txf_change) : null,
    },
  };
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
  if (status === "completed" && metadata.required_core_complete === false) {
    return {
      status: "insufficient",
      failed_at: resolvedAt,
      real_checkpoint_observation: true,
      evidence: {
        ...evidence,
        reason: "required_core_incomplete",
      },
    };
  }
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
  completionContextValue: RuntimeCompletionContext = {},
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
    const authoritativeWindow = checkpoint === "1410" || checkpoint === "1430"
      ? authoritativeCloseWindow(checkpoint, completionContextValue)
      : null;
    const ledgerWindow = authoritativeWindow || resolvedWindowFromLedger(
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
  const closingSnapshot = asObject(completionContextValue.closingDecisionSnapshot);
  const learningRun = asObject(completionContextValue.learningRun);
  const closingStatus = isAuthoritativeCloseComplete(completionContextValue.closeMarketReview)
    || isAuthoritativeClosingSnapshotComplete(closingSnapshot)
    ? "completed"
    : "pending";
  const learningStatus = text(learningRun.status).toLowerCase() === "succeeded"
    ? "completed"
    : text(learningRun.status).toLowerCase() || "pending";

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
    closing_verification_status: closingStatus,
    continuous_learning_status: learningStatus,
    lifecycle_complete: completedCount === RUNTIME_CHECKPOINTS.length
      && closingStatus === "completed"
      && learningStatus === "completed",
    windows,
    warning: completedCount > 0
      ? `已完成 ${completedCount} 個盤中驗證節點。`
      : text(existing.warning) || "等待第一個盤中驗證節點。",
  };
}
