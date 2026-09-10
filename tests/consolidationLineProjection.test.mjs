// Synthetic in-memory publication rows through the actual shared reader,
// subscriber projection, LINE builder and unchanged Flex renderer. Not DB E2E.
// No SDK, SQL, outbound LINE, outbox, network, provider or Production calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePublishedMarketDelivery, fetchPublishedDeliveryEvidence } from '../supabase/functions/_shared/market-publication-contract.ts';
import { buildLineDailyFlexMessage } from '../supabase/functions/_shared/line-daily-flex-message.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const lineSource = read('supabase/functions/line-daily-push/index.ts');
const buildLineMessage = isolatedFunction(lineSource, 'buildLineMessage', { buildLineDailyFlexMessage });
const PRIVATE = 'SYNTHETIC_PRIVATE_STOCK_8999';
const PRIVATE_COPY = 'UNREVIEWED_STOCK_COPY_987654';
const NOW = '2026-09-09T04:00:00.000Z';

function fixture({ core = true } = {}) {
  const input = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture')();
  const ai = input.legacy;
  const sentence = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  Object.assign(ai, { today_quote: sentence, v8_daily_sentence: { sentence }, free_summary: { one_sentence: sentence },
    today_beneficiary_stocks: [], today_beneficiary_stocks_v10: [], v10_beneficiary_enabled: true,
    v10_data_quality_status: 'insufficient_positive_evidence', data_quality: 'complete', missing_sources: [],
    member_value_score: 0, is_trading_day: true, market_status: 'OPEN', report_mode: input.reportMode,
    content_evidence_quality: { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 3,
      verified_news_count: 1, blank_market_change_count: 0, all_news_traceable: true } });
  ai.member_research_note_v2.today_core_thesis = sentence;
  ai.canonical_market_state = buildCanonicalMarketState(assembleCanonicalMarketResearch(input));
  ai.research_master_v2 = ai.canonical_market_state.document;
  const gate = evaluateMarketReportGate(ai, input.reportDate);
  assert.equal(gate.eligible, true, JSON.stringify(gate));
  assert.equal(gate.recommendation_gate.status, 'BLOCKED');
  const report = { id: 'synthetic-line-report', report_date: input.reportDate, ai_strategy_json: ai };
  const snapshot = { id: 'synthetic-line-committed', report_id: report.id, report_date: report.report_date,
    version: 4, session_type: 'INTRADAY', is_current: false, status: 'READY', decision_mode: 'recommendations',
    action: 'ACT', market_regime: '中性觀察', confidence_score: 64, content_score: gate.content_score, coverage_score: 100,
    valid_from: input.generatedAt, source_freshness: { status: 'complete' }, source_refs: canonicalMarketSourceRefs(ai),
    generated_text: { generated_at: input.generatedAt, daily_sentence: PRIVATE_COPY, market_bias: '中性觀察',
      recommendations: [{ symbol: PRIVATE, name: PRIVATE, opportunity_score: 987654, reason: PRIVATE_COPY }],
      next_checkpoint: PRIVATE_COPY, canonical_market_state: structuredClone(ai.canonical_market_state),
      content_evidence_quality: structuredClone(ai.content_evidence_quality), data_quality: ai.data_quality,
      missing_sources: structuredClone(ai.missing_sources) } };
  const member = { id: 'synthetic-line-member', report_id: report.id, report_date: report.report_date,
    decision_snapshot_id: snapshot.id, decision_snapshot_version: snapshot.version,
    status: 'PASSED', semantic_status: 'PASSED', semantic_reason_codes: [],
    semantic_coherence_reviews: [{ status: 'PASSED', reason_codes: [], canonical_snapshot_id: snapshot.id,
      canonical_snapshot_version: snapshot.version, checked_at: input.generatedAt }] };
  const publicationRun = { id: 'synthetic-line-receipt', trading_date: report.report_date, status: 'SUCCEEDED',
    idempotency_key: 'research-input:synthetic-line', completed_at: report.report_date + 'T00:02:00.000Z',
    provider_status: { result: { success: true, report_id: report.id, report_date: report.report_date,
      decision_snapshot_id: snapshot.id, member_content_revision_id: member.id, semantic_status: 'PASSED' } } };
  Object.assign(ai, { revision_id: snapshot.id, canonical_member_revision_id: member.id, market_report_gate: gate });
  if (core) ai.market_publication_contract = { schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED',
    report_date: report.report_date, revision_id: snapshot.id, opening_publication_revision_id: snapshot.id,
    publication_run_id: publicationRun.id };
  return { report, snapshot, member, publicationRun, gate };
}

