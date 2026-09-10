// Regression for the real 2026-09-23 local producer input, not a new E2E claim.
// The exact evidence index has 17 rows (11 MD + 3 NEWS + 3 SEC), not 18.
// Original readback SHA bf0dc4a13973abcb207c205bf52e6fdfb761b8261283e62af854808cae7c193b.
// No dependency on /private/tmp, database writes or current mutable report rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { declaration, isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleResearchMasterV2, assembleCanonicalMarketResearch, validateResearchMasterV2 } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs, publicResearchSourceMetadata } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const completeFixture = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const sentence = '合成情境：SOX 與 TSM 隔夜約漲 1%、台指期夜盤約漲 1%；09:30 若期現貨未同向站穩開盤區間，先不追價並停止延伸偏多假設。';
const generatedAt = '2026-09-22T23:00:06.603Z';

function actualEvidenceIndex() {
  const market = [
    ['TAIEX', 100, 'UP 1.00% 台股現貨大盤方向', '05:30'],
    ['2330', 100, 'UP 1.00% 台股最大權值與半導體核心驗證股', '05:30'],
    ['SOX', 98, 'UP 1.00% 半導體族群對台股電子權值影響', '20:00'],
    ['TSM', 96, 'UP 1.00% 台積電 ADR 對 2330 與台股電子開盤情緒影響', '20:00'],
    ['TXF', 95, 'UP 1.00% 台指期與盤前/盤中風險方向', '21:00'],
    ['NVDA', 94, 'UP 1.00% AI server 與半導體供應鏈風向', '20:00'],
    ['NASDAQ', 90, 'UP 1.00% 科技股風險偏好', '20:00'],
    ['VIX', 88, 'DOWN -1.00% 市場風險溫度', '20:00'],
    ['SPX', 82, 'UP 1.00% 美股大盤風險偏好', '20:00'],
    ['US10Y', 78, 'FLAT -0.10% 美債殖利率與估值壓力', '20:00'],
    ['DXY', 75, 'FLAT 0.10% 美元強弱與外資資金壓力', '20:00'],
  ].map(([title, importance, summary, time], index) => {
    const published_at = `2026-09-22T${time}:00+00:00`;
    return { evidence_id: `MD${String(index + 1).padStart(3, '0')}`, evidence_type: 'market_data',
      title, source: 'market_data', summary: `${title} ${summary}`, importance, freshness: 'fresh',
      published_at, raw_reference: `market_data:${title}@${published_at}`, quality_status: 'verified' };
  });
  const news = [
    [94, 'inflation-risk-monitor', 'Synthetic scenario: CPI inflation cools as FOMC rate decision supports a broad market rally'],
    [88, 'fed-policy-transmission', 'Synthetic scenario: Federal Reserve rate cut follows FOMC meeting as bond yields ease'],
    [62, 'oil-supply-risk', 'Synthetic scenario: Crude oil and Brent remain contained as OPEC addresses supply shortage risk'],
  ].map(([importance, path, summary], index) => {
    const url = `https://fixture.example.invalid/synthetic-news-20260923/${path}`;
    return { evidence_id: `NEWS00${index + 1}`, evidence_type: 'market_news', title: '台股',
      source: 'Synthetic market provider', summary, importance, freshness: 'fresh',
      published_at: '2026-09-22T22:30:00+00:00', raw_reference: url, url, quality_status: 'verified' };
  });
  const sectors = [['大盤', 56.1], ['電子權值', 53.4], ['半導體', 49.8]].map(([title, importance], index) => ({
    evidence_id: `SEC00${index + 1}`, evidence_type: 'sector_rotation', title, source: 'sector_rotation_scores',
    summary: '轉強', importance, freshness: 'previous_trading_day', published_at: '2026-09-22',
    raw_reference: `sector_rotation_scores:${title}@2026-09-22`, quality_status: 'context',
  }));
  return [...market, ...news, ...sectors];
}

