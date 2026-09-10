import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriberState, getSubscriberReportProjection, hasMatchingSubscriberClosingReceipt } from '../src/lib/subscriberReportContract.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';

// Isolated wire fixtures only: never submitted to a database or used as outcomes.
const day = '2026-09-09';
const opening = 'synthetic-frozen-opening';
const current = 'synthetic-later-publication';
const generated = `${day}T15:00:00+08:00`;
const publication = (patch = {}) => ({ schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED',
  report_date: day, revision_id: current, opening_publication_revision_id: opening, ...patch });
const receipt = (patch = {}) => ({ report_date: day, opening_decision_snapshot_id: opening,
  status: 'completed', data_status: 'complete', verified_at: `${day}T14:30:00+08:00`,
  actual_taiex_change: 1.2, actual_2330_close: { change_percent: 1.5 }, actual_txf_close: { change_percent: 1.3 },
  prediction_result: 'hit', missing_data: [], ...patch });
const input = (patch = {}) => ({ report_date: day, revision_id: current, generated_at: generated,
  publicationVerified: true, marketEvidenceReady: true, analysisStatus: 'READY', isTradingDay: true,
  confidenceValue: 73, recommendationGate: { status: 'BLOCKED', eligible: false },
  marketPublicationContract: publication(), closing: receipt(), now: `${day}T15:30:00+08:00`, ...patch });
function payload(values = input()) {
  const row = subscriberProjectionFixture('CLOSING_COMPLETE', { todayDate: day });
  return { ...row, report_date: values.report_date, revision_id: values.revision_id, generated_at: values.generated_at,
    canonical_decision: { ...row.canonical_decision, id: values.revision_id },
    subscriber_state: createSubscriberState(values), market_publication_contract: values.marketPublicationContract,
    closing_verification_v2: values.closing };
}

test('verified newer publication retains the frozen opening close even when generated after that close', () => {
  const values = input(), row = payload(values), before = JSON.stringify(row);
  assert.equal(createSubscriberState(values).closing, 'COMPLETE');
  assert.equal(hasMatchingSubscriberClosingReceipt(values.closing, values), true);
  for (const shape of [row, { ...row, payload: row }, { report_date: day, ai_strategy_json: row }]) {
    const projection = getSubscriberReportProjection(shape, { todayDate: day });
    assert.equal(projection.identity.revisionId, current);
    assert.equal(projection.analysisAvailable, true);
    assert.equal(projection.closing.state, 'COMPLETE');
    assert.equal(projection.closing.result.opening_decision_snapshot_id, opening);
    assert.equal(projection.runtime.checkpoints['1430'].status, 'completed');
  }
  assert.equal(JSON.stringify(row), before, 'Read interpretation must not rewrite opening evidence');
});

for (const [name, contract] of [
  ['wrong current revision', publication({ revision_id: 'synthetic-other-current' })],
  ['stale date', publication({ report_date: '2026-09-08' })],
  ['wrong schema', publication({ schema_version: 'CORE_MARKET_PUBLICATION_V2' })],
  ['unpublished status', publication({ status: 'READY' })],
  ['missing opening', publication({ opening_publication_revision_id: undefined })],
  ['wrong opening', publication({ opening_publication_revision_id: 'synthetic-other-opening' })],
  ['null contract', null],
  ['missing contract', undefined],
]) test(`frozen opening cannot use an unbound publication contract: ${name}`, () => {
  const values = input({ marketPublicationContract: contract });
  assert.equal(createSubscriberState(values).closing, 'INSUFFICIENT_EVIDENCE');
  // A stale COMPLETE alias cannot hide a malformed/missing pointer contract.
  const row = payload(values); row.subscriber_state.closing = 'COMPLETE';
  assert.equal(getSubscriberReportProjection(row).closing.state, 'INSUFFICIENT_EVIDENCE');
});

test('raw READY/eligible aliases cannot authorize a frozen pointer without a versioned published wire state', () => {
  const row = payload(); delete row.subscriber_state;
  assert.equal(getSubscriberReportProjection(row).analysisAvailable, true, 'Legacy market availability is unchanged');
  assert.equal(getSubscriberReportProjection(row).closing.state, 'INSUFFICIENT_EVIDENCE');
  assert.equal(hasMatchingSubscriberClosingReceipt(receipt(), input({ publicationVerified: false })), false);
});

for (const [name, patch] of [
  ['current PARTIAL state', { analysisStatus: 'PARTIAL' }],
  ['unverified publication', { publicationVerified: false }],
  ['insufficient market evidence', { marketEvidenceReady: false }],
]) test(`current publication remains a prerequisite: ${name}`, () => {
  const values = input(patch), row = payload(values);
  assert.equal(row.subscriber_state.publication, 'UNPUBLISHED');
  assert.notEqual(row.subscriber_state.closing, 'COMPLETE');
  assert.equal(getSubscriberReportProjection(row).analysisAvailable, false);
  assert.equal(getSubscriberReportProjection(row).closing.state, 'INSUFFICIENT_EVIDENCE');
});

