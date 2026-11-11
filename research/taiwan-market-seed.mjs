/** Private, content-addressed bootstrap transport. This module has no network
 * implementation, service credential, review or publication operation. The
 * injected RPC may call only the two complete-seed readers below. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, unlink, utimes } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { loadTaiwanDailyInputManifest } from './taiwan-market-input-cache.mjs';

export const TAIWAN_MARKET_SEED_POLICY = Object.freeze({
  archive_bytes: 256 * 1024 * 1024, chunk_bytes: 1024 * 1024, entries: 20_000,
  file_bytes: 256 * 1024 * 1024, uncompressed_bytes: 1024 * 1024 * 1024,
  manifest_bytes: 100_000, metadata_bytes: 16_000_000, filename_bytes: 1024,
  bootstrap_ms: 15 * 60_000,
});
export const TAIWAN_MARKET_SEED_READ_RPCS = Object.freeze([
  'get_daily_ai_market_worker_seed_manifest_v2', 'get_daily_ai_market_worker_seed_chunk_v2',
]);
const policy = TAIWAN_MARKET_SEED_POLICY;
// Reviewed immutable seeds may predate the live refresh policy. Restore their
// original bytes; refresh owns the explicit, provenance-preserving migration.
const supportedSeedCachePolicies = Object.freeze([
  'TAIWAN_DAILY_INPUT_CACHE_20261111_V1', 'TAIWAN_DAILY_INPUT_CACHE_20261111_V2', 'TAIWAN_DAILY_INPUT_CACHE_20261111_V3',
]);
const hash = value => createHash('sha256').update(value).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const fail = code => { throw Error('TAIWAN_MARKET_SEED_' + code); };
const deepFreeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

function validateManifest(manifest, seedId, now) {
  if (!exact(manifest, ['schema', 'seed_id', 'format', 'archive_sha256', 'archive_bytes', 'chunk_bytes', 'chunk_count', 'chunks',
    'entry_count', 'uncompressed_bytes', 'root_directory', 'cache_state_sha256', 'latest_manifest_sha256', 'created_at'])
    || manifest.schema !== 'DAILY_AI_MARKET_PRIVATE_SEED_V1' || manifest.format !== 'ZIP' || manifest.root_directory !== 'input-cache'
    || !sha(seedId) || manifest.seed_id !== seedId || manifest.archive_sha256 !== seedId
    || !sha(manifest.cache_state_sha256) || !sha(manifest.latest_manifest_sha256)
    || !integer(manifest.archive_bytes, 22, policy.archive_bytes) || manifest.chunk_bytes !== policy.chunk_bytes
    || !integer(manifest.chunk_count, 1, 256) || manifest.chunk_count !== Math.ceil(manifest.archive_bytes / policy.chunk_bytes)
    || !Array.isArray(manifest.chunks) || manifest.chunks.length !== manifest.chunk_count
    || !integer(manifest.entry_count, 2, policy.entries) || !integer(manifest.uncompressed_bytes, 2, policy.uncompressed_bytes)
    || !time(manifest.created_at) || Date.parse(manifest.created_at) > now) fail('MANIFEST_CONTRACT');
  for (const [index, chunk] of manifest.chunks.entries()) {
    if (!exact(chunk, ['index', 'bytes', 'sha256']) || chunk.index !== index || !sha(chunk.sha256)
      || chunk.bytes !== Math.min(policy.chunk_bytes, manifest.archive_bytes - index * policy.chunk_bytes)) fail('CHUNK_MANIFEST');
  }
  return manifest;
}

export function parseTaiwanMarketSeedManifest(response, seedId, now = Date.now()) {
  if (!Number.isFinite(now) || !exact(response, ['schema', 'seed_id', 'state', 'manifest_hash', 'manifest_text', 'completed_at'])
    || response.schema !== 'DAILY_AI_MARKET_WORKER_SEED_MANIFEST_V2' || response.state !== 'COMPLETE' || response.seed_id !== seedId
    || !sha(response.manifest_hash) || typeof response.manifest_text !== 'string'
    || Buffer.byteLength(response.manifest_text) > policy.manifest_bytes || hash(response.manifest_text) !== response.manifest_hash
    || !time(response.completed_at) || Date.parse(response.completed_at) > now + 30_000) fail('MANIFEST_RESPONSE');
  const manifest = validateManifest(JSON.parse(response.manifest_text), seedId, now);
  if (Date.parse(response.completed_at) < Date.parse(manifest.created_at)) fail('MANIFEST_CHRONOLOGY');
  return deepFreeze({ manifest, manifest_hash: response.manifest_hash, completed_at: response.completed_at });
}

function parseChunk(response, manifest, index) {
  const expected = manifest.chunks[index];
  if (!exact(response, ['schema', 'seed_id', 'index', 'bytes', 'sha256', 'data_base64'])
    || response.schema !== 'DAILY_AI_MARKET_WORKER_SEED_CHUNK_V2' || response.seed_id !== manifest.seed_id || response.index !== index
    || response.bytes !== expected.bytes || response.sha256 !== expected.sha256 || typeof response.data_base64 !== 'string'
    || response.data_base64.length !== 4 * Math.ceil(expected.bytes / 3)
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(response.data_base64)) fail('CHUNK_RESPONSE');
  const bytes = Buffer.from(response.data_base64, 'base64');
  if (bytes.length !== expected.bytes || bytes.toString('base64') !== response.data_base64 || hash(bytes) !== expected.sha256) fail('CHUNK_HASH');
  return bytes;
}

async function readAt(handle, length, position) {
  if (!integer(length, 0, policy.entries * (46 + policy.filename_bytes)) || !integer(position, 0, policy.archive_bytes)) fail('ZIP_READ_BOUND');
  const buffer = Buffer.alloc(length); let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) fail('ZIP_TRUNCATED'); offset += bytesRead;
  }
  return buffer;
}
function safeName(bytes, flags) {
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('ZIP_PATH'); }
  const pieces = name.split('/');
  const unsafeCharacter = [...name].some(character => character.charCodeAt(0) < 32
    || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159) || character === ':' || character === '\\');
  if (!name.startsWith('input-cache/') || unsafeCharacter || name !== name.normalize('NFC')
    || pieces.some((part, index) => part === '.' || part === '..' || (!part && index !== pieces.length - 1))
    || (flags === 0 && /[^\x20-\x7e]/.test(name)) || name === 'input-cache/input-update.lock.json') fail('ZIP_PATH');
  return name;
}
function zipDate(header) {
  const bits = header.readUInt16LE(14), clock = header.readUInt16LE(12);
  const year = 1980 + (bits >>> 9), month = (bits >>> 5) & 15, day = bits & 31;
  const hour = clock >>> 11, minute = (clock >>> 5) & 63, second = (clock & 31) * 2;
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (month < 1 || month > 12 || day < 1 || value.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) fail('ZIP_DATE');
  return value;
}

/** Read a constrained, seekable ZIP directory without inflating it. Archive SHA
 * is checked here too, so callers inspecting a retained file cannot accidentally
 * skip its binding to seed_id. Inflation, CRC and cache checks happen below. */
