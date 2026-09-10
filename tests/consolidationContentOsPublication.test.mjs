// Actual Edge entrypoint and every relative dependency. Only the SDK transport
// is replaced by an exact-filter in-memory database. No HTTP, SQL, Production,
// Auth service, provider, or external consumer execution is claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch, assembleResearchMasterV2, admitResearchRecommendations, validateResearchMasterV2 } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(resolve(root, path), 'utf8');
const entry = resolve(root, 'supabase/functions/content-os-morning-alpha-source/index.ts');
const fixtureDeps = { read, isolatedFunction, assert, structuredClone, assembleCanonicalMarketResearch,
  assembleResearchMasterV2, admitResearchRecommendations, validateResearchMasterV2,
  buildCanonicalMarketState, canonicalMarketSourceRefs, evaluateMarketReportGate, evaluatePremiumContentGate, exports: {} };
const baseFixture = isolatedFunction(read('tests/consolidationPublicationConsumers.test.mjs'), 'fixture', fixtureDeps);
const qualify = isolatedFunction(read('tests/consolidationCurrentPayloadAuthority.test.mjs'), 'qualifyCurrentFixture', fixtureDeps);

function fixture({ https = true, qualified = false } = {}) {
  const f = baseFixture();
  f.now = `${f.report.report_date}T00:05:00.000Z`;
  f.policy = { policy_version: 'MA_RUNTIME_POLICY_V1', premium_publish_min: 90, active: true };
  f.review = { id: 'synthetic-editorial-receipt', decision_snapshot_id: f.snapshot.id,
    review_status: 'APPROVED', content_score: f.snapshot.content_score,
    reviewed_at: f.snapshot.valid_from, reviewed_by: 'synthetic-editor', reason_codes: [] };
  if (https) {
    const input = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture')();
    input.legacy = f.report.ai_strategy_json;
    const news = input.evidenceIndex.find(row => row.evidence_id === 'NEWS001');
    // Explicit synthetic provider input, passed through the actual assembler.
    // This does not add fields to the captured actual 9/21 predecessor.
    news.raw_reference = 'https://evidence.example.invalid/ai-server';
    const state = buildCanonicalMarketState(assembleCanonicalMarketResearch(input));
    assert.equal(state.status, 'READY');
    f.report.ai_strategy_json.canonical_market_state = state;
    f.report.ai_strategy_json.research_master_v2 = state.document;
    f.snapshot.generated_text.canonical_market_state = structuredClone(state);
    f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
  }
  if (qualified) {
    qualify(f);
    // The same admitted candidate supplies the existing public stock fields;
    // these are presentation metadata, not a forced quality/admission result.
    const stock = f.snapshot.generated_text.recommendations[0];
    stock.sector = '半導體';
    stock.source_refs = [stock.data_basis];
    assert.equal(evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date).recommendation_gate.eligible, true);
    assert.equal(evaluatePremiumContentGate(f.report.ai_strategy_json, 0).eligible, true);
  }
  return f;
}

