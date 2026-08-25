import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';
import {
  isDecisionCriticalMissingSource,
  normalizeEvidenceLeadForChineseSentence,
} from '../supabase/functions/_shared/content-intelligence.ts';

function validAi() {
  return {
    content_publish_gate: { overall_status: '可公開', blocking_issues: [] },
    member_value_score: 96,
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
    key_drivers: ['NVIDIA 財測上修', '費半收高 2.1%', '台積電 ADR 相對強勢'],
    preferred_sectors: ['半導體', 'AI 伺服器'],
    taiwan_transmission: '美國 AI 資本支出先傳導到先進製程與先進封裝，再影響台灣半導體供應鏈。',
    member_research_note_v2: {
      overnight_chain: Array.from({ length: 5 }, (_, index) => ({
        event: `海外事件與資金傳導第 ${index + 1} 層`,
        impact_logic: '由市場事件逐層傳到台灣產業與代表股。',
      })),
      intraday_validation: [
        { time_window: '09:30', what_to_watch: '2330 與 TAIEX 是否同向' },
        { time_window: '10:30', what_to_watch: '半導體成交比重是否擴大' },
        { time_window: '13:00', what_to_watch: '主線是否守住早盤低點' },
      ],
      invalidation_rules: [
        { condition: '2330 弱於大盤', action_note: '撤回半導體主線' },
        { condition: '族群未同步', action_note: '不追價' },
      ],
      subscriber_value_sentence: '先用 09:30 權值股、指數與族群同步性驗證主線，任一條件失效就撤回判斷。',
    },
    today_beneficiary_stocks_v10: [{
      symbol: '2330',
      name: '台積電',
      trigger_event: 'NVIDIA 公布最新財測並帶動 AI 晶片需求預期',
      transmission_logic: 'NVIDIA 資本支出上修，帶動先進製程與先進封裝需求，再傳導至台灣半導體供應鏈。',
      taiwan_supply_chain_link: '台積電提供 NVIDIA GPU 所需先進製程與 CoWoS 先進封裝產能。',
      validation_signal: '09:30 觀察台積電是否相對加權指數強勢，且半導體成交比重同步上升。',
      invalidation_condition: '台積電轉弱且半導體族群未同步，或事件來源遭公司更新否定。',
      data_basis: 'https://investor.nvidia.com/；market_data:NVDA@2026-08-21T06:00:00Z；market_data:TSM@2026-08-21T06:00:00Z',
    }],
  };
}

test('premium content is eligible only with fresh news and complete stock reasoning', () => {
  const result = evaluatePremiumContentGate(validAi(), 2);
  assert.equal(result.eligible, true);
  assert.equal(result.status, 'eligible');
  assert.equal(result.complete_recommendation_count, 1);
});

test('English evidence headlines are normalized before joining Chinese product copy', () => {
  assert.equal(
    normalizeEvidenceLeadForChineseSentence('Shares flat in Asia before inflation data'),
    '隔夜市場消息與台股現貨訊號',
  );
  assert.equal(
    normalizeEvidenceLeadForChineseSentence('費半回穩但權值股分歧'),
    '費半回穩但權值股分歧',
  );
});

test('premium gate rejects a truncated English headline joined directly to Chinese', () => {
  const ai = validAi();
  ai.today_quote = 'Shares flat in Asia before I未形成正向主線；09:30 看台積電與半導體是否同步止跌。';
  ai.free_summary.one_sentence = ai.today_quote;
  const result = evaluatePremiumContentGate(ai, 2);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('generic_content_detected'));
});

test('short event label remains complete when it carries a traceable canonical source', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10[0].trigger_event = 'OIL';
  ai.today_beneficiary_stocks_v10[0].data_basis = 'Reuters｜https://example.com/fresh-oil-catalyst｜2026-08-24T01:00:00Z';
  const result = evaluatePremiumContentGate(ai, 1);
  assert.equal(result.eligible, true);
  assert.equal(result.complete_recommendation_count, 1);
});

test('short event label without a specific source still fails closed', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10[0].trigger_event = 'OIL';
  ai.today_beneficiary_stocks_v10[0].data_basis = '市場數據綜合判斷';
  const result = evaluatePremiumContentGate(ai, 1);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('recommendation_reasoning_incomplete'));
});
test('premium content fails closed when both news and traceable market catalysts are missing', () => {
  const ai = validAi();
  ai.today_beneficiary_stocks_v10[0].data_basis = '';
  const result = evaluatePremiumContentGate(ai, 0);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('fresh_catalyst_evidence_missing'));
});

