// Missing-required-NVDA negative control only; prior successful/failed scopes are preserved.
// Executed 9/23 predecessor remains byte-identical: coreConsolidationPublicExportRuntime.mjs
// SHA256 8a2d454333fe346d75665a6ad1a1aa73940d93cd02e3ba37f3fd45b76bce6007.
// Test orchestration only. No DDL, business-row seeding, provider egress or clock override.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, realpathSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readExactFixturePreimage } from './consolidationFixtureRepresentation.mjs';
import { createVmClockController, validateVmClockConfiguration } from './consolidationVmClock.mjs';
import { resolveMarketStatus } from '../../supabase/functions/_shared/market-status.ts';
import { isLatestCompletedUsCashQuote } from '../../supabase/functions/_shared/us-cash-session-calendar.ts';

export const REPLAY_FUNCTIONS = Object.freeze([
  'fetch-market-data-v10', 'fetch-global-market-news', 'generate-sector-rotation',
  'generate-daily-report-v7', 'get-report-payload', 'line-daily-push',
  'opening-market-radar', 'close-market-review', 'closing-verification-engine',
  'continuous-learning-engine', 'daily-delivery-orchestrator', 'ma-ops-health-check',
  'content-os-morning-alpha-source',
]);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
// Exact decimal round-half-away-from-zero, matching the existing canonical
// numeric(22,8)/numeric(12,6) columns. Raw/immutable evidence remains unrounded.
export function canonicalNumeric(value, scale) {
  assert.ok(Number.isFinite(value)); assert.ok([6, 8].includes(scale));
  const [coefficient, exponent = '0'] = String(Math.abs(value)).toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  let units = BigInt(whole + fraction), places = fraction.length - Number(exponent);
  if (places <= scale) units *= 10n ** BigInt(scale - places);
  else { const divisor = 10n ** BigInt(places - scale), remainder = units % divisor;
    units = units / divisor + (remainder * 2n >= divisor ? 1n : 0n); }
  return (value < 0 ? -1 : 1) * Number(units) / 10 ** scale;
}
const scopePattern = /^ma-consolidation-v1-\d{14}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const identifier = value => { assert.match(value, /^[A-Za-z0-9_-]+$/); return value; };
const localOrigin = value => {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.ok(url.port); assert.equal(url.pathname, '/');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  return url.origin;
};

