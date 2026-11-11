// Transport/extraction tests use explicitly synthetic files and injected readers.
// They do not establish source rights, strategy validity or production capacity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { bootstrapTaiwanMarketSeed, parseTaiwanMarketSeedManifest } from '../research/taiwan-market-seed.mjs';
import { runTaiwanMarketSeedBootstrapCli } from '../scripts/operations/bootstrap-taiwan-market-seed.mjs';
import { makeSyntheticSeed, seedSha, syntheticSeedEntries, syntheticSeedTime } from './helpers/taiwanMarketSeedFixture.mjs';

async function area(t) { const directory = await mkdtemp(join(tmpdir(), 'ma-seed-test-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const clone = value => globalThis.structuredClone(value);
async function absent(path) { await assert.rejects(readFile(path), { code: 'ENOENT' }); }
const centralStart = bytes => bytes.readUInt32LE(bytes.length - 6);
function restampManifest(fixture, modify) {
  const manifest = clone(fixture.manifest); modify(manifest);
  const text = JSON.stringify(manifest); return { ...fixture.response, manifest_text: text, manifest_hash: seedSha(text) };
}

test('multi-chunk complete seed installs atomically and preserves original source metadata', async t => {
  const directory = await area(t), f = makeSyntheticSeed(directory, { entries: syntheticSeedEntries({ padding: 1_060_000 }) }), target = join(directory, 'cache');
  const result = await runTaiwanMarketSeedBootstrapCli(['--seed-id', f.manifest.seed_id, '--cache', target], { rpc: f.rpc });
  assert.equal(result.state, 'INSTALLED'); assert.equal(result.chunks, 2); assert.equal(result.source_timestamps_rewritten, false);
  assert.equal(result.member_published, false); assert.equal(result.uncompressed_bytes, f.manifest.uncompressed_bytes);
  for (const entry of f.entries) assert.deepEqual(await readFile(join(target, entry.name.slice(12))), entry.bytes);
  assert.equal(JSON.parse(await readFile(join(target, 'cache-state.json'), 'utf8')).first_seen_at, syntheticSeedTime);
  assert.deepEqual(f.calls.map(item => item.name), ['get_daily_ai_market_worker_seed_manifest_v2',
    'get_daily_ai_market_worker_seed_chunk_v2', 'get_daily_ai_market_worker_seed_chunk_v2']);
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: target, rpc: f.rpc }), /CACHE_EXISTS/);
  assert.equal(f.calls.length, 3); assert.ok(!(await readdir(directory)).some(name => name.startsWith('.cache.seed')));
});

test('known V1/V2/V3 cache seeds restore their exact bytes without migrating policy or timestamps', async t => {
  const directory = await area(t);
  for (const version of ['V1', 'V2', 'V3']) {
    const entries = syntheticSeedEntries(), stateEntry = entries.find(entry => entry.name === 'input-cache/cache-state.json');
    const state = JSON.parse(stateEntry.bytes); state.policy_version = 'TAIWAN_DAILY_INPUT_CACHE_20261111_' + version;
    stateEntry.bytes = Buffer.from(JSON.stringify(state) + '\n');
    const f = makeSyntheticSeed(directory, { entries }), target = join(directory, version);
    const result = await bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: target, rpc: f.rpc });
    assert.equal(result.state, 'INSTALLED'); assert.equal(result.source_timestamps_rewritten, false);
    for (const entry of entries) assert.deepEqual(await readFile(join(target, entry.name.slice(12))), entry.bytes);
    const restored = await readFile(join(target, 'cache-state.json'));
    assert.equal(seedSha(restored), f.manifest.cache_state_sha256);
    assert.equal(JSON.parse(restored).policy_version, state.policy_version);
    assert.equal(JSON.parse(restored).first_seen_at, syntheticSeedTime);
  }
});

test('unknown, future and missing cache policy versions cannot be installed', async t => {
  const directory = await area(t);
  for (const [index, version] of ['TAIWAN_DAILY_INPUT_CACHE_20261111_V4', 'UNKNOWN', null, undefined].entries()) {
    const entries = syntheticSeedEntries(), stateEntry = entries.find(entry => entry.name === 'input-cache/cache-state.json');
    const state = JSON.parse(stateEntry.bytes); state.policy_version = version; stateEntry.bytes = Buffer.from(JSON.stringify(state) + '\n');
    const f = makeSyntheticSeed(directory, { entries }), target = join(directory, 'unknown-' + index);
    await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: target, rpc: f.rpc }), /CACHE_STATE/);
    await absent(join(target, 'cache-state.json')); await absent(join(target, 'latest.json'));
  }
});

