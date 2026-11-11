// Disposable PGlite projection regression. Auth/plan setup is SYNTHETIC.
// Optional MA_SHORT_SCOPE_REAL_RUN reads unchanged retained run artifacts;
// real packets/references are projected, never approved or republished.
// This narrow test does not repeat raw-capture admission or claim browser QA.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { createMarketOwnerFixture } from './helpers/dailyAiMarketOwnerFixture.mjs';
import { marketSnapshotHash as hash } from '../research/taiwan-market-universe.mjs';
import { marketStageCanonical as canonical } from '../research/daily-ai-market-stage.mjs';
import { compactTaiwanPriceReference, expandTaiwanPriceReference, taiwanResearchReferenceSummary } from '../research/taiwan-market-price-reference.mjs';
import { previousMarketTradingDate } from '../supabase/functions/_shared/market-session-contract.mjs';

const beforeHash = '886c09fa20182876261b9b28f6d1dd97', afterHash = '52130f03d9b1318f54d96bfa93d15852';
const signature = 'vnext_market.reference_projection(text,text,text,text,text,text)';
const candidate = readFileSync(new URL('../research/daily-ai-market-short-scope.candidate.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../research/daily-ai-market-short-scope.rollback.sql', import.meta.url), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex'), clone = value => globalThis.structuredClone(value);
let phase = 0, negativeCases = 0;
const pass = (label, extra = {}) => console.log(JSON.stringify({ phase: ++phase, state: 'PASS', label, ...extra }));

function syntheticSample(market, symbol) {
  const dates = ['2026-11-10']; while (dates.length < 20) dates.unshift(previousMarketTradingDate('TW', dates[0]));
  const security_id = market + ':' + symbol;
  const bars = dates.map((date, i) => ({ schema: 'TAIWAN_MARKET_HISTORY_OBSERVATION_V1', family: 'PRICE', market, symbol, date,
    open: 100 + i, high: 102 + i, low: 98 + i, close: 100 + i, volume: 1000, amount: 100000,
    price_basis: 'RAW_UNADJUSTED', currency: 'TWD', all_trades_session_complete: true,
    session_scope: market === 'TWSE' ? 'OFFICIAL_STOCK_DAY' : 'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES',
    source_capture: { capture_id: sha('SYNTHETIC_' + market + date) }, fixture: 'SYNTHETIC_PROJECTION_ONLY' }));
  const packet = { symbol, company: 'SYNTHETIC', cutoff: '2026-11-11T12:00:00.000Z', data_through: '2026-11-10',
    data_gaps: ['SYNTHETIC_PROJECTION_ONLY'], evidence: bars.map(bar => ({ kind: 'PRICE', content: canonical(bar) })) };
  const full = { schema: 'TAIWAN_OBSERVED_PRICE_RANGE_V1', security_id, through: dates.at(-1), current_price: 119,
    range: [98, 121], input_packet_hash: hash(packet), source_capture_ids: bars.map(b => b.source_capture.capture_id),
    forecast: false, buy_ready: false, production_eligible: false };
  const encoded = compactTaiwanPriceReference(full, {}, {});
  const summary = taiwanResearchReferenceSummary({ security_id, horizon: 'SHORT', reference: encoded, input_pool_hash: hash({}) });
  return { security_id, packet, encoded, summary, provenance: 'SYNTHETIC_PROJECTION_ONLY' };
}

function realSamples(directory) {
  const shardPath = join(directory, 'shards', 'shard-019.json'), pricesPath = join(directory, 'price-research.json');
  assert.ok(statSync(shardPath).size <= 64000000); assert.ok(statSync(pricesPath).size <= 256000000);
  const shardBytes = readFileSync(shardPath), pricesBytes = readFileSync(pricesPath);
  const shard = JSON.parse(shardBytes), prices = JSON.parse(pricesBytes);
  const samples = ['TPEX:8390', 'TWSE:1101'].map(security_id => {
    const stock = shard.stocks.find(s => s.security_id === security_id), price = prices.find(r => r.security_id === security_id);
    assert.ok(stock && price?.short && stock.research_references.SHORT);
    const expanded = expandTaiwanPriceReference(price.short, {});
    assert.equal(expanded.input_packet_hash, hash(stock.packet));
    assert.equal(expanded.input_packet_hash, stock.analysis.input_hash);
    assert.equal(expanded.reference_hash, stock.research_references.SHORT.reference_hash);
    assert.deepEqual(taiwanResearchReferenceSummary({ security_id, horizon: 'SHORT', reference: price.short,
      input_pool_hash: stock.research_references.SHORT.input_pool_hash }), stock.research_references.SHORT);
    return { security_id, packet: stock.packet, encoded: price.short, summary: stock.research_references.SHORT,
      provenance: 'RETAINED_REAL_RUN_PROJECTION_ONLY' };
  });
  return { samples, artifacts: [{ path: shardPath, bytes: shardBytes.length, sha256: sha(shardBytes) },
    { path: pricesPath, bytes: pricesBytes.length, sha256: sha(pricesBytes) }] };
}

const real = process.env.MA_SHORT_SCOPE_REAL_RUN ? realSamples(process.env.MA_SHORT_SCOPE_REAL_RUN) : { samples: [], artifacts: [] };
const samples = [...[syntheticSample('TWSE', '9101'), syntheticSample('TPEX', '9102')], ...real.samples];
const f = await createMarketOwnerFixture(), { db } = f;
async function metadata() {
  return (await db.query(`select md5(prosrc) body_md5,pg_get_functiondef(oid) definition,proacl::text acl,
    proowner::regrole::text owner,prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure`, [signature])).rows[0];
}
async function project(sample, { packetText = canonical(sample.packet), packetHash = sha(packetText),
  refsText = canonical({ SHORT: sample.summary, MEDIUM: null, LONG: null }), refsHash = sha(refsText), planHash = f.plan.plan_hash } = {}) {
  return (await db.query('select vnext_market.reference_projection($1,$2,$3,$4,$5,$6) result',
    [planHash, sample.security_id, refsText, refsHash, packetText, packetHash])).rows[0].result;
}
async function retain(sample, planHash = f.plan.plan_hash) {
  await db.query(`insert into vnext_market.price_references(plan_id,security_id,horizon,reference_hash,reference_text,summary)
    values($1,$2,'SHORT',$3,$4,$5)`, [planHash, sample.security_id, sample.summary.reference_hash, canonical(sample.encoded), sample.summary]);
}
// Negative copies get a disposable synthetic plan inside a rollback. Existing
// immutable registry rows and their triggers are never changed or disabled.
async function isolatedCopy(sample, action) {
  const planHash = sha('SYNTHETIC_SHORT_NEGATIVE_' + canonical(sample));
  await db.exec('begin');
  try {
    await db.query(`insert into vnext_market.work_plans(id,universe_id,business_date,cutoff,body_text,body,expected_cards,shard_count)
      select $1,universe_id,business_date,cutoff,body_text,body,expected_cards,shard_count from vnext_market.work_plans where id=$2`, [planHash, f.plan.plan_hash]);
    await db.query(`insert into vnext_market.price_input_pools(plan_id,input_pool_hash,body_hash,body_text,body)
      select $1,input_pool_hash,body_hash,body_text,body from vnext_market.price_input_pools where plan_id=$2`, [planHash, f.plan.plan_hash]);
    await retain(sample, planHash); await action(planHash);
  } finally { await db.exec('rollback'); }
}
function selectedEntries(sample) {
  return sample.packet.evidence.map((e, i) => ({ i, bar: JSON.parse(e.content) }))
    .filter(({ bar }) => bar.schema === 'TAIWAN_MARKET_HISTORY_OBSERVATION_V1' && bar.family === 'PRICE' && bar.date <= sample.encoded.through)
    .sort((a, b) => a.bar.date.localeCompare(b.bar.date)).slice(-20);
}
function changeBar(sample, change) {
  const { i, bar } = selectedEntries(sample).at(-1); change(bar); sample.packet.evidence[i].content = canonical(bar);
}
async function rejectCopy(original, mutate, pattern = /MARKET_REFERENCE_SHORT_BAR_VALUES/) {
  const sample = clone(original); mutate(sample);
  const full = expandTaiwanPriceReference(sample.encoded, {}); delete full.reference_hash;
  full.input_packet_hash = hash(sample.packet);
  sample.encoded = compactTaiwanPriceReference(full, {}, {});
  sample.summary.reference_hash = sample.encoded.reference_hash;
  await isolatedCopy(sample, async planHash => { await assert.rejects(project(sample, { planHash }), pattern); negativeCases++; });
}
async function frozenData() {
  return (await db.query(`select
    (select md5(coalesce(string_agg(row_to_json(r)::text,'' order by plan_id,security_id,horizon),'')) from vnext_market.price_references r) refs,
    (select count(*)::int from vnext_market.cards) cards,(select count(*)::int from vnext_market.editions) editions,
    (select count(*)::int from vnext_market.reviews) reviews,(select count(*)::int from vnext_market.publication_events) publications`)).rows[0];
}
async function failedPatch(sql, pattern) {
  try { await assert.rejects(db.exec(sql), pattern); } finally { await db.exec('rollback'); }
}

try {
  await db.exec('reset role');
  for (const name of ['daily-ai-market-public-supplements.candidate.sql', 'daily-ai-market-action-coverage.candidate.sql',
    'daily-ai-market-action-evidence-id.candidate.sql', 'daily-ai-market-reference-chunks.candidate.sql',
    'daily-ai-market-reference-capacity.candidate.sql', 'daily-ai-market-bvps.candidate.sql', 'daily-ai-market-reference-performance.candidate.sql'])
    await f.executeFile(name);
  const original = await metadata(); assert.equal(original.body_md5, beforeHash);
  for (const sample of samples) await retain(sample);
  const snapshot = await frozenData(); assert.equal(snapshot.reviews, 0); assert.equal(snapshot.publications, 0);
  for (const sample of samples) {
    if (sample.security_id.startsWith('TWSE:')) await assert.rejects(project(sample), /MARKET_REFERENCE_SHORT_BAR_VALUES/);
    else assert.deepEqual(await project(sample), { SHORT: sample.summary, MEDIUM: null, LONG: null });
  }
  pass('exact post-BVPS baseline reproduces TWSE rejection while TPEx succeeds', { real_samples: real.samples.length });

  await failedPatch(rollback, /MARKET_SHORT_SCOPE_ROLLBACK_BASELINE/);
  await db.exec(candidate); const patched = await metadata(); assert.equal(patched.body_md5, afterHash);
  for (const key of ['acl', 'owner', 'prosecdef', 'provolatile', 'proconfig']) assert.deepEqual(patched[key], original[key]);
  for (const sample of samples) assert.deepEqual(await project(sample), { SHORT: sample.summary, MEDIUM: null, LONG: null });
  pass('market-specific complete scopes accept unchanged TWSE and TPEx observed ranges', {
    samples: samples.map(s => ({ security_id: s.security_id, provenance: s.provenance, quote_date: s.summary.quote_date,
      current_price: s.summary.current_price, lower: s.summary.lower, upper: s.summary.upper, packet_hash: hash(s.packet),
      reference_hash: s.summary.reference_hash, scopes: [...new Set(selectedEntries(s).map(({ bar }) => bar.session_scope))] })) });

  for (const sample of samples.slice(0, 2)) {
    const wrong = sample.security_id.startsWith('TWSE:') ? 'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES' : 'OFFICIAL_STOCK_DAY';
    for (const scope of [wrong, null, undefined, 'TWSE_REPORTED_EXCLUDES_BLOCK_TRADES', 'UNKNOWN'])
      await rejectCopy(sample, s => changeBar(s, b => { if (scope === undefined) delete b.session_scope; else b.session_scope = scope; }));
    for (const complete of [false, null, undefined, 'true', 1])
      await rejectCopy(sample, s => changeBar(s, b => { if (complete === undefined) delete b.all_trades_session_complete; else b.all_trades_session_complete = complete; }));
  }
  const emerging = clone(samples[0]); emerging.security_id = 'EMERGING:9103';
  emerging.summary.symbol = '9103'; emerging.packet.symbol = '9103'; emerging.encoded.security_id = emerging.security_id;
  for (const e of emerging.packet.evidence) { const b = JSON.parse(e.content); b.market = 'EMERGING'; b.symbol = '9103'; e.content = canonical(b); }
  emerging.encoded.input_packet_hash = hash(emerging.packet);
  await isolatedCopy(emerging, async planHash => { await assert.rejects(project(emerging, { planHash }), /MARKET_REFERENCE_SHORT_BAR_VALUES/); negativeCases++; });
  pass('swapped, missing, null and incomplete scopes fail closed; EMERGING remains rejected');

  for (const change of [b => b.symbol = '9999', b => b.market = 'TPEX', b => b.market = null,
    b => b.price_basis = 'ADJUSTED', b => b.currency = 'USD', b => b.close = 0, b => b.open = -1,
    b => b.volume = null, b => b.amount = '100000', b => b.low = b.close + 1, b => b.high = b.close - 1])
    await rejectCopy(samples[0], s => changeBar(s, change));
  await rejectCopy(samples[0], s => { s.packet.cutoff = '2026-01-01T00:00:00Z'; });
  await rejectCopy(samples[0], s => { s.packet.evidence = s.packet.evidence.slice(0, 19); }, /MARKET_REFERENCE_SHORT_BARS/);
  await rejectCopy(samples[0], s => { const entries = selectedEntries(s); const last = entries.at(-1); last.bar.date = entries.at(-2).bar.date;
    s.packet.evidence[last.i].content = canonical(last.bar); }, /MARKET_REFERENCE_SHORT_BARS/);
  await rejectCopy(samples[0], s => { s.summary.lower += 1; }, /MARKET_REFERENCE_SHORT_VALUES/);
  pass('identity, raw currency/basis, positive OHLCVA, chronology, unique bars and calculated range checks remain');

  const sample = samples[0];
  await assert.rejects(project(sample, { refsHash: '0'.repeat(64) }), /MARKET_REFERENCE_PROJECTION_HASH/); negativeCases++;
  await assert.rejects(project(sample, { packetHash: '0'.repeat(64) }), /MARKET_REFERENCE_SHORT_PACKET_HASH/); negativeCases++;
  await assert.rejects(project(sample, { packetText: canonical({ ...sample.packet, company: 'MUTATED' }) }), /MARKET_REFERENCE_SHORT_PACKET_BINDING/); negativeCases++;
  await assert.rejects(project(sample, { refsText: canonical({ SHORT: { ...sample.summary, lower: 1 }, MEDIUM: null, LONG: null }) }), /MARKET_REFERENCE_PROJECTION_BINDING/); negativeCases++;
  const broken = clone(sample); broken.encoded.source_capture_ids[0] = '0'.repeat(64);
  await isolatedCopy(broken, async planHash => { await assert.rejects(project(broken, { planHash }), /MARKET_REFERENCE_SHORT_SOURCE_IDS/); negativeCases++; });
  pass('reference text, immutable summary, input packet and original capture IDs stay bound');

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.exec('set role ' + role);
    try { await assert.rejects(project(sample), /permission denied/); } finally { await db.exec('reset role'); }
  }
  await failedPatch(candidate, /MARKET_SHORT_SCOPE_BASELINE/);
  assert.deepEqual(await frozenData(), snapshot);
  await db.exec(rollback); assert.deepEqual(await metadata(), original); assert.deepEqual(await frozenData(), snapshot);
  await assert.rejects(project(samples[0]), /MARKET_REFERENCE_SHORT_BAR_VALUES/);
  assert.deepEqual(await project(samples[1]), { SHORT: samples[1].summary, MEDIUM: null, LONG: null });
  await db.exec(candidate); assert.equal((await metadata()).body_md5, afterHash);
  for (const sample of samples) assert.deepEqual(await project(sample), { SHORT: sample.summary, MEDIUM: null, LONG: null });
  assert.deepEqual(await frozenData(), snapshot);
  pass('private grants, strict baseline, exact rollback and reapply preserve every stored row and zero reviews/publications', { negative_cases: negativeCases });
  console.log(JSON.stringify({ state: 'PASS', phases: phase, negative_cases: negativeCases, real_samples: real.samples.length,
    body_md5_before: beforeHash, body_md5_after: afterHash, immutable_artifacts: real.artifacts,
    provider_calls: 0, production_writes: 0, scope: 'DISPOSABLE_PGLITE_PROJECTION_NOT_RAW_ADMISSION_OR_RECOMMENDATION_APPROVAL' }));
} finally { await f.close(); }