export async function inspectTaiwanMarketSeedZip(file, manifest) {
  validateManifest(manifest, manifest?.seed_id, Date.now());
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== manifest.archive_bytes) fail('ARCHIVE_SIZE');
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, end: stat.size - 1, autoClose: false, highWaterMark: 64 * 1024 })) digest.update(chunk);
    if (digest.digest('hex') !== manifest.seed_id) fail('ARCHIVE_HASH');
    const end = await readAt(handle, 22, stat.size - 22);
    if (end.readUInt32LE(0) !== 0x06054b50 || end.readUInt16LE(4) !== 0 || end.readUInt16LE(6) !== 0
      || end.readUInt16LE(8) !== manifest.entry_count || end.readUInt16LE(10) !== manifest.entry_count || end.readUInt16LE(20) !== 0) fail('ZIP_DIRECTORY');
    const centralSize = end.readUInt32LE(12), centralStart = end.readUInt32LE(16);
    if (centralSize < 46 || centralSize + centralStart !== stat.size - 22) fail('ZIP_DIRECTORY');
    const central = await readAt(handle, centralSize, centralStart), entries = [], names = new Map();
    let cursor = 0, localPosition = 0, expandedTotal = 0;
    for (let index = 0; index < manifest.entry_count; index++) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) fail('ZIP_ENTRY');
      const header = central.subarray(cursor, cursor + 46), version = header.readUInt16LE(6), flags = header.readUInt16LE(8);
      const method = header.readUInt16LE(10), compressed = header.readUInt32LE(20), expanded = header.readUInt32LE(24);
      const length = header.readUInt16LE(28), external = header.readUInt32LE(38), type = (external >>> 16) & 0xf000;
      if (![10, 20].includes(version) || ![0, 2048].includes(flags) || ![0, 8].includes(method) || !integer(length, 1, policy.filename_bytes)
        || cursor + 46 + length > central.length || header.readUInt16LE(30) !== 0 || header.readUInt16LE(32) !== 0
        || header.readUInt16LE(34) !== 0 || compressed > policy.file_bytes || expanded > policy.file_bytes
        || header.readUInt32LE(42) !== localPosition) fail('ZIP_UNSUPPORTED');
      const filename = central.subarray(cursor + 46, cursor + 46 + length), name = safeName(filename, flags), directory = name.endsWith('/');
      const normalized = (directory ? name.slice(0, -1) : name).toLowerCase();
      if (names.has(normalized) || ![0, 0x4000, 0x8000].includes(type)
        || (directory && (![0, 0x4000].includes(type) || compressed !== 0 || expanded !== 0 || method !== 0))
        || (!directory && (type === 0x4000 || (external & 0x10) !== 0))) fail('ZIP_PATH');
      names.set(normalized, directory ? 'directory' : 'file');
      if (localPosition + 30 + length > centralStart) fail('ZIP_LOCAL_BINDING');
      const local = await readAt(handle, 30 + length, localPosition);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(4) !== version || local.readUInt16LE(6) !== flags
        || local.readUInt16LE(8) !== method || local.readUInt32LE(10) !== header.readUInt32LE(12)
        || local.readUInt32LE(14) !== header.readUInt32LE(16) || local.readUInt32LE(18) !== compressed
        || local.readUInt32LE(22) !== expanded || local.readUInt16LE(26) !== length || local.readUInt16LE(28) !== 0
        || !local.subarray(30).equals(filename) || localPosition + 30 + length + compressed > centralStart
        || (method === 0 && compressed !== expanded)) fail('ZIP_LOCAL_BINDING');
      expandedTotal += expanded;
      if (expandedTotal > policy.uncompressed_bytes) fail('ZIP_SIZE');
      entries.push({ name, directory, method, compressed, expanded, crc32: header.readUInt32LE(16),
        data_start: localPosition + 30 + length, modified_at: zipDate(header) });
      localPosition += 30 + length + compressed; cursor += 46 + length;
    }
    for (const name of names.keys()) {
      const parts = name.split('/');
      for (let depth = 1; depth < parts.length; depth++) if (names.get(parts.slice(0, depth).join('/')) === 'file') fail('ZIP_PATH');
    }
    if (cursor !== central.length || localPosition !== centralStart || expandedTotal !== manifest.uncompressed_bytes
      || names.get('input-cache/cache-state.json') !== 'file' || names.get('input-cache/latest.json') !== 'file') fail('ZIP_TOTALS');
    return entries;
  } finally { await handle.close(); }
}

