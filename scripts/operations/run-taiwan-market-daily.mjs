#!/usr/bin/env node
/** Daily official-universe preparation and optional private staging.
 * Default: public acquisition + local immutable artifacts. No credential lookup,
 * reviewer verdict, source-use approval, publication, or automatic RPC retry.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hostname } from 'node:os';
import { readFile, writeFile, mkdir, readdir, rename, open, unlink, stat } from 'node:fs/promises';
import { resolve, dirname, relative, join, isAbsolute, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { coveredCalendarDate, isMarketTradingDate, previousMarketTradingDate,
  MARKET_CALENDAR_VERSION } from '../../supabase/functions/_shared/market-session-contract.mjs';
import { TAIWAN_COMPANY_SOURCES, marketSnapshotHash, normalizeOfficialCompanyCapture,
  buildTaiwanMarketUniverse, planTaiwanMarketAnalysis, verifyTaiwanMarketCompletion } from '../../research/taiwan-market-universe.mjs';
import { normalizeTaiwanMarketFacts,addTaiwanMonthlyRevenueCapture } from '../../research/taiwan-market-facts.mjs';
import { runTaiwanMarketResearch } from '../../research/taiwan-market-research.mjs';
import {loadTaiwanFinancialHistory,loadTaiwanResearchHistory} from '../../research/taiwan-market-financial-inputs.mjs';
import {addTaiwanLatestHistoryQuotes,addTaiwanTwseDatedValuation} from '../../research/taiwan-market-postclose.mjs';
import {buildTaiwanMarketActionCoverage} from '../../research/taiwan-market-actions.mjs';
import {refreshTaiwanMarketInputs,loadTaiwanDailyInputManifest} from '../../research/taiwan-market-input-cache.mjs';
import {prepareDailyAiMarketPriceInputChunks,prepareDailyAiMarketPriceReferenceBatches,stageDailyAiMarketPricePrepared,
 runDailyAiMarketShardWithReferences} from '../../research/daily-ai-market-references-stage.mjs';
import { compareTime, validObservationTime } from '../../src/features/vnext/contracts.ts';
import { prepareDailyAiMarketCapture, stageDailyAiMarketCapture, stageDailyAiMarketWorkPlan,
  runDailyAiMarketShard, finishDailyAiMarketEdition } from '../../research/daily-ai-market-stage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error('TAIWAN_DAILY_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = value => typeof value === 'string' && validObservationTime(value);
const taipeiDate = value => new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 10);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const snapshotSchema = 'TAIWAN_MARKET_DAILY_SNAPSHOT_V1';
export const TAIWAN_DAILY_LIMITS = Object.freeze({ download_concurrency: 1, download_timeout_ms: 40_000,
  source_bytes: 16_000_000, daily_raw_bytes: 128_000_000, retained_raw_bytes: 512_000_000,
  input_bytes: 256_000_000, artifact_bytes: 256_000_000, shard_bytes: 16_000_000,
  capture_count: 1_000, sources: 100, invocation_ms: 40 * 60_000, shards_per_invocation: 64,
  minimum_download_gap_ms: 1_000, rpc_deadline_ms: 90_000 });

/** Same calendar and 17:05 daily-data boundary as the existing price calculator. */
export function taiwanDailyCalendar(at) {
  if (!instant(at)) fail('CLOCK');
  const day = taipeiDate(at), covered = coveredCalendarDate('TW', day), trading = covered && isMarketTradingDate('TW', day);
  const expected = !covered ? null : trading && Date.parse(at) >= Date.parse(day + 'T17:05:00+08:00')
    ? day : previousMarketTradingDate('TW', day);
  return { calendar_version: MARKET_CALENDAR_VERSION, business_date: day, calendar_covered: covered,
    is_trading_day: trading, expected_quote_date: expected, daily_session_complete_after: '17:05:00+08:00',
    state: !covered || !expected ? 'CALENDAR_UNCOVERED' : trading ? 'TRADING_DAY' : 'MARKET_CLOSED' };
}

async function readBounded(path, limit) {
  const size = (await stat(path)).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > limit) fail('FILE_SIZE');
  const bytes = await readFile(path); if (bytes.length !== size || bytes.length > limit) fail('FILE_CHANGED'); return bytes;
}
async function readJson(path, limit = 2_000_000) { return JSON.parse((await readBounded(path, limit)).toString('utf8')); }
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp', handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
async function immutableBytes(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if (!(await readFile(path)).equals(bytes)) fail('IMMUTABLE_ARTIFACT_CONFLICT'); }
}
function localFile(root, file) {
  if (typeof file !== 'string' || !file || isAbsolute(file)) fail('ARTIFACT_PATH');
  const path = resolve(root, file), rel = relative(root, path);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) fail('ARTIFACT_PATH'); return path;
}
async function artifact(root, file, value, limit = TAIWAN_DAILY_LIMITS.artifact_bytes) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'); if (bytes.length > limit) fail('ARTIFACT_SIZE');
  await immutableBytes(localFile(root, file), bytes); return { file, sha256: sha(bytes), bytes: bytes.length };
}
async function readArtifact(root, descriptor) {
  if (!object(descriptor) || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes > TAIWAN_DAILY_LIMITS.artifact_bytes) fail('ARTIFACT_DESCRIPTOR');
  const bytes = await readBounded(localFile(root, descriptor.file), descriptor.bytes);
  if (bytes.length !== descriptor.bytes || sha(bytes) !== descriptor.sha256) fail('ARTIFACT_HASH'); return JSON.parse(bytes.toString('utf8'));
}
async function lockRoot(root) {
  const path = join(root, 'daily-run.lock'); await mkdir(root, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, hostname: hostname(), started_at: new Date().toISOString() }));
      await handle.close(); return async () => { await unlink(path); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = await readJson(path, 4_000);
      if (attempt || prior.hostname !== hostname() || !Number.isSafeInteger(prior.pid)) fail('ALREADY_RUNNING_OR_FOREIGN_LOCK');
      try { process.kill(prior.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') { await unlink(path); continue; } throw probe; }
      fail('ALREADY_RUNNING');
    }
  }
  fail('LOCK');
}

