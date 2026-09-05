#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(args) {
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const dataset = resolve(valueFor("--dataset") || "/tmp/morning-alpha-signal-lab-official-latest");
  const database = resolve(valueFor("--database") || "/tmp/morning-alpha-signal-lab-research.sqlite");
  if (!dataset.startsWith("/tmp/") || !database.startsWith("/tmp/")) throw new Error("RESEARCH_STORAGE_MUST_BE_ISOLATED_UNDER_TMP");
  return { dataset, database };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readNdjson(path) {
  const content = readFileSync(path, "utf8").trim();
  return content ? content.split("\n").map((line) => JSON.parse(line)) : [];
}

const { dataset, database } = parseArgs(process.argv.slice(2));
const manifest = readJson(`${dataset}/manifest.json`);
if (manifest.productionImported !== false || manifest.researchUseOnly !== true) throw new Error("DATASET_ISOLATION_CONTRACT_MISSING");
const prices = readNdjson(`${dataset}/daily-prices.ndjson`);
const institutions = readNdjson(`${dataset}/institutional-flows.ndjson`);
const taiexPartial = readNdjson(`${dataset}/taiex-partial.ndjson`);

const db = new DatabaseSync(database);
db.exec(`
  pragma journal_mode = WAL;
  create table if not exists dataset_manifests (
    manifest_version text not null,
    acquired_at text not null,
    source_hashes_json text not null,
    quality_json text not null,
    manifest_json text not null,
    primary key (manifest_version, acquired_at)
  );
  create table if not exists daily_prices (
    provider text not null,
    source_dataset text not null,
    market text not null,
    symbol text not null,
    trading_date text not null,
    open real not null,
    high real not null,
    low real not null,
    close real not null,
    volume real not null,
    turnover real,
    adjusted_close real,
    adjustment_status text not null,
    available_at text not null,
    source_ref text not null,
    source_hash text,
    primary key (provider, source_dataset, symbol, trading_date, available_at)
  );
  create table if not exists institutional_flows (
    provider text not null,
    source_dataset text not null,
    market text not null,
    symbol text not null,
    trading_date text not null,
    institution_type text not null,
    buy_volume real,
    sell_volume real,
    net_volume real not null,
    market_volume real,
    average_volume_20d real,
    average_turnover_20d real,
    available_at text not null,
    source_ref text not null,
    source_hash text,
    primary key (provider, source_dataset, symbol, trading_date, institution_type, available_at)
  );
  create table if not exists taiex_partial_observations (
    provider text not null,
    source_dataset text not null,
    symbol text not null,
    trading_date text not null,
    open real not null,
    high real not null,
    low real not null,
    close real not null,
    volume real,
    available_at text not null,
    source_ref text not null,
    source_hash text,
    ready_for_signal integer not null check (ready_for_signal in (0, 1)),
    primary key (provider, source_dataset, symbol, trading_date, available_at)
  );
`);

const insertManifest = db.prepare(`
  insert or ignore into dataset_manifests
    (manifest_version, acquired_at, source_hashes_json, quality_json, manifest_json)
  values (?, ?, ?, ?, ?)
`);
const insertPrice = db.prepare(`
  insert or ignore into daily_prices
    (provider, source_dataset, market, symbol, trading_date, open, high, low, close, volume, turnover, adjusted_close, adjustment_status, available_at, source_ref, source_hash)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertInstitution = db.prepare(`
  insert or ignore into institutional_flows
    (provider, source_dataset, market, symbol, trading_date, institution_type, buy_volume, sell_volume, net_volume, market_volume, average_volume_20d, average_turnover_20d, available_at, source_ref, source_hash)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTaiex = db.prepare(`
  insert or ignore into taiex_partial_observations
    (provider, source_dataset, symbol, trading_date, open, high, low, close, volume, available_at, source_ref, source_hash, ready_for_signal)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.exec("begin immediate");
try {
  insertManifest.run(manifest.manifestVersion, manifest.acquiredAt, JSON.stringify(manifest.sourceHashes || {}), JSON.stringify(manifest.quality || {}), JSON.stringify(manifest));
  for (const row of prices) insertPrice.run(
    row.provider, row.sourceDataset, row.market, row.symbol, row.tradingDate, row.open, row.high, row.low, row.close,
    row.volume, row.turnover, row.adjustedClose, row.adjustmentStatus, row.availableAt, row.sourceRef, row.sourceHash,
  );
  for (const row of institutions) insertInstitution.run(
    row.provider, row.sourceDataset, row.market, row.symbol, row.tradingDate, row.institutionType, row.buyVolume,
    row.sellVolume, row.netVolume, row.marketVolume, row.averageVolume20d, row.averageTurnover20d, row.availableAt,
    row.sourceRef, row.sourceHash,
  );
  for (const row of taiexPartial) insertTaiex.run(
    row.provider, row.sourceDataset, row.symbol, row.tradingDate, row.open, row.high, row.low, row.close, row.volume,
    row.availableAt, row.sourceRef, row.sourceHash, row.readyForSignal ? 1 : 0,
  );
  db.exec("commit");
} catch (error) {
  db.exec("rollback");
  throw error;
}

const counts = Object.fromEntries(["dataset_manifests", "daily_prices", "institutional_flows", "taiex_partial_observations"].map((table) => [table, db.prepare(`select count(*) as count from ${table}`).get().count]));
db.close();
console.log(JSON.stringify({ database, isolatedResearchOnly: true, productionWritten: false, counts }, null, 2));
