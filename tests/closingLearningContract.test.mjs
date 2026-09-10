// Synthetic, in-memory fixtures only. No provider, Supabase, LINE or SQL I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import {
  resolveOpeningPublicationIdentity, validateOpeningPublication,
  isTrustedCloseSnapshot, evaluateClosingContract, evaluateLearningContract, closingDueState,
  resolveClosingReceiptPointer, selectLearningPredictionSamples, canWriteLearningOutcome,
} from '../supabase/functions/_shared/closing-learning-contract.ts';
import {
  finiteNumber, calibrateConfidence, confidenceBucket, normalizePredictionDirection,
  selectTargetTradingDate, percentReturn, isDirectionCorrect, classifyOutcomeDirection,
} from '../supabase/functions/_shared/continuous-learning-core.mjs';
import { buildCanonicalMarketState, canonicalMarketDocument, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';

const date = '2026-09-08', now = Date.parse(`${date}T15:00:00+08:00`);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const firstText = (...values) => values.find(value => typeof value === 'string' && value.trim()) || '';
const firstNumber = (...values) => values.map(finiteNumber).find(value => value !== null) ?? null;

function openingFixture() {
  const report = { id: 'report-1', report_date: date, market_bias: '偏空', ai_strategy_json: {
    revision_id: 'opening-1', market_publication_contract: {
      schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED', report_date: date,
      revision_id: 'opening-1', opening_publication_revision_id: 'opening-1',
    }, v10_data_quality_status: 'insufficient_positive_evidence', missing_sources: ['company_evidence'],
  } };
  const snapshot = { id: 'opening-1', report_id: report.id, report_date: date, session_type: 'PREMARKET',
    version: 1, status: 'READY', is_current: false, decision_mode: 'market_only', market_regime: '偏多',
    valid_from: `${date}T07:30:00+08:00`, source_refs: [{ source: 'fixture:official-market' }],
    source_freshness: { status: 'complete' }, generated_text: { market_bias: '偏多', recommendations: [] } };
  const publicationRun = { id: 'input-1', status: 'SUCCEEDED', trading_date: date,
    idempotency_key: 'research-input:fixture', completed_at: `${date}T07:31:00+08:00`, provider_status: {
      result: { success: true, report_id: report.id, report_date: date, decision_snapshot_id: snapshot.id },
    } };
  return { report, snapshot, publicationRun, now };
}
function quote(symbol = 'TAIEX', change = 0) {
  return { symbol, value: 100, change_percent: change, source: 'fixture:official-close',
    phase: 'close', trading_date: date, captured_at: `${date}T14:30:00+08:00` };
}
function closingFixture() {
  return { version: 'S2_P2_CLOSE_VERIFICATION_V2', status: 'completed', data_status: 'complete',
    evidence_fingerprint: 'fixture-close-fingerprint',
    report_date: date, opening_decision_snapshot_id: 'opening-1', opening_decision_snapshot_version: 1,
    verified_at: `${date}T14:31:00+08:00`, actual_taiex_close: quote(), actual_2330_close: quote('2330', -1),
    actual_txf_close: quote('TXF', -0.4), actual_direction: 'flat', hit_or_miss: 'partial',
    predicted_beneficiary_stocks: [], beneficiary_list_validation: {
      data_status: 'not_applicable_no_recommendations', evaluation_status: 'NOT_APPLICABLE', items: [],
    }, data_source: { table: 'market_data_snapshots', no_fake_data: true } };
}
function durableClosingFixture(closing = closingFixture()) {
  return { id: 'closing-1', report_id: 'report-1', report_date: date, session_type: 'CLOSING',
    status: 'FINAL', version: 1, coverage_score: 100, source_freshness: { status: 'complete' },
    valid_from: `${date}T14:31:01+08:00`, generated_text: {
      opening_decision_snapshot_id: 'opening-1', opening_decision_snapshot_version: 1,
      evidence_fingerprint: closing.evidence_fingerprint, closing_verification_v2: closing,
      closing_verification: { status: closing.status, report_date: date },
    } };
}
function learningFixture() {
  const opening = validateOpeningPublication(openingFixture());
  const closing = evaluateClosingContract({ opening, closingSnapshot: durableClosingFixture(), now });
  return { opening, closing, now, predictions: [{ id: 'prediction-1', report_date: date,
    decision_snapshot_id: 'opening-1', prediction_scope: 'market', symbol: 'TAIEX', direction: 'bullish',
    record_status: 'valid', data_quality_status: 'complete' }], outcomes: [{ prediction_id: 'prediction-1',
    horizon: 'close', target_date: date, status: 'completed', data_quality_status: 'complete',
    evaluated_at: `${date}T14:40:00+08:00`, return_percent: 0, direction_correct: false,
    source_refs: [{ table: 'market_data_snapshots', ...quote() }] }] };
}

test('opening identity is pinned to real publication, not the newest current QA or later report text', () => {
  const f = openingFixture();
  assert.equal(validateOpeningPublication(f).status, 'PUBLISHED');
  f.report.ai_strategy_json.revision_id = 'intraday-2';
  f.report.ai_strategy_json.market_publication_contract.revision_id = 'intraday-2';
  assert.equal(validateOpeningPublication(f).opening_publication_revision_id, 'opening-1');
  assert.equal(validateOpeningPublication(f).status, 'PUBLISHED');
  f.snapshot.id = 'newest-private-qa'; f.snapshot.is_current = true;
  assert.equal(validateOpeningPublication(f).status, 'BLOCKED');
});

test('invalid contract, missing atomic receipt, wrong date and post-open predictions fail closed', () => {
  const mutations = [
    f => { f.report.ai_strategy_json.market_publication_contract.status = 'READY'; },
    f => { f.report.ai_strategy_json.market_publication_contract.schema_version = 'UNKNOWN'; },
    f => { f.report.ai_strategy_json.market_publication_contract = {}; },
    f => { f.publicationRun = null; },
    f => { f.publicationRun.provider_status.result.decision_snapshot_id = 'other'; },
    f => { f.publicationRun.status = 'RUNNING'; },
    f => { f.snapshot.report_date = '2026-09-07'; },
    f => { f.snapshot.valid_from = `${date}T12:00:00+08:00`; },
    f => { f.publicationRun.completed_at = `${date}T12:00:00+08:00`; },
    f => { f.snapshot.generated_text.recommendations = [{ symbol: '2330' }]; },
  ];
  for (const mutate of mutations) { const f = openingFixture(); mutate(f); assert.equal(validateOpeningPublication(f).status, 'BLOCKED'); }
});

test('legacy reports require exact PREMARKET plus receipt; no guessing an opening from an intraday pointer', () => {
  const f = openingFixture(); delete f.report.ai_strategy_json.market_publication_contract;
  assert.equal(validateOpeningPublication(f).status, 'PUBLISHED');
  f.snapshot.session_type = 'INTRADAY'; assert.equal(validateOpeningPublication(f).status, 'BLOCKED');
  delete f.report.ai_strategy_json.revision_id;
  assert.ok(resolveOpeningPublicationIdentity(f.report).reason_codes.includes('OPENING_PUBLICATION_POINTER_MISSING'));
});

test('market-only Closing completes real market evaluation with stocks explicitly NOT_APPLICABLE', () => {
  const contract = evaluateClosingContract({ opening: validateOpeningPublication(openingFixture()), closingSnapshot: durableClosingFixture(), now });
  assert.equal(contract.status, 'COMPLETE'); assert.equal(contract.stock_evaluation, 'NOT_APPLICABLE');
  assert.equal(contract.market_evaluation, 'COMPLETE'); assert.deepEqual(contract.reason_codes, []);
});

test('before closing due and nontrading days remain NOT_DUE/NOT_APPLICABLE, never completed by time', () => {
  assert.equal(closingDueState(date, Date.parse(`${date}T14:09:00+08:00`)), 'NOT_DUE');
  assert.equal(closingDueState(date, Date.parse(`${date}T14:10:00+08:00`)), 'DUE');
  assert.equal(closingDueState('2026-09-06', now), 'NOT_APPLICABLE');
});

test('source timestamps cannot hide stale/future close evidence behind a valid captured_at', () => {
  for (const source_at of [null, '', 'bad', '2026-09-07T14:30:00+08:00', `${date}T13:20:00+08:00`, `${date}T14:31:00+08:00`]) {
    assert.equal(isTrustedCloseSnapshot({ ...quote(), source_at }, date, now), false);
  }
  assert.equal(isTrustedCloseSnapshot(quote('TXF'), date, now), true);
  assert.equal(isTrustedCloseSnapshot({ ...quote('TXF'), source_at: `${date}T13:35:00+08:00` }, date, now), false);
});

test('no completed label or clock can substitute for missing, wrong-symbol or wrong-revision closing evidence', () => {
  const opening = validateOpeningPublication(openingFixture());
  const mutations = [
    c => { c.actual_taiex_close.value = null; }, c => { c.actual_txf_close = null; },
    c => { c.actual_2330_close.symbol = 'TAIEX'; }, c => { c.actual_taiex_close.change_percent = undefined; },
    c => { c.actual_taiex_close.source = ''; }, c => { c.actual_taiex_close.phase = 'intraday'; },
    c => { c.actual_taiex_close.trading_date = '2026-09-07'; },
    c => { c.actual_taiex_close.captured_at = `${date}T13:00:00+08:00`; },
    c => { c.actual_taiex_close.captured_at = `${date}T16:00:00+08:00`; },
    c => { c.verified_at = `${date}T16:00:00+08:00`; },
    c => { c.opening_decision_snapshot_id = 'qa-99'; }, c => { c.hit_or_miss = 'pending'; },
    c => { c.predicted_beneficiary_stocks = [{ symbol: '2330' }]; },
  ];
  for (const mutate of mutations) { const closing = closingFixture(); mutate(closing);
    const actual = evaluateClosingContract({ opening, closingSnapshot: durableClosingFixture(closing), now });
    assert.equal(actual.status, 'INSUFFICIENT_EVIDENCE'); assert.equal(actual.verified_at, null);
  }
  assert.equal(evaluateClosingContract({ opening, closing: null, now }).status, 'PENDING');
  assert.equal(evaluateClosingContract({ opening, closing: { status: 'completed', lifecycle: 'DAY_COMPLETED' }, now }).status, 'INSUFFICIENT_EVIDENCE');
});

test('real zero market return remains zero; market-only learning creates no symbol outcome requirement', () => {
  const result = evaluateLearningContract(learningFixture());
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.market_prediction_count, 1);
  assert.equal(result.stock_prediction_count, 0); assert.equal(result.stock_evaluation, 'NOT_APPLICABLE');
});

