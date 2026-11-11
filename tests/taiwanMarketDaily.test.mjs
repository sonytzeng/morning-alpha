// Explicitly synthetic fixtures exercise the real orchestrator, normalizers,
// research engine and staging adapter. RPC transport is an in-memory double;
// this file does not assert SQL, investment-method, browser or capacity approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { runTaiwanMarketDaily, taiwanDailyCalendar } from '../scripts/operations/run-taiwan-market-daily.mjs';
import { marketSnapshotHash, TAIWAN_COMPANY_SOURCES } from '../research/taiwan-market-universe.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const at = '2026-11-11T11:00:00.000Z';
const symbols = { TWSE: '1000', TPEX: '2000', EMERGING: '3000' };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-taiwan-daily-'));
  let now = at, count = 0, failSource = null, altered = null;
  const receipts = [];
  const acquire = async ({ source, directory }) => {
    count++;
    const receipt = { schema: 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', source_id: source.id, url: source.url, format: source.format,
      state: 'CAPTURED', status: 200, attempts: 1, started_at: now, received_at: now, historical_knowledge: false,
      synthetic_fixture: true };
    if (source.id === failSource) return { ...receipt, state: 'UNAVAILABLE', status: 503, error: 'SYNTHETIC_PROVIDER_FAILURE' };
    const roster = TAIWAN_COMPANY_SOURCES[source.id];
    const rows = roster ? [{ 公司代號: symbols[roster.market], 公司名稱: 'Synthetic issuer ' + roster.market,
      公司簡稱: 'Synthetic ' + roster.market, 產業別: '01', 出表日期: '20261111',
      [roster.market === 'TPEX' ? '上櫃日期' : '上市日期']: '20200101' }] : [];
    const text = source.format === 'json' ? JSON.stringify(rows) : Object.keys(rows[0]).join(',') + '\n' + Object.values(rows[0]).join(',') + '\n';
    const bytes = Buffer.from(text);
    await mkdir(directory, { recursive: true }); const raw = join(directory, source.id + '.' + source.format); await writeFile(raw, bytes);
    Object.assign(receipt, { sha256: sha(bytes), bytes: bytes.length, raw_path: raw, row_count: rows.length });
    receipts.push(receipt);
    await writeFile(join(directory, 'acquisition-synthetic.json'), JSON.stringify({ schema: 'TAIWAN_PUBLIC_ACQUISITION_V1', receipts: [receipt] }));
    return altered ? altered(receipt) : receipt;
  };
  return { root, acquire, clock: () => now, pause: async () => {}, count: () => count, receipts,
    setNow: value => { now = value; }, fail: id => { failSource = id; }, alter: callback => { altered = callback; },
    options: { output: root, slot: 'POSTCLOSE' }, close: () => rm(root, { recursive: true, force: true }) };
}
const readState = result => readFile(result.snapshot_file, 'utf8').then(JSON.parse);
const readPart = (f, descriptor) => readFile(join(f.root, descriptor.file), 'utf8').then(JSON.parse);
function rpcDouble({ lose = null, reject = null } = {}) {
  const calls = [], captures = new Map(), claims = new Map(), results = new Map();
  let plan, universe, lost = false, edition = null, computationReads = 0;
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (reject === name) return { data: null, error: { code: '42501' } };
    let data;
    if (name === 'stage_daily_ai_market_capture_v2') {
      const receipt = JSON.parse(args.p_receipt_text);
      assert.equal(sha(args.p_receipt_text), args.p_receipt_hash); assert.equal(sha(args.p_body_text), receipt.sha256);
      const id = marketSnapshotHash({ source_id: receipt.source_id, url: receipt.url, source_sha256: receipt.sha256, received_at: receipt.received_at });
      const replayed = captures.has(id); captures.set(id, receipt);
      data = { schema: 'DAILY_AI_MARKET_CAPTURE_STAGED_V2', capture_id: id, receipt_hash: args.p_receipt_hash, replayed };
    } else if (name === 'stage_daily_ai_market_work_plan_v2') {
      const replayed = !!plan; plan = JSON.parse(args.p_plan_text); universe = JSON.parse(args.p_universe_text);
      data = { schema: 'DAILY_AI_MARKET_WORK_PLAN_STAGED_V2', plan_hash: plan.plan_hash, universe_hash: universe.universe_hash,
        shards: plan.shards.length, member_published: false, replayed };
    } else if (name === 'claim_daily_ai_market_shard_v2') {
      assert.equal(args.p_plan_hash, plan.plan_hash);
      const existing = claims.get(args.p_request_key);
      const shard = existing?.shard ?? plan.shards.find(item => !results.has(item.shard_id));
      if (!shard) data = { schema: 'DAILY_AI_MARKET_SHARD_CLAIM_V2', state: 'NO_WORK', plan_hash: plan.plan_hash, remaining: 0, exhausted: 0 };
      else {
        const work = existing ?? { schema: 'DAILY_AI_MARKET_SHARD_CLAIM_V2', state: 'CLAIMED', plan_hash: plan.plan_hash,
          universe_hash: universe.universe_hash, shard, request_key: args.p_request_key, lease_id: randomUUID(),
          companies: universe.companies.filter(company => shard.security_ids.includes(company.security_id)) };
        claims.set(args.p_request_key, work);
        data = results.has(shard.shard_id) ? { ...work, state: 'COMPLETED', result_hash: results.get(shard.shard_id) } : work;
      }
    } else if (name === 'stage_daily_ai_market_shard_v2') {
      computationReads++;
      assert.equal(sha(args.p_result_text), args.p_result_hash);
      const body = JSON.parse(args.p_result_text), replayed = results.has(args.p_shard_id);
      for (const item of body.items) {
        const packet = JSON.parse(item.packet_text), analysis = JSON.parse(item.analysis_text);
        assert.equal(analysis.input_hash, marketSnapshotHash(packet)); assert.equal(analysis.model_generated, false);
        assert.equal(analysis.member_published, false); assert.equal(analysis.horizons.length, 3);
      }
      results.set(args.p_shard_id, args.p_result_hash);
      data = { schema: 'DAILY_AI_MARKET_SHARD_STAGED_V2', plan_hash: plan.plan_hash, shard_id: args.p_shard_id,
        result_hash: args.p_result_hash, cards: body.items.length * 3, member_published: false, review_required: true, replayed };
    } else if (name === 'finish_daily_ai_market_edition_v2') {
      assert.equal(results.size, plan.shards.length); const replayed = !!edition;
      if (edition) assert.equal(args.p_expires_at, edition.expiry);
      edition ??= { id: sha(plan.plan_hash + args.p_expires_at), expiry: args.p_expires_at };
      data = { schema: 'DAILY_AI_MARKET_EDITION_STAGED_V2', edition_id: edition.id, plan_hash: plan.plan_hash,
        member_published: false, review_required: true, replayed };
    } else assert.fail('Unexpected or publication RPC: ' + name);
    if (!lost && name === lose) { lost = true; throw Error('SYNTHETIC_LOST_ACK'); }
    return { data, error: null };
  };
  return { rpc, calls, captures, results, computationReads: () => computationReads };
}

