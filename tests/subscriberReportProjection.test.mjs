import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportProjection.ts';
import { subscriberProjectionFixture, subscriberFixtureEnvelope, PROJECTION_SCENARIOS, INCOMPLETE, RECOMMENDATION_BLOCKED } from './fixtures/subscriber-projection-v1.mjs';

const TODAY = '2026-09-09';
const projection = (value, options = {}) => getSubscriberReportProjection(value, { todayDate: TODAY, ...options });

for (const name of PROJECTION_SCENARIOS) test(`subscriber projection matrix: ${name}`, () => {
  const value = subscriberProjectionFixture(name, { todayDate: TODAY }), result = projection(value);
  assert.equal(result.identity.reportDate, value.report_date); assert.equal(result.identity.revisionId, value.revision_id);
  assert.equal(result.identity.generatedAt, value.generated_at); assert.equal(result.identity.todayDate, TODAY);
  assert.equal(result.closing.complete, name === 'CLOSING_COMPLETE', 'Only the explicitly complete matching receipt can provide closing results');
  if (name === 'CLOSING_COMPLETE') {
    assert.equal(result.closing.outcome, 'hit');
    assert.equal(result.closing.result.opening_decision_snapshot_id, value.revision_id);
  } else assert.equal(result.closing.result, null, 'NOT_DUE cannot borrow a completed legacy alias or checkpoint');
  if (['PARTIAL', 'BLOCKED', 'FAILED', 'INVALIDATED'].includes(name)) {
    assert.equal(result.analysisAvailable, false); assert.equal(result.confidence.value, null);
    assert.equal(result.confidence.suppressed, true); assert.equal(result.recommendation.available, false);
    assert.deepEqual(result.recommendation.items, []);
    assert.doesNotMatch(JSON.stringify(result), /100\s*\/\s*100|收盤驗證已完成/);
  } else if (name === 'MISSING_CONFIDENCE') {
    assert.equal(result.analysisAvailable, true); assert.equal(result.confidence.value, null);
    assert.equal(result.confidence.suppressed, true);
  } else if (name === 'STALE') {
    assert.notEqual(result.identity.reportDate, TODAY); assert.equal(result.recommendation.available, false);
    assert.deepEqual(result.recommendation.items, []); assert.match(result.statusLabel, /歷史|舊|先前/);
  } else if (name === 'RUNTIME_INVALIDATED') {
    assert.equal(result.analysisAvailable, true); assert.equal(result.displayStatus, 'INVALIDATED');
    assert.equal(result.marketDecision.action, 'STOP'); assert.equal(result.marketDecision.runtimeFailure, true);
    assert.match(result.statusLabel, /驗證.*失效/);
  } else {
    assert.equal(result.analysisAvailable, true); assert.equal(result.confidence.value, 73);
    assert.equal(result.marketDecision.action, 'WAIT'); assert.match(result.marketDecision.summary, /成交量增加5%/);
  }
  if (name === 'PARTIAL') {
    assert.equal(result.displayStatus, 'PARTIAL'); assert.match(result.title, /尚未完成|证據|證據/);
    assert.doesNotMatch(result.statusLabel + result.title, /失效|失敗|收盤完成/);
  }
  if (name === 'MARKET_READY_RECOMMENDATION_BLOCKED') {
    assert.equal(result.analysisAvailable, true); assert.equal(result.recommendation.available, false);
    assert.deepEqual(result.recommendation.items, []); assert.equal(result.recommendation.message, RECOMMENDATION_BLOCKED);
  }
});

test('captured legacy Production Payload44 PARTIAL/STOP/100 never becomes an invalidated subscriber report', () => {
  const captured = JSON.parse(readFileSync(new URL('./fixtures/subscriber-projection-legacy-payload44.json', import.meta.url), 'utf8'));
  assert.equal(captured.provenance.version, 44);
  assert.equal(captured.response.payload.canonical_decision.status, 'PARTIAL');
  assert.equal(captured.response.payload.canonical_decision.confidence_score, 100);
  const p = projection(captured.response, { todayDate: '2026-09-08' });
  assert.equal(p.identity.reportDate, '2026-09-08'); assert.equal(p.identity.revisionId, captured.response.revision_id);
  assert.equal(p.displayStatus, 'PARTIAL'); assert.equal(p.analysisAvailable, false);
  assert.equal(p.confidence.value, null); assert.equal(p.confidence.suppressed, true);
  assert.equal(p.recommendation.available, false); assert.deepEqual(p.recommendation.items, []);
  assert.equal(p.closing.complete, false);
  assert.doesNotMatch(JSON.stringify(p), /100\s*\/\s*100|條件失效|收盤驗證已完成/);
});