const legacySqlFunctions = Object.freeze([
  'enforce_decision_snapshot_premium_90_gate_v1', 'publish_research_bundle_v1',
  'publish_member_content_revision_v1', 'publish_decision_snapshot_v3',
  'capture_morning_alpha_acceptance_v1', 'validate_core_market_publication_v1',
]);
export const REPLAY_SCOPE_CONTRACTS = Object.freeze({
  'ma-consolidation-v1-20260909210000': Object.freeze({ version: 4, origin: 'http://127.0.0.1:55511', subnet: '172.23.0.0/16', warmup_date: '2026-10-01', report_date: '2026-10-02' }),
  'ma-consolidation-v1-20260910220000': Object.freeze({ version: 5, origin: 'http://127.0.0.1:55521', subnet: '172.24.0.0/16', warmup_date: '2026-10-05', report_date: '2026-10-06' }),
});
export function replaySqlFunctionNames(config) {
  const contract = REPLAY_SCOPE_CONTRACTS[config.scope];
  assert.ok(contract, 'Only exact reviewed local replay scopes are allowed');
  assert.equal(config.schema_version, 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V' + contract.version);
  assert.equal(config.api_origin, contract.origin, 'Scope must use its own exact loopback API');
  return contract.version === 1 ? [...legacySqlFunctions]
    : [...legacySqlFunctions, 'reconcile_runtime_terminal_failures_v1'];
}

export function validateReplayConfiguration(config, environment = process.env) {
  const sqlFunctions = replaySqlFunctionNames(config);
  const scopeContract = REPLAY_SCOPE_CONTRACTS[config.scope];
  assert.equal(config.report_date, scopeContract.report_date); assert.equal(config.warmup_date, scopeContract.warmup_date);
  assert.equal(config.protected_control_receipt_file, '/private/tmp/ma-consolidation-v1-20260909210000/control-scope-preservation.json');
  assert.match(config.protected_control_receipt_sha256, digestPattern);
  if (config.scope === 'ma-consolidation-v1-20260910220000') {
    assert.equal(config.protected_control_receipt_sha256, '2700abe8ef15ac76a054f0eaedfcae2d0fa4e3cd7985f5c5d1baa9e38f35f9fd');
    validatePriorFailedScopeConfiguration(config.prior_failed_scope_preservation);
  } else assert.equal(config.prior_failed_scope_preservation, undefined, 'The original scope cannot adopt a later failed publication');
  assertReplayMarketDays(config.warmup_date, config.report_date);
  assert.equal(config.attempt, 1); assert.deepEqual(config.previous_attempt_results, []);
  assert.deepEqual(config.gateway_verification, Object.fromEntries([...REPLAY_FUNCTIONS, 'local-core-consolidation-boundary'].map(slug => [slug, true])),
    'Every new function keeps JWT verification enabled; no public-gateway exception');
  assert.equal(config.auth_fixture.provenance, 'NO_USER_CRON_ONLY_NEGATIVE_CONTROL');
  assert.equal(config.auth_fixture.new_synthetic_users, 0);
  assert.equal(config.auth_fixture.auth_users_expected, 0);
  assert.equal(config.auth_fixture.login_or_user_lookup, false);
  assert.equal(config.auth_fixture.existing_scope_credentials_read, true);
  assert.deepEqual(config.auth_fixture.authorized_local_key_reuse, AUTHORIZED_KEY_REUSE);
  assert.equal(config.auth_fixture.old_auth_sessions_copied, false);
  assert.equal(config.auth_fixture.existing_accounts_modified, false);
  validatePreservationConfiguration(config.old_scope_preservation);
  assert.equal(config.auth_fixture.admin_role_fixtures, false);
  assert.equal(config.external_content_os_delivery, false);
  assert.equal(config.clock.configuration.root, '/private/tmp/ma-clock-20260909-183000', 'A new dedicated guest, never an old shared Auth clock');
  assert.equal(config.clock.configuration.limaHome, '/private/tmp/ma-clock-20260909-183000/lima');
  assert.equal(config.clock.configuration.configPath, '/private/tmp/ma-clock-20260909-183000/clock.yaml');
  assert.equal(config.clock.configuration.bootId, 'd9f73673-b3e3-4daf-8080-13d8dde5b2c0', 'Only the approved dedicated guest is reused');
  assert.equal(environment.MA_CONSOLIDATION_REPLAY, 'LOCAL_ONLY');
  assert.match(config.scope, scopePattern); assert.equal(environment.MA_LOCAL_SCOPE, config.scope);
  assert.match(config.report_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(config.report_date + 'T00:00:00Z').toISOString().slice(0, 10), config.report_date);
  assert.equal(config.scenario_kind, 'SYNTHETIC_MISSING_REQUIRED_NVDA_NEGATIVE');
  assert.equal(config.historical_success_claim, false); assert.equal(config.production_operations_authorized, false);
  const attempt = config.attempt;
  assert.ok(Number.isInteger(attempt) && attempt >= 1 && attempt <= 10);
  assert.equal(config.evidence_directory, '/private/tmp/' + config.scope + '-evidence'
    + (attempt === 1 ? '' : '-attempt-' + String(attempt).padStart(3, '0')));
  assert.equal((config.previous_attempt_results ?? []).length, attempt - 1);
  for (const [index, row] of (config.previous_attempt_results ?? []).entries()) {
    assert.equal(row.path, '/private/tmp/' + config.scope + '-evidence'
      + (index === 0 ? '' : '-attempt-' + String(index + 1).padStart(3, '0')) + '/result.json');
    assert.match(row.sha256, digestPattern);
  }
  assert.equal(config.credentials_file, '/private/tmp/' + config.scope + '/local-credentials.json');
  assert.equal(config.network, config.scope + '-isolated');
  localOrigin(config.api_origin);
  assert.equal(config.clock.kind, 'DEDICATED_SHARED_GUEST');
  validateVmClockConfiguration(config.clock.configuration);
  assert.equal(config.docker.kind, 'IN_SAME_GUEST');
  assert.equal(config.docker.guest_boot_id, config.clock.configuration.bootId);
  assert.deepEqual(Object.keys(config.containers).sort(), ['auth', 'db', 'edge', 'gateway', 'rest']);
  for (const row of Object.values(config.containers)) {
    identifier(row.name); assert.match(row.image_id, /^sha256:[a-f0-9]{64}$/);
  }
  assert.ok(Array.isArray(config.additional_containers));
  for (const row of config.additional_containers) {
    identifier(row.name); assert.match(row.image_id, /^sha256:[a-f0-9]{64}$/);
  }
  const containerNames = [...Object.values(config.containers), ...config.additional_containers].map(row => row.name);
  assert.equal(new Set(containerNames).size, containerNames.length, 'Duplicate container registration');
  assert.equal(config.boundary.slug, 'local-core-consolidation-boundary');
  assert.match(config.boundary.fixture_sha256, digestPattern);
  assert.match(config.boundary.source_sha256, digestPattern);
  assert.match(config.boundary.bundle_sha256, digestPattern);
  assert.equal(config.boundary.deployed_file, '/private/tmp/' + config.scope + '/supabase/functions/local-core-consolidation-boundary/index.js');
  assert.deepEqual(config.boundary.source_files.map(row => row.path).sort(), [
    'tests/helpers/coreConsolidationBoundaryPrelude.mjs', 'tests/helpers/coreConsolidationBoundaryServer.mjs',
    'tests/helpers/coreConsolidationVendorShapes.mjs', 'tests/helpers/coreConsolidationBoundaryProxy.mjs',
  ].sort());
  for (const row of config.boundary.source_files) assert.match(row.sha256, digestPattern);
  assert.ok(config.additional_containers.some(row => row.name === config.boundary.receiver.name
    && row.image_id === config.boundary.receiver.image_id), 'Dedicated receiver must be a pinned isolated network member');
  assert.equal(config.boundary.receiver.deployed_file, '/srv/boundary/index.ts');
  assert.match(config.boundary.receiver.bundle_sha256, digestPattern);
  assert.equal(config.boundary.egress_default_deny, true);
  assert.deepEqual(config.functions.map(row => row.slug).sort(), [...REPLAY_FUNCTIONS].sort());
  for (const row of config.functions) {
    assert.equal(row.entrypoint, 'supabase/functions/' + row.slug + '/index.ts');
    assert.match(row.source_sha256, digestPattern); assert.match(row.bundle_sha256, digestPattern);
    assert.equal(row.vendor_boundary_only, true); assert.equal(row.business_clock_override, false);
    assert.equal(row.deployed_file, '/private/tmp/' + config.scope + '/supabase/functions/' + row.slug + '/index.js');
  }
  assert.ok(Array.isArray(config.source_files) && config.source_files.length > config.functions.length,
    'Pin the transitive source/import dependency inventory, not entrypoints alone');
  for (const row of config.source_files) {
    assert.ok(/^(supabase\/functions\/|src\/lib\/|shared\/)/.test(row.path)
      || row.path === 'src/features/decision-v1/contract.ts', 'Unapproved source/import path');
    assert.ok(!row.path.includes('..') && !row.path.includes(' 2.')); assert.match(row.sha256, digestPattern);
  }
  assert.equal(new Set(config.source_files.map(row => row.path)).size, config.source_files.length);
  assert.equal(config.sql_candidate.path, 'supabase/migrations/20260909015650_core_market_publication_contract.sql');
  assert.match(config.sql_candidate.sha256, digestPattern);
  assert.equal(config.sql_functions.length, sqlFunctions.length);
  assert.deepEqual(config.sql_functions.map(row => row.name).sort(), [...sqlFunctions].sort());
  for (const row of config.sql_functions) assert.match(row.definition_md5, /^[a-f0-9]{32}$/);
  assert.ok(Array.isArray(config.bootstrap_receipts) && config.bootstrap_receipts.length > 0);
  for (const receipt of config.bootstrap_receipts) {
    assert.equal(receipt.scope, config.scope); assert.match(receipt.sha256, digestPattern);
  }
  return config;
}

export function checkPinnedReplayInputs(config, repo) {
  for (const row of config.previous_attempt_results ?? []) {
    const bytes = readFileSync(row.path); assert.equal(sha256(bytes), row.sha256, 'Prior failed attempt evidence changed');
    const result = JSON.parse(bytes);
    assert.equal(result.scope, config.scope); assert.equal(result.status, 'FAIL');
    assert.equal(result.full_persisted_chain_executed, false);
    assert.ok(result.records.every(record => !String(record.stage).startsWith('handler:')),
      'Same-scope retry is only allowed before any business handler call; otherwise use a fresh scope');
  }
  for (const row of config.source_files) assert.equal(sha256(readFileSync(resolve(repo, row.path))), row.sha256, 'Source drift: ' + row.path);
  for (const row of config.functions) {
    assert.equal(sha256(readFileSync(resolve(repo, row.entrypoint))), row.source_sha256, 'Entrypoint drift: ' + row.slug);
    assert.equal(sha256(readFileSync(row.bundle_file)), row.bundle_sha256, 'Deployed bundle input drift: ' + row.slug);
  }
  const sql = readFileSync(resolve(repo, config.sql_candidate.path));
  assert.ok(sql.length > 0, 'No successor SQL exists to test');
  assert.equal(sha256(sql), config.sql_candidate.sha256, 'SQL candidate differs from bootstrap');
  for (const row of config.bootstrap_receipts) assert.equal(sha256(readFileSync(row.path)), row.sha256, 'Bootstrap receipt drift');
  const fixtureBytes = readFileSync(config.boundary.fixture_file);
  assert.equal(sha256(fixtureBytes), config.boundary.fixture_sha256, 'Provider fixture drift');
  const fixture = JSON.parse(fixtureBytes);
  const predecessorBytes = readExactFixturePreimage(MISSING_QUOTE_CONTROL.path, readFileSync(resolve(repo, MISSING_QUOTE_CONTROL.path)));
  validateMissingQuoteFixture(fixture, JSON.parse(predecessorBytes));
  assert.equal(sha256(predecessorBytes), MISSING_QUOTE_CONTROL.sha256);
  readProtectedControl(config);
  if (config.prior_failed_scope_preservation) readPriorFailedScope(config);
  verifyPreservedArtifacts(config.old_scope_preservation);
  assert.equal(fixture.report_date, config.report_date); assert.equal(fixture.warmup_date, config.warmup_date);
  assert.equal(fixture.provenance.kind, 'SYNTHETIC_PROVIDER_CONTROL'); assert.equal(fixture.provenance.historical_capture, false);
  assert.equal(sha256(readFileSync(config.boundary.source_file)), config.boundary.source_sha256, 'Local boundary source drift');
  assert.equal(sha256(readFileSync(config.boundary.bundle_file)), config.boundary.bundle_sha256, 'Local boundary bundle input drift');
  for (const row of config.boundary.source_files) assert.equal(sha256(readFileSync(resolve(repo, row.path))), row.sha256, 'Boundary dependency drift: ' + row.path);
  assert.equal(sha256(readFileSync(config.boundary.receiver.bundle_file)), config.boundary.receiver.bundle_sha256, 'Receiver bundle drift');
}

export function readNewLocalCredentials(config) {
  assert.equal(realpathSync(config.credentials_file), resolve(config.credentials_file), 'Credential file cannot be a symlink');
  const mode = statSync(config.credentials_file).mode & 0o777;
  assert.equal(mode & 0o077, 0, 'Local credentials must be owner-only');
  const data = JSON.parse(readFileSync(config.credentials_file, 'utf8'));
  assert.equal(data.scope, config.scope); assert.equal(data.provenance, 'NO_USER_CRON_ONLY_NEGATIVE_CONTROL');
  assert.equal(data.production_secrets_copied, false); assert.equal(data.api_origin, config.api_origin);
  assert.deepEqual(data.authorized_local_key_reuse, AUTHORIZED_KEY_REUSE);
  assert.equal(data.old_auth_sessions_copied, false);
  for (const key of ['anon_key', 'service_role_key', 'cron_secret']) assert.ok(typeof data[key] === 'string' && data[key].length > 10);
  assert.equal(Object.hasOwn(data, 'auth'), false, 'This negative lane must not contain a user identity or copied session');
  return data;
}

export function guardedLocalFetch(apiOrigin, implementation = fetch) {
  const origin = localOrigin(apiOrigin);
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, origin, 'External request blocked by replay client');
    assert.equal(url.username + url.password, '');
    const response = await implementation(input, { ...init, redirect: 'error' });
    if (response.url) assert.equal(new URL(response.url).origin, origin, 'Unexpected response origin');
    return response;
  };
}

