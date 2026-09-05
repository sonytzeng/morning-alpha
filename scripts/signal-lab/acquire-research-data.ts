#!/usr/bin/env -S deno run --allow-net=openapi.twse.com.tw,www.tpex.org.tw,api.fugle.tw --allow-env=FUGLE_API_KEY --allow-read=/tmp --allow-write=/tmp

import {
  parseFugleHistoricalCandles,
  parseTpexDailyBars,
  parseTpexInstitutionalFlows,
  parseTwseDailyBars,
  parseTwseTaiexObservations,
  validateHistoricalDataset,
} from "../../supabase/functions/_shared/signal-lab/historical-data-adapters.ts";
import { sha256Hex } from "../../supabase/functions/_shared/signal-lab/snapshot-hash.ts";
import type { OhlcvBar } from "../../supabase/functions/_shared/signal-lab/types.ts";

const OFFICIAL_ENDPOINTS = {
  twseDaily: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  taiexCurrentMonth: "https://openapi.twse.com.tw/v1/indicesReport/MI_5MINS_HIST",
  tpexDaily: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes",
  tpexInstitutional: "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading",
} as const;

interface CliOptions {
  source: "official-latest" | "fugle-history";
  output: string;
  symbol?: string;
  market?: OhlcvBar["market"];
  from?: string;
  to?: string;
}

function cliOptions(args: string[]): CliOptions {
  const valueFor = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const source = valueFor("--source") || "official-latest";
  if (source !== "official-latest" && source !== "fugle-history") throw new Error("SOURCE_NOT_SUPPORTED");
  const output = valueFor("--output") || `/tmp/morning-alpha-signal-lab-${source}`;
  if (!output.startsWith("/tmp/")) throw new Error("OUTPUT_MUST_BE_ISOLATED_UNDER_TMP");
  const market = valueFor("--market");
  if (market && !["TWSE", "TPEX", "INDEX"].includes(market)) throw new Error("MARKET_NOT_SUPPORTED");
  return { source, output, symbol: valueFor("--symbol"), market: market as OhlcvBar["market"] | undefined, from: valueFor("--from"), to: valueFor("--to") };
}

