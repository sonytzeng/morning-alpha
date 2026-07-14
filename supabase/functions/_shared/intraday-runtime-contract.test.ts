import {
  buildCheckpointAvailability,
  evaluateCloseSnapshotRows,
  evaluateIntradayCheckpointRows,
  type RuntimeSnapshotRow,
  shouldInsertAccuracyLog,
} from "./intraday-runtime-contract.ts";

const DATE = "2026-07-14";

function coreRows(
  capturedAt: string,
  phase: "intraday" | "close" = "intraday",
  txfSymbol = "TXF",
): RuntimeSnapshotRow[] {
  return ["TAIEX", txfSymbol, "2330"].map((symbol, index) => ({
    symbol,
    captured_at: capturedAt,
    trading_date: DATE,
    phase,
    value: 100 + index,
    change_percent: index / 10,
  }));
}

Deno.test("09:27 snapshot is accepted by the 09:30 checkpoint", () => {
  const result = evaluateIntradayCheckpointRows(
    coreRows("2026-07-14T01:27:00.000Z"),
    DATE,
    "0930",
  );
  if (!result.ready) {
    throw new Error(
      `expected ready, missing ${result.missingSymbols.join(",")}`,
    );
  }
});

Deno.test("09:20 snapshot is rejected by the 09:30 checkpoint", () => {
  const result = evaluateIntradayCheckpointRows(
    coreRows("2026-07-14T01:20:00.000Z"),
    DATE,
    "0930",
  );
  if (result.ready || result.status !== "insufficient") {
    throw new Error("stale snapshot was accepted");
  }
});

Deno.test("09:30 snapshot cannot complete the 10:30 checkpoint", () => {
  const result = evaluateIntradayCheckpointRows(
    coreRows("2026-07-14T01:30:00.000Z"),
    DATE,
    "1030",
  );
  if (result.ready) throw new Error("cross-checkpoint snapshot was accepted");
});

Deno.test("TXF close aliases are accepted when a real close snapshot exists", () => {
  const result = evaluateCloseSnapshotRows(
    coreRows("2026-07-14T06:15:00.000Z", "close", "MTX"),
    DATE,
  );
  if (!result.ready || result.missingSymbols.includes("TXF")) {
    throw new Error("TXF alias was not resolved");
  }
});

Deno.test("close review remains insufficient without close-phase rows", () => {
  const result = evaluateCloseSnapshotRows([], DATE);
  if (result.ready || result.status !== "insufficient") {
    throw new Error("empty close set was accepted");
  }
});

Deno.test("intraday snapshot cannot be used as a close result", () => {
  const result = evaluateCloseSnapshotRows(
    coreRows("2026-07-14T06:15:00.000Z", "intraday"),
    DATE,
  );
  if (result.ready || result.acceptedRows.length !== 0) {
    throw new Error("intraday rows leaked into close evaluation");
  }
});

Deno.test("missing real intraday rows keep every replay checkpoint insufficient", () => {
  const availability = buildCheckpointAvailability([], DATE);
  if (Object.values(availability).some((status) => status !== "insufficient")) {
    throw new Error("missing checkpoint was marked ready");
  }
});

Deno.test("accuracy log insert is idempotent when a row already exists", () => {
  if (!shouldInsertAccuracyLog([])) {
    throw new Error("empty log set should allow insert");
  }
  if (shouldInsertAccuracyLog([{ id: "existing" }])) {
    throw new Error("existing log should prevent duplicate insert");
  }
});

Deno.test("null value cannot complete a checkpoint", () => {
  const rows = coreRows("2026-07-14T01:27:00.000Z");
  rows[0].value = null;
  const result = evaluateIntradayCheckpointRows(rows, DATE, "0930");
  if (result.ready || result.status !== "insufficient") {
    throw new Error("null value was treated as complete");
  }
});

Deno.test("null change percent cannot complete a checkpoint", () => {
  const rows = coreRows("2026-07-14T01:27:00.000Z");
  rows[1].change_percent = null;
  const result = evaluateIntradayCheckpointRows(rows, DATE, "0930");
  if (result.ready || result.status !== "insufficient") {
    throw new Error("null change percent was treated as complete");
  }
});

Deno.test("undefined value cannot complete a checkpoint", () => {
  const rows = coreRows("2026-07-14T01:27:00.000Z");
  rows[2].value = undefined;
  const result = evaluateIntradayCheckpointRows(rows, DATE, "0930");
  if (result.ready || result.status !== "insufficient") {
    throw new Error("undefined value was treated as complete");
  }
});

Deno.test("empty string value cannot complete a checkpoint", () => {
  const rows = coreRows("2026-07-14T01:27:00.000Z");
  rows[0].value = "";
  const result = evaluateIntradayCheckpointRows(rows, DATE, "0930");
  if (result.ready || result.status !== "insufficient") {
    throw new Error("empty string value was treated as complete");
  }
});

Deno.test("finite numeric strings remain valid snapshot values", () => {
  const rows = coreRows("2026-07-14T01:27:00.000Z").map((row) => ({
    ...row,
    value: "123.45",
    change_percent: "-0.25",
  }));
  const result = evaluateIntradayCheckpointRows(rows, DATE, "0930");
  if (!result.ready || result.status !== "ready") {
    throw new Error("finite numeric strings were rejected");
  }
});

Deno.test("one incomplete core symbol keeps the checkpoint insufficient", () => {
  const rows = coreRows("2026-07-14T01:27:00.000Z");
  const txf = rows.find((row) => row.symbol === "TXF");
  if (!txf) throw new Error("test fixture is missing TXF");
  txf.change_percent = undefined;
  const result = evaluateIntradayCheckpointRows(rows, DATE, "0930");
  if (
    result.ready || result.status !== "insufficient" ||
    !result.missingSymbols.includes("TXF")
  ) {
    throw new Error("incomplete TXF did not keep the checkpoint insufficient");
  }
});