// IEEE CRC-32 (ZIP). Independent fixtures are generated by Python's zipfile.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); return value >>> 0;
});
function updateCrc(crc, bytes) { for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }
async function extractZip(file, entries, work, deadline) {
  let total = 0;
  for (const entry of entries) {
    if (Date.now() >= deadline) fail('TIME_LIMIT');
    const target = join(work, ...entry.name.split('/'));
    if (entry.directory) { await mkdir(target, { recursive: true, mode: 0o700 }); continue; }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    let size = 0, crc = 0xffffffff;
    const meter = new Transform({ transform(bytes, encoding, callback) {
      size += bytes.length; total += bytes.length;
      if (size > entry.expanded || total > policy.uncompressed_bytes) { callback(Error('TAIWAN_MARKET_SEED_ZIP_INFLATE_SIZE')); return; }
      crc = updateCrc(crc, bytes); callback(null, bytes);
    } });
    if (entry.compressed === 0) {
      if (entry.method !== 0 || entry.expanded !== 0 || entry.crc32 !== 0) fail('ZIP_EMPTY_ENTRY');
      const empty = await open(target, 'wx', 0o600); await empty.close();
    } else {
      const source = createReadStream(file, { start: entry.data_start, end: entry.data_start + entry.compressed - 1, highWaterMark: 64 * 1024 });
      const sink = createWriteStream(target, { flags: 'wx', mode: 0o600 });
      const inflater = entry.method === 8 ? createInflateRaw({ chunkSize: 64 * 1024 }) : null;
      const streams = inflater ? [source, inflater, meter, sink] : [source, meter, sink];
      await pipeline(...streams, { signal: globalThis.AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      // Deflate must consume the entire declared payload. Trailing streams or
      // hidden bytes cannot be accepted just because the first stream decoded.
      if (inflater && inflater.bytesWritten !== entry.compressed) fail('ZIP_DEFLATE_TRAILING');
    }
    if (size !== entry.expanded || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) fail('ZIP_CRC_SIZE');
    await utimes(target, entry.modified_at, entry.modified_at);
  }
  for (const entry of entries.filter(value => value.directory).reverse()) await utimes(join(work, ...entry.name.split('/')), entry.modified_at, entry.modified_at);
  return total;
}
async function metadataBytes(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || !integer(stat.size, 1, policy.metadata_bytes)) fail('CACHE_METADATA');
  const bytes = await readFile(file); if (bytes.length !== stat.size) fail('CACHE_METADATA'); return bytes;
}
async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function safeParent(path) {
  const absolute = resolve(path), { root } = parse(absolute); let current = root;
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, part); let info = await exists(current);
    if (!info) { try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } info = await lstat(current); }
    if (!info.isDirectory() || info.isSymbolicLink()) fail('CACHE_PARENT');
  }
}
async function readRpc(rpc, name, args) {
  if (!TAIWAN_MARKET_SEED_READ_RPCS.includes(name)) fail('RPC_SCOPE');
  const result = await rpc(name, args);
  if (!object(result) || result.error || result.data === null || result.data === undefined) fail('RPC_READ_FAILED');
  return result.data;
}