test('Learning requires actual same-opening close outcome, not intraday, absent-as-zero, stale refs or future completion', () => {
  const mutations = [
    f => { f.outcomes[0].horizon = 'intraday'; }, f => { f.outcomes[0].return_percent = null; },
    f => { f.outcomes[0].source_refs = []; }, f => { f.outcomes[0].source_refs[0].phase = 'intraday'; },
    f => { f.outcomes[0].source_refs[0].captured_at = `${date}T09:00:00+08:00`; },
    f => { f.outcomes[0].source_refs[0].change_percent = 1; },
    f => { f.outcomes[0].target_date = '2026-09-07'; },
    f => { f.outcomes[0].evaluated_at = `${date}T16:00:00+08:00`; },
    f => { f.predictions[0].decision_snapshot_id = 'old-opening'; },
    f => { f.predictions.push({ ...f.predictions[0], id: 'stock', prediction_scope: 'symbol', symbol: '2330' }); },
    f => { f.closing.status = 'PENDING'; }, f => { f.predictions = []; },
  ];
  for (const mutate of mutations) { const f = learningFixture(); mutate(f); assert.equal(evaluateLearningContract(f).status, 'INSUFFICIENT_EVIDENCE'); }
});

test('actual Closing beneficiary evaluator marks market_only not-applicable without invented stock outcomes', () => {
  const source = readFileSync(new URL('../supabase/functions/closing-verification-engine/index.ts', import.meta.url), 'utf8');
  const compare = isolatedFunction(source, 'compareBeneficiaryStocks');
  const actual = compare([], [], 0, 'market_only');
  assert.equal(actual.evaluation_status, 'NOT_APPLICABLE'); assert.equal(actual.data_status, 'not_applicable_no_recommendations');
  assert.equal(actual.tracked_count, 0); assert.equal(actual.items.length, 0);
});

