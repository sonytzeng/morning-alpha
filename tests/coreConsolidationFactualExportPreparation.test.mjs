// Pure preparation only: no VM, database, Auth, provider or handler execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readActualFileSync } from 'node:fs';
import { readExactFixturePreimage } from './helpers/consolidationFixtureRepresentation.mjs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { REPLAY_FUNCTIONS, REPLAY_SCOPE_CONTRACTS, AUTHORIZED_KEY_REUSE,
  RETAINED_ARTIFACTS, RETAINED_TABLES, RETAINED_CONTAINERS, FACTUAL_INPUT_PREDECESSOR, REMOVED_OLD_EDGE,
  validateReplayConfiguration, validateDateOnlyProviderFixture,
  validatePreservationConfiguration, validatePreservationReceipt, assertReplayMarketDays,
  parseRetainedVendorReceipts, parseRetainedGuestHash, retainedCliSupervisorRunning,
} from './helpers/coreConsolidationFactualExportRuntime.mjs';

// Preserve the exact historical fixture assertion, after validating its one-LF representation.
const representedFixturePath = 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260923.json';
const representedFixtureUrl = new URL('../' + representedFixturePath, import.meta.url).href;
const readFileSync = (target, options) => {
  if (target instanceof URL && target.href === representedFixtureUrl) {
    const bytes = readExactFixturePreimage(representedFixturePath, readActualFileSync(target));
    return options === 'utf8' ? bytes.toString('utf8') : bytes;
  }
  return readActualFileSync(target, options);
};

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scope = 'ma-consolidation-v1-20260909200000', digest = 'a'.repeat(64);
const boot = 'd9f73673-b3e3-4daf-8080-13d8dde5b2c0';
const environment = { MA_LOCAL_SCOPE: scope, MA_CONSOLIDATION_REPLAY: 'LOCAL_ONLY' };
const oldConfig = isolatedFunction(read('tests/coreConsolidationReplayPreparation.test.mjs'), 'config',
  { scope, digest, boot, REPLAY_FUNCTIONS });
function preservation() { return { scope: 'ma-consolidation-v1-20260909183000', report_date: '2026-09-23',
  receipt_file: '/private/tmp/' + scope + '/old-scope-preservation.json', receipt_sha256: digest,
  artifacts: structuredClone(RETAINED_ARTIFACTS) }; }
