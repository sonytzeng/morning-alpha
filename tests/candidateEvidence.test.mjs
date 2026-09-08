import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidateEvidenceRelevance,
  candidateEvidenceMatches,
  candidateRepeatPenaltyContribution,
  evidenceSemanticTags,
} from '../supabase/functions/generate-daily-report-v7/candidate-evidence.ts';

test('AI does not falsely match the word previous validation', () => {
  const evidence = {
    title: '2026-08-28',
    summary: '偏多觀察',
    evidence_type: 'previous_validation',
  };
  assert.equal(candidateEvidenceMatches(['AI_SERVER'], evidence), false);
});

test('Chinese semiconductor news maps to semiconductor candidates', () => {
  const evidence = {
    title: '半導體',
    summary: "TSMC's Q2 employee bonuses rise more than 50% year-on-year",
    evidence_type: 'market_news',
  };
  assert.equal(candidateEvidenceMatches(['SEMICONDUCTOR'], evidence), true);
  assert.equal(candidateEvidenceMatches(['SHIPPING'], evidence), false);
});

test('risk-off market evidence supports only conditional defensive screening', () => {
  const evidence = {
    title: 'TAIEX',
    summary: 'TAIEX DOWN -1.65% 台股現貨大盤方向',
    evidence_type: 'market_data',
  };
  const tags = evidenceSemanticTags(evidence);
  assert.equal(tags.has('MARKET_RISK'), true);
  assert.equal(candidateEvidenceMatches(['DEFENSIVE'], evidence), true);
  assert.equal(candidateEvidenceMatches(['OIL'], evidence), false);
});

test('rate evidence does not become unrelated oil or shipping evidence', () => {
  const evidence = {
    title: '美債殖利率',
    summary: "Inflation remains high; Fed signals rate hikes may be needed",
    evidence_type: 'market_news',
  };
  assert.equal(candidateEvidenceMatches(['RATE'], evidence), true);
  assert.equal(candidateEvidenceMatches(['OIL', 'SHIPPING'], evidence), false);
});

test('2026-09-01 Fed and precious-metals news cannot support cement or power-grid stocks', () => {
  const evidence = {
    title: 'Gold, silver ETFs tumble as US Fed rate hike bets surge',
    summary: 'Gold and silver ETFs fell as investors increased Fed rate hike expectations.',
    evidence_type: 'market_news',
  };
  assert.equal(
    candidateEvidenceRelevance(['1101', '台泥', 'CEMENT', 'POLICY'], evidence),
    'none',
  );
  assert.equal(candidateEvidenceMatches(['1101', '台泥', 'CEMENT', 'POLICY'], evidence), false);
  assert.equal(candidateEvidenceMatches(['1519', '華城', 'GREEN_POWER_GRID', 'POLICY'], evidence), false);
});

test('TSMC AI news supports approved electronics bridges but not unrelated industries', () => {
  const evidence = {
    title: 'AI growth entering industrialization phase, integrated systems key: TSMC',
    summary: 'TSMC discusses AI industrialization and semiconductor system integration.',
    evidence_type: 'market_news',
  };
  assert.equal(candidateEvidenceRelevance(['PCB_CCL', 'AI_SERVER'], evidence), 'approved_bridge');
  assert.equal(candidateEvidenceMatches(['PCB_CCL', 'AI_SERVER'], evidence), true);
  assert.equal(candidateEvidenceMatches(['AUTO_EV', 'POLICY'], evidence), false);
  assert.equal(candidateEvidenceMatches(['GREEN_POWER_GRID', 'POLICY'], evidence), false);
});

test('NVDA market data supports AI servers but cannot unlock automobiles', () => {
  const evidence = {
    title: 'NVDA',
    summary: 'NVDA UP 1.48% AI server and semiconductor supply-chain signal',
    evidence_type: 'market_data',
  };
  assert.equal(candidateEvidenceMatches(['AI_SERVER'], evidence), true);
  assert.equal(candidateEvidenceMatches(['AUTO_EV', 'POLICY'], evidence), false);
});

test('direct power-grid evidence can support a power-grid candidate', () => {
  const evidence = {
    title: '台灣電網設備',
    summary: '變壓器與重電訂單增加，電網建設需求延續。',
    evidence_type: 'market_news',
  };
  assert.equal(candidateEvidenceRelevance(['1519', '華城', 'GREEN_POWER_GRID'], evidence), 'direct');
  assert.equal(candidateEvidenceMatches(['1519', '華城', 'GREEN_POWER_GRID'], evidence), true);
});

test('broad market evidence cannot unlock an unrelated electronic constituent', () => {
  const taiex = {
    title: 'TAIEX',
    summary: 'TAIEX UP 0.80% 台股現貨大盤方向',
    evidence_type: 'market_data',
  };
  const tsmcAi = {
    title: 'TSMC AI industrialization',
    summary: 'TSMC discusses AI and semiconductor system integration.',
    evidence_type: 'market_news',
  };
  assert.equal(candidateEvidenceMatches(['2412', '中華電', 'ELECTRONIC_BLUE_CHIP', 'TELECOM'], taiex), false);
  assert.equal(candidateEvidenceMatches(['2412', '中華電', 'ELECTRONIC_BLUE_CHIP', 'TELECOM'], tsmcAi), false);
  assert.equal(candidateEvidenceMatches(['2454', '聯發科', 'ELECTRONIC_BLUE_CHIP', 'SEMICONDUCTOR'], tsmcAi), true);
});

test('fresh evidence can keep a recurring leader eligible without a novelty ban', () => {
  assert.equal(candidateRepeatPenaltyContribution(0), 0);
  assert.equal(candidateRepeatPenaltyContribution(40), 4);
  assert.equal(candidateRepeatPenaltyContribution(100), 10);
  assert.equal(candidateRepeatPenaltyContribution(1000), 10);
});