test('actual Closing producer and shared contract keep market complete when a published stock lacks close data', () => {
  const source = readFileSync(new URL('../supabase/functions/closing-verification-engine/index.ts', import.meta.url), 'utf8');
  const build = isolatedFunction(source, 'buildClosingVerificationV2', {
    readSymbolFromStock: row => row.symbol || '', readNameFromStock: row => row.name || '', normalizeSymbol: v => String(v).toUpperCase(),
  });
  const row = q => ({ symbol: q.symbol, value: q.value, change: q.change_percent, capturedAt: q.captured_at,
    source: q.source, phase: q.phase, tradingDate: q.trading_date });
  const f = openingFixture(); f.snapshot.decision_mode = 'recommendations'; f.snapshot.generated_text.recommendations = [{ symbol: '2317' }];
  const opening = validateOpeningPublication(f);
  const closing = build({ ai: {}, decisionSnapshot: f.snapshot, reportDate: date, predictedBias: '偏多', confidence: null,
    result: 'partial', taiexClose: row(quote()), tsmcClose: row(quote('2330')), txfClose: row(quote('TXF')),
    predictedStocks: [{ symbol: '2317', name: 'Fixture stock' }], beneficiaryDecisionMode: 'recommendations',
    beneficiaryValidation: { data_status: 'degraded', items: [{ symbol: '2317', data_status: 'missing_close_data', close_change_percent: null }] },
    sectorPerformance: [], intradayReplay: [], intradayReplayTimeWindows: [], closeWindow: { start: '', end: '' }, source: 'market_data_snapshots' });
  closing.verified_at = `${date}T14:31:00+08:00`;
  closing.evidence_fingerprint = 'fixture-close-fingerprint';
  assert.equal(closing.status, 'completed'); assert.equal(closing.data_status, 'complete');
  const contract = evaluateClosingContract({ opening, closingSnapshot: durableClosingFixture(closing), now });
  assert.equal(contract.status, 'COMPLETE'); assert.equal(contract.market_evaluation, 'COMPLETE');
  assert.equal(contract.stock_evaluation, 'INSUFFICIENT_EVIDENCE'); assert.deepEqual(contract.reason_codes, []);
  assert.ok(contract.stock_reason_codes.includes('STOCK_CLOSE_EVIDENCE_INCOMPLETE'));
});