function database(f, trace = [], errors = {}) {
  const tables = { decision_snapshots: f.snapshot ? [f.snapshot, { ...f.snapshot, id: 'synthetic-new-private-QA',
      version: 99, status: 'PARTIAL', is_current: true }] : [],
    member_content_revisions: f.member ? [f.member] : [], pipeline_runs: f.publicationRun ? [f.publicationRun] : [] };
  const field = (row, key) => key.split(/->>?/).reduce((value, part) => value?.[part], row);
  return { from(table) {
    assert.ok(Object.hasOwn(tables, table), 'Unexpected publication table: ' + table);
    const filters = [], query = { select() { return query; }, order() { return query; }, limit() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      like(key, value) { filters.push([key, value, 'like']); return query; },
      async maybeSingle() {
        trace.push({ table, filters });
        return { error: errors[table] ? { message: errors[table] } : null,
          data: tables[table].find(row => filters.every(([key, value, mode]) => mode === 'like'
            ? String(field(row, key)).startsWith(value.replace(/%$/, '')) : field(row, key) === value)) || null };
      } };
    return query;
  } };
}

async function delivery(f, options = {}, trace = []) {
  const persisted = await fetchPublishedDeliveryEvidence(database(f, trace), f.report);
  return evaluatePublishedMarketDelivery(f.report, persisted.snapshot, persisted.member,
    evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date),
    { now: NOW, todayDate: f.report.report_date, publicationRun: persisted.publicationRun, ...options });
}
function assertMarketOnly(result) {
  assert.equal(result.eligible, true, JSON.stringify(result.reason_codes));
  assert.equal(result.projection.recommendation.available, false);
  assert.deepEqual(result.projection.recommendation.items, []);
  const rendered = JSON.stringify(buildLineMessage(result, 'https://example.invalid'));
  assert.match(rendered, /推薦評估證據不足，今日暫不發布正式個股推薦/);
  assert.match(rendered, /完整市場證據與盤中驗證/);
  assert.doesNotMatch(rendered, /SYNTHETIC_PRIVATE_STOCK|UNREVIEWED_STOCK_COPY|987654|5 檔排序|無強受惠股|待驗證\/100/);
  return rendered;
}

for (const core of [false, true]) test((core ? 'CORE' : 'legacy') + ': committed recommendations + blocked current stocks delivers only audited market projection', async () => {
  const f = fixture({ core }), ai = f.report.ai_strategy_json;
  ai.line_push_copy = { opportunity: PRIVATE_COPY, risk: PRIVATE_COPY, do_not_do: PRIVATE_COPY };
  ai.today_beneficiary_stocks = [{ symbol: PRIVATE }];
  ai.today_beneficiary_stocks_v10 = [{ symbol: PRIVATE }];
  // CORE separates failed current private copy from frozen proof; legacy keeps
  // its current market editorial prerequisites. Both run the actual evaluator.
  if (core) { ai.today_quote = PRIVATE_COPY; ai.v8_daily_sentence = { sentence: PRIVATE_COPY }; }
  const before = JSON.stringify(f), result = await delivery(f);
  assertMarketOnly(result);
  assert.equal(JSON.stringify(f), before, 'Projection never mutates persisted mode/action/identity/confidence or research');
  assert.equal(f.snapshot.decision_mode, 'recommendations');
  assert.equal(result.projection.marketDecision.summary,
    f.snapshot.generated_text.canonical_market_state.document.sections.executive_summary.text);
});

test('CORE frozen proof survives failed current market/member/stock QA and never borrows current copy', async () => {
  const f = fixture(), ai = f.report.ai_strategy_json;
  ai.canonical_market_state = { status: 'INSUFFICIENT_EVIDENCE' };
  ai.content_evidence_quality = { verified_market_count: 0, verified_news_count: 0 };
  ai.member_research_note_v2 = {}; ai.line_push_copy = { opportunity: PRIVATE_COPY };
  ai.today_beneficiary_stocks_v10 = [{ symbol: PRIVATE }];
  f.member.status = 'BLOCKED'; f.member.semantic_coherence_reviews[0].status = 'BLOCKED';
  assert.equal(evaluateMarketReportGate(ai, f.report.report_date).eligible, false);
  const before = JSON.stringify(f), result = await delivery(f);
  assertMarketOnly(result); assert.deepEqual(result.reason_codes, []);
  assert.equal(JSON.stringify(f), before);
});

