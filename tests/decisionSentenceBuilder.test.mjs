import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNoTradeDecisionCopy,
  buildRecommendationDecisionCopy,
  normalizeDecisionCondition,
} from '../supabase/functions/_shared/decision-sentence-builder.ts';
import { evaluateDecisionSentenceValue } from '../supabase/functions/_shared/content-intelligence.ts';

test('recommendation sentence removes duplicate conditional words and never truncates the invalidation clause', () => {
  const result = buildRecommendationDecisionCopy({
    trigger: 'NVDA',
    industry: 'AI Server',
    name: '英業達',
    invalidation: '若 2356 弱於 TAIEX、AI Server 沒有量價同步，或事件來源更新後不再支持原假設，今日受惠判斷失效。',
  });

  assert.doesNotMatch(result.sentence, /若若|不再支[，。；]/u);
  assert.match(result.sentence, /若 2356 弱於 TAIEX、AI Server 沒有量價同步/u);
  assert.match(result.sentence, /今日不追價並撤回受惠假設/u);
  assert.equal(evaluateDecisionSentenceValue(result.sentence).eligible, true);
  assert.equal(evaluateDecisionSentenceValue(result.subscriber_sentence).eligible, true);
});

test('no-trade sentence remains a complete paid decision when positive evidence is insufficient', () => {
  const result = buildNoTradeDecisionCopy({
    sourceDetail: '隔夜市場訊號',
    industry: '半導體',
    name: '台積電',
    stopCondition: '如果台積電與半導體族群沒有同步止跌，停止觀察。',
  });

  assert.doesNotMatch(result.sentence, /若如果|如果如果/u);
  assert.match(result.sentence, /09:30/u);
  assert.match(result.sentence, /今日不建立受惠股/u);
  assert.equal(evaluateDecisionSentenceValue(result.sentence).eligible, true);
});

test('decision condition normalization keeps the first complete observable clause', () => {
  assert.equal(
    normalizeDecisionCondition('若 2330 弱於 TAIEX，今日受惠判斷失效。', '條件未成立'),
    '2330 弱於 TAIEX',
  );
});