export function createGuestReadback(config) {
  const clock = config.clock.configuration;
  const command = args => execFileSync('limactl', ['shell', '--workdir', '/', clock.instance, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LIMA_HOME: clock.limaHome, LANG: 'C', LC_ALL: 'C' },
    encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const docker = args => command(['sudo', '-n', 'docker', ...args]);
  function inspect() {
    assert.equal(command(['cat', '/proc/sys/kernel/random/boot_id']), clock.bootId);
    const protectedControl = readProtectedControl(config);
    for (const row of protectedControl.stopped_containers) {
      const actual = JSON.parse(docker(['inspect', row.name]))[0];
      assert.equal(actual.Id, row.id); assert.equal(actual.State.Running, false);
      assert.equal(sha256(JSON.stringify(canonicalPreservedMounts(actual.Mounts))), row.mounts_sha256);
    }
    assert.equal(docker(['ps', '-a', '--filter', 'name=^/' + protectedControl.removed_ephemeral_edge.name + '$', '--format', '{{.ID}}']), '');
    for (const name of protectedControl.retained_volume_names) assert.equal(docker(['volume', 'inspect', '--format', '{{.Name}}', name]), name);
    for (const row of protectedControl.guest_bundle_hashes) assert.equal(parseRetainedGuestHash(command(['sudo', '-n', 'sha256sum', row.deployed_file]), row.deployed_file), row.sha256);
    const preserved = verifyPreservedArtifacts(config.old_scope_preservation);
    if (config.prior_failed_scope_preservation) {
      const failed = readPriorFailedScope(config);
      for (const row of failed.stopped_containers) {
        const actual = JSON.parse(docker(['inspect', row.name]))[0];
        assert.equal(actual.Id, row.id); assert.equal(actual.Image, row.image_id); assert.equal(actual.State.Running, false);
        assert.equal(sha256(JSON.stringify(canonicalPreservedMounts(actual.Mounts))), row.mounts_sha256);
      }
      assert.equal(docker(['ps', '-a', '--filter', 'name=^/' + failed.removed_ephemeral_edge.name + '$', '--format', '{{.ID}}']), '');
      for (const name of failed.retained_volume_names) assert.equal(docker(['volume', 'inspect', '--format', '{{.Name}}', name]), name);
      for (const row of failed.guest_bundle_hashes) assert.equal(parseRetainedGuestHash(command(['sudo', '-n', 'sha256sum', row.deployed_file]), row.deployed_file), row.sha256);
    }
    for (const item of preserved.stopped_containers) {
      const old = JSON.parse(docker(['inspect', item.name]))[0];
      assert.equal(old.Id, item.id, 'Retained old container identity changed');
      assert.equal(old.Image, item.image_id, 'Retained old image changed');
      assert.equal(old.State.Running, false, 'Old scope must remain stopped before guest clock advances');
      assert.equal(sha256(JSON.stringify(old.Mounts)), item.mounts_sha256, 'Retained old mounts changed');
    }
    if (preserved.removed_ephemeral_edge) {
      assert.equal(docker(['ps', '-a', '--filter', 'name=^/' + REMOVED_OLD_EDGE.name + '$', '--format', '{{.ID}}']), '',
        'The CLI-removed old Edge must not be recreated and called unchanged');
      for (const name of preserved.retained_volume_names) {
        assert.equal(docker(['volume', 'inspect', '--format', '{{.Name}}', name]), name, 'Old retained volume missing');
      }
      for (const row of preserved.guest_bundle_hashes) {
        assert.equal(command(['sudo', '-n', 'sha256sum', row.deployed_file]).split(/\s+/)[0], row.sha256,
          'CLI-removed Edge mounted source changed');
      }
    }
    assert.equal(docker(['network', 'inspect', '--format', '{{.Internal}}', config.network]), 'true');
    const expectedContainers = [...Object.values(config.containers), ...config.additional_containers];
    const network = JSON.parse(docker(['network', 'inspect', config.network]))[0];
    assert.equal(network.IPAM.Config[0].Subnet, REPLAY_SCOPE_CONTRACTS[config.scope].subnet);
    const attached = network.Containers;
    assert.deepEqual(Object.values(attached).map(row => row.Name).sort(), expectedContainers.map(row => row.name).sort(), 'Unexpected network member');
    for (const row of expectedContainers) {
      const actual = JSON.parse(docker(['inspect', row.name]))[0];
      assert.equal(actual.Image, row.image_id, 'Actual image drift: ' + row.name);
      assert.deepEqual(Object.keys(actual.NetworkSettings.Networks), [config.network]);
    }
    for (const row of [...config.functions, { ...config.boundary, slug: config.boundary.slug }]) {
      const actual = docker(['exec', config.containers.edge.name, 'sha256sum', row.deployed_file]).split(/\s+/)[0];
      assert.equal(actual, row.bundle_sha256, 'Actual deployed local bundle drift: ' + row.slug);
    }
    const receiver = config.boundary.receiver;
    assert.equal(docker(['exec', receiver.name, 'sha256sum', receiver.deployed_file]).split(/\s+/)[0], receiver.bundle_sha256);
    const functions = JSON.parse(docker(['exec', config.containers.db.name, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
      '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
      "begin read only; select json_agg(json_build_object('name',p.proname,'definition_md5',md5(pg_get_functiondef(p.oid))) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (" + replaySqlFunctionNames(config).map(name => "'" + name + "'").join(',') + "); rollback;"]));
    assert.deepEqual(functions, [...config.sql_functions].sort((a, b) => a.name.localeCompare(b.name)), 'Actual local SQL definitions differ from reviewed bootstrap');
    return true;
  }
  function clockWitness() {
    // Fixed read-only diagnostic; this helper has no generic SQL execution API.
    const bytes = docker(['exec', config.containers.db.name, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
      '-qAt', '-v', 'ON_ERROR_STOP=1', '-c',
      "begin read only; select json_build_object('scope',(select scope from ma_isolated_guard.identity),'observed_at',clock_timestamp(),'auth_user_count',(select count(*) from auth.users)); rollback;"]);
    const row = JSON.parse(bytes); assert.equal(row.scope, config.scope); return row;
  }
  return Object.freeze({ inspect, clockWitness });
}

export function assertClockAgreement({ scope, guest, postgres, edge, auth, started, ended }) {
  assert.equal(postgres.scope, scope); assert.equal(edge.scope, scope);
  assert.equal(edge.clock_override, false); assert.equal(edge.boot_id, guest.boot_id);
  assert.equal(edge.business_edge_clock_observed, true);
  assert.equal(auth, undefined, 'No user login/session witness is authorized in this negative control');
  assert.equal(postgres.auth_user_count, 0, 'The negative DB must remain free of test accounts');
  const times = [postgres.observed_at, edge.observed_at, edge.receiver_observed_at].map(Date.parse);
  assert.ok(times.every(Number.isFinite));
  assert.ok(times.every(at => at >= Date.parse(started) - 1000 && at <= Date.parse(ended) + 1000), 'PG and actual Edge/receiver must share the same guest clock');
  assert.ok(Math.max(...times) - Math.min(...times) <= 15000, 'Runtime clock skew exceeds bounded witness');
}

export function createReplayClock(config) {
  return createVmClockController(config.clock.configuration);
}

export function assertCheckpointLineage({ rows, raw, canonical, compatibility, lifecycle, date, checkpoint }) {
  const entry = object(object(lifecycle.checkpoint_status)[checkpoint === 'PREMARKET' ? 'premarket' : checkpoint]);
  assert.equal(entry.status, 'SUCCEEDED'); assert.equal(object(entry.metadata).core_batch_complete, true);
  const correlation = entry.correlation_id;
  assert.ok(typeof correlation === 'string' && correlation.length > 0);
  const tuples = rows.map(row => [row.checkpoint, row.symbol, row.correlation_id].join('|'));
  assert.equal(new Set(tuples).size, tuples.length, 'Duplicate immutable tuple');
  const batchSymbols = rows.filter(row => row.correlation_id === correlation).map(row => row.symbol);
  for (const symbol of ['TAIEX', '2330', 'TXF', ...(object(entry.metadata).required_core_symbols ?? [])]) {
    assert.ok(batchSymbols.includes(symbol), 'Missing required producer symbol: ' + symbol);
  }
  for (const symbol of batchSymbols) {
    const matched = rows.filter(row => row.symbol === symbol && row.correlation_id === correlation);
    assert.equal(matched.length, 1, 'Missing exact lifecycle-correlation source: ' + symbol);
    const source = matched[0];
    assert.equal(source.trading_date, date); assert.equal(source.checkpoint, checkpoint);
    assert.ok(Number.isFinite(source.value) && source.value > 0 && Number.isFinite(source.change_percent));
    assert.ok(source.snapshot_version > 0 && source.source && Number.isFinite(Date.parse(source.source_timestamp)));
    assert.equal(object(source.raw).contract, 'FETCH_CHECKPOINT_EVIDENCE_V1');
    const rawMatches = raw.filter(row => row.symbol === symbol);
    assert.equal(rawMatches.length, 1, 'Actual raw persistence missing or duplicated: ' + symbol);
    assert.equal(rawMatches[0].value, source.value); assert.equal(rawMatches[0].change_percent, source.change_percent);
    assert.equal(Date.parse(rawMatches[0].captured_at), Date.parse(source.source_timestamp));
    const quote = canonical.find(row => row.symbol === symbol && object(row.raw_payload).immutable_snapshot_version === source.snapshot_version);
    const alias = compatibility.find(row => row.symbol === symbol && object(row.raw).immutable_snapshot_version === source.snapshot_version);
    assert.ok(quote, 'Actual canonical write/readback missing: ' + symbol);
    assert.ok(alias, 'Actual compatibility write/readback missing: ' + symbol);
    assert.equal(quote.provider, source.source); assert.equal(alias.source, source.source);
    assert.equal(quote.correlation_id, correlation);
    const phase = checkpoint === 'PREMARKET' ? 'premarket' : ['1410', '1430'].includes(checkpoint) ? 'close' : 'intraday';
    for (const row of [quote, alias]) {
      assert.equal(row.trading_date, date); assert.equal(row.phase, phase);
      const provenance = object(row.raw_payload ?? row.raw);
      assert.equal(provenance.correlation_id, correlation); assert.equal(provenance.immutable_checkpoint, checkpoint);
      assert.equal(provenance.checkpoint, checkpoint === 'PREMARKET' ? 'premarket' : checkpoint);
      assert.equal(provenance.provider, source.source);
      assert.equal(row.value, row === quote ? canonicalNumeric(source.value, 8) : source.value);
      assert.equal(row.change_percent, row === quote ? canonicalNumeric(source.change_percent, 6) : source.change_percent);
      assert.equal(Date.parse(row.captured_at), Date.parse(source.source_timestamp));
    }
  }
  return { checkpoint, correlation_id: correlation, verified_symbols: batchSymbols,
    immutable_versions: rows.filter(row => row.correlation_id === correlation).map(row => row.snapshot_version) };
}

export function createReplayJournal(config) {
  // Exclusive directory prevents merging an earlier run or overwriting failure evidence.
  mkdirSync(config.evidence_directory, { mode: 0o700 });
  const runId = randomUUID(), records = [];
  const secretKeys = /authorization|cookie|password|(?:^|_)token$|(?:^|_)key$|cron_secret|email/i;
  const sanitize = value => typeof value === 'string' ? value.replace(/eyJ[A-Za-z0-9_.-]+/g, '[REDACTED_JWT]')
    : Array.isArray(value) ? value.map(sanitize) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, secretKeys.test(key) ? '[REDACTED]' : sanitize(entry)])) : value;
  const append = (stage, data) => {
    const record = sanitize({ run_id: runId, scope: config.scope, stage, recorded_at_host: new Date().toISOString(), ...data });
    records.push(record); appendFileSync(config.evidence_directory + '/stages.jsonl', JSON.stringify(record) + '\n', { mode: 0o600 });
    return record;
  };
  const finish = status => {
    assert.ok(['FAIL', 'EXPECTED_FAILURE_VERIFIED'].includes(status), 'A negative control cannot claim business PASS');
    const handlers = [...new Set(records.filter(row => row.stage.startsWith('handler:')).map(row => row.stage.slice(8)))];
    assert.ok(handlers.every(slug => REPLAY_FUNCTIONS.includes(slug)), 'Only actual reviewed handlers may be counted');
    const verified = records.findLast(row => row.stage === 'negative-control-verified');
    if (status === 'EXPECTED_FAILURE_VERIFIED') {
      assert.equal(verified?.acceptance_verdict, 'FAIL');
      assert.equal(verified?.publication_blocked, true);
      assert.equal(verified?.line_delivery_blocked, true);
      assert.equal(verified?.terminal_complete, false);
      assert.equal(verified?.missing_required_symbol, 'NVDA');
    }
    const result = { schema_version: 'CORE_CONSOLIDATION_MISSING_QUOTE_RESULT_V1', run_id: runId, scope: config.scope,
      status, scenario_kind: config.scenario_kind, historical_success_claim: false, automatic_stable_day: false,
      production_requests: 0, provider_delivery: 'SYNTHETIC_LOCAL_BOUNDARY', natural_scheduler_executed: false,
      test_success: status === 'EXPECTED_FAILURE_VERIFIED', expected_business_gate: 'FAIL',
      actual_acceptance_verdict: verified?.acceptance_verdict ?? null,
      terminal_lifecycle_path: 'ONLY_RECORDED_BLOCKED_TERMINAL_CHECK_NO_RPC_SUCCESS_CLAIM',
      full_persisted_chain_executed: false, records,
      handler_count: handlers.length, executed_handlers: handlers, configured_handler_count: REPLAY_FUNCTIONS.length,
      executed_stages: records.map(row => row.stage),
      content_os_scope: 'ONLY_ACTUALLY_RECORDED_LOCAL_HANDLER_CALLS_NOT_EXTERNAL_CONSUMER_DELIVERY',
      external_content_os_delivery: false };
    Object.assign(result, { browser_executed: false, historical_120_day_effects_verified: false,
      complete_user_release_gate: 'NOT_DEMONSTRATED_BY_THIS_RUNNER_ALONE' });
    writeFileSync(config.evidence_directory + '/result.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return result;
  };
  return Object.freeze({ runId, append, finish });
}

