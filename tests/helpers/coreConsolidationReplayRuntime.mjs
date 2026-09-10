// Test orchestration only. No DDL, business-row seeding, provider egress or clock override.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, realpathSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createVmClockController, validateVmClockConfiguration } from './consolidationVmClock.mjs';

export const REPLAY_FUNCTIONS = Object.freeze([
  'fetch-market-data-v10', 'fetch-global-market-news', 'generate-sector-rotation',
  'generate-daily-report-v7', 'get-report-payload', 'line-daily-push',
  'opening-market-radar', 'close-market-review', 'closing-verification-engine',
  'continuous-learning-engine', 'daily-delivery-orchestrator', 'ma-ops-health-check',
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
  'ma-consolidation-v1-20260909133500': Object.freeze({ version: 1, origin: 'http://127.0.0.1:55461', subnet: '172.18.0.0/16' }),
  'ma-consolidation-v1-20260909154500': Object.freeze({ version: 1, origin: 'http://127.0.0.1:55471', subnet: '172.19.0.0/16' }),
  'ma-consolidation-v1-20260909170000': Object.freeze({ version: 2, origin: 'http://127.0.0.1:55481', subnet: '172.20.0.0/16' }),
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
  assert.equal(environment.MA_CONSOLIDATION_REPLAY, 'LOCAL_ONLY');
  assert.match(config.scope, scopePattern); assert.equal(environment.MA_LOCAL_SCOPE, config.scope);
  assert.match(config.report_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(config.report_date + 'T00:00:00Z').toISOString().slice(0, 10), config.report_date);
  assert.equal(config.scenario_kind, 'SYNTHETIC_MARKET_READY_STOCK_BLOCKED_CONTROL');
  assert.equal(config.historical_success_claim, false); assert.equal(config.production_operations_authorized, false);
  const attempt = config.attempt ?? 1;
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
  assert.equal(data.scope, config.scope); assert.equal(data.provenance, 'GENERATED_IN_THIS_ISOLATED_STACK');
  assert.equal(data.production_secrets_copied, false); assert.equal(data.api_origin, config.api_origin);
  for (const key of ['anon_key', 'service_role_key', 'cron_secret']) assert.ok(typeof data[key] === 'string' && data[key].length > 10);
  assert.match(data.auth.email, /^[a-z0-9+._-]+@example\.invalid$/i);
  assert.ok(data.auth.password.length >= 16);
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
      "begin read only; select json_build_object('scope',(select scope from ma_isolated_guard.identity),'observed_at',clock_timestamp()); rollback;"]);
    const row = JSON.parse(bytes); assert.equal(row.scope, config.scope); return row;
  }
  return Object.freeze({ inspect, clockWitness });
}

export function assertClockAgreement({ scope, guest, postgres, edge, auth, started, ended }) {
  assert.equal(postgres.scope, scope); assert.equal(edge.scope, scope);
  assert.equal(edge.clock_override, false); assert.equal(edge.boot_id, guest.boot_id);
  assert.equal(edge.business_edge_clock_observed, true);
  const times = [postgres.observed_at, edge.observed_at, edge.receiver_observed_at, new Date(auth.issued_at * 1000).toISOString()].map(Date.parse);
  assert.ok(times.every(Number.isFinite));
  assert.ok(times.every(at => at >= Date.parse(started) - 1000 && at <= Date.parse(ended) + 1000), 'PG, real Auth and Edge must share the same clock');
  assert.equal(auth.user_id, auth.verified_user_id, 'Real Auth user readback must match newly issued session');
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
    const result = { schema_version: 'CORE_CONSOLIDATION_FULL_CHAIN_RESULT_V1', run_id: runId, scope: config.scope,
      status, scenario_kind: config.scenario_kind, historical_success_claim: false, automatic_stable_day: false,
      production_requests: 0, provider_delivery: 'SYNTHETIC_LOCAL_BOUNDARY', natural_scheduler_executed: false,
      terminal_lifecycle_path: 'ACTUAL_MANUAL_RECOVERY_HANDLER',
      full_persisted_chain_executed: status === 'PASS', records };
    Object.assign(result, { browser_executed: false, historical_120_day_effects_verified: false,
      complete_user_release_gate: 'NOT_DEMONSTRATED_BY_THIS_RUNNER_ALONE' });
    writeFileSync(config.evidence_directory + '/result.json', JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return result;
  };
  return Object.freeze({ runId, append, finish });
}