function fixture() {
  // Surrounding unit scenario uses the established assembler fixture. Every
  // evidence-index field/rank is the exact observed 17-row producer wire above.
  const input = clone(completeFixture());
  Object.assign(input, { reportDate: '2026-09-23', todayDate: '2026-09-23', generatedAt,
    dataAsOf: '2026-09-22T21:00:00.000Z', marketThesis: null, evidenceIndex: actualEvidenceIndex() });
  Object.assign(input.legacy, { generated_at: generatedAt, today_quote: sentence,
    today_beneficiary_stocks_v10: [], v10_beneficiary_enabled: true,
    v10_data_quality_status: 'insufficient_positive_evidence', data_quality: 'complete', missing_sources: [],
    content_evidence_quality: { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 11,
      verified_news_count: 3, blank_market_change_count: 0, all_news_traceable: true } });
  input.legacy.member_research_note_v2.today_core_thesis = sentence;
  delete input.legacy.member_research_note_v2.opening_thesis;
  return input;
}
function assembled(input) {
  const document = assembleCanonicalMarketResearch(input), cms = buildCanonicalMarketState(document);
  const ai = { ...input.legacy, canonical_market_state: cms };
  return { document, cms, refs: canonicalMarketSourceRefs(ai), gate: evaluateMarketReportGate(ai, input.reportDate) };
}
const ownFact = (document, id) => document.sections.supporting_evidence.find(row => row.evidence_refs.includes(id));

test('the complete observed evidence index is preserved, including real types, metadata and ranking', () => {
  const input = actualEvidenceIndex();
  assert.equal(input.length, 17);
  assert.equal(hash(input), '9964e58e44ad36341eda98f0166ad4bd53779d70e1fdf7aa2c20df6e7b874f5d');
  assert.deepEqual([...input].sort((a, b) => b.importance - a.importance).slice(0, 5).map(row => row.evidence_id),
    ['MD001', 'MD002', 'MD003', 'MD004', 'MD005']);
});

test('canonical market audit retains each real NEWS fact beyond presentation top five with exact provenance', () => {
  const input = fixture(), before = clone(input), result = assembled(input);
  assert.equal(result.cms.status, 'READY', JSON.stringify(result.cms.reason_codes));
  assert.equal(result.gate.eligible, true, JSON.stringify(result.gate));
  assert.equal(result.document.quality.evidence_coverage, 100);
  assert.equal(result.gate.recommendation_gate.eligible, false);
  assert.deepEqual(input, before, 'never mutate the original input, rankings or private research');
  for (const source of input.evidenceIndex.filter(row => row.evidence_type === 'market_news')) {
    const claim = ownFact(result.document, source.evidence_id);
    assert.ok(claim, source.evidence_id);
    assert.equal(claim.statement, `${source.title}：${source.summary}`);
    assert.deepEqual(claim.evidence_refs, [source.evidence_id], 'generic 台股 title must not attach other IDs');
    const audit = result.document.quality.coverage_audit.claims.find(row => row.claim_id === claim.claim_id);
    assert.equal(audit.scope, 'market'); assert.equal(audit.supported, true);
    assert.deepEqual(audit.evidence_ids, [source.evidence_id]);
    assert.deepEqual(audit.sources, [{ evidence_id: source.evidence_id, source: source.source,
      source_date: source.published_at, freshness: source.freshness,
      title: source.title, url: source.url, published_at: source.published_at }]);
    assert.deepEqual(result.refs.find(row => row.evidence_id === source.evidence_id), audit.sources[0]);
  }
  assert.equal(result.refs.filter(row => publicResearchSourceMetadata(row)).length, 3);
});

