#!/usr/bin/env node
/** Retained real-data Owner delivery verification, on an explicitly identified
 * LOCAL PGlite database. Auth helpers are synthetic and transaction-scoped;
 * rollback restores them. No review, rights, approval, provider or OIDC call. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';
import { URL, pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { parseOwnerMarketCatalog, parseOwnerMarketPage, parseOwnerMarketInput, parseOwnerMarketReferences,
  parseOwnerMarketSearch } from '../../src/features/vnext/dailyAiMarketOwner.ts';
import { createDailyAiMarketPageRequestV2, parseDailyAiMarketPageV2 } from '../../src/features/vnext/dailyAiMarketPageV2.ts';
import { taiwanResearchReferenceSummary } from '../../research/taiwan-market-price-reference.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error('LOCAL_OWNER_REAL_' + code); };
const hashes = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const authNames = ['auth.uid()', 'academy_private.access_v11()', 'public.is_research_owner_v1()'];
const readNames = new Set(['get_daily_ai_owner_market_catalog_v2', 'get_daily_ai_owner_market_page_v2',
  'get_daily_ai_owner_market_input_v2', 'get_daily_ai_owner_market_references_v2', 'get_daily_ai_owner_market_search_v2',
  'get_daily_ai_member_market_page_v2']);
const ids = { owner: '00000000-0000-4000-8000-000000009001', premium: '00000000-0000-4000-8000-000000009002', free: '00000000-0000-4000-8000-000000009003' };

/** Local verification only. Begin is marked before any helper replacement so
 * a failure partway through setup still rolls back and checks original bodies. */
export function createOwnerAuthRollbackGuard(db) {
  let original = null, active = false, restored = null;
  const definitions = async () => (await db.query('select x name,pg_get_functiondef(x::regprocedure) definition from unnest($1::text[])x order by x', [authNames])).rows;
  return {
    get active() { return active; },
    get restored() { return restored; },
    async begin() {
      if (original !== null) fail('AUTH_VERIFICATION_ALREADY_STARTED');
      original = await definitions();
      await db.exec('begin'); active = true;
      await db.exec(`create or replace function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('test.market_owner_id',true),'')::uuid$$;
        create or replace function academy_private.access_v11()returns text language sql stable as $$select coalesce(nullif(current_setting('test.market_owner_tier',true),''),'denied')$$;
        create or replace function public.is_research_owner_v1()returns boolean language sql stable as $$select auth.uid()='${ids.owner}'::uuid and current_setting('test.market_owner_tier',true)='owner'$$;`);
    },
    async restore() {
      if (active) { await db.exec('rollback'); active = false; }
      if (original !== null) {
        try { assert.deepEqual(await definitions(), original); restored = true; }
        catch (error) { restored = false; throw error; }
      }
      return restored;
    },
  };
}
function readJson(file, limit = 128_000_000) {
  const info = statSync(file); if (!info.isFile() || info.size < 1 || info.size > limit) fail('FILE_SIZE');
  return JSON.parse(readFileSync(file, 'utf8'));
}
function canonicalFeed(value, digest) {
  let pieces = [], length = 0;
  const flush = () => { if (pieces.length) digest.update(pieces.join('')); pieces = []; length = 0; };
  const append = text => { if (typeof text !== 'string') fail('CANONICAL_TYPE'); pieces.push(text); length += text.length; if (length >= 65_536) flush(); };
  const visit = item => {
    if (Array.isArray(item)) { append('['); item.forEach((v, i) => { if (i) append(','); visit(v); }); append(']'); }
    else if (item !== null && typeof item === 'object') { append('{'); Object.keys(item).sort().forEach((key, i) => { if (i) append(','); append(JSON.stringify(key)); append(':'); visit(item[key]); }); append('}'); }
    else append(JSON.stringify(item));
  };
  visit(value); flush();
}
const canonicalHash = value => { const digest = createHash('sha256'); canonicalFeed(value, digest); return digest.digest('hex'); };
const cardBinding = card => canonicalHash({ status: card.status, reason: card.reason, counter_evidence: card.counter_evidence,
  confirmation: card.confirmation, invalidation: card.invalidation });

