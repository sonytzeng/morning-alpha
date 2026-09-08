import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriberState, parseSubscriberState, resolveSubscriberState, SUBSCRIBER_STATE_SCHEMA_VERSION } from '../shared/subscriber-state-contract.ts';

// Synthetic contract fixtures: never submitted to Production or counted as evidence.
const day = '2026-09-08', revision = 'synthetic-published-revision';
const input = (patch = {}) => ({ report_date: day, revision_id: revision,
  generated_at: `${day}T00:30:00Z`, publicationVerified: true, marketEvidenceReady: true,
  analysisStatus: 'READY', isTradingDay: true, confidenceValue: 73,
  recommendationGate: { status: 'BLOCKED', eligible: false }, closing: null,
  now: `${day}T07:30:00Z`, ...patch });
const close = (patch = {}) => ({ report_date: day, opening_decision_snapshot_id: revision,
  verified_at: `${day}T06:30:00Z`, status: 'completed', data_status: 'complete',
  actual_taiex_change: 1.2, actual_2330_close: { change_percent: 1.5 }, actual_txf_close: { change_percent: 1.3 },
  prediction_result: 'hit', missing_data: [], ...patch });

test('READY + explicit publication yields the versioned current market state independently of recommendation', () => {
  const state = createSubscriberState(input());
  assert.equal(state.schema_version, SUBSCRIBER_STATE_SCHEMA_VERSION);
  assert.equal(state.publication, 'PUBLISHED'); assert.equal(state.analysis, 'READY');
  assert.equal(state.recommendation, 'BLOCKED'); assert.equal(state.closing, 'PENDING');
  assert.deepEqual(state.confidence, { status: 'AVAILABLE', value: 73 });
  assert.deepEqual(parseSubscriberState(state), state);
});

test('PARTIAL is not FAILED, INVALIDATED or CLOSING_COMPLETE even when QA has STOP and score 100', () => {
  const state = createSubscriberState(input({ publicationVerified: false, analysisStatus: 'PARTIAL', confidenceValue: 100, closing: close() }));
  assert.equal(state.analysis, 'PARTIAL'); assert.equal(state.publication, 'UNPUBLISHED');
  assert.equal(state.closing, 'INSUFFICIENT_EVIDENCE'); assert.equal(state.recommendation, 'BLOCKED');
  assert.deepEqual(state.confidence, { status: 'UNAVAILABLE', value: null });
  assert.equal(state.report_date, day); assert.equal(state.revision_id, revision);
  assert.deepEqual(parseSubscriberState(state), state);
});

test('READY without publication proof stays current-date unavailable; unpublished never means stale previous day', () => {
  for (const patch of [{ publicationVerified: false }, { revision_id: null }, { generated_at: null }, { generated_at: '2026-09-08T08:30:00' }]) {
    const state = createSubscriberState(input(patch));
    assert.equal(state.publication, 'UNPUBLISHED'); assert.equal(state.analysis, 'INSUFFICIENT_EVIDENCE');
    assert.equal(state.report_date, day); assert.equal(state.confidence.value, null);
  }
});

test('missing or insufficient confidence never becomes 100; a real finite 0 remains 0', () => {
  for (const confidenceValue of [undefined, null, '', ' ', 'NaN', NaN, Infinity, -1, 101, {}, true]) {
    const state = createSubscriberState(input({ confidenceValue }));
    assert.equal(state.confidence.status, 'UNAVAILABLE', String(confidenceValue));
    assert.equal(state.confidence.value, null);
  }
  assert.equal(createSubscriberState(input({ confidenceValue: 0 })).confidence.value, 0);
  assert.equal(createSubscriberState(input({ confidenceValue: '73' })).confidence.value, 73);
  const insufficient = createSubscriberState(input({ marketEvidenceReady: false, confidenceValue: 100 }));
  assert.equal(insufficient.analysis, 'INSUFFICIENT_EVIDENCE'); assert.equal(insufficient.confidence.value, null);
});

