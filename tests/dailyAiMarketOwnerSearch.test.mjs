import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnerMarketSearch, parseOwnerMarketSearch } from '../src/features/vnext/dailyAiMarketOwner.ts';
import { MARKET_WORKER_RPCS } from '../supabase/functions/_shared/taiwan-market-worker-gateway.mjs';
const now = Date.parse('2026-11-11T10:00:00Z'), id = '00000000-0000-0000-0000-000000000001';
const scope = () => ({ identity: id, tier: 'owner', generation: 1, signal: new globalThis.AbortController().signal });
const response = () => ({ schema: 'VNEXT_AI_OWNER_MARKET_SEARCH_V2', subject_user_id: id, preview_only: true, research_only: true,
  edition_id: 'a'.repeat(64), universe_hash: 'b'.repeat(64), query: '台積電', limit: 20, checked_at: new Date(now).toISOString(), has_more: false,
  companies: [{ security_id: 'TWSE:2330', market: 'TWSE', symbol: '2330', company: '台灣積體電路製造股份有限公司', short_name: '台積電' }] });
const expected = { edition_id: 'a'.repeat(64), query: '台積電', limit: 20 };
test('search request permits Chinese/full names and treats dangerous query characters as invalid input', () => {
  assert.equal(normalizeOwnerMarketSearch('  台積電  '), '台積電'); assert.equal(normalizeOwnerMarketSearch('台灣積體電路製造股份有限公司'), '台灣積體電路製造股份有限公司');
  assert.equal(normalizeOwnerMarketSearch('2330'), '2330');
  for (const value of [null, '', 'a'.repeat(81), '%', '_', "' OR 1=1", 'x\u0000y', '<script>', 'a\\b', '2330\n']) assert.throws(() => normalizeOwnerMarketSearch(value), /SEARCH_QUERY/);
});
test('response binds exact edition, subject and query and only contains matching company identities', () => {
  const result = parseOwnerMarketSearch(response(), scope(), expected, now); assert.equal(result.companies[0].symbol, '2330'); assert(Object.isFrozen(result));
  for (const changes of [{ edition_id: 'c'.repeat(64) }, { query: '2330' }, { subject_user_id: '00000000-0000-0000-0000-000000000002' },
    { preview_only: false }, { limit: 60 }, { checked_at: new Date(now + 1).toISOString() }])
    assert.throws(() => parseOwnerMarketSearch({ ...response(), ...changes }, scope(), expected, now), /SCOPE/);
  const bad = response(); bad.companies[0].symbol = '2454'; assert.throws(() => parseOwnerMarketSearch(bad, scope(), expected, now), /IDENTITY/);
  const mismatch = response(); mismatch.companies[0].company = '合成別家公司'; mismatch.companies[0].short_name = '合成';
  assert.throws(() => parseOwnerMarketSearch(mismatch, scope(), expected, now), /MATCH/);
});
test('duplicates, excess matches, aborted scope and adding Owner search to worker capabilities are rejected', () => {
  const duplicate = response(); duplicate.companies.push(duplicate.companies[0]); assert.throws(() => parseOwnerMarketSearch(duplicate, scope(), expected, now), /ORDER/);
  const excess = response(); excess.companies = Array(21).fill(excess.companies[0]); assert.throws(() => parseOwnerMarketSearch(excess, scope(), expected, now), /LIST/);
  const controller = new globalThis.AbortController(); controller.abort(); assert.throws(() => parseOwnerMarketSearch(response(), { ...scope(), signal: controller.signal }, expected, now), /SCOPE/);
  assert.equal(MARKET_WORKER_RPCS.includes('get_daily_ai_owner_market_search_v2'), false);
});
