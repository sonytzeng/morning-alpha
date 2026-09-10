// Read-only scope preflight. This module never creates a database, invokes an
// Edge function, loads credentials, enables Cron, or writes a replay result.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const CONSOLIDATION_SERVICES = Object.freeze(['db', 'rest', 'auth', 'kong', 'edge_runtime', 'inbucket']);
const LOCAL_CONTEXT = 'colima-ma-core-20260907';
const LOCAL_DOCKER_ENDPOINT = 'unix:///Users/sonytzeng/.colima/ma-core-20260907/docker.sock';

export function validateConsolidationConfiguration(config, environment = process.env) {
  assert.equal(environment.MA_CONSOLIDATION_REPLAY, 'LOCAL_ONLY', 'Explicit local replay authority required');
  assert.match(config.scope ?? '', /^ma-consolidation-v1-\d{14}$/, 'Use a new, dated consolidation scope, never an old evidence stack');
  assert.equal(environment.MA_LOCAL_SCOPE, config.scope, 'Environment and requested scope must match');
  assert.equal(config.dockerContext, LOCAL_CONTEXT, 'Only the inspected local Docker context is permitted');
  assert.equal(config.network, config.scope + '-isolated', 'Use the dedicated scope network');
  assert.equal(resolve(config.evidenceDirectory ?? ''), `/private/tmp/${config.scope}-evidence`, 'Use the exact private evidence directory');
  const origins = Object.fromEntries(['api', 'mail', 'frontend'].map(name => {
    const u = new URL(config.origins?.[name]);
    assert.equal(u.protocol, 'http:', `${name} must use local HTTP`);
    assert.equal(u.hostname, '127.0.0.1', `${name} must be explicit loopback, not a remote host or DNS alias`);
    assert.ok(u.port, `${name} must name an explicit port`);
    assert.equal(u.username + u.password + u.search + u.hash, '', `${name} must not contain credentials or query parameters`);
    assert.equal(u.pathname, '/', `${name} must be an origin, not an endpoint`);
    return [name, u.origin];
  }));
  assert.equal(new Set(Object.values(origins)).size, 3, 'Each local service needs a distinct origin');
  return { scope: config.scope, dockerContext: config.dockerContext, network: config.network, evidenceDirectory: config.evidenceDirectory, origins };
}

export function validateConsolidationFacts(config, facts) {
  assert.equal(facts.dockerEndpoint, LOCAL_DOCKER_ENDPOINT, 'The named context must still point to the inspected local Unix socket');
  assert.equal(facts.internal, true, 'Docker network must be Internal=true');
  assert.equal(facts.databaseScope, config.scope, 'Actual database scope identity must match');
  assert.deepEqual(Object.keys(facts.containerNetworks ?? {}).sort(), [...CONSOLIDATION_SERVICES].sort(), 'Inspect every required runtime service');
  for (const service of CONSOLIDATION_SERVICES) {
    assert.deepEqual(facts.containerNetworks[service], [config.network], `${service} must attach only to the isolated network`);
  }
  return { ...config, isolation_verified: true, production_operations_authorized: false, automatic_stable_day: false };
}

export function inspectConsolidationLocalScope(config, environment = process.env) {
  const checked = validateConsolidationConfiguration(config, environment);
  assert.equal(existsSync(checked.evidenceDirectory), false, 'Existing acceptance evidence must never be overwritten');
  const docker = args => execFileSync('docker', ['--context', checked.dockerContext, ...args], {
    encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const dockerEndpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', checked.dockerContext]);
  assert.equal(dockerEndpoint, LOCAL_DOCKER_ENDPOINT, 'Do not contact a moved/remote Docker context');
  const internal = docker(['network', 'inspect', '--format', '{{.Internal}}', checked.network]) === 'true';
  const containerNetworks = Object.fromEntries(CONSOLIDATION_SERVICES.map(service => [service, Object.keys(JSON.parse(docker([
    'inspect', '--format', '{{json .NetworkSettings.Networks}}', `supabase_${service}_${checked.scope}`,
  ]))).sort()]));
  const databaseScope = docker(['exec', `supabase_db_${checked.scope}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-c', 'begin read only; select scope from ma_isolated_guard.identity; rollback;']);
  return validateConsolidationFacts(checked, { dockerEndpoint, internal, containerNetworks, databaseScope });
}