test('market Learning completes independently while missing recommended-stock outcomes remain insufficient', () => {
  const f = learningFixture(); f.opening.decision_mode = 'recommendations'; f.opening.recommended_symbols = ['2317'];
  f.closing.stock_evaluation = 'INSUFFICIENT_EVIDENCE';
  f.predictions.push({ ...f.predictions[0], id: 'stock-1', prediction_scope: 'symbol', symbol: '2317' });
  const contract = evaluateLearningContract(f);
  assert.equal(contract.status, 'COMPLETE'); assert.equal(contract.stock_evaluation, 'INSUFFICIENT_EVIDENCE');
  assert.equal(contract.market_prediction_count, 1); assert.deepEqual(contract.reason_codes, []);
  assert.ok(contract.stock_reason_codes.includes('REAL_CLOSE_OUTCOME_REQUIRED'));
});

test('actual learning capture uses published opening direction and excludes recommendation quality from market-only prediction', async () => {
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const resolveDataQuality = isolatedFunction(source, 'resolveDataQuality', { asObject: object, asStrings: v => Array.isArray(v) ? v : [], firstText });
  const latestSnapshot = isolatedFunction(source, 'latestSnapshot', { normalizeSymbol: v => String(v).toUpperCase(), isTrustedCloseSnapshot });
  const inserted = [];
  const db = { from(table) {
    assert.equal(table, 'learning_predictions');
    const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
      async maybeSingle() { return { data: null, error: null }; }, insert(row) { inserted.push(row); return q; },
      async single() { return { data: { id: `p-${inserted.length}`, ...inserted.at(-1) }, error: null }; } };
    return q;
  } };
  const capture = isolatedFunction(source, 'capturePredictions', { asObject: object, asStrings: v => Array.isArray(v) ? v : [],
    firstText, firstNumber, finiteNumber, calibrateConfidence, confidenceBucket, normalizePredictionDirection, resolveDataQuality,
    latestSnapshot, canonicalMarketDocument, fetchCalibrationMap: async () => new Map(), CLE_ENGINE_VERSION: 'CLE_V1.0.0',
    normalizeSymbol: v => String(v).toUpperCase() });
  const f = openingFixture();
  const rows = await capture(db, date, f.report, f.snapshot, [], validateOpeningPublication(f));
  assert.equal(rows.length, 1); assert.equal(rows[0].prediction_scope, 'market');
  assert.equal(rows[0].symbol, 'TAIEX'); assert.equal(rows[0].direction, 'bullish');
  assert.equal(rows[0].data_quality_status, 'complete'); assert.equal(rows[0].price_at_prediction, null);
  assert.equal(rows[0].data_snapshot.learning_contract_version, 'CORE_LEARNING_V1');
  assert.match(rows[0].idempotency_key, /^opening-1:.*:CORE_LEARNING_V1$/);
});