function database(f, trace, failures = {}) {
  const tables = {
    reports: f.report ? [f.report] : [],
    decision_snapshots: f.snapshot ? [f.snapshot, { ...f.snapshot, id: 'newer-private-qa', version: 99, is_current: true, status: 'PARTIAL' }] : [],
    member_content_revisions: f.member ? [f.member] : [],
    pipeline_runs: f.publicationRun ? [f.publicationRun] : [],
    runtime_quality_policies: f.policy ? [f.policy] : [],
    editorial_reviews: f.review ? [f.review] : [],
  };
  const field = (row, key) => key.split(/->>?/).reduce((value, part) => value?.[part], row);
  return {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
      const filters = [];
      const query = {
        select(columns) { trace.push({ kind: 'select', table, columns }); return query; },
        eq(key, value) { filters.push([key, value, 'eq']); return query; },
        like(key, value) { filters.push([key, value, 'like']); return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() {
          trace.push({ kind: 'read', table, filters });
          if (failures[table]) return { data: null, error: { message: 'SYNTHETIC_READ_FAILURE' } };
          const rows = tables[table].filter(row => filters.every(([key, value, mode]) => mode === 'like'
            ? String(field(row, key)).startsWith(value.replace(/%$/, '')) : field(row, key) === value));
          return { data: rows[0] || null, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.ok(['record_content_os_incident_v1', 'resolve_content_os_incident_v1'].includes(name), `Unexpected RPC ${name}`);
      trace.push({ kind: 'rpc', name, args });
      return failures[name] ? { data: null, error: { message: 'SYNTHETIC_RPC_FAILURE' } }
        : { data: name.startsWith('record_') ? 'synthetic-incident' : true, error: null };
    },
  };
}

async function run(f, { headers = { authorization: 'Bearer synthetic-source-credential' }, method = 'GET', failures = {}, envPatch = {} } = {}) {
  const trace = [], cache = new Map();
  const env = { SUPABASE_URL: 'https://database.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-credential',
    SONY_CONTENT_OS_SOURCE_TOKEN: 'synthetic-source-credential', CRON_SECRET: 'synthetic-cron-credential', ...envPatch };
  let handler;
  class FixedDate extends Date { constructor(value = f.now) { super(value); } static now() { return Date.parse(f.now); } }
  const globals = { Response, Request, Headers, URL, TextEncoder, TextDecoder, Date: FixedDate, Intl, crypto: webcrypto,
    console: { log() {}, info() {}, warn() {}, error() {} }, Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } } };
  const load = path => {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const require = spec => {
      if (spec.startsWith('.')) return load(resolve(dirname(path), spec));
      if (spec === 'npm:@supabase/supabase-js@2.57.4') return { createClient: () => database(f, trace, failures) };
      throw new Error(`Unapproved import ${spec}`);
    };
    vm.runInNewContext(code, { ...globals, module, exports: module.exports, require }, { filename: path });
    return module.exports;
  };
  load(entry);
  assert.equal(typeof handler, 'function');
  const before = JSON.stringify(f);
  const response = await handler(new Request('https://function.example.invalid/content-os-morning-alpha-source', { method, headers }));
  assert.equal(JSON.stringify(f), before, 'Reader must not mutate business evidence');
  return { status: response.status, body: await response.json(), headers: response.headers, trace };
}

test('actual export uses committed market authority and existing v19 market_brief wire without any stock', async () => {
  const f = fixture(), result = await run(f);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.contract_version, 'morning_alpha_public_contract_v1');
  assert.equal(result.body.public_topic.kind, 'market_brief');
  assert.equal(result.body.public_topic.symbol, undefined);
  assert.deepEqual(result.body.opportunities, []);
  assert.equal(result.body.confidence_score, 64);
  assert.equal(result.body.public_summary, f.snapshot.generated_text.canonical_market_state.document.sections.executive_summary.text);
  assert.equal(result.body.source_published_at, f.publicationRun.completed_at);
  assert.equal(result.body.source_references[0].url, 'https://evidence.example.invalid/ai-server');
  assert.equal(result.body.premium.locked, true);
  assert.equal(result.body.verification.member_content_revision_id, f.member.id);
  assert.equal(result.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  const reads = result.trace.filter(row => row.kind === 'read');
  assert.ok(reads.filter(row => row.table === 'decision_snapshots').every(row => row.filters.some(([key, value]) => key === 'id' && value === f.snapshot.id)));
  assert.ok(reads.every(row => row.filters.every(([key]) => key !== 'is_current')));
  assert.deepEqual(result.trace.filter(row => row.kind === 'rpc').map(row => [row.name, row.args.p_incident_key]),
    [['resolve_content_os_incident_v1', `content-os:${f.report.report_date}:${f.snapshot.id}`]], 'No same-day stale/unknown incident sweep');
});

test('real admission + independent Premium retains the qualified first-stock public branch', async () => {
  const f = fixture({ qualified: true }), result = await run(f);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.public_topic.kind, 'stock_opportunity');
  assert.equal(result.body.public_topic.symbol, '2330');
  assert.equal(result.body.opportunities.length, 1);
  assert.equal(result.body.public_topic.confirmation_condition, undefined);
  assert.equal(result.body.public_topic.invalidation_condition, undefined);
  assert.equal(result.body.verification.public_premium_leakage, true);
});