test('canonical calendar distinguishes premarket, 17:05, weekend, exceptional closure and uncovered dates', () => {
  assert.equal(taiwanDailyCalendar('2026-11-11T00:00:00.000Z').expected_quote_date, '2026-11-10');
  assert.equal(taiwanDailyCalendar('2026-11-11T09:04:59.999Z').expected_quote_date, '2026-11-10');
  assert.equal(taiwanDailyCalendar('2026-11-11T09:05:00.000Z').expected_quote_date, '2026-11-11');
  assert.equal(taiwanDailyCalendar('2026-11-14T11:00:00.000Z').state, 'MARKET_CLOSED');
  assert.equal(taiwanDailyCalendar('2026-07-10T11:00:00.000Z').state, 'MARKET_CLOSED');
  assert.equal(taiwanDailyCalendar('2027-01-04T11:00:00.000Z').state, 'CALENDAR_UNCOVERED');
});

test('all 55 dataset attempts feed the real 3-market engine; repeat snapshot downloads and RPC calls are zero', async () => {
  const f = await fixture();
  try {
    const server = rpcDouble(), first = await runTaiwanMarketDaily(f.options, { ...f, rpc: server.rpc });
    assert.equal(first.state, 'PREPARED_REVIEW_REQUIRED'); assert.equal(f.count(), 55); assert.equal(server.calls.length, 0);
    assert.deepEqual(first.universe.markets, { TWSE: 1, TPEX: 1, EMERGING: 1 }); assert.equal(first.universe.cards, 9);
    const state = await readState(first), facts = await readPart(f, state.artifacts.facts), run = await readPart(f, state.artifacts.research);
    assert.equal(facts.captured_dataset_count, 55); assert.equal(run.metadata.analysis_origin, 'DETERMINISTIC_SCREENING');
    assert.equal(run.capture_proof.state, 'COMPLETE_RAW_CAPTURE_BINDING'); assert.equal(run.metadata.coverage.formal_recommendations, 0);
    const shard = await readPart(f, state.artifacts.shards[0].artifact);
    assert.equal(shard.stocks.length, 3); assert.equal(shard.cards.length, 9);
    assert.ok(shard.cards.every(card => card.status === 'INSUFFICIENT'));
    f.setNow('2026-11-11T12:00:00.000Z');
    const repeat = await runTaiwanMarketDaily(f.options, { ...f, rpc: server.rpc });
    assert.equal(f.count(), 55); assert.equal(repeat.cutoff, first.cutoff); assert.deepEqual(repeat.preparation, first.preparation);
    assert.equal(server.calls.length, 0); assert.equal(repeat.member_published, false);
  } finally { await f.close(); }
});

