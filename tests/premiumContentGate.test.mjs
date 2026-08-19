import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';

function validAi() {
  return {
    content_publish_gate: { overall_status: '可公開', blocking_issues: [] },
    member_value_score: 96,
    v10_data_quality_status: 'sufficient',
    today_beneficiary_stocks_v10: [{
      symbol: '2330',
      name: '台積電',
      trigger_event: 'NVIDIA 公布最新財測並帶動 AI 晶片需求預期',
      transmission_logic: 'NVIDIA 資本支出上修，帶動先進製程與先進封裝需求，再傳導至台灣半導體供應鏈。',
      taiwan_supply_chain_link: '台積電提供 NVIDIA GPU 所需先進製程與 CoWoS 先進封裝產能。',
      validation_signal: '09:30 觀察台積電是否相對加權指數強勢，且半導體成交比重同步上升。',
      invalidation_condition: '台積電轉弱且半導體族群未同步，或事件來源遭公司更新否定。',
      data_basis: 'market_news.NVIDIA guidance；market_data.NVDA.change_percent；market_data.TSM.change_percent',
    }],
  };
}

test('premium content is eligible only with fresh news and complete stock reasoning', () => {
  const result = evaluatePremiumContentGate(validAi(), 2);
  assert.equal(result.eligible, true);
  assert.equal(result.status, 'eligible');
  assert.equal(result.complete_recommendation_count, 1);
});
test('premium content fails closed when news is missing', () => {
  const result = evaluatePremiumContentGate(validAi(), 0);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('fresh_news_evidence_missing'));
});

test('every recommended stock must include source, transmission, Taiwan relationship and conditions', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10[0].taiwan_supply_chain_link = '';
  const result = evaluatePremiumContentGate(ai, 2);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('recommendation_reasoning_incomplete'));
});