/** Installs only into an absent target. A sibling exclusive lock serializes
 * bootstrap attempts; a fully verified directory is renamed on the same volume.
 * No existing cache, embedded source timestamp or provenance is rewritten. */
export async function bootstrapTaiwanMarketSeed({ seedId, cacheDir, rpc }) {
  if (!sha(seedId) || typeof cacheDir !== 'string' || !cacheDir.trim() || typeof rpc !== 'function') fail('ARGUMENTS');
  const cache = resolve(cacheDir), parent = dirname(cache), started = Date.now(), deadline = started + policy.bootstrap_ms;
  if (cache === parent) fail('ARGUMENTS');
  await safeParent(parent);
  if (await exists(cache)) fail('CACHE_EXISTS');
  const lockPath = join(parent, '.' + basename(cache) + '.seed-bootstrap.lock');
  let lock, work;
  try {
    lock = await open(lockPath, 'wx', 0o600);
    if (await exists(cache)) fail('CACHE_EXISTS');
    work = await mkdtemp(join(parent, '.' + basename(cache) + '.seed-'));
    const raw = await readRpc(rpc, TAIWAN_MARKET_SEED_READ_RPCS[0], { p_seed_id: seedId });
    const checked = parseTaiwanMarketSeedManifest(raw, seedId), { manifest } = checked;
    const archive = join(work, 'seed.zip'), handle = await open(archive, 'wx', 0o600), digest = createHash('sha256'); let bytes = 0;
    try {
      for (let index = 0; index < manifest.chunk_count; index++) {
        if (Date.now() >= deadline) fail('TIME_LIMIT');
        const chunk = parseChunk(await readRpc(rpc, TAIWAN_MARKET_SEED_READ_RPCS[1], { p_seed_id: seedId, p_chunk_index: index }), manifest, index);
        digest.update(chunk); bytes += chunk.length;
        let offset = 0;
        while (offset < chunk.length) { const written = await handle.write(chunk, offset, chunk.length - offset); if (!written.bytesWritten) fail('ARCHIVE_WRITE'); offset += written.bytesWritten; }
      }
      await handle.sync();
    } finally { await handle.close(); }
    if (bytes !== manifest.archive_bytes || digest.digest('hex') !== seedId) fail('ARCHIVE_HASH');
    const entries = await inspectTaiwanMarketSeedZip(archive, manifest);
    if (await extractZip(archive, entries, work, deadline) !== manifest.uncompressed_bytes) fail('ZIP_TOTALS');
    const extracted = join(work, 'input-cache');
    const stateBytes = await metadataBytes(join(extracted, 'cache-state.json')), latestBytes = await metadataBytes(join(extracted, 'latest.json'));
    if (hash(stateBytes) !== manifest.cache_state_sha256 || hash(latestBytes) !== manifest.latest_manifest_sha256) fail('CACHE_METADATA_HASH');
    const state = JSON.parse(stateBytes.toString('utf8'));
    if (state?.schema !== 'TAIWAN_INPUT_CACHE_STATE_V1' || !supportedSeedCachePolicies.includes(state.policy_version)) fail('CACHE_STATE');
    const input = await loadTaiwanDailyInputManifest(join(extracted, 'latest.json'));
    if (Date.now() >= deadline) fail('TIME_LIMIT');
    if (await exists(cache)) fail('CACHE_EXISTS');
    await rename(extracted, cache);
    return { schema: 'TAIWAN_MARKET_SEED_BOOTSTRAP_RESULT_V1', state: 'INSTALLED', seed_id: seedId,
      manifest_hash: checked.manifest_hash, cache_directory: cache, input_manifest_hash: input.manifest_hash,
      archive_bytes: bytes, chunks: manifest.chunk_count, entries: entries.length, uncompressed_bytes: manifest.uncompressed_bytes,
      source_timestamps_rewritten: false, member_published: false };
  } finally {
    if (work) await rm(work, { recursive: true, force: true });
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}