test('unchanged bytes retain their earliest real receipt while the next day records a new observation', async () => {
  const f = await fixture();
  try {
    const old = await runTaiwanMarketDaily(f.options, f); const prior = await readState(old);
    f.setNow('2026-11-12T11:00:00.000Z');
    const next = await runTaiwanMarketDaily(f.options, f), state = await readState(next);
    assert.equal(f.count(), 110); assert.equal(next.state, 'PREPARED_REVIEW_REQUIRED');
    for (const source of Object.keys(state.selected)) {
      assert.equal(state.selected[source].receipt.received_at, at);
      assert.equal(state.acquisition[source].receipt.received_at, '2026-11-12T11:00:00.000Z');
      assert.equal(state.acquisition[source].reused_earlier_receipt, true);
      assert.deepEqual(state.selected[source], prior.selected[source]);
    }
    const facts = await readPart(f, state.artifacts.facts);
    assert.ok(facts.securities.flatMap(stock => stock.observations).every(row => row.available_at === at));
    assert.equal(state.calendar.expected_quote_date, '2026-11-12');
  } finally { await f.close(); }
});

test('input refresh uses the freshly captured complete roster and finishes before the immutable cutoff', async () => {
  const f = await fixture(); let refreshes = 0;
  try {
    const refreshInputs = async (options, dependencies) => {
      refreshes++;
      assert.equal(f.count(), 55);
      const universe = JSON.parse(await readFile(options.universeFile, 'utf8'));
      assert.equal(universe.total, 3);
      assert.deepEqual(universe.counts, { TWSE: 1, TPEX: 1, EMERGING: 1 });
      assert.equal(dependencies.clock(), at);
      assert.equal(options.slot, 'POSTCLOSE');
      assert.equal(options.allowNetwork, false);
      f.setNow('2026-11-11T11:05:00.000Z');
      return { state: 'INPUTS_READY_WITH_SOURCE_LIMITATIONS', manifest_hash: 'a'.repeat(64),
        issues: ['SYNTHETIC_REFRESH_WITHOUT_FINANCIAL_HISTORY'], counts: {}, provider_requests: 0 };
    };
    const options = { ...f.options, inputCacheDir: join(f.root, 'input-cache'), allowInputNetwork: false };
    const first = await runTaiwanMarketDaily(options, { ...f, refreshInputs });
    assert.equal(first.state, 'PREPARED_REVIEW_REQUIRED');
    assert.equal(first.cutoff, '2026-11-11T11:05:00.000Z');
    const state = await readState(first);
    assert.equal(state.input_refresh.complete, true);
    assert.equal(state.input_refresh.manifest_hash, 'a'.repeat(64));
    assert.equal((await readPart(f, state.artifacts.plan)).cutoff, first.cutoff);
    f.setNow('2026-11-11T11:10:00.000Z');
    const again = await runTaiwanMarketDaily(options, { ...f, refreshInputs });
    assert.equal(again.cutoff, first.cutoff);
    assert.equal(refreshes, 1);
    assert.equal(f.count(), 55);
  } finally { await f.close(); }
});

