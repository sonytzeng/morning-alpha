// Real retained UTF8 official monthly CSV, entirely local native SQL.
// No provider request, production mutation, codec fixture, review or approval.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { parseOfficialCompanyCsv, marketSnapshotHash, planTaiwanMarketAnalysis } from '../research/taiwan-market-universe.mjs';
import { stageDailyAiMarketCapture, stageDailyAiMarketWorkPlan, prepareDailyAiMarketCapture } from '../research/daily-ai-market-stage.mjs';

for (const name of ['MA_PGLITE_MODULE', 'MA_MARKET_SOURCE_DIR', 'MA_REVENUE_CSV_RECEIPT']) if (!process.env[name]) throw Error(name + '_REQUIRED');
const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite(); await db.waitReady;
const sha = value => createHash('sha256').update(value).digest('hex'), sourceRoot = process.env.MA_MARKET_SOURCE_DIR;
const receipt = JSON.parse(readFileSync(process.env.MA_REVENUE_CSV_RECEIPT, 'utf8')), raw = readFileSync(receipt.raw_path), text = raw.toString('utf8');
assert.equal(sha(raw), receipt.sha256); assert.deepEqual(Buffer.from(text), raw); assert.equal(text.charCodeAt(0), 65279);
const objects = parseOfficialCompanyCsv(text), headers = Object.keys(objects[0]);
const matrix = [headers, ...objects.map(row => headers.map(key => row[key]))];
assert.equal(matrix.length, receipt.row_count);
const universe = JSON.parse(readFileSync(resolve(sourceRoot, 'normalized/universe.json'), 'utf8'));
const cutoff = new Date().toISOString(), day = new Date(Date.parse(cutoff) + 8 * 3_600_000).toISOString().slice(0, 10);
const plan = planTaiwanMarketAnalysis({ universe, business_date: day, cutoff, shard_size: 64 });
const rpc = async (name, args) => {
  assert.ok(['stage_daily_ai_market_capture_v2', 'stage_daily_ai_market_revenue_capture_v2', 'stage_daily_ai_market_work_plan_v2'].includes(name));
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
  for (const file of ['daily-ai-market-v2.candidate.sql', 'daily-ai-market-financial-csv.candidate.sql', 'daily-ai-market-revenue-csv.candidate.sql']) {
    await db.exec(readFileSync(new URL('../research/' + file, import.meta.url), 'utf8'));
  }
  const parsed = (await db.query('select row_body from vnext_market.csv_matrix($1) row_body', [text])).rows.map(r => r.row_body);
  assert.deepEqual(parsed, matrix);
  await db.exec('set role service_role');
  const prepared = prepareDailyAiMarketCapture({ receipt, bytes: raw });
  assert.equal(prepared.rpc, 'stage_daily_ai_market_revenue_capture_v2'); assert.equal(prepared.args.p_body_text.charCodeAt(0), 65279);
  assert.equal((await rpc(prepared.rpc, { ...prepared.args, p_body_text: text.slice(1) })).error?.message, 'MARKET_REVENUE_RECEIPT');
  const wrongPath = globalThis.structuredClone(receipt); wrongPath.request_form.filePath = '/t21/otc/';
  assert.equal((await stageDailyAiMarketCapture({ rpc, receipt: wrongPath, bytes: raw })).reason, 'MARKET_REVENUE_REQUEST_BINDING');
  const wrongPeriod = globalThis.structuredClone(receipt); wrongPeriod.source_id = 'MOPS_REVENUE_TWSE_202609_CSV'; wrongPeriod.request_form.fileName = 't21sc03_115_9.csv';
  assert.equal((await stageDailyAiMarketCapture({ rpc, receipt: wrongPeriod, bytes: raw })).reason, 'MARKET_REVENUE_ROW_PERIOD');
  passed('native SQL parses all original matrix cells and rejects stripped BOM, altered market path and substituted reporting month');

  const staged = await stageDailyAiMarketCapture({ rpc, receipt, bytes: raw }); assert.equal(staged.state, 'STAGED', JSON.stringify(staged));
  assert.equal((await stageDailyAiMarketCapture({ rpc, receipt, bytes: raw })).replayed, true);
  await db.exec('reset role');
  const stored = (await db.query(`select c.body_sha256,c.body_bytes,encode(convert_to(c.body_text,'UTF8'),'base64') body_base64,o.source_encoding,o.decoder,o.raw_sha256,o.raw_byte_count,
    encode(o.raw_bytes,'base64') raw_base64 from vnext_market.captures c join vnext_market.encoded_origins o on o.capture_id=c.id where c.id=$1`, [staged.capture_id])).rows[0];
  // Read exact SQL bytes: PGlite's text-column decoder strips a leading BOM.
  assert.deepEqual(Buffer.from(stored.body_base64, 'base64'), raw); assert.equal(stored.body_sha256, receipt.sha256); assert.equal(stored.raw_sha256, receipt.sha256);
  assert.equal(stored.source_encoding, 'UTF8'); assert.equal(stored.decoder, 'POSTGRES_UTF8_LOSSLESS_V1');
  assert.equal(stored.raw_byte_count, raw.length); assert.equal(stored.body_bytes, raw.length); assert.deepEqual(Buffer.from(stored.raw_base64, 'base64'), raw);
  const rows = (await db.query('select row_index,row_path,row_hash from vnext_market.capture_rows where capture_id=$1 order by row_index', [staged.capture_id])).rows;
  assert.equal(rows.length, matrix.length);
  for (const row of rows) { assert.deepEqual(row.row_path, [String(row.row_index)]); assert.equal(row.row_hash, marketSnapshotHash(matrix[row.row_index])); }
  await assert.rejects(db.query('delete from vnext_market.encoded_origins'), /MARKET_IMMUTABLE/);
  await db.exec('set role authenticated');
  assert.equal((await rpc(prepared.rpc, prepared.args)).error?.code, '42501');
  await assert.rejects(db.query('select * from vnext_market.encoded_origins'), e => e.code === '42501');
  passed('all original UTF8 bytes including BOM, matrix row hashes and exact replay persist with service-only and append-only enforcement');

  await db.exec('set role service_role');
  const needed = new Set(['twse_companies', 'tpex_companies', 'emerging_companies']);
  for (const file of readdirSync(sourceRoot).filter(f => /^acquisition-.*\.json$/.test(f)).sort()) {
    for (const r of JSON.parse(readFileSync(resolve(sourceRoot, file), 'utf8')).receipts ?? []) if (needed.delete(r.source_id)) {
      assert.equal((await stageDailyAiMarketCapture({ rpc, receipt: r, bytes: readFileSync(r.raw_path) })).state, 'STAGED');
    }
  }
  assert.equal(needed.size, 0); assert.equal((await stageDailyAiMarketWorkPlan({ rpc, universe, plan })).state, 'STAGED');
  const symbol = matrix[1][2], securityId = 'TWSE:' + symbol, company = universe.companies.find(c => c.security_id === securityId); assert.ok(company);
  const content = JSON.stringify({ schema: 'SOURCE_BINDING_TEST_NOT_RECOMMENDATION', family: 'REVENUE', symbol, original_fields: objects[0],
    source_capture: { capture_id: staged.capture_id, source_id: receipt.source_id, source_url: receipt.url,
      source_sha256: receipt.sha256, source_bytes: receipt.bytes, received_at: receipt.received_at,
      row_index: 1, row_path: [1], symbol_field: '2', source_row_hash: marketSnapshotHash(matrix[1]) } });
  const evidenceHash = sha(content), packet = { symbol, company: company.company, cutoff, data_gaps: ['SOURCE_BINDING_TEST_NOT_RECOMMENDATION'], evidence: [{
    id: 'market-' + evidenceHash.slice(0, 40), symbol, kind: 'FINANCIAL', source: receipt.url, published_at: null,
    available_at: receipt.received_at, time_basis: 'OBSERVED_AFTER_RECEIPT', first_seen_at: receipt.received_at,
    as_of: receipt.received_at, evidence_hash: evidenceHash, content,
  }] };
  await db.exec('reset role');
  await db.query('select vnext_market.validate_packet($1,$2,$3)', [packet, securityId, plan.plan_hash]);
  const wrong = globalThis.structuredClone(packet), bad = JSON.parse(wrong.evidence[0].content); bad.source_capture.row_index = 2; bad.source_capture.row_path = [2];
  bad.source_capture.source_row_hash = marketSnapshotHash(matrix[2]); wrong.evidence[0].content = JSON.stringify(bad);
  wrong.evidence[0].evidence_hash = sha(wrong.evidence[0].content); wrong.evidence[0].id = 'market-' + wrong.evidence[0].evidence_hash.slice(0, 40);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [wrong, securityId, plan.plan_hash]), /MARKET_EVIDENCE_SYMBOL/);
  assert.equal((await db.query('select count(*)::int n from vnext_market.reviews')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from vnext_market.publication_events')).rows[0].n, 0);
  passed('real issuer source binding validates against raw UTF8 and column 2; replacing it with another issuer row rejects and no review is created');

  await db.exec(readFileSync(new URL('../research/daily-ai-market-revenue-csv.rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query("select to_regprocedure('public.stage_daily_ai_market_revenue_capture_v2(text,text,text)') name")).rows[0].name, null);
  assert.equal((await db.query('select count(*)::int n from vnext_market.encoded_origins')).rows[0].n, 1);
  await db.query('select vnext_market.validate_packet($1,$2,$3)', [packet, securityId, plan.plan_hash]);
  passed('guarded rollback closes the added download admission while retaining the source bytes and valid immutable evidence');
  console.log(JSON.stringify({ result: 'PASS', phases, source_id: receipt.source_id, source_sha256: receipt.sha256,
    original_bytes: raw.length, data_rows: objects.length, pglite_codec: 'NATIVE_UTF8_NO_SUBSTITUTION', production_writes: 0, provider_requests: 0 }));
} catch (error) { console.error(JSON.stringify({ result: 'FAIL', phase: phases + 1, message: error.message, code: error.code, position: error.position })); process.exitCode = 1; }
finally { await db.close(); }
