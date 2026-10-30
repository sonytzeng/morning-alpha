import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import {
  extractTaifexCsv,
  matchTaifexLastTrade,
  normalizeTaifexRegularPayload,
  resolveTaifexRegularQuote,
  selectTaifexDaily,
  TAIFEX_DAILY_URL,
  taifexArchiveUrl,
  taifexFrontMonth,
} from "../supabase/functions/_shared/taifex-regular-fallback.mjs";
import {
  requiredProviderSlot,
  resolveTxfQuoteWithFallback,
  validateRequiredProviderEvidence,
} from "../supabase/functions/_shared/required-provider-validation.mjs";
import {
  buildProductionProviderEvidence,
  replayRecordedProviderEvidence,
} from "../supabase/functions/_shared/production-evidence-recorder.mjs";
import { validateAtomicCheckpointEvidenceRows } from "../supabase/functions/_shared/fetch-checkpoint-evidence.mjs";

// All prices, rows, clocks and responses below are SYNTHETIC unit fixtures.
// No successful fixture is production-forward or source-acquisition evidence.
const prior = "2026-10-29";
const options = {
  phase: "premarket",
  checkpoint: "premarket",
  tradingDate: "2026-10-30",
  observedAt: "2026-10-30T06:50:00+08:00",
  correlationId: "21065000-0000-4000-8000-000000000001",
};
const received = "2026-10-30T06:50:10+08:00";
const dailyHeader =
  "日期,契約代號,到期月份(週別),最後成交價,漲跌價,漲跌%,交易時段\n";
const dailyRow = "20261029,TX,202611,10100,100,1.00%,一般\n";
const daily = dailyHeader + dailyRow;
const header = Buffer.from(
  "a6a8a5e6a4e9b4c12cb0d3ab7ea54eb8b92ca8ecb4c1a4eba5f728b667a74f292ca6a8a5e6aec9b6a12ca6a8a5e6bbf9aee62ca6a8a5e6bcc6b67128422b53292caaf1a4ebbbf9aee62cbbb7a4ebbbf9aee62cb67dbd4cb6b0a658c476bbf9200d0a",
  "hex",
);
const tick = (time, price = 10100, month = "202611", date = "20261029") =>
  `${date},TX     ,${month},${time},${price},2,-,-,\r\n`;
const csv = (body = tick("134459") + tick("134459", 10101)) =>
  Buffer.concat([header, Buffer.from(body)]);
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(body = csv(), name = "Daily_2026_10_29.csv") {
  const filename = Buffer.from(name),
    compressed = deflateRawSync(body),
    crc = crc32(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + filename.length, 12);
  end.writeUInt32LE(30 + filename.length + compressed.length, 16);
  return Buffer.concat([local, filename, compressed, central, filename, end]);
}
const fixtureFetch = async (url) =>
  new Response(url === TAIFEX_DAILY_URL ? daily : zip(), { status: 200 });
const resolve = (
  opts = options,
  fetcher = fixtureFetch,
  clock = () => received,
) => resolveTaifexRegularQuote(opts, fetcher, clock);

test("official fallback binds the prior regular price to its actual last trade second", async () => {
  const result = await resolve();
  assert.ok(result.quote);
  assert.equal(result.quote.value, 10100);
  assert.equal(result.quote.capturedAt, "2026-10-29T13:44:59+08:00");
  assert.equal(result.quote.provider, "taifex_open_data");
  assert.equal(result.quote.raw.session, "regular");
  assert.equal(result.quote.raw.published_at, null);
  assert.match(result.quote.raw.attribution, /臺灣期貨交易所/);
  assert.deepEqual(result.response.payload.data.map((r) => r.source_url), [
    TAIFEX_DAILY_URL,
    taifexArchiveUrl(prior),
  ]);
  assert.equal(
    validateRequiredProviderEvidence(
      requiredProviderSlot("TXF"),
      result.quote,
      options,
    ).valid,
    true,
  );
});

test("latest-second price matching is independent of file order; settlement is not substituted", () => {
  assert.equal(
    matchTaifexLastTrade(
      csv(tick("134459", 10101) + tick("134458", 10099) + tick("134459")),
      prior,
      "202611",
      10100,
    ),
    "2026-10-29T13:44:59+08:00",
  );
  assert.throws(
    () =>
      matchTaifexLastTrade(
        csv(tick("134458") + tick("134459", 10101)),
        prior,
        "202611",
        10100,
      ),
    /LAST_PRICE_MISMATCH/,
  );
});

test("wrong date, contract, night-only and incomplete-session ticks cannot supply a close", () => {
  for (
    const body of [
      tick("134459", 10100, "202612"),
      tick("134459", 10100, "202611", "20261028"),
      tick("045959"),
      tick("120000"),
    ]
  ) {
    assert.throws(
      () => matchTaifexLastTrade(csv(body), prior, "202611", 10100),
      /LAST_PRICE_MISMATCH/,
    );
  }
  assert.throws(
    () => matchTaifexLastTrade(csv(tick("134499")), prior, "202611", 10100),
    /TICK_ROW_INVALID/,
  );
});