test('explicit empty committed recommendations never revive qualified raw aliases', () => {
  const f = fixture(); f.snapshot.generated_text.recommendations = [];
  f.report.ai_strategy_json.today_beneficiary_stocks_v10 = [{ symbol: PRIVATE, name: PRIVATE }];
  const gate = { ...f.gate, recommendation_gate: { ...f.gate.recommendation_gate, status: 'QUALIFIED', eligible: true } };
  const result = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate,
    { now: NOW, todayDate: f.report.report_date, publicationRun: f.publicationRun, premiumEligible: true });
  assert.equal(result.eligible, true); assert.deepEqual(result.projection.recommendation.items, []);
  assert.doesNotMatch(JSON.stringify(buildLineMessage(result, 'https://example.invalid')), /SYNTHETIC_PRIVATE_STOCK|987654|UNREVIEWED_STOCK_COPY/);
});

test('Premium unavailable suppresses a qualified recommendation projection without revoking market receipt', () => {
  const f = fixture(), gate = { ...f.gate, recommendation_gate: { ...f.gate.recommendation_gate, status: 'QUALIFIED', eligible: true } };
  const result = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate,
    { now: NOW, todayDate: f.report.report_date, publicationRun: f.publicationRun, premiumEligible: false });
  assertMarketOnly(result);
});

for (const mode of ['market_only', 'no_trade']) test('current stock QA cannot promote committed ' + mode + ' to recommendations', () => {
  const f = fixture(); f.snapshot.decision_mode = mode; f.snapshot.generated_text.recommendations = [];
  f.report.ai_strategy_json.today_beneficiary_stocks_v10 = [{ symbol: PRIVATE }];
  const gate = { ...f.gate, recommendation_gate: { ...f.gate.recommendation_gate, status: 'QUALIFIED', eligible: true } };
  const result = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate,
    { now: NOW, todayDate: f.report.report_date, publicationRun: f.publicationRun, premiumEligible: true });
  assertMarketOnly(result); assert.equal(f.snapshot.decision_mode, mode);
});

test('qualification of different current symbols does not expose frozen unadmitted recommendations', () => {
  const f = fixture(); f.report.ai_strategy_json.today_beneficiary_stocks_v10 = [{ symbol: 'OTHER_CURRENT_COMPANY' }];
  const gate = { ...f.gate, recommendation_gate: { ...f.gate.recommendation_gate, status: 'QUALIFIED', eligible: true } };
  const result = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate,
    { now: NOW, todayDate: f.report.report_date, publicationRun: f.publicationRun, premiumEligible: true });
  assertMarketOnly(result);
});

test('same-symbol qualified committed recommendations remain available through the actual formatter', () => {
  const f = fixture(); f.report.ai_strategy_json.today_beneficiary_stocks_v10 = [{ symbol: PRIVATE }];
  const gate = { ...f.gate, recommendation_gate: { ...f.gate.recommendation_gate, status: 'QUALIFIED', eligible: true } };
  const result = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate,
    { now: NOW, todayDate: f.report.report_date, publicationRun: f.publicationRun, premiumEligible: true });
  assert.equal(result.eligible, true); assert.equal(result.projection.recommendation.available, true);
  assert.equal(result.projection.recommendation.items[0].symbol, PRIVATE);
  assert.match(JSON.stringify(buildLineMessage(result, 'https://example.invalid')), /SYNTHETIC_PRIVATE_STOCK_8999/);
});

test('actual reader pins report/snapshot/member/run identities and ignores newer private QA', async () => {
  const f = fixture(), trace = []; assertMarketOnly(await delivery(f, {}, trace));
  const receipt = trace.find(row => row.table === 'pipeline_runs');
  for (const [key, value] of [['id', f.publicationRun.id], ['provider_status->result->>report_id', f.report.id],
    ['provider_status->result->>report_date', f.report.report_date], ['provider_status->result->>decision_snapshot_id', f.snapshot.id],
    ['provider_status->result->>member_content_revision_id', f.member.id]]) {
    assert.ok(receipt.filters.some(([k, v]) => k === key && v === value), 'Missing exact receipt filter: ' + key);
  }
  assert.ok(trace.find(row => row.table === 'decision_snapshots').filters.some(([k, v]) => k === 'id' && v === f.snapshot.id));
});

