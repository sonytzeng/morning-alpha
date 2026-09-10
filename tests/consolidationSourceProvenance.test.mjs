// Actual producer evidence index -> assembler ledger -> canonical source refs.
// In-memory synthetic inputs only; no DB, provider, Auth or Production requests.
// Public metadata deliberately excludes ALL query/fragment URLs, including
// otherwise harmless tracking queries; unsupported metadata never changes gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const completeFixture = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture');
const buildEvidenceIndex = isolatedFunction(read('supabase/functions/generate-daily-report-v7/index.ts'), 'buildEvidenceIndex');
const metadataKeys = ['title', 'url', 'published_at'];
const tuple = source => Object.fromEntries(['evidence_id', 'source', 'source_date', 'freshness'].map(key => [key, source[key]]));
const metadata = source => Object.fromEntries(metadataKeys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));

function fixture() {
  const input = completeFixture(), ai = input.legacy;
  const original = input.evidenceIndex.find(row => row.evidence_id === 'NEWS001');
  const news = buildEvidenceIndex({ normalized_news: [1, 2, 3].map(index => ({
    topic: original.title, representative_summary: `${original.summary} 合成來源 ${index}。`,
    source: 'Synthetic market provider', published_at: original.published_at,
    url: `https://fixture.example.invalid/market-source-${index}`, importance: 70 + index, freshness: 'recent',
  })) });
  input.evidenceIndex = [...input.evidenceIndex.filter(row => row.evidence_id !== 'NEWS001'), ...news];
  input.marketThesis.supporting_evidence.push(...news.map(row => ({ evidence_id: row.evidence_id, weight: 70, purpose: 'supporting' })));
  const sentence = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  Object.assign(ai, { today_quote: sentence, today_beneficiary_stocks: [], today_beneficiary_stocks_v10: [],
    v10_beneficiary_enabled: true, v10_data_quality_status: 'insufficient_positive_evidence',
    data_quality: 'complete', missing_sources: [], content_evidence_quality: { contract_version: 'PREMIUM_EVIDENCE_V1',
      verified_market_count: 3, verified_news_count: 3, blank_market_change_count: 0, all_news_traceable: true } });
  ai.member_research_note_v2.today_core_thesis = sentence;
  return input;
}

function assemble(input) {
  const document = assembleCanonicalMarketResearch(input);
  const cms = buildCanonicalMarketState(document);
  const ai = { ...input.legacy, canonical_market_state: cms, research_master_v2: document };
  return { document, cms, ai, refs: canonicalMarketSourceRefs(ai) };
}

function withoutMetadata(document) {
  const copy = structuredClone(document);
  for (const claim of copy.quality.coverage_audit.claims) for (const source of claim.sources) {
    for (const key of metadataKeys) delete source[key];
  }
  return copy;
}

function assertGateInvariant(input, result) {
  const document = withoutMetadata(result.document), cms = buildCanonicalMarketState(document);
  assert.deepEqual({ ...result.cms, document: undefined }, { ...cms, document: undefined });
  const originalGate = evaluateMarketReportGate(result.ai, input.reportDate);
  const noMetadataGate = evaluateMarketReportGate({ ...input.legacy, canonical_market_state: cms, research_master_v2: document }, input.reportDate);
  assert.deepEqual(originalGate, noMetadataGate, 'optional public provenance cannot change publication/recommendation decisions');
  assert.deepEqual(result.refs.map(tuple), canonicalMarketSourceRefs({ canonical_market_state: cms }).map(tuple));
}

test('actual news evidence metadata survives assembler and frozen canonical refs exactly; market sources gain no URL', () => {
  const input = fixture(), result = assemble(input);
  assert.equal(result.cms.status, 'READY', JSON.stringify(result.cms.reason_codes));
  assert.equal(result.document.quality.evidence_coverage, 100);
  assert.equal(evaluateMarketReportGate(result.ai, input.reportDate).eligible, true);
  for (const id of ['NEWS001', 'NEWS002', 'NEWS003']) {
    const evidence = input.evidenceIndex.find(row => row.evidence_id === id);
    const expected = { title: evidence.title, url: evidence.url, published_at: evidence.published_at };
    const sources = result.document.quality.coverage_audit.claims.flatMap(claim => claim.sources).filter(source => source.evidence_id === id);
    assert.ok(sources.length > 0, `${id} must actually be consumed by a claim`);
    for (const source of sources) assert.deepEqual(metadata(source), expected);
    assert.deepEqual(metadata(result.refs.find(source => source.evidence_id === id)), expected);
  }
  for (const source of result.refs.filter(row => !row.evidence_id.startsWith('NEWS'))) assert.deepEqual(metadata(source), {});
  assertGateInvariant(input, result);
});