test('failed current dataset receipt is retained and never retried; other securities remain analyzable', async () => {
  const f = await fixture();
  try {
    const catalog = JSON.parse(await readFile(new URL('../research/taiwan-market-sources.json', import.meta.url), 'utf8'));
    const failed = catalog.sources.find(source => source.group === 'daily').id; f.fail(failed);
    const first = await runTaiwanMarketDaily(f.options, f);
    assert.equal(first.state, 'PREPARED_REVIEW_REQUIRED'); assert.equal(first.universe.captured_sources, 54);
    assert.deepEqual(first.failed_sources.map(row => row.source_id), [failed]);
    const repeat = await runTaiwanMarketDaily(f.options, f); assert.equal(f.count(), 55); assert.deepEqual(repeat.failed_sources, first.failed_sources);
  } finally { await f.close(); }
});

test('a failed fresh roster cannot silently fall back to yesterday even when its bytes are cached', async () => {
  const f = await fixture();
  try {
    await runTaiwanMarketDaily(f.options, f); f.setNow('2026-11-12T11:00:00.000Z'); f.fail('twse_companies');
    const blocked = await runTaiwanMarketDaily(f.options, f);
    assert.equal(blocked.state, 'BLOCKED_ACQUISITION'); assert.equal(blocked.preparation, null);
    assert.equal(blocked.failed_sources[0].source_id, 'twse_companies');
    await runTaiwanMarketDaily(f.options, f); assert.equal(f.count(), 110);
  } finally { await f.close(); }
});

test('closed calendar snapshots make no downloads and new snapshots cannot backdate acquisition', async () => {
  const f = await fixture();
  try {
    f.setNow('2026-11-14T11:00:00.000Z');
    assert.equal((await runTaiwanMarketDaily(f.options, f)).state, 'SKIPPED_MARKET_CLOSED'); assert.equal(f.count(), 0);
    await assert.rejects(runTaiwanMarketDaily({ ...f.options, businessDate: '2026-11-13' }, f), /CANNOT_BACKDATE/);
    assert.equal(f.count(), 0);
  } finally { await f.close(); }
});

test('forged raw hash aborts before analysis and preserves an unresolved acquisition intent', async () => {
  const f = await fixture();
  try {
    f.alter(receipt => ({ ...receipt, sha256: '0'.repeat(64) }));
    await assert.rejects(runTaiwanMarketDaily(f.options, f), /RAW_HASH/);
    const state = JSON.parse(await readFile(join(f.root, 'snapshots/2026-11-11/POSTCLOSE/state.json'), 'utf8'));
    assert.equal(state.artifacts, null); assert.equal(state.acquisition.twse_companies.state, 'IN_FLIGHT'); assert.equal(f.count(), 1);
  } finally { await f.close(); }
});

