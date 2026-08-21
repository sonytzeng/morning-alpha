import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterPremiumNewsEvidence,
  normalizePremiumMarketEvidence,
  reviewPremiumNewsEvidence,
} from '../supabase/functions/_shared/premium-evidence.ts';

const NOW = new Date('2026-08-21T07:00:00Z').getTime();

test('canonical camelCase market data becomes numeric evidence with a timestamp', () => {
  const evidence = normalizePremiumMarketEvidence({
    symbol: 'SOX',
    name: 'Philadelphia Semiconductor Index',
    value: 6123.45,
    changePercent: -1.27,
    updatedAt: '2026-08-21T06:30:00Z',
    hasChangePercent: true,
  }, NOW);
  assert.equal(evidence.change_percent, -1.27);
  assert.equal(evidence.direction, 'down');
  assert.equal(evidence.freshness_status, 'fresh');
});

test('market rows with a missing change percent cannot become decision evidence', () => {
  const evidence = normalizePremiumMarketEvidence({
    symbol: 'TAIEX',
    changePercent: 0,
    updatedAt: '2026-08-21T06:30:00Z',
    hasChangePercent: false,
  }, NOW);
  assert.equal(evidence, null);
});

test('traceable Taiwan-relevant market news is eligible', () => {
  const review = reviewPremiumNewsEvidence({
    title: 'NVIDIA raises AI server demand outlook after earnings',
    source: 'NVIDIA Investor Relations',
    url: 'https://investor.nvidia.com/news/example',
    published_at: '2026-08-21T05:30:00Z',
    taiwan_impact_summary: '台灣 AI 伺服器與半導體供應鏈需驗證訂單及量價反應。',
  }, NOW);
  assert.equal(review.eligible, true);
  assert.equal(review.event_type, 'ai_server');
});

test('unrelated lifestyle and retail headlines do not enter the paid evidence set', () => {
  const rows = [
    {
      title: 'Lakers team valuation reaches a new record',
      source: 'Example News',
      url: 'https://example.com/lakers',
      published_at: '2026-08-21T05:30:00Z',
      taiwan_impact_summary: '牽動台灣 AI、散熱與半導體供應鏈。',
    },
    {
      title: 'Wayfair shares fall after quarterly update',
      source: 'Example News',
      url: 'https://example.com/wayfair',
      published_at: '2026-08-21T05:30:00Z',
      taiwan_impact_summary: '牽動台達電、和大與台灣 AI 供應鏈。',
    },
  ];
  const result = filterPremiumNewsEvidence(rows, NOW);
  assert.equal(result.verified.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.ok(result.rejected.every((entry) => entry.reason_codes.includes('taiwan_market_relevance_unproven')));
});

test('evergreen company-history articles cannot masquerade as a fresh catalyst', () => {
  const review = reviewPremiumNewsEvidence({
    title: 'History of TSMC and its stock: Company timeline, facts and milestones',
    source: 'Example Finance',
    url: 'https://example.com/tsmc-history',
    published_at: '2026-08-21T05:30:00Z',
    taiwan_impact_summary: '牽動台積電與台灣半導體供應鏈。',
  }, NOW);
  assert.equal(review.eligible, false);
  assert.ok(review.reason_codes.includes('non_catalyst_editorial_headline'));
});
