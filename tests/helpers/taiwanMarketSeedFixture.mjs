/** Independent ZIP writer and explicitly SYNTHETIC portable cache fixture.
 * Python zipfile supplies archive framing/CRC; no provider or database call. */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { marketSnapshotHash } from '../../research/taiwan-market-universe.mjs';
import { TAIWAN_INPUT_CACHE_POLICY } from '../../research/taiwan-market-input-cache.mjs';

export const seedSha = value => createHash('sha256').update(value).digest('hex');
export const syntheticSeedTime = '2020-01-02T03:04:05.000Z';
const json = value => Buffer.from(JSON.stringify(value) + '\n');
const writer = `import base64,json,sys,zipfile
items=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[1],'w',allowZip64=False) as archive:
 for item in items:
  info=zipfile.ZipInfo(item['name'],(2020,1,2,3,4,6));info.create_system=3
  info.external_attr=item.get('mode',0o100600)<<16
  info.compress_type=zipfile.ZIP_STORED if item.get('stored',False) else zipfile.ZIP_DEFLATED
  if item['name'].endswith('/'):
   info.external_attr=(0o40700<<16)|0x10;info.compress_type=zipfile.ZIP_STORED
  archive.writestr(info,base64.b64decode(item['data_base64']),compresslevel=6)
with zipfile.ZipFile(sys.argv[1]) as archive:
 print(json.dumps({'entry_count':len(archive.infolist()),'uncompressed_bytes':sum(i.file_size for i in archive.infolist())}))
`;

export function syntheticSeedEntries({ padding = 0 } = {}) {
  const entries = [], parts = {};
  for (const name of ['history', 'financial_history', 'retained_captures']) {
    const bytes = json({ schema: 'SYNTHETIC_CACHE_OBJECT_FOR_TRANSPORT_TEST_ONLY', name, first_seen_at: syntheticSeedTime });
    const file = 'objects/' + seedSha(bytes) + '.json'; parts[name] = { file, sha256: seedSha(bytes), bytes: bytes.length };
    entries.push({ name: 'input-cache/' + file, bytes });
  }
  const body = { schema: 'TAIWAN_DAILY_INPUT_MANIFEST_V1', formed_at: syntheticSeedTime, parts, issues: [], counts: { synthetic: true } };
  const manifest = { ...body, manifest_hash: marketSnapshotHash(body) }, manifestFile = 'manifest-' + manifest.manifest_hash + '.json';
  entries.push({ name: 'input-cache/cache-state.json', bytes: json({ schema: 'TAIWAN_INPUT_CACHE_STATE_V1',
    policy_version: TAIWAN_INPUT_CACHE_POLICY.version, first_seen_at: syntheticSeedTime, synthetic: true }) });
  entries.push({ name: 'input-cache/latest.json', bytes: json({ schema: 'TAIWAN_DAILY_INPUT_POINTER_V1', file: manifestFile, manifest_hash: manifest.manifest_hash }) });
  entries.push({ name: 'input-cache/' + manifestFile, bytes: json(manifest) });
  if (padding) entries.push({ name: 'input-cache/objects/SYNTHETIC-padding.bin', bytes: randomBytes(padding), stored: true });
  return entries;
}
export function seedFixtureFromBytes(bytes, { entry_count, uncompressed_bytes }, entries) {
  const manifest = { schema: 'DAILY_AI_MARKET_PRIVATE_SEED_V1', seed_id: seedSha(bytes), format: 'ZIP', archive_sha256: seedSha(bytes),
    archive_bytes: bytes.length, chunk_bytes: 1048576, chunk_count: Math.ceil(bytes.length / 1048576), chunks: [],
    entry_count, uncompressed_bytes, root_directory: 'input-cache',
    cache_state_sha256: seedSha(entries.find(item => item.name === 'input-cache/cache-state.json').bytes),
    latest_manifest_sha256: seedSha(entries.find(item => item.name === 'input-cache/latest.json').bytes), created_at: syntheticSeedTime };
  for (let index = 0; index < manifest.chunk_count; index++) {
    const chunk = bytes.subarray(index * 1048576, (index + 1) * 1048576); manifest.chunks.push({ index, bytes: chunk.length, sha256: seedSha(chunk) });
  }
  const manifestText = JSON.stringify(manifest), manifestHash = seedSha(manifestText);
  const response = { schema: 'DAILY_AI_MARKET_WORKER_SEED_MANIFEST_V2', seed_id: manifest.seed_id, state: 'COMPLETE',
    manifest_hash: manifestHash, manifest_text: manifestText, completed_at: syntheticSeedTime };
  const chunkResponse = index => ({ schema: 'DAILY_AI_MARKET_WORKER_SEED_CHUNK_V2', seed_id: manifest.seed_id,
    ...manifest.chunks[index], data_base64: bytes.subarray(index * 1048576, (index + 1) * 1048576).toString('base64') });
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (args.p_seed_id !== manifest.seed_id) throw Error('SYNTHETIC_SEED_SCOPE');
    if (name === 'get_daily_ai_market_worker_seed_manifest_v2') return { data: response, error: null };
    if (name === 'get_daily_ai_market_worker_seed_chunk_v2') return { data: chunkResponse(args.p_chunk_index), error: null };
    throw Error('SYNTHETIC_FORBIDDEN_RPC');
  };
  return { bytes, entries, manifest, manifestText, manifestHash, response, chunkResponse, rpc, calls };
}
export function makeSyntheticSeed(directory, { entries = syntheticSeedEntries(), mutateBytes } = {}) {
  const file = join(directory, 'SYNTHETIC-' + randomUUID() + '.zip');
  const input = entries.map(({ bytes, ...rest }) => ({ ...rest, data_base64: bytes.toString('base64') }));
  const summary = JSON.parse(execFileSync('python3', ['-c', writer, file], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 4_000_000 }));
  let bytes = readFileSync(file); if (mutateBytes) bytes = mutateBytes(bytes);
  return { ...seedFixtureFromBytes(bytes, summary, entries), file, summary };
}