export const AUTHORIZED_KEY_REUSE = Object.freeze({
  source_scope: 'ma-consolidation-v1-20260909183000',
  private_path: '/private/tmp/ma-consolidation-v1-20260909183000/new-generated-v2-private.json',
  key_generation: 2,
  containment_sha256: 'f38be887d412e507b0077a546d277331c7f2e36f1e666d9a37c3d18401918cd7',
  production_or_earlier_scope_read: false,
});
export const FACTUAL_INPUT_PREDECESSOR = Object.freeze({
  path: 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260923.json',
  sha256: 'f1eda85b78645eb0c7264890cc73334e4624d5d4c0535300546f1316ad49a81a',
});
export const RETAINED_ARTIFACTS = Object.freeze([
  { path: '/private/tmp/ma-consolidation-v1-20260909183000-evidence/result.json', sha256: '80b61c535cb1a293c810c386b75af60c71faecebee2a2794fadb0aedb554635a' },
  { path: '/private/tmp/ma-consolidation-v1-20260909183000-evidence-continuation-001/result.json', sha256: 'ed3f57d6b4929d2a30cac6380e4bed77d0fc81b639c056450d8664de2e356565' },
  { path: '/private/tmp/ma-consolidation-v1-20260909183000/post-publication-export409-readback.json', sha256: 'd92179edda5db4eff11aa6a5c4d74f2279763334e6172c2d285067b3f6840077' },
  { path: '/private/tmp/ma-consolidation-v1-20260909183000/executed-source-manifest.json', sha256: '2c833f47795bac0eb8b777fb7fcd8d08a5caab1759ceaa53428141a7e29cb389' },
  { path: '/private/tmp/ma-consolidation-v1-20260909183000/executed-source-preimages.tar', sha256: '94e39c4ae77a68499e1b4e240a82796094d8fd6c8a9de6a8f6d120a622de383d' },
  { path: '/private/tmp/ma-consolidation-v1-20260909183000/test-key-containment.json', sha256: 'f38be887d412e507b0077a546d277331c7f2e36f1e666d9a37c3d18401918cd7' },
]);
export const RETAINED_TABLES = Object.freeze([
  'market_data', 'market_checkpoint_snapshots', 'market_quotes', 'market_data_snapshots',
  'data_provider_health', 'trading_day_state', 'reports', 'decision_snapshots',
  'line_delivery_outbox', 'line_subscribers', 'learning_runs', 'learning_predictions',
  'prediction_outcomes', 'news_events', 'market_news', 'sector_rotation_scores', 'pipeline_runs',
  'member_content_revisions', 'production_acceptance_results', 'runtime_http_dispatches',
  'runtime_dead_letters', 'ma_ops_runs', 'research_sessions', 'runtime_quality_policies',
  'content_os_sync_incidents', 'editorial_reviews', 'semantic_coherence_reviews',
]);
export const RETAINED_CONTAINERS = Object.freeze([
  ...['auth','db','rest','kong','inbucket','edge_runtime'].map(name => 'supabase_' + name + '_ma-consolidation-v1-20260909183000'),
  'local_core_boundary_ma-consolidation-v1-20260909183000',
]);
export const REMOVED_OLD_EDGE = Object.freeze({
  name: 'supabase_edge_runtime_ma-consolidation-v1-20260909183000',
  id: '41bf80f338c23d44d524743807bd5040ce19c03726ad93a5be985dc472cfc2cb',
  image_id: 'sha256:ac1fdaad6d62b892f3309578006ce208f4150bf2c484113cf2c32655ec7e6893',
  reason: 'CLI_FUNCTIONS_SERVE_SIGTERM_REMOVED_STATELESS_CONTAINER',
  attestation_file: '/private/tmp/ma-consolidation-v1-20260909183000/network-runtime-attestation-successor-001.json',
  attestation_sha256: '227715822f9d8e0de7d0a673521e1db8a3d3e39ea5803d679e7df737addaf9ca',
  source_config_file: '/private/tmp/ma-consolidation-v1-20260909183000/replay-config-export-esm.json',
  source_config_sha256: 'af814d9e25790e0da8abf6008fdf51d219d9e3cf0c271b8e7ac5793cdd3566db',
  retained_bootstrap_failure_file: '/private/tmp/ma-consolidation-v1-20260909200000/bootstrap-result.json',
  retained_bootstrap_failure_sha256: '62e5661f779efda3681b855439141533de203328dcd75868e7e5141eec03b208',
});
export function validateDateOnlyProviderFixture(next, previous) {
  const expected = structuredClone(previous), shift = value => new Date(Date.parse(value) + 604800000).toISOString();
  expected.fixture_id = 'full-chain-synthetic-20260930-factual-export';
  expected.report_date = '2026-09-30'; expected.warmup_date = '2026-09-29';
  expected.provenance = { ...previous.provenance,
    purpose: 'Fresh Wednesday 9/30 source-fix replay with identical 9/23 facts, quotes, rankings and complete AI response; only dates advance by seven days.',
    synthetic_template: { ...FACTUAL_INPUT_PREDECESSOR, transformation: 'EXACT_PLUS_SEVEN_DAYS_ONLY',
      business_input_changed: false, historical_success_claim: false } };
  for (const phase of expected.phases) {
    for (const key of ['starts_at', 'ends_at', 'news_source_at']) phase[key] = shift(phase[key]);
    for (const key of Object.keys(phase.source_times)) phase.source_times[key] = shift(phase.source_times[key]);
    for (const row of phase.news ?? []) row.url = row.url.replaceAll('20260923', '20260930').replaceAll('20260922', '20260929');
  }
  for (const row of expected.news) row.url = row.url.replaceAll('20260923', '20260930');
  assert.deepEqual(next, expected, 'Only exact whitelisted +7-day source timestamps/URL dates may differ; no fact/AI/score changes');
  assert.equal(JSON.stringify(next.openai_completion), JSON.stringify(previous.openai_completion));
  assertReplayMarketDays(next.warmup_date, next.report_date);
  for (const phase of next.phases) {
    assert.equal(isLatestCompletedUsCashQuote('SPY', Date.parse(phase.source_times.US), Date.parse(phase.starts_at)), true,
      'Synthetic US quote must retain the actual completed America/New_York cash-session identity');
    const taipeiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(phase.source_times.TW));
    assert.equal(resolveMarketStatus(taipeiDate).is_trading_day, true, 'Taiwan source must belong to a real configured trading day');
  }
  return { identical_business_input: true, timestamp_shift_ms: 604800000, synthetic: true };
}
export function assertReplayMarketDays(warmupDate, reportDate) {
  for (const date of [warmupDate, reportDate]) {
    const market = resolveMarketStatus(date);
    assert.equal(market.is_trading_day, true, 'Canonical calendar rejects replay date: ' + date + '/' + market.market_status);
    assert.equal(market.session_type, 'FULL_DAY', 'This exact six-checkpoint lane requires an actual full trading session');
  }
  assert.ok(Date.parse(warmupDate) < Date.parse(reportDate), 'Warmup must precede the main business date');
  return true;
}
export function validatePreservationConfiguration(value) {
  assert.equal(value?.scope, 'ma-consolidation-v1-20260909183000');
  assert.equal(value?.report_date, '2026-09-23');
  assert.equal(value?.receipt_file, '/private/tmp/ma-consolidation-v1-20260909200000/old-scope-preservation.json');
  assert.match(value?.receipt_sha256 ?? '', digestPattern);
  assert.deepEqual(value?.artifacts, RETAINED_ARTIFACTS);
  return value;
}
export function parseRetainedVendorReceipts(text) {
  assert.equal(typeof text, 'string');
  return text.split('\n').filter(Boolean).map(line => {
    const row = JSON.parse(line);
    assert.ok(row && typeof row === 'object' && !Array.isArray(row), 'Actual vendor JSONL row must be an object');
    return row;
  });
}