test('legacy qualified publication without frozen outgoing CMS cannot emit false verified evidence', async () => {
  const f = fixture({ qualified: true });
  delete f.report.ai_strategy_json.market_publication_contract;
  delete f.snapshot.generated_text.canonical_market_state;
  const result = await run(f);
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error, 'FROZEN_PUBLIC_MARKET_EVIDENCE_REQUIRED');
  assert.equal(result.body.verification, undefined);
  assert.equal(result.trace.some(row => row.name === 'resolve_content_os_incident_v1'), false);
});

for (const [name, mutate] of [
  ['raw confidence and prose', f => { f.report.confidence_score = 100; f.report.market_bias = 'PRIVATE'; f.report.summary = 'PRIVATE'; f.report.ai_strategy_json.today_summary = 'PRIVATE'; }],
  ['current private research failure', f => { Object.assign(f.report.ai_strategy_json, { canonical_market_state: {}, research_master_v2: {}, data_quality: 'failed', missing_sources: ['PRIVATE'], member_value_score: 0 }); }],
  ['private member score/status', f => { f.member.content_score = 0; f.member.status = 'BLOCKED'; f.member.data_quality_status = 'insufficient'; }],
  ['unadmitted current stocks', f => { f.report.ai_strategy_json.today_beneficiary_stocks_v10 = [{ symbol: 'PRIVATE_STOCK' }]; }],
]) test(`valid committed market survives ${name} byte-for-byte`, async () => {
  const f = fixture(), before = await run(f); mutate(f); const after = await run(f);
  assert.equal(after.status, 200, JSON.stringify(after.body)); assert.deepEqual(after.body, before.body);
});

test('Premium failure suppresses an admitted stock without revoking market publication', async () => {
  const f = fixture({ qualified: true }); f.report.ai_strategy_json.member_value_score = 0;
  const result = await run(f); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.public_topic.kind, 'market_brief'); assert.deepEqual(result.body.opportunities, []);
});

const publicationNegatives = [
  ['missing durable run', f => { f.publicationRun = null; }],
  ['failed durable run', f => { f.publicationRun.status = 'FAILED'; }],
  ['wrong run revision', f => { f.publicationRun.provider_status.result.decision_snapshot_id = 'foreign'; }],
  ['wrong run report', f => { f.publicationRun.provider_status.result.report_id = 'foreign'; }],
  ['wrong run date', f => { f.publicationRun.provider_status.result.report_date = '2026-07-13'; }],
  ['missing committed member', f => { f.member = null; }],
  ['wrong member revision', f => { f.member.decision_snapshot_version++; }],
  ['unpublished CORE', f => { f.report.ai_strategy_json.market_publication_contract.status = 'READY'; }],
  ['wrong CORE schema', f => { f.report.ai_strategy_json.market_publication_contract.schema_version = 'UNKNOWN'; }],
  ['wrong CORE revision', f => { f.report.ai_strategy_json.market_publication_contract.revision_id = 'foreign'; }],
  ['missing frozen opening pointer', f => { delete f.report.ai_strategy_json.market_publication_contract.opening_publication_revision_id; }],
  ['missing frozen CMS', f => { delete f.snapshot.generated_text.canonical_market_state; }],
  ['incomplete frozen measurement', f => { f.snapshot.generated_text.data_quality = 'partial'; }],
  ['corrupt ledger source', f => { f.snapshot.source_refs[0].source_date = '2099-01-01'; }],
  ['PARTIAL committed snapshot', f => { f.snapshot.status = 'PARTIAL'; }],
  ['failed publication semantic', f => { f.publicationRun.provider_status.result.semantic_status = 'BLOCKED'; }],
];
for (const [name, mutate] of publicationNegatives) test(`export fail-closed: ${name}`, async () => {
  const f = fixture(); mutate(f); const result = await run(f);
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error, 'PUBLISHED_MARKET_CONTRACT_BLOCKED');
  assert.deepEqual(result.trace.filter(row => row.kind === 'rpc').map(row => row.name), ['record_content_os_incident_v1']);
  assert.equal(result.body.public_topic, undefined);
});

