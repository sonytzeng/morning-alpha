import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as readActualFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';
import { PUBLIC_EXPORT_ARTIFACT_PATH, readConsolidationPublicExportIntegrity as readCurrentIntegrity } from './helpers/consolidationPublicExportIntegrity.mjs';
import { REQUIRED_MARKET_ARTIFACT_PATH, resolveConsolidationRequiredMarketIntegrity } from './helpers/consolidationRequiredMarketIntegrity.mjs';

// The complete live Tenth is verified before these unchanged Ninth tests run.
const currentRoot = new URL('../', import.meta.url);
const currentIntegrity = readCurrentIntegrity(JSON.parse(readActualFileSync(new URL('docs/operations/core-stability-incident-amendment-20260908.json', currentRoot))));
const readFileSync = target => {
  const absolute = fileURLToPath(target), base = fileURLToPath(currentRoot);
  assert.ok(absolute.startsWith(base), 'historical test read must remain inside repository');
  return currentIntegrity.ninthReadSource(absolute.slice(base.length));
};
const resolveConsolidationPublicExportIntegrity = currentIntegrity.verifyNinth;

// Independent exact pins for the reviewed Ninth proposal. Every mutation below
// is an in-memory adversarial read; no runtime, DB, Auth or filesystem writes.
const REGISTRY = 'docs/operations/core-stability-incident-amendment-20260908.json';
const GUARD = 'tests/helpers/consolidationRequiredMarketIntegrity.mjs';
const OLD_GUARD = 'tests/helpers/consolidationPublicExportIntegrity.mjs';
const OLD_TEST = 'tests/consolidationPublicExportIntegrity.test.mjs';
const GENERATOR = 'supabase/functions/generate-daily-report-v7/index.ts';
const SECTION = 'core_required_market_input_registration';
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const registry = JSON.parse(read(REGISTRY)), eighthBytes = read(PUBLIC_EXPORT_ARTIFACT_PATH);
const artifactBytes = read(REQUIRED_MARKET_ARTIFACT_PATH), artifact = JSON.parse(artifactBytes);
const verify = (r = registry, source = read) => resolveConsolidationPublicExportIntegrity(r, eighthBytes, source);

test('required markets: independently pinned complete Ninth and recoverable eight-layer predecessor', () => {
  assert.equal(hash(artifactBytes), '59425c6ad3d7a5e1e7ba4d37a3fcd7580f1b7b12f256a8aa22c42d25ed8eb25b');
  assert.equal(hash(read(GUARD)), '8ce476ae47872563b01a77830c26336400effebac08c4fd365760b499f454b0c');
  assert.equal(hash(read(REGISTRY)), '48668fbb895cb926fbec2c696358161bb701b1534805a078caa268998086087c');
  const result = verify();
  assert.equal(artifact.registration.files.length, 5);
  assert.equal(artifact.registration.declarations.length, 1);
  assert.equal(artifact.registration.test_case_successors.length, 0);
  assert.equal(artifact.registration.additive_test_statements.length, 2);
  assert.ok(artifact.registration.files.every(row => row.original_hash !== null));
  assert.equal(hash(result.eighthReadSource(REGISTRY)), 'adab1af6cc1099536c16b3704cbdaaae8f41f27c1243a6c485b40e0be2cc9411');
  assert.equal(hash(result.eighthReadSource(OLD_GUARD)), 'a9a11fbfeb230ac98ef92c84a6dfa688b10e309b7230fad7ef96aa0a51ea2369');
  assert.equal(hash(result.eighthReadSource(OLD_TEST)), '5838a1790da4f6101e164036941604d2a240627f3224e890122c30d1c7253d2d');
  assert.equal(hash(result.eighthReadSource(GENERATOR)), 'b642e59f5a914c778270e358c81d4eeee92695a0ffb4b95d02558c43dc8d6e8a');
  assert.equal(result.eighthRegistry[SECTION], undefined);
  assert.equal(result.eighthRegistry.core_public_export_projection_registration.files.length, 24);
  assert.equal(result.eighthRegistry.core_public_export_projection_registration.declarations.length, 0);
  assert.equal(result.eighthRegistry.core_public_export_projection_registration.test_case_successors.length, 4);
  assert.equal(result.eighthRegistry.core_public_export_projection_registration.preserved_test_bodies.length, 7);
  assert.equal(result.fileHash({ path: GENERATOR }), '6422ed6beb659f715fe02b7d5ac30866fad6dffe73020b6db78d7ff8627709b9');
  assert.equal(result.declarationHash({ path: GENERATOR, name: 'checkMVPStatus' }), 'bc9e38fa63a22c9329e4757540231765944a1785c419a611f659390213f7ede3');
});

