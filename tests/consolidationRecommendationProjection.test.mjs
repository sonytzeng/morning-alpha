import test from 'node:test';
import assert from 'node:assert/strict';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportContract.ts';
import { subscriberProjectionFixture, subscriberFixtureEnvelope, RECOMMENDATION_BLOCKED } from './fixtures/subscriber-projection-v1.mjs';

// Synthetic reader contracts, not evidence of publication or an entitlement.
const ready = () => subscriberProjectionFixture('READY');
const project = value => getSubscriberReportProjection(value, { todayDate: '2026-09-09' });

for (const [name, candidates] of [
  ['empty', []], ['null', null], ['undefined property', undefined],
  ['object', {}], ['string', '2330'],
]) {
  test(`explicit ${name} canonical recommendations cannot qualify or revive private aliases`, () => {
    const row = ready();
    const privateRows = structuredClone(row.today_beneficiary_stocks_v10);
    row.canonical_decision.recommendations = candidates;
    const result = project(row);
    assert.equal(result.analysisAvailable, true, 'A stock-list contradiction does not erase the market publication');
    assert.equal(result.confidence.value, 73);
    assert.equal(result.marketDecision.action, 'WAIT');
    assert.deepEqual(result.recommendation, { available: false, status: 'BLOCKED', message: RECOMMENDATION_BLOCKED, items: [] });
    assert.deepEqual(row.today_beneficiary_stocks_v10, privateRows, 'Private audit inputs remain unchanged');
    assert.notEqual(result.recommendation.status, 'NO_QUALIFIED_OPPORTUNITY');
  });
}

test('explicit empty legacy candidate list is not a completed qualifying assessment', () => {
  const row = ready();
  delete row.canonical_decision.recommendations;
  row.today_beneficiary_stocks_v10 = [];
  const result = project(row);
  assert.equal(result.analysisAvailable, true);
  assert.equal(result.recommendation.available, false);
  assert.equal(result.recommendation.status, 'BLOCKED');
  assert.deepEqual(result.recommendation.items, []);
});

test('real nonempty committed candidates are preserved by the shared projection', () => {
  const row = ready(), before = structuredClone(row);
  const result = project(row);
  assert.equal(result.recommendation.available, true);
  assert.equal(result.recommendation.status, 'QUALIFIED');
  assert.deepEqual(result.recommendation.items, row.canonical_decision.recommendations);
  assert.deepEqual(row, before);
});

test('legacy positive candidates remain supported only when the canonical field is absent', () => {
  const row = ready();
  delete row.canonical_decision.recommendations;
  const result = project(row);
  assert.equal(result.recommendation.available, true);
  assert.deepEqual(result.recommendation.items, row.today_beneficiary_stocks_v10);
});

test('server-trimmed Free omission does not manufacture a stock-evidence failure or expose stocks', () => {
  const row = ready();
  const envelope = subscriberFixtureEnvelope(row, { tier: 'free', authenticated: false,
    today_date: row.report_date, locked_sections: ['member_content'] });
  const result = project(envelope);
  assert.equal(Object.hasOwn(envelope.payload.canonical_decision, 'recommendations'), false);
  assert.equal(result.analysisAvailable, true);
  assert.equal(result.recommendation.status, 'QUALIFIED', 'Evidence status is not permission to view member data');
  assert.deepEqual(result.recommendation.items, []);
  assert.equal(envelope.tier, 'free');
  assert.equal(envelope.authenticated, false);
});

for (const scenario of ['PARTIAL', 'MARKET_READY_RECOMMENDATION_BLOCKED', 'STALE']) {
  test(`${scenario} never acquires a recommendation merely by having nonempty private candidates`, () => {
    const row = subscriberProjectionFixture(scenario);
    row.canonical_decision.recommendations = ready().canonical_decision.recommendations;
    const result = project(row);
    assert.equal(result.recommendation.available, false);
    assert.equal(result.recommendation.status, 'BLOCKED');
    assert.deepEqual(result.recommendation.items, []);
  });
}
