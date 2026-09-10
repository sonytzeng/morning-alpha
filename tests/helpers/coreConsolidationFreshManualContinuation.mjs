// Exact successful manual input after a runner-only correlation assertion FAIL.
// No business write, generic reuse waiver, report adoption, or historical PASS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, object, canonicalNumeric, validateReplayConfiguration, checkPinnedReplayInputs } from './coreConsolidationReplayRuntime.mjs';
import { WARMUP_INPUT_TABLES, stableInputBytes, assertContinuationArtifactBytes } from './coreConsolidationContinuation.mjs';
import { resolveConsolidationVendorResponse as vendor } from './coreConsolidationVendorShapes.mjs';

export const FRESH_MANUAL_PINS = Object.freeze({
  scope: 'ma-consolidation-v1-20260909154500', report_date: '2026-09-17', warmup_date: '2026-09-16',
  config: '43ba97676f22c5656e8794d3123f6ee108d9af0d0c72b2e03335b3679f762aae',
  schema: 'df3e52f1bc2e49e4434ca22de822cf0c6dda506fc4fa0cabaa2cae31a938ff16',
  failed_result: '1d254ccbd968ebf21e9f433d266f9f98386d74c0b34afcac0ec78fa6e72b5a84',
  readback: '0303204a9ed405458eeb3794c4ec9bdb79cf77419cf6a7014be3f3292b4b6a89',
  archive: 'f15111ab8465987214b73b94ba6d316b466986c490ef243be2b954720206d019',
  fixture: '44aabd2372919131f717ead7fb46e459d5dc1c1599a62b6189934f1683f68628',
  correlation: '8139c37c-e27e-4a83-b2b7-4797003cd956', requested_correlation: '935d6050-ec59-4236-9ec7-b68cc49fd50f',
});
export function localFetchCorrelationHeaders(path, body) {
  if (path !== '/functions/v1/fetch-market-data-v10' || body?.correlation_id === undefined) return {};
  assert.match(body.correlation_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return { 'x-correlation-id': body.correlation_id };
}
export function loadFreshManualContinuation(manifest, repo, environment = process.env) {
  const pins = FRESH_MANUAL_PINS, root = '/private/tmp/' + pins.scope;
  assert.equal(manifest.schema_version, 'CORE_CONSOLIDATION_FRESH_MANUAL_CONTINUATION_V1');
  assert.equal(manifest.scope, pins.scope); assert.equal(manifest.mode, 'EXACT_FRESH_MANUAL_INPUT_CONTINUATION');
  assert.equal(manifest.continuation_id, '001'); assert.equal(manifest.historical_success_claim, false);
  assert.equal(manifest.production_operations_authorized, false);
  assert.equal(manifest.evidence_directory, root + '-evidence-continuation-001');
  const read = (row, path, pin) => {
    assert.equal(row.path, path); assert.equal(row.sha256, pin);
    return JSON.parse(assertContinuationArtifactBytes(readFileSync(path), pin));
  };
  const config = read(manifest.config, root + '/replay-config.json', pins.config);
  validateReplayConfiguration(config, environment); checkPinnedReplayInputs(config, repo);
  assert.equal(config.scope, pins.scope); assert.equal(config.report_date, pins.report_date); assert.equal(config.warmup_date, pins.warmup_date);
  assert.equal(config.attempt, 1); assert.deepEqual(config.previous_attempt_results, []);
  const schema = config.bootstrap_receipts.find(row => row.path === root + '/schema-rebuild-results.json');
  assert.equal(schema.sha256, pins.schema);
  const priorResult = read(manifest.failed_result, root + '-evidence/result.json', pins.failed_result);
  const baseline = read(manifest.readback, root + '/manual-correlation-failure-readback.json', pins.readback);
  const archive = read(manifest.source_preimages, root + '/executed-source-preimages/manifest.json', pins.archive);
  assert.equal(archive.scope, pins.scope); assert.equal(archive.config_sha256, pins.config); assert.equal(archive.files.length, 75);
  for (const row of archive.files) {
    assert.ok(!row.path.includes('..') && !row.path.startsWith('/')); assert.equal(row.archived_path, root + '/executed-source-preimages/' + row.path);
    assertContinuationArtifactBytes(readFileSync(row.archived_path), row.sha256);
  }
  const expected = ['coreConsolidationContinuation.mjs', 'coreConsolidationPremarketContinuation.mjs', 'coreConsolidationReplayRuntime.mjs',
    'coreConsolidationFreshManualContinuation.mjs'].map(name => 'tests/helpers/' + name).concat('tests/integration/coreConsolidationFullChain.e2e.mjs').sort();
  assert.deepEqual(manifest.runner_sources.map(row => row.path).sort(), expected);
  for (const row of manifest.runner_sources) assertContinuationArtifactBytes(readFileSync(resolve(repo, row.path)), row.sha256);
  const fixtureBytes = readFileSync(config.boundary.fixture_file); assert.equal(sha256(fixtureBytes), pins.fixture);
  return { config, manifest, priorResult, baseline, fixture: JSON.parse(fixtureBytes), freshManual: true, manual: { baseline, priorResult } };
}
export function assertFreshManualInputAdoption({ config, priorResult, baseline, actual, fixture }) {
  const pins = FRESH_MANUAL_PINS;
  for (const key of ['scope', 'report_date', 'warmup_date']) assert.equal(config[key], pins[key]);
  assert.equal(priorResult.scope, pins.scope); assert.equal(priorResult.status, 'FAIL');
  assert.equal(priorResult.full_persisted_chain_executed, false); assert.equal(priorResult.historical_success_claim, false);
  assert.deepEqual(priorResult.records.map(row => row.stage), ['historical-evidence-boundary', 'fresh-business-scope-readback',
    'real-runtime-clock', 'handler:fetch-market-data-v10', 'handler:fetch-market-data-v10', 'FIRST_FAILURE']);
  const request = priorResult.records[3], response = priorResult.records[4];
  assert.equal(request.request_attempted, true); assert.equal(request.request_body.phase, 'manual_backfill');
  assert.equal(request.request_body.checkpoint, 'manual'); assert.equal(request.request_body.correlation_id, pins.requested_correlation);
  assert.equal(response.http, 200); assert.equal(response.business_success, true);
  assert.equal(response.response_body.correlation_id, pins.correlation); assert.equal(response.response_body.immutable_evidence_complete, true);
  assert.match(priorResult.records.at(-1).error, /Expected values to be strictly equal/);
  assert.ok(priorResult.records.at(-1).error.includes(pins.correlation) && priorResult.records.at(-1).error.includes(pins.requested_correlation));
  const rows = (state, table) => { assert.equal(state.tables[table]?.http, 200, table); assert.ok(Array.isArray(state.tables[table].rows)); return state.tables[table].rows; };
  for (const state of [baseline, actual]) {
    for (const key of ['scope', 'report_date', 'warmup_date']) assert.equal(state[key], pins[key]);
    assert.equal(state.guest.boot_id, config.clock.configuration.bootId);
    assert.equal(state.config_sha256, pins.config); assert.equal(state.prior_result.sha256, pins.failed_result);
    assert.equal(state.prior_result.run_id, priorResult.run_id); assert.equal(state.prior_result.status, 'FAIL');
    for (const table of WARMUP_INPUT_TABLES) assert.equal(rows(state, table).length,
      ['market_data', 'market_checkpoint_snapshots', 'market_quotes', 'market_data_snapshots'].includes(table) ? 11
        : ['data_provider_health', 'trading_day_state'].includes(table) ? 1 : 0, 'Unexpected business row: ' + table);
  }
  for (const table of WARMUP_INPUT_TABLES) assert.equal(stableInputBytes(rows(actual, table)), stableInputBytes(rows(baseline, table)), 'Actual retained row drift: ' + table);
  assert.equal(stableInputBytes(actual.boundary.receipts), stableInputBytes(baseline.boundary.receipts));
  assert.equal(fixture.report_date, pins.report_date); assert.equal(fixture.warmup_date, pins.warmup_date); assert.equal(fixture.provenance.historical_capture, false);
  const day = rows(actual, 'trading_day_state')[0], entry = object(day.checkpoint_status.manual), correlation = pins.correlation;
  assert.equal(day.trading_date, pins.warmup_date); assert.equal(day.current_state, 'MANUAL_CAPTURED'); assert.equal(day.state_rank, 0);
  assert.equal(day.completed_at, null); assert.deepEqual(Object.keys(day.checkpoint_status), ['manual']);
  assert.equal(entry.status, 'SUCCEEDED'); assert.equal(entry.correlation_id, correlation); assert.equal(entry.metadata.core_batch_complete, true);
  const health = rows(actual, 'data_provider_health')[0];
  assert.equal(health.service_date, pins.warmup_date); assert.equal(health.phase, 'manual_backfill'); assert.equal(health.checkpoint, 'manual');
  assert.equal(health.correlation_id, correlation); assert.equal(health.status, 'healthy');
  assert.equal(health.requested_count, 11); assert.equal(health.succeeded_count, 11); assert.equal(health.failed_count, 0);
  for (const key of ['snapshot_complete', 'canonical_complete', 'core_batch_complete', 'immutable_evidence_complete']) assert.equal(health.details[key], true);
  const immutable = rows(actual, 'market_checkpoint_snapshots'), receipts = actual.boundary.receipts, used = new Set();
  assert.equal(new Set(immutable.map(row => row.symbol)).size, 11); assert.equal(receipts.length, 11);
  for (const source of immutable) {
    assert.equal(source.trading_date, pins.warmup_date); assert.equal(source.checkpoint, 'RECOVERY'); assert.equal(source.correlation_id, correlation);
    assert.equal(source.raw.contract, 'FETCH_CHECKPOINT_EVIDENCE_V1'); assert.ok(entry.metadata.immutable_snapshot_versions.includes(source.snapshot_version));
    assert.ok(['finnhub', 'fugle', 'fugle_futopt'].includes(source.source));
    const symbol = source.raw.source_symbol;
    const url = source.source === 'finnhub' ? 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol)
      : 'https://api.fugle.tw/marketdata/v1.0/' + (source.source === 'fugle_futopt' ? 'futopt' : 'stock') + '/intraday/quote/' + encodeURIComponent(symbol) + (source.source === 'fugle_futopt' ? '?session=afterhours' : '');
    const request = { url, method: 'GET', body: null }, found = receipts.filter(row => row.request_sha256 === sha256(JSON.stringify(request)));
    assert.equal(found.length, 1); const receipt = found[0]; assert.ok(!used.has(receipt.id)); used.add(receipt.id);
    assert.equal(receipt.scope, pins.scope); assert.equal(receipt.phase, 'prior-close-warmup'); assert.equal(receipt.operation, 'quote');
    assert.equal(receipt.status, 200); assert.equal(receipt.source_kind, 'SYNTHETIC_PROVIDER_CONTROL'); assert.equal(receipt.historical_capture, false);
    const response = vendor(request, fixture, receipt.observed_at); assert.equal(receipt.response_sha256, sha256(JSON.stringify(response.body))); assert.equal(receipt.provider, response.provider);
    assert.equal(source.value, response.body.c ?? response.body.price);
    const multiplier = source.symbol === 'US10Y' ? -1 : 1;
    if (multiplier === -1) { assert.equal(symbol, 'IEF'); assert.equal(source.raw.source_raw.direction_multiplier, -1); assert.equal(source.raw.source_raw.proxy_semantics, 'inverse_7_10y_treasury_price_proxy'); }
    assert.equal(source.change_percent, (response.body.dp ?? response.body.changePercent) * multiplier);
    assert.equal(Date.parse(source.source_timestamp), response.body.t ? response.body.t * 1000 : Date.parse(response.body.lastUpdated));
    for (const table of ['market_data', 'market_quotes', 'market_data_snapshots']) {
      const matches = rows(actual, table).filter(row => row.symbol === source.symbol); assert.equal(matches.length, 1); const row = matches[0];
      assert.equal(row.value, table === 'market_quotes' ? canonicalNumeric(source.value, 8) : source.value);
      assert.equal(row.change_percent, table === 'market_quotes' ? canonicalNumeric(source.change_percent, 6) : source.change_percent);
      assert.equal(Date.parse(row.captured_at), Date.parse(source.source_timestamp));
      if (table !== 'market_data') {
        assert.equal(row.trading_date, pins.warmup_date); assert.equal(row.phase, 'manual_backfill');
        assert.equal(table === 'market_quotes' ? row.provider : row.source, source.source);
        const proof = object(row.raw_payload ?? row.raw);
        assert.equal(proof.correlation_id, correlation); assert.equal(proof.immutable_checkpoint, 'RECOVERY'); assert.equal(proof.checkpoint, 'manual');
        assert.equal(proof.provider, source.source); assert.equal(proof.source_symbol, symbol); assert.equal(proof.immutable_snapshot_version, source.snapshot_version);
      }
    }
  }
  assert.equal(used.size, 11);
  return { status: 'PRECONDITION_INPUT_ONLY', mode: 'MANUAL_INPUT_RECEIPT_CONTINUATION', actual_manual_lifecycle_verified: true,
    prior_runner_result: 'FAIL_RETAINED', correlation_id: correlation, main_business_tables_empty: true,
    manual_fetch_resent: false, publication_adopted: false, direct_business_seed_writes: 0 };
}
