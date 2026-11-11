/** Disposable PostgreSQL + actual bootstrap. All cache/archive inputs below are
 * SYNTHETIC transport fixtures. No source, network, production or license use. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { bootstrapTaiwanMarketSeed, parseTaiwanMarketSeedManifest } from '../research/taiwan-market-seed.mjs';
import { makeSyntheticSeed, seedSha, syntheticSeedEntries } from './helpers/taiwanMarketSeedFixture.mjs';

if (!process.env.MA_PGLITE_MODULE) throw Error('MA_PGLITE_MODULE_REQUIRED');
const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite(); await db.waitReady;
const directory = await mkdtemp(join(tmpdir(), 'ma-seed-sql-'));
const f = makeSyntheticSeed(directory, { entries: syntheticSeedEntries({ padding: 1_060_000 }) });
const manifestRpc = 'stage_daily_ai_market_worker_seed_v2', chunkRpc = 'stage_daily_ai_market_worker_seed_chunk_v2';
const finalizeRpc = 'finalize_daily_ai_market_worker_seed_v2', readManifest = 'get_daily_ai_market_worker_seed_manifest_v2', readChunk = 'get_daily_ai_market_worker_seed_chunk_v2';
const methods = [manifestRpc, chunkRpc, finalizeRpc, readManifest, readChunk];
const argsForManifest = value => ({ p_manifest_text: value.manifestText, p_manifest_hash: value.manifestHash });
const argsForChunk = (value, index, seedId = value.manifest.seed_id) => ({ p_seed_id: seedId, p_chunk_index: index,
  p_chunk_sha256: value.manifest.chunks[index].sha256, p_chunk_bytes_base64: value.chunkResponse(index).data_base64 });
const finalizeArgs = value => ({ p_seed_id: value.manifest.seed_id, p_manifest_hash: value.manifestHash });
async function rpc(name, args) {
  assert.ok(methods.includes(name)); const values = Object.values(args);
  try { return { data: (await db.query(`select public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) result`, values)).rows[0].result, error: null }; }
  catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
}
async function call(name, args) { const result = await rpc(name, args); if (result.error) throw Object.assign(Error(result.error.message), { code: result.error.code }); return result.data; }
async function count(table) { await db.exec('reset role'); const result = (await db.query(`select count(*)::int n from vnext_market.${table}`)).rows[0].n; await db.exec('set role service_role'); return result; }
let phase = 0; const passed = label => console.log(JSON.stringify({ phase: ++phase, result: 'PASS', label }));
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create schema academy_private;create function academy_private.access_v11() returns text language sql as $$select 'denied'::text$$;
    create function public.is_research_owner_v1() returns boolean language sql as $$select false$$;
    create schema vnext_private;create table vnext_private.source_licenses(source text,storage_allowed boolean,derived_allowed boolean,
      commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
  for (const file of ['daily-ai-market-v2.candidate.sql', 'daily-ai-market-seed.candidate.sql']) {
    const text = readFileSync(new URL('../research/' + file, import.meta.url), 'utf8');
    try { await db.exec(text); } catch (error) { console.error(JSON.stringify({ sql_file: file, near: text.slice(Number(error.position) - 100, Number(error.position) + 100) })); throw error; }
  }
  const argumentsByMethod = [argsForManifest(f), argsForChunk(f, 0), finalizeArgs(f), { p_seed_id: f.manifest.seed_id }, { p_seed_id: f.manifest.seed_id, p_chunk_index: 0 }];
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    for (const [index, method] of methods.entries()) assert.equal((await rpc(method, argumentsByMethod[index])).error?.code, '42501');
    await assert.rejects(db.query('select * from vnext_market.worker_seed_chunks'), error => error.code === '42501');
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(db.query('select * from vnext_market.worker_seeds'), error => error.code === '42501');
  passed('service-only RPCs; anon/authenticated and direct service table reads denied');

  for (const mutate of [m => { m.archive_bytes = null; }, m => { m.chunk_count++; }, m => { m.chunks[0].bytes--; },
    m => { m.cache_state_sha256 = null; }, m => { m.entry_count = 20001; }, m => { m.uncompressed_bytes = 1073741825; }]) {
    const bad = globalThis.structuredClone(f.manifest); mutate(bad); const text = JSON.stringify(bad);
    assert.ok((await rpc(manifestRpc, { p_manifest_text: text, p_manifest_hash: seedSha(text) })).error);
  }
  assert.equal((await rpc(manifestRpc, { ...argsForManifest(f), p_manifest_hash: 'a'.repeat(64) })).error.message, 'MARKET_SEED_MANIFEST_HASH');
  assert.equal((await call(manifestRpc, argsForManifest(f))).replayed, false);
  assert.equal((await call(manifestRpc, argsForManifest(f))).replayed, true);
  assert.equal((await rpc(readManifest, { p_seed_id: f.manifest.seed_id })).error.message, 'MARKET_SEED_NOT_COMPLETE');
  assert.equal((await rpc(readChunk, { p_seed_id: f.manifest.seed_id, p_chunk_index: 0 })).error.message, 'MARKET_SEED_NOT_COMPLETE');
  assert.equal((await rpc(finalizeRpc, finalizeArgs(f))).error.message, 'MARKET_SEED_INCOMPLETE');
  assert.equal(await count('worker_seed_completions'), 0);
  passed('exact manifest hash/types/limits and incomplete read/finalization gates');

  assert.equal((await rpc(chunkRpc, { ...argsForChunk(f, 0), p_chunk_index: 2 })).error.message, 'MARKET_SEED_CHUNK_INDEX');
  assert.equal((await rpc(chunkRpc, { ...argsForChunk(f, 0), p_chunk_sha256: 'a'.repeat(64) })).error.message, 'MARKET_SEED_CHUNK_HASH');
  assert.equal((await rpc(chunkRpc, { ...argsForChunk(f, 0), p_chunk_bytes_base64: 'AAAA\n' })).error.message, 'MARKET_SEED_CHUNK_ENCODING');
  assert.equal((await call(chunkRpc, argsForChunk(f, 1))).replayed, false);
  assert.equal((await rpc(finalizeRpc, finalizeArgs(f))).error.message, 'MARKET_SEED_INCOMPLETE');
  assert.equal((await call(chunkRpc, argsForChunk(f, 0))).replayed, false);
  assert.equal((await call(finalizeRpc, finalizeArgs(f))).replayed, false);
  for (const [index, method] of [manifestRpc, chunkRpc, finalizeRpc].entries()) assert.equal((await call(method, argumentsByMethod[index])).replayed, true);
  assert.equal(await count('worker_seed_completions'), 1);
  const mismatch = { ...f.manifest, created_at: '2019-01-01T00:00:00Z' }, mismatchText = JSON.stringify(mismatch);
  assert.equal((await rpc(manifestRpc, { p_manifest_text: mismatchText, p_manifest_hash: seedSha(mismatchText) })).error.message, 'MARKET_SEED_MANIFEST_REPLAY_CONFLICT');
  await db.exec('reset role');
  await assert.rejects(db.query('update vnext_market.worker_seed_chunks set stored_at=clock_timestamp() where seed_id=$1', [f.manifest.seed_id]), /MARKET_IMMUTABLE/);
  await assert.rejects(db.query('delete from vnext_market.worker_seed_completions where seed_id=$1', [f.manifest.seed_id]), /MARKET_IMMUTABLE/);
  await db.exec('set role service_role');
  passed('out-of-order immutable chunk staging; exact completed ACK replay; no mutation');

  const manifestResponse = await call(readManifest, { p_seed_id: f.manifest.seed_id });
  assert.equal(parseTaiwanMarketSeedManifest(manifestResponse, f.manifest.seed_id).manifest_hash, f.manifestHash);
  for (let index = 0; index < f.manifest.chunk_count; index++) assert.deepEqual(await call(readChunk, { p_seed_id: f.manifest.seed_id, p_chunk_index: index }), f.chunkResponse(index));
  const result = await bootstrapTaiwanMarketSeed({ seedId: f.manifest.seed_id, cacheDir: join(directory, 'installed'), rpc });
  assert.equal(result.state, 'INSTALLED'); assert.equal(result.chunks, 2);
  for (const item of f.entries) assert.deepEqual(await readFile(join(directory, 'installed', item.name.slice(12))), item.bytes);
  assert.equal(result.source_timestamps_rewritten, false);
  passed('actual PostgreSQL readers -> raw SHA/CRC extraction -> existing usable manifest loader -> atomic cache');

  const wrong = { ...f.manifest, seed_id: seedSha('SYNTHETIC_WRONG_ARCHIVE'), archive_sha256: seedSha('SYNTHETIC_WRONG_ARCHIVE') };
  const wrongText = JSON.stringify(wrong), wrongHash = seedSha(wrongText);
  await call(manifestRpc, { p_manifest_text: wrongText, p_manifest_hash: wrongHash });
  for (let index = 0; index < f.manifest.chunk_count; index++) await call(chunkRpc, argsForChunk(f, index, wrong.seed_id));
  assert.equal((await rpc(finalizeRpc, { p_seed_id: wrong.seed_id, p_manifest_hash: wrongHash })).error.message, 'MARKET_SEED_ARCHIVE_HASH');
  const unsafe = makeSyntheticSeed(directory, { entries: [...syntheticSeedEntries(), { name: 'input-cache/../outside', bytes: Buffer.from('SYNTHETIC') }] });
  await call(manifestRpc, argsForManifest(unsafe)); await call(chunkRpc, argsForChunk(unsafe, 0));
  assert.equal((await rpc(finalizeRpc, finalizeArgs(unsafe))).error.message, 'MARKET_SEED_ZIP_PATH');
  assert.equal((await rpc(readManifest, { p_seed_id: unsafe.manifest.seed_id })).error.message, 'MARKET_SEED_NOT_COMPLETE');
  assert.equal(await count('worker_seed_completions'), 1);
  passed('wrong assembled SHA and unsafe ZIP directory roll back completion atomically');

  await db.exec('reset role');
  const before = (await db.query('select count(*)::int n from vnext_market.worker_seed_chunks')).rows[0].n;
  await db.exec(readFileSync(new URL('../research/daily-ai-market-seed.rollback.sql', import.meta.url), 'utf8'));
  await db.exec('set role service_role');
  for (const [index, method] of methods.entries()) assert.equal((await rpc(method, argumentsByMethod[index])).error.code, '42501');
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from vnext_market.worker_seed_chunks')).rows[0].n, before);
  const rls = (await db.query("select bool_and(relrowsecurity and relforcerowsecurity) enabled from pg_class where oid in('vnext_market.worker_seeds'::regclass,'vnext_market.worker_seed_chunks'::regclass,'vnext_market.worker_seed_completions'::regclass)")).rows[0].enabled;
  assert.equal(rls, true);
  await db.exec(`grant execute on function public.get_daily_ai_market_worker_seed_manifest_v2(text) to service_role`);
  await db.exec(readFileSync(new URL('../research/daily-ai-market-v2.rollback.sql', import.meta.url), 'utf8'));
  await db.exec('set role service_role');
  assert.equal((await rpc(readManifest, { p_seed_id: f.manifest.seed_id })).error.code, '42501');
  passed('seed-only and whole-V2 rollbacks disable transport while retaining all immutable bytes and RLS');
  console.log(JSON.stringify({ result: 'PASS', phases: phase, fixture: 'SYNTHETIC', network_calls: 0,
    archive_bytes: f.manifest.archive_bytes, chunks: f.manifest.chunk_count, production_written: false }));
} finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