async function fetchJson(url: string, headers?: HeadersInit): Promise<unknown> {
  const response = await fetch(url, { headers, redirect: "error" });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}:${new URL(url).hostname}`);
  return response.json();
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeNdjson(path: string, rows: unknown[]): Promise<void> {
  await Deno.writeTextFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

async function acquireOfficialLatest(options: CliOptions): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const payloads = Object.fromEntries(await Promise.all(Object.entries(OFFICIAL_ENDPOINTS).map(async ([name, url]) => [name, await fetchJson(url)])));
  const hashes = Object.fromEntries(await Promise.all(Object.entries(payloads).map(async ([name, payload]) => [name, await sha256Hex(payload)])));
  const twse = parseTwseDailyBars(payloads.twseDaily, { fetchedAt, sourceRef: OFFICIAL_ENDPOINTS.twseDaily, sourceHash: hashes.twseDaily });
  const tpex = parseTpexDailyBars(payloads.tpexDaily, { fetchedAt, sourceRef: OFFICIAL_ENDPOINTS.tpexDaily, sourceHash: hashes.tpexDaily });
  const marketVolumes = new Map(tpex.rows.map((row) => [`${row.symbol}:${row.tradingDate}`, row.volume]));
  const institutions = parseTpexInstitutionalFlows(payloads.tpexInstitutional, {
    fetchedAt, sourceRef: OFFICIAL_ENDPOINTS.tpexInstitutional, sourceHash: hashes.tpexInstitutional, marketVolumes,
  });
  const taiex = parseTwseTaiexObservations(payloads.taiexCurrentMonth, {
    fetchedAt, sourceRef: OFFICIAL_ENDPOINTS.taiexCurrentMonth, sourceHash: hashes.taiexCurrentMonth,
  });
  const bars = [...twse.rows, ...tpex.rows];
  const quality = validateHistoricalDataset({
    bars,
    institutionalFlows: institutions.rows,
    taiexBars: [],
    corporateActions: [],
    historicalUniverseAvailable: false,
    availableAtProven: false,
    adjustedPriceMethodologyKnown: false,
  });
  await Deno.mkdir(`${options.output}/raw`, { recursive: true });
  await Promise.all(Object.entries(payloads).map(([name, payload]) => writeJson(`${options.output}/raw/${name}.json`, payload)));
  await writeNdjson(`${options.output}/daily-prices.ndjson`, bars);
  await writeNdjson(`${options.output}/institutional-flows.ndjson`, institutions.rows);
  await writeNdjson(`${options.output}/taiex-partial.ndjson`, taiex.rows);
  const adapterIssues = [...twse.issues, ...tpex.issues, ...institutions.issues, ...taiex.issues];
  await writeJson(`${options.output}/manifest.json`, {
    manifestVersion: "SIGNAL_LAB_DATASET_MANIFEST_V1",
    acquisitionMode: "official-latest",
    acquiredAt: fetchedAt,
    researchUseOnly: true,
    productionImported: false,
    sourceHashes: hashes,
    counts: { twseBars: twse.rows.length, tpexBars: tpex.rows.length, institutionalRows: institutions.rows.length, taiexPartialRows: taiex.rows.length },
    adapterIssues,
    quality,
  });
  console.log(JSON.stringify({ output: options.output, quality, counts: { bars: bars.length, institutions: institutions.rows.length, taiexPartial: taiex.rows.length }, adapterIssueCodes: [...new Set(adapterIssues.map((entry) => entry.code))].sort() }, null, 2));
}

function validateIsoDate(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function acquireFugleHistory(options: CliOptions): Promise<void> {
  const apiKey = Deno.env.get("FUGLE_API_KEY");
  if (!apiKey) {
    console.error(JSON.stringify({ status: "blocked", code: "REQUIRED_SECRET_UNAVAILABLE", secretName: "FUGLE_API_KEY", secretValueLogged: false }));
    Deno.exit(3);
  }
  const symbol = options.symbol?.trim();
  if (!symbol || !/^\d{4,6}$/.test(symbol)) throw new Error("SYMBOL_REQUIRED");
  const from = validateIsoDate(options.from, "FROM");
  const to = validateIsoDate(options.to, "TO");
  const market = options.market || "TWSE";
  const query = new URLSearchParams({ from, to, timeframe: "D", adjusted: "true", fields: "open,high,low,close,volume,turnover,change", sort: "asc" });
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${symbol}?${query}`;
  const fetchedAt = new Date().toISOString();
  const payload = await fetchJson(url, { "X-API-KEY": apiKey });
  const sourceHash = await sha256Hex(payload);
  const result = parseFugleHistoricalCandles(payload, { fetchedAt, sourceRef: url, sourceHash, symbol, market, adjusted: true });
  await Deno.mkdir(`${options.output}/raw`, { recursive: true });
  await writeJson(`${options.output}/raw/fugle-${symbol}-${from}-${to}.json`, payload);
  await writeNdjson(`${options.output}/daily-prices.ndjson`, result.rows);
  await writeJson(`${options.output}/manifest.json`, {
    manifestVersion: "SIGNAL_LAB_DATASET_MANIFEST_V1",
    acquisitionMode: "fugle-history",
    acquiredAt: fetchedAt,
    researchUseOnly: true,
    commercialLicense: "LEGAL_REVIEW_REQUIRED",
    productionImported: false,
    sourceHash,
    counts: { bars: result.rows.length },
    adapterIssues: result.issues,
  });
  console.log(JSON.stringify({ output: options.output, bars: result.rows.length, issueCodes: result.issues.map((entry) => entry.code) }, null, 2));
}

const options = cliOptions(Deno.args);
if (options.source === "official-latest") await acquireOfficialLatest(options);
else await acquireFugleHistory(options);
