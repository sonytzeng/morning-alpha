// Retained official original responses -> independent SQL classification and
// aggregate proof validation. No network, production mutation or review.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { marketSnapshotHash, planTaiwanMarketAnalysis } from '../research/taiwan-market-universe.mjs';
import { buildTaiwanMarketActionCoverage, createTaiwanActionReplayEvidence, normalizeTaiwanActionCapture } from '../research/taiwan-market-actions.mjs';
import { stageDailyAiMarketCapture, stageDailyAiMarketWorkPlan, prepareDailyAiMarketCapture } from '../research/daily-ai-market-stage.mjs';

for (const name of ['MA_PGLITE_MODULE', 'MA_MARKET_SOURCE_DIR', 'MA_ACTION_RETAINED_MANIFEST', 'MA_VALUATION_RECEIPT']) if (!process.env[name]) throw Error(name + '_REQUIRED');
const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite(); await db.waitReady;
const sha = value => createHash('sha256').update(value).digest('hex'), clone = value => globalThis.structuredClone(value);
const sourceRoot = process.env.MA_MARKET_SOURCE_DIR, actionRoot = dirname(process.env.MA_ACTION_RETAINED_MANIFEST);
const retained = JSON.parse(readFileSync(process.env.MA_ACTION_RETAINED_MANIFEST, 'utf8')).captures;
const originals = JSON.parse(readFileSync(resolve(actionRoot, 'source-captures.json'), 'utf8')).captures
  .map(capture => ({ receipt: capture.receipt, bytes: readFileSync(capture.raw_path) }));
