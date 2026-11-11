// Disposable PostgreSQL test. Captures, issuer identities, conclusions, rights
// and reviews below are explicitly SYNTHETIC. No network or production writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { normalizeOfficialCompanyCapture, buildTaiwanMarketUniverse, planTaiwanMarketAnalysis, marketSnapshotHash,
  TAIWAN_COMPANY_SOURCES } from '../research/taiwan-market-universe.mjs';
import { marketStageCanonical as canonical, prepareDailyAiMarketShard, stageDailyAiMarketCapture,
  stageDailyAiMarketWorkPlan, runDailyAiMarketShard, finishDailyAiMarketEdition } from '../research/daily-ai-market-stage.mjs';
import { createDailyAiMarketPageRequestV2, parseDailyAiMarketPageV2, cacheDailyAiMarketPageV2,
  nextDailyAiMarketPageRequestV2 } from '../src/features/vnext/dailyAiMarketPageV2.ts';

if (!process.env.MA_PGLITE_MODULE) throw Error('MA_PGLITE_MODULE_REQUIRED');
const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite();
await db.waitReady;
const owner = '00000000-0000-0000-0000-000000000001', premium = '00000000-0000-0000-0000-000000000002';
const free = '00000000-0000-0000-0000-000000000003', anonymous = '00000000-0000-0000-0000-000000000004';
const sha = text => createHash('sha256').update(text).digest('hex');
const at = Date.now(), received = new Date(at - 120_000).toISOString(), formed = new Date(at - 90_000).toISOString();
const cutoff = new Date(at - 60_000).toISOString(), expiry = new Date(at + 3_600_000).toISOString();
const day = new Date(Date.parse(cutoff) + 8 * 3_600_000).toISOString().slice(0, 10);
const captures = [], rawRows = new Map(), sources = [];
const csvCell = text => '"' + String(text).replaceAll('"', '""') + '"';
let symbolNumber = 1000, phase = 0;
const step = label => console.log(JSON.stringify({ phase: ++phase, result: 'PASS', label }));
async function identity(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false)", [id ?? '']);
  await db.exec('set role ' + role);
}
const rpc = async (name, args) => {
  if (!/^[a-z_0-9]+$/.test(name)) throw Error('INVALID_TEST_RPC_NAME');
  const values = Object.values(args);
  try {
    const result = await db.query(`select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) result`, values);
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
};
const call = async (name, args) => {
  const r = await rpc(name, args); if (r.error) throw Object.assign(Error(r.error.message), { code: r.error.code }); return r.data;
};
const count = async table => {
  await db.exec('reset role'); const n = (await db.query('select count(*)::int n from vnext_market.' + table)).rows[0].n;
  await db.exec('set role service_role'); return n;
};
const scope = (id, tier) => ({ identity: id, tier, generation: 1, signal: new globalThis.AbortController().signal,
  requestDate: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) });
