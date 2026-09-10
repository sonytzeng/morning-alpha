// Explicit prior-input continuation only. No writes, SQL, lifecycle repair or success promotion.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, object, canonicalNumeric, validateReplayConfiguration, checkPinnedReplayInputs } from './coreConsolidationReplayRuntime.mjs';
import { resolveConsolidationVendorResponse } from './coreConsolidationVendorShapes.mjs';

export const WARMUP_INPUT_TABLES = Object.freeze([
  'market_data', 'market_checkpoint_snapshots', 'market_quotes', 'market_data_snapshots', 'data_provider_health',
  'trading_day_state', 'reports', 'decision_snapshots', 'line_delivery_outbox', 'line_subscribers', 'learning_runs',
  'learning_predictions', 'prediction_outcomes', 'news_events', 'market_news', 'sector_rotation_scores',
  'pipeline_runs', 'member_content_revisions', 'production_acceptance_results', 'runtime_http_dispatches',
  'runtime_dead_letters', 'ma_ops_runs',
]);
const inputTables = WARMUP_INPUT_TABLES.slice(0, 5);
export function assertContinuationArtifactBytes(bytes, expectedHash) {
  assert.match(expectedHash, /^[a-f0-9]{64}$/);
  assert.equal(sha256(bytes), expectedHash, 'Continuation predecessor or runner source drift');
  return bytes;
}
export const stableInputBytes = value => JSON.stringify(Array.isArray(value)
  ? value.map(entry => JSON.parse(stableInputBytes(entry))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stableInputBytes(value[key]))])) : value);
