// Pure preparation/counterfactual tests, NOT a persisted-handler replay result.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { assertWarmupInputAdoption, assertManualInputContinuation, assertPayloadSourceSuccessor, assertContinuationArtifactBytes, WARMUP_INPUT_TABLES } from './helpers/coreConsolidationContinuation.mjs';
import { sha256, canonicalNumeric } from './helpers/coreConsolidationReplayRuntime.mjs';
import { resolveConsolidationVendorResponse as vendor } from './helpers/coreConsolidationVendorShapes.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260916.json', import.meta.url)));
const clone = structuredClone, scope = 'ma-consolidation-v1-20260909133500';
function input() {
  const config = { scope, report_date: '2026-09-16', warmup_date: '2026-09-15', clock: { configuration: { bootId: 'unit-boot' } } };
  const priorResult = { scope, run_id: 'unit-run', status: 'FAIL', full_persisted_chain_executed: false, historical_success_claim: false,
    records: [{ stage: 'handler:fetch-market-data-v10', http: 200, business_success: false }, { stage: 'FIRST_FAILURE' }] };
  const baseline = { scope, report_date: config.report_date, warmup_date: config.warmup_date, guest: { boot_id: 'unit-boot' },
    prior_result: { run_id: 'unit-run', status: 'FAIL' }, tables: Object.fromEntries(WARMUP_INPUT_TABLES.map(t => [t, { http: 200, rows: [] }])), boundary: { receipts: [] } };
  const correlation = '00000000-0000-0000-0000-000000000123', at = '2026-09-15T06:30:02.000Z';
  const sources = [['SPX','SPY','finnhub'],['IXIC','QQQ','finnhub'],['SOX','SOXX','finnhub'],['NVDA','NVDA','finnhub'],['TSM','TSM','finnhub'],['VIX','VXX','finnhub'],['TAIEX','IX0001','fugle'],['2330','2330','fugle'],['TXF','TXF1!','fugle_futopt']];
  for (const [index, [symbol, sourceSymbol, source]] of sources.entries()) {
    const url = source === 'finnhub' ? 'https://finnhub.io/api/v1/quote?symbol=' + sourceSymbol
      : 'https://api.fugle.tw/marketdata/v1.0/' + (source === 'fugle_futopt' ? 'futopt' : 'stock') + '/intraday/quote/' + sourceSymbol;
    const request = { url, method: 'GET', body: null }, response = vendor(request, fixture, at), body = response.body;
    const value = body.c ?? body.price, change_percent = body.dp ?? body.changePercent;
    const captured_at = body.t ? new Date(body.t * 1000).toISOString() : body.lastUpdated;
    const common = { id: String(index), symbol, value, change_percent, captured_at };
    baseline.tables.market_data.rows.push(common);
    baseline.tables.market_checkpoint_snapshots.rows.push({ ...common, captured_at: at, source_timestamp: captured_at,
      checkpoint: '1430', trading_date: config.warmup_date, correlation_id: correlation, snapshot_version: index + 1,
      source, raw: { contract: 'FETCH_CHECKPOINT_EVIDENCE_V1', source_symbol: sourceSymbol } });
    const proof = { correlation_id: correlation, immutable_snapshot_version: index + 1, immutable_checkpoint: '1430' };
    baseline.tables.market_quotes.rows.push({ ...common, value: canonicalNumeric(value, 8), change_percent: canonicalNumeric(change_percent, 6),
      trading_date: config.warmup_date, phase: 'close', raw_payload: proof });
    baseline.tables.market_data_snapshots.rows.push({ ...common, trading_date: config.warmup_date, phase: 'close', raw: proof });
    baseline.boundary.receipts.push({ id: String(index), scope, observed_at: at, phase: 'prior-close-warmup', status: 200,
      operation: 'quote', source_kind: 'SYNTHETIC_PROVIDER_CONTROL', historical_capture: false,
      request_sha256: sha256(JSON.stringify(request)), response_sha256: sha256(JSON.stringify(body)) });
  }
  baseline.tables.data_provider_health.rows.push({ correlation_id: correlation, service_date: config.warmup_date,
    phase: 'close', checkpoint: '1430', status: 'healthy', requested_count: 9, succeeded_count: 9, failed_count: 0,
    details: { snapshot_complete: true, canonical_complete: true, core_batch_complete: true, required_core_complete: true,
      immutable_evidence_complete: true, provider_failures: [], canonical_write_errors: [] } });
  return { config, priorResult, baseline, actual: clone(baseline), fixture: clone(fixture) };
}
test('pure adoption only authorizes prior inputs, never the failed warmup or the main chain', () => {
  const result = assertWarmupInputAdoption(input()); assert.equal(result.status, 'PRECONDITION_INPUT_ONLY');
  assert.equal(result.warmup_lifecycle, 'WARMUP_LIFECYCLE_FAIL_RETAINED');
  assert.equal(result.adopted_business_success, false); assert.equal(result.direct_business_seed_writes, 0);
});
for (const [name, mutate] of [
  ['prior PASS', x => { x.priorResult.status = 'PASS'; }],
  ['wrong prior identity', x => { x.priorResult.run_id = 'other'; }],
  ['prior complete chain', x => { x.priorResult.full_persisted_chain_executed = true; }],
  ['successful warmup promotion', x => { x.priorResult.records[0].business_success = true; }],
  ['later handler already executed', x => { x.priorResult.records.unshift({ stage: 'handler:generate-daily-report-v7' }); }],
  ['wrong warmup date', x => { x.config.warmup_date = '2026-09-14'; }],
  ['wrong main date', x => { x.actual.report_date = '2026-09-15'; }],
  ['foreign boot', x => { x.actual.guest.boot_id = 'foreign'; }],
  ['404 treated as empty', x => { x.actual.tables.pipeline_runs = { http: 404, rows: [] }; }],
  ['missing table', x => { delete x.actual.tables.runtime_http_dispatches; }],
  ['foreign correlation', x => { x.actual.tables.market_checkpoint_snapshots.rows[0].correlation_id = 'foreign'; }],
  ['wrong source name', x => { x.actual.tables.market_checkpoint_snapshots.rows[0].source = 'unknown'; }],
  ['wrong provider source symbol', x => { x.actual.tables.market_checkpoint_snapshots.rows[0].raw.source_symbol = 'TSM'; }],
  ['wrong alias date', x => { x.actual.tables.market_data_snapshots.rows[0].trading_date = '2026-09-16'; }],
  ['wrong alias version', x => { x.actual.tables.market_data_snapshots.rows[0].raw.immutable_snapshot_version = 999; }],
  ['wrong alias correlation', x => { x.actual.tables.market_data_snapshots.rows[0].raw.correlation_id = 'foreign'; }],
  ['canonical one-ulp drift', x => { x.actual.tables.market_quotes.rows[0].change_percent += .000001; }],
  ['raw source mutation', x => { x.actual.tables.market_data.rows[0].value += 1; }],
  ['provider response mutation', x => { x.actual.boundary.receipts[0].response_sha256 = 'a'.repeat(64); }],
  ['provider request mutation', x => { x.actual.boundary.receipts[0].request_sha256 = 'a'.repeat(64); }],
  ['extra vendor event', x => { x.actual.boundary.receipts.push(x.actual.boundary.receipts[0]); }],
  ['provider future source', x => { x.fixture.phases[0].source_times.US = '2026-09-16T20:00:00Z'; }],
]) test('adoption rejects ' + name, () => { assert.doesNotThrow(() => assertWarmupInputAdoption(input())); const value = input(); mutate(value); assert.throws(() => assertWarmupInputAdoption(value)); });
for (const table of WARMUP_INPUT_TABLES.slice(5)) test('adoption refuses any prior/main business row in ' + table, () => {
  const value = input(); value.actual.tables[table].rows.push({ id: 'unexpected', report_date: value.config.report_date });
  assert.throws(() => assertWarmupInputAdoption(value));
});
test('simultaneous baseline and current changed provider/source evidence is still checked against raw provider shape', () => {
  const value = input(); value.actual.tables.market_checkpoint_snapshots.rows[0].value += 1;
  value.baseline = clone(value.actual); assert.throws(() => assertWarmupInputAdoption(value));
});
test('exact predecessor and runner-source byte pins reject mutations, not merely wrong object values', () => {
  const bytes = Buffer.from('{"status":"FAIL"}\n'), hash = sha256(bytes);
  assert.equal(assertContinuationArtifactBytes(bytes, hash), bytes);
  for (const changed of [Buffer.from('{"status":"PASS"}\n'), Buffer.from('{"status":"FAIL"}'), Buffer.from('altered source')])
    assert.throws(() => assertContinuationArtifactBytes(changed, hash));
  assert.throws(() => assertContinuationArtifactBytes(bytes, '0'.repeat(64)));
});
test('canonical comparison uses the schema exact decimal quantization, never epsilon tolerance', () => {
  assert.equal(canonicalNumeric(.99601593625498, 6), .996016);
  assert.equal(canonicalNumeric(-1.2345645, 6), -1.234565);
  assert.equal(canonicalNumeric(1.000000005, 8), 1.00000001);
  assert.equal(canonicalNumeric(1e-7, 6), 0);
  assert.throws(() => canonicalNumeric(Infinity, 6)); assert.throws(() => canonicalNumeric(1, 5));
});
function manualInput() {
  const initial = input(), original = initial.baseline, baseline = clone(original), at = '2026-09-15T06:51:36.000Z';
  const correlation = '00000000-0000-0000-0000-000000000456', config = initial.config;
  const originals = clone(original.tables.market_checkpoint_snapshots.rows);
  const manualSources = [...originals.map(row => [row.symbol, row.raw.source_symbol, row.source]), ['DXY', 'UUP', 'finnhub'], ['US10Y', 'IEF', 'finnhub']];
  const versions = [];
  for (const [index, [symbol, sourceSymbol, source]] of manualSources.entries()) {
    const url = source === 'finnhub' ? 'https://finnhub.io/api/v1/quote?symbol=' + sourceSymbol
      : 'https://api.fugle.tw/marketdata/v1.0/' + (source === 'fugle_futopt' ? 'futopt' : 'stock') + '/intraday/quote/' + sourceSymbol + (source === 'fugle_futopt' ? '?session=afterhours' : '');
    const request = { url, method: 'GET', body: null }, response = vendor(request, fixture, at).body;
    const value = response.c ?? response.price, change_percent = (response.dp ?? response.changePercent) * (symbol === 'US10Y' ? -1 : 1);
    const sourceAt = response.t ? new Date(response.t * 1000).toISOString() : response.lastUpdated;
    const id = 'manual-' + index, version = index + 10; versions.push(version);
    const row = { id, symbol, value, change_percent, captured_at: at, source_timestamp: sourceAt,
      checkpoint: 'RECOVERY', trading_date: config.warmup_date, correlation_id: correlation, snapshot_version: version, source,
      raw: { contract: 'FETCH_CHECKPOINT_EVIDENCE_V1', source_symbol: sourceSymbol, ...(symbol === 'US10Y' ? { source_raw: {
        direction_multiplier: -1, proxy_semantics: 'inverse_7_10y_treasury_price_proxy' } } : {}) } };
    baseline.tables.market_checkpoint_snapshots.rows.push(row);
    const common = { id, symbol, value, change_percent, captured_at: sourceAt };
    if (!baseline.tables.market_data.rows.some(row => row.symbol === symbol)) baseline.tables.market_data.rows.push(common);
    const proof = { correlation_id: correlation, immutable_snapshot_version: version, immutable_checkpoint: 'RECOVERY' };
    baseline.tables.market_quotes.rows.push({ ...common, value: canonicalNumeric(value, 8), change_percent: canonicalNumeric(change_percent, 6), trading_date: config.warmup_date, phase: 'manual_backfill', raw_payload: proof });
    baseline.tables.market_data_snapshots.rows.push({ ...common, trading_date: config.warmup_date, phase: 'manual_backfill', raw: proof });
    baseline.boundary.receipts.push({ id, scope, observed_at: at, phase: 'prior-close-warmup', status: 200,
      operation: 'quote', source_kind: 'SYNTHETIC_PROVIDER_CONTROL', historical_capture: false,
      request_sha256: sha256(JSON.stringify(request)), response_sha256: sha256(JSON.stringify(response)) });
  }
  baseline.tables.data_provider_health.rows.push({ ...clone(original.tables.data_provider_health.rows[0]), id: 'manual-health',
    correlation_id: correlation, phase: 'manual_backfill', checkpoint: 'manual', requested_count: 11, succeeded_count: 11 });
  baseline.tables.trading_day_state.rows.push({ trading_date: config.warmup_date, current_state: 'MANUAL_CAPTURED', state_rank: 0,
    completed_at: null, checkpoint_status: { manual: { status: 'SUCCEEDED', correlation_id: correlation,
      metadata: { core_batch_complete: true, immutable_snapshot_versions: versions } } } });
  baseline.prior_result.run_id = 'manual-run';
  const priorResult = { scope, run_id: 'manual-run', status: 'FAIL', full_persisted_chain_executed: false,
    records: ['historical-evidence-boundary', 'explicit-warmup-input-continuation', 'real-runtime-clock', 'FIRST_FAILURE']
      .map(stage => ({ stage, ...(stage === 'FIRST_FAILURE' ? { error: 'fetch failed' } : {}) })) };
  return { config, original, originalResult: initial.priorResult, priorResult, baseline, actual: clone(baseline), fixture: clone(fixture) };
}
test('ambiguous manual HTTP remains FAIL while exact actual rank-zero input receipt is separately verified', () => {
  const result = assertManualInputContinuation(manualInput()); assert.equal(result.status, 'PRECONDITION_INPUT_ONLY');
  assert.equal(result.previous_http_result, 'FAIL_RETAINED'); assert.equal(result.actual_manual_lifecycle_verified, true);
});
for (const [name, mutate] of [
  ['HTTP success rewrite', x => { x.priorResult.status = 'PASS'; }],
  ['unexpected handler', x => { x.priorResult.records.unshift({ stage: 'handler:generate-daily-report-v7' }); }],
  ['main publication', x => { x.actual.tables.pipeline_runs.rows.push({ trading_date: x.config.report_date }); }],
  ['missing manual input', x => { x.actual.tables.market_checkpoint_snapshots.rows.pop(); }],
  ['manual rank promotion', x => { x.actual.tables.trading_day_state.rows[0].state_rank = 100; }],
  ['manual close promotion', x => { x.actual.tables.trading_day_state.rows[0].checkpoint_status['1430'] = { status: 'SUCCEEDED' }; }],
  ['manual wrong date', x => { x.actual.tables.trading_day_state.rows[0].trading_date = x.config.report_date; }],
  ['manual foreign correlation', x => { x.actual.tables.trading_day_state.rows[0].checkpoint_status.manual.correlation_id = 'foreign'; }],
  ['manual missing alias', x => { x.actual.tables.market_data_snapshots.rows.pop(); }],
  ['manual wrong provider hash', x => { x.actual.boundary.receipts.at(-1).response_sha256 = 'a'.repeat(64); }],
  ['original evidence mutation', x => { x.actual.tables.market_data.rows[0].value = 1; }],
  ['manual raw mutation', x => { x.actual.tables.market_data.rows.at(-1).value = 1; }],
]) test('manual input continuation rejects ' + name, () => {
  assert.doesNotThrow(() => assertManualInputContinuation(manualInput())); const value = manualInput(); mutate(value);
  assert.throws(() => assertManualInputContinuation(value));
});
test('changing both baseline and actual cannot remove the existing US10Y inverse-provider proof', () => {
  const value = manualInput(); value.actual.tables.market_checkpoint_snapshots.rows.find(row => row.symbol === 'US10Y').raw.source_raw.direction_multiplier = 1;
  value.baseline = clone(value.actual); assert.throws(() => assertManualInputContinuation(value));
});
function successorInput() {
  const payload = 'supabase/functions/get-report-payload/index.ts', root = '/private/tmp/' + scope, old = 'a'.repeat(64), updated = 'b'.repeat(64);
  const original = { scope, report_date: '2026-09-16', sql_candidate: { sha256: old }, clock: { bootId: 'original' }, boundary: { fixture_sha256: old },
    source_files: [{ path: payload, sha256: old }, { path: 'supabase/functions/fetch-market-data-v10/index.ts', sha256: old }],
    functions: [{ slug: 'get-report-payload', source_sha256: old, bundle_sha256: old, bundle_file: root + '/old-payload.js', deployed_file: '/exact/deployed.js' },
      { slug: 'fetch-market-data-v10', source_sha256: old, bundle_sha256: old }], bootstrap_receipts: [{ scope, path: root + '/original.json', sha256: old }] };
  const active = clone(original), successor = { kind: 'EXACT_LOCAL_PAYLOAD_SOURCE_SUCCESSOR', reviewed_files: [payload],
    production_operations_authorized: false, payload_source_sha256: updated, payload_bundle_sha256: updated };
  active.source_files[0].sha256 = updated; Object.assign(active.functions[0], { source_sha256: updated, bundle_sha256: updated,
    bundle_file: root + '/source-successors/payload-v2/get-report-payload/index.js' });
  active.bootstrap_receipts.push({ scope, path: root + '/payload-source-successor-v2.json', sha256: updated });
  return { original, active, successor };
}
test('payload-only successor preserves all original scope/SQL/runtime inputs and appends one exact receipt', () => {
  const x = successorInput(); assert.equal(assertPayloadSourceSuccessor(x.original, x.active, x.successor), true);
});
for (const [name, mutate] of [
  ['unreviewed source', x => { x.active.source_files[1].sha256 = 'c'.repeat(64); }],
  ['missing import', x => { x.active.source_files.pop(); }],
  ['new import', x => { x.active.source_files.push({ path: 'unknown', sha256: 'c'.repeat(64) }); }],
  ['wrong source hash', x => { x.active.source_files[0].sha256 = 'c'.repeat(64); }],
  ['wrong bundle hash', x => { x.active.functions[0].bundle_sha256 = 'c'.repeat(64); }],
  ['another function', x => { x.active.functions[1].bundle_sha256 = 'c'.repeat(64); }],
  ['SQL change', x => { x.active.sql_candidate.sha256 = 'c'.repeat(64); }],
  ['clock change', x => { x.active.clock.bootId = 'other'; }],
  ['provider change', x => { x.active.boundary.fixture_sha256 = 'c'.repeat(64); }],
  ['date change', x => { x.active.report_date = '2026-09-17'; }],
  ['predecessor receipt rewrite', x => { x.active.bootstrap_receipts[0].sha256 = 'c'.repeat(64); }],
  ['Production permission', x => { x.successor.production_operations_authorized = true; }],
  ['expanded review scope', x => { x.successor.reviewed_files.push('unknown'); }],
  ['different deployment path', x => { x.active.functions[0].deployed_file = '/other'; }],
]) test('payload successor rejects ' + name, () => { const x = successorInput(); mutate(x); assert.throws(() => assertPayloadSourceSuccessor(x.original, x.active, x.successor)); });
