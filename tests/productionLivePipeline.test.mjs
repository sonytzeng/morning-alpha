import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CANONICAL_DECISION_ACTIONS,
  canonicalDecisionAction,
} from '../supabase/functions/_shared/canonical-decision-contract.mjs';
import {
  normalizeConfiguredProxyQuote,
  normalizeProviderTimestamp,
} from '../supabase/functions/_shared/provider-normalization.mjs';

const marketSource = await readFile(new URL('../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url), 'utf8');
const newsSource = await readFile(new URL('../supabase/functions/fetch-global-market-news/index.ts', import.meta.url), 'utf8');
const reportSource = await readFile(new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url), 'utf8');

test('decision modes always map to the production decision_snapshots action contract', () => {
  assert.equal(canonicalDecisionAction('recommendations'), 'SELECTIVE');
  assert.equal(canonicalDecisionAction('no_trade'), 'WAIT');
  assert.equal(canonicalDecisionAction('blocked'), 'STOP');
  assert.equal(canonicalDecisionAction('unknown'), 'STOP');
  for (const mode of ['recommendations', 'no_trade', 'blocked', 'unknown']) {
    assert.ok(CANONICAL_DECISION_ACTIONS.includes(canonicalDecisionAction(mode)));
  }
  assert.doesNotMatch(reportSource, /'ACTIONABLE'|'NO_TRADE'|'WATCH'/);
});

test('Fugle epoch timestamps normalize seconds, milliseconds, microseconds, and nanoseconds', () => {
  const expected = '2024-10-22T05:29:56.621Z';
  assert.equal(normalizeProviderTimestamp(1729574996.621), expected);
  assert.equal(normalizeProviderTimestamp(1729574996621), expected);
  assert.equal(normalizeProviderTimestamp(1729574996621000), expected);
  assert.equal(normalizeProviderTimestamp(1729574996621000000), expected);
  assert.equal(normalizeProviderTimestamp('1729574996621000'), expected);
  assert.equal(normalizeProviderTimestamp('not-a-timestamp'), '');
});

test('Taiwan adapters follow the Fugle v1 symbol and session contract', () => {
  assert.match(marketSource, /fugleIndexCandidates = \["IR0001", "IX0001", "TAIEX"\]/);
  assert.match(marketSource, /session === "afterhours" \? \{ session: "afterhours" \} : undefined/);
  assert.match(marketSource, /lastTrade\.time \|\| total\.time \|\|/);
});

test('DXY and US10Y unsupported Finnhub symbols are replaced by explicit liquid proxies', () => {
  assert.match(marketSource, /finnhubSymbol: "UUP", displaySymbol: "DXY"/);
  assert.match(marketSource, /finnhubSymbol: "IEF", displaySymbol: "US10Y"/);
  const transformed = normalizeConfiguredProxyQuote({
    value: 100,
    change: 1,
    changePercent: 1.25,
    sourceSymbol: 'IEF',
    raw: {},
  }, { directionMultiplier: -1, proxySemantics: 'inverse_7_10y_treasury_price_proxy' });
  assert.equal(transformed.change, -1);
  assert.equal(transformed.changePercent, -1.25);
  assert.equal(transformed.raw.proxy_symbol, 'IEF');
});

test('news flows through fresh canonical events and catalyst tags before the decision engine', () => {
  assert.match(newsSource, /stale_published_at_over_48h/);
  assert.match(newsSource, /\.from\("news_event_tags"\)/);
  assert.match(newsSource, /catalyst_tag_upserted_count/);
  assert.match(reportSource, /from\('news_events'\)/);
  assert.match(reportSource, /from\('news_event_tags'\)/);
  assert.match(reportSource, /canonical_news_events/);
  assert.match(reportSource, /catalyst_tagged/);
  assert.doesNotMatch(reportSource, /from\('market_news'\)\.select\('id,title,source,url/);
});
