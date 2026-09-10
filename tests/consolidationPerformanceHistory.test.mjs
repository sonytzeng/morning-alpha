// Real reader/projection/validators; synthetic in-memory database rows only.
// Not provider, Auth, SQL persistence or Production E2E evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePublishedMarketDelivery } from '../supabase/functions/_shared/market-publication-contract.ts';
import { validateOpeningPublication, resolveOpeningPublicationIdentity, resolveClosingReceiptPointer, evaluateClosingContract } from '../supabase/functions/_shared/closing-learning-contract.ts';
import { resolveMarketStatus } from '../supabase/functions/_shared/market-status.ts';
import { createSubscriberState, getSubscriberReportProjection, INCOMPLETE_ANALYSIS_MESSAGE } from '../src/lib/subscriberReportContract.ts';
import { selectPublicPerformanceRows } from '../src/lib/performanceJournalProjection.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('supabase/functions/get-report-payload/index.ts');
const functions = {};
const names = ['asObject', 'asArray', 'toStringValue', 'toNumberValue', 'parseAi', 'isValidDate', 'getAi',
  'getReportDate', 'getGeneratedAt', 'getConfidenceLabel', 'buildHistoryClosingVerdict', 'buildHistorySummary', 'loadHistoryEvidence'];
const deps = { evaluateMarketReportGate, evaluatePublishedMarketDelivery, validateOpeningPublication,
  resolveOpeningPublicationIdentity, resolveClosingReceiptPointer, evaluateClosingContract, resolveMarketStatus,
  createSubscriberState, getSubscriberReportProjection, INCOMPLETE_ANALYSIS_MESSAGE,
  ...Object.fromEntries(names.map(name => [name, (...args) => functions[name](...args)])) };
for (const name of names) functions[name] = isolatedFunction(source, name, deps);

function fixture() {
  const f = isolatedFunction(read('tests/consolidationPublicationConsumers.test.mjs'), 'fixture', {
    isolatedFunction, read, assert, structuredClone, assembleCanonicalMarketResearch, buildCanonicalMarketState,
    canonicalMarketSourceRefs, evaluateMarketReportGate,
  })();
  const date = f.report.report_date;
  const quote = symbol => ({ symbol, value: 100, change_percent: 0, source: 'synthetic:official-close',
    phase: 'close', trading_date: date, captured_at: `${date}T14:30:00+08:00` });
  const closing = { status: 'completed', data_status: 'complete', report_date: date,
    opening_decision_snapshot_id: f.snapshot.id, opening_decision_snapshot_version: f.snapshot.version,
    evidence_fingerprint: 'synthetic-close-fingerprint', verified_at: `${date}T14:31:00+08:00`,
    actual_taiex_close: quote('TAIEX'), actual_2330_close: quote('2330'), actual_txf_close: quote('TXF'),
    actual_direction: 'flat', hit_or_miss: 'partial', opening_bias: '中性觀察', opening_confidence: 64,
    predicted_beneficiary_stocks: [], beneficiary_list_validation: { items: [] },
    what_was_right: ['合成已驗證市場紀錄'], what_was_wrong: ['合成方向未延伸'],
    tomorrow_adjustment: { keep: ['等待新的市場證據'], downgrade: [], watch_tomorrow: ['查看隔夜市場'] } };
  f.closingSnapshot = { id: 'synthetic-durable-close', report_id: f.report.id, report_date: date,
    session_type: 'CLOSING', status: 'FINAL', coverage_score: 100, source_freshness: { status: 'complete' },
    valid_from: `${date}T14:31:01+08:00`, generated_text: {
      opening_decision_snapshot_id: f.snapshot.id, opening_decision_snapshot_version: f.snapshot.version,
      evidence_fingerprint: closing.evidence_fingerprint, closing_verification_v2: closing } };
  f.report.ai_strategy_json.closing_contract = { schema_version: 'CORE_CLOSING_V1', status: 'COMPLETE', report_date: date,
    opening_publication_revision_id: f.snapshot.id, closing_snapshot_id: f.closingSnapshot.id };
  f.evidence = { snapshots: new Map([[f.snapshot.id, f.snapshot], [f.closingSnapshot.id, f.closingSnapshot]]),
    members: new Map([[f.member.id, f.member]]), runs: [f.publicationRun] };
  f.now = '2026-09-09T15:00:00+08:00';
  return f;
}
const summary = f => functions.buildHistorySummary(f.report, f.snapshot, f.now, f.evidence, '2026-09-09');

