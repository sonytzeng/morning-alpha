import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectGenericContent,
  evaluateContentIntelligence,
} from '../supabase/functions/_shared/content-intelligence.ts';

function strongResearch() {
  return {
    data_quality: 'complete',
    content_evidence_quality: {
      contract_version: 'PREMIUM_EVIDENCE_V1',
      verified_news_count: 1,
      verified_market_count: 3,
      all_news_traceable: true,
      blank_market_change_count: 0,
    },
    v10_data_quality_status: 'sufficient',
    v10_beneficiary_enabled: true,
    today_quote: '費半上漲 2.1% 且 NVIDIA 財測上修，台股先看台積電與 AI 供應鏈開盤後是否量價同步。',
    free_summary: {
      one_sentence: '費半上漲 2.1% 且 NVIDIA 財測上修，台股先看台積電與 AI 供應鏈開盤後是否量價同步。',
      do_not_do: '若 09:30 台積電弱於大盤且半導體未擴散，不追價。',
    },
    key_drivers: [
      'NVIDIA 財測上修',
      '費半收高 2.1%',
      '台積電 ADR 相對強勢',
    ],
    preferred_sectors: ['半導體', 'AI 伺服器'],
    taiwan_transmission: '美國 AI 資本支出先傳導到先進製程與先進封裝，再影響台灣半導體供應鏈。',
    today_beneficiary_stocks_v10: [{
      symbol: '2330',
      name: '台積電',
      trigger_event: 'NVIDIA 公布最新財測並上修 AI 晶片需求預期',
      transmission_logic: 'NVIDIA 資本支出上修，先帶動先進製程與先進封裝需求，再傳導至台灣半導體供應鏈。',
      taiwan_supply_chain_link: '台積電提供 NVIDIA GPU 所需先進製程與 CoWoS 先進封裝產能。',
      validation_signal: '09:30 觀察台積電是否相對加權指數強勢，且半導體成交比重同步上升。',
      invalidation_condition: '台積電轉弱且半導體族群未同步，或事件來源遭公司更新否定。',
      data_basis: 'https://investor.nvidia.com/；market_data:NVDA@2026-08-21T06:00:00Z；market_data:TSM@2026-08-21T06:00:00Z',
    }],
  };
}

test('high-value research reaches the publish threshold with an auditable breakdown', () => {
  const result = evaluateContentIntelligence(strongResearch(), 3);
  assert.ok(result.score >= 90, `expected high-quality score, received ${result.score}`);
  assert.equal(result.publishable, true);
  assert.ok(['publish', 'high_quality'].includes(result.grade));
  assert.equal(result.breakdown.evidence, 20);
  assert.equal(result.breakdown.freshness, 15);
  assert.equal(result.breakdown.taiwan_relevance, 15);
});

test('generic market copy is rejected even when it sounds polished', () => {
  const ai = strongResearch();
  ai.today_quote = '市場瞬息萬變，投資人仍需謹慎並持續觀察市場變化。';
  ai.free_summary.one_sentence = ai.today_quote;
  const result = evaluateContentIntelligence(ai, 3);
  assert.ok(result.generic_flags.length >= 2);
  assert.ok(result.reason_codes.includes('generic_content_detected'));
  assert.ok(result.score < evaluateContentIntelligence(strongResearch(), 3).score);
});

test('a recommendation without a traceable source and invalidation is not publishable', () => {
  const ai = strongResearch();
  ai.today_beneficiary_stocks_v10[0].data_basis = '綜合研判';
  ai.today_beneficiary_stocks_v10[0].invalidation_condition = '';
  const result = evaluateContentIntelligence(ai, 3);
  assert.equal(result.publishable, false);
  assert.ok(result.reason_codes.includes('recommendation_reasoning_incomplete'));
  assert.ok(result.reason_codes.includes('risk_definition_incomplete'));
});

test('detector accepts a concrete evidence-linked daily sentence', () => {
  assert.deepEqual(detectGenericContent(strongResearch()), []);
});

test('paid content fails closed without the verified evidence contract', () => {
  const ai = strongResearch();
  delete ai.content_evidence_quality;
  const result = evaluateContentIntelligence(ai, 3);
  assert.equal(result.publishable, false);
  assert.ok(result.reason_codes.includes('evidence_quality_contract_missing'));
});