test('real quotes without a durable receipt are pending; report aliases cannot repair or override a receipt', () => {
  const opening = validateOpeningPublication(openingFixture());
  const draft = evaluateClosingContract({ opening, closing: closingFixture(), now });
  assert.equal(draft.status, 'PENDING'); assert.equal(draft.evidence_ready, true);
  assert.equal(draft.closing_snapshot_id, null); assert.equal(draft.verified_at, null);
  const durable = durableClosingFixture();
  const actual = evaluateClosingContract({ opening, closing: { status: 'fake' }, closingSnapshot: durable, expectedSnapshotId: durable.id, now });
  assert.equal(actual.status, 'COMPLETE'); assert.equal(actual.closing_snapshot_id, durable.id);
  for (const mutate of [
    s => { s.id = 'other'; }, s => { s.report_id = 'other'; }, s => { s.report_date = '2026-09-07'; },
    s => { s.session_type = 'PREMARKET'; }, s => { s.status = 'PARTIAL'; }, s => { s.coverage_score = 99; },
    s => { s.source_freshness.status = 'degraded'; }, s => { s.generated_text.evidence_fingerprint = 'other'; },
    s => { s.generated_text.opening_decision_snapshot_id = 'qa-99'; },
    s => { s.valid_from = `${date}T14:30:00+08:00`; }, s => { s.valid_from = `${date}T16:00:00+08:00`; },
    s => { delete s.generated_text.closing_verification_v2; },
  ]) {
    const s = durableClosingFixture(); mutate(s);
    const result = evaluateClosingContract({ opening, closing: closingFixture(), closingSnapshot: s, expectedSnapshotId: 'closing-1', now });
    assert.notEqual(result.status, 'COMPLETE'); assert.equal(result.closing_snapshot_id, null);
  }
  const report = openingFixture().report;
  report.ai_strategy_json.closing_contract = actual;
  assert.equal(resolveClosingReceiptPointer(report, opening), 'closing-1');
  report.ai_strategy_json.closing_contract.opening_publication_revision_id = 'qa-99';
  assert.equal(resolveClosingReceiptPointer(report, opening), null);
});