test('genuine historical publication + exact durable closing retain actual date, zero change and public outcome', () => {
  const f = fixture(), before = JSON.stringify(f), row = summary(f), projection = getSubscriberReportProjection(row, { historical: true });
  assert.equal(row.report_date, f.report.report_date); assert.equal(row.today_date, '2026-09-09');
  assert.equal(projection.analysisAvailable, true); assert.equal(projection.closing.complete, true);
  assert.equal(projection.closing.outcome, 'partial'); assert.equal(projection.closing.result.actual_taiex_change, 0);
  assert.equal(projection.closing.result.tomorrow_adjustment.keep[0], '等待新的市場證據');
  assert.deepEqual(JSON.parse(JSON.stringify(projection.closing.result.missing_data)), []);
  assert.equal(projection.confidence.value, 64); assert.equal(projection.recommendation.available, false);
  assert.equal(projection.historical, true); assert.equal(JSON.stringify(f), before);
  assert.equal(selectPublicPerformanceRows([row])[0].row, row, 'Keep the actual proof-bearing row');
});

for (const [name, mutate] of [
  ['wrong current report', f => { f.snapshot.report_id = 'wrong'; }],
  ['wrong current revision', f => { f.snapshot.id = 'wrong'; }],
  ['wrong current date', f => { f.snapshot.report_date = '2026-07-13'; }],
  ['missing frozen market document', f => { f.snapshot.generated_text.canonical_market_state = null; }],
  ['PARTIAL raw100', f => { f.snapshot.status = 'PARTIAL'; f.report.confidence_score = 100; }],
  ['no successful publication receipt', f => { f.evidence.runs = []; }],
  ['wrong successful receipt identity', f => { f.publicationRun.provider_status.result.report_id = 'wrong'; }],
  ['wrong frozen opening', f => { f.report.ai_strategy_json.market_publication_contract.opening_publication_revision_id = 'wrong'; }],
  ['late opening', f => { f.snapshot.valid_from = `${f.report.report_date}T09:01:00+08:00`; }],
  ['late opening publication', f => { f.publicationRun.completed_at = `${f.report.report_date}T09:01:00+08:00`; }],
  ['missing closing pointer', f => { delete f.report.ai_strategy_json.closing_contract; }],
  ['missing durable closing', f => { f.evidence.snapshots.delete(f.closingSnapshot.id); }],
  ['wrong durable closing report', f => { f.closingSnapshot.report_id = 'wrong'; }],
  ['wrong durable closing opening', f => { f.closingSnapshot.generated_text.opening_decision_snapshot_id = 'wrong'; }],
  ['wrong durable closing fingerprint', f => { f.closingSnapshot.generated_text.evidence_fingerprint = 'wrong'; }],
  ['null actual change is not zero', f => { f.closingSnapshot.generated_text.closing_verification_v2.actual_taiex_close.change_percent = null; }],
  ['contradictory missing_data is never normalized to empty', f => { f.closingSnapshot.generated_text.closing_verification_v2.missing_data = ['unverified_core_source']; }],
  ['query bound exceeded', f => { f.evidence.queryBoundExceeded = true; }],
]) test(`history stays on its true date without false completion: ${name}`, () => {
  const f = fixture(); mutate(f);
  f.report.ai_strategy_json.closing_verification_v2 = { ...f.closingSnapshot.generated_text.closing_verification_v2,
    status: 'completed', data_status: 'complete', actual_taiex_change: 99, missing_data: [] };
  f.report.ai_strategy_json.confidence_score = 100;
  const row = summary(f), projection = getSubscriberReportProjection(row, { historical: true });
  assert.equal(row.report_date, f.report.report_date); assert.equal(projection.closing.complete, false);
  assert.equal(projection.closing.result, null); assert.notEqual(projection.confidence.value, 100);
});