export function parseRetainedGuestHash(text, expectedPath) {
  assert.equal(typeof text, 'string');
  const fields = text.trim().split(/\s+/);
  assert.equal(fields.length, 2, 'Actual guest checksum must identify exactly one source');
  assert.match(fields[0], /^[a-f0-9]{64}$/);
  assert.equal(fields[1], expectedPath, 'Actual guest checksum must identify the exact retained source');
  return fields[0];
}

export function retainedCliSupervisorRunning(text, oldRoot) {
  assert.equal(oldRoot, '/private/tmp/ma-consolidation-v1-20260909183000');
  return text.split('\n').some(line => line.includes('supabase functions serve') && line.includes('--workdir ' + oldRoot));
}

export function validatePreservationReceipt(receipt, baseline, oldSourceConfig) {
  assert.equal(receipt.scope, 'ma-consolidation-v1-20260909200000');
  assert.equal(receipt.retained_scope, 'ma-consolidation-v1-20260909183000');
  assert.equal(receipt.retained_report_date, '2026-09-23');
  if (receipt.removed_ephemeral_edge) {
    assert.equal(receipt.status, 'RETAINED_EXACT_SIX_STOPPED_ONE_CLI_REMOVED');
    assert.deepEqual(receipt.removed_ephemeral_edge, REMOVED_OLD_EDGE, 'Only the exact observed stateless Edge cleanup is permitted');
    assert.equal(receipt.old_db_readback_mode, 'TEMPORARY_ORIGINAL_DB_START_FIXED_BEGIN_READ_ONLY_THEN_STOP');
    assert.equal(receipt.old_auth_or_api_started, false);
    assert.deepEqual(receipt.retained_volume_names, [
      'local_core_boundary_ma-consolidation-v1-20260909183000',
      'supabase_db_ma-consolidation-v1-20260909183000',
      'supabase_edge_runtime_ma-consolidation-v1-20260909183000',
    ]);
    assert.equal(oldSourceConfig?.scope, 'ma-consolidation-v1-20260909183000');
    assert.deepEqual(oldSourceConfig.functions.map(row => row.slug).sort(), [...REPLAY_FUNCTIONS].sort());
    const expected = [...oldSourceConfig.functions, oldSourceConfig.boundary]
      .map(row => ({ deployed_file: row.deployed_file, sha256: row.bundle_sha256 }));
    assert.deepEqual(receipt.guest_bundle_hashes, expected, 'All fourteen original mounted bundle bytes must survive CLI removal');
    assert.deepEqual(receipt.stopped_containers.map(row => row.name).sort(),
      RETAINED_CONTAINERS.filter(name => name !== REMOVED_OLD_EDGE.name).sort());
  } else {
    assert.equal(receipt.status, 'RETAINED_EXACT_AND_STOPPED');
    assert.deepEqual(receipt.stopped_containers.map(row => row.name).sort(), [...RETAINED_CONTAINERS].sort());
  }
  assert.equal(receipt.cli_serve_stopped, true);
  assert.equal(receipt.business_rows_modified, false);
  assert.equal(receipt.auth_rows_read_or_modified, false);
  assert.equal(receipt.volumes_deleted, false);
  assert.deepEqual(Object.keys(receipt.tables).sort(), [...RETAINED_TABLES].sort());
  assert.deepEqual(Object.keys(baseline.tables).sort(), [...RETAINED_TABLES].sort());
  assert.deepEqual(receipt.tables, baseline.tables, 'All 27 old business tables must remain byte-equivalent');
  assert.deepEqual(receipt.boundary, baseline.boundary, 'All old provider receipts must remain exact');
  for (const row of receipt.stopped_containers) {
    assert.match(row.id, digestPattern); assert.match(row.image_id, /^sha256:[a-f0-9]{64}$/);
    assert.match(row.mounts_sha256, digestPattern); assert.equal(row.running, false);
  }
  return receipt;
}
export function verifyPreservedArtifacts(value) {
  validatePreservationConfiguration(value);
  for (const row of RETAINED_ARTIFACTS) assert.equal(sha256(readFileSync(row.path)), row.sha256, 'Retained failed evidence changed');
  assert.equal(sha256(readFileSync(value.receipt_file)), value.receipt_sha256, 'Preservation receipt changed');
  const receipt = JSON.parse(readFileSync(value.receipt_file, 'utf8'));
  let oldSourceConfig;
  if (receipt.removed_ephemeral_edge) {
    for (const [file, pin] of [
      [REMOVED_OLD_EDGE.attestation_file, REMOVED_OLD_EDGE.attestation_sha256],
      [REMOVED_OLD_EDGE.source_config_file, REMOVED_OLD_EDGE.source_config_sha256],
      [REMOVED_OLD_EDGE.retained_bootstrap_failure_file, REMOVED_OLD_EDGE.retained_bootstrap_failure_sha256],
    ]) assert.equal(sha256(readFileSync(file)), pin, 'Original CLI-cleanup evidence changed');
    oldSourceConfig = JSON.parse(readFileSync(REMOVED_OLD_EDGE.source_config_file, 'utf8'));
  }
  return validatePreservationReceipt(receipt, JSON.parse(readFileSync(RETAINED_ARTIFACTS[2].path, 'utf8')), oldSourceConfig);
}