/** One selected allowlisted URL, one child process, one HTTP attempt. */
export async function captureOfficialTaiwanSource({ source, directory }) {
  try {
    const result = await execute('python3', [join(ROOT, 'scripts/operations/acquire-taiwan-market.py'),
      '--source', source.id, '--output', directory], { cwd: ROOT, timeout: TAIWAN_DAILY_LIMITS.download_timeout_ms,
      maxBuffer: 128_000, killSignal: 'SIGKILL', encoding: 'utf8' });
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    // The acquisition command exits 2 for a recorded provider/data failure.
    if (error.code === 2 && typeof error.stdout === 'string' && error.stdout.trim()) return JSON.parse(error.stdout.trim());
    throw Error('TAIWAN_DAILY_CAPTURE_PROCESS_UNCONFIRMED');
  }
}
async function receiptFiles(directory) {
  let files; try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  files = files.filter(file => /^acquisition-[\w.-]+\.json$/.test(file)).sort();
  if (files.length > 1_000) fail('ACQUISITION_FILE_LIMIT');
  const receipts = [];
  for (const file of files) {
    const document = await readJson(join(directory, file));
    if (document.schema !== 'TAIWAN_PUBLIC_ACQUISITION_V1' || !Array.isArray(document.receipts)) fail('ACQUISITION_DOCUMENT');
    receipts.push(...document.receipts);
  }
  return receipts;
}
function checkReceipt(receipt, source, at) {
  if (!object(receipt) || receipt.schema !== 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' || receipt.source_id !== source.id
    || receipt.url !== source.url || receipt.format !== source.format || !['CAPTURED', 'UNAVAILABLE'].includes(receipt.state)
    || !instant(receipt.started_at) || !instant(receipt.received_at) || compareTime(receipt.started_at, receipt.received_at) > 0
    || compareTime(receipt.received_at, at) > 0 || receipt.historical_knowledge === true) fail('SOURCE_RECEIPT');
  if (receipt.state === 'CAPTURED' && (receipt.status !== 200 || !/^[a-f0-9]{64}$/.test(receipt.sha256)
    || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1 || receipt.bytes > source.byte_limit || typeof receipt.raw_path !== 'string')) fail('CAPTURE_RECEIPT');
}
const fingerprint = receipt => marketSnapshotHash({ source_id: receipt.source_id, url: receipt.url, format: receipt.format, sha256: receipt.sha256 });
const captureId = receipt => marketSnapshotHash({ source_id: receipt.source_id, url: receipt.url, source_sha256: receipt.sha256, received_at: receipt.received_at });
async function storedCapture(root, entry) {
  if (!object(entry) || entry.receipt_hash !== marketSnapshotHash(entry.receipt)) fail('RETAINED_RECEIPT_HASH');
  const bytes = await readBounded(localFile(root, entry.raw_file), TAIWAN_DAILY_LIMITS.source_bytes);
  if (bytes.length !== entry.receipt.bytes || sha(bytes) !== entry.receipt.sha256) fail('RETAINED_RAW_HASH');
  return { receipt: entry.receipt, bytes };
}
async function retainCapture(root, receipt, rawPath = receipt.raw_path, recoveryDirectory = null) {
  let bytes;
  try { bytes = await readBounded(rawPath, TAIWAN_DAILY_LIMITS.source_bytes); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Paths inside the original receipt are immutable provenance. A restored
    // archive can find the same bytes locally without rewriting that receipt.
    const objectPath = localFile(root, 'objects/' + receipt.sha256 + '.' + (receipt.format === 'csv' ? 'csv' : 'json'));
    try { bytes = await readBounded(objectPath, TAIWAN_DAILY_LIMITS.source_bytes); }
    catch (missing) {
      if (missing.code !== 'ENOENT' || !recoveryDirectory) throw missing;
      bytes = await readBounded(join(recoveryDirectory, 'raw', basename(rawPath)), TAIWAN_DAILY_LIMITS.source_bytes);
    }
  }
  if (bytes.length !== receipt.bytes || sha(bytes) !== receipt.sha256) fail('RAW_HASH');
  const raw_file = 'objects/' + receipt.sha256 + '.' + (receipt.format === 'csv' ? 'csv' : 'json');
  await immutableBytes(localFile(root, raw_file), bytes);
  return { receipt, receipt_hash: marketSnapshotHash(receipt), raw_file };
}
async function codeBinding() {
  const files = ['scripts/operations/run-taiwan-market-daily.mjs', 'scripts/operations/acquire-taiwan-market.py',
    'research/taiwan-market-universe.mjs', 'research/taiwan-market-facts.mjs', 'research/taiwan-market-research.mjs',
    'research/taiwan-market-financial-inputs.mjs','research/taiwan-market-long-price.mjs','research/taiwan-market-bvps.mjs',
    'research/taiwan-market-postclose.mjs','research/taiwan-market-price-reference.mjs',
    'research/taiwan-market-actions.mjs','research/daily-ai-market-references-stage.mjs','research/daily-ai-market-stage.mjs',
    'research/taiwan-market-input-cache.mjs','scripts/operations/refresh-taiwan-market-sources.py',
    'research/taiwan-market-financial-csv.py','research/taiwan-market-financial-history.py','research/taiwan-market-history.mjs',
    'supabase/functions/_shared/market-session-contract.mjs', 'supabase/functions/_shared/market-calendar-data.json',
    'src/features/vnext/contracts.ts'];
  return marketSnapshotHash(Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(join(ROOT, file)))]))));
}
function safeError(error) {
  return typeof error?.message === 'string' && /^(?:TAIWAN_|DAILY_AI_MARKET_STAGE_)[A-Z0-9_]+$/.test(error.message)
    ? error.message : 'TAIWAN_DAILY_LOCAL_OPERATION_FAILED';
}
async function readResearchInput(name,file){
 const input=await readJson(file,TAIWAN_DAILY_LIMITS.input_bytes);
 if(name==='financial_history'&&['TAIWAN_FINANCIAL_CSV_MANIFEST_V1','TAIWAN_FINANCIAL_INPUT_SET_V1'].includes(input.schema))return loadTaiwanFinancialHistory(file);
 if(name==='history'&&input.schema==='TAIWAN_HISTORY_CHECKPOINT_V1')return loadTaiwanResearchHistory(file);
 if(name==='corporate_action_sources'){
  if(input.schema!=='TAIWAN_ACTION_ORIGINAL_CAPTURE_SET_V1'||!Array.isArray(input.captures)||input.captures.length!==3)fail('ACTION_SOURCES');
  const captures=[];for(const item of input.captures){const bytes=await readBounded(resolve(dirname(file),item.raw_path),TAIWAN_DAILY_LIMITS.source_bytes);
   captures.push({receipt:item.receipt,source_bytes_base64:bytes.toString('base64')});}
  return {schema:'TAIWAN_ACTION_ORIGINAL_CAPTURE_BYTES_V1',captures};
 }
 return input;
}
function freshnessReport(facts, calendar) {
  return { ...calendar, source_time_basis: 'EARLIEST_RETAINED_EXACT_BYTES_WITH_SEPARATE_CURRENT_OBSERVATION',
    markets: ['TWSE', 'TPEX', 'EMERGING'].map(market => {
      const stocks = facts.securities.filter(stock => stock.company.market === market), dates = new Map();
      let missing = 0, current = 0, stale = 0;
      for (const stock of stocks) {
        const quotes = stock.observations.filter(row => row.family === 'PRICE' && !row.invalidated && row.valid_trade);
        const quote = quotes.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
        if (!quote?.date) { missing++; continue; }
        dates.set(quote.date, (dates.get(quote.date) ?? 0) + 1);
        if (quote.date === calendar.expected_quote_date) current++; else stale++;
      }
      return { market, securities: stocks.length, expected_quote_date: calendar.expected_quote_date,
        current_quote: current, other_quote_date: stale, no_valid_quote: missing,
        actual_quote_dates: [...dates].sort().map(([date, securities]) => ({ date, securities })) };
    }) };
}
async function importRetainedCaptures(root, file, cutoff) {
  if (!file) return [];
  const manifest = await readJson(file, 8_000_000);
  if (manifest.schema !== 'TAIWAN_RETAINED_CAPTURES_V1' || !Array.isArray(manifest.captures)
    || manifest.captures.length > TAIWAN_DAILY_LIMITS.capture_count) fail('RETAINED_MANIFEST');
  const entries = [], seen = new Set(); let total = 0;
  for (const item of manifest.captures) {
    if (!object(item) || !object(item.receipt) || typeof item.raw_path !== 'string') fail('RETAINED_CAPTURE');
    const r = item.receipt;
    if (!instant(r.received_at) || compareTime(r.received_at, cutoff) > 0) fail('RETAINED_CAPTURE_TIME');
    const entry = await retainCapture(root, r, resolve(dirname(file), item.raw_path));
    const captured = await storedCapture(root, entry); prepareDailyAiMarketCapture(captured);
    const id = captureId(r); if (seen.has(id)) fail('RETAINED_CAPTURE_DUPLICATE'); seen.add(id);
    total += r.bytes; if (total > TAIWAN_DAILY_LIMITS.retained_raw_bytes) fail('RETAINED_TOTAL_BYTES'); entries.push(entry);
  }
  return entries;
}
function captureProof(shards, entries,priceInputs={}) {
  const byId = new Map(entries.map(entry => [captureId(entry.receipt), entry]));
  const required = new Set(), missing = new Set();
  const sourceBindings=[];
  const walk=value=>{if(Array.isArray(value)){value.forEach(walk);return;}if(!object(value))return;
   if(value.capture_id&&value.source_sha256){sourceBindings.push(value);return;}Object.values(value).forEach(walk);};
  for (const shard of shards) for (const stock of shard.stocks) for (const evidence of stock.packet.evidence) walk(JSON.parse(evidence.content));
  walk(priceInputs);
  for(const source of sourceBindings){
    if (!object(source) || typeof source.capture_id !== 'string') fail('EVIDENCE_CAPTURE_BINDING');
    required.add(source.capture_id); const r = byId.get(source.capture_id)?.receipt;
    if (!r) { missing.add(source.capture_id); continue; }
    if (source.source_id !== r.source_id || source.source_url !== r.url || source.source_sha256 !== r.sha256
      || source.source_bytes !== r.bytes || source.received_at !== r.received_at) fail('EVIDENCE_CAPTURE_MISMATCH');
  }
  return { required_capture_ids: [...required].sort(), missing_capture_ids: [...missing].sort(),
    state: missing.size ? 'MISSING_RETAINED_RAW_CAPTURE' : 'COMPLETE_RAW_CAPTURE_BINDING' };
}

