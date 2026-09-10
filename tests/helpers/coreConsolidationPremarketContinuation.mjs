// Exact post-PREMARKET continuation; no SQL, business seed, or general retry waiver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadWarmupContinuation, assertManualInputContinuation, assertContinuationArtifactBytes,
  stableInputBytes, WARMUP_INPUT_TABLES } from './coreConsolidationContinuation.mjs';
import { sha256, object, assertCheckpointLineage, validateReplayConfiguration, checkPinnedReplayInputs } from './coreConsolidationReplayRuntime.mjs';
import { resolveConsolidationVendorResponse as vendor } from './coreConsolidationVendorShapes.mjs';

export function assertNarrativeInputSuccessor(before, after) {
  const omit = ({ fixture_id, provenance, news, openai_completion, ...value }) => value;
  assert.deepEqual(omit(after), omit(before), 'Quote/date/phase/provider input must not change');
  assert.equal(after.fixture_id, 'synthetic-full-chain-market-control-20260916-news-v3');
  const { input_successor, ...provenance } = after.provenance;
  assert.deepEqual(provenance, before.provenance); assert.equal(provenance.kind, 'SYNTHETIC_PROVIDER_CONTROL');
  assert.equal(provenance.historical_capture, false); assert.equal(provenance.historical_success_claim, false);
  assert.equal(input_successor.path, 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260916.json');
  assert.equal(input_successor.sha256, sha256(JSON.stringify(before, null, 2) + '\n'));
  assert.equal(after.news.length, 6); assert.equal(new Set(after.news.map(row => row.url)).size, 6);
  for (const row of after.news) {
    assert.deepEqual(Object.keys(row).sort(), ['summary', 'title', 'url']);
    assert.match(row.url, /^https:\/\/fixture\.example\.invalid\/synthetic-news-v3\/[a-z-]+$/);
    assert.ok(!before.news.some(old => old.url === row.url), 'Rejected raw news must never be overwritten');
    assert.match(row.title, /^Synthetic scenario:/); assert.match(row.summary, /^Synthetic market event/);
    assert.ok(row.summary.length >= 200);
  }
  const envelope = ({ id, choices, ...value }) => value;
  assert.deepEqual(envelope(after.openai_completion), envelope(before.openai_completion));
  assert.equal(after.openai_completion.choices.length, 1);
  const choice = after.openai_completion.choices[0]; assert.equal(choice.message.role, 'assistant');
  assert.equal(choice.finish_reason, 'stop'); assert.equal(choice.index, 0);
  const prose = JSON.parse(choice.message.content);
  assert.deepEqual(Object.keys(prose).sort(), ['today_beneficiary_stocks', 'beneficiary_stocks', 'today_quote',
    'free_summary', 'member_research_note', 'member_research_note_v2'].sort());
  assert.deepEqual(prose.today_beneficiary_stocks, []); assert.deepEqual(prose.beneficiary_stocks, []);
  assert.deepEqual(prose.member_research_note_v2.beneficiary_candidates, []);
  assert.ok(typeof prose.today_quote === 'string' && typeof prose.free_summary.one_sentence === 'string');
  assert.ok(prose.member_research_note.length >= 300);
  const inspect = value => { if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      assert.ok(!/(?:score|confidence|^status$|schema_version|revision_id|publication|canonical|accepted|evidence_ids|^gate$)/i.test(key),
        'Provider prose cannot seed computed business authority: ' + key); inspect(item);
    } };
  inspect(prose); return true;
}