test('actual Closing finalizer retries lifecycle after persisted evidence, rejects no-op RPC and CAS races', async () => {
  const source = readFileSync(new URL('../supabase/functions/closing-verification-engine/index.ts', import.meta.url), 'utf8');
  const finalize = isolatedFunction(source, 'finalizeClosingReceipt', { parseJsonObject: object, asObject: object,
    evaluateClosingContract: input => evaluateClosingContract({ ...input, now }), resolveOpeningPublicationIdentity, crypto: webcrypto });
  const f = openingFixture(), opening = validateOpeningPublication(f), durable = durableClosingFixture();
  let saved = { ...f.report, updated_at: `${date}T14:31:01+08:00` }, checkpoints = {}, rpcCount = 0, updates = 0, casRace = false, noOp = false;
  const db = { from(table) {
    let update = null;
    const q = { select() { return q; }, eq() { return q; }, is() { return q; }, update(row) { update = row; return q; },
      async maybeSingle() {
        if (table === 'trading_day_state') return { data: { checkpoint_status: checkpoints }, error: null };
        assert.equal(table, 'reports');
        if (!update) return { data: saved, error: null };
        updates++; if (casRace) return { data: null, error: null };
        saved = { ...saved, ...update }; return { data: { id: saved.id }, error: null };
      } }; return q;
  }, async rpc(name, args) {
    assert.equal(name, 'advance_trading_day_state_v1'); rpcCount++;
    if (rpcCount === 1) return { data: null, error: { message: 'fixture transient failure' } };
    if (!noOp) checkpoints = { closing_verification: { status: 'SUCCEEDED', metadata: args.p_metadata } };
    return { data: { checkpoint_status: checkpoints }, error: null };
  } };
  const first = await finalize(db, f.report, opening, durable);
  assert.equal(first.success, false); assert.equal(first.closing_verification_status, 'pending_lifecycle');
  assert.equal(saved.ai_strategy_json.closing_contract.closing_snapshot_id, durable.id);
  noOp = true;
  assert.equal((await finalize(db, f.report, opening, durable)).success, false);
  noOp = false;
  assert.equal((await finalize(db, f.report, opening, durable)).success, true);
  assert.equal((await finalize(db, f.report, opening, durable)).lifecycle_reused, true);
  assert.equal(rpcCount, 3);
  casRace = true;
  assert.equal((await finalize(db, f.report, opening, durable)).error, 'CLOSING_REPORT_PROJECTION_RETRY_REQUIRED');
  assert.equal(rpcCount, 3);
  const writes = updates, bad = durableClosingFixture(); bad.status = 'PARTIAL';
  assert.equal((await finalize(db, f.report, opening, bad)).success, false); assert.equal(updates, writes);
  assert.equal((source.match(/await finalizeClosingReceipt\(/g) || []).length, 3, 'new, pointer-reuse and fingerprint-reuse all finalize receipts');
});

test('Learning lifecycle retry verifies exact returned run and opening, not transport success or succeeded-run shortcut', async () => {
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const finalize = isolatedFunction(source, 'finalizeLearningLifecycle', { asObject: object, crypto: webcrypto, CLE_ENGINE_VERSION: 'fixture' });
  const contract = evaluateLearningContract(learningFixture()); let checkpoints = {}, calls = [], failLearning = true, noOp = false;
  const db = { from(table) { assert.equal(table, 'trading_day_state'); const q = { select() { return q; }, eq() { return q; },
    async maybeSingle() { return { data: { checkpoint_status: checkpoints }, error: null }; } }; return q; },
    async rpc(name, args) {
      assert.equal(name, 'advance_trading_day_state_v1'); calls.push(args.p_checkpoint);
      if (failLearning && args.p_checkpoint === 'continuous_learning') return { data: null, error: { message: 'fixture failure' } };
      if (!noOp) checkpoints[args.p_checkpoint] = { status: 'SUCCEEDED', metadata: args.p_metadata };
      return { data: { checkpoint_status: checkpoints }, error: null };
    } };
  await assert.rejects(finalize(db, date, 'run-1', contract, {}), /LEARNING_LIFECYCLE_RETRY_REQUIRED/);
  failLearning = false;
  await finalize(db, date, 'run-1', contract, {});
  await finalize(db, date, 'run-1', contract, {});
  assert.deepEqual(calls, ['feedback', 'continuous_learning', 'continuous_learning']);
  noOp = true;
  await assert.rejects(finalize(db, date, 'different-run', contract, {}), /LEARNING_LIFECYCLE_RETRY_REQUIRED/);
  assert.equal((source.match(/await finalizeLearningLifecycle\(/g) || []).length, 2, 'new and succeeded-run reuse both verify lifecycle');
  assert.match(source, /if \(runId && !runEvidencePersisted\)/, 'lifecycle failure cannot rewrite the already durable learning run evidence');
  assert.match(source, /learning_status: runEvidencePersisted \? 'pending_lifecycle' : 'failed'/);
});

test('completed and past-due outcome evidence is immutable while a prior forecast may receive its newly due horizon', () => {
  const today = { target_date: date, status: 'completed' }, prior = '2026-09-07';
  assert.equal(canWriteLearningOutcome(today, { ...today, source_refs: [] }, date, date), false);
  assert.equal(canWriteLearningOutcome({ target_date: prior }, null, prior, date), false);
  assert.equal(canWriteLearningOutcome(today, { target_date: prior, status: 'pending' }, prior, date), false);
  assert.equal(canWriteLearningOutcome(today, { target_date: date, status: 'pending' }, prior, date), true);
  assert.equal(canWriteLearningOutcome({ target_date: null }, null, prior, date), false);
});

test('corrective v1 serialization cannot double-count a forecast or let invalid rows displace a valid sample', () => {
  const base = { id: 'legacy', report_date: date, analysis_window: 'PREMARKET', prediction_scope: 'market', symbol: 'TAIEX',
    record_status: 'valid', data_quality_status: 'complete', revision: 1 };
  const corrected = { ...base, id: 'v1', revision: 2, data_snapshot: { learning_contract_version: 'CORE_LEARNING_V1' } };
  const other = { ...base, id: 'stock', prediction_scope: 'symbol', symbol: '2330' };
  const rows = [base, corrected, other, { ...base, id: 'invalid', revision: 99, record_status: 'invalid' }];
  assert.deepEqual(selectLearningPredictionSamples(rows).map(row => row.id).sort(), ['stock', 'v1']);
  assert.equal(rows.length, 4, 'selection never rewrites immutable rows');
});

test('legacy real outcome refs can be verified against exact durable quote without enriching historical evidence', () => {
  const f = learningFixture(), ref = f.outcomes[0].source_refs[0];
  delete ref.value; delete ref.change_percent;
  f.outcomes[0].evaluated_at = `${date}T14:30:30+08:00`;
  const original = structuredClone(f.outcomes);
  assert.equal(evaluateLearningContract(f).status, 'COMPLETE'); assert.deepEqual(f.outcomes, original);
  for (const [key, value] of [['source', 'other'], ['captured_at', `${date}T14:29:00+08:00`], ['value', null]]) {
    const bad = structuredClone(f); bad.outcomes[0].source_refs[0][key] = value;
    assert.equal(evaluateLearningContract(bad).status, 'INSUFFICIENT_EVIDENCE');
  }
});

test('frozen CMS envelope and exact market ledger survive capture; malformed or mismatched present CMS blocks opening', async () => {
  const f = openingFixture();
  // Use the actual assembler's complete audit/envelope, not a READY label with
  // omitted evidence IDs or quality. Original capture assertions stay intact.
  const input = isolatedFunction(readFileSync(new URL('../supabase/functions/generate-daily-report-v7/research-master-v2.test.ts', import.meta.url), 'utf8'), 'completeFixture')();
  Object.assign(input, { reportDate: date, todayDate: date, dataAsOf: `${date}T07:00:00+08:00`, generatedAt: `${date}T07:20:00+08:00` });
  for (const row of input.evidenceIndex) row.published_at = row.published_at.replace('2026-07-13', '2026-09-07');
  const document = { ...assembleCanonicalMarketResearch(input), market_thesis: { thesis: 'Frozen market evidence thesis' } };
  f.snapshot.generated_text.canonical_market_state = buildCanonicalMarketState(document);
  const refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
  f.snapshot.source_refs = structuredClone(refs);
  assert.equal(validateOpeningPublication(f).status, 'PUBLISHED');
  for (const mutate of [
    value => { value.snapshot.generated_text.canonical_market_state.document.report_date = '2026-09-07'; },
    value => { value.snapshot.generated_text.canonical_market_state.status = 'INSUFFICIENT_EVIDENCE'; },
    value => { value.snapshot.source_refs[0].source = 'different-source'; },
    value => { value.snapshot.generated_text.canonical_market_state = null; },
  ]) {
    const bad = structuredClone(f); mutate(bad); assert.equal(validateOpeningPublication(bad).status, 'BLOCKED');
  }
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const resolveDataQuality = isolatedFunction(source, 'resolveDataQuality', { asObject: object, asStrings: v => Array.isArray(v) ? v : [], firstText });
  const capture = isolatedFunction(source, 'capturePredictions', { asObject: object, asStrings: v => Array.isArray(v) ? v : [], firstText,
    firstNumber, finiteNumber, calibrateConfidence, confidenceBucket, normalizePredictionDirection, resolveDataQuality, canonicalMarketDocument,
    latestSnapshot: () => null, fetchCalibrationMap: async () => new Map(), CLE_ENGINE_VERSION: 'CLE_V1.0.0', normalizeSymbol: v => String(v).toUpperCase() });
  let inserted = null, insertCount = 0, equivalent = null;
  const db = { from() { let key = '';
    const q = { select() { return q; }, eq(name) { if (name === 'idempotency_key') key = 'exact'; return q; },
      order() { return q; }, limit() { return q; }, async maybeSingle() { return { data: key === 'exact' ? null : equivalent, error: null }; },
      insert(row) { inserted = { id: 'legacy-equivalent', ...row }; insertCount++; return q; },
      async single() { return { data: inserted, error: null }; } }; return q;
  } };
  const first = await capture(db, date, f.report, f.snapshot, [], validateOpeningPublication(f));
  assert.equal(first[0].thesis, 'Frozen market evidence thesis');
  assert.deepEqual(first[0].source_refs, refs);
  equivalent = { ...inserted, data_snapshot: {}, idempotency_key: 'legacy-key' };
  const reused = await capture(db, date, f.report, f.snapshot, [], validateOpeningPublication(f));
  assert.equal(reused[0].id, equivalent.id); assert.equal(insertCount, 1, 'no new v1 row for an equivalent valid immutable prediction');
});

test('actual 120-day updater preserves completed/past evidence and protects concurrent completion from retry writes', async () => {
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const normalizeSymbol = value => String(value).toUpperCase();
  const latestSnapshot = isolatedFunction(source, 'latestSnapshot', { normalizeSymbol,
    isTrustedCloseSnapshot: (row, day) => isTrustedCloseSnapshot(row, day, now) });
  const reconstructPredictionPrice = isolatedFunction(source, 'reconstructPredictionPrice', { finiteNumber });
  const excursionForDirection = isolatedFunction(source, 'excursionForDirection', { normalizePredictionDirection });
  const updater = isolatedFunction(source, 'updateOutcomes', { normalizeSymbol, latestSnapshot, reconstructPredictionPrice,
    excursionForDirection, finiteNumber, selectTargetTradingDate, percentReturn, isDirectionCorrect, classifyOutcomeDirection, canWriteLearningOutcome });
  const prior = '2026-09-07', prediction = { report_date: date, symbol: 'TAIEX', direction: 'bullish', prediction_scope: 'market',
    record_status: 'valid', data_quality_status: 'complete', price_at_prediction: 100 };
  const predictions = [{ ...prediction, id: 'old', report_date: prior }, { ...prediction, id: 'new' }, { ...prediction, id: 'race' }];
  const original = { id: 'immutable-outcome', prediction_id: 'old', horizon: 'close', target_date: prior, status: 'completed',
    evaluated_at: `${prior}T14:40:00+08:00`, return_percent: 7, source_refs: [{ source: 'original-evidence' }] };
  const records = new Map([['old:close', structuredClone(original)], ['race:close', { prediction_id: 'race', horizon: 'close',
    target_date: date, status: 'pending', updated_at: `${date}T14:00:00+08:00` }]]);
  const raced = { prediction_id: 'race', horizon: 'close', target_date: date, status: 'completed',
    updated_at: `${date}T14:40:00+08:00`, evaluated_at: `${date}T14:40:00+08:00`, source_refs: [{ source: 'concurrent-original' }], return_percent: 0 };
  let racedOnce = false;
  const db = { from(table) {
    assert.equal(table, 'prediction_outcomes'); let mode = 'select', payload = null, options = null, filters = {};
    const q = { select() { return q; }, in() { return q; }, eq(key, value) { filters[key] = value; return q; },
      is(key, value) { filters[key] = value; return q; }, upsert(rows, config) { mode = 'insert'; payload = rows; options = config; return q; },
      update(row) { mode = 'update'; payload = row; return q; }, then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (mode === 'select') return { data: [...records.values()].map(row => structuredClone(row)), error: null };
          const changed = [];
          if (mode === 'insert') {
            assert.equal(options.ignoreDuplicates, true);
            for (const row of payload) { const key = `${row.prediction_id}:${row.horizon}`;
              if (!records.has(key)) { records.set(key, structuredClone(row)); changed.push(row); }
            }
          } else {
            const key = `${payload.prediction_id}:${payload.horizon}`;
            if (key === 'race:close' && !racedOnce) { records.set(key, structuredClone(raced)); racedOnce = true; }
            const current = records.get(key);
            if (Object.entries(filters).every(([name, value]) => (current[name] ?? null) === value)) {
              records.set(key, { ...current, ...structuredClone(payload) }); changed.push(payload);
            }
          }
          return { data: changed, error: null };
        }).then(resolve, reject);
      } }; return q;
  } };
  const snapshots = [quote(), { ...quote(), trading_date: prior, captured_at: `${prior}T14:30:00+08:00` }];
  await updater(db, date, predictions, snapshots);
  assert.deepEqual(records.get('old:close'), original);
  assert.equal(records.has('old:intraday'), false, 'no retroactive invented earlier horizon');
  assert.equal(records.get('old:1D').target_date, date, 'a genuine newly due horizon may be recorded');
  assert.equal(records.get('new:close').return_percent, 0, 'real zero remains a real measured return');
  assert.deepEqual(records.get('race:close'), raced, 'CAS cannot overwrite concurrent completed evidence');
  const newOriginal = structuredClone(records.get('new:close'));
  await updater(db, date, predictions, snapshots);
  assert.deepEqual(records.get('new:close'), newOriginal, 'retry preserves original evaluation time and source refs');
  assert.deepEqual(records.get('old:close'), original);
});

