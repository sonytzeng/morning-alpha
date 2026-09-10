// Actual source admission and in-memory adversarial readers only. No DB/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { PUBLIC_EXPORT_ARTIFACT_PATH, resolveConsolidationPublicExportIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';
import { ACCEPTANCE_DEFAULT_ARTIFACT_PATH, assertAcceptanceDefaultSuccessor,
  resolveConsolidationAcceptanceDefaultIntegrity } from './helpers/consolidationAcceptanceDefaultIntegrity.mjs';

const REGISTRY = 'docs/operations/core-stability-incident-amendment-20260908.json';
const GUARD = 'tests/helpers/consolidationAcceptanceDefaultIntegrity.mjs';
const ENTRY = 'tests/helpers/consolidationPublicExportIntegrity.mjs';
const SQL = 'supabase/migrations/20260909015650_core_market_publication_contract.sql';
const FIXTURE = 'tests/fixtures/core-production-acceptance-v1.json';
const SECTION = 'core_acceptance_default_v1_registration';
const PIN = Object.freeze({
  "helper": "f4804dee8a3246a3d68b41474878b35cedea8afe55cba5ff01d0250164f6453d",
  "entry": "d4cda72931e160b6e07457f83f916c5390e0123bf497e81d33de8c37b42994bc",
  "artifact": "17c43a104b1276b26322c50f1e6d61bd61fa1edb3071a36c07da3cd775c162b2",
  "registry": "0cf9db8e012607f1b057d8ed974c21354c304b342d5b3a5674b78eb927e11ad2"
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const registry = JSON.parse(read(REGISTRY)), artifactBytes = read(ACCEPTANCE_DEFAULT_ARTIFACT_PATH);
const artifact = JSON.parse(artifactBytes), eighth = read(PUBLIC_EXPORT_ARTIFACT_PATH);
const verify = (r = registry, source = read) => resolveConsolidationPublicExportIntegrity(r, eighth, source);

test('Acceptance V1: independent live entry/helper/artifact/registry seals and complete ten-layer reconstruction', () => {
  assert.equal(hash(read(GUARD)), PIN.helper); assert.equal(hash(read(ENTRY)), PIN.entry);
  assert.equal(hash(artifactBytes), PIN.artifact); assert.equal(hash(read(REGISTRY)), PIN.registry);
  assert.equal(artifact.registration.files.length, 5);
  const result = verify();
  assert.equal(hash(result.tenthReadSource(REGISTRY)), '188a0b57dc9c3363dce9f73a20737c927bbaca068909edbdfdb98cd253d88e35');
  assert.equal(hash(result.tenthReadSource(SQL)), '353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0');
  assert.equal(hash(result.tenthReadSource(ENTRY)), '6397a0d25bd0e398b71790b8c253a8b6ccd188dc3d56df5a7788f08dc1a767c6');
  assert.equal(hash(result.ninthReadSource(REGISTRY)), '48668fbb895cb926fbec2c696358161bb701b1534805a078caa268998086087c');
  assert.deepEqual(result.tenthReadSource(REGISTRY), gunzipSync(Buffer.from(artifact.previous_complete_registry_gzip_base64, 'base64')));
  assert.equal(result.tenthRegistry[SECTION], undefined);
  assert.throws(() => result.tenthReadSource(FIXTURE), { code: 'ENOENT' });
  assert.ok(result.newCandidatePaths.includes(FIXTURE));
});

test('Acceptance V1: exact single default change accepts V1 and rejects old V3 or unrelated SQL edits', () => {
  const original = gunzipSync(Buffer.from(artifact.preimages[SQL], 'base64')), current = read(SQL);
  assertAcceptanceDefaultSuccessor(original, current);
  assert.throws(() => assertAcceptanceDefaultSuccessor(original, original));
  assert.throws(() => assertAcceptanceDefaultSuccessor(current, current));
  for (const invalid of [Buffer.concat([current, Buffer.from('\n')]),
    Buffer.from(current.toString().replace("default 'PRODUCTION_ACCEPTANCE_V1'", "default 'PRODUCTION_ACCEPTANCE_V2'")),
    Buffer.from(current.toString().replace('security definer', 'security invoker')),
    Buffer.concat([current, Buffer.from("\np_evaluator_version text default 'PRODUCTION_ACCEPTANCE_V1'\n")])]) {
    assert.throws(() => assertAcceptanceDefaultSuccessor(original, invalid));
  }
  assert.throws(() => verify(registry, path => path === SQL ? original : read(path)), /unreviewed Eleventh live source drift/);
});

test('Acceptance V1: exact captured eight-field Production baseline and original function definition', () => {
  const fixture = JSON.parse(read(FIXTURE));
  assert.equal(hash(read(FIXTURE)), '6a8ed6a43bd301659006400b76bac70e1e13ae92e31bb2267ca8359030e2ff14');
  assert.equal(fixture.source.contains_business_rows, false);
  assert.equal(hash(fixture.function.definition), '7ce49074d08cfcd79cea707615ff16ca0818f2bcc28df487e6bf88251dce8063');
  assert.deepEqual(Object.keys(fixture.function).sort(), ['acl', 'arguments', 'definition', 'owner', 'regprocedure', 'result', 'security_definer', 'settings']);
  assert.equal(fixture.function.arguments, "p_business_date date, p_evaluator_version text DEFAULT 'PRODUCTION_ACCEPTANCE_V1'::text");
  assert.equal(fixture.function.acl, '{postgres=X/postgres,service_role=X/postgres}');
  assert.deepEqual(fixture.function.settings, ['search_path=""']);
});

for (const row of artifact.registration.files) test('Acceptance V1: reject every live source drift before Tenth callback: ' + row.path, () => {
  let calls = 0;
  const source = path => path === row.path ? Buffer.concat([read(path), Buffer.from('\nUNREVIEWED\n')]) : read(path);
  assert.throws(() => resolveConsolidationAcceptanceDefaultIntegrity(registry, eighth, source, () => { calls++; }), /unreviewed Eleventh live source drift/);
  assert.equal(calls, 0); assert.throws(() => verify(registry, source), /unreviewed Eleventh live source drift/);
});

for (const mode of ['missing', 'empty', 'null', 'array']) test('Acceptance V1: live entry refuses ' + mode + ' registration', () => {
  const changed = structuredClone(registry);
  if (mode === 'missing') delete changed[SECTION]; else changed[SECTION] = mode === 'empty' ? {} : mode === 'null' ? null : [];
  assert.throws(() => verify(changed), /Eleventh registration required|Eleventh independently fixed registration/);
});

test('Acceptance V1: co-mutated hashes, scope, privileges or old registry cannot self-authorize', () => {
  for (const mutate of [r => r[SECTION].files.pop(), r => r[SECTION].files.push(r[SECTION].files[0]),
    r => r[SECTION].files[0].candidate_hash = '0'.repeat(64), r => r[SECTION].runtime_raw_hash_waiver = true,
    r => r[SECTION].release_ready = true, r => r[SECTION].acl_change = true]) {
    const changed = structuredClone(registry); mutate(changed);
    assert.throws(() => verify(changed, path => path === REGISTRY ? json(changed) : read(path)), /Eleventh independently fixed registration/);
  }
  const changed = structuredClone(registry); changed.files[0].baseline_sha256 = '0'.repeat(64);
  assert.throws(() => verify(changed, path => path === REGISTRY ? json(changed) : read(path)), /all ten registry layers unchanged/);
  assert.throws(() => verify(registry, path => path === REGISTRY ? Buffer.concat([read(path), Buffer.from('\n')]) : read(path)), /exact Eleventh append-only suffix/);
});

test('Acceptance V1: sealed artifact rejects preimage/diff/Production definition tampering before predecessor checks', () => {
  for (const mutate of [a => a.preimages[SQL] = 'broken', a => delete a.preimages[SQL],
    a => a.source_diffs[SQL] += '\n', a => a.registration.files.pop(),
    a => a.previous_complete_registry_gzip_base64 = 'broken']) {
    const changed = structuredClone(artifact); mutate(changed); let calls = 0;
    assert.throws(() => resolveConsolidationAcceptanceDefaultIntegrity(registry, eighth,
      path => path === ACCEPTANCE_DEFAULT_ARTIFACT_PATH ? json(changed) : read(path), () => { calls++; }), /Eleventh independently pinned artifact/);
    assert.equal(calls, 0);
  }
});

test('Acceptance V1: Tenth artifact/guard and all historical attack bodies remain protected', () => {
  for (const path of ['tests/helpers/consolidationFixtureRepresentation.mjs', 'docs/operations/evidence/core-fixture-representation-20260910.json']) {
    assert.throws(() => verify(registry, p => p === path ? Buffer.concat([read(p), Buffer.from('\n')]) : read(p)), /entire Tenth/);
  }
  const result = verify(), path = 'tests/consolidationFixtureRepresentation.test.mjs', marker = 'const REGISTRY=';
  const before = result.tenthReadSource(path).toString(), after = read(path).toString();
  assert.equal(before.slice(before.indexOf(marker)), after.slice(after.indexOf(marker)));
  assert.equal(hash(after.slice(after.indexOf(marker))), artifact.registration.tenth_test_tail);
  assert.equal(artifact.registration.database_callbacks.length, 24);
  assert.equal(artifact.registration.added_database_tests.length, 3);
});

test('Acceptance V1: historical SQL/result pins and runtime raw checks are not waived or relabelled', () => {
  assert.equal(artifact.claims.historical_103_is_v1_positive, false);
  assert.equal(artifact.claims.database_27_executed_by_admission, false);
  assert.ok(Object.values(artifact.claims).every(value => value === false));
  for (const path of ['tests/helpers/coreConsolidationReplayRuntime.mjs', 'tests/helpers/coreConsolidationPublicExportRuntime.mjs',
    'tests/helpers/coreConsolidationFactualExportRuntime.mjs', 'tests/helpers/coreConsolidationMissingQuoteRuntime.mjs']) {
    assert.equal(hash(read(path)), artifact.unchanged_runtime_readers[path]);
    assert.match(read(path).toString(), /assert.equal\(sha256\(sql\), config.sql_candidate.sha256, 'SQL candidate differs from bootstrap'\)/);
  }
});