test("daily report rejects duplicate sessions, stale dates, price and percent inconsistencies", () => {
  for (
    const text of [
      daily + dailyRow,
      daily.replace("20261029", "20261028"),
      daily.replace("202611", "202612"),
      daily.replace("一般", "盤後"),
      daily.replace("1.00%", "2.00%"),
      daily.replace("10100", "-1"),
    ]
  ) {
    assert.throws(
      () => selectTaifexDaily(text, prior, "202611"),
      /TAIFEX_DAILY_/,
    );
  }
  assert.deepEqual(selectTaifexDaily("\uFEFF" + daily, prior, "202611"), {
    price: 10100,
    change: 100,
    changePercent: 1,
  });
});

test("front contract rolls after expiry; closed or uncovered dates fail without guessing", () => {
  assert.equal(taifexFrontMonth("2026-10-21"), "202610");
  assert.equal(taifexFrontMonth("2026-10-22"), "202611");
  assert.throws(() => taifexFrontMonth("2026-10-31"), /CALENDAR/);
  assert.throws(() => taifexFrontMonth("2029-01-02"), /CALENDAR/);
  assert.throws(() => taifexArchiveUrl("2026-02-30"), /DATE_INVALID/);
});

test("ZIP validates filename, one member, encryption, CRC and resource limits", () => {
  assert.deepEqual(extractTaifexCsv(zip(), prior), csv());
  assert.throws(
    () => extractTaifexCsv(zip(csv(), "../Daily_2026_10_29.csv"), prior),
    /MEMBER/,
  );
  for (
    const mutate of [
      (b) => b.writeUInt16LE(2, b.length - 12),
      (b) => b.writeUInt16LE(1, 6),
      (b) =>
        b.writeUInt32LE(
          0,
          b.length - 22 - 46 - "Daily_2026_10_29.csv".length + 16,
        ),
      (b) =>
        b.writeUInt32LE(
          100 * 1024 * 1024,
          b.length - 22 - 46 - "Daily_2026_10_29.csv".length + 24,
        ),
    ]
  ) {
    const b = zip();
    mutate(b);
    assert.throws(() => extractTaifexCsv(b, prior));
  }
  assert.throws(
    () => extractTaifexCsv(Buffer.alloc(9 * 1024 * 1024), prior),
    /SIZE/,
  );
});

for (
  const [label, overrides] of Object.entries({
    intraday: { phase: "intraday" },
    close: { phase: "close" },
    backfill: { phase: "manual_backfill" },
    late: { observedAt: "2026-10-30T08:45:00+08:00" },
    early: { observedAt: "2026-10-30T06:49:59+08:00" },
    dateMismatch: { tradingDate: "2026-10-29" },
  })
) {
  test(`${label} refuses official fallback before making any network request`, async () => {
    let calls = 0;
    const result = await resolve({ ...options, ...overrides }, async () => {
      calls++;
      throw Error("UNEXPECTED");
    });
    assert.equal(calls, 0);
    assert.equal(result.quote, null);
    assert.match(result.response.error, /PREMARKET_ONLY/);
  });
}

test("failed downloads and after-cutoff receipts stay failures with no fabricated quote", async () => {
  for (const status of [403, 404, 429, 500]) {
    const result = await resolve(
      options,
      async () => new Response("", { status }),
    );
    assert.equal(result.quote, null);
    assert.equal(result.response.error, `TAIFEX_HTTP_${status}`);
  }
  assert.equal(
    (await resolve(options, fixtureFetch, () => "2026-10-30T08:45:00+08:00"))
      .quote,
    null,
  );
  assert.equal(
    (await resolve(options, fixtureFetch, () => "2026-10-30T06:49:59+08:00"))
      .quote,
    null,
  );
  assert.equal(
    (await resolve(options, async () => {
      throw new DOMException("aborted", "AbortError");
    })).quote,
    null,
  );
});

test("HTTP requests prohibit redirects and bound response bodies", async () => {
  const seen = [];
  const result = await resolve(options, async (url, init) => {
    seen.push(init);
    return fixtureFetch(url);
  });
  assert.ok(result.quote);
  assert.equal(seen.length, 2);
  assert.ok(
    seen.every((i) =>
      i.redirect === "error" && i.signal instanceof AbortSignal
    ),
  );
  const oversized = await resolve(
    options,
    async (url) =>
      new Response(
        url === TAIFEX_DAILY_URL ? new Uint8Array(2 * 1024 * 1024 + 1) : zip(),
      ),
  );
  assert.equal(oversized.quote, null);
  assert.equal(oversized.response.error, "TAIFEX_RESPONSE_SIZE_LIMIT");
});

