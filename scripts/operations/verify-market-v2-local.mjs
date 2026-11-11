// Real retained public source bytes, isolated local PostgreSQL only.
// No provider requests, credentials, production connections, reviews or approval.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';
import { TextDecoder } from 'node:util';
import { stageDailyAiMarketCapture, stageDailyAiMarketWorkPlan, runDailyAiMarketShard, finishDailyAiMarketEdition } from '../../research/daily-ai-market-stage.mjs';
import { prepareDailyAiMarketPriceInputChunks, prepareDailyAiMarketPriceReferenceBatches, stageDailyAiMarketPricePrepared,
  runDailyAiMarketShardWithReferences } from '../../research/daily-ai-market-references-stage.mjs';

const options = {}, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!['--source-root', '--history-root', '--database-path', '--output', '--universe', '--plan', '--run', '--run-manifest', '--financial-manifest', '--revenue-receipt', '--codec-mode', '--action-manifest', '--valuation-receipt', '--resume-verified-staging'].includes(argv[i]) || !argv[i + 1] || options[argv[i]]) throw Error('LOCAL_VERIFY_ARGUMENTS');
  options[argv[i]] = argv[i] === '--codec-mode' ? argv[i + 1] : resolve(argv[i + 1]);
}
for (const key of ['--source-root', '--database-path', '--output']) if (!options[key]) throw Error('LOCAL_VERIFY_PATHS_REQUIRED');
if (options['--run'] && options['--run-manifest']) throw Error('LOCAL_VERIFY_ONE_RUN_FORMAT');
const runPath = options['--run'] ?? options['--run-manifest'];
if ((options['--universe'] || options['--plan'] || runPath) && !(options['--universe'] && options['--plan'] && runPath)) throw Error('LOCAL_VERIFY_RUN_PATH_SET_REQUIRED');
if (options['--financial-manifest'] && options['--codec-mode'] !== 'exact-fixtures') throw Error('LOCAL_PGLITE_BIG5_REQUIRES_EXPLICIT_EXACT_FIXTURES_MODE');
if (!options['--financial-manifest'] && options['--codec-mode']) throw Error('LOCAL_CODEC_MODE_REQUIRES_FINANCIAL_MANIFEST');
if (options['--revenue-receipt'] && !options['--financial-manifest']) throw Error('LOCAL_REVENUE_REQUIRES_SHARED_FINANCIAL_CSV_EXTENSION');
if (!process.env.MA_PGLITE_MODULE) throw Error('MA_PGLITE_MODULE_REQUIRED');
const sql = readFileSync(new URL('../../research/daily-ai-market-v2.candidate.sql', import.meta.url), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex'), sqlHash = sha(sql);
// Validate large whole-universe runs without allocating a second complete
// canonical document alongside the parsed 200+ MB research artifact.
function largeCanonicalHash(value) {
  const digest = createHash('sha256'); let fragments = [], size = 0;
  const flush = () => { if (fragments.length) digest.update(fragments.join('')); fragments = []; size = 0; };
  const append = text => { fragments.push(text); size += text.length; if (size >= 65_536) flush(); };
  const visit = item => {
    if (Array.isArray(item)) { append('['); item.forEach((v, i) => { if (i) append(','); visit(v); }); append(']'); }
    else if (item !== null && typeof item === 'object') {
      append('{'); Object.keys(item).sort().forEach((key, i) => { if (i) append(','); append(JSON.stringify(key)); append(':'); visit(item[key]); }); append('}');
    } else append(JSON.stringify(item));
  };
  visit(value); flush(); return digest.digest('hex');
}
function loadRunArtifact() {
  const document = JSON.parse(readFileSync(runPath, 'utf8'));
  if (!options['--run-manifest']) return document;
  const root = dirname(runPath), { shards: files, peer_price_research_count, long_price_research_count, history_manifest,
    financial_history_path, ...summary } = document;
  void peer_price_research_count; void long_price_research_count; void history_manifest; void financial_history_path;
  if (!Array.isArray(files) || files.length < 1 || files.length > 160) throw Error('LOCAL_RUN_MANIFEST_SHARDS');
  const shards = files.map(item => {
    const path = resolve(item.file);
    if (relative(root, path).startsWith('..')) throw Error('LOCAL_RUN_SHARD_PATH');
    const shard = JSON.parse(readFileSync(path, 'utf8'));
    if (largeCanonicalHash(shard) !== item.sha256 || shard.shard_id !== item.shard_id
      || shard.stocks.length !== item.stocks || shard.cards.length !== item.cards) throw Error('LOCAL_RUN_SHARD_HASH');
    return shard;
  });
  const read = name => JSON.parse(readFileSync(resolve(root, name + '.json'), 'utf8'));
  return { ...summary, shards, price_research: read('price-research'), price_input_pool: read('price-input-pool'),
    price_input_bindings: read('price-input-bindings'), diagnostics: read('diagnostics'), acquisition_queue: read('acquisition-queue') };
}
const sourceRoot = options['--source-root'], dbPath = options['--database-path'], output = options['--output'];
const continuationDirectory = options['--resume-verified-staging'] ?? null;
if (continuationDirectory && (!runPath || continuationDirectory === output || !existsSync(dbPath))) throw Error('LOCAL_CONTINUATION_SCOPE');
const continuation = continuationDirectory ? { schema:'MARKET_LOCAL_VERIFIED_CONTINUATION_V1', directory:continuationDirectory,
  source_files:Object.fromEntries(['run-staging-context.json','run-staging.json','price-staging.json'].map(name => {
    const bytes=readFileSync(resolve(continuationDirectory,name)); return [name,{sha256:sha(bytes),bytes:bytes.length,value:JSON.parse(bytes)}];
  })), completed_shards_verified:0, price_references_verified:0, rotated_expired_claims:[],
  copied_database_readback_required:true, production_writes:0, provider_requests:0 } : null;
const identityPath = dbPath + '.source.json';
if (existsSync(dbPath) && (!existsSync(identityPath) || JSON.parse(readFileSync(identityPath, 'utf8')).sql_sha256 !== sqlHash)) throw Error('LOCAL_DATABASE_SCHEMA_CHANGED');
mkdirSync(output, { recursive: true });
const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite(dbPath);
await db.waitReady;
const catalog = JSON.parse(readFileSync(new URL('../../research/taiwan-market-sources.json', import.meta.url), 'utf8'));
const allowed = new Set([...catalog.sources.map(s => s.id), 'twse_companies', 'tpex_companies', 'emerging_companies']);
const receipts = new Map();
for (const file of readdirSync(sourceRoot).filter(n => /^acquisition-.*\.json$/.test(n)).sort()) {
  const capture = JSON.parse(readFileSync(resolve(sourceRoot, file), 'utf8'));
  for (const receipt of capture.receipts ?? []) if (receipt.state === 'CAPTURED' && allowed.has(receipt.source_id)) {
    const key = receipt.source_id + ':' + receipt.sha256 + ':' + receipt.received_at;
    if (!receipts.has(key)) receipts.set(key, { receipt, root: sourceRoot, path: resolve(receipt.raw_path) });
  }
}
if (options['--history-root']) {
  const historyRoot = options['--history-root'];
  for (const file of readdirSync(resolve(historyRoot, 'public-receipts')).filter(n => /^(TWSE|TPEX)_DAILY_\d{8}-[a-f0-9]{64}\.json$/.test(n)).sort()) {
    const receipt = JSON.parse(readFileSync(resolve(historyRoot, 'public-receipts', file), 'utf8'));
    if (receipt.state !== 'CAPTURED' || !/^(TWSE|TPEX)_DAILY_\d{8}$/.test(receipt.source_id)
      || file !== receipt.source_id + '-' + receipt.sha256 + '.json') throw Error('LOCAL_HISTORY_RECEIPT_IDENTITY');
    const key = receipt.source_id + ':' + receipt.sha256 + ':' + receipt.received_at;
    if (!receipts.has(key)) receipts.set(key, { receipt, root: historyRoot, path: resolve(historyRoot, 'http-entity', file) });
  }
}
let financialManifest = null;
const codecSamples = [], extensionPath = new URL('../../research/daily-ai-market-financial-csv.candidate.sql', import.meta.url);
const extensionSql = options['--financial-manifest'] ? readFileSync(extensionPath, 'utf8') : null;
const extensionHash = extensionSql ? sha(extensionSql) : null;
if (options['--financial-manifest']) {
  financialManifest = JSON.parse(readFileSync(options['--financial-manifest'], 'utf8'));
  const { manifest_hash, ...body } = financialManifest;
  if (financialManifest.schema !== 'TAIWAN_FINANCIAL_CSV_MANIFEST_V1' || largeCanonicalHash(body) !== manifest_hash
    || !Array.isArray(financialManifest.documents)) throw Error('LOCAL_FINANCIAL_MANIFEST_HASH');
  const financialRoot = dirname(dirname(options['--financial-manifest']));
  for (const document of financialManifest.documents) {
    const path = resolve(document.raw_csv_file), receiptPath = resolve(document.public_receipt_file);
    if ([path, receiptPath].some(p => relative(financialRoot, p).startsWith('..'))) throw Error('LOCAL_FINANCIAL_PATH_SCOPE');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')), raw = readFileSync(path);
    const decoded = new TextDecoder('big5', { fatal: true }).decode(raw);
    if (receipt.source_id !== document.source_id || receipt.encoding !== 'CP950' || sha(raw) !== receipt.sha256
      || raw.length !== receipt.bytes || sha(decoded) !== receipt.decoded_text_sha256) throw Error('LOCAL_FINANCIAL_ENCODING_BINDING');
    codecSamples.push({ raw_hash: sha(raw), decoded });
    const key = receipt.source_id + ':' + receipt.sha256 + ':' + receipt.received_at;
    if (!receipts.has(key)) receipts.set(key, { receipt, root: financialRoot, path });
  }
}
const revenueSql = options['--revenue-receipt'] ? readFileSync(new URL('../../research/daily-ai-market-revenue-csv.candidate.sql', import.meta.url), 'utf8') : null;
const revenueHash = revenueSql ? sha(revenueSql) : null;
if (options['--revenue-receipt']) {
  const receipt = JSON.parse(readFileSync(options['--revenue-receipt'], 'utf8'));
  const root = dirname(options['--revenue-receipt']), path = resolve(receipt.raw_path);
  if (relative(root, path).startsWith('..') || receipt.encoding !== 'UTF8' || receipt.row_layout !== 'HEADER_AND_DATA_ARRAYS_V1') throw Error('LOCAL_REVENUE_RECEIPT');
  const key = receipt.source_id + ':' + receipt.sha256 + ':' + receipt.received_at;
  if (!receipts.has(key)) receipts.set(key, { receipt, root, path });
}
const publicSql = options['--action-manifest'] || options['--valuation-receipt']
  ? readFileSync(new URL('../../research/daily-ai-market-public-supplements.candidate.sql', import.meta.url), 'utf8') : null;
const publicHash = publicSql ? sha(publicSql) : null;
const actionSql = options['--action-manifest']
  ? readFileSync(new URL('../../research/daily-ai-market-action-coverage.candidate.sql', import.meta.url), 'utf8') : null;
const actionHash = actionSql ? sha(actionSql) : null;
const actionIdSql = actionSql
  ? readFileSync(new URL('../../research/daily-ai-market-action-evidence-id.candidate.sql', import.meta.url), 'utf8') : null;
if (options['--action-manifest']) {
  const manifest = JSON.parse(readFileSync(options['--action-manifest'], 'utf8')), root = dirname(options['--action-manifest']);
  if (!Array.isArray(manifest.captures) || manifest.captures.length !== 3
    || new Set(manifest.captures.map(item => item.receipt?.source_id)).size !== 3) throw Error('LOCAL_ACTION_SOURCE_SET');
  for (const item of manifest.captures) {
    const receipt = item.receipt, path = resolve(item.raw_path);
    if (relative(root, path).startsWith('..') || !['tpex_ex_right', 'tpex_capital_reduction', 'tpex_par_value_change'].includes(receipt.source_id)) throw Error('LOCAL_ACTION_SOURCE_SCOPE');
    const key = receipt.source_id + ':' + receipt.sha256 + ':' + receipt.received_at;
    if (!receipts.has(key)) receipts.set(key, { receipt, root, path });
  }
}
if (options['--valuation-receipt']) {
  const receipt = JSON.parse(readFileSync(options['--valuation-receipt'], 'utf8'));
  const root = dirname(options['--valuation-receipt']), path = resolve(receipt.raw_path);
  if (relative(root, path).startsWith('..') || !/^TWSE_VALUATION_\d{8}$/.test(receipt.source_id)) throw Error('LOCAL_VALUATION_SOURCE_SCOPE');
  const key = receipt.source_id + ':' + receipt.sha256 + ':' + receipt.received_at;
  if (!receipts.has(key)) receipts.set(key, { receipt, root, path });
}
const saved = [];
try {
  if (!existsSync(identityPath)) {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create schema academy_private;create function academy_private.access_v11() returns text language sql as $$select 'denied'::text$$;
      create function public.is_research_owner_v1() returns boolean language sql as $$select false$$;
      create schema vnext_private;create table vnext_private.source_licenses(source text,storage_allowed boolean,derived_allowed boolean,
       commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
    await db.exec(sql);
    writeFileSync(identityPath, JSON.stringify({ schema: 'MARKET_V2_LOCAL_DATABASE_SOURCE_V1', sql_sha256: sqlHash,
      created_at: new Date().toISOString(), production_database: false }) + '\n', { flag: 'wx' });
  }
  if (extensionSql) {
    const extensionIdentity = dbPath + '.financial-csv.json';
    if (existsSync(extensionIdentity)) {
      const prior = JSON.parse(readFileSync(extensionIdentity, 'utf8'));
      if (prior.extension_sha256 !== extensionHash || prior.codec_mode !== 'EXACT_RETAINED_BYTES_FIXTURE_LOOKUP') throw Error('LOCAL_FINANCIAL_EXTENSION_CHANGED');
    } else {
      await db.exec(extensionSql);
      await db.exec(`create schema fixture_market_codec;create table fixture_market_codec.samples(raw_hash text primary key,decoded text not null);
        create or replace function vnext_market.decode_big5_exact(p_raw bytea) returns text language plpgsql immutable set search_path='' as $$
        declare value text;begin select decoded into value from fixture_market_codec.samples where raw_hash=encode(sha256(p_raw),'hex');
         if not found then raise exception 'EXACT_LOCAL_CODEC_FIXTURE_REQUIRED';end if;return value;end $$;`);
      writeFileSync(extensionIdentity, JSON.stringify({ extension_sha256: extensionHash, codec_mode: 'EXACT_RETAINED_BYTES_FIXTURE_LOOKUP',
        production_database: false, native_big5_executed_in_this_database: false }) + '\n', { flag: 'wx' });
    }
    for (const sample of codecSamples) {
      const prior = (await db.query('select decoded from fixture_market_codec.samples where raw_hash=$1', [sample.raw_hash])).rows[0];
      if (prior && prior.decoded !== sample.decoded) throw Error('LOCAL_CODEC_FIXTURE_CHANGED');
      if (!prior) await db.query('insert into fixture_market_codec.samples values($1,$2)', [sample.raw_hash, sample.decoded]);
    }
  }
  if (revenueSql) {
    const revenueIdentity = dbPath + '.revenue-csv.json';
    if (existsSync(revenueIdentity)) {
      if (JSON.parse(readFileSync(revenueIdentity, 'utf8')).extension_sha256 !== revenueHash) throw Error('LOCAL_REVENUE_EXTENSION_CHANGED');
    } else {
      await db.exec(revenueSql);
      writeFileSync(revenueIdentity, JSON.stringify({ extension_sha256: revenueHash, production_database: false, codec_mode: 'NATIVE_UTF8' }) + '\n', { flag: 'wx' });
    }
  }
  for (const extension of [{ sql: publicSql, hash: publicHash, name: 'public-supplements' },
    { sql: actionSql, hash: actionHash, name: 'action-coverage' },
    { sql: actionIdSql, hash: actionIdSql ? sha(actionIdSql) : null, name: 'action-evidence-id' }]) if (extension.sql) {
    const path = dbPath + '.' + extension.name + '.json';
    if (existsSync(path)) {
      if (JSON.parse(readFileSync(path, 'utf8')).extension_sha256 !== extension.hash) throw Error('LOCAL_SOURCE_EXTENSION_CHANGED:' + extension.name);
    } else {
      await db.exec(extension.sql);
      writeFileSync(path, JSON.stringify({ extension_sha256: extension.hash, production_database: false, codec_mode: 'NATIVE_UTF8' }) + '\n', { flag: 'wx' });
    }
  }
  await db.exec('set role service_role');
  const allowedRpcs = new Set(['stage_daily_ai_market_capture_v2', 'stage_daily_ai_market_work_plan_v2', 'claim_daily_ai_market_shard_v2',
    'stage_daily_ai_market_shard_v2', 'finish_daily_ai_market_edition_v2', 'stage_daily_ai_market_encoded_capture_v2', 'stage_daily_ai_market_revenue_capture_v2',
    'stage_daily_ai_market_public_capture_v2', 'stage_daily_ai_market_price_inputs_v2', 'stage_daily_ai_market_price_references_v2',
    'stage_daily_ai_market_price_input_chunk_v2', 'finalize_daily_ai_market_price_inputs_v2',
    'stage_daily_ai_market_shard_with_references_v2']);
  const rpc = async (name, args) => {
    if (!allowedRpcs.has(name)) throw Error('PREPARATION_ONLY_LOCAL_PORT');
    const values = Object.values(args);
    try { return { data: (await db.query(`select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) result`, values)).rows[0].result, error: null }; }
    catch (error) { console.error(JSON.stringify({ sql_error: error.code, message: error.message })); return { data: null, error: { code: error.code, message: error.message } }; }
  };
  for (const { receipt, root, path } of receipts.values()) {
    const local = relative(root, path);
    if (local.startsWith('..') || local.startsWith('/')) throw Error('RAW_SOURCE_OUTSIDE_CAPTURE_DIRECTORY');
    const bytes = readFileSync(path), result = await stageDailyAiMarketCapture({ rpc, receipt, bytes });
    const record = { source_id: receipt.source_id, received_at: receipt.received_at, bytes: bytes.length, source_sha256: sha(bytes), ...result };
    saved.push(record); console.log(JSON.stringify(record));
    writeFileSync(resolve(output, 'capture-staging.json'), JSON.stringify({ schema: 'MARKET_V2_REAL_LOCAL_CAPTURE_STAGING_V1',
      sql_sha256: sqlHash, records: saved, completed: saved.length, expected: receipts.size, production_writes: 0, provider_requests: 0 }, null, 2) + '\n');
    if (result.state !== 'STAGED') throw Error('REAL_CAPTURE_STAGING_FAILED:' + receipt.source_id);
  }
  let edition = null, referenceHash = null, referenceChunksHash = null, referenceCapacityHash = null, bvpsHash = null, referencePerformanceHash = null, shortScopeHash = null, priceState = null;
  if (runPath) {
    const universe = JSON.parse(readFileSync(options['--universe'], 'utf8'));
    const plan = JSON.parse(readFileSync(options['--plan'], 'utf8'));
    const run = loadRunArtifact(), { run_hash, ...body } = run;
    if (run.schema !== 'TAIWAN_MARKET_RESEARCH_RUN_V1' || largeCanonicalHash(body) !== run_hash
      || run.plan_hash !== plan.plan_hash || run.universe_hash !== universe.universe_hash || run.shards.length !== plan.shards.length
      || run.member_published !== false || run.methodology_approved !== false) throw Error('LOCAL_RUN_BINDING');
    const withReferences = Object.hasOwn(run, 'price_input_pool');
    if (withReferences) {
      const referenceSql = readFileSync(new URL('../../research/daily-ai-market-references.candidate.sql', import.meta.url), 'utf8');
      referenceHash = sha(referenceSql); const referenceIdentity = dbPath + '.references.json';
      if (existsSync(referenceIdentity)) {
        if (JSON.parse(readFileSync(referenceIdentity, 'utf8')).extension_sha256 !== referenceHash) throw Error('LOCAL_REFERENCE_EXTENSION_CHANGED');
      } else {
        await db.exec('reset role'); await db.exec(referenceSql); await db.exec('set role service_role');
        writeFileSync(referenceIdentity, JSON.stringify({ extension_sha256: referenceHash, production_database: false }) + '\n', { flag: 'wx' });
      }
      const chunkSql = readFileSync(new URL('../../research/daily-ai-market-reference-chunks.candidate.sql', import.meta.url), 'utf8');
      referenceChunksHash = sha(chunkSql); const chunkIdentity = dbPath + '.reference-chunks.json';
      if (existsSync(chunkIdentity)) {
        if (JSON.parse(readFileSync(chunkIdentity, 'utf8')).extension_sha256 !== referenceChunksHash) throw Error('LOCAL_REFERENCE_CHUNKS_EXTENSION_CHANGED');
      } else {
        await db.exec('reset role'); await db.exec(chunkSql); await db.exec('set role service_role');
        writeFileSync(chunkIdentity, JSON.stringify({ extension_sha256: referenceChunksHash, production_database: false }) + '\n', { flag: 'wx' });
      }
      const capacitySql = readFileSync(new URL('../../research/daily-ai-market-reference-capacity.candidate.sql', import.meta.url), 'utf8');
      referenceCapacityHash = sha(capacitySql); const capacityIdentity = dbPath + '.reference-capacity.json';
      if (existsSync(capacityIdentity)) {
        if (JSON.parse(readFileSync(capacityIdentity, 'utf8')).extension_sha256 !== referenceCapacityHash) throw Error('LOCAL_REFERENCE_CAPACITY_EXTENSION_CHANGED');
      } else {
        await db.exec('reset role'); await db.exec(capacitySql); await db.exec('set role service_role');
        writeFileSync(capacityIdentity, JSON.stringify({ extension_sha256: referenceCapacityHash, production_database: false }) + '\n', { flag: 'wx' });
      }
      if (run.price_research.some(row => ['medium', 'long'].some(key => row[key]?.method_version === 'TAIWAN_REPORTED_BVPS_PEER_V1'))) {
        const bvpsSql = readFileSync(new URL('../../research/daily-ai-market-bvps.candidate.sql', import.meta.url), 'utf8');
        bvpsHash = sha(bvpsSql); const bvpsIdentity = dbPath + '.reported-bvps.json';
        if (existsSync(bvpsIdentity)) {
          if (JSON.parse(readFileSync(bvpsIdentity, 'utf8')).extension_sha256 !== bvpsHash) throw Error('LOCAL_REPORTED_BVPS_EXTENSION_CHANGED');
        } else {
          await db.exec('reset role'); await db.exec(bvpsSql); await db.exec('set role service_role');
          writeFileSync(bvpsIdentity, JSON.stringify({ extension_sha256: bvpsHash, production_database: false }) + '\n', { flag: 'wx' });
        }
        const performanceSql = readFileSync(new URL('../../research/daily-ai-market-reference-performance.candidate.sql', import.meta.url), 'utf8');
        referencePerformanceHash = sha(performanceSql); const performanceIdentity = dbPath + '.reference-performance.json';
        if (existsSync(performanceIdentity)) {
          if (JSON.parse(readFileSync(performanceIdentity, 'utf8')).extension_sha256 !== referencePerformanceHash) throw Error('LOCAL_REFERENCE_PERFORMANCE_EXTENSION_CHANGED');
        } else {
          await db.exec('reset role'); await db.exec(performanceSql); await db.exec('set role service_role');
          writeFileSync(performanceIdentity, JSON.stringify({ extension_sha256: referencePerformanceHash, production_database: false }) + '\n', { flag: 'wx' });
        }
        const shortScopeSql = readFileSync(new URL('../../research/daily-ai-market-short-scope.candidate.sql', import.meta.url), 'utf8');
        shortScopeHash = sha(shortScopeSql); const shortScopeIdentity = dbPath + '.short-scope.json';
        if (existsSync(shortScopeIdentity)) {
          if (JSON.parse(readFileSync(shortScopeIdentity, 'utf8')).extension_sha256 !== shortScopeHash) throw Error('LOCAL_SHORT_SCOPE_EXTENSION_CHANGED');
        } else {
          await db.exec('reset role'); await db.exec(shortScopeSql); await db.exec('set role service_role');
          writeFileSync(shortScopeIdentity, JSON.stringify({extension_sha256:shortScopeHash,production_database:false})+'\n',{flag:'wx'});
        }
      }
    }
    const contextPath = resolve(output, 'run-staging-context.json');
    const context = existsSync(contextPath) ? JSON.parse(readFileSync(contextPath, 'utf8')) : continuation ? JSON.parse(JSON.stringify(continuation.source_files['run-staging-context.json'].value)) : {
      schema: 'MARKET_V2_REAL_LOCAL_RUN_CONTEXT_V1', sql_sha256: sqlHash, plan_hash: plan.plan_hash, run_hash,
      expires_at: new Date(Date.parse(plan.cutoff) + 24 * 3_600_000).toISOString(),
      shards: plan.shards.map(s => ({ shard_id: s.shard_id, request_key: randomUUID() })),
    };
    if (context.sql_sha256 !== sqlHash || context.plan_hash !== plan.plan_hash || context.run_hash !== run_hash
      || context.shards.length !== plan.shards.length || context.shards.some((item,index)=>item.shard_id!==plan.shards[index].shard_id)) throw Error('LOCAL_RUN_CONTEXT_CHANGED');
    const completedReadbacks = new Map();
    if (continuation) {
      const prior=continuation.source_files['run-staging.json'].value;
      if (!shortScopeHash || prior.schema!=='MARKET_V2_REAL_LOCAL_RUN_STAGING_V1' || prior.sql_sha256!==sqlHash
        || prior.plan_hash!==plan.plan_hash || prior.run_hash!==run_hash || !Array.isArray(prior.records)
        || prior.records.length>context.shards.length || prior.records.some((r,i)=>r.index!==i || r.shard_id!==context.shards[i].shard_id)) throw Error('LOCAL_CONTINUATION_BINDING');
      await db.exec('reset role');
      try {
        const rows=(await db.query(`select s.id,s.state,s.lease_until,s.result_hash,
          r.result_hash stored_result_hash,vnext_market.digest(r.result_text) stored_text_hash,
          (select count(*)::int from vnext_market.stock_results x where x.plan_id=s.plan_id and x.shard_id=s.id) stocks,
          (select count(*)::int from vnext_market.cards x join vnext_market.stock_results z on z.plan_id=x.plan_id and z.security_id=x.security_id where z.shard_id=s.id) cards
          from vnext_market.shards s left join vnext_market.shard_results r on r.shard_id=s.id where s.plan_id=$1 order by s.ordinal`,[plan.plan_hash])).rows;
        if(rows.length!==context.shards.length)throw Error('LOCAL_CONTINUATION_SHARDS');
        for(let i=0;i<rows.length;i++) {
          const row=rows[i], record=prior.records[i],expected=plan.shards[i];
          if(row.id!==expected.shard_id)throw Error('LOCAL_CONTINUATION_SHARD_ORDER');
          if(record?.state==='STAGED') {
            if(row.state!=='COMPLETE'||row.result_hash!==record.result_hash||row.stored_result_hash!==record.result_hash
              ||row.stored_text_hash!==record.result_hash||row.stocks!==expected.security_ids.length||row.cards!==expected.expected_cards)
              throw Error('LOCAL_CONTINUATION_COMPLETED_SHARD');
            completedReadbacks.set(row.id,{...record,verification_mode:'EXACT_DATABASE_READBACK_NO_MUTATION'});
            continuation.completed_shards_verified++;
          } else {
            if(row.result_hash!==null||row.stored_result_hash!==null||row.stored_text_hash!==null||row.stocks!==0||row.cards!==0)
              throw Error('LOCAL_CONTINUATION_UNACKNOWLEDGED_RESULT');
            if(record) {
              if(record.state!=='REJECTED'||record.reason!=='MARKET_REFERENCE_SHORT_BAR_VALUES'||row.state!=='LEASED'
                ||Date.parse(row.lease_until)>Date.now())throw Error('LOCAL_CONTINUATION_REJECTION_NOT_RESOLVED');
              const old=context.shards[i].request_key;context.shards[i].request_key=randomUUID();
              continuation.rotated_expired_claims.push({shard_id:row.id,prior_request_key:old,new_request_key:context.shards[i].request_key,
                prior_reason:record.reason,database_result:'CONFIRMED_NOT_COMMITTED',correction:'MARKET_SPECIFIC_SHORT_SESSION_SCOPE'});
            } else if(row.state!=='PENDING')throw Error('LOCAL_CONTINUATION_UNRECONCILED_CLAIM');
          }
        }
      } finally { await db.exec('set role service_role'); }
    }
    if (!existsSync(contextPath)) writeFileSync(contextPath, JSON.stringify(context, null, 2) + '\n', { flag: 'wx' });
    const planned = await stageDailyAiMarketWorkPlan({ rpc, universe, plan });
    console.log(JSON.stringify({ phase: 'PLAN', ...planned }));
    if (planned.state !== 'STAGED') throw Error('REAL_PLAN_STAGING_FAILED');
    let referencesBySecurity = null;
    if (withReferences) {
      const input = prepareDailyAiMarketPriceInputChunks({ planHash: plan.plan_hash, inputs: run.price_input_pool,
        bindings: run.price_input_bindings, inputPoolHash: run.price_input_pool_hash });
      const references = prepareDailyAiMarketPriceReferenceBatches({ planHash: plan.plan_hash, references: run.price_research,
        inputPoolHash: run.price_input_pool_hash }); referencesBySecurity = references.bySecurity;
      priceState = { input_pool_hash: run.price_input_pool_hash, bindings: Object.keys(run.price_input_bindings).length,
        pool_bytes: Buffer.byteLength(JSON.stringify({ schema: 'TAIWAN_MARKET_PRICE_INPUT_POOL_V1', plan_hash: plan.plan_hash,
          input_pool_hash: run.price_input_pool_hash, inputs: run.price_input_pool, bindings: run.price_input_bindings })),
        transport: 'BOUNDED_CHUNKS_V1', chunks: input.chunks.length, original_body_hash: input.original_body_hash,
        batches: references.batches.length, records: [] };
      if(continuation) {
        const prior=continuation.source_files['price-staging.json'].value,prepared=[...input.chunks,input.finalize,...references.batches];
        if(prior.schema!=='MARKET_V2_REAL_LOCAL_PRICE_STAGING_V1'||prior.plan_hash!==plan.plan_hash||prior.run_hash!==run_hash
          ||prior.input_pool_hash!==run.price_input_pool_hash||prior.original_body_hash!==input.original_body_hash
          ||prior.records?.length!==prepared.length||prior.records.some((r,i)=>r.state!=='STAGED'||r.rpc!==prepared[i].rpc||r.body_hash!==prepared[i].body_hash))
          throw Error('LOCAL_CONTINUATION_PRICE_RECEIPTS');
        await db.exec('reset role');
        try {
          const pool=(await db.query('select input_pool_hash,body_hash,body_text from vnext_market.price_input_pools where plan_id=$1',[plan.plan_hash])).rows;
          if(pool.length!==1||pool[0].input_pool_hash!==run.price_input_pool_hash||pool[0].body_hash!==input.original_body_hash
            ||sha(pool[0].body_text)!==input.original_body_hash)throw Error('LOCAL_CONTINUATION_INPUT_POOL');
          const seen=new Set();
          for(const batch of references.batches) {
            const items=JSON.parse(batch.args.p_body_text).items;
            const rows=(await db.query('select security_id,horizon,reference_text,reference_hash,summary from vnext_market.price_references where plan_id=$1 and security_id=any($2::text[])',[plan.plan_hash,[...new Set(items.map(x=>x.security_id))]])).rows;
            const stored=new Map(rows.map(x=>[x.security_id+':'+x.horizon,x]));
            for(const item of items) {
              const id=item.security_id+':'+item.horizon,row=stored.get(id);
              if(seen.has(id)||!row||row.reference_text!==item.reference_text||row.reference_hash!==item.reference_hash
                ||largeCanonicalHash(row.summary)!==largeCanonicalHash(item.summary))throw Error('LOCAL_CONTINUATION_PRICE_REFERENCE');
              seen.add(id);
            }
          }
          const count=(await db.query('select count(*)::int n from vnext_market.price_references where plan_id=$1',[plan.plan_hash])).rows[0].n;
          if(count!==seen.size)throw Error('LOCAL_CONTINUATION_REFERENCE_COUNT');
          continuation.price_references_verified=seen.size;
        } finally { await db.exec('set role service_role'); }
        priceState.records=prior.records.map(r=>({...r,verification_mode:'EXACT_DATABASE_READBACK_NO_MUTATION'}));
        priceState.inherited_verified_receipts=true;
        console.log(JSON.stringify({phase:'PRICE_READBACK',references:continuation.price_references_verified,batches:references.batches.length,new_reference_rpcs:0}));
        writeFileSync(resolve(output,'price-staging.json'),JSON.stringify({schema:'MARKET_V2_REAL_LOCAL_PRICE_STAGING_V1',plan_hash:plan.plan_hash,run_hash,...priceState,production_writes:0,provider_requests:0},null,2)+'\n');
      }
      for (const prepared of continuation?[]:[...input.chunks, input.finalize, ...references.batches]) {
        const start = performance.now(), result = await stageDailyAiMarketPricePrepared({ rpc, prepared });
        const record = { index: priceState.records.length, rpc: prepared.rpc, milliseconds: Math.round(performance.now() - start), ...result };
        priceState.records.push(record); console.log(JSON.stringify({ phase: 'PRICE_PREPARATION', ...record }));
        writeFileSync(resolve(output, 'price-staging.json'), JSON.stringify({ schema: 'MARKET_V2_REAL_LOCAL_PRICE_STAGING_V1',
          plan_hash: plan.plan_hash, run_hash, ...priceState, production_writes: 0, provider_requests: 0 }, null, 2) + '\n');
        if (result.state !== 'STAGED') throw Error('REAL_PRICE_PREPARATION_FAILED');
      }
    }
    const shardResults = [], byShard = new Map(run.shards.map(s => [s.shard_id, s]));
    for (const claim of context.shards) {
      if(completedReadbacks.has(claim.shard_id)) {
        shardResults.push(completedReadbacks.get(claim.shard_id));
        writeFileSync(resolve(output,'run-staging.json'),JSON.stringify({schema:'MARKET_V2_REAL_LOCAL_RUN_STAGING_V1',sql_sha256:sqlHash,plan_hash:plan.plan_hash,run_hash,records:shardResults,production_writes:0,provider_requests:0},null,2)+'\n');
        continue;
      }
      const started = performance.now();
      const runner = withReferences ? runDailyAiMarketShardWithReferences : runDailyAiMarketShard;
      const result = await runner({ rpc, planHash: plan.plan_hash, workerRef: 'local-real-evidence-verification', requestKey: claim.request_key,
        analyseShard(work) {
          if (work.shard.shard_id !== claim.shard_id) throw Error('LOCAL_CLAIM_ORDER_CHANGED');
          const shard = byShard.get(work.shard.shard_id); if (!shard) throw Error('LOCAL_SHARD_MISSING');
          if (!withReferences) return shard.stocks;
          return shard.stocks.map(stock => {
            const references = referencesBySecurity[stock.security_id]; if (!references) throw Error('LOCAL_REFERENCE_IDENTITY_MISSING');
            if (stock.research_references && largeCanonicalHash(stock.research_references) !== largeCanonicalHash(references)) throw Error('LOCAL_REFERENCE_SUMMARY_CHANGED');
            return { ...stock, research_references: references };
          });
        } });
      const record = { index: shardResults.length, milliseconds: Math.round(performance.now() - started), ...result };
      shardResults.push(record); console.log(JSON.stringify({ phase: 'SHARD', ...record }));
      writeFileSync(resolve(output, 'run-staging.json'), JSON.stringify({ schema: 'MARKET_V2_REAL_LOCAL_RUN_STAGING_V1',
        sql_sha256: sqlHash, plan_hash: plan.plan_hash, run_hash, records: shardResults, production_writes: 0, provider_requests: 0 }, null, 2) + '\n');
      if (result.state !== 'STAGED' || result.shard_id !== claim.shard_id) throw Error('REAL_SHARD_STAGING_FAILED');
    }
    edition = await finishDailyAiMarketEdition({ rpc, planHash: plan.plan_hash, expiresAt: context.expires_at });
    console.log(JSON.stringify({ phase: 'FINISH', ...edition }));
    if (edition.state !== 'STAGED_REVIEW_REQUIRED') throw Error('REAL_EDITION_FINISH_FAILED');
    const replay = await finishDailyAiMarketEdition({ rpc, planHash: plan.plan_hash, expiresAt: context.expires_at });
    if (replay.state !== 'STAGED_REVIEW_REQUIRED' || replay.edition_id !== edition.edition_id || replay.replayed !== true) throw Error('REAL_EDITION_REPLAY_FAILED');
  }
  await db.exec('reset role');
  const state = (await db.query(`select (select count(*)::int from vnext_market.captures) captures,
    (select count(*)::int from vnext_market.capture_rows) original_rows,(select count(*)::int from vnext_market.stock_results) stocks,
    (select count(*)::int from vnext_market.cards) cards,(select count(*)::int from vnext_market.editions) editions,
    (select count(*)::int from vnext_market.reviews) reviews,
    (select count(*)::int from vnext_market.publication_events) publications`)).rows[0];
  if (state.reviews !== 0 || state.publications !== 0) throw Error('LOCAL_PREPARATION_MUST_REMAIN_UNAPPROVED');
  const final = { state: edition ? 'REAL_EDITION_STAGED_LOCALLY_REVIEW_REQUIRED' : 'REAL_CAPTURES_STAGED_LOCALLY', ...state,
    edition, sql_sha256: sqlHash, financial_extension_sha256: extensionHash, financial_manifest_hash: financialManifest?.manifest_hash ?? null,
    revenue_extension_sha256: revenueHash, public_extension_sha256: publicHash, action_coverage_extension_sha256: actionHash,
    references_extension_sha256: referenceHash, reference_chunks_extension_sha256: referenceChunksHash,
    reference_capacity_extension_sha256: referenceCapacityHash, action_evidence_id_extension_sha256: actionIdSql ? sha(actionIdSql) : null,
    reported_bvps_extension_sha256: bvpsHash,
    reference_performance_extension_sha256: referencePerformanceHash,
    short_scope_extension_sha256: shortScopeHash,
    continuation:continuation ? {...continuation,source_files:Object.fromEntries(Object.entries(continuation.source_files).map(([name,{value,...entry}])=>{void value;return [name,entry];}))}:null,
    price_input_bindings: priceState?.bindings ?? null, price_input_chunks: priceState?.chunks ?? null, price_reference_batches: priceState?.batches ?? null,
    pglite_codec_mode: existsSync(dbPath + '.financial-csv.json') ? 'EXACT_RETAINED_BYTES_FIXTURE_LOOKUP_NATIVE_BIG5_VERIFIED_SEPARATELY' : 'NATIVE_UTF8_ONLY',
    database_path: dbPath, production_writes: 0, provider_requests: 0 };
  writeFileSync(resolve(output, 'local-staging-result.json'), JSON.stringify(final, null, 2) + '\n');
  console.log(JSON.stringify(final));
} catch (error) {
  console.error(JSON.stringify({ state: 'FAILED', completed: saved.filter(r => r.state === 'STAGED').length, message: error.message, code: error.code }));
  process.exitCode = 1;
} finally { await db.close(); }