const query = { horizon: 'MEDIUM', market: 'ALL', status: 'ALL', search: '', sort: 'STATUS_MARKET_SYMBOL_ASC', page_size: 60 };
async function readPage(who, q = query, options = {}) {
  const request = await createDailyAiMarketPageRequestV2(who, q, options);
  const raw = await call('get_daily_ai_member_market_page_v2', { p_request: request });
  const parsed = await parseDailyAiMarketPageV2(raw, who, request, options.cache ?? null);
  return { raw, parsed, request, cache: cacheDailyAiMarketPageV2(parsed, who, request) };
}
function resultsFor(work) {
  return work.companies.map(company => {
    const record = rawRows.get(company.security_id), { receipt } = record.capture;
    const captureId = marketSnapshotHash({ source_id: receipt.source_id, url: receipt.url,
      source_sha256: receipt.sha256, received_at: receipt.received_at });
    const content = canonical({ kind: 'OFFICIAL_SECURITY_IDENTITY', symbol: company.symbol, market: company.market,
      company: company.company, fixture: 'SYNTHETIC_TEST_ONLY', source_capture: {
        capture_id: captureId, source_id: receipt.source_id, source_url: receipt.url, source_sha256: receipt.sha256,
        source_bytes: receipt.bytes, received_at: receipt.received_at, row_index: record.index,
        row_path: [record.index], symbol_field: '公司代號', source_row_hash: marketSnapshotHash(record.raw),
      } });
    const evidenceHash = sha(content), evidence = { id: 'market-' + evidenceHash.slice(0, 40), symbol: company.symbol,
      kind: 'MARKET', source: receipt.url, published_at: null, available_at: received, first_seen_at: received, as_of: received,
      time_basis: 'OBSERVED_AFTER_RECEIPT', evidence_hash: evidenceHash, content };
    const packet = { symbol: company.symbol, company: company.company, cutoff: work.shard.cutoff,
      data_gaps: ['SYNTHETIC_TEST_ONLY'], evidence: [evidence] };
    const status = ['WATCH', 'WAIT', 'AVOID', 'INSUFFICIENT'][(Number(company.symbol) - 1000) % 4];
    const analysis = { schema: 'DAILY_AI_STOCK_ANALYSIS_V2', symbol: company.symbol, cutoff: work.shard.cutoff,
      input_hash: marketSnapshotHash(packet), analysis_origin: 'DETERMINISTIC_SCREENING', method_version: 'TAIWAN_MARKET_RESEARCH_V1',
      model_generated: false, member_published: false, sources: packet.evidence.map(({ content: ignored, ...source }) => { void ignored; return source; }),
      horizons: ['SHORT', 'MEDIUM', 'LONG'].map(horizon => ({ horizon, status,
        reason: { text: 'SYNTHETIC fixture, not an actual investment conclusion.', evidence_ids: [evidence.id] }, counter_evidence: [],
        confirmation: 'SYNTHETIC: verify actual data before a real decision.', invalidation: 'SYNTHETIC: cancel if source changes.',
        gaps: status === 'INSUFFICIENT' ? ['SYNTHETIC_MISSING_REAL_EVIDENCE'] : [] })) };
    return { security_id: company.security_id, packet, analysis };
  });
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
    insert into auth.users values('${owner}',false),('${premium}',false),('${free}',false),('${anonymous}',true);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,role text,subscription_status text,paid_until timestamptz);
    insert into public.profiles values('${owner}','admin',null,null),('${premium}','member',null,null),('${free}','member',null,null),('${anonymous}','member',null,null);
    create table public.member_entitlements(user_id uuid primary key,state text,access_ends_at timestamptz,current_period_end timestamptz,trial_ends_at timestamptz);
    insert into public.member_entitlements values('${premium}','paid_active',now()+interval '1 hour',null,null),('${free}','free',null,null,null);
    create function public.is_research_owner_v1() returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
    create schema academy_private;create schema vnext_private;
    create table vnext_private.source_licenses(source text primary key,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,
      reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
  const accessSql = readFileSync(new URL('../supabase/migrations/20261009053655_academy_member_learning_v11.sql', import.meta.url), 'utf8');
  const start = accessSql.indexOf('create function academy_private.access_v11()'), end = accessSql.indexOf('revoke all on function academy_private.access_v11()', start);
  assert.ok(start > 0 && end > start); await db.exec(accessSql.slice(start, end));
  await db.exec(readFileSync(new URL('../research/daily-ai-market-v2.candidate.sql', import.meta.url), 'utf8'));
  const csvParsed = await db.query('select row_body from vnext_market.csv_rows($1) row_body',
    ['\uFEFF"代號","名稱","備註"\r\n"2330","繁體,中文","第一行\r\n第二行"\r\n"2317","含""引號",""']);
  assert.deepEqual(csvParsed.rows.map(r => r.row_body), [
    { 代號: '2330', 名稱: '繁體,中文', 備註: '第一行\r\n第二行' }, { 代號: '2317', 名稱: '含"引號', 備註: '' },
  ]);
  await assert.rejects(db.query('select * from vnext_market.csv_rows($1)', ['a,b\n"x"tail,y']), /MARKET_CSV_TRAILING_DATA/);
  await assert.rejects(db.query('select * from vnext_market.csv_rows($1)', ['a,b\n"x,y']), /MARKET_CSV_QUOTE/);
  await identity(null, 'service_role');
  let marketIndex = 0;
  for (const [sourceId, spec] of Object.entries(TAIWAN_COMPANY_SOURCES)) {
    const rows = Array.from({ length: marketIndex++ < 2 ? 28 : 27 }, () => {
      const symbol = String(symbolNumber++);
      return { 公司代號: symbol, 公司名稱: symbol === '1000' ? 'Synthetic %_ issuer' : 'Synthetic issuer ' + symbol,
        公司簡稱: 'Synthetic ' + symbol, 產業別: '01', 出表日期: day.replaceAll('-', ''),
        [spec.market === 'TPEX' ? '上櫃日期' : '上市日期']: '20200101' };
    });
    const text = spec.format === 'json' ? JSON.stringify(rows) : '\uFEFF' + Object.keys(rows[0]).map(csvCell).join(',') + '\r\n' +
      rows.map(row => Object.values(row).map(csvCell).join(',')).join('\r\n') + '\r\n';
    const bytes = Buffer.from(text), receipt = { schema: 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', source_id: sourceId, url: spec.url,
      format: spec.format, state: 'CAPTURED', status: 200, started_at: new Date(at - 121_000).toISOString(), received_at: received,
      bytes: bytes.length, sha256: sha(bytes), row_count: rows.length, synthetic_fixture: true };
    const capture = { receipt, bytes }; captures.push(capture); sources.push(normalizeOfficialCompanyCapture(capture));
    rows.forEach((raw, index) => rawRows.set(spec.market + ':' + raw.公司代號, { capture, raw, index }));
    const result = await stageDailyAiMarketCapture({ rpc, ...capture }); assert.equal(result.state, 'STAGED', JSON.stringify(result));
  }
  assert.equal((await stageDailyAiMarketCapture({ rpc, ...captures[0] })).replayed, true);
  const before = await count('captures');
  const wrongUrl = { ...captures[0], receipt: { ...captures[0].receipt, url: 'https://example.invalid/other' } };
  assert.equal((await stageDailyAiMarketCapture({ rpc, ...wrongUrl })).state, 'REJECTED');
  assert.equal((await stageDailyAiMarketCapture({ rpc, ...captures[0], receipt: { ...captures[0].receipt, started_at: null } })).state, 'REJECTED');
  assert.equal(await count('captures'), before);
  const historicalText = JSON.stringify({ tables: [{ data: [['1000', 'SYNTHETIC first table']] }, { data: [['1001', 'SYNTHETIC second table']] }] });
  const historicalReceipt = { ...captures[0].receipt, source_id: 'TWSE_DAILY_' + day.replaceAll('-', ''),
    url: 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=' + day.replaceAll('-', '') + '&type=ALLBUT0999&response=json',
    row_count: null, bytes: Buffer.byteLength(historicalText), sha256: sha(historicalText) };
  const nested = await stageDailyAiMarketCapture({ rpc, receipt: historicalReceipt, bytes: Buffer.from(historicalText) });
  assert.equal(nested.state, 'STAGED', JSON.stringify(nested));
  await db.exec('reset role');
  const indexedRows = (await db.query('select row_path,row_hash,row_body from vnext_market.capture_rows where capture_id=$1 order by row_path', [nested.capture_id])).rows;
  assert.deepEqual(indexedRows.map(r => r.row_path), [['tables', '0', 'data', '0'], ['tables', '1', 'data', '0']]);
  for (const row of indexedRows) assert.equal(row.row_hash, marketSnapshotHash(row.row_body));
  await assert.rejects(db.query("update vnext_market.captures set received_at=received_at-interval '1 day'"), /MARKET_IMMUTABLE/);
  await identity(premium);
  await assert.rejects(db.query('select * from vnext_market.captures'), error => error.code === '42501');
  await assert.rejects(db.query('select public.stage_daily_ai_market_work_plan_v2($1,$2)', ['{}', '{}']), error => error.code === '42501');
  await identity(null, 'service_role');
  step('original JSON/CSV bytes and receipt hashes, source allowlist, append-only storage and role boundary');

  const universe = buildTaiwanMarketUniverse({ rosters: sources, formed_at: formed });
  const plan = planTaiwanMarketAnalysis({ universe, business_date: day, cutoff, shard_size: 64 });
  const planned = await stageDailyAiMarketWorkPlan({ rpc, universe, plan });
  assert.equal(planned.state, 'STAGED', JSON.stringify(planned)); assert.equal(planned.shards, 2);
  assert.equal((await stageDailyAiMarketWorkPlan({ rpc, universe, plan })).replayed, true);
  assert.equal((await finishDailyAiMarketEdition({ rpc, planHash: plan.plan_hash, expiresAt: expiry })).state, 'REJECTED');
  const requestKey = randomUUID();
  const claimArgs = { p_plan_hash: plan.plan_hash, p_worker_ref: 'synthetic-worker', p_request_key: requestKey };
  const claim = await call('claim_daily_ai_market_shard_v2', claimArgs);
  assert.deepEqual(await call('claim_daily_ai_market_shard_v2', claimArgs), claim);
  const invalidResults = resultsFor(claim);
  const bad = invalidResults.at(-1), other = rawRows.get(invalidResults[0].security_id);
  const content = JSON.parse(bad.packet.evidence[0].content);
  content.source_capture.row_path = [other.index];
  content.source_capture.row_index = other.index;
  content.source_capture.source_row_hash = marketSnapshotHash(other.raw);
  bad.packet.evidence[0].content = canonical(content);
  bad.packet.evidence[0].evidence_hash = sha(bad.packet.evidence[0].content);
  bad.packet.evidence[0].id = 'market-' + bad.packet.evidence[0].evidence_hash.slice(0, 40);
  bad.analysis.input_hash = marketSnapshotHash(bad.packet);
  bad.analysis.sources = bad.packet.evidence.map(({ content: ignored, ...rest }) => { void ignored; return rest; });
  for (const h of bad.analysis.horizons) h.reason.evidence_ids = [bad.packet.evidence[0].id];
  const preparedBad = prepareDailyAiMarketShard({ planHash: plan.plan_hash, shard: claim.shard, leaseId: claim.lease_id, results: invalidResults });
  const rejected = await rpc(preparedBad.rpc, preparedBad.args); assert.match(rejected.error?.message ?? '', /MARKET_EVIDENCE_(?:SYMBOL|RAW_ROW)/);
  assert.equal(await count('stock_results'), 0); assert.equal(await count('evidence'), 0); assert.equal(await count('cards'), 0);
  step('work plan binds every official security, bounded lease is idempotent and a bad final row rolls back the entire shard');

  const calls = [];
  const losingRpc = async (name, args) => { calls.push(name); const result = await rpc(name, args);
    if (name === 'stage_daily_ai_market_shard_v2' && !result.error) throw Error('SYNTHETIC_LOST_ACK'); return result; };
  const unknown = await runDailyAiMarketShard({ rpc: losingRpc, planHash: plan.plan_hash, workerRef: 'synthetic-worker', requestKey, analyseShard: resultsFor });
  assert.equal(unknown.state, 'OUTCOME_UNKNOWN'); assert.deepEqual(calls, ['claim_daily_ai_market_shard_v2', 'stage_daily_ai_market_shard_v2']);
  assert.equal(await count('editions'), 0); assert.equal(await count('shard_results'), 1);
  const resumed = await runDailyAiMarketShard({ rpc, planHash: plan.plan_hash, workerRef: 'synthetic-worker', requestKey,
    analyseShard() { throw Error('COMPLETED_SHARD_MUST_NOT_RECOMPUTE'); } });
  assert.equal(resumed.state, 'STAGED'); assert.equal(resumed.replayed, true); assert.equal(resumed.result_hash, unknown.result_hash);
  const next = await runDailyAiMarketShard({ rpc, planHash: plan.plan_hash, workerRef: 'synthetic-worker', analyseShard: resultsFor });
  assert.equal(next.state, 'STAGED', JSON.stringify(next)); assert.equal(next.cards, 19 * 3);
  const empty = await runDailyAiMarketShard({ rpc, planHash: plan.plan_hash, workerRef: 'synthetic-worker', analyseShard: resultsFor });
  assert.equal(empty.state, 'NO_WORK'); assert.equal(empty.remaining, 0);
  const finished = await finishDailyAiMarketEdition({ rpc, planHash: plan.plan_hash, expiresAt: expiry });
  assert.equal(finished.state, 'STAGED_REVIEW_REQUIRED', JSON.stringify(finished));
  assert.equal((await finishDailyAiMarketEdition({ rpc, planHash: plan.plan_hash, expiresAt: expiry })).edition_id, finished.edition_id);
  assert.equal(await count('cards'), 83 * 3); assert.equal(await count('reviews'), 0); assert.equal(await count('publication_events'), 0);
  await db.exec('reset role');
  await assert.rejects(db.query("update vnext_market.shards set state='PENDING' where state='COMPLETE'"), /COMPLETED_SHARD_IMMUTABLE/);
  step('actual worker recovers a committed lost acknowledgement without retrying or recomputing, then finishes all 249 cards without review/approval');

  const premiumScope = scope(premium, 'premium'); await identity(premium);
  const unpublished = await readPage(premiumScope); assert.equal(unpublished.parsed.edition, null); assert.equal(unpublished.parsed.cards.length, 0);
  assert.equal(unpublished.parsed.universe.markets.reduce((n, m) => n + m.universe_count, 0), 83);
  await assert.rejects(call('get_daily_ai_owner_market_page_v2', { p_edition_id: finished.edition_id, p_offset: 0, p_limit: 60 }), error => error.code === '42501');
  await identity(owner);
  const ownerPage = await call('get_daily_ai_owner_market_page_v2', { p_edition_id: finished.edition_id, p_offset: 0, p_limit: 60 });
  assert.equal(ownerPage.cards.length, 60); assert.equal(ownerPage.review, null); assert.equal(ownerPage.publication, null);
  const ownerInput = await call('get_daily_ai_owner_market_input_v2', { p_edition_id: finished.edition_id, p_security_id: universe.companies[0].security_id });
  assert.equal(sha(ownerInput.packet_text), ownerInput.packet_hash); assert.equal(sha(ownerInput.analysis_text), ownerInput.analysis_hash);
  step('private preparation is readable only by Owner; the actual member parser accepts an empty unpublished edition');

  const documents = ['QUALITY', 'TIME', 'SOURCE_USE', 'METHODOLOGY'].map(kind => {
    const text = 'SYNTHETIC independent ' + kind + ' document for disposable database controls only.';
    return { kind, text, hash: sha(text) };
  });
  const reviewBody = { schema: 'DAILY_AI_MARKET_REVIEW_V2', edition_id: finished.edition_id, snapshot_hash: finished.edition_id,
    reviewer_ref: 'synthetic-independent-reviewer', quality: 'PASS', time_status: 'PASS', licensing: 'PASS', methodology: 'PASS',
    document_hashes: Object.fromEntries(documents.map(d => [d.kind, d.hash])), reason: 'SYNTHETIC control; not production authorization.', expires_at: expiry };
  await identity(null, 'service_role');
  const invalidReviewText = canonical(reviewBody);
  const nullDocuments = await rpc('stage_daily_ai_market_review_v2', { p_review_text: invalidReviewText, p_review_hash: sha(invalidReviewText),
    p_documents: Array.from({ length: 4 }, () => ({ kind: null, text: null, hash: null })) });
  assert.match(nullDocuments.error?.message ?? '', /MARKET_REVIEW_DOCUMENT/); assert.equal(await count('reviews'), 0);
  async function review(overrides = {}) {
    await identity(null, 'service_role'); const text = canonical({ ...reviewBody, ...overrides });
    return call('stage_daily_ai_market_review_v2', { p_review_text: text, p_review_hash: sha(text), p_documents: documents });
  }
  const checked = await review();
  const approveArgs = { p_edition_id: finished.edition_id, p_review_id: checked.review_id, p_action: 'APPROVE', p_audience: 'free', p_request_key: randomUUID() };
  await identity(owner); await assert.rejects(call('review_daily_ai_market_edition_v2', approveArgs), /MARKET_PUBLICATION_NOT_READY/);
  await db.exec('reset role');
  for (const capture of captures) await db.query(`insert into vnext_private.source_licenses values($1,true,true,true,now(),$2,'https://data.gov.tw/license','SYNTHETIC fixture rights only')`, [capture.receipt.url, expiry]);
  await identity(premium); await assert.rejects(call('review_daily_ai_market_edition_v2', approveArgs), error => error.code === '42501');
  await identity(owner); const approval = await call('review_daily_ai_market_edition_v2', approveArgs);
  assert.equal(approval.action, 'APPROVE'); assert.equal((await call('review_daily_ai_market_edition_v2', approveArgs)).replayed, true);
  step('independent four-document review and live rights are required; only Owner can publish, with exact idempotency');

  await identity(premium);
  const first = await readPage(premiumScope); assert.equal(first.parsed.cards.length, 60); assert.equal(first.parsed.counts.available_total, 83);
  assert.equal(first.parsed.edition.analysis_origin, 'DETERMINISTIC_SCREENING');
  assert.ok(first.parsed.cards.every(c => c.price === null)); assert.equal(first.parsed.page.has_more, true);
  const nextRequest = await nextDailyAiMarketPageRequestV2(first.cache, premiumScope);
  const nextRaw = await call('get_daily_ai_member_market_page_v2', { p_request: nextRequest });
  const second = await parseDailyAiMarketPageV2(nextRaw, premiumScope, nextRequest);
  assert.equal(second.cards.length, 23); assert.equal(second.page.has_more, false);
  assert.equal(new Set([...first.parsed.cards, ...second.cards].map(c => c.market + ':' + c.symbol)).size, 83);
  const unchanged = await readPage(premiumScope, query, { cache: first.cache }); assert.equal(unchanged.raw.mode, 'UNCHANGED');
  assert.equal('cards' in unchanged.raw, false); assert.deepEqual(unchanged.parsed.cards, first.parsed.cards);
  assert.equal((await readPage(premiumScope, { ...query, search: '%' })).parsed.counts.matching_total, 1);
  assert.equal((await readPage(premiumScope, { ...query, search: '_' })).parsed.counts.matching_total, 1);
  const byMarket = await readPage(premiumScope, { ...query, market: 'TPEX' }); assert.equal(byMarket.parsed.counts.available_total, 28);
  step('actual SQL FULL and UNCHANGED responses pass the real frontend parser, keyset pages cover all 83 names, and search treats wildcard characters literally');

  await identity(free); const freeScope = scope(free, 'free'); const freePage = await readPage(freeScope);
  assert.equal(freePage.parsed.counts.available_total, 3); assert.equal(freePage.parsed.cards.length, 3);
  assert.ok(freePage.parsed.cards.every(c => c.sources === null && c.counter_evidence === null && c.price === null));
  assert.equal((await readPage(freeScope, { ...query, search: '1082' })).parsed.counts.matching_total, 0);
  assert.equal((await readPage(freeScope, { ...query, market: 'EMERGING' })).parsed.counts.available_total, 0);
  await identity(anonymous); await assert.rejects(call('get_daily_ai_member_market_page_v2', { p_request: first.request }), error => error.code === '42501');
  await identity(null); await assert.rejects(call('get_daily_ai_member_market_page_v2', { p_request: first.request }), error => error.code === '42501');
  await identity(null, 'anon'); await assert.rejects(call('get_daily_ai_member_market_page_v2', { p_request: first.request }), error => error.code === '42501');
  await db.exec('reset role'); await db.query("update public.member_entitlements set access_ends_at=now()-interval '1 second' where user_id=$1", [premium]);
  await identity(premium); await assert.rejects(call('get_daily_ai_member_market_page_v2', { p_request: nextRequest }), /AI_MARKET_PAGE_V2_CURSOR_STALE/);
  assert.equal((await readPage(scope(premium, 'free'))).parsed.counts.available_total, 3);
  step('free is fixed to three names before filtering, anonymous access is denied, and paid expiry invalidates the old cursor immediately');

  await db.exec('reset role'); await db.query("update public.member_entitlements set access_ends_at=now()+interval '1 hour' where user_id=$1", [premium]);
  await db.query('update vnext_private.source_licenses set commercial_allowed=false where source=$1', [captures[0].receipt.url]);
  await identity(premium); assert.equal((await readPage(premiumScope)).parsed.edition, null);
  await db.exec('reset role'); await db.query('update vnext_private.source_licenses set commercial_allowed=true where source=$1', [captures[0].receipt.url]);
  await review({ quality: 'FAIL', reason: 'SYNTHETIC superseding failed review.' });
  await identity(premium); assert.equal((await readPage(premiumScope)).parsed.edition, null);
  const restored = await review({ reason: 'SYNTHETIC new independent review after correction.' });
  await identity(owner); const newApproval = { ...approveArgs, p_review_id: restored.review_id, p_request_key: randomUUID() };
  await call('review_daily_ai_market_edition_v2', newApproval);
  await identity(premium); await assert.rejects(call('get_daily_ai_member_market_page_v2', { p_request: nextRequest }), /AI_MARKET_PAGE_V2_CURSOR_STALE/);
  const refreshed = await readPage(premiumScope); assert.notEqual(refreshed.parsed.research_revision, first.parsed.research_revision);
  await identity(owner); await call('review_daily_ai_market_edition_v2', { ...newApproval, p_action: 'REVOKE', p_request_key: randomUUID() });
  await identity(premium); assert.equal((await readPage(premiumScope)).parsed.edition, null);
  step('live rights withdrawal, superseding failed review, new publication revision and Owner revoke all invalidate member access');
  console.log(JSON.stringify({ result: 'PASS', phases: phase, synthetic_securities: 83, cards: 249, production_writes: 0, provider_requests: 0 }));
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', completed_phases: phase, message: error.message, code: error.code, where: error.where, stack: error.stack?.split('\n').slice(0, 5) }));
  process.exitCode = 1;
} finally { await db.close(); }