test('Closing NOT_DUE cannot be promoted by browser time, lifecycle completion or a prefilled outcome', () => {
  for (const closing of [null, close(), close({ status: 'NOT_DUE' })]) {
    const state = createSubscriberState(input({ now: `${day}T02:00:00Z`, closing }));
    assert.equal(state.closing, 'NOT_DUE');
  }
  assert.equal(createSubscriberState(input({ closing: close({ status: 'NOT_DUE' }) })).closing, 'NOT_DUE');
  assert.equal(createSubscriberState(input({ isTradingDay: false, closing: close() })).closing, 'NOT_APPLICABLE');
});

test('Closing COMPLETE requires real three-core evidence bound to the published opening revision', () => {
  assert.equal(createSubscriberState(input({ closing: close() })).closing, 'COMPLETE');
  for (const patch of [
    { report_date: '2026-09-07' }, { opening_decision_snapshot_id: 'synthetic-other-revision' },
    { opening_decision_snapshot_id: null }, { verified_at: null }, { verified_at: `${day}T08:00:00Z` },
    { verified_at: `${day}T02:00:00Z` }, { verified_at: '2026-09-07T06:30:00Z' },
    { status: 'direction_completed_data_degraded' }, { data_status: 'degraded' },
    { actual_taiex_change: null }, { actual_2330_close: {} }, { actual_txf_close: { change_percent: null } },
    { missing_data: ['TXF'] }, { missing_data: undefined }, { prediction_result: 'unknown' },
  ]) assert.equal(createSubscriberState(input({ closing: close(patch) })).closing, 'INSUFFICIENT_EVIDENCE', JSON.stringify(patch));
});

test('recommendation BLOCKED does not block market; no-qualified requires a complete non-empty universe', () => {
  for (const screening of [{}, { status: 'COMPLETE', universe_count: 0, evaluated_count: 0, rejected: [] },
    { status: 'COMPLETE', universe_count: 3, evaluated_count: 2, rejected: [] },
    { status: 'COMPLETE', universe_count: 3, evaluated_count: 3, rejected: ['missing'] }]) {
    const state = createSubscriberState(input({ recommendationGate: { status: 'NO_QUALIFIED_OPPORTUNITY', universe_evaluation_complete: true, screening } }));
    assert.equal(state.analysis, 'READY'); assert.equal(state.recommendation, 'BLOCKED');
  }
  assert.equal(createSubscriberState(input({ recommendationGate: { status: 'NO_QUALIFIED_OPPORTUNITY', universe_evaluation_complete: true,
    screening: { status: 'COMPLETE', universe_count: 3, evaluated_count: 3, rejected: [] } } })).recommendation, 'NO_QUALIFIED_OPPORTUNITY');
  assert.equal(createSubscriberState(input({ recommendationGate: { status: 'QUALIFIED', eligible: true } })).recommendation, 'QUALIFIED');
});

test('unknown schema versions, mixed identities and contradictory wire enums are rejected without legacy fallback', () => {
  const state = createSubscriberState(input());
  for (const patch of [{ schema_version: 'future-v2' }, { schema_version: null }, { report_date: '2026-02-30' },
    { analysis: 'FAILED' }, { closing: 'INVALIDATED' }, { publication: 'published' },
    { publication: 'UNPUBLISHED' }, { confidence: { status: 'AVAILABLE', value: null } },
    { confidence: { status: 'UNAVAILABLE', value: 100 } }]) assert.equal(parseSubscriberState({ ...state, ...patch }), null, JSON.stringify(patch));
  for (const identity of [{ report_date: '2026-09-07' }, { revision_id: 'other' }, { generated_at: `${day}T01:30:00Z` }]) {
    assert.equal(parseSubscriberState(state, identity), null);
    assert.equal(resolveSubscriberState({ ...identity, subscriber_state: state }), null);
  }
  assert.equal(resolveSubscriberState({ report_date: day, revision_id: revision, generated_at: state.generated_at, subscriber_state: state }), state);
});