test('actual close-review projection preserves durable contracts and repairs sync only under exact opening/CAS', async () => {
  const source = readFileSync(new URL('../supabase/functions/close-market-review/index.ts', import.meta.url), 'utf8');
  const sync = isolatedFunction(source, 'syncCloseReviewProjection', { asObject: object, resolveOpeningPublicationIdentity });
  const readChange = isolatedFunction(source, 'readChange');
  assert.equal(readChange({ change_percent: null }), null); assert.equal(readChange({ change_percent: 0 }), 0);
  const f = openingFixture(), opening = validateOpeningPublication(f);
  const durable = evaluateClosingContract({ opening, closingSnapshot: durableClosingFixture(), now });
  let saved = { ...f.report, updated_at: `${date}T14:31:01+08:00`, ai_strategy_json: { ...f.report.ai_strategy_json, closing_contract: durable } };
  let casRace = false, writes = 0;
  const db = { from(table) { assert.equal(table, 'reports'); let update = null;
    const q = { select() { return q; }, eq() { return q; }, is() { return q; }, update(value) { update = value; return q; },
      async maybeSingle() { if (!update) return { data: saved, error: null };
        if (casRace) return { data: null, error: null };
        writes++; saved = { ...saved, ...update }; return { data: { id: saved.id }, error: null }; } }; return q;
  } };
  const review = { report_date: date, opening_publication_revision_id: 'opening-1', generated_at: `${date}T14:32:00+08:00` };
  const validation = { opening_publication_revision_id: 'opening-1' };
  await sync(db, opening, review, validation);
  assert.deepEqual(saved.ai_strategy_json.closing_contract, durable);
  casRace = true;
  await assert.rejects(sync(db, opening, review, validation), /CLOSE_REVIEW_PROJECTION_RETRY_REQUIRED/);
  assert.equal(writes, 1);
  await assert.rejects(sync(db, opening, { ...review, opening_publication_revision_id: 'qa-99' }, validation), /CLOSE_REVIEW_PROJECTION_UNVERIFIED/);
  assert.equal(writes, 1);
  assert.equal((source.match(/await syncCloseReviewProjection\(/g) || []).length, 2, 'new and persisted-review retry both sync safely');
});