for (const mode of ['missing', 'empty', 'null', 'array']) test('live Eighth entry never bypasses Ninth with ' + mode + ' section', () => {
  const changed = structuredClone(registry);
  if (mode === 'missing') delete changed[SECTION];
  if (mode === 'empty') changed[SECTION] = {};
  if (mode === 'null') changed[SECTION] = null;
  if (mode === 'array') changed[SECTION] = [];
  assert.throws(() => verify(changed), /Ninth registration is required|Ninth independently fixed registration/);
});

for (const row of artifact.registration.files) test('Ninth rejects live drift before the predecessor callback: ' + row.path, () => {
  let predecessorCalls = 0;
  const source = path => path === row.path ? Buffer.concat([read(path), Buffer.from('\nUNREVIEWED_SOURCE\n')]) : read(path);
  assert.throws(() => resolveConsolidationRequiredMarketIntegrity(registry, eighthBytes, source,
    () => { predecessorCalls++; throw new Error('PREDECESSOR_MUST_NOT_RUN'); }), /unreviewed Ninth live source drift/);
  assert.equal(predecessorCalls, 0);
  assert.throws(() => verify(registry, source), /unreviewed Ninth live source drift/);
});

test('Ninth calls the fixed predecessor only after exact live validation', () => {
  let calls = 0;
  const sentinel = new Error('EXACT_PREDECESSOR_REACHED');
  assert.throws(() => resolveConsolidationRequiredMarketIntegrity(registry, eighthBytes, read, (r, a, source) => {
    calls++;
    assert.equal(r[SECTION], undefined);
    assert.equal(hash(source(REGISTRY)), 'adab1af6cc1099536c16b3704cbdaaae8f41f27c1243a6c485b40e0be2cc9411');
    assert.equal(hash(source(GENERATOR)), 'b642e59f5a914c778270e358c81d4eeee92695a0ffb4b95d02558c43dc8d6e8a');
    assert.equal(hash(a), 'f0f4a1a7d5b72d45841f1910ef5ccd8c3b390c4488f78b82ccf3e687ee17b2f1');
    throw sentinel;
  }), error => error === sentinel);
  assert.equal(calls, 1);
});

for (const path of [
  'tests/helpers/subscriberProjectionIntegrity.mjs',
  'tests/helpers/consolidationIntegrity.mjs',
  'tests/helpers/consolidationDeliveryIntegrity.mjs',
  'tests/helpers/consolidationTestWiringIntegrity.mjs',
  'tests/helpers/consolidationSqlHistoryIntegrity.mjs',
  'docs/operations/evidence/core-consolidation-candidate-20260909.json',
  'docs/operations/evidence/core-consolidation-delivery-candidate-20260909.json',
  'docs/operations/evidence/core-consolidation-test-wiring-20260909.json',
  'docs/operations/evidence/core-consolidation-sql-history-20260909.json',
  'docs/operations/evidence/core-consolidation-public-export-20260909.json',
  'docs/operations/core-stability-source-manifest-20260907.json',
]) test('Ninth retains historical guard/artifact rejection: ' + path, () => {
  assert.throws(() => verify(registry, name => name === path ? Buffer.concat([read(name), Buffer.from('\n')]) : read(name)));
});

for (const flag of ['production_operations', 'production_sql_execution', 'external_delivery_verified',
  'natural_stability_claim', 'auth_change', 'acl_change', 'readdy_host_verified', 'release_ready']) {
  test('Ninth cannot add operational authority: ' + flag, () => {
    const changed = structuredClone(registry); changed[SECTION][flag] = true;
    assert.throws(() => verify(changed), /Ninth independently fixed registration/);
  });
}

for (const [name, mutate] of [
  ['omitted source', section => section.files.pop()],
  ['duplicate source', section => section.files.push(section.files[0])],
  ['unknown source', section => section.files.push({ ...section.files[0], path: 'supabase/functions/unknown/index.ts' })],
  ['forged candidate hash', section => { section.files[0].candidate_hash = '0'.repeat(64); }],
  ['missing declaration', section => { section.declarations = []; }],
  ['duplicate declaration', section => section.declarations.push(section.declarations[0])],
  ['unknown declaration', section => section.declarations.push({ ...section.declarations[0], name: 'OPENAI_EVIDENCE_GUARDRAILS' })],
  ['historical test waiver', section => { section.test_case_successors = [{ name: 'unreviewed' }]; }],
  ['removed preserved statements', section => { section.additive_test_statements = []; }],
]) test('Ninth exact registration rejects ' + name, () => {
  const changed = structuredClone(registry); mutate(changed[SECTION]);
  assert.throws(() => verify(changed), /Ninth independently fixed registration/);
});

