import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readActualFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  PUBLIC_EXPORT_ARTIFACT_PATH,
  readConsolidationPublicExportIntegrity as readCurrentIntegrity,
} from './helpers/consolidationPublicExportIntegrity.mjs';

// Validate the complete live Ninth source before exposing the exact old
// Eighth view to these unchanged historical tests and independent pins.
const currentRoot = new URL('../', import.meta.url);
const currentIntegrity = readCurrentIntegrity(JSON.parse(readActualFileSync(new URL('docs/operations/core-stability-incident-amendment-20260908.json', currentRoot))));
const readFileSync = target => {
  const absolute = fileURLToPath(target), base = fileURLToPath(currentRoot);
  assert.ok(absolute.startsWith(base), 'historical test read must remain inside repository');
  return currentIntegrity.eighthReadSource(absolute.slice(base.length));
};
const resolveConsolidationPublicExportIntegrity = currentIntegrity.verifyEighth;

// Independently reviewed immutable pins. No mutation below writes to disk;
// previous Production hashes, historical test bodies and failure rows remain.
const REGISTRY_PATH = 'docs/operations/core-stability-incident-amendment-20260908.json';
const GUARD_PATH = 'tests/helpers/consolidationPublicExportIntegrity.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const raw = read(REGISTRY_PATH);
const registry = JSON.parse(raw);
const artifactBytes = read(PUBLIC_EXPORT_ARTIFACT_PATH);
const artifact = JSON.parse(artifactBytes);
const verify = (r = registry, a = artifactBytes, source = read) =>
  resolveConsolidationPublicExportIntegrity(r, a, source);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const originalRegistryHash = '9ce4346495b9287e31a73c286abc45a5a7dac45db67ece8899988aafd7996d9a';

test('public export admission: independent exact artifact, guard and append-only registry', () => {
  assert.equal(hash(artifactBytes), 'f0f4a1a7d5b72d45841f1910ef5ccd8c3b390c4488f78b82ccf3e687ee17b2f1');
  assert.equal(hash(read(GUARD_PATH)), 'a9a11fbfeb230ac98ef92c84a6dfa688b10e309b7230fad7ef96aa0a51ea2369');
  assert.equal(hash(raw), 'adab1af6cc1099536c16b3704cbdaaae8f41f27c1243a6c485b40e0be2cc9411');
  const baseline = verify();
  assert.equal(hash(baseline.seventhReadSource(REGISTRY_PATH)), originalRegistryHash);
  assert.equal(artifact.registration.files.length, 24);
  assert.equal(artifact.registration.declarations.length, 0);
  assert.equal(artifact.registration.preserved_test_bodies.length, 7);
  assert.equal(artifact.registration.test_case_successors.length, 4);
  assert.equal(baseline.seventhRegistry.core_public_export_projection_registration, undefined);
});
for (const row of artifact.registration.files) {
  test('public export admission rejects live source drift: ' + row.path, () => {
    verify();
    assert.throws(() => verify(registry, artifactBytes, path => path === row.path
      ? Buffer.concat([read(path), Buffer.from('\nUNREVIEWED_SOURCE\n')]) : read(path)),
    /unreviewed live source drift/);
  });
}
for (const path of [
  'tests/helpers/subscriberProjectionIntegrity.mjs',
  'tests/helpers/consolidationIntegrity.mjs',
  'tests/helpers/consolidationDeliveryIntegrity.mjs',
  'tests/helpers/consolidationTestWiringIntegrity.mjs',
  'tests/helpers/consolidationSqlHistoryIntegrity.mjs',
  'docs/operations/evidence/core-consolidation-sql-history-20260909.json',
  'docs/operations/core-stability-source-manifest-20260907.json',
]) {
  test('public export admission rejects an altered historical guard/evidence: ' + path, () => {
    verify();
    assert.throws(() => verify(registry, artifactBytes, name => name === path
      ? Buffer.concat([read(name), Buffer.from('\n')]) : read(name)));
  });
}
for (const flag of [
  'production_operations', 'production_sql_execution', 'external_delivery_verified',
  'natural_stability_claim', 'auth_change', 'acl_change', 'readdy_host_verified', 'release_ready',
]) {
  test('source admission cannot grant operational authority: ' + flag, () => {
    verify();
    const changed = structuredClone(registry);
    changed.core_public_export_projection_registration[flag] = true;
    assert.throws(() => verify(changed), /independently fixed registration/);
  });
}
test('public export admission rejects old Production hash replacement', () => {
  verify();
  const changed = structuredClone(registry);
  changed.files[0].baseline_sha256 = '0'.repeat(64);
  assert.throws(() => verify(changed), /supplied and actual registry differ/);
});
test('public export admission rejects additional unknown source even with a matching claimed hash', () => {
  verify();
  const changed = structuredClone(registry);
  changed.core_public_export_projection_registration.files.push({
    path: 'supabase/functions/unknown/index.ts', original_hash: null, candidate_hash: '0'.repeat(64),
  });
  assert.throws(() => verify(changed), /independently fixed registration/);
});
test('public export admission rejects forged diff and arbitrary source preimage', () => {
  verify();
  for (const key of ['source_diffs', 'preimages']) {
    const changed = structuredClone(artifact);
    changed[key][Object.keys(changed[key])[0]] = 'unreviewed';
    assert.throws(() => verify(registry, json(changed)), /immutable artifact/);
  }
});
test('public export admission preserves exact deployed v19 rollback source, not repository v7 substitution', () => {
  verify();
  const deployed = artifact.production_source_capture;
  assert.equal(deployed.version, 19);
  assert.equal(hash(gunzipSync(Buffer.from(deployed.original_source_gzip_base64, 'base64'))),
    '8f3c4a9525804ef1beaf04b8eebdfd08b72e1ea488ebae0d99232fa86f7bd7e1');
  assert.notEqual(deployed.source_sha256, deployed.repository_predecessor_sha256);
  assert.equal(deployed.verify_jwt_changed, false);
  assert.equal(deployed.dependencies.length, 3);
  for (const row of deployed.dependencies) {
    assert.equal(hash(gunzipSync(Buffer.from(row.original_source_gzip_base64, 'base64'))), row.sha256);
  }
});
test('public export admission cannot treat old missing-citation failure as new full-stack or natural PASS', () => {
  verify();
  const registration = artifact.registration;
  assert.equal(registration.release_ready, false);
  assert.equal(registration.external_delivery_verified, false);
  assert.equal(registration.natural_stability_claim, false);
  assert.equal(registration.readdy_host_verified, false);
  const fixture = JSON.parse(read('tests/fixtures/consolidation-v1/content-os/persisted-market-only-20260921.json'));
  assert.ok(JSON.stringify(fixture).includes('2026-09-21'));
  assert.doesNotMatch(JSON.stringify(registration), /FULL_E2E[^,\n]*PASS/);
});