/** Dependency injection is for a reviewed server adapter or local SQL test.
 * Supplying an RPC does not grant execution: stage must also be explicitly true.
 */
export async function runTaiwanMarketDaily(options, dependencies = {}) {
  const { clock = () => new Date().toISOString(), pause = sleep, acquire = captureOfficialTaiwanSource,
    refreshInputs = refreshTaiwanMarketInputs, rpc = null, onProgress = () => {} } = dependencies;
  const { output, slot, businessDate = null, acquisitionDir = null, historyFile = null, financialHistoryFile = null,
    retainedCapturesFile = null, actionsSourceManifestFile=null,stage = false, resume = false, workerRef = 'taiwan-market-daily',
    inputCacheDir=null,inputManifestFile=null,inputSeedManifestFile=null,allowInputNetwork=true,
    maxShards = TAIWAN_DAILY_LIMITS.shards_per_invocation } = options;
  if (typeof output !== 'string' || !output || !['PREMARKET', 'POSTCLOSE'].includes(slot)
    || !Number.isSafeInteger(maxShards) || maxShards < 1 || maxShards > 128 || stage && typeof rpc !== 'function') fail('OPTIONS');
  if(inputCacheDir&&inputManifestFile||(inputCacheDir||inputManifestFile)&&(historyFile||financialHistoryFile||actionsSourceManifestFile||retainedCapturesFile)
    ||inputSeedManifestFile&&!inputCacheDir||typeof allowInputNetwork!=='boolean')fail('INPUT_MODE');
  const root = resolve(output), unlock = await lockRoot(root), began = performance.now();
  let state, save, statePath;
  try {
    const at = clock(), calendar = taiwanDailyCalendar(at), date = businessDate ?? calendar.business_date;
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) fail('BUSINESS_DATE');
    const key = date + '/' + slot, prefix = 'snapshots/' + key;
    statePath = localFile(root, prefix + '/state.json');
    const catalog = await readJson(join(ROOT, 'research/taiwan-market-sources.json'));
    if (catalog.schema !== 'TAIWAN_OFFICIAL_DATASET_CATALOG_V1') fail('CATALOG');
    const sources = [...Object.entries(TAIWAN_COMPANY_SOURCES).map(([id, source]) => ({ id, ...source, byte_limit: 8_000_000 })),
      ...catalog.sources.filter(source => source.group === 'daily')];
    if (sources.length > TAIWAN_DAILY_LIMITS.sources || new Set(sources.map(source => source.id)).size !== sources.length) fail('SOURCE_LIST');
    const config = { catalog_hash: marketSnapshotHash(catalog), code_hash: await codeBinding(), selected_sources: sources.map(source => source.id),
      input_mode:inputCacheDir?'DAILY_CACHE_REFRESH':inputManifestFile?'RETAINED_INPUT_MANIFEST':'EXPLICIT_INPUT_FILES',allow_input_network:allowInputNetwork };
    try { state = await readJson(statePath, 8_000_000); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (state) {
      if (state.schema !== snapshotSchema || state.snapshot_key !== key || state.business_date !== date || state.slot !== slot
        || marketSnapshotHash(state.config) !== marketSnapshotHash(config)) fail('SNAPSHOT_CONFIG_DRIFT');
      for (const [name, file] of Object.entries({ history: historyFile, financial_history: financialHistoryFile,corporate_action_sources:actionsSourceManifestFile })) {
        if (!file) continue;
        if (!state.inputs[name] || marketSnapshotHash(await readArtifact(root, state.inputs[name]))
          !== marketSnapshotHash(await readResearchInput(name,file))) fail('SNAPSHOT_INPUT_DRIFT');
      }
    } else {
      if (date !== calendar.business_date) fail('NEW_SNAPSHOT_CANNOT_BACKDATE');
      state = { schema: snapshotSchema, snapshot_key: key, business_date: date, slot, created_at: at, updated_at: at,
        config, calendar, acquisition_mode: acquisitionDir ? 'RETAINED_CAPTURE_IMPORT_NO_PROVIDER_CALL' : 'OFFICIAL_PUBLIC_ACQUISITION',
        state: calendar.state === 'TRADING_DAY' ? 'ACQUIRING' : calendar.state === 'MARKET_CLOSED' ? 'SKIPPED_MARKET_CLOSED' : 'BLOCKED_CALENDAR_UNCOVERED',
        acquisition: {}, selected: {}, inputs: {}, extra_captures: [], artifacts: null, stage: null,
        review_required: true, member_published: false, methodology_approved: false };
    }
    save = async () => { state.updated_at = clock(); await atomicJson(statePath, state); };
    await save();
    const finish = () => ({ schema: 'TAIWAN_MARKET_DAILY_RESULT_V1', snapshot_key: key, state: state.state,
      snapshot_file: statePath, cutoff: state.cutoff ?? null, expires_at: state.expires_at ?? null,
      expired: state.expires_at ? compareTime(state.expires_at, clock()) <= 0 : false, universe: state.counts ?? null,
      failed_sources: Object.values(state.acquisition).filter(item => item.receipt?.state === 'UNAVAILABLE').map(item => ({ source_id: item.receipt.source_id, error: item.receipt.error ?? 'UNAVAILABLE' })),
      preparation: state.artifacts, staging: state.stage ? { edition_id: state.stage.finish?.outcome?.edition_id ?? null,
        completed_shards: state.stage.shards.filter(item => item.outcome?.state === 'STAGED').length,
        blocked: state.stage.blocked ?? null } : null, review_required: true, member_published: false, methodology_approved: false });
    if (state.state.startsWith('SKIPPED_') || state.state.startsWith('BLOCKED_CALENDAR') || state.state === 'BLOCKED_ACQUISITION') return finish();
    if (!state.artifacts) {
      if (date !== taipeiDate(clock())) fail('UNFINISHED_SNAPSHOT_CANNOT_ACQUIRE_ON_ANOTHER_DATE');
      for (const [name, file] of Object.entries({ history: historyFile, financial_history: financialHistoryFile,corporate_action_sources:actionsSourceManifestFile })) {
        if (file && !state.inputs[name]) {
          const value = await readResearchInput(name,file);
          const collection = name === 'history' ? 'stocks' : name === 'corporate_action_sources' ? 'captures' : 'records';
          if (!object(value) || !Array.isArray(value[collection])) fail('HISTORY_INPUT_SHAPE');
          state.inputs[name] = await artifact(root, prefix + '/inputs/' + name + '.json', value); await save();
        }
      }
      const imported = acquisitionDir ? await receiptFiles(resolve(acquisitionDir)) : null;
      let total = Object.values(state.acquisition).reduce((sum, item) => sum + (item.receipt?.bytes ?? 0), 0), networkCalls = 0;
      for (const source of sources) {
        if (state.acquisition[source.id]?.state === 'RECORDED') continue;
        if (performance.now() - began > TAIWAN_DAILY_LIMITS.invocation_ms) { state.state = 'ACQUISITION_PAUSED_RESOURCE_LIMIT'; await save(); return finish(); }
        const directory = localFile(root, prefix + '/acquisition/' + source.id), previous = state.acquisition[source.id];
        const startedAt = previous?.started_at ?? clock();
        state.acquisition[source.id] = { state: 'IN_FLIGHT', started_at: startedAt }; await save();
        let receipt;
        if (imported) {
          receipt = imported.filter(r => r.source_id === source.id).sort((a, b) => compareTime(b.received_at, a.received_at))[0];
          if (!receipt) receipt = { schema: 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', source_id: source.id, url: source.url,
            format: source.format, state: 'UNAVAILABLE', attempts: 0, started_at: startedAt, received_at: clock(),
            error: 'SELECTED_SOURCE_NOT_IN_RETAINED_IMPORT', historical_knowledge: false };
        } else if (previous?.state === 'IN_FLIGHT') {
          const found = (await receiptFiles(directory)).filter(r => r.source_id === source.id && compareTime(r.started_at, startedAt) >= 0);
          if (found.length > 1) fail('AMBIGUOUS_INTERRUPTED_CAPTURE'); receipt = found[0];
          if (!receipt) receipt = { schema: 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', source_id: source.id, url: source.url,
            format: source.format, state: 'UNAVAILABLE', attempts: 1, started_at: startedAt, received_at: clock(),
            error: 'INTERRUPTED_CAPTURE_NO_VERIFIED_RECEIPT_NO_RETRY', historical_knowledge: false };
        } else {
          if (networkCalls++) await pause(TAIWAN_DAILY_LIMITS.minimum_download_gap_ms);
          try { receipt = await acquire({ source, directory }); }
          catch {
            receipt = { schema: 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', source_id: source.id, url: source.url,
              format: source.format, state: 'UNAVAILABLE', attempts: 1, started_at: startedAt, received_at: clock(),
              error: 'CAPTURE_PROCESS_UNCONFIRMED_NO_RETRY', historical_knowledge: false };
          }
        }
        checkReceipt(receipt, source, clock());
        if (receipt.state === 'CAPTURED') {
          total += receipt.bytes; if (total > TAIWAN_DAILY_LIMITS.daily_raw_bytes) fail('DAILY_TOTAL_BYTES');
          const observed = await retainCapture(root, receipt, receipt.raw_path, acquisitionDir ? resolve(acquisitionDir) : directory), fingerprintKey = fingerprint(receipt);
          const indexPath = localFile(root, 'capture-index/' + fingerprintKey.slice(0, 2) + '/' + fingerprintKey + '.json');
          let prior;
          try { prior = await readJson(indexPath, 40_000); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (prior) { const p = await storedCapture(root, prior); checkReceipt(p.receipt, source, clock()); if (fingerprint(p.receipt) !== fingerprintKey) fail('INDEX_IDENTITY'); }
          const selected = prior && compareTime(prior.receipt.received_at, receipt.received_at) <= 0 ? prior : observed;
          if (selected !== prior) await atomicJson(indexPath, selected);
          state.selected[source.id] = selected;
          state.acquisition[source.id] = { state: 'RECORDED', receipt, observation: observed,
            evidence_capture_id: captureId(selected.receipt), observation_capture_id: captureId(receipt),
            reused_earlier_receipt: selected.receipt.received_at !== receipt.received_at };
        } else state.acquisition[source.id] = { state: 'RECORDED', receipt };
        await save(); onProgress({ phase: 'ACQUISITION', source_id: source.id, state: receipt.state,
          completed: Object.keys(state.acquisition).length, total: sources.length });
      }
      if (Object.keys(TAIWAN_COMPANY_SOURCES).some(id => !state.selected[id])) {
        state.state = 'BLOCKED_ACQUISITION'; state.reason = 'THREE_CURRENT_OFFICIAL_ROSTER_CAPTURES_REQUIRED'; await save(); return finish();
      }
      const captures = [];
      for (const selected of Object.values(state.selected)) captures.push(await storedCapture(root, selected));
      const rosters = captures.filter(c => Object.hasOwn(TAIWAN_COMPANY_SOURCES, c.receipt.source_id)).map(normalizeOfficialCompanyCapture);
      let universe=state.refresh_universe?await readArtifact(root,state.refresh_universe):null;
      if(inputCacheDir||inputManifestFile){
       if(!universe){universe=buildTaiwanMarketUniverse({rosters,formed_at:clock()});
        state.refresh_universe=await artifact(root,prefix+'/inputs/refresh-universe.json',universe);await save();}
       if(!state.input_refresh?.complete){
        const updated=inputManifestFile?await loadTaiwanDailyInputManifest(inputManifestFile):await refreshInputs({
         cacheDir:resolve(inputCacheDir),universeFile:localFile(root,state.refresh_universe.file),
         acquisitionDir:acquisitionDir?resolve(acquisitionDir):localFile(root,prefix+'/acquisition'),slot,seedManifestFile:inputSeedManifestFile,allowNetwork:allowInputNetwork},{clock,pause});
        if(!['INPUTS_READY_WITH_SOURCE_LIMITATIONS','INPUTS_READY_REVIEW_REQUIRED'].includes(updated?.state)
         ||!/^[a-f0-9]{64}$/.test(updated.manifest_hash??''))fail('INPUT_REFRESH_RESULT');
        for(const [name,file]of Object.entries({history:updated.history_file,financial_history:updated.financial_history_file,
         corporate_action_sources:updated.actions_source_manifest_file}))if(file){
          const value=await readResearchInput(name,file),collection=name==='history'?'stocks':name==='corporate_action_sources'?'captures':'records';
          if(!object(value)||!Array.isArray(value[collection]))fail('HISTORY_INPUT_SHAPE');
          if(state.inputs[name]&&marketSnapshotHash(await readArtifact(root,state.inputs[name]))!==marketSnapshotHash(value))fail('SNAPSHOT_INPUT_DRIFT');
          state.inputs[name]=await artifact(root,prefix+'/inputs/'+name+'.json',value);await save();
        }
        state.extra_captures=await importRetainedCaptures(root,updated.retained_captures_file,clock());
        state.input_refresh={complete:true,manifest_hash:updated.manifest_hash,state:updated.state,
         provider_requests:updated.provider_requests??0,issues:updated.issues,receipt:await artifact(root,prefix+'/inputs/refresh-receipt.json',updated)};
        await save();onProgress({phase:'INPUT_REFRESH',state:updated.state,manifest_hash:updated.manifest_hash,counts:updated.counts,
         provider_requests:updated.provider_requests??0});
       }
      }
      const cutoff = state.cutoff ?? clock(), frozenCalendar = taiwanDailyCalendar(cutoff);
      if (frozenCalendar.business_date !== date || frozenCalendar.state !== 'TRADING_DAY') fail('CUTOFF_DATE_OR_CALENDAR_CHANGED');
      state.cutoff = cutoff; state.calendar = frozenCalendar;
      state.expires_at ??= new Date(Date.parse(cutoff) + 24 * 3_600_000).toISOString();
      if(!inputCacheDir&&!inputManifestFile)state.extra_captures = await importRetainedCaptures(root, retainedCapturesFile, cutoff);
      await save();universe??=buildTaiwanMarketUniverse({ rosters, formed_at: cutoff });
      const plan = planTaiwanMarketAnalysis({ universe, business_date: date, cutoff, shard_size: 64 });
      let facts = normalizeTaiwanMarketFacts({ universe, catalog, captures, cutoff });
      for(const entry of state.extra_captures)if(/^MOPS_REVENUE_TWSE_\d{6}_CSV$/.test(entry.receipt.source_id)){
        const capture=await storedCapture(root,entry);facts=addTaiwanMonthlyRevenueCapture({facts,...capture,cutoff});
      }
      const history = state.inputs.history ? await readArtifact(root, state.inputs.history) : null;
      const financial_history = state.inputs.financial_history ? await readArtifact(root, state.inputs.financial_history) : null;
      if(history)facts=addTaiwanLatestHistoryQuotes({facts,history,cutoff});
      for(const entry of state.extra_captures)if(/^TWSE_VALUATION_\d{8}$/.test(entry.receipt.source_id)){
        facts=addTaiwanTwseDatedValuation({facts,...await storedCapture(root,entry),cutoff});
      }
      let corporate_actions=null;
      if(state.inputs.corporate_action_sources){const source=await readArtifact(root,state.inputs.corporate_action_sources);
       const captures=source.captures.map(c=>({receipt:c.receipt,bytes:Buffer.from(c.source_bytes_base64,'base64')}));
       const from=captures.map(c=>c.receipt.from).sort().at(-1);
       corporate_actions=buildTaiwanMarketActionCoverage({universe,captures,from,through:date,cutoff});}
      const run = runTaiwanMarketResearch({ universe, plan, facts, history, financial_history,
        corporate_actions, expected_quote_date: frozenCalendar.expected_quote_date });
      if (run.analysis_origin !== 'DETERMINISTIC_SCREENING' || run.methodology_approved !== false || run.member_published !== false) fail('RESEARCH_GATE');
      const completion = verifyTaiwanMarketCompletion(plan, run.shards);
      if (completion.state !== 'ALL_SECURITIES_ANALYZED') fail('INCOMPLETE_ANALYSIS');
      const shards = [];
      for (const shard of run.shards) shards.push({ shard_id: shard.shard_id,
        artifact: await artifact(root, prefix + '/shards/' + shard.shard_id + '.json', shard, TAIWAN_DAILY_LIMITS.shard_bytes) });
      const { shards: ignored, run_hash, ...metadata } = run; void ignored;
      const proof = captureProof(run.shards, [...Object.values(state.selected), ...state.extra_captures],run.price_input_pool);
      const referencePreparation=prepareDailyAiMarketPriceReferenceBatches({planHash:plan.plan_hash,references:run.price_research,inputPoolHash:run.price_input_pool_hash});
      let priceRegistry=null;
      if(referencePreparation.batches.length){
       const prepared=prepareDailyAiMarketPriceInputChunks({planHash:plan.plan_hash,inputs:run.price_input_pool,bindings:run.price_input_bindings,inputPoolHash:run.price_input_pool_hash});
       const batches=[];for(let i=0;i<referencePreparation.batches.length;i++)batches.push(await artifact(root,prefix+'/references/batch-'+i+'.json',referencePreparation.batches[i]));
       const chunks=[];for(let i=0;i<prepared.chunks.length;i++)chunks.push(await artifact(root,prefix+'/references/input-chunk-'+i+'.json',prepared.chunks[i]));
       priceRegistry={input_chunks:chunks,inputs:await artifact(root,prefix+'/references/inputs.json',prepared.finalize),batches};
      }
      state.artifacts = { universe: await artifact(root, prefix + '/universe.json', universe),
        plan: await artifact(root, prefix + '/work-plan.json', plan), facts: await artifact(root, prefix + '/facts.json', facts),
        research: await artifact(root, prefix + '/research.json', { schema: 'TAIWAN_MARKET_DAILY_RESEARCH_BUNDLE_V1',
          source_run_hash: run_hash, metadata, shards, capture_proof: proof }),
        freshness: await artifact(root, prefix + '/freshness.json', freshnessReport(facts, frozenCalendar)), shards,price_registry:priceRegistry };
      state.counts = { securities: universe.total, markets: universe.counts, cards: plan.expected_cards, shards: plan.shards.length,
        captured_sources: captures.length, failed_sources: sources.length - captures.length, approved_prices: 0, published_cards: 0 };
      state.capture_proof = proof; state.state = 'PREPARED_REVIEW_REQUIRED'; await save();
      onProgress({ phase: 'PREPARED', ...state.counts, member_published: false });
    }
    if (!stage) return finish();
    if (state.stage?.finish?.outcome?.state === 'STAGED_REVIEW_REQUIRED') { state.state = 'STAGED_REVIEW_REQUIRED'; return finish(); }
    if (Date.parse(state.expires_at) <= Date.parse(clock())) { state.state = 'BLOCKED_EXPIRED'; await save(); return finish(); }
    if (state.capture_proof.state !== 'COMPLETE_RAW_CAPTURE_BINDING') { state.state = 'BLOCKED_CAPTURE_PROOF'; await save(); return finish(); }
    const universe = await readArtifact(root, state.artifacts.universe), plan = await readArtifact(root, state.artifacts.plan);
    await readArtifact(root, state.artifacts.research); // Verify the immutable bundle before any mutation.
    state.stage ??= { captures: {}, plan: null, shards: [], finish: null, blocked: null };
    const boundedRpc = async (name, args) => {
      let timer;
      try { return await Promise.race([Promise.resolve().then(() => rpc(name, args)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('RPC_DEADLINE_ACK_UNKNOWN')), TAIWAN_DAILY_LIMITS.rpc_deadline_ms);
      })]); } finally { clearTimeout(timer); }
    };
    const canProceed = operation => {
      if (!operation) return true;
      if (operation.outcome?.state === 'REJECTED' || operation.outcome?.state === 'LEASE_EXPIRED') return false;
      return !operation.outcome || operation.outcome.state === 'STAGED' || resume;
    };
    async function mutate(operation, invoke) {
      if (!canProceed(operation)) {
        state.stage.blocked = { kind: operation.kind, state: operation.outcome?.state ?? 'IN_FLIGHT',
          code: operation.outcome?.code ?? null, reason: operation.outcome?.reason ?? null,
          requires_explicit_resume: operation.outcome?.state === 'OUTCOME_UNKNOWN',
          requires_operator_resolution: ['REJECTED', 'LEASE_EXPIRED'].includes(operation.outcome?.state) };
        return false;
      }
      if (operation.outcome?.state === 'OUTCOME_UNKNOWN' && !resume || operation.in_flight && !resume) {
        state.stage.blocked = { kind: operation.kind, state: 'OUTCOME_UNKNOWN', requires_explicit_resume: true }; return false;
      }
      operation.attempts ??= []; if (operation.attempts.length >= 32) fail('RPC_EXPLICIT_RESUME_LIMIT');
      const attempt = { started_at: clock(), state: 'IN_FLIGHT' }; operation.attempts.push(attempt);
      operation.in_flight = true; operation.started_at ??= attempt.started_at; state.stage.blocked = null; state.state = 'STAGING'; await save();
      const outcome = await invoke(); operation.in_flight = false; operation.outcome = outcome; operation.checked_at = clock();
      Object.assign(attempt, { state: 'RECORDED', checked_at: operation.checked_at, outcome });
      if (!['STAGED', 'NO_WORK', 'STAGED_REVIEW_REQUIRED'].includes(outcome.state)) state.stage.blocked = { kind: operation.kind,
        state: outcome.state, code: outcome.code ?? null, reason: outcome.reason ?? null,
        requires_explicit_resume: outcome.state === 'OUTCOME_UNKNOWN' };
      await save(); return !state.stage.blocked;
    }
    async function stopped() { state.state = 'STAGING_STOPPED'; await save(); return finish(); }
    const needed = new Set(state.capture_proof.required_capture_ids);
    const stageCaptures = [...Object.values(state.selected), ...state.extra_captures.filter(entry => needed.has(captureId(entry.receipt)))];
    const seenCaptures = new Set();
    for (const entry of stageCaptures) {
      const id = captureId(entry.receipt); if (seenCaptures.has(id)) continue; seenCaptures.add(id);
      const operation = state.stage.captures[id] ??= { kind: 'CAPTURE', capture_id: id };
      if (operation.outcome?.state === 'STAGED') continue;
      if(performance.now()-began>TAIWAN_DAILY_LIMITS.invocation_ms){state.state='STAGING_PAUSED_RESOURCE_LIMIT';await save();return finish();}
      if (!await mutate(operation, async () => stageDailyAiMarketCapture({ rpc: boundedRpc, ...await storedCapture(root, entry) }))) return await stopped();
    }
    state.stage.plan ??= { kind: 'PLAN' };
    if (state.stage.plan.outcome?.state !== 'STAGED'
      && !await mutate(state.stage.plan, () => stageDailyAiMarketWorkPlan({ rpc: boundedRpc, universe, plan }))) return await stopped();
    if(state.artifacts.price_registry){
     state.stage.price_inputs??={kind:'PRICE_INPUTS'};state.stage.price_references??=[];
     state.stage.price_input_chunks??=[];
     for(let i=0;i<(state.artifacts.price_registry.input_chunks?.length??0);i++){
      const operation=state.stage.price_input_chunks[i]??={kind:'PRICE_INPUT_CHUNK',chunk:i};if(operation.outcome?.state==='STAGED')continue;
      if(performance.now()-began>TAIWAN_DAILY_LIMITS.invocation_ms){state.state='STAGING_PAUSED_RESOURCE_LIMIT';await save();return finish();}
      if(!await mutate(operation,async()=>stageDailyAiMarketPricePrepared({rpc:boundedRpc,prepared:await readArtifact(root,state.artifacts.price_registry.input_chunks[i])})))return await stopped();
     }
     if(state.stage.price_inputs.outcome?.state!=='STAGED'&&!await mutate(state.stage.price_inputs,async()=>stageDailyAiMarketPricePrepared({rpc:boundedRpc,prepared:await readArtifact(root,state.artifacts.price_registry.inputs)})))return await stopped();
     for(let i=0;i<state.artifacts.price_registry.batches.length;i++){
      const operation=state.stage.price_references[i]??={kind:'PRICE_REFERENCES',batch:i};if(operation.outcome?.state==='STAGED')continue;
      if(performance.now()-began>TAIWAN_DAILY_LIMITS.invocation_ms){state.state='STAGING_PAUSED_RESOURCE_LIMIT';await save();return finish();}
      if(!await mutate(operation,async()=>stageDailyAiMarketPricePrepared({rpc:boundedRpc,prepared:await readArtifact(root,state.artifacts.price_registry.batches[i])})))return await stopped();
     }
    }
    let complete = state.stage.shards.some(item => item.outcome?.state === 'NO_WORK' && item.outcome.remaining === 0 && item.outcome.exhausted === 0);
    let count = 0;
    while (!complete && count++ < maxShards && performance.now() - began < TAIWAN_DAILY_LIMITS.invocation_ms) {
      let operation = state.stage.shards.find(item => !item.outcome || !['STAGED', 'NO_WORK'].includes(item.outcome.state));
      if (!operation) { operation = { kind: 'SHARD', request_key: randomUUID() }; state.stage.shards.push(operation); await save(); }
      const runShard=state.artifacts.price_registry?runDailyAiMarketShardWithReferences:runDailyAiMarketShard;
      if (!await mutate(operation, () => runShard({ rpc: boundedRpc, planHash: plan.plan_hash, workerRef,
        requestKey: operation.request_key, analyseShard: async work => {
          const expected = plan.shards.find(item => item.shard_id === work.shard?.shard_id);
          if (!expected || marketSnapshotHash(work.shard) !== marketSnapshotHash(expected) || work.universe_hash !== universe.universe_hash) fail('CLAIM_PLAN_BINDING');
          const descriptor = state.artifacts.shards.find(item => item.shard_id === expected.shard_id);
          const shard = await readArtifact(root, descriptor.artifact); return shard.stocks;
        } }))) return await stopped();
      const outcome = operation.outcome;
      if (outcome.state === 'NO_WORK') {
        complete = outcome.remaining === 0 && outcome.exhausted === 0;
        if (!complete) { state.stage.blocked = { kind: 'SHARD', state: 'NO_WORK', remaining: outcome.remaining, exhausted: outcome.exhausted }; return await stopped(); }
      }
      onProgress({ phase: 'STAGING', state: outcome.state, shard_id: outcome.shard_id ?? null });
    }
    if (!complete) { state.state = 'STAGING_PAUSED_RESOURCE_LIMIT'; await save(); return finish(); }
    state.stage.finish ??= { kind: 'FINISH', expires_at: state.expires_at };
    if (!await mutate(state.stage.finish, () => finishDailyAiMarketEdition({ rpc: boundedRpc, planHash: plan.plan_hash,
      expiresAt: state.stage.finish.expires_at }))) return await stopped();
    state.state = 'STAGED_REVIEW_REQUIRED'; await save(); return finish();
  } catch (error) {
    if (state && save) { state.last_error = { at: clock(), code: safeError(error) }; await save(); }
    throw error;
  } finally { await unlock(); }
}