test("recorded source URLs, hashes, bytes, time and exact session cannot be silently changed", async () => {
  const result = await resolve();
  for (
    const mutate of [
      (p) => p.date = "2026-10-28",
      (p) => p.session = "afterhours",
      (p) => p.symbol = "TX202612",
      (p) => p.price = 9999,
      (p) => p.data[0].source_url = "https://example.com",
      (p) => p.data[1].source_sha256 = "x",
      (p) => p.data[1].source_bytes = 0,
      (p) => p.data[1].received_at = "2026-10-29T06:51:00+08:00",
      (p) => p.lastTrade.time = p.total.time = "2026-10-29T13:45:01+08:00",
    ]
  ) {
    const p = structuredClone(result.response.payload);
    mutate(p);
    assert.equal(normalizeTaifexRegularPayload(p, options), null);
  }
});

test("primary success avoids official requests; entitlement failure preserves both source traces", async () => {
  const official = await resolve();
  let calls = 0;
  const denied = () =>
    Promise.resolve({ status: 403, payload: null, error: "expired plan" });
  const fallback = await resolveTxfQuoteWithFallback(
    denied,
    options,
    async () => {
      calls++;
      return official;
    },
  );
  assert.equal(calls, 1);
  assert.equal(fallback.quote.provider, "taifex_open_data");
  assert.equal(fallback.observations[0].status, 403);
  assert.equal(fallback.observations[1].status, 200);
  const payload = {
    symbol: "TXF1!",
    price: 10100,
    date: "2026-10-29",
    lastTrade: {
      price: 10100,
      time: Date.parse("2026-10-30T04:59:59+08:00") * 1000,
    },
    change: 100,
    changePercent: 1,
  };
  const primary = await resolveTxfQuoteWithFallback(
    async () => ({ status: 200, payload, error: null }),
    options,
    async () => {
      throw Error("OFFICIAL_MUST_NOT_RUN");
    },
  );
  assert.equal(primary.quote?.provider, "fugle_futopt");
  const failed = await resolveTxfQuoteWithFallback(
    denied,
    options,
    () => resolve(options, async () => new Response("", { status: 503 })),
  );
  assert.equal(failed.quote, null);
  assert.deepEqual(failed.observations.map((x) => x.error), [
    "expired plan",
    "TAIFEX_HTTP_503",
  ]);
  await resolveTxfQuoteWithFallback(
    denied,
    { ...options, phase: "intraday" },
    async () => {
      throw Error("OFFICIAL_MUST_NOT_RUN");
    },
  );
});

test("new provider records and replays offline, preserving attribution, receipts and atomic 11-provider requirement", async () => {
  const result = await resolve();
  const evidence = validateRequiredProviderEvidence(
    requiredProviderSlot("TXF"),
    result.quote,
    options,
  );
  const row = await buildProductionProviderEvidence({
    businessDate: options.tradingDate,
    checkpoint: "PREMARKET",
    validationCheckpoint: "premarket",
    attempt: 1,
    transportAttempt: 1,
    attemptKey: "synthetic-r21",
    providerKey: "TXF",
    provider: result.quote.provider,
    symbol: result.quote.sourceSymbol,
    endpoint: result.endpoint,
    httpStatus: 200,
    rawPayload: result.response.payload,
    normalizedQuote: result.quote,
    evidence,
    error: null,
    marketPhase: "premarket",
    observedAt: options.observedAt,
    correlationId: options.correlationId,
    adapterVersion: "SYNTHETIC_TEST",
    contractVersion: "MARKET_CHECKPOINT_PROVIDER_V1",
    sourceFunction: "fetch-market-data-v10",
    recordedAt: received,
    responses: [{
      endpoint: "futopt/intraday/quote/TXF1!?session=afterhours",
      status: 403,
      payload: null,
      error: "expired plan",
    }, ...result.observations],
  });
  assert.equal(row.replay_payload.adapter_kind, "TAIFEX_PRIOR_REGULAR");
  assert.deepEqual(
    row.replay_payload.provider_payload.data,
    result.response.payload.data,
  );
  assert.equal(row.replay_payload.responses[0].status, 403);
  const replay = await replayRecordedProviderEvidence(row);
  assert.equal(replay.deterministic, true);
  assert.equal(replay.contract_result, "PASS");
  assert.deepEqual(replay.quote, result.quote);
  assert.equal(
    validateAtomicCheckpointEvidenceRows([{
      ...evidence.row,
      provider_key: "TXF",
    }]).valid,
    false,
  );
  const tampered = structuredClone(row);
  tampered.replay_payload.provider_payload.data[1].received_at =
    "2026-10-30T09:00:00+08:00";
  const rejected = await replayRecordedProviderEvidence(tampered);
  assert.equal(rejected.contract_result, "FAIL");
  assert.equal(rejected.deterministic, false);
});
