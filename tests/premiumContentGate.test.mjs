import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';

function validAi() {
  return {
    content_publish_gate: { overall_status: '可公開', blocking_issues: [] },
    member_value_score: 96,
    data_quality: 'complete',
    v10_data_quality_status: 'sufficient',
    v10_beneficiary_enabled: true,
    today_quote: '費半上漲 2.1% 且 NVIDIA 財測上修，台股先看台積電與 AI 供應鏈開盤後是否量價同步。',
    free_summary: {
      one_sentence: '費半上漲 2.1% 且 NVIDIA 財測上修，台股先看台積電與 AI 供應鏈開盤後是否量價同步。',
      do_not_do: '若 09:30 台積電弱於大盤且半導體未擴散，不追價。',
    },
    key_drivers: ['NVIDIA 財測上修', '費半收高 2.1%', '台積電 ADR 相對強勢'],
    preferred_sectors: ['半導體', 'AI 伺服器'],
    taiwan_transmission: '美國 AI 資本支出先傳導到先進製程與先進封裝，再影響台灣半導體供應鏈。',
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
test('premium content fails closed when both news and traceable market catalysts are missing', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10[0].data_basis = '';
  const result = evaluatePremiumContentGate(ai, 0);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('fresh_catalyst_evidence_missing'));
});

test('fresh market and index evidence can qualify without forcing a news article', () => {
  const result = evaluatePremiumContentGate(validAi(), 0);
  assert.equal(result.eligible, true);
  assert.equal(result.content_score >= 80, true);
});

test('every recommended stock must include source, transmission, Taiwan relationship and conditions', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10[0].taiwan_supply_chain_link = '';
  const result = evaluatePremiumContentGate(ai, 2);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('recommendation_reasoning_incomplete'));
});

test('an evidence-backed no-trade decision remains valuable premium research', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10 = [];
  ai.v10_data_quality_status = 'insufficient_positive_evidence';
  ai.today_quote = '費半上漲 2.1%，但台積電 ADR 與台指期訊號分歧，今日先驗證 09:30 量價，不建立受惠股部位。';
  ai.free_summary.one_sentence = ai.today_quote;
  ai.v10_observation_watchlist = [
    { symbol: '2330', data_basis: 'market_data.TSM；market_data.TAIEX' },
    { symbol: '2308', data_basis: 'market_data.NVDA；sector_rotation_scores.AI伺服器' },
    { symbol: '2882', data_basis: 'market_data.US10Y；sector_rotation_scores.金融' },
  ];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, true);
  assert.equal(result.decision_mode, 'no_trade');
  assert.equal(result.recommendation_count, 0);
});

test('no-trade may publish with the declared optional TXF entitlement gap', () => {
  const ai = validAi();
  ai.data_quality = 'degraded';
  ai.missing_sources = ['unavailable_market_data:TXF:no_authorized_source_or_contract_mapping'];
  ai.today_beneficiary_stocks_v10 = [];
  ai.v10_data_quality_status = 'insufficient_positive_evidence';
  ai.today_quote = '費半與台積電 ADR 訊號分歧，09:30 先看 2330 與半導體族群是否同步止跌，未確認前不建立受惠股。';
  ai.free_summary.one_sentence = ai.today_quote;
  ai.v10_observation_watchlist = [
    { symbol: '2330', data_basis: 'MD001｜market_data.TSM｜TSM ADR +0.8%' },
    { symbol: '2308', data_basis: 'MD002｜market_data.NVDA｜NVDA -0.4%' },
    { symbol: '2882', data_basis: 'MD003｜market_data.US10Y｜US10Y UP' },
  ];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, true);
  assert.equal(result.decision_mode, 'no_trade');
  assert.equal(result.content_score >= 80, true);
});

test('no-trade still blocks when any non-optional decision source is missing', () => {
  const ai = validAi();
  ai.data_quality = 'degraded';
  ai.missing_sources = ['stale_market_data:SPX'];
  ai.today_beneficiary_stocks_v10 = [];
  ai.v10_data_quality_status = 'insufficient_positive_evidence';
  ai.v10_observation_watchlist = [
    { symbol: '2330', data_basis: 'market_data.TSM；market_data.TAIEX' },
    { symbol: '2308', data_basis: 'market_data.NVDA；sector_rotation_scores.AI伺服器' },
    { symbol: '2882', data_basis: 'market_data.US10Y；sector_rotation_scores.金融' },
  ];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('source_data_incomplete'));
});

test('recommendations require complete sources even when TXF is the only gap', () => {
  const ai = validAi();
  ai.data_quality = 'degraded';
  ai.missing_sources = ['unavailable_market_data:TXF:no_authorized_source_or_contract_mapping'];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('source_data_incomplete'));
});

test('no-trade content fails closed when it lacks a useful observation set', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10 = [];
  ai.v10_data_quality_status = 'insufficient_positive_evidence';
  ai.v10_observation_watchlist = [{ symbol: '2330' }];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('no_trade_decision_incomplete'));
});

test('a short list of fully reasoned recommendations is not forced to reach five stocks', () => {
  const ai = validAi();
  ai.v10_data_quality_status = 'partial';
  const result = evaluatePremiumContentGate(ai, 2);
  assert.equal(result.eligible, true);
  assert.equal(result.decision_mode, 'recommendations');
});