test('frozen opening still requires the indivisible real same-day closing receipt', () => {
  for (const patch of [
    { opening_decision_snapshot_id: current }, { opening_decision_snapshot_id: null },
    { report_date: '2026-09-08' }, { verified_at: '2026-09-08T14:30:00+08:00' },
    { verified_at: `${day}T14:09:59+08:00` }, { verified_at: `${day}T14:30:00` },
    { actual_taiex_change: null }, { actual_2330_close: {} }, { actual_txf_close: { change_percent: null } },
    { missing_data: ['TXF'] }, { missing_data: undefined }, { prediction_result: 'unknown' },
    { status: 'direction_completed_data_degraded' }, { data_status: 'degraded' },
  ]) {
    const values = input({ closing: receipt(patch) }), row = payload(values);
    assert.equal(row.subscriber_state.closing, 'INSUFFICIENT_EVIDENCE', JSON.stringify(patch));
    row.subscriber_state.closing = 'COMPLETE';
    assert.equal(getSubscriberReportProjection(row).closing.state, 'INSUFFICIENT_EVIDENCE', JSON.stringify(patch));
  }
});

test('server future-time, NOT_DUE and non-trading guards survive the frozen pointer', () => {
  assert.equal(createSubscriberState(input({ closing: receipt({ verified_at: `${day}T15:31:00+08:00` }) })).closing, 'INSUFFICIENT_EVIDENCE');
  assert.equal(createSubscriberState(input({ generated_at: `${day}T15:31:00+08:00` })).closing, 'INSUFFICIENT_EVIDENCE');
  for (const generated_at of [null, '', `${day}T15:00:00`]) {
    assert.equal(createSubscriberState(input({ generated_at })).closing, 'INSUFFICIENT_EVIDENCE');
  }
  assert.equal(createSubscriberState(input({ now: `${day}T10:00:00+08:00` })).closing, 'NOT_DUE');
  assert.equal(createSubscriberState(input({ closing: receipt({ status: 'NOT_DUE' }) })).closing, 'NOT_DUE');
  assert.equal(createSubscriberState(input({ isTradingDay: false })).closing, 'NOT_APPLICABLE');
});

test('absent contract retains the legacy exact-current-revision and generated-at checks', () => {
  const values = input({ revision_id: opening, marketPublicationContract: undefined, generated_at: `${day}T07:30:00+08:00` });
  assert.equal(createSubscriberState(values).closing, 'COMPLETE');
  assert.equal(getSubscriberReportProjection(payload(values)).closing.state, 'COMPLETE');
  assert.equal(createSubscriberState({ ...values, generated_at: generated }).closing, 'INSUFFICIENT_EVIDENCE');
  assert.equal(createSubscriberState({ ...values, generated_at: generated,
    marketPublicationContract: publication({ revision_id: opening }) }).closing, 'INSUFFICIENT_EVIDENCE',
  'Same-current opening cannot use the frozen-prior-publication timestamp exception');
});

test('verified closing projects its frozen opening values separately from the newer market decision', () => {
  const row = payload(input({ closing: receipt({ opening_bias: 'synthetic-opening-bearish', opening_confidence: 61 }) }));
  const projection = getSubscriberReportProjection(row);
  assert.equal(projection.marketDecision.bias, '偏多');
  assert.equal(projection.confidence.value, 73);
  assert.ok(projection.marketDecision.summary);
  assert.deepEqual(projection.closing.openingDecision, {
    revisionId: opening, bias: 'synthetic-opening-bearish', confidence: 61, summary: null,
  });
  const legacy = getSubscriberReportProjection(payload(input({
    closing: receipt({ predicted_bias: 'synthetic-legacy-opening', predicted_confidence: 0 }),
  })));
  assert.deepEqual(legacy.closing.openingDecision, {
    revisionId: opening, bias: 'synthetic-legacy-opening', confidence: 0, summary: null,
  });
});

test('missing frozen opening fields stay unknown and cannot borrow current or detached review metadata', () => {
  for (const opening_confidence of [undefined, null, '', ' ', NaN, Infinity, -1, 101]) {
    const row = payload(input({ closing: receipt({ opening_confidence, confidence_score: 100,
      premarket_summary: 'synthetic-detached-review-summary' }) }));
    row.close_market_review = { premarket_bias: 'synthetic-detached-bias', premarket_confidence: 99 };
    assert.deepEqual(getSubscriberReportProjection(row).closing.openingDecision, {
      revisionId: opening, bias: null, confidence: null, summary: null,
    }, String(opening_confidence));
  }
});

test('same-opening fallback uses only current projected values; unverified receipts expose no opening decision', () => {
  const values = input({ revision_id: opening, marketPublicationContract: undefined, generated_at: `${day}T07:30:00+08:00` });
  const projection = getSubscriberReportProjection(payload(values));
  assert.deepEqual(projection.closing.openingDecision, {
    revisionId: opening, bias: projection.marketDecision.bias,
    confidence: projection.confidence.value, summary: projection.marketDecision.summary,
  });
  for (const patch of [
    { closing: receipt({ opening_decision_snapshot_id: 'synthetic-wrong-opening' }) },
    { closing: receipt({ report_date: '2026-09-08' }) },
    { closing: receipt({ actual_txf_close: null }) },
    { closing: receipt({ status: 'NOT_DUE' }) }, { analysisStatus: 'PARTIAL' },
  ]) assert.equal(getSubscriberReportProjection(payload(input(patch))).closing.openingDecision, null);
});