test('fresh market and index evidence can qualify without forcing a news article', () => {
  const ai = validAi();
  ai.content_evidence_quality.verified_news_count = 0;
  ai.today_beneficiary_stocks_v10[0].data_basis = 'market_data:NVDA@2026-08-21T06:00:00Z；market_data:SOX@2026-08-21T06:00:00Z；market_data:TSM@2026-08-21T06:00:00Z';
  const result = evaluatePremiumContentGate(ai, 0);
  assert.equal(result.eligible, true);
  assert.equal(result.content_score >= 90, true);
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

test('premium gate measures five-layer causal depth instead of requiring five unrelated events', () => {
  const ai = validAi();
  ai.member_research_note_v2.overnight_chain = ai.member_research_note_v2.overnight_chain.slice(0, 3);
  ai.v8_overnight_causal_chain = {
    status: 'ready',
    chains: [{
      causal_steps: [
        '海外事件',
        '資金流向改變',
        '美股族群反應',
        '台灣供應鏈傳導',
        '代表個股盤中驗證',
      ],
    }],
  };
  const result = evaluatePremiumContentGate(ai, 2);
  assert.equal(result.eligible, true);
});

test('premium gate still fails closed when overnight causal depth is below five layers', () => {
  const ai = validAi();
  ai.member_research_note_v2.overnight_chain = ai.member_research_note_v2.overnight_chain.slice(0, 3);
  ai.v8_overnight_causal_chain = {
    status: 'ready',
    chains: [{ causal_steps: ['海外事件', '資金流向', '美股族群', '台灣供應鏈'] }],
  };
  const result = evaluatePremiumContentGate(ai, 2);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('member_research_structure_incomplete'));
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
  assert.equal(result.content_score >= 90, true);
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

test('evidence-backed no-trade may publish when only prior sector context is unavailable', () => {
  const ai = validAi();
  ai.data_quality = 'degraded';
  ai.missing_sources = ['sector_rotation_scores:2026-08-24'];
  ai.today_beneficiary_stocks_v10 = [];
  ai.v10_data_quality_status = 'insufficient_positive_evidence';
  ai.today_quote = '費半與台積電 ADR 訊號分歧，09:30 先看 2330 與半導體族群是否同步止跌，未確認前不建立受惠股。';
  ai.free_summary.one_sentence = ai.today_quote;
  ai.v10_observation_watchlist = [
    { symbol: '2330', data_basis: 'MD001｜market_data.TSM｜TSM ADR +0.8%' },
    { symbol: '2308', data_basis: 'NEWS001｜https://example.com/nvda-catalyst' },
    { symbol: '2882', data_basis: 'MD003｜market_data.US10Y｜US10Y UP' },
  ];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, true);
  assert.equal(result.decision_mode, 'no_trade');
  assert.equal(result.content_score >= 90, true);
});

test('recommendations still fail closed when sector rotation context is unavailable', () => {
  const ai = validAi();
  ai.data_quality = 'degraded';
  ai.missing_sources = ['sector_rotation_scores:2026-08-24'];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, false);
  assert.ok(result.reason_codes.includes('source_data_incomplete'));
});

test('safe-mode source classification stays aligned with premium decision mode', () => {
  assert.equal(isDecisionCriticalMissingSource('sector_rotation_scores:2026-08-24', 'no_trade'), false);
  assert.equal(isDecisionCriticalMissingSource('sector_rotation_scores:2026-08-24', 'recommendations'), true);
  assert.equal(isDecisionCriticalMissingSource('stale_market_data:TAIEX:2026-08-24T05:30:00+00:00', 'no_trade'), true);
});

test('recommendations may publish when TXF is the only declared entitlement gap', () => {
  const ai = validAi();
  ai.data_quality = 'degraded';
  ai.missing_sources = ['unavailable_market_data:TXF:no_authorized_source_or_contract_mapping'];
  const result = evaluatePremiumContentGate(ai, 3);
  assert.equal(result.eligible, true);
  assert.equal(result.content_score >= 90, true);
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
