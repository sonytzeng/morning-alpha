// Actual consumer declarations + shared validators; synthetic in-memory rows.
// No SDK, SQL, provider, outbox, notifications or Production requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';
import { evaluatePublishedMarketDelivery, fetchPublishedDeliveryEvidence } from '../supabase/functions/_shared/market-publication-contract.ts';
import { buildDailyDeliveryRecoveryPlan, resolveDailyDeliveryCompletion } from '../supabase/functions/_shared/daily-delivery-recovery.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const orchestratorSource = read('supabase/functions/daily-delivery-orchestrator/index.ts');
const healthSource = read('supabase/functions/ma-ops-health-check/index.ts');
const asRecord = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asArray = value => Array.isArray(value) ? value : [];
const nonEmptyString = value => typeof value === 'string' && Boolean(value.trim());

function fixture() {
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
  const report = { id: 'synthetic-consumer-report', report_date: input.reportDate, report_mode: input.reportMode,
    market_bias: '中性觀察', confidence_score: 64, today_quote: sentence, created_at: input.generatedAt, ai_strategy_json: ai };
  const snapshot = { id: 'synthetic-published-opening', report_id: report.id, report_date: report.report_date,
    version: 1, session_type: 'PREMARKET', is_current: false, status: 'READY', decision_mode: 'market_only',
    action: 'WAIT', market_regime: '中性觀察', confidence_score: 64, content_score: gate.content_score, coverage_score: 100,
    valid_from: input.generatedAt, source_freshness: { status: 'complete' }, source_refs: canonicalMarketSourceRefs(ai),
    generated_text: { generated_at: input.generatedAt, daily_sentence: sentence, market_bias: '中性觀察',
      recommendations: [], market_report_gate: structuredClone(gate), canonical_market_state: structuredClone(ai.canonical_market_state),
      content_evidence_quality: structuredClone(ai.content_evidence_quality), data_quality: ai.data_quality,
      missing_sources: structuredClone(ai.missing_sources) } };
  const canonicalContract = { snapshot_id: snapshot.id, snapshot_version: snapshot.version, report_date: report.report_date,
    action: 'WAIT', decision_mode: 'market_only', primary_symbols: [], market_report_gate: structuredClone(gate) };
  const member = { id: 'synthetic-published-member', report_id: report.id, report_date: report.report_date,
    decision_snapshot_id: snapshot.id, decision_snapshot_version: snapshot.version, status: 'PASSED', semantic_status: 'PASSED',
    semantic_reason_codes: [], canonical_contract: canonicalContract,
    member_content: { canonical_contract: structuredClone(canonicalContract), beneficiary_candidates: [], representative_stocks: [] },
    semantic_coherence_reviews: [{ status: 'PASSED', reason_codes: [], canonical_snapshot_id: snapshot.id,
      canonical_snapshot_version: snapshot.version, checked_at: input.generatedAt }] };
  const publicationRun = { id: 'synthetic-publication-run', trading_date: report.report_date, status: 'SUCCEEDED',
    idempotency_key: 'research-input:synthetic-consumer', completed_at: `${report.report_date}T00:02:00.000Z`,
    provider_status: { result: { success: true, report_id: report.id, report_date: report.report_date,
      decision_snapshot_id: snapshot.id, member_content_revision_id: member.id, semantic_status: 'PASSED' } } };
  Object.assign(ai, { revision_id: snapshot.id, canonical_member_revision_id: member.id, market_report_gate: gate,
    market_publication_contract: { schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED',
      report_date: report.report_date, revision_id: snapshot.id, opening_publication_revision_id: snapshot.id,
      publication_run_id: publicationRun.id } });
  return { report, snapshot, member, publicationRun };
}

