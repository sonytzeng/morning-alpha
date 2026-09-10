// Portable preparation tests only: importing the guarded driver's pure validator
// never invokes its opt-in executable entrypoint or starts services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { REPLAY_FUNCTIONS, AUTHORIZED_KEY_REUSE, RETAINED_ARTIFACTS, RETAINED_TABLES,
  MISSING_QUOTE_CONTROL, PROTECTED_CONTROL_ARTIFACTS, validateReplayConfiguration,
  validateProtectedControlReceipt, validateMissingQuoteFixture, assertClockAgreement, canonicalPreservedMounts,
  assertReplayMarketDays, buildMissingQuoteFixture, PRIOR_FAILED_SCOPE_ARTIFACTS,
  FRESH_MISSING_QUOTE_SCOPE, validatePriorFailedScopeConfiguration, validatePriorFailedScopeReceipt } from './helpers/coreConsolidationMissingQuoteRuntime.mjs';
import { resolveConsolidationVendorResponse as vendor } from './helpers/coreConsolidationVendorShapes.mjs';
import { validateMissingQuoteWarmupFailure, validateMissingQuoteWarmupContinuationDescriptor,
  validateMissingQuoteReadonlyClockFailure, prepareMissingQuoteClockTarget } from './integration/coreConsolidationMissingQuote.e2e.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const scope = 'ma-consolidation-v1-20260909210000', controlScope = 'ma-consolidation-v1-20260909200000';