const tableRows = (readback, table) => {
  assert.equal(readback.tables[table]?.http, 200, 'Table read must succeed, not 404: ' + table);
  assert.ok(Array.isArray(readback.tables[table].rows)); return readback.tables[table].rows;
};
export function assertWarmupInputAdoption({ config, priorResult, baseline, actual, fixture }) {
  assert.equal(priorResult.scope, config.scope); assert.equal(priorResult.status, 'FAIL');
  assert.equal(priorResult.full_persisted_chain_executed, false);
  assert.equal(priorResult.historical_success_claim, false);
  const handlers = priorResult.records.filter(row => String(row.stage).startsWith('handler:'));
  assert.equal(handlers.length, 1); assert.equal(handlers[0].stage, 'handler:fetch-market-data-v10');
  assert.equal(handlers[0].http, 200); assert.equal(handlers[0].business_success, false);
  assert.equal(priorResult.records.at(-1).stage, 'FIRST_FAILURE');
  for (const state of [baseline, actual]) {
    assert.equal(state.scope, config.scope); assert.equal(state.report_date, config.report_date);
    assert.equal(state.warmup_date, config.warmup_date); assert.ok(state.warmup_date < state.report_date);
    assert.equal(state.guest.boot_id, config.clock.configuration.bootId);
    assert.equal(state.prior_result.run_id, priorResult.run_id); assert.equal(state.prior_result.status, 'FAIL');
    for (const table of WARMUP_INPUT_TABLES) {
      const rows = tableRows(state, table);
      assert.equal(rows.length, table === 'data_provider_health' ? 1 : inputTables.includes(table) ? 9 : 0,
        'Unexpected business row; cannot adopt publication, delivery, learning or main-date state: ' + table);
    }
  }
  for (const table of WARMUP_INPUT_TABLES) assert.equal(stableInputBytes(tableRows(actual, table)), stableInputBytes(tableRows(baseline, table)), 'Prior input row changed: ' + table);
  assert.equal(stableInputBytes(actual.boundary.receipts), stableInputBytes(baseline.boundary.receipts), 'Provider receipt changed or unexpected provider call');
  assert.equal(fixture.warmup_date, config.warmup_date); assert.equal(fixture.report_date, config.report_date);
  assert.equal(fixture.provenance.historical_capture, false);
  const immutable = tableRows(actual, 'market_checkpoint_snapshots'), health = tableRows(actual, 'data_provider_health')[0];
  const correlation = immutable[0].correlation_id;
  assert.match(correlation, /^[a-f0-9-]{36}$/); assert.equal(health.correlation_id, correlation);
  assert.equal(health.service_date, config.warmup_date); assert.equal(health.phase, 'close'); assert.equal(health.checkpoint, '1430');
  assert.equal(health.status, 'healthy'); assert.equal(health.requested_count, 9); assert.equal(health.succeeded_count, 9); assert.equal(health.failed_count, 0);
  for (const name of ['snapshot_complete', 'canonical_complete', 'core_batch_complete', 'required_core_complete', 'immutable_evidence_complete']) assert.equal(health.details[name], true);
  assert.deepEqual(health.details.provider_failures, []); assert.deepEqual(health.details.canonical_write_errors, []);
  assert.equal(new Set(immutable.map(row => row.symbol)).size, 9);
  const receipts = actual.boundary.receipts; assert.equal(receipts.length, 9);
  const used = new Set();
  for (const source of immutable) {
    assert.equal(source.trading_date, config.warmup_date); assert.equal(source.checkpoint, '1430');
    assert.equal(source.correlation_id, correlation); assert.equal(source.raw.contract, 'FETCH_CHECKPOINT_EVIDENCE_V1');
    assert.ok(Number.isFinite(source.value) && source.value > 0 && Number.isFinite(source.change_percent));
    assert.ok(Date.parse(source.source_timestamp) <= Date.parse(source.captured_at));
    const sourceSymbol = source.raw.source_symbol;
    const url = source.source === 'finnhub' ? 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(sourceSymbol)
      : 'https://api.fugle.tw/marketdata/v1.0/' + (source.source === 'fugle_futopt' ? 'futopt' : 'stock') + '/intraday/quote/' + encodeURIComponent(sourceSymbol);
    const request = { url: new URL(url).href, method: 'GET', body: null };
    const matches = receipts.filter(row => row.request_sha256 === sha256(JSON.stringify(request)));
    assert.equal(matches.length, 1, 'Exact original provider request missing: ' + source.symbol);
    const receipt = matches[0]; assert.ok(!used.has(receipt.id)); used.add(receipt.id);
    assert.equal(receipt.scope, config.scope); assert.equal(receipt.phase, 'prior-close-warmup');
    assert.equal(receipt.source_kind, 'SYNTHETIC_PROVIDER_CONTROL'); assert.equal(receipt.historical_capture, false);
    assert.equal(receipt.status, 200); assert.equal(receipt.operation, 'quote');
    const response = resolveConsolidationVendorResponse(request, fixture, receipt.observed_at);
    assert.equal(receipt.response_sha256, sha256(JSON.stringify(response.body)), 'Exact provider response drift');
    assert.equal(source.value, response.body.c ?? response.body.price);
    assert.equal(source.change_percent, response.body.dp ?? response.body.changePercent);
    assert.equal(Date.parse(source.source_timestamp), response.body.t ? response.body.t * 1000 : Date.parse(response.body.lastUpdated));
    const raw = tableRows(actual, 'market_data').filter(row => row.symbol === source.symbol);
    const canonical = tableRows(actual, 'market_quotes').filter(row => row.symbol === source.symbol);
    const aliases = tableRows(actual, 'market_data_snapshots').filter(row => row.symbol === source.symbol);
    for (const rows of [raw, canonical, aliases]) {
      assert.equal(rows.length, 1);
      assert.equal(rows[0].value, rows === canonical ? canonicalNumeric(source.value, 8) : source.value);
      assert.equal(rows[0].change_percent, rows === canonical ? canonicalNumeric(source.change_percent, 6) : source.change_percent);
      assert.equal(Date.parse(rows[0].captured_at), Date.parse(source.source_timestamp));
    }
    for (const row of [canonical[0], aliases[0]]) {
      assert.equal(row.trading_date, config.warmup_date); assert.equal(row.phase, 'close');
      const proof = object(row.raw_payload ?? row.raw);
      assert.equal(proof.correlation_id, correlation); assert.equal(proof.immutable_snapshot_version, source.snapshot_version);
      assert.equal(proof.immutable_checkpoint, '1430');
    }
  }
  assert.equal(used.size, 9);
  return { status: 'PRECONDITION_INPUT_ONLY', warmup_lifecycle: 'WARMUP_LIFECYCLE_FAIL_RETAINED',
    warmup_date: config.warmup_date, report_date: config.report_date, correlation_id: correlation,
    adopted_business_success: false, main_business_tables_empty: true, direct_business_seed_writes: 0 };
}