test('co-mutated live source and claimed hash cannot authorize themselves', () => {
  const changed = structuredClone(registry), tampered = Buffer.concat([read(GENERATOR), Buffer.from('\nUNREVIEWED\n')]);
  changed[SECTION].files.find(row => row.path === GENERATOR).candidate_hash = hash(tampered);
  assert.throws(() => verify(changed, path => path === GENERATOR ? tampered : path === REGISTRY ? json(changed) : read(path)),
    /Ninth independently fixed registration/);
});

test('Ninth never rewrites old Production or previous registration bytes', () => {
  const changed = structuredClone(registry); changed.files[0].baseline_sha256 = '0'.repeat(64);
  assert.throws(() => verify(changed, path => path === REGISTRY ? json(changed) : read(path)), /all eight previous registry layers unchanged/);
});

for (const field of ['source_diffs', 'preimages']) test('Ninth rejects forged ' + field, () => {
  const changed = structuredClone(artifact); changed[field][Object.keys(changed[field])[0]] = 'forged';
  assert.throws(() => verify(registry, path => path === REQUIRED_MARKET_ARTIFACT_PATH ? json(changed) : read(path)),
    /Ninth immutable independently pinned artifact/);
});

test('all historical focused test/helper statements and Eighth assertion tail remain byte-identical', () => {
  const result = verify();
  for (const row of artifact.registration.additive_test_statements) {
    const statements = bytes => { const p = ts.createSourceFile(row.path, bytes.toString(), ts.ScriptTarget.Latest, true);
      return p.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(p)); };
    const old = statements(result.eighthReadSource(row.path)), current = statements(read(row.path));
    assert.deepEqual(old.map(hash), row.original_statement_hashes);
    let cursor = 0;
    for (const statement of old) { const i = current.indexOf(statement, cursor); assert.ok(i >= cursor); cursor = i + 1; }
    assert.equal(current.length - old.length, row.added_statement_count);
    assert.equal(hash(gunzipSync(Buffer.from(artifact.preimages[row.path], 'base64'))),
      artifact.registration.files.find(file => file.path === row.path).original_hash);
  }
  const row = artifact.registration.preserved_test_bodies[0];
  for (const text of [read(row.path).toString(), result.eighthReadSource(row.path).toString()]) {
    assert.equal(hash(text.slice(text.indexOf(row.marker))), row.sha256);
    assert.match(text, /artifact\.registration\.files\.length, 24/);
  }
});

test('required US correction does not change Taiwan, score, SQL or missing-data policy thresholds', () => {
  const result = verify(), old = result.eighthReadSource(GENERATOR).toString(), current = read(GENERATOR).toString();
  const named = text => { const p = ts.createSourceFile(GENERATOR, text, ts.ScriptTarget.Latest, true);
    return new Map(p.statements.filter(n => n.name).map(n => [n.name.getText(p), n.getText(p)])); };
  const before = named(old), after = named(current);
  assert.equal(before.get('checkTWCoreStatus'), after.get('checkTWCoreStatus'));
  assert.match(after.get('checkTWCoreStatus'), /dataInsufficient:mm>=2/);
  assert.match(current, /checkTWCoreStatus\(marketData,log\)/);
  assert.match(current, /checkMVPStatus\(researchMarketData,log\)/);
  assert.equal(before.get('checkMVPStatus').replace('mvpInsufficient:c<2', 'mvpInsufficient:c<3'), after.get('checkMVPStatus'));
  assert.deepEqual(artifact.registration.declarations.map(row => row.name), ['checkMVPStatus']);
});

test('source admission preserves actual failed runtime and does not claim fresh persistent or release PASS', () => {
  verify();
  assert.equal(artifact.targeted_verification.tests, 64);
  assert.equal(artifact.targeted_verification.pass, 64);
  assert.match(artifact.targeted_verification.boundary, /not persistent replay/);
  assert.equal(artifact.retained_failures[1].sha256, 'f66d4e1f519f1c6d95f14104df5df89509e3e2431b149f1b26dc389a1eb3f925');
  assert.match(artifact.retained_failures[1].meaning, /failed runtime/);
  assert.equal(artifact.runtime_source_pack.business_runtime_rows.length, 54);
  assert.equal(artifact.runtime_source_pack.unchanged_count, 53);
  assert.deepEqual(artifact.runtime_source_pack.changed_paths, [GENERATOR]);
  assert.equal(artifact.registration.release_ready, false);
  assert.equal(artifact.registration.external_delivery_verified, false);
  assert.equal(artifact.registration.natural_stability_claim, false);
  assert.equal(artifact.registration.readdy_host_verified, false);
});