const negatives = [
  ['missing committed market direction', f => { delete f.snapshot.market_regime; delete f.snapshot.generated_text.market_bias; }],
  ['mismatched audited summary date', f => { f.snapshot.generated_text.canonical_market_state.document.sections.executive_summary.text = '2026-01-01，市場摘要日期不符'; }],
  ['missing actual run', f => { f.publicationRun = null; }],
  ['failed run', f => { f.publicationRun.status = 'FAILED'; }],
  ['wrong run identity', f => { f.publicationRun.id = 'different'; }],
  ['wrong receipt member', f => { f.publicationRun.provider_status.result.member_content_revision_id = 'different'; }],
  ['failed committed semantic', f => { f.publicationRun.provider_status.result.semantic_status = 'BLOCKED'; }],
  ['future run', f => { f.publicationRun.completed_at = '2099-01-01T00:00:00Z'; }],
  ['run before snapshot', f => { f.publicationRun.completed_at = f.report.report_date + 'T00:00:00Z'; }],
  ['present null CORE does not fall back', f => { f.report.ai_strategy_json.market_publication_contract = null; }],
  ['invalid CORE schema does not fall back', f => { f.report.ai_strategy_json.market_publication_contract.schema_version = 'PRIVATE'; }],
  ['absent market pointer', f => { delete f.report.ai_strategy_json.revision_id; }],
  ['absent member pointer', f => { delete f.report.ai_strategy_json.canonical_member_revision_id; }],
  ['blank market pointer', f => { f.report.ai_strategy_json.revision_id = ' '; }],
  ['mismatched member snapshot', f => { f.member.decision_snapshot_id = 'different'; }],
  ['partial snapshot', f => { f.snapshot.status = 'PARTIAL'; }],
  ['editorial below 90', f => { f.snapshot.content_score = 89; }],
  ['editorial above 100', f => { f.snapshot.content_score = 101; }],
  ['snapshot evidence below 100', f => { f.snapshot.coverage_score = 76; }],
  ['snapshot sources incomplete', f => { f.snapshot.source_freshness.status = 'partial'; }],
  ['absent frozen CMS', f => { delete f.snapshot.generated_text.canonical_market_state; }],
  ['invalid frozen CMS cannot borrow current valid document', f => { f.snapshot.generated_text.canonical_market_state.status = 'INSUFFICIENT_EVIDENCE'; }],
  ['unsupported frozen market claim', f => { f.snapshot.generated_text.canonical_market_state.document.quality.coverage_audit.claims[0].supported = false; }],
  ['wrong frozen ledger source', f => { f.snapshot.source_refs[0].source = 'unbound-source'; }],
];
for (const [name, mutate] of negatives) test('CORE refuses ' + name, async () => {
  assertMarketOnly(await delivery(fixture()));
  const f = fixture(); mutate(f); const result = await delivery(f);
  assert.equal(result.eligible, false, name);
  assert.throws(() => buildLineMessage(result, 'https://example.invalid'), /MARKET_DELIVERY_PROJECTION_UNAVAILABLE/);
});

for (const mode of ['recommendations', 'market_only', 'no_trade']) test('legacy ' + mode + ' never allows absent publication pointers', async () => {
  for (const pointer of ['revision_id', 'canonical_member_revision_id']) {
    const f = fixture({ core: false }); f.snapshot.decision_mode = mode; delete f.report.ai_strategy_json[pointer];
    assert.equal((await delivery(f)).eligible, false);
  }
});

test('legacy retains committed member/semantic PASSED and strict editorial proof', async () => {
  for (const mutate of [f => { f.member.status = 'BLOCKED'; }, f => { f.member.semantic_coherence_reviews[0].status = 'BLOCKED'; },
    f => { f.member.semantic_coherence_reviews[0].reason_codes = ['unreviewed']; }, f => { f.snapshot.content_score = 89; }]) {
    assertMarketOnly(await delivery(fixture({ core: false })));
    const f = fixture({ core: false }); mutate(f); assert.equal((await delivery(f)).eligible, false);
  }
});

test('historical publication cannot be relabeled as today for LINE', async () => {
  const f = fixture(), result = await delivery(f, { todayDate: '2026-09-09' });
  assert.equal(result.eligible, false); assert.equal(result.projection.historical, true);
  assert.equal(result.projection.identity.reportDate, f.report.report_date);
});

test('receipt query failures fail closed without notification or fallback', async () => {
  const f = fixture();
  await assert.rejects(fetchPublishedDeliveryEvidence(database(f, [], { pipeline_runs: 'synthetic failure' }), f.report),
    /PUBLICATION_RECEIPT_QUERY_FAILED:synthetic failure/);
});