/** Recompute the entire original run hash while reading one shard at a time.
 * Retain only hashes/card bindings, not all company packets in memory. */
function verifiedRun(file) {
  const root = dirname(file), document = readJson(file), { shards: files, peer_price_research_count, long_price_research_count,
    history_manifest, financial_history_path, ...summary } = document;
  void peer_price_research_count; void long_price_research_count; void history_manifest; void financial_history_path;
  if (!hashes(summary.run_hash) || !Array.isArray(files) || !files.length || files.length > 160) fail('RUN_MANIFEST');
  const expected = new Map(), referenceHashes = new Map(), shardHashes = [], digest = createHash('sha256');
  const components = { price_research: 'price-research.json', price_input_pool: 'price-input-pool.json',
    price_input_bindings: 'price-input-bindings.json', diagnostics: 'diagnostics.json', acquisition_queue: 'acquisition-queue.json' };
  const keys = [...new Set([...Object.keys(summary).filter(key => key !== 'run_hash'), 'shards', ...Object.keys(components)])].sort();
  digest.update('{');
  for (const [index, key] of keys.entries()) {
    if (index) digest.update(','); digest.update(JSON.stringify(key) + ':');
    if (key === 'shards') {
      digest.update('[');
      for (const [position, descriptor] of files.entries()) {
        const path = resolve(root, descriptor.file), local = relative(root, path);
        if (local === '..' || local.startsWith('../') || !hashes(descriptor.sha256)) fail('SHARD_PATH');
        const shard = readJson(path, 64_000_000);
        if (canonicalHash(shard) !== descriptor.sha256 || shard.shard_id !== descriptor.shard_id
          || shard.stocks?.length !== descriptor.stocks || shard.cards?.length !== descriptor.cards) fail('SHARD_HASH');
        if (position) digest.update(','); canonicalFeed(shard, digest);
        shardHashes.push({ shard_id: shard.shard_id, sha256: descriptor.sha256, stocks: shard.stocks.length, cards: shard.cards.length });
        for (const stock of shard.stocks) {
          const packetHash = canonicalHash(stock.packet), analysisHash = canonicalHash(stock.analysis);
          if (expected.has(stock.security_id) || stock.analysis.input_hash !== packetHash || stock.analysis.horizons?.length !== 3) fail('STOCK_HASH');
          expected.set(stock.security_id, { packet_hash: packetHash, analysis_hash: analysisHash, company: stock.packet.company,
            cards: Object.fromEntries(stock.analysis.horizons.map(card => [card.horizon, cardBinding(card)])) });
        }
      }
      digest.update(']');
    } else if (components[key]) {
      const value = readJson(join(root, components[key]), key === 'price_research' ? 256_000_000 : 128_000_000); canonicalFeed(value, digest);
      if (key === 'price_research') for (const item of value) {
        if (referenceHashes.has(item.security_id)) fail('REFERENCE_DUPLICATE');
        referenceHashes.set(item.security_id, Object.fromEntries(['SHORT', 'MEDIUM', 'LONG'].map(horizon => {
          const projection = taiwanResearchReferenceSummary({ security_id: item.security_id, horizon,
            reference: item[horizon.toLowerCase()], input_pool_hash: summary.price_input_pool_hash });
          return [horizon, projection?.reference_hash ?? null];
        })));
      }
    } else canonicalFeed(summary[key], digest);
  }
  digest.update('}');
  if (digest.digest('hex') !== summary.run_hash || expected.size < 1 || expected.size > 10000) fail('RUN_HASH');
  return { run_hash: summary.run_hash, manifest_sha256: sha(readFileSync(file)), expected, referenceHashes, shardHashes };
}
function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--database-path', '--run-manifest', '--staging-output', '--output'].includes(args[index]) || !args[index + 1] || options[args[index]]) fail('ARGUMENTS');
    options[args[index]] = resolve(args[index + 1]);
  }
  if (Object.keys(options).length !== 4) fail('ARGUMENTS'); return options;
}
function measureSummary(metrics) {
  return Object.fromEntries([...new Set(metrics.map(item => item.rpc))].map(name => {
    const rows = metrics.filter(item => item.rpc === name), times = rows.map(item => item.milliseconds).sort((a, b) => a - b);
    return [name, { calls: rows.length, errors: rows.filter(item => item.error).length, response_bytes_total: rows.reduce((n, item) => n + item.response_bytes, 0),
      response_bytes_max: Math.max(...rows.map(item => item.response_bytes)), milliseconds_p50: times[Math.ceil(times.length / 2) - 1],
      milliseconds_p95: times[Math.ceil(times.length * .95) - 1], milliseconds_max: times.at(-1) }];
  }));
}