for (const [name, mutate] of [
  ['legacy raw_reference HTTPS URL', source => { delete source.url; }],
  ['timestamp with original timezone and fractional seconds', source => { source.published_at = '2026-07-14T06:00:00.000+08:00'; }],
]) test(`existing complete public metadata is preserved without synthesis: ${name}`, () => {
  const input = fixture(), source = input.evidenceIndex.find(row => row.evidence_id === 'NEWS001'); mutate(source);
  const result = assemble(input);
  assert.deepEqual(metadata(result.refs.find(row => row.evidence_id === source.evidence_id)), {
    title: source.title, url: source.url ?? source.raw_reference, published_at: source.published_at,
  });
  assertGateInvariant(input, result);
});

for (const [name, mutate] of [
  ['missing URL', source => { delete source.url; source.raw_reference = 'NEWS001'; }],
  ['missing title', source => { delete source.title; }],
  ['blank title', source => { source.title = ' '; }],
  ['missing timestamp', source => { source.data_as_of = source.published_at; delete source.published_at; }],
  ['invalid timestamp', source => { source.published_at = 'not-a-date'; }],
  ['impossible calendar date', source => { source.published_at = '2026-02-30T22:00:00Z'; }],
  ['HTTP URL', source => { source.url = 'http://fixture.example.invalid/article'; }],
  ['userinfo credentials', source => { source.url = 'https://synthetic-user:synthetic-secret@fixture.example.invalid/article'; }],
  ['encoded userinfo credentials', source => { source.url = 'https://user:%73ecret@fixture.example.invalid/article'; }],
  ['auth query', source => { source.url = 'https://fixture.example.invalid/article?access_token=synthetic-secret'; }],
  ['encoded query name', source => { source.url = 'https://fixture.example.invalid/article?%61pi_key=synthetic-secret'; }],
  ['unknown query name', source => { source.url = 'https://fixture.example.invalid/article?custom=synthetic-secret'; }],
  ['ordinary query explicitly unsupported', source => { source.url = 'https://fixture.example.invalid/article?utm_source=news'; }],
  ['fragment', source => { source.url = 'https://fixture.example.invalid/article#token=synthetic-secret'; }],
  ['empty query marker', source => { source.url = 'https://fixture.example.invalid/article?'; }],
  ['empty fragment marker', source => { source.url = 'https://fixture.example.invalid/article#'; }],
  ['control character', source => { source.url = 'https://fixture.example.invalid/arti\ncle'; }],
]) test(`unsafe/incomplete metadata is omitted, not repaired or used as a gate: ${name}`, () => {
  const input = fixture(), source = input.evidenceIndex.find(row => row.evidence_id === 'NEWS001'); mutate(source);
  const result = assemble(input);
  const sources = result.document.quality.coverage_audit.claims.flatMap(claim => claim.sources).filter(row => row.evidence_id === source.evidence_id);
  assert.ok(sources.length > 0);
  for (const row of sources) {
    assert.deepEqual(metadata(row), {});
    assert.deepEqual(tuple(row), { evidence_id: source.evidence_id, source: source.source,
      source_date: source.published_at || source.data_as_of || null, freshness: source.freshness });
  }
  for (const row of result.refs.filter(row => row.evidence_id === source.evidence_id)) assert.deepEqual(metadata(row), {});
  assertGateInvariant(input, result);
});

test('canonical refs reapply the same metadata allowlist and never spread private source fields', () => {
  const input = fixture(), result = assemble(input), rows = result.document.quality.coverage_audit.claims.flatMap(claim => claim.sources);
  for (const row of rows) if (row.evidence_id === 'NEWS001') Object.assign(row, {
    url: 'https://fixture.example.invalid/article?authorization=synthetic-secret', authorization: 'synthetic-private-value',
    premium_reasoning: 'synthetic-private-reasoning', raw_reference: 'synthetic-private-reference',
  });
  const refs = canonicalMarketSourceRefs(result.ai);
  assert.deepEqual(refs.map(tuple), result.refs.map(tuple));
  assert.deepEqual(metadata(refs.find(row => row.evidence_id === 'NEWS001')), {});
  assert.doesNotMatch(JSON.stringify(refs), /synthetic-private|synthetic-secret|authorization|premium_reasoning|raw_reference/);
  assertGateInvariant(input, { ...result, refs });
});