export const MISSING_QUOTE_CONTROL = Object.freeze({
  path: 'tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260930.json',
  sha256: '8b22d81d9e74ac7cdaf1d7224c4076b72c1354bcb26407881150bd064c2e7c48',
});
export function buildMissingQuoteFixture(control, reportDate = '2026-10-02') {
  assert.ok(['2026-10-02', '2026-10-06'].includes(reportDate), 'Only the two exact reviewed negative dates are allowed');
  const successor = reportDate === '2026-10-06';
  const expected = structuredClone(control), shift = value => new Date(Date.parse(value) + (successor ? 518400000 : 172800000)).toISOString();
  const mainDate = successor ? '20261006' : '20261002', warmupDate = successor ? '20261005' : '20261001';
  expected.fixture_id = 'missing-required-nvda-' + mainDate;
  expected.report_date = reportDate; expected.warmup_date = successor ? '2026-10-05' : '2026-10-01';
  expected.provenance = { kind: 'SYNTHETIC_PROVIDER_CONTROL', historical_capture: false,
    purpose: 'Exact positive control plus two days, with only the required NVDA provider quote absent in all phases. Expected business publication/Acceptance failure, never a historical PASS.',
    source_control: MISSING_QUOTE_CONTROL, only_fault: 'NVDA_QUOTE_ABSENT_ALL_PROVIDER_ATTEMPTS' };
  if (successor) expected.provenance.purpose = 'Exact positive control facts and quotes with only NVDA absent, dated to the reviewed October 5 warmup and October 6 main session. Warmup US quotes retain the latest completed Friday October 2 cash close; no publication or prior failed rows are adopted.';
  delete expected.quotes.NVDA;
  for (const phase of expected.phases) {
    for (const key of ['starts_at', 'ends_at', 'news_source_at']) phase[key] = shift(phase[key]);
    for (const key of Object.keys(phase.source_times)) phase.source_times[key] = shift(phase.source_times[key]);
    if (successor && phase.id === 'prior-close-warmup') phase.source_times.US = '2026-10-02T20:00:00.000Z';
    for (const row of phase.news ?? []) row.url = row.url.replaceAll('20260930', mainDate).replaceAll('20260929', warmupDate);
  }
  for (const row of expected.news) row.url = row.url.replaceAll('20260930', mainDate);
  return expected;
}
export function validateMissingQuoteFixture(next, control) {
  assert.deepEqual(next, buildMissingQuoteFixture(control, next.report_date), 'Only the missing NVDA quote and exact date transformation are allowed');
  assert.equal(Object.hasOwn(next.quotes, 'NVDA'), false);
  assert.equal(JSON.stringify(next.openai_completion), JSON.stringify(control.openai_completion));
  assertReplayMarketDays(next.warmup_date, next.report_date);
  for (const phase of next.phases) assert.equal(isLatestCompletedUsCashQuote('SPY', Date.parse(phase.source_times.US), Date.parse(phase.starts_at)), true);
  return { missing_required_symbol: 'NVDA', artificial_business_status_seeded: false };
}
export const PROTECTED_CONTROL_ARTIFACTS = Object.freeze([
  { path: '/private/tmp/ma-consolidation-v1-20260909200000-evidence/result.json', sha256: 'fa0fcc81bf14a4a83b3acc38b29e2e6895eb329e4096ef5d560c277bb82a5838' },
  { path: '/private/tmp/ma-consolidation-v1-20260909200000/final-persistent-readback.json', sha256: '35d2cc283ced1d28e733fa6feb069a5647aa26b5c2a8b26184edf416c9076d76' },
  { path: '/private/tmp/ma-consolidation-v1-20260909200000/replay-config.json', sha256: '60ee1969032d44c23207ff1fbb857ef0dfeba6e0f0be170ec0e02bf0d072b6ed' },
  { path: '/private/tmp/ma-consolidation-v1-20260909200000/executed-source-manifest.json', sha256: 'b7e8005f2d7012ccbffa7dd1c546d5c75e66637d5eeea77bbe2cc1c62e9eba6b' },
  { path: '/private/tmp/ma-consolidation-v1-20260909200000/bootstrap-result.json', sha256: '62e5661f779efda3681b855439141533de203328dcd75868e7e5141eec03b208' },
  { path: '/private/tmp/ma-consolidation-v1-20260909200000/bootstrap-continuation-001.json', sha256: '44e7aff0f80ab49f270b550d1bb7597f85ea6675dfe3b29f751be7fb3146225f' },
]);
// Docker may reorder Mounts without changing a mount. Preserve every field and
// cardinality; normalize only array ordering and JSON object-key ordering.
export function canonicalPreservedMounts(mounts) {
  assert.ok(Array.isArray(mounts));
  const destinations = mounts.map(row => { assert.equal(typeof row.Destination, 'string'); return row.Destination; });
  assert.equal(new Set(destinations).size, mounts.length, 'Duplicate preserved mount destination');
  return mounts.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => a.Destination.localeCompare(b.Destination));
}
export function validateProtectedControlReceipt(receipt, baseline, config) {
  const retained = 'ma-consolidation-v1-20260909200000';
  assert.equal(receipt.mount_hash_format, 'ALL_FIELDS_KEY_SORTED_DESTINATION_SORTED', 'Exact protected control mount hash format is required');
  assert.equal(receipt.scope, 'ma-consolidation-v1-20260909210000'); assert.equal(receipt.retained_scope, retained);
  assert.equal(receipt.status, 'RETAINED_EXACT_SIX_STOPPED_ONE_CLI_REMOVED');
  assert.equal(receipt.auth_rows_read_or_modified, false); assert.equal(receipt.business_rows_modified, false);
  assert.equal(receipt.cli_serve_stopped, true); assert.equal(receipt.volumes_deleted, false);
  assert.equal(receipt.removed_ephemeral_edge.name, 'supabase_edge_runtime_' + retained);
  assert.match(receipt.removed_ephemeral_edge.id, digestPattern);
  assert.equal(receipt.removed_ephemeral_edge.image_id, config.containers.edge.image_id);
  assert.equal(receipt.removed_ephemeral_edge.reason, 'ORIGINAL_CLI_SHUTDOWN_REMOVED_STATELESS_EDGE');
  assert.deepEqual(Object.keys(receipt.tables).sort(), [...RETAINED_TABLES].sort());
  assert.deepEqual(receipt.tables, baseline.tables); assert.deepEqual(receipt.boundary, baseline.boundary);
  const names = [...Object.values(config.containers), ...config.additional_containers]
    .map(row => row.name).filter(name => name !== receipt.removed_ephemeral_edge.name).sort();
  assert.deepEqual(receipt.stopped_containers.map(row => row.name).sort(), names);
  for (const row of receipt.stopped_containers) { assert.equal(row.running, false); assert.match(row.id, digestPattern); assert.match(row.mounts_sha256, digestPattern); }
  assert.deepEqual(receipt.retained_volume_names, ['local_core_boundary_' + retained, 'supabase_db_' + retained, 'supabase_edge_runtime_' + retained]);
  assert.deepEqual(receipt.guest_bundle_hashes, [...config.functions, config.boundary].map(row => ({ deployed_file: row.deployed_file, sha256: row.bundle_sha256 })));
  return receipt;
}
export function readProtectedControl(config) {
  for (const row of PROTECTED_CONTROL_ARTIFACTS) assert.equal(sha256(readFileSync(row.path)), row.sha256, 'Prior successful control evidence changed');
  const bytes = readFileSync(config.protected_control_receipt_file);
  assert.equal(sha256(bytes), config.protected_control_receipt_sha256);
  return validateProtectedControlReceipt(JSON.parse(bytes), JSON.parse(readFileSync(PROTECTED_CONTROL_ARTIFACTS[1].path)),
    JSON.parse(readFileSync(PROTECTED_CONTROL_ARTIFACTS[2].path)));
}