export function loadWarmupContinuation(manifest, repo, environment = process.env) {
  assert.equal(manifest.schema_version, 'CORE_CONSOLIDATION_WARMUP_CONTINUATION_V1');
  assert.ok(['001', '002'].includes(manifest.continuation_id));
  assert.equal(manifest.mode, manifest.continuation_id === '001' ? 'MANUAL_INPUT_BOOTSTRAP' : 'MANUAL_INPUT_RECEIPT_CONTINUATION');
  assert.equal(manifest.historical_success_claim, false); assert.equal(manifest.production_operations_authorized, false);
  const root = '/private/tmp/' + manifest.scope;
  assert.equal(manifest.evidence_directory, root + '-evidence-continuation-' + manifest.continuation_id);
  const readPinned = (row, path) => { assert.equal(row.path, path); assert.match(row.sha256, /^[a-f0-9]{64}$/);
    const bytes = assertContinuationArtifactBytes(readFileSync(row.path), row.sha256); return JSON.parse(bytes); };
  const originalConfig = readPinned(manifest.config, root + '/replay-config.json');
  let config = originalConfig;
  validateReplayConfiguration(config, environment); assert.equal(config.scope, manifest.scope); assert.equal(config.attempt, 2);
  if (manifest.source_successor) {
    const successor = manifest.source_successor;
    const archive = readPinned(successor.preimages, root + '/attempt-002-business-preimages/manifest.json');
    assert.equal(archive.scope, manifest.scope); assert.equal(archive.config_sha256, manifest.config.sha256);
    const expected = [...originalConfig.source_files.map(row => ({ ...row, kind: 'source' })),
      ...originalConfig.functions.map(row => ({ path: 'bundles/' + row.slug + '/index.js', sha256: row.bundle_sha256, kind: 'bundle' }))];
    assert.deepEqual(archive.files.map(({ archived_path, ...row }) => row), expected);
    for (const row of archive.files) { assert.equal(row.archived_path, root + '/attempt-002-business-preimages/' + row.path);
      assertContinuationArtifactBytes(readFileSync(row.archived_path), row.sha256); }
    config = readPinned(successor.active_config, root + '/replay-config-payload-v2.json');
    assertPayloadSourceSuccessor(originalConfig, config, successor);
    validateReplayConfiguration(config, environment);
  }
  checkPinnedReplayInputs(config, repo); // Original general same-scope reuse prohibition is unchanged.
  const priorResult = readPinned(manifest.failed_result, root + '-evidence-attempt-002/result.json');
  const baseline = readPinned(manifest.readback, root + '/warmup-failure-readback-002-complete.json');
  for (const row of manifest.runner_sources) { assert.ok(/^tests\/(helpers|integration)\/coreConsolidation[A-Za-z0-9.]+\.mjs$/.test(row.path));
    assertContinuationArtifactBytes(readFileSync(resolve(repo, row.path)), row.sha256); }
  assert.deepEqual(manifest.runner_sources.map(row => row.path).sort(), [
    'tests/helpers/coreConsolidationContinuation.mjs', 'tests/helpers/coreConsolidationReplayRuntime.mjs',
    'tests/integration/coreConsolidationFullChain.e2e.mjs',
  ].sort());
  assert.equal(baseline.config_sha256, manifest.config.sha256); assert.equal(baseline.prior_result.sha256, manifest.failed_result.sha256);
  let manual = null;
  if (manifest.continuation_id === '002') {
    const previous = readPinned(manifest.previous_continuation, root + '/continuation-001.json');
    assert.equal(previous.continuation_id, '001'); assert.equal(previous.mode, 'MANUAL_INPUT_BOOTSTRAP');
    for (const key of ['config', 'failed_result', 'readback']) assert.deepEqual(previous[key], manifest[key]);
    assert.deepEqual(manifest.previous_source_preimages.map(row => ({ path: row.path, sha256: row.sha256 })), previous.runner_sources);
    for (const row of manifest.previous_source_preimages) {
      assert.equal(row.archived_path, root + '/continuation-001-source-preimages/' + row.path.split('/').at(-1));
      assertContinuationArtifactBytes(readFileSync(row.archived_path), row.sha256);
    }
    const failedResult = readPinned(manifest.manual_failed_result, root + '-evidence-continuation-001/result.json');
    const readback = readPinned(manifest.manual_readback, root + '/warmup-manual-readback-continuation-001.json');
    assert.equal(readback.config_sha256, manifest.config.sha256); assert.equal(readback.prior_result.sha256, manifest.manual_failed_result.sha256);
    manual = { priorResult: failedResult, baseline: readback };
  }
  return { config, originalConfig, priorResult, baseline, manifest, manual };
}