test('lost shard acknowledgement stops; explicit resume reuses UUID and completes without recalculating the stored shard', async () => {
  const f = await fixture(), server = rpcDouble({ lose: 'stage_daily_ai_market_shard_v2' });
  try {
    const options = { ...f.options, stage: true }, deps = { ...f, rpc: server.rpc };
    const first = await runTaiwanMarketDaily(options, deps); assert.equal(first.state, 'STAGING_STOPPED');
    const saved = await readState(first), request = saved.stage.shards[0].request_key;
    assert.equal(saved.stage.shards[0].outcome.state, 'OUTCOME_UNKNOWN'); assert.equal(server.computationReads(), 1);
    const count = server.calls.length;
    assert.equal((await runTaiwanMarketDaily(options, deps)).state, 'STAGING_STOPPED'); assert.equal(server.calls.length, count);
    f.setNow('2026-11-11T11:02:00.000Z');
    const resumed = await runTaiwanMarketDaily({ ...options, resume: true }, deps);
    assert.equal(resumed.state, 'STAGED_REVIEW_REQUIRED'); assert.equal(resumed.member_published, false);
    assert.equal(server.computationReads(), 1); assert.equal(f.count(), 55);
    const after = await readState(resumed); assert.equal(after.stage.shards[0].request_key, request);
    assert.equal(after.stage.shards[0].outcome.replayed, true); assert.equal(after.expires_at, saved.expires_at);
    assert.deepEqual(after.stage.shards[0].attempts.map(attempt => attempt.outcome.state), ['OUTCOME_UNKNOWN', 'STAGED']);
    const last = server.calls.at(-1); assert.equal(last.name, 'finish_daily_ai_market_edition_v2'); assert.equal(last.args.p_expires_at, saved.expires_at);
    const settledCalls = server.calls.length;
    await runTaiwanMarketDaily({ ...options, resume: true }, deps); assert.equal(server.calls.length, settledCalls);
    assert.ok(server.calls.every(call => !/review|publish|approve/.test(call.name)));
  } finally { await f.close(); }
});

test('lost finish acknowledgement uses exactly the original expiry on explicit readback', async () => {
  const f = await fixture(), server = rpcDouble({ lose: 'finish_daily_ai_market_edition_v2' });
  try {
    const options = { ...f.options, stage: true }, deps = { ...f, rpc: server.rpc };
    const first = await runTaiwanMarketDaily(options, deps); assert.equal(first.state, 'STAGING_STOPPED');
    const expiry = (await readState(first)).expires_at; f.setNow('2026-11-11T14:00:00.000Z');
    const second = await runTaiwanMarketDaily({ ...options, resume: true }, deps); assert.equal(second.state, 'STAGED_REVIEW_REQUIRED');
    const calls = server.calls.filter(call => call.name === 'finish_daily_ai_market_edition_v2');
    assert.equal(calls.length, 2); assert.ok(calls.every(call => call.args.p_expires_at === expiry));
  } finally { await f.close(); }
});

test('SQL rejection is not retried and expiry prevents any new staging call', async () => {
  const f = await fixture(), server = rpcDouble({ reject: 'stage_daily_ai_market_work_plan_v2' });
  try {
    const options = { ...f.options, stage: true }, deps = { ...f, rpc: server.rpc };
    assert.equal((await runTaiwanMarketDaily(options, deps)).state, 'STAGING_STOPPED');
    const count = server.calls.length;
    assert.equal((await runTaiwanMarketDaily({ ...options, resume: true }, deps)).state, 'STAGING_STOPPED'); assert.equal(server.calls.length, count);
    f.setNow('2026-11-12T12:00:00.000Z');
    assert.equal((await runTaiwanMarketDaily({ ...options, businessDate: '2026-11-11', resume: true }, deps)).state, 'BLOCKED_EXPIRED');
    assert.equal(server.calls.length, count); assert.equal(f.count(), 55);
  } finally { await f.close(); }
});