// Independent failed-scope preservation, not a successful control or an input
// continuation. These exact original results and source archives never change.
export const PRIOR_FAILED_SCOPE = 'ma-consolidation-v1-20260909210000';
export const FRESH_MISSING_QUOTE_SCOPE = 'ma-consolidation-v1-20260910220000';
export const PRIOR_FAILED_SCOPE_ARTIFACTS = Object.freeze([
  { path: '/private/tmp/ma-missingquote-after-generator500-readonly-20260910.json', sha256: '104967a06e13062728eec64324e97f5297b002cec4d3d29ac6b5c43b9020d283' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000-evidence-warmup-continuation-002/result.json', sha256: 'f66d4e1f519f1c6d95f14104df5df89509e3e2431b149f1b26dc389a1eb3f925' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/replay-config.json', sha256: '8f48f0ea16a1e2dba6b2954d5a17ed2cddc170ea624b7ab1ee2006e0a0ff683e' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/executed-source-manifest.json', sha256: '6bf416bf44335233bc0441224118ae2ef6d1d50403c29d49c5b8e2cff0fc10df' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/executed-source-preimages.tar', sha256: '81b87ad1fa4ce9af6e600653bced9e68c7815195c4e43512884bd254254630c9' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/executed-warmup-continuation-001-manifest.json', sha256: 'eb67eb888cefa7bc6ac271d0f5fa240555a28c1808c33f09c38d42ff3117837a' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/executed-warmup-continuation-001-preimages.tar', sha256: '5c12b037ad7c57e344823d4a64c860d3aa6e60be5d1bee7fa99904246947c941' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/executed-warmup-continuation-002-manifest.json', sha256: '23870a2d3fcff452834daee41af711985a912e39d01f3ea54b5b29fad0e9f629' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/executed-warmup-continuation-002-preimages.tar', sha256: '067edd1af5e753608613330ff892375a821d06af5f99f9e4416a5e631c517efd' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000-evidence/result.json', sha256: 'e26b7724872a37430c7d71d27f1770d1654edb797232f03260161b491851a61c' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000-evidence-warmup-continuation-001/result.json', sha256: '59ee9100b7b6fd4a7b059f4d56a61deb3157f75491b8df7dc8617178b96c9323' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/bootstrap-result.json', sha256: 'd9386fe27bda73298f609c61ed89052008c7cd74da25a22011585635025ff3b1' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/bootstrap-continuation-001.json', sha256: '0d6cb2b0db34331894f88e675c72be650d30f2fd3b6bc2db78fbb454063a80c5' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/bootstrap-continuation-002.json', sha256: '70721fbd55c8ace948f243de4b445a439a8f1b24e7977ec704244ad5e0babf2d' },
  { path: '/private/tmp/ma-consolidation-v1-20260909210000/bootstrap-continuation-003.json', sha256: 'f4fceb95913daba96bde1c6a71236006e6ba38970a12a027644ab48ab43cef40' },
]);
export function validatePriorFailedScopeConfiguration(value) {
  assert.deepEqual(Object.keys(value ?? {}).sort(), ['artifacts', 'receipt_file', 'receipt_sha256', 'report_date', 'scope']);
  assert.equal(value.scope, PRIOR_FAILED_SCOPE); assert.equal(value.report_date, '2026-10-02');
  assert.equal(value.receipt_file, '/private/tmp/' + FRESH_MISSING_QUOTE_SCOPE + '/prior-failed-scope-preservation.json');
  assert.match(value.receipt_sha256, digestPattern);
  assert.deepEqual(value.artifacts, PRIOR_FAILED_SCOPE_ARTIFACTS);
  return value;
}
export function validatePriorFailedScopeReceipt(receipt, baseline, oldConfig, priorFailure) {
  assert.equal(receipt.schema_version, 'CORE_MISSING_QUOTE_FAILED_SCOPE_PRESERVATION_V1');
  assert.equal(receipt.scope, FRESH_MISSING_QUOTE_SCOPE); assert.equal(receipt.retained_scope, PRIOR_FAILED_SCOPE);
  assert.equal(receipt.retained_report_date, '2026-10-02');
  assert.equal(receipt.status, 'FAILED_SCOPE_RETAINED_EXACT_SIX_STOPPED_ONE_CLI_REMOVED');
  assert.equal(receipt.prior_result_status, 'FAIL'); assert.equal(receipt.adopted_as_input, false);
  assert.equal(receipt.successful_control_claim, false); assert.equal(receipt.business_rows_modified, false);
  assert.equal(receipt.auth_rows_read_or_modified, false); assert.equal(receipt.auth_user_count, 0);
  assert.equal(receipt.volumes_deleted, false); assert.equal(receipt.cli_serve_stopped, true);
  assert.equal(receipt.mount_hash_format, 'ALL_FIELDS_KEY_SORTED_DESTINATION_SORTED');
  assert.deepEqual(receipt.artifacts, PRIOR_FAILED_SCOPE_ARTIFACTS);
  assert.equal(baseline.schema_version, 'CORE_MISSING_QUOTE_AFTER_GENERATOR500_READONLY_V1');
  assert.equal(baseline.scope, PRIOR_FAILED_SCOPE); assert.equal(baseline.auth_user_count, 0);
  assert.equal(oldConfig.scope, PRIOR_FAILED_SCOPE);
  assert.equal(priorFailure.scope, PRIOR_FAILED_SCOPE); assert.equal(priorFailure.status, 'FAIL');
  assert.equal(priorFailure.run_id, '1229c88e-edce-48c4-b57a-2e71f3e6072e');
  assert.equal(priorFailure.test_success, false); assert.equal(priorFailure.full_persisted_chain_executed, false);
  assert.equal(priorFailure.actual_acceptance_verdict, null);
  const generator = priorFailure.records.filter(row => row.stage === 'handler:generate-daily-report-v7' && row.http !== undefined);
  assert.equal(generator.length, 1); assert.equal(generator[0].http, 500);
  assert.equal(generator[0].response_body.error_code, 'RESEARCH_EXECUTION_FAILED');
  assert.ok(generator[0].response_body.reason_codes.includes('REPORT_STATE_ADVANCE_FAILED'));
  assert.deepEqual(Object.keys(receipt.tables).sort(), [...RETAINED_TABLES].sort());
  assert.deepEqual(receipt.tables, baseline.tables, 'All 27 failed-scope tables, including the erroneous publication, must remain exact');
  assert.equal(receipt.provider_receipts.length, 29);
  assert.deepEqual(receipt.provider_receipts, baseline.provider_receipts);
  assert.equal(receipt.provider_receipts_jsonl_sha256, baseline.provider_receipts_jsonl_sha256);
  assert.equal(receipt.tables.reports.length, 1);
  assert.equal(receipt.tables.reports[0].id, '567ac81a-51a5-4b49-a694-4cc524a47e80');
  assert.equal(receipt.tables.decision_snapshots[0].id, 'bdec7b93-87a3-48cc-9d0c-e58b7c6bffda');
  assert.equal(receipt.tables.member_content_revisions[0].id, '804fb545-f237-4f1f-8c65-16af091ab3dd');
  assert.equal(receipt.tables.production_acceptance_results.length, 0);
  const expectedContainers = [...Object.values(oldConfig.containers), ...oldConfig.additional_containers];
  const names = expectedContainers.map(row => row.name).sort(); assert.equal(names.length, 7);
  assert.deepEqual(receipt.containers_before_stop.map(row => row.name).sort(), names);
  assert.deepEqual(baseline.containers.map(row => row.name).sort(), names);
  for (const row of receipt.containers_before_stop) {
    const original = baseline.containers.find(value => value.name === row.name);
    assert.equal(row.id, original.id); assert.equal(row.image_id, original.image_id);
    assert.equal(row.image_id, expectedContainers.find(value => value.name === row.name).image_id);
    assert.deepEqual(row.network_names, [PRIOR_FAILED_SCOPE + '-isolated']);
    canonicalPreservedMounts(row.mounts); // Some original services legitimately have no mounts.
  }
  const edgeName = 'supabase_edge_runtime_' + PRIOR_FAILED_SCOPE;
  const edge = receipt.containers_before_stop.find(row => row.name === edgeName);
  assert.deepEqual(receipt.removed_ephemeral_edge, { name: edge.name, id: edge.id, image_id: edge.image_id,
    mounts_sha256: sha256(JSON.stringify(canonicalPreservedMounts(edge.mounts))), reason: 'ORIGINAL_CLI_SHUTDOWN_REMOVED_STATELESS_EDGE' });
  assert.deepEqual(receipt.stopped_containers.map(row => row.name).sort(), names.filter(name => name !== edgeName));
  for (const row of receipt.stopped_containers) {
    const before = receipt.containers_before_stop.find(value => value.name === row.name);
    assert.equal(row.id, before.id); assert.equal(row.image_id, before.image_id); assert.equal(row.running, false);
    assert.equal(row.mounts_sha256, sha256(JSON.stringify(canonicalPreservedMounts(before.mounts))));
  }
  assert.deepEqual(receipt.retained_volume_names, ['local_core_boundary_', 'supabase_db_', 'supabase_edge_runtime_'].map(prefix => prefix + PRIOR_FAILED_SCOPE));
  assert.deepEqual(receipt.guest_bundle_hashes, [...oldConfig.functions, oldConfig.boundary].map(row => ({ deployed_file: row.deployed_file, sha256: row.bundle_sha256 })));
  assert.equal(receipt.guest_bundle_hashes.length, 14);
  return receipt;
}
export function readPriorFailedScope(config) {
  assert.equal(config.scope, FRESH_MISSING_QUOTE_SCOPE);
  const value = validatePriorFailedScopeConfiguration(config.prior_failed_scope_preservation);
  for (const row of PRIOR_FAILED_SCOPE_ARTIFACTS) assert.equal(sha256(readFileSync(row.path)), row.sha256, 'Original failed-scope evidence or source archive changed');
  const bytes = readFileSync(value.receipt_file); assert.equal(sha256(bytes), value.receipt_sha256);
  const read = index => JSON.parse(readFileSync(PRIOR_FAILED_SCOPE_ARTIFACTS[index].path, 'utf8'));
  const oldConfig = read(2);
  for (const row of oldConfig.bootstrap_receipts) assert.equal(sha256(readFileSync(row.path)), row.sha256, 'Original bootstrap receipt changed');
  for (const row of [...oldConfig.functions, oldConfig.boundary]) assert.equal(sha256(readFileSync(row.bundle_file)), row.bundle_sha256, 'Original failed-scope bundle bytes changed');
  assert.equal(sha256(readFileSync(oldConfig.boundary.receiver.bundle_file)), oldConfig.boundary.receiver.bundle_sha256, 'Original stopped receiver source changed');
  return validatePriorFailedScopeReceipt(JSON.parse(bytes), read(0), oldConfig, read(1));
}