function database(f, trace = [], errors = {}) {
  const tables = { reports: f.report ? [f.report] : [],
    decision_snapshots: f.snapshot ? [f.snapshot, { ...f.snapshot, id: 'synthetic-newer-private-qa', version: 99,
      is_current: true, status: 'PARTIAL', content_score: 20 }] : [],
    member_content_revisions: f.member ? [f.member] : [], pipeline_runs: f.publicationRun ? [f.publicationRun] : [] };
  const field = (row, key) => key.split(/->>?/).reduce((value, part) => value?.[part], row);
  return { from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected consumer table: ${table}`);
    const filters = [];
    const query = { select() { return query; }, order() { return query; }, limit() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      like(key, value) { filters.push([key, value, 'like']); return query; },
      async maybeSingle() {
        trace.push({ table, filters });
        if (errors[table]) return { data: null, error: { message: errors[table] } };
        return { error: null, data: tables[table].find(row => filters.every(([key, value, mode]) =>
          mode === 'like' ? String(field(row, key)).startsWith(value.replace(/%$/, '')) : field(row, key) === value)) || null };
      } };
    return query;
  } };
}

function consumers(trace = []) {
  const central = (...args) => { trace.push(args); return evaluatePublishedMarketDelivery(...args); };
  const dependencies = { asRecord, asObject: asRecord, asArray, nonEmptyString, Date,
    evaluatePremiumContentGate, evaluateMarketReportGate, evaluatePublishedMarketDelivery: central,
    fetchPublishedDeliveryEvidence, withTimeout: promise => promise };
  const load = isolatedFunction(orchestratorSource, 'loadDeliveryState', dependencies);
  const makeCheck = isolatedFunction(healthSource, 'makeCheck');
  const fetchReport = isolatedFunction(healthSource, 'fetchReport', dependencies);
  const handlers = isolatedFunction(healthSource, 'handlers', { ...dependencies, makeCheck, fetchReport });
  return { load, health: (db, date) => handlers['daily-report-contract']({ supabase: db, targetDate: date }) };
}

test('both actual consumers use one central publication result and exact durable receipt', async () => {
  const f = fixture(), calls = [], reads = [], consumer = consumers(calls);
  const state = await consumer.load(database(f, reads), f.report.report_date);
  const health = await consumer.health(database(f, reads), f.report.report_date);
  assert.equal(state.report_eligible, true);
  assert.equal(state.premium_eligible, false);
  assert.equal(state.snapshot.id, f.snapshot.id);
  assert.equal(health.status, 'passed');
  assert.equal(health.actual_state.current_revision, f.snapshot.id);
  assert.equal(calls.length, 2, 'Each consumer evaluates publication only once');
  assert.ok(calls.every(args => args[4].publicationRun?.id === f.publicationRun.id));
  assert.ok(reads.filter(row => row.table === 'decision_snapshots').every(row =>
    row.filters.some(([key, value]) => key === 'id' && value === f.snapshot.id)));
  assert.ok(reads.filter(row => row.table === 'pipeline_runs').every(row =>
    row.filters.some(([key, value]) => key === 'provider_status->result->>decision_snapshot_id' && value === f.snapshot.id)));
});

test('committed market survives current private research/member/Premium failure without recovery or stocks', async () => {
  const f = fixture(), consumer = consumers(), ai = f.report.ai_strategy_json;
  f.member.status = 'BLOCKED';
  ai.member_research_note_v2 = {};
  ai.content_evidence_quality = { verified_market_count: 0, verified_news_count: 0 };
  ai.missing_sources = ['private_company_evidence'];
  ai.canonical_market_state = { status: 'INSUFFICIENT_EVIDENCE' };
  ai.today_beneficiary_stocks_v10 = [{ symbol: 'SYNTHETIC_PRIVATE_UNSUPPORTED' }];
  const state = await consumer.load(database(f), f.report.report_date);
  const health = await consumer.health(database(f), f.report.report_date);
  assert.equal(evaluateMarketReportGate(ai, f.report.report_date).eligible, false, 'Private current draft really fails');
  assert.equal(state.report_eligible, true);
  assert.equal(state.premium_eligible, false);
  assert.equal(state.recommendation_status, 'BLOCKED');
  assert.deepEqual(Array.from(state.reason_codes), []);
  assert.equal(health.status, 'passed');
  assert.equal(health.actual_state.premium_content_status, 'blocked');
  assert.equal(health.actual_state.verified_catalyst_count, 0, 'Missing current counters are not invented');
  assert.equal(health.actual_state.current_market_gate_status, evaluateMarketReportGate(ai, f.report.report_date).status);
  assert.equal(health.actual_state.recommendation_status, 'BLOCKED');
  const plan = buildDailyDeliveryRecoveryPlan({ has_report: true, ...state, attempt: 1, taipei_minutes: 7 * 60 + 15 });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.actions.includes('regenerate_report'), false);
  assert.equal(resolveDailyDeliveryCompletion({ phase: 'generate', ...state, action_failure_count: 0, delivered: false }), true);
});

test('health reads published projected bias, not an empty or contradictory current report alias', async () => {
  const f = fixture(), consumer = consumers();
  f.report.market_bias = null;
  f.report.ai_strategy_json.market_bias = 'SYNTHETIC_PRIVATE_CONTRADICTION';
  assert.equal((await consumer.health(database(f), f.report.report_date)).status, 'passed');
  f.snapshot.generated_text.market_bias = null;
  f.snapshot.market_regime = null;
  f.report.market_bias = 'SYNTHETIC_RAW_CANNOT_REPAIR_MISSING_FROZEN_BIAS';
  const evidence = await fetchPublishedDeliveryEvidence(database(f), f.report);
  const central = evaluatePublishedMarketDelivery(f.report, evidence.snapshot, evidence.member,
    evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date), { publicationRun: evidence.publicationRun });
  assert.equal(central.eligible, false, 'The shared authority rejects missing committed direction');
  assert.equal(central.projection.marketDecision.bias, null, 'Missing committed bias is never fabricated from a raw alias');
  const health = await consumer.health(database(f), f.report.report_date);
  assert.equal(health.status, 'failed');
  assert.ok(health.actual_state.missing_fields.includes('market_publication_contract'));
  assert.ok(health.actual_state.market_report_reason_codes.includes('COMMITTED_MARKET_DIRECTION_UNAVAILABLE'));
});

const negativeCases = [
  ['missing snapshot', f => { f.snapshot = null; }],
  ['wrong report date', f => { f.snapshot.report_date = '2026-07-13'; }],
  ['wrong current revision', f => { f.report.ai_strategy_json.revision_id = 'synthetic-newer-private-qa'; }],
  ['unbound member identity', f => { f.member.decision_snapshot_id = 'unrelated'; }],
  ['missing publication receipt', f => { f.publicationRun = null; }],
  ['failed receipt', f => { f.publicationRun.status = 'FAILED'; }],
  ['wrong receipt report identity', f => { f.publicationRun.provider_status.result.report_id = 'unrelated'; }],
  ['wrong receipt revision', f => { f.publicationRun.provider_status.result.decision_snapshot_id = 'unrelated'; }],
  ['failed committed semantic proof', f => { f.publicationRun.provider_status.result.semantic_status = 'BLOCKED'; }],
  ['future receipt', f => { f.publicationRun.completed_at = '2099-01-01T00:00:00Z'; }],
  ['unknown publication schema', f => { f.report.ai_strategy_json.market_publication_contract.schema_version = 'UNKNOWN'; }],
  ['unpublished contract', f => { f.report.ai_strategy_json.market_publication_contract.status = 'READY'; }],
  ['wrong contract date', f => { f.report.ai_strategy_json.market_publication_contract.report_date = '2026-07-13'; }],
  ['wrong contract revision', f => { f.report.ai_strategy_json.market_publication_contract.revision_id = 'unrelated'; }],
  ['missing frozen opening pointer', f => { delete f.report.ai_strategy_json.market_publication_contract.opening_publication_revision_id; }],
  ['missing frozen market evidence', f => { delete f.snapshot.generated_text.canonical_market_state; }],
  ['missing source ledger', f => { f.snapshot.source_refs = []; }],
  ['corrupted market source tuple', f => { f.snapshot.source_refs[0].source_date = '2099-01-01T00:00:00Z'; }],
  ['real unsupported market claim', f => { f.snapshot.generated_text.canonical_market_state.document.quality.coverage_audit.claims[0].supported = false; }],
  ['partial committed decision', f => { f.snapshot.status = 'PARTIAL'; }],
];
for (const [name, mutate] of negativeCases) test(`both publication consumers fail closed: ${name}`, async () => {
  const f = fixture(), consumer = consumers();
  assert.equal((await consumer.load(database(f), f.report.report_date)).report_eligible, true, 'Positive baseline first');
  mutate(f);
  const state = await consumer.load(database(f), f.report.report_date);
  const health = await consumer.health(database(f), f.report.report_date);
  assert.equal(state.report_eligible, false);
  assert.equal(state.premium_eligible, false);
  assert.ok(state.reason_codes.length > 0);
  assert.equal(health.status, 'failed');
  assert.ok(health.actual_state.missing_fields.includes('market_publication_contract'));
  assert.ok(health.actual_state.market_report_reason_codes.length > 0);
});

test('missing report retains skipped health and blocked delivery; query errors never become eligibility', async () => {
  const consumer = consumers(), empty = fixture();
  empty.report = null;
  assert.equal((await consumer.load(database(empty), '2026-07-14')).report_eligible, false);
  assert.equal((await consumer.health(database(empty), '2026-07-14')).status, 'skipped');
  for (const table of ['reports', 'decision_snapshots', 'member_content_revisions', 'pipeline_runs']) {
    const f = fixture(), db = database(f, [], { [table]: 'synthetic-query-failure' });
    await assert.rejects(consumer.load(db, f.report.report_date), /QUERY_FAILED/);
    await assert.rejects(consumer.health(db, f.report.report_date), /QUERY_FAILED/);
  }
});

test('non-trading metadata retains its existing health contract without claiming market publication', async () => {
  const f = fixture(), consumer = consumers();
  f.report.ai_strategy_json = { report_mode: 'holiday_digest', market_status: 'CLOSED', is_trading_day: false };
  f.report.report_mode = 'holiday_digest';
  f.snapshot = null; f.member = null; f.publicationRun = null;
  assert.equal((await consumer.health(database(f), f.report.report_date)).status, 'passed');
  assert.equal((await consumer.load(database(f), f.report.report_date)).report_eligible, false);
  delete f.report.ai_strategy_json.market_status;
  assert.equal((await consumer.health(database(f), f.report.report_date)).status, 'failed');
});