test('all subscriber input shapes produce identical identity and safe decision semantics', () => {
  const value = subscriberProjectionFixture('PARTIAL'), unchanged = JSON.stringify(value);
  const shapes = [value, { report_date: value.report_date, ai_strategy_json: value },
    subscriberFixtureEnvelope(value, { tier: 'free', authenticated: false, today_date: TODAY })];
  for (const input of shapes) {
    const p = projection(input);
    assert.equal(p.identity.reportDate, TODAY); assert.equal(p.identity.revisionId, value.revision_id);
    assert.equal(p.identity.generatedAt, value.generated_at); assert.equal(p.analysisAvailable, false);
    assert.equal(p.confidence.value, null); assert.equal(p.closing.complete, false);
  }
  assert.equal(JSON.stringify(value), unchanged, 'Projection never mutates input data');
  for (const name of ['BLOCKED', 'FAILED', 'INVALIDATED']) {
    const legacyEnvelope = subscriberFixtureEnvelope(subscriberProjectionFixture(name), { tier: 'free', authenticated: true, today_date: TODAY });
    assert.equal(Object.hasOwn(legacyEnvelope, 'subscriber_state'), false, 'Legacy wire fields must remain absent, not undefined');
    assert.deepEqual(projection(legacyEnvelope), projection(JSON.parse(JSON.stringify(legacyEnvelope))));
  }
});

test('forged client tier cannot create stock items removed by the real server projection', () => {
  const value = subscriberProjectionFixture('READY');
  const free = subscriberFixtureEnvelope(value, { tier: 'free', authenticated: false, today_date: TODAY });
  for (const clientClaims of [{ tier: 'admin' }, { tier: 'vip', user_metadata: { role: 'admin' } }, { role: 'owner' }]) {
    const p = projection({ ...free, ...clientClaims });
    assert.deepEqual(p.recommendation.items, []);
  }
  for (const tier of ['member', 'admin']) {
    const p = projection(subscriberFixtureEnvelope(value, { tier, authenticated: true, today_date: TODAY }));
    assert.equal(p.recommendation.items[0]?.symbol, '2330');
  }
});

test('unbound assessment prose is removed without deleting real price, volume, MA or yield facts', () => {
  const value = subscriberProjectionFixture('MISSING_CONFIDENCE');
  value.canonical_decision.daily_sentence = '成交量增加5%；綜合評分 100/100；股價100元；台股站回100日均線；殖利率5%';
  value.daily_sentence = value.canonical_decision.daily_sentence;
  const p = projection(value);
  assert.equal(p.confidence.value, null);
  assert.doesNotMatch(p.marketDecision.summary, /100\s*\/\s*100/);
  for (const fact of ['成交量增加5%', '股價100元', '100日均線', '殖利率5%']) assert.ok(p.marketDecision.summary.includes(fact));
});

test('explicit history may be read as history but never relabeled as a fresh recommendation', () => {
  const value = subscriberProjectionFixture('STALE'), p = projection(value, { historical: true });
  assert.equal(p.historical, true); assert.equal(p.identity.reportDate, value.report_date);
  assert.equal(p.recommendation.available, false); assert.deepEqual(p.recommendation.items, []);
  assert.notEqual(p.identity.reportDate, p.identity.todayDate);
});

test('a missing payload remains incomplete, never a confidence or recommendation default', () => {
  for (const value of [null, undefined, {}, { payload: null }, { payload: { confidence_score: 100 } }]) {
    const p = projection(value);
    assert.equal(p.analysisAvailable, false); assert.equal(p.confidence.value, null);
    assert.equal(p.recommendation.available, false); assert.deepEqual(p.recommendation.items, []);
    assert.equal(p.closing.complete, false); assert.notEqual(p.title, '條件失效');
  }
  assert.equal(INCOMPLETE, '今日分析尚未完成／證據不足');
});