test('manifest identity, exact types, totals, completeness and raw text hash are required', async t => {
  const directory = await area(t), f = makeSyntheticSeed(directory), seed = f.manifest.seed_id;
  for (const change of [m => { m.chunk_count++; }, m => { m.chunks[0].index = 1; }, m => { m.archive_bytes = '100'; },
    m => { m.uncompressed_bytes = 1073741825; }, m => { m.entry_count = 20001; }, m => { m.chunk_bytes = 1000000; },
    m => { m.cache_state_sha256 = null; }, m => { m.created_at = '2999-01-01T00:00:00Z'; }, m => { m.extra = true; }])
    assert.throws(() => parseTaiwanMarketSeedManifest(restampManifest(f, change), seed), /MANIFEST|CHUNK/);
  for (const change of [{ state: 'UPLOADING' }, { seed_id: 'f'.repeat(64) }, { manifest_hash: 'f'.repeat(64) }, { completed_at: '1999-01-01T00:00:00Z' }])
    assert.throws(() => parseTaiwanMarketSeedManifest({ ...f.response, ...change }, seed), /MANIFEST/);
});

test('wrong, corrupt or out-of-order chunks stop without retry and leave no target or lock', async t => {
  const directory = await area(t), f = makeSyntheticSeed(directory);
  const changes = [r => ({ ...r, index: 1 }), r => ({ ...r, seed_id: 'f'.repeat(64) }), r => ({ ...r, data_base64: r.data_base64.slice(4) }),
    r => ({ ...r, data_base64: Buffer.alloc(r.bytes).toString('base64') }), r => ({ ...r, sha256: 'f'.repeat(64) })];
  for (const [index, change] of changes.entries()) {
    let calls = 0; const target = join(directory, 'bad' + index);
    const rpc = async name => { calls++; return { data: name.endsWith('manifest_v2') ? f.response : change(f.chunkResponse(0)), error: null }; };
    await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: target, rpc }), /CHUNK/);
    assert.equal(calls, 2); await absent(join(target, 'latest.json'));
    assert.ok(!(await readdir(directory)).some(name => name.startsWith('.bad' + index + '.seed')));
  }
});

test('a read failure is propagated once and cannot become a successful or partial cache', async t => {
  const directory = await area(t), target = join(directory, 'cache'); let calls = 0;
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: 'a'.repeat(64), cacheDir: target,
    rpc: async () => { calls++; return { data: null, error: { message: 'SYNTHETIC' } }; } }), /RPC_READ_FAILED/);
  assert.equal(calls, 1); await absent(join(target, 'latest.json'));
});

test('archive paths reject traversal, absolute paths, separators, case duplicates and file-parent collisions', async t => {
  const directory = await area(t);
  for (const [index, extra] of [
    [{ name: 'input-cache/../escape', bytes: Buffer.from('x') }], [{ name: '/tmp/escape', bytes: Buffer.from('x') }],
    [{ name: 'input-cache/a\\escape', bytes: Buffer.from('x') }], [{ name: 'input-cache/C:/escape', bytes: Buffer.from('x') }],
    [{ name: 'input-cache/LATEST.json', bytes: Buffer.from('x') }],
    [{ name: 'input-cache/a', bytes: Buffer.from('x') }, { name: 'input-cache/a/b', bytes: Buffer.from('x') }],
    [{ name: 'input-cache/input-update.lock.json', bytes: Buffer.from('x') }],
  ].entries()) {
    const f = makeSyntheticSeed(directory, { entries: [...syntheticSeedEntries(), ...extra] }), target = join(directory, 'bad-path-' + index);
    await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: target, rpc: f.rpc }), /ZIP_PATH/);
    await absent(join(target, 'latest.json'));
  }
});

test('ZIP symlinks/devices and symlinked destination ancestors are rejected', async t => {
  const directory = await area(t);
  for (const mode of [0o120777, 0o020600, 0o060600]) {
    const f = makeSyntheticSeed(directory, { entries: [...syntheticSeedEntries(), { name: 'input-cache/unsafe', bytes: Buffer.from('../other'), mode }] });
    await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: join(directory, 'bad-mode-' + mode), rpc: f.rpc }), /ZIP_PATH/);
  }
  await symlink(directory, join(directory, 'linked'));
  let calls = 0;
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: 'a'.repeat(64), cacheDir: join(directory, 'linked', 'cache'), rpc: async () => { calls++; } }), /CACHE_PARENT/);
  assert.equal(calls, 0);
});

test('local/central disagreements, unsupported flags and excessive file size are rejected before extraction', async t => {
  const directory = await area(t);
  const mutations = [bytes => { bytes.writeUInt32LE(123, 14); return bytes; },
    bytes => { bytes.writeUInt16LE(8, centralStart(bytes) + 8); return bytes; },
    bytes => { bytes.writeUInt32LE(268435457, centralStart(bytes) + 24); return bytes; },
    bytes => { bytes.writeUInt16LE(1, bytes.length - 2); return bytes; }];
  for (const [index, mutateBytes] of mutations.entries()) {
    const f = makeSyntheticSeed(directory, { mutateBytes });
    await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: join(directory, 'bad-header-' + index), rpc: f.rpc }), /ZIP_LOCAL_BINDING|ZIP_UNSUPPORTED|ZIP_DIRECTORY/);
  }
});