const digest = 'a'.repeat(64), boot = 'd9f73673-b3e3-4daf-8080-13d8dde5b2c0';
function failedWarmup() {
  const body = { source: 'LOCAL_CONSOLIDATION_SYNTHETIC', phase: 'manual_backfill',
    checkpoint: 'manual', correlation_id: '90b6e334-3b14-42fe-ab43-cf9f1002c9e3' };
  return { schema_version: 'CORE_CONSOLIDATION_MISSING_QUOTE_RESULT_V1', scope, run_id: 'pure-test-only',
    status: 'FAIL', test_success: false, actual_acceptance_verdict: null, full_persisted_chain_executed: false,
    production_requests: 0, historical_success_claim: false, automatic_stable_day: false,
    records: [
      { stage: 'fresh-business-scope-readback', all_required_tables_empty: true, direct_business_seed_writes: 0, new_synthetic_users: 0 },
      { stage: 'real-runtime-clock', auth_user_count: 0, boot_id: boot },
      { stage: 'handler:fetch-market-data-v10', request_attempted: true, response_received: false, request_body: body,
        request_sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') },
      { stage: 'handler:fetch-market-data-v10', http: 200, response_sha256: digest,
        response_body: { trading_date: '2026-10-01', correlation_id: body.correlation_id, success: false, operation_succeeded: false, failed: ['NVDA'] } },
      { stage: 'FIRST_FAILURE', expected_failure_verified: false, full_chain_pass: false,
        error: 'Expected exactly one persisted row\n\n0 !== 1\n' },
    ] };
}
test('exact retained warmup FAIL can be re-read without claiming its Fetch ran again or succeeded', () => {
  const prior = failedWarmup(), before = structuredClone(prior);
  const result = validateMissingQuoteWarmupFailure(prior, config());
  assert.equal(result.result.body.success, false); assert.equal(result.prior_run_id, prior.run_id);
  assert.deepEqual(prior, before);
});
for (const [name, mutate] of [
  ['different scope', v => v.scope += '-other'],
  ['promoted failure', v => v.status = 'PASS'],
  ['existing acceptance', v => v.actual_acceptance_verdict = 'PASS'],
  ['another handler', v => v.records.splice(4, 0, { stage: 'handler:line-daily-push' })],
  ['ambiguous response', v => v.records[3].http = 503],
  ['another date', v => v.records[3].response_body.trading_date = '2026-10-02'],
  ['changed correlation', v => v.records[3].response_body.correlation_id = 'wrong'],
  ['changed request', v => v.records[2].request_body.phase = 'close'],
  ['quality promoted', v => v.records[3].response_body.operation_succeeded = true],
  ['different provider fault', v => v.records[3].response_body.failed = ['SPX']],
  ['account introduced', v => v.records[1].auth_user_count = 1],
  ['different assertion failure', v => v.records[4].error = 'unknown'],
]) test('retained warmup continuation rejects ' + name, () => {
  const prior = failedWarmup(); mutate(prior);
  assert.throws(() => validateMissingQuoteWarmupFailure(prior, config()));
});
test('retained warmup observation and equal-current targets never set the clock', () => {
  let advances = 0;
  const at = '2026-10-01T06:50:00.000Z';
  const fake = observed => ({ observe: () => ({ observed_at: observed }), advance: () => { advances++; throw new Error('No set-clock permitted'); } });
  assert.equal(prepareMissingQuoteClockTarget(fake(at), at), at);
  assert.equal(prepareMissingQuoteClockTarget(fake(at), at, true), at);
  assert.equal(prepareMissingQuoteClockTarget(fake('2026-10-01T06:50:01.000Z'), at, true), at);
  assert.equal(advances, 0, 'A second-boundary race remains observation only');
  const driver = read('tests/integration/coreConsolidationMissingQuote.e2e.mjs');
  assert.match(driver, /await clockAt\(observed, \{ observeOnly: true \}\)/);
  assert.match(driver, /const target = prepareMissingQuoteClockTarget\(clock, at, observeOnly\)/);
});
test('future targets still use the unchanged no-rewind controller and invalid observations fail closed', () => {
  const now = '2026-10-01T06:50:00.000Z', future = '2026-10-01T07:00:00.000Z', calls = [];
  const fake = { observe: () => ({ observed_at: now }), advance: target => calls.push(target) };
  assert.equal(prepareMissingQuoteClockTarget(fake, future), future); assert.deepEqual(calls, [future]);
  assert.throws(() => prepareMissingQuoteClockTarget(fake, future, true), /Observe-only/);
  assert.throws(() => prepareMissingQuoteClockTarget(fake, '2026-10-01T06:39:59.000Z', true), /Phase expired/);
  assert.throws(() => prepareMissingQuoteClockTarget(fake, now, 'true'));
  const noRewind = new Error('Never rewind an active replay VM');
  assert.throws(() => prepareMissingQuoteClockTarget({ ...fake, advance: () => { throw noRewind; } }, future), value => value === noRewind);
  assert.deepEqual(calls, [future], 'No observe-only or rejected target advances the clock');
});
test('only the exact named readonly clock failure permits the separate continuation002 journal', () => {
  const original = failedWarmup(), retained = validateMissingQuoteWarmupFailure(original, config());
  const immutable = ['2330', 'DXY', 'IXIC', 'SOX', 'SPX', 'TAIEX', 'TSM', 'TXF', 'US10Y', 'VIX'].map(symbol => ({ symbol }));
  const value = { schema_version: original.schema_version, scope, run_id: 'readonly-failure-pure-fixture', status: 'FAIL',
    test_success: false, actual_acceptance_verdict: null, full_persisted_chain_executed: false, production_requests: 0,
    historical_success_claim: false, automatic_stable_day: false, handler_count: 0, executed_handlers: [],
    executed_stages: ['persisted-missing-required-quote', 'FIRST_FAILURE'], records: [
      { stage: 'persisted-missing-required-quote', date: '2026-10-01', phase: 'manual_backfill', checkpoint: 'manual',
        correlation_id: retained.correlation, missing_required_symbol: 'NVDA', checkpoint_status: 'DEGRADED', direct_business_seed_writes: 0,
        result: retained.result.body, immutable, immutable_sha256: createHash('sha256').update(JSON.stringify(immutable)).digest('hex'),
        persisted_symbols: immutable.map(row => row.symbol), provider_receipts_sha256: digest, canonical_sha256: digest, compatibility_sha256: digest },
      { stage: 'FIRST_FAILURE', error: 'Never rewind an active replay VM', expected_failure_verified: false, full_chain_pass: false, ambiguous_write_not_retried: true },
    ] };
  assert.equal(validateMissingQuoteReadonlyClockFailure(value, config(), retained), value.run_id);
  for (const mutate of [v => v.handler_count = 1, v => v.executed_handlers.push('fetch-market-data-v10'),
    v => v.records.splice(1, 0, { stage: 'handler:fetch-market-data-v10' }), v => v.records[0].direct_business_seed_writes = 1,
    v => v.records[0].correlation_id = 'wrong', v => v.records[0].immutable[0].symbol = 'NVDA',
    v => v.records[1].error = 'another failure', v => v.status = 'PASS', v => v.actual_acceptance_verdict = 'FAIL']) {
    const invalid = structuredClone(value); mutate(invalid);
    assert.throws(() => validateMissingQuoteReadonlyClockFailure(invalid, config(), retained));
  }
});
test('continuation descriptors require both immutable failure pins and cannot select another path or hash', () => {
  const original = { prior_result_file: '/private/tmp/' + scope + '-evidence/result.json',
    prior_result_sha256: 'e26b7724872a37430c7d71d27f1770d1654edb797232f03260161b491851a61c' };
  const value = { ...original, prior_readonly_failure_file: '/private/tmp/' + scope + '-evidence-warmup-continuation-001/result.json',
    prior_readonly_failure_sha256: '59ee9100b7b6fd4a7b059f4d56a61deb3157f75491b8df7dc8617178b96c9323' };
  assert.equal(validateMissingQuoteWarmupContinuationDescriptor(original, config()), '-warmup-continuation-001');
  assert.equal(validateMissingQuoteWarmupContinuationDescriptor(value, config()), '-warmup-continuation-002');
  for (const mutate of [v => v.prior_readonly_failure_sha256 = digest, v => v.prior_readonly_failure_file += '-other',
    v => delete v.prior_readonly_failure_sha256, v => delete v.prior_readonly_failure_file,
    v => v.prior_result_sha256 = digest, v => v.prior_result_file += '-other', v => v.retry = true]) {
    const invalid = structuredClone(value); mutate(invalid);
    assert.throws(() => validateMissingQuoteWarmupContinuationDescriptor(invalid, config()));
  }
});
test('preserved mounts tolerate only ordering, never identity, permissions, fields or cardinality changes', () => {
  const mounts = [
    { Type: 'bind', Source: '/private/tmp/' + controlScope + '/boundary-main', Destination: '/srv/boundary', Mode: '', RW: false, Propagation: 'rprivate' },
    { Type: 'volume', Name: 'local_core_boundary_' + controlScope, Source: '/var/lib/docker/volumes/local_core_boundary_' + controlScope + '/_data', Destination: '/var/run/' + controlScope, Driver: 'local', Mode: 'z', RW: true, Propagation: '' },
  ];
  const expected = canonicalPreservedMounts(mounts);
  const reordered = [...mounts].reverse().map(row => Object.fromEntries(Object.entries(row).reverse()));
  assert.deepEqual(canonicalPreservedMounts(reordered), expected);
  assert.notDeepEqual(reordered, mounts, 'Reproduce the former raw array-order assertion failure');
  for (const [key, value] of [['Type', 'volume'], ['Source', '/wrong'], ['Destination', '/wrong'], ['Mode', 'rw'], ['RW', true], ['Propagation', 'shared'], ['extra_field', true]]) {
    const changed = structuredClone(mounts); changed[0][key] = value;
    assert.notDeepEqual(canonicalPreservedMounts(changed), expected, key);
  }
  for (const key of ['Name', 'Driver']) {
    const changed = structuredClone(mounts); changed[1][key] = 'wrong';
    assert.notDeepEqual(canonicalPreservedMounts(changed), expected, key);
  }
  assert.notDeepEqual(canonicalPreservedMounts(mounts.slice(0, 1)), expected);
  assert.throws(() => canonicalPreservedMounts([mounts[0], mounts[0]]));
});
const environment = { MA_LOCAL_SCOPE: scope, MA_CONSOLIDATION_REPLAY: 'LOCAL_ONLY' };
const reconstructProviderRequest = () => isolatedFunction(read('tests/integration/coreConsolidationMissingQuote.e2e.mjs'), 'reconstructCheckpointProviderRequest', {
  assert, exports: {}, URL, object: value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
});
test('quote request reconstruction preserves the real futures producer session and all existing provider categories', async () => {
  const reconstruct = reconstructProviderRequest(), calls = [];
  const producer = isolatedFunction(read('supabase/functions/fetch-market-data-v10/index.ts'), 'fetchFugleFutOptQuote', {
    fetchFugleQuoteFromPath: async (...args) => { calls.push(args); return { raw: { provider: args[4], source_symbol: args[1] } }; },
  });
  for (const session of ['afterhours', 'regular']) {
    const quote = await producer('TXF1!', 'unused-synthetic-key', 'test', session, []);
    const source = { source: 'fugle_futopt', raw: { contract: 'FETCH_CHECKPOINT_EVIDENCE_V1', source_symbol: 'TXF1!', source_raw: quote.raw } };
    const call = calls.at(-1), query = call[6] ? '?' + new URLSearchParams(call[6]).toString() : '';
    assert.deepEqual(JSON.parse(JSON.stringify(reconstruct(source))), { url: 'https://api.fugle.tw/marketdata/v1.0/' + call[0] + '/' + encodeURIComponent(call[1]) + query, method: 'GET', body: null });
  }
  for (const [provider, symbol, raw, expected] of [
    ['finnhub', 'SPY', { finnhub_symbol: 'SPY' }, 'https://finnhub.io/api/v1/quote?symbol=SPY'],
    ['fugle', 'IX0001', { source_symbol: 'IX0001' }, 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/IX0001'],
  ]) assert.equal(reconstruct({ source: provider, raw: { contract: 'FETCH_CHECKPOINT_EVIDENCE_V1', source_symbol: symbol, source_raw: { provider, ...raw } } }).url, expected);
});
test('quote receipt verification rejects wrong or missing session and unknown or mismatched provider provenance', () => {
  const reconstruct = reconstructProviderRequest(), hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const source = { source: 'fugle_futopt', raw: { contract: 'FETCH_CHECKPOINT_EVIDENCE_V1', source_symbol: 'TXF1!',
    source_raw: { provider: 'fugle_futopt', source_symbol: 'TXF1!', product: 'TXF', session: 'afterhours' } } };
  const recorded = 'c8ff5b6832a649173c18c775570c539c7db6544abbadcf74a7fb0c6f09b980ae';
  assert.equal(hash(reconstruct(source)), recorded, 'Matches the actual retained successful warmup TXF request');
  const regular = structuredClone(source); regular.raw.source_raw.session = 'regular';
  assert.notEqual(hash(reconstruct(regular)), recorded, 'A legal regular request cannot match an afterhours receipt');
  for (const mutate of [v => delete v.raw.source_raw.session, v => v.raw.source_raw.session = 'unknown',
    v => v.source = 'unknown', v => v.raw.source_raw.provider = 'fugle', v => v.raw.source_raw.source_symbol = 'OTHER',
    v => v.raw.source_raw.product = 'OTHER']) {
    const invalid = structuredClone(source); mutate(invalid); assert.throws(() => reconstruct(invalid));
  }
  const driver = read('tests/integration/coreConsolidationMissingQuote.e2e.mjs');
  assert.match(driver, /const request = reconstructCheckpointProviderRequest\(source\);\s*const receipt = oneRow\(receipts\.filter\(row => row\.request_sha256 === sha256\(JSON\.stringify\(request\)\)\)\)/);
});
test('protected receipt requires exact mount format and actual reader hashes canonical full-field records', () => {
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  const mounts = [{ Type: 'volume', Name: 'control', Source: '/source', Destination: '/destination', Driver: 'local', Mode: 'z', RW: true, Propagation: '' }];
  const edge = { name: 'supabase_edge_runtime_' + controlScope, image_id: 'sha256:' + digest };
  const cfg = { containers: { edge }, additional_containers: [], functions: [], boundary: { deployed_file: '/boundary', bundle_sha256: digest } };
  const baseline = { tables: Object.fromEntries(RETAINED_TABLES.map(name => [name, []])), boundary: { receipts: [] } };
  const receipt = { scope, retained_scope: controlScope, mount_hash_format: 'ALL_FIELDS_KEY_SORTED_DESTINATION_SORTED',
    status: 'RETAINED_EXACT_SIX_STOPPED_ONE_CLI_REMOVED', auth_rows_read_or_modified: false, business_rows_modified: false,
    cli_serve_stopped: true, volumes_deleted: false, removed_ephemeral_edge: { ...edge, id: digest, reason: 'ORIGINAL_CLI_SHUTDOWN_REMOVED_STATELESS_EDGE' },
    ...baseline, stopped_containers: [], retained_volume_names: ['local_core_boundary_' + controlScope, 'supabase_db_' + controlScope, 'supabase_edge_runtime_' + controlScope],
    guest_bundle_hashes: [{ deployed_file: '/boundary', sha256: digest }] };
  validateProtectedControlReceipt(receipt, baseline, cfg);
  for (const format of [undefined, 'RAW_JSON', 'UNKNOWN']) {
    const changed = structuredClone(receipt); if (format === undefined) delete changed.mount_hash_format; else changed.mount_hash_format = format;
    assert.throws(() => validateProtectedControlReceipt(changed, baseline, cfg));
  }
  const stop = new Error('READER_REACHED_UNCHANGED_PREDECESSOR');
  const protectedReceipt = { ...receipt, stopped_containers: [{ name: 'control', id: digest, mounts_sha256: sha256(JSON.stringify(canonicalPreservedMounts(mounts))) }], retained_volume_names: [], guest_bundle_hashes: [] };
  const inspect = actualMounts => isolatedFunction(read('tests/helpers/coreConsolidationMissingQuoteRuntime.mjs'), 'createGuestReadback', {
    assert, exports: {}, process: { env: {} }, sha256, canonicalPreservedMounts, readProtectedControl: () => protectedReceipt,
    verifyPreservedArtifacts: () => { throw stop; },
    execFileSync: (_bin, args) => {
      assert.deepEqual(Array.from(args.slice(0, 4)), ['shell', '--workdir', '/', 'clock']);
      const command = args.slice(4);
      if (command[0] === 'cat') return boot;
      if (command.includes('inspect')) return JSON.stringify([{ Id: digest, State: { Running: false }, Mounts: actualMounts }]);
      if (command.includes('ps')) return '';
      throw new Error('Unexpected read-only command');
    },
  })({ clock: { configuration: { instance: 'clock', limaHome: '/unused', bootId: boot } } }).inspect();
  assert.throws(() => inspect(mounts), error => error === stop, 'Actual reader must cross the canonical hash boundary');
  assert.throws(() => inspect([{ ...mounts[0], RW: false }]), error => error.code === 'ERR_ASSERTION');
});
const oldConfig = isolatedFunction(read('tests/coreConsolidationReplayPreparation.test.mjs'), 'config', { scope, digest, boot, REPLAY_FUNCTIONS });
function config() {
  const value = structuredClone(oldConfig());
  Object.assign(value, { schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V4',
    report_date: '2026-10-02', warmup_date: '2026-10-01', api_origin: 'http://127.0.0.1:55511',
    scenario_kind: 'SYNTHETIC_MISSING_REQUIRED_NVDA_NEGATIVE', attempt: 1, previous_attempt_results: [],
    external_content_os_delivery: false, protected_control_receipt_file: '/private/tmp/' + scope + '/control-scope-preservation.json',
    protected_control_receipt_sha256: digest,
    old_scope_preservation: { scope: 'ma-consolidation-v1-20260909183000', report_date: '2026-09-23',
      receipt_file: '/private/tmp/' + controlScope + '/old-scope-preservation.json', receipt_sha256: digest,
      artifacts: structuredClone(RETAINED_ARTIFACTS) },
    gateway_verification: Object.fromEntries([...REPLAY_FUNCTIONS, 'local-core-consolidation-boundary'].map(slug => [slug, true])),
    auth_fixture: { provenance: 'NO_USER_CRON_ONLY_NEGATIVE_CONTROL', new_synthetic_users: 0, auth_users_expected: 0,
      login_or_user_lookup: false, existing_scope_credentials_read: true, authorized_local_key_reuse: AUTHORIZED_KEY_REUSE,
      old_auth_sessions_copied: false, existing_accounts_modified: false, admin_role_fixtures: false } });
  value.clock.configuration = { ...value.clock.configuration, root: '/private/tmp/ma-clock-20260909-183000',
    limaHome: '/private/tmp/ma-clock-20260909-183000/lima', configPath: '/private/tmp/ma-clock-20260909-183000/clock.yaml', bootId: boot };
  value.sql_functions.push({ name: 'reconcile_runtime_terminal_failures_v1', definition_md5: 'b'.repeat(32) });
  return value;
}
const control = () => JSON.parse(read(MISSING_QUOTE_CONTROL.path));
const fixture = () => JSON.parse(read('tests/fixtures/consolidation-v1/providers/missing-required-nvda-20261002.json'));

test('negative scope is exact, all JWT checks remain enabled, and zero users or sessions are permitted', () => {
  assert.equal(validateReplayConfiguration(config(), environment).scope, scope);
  assert.equal(config().auth_fixture.new_synthetic_users, 0);
  assert.equal(config().gateway_verification['get-report-payload'], true);
  assert.equal(PROTECTED_CONTROL_ARTIFACTS[0].sha256, 'fa0fcc81bf14a4a83b3acc38b29e2e6895eb329e4096ef5d560c277bb82a5838');
});
for (const [name, mutate] of [
  ['existing scope', v => v.scope = controlScope],
  ['existing API', v => v.api_origin = 'http://127.0.0.1:55501'],
  ['external API', v => v.api_origin = 'https://example.invalid'],
  ['new user', v => v.auth_fixture.new_synthetic_users = 1],
  ['existing user in new DB', v => v.auth_fixture.auth_users_expected = 1],
  ['user login', v => v.auth_fixture.login_or_user_lookup = true],
  ['session transfer', v => v.auth_fixture.old_auth_sessions_copied = true],
  ['account mutation', v => v.auth_fixture.existing_accounts_modified = true],
  ['admin role', v => v.auth_fixture.admin_role_fixtures = true],
  ['public JWT exception', v => v.gateway_verification['get-report-payload'] = false],
  ['other key', v => v.auth_fixture.authorized_local_key_reuse = { ...AUTHORIZED_KEY_REUSE, key_generation: 1 }],
  ['missing positive preservation', v => delete v.protected_control_receipt_file],
  ['old failure replacement', v => v.old_scope_preservation.artifacts[0].sha256 = digest],
  ['historical success claim', v => v.historical_success_claim = true],
  ['Production authorization', v => v.production_operations_authorized = true],
  ['retry adoption', v => v.attempt = 2],
]) test('negative config rejects ' + name, () => { const value = config(); mutate(value); assert.throws(() => validateReplayConfiguration(value, environment)); });

test('only provider fault is globally missing NVDA, preserving every other quote and complete AI response', () => {
  const value = fixture(), previous = control(); validateMissingQuoteFixture(value, previous);
  const quotes = structuredClone(previous.quotes); delete quotes.NVDA;
  assert.deepEqual(value.quotes, quotes); assert.deepEqual(value.openai_completion, previous.openai_completion);
  for (const phase of value.phases) {
    assert.equal(vendor({ url: 'https://finnhub.io/api/v1/quote?symbol=NVDA' }, value, phase.starts_at).status, 404);
    assert.equal(vendor({ url: 'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/NVDA' }, value, phase.starts_at).status, 404);
    assert.equal(vendor({ url: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=NVDA' }, value, phase.starts_at).body.msgArray.length, 0);
    assert.equal(vendor({ url: 'https://finnhub.io/api/v1/quote?symbol=SPY' }, value, phase.starts_at).status, 200);
  }
  const fetchSource = read('supabase/functions/fetch-market-data-v10/index.ts');
  assert.ok(/const fetchedQuote = config\.market === "TW"\s*\? await fetchTaiwanCoreQuote\([^\n]+\)\s*:\s*await fetchFinnhubQuote\(config\.finnhubSymbol/.test(fetchSource), 'Actual non-TW fetch lane must use Finnhub without a hidden quote fallback');
});
for (const [name, mutate] of [
  ['NVDA restored', v => v.quotes.NVDA = control().quotes.NVDA],
  ['other quote removed', v => delete v.quotes.SPY],
  ['news importance raised', v => v.news[0].importance = 100],
  ['AI answer changed', v => v.openai_completion.choices[0].message.content += ' '],
  ['assigned successful business state', v => v.publication_status = 'READY'],
  ['date changed', v => v.report_date = '2026-10-03'],
]) test('exact input guard rejects ' + name, () => { const value = fixture(); mutate(value); assert.throws(() => validateMissingQuoteFixture(value, control())); });
for (const date of ['2026-09-25', '2026-10-03', '2026-10-04']) test('canonical calendar rejects non-trading day ' + date, () => {
  assert.throws(() => assertReplayMarketDays('2026-09-24', date));
});

function clock() { return { scope, guest: { boot_id: boot }, postgres: { scope, observed_at: '2026-10-02T00:00:02Z', auth_user_count: 0 },
  edge: { scope, observed_at: '2026-10-02T00:00:03Z', receiver_observed_at: '2026-10-02T00:00:03Z', boot_id: boot, clock_override: false, business_edge_clock_observed: true },
  started: '2026-10-02T00:00:00Z', ended: '2026-10-02T00:00:04Z' }; }
test('negative clock witness is PG/actual Edge only, not fabricated user Auth validation', () => { assertClockAgreement(clock()); });
for (const [name, mutate] of [['user created', v => v.postgres.auth_user_count = 1], ['copied Auth witness', v => v.auth = { user_id: 'fake' }],
  ['clock override', v => v.edge.clock_override = true], ['wrong guest', v => v.edge.boot_id = 'other'], ['clock skew', v => v.postgres.observed_at = '2026-10-01T00:00:00Z']])
  test('negative clock rejects ' + name, () => { const value = clock(); mutate(value); assert.throws(() => assertClockAgreement(value)); });

function journal() {
  const writes = [];
  const factory = isolatedFunction(read('tests/helpers/coreConsolidationMissingQuoteRuntime.mjs'), 'createReplayJournal', {
    assert, exports: {}, REPLAY_FUNCTIONS, randomUUID: () => 'synthetic-test-run', mkdirSync: () => {}, appendFileSync: () => {},
    writeFileSync: (path, value) => writes.push([path, JSON.parse(value)]),
  });
  return { value: factory(config()), writes };
}
const verification = { acceptance_verdict: 'FAIL', publication_blocked: true, line_delivery_blocked: true,
  terminal_complete: false, missing_required_symbol: 'NVDA' };
test('negative test success never claims business PASS, userAuth or thirteen executed handlers', () => {
  const { value } = journal();
  value.append('handler:fetch-market-data-v10', { http: 200, business_success: false });
  value.append('handler:fetch-market-data-v10', { http: 200, business_success: false });
  value.append('negative-control-verified', verification);
  const result = value.finish('EXPECTED_FAILURE_VERIFIED');
  assert.equal(result.test_success, true); assert.equal(result.actual_acceptance_verdict, 'FAIL');
  assert.equal(result.full_persisted_chain_executed, false); assert.equal(result.handler_count, 1);
  assert.deepEqual(Array.from(result.executed_handlers), ['fetch-market-data-v10']); assert.equal(result.configured_handler_count, 13);
  assert.equal(result.historical_success_claim, false); assert.equal(result.automatic_stable_day, false);
});
for (const status of ['PASS', 'READY', 'SUCCEEDED']) test('negative journal refuses ' + status, () => { const value = journal().value; assert.throws(() => value.finish(status)); });
test('negative verification cannot finish before real business assertions are recorded', () => { const value = journal().value; assert.throws(() => value.finish('EXPECTED_FAILURE_VERIFIED')); });
for (const [field, value] of [['acceptance_verdict', 'PASS'], ['publication_blocked', false], ['line_delivery_blocked', false], ['terminal_complete', true], ['missing_required_symbol', 'SPY']])
  test('negative verification rejects ' + field, () => { const item = journal().value; item.append('negative-control-verified', { ...verification, [field]: value }); assert.throws(() => item.finish('EXPECTED_FAILURE_VERIFIED')); });

test('schema preparer remains a separate opt-in executable with exact empty-DB and zero-Auth guards', () => {
  const source = read('tests/integration/coreConsolidationMissingQuotePrepareLocal.mjs');
  assert.match(source, /'ma-consolidation-v1-20260909210000': '172\.23\.0\.0\/16'/);
  assert.match(source, /select count\(\*\) from auth\.users/);
  assert.match(source, /Only the exact already-reviewed local candidate SQL/);
  assert.match(source, /schema-rebuild-results\.json/);
  assert.ok(!source.includes('signUp('));
});

// New, exact fresh successor only. Every original callback above is preserved.
function successorConfig() {
  const value = JSON.parse(JSON.stringify(config()).replaceAll(scope, FRESH_MISSING_QUOTE_SCOPE));
  Object.assign(value, { schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V5', report_date: '2026-10-06',
    warmup_date: '2026-10-05', api_origin: 'http://127.0.0.1:55521',
    protected_control_receipt_file: '/private/tmp/' + scope + '/control-scope-preservation.json',
    protected_control_receipt_sha256: '2700abe8ef15ac76a054f0eaedfcae2d0fa4e3cd7985f5c5d1baa9e38f35f9fd',
    prior_failed_scope_preservation: { scope, report_date: '2026-10-02',
      receipt_file: '/private/tmp/' + FRESH_MISSING_QUOTE_SCOPE + '/prior-failed-scope-preservation.json',
      receipt_sha256: digest, artifacts: structuredClone(PRIOR_FAILED_SCOPE_ARTIFACTS) } });
  return value;
}
const successorEnvironment = { ...environment, MA_LOCAL_SCOPE: FRESH_MISSING_QUOTE_SCOPE };
test('fresh October 6 successor has its own exact scope/API, zero users, all14 JWTs and independent failed preservation', () => {
  const value = successorConfig(); assert.equal(validateReplayConfiguration(value, successorEnvironment), value);
  assert.equal(validateReplayConfiguration(config(), environment).scope, scope, 'Original V4 contract remains valid');
  assert.equal(Object.values(value.gateway_verification).length, 14);
  assert.ok(Object.values(value.gateway_verification).every(v => v === true));
  assert.equal(value.auth_fixture.auth_users_expected, 0);
  assert.equal(value.prior_failed_scope_preservation.artifacts[0].sha256, '104967a06e13062728eec64324e97f5297b002cec4d3d29ac6b5c43b9020d283');
  assert.equal(value.prior_failed_scope_preservation.artifacts[1].sha256, 'f66d4e1f519f1c6d95f14104df5df89509e3e2431b149f1b26dc389a1eb3f925');
});
for (const [name, mutate] of [
  ['unknown scope', v => v.scope = 'ma-consolidation-v1-20260910230000'],
  ['old API', v => v.api_origin = 'http://127.0.0.1:55511'],
  ['old version', v => v.schema_version = 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V4'],
  ['wrong main date', v => v.report_date = '2026-10-07'],
  ['wrong warmup date', v => v.warmup_date = '2026-10-02'],
  ['missing failed preservation', v => delete v.prior_failed_scope_preservation],
  ['failure reclassified as control', v => v.protected_control_receipt_file = v.prior_failed_scope_preservation.receipt_file],
  ['prior failed path rebound', v => v.prior_failed_scope_preservation.artifacts[0].path += '-other'],
  ['prior source archive repinned', v => v.prior_failed_scope_preservation.artifacts[8].sha256 = digest],
  ['prior failure artifact removed', v => v.prior_failed_scope_preservation.artifacts.pop()],
  ['arbitrary retention receipt', v => v.prior_failed_scope_preservation.receipt_file += '-other'],
  ['old rows adoption', v => v.prior_failed_scope_preservation.adopted_as_input = true],
  ['new user', v => v.auth_fixture.new_synthetic_users = 1],
  ['disabled JWT', v => v.gateway_verification['get-report-payload'] = false],
]) test('fresh successor rejects ' + name, () => {
  const value = successorConfig(); mutate(value); assert.throws(() => validateReplayConfiguration(value, successorEnvironment));
});
test('fresh successor cannot enter the old single-warmup continuation even with original failure hashes', () => {
  assert.throws(() => validateMissingQuoteWarmupContinuationDescriptor({
    prior_result_file: '/private/tmp/' + FRESH_MISSING_QUOTE_SCOPE + '-evidence/result.json',
    prior_result_sha256: 'e26b7724872a37430c7d71d27f1770d1654edb797232f03260161b491851a61c',
  }, successorConfig()), /never adopt/);
  const source = read('tests/integration/coreConsolidationMissingQuote.e2e.mjs');
  assert.match(source, /if \(config.scope === 'ma-consolidation-v1-20260910220000'\) assert.equal\(warmupContinuation, null/);
  assert.match(source, /Fresh unseeded scope required/);
});
test('October 6 raw negative fixture preserves business facts and legal Monday warmup Friday US close', () => {
  const actual = JSON.parse(read('tests/fixtures/consolidation-v1/providers/missing-required-nvda-20261006.json'));
  const positive = control(); validateMissingQuoteFixture(actual, positive);
  assert.deepEqual(actual, buildMissingQuoteFixture(positive, '2026-10-06'));
  assert.deepEqual(actual.openai_completion, positive.openai_completion);
  const quotes = structuredClone(positive.quotes); delete quotes.NVDA; assert.deepEqual(actual.quotes, quotes);
  assert.equal(actual.phases[0].source_times.US, '2026-10-02T20:00:00.000Z');
  for (const phase of actual.phases) assert.equal(vendor({ url: 'https://finnhub.io/api/v1/quote?symbol=NVDA' }, actual, phase.starts_at).status, 404);
  const wrong = structuredClone(actual); wrong.phases[0].source_times.US = '2026-10-04T20:00:00.000Z';
  assert.throws(() => validateMissingQuoteFixture(wrong, positive), /exact date transformation/);
  assert.deepEqual(buildMissingQuoteFixture(positive), fixture(), 'The original October 2 bytes retain their original meaning');
  assert.throws(() => buildMissingQuoteFixture(positive, '2026-10-07'));
});
function failedScopePreservation() {
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const names = [...['auth', 'db', 'edge_runtime', 'kong', 'rest', 'inbucket'].map(value => 'supabase_' + value + '_' + scope), 'local_core_boundary_' + scope];
  const before = names.map((name, i) => ({ name, id: String(i + 1).repeat(64), image_id: 'sha256:' + digest,
    network_names: [scope + '-isolated'], mounts: i === 0 ? [] : [{ Type: 'volume', Name: name, Source: '/volumes/' + name,
      Destination: '/data', Driver: 'local', Mode: 'z', RW: true, Propagation: '' }] }));
  const old = { scope, containers: Object.fromEntries(['auth', 'db', 'edge', 'gateway', 'rest'].map((name, i) => [name, before[i]])),
    additional_containers: before.slice(5), functions: REPLAY_FUNCTIONS.map(slug => ({ slug, deployed_file: '/private/tmp/' + scope + '/' + slug, bundle_sha256: digest })),
    boundary: { deployed_file: '/private/tmp/' + scope + '/boundary', bundle_sha256: digest } };
  const tables = Object.fromEntries(RETAINED_TABLES.map(name => [name, []]));
  tables.reports = [{ id: '567ac81a-51a5-4b49-a694-4cc524a47e80', report_date: '2026-10-02', marker: 'ERRONEOUS_PUBLICATION_MUST_REMAIN' }];
  tables.decision_snapshots = [{ id: 'bdec7b93-87a3-48cc-9d0c-e58b7c6bffda' }];
  tables.member_content_revisions = [{ id: '804fb545-f237-4f1f-8c65-16af091ab3dd' }];
  const baseline = { schema_version: 'CORE_MISSING_QUOTE_AFTER_GENERATOR500_READONLY_V1', scope, auth_user_count: 0,
    tables, containers: before.map(({ name, id, image_id }) => ({ name, id, image_id })),
    provider_receipts: Array.from({ length: 29 }, (_, i) => ({ index: i, scope })), provider_receipts_jsonl_sha256: digest };
  const edge = before[2];
  const receipt = { schema_version: 'CORE_MISSING_QUOTE_FAILED_SCOPE_PRESERVATION_V1', scope: FRESH_MISSING_QUOTE_SCOPE,
    retained_scope: scope, retained_report_date: '2026-10-02', status: 'FAILED_SCOPE_RETAINED_EXACT_SIX_STOPPED_ONE_CLI_REMOVED',
    prior_result_status: 'FAIL', adopted_as_input: false, successful_control_claim: false, business_rows_modified: false,
    auth_rows_read_or_modified: false, auth_user_count: 0, volumes_deleted: false, cli_serve_stopped: true,
    mount_hash_format: 'ALL_FIELDS_KEY_SORTED_DESTINATION_SORTED', artifacts: structuredClone(PRIOR_FAILED_SCOPE_ARTIFACTS),
    tables: structuredClone(tables), provider_receipts: structuredClone(baseline.provider_receipts), provider_receipts_jsonl_sha256: digest,
    containers_before_stop: before, removed_ephemeral_edge: { name: edge.name, id: edge.id, image_id: edge.image_id,
      mounts_sha256: hash(canonicalPreservedMounts(edge.mounts)), reason: 'ORIGINAL_CLI_SHUTDOWN_REMOVED_STATELESS_EDGE' },
    stopped_containers: before.filter(row => row !== edge).map(row => ({ name: row.name, id: row.id, image_id: row.image_id,
      running: false, mounts_sha256: hash(canonicalPreservedMounts(row.mounts)) })),
    retained_volume_names: ['local_core_boundary_', 'supabase_db_', 'supabase_edge_runtime_'].map(prefix => prefix + scope),
    guest_bundle_hashes: [...old.functions, old.boundary].map(row => ({ deployed_file: row.deployed_file, sha256: row.bundle_sha256 })) };
  const failure = { scope, status: 'FAIL', run_id: '1229c88e-edce-48c4-b57a-2e71f3e6072e', test_success: false,
    full_persisted_chain_executed: false, actual_acceptance_verdict: null, records: [
      { stage: 'handler:generate-daily-report-v7', http: 500, response_body: { error_code: 'RESEARCH_EXECUTION_FAILED', reason_codes: ['REPORT_STATE_ADVANCE_FAILED'] } },
    ] };
  return { receipt, baseline, old, failure };
}
test('prior Gen500 and its erroneous publication are retained exactly without promoting failed scope to successful control', () => {
  const { receipt, baseline, old, failure } = failedScopePreservation();
  assert.equal(validatePriorFailedScopeReceipt(receipt, baseline, old, failure), receipt);
  assert.equal(receipt.tables.reports[0].marker, 'ERRONEOUS_PUBLICATION_MUST_REMAIN');
  assert.equal(receipt.successful_control_claim, false); assert.equal(receipt.adopted_as_input, false);
  validatePriorFailedScopeConfiguration(successorConfig().prior_failed_scope_preservation);
});
for (const [name, mutate] of [
  ['successful label', x => x.receipt.prior_result_status = 'PASS'],
  ['successful control', x => x.receipt.successful_control_claim = true],
  ['adoption', x => x.receipt.adopted_as_input = true],
  ['deleted prior report', x => x.receipt.tables.reports = []],
  ['changed report bytes', x => x.receipt.tables.reports[0].marker = 'changed'],
  ['missing table', x => delete x.receipt.tables.runtime_dead_letters],
  ['missing receipt', x => x.receipt.provider_receipts.pop()],
  ['altered vendor receipt', x => x.receipt.provider_receipts[0].index = 9],
  ['altered JSONL bytes', x => x.receipt.provider_receipts_jsonl_sha256 = 'b'.repeat(64)],
  ['wrong original run', x => x.failure.run_id = 'another'],
  ['promoted original failure', x => x.failure.status = 'PASS'],
  ['original rejection changed', x => x.failure.records[0].http = 409],
  ['missing old container', x => x.receipt.stopped_containers.pop()],
  ['running old container', x => x.receipt.stopped_containers[0].running = true],
  ['wrong original identity', x => x.receipt.containers_before_stop[0].id = digest],
  ['different old image', x => x.receipt.stopped_containers[0].image_id = 'sha256:' + 'b'.repeat(64)],
  ['mount permission drift', x => x.receipt.containers_before_stop[1].mounts[0].RW = false],
  ['extra mount field', x => x.receipt.containers_before_stop[1].mounts[0].other = true],
  ['changed mount cardinality', x => x.receipt.containers_before_stop[1].mounts = []],
  ['missing original volume', x => x.receipt.retained_volume_names.pop()],
  ['bundle substitution', x => x.receipt.guest_bundle_hashes[0].sha256 = 'b'.repeat(64)],
  ['unknown removed service', x => x.receipt.removed_ephemeral_edge.name = 'other'],
  ['failure source repinned', x => x.receipt.artifacts[8].sha256 = digest],
  ['Auth creation', x => x.receipt.auth_user_count = 1],
]) test('failed-scope retention rejects ' + name, () => {
  const value = failedScopePreservation(); mutate(value);
  assert.throws(() => validatePriorFailedScopeReceipt(value.receipt, value.baseline, value.old, value.failure));
});