test('legacy published confidence is canonical-only: absent/null rejects raw 100, real zero remains zero', () => {
  const value = subscriberProjectionFixture('READY');
  delete value.subscriber_state;
  value.confidence_score = 100;
  for (const missing of [null, undefined, '', 'not-a-number']) {
    value.canonical_decision.confidence_score = missing;
    const p = projection(value);
    assert.equal(p.analysisAvailable, true); assert.equal(p.confidence.value, null);
    assert.equal(p.confidence.suppressed, true);
  }
  value.canonical_decision.confidence_score = 0;
  assert.equal(projection(value).confidence.value, 0);
  value.canonical_decision.confidence_score = 73;
  assert.equal(projection(value).confidence.value, 73);
});

test('a real same-revision complete closing receipt remains readable; detached or mixed receipts do not', () => {
  const value = subscriberProjectionFixture('READY');
  const receipt = value.closing_verification;
  value.subscriber_state.closing = 'COMPLETE'; value.closing_verification_v2 = receipt;
  const complete = projection(value);
  assert.equal(complete.closing.complete, true); assert.equal(complete.closing.outcome, 'hit');
  assert.equal(complete.closing.result.opening_decision_snapshot_id, value.revision_id);
  for (const change of [{ report_date: '2026-09-08' }, { opening_decision_snapshot_id: 'different-revision' },
    { actual_txf_close: { change_percent: null } }, { missing_data: ['TXF'] }, { data_status: 'insufficient' }, { status: 'NOT_DUE' }]) {
    const p = projection({ ...value, closing_verification_v2: { ...receipt, ...change } });
    assert.equal(p.closing.complete, false); assert.equal(p.closing.result, null);
  }
});

test('published same-revision runtime failure remains invalidated; detached failure claims cannot promote state', () => {
  const value = subscriberProjectionFixture('READY');
  const failure = { status: 'FAILED', report_date: value.report_date, revision_id: value.revision_id,
    failed_at: `${TODAY}T10:30:00+08:00`, evidence: { checkpoint: '1030', condition: 'synthetic runtime failure' } };
  value.intraday_sync_status.windows['1030'] = failure;
  const positive = projection(value);
  assert.equal(positive.analysisAvailable, true); assert.equal(positive.displayStatus, 'INVALIDATED');
  assert.equal(positive.marketDecision.runtimeFailure, true); assert.equal(positive.marketDecision.action, 'STOP');
  for (const change of [{ revision_id: 'another-revision' }, { report_date: '2026-09-08' },
    { failed_at: null }, { failed_at: `${TODAY}T06:00:00+08:00` }, { evidence: {} }, { status: '文字描述失效' }]) {
    const candidate = globalThis.structuredClone(value);
    candidate.intraday_sync_status.windows['1030'] = { ...failure, ...change };
    const p = projection(candidate);
    assert.equal(p.displayStatus, 'READY'); assert.equal(p.marketDecision.runtimeFailure, false);
    assert.equal(p.marketDecision.action, 'WAIT');
  }
  const unpublished = subscriberProjectionFixture('PARTIAL');
  unpublished.intraday_sync_status.windows['1030'] = { ...failure, revision_id: unpublished.revision_id };
  assert.equal(projection(unpublished).displayStatus, 'PARTIAL');
  assert.equal(projection(unpublished).marketDecision.runtimeFailure, false);
});

test('subscriber checkpoint proof preserves genuine same-revision intraday completion', () => {
  const value = subscriberProjectionFixture('READY');
  value.canonical_decision.action = 'ACT';
  value.intraday_sync_status.windows['1030'] = { status: 'completed', report_date: TODAY,
    revision_id: value.revision_id, completed_at: `${TODAY}T10:31:00+08:00`, evidence: { source: 'SYNTHETIC_LOCAL_CHECKPOINT' } };
  const result = projection(value);
  assert.deepEqual(result.runtime.checkpoints['1030'], {
    status: 'completed', evidenceVerified: true, observedAt: `${TODAY}T10:31:00+08:00`,
  });
  assert.equal(result.runtime.confirmedIntradayEvidence, true);
  assert.equal(result.runtime.newIntradayEvidence, true);
  assert.equal(result.marketDecision.action, 'ACT');
});