for (const [name, mutate, error] of [
  ['failed same-revision semantic row', f => { f.member.semantic_coherence_reviews[0].status = 'BLOCKED'; }, 'SEMANTIC_COHERENCE_BLOCKED'],
  ['foreign semantic row', f => { f.member.semantic_coherence_reviews[0].canonical_snapshot_id = 'foreign'; }, 'SEMANTIC_COHERENCE_BLOCKED'],
  ['post-publication semantic row', f => { f.member.semantic_coherence_reviews[0].checked_at = `${f.report.report_date}T10:00:00Z`; }, 'SEMANTIC_COHERENCE_BLOCKED'],
  ['missing editorial receipt', f => { f.review = null; }, 'EDITORIAL_REVIEW_NOT_APPROVED'],
  ['foreign editorial receipt', f => { f.review.decision_snapshot_id = 'foreign'; }, 'EDITORIAL_REVIEW_NOT_APPROVED'],
  ['later editorial receipt', f => { f.review.reviewed_at = `${f.report.report_date}T10:00:00Z`; }, 'EDITORIAL_REVIEW_NOT_APPROVED'],
  ['stored editorial mismatch', f => { f.review.content_score = 99; }, 'EDITORIAL_REVIEW_NOT_APPROVED'],
  ['missing frozen confidence with raw100', f => { f.snapshot.confidence_score = null; f.report.confidence_score = 100; }, 'PUBLIC_TOPIC_INCOMPLETE'],
]) test(`existing export evidence remains strict: ${name}`, async () => {
  const f = fixture(); mutate(f); const result = await run(f);
  assert.equal(result.status, 409, JSON.stringify(result.body)); assert.equal(result.body.error, error);
  assert.equal(result.trace.some(row => row.name === 'resolve_content_os_incident_v1'), false);
});

for (const [name, mutate] of [
  ['only ledger IDs', () => {}],
  ['raw report HTTPS links', f => { f.report.ai_strategy_json.source_references = [{ url: 'https://private.example.invalid', title: 'private', source: 'private', published_at: f.now }]; }],
  ['raw PASS and v19 bypass', f => { f.report.ai_strategy_json.public_delivery_gate = { eligible: true, status: 'PASS' }; f.report.ai_strategy_json.allow_missing_public_gate = true; }],
]) test(`missing committed HTTPS evidence cannot be repaired by ${name}`, async () => {
  const f = fixture({ https: false }); mutate(f); const result = await run(f);
  assert.equal(result.status, 409); assert.equal(result.body.error, 'PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
  assert.equal(result.trace.some(row => row.name === 'resolve_content_os_incident_v1'), false);
});

for (const [name, options, status] of [
  ['dedicated source token', {}, 200],
  ['internal cron token', { headers: { 'x-cron-secret': 'synthetic-cron-credential' } }, 200],
  ['service API key', { headers: { apikey: 'synthetic-service-credential' } }, 200],
  ['wrong internal header', { headers: { 'x-cron-secret': 'wrong' } }, 401],
  ['wrong source token', { headers: { authorization: 'Bearer wrong' } }, 401],
  ['no source configuration', { headers: {}, envPatch: { SONY_CONTENT_OS_SOURCE_TOKEN: '' } }, 503],
  ['method guard', { method: 'POST' }, 405],
]) test(`original auth/method boundary: ${name}`, async () => {
  const result = await run(fixture(), options); assert.equal(result.status, status, JSON.stringify(result.body));
  if (status !== 200) assert.deepEqual(result.trace, [], 'Unauthorized requests perform no business reads or incident writes');
});

test('no today report cannot export an older ready QA snapshot', async () => {
  const f = fixture(); f.now = '2026-07-15T00:05:00Z'; const result = await run(f);
  assert.equal(result.status, 404); assert.equal(result.trace.some(row => row.kind === 'rpc'), false);
});

for (const [failure, expected] of [
  ['pipeline_runs', 'PUBLISHED_DECISION_EVIDENCE_READ_FAILED'],
  ['resolve_content_os_incident_v1', 'CONTENT_OS_INCIDENT_RESOLUTION_FAILED'],
  ['record_content_os_incident_v1', 'CONTENT_OS_INCIDENT_WRITE_FAILED'],
]) test(`private read/write errors fail closed: ${failure}`, async () => {
  const f = fixture({ https: failure !== 'record_content_os_incident_v1' });
  const result = await run(f, { failures: { [failure]: true } });
  assert.equal(result.status, 503); assert.equal(result.body.error, expected);
  assert.equal(result.body.public_topic, undefined);
});

test('response-size rejection happens before incident resolution', async () => {
  const f = fixture();
  for (const claim of f.snapshot.generated_text.canonical_market_state.document.quality.coverage_audit.claims) {
    for (const source of claim.sources) if (source.evidence_id === 'NEWS001') source.title = 'x'.repeat(1_000_000);
  }
  f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
  const result = await run(f); assert.equal(result.status, 503); assert.equal(result.body.error, 'SOURCE_RESPONSE_TOO_LARGE');
  assert.equal(result.trace.some(row => row.kind === 'rpc'), false);
});

for (const [name, mutate] of [
  ['attached arbitrary URL', f => { f.snapshot.source_refs.find(row => row.evidence_id === 'NEWS001').url = 'https://foreign.example.invalid/'; }],
  ['attached different title', f => { f.snapshot.source_refs.find(row => row.evidence_id === 'NEWS001').title = 'UNBOUND_TITLE'; }],
  ['attached different published timestamp', f => { f.snapshot.source_refs.find(row => row.evidence_id === 'NEWS001').published_at = f.now; }],
  ['missing source evidence ID', f => { delete f.snapshot.source_refs.find(row => row.evidence_id === 'NEWS001').evidence_id; }],
  ['source URL absent', f => { delete f.snapshot.source_refs.find(row => row.evidence_id === 'NEWS001').url; }],
  ['frozen CMS metadata changed independently', f => { for (const claim of f.snapshot.generated_text.canonical_market_state.document.quality.coverage_audit.claims) {
    for (const row of claim.sources) if (row.evidence_id === 'NEWS001') row.url = 'https://foreign.example.invalid/';
  } }],
]) test(`public references reject ${name}`, async () => {
  const f = fixture(); mutate(f); const result = await run(f);
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.trace.some(row => row.name === 'resolve_content_os_incident_v1'), false);
  assert.equal(result.body.source_references, undefined);
});

