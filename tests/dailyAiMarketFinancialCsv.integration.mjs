// Local database only. The retained CSV is real official public evidence.
// PGlite lacks its BIG5 WASM codec: the private decoder seam is replaced only
// in this disposable fixture by an exact raw-SHA -> decoded-text lookup.
// Native BIG5 conversion and byte roundtrip were separately checked by a
// read-only SELECT on PostgreSQL 17.6; this test does not claim to rerun it.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { marketSnapshotHash, planTaiwanMarketAnalysis } from '../research/taiwan-market-universe.mjs';
import { stageDailyAiMarketCapture, stageDailyAiMarketWorkPlan, prepareDailyAiMarketCapture } from '../research/daily-ai-market-stage.mjs';

for (const name of ['MA_PGLITE_MODULE', 'MA_MARKET_SOURCE_DIR', 'MA_FINANCIAL_CSV_DOCUMENT']) if (!process.env[name]) throw Error(name + '_REQUIRED');
const { PGlite } = await import(process.env.MA_PGLITE_MODULE), db = new PGlite(); await db.waitReady;
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceRoot = process.env.MA_MARKET_SOURCE_DIR;
const document = JSON.parse(readFileSync(process.env.MA_FINANCIAL_CSV_DOCUMENT, 'utf8'));
const receipt = document.source_receipt, original = document.original_source_receipt;
const raw = readFileSync(original.raw_path), decoded = new TextDecoder('big5', { fatal: true }).decode(raw);
assert.equal(sha(raw), receipt.sha256); assert.equal(sha(decoded), receipt.decoded_text_sha256);
const universe = JSON.parse(readFileSync(resolve(sourceRoot, 'normalized/universe.json'), 'utf8'));
const cutoff = new Date().toISOString(), day = new Date(Date.parse(cutoff) + 8 * 3_600_000).toISOString().slice(0, 10);
const plan = planTaiwanMarketAnalysis({ universe, business_date: day, cutoff, shard_size: 64 });
const rpc = async (name, args) => {
  assert.ok(['stage_daily_ai_market_capture_v2', 'stage_daily_ai_market_encoded_capture_v2', 'stage_daily_ai_market_work_plan_v2'].includes(name));
  const values = Object.values(args);
  try { return { data: (await db.query(`select public.${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) result`, values)).rows[0].result, error: null }; }
  catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
};
let phases = 0;
const passed = label => console.log(JSON.stringify({ phase: ++phases, result: 'PASS', label }));
const capture = { receipt, bytes: raw };
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create schema academy_private;create function academy_private.access_v11() returns text language sql as $$select 'denied'::text$$;
    create function public.is_research_owner_v1() returns boolean language sql as $$select false$$;
    create schema vnext_private;create table vnext_private.source_licenses(source text,storage_allowed boolean,derived_allowed boolean,
      commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
  await db.exec(readFileSync(new URL('../research/daily-ai-market-v2.candidate.sql', import.meta.url), 'utf8'));
  const extension = readFileSync(new URL('../research/daily-ai-market-financial-csv.candidate.sql', import.meta.url), 'utf8');
  await db.exec(extension);
  const decoder = (await db.query("select prosrc from pg_proc where oid='vnext_market.decode_big5_exact(bytea)'::regprocedure")).rows[0].prosrc;
  assert.match(decoder, /convert_from\(p_raw,'BIG5'\)/); assert.match(decoder, /convert_to\(decoded,'BIG5'\) is distinct from p_raw/);
  await db.exec(`create schema fixture_codec;create table fixture_codec.samples(raw_hash text primary key,decoded text not null);
    create or replace function vnext_market.decode_big5_exact(p_raw bytea) returns text language plpgsql immutable set search_path='' as $$
    declare value text;begin select decoded into value from fixture_codec.samples where raw_hash=encode(sha256(p_raw),'hex');
     if not found then raise exception 'EXACT_LOCAL_CODEC_FIXTURE_REQUIRED';end if;return value;end $$;`);
  await db.query('insert into fixture_codec.samples values($1,$2)', [sha(raw), decoded]);
  const parsed = (await db.query('select row_body from vnext_market.csv_matrix($1) row_body', [decoded])).rows.map(r => r.row_body);
  assert.equal(parsed.length, receipt.row_count); assert.equal(parsed.length - 1, document.records.length);
  assert.deepEqual(parsed[0], document.raw_csv_headers);
  for (const row of document.records) {
    assert.equal(marketSnapshotHash(parsed[row.source_capture.row_index]), row.source_capture.source_row_hash);
    assert.equal(parsed[row.source_capture.row_index][3], row.symbol);
  }
  passed('server CSV matrix preserves every original cell and matches the real independently normalized raw-row hashes');

  await db.exec('set role service_role');
  const wrongDecoded = await stageDailyAiMarketCapture({ rpc, ...capture, receipt: { ...receipt, decoded_text_sha256: '0'.repeat(64) } });
  assert.equal(wrongDecoded.reason, 'MARKET_ENCODED_DECODED_HASH');
  const wrongYear = globalThis.structuredClone(receipt);
  wrongYear.source_id = wrongYear.source_id.replace('_2025Q4_', '_2024Q4_'); wrongYear.parent_request_form.year = '113';
  assert.equal((await stageDailyAiMarketCapture({ rpc, bytes: raw, receipt: wrongYear })).reason, 'MARKET_ENCODED_ROW_PERIOD');
  const wrongFamily = globalThis.structuredClone(receipt);
  wrongFamily.source_id = wrongFamily.source_id.replace('MOPS_INCOME_', 'MOPS_BALANCE_');
  wrongFamily.parent_request_url = wrongFamily.parent_request_url.replace('ajax_t163sb04', 'ajax_t163sb05');
  assert.equal((await stageDailyAiMarketCapture({ rpc, bytes: raw, receipt: wrongFamily })).reason, 'MARKET_ENCODED_HEADER');
  const prepared = prepareDailyAiMarketCapture(capture);
  const badBytes = Buffer.from(raw); badBytes[badBytes.length - 1] ^= 1;
  const bad = await rpc(prepared.rpc, { ...prepared.args, p_source_bytes_base64: badBytes.toString('base64') });
  assert.equal(bad.error?.message, 'MARKET_ENCODED_RECEIPT');
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from vnext_market.captures')).rows[0].n, 0);
  passed('bad original bytes, decoded hash, fiscal year and statement-family substitutions reject before any insert');

  await db.exec('set role service_role');
  const staged = await stageDailyAiMarketCapture({ rpc, ...capture });
  assert.equal(staged.state, 'STAGED', JSON.stringify(staged)); assert.equal(staged.capture_id, document.source_capture.capture_id);
  assert.equal((await stageDailyAiMarketCapture({ rpc, ...capture })).replayed, true);
  await db.exec('reset role');
  const saved = (await db.query(`select c.body_sha256,c.body_bytes,o.raw_sha256,o.raw_byte_count,
    encode(o.raw_bytes,'base64') raw_base64,(select count(*)::int from vnext_market.capture_rows where capture_id=c.id) rows
    from vnext_market.captures c join vnext_market.encoded_origins o on o.capture_id=c.id where c.id=$1`, [staged.capture_id])).rows[0];
  assert.equal(saved.raw_sha256, sha(raw)); assert.equal(saved.body_sha256, sha(decoded));
  assert.equal(saved.raw_byte_count, raw.length); assert.equal(saved.body_bytes, Buffer.byteLength(decoded));
  assert.deepEqual(Buffer.from(saved.raw_base64, 'base64'), raw); assert.equal(saved.rows, parsed.length);
  await assert.rejects(db.query('update vnext_market.encoded_origins set raw_bytes=raw_bytes'), /MARKET_IMMUTABLE/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from vnext_market.encoded_origins'), e => e.code === '42501');
  const forbidden = await rpc(prepared.rpc, prepared.args); assert.equal(forbidden.error?.code, '42501');
  await db.exec('set role service_role');
  await assert.rejects(db.query('select * from vnext_market.encoded_origins'), e => e.code === '42501');
  passed('encoded raw bytes and UTF8 text retain distinct immutable hashes; exact replay works and direct/client access is denied');

  const rosterIds = new Set(['twse_companies', 'tpex_companies', 'emerging_companies']);
  for (const file of readdirSync(sourceRoot).filter(f => /^acquisition-.*\.json$/.test(f)).sort()) {
    for (const r of JSON.parse(readFileSync(resolve(sourceRoot, file), 'utf8')).receipts ?? []) if (rosterIds.delete(r.source_id)) {
      const result = await stageDailyAiMarketCapture({ rpc, receipt: r, bytes: readFileSync(r.raw_path) }); assert.equal(result.state, 'STAGED', JSON.stringify(result));
    }
  }
  assert.equal(rosterIds.size, 0);
  assert.equal((await stageDailyAiMarketWorkPlan({ rpc, universe, plan })).state, 'STAGED');
  const row = document.records[0], company = universe.companies.find(c => c.security_id === row.security_id); assert.ok(company);
  const content = JSON.stringify(row), evidenceHash = sha(content);
  const packet = { symbol: row.symbol, company: company.company, cutoff, data_gaps: ['SOURCE_PROOF_TEST_NOT_RECOMMENDATION'], evidence: [{
    id: 'market-' + evidenceHash.slice(0, 40), symbol: row.symbol, kind: 'FINANCIAL', source: receipt.url, published_at: null,
    available_at: receipt.received_at, time_basis: 'OBSERVED_AFTER_RECEIPT', first_seen_at: receipt.received_at,
    as_of: receipt.received_at, evidence_hash: evidenceHash, content,
  }] };
  await db.exec('reset role');
  await db.query('select vnext_market.validate_packet($1,$2,$3)', [packet, row.security_id, plan.plan_hash]);
  const wrong = globalThis.structuredClone(packet), changed = JSON.parse(wrong.evidence[0].content);
  changed.source_capture.source_sha256 = receipt.decoded_text_sha256;
  wrong.evidence[0].content = JSON.stringify(changed); wrong.evidence[0].evidence_hash = sha(wrong.evidence[0].content);
  wrong.evidence[0].id = 'market-' + wrong.evidence[0].evidence_hash.slice(0, 40);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [wrong, row.security_id, plan.plan_hash]), /MARKET_EVIDENCE_TIME_OR_SOURCE/);
  assert.equal((await db.query('select count(*)::int n from vnext_market.reviews')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from vnext_market.publication_events')).rows[0].n, 0);
  passed('a real issuer packet validates against original Big5 SHA and indexed CSV row; substituting decoded UTF8 SHA rejects without review or publication');
  await db.exec(readFileSync(new URL('../research/daily-ai-market-financial-csv.rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='vnext_market.validate_packet(jsonb,text,text)'::regprocedure")).rows[0].hash,
    '43e0301367218b994d84ae5fb24bcacd');
  assert.equal((await db.query("select to_regprocedure('public.stage_daily_ai_market_encoded_capture_v2(text,text,text)') name")).rows[0].name, null);
  assert.equal((await db.query('select count(*)::int n from vnext_market.encoded_origins')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from vnext_market.evidence')).rows[0].n, 1);
  await assert.rejects(db.query('select vnext_market.validate_packet($1,$2,$3)', [packet, row.security_id, plan.plan_hash]), /MARKET_EVIDENCE_TIME_OR_SOURCE/);
  passed('exact guarded rollback restores the base validator and closes encoded admission while retaining original bytes and immutable evidence');
  console.log(JSON.stringify({ result: 'PASS', phases, source_id: receipt.source_id, original_sha256: receipt.sha256,
    decoded_utf8_sha256: receipt.decoded_text_sha256, data_rows: document.records.length, production_writes: 0, provider_requests: 0,
    pglite_decoder: 'EXACT_RAW_HASH_FIXTURE_LOOKUP_NATIVE_POSTGRES_PROBED_SEPARATELY' }));
} catch (error) { console.error(JSON.stringify({ result: 'FAIL', phase: phases + 1, message: error.message, code: error.code, detail: error.detail })); process.exitCode = 1; }
finally { await db.close(); }