function config() {
  const value = structuredClone(oldConfig());
  value.clock.configuration = { ...value.clock.configuration,
    root: '/private/tmp/ma-clock-20260909-183000', limaHome: '/private/tmp/ma-clock-20260909-183000/lima',
    configPath: '/private/tmp/ma-clock-20260909-183000/clock.yaml', bootId: boot };
  value.docker.guest_boot_id = boot;
  Object.assign(value, { schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V4', report_date: '2026-09-30',
    warmup_date: '2026-09-29', api_origin: 'http://127.0.0.1:55501', attempt: 1, previous_attempt_results: [],
    external_content_os_delivery: false, old_scope_preservation: preservation(),
    gateway_verification: Object.fromEntries([...REPLAY_FUNCTIONS, 'local-core-consolidation-boundary'].map(slug => [slug, true])),
    auth_fixture: { provenance: 'FRESH_SCOPE_IDENTITY_WITH_AUTHORIZED_DEDICATED_VM_KEY2', new_synthetic_users: 1,
      existing_scope_credentials_read: true, authorized_local_key_reuse: structuredClone(AUTHORIZED_KEY_REUSE),
      old_auth_sessions_copied: false, existing_accounts_modified: false, admin_role_fixtures: false } });
  value.sql_functions.push({ name: 'reconcile_runtime_terminal_failures_v1', definition_md5: 'b'.repeat(32) });
  return value;
}
const previous = () => JSON.parse(read(FACTUAL_INPUT_PREDECESSOR.path));
test('actual preservation parsers read newline JSONL and whitespace guest checksum output', () => {
  const rows = [{ request_sha256: digest }, { response_sha256: digest }];
  assert.deepEqual(parseRetainedVendorReceipts(rows.map(row => JSON.stringify(row)).join('\n') + '\n'), rows);
  assert.equal(parseRetainedGuestHash(digest + '  /private/tmp/retained/index.js\n', '/private/tmp/retained/index.js'), digest);
  assert.equal(retainedCliSupervisorRunning('1 other\n2 supabase functions serve --workdir /private/tmp/ma-consolidation-v1-20260909183000\n3 other', '/private/tmp/ma-consolidation-v1-20260909183000'), true);
  assert.equal(retainedCliSupervisorRunning('1 supabase functions serve --workdir /private/tmp/unrelated\n2 other', '/private/tmp/ma-consolidation-v1-20260909183000'), false);
});
test('actual preservation parsers reject escaped separators, wrong path and invalid records', () => {
  assert.throws(() => parseRetainedVendorReceipts('{}' + String.raw`\n` + '{}'));
  assert.throws(() => parseRetainedVendorReceipts('[]\n'));
  assert.throws(() => parseRetainedGuestHash(digest + '  /private/tmp/other.js', '/private/tmp/retained/index.js'));
  assert.throws(() => parseRetainedGuestHash(digest + String.raw`\s` + '/private/tmp/retained/index.js', '/private/tmp/retained/index.js'));
  assert.throws(() => retainedCliSupervisorRunning('', '/private/tmp/unapproved'));
});
for (const [name, supplied, admitted] of [
  ['exact new scope', { schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V4', scope }, true],
  ['old executed scope', { schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V4', scope: 'ma-consolidation-v1-20260909183000' }, false],
  ['unknown scope', { schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V4', scope: scope + '-other' }, false],
  ['legacy continuation', { schema_version: 'CORE_CONSOLIDATION_FRESH_MANUAL_CONTINUATION_V1', scope }, false],
]) test('actual fresh driver entry accepts no legacy adoption: ' + name, async () => {
  const reachedConfiguration = new Error('PURE_TEST_CONFIGURATION_BOUNDARY');
  let entered = false;
  const run = isolatedFunction(read('tests/integration/coreConsolidationFactualExportFullChain.e2e.mjs'),
    'runCoreConsolidationPublicExportFullChain', { assert, exports: {}, repo: '/pure-test-not-executed',
      readFileSync: () => JSON.stringify(supplied), validateReplayConfiguration: () => {
        entered = true; throw reachedConfiguration;
      } });
  await assert.rejects(run('/pure-test-config-not-read'), error => admitted ? error === reachedConfiguration : error !== reachedConfiguration);
  assert.equal(entered, admitted, 'Entry guard must reject old scopes before any configuration, credential or runtime access');
});
const next = () => JSON.parse(read('tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260930.json'));
function baseline() { return { tables: Object.fromEntries(RETAINED_TABLES.map(name => [name, []])),
  boundary: { success: true, scope: 'ma-consolidation-v1-20260909183000', receipts: [{ raw: 'retained synthetic observation' }] } }; }
function receipt() { return { ...baseline(), scope, retained_scope: 'ma-consolidation-v1-20260909183000',
  retained_report_date: '2026-09-23', status: 'RETAINED_EXACT_AND_STOPPED', cli_serve_stopped: true,
  business_rows_modified: false, auth_rows_read_or_modified: false, volumes_deleted: false,
  stopped_containers: RETAINED_CONTAINERS.map(name => ({ name, id: digest, image_id: 'sha256:' + digest,
    mounts_sha256: digest, running: false })) }; }

test('fresh 9/30 exact scope permits only isolated key2 reuse and all fourteen JWT-verified endpoints', () => {
  assert.equal(validateReplayConfiguration(config(), environment).scope, scope);
  assert.deepEqual(Object.keys(REPLAY_SCOPE_CONTRACTS), [scope]);
  assert.equal(REPLAY_FUNCTIONS.length, 13); assert.equal(new Set(REPLAY_FUNCTIONS).size, 13);
  assert.equal(config().auth_fixture.new_synthetic_users, 1);
});
for (const [name, mutate] of [
  ['old scope', v => v.scope = 'ma-consolidation-v1-20260909183000'],
  ['arbitrary scope', v => v.scope = 'ma-consolidation-v1-20260909999999'],
  ['old API', v => v.api_origin = 'http://127.0.0.1:55491'],
  ['external API', v => v.api_origin = 'https://production.example.invalid'],
  ['old business date', v => v.report_date = '2026-09-23'],
  ['old warmup', v => v.warmup_date = '2026-09-23'],
  ['attempt reuse', v => v.attempt = 2],
  ['old report adoption', v => v.previous_attempt_results = [{ path: '/private/tmp/old.json', sha256: digest }]],
  ['old shared VM', v => v.clock.configuration.root = '/private/tmp/ma-clock-20260909-020052'],
  ['wrong boot', v => { v.clock.configuration.bootId = '12345678-1234-4234-9234-123456789abc'; v.docker.guest_boot_id = v.clock.configuration.bootId; }],
  ['missing preservation', v => delete v.old_scope_preservation],
  ['wrong preservation path', v => v.old_scope_preservation.receipt_file += '.other'],
  ['wrong FAIL hash', v => v.old_scope_preservation.artifacts[0].sha256 = 'b'.repeat(64)],
  ['missing retained readback', v => v.old_scope_preservation.artifacts.splice(2, 1)],
  ['key1 reuse', v => v.auth_fixture.authorized_local_key_reuse.key_generation = 1],
  ['earlier credential file', v => v.auth_fixture.authorized_local_key_reuse.private_path = '/private/tmp/old/credentials.json'],
  ['concealed reuse', v => v.auth_fixture.existing_scope_credentials_read = false],
  ['copied session', v => v.auth_fixture.old_auth_sessions_copied = true],
  ['changed old account', v => v.auth_fixture.existing_accounts_modified = true],
  ['new Admin role', v => v.auth_fixture.admin_role_fixtures = true],
  ['multiple identities', v => v.auth_fixture.new_synthetic_users = 2],
  ['Production credential read', v => v.auth_fixture.authorized_local_key_reuse.production_or_earlier_scope_read = true],
  ['old local credential path', v => v.credentials_file = '/private/tmp/ma-consolidation-v1-20260909183000/local-credentials.json'],
  ['payload JWT exception', v => v.gateway_verification['get-report-payload'] = false],
  ['export JWT exception', v => v.gateway_verification['content-os-morning-alpha-source'] = false],
  ['boundary JWT exception', v => v.gateway_verification['local-core-consolidation-boundary'] = false],
  ['missing JWT proof', v => delete v.gateway_verification],
  ['extra function', v => v.functions.push(v.functions.at(-1))],
  ['missing export', v => v.functions.pop()],
  ['provider egress', v => v.boundary.egress_default_deny = false],
  ['business clock override', v => v.functions[0].business_clock_override = true],
  ['external ContentOS delivery', v => v.external_content_os_delivery = true],
  ['unknown SQL function', v => v.sql_functions[0].name = 'unreviewed_function'],
]) test('fresh factual-export config rejects ' + name, () => {
  assert.doesNotThrow(() => validateReplayConfiguration(config(), environment));
  const value = config(); mutate(value); assert.throws(() => validateReplayConfiguration(value, environment));
});

test('new provider input is exact date-only transformation, including complete unchanged AI response', () => {
  assert.equal(hash(read(FACTUAL_INPUT_PREDECESSOR.path)), FACTUAL_INPUT_PREDECESSOR.sha256);
  assert.equal(validateDateOnlyProviderFixture(next(), previous()).identical_business_input, true);
  for (const key of ['quotes', 'futures', 'openai_completion']) assert.equal(JSON.stringify(next()[key]), JSON.stringify(previous()[key]));
  assert.equal(next().phases[0].source_times.US, '2026-09-28T20:00:00.000Z');
  assert.equal(next().phases[1].source_times.US, '2026-09-29T20:00:00.000Z');
});
for (const [name, mutate] of [
  ['quote value', v => v.quotes.SPY.close = 999],
  ['extra quote field', v => v.quotes.SPY.content_score = 100],
  ['news title', v => v.news[0].title += ' extra claim'],
  ['news source', v => v.news[0].source = 'Real provider'],
  ['news importance', v => v.news[0].importance_score = 100],
  ['extra news', v => v.news.push(v.news[0])],
  ['non-date URL', v => v.news[0].url += '/new-claim'],
  ['warmup source fact', v => v.phases[0].news[0].title += ' extra claim'],
  ['AI content', v => v.openai_completion.choices[0].message.content += ' '],
  ['AI usage', v => v.openai_completion.usage.total_tokens++],
  ['future source timestamp', v => v.phases[1].source_times.US = '2026-09-26T20:00:00.000Z'],
  ['nonuniform offset', v => v.phases[2].starts_at = '2026-09-30T01:00:01.000Z'],
  ['old source timestamp', v => v.phases[0].source_times.US = '2026-09-21T20:00:00.000Z'],
  ['frozen citation seed', v => v.source_refs = [{ evidence_id: 'NEWS001', url: 'https://fixture.example.invalid' }]],
  ['published seed', v => v.publish_status = 'READY'],
  ['historical success claim', v => v.provenance.historical_success_claim = true],
]) test('date-only fixture rejects ' + name, () => {
  assert.doesNotThrow(() => validateDateOnlyProviderFixture(next(), previous()));
  const value = next(); mutate(value); assert.throws(() => validateDateOnlyProviderFixture(value, previous()));
});

test('retained evidence requires all 27 exact tables, provider receipts and seven stopped containers', () => {
  assert.equal(validatePreservationConfiguration(preservation()).scope, 'ma-consolidation-v1-20260909183000');
  assert.equal(validatePreservationReceipt(receipt(), baseline()).status, 'RETAINED_EXACT_AND_STOPPED');
  assert.equal(RETAINED_TABLES.length, 27); assert.equal(RETAINED_CONTAINERS.length, 7);
});
for (const [name, mutate] of [
  ['old incident mutation', v => v.tables.content_os_sync_incidents.push({ status: 'RESOLVED' })],
  ['old raw mutation', v => v.tables.market_data.push({ value: 1 })],
  ['missing table', v => delete v.tables.runtime_quality_policies],
  ['extra table', v => v.tables.auth_users = []],
  ['changed receipt', v => v.boundary.receipts.push({ fake: true })],
  ['CLI still active', v => v.cli_serve_stopped = false],
  ['container still active', v => v.stopped_containers[0].running = true],
  ['unknown container', v => v.stopped_containers[0].name = 'old-production'],
  ['missing container', v => v.stopped_containers.pop()],
  ['Auth read', v => v.auth_rows_read_or_modified = true],
  ['deleted volume', v => v.volumes_deleted = true],
  ['wrong old date', v => v.retained_report_date = '2026-09-30'],
]) test('old failed-scope preservation rejects ' + name, () => {
  assert.doesNotThrow(() => validatePreservationReceipt(receipt(), baseline()));
  const value = receipt(); mutate(value); assert.throws(() => validatePreservationReceipt(value, baseline()));
});

function declaration(source, name) {
  const file = ts.createSourceFile('test.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = file.statements.filter(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  assert.equal(matches.length, 1); return matches[0].getText(file);
}
test('executed 9/23 runtime, prepare, driver and continuation bytes remain pinned', () => {
  for (const [path, pin] of [
    ['tests/helpers/coreConsolidationPublicExportRuntime.mjs', '8a2d454333fe346d75665a6ad1a1aa73940d93cd02e3ba37f3fd45b76bce6007'],
    ['tests/integration/coreConsolidationPublicExportPrepareLocal.mjs', 'c53102449bb7eb65b245da2efea85ea5178908afb8bd4c59207fce7c157c8061'],
    ['tests/integration/coreConsolidationPublicExportFullChain.e2e.mjs', '87c0c82eee2b723f6f3273659c8de5900d88ffc5816227dc28a66d6364455012'],
    ['tests/helpers/coreConsolidationPublicExportContinuation.mjs', '4f6a555d308e84ac3e9da19d1697a12dc6af95fdd3bcd65040737c41477abc21'],
  ]) assert.equal(hash(read(path)), pin, path);
});
test('raw lineage, real clock and all post-publication business assertions remain exact predecessor code', () => {
  const before = read('tests/helpers/coreConsolidationPublicExportRuntime.mjs');
  const after = read('tests/helpers/coreConsolidationFactualExportRuntime.mjs');
  for (const name of ['canonicalNumeric', 'guardedLocalFetch', 'assertClockAgreement', 'createReplayClock', 'assertCheckpointLineage'])
    assert.equal(declaration(after, name), declaration(before, name), name);
  const oldDriver = read('tests/integration/coreConsolidationPublicExportFullChain.e2e.mjs');
  const newDriver = read('tests/integration/coreConsolidationFactualExportFullChain.e2e.mjs');
  const tail = source => source.slice(source.indexOf('    const publication = await published();'), source.indexOf('  } catch (error)'));
  assert.ok(tail(oldDriver).length > 12000); assert.equal(tail(newDriver), tail(oldDriver));
  assert.ok(newDriver.includes('Fresh scenario required; no resume onto seeded/old business rows:'));
  assert.ok(newDriver.includes("assert.equal(result.verdict, 'PASS')"));
  assert.ok(!newDriver.includes(".from('content_os_sync_incidents').update"));
  assert.ok(!newDriver.includes(".rpc('resolve_content_os_incident_v1'"));
});

test('canonical calendar accepts only the actual 9/29 and 9/30 full sessions', () => {
  assert.equal(assertReplayMarketDays('2026-09-29', '2026-09-30'), true);
});
for (const day of ['2026-09-25', '2026-09-26', '2026-09-27', '2026-07-10']) {
  test('canonical calendar rejects closed main day ' + day, () => assert.throws(() => assertReplayMarketDays('2026-09-23', day)));
  test('canonical calendar rejects closed warmup day ' + day, () => assert.throws(() => assertReplayMarketDays(day, '2026-09-30')));
}
function oldMountedConfig() { return { scope: 'ma-consolidation-v1-20260909183000',
  functions: REPLAY_FUNCTIONS.map(slug => ({ slug, deployed_file: '/private/tmp/ma-consolidation-v1-20260909183000/supabase/functions/' + slug + '/index.js', bundle_sha256: digest })),
  boundary: { deployed_file: '/private/tmp/ma-consolidation-v1-20260909183000/supabase/functions/local-core-consolidation-boundary/index.js', bundle_sha256: digest } }; }
function cleanupReceipt() { const value = receipt(), old = oldMountedConfig();
  value.status = 'RETAINED_EXACT_SIX_STOPPED_ONE_CLI_REMOVED'; value.removed_ephemeral_edge = structuredClone(REMOVED_OLD_EDGE);
  value.old_db_readback_mode = 'TEMPORARY_ORIGINAL_DB_START_FIXED_BEGIN_READ_ONLY_THEN_STOP'; value.old_auth_or_api_started = false;
  value.stopped_containers = value.stopped_containers.filter(row => row.name !== REMOVED_OLD_EDGE.name);
  value.retained_volume_names = ['local_core_boundary_ma-consolidation-v1-20260909183000', 'supabase_db_ma-consolidation-v1-20260909183000', 'supabase_edge_runtime_ma-consolidation-v1-20260909183000'];
  value.guest_bundle_hashes = [...old.functions, old.boundary].map(row => ({ deployed_file: row.deployed_file, sha256: row.bundle_sha256 })); return value; }
test('exact observed CLI-only Edge cleanup preserves six actual containers, all volumes and fourteen mounted sources', () => {
  assert.equal(validatePreservationReceipt(cleanupReceipt(), baseline(), oldMountedConfig()).stopped_containers.length, 6);
});
for (const [name, mutate] of [
  ['missing DB', v => v.stopped_containers = v.stopped_containers.filter(row => !row.name.startsWith('supabase_db_'))],
  ['missing Auth', v => v.stopped_containers = v.stopped_containers.filter(row => !row.name.startsWith('supabase_auth_'))],
  ['extra removed container', v => v.removed_ephemeral_edge.name = 'supabase_db_ma-consolidation-v1-20260909183000'],
  ['invented removed identity', v => v.removed_ephemeral_edge.id = 'b'.repeat(64)],
  ['rewritten failure', v => v.removed_ephemeral_edge.retained_bootstrap_failure_sha256 = digest],
  ['missing old volume', v => v.retained_volume_names.pop()],
  ['altered old bundle', v => v.guest_bundle_hashes[0].sha256 = 'b'.repeat(64)],
  ['missing mounted source', v => v.guest_bundle_hashes.pop()],
  ['old report rewrite', v => v.tables.reports.push({ status: 'READY' })],
  ['old incident resolution', v => v.tables.content_os_sync_incidents.push({ status: 'RESOLVED' })],
  ['old Auth restart', v => v.old_auth_or_api_started = true],
  ['unverified old DB readback', v => v.old_db_readback_mode = 'ASSUMED_UNCHANGED'],
]) test('CLI-cleanup continuation rejects ' + name, () => {
  assert.doesNotThrow(() => validatePreservationReceipt(cleanupReceipt(), baseline(), oldMountedConfig()));
  const value = cleanupReceipt(); mutate(value); assert.throws(() => validatePreservationReceipt(value, baseline(), oldMountedConfig()));
});