for (const [name, mutate] of [
  ['stale', row => { row.freshness = 'stale'; }],
  ['expired', row => { row.freshness = 'expired'; }],
  ['unknown freshness', row => { row.freshness = 'unknown'; }],
  ['missing freshness', row => { delete row.freshness; }],
  ['future timestamp', row => { row.published_at = '2026-09-22T23:00:07+00:00'; }],
  ['missing timestamp', row => { delete row.published_at; }],
  ['invalid timestamp', row => { row.published_at = 'not-a-time'; }],
  ['missing source', row => { delete row.source; }],
  ['missing title', row => { delete row.title; }],
  ['missing summary', row => { delete row.summary; }],
  ['missing URL', row => { delete row.url; row.raw_reference = 'NEWS001'; }],
  ['credential-bearing URL', row => { row.url += '?access_token=synthetic'; }],
  ['unverified source', row => { row.quality_status = 'context'; }],
  ['missing verified classification', row => { delete row.quality_status; }],
  ['unknown type', row => { row.evidence_type = 'unknown'; }],
  ['validation type', row => { row.evidence_type = 'validation'; }],
  ['conditional criterion', row => { row.condition = 'If the future opening confirms the hypothesis'; }],
]) test(`canonical supplement must not turn ${name} into a factual NEWS claim`, () => {
  const input = fixture();
  for (const row of input.evidenceIndex.filter(row => row.evidence_type === 'market_news')) mutate(row);
  const result = assembled(input);
  for (const id of ['NEWS001', 'NEWS002', 'NEWS003']) {
    assert.equal(ownFact(result.document, id), undefined);
    assert.equal(result.refs.find(row => row.evidence_id === id), undefined);
  }
  assert.equal(result.refs.filter(row => publicResearchSourceMetadata(row)).length, 0);
});

test('a duplicated evidence ID cannot bind a different source as a new factual claim', () => {
  const input = fixture(); input.evidenceIndex.push({ ...input.evidenceIndex.find(row => row.evidence_id === 'NEWS001'), source: 'Other source' });
  const result = assembled(input);
  assert.equal(ownFact(result.document, 'NEWS001'), undefined);
});

test('only MD remains a valid market publication without manufactured HTTPS citations', () => {
  const input = fixture(); input.evidenceIndex = input.evidenceIndex.filter(row => row.evidence_type === 'market_data');
  input.legacy.content_evidence_quality.verified_news_count = 0;
  const result = assembled(input);
  assert.equal(result.cms.status, 'READY'); assert.equal(result.gate.eligible, true);
  assert.equal(result.refs.filter(row => publicResearchSourceMetadata(row)).length, 0);
  assert.ok(result.refs.every(row => row.source === 'market_data' && !Object.hasOwn(row, 'url')));
});

test('private research output, quality and legacy top-five selection stay byte-identical', () => {
  const original = completeFixture(), master = assembleResearchMasterV2(original);
  assert.equal(hash(master), '8e5b11cb17a7ce321d63c61af7ab4d5762097445e134b4199fbaa84309435c7a');
  assert.equal(hash(validateResearchMasterV2(master, original).quality), '47b06ed9cb271cf75a185f19aaa856a5437b4f7da4d47ba91d6ec456b508a620');
  const input = fixture(), before = clone(assembleResearchMasterV2(input));
  assembled(input);
  assert.deepEqual(clone(assembleResearchMasterV2(input)), before);
  assert.deepEqual(before.sections.why_today_matters.evidence_refs, ['MD001', 'MD002', 'MD003', 'MD004', 'MD005']);
});

test('private assembler, admission, claim/quality validator and top-five helper bodies are unchanged', () => {
  const source = read('supabase/functions/generate-daily-report-v7/research-master-v2.ts');
  for (const [name, expected] of Object.entries({
    assembleResearchMasterV2: 'bdbee974d6c15d7dac47da770bbe753f6e52189b904486db1877777e1c2c0141',
    canonicalNoTradeEvidence: '13abdd054a7447dab2d694978a25b524f5b5939a5495e61659c61879ac301e4a',
    buildTransmissionPath: 'c565b59ebab4bd822329413e813d4a40f75b8677420b80409e5543fe0e05b117',
    buildSupportingEvidence: '1b67f6b623711d61e3d87eae218442a5cb9dc547f0633efb83a0e8d02ec9264d',
    buildClaimEvidenceLedger: '62ead3a88ad17b6786832e493cd362fb32c2ced770bb90913b7f725d12272190',
    validateResearchMasterV2: '7b3718fd3cad4e78e79d35c3da911bb4a70a40373620db7cd1bee53cd853fa0b',
    admitResearchRecommendations: '84c3321317ab4e3dcf6167740e70111c02711a1219b03368844eb78969e1baba',
  })) assert.equal(hash(declaration(source, name)), expected, name);
});