export function loadPremarketContinuation(manifest, repo, environment = process.env) {
  assert.equal(manifest.schema_version, 'CORE_CONSOLIDATION_PREMARKET_CONTINUATION_V1');
  assert.equal(manifest.continuation_id, '003'); assert.equal(manifest.mode, 'EXACT_PREMARKET_INPUT_NEWS_SUCCESSOR');
  assert.equal(manifest.historical_success_claim, false); assert.equal(manifest.production_operations_authorized, false);
  const root = '/private/tmp/' + manifest.scope;
  assert.equal(manifest.evidence_directory, root + '-evidence-continuation-003');
  const read = (row, path) => { assert.equal(row.path, path); return JSON.parse(assertContinuationArtifactBytes(readFileSync(path), row.sha256)); };
  const previous = read(manifest.previous_continuation, root + '/continuation-002.json');
  assert.deepEqual(manifest.previous_source_preimages.map(({ archived_path, ...row }) => row), previous.runner_sources);
  for (const row of manifest.previous_source_preimages) {
    assert.equal(row.archived_path, root + '/continuation-002-source-preimages/' + row.path.split('/').at(-1));
    assertContinuationArtifactBytes(readFileSync(row.archived_path), row.sha256);
  }
  const expected = [...previous.runner_sources.map(row => row.path), 'tests/helpers/coreConsolidationPremarketContinuation.mjs'].sort();
  assert.deepEqual(manifest.runner_sources.map(row => row.path).sort(), expected);
  for (const row of manifest.runner_sources) assertContinuationArtifactBytes(readFileSync(resolve(repo, row.path)), row.sha256);
  // The predecessor's actual bytes above stay immutable. Only the new test driver
  // implementation is checked at current paths; all original 53 business-source,
  // 12 bundle, SQL, image, VM, fixture, receipt and general reuse guards still run.
  const predecessor = loadWarmupContinuation({ ...previous, runner_sources: manifest.runner_sources.filter(row => row.path !== expected.find(p => p.endsWith('PremarketContinuation.mjs'))) }, repo, environment);
  const fixture = JSON.parse(readFileSync(predecessor.config.boundary.fixture_file));
  assertManualInputContinuation({ config: predecessor.config, ...predecessor.manual, actual: predecessor.manual.baseline,
    original: predecessor.baseline, originalResult: predecessor.priorResult, fixture });
  const priorResult = read(manifest.failed_result, root + '-evidence-continuation-002/result.json');
  const baseline = read(manifest.readback, root + '/premarket-news-failure-readback-continuation-002.json');
  assert.equal(baseline.prior_result.sha256, manifest.failed_result.sha256);
  assert.equal(baseline.config_sha256, previous.source_successor.active_config.sha256);
  const config = read(manifest.active_config, root + '/replay-config-news-v3.json');
  const omit = ({ boundary, ...value }) => value;
  assert.deepEqual(omit(config), omit(predecessor.config), 'Continuation cannot change runtime, SQL, credentials, clock or date');
  const boundaryOmit = ({ fixture_file, fixture_sha256, ...value }) => value;
  assert.deepEqual(boundaryOmit(config.boundary), boundaryOmit(predecessor.config.boundary));
  assert.equal(config.boundary.fixture_file, resolve(repo, 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260916-news-v3.json'));
  const nextFixture = JSON.parse(readFileSync(config.boundary.fixture_file));
  assertNarrativeInputSuccessor(fixture, nextFixture);
  validateReplayConfiguration(config, environment); checkPinnedReplayInputs(config, repo);
  return { config, manifest, predecessor, priorResult, baseline, fixture, nextFixture, postPremarket: true };
}

export function assertPremarketInputAdoption({ config, priorResult, baseline, actual, predecessor, fixture }) {
  assert.equal(priorResult.scope, config.scope); assert.equal(priorResult.status, 'FAIL');
  assert.equal(priorResult.full_persisted_chain_executed, false); assert.equal(priorResult.historical_success_claim, false);
  assert.equal(priorResult.records.at(-1).stage, 'FIRST_FAILURE');
  assert.equal(priorResult.records.at(-1).error, 'Actual news ingestion required');
  const handlerRows = priorResult.records.filter(row => row.stage.startsWith('handler:'));
  assert.deepEqual(handlerRows.map(row => row.stage), ['fetch-global-market-news', 'generate-sector-rotation',
    'fetch-market-data-v10', 'fetch-global-market-news'].flatMap(slug => ['handler:' + slug, 'handler:' + slug]));
  for (let index = 0; index < handlerRows.length; index += 2) {
    assert.equal(handlerRows[index].request_attempted, true); assert.equal(handlerRows[index].response_received, false);
    assert.equal(handlerRows[index + 1].http, 200); assert.equal(handlerRows[index + 1].business_success, true);
  }
  for (const state of [baseline, actual]) {
    assert.equal(state.scope, config.scope); assert.equal(state.report_date, config.report_date); assert.equal(state.warmup_date, config.warmup_date);
    assert.equal(state.guest.boot_id, config.clock.configuration.bootId); assert.equal(state.prior_result.run_id, priorResult.run_id);
    for (const table of WARMUP_INPUT_TABLES) {
      assert.equal(state.tables[table]?.http, 200, 'Actual table read required: ' + table);
      const expected = { market_data: 11, market_checkpoint_snapshots: 31, market_quotes: 31, market_data_snapshots: 31,
        data_provider_health: 3, trading_day_state: 2, market_news: 4, sector_rotation_scores: 4 }[table] ?? 0;
      assert.equal(state.tables[table].rows.length, expected, 'Unexpected business row: ' + table);
    }
  }
  for (const table of WARMUP_INPUT_TABLES) assert.equal(stableInputBytes(actual.tables[table].rows), stableInputBytes(baseline.tables[table].rows), 'Retained input drift: ' + table);
  assert.equal(stableInputBytes(actual.boundary.receipts), stableInputBytes(baseline.boundary.receipts), 'Unexpected provider calls or receipt drift');
  const rows = table => actual.tables[table].rows, oldRows = table => predecessor.manual.baseline.tables[table].rows;
  for (const table of ['market_checkpoint_snapshots', 'market_quotes', 'market_data_snapshots', 'data_provider_health'])
    for (const original of oldRows(table)) assert.equal(stableInputBytes(rows(table).find(row => row.id === original.id)), stableInputBytes(original), 'Earlier input overwritten: ' + table);
  const warmup = rows('trading_day_state').find(row => row.trading_date === config.warmup_date);
  assert.deepEqual(warmup, oldRows('trading_day_state')[0]); assert.equal(warmup.checkpoint_status['1430'], undefined);
  const lifecycle = rows('trading_day_state').find(row => row.trading_date === config.report_date);
  assert.equal(lifecycle.current_state, 'PREMARKET_CAPTURED'); assert.equal(lifecycle.state_rank, 10);
  assert.deepEqual(Object.keys(lifecycle.checkpoint_status), ['premarket']);
  const immutable = rows('market_checkpoint_snapshots').filter(row => row.trading_date === config.report_date);
  assert.equal(immutable.length, 11);
  const proof = assertCheckpointLineage({ rows: immutable, raw: rows('market_data'), canonical: rows('market_quotes'),
    compatibility: rows('market_data_snapshots'), lifecycle, date: config.report_date, checkpoint: 'PREMARKET' });
  assert.equal(proof.correlation_id, priorResult.records.find(row => row.stage === 'persisted-checkpoint').correlation_id);
  const health = rows('data_provider_health').find(row => row.service_date === config.report_date);
  assert.equal(health.correlation_id, proof.correlation_id); assert.equal(health.status, 'healthy');
  assert.equal(health.requested_count, 11); assert.equal(health.succeeded_count, 11); assert.equal(health.failed_count, 0);
  for (const row of rows('sector_rotation_scores')) { assert.equal(row.score_date, config.warmup_date); assert.ok(row.id); }
  for (const row of rows('market_news')) {
    const original = fixture.news.find(item => item.url === row.url); assert.ok(original);
    assert.equal(row.title, original.title); assert.equal(row.summary, original.summary);
    assert.equal(row.source, 'Synthetic market provider'); assert.equal(row.is_selected, false); assert.ok(row.final_score < 60);
  }
  const receipts = actual.boundary.receipts, previousReceipts = predecessor.manual.baseline.boundary.receipts;
  assert.equal(receipts.length, 37);
  for (const original of previousReceipts) assert.deepEqual(receipts.find(row => row.id === original.id), original);
  const added = receipts.filter(row => !previousReceipts.some(old => old.id === row.id));
  assert.equal(added.length, 17);
  for (const receipt of added) {
    assert.equal(receipt.scope, config.scope); assert.equal(receipt.status, 200);
    assert.equal(receipt.source_kind, 'SYNTHETIC_PROVIDER_CONTROL'); assert.equal(receipt.historical_capture, false);
    assert.equal(receipt.fixture_id, fixture.fixture_id);
  }
  const used = new Set();
  for (const source of immutable) {
    const symbol = object(source.raw).source_symbol;
    const url = source.source === 'finnhub' ? 'https://finnhub.io/api/v1/quote?symbol=' + symbol
      : 'https://api.fugle.tw/marketdata/v1.0/' + (source.source === 'fugle_futopt' ? 'futopt' : 'stock') + '/intraday/quote/' + symbol + (source.source === 'fugle_futopt' ? '?session=afterhours' : '');
    const request = { url, method: 'GET', body: null };
    const found = added.filter(row => row.phase === 'premarket' && row.operation === 'quote' && row.request_sha256 === sha256(JSON.stringify(request)));
    assert.equal(found.length, 1); const receipt = found[0]; used.add(receipt.id);
    const response = vendor(request, fixture, receipt.observed_at); assert.equal(receipt.response_sha256, sha256(JSON.stringify(response.body)));
    assert.equal(receipt.provider, response.provider);
    assert.equal(source.value, response.body.c ?? response.body.price);
    const sourceRaw = object(object(source.raw).source_raw);
    const multiplier = source.symbol === 'US10Y' ? -1 : 1;
    if (source.symbol === 'US10Y') {
      assert.equal(symbol, 'IEF'); assert.equal(sourceRaw.direction_multiplier, -1);
      assert.equal(sourceRaw.proxy_semantics, 'inverse_7_10y_treasury_price_proxy');
    } else assert.equal(sourceRaw.direction_multiplier ?? 1, 1);
    assert.equal(source.change_percent, (response.body.dp ?? response.body.changePercent) * multiplier);
    assert.equal(Date.parse(source.source_timestamp), response.body.t ? response.body.t * 1000 : Date.parse(response.body.lastUpdated));
  }
  for (const phase of ['prior-close-warmup', 'premarket']) for (const category of ['general', 'merger', 'ipo']) {
    const request = { url: 'https://finnhub.io/api/v1/news?category=' + category + '&minId=0', method: 'GET', body: null };
    const found = added.filter(row => row.phase === phase && row.operation === 'news' && row.request_sha256 === sha256(JSON.stringify(request)));
    assert.equal(found.length, 1); const receipt = found[0]; used.add(receipt.id);
    assert.equal(receipt.provider, 'finnhub');
    assert.equal(receipt.response_sha256, sha256(JSON.stringify(vendor(request, fixture, receipt.observed_at).body)));
  }
  assert.equal(used.size, 17);
  return { status: 'PRECONDITION_INPUT_ONLY', checkpoint: 'PREMARKET', ...proof, previous_news_failure: 'FAIL_RETAINED',
    warmup_lifecycle: 'WARMUP_LIFECYCLE_FAIL_RETAINED', publication_adopted: false, market_fetch_resent: false, direct_business_seed_writes: 0 };
}
