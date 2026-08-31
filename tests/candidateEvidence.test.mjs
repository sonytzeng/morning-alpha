import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidateEvidenceMatches,
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