test('current private stock/Premium failure cannot revoke committed market history or leak private content', () => {
  const f = fixture(), ai = f.report.ai_strategy_json;
  f.member.status = 'BLOCKED'; ai.stock_research = { document: { secret: 'PRIVATE_STOCK' } };
  ai.today_beneficiary_stocks_v10 = [{ symbol: 'PRIVATE_STOCK' }]; ai.member_value_score = 0;
  f.snapshot.generated_text.unknown_private_field = { symbol: 'PRIVATE_STOCK' };
  ai.market_publication_contract.unknown_private_field = 'PRIVATE_STOCK';
  f.closingSnapshot.generated_text.closing_verification_v2.actual_taiex_close.raw = { secret: 'PRIVATE_STOCK' };
  const row = summary(f);
  assert.equal(row.subscriber_projection.analysisAvailable, true); assert.equal(row.subscriber_projection.closing.complete, true);
  assert.deepEqual(row.subscriber_projection.recommendation.items, []);
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE_STOCK|stock_research|beneficiary_list_validation/);
});

test('a later published revision retains the exact original opening and its durable close, not its newer thesis', () => {
  const f = fixture(), opening = f.snapshot, date = f.report.report_date;
  f.snapshot = { ...opening, id: 'synthetic-later-publication', version: 2, session_type: 'INTRADAY',
    valid_from: `${date}T15:00:00+08:00`, created_at: `${date}T15:00:00+08:00`, confidence_score: 73,
    generated_text: { ...opening.generated_text, market_bias: 'synthetic-later-bullish' } };
  f.member = { ...f.member, decision_snapshot_id: f.snapshot.id, decision_snapshot_version: 2 };
  f.evidence.members.set(f.member.id, f.member); f.evidence.snapshots.set(f.snapshot.id, f.snapshot);
  const run = structuredClone(f.publicationRun); run.id = 'synthetic-later-run';
  run.completed_at = `${date}T15:01:00+08:00`;
  run.provider_status.result.decision_snapshot_id = f.snapshot.id; f.evidence.runs.push(run);
  f.report.ai_strategy_json.revision_id = f.snapshot.id;
  f.report.ai_strategy_json.market_publication_contract.revision_id = f.snapshot.id;
  f.report.ai_strategy_json.market_publication_contract.publication_run_id = run.id;
  const row = summary(f), projection = getSubscriberReportProjection(row, { historical: true });
  assert.equal(projection.analysisAvailable, true); assert.equal(projection.closing.complete, true);
  assert.equal(projection.identity.revisionId, f.snapshot.id); assert.equal(projection.confidence.value, 73);
  assert.equal(projection.closing.openingDecision.revisionId, opening.id);
  assert.equal(projection.closing.openingDecision.confidence, 64);
  assert.equal(projection.closing.openingDecision.bias, '中性觀察');
  assert.equal(projection.marketDecision.bias, 'synthetic-later-bullish');
});

test('identical history rows collapse; conflicting revisions block only that real date', () => {
  const row = summary(fixture()), conflict = structuredClone(row); conflict.revision_id = 'other';
  assert.equal(selectPublicPerformanceRows([row, structuredClone(row)]).length, 1);
  const other = { report_date: '2026-07-13' };
  const selected = selectPublicPerformanceRows([row, conflict, other]);
  assert.equal(selected.length, 2); assert.equal(selected[0].row, null);
  assert.equal(selected[0].reportDate, row.report_date); assert.equal(selected[1].row, other);
});

test('history evidence uses three bounded parallel batches after reports, no N+1 or date-only receipt joins', async () => {
  const f = fixture(), trace = [], tables = { decision_snapshots: [f.snapshot, f.closingSnapshot],
    member_content_revisions: [f.member], pipeline_runs: [f.publicationRun] };
  const client = { from(table) { const log = { table, filters: [], limits: [] }; trace.push(log);
    const q = { select: () => q, order: () => q,
      in: (key, values) => { log.filters.push([key, values]); return q; },
      eq: (key, value) => { log.filters.push([key, value]); return q; },
      like: (key, value) => { log.filters.push([key, value]); return q; },
      limit: (n, options) => { log.limits.push([n, options]); return q; },
      then: resolve => resolve({ data: tables[table], error: null }) }; return q; } };
  const evidence = await functions.loadHistoryEvidence(client, Array.from({ length: 30 }, () => f.report));
  assert.equal(trace.length, 3); assert.equal(evidence.snapshots.size, 2);
  assert.equal(evidence.runs.length, 1); assert.equal(summary({ ...f, evidence }).subscriber_projection.closing.complete, true);
  assert.deepEqual(trace[0].limits, [[90, undefined]]);
  assert.ok(trace[2].filters.some(([key]) => key === 'provider_status->result->>decision_snapshot_id'));
  assert.ok(trace[2].filters.some(([key]) => key === 'provider_status->result->>report_id'));
  tables.pipeline_runs = Array.from({ length: 3 }, () => f.publicationRun);
  const overflow = await functions.loadHistoryEvidence(client, [f.report]);
  assert.equal(overflow.queryBoundExceeded, true);
  assert.equal(summary({ ...f, evidence: overflow }).subscriber_projection.closing.complete, false);
});