test('corrupt stored payload fails actual CRC even when archive and chunk SHA were restamped', async t => {
  const directory = await area(t), entries = syntheticSeedEntries(); entries[0].stored = true;
  const f = makeSyntheticSeed(directory, { entries, mutateBytes: bytes => { bytes[30 + bytes.readUInt16LE(26)] ^= 1; return bytes; } });
  const target = join(directory, 'bad-crc');
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: target, rpc: f.rpc }), /ZIP_CRC_SIZE/);
  await absent(join(target, 'latest.json'));
});

test('expanded bytes cannot exceed declared per-file size and are never installed', async t => {
  const directory = await area(t), f = makeSyntheticSeed(directory, { mutateBytes: bytes => {
    const central = centralStart(bytes); bytes.writeUInt32LE(1, central + 24); bytes.writeUInt32LE(1, 22); return bytes;
  } });
  // Make outer declared sum match forged directory: decompression must still
  // independently detect the actual larger first file.
  const actual = f.entries[0].bytes.length, response = restampManifest(f, m => { m.uncompressed_bytes -= actual - 1; });
  const rpc = async (name, args) => name.endsWith('manifest_v2') ? { data: response, error: null } : f.rpc(name, args);
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: join(directory, 'bad-inflate'), rpc }), /ZIP_INFLATE_SIZE/);
});

test('deflate trailing bytes cannot hide behind a valid decoded CRC and restamped archive SHA', async t => {
  const directory = await area(t), f = makeSyntheticSeed(directory, { mutateBytes: bytes => {
    const oldCentral = centralStart(bytes), insertAt = 30 + bytes.readUInt16LE(26) + bytes.readUInt32LE(18);
    const junk = Buffer.from('JUNK'), output = Buffer.concat([bytes.subarray(0, insertAt), junk, bytes.subarray(insertAt)]);
    output.writeUInt32LE(bytes.readUInt32LE(18) + junk.length, 18);
    let cursor = oldCentral + junk.length, first = true;
    while (cursor < output.length - 22) {
      if (first) output.writeUInt32LE(output.readUInt32LE(cursor + 20) + junk.length, cursor + 20);
      else output.writeUInt32LE(output.readUInt32LE(cursor + 42) + junk.length, cursor + 42);
      first = false; cursor += 46 + output.readUInt16LE(cursor + 28);
    }
    output.writeUInt32LE(oldCentral + junk.length, output.length - 6); return output;
  } });
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: join(directory, 'bad-trailing'), rpc: f.rpc }), /ZIP_DEFLATE_TRAILING/);
});

test('metadata hash and usable input manifest are verified before installing', async t => {
  const directory = await area(t), f = makeSyntheticSeed(directory), response = restampManifest(f, m => { m.latest_manifest_sha256 = 'a'.repeat(64); });
  const rpc = async (name, args) => name.endsWith('manifest_v2') ? { data: response, error: null } : f.rpc(name, args);
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: join(directory, 'bad-meta'), rpc }), /CACHE_METADATA_HASH/);
  const entries = syntheticSeedEntries(); entries.find(item => item.name === 'input-cache/latest.json').bytes = Buffer.from('{"schema":"WRONG"}');
  const invalid = makeSyntheticSeed(directory, { entries });
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: invalid.manifest.seed_id, cacheDir: join(directory, 'bad-input'), rpc: invalid.rpc }), /MANIFEST_HASH/);
});

test('exclusive bootstrap lock and CLI argument validation precede any private read', async t => {
  const directory = await area(t), target = join(directory, 'cache'); let calls = 0;
  const rpc = async () => { calls++; throw Error('UNEXPECTED'); };
  await writeFile(join(directory, '.cache.seed-bootstrap.lock'), 'SYNTHETIC_CONCURRENT_OWNER');
  await assert.rejects(bootstrapTaiwanMarketSeed({ seedId: 'a'.repeat(64), cacheDir: target, rpc }), { code: 'EEXIST' });
  for (const args of [[], ['--seed-id', 'a'.repeat(64)], ['--seed-id', 'a'.repeat(64), '--cache', target, '--cache', target], ['--url', 'https://example.invalid']])
    await assert.rejects(runTaiwanMarketSeedBootstrapCli(args, { rpc }), /ARGUMENTS/);
  assert.equal(calls, 0); assert.equal(await readFile(join(directory, '.cache.seed-bootstrap.lock'), 'utf8'), 'SYNTHETIC_CONCURRENT_OWNER');
});