const universe = JSON.parse(readFileSync(resolve(sourceRoot, 'normalized/universe.json'), 'utf8'));
const cutoff = new Date().toISOString(), day = new Date(Date.parse(cutoff) + 8 * 3_600_000).toISOString().slice(0, 10);
const plan = planTaiwanMarketAnalysis({ universe, business_date: day, cutoff, shard_size: 64 });
const coverage = buildTaiwanMarketActionCoverage({ universe, captures: originals, from: '2025-08-15', through: '2026-11-11', cutoff });
const documents = originals.map(normalizeTaiwanActionCapture);
const rpc = async (name, args) => {
  assert.ok(['stage_daily_ai_market_capture_v2', 'stage_daily_ai_market_public_capture_v2', 'stage_daily_ai_market_work_plan_v2'].includes(name));
  const values = Object.values(args);
  try { return { data: (await db.query(`select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) result`, values)).rows[0].result, error: null }; }
  catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
};
let phases = 0; const passed = label => console.log(JSON.stringify({ phase: ++phases, result: 'PASS', label }));
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create schema academy_private;create function academy_private.access_v11() returns text language sql as $$select 'denied'::text$$;
    create function public.is_research_owner_v1() returns boolean language sql as $$select false$$;
    create schema vnext_private;create table vnext_private.source_licenses(source text,storage_allowed boolean,derived_allowed boolean,
      commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
  for (const file of ['daily-ai-market-v2.candidate.sql', 'daily-ai-market-financial-csv.candidate.sql',
    'daily-ai-market-public-supplements.candidate.sql', 'daily-ai-market-action-coverage.candidate.sql',
    'daily-ai-market-action-evidence-id.candidate.sql']) {
    const sql = readFileSync(new URL('../research/' + file, import.meta.url), 'utf8');
    try { await db.exec(sql); }
    catch (error) { console.error(JSON.stringify({ sql_file: file, near: sql.slice(Number(error.position) - 100, Number(error.position) + 100) })); throw error; }
  }
  assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='vnext_market.validate_packet_rows_v2(jsonb,text,text)'::regprocedure")).rows[0].hash,
    'e2c9c3472685027640a271e8a070552d');
  await db.exec('set role service_role');
  for (const item of retained) {
    const receipt = item.receipt, raw = readFileSync(item.raw_path);
    const result = await stageDailyAiMarketCapture({ rpc, receipt, bytes: raw }); assert.equal(result.state, 'STAGED', JSON.stringify(result));
    assert.equal((await stageDailyAiMarketCapture({ rpc, receipt, bytes: raw })).replayed, true);
    const prepared = prepareDailyAiMarketCapture({ receipt, bytes: raw }); assert.equal(prepared.rpc, 'stage_daily_ai_market_public_capture_v2');
    const altered = JSON.parse(raw.toString('utf8')); altered.tables[0].totalCount += 1;
    const alteredText = JSON.stringify(altered), alteredReceipt = { ...receipt, sha256: sha(alteredText), bytes: Buffer.byteLength(alteredText) };
    const bad = prepareDailyAiMarketCapture({ receipt: alteredReceipt, bytes: Buffer.from(alteredText) });
    assert.equal((await rpc(bad.rpc, bad.args)).error?.message, 'MARKET_ACTION_TABLE_COMPLETENESS');
  }
  await db.exec('reset role');
  let derivedRows = 0;
  for (const document of documents) {
    const rows = (await db.query('select row_index,row_hash,derived from vnext_market.action_rows where capture_id=$1 order by row_index', [document.capture.capture_id])).rows;
    assert.equal(rows.length, document.rows.length);
    for (const row of rows) {
      const original = document.rows[row.row_index], events = document.events.filter(event => event.source_capture.row_index === row.row_index);
      assert.equal(row.row_hash, original.source_row_hash);
      assert.deepEqual(row.derived, { symbol: original.symbol, effective_date: original.effective_date,
        kinds: events.map(event => event.kind), subtype: events[0].subtype, suspension_from: events[0].suspension_from,
        reported: events[0].reported, issues: original.issues }); derivedRows++;
    }
  }
  assert.equal(derivedRows, 1657);
  await assert.rejects(db.query('delete from vnext_market.action_rows'), /MARKET_IMMUTABLE/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from vnext_market.action_rows'), error => error.code === '42501');
  const prepared = prepareDailyAiMarketCapture({ receipt: retained[0].receipt, bytes: readFileSync(retained[0].raw_path) });
  assert.equal((await rpc(prepared.rpc, prepared.args)).error?.code, '42501');
  passed('all 1,657 original rows independently classify identically in SQL; exact replay, complete-table counts, immutable and private gates hold');

  await db.exec('set role service_role');
  const valuation = JSON.parse(readFileSync(process.env.MA_VALUATION_RECEIPT, 'utf8'));
  const quote = await stageDailyAiMarketCapture({ rpc, receipt: valuation, bytes: readFileSync(valuation.raw_path) });
  assert.equal(quote.state, 'STAGED', JSON.stringify(quote));
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from vnext_market.capture_rows where capture_id=$1', [quote.capture_id])).rows[0].n, 1087);
  assert.equal((await db.query("select row_path from vnext_market.capture_rows where capture_id=$1 and row_index=0", [quote.capture_id])).rows[0].row_path.join('/'), 'data/0');
  passed('dated TWSE official close and valuation preserve the original 1,087 rows and data/index bindings');

  const needed = new Set(['twse_companies', 'tpex_companies', 'emerging_companies']);
  await db.exec('set role service_role');
  for (const file of readdirSync(sourceRoot).filter(f => /^acquisition-.*\.json$/.test(f)).sort()) {
    for (const receipt of JSON.parse(readFileSync(resolve(sourceRoot, file), 'utf8')).receipts ?? []) if (needed.delete(receipt.source_id)) {
      assert.equal((await stageDailyAiMarketCapture({ rpc, receipt, bytes: readFileSync(receipt.raw_path) })).state, 'STAGED');
    }
  }
  assert.equal(needed.size, 0); assert.equal((await stageDailyAiMarketWorkPlan({ rpc, universe, plan })).state, 'STAGED');
  await db.exec('reset role');
  const makePacket = async (securityId, row = coverage.corporate_actions[securityId]) => {
    const company = universe.companies.find(c => c.security_id === securityId);
    const raw = (await db.query(`select c.id,c.source_id,c.source_url,c.body_sha256,c.body_bytes,c.receipt,r.row_index,r.row_path,r.row_hash
      from vnext_market.captures c join vnext_market.capture_rows r on r.capture_id=c.id
      where c.source_id=$1 and r.row_hash=$2`, [company.source_id, company.source_row_hash])).rows[0];
    assert.ok(raw);
    const content = JSON.stringify({ schema: 'RAW_COMPANY_ROSTER_IDENTITY_TEST_V1', source_capture: { capture_id: raw.id,
      source_id: raw.source_id, source_url: raw.source_url, source_sha256: raw.body_sha256, source_bytes: raw.body_bytes,
      received_at: raw.receipt.received_at, row_index: raw.row_index, row_path: raw.row_path.map(Number),
      symbol_field: '公司代號', source_row_hash: raw.row_hash } });
    const evidenceHash = sha(content);
    return { symbol: company.symbol, company: company.company, cutoff, data_gaps: ['RESEARCH_ONLY_TEST_NO_REVIEW'], evidence: [{
      id: 'market-' + evidenceHash.slice(0, 40), symbol: company.symbol, kind: 'FINANCIAL', source: raw.source_url,
      published_at: null, available_at: raw.receipt.received_at, time_basis: 'OBSERVED_AFTER_RECEIPT', first_seen_at: raw.receipt.received_at,
      as_of: raw.receipt.received_at, evidence_hash: evidenceHash, content,
    }, ...createTaiwanActionReplayEvidence(row)] };
  };
  const all = Object.values(coverage.corporate_actions).filter(row => row.market === 'TPEX'), subjects = new Set();
  subjects.add(all.find(row => row.events.length === 0).security_id);
  for (const kind of ['CASH_DIVIDEND', 'STOCK_DIVIDEND', 'RIGHTS', 'CAPITAL_REDUCTION', 'SPLIT']) subjects.add(all.find(row => row.events.some(event => event.kind === kind)).security_id);
  for (const id of subjects) await db.query('select vnext_market.validate_packet($1,$2,$3)', [await makePacket(id), id, plan.plan_hash]);
  const eventSubject = all.find(row => row.events.length > 0), packet = await makePacket(eventSubject.security_id);
  await db.query('select vnext_market.validate_packet($1,$2,$3)', [packet, eventSubject.security_id, plan.plan_hash]);
  // The production analysis engine uses a content-addressed market ID for every
  // evidence kind. Verify that actual convention, and reject an unrelated ID.
  // Use an issuer not previously persisted so immutable replay checks stay exact.
  const canonicalSubject = all.find(row => !subjects.has(row.security_id) && row.security_id !== eventSubject.security_id);
  const canonicalPacket = clone(await makePacket(canonicalSubject.security_id));
  for (const evidence of canonicalPacket.evidence) if (evidence.id.startsWith('tpex-actions-')) {
    evidence.id = 'market-' + evidence.evidence_hash.slice(0, 40);
  }
  await db.query('select vnext_market.validate_packet($1,$2,$3)', [canonicalPacket, canonicalSubject.security_id, plan.plan_hash]);
  const forgedId = clone(canonicalPacket);
  forgedId.evidence[1].id = 'market-' + '0'.repeat(40);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)',
    [forgedId, canonicalSubject.security_id, plan.plan_hash]), /MARKET_ACTION_EVIDENCE_TIME/);
  const forgedTime = clone(canonicalPacket);
  forgedTime.evidence[1].first_seen_at = cutoff;
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)',
    [forgedTime, canonicalSubject.security_id, plan.plan_hash]), /MARKET_ACTION_EVIDENCE_TIME/);
  const mutate = edit => {
    const changed = clone(packet), evidence = changed.evidence.find(e => e.id.startsWith('tpex-actions-'));
    const body = JSON.parse(evidence.content); edit(body); const { coverage_hash: ignored, ...withoutHash } = body; void ignored;
    body.coverage_hash = marketSnapshotHash(withoutHash); evidence.content = JSON.stringify(body); evidence.evidence_hash = sha(evidence.content);
    evidence.id = 'tpex-actions-' + body.coverage_hash.slice(0, 40); return changed;
  };
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [mutate(body => { body.events = []; body.status = 'NO_ACTIONS'; }), eventSubject.security_id, plan.plan_hash]), /MARKET_ACTION_COVERAGE_RECOMPUTATION/);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [mutate(body => { body.source_bindings.find(b => b.matched_row_indices.length).matched_row_indices = []; }), eventSubject.security_id, plan.plan_hash]), /MARKET_ACTION_COMPLETE_TABLE_BINDING/);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [mutate(body => { body.source_bindings.pop(); }), eventSubject.security_id, plan.plan_hash]), /MARKET_ACTION_COVERAGE_RECOMPUTATION/);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [mutate(body => { body.events[0].reported.cash_dividend = 9999; }), eventSubject.security_id, plan.plan_hash]), /MARKET_ACTION_COVERAGE_RECOMPUTATION/);
  const incomplete = buildTaiwanMarketActionCoverage({ universe, captures: originals.slice(0, 2), from: '2025-08-15', through: '2026-11-11', cutoff });
  assert.equal(incomplete.corporate_actions[eventSubject.security_id].complete, false);
  await db.query('select vnext_market.validate_packet($1,$2,$3)', [await makePacket(eventSubject.security_id, incomplete.corporate_actions[eventSubject.security_id]), eventSubject.security_id, plan.plan_hash]);
  assert.equal((await db.query("select count(*)::int n from vnext_market.plan_sources where plan_id=$1 and source_url like 'https://www.tpex.org.tw/www/zh-tw/bulletin/%'", [plan.plan_hash])).rows[0].n, 3);
  assert.equal((await db.query('select count(*)::int n from vnext_market.reviews')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from vnext_market.publication_events')).rows[0].n, 0);
  await assert.rejects(db.query('update vnext_market.action_evidence set content_text=content_text'), /MARKET_IMMUTABLE/);
  passed('five action kinds and true absence validate; deleted events, forged absence, omitted source and fabricated cash reject; incomplete private evidence stays incomplete');
  const functionHashes = (await db.query(`select proname,md5(prosrc) hash from pg_proc where oid in(
    'vnext_market.validate_packet(jsonb,text,text)'::regprocedure,'public.stage_daily_ai_market_public_capture_v2(text,text,text)'::regprocedure)`)).rows;
  const retainedEvidence = (await db.query('select count(*)::int n from vnext_market.action_evidence')).rows[0].n;
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from vnext_market.action_evidence'), error => error.code === '42501');
  await assert.rejects(db.query('select vnext_market.validate_action_evidence($1,$2,$3)', [packet.evidence[1], eventSubject.security_id, plan.plan_hash]), error => error.code === '42501');
  await db.exec('reset role');
  for (const file of ['daily-ai-market-action-evidence-id.rollback.sql', 'daily-ai-market-action-coverage.rollback.sql', 'daily-ai-market-public-supplements.rollback.sql']) {
    await db.exec(readFileSync(new URL('../research/' + file, import.meta.url), 'utf8'));
  }
  assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='vnext_market.validate_packet(jsonb,text,text)'::regprocedure")).rows[0].hash,
    'e2c9c3472685027640a271e8a070552d');
  assert.equal((await db.query('select count(*)::int n from vnext_market.action_evidence')).rows[0].n, retainedEvidence);
  assert.equal((await db.query("select to_regprocedure('public.stage_daily_ai_market_public_capture_v2(text,text,text)') name")).rows[0].name, null);
  await db.query('select vnext_market.validate_packet($1,$2,$3)', [{ ...packet, evidence: [packet.evidence[0]] }, eventSubject.security_id, plan.plan_hash]);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [packet, eventSubject.security_id, plan.plan_hash]), /MARKET_EVIDENCE_HASH/);
  passed('authenticated callers cannot access aggregate proofs; guarded rollback restores the exact ordinary validator and retains all immutable original evidence');
  console.log(JSON.stringify({ result: 'PASS', phases, derived_rows: derivedRows, sample_issuers: subjects.size,
    retained_source_count: retained.length, functions: functionHashes, reviews: 0, publications: 0, provider_requests: 0, production_writes: 0 }));
} catch (error) { console.error(JSON.stringify({ result: 'FAIL', phase: phases + 1, message: error.message, code: error.code, position: error.position, where: error.where })); process.exitCode = 1; }
finally { await db.close(); }