test('both active pages use bounded public history, never the flat legacy journal or direct reports table', () => {
  for (const path of ['src/pages/home/page.tsx', 'src/pages/performance/page.tsx']) {
    const text = read(path);
    assert.match(text, /callGetReportHistory\(30\)/); assert.match(text, /selectPublicPerformanceRows/);
    assert.doesNotMatch(text, /get_public_performance_journal|\.from\(['"]reports['"]\)/);
  }
  assert.match(source, /Math\.min\(30, Math\.max\(1, requestedLimit\)\)/);
});

test('read-only history mode preserves actual todayDate; default delivery still rejects history', () => {
  const f = fixture(), gate = evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date);
  const options = { todayDate: '2026-09-09', now: f.now, publicationRun: f.publicationRun };
  const deliver = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate, options);
  assert.equal(deliver.eligible, false); assert.ok(deliver.reason_codes.includes('MARKET_DELIVERY_DATE_MISMATCH'));
  const history = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate, { ...options, historicalRead: true });
  assert.equal(history.eligible, true); assert.equal(history.projection.historical, true);
  assert.equal(history.projection.identity.todayDate, options.todayDate);
  const future = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate,
    { ...options, todayDate: '2026-07-13', historicalRead: true });
  assert.equal(future.eligible, false, 'Read-only historical mode cannot admit a future report');
  f.snapshot.generated_text.canonical_market_state = null;
  const corrupt = evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member, gate, { ...options, historicalRead: true });
  assert.equal(corrupt.eligible, false, 'Historical mode never relaxes frozen market evidence');
});

test('actual V2 producer shape without a legacy missing_data alias retains measured market evidence and adjustment prose', () => {
  const f = fixture(), date = f.report.report_date;
  class FixtureClock extends Date { constructor() { super(`${date}T14:31:00+08:00`); } }
  const build = isolatedFunction(read('supabase/functions/closing-verification-engine/index.ts'), 'buildClosingVerificationV2', { Date: FixtureClock });
  const quote = symbol => ({ symbol, value: 100, change: 0, source: 'synthetic:official-close',
    capturedAt: `${date}T14:30:00+08:00`, phase: 'close', tradingDate: date });
  const v2 = build({ reportDate: date, predictedStocks: [], beneficiaryValidation: { items: [] },
    taiexClose: quote('TAIEX'), tsmcClose: quote('2330'), txfClose: quote('TXF'),
    decisionSnapshot: f.snapshot, predictedBias: '中性觀察', confidence: 64, beneficiaryDecisionMode: 'market_only',
    intradayReplay: [], intradayReplayTimeWindows: [], sectorPerformance: [], result: 'partial',
    source: 'market_data_snapshots', closeWindow: { start: `${date}T13:30:00+08:00`, end: `${date}T15:30:00+08:00` } });
  assert.equal(v2.missing_data, undefined, 'This is the actual producer shape, not an idealized legacy fixture');
  v2.evidence_fingerprint = f.closingSnapshot.generated_text.evidence_fingerprint;
  f.closingSnapshot.generated_text.closing_verification_v2 = v2;
  const row = summary(f), projected = row.subscriber_projection;
  assert.equal(projected.closing.complete, true); assert.equal(projected.closing.result.actual_taiex_change, 0);
  assert.equal(projected.closing.result.tomorrow_adjustment.keep[0], v2.tomorrow_adjustment.keep[0]);
  assert.equal(row.closing_contract.closing_snapshot_id, f.closingSnapshot.id);
});

test('Performance date guard consumes server projection identity without a browser clock', () => {
  const page = read('src/pages/performance/page.tsx');
  const future = isolatedFunction(page, 'isFutureReportDate', { Date: class { constructor() { throw new Error('browser clock forbidden'); } } });
  assert.equal(future('2026-09-08', '2026-09-09'), false);
  assert.equal(future('2026-09-10', '2026-09-09'), true);
  assert.match(page, /isFutureReportDate\(selection.reportDate, projection.identity.todayDate\)/);
  assert.doesNotMatch(page, /taipeiToday|new Date\(/);
});