export async function verifyTaiwanMarketOwnerReal(args) {
  const options = parseOptions(args), dbPath = options['--database-path'], output = options['--output'];
  if (!process.env.MA_PGLITE_MODULE || !statSync(dbPath).isDirectory() || !existsSync(join(dbPath, 'PG_VERSION'))) fail('LOCAL_DATABASE_REQUIRED');
  const identity = readJson(dbPath + '.source.json', 100_000), baseSql = readFileSync(new URL('../../research/daily-ai-market-v2.candidate.sql', import.meta.url), 'utf8');
  if (identity.schema !== 'MARKET_V2_LOCAL_DATABASE_SOURCE_V1' || identity.production_database !== false || identity.sql_sha256 !== sha(baseSql)) fail('LOCAL_DATABASE_IDENTITY');
  const context = readJson(join(options['--staging-output'], 'run-staging-context.json'), 1_000_000);
  const completed = readJson(join(options['--staging-output'], 'local-staging-result.json'), 1_000_000);
  if (completed.state !== 'REAL_EDITION_STAGED_LOCALLY_REVIEW_REQUIRED' || completed.production_writes !== 0 || completed.provider_requests !== 0
    || completed.database_path !== dbPath || !hashes(context.plan_hash) || context.sql_sha256 !== identity.sql_sha256 || !hashes(completed.edition?.edition_id)) fail('FINISHED_LOCAL_RUN_REQUIRED');
  const run = verifiedRun(options['--run-manifest']); if (run.run_hash !== context.run_hash) fail('RUN_CONTEXT');
  if (existsSync(output)) fail('OUTPUT_EXISTS'); mkdirSync(output, { recursive: true, mode: 0o700 });
  const lockPath = dbPath + '.owner-verification.lock', lock = openSync(lockPath, 'wx', 0o600);
  const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite(dbPath), authGuard = createOwnerAuthRollbackGuard(db);
  const metrics = [], parsedPages = [], searchResults = [], started = performance.now();
  const actorScope = () => ({ identity: ids.owner, tier: 'owner', generation: 1, signal: new globalThis.AbortController().signal });
  const call = async (name, args) => {
    if (!readNames.has(name)) fail('READ_ONLY_RPC_SCOPE'); const time = performance.now(), values = Object.values(args);
    try {
      const data = (await db.query(`select public.${name}(${values.map((_, index) => '$' + (index + 1)).join(',')}) result`, values)).rows[0].result;
      metrics.push({ rpc: name, milliseconds: Math.round((performance.now() - time) * 1000) / 1000, response_bytes: Buffer.byteLength(JSON.stringify(data)), error: null }); return data;
    } catch (error) { metrics.push({ rpc: name, milliseconds: Math.round((performance.now() - time) * 1000) / 1000, response_bytes: 0, error: error.code ?? 'ERROR' }); throw error; }
  };
  const counts = async () => (await db.query(`select (select count(*)::int from vnext_market.reviews) reviews,
    (select count(*)::int from vnext_market.publication_events) publications,(select count(*)::int from vnext_private.source_licenses) licenses,
    (select count(*)::int from vnext_market.owner_review_requests) owner_review_requests`)).rows[0];
  const identityAs = async (tier, role = 'authenticated') => {
    assert.ok(['owner', 'premium', 'free', 'denied'].includes(tier)); assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
    await db.exec('reset role');
    await db.query("select set_config('test.market_owner_id',$1,true),set_config('test.market_owner_tier',$2,true)", [ids[tier] ?? '', tier]);
    await db.exec('set local role ' + role);
  };
  const expectDenied = async (name, args) => {
    await db.exec('savepoint owner_read_denied'); let error;
    try { await call(name, args); } catch (caught) { error = caught; }
    await db.exec('rollback to savepoint owner_read_denied'); await db.exec('release savepoint owner_read_denied');
    if (error?.code !== '42501') fail('EXPECTED_OWNER_DENIAL');
  };
  try {
    await db.waitReady;
    for (const [stem, signature] of [['owner-review', 'public.get_daily_ai_owner_market_catalog_v2(jsonb,integer)'],
      ['owner-search', 'public.get_daily_ai_owner_market_search_v2(text,text,integer)']]) {
      const sql = readFileSync(new URL('../../research/daily-ai-market-' + stem + '.candidate.sql', import.meta.url), 'utf8');
      const marker = dbPath + '.' + stem + '.json', installed = (await db.query('select to_regprocedure($1)is not null installed', [signature])).rows[0].installed;
      if (installed) {
        if (!existsSync(marker) || readJson(marker, 100_000).extension_sha256 !== sha(sql)) fail('OWNER_EXTENSION_UNTRACKED');
      } else {
        await db.exec(sql); writeFileSync(marker, JSON.stringify({ extension_sha256: sha(sql), production_database: false }) + '\n', { flag: 'wx' });
      }
    }
    const baseline = await counts(); if (baseline.reviews || baseline.publications || baseline.owner_review_requests) fail('MUST_REMAIN_UNREVIEWED');
    const edition = (await db.query('select id,plan_id,universe_id,vnext_market.iso(cutoff) cutoff from vnext_market.editions where id=$1 and plan_id=$2',
      [completed.edition.edition_id, context.plan_hash])).rows[0]; if (!edition) fail('EDITION_BINDING');
    const stored = (await db.query('select security_id,packet_hash,analysis_hash from vnext_market.stock_results where plan_id=$1 order by security_id', [context.plan_hash])).rows;
    if (stored.length !== run.expected.size) fail('STOCK_COUNT');
    for (const stock of stored) { const expected = run.expected.get(stock.security_id); if (!expected || stock.packet_hash !== expected.packet_hash || stock.analysis_hash !== expected.analysis_hash) fail('STORED_ORIGINAL_HASH'); }

    await authGuard.begin(); await identityAs('owner'); const scope = actorScope();
    const catalog = parseOwnerMarketCatalog(await call('get_daily_ai_owner_market_catalog_v2', { p_before: null, p_limit: 20 }), scope);
    assert.ok(catalog.editions.some(item => item.id === edition.id && item.plan_hash === context.plan_hash));
    const target = run.expected.get('TWSE:2330'); if (!target) fail('TARGET_2330_MISSING');
    let targetFullName = null;
    for (let index = 0; index < 3; index++) {
      const query = index === 0 ? '2330' : index === 1 ? '台積電' : targetFullName;
      if (typeof query !== 'string' || !query) fail('TARGET_FULL_NAME');
      const result = parseOwnerMarketSearch(await call('get_daily_ai_owner_market_search_v2', { p_edition_id: edition.id, p_query: query, p_limit: 20 }), scope,
        { edition_id: edition.id, query, limit: 20 });
      if (result.universe_hash !== edition.universe_id || !result.companies.some(company => company.security_id === 'TWSE:2330')) fail('TARGET_SEARCH');
      targetFullName = result.companies.find(company => company.security_id === 'TWSE:2330').company;
      searchResults.push({ query, matches: result.companies.length, identities: result.companies.map(company => company.security_id), has_more: result.has_more });
    }
    const seen = new Set(), horizonCounts = { SHORT: 0, MEDIUM: 0, LONG: 0 }, referenceCounts = { SHORT: 0, MEDIUM: 0, LONG: 0 }, statusCounts = {};
    let targetPage = null, coverage = null, maximumPageCards = 0;
    const rssBeforePagination = process.memoryUsage().rss; let rssPeakDuringPagination = rssBeforePagination;
    for (let start = 0; start < run.expected.size * 3; start += 30) {
      const raw = await call('get_daily_ai_owner_market_page_v2', { p_edition_id: edition.id, p_offset: start, p_limit: 30 }), parseStart = performance.now();
      const page = await parseOwnerMarketPage(raw, scope, { edition_id: edition.id, start, limit: 30 });
      maximumPageCards = Math.max(maximumPageCards, page.cards.length);
      rssPeakDuringPagination = Math.max(rssPeakDuringPagination, process.memoryUsage().rss);
      assert.equal(page.total, run.expected.size * 3); assert.equal(page.review, null); assert.equal(page.publication, null);
      if (!coverage) coverage = page.coverage; else assert.deepEqual(page.coverage, coverage);
      for (const card of page.cards) {
        const security = card.market + ':' + card.symbol, key = security + ':' + card.horizon, expected = run.expected.get(security);
        if (seen.has(key) || !expected || expected.company !== card.company || expected.cards[card.horizon] !== cardBinding(card)) fail('CARD_ORIGINAL_BINDING');
        seen.add(key); horizonCounts[card.horizon]++; const group = card.horizon + ':' + card.status; statusCounts[group] = (statusCounts[group] ?? 0) + 1;
        const expectedReference = run.referenceHashes.get(security)?.[card.horizon] ?? null;
        if ((card.research_reference?.reference_hash ?? null) !== expectedReference) fail('CARD_REFERENCE_BINDING');
        if (card.research_reference) referenceCounts[card.horizon]++;
        if (security === 'TWSE:2330') targetPage = page;
      }
      parsedPages.push({ start, cards: page.cards.length, parser_ms: Math.round((performance.now() - parseStart) * 1000) / 1000 });
      if (parsedPages.length % 25 === 0) console.log(JSON.stringify({ phase: 'OWNER_PAGES', pages: parsedPages.length, cards: seen.size }));
    }
    assert.equal(seen.size, run.expected.size * 3); for (const count of Object.values(horizonCounts)) assert.equal(count, run.expected.size);
    if (!targetPage) fail('TARGET_PAGE');
    const input = await parseOwnerMarketInput(await call('get_daily_ai_owner_market_input_v2', { p_edition_id: edition.id, p_security_id: 'TWSE:2330' }), scope, targetPage, 'TWSE:2330');
    const references = await parseOwnerMarketReferences(await call('get_daily_ai_owner_market_references_v2', { p_plan_hash: context.plan_hash, p_security_id: 'TWSE:2330' }), scope, targetPage, input);
    assert.equal(input.packet_hash, target.packet_hash); assert.equal(input.analysis_hash, target.analysis_hash);
    const sources = new Map(); for (const reference of references) for (const source of reference.sources) sources.set(source.capture_id + ':' + source.source_row_hash, source);
    await db.exec('reset role');
    const retained = (await db.query(`select x.capture_id,x.source_row_hash,c.source_url,vnext_market.iso(c.received_at) received_at
      from jsonb_to_recordset($1::jsonb)x(capture_id text,source_row_hash text)
      join vnext_market.capture_rows r on r.capture_id=x.capture_id and r.row_hash=x.source_row_hash
      cross join lateral vnext_market.source_metadata(x.capture_id)c`, [JSON.stringify([...sources.values()].map(({ capture_id, source_row_hash }) => ({ capture_id, source_row_hash })))])).rows;
    const retainedPairs = new Set(); for (const row of retained) {
      const key = row.capture_id + ':' + row.source_row_hash, expected = sources.get(key);
      if (!expected || expected.source_url !== row.source_url || Date.parse(expected.received_at) !== Date.parse(row.received_at)) fail('REFERENCE_RETAINED_SOURCE'); retainedPairs.add(key);
    }
    assert.equal(retainedPairs.size, sources.size);

    const memberChecks = [];
    for (const tier of ['owner', 'premium', 'free']) {
      await identityAs(tier);
      if (tier !== 'owner') await expectDenied('get_daily_ai_owner_market_search_v2', { p_edition_id: edition.id, p_query: '台積電', p_limit: 20 });
      for (const horizon of ['SHORT', 'MEDIUM', 'LONG']) {
        const memberScope = { identity: ids[tier], tier, generation: 1, signal: new globalThis.AbortController().signal,
          requestDate: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) };
        const query = { horizon, market: 'ALL', status: 'ALL', search: '', sort: 'STATUS_MARKET_SYMBOL_ASC', page_size: 30 };
        const request = await createDailyAiMarketPageRequestV2(memberScope, query), raw = await call('get_daily_ai_member_market_page_v2', { p_request: request });
        const result = await parseDailyAiMarketPageV2(raw, memberScope, request);
        assert.equal(result.edition, null); assert.equal(result.cards.length, 0); memberChecks.push({ tier, horizon, edition: null, cards: 0 });
      }
    }
    for (const role of ['anon', 'service_role']) { await identityAs('denied', role); await expectDenied('get_daily_ai_owner_market_catalog_v2', { p_before: null, p_limit: 20 }); }
    await authGuard.restore();
    const after = await counts(); assert.deepEqual(after, baseline);
    const receipt = { schema: 'MORNING_ALPHA_REAL_OWNER_DELIVERY_VERIFICATION_V1', state: 'PASS', formed_at: new Date().toISOString(),
      authentication: 'SYNTHETIC_TRANSACTION_SCOPED_ROLLED_BACK_NOT_A_REAL_SESSION', database_path: dbPath,
      edition_id: edition.id, plan_hash: context.plan_hash, run_hash: run.run_hash, run_manifest_sha256: run.manifest_sha256,
      stock_original_hashes_verified: stored.length, shard_original_hashes_verified: run.shardHashes.length,
      cards: seen.size, horizon_counts: horizonCounts, status_counts: statusCounts, reference_counts: referenceCounts, coverage,
      owner_page_limit: 30, maximum_page_cards: maximumPageCards, pages: parsedPages, searches: searchResults,
      pagination_memory: { retained_content: 'CURRENT_PAGE_AND_SINGLE_TARGET_PAGE_ONLY_OTHER_PAGES_RETAIN_COUNTS_AND_HASHES',
        rss_before_pagination_bytes: rssBeforePagination, rss_peak_observed_during_pagination_bytes: rssPeakDuringPagination,
        scope: 'LOCAL_NODE_AND_PGLITE_PROCESS_NOT_BROWSER_OR_SUBSCRIBER_CAPACITY' },
      target: { security_id: input.security_id, company: input.company,
        packet_hash: input.packet_hash, analysis_hash: input.analysis_hash, evidence: input.evidence.length,
        references: references.map(ref => ({ horizon: ref.horizon, reference_hash: ref.summary.reference_hash, source_rows: ref.sources.length })),
        retained_reference_source_pairs_verified: retainedPairs.size },
      member_unpublished_checks: memberChecks, before: baseline, after, auth_definitions_restored: authGuard.restored,
      delivery_scope: { internal_owner_research: 'PRIVATE_UNREVIEWED_EDITION_READABLE_IN_SYNTHETIC_OWNER_CONTEXT',
        member_publication_events: after.publications, member_cards_visible: 0, internal_visibility_is_member_publication: false },
      rpc_summary: measureSummary(metrics), rpc_measurements: metrics, elapsed_ms: Math.round(performance.now() - started),
      browser_qa: false, real_oidc: false, subscriber_capacity_test: false, provider_requests: 0, production_writes: 0,
      reviews_created: 0, licenses_created: 0, approvals_created: 0 };
    writeFileSync(join(output, 'owner-real-verification.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ state: 'PASS', receipt: join(output, 'owner-real-verification.json'), stocks: stored.length, cards: seen.size, pages: parsedPages.length,
      rpc_summary: receipt.rpc_summary, reviews: after.reviews, publications: after.publications, production_writes: 0 }));
    return receipt;
  } catch (error) {
    let cleanupError = null;
    try { await authGuard.restore(); } catch (caught) { cleanupError = caught; }
    writeFileSync(join(output, 'owner-real-verification-failed.json'), JSON.stringify({ state: 'FAILED', error: error.message,
      auth_definitions_restored: authGuard.restored, cleanup_error: cleanupError?.message ?? null,
      rpc_summary: measureSummary(metrics), rpc_measurements: metrics, production_writes: 0, provider_requests: 0 }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (cleanupError) throw new AggregateError([error, cleanupError], 'LOCAL_OWNER_REAL_AUTH_RESTORE_FAILED');
    throw error;
  } finally {
    try { if (authGuard.active) await authGuard.restore(); }
    finally { try { await db.close(); } finally { closeSync(lock); unlinkSync(lockPath); } }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await verifyTaiwanMarketOwnerReal(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