for (const url of ['http://source.example.invalid/a', 'https://user:password@source.example.invalid/a',
  'https://source.example.invalid/a?token=synthetic', 'https://source.example.invalid/a#private']) {
  test(`frozen unsafe URL never becomes public metadata: ${new URL(url).protocol}/${url.includes('?') ? 'query' : url.includes('#') ? 'fragment' : url.includes('@') ? 'userinfo' : 'plain'}`, async () => {
    const f = fixture();
    for (const claim of f.snapshot.generated_text.canonical_market_state.document.quality.coverage_audit.claims) {
      for (const row of claim.sources) if (row.evidence_id === 'NEWS001') row.url = url;
    }
    f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
    const result = await run(f); assert.equal(result.status, 409);
    assert.equal(result.body.error, 'PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
    assert.equal(JSON.stringify(result.body).includes(url), false);
  });
}

test('even matching metadata timestamps must equal the source ledger timestamp', async () => {
  const f = fixture();
  for (const claim of f.snapshot.generated_text.canonical_market_state.document.quality.coverage_audit.claims) {
    for (const row of claim.sources) if (row.evidence_id === 'NEWS001') row.published_at = f.now;
  }
  f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
  const result = await run(f); assert.equal(result.status, 409); assert.equal(result.body.error, 'PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
});

for (const [name, mutate, failures] of [
  ['missing policy', f => { f.policy = null; }, {}],
  ['invalid policy', f => { f.policy.premium_publish_min = null; }, {}],
  ['unavailable policy query', () => {}, { runtime_quality_policies: true }],
]) test(`current Premium ${name} cannot block the committed market`, async () => {
  const f = fixture({ qualified: true }); mutate(f); const result = await run(f, { failures });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.public_topic.kind, 'market_brief'); assert.deepEqual(result.body.opportunities, []);
  assert.equal(result.body.verification.quality_policy_version, undefined);
  assert.equal(result.body.verification.required_score, undefined);
});

for (const confidence of [0, 100]) test(`genuine frozen confidence ${confidence} is retained without a raw alias`, async () => {
  const f = fixture(); f.snapshot.confidence_score = confidence; delete f.report.confidence_score;
  const result = await run(f); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.confidence_score, confidence);
});