export function assertPayloadSourceSuccessor(original, active, successor) {
  const payloadPath = 'supabase/functions/get-report-payload/index.ts', scopeRoot = '/private/tmp/' + original.scope;
  assert.deepEqual(successor.reviewed_files, [payloadPath]);
  assert.equal(successor.kind, 'EXACT_LOCAL_PAYLOAD_SOURCE_SUCCESSOR');
  assert.equal(successor.production_operations_authorized, false);
  for (const field of ['payload_source_sha256', 'payload_bundle_sha256']) assert.match(successor[field], /^[a-f0-9]{64}$/);
  const omit = ({ source_files, functions, bootstrap_receipts, ...value }) => value;
  assert.deepEqual(omit(active), omit(original), 'Source successor must not change date, scope, SQL, credentials, clock, fixture or network');
  assert.deepEqual(active.source_files.map(row => row.path), original.source_files.map(row => row.path), 'Transitive dependency scope changed');
  assert.deepEqual(active.functions.map(row => row.slug), original.functions.map(row => row.slug));
  for (const before of original.source_files) {
    const after = active.source_files.find(row => row.path === before.path);
    assert.deepEqual(after, before.path === payloadPath ? { ...before, sha256: successor.payload_source_sha256 } : before);
  }
  for (const before of original.functions) {
    const after = active.functions.find(row => row.slug === before.slug);
    assert.deepEqual(after, before.slug === 'get-report-payload' ? { ...before,
      source_sha256: successor.payload_source_sha256, bundle_sha256: successor.payload_bundle_sha256,
      bundle_file: scopeRoot + '/source-successors/payload-v2/get-report-payload/index.js' } : before);
  }
  assert.equal(active.bootstrap_receipts.length, original.bootstrap_receipts.length + 1);
  assert.deepEqual(active.bootstrap_receipts.slice(0, -1), original.bootstrap_receipts);
  const receipt = active.bootstrap_receipts.at(-1);
  assert.equal(receipt.scope, original.scope); assert.equal(receipt.path, scopeRoot + '/payload-source-successor-v2.json');
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  return true;
}