test('retained acquisition import does not call providers or replace original availability with the current cutoff', async () => {
  const f = await fixture();
  try {
    await runTaiwanMarketDaily(f.options, f);
    const importDir = join(f.root, 'retained-input'); await mkdir(importDir);
    await writeFile(join(importDir, 'acquisition-retained.json'), JSON.stringify({ schema: 'TAIWAN_PUBLIC_ACQUISITION_V1', receipts: f.receipts }));
    f.setNow('2026-11-11T12:00:00.000Z');
    const result = await runTaiwanMarketDaily({ ...f.options, slot: 'PREMARKET', acquisitionDir: importDir },
      { ...f, acquire: async () => { assert.fail('Retained import must not access network'); } });
    const state = await readState(result), facts = await readPart(f, state.artifacts.facts);
    assert.equal(result.state, 'PREPARED_REVIEW_REQUIRED'); assert.equal(state.acquisition_mode, 'RETAINED_CAPTURE_IMPORT_NO_PROVIDER_CALL');
    assert.equal(result.cutoff, '2026-11-11T12:00:00.000Z');
    assert.ok(facts.securities.flatMap(stock => stock.observations).every(row => row.available_at === at)); assert.equal(f.count(), 55);
  } finally { await f.close(); }
});

test('shard work is bounded per invocation and the next invocation continues the same immutable plan', async () => {
  const f = await fixture(), server = rpcDouble();
  try {
    const options = { ...f.options, stage: true, maxShards: 1 }, deps = { ...f, rpc: server.rpc };
    const first = await runTaiwanMarketDaily(options, deps); assert.equal(first.state, 'STAGING_PAUSED_RESOURCE_LIMIT');
    const planHash = (await readState(first)).stage.plan.outcome.plan_hash;
    const second = await runTaiwanMarketDaily(options, deps); assert.equal(second.state, 'STAGED_REVIEW_REQUIRED');
    assert.equal((await readState(second)).stage.plan.outcome.plan_hash, planHash); assert.equal(server.computationReads(), 1);
  } finally { await f.close(); }
});

test('history calculations without the cited raw capture cannot enter private staging', async () => {
  const f = await fixture(), server = rpcDouble();
  try {
    const source_capture = { source_id: 'TWSE_DAILY_20261111',
      source_url: 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20261111&type=ALLBUT0999&response=json',
      source_sha256: 'b'.repeat(64), source_bytes: 123, received_at: at, row_index: 0, row_path: ['tables', 0, 'data', 0],
      source_row_hash: 'c'.repeat(64), symbol_field: '0' };
    source_capture.capture_id = marketSnapshotHash({ source_id: source_capture.source_id, url: source_capture.source_url,
      source_sha256: source_capture.source_sha256, received_at: source_capture.received_at });
    const historyBody = { schema: 'TAIWAN_SECURITY_HISTORY_V1', security_id: 'TWSE:1000', expected_dates: ['2026-11-11'],
      bars: [{ market: 'TWSE', symbol: '1000', date: '2026-11-11', open: 10, high: 11, low: 9, close: 10,
        volume: 100, amount: 1000, available_at: at, price_basis: 'RAW_UNADJUSTED',
        session_scope: 'OFFICIAL_STOCK_DAY', all_trades_session_complete: true, source_capture }] };
    const historyFile = join(f.root, 'synthetic-history.json');
    await writeFile(historyFile, JSON.stringify({ stocks: [{ ...historyBody, history_hash: marketSnapshotHash(historyBody) }] }));
    const result = await runTaiwanMarketDaily({ ...f.options, historyFile, stage: true }, { ...f, rpc: server.rpc });
    assert.equal(result.state, 'BLOCKED_CAPTURE_PROOF'); assert.equal(server.calls.length, 0);
    const state = await readState(result); assert.deepEqual(state.capture_proof.missing_capture_ids, [source_capture.capture_id]);
    assert.equal(result.universe.cards, 9); assert.equal(result.member_published, false);
  } finally { await f.close(); }
});

test('a prepared snapshot does not silently accept different historical inputs on rerun', async () => {
  const f = await fixture();
  try {
    const historyFile = join(f.root, 'synthetic-history.json'); await writeFile(historyFile, JSON.stringify({ stocks: [] }));
    const options = { ...f.options, historyFile };
    await runTaiwanMarketDaily(options, f); await writeFile(historyFile, JSON.stringify({ stocks: [], changed: true }));
    await assert.rejects(runTaiwanMarketDaily(options, f), /SNAPSHOT_INPUT_DRIFT/); assert.equal(f.count(), 55);
  } finally { await f.close(); }
});
