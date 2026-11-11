// SYNTHETIC company roster/analysis only, even where a familiar name or code is
// used to test Chinese lookup. Disposable local PostgreSQL; no live service.
import assert from 'node:assert/strict';
import console from 'node:console';
import { createMarketOwnerFixture } from './helpers/dailyAiMarketOwnerFixture.mjs';
import { parseOwnerMarketSearch } from '../src/features/vnext/dailyAiMarketOwner.ts';
const f = await createMarketOwnerFixture({ firstSymbol: 2330, companyNames: {
  '2330': { company: '台灣積體電路製造股份有限公司', short_name: '台積電' },
  '2331': { company: '臺灣合成股份有限公司', short_name: '臺灣合成' },
} });
let phase = 0; const passed = label => console.log(JSON.stringify({ phase: ++phase, state: 'PASS', label }));
const args = (query, limit = 20, edition = f.editionId) => ({ p_edition_id: edition, p_query: query, p_limit: limit });
const search = async (query, limit = 20) => parseOwnerMarketSearch(await f.call('get_daily_ai_owner_market_search_v2', args(query, limit)), f.scope(), { edition_id: f.editionId, query, limit });
try {
  await f.db.exec('reset role'); await f.executeFile('daily-ai-market-owner-search.candidate.sql');
  for (const id of [f.free, f.premium]) { await f.identity(id); await assert.rejects(f.call('get_daily_ai_owner_market_search_v2', args('2330')), /OWNER_REQUIRED/); }
  for (const role of ['anon', 'service_role']) { await f.identity(null, role); await assert.rejects(f.call('get_daily_ai_owner_market_search_v2', args('2330')), /permission denied/); }
  await f.identity(f.owner); const chinese = await search('台積電'), full = await search('台灣積體電路'), code = await search('2330');
  assert.equal(chinese.companies.length, 1); assert.equal(chinese.companies[0].security_id, 'TWSE:2330');
  assert.deepEqual(chinese.companies, full.companies); assert.deepEqual(chinese.companies, code.companies);
  assert.equal((await search('台灣合成')).companies[0].symbol, '2331');
  assert.equal((await search('不存在的合成公司')).companies.length, 0);
  passed('Owner-only Chinese short/full name, numeric identity and 臺/台 literal matching via real SQL/parser');

  const broad = await search('23'); assert.equal(broad.companies.length, 20); assert.equal(broad.has_more, true);
  assert.equal((await search('23', 1)).companies.length, 1); assert.equal((await search('23', 1)).has_more, true);
  for (const query of [null, '', ' '.repeat(5), 'a'.repeat(81), '%', '_', "2330'", '<script>', '2330\n', '2330\\x', '$1', '*'])
    await assert.rejects(f.call('get_daily_ai_owner_market_search_v2', args(query)), /MARKET_OWNER_SEARCH_QUERY/);
  await assert.rejects(f.call('get_daily_ai_owner_market_search_v2', args('2330', 21)), /MARKET_OWNER_SEARCH_SCOPE/);
  await assert.rejects(f.call('get_daily_ai_owner_market_search_v2', args('2330', 20, 'f'.repeat(64))), /MARKET_OWNER_SEARCH_EDITION/);
  const raw = await f.call('get_daily_ai_owner_market_search_v2', args('2330'));
  for (const changed of [{ ...raw, query: '台積電' }, { ...raw, edition_id: 'f'.repeat(64) }, { ...raw, subject_user_id: f.premium }])
    assert.throws(() => parseOwnerMarketSearch(changed, f.scope(), { edition_id: f.editionId, query: '2330', limit: 20 }), /SCOPE/);
  passed('20-company bound, strict query/edition/request binding and special-character rejection');

  await f.db.exec('reset role'); await f.db.query('update auth.users set is_anonymous=true where id=$1', [f.owner]); await f.identity(f.owner);
  await assert.rejects(f.call('get_daily_ai_owner_market_search_v2', args('2330')), /OWNER_REQUIRED/);
  await f.db.exec('reset role');
  const counts = (await f.db.query(`select (select count(*)::int from vnext_market.reviews) reviews,
   (select count(*)::int from vnext_market.publication_events) publications,(select count(*)::int from vnext_private.source_licenses) licenses`)).rows[0];
  assert.deepEqual(counts, { reviews: 0, publications: 0, licenses: 0 });
  await f.executeFile('daily-ai-market-owner-search.rollback.sql'); await f.identity(f.owner);
  await assert.rejects(f.call('get_daily_ai_owner_market_search_v2', args('2330')), /permission denied/);
  await f.db.exec('reset role');
  assert.equal((await f.db.query('select count(*)::int n from vnext_market.companies')).rows[0].n, 24);
  passed('anonymous Owner denied; no review/license/publication writes; rollback preserves all companies');
  console.log(JSON.stringify({ state: 'PASS', phases: phase, fixture: 'SYNTHETIC', provider_requests: 0, production_writes: 0 }));
} finally { await f.close(); }
