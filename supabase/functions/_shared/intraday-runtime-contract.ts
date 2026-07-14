export type IntradayCheckpoint = "0930" | "1030" | "1300";

export type RuntimeSnapshotRow = {
  symbol: string;
  captured_at: string;
  trading_date?: string | null;
  phase?: string | null;
  source?: unknown;
  value?: unknown;
  change_percent?: unknown;
};

export const CORE_SYMBOL_ALIASES = {
  TAIEX: ["TAIEX", "TWII", "^TWII"],
  TXF: ["TXF", "TX", "TXF1", "MTX"],
  TSMC: ["2330", "2330.TW", "TSMC_TW"],
} as const;

export const CORE_SYMBOL_QUERY_ALIASES = Array.from(
  new Set(Object.values(CORE_SYMBOL_ALIASES).flat()),
);

export const INTRADAY_CHECKPOINTS: Record<
  IntradayCheckpoint,
  { targetMinutes: number; earliestMinutes: number; latestMinutes: number }
> = {
  "0930": {
    targetMinutes: 9 * 60 + 30,
    earliestMinutes: 9 * 60 + 25,
    latestMinutes: 9 * 60 + 31,
  },
  "1030": {
    targetMinutes: 10 * 60 + 30,
    earliestMinutes: 10 * 60 + 25,
    latestMinutes: 10 * 60 + 31,
  },
  "1300": {
    targetMinutes: 13 * 60,
    earliestMinutes: 12 * 60 + 55,
    latestMinutes: 13 * 60 + 1,
  },
};

export type SnapshotWindowEvaluation = {
  ready: boolean;
  status: "ready" | "insufficient";
  missingSymbols: string[];
  acceptedRows: RuntimeSnapshotRow[];
  rejectedRows: RuntimeSnapshotRow[];
};

function normalizeSymbol(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export function taipeiDateFromIso(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function taipeiMinutesFromIso(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : null;
}

export function normalizeIntradayCheckpoint(
  value: unknown,
): IntradayCheckpoint | null {
  const normalized = String(value || "").replace(/[^0-9]/g, "");
  return normalized === "0930" || normalized === "1030" || normalized === "1300"
    ? normalized
    : null;
}

export function inferIntradayCheckpoint(
  hour: number,
  minute: number,
): IntradayCheckpoint | null {
  const nowMinutes = hour * 60 + minute;
  for (
    const [checkpoint, spec] of Object.entries(INTRADAY_CHECKPOINTS) as Array<
      [IntradayCheckpoint, typeof INTRADAY_CHECKPOINTS[IntradayCheckpoint]]
    >
  ) {
    if (nowMinutes >= spec.targetMinutes && nowMinutes <= spec.latestMinutes) {
      return checkpoint;
    }
  }
  return null;
}

function isPresentFiniteNumber(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (typeof value !== "number" && typeof value !== "string") return false;
  return Number.isFinite(Number(value));
}

function isCompleteRow(row: RuntimeSnapshotRow): boolean {
  return Boolean(row.symbol && row.captured_at) &&
    isPresentFiniteNumber(row.value) &&
    isPresentFiniteNumber(row.change_percent);
}

function aliasesContain(aliases: readonly string[], symbol: string): boolean {
  const normalized = normalizeSymbol(symbol);
  return aliases.some((alias) => normalizeSymbol(alias) === normalized);
}

function latestRowForAliases(
  rows: RuntimeSnapshotRow[],
  aliases: readonly string[],
): RuntimeSnapshotRow | null {
  return rows
    .filter((row) => aliasesContain(aliases, row.symbol))
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0] || null;
}

export function isSnapshotInCheckpointWindow(
  row: RuntimeSnapshotRow,
  tradingDate: string,
  checkpoint: IntradayCheckpoint,
): boolean {
  if (
    row.phase !== "intraday" || row.trading_date !== tradingDate ||
    !isCompleteRow(row)
  ) return false;
  if (taipeiDateFromIso(row.captured_at) !== tradingDate) return false;
  const capturedMinutes = taipeiMinutesFromIso(row.captured_at);
  const spec = INTRADAY_CHECKPOINTS[checkpoint];
  return capturedMinutes !== null && capturedMinutes >= spec.earliestMinutes &&
    capturedMinutes <= spec.latestMinutes;
}

export function evaluateIntradayCheckpointRows(
  rows: RuntimeSnapshotRow[],
  tradingDate: string,
  checkpoint: IntradayCheckpoint,
): SnapshotWindowEvaluation {
  const acceptedRows = rows.filter((row) =>
    isSnapshotInCheckpointWindow(row, tradingDate, checkpoint)
  );
  const rejectedRows = rows.filter((row) => !acceptedRows.includes(row));
  const selectedRows = [
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TAIEX),
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TXF),
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TSMC),
  ].filter((row): row is RuntimeSnapshotRow => row !== null);
  const missingSymbols = [
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TAIEX) ? "" : "TAIEX",
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TXF) ? "" : "TXF",
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TSMC) ? "" : "2330",
  ].filter(Boolean);
  return {
    ready: missingSymbols.length === 0,
    status: missingSymbols.length === 0 ? "ready" : "insufficient",
    missingSymbols,
    acceptedRows: selectedRows,
    rejectedRows,
  };
}

export function buildCheckpointAvailability(
  rows: RuntimeSnapshotRow[],
  tradingDate: string,
): Record<IntradayCheckpoint, "ready" | "insufficient"> {
  return {
    "0930": evaluateIntradayCheckpointRows(rows, tradingDate, "0930").status,
    "1030": evaluateIntradayCheckpointRows(rows, tradingDate, "1030").status,
    "1300": evaluateIntradayCheckpointRows(rows, tradingDate, "1300").status,
  };
}

export function isSnapshotInCloseWindow(
  row: RuntimeSnapshotRow,
  tradingDate: string,
): boolean {
  if (
    row.phase !== "close" || row.trading_date !== tradingDate ||
    !isCompleteRow(row)
  ) return false;
  if (taipeiDateFromIso(row.captured_at) !== tradingDate) return false;
  const capturedMinutes = taipeiMinutesFromIso(row.captured_at);
  return capturedMinutes !== null && capturedMinutes >= 13 * 60 + 30 &&
    capturedMinutes <= 15 * 60 + 30;
}

export function evaluateCloseSnapshotRows(
  rows: RuntimeSnapshotRow[],
  tradingDate: string,
): SnapshotWindowEvaluation {
  const acceptedRows = rows.filter((row) =>
    isSnapshotInCloseWindow(row, tradingDate)
  );
  const rejectedRows = rows.filter((row) => !acceptedRows.includes(row));
  const selectedRows = [
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TAIEX),
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TXF),
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TSMC),
  ].filter((row): row is RuntimeSnapshotRow => row !== null);
  const missingSymbols = [
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TAIEX) ? "" : "TAIEX",
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TXF) ? "" : "TXF",
    latestRowForAliases(acceptedRows, CORE_SYMBOL_ALIASES.TSMC) ? "" : "2330",
  ].filter(Boolean);
  return {
    ready: missingSymbols.length === 0,
    status: missingSymbols.length === 0 ? "ready" : "insufficient",
    missingSymbols,
    acceptedRows: selectedRows,
    rejectedRows,
  };
}

export function shouldInsertAccuracyLog(
  existingRows: unknown[] | null | undefined,
): boolean {
  return !Array.isArray(existingRows) || existingRows.length === 0;
}