test('wrong date, wrong revision, invalid time or incomplete checkpoint proof cannot upgrade subscriber evidence', () => {
  const value = subscriberProjectionFixture('READY');
  value.canonical_decision.action = 'ACT';
  const valid = { status: 'completed', report_date: TODAY, revision_id: value.revision_id,
    completed_at: `${TODAY}T10:31:00+08:00`, evidence: { source: 'SYNTHETIC_LOCAL_CHECKPOINT' } };
  for (const change of [{ report_date: '2026-09-08' }, { revision_id: 'wrong-revision' }, { revision_id: null },
    { completed_at: null }, { completed_at: 'invalid' }, { completed_at: `${TODAY}T06:00:00+08:00` },
    { completed_at: '2026-09-10T10:31:00+08:00' }, { completed_at: '2026-09-08T10:31:00+08:00' },
    { evidence: {} }, { evidence: [] }, { evidence: [null] }, { evidence: [{}] }, { evidence: ['not a receipt'] },
    { evidence: null }, { evidence: true }, { completed_at: `${TODAY}T09:31:00+08:00` }]) {
    value.intraday_sync_status.windows['1030'] = { ...valid, ...change };
    const result = projection(value);
    assert.equal(result.runtime.checkpoints['1030'].status, 'insufficient', JSON.stringify(change));
    assert.equal(result.runtime.checkpoints['1030'].evidenceVerified, false);
    assert.equal(result.runtime.confirmedIntradayEvidence, false);
    assert.equal(result.runtime.newIntradayEvidence, false);
    assert.equal(result.marketDecision.action, 'ACT', 'Insufficient checkpoint evidence does not invent a new market decision');
  }
  value.intraday_sync_status.windows['1030'] = valid;
  for (const change of [{ report_date: '2026-09-08' }, { revision_id: 'wrong-parent' }]) {
    const result = projection({ ...value, intraday_sync_status: { ...value.intraday_sync_status, ...change } });
    assert.equal(result.runtime.checkpoints['1030'].status, 'insufficient');
  }
});

test('raw complete labels, aggregate lifecycle and opening quotes cannot supply missing checkpoint receipts', () => {
  const value = subscriberProjectionFixture('READY');
  value.opening_radar = { report_date: TODAY, taiex_change: 1, txf_change: 1, tsmc_change: 1 };
  value.intraday_sync_status.windows['0900'] = 'completed';
  value.intraday_sync_status.windows['1030'] = { status: 'completed' };
  const result = projection(value);
  assert.notEqual(result.runtime.checkpoints['0900'].status, 'completed');
  assert.equal(result.runtime.checkpoints['1030'].status, 'insufficient');
  assert.equal(result.runtime.checkpoints['1430'].status, 'pending', 'NOT_DUE beats a captured close checkpoint');
  assert.equal(result.runtime.confirmedIntradayEvidence, false);
  assert.equal(result.runtime.newIntradayEvidence, false);
});

test('checkpoint projection preserves genuine failure, partial and non-trading semantics', () => {
  const failed = projection(subscriberProjectionFixture('RUNTIME_INVALIDATED'));
  assert.equal(failed.runtime.checkpoints['1030'].status, 'failed');
  assert.equal(failed.runtime.checkpoints['1030'].evidenceVerified, true);
  const partial = projection(subscriberProjectionFixture('PARTIAL'));
  assert.ok(Object.values(partial.runtime.checkpoints).every(checkpoint => checkpoint.status === 'insufficient'));
  const holiday = subscriberProjectionFixture('READY'); holiday.is_trading_day = false;
  const closed = projection(holiday);
  assert.ok(Object.values(closed.runtime.checkpoints).every(checkpoint => checkpoint.status === 'not_applicable'));
  assert.equal(closed.runtime.confirmedIntradayEvidence, false);
  assert.equal(closed.runtime.newIntradayEvidence, false);
  const complete = projection(subscriberProjectionFixture('CLOSING_COMPLETE'));
  assert.equal(complete.runtime.checkpoints['1430'].status, 'completed');
  assert.equal(complete.runtime.checkpoints['1430'].observedAt, `${TODAY}T14:30:00+08:00`);
});