export function assertManualInputContinuation({ config, original, originalResult, priorResult, baseline, actual, fixture }) {
  assertWarmupInputAdoption({ config, priorResult: originalResult, baseline: original, actual: original, fixture });
  assert.equal(priorResult.scope, config.scope); assert.equal(priorResult.status, 'FAIL');
  assert.equal(priorResult.full_persisted_chain_executed, false); assert.equal(priorResult.records.at(-1).error, 'fetch failed');
  assert.deepEqual(priorResult.records.map(row => row.stage), ['historical-evidence-boundary', 'explicit-warmup-input-continuation', 'real-runtime-clock', 'FIRST_FAILURE']);
  for (const state of [baseline, actual]) {
    assert.equal(state.scope, config.scope); assert.equal(state.report_date, config.report_date); assert.equal(state.warmup_date, config.warmup_date);
    assert.equal(state.guest.boot_id, config.clock.configuration.bootId); assert.equal(state.prior_result.run_id, priorResult.run_id);
    for (const table of WARMUP_INPUT_TABLES) {
      const expected = table === 'market_data' ? 11 : ['market_checkpoint_snapshots', 'market_quotes', 'market_data_snapshots'].includes(table) ? 20
        : table === 'data_provider_health' ? 2 : table === 'trading_day_state' ? 1 : 0;
      assert.equal(tableRows(state, table).length, expected, 'Unexpected rows after manual input: ' + table);
    }
  }
  for (const table of WARMUP_INPUT_TABLES) assert.equal(stableInputBytes(tableRows(actual, table)), stableInputBytes(tableRows(baseline, table)), 'Manual input changed: ' + table);
  assert.equal(stableInputBytes(actual.boundary.receipts), stableInputBytes(baseline.boundary.receipts));
  for (const table of inputTables) for (const row of tableRows(original, table)) assert.deepEqual(tableRows(actual, table).find(item => item.id === row.id), row, 'Original failed close input mutated');
  const day = tableRows(actual, 'trading_day_state')[0], entry = object(day.checkpoint_status.manual);
  assert.equal(day.trading_date, config.warmup_date); assert.equal(day.current_state, 'MANUAL_CAPTURED'); assert.equal(day.state_rank, 0);
  assert.equal(day.completed_at, null); assert.deepEqual(Object.keys(day.checkpoint_status), ['manual']);
  assert.equal(entry.status, 'SUCCEEDED'); assert.equal(entry.metadata.core_batch_complete, true);
  const correlation = entry.correlation_id; assert.match(correlation, /^[a-f0-9-]{36}$/);
  const immutable = tableRows(actual, 'market_checkpoint_snapshots').filter(row => row.checkpoint === 'RECOVERY');
  assert.equal(immutable.length, 11); assert.equal(new Set(immutable.map(row => row.symbol)).size, 11);
  const health = tableRows(actual, 'data_provider_health').find(row => row.phase === 'manual_backfill'); assert.ok(health);
  assert.equal(health.service_date, config.warmup_date); assert.equal(health.checkpoint, 'manual'); assert.equal(health.correlation_id, correlation);
  assert.equal(health.status, 'healthy'); assert.equal(health.requested_count, 11); assert.equal(health.succeeded_count, 11); assert.equal(health.failed_count, 0);
  for (const key of ['snapshot_complete', 'canonical_complete', 'core_batch_complete', 'immutable_evidence_complete']) assert.equal(health.details[key], true);
  const oldIds = new Set(original.boundary.receipts.map(row => row.id)), receipts = actual.boundary.receipts.filter(row => !oldIds.has(row.id));
  assert.equal(actual.boundary.receipts.length, 20); assert.equal(receipts.length, 11);
  for (const row of original.boundary.receipts) assert.deepEqual(actual.boundary.receipts.find(item => item.id === row.id), row);
  const used = new Set();
  for (const source of immutable) {
    assert.equal(source.trading_date, config.warmup_date); assert.equal(source.correlation_id, correlation);
    assert.equal(source.raw.contract, 'FETCH_CHECKPOINT_EVIDENCE_V1'); assert.ok(entry.metadata.immutable_snapshot_versions.includes(source.snapshot_version));
    const symbol = source.raw.source_symbol;
    const url = source.source === 'finnhub' ? 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol)
      : 'https://api.fugle.tw/marketdata/v1.0/' + (source.source === 'fugle_futopt' ? 'futopt' : 'stock') + '/intraday/quote/' + encodeURIComponent(symbol)
        + (source.source === 'fugle_futopt' ? '?session=afterhours' : '');
    const request = { url: new URL(url).href, method: 'GET', body: null };
    const matching = receipts.filter(row => row.request_sha256 === sha256(JSON.stringify(request))); assert.equal(matching.length, 1);
    const receipt = matching[0]; assert.ok(!used.has(receipt.id)); used.add(receipt.id);
    assert.equal(receipt.scope, config.scope); assert.equal(receipt.source_kind, 'SYNTHETIC_PROVIDER_CONTROL'); assert.equal(receipt.historical_capture, false);
    assert.equal(receipt.status, 200); assert.equal(receipt.phase, 'prior-close-warmup'); assert.equal(receipt.operation, 'quote');
    const response = resolveConsolidationVendorResponse(request, fixture, receipt.observed_at).body;
    assert.equal(receipt.response_sha256, sha256(JSON.stringify(response))); assert.equal(source.value, response.c ?? response.price);
    const inverse = source.symbol === 'US10Y';
    if (inverse) { assert.equal(symbol, 'IEF'); assert.equal(source.source, 'finnhub');
      assert.equal(source.raw.source_raw.direction_multiplier, -1);
      assert.equal(source.raw.source_raw.proxy_semantics, 'inverse_7_10y_treasury_price_proxy'); }
    assert.equal(source.change_percent, (response.dp ?? response.changePercent) * (inverse ? -1 : 1));
    assert.equal(Date.parse(source.source_timestamp), response.t ? response.t * 1000 : Date.parse(response.lastUpdated));
    for (const table of ['market_data', 'market_quotes', 'market_data_snapshots']) {
      const matches = tableRows(actual, table).filter(row => row.symbol === source.symbol && (table === 'market_data' || row.phase === 'manual_backfill'));
      assert.equal(matches.length, 1); const row = matches[0];
      assert.equal(row.value, table === 'market_quotes' ? canonicalNumeric(source.value, 8) : source.value);
      assert.equal(row.change_percent, table === 'market_quotes' ? canonicalNumeric(source.change_percent, 6) : source.change_percent);
      assert.equal(Date.parse(row.captured_at), Date.parse(source.source_timestamp));
      if (table !== 'market_data') { assert.equal(row.trading_date, config.warmup_date); const proof = object(row.raw_payload ?? row.raw);
        assert.equal(proof.correlation_id, correlation); assert.equal(proof.immutable_checkpoint, 'RECOVERY'); assert.equal(proof.immutable_snapshot_version, source.snapshot_version); }
    }
  }
  assert.equal(used.size, 11);
  return { status: 'PRECONDITION_INPUT_ONLY', mode: 'MANUAL_INPUT_RECEIPT_CONTINUATION', correlation_id: correlation,
    original_warmup_lifecycle: 'WARMUP_LIFECYCLE_FAIL_RETAINED', previous_http_result: 'FAIL_RETAINED',
    actual_manual_lifecycle_verified: true, main_business_tables_empty: true, direct_business_seed_writes: 0 };
}
