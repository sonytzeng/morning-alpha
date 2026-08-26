import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeliveryIncidentLineMessage,
  classifyDeliveryIncident,
} from '../supabase/functions/_shared/line-incident-message.ts';

test('content gate failures are not mislabeled as provider data delays', () => {
  const reasons = [
    'member_research_value_sentence_low_quality',
    'decision_snapshot_not_publishable',
  ];
  assert.equal(classifyDeliveryIncident(reasons), 'content');
  const message = buildDeliveryIncidentLineMessage('https://morningalphatw.com', reasons);
  assert.match(message.text, /內容品質驗收未通過/u);
  assert.match(message.text, /不是資料供應商延遲/u);
  assert.doesNotMatch(message.text, /盤前資料延遲/u);
});

test('provider freshness failures retain the data-delay incident copy', () => {
  const reasons = ['stale_market_data:TXF'];
  assert.equal(classifyDeliveryIncident(reasons), 'data');
  assert.match(
    buildDeliveryIncidentLineMessage('https://morningalphatw.com/', reasons).text,
    /盤前資料延遲/u,
  );
});

test('unknown failures use a system incident instead of claiming missing data', () => {
  assert.equal(classifyDeliveryIncident(['action_failed:generate']), 'system');
  assert.match(
    buildDeliveryIncidentLineMessage('https://morningalphatw.com', ['action_failed:generate']).text,
    /盤前流程異常/u,
  );
});