function usage() {
  return `Usage: node --experimental-strip-types scripts/operations/run-taiwan-market-daily.mjs
  --output <durable-directory> --slot PREMARKET|POSTCLOSE
  [--business-date YYYY-MM-DD] [--acquisition-dir <retained-acquisition-directory>]
  [--history <checkpoint.json>] [--financial-history <records.json>]
  [--retained-captures <capture-manifest.json>] [--actions-source-manifest <original-actions.json>]
  [--input-cache <durable-input-cache> [--input-seed <seed.json>] [--offline-inputs]]
  [--input-manifest <verified-retained-input-manifest.json>]
  [--stage --rpc-module <reviewed-server-adapter.mjs> --worker-ref <name>]
  [--resume] [--max-shards 1..128]

No --stage: downloads allowlisted official public datasets and writes only local artifacts.
--acquisition-dir: imports existing receipts; makes zero provider requests.
--stage: requires an injected module exporting rpc(name,args); never loads credentials.
--resume: read back a previously unknown RPC acknowledgement using the SAME inputs/UUID/expiry.
REJECTED or LEASE_EXPIRED remains blocked; a failed capture is never retried in the same snapshot.
No mode approves a method, creates a review, publishes members' cards, or changes a schedule.`;
}
async function main(argv) {
  if (argv.includes('--help')) { console.log(usage()); return 0; }
  const values = {}, boolean = new Set(['stage', 'resume','offline-inputs']);
  const accepted = new Set(['output', 'slot', 'business-date', 'acquisition-dir', 'history', 'financial-history',
    'retained-captures','actions-source-manifest','input-cache','input-manifest','input-seed','offline-inputs', 'stage', 'rpc-module', 'worker-ref', 'resume', 'max-shards']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    if (!accepted.has(key) || Object.hasOwn(values, key)) fail('CLI_ARGUMENT');
    if (boolean.has(key)) values[key] = true;
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('CLI_VALUE'); values[key] = argv[++i]; }
  }
  if (!!values.stage !== !!values['rpc-module']) fail('STAGE_REQUIRES_EXPLICIT_SERVER_ADAPTER');
  const dependencies = { onProgress: progress => console.error(JSON.stringify(progress)) };
  if (values.stage) {
    const module = await import(pathToFileURL(resolve(values['rpc-module'])).href);
    if (typeof module.rpc !== 'function') fail('RPC_MODULE'); dependencies.rpc = module.rpc;
  }
  const result = await runTaiwanMarketDaily({ output: values.output, slot: values.slot,
    businessDate: values['business-date'], acquisitionDir: values['acquisition-dir'], historyFile: values.history,
    financialHistoryFile: values['financial-history'], retainedCapturesFile: values['retained-captures'],actionsSourceManifestFile:values['actions-source-manifest'],
    inputCacheDir:values['input-cache'],inputManifestFile:values['input-manifest'],inputSeedManifestFile:values['input-seed'],allowInputNetwork:values['offline-inputs']!==true,
    stage: values.stage === true, resume: values.resume === true, workerRef: values['worker-ref'] ?? 'taiwan-market-daily',
    maxShards: values['max-shards'] === undefined ? TAIWAN_DAILY_LIMITS.shards_per_invocation : Number(values['max-shards']) }, dependencies);
  console.log(JSON.stringify(result));
  return ['PREPARED_REVIEW_REQUIRED', 'STAGED_REVIEW_REQUIRED', 'SKIPPED_MARKET_CLOSED'].includes(result.state) ? 0 : 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ state: 'FAILED', code: safeError(error), member_published: false })); process.exitCode = 1; }
}
